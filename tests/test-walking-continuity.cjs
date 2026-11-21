/* Session intent survives UI dismissal and temporary sensor/access gaps. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createController}=require('../walking.js');
const clone=value=>JSON.parse(JSON.stringify(value));
const drain=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
function deferred(){let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve:(value)=>resolve(value)};}
function harness({remote=false}={}){
 let time=0,timerId=0,requestId=0,permissions=0,wakeRequests=0;
 const timers=new Map(),events=new Map(),stored=new Map(),remoteSessions=new Map(),localSessions=new Map();
 const calls={start:[],claim:[],localStart:[],localProgress:[],localEnd:[]},control={claimError:null};
 const access={started:true,mode:remote?'remote':'local',ownerId:'player-one',campaignId:'campaign-one',canCount:true,canClaim:true,totalSteps:0,reason:'ready'};
 const target={addEventListener(type,fn){if(!events.has(type))events.set(type,new Set());events.get(type).add(fn);},removeEventListener(type,fn){events.get(type)?.delete(fn);}};
 const document={hidden:false,visibilityState:'visible',...target};
 const navigator={onLine:true,wakeLock:{request:async()=>{wakeRequests++;return{released:false,release(){this.released=true;return Promise.resolve();},addEventListener(){}};}}};
 const window={...target,document,navigator,isSecureContext:true,DeviceMotionEvent:{requestPermission(){permissions++;return Promise.resolve('granted');}}};
 const bridge={getWalkingAccess:()=>({...access}),
  beginLocalWalkingSession:async body=>{calls.localStart.push(clone(body));if(!localSessions.has(body.sessionId))localSessions.set(body.sessionId,{totalSteps:0,closed:false});return{ok:true,...localSessions.get(body.sessionId)};},
  applyLocalWalkingProgress:async body=>{calls.localProgress.push(clone(body));const entry=localSessions.get(body.sessionId);assert(entry&&!entry.closed);const delta=Math.max(0,body.totalSteps-entry.totalSteps);entry.totalSteps+=delta;access.totalSteps+=delta;return{ok:true,totalSteps:entry.totalSteps};},
  endLocalWalkingSession:async body=>{calls.localEnd.push(clone(body));localSessions.get(body.sessionId).closed=true;return{ok:true};},
  startWalkingSession:async body=>{calls.start.push(clone(body));if(!remoteSessions.has(body.requestId))remoteSessions.set(body.requestId,{id:'session-'+body.requestId,token:'opaque-token',campaignId:body.campaignId,lastSeq:0,totalSteps:0,activeMs:0,closed:false});if(control.startGate)await control.startGate;return{ok:true,walkingSession:clone(remoteSessions.get(body.requestId))};},
  claimWalkingSteps:async body=>{calls.claim.push(clone(body));if(control.claimError)throw control.claimError;const entry=[...remoteSessions.values()].find(session=>session.id===body.sessionId);assert(entry&&!entry.closed);assert.equal(body.seq,entry.lastSeq+1);assert(body.totalSteps>=entry.totalSteps);assert(body.activeMs>=entry.activeMs);assert(body.activeMs-entry.activeMs<=30000,'Unacknowledged sensor time must fit the server window');assert(body.totalSteps<=Math.floor(body.activeMs*4/1000),'A suspended sensor must not create reward time');access.totalSteps+=body.totalSteps-entry.totalSteps;Object.assign(entry,{lastSeq:body.seq,totalSteps:body.totalSteps,activeMs:body.activeMs,closed:body.finish});return{ok:true,receipt:{seq:body.seq,totalSteps:body.totalSteps},walkingSession:clone(entry)};}
 };
 const make=()=>createController({window,document,navigator,bridge:()=>bridge,storage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,value)},now:()=>time,setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,at:time+delay});return id;},clearTimeout:id=>timers.delete(id),uuid:()=>`request-${++requestId}`,subscribeAccess:()=>()=>{}});
 let controller=make();
 function fire(type,event={}){for(const fn of [...(events.get(type)||[])])fn(event);}
 async function advance(ms){const end=time+ms;for(let i=0;i<2000;i++){const next=[...timers].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();await drain();}time=end;await drain();}
 async function walk(ms=4200){const start=time;while(time<start+ms){await advance(20);fire('devicemotion',{isTrusted:true,accelerationIncludingGravity:{x:0,y:0,z:9.81+2.8*Math.sin(2*Math.PI*(time-start)/620)}});await drain();}}
 function hide(){document.hidden=true;document.visibilityState='hidden';fire('visibilitychange');}
 function show(){document.hidden=false;document.visibilityState='visible';fire('visibilitychange');}
 function reload(){controller.dispose();controller=make();return controller;}
 return{get controller(){return controller;},get permissions(){return permissions;},get wakeRequests(){return wakeRequests;},calls,control,access,window,document,navigator,stored,bridge,fire,advance,walk,hide,show,reload,listeners:type=>events.get(type)?.size||0};
}
let passed=0;async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
 await test('closing the actual walking UI leaves the active session running',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.walk();const counted=h.controller.getState().estimatedSteps;
  let closed=0,focused=0;const uiWindow={testController:h.controller,testDialog:{close(){closed++;}},testReturnFocus:{isConnected:true,focus(){focused++;}},document:{createElement(){},readyState:'loading',addEventListener(){}}};
  const source=fs.readFileSync(path.join(__dirname,'../walking.js'),'utf8').replace('Object.assign(api,{open,','live=global.testController;dialog=global.testDialog;returnFocus=global.testReturnFocus;\nObject.assign(api,{open,');
  vm.runInNewContext(source,{window:uiWindow});uiWindow.SengokuWalking.close();
  assert.equal(closed,1);assert.equal(focused,1);assert.equal(h.controller.getState().running,true);assert.equal(h.calls.localEnd.length,0);
  await h.walk();assert(h.controller.getState().estimatedSteps>counted);h.controller.dispose();
 });
 await test('an idle sensor waits indefinitely and resumes on real motion without a new Start',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.advance(60000);
  assert.equal(h.controller.getState().running,true);assert.equal(h.controller.getState().active,true);assert.equal(h.controller.getState().reason,'sensor');assert.equal(h.controller.getState().estimatedSteps,0);assert.equal(h.controller.getState().activeMs,0);assert.equal(h.listeners('devicemotion'),1);
  await h.walk();assert(h.controller.getState().estimatedSteps>=3);assert.equal(h.calls.localStart.length,1);assert.equal(h.permissions,1);assert.equal(h.calls.localEnd.length,0);h.controller.dispose();
 });
 await test('hidden and restored pages keep their counters and session without counting the gap',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.walk();const before=h.controller.getState();h.hide();await h.walk(6000);await h.advance(90000);
  assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().running,true);assert.equal(h.controller.getState().estimatedSteps,before.estimatedSteps);assert.equal(h.controller.getState().activeMs,before.activeMs);
  h.show();await drain();assert.equal(h.controller.getState().active,true);await h.walk();assert(h.controller.getState().estimatedSteps>before.estimatedSteps);assert(h.controller.getState().activeMs-before.activeMs<5000);assert.equal(h.calls.localStart.length,1);assert.equal(h.calls.localEnd.length,0);assert.equal(h.permissions,1);assert.equal(h.wakeRequests,2);h.controller.dispose();
 });
 await test('pagehide alone suspends acquisition and pageshow resumes the same session',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.walk();h.fire('pagehide');const before=h.controller.getState();await h.advance(120000);
  assert.equal(before.running,true);assert.equal(h.listeners('devicemotion'),0);assert.equal(h.controller.getState().activeMs,before.activeMs);h.fire('pageshow');await h.walk();assert(h.controller.getState().estimatedSteps>before.estimatedSteps);assert.equal(h.calls.localStart.length,1);assert.equal(h.calls.localEnd.length,0);h.controller.dispose();
 });
 await test('reload restores an unfinished local walk but an explicit finish remains stopped',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.walk();const before=h.controller.getState();h.reload();await h.walk();
  assert.equal(h.controller.getState().running,true);assert(h.controller.getState().estimatedSteps>before.estimatedSteps);assert.equal(h.calls.localStart.length,1);assert.equal(h.permissions,1);
  await h.controller.stop();const done=h.controller.getState();assert.equal(done.running,false);assert.equal(done.closed,true);assert.equal(h.calls.localEnd.length,1);h.hide();h.show();h.reload();await h.walk();assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().estimatedSteps,done.estimatedSteps);assert.equal(h.calls.localStart.length,1);h.controller.dispose();
 });
 await test('an old start response cannot overwrite Stop after the same owner is reloaded',async()=>{
  const h=harness({remote:true}),gate=deferred();h.control.startGate=gate.promise;const starting=h.controller.startFromGesture();await drain();assert.equal(h.calls.start.length,1);
  const requestId=h.calls.start[0].requestId,readStored=()=>[...h.stored.values()].map(JSON.parse).find(value=>value.ownerId==='player-one');
  h.access.ownerId='player-two';h.controller.refreshAccess();h.access.ownerId='player-one';h.controller.refreshAccess();await h.controller.stop();
  assert.equal(readStored().wantContinue,false);assert.equal(readStored().wantFinish,true);gate.resolve();await starting;await drain();
  assert.equal(readStored().wantContinue,false);assert.equal(readStored().wantFinish,true);assert.equal(readStored().session,null);assert.equal(h.controller.getState().active,false);
  h.access.ownerId='player-two';h.controller.refreshAccess();h.access.ownerId='player-one';h.controller.refreshAccess();h.reload();assert.equal(h.controller.getState().running,false);assert.equal(h.controller.getState().active,false);
  await h.controller.retry();assert.equal(h.controller.getState().closed,true);assert.equal(h.controller.getState().active,false);assert.equal(h.calls.claim.length,1);assert.equal(h.calls.claim[0].finish,true);assert(h.calls.start.every(call=>call.requestId===requestId));assert.equal(h.listeners('devicemotion'),0);h.controller.dispose();
 });
 await test('Stop during the same pending start accepts its token only to finish the existing request',async()=>{
  const h=harness({remote:true}),gate=deferred();h.control.startGate=gate.promise;const starting=h.controller.startFromGesture();await drain();assert.equal(h.calls.start.length,1);
  await h.controller.stop();assert.equal(h.controller.getState().running,false);assert.equal(h.controller.getState().ending,true);assert.equal(h.calls.start.length,1);
  gate.resolve();await starting;await drain();assert.equal(h.controller.getState().closed,true);assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().running,false);assert.equal(h.calls.start.length,1);assert.equal(h.calls.claim.length,1);assert.equal(h.calls.claim[0].finish,true);assert.equal(h.listeners('devicemotion'),0);h.controller.dispose();
 });
 await test('a completed record reloads with the ended status and the new-walk action',async()=>{
  const h=harness();await h.controller.startFromGesture();await h.walk();await h.controller.stop();const steps=h.controller.getState().estimatedSteps;h.reload();const restored=h.controller.getState();assert.equal(restored.phase,'paused');assert.equal(restored.closed,true);assert.equal(restored.running,false);assert.equal(restored.estimatedSteps,steps);assert.match(restored.message,/新しく計測する/);
  const nodes=new Map(),dialog={dataset:{},querySelector(selector){if(!nodes.has(selector))nodes.set(selector,{textContent:'',focus(){}});return nodes.get(selector);},showModal(){this.open=true;}};
  const uiWindow={testController:h.controller,testDialog:dialog,document:{createElement(){},querySelectorAll:()=>[],readyState:'loading',addEventListener(){}}};
  const source=fs.readFileSync(path.join(__dirname,'../walking.js'),'utf8').replace('Object.assign(api,{open,','live=global.testController;dialog=global.testDialog;\nObject.assign(api,{open,');vm.runInNewContext(source,{window:uiWindow});uiWindow.SengokuWalking.open();
  assert.equal(nodes.get('[data-walking-status]').textContent,'計測終了');assert.equal(nodes.get('[data-walking-action="start"]').textContent,'新しく計測する');assert.equal(nodes.get('[data-walking-action="stop"]').hidden,true);h.controller.dispose();
 });
 await test('continuous remote walking spans multiple renewals until the explicit finish',async()=>{
  const h=harness({remote:true});await h.controller.startFromGesture();await h.walk(42000);
  assert.equal(h.controller.getState().active,true);assert.equal(h.controller.getState().running,true);assert(h.controller.getState().estimatedSteps>50);assert.equal(h.calls.start.length,1);assert(h.calls.claim.length>=7);assert(h.calls.claim.every(claim=>!claim.finish&&claim.sessionId===h.calls.claim[0].sessionId));
  await h.controller.stop();assert.equal(h.controller.getState().closed,true);assert.equal(h.calls.claim.filter(claim=>claim.finish).length,1);h.controller.dispose();
 });
 await test('temporary canonical-save application preserves motion and never sends finish',async()=>{
  const h=harness({remote:true});await h.controller.startFromGesture();await h.walk();const before=h.controller.getState().estimatedSteps;h.access.canClaim=false;h.access.reason='applying';h.controller.refreshAccess();await h.walk(7000);
  assert.equal(h.controller.getState().active,true);assert(h.controller.getState().estimatedSteps>before);h.access.canClaim=true;h.access.reason='ready';await h.controller.retry();assert.equal(h.controller.getState().pendingSteps,0);assert.equal(h.calls.start.length,1);assert(h.calls.claim.length>0&&h.calls.claim.every(claim=>!claim.finish));h.controller.dispose();
 });
 await test('frequent access notifications cannot postpone the walking heartbeat forever',async()=>{
  const h=harness({remote:true});await h.controller.startFromGesture();for(let i=0;i<40;i++){await h.advance(200);h.controller.refreshAccess();}
  assert(h.calls.claim.length>=1);assert(h.calls.claim.every(claim=>claim.activeMs===0&&claim.totalSteps===0&&!claim.finish));assert.equal(h.controller.getState().running,true);h.controller.dispose();
 });
 await test('offline access waits, then continues the same remote record without finalizing',async()=>{
  const h=harness({remote:true});await h.controller.startFromGesture();await h.walk(6200);const before=h.controller.getState();h.navigator.onLine=false;h.access.canCount=false;h.access.canClaim=false;h.access.reason='offline';h.fire('offline');await h.advance(120000);
  assert.equal(h.controller.getState().running,true);assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().activeMs,before.activeMs);
  h.navigator.onLine=true;h.access.canCount=true;h.access.canClaim=true;h.access.reason='ready';h.fire('online');await h.walk();await h.controller.retry();assert(h.controller.getState().estimatedSteps>before.estimatedSteps);assert.equal(h.calls.start.length,1);assert(h.calls.claim.every(claim=>!claim.finish));h.controller.dispose();
 });
 await test('an extended synchronization delay bounds unsent sensor time and resumes after acknowledgement',async()=>{
  const h=harness({remote:true});await h.controller.startFromGesture();h.access.canClaim=false;await h.walk(40000);const waiting=h.controller.getState();
  assert.equal(waiting.running,true);assert.equal(waiting.active,false);assert(waiting.activeMs<=25000);assert(waiting.estimatedSteps>0);const before=waiting.estimatedSteps;h.access.canClaim=true;await h.controller.retry();assert.equal(h.controller.getState().active,true);await h.walk();assert(h.controller.getState().estimatedSteps>before);assert(h.calls.claim.every(claim=>!claim.finish));assert.equal(h.calls.start.length,1);h.controller.dispose();
 });
 await test('an explicit finish remains stopped across reload while its final receipt is pending',async()=>{
  const h=harness({remote:true});await h.controller.startFromGesture();await h.walk();h.control.claimError=Error('network response unavailable');await h.controller.stop();const before=h.controller.getState();assert.equal(before.running,false);assert.equal(before.ending,true);h.reload();h.show();await h.walk();
  assert.equal(h.controller.getState().active,false);assert.equal(h.controller.getState().estimatedSteps,before.estimatedSteps);h.control.claimError=null;await h.controller.retry();assert.equal(h.controller.getState().closed,true);assert.equal(h.controller.getState().running,false);assert.equal(h.calls.start.length,1);h.controller.dispose();
 });
 console.log(`${passed} walking continuity checks passed. No browser sensors or external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
