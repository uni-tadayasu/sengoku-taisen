import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
let sequence=0;const timers=new Map(),listeners=new Map();
const document={hidden:false,addEventListener:(n,f)=>listeners.set(n,f),removeEventListener:(n)=>listeners.delete(n)};
class Param{constructor(){this.value=0;}setValueAtTime(v,t){assert(Number.isFinite(v));assert(Number.isFinite(t));this.value=v;}linearRampToValueAtTime(v,t){this.setValueAtTime(v,t);}exponentialRampToValueAtTime(v,t){assert(v>0);this.setValueAtTime(v,t);}cancelScheduledValues(){}cancelAndHoldAtTime(){}}
class Node{constructor(){this.gain=new Param();this.frequency=new Param();this.pan=new Param();this.threshold=new Param();this.knee=new Param();this.ratio=new Param();this.attack=new Param();this.release=new Param();}connect(){}disconnect(){}start(t){assert(t>=0);this.started=t;}stop(t){assert(t>=0);this.stopped=t;}}
class AC{constructor(){this.sampleRate=8000;this.currentTime=0;this.state='suspended';this.destination={};}createGain(){return new Node();}createDynamicsCompressor(){return new Node();}createConvolver(){return new Node();}createStereoPanner(){return new Node();}createOscillator(){return new Node();}createBufferSource(){return new Node();}createBiquadFilter(){return new Node();}createBuffer(c,n,s){const data=Array.from({length:c},()=>new Float32Array(n));return{getChannelData:i=>data[i]};}async resume(){this.state='running';}async suspend(){this.state='suspended';}async close(){this.state='closed';}}
const context={document,AudioContext:AC,console,setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../music.js',import.meta.url),'utf8'),context);
const Tracks=context.SENGOKU_MUSIC_TRACKS, Music=context.SengokuMusic;
assert.equal(Tracks.length,16);assert.equal(new Set(Tracks.map(t=>t.id)).size,16);
const signatures=[];for(const t of Tracks){const s=Music.inspect(t.id);assert(s.duration>=60&&s.duration<=120);assert(s.eventCount>150);assert(s.events.every(e=>e.beat>=0&&e.beat<128&&Number.isFinite(e.duration)&&e.duration>0));for(const e of s.events)if(e.midi!==undefined)assert(e.midi>=20&&e.midi<=100);signatures.push(crypto.createHash('sha256').update(JSON.stringify(s.events)).digest('hex'));}
assert.equal(new Set(signatures).size,16);
const music=new Music({volume:10});assert.equal(timers.size,0);assert.equal(music.playing,false);assert.equal(music._context,null);
await music.play('town-dawn');assert.equal(timers.size,1);assert.equal(music.playing,true);assert.equal(music.currentId,'town-dawn');
for(const track of Tracks){await music.play(track.id);assert.equal(timers.size,1);assert.equal(music.currentId,track.id);music.playEffect('confirm');}
music.setVolume(101);assert.equal(music.volume,100);music.setVolume(-1);assert.equal(music.volume,0);
document.hidden=true;await music._onVisibility();assert.equal(timers.size,0);assert.equal(music._context.state,'suspended');
document.hidden=false;await music._onVisibility();assert.equal(timers.size,1);assert.equal(music._context.state,'running');
music.pause();assert.equal(music.playing,false);assert.equal(timers.size,1);await music.play('unification');assert.equal(timers.size,1);
await music.dispose();assert.equal(timers.size,0);assert.equal(listeners.size,0);assert.equal(music._context.state,'closed');
console.log(JSON.stringify({tracks:Tracks.length,minDuration:Math.min(...Tracks.map(t=>t.duration)),maxDuration:Math.max(...Tracks.map(t=>t.duration)),distinctScores:new Set(signatures).size,eventCounts:Tracks.map(t=>[t.id,Music.inspect(t.id).eventCount]),lifecycle:'No autoplay; all 16 play; one scheduler across switches; hide suspend; visible resume; pause/resume; disposal tested with Web Audio API mock.'},null,2));
