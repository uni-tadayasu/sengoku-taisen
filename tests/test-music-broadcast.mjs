import assert from 'node:assert/strict';
import {fixture} from './helpers/music-fixture.mjs';
const start=Date.parse('2026-11-27T05:00:00.000Z');
const DURATION=202.12;
const iso=value=>new Date(value).toISOString();
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const state=(revision=1,mode='loop',enabled=true)=>({enabled,mode,revision,startedAt:enabled?iso(start):null,updatedAt:iso(start)});
const make=(elapsed=0,extra={})=>fixture({recordings:true,media:true,decodeDuration:DURATION,now:start+elapsed*1000,...extra});
async function recording(f,index=f.files.length-1){assert(f.files[index],'recording requested');f.files[index].resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(4)});await flush();}
async function tick(f,when){const entry=[...f.timers].find(([,timer])=>timer.ms!==50&&timer.ms!==280&&timer.ms!==1000);assert(entry,'one programme timer exists');f.setNow(when);f.timers.delete(entry[0]);await entry[1].fn();await flush();}
const active=p=>[...p._sessions].filter(s=>s.active);
let passed=0;async function test(name,run){await run();passed++;console.log('PASS '+name);}

await test('the supplied broadcast stays separate from the existing twenty selectable songs',()=>{
 const f=make(),track=f.context.SENGOKU_BROADCAST_TRACK,playlist=f.context.SENGOKU_BROADCAST_PLAYLIST;
 assert.equal(f.Tracks.length,20);assert.equal(track.id,'operation-broadcast');assert.equal(track.duration,DURATION);assert.equal(track.recording,'assets/music/operation-broadcast.mp3');assert.equal(track.recordingOnly,true);
 assert.equal(playlist.length,21);assert.deepEqual(Array.from(playlist.slice(0,5),t=>t.id),['operation-broadcast','shitaku','asakatsu','hirukatsu','yorukatsu']);
});
await test('receiving a programme does not unpause or create an audio context for a silent player',async()=>{
 const f=make(),p=new f.Music({volume:0});assert.equal(await p.setBroadcast(state(),iso(start)),true);
 assert.equal(p.playing,false);assert.equal(f.contexts.length,0);assert.equal(f.files.length,0);assert.equal(f.timers.size,0);
 await p.setBroadcast(state(2,'continuous'),iso(start));await p.setBroadcast(state(3,'continuous',false),iso(start));assert.equal(f.contexts.length,0);await p.dispose();
});
await test('late joiners seek by server time and retain 1x playback and the personal volume',async()=>{
 const f=make(100),p=new f.Music({volume:23});await p.setBroadcast(state(),iso(start+100000));
 assert.equal(await p.attemptPlayback('hirukatsu'),'playing');assert.equal(p.currentId,'operation-broadcast');assert.equal(p.currentTrack.name,'全体BGM 00004');
 await recording(f);assert(Math.abs(p._session.recording.source.offset-(100%DURATION))<.0001);assert.equal(p._session.recording.source.loop,true);assert.equal(p.volume,23);assert.equal(active(p).length,1);await p.dispose();
});
await test('duplicate and stale polls cannot restart a song, change mode or accept malformed programme data',async()=>{
 const f=make(10),p=new f.Music();await p.setBroadcast(state(4),iso(start+10000));await p.play();await recording(f);const current=p._session;
 for(const data of [state(4),state(3,'continuous',false),{...state(5),mode:'random'},{...state(5),enabled:'true'},{...state(5),revision:4.1},{...state(5),startedAt:'wrong'}])assert.equal(await p.setBroadcast(data,iso(start+12000)),false);
 assert.equal(await p.setBroadcast(state(5),'wrong'),false);assert.equal(p._session,current);assert.equal(f.files.length,1);assert.equal(p.broadcast.revision,4);assert.equal(p.broadcast.enabled,true);await p.dispose();
});
await test('ON overrides manual selection, and OFF restores it without overwriting the personal setting',async()=>{
 const f=make(),p=new f.Music();p.setAuto(false);await p.play('battle-storm');await recording(f);
 await p.setBroadcast(state(),iso(start));await recording(f);assert.equal(p.currentId,'operation-broadcast');assert.equal(p.auto,false);
 await p.play('winter-silence');assert.equal(p.currentId,'operation-broadcast');
 await p.setBroadcast(state(2,'loop',false),iso(start));assert.equal(p.currentId,'winter-silence');await recording(f);assert.equal(p.auto,false);assert.equal(active(p).length,1);await p.dispose();
});
await test('scene and automatic changes do not displace the common programme, while OFF selects the current scene',async()=>{
 const f=make(),p=new f.Music({scene:'title'});await p.setBroadcast(state(),iso(start));await p.play();await recording(f);const source=p._session.recording.source;
 p.setScene('game');await p.play(f.Music.daypartTrackId());assert.equal(p.currentId,'operation-broadcast');assert.equal(p._session.recording.source,source);
 p.setScene('title');await p.setBroadcast(state(2,'loop',false),iso(start));assert.equal(p.currentId,'shitaku');await p.dispose();
});
await test('continuous playback advances automatically and a late joiner reaches the same playlist item',async()=>{
 const f=make(),p=new f.Music({scene:'title'});p.setAuto(false);await p.setBroadcast(state(1,'continuous'),iso(start));await p.play('battle-storm');await recording(f);assert.equal(p._session.recording.source.loop,false);
 const boundary=start+DURATION*1000+30;await tick(f,boundary);assert.equal(p.currentId,'shitaku');await recording(f);assert.equal(p._session.recording.source.loop,false);
 const late=make(DURATION+57.6+19),q=new late.Music();await q.setBroadcast(state(1,'continuous'),iso(start+(DURATION+57.6+19)*1000));await q.play();assert.equal(q.currentId,'asakatsu');await recording(late);assert(Math.abs(q._session.recording.source.offset-19)<.001);
 await p.setBroadcast(state(2,'continuous',false),iso(boundary));assert.equal(p.currentId,'battle-storm');await p.dispose();await q.dispose();
});
await test('mode revisions restart from their shared timestamp and fast changes never layer more than one predecessor',async()=>{
 const f=make(),p=new f.Music();await p.play('shitaku');await recording(f);
 for(let i=1;i<=6;i++){await p.setBroadcast(state(i,i%2?'loop':'continuous'),iso(start));await recording(f);assert.equal(active(p).length,1);assert(p._sessions.size<=2);}
 assert.equal(p.broadcast.mode,'continuous');assert.equal(p.currentId,'operation-broadcast');await p.dispose();assert(f.nodes.every(node=>!node.connections.length));
});
await test('pause persists across further operator changes and resuming catches up to the live position',async()=>{
 const f=make(),p=new f.Music();await p.setBroadcast(state(),iso(start));await p.play();await recording(f);p.pause();f.runTimer(280);
 await p.setBroadcast(state(2,'continuous'),iso(start));f.setNow(start+(DURATION+57.6+15)*1000);await f.listeners.get('visibilitychange')();assert.equal(p.playing,false);assert.equal(f.files.length,1);
 await p.play();assert.equal(p.currentId,'asakatsu');await recording(f);assert.equal(p.volume,10);await p.dispose();
});
await test('hidden pages, zero volume and voice calls catch up without stealing audio focus',async()=>{
 for(const kind of ['hidden','volume','voice']){
  const f=make(0,{session:true}),p=new f.Music({volume:31});await p.setBroadcast(state(1,'continuous'),iso(start));await p.play();await recording(f);
  if(kind==='hidden'){f.document.hidden=true;await p._onVisibility();}else if(kind==='volume'){p.setVolume(0);await flush();}else await p.setVoiceActive(true);
  assert.equal(f.timers.size,0);const resumes=f.calls.filter(x=>x==='context.resume').length;f.setNow(start+(DURATION+57.6+15)*1000);await p._onVisibility();assert.equal(f.calls.filter(x=>x==='context.resume').length,resumes);
  if(kind==='hidden'){f.document.hidden=false;await p._onVisibility();}else if(kind==='volume'){p.setVolume(31);await flush();}else await p.setVoiceActive(false);
  await flush();assert.equal(p.currentId,'asakatsu');await recording(f);assert.equal(active(p).length,1);assert.equal(p.volume,31);await p.dispose();
 }
});
await test('the same looping song seeks forward on foregrounding rather than resuming a frozen playhead',async()=>{
 const f=make(),p=new f.Music();await p.setBroadcast(state(),iso(start));await p.play();await recording(f);const old=p._session.recording.source;
 f.document.hidden=true;await p._onVisibility();f.setNow(start+17000);f.document.hidden=false;await p._onVisibility();await recording(f);
 assert.notEqual(p._session.recording.source,old);assert.equal(old.connections.length,0);assert(Math.abs(p._session.recording.source.offset-17)<.001);await p.dispose();
});
await test('an outdated download cannot become audible after OFF or a newer mode revision',async()=>{
 const f=make(),p=new f.Music();await p.setBroadcast(state(),iso(start));await p.play();const old=p._session;
 await p.setBroadcast(state(2,'loop',false),iso(start));assert.notEqual(p.currentId,'operation-broadcast');await recording(f,0);assert.equal(old.active,false);assert.equal(old.recording,null);await recording(f);assert.equal(active(p).length,1);await p.dispose();
});
await test('a load crossing a playlist boundary joins the current item instead of starting an obsolete track',async()=>{
 const f=make(DURATION-1),p=new f.Music();await p.setBroadcast(state(1,'continuous'),iso(start+(DURATION-1)*1000));await p.play();f.setNow(start+(DURATION+2)*1000);await recording(f,0);
 assert.equal(p.currentId,'shitaku');assert.equal(f.files.length,2);await recording(f);assert(Math.abs(p._session.recording.source.offset-2)<.001);await p.dispose();
});
await test('autoplay denial remains waiting and a gesture can retry the same broadcast',async()=>{
 let allow=false;const blocked=Object.assign(Error('gesture required'),{name:'NotAllowedError'});
 const f=make(0,{mediaPlayImpl:()=>allow?Promise.resolve():Promise.reject(blocked)}),p=new f.Music();await p.setBroadcast(state(),iso(start));assert.equal(await p.attemptPlayback(),'waiting');assert.equal(p.playing,false);
 allow=true;assert.equal(await p.attemptPlayback(),'playing');await recording(f);assert.equal(p.currentId,'operation-broadcast');await p.dispose();
});
await test('a programme arriving during an unresolved startup wins before any old recording is loaded',async()=>{
 let resolve;const f=make(0,{mediaPlayImpl:()=>new Promise(done=>{resolve=done;})}),p=new f.Music({scene:'title'});
 const opening=p.attemptPlayback('shitaku');await flush();assert(resolve);assert.equal(p.playing,false);
 await p.setBroadcast(state(),iso(start));f.mediaElements[0].playImpl=null;resolve();await flush();assert.equal(await opening,'playing');
 assert.equal(p.currentId,'operation-broadcast');assert.equal(f.files.length,1);assert(f.files[0].url.includes('operation-broadcast'));await recording(f);await p.dispose();
});
await test('a failed recording exposes a retryable error and releases the previous output',async()=>{
 const f=make(),errors=[],p=new f.Music({onPlaybackError:error=>errors.push(error)});await p.setBroadcast(state(),iso(start));await p.play();f.files[0].resolve({ok:false});await flush();assert.equal(errors.length,1);assert.equal(p.playing,false);
 await p.attemptPlayback();await recording(f);assert.equal(p.audible,true);assert.equal(active(p).length,1);await p.dispose();assert.equal(f.timers.size,0);
});
console.log(`${passed} operator music programme checks passed.`);
