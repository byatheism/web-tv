export const $=id=>document.getElementById(id);
export const time=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Minsk',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const date=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Minsk',day:'numeric',month:'long'});
export function dayKey(ms){return new Date(ms+3*3600000).toISOString().slice(0,10);}
export function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
export function duration(seconds){const n=Math.max(0,Math.ceil(seconds));return `${Math.floor(n/3600)?Math.floor(n/3600)+':':''}${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
export function sourceURL(v){return v.sourceUrl || (v.source.type==='youtube'?`https://www.youtube.com/watch?v=${v.source.videoId}`:v.source.url);}
export function metadata(v){return [v.year,v.country,v.author,v.series&&v.episode?`${v.series} · серия ${v.episode}`:v.series].filter(Boolean).join(' · ');}
export function showDetails(video){
  const dialog=$('film-dialog');$('film-title').textContent=video.title;$('film-meta').textContent=metadata(video);
  $('film-summary').textContent=video.summary||'Описание пока не добавлено.';$('film-source').href=sourceURL(video);dialog.showModal();
}
export function bindDialog(){const dialog=$('film-dialog');if(!dialog)return;$('film-close').onclick=()=>dialog.close();dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});}
export function download(name, value){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));const a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
