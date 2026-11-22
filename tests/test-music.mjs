import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../music.js',import.meta.url),'utf8');
function fixture({session=false,media=false,throwsSession=false}={}){
  let sequence=0;const timers=new Map(),listeners=new Map(),windowListeners=new Map(),audioListeners=new Map(),calls=[];
  const mediaElements=[],contexts=[];
  const document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
  class Param{constructor(){this.value=0;}setValueAtTime(v,t){assert(Number.isFinite(v));assert(Number.isFinite(t));this.value=v;}linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);}exponentialRampToValueAtTime(v,t){assert(v>0);this.setValueAtTime(v,t);}cancelScheduledValues(){}cancelAndHoldAtTime(){}}
  class Node{constructor(){this.connections=[];this.gain=new Param();this.frequency=new Param();this.pan=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();}connect(node){this.connections.push(node);}disconnect(){this.connections=[];}start(t){assert(t>=0);this.started=t;}stop(t){assert(t>=0);this.stopped=t;}}
  class AC{constructor(){this.sampleRate=8000;this.currentTime=0;this.state='suspended';this.destination={kind:'speakers'};this.listeners=new Map();contexts.push(this);}createGain(){return new Node();}createDynamicsCompressor(){return new Node();}createConvolver(){return new Node();}createStereoPanner(){return new Node();}createOscillator(){return new Node();}createBufferSource(){return new Node();}createBiquadFilter(){return new Node();}createBuffer(c,n){const data=Array.from({length:c},()=>new Float32Array(n));return{getChannelData:i=>data[i]};}addEventListener(n,f){this.listeners.set(n,f);}removeEventListener(n){this.listeners.delete(n);}resume(){calls.push('context.resume');if(this.resumeImpl)return this.resumeImpl();this.state='running';return Promise.resolve();}async suspend(){calls.push('context.suspend');this.state='suspended';}async close(){this.state='closed';}}
  if(media){
    AC.prototype.createMediaStreamDestination=function(){const sink=new Node(),track={stopped:false,stop(){this.stopped=true;}};sink.stream={getTracks:()=>[track]};return sink;};
    document.createElement=name=>{assert.equal(name,'audio');const element={srcObject:null,paused:true,playCount:0,pauseCount:0,attributes:{},setAttribute(k,v){this.attributes[k]=v;},play(){calls.push('media.play');this.playCount++;if(this.playImpl)return this.playImpl();this.paused=false;return Promise.resolve();},pause(){this.pauseCount++;this.paused=true;}};mediaElements.push(element);return element;};
  }
  let type='auto';const audioSession={state:'inactive',get type(){return type;},set type(v){if(throwsSession)throw new Error('Unsupported session');type=v;calls.push('session:'+v);},addEventListener:(n,f)=>audioListeners.set(n,f),removeEventListener:n=>audioListeners.delete(n)};
  const context={document,navigator:session?{audioSession}:{},AudioContext:AC,console,addEventListener:(n,f)=>windowListeners.set(n,f),removeEventListener:n=>windowListeners.delete(n),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  const runTimer=ms=>{const entry=[...timers].find(([,v])=>v.ms===ms);assert(entry,`timer ${ms} exists`);timers.delete(entry[0]);entry[1].fn();};
  return {Music:context.SengokuMusic,Tracks:context.SENGOKU_MUSIC_TRACKS,document,timers,listeners,windowListeners,audioListeners,audioSession,mediaElements,contexts,calls,runTimer};
}
const f=fixture(),{Music,Tracks}=f;
assert.equal(Tracks.length,16);assert.equal(new Set(Tracks.map(t=>t.id)).size,16);
const signatures=[];for(const t of Tracks){const s=Music.inspect(t.id);assert(s.duration>=60&&s.duration<=120);assert(s.eventCount>150);assert(s.events.every(e=>e.beat>=0&&e.beat<128&&Number.isFinite(e.duration)&&e.duration>0));for(const e of s.events)if(e.midi!==undefined)assert(e.midi>=20&&e.midi<=100);signatures.push(crypto.createHash('sha256').update(JSON.stringify(s.events)).digest('hex'));}
assert.equal(new Set(signatures).size,16);
const music=new Music({volume:10});assert.equal(f.timers.size,0);assert.equal(music.playing,false);assert.equal(music._context,null);
await music.play('town-dawn');assert.equal(f.timers.size,1);assert.equal(music.playing,true);assert.equal(music.currentId,'town-dawn');
for(const track of Tracks){await music.play(track.id);assert.equal(f.timers.size,1);assert.equal(music.currentId,track.id);music.playEffect('confirm');}
music.setVolume(101);assert.equal(music.volume,100);music.setVolume(-1);assert.equal(music.volume,0);assert.equal(f.timers.size,0);assert.equal(music._context.state,'suspended');
f.document.hidden=true;await music._onVisibility();assert.equal(f.timers.size,0);assert.equal(music._context.state,'suspended');
f.document.hidden=false;await music._onVisibility();assert.equal(f.timers.size,0,'volume zero stays silent after visibility change');
music.setVolume(30);await Promise.resolve();await Promise.resolve();assert.equal(music._context.state,'running');
await music.play('unification');assert.equal(f.timers.size,1);
music.pause();assert.equal(music.playing,false);assert.equal(f.timers.size,1);await music.play('unification');assert.equal(f.timers.size,1);
await music.dispose();assert.equal(f.timers.size,0);assert.equal(f.listeners.size,0);assert.equal(f.windowListeners.size,0);assert.equal(music._context.state,'closed');

