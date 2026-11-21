/* Foreground strategy lifecycle with an injected bridge; no game or remote data is written. */
'use strict';
const assert=require('node:assert/strict'),{createController}=require('../strategy.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function deferred(){let resolve,reject;return{promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),get resolve(){return resolve;},get reject(){return reject;}};}
function harness(){
 let time=0,tid=0,uid=0,accessCallback;const timers=new Map(),events=new Map(),calls={begin:[],step:[],stop:[]},access={scopeId:'local/player/campaign/role/cycle',canRun:true,canAct:true,runId:null,reason:'ready',message:'出陣できます。'};
 const window={addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)},document={hidden:false,visibilityState:'visible',addEventListener:window.addEventListener,removeEventListener:window.removeEventListener};
 const decision={action:'attack',castleId:'himeji',castleName:'姫路城',tacticName:'堅陣',reason:'戦力を確認しました。',progress:{battles:0,maxBattles:3,remaining:3}};
 const bridge={getStrategyAccess:()=>({...access}),previewStrategy:text=>({ok:true,summary:text,policy:{maxBattles:3},decision:clone(decision)}),beginStrategy(text){calls.begin.push(text);access.runId='run-'+(++uid);return{ok:true,runId:access.runId,scopeId:access.scopeId,policy:{maxBattles:3},decision:clone(decision)};},stepStrategy(id){calls.step.push(id);return{ok:true,executed:true,decision:clone(decision),battle:{castleName:'姫路城',won:true,ourLost:20},message:'姫路城を占領しました。'};},stopStrategy(id){calls.stop.push(id);if(access.runId===id)access.runId=null;return{ok:true};}};
 const controller=createController({window,document,bridge:()=>bridge,now:()=>time,intervalMs:1,setTimeout:(fn,delay)=>{const id=++tid;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id),subscribeAccess:fn=>{accessCallback=fn;return()=>{accessCallback=null;};},subscribeClock:()=>()=>{}});
 async function advance(ms){const end=time+ms;for(let i=0;i<1000;i++){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await drain();}time=end;await drain();}
 function fire(name){for(const fn of [...events.get(name)||[]])fn();}
 return{controller,window,document,bridge,access,calls,timers,advance,fire,notify:()=>accessCallback?.()};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
 await test('a synchronous planning exception is contained and the next explicit start works',async()=>{
  const h=harness(),begin=h.bridge.beginStrategy;h.bridge.beginStrategy=()=>{throw Error('計画を確認できませんでした。');};const first=await h.controller.start('攻める');assert.equal(first.ok,false);assert.match(h.controller.getState().message,/計画を確認/);assert.equal(h.controller.getState().starting,false);assert.equal(h.timers.size,0);
  h.bridge.beginStrategy=begin;assert.equal((await h.controller.start('攻める')).ok,true);h.controller.dispose();
 });
 await test('parallel starts share one request and a late start after Stop cannot schedule an attack',async()=>{
  const h=harness(),d=deferred();h.bridge.beginStrategy=text=>{h.calls.begin.push(text);return d.promise;};const first=h.controller.start('攻める'),second=h.controller.start('攻める');assert.equal(first,second);await drain();assert.equal(h.calls.begin.length,1);h.controller.stop();d.resolve({ok:true,runId:'late-run',scopeId:h.access.scopeId});assert.equal((await first).ok,false);assert.deepEqual(h.calls.stop,['late-run']);assert.equal(h.timers.size,0);assert.equal(h.controller.getState().active,false);h.controller.dispose();
 });
 await test('attacks never overlap and every next evaluation waits at least eight real seconds',async()=>{
  const h=harness(),d=deferred(),normal=h.bridge.stepStrategy;h.bridge.stepStrategy=id=>{h.calls.step.push(id);return d.promise;};await h.controller.start('攻める');await h.advance(0);assert.equal(h.calls.step.length,1);await h.advance(45000);assert.equal(h.calls.step.length,1,'No catch-up burst or concurrent work');d.resolve({ok:true,executed:true,battle:{won:true},message:'占領しました。'});await drain();h.bridge.stepStrategy=normal;await h.advance(7999);assert.equal(h.calls.step.length,1);await h.advance(1);assert.equal(h.calls.step.length,2);h.controller.dispose();
 });
 await test('a temporary walking or synchronization lock waits without cancelling the strategy',async()=>{
  const h=harness();await h.controller.start('攻める');h.access.canAct=false;h.access.reason='busy';h.notify();await h.advance(0);assert.equal(h.calls.step.length,0);assert.equal(h.controller.getState().active,true);h.access.canAct=true;h.access.reason='ready';h.notify();await h.advance(7999);assert.equal(h.calls.step.length,0);await h.advance(1);assert.equal(h.calls.step.length,1);h.controller.dispose();
 });
 await test('the terminal battle is retained when the app clears its run during the pending step',async()=>{
  for(const lost of [false,true]){const h=harness();h.bridge.stepStrategy=id=>{h.calls.step.push(id);h.access.runId=null;if(lost){h.access.canRun=false;h.access.reason='defeat';}h.controller.refreshAccess();return{ok:true,executed:true,shouldStop:true,stopReason:lost?'defeat':'STRATEGY_LIMIT',message:lost?'姫路城から撤退しました。':'予定した出陣を終えました。',battle:{castleName:'姫路城',won:!lost,ourLost:99}};};await h.controller.start('攻める');await h.advance(0);const result=h.controller.getState();assert.equal(result.history.length,1);assert.equal(result.history[0].won,!lost);assert.equal(result.active,false);assert(!result.message.includes('STRATEGY_LIMIT'));assert(!result.message.includes('defeat'));assert.equal(h.timers.size,0);h.controller.dispose();}
 });
 await test('visibility, writer loss, world pause and identity changes stop without automatic resumption',async()=>{
  for(const reason of ['hidden','writer','clock','scope']){const h=harness(),d=deferred();h.bridge.stepStrategy=id=>{h.calls.step.push(id);return d.promise;};await h.controller.start('攻める');await h.advance(0);if(reason==='hidden'){h.document.hidden=true;h.fire('visibilitychange');}else if(reason==='scope'){h.access.scopeId='other-campaign';h.notify();}else{h.access.canRun=false;h.access.canAct=false;h.access.reason=reason==='writer'?'follower':'paused';h.notify();}assert.equal(h.controller.getState().active,false);d.resolve({ok:true,executed:false,waiting:true});await drain();h.document.hidden=false;h.access.canRun=true;h.access.canAct=true;h.notify();h.fire('visibilitychange');await h.advance(60000);assert.equal(h.calls.step.length,1);assert.equal(h.controller.getState().active,false);assert.equal(h.timers.size,0);h.controller.dispose();}
 });
 await test('a losing battle stops even if the adapter omits its stop flag',async()=>{
  const h=harness();h.bridge.stepStrategy=()=>({ok:true,executed:true,battle:{won:false,castleName:'姫路城'},message:'撤退しました。'});await h.controller.start('攻める');await h.advance(0);assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().history.length,1);assert.equal(h.timers.size,0);h.controller.dispose();
 });
 await test('hiding before the asynchronous start dispatch prevents the bridge from starting',async()=>{
  const h=harness(),start=h.controller.start('攻める');h.document.hidden=true;h.fire('visibilitychange');await start;assert.equal(h.calls.begin.length,0);assert.equal(h.calls.step.length,0);h.controller.dispose();
 });
 await test('the confirmed final attack stays at one, a new run starts at zero, and an unconfirmed result does not advance the displayed count',async()=>{
  for(const confirmed of [true,false]){const h=harness();h.bridge.stepStrategy=()=>({ok:confirmed,executed:true,confirmed,stop:true,message:confirmed?'設定した出陣回数に達しました。':'同期を確認しています。',battle:{won:true,castleName:'姫路城'},decision:{action:'attack',castleName:'姫路城',progress:{battles:0,maxBattles:1,remaining:1}},nextDecision:{action:'stop',progress:{battles:1,maxBattles:1,remaining:0}}});await h.controller.start('1回まで攻める');await h.advance(0);assert.equal(h.controller.getState().proposal.decision.progress.battles,confirmed?1:0);assert.equal(h.controller.getState().history.length,1);assert.equal(h.controller.getState().history[0].confirmed,confirmed);h.controller.refreshAccess();assert.equal(h.controller.getState().proposal.decision.progress.battles,confirmed?1:0,'Refreshing a completed run preserves its count');assert.equal((await h.controller.start('1回まで攻める')).ok,true);assert.equal(h.controller.getState().proposal.decision.progress.battles,0,'A new run uses a fresh zero-battle preview');h.controller.dispose();}
 });
 console.log(`${count} military strategy lifecycle checks passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
