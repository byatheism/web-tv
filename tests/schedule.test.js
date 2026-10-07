import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validate,Programme,protectStarted,warnings,clone,BroadcastClock,generateRotation} from '../assets/schedule.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../data/videos.json',import.meta.url)));
const schedule=JSON.parse(fs.readFileSync(new URL('../data/schedule.json',import.meta.url)));
const fixed=JSON.parse(fs.readFileSync(new URL('../data/fixed-schedule.json',import.meta.url)));
const instant=Date.parse('2026-10-06T21:25:00+03:00');
const rotationNow=Date.parse('2026-10-07T12:03:00+03:00');

test('catalogue contains documentary material only and all new videos',()=>{
 assert.equal(Object.values(catalog.videos).some(v=>v.category==='Музыка'),false);
 assert.equal(Object.keys(catalog.videos).length,42);
 for(const id of ['bbc-black-death','bbc-changing-planet','bbc-space-brian-cox','bbc-wonderful-seasons','bbc-dinosaur-extinction','bbc-sun','bbc-largest-dinosaur','bbc-death-doula','bbc-returning-gods','bbc-sea-dragon','bbc-birds-of-paradise','bbc-egg','bbc-pompeii','bbc-911','bbc-tutankhamun','natgeo-earth-biography','natgeo-edge-universe','earth-bbc-01','earth-bbc-02','earth-bbc-03','earth-bbc-04','earth-bbc-05','loneliness-in-space','ashes-to-ashes-kcd2']) assert.ok(catalog.videos[id],id);
});


test('fixed programme covers several days and is compatible with the catalogue',()=>{
 assert.equal(fixed.catalogVersion,catalog.version);
 assert.equal(fixed.scheduleVersion,schedule.version);
 assert.deepEqual(fixed.catalogIds,Object.keys(catalog.videos).sort());
 assert.ok(Date.parse(fixed.freezeUntil)-Date.parse(fixed.generatedAt)>=71*3600000);
 assert.ok(fixed.programs.length>40);
 const at=Date.parse(fixed.generatedAt);
 const future=fixed.programs.find(p=>Date.parse(p.start)>at);
 assert.ok(future);
 const resolved=validate(catalog,schedule,at,fixed).programs.find(p=>p.id===future.id);
 assert.equal(resolved?.start,future.start);
});

test('catalogue additions invalidate only unstarted fixed future',()=>{
 const at=Date.parse(fixed.generatedAt);
 const current=fixed.programs.find(p=>Date.parse(p.start)<=at&&Date.parse(p.end)>at);
 const future=fixed.programs.find(p=>Date.parse(p.start)>at+3600000);
 const c=clone(catalog);
 c.videos['test-new-documentary']={title:'Новый документальный фильм',durationSeconds:3000,source:{type:'youtube',videoId:'aaaaaaaaaaa'},category:'Документальные фильмы'};
 const resolved=validate(c,schedule,at,fixed).programs;
 if(current)assert.ok(resolved.some(p=>p.id===current.id&&p.start===current.start));
 if(future)assert.ok(resolved.some(p=>p.startMs>Date.parse(current?.end||new Date(at).toISOString())));
});

test('published broadcasts have valid boundaries, including gaps and generated future',()=>{
 const {programs}=validate(catalog,schedule,rotationNow),p=new Programme({now:()=>rotationNow});p.accept(catalog,schedule,false);
 for(const show of programs){assert.equal(p.active(show.startMs)?.id,show.id);assert.equal(p.active(show.endMs-1)?.id,show.id);assert.notEqual(p.active(show.endMs)?.id,show.id);}
 assert.equal(p.active(programs.at(-1).endMs),null);
 assert.equal(p.active(Date.parse('2026-10-06T23:31:20+03:00')),null);
 assert.equal(p.next(instant)[0].video,'civilisation-12');
});

test('reject overlapping shows, missing videos and dates without explicit zone',()=>{
 let s=clone(schedule);s.programs[1].start=s.programs[0].start;assert.throws(()=>validate(catalog,s,rotationNow),/Пересечение|Некорректный/);
 s=clone(schedule);s.programs[0].video='missing';assert.throws(()=>validate(catalog,s,rotationNow));
 s=clone(schedule);s.programs[0].start='2026-10-06T12:30:00';assert.throws(()=>validate(catalog,s,rotationNow));
});

test('started broadcasts cannot be edited while future rotation can change',()=>{
 const before={catalog,schedule,resolvedPrograms:validate(catalog,schedule,rotationNow).programs};let s=clone(schedule);s.edition='new';s.programs[0].start='2026-10-06T12:29:59+03:00';assert.throws(()=>protectStarted(before,catalog,s,rotationNow));
 s=clone(schedule);s.rotation.bumperSeconds=6;assert.doesNotThrow(()=>protectStarted(before,catalog,s,rotationNow));
 const c=clone(catalog);c.videos['civilisation-07'].source.videoId='aaaaaaaaaaa';assert.throws(()=>protectStarted(before,c,s,rotationNow),/источник/);
});

