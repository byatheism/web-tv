// Preserve stable Stone Simulator entry numbers even when the YouTube playlist
// is reordered. Existing video IDs keep their assigned numbers; genuinely new
// recordings receive the next unused number.
export function mergeStonePlaylist(catalog,entries){
  if(!Array.isArray(entries)||!entries.length)throw Error('Stone Simulator playlist returned no videos');
  if(!catalog?.videos||Array.isArray(catalog.videos))throw Error('Invalid video catalogue');
  let nextEpisode=1;
  for(const [id,v] of Object.entries(catalog.videos)){
    if(id.startsWith('stone-')&&Number.isInteger(v.episode)&&v.episode>=nextEpisode)
      nextEpisode=v.episode+1;
  }
  const seen=new Set();
  let changed=0;
  for(const entry of entries){
    if(!entry||!/^[A-Za-z0-9_-]{11}$/.test(entry.id||''))throw Error('Invalid Stone Simulator video ID');
    if(!Number.isFinite(entry.duration)||entry.duration<=0)throw Error('Missing video duration for '+entry.id);
    const id='stone-'+entry.id;
    if(seen.has(id))throw Error('Duplicate Stone Simulator video '+entry.id);
    seen.add(id);
    const prev=catalog.videos[id];
    const episode=Number.isInteger(prev?.episode)&&prev.episode>0?prev.episode:nextEpisode++;
    const next={
      title:(entry.title||'Stone Simulator').trim(),
      durationSeconds:Math.ceil(entry.duration),
      source:{type:'youtube',videoId:entry.id},
      author:prev?.author||'ShoobahDoobah',
      category:'Stone Simulator',
      series:'Stone Simulator',
      episode
    };
    if(JSON.stringify(prev)!==JSON.stringify(next)){
      catalog.videos[id]=next;
      changed++;
    }
  }
  return {found:entries.length,changed};
}
