import {Programme,BroadcastClock} from './schedule.js?v=0.4.0';
import {$,time,date,el,duration} from './common.js?v=0.4.0';
import {createMedia,loadYouTube} from './media.js?v=0.4.3';

const clock=new BroadcastClock(),programme=new Programme(clock);
const clockTime=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Minsk',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
let powered=false,media=null,ready=false,starting=false,generation=0,loaded=null,prepared=null,ended=null,retries=0,retryAt=0,failed=false,lastProgress=0,lastPosition=-1,lastSync=0,listKey='',transitionTimer=0,transitionAt=0,fadeTimer=0,fadeAt=0,breakRevealTimer=0;
let volume=70,muted=false,lastAudible=70;

try{
  const s=JSON.parse(localStorage.getItem('web-tv:sound'));
  if(s){
    if(Number.isFinite(s.volume)&&s.volume>=0&&s.volume<=100)volume=s.volume;
    muted=s.muted===true;
    if(Number.isFinite(s.lastAudible)&&s.lastAudible>0&&s.lastAudible<=100)lastAudible=s.lastAudible;
  }
}catch{}

function saveSound(){try{localStorage.setItem('web-tv:sound',JSON.stringify({volume,muted,lastAudible}));}catch{}}
function sound(){
  const silent=muted||volume===0,label=silent?'Включить звук':'Выключить звук';
  $('mute').classList.toggle('sound-muted',silent);
  $('mute').title=label;
  $('mute').setAttribute('aria-label',label);
  $('mute').setAttribute('aria-pressed',String(silent));
  $('volume').value=volume;
  $('volume').title=`Громкость: ${volume}%`;
  $('volume').style.setProperty('--level',volume+'%');
  if(ready&&media)media.sound(volume,silent);
}
function setStartCover(on){
  const cover=$('startup-cover');
  if(cover)cover.hidden=!on;
}
function setBroadcastFade(on,instant=false){
  const fade=$('broadcast-fade');
  if(!fade)return;
  if(instant)fade.classList.add('no-transition');
  fade.classList.toggle('active',on);
  if(instant)requestAnimationFrame(()=>requestAnimationFrame(()=>fade.classList.remove('no-transition')));
}
function revealBreak(){
  clearTimeout(breakRevealTimer);
  breakRevealTimer=setTimeout(()=>{
    if(powered&&!programme.active())setBroadcastFade(false);
  },260);
}
function programmeTitle(host,show,fallback=''){
  host.replaceChildren();
  if(!show){host.textContent=fallback;return;}
  if(show.premiere)host.append(el('span','ПРЕМЬЕРА','premiere-badge'),document.createTextNode(' '));
  host.append(document.createTextNode(programme.video(show).title));
}
function setPower(on){
  powered=on;
  $('tv').classList.toggle('on',on);
  $('standby').hidden=on;
  if(!on){
    setStartCover(false);
    clearTimeout(breakRevealTimer);
    setBroadcastFade(false,true);
  }
  const label=on?'Выключить телевизор':'Включить телевизор';
  $('power').title=label;
  $('power').setAttribute('aria-label',label);
  $('power').setAttribute('aria-pressed',String(on));
}
function clearMedia(){
  generation++;
  ready=false;
  starting=false;
  prepared=null;
  try{media?.destroy();}catch{}
  media=null;
  $('player')?.remove();
  document.querySelector('.native-player')?.remove();
  const host=el('div');
  host.id='player';
  const cover=$('startup-cover');
  if(cover)cover.before(host);else $('standby').parentNode.append(host);
  setStartCover(false);
}
function resetFailure(){
  retries=0;
  retryAt=0;
  failed=false;
  ended=null;
}
function fail(){
  if(document.hidden||failed)return;
  failed=true;
  clearMedia();
  const delays=[4000,15000,30000];
  retryAt=clock.now()+delays[Math.min(retries,delays.length-1)];
}
function autoplayBlocked(){
  // A background tab may reject a fresh autoplay. Keep the TV powered;
  // visibilitychange will retry the already prepared player when necessary.
  if(document.hidden)return;
  clearMedia();
  setPower(false);
  $('status').textContent='Нажмите кнопку питания ещё раз, чтобы разрешить воспроизведение.';
}
function eventsFor(p,token){
  const valid=()=>token===generation&&powered&&programme.active()?.id===p.id;
  return {
    ready(m){
      if(!valid()){m.destroy();return;}
      media=m;
      ready=true;
      starting=false;
      sound();
      media.play();
    },
    playing(){
      if(!valid()||!media)return;
      failed=false;
      retries=0;
      lastProgress=clock.now();
      $('status').textContent='';
      setTimeout(()=>{
        if(!valid())return;
        setStartCover(false);
        requestAnimationFrame(()=>setBroadcastFade(false));
      },220);
    },
    paused(){
      if(valid()&&ready&&!failed&&!document.hidden)media?.play();
    },
    ended(){
      if(!valid())return;
      if(clock.now()<p.endMs-5000){
        clearMedia();
        setStartCover(true);
        if(!document.hidden)setTimeout(()=>start(p),200);
      }else{
        ended=p.id;
        setBroadcastFade(true);
        setTimeout(()=>{
          try{media?.pause();}catch{}
          prepareNext();
          revealBreak();
        },420);
      }
    },
    error(){if(valid()&&!document.hidden)fail();},
    blocked(){if(valid())autoplayBlocked();}
  };
}
function prepareShow(p,offset=0){
  if(!powered||!p||!media||!media.canReuse?.(programme.video(p)))return false;
  const token=++generation;
  const ok=media.prepare(programme.video(p),Math.max(0,offset),eventsFor(p,token));
  if(!ok){generation--;return false;}
  prepared={id:p.id,token};
  loaded=null;
  starting=false;
  ready=true;
  resetFailure();
  lastPosition=-1;
  sound();
  return true;
}
function prepareNext(){
  if(!powered||!programme.raw||starting)return false;
  const next=programme.next(clock.now(),1)[0];
  if(!next)return false;
  if(prepared?.id===next.id&&media)return true;
  try{media?.pause();}catch{}
  return prepareShow(next,0);
}
function activatePrepared(p){
  if(!powered||!p||!media||prepared?.id!==p.id)return false;
  const offset=Math.max(0,(clock.now()-p.startMs)/1000);
  const token=++generation;
  if(!media.prepare(programme.video(p),offset,eventsFor(p,token))){
    generation--;
    return false;
  }
  loaded=p.id;
  prepared=null;
  starting=false;
  ready=true;
  resetFailure();
  lastProgress=clock.now();
  lastPosition=-1;
  clearTimeout(breakRevealTimer);
  setBroadcastFade(true,true);
  setStartCover(true);
  sound();
  try{media.play();return true;}catch{return false;}
}
async function start(p){
  if(starting||!powered||!p)return;
  if(activatePrepared(p))return;
  if(media&&prepareShow(p,Math.max(0,(clock.now()-p.startMs)/1000))&&activatePrepared(p))return;

  clearMedia();
  loaded=p.id;
  starting=true;
  failed=false;
  lastProgress=clock.now();
  lastPosition=-1;
  clearTimeout(breakRevealTimer);
  setBroadcastFade(true,true);
  setStartCover(true);
  const token=++generation;
  try{
    const result=await createMedia($('player'),programme.video(p),Math.max(0,(clock.now()-p.startMs)/1000),eventsFor(p,token));
    if(token!==generation){result?.destroy();return;}
    if(result)media=result;
  }catch{
    if(token===generation&&!document.hidden)fail();
  }
}
function synchronize(){
  if(document.hidden||!powered||!ready||!media||failed)return;
  const p=programme.active(),now=clock.now();
  if(!p||p.id!==loaded||now-lastSync<30000)return;
  lastSync=now;
  try{
    const position=media.time(),expected=(now-p.startMs)/1000;
    if(media.state()===1&&Number.isFinite(position)&&Math.abs(position-expected)>8)media.seek(Math.max(0,expected));
  }catch{}
}
function render(){
  const now=clock.now(),active=programme.active(now),p=active&&active.id!==ended?active:null,next=programme.next(now);
  $('clock').textContent=date.format(now)+' · '+clockTime.format(now);
  if(!programme.raw)return p;

  programmeTitle($('now'),p,next.length?'Перерыв между передачами':'Эфир завершён');
  $('current-time').textContent=p?`${time.format(p.startMs)} - ${time.format(p.endMs)} · осталось ${Math.ceil((p.endMs-now)/60000)} мин.`:'';
  $('show-progress').hidden=!p;
  if(p){
    $('show-progress').value=(now-p.startMs)/(p.endMs-p.startMs)*100;
    $('show-progress').setAttribute('aria-label','Прошло передачи');
  }

  const nextShow=next[0]||null;
  const toNext=nextShow?nextShow.startMs-now:Infinity;
  const bumper=powered&&!p&&!failed&&nextShow&&toNext>0&&toNext<=programme.bumperSeconds()*1000;
  $('tv').classList.toggle('pre-roll',!!bumper);
  $('ident').hidden=!bumper;
  if(bumper){
    const v=programme.video(nextShow);
    $('ident-title').textContent=v.title;
    $('ident-premiere').hidden=!nextShow.premiere;
    $('ident-time').textContent=time.format(nextShow.startMs);
    $('ident-meta').textContent=nextShow.theme||v.series||v.category||'Документальный фильм';
  }

  const slate=!p||failed;
  $('tv').classList.toggle('no-program',slate);
  $('slate-clock').textContent=clockTime.format(now);
  $('slate-heading').textContent=next.length?'Следующая передача':'До следующей встречи';
  $('slate-title').textContent=failed&&p?programme.video(p).title:next.length?(next[0].premiere?'Премьера · ':'')+programme.video(next[0]).title:'Новые показы появятся позже';
  $('slate-countdown').textContent=next.length?`${date.format(next[0].startMs)}, ${time.format(next[0].startMs)} · через ${duration((next[0].startMs-now)/1000)}`:'';

  const key=JSON.stringify(next.map(x=>[x.id,x.start,x.premiere,programme.video(x).title]));
  if(key!==listKey){
    listKey=key;
    $('schedule').replaceChildren();
    for(const x of next){
      const li=el('li'),t=el('time',date.format(x.startMs)+' в '+time.format(x.startMs)),d=el('div');
      if(x.premiere)d.append(el('span','ПРЕМЬЕРА','premiere-badge'),document.createTextNode(' '));
      d.append(document.createTextNode(programme.video(x).title));
      li.append(t,d);
      $('schedule').append(li);
    }
    if(!next.length)$('schedule').append(el('li','Следующие показы пока не назначены.'));
  }
  return p;
}
function clearTransitionTimer(){
  if(transitionTimer)clearTimeout(transitionTimer);
  transitionTimer=0;
  transitionAt=0;
}
function clearFadeTimer(){
  if(fadeTimer)clearTimeout(fadeTimer);
  fadeTimer=0;
  fadeAt=0;
}
function armEndFade(p){
  if(!powered||!p){clearFadeTimer();return;}
  const target=p.endMs-750,now=clock.now();
  if(target<=now){
    setBroadcastFade(true);
    return;
  }
  if(fadeTimer&&fadeAt===target)return;
  clearFadeTimer();
  fadeAt=target;
  fadeTimer=setTimeout(()=>{
    fadeTimer=0;
    fadeAt=0;
    if(powered&&programme.active()?.id===p.id)setBroadcastFade(true);
  },Math.max(0,target-now));
}
function armTransitionTimer(){
  if(!powered||!programme.raw){clearTransitionTimer();return;}
  const now=clock.now(),next=programme.next(now,1)[0];
  if(!next){clearTransitionTimer();return;}
  const target=next.startMs;
  if(transitionTimer&&transitionAt===target)return;
  clearTransitionTimer();
  transitionAt=target;
  const delay=Math.max(0,Math.min(2147483000,target-now+120));
  transitionTimer=setTimeout(()=>{
    transitionTimer=0;
    transitionAt=0;
    if(powered){
      tick();
      armTransitionTimer();
    }
  },delay);
}
function tick(){
  const p=render();
  if(!powered){
    clearTransitionTimer();
    clearFadeTimer();
    return;
  }
  armTransitionTimer();
  armEndFade(p);
  if(!p){
    if(media){
      try{media.pause();}catch{}
      prepareNext();
    }
    revealBreak();
    return;
  }
  if(loaded!==p.id){
    if(document.hidden)return;
    if(!activatePrepared(p))start(p);
    return;
  }
  if(failed){
    if(document.hidden)return;
    if(clock.now()>=retryAt){
      retries++;
      clearMedia();
      start(p);
    }
    return;
  }
  if(!media&&!starting){
    start(p);
    return;
  }
  if(document.hidden)return;
  if((starting||ready)&&clock.now()-lastProgress>25000){
    fail();
    return;
  }
  if(ready&&media){
    try{
      const pos=media.time();
      if(Number.isFinite(pos)&&Math.abs(pos-lastPosition)>.2){
        lastPosition=pos;
        lastProgress=clock.now();
      }
    }catch{}
    synchronize();
  }
}

