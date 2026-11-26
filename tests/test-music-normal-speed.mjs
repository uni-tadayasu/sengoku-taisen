import assert from 'node:assert/strict';
import {fixture} from './helpers/music-fixture.mjs';
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
async function recording(f,index=f.files.length-1){assert(f.files[index]);f.files[index].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await flush();}
const player=f=>{const p=new f.Music({volume:10});p.setAuto(false);return p;};
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
await test('rapid song changes retain only one fading predecessor, never three or four layered recordings',async()=>{
 const f=fixture({recordings:true,media:true}),p=player(f),old=[];
 for(const [index,id] of ['town-dawn','battle-storm','castle-evening','victory-horizon'].entries()){
  await p.play(id);await recording(f);if(index)p._context.advance(index*.10);
  assert(p._sessions.size<=2);assert([...p._sessions].filter(s=>s.recording).length<=2);assert.equal([...p._sessions].filter(s=>s.active).length,1);old.push(p._session.recording.source);
 }
 assert.equal(old[0].connections.length,0);assert.equal(old[1].connections.length,0);assert.equal(old[0].buffer,null);assert.equal(old[1].buffer,null);
 p._context.advance(2);assert.equal(p._sessions.size,1);await p.dispose();assert(f.nodes.every(node=>!node.connections.length));
});
await test('same-song pause and immediate resume stop the old loop before starting the saved position',async()=>{
 const f=fixture({recordings:true,media:true}),p=player(f);await p.play('town-dawn');await recording(f);p._context.advance(.2);const prior=p._session.recording.source;p.pause();const saved=p._resumePosition;
 await p.play('town-dawn');assert.equal(prior.connections.length,0);assert.equal(prior.buffer,null);assert.equal(p._sessions.size,1);await recording(f);assert.equal([...p._sessions].filter(s=>s.recording).length,1);assert(p._session.start<p._context.currentTime+.055);assert(saved>0);assert.equal(p._session.position,saved);await p.dispose();
});
await test('a rejected stop still disconnects every superseded recording output',async()=>{
 const f=fixture({recordings:true}),p=player(f);await p.play('town-dawn');await recording(f);const old=p._session.recording;
 p.pause();old.source.stop=()=>{throw Error('source already ended');};await p.play('town-dawn');assert.equal(old.source.connections.length,0);assert.equal(old.gain.connections.length,0);assert.equal(old.source.buffer,null);assert.equal(p._sessions.size,1);await p.dispose();
});
await test('a repeated play/resume of the active song keeps one source and one unchanged playhead',async()=>{
 const f=fixture({recordings:true,media:true}),p=player(f);await p.play('town-dawn');await recording(f);const source=p._session.recording.source,start=p._session.start;
 p._context.advance(15);await Promise.all([p.play('town-dawn'),p.play('town-dawn'),p._onVisibility()]);await flush();assert.equal(p._session.recording.source,source);assert.equal(p._session.start,start);assert.equal(f.files.length,1);assert.equal(p._sessions.size,1);assert.equal(f.timers.size,0);await p.dispose();
});
await test('recorded sources start at normal speed and media rate changes are reset to one',async()=>{
 const f=fixture({recordings:true,media:true}),p=player(f),events=new Map(),create=f.document.createElement;
 f.document.createElement=name=>{const e=create(name);e.playbackRate=2;e.defaultPlaybackRate=2;e.preservesPitch=false;e.addEventListener=(type,fn)=>events.set(type,fn);e.removeEventListener=type=>events.delete(type);return e;};
 p._ensureContext();const e=f.mediaElements[0];assert.equal(e.playbackRate,1);assert.equal(e.defaultPlaybackRate,1);assert.equal(e.preservesPitch,true);
 const factory=p._context.createBufferSource.bind(p._context),param=value=>({value,events:[],cancelScheduledValues(time){this.events.push(['cancel',time]);},setValueAtTime(value,time){this.value=value;this.events.push([value,time]);}});
 p._context.createBufferSource=()=>{const node=factory();node.playbackRate=param(2);node.detune=param(1200);return node;};
 await p.play('shitaku');await recording(f);const source=p._session.recording.source;assert.equal(source.playbackRate.value,1);assert.equal(source.detune.value,0);
 e.playbackRate=2;e.defaultPlaybackRate=1.5;source.playbackRate.value=2;source.detune.value=1200;events.get('ratechange')();assert.equal(e.playbackRate,1);assert.equal(e.defaultPlaybackRate,1);assert.equal(source.playbackRate.value,1);assert.equal(source.detune.value,0);
 await p.dispose();assert.equal(events.size,0);
});
await test('long scheduler suspension skips obsolete notes in one seek and keeps the written note timings',async()=>{
 const f=fixture(),p=player(f);await p.play('battle-storm');const s=p._session,score=f.Music.inspect('battle-storm'),seen=[];
 p._context.advance(s.score.duration*80+5.25);const now=p._context.currentTime;p._voice=(session,event,time,duration)=>{seen.push({session,event,time,duration});return true;};p._schedule();
 assert.equal(s.cycle,Math.floor((now-.025-s.start)/s.score.duration));assert(seen.length>0&&seen.length<20,'only the current lookahead window is performed');
 for(const row of seen){const written=s.start+s.cycle*s.score.duration+row.event.beat*s.score.secondsPerBeat;assert(written>=now-.025&&written<=now+.18);assert.equal(row.time,Math.max(written,now+.003));assert.equal(row.duration,row.event.duration*s.score.secondsPerBeat);}
 const count=seen.length;p._schedule();assert.equal(seen.length,count,'the same window is not played twice');assert.equal(s.score.duration,score.duration);assert.equal([...f.timers.values()].filter(t=>t.ms===50).length,1);await p.dispose();
});
await test('fallback-to-recording handoff stays on a single active score under repeated visibility notifications',async()=>{
 const f=fixture({recordings:true,session:true}),p=player(f);await p.play('battle-storm');const active=p._session;assert(active.voices.size>0);p._context.advance(.1);await recording(f);assert.equal(p._session,active);assert(active.recording);assert.equal(active.bus.gain.value,0);assert.equal(active.roomBus.gain.value,0);assert.equal(f.files.length,1);
 f.document.hidden=true;await p._onVisibility();f.document.hidden=false;await Promise.all([p._onVisibility(),p._onVisibility(),p.play('battle-storm')]);await flush();assert.equal(p._session,active);assert.equal(p._sessions.size,1);assert.equal(f.files.length,1);assert.equal(f.timers.size,0);await p.dispose();
});
console.log(`${checks} normal-speed, bounded handoff and absolute-time scheduling checks passed.`);
