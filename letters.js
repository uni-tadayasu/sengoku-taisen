/* 本拠から届く書状。本文は文字列として扱い、受信内容を永続保存しない。 */
(function(global){
'use strict';
const MAX_TEXT=1000,STORE='sengoku-letters-v1:',ID=/^[A-Za-z0-9_-]{1,90}$/,THREAD=/^lt_[a-f0-9]{32}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalized=text=>String(text??'').normalize('NFC').trim();
const textLength=text=>Array.from(normalized(text)).length;
const clone=value=>JSON.parse(JSON.stringify(value));
const mergeMessages=(old,incoming)=>[...new Map([...old,...incoming].map(item=>[Number(item.seq),item])).values()].sort((a,b)=>a.seq-b.seq);
const playerName=(name,evaluation,appearance=null,playerId='',avatarVersion,showAvatar=true)=>`<span class="player-evaluation-person">${showAvatar&&playerId?global.SengokuAvatar?.markup?.({id:playerId,name,avatarVersion},'inline')||'':''}<span class="player-evaluation-name" data-premium-player="${esc(playerId)}" data-premium-player-name="${esc(name)}">${global.SengokuPremiumRuntime?.nameMarkup?.(name,appearance)||esc(name)}</span>${global.SengokuEvaluationUI?.badge?.(evaluation)||''}${global.SengokuPublicCourt?.slot?.(playerId)||''}</span>`;
const allianceName=guild=>`<span class="letters-alliance-name">${global.SengokuAllianceIcon?.markup?.(guild,'inline')||''}<span>${esc(guild?.name||'同盟')}</span></span>`;
function threadTitle(thread,ownerId){
  if(thread.kind==='player')return thread.peer?playerName(thread.peer.name,thread.peer.evaluation,thread.peer.appearance,thread.peer.id,thread.peer.avatarVersion):esc(thread.title);
  const guild=thread.guild?.name;if(!guild)return esc(thread.title);const label=allianceName(thread.guild);
  return thread.sender?.id&&String(thread.sender.id)!==String(ownerId)?`${playerName(thread.sender.name,thread.sender.evaluation,thread.sender.appearance,thread.sender.id,thread.sender.avatarVersion)} → ${label}`:label;
}
function threadParticipants(thread){
  if(thread.kind!=='guild')return'';
  const people=[...(thread.sender?[['送り主',thread.sender]]:[]),...(thread.contextPlayer&&thread.contextPlayer.id!==thread.sender?.id?[['本拠の領主',thread.contextPlayer]]:[])];
  return people.length?`<div class="letters-participants">${people.map(([label,person])=>`<p>${label}：${playerName(person.name,person.evaluation,person.appearance,person.id,person.avatarVersion)}</p>`).join('')}</div>`:'';
}
function scrollAfterUpdate({top,height,clientHeight,nextHeight,prepend=false,forceBottom=false}){
  if(prepend)return Math.max(0,top+nextHeight-height);
  return forceBottom||height-clientHeight-top<64?Math.max(0,nextHeight-clientHeight):top;
}
function createController(options={}){
  const request=options.request||((route,value)=>global.SengokuSocial.lettersRequest(route,value)),getUser=options.getUser||(()=>global.SengokuSocial?.getUser?.());let storage=options.storage;try{if(!storage)storage=global.localStorage;}catch{}
  const now=options.now||Date.now,uuid=options.uuid||(()=>global.crypto.randomUUID()),notify=options.onChange||(()=>{}),visible=options.isVisible||(()=>!global.document?.hidden);
  const later=options.setTimeout||global.setTimeout.bind(global),cancel=options.clearTimeout||global.clearTimeout.bind(global);
  let epoch=0,viewEpoch=0,disposed=false,timer=null,summaryBusy=false,viewBusy=false,readBusy=false,readQueued=0,sendPromise=null,lastRead=0,lastMembership='';
  const s={ownerId:null,open:false,view:'inbox',threads:[],unreadCount:0,unreadThreads:0,nextCursor:null,loaded:false,loading:false,loadingOlder:false,error:'',status:'',thread:null,messages:[],hasOlder:false,nextBefore:null,hasNewer:false,target:null,targetPlayerId:null,destination:'player',guildId:null,needsTargetConfirm:false,draft:'',draftKey:'',sending:false,pending:null,change:'init'};
  s.contentRevision=null;s.suspended=false;s.threadNeedsReset=false;
  let contentEpoch=0;
  function emit(change='status'){s.change=change;notify(snapshot());}
  function snapshot(){return clone(s);}
  const key=suffix=>STORE+s.ownerId+':'+suffix;
  function readStore(name,fallback){try{return JSON.parse(storage.getItem(name))??fallback;}catch{return fallback;}}
  function writeStore(name,value){try{const json=JSON.stringify(value);storage.setItem(name,json);return storage.getItem(name)===json;}catch{return false;}}
  function removeStore(name){try{storage.removeItem(name);}catch{}}
  function validPending(value,owner){
    if(!value||value.ownerId!==owner||typeof value.route!=='string'||!/^\/letters(?:\/lt_[a-f0-9]{32}\/messages)?$/.test(value.route)||!ID.test(value.data?.requestId||'')||typeof value.data?.text!=='string'||!textLength(value.data.text)||textLength(value.data.text)>MAX_TEXT||typeof value.draftKey!=='string'||typeof value.originalDraft!=='string')return null;
    if(value.route==='/letters'&&(!ID.test(value.data.targetPlayerId||'')||!['player','guild'].includes(value.data.destination)||value.data.destination==='guild'&&!ID.test(value.data.guildId||'')))return null;
    return value;
  }
  function identity({allowResume=false}={}){
    const user=getUser(),id=user?.id?String(user.id):null,membership=String(user?.guildId||''),suspended=user?.isBanned===true||id===s.ownerId&&s.suspended&&!allowResume;
    if(id===s.ownerId&&membership===lastMembership&&suspended===s.suspended)return user;
    const wasSuspended=s.suspended;s.suspended=suspended;
    const changed=id!==s.ownerId;epoch++;viewEpoch++;summaryBusy=viewBusy=readBusy=false;readQueued=lastRead=0;sendPromise=null;lastMembership=membership;
    s.ownerId=id;s.sending=false;s.loading=false;s.loadingOlder=false;s.threads=[];s.messages=[];s.thread=null;s.loaded=false;s.nextCursor=null;s.error='';s.status='';s.unreadCount=s.unreadThreads=0;
    if(changed||suspended||wasSuspended){s.pending=id&&!suspended?validPending(readStore(key('pending'),null),id):null;s.draft='';s.draftKey='';s.target=null;s.targetPlayerId=null;s.view='inbox';}
    else if(s.view==='thread'){s.view='inbox';s.draft='';s.draftKey='';s.status='所属が変わったため、書状の閲覧権限を確認し直します。';}
    if(!id){s.view='inbox';s.error='書状は領主登録・ログイン後に利用できます。';}
    if(suspended)s.error='この領主は利用停止中のため、書状を利用できません。BAN解除後に同じ領主で利用を再開できます。';
    emit('identity');return user;
  }
  function current(e,owner){const user=getUser();return !disposed&&!s.suspended&&user?.isBanned!==true&&epoch===e&&s.ownerId===owner&&String(user?.id||'')===String(owner||'')&&String(user?.guildId||'')===lastMembership;}
  function suspendAccount(message){
    if(s.suspended)return;s.suspended=true;epoch++;viewEpoch++;summaryBusy=viewBusy=readBusy=false;sendPromise=null;readQueued=lastRead=0;cancel(timer);timer=null;
    Object.assign(s,{threads:[],messages:[],thread:null,target:null,targetPlayerId:null,pending:null,draft:'',draftKey:'',view:'inbox',unreadCount:0,unreadThreads:0,nextCursor:null,loaded:false,loading:false,loadingOlder:false,sending:false,error:message||'この領主は利用停止中です。BAN解除後に同じ領主で利用を再開できます。',status:''});emit('banned');
  }
  function observeContentRevision(value){
    if(!Number.isSafeInteger(value)||value<0)return true;
    if(s.contentRevision!==null&&value<s.contentRevision)return false;
    if(s.contentRevision===value)return true;
    const changed=s.contentRevision!==null||s.messages.length>0||s.threads.length>0;s.contentRevision=value;
    if(changed){contentEpoch++;s.messages=[];s.threads=[];s.nextCursor=null;s.loaded=false;s.hasOlder=false;s.nextBefore=null;s.hasNewer=false;s.unreadCount=s.unreadThreads=0;s.threadNeedsReset=s.view==='thread';if(s.thread)s.thread={...s.thread,lastMessage:null};emit('content-reset');}
    return true;
  }
  async function call(route,options){
    const e=epoch,owner=s.ownerId,revisionEpoch=contentEpoch;
    if(s.suspended)throw Object.assign(Error('この領主は利用停止中です。'),{code:'ACCOUNT_BANNED',status:403});
    let result;try{result=await request(route,options);}catch(error){if(error.code==='ACCOUNT_BANNED'&&current(e,owner))suspendAccount(error.message);throw error;}
    if(!current(e,owner)){const error=Error('接続する領主が変わりました。');error.code='STALE_IDENTITY';throw error;}
    if(!observeContentRevision(result.contentRevision)||revisionEpoch!==contentEpoch&&!Number.isSafeInteger(result.contentRevision)){const error=Error('削除後の新しい書状を確認しています。');error.code='STALE_CONTENT';throw error;}
    return result;
  }
  function setSummary(result){s.unreadCount=Math.max(0,Number(result?.unreadCount)||0);s.unreadThreads=Math.max(0,Number(result?.unreadThreads)||0);}
  function applyPlayerEvaluations(result){
    const updates=new Map((Array.isArray(result?.playerEvaluations)?result.playerEvaluations:[]).filter(row=>row&&typeof row.playerId==='string').map(row=>[row.playerId,row]));const self=getUser();if(self?.id&&typeof self.name==='string')updates.set(String(self.id),{...updates.get(String(self.id)),name:self.name,...(Object.hasOwn(self,'avatarVersion')?{avatarVersion:self.avatarVersion}:{})});if(!updates.size)return;
    const update=(person,id='id',field='evaluation',look='appearance',name='name',photo='avatarVersion')=>{const row=person&&updates.get(person[id]);if(!row)return;if(typeof row.name==='string')person[name]=row.name;if(Object.hasOwn(row,'avatarVersion'))person[photo]=row.avatarVersion;if(Object.hasOwn(row,'evaluation'))person[field]=row.evaluation;if(Object.hasOwn(row,'appearance'))person[look]=global.SengokuPremiumRuntime?.cleanAppearance?.(row.appearance)||null;};
    update(s.target);for(const message of s.messages)update(message,'authorId','authorEvaluation','authorAppearance','authorName','authorAvatarVersion');
    for(const thread of [...s.threads,...(s.thread?[s.thread]:[])]){for(const person of [thread.peer,thread.sender,thread.contextPlayer])update(person);update(thread.lastMessage,'authorId','authorEvaluation','authorAppearance','authorName','authorAvatarVersion');}
  }
  function schedule(){cancel(timer);timer=null;if(!disposed&&!s.suspended&&visible())timer=later(tick,s.open&&s.view==='thread'?5000:15000);}
  async function refreshSummary(){identity();if(!s.ownerId||s.suspended||summaryBusy||disposed||!visible())return;summaryBusy=true;const e=epoch;try{const result=await call('/letters/summary');setSummary(result);applyPlayerEvaluations(result);emit('summary');}catch(error){if(e===epoch&&error.code!=='STALE_IDENTITY'&&s.open&&!s.loaded){s.error=error.message;emit();}}finally{if(e===epoch)summaryBusy=false;}}
  async function tick(){if(disposed)return;identity();if(visible()&&s.ownerId&&!s.suspended){await refreshSummary();if(s.open&&!s.suspended){if(s.view==='inbox')await loadInbox();else if(s.view==='thread')await loadThread(s.thread?.id,{refresh:true});}}schedule();}
  function draftKey(){return s.view==='thread'&&s.thread?'thread:'+s.thread.id:s.view==='compose'&&s.targetPlayerId?'compose:'+s.targetPlayerId+':'+s.destination+(s.destination==='guild'?':'+(s.guildId||'none'):''):'';}
  function useDraft(fallback=''){s.draftKey=draftKey();const saved=s.draftKey?readStore(key('draft:'+s.draftKey),null):null;s.draft=typeof saved==='string'?saved:fallback;}
  function setDraft(value){if(!s.ownerId||s.suspended)return;s.draft=String(value??'').slice(0,8000);if(s.draftKey&&!writeStore(key('draft:'+s.draftKey),s.draft)){s.status='下書きを端末に保存できません。この画面を開いたままにしてください。';}emit('draft');}
  async function loadInbox({more=false}={}){
    if(!s.ownerId||s.suspended||viewBusy||more&&!s.nextCursor)return;viewBusy=true;const e=epoch,v=viewEpoch,revisionEpoch=contentEpoch;let reload=false;const cursor=more?s.nextCursor:null;if(!s.loaded)s.loading=true;emit('loading');
    try{const result=await call('/letters?limit=30'+(cursor?'&cursor='+encodeURIComponent(cursor):'')+(s.contentRevision!==null?'&contentRevision='+s.contentRevision:''));if(v!==viewEpoch||s.view!=='inbox')return;if(more&&(revisionEpoch!==contentEpoch||result.reset===true)){reload=true;return;}s.threads=more?[...new Map([...s.threads,...result.threads].map(t=>[t.id,t])).values()]:result.threads||[];s.nextCursor=result.nextCursor||null;s.loaded=true;s.error='';setSummary(result);applyPlayerEvaluations(result);emit(more?'inbox-more':'inbox');}
    catch(error){if(current(e,s.ownerId)&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(e===epoch&&v===viewEpoch){viewBusy=false;s.loading=false;emit('loading');if(reload)await loadInbox();}}
  }
  async function openInbox(){identity();viewEpoch++;viewBusy=false;s.open=true;s.view='inbox';s.thread=null;s.messages=[];s.target=null;s.draft='';s.draftKey='';s.error=s.suspended?'この領主は利用停止中のため、書状を利用できません。':s.ownerId?'':'書状は領主登録・ログイン後に利用できます。';s.status='';emit('navigation');if(s.ownerId)await loadInbox();schedule();}
  async function recipient({confirm=false}={}){
    const id=s.targetPlayerId,e=epoch,v=viewEpoch;if(!id||!s.ownerId||s.suspended)return;
    s.loading=true;emit('loading');
    try{const result=await call('/letters/recipient?playerId='+encodeURIComponent(id));if(v!==viewEpoch||s.view!=='compose'||id!==s.targetPlayerId)return;s.target=result.player;if(!confirm)s.guildId=s.destination==='guild'?result.player.guildId||null:null;const previous=s.draft;useDraft(previous);s.error=s.destination==='guild'&&!result.player.guildId?'この領主は同盟に所属していません。領主本人に書状を送れます。':'';emit('recipient');}
    catch(error){if(e===epoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'){s.error=error.message;emit();}}
    finally{if(e===epoch&&v===viewEpoch){s.loading=false;emit('loading');}}
  }
  async function openCompose({playerId,destination='player'}={}){
    identity();if(s.suspended)return openInbox();if(!ID.test(String(playerId||''))||String(playerId)===s.ownerId)return openInbox();viewEpoch++;viewBusy=false;s.open=true;s.view='compose';s.targetPlayerId=String(playerId);s.target=null;s.destination=destination==='guild'?'guild':'player';s.guildId=null;s.needsTargetConfirm=false;s.thread=null;s.messages=[];s.draft='';s.draftKey='';s.error='';s.status='';emit('navigation');if(s.ownerId)await recipient();else{s.error='書状は領主登録・ログイン後に利用できます。';emit();}schedule();
  }
  function setDestination(value){if(s.suspended)return;if(!['player','guild'].includes(value)||!s.target)return;const previous=s.draft;s.destination=value;s.guildId=value==='guild'?s.target.guildId||null:null;s.needsTargetConfirm=false;useDraft(previous);s.error=value==='guild'&&!s.guildId?'この領主は同盟に所属していません。':'';emit('destination');}
  async function loadThread(id,{refresh=false,older=false}={}){
    if(!THREAD.test(String(id||''))||!s.ownerId||s.suspended||viewBusy||older&&!s.nextBefore&&!s.threadNeedsReset)return;
    const e=epoch,v=viewEpoch,revisionEpoch=contentEpoch,resetting=s.threadNeedsReset;viewBusy=true;s.loadingOlder=older&&!resetting;if(!refresh&&!older||resetting)s.loading=true;emit('loading');
    const highest=s.messages.at(-1)?.seq||0,query=(resetting?'limit=40':older?'before='+s.nextBefore:refresh?'after='+highest:'limit=40')+(s.contentRevision!==null?'&contentRevision='+s.contentRevision:'');
    try{const result=await call('/letters/'+id+'?'+query);if(v!==viewEpoch||s.view!=='thread'||s.thread?.id!==id)return;const replacing=resetting||result.reset===true||revisionEpoch!==contentEpoch||!refresh&&!older;s.thread=result.thread;s.messages=replacing?result.messages||[]:mergeMessages(s.messages,result.messages||[]);if(!refresh||replacing){s.hasOlder=Boolean(result.hasOlder);s.nextBefore=result.nextBefore||null;}s.hasNewer=Boolean(result.hasNewer);s.threadNeedsReset=false;s.error='';s.loaded=true;applyPlayerEvaluations(result);emit(replacing?'thread':older?'older':'messages');}
    catch(error){if(e!==epoch||v!==viewEpoch||error.code==='STALE_IDENTITY')return;s.error=error.message;if([403,404].includes(error.status)){s.messages=[];s.thread=null;s.view='inbox';s.threads=[];s.loaded=false;s.draft='';s.draftKey='';viewEpoch++;viewBusy=false;emit('revoked');}else emit();}
    finally{if(e===epoch&&v===viewEpoch){viewBusy=false;s.loading=false;s.loadingOlder=false;emit('loading');}}
  }
  async function openThread(id){identity();if(s.suspended)return openInbox();if(!THREAD.test(String(id||'')))return;viewEpoch++;viewBusy=false;s.view='thread';s.open=true;s.thread=s.threads.find(t=>t.id===id)||{id,title:'書状',kind:'player'};s.messages=[];s.hasOlder=false;s.nextBefore=null;s.hasNewer=false;s.error='';s.status='';lastRead=readQueued=0;useDraft();emit('navigation');await loadThread(id);schedule();}
  async function markRead(){
    if(s.suspended||!s.open||s.view!=='thread'||!s.thread||!s.messages.length||!visible()||disposed)return;const through=s.messages.at(-1).seq;if(through<=lastRead)return;readQueued=Math.max(readQueued,through);if(readBusy)return;
    readBusy=true;const e=epoch,v=viewEpoch,id=s.thread.id,requested=readQueued;readQueued=0;
    try{const result=await call('/letters/'+id+'/read',{method:'POST',data:{through:requested}});if(v!==viewEpoch||s.thread?.id!==id)return;lastRead=Math.max(lastRead,Number(result.through)||0);setSummary(result);if(lastRead>=s.thread.lastSeq)s.thread.unreadCount=0;emit('read');}
    catch(error){if(e===epoch&&v===viewEpoch&&error.code!=='STALE_IDENTITY'&&[403,404].includes(error.status)){s.messages=[];s.thread=null;s.threads=[];s.view='inbox';s.error=error.message;viewEpoch++;viewBusy=false;emit('revoked');}}
    finally{if(e===epoch){readBusy=false;if(readQueued>lastRead&&v===viewEpoch)markRead();}}
  }
  function clearSentDraft(record){const name=key('draft:'+record.draftKey),stored=readStore(name,null);if(stored===record.originalDraft)removeStore(name);if(s.draftKey===record.draftKey&&s.draft===record.originalDraft)s.draft='';}
  function sendRecord(record){
    if(s.suspended)return Promise.resolve(false);if(sendPromise)return sendPromise;const e=epoch,v=viewEpoch,owner=s.ownerId;s.sending=true;s.error='';s.status='書状を届けています…';emit('sending');
    sendPromise=(async()=>{try{
      const result=await call(record.route,{method:'POST',data:clone(record.data)});if(!current(e,owner))return false;
      const unchangedDraft=s.draftKey===record.draftKey&&s.draft===record.originalDraft;s.pending=null;removeStore(key('pending'));clearSentDraft(record);s.status=result.idempotent?'書状が届いていることを確認しました。':'書状を届けました。';s.error='';
      if(s.open&&v===viewEpoch){if(s.view==='compose'&&unchangedDraft){viewEpoch++;viewBusy=false;s.view='thread';s.thread=result.thread;s.messages=[];s.hasOlder=false;s.nextBefore=null;s.hasNewer=false;useDraft();emit('sent');await loadThread(result.thread.id);}else if(s.view==='thread'&&s.thread?.id===result.thread.id){s.thread=result.thread;await loadThread(result.thread.id,{refresh:true});}}
      emit('sending');refreshSummary();return true;
    }catch(error){if(!current(e,owner)||error.code==='STALE_IDENTITY')return false;s.error=error.message||'送信結果を確認できませんでした。';s.status='';
      if(error.code==='LETTER_TARGET_CHANGED'){
        s.pending=null;removeStore(key('pending'));if(s.view==='compose'&&v===viewEpoch){s.needsTargetConfirm=true;s.guildId=null;s.error='宛先の所属同盟が変わりました。下書きは残しています。送信先を選び直してください。';await recipient({confirm:true});s.needsTargetConfirm=true;s.error='所属が変わりました。下書きを確認し、下の宛先ボタンを選び直してください。';}
      }else if(error.status===400){s.pending=null;removeStore(key('pending'));}
      else if([403,404].includes(error.status)){s.messages=[];s.thread=null;s.threads=[];if(s.view==='thread'){s.view='inbox';viewEpoch++;viewBusy=false;}s.error='この書状を現在の権限では確認できません。送信結果が不明な場合は、宛先を確認してから送信記録を整理してください。';}
      emit('send-error');return false;
    }finally{if(e===epoch){s.sending=false;sendPromise=null;emit('sending');}}})();return sendPromise;
  }
  function send(){
    identity();if(sendPromise)return sendPromise;if(!s.ownerId||s.suspended)return Promise.resolve(false);if(s.pending){s.error='先の書状の送信結果を確認してから、新しい書状を送ってください。';emit();return Promise.resolve(false);}
    const text=normalized(s.draft);if(!text||textLength(text)>MAX_TEXT){s.error='書状は1～1,000文字で入力してください。';emit();return Promise.resolve(false);}
    let route,data;if(s.view==='thread'&&s.thread?.canReply!==false){route='/letters/'+s.thread.id+'/messages';data={requestId:uuid(),text};}
    else if(s.view==='compose'&&s.target&&!s.needsTargetConfirm&&(s.destination==='player'||s.guildId)){route='/letters';data={requestId:uuid(),targetPlayerId:s.target.id,destination:s.destination,...(s.destination==='guild'?{guildId:s.guildId}:{}),text};}
    else{s.error='宛先を確認して選び直してください。';emit();return Promise.resolve(false);}
    const record={ownerId:s.ownerId,route,data,draftKey:s.draftKey,originalDraft:s.draft,createdAt:now()};if(!writeStore(key('pending'),record)){s.error='送信番号を端末に保存できません。ブラウザーの保存設定を確認してください。';emit();return Promise.resolve(false);}s.pending=record;return sendRecord(record);
  }
  function retry(){identity();return s.pending&&!s.suspended?sendRecord(s.pending):Promise.resolve(false);}
  function forgetPending(){if(s.sending)return;s.pending=null;removeStore(key('pending'));s.status='送信記録を整理しました。すでに届いた書状は取り消されません。';emit();}
  function close(){s.open=false;emit('close');schedule();}
  function refreshIdentity(){identity({allowResume:true});if(s.open&&s.ownerId&&s.view==='inbox')loadInbox();refreshSummary();schedule();}
  function start(){identity();refreshSummary();schedule();}
  function dispose(){disposed=true;epoch++;cancel(timer);timer=null;s.messages=[];s.threads=[];s.thread=null;}
  return{getState:snapshot,start,refreshIdentity,observeContentRevision,suspendAccount,openInbox,openCompose,openThread,setDestination,setDraft,send,retry,forgetPending,close,refresh:tick,markRead,loadMore:()=>loadInbox({more:true}),loadOlder:()=>loadThread(s.thread?.id,{older:true}),dispose};
}

const paths={mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7',close:'m6 6 12 12M18 6 6 18',people:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2',refresh:'M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5M4 16a9 9 0 0 0 15 3l3-3m0 5v-5h-5'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.mail}"/></svg>`;
function createView(doc,controller){
  const dialog=doc.createElement('dialog');dialog.id='letters-modal';dialog.className='letters-dialog';dialog.setAttribute('aria-labelledby','letters-title');
  dialog.innerHTML=`<header class="letters-header"><span class="letters-seal">${icon('mail')}</span><div><p>本拠を結ぶ、ことばの便り</p><h1 id="letters-title">書状</h1></div><button type="button" class="letters-icon" data-letter-action="close" aria-label="書状を閉じる">${icon('close')}</button></header><div class="letters-toolbar"><button type="button" class="letters-button" data-letter-action="inbox">受信・送信箱 <span data-letter-unread></span></button><span class="letters-toolbar-note">領主同士・同盟への連絡</span><button type="button" class="letters-icon" data-letter-action="refresh" aria-label="書状を更新">${icon('refresh')}</button></div><div class="letters-pending" data-letter-pending hidden></div><p class="letters-feedback" data-letter-feedback role="status" aria-live="polite" hidden></p><main class="letters-main" data-letter-main></main><footer class="letters-footer">本文は1,000文字まで。下書きはこの端末に保存されます。</footer>`;
  doc.body.append(dialog);const $=selector=>dialog.querySelector(selector);let shell='',lastMessages='',renderedSeq=0,returnFocus=null,markTimer=null,lastUnread=-1;
  const date=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d):'';};
  const form=()=>`<form class="letters-compose" data-letter-form><label for="letters-text">書状の本文</label><small id="letters-register">上位の領主へは敬語で送信します。</small><textarea aria-describedby="letters-register" id="letters-text" rows="3" maxlength="4000" placeholder="礼をもって言葉を届けましょう。"></textarea><div class="letters-compose-footer"><span data-letter-counter>0 / 1,000</span><button type="submit" class="letters-button is-primary" data-letter-send>書状を送る</button></div></form>`;
  function viewShell(state){if(state.suspended)return'<div class="letters-empty"><h2>この領主は利用停止中です</h2><p>書状の閲覧と送信を停止しています。利用停止が解除されると、同じ領主で再開できます。削除済みの本文は復元されません。</p></div>';if(!state.ownerId)return`<div class="letters-empty">${icon('mail')}<h2>本拠から、領主へ書状を</h2><p>領主登録をすると、本人への書状や、所属同盟への連絡を送れます。</p><button type="button" class="letters-button is-primary" data-letter-action="register">領主登録・ログイン</button></div>`;if(state.view==='inbox')return'<section class="letters-inbox"><div class="letters-section-heading"><h2>届いた書状・送った書状</h2><p>共通フィールドで領主の本拠を選ぶと、新しい書状を書けます。</p></div><div class="letters-inbox-list" data-letter-inbox></div><button type="button" class="letters-button letters-more" data-letter-action="inbox-more" hidden>さらに表示</button></section>';if(state.view==='compose')return`<section class="letters-new"><div data-letter-target></div>${form()}</section>`;return`<section class="letters-thread"><header class="letters-thread-heading" data-letter-thread-heading></header><div class="letters-message-scroll" data-letter-scroll tabindex="0" aria-label="書状のやり取り"><button type="button" class="letters-button letters-more" data-letter-action="older" hidden>以前の書状を読む</button><div class="letters-message-list" data-letter-messages></div></div><button type="button" class="letters-new-messages" data-letter-action="latest" hidden>新しい書状があります · 最新へ</button>${form()}</section>`;}
  function requestRead(){global.cancelAnimationFrame?.(markTimer);markTimer=global.requestAnimationFrame?.(()=>{const scroll=$('[data-letter-scroll]');if(dialog.open&&!doc.hidden&&scroll&&scroll.scrollHeight-scroll.clientHeight-scroll.scrollTop<64)controller.markRead();});}
  function patchContents(host,html){
    if(global.SengokuStableDOM)global.SengokuStableDOM.patch(host,html);
    else if(host.innerHTML!==html)host.innerHTML=html;
  }
  function render(state){
    if(['identity','content-reset','banned'].includes(state.change)){shell='';lastMessages='';renderedSeq=0;$('[data-letter-main]').innerHTML='';$('[data-letter-pending]').innerHTML='';$('[data-letter-pending]').hidden=true;}
    if(lastUnread!==state.unreadCount){lastUnread=state.unreadCount;global.dispatchEvent?.(new global.CustomEvent('sengoku:letters-updated',{detail:{count:state.unreadCount,ownerId:state.ownerId}}));}
    if(state.open&&!dialog.open){returnFocus=doc.activeElement;dialog.showModal();}else if(!state.open&&dialog.open){dialog.close();return;}
    if(!state.open)return;
    const key=state.ownerId+':'+state.suspended+':'+state.view+':'+(state.view==='thread'?state.thread?.id:state.view==='compose'?state.targetPlayerId:'');
    if(shell!==key){shell=key;lastMessages='';renderedSeq=0;$('[data-letter-main]').innerHTML=viewShell(state);$('[data-letter-main]').scrollTop=0;if(state.view==='compose')global.setTimeout(()=>$('textarea')?.focus({preventScroll:true}),0);}
    const feedback=$('[data-letter-feedback]');feedback.textContent=state.error||state.status||'';feedback.hidden=!feedback.textContent;feedback.classList.toggle('is-error',Boolean(state.error));
    const pending=$('[data-letter-pending]');pending.hidden=!state.pending;const pendingHTML=state.pending?`<div><strong>${state.sending?'書状を送信中です':'送信結果を確認する書状があります'}</strong><span>同じ送信番号で確認します。二重には届きません。</span></div><button type="button" class="letters-button" data-letter-action="retry"${state.sending?' disabled':''}>${state.sending?'送信中…':'送信結果を確認'}</button><button type="button" class="letters-button is-subtle" data-letter-action="forget"${state.sending?' disabled':''}>記録を整理</button>`:'';patchContents(pending,pendingHTML);
    const badge=$('[data-letter-unread]');badge.textContent=state.unreadCount?String(Math.min(999,state.unreadCount)):'';badge.hidden=!state.unreadCount;
    if(state.suspended)return;
    if(state.ownerId&&state.view==='inbox'){
      const list=$('[data-letter-inbox]'),main=$('[data-letter-main]'),top=main.scrollTop;
      const html=state.threads.map(thread=>`<button type="button" class="letters-inbox-row ${thread.unreadCount?'is-unread':''}" data-letter-action="thread" data-thread-id="${esc(thread.id)}" data-stable-key="${esc(thread.id)}"><span class="letters-thread-icon ${thread.kind==='guild'?'is-guild':''}">${icon(thread.kind==='guild'?'people':'mail')}</span><span class="letters-inbox-copy"><span class="letters-row-top"><strong>${threadTitle(thread,state.ownerId)}</strong><time datetime="${esc(thread.updatedAt)}">${esc(date(thread.updatedAt))}</time></span><span class="letters-kind">${thread.kind==='guild'?'同盟への連絡':'領主本人への書状'}${thread.unreadCount?`<b class="letters-count">未読 ${thread.unreadCount}</b>`:''}</span><span class="letters-preview">${thread.lastMessage?playerName(thread.lastMessage.authorName,thread.lastMessage.authorEvaluation,thread.lastMessage.authorAppearance,thread.lastMessage.authorId,thread.lastMessage.authorAvatarVersion):''}：${esc(thread.lastMessage?.text||'')}</span></span></button>`).join('')||`<div class="letters-empty">${icon('mail')}<h3>${state.loading?'書状を確認しています':'まだ書状はありません'}</h3><p>フィールドの本拠から「領主に書状」「所属同盟に書状」を選んで送れます。</p></div>`;
      patchContents(list,html);if(main.scrollTop!==top)main.scrollTop=top;const more=$('[data-letter-action="inbox-more"]');more.hidden=!state.nextCursor;more.disabled=state.loading;
    }
    if(state.ownerId&&state.view==='compose'){
      const target=$('[data-letter-target]'),player=state.target,html=player?`<div class="letters-recipient"><span class="letters-eyebrow">本拠の領主</span><h2>${playerName(player.name,player.evaluation,player.appearance,player.id,player.avatarVersion)}</h2><p>${esc(player.clan==='德川家'?'徳川家':player.clan||'')}</p></div><div class="letters-destinations" role="group" aria-label="書状の送信先"><button type="button" class="letters-destination ${state.destination==='player'&&!state.needsTargetConfirm?'is-selected':''}" data-letter-action="destination" data-destination="player" aria-pressed="${state.destination==='player'&&!state.needsTargetConfirm}">${icon('mail')}<span><strong>領主本人に書状</strong><small>${playerName(player.name,player.evaluation,player.appearance,player.id,player.avatarVersion)}だけに届ける</small></span></button><button type="button" class="letters-destination ${state.destination==='guild'&&!state.needsTargetConfirm?'is-selected':''}" data-letter-action="destination" data-destination="guild" aria-pressed="${state.destination==='guild'&&!state.needsTargetConfirm}"${!player.guildId?' disabled':''}>${icon('people')}<span><strong>所属同盟に書状</strong><small>${player.guildId?allianceName({id:player.guildId,name:player.guildName,iconVersion:player.guildIconVersion}):'同盟に所属していません'}</small></span></button></div><p class="letters-visibility ${state.destination==='guild'?'is-guild':''}">${state.destination==='guild'?'所属同盟のメンバーに共有 · '+esc(player.guildName||'宛先なし')+'。送り主と、現在の所属メンバーが閲覧・返信できます。':'領主本人同士だけが閲覧・返信できます。'}${state.needsTargetConfirm?' 宛先をもう一度選んでください。':''}</p>`:'<div class="letters-empty"><p>宛先の領主と所属同盟を確認しています…</p></div>';patchContents(target,html);
    }
    if(state.ownerId&&state.view==='thread'){
      const heading=$('[data-letter-thread-heading]'),thread=state.thread,head=`<span class="letters-eyebrow">${thread.kind==='guild'?'同盟への連絡':'領主本人への書状'}</span><h2>${threadTitle(thread,state.ownerId)}</h2>${threadParticipants(thread)}<p class="letters-visibility ${thread.kind==='guild'?'is-guild':''}">${thread.kind==='guild'?'所属同盟のメンバーに共有 · '+esc(thread.guild?.name||'')+'。送り主と現在のメンバーが閲覧・返信できます。':'領主本人同士だけが閲覧・返信できます。'}</p>`;patchContents(heading,head);
      const scroll=$('[data-letter-scroll]'),list=$('[data-letter-messages]'),older=$('[data-letter-action="older"]'),before={top:scroll.scrollTop,height:scroll.scrollHeight,clientHeight:scroll.clientHeight},wasBottom=before.height-before.clientHeight-before.top<64;
      const html=state.messages.map(message=>`<article data-stable-key="${esc(message.seq)}" class="letters-message ${message.authorId===state.ownerId?'is-mine':''}"><header><strong>${playerName(message.authorName,message.authorEvaluation,message.authorAppearance,message.authorId,message.authorAvatarVersion)}</strong><time datetime="${esc(message.createdAt)}">${esc(date(message.createdAt))}</time></header><p>${esc(message.text)}</p></article>`).join('')||'<p class="letters-empty-message">書状を確認しています…</p>';
      older.hidden=!state.hasOlder;older.disabled=state.loadingOlder;
      if(html!==lastMessages){patchContents(list,html);scroll.scrollTop=scrollAfterUpdate({...before,nextHeight:scroll.scrollHeight,prepend:state.change==='older',forceBottom:renderedSeq===0});const last=state.messages.at(-1)?.seq||0,latest=$('[data-letter-action="latest"]');if(last>renderedSeq&&!wasBottom&&renderedSeq>0&&state.change!=='older')latest.hidden=false;else if(wasBottom||renderedSeq===0)latest.hidden=true;renderedSeq=last;lastMessages=html;requestRead();}
    }
    const input=$('textarea');if(input){if(input.value!==state.draft){const start=input.selectionStart,end=input.selectionEnd,focused=doc.activeElement===input;input.value=state.draft;if(focused){input.focus({preventScroll:true});input.setSelectionRange(Math.min(start,input.value.length),Math.min(end,input.value.length));}}const length=textLength(state.draft),count=$('[data-letter-counter]');count.textContent=length.toLocaleString('ja-JP')+' / 1,000';count.classList.toggle('is-error',length>MAX_TEXT);const send=$('[data-letter-send]');send.textContent=state.sending?'送信中…':state.view==='thread'?'返信を送る':'書状を送る';send.disabled=state.sending||Boolean(state.pending)||!length||length>MAX_TEXT||state.loading||state.needsTargetConfirm||state.view==='compose'&&(!state.target||state.destination==='guild'&&!state.guildId);}
  }
  dialog.addEventListener('input',event=>{if(event.target.id==='letters-text')controller.setDraft(event.target.value);});
  dialog.addEventListener('submit',event=>{if(event.target.matches('[data-letter-form]')){event.preventDefault();controller.send();}});
  dialog.addEventListener('scroll',event=>{if(event.target.matches('[data-letter-scroll]')){if(event.target.scrollHeight-event.target.clientHeight-event.target.scrollTop<64){$('[data-letter-action="latest"]').hidden=true;requestRead();}}},true);
  dialog.addEventListener('click',event=>{const button=event.target.closest('[data-letter-action]');if(!button||button.disabled)return;const action=button.dataset.letterAction;if(action==='close')controller.close();else if(action==='inbox')controller.openInbox();else if(action==='refresh')controller.refresh();else if(action==='thread')controller.openThread(button.dataset.threadId);else if(action==='destination')controller.setDestination(button.dataset.destination);else if(action==='retry')controller.retry();else if(action==='forget'){if(global.confirm('送信結果の確認をやめますか？ すでに届いた書状は取り消されません。再び同じ本文を送ると、別の書状として届く場合があります。'))controller.forgetPending();}else if(action==='older')controller.loadOlder();else if(action==='inbox-more')controller.loadMore();else if(action==='register'){controller.close();global.SengokuSocial?.open('profile');}else if(action==='latest'){const scroll=$('[data-letter-scroll]');scroll.scrollTop=scroll.scrollHeight;button.hidden=true;requestRead();}});
  dialog.addEventListener('close',()=>{controller.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});});
  dialog.addEventListener('cancel',event=>{event.preventDefault();controller.close();});
  return{render,dispose(){dialog.remove();}};
}
let singleton=null,view=null;
function boot(){if(singleton||!global.document?.body)return;singleton=createController({onChange:state=>view?.render(state)});view=createView(global.document,singleton);global.document.addEventListener('visibilitychange',()=>singleton?.refresh());singleton.start();}
const api={createController,scrollAfterUpdate,mergeMessages,textLength,escape:esc,openInbox(){boot();global.SengokuSocial?.close?.();return singleton?.openInbox();},openCompose(options){boot();global.SengokuSocial?.close?.();return singleton?.openCompose(options);},refreshIdentity(){singleton?.refreshIdentity();},observeContentRevision(value){return singleton?.observeContentRevision(value);},suspendAccount(message){singleton?.suspendAccount(message);},close(){singleton?.close();},getState:()=>singleton?.getState(),dispose(){singleton?.dispose();view?.dispose();singleton=view=null;}};
global.SengokuLetters=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(global.document){if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();}
})(typeof window!=='undefined'?window:globalThis);