test('validation rejection retains the previous working programme',()=>{
 const p=new Programme({now:()=>rotationNow});p.accept(catalog,schedule);const old=p.raw;const s=clone(schedule);s.catalogVersion=-1;assert.throws(()=>p.accept(catalog,s));assert.equal(p.raw,old);
});

test('supports HTTPS video files and rejects executable or insecure URLs',()=>{
 const c=clone(catalog);c.videos.file={title:'Direct file',durationSeconds:60,source:{type:'file',url:'https://example.org/film.mp4'}};assert.doesNotThrow(()=>validate(c,schedule,rotationNow));
 for(const url of ['javascript:alert(1)','http://example.org/a.mp4','data:video/mp4;base64,AA']){c.videos.file.source.url=url;assert.throws(()=>validate(c,schedule,rotationNow));}
});

test('automatic composer rotates four documentary directions and rounds starts',()=>{
 const {programs}=validate(catalog,schedule,rotationNow),shows=programs.filter(p=>p.auto);
 assert.ok(shows.length>40);
 assert.deepEqual(shows.slice(0,8).map(p=>p.rotationGroup),['documentaries','earth','civilisation','voyages','documentaries','earth','civilisation','voyages']);
 assert.deepEqual(shows.slice(0,8).map(p=>p.video),['bbc-black-death','earth-bbc-01','civilisation-08','voyages-discovery-04','bbc-changing-planet','earth-bbc-02','civilisation-09','voyages-discovery-05']);
 assert.equal(shows[0].start,'2026-10-07T13:35:00.000+03:00');
 for(let i=0;i<shows.length;i++){
   const local=new Date(shows[i].startMs+3*3600000);
   assert.equal(local.getUTCMinutes()%5,0);
   assert.equal(local.getUTCSeconds(),0);
   if(i>0){
     assert.notEqual(shows[i].rotationGroup,shows[i-1].rotationGroup);
     assert.ok(shows[i].startMs>shows[i-1].endMs);
   }
 }
});

test('Earth BBC airs in episode order',()=>{
 const shows=validate(catalog,schedule,rotationNow).programs.filter(p=>p.auto&&p.rotationGroup==='earth').slice(0,5);
 assert.deepEqual(shows.map(p=>catalog.videos[p.video].episode),[1,2,3,4,5]);
});

test('one-off documentaries are all shown before the first one repeats',()=>{
 const shows=validate(catalog,schedule,rotationNow).programs.filter(p=>p.auto&&p.rotationGroup==='documentaries');
 const firstRepeat=shows.findIndex((p,i)=>shows.slice(0,i).some(x=>x.video===p.video));
 assert.ok(firstRepeat>=19);
 assert.equal(new Set(shows.slice(0,19).map(p=>p.video)).size,19);
});

test('new material is marked premiere only on first airing',()=>{
 const shows=validate(catalog,schedule,rotationNow).programs.filter(p=>p.auto);
 assert.equal(shows.find(p=>p.video==='bbc-black-death').premiere,true);
 assert.equal(shows.find(p=>p.video==='earth-bbc-01').premiere,true);
 assert.equal(shows.find(p=>p.video==='civilisation-08').premiere,undefined);
 const second=shows.filter(p=>p.video==='earth-bbc-01')[1];assert.ok(second);assert.equal(second.premiere,undefined);
});

test('repeat protection keeps the same video at least eight hours apart',()=>{
 const shows=validate(catalog,schedule,rotationNow).programs.filter(p=>p.auto),last=new Map();
 for(const p of shows){
   if(last.has(p.video))assert.ok(p.startMs-last.get(p.video)>=8*3600000,`${p.video} repeated too soon`);
   last.set(p.video,p.startMs);
 }
});

test('rotation helper is deterministic for the same instant',()=>{
 const explicit=validate(catalog,{...schedule,rotation:{...schedule.rotation,enabled:false}},rotationNow).programs;
 assert.deepEqual(generateRotation(catalog,schedule,explicit,rotationNow),generateRotation(catalog,schedule,explicit,rotationNow));
});

test('flags the pre-existing episode order issue without rewriting history',()=>{
 const list=warnings(catalog,schedule,rotationNow);assert.ok(list.some(p=>p.message.includes('9 → 11')));assert.ok(list.some(p=>p.message.includes('11 → 10')));
});

test('clock follows the browser clock and ignores server time offsets',()=>{
 const c=new BroadcastClock(),before=Date.now();const response={headers:new Headers({date:'Tue, 06 Oct 2026 18:30:00 GMT',age:'120'})};c.sync(response,100);const now=c.now();assert.ok(now>=before&&now<=Date.now()+5);assert.equal(c.synced,false);
});
