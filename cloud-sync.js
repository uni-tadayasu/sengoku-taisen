/* 戦国VS・端末間の自動保存。一つの領主につき、進行する端末は一つ。 */
(function(global){
'use strict';
const NAME_KEY='sengoku-device-name-v1',PENDING_KEY='sengoku-sync-pending-v1';
function fingerprint(save){
 if(!save||typeof save!=='object'||!save.state||typeof save.state!=='object')return'';
 const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
 return JSON.stringify(sorted(save.state));
}
function hash(value){let a=2166136261,b=3339675911;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return(a>>>0).toString(16)+':'+(b>>>0).toString(16);}
function makeDevice(){
 const random=()=>global.crypto?.randomUUID?.()||'device-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 // A fresh document suffix also separates duplicated tabs, whose sessionStorage is copied.
 let stem;try{stem=sessionStorage.getItem('sengoku-device-tab-v1');if(!stem){stem=random();sessionStorage.setItem('sengoku-device-tab-v1',stem);}}catch(_){stem=random();}
 let name;try{name=localStorage.getItem(NAME_KEY);}catch(_){}
 const ua=global.navigator?.userAgent||'';
 return{id:(stem+'-'+random()).slice(0,90),name:String(name||(/iPad|Tablet/i.test(ua)?'タブレット':/Mobile|Android|iPhone/i.test(ua)?'スマートフォン':'パソコン')).slice(0,40)};
}
function create(options={}){
 const device={...(options.device||makeDevice())},deviceStem=device.id.slice(0,36),now=options.now||(()=>Date.now()),hidden=options.hidden||(()=>Boolean(global.document?.hidden)),online=options.online||(()=>global.navigator?.onLine!==false),bridge=options.bridge||(()=>global.SengokuBridge),storage=options.storage||global.localStorage;
 const later=options.setTimeout||global.setTimeout.bind(global),cancel=options.clearTimeout||global.clearTimeout.bind(global);
 const listeners=new Set();let session=null,generation=0,queue=Promise.resolve(),initialized=false,applying=false,dirty=false,ack='',revision=0,leaseDeadline=0,lastLeaseAt=0,refreshPending=null,attempt=null,banned=false,banMessage='',accessRefreshPending=false;
 let pollTimer=null,saveTimer=null,presenceTimer=null,expiryTimer=null;
 let status={linked:false,ready:true,writable:true,banned:false,reason:'local',message:'この端末に自動保存しています。',revision:0,updatedAt:null,leaseExpiresAt:null,writerDeviceName:null,deviceName:device.name};
 const valid=g=>Boolean(session&&g===generation);
 const rolePending=()=>bridge()?.getRoleAccess?.().pending===true;
 const local=()=>{const currentBridge=bridge(),save=currentBridge?.getSave?.();if(save===null&&currentBridge?.hasStarted?.()===false)return null;if(!fingerprint(save))throw Error('ゲームの保存データを確認できませんでした。');return save;};
 const stored=()=>{const currentBridge=bridge();return currentBridge?.getStoredSave?currentBridge.getStoredSave():local();};
 function checkpoint(){
  if(!session||!initialized||rolePending())return;
  // A clock tick can advance the runtime after the primary local save. Keep the
  // exact pending snapshot and the durable source it belongs to in one write.
  // A failed storage write leaves the previous checkpoint and game save intact.
  try{if(dirty){const save=local(),durable=stored();if(!save||!fingerprint(durable))return;storage?.setItem(PENDING_KEY,JSON.stringify({id:String(session.id),revision,ack:hash(ack),local:hash(fingerprint(save)),durable:hash(fingerprint(durable)),snapshot:save,attempt}));}else{const old=JSON.parse(storage?.getItem(PENDING_KEY)||'null');if(old?.id===String(session.id))storage?.removeItem(PENDING_KEY);}}catch(_){}
 }
 function canResume(remoteKey,remoteRevision){
  try{const pending=JSON.parse(storage?.getItem(PENDING_KEY)||'null');if(pending?.id!==String(session.id))return null;
   const baseline=pending.revision===remoteRevision&&pending.ack===hash(remoteKey)||pending.attempt?.revision+1===remoteRevision&&pending.attempt?.key===hash(remoteKey);if(!baseline)return null;
   const durable=stored(),durableKey=fingerprint(durable),savedKey=fingerprint(pending.snapshot);
   if(savedKey&&pending.local===hash(savedKey)&&durableKey&&pending.durable===hash(durableKey))return pending.snapshot;
   // Older versions stored only a hash. Compare the unchanged on-disk source as
   // well as the runtime, which may have undergone a role/schema migration.
   return durableKey&&pending.local===hash(durableKey)?durable:null;
  }catch(_){return null;}
 }
 function emit(patch={}){
  status={...status,...patch,banned,deviceName:device.name};
  if(banned)status={...status,linked:true,ready:false,writable:false,reason:'banned',message:banMessage,leaseExpiresAt:null,writerDeviceName:null};
  bridge()?.setSyncAccess?.({...status});
  for(const fn of listeners){try{fn({...status});}catch(_){}}
 }
 function clearTimers(){for(const t of [pollTimer,saveTimer,presenceTimer,expiryTimer])if(t!==null)cancel(t);pollTimer=saveTimer=presenceTimer=expiryTimer=null;}
 function suspendAccount({playerId,message}={}){
  if(!session||playerId!==undefined&&String(playerId)!==String(session.id))return false;
  const changed=!banned;
  if(changed){checkpoint();generation++;queue=Promise.resolve();refreshPending=null;initialized=false;applying=false;attempt=null;}
  banned=true;accessRefreshPending=false;banMessage=message||'この領主は運営により利用を停止されています。解除後に接続を再確認してください。';leaseDeadline=0;clearTimers();emit();roleAccess({},true);
  if(changed)session.onUser?.({id:session.id,isBanned:true,isAdmin:false,isStaff:false});
  schedulePoll();return true;
 }
 function invalidateAccountAccess({playerId,message}={}){
  if(!session||playerId!==undefined&&String(playerId)!==String(session.id))return false;
  checkpoint();generation++;queue=Promise.resolve();refreshPending=null;initialized=false;applying=false;attempt=null;leaseDeadline=0;accessRefreshPending=true;clearTimers();roleAccess({},true);session?.onUser?.(null);
  emit({linked:true,ready:false,writable:false,reason:'access-changed',message:message||'領主の利用状態が更新されました。最新の接続状態を確認しています。',leaseExpiresAt:null});schedulePoll();return true;
 }
 function roleAccess(user={},pending=false){const current=bridge(),roles={isAdmin:user.isAdmin===true,isStaff:user.isStaff===true&&user.isAdmin!==true,pending};if(current?.setRoleAccess)current.setRoleAccess(roles);else current?.setAdminAccess?.(roles.isAdmin);}
 function applyStaffBase(snapshot,g){if(!valid(g)||snapshot.user?.isStaff!==true||snapshot.user?.isAdmin===true)return;const result=bridge()?.applyStaffBase?.(snapshot.staffBase||null);if(result?.ok===false)throw Error(result.message||'スタッフ共同拠点を確認できませんでした。');}
 function setRole(snapshot){
  const user=snapshot?.user;if(!user||String(user.id)!==String(session?.id))throw Error('同期する領主を確認できませんでした。');
  roleAccess(user);session.onUser?.(user);
 }
 function lease(snapshot){
  const server=Date.parse(snapshot.serverTime),until=Date.parse(snapshot.leaseExpiresAt),duration=Number.isFinite(server)&&Number.isFinite(until)?until-server:Number.isFinite(until)?until-now():0;
  const mine=snapshot.writerDeviceId===device.id&&snapshot.writable!==false&&duration>1000;
  leaseDeadline=mine?now()+Math.max(0,Math.min(30000,duration)-1000):0;
  if(expiryTimer!==null)cancel(expiryTimer);expiryTimer=null;
  const g=generation;if(leaseDeadline>now())expiryTimer=later(()=>{expiryTimer=null;if(!valid(g))return;leaseDeadline=0;emit({writable:false,reason:'lease-expired',message:'進行権を確認しています…',leaseExpiresAt:null});if(!hidden())refresh();},Math.max(1,leaseDeadline-now()));
  status.writerDeviceName=snapshot.writerDeviceName||(snapshot.writerDeviceId&&snapshot.writerDeviceId!==device.id?'別の端末':null);
  status.leaseExpiresAt=leaseDeadline?new Date(leaseDeadline).toISOString():null;
 }
 function access(){
  const writable=initialized&&leaseDeadline>now()&&!hidden()&&online()&&!rolePending();
  const awaitingStart=bridge()?.hasStarted?.()===false,reason=!online()?'offline':hidden()?'hidden':rolePending()?'auth':writable?(awaitingStart?'awaiting-start':'writer'):'follower';
  emit({linked:true,ready:initialized,writable,revision,reason,awaitingStart,leaseExpiresAt:leaseDeadline?new Date(leaseDeadline).toISOString():null,message:reason==='offline'?'通信が戻ると共通時刻までの進行を反映します。':reason==='hidden'?'この画面を開くと同期を再開します。':reason==='auth'?'領主の権限を確認しています。確認が終わるまで操作と保存を待機しています。':reason==='awaiting-start'?'開始する城を選ぶと、この領主の進行を保存します。':writable?(dirty?'変更を保存しています…':'自動同期中。この端末で進行できます。'):`${status.writerDeviceName||'別の端末'}の進行を自動で反映しています。`});
 }
 function schedulePoll(){if(pollTimer!==null)cancel(pollTimer);pollTimer=null;const g=generation;if(session&&!hidden())pollTimer=later(()=>{pollTimer=null;if(valid(g))refresh();},banned?30000:5000);}
 function enqueue(work){const g=generation;const task=queue.catch(()=>{}).then(()=>valid(g)?work(g):undefined);queue=task.catch(()=>{});return task;}
 async function request(g,route,opts={}){
  if(!valid(g))return null;if(banned&&!((opts.method||'GET')==='GET'&&route.startsWith('/sync?')))return null;
  const before=bridge()?.getRoleAccess?.();let result;
  try{result=await session.request(route,{...opts,background:true});}catch(error){if(valid(g)){if(error?.code==='ACCOUNT_BANNED')suspendAccount({playerId:session.id,message:error.message});else if(error?.code==='ACCOUNT_ACCESS_CHANGED')invalidateAccountAccess({playerId:session.id,message:error.message});}throw error;}
  if(!valid(g))return null;
  const current=bridge()?.getRoleAccess?.();
  if(before&&current&&before.epoch!==current.epoch&&result?.user&&(Boolean(result.user.isAdmin)!==current.isAdmin||Boolean(result.user.isStaff&&!result.user.isAdmin)!==current.isStaff)){const error=Error('役職が更新されたため、最新の権限と共同拠点を再確認しています。');error.code='STALE_ROLE';throw error;}
  return result;
 }
 async function apply(save,snapshot,g,{reason='remote',backup=false}={}){
  if(!valid(g))return false;emit({writable:false,reason:'applying',message:'最新の進行を反映しています…'});applying=true;
  try{const result=await bridge()?.applyCloudSave?.(save,{isAdmin:snapshot.user.isAdmin===true,isStaff:snapshot.user.isStaff===true&&snapshot.user.isAdmin!==true,staffBase:snapshot.staffBase||null,entitlements:snapshot.entitlements||{},source:'cloud',reason,backup});if(!valid(g))return false;if(result!==true&&result?.ok!==true)throw Error(result?.message||'最新データをこの端末に保存できませんでした。');return true;}
  finally{if(valid(g))applying=false;}
 }
 async function snapshot(result,g,{force=false,reason='remote'}={}){
  if(!valid(g)||!result)return false;
  if(!Number.isSafeInteger(result.revision)||result.revision<0||result.revision<revision)throw Error('同期データの更新番号を確認できませんでした。再接続して確認します。');
  if(result.user?.isBanned===true){suspendAccount({playerId:session.id});return false;}
  if(!result.user||String(result.user.id)!==String(session.id))throw Error('同期する領主を確認できませんでした。');
  if(banned){banned=false;banMessage='';status.banned=false;initialized=false;}
  setRole(result);if(result.clock)global.SengokuWorldClock?.accept(result.clock);const remote=result.save,remoteKey=remote?fingerprint(remote):'';
  if(remote&&!remoteKey)throw Error('同期データの形式を確認できませんでした。');
  if(remote&&(!initialized||force||result.revision>revision||remoteKey!==ack)){
   let before='',unreadable=false;try{before=fingerprint(local());}catch(_){unreadable=true;}
   const backup=unreadable||Boolean(before)&&(!initialized||force||(dirty&&before!==remoteKey));
   // Reopen only an unsent save whose exact server baseline is still authoritative.
   // A changed baseline always goes through the bridge's local-backup path.
   const resume=!force&&canResume(remoteKey,result.revision);
   if(!await apply(resume||remote,result,g,{reason:resume?'resume':!initialized?'initial':reason,backup:resume?Boolean(before)&&before!==fingerprint(resume):backup}))return false;
   ack=remoteKey;dirty=fingerprint(local())!==ack;
  }else if(!remote&&!initialized){ack='';dirty=Boolean(local());}
  applyStaffBase(result,g);revision=result.revision;initialized=true;attempt=null;checkpoint();status.updatedAt=result.updatedAt||null;lease(result);access();return true;
 }
 function fail(error,g){
  if(!valid(g)||error?.code==='STALE_IDENTITY')return;
  if(error?.code==='ACCOUNT_BANNED'){suspendAccount({playerId:session.id,message:error.message});return;}
  if(banned){emit();return;}
  const auth=error?.status===401;if(auth){roleAccess({},true);session.onUser?.(null);}
  emit({linked:true,ready:initialized,writable:false,reason:auth?'auth':online()?'error':'offline',message:auth?'領主情報を再接続してください。接続するまで操作を待機しています。':error?.message||'通信が戻ると共通時刻までの進行を反映します。'});
 }
 function scheduleSave(){if(saveTimer!==null||!session||!status.writable||hidden())return;const g=generation;saveTimer=later(()=>{saveTimer=null;if(valid(g))flush();},1000);}
 function notifySave(){if(!session||banned||applying||!initialized||rolePending())return;try{const save=local();dirty=Boolean(save)&&fingerprint(save)!==ack;checkpoint();if(dirty&&status.writable)scheduleSave();}catch(e){fail(e,generation);}}
 async function recoverConflict(g){
  emit({writable:false,reason:'conflict',message:'別の更新を確認したため、最新の保存を読み込んでいます…'});
  const result=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));
  if(result)await snapshot(result,g,{force:true,reason:'conflict'});
 }
 async function flushCore(g,{suspended=false,keepalive=false}={}){
  if(!valid(g)||banned||!initialized||rolePending()||!online()||leaseDeadline<=now()||(!suspended&&(!status.writable||hidden())))return{ok:false};
  const save=local();if(!save){dirty=false;attempt=null;checkpoint();if(!suspended)access();return{ok:true,waitingForStart:true};}
  const sent=fingerprint(save);dirty=sent!==ack;if(!dirty){if(!suspended)access();return{ok:true,unchanged:true};}
  attempt={revision,key:hash(sent)};checkpoint();emit({message:'変更を自動保存しています…'});
  try{
   const result=await request(g,'/sync',{method:'PUT',data:{deviceId:device.id,revision,save},keepalive});if(!result)return{ok:false};
   if(!Number.isSafeInteger(result.revision)||result.revision<=revision||!fingerprint(result.save))throw Error('自動保存の結果を確認できませんでした。');
   setRole(result);if(result.clock)global.SengokuWorldClock?.accept(result.clock);const canonical=fingerprint(result.save),current=fingerprint(local());
   // A save response must never erase actions performed while that request was in flight.
   if(current===sent&&canonical!==current){if(!await apply(result.save,result,g,{reason:'canonical',backup:false}))return{ok:false};}
   if(!valid(g))return{ok:false};applyStaffBase(result,g);revision=result.revision;ack=canonical;dirty=fingerprint(local())!==ack;initialized=true;attempt=null;checkpoint();status.updatedAt=result.updatedAt||null;lease(result);access();if(dirty&&!suspended)scheduleSave();return{ok:true};
  }catch(error){if(!valid(g))return{ok:false};if(['REVISION_CONFLICT','LEASE_REQUIRED','CYCLE_SETTLEMENT_REQUIRED','CLOCK_REWIND'].includes(error.code)){await recoverConflict(g);return{ok:false,conflict:true};}throw error;}
 }
 async function refreshCore(g,{takeOver=false,settleCycle=false}={}){
  if(!valid(g)||hidden()||!online()){if(valid(g))access();return{ok:false};}
  if(settleCycle&&initialized&&leaseDeadline>now()){
   const flushed=await flushCore(g);if(!flushed.ok)return flushed;
   try{const settled=await request(g,'/sync/settle',{method:'POST',data:{deviceId:device.id,revision}});if(!settled||!await snapshot(settled,g))return{ok:false};}
   catch(error){if(['REVISION_CONFLICT','LEASE_REQUIRED'].includes(error.code)){await recoverConflict(g);return{ok:false,conflict:true};}throw error;}
  }
  const resumePresence=banned||accessRefreshPending;let result=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));if(!result||!await snapshot(result,g))return{ok:false};
  if(resumePresence&&!banned){accessRefreshPending=false;await presence(true);if(!valid(g))return{ok:false};schedulePresence();}
  const until=Date.parse(result.leaseExpiresAt),server=Date.parse(result.serverTime)||now(),other=result.writerDeviceId&&result.writerDeviceId!==device.id&&until>server;
  if(takeOver||!other&&(leaseDeadline<=now()||now()-lastLeaseAt>=10000)){
   try{result=await request(g,'/sync/lease',{method:'POST',data:{deviceId:device.id,deviceName:device.name,takeOver:Boolean(takeOver)}});if(!result)return{ok:false};lastLeaseAt=now();if(!await snapshot(result,g))return{ok:false};}
   catch(error){if(error.code!=='LEASE_HELD')throw error;const latest=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));if(latest)await snapshot(latest,g);return{ok:false,held:true};}
  }
  if(!valid(g))return{ok:false};access();if(status.writable)await flushCore(g);return{ok:true,writable:status.writable};
 }
 function refresh(settings={}){
  if(!session)return Promise.resolve({ok:false});if(refreshPending&&!settings.takeOver&&!settings.settleCycle)return refreshPending;
  const g=generation,task=enqueue(async gen=>{try{return await refreshCore(gen,settings);}catch(e){fail(e,gen);return{ok:false,message:e.message};}});
  refreshPending=task;task.finally(()=>{if(valid(g)){if(refreshPending===task)refreshPending=null;schedulePoll();}});return task;
 }
 function flush(){if(saveTimer!==null)cancel(saveTimer);saveTimer=null;return enqueue(async g=>{try{return await flushCore(g);}catch(e){fail(e,g);return{ok:false,message:e.message};}});}
 async function presence(value,{keepalive=false}={}){
  const g=generation;if(!session||banned||value&&(hidden()||!online()))return;
  try{await request(g,'/presence',{method:'POST',data:{deviceId:device.id,deviceName:device.name,online:value},keepalive});}catch(_){}
 }
 function schedulePresence(){if(presenceTimer!==null)cancel(presenceTimer);presenceTimer=null;const g=generation;if(session&&!banned&&!hidden())presenceTimer=later(async()=>{presenceTimer=null;if(!valid(g)||hidden())return;await presence(true);if(valid(g))schedulePresence();},20000);}
 function start(next){
  stop({pending:true});generation++;device.id=(deviceStem+'-'+(global.crypto?.randomUUID?.()||generation+'-'+now().toString(36))).slice(0,90);session={id:next.id,request:next.request,onUser:next.onUser};queue=Promise.resolve();initialized=false;applying=false;dirty=false;ack='';revision=0;leaseDeadline=0;lastLeaseAt=0;refreshPending=null;attempt=null;banned=false;banMessage='';accessRefreshPending=false;
  emit({linked:true,ready:false,writable:false,reason:'initializing',message:'領主と最新の保存を確認しています…',revision:0,updatedAt:null,leaseExpiresAt:null,writerDeviceName:null});roleAccess({},true);
  if(!hidden()){presence(true);schedulePresence();return refresh();}access();return Promise.resolve({ok:false,hidden:true});
 }
 function stop({pending=false}={}){
  checkpoint();const previous=banned?null:session;generation++;session=null;clearTimers();queue=Promise.resolve();refreshPending=null;initialized=false;applying=false;dirty=false;ack='';revision=0;leaseDeadline=0;banned=false;banMessage='';accessRefreshPending=false;
  emit({linked:pending,ready:!pending,writable:!pending,reason:pending?'initializing':'local',message:pending?'領主と最新の保存を確認しています…':'この端末に自動保存しています。',revision:0,updatedAt:null,leaseExpiresAt:null,writerDeviceName:null});roleAccess({},pending);
  if(previous){for(const [route,data]of [['/presence',{deviceId:device.id,deviceName:device.name,online:false}],['/sync/release',{deviceId:device.id}]]){try{Promise.resolve(previous.request(route,{method:'POST',data,background:true,keepalive:true})).catch(()=>{});}catch(_){}}}
 }
 function visibilityChanged(){
  if(!session)return;
  if(banned){clearTimers();emit();if(!hidden())refresh();return;}
  if(hidden()){
   const g=generation;clearTimers();emit({writable:false,reason:'hidden',message:'この画面を開くと同期を再開します。'});
   enqueue(async gen=>{try{if(!valid(gen)||!hidden())return;if(leaseDeadline>now()&&online())await flushCore(gen,{suspended:true});if(!valid(gen)||!hidden())return;await presence(false);if(!valid(gen)||!hidden())return;await request(gen,'/sync/release',{method:'POST',data:{deviceId:device.id}});if(valid(gen)){leaseDeadline=0;emit({writable:false,leaseExpiresAt:null});}}catch(e){fail(e,gen);}}).finally(()=>{if(valid(g)&&!hidden())refresh();});
  }else{presence(true);schedulePresence();refresh();}
 }
 function connectionChanged(){if(!session)return;if(banned){emit();if(online()&&!hidden())refresh();return;}if(!online()){if(saveTimer!==null)cancel(saveTimer);saveTimer=null;emit({writable:false,reason:'offline',message:'通信が戻ると共通時刻までの進行を反映します。'});}else if(!hidden()){presence(true);schedulePresence();refresh();}}
 function pageHidden(){
  if(!session)return Promise.resolve();if(banned){clearTimers();emit();return Promise.resolve();}clearTimers();checkpoint();emit({writable:false,reason:'hidden',message:'この画面を開くと同期を再開します。'});presence(false,{keepalive:true});
  return enqueue(async g=>{try{const final=await flushCore(g,{suspended:true,keepalive:true});if(!valid(g)||!final?.ok)return;await request(g,'/sync/release',{method:'POST',data:{deviceId:device.id},keepalive:true});if(valid(g)){leaseDeadline=0;emit({writable:false,leaseExpiresAt:null});}}catch(e){fail(e,g);}});
 }
 function setDeviceName(value){const name=Array.from(String(value||'').trim()).slice(0,40).join('');if(!name)throw Error('端末名を入力してください。');try{localStorage.setItem(NAME_KEY,name);}catch(_){throw Error('端末名を保存できませんでした。');}device.name=name;emit();if(session&&!hidden())presence(true);return name;}
 return{start,stop,refresh,suspendAccount,invalidateAccountAccess,takeOver:()=>refresh({takeOver:true}),flush,notifySave,visibilityChanged,connectionChanged,pageHidden,setDeviceName,getStatus:()=>({...status}),getDevice:()=>({...device}),subscribe:fn=>{listeners.add(fn);fn({...status});return()=>listeners.delete(fn);}};
}
const sync=create();sync.create=create;sync.fingerprint=fingerprint;global.SengokuCloudSync=sync;
global.addEventListener?.('sengoku:game-saved',()=>sync.notifySave());
global.addEventListener?.('online',()=>sync.connectionChanged());global.addEventListener?.('offline',()=>sync.connectionChanged());global.addEventListener?.('pagehide',()=>sync.pageHidden());global.addEventListener?.('pageshow',()=>sync.visibilityChanged());
global.document?.addEventListener?.('visibilitychange',()=>sync.visibilityChanged());
})(window);
