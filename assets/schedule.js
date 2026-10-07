const CACHE = 'web-tv:programme';
const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export const clone = value => JSON.parse(JSON.stringify(value));

export function safeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}

function minskISO(ms){
  return new Date(ms + 3 * 3600000).toISOString().replace('Z','+03:00');
}
function strictNextSlot(ms, minutes){
  const step=minutes*60000;
  return Math.floor(ms/step)*step+step;
}
function slotAtOrAfter(ms, minutes){
  const step=minutes*60000;
  return Math.ceil(ms/step)*step;
}
function videoGroupMembers(catalog, group){
  let ids=[];
  if(group.type==='series'){
    ids=Object.entries(catalog.videos).filter(([,v])=>v.series===group.value).sort((a,b)=>{
      const ea=a[1].episode??Number.MAX_SAFE_INTEGER, eb=b[1].episode??Number.MAX_SAFE_INTEGER;
      return ea-eb || a[1].title.localeCompare(b[1].title,'ru');
    }).map(([id])=>id);
  }else if(group.type==='category'){
    ids=Object.entries(catalog.videos).filter(([,v])=>v.category===group.value).map(([id])=>id);
  }else if(group.type==='ids'){
    ids=(group.videos||[]).filter(id=>catalog.videos[id]);
  }
  if(!ids.length)throw Error('Пустая группа ротации: '+group.id);
  return ids;
}
function stripRuntime(p){
  const {startMs,endMs,...rest}=p;
  return rest;
}
function sameCatalogIds(catalog,fixed){
  if(!Array.isArray(fixed?.catalogIds))return false;
  const ids=Object.keys(catalog.videos).sort();
  return ids.length===fixed.catalogIds.length&&ids.every((id,i)=>id===fixed.catalogIds[i]);
}
function selectFixedPrograms(catalog,schedule,fixed,now){
  if(!fixed||!Array.isArray(fixed.programs))return [];
  const valid=fixed.programs.filter(p=>p&&catalog.videos[p.video]&&typeof p.start==='string'&&typeof p.end==='string');
  const exact=fixed.scheduleVersion===schedule.version&&fixed.catalogVersion===catalog.version&&sameCatalogIds(catalog,fixed);
  if(exact)return valid;
  // If the catalogue or rotation changed, keep history and the already-started show,
  // but regenerate everything that has not started yet.
  return valid.filter(p=>Date.parse(p.start)<=now);
}

