const CACHE = 'web-tv:programme';
const zoned = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
export const clone = value => JSON.parse(JSON.stringify(value));
export function safeURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' ? url.href : null; } catch { return null; }
}
export function validate(catalog, schedule) {
  if (!catalog || !catalog.videos || Array.isArray(catalog.videos) || !schedule || !Array.isArray(schedule.programs)) throw Error('Некорректный формат данных');
  if (!Number.isInteger(catalog.version) || catalog.version < 1 || schedule.catalogVersion !== catalog.version) throw Error('Версии каталога и программы не совпадают');
  for (const [id, v] of Object.entries(catalog.videos)) {
    if (!id || !v || typeof v.title !== 'string' || !v.title.trim() || !Number.isFinite(v.durationSeconds) || v.durationSeconds <= 0) throw Error('Некорректное видео: ' + id);
    const source = v.source;
    if (!(source?.type === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(source.videoId)) && !(source?.type === 'file' && safeURL(source.url))) throw Error('Некорректный источник: ' + id);
    for (const key of ['series','author','country','summary','category','year']) if (v[key] !== undefined && typeof v[key] !== 'string') throw Error('Некорректное поле ' + key + ': ' + id);
    if (v.episode !== undefined && (!Number.isInteger(v.episode) || v.episode < 1)) throw Error('Некорректный номер серии: ' + id);
    if (v.sourceUrl && !safeURL(v.sourceUrl)) throw Error('Некорректная ссылка: ' + id);
  }
  const ids = new Set();
  const programs = schedule.programs.map(p => {
    const startMs = Date.parse(p.start), endMs = Date.parse(p.end), video = catalog.videos[p.video];
    if (typeof p.id !== 'string' || !p.id || ids.has(p.id) || !video || !zoned.test(p.start) || !zoned.test(p.end) || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || (endMs-startMs)/1000 > video.durationSeconds + 1) throw Error('Некорректный показ: ' + p.id);
    ids.add(p.id); return {...p, startMs, endMs};
  }).sort((a,b) => a.startMs-b.startMs);
  for (let i=1; i<programs.length; i++) if (programs[i].startMs < programs[i-1].endMs) throw Error('Пересечение показов: ' + programs[i-1].id + ' / ' + programs[i].id);
  return {catalog, programs};
}
export function protectStarted(previous, catalog, schedule, now=Date.now()) {
  if (!previous) return;
  const next = new Map(schedule.programs.map(p => [p.id,p]));
  for (const old of previous.schedule.programs) {
    if (Date.parse(old.start) > now) continue;
    const p = next.get(old.id);
    if (!p || p.start !== old.start || p.end !== old.end || p.video !== old.video) throw Error('Нельзя менять уже начавшийся показ: ' + old.id);
    if (Date.parse(old.end) > now && JSON.stringify(previous.catalog.videos[old.video].source) !== JSON.stringify(catalog.videos[old.video]?.source)) throw Error('Нельзя менять источник текущего показа');
  }
}
export function warnings(catalog, schedule) {
  const {programs} = validate(catalog,schedule), result=[];
  for(let i=1;i<programs.length;i++) {
    const prev=programs[i-1], p=programs[i], a=catalog.videos[prev.video], b=catalog.videos[p.video];
    const gap=(p.startMs-prev.endMs)/1000;
    if(gap>0){const length=[Math.floor(gap/3600)?Math.floor(gap/3600)+' ч.':'',Math.floor(gap/60)%60?Math.floor(gap/60)%60+' мин.':'',gap%60?Math.round(gap%60)+' сек.':''].filter(Boolean).join(' ');result.push({id:p.id, message:`Пауза перед «${b.title}»: ${length}`});}
    if(a.series && a.series===b.series && a.episode && b.episode && b.episode!==a.episode+1 && b.episode!==1) result.push({id:p.id, message:`Порядок серий «${a.series}»: ${a.episode} → ${b.episode}. Проверьте, намеренно ли это.`});
  }
  return result;
}
export class BroadcastClock {
  constructor(){this.synced=false;}
  now(){return Date.now();}
  sync(){this.synced=false;}
}
export class Programme {
  constructor(clock={now:()=>Date.now()}){this.clock=clock;this.catalog=null;this.programs=[];this.raw=null;this.loading=false;this.warning='';}
  active(now=this.clock.now()){
    let lo=0,hi=this.programs.length-1,last=-1;
    while(lo<=hi){const mid=(lo+hi)>>1;if(this.programs[mid].startMs<=now){last=mid;lo=mid+1;}else hi=mid-1;}
    const p=this.programs[last];return p&&now<p.endMs?p:null;
  }
  next(now=this.clock.now(),count=4){return this.programs.filter(p=>p.startMs>now).slice(0,count);}
  video(p){return p?this.catalog.videos[p.video]:null;}
  accept(catalog,schedule,protect=true){
    const next=validate(catalog,schedule);
    if(protect)protectStarted(this.raw,catalog,schedule,this.clock.now());
    this.catalog=next.catalog;this.programs=next.programs;this.raw={catalog,schedule};
  }
  async refresh(initial=false){
    if(this.loading)return !!this.raw;this.loading=true;
    try{
      const started=performance.now(), scheduleURL=new URL('../data/schedule.json',import.meta.url), catalogURL=new URL('../data/videos.json',import.meta.url);
      const stamp=String(Date.now());scheduleURL.searchParams.set('t',stamp);catalogURL.searchParams.set('t',stamp);
      const [a,b]=await Promise.all([fetch(catalogURL,{cache:'no-store'}),fetch(scheduleURL,{cache:'no-store'})]);
      if(!a.ok||!b.ok)throw Error('Ошибка загрузки данных');
      const elapsed=performance.now()-started;
      const [catalog,schedule]=await Promise.all([a.json(),b.json()]);
      this.accept(catalog,schedule);this.clock.sync?.(b,elapsed);this.warning='';
      try{localStorage.setItem(CACHE,JSON.stringify(this.raw));}catch{}
      return true;
    }catch(e){
      this.warning=e.message;
      if(initial&&!this.raw){try{const cached=JSON.parse(localStorage.getItem(CACHE));if(cached)this.accept(cached.catalog,cached.schedule,false);}catch{}}
      return !!this.raw;
    }finally{this.loading=false;}
  }
}
