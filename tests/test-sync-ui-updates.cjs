'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){
 const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);
 const firstEnd=source.indexOf('\n',start);
 if(source.slice(start,firstEnd).endsWith('}'))return source.slice(start,firstEnd);
 const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);
}
function fixture(patch={}){
 let now=100000,listener=null,applies=0;
 const counts={evaluation:0,controls:0,strategy:0,hints:0,prime:0,branches:0,maintenance:0,header:0},controlStates=[],timers=new Map();let serial=0;
 const game={state:{worldClock:{id:'shared',elapsedMs:1000},command:2},getMaintenanceStatus:()=>null,setBranchAuthority(){counts.branches++;},setMaintenanceAuthority(){counts.maintenance++;},applyWorldClock(clock){applies++;game.state.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};return{ok:true,changed:true};}};
 let shared={ready:true,clock:{id:'shared',elapsedMs:1000,confirmedElapsedMs:1000,running:true,speed:1,calendar:{elapsed:1,cycle:1}}};
 const scope={game,syncAccess:{linked:true,ready:true,writable:true,banned:false,rolePending:false,reason:'writer',message:'',leaseExpiresAt:new Date(now+30000).toISOString(),...patch},evaluationOwnerId:'lord-one',startPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,worldSettlementPending:false,worldCatchingUp:false,worldCatchupTimer:null,worldClockStatusKey:'true:true:1:1',maintenanceCatchupPending:false,activeModal:'',lastRealtime:0,saveCounter:0,document:{hidden:false},Date:class extends Date{static now(){return now;}},performance:{now:()=>now},Promise,
  setTimeout(callback){const id=++serial;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),$:()=>null,
  refreshEvaluationUI:()=>counts.evaluation++,refreshLiveControls:()=>{counts.controls++;controlStates.push(scope.canMutate());},renderHeader:()=>counts.header++,refreshJobTimers(){},state:()=>game.state,save:()=>true,
  window:{SengokuBridge:{primeProgress:()=>counts.prime++},SengokuSocial:{getUser:()=>({id:'lord-one'})},SengokuStrategy:{refreshAccess:()=>counts.strategy++},SengokuHintsUI:{refresh:()=>counts.hints++},SengokuWorldClock:{snapshot:()=>shared,subscribe(callback){listener=callback;}}}
 };
 vm.createContext(scope);vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','queueWorldProgress','setSyncAccess','processWorldClock'].map(fn).join('\n'),scope);
 const subscription=source.match(/window\.SengokuWorldClock\?\.subscribe\([^\n]*?\);window\.SengokuWorldClock\?\.start/);assert(subscription,'production clock subscription');
 vm.runInContext(subscription[0].slice(0,subscription[0].lastIndexOf(';window'))+';',scope);
 return{scope,counts,controlStates,timers,now:value=>{now=value;},emitClock(value){shared=value;listener(value);},run(){const queued=[...timers.entries()];for(const[id,callback]of queued){timers.delete(id);callback();}},applies:()=>applies};
}
const checks=[];function test(name,run){checks.push([name,run]);}
test('save progress and lease renewals retain authority without repeated UI work',async()=>{
 const f=fixture();
 for(let revision=1;revision<=100;revision++)f.scope.setSyncAccess({revision,updatedAt:String(revision),message:revision%2?'変更を自動保存しています…':'',leaseExpiresAt:new Date(140000+revision).toISOString()});
 assert.equal(f.scope.syncAccess.revision,100);assert.equal(f.scope.syncAccess.leaseExpiresAt,new Date(140100).toISOString());assert.equal(f.scope.canMutate(),true);
 assert.equal(f.counts.controls,0);assert.equal(f.counts.evaluation,0);assert.equal(f.counts.strategy,0);assert.equal(f.counts.hints,0);assert.equal(f.timers.size,0);
 await Promise.resolve();assert.equal(f.counts.prime,100,'pending recap/initial priming still receives status events');
});
test('renewing an effectively expired lease refreshes access even with identical status flags',()=>{
 const f=fixture();f.now(131000);assert.equal(f.scope.canMutate(),false);
 f.scope.setSyncAccess({leaseExpiresAt:new Date(160000).toISOString()});assert.equal(f.scope.canMutate(),true);assert.equal(f.counts.controls,1);assert.equal(f.timers.size,1);
});
test('follower and recovered writer transitions immediately update write guards',()=>{
 const f=fixture();f.scope.setSyncAccess({reason:'follower',writable:false,leaseExpiresAt:null});assert.equal(f.scope.canMutate(),false);assert.deepEqual(f.controlStates,[false]);
 f.scope.setSyncAccess({reason:'writer',writable:true,leaseExpiresAt:new Date(140000).toISOString()});assert.equal(f.scope.canMutate(),true);assert.deepEqual(f.controlStates,[false,true]);assert.equal(f.timers.size,1);
});
test('authentication and BAN still invalidate branch and maintenance authorities',()=>{
 for(const patch of [{reason:'auth',ready:false,writable:false,rolePending:true},{reason:'banned',banned:true,writable:false}]){
  const f=fixture();f.scope.setSyncAccess(patch);assert.equal(f.scope.canMutate(),false);assert.equal(f.counts.branches,1);assert.equal(f.counts.maintenance,1);assert.deepEqual(f.controlStates,[false]);
 }
});
test('disconnect clears identity attribution and refreshes the local view',()=>{
 const f=fixture();f.scope.setSyncAccess({linked:false,reason:'local',ready:true,writable:true,leaseExpiresAt:null});assert.equal(f.scope.evaluationOwnerId,'');assert.equal(f.counts.branches,1);assert.equal(f.counts.maintenance,1);assert.equal(f.counts.evaluation,1);assert.equal(f.counts.controls,1);
});
test('initial ready transition confirms the current owner and schedules catch-up',async()=>{
 const f=fixture({ready:false,writable:false,reason:'initializing'});f.scope.evaluationOwnerId='';
 f.scope.setSyncAccess({ready:true,writable:true,reason:'writer'});assert.equal(f.scope.evaluationOwnerId,'lord-one');assert.equal(f.counts.controls,1);assert.equal(f.timers.size,1);
 await Promise.resolve();assert.equal(f.counts.prime,1);
});
test('action-required error text updates while redundant error metadata stays quiet',()=>{
 const f=fixture({reason:'error',writable:false,message:'通信を確認してください。'});
 f.scope.setSyncAccess({message:'再接続してください。'});assert.equal(f.counts.controls,1);f.scope.setSyncAccess({revision:2,updatedAt:'later'});assert.equal(f.counts.controls,1);
});
test('clock samples apply once before controls repaint without a temporary disabled flash',()=>{
 const f=fixture();const clock={id:'shared',elapsedMs:5000,confirmedElapsedMs:5000,running:true,speed:1,calendar:{elapsed:5,cycle:1}};
 f.emitClock({ready:true,clock});f.emitClock({ready:true,clock});assert.equal(f.scope.canMutate(),false,'mutation guards block before catch-up');assert.equal(f.counts.controls,0);assert.equal(f.timers.size,1);
 f.run();assert.equal(f.applies(),1);assert.deepEqual(f.controlStates,[true]);assert.equal(f.scope.canMutate(),true);
});
test('unavailable clocks still disable controls on the queued update',()=>{
 for(const unavailable of [{ready:false,clock:null},{ready:false,clock:{id:'shared',elapsedMs:5000,confirmedElapsedMs:5000,calendar:{elapsed:5}}}]){
  const f=fixture();f.emitClock(unavailable);assert.equal(f.scope.canMutate(),false);f.run();assert.equal(f.applies(),0);assert.deepEqual(f.controlStates,[false]);assert.equal(f.counts.header,1);
 }
});
(async()=>{for(const[name,run]of checks){await run();console.log('PASS '+name);}console.log(checks.length+' sync/clock UI update scenarios passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