export function generateRotation(catalog, schedule, history, now=Date.now()){
  const r=schedule.rotation;
  if(!r?.enabled)return [];
  if(!zoned.test(r.anchor)||!Number.isFinite(Date.parse(r.anchor)))throw Error('Некорректное начало авторотации');
  const slotMinutes=Number.isInteger(r.slotMinutes)&&r.slotMinutes>=1?r.slotMinutes:60;
  const horizonHours=Number.isFinite(r.horizonHours)&&r.horizonHours>=24?r.horizonHours:168;
  const minRepeatHours=Number.isFinite(r.minRepeatHours)&&r.minRepeatHours>=0?r.minRepeatHours:12;
  const anchorMs=Date.parse(r.anchor), horizonMs=Math.max(anchorMs,now)+horizonHours*3600000;
  const groups=(r.groups||[]).map((g,index)=>{
    if(!g||typeof g.id!=='string'||!g.id||!['series','category','ids'].includes(g.type))throw Error('Некорректная группа ротации');
    return {...g,index,members:videoGroupMembers(catalog,g)};
  });
  if(groups.length<2)throw Error('Для ротации нужны минимум две группы');

  let filler=null;
  if(r.filler){
    const g=r.filler;
    if(!g||!['series','category','ids'].includes(g.type))throw Error('Некорректная группа заполнения эфира');
    filler={...g,members:videoGroupMembers(catalog,g)};
  }

  const videoLast=new Map(), groupLast=new Map(groups.map(g=>[g.id,-Infinity])), ever=new Set();
  const groupNext=new Map();
  const orderedHistory=[...history].sort((a,b)=>a.startMs-b.startMs);

  for(const g of groups){
    let lastMember=-1;
    for(const p of orderedHistory){
      const idx=g.members.indexOf(p.video);
      if(idx>=0){
        lastMember=idx;
        groupLast.set(g.id,p.startMs);
      }
    }
    groupNext.set(g.id,(lastMember+1+g.members.length)%g.members.length);
  }
  for(const p of orderedHistory){
    if(!catalog.videos[p.video]?.live){
      videoLast.set(p.video,p.startMs);
      ever.add(p.video);
    }
  }

  let fillerIndex=0;
  if(filler){
    for(const p of orderedHistory){
      const idx=filler.members.indexOf(p.video);
      if(idx>=0)fillerIndex=(idx+1)%filler.members.length;
    }
  }

  const lastExplicit=orderedHistory.at(-1);
  const lastEnd=lastExplicit?.endMs??anchorMs;
  let cursor=slotAtOrAfter(Math.max(anchorMs,lastEnd,now),slotMinutes);
  let previousGroup=null;
  for(let i=orderedHistory.length-1;i>=0&&!previousGroup;i--){
    const p=orderedHistory[i];
    const g=groups.find(x=>x.members.includes(p.video));
    if(g)previousGroup=g.id;
  }
  const generated=[], minRepeatMs=minRepeatHours*3600000;

  function addFiller(startMs,endMs){
    if(!filler||endMs-startMs<1000)return;
    const video=filler.members[fillerIndex%filler.members.length];
    fillerIndex=(fillerIndex+1)%filler.members.length;
    const stamp=minskISO(startMs).slice(0,16).replace(/[-:T]/g,'');
    generated.push({
      id:`filler-${stamp}-${video}`,
      video,
      start:minskISO(startMs),
      end:minskISO(endMs),
      theme:filler.label||filler.value||'Веб-камера',
      rotationGroup:filler.id||'filler',
      filler:true,
      auto:true
    });
  }

  const initialFillStart=Math.max(lastEnd,now);
  if(cursor>initialFillStart)addFiller(initialFillStart,cursor);

  function choiceFor(group, startMs, enforceRepeat=true){
    if(group.type==='series'){
      const idx=groupNext.get(group.id), video=group.members[idx], last=videoLast.get(video);
      if(enforceRepeat&&last!==undefined&&startMs-last<minRepeatMs)return null;
      return {video,index:idx};
    }
    const ranked=group.members.map((video,index)=>({video,index,last:videoLast.get(video)??-Infinity}))
      .sort((a,b)=>a.last-b.last||a.index-b.index);
    return ranked.find(x=>!enforceRepeat||x.last===-Infinity||startMs-x.last>=minRepeatMs)||null;
  }

  while(cursor<horizonMs){
    let candidates=groups.filter(g=>g.id!==previousGroup).map(g=>({group:g,choice:choiceFor(g,cursor,true)})).filter(x=>x.choice);
    if(!candidates.length){
      candidates=groups.filter(g=>g.id!==previousGroup).map(g=>({group:g,choice:choiceFor(g,cursor,false)})).filter(x=>x.choice);
    }
    if(!candidates.length)throw Error('Не удалось продолжить ротацию');

    candidates.sort((a,b)=>(groupLast.get(a.group.id)-groupLast.get(b.group.id))||a.group.index-b.group.index);
    const {group,choice}=candidates[0], video=catalog.videos[choice.video];
    const startMs=cursor,endMs=startMs+video.durationSeconds*1000;
    const stamp=minskISO(startMs).slice(0,16).replace(/[-:T]/g,'');
    const premiere=!ever.has(choice.video);
    generated.push({
      id:`auto-${stamp}-${group.id}-${choice.video}`,
      video:choice.video,
      start:minskISO(startMs),
      end:minskISO(endMs),
      theme:group.label||group.value||group.id,
      rotationGroup:group.id,
      auto:true,
      ...(premiere?{premiere:true}:{})
    });

    if(group.type==='series')groupNext.set(group.id,(choice.index+1)%group.members.length);
    videoLast.set(choice.video,startMs);
    groupLast.set(group.id,startMs);
    ever.add(choice.video);
    previousGroup=group.id;

    const nextStart=slotAtOrAfter(endMs,slotMinutes);
    if(nextStart>endMs)addFiller(endMs,nextStart);
    cursor=nextStart;
  }
  return generated;
}

