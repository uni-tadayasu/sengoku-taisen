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
 // Initial upload, linked follower, debounce and timestamp/key-order stability.
 const clock=new Clock(),svc=server(clock),a=client(clock,svc),b=client(clock,svc);
 const starting=a.start();check(!a.sync.getStatus().writable&&!a.sync.getStatus().ready,'pending identity starts read-only');await starting;
 check(a.sync.getStatus().writable&&svc.get('u').revision===1,'first device owns a lease and uploads its existing save');await b.start();
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
 console.log(`Cloud sync tests passed: ${assertions} protocol, canonical-state, concurrent-save, takeover, stale-identity, hidden-presence, lease-expiry, unload-order, offline, checkpoint and explicit first-start assertions. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