$('power').onclick=()=>{
  if(powered){
    clearTransitionTimer();
    clearFadeTimer();
    clearTimeout(breakRevealTimer);
    clearMedia();
    setPower(false);
    loaded=null;
    prepared=null;
    ended=null;
    failed=false;
    $('status').textContent='';
  }else if(programme.raw){
    setPower(true);
    loaded=null;
    prepared=null;
    $('status').textContent='';
    tick();
    armTransitionTimer();
  }
};
$('volume').oninput=e=>{
  volume=Number(e.target.value);
  muted=volume===0;
  if(volume>0)lastAudible=volume;
  sound();
  saveSound();
};
$('mute').onclick=()=>{
  if(muted||volume===0){
    muted=false;
    if(volume===0)volume=lastAudible;
  }else{
    lastAudible=volume;
    muted=true;
  }
  sound();
  saveSound();
};
$('full').onclick=async()=>{
  try{
    if(document.fullscreenElement)await document.exitFullscreen();
    else await $('tv').requestFullscreen();
  }catch{
    $('status').textContent='Полноэкранный режим недоступен в этом браузере.';
  }
};

let hideTimer;
function wake(){
  const tv=$('tv');
  tv.classList.remove('controls-hidden');
  clearTimeout(hideTimer);
  if(document.fullscreenElement===tv)hideTimer=setTimeout(()=>{
    if(!document.querySelector('.deck :focus-visible'))tv.classList.add('controls-hidden');
  },3000);
}
for(const event of ['pointermove','pointerdown','keydown','focusin'])$('tv').addEventListener(event,wake);
$('tv').addEventListener('focusout',wake);
document.addEventListener('fullscreenchange',()=>{
  const on=document.fullscreenElement===$('tv');
  $('full').setAttribute('aria-label',on?'Выйти из полного экрана':'Открыть на полный экран');
  $('full').setAttribute('aria-pressed',String(on));
  wake();
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden){
    if(powered){
      if(!programme.active())prepareNext();
      armTransitionTimer();
    }
    return;
  }
  const now=clock.now();
  lastProgress=now;
  lastSync=now;
  const p=programme.active();
  if(powered&&p&&loaded===p.id&&ready&&media){
    const expected=Math.max(0,(now-p.startMs)/1000);
    try{
      const position=media.time();
      if(Number.isFinite(position)&&Math.abs(position-expected)>3)media.seek(expected);
      if(media.state()!==1)media.play();
    }catch{}
  }
  tick();
  programme.refresh().then(()=>{render();if(powered){tick();armTransitionTimer();}});
});
window.addEventListener('online',()=>{
  programme.refresh().then(()=>{
    if(powered&&failed){retryAt=0;retries=0;}
    render();
    if(powered){tick();armTransitionTimer();}
  });
});

setPower(false);
sound();

async function init(){
  if(!(await programme.refresh(true))){
    $('status').textContent='Не удалось получить программу. Повторим через минуту.';
    setTimeout(init,60000);
    return;
  }
  $('status').textContent='';
  for(const id of ['power','mute','volume'])$(id).disabled=false;
  render();
  loadYouTube().catch(()=>{});
  setInterval(()=>programme.refresh().then(()=>{render();if(powered){tick();armTransitionTimer();}}),60000);
}
setInterval(tick,1000);
init();
