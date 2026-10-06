const CACHE='web-tv:programme';
export function validate(catalog,schedule){
 if(!catalog||!catalog.videos||!schedule||!Array.isArray(schedule.programs))throw Error('Некорректный формат данных');
 if(schedule.edition!==undefined&&(typeof schedule.edition!=='string'||!schedule.edition))throw Error('Некорректная редакция программы');
 if(schedule.catalogVersion!==catalog.version)throw Error('Версии каталога и программы не совпадают');
 for(const [id,v] of Object.entries(catalog.videos)){if(!id||typeof v.title!=='string'||!Number.isFinite(v.durationSeconds)||v.durationSeconds<=0||v.source?.type!=='youtube'||!/^[A-Za-z0-9_-]{11}$/.test(v.source.videoId))throw Error('Некорректное видео: '+id);}
 const ids=new Set();const programs=schedule.programs.map(p=>{const startMs=Date.parse(p.start),endMs=Date.parse(p.end),video=catalog.videos[p.video];if(typeof p.id!=='string'||ids.has(p.id)||!video||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs||(endMs-startMs)/1000>video.durationSeconds+1)throw Error('Некорректный показ: '+p.id);ids.add(p.id);return {...p,startMs,endMs};}).sort((a,b)=>a.startMs-b.startMs);
 for(let i=1;i<programs.length;i++)if(programs[i].startMs<programs[i-1].endMs)throw Error('Пересечение показов');
 return {catalog,programs};
}
export class Programme{
 constructor(){this.catalog=null;this.programs=[];this.raw=null;this.loading=false;this.warning='';}
 active(now=Date.now()){let lo=0,hi=this.programs.length-1,last=-1;while(lo<=hi){const mid=(lo+hi)>>1;if(this.programs[mid].startMs<=now){last=mid;lo=mid+1;}else hi=mid-1;}const p=this.programs[last];return p&&now<p.endMs?p:null;}
 next(now=Date.now(),count=4){return this.programs.filter(p=>p.startMs>now).slice(0,count);}
 video(p){return p?this.catalog.videos[p.video]:null;}
 accept(catalog,schedule,protect=true){const next=validate(catalog,schedule);if(protect&&this.raw&&this.raw.schedule.edition===schedule.edition){const now=Date.now(),byId=new Map(next.programs.map(p=>[p.id,p]));for(const old of this.programs){if(old.startMs>now)continue;const p=byId.get(old.id);if(!p||p.startMs!==old.startMs||p.endMs!==old.endMs||p.video!==old.video)throw Error('Нельзя менять уже начавшийся показ: '+old.id);}const active=this.active(now);if(active&&JSON.stringify(this.catalog.videos[active.video].source)!==JSON.stringify(catalog.videos[active.video].source))throw Error('Нельзя менять источник текущего показа');}this.catalog=next.catalog;this.programs=next.programs;this.raw={catalog,schedule};}
 async refresh(initial=false){if(this.loading)return !!this.raw;this.loading=true;try{const [a,b]=await Promise.all([fetch(new URL('../data/videos.json',import.meta.url),{cache:'no-cache'}),fetch(new URL('../data/schedule.json',import.meta.url),{cache:'no-cache'})]);if(!a.ok||!b.ok)throw Error('Ошибка загрузки данных');const [catalog,schedule]=await Promise.all([a.json(),b.json()]);this.accept(catalog,schedule);this.warning='';try{localStorage.setItem(CACHE,JSON.stringify(this.raw));}catch(e){}return true;}catch(e){this.warning=e.message;if(initial&&!this.raw){try{const cached=JSON.parse(localStorage.getItem(CACHE));if(cached)this.accept(cached.catalog,cached.schedule,false);}catch(ignore){}}return !!this.raw;}finally{this.loading=false;}}
}
