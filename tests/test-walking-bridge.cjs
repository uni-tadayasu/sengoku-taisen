/* The real app bridge with a real game and in-memory storage/cloud responses. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const {SengokuEngine}=require('../engine.js'),source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=scope.window.SENGOKU_OFFICERS,clone=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);const lineEnd=source.indexOf('\n',start);if(source.slice(start,lineEnd).endsWith('}'))return source.slice(start,lineEnd);return source.slice(start,source.indexOf('\n  }',start)+4);}
function deferred(){let resolve,reject;return{promise:new Promise((yes,no)=>{resolve=yes;reject=no;}),get resolve(){return resolve;},get reject(){return reject;}};}
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await Promise.resolve();}assert(fn(),'Expected an asynchronous checkpoint');}
function harness({linked=false,started=true}={}){
 const stored=new Map(),trace=[],posts=[],events=[];const game=new SengokuEngine({officers:roster,seed:59});
 const clock={id:'walking-world',elapsedMs:100000,confirmedElapsedMs:100000,running:false,speed:0,revision:1,calendar:{turn:1,year:1560,month:2,cycle:0,elapsed:40}};
 game.applyWorldClock(clock);stored.set('save',game.exportSave());
 const control={user:{id:'player-one',name:'領主'},status:{linked,ready:true,writable:true,revision:10,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},deviceId:'current-writer',flushes:0,refreshes:0,clockReady:false,storageError:false};let c;
 const social={getUser:()=>control.user,walkingRequest:async(route,options)=>{const call={route,options:clone(options)};posts.push(call);trace.push('post');return control.onPost?control.onPost(call):{ok:true,revision:10,walkingSession:{id:'session-one'}};}};
 const sync={getStatus:()=>({...control.status}),getDevice:()=>({id:control.deviceId}),flush:async()=>{control.flushes++;trace.push('flush');return control.onFlush?control.onFlush():{ok:true};},refresh:async()=>{control.refreshes++;trace.push('refresh');return control.onRefresh?control.onRefresh():{ok:true};}};
 c={game,roster,SengokuEngine,Date,JSON,Math,Promise,URLSearchParams,state:()=>c.game.state,navigator:{onLine:true},saveKey:'save',saveEnabled:true,saveWarning:'',startPending:!started,localWalkingContext:null,syncAccess:{...control.status},fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,worldSettlementPending:false,worldCatchingUp:false,
  localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.storageError)throw Error('storage full');stored.set(key,value);},removeItem:key=>stored.delete(key)},
  window:{crypto:crypto.webcrypto,SengokuSocial:social,SengokuCloudSync:sync,SengokuWorldClock:{snapshot:()=>({ready:control.clockReady,clock}),accept:()=>trace.push('clock')},dispatchEvent:event=>{events.push(event.type);trace.push('save');}},
  CustomEvent:class{constructor(type){this.type=type;}},$:()=>null,renderHeader(){},refreshLiveControls(){},queueWorldProgress(){},toast(){}};
 vm.createContext(c);vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','save','getWalkingAccess','localWalkingOperation','requestWalking'].map(fn).join('\n'),c);
 return{c,control,stored,posts,trace,events,payload:()=>({sessionId:'11111111-1111-4111-8111-111111111111',campaignId:c.game.state.walking.campaignId})};
}
let count=0;async function test(name,work){await work();count++;console.log('PASS '+name);}
(async()=>{
await test('unlinked walking awards all five assets exactly once regardless of world-clock readiness or pause',()=>{
 const h=harness(),before=clone(h.c.game.state),payload=h.payload();assert.equal(h.c.canMutate(),false);assert.equal(h.c.getWalkingAccess().canClaim,true);
 assert(h.c.localWalkingOperation('begin',payload).ok);assert(h.c.localWalkingOperation('progress',{...payload,totalSteps:3}).ok);
 for(const key of ['gold','rice','wood','stone'])assert.equal(h.c.game.state.resources[key],before.resources[key]+6);assert.equal(h.c.game.state.magatama,before.magatama+6);
 const state=clone(h.c.game.state);assert(h.c.localWalkingOperation('progress',{...payload,totalSteps:3}).ok);assert.deepEqual(clone(h.c.game.state),state);assert.equal(h.c.game.state.walking.localSteps,3);
 assert(h.c.localWalkingOperation('end',payload).ok);assert.equal(h.c.localWalkingOperation('progress',{...payload,totalSteps:4}).ok,false);assert.equal(h.posts.length,0);
});
await test('failed local persistence rolls back currency and the walking receipt together',()=>{
 const h=harness(),payload=h.payload();h.c.localWalkingOperation('begin',payload);const before=clone(h.c.game.state),saved=h.stored.get('save');h.control.storageError=true;
 const failed=h.c.localWalkingOperation('progress',{...payload,totalSteps:3});assert.equal(failed.ok,false);assert.deepEqual(clone(h.c.game.state),before);assert.equal(h.stored.get('save'),saved);
 h.control.storageError=false;h.c.saveEnabled=true;assert(h.c.localWalkingOperation('progress',{...payload,totalSteps:3}).ok);assert.equal(h.c.game.state.resources.gold,before.resources.gold+6);
});
await test('unconfirmed first starts, foreign campaigns and linked identities cannot use local walking grants',()=>{
 for(const options of [{started:false},{linked:true}]){const h=harness(options),before=clone(h.c.game.state);assert.equal(h.c.localWalkingOperation('begin',h.payload()).ok,false);assert.deepEqual(clone(h.c.game.state),before);}
 const h=harness();assert.equal(h.c.localWalkingOperation('begin',{...h.payload(),campaignId:'other-campaign'}).ok,false);
});
await test('remote walking flushes current progress, uses the current writer and revision, then waits for canonical receipt visibility',async()=>{
 const h=harness({linked:true}),gate=deferred(),before=clone(h.c.game.state),payload={...h.payload(),seq:1,totalSteps:3,activeMs:2000,finish:false,sessionToken:'opaque-session-token',deviceId:'spoof',expectedRevision:999};
 h.control.onFlush=()=>gate.promise;h.control.onPost=()=>({ok:true,revision:12,walkingSession:{id:'session-one'},receipt:{seq:1,totalSteps:3,deltaSteps:3}});
 h.control.onRefresh=()=>{if(h.control.refreshes===2){h.control.status.revision=12;for(const key of ['gold','rice','wood','stone'])h.c.game.state.resources[key]+=6;h.c.game.state.magatama+=6;h.c.game.state.walking.serverSteps=3;}return{ok:true};};
 const task=h.c.requestWalking('/walking/claim',payload);await until(()=>h.control.flushes===1);assert.equal(h.c.walkingActionPending,true);assert.equal(h.c.canMutate(true),false);assert.equal(h.c.getWalkingAccess().canCount,true);assert.equal(h.posts.length,0);
 h.control.status.revision=11;gate.resolve({ok:true});const result=await task;assert.equal(result.receipt.totalSteps,3);assert.equal(h.posts[0].options.data.deviceId,'current-writer');assert.equal(h.posts[0].options.data.expectedRevision,11);assert.equal(h.posts[0].options.data.seq,1);assert.equal(h.control.refreshes,2);assert.equal(h.c.game.state.resources.gold,before.resources.gold+6);assert.equal(h.c.walkingActionPending,false);assert.deepEqual(h.trace.slice(0,3),['save','flush','post']);
});
await test('lost remote responses never fall back to local credit, and release the action barrier for a safe retry',async()=>{
 const h=harness({linked:true}),before=clone(h.c.game.state);h.control.onPost=()=>{throw Error('response lost');};
 await assert.rejects(h.c.requestWalking('/walking/claim',{...h.payload(),seq:1,totalSteps:3,activeMs:2000,finish:false}),/response lost/);assert.deepEqual(clone(h.c.game.state),before);assert.equal(h.c.walkingActionPending,false);
});
await test('account and campaign changes during a response prevent reconciliation into the replacement identity',async()=>{
 for(const change of ['account','campaign']){
  const h=harness({linked:true}),gate=deferred();h.control.onPost=()=>gate.promise;
  const task=h.c.requestWalking('/walking/start',{requestId:'22222222-2222-4222-8222-222222222222',campaignId:h.c.game.state.walking.campaignId});await until(()=>h.posts.length===1);
  if(change==='account')h.control.user={id:'other-player'};else h.c.game=new SengokuEngine({officers:roster,seed:60});
  gate.resolve({ok:true,revision:12,walkingSession:{id:'session-one'}});await assert.rejects(task,error=>error.code==='STALE_IDENTITY');assert.equal(h.control.refreshes,0);assert.equal(h.c.walkingActionPending,false);
 }
});
await test('follower, offline and expired-lease states block walking requests without touching the network',async()=>{
 for(const issue of ['follower','offline','expired']){const h=harness({linked:true});if(issue==='follower')h.c.syncAccess.writable=false;if(issue==='offline')h.c.navigator.onLine=false;if(issue==='expired')h.c.syncAccess.leaseExpiresAt=new Date(Date.now()-1000).toISOString();assert.equal(h.c.getWalkingAccess().canCount,false);await assert.rejects(h.c.requestWalking('/walking/start',{campaignId:h.c.game.state.walking.campaignId}));assert.equal(h.posts.length,0);}
});
console.log(`${count} walking app bridge checks passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
