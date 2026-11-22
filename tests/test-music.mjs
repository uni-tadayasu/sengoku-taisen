import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const source=fs.readFileSync(new URL('../music.js',import.meta.url),'utf8');
function fixture({session=false,media=false,throwsSession=false,recordings=false}={}){
  let sequence=0;const timers=new Map(),listeners=new Map(),windowListeners=new Map(),audioListeners=new Map(),calls=[];
  const mediaElements=[],contexts=[],nodes=[],sources=new Set(),waves=[];
  const document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:n=>listeners.delete(n)};
  class Param{constructor(){this.value=0;this.events=[];}setValueAtTime(v,t){assert(Number.isFinite(v));assert(Number.isFinite(t));this.value=v;this.events.push([v,t]);}linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);}exponentialRampToValueAtTime(v,t){assert(v>0);this.setValueAtTime(v,t);}cancelScheduledValues(){}cancelAndHoldAtTime(){}}
  class Node{constructor(kind='node'){this.kind=kind;this.connections=[];this.gain=new Param();this.frequency=new Param();this.pan=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();nodes.push(this);}connect(node){this.connections.push(node);}disconnect(){this.connections=[];}start(t){assert(t>=0);this.started=t;sources.add(this);}stop(t){assert(t>=0);this.stopped=t;}setPeriodicWave(wave){assert(wave.real.length>8);this.wave=wave;}}
  class AC{constructor(){this.sampleRate=8000;this.currentTime=0;this.state='suspended';this.destination={kind:'speakers'};this.listeners=new Map();contexts.push(this);}createGain(){return new Node('gain');}createDynamicsCompressor(){return new Node('compressor');}createConvolver(){return new Node('convolver');}createStereoPanner(){return new Node('panner');}createOscillator(){return new Node('oscillator');}createBufferSource(){return new Node('buffer-source');}createBiquadFilter(){return new Node('filter');}createPeriodicWave(real,imag){assert([...real,...imag].every(Number.isFinite));const wave={real,imag};waves.push(wave);return wave;}createBuffer(c,n,sampleRate=this.sampleRate){const data=Array.from({length:c},()=>new Float32Array(n));return{length:n,sampleRate,numberOfChannels:c,getChannelData:i=>data[i]};}addEventListener(n,f){this.listeners.set(n,f);}removeEventListener(n){this.listeners.delete(n);}resume(){calls.push('context.resume');if(this.resumeImpl)return this.resumeImpl();this.state='running';return Promise.resolve();}async suspend(){calls.push('context.suspend');this.state='suspended';}async close(){this.state='closed';}advance(time){this.currentTime=time;for(const source of sources)if(source.stopped<=time){sources.delete(source);source.onended?.();}}}
  if(media){
    AC.prototype.createMediaStreamDestination=function(){const sink=new Node(),track={stopped:false,stop(){this.stopped=true;}};sink.stream={getTracks:()=>[track]};return sink;};
    document.createElement=name=>{assert.equal(name,'audio');const element={srcObject:null,paused:true,playCount:0,pauseCount:0,attributes:{},setAttribute(k,v){this.attributes[k]=v;},play(){calls.push('media.play');this.playCount++;if(this.playImpl)return this.playImpl();this.paused=false;return Promise.resolve();},pause(){this.pauseCount++;this.paused=true;}};mediaElements.push(element);return element;};
  }
  let type='auto';const audioSession={state:'inactive',get type(){return type;},set type(v){if(throwsSession)throw new Error('Unsupported session');type=v;calls.push('session:'+v);},addEventListener:(n,f)=>audioListeners.set(n,f),removeEventListener:n=>audioListeners.delete(n)};
  const context={document,navigator:session?{audioSession}:{},AudioContext:AC,console,addEventListener:(n,f)=>windowListeners.set(n,f),removeEventListener:n=>windowListeners.delete(n),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  const files=[];
  if(recordings){
    context.AbortController=AbortController;
    context.fetch=(url,{signal})=>new Promise(resolve=>files.push({url,signal,resolve}));
    AC.prototype.decodeAudioData=async()=>({duration:120});
  }
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  const runTimer=ms=>{const entry=[...timers].find(([,v])=>v.ms===ms);assert(entry,`timer ${ms} exists`);timers.delete(entry[0]);entry[1].fn();};
  return {Music:context.SengokuMusic,Tracks:context.SENGOKU_MUSIC_TRACKS,document,timers,listeners,windowListeners,audioListeners,audioSession,mediaElements,contexts,calls,runTimer,nodes,sources,waves,files};
}
const f=fixture(),{Music,Tracks}=f;
assert.equal(Tracks.length,16);assert.equal(new Set(Tracks.map(t=>t.id)).size,16);
const signatures=[];for(const t of Tracks){const s=Music.inspect(t.id);assert(s.duration>=60&&s.duration<=120);assert(s.eventCount>150);assert(s.events.every(e=>e.beat>=0&&e.beat<128&&Number.isFinite(e.duration)&&e.duration>0));for(const e of s.events)if(e.midi!==undefined)assert(e.midi>=20&&e.midi<=100);signatures.push(crypto.createHash('sha256').update(JSON.stringify(s.events)).digest('hex'));}
assert.equal(new Set(signatures).size,16);
// A real seven-part form must change orchestration and density, not just gain.
for(const track of Tracks){
 const score=Music.inspect(track.id),form=score.sections;
 assert.equal(form.map(s=>s.id).join(','),'intro,build,theme,break,rise,climax,coda');
 assert.equal(form[0].startBar,0);assert.equal(form.at(-1).endBar,32);
 for(let i=1;i<form.length;i++)assert.equal(form[i].startBar,form[i-1].endBar);
 assert(score.instruments.includes('strings'));assert(score.instruments.includes('choir'));
 assert(score.events.every(event=>event.priority>0&&form.some(section=>section.id===event.section&&event.beat>=section.startBar*4&&event.beat<section.endBar*4)));
 const density=id=>score.events.filter(event=>event.section===id).length/(form.find(section=>section.id===id).endBar-form.find(section=>section.id===id).startBar);
 assert(density('climax')>density('break')*1.8,track.id+' must actually rebuild the ensemble after the break');
 assert(score.estimatedPeak.voices<score.voiceBudget.voices);assert(score.estimatedPeak.sources<score.voiceBudget.sources);
 if(track.scene==='battle'||track.scene==='army'){assert(score.instruments.includes('brass'));assert(score.instruments.includes('odaiko'));assert(score.instruments.includes('shamisen'));assert(!score.events.some(event=>event.section==='break'&&event.type==='brass'));}
 if(['castle-evening','winter-silence','defeat-moon'].includes(track.id))assert(!score.events.some(event=>['taiko','odaiko','wood','hat','tsuzumi'].includes(event.type)),track.id+' preserves reflective pacing');
}
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
// Run the real scheduler through two full battle loops and a town score. The
// shared ceiling includes release tails and the scheduled look-ahead window.
let measuredPeak={voices:0,sources:0};
for(const id of ['battle-storm','battle-siege','town-dawn']){
 const x=fixture(),p=new x.Music({volume:10});await p.play(id);const score=x.Music.inspect(id),ctx=p._context;
 const duration=score.duration*(id==='battle-storm'?2:1)+.1;
 for(let time=.05;time<duration;time+=.05){ctx.advance(time);p._schedule();assert(p._voices.size<=score.voiceBudget.voices);assert(p._sourceCount<=score.voiceBudget.sources);measuredPeak.voices=Math.max(measuredPeak.voices,p._voices.size);measuredPeak.sources=Math.max(measuredPeak.sources,p._sourceCount);}
 assert.equal(p._droppedVoices,0,id+' must not lose intended notes under its normal budget');
 assert(x.waves.length>0,'orchestral timbres use original harmonic waveforms');
 assert(x.nodes.some(node=>node.kind==='oscillator'&&node.wave),'waveforms reach real instrument sources');
 assert.notDeepEqual(p._reverb.buffer.getChannelData(0),p._reverb.buffer.getChannelData(1),'room reflections are stereo');
 assert.equal(p._session.bus.connections.length,1,'dry signal has one path to the compressor');
 assert.equal(p._session.roomBus.connections[0],p._reverb,'room sends use a separate controlled bus');
 await p.dispose();assert.equal(p._voices.size,0);assert.equal(p._sourceCount,0);assert.equal(p._sessions.size,0);assert.equal(p._waveCache.size,0);assert.equal(p._pluckCache.size,0);assert.equal(x.timers.size,0);assert(x.nodes.every(node=>node.connections.length===0),'every voice and room node disconnects on dispose');scenarios++;
}
// Saturation is bounded even if a browser delays its onended callbacks.
{
 const x=fixture(),p=new x.Music();await p.play('battle-storm');const budget=x.Music.inspect('battle-storm').voiceBudget;
 for(let i=0;i<500;i++)p._voice(p._session,{type:'choir',midi:60+i%12,velocity:.2,pan:0,part:'harmony'},.02,5);
 assert(p._droppedVoices>0);assert(p._voices.size<=budget.voices);assert(p._sourceCount<=budget.sources);
 p._context.currentTime=7;p._pruneVoices(7);assert.equal(p._voices.size,0);assert.equal(p._sourceCount,0);
 assert(p._voice(p._session,{type:'brass',midi:60,velocity:.3,pan:0},7.01,1),'expired callbacks cannot permanently exhaust voices');
 p.setVolume(0);const before=x.nodes.length;for(let i=0;i<100;i++)p.playEffect('victory');assert.equal(x.nodes.length,before,'muted effects allocate no suspended sources');
 await p.dispose();assert(x.nodes.every(node=>!node.connections.length));scenarios++;
}
// Fast page changes release both dry and room buses when the fade ends.
{
 const x=fixture({session:true}),p=new x.Music();await p.play('town-dawn');const old=p._session;
 x.contexts[0].advance(1);await p.play('battle-siege');assert.equal(old.active,false);assert.equal(p._sessions.size,2);
 x.contexts[0].advance(1.4);p._schedule();assert.equal(old.bus.connections.length,0);assert.equal(old.roomBus.connections.length,0);assert.equal(p._sessions.size,1);
 await p.setVoiceActive(true);const before=x.nodes.length;p.playEffect('confirm');assert.equal(x.nodes.length,before);assert.equal(x.timers.size,0);assert.equal(x.audioSession.type,'auto');
 await p.dispose();assert.equal(p._sourceCount,0);scenarios++;
}
// Recorded files are fetched individually after a gesture. Stale requests
// cannot outlive a track switch, and the crossfade retains the call/volume
// lifecycle. Missing or unsupported recordings keep the updated local score.
{
 const x=fixture({recordings:true,session:true}),p=new x.Music({volume:10});
 const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
 assert.equal(x.files.length,0);
 await p.play('battle-storm');assert.equal(x.files.length,1);
 const old=x.files[0];
 assert.equal(old.url,x.Tracks.find(t=>t.id==='battle-storm').recording);
 await p.play('castle-evening');assert(old.signal.aborted);
 old.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
 const active=x.files[1];active.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});
 await flush();
 const master=p._session.recording;
 assert(master);assert.equal(master.source.loop,true);
 assert.equal(master.source.loopEnd,x.Music.inspect('castle-evening').duration);
 assert.equal(x.timers.size,0);assert.equal(p._session.bus.gain.value,0);
 x.audioSession.state='interrupted';x.audioListeners.get('statechange')();assert.equal(master.gain.gain.value,0);
 x.audioSession.state='active';x.audioListeners.get('statechange')();assert.equal(master.gain.gain.value,1);
 await p.setVoiceActive(true);assert.equal(p._context.state,'suspended');
 await p.setVoiceActive(false);assert.equal(p._context.state,'running');
 p._context.advance(2);p.pause();assert.equal(p._resumePosition,1.945);
 p._context.advance(3);assert.equal(master.source.buffer,null);assert.equal(master.gain.connections.length,0);
 await p.play('castle-evening');x.files[2].resolve({ok:false});await flush();
 assert.equal(p._session.recording,null);assert.equal(x.timers.size,1);
 await p.dispose();assert(x.nodes.every(node=>!node.connections.length));scenarios++;
}
console.log(JSON.stringify({tracks:Tracks.length,distinctScores:new Set(signatures).size,sectionsPerTrack:7,scenarios,measuredPeak,voiceBudget:Music.inspect(Tracks[0].id).voiceBudget,lifecycle:'Native playback category, real media sink fallback, gesture ordering, mute, rejection/retry, pause race, visibility, interruptions, bfcache, voice-call focus, bounded orchestral voices and complete graph cleanup.'},null,2));
