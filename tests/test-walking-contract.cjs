/* Independent lifecycle contracts. No browser automation or live API requests. */
const assert=require('node:assert/strict');
const {createController}=require('../walking.js');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const clone=v=>JSON.parse(JSON.stringify(v));
const drain=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
function harness(options={}){
 let time=0,timerId=0,uid=0,permissionCalls=0,wakeCalls=0;
 const store=options.store||new Map(),timers=new Map(),windowEvents=new Map(),docEvents=new Map(),calls={start:[],claim:[],localStart:[],localProgress:[],localEnd:[]},sessions=new Map(),localTotals=new Map();
 const a={started:true,mode:'local',ownerId:'local_player',campaignId:'campaign_a',canCount:true,canClaim:true,totalSteps:0,...options.access};
 const eventTarget=(map)=>({addEventListener:(type,fn)=>{if(!map.has(type))map.set(type,new Set());map.get(type).add(fn);},removeEventListener:(type,fn)=>map.get(type)?.delete(fn)});
 const document={hidden:false,visibilityState:'visible',...eventTarget(docEvents)};
 const navigator={onLine:true,wakeLock:{request:()=>{wakeCalls++;return options.wake?options.wake():Promise.resolve({released:false,release(){this.released=true;return Promise.resolve();},addEventListener(){}});}}};
 const window={...eventTarget(windowEvents),document,navigator,isSecureContext:true,DeviceMotionEvent:{requestPermission:()=>{permissionCalls++;return options.permission?options.permission():Promise.resolve('granted');}}};
 const bridge={getWalkingAccess:()=>({...a}),
  beginLocalWalkingSession:async body=>{calls.localStart.push(clone(body));if(!localTotals.has(body.sessionId))localTotals.set(body.sessionId,0);return{ok:true};},
  applyLocalWalkingProgress:async body=>{calls.localProgress.push(clone(body));const before=localTotals.get(body.sessionId)||0,delta=Math.max(0,body.totalSteps-before);localTotals.set(body.sessionId,Math.max(before,body.totalSteps));a.totalSteps+=delta;return{ok:true,deltaSteps:delta};},
  endLocalWalkingSession:async body=>{calls.localEnd.push(clone(body));return{ok:true};},
  startWalkingSession:async body=>{calls.start.push(clone(body));if(options.start)return options.start(body);let s=sessions.get(body.requestId);if(!s){s={id:'session_'+body.requestId,token:'private_test_token',campaignId:body.campaignId,lastSeq:0,totalSteps:0,activeMs:0,closed:false,expiresAt:'2099-01-01T00:00:00.000Z'};sessions.set(body.requestId,s);}return{ok:true,walkingSession:clone(s)};},
  claimWalkingSteps:async body=>{calls.claim.push(clone(body));if(options.claim)return options.claim(body);const s=[...sessions.values()].find(v=>v.id===body.sessionId);s.lastSeq=body.seq;s.totalSteps=body.totalSteps;s.activeMs=body.activeMs;s.closed=body.finish;a.totalSteps=body.totalSteps;return{ok:true,receipt:{seq:body.seq,totalSteps:body.totalSteps},walkingSession:clone(s)};}
 };
 const make=()=>createController({window,document,navigator,bridge:()=>bridge,storage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)},now:()=>time,wallNow:()=>1795220000000+time,setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id),uuid:()=>`walk_request_${++uid}`,subscribeAccess:()=>()=>{}});
 let controller=make();
 const dispatch=(map,type,event={})=>{for(const fn of [...(map.get(type)||[])])fn(event);};
 async function advance(ms){const target=time+ms;for(let guard=0;guard<1000;guard++){const due=[...timers].filter(([,v])=>v.at<=target).sort((x,y)=>x[1].at-y[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();await drain();}time=target;await drain();}
 async function walk(ms=4200,trusted=true){const began=time;while(time<began+ms){await advance(20);dispatch(windowEvents,'devicemotion',{isTrusted:trusted,accelerationIncludingGravity:{x:0,y:0,z:9.81+2.8*Math.sin(2*Math.PI*(time-began)/620)},acceleration:null});await drain();}}
 function hide(){document.hidden=true;document.visibilityState='hidden';dispatch(docEvents,'visibilitychange');}
 function show(){document.hidden=false;document.visibilityState='visible';dispatch(docEvents,'visibilitychange');}
 return{a,calls,store,window,document,bridge,navigator,make,get controller(){return controller;},replaceController(){controller=make();return controller;},advance,walk,hide,show,dispatchWindow:(name,event)=>dispatch(windowEvents,name,event),get time(){return time;},get permissionCalls(){return permissionCalls;},get wakeCalls(){return wakeCalls;},listenerCount:name=>(windowEvents.get(name)||new Set()).size};
}
(async()=>{
 await test('permission is requested in the original start turn; a later hidden-page resolution cannot start tracking',async()=>{
  const permission=deferred(),h=harness({permission:()=>permission.promise});const started=h.controller.startFromGesture();assert.equal(h.permissionCalls,1);assert.equal(h.calls.localStart.length,0);h.hide();permission.resolve('granted');await started;await drain();assert.equal(h.controller.getState().active,false);assert.equal(h.listenerCount('devicemotion'),0);assert.equal(h.wakeCalls,0);h.controller.dispose();
 });
 await test('a wake lock resolving after Stop is released instead of keeping the screen awake',async()=>{
  const wait=deferred();let releases=0;const h=harness({wake:()=>wait.promise});await h.controller.startFromGesture();assert.equal(h.controller.getState().active,true);await h.controller.stop();wait.resolve({released:false,release(){releases++;return Promise.resolve();},addEventListener(){}});await drain();assert.equal(releases,1);assert.equal(h.controller.getState().active,false);assert.equal(h.listenerCount('devicemotion'),0);h.controller.dispose();
 });
 await test('synthetic events cannot award steps, and a hidden page cannot extend an established walk',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.walk(4200,false);assert.equal(h.controller.getState().estimatedSteps,0);assert.equal(h.calls.localProgress.length,0);await h.walk(4200,true);assert(h.controller.getState().estimatedSteps>=3);const count=h.controller.getState().estimatedSteps;h.hide();await h.walk(6000,true);assert.equal(h.controller.getState().estimatedSteps,count);assert.equal(h.listenerCount('devicemotion'),0);h.controller.dispose();
 });
 await test('changing account while permission is pending cannot attach sensors to the replacement account',async()=>{
  const permission=deferred(),h=harness({permission:()=>permission.promise});const start=h.controller.startFromGesture();h.a.ownerId='replacement_player';h.controller.refreshAccess();permission.resolve('granted');await start;assert.equal(h.controller.getState().active,false);assert.equal(h.calls.localStart.length,0);assert.equal(h.listenerCount('devicemotion'),0);h.controller.dispose();
 });
 await test('a new campaign under the same player stops the old walk and can begin a clean session',async()=>{
  const h=harness({access:{ownerId:'same_player'}});await h.controller.startFromGesture();await h.walk(2200);const oldCampaign=h.calls.localStart[0].campaignId;h.a.campaignId='campaign_b';h.controller.refreshAccess();assert.equal(h.controller.getState().active,false);const result=await h.controller.startFromGesture();assert.equal(result.ok,true);assert.equal(h.calls.localStart.at(-1).campaignId,'campaign_b');assert.notEqual(oldCampaign,'campaign_b');assert.equal(h.controller.getState().estimatedSteps,0);h.controller.dispose();
 });
 await test('switching local awards to a connected session does not upload already credited guest steps',async()=>{
  const h=harness({access:{ownerId:'same_player'}});await h.controller.startFromGesture();await h.walk();assert(h.a.totalSteps>0);h.a.mode='remote';h.controller.refreshAccess();assert.equal(h.controller.getState().active,false);const result=await h.controller.startFromGesture();assert.equal(result.ok,true);assert.equal(h.controller.getState().estimatedSteps,0);await h.controller.stop();assert(h.calls.claim.every(v=>v.totalSteps===0));h.controller.dispose();
 });
 await test('losing a committed response retries the identical pending sequence without a second credit',async()=>{
  let balance=0,lost=true;const receipts=new Map();const h=harness({access:{mode:'remote',ownerId:'cloud_player'},claim:async body=>{const key=body.sessionId+':'+body.seq,existing=receipts.get(key);if(existing){assert.deepEqual(body,existing.body);return clone(existing.result);}const before=[...receipts.values()].reduce((max,x)=>Math.max(max,x.body.totalSteps),0);balance+=(body.totalSteps-before)*2;const result={ok:true,receipt:{seq:body.seq,totalSteps:body.totalSteps}};receipts.set(key,{body:clone(body),result});if(lost&&body.totalSteps>0){lost=false;throw Error('response was lost after commit');}return result;}});
  await h.controller.startFromGesture();await h.walk(5800);assert(h.calls.claim.some(v=>v.totalSteps>0));const credited=balance;assert(credited>0);const first=clone(h.calls.claim.find(v=>v.totalSteps>0));await h.controller.retry();await drain();assert(h.calls.claim.filter(v=>v.seq===first.seq).length>=2);assert.equal(balance,credited);assert.equal(h.controller.getState().pendingSteps,0);assert.equal(h.controller.getState().closed,true);assert(!JSON.stringify(h.controller.getState()).includes('private_test_token'));h.controller.dispose();
 });
 await test('a delayed original receipt during expired-session finalization is recovered before the next final sequence',async()=>{
  let original=null,credited=0,accepted=false;
  const h=harness({access:{mode:'remote',ownerId:'late_receipt_player'},claim:async body=>{
   if(body.seq===1&&!body.finish&&!original){original=clone(body);const e=Error('expired before this retry was accepted');e.code='WALKING_EXPIRED';throw e;}
   if(body.seq===1&&body.finish){if(!accepted){credited=original.totalSteps*2;accepted=true;}const e=Error('an earlier non-final request committed');e.code='WALKING_SEQUENCE_REUSED';throw e;}
   if(body.seq===1){assert.deepEqual(body,original);return{ok:true,receipt:{seq:1,totalSteps:original.totalSteps}};}
   assert.equal(body.seq,2);assert.equal(body.finish,true);assert(body.totalSteps>=original.totalSteps);credited+=(body.totalSteps-original.totalSteps)*2;return{ok:true,receipt:{seq:2,totalSteps:body.totalSteps}};
  }});
  await h.controller.startFromGesture();await h.walk(5800);await h.controller.retry();await drain();assert(original&&original.totalSteps>0);assert.equal(h.controller.getState().closed,true);assert.equal(h.controller.getState().pendingSteps,0);assert.equal(credited,h.controller.getState().confirmedSteps*2);h.controller.dispose();
 });
 console.log(`${passed} independent walking lifecycle contracts passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
