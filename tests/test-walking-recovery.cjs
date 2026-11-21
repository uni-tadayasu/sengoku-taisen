/* Unsupported hardware, durable queues and rejected-step recovery in memory. */
const assert=require('node:assert/strict'),{createController}=require('../walking.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const drain=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function deferred(){let resolve;return{promise:new Promise(done=>{resolve=done;}),get resolve(){return resolve;}};}
function harness({remote=false,permission,claim}={}){
 let time=0,tid=0,uid=0;const timers=new Map(),events=new Map(),stored=new Map(),sessions=new Map(),calls={permission:0,start:[],claim:[],local:[]};
 const control={failStorage:false},access={started:true,mode:remote?'remote':'local',ownerId:'player-one',campaignId:'campaign-one',canCount:true,canClaim:true};
 const window={isSecureContext:true,DeviceMotionEvent:{requestPermission(){calls.permission++;return permission?permission():Promise.resolve('granted');}},addEventListener:(name,fn)=>{if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener:(name,fn)=>events.get(name)?.delete(fn)};
 const document={hidden:false,visibilityState:'visible',addEventListener:window.addEventListener,removeEventListener:window.removeEventListener},navigator={onLine:true};
 const bridge={getWalkingAccess:()=>({...access}),beginLocalWalkingSession:async()=>({ok:true}),applyLocalWalkingProgress:async body=>{calls.local.push(clone(body));return{ok:true};},endLocalWalkingSession:async()=>({ok:true}),startWalkingSession:async body=>{calls.start.push(clone(body));if(control.start)return control.start(body);let session=sessions.get(body.requestId);if(!session){session={id:'session-'+body.requestId,token:'private-token',campaignId:body.campaignId,lastSeq:0,totalSteps:0,activeMs:0,closed:false};sessions.set(body.requestId,session);}return{ok:true,walkingSession:clone(session)};},claimWalkingSteps:async body=>{calls.claim.push(clone(body));return claim?claim(body):{ok:true,receipt:{seq:body.seq,totalSteps:body.totalSteps}};}};
 const controller=createController({window,document,navigator,bridge:()=>bridge,storage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.failStorage)throw Error('quota');stored.set(key,value);}},now:()=>time,setTimeout:(fn,ms)=>{const id=++tid;timers.set(id,{fn,at:time+ms});return id;},clearTimeout:id=>timers.delete(id),uuid:()=>`request-${++uid}`,subscribeAccess:()=>()=>{}});
 async function advance(ms){const end=time+ms;for(let i=0;i<1000;i++){const next=[...timers].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await drain();}time=end;await drain();}
 function fire(name,event={}){for(const fn of [...(events.get(name)||[])])fn(event);}
 async function walk(ms=5800){const start=time;while(time<start+ms){await advance(20);fire('devicemotion',{isTrusted:true,accelerationIncludingGravity:{x:0,y:0,z:9.81+2.8*Math.sin(2*Math.PI*(time-start)/620)}});await drain();}}
 return{controller,window,document,control,access,bridge,calls,stored,advance,fire,walk,listeners:name=>events.get(name)?.size||0};
}
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
await test('denied permissions, insecure contexts and unsupported hardware never create walking sessions',async()=>{
 for(const issue of ['denied','insecure','unsupported']){const h=harness({permission:()=>Promise.resolve('denied')});if(issue==='insecure')h.window.isSecureContext=false;if(issue==='unsupported')delete h.window.DeviceMotionEvent;assert.equal((await h.controller.startFromGesture()).ok,false);assert.equal(h.controller.getState().active,false);assert.equal(h.listeners('devicemotion'),0);assert.equal(h.calls.local.length,0);assert.equal(h.calls.start.length,0);h.controller.dispose();}
});
await test('repeated Start clicks share one permission request and a Stop cancels its eventual result',async()=>{
 const pending=deferred(),h=harness({permission:()=>pending.promise}),first=h.controller.startFromGesture(),second=h.controller.startFromGesture();assert.equal(first,second);assert.equal(h.calls.permission,1);await h.controller.stop();pending.resolve('granted');await first;assert.equal(h.listeners('devicemotion'),0);assert.equal(h.controller.getState().active,false);h.controller.dispose();
});
await test('missing sensor data waits without ending and pagehide suspends acquisition before visibility changes',async()=>{
 const h=harness();await h.controller.startFromGesture();await h.advance(9000);assert.equal(h.controller.getState().active,true);assert.equal(h.controller.getState().running,true);assert.equal(h.controller.getState().reason,'sensor');assert.equal(h.controller.getState().estimatedSteps,0);
 await h.controller.startFromGesture();await h.walk(3000);h.fire('pagehide');const elapsed=h.controller.getState().activeMs;assert.equal(h.controller.getState().active,false);assert.equal(h.listeners('devicemotion'),0);await h.advance(20000);assert.equal(h.controller.getState().activeMs,elapsed);h.controller.dispose();
});
await test('a rejected rate report stays visibly uncredited until an explicit zero-delta close, then restarts cleanly',async()=>{
 const h=harness({remote:true,claim:async body=>{if(body.totalSteps>0)throw Object.assign(Error('rate rejected'),{code:'WALKING_RATE_EXCEEDED'});return{ok:true,receipt:{seq:body.seq,totalSteps:0}};}});
 await h.controller.startFromGesture();await h.walk();const rejected=h.controller.getState();assert(rejected.estimatedSteps>0);assert.equal(rejected.rejected,true);assert.equal(rejected.confirmedSteps,0);const count=h.calls.claim.length;
 await h.controller.retry();assert.equal(h.calls.claim.length,count,'A rejected report is not repeatedly submitted without an explicit decision');
 assert.equal((await h.controller.closeRejected()).ok,true);const closed=h.controller.getState();assert.equal(closed.closed,true);assert.equal(closed.pendingSteps,0);assert.equal(closed.rejectedSteps,rejected.estimatedSteps);const final=h.calls.claim.at(-1);assert.equal(final.totalSteps,0);assert.equal(final.activeMs,0);assert.equal(final.finish,true);
 assert.equal((await h.controller.startFromGesture()).ok,true);assert.equal(h.controller.getState().estimatedSteps,0);assert.equal(h.calls.local.length,0);h.controller.dispose();
});
await test('storage failure pauses before local credit and the retained cumulative report can be retried',async()=>{
 const h=harness();await h.controller.startFromGesture();h.control.failStorage=true;await h.walk();assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().reason,'WALKING_STORAGE');assert.equal(h.calls.local.length,0);const counted=h.controller.getState().estimatedSteps;assert(counted>0);
 h.control.failStorage=false;await h.controller.retry();assert.equal(h.controller.getState().confirmedSteps,counted);assert.equal(h.calls.local[0].totalSteps,counted);h.controller.dispose();
});
await test('late cloud receipts cannot become local rewards after logout',async()=>{
 const pending=deferred(),h=harness({remote:true,claim:()=>pending.promise});await h.controller.startFromGesture();await h.walk();assert.equal(h.calls.claim.length,1);
 h.access.mode='local';h.access.ownerId='guest';h.controller.refreshAccess();pending.resolve({ok:true,receipt:{seq:1,totalSteps:h.calls.claim[0].totalSteps}});await drain();assert.equal(h.controller.getState().confirmedSteps,0);assert.equal(h.controller.getState().estimatedSteps,0);assert.equal(h.calls.local.length,0);
 assert.equal((await h.controller.startFromGesture()).ok,true);assert.equal(h.controller.getState().estimatedSteps,0);h.controller.dispose();
});
await test('an advanced server sequence is reconciled before a continued cumulative receipt',async()=>{
 let oldSession;const h=harness({remote:true,claim:async body=>{if(body.seq===1)throw Object.assign(Error('sequence already advanced'),{code:'WALKING_SEQUENCE_CONFLICT'});assert.equal(body.seq,4);assert.equal(body.finish,false);return{ok:true,receipt:{seq:4,totalSteps:body.totalSteps}};}});
 await h.controller.startFromGesture();oldSession={id:'session-request-1',token:'private-token',campaignId:'campaign-one',lastSeq:3,totalSteps:4,activeMs:2500,closed:false};h.control.start=()=>({ok:true,walkingSession:oldSession});await h.walk();assert.equal(h.controller.getState().closed,false);assert.equal(h.controller.getState().running,true);assert(h.controller.getState().confirmedSteps>=4);assert.equal(h.calls.claim.at(-1).seq,4);h.controller.dispose();
});
await test('a local save ahead of its pending queue reports the durable cumulative receipt and closes old tracking',async()=>{
 const h=harness();h.bridge.applyLocalWalkingProgress=async()=>({ok:true,totalSteps:9,closed:true});await h.controller.startFromGesture();await h.walk(3200);
 assert.equal(h.controller.getState().confirmedSteps,9);assert.equal(h.controller.getState().estimatedSteps,9);assert.equal(h.controller.getState().closed,true);assert.equal(h.controller.getState().active,false);assert.equal(h.listeners('devicemotion'),0);h.controller.dispose();
});
console.log(`${checks} walking recovery checks passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
