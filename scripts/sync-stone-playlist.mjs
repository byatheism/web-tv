// Sync new Stone Simulator recordings from the playlist into the broadcast catalogue.
// Requires yt-dlp on PATH; GitHub Actions installs it before running this script.
import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {mergeStonePlaylist} from './stone-playlist.js';

const catalogPath=new URL('../data/videos.json',import.meta.url);
const schedulePath=new URL('../data/schedule.json',import.meta.url);
const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
const schedule=JSON.parse(readFileSync(schedulePath,'utf8'));
const id=schedule.rotation?.stone?.playlistId;
if(!/^[A-Za-z0-9_-]{12,50}$/.test(id||''))throw Error('Missing Stone Simulator playlist ID');

const call=spawnSync('yt-dlp',[
  '--flat-playlist','--dump-single-json','--no-warnings',
  '--socket-timeout','25',`https://www.youtube.com/playlist?list=${id}`
],{encoding:'utf8',maxBuffer:12*1024*1024,timeout:120000});
if(call.error||call.status!==0)throw Error('YouTube playlist unavailable: '+(call.error?.message||call.stderr||call.status));
const data=JSON.parse(call.stdout);
const entries=data.entries||[];
const {found,changed}=mergeStonePlaylist(catalog,entries);
if(changed){
  catalog.version++;
  writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');
}
console.log(JSON.stringify({playlist:id,found,changed,catalogVersion:catalog.version}));
