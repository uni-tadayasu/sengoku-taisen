'use strict';
// The transport has a public fallback and also receives authoritative samples
// from authenticated sync/commands. Exercise both on one deterministic clock.
const assert=require('node:assert/strict');
const {create}=require('../world-clock.js');
const wall=Date.parse('2026-11-27T00:00:00Z');
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(){
 let time=0,online=true,hidden=false,next=0,handler;
 const timers=new Map(),requests=[];
 const sample=(overrides={})=>({id:'shared-world-v1',elapsedMs:600000+time,running:true,speed:1,revision:1,serverTime:new Date(wall+time).toISOString(),...overrides});
 const response=value=>({ok:true,json:async()=>({ok:true,clock:value})});
 const clock=create({base:'https://clock.example',offline:false,now:()=>time,online:()=>online,hidden:()=>hidden,
  setTimeout(fn,ms){timers.set(++next,{at:time+ms,fn});return next;},clearTimeout:id=>timers.delete(id),
  fetch(url,options){requests.push({at:time,url,options});return handler?handler(url,options):Promise.resolve(response(sample()));}});
 async function advance(ms){
  const target=time+ms;let steps=0;
  for(;;){
   await drain();
   const first=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0];
   if(!first||first[1].at>target)break;
   assert(++steps<100,'a failed request cannot cause an immediate retry loop');
   time=first[1].at;timers.delete(first[0]);first[1].fn();
  }
  time=target;await drain();
 }
 return{clock,requests,timers,sample,response,advance,time:()=>time,
  fetch:fn=>{handler=fn;},online:value=>{online=value;},hidden:value=>{hidden=value;},
  nextPoll:()=>Math.min(...[...timers.values()].map(timer=>timer.at))};
}
let checks=0;
async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 await test('unlinked play keeps the existing five-second public polling interval',async()=>{
  const f=fixture();await f.clock.start();await f.advance(60000);
  assert.equal(f.requests.length,13);assert.deepEqual(f.requests.map(row=>row.at),Array.from({length:13},(_,i)=>i*5000));
  assert(f.requests.every(row=>row.url==='https://clock.example/api/v1/world-clock'&&row.options.cache==='no-store'&&row.options.credentials==='omit'));
  assert.equal(f.clock.snapshot().ready,true);f.clock.stop();assert.equal(f.timers.size,0);
 });
 await test('twelve five-second sync samples remove all twelve redundant public requests',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());
  for(let i=0;i<12;i++){await f.advance(5000);assert(f.clock.accept(f.sample()));}
  assert.equal(f.requests.length,1);assert.equal(f.timers.size,1);assert.equal(f.nextPoll(),67000);
  assert.equal(f.clock.snapshot().clock.confirmedElapsedMs,660000);
  await f.advance(6999);assert.equal(f.requests.length,1);assert.equal(f.clock.snapshot().ready,true);
  await f.advance(1);assert.equal(f.requests.length,2,'losing sync, logging out or changing accounts leaves the public fallback armed');
  await f.advance(5000);assert.equal(f.requests.length,3,'standalone polling continues without a sync source');f.clock.stop();
 });
 await test('a later valid sync source resumes deduplication without an account-specific clock',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());await f.advance(7000);assert.equal(f.requests.length,2);
  await f.advance(500);f.clock.accept(f.sample());await f.advance(5000);f.clock.accept(f.sample());await f.advance(5000);f.clock.accept(f.sample());
  assert.equal(f.requests.length,2);assert.equal(f.clock.snapshot().clock.id,'shared-world-v1');f.clock.stop();
 });
 await test('rejected samples do not renew freshness or postpone the public fallback',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample({revision:3}));await f.advance(6500);
  const before=f.clock.snapshot(),deadline=f.nextPoll();
  assert.equal(f.clock.accept(f.sample({revision:2})),false);
  assert.equal(f.clock.accept(f.sample({revision:3,elapsedMs:599999})),false);
  for(const invalid of [{speed:3},{id:''},{elapsedMs:NaN},{running:'yes'},{serverTime:'invalid'}])assert.throws(()=>f.clock.accept(f.sample(invalid)));
  assert.deepEqual(f.clock.snapshot(),before);assert.equal(f.nextPoll(),deadline);assert.equal(deadline,7000);
  await f.advance(500);assert.equal(f.requests.length,2);f.clock.stop();
 });
 await test('paused samples remain fresh and revised speed changes apply immediately',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample({elapsedMs:600000,running:false,revision:2}));
  for(let i=0;i<6;i++){await f.advance(5000);f.clock.accept(f.sample({elapsedMs:600000,running:false,revision:2}));assert.equal(f.clock.snapshot().clock.elapsedMs,600000);}
  assert.equal(f.requests.length,1);assert.equal(f.clock.snapshot().ready,true);
  f.clock.accept(f.sample({elapsedMs:600000,running:true,speed:4,revision:3}));await f.advance(1000);
  assert.equal(f.clock.snapshot().clock.elapsedMs,604000);assert.equal(f.clock.snapshot().clock.confirmedElapsedMs,600000);assert.equal(f.requests.length,1);f.clock.stop();
 });
 await test('explicit refreshes still revalidate a fresh sample and coalesce in-flight calls',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());let reply;
  f.fetch(()=>new Promise(resolve=>{reply=resolve;}));
  const one=f.clock.refresh(),two=f.clock.refresh(),three=f.clock.refresh();await drain();assert.equal(f.requests.length,2);
  reply(f.response(f.sample()));await Promise.all([one,two,three]);assert.equal(f.requests.length,2);assert.equal(f.timers.size,1);f.clock.stop();
 });
 await test('a delayed older public result cannot erase a newer sync sample or its deadline',async()=>{
  const f=fixture();let reply;f.fetch(()=>new Promise(resolve=>{reply=resolve;}));const started=f.clock.start();await drain();
  await f.advance(1000);f.clock.accept(f.sample({revision:2,speed:4}));await f.advance(1000);
  reply(f.response(f.sample({elapsedMs:600000,revision:1})));await started;
  assert.equal(f.clock.snapshot().clock.revision,2);assert.equal(f.clock.snapshot().clock.confirmedElapsedMs,601000);assert.equal(f.clock.snapshot().clock.speed,4);assert.equal(f.nextPoll(),8000);
  f.fetch(()=>Promise.resolve(f.response(f.sample({revision:2,speed:4}))));await f.advance(6000);assert.equal(f.requests.length,2);f.clock.stop();
 });
 await test('network errors retry at bounded intervals and keep the fifteen-second freshness limit',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());f.fetch(()=>Promise.reject(Error('offline upstream')));
  await f.advance(7000);assert.equal(f.requests.length,2);assert.equal(f.clock.snapshot().ready,true);assert.equal(f.nextPoll(),12000);
  await f.advance(8000);assert.equal(f.requests.length,3);assert.equal(f.clock.snapshot().ready,true);assert.equal(f.clock.snapshot().clock.confirmedElapsedMs,600000);
  await f.advance(1);assert.equal(f.clock.snapshot().ready,false);await f.advance(1999);assert.equal(f.requests.length,4);f.clock.stop();
 });
 await test('a fresh sync sample received during a failed public request survives that failure',async()=>{
  const f=fixture();let reject;f.fetch(()=>new Promise((resolve,fail)=>{reject=fail;}));const started=f.clock.start();await drain();
  await f.advance(4000);f.clock.accept(f.sample({revision:2}));await f.advance(1000);reject(Error('failed earlier request'));await started;
  assert.equal(f.clock.snapshot().ready,true);assert.equal(f.clock.snapshot().clock.confirmedElapsedMs,604000);assert.equal(f.nextPoll(),11000);f.clock.stop();
 });
 await test('hidden tabs stop polling and foreground return always revalidates immediately',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());f.hidden(true);f.clock.visibility();assert.equal(f.timers.size,0);
  await f.advance(20000);await f.clock.refresh();assert.equal(f.requests.length,1);assert.equal(f.clock.snapshot().ready,false);
  f.clock.accept(f.sample());assert.equal(f.timers.size,0,'an in-flight sync may finish while hidden but cannot arm a poll');
  f.hidden(false);f.clock.visibility();await drain();assert.equal(f.requests.length,2);assert.equal(f.clock.snapshot().ready,true);assert.equal(f.timers.size,1);f.clock.stop();
 });
 await test('offline status does not fetch and restored connectivity revalidates immediately',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());f.online(false);await f.clock.refresh();await f.advance(20000);
  assert.equal(f.requests.length,1);assert.equal(f.clock.snapshot().ready,false);
  f.online(true);await f.clock.refresh();assert.equal(f.requests.length,2);assert.equal(f.clock.snapshot().ready,true);f.clock.stop();
 });
 await test('a hung fallback times out and cannot create parallel requests or a retry storm',async()=>{
  const f=fixture();await f.clock.start();f.clock.accept(f.sample());f.fetch((url,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('timeout')),{once:true})));
  await f.advance(7000);assert.equal(f.requests.length,2);const same=f.clock.refresh();await drain();assert.equal(f.requests.length,2);
  await f.advance(8000);await same;assert.equal(f.clock.snapshot().ready,true);assert.equal(f.nextPoll(),20000);assert.equal(f.timers.size,1);
  await f.advance(1);assert.equal(f.clock.snapshot().ready,false);assert.equal(f.requests.length,2);f.clock.stop();assert.equal(f.timers.size,0);
 });
 console.log(`${checks} world-clock polling checks passed; 60 seconds of sync: 1 initial public request instead of 13, with the original 15-second readiness limit.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
