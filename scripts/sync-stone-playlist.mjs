// Sync new Stone Simulator recordings from the playlist into the broadcast catalogue.
// Requires yt-dlp on PATH; GitHub Actions installs it before running this script.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';

const catalogPath=new URL('../data/videos.json',import.meta.url);
const schedulePath=new URL('../data/schedule.json',import.meta.url);
const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
const schedule=JSON.parse(readFileSync(schedulePath,'utf8'));
const id=schedule.rotation?.stone?.playlistId;
if(!/^[A-Za-z0-9_-]{12,50}$/.test(id||''))throw Error('Missing Stone Simulator playlist ID');

const call=spawnSync('yt-dlp',[
  '--flat-playlist','--dump-single-json','--no-warnings',
  '--socket-timeout','25',`https://www.youtube.com/playlist?list=${id}`
],{encoding:'utf8',maxBuffer:12*1024*1024,timeout:120000});
if(call.error||call.status!==0)throw Error('YouTube playlist unavailable: '+(call.error?.message||call.stderr||call.status));
const data=JSON.parse(call.stdout);
const entries=data.entries||[];
if(!Array.isArray(entries)||!entries.length)throw Error('Stone Simulator playlist returned no videos');

const clean=[];
for(const [index,e] of entries.entries()){
  if(!e||!/^[A-Za-z0-9_-]{11}$/.test(e.id||''))throw Error('Invalid playlist video at '+index);
  if(!Number.isFinite(e.duration)||e.duration<=0)throw Error('Missing video duration for '+e.id);
  clean.push({
    id:'stone-'+e.id,
    title:(e.title||'Stone Simulator').trim(),
    seconds:Math.ceil(e.duration),
    youtubeId:e.id,
    episode:index+1
  });
}
if(new Set(clean.map(x=>x.id)).size!==clean.length)throw Error('Duplicate Stone Simulator IDs');
let changes=0;
for(const e of clean){
  const prev=catalog.videos[e.id];
  const next={
    title:e.title,durationSeconds:e.seconds,
    source:{type:'youtube',videoId:e.youtubeId},
    author:prev?.author||'ShoobahDoobah',
    category:'Stone Simulator',
    series:'Stone Simulator',
    episode:e.episode
  };
  if(JSON.stringify(prev)!==JSON.stringify(next)){
    catalog.videos[e.id]=next;
    changes++;
  }
}
if(changes){
  catalog.version++;
  writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
}
console.log(JSON.stringify({playlist:id,found:clean.length,changed:changes,catalogVersion:catalog.version}));
