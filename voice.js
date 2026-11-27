/* Alliance and staff audio rooms. Media stays outside the redrawable chat panel. */
(function(global){
'use strict';
const SESSION=/^vc_[a-f0-9]{32}$/;
const CHANNELS=new Set(['guild','admin']);
const fatalCodes=new Set(['VOICE_SESSION_EXPIRED','VOICE_ACCESS_CHANGED','GUILD_REQUIRED','STAFF_CHAT_REQUIRED','STAFF_REQUIRED','ADMIN_REQUIRED','STALE_IDENTITY','ACCOUNT_BANNED']);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanText=(value,max=120)=>typeof value==='string'?value.slice(0,max):'';
const clone=value=>JSON.parse(JSON.stringify(value));
const icons={phone:'<path d="M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C9 20 4 15 3 5a2 2 0 0 1 2-2Z"/>',mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',muted:'<path d="m3 3 18 18M9 9v3a3 3 0 0 0 5 2M9 5a3 3 0 0 1 6 0v5M5 10v2a7 7 0 0 0 12 5m2-5v-2M12 19v3m-4 0h8"/>',speaker:'<path d="m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',quiet:'<path d="m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',leave:'<path d="M5 16v-4a16 16 0 0 1 14 0v4l3-1v-4a20 20 0 0 0-20 0v4l3 1Z"/>',people:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3m2-17a3 3 0 0 1 0 6m1 4a5 5 0 0 1 3 4v3"/>'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${icons[name]||icons.phone}</svg>`;

function createController(options={}){
 const getContext=options.getContext||(()=>global.SengokuSocial?.getVoiceContext?.()||{});
 const request=options.request||((route,args)=>global.SengokuSocial.voiceRequest(route,args));
 const now=options.now||(()=>Date.now());
 const later=options.setTimeout||global.setTimeout.bind(global),cancel=options.clearTimeout||global.clearTimeout.bind(global);
 const getMedia=options.getUserMedia||((constraints)=>global.navigator.mediaDevices.getUserMedia(constraints));
 const makePeer=options.createPeerConnection||((config)=>new global.RTCPeerConnection(config));
 const makeAudio=options.createAudio||defaultAudio;
 const onAudioFocus=options.onAudioFocus||(active=>global.SengokuBridge?.setVoiceActive?.(active));
 let audioFocusOwned=false;
 let disposed=false,generation=0,accessKey='',activeOwner='',cacheAccessKey='',stream=null,joinFlight=null,micFlight=null;
 let pollFlight=false,heartbeatFlight=false,heartbeatAgain=false,lastHeartbeat=0,after=0;
 let pollMs=2000,heartbeatMs=10000,leaseMs=45000,iceServers=[],iceSignature='';
 const peers=new Map(),timers=new Map(),waits=new Map(),roomCache=new Map(),roomRequests=new Map(),listeners=new Set();
 let state={phase:'idle',channel:null,room:null,sessionId:'',participants:[],muted:true,deafened:false,listenOnly:false,volume:100,playbackBlocked:false,error:'',notice:'',relayAvailable:false};

 function context(){
  const c=getContext()||{},playerId=String(c.playerId||c.user?.id||''),authenticated=Boolean(c.user&&playerId&&String(c.user.id)===playerId&&!c.pending&&!c.banned);
  return{...c,playerId,authenticated,key:JSON.stringify([playerId,c.epoch||0,c.privilegeEpoch||0,c.accountEpoch||0,c.guildEpoch||0,c.guildId||'',c.user?.isAdmin===true,c.user?.isStaff===true,c.user?.isDeputy===true,!!c.pending,!!c.banned])};
 }
 function permitted(c,channel){return c.authenticated&&(channel==='guild'?Boolean(c.guildId):channel==='admin'&&Boolean(c.user?.isAdmin||c.user?.isDeputy||c.user?.isStaff));}
 function supported(){return Boolean(options.createPeerConnection||global.RTCPeerConnection)&&Boolean(options.getUserMedia||global.navigator?.mediaDevices?.getUserMedia)&&Boolean(options.getUserMedia||global.isSecureContext!==false);}
 function snapshot(){
  const c=context(),peerStates={};for(const [id,p]of peers)peerStates[id]=p.status;
  return{...clone(state),busy:Boolean(joinFlight||micFlight),peerStates,rooms:cacheAccessKey===c.key?Object.fromEntries([...roomCache].map(([key,value])=>[key,clone(value)])):{},supported:supported(),context:{authenticated:c.authenticated,guildId:c.guildId||'',isAdmin:c.user?.isAdmin===true,isDeputy:c.user?.isDeputy===true,isStaff:c.user?.isStaff===true,key:c.key}};
 }
 function emit(){if(disposed)return;const value=snapshot();options.onChange?.(value);for(const fn of listeners)fn(value);}
 function schedule(key,fn,ms){if(timers.has(key))cancel(timers.get(key));timers.set(key,later(()=>{timers.delete(key);if(!disposed)void fn();},ms));}
 function clearTimers(){for(const value of timers.values())cancel(value);timers.clear();for(const [id,resolve]of waits){cancel(id);resolve(false);}waits.clear();}
 function pause(ms,g){return new Promise(resolve=>{const id=later(()=>{waits.delete(id);resolve(current(g));},ms);waits.set(id,resolve);});}
 function current(g){if(disposed||g!==generation||state.phase==='idle')return false;const c=context();if(c.key!==accessKey||!permitted(c,state.channel)){void leave('所属や利用権限が変わったため、通話を終了しました。');return false;}return true;}
 function isFatal(error){return error?.status===401||error?.status===403||fatalCodes.has(error?.code);}
 function mediaError(error){
  if(error?.name==='NotAllowedError'||error?.name==='SecurityError')return'マイクの使用が許可されていません。ブラウザのマイク設定を確認するか、「聞くだけで参加」を選んでください。';
  if(error?.name==='NotFoundError'||error?.name==='DevicesNotFoundError')return'マイクが見つかりません。マイクを接続するか、「聞くだけで参加」を選んでください。';
  if(error?.name==='NotReadableError'||error?.name==='TrackStartError')return'マイクを使用できません。他のアプリの通話を終了してから、もう一度お試しください。';
  return cleanText(error?.message,240)||'音声通話に接続できませんでした。通信状況を確認して、もう一度お試しください。';
 }
 function validParticipants(rows){
  if(!Array.isArray(rows))throw Error('通話の参加者を確認できませんでした。');
  return [...new Map(rows.filter(r=>SESSION.test(r?.sessionId)).slice(0,8).map(r=>[r.sessionId,{sessionId:r.sessionId,name:cleanText(r.name,80)||'領主',muted:r.muted===true,joinedAt:cleanText(r.joinedAt,40),isSelf:r.sessionId===state.sessionId||r.isSelf===true}])).values()];
 }
 function validRoom(value,channel){if(!value||value.channel!==channel||typeof value.id!=='string')throw Error('通話の部屋を確認できませんでした。');return{id:cleanText(value.id,160),channel,name:cleanText(value.name,80)||(channel==='admin'?'運営チャット':'同盟チャット'),maxParticipants:8};}
 function acceptIce(value){
  if(!Array.isArray(value)||value.length>8)throw Error('音声の接続設定を確認できませんでした。');
  const next=value.map(server=>{const urls=typeof server.urls==='string'?[server.urls]:server.urls;if(!Array.isArray(urls)||!urls.length||urls.length>8||urls.some(url=>typeof url!=='string'||url.length>500||!/^stuns?:|^turns?:/.test(url)))throw Error('音声の接続設定を確認できませんでした。');return{urls:[...urls],...(typeof server.username==='string'?{username:server.username}:{}),...(typeof server.credential==='string'?{credential:server.credential}:{})};});
  const signature=JSON.stringify(next);if(signature!==iceSignature){iceServers=next;iceSignature=signature;for(const p of peers.values()){try{p.pc.setConfiguration({iceServers:clone(iceServers)});}catch{}}}
 }
 async function inspectRoom(channel){
  const c=context();if(!CHANNELS.has(channel)||!permitted(c,channel)||disposed)return null;
  if(cacheAccessKey!==c.key){cacheAccessKey=c.key;roomCache.clear();roomRequests.clear();}
  const known=roomRequests.get(channel);if(known?.key===c.key)return known.promise;
  const token={},task=(async()=>{try{
   const result=await request('/voice/room?channel='+channel,{method:'GET'});if(disposed||context().key!==c.key||roomRequests.get(channel)?.token!==token)return null;
   const value={room:validRoom(result.room,channel),participants:validParticipants(result.participants),error:''};roomCache.set(channel,value);emit();return clone(value);
  }catch(error){if(!disposed&&context().key===c.key&&roomRequests.get(channel)?.token===token){roomCache.set(channel,{room:null,participants:[],error:mediaError(error)});emit();}return null;}
  finally{if(roomRequests.get(channel)?.token===token)roomRequests.delete(channel);}})();roomRequests.set(channel,{key:c.key,promise:task,token});return task;
 }
 function stopStream(value){for(const track of value?.getTracks?.()||[]){track.onended=null;try{track.stop();}catch{}}}
 function releasePeer(id){const p=peers.get(id);if(!p)return;peers.delete(id);for(const key of ['peer:','connect:'])if(timers.has(key+id)){cancel(timers.get(key+id));timers.delete(key+id);}p.closed=true;p.pc.onicecandidate=null;p.pc.ontrack=null;p.pc.onnegotiationneeded=null;p.pc.onconnectionstatechange=null;p.pc.oniceconnectionstatechange=null;try{p.pc.close();}catch{}try{p.audio?.pause();for(const track of p.audio?.srcObject?.getTracks?.()||[])track.stop();if(p.audio)p.audio.srcObject=null;p.audio?.remove?.();}catch{}}
 function releaseMedia(){for(const id of [...peers.keys()])releasePeer(id);stopStream(stream);stream=null;}
 function endLocal(message='',error=''){
  generation++;clearTimers();releaseMedia();if(audioFocusOwned){audioFocusOwned=false;try{onAudioFocus(false);}catch{}}pollFlight=false;heartbeatFlight=false;heartbeatAgain=false;after=0;lastHeartbeat=0;accessKey='';activeOwner='';iceServers=[];iceSignature='';
  state={...state,phase:'idle',channel:null,room:null,sessionId:'',participants:[],muted:true,listenOnly:false,playbackBlocked:false,error,notice:message};emit();
 }
 async function leave(reason='通話から退出しました。'){
  const sessionId=state.sessionId,owner=activeOwner,oldChannel=state.channel;if(oldChannel)roomCache.delete(oldChannel);endLocal(reason);
  if(sessionId&&owner&&owner===context().playerId){try{await request('/voice/leave',{method:'POST',data:{sessionId}});}catch{}}
  return true;
 }
 function failCall(error){if(disposed)return;const message=mediaError(error);void leave('');state.error=message;emit();}
 function bindMicrophone(value,g){
  const track=value?.getAudioTracks?.()[0];if(!track||track.readyState==='ended')throw Error('マイクの音声を取得できませんでした。');
  stopStream(stream);stream=value;for(const candidate of stream.getTracks())if(candidate.kind!=='audio')candidate.stop();
  track.enabled=!state.muted;track.onended=()=>{if(!current(g))return;state.muted=true;state.listenOnly=true;state.notice='マイクが切断されました。音声を聞き続けることはできます。';stream=null;emit();void heartbeat(g);};return track;
 }
 async function runJoin(channel,{listenOnly=false}={}){
  const c=context();if(!CHANNELS.has(channel)||!permitted(c,channel)){state.error=channel==='guild'?'同盟に所属すると通話に参加できます。':'許可された担当者のみが参加できる通話です。';emit();return false;}
  if(!supported()){state.error='このブラウザでは音声通話を利用できません。HTTPSで開いたSafari・Chromeなどのブラウザでお試しください。';emit();return false;}
  const g=++generation;accessKey=c.key;activeOwner=c.playerId;if(cacheAccessKey!==c.key){cacheAccessKey=c.key;roomCache.clear();roomRequests.clear();}audioFocusOwned=true;try{onAudioFocus(true);}catch{}state={...state,phase:'joining',channel,room:null,sessionId:'',participants:[],muted:listenOnly===true,listenOnly:listenOnly===true,error:'',notice:'',playbackBlocked:false};emit();
  try{
   if(!listenOnly){const media=await getMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});if(!current(g)){stopStream(media);return false;}bindMicrophone(media,g);}
   const result=await request('/voice/join',{method:'POST',data:{channel,muted:state.muted}});
   if(!current(g)){if(SESSION.test(result?.sessionId)&&context().playerId===c.playerId)request('/voice/leave',{method:'POST',data:{sessionId:result.sessionId}}).catch(()=>{});return false;}
   if(!SESSION.test(result?.sessionId))throw Error('通話への参加を確認できませんでした。');
   state.sessionId=result.sessionId;state.room=validRoom(result.room,channel);acceptIce(result.iceServers);state.phase='active';state.relayAvailable=result.relayAvailable===true;
   pollMs=Math.min(5000,Math.max(1000,Number(result.pollMs)||2000));heartbeatMs=Math.min(15000,Math.max(5000,Number(result.heartbeatMs)||10000));leaseMs=Math.min(60000,Math.max(30000,Number(result.leaseMs)||45000));lastHeartbeat=now();after=Number.isSafeInteger(result.after)&&result.after>=0?result.after:0;
   adoptParticipants(result.participants,g);state.notice=listenOnly?'聞くだけで参加しています。マイクは使用していません。':'参加しました。チャットを閉じても通話は続きます。';emit();
   schedule('poll',()=>poll(g),0);schedule('heartbeat',()=>heartbeat(g),heartbeatMs);schedule('watch',()=>watch(g),1000);return true;
  }catch(error){if(current(g)){const sessionId=state.sessionId;endLocal('',mediaError(error));if(sessionId)request('/voice/leave',{method:'POST',data:{sessionId}}).catch(()=>{});}return false;}
 }
 function join(channel,args={}){if(disposed||joinFlight||state.phase!=='idle')return Promise.resolve(false);const task=runJoin(channel,args);joinFlight=task;void task.finally(()=>{if(joinFlight===task){joinFlight=null;emit();}});return task;}

 function enqueue(p,operation){p.queue=p.queue.then(()=>!p.closed?operation():undefined).catch(error=>{if(!p.closed&&current(p.g)){p.status='failed';p.error=mediaError(error);emit();}});return p.queue;}
 async function sendSignal(p,kind,payload){
  for(let attempt=0;attempt<3;attempt++){
   if(p.closed||!current(p.g))return false;
   try{await request('/voice/signal',{method:'POST',data:{sessionId:state.sessionId,toSessionId:p.id,kind,payload}});return !p.closed&&current(p.g);}
   catch(error){
    if(p.closed||!current(p.g))return false;if(error.code==='VOICE_PEER_LEFT'){releasePeer(p.id);emit();return false;}if(isFatal(error)){failCall(error);return false;}
    const retry=error.code==='VOICE_ROSTER_CHANGED'||error.status===429||!error.status||error.status>=500;
    if(!retry||attempt===2)throw error;
    // The server deduplicates identical SDP/ICE posts, including lost replies.
    if(!await pause(Math.min(10000,Math.max(attempt?1500:600,(Number(error.retryAfter)||0)*1000)),p.g))return false;
   }
  }return false;
 }
 function peerProblem(p){
  if(p.closed||!current(p.g))return;
  const connection=p.pc.connectionState||p.pc.iceConnectionState||'new';
  p.status=connection==='completed'?'connected':connection;
  if(p.status==='connected'){p.restarts=0;for(const key of ['peer:','connect:'])if(timers.has(key+p.id)){cancel(timers.get(key+p.id));timers.delete(key+p.id);}}
  if((connection==='disconnected'||connection==='failed')&&p.restarts<2){schedule('peer:'+p.id,()=>{if(p.closed||!current(p.g)||p.pc.connectionState==='connected')return;p.restarts++;p.status='connecting';emit();if(state.sessionId<p.id){try{p.pc.restartIce();}catch{void enqueue(p,async()=>{if(p.pc.signalingState!=='stable')return;const offer=await p.pc.createOffer({iceRestart:true});await p.pc.setLocalDescription(offer);await sendSignal(p,'offer',p.pc.localDescription.toJSON?.()||{type:p.pc.localDescription.type,sdp:p.pc.localDescription.sdp});});}}},connection==='failed'?1000:5000);}
  emit();
 }
 function newPeer(participant,g){
  const id=participant.sessionId,pc=makePeer({iceServers:clone(iceServers)}),p={id,g,pc,audio:null,closed:false,queue:Promise.resolve(),status:'connecting',makingOffer:false,ignoreOffer:false,settingAnswer:false,polite:state.sessionId>id,initiator:state.sessionId<id,candidates:[],restarts:0,transceiver:null};peers.set(id,p);
  pc.onicecandidate=event=>{if(!event.candidate||p.closed||!current(g))return;const candidate=event.candidate.toJSON?.()||{candidate:event.candidate.candidate,sdpMid:event.candidate.sdpMid,sdpMLineIndex:event.candidate.sdpMLineIndex,usernameFragment:event.candidate.usernameFragment};void sendSignal(p,'ice',candidate).catch(()=>{if(!p.closed){p.status='connecting';emit();}});};
  pc.ontrack=event=>{
   if(p.closed||!current(g)||event.track?.kind!=='audio')return;
   const media=event.streams?.[0]||(typeof global.MediaStream==='function'?new global.MediaStream([event.track]):null);if(!media)return;
   if(!p.audio)p.audio=makeAudio(id);p.audio.autoplay=true;p.audio.playsInline=true;p.audio.setAttribute?.('playsinline','');p.audio.srcObject=media;p.audio.muted=state.deafened;p.audio.volume=state.volume/100;
   void tryPlay(p);emit();
  };
  pc.onconnectionstatechange=()=>peerProblem(p);pc.oniceconnectionstatechange=()=>peerProblem(p);
  // Exactly one side creates the audio m-line. Creating a transceiver on both
  // sides before the first offer can leave an extra m-line after rollback.
  pc.onnegotiationneeded=()=>{if(!p.initiator)return;void enqueue(p,async()=>{if(!current(g)||pc.signalingState!=='stable')return;try{p.makingOffer=true;await pc.setLocalDescription();if(!current(g)||p.closed)return;await sendSignal(p,pc.localDescription.type,{type:pc.localDescription.type,sdp:pc.localDescription.sdp});}finally{p.makingOffer=false;}});};
  const track=stream?.getAudioTracks?.().find(t=>t.readyState!=='ended');if(p.initiator){p.transceiver=pc.addTransceiver('audio',{direction:'sendrecv',...(stream?{streams:[stream]}:{})});if(track)void p.transceiver.sender.replaceTrack(track).catch(error=>{if(current(g))failCall(error);});}
  schedule('connect:'+id,()=>{if(!p.closed&&current(g)&&p.status!=='connected'){p.status='failed';emit();}},30000);
  return p;
 }
 function adoptParticipants(rows,g){
  const participants=validParticipants(rows);if(!participants.some(p=>p.sessionId===state.sessionId))throw Object.assign(Error('通話への参加期限が切れました。もう一度参加してください。'),{code:'VOICE_SESSION_EXPIRED',status:410});
  state.participants=participants;const ids=new Set(participants.map(p=>p.sessionId));for(const id of [...peers.keys()])if(!ids.has(id))releasePeer(id);
  for(const participant of participants)if(participant.sessionId!==state.sessionId&&!peers.has(participant.sessionId))newPeer(participant,g);
  roomCache.set(state.channel,{room:state.room,participants:clone(participants),error:''});
 }
 async function receiveSignal(signal,g){
  if(!current(g)||!SESSION.test(signal?.fromSessionId))return;const p=peers.get(signal.fromSessionId);if(!p)return;
  return enqueue(p,async()=>{
   if(!current(g)||p.closed)return;
   if(signal.kind==='ice'){
    if(p.ignoreOffer)return;
    if(!p.pc.remoteDescription){if(p.candidates.length<120)p.candidates.push(signal.payload);return;}
    try{await p.pc.addIceCandidate(signal.payload);}catch(error){if(!p.ignoreOffer)throw error;}return;
   }
   const description=signal.payload;if(!['offer','answer'].includes(signal.kind)||description?.type!==signal.kind||typeof description.sdp!=='string')return;
   const ready=!p.makingOffer&&(p.pc.signalingState==='stable'||p.settingAnswer),collision=description.type==='offer'&&!ready;
   p.ignoreOffer=!p.polite&&collision;if(p.ignoreOffer)return;
   p.settingAnswer=description.type==='answer';
   try{
    if(collision&&p.pc.signalingState!=='stable')await p.pc.setLocalDescription({type:'rollback'});
    await p.pc.setRemoteDescription(description);
   }finally{p.settingAnswer=false;}
   for(const candidate of p.candidates.splice(0)){if(p.closed||!current(g))return;try{await p.pc.addIceCandidate(candidate);}catch{}}
   if(description.type==='offer'){
    p.transceiver=p.pc.getTransceivers().find(t=>t.receiver?.track?.kind==='audio');if(!p.transceiver)throw Error('音声の接続を確認できませんでした。');
    p.transceiver.direction='sendrecv';const track=stream?.getAudioTracks?.().find(t=>t.readyState!=='ended')||null;await p.transceiver.sender.replaceTrack(track);
    await p.pc.setLocalDescription();if(current(g)&&!p.closed)await sendSignal(p,'answer',{type:p.pc.localDescription.type,sdp:p.pc.localDescription.sdp});
   }
  });
 }
 async function poll(g){
  if(!current(g)||state.phase!=='active'||pollFlight)return;pollFlight=true;
  try{
   const result=await request('/voice/poll?sessionId='+state.sessionId+'&after='+after,{method:'GET'});if(!current(g))return;adoptParticipants(result.participants,g);
   if(!Array.isArray(result.signals))throw Error('通話の接続情報を確認できませんでした。');
   for(const signal of result.signals){if(!current(g))return;if(!Number.isSafeInteger(signal.id)||signal.id<=after)continue;await receiveSignal(signal,g);if(!current(g))return;after=Math.max(after,signal.id);}
   if(Number.isSafeInteger(result.after)&&result.after>=after)after=result.after;
   if(state.error==='通信を再確認しています。')state.error='';emit();
  }catch(error){if(current(g)){if(isFatal(error)){failCall(error);return;}state.error='通信を再確認しています。';emit();}}
  finally{if(current(g)){pollFlight=false;schedule('poll',()=>poll(g),pollMs);}}
 }
 async function heartbeat(g=generation){
  if(!current(g)||state.phase!=='active')return;
  if(heartbeatFlight){heartbeatAgain=true;return;}
  heartbeatFlight=true;const muted=state.muted;
  try{
   const result=await request('/voice/heartbeat',{method:'POST',data:{sessionId:state.sessionId,muted}});if(!current(g))return;lastHeartbeat=now();if(result.iceServers)acceptIce(result.iceServers);if(Array.isArray(result.participants))adoptParticipants(result.participants,g);emit();
  }catch(error){if(current(g)&&isFatal(error)){failCall(error);return;}}
  finally{if(current(g)){heartbeatFlight=false;const again=heartbeatAgain||muted!==state.muted;heartbeatAgain=false;schedule('heartbeat',()=>heartbeat(g),again?0:heartbeatMs);}}
 }
 function watch(g){if(!current(g))return;if(now()-lastHeartbeat>=leaseMs){void leave('通信が途切れたため通話を終了しました。接続を確認して、もう一度参加してください。');return;}schedule('watch',()=>watch(g),1000);}
 async function enableMicrophone(g){
  try{const media=await getMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});if(!current(g)){stopStream(media);return false;}state.muted=false;state.listenOnly=false;const track=bindMicrophone(media,g);await Promise.all([...peers.values()].filter(p=>p.transceiver).map(p=>p.transceiver.sender.replaceTrack(track)));if(!current(g))return false;state.error='';state.notice='マイクをオンにしました。';emit();void heartbeat(g);return true;}
  catch(error){if(current(g)){state.muted=true;for(const track of stream?.getAudioTracks?.()||[])track.enabled=false;state.error=mediaError(error);emit();}return false;}
 }
 function toggleMute(){
  const g=generation;if(!current(g)||state.phase!=='active'||micFlight)return Promise.resolve(false);
  const track=stream?.getAudioTracks?.().find(t=>t.readyState!=='ended');
  if(!track){const task=enableMicrophone(g);micFlight=task;emit();void task.finally(()=>{if(micFlight===task){micFlight=null;emit();}});return task;}
  state.muted=!state.muted;track.enabled=!state.muted;state.notice=state.muted?'マイクをミュートしました。':'マイクをオンにしました。';state.error='';emit();void heartbeat(g);return Promise.resolve(true);
 }
 function toggleDeafen(){if(state.phase!=='active')return false;state.deafened=!state.deafened;for(const p of peers.values())if(p.audio)p.audio.muted=state.deafened;state.notice=state.deafened?'相手の音声を消音しました。':'相手の音声を再生します。';emit();if(!state.deafened)void resumeAudio();return true;}
 function setVolume(value){state.volume=Math.max(0,Math.min(100,Math.round(Number(value)||0)));for(const p of peers.values())if(p.audio)p.audio.volume=state.volume/100;emit();return state.volume;}
 async function tryPlay(p){if(p.closed||!p.audio)return;try{await p.audio.play();if(!p.closed){p.blocked=false;state.playbackBlocked=[...peers.values()].some(peer=>peer.blocked);emit();}}catch{if(!p.closed&&current(p.g)){p.blocked=true;state.playbackBlocked=true;emit();}}}
 async function resumeAudio(){await Promise.all([...peers.values()].map(p=>tryPlay(p)));return !state.playbackBlocked;}
 function refreshAccess(){
  const c=context();if(cacheAccessKey!==c.key){cacheAccessKey=c.key;roomCache.clear();roomRequests.clear();}if(state.phase!=='idle'&&(c.key!==accessKey||!permitted(c,state.channel))){roomCache.clear();roomRequests.clear();void leave('所属や利用権限が変わったため、通話を終了しました。');}
  for(const key of roomCache.keys())if(!permitted(c,key))roomCache.delete(key);emit();return snapshot();
 }
 const onPageHide=()=>{void leave('画面を閉じたため、通話を終了しました。');};
 const onVisibility=()=>{if(!global.document?.hidden&&state.phase==='active'){watch(generation);if(state.phase==='active'){void heartbeat(generation);void poll(generation);}}};
 if(options.lifecycle!==false){global.addEventListener?.('pagehide',onPageHide);global.document?.addEventListener?.('visibilitychange',onVisibility);}
 return{snapshot,join,leave,toggleMute,toggleDeafen,setVolume,resumeAudio,inspectRoom,refreshAccess,subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},dispose(){if(disposed)return;void leave('');disposed=true;listeners.clear();roomRequests.clear();roomCache.clear();if(options.lifecycle!==false){global.removeEventListener?.('pagehide',onPageHide);global.document?.removeEventListener?.('visibilitychange',onVisibility);}}};
}

function defaultAudio(){const audio=global.document.createElement('audio');audio.hidden=true;audio.setAttribute('aria-hidden','true');audio.setAttribute('playsinline','');let host=global.document.getElementById('sengoku-voice-audio');if(!host){host=global.document.createElement('div');host.id='sengoku-voice-audio';host.hidden=true;global.document.body.append(host);}host.append(audio);return audio;}
function stateLabel(value){return value==='connected'?'通話中':value==='failed'?'接続できません':value==='disconnected'?'再接続中':'接続中';}
function actionButton(action,label,name,{primary=false,danger=false,disabled=false,pressed,compact=false}={}){return`<button type="button" class="voice-button${primary?' primary':''}${danger?' danger':''}${compact?' compact':''}" data-stable-key="voice-${action}" data-voice-action="${action}"${disabled?' disabled':''}${pressed===undefined?'':` aria-pressed="${pressed}"`} aria-label="${esc(label)}" title="${esc(label)}">${icon(name)}<span>${esc(label)}</span></button>`;}
function controls(s,compact=false){return actionButton('mute',s.listenOnly?'マイクを使う':s.muted?'マイクをオン':'ミュート',s.muted?'muted':'mic',{disabled:s.busy,pressed:s.muted,compact})+actionButton('deafen',s.deafened?'相手の音声を再生':'相手の音声を消音',s.deafened?'quiet':'speaker',{pressed:s.deafened,compact})+actionButton('leave','退出','leave',{danger:true,compact});}
function markup(s,{channel,title}={}){
 const active=s.phase!=='idle',same=active&&s.channel===channel,room=same?s.room:s.rooms[channel]?.room,participants=same?s.participants:s.rooms[channel]?.participants||[],allowed=s.context.authenticated&&(channel==='guild'?Boolean(s.context.guildId):s.context.isAdmin||s.context.isDeputy||s.context.isStaff);
 const error=same||!active?s.error||s.rooms[channel]?.error||'':s.rooms[channel]?.error||'',roomFull=participants.length>=8&&!participants.some(p=>p.isSelf);
 const heading=title||room?.name||(channel==='admin'?'運営チャット':'同盟チャット');
 let body=`<section class="voice-panel" aria-label="${esc(heading)}の音声通話" data-voice-phase="${same?s.phase:'idle'}"><div class="voice-heading"><span class="voice-seal">${icon('phone')}</span><div><h4>音声通話</h4><p>${same&&s.phase==='active'?'チャットを閉じても通話を続けられます。':'同じ部屋の仲間と、声で話せます。'}</p></div><span class="voice-count" aria-label="参加者${participants.length}人、定員8人">${icon('people')}<b>${participants.length}</b><span>/ 8</span></span></div>`;
 if(participants.length)body+=`<ul class="voice-participants" aria-label="通話の参加者">${participants.map(p=>{const self=same&&p.sessionId===s.sessionId,muted=self?s.muted:p.muted,status=self?'あなた':same?stateLabel(s.peerStates[p.sessionId]):'参加中';return`<li data-stable-key="${esc(p.sessionId)}" class="voice-person${self?' self':''}" data-voice-peer="${esc(p.sessionId)}"><span class="voice-person-icon">${icon(muted?'muted':'mic')}</span><span class="voice-person-name">${global.SengokuCityHonors?.slot?.(p.sessionId)||''}${esc(p.name)}${global.SengokuPublicCourt?.slot?.(p.sessionId)||''}</span><small>${esc(status)}</small></li>`;}).join('')}</ul>`;
 if(same&&s.phase==='joining')body+=`<p class="voice-joining" role="status">${s.listenOnly?'通話に接続しています…':'マイクの許可と接続を確認しています…'}</p><div class="voice-actions">${actionButton('leave','参加を取り消す','leave',{danger:true})}</div>`;
 else if(same&&s.phase==='active'){
  body+=`<div class="voice-actions">${controls(s)}</div><label class="voice-volume">${icon('speaker')}<span>通話音量</span><input type="range" min="0" max="100" step="5" value="${s.volume}" data-voice-volume aria-label="通話の音量"><output>${s.volume}%</output></label>`;
  if(Object.values(s.peerStates).some(value=>value==='failed'))body+=`<p class="voice-feedback is-error">音声がつながらない相手がいます。退出して再参加するか、Wi-Fi・モバイル回線を切り替えてお試しください。</p>`;
 }else if(active)body+=`<p class="voice-note">${esc(s.room?.name||'別の部屋')}で通話中です。この部屋へ移るには、現在の通話から退出してください。</p><div class="voice-actions">${actionButton('leave','現在の通話から退出','leave',{danger:true})}</div>`;
 else body+=`<div class="voice-actions">${actionButton('join','通話に参加','phone',{primary:true,disabled:!allowed||!s.supported||s.busy||roomFull})}${actionButton('listen','聞くだけで参加','speaker',{disabled:!allowed||!s.supported||s.busy||roomFull})}</div><p class="voice-note">最大8人。参加するとマイクの使用許可を確認します。聞くだけの参加ではマイクを使用しません。</p>`;
 if(same&&s.playbackBlocked)body+=`<div class="voice-playback"><p>相手の音声を再生するには、下のボタンを押してください。</p>${actionButton('play','音声を再生','speaker',{primary:true})}</div>`;
 if(error)body+=`<p class="voice-feedback is-error" role="status">${esc(error)}</p>`;
 else if((same||!active)&&s.notice)body+=`<p class="voice-feedback" role="status">${esc(s.notice)}</p>`;
 if(!s.supported)body+='<p class="voice-feedback is-error">音声通話はHTTPSのSafari・Chromeなど、マイクに対応したブラウザで利用できます。</p>';
 return body+'</section>';
}
const mounts=new Set();let singleton=null,dock=null,dockObserver=null,dockSignature='';
function getSingleton(){if(!singleton){singleton=createController();singleton.subscribe(renderDock);}return singleton;}
function dispatch(controller,action,channel){if(action==='join')void controller.join(channel);else if(action==='listen')void controller.join(channel,{listenOnly:true});else if(action==='leave')void controller.leave();else if(action==='mute')void controller.toggleMute();else if(action==='deafen')controller.toggleDeafen();else if(action==='play')void controller.resumeAudio();}
function patch(host,html){if(host.__voiceMarkup===html)return;host.__voiceMarkup=html;if(global.SengokuStableDOM)global.SengokuStableDOM.patch(host,html);else host.innerHTML=html;}
function ensureDock(){
 if(dock||!global.document?.body)return;dock=global.document.createElement('aside');dock.className='voice-dock';dock.setAttribute('aria-label','進行中の音声通話');dock.hidden=true;global.document.body.append(dock);
 dock.addEventListener('click',event=>{const button=event.target.closest?.('[data-voice-action]');if(!button||button.disabled)return;dispatch(getSingleton(),button.dataset.voiceAction,getSingleton().snapshot().channel);});
 if(global.MutationObserver){dockObserver=new global.MutationObserver(()=>renderDock(getSingleton().snapshot()));dockObserver.observe(global.document.body,{subtree:true,attributes:true,attributeFilter:['open']});}
}
function renderDock(s){
 if(!global.document?.body)return;ensureDock();const dialogs=[...global.document.querySelectorAll('dialog[open]')],parent=dialogs.at(-1)||global.document.body;if(dock.parentElement!==parent)parent.append(dock);
 const shownPanel=[...mounts].some(m=>m.production&&m.host.isConnected&&m.channel===s.channel&&(!m.host.closest('dialog')||m.host.closest('dialog').open));
 const hidden=s.phase!=='active'||shownPanel;dock.hidden=hidden;dock.dataset.voicePhase=s.phase;if(hidden)return;
 const html=`<div class="voice-dock-title"><span class="voice-live-dot" aria-hidden="true"></span><div><strong>${esc(s.room?.name||'音声通話')}</strong><small>${s.participants.length}人で通話中${s.muted?' · マイクOFF':''}</small></div></div><div class="voice-dock-actions">${controls(s,true)}</div>${s.playbackBlocked?`<div class="voice-dock-play">${actionButton('play','音声を再生','speaker',{primary:true})}</div>`:''}`;
 if(html!==dockSignature){patch(dock,html);dockSignature=html;}
}
function mount(host,options={}){
 if(!host||!CHANNELS.has(options.channel))return{refresh(){},dispose(){}};
 const controller=options.controller||getSingleton(),production=!options.controller,mountRecord={host,channel:options.channel,production};controller.refreshAccess();mounts.add(mountRecord);let alive=true,timer=null;
 const render=s=>{if(!alive)return;patch(host,markup(s,options));const slider=host.querySelector('[data-voice-volume]');if(slider&&slider.value!==String(s.volume))slider.value=String(s.volume);if(production)renderDock(s);};
 const click=event=>{const button=event.target.closest?.('[data-voice-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();dispatch(controller,button.dataset.voiceAction,options.channel);};
 const input=event=>{if(event.target.matches?.('[data-voice-volume]'))controller.setVolume(event.target.value);};
 const read=()=>{if(!alive)return;if(host.isConnected&&(!host.closest('dialog')||host.closest('dialog').open)&&controller.snapshot().phase==='idle')void controller.inspectRoom(options.channel);timer=global.setTimeout(read,15000);};
 host.addEventListener('click',click);host.addEventListener('input',input);const unsubscribe=controller.subscribe(render);render(controller.snapshot());void controller.inspectRoom(options.channel);timer=global.setTimeout(read,15000);
 const handle={controller,refresh(){controller.refreshAccess();render(controller.snapshot());},dispose(){if(!alive)return;alive=false;mounts.delete(mountRecord);global.clearTimeout(timer);unsubscribe();host.removeEventListener('click',click);host.removeEventListener('input',input);global.SengokuStableDOM?.forget?.(host);if(production)renderDock(controller.snapshot());}};mountRecord.dispose=handle.dispose;return handle;
}
const api={createController,createVoiceController:createController,mount,markup,refreshAccess(){return singleton?.refreshAccess();},leave(reason){return singleton?.leave(reason)||Promise.resolve(true);},snapshot(){return singleton?.snapshot()||null;},dispose(){for(const m of [...mounts])m.dispose();singleton?.dispose();singleton=null;dockObserver?.disconnect();dockObserver=null;dock?.remove();dock=null;dockSignature='';global.document?.getElementById('sengoku-voice-audio')?.remove();}};
global.SengokuVoice=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
