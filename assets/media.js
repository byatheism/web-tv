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
    let disposed=false,handlers=events,current=video.source.url;
    const media={
      kind:'file',
      destroy(){disposed=true;node.pause();node.removeAttribute('src');node.load();node.remove();},
      play(){node.play().catch(e=>{if(!disposed){if(e.name==='NotAllowedError')handlers.blocked?.();else handlers.error?.();}});},
      pause(){node.pause();},
      seek(t){if(Number.isFinite(node.duration))node.currentTime=Math.min(t,Math.max(0,node.duration-.1));},
      time:()=>node.currentTime,
      state:()=>node.paused?2:node.readyState<3?3:1,
      sound(v,m){node.volume=v/100;node.muted=m;},
      canReuse(next){return next?.source?.type==='file';},
      switchTo(next,start,nextEvents){
        if(disposed||!media.canReuse(next))return false;
        handlers=nextEvents;
        current=next.source.url;
        node.pause();
        node.src=current;
        node.preload='auto';
        const seek=()=>{try{node.currentTime=Math.max(0,start||0);}catch{}};
        if(node.readyState>=1)seek();else node.addEventListener('loadedmetadata',seek,{once:true});
        node.load();
        media.play();
        return true;
      },
      prepare(next,start,nextEvents){
        if(disposed||!media.canReuse(next))return false;
        handlers=nextEvents;
        current=next.source.url;
        node.pause();
        node.src=current;
        node.preload='auto';
        const seek=()=>{try{node.currentTime=Math.max(0,start||0);}catch{}};
        if(node.readyState>=1)seek();else node.addEventListener('loadedmetadata',seek,{once:true});
        node.load();
        return true;
      }
    };
    node.addEventListener('loadedmetadata',()=>{media.seek(offset);handlers.ready?.(media);},{once:true});
    node.addEventListener('playing',()=>handlers.playing?.());
    node.addEventListener('ended',()=>handlers.ended?.());
    node.addEventListener('pause',()=>handlers.paused?.());
    node.addEventListener('error',()=>{if(!disposed)handlers.error?.();});
    node.src=current;
    return media;
  }

  await loadYouTube();
  if(!host.isConnected)return null;
  let disposed=false,handlers=events,currentId=video.source.videoId;
  let raw;
  const media={
    kind:'youtube',
    destroy(){disposed=true;raw.destroy();},
    play(){raw.playVideo();},
    pause(){raw.pauseVideo();},
    seek(t){raw.seekTo(t,true);},
    time:()=>raw.getCurrentTime(),
    state:()=>raw.getPlayerState(),
    sound(v,m){raw.setVolume(v);m?raw.mute():raw.unMute();},
    canReuse(next){return next?.source?.type==='youtube';},
    switchTo(next,start,nextEvents){
      if(disposed||!media.canReuse(next))return false;
      const previousHandlers=handlers;
      const previousId=currentId;
      handlers=nextEvents;
      currentId=next.source.videoId;
      try{
        // A single API call loads and starts the new broadcast. Calling
        // cueVideoById() immediately before playVideo() races YouTube's async cue.
        // This method must only be called while the player is visible.
        raw.loadVideoById({videoId:currentId,startSeconds:next.live?0:Math.max(0,Math.floor(start||0))});
        return true;
      }catch{
        handlers=previousHandlers;
        currentId=previousId;
        return false;
      }
    },
    prepare(next,start,nextEvents){
      if(disposed||!media.canReuse(next))return false;
      handlers=nextEvents;
      currentId=next.source.videoId;
      try{
        raw.cueVideoById({videoId:currentId,startSeconds:next.live?0:Math.max(0,Math.floor(start||0))});
        captions(raw);
        return true;
      }catch{return false;}
    }
  };
  raw=new YT.Player(host,{videoId:currentId,width:'100%',height:'100%',playerVars:{start:video.live?0:Math.floor(offset),controls:0,disablekb:1,playsinline:1,origin:location.origin},events:{
    onReady(){
      if(disposed)return;
      const frame=raw.getIframe();
      frame.tabIndex=-1;
      frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
      captions(raw);
      handlers.ready?.(media);
    },
    onApiChange(){if(!disposed)captions(raw);},
    onStateChange(e){
      if(disposed)return;
      if(e.data===1)handlers.playing?.();
      if(e.data===0)handlers.ended?.();
      if(e.data===2)handlers.paused?.();
    },
    onAutoplayBlocked(){if(!disposed)handlers.blocked?.();},
    onError(){if(!disposed)handlers.error?.();}
  }});
  return media;
}
