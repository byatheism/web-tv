import test from 'node:test';
import assert from 'node:assert/strict';
import {createMedia} from '../assets/media.js';

test('handover reuses the YouTube iframe and atomically loads the scheduled show',async()=>{
  const previous={window:globalThis.window,YT:globalThis.YT,location:globalThis.location};
  class MockYTPlayer{
    static last;
    constructor(host,options){
      this.host=host;
      this.options=options;
      this.calls=[];
      MockYTPlayer.last=this;
    }
    getIframe(){return {setAttribute(){},tabIndex:0};}
    cueVideoById(options){this.calls.push(['cue',options]);}
    loadVideoById(options){this.calls.push(['load',options]);}
    playVideo(){this.calls.push(['play']);}
    getPlayerState(){return 1;}
    destroy(){this.calls.push(['destroy']);}
  }
  globalThis.window={YT:{Player:MockYTPlayer}};
  globalThis.YT=window.YT;
  globalThis.location={origin:'https://byatheism.github.io'};
  const video=(id,live=false)=>({source:{type:'youtube',videoId:id},live});
  const oldEvents={playing(){throw Error('Old programme callback fired');}};
  let started=0;
  const nextEvents={playing(){started++;}};
  try{
    const media=await createMedia({isConnected:true},video('AAAAAAAAAAA'),0,oldEvents);
    assert.ok(media);
    const raw=MockYTPlayer.last;
    assert.equal(media.kind,'youtube');
    assert.equal(media.prepare(video('BBBBBBBBBBB'),0,nextEvents),true);
    assert.equal(raw.calls.filter(x=>x[0]==='cue').length,1);
    assert.equal(media.switchTo(video('BBBBBBBBBBB'),109,nextEvents),true);
    assert.deepEqual(raw.calls.at(-1),['load',{videoId:'BBBBBBBBBBB',startSeconds:109}]);
    assert.equal(raw.calls.filter(x=>x[0]==='load').length,1);
    assert.equal(raw.calls.filter(x=>x[0]==='play').length,0);
    raw.options.events.onStateChange({data:1});
    assert.equal(started,1);

    assert.equal(media.switchTo(video('CCCCCCCCCCC',true),9999,nextEvents),true);
    assert.deepEqual(raw.calls.at(-1),['load',{videoId:'CCCCCCCCCCC',startSeconds:0}]);
    assert.equal(MockYTPlayer.last,raw,'the same iframe player must be reused');
    media.destroy();
  }finally{
    for(const [name,value] of Object.entries(previous)){
      if(value===undefined)delete globalThis[name];
      else globalThis[name]=value;
    }
  }
});
