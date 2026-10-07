import fs from 'node:fs';
import {validate,warnings} from '../assets/schedule.js';

const catalog=JSON.parse(fs.readFileSync(new URL('../data/videos.json',import.meta.url)));
const schedule=JSON.parse(fs.readFileSync(new URL('../data/schedule.json',import.meta.url)));
let fixed=null;
try{fixed=JSON.parse(fs.readFileSync(new URL('../data/fixed-schedule.json',import.meta.url)));}catch{}

const result=validate(catalog,schedule,Date.now(),fixed);
const fixedCount=fixed?.programs?.length||0;
console.log(`OK: ${Object.keys(catalog.videos).length} videos, ${result.programs.length} broadcasts (${fixedCount} fixed)`);
for(const warning of warnings(catalog,schedule,Date.now(),fixed))console.log('NOTICE: '+warning.message);
