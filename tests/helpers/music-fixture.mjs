import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync(new URL('../../music.js',import.meta.url),'utf8');
export function fixture({session=false,media=false,waveShaper=true,throwsSession=false,recordings=false,now=Date.now(),decodeDuration=120,resumeImpl=null,mediaPlayImpl=null}={}){
  let sequence=0;const timers=new Map(),listeners=new Map(),windowListeners=new Map(),audioListeners=new Map(),calls=[];
  const mediaElements=[],contexts=[],nodes=[],sources=new Set(),waves=[];
  let clock=Number(now);
  class ClockDate extends Date{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
  // App and player each listen for visibility/page restoration. Dispatch both
  // in registration order, as the browser does, rather than overwrite either.
  function eventTarget(listeners){
    const callbacks=new Map();
    return {
      addEventListener(name,callback){
        if(!callbacks.has(name)){callbacks.set(name,new Set());listeners.set(name,(...args)=>Promise.all([...callbacks.get(name)].map(fn=>fn(...args))));}
        callbacks.get(name).add(callback);
      },
      removeEventListener(name,callback){
        const entries=callbacks.get(name);if(!entries)return;
        entries.delete(callback);if(!entries.size){callbacks.delete(name);listeners.delete(name);}
      }
    };
  }
  const document={hidden:false,...eventTarget(listeners)};
  class Param{constructor(){this.value=0;this.events=[];}setValueAtTime(v,t){assert(Number.isFinite(v));assert(Number.isFinite(t));this.value=v;this.events.push([v,t]);}linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);}exponentialRampToValueAtTime(v,t){assert(v>0);this.setValueAtTime(v,t);}cancelScheduledValues(){}cancelAndHoldAtTime(){}}
  class Node{constructor(kind='node'){this.kind=kind;this.connections=[];this.gain=new Param();this.frequency=new Param();this.pan=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();nodes.push(this);}connect(node){this.connections.push(node);}disconnect(){this.connections=[];}start(t){assert(t>=0);this.started=t;sources.add(this);}stop(t){assert(t>=0);this.stopped=t;}setPeriodicWave(wave){assert(wave.real.length>8);this.wave=wave;}}
  class AC{constructor(){this.sampleRate=8000;this.currentTime=0;this.state='suspended';this.destination={kind:'speakers'};this.listeners=new Map();this.resumeImpl=resumeImpl;contexts.push(this);}createGain(){return new Node('gain');}createDynamicsCompressor(){return new Node('compressor');}createConvolver(){return new Node('convolver');}createStereoPanner(){return new Node('panner');}createOscillator(){return new Node('oscillator');}createBufferSource(){return new Node('buffer-source');}createBiquadFilter(){return new Node('filter');}createPeriodicWave(real,imag){assert([...real,...imag].every(Number.isFinite));const wave={real,imag};waves.push(wave);return wave;}createBuffer(c,n,sampleRate=this.sampleRate){const data=Array.from({length:c},()=>new Float32Array(n));return{length:n,sampleRate,numberOfChannels:c,getChannelData:i=>data[i]};}addEventListener(n,f){this.listeners.set(n,f);}removeEventListener(n){this.listeners.delete(n);}resume(){calls.push('context.resume');if(this.resumeImpl)return this.resumeImpl();this.state='running';return Promise.resolve();}async suspend(){calls.push('context.suspend');this.state='suspended';}async close(){this.state='closed';}advance(time){this.currentTime=time;for(const source of sources)if(source.stopped<=time){sources.delete(source);source.onended?.();}}}
  if(waveShaper)AC.prototype.createWaveShaper=function(){return new Node('waveshaper');};
  if(media){
    AC.prototype.createMediaStreamDestination=function(){const sink=new Node(),track={stopped:false,stop(){this.stopped=true;}};sink.stream={getTracks:()=>[track]};return sink;};
    document.createElement=name=>{assert.equal(name,'audio');const element={srcObject:null,paused:true,playCount:0,pauseCount:0,playImpl:mediaPlayImpl,attributes:{},setAttribute(k,v){this.attributes[k]=v;},play(){calls.push('media.play');this.playCount++;if(this.playImpl)return this.playImpl();this.paused=false;return Promise.resolve();},pause(){this.pauseCount++;this.paused=true;}};mediaElements.push(element);return element;};
  }
  let type='auto';const audioSession={state:'inactive',get type(){return type;},set type(v){if(throwsSession)throw new Error('Unsupported session');type=v;calls.push('session:'+v);},addEventListener:(n,f)=>audioListeners.set(n,f),removeEventListener:n=>audioListeners.delete(n)};
  const context={document,navigator:session?{audioSession}:{},AudioContext:AC,Date:ClockDate,console,...eventTarget(windowListeners),setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms,due:clock+ms});return id;},clearTimeout:id=>timers.delete(id)};
  const files=[];
  if(recordings){
    context.AbortController=AbortController;
    context.fetch=(url,{signal})=>new Promise(resolve=>files.push({url,signal,resolve}));
    AC.prototype.decodeAudioData=async()=>({duration:decodeDuration});
  }
  context.window=context;vm.createContext(context);vm.runInContext(source,context);
  const runTimer=ms=>{const entry=[...timers].find(([,v])=>v.ms===ms);assert(entry,`timer ${ms} exists`);timers.delete(entry[0]);return entry[1].fn();};
  return {Music:context.SengokuMusic,Tracks:context.SENGOKU_MUSIC_TRACKS,context,document,timers,listeners,windowListeners,audioListeners,audioSession,mediaElements,contexts,calls,runTimer,nodes,sources,waves,files,setNow:value=>{clock=Number(value);}};
}
