import {Programme,BroadcastClock} from './schedule.js';
import {$,time,date,dayKey,el,duration,metadata,showDetails,bindDialog} from './common.js';
import {createMedia,loadYouTube} from './media.js';
const clock=new BroadcastClock(),programme=new Programme(clock);
const clockTime=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Minsk',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
let powered=false,media=null,ready=false,starting=false,generation=0,loaded=null,ended=null,retries=0,retryAt=0,failed=false,lastProgress=0,lastPosition=-1,lastSync=0,joined=false,guideKey='',listKey='',infoKey='',selectedDay=dayKey(clock.now()),allDays=false,dayMode='today';
let volume=70,muted=false,lastAudible=70;
try{const s=JSON.parse(localStorage.getItem('web-tv:sound'));if(s){if(Number.isFinite(s.volume)&&s.volume>=0&&s.volume<=100)volume=s.volume;muted=s.muted===true;if(Number.isFinite(s.lastAudible)&&s.lastAudible>0&&s.lastAudible<=100)lastAudible=s.lastAudible;}}catch{}
function saveSound(){try{localStorage.setItem('web-tv:sound',JSON.stringify({volume,muted,lastAudible}));}catch{}}
function sound(){const silent=muted||volume===0,label=silent?'Включить звук':'Выключить звук';$('mute').classList.toggle('sound-muted',silent);$('mute').title=label;$('mute').setAttribute('aria-label',label);$('mute').setAttribute('aria-pressed',String(silent));$('volume').value=volume;$('volume').title=`Громкость: ${volume}%`;$('volume').style.setProperty('--level',volume+'%');if(ready&&media)media.sound(volume,silent);}
function setPower(on){powered=on;$('tv').classList.toggle('on',on);$('standby').hidden=on;const label=on?'Выключить телевизор':'Включить телевизор';$('power').title=label;$('power').setAttribute('aria-label',label);$('power').setAttribute('aria-pressed',String(on));}
function clearMedia(){generation++;ready=false;starting=false;joined=false;try{media?.destroy();}catch{}media=null;$('player')?.remove();document.querySelector('.native-player')?.remove();const host=el('div');host.id='player';$('standby').parentNode.append(host);}
function resetShow(id){clearMedia();loaded=id;retries=0;retryAt=0;failed=false;ended=null;$('retry').hidden=true;}
function fail(){
  if(failed)return;failed=true;clearMedia();
  retryAt=retries<2?clock.now()+(retries===0?4000:15000):Infinity;
  $('retry').hidden=false;
}
function autoplayBlocked(){clearMedia();setPower(false);$('status').textContent='Нажмите кнопку питания ещё раз, чтобы разрешить воспроизведение.';}
async function start(p){
  if(starting||!powered||!p)return;
  starting=true;failed=false;lastProgress=clock.now();lastPosition=-1;const token=++generation;
  const valid=()=>token===generation&&powered&&programme.active()?.id===p.id;
  try{
    const result=await createMedia($('player'),programme.video(p),Math.max(0,(clock.now()-p.startMs)/1000),{
      ready(m){if(!valid()){m.destroy();return;}media=m;ready=true;starting=false;sound();media.seek(Math.max(0,(clock.now()-p.startMs)/1000));media.play();},
      playing(){if(!valid()||!media)return;if(!joined){joined=true;media.seek(Math.max(0,(clock.now()-p.startMs)/1000));}failed=false;$('retry').hidden=true;lastProgress=clock.now();$('status').textContent='';},
      paused(){if(valid()&&ready&&!failed)media?.play();},
      ended(){if(!valid())return;ended=p.id;clearMedia();},
      error(){if(valid())fail();},blocked(){if(valid())autoplayBlocked();}
    });
    if(!valid()){result?.destroy();return;}if(result)media=result;
  }catch{if(valid())fail();}
}
function synchronize(force=false){
  if(!powered||!ready||!media||failed)return;
  const p=programme.active(),now=clock.now();if(!p||p.id!==loaded)return;
  if(!force&&now-lastSync<30000)return;lastSync=now;
  try{const position=media.time(),expected=(now-p.startMs)/1000;if(media.state()===1&&Number.isFinite(position)&&Math.abs(position-expected)>8)media.seek(Math.max(0,expected));}catch{}
}
function renderGuide(now){
  if(!programme.raw)return;
  const current=programme.active(now),key=JSON.stringify([programme.raw.schedule,programme.catalog,selectedDay,allDays,current?.id,dayKey(now)]);
  if(key===guideKey)return;guideKey=key;
  const today=dayKey(now),tomorrow=dayKey(now+86400000);if(dayMode==='today')selectedDay=today;if(dayMode==='tomorrow')selectedDay=tomorrow;
  for(const [id,day] of [['today',today],['tomorrow',tomorrow]]){$(id).setAttribute('aria-pressed',String(!allDays&&selectedDay===day));}
  $('week').setAttribute('aria-pressed',String(allDays));$('guide-date').value=selectedDay;
  const rows=programme.programs.filter(p=>allDays?dayKey(p.startMs)>=today&&dayKey(p.startMs)<=dayKey(now+6*86400000):dayKey(p.startMs)===selectedDay);
  const host=$('guide-list');host.replaceChildren();let previousDay='';
  for(const p of rows){const day=dayKey(p.startMs),v=programme.video(p);if(day!==previousDay){host.append(el('h3',date.format(p.startMs)));previousDay=day;}
    const row=el('article',undefined,'guide-row'+(p.id===current?.id?' current':''));
    const hours=el('div',time.format(p.startMs)+' — '+time.format(p.endMs),'guide-hours');
    const detail=el('div');const button=el('button',v.title,'text-button');button.onclick=()=>showDetails(v);detail.append(button,el('p',[p.theme,v.category].filter(Boolean).join(' · '),'muted'));
    const state=el('span',p.id===current?.id?'В эфире':p.endMs<=now?'Завершено':p.repeat?'Повтор':'','guide-badge');row.append(hours,detail,state);host.append(row);
  }
  if(!rows.length)host.append(el('p','На выбранный период показы пока не назначены.','muted'));
}
function render(){
  const now=clock.now(),active=programme.active(now),p=active&&active.id!==ended?active:null,next=programme.next(now);
  $('clock').textContent=date.format(now)+' · '+clockTime.format(now);
  if(!programme.raw)return p;
  $('now').textContent=p?programme.video(p).title:(next.length?'Перерыв между передачами':'Эфир завершён');
  $('current-time').textContent=p?`${time.format(p.startMs)} — ${time.format(p.endMs)} · осталось ${Math.ceil((p.endMs-now)/60000)} мин.`:'';
  $('show-progress').hidden=!p;if(p){$('show-progress').value=(now-p.startMs)/(p.endMs-p.startMs)*100;$('show-progress').setAttribute('aria-label','Прошло передачи');}
  const slate=!p||failed;$('tv').classList.toggle('no-program',slate);
  $('slate-clock').textContent=clockTime.format(now);
  $('slate-heading').textContent=failed&&p?'Документальное телевидение':next.length?'Продолжение эфира':'До следующей встречи';
  $('slate-title').textContent=failed&&p?programme.video(p).title:next.length?programme.video(next[0]).title:'Новые показы появятся в телепрограмме';
  $('slate-countdown').textContent=next.length?`${date.format(next[0].startMs)}, ${time.format(next[0].startMs)} · через ${duration((next[0].startMs-now)/1000)}`:'';
  const key=JSON.stringify(next.map(x=>[x.id,x.start,programme.video(x).title]));
  if(key!==listKey){listKey=key;$('schedule').replaceChildren();for(const x of next){const li=el('li'),t=el('time',date.format(x.startMs)+' в '+time.format(x.startMs)),d=el('div',programme.video(x).title);li.append(t,d);$('schedule').append(li);}if(!next.length)$('schedule').append(el('li','Следующие показы пока не назначены.'));}
  const infoVideo=programme.video(p||next[0]),ik=JSON.stringify(infoVideo);
  if(ik!==infoKey){infoKey=ik;$('info-title').textContent=infoVideo?.series||'О передаче';$('info-meta').textContent=infoVideo?metadata(infoVideo):'';$('info-summary').textContent=infoVideo?.summary||'Авторское документальное телевидение.';$('info-more').hidden=!infoVideo;$('info-more').onclick=()=>infoVideo&&showDetails(infoVideo);}
  renderGuide(now);return p;
}
function tick(){
  const p=render();if(!powered)return;
  if(!p){if(media||starting)clearMedia();return;}
  if(loaded!==p.id)resetShow(p.id);
  if(failed){if(clock.now()>=retryAt){retries++;clearMedia();start(p);}return;}
  if(!media&&!starting){start(p);return;}
  if((starting||ready)&&clock.now()-lastProgress>25000){fail();return;}
  if(ready&&media){try{const pos=media.time();if(Number.isFinite(pos)&&Math.abs(pos-lastPosition)>.2){lastPosition=pos;lastProgress=clock.now();}}catch{}synchronize();}
}
$('power').onclick=()=>{if(powered){clearMedia();setPower(false);loaded=null;ended=null;failed=false;$('retry').hidden=true;$('status').textContent='';}else if(programme.raw){setPower(true);loaded=null;$('status').textContent='';tick();}};
$('retry').onclick=()=>{const p=programme.active();if(p){resetShow(p.id);setPower(true);start(p);}};
$('volume').oninput=e=>{volume=Number(e.target.value);muted=volume===0;if(volume>0)lastAudible=volume;sound();saveSound();};
$('mute').onclick=()=>{if(muted||volume===0){muted=false;if(volume===0)volume=lastAudible;}else{lastAudible=volume;muted=true;}sound();saveSound();};
$('full').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('tv').requestFullscreen();}catch{$('status').textContent='Полноэкранный режим недоступен в этом браузере.';}};
let hideTimer;function wake(){const tv=$('tv');tv.classList.remove('controls-hidden');clearTimeout(hideTimer);if(document.fullscreenElement===tv)hideTimer=setTimeout(()=>{if(!document.querySelector('.deck :focus-visible'))tv.classList.add('controls-hidden');},3000);}
for(const event of ['pointermove','pointerdown','keydown','focusin'])$('tv').addEventListener(event,wake);
$('tv').addEventListener('focusout',wake);
document.addEventListener('fullscreenchange',()=>{const on=document.fullscreenElement===$('tv');$('full').setAttribute('aria-label',on?'Выйти из полного экрана':'Открыть на полный экран');$('full').setAttribute('aria-pressed',String(on));wake();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){lastProgress=clock.now();tick();synchronize(true);programme.refresh().then(tick);}});
window.addEventListener('online',()=>{programme.refresh().then(()=>{if(powered&&failed){retryAt=0;retries=0;}tick();});});
$('today').onclick=()=>{allDays=false;dayMode='today';selectedDay=dayKey(clock.now());renderGuide(clock.now());};$('tomorrow').onclick=()=>{allDays=false;dayMode='tomorrow';selectedDay=dayKey(clock.now()+86400000);renderGuide(clock.now());};$('week').onclick=()=>{allDays=true;dayMode='week';renderGuide(clock.now());};$('guide-date').onchange=e=>{if(e.target.value){allDays=false;dayMode='custom';selectedDay=e.target.value;renderGuide(clock.now());}};
bindDialog();setPower(false);sound();
async function init(){if(!(await programme.refresh(true))){$('status').textContent='Не удалось получить телепрограмму. Повторим через минуту.';setTimeout(init,60000);return;}$('status').textContent='';for(const id of ['power','mute','volume'])$(id).disabled=false;render();loadYouTube().catch(()=>{});setInterval(()=>programme.refresh().then(tick),60000);}
setInterval(tick,1000);init();
