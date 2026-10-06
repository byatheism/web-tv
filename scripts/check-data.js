import fs from 'node:fs';
import {validate,warnings} from '../assets/schedule.js';
const catalog=JSON.parse(fs.readFileSync(new URL('../data/videos.json',import.meta.url))),schedule=JSON.parse(fs.readFileSync(new URL('../data/schedule.json',import.meta.url)));
const result=validate(catalog,schedule);
console.log(`OK: ${Object.keys(catalog.videos).length} videos, ${result.programs.length} broadcasts`);
for(const warning of warnings(catalog,schedule))console.log('NOTICE: '+warning.message);
