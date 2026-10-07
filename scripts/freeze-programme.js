// Rolling fixed programme for hourly documentaries and webcam fillers.
import fs from 'node:fs';
import {validate} from '../assets/schedule.js';

const root=new URL('../',import.meta.url);
const read=name=>JSON.parse(fs.readFileSync(new URL(name,root),'utf8'));
const catalog=read('data/videos.json');
const schedule=read('data/schedule.json');
const fixedURL=new URL('data/fixed-schedule.json',root);
let existing=null;
try{existing=JSON.parse(fs.readFileSync(fixedURL,'utf8'));}catch{}

const now=Date.now();
const freezeDays=Number.isFinite(schedule.rotation?.freezeDays)?Math.max(1,schedule.rotation.freezeDays):3;
const freezeUntil=now+freezeDays*86400000;
const resolved=validate(catalog,schedule,now,existing);

const programs=resolved.programs
  .filter(p=>p.auto&&p.startMs<=freezeUntil)
  .map(({startMs,endMs,...p})=>p);

const fixed={
  version:1,
  generatedAt:new Date(now).toISOString(),
  freezeUntil:new Date(freezeUntil).toISOString(),
  catalogVersion:catalog.version,
  scheduleVersion:schedule.version,
  sourceEdition:schedule.edition,
  catalogIds:Object.keys(catalog.videos).sort(),
  programs
};

const next=JSON.stringify(fixed,null,2)+'\n';
let previous='';
try{previous=fs.readFileSync(fixedURL,'utf8');}catch{}
if(previous!==next){
  fs.writeFileSync(fixedURL,next);
  console.log(`Updated fixed programme: ${programs.length} generated broadcasts through ${fixed.freezeUntil}`);
}else{
  console.log('Fixed programme is already current');
}
