import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validate,Programme,protectStarted,warnings,clone,BroadcastClock,generateRotation} from '../assets/schedule.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../data/videos.json',import.meta.url)));
const schedule=JSON.parse(fs.readFileSync(new URL('../data/schedule.json',import.meta.url)));
const instant=Date.parse('2026-10-06T21:25:00+03:00');
const rotationNow=Date.parse('2026-10-07T10:55:49+03:00');

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

test('started broadcasts cannot be edited by changing edition; future rotation can change',()=>{
 const before={catalog,schedule};let s=clone(schedule);s.edition='new';s.programs[0].start='2026-10-06T12:29:59+03:00';assert.throws(()=>protectStarted(before,catalog,s,rotationNow));
 s=clone(schedule);s.rotation.bumperSeconds=6;assert.doesNotThrow(()=>protectStarted(before,catalog,s,rotationNow));
 const c=clone(catalog);c.videos['voyages-discovery-02'].source.videoId='aaaaaaaaaaa';assert.throws(()=>protectStarted(before,c,s,rotationNow),/источник/);
});

test('validation rejection retains the previous working programme',()=>{
 const p=new Programme({now:()=>rotationNow});p.accept(catalog,schedule);const old=p.raw;const s=clone(schedule);s.catalogVersion=-1;assert.throws(()=>p.accept(catalog,s));assert.equal(p.raw,old);
});

test('supports HTTPS video files and rejects executable or insecure URLs',()=>{
 const c=clone(catalog);c.videos.file={title:'Direct file',durationSeconds:60,source:{type:'file',url:'https://example.org/film.mp4'}};assert.doesNotThrow(()=>validate(c,schedule,rotationNow));
 for(const url of ['javascript:alert(1)','http://example.org/a.mp4','data:video/mp4;base64,AA']){c.videos.file.source.url=url;assert.throws(()=>validate(c,schedule,rotationNow));}
});

test('automatic composer rotates groups, rounds starts and preserves series order',()=>{
 const {programs}=validate(catalog,schedule,rotationNow),shows=programs.filter(p=>p.auto);
 assert.ok(shows.length>50);
 assert.deepEqual(shows.slice(0,6).map(p=>p.rotationGroup),['music','civilisation','voyages','music','civilisation','voyages']);
 assert.deepEqual(shows.slice(0,6).map(p=>p.video),['nofx-1998','civilisation-07','voyages-discovery-03','chuck-1965','civilisation-08','voyages-discovery-04']);
 assert.equal(shows[0].start,'2026-10-07T11:45:00.000+03:00');
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

test('premieres mark only first-ever site airing of a video',()=>{
 const shows=validate(catalog,schedule,rotationNow).programs.filter(p=>p.auto);
 assert.equal(shows[0].video,'nofx-1998');assert.equal(shows[0].premiere,true);
 assert.equal(shows.find(p=>p.video==='civilisation-07').premiere,undefined);
 const secondNofx=shows.filter(p=>p.video==='nofx-1998')[1];assert.ok(secondNofx);assert.equal(secondNofx.premiere,undefined);
});

test('repeat protection keeps the same video at least twelve hours apart',()=>{
 const shows=validate(catalog,schedule,rotationNow).programs.filter(p=>p.auto),last=new Map();
 for(const p of shows){
   if(last.has(p.video))assert.ok(p.startMs-last.get(p.video)>=12*3600000,`${p.video} repeated too soon`);
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
