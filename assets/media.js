// Common playback interface. The YouTube crop remains exclusively in style.css.
let apiPromise;
export function loadYouTube(){
  if(window.YT?.Player)return Promise.resolve();
  if(apiPromise)return apiPromise;
  apiPromise=new Promise((resolve,reject)=>{
    const script=document.createElement('script');script.src='https://www.youtube.com/iframe_api';
    const timer=setTimeout(()=>{apiPromise=null;script.remove();reject(Error('YouTube API timeout'));},20000);
    window.onYouTubeIframeAPIReady=()=>{clearTimeout(timer);resolve();};
    script.onerror=()=>{clearTimeout(timer);apiPromise=null;script.remove();reject(Error('YouTube API error'));};
    document.head.append(script);
  });return apiPromise;
}
function captions(player){try{if(player.getOptions?.().includes('captions')){player.setOption('captions','track',{});player.unloadModule('captions');}}catch{}}
export async function createMedia(host,video,offset,events){
  if(video.source.type==='file'){
    const node=document.createElement('video');node.className='native-player';node.playsInline=true;node.preload='auto';host.replaceWith(node);
    let disposed=false;
    const media={destroy(){disposed=true;node.pause();node.removeAttribute('src');node.load();node.remove();},play(){node.play().catch(e=>{if(!disposed){if(e.name==='NotAllowedError')events.blocked();else events.error();}});},seek(t){if(Number.isFinite(node.duration))node.currentTime=Math.min(t,Math.max(0,node.duration-.1));},time:()=>node.currentTime,state:()=>node.paused?2:node.readyState<3?3:1,sound(v,m){node.volume=v/100;node.muted=m;}};
    node.addEventListener('loadedmetadata',()=>{media.seek(offset);events.ready(media);},{once:true});
    node.addEventListener('playing',()=>events.playing());node.addEventListener('ended',()=>events.ended());node.addEventListener('error',()=>{if(!disposed)events.error();});node.src=video.source.url;
    return media;
  }
  await loadYouTube();
  if(!host.isConnected)return null;
  let disposed=false;
  const raw=new YT.Player(host,{videoId:video.source.videoId,width:'100%',height:'100%',playerVars:{start:Math.floor(offset),controls:0,disablekb:1,playsinline:1,origin:location.origin},events:{
    onReady(){if(disposed)return;const frame=raw.getIframe();frame.tabIndex=-1;frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');captions(raw);events.ready(media);},
    onApiChange(){if(!disposed)captions(raw);},
    onStateChange(e){if(disposed)return;if(e.data===1)events.playing();if(e.data===0)events.ended();if(e.data===2)events.paused();},
    onAutoplayBlocked(){if(!disposed)events.blocked();},onError(){if(!disposed)events.error();}
  }});
  const media={destroy(){disposed=true;raw.destroy();},play(){raw.playVideo();},seek(t){raw.seekTo(t,true);},time:()=>raw.getCurrentTime(),state:()=>raw.getPlayerState(),sound(v,m){raw.setVolume(v);m?raw.mute():raw.unMute();}};
  return media;
}
