/* Foreground motion estimates and durable walking rewards. No location data. */
(function(global){
'use strict';
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const copy=value=>JSON.parse(JSON.stringify(value));
const clamp=(value,low,high)=>Math.max(low,Math.min(high,value));

// This detector accepts numbers, not browser events. The runtime below is the
// sole sensor adapter and rejects synthetic events before they reach it.
function createDetector(options={}){
 const config={warmupMs:800,minIntervalMs:300,maxIntervalMs:1600,maxGapMs:800,threshold:1.05,release:0.12,maxPeak:8,confirmPeaks:3,...options};
 let lastTime=null,startedAt=0,baseline=0,filtered=0,mode='',peak=null,lastPeak=null,lastInterval=null,streak=0,steady=false,totalSteps=0,phase='waiting',cadence=0;
 function reset({keepTotal=false}={}){lastTime=null;startedAt=0;baseline=0;filtered=0;mode='';peak=null;lastPeak=null;lastInterval=null;streak=0;steady=false;phase='waiting';cadence=0;if(!keepTotal)totalSteps=0;}
 function breakCadence(){peak=null;lastPeak=null;lastInterval=null;streak=0;steady=false;cadence=0;phase='finding';}
 function vector(value){if(!value||!['x','y','z'].every(key=>finite(value[key])))return null;return Math.hypot(value.x,value.y,value.z);}
 function reading(sample){const gravity=vector(sample?.accelerationIncludingGravity);if(gravity!==null&&gravity>=3&&gravity<=35)return{value:gravity,mode:'gravity'};const acceleration=vector(sample?.acceleration);return acceleration!==null&&acceleration<=30?{value:acceleration,mode:'linear'}:null;}
 function result(steps=0,valid=false){return{steps,valid,phase,cadence,totalSteps,signal:filtered};}
 function candidate(time){
  if(lastPeak===null){lastPeak=time;streak=1;phase='finding';return 0;}
  const interval=time-lastPeak;lastPeak=time;
  if(interval<config.minIntervalMs||interval>config.maxIntervalMs){streak=1;lastInterval=null;steady=false;phase='finding';return 0;}
  // Several evenly spaced peaks are required before an isolated movement can
  // become a walk. After a gap the first few peaks must be confirmed again.
  if(lastInterval!==null&&Math.max(interval,lastInterval)/Math.min(interval,lastInterval)>1.65){streak=2;lastInterval=interval;steady=false;phase='finding';return 0;}
  lastInterval=interval;cadence=Math.round(60000/interval);streak++;phase='finding';
  if(steady){phase='walking';return 1;}
  if(streak>=config.confirmPeaks){steady=true;phase='walking';return streak;}
  return 0;
 }
 function push(sample){
  const value=reading(sample),time=sample?.timeMs;
  if(!value||!finite(time)||time<0||lastTime!==null&&time<=lastTime)return result();
  if(lastTime===null||mode!==value.mode||time-lastTime>config.maxGapMs){
   lastTime=time;startedAt=time;baseline=value.value;filtered=0;mode=value.mode;breakCadence();phase='calibrating';return result(0,true);
  }
  const elapsed=time-lastTime;if(elapsed<5)return result();lastTime=time;
  baseline+=(value.value-baseline)*(elapsed/(900+elapsed));
  const difference=value.value-baseline;filtered+=(difference-filtered)*(elapsed/(45+elapsed));
  if(time-startedAt<config.warmupMs){phase='calibrating';return result(0,true);}
  if(Math.abs(difference)>12){breakCadence();return result(0,true);}
  if(lastPeak!==null&&time-lastPeak>config.maxIntervalMs+600)breakCadence();
  if(filtered>=config.threshold){
   if(!peak)peak={time,value:filtered,started:time};
   else if(filtered>peak.value){peak.value=filtered;peak.time=time;}
  }
  let steps=0;
  if(peak&&filtered<config.release){const finished=peak;peak=null;const width=time-finished.started;
   if(finished.value<=config.maxPeak&&width>=40&&width<=650)steps=candidate(finished.time);
   else breakCadence();
  }
  totalSteps+=steps;return result(steps,true);
 }
 return{push,reset,getState:()=>result()};
}

const STORAGE_PREFIX='sengoku-walking-pending-v1:';
const int=value=>Number.isSafeInteger(value)&&value>=0;
function failure(code,message){return Object.assign(Error(message),{code});}
function createController(options={}){
 const win=options.window||global,doc=options.document||win.document||{},nav=options.navigator||win.navigator||{},storage=options.storage||win.localStorage;
 const bridge=typeof options.bridge==='function'?options.bridge:()=>options.bridge||win.SengokuBridge;
 const now=options.now||(()=>win.performance?.now?.()??Date.now()),wallNow=options.wallNow||(()=>Date.now()),later=options.setTimeout||win.setTimeout?.bind(win),cancel=options.clearTimeout||win.clearTimeout?.bind(win);
 const detector=createDetector(),listeners=new Set();if(options.onChange)listeners.add(options.onChange);
 let record=null,ownerId='',scopeId='',phase='idle',reason='',message='端末を持って歩くと、歩数に応じて資産が増えます。',permission='unknown',active=false,starting=false,disposed=false,epoch=0,startTask=null,sendTask=null,timer=null,lastAccounted=0,lastValid=null,sensorSince=0,lastHeartbeat=0,wake=null,wakeState='off',keepAwake=true,accessUnsubscribe=null;
 function access(){const value=bridge()?.getWalkingAccess?.();return value&&typeof value==='object'?value:{started:false,mode:'local',ownerId:'',canCount:false,canClaim:false,reason:'unstarted',message:'はじめに本拠の城を選んでください。'};}
 function visible(){return doc.hidden!==true&&doc.visibilityState!=='hidden';}
 function snapshot(){const a=access(),unconfirmed=Math.max(0,(record?.totalSteps||0)-(record?.ackSteps||0));return{phase,reason,message,permission,active,starting,busy:Boolean(startTask||sendTask),mode:a.mode||'local',ownerId,estimatedSteps:record?.totalSteps||0,confirmedSteps:record?.ackSteps||0,pendingSteps:record?.closed?0:unconfirmed,rejectedSteps:record?.closed||record?.rejected?unconfirmed:0,rejected:Boolean(record?.rejected&&!record?.closed),pending:record?.pending?{seq:record.pending.seq,totalSteps:record.pending.totalSteps,activeMs:record.pending.activeMs,finish:record.pending.finish}:null,activeMs:Math.floor(record?.activeMs||0),closed:Boolean(record?.closed),sensor:detector.getState().phase,wakeState,keepAwake,wakeSupported:Boolean(nav.wakeLock?.request),canCount:a.canCount===true,canClaim:a.canClaim===true,started:a.started===true,lifetimeSteps:a.totalSteps||0};}
 function emit(){const state=snapshot();for(const fn of listeners){try{fn(state);}catch(_){}}return state;}
 function state(next,text,why=''){phase=next;message=text;reason=why;emit();}
 function scope(value){return JSON.stringify([value.mode,value.ownerId,value.campaignId]);}
 function key(value){return STORAGE_PREFIX+encodeURIComponent(scope(value));}
 function persist(value=record){if(!value)return;try{if(!storage?.setItem)throw Error('storage unavailable');storage.setItem(key(value),JSON.stringify(value));}catch(_){throw failure('WALKING_STORAGE','歩数を端末に保存できないため、計測を停止しました。保存領域を確認してから再試行してください。');}}
 function validRecord(value,a){return value?.version===1&&value.ownerId===a.ownerId&&value.mode===a.mode&&value.campaignId===a.campaignId&&typeof value.requestId==='string'&&int(value.totalSteps)&&int(value.ackSteps)&&value.totalSteps>=value.ackSteps&&finite(value.activeMs)&&value.activeMs>=0&&int(value.ackSeq)&&(!value.pending||int(value.pending.seq)&&int(value.pending.totalSteps)&&int(value.pending.activeMs)&&typeof value.pending.finish==='boolean');}
 function load(a){ownerId=a.ownerId||'';scopeId=scope(a);record=null;if(!ownerId)return;
  try{const raw=storage?.getItem?.(key(a));if(raw){const parsed=JSON.parse(raw);if(validRecord(parsed,a))record=parsed;else throw Error('invalid ledger');}}
  catch(_){phase='error';reason='WALKING_STORAGE';message='保存されている歩行記録を確認できません。新しい計測は開始していません。';}
 }
 function uuid(){if(options.uuid)return options.uuid();if(win.crypto?.randomUUID)return win.crypto.randomUUID();if(win.crypto?.getRandomValues){const bytes=new Uint8Array(16);win.crypto.getRandomValues(bytes);bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;return [...bytes].map((v,i)=>([4,6,8,10].includes(i)?'-':'')+v.toString(16).padStart(2,'0')).join('');}throw failure('WALKING_STORAGE','このブラウザでは安全な歩行記録を作成できません。');}
 function current(value){const a=access();return !disposed&&a.ownerId===value?.ownerId&&a.campaignId===value?.campaignId&&a.mode===value?.mode;}
 function account(){if(!active||!record)return;const time=now(),elapsed=clamp(time-lastAccounted,0,1500);lastAccounted=time;if(visible())record.activeMs+=elapsed;}
 function releaseWake(){const held=wake;wake=null;wakeState='off';if(held){try{Promise.resolve(held.release()).catch(()=>{});}catch(_){}}}
 function requestWake(g){if(!keepAwake){wakeState='off';return;}if(!nav.wakeLock?.request){wakeState='unavailable';emit();return;}
  wakeState='requesting';Promise.resolve().then(()=>nav.wakeLock.request('screen')).then(lock=>{
   if(disposed||g!==epoch||!active||!visible()){try{Promise.resolve(lock.release()).catch(()=>{});}catch(_){}return;}
   wake=lock;wakeState=lock.released?'released':'active';lock.addEventListener?.('release',()=>{if(wake===lock){wake=null;wakeState=active?'released':'off';emit();}});emit();
  }).catch(()=>{if(g===epoch&&active){wakeState='unavailable';emit();}});
 }
 function cancelTimer(){if(timer!==null){cancel?.(timer);timer=null;}}
 function detach(){win.removeEventListener?.('devicemotion',motion);cancelTimer();releaseWake();detector.reset();lastValid=null;}
 function pause(why='paused',text){
  account();active=false;starting=false;epoch++;detach();
  if(record&&!record.closed&&record.session){record.wantFinish=true;try{persist();}catch(error){why=error.code;text=error.message;}}
  state(why==='WALKING_STORAGE'?'error':'paused',text||({hidden:'画面が非表示のため計測を一時停止しました。戻ったら「再開する」を押してください。',closed:'計測を停止しました。未反映の歩数は、次に接続できたときに同期します。',offline:'通信が途切れたため計測を一時停止しました。検知済みの歩数は端末に保管しています。',follower:'別の端末が操作中のため計測を一時停止しました。操作端末を切り替えてから再開できます。',identity:'接続する領主や物語が変わったため計測を停止しました。',sensor:'端末の動きを読み取れませんでした。センサーのあるスマートフォンで、モーションの利用を許可してください。'}[why]||'計測を一時停止しました。検知済みの歩数は保持しています。'),why);
  return snapshot();
 }
 function adoptSession(value,r){if(!value||typeof value.id!=='string'||typeof value.token!=='string'||value.campaignId!==r.campaignId||!int(value.lastSeq)||!int(value.totalSteps)||!int(value.activeMs))throw failure('WALKING_RESPONSE','歩行の接続結果を確認できませんでした。再試行してください。');r.session={id:value.id,token:value.token,expiresAt:value.expiresAt,lastSeq:value.lastSeq,totalSteps:value.totalSteps,activeMs:value.activeMs};r.closed=value.closed===true;}
 function preparePending(r,finish){if(r.pending)return r.pending;r.pending={seq:r.ackSeq+1,totalSteps:r.totalSteps,activeMs:Math.floor(r.activeMs),finish:finish===true};persist(r);return r.pending;}
 async function flushRecord(r,{finish=false}={}){
  if(!r?.session||r.closed)return{ok:true,closed:true};if(!current(r)||!visible()||access().canClaim!==true)return{ok:false,pending:true};
  if(finish)r.wantFinish=true;
  if(sendTask){await sendTask;if(!current(r))return{ok:false};if(r.closed)return{ok:true};if(!r.pending&&!r.wantFinish&&r.totalSteps===r.ackSteps&&Math.floor(r.activeMs)===(r.ackedActiveMs||0))return{ok:true};return flushRecord(r,{finish:r.wantFinish});}
  if(!r.pending&&r.mode==='local'&&r.totalSteps===r.ackSteps&&!r.wantFinish)return{ok:true};
  const pending=preparePending(r,r.wantFinish===true),owner=r.ownerId;
  const task=(async()=>{
   try{
    let result;
    if(r.mode==='local'){
     result=await bridge().applyLocalWalkingProgress({sessionId:r.session.id,campaignId:r.campaignId,totalSteps:pending.totalSteps});
     if(!result?.ok)throw failure(result?.code||'WALKING_SAVE',result?.message||'歩行の報酬を保存できませんでした。');
     if(pending.finish){const closed=await bridge().endLocalWalkingSession({sessionId:r.session.id,campaignId:r.campaignId});if(!closed?.ok)throw failure(closed?.code||'WALKING_SAVE',closed?.message||'歩行の終了を保存できませんでした。');}
    }else{
     result=await bridge().claimWalkingSteps({sessionId:r.session.id,sessionToken:r.session.token,...pending});
     if(!result?.ok||!result.receipt||result.receipt.seq!==pending.seq||result.receipt.totalSteps!==pending.totalSteps)throw failure('WALKING_RESPONSE','歩行の報酬を確認できませんでした。同じ歩数で再試行します。');
    }
    if(!current(r)||ownerId!==owner||record!==r)return{ok:false,stale:true};
    r.ackSeq=pending.seq;r.ackSteps=r.mode==='local'&&int(result.totalSteps)?Math.max(pending.totalSteps,result.totalSteps):pending.totalSteps;r.totalSteps=Math.max(r.totalSteps,r.ackSteps);r.ackedActiveMs=pending.activeMs;r.closed=pending.finish||result.closed===true;
    if(result.walkingSession){adoptSession(result.walkingSession,r);r.ackSeq=Math.max(r.ackSeq,r.session.lastSeq);r.ackSteps=Math.max(r.ackSteps,r.session.totalSteps);r.ackedActiveMs=Math.max(r.ackedActiveMs,r.session.activeMs);r.totalSteps=Math.max(r.totalSteps,r.ackSteps);r.activeMs=Math.max(r.activeMs,r.ackedActiveMs);}
    r.pending=null;delete r.previousPending;if(r.closed)r.wantFinish=false;persist(r);lastHeartbeat=now();if(r.closed&&active)pause('saved','この歩行計測は終了しました。受け取り済みの歩数を確認しています。');
    if(!active&&!starting&&reason!=='sensor')state('paused',r.closed&&r.totalSteps>r.ackSteps?`${r.totalSteps-r.ackSteps}歩は未反映のまま、この計測を終了しました。「再開する」で新しく計測できます。`:r.closed?'歩行分の報酬を保存しました。「再開する」で次の計測を始められます。':'検知済みの歩数を保存しました。','saved');else emit();
    return{ok:true};
   }catch(error){
    if(!current(r)||record!==r)return{ok:false,stale:true};
    if(error?.code==='WALKING_EXPIRED'&&r.pending&&!r.pending.finish){
     // The server only emits this after checking that this sequence has never
     // been accepted. It is therefore safe to turn it into a final settlement.
     if(active)pause('expired','計測を一時停止しました。保管した歩数を最終確認しています。');
     r.previousPending=copy(r.pending);r.pending={seq:r.pending.seq,totalSteps:r.totalSteps,activeMs:Math.floor(r.activeMs),finish:true};r.wantFinish=true;persist(r);return{ok:false,finalize:true};
    }
    if(error?.code==='WALKING_SEQUENCE_REUSED'&&r.previousPending){r.pending=r.previousPending;delete r.previousPending;r.wantFinish=true;persist(r);return{ok:false,finalize:true};}
    if(['WALKING_SEQUENCE_REUSED','WALKING_SEQUENCE_CONFLICT','WALKING_SESSION_CLOSED'].includes(error?.code)&&r.mode==='remote'){
     if(active)pause('sync','受け取り済みの歩数を確認しています。');
     try{const refreshed=await bridge().startWalkingSession({requestId:r.requestId,campaignId:r.campaignId});
      if(!current(r)||record!==r)return{ok:false,stale:true};
      if(!refreshed?.ok||refreshed.walkingSession?.id!==r.session.id)throw error;
      adoptSession(refreshed.walkingSession,r);r.ackSeq=r.session.lastSeq;r.ackSteps=r.session.totalSteps;r.ackedActiveMs=r.session.activeMs;r.totalSteps=Math.max(r.totalSteps,r.ackSteps);r.activeMs=Math.max(r.activeMs,r.ackedActiveMs);r.pending=null;delete r.previousPending;r.wantFinish=!r.closed;
      if(r.closed&&r.totalSteps>r.ackSteps)r.rejected={code:'WALKING_SESSION_CLOSED'};
      persist(r);state('paused',r.closed&&r.totalSteps>r.ackSteps?`${r.totalSteps-r.ackSteps}歩は未反映です。前の計測が終了しているため、新しい計測から再開できます。`:'受け取り済みの歩数を確認しました。','saved');return{ok:r.closed,finalize:!r.closed};
     }catch(reconcileError){error=reconcileError;}
    }
    if(['WALKING_RATE_EXCEEDED','WALKING_TOTAL_EXCEEDED'].includes(error?.code)){
     r.rejected={code:error.code};pause('rejected',`${Math.max(0,r.totalSteps-r.ackSteps)}歩を確認できなかったため、資産にはまだ反映していません。未反映分を区切って終了し、新しく計測できます。`);return{ok:false,rejected:true};
    }
    pause(error?.code==='WALKING_STORAGE'?'WALKING_STORAGE':error?.code==='LEASE_REQUIRED'?'follower':'sync',error?.message||'歩行分の同期を待っています。検知済みの歩数は端末に保管しています。');return{ok:false,error,pending:true};
   }
  })();sendTask=task;emit();let outcome;
  try{outcome=await task;}finally{if(sendTask===task)sendTask=null;emit();}
  if(outcome?.finalize&&current(r)&&access().canClaim===true)return flushRecord(r,{finish:true});
  if(outcome?.ok&&r.wantFinish&&!r.closed&&current(r))return flushRecord(r,{finish:true});
  return outcome;
 }
 function schedule(){cancelTimer();if(disposed||!active)return;timer=later?.(()=>{timer=null;tick();},1000);}
 function motion(event){
  if(disposed||!active||event?.isTrusted!==true||!visible())return;
  const a=access();if(!current(record)||a.canCount!==true){refreshAccess();return;}
  account();const result=detector.push({timeMs:now(),accelerationIncludingGravity:event.accelerationIncludingGravity,acceleration:event.acceleration});
  if(result.valid)lastValid=now();
  if(result.steps){record.totalSteps+=result.steps;try{persist();}catch(error){pause('WALKING_STORAGE',error.message);return;}}
  const next=result.phase==='walking'?'walking':result.valid?'calibrating':phase;
  if(next!==phase||result.steps){state(next,next==='walking'?'歩調を検知しています。歩数の報酬は自動で保存します。':'歩調を確認しています。そのまま数歩、続けて歩いてください。','');}
  if(record.mode==='local'&&result.steps)flushRecord(record).catch(()=>{});
 }
 function tick(){
  if(!active||disposed)return;refreshAccess();if(!active)return;account();
  if(now()-(lastValid??sensorSince)>8000){pause('sensor');retry().catch(()=>{});return;}
  if(record?.mode==='remote'&&record.activeMs-(record.ackedActiveMs||0)>25000){pause('sync','歩行分の同期を確認するため計測を一時停止しました。検知済みの歩数は保管しています。');retry().catch(()=>{});return;}
  if(record&&now()-lastHeartbeat>=5000&&!sendTask&&access().canClaim===true)flushRecord(record).catch(()=>{});
  emit();schedule();
 }
 function startFromGesture(settings={}){
  if(disposed)return Promise.resolve({ok:false});if(starting||active)return startTask||Promise.resolve({ok:true,active:true});
  const a=access();if(!a.started||!a.canCount||!a.ownerId){state('paused',a.message||'領主と端末の接続を確認してから開始してください。',a.reason||'unavailable');return Promise.resolve({ok:false});}
  if(win.isSecureContext!==true){state('unsupported','ウォーキングはHTTPSの公開サイトで利用できます。','secure-context');return Promise.resolve({ok:false});}
  if(!win.DeviceMotionEvent){state('unsupported','この端末・ブラウザでは動きセンサーを利用できません。対応するスマートフォンで開いてください。','unsupported');return Promise.resolve({ok:false});}
  if(!visible()){state('paused','このページを表示してから開始してください。','hidden');return Promise.resolve({ok:false});}
  let permissionTask;
  // Do not insert an await, network request, timer, or Promise callback before
  // this call. Safari requires the original Start button's user activation.
  try{permissionTask=typeof win.DeviceMotionEvent.requestPermission==='function'?win.DeviceMotionEvent.requestPermission():Promise.resolve('granted');}
  catch(error){state('denied','端末のモーション利用を許可できませんでした。ブラウザの設定を確認して、もう一度開始してください。','permission');return Promise.resolve({ok:false,error});}
  starting=true;keepAwake=settings.keepAwake!==false;permission='prompt';const g=++epoch,capturedScope=scope(a);state('starting','モーションの許可と歩行の接続を確認しています。','');
  const task=(async()=>{
   try{
    const granted=await permissionTask;if(disposed||g!==epoch||!visible()||scope(access())!==capturedScope)return{ok:false,stale:true};
    permission=granted;if(granted!=='granted'){state('denied','モーションの利用が許可されませんでした。ブラウザの設定で許可してから、もう一度開始してください。','permission');return{ok:false};}
    if(scopeId!==capturedScope)load(access());
    if(reason==='WALKING_STORAGE')throw failure('WALKING_STORAGE',message);
    if(record?.rejected&&!record.closed)throw failure('WALKING_REJECTED','未反映の歩数があります。「未反映分を区切って終了」で前の計測を終了してから、新しく始められます。');
    if(record?.session&&!record.closed){record.wantFinish=true;persist();const previous=await flushRecord(record,{finish:true});if(!previous.ok)throw failure('WALKING_PENDING','保管している歩数の同期を確認してから、次の計測を始めます。「報酬を同期」で再試行できます。');}
    if(disposed||g!==epoch||!visible()||scope(access())!==capturedScope||!access().canCount)return{ok:false,stale:true};
    const fresh=access();if(!record||record.closed)record={version:1,ownerId:fresh.ownerId,mode:fresh.mode,campaignId:fresh.campaignId,requestId:uuid(),session:null,totalSteps:0,ackSteps:0,ackSeq:0,activeMs:0,ackedActiveMs:0,pending:null,wantFinish:false,closed:false};persist();const r=record;
    if(r.mode==='local'){
     const result=await bridge().beginLocalWalkingSession({sessionId:r.requestId,campaignId:r.campaignId});if(!result?.ok)throw failure(result?.code||'WALKING_SAVE',result?.message||'歩行記録を保存できませんでした。');r.session={id:r.requestId};
    }else{
     const result=await bridge().startWalkingSession({requestId:r.requestId,campaignId:r.campaignId});if(!result?.ok)throw failure('WALKING_RESPONSE','歩行の接続を確認できませんでした。再試行してください。');adoptSession(result.walkingSession,r);if(!r.pending){r.ackSeq=r.session.lastSeq;r.ackSteps=r.session.totalSteps;r.ackedActiveMs=r.session.activeMs;r.totalSteps=Math.max(r.totalSteps,r.ackSteps);r.activeMs=Math.max(r.activeMs,r.ackedActiveMs);}
    }
    persist(r);
    if(disposed||g!==epoch||!visible()||!current(r)||!access().canCount){r.wantFinish=true;persist(r);return{ok:false,stale:true};}
    detector.reset();active=true;starting=false;lastAccounted=now();sensorSince=now();lastValid=null;lastHeartbeat=now();state('waiting','端末の動きを待っています。端末を持って歩き始めてください。','');win.addEventListener?.('devicemotion',motion);requestWake(g);schedule();return{ok:true};
   }catch(error){if(!disposed&&g===epoch&&scope(access())===capturedScope)state(error?.code==='WALKING_STORAGE'?'error':'paused',error?.message||'ウォーキングを開始できませんでした。再試行してください。',error?.code||'start');return{ok:false,error};}
   finally{if(g===epoch)starting=false;if(startTask===task)startTask=null;emit();}
  })();startTask=task;return task;
 }
 async function retry(){if(disposed)return{ok:false};refreshAccess({retry:false});if(!record||record.closed)return{ok:true};if(record.rejected&&!record.pending?.finish)return{ok:false,rejected:true};if(!visible()||access().canClaim!==true){emit();return{ok:false,pending:true};}try{persist();if(!record.session){if(reason==='WALKING_STORAGE')state('paused','保存を確認しました。「再開する」で計測を始めてください。','');return{ok:false,startRequired:true};}return await flushRecord(record,{finish:!active});}catch(error){pause('WALKING_STORAGE',error.message);return{ok:false,error};}}
 async function closeRejected(){const r=record;if(!r?.rejected||r.closed||!current(r)||!visible()||!access().canClaim)return{ok:false};pause('rejected','受け取り済みの分を確定し、未反映分を区切って計測を終了します。');if(r.pending)r.previousPending=copy(r.pending);r.pending={seq:r.ackSeq+1,totalSteps:r.ackSteps,activeMs:r.ackedActiveMs||0,finish:true};r.wantFinish=true;try{persist(r);return await flushRecord(r,{finish:true});}catch(error){pause('WALKING_STORAGE',error.message);return{ok:false,error};}}
 function stop(){pause('closed');return retry();}
 function refreshAccess({retry:allowRetry=false}={}){
  if(disposed)return;const a=access();
  if(scope(a)!==scopeId){if(active||starting)pause('identity');reason='';load(a);if(!active&&!starting&&reason!=='WALKING_STORAGE'){phase='idle';message=record&&!record.closed?'前回の歩行記録を保管しています。計測前に報酬を同期します。':'端末を持って歩くと、歩数に応じて資産が増えます。';}}
  if((active||starting)&&(!visible()||!a.canCount))pause(!visible()?'hidden':a.reason||'sync',a.message);
  emit();if(allowRetry&&record?.session&&!record.closed&&!active&&!starting&&!sendTask&&visible()&&a.canClaim===true)retry().catch(()=>{});
 }
 function onVisibility(){if(!visible()){pause('hidden');return;}refreshAccess({retry:true});}
 function onPageHide(){pause('hidden');}
 function onConnection(){if(nav.onLine===false&&access().mode==='remote')pause('offline');else refreshAccess({retry:true});}
 function invalidateCampaign(){if(record&&!record.closed){pause('identity');record=null;}ownerId='';load(access());emit();}
 function dispose(){if(disposed)return;pause('closed');disposed=true;epoch++;doc.removeEventListener?.('visibilitychange',onVisibility);win.removeEventListener?.('pagehide',onPageHide);win.removeEventListener?.('offline',onConnection);win.removeEventListener?.('online',onConnection);accessUnsubscribe?.();listeners.clear();}
 doc.addEventListener?.('visibilitychange',onVisibility);win.addEventListener?.('pagehide',onPageHide);win.addEventListener?.('offline',onConnection);win.addEventListener?.('online',onConnection);
 load(access());const subscribe=options.subscribeAccess||win.SengokuCloudSync?.subscribe?.bind(win.SengokuCloudSync);if(subscribe)accessUnsubscribe=subscribe(()=>refreshAccess());
 return{startFromGesture,pause,stop,retry,closeRejected,refreshAccess,invalidateCampaign,dispose,getState:snapshot,subscribe:fn=>{listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);}};
}

const api={createDetector,createController};
if(typeof module!=='undefined'&&module.exports)module.exports=api;
global.SengokuWalking=api;
if(!global.document?.createElement)return;
let live=null,dialog=null,returnFocus=null,unsubscribe=null;
const uiPaths={walking:'M14 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4M8 21l3-6-2-5 3-4 3 5 5 1M5 11l4-1M11 15l5 2 1 5',gold:'M20 6c0 2-4 4-8 4S4 8 4 6s4-4 8-4 8 2 8 4ZM4 6v6c0 2 4 4 8 4s8-2 8-4V6M4 12v6c0 2 4 4 8 4s8-2 8-4v-6',rice:'M12 22V3M12 7C5 7 5 3 5 2c6 0 7 5 7 5Zm0 5c-7 0-7-4-7-5 6 0 7 5 7 5Zm0-2c7 0 7-4 7-5-6 0-7 5-7 5Zm0 5c7 0 7-4 7-5-6 0-7 5-7 5',wood:'M12 2 5 10h3l-5 7h7v5h4v-5h7l-5-7h3l-7-8Z',stone:'m2 20 7-14 5 8 3-5 5 11H2Zm5-10 2 2 2-2M16 11l2 3',magatama:'M17.5 3.5C11-1 3 4 3 11c0 7 6 11 12 10-5-2-5-6-2-8 6 1 9-5 4.5-9.5ZM12.5 5.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z',close:'m6 6 12 12M6 18 18 6'};
const svg=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${uiPaths[name]||uiPaths.walking}"/></svg>`;
function ensureController(){if(!live){live=createController({window:global});unsubscribe=live.subscribe(updateUI);}return live;}
function setText(selector,value){const node=dialog?.querySelector(selector);if(node&&node.textContent!==String(value))node.textContent=value;}
function updateUI(value){
 const number=n=>Math.max(0,Math.floor(n||0)).toLocaleString('ja-JP');
 for(const entry of global.document.querySelectorAll?.('[data-walking-summary]')||[])entry.textContent=value.active?`計測中 · ${number(value.estimatedSteps)}歩${value.pendingSteps?` · ${number(value.pendingSteps)}歩を保存中`:''}`:value.pendingSteps?`${number(value.pendingSteps)}歩を同期待ち`:'端末を持って歩いて、領国を育てる';
 if(!dialog)return;
 dialog.dataset.phase=value.phase;
 setText('[data-walking-status]',({idle:'未開始',starting:'許可・接続を確認中',waiting:'センサーを確認中',calibrating:'歩調を確認中',walking:'計測中',paused:'計測停止',unsupported:'この端末では利用不可',denied:'モーションの許可が必要',error:'保存を確認してください'})[value.phase]||'計測停止');
 setText('[data-walking-message]',value.message);
 setText('[data-walking-steps]',number(value.estimatedSteps));setText('[data-walking-confirmed]',number(value.confirmedSteps));setText('[data-walking-pending]',number(value.rejectedSteps||value.pendingSteps));setText('[data-walking-pending-label]',value.rejectedSteps?'未反映':'保存・同期待ち');
 setText('[data-walking-mode]',value.mode==='remote'?'領主の進行へ自動同期':'この端末の物語に保存');
 setText('[data-walking-saved-note]',value.pendingSteps?'検知済みの歩数を保管しています。受け取り済みか確認しながら同期します。':value.confirmedSteps?'受け取り済みの報酬は、ゲームの資産へ反映されています。':'連続した歩調を確認してから数えます。振動や持ち方により、実際の歩数と差が出ることがあります。');
 const start=dialog.querySelector('[data-walking-action="start"]'),stop=dialog.querySelector('[data-walking-action="stop"]'),retry=dialog.querySelector('[data-walking-action="retry"]'),awake=dialog.querySelector('#walking-keep-awake'),discard=dialog.querySelector('[data-walking-action="discard"]');
 start.hidden=value.active;start.disabled=value.starting||value.busy||!value.canCount||value.phase==='unsupported';start.textContent=value.starting?'開始を確認中…':value.phase==='idle'?'計測を始める':'再開する';
 stop.hidden=!value.active;stop.disabled=false;retry.hidden=value.rejected||!(value.pending||value.pendingSteps||value.reason==='WALKING_STORAGE');retry.disabled=value.busy||!value.canClaim;discard.hidden=!value.rejected;discard.disabled=value.busy||!value.canClaim;
 awake.disabled=value.active||value.starting||!value.wakeSupported;
 setText('[data-walking-wake]',value.active?({active:'画面の点灯を維持しています。',requesting:'画面の点灯を維持できるか確認しています。',released:'画面の点灯維持が解除されました。画面が消えると計測も停止します。',unavailable:'この端末では画面の点灯を維持できません。画面を表示したままご利用ください。',off:'画面を表示している間だけ計測します。'})[value.wakeState]||'画面を表示している間だけ計測します。':value.wakeSupported?'開始中だけ、対応する端末で画面の点灯を維持します。':'このブラウザは画面の点灯維持に対応していません。');
}
function closeUI(){if(!dialog)return;ensureController().stop().catch(()=>{});dialog.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
function open(){
 const controller=ensureController();controller.refreshAccess();
 if(!dialog){
  dialog=global.document.createElement('dialog');dialog.className='walking-dialog';dialog.setAttribute('aria-labelledby','walking-title');
  dialog.innerHTML=`<div class="walking-shell"><header class="walking-header"><div class="walking-heading"><span class="walking-emblem">${svg('walking')}</span><div><span class="eyebrow">WALKING</span><h2 id="walking-title">ウォーキング</h2></div></div><button class="icon-button" data-walking-action="close" aria-label="ウォーキングを閉じる">${svg('close')}</button></header><div class="walking-body"><div class="walking-status-row"><span class="walking-status" data-walking-status>未開始</span><span data-walking-mode>この端末の物語に保存</span></div><h3 class="walking-lead">あなたの一歩が、<br>領国の力になる。</h3><p class="walking-intro">検知した1歩ごとに、5つの資産がそれぞれ<span>2</span>増えます。</p><div class="walking-rewards" aria-label="1歩あたりの報酬">${[['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材'],['magatama','勾玉']].map(([id,label])=>`<div class="walking-reward walking-reward-${id}">${svg(id)}<span>${label}</span><b>+2</b></div>`).join('')}</div><div class="walking-stats"><div><span>今回の推定歩数</span><strong data-walking-steps>0</strong><small>歩</small></div><div><span>受け取り済み</span><strong data-walking-confirmed>0</strong><small>歩</small></div><div><span data-walking-pending-label>保存・同期待ち</span><strong data-walking-pending>0</strong><small>歩</small></div></div><p class="walking-message" data-walking-message role="status"></p><p class="walking-saved-note" data-walking-saved-note></p><label class="walking-awake"><input id="walking-keep-awake" type="checkbox" checked><span>計測中は画面の点灯を維持する<small data-walking-wake></small></span></label><div class="walking-guide"><p>このページを<strong>表示している間</strong>だけ計測します。画面のロック中や、ブラウザを閉じている間は計測できません。</p><p>位置情報は使いません。実時間の歩行が対象で、ゲームの暦の速さや停止には影響されません。資産は所持上限まで反映します。</p><p class="walking-care">画面の操作は、立ち止まって行ってください。</p></div></div><footer class="walking-actions"><button class="button gold" data-walking-action="start">計測を始める</button><button class="button primary" data-walking-action="stop" hidden>計測を終了する</button><button class="button" data-walking-action="retry" hidden>報酬を同期</button><button class="button" data-walking-action="discard" hidden>未反映分を区切って終了</button><button class="button subtle" data-walking-action="sync">端末同期</button></footer></div>`;
  global.document.body.appendChild(dialog);
  dialog.addEventListener('click',event=>{const button=event.target.closest('[data-walking-action]');if(!button||button.disabled)return;const action=button.dataset.walkingAction;
   if(action==='start'){const promise=controller.startFromGesture({keepAwake:dialog.querySelector('#walking-keep-awake').checked});promise.catch(()=>{});}
   else if(action==='stop')controller.stop().catch(()=>{});
   else if(action==='retry')controller.retry().catch(()=>{});
   else if(action==='discard')controller.closeRejected().catch(()=>{});
   else if(action==='sync'){closeUI();global.SengokuSocial?.open?.('sync');}
   else if(action==='close')closeUI();
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeUI();});
 }
 returnFocus=global.document.activeElement;updateUI(controller.getState());if(!dialog.open)dialog.showModal();
 const target=dialog.querySelector('[data-walking-action="start"]');if(!target.disabled)target.focus({preventScroll:true});
}
Object.assign(api,{open,close:closeUI,getState:()=>ensureController().getState(),refreshAccess:()=>live?.refreshAccess(),pause:(...args)=>live?.pause(...args),invalidateCampaign:()=>live?.invalidateCampaign(),dispose:()=>{unsubscribe?.();live?.dispose();dialog?.remove();dialog=null;live=null;}});
if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',ensureController,{once:true});else ensureController();
})(typeof window!=='undefined'?window:globalThis);