export function validate(catalog, schedule, now=Date.now(), fixed=null) {
  if (!catalog || !catalog.videos || Array.isArray(catalog.videos) || !schedule || !Array.isArray(schedule.programs)) throw Error('Некорректный формат данных');
  if (!Number.isInteger(catalog.version) || catalog.version < 1 || !Number.isInteger(schedule.catalogVersion) || schedule.catalogVersion < 1 || schedule.catalogVersion > catalog.version) throw Error('Версия программы новее каталога');

  for (const [id, v] of Object.entries(catalog.videos)) {
    if (!id || !v || typeof v.title !== 'string' || !v.title.trim() || !Number.isFinite(v.durationSeconds) || v.durationSeconds <= 0) throw Error('Некорректное видео: ' + id);
    if (v.live !== undefined && typeof v.live !== 'boolean') throw Error('Некорректный признак live: ' + id);
    const source = v.source;
    if (!(source?.type === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(source.videoId)) && !(source?.type === 'file' && safeURL(source.url))) throw Error('Некорректный источник: ' + id);
    for (const key of ['series','author','country','summary','category','year']) if (v[key] !== undefined && typeof v[key] !== 'string') throw Error('Некорректное поле ' + key + ': ' + id);
    if (v.episode !== undefined && (!Number.isInteger(v.episode) || v.episode < 1)) throw Error('Некорректный номер серии: ' + id);
    if (v.sourceUrl && !safeURL(v.sourceUrl)) throw Error('Некорректная ссылка: ' + id);
  }

  const ids=new Set();
  const normalize=p=>{
    const startMs=Date.parse(p.start),endMs=Date.parse(p.end),video=catalog.videos[p.video];
    if(typeof p.id!=='string'||!p.id||ids.has(p.id)||!video||!zoned.test(p.start)||!zoned.test(p.end)||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs||(!video.live&&(endMs-startMs)/1000>video.durationSeconds+1))throw Error('Некорректный показ: '+p.id);
    if(p.premiere!==undefined&&typeof p.premiere!=='boolean')throw Error('Некорректная отметка премьеры: '+p.id);
    ids.add(p.id);
    return {...p,startMs,endMs};
  };

  const explicit=schedule.programs.map(normalize).sort((a,b)=>a.startMs-b.startMs);
  const fixedPrograms=selectFixedPrograms(catalog,schedule,fixed,now).map(normalize).sort((a,b)=>a.startMs-b.startMs);
  const history=[...explicit,...fixedPrograms].sort((a,b)=>a.startMs-b.startMs);
  const generated=generateRotation(catalog,schedule,history,now).map(normalize);
  const programs=[...history,...generated].sort((a,b)=>a.startMs-b.startMs);
  for(let i=1;i<programs.length;i++)if(programs[i].startMs<programs[i-1].endMs)throw Error('Пересечение показов: '+programs[i-1].id+' / '+programs[i].id);
  return {catalog,programs};
}

export function protectStarted(previous, catalog, schedule, now=Date.now(), prepared=null) {
  if(!previous)return;
  const nextPrograms=prepared||validate(catalog,schedule,now).programs;
  const oldPrograms=previous.resolvedPrograms||validate(previous.catalog,previous.schedule,now).programs.map(stripRuntime);
  const next=new Map(nextPrograms.map(p=>[p.id,p]));
  for(const oldRaw of oldPrograms){
    const old={...oldRaw,startMs:Date.parse(oldRaw.start),endMs:Date.parse(oldRaw.end)};
    if(old.startMs>now)continue;
    const p=next.get(old.id);
    if(!p||p.start!==old.start||p.end!==old.end||p.video!==old.video)throw Error('Нельзя менять уже начавшийся показ: '+old.id);
    if(old.endMs>now&&JSON.stringify(previous.catalog.videos[old.video].source)!==JSON.stringify(catalog.videos[old.video]?.source))throw Error('Нельзя менять источник текущего показа');
  }
}