let scenarios=1;
// Native playback category: only acquired by requested, audible playback.
{
 const x=fixture({session:true,media:true}),p=new x.Music({volume:10});
 assert.equal(x.audioSession.type,'auto');assert.equal(x.calls.length,0);assert.equal(x.mediaElements.length,0);
 await p.play();assert.equal(x.audioSession.type,'playback');assert.equal(x.mediaElements.length,0,'native session uses direct output');
 assert.equal(p._master.connections.length,1);assert.equal(p._master.connections[0],p._context.destination);
 p.pause();x.runTimer(280);assert.equal(x.audioSession.type,'auto');assert.equal(p._context.state,'suspended');
 await p.play();assert.equal(x.audioSession.type,'playback');
 x.document.hidden=true;await p._onVisibility();assert.equal(x.audioSession.type,'auto');assert.equal(x.timers.size,0);
 x.document.hidden=false;await p._onVisibility();assert.equal(x.audioSession.type,'playback');assert.equal(x.timers.size,1);
 await p.dispose();assert.equal(x.audioSession.type,'auto');assert.equal(x.audioListeners.size,0);scenarios++;
}
// Real generated audio goes to one MediaStream sink on browsers without the API.
{
 const x=fixture({media:true}),p=new x.Music();
 const pending=p.play();const element=x.mediaElements[0];
 assert.equal(element.playCount,1,'media play starts synchronously in the tap, before context promise resolves');
 assert(x.calls.indexOf('media.play')>x.calls.indexOf('context.resume'));
 await pending;assert.equal(element.paused,false);assert.equal(element.autoplay,false);
 assert.equal(p._master.connections.length,1);assert.equal(p._master.connections[0],p._streamDestination);
 assert.equal(element.srcObject,p._streamDestination.stream);assert.equal(element.attributes.playsinline,'');
 const track=p._streamDestination.stream.getTracks()[0];
 x.document.hidden=true;await p._onVisibility();assert.equal(element.paused,true);assert.equal(x.timers.size,0);
 x.document.hidden=false;await p._onVisibility();assert.equal(element.paused,false);assert.equal(x.timers.size,1);
 p.pause();assert.equal(element.paused,true);x.runTimer(280);
 await p.dispose();assert.equal(element.srcObject,null);assert.equal(track.stopped,true);assert.equal(x.timers.size,0);scenarios++;
}
// A throwing experimental API degrades to the supported media sink.
{
 const x=fixture({session:true,throwsSession:true,media:true}),p=new x.Music();await p.play();assert(p._audioElement);assert.equal(p.playing,true);await p.dispose();scenarios++;
}
// Playback rejection must not claim success or leave sound/schedulers active.
{
 const x=fixture({media:true}),p=new x.Music();p._ensureContext();
 x.mediaElements[0].playImpl=()=>Promise.reject(Object.assign(new Error('Tap required'),{name:'NotAllowedError'}));
 await assert.rejects(p.play(),{name:'NotAllowedError'});assert.equal(p.playing,false);assert.equal(p._context.state,'suspended');assert.equal(x.mediaElements[0].paused,true);
 assert(![...x.timers.values()].some(t=>t.ms===50));
 x.mediaElements[0].playImpl=null;await p.play();assert.equal(p.playing,true);assert.equal(x.timers.size,1);await p.dispose();scenarios++;
}
// Retrying the same selected track after platform rejection stays recoverable.
{
 const x=fixture({media:true}),p=new x.Music();await p.play();
 x.mediaElements[0].playImpl=()=>Promise.reject(Object.assign(new Error('Playback restricted'),{name:'NotAllowedError'}));
 await assert.rejects(p.play(),{name:'NotAllowedError'});assert.equal(p.playing,false);assert.equal(x.mediaElements[0].paused,true);
 x.mediaElements[0].playImpl=null;await p.play();assert.equal(p.playing,true);assert.equal(x.timers.size,1);await p.dispose();scenarios++;
}
// Pause while play() is pending never starts a stale session after it resolves.
{
 const x=fixture({media:true}),p=new x.Music();p._ensureContext();let resolve;
 x.mediaElements[0].playImpl=()=>new Promise(r=>{resolve=r;});
 const pending=p.play();p.pause();resolve();await pending;
 assert.equal(p.playing,false);assert.equal(p._session,null);assert.equal(x.mediaElements[0].paused,true);
 await p.dispose();assert.equal(x.timers.size,0);scenarios++;
}
// Hidden or zero-volume playback never takes exclusive audio focus.
{
 const x=fixture({session:true,media:true}),p=new x.Music({volume:0});await p.play();
 assert.equal(x.audioSession.type,'auto');assert.equal(p._context.state,'suspended');assert.equal(x.timers.size,0);
 x.document.hidden=true;p.setVolume(20);assert.equal(x.audioSession.type,'auto');assert.equal(p._context.state,'suspended');
 x.document.hidden=false;await p._onVisibility();assert.equal(x.audioSession.type,'playback');assert.equal(x.timers.size,1);
 p.setVolume(0);assert.equal(x.audioSession.type,'auto');assert.equal(p._context.state,'suspended');assert.equal(x.timers.size,0);await p.dispose();scenarios++;
}
// A call or another app may interrupt playback; do not repeatedly steal focus.
{
 const x=fixture({session:true}),p=new x.Music();await p.play();const resumes=x.calls.filter(c=>c==='context.resume').length;
 x.audioSession.state='interrupted';p._context.state='interrupted';x.audioListeners.get('statechange')();p._context.listeners.get('statechange')();
 assert.equal(x.timers.size,0);assert.equal(x.calls.filter(c=>c==='context.resume').length,resumes);
 await p.play('battle-storm');assert.equal(x.calls.filter(c=>c==='context.resume').length,resumes,'scene change does not fight an active call');assert.equal(x.timers.size,0);
 x.audioSession.state='active';p._context.state='running';x.audioListeners.get('statechange')();assert.equal(x.timers.size,1);
 await p.dispose();scenarios++;
}
// Back/forward cache pauses output and resumes only when still requested.
{
 const x=fixture({media:true}),p=new x.Music();await p.play();x.windowListeners.get('pagehide')();assert.equal(p._context.state,'suspended');assert.equal(x.mediaElements[0].paused,true);
 await x.windowListeners.get('pageshow')();assert.equal(p._context.state,'running');assert.equal(x.timers.size,1);
 p.pause();x.runTimer(280);await x.windowListeners.get('pageshow')();assert.equal(p._context.state,'suspended');assert.equal(x.timers.size,0);await p.dispose();scenarios++;
}
// Release only our override, preserving a category changed by another feature.
{
 const x=fixture({session:true}),p=new x.Music();await p.play();x.audioSession.type='play-and-record';p.pause();x.runTimer(280);assert.equal(x.audioSession.type,'play-and-record');await p.dispose();scenarios++;
}
// Quick hide/show must not allow a stale failed media request to stop new output.
{
 const x=fixture({media:true}),p=new x.Music();await p.play();let reject;
 x.mediaElements[0].playImpl=()=>new Promise((_,r)=>{reject=r;});const old=p._onVisibility();
 x.document.hidden=true;await p._onVisibility();x.document.hidden=false;x.mediaElements[0].playImpl=null;await p._onVisibility();
 reject(new Error('Old request cancelled'));await old;assert.equal(x.timers.size,1);assert.equal(p._context.state,'running');assert.equal(x.mediaElements[0].paused,false);await p.dispose();scenarios++;
}
// Our voice feature releases playback before capture and cannot be interrupted
// by a scene change, a volume control, or a page visibility notification.
{
 const x=fixture({session:true}),p=new x.Music({volume:27});await p.play('town-dawn');
 const entering=p.setVoiceActive(true);assert.equal(x.audioSession.type,'auto','release is synchronous before getUserMedia');await entering;
 x.audioSession.type='play-and-record';await p.play('battle-storm');p.setVolume(42);await p._onVisibility();
 assert.equal(p._context.state,'suspended');assert.equal(x.timers.size,0);assert.equal(x.audioSession.type,'play-and-record');assert.equal(p.volume,42);assert.equal(p.playing,true);
 x.audioSession.type='auto';await p.setVoiceActive(false);assert.equal(p._context.state,'running');assert.equal(x.audioSession.type,'playback');assert.equal(p.currentId,'battle-storm');assert.equal(x.timers.size,1);
 await p.setVoiceActive(true);p.pause();await p.setVoiceActive(false);assert.equal(p._context.state,'suspended','pausing during a call is respected after leaving');assert.equal(p.playing,false);await p.dispose();scenarios++;
}
{
 const x=fixture({media:true}),p=new x.Music();await p.setVoiceActive(true);await p.play('town-dawn');
 assert.equal(p._context.state,'suspended');assert.equal(x.mediaElements[0].playCount,0,'new BGM while calling does not start an audio sink');
 x.document.hidden=true;await p.setVoiceActive(false);assert.equal(p._context.state,'suspended');
 x.document.hidden=false;await p._onVisibility();assert.equal(p._context.state,'running');await p.dispose();scenarios++;
}
console.log(JSON.stringify({tracks:Tracks.length,distinctScores:new Set(signatures).size,scenarios,lifecycle:'Native playback category, real media sink fallback, gesture ordering, mute, rejection/retry, pause race, visibility, interruptions, bfcache, voice-call focus and cleanup.'},null,2));
