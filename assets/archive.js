import {Programme} from './schedule.js?v=0.2.1';
import {$,el,metadata,duration,sourceURL} from './common.js?v=0.2.1';
const programme=new Programme();let entries=[];
function close(){$('archive-player').replaceChildren();$('watch').hidden=true;history.replaceState(null,'',location.pathname+location.search);}
function watch(id,v){
  $('archive-player').replaceChildren();$('watch').hidden=false;$('watch-title').textContent=v.title;$('watch-summary').textContent=v.summary||'';$('watch-source').href=sourceURL(v);
  if(v.source.type==='youtube'){const frame=el('iframe');frame.title=v.title;frame.src=`https://www.youtube.com/embed/${v.source.videoId}?playsinline=1&rel=0`;frame.allow='autoplay; encrypted-media; picture-in-picture; fullscreen';frame.allowFullscreen=true;frame.referrerPolicy='strict-origin-when-cross-origin';$('archive-player').append(frame);}else{const video=el('video');video.src=v.source.url;video.controls=true;video.playsInline=true;$('archive-player').append(video);}
  history.replaceState(null,'','#'+encodeURIComponent(id));$('watch').scrollIntoView({block:'start',behavior:'smooth'});
}
function render(){const query=$('archive-search').value.trim().toLocaleLowerCase('ru'),category=$('archive-category').value,host=$('archive-list');host.replaceChildren();const list=entries.filter(([,v])=>(!category||v.category===category)&&[v.title,v.author,v.series,v.seriesSummary,v.summary].filter(Boolean).join(' ').toLocaleLowerCase('ru').includes(query));$('archive-count').textContent=`Передач: ${list.length}`;
  let previousSeries='';for(const [id,v] of list){if(v.series&&v.series!==previousSeries){const intro=el('section',undefined,'series-intro');intro.append(el('h2',v.series));if(v.seriesSummary)intro.append(el('p',v.seriesSummary,'muted'));host.append(intro);previousSeries=v.series;}const card=el('article',undefined,'film-card');card.append(el('p',v.category||'Документальное кино','muted'),el('h2',v.title),el('p',metadata(v),'muted'));if(v.summary)card.append(el('p',v.summary));card.append(el('p',duration(v.durationSeconds),'muted'));const b=el('button','Смотреть с начала');b.onclick=()=>watch(id,v);card.append(b);host.append(card);}
  if(!list.length)host.append(el('p','Ничего не найдено. Попробуйте другое название.','empty'));
}
$('watch-close').onclick=close;$('archive-search').oninput=render;$('archive-category').onchange=render;
async function init(){if(!(await programme.refresh(true))){$('archive-count').textContent='Не удалось получить каталог. Обновите страницу.';return;}entries=Object.entries(programme.catalog.videos).filter(([,v])=>v.archive!==false).sort(([,a],[,b])=>(a.series||a.category||'').localeCompare(b.series||b.category||'','ru')||(a.episode||0)-(b.episode||0)||a.title.localeCompare(b.title,'ru'));for(const category of [...new Set(entries.map(([,v])=>v.category).filter(Boolean))].sort()){const o=el('option',category);o.value=category;$('archive-category').append(o);}render();let id;try{id=decodeURIComponent(location.hash.slice(1));}catch{}const match=entries.find(([key])=>key===id);if(match)watch(...match);}
init();
