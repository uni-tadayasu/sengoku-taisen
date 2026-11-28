/* Deterministic protocol/race tests; no requests leave this process. */
(async function(){
 'use strict';
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
 const clone=v=>JSON.parse(JSON.stringify(v)),settle=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 class Clock{
  constructor(){this.time=2000000000000;this.id=0;this.timers=new Map();}
  set=(fn,ms)=>{const id=++this.id;this.timers.set(id,{fn,at:this.time+ms});return id;};clear=id=>this.timers.delete(id);
  async advance(ms){const end=this.time+ms;let count=0;while(true){const due=[...this.timers].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;assert(++count<1000,'timer loop');this.time=due[1].at;this.timers.delete(due[0]);due[1].fn();await settle();}this.time=end;await settle();}
 }
 function memory(){const map=new Map();return{getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k),map};}
 const context={console,Date,JSON,Math,URL,URLSearchParams,crypto:crypto.webcrypto,localStorage:memory(),sessionStorage:memory(),navigator:{onLine:true,userAgent:'test'},document:{hidden:false,addEventListener(){}},addEventListener(){},setTimeout,clearTimeout};context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'),context);
 const api=context.SengokuCloudSync;let assertions=0;const check=(value,message)=>{assert(value,message);assertions++;};
 check(api.fingerprint({state:{b:{z:1,a:2},a:[{y:2,x:1}]},savedAt:'old'})===api.fingerprint({savedAt:'new',state:{a:[{x:1,y:2}],b:{a:2,z:1}}}),'state identity ignores timestamps and nested property insertion order');
 function server(clock){
  const users=new Map(),log=[];let intercept=null;
  const get=id=>{if(!users.has(id))users.set(id,{revision:0,save:null,writer:null,until:0,updatedAt:null,isAdmin:id==='admin'});return users.get(id);};
  const failure=code=>Object.assign(Error(code),{code,status:409});
  const snap=(u,device)=>({ok:true,user:{id:u.id,name:u.id,isAdmin:u.isAdmin},save:clone(u.save),revision:u.revision,updatedAt:u.updatedAt,writerDeviceId:u.writer,writerDeviceName:u.writerName||null,leaseExpiresAt:u.until?new Date(u.until).toISOString():null,serverTime:new Date(clock.time).toISOString(),entitlements:{edo:u.isAdmin,ieyasuU:u.isAdmin},writable:u.writer===device&&u.until>clock.time});
  async function process(id,route,opts={}){
   const u=get(id);u.id=id;const method=opts.method||'GET',data=opts.data||{},device=data.deviceId||new URL('https://unit.invalid'+route).searchParams.get('deviceId');log.push({id,route,method,data:clone(data),keepalive:Boolean(opts.keepalive)});
   if(route==='/presence')return{ok:true};
   if(route.startsWith('/sync?'))return snap(u,device);
   if(route==='/sync/lease'){
    if(u.writer&&u.writer!==device&&u.until>clock.time&&!data.takeOver)throw failure('LEASE_HELD');
    u.writer=device;u.writerName=data.deviceName;u.until=clock.time+30000;return snap(u,device);
   }
   if(route==='/sync/release'){if(u.writer===device){u.writer=null;u.until=0;}return snap(u,device);}
   if(route==='/sync'&&method==='PUT'){
    if(u.writer!==device||u.until<=clock.time)throw failure('LEASE_REQUIRED');if(u.revision!==data.revision)throw failure('REVISION_CONFLICT');
    u.save=clone(data.save);u.revision++;u.updatedAt=new Date(clock.time).toISOString();return snap(u,device);
   }
   throw Error('Unexpected test route '+route);
  }
  return{users,log,get,request:id=>async(route,opts)=>intercept?intercept({id,route,opts,process:()=>process(id,route,opts)}):process(id,route,opts),intercept:fn=>{intercept=fn;},puts:()=>log.filter(r=>r.method==='PUT')};
 }
 function client(clock,svc,id='u',{storage=memory(),state,initialHidden=false,initialStarted=true}={}){
  let visible=!initialHidden,connected=true,started=initialStarted,current=state||{version:2,castle:'kiyosu',resources:{gold:100,rice:50},officers:[],month:1},role=false;const applied=[],access=[],roles=[];
  const bridge={hasStarted:()=>started,getSave:()=>started?({game:'sengoku-tento',version:2,savedAt:new Date(clock.time).toISOString(),state:clone(current)}):null,applyCloudSave:(save,meta)=>{applied.push({save:clone(save),meta:clone(meta)});current=clone(save.state);started=true;return{ok:true};},setSyncAccess:s=>access.push({...s}),setAdminAccess:admin=>{role=admin;roles.push(admin);}};
  const sync=api.create({device:{id:'tab-'+crypto.randomUUID(),name:'端末 '+id},bridge:()=>bridge,now:()=>clock.time,hidden:()=>!visible,online:()=>connected,setTimeout:clock.set,clearTimeout:clock.clear,storage});
  return{sync,bridge,applied,access,roles,storage,start:who=>sync.start({id:who||id,request:svc.request(who||id),onUser(){}}),state:()=>clone(current),begin:next=>{if(next)current=clone(next);started=true;sync.notifySave();},mutate:fn=>{fn(current);sync.notifySave();},hidden:v=>{visible=!v;},online:v=>{connected=v;sync.connectionChanged();},role:()=>role};
 }
 // A renewal response carries the same authoritative save, so an established
 // writer needs one network round trip and one apply even when state changed.
 {
  const clock=new Clock(),svc=server(clock),writer=client(clock,svc,'renewal');
  await writer.start();const remote=svc.get('renewal');remote.save.state.resources.gold=205;remote.revision++;
  clock.time+=10000;const from=svc.log.length,applied=writer.applied.length;
  await writer.sync.refresh();const refreshCalls=svc.log.slice(from).filter(call=>call.route.startsWith('/sync'));
  check(refreshCalls.length===1&&refreshCalls[0].route==='/sync/lease','renewal uses its complete snapshot without a preceding duplicate GET');
  check(writer.applied.length===applied+1&&writer.state().resources.gold===205&&writer.sync.getStatus().writable,'single-response renewal applies newer canonical state and restores writer access');
  writer.sync.stop();
 }
 // A takeover between polls must still return the previous writer to follower
 // mode, preserving the new writer's save rather than issuing a blind PUT.
 {
  const clock=new Clock(),svc=server(clock),former=client(clock,svc,'renewal-race');await former.start();
  const current=svc.get('renewal-race');current.writer='new-writer';current.until=clock.time+30000;current.save.state.resources.gold=412;current.revision++;
  clock.time+=10000;const from=svc.log.length,puts=svc.puts().length;const result=await former.sync.refresh(),calls=svc.log.slice(from);
  check(result.held===true&&calls.filter(call=>call.route==='/sync/lease').length===1&&calls.filter(call=>call.route.startsWith('/sync?')).length===1,'a rejected fast renewal reads the current authoritative owner');
  check(!former.sync.getStatus().writable&&former.state().resources.gold===412&&svc.puts().length===puts,'renewal race keeps the winning writer state without uploading stale progress');former.sync.stop();
 }
 // Faster renewal does not extend local authority while the server is stalled.
 {
  const clock=new Clock(),svc=server(clock),writer=client(clock,svc,'renewal-timeout');await writer.start();clock.time+=10000;
  let resolve;const pending=new Promise(yes=>{resolve=yes;});svc.intercept(async call=>{if(call.route==='/sync/lease')await pending;return call.process();});
  const flight=writer.sync.refresh();await settle();await clock.advance(20000);
  check(!writer.sync.getStatus().writable,'the lease watchdog expires authority during a hanging direct renewal');resolve();await flight;writer.sync.stop();
 }
 const rewardId='special_goshirakawa_hoo',rewardPair=rewardId+':U';
 const rewardReceipt={officerId:rewardId,rank:'U',earned:true,earnedAt:1000};
 function award(save){const s=save?.state;if(!s)return;if(!s.officers.includes(rewardId))s.officers.push(rewardId);if(!s.officerVariants.includes(rewardPair))s.officerVariants.push(rewardPair);if(s.officerHealth?.values&&!Object.hasOwn(s.officerHealth.values,rewardId))s.officerHealth.values[rewardId]=100;}
 function rewardState(){return{version:2,castle:'kiyosu',clan:'織田家',resources:{gold:100,rice:50},officers:[],officerVariants:[],officerHealth:{values:{}},walking:{campaignId:'campaign-original'},army:[],jobs:[],month:1};}
 function projectReward(svc,{receipt=rewardReceipt,hold}={}){svc.intercept(async call=>{const result=await call.process();if(result.save){award(result.save);result.cloisteredReward=clone(receipt);if(call.opts?.method==='PUT')award(svc.get(call.id).save);if(hold)await hold(call,result);}return result;});}
 // A read-only entitlement projection must not replace the current writer's
 // pending economy, formation, queue, or a newly started local campaign.
 for(const mode of ['read','renewal','new-campaign','existing-health']){
  const clock=new Clock(),svc=server(clock),owner=client(clock,svc,'reward-'+mode,{state:rewardState()});await owner.start();
  owner.mutate(s=>{s.resources.gold=117;s.army=['custom-officer'];s.jobs=[{id:'farm',targetLevel:2}];if(mode==='new-campaign')s.walking.campaignId='campaign-new';if(mode==='existing-health'){s.officers.push(rewardId);s.officerVariants.push(rewardPair);s.officerHealth.values[rewardId]=37;}});
  projectReward(svc);const before=svc.get('reward-'+mode).revision;if(mode==='renewal')clock.time+=10000;await owner.sync.refresh();
  const state=owner.state(),stored=svc.get('reward-'+mode).save.state;
  check(state.resources.gold===117&&state.army[0]==='custom-officer'&&state.jobs[0].id==='farm'&&state.walking.campaignId===(mode==='new-campaign'?'campaign-new':'campaign-original'),mode+' reward adoption preserves every pending ordinary field');
  check(state.officers.filter(id=>id===rewardId).length===1&&state.officerVariants.filter(pair=>pair===rewardPair).length===1&&state.officerHealth.values[rewardId]===(mode==='existing-health'?37:100),mode+' adds the fixed reward once without replenishing existing health');
  check(stored.resources.gold===117&&stored.officerVariants.includes(rewardPair)&&svc.get('reward-'+mode).revision===before+1&&owner.applied.some(item=>item.meta.reason==='cloistered-reward'&&!item.meta.backup),mode+' persists the merged progress through normal revision-checked PUT');owner.sync.stop();
 }
 // Awards accepted during a PUT also preserve actions made while its response
 // was in flight, then upload those actions at the acknowledged revision.
 {
  const clock=new Clock(),svc=server(clock),owner=client(clock,svc,'reward-flight',{state:rewardState()});await owner.start();let release,held=false;const gate=new Promise(resolve=>{release=resolve;});
  projectReward(svc,{hold:async call=>{if(call.opts?.method==='PUT'&&!held){held=true;await gate;}}});owner.mutate(s=>{s.resources.gold=110;});const flight=owner.sync.flush();await settle();owner.mutate(s=>{s.resources.gold=119;s.army=['later-officer'];});release();await flight;
  check(owner.state().resources.gold===119&&owner.state().army[0]==='later-officer'&&owner.state().officerVariants.includes(rewardPair),'in-flight award merges only the verified grant over later actions');await owner.sync.flush();
  check(svc.get('reward-flight').save.state.resources.gold===119&&svc.get('reward-flight').save.state.officers.filter(id=>id===rewardId).length===1,'later progress and the permanent reward persist together once acknowledged');owner.sync.stop();
 }
 // Other server changes, authority recovery, or an unverified receipt must
 // retain canonical replacement and backup behavior, never a generic merge.
 for(const mode of ['ordinary-change','newer-revision','unverified','different-writer','forced']){
  const clock=new Clock(),svc=server(clock),id='reward-guard-'+mode,owner=client(clock,svc,id,{state:rewardState()});await owner.start();owner.mutate(s=>{s.resources.gold=117;});
  const remote=svc.get(id);if(mode==='ordinary-change')remote.save.state.resources.rice=321;if(mode==='newer-revision')remote.revision++;if(mode==='different-writer'){remote.writer='another-device';remote.until=clock.time+30000;}
  projectReward(svc,{receipt:mode==='unverified'?{...rewardReceipt,earned:false,earnedAt:null}:rewardReceipt});
  if(mode==='forced'){const result=await svc.request(id)('/sync?deviceId='+owner.sync.getDevice().id);await owner.sync.acceptSnapshot(result,{reason:'conflict'});}else await owner.sync.refresh();
  check(owner.state().resources.gold===100&&owner.applied.at(-1).meta.backup&&owner.applied.at(-1).meta.reason!=='cloistered-reward',mode+' keeps full canonical recovery rather than admitting unrelated local changes');owner.sync.stop();
 }
 // A household may gain or lose members without changing this personal save.
 {
  const clock=new Clock(),svc=server(clock),owner=client(clock,svc);
  await owner.start();
  owner.mutate(s=>{s.resources.gold+=17;});
  const revision=svc.get('u').revision,applied=owner.applied.length;
  for(const count of [1,2,0]){
   if(count)svc.get('u').save.state.retainerSupport={castleId:'kiyosu',count};
   else delete svc.get('u').save.state.retainerSupport;
   await owner.sync.refresh();
   check(owner.state().resources.gold===117&&owner.applied.length===applied,'a same-revision household change preserves unsent personal progress');
  }
  await owner.sync.flush();
  check(svc.get('u').revision===revision+1&&svc.get('u').save.state.resources.gold===117,'all edits still upload once at their original personal revision');
  owner.sync.stop();
 }
 // A speculative month is retried using the same writer lease. Local actions
 // entered while waiting survive both the rejected request and the later PUT.
 {
  const clock=new Clock(),svc=server(clock),owner=client(clock,svc);
  await owner.start();await settle();
  const previous=svc.get('u').revision,inputs=[];let held=true;
  svc.intercept(async({route,opts,process})=>{
    if(route==='/sync'&&opts.method==='PUT'){
      inputs.push(opts.data.revision);
      if(held)throw Object.assign(Error('pending'),{code:'DEFENSE_CLOCK_PENDING',status:409});
    }
    return process();
  });
  owner.mutate(s=>{s.resources.gold+=5;});await clock.advance(1000);
  check(inputs.length===1&&svc.get('u').revision===previous,'future defense checkpoint leaves the server revision unchanged');
  owner.mutate(s=>{s.resources.gold+=2;});held=false;await clock.advance(1000);
  check(inputs.length===2&&inputs.every(r=>r===previous)&&svc.get('u').save.state.resources.gold===107,'retry preserves the lease, base revision and latest local actions');
  owner.sync.stop();
 }
 // An outdated cycle projection must recover the canonical inherited region
 // before it can replace territory or repeat a save with missing metadata.
 {
  const clock=new Clock(),svc=server(clock),owner=client(clock,svc,'regional');
  await owner.start();
  const remote=svc.get('regional');remote.save.state.cycle={index:1,home:'kiyosu',retainedRegions:['四国']};
  remote.save.state.castles={okou:{owner:'織田家',level:7},yuzuki:{owner:'織田家',level:4}};remote.revision++;
  await owner.sync.refresh();const revision=remote.revision,puts=svc.puts().length;
  svc.intercept(async({route,opts,process})=>{
   if(route==='/sync'&&opts.method==='PUT'&&!opts.data.save.state.cycle.retainedRegions)
    throw Object.assign(Error('地域継承に対応した最新の進行へ同期してください。'),{code:'REGION_INHERITANCE_REQUIRED',status:409});
   return process();
  });
  owner.mutate(s=>{delete s.cycle.retainedRegions;s.castles.okou.owner='長宗我部家';});
  const result=await owner.sync.flush();
  check(!result.ok&&result.conflict,'an incompatible inherited-region save enters canonical conflict recovery');
  check(owner.state().cycle.retainedRegions[0]==='四国'&&owner.state().castles.okou.owner==='織田家','canonical recovery preserves inherited territory and castle growth');
  check(owner.applied.at(-1).meta.reason==='conflict'&&owner.applied.at(-1).meta.backup,'outdated local progress is backed up before region recovery');
  await owner.sync.flush();check(remote.revision===revision&&svc.puts().length===puts,'recovery does not upload the rejected territory reset again');
  owner.sync.stop();
 }
 // Initial upload, linked follower, debounce and timestamp/key-order stability.
 const clock=new Clock(),svc=server(clock),a=client(clock,svc),b=client(clock,svc);
 const starting=a.start();check(!a.sync.getStatus().writable&&!a.sync.getStatus().ready,'pending identity starts read-only');await starting;
 check(a.sync.getStatus().writable&&svc.get('u').revision===1,'first device owns a lease and uploads its existing save');await b.start();
 check(svc.puts()[0].data.maintenanceRulesVersion===1,'save identifies the automatic troop upkeep rule without changing revision checks');
 check(!b.sync.getStatus().writable&&b.state().resources.gold===100,'second device receives latest save as a follower');
 const untouched=svc.puts().length;await a.sync.refresh();await a.sync.flush();clock.time+=77;await a.sync.flush();check(svc.puts().length===untouched,'unchanged state is not uploaded even when savedAt changes');
 a.mutate(s=>{s.resources.gold=120;});a.mutate(s=>{s.resources.rice=70;});check(svc.puts().length===untouched,'changes are debounced');await clock.advance(1000);
 check(svc.puts().length===untouched+1&&svc.get('u').save.state.resources.gold===120,'one debounced write contains the latest local changes');await b.sync.refresh();check(b.state().resources.rice===70,'follower automatically receives another device progress');
 // An in-flight acknowledgement may not overwrite a newer local action.
 let unlock;const held=new Promise(r=>{unlock=r;});let heldOnce=false;
 svc.intercept(async call=>{const result=await call.process();if(call.opts?.method==='PUT'&&!heldOnce){heldOnce=true;await held;}return result;});
 a.mutate(s=>{s.resources.gold=130;});const flight=a.sync.flush();await settle();a.mutate(s=>{s.resources.gold=140;});unlock();await flight;
 check(a.state().resources.gold===140,'in-flight PUT response preserves actions made after it began');await a.sync.flush();check(svc.get('u').save.state.resources.gold===140,'newer actions are written at the acknowledged revision');svc.intercept(null);
 // Explicit takeover and a stale former writer must pull, not overwrite.
 await b.sync.takeOver();check(b.sync.getStatus().writable,'explicit takeover acquires the play lease');b.mutate(s=>{s.resources.gold=200;});await b.sync.flush();
 a.mutate(s=>{s.resources.gold=999;});await a.sync.flush();check(!a.sync.getStatus().writable&&a.state().resources.gold===200,'former writer follows the authoritative save after lease rejection');check(a.applied.some(x=>x.meta.reason==='conflict'&&x.meta.backup),'conflicting local state is backed up before applying cloud state');check(svc.get('u').save.state.resources.gold===200,'conflict never blindly overwrites the current cloud save');
 // Hidden-page final save goes before release, with keepalive on pagehide.
 b.mutate(s=>{s.resources.gold=210;});b.hidden(true);const hideFrom=svc.log.length;await b.sync.pageHidden();
 const hideLog=svc.log.slice(hideFrom),putIndex=hideLog.findIndex(x=>x.method==='PUT'),releaseIndex=hideLog.findIndex(x=>x.route==='/sync/release');
 check(putIndex>=0&&releaseIndex>putIndex&&hideLog[putIndex].keepalive,'pagehide serializes final keepalive PUT before releasing its lease');check(svc.get('u').save.state.resources.gold===210&&!b.sync.getStatus().writable,'pagehide saves the final state and disables local play');
 a.sync.stop();b.sync.stop();await settle();
 // No heartbeat or lease is acquired for a page initially hidden.
 const hiddenClock=new Clock(),hiddenServer=server(hiddenClock),h=client(hiddenClock,hiddenServer,'hidden',{initialHidden:true});await h.start();await hiddenClock.advance(60000);check(hiddenServer.log.length===0,'initially hidden tab does not send presence or acquire a lease');h.hidden(false);h.sync.visibilityChanged();await settle();check(hiddenServer.log.some(x=>x.route==='/presence'&&x.data.online===true),'foreground resumes presence');h.hidden(true);h.sync.visibilityChanged();await settle();const hiddenAt=hiddenServer.log.length;await hiddenClock.advance(60000);check(!hiddenServer.log.slice(hiddenAt).some(x=>x.route==='/presence'&&x.data.online===true),'hidden page sends no online heartbeats');h.sync.stop();
 // An expired lease cuts access even while a poll/renewal hangs.
 const expiryClock=new Clock(),expiryServer=server(expiryClock),e=client(expiryClock,expiryServer);await e.start();let releasePoll;const stalled=new Promise(r=>{releasePoll=r;});expiryServer.intercept(async call=>{if(call.route.startsWith('/sync?'))await stalled;return call.process();});
 await expiryClock.advance(30000);check(!e.sync.getStatus().writable,'lease watchdog blocks play while renewal is unresponsive');releasePoll();await settle();e.sync.stop();
 // Offline detection and server failures fail closed, without dropping local data.
 const errorClock=new Clock(),errorServer=server(errorClock),n=client(errorClock,errorServer);await n.start();n.mutate(s=>{s.resources.gold=333;});errorServer.intercept(async()=>{throw Error('network unavailable');});await n.sync.flush();check(!n.sync.getStatus().writable&&n.state().resources.gold===333,'request failure stops play and keeps unsent local progress');n.online(false);check(n.sync.getStatus().reason==='offline','offline event immediately exposes paused sync');errorServer.intercept(null);n.online(true);await settle();check(errorServer.get('u').save.state.resources.gold===333,'reconnection flushes pending progress when server baseline is unchanged');n.sync.stop();
 // Old identity replies cannot alter a replacement identity's state or role.
 const staleClock=new Clock(),staleServer=server(staleClock),c=client(staleClock,staleServer);let staleResolve;const oldGate=new Promise(r=>{staleResolve=r;});staleServer.intercept(async call=>{const result=await call.process();if(call.id==='admin'&&call.route.startsWith('/sync?'))await oldGate;return result;});
 const old=c.start('admin');await settle();await c.start('other');staleResolve();await old;check(c.sync.getStatus().writable&&c.role()===false&&staleServer.get('other').save!==null,'stale privileged identity response cannot replace a new identity');c.sync.stop();
 // A failed unload retains a small checkpoint; only the same baseline may resume it.
 const resumeClock=new Clock(),resumeServer=server(resumeClock),store=memory(),r1=client(resumeClock,resumeServer,'resume',{storage:store});await r1.start();r1.mutate(s=>{s.resources.gold=444;});resumeServer.intercept(async call=>{if(call.opts?.method==='PUT')throw Error('page closed');return call.process();});r1.hidden(true);await r1.sync.pageHidden();const pendingState=r1.state();check(store.getItem('sengoku-sync-pending-v1')!==null,'unsent local progress has a recovery checkpoint');r1.sync.stop();await settle();resumeServer.intercept(null);const r2=client(resumeClock,resumeServer,'resume',{storage:store,state:pendingState});await r2.start();check(resumeServer.get('resume').save.state.resources.gold===444,'reopening resumes unsent local progress only against matching server baseline');check(store.getItem('sengoku-sync-pending-v1')===null,'checkpoint clears after confirmed cloud save');r2.sync.stop();
 // Reload can see an older durable snapshot than the runtime that was checkpointed.
 // Keep the precise unsent formation even when time advanced after the last local write.
 const formationClock=new Clock(),formationServer=server(formationClock),formationStore=memory(),f1=client(formationClock,formationServer,'formation',{storage:formationStore});
 await f1.start();let durable=f1.state();f1.bridge.getStoredSave=()=>({state:clone(durable)});
 f1.mutate(s=>{s.army=['officer-c','officer-a'];s.governors={farm:'officer-b'};});durable=f1.state();
 f1.mutate(s=>{s.resources.gold+=7;s.month=2;});const unsent=f1.state();
 formationServer.intercept(async call=>{if(call.opts?.method==='PUT')throw Error('page closed before upload');return call.process();});f1.hidden(true);await f1.sync.pageHidden();f1.sync.stop();await settle();formationServer.intercept(null);
 const f2=client(formationClock,formationServer,'formation',{storage:formationStore,state:durable});f2.bridge.getStoredSave=()=>({state:clone(durable)});await f2.start();
 check(JSON.stringify(f2.state())===JSON.stringify(unsent),'reload resumes the exact unsent snapshot when runtime and durable hashes differ');
 check(JSON.stringify(formationServer.get('formation').save.state.army)===JSON.stringify(unsent.army)&&formationServer.get('formation').save.state.governors.farm==='officer-b','reload never replaces custom army and governors with the old cloud formation');f2.sync.stop();await settle();
 // Saved snapshots never bypass identity, revision, original-save or integrity checks.
 for(const mismatch of ['identity','remote','durable','snapshot']){
  const guardedClock=new Clock(),guardedServer=server(guardedClock),guardedStore=memory(),g1=client(guardedClock,guardedServer,'guarded',{storage:guardedStore});await g1.start();
  const baseline=clone(guardedServer.get('guarded').save);let onDisk=g1.state();g1.bridge.getStoredSave=()=>({state:clone(onDisk)});
  g1.mutate(s=>{s.army=['custom-b','custom-a'];s.governors={farm:'custom-c'};});onDisk=g1.state();g1.mutate(s=>{s.resources.gold++;});
  const pending=guardedStore.getItem('sengoku-sync-pending-v1');g1.sync.stop();await settle();guardedStore.setItem('sengoku-sync-pending-v1',pending);
  const id=mismatch==='identity'?'different':'guarded',remote=guardedServer.get(id);if(mismatch==='identity'){remote.save=clone(baseline);remote.revision=1;}
  if(mismatch==='remote'){remote.save.state.army=['authoritative'];remote.save.state.governors={farm:'authoritative-governor'};remote.revision++;}
  if(mismatch==='durable')onDisk.army=['later-unrelated-save'];
  if(mismatch==='snapshot'){const corrupt=JSON.parse(pending);corrupt.snapshot.state.army=['tampered'];guardedStore.setItem('sengoku-sync-pending-v1',JSON.stringify(corrupt));}
  const expected=clone(remote.save.state),writes=guardedServer.puts().length,g2=client(guardedClock,guardedServer,id,{storage:guardedStore,state:onDisk});g2.bridge.getStoredSave=()=>({state:clone(onDisk)});await g2.start();
  check(JSON.stringify(g2.state())===JSON.stringify(expected)&&guardedServer.puts().length===writes,`${mismatch} mismatch cannot replay a pending formation over the authoritative cloud save`);
  check(g2.applied.some(x=>x.meta.backup),`${mismatch} mismatch retains the local replacement-backup path`);g2.sync.stop();await settle();
 }
 // Unknown roles must neither upload a sanitized projection nor replace its checkpoint.
 const authClock=new Clock(),authServer=server(authClock),authStore=memory(),auth=client(authClock,authServer,'auth-pending',{storage:authStore});let rolePending=false;
 auth.bridge.getRoleAccess=()=>({pending:rolePending});auth.bridge.setRoleAccess=role=>{rolePending=role.pending===true;};await auth.start();
 auth.mutate(s=>{s.army=['pending-a'];s.governors={gold_mine:'pending-b'};});const protectedPending=authStore.getItem('sengoku-sync-pending-v1'),authWrites=authServer.puts().length;
 rolePending=true;auth.mutate(s=>{s.governors={};});await auth.sync.flush();auth.hidden(true);await auth.sync.pageHidden();
 check(authServer.puts().length===authWrites&&authStore.getItem('sengoku-sync-pending-v1')===protectedPending,'unverified role blocks normal and suspended PUTs and preserves the pre-sanitization checkpoint');auth.sync.stop();check(!rolePending,'explicit logout clears the pending-role gate');
 // Storage failure is non-destructive, including when an earlier checkpoint exists.
 const quotaClock=new Clock(),quotaServer=server(quotaClock),quotaStore=memory(),quota=client(quotaClock,quotaServer,'quota',{storage:quotaStore});await quota.start();quota.mutate(s=>{s.army=['kept-a'];});
 const previousPending=quotaStore.getItem('sengoku-sync-pending-v1');quotaStore.setItem=()=>{throw Error('QuotaExceededError');};quota.mutate(s=>{s.army=['kept-b'];});
 check(quota.state().army[0]==='kept-b'&&quotaStore.getItem('sengoku-sync-pending-v1')===previousPending,'checkpoint storage errors retain the live formation and prior durable checkpoint');quota.sync.stop();await settle();
 // Same-identity restart uses a distinct lease ID, protecting against late cleanup.
 const restartClock=new Clock(),restartServer=server(restartClock),restart=client(restartClock,restartServer);await restart.start();const oldId=restart.sync.getDevice().id;await restart.start();const newId=restart.sync.getDevice().id;check(oldId!==newId&&newId.length<=90,'identity generation restart has a fresh bounded device ID');restart.sync.stop();await settle();
 // A first-start draft never becomes a server save just because identity links.
 const draftClock=new Clock(),draftServer=server(draftClock),draft=client(draftClock,draftServer,'draft',{initialStarted:false});await draft.start();
 check(draft.sync.getStatus().ready&&draft.sync.getStatus().writable&&draft.sync.getStatus().awaitingStart,'an unstarted identity can hold a lease while the player chooses the first castle');check(draft.sync.getStatus().reason==='awaiting-start'&&draftServer.puts().length===0&&draftServer.get('draft').save===null,'the starter draft is not uploaded');
 draft.mutate(state=>{state.castle='matsumoto';});await draft.sync.flush();await draftClock.advance(15000);check(draftServer.puts().length===0,'draft changes, polling and lease renewal still send no game save');
 draft.begin({...draft.state(),castle:'matsumoto'});await draft.sync.flush();check(draftServer.puts().length===1&&draftServer.get('draft').save.state.castle==='matsumoto','explicit start confirmation creates the first cloud save');check(!draft.sync.getStatus().awaitingStart,'the coordinator leaves first-start status after confirmation');draft.sync.stop();await settle();
 // A new browser with no local campaign can still receive an existing cloud game.
 const inboundClock=new Clock(),inboundServer=server(inboundClock),seed=inboundServer.get('existing');seed.save={game:'sengoku-tento',version:2,state:{castle:'odawara',resources:{gold:777},officers:[]}};seed.revision=4;
 const inbound=client(inboundClock,inboundServer,'existing',{initialStarted:false});await inbound.start();check(inbound.state().castle==='odawara'&&inbound.bridge.hasStarted(),'an existing remote campaign is applied even when local getSave returns null');check(inbound.applied.length===1&&!inbound.applied[0].meta.backup,'no fabricated starter campaign is backed up before remote recovery');check(inboundServer.puts().length===0&&inboundServer.get('existing').revision===4,'loading the existing cloud game does not issue a replacement save');inbound.sync.stop();await settle();
 // Null is allowed only with an explicit unstarted bridge flag.
 const brokenClock=new Clock(),brokenServer=server(brokenClock),broken=client(brokenClock,brokenServer,'broken');broken.bridge.getSave=()=>null;delete broken.bridge.hasStarted;await broken.start();check(broken.sync.getStatus().reason==='error'&&!broken.sync.getStatus().writable&&brokenServer.puts().length===0,'an invalid active game still fails closed');broken.sync.stop();
 // A ban invalidates responses already in flight and keeps every write paused.
 const banClock=new Clock(),banServer=server(banClock),banStore=memory(),bannedClient=client(banClock,banServer,'banned',{storage:banStore});await bannedClient.start();
 bannedClient.mutate(s=>{s.resources.gold=321;});const banCheckpoint=banStore.getItem('sengoku-sync-pending-v1');let releaseOldSnapshot,heldSnapshot=false;
 const oldSnapshotGate=new Promise(resolve=>{releaseOldSnapshot=resolve;});banServer.intercept(async call=>{const result=await call.process();if(call.route.startsWith('/sync?')&&!heldSnapshot){heldSnapshot=true;await oldSnapshotGate;}return result;});
 const oldSnapshot=bannedClient.sync.refresh();await settle();check(heldSnapshot,'an authoritative-looking old snapshot can be delayed across a ban');
 check(bannedClient.sync.suspendAccount({playerId:'another-player'})===false&&bannedClient.sync.getStatus().writable,'a stale ban for another identity cannot pause the current writer');
 bannedClient.sync.suspendAccount({playerId:'banned',message:'利用停止中'});const heldStatus=bannedClient.sync.getStatus();
 check(heldStatus.banned&&heldStatus.reason==='banned'&&!heldStatus.writable&&!heldStatus.ready&&!heldStatus.leaseExpiresAt,'BAN releases local authority immediately while preserving the linked identity');
 check(banStore.getItem('sengoku-sync-pending-v1')===banCheckpoint,'BAN preserves the last unsent checkpoint without sanitizing or uploading it');
 const blockedRoutes=[];banServer.intercept(async call=>{blockedRoutes.push({route:call.route,method:call.opts?.method||'GET'});throw Object.assign(Error('利用停止中'),{code:'ACCOUNT_BANNED',status:403});});releaseOldSnapshot();await oldSnapshot;
 check(bannedClient.sync.getStatus().banned&&!bannedClient.sync.getStatus().writable,'a success sent before BAN cannot re-enable the account after it arrives');
 await bannedClient.sync.flush();await banClock.advance(30000);check(blockedRoutes.length===1&&blockedRoutes.every(r=>r.method==='GET'&&r.route.startsWith('/sync?')),'a banned account checks only the read-only sync endpoint once per 30 seconds');
 bannedClient.hidden(true);bannedClient.sync.visibilityChanged();await bannedClient.sync.pageHidden();bannedClient.online(false);check(bannedClient.sync.getStatus().reason==='banned'&&blockedRoutes.length===1,'visibility, unload and offline events neither hide the BAN message nor send a write');
 const resumed=banServer.get('banned');resumed.save.state.resources.gold=777;resumed.revision++;resumed.writer=null;resumed.until=0;banServer.intercept(null);bannedClient.hidden(false);bannedClient.online(true);await bannedClient.sync.refresh();
 check(!bannedClient.sync.getStatus().banned&&bannedClient.sync.getStatus().writable&&bannedClient.state().resources.gold===777,'解除 pulls the authoritative save and reacquires a lease using the same identity');
 check(banServer.get('banned').save.state.resources.gold===777,'解除 does not overwrite newer cloud progress with the pre-BAN checkpoint');bannedClient.sync.stop();await settle();
 // Presence can discover a ban before the first save/lease completes.
 const entryClock=new Clock(),entryServer=server(entryClock),entry=client(entryClock,entryServer,'blocked-entry');entryServer.intercept(async()=>{throw Object.assign(Error('利用停止中'),{code:'ACCOUNT_BANNED',status:403});});await entry.start();await settle();
 check(entry.sync.getStatus().banned&&entryServer.puts().length===0,'initial presence/authentication rejection blocks the initial cloud upload');entry.sync.stop();await settle();
 // A late rejected request from a replaced identity cannot ban the replacement.
 const lateClock=new Clock(),lateServer=server(lateClock),late=client(lateClock,lateServer,'old-player');let rejectOld;const oldBanGate=new Promise(resolve=>{rejectOld=resolve;});
 lateServer.intercept(async call=>{if(call.id==='old-player'&&call.route.startsWith('/sync?')){await oldBanGate;throw Object.assign(Error('利用停止中'),{code:'ACCOUNT_BANNED',status:403});}return call.process();});
 const oldIdentity=late.start();await settle();await late.start('new-player');rejectOld();await oldIdentity;check(!late.sync.getStatus().banned&&late.sync.getStatus().writable,'a previous identity ACCOUNT_BANNED reply cannot freeze the new identity');late.sync.stop();await settle();
 // Even a BAN/解除 cycle entirely within one request must reacquire authority.
 const epochClock=new Clock(),epochServer=server(epochClock),epochClient=client(epochClock,epochServer,'access-change');await epochClient.start();epochClient.mutate(s=>{s.resources.gold=444;});
 epochServer.intercept(async call=>{if(call.opts?.method==='PUT')throw Object.assign(Error('利用状態が変わりました'),{code:'ACCOUNT_ACCESS_CHANGED',status:409});return call.process();});await epochClient.sync.flush();
 check(epochClient.sync.getStatus().reason==='access-changed'&&!epochClient.sync.getStatus().writable&&!epochClient.sync.getStatus().banned,'a changed access epoch pauses writes without claiming the player remains banned');
 epochServer.intercept(null);await epochClient.sync.refresh();check(epochClient.sync.getStatus().writable,'a fresh authoritative sync resolves an access-epoch change');
 let releaseEpochSnapshot;const epochSnapshotGate=new Promise(resolve=>{releaseEpochSnapshot=resolve;});epochServer.intercept(async call=>{const result=await call.process();if(call.route.startsWith('/sync?'))await epochSnapshotGate;return result;});const epochSnapshot=epochClient.sync.refresh();await settle();
 check(epochClient.sync.invalidateAccountAccess({playerId:'other'})===false&&epochClient.sync.getStatus().writable,'an external access-change notice is scoped to the current identity');
 epochClient.sync.invalidateAccountAccess({playerId:'access-change',message:'利用状態を再確認しています。'});releaseEpochSnapshot();await epochSnapshot;
 check(!epochClient.sync.getStatus().writable&&epochClient.sync.getStatus().reason==='access-changed','a non-sync request can invalidate an older successful cloud response before it re-enables writes');
 epochServer.intercept(null);await epochClient.sync.refresh();check(epochClient.sync.getStatus().writable,'external access invalidation resumes only after a fresh successful sync');
 const resumedPresence=epochServer.log.filter(call=>call.route==='/presence'&&call.data.online).length;await epochClock.advance(20000);
 check(epochServer.log.filter(call=>call.route==='/presence'&&call.data.online).length>resumedPresence,'fresh account access restarts periodic online presence after its timers were paused');epochClient.sync.stop();await settle();
 console.log(`Cloud sync tests passed: ${assertions} protocol, canonical-state, concurrent-save, takeover, stale-identity, hidden-presence, lease-expiry, unload-order, offline, checkpoint, first-start and BAN/解除 assertions. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
