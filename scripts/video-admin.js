// Restricted, deterministic catalogue mutations for manually approved DOC TV imports.
// No untrusted input is ever interpreted as code, a pathname or a shell command.
const VIDEO_ID=/^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID=/^[A-Za-z0-9_-]{12,64}$/;
const CATEGORIES={
  documentary:'Документальные фильмы',
  game:'Игровые истории',
  webcam:'Веб-камеры',
  stone:'Stone Simulator'
};
const clean=(x,max=180)=>String(x??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max).trim();

export function parseYouTubeUrl(raw,kind){
  if(typeof raw!=='string'||raw.length>400)throw Error('Вставьте ссылку YouTube длиной до 400 символов');
  let url;
  try{url=new URL(raw.trim());}catch{throw Error('Нужна полная ссылка https:// на YouTube');}
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.hash)
    throw Error('Недопустимый формат ссылки YouTube');
  const host=url.hostname.toLowerCase();
  if(!['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(host))
    throw Error('Разрешены только прямые ссылки youtube.com и youtu.be');
  if(!['video','playlist'].includes(kind))throw Error('Неизвестный тип ссылки');
  if(kind==='playlist'){
    if(host==='youtu.be')throw Error('Для плейлиста нужна ссылка youtube.com/playlist?list=...');
    if(!['/playlist','/watch'].includes(url.pathname))throw Error('Недопустимый адрес плейлиста');
    const id=url.searchParams.get('list');
    if(!PLAYLIST_ID.test(id||''))throw Error('Не найден корректный идентификатор плейлиста');
    return {kind,id,url:'https://www.youtube.com/playlist?list='+id};
  }
  let id='';
  if(host==='youtu.be')id=url.pathname.slice(1);
  else if(url.pathname==='/watch')id=url.searchParams.get('v')||'';
  else if(/^\/(shorts|live|embed)\/[^/]+$/.test(url.pathname))id=url.pathname.split('/')[2];
  if(!VIDEO_ID.test(id))throw Error('Не найден корректный 11-символьный ID YouTube');
  return {kind,id,url:'https://www.youtube.com/watch?v='+id};
}

export function addVideosToCatalog(catalog,entries,{kind='video',mediaType='documentary',series='',episode='',title='',durationSeconds=''}={}){
  if(!catalog?.videos||Array.isArray(catalog.videos)||!Number.isInteger(catalog.version))
    throw Error('Повреждён каталог DOC TV');
  if(!Object.hasOwn(CATEGORIES,mediaType))throw Error('Недопустимая категория видео');
  if(!['video','playlist'].includes(kind))throw Error('Неизвестный режим импорта');
  if(!Array.isArray(entries)||!entries.length||entries.length>60)throw Error('Число роликов должно быть от 1 до 60');
  if(kind==='video'&&entries.length!==1)throw Error('Для одного ролика нужна одна запись');
  if(mediaType==='webcam'&&kind==='playlist')throw Error('Веб-камеры добавляются по одной');
  if(kind==='playlist'&&title?.trim())throw Error('Переименование видео доступно только для одного ролика');
  const category=CATEGORIES[mediaType];
  const cycle=mediaType==='stone'?'Stone Simulator':clean(series,120);
  const override=clean(title,180);
  if(series&&clean(series,120).length!==String(series).trim().length)throw Error('Слишком длинное название сериала');
  if(kind==='playlist'&&mediaType==='game'&&!cycle)throw Error('Для игрового плейлиста необходимо название сериала');
  let nextEpisode=1;
  if(cycle){
    for(const v of Object.values(catalog.videos))
      if(v.series===cycle&&Number.isInteger(v.episode)&&v.episode>=nextEpisode)nextEpisode=v.episode+1;
  }
  if(episode&&(!/^\d{1,4}$/.test(String(episode))||Number(episode)<1))throw Error('Номер серии должен быть положительным целым числом');
  if(kind==='playlist'&&episode)throw Error('Номер серии для плейлиста назначается автоматически');
  if(durationSeconds&&(!/^\d{1,6}$/.test(String(durationSeconds))||Number(durationSeconds)<1||Number(durationSeconds)>86400))
    throw Error('Длительность должна быть целым числом секунд до 24 часов');
  if(kind==='playlist'&&durationSeconds)throw Error('Ручная длительность доступна только для одного ролика');

  const existingBySource=new Set(Object.values(catalog.videos).map(v=>v.source?.videoId).filter(Boolean));
  const seen=new Set();
  const added=[];
  let skipped=0;
  for(const input of entries){
    const id=input?.id;
    if(typeof id!=='string'||!VIDEO_ID.test(id)||seen.has(id))throw Error('Повторяющийся или неверный ID видео');
    seen.add(id);
    if(existingBySource.has(id)){skipped++;continue;}
    const seconds=mediaType==='webcam'?86400:(
      Number.isFinite(input.duration)&&input.duration>0?Math.ceil(input.duration):Number(durationSeconds));
    if(!Number.isSafeInteger(seconds)||seconds<1||seconds>86400)throw Error('Нет достоверной длительности для '+id);
    const name=override||clean(input.title,180);
    if(!name)throw Error('YouTube не вернул название для '+id);
    const author=clean(input.author,120);
    const key=(mediaType==='stone'?'stone-':mediaType==='webcam'?'cam-':'yt-')+id;
    if(catalog.videos[key])throw Error('Этот ID уже занят в каталоге: '+key);
    const item={
      title:name,
      durationSeconds:seconds,
      source:{type:'youtube',videoId:id},
      ...(author?{author}:{}),
      category,
      ...(cycle?{series:cycle}:{}),
      ...((cycle||episode)?{episode:kind==='video'&&episode?Number(episode):nextEpisode++}:{})
    };
    if(mediaType==='webcam')item.live=true;
    catalog.videos[key]=item;
    existingBySource.add(id);
    added.push({id:key,title:name,durationSeconds:seconds});
  }
  if(!added.length)throw Error('Все указанные ролики уже есть в каталоге');
  catalog.version++;
  return {added,skipped,version:catalog.version};
}