export function warnings(catalog, schedule, now=Date.now(), fixed=null) {
  const {programs}=validate(catalog,schedule,now,fixed),result=[];
  for(let i=1;i<programs.length;i++){
    const prev=programs[i-1],p=programs[i],a=catalog.videos[prev.video],b=catalog.videos[p.video];
    const gap=(p.startMs-prev.endMs)/1000;
    if(gap>0&&!p.auto){
      const length=[Math.floor(gap/3600)?Math.floor(gap/3600)+' ч.':'',Math.floor(gap/60)%60?Math.floor(gap/60)%60+' мин.':'',gap%60?Math.round(gap%60)+' сек.':''].filter(Boolean).join(' ');
      result.push({id:p.id,message:`Пауза перед «${b.title}»: ${length}`});
    }
    if(!p.auto&&a.series&&a.series===b.series&&a.episode&&b.episode&&b.episode!==a.episode+1&&b.episode!==1)result.push({id:p.id,message:`Порядок серий «${a.series}»: ${a.episode} → ${b.episode}. Проверьте, намеренно ли это.`});
  }
  return result;
}

export class BroadcastClock {
  constructor(){this.synced=false;}
  now(){return Date.now();}
  sync(){this.synced=false;}
}

export class Programme {
  constructor(clock={now:()=>Date.now()}){this.clock=clock;this.catalog=null;this.programs=[];this.raw=null;this.loading=false;this.warning='';this.rotation=null;this.fixed=null;}
  active(now=this.clock.now()){
    let lo=0,hi=this.programs.length-1,last=-1;
    while(lo<=hi){const mid=(lo+hi)>>1;if(this.programs[mid].startMs<=now){last=mid;lo=mid+1;}else hi=mid-1;}
    const p=this.programs[last];return p&&now<p.endMs?p:null;
  }
  next(now=this.clock.now(),count=4){return this.programs.filter(p=>p.startMs>now).slice(0,count);}
  video(p){return p?this.catalog.videos[p.video]:null;}
  bumperSeconds(){return Number.isFinite(this.rotation?.bumperSeconds)?this.rotation.bumperSeconds:8;}
  accept(catalog,schedule,protect=true,fixed=null){
    const now=this.clock.now(),next=validate(catalog,schedule,now,fixed);
    if(protect)protectStarted(this.raw,catalog,schedule,now,next.programs);
    this.catalog=next.catalog;this.programs=next.programs;this.rotation=schedule.rotation||null;this.fixed=fixed||null;
    this.raw={catalog,schedule,fixed,resolvedPrograms:next.programs.map(stripRuntime)};
  }
  async refresh(initial=false){
    if(this.loading)return !!this.raw;this.loading=true;
    try{
      const started=performance.now(),scheduleURL=new URL('../data/schedule.json',import.meta.url),catalogURL=new URL('../data/videos.json',import.meta.url),fixedURL=new URL('../data/fixed-schedule.json',import.meta.url);
      const stamp=String(Date.now());for(const url of [scheduleURL,catalogURL,fixedURL])url.searchParams.set('t',stamp);
      const [a,b,c]=await Promise.all([fetch(catalogURL,{cache:'no-store'}),fetch(scheduleURL,{cache:'no-store'}),fetch(fixedURL,{cache:'no-store'}).catch(()=>null)]);
      if(!a.ok||!b.ok)throw Error('Ошибка загрузки данных');
      const elapsed=performance.now()-started;
      const [catalog,schedule]=await Promise.all([a.json(),b.json()]);
      let fixed=null;
      if(c?.ok){try{fixed=await c.json();}catch{}}
      this.accept(catalog,schedule,true,fixed);this.clock.sync?.(b,elapsed);this.warning='';
      try{localStorage.setItem(CACHE,JSON.stringify({catalog,schedule,fixed}));}catch{}
      return true;
    }catch(e){
      this.warning=e.message;
      if(initial&&!this.raw){
        try{const cached=JSON.parse(localStorage.getItem(CACHE));if(cached)this.accept(cached.catalog,cached.schedule,false,cached.fixed||null);}catch{}
      }
      return !!this.raw;
    }finally{this.loading=false;}
  }
}
