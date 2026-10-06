import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {validate,Programme,protectStarted,warnings,clone,BroadcastClock} from '../assets/schedule.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../data/videos.json',import.meta.url)));
const schedule=JSON.parse(fs.readFileSync(new URL('../data/schedule.json',import.meta.url)));
const instant=Date.parse('2026-10-06T21:25:00+03:00');
test('published broadcasts have valid boundaries, including gaps and end of season',()=>{
 const {programs}=validate(catalog,schedule),p=new Programme();p.accept(catalog,schedule,false);
 for(const show of programs){assert.equal(p.active(show.startMs)?.id,show.id);assert.equal(p.active(show.endMs-1)?.id,show.id);assert.notEqual(p.active(show.endMs)?.id,show.id);}
 assert.equal(p.active(programs.at(-1).endMs),null);assert.equal(p.active(Date.parse('2026-10-07T19:59:59+03:00')),null);
 assert.equal(p.next(instant)[0].video,'civilisation-12');
});
test('reject overlapping shows, missing videos and dates without explicit zone',()=>{
 let s=clone(schedule);s.programs[1].start=s.programs[0].start;assert.throws(()=>validate(catalog,s),/Пересечение|Некорректный/);
 s=clone(schedule);s.programs[0].video='missing';assert.throws(()=>validate(catalog,s));
 s=clone(schedule);s.programs[0].start='2026-10-06T12:30:00';assert.throws(()=>validate(catalog,s));
});
test('started broadcasts cannot be edited by changing edition; future programmes can change',()=>{
 const before={catalog,schedule};let s=clone(schedule);s.edition='new';s.programs[0].start='2026-10-06T12:29:59+03:00';assert.throws(()=>protectStarted(before,catalog,s,instant));
 s=clone(schedule);s.programs.at(-1).theme='New theme';assert.doesNotThrow(()=>protectStarted(before,catalog,s,instant));
 const c=clone(catalog);c.videos['civilisation-10'].source.videoId='aaaaaaaaaaa';assert.throws(()=>protectStarted(before,c,s,instant),/источник/);
});
test('validation rejection retains the previous working programme',()=>{
 const p=new Programme({now:()=>instant});p.accept(catalog,schedule);const old=p.raw;const s=clone(schedule);s.catalogVersion=-1;assert.throws(()=>p.accept(catalog,s));assert.equal(p.raw,old);
});
test('supports HTTPS video files and rejects executable or insecure URLs',()=>{
 const c=clone(catalog);c.videos.file={title:'Direct file',durationSeconds:60,source:{type:'file',url:'https://example.org/film.mp4'}};assert.doesNotThrow(()=>validate(c,schedule));
 for(const url of ['javascript:alert(1)','http://example.org/a.mp4','data:video/mp4;base64,AA']){c.videos.file.source.url=url;assert.throws(()=>validate(c,schedule));}
});
test('future season contains every episode in order over seven evenings',()=>{
 const shows=schedule.programs.filter(p=>p.repeat);assert.deepEqual(shows.map(p=>catalog.videos[p.video].episode),Array.from({length:13},(_,i)=>i+1));assert.equal(new Set(shows.map(p=>p.start.slice(0,10))).size,7);
});
test('flags the pre-existing episode order issue without rewriting history',()=>{
 const list=warnings(catalog,schedule);assert.ok(list.some(p=>p.message.includes('9 → 11')));assert.ok(list.some(p=>p.message.includes('11 → 10')));
});
test('clock follows the browser clock and ignores server time offsets',()=>{
 const c=new BroadcastClock(),before=Date.now();const response={headers:new Headers({date:'Tue, 06 Oct 2026 18:30:00 GMT',age:'120'})};c.sync(response,100);const now=c.now();assert.ok(now>=before&&now<=Date.now()+5);assert.equal(c.synced,false);
});
