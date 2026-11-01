// Run only on a trusted GitHub Actions workflow_dispatch runner.
// Fetch metadata without allowing user-controlled shell commands, hosts or paths.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {parseYouTubeUrl,addVideosToCatalog} from './video-admin.js';

const params={
  source:process.env.DOC_SOURCE||'',
  kind:process.env.DOC_KIND||'video',
  mediaType:process.env.DOC_MEDIA_TYPE||'documentary',
  series:process.env.DOC_SERIES||'',
  episode:process.env.DOC_EPISODE||'',
  title:process.env.DOC_TITLE||'',
  durationSeconds:process.env.DOC_DURATION||''
};
const input=parseYouTubeUrl(params.source,params.kind);
const catalogPath=new URL('../data/videos.json',import.meta.url);
const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));

function ytdlp(url,isPlaylist){
  const args=[
    '--dump-single-json','--no-warnings','--socket-timeout','20',
    '--retries','1',...(isPlaylist?['--flat-playlist','--playlist-end','61']:['--no-playlist']),
    url
  ];
  const p=spawnSync('yt-dlp',args,{encoding:'utf8',maxBuffer:20*1024*1024,timeout:110000});
  if(p.error||p.status!==0)return null;
  try{return JSON.parse(p.stdout);}catch{return null;}
}
async function oembed(id){
  const url='https://www.youtube.com/oembed?format=json&url='+encodeURIComponent('https://www.youtube.com/watch?v='+id);
  try{
    const response=await fetch(url,{signal:AbortSignal.timeout(13000)});
    if(!response.ok)return {};
    const obj=await response.json();
    return {title:obj.title,author:obj.author_name};
  }catch{return {};}
}
let browser=null,server=null;
async function iframeMetadata(id){
  if(!browser){
    const puppeteer=(await import('puppeteer-core')).default;
    const chrome=['google-chrome','google-chrome-stable','chromium','chromium-browser']
      .map(exe=>spawnSync('which',[exe],{encoding:'utf8'}))
      .find(x=>x.status===0)?.stdout.trim();
    if(!chrome)throw Error('На сервере нет Chromium для проверки длительности');
    server=createServer((req,res)=>{
      const key=new URL(req.url,'http://localhost').searchParams.get('v')||'';
      if(!/^[A-Za-z0-9_-]{11}$/.test(key)){res.writeHead(400);res.end();return;}
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','referrer-policy':'strict-origin-when-cross-origin'});
      res.end(`<!doctype html><html><head><meta name="referrer" content="strict-origin-when-cross-origin"></head><body>
      <div id="player"></div><script>
      window.videoMeta=null;
      window.onYouTubeIframeAPIReady=()=>{
        const p=new YT.Player('player',{videoId:${JSON.stringify(key)},
          playerVars:{controls:0,playsinline:1,origin:'http://127.0.0.1:8765'},
          events:{
            onReady:()=>setTimeout(()=>{
              window.videoMeta={title:p.getVideoData()?.title||'',duration:p.getDuration()||0};
            },1700),
            onError:e=>{window.videoMeta={error:e.data}}
          }
        });
      };
      </script><script src="https://www.youtube.com/iframe_api"></script>
      </body></html>`);
    });
    await new Promise(resolve=>server.listen(8765,'127.0.0.1',resolve));
    browser=await puppeteer.launch({headless:true,executablePath:chrome,args:['--no-sandbox','--disable-dev-shm-usage','--autoplay-policy=no-user-gesture-required']});
  }
  const page=await browser.newPage();
  try{
    await page.goto('http://127.0.0.1:8765/?v='+id,{waitUntil:'domcontentloaded',timeout:15000});
    await page.waitForFunction(()=>window.videoMeta!==null,{timeout:25000});
    return await page.evaluate(()=>window.videoMeta);
  }finally{await page.close();}
}
async function metadataFor(entry,forceTitle=false){
  const id=entry.id;
  let title=String(entry.title||'').trim(),author=String(entry.uploader||entry.channel||entry.author||'').trim();
  let duration=Number(entry.duration)||0;
  if(!title||forceTitle){
    const o=await oembed(id);
    title=o.title||title;author=o.author||author;
  }
  if((!duration&&params.mediaType!=='webcam'&&!params.durationSeconds)||!title){
    const extra=await iframeMetadata(id);
    title=title||extra.title||'';
    duration=duration||Number(extra.duration)||0;
  }
  return {id,title,author,duration};
}
let videos;
try{
  if(input.kind==='playlist'){
    const data=ytdlp(input.url,true);
    if(!data||!Array.isArray(data.entries)||!data.entries.length)
      throw Error('Не удалось получить плейлист YouTube; повторите попытку позже');
    if(data.entries.length>60)throw Error('В одном импорте допускается максимум 60 видео');
    videos=[];
    for(const entry of data.entries){
      if(!/^[A-Za-z0-9_-]{11}$/.test(entry?.id||''))throw Error('YouTube вернул некорректный элемент плейлиста');
      // No need to inspect duplicates again: catalogue importer skips them.
      const already=Object.values(catalog.videos).some(v=>v.source?.videoId===entry.id);
      videos.push(already?{id:entry.id,title:entry.title,duration:entry.duration||0}:await metadataFor(entry));
    }
  }else{
    const data=ytdlp(input.url,false);
    const base=data?.id===input.id?data:{id:input.id};
    videos=[await metadataFor(base,true)];
  }
  const outcome=addVideosToCatalog(catalog,videos,params);
  writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
  console.log('Добавлено: '+outcome.added.length+'; уже было: '+outcome.skipped);
  for(const v of outcome.added)console.log(v.id+' — '+v.title+' ('+v.durationSeconds+' сек.)');
  if(process.env.GITHUB_STEP_SUMMARY){
    const {appendFileSync}=await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '## Видео для DOC TV\n'+outcome.added.map(v=>'- '+v.title+' ('+v.durationSeconds+' сек.)').join('\n')+
      '\n\nИзменения требуют подтверждения через Pull Request.\n');
  }
}finally{
  if(browser)await browser.close();
  if(server)await new Promise(resolve=>server.close(resolve));
}
