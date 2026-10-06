export const $=id=>document.getElementById(id);
export const time=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Minsk',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export const date=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Minsk',day:'numeric',month:'long'});
export function el(tag,text,className){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;}
export function duration(seconds){const n=Math.max(0,Math.ceil(seconds));return `${Math.floor(n/3600)?Math.floor(n/3600)+':':''}${String(Math.floor(n/60)%60).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
