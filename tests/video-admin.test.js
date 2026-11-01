import test from 'node:test';
import assert from 'node:assert/strict';
import {parseYouTubeUrl,addVideosToCatalog} from '../scripts/video-admin.js';

const sample=id=>({id,title:'Видео '+id,author:'Автор',duration:3600});
const fresh=()=>({version:12,videos:{
  old:{title:'Уже в эфире',durationSeconds:2400,source:{type:'youtube',videoId:'AAAAAAAAAAA'},category:'Документальные фильмы'},
  second:{title:'Первая серия',durationSeconds:2400,source:{type:'youtube',videoId:'BBBBBBBBBBB'},category:'Игровые истории',series:'Игра',episode:1}
}});

test('admin accepts only canonical YouTube watch and playlist links',()=>{
 assert.deepEqual(parseYouTubeUrl('https://youtu.be/CCCCCCCCCCC?t=5','video'),{kind:'video',id:'CCCCCCCCCCC',url:'https://www.youtube.com/watch?v=CCCCCCCCCCC'});
 assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=CCCCCCCCCCC&list=PL123456789ABCDE','video'),{kind:'video',id:'CCCCCCCCCCC',url:'https://www.youtube.com/watch?v=CCCCCCCCCCC'});
 assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/playlist?list=PLCvU3DgR5rsE','playlist'),{kind:'playlist',id:'PLCvU3DgR5rsE',url:'https://www.youtube.com/playlist?list=PLCvU3DgR5rsE'});
 for(const url of [
   'http://www.youtube.com/watch?v=CCCCCCCCCCC',
   'https://youtube.com.evil.test/watch?v=CCCCCCCCCCC',
   'https://www.youtube.com@evil.test/watch?v=CCCCCCCCCCC',
   'https://www.youtube.com:9443/watch?v=CCCCCCCCCCC',
   'file:///watch?v=CCCCCCCCCCC',
   'https://evil.test/video',
   'https://www.youtube.com/watch?v=$(touch%20/tmp/unsafe)'
 ])assert.throws(()=>parseYouTubeUrl(url,'video'));
 assert.throws(()=>parseYouTubeUrl('https://youtu.be/CCCCCCCCCCC','playlist'));
});

test('admin imports a single documentary with source-bound metadata',()=>{
 const c=fresh();
 const r=addVideosToCatalog(c,[sample('CCCCCCCCCCC')],{kind:'video',mediaType:'documentary'});
 assert.equal(r.added.length,1);
 assert.equal(c.version,13);
 assert.equal(c.videos['yt-CCCCCCCCCCC'].category,'Документальные фильмы');
 assert.equal(c.videos['yt-CCCCCCCCCCC'].durationSeconds,3600);
 assert.deepEqual(c.videos['yt-CCCCCCCCCCC'].source,{type:'youtube',videoId:'CCCCCCCCCCC'});
 assert.equal(c.videos['yt-CCCCCCCCCCC'].premiere,undefined);
});

test('admin extends an existing game series and skips already imported playlist entries',()=>{
 const c=fresh();
 const playlist=[
  sample('BBBBBBBBBBB'),sample('DDDDDDDDDDD'),sample('EEEEEEEEEEE')
 ];
 const r=addVideosToCatalog(c,playlist,{kind:'playlist',mediaType:'game',series:'Игра'});
 assert.deepEqual([r.added.length,r.skipped],[2,1]);
 assert.equal(c.videos['yt-DDDDDDDDDDD'].episode,2);
 assert.equal(c.videos['yt-EEEEEEEEEEE'].episode,3);
 assert.equal(c.videos['yt-DDDDDDDDDDD'].series,'Игра');
});

test('admin keeps stone video in intermissions and marks webcams live',()=>{
 const stone=fresh();
 addVideosToCatalog(stone,[sample('FFFFFFFFFFF')],{kind:'video',mediaType:'stone'});
 assert.deepEqual({category:stone.videos['stone-FFFFFFFFFFF'].category,series:stone.videos['stone-FFFFFFFFFFF'].series},
  {category:'Stone Simulator',series:'Stone Simulator'});
 const cam=fresh();
 addVideosToCatalog(cam,[{id:'GGGGGGGGGGG',title:'Камера',duration:0}],{kind:'video',mediaType:'webcam'});
 assert.equal(cam.videos['cam-GGGGGGGGGGG'].live,true);
 assert.equal(cam.videos['cam-GGGGGGGGGGG'].durationSeconds,86400);
});

test('admin blocks duplicates, invalid metadata and wrong categories without changing the original',()=>{
 const c=fresh(),copy=JSON.stringify(c);
 assert.throws(()=>addVideosToCatalog(c,[sample('AAAAAAAAAAA')],{kind:'video',mediaType:'documentary'}),/уже есть/);
 assert.equal(JSON.stringify(c),copy);
 assert.throws(()=>addVideosToCatalog(fresh(),[{id:'IIIIIIIIIII',title:'Пустая длительность'}],{kind:'video'}),/длительности/);
 assert.throws(()=>addVideosToCatalog(fresh(),[sample('IIIIIIIIIII')],{kind:'video',mediaType:'not-a-category'}));
 assert.throws(()=>addVideosToCatalog(fresh(),[sample('IIIIIIIIIII')],{kind:'playlist',mediaType:'game'}),/название сериала/);
 assert.throws(()=>addVideosToCatalog(fresh(),[sample('IIIIIIIIIII')],{kind:'playlist',mediaType:'webcam'}),/по одной/);
 assert.throws(()=>addVideosToCatalog(fresh(),[sample('IIIIIIIIIII')],{kind:'video',mediaType:'game',series:'Игра',episode:'hack'}),/Номер серии/);
});

test('admin accepts a manually supplied duration only for one video and validates its range',()=>{
 const c=fresh();
 addVideosToCatalog(c,[{id:'HHHHHHHHHHH',title:'Неизвестная длительность'}],{kind:'video',mediaType:'game',durationSeconds:'1234'});
 assert.equal(c.videos['yt-HHHHHHHHHHH'].durationSeconds,1234);
 assert.throws(()=>addVideosToCatalog(fresh(),[sample('JJJJJJJJJJJ')],{kind:'playlist',mediaType:'game',series:'Игра',durationSeconds:'300'}),/только для одного/);
 assert.throws(()=>addVideosToCatalog(fresh(),[sample('JJJJJJJJJJJ')],{kind:'video',mediaType:'game',durationSeconds:'-2'}),/Длительность/);
});
