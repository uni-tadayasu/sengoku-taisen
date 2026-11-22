/* 戦国VS・交流の間。認証キーはサーバー側のみ。 */
(function(global){
'use strict';
const IDKEY='sengoku-online-identity-v1', CLAIMKEY='sengoku-mail-claims-v1';
const DEFAULT='戦国VSへようこそ。一城を育て、武将とともに、あなたの天下を描いてください。';
const RES={gold:'金',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
const s={identity:null,user:null,friends:[],requests:[],unreadMail:0,unreadLetters:0,management:null,config:{announcement:DEFAULT,onlineCount:0},configLoaded:false,connected:false,tab:'world',friendId:null,chats:new Map(),guilds:[],guild:null,members:[],mail:[],players:[],adminPlayers:[],adminSection:'chat',staff:[],staffCandidates:[],staffLoaded:false,staffQuery:'',staffPage:1,staffCandidatePage:1,openedMail:null,open:false,meLoading:false,error:'',paused:false,pending:{},confirm:null,onlinePlayers:[],onlineTotal:0,onlineCursor:null,onlineLoaded:false,onlineError:'',pairCode:null,syncStatus:null};
let dialog,body,launcher,announcement,configTimer=null,pollTimer=null,configBusy=false,pollBusy=false,disposed=false,authEpoch=0,privilegeEpoch=0,onlineTimer=null,onlineEpoch=0,onlineBusy=false,syncUnsubscribe=null,recentLoginTimer=null,recentLoginGeneration=0,recentLoginBusy=false,avatarEditor=null,avatarGeneration=0,avatarMutationEpoch=0,nameMutationEpoch=0;
s.recentLogins={players:[],total:0,cursor:null,serverNow:null,windowStart:null,loaded:false,error:''};
let guildEpoch=0,guildListGeneration=0,guildListTimer=null,treasuryBusy=false,rankingsBusy=false,guildIconEditor=null,guildIconGeneration=0;
s.guildSection='chat';s.guildTreasury={guildId:null,balance:null,ledger:[],cursor:null,loaded:false,error:'',serverNow:null};s.guildRankings={guilds:[],total:0,cursor:null,loaded:false,error:'',serverNow:null};
let achievementTimer=null,achievementBusy=false,achievementGeneration=0;
s.achievements={events:[],cursor:null,loaded:false,error:'',serverNow:null,expanded:false};
const guildRoleName=role=>({owner:'盟主',officer:'副盟主',member:'メンバー'})[role]||'メンバー';
const busy=new Set(),controllers=new Set();
let recovery=null,recoveryEpoch=0,recoveryHeld=false,adminRecoveryRequestId=null;
let mailStatusBusy=false,meGeneration=0;
let courtAccessSequence=0;
let voiceView=null;
s.accountBanned=null;s.accountAccessPending=null;s.contentRevision=null;s.profileNameEdit=null;
let accountEpoch=0,contentEpoch=0;
const recoveryTools=()=>{if(!global.SengokuDomainRecovery)throw Error('復旧機能を読み込めませんでした。画面を再読み込みしてください。');return global.SengokuDomainRecovery;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function normalizedPlayerName(value){const name=String(value??'').normalize('NFC').trim(),length=Array.from(name).length;if(length<1||length>24||/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(name))throw Error('領主名は1〜24文字で入力してください。使用できない文字が含まれていないか確認してください。');return name;}
const $=selector=>dialog?.querySelector(selector);
const num=n=>Math.max(0,Number(n)||0).toLocaleString('ja-JP');
const paths={chat:'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5',close:'m6 6 12 12M18 6 6 18',mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7',people:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',flag:'M5 21V3m0 1c5-4 8 4 14 0v10c-6 4-9-4-14 0',send:'m3 4 18 8-18 8 4-8-4-8Zm4 8h14',pause:'M8 5v14M16 5v14',play:'m8 4 12 8-12 8V4Z',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',search:'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-2 5.5 6',gift:'M3 9h18v4H3V9Zm2 4v8h14v-8M12 9v12M12 9C5 9 5 3 8 3s4 6 4 6Zm0 0c7 0 7-6 4-6s-4 6-4 6',user:'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM4 21v-2a8 8 0 0 1 16 0v2',refresh:'M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5M4 16a9 9 0 0 0 15 3l3-3m0 5v-5h-5'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.chat}"/></svg>`;
const first=name=>esc(Array.from(String(name||'領主'))[0]);
const socialAvatar=(user,size='')=>global.SengokuAvatar?.markup(user,size)||`<span class="social-avatar ${['small','profile'].includes(size)?size:''}">${first(user?.name)}</span>`;
const guildIcon=(guild,size='')=>global.SengokuAllianceIcon?.markup?.(guild,size)||`<span class="social-alliance-icon" aria-hidden="true">${first(guild?.name||'同盟')}</span>`;
const role=()=>'';
const evaluationKey=value=>global.SengokuEvaluationUI?.key?.(value)||'';
const evaluationBadge=value=>global.SengokuEvaluationUI?.badge?.(value)||'';
function publicEvaluation(value){if(!evaluationKey(value))return null;const {version,score,maxScore,rankId,rankName,rankIndex}=value;return{version,score,maxScore,rankId,rankName,rankIndex};}
function playerName(name,evaluation,playerId='',appearance=null,avatarVersion,showAvatar=true){const own=String(playerId)===String(s.user?.id),look=own?global.SengokuPremiumRuntime?.getAppearance?.():appearance,photo=showAvatar&&playerId?global.SengokuAvatar?.markup?.({id:playerId,name,avatarVersion:own?s.user.avatarVersion:avatarVersion},'inline')||'':'';return `<span class="player-evaluation-person">${photo}<span class="player-evaluation-name" data-premium-player="${esc(playerId)}" data-premium-player-name="${esc(name)}">${global.SengokuPremiumRuntime?.nameMarkup?.(name,look)||esc(name)}</span><span class="player-evaluation-slot"${playerId?` data-player-evaluation="${esc(playerId)}"`:''} data-evaluation-key="${esc(evaluationKey(evaluation))}">${evaluationBadge(evaluation)}</span>${global.SengokuPublicCourt?.slot?.(playerId)||''}</span>`;}
function playerText(name,evaluation,appearance=null){const label=global.SengokuEvaluationUI?.label?.(evaluation),owned=global.SengokuPremiumRuntime?.ownershipLabel?.(appearance);return String(name||'領主')+(label?`（${label}）`:'')+(owned?`［${owned}］`:'');}
function applyPlayerEvaluations(rows){
 const updates=new Map();for(const row of Array.isArray(rows)?rows:[]){if(!row||!['string','number'].includes(typeof row.playerId))continue;const id=String(row.playerId),value=updates.get(id)||{};if(typeof row.name==='string')value.name=row.name;if(Object.hasOwn(row,'avatarVersion'))value.avatarVersion=row.avatarVersion||null;if(Object.hasOwn(row,'evaluation'))value.evaluation=publicEvaluation(row.evaluation);if(Object.hasOwn(row,'appearance'))value.appearance=global.SengokuPremiumRuntime?.cleanAppearance?.(row.appearance)||null;updates.set(id,value);}if(s.user?.id&&typeof s.user.name==='string'){const id=String(s.user.id);updates.set(id,{avatarVersion:s.user.avatarVersion||null,...updates.get(id),name:s.user.name});}if(!updates.size)return;
 const update=(person,id='id',field='evaluation',look='appearance',name='name',photo='avatarVersion')=>{const value=person&&updates.get(String(person[id]));if(!value)return;if(Object.hasOwn(value,'name'))person[name]=value.name;if(Object.hasOwn(value,'avatarVersion'))person[photo]=value.avatarVersion;if(Object.hasOwn(value,'evaluation'))person[field]=value.evaluation;if(Object.hasOwn(value,'appearance'))person[look]=value.appearance;};
 update(s.user);for(const key of ['friends','requests','members','players','adminPlayers','staff','staffCandidates','onlinePlayers'])for(const person of s[key])update(person);
 for(const person of s.recentLogins.players)update(person);
 for(const cache of s.chats.values())for(const message of cache.messages||[])update(message,'userId');
 for(const event of s.achievements.events)update(event,'playerId','playerEvaluation','playerAppearance','playerName');
 for(const entry of s.guildTreasury.ledger)update(entry,'playerId','playerEvaluation');
 for(const guild of [...s.guilds,...s.guildRankings.guilds])update(guild,'ownerId','ownerEvaluation','ownerAppearance','ownerName','ownerAvatarVersion');
 for(const mail of s.mail)for(const person of mail.participants||[])update(person,'playerId');
 // Only replace the non-interactive badge slot. Polling must leave composing
 // text, selection, focused controls and the profile's image editor mounted.
 for(const node of dialog?.querySelectorAll?.('[data-player-evaluation]')||[]){const value=updates.get(String(node.dataset.playerEvaluation));if(!value||!Object.hasOwn(value,'evaluation'))continue;const key=evaluationKey(value.evaluation);if(node.dataset.evaluationKey!==key){node.innerHTML=evaluationBadge(value.evaluation);node.dataset.evaluationKey=key;}}
 for(const node of dialog?.querySelectorAll?.('[data-premium-player]')||[]){const id=String(node.dataset.premiumPlayer),value=updates.get(id),own=id===String(s.user?.id);if(!value||!Object.hasOwn(value,'appearance')&&!Object.hasOwn(value,'name'))continue;if(Object.hasOwn(value,'name'))node.dataset.premiumPlayerName=value.name;if(!own&&!Object.hasOwn(value,'appearance')){const text=node.querySelector?.('.sengoku-premium-name-text');if(text)text.textContent=value.name;else node.textContent=value.name;continue;}const look=own?global.SengokuPremiumRuntime?.getAppearance?.():value.appearance,html=global.SengokuPremiumRuntime?.nameMarkup?.(node.dataset.premiumPlayerName,look)||esc(node.dataset.premiumPlayerName);if(node.innerHTML!==html)node.innerHTML=html;}
}
const hasAdminChat=(user=s.user)=>user?.isAdmin===true||user?.isStaff===true;
function requireAdmin(){if(!s.user?.isAdmin)throw Error('この操作には運営権限が必要です。');}
const giftLabel=g=>Object.entries(RES).filter(([k])=>Number(g?.[k])>0).map(([k,label])=>`${label} ${num(g[k])}`).join(' / ')||'添付なし';
function base(){try{const raw=global.SENGOKU_API_BASE;if(typeof raw!=='string'||!raw.trim())return null;const u=new URL(raw);if(!['https:','http:'].includes(u.protocol))return null;return raw.replace(/\/+$/,'').replace(/\/api\/v1$/,'')+'/api/v1';}catch(_){return null;}}
function validIdentity(v){return v&&typeof v==='object'&&(typeof v.id==='string'||Number.isSafeInteger(v.id))&&String(v.id).length>0&&String(v.id).length<180&&typeof v.token==='string'&&v.token.length>=20&&v.token.length<=8192&&!/\s/.test(v.token);}
function saveJSON(key,value){try{const raw=JSON.stringify(value);localStorage.setItem(key,raw);return localStorage.getItem(key)===raw;}catch(_){return false;}}
function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}}
function restoreStoredIdentity(){const saved=readJSON(IDKEY,null);if(validIdentity(saved)){s.identity={id:saved.id,token:saved.token};recoveryHeld=saved.pendingRecovery===true;}return recoveryHeld;}
function toast(message,error=false){global.SengokuBridge?.toast?.(message,error);const el=$('#social-feedback');if(el){el.textContent=message;el.classList.toggle('is-error',error);el.hidden=false;}}
function date(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d):'';}
function pauseRecentLogins(){recentLoginGeneration++;recentLoginBusy=false;clearTimeout(recentLoginTimer);recentLoginTimer=null;}
function clearRecentLogins(){pauseRecentLogins();s.recentLogins={players:[],total:0,cursor:null,serverNow:null,windowStart:null,loaded:false,error:''};for(const selector of ['#social-recent-login-results','#social-recent-login-count','#social-recent-login-window','#social-recent-login-status']){const node=$(selector);if(node)node.textContent='';}}
function pauseGuildLists(){guildListGeneration++;treasuryBusy=rankingsBusy=false;clearTimeout(guildListTimer);guildListTimer=null;}
function clearGuildData({resetSection=true}={}){guildEpoch++;global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();destroyGuildIconEditor();pauseGuildLists();s.guild=null;s.members=[];s.guildTreasury={guildId:null,balance:null,ledger:[],cursor:null,loaded:false,error:'',serverNow:null};if(resetSection)s.guildSection='chat';for(const key of s.chats.keys())if(key.startsWith('guild:'))s.chats.delete(key);for(const selector of ['#social-guild-ledger','#social-guild-balances','#social-guild-members']){const node=$(selector);if(node)node.textContent='';}if(s.confirm?.scope==='guild')clearConfirm();}
function clearAdminData(){privilegeEpoch++;global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();courtAccessSequence++;global.SengokuBridge?.applyCourtAccess?.(null);destroyGuildIconEditor();s.management=null;global.SengokuPremiumAdmin?.clear?.();refreshOperatorRecoveryAccess();destroyAvatarEditor();clearRecentLogins();for(const key of s.chats.keys())if(key.startsWith('admin:'))s.chats.delete(key);s.adminPlayers=[];s.staff=[];s.staffCandidates=[];s.staffLoaded=false;s.staffQuery='';s.staffPage=1;s.staffCandidatePage=1;s.adminSection='chat';if(s.confirm)clearConfirm();}
function clearPrivate(){global.SengokuPublicCourt?.clear?.();global.SengokuVoice?.leave?.('領主の接続を確認し直すため、通話を終了しました。');s.profileNameEdit=null;clearAdminData();clearGuildData();s.mail=[];s.openedMail=null;s.guilds=[];s.players=[];s.friendId=null;s.chats.clear();s.confirm=null;s.pairCode=null;}
function accountBannedError(){return Object.assign(Error(s.accountBanned?.message||'この領主は利用を停止されています。解除後、同じ領主で再接続できます。'),{code:'ACCOUNT_BANNED',status:403});}
function accountAccessError(){return Object.assign(Error(s.accountAccessPending?.message||'利用状態が変わったため、最新の保存と権限を確認しています。'),{code:'ACCOUNT_ACCESS_CHANGED',status:409});}
function accountBannedView(){return '<section class="social-account-banned"><h2>この領主は利用停止中です</h2><p>'+esc(s.accountBanned?.message||'この領主は利用停止中です。')+'</p><code>'+esc(s.identity?.id||'')+'</code><p>利用停止が解除されると、同じ領主で利用を再開できます。認証情報と保存された進行はこのまま保持します。削除されたチャット・書状の本文は復元されません。</p><button type="button" class="social-button primary" data-social="banned-recheck">接続を再確認</button></section>';}
function accountAccessView(){return '<section class="social-account-banned"><h2>利用状態を再確認しています</h2><p>'+esc(s.accountAccessPending?.message||'アカウントの利用状態が変わりました。最新の保存と権限が確認できるまで、操作を待機しています。')+'</p><code>'+esc(s.identity?.id||'')+'</code><p>認証情報は保持されています。このまま同じ領主の状態を確認します。</p><button type="button" class="social-button primary" data-social="banned-recheck">接続を再確認</button></section>';}
function markAccountAccessChanged(message){
 if(!s.identity)return;accountEpoch++;s.accountBanned=null;s.accountAccessPending={playerId:String(s.identity.id),message:message||'利用状態が変わったため、最新の保存と権限を確認しています。'};
 clearPrivate();s.user=null;s.friends=[];s.requests=[];s.unreadMail=s.unreadLetters=0;s.tab='profile';clearTimeout(pollTimer);pollTimer=null;
 global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.dispose?.();global.SengokuModeration?.refreshIdentity?.();global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();
 if(body)render();header();global.SengokuCloudSync?.invalidateAccountAccess?.(s.accountAccessPending);
}
function markAccountBanned(user,message){
 const id=String(user?.id||s.identity?.id||'');if(!s.identity||id!==String(s.identity.id))throw staleIdentity();
 const first=s.accountBanned?.playerId!==id;
 s.user={...(String(s.user?.id)===id?s.user:{}),...user,id,isBanned:true,isAdmin:false,isStaff:false};
 s.accountBanned={playerId:id,message:message||s.accountBanned?.message||'この領主は利用を停止されています。'};s.accountAccessPending=null;
 if(first){accountEpoch++;clearPrivate();s.friends=[];s.requests=[];s.unreadMail=s.unreadLetters=0;s.onlinePlayers=[];s.onlineLoaded=false;s.onlineCursor=null;s.tab='profile';clearTimeout(pollTimer);pollTimer=null;global.SengokuTrade?.dispose?.();}
 global.SengokuLetters?.refreshIdentity?.();global.SengokuModeration?.refreshIdentity?.();global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();
 if(body)render();header();
 if(first)global.SengokuBridge?.toast?.(s.accountBanned.message,true);
}
function observeContentRevision(value){
 if(!Number.isSafeInteger(value)||value<0)return true;
 if(s.contentRevision!==null&&value<s.contentRevision)return false;
 if(s.contentRevision===value)return true;
 const changed=s.contentRevision!==null||s.chats.size>0;s.contentRevision=value;
 if(changed){contentEpoch++;s.chats.clear();const list=$('#social-message-list');if(list){list.innerHTML='';if(list.dataset)delete list.dataset.signature;}renderMessages();}
 global.SengokuLetters?.observeContentRevision?.(value);return true;
}
function canShowOperatorRecovery(){return s.management?.recoveryAvailable===true&&s.connected===true&&!recoveryHeld&&Boolean(s.identity)&&s.user?.isAdmin===true&&String(s.user.id)===String(s.identity.id)&&s.management.playerId===String(s.identity.id);}
function refreshOperatorRecoveryAccess(){
 const allowed=canShowOperatorRecovery(),host=$('[data-operator-recovery]');
 if(!allowed){const input=host?.querySelector('[name=key]');if(input)input.value='';if(host)host.textContent='';if(!s.identity||s.user?.isAdmin!==true||String(s.user.id)!==String(s.identity.id)||recoveryHeld)adminRecoveryRequestId=null;}
 else if(host&&!host.querySelector('#social-admin-recovery-form'))host.innerHTML=recoveryTools().operatorRecoveryForm();
}
function connected(value){s.connected=value;if(!value)global.SengokuPremiumRuntime?.disconnect?.();refreshOperatorRecoveryAccess();header();}
async function api(route,{method='GET',data,auth=true,token,background=false,keepalive=false,identityEpoch}={}){
 const origin=base();if(!origin)throw Error('通信機能は現在利用できません。ゲーム本体は引き続き遊べます。');
 if(s.accountBanned&&auth&&!(method==='GET'&&(route==='/me'||/^\/sync\?/.test(route))))throw accountBannedError();
 if(s.accountAccessPending&&auth&&!(method==='GET'&&(route==='/me'||/^\/sync\?/.test(route))))throw accountAccessError();
 const loadingId=!background&&method!=='GET'?global.SengokuLoading?.begin('通信を届けています…'):null;
 const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),12000);
 const headers={Accept:'application/json'};if(data!==undefined)headers['Content-Type']='application/json';
 const requestEpoch=identityEpoch??authEpoch,requestAccountEpoch=accountEpoch,requestPrivilegeEpoch=privilegeEpoch,requestAvatarEpoch=avatarMutationEpoch,requestAvatarSequence=global.SengokuAvatar?.beginRequest?.(),requestCourtSequence=global.SengokuPublicCourt?.beginRequest?.(),avatarWrite=route==='/me/avatar'&&['PUT','DELETE'].includes(method),requestNameEpoch=nameMutationEpoch,requestGuildEpoch=guildEpoch,requestGuildId=s.user?.guildId,requestGuildIconSequence=global.SengokuAllianceIcon?.beginRequest?.(),guildIconWrite=route==='/guild/icon'&&['PUT','DELETE'].includes(method),implicitIdentity=identityEpoch!==undefined||(token===undefined&&(auth||route==='/session'||route==='/devices/link'||route==='/admin/recover'));
 if(implicitIdentity&&requestEpoch!==authEpoch){controllers.delete(controller);clearTimeout(timeout);if(loadingId)global.SengokuLoading?.end(loadingId);const e=Error('接続する領主が変わったため、以前の処理を取り消しました。');e.code='STALE_IDENTITY';throw e;}
 const bearer=token??(auth?s.identity?.token:null);if(bearer)headers.Authorization=`Bearer ${bearer}`;
 try{
  const response=await fetch(origin+route,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,signal:controller.signal,credentials:'omit',cache:'no-store',keepalive});
  let result;try{result=await response.json();}catch(_){throw Error('通信の応答を読み取れませんでした。時間をおいてお試しください。');}
  if(implicitIdentity&&(requestEpoch!==authEpoch||requestAccountEpoch!==accountEpoch)){const stale=Error('接続する領主または利用状態が変わったため、以前の通信処理を取り消しました。');stale.code='STALE_IDENTITY';throw stale;}
  if((!response.ok||result.ok===false)&&result?.error?.code==='ACCOUNT_BANNED'&&implicitIdentity&&auth&&bearer===s.identity?.token){
   const first=!s.accountBanned;markAccountBanned({id:s.identity.id},result.error.message);
   if(first)global.SengokuCloudSync?.suspendAccount?.({playerId:String(s.identity.id),message:s.accountBanned.message});
   throw Object.assign(accountBannedError(),{data:result});
  }
  if((!response.ok||result.ok===false)&&result?.error?.code==='ACCOUNT_ACCESS_CHANGED'&&implicitIdentity&&auth&&bearer===s.identity?.token){markAccountAccessChanged(result.error.message);throw Object.assign(accountAccessError(),{data:result});}
  if(!response.ok||result.ok===false){const error=Error(result?.error?.message||'通信処理を完了できませんでした。');error.code=result?.error?.code;error.status=response.status;error.data=result;if(implicitIdentity&&auth&&bearer===s.identity?.token&&requestEpoch===authEpoch&&requestPrivilegeEpoch===privilegeEpoch&&s.user){if(['STAFF_CHAT_REQUIRED','STAFF_REQUIRED','ADMIN_REQUIRED'].includes(error.code))acceptUser({...s.user,isAdmin:false,isStaff:false,courtOffice:null});else if(response.status===401)acceptUser(null);else if(error.code==='GUILD_REQUIRED'&&requestGuildEpoch===guildEpoch&&String(requestGuildId)===String(s.user.guildId)&&(!data?.guildId||String(data.guildId)===String(requestGuildId)))acceptUser({...s.user,guildId:null,guildName:null,guildRole:null,guildIconVersion:null});}throw error;}
  if(implicitIdentity&&requestNameEpoch!==nameMutationEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,name:s.user.name};
  if(!avatarWrite&&implicitIdentity&&requestAvatarEpoch!==avatarMutationEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,avatarVersion:s.user.avatarVersion||null};
  if(implicitIdentity&&requestGuildEpoch!==guildEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,guildId:s.user.guildId||null,guildName:s.user.guildName||null,guildRole:s.user.guildRole||null,guildIconVersion:s.user.guildIconVersion||null};
  if(implicitIdentity&&!/^\/sync(?:[/?]|$)/.test(route)&&requestPrivilegeEpoch!==privilegeEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,isAdmin:s.user.isAdmin===true,isStaff:s.user.isStaff===true};
  if(implicitIdentity&&!observeContentRevision(result.contentRevision)){const error=Error('削除後の新しい会話を確認しています。');error.code='STALE_CONTENT';throw error;}
  global.SengokuAvatar?.observe?.(result,{requestSequence:avatarWrite?undefined:requestAvatarSequence,pinnedUser:!avatarWrite&&implicitIdentity&&requestAvatarEpoch!==avatarMutationEpoch?s.user:null});
  // A guild-icon mutation is accepted only by its still-current editor callback.
  // Do not let a closed, demoted or switched editor update the public registry.
  if(!guildIconWrite)global.SengokuAllianceIcon?.observe?.(result,{requestSequence:requestGuildIconSequence});
  // Private commands and reads can contain a newer branch ledger than the last
  // sync poll. Install only its verified cursor before a later clock refresh.
  if(auth&&implicitIdentity&&bearer===s.identity?.token&&requestPrivilegeEpoch===privilegeEpoch&&!recoveryHeld&&!s.accountBanned&&!s.accountAccessPending&&!/^\/sync(?:[/?]|$)/.test(route))global.SengokuCloudSync?.observeBranchSnapshot?.(result);
  global.SengokuPublicCourt?.update?.(result,{requestSequence:requestCourtSequence});connected(true);return result;
 }catch(error){
  if(error.name==='AbortError')throw Error('通信が混み合っています。少し待って、もう一度お試しください。');
  if(error instanceof TypeError){connected(false);throw Error('通信に接続できません。通信環境を確認してください。');}throw error;
 }finally{clearTimeout(timeout);controllers.delete(controller);if(loadingId)global.SengokuLoading?.end(loadingId);}
}
async function act(key,button,work){if(busy.has(key))return;busy.add(key);if(button)button.disabled=true;try{await work();}catch(e){if(e.code!=='STALE_IDENTITY')toast(e.message||'処理を完了できませんでした。',true);}finally{busy.delete(key);if(button?.isConnected)button.disabled=false;}}
function empty(title,detail,kind='chat'){return `<div class="social-empty">${icon(kind)}<h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`;}
function header(){
 if(!dialog)return;const status=$('#social-connection');if(status){status.textContent=s.accountBanned?'利用停止中':s.accountAccessPending?'再確認中':s.user?(s.connected?'接続中':'通信未接続'):'登録は任意です';status.classList.toggle('online',Boolean(s.user&&s.connected));}
 const count=$('#social-online-count');if(count)count.textContent=s.configLoaded?`接続中 ${num(s.config.onlineCount)} 人`:'城主たちの集う場所';
 const totalUnread=s.unreadMail+s.unreadLetters,badge=launcher?.querySelector('.social-unread');if(badge){badge.textContent=totalUnread>99?'99+':String(totalUnread);badge.hidden=!totalUnread;}launcher?.setAttribute('aria-label',totalUnread?`交流の間を開く（未読 ${num(totalUnread)} 件）`:'交流の間を開く');
 const lettersBadge=$('[data-social-tab="letters"] .social-tab-count');if(lettersBadge)lettersBadge.textContent=s.unreadLetters?String(s.unreadLetters):'';
 const mailBadge=$('[data-social-tab="mail"] .social-tab-count');if(mailBadge)mailBadge.textContent=s.unreadMail?String(s.unreadMail):'';
}
function renderAnnouncement(){
 if(!announcement)return;const notice=String(s.config.announcement??DEFAULT).slice(0,300),news=s.achievements.events.slice(0,3).map(e=>`${playerName(e.playerName,e.playerEvaluation,e.playerId,e.playerAppearance,e.avatarVersion)}：${esc(e.title)}`),html=[esc(notice),...news].filter(Boolean).join('　◆　'),line=announcement.querySelector('.social-announcement-text');if(line.innerHTML!==html)line.innerHTML=html;
 announcement.hidden=s.configLoaded&&html.length===0;announcement.classList.toggle('is-paused',s.paused);const button=announcement.querySelector('.social-announcement-toggle');button.innerHTML=icon(s.paused?'play':'pause');button.setAttribute('aria-label',s.paused?'お知らせのスクロールを再開':'お知らせのスクロールを停止');button.setAttribute('aria-pressed',String(s.paused));
}
function tabs(){if(s.accountBanned||s.accountAccessPending)return[{id:'profile',label:s.accountBanned?'利用停止':'利用状態',icon:'shield'}];return[{id:'world',label:'世界',icon:'chat'},{id:'news',label:'御触書',icon:'flag'},{id:'online',label:'接続一覧',icon:'people'},{id:'sync',label:'端末同期',icon:'refresh'},{id:'recovery',label:'引き継ぎ',icon:'upload'},{id:'guild',label:'同盟',icon:'flag'},{id:'guild-rankings',label:'同盟順位',icon:'flag'},{id:'friends',label:'フレンド',icon:'people'},{id:'letters',label:'書状',icon:'mail'},{id:'trade',label:'交易',icon:'refresh'},{id:'mail',label:'郵便',icon:'mail'},{id:'profile',label:'領主',icon:'user'},...(hasAdminChat()?[{id:'admin',label:s.user.isAdmin?'運営':'運営チャット',icon:'shield'},{id:'recent-logins',label:'ログイン履歴',icon:'people'}]:[])];}

// Public records are emitted by accepted server transitions. No local log text
// or private chat, treasury balance, or login history is ever sent to this feed.
function cleanAchievement(event){
 if(!event||!['string','number'].includes(typeof event.id)||typeof event.id==='number'&&(!Number.isSafeInteger(event.id)||event.id<0)||typeof event.playerName!=='string'||!event.playerName.trim()||typeof event.title!=='string'||!event.title.trim()||typeof event.occurredAt!=='string'||!Number.isFinite(Date.parse(event.occurredAt)))return null;
 const id=String(event.id);if(!id.trim()||id.length>180||/[\u0000-\u001f\u007f]/.test(id))return null;
 const text=(value,max)=>String(value??'').slice(0,max);
 return{id,playerId:typeof event.playerId==='string'&&event.playerId.length<=180&&!/[\u0000-\u001f\u007f]/.test(event.playerId)?event.playerId:null,playerEvaluation:publicEvaluation(event.playerEvaluation),playerAppearance:global.SengokuPremiumRuntime?.cleanAppearance?.(event.playerAppearance)||null,avatarVersion:typeof(event.avatarVersion??event.playerAvatarVersion)==='string'&&/^[a-f0-9]{64}$/.test(event.avatarVersion??event.playerAvatarVersion)?(event.avatarVersion??event.playerAvatarVersion):null,playerName:text(event.playerName,40),clan:text(event.clan,30),kind:text(event.kind,40),title:text(event.title,180),detail:text(event.detail,300),occurredAt:new Date(event.occurredAt).toISOString()};
}
function achievementTime(value){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function achievementRows(){
 if(!s.achievements.loaded&&!s.achievements.events.length)return empty('達成の知らせを確認しています','領主たちの戦果がここに届きます。','flag');
 if(!s.achievements.events.length)return empty('達成の知らせはまだありません','これから記録された領主の戦果や発展を表示します。','flag');
 return s.achievements.events.map(e=>`<article class="social-achievement" data-event-id="${esc(e.id)}"><span class="social-achievement-seal" aria-hidden="true">${icon(e.kind.includes('cycle')?'gift':e.kind.includes('research')?'shield':'flag')}</span><div><div class="social-achievement-meta"><strong>${playerName(e.playerName,e.playerEvaluation,e.playerId,e.playerAppearance,e.avatarVersion)}</strong>${e.clan?`<span>${esc(e.clan==='德川家'?'徳川家':e.clan)}</span>`:''}<time datetime="${esc(e.occurredAt)}">${esc(achievementTime(e.occurredAt))}</time></div><h3>${esc(e.title)}</h3>${e.detail?`<p>${esc(e.detail)}</p>`:''}</div></article>`).join('');
}
function achievementsView(){return `<section class="social-news"><div class="social-section-heading"><div><span class="social-eyebrow">天下に届く知らせ</span><h2>御触書・領主の達成</h2><p>領主の名前と成し遂げたことをお届けします。30秒ごとに更新・日本時間。</p></div><button class="social-icon-button" data-social="news-refresh" aria-label="御触書を更新">${icon('refresh')}</button></div><section class="social-news-notice"><h3>サイトからのお知らせ</h3><p id="social-news-notice-text">${esc(s.config.announcement||'現在、サイトからのお知らせはありません。')}</p></section><p id="social-news-status" class="social-small" role="status">${esc(s.achievements.error||'')}</p><div id="social-achievement-list" class="social-achievement-list">${achievementRows()}</div><div class="social-center"><button class="social-button" id="social-news-more" data-social="news-more" ${s.achievements.cursor?'':'hidden'}>以前の知らせを見る</button></div></section>`;}
function refreshAchievementView(){
 renderAnnouncement();if(!s.open||s.tab!=='news')return;
 const list=$('#social-achievement-list'),status=$('#social-news-status'),more=$('#social-news-more'),notice=$('#social-news-notice-text');
 if(notice)notice.textContent=s.config.announcement||'現在、サイトからのお知らせはありません。';
 if(status)status.textContent=s.achievements.error||'';
 if(more){more.hidden=!s.achievements.cursor;more.disabled=achievementBusy;}
 if(!list)return;const html=achievementRows();if(list.innerHTML===html)return;
 const top=body?.scrollTop||0,bodyTop=body?.getBoundingClientRect?.().top||0,anchor=top>20?[...list.querySelectorAll('[data-event-id]')].find(el=>el.getBoundingClientRect().bottom>bodyTop):null,anchorId=anchor?.dataset.eventId,anchorTop=anchor?.getBoundingClientRect().top;
 list.innerHTML=html;
 if(body){const replacement=anchorId?[...list.querySelectorAll('[data-event-id]')].find(el=>el.dataset.eventId===anchorId):null;body.scrollTop=top+(replacement?replacement.getBoundingClientRect().top-anchorTop:0);}
}
async function loadAchievements({more=false}={}){
 if(disposed||document.hidden||achievementBusy||more&&!s.achievements.cursor)return;
 achievementBusy=true;clearTimeout(achievementTimer);achievementTimer=null;const generation=achievementGeneration,cursor=more?s.achievements.cursor:null;
 try{
  const params=new URLSearchParams({limit:'20'});if(cursor)params.set('cursor',cursor);
  const r=await api('/achievements?'+params,{auth:false,background:true});if(disposed||generation!==achievementGeneration)return;
  if(!Array.isArray(r.events))throw Error('達成の知らせを確認できませんでした。');
  const events=r.events.map(cleanAchievement).filter(Boolean),combined=more?[...events,...s.achievements.events]:s.achievements.expanded?[...s.achievements.events,...events]:events;
  s.achievements.events=[...new Map(combined.map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)).slice(0,200);applyPlayerEvaluations(events.map(event=>({playerId:event.playerId,evaluation:event.playerEvaluation,appearance:event.playerAppearance})));
  if(more||!s.achievements.expanded)s.achievements.cursor=typeof r.nextCursor==='string'?r.nextCursor:null;
  if(more)s.achievements.expanded=true;
  if(s.achievements.events.length>=200)s.achievements.cursor=null;
  s.achievements.serverNow=r.serverNow||null;s.achievements.loaded=true;s.achievements.error='';
 }catch(error){if(generation===achievementGeneration&&!disposed)s.achievements.error='知らせを更新できませんでした。通信が戻ると再確認します。';}
 finally{if(generation===achievementGeneration&&!disposed){achievementBusy=false;refreshAchievementView();if(!document.hidden)achievementTimer=setTimeout(loadAchievements,30000);}}
}
function renderTabs(){const nav=$('#social-tabs');if(nav)nav.innerHTML=tabs().map(t=>`<button type="button" role="tab" aria-selected="${s.tab===t.id}" data-social-tab="${t.id}" class="${s.tab===t.id?'active':''}">${icon(t.icon)}${t.label}${['mail','letters'].includes(t.id)?`<span class="social-tab-count">${(t.id==='letters'?s.unreadLetters:s.unreadMail)||''}</span>`:''}</button>`).join('');}
function registerView(){
 const clan=String(global.SengokuBridge?.getState?.()?.clan||'浪人');
 const recoveryIntro=`<section class="domain-recovery-card"><span class="domain-recovery-step">以前の領主の方へ</span><h3>サイト移転後も、同じ領主で続ける</h3><p>新しいアドレスでは、以前のブラウザ保存は自動で引き継がれません。接続コード、領主データ、または統合バックアップから再接続できます。</p><button class="social-button primary" data-social="recovery-open">引き継ぎ・データ復元を開く</button></section>`;
 const registration=s.meLoading?'<div class="social-notice">領主情報を確認しています…</div>':s.identity?'<div class="social-notice">保存されている領主との接続を確認してください。新しい領主で始める場合は、この端末の接続を解除してください。</div>':`<details class="domain-recovery-new"><summary>初めての方：新しく領主を登録する</summary><form id="social-register-form" class="social-register-form"><label for="social-register-name">交流で表示する名前</label><input id="social-register-name" name="name" minlength="1" autocomplete="nickname" placeholder="領主名（1〜24文字）" required><input name="clan" type="hidden" value="${esc(clan)}"><button class="social-button primary" type="submit" ${!base()?'disabled':''}>${icon('chat')}新しい領主で接続</button></form></details>`;
 return `<div class="social-welcome"><div class="social-welcome-seal">交</div><div class="social-eyebrow">THE COMMON ROOM</div><h2>領主たちと、言葉を交わす。</h2><p>世界の会話、仲間との同盟、友との文。</p></div>${recoveryIntro}${registration}<div class="social-notice">登録は任意です。交流にはインターネット接続が必要です。領主の認証情報はこのブラウザに保存され、同じ領主の端末で進行を自動同期します。</div>${s.error?`<div class="social-feedback is-error">${esc(s.error)}</div>`:''}${!base()?'<div class="social-feedback is-error">通信機能は現在準備中です。城下町はそのままお楽しみいただけます。</div>':''}${s.identity?'<div class="social-center"><button class="social-text-button" data-social="reconnect">接続を確認する</button><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>':''}`;
}
function channel(){
 if(!s.user||s.accountBanned)return null;
 if(s.tab==='world')return{channel:'world',target:null,title:'世界の広場',caption:'すべての領主が集う、開かれた会話です。'};
 if(s.tab==='guild'&&s.user.guildId&&s.guildSection==='chat')return{channel:'guild',target:null,title:s.user.guildName||'同盟',caption:'この同盟の仲間だけが読める会話です。'};
 if(s.tab==='friends'&&s.friendId&&s.friends.some(f=>String(f.id)===String(s.friendId)))return{channel:'friend',target:s.friendId,title:s.friends.find(f=>String(f.id)===String(s.friendId))?.name||'友との文',player:s.friends.find(f=>String(f.id)===String(s.friendId)),caption:'選んだフレンドと二人で話します。'};
 if(s.tab==='admin'&&hasAdminChat()&&s.adminSection==='chat')return{channel:'admin',target:null,title:'運営の控え間',caption:'運営と任命されたスタッフが参加する、連絡用の会話です。'};return null;
}
function chatKey(c){return `${c.channel}:${c.target||(c.channel==='guild'?s.user?.guildId:'')||''}`;}
function chatView(c){return `<section class="social-chat"><div class="social-section-heading"><div><h3 data-social-chat-title>${c.player?playerName(c.player.name,c.player.evaluation,c.player.id,c.player.appearance,c.player.avatarVersion):esc(c.title)}</h3><p>${esc(c.caption)}</p></div><span class="social-small">5秒ごとに更新</span></div>${['guild','admin'].includes(c.channel)?'<div id="social-voice-room"></div>':''}<div id="social-message-list" class="social-message-list" role="log" aria-live="polite" aria-relevant="additions text"></div><form id="social-chat-form" class="social-chat-form"><label class="social-sr-only" for="social-chat-input">メッセージ</label><textarea id="social-chat-input" name="text" rows="2" maxlength="300" placeholder="言葉を交わす…（300文字まで）" required></textarea><div class="social-chat-form-bottom"><span>Enterで送信 · Shift+Enterで改行</span><button type="submit" class="social-button primary">${icon('send')}送信</button></div></form></section>`;}
function renderMessages(){
 const c=channel(),list=$('#social-message-list');if(!c||!list)return;const cache=s.chats.get(chatKey(c)),messages=cache?.messages||[],nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,oldTop=list.scrollTop;
 if(!cache){list.innerHTML=empty('会話を読み込んでいます','しばらくお待ちください。');return;}
 if(!messages.length){if(list.dataset)delete list.dataset.signature;list.innerHTML=empty('まだ、言葉は届いていません','最初のひと言から、交流を始めましょう。');return;}
 const signature=JSON.stringify(messages.map(m=>[m.id,m.text,m.name,m.isAdmin===true,m.isStaff===true,m.avatarVersion||'',evaluationKey(m.evaluation),m.appearance||null,s.contentRevision]));if(list.dataset.signature===signature)return;
 list.innerHTML=messages.map(m=>`<article class="social-message ${String(m.userId)===String(s.user.id)?'own':''}">${socialAvatar({...m,id:m.userId})}<div class="social-message-content"><div class="social-message-meta"><strong>${playerName(m.name,m.evaluation,m.userId,m.appearance,m.avatarVersion,false)}</strong>${role(m)}<time>${esc(date(m.createdAt))}</time></div><p>${esc(m.text)}</p></div></article>`).join('');list.dataset.signature=signature;
 if(nearBottom||!cache.rendered)list.scrollTop=list.scrollHeight;else list.scrollTop=oldTop;cache.rendered=true;
}
function guildContext(){if(!s.user?.guildId||!s.identity)throw Error('同盟に所属すると利用できます。');return{guildId:String(s.user.guildId),owner:String(s.identity.id),epoch:authEpoch,guildEpoch,role:s.user.guildRole||'member'};}
function guildCurrent(c){return Boolean(c&&c.epoch===authEpoch&&c.guildEpoch===guildEpoch&&c.owner===String(s.identity?.id)&&c.guildId===String(s.user?.guildId)&&!disposed);}
function requireGuildContext(c){if(!guildCurrent(c)){const error=Error('所属同盟または役職が変わりました。現在の内容を確認して操作し直してください。');error.code='STALE_GUILD';throw error;}}
function canManageGuildMember(target,action){if(!s.user?.guildId||!target||String(target.id)===String(s.user.id)||(target.guildRole||'member')==='owner')return false;return action==='role'?s.user.guildRole==='owner':s.user.guildRole==='owner'||s.user.guildRole==='officer'&&(target.guildRole||'member')==='member';}
function guildMemberRows(){return s.members.length?s.members.map(p=>`<article class="social-guild-member" data-stable-key="guild-member-${esc(p.id)}"><div class="social-guild-member-person">${socialAvatar(p,'small')}<div><h3>${playerName(p.name,p.evaluation,p.id,p.appearance,p.avatarVersion,false)} ${role(p)}</h3><p>${esc(p.clan==='德川家'?'徳川家':p.clan||'浪人')} · <span class="guild-role guild-role-${['owner','officer'].includes(p.guildRole)?p.guildRole:'member'}">${guildRoleName(p.guildRole)}</span>${String(p.id)===String(s.user.id)?' · あなた':''}</p></div></div><div class="social-guild-member-actions">${canManageGuildMember(p,'role')?`<button class="social-button small" data-social="guild-member-role" data-id="${esc(p.id)}" data-role="${p.guildRole==='officer'?'member':'officer'}">${p.guildRole==='officer'?'メンバーに戻す':'副盟主に任命'}</button>`:''}${canManageGuildMember(p,'remove')?`<button class="social-button small subtle" data-social="guild-member-remove" data-id="${esc(p.id)}">除名</button>`:''}</div></article>`).join(''):empty('メンバーを確認しています','しばらくお待ちください。','people');}
function refreshGuildMembers(){const node=$('#social-guild-members');if(!node||s.tab!=='guild'||s.guildSection!=='members'||s.confirm)return;const html=guildMemberRows();if(node.dataset?.signature===html)return;const focused=document.activeElement,key=node.contains?.(focused)?{action:focused.dataset.social,id:focused.dataset.id,role:focused.dataset.role}:null,top=body?.scrollTop||0;if(global.SengokuStableDOM)global.SengokuStableDOM.patch(node,html);else node.innerHTML=html;if(node.dataset)node.dataset.signature=html;if(key)[...node.querySelectorAll('[data-social]')].find(el=>el.dataset.social===key.action&&el.dataset.id===key.id&&el.dataset.role===key.role)?.focus({preventScroll:true});if(body)body.scrollTop=top;}
function guildView(){
 if(s.user.guildId){const sections=[['chat','同盟会話'],['members','役職・メンバー'],['treasury','共有金庫']];if(!sections.some(([id])=>id===s.guildSection))s.guildSection='chat';return `<div class="social-guild-heading"><div class="social-guild-mon" id="social-guild-icon">${guildIcon(guildIconEntity(),'profile')}</div><div><span class="social-eyebrow">YOUR ALLIANCE</span><h2 id="social-guild-heading-name">${esc(s.user.guildName)}</h2><p id="social-guild-heading-summary">${s.guild?`${num(s.guild.memberCount)} / ${num(s.guild.maxMembers||50)} 人`:'仲間と歩む天下への道'} · あなたは${guildRoleName(s.user.guildRole)}</p></div><button class="social-button subtle" data-social="guild-leave">脱退</button></div><div class="social-guild-subtabs" role="tablist" aria-label="同盟内の画面">${sections.map(([id,label])=>`<button type="button" role="tab" aria-selected="${s.guildSection===id}" class="${s.guildSection===id?'active':''}" data-social="guild-section" data-id="${id}">${label}</button>`).join('')}</div>${s.guildSection==='treasury'?guildTreasuryView():s.guildSection==='members'?`${s.user.guildRole==='owner'?'<div id="social-guild-icon-editor" class="social-alliance-icon-editor"></div>':''}<div class="social-section-heading"><div><h3>役職とメンバー</h3><p>盟主は副盟主の任命・解除ができます。盟主と副盟主は通常メンバーを除名でき、副盟主は盟主・他の副盟主を除名できません。</p></div><button class="social-icon-button" data-social="guild-refresh" aria-label="メンバーを更新">${icon('refresh')}</button></div><div id="social-guild-members" class="social-guild-members">${guildMemberRows()}</div><p class="social-guild-note">同盟内の役職は、この同盟の管理に使います。同盟の役職はこの同盟内だけで使います。</p>`:chatView(channel())}`;}
 return `<div class="social-section-heading"><div><h2>志を同じくする仲間と。</h2><p>会話、共有金庫、役職で仲間と力を合わせます。</p></div><button class="social-icon-button" data-social="guild-refresh" aria-label="同盟一覧を更新">${icon('refresh')}</button></div><button class="social-button" data-social="guild-rankings-open">${icon('flag')}同盟順位を見る</button><form id="social-guild-create-form" class="social-inline-form"><label class="social-sr-only" for="social-guild-name">新しい同盟名</label><input id="social-guild-name" name="name" minlength="2" maxlength="24" placeholder="新しい同盟名（2〜24文字）" required><button class="social-button" type="submit">${icon('flag')}創設する</button></form><div class="social-card-list">${s.guilds.length?s.guilds.map(g=>`<article class="social-list-card">${guildIcon(g)}<div><h3>${esc(g.name)}</h3><p>盟主 ${playerName(g.ownerName,g.ownerEvaluation,g.ownerId,g.ownerAppearance,g.ownerAvatarVersion)} · ${num(g.memberCount)} / ${num(g.maxMembers||50)} 人</p></div><button class="social-button small" data-social="guild-join" data-id="${esc(g.id)}" ${g.memberCount>=g.maxMembers?'disabled':''}>参加</button></article>`).join(''):empty('新しい旗を立てよう','参加できる同盟はまだありません。あなたの同盟を創設できます。','flag')}</div>`;
}
function guildMemberConfirmation(targetId,action,nextRole){
 const context=guildContext(),target=s.members.find(p=>String(p.id)===String(targetId));if(!canManageGuildMember(target,action)||action==='role'&&!['officer','member'].includes(nextRole))throw Error('現在の役職では、このメンバーへの操作はできません。');
 const removing=action==='remove',payload={guildId:context.guildId,targetPlayerId:target.id,requestId:crypto.randomUUID(),...(!removing?{role:nextRole}:{})};
 return{scope:'guild',title:removing?'このメンバーを除名しますか':nextRole==='officer'?'副盟主に任命しますか':'副盟主の役職を解除しますか',description:removing?'この領主は同盟の会話・共有金庫を利用できなくなります。':nextRole==='officer'?'副盟主は通常メンバーを除名できます。共有金庫は全メンバーが利用できます。':'メンバーとして会話・共有金庫を引き続き利用できます。',details:`<dl class="social-confirm-details"><dt>同盟</dt><dd>${esc(s.user.guildName)}</dd><dt>領主</dt><dd>${playerName(target.name,target.evaluation,target.id,target.appearance,target.avatarVersion)}</dd><dt>現在の役職</dt><dd>${guildRoleName(target.guildRole)}</dd></dl>`,confirmLabel:removing?'このメンバーを除名':nextRole==='officer'?'副盟主に任命':'メンバーに戻す',danger:removing,onConfirm:async()=>{
  requireGuildContext(context);const current=s.members.find(p=>String(p.id)===String(target.id));if(!canManageGuildMember(current,action))throw Error('役職と対象メンバーを確認し直してください。');
  let result;try{result=await api(removing?'/guild/members/remove':'/guild/members/role',{method:'POST',data:payload});}catch(error){if(error.code==='GUILD_ROLE_REQUIRED'||error.code==='GUILD_MEMBER_NOT_FOUND'){await loadMe();await loadGuild();}throw error;}requireGuildContext(context);
  clearGuildData({resetSection:false});if(result.user)acceptUser(result.user);if(String(s.user?.guildId)===context.guildId){s.guild=result.guild||null;s.members=result.members||[];}clearConfirm();render();toast(removing?'メンバーを除名しました。':nextRole==='officer'?'副盟主に任命しました。':'メンバーに戻しました。');
 }};
}
function guildLeaveConfirmation(){const context=guildContext();return{scope:'guild',title:`${s.user.guildName} を脱退しますか`,description:s.user.guildRole==='owner'?'仲間が残る場合は盟主を引き継ぎます。最後の一人で共有金庫に資産が残っている場合は、先に金庫を空にしてください。':'脱退すると、この同盟の会話・共有金庫を利用できなくなります。',confirmLabel:'脱退する',danger:true,onConfirm:async()=>{requireGuildContext(context);const result=await api('/guild/leave',{method:'POST',data:{guildId:context.guildId}});requireGuildContext(context);acceptUser(result.user||{...s.user,guildId:null,guildName:null,guildRole:null,guildIconVersion:null});await loadMe();await loadGuild();render();toast('同盟を脱退しました。');}};}
function personalGuildResource(resource){const game=global.SengokuBridge?.getState?.();return Math.max(0,Number(resource==='magatama'?game?.magatama:game?.resources?.[resource])||0);}
function guildBalances(){return Object.entries(RES).map(([key,label])=>`<div><span>${label}</span><strong>${s.guildTreasury.loaded?num(s.guildTreasury.balance?.[key]):'—'}</strong></div>`).join('');}
function guildLedgerRows(){const t=s.guildTreasury;if(!t.ledger.length)return empty(t.loaded?'出し入れの記録はまだありません':'共有金庫を読み込んでいます',t.loaded?'同盟のメンバーが出し入れすると、ここに記録されます。':'しばらくお待ちください。','gift');return t.ledger.map(entry=>`<article class="social-guild-ledger-entry"><div><strong>${playerName(entry.name||'領主',entry.playerEvaluation,entry.playerId,entry.appearance,entry.avatarVersion)}</strong><p>${entry.direction==='deposit'?'金庫に預け入れ':'金庫から受け取り'} · ${esc(RES[entry.resource]||entry.resource)}</p></div><b class="${entry.direction==='deposit'?'is-deposit':'is-withdraw'}">${entry.direction==='deposit'?'+':'−'}${num(entry.amount)}</b><time datetime="${esc(entry.createdAt)}">${esc(loginDate(entry.createdAt))}<small>JST</small></time></article>`).join('');}
function guildTransferAvailable(){const sync=global.SengokuCloudSync?.getStatus?.();return Boolean(s.user?.guildId&&s.guildTreasury.loaded&&String(s.guildTreasury.guildId)===String(s.user.guildId)&&global.SengokuBridge?.hasStarted?.()!==false&&typeof global.SengokuBridge?.guildTransfer==='function'&&sync?.linked&&sync.ready&&sync.writable);}
function guildTreasuryView(){return `<section class="social-guild-treasury"><div class="social-section-heading"><div><h3>みんなの共有金庫</h3><p>全メンバーが資源・勾玉を預け入れ、受け取って使用できます。</p></div><button class="social-icon-button" data-social="guild-treasury-refresh" aria-label="共有金庫を更新">${icon('refresh')}</button></div><div id="social-guild-balances" class="social-guild-balances">${guildBalances()}</div><form id="social-guild-transfer-form" class="social-guild-transfer-form"><label>操作<select name="direction" id="social-guild-direction"><option value="deposit">金庫へ預ける</option><option value="withdraw">受け取って使用</option></select></label><label>資産<select name="resource" id="social-guild-resource">${Object.entries(RES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>数量<input name="amount" type="number" min="1" max="1000000" step="1" value="100" inputmode="numeric" required></label><button id="social-guild-transfer-confirm" class="social-button primary" type="submit" ${!guildTransferAvailable()?'disabled':''}>出し入れを確認</button></form><p id="social-guild-personal-balance" class="social-guild-note"></p><p class="social-guild-note">出し入れは共有金庫とあなたの所持数へ同時に反映し、端末間で同期します。1回につき1〜1,000,000。金庫の資産と記録は所属メンバーだけが確認できます。</p><p id="social-guild-treasury-status" class="social-guild-status" role="status">${esc(s.guildTreasury.error||(!guildTransferAvailable()?'操作できる端末と保存・同期の状態を確認しています。':''))}</p><div class="social-section-heading"><div><h3>出し入れの記録</h3><p>日本時間 JST · 新しい記録から表示 · 30秒ごとに更新</p></div></div><div id="social-guild-ledger" class="social-guild-ledger">${guildLedgerRows()}</div><div class="social-actions"><button id="social-guild-ledger-more" class="social-button" data-social="guild-treasury-more" ${!s.guildTreasury.cursor?'hidden':''}>記録の続きを表示</button></div></section>`;}
function refreshGuildTreasuryView({rows=false}={}){if(s.tab!=='guild'||s.guildSection!=='treasury'||!s.user?.guildId||s.confirm)return;const t=s.guildTreasury,balances=$('#social-guild-balances'),ledger=$('#social-guild-ledger'),status=$('#social-guild-treasury-status'),more=$('#social-guild-ledger-more'),submit=$('#social-guild-transfer-confirm'),personal=$('#social-guild-personal-balance'),resource=$('#social-guild-resource')?.value||'gold';if(balances)balances.innerHTML=guildBalances();if(ledger&&rows){const top=body?.scrollTop||0;ledger.innerHTML=guildLedgerRows();if(body)body.scrollTop=top;}if(status){status.textContent=t.error||(treasuryBusy?'共有金庫を更新しています…':!guildTransferAvailable()?'この端末で保存・同期できる状態になると出し入れできます。':'');status.classList.toggle('is-error',Boolean(t.error));}if(more){if(!t.cursor&&document.activeElement===more)$('[data-social="guild-treasury-refresh"]')?.focus({preventScroll:true});more.hidden=!t.cursor;more.setAttribute('aria-disabled',String(treasuryBusy));}if(submit)submit.disabled=!guildTransferAvailable();if(personal)personal.textContent=`あなたの所持：${RES[resource]} ${num(personalGuildResource(resource))} · 共有金庫：${t.loaded?num(t.balance?.[resource]):'確認中'}`;}
function guildTransferConfirmation(values){const context=guildContext(),direction=values.direction,resource=values.resource,amount=Number(values.amount);if(!['deposit','withdraw'].includes(direction)||!Object.hasOwn(RES,resource)||!Number.isSafeInteger(amount)||amount<1||amount>1000000)throw Error('資産と数量を確認してください。数量は1〜1,000,000の整数です。');if(!guildTransferAvailable())throw Error('この端末でゲームを保存・同期できる状態を確認してください。');const available=direction==='deposit'?personalGuildResource(resource):Number(s.guildTreasury.balance?.[resource])||0;if(amount>available)throw Error(direction==='deposit'?'あなたの所持数が不足しています。':'共有金庫の残高が不足しています。');const payload=Object.freeze({guildId:context.guildId,direction,resource,amount,requestId:crypto.randomUUID()});return{scope:'guild',title:direction==='deposit'?'共有金庫へ預けますか':'金庫から受け取って使用しますか',description:direction==='deposit'?'あなたの所持数から共有金庫へ移します。同盟の全メンバーが利用できる資産になります。':'共有金庫からあなたの所持数へ移します。受け取った資産はゲーム内で使用できます。',details:`<dl class="social-confirm-details"><dt>同盟</dt><dd>${esc(s.user.guildName)}</dd><dt>資産</dt><dd>${RES[resource]} ${num(amount)}</dd><dt>操作</dt><dd>${direction==='deposit'?'金庫へ預ける':'受け取って使用'}</dd></dl>`,confirmLabel:direction==='deposit'?'この数量を預ける':'受け取って使用',onConfirm:async()=>{requireGuildContext(context);if(!guildTransferAvailable())throw Error('保存・同期の状態をもう一度確認してください。');const result=await global.SengokuBridge.guildTransfer(payload);requireGuildContext(context);if(!result?.ok)throw Error(result?.message||'出し入れの結果を確認できませんでした。同じ確認画面から再試行できます。');clearConfirm();await loadGuildTreasury();refreshGuildTreasuryView({rows:true});toast(`${RES[resource]} ${num(amount)}を${direction==='deposit'?'共有金庫へ預けました。':'受け取りました。'}`);}};}
function scheduleGuildLists(){clearTimeout(guildListTimer);guildListTimer=null;if(!disposed&&!document.hidden&&s.open&&(s.tab==='guild-rankings'||s.tab==='guild'&&s.guildSection==='treasury'&&s.user?.guildId))guildListTimer=setTimeout(()=>refresh({silent:true}),30000);}
async function loadGuildTreasury({more=false}={}){
 if(disposed||document.hidden||!s.open||s.tab!=='guild'||s.guildSection!=='treasury'||!s.user?.guildId||treasuryBusy||more&&!s.guildTreasury.cursor)return;
 const context=guildContext(),generation=++guildListGeneration,cursor=more?s.guildTreasury.cursor:null;treasuryBusy=true;clearTimeout(guildListTimer);guildListTimer=null;s.guildTreasury.error='';refreshGuildTreasuryView();
 const current=()=>guildCurrent(context)&&generation===guildListGeneration&&s.open&&!document.hidden&&s.tab==='guild'&&s.guildSection==='treasury';
 try{const r=await api('/guild/treasury?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{background:true});if(!current())return;if(String(r.guildId)!==context.guildId||!r.treasury||!Array.isArray(r.ledger))throw Error('共有金庫の所属と内容を確認できませんでした。');const rows=more?[...s.guildTreasury.ledger,...r.ledger]:r.ledger;s.guildTreasury={guildId:context.guildId,balance:r.treasury,ledger:[...new Map(rows.map(entry=>[String(entry.id),entry])).values()],cursor:r.nextCursor||null,loaded:true,error:'',serverNow:r.serverNow||null};refreshGuildTreasuryView({rows:true});}
 catch(error){if(current()&&error.code!=='STALE_IDENTITY'){s.guildTreasury.error=error.message||'共有金庫を読み込めませんでした。';refreshGuildTreasuryView({rows:true});}}
 finally{if(current()){treasuryBusy=false;refreshGuildTreasuryView();scheduleGuildLists();}}
}
function guildRankingRows(){const r=s.guildRankings;return r.guilds.length?r.guilds.map(g=>`<article class="social-guild-rank-row"><b class="social-guild-rank-position">${num(g.rank)}<small>位</small></b><div class="social-guild-rank-name"><h3>${guildIcon(g,'small')}<span>${esc(g.name)}</span></h3><p>盟主 ${playerName(g.ownerName,g.ownerEvaluation,g.ownerId,g.ownerAppearance,g.ownerAvatarVersion)}</p></div><div class="social-guild-rank-stats"><div><span>総威信</span><strong>${num(g.totalPrestige)}</strong></div><div><span>メンバー</span><strong>${num(g.memberCount)}<small>人</small></strong></div><div><span>領有城</span><strong>${num(g.ownedCastles)}<small>城</small></strong></div></div></article>`).join(''):empty(r.loaded?'まだ順位のある同盟はありません':r.error?'同盟順位を読み込めませんでした':'同盟順位を読み込んでいます',r.loaded?'仲間と同盟を結成して、威信を高めましょう。':r.error?'更新からもう一度お試しください。':'しばらくお待ちください。','flag');}
function guildRankingsView(){return `<section class="social-guild-rankings"><div class="social-section-heading"><div><span class="social-eyebrow">ALLIANCE RANKINGS</span><h2>同盟順位</h2><p>所属プレイヤーの威信を合計した「総威信」の高い順に表示します。</p></div><button class="social-button" data-social="guild-rankings-refresh">${icon('refresh')}更新</button></div><p id="social-guild-rankings-summary" class="social-guild-note">${s.guildRankings.loaded?`${num(s.guildRankings.total)}同盟 · 更新 ${loginDate(s.guildRankings.serverNow)} JST`:'集計を確認しています。'} · 30秒ごとに更新</p><p id="social-guild-rankings-status" class="social-guild-status" role="status">${esc(s.guildRankings.error)}</p><div id="social-guild-rankings-results" class="social-guild-rankings-results">${guildRankingRows()}</div><div class="social-actions"><button id="social-guild-rankings-more" class="social-button" data-social="guild-rankings-more" ${!s.guildRankings.cursor?'hidden':''}>順位の続きを表示</button></div><p class="social-guild-note">この順位はすべてのプレイヤーが閲覧できます。共有金庫の残高・出し入れの記録は公開されません。</p></section>`;}
function refreshGuildRankingsView({rows=false}={}){if(!s.open||s.tab!=='guild-rankings'||s.confirm)return;const r=s.guildRankings,summary=$('#social-guild-rankings-summary'),status=$('#social-guild-rankings-status'),results=$('#social-guild-rankings-results'),more=$('#social-guild-rankings-more');if(summary)summary.textContent=(r.loaded?`${num(r.total)}同盟 · 更新 ${loginDate(r.serverNow)} JST`:'集計を確認しています。')+' · 30秒ごとに更新';if(status){status.textContent=r.error||(rankingsBusy?'順位を更新しています…':'');status.classList.toggle('is-error',Boolean(r.error));}if(results&&rows){const top=body?.scrollTop||0;results.innerHTML=guildRankingRows();if(body)body.scrollTop=top;}if(more){more.hidden=!r.cursor;more.setAttribute('aria-disabled',String(rankingsBusy));}}
async function loadGuildRankings({more=false}={}){if(disposed||document.hidden||!s.open||s.tab!=='guild-rankings'||rankingsBusy||more&&!s.guildRankings.cursor)return;rankingsBusy=true;clearTimeout(guildListTimer);guildListTimer=null;const generation=++guildListGeneration,cursor=more?s.guildRankings.cursor:null;const current=()=>!disposed&&!document.hidden&&s.open&&s.tab==='guild-rankings'&&generation===guildListGeneration;s.guildRankings.error='';refreshGuildRankingsView();try{const r=await api('/guild/rankings?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{auth:false,background:true});if(!current())return;if(!Array.isArray(r.guilds))throw Error('同盟順位の応答を確認できませんでした。');s.guildRankings={guilds:[...new Map((more?[...s.guildRankings.guilds,...r.guilds]:r.guilds).map(g=>[String(g.id),g])).values()].sort((a,b)=>(Number(a.rank)||0)-(Number(b.rank)||0)),total:Number(r.total)||0,cursor:r.nextCursor||null,loaded:true,error:'',serverNow:r.serverNow||new Date().toISOString()};refreshGuildRankingsView({rows:true});}catch(error){if(current()){s.guildRankings.error=error.message||'順位を読み込めませんでした。';refreshGuildRankingsView({rows:true});}}finally{if(current()){rankingsBusy=false;refreshGuildRankingsView();scheduleGuildLists();}}}

function searchForm(prefix='player'){return `<form id="social-${prefix}-search-form" class="social-inline-form"><label class="social-sr-only" for="social-${prefix}-query">領主を探す</label><input id="social-${prefix}-query" name="q" minlength="2" maxlength="24" placeholder="領主の名前で探す" required><button class="social-button" type="submit">${icon('search')}検索</button></form>`;}
function playerCards(players,mode){return players.map(p=>`<article class="social-list-card">${socialAvatar(p,'small')}<div><h3>${playerName(p.name,p.evaluation,p.id,p.appearance,p.avatarVersion,false)} ${role(p)}</h3><p>${esc(p.clan==='德川家'?'徳川家':p.clan||'浪人')}${p.guildName?' · '+esc(p.guildName):''}</p><code class="social-player-id">${esc(p.id)}</code></div>${mode==='friend'?(String(p.id)===String(s.user.id)?'<span class="social-small">あなた</span>':s.friends.some(f=>String(f.id)===String(p.id))?'<span class="social-small">フレンド</span>':s.requests.some(r=>String(r.id)===String(p.id))?'<span class="social-small">申請中</span>':`<button class="social-button small" data-social="friend-request" data-id="${esc(p.id)}">申請</button>`):`<button class="social-button small" data-social="admin-select-player" data-id="${esc(p.id)}">宛先にする</button>`}</article>`).join('');}
function friendRequestRows(){return s.requests.length?`<section class="social-requests"><h3>届いた申請・送った申請</h3>${s.requests.map(r=>`<article class="social-list-card">${socialAvatar(r,'small')}<div><h3>${playerName(r.name,r.evaluation,r.id,r.appearance,r.avatarVersion,false)}</h3><p>${r.direction==='incoming'?'あなたへ申請が届いています':'承認を待っています'}</p></div>${r.direction==='incoming'?`<button class="social-button small primary" data-social="friend-accept" data-id="${esc(r.id)}">承認</button><button class="social-button small subtle" data-social="friend-reject" data-id="${esc(r.id)}">辞退</button>`:'<span class="social-small">申請中</span>'}</article>`).join('')}</section>`:'';}
function friendListRows(){return `<h3>フレンド <span>${s.friends.length}</span></h3>${s.friends.length?s.friends.map(f=>`<button class="social-friend ${String(s.friendId)===String(f.id)?'selected':''}" data-social="friend-select" data-id="${esc(f.id)}">${socialAvatar(f,'small')}<span><b>${playerName(f.name,f.evaluation,f.id,f.appearance,f.avatarVersion,false)}</b><small>${f.online?'最近接続':esc(f.clan==='德川家'?'徳川家':f.clan||'浪人')}</small></span></button>`).join(''):'<p class="social-small">名前を検索して、申請を送りましょう。</p>'}`;}
function friendsSignature(){return JSON.stringify(s.friends.map(f=>[f.id,f.name,f.clan,f.online,f.avatarVersion||'',evaluationKey(f.evaluation),f.appearance||null]));}
function refreshFriendsView(){
 if(s.tab!=='friends'||s.confirm)return;
 const focused=document.activeElement,key=focused?.dataset?.social?{action:focused.dataset.social,id:focused.dataset.id}:null;
 for(const [selector,html]of [['#social-friend-list',friendListRows()],['#social-friend-requests',friendRequestRows()]]){const node=$(selector);if(node&&node.innerHTML!==html)node.innerHTML=html;}
 const c=channel(),heading=$('[data-social-chat-title]');if(heading&&c?.player){const html=playerName(c.player.name,c.player.evaluation,c.player.id,c.player.appearance,c.player.avatarVersion);if(heading.innerHTML!==html)heading.innerHTML=html;}
 if(key&&focused?.isConnected===false)[...dialog.querySelectorAll('[data-social]')].find(node=>node.dataset.social===key.action&&node.dataset.id===key.id)?.focus({preventScroll:true});
}
function friendsView(){
 return `<details class="social-search-details" ${s.players.length?'open':''}><summary>${icon('search')}領主を探して、フレンド申請</summary>${searchForm()}<div id="social-player-results" class="social-card-list">${playerCards(s.players,'friend')}</div></details><div id="social-friend-requests">${friendRequestRows()}</div><div class="social-friends-layout"><aside id="social-friend-list" class="social-friend-list">${friendListRows()}</aside><div class="social-friend-conversation">${channel()?`${chatView(channel())}<div class="social-right"><button class="social-text-button danger" data-social="friend-remove" data-id="${esc(s.friendId)}">このフレンドを解除</button></div>`:empty('友との文をひらく','フレンドを選ぶと、二人だけで話せます。','people')}</div></div>`;
}
function mailParticipants(mail){const people=Array.isArray(mail.participants)?mail.participants.filter(p=>p&&typeof p.playerId==='string'&&typeof p.name==='string'&&['attacker','defender'].includes(p.side)):[];return people.length?`<div class="social-mail-participants">${people.map(p=>`<p>${p.side==='attacker'?'攻撃側':'守備側'}：${playerName(p.name,p.evaluation,p.playerId,p.appearance,p.avatarVersion)}</p>`).join('')}</div>`:'';}
function mailView(){
 const selected=s.mail.find(m=>String(m.id)===String(s.openedMail));
 if(selected){const pending=s.pending[`${s.identity.id}:${selected.id}`];return `<button class="social-text-button" data-social="mail-back">受信一覧に戻る</button><article class="social-letter"><div class="social-eyebrow">SYSTEM LETTER</div><h2>${esc(selected.title)}</h2><div class="social-letter-date">${selected.source==='system'?'システムからの自動通知':'サイトからのお知らせ'} · ${esc(date(selected.createdAt))}</div>${mailParticipants(selected)}<div class="social-letter-body">${esc(selected.body)}</div>${selected.gift?`<div class="social-gift"><span>${icon('gift')}</span><div><b>同封された贈り物</b><p>${esc(giftLabel(selected.gift))}</p></div><button class="social-button primary" data-social="mail-claim" data-id="${esc(selected.id)}" ${selected.claimed&&!pending?'disabled':''}>${pending?'受け取りを再確認':selected.claimed?'受取済み':'受け取る'}</button></div>`:''}</article>`;}
 return `<div class="social-section-heading"><div><h2>届いた便り</h2><p>対人戦の被攻撃・勝敗・本拠移転はシステムメールで自動通知します。期間限定合戦の達成報酬、サイトからのお知らせや、資源・勾玉の贈り物も届きます。</p></div><button class="social-icon-button" data-social="mail-refresh" aria-label="郵便を更新">${icon('refresh')}</button></div><div class="social-card-list">${s.mail.length?s.mail.map(m=>`<button class="social-mail-row ${m.read?'':'unread'}" data-social="mail-open" data-id="${esc(m.id)}"><span class="social-mail-symbol">${icon(m.gift?'gift':'mail')}</span><span><b>${esc(m.title)}</b><small>${esc(date(m.createdAt))} · ${m.event?.kind==='timed-event'?(m.claimed?'期間限定合戦 · 報酬は受取済み':'期間限定合戦 · 報酬あり'):m.source==='system'?'合戦の自動通知':m.gift?(m.claimed?'贈り物は受取済み':'贈り物あり'):'お知らせ'}</small></span><span class="social-mail-state">${m.read?'既読':'未読'}</span></button>`).join(''):empty('まだ便りは届いていません','対人戦の自動通知や、サイトからのお知らせ・贈り物は、こちらへ届きます。','mail')}</div>`;
}
function profileNameView(){const edit=s.profileNameEdit?.playerId===String(s.user.id)?s.profileNameEdit:null,disabled=busy.has('social-profile-name-form')?' disabled':'';return `<section class="social-profile-section" aria-labelledby="social-name-heading"><h3 id="social-name-heading">領主名を変更</h3><p id="social-name-help">交流や天下地図で表示する名前です。1〜24文字で入力してください。</p><form id="social-profile-name-form" class="social-inline-form" data-player-id="${esc(s.user.id)}" data-current-name="${esc(edit?.expectedName??s.user.name)}"><label class="social-sr-only" for="social-profile-name">新しい領主名</label><input id="social-profile-name" name="name" type="text" minlength="1" autocomplete="nickname" value="${esc(edit?.value??s.user.name)}" aria-describedby="social-name-help" required${disabled}><button type="submit" class="social-button primary"${disabled}>名前を変更</button></form><p class="social-small">領主ID・進行・購入した商品はそのまま引き継ぎます。</p><p data-profile-name-feedback class="social-feedback${edit?.error?' is-error':''}" role="status" aria-live="polite"${edit?.message?'':' hidden'}>${esc(edit?.message||'')}</p></section>`;}
function profileNameFeedback(message,error=false,{reset=false}={}){if(!s.user||String(s.user.id)!==String(s.identity?.id))return;const owner=String(s.user.id),prior=s.profileNameEdit?.playerId===owner?s.profileNameEdit:null;s.profileNameEdit={playerId:owner,value:reset?s.user.name:prior?.value??s.user.name,expectedName:reset?s.user.name:prior?.expectedName??s.user.name,message,error};const node=$('[data-profile-name-feedback]');if(node){node.textContent=message;node.hidden=!message;node.classList.toggle('is-error',error);}const form=$('#social-profile-name-form');if(reset&&form&&String(form.dataset.playerId)===owner){form.dataset.currentName=s.user.name;const input=form.querySelector('[name=name]');if(input)input.value=s.user.name;}}
function profileNameInput(event){const input=event.target,owner=String(s.user?.id||'');if(input.id!=='social-profile-name'||!owner||owner!==String(s.identity?.id)||String(input.form?.dataset.playerId)!==owner)return;const prior=s.profileNameEdit?.playerId===owner?s.profileNameEdit:null;s.profileNameEdit={playerId:owner,value:input.value,expectedName:prior?.expectedName??input.form.dataset.currentName??s.user.name,message:'',error:false};profileNameFeedback('');}
async function changeProfileName(form,value){
 const owner=String(s.user?.id||''),epoch=authEpoch,access=accountEpoch,input=form.querySelector('[name=name]');
 if(!owner||owner!==String(s.identity?.id)||String(form.dataset?.playerId)!==owner||s.accountBanned||s.accountAccessPending)throw staleIdentity();
 const current=()=>!disposed&&epoch===authEpoch&&access===accountEpoch&&String(s.identity?.id)===owner&&String(s.user?.id)===owner;
 s.profileNameEdit={playerId:owner,value:String(value??''),expectedName:String(form.dataset.currentName??s.user.name),message:'',error:false};
 if(input)input.disabled=true;
 try{
  const name=normalizedPlayerName(value),expectedName=s.profileNameEdit.expectedName;
  if(name===normalizedPlayerName(s.user.name)){profileNameFeedback('現在と同じ領主名です。',false,{reset:true});return;}
  const result=await api('/profile',{method:'PATCH',data:{name,expectedName},identityEpoch:epoch});
  if(!current())throw staleIdentity();if(String(result.user?.id)!==owner||typeof result.user?.name!=='string'||normalizedPlayerName(result.user.name)!==result.user.name)throw Error('変更後の領主名を確認できませんでした。接続を確認してから、もう一度お試しください。');
  nameMutationEpoch++;global.SengokuAvatar?.rename?.(result.user);acceptUser(result.user);profileNameFeedback('領主名を変更しました。',false,{reset:true});
  const refreshes=await Promise.allSettled([loadMe(),global.SengokuCloudSync?.refresh?.(),global.SengokuPremiumRuntime?.refresh?.()]);
  if(!current())throw staleIdentity();profileNameFeedback(refreshes.some(result=>result.status==='rejected')?'領主名を変更しました。接続情報は、通信が戻ると再確認されます。':'領主名を変更しました。',false,{reset:true});toast('領主名を変更しました。');
 }catch(error){
  if(!current()||error.code==='STALE_IDENTITY')throw staleIdentity();
  if(error.code==='PROFILE_CHANGED'){try{await loadMe();}catch(_){}if(!current())throw staleIdentity();s.profileNameEdit.expectedName=s.user.name;form.dataset.currentName=s.user.name;error.message=`別の端末で領主名が変更されました。現在は「${s.user.name}」です。入力内容を確認して、もう一度変更してください。`;}
  profileNameFeedback(error.message||'領主名を変更できませんでした。',true);throw error;
 }finally{if(input?.isConnected!==false)input.disabled=false;const currentForm=$('#social-profile-name-form');if(current()&&currentForm&&String(currentForm.dataset.playerId)===owner){const currentInput=currentForm.querySelector('[name=name]'),currentButton=currentForm.querySelector('[type=submit]');if(currentInput)currentInput.disabled=false;if(currentButton)currentButton.disabled=false;}}
}
function profileView(){return `<div class="social-profile-heading"><span id="social-profile-avatar" data-avatar-key="${esc(JSON.stringify([s.user.id,s.user.name,s.user.avatarVersion||null]))}">${socialAvatar(s.user,'profile')}</span><div><div class="social-eyebrow">YOUR IDENTITY</div><h2>${playerName(s.user.name,s.user.evaluation,s.user.id,s.user.appearance,s.user.avatarVersion,false)} ${role(s.user)}</h2><p>${esc(s.user.clan==='德川家'?'徳川家':s.user.clan||'浪人')} · ${s.user.guildName?esc(s.user.guildName):'同盟未所属'}</p><button type="button" class="social-text-button" data-social="evaluation-open">総合評価を見る</button><button type="button" class="social-text-button" data-social="premium-open">自分の外観を管理</button></div></div><div class="social-profile-id"><span>領主ID</span><code>${esc(s.user.id)}</code></div><div id="social-avatar-editor"></div>${profileNameView()}<section class="social-profile-section"><h3>同じ領主で、どの端末からも</h3><p>端末を接続すると、城・武将・資源・進行状況を常に自動同期します。</p><div data-sync-status>${syncStatusCard()}</div><div class="social-actions"><button class="social-button primary" data-social="sync-open">${icon('refresh')}端末を接続・確認</button><button class="social-button" data-social="identity-export">${icon('download')}領主データを書き出す</button><button class="social-button" data-social="recovery-open">${icon('upload')}引き継ぎ・復元</button><button class="social-button" data-social="recovery-export">${icon('download')}統合バックアップ</button></div><div class="social-notice">領主データには本人の認証情報が含まれます。自分の端末間で使ってください。</div></section>${s.user.isAdmin?`<section class="social-profile-section"><h3>運営のゲーム設定</h3><p>運営の本拠は江戸城に固定されます。德川家康Uは特別イラストで付与され、同じ領主IDの端末へ同期します。</p><div class="social-actions"><button class="social-button" data-social="game-settings">ゲーム設定を開く</button><button class="social-button" data-social="admin-restore">德川家康Uを復元</button></div></section>`:''}${s.user.isStaff?`<section class="social-profile-section staff-base-notice"><h3>德川家 · スタッフ共同拠点 · 京都御所</h3><p>スタッフの家は德川家、本拠は占領されない京都御所に固定されます。城郭と城下町の施設を全スタッフで共有し、共同普請の成長が各端末へ自動で反映されます。</p><p>普請を指示したスタッフが自分の資源と指令を支払います。資源・武将・研究・奉行はそれぞれの領主のものです。</p><button class="social-button" data-social="game-settings">ゲーム設定を開く</button></section>`:''}<div class="social-right"><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>`;}
function linkForm(){return `<section class="social-profile-section"><h3>別の端末の領主につなぐ</h3><p>接続済みの端末で「端末同期」からコードを発行し、こちらへ入力してください。同じ領主の最新の進行を読み込みます。</p><form id="social-device-link-form" class="social-inline-form"><label class="social-sr-only" for="social-device-code">12文字の接続コード</label><input id="social-device-code" name="code" minlength="12" maxlength="18" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="12文字の接続コード" required><button class="social-button primary" type="submit">この領主につなぐ</button></form></section>`;}
function syncStatusCard(){const v=s.syncStatus||global.SengokuCloudSync?.getStatus?.()||{message:'同期を準備しています。',writable:false};return `<div class="social-sync-status ${v.writable?'is-writer':''}" role="status"><strong>${v.linked?(v.writable?'自動同期中':v.ready?'進行を確認中':'初回同期中'):'端末内に保存'}</strong><p>${esc(v.message||'同期状態を確認しています。')}</p>${v.updatedAt?`<small>最終保存 ${esc(date(v.updatedAt))}</small>`:''}${v.linked&&v.ready&&!v.writable&&v.reason!=='hidden'?`<button class="social-button" data-social="sync-takeover">この端末で続ける</button>`:''}</div>`;}
function syncView(){
 if(!s.identity)return `<div class="social-section-heading"><div><h2>端末をつないで、続きを。</h2><p>PCとスマートフォンで同じ領主の進行を自動保存・同期します。</p></div></div>${registerView()}`;
 const v=global.SengokuCloudSync?.getDevice?.()||{name:'この端末'},code=s.pairCode,validCode=code&&Date.parse(code.expiresAt)>Date.now();
 return `<div class="social-section-heading"><div><h2>どの端末でも、同じ戦記。</h2><p>${playerName(s.user?.name||'確認中の領主',s.user?.evaluation,s.user?.id,s.user?.appearance,s.user?.avatarVersion)} ${role(s.user)} · 進行・所持武将・城を自動同期します。</p></div><button class="social-icon-button" data-social="sync-refresh" aria-label="同期を確認">${icon('refresh')}</button></div><div data-sync-status>${syncStatusCard()}</div><div class="social-notice">同時に進行する端末は一つです。ほかの端末は最新の進行を自動表示します。「この端末で続ける」で切り替えられます。接続が切れた場合は、同期が戻るまで進行を一時停止します。</div><form id="social-device-name-form" class="social-inline-form"><label class="social-sr-only" for="social-device-name">この端末の名前</label><input id="social-device-name" name="name" maxlength="40" value="${esc(v.name)}" placeholder="例：自宅のパソコン" required><button class="social-button" type="submit">端末名を保存</button></form><section class="social-profile-section"><h3>もう一つの端末を接続</h3><p>新しい端末の「端末同期」に、この接続コードを入力してください。コードは10分間有効で、1回使うと失効します。</p><div class="social-actions"><button class="social-button primary" data-social="pair-create">接続コードを発行</button></div>${validCode?`<div class="social-pair-code"><code>${esc(code.code)}</code><button class="social-button small" data-social="pair-copy">コピー</button><p>${esc(date(code.expiresAt))} まで有効 · 自分の端末への接続用です。</p></div>`:''}</section>${linkForm()}<section class="social-profile-section"><h3>領主データで接続する</h3><p>保存してある領主データでも、同じ領主として接続できます。</p><div class="social-actions"><button class="social-button" data-social="identity-export">${icon('download')}領主データを書き出す</button><button class="social-button" data-social="recovery-open">${icon('upload')}引き継ぎ・復元</button><button class="social-button" data-social="recovery-export">${icon('download')}統合バックアップ</button></div></section><div class="social-right"><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>`;
}
function onlineView(){return `<div class="social-section-heading"><div><h2>いま集う領主たち</h2><p>接続中 ${num(s.onlineTotal)}人 · 10秒ごとに更新</p></div><button class="social-icon-button" data-social="online-refresh" aria-label="接続一覧を更新">${icon('refresh')}</button></div><p class="social-online-caption">現在接続している全プレイヤーの一覧です。未登録でも閲覧できます。</p>${s.onlineError?`<div class="social-feedback is-error">${esc(s.onlineError)}</div>`:''}<div class="social-card-list">${s.onlinePlayers.length?s.onlinePlayers.map(p=>`<article class="social-list-card">${socialAvatar(p)}<div><h3>${playerName(p.name,p.evaluation,p.id,p.appearance,p.avatarVersion,false)} ${role(p)}</h3><p>${esc(p.clan==='德川家'?'徳川家':p.clan||'浪人')}${p.guildName?' · '+esc(p.guildName):''}</p></div><span class="social-online-label">${String(p.id)===String(s.identity?.id)?'あなた':'接続中'}</span></article>`).join(''):empty(s.onlineLoaded?'現在接続中の領主はいません':'接続一覧を読み込んでいます',s.onlineLoaded?'領主として接続すると、この一覧に表示されます。':'しばらくお待ちください。','people')}</div>${s.onlineCursor?'<div class="social-actions"><button class="social-button" data-social="online-more">続きを表示</button></div>':''}`;}
function renderSyncStatus(value){s.syncStatus=value;if(!dialog)return;dialog.querySelectorAll('[data-sync-status]').forEach(el=>{el.innerHTML=syncStatusCard();});refreshGuildTreasuryView();}
function guildIconEntity(){const guild=String(s.guild?.id)===String(s.user?.guildId)?s.guild:null,value={...(guild||{}),id:String(s.user?.guildId||''),name:s.user?.guildName||guild?.name||'同盟',iconVersion:guild&&Object.hasOwn(guild,'iconVersion')?guild.iconVersion:s.user?.guildIconVersion||null};return global.SengokuAllianceIcon?.resolve?.(value)||value;}
function destroyGuildIconEditor(){guildIconGeneration++;const editor=guildIconEditor;guildIconEditor=null;editor?.control?.destroy?.();if(editor?.host)editor.host.textContent='';}
function refreshGuildIcon(){
 global.SengokuAllianceIcon?.refresh?.(dialog);
 if(!s.user?.guildId)return;
 const name=$('#social-guild-heading-name'),summary=$('#social-guild-heading-summary'),label=s.guild?`${num(s.guild.memberCount)} / ${num(s.guild.maxMembers||50)} 人`:'仲間と歩む天下への道';
 if(name&&name.textContent!==s.user.guildName)name.textContent=s.user.guildName;
 if(summary){const text=label+' · あなたは'+guildRoleName(s.user.guildRole);if(summary.textContent!==text)summary.textContent=text;}
 if(guildIconEditor){if(!guildIconEditor.current()){destroyGuildIconEditor();return;}guildIconEditor.control.update?.(guildIconEntity());}
}
function mountGuildIconEditor(){
 const host=$('#social-guild-icon-editor');if(!s.open||s.tab!=='guild'||s.guildSection!=='members'||s.user?.guildRole!=='owner'||!s.user.guildId||!host||!global.SengokuAllianceIcon?.mount)return;
 const context=guildContext(),generation=guildIconGeneration,access=accountEpoch,privilege=privilegeEpoch;
 const current=()=>!disposed&&generation===guildIconGeneration&&guildCurrent(context)&&access===accountEpoch&&privilege===privilegeEpoch&&s.open&&s.tab==='guild'&&s.guildSection==='members'&&s.user?.guildRole==='owner'&&!s.accountBanned&&!s.accountAccessPending&&!recoveryHeld&&host.isConnected!==false;
 const control=global.SengokuAllianceIcon.mount(host,{guild:guildIconEntity(),request:async(route,options={})=>{
  if(!current())throw staleIdentity();if(route!=='/guild/icon'||!['PUT','DELETE'].includes(options.method)||String(options.data?.guildId)!==context.guildId)throw Error('同盟アイコンの操作を確認してください。');
  let result;try{result=await api(route,{...options,identityEpoch:context.epoch,background:true});}catch(error){if(current()&&['GUILD_REQUIRED','GUILD_ROLE_REQUIRED','GUILD_CHANGED'].includes(error.code))try{await loadMe();}catch(_){}throw error;}
  if(!current())throw staleIdentity();return result;
 },onGuild:guild=>{
  if(!current()||String(guild?.id)!==context.guildId)return;
  global.SengokuAllianceIcon?.observe?.(guild);
  const version=global.SengokuAllianceIcon?.resolve?.(guild)?.iconVersion??guild.iconVersion??null;
  s.guild={...(s.guild||{}),...guild,iconVersion:version};s.user={...s.user,guildIconVersion:version};
  for(const list of [s.guilds,s.guildRankings.guilds])for(const item of list)if(String(item.id)===context.guildId)item.iconVersion=version;
  refreshGuildIcon();
 }});
 guildIconEditor={host,current,control};
}
function destroyAvatarEditor(){avatarGeneration++;avatarEditor?.destroy?.();avatarEditor=null;}
function refreshProfileAvatar(){if(!s.user||s.tab!=='profile')return;const heading=$('#social-profile-avatar'),key=JSON.stringify([s.user.id,s.user.name,s.user.avatarVersion||null]);if(heading&&heading.dataset.avatarKey!==key){heading.innerHTML=socialAvatar(s.user,'profile');heading.dataset.avatarKey=key;}avatarEditor?.update?.(s.user);}
function mountProfileAvatar(){
 const host=$('#social-avatar-editor');if(!s.open||s.tab!=='profile'||!s.user||!host||!global.SengokuAvatar?.mount)return;
 const generation=avatarGeneration,epoch=authEpoch,roleEpoch=privilegeEpoch,owner=String(s.user.id);
 const current=()=>!disposed&&generation===avatarGeneration&&epoch===authEpoch&&roleEpoch===privilegeEpoch&&s.open&&s.tab==='profile'&&String(s.identity?.id)===owner&&String(s.user?.id)===owner&&host.isConnected!==false;
 avatarEditor=global.SengokuAvatar.mount(host,{user:{...s.user},request:async(route,options={})=>{if(!current())throw staleIdentity();if(route!=='/me/avatar'||!['PUT','DELETE'].includes(options.method))throw Error('アイコンの操作を確認してください。');const result=await api(route,{...options,identityEpoch:epoch,background:true});if(!current())throw staleIdentity();return result;},onUser:user=>{if(!current()||String(user?.id)!==owner)return;avatarMutationEpoch++;global.SengokuAvatar?.observe?.(user);acceptUser(user);for(const key of ['friends','requests','members','players','adminPlayers','staff','staffCandidates','onlinePlayers'])s[key]=s[key].map(p=>String(p.id)===owner?{...p,avatarVersion:user.avatarVersion||null}:p);s.recentLogins.players=s.recentLogins.players.map(p=>String(p.id)===owner?{...p,avatarVersion:user.avatarVersion||null}:p);for(const cached of s.chats.values())for(const message of cached.messages||[])if(String(message.userId)===owner)message.avatarVersion=user.avatarVersion||null;refreshProfileAvatar();}});
}
function loginDate(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d):'—';}
function recentLoginRows(){
 const r=s.recentLogins;if(!r.players.length)return empty(r.loaded?'過去24時間の接続記録はありません':r.error?'ログイン履歴を取得できませんでした':'ログイン履歴を読み込んでいます',r.loaded?'次の接続確認で一覧に反映されます。':r.error?'「更新」からもう一度お試しください。':'しばらくお待ちください。','people');
 return r.players.map(p=>`<article class="social-recent-login-row">${socialAvatar(p)}<div class="social-recent-login-person"><h3>${playerName(p.name,p.evaluation,p.id,p.appearance,p.avatarVersion,false)} ${role(p)||'<span class="social-recent-login-role">領主</span>'}</h3><p>${esc(p.clan==='德川家'?'徳川家':p.clan||'浪人')}</p></div><span class="social-recent-login-presence ${p.online===true?'is-online':''}">${p.online===true?'オンライン':'オフライン'}</span><div class="social-recent-login-time"><span>最終接続</span><time datetime="${esc(p.lastSeen)}">${esc(loginDate(p.lastSeen))}</time><small>日本時間 JST</small></div></article>`).join('');
}
function recentLoginWindow(){const r=s.recentLogins;return r.serverNow&&r.windowStart?`${loginDate(r.windowStart)} 〜 ${loginDate(r.serverNow)}（日本時間 JST）`:'対象期間を確認しています。表示時刻は日本時間 JST です。';}
function recentLoginsView(){
 if(!hasAdminChat())return empty('この一覧を表示できません','この領主には閲覧権限がありません。','shield');
 const r=s.recentLogins;return `<section class="social-recent-logins"><div class="social-section-heading"><div><span class="social-eyebrow">RECENT CONNECTIONS</span><h2>ログイン履歴 <span class="social-recent-login-access">運営・スタッフ専用</span></h2><p>過去24時間にログイン・接続を確認した領主</p></div><button id="social-recent-login-refresh" class="social-button" data-social="recent-logins-refresh" aria-label="ログイン履歴を更新">${icon('refresh')}更新</button></div><div class="social-recent-login-summary"><strong id="social-recent-login-count">${r.loaded?`${num(r.total)}人 · ${num(r.players.length)}人を表示`:'人数を確認中'}</strong><span>最終接続が新しい順 · 30秒ごとに更新</span></div><p id="social-recent-login-window" class="social-recent-login-window">${esc(recentLoginWindow())}</p><p class="social-recent-login-help">各領主の最終接続を表示します。個々のログイン操作の回数を示す履歴ではありません。接続時刻の反映には最大約1分かかります。</p><p id="social-recent-login-status" class="social-recent-login-status ${r.error?'is-error':''}" role="status" aria-live="polite">${esc(r.error||(!r.loaded?'履歴を読み込んでいます…':''))}</p><div id="social-recent-login-results" class="social-recent-login-results">${recentLoginRows()}</div><div class="social-recent-login-actions"><button id="social-recent-login-more" class="social-button" data-social="recent-logins-more" ${!r.cursor?'hidden':''}>続きを表示</button></div></section>`;
}
function refreshRecentLoginView({rows=false}={}){
 if(!s.open||s.tab!=='recent-logins'||!hasAdminChat()||s.confirm)return;
 const r=s.recentLogins,count=$('#social-recent-login-count'),windowLabel=$('#social-recent-login-window'),status=$('#social-recent-login-status'),results=$('#social-recent-login-results'),refreshButton=$('#social-recent-login-refresh'),more=$('#social-recent-login-more');
 if(count)count.textContent=r.loaded?`${num(r.total)}人 · ${num(r.players.length)}人を表示`:'人数を確認中';if(windowLabel)windowLabel.textContent=recentLoginWindow();
 if(status){status.textContent=r.error||(recentLoginBusy?'履歴を更新しています…':r.loaded?'':'履歴を読み込んでいます…');status.classList.toggle('is-error',Boolean(r.error));}
 if(results){results.setAttribute('aria-busy',String(recentLoginBusy));if(rows){const top=body?.scrollTop||0;results.innerHTML=recentLoginRows();if(body)body.scrollTop=top;}}
 // Keep the controls mounted and focusable during polling and manual updates.
 for(const button of [refreshButton,more])if(button){button.setAttribute('aria-disabled',String(recentLoginBusy));button.setAttribute('aria-busy',String(recentLoginBusy));}
 if(more){if(!r.cursor&&document.activeElement===more)refreshButton?.focus({preventScroll:true});more.hidden=!r.cursor;}
}
function scheduleRecentLogins(){clearTimeout(recentLoginTimer);recentLoginTimer=null;if(!disposed&&!document.hidden&&s.open&&s.tab==='recent-logins'&&hasAdminChat())recentLoginTimer=setTimeout(()=>loadRecentLogins(),30000);}
async function loadRecentLogins({more=false}={}){
 if(disposed||document.hidden||!s.open||s.tab!=='recent-logins'||!hasAdminChat()||!s.identity||recentLoginBusy||more&&!s.recentLogins.cursor)return;
 recentLoginBusy=true;clearTimeout(recentLoginTimer);recentLoginTimer=null;const generation=++recentLoginGeneration,epoch=authEpoch,roleEpoch=privilegeEpoch,owner=String(s.identity.id),cursor=more?s.recentLogins.cursor:null;
 const current=()=>generation===recentLoginGeneration&&epoch===authEpoch&&roleEpoch===privilegeEpoch&&String(s.identity?.id)===owner&&!disposed&&!document.hidden&&s.open&&s.tab==='recent-logins'&&hasAdminChat();
 s.recentLogins.error='';refreshRecentLoginView();
 try{
  const r=await api('/staff/recent-logins?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{background:true});if(!current())return;
  const now=Date.parse(r.serverNow),start=Date.parse(r.windowStart);if(!Array.isArray(r.players)||!Number.isFinite(now)||!Number.isFinite(start)||start>now)throw Error('履歴の応答を確認できませんでした。もう一度更新してください。');
  const cutoff=Math.max(start,now-86400000),list=more?[...s.recentLogins.players,...r.players]:r.players,byId=new Map();
  for(const p of list){const seen=Date.parse(p?.lastSeen);if(!p||typeof p.id!=='string'||!Number.isFinite(seen)||seen<cutoff||seen>now)continue;const old=byId.get(p.id);if(!old||Date.parse(old.lastSeen)<=seen)byId.set(p.id,p);}
  s.recentLogins={players:[...byId.values()].sort((a,b)=>Date.parse(b.lastSeen)-Date.parse(a.lastSeen)||(a.id<b.id?-1:a.id>b.id?1:0)),total:Math.max(0,Math.floor(Number(r.total)||0)),cursor:typeof r.nextCursor==='string'&&r.nextCursor?r.nextCursor:null,serverNow:r.serverNow,windowStart:r.windowStart,loaded:true,error:''};refreshRecentLoginView({rows:true});
 }catch(error){if(current()&&error.code!=='STALE_IDENTITY'){s.recentLogins.error=error.message||'ログイン履歴を読み込めませんでした。';refreshRecentLoginView({rows:true});}}
 finally{if(current()){recentLoginBusy=false;refreshRecentLoginView();scheduleRecentLogins();}}
}
function staleIdentity(){const e=Error('接続する領主が変わったため、以前の処理を取り消しました。');e.code='STALE_IDENTITY';return e;}
function applyRoleAccess(user={}){const bridge=global.SengokuBridge,roles={isAdmin:user?.isAdmin===true,isStaff:user?.isStaff===true&&user?.isAdmin!==true,pending:!user?.id&&Boolean(s.identity)};if(bridge?.setRoleAccess)bridge.setRoleAccess(roles);else bridge?.setAdminAccess?.(roles.isAdmin);}
function acceptUser(user,{fromSync=false}={}){
 if(user?.isBanned===true){markAccountBanned(user);return;}
 if(!user&&s.accountBanned)return;
 const wasBanned=Boolean(s.accountBanned),wasPending=Boolean(s.accountAccessPending);
 if(!user){global.SengokuPublicCourt?.clear?.();s.profileNameEdit=null;const wasAdminTab=['admin','recent-logins'].includes(s.tab);s.user=null;s.unreadMail=0;s.unreadLetters=0;s.mail=[];s.openedMail=null;global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();global.SengokuModeration?.refreshIdentity?.();global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();clearAdminData();clearGuildData();if(wasAdminTab)s.tab='profile';if(!fromSync)applyRoleAccess();if(body&&(wasAdminTab||s.open)){clearConfirm();render();}return;}
 if(!s.identity||String(user.id)!==String(s.identity.id))throw staleIdentity();
 if(wasBanned||wasPending){s.accountBanned=null;s.accountAccessPending=null;accountEpoch++;}
 const previous=s.user,guildChanged=String(previous?.guildId||'')!==String(user.guildId||''),guildRoleChanged=(previous?.guildRole||'')!==(user.guildRole||''),roleChanged=(previous?.isAdmin===true)!==(user.isAdmin===true)||(previous?.isStaff===true)!==(user.isStaff===true&&user.isAdmin!==true),wasAdminTab=['admin','recent-logins'].includes(s.tab);
 const currentAvatar=global.SengokuAvatar?.resolve?.(user),currentGuildIcon=user.guildId?global.SengokuAllianceIcon?.resolve?.({id:user.guildId,name:user.guildName,iconVersion:user.guildIconVersion}):null;s.user={...user,...(currentAvatar?{avatarVersion:currentAvatar.avatarVersion}:{}),...(currentGuildIcon?{guildIconVersion:currentGuildIcon.iconVersion}:{}),isBanned:false,isAdmin:user.isAdmin===true,isStaff:user.isStaff===true&&user.isAdmin!==true};global.SengokuPublicCourt?.update?.({user:s.user});if(guildChanged||guildRoleChanged){clearGuildData({resetSection:guildChanged});if(s.open&&s.tab==='guild')render();}if(!fromSync)applyRoleAccess(s.user);
 if(roleChanged){clearAdminData();global.SengokuModeration?.refreshIdentity?.();global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();if(wasAdminTab&&!hasAdminChat())s.tab='profile';renderTabs();if(body&&(s.open||wasAdminTab)){clearConfirm();render();}if(s.open&&s.tab==='recent-logins'&&hasAdminChat())loadRecentLogins();}
 else if((!previous||wasBanned||wasPending)&&s.open&&!s.confirm)render();if(!previous||wasBanned||wasPending||previous.name!==s.user.name)global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();applyPlayerEvaluations([{playerId:s.user.id,name:s.user.name,avatarVersion:s.user.avatarVersion||null,evaluation:s.user.evaluation}]);if(!previous||guildChanged||wasBanned||wasPending){global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();}refreshProfileAvatar();refreshGuildIcon();header();
}
function startCloud(){
 if(recoveryHeld){global.SengokuCloudSync?.stop?.({pending:true});global.SengokuBridge?.setSyncAccess?.({linked:true,ready:false,writable:false,reason:'recovery',message:'引き継ぎが途中です。保存内容を確認するまで同期を停止しています。'});return;}
 const identity=s.identity,epoch=authEpoch;if(!identity){global.SengokuCloudSync?.stop?.();applyRoleAccess();return;}
 global.SengokuBridge?.setSyncAccess?.({linked:true,ready:false,writable:false,reason:'initializing',message:'領主と最新の保存を確認しています…'});
 if(!global.SengokuCloudSync){s.error='同期機能を読み込めませんでした。画面を再読み込みしてください。';return;}
 global.SengokuCloudSync.start({id:identity.id,request:(route,options)=>api(route,{...options,token:identity.token,identityEpoch:epoch,background:true}),onUser:user=>{if(epoch===authEpoch)acceptUser(user,{fromSync:true});}});
}
function installIdentity(identity,user){global.SengokuCloudSync?.stop?.({pending:true});authEpoch++;recoveryEpoch++;recovery=null;recoveryHeld=false;clearPrivate();s.accountBanned=null;s.accountAccessPending=null;accountEpoch++;s.identity=identity;s.user=user?{...user,...(global.SengokuAvatar?.resolve?{avatarVersion:global.SengokuAvatar.resolve(user).avatarVersion}:{}),isAdmin:false,isStaff:false}:null;global.SengokuPublicCourt?.update?.({user:s.user});s.friends=[];s.requests=[];s.unreadMail=0;s.unreadLetters=0;global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();global.SengokuModeration?.refreshIdentity?.();global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();s.error='';refreshOperatorRecoveryAccess();if(s.tab==='recent-logins'){s.tab='profile';render();}applyRoleAccess();startCloud();}
async function loadOnline({more=false}={}){
 if(disposed||document.hidden||!s.open||s.tab!=='online'||onlineBusy)return;onlineBusy=true;clearTimeout(onlineTimer);const epoch=++onlineEpoch;
 try{const cursor=more?s.onlineCursor:null,r=await api('/online'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{auth:false,background:true});if(epoch!==onlineEpoch||disposed)return;const incoming=Array.isArray(r.players)?r.players:[];s.onlinePlayers=more?[...new Map([...s.onlinePlayers,...incoming].map(p=>[String(p.id),p])).values()]:incoming;s.onlineTotal=Number(r.total)||0;s.onlineCursor=r.nextCursor||null;s.onlineLoaded=true;s.onlineError='';s.config.onlineCount=s.onlineTotal;header();if(s.open&&s.tab==='online'&&!s.confirm)render();}
 catch(e){if(epoch===onlineEpoch){s.onlineError=e.message||'接続一覧を読み込めませんでした。';if(s.open&&s.tab==='online'&&!s.confirm)render();}}
 finally{onlineBusy=false;if(!disposed&&!document.hidden&&s.open&&s.tab==='online')onlineTimer=setTimeout(()=>loadOnline(),10000);}
}

function staffCards(players,{candidates=false}={}){return players.map(p=>{
 const own=String(p.id)===String(s.user?.id),operator=p.isAdmin===true,appointed=p.isStaff===true;
 const action=own?'<span class="social-small">あなた</span>':operator?'<span class="social-small">運営</span>':`<button class="social-button small ${appointed?'subtle':'primary'}" data-social="${appointed?'staff-dismiss':'staff-appoint'}" data-id="${esc(p.id)}">${appointed?'スタッフを解任':'スタッフに任命'}</button>`;
 return `<article class="social-list-card social-staff-card">${socialAvatar(p,'small')}<div><h3>${playerName(p.name,p.evaluation,p.id,p.appearance,p.avatarVersion,false)} ${role(p)}</h3><p>${esc(p.clan==='德川家'?'徳川家':p.clan||'浪人')}${!candidates&&p.appointedAt?' · '+esc(date(p.appointedAt))+' 任命':''}</p><code class="social-player-id">${esc(p.id)}</code></div>${action}</article>`;
}).join('');}
function staffList(candidates=false){
 const items=candidates?s.staffCandidates:s.staff,key=candidates?'staffCandidatePage':'staffPage',pages=Math.max(1,Math.ceil(items.length/4));s[key]=Math.max(1,Math.min(pages,s[key]||1));
 if(!items.length)return empty(candidates?(s.staffQuery?'領主が見つかりません':'任命する領主を探す'):(s.staffLoaded?'スタッフはまだいません':'スタッフを確認しています'),candidates?'登録済みの領主名で検索してください。':s.staffLoaded?'上の検索から領主を選んで任命できます。':'しばらくお待ちください。',candidates?'search':'people');
 return `<div class="social-card-list">${staffCards(items.slice((s[key]-1)*4,s[key]*4),{candidates})}</div>${pages>1?`<nav class="social-staff-pages" aria-label="${candidates?'候補':'スタッフ'}一覧のページ"><button class="social-button small subtle" data-social="staff-page" data-id="${candidates?'candidates':'roster'}" data-page="${s[key]-1}" ${s[key]===1?'disabled':''}>前へ</button><span>${s[key]} / ${pages} · ${num(items.length)}人</span><button class="social-button small subtle" data-social="staff-page" data-id="${candidates?'candidates':'roster'}" data-page="${s[key]+1}" ${s[key]===pages?'disabled':''}>次へ</button></nav>`:''}`;
}
function renderStaffLists(){
 const roster=$('#social-staff-roster'),candidates=$('#social-staff-results'),count=$('#social-staff-count');if(roster)roster.innerHTML=staffList();if(candidates)candidates.innerHTML=staffList(true);if(count)count.textContent=s.staffLoaded?`${num(s.staff.length)}人`:'確認中';
}
function setStaffRoster(list){s.staff=(Array.isArray(list)?list:[]).filter(p=>p&&typeof p.id==='string'&&p.isStaff===true&&!p.isAdmin);s.staffLoaded=true;const ids=new Set(s.staff.map(p=>String(p.id)));s.staffCandidates=s.staffCandidates.map(p=>({...p,isStaff:!p.isAdmin&&ids.has(String(p.id))}));applyPlayerEvaluations(s.staff.filter(p=>Object.hasOwn(p,'evaluation')).map(p=>({playerId:p.id,evaluation:p.evaluation,...(Object.hasOwn(p,'appearance')?{appearance:p.appearance}:{})})));}
async function loadStaff(){
 requireAdmin();const epoch=privilegeEpoch,r=await api('/admin/staff',{background:true});if(epoch!==privilegeEpoch||!s.user?.isAdmin)return null;setStaffRoster(r.staff);renderStaffLists();return r;
}
function staffView(){
 if(!s.user?.isAdmin)return'';
 return `<section class="social-staff-scope"><div>${icon('shield')}</div><div><h3>スタッフと運営チャットで連携する</h3><p>任命された領主は運営チャットに参加でき、過去24時間のログイン履歴を確認できます。本拠は保護された京都御所となり、全スタッフで城郭・城下町の成長を共有します。告知・配布・共通時間の変更、江戸城と德川家康Uの権限は運営に限定されます。</p></div></section><div class="social-staff-layout"><section class="social-staff-search"><h3>スタッフに任命する領主を探す</h3><form id="social-staff-search-form" class="social-inline-form"><label class="social-sr-only" for="social-staff-query">領主の名前</label><input id="social-staff-query" name="q" minlength="2" maxlength="24" value="${esc(s.staffQuery)}" placeholder="登録済みの領主名" required><button class="social-button" type="submit">${icon('search')}検索</button></form><div id="social-staff-results">${staffList(true)}</div></section><section class="social-staff-roster"><div class="social-section-heading"><div><h3>任命中のスタッフ <span id="social-staff-count">${s.staffLoaded?num(s.staff.length)+'人':'確認中'}</span></h3><p>解任すると運営チャットと共同拠点の利用権限がなくなり、個人の城下町に戻ります。</p></div><button class="social-icon-button" data-social="staff-refresh" aria-label="スタッフ名簿を更新">${icon('refresh')}</button></div><div id="social-staff-roster">${staffList()}</div></section></div>`;
}
function staffConfirmation(targetId,action){
 requireAdmin();if(!['appoint','dismiss'].includes(action))throw Error('スタッフの操作を確認してください。');
 const target=[...s.staffCandidates,...s.staff].find(p=>String(p.id)===String(targetId));if(!target||target.isAdmin||String(target.id)===String(s.user.id))throw Error('任命・解任する領主を選び直してください。');
 const epoch=privilegeEpoch,payload={targetPlayerId:target.id,action,requestId:crypto.randomUUID()},appoint=action==='appoint';
 return{title:appoint?'この領主をスタッフに任命しますか':'スタッフを解任しますか',description:appoint?'運営チャットへの参加とログイン履歴の確認ができ、家は德川家、本拠はスタッフ共同の京都御所になります。個人の資源や武将は維持されます。':'運営チャット・ログイン履歴・共同拠点の利用権限がなくなり、任命前の家と本拠に戻ります。共同の京都御所の成長は残ります。',details:`<dl class="social-confirm-details"><dt>領主</dt><dd>${playerName(target.name,target.evaluation,target.id,target.appearance,target.avatarVersion)}</dd><dt>ID</dt><dd>${esc(target.id)}</dd><dt>権限</dt><dd>${appoint?'運営チャットへの参加':'スタッフを解任'}</dd></dl>`,confirmLabel:appoint?'この領主を任命':'スタッフを解任',danger:!appoint,onConfirm:async()=>{
   requireAdmin();if(epoch!==privilegeEpoch)throw staleIdentity();const result=await api('/admin/staff',{method:'POST',data:payload});if(epoch!==privilegeEpoch||!s.user?.isAdmin)throw staleIdentity();
   // result.user is the target player, never the logged-in operator.
   const updated=result.user;if(!updated||String(updated.id)!==String(target.id))throw Error('対象の任命状況を確認できませんでした。名簿を更新してください。');
   s.staffCandidates=s.staffCandidates.map(p=>String(p.id)===String(updated.id)?{...p,...updated}:p);setStaffRoster(result.staff);renderStaffLists();
   toast(updated.isStaff?`${playerText(updated.name,updated.evaluation)} をスタッフとして確認しました。`:`${playerText(updated.name,updated.evaluation)} はスタッフから解任されています。`);
  }};
}
function adminView(){
 if(!hasAdminChat())return empty('この画面を表示できません','この領主には利用権限がありません。','shield');
 if(!s.user.isAdmin)s.adminSection='chat';
 const sections=s.user.isAdmin?[['chat','運営チャット'],['staff','スタッフ管理'],['moderation','プレイヤー管理'],['premium','購入の確認'],['events','催事・合戦'],['announcement','御触書'],['mail','システム便']]:[['chat','運営チャット']];if(!sections.some(([id])=>id===s.adminSection))s.adminSection='chat';let content='';
 if(s.adminSection==='chat')content=chatView(channel());
 if(s.adminSection==='staff')content=staffView();
 if(s.adminSection==='announcement')content=`<form id="social-announcement-form" class="social-admin-form"><h2>御触書を届ける</h2><p>画面上部を流れる、全プレイヤー向けのお知らせです。</p><label for="social-announcement-input">お知らせ本文</label><textarea id="social-announcement-input" name="text" maxlength="300" rows="5">${esc(s.config.announcement)}</textarea><button class="social-button primary" type="submit">内容を確認する</button></form>`;
 if(s.adminSection==='mail')content=`<div class="social-admin-form"><h2>システム便を送る</h2><p>全員、または指定した領主に、便りと資源・勾玉を届けます。</p><details class="social-search-details"><summary>個別の宛先を探す</summary>${searchForm('admin')}<div id="social-admin-player-results" class="social-card-list">${playerCards(s.adminPlayers,'admin')}</div></details><form id="social-admin-mail-form"><label for="social-mail-target">宛先</label><select id="social-mail-target" name="target"><option value="all">全プレイヤー（今後登録する領主を含む）</option>${[...new Map([...s.friends,...s.adminPlayers].map(p=>[String(p.id),p])).values()].map(p=>`<option value="${esc(p.id)}">${esc(playerText(p.name,p.evaluation,p.appearance))}（${esc(p.id)}）</option>`).join('')}</select><label for="social-mail-title">件名</label><input id="social-mail-title" name="title" maxlength="60" required placeholder="例：新たな季節への贈り物"><label for="social-mail-body">本文</label><textarea id="social-mail-body" name="body" maxlength="2000" rows="5" required placeholder="領主へ届ける言葉を記してください。"></textarea><fieldset class="social-gift-fields"><legend>贈り物（任意）</legend>${Object.entries(RES).map(([k,label])=>`<label>${label}<input name="${k}" type="number" min="0" max="1000000" step="1" value="0" inputmode="numeric"></label>`).join('')}</fieldset><button class="social-button primary" type="submit">送信内容を確認する</button></form></div>`;
 return `<div class="social-admin-heading">${icon('shield')}<div><span class="social-eyebrow">${s.user.isAdmin?'ADMINISTRATION':'STAFF ROOM'}</span><h2>${s.user.isAdmin?'運営の間':'運営チャット'} ${role(s.user)}</h2></div></div>${s.user.isAdmin?`<div class="social-subtabs">${sections.map(([id,label])=>`<button data-social="admin-section" data-id="${id}" class="${s.adminSection===id?'active':''}">${label}</button>`).join('')}</div>`:''}<div class="social-actions"><button class="social-button" data-social="court-management">朝廷の役職・任命を確認</button></div>${content}`;
}
function disposeVoiceView(){voiceView?.dispose?.();voiceView=null;}
function mountVoiceView(){const host=$('#social-voice-room'),c=channel();if(host&&c&&['guild','admin'].includes(c.channel))voiceView=global.SengokuVoice?.mount?.(host,{channel:c.channel,title:c.title})||null;}
function render(){
 if(!body)return;const keepGuildEditor=Boolean(guildIconEditor?.current());destroyAvatarEditor();if(!keepGuildEditor)destroyGuildIconEditor();if(s.accountBanned||s.accountAccessPending){disposeVoiceView();renderTabs();header();clearConfirm();body.innerHTML=s.accountBanned?accountBannedView():accountAccessView();return;}if(['admin','recent-logins'].includes(s.tab)&&!hasAdminChat())s.tab='world';renderTabs();header();clearConfirm();
 if(keepGuildEditor){refreshGuildMembers();refreshGuildIcon();return;}
 disposeVoiceView();body.innerHTML=s.tab==='news'?achievementsView():s.tab==='online'?onlineView():s.tab==='guild-rankings'?guildRankingsView():s.tab==='sync'?syncView():s.tab==='recovery'?recoveryView():!s.user?registerView():s.tab==='recent-logins'?recentLoginsView():s.tab==='world'?chatView(channel()):s.tab==='guild'?guildView():s.tab==='friends'?friendsView():s.tab==='mail'?mailView():s.tab==='profile'?profileView():adminView();renderMessages();mountProfileAvatar();mountGuildIconEditor();refreshGuildIcon();refreshGuildTreasuryView();mountVoiceView();
}
function confirmUI({title,description,details,confirmLabel='実行する',danger=false,onConfirm,scope}){
 s.confirm={onConfirm,scope,returnFocus:document.activeElement};body.inert=true;$('#social-tabs').inert=true;const host=$('#social-confirm-host');
 host.innerHTML=`<section class="social-confirm" role="alertdialog" aria-modal="true" aria-labelledby="social-confirm-title"><div class="social-confirm-card"><div class="social-eyebrow">PLEASE CONFIRM</div><h2 id="social-confirm-title">${esc(title)}</h2><p>${esc(description)}</p>${details||''}<div class="social-actions"><button class="social-button subtle" data-social="confirm-cancel">戻る</button><button class="social-button ${danger?'danger':'primary'}" data-social="confirm-yes">${esc(confirmLabel)}</button></div></div></section>`;host.querySelector('[data-social="confirm-cancel"]').focus();
}
function clearConfirm(){const focus=s.confirm?.returnFocus;s.confirm=null;if(body)body.inert=false;const tabs=$('#social-tabs'),host=$('#social-confirm-host');if(tabs)tabs.inert=false;if(host)host.innerHTML='';if(focus?.isConnected)focus.focus();}
async function loadMe({token,commit=true,updateRelations=true}={}){const epoch=authEpoch,roleEpoch=privilegeEpoch,generation=commit?++meGeneration:0,r=await api('/me',{token});if(commit&&generation===meGeneration&&epoch===authEpoch&&roleEpoch===privilegeEpoch&&s.identity){acceptUser(r.user);s.management=r.user?.isAdmin===true&&String(r.user.id)===String(s.identity.id)?{playerId:String(r.user.id),recoveryAvailable:r.management?.recoveryAvailable===true}:null;refreshOperatorRecoveryAccess();if(updateRelations){s.friends=r.friends||[];s.requests=r.requests||[];applyPlayerEvaluations([...s.friends,...s.requests].filter(p=>Object.hasOwn(p,'evaluation')).map(p=>({playerId:p.id,evaluation:p.evaluation,...(Object.hasOwn(p,'appearance')?{appearance:p.appearance}:{})})));}s.unreadMail=Number(r.unreadMail)||0;header();}return r;}
async function refreshMailStatus(){
 if(mailStatusBusy||disposed||document.hidden||recoveryHeld||!s.identity||!s.user)return;
 mailStatusBusy=true;try{await loadMe({updateRelations:false});}catch(_){}finally{mailStatusBusy=false;}
}
async function loadConfig(){
 if(configBusy||disposed||document.hidden)return;configBusy=true;clearTimeout(configTimer);
 try{const r=await api('/config',{auth:false});s.config={announcement:typeof r.announcement==='string'?r.announcement:DEFAULT,onlineCount:Number(r.onlineCount)||0};s.configLoaded=true;refreshOperatorRecoveryAccess();refreshAchievementView();header();}
 catch(_){connected(false);}finally{configBusy=false;if(!disposed&&!document.hidden){refreshMailStatus();configTimer=setTimeout(loadConfig,30000);}}
}
async function loadChat(){
 const c=channel();if(!c)return;const owner=s.identity?.id,epoch=privilegeEpoch,membershipEpoch=guildEpoch,revisionEpoch=contentEpoch,key=chatKey(c),cache=s.chats.get(key)||{messages:[],after:0,rendered:false},params=new URLSearchParams({channel:c.channel});if(cache.after>0)params.set('after',String(cache.after));if(c.target)params.set('target',c.target);if(s.contentRevision!==null)params.set('contentRevision',String(s.contentRevision));
 const r=await api('/chat?'+params);if(String(owner)!==String(s.identity?.id)||s.accountBanned||c.channel==='admin'&&(epoch!==privilegeEpoch||!hasAdminChat())||c.channel==='guild'&&(membershipEpoch!==guildEpoch||!s.user?.guildId))return;
 if(revisionEpoch!==contentEpoch&&!Number.isSafeInteger(r.contentRevision))return;
 const reset=r.reset===true||revisionEpoch!==contentEpoch,map=new Map((reset?[]:cache.messages).map(m=>[String(m.id),m]));for(const m of r.messages||[])map.set(String(m.id),m);
 cache.messages=[...map.values()].sort((a,b)=>Number(a.id)-Number(b.id)).slice(-200);cache.after=reset?Number(r.nextAfter)||0:Number(r.nextAfter)||cache.after;cache.contentRevision=s.contentRevision;if(reset)cache.rendered=false;s.chats.set(key,cache);applyPlayerEvaluations([...(r.messages||[]).filter(m=>Object.hasOwn(m,'evaluation')).map(m=>({playerId:m.userId,evaluation:m.evaluation,...(Object.hasOwn(m,'appearance')?{appearance:m.appearance}:{})})),...(Array.isArray(r.playerEvaluations)?r.playerEvaluations:[])]);if(channel()&&chatKey(channel())===key)renderMessages();
}
async function loadGuild(){if(!s.user)return null;const epoch=authEpoch,membershipEpoch=guildEpoch,owner=String(s.identity?.id),guildId=String(s.user.guildId||''),r=await api(guildId?'/guild':'/guilds');if(epoch!==authEpoch||membershipEpoch!==guildEpoch||owner!==String(s.identity?.id)||guildId!==String(s.user?.guildId||''))return null;s.guild=r.guild||null;s.members=r.members||[];if(r.guilds)s.guilds=r.guilds;applyPlayerEvaluations([...s.members.filter(p=>Object.hasOwn(p,'evaluation')).map(p=>({playerId:p.id,evaluation:p.evaluation,...(Object.hasOwn(p,'appearance')?{appearance:p.appearance}:{})})),...(r.guilds||[]).filter(g=>Object.hasOwn(g,'ownerEvaluation')).map(g=>({playerId:g.ownerId,evaluation:g.ownerEvaluation,...(Object.hasOwn(g,'ownerAppearance')?{appearance:g.ownerAppearance}:{})}))]);refreshGuildMembers();refreshGuildIcon();return r;}
async function loadMail(){const r=await api('/mail');s.mail=r.mail||[];applyPlayerEvaluations(s.mail.flatMap(mail=>mail.participants||[]));}
function schedulePoll(){clearTimeout(pollTimer);pollTimer=null;if(!s.accountBanned&&!s.accountAccessPending&&!disposed&&s.open&&s.user&&!['news','online','sync','recovery','recent-logins','guild-rankings'].includes(s.tab)&&!(s.tab==='guild'&&s.guildSection==='treasury')&&!document.hidden)pollTimer=setTimeout(()=>refresh({silent:true}),5000);}
async function refresh({view=false,silent=false}={}){
 if(s.accountBanned||s.accountAccessPending){render();return;}
 if(s.tab==='news'){await loadAchievements();return;}
 if(s.tab==='guild-rankings'){await loadGuildRankings();return;}
 if(s.tab==='guild'&&s.guildSection==='treasury'){try{await loadMe();if(s.open&&!document.hidden&&s.tab==='guild'&&s.guildSection==='treasury')await loadGuildTreasury();}catch(error){if(!silent&&error.code!=='STALE_IDENTITY')toast(error.message,true);}finally{if(s.tab==='guild'&&s.guildSection==='treasury')scheduleGuildLists();else schedulePoll();}return;}
 if(s.tab==='recent-logins'){await loadRecentLogins();return;}if(s.tab==='online'){await loadOnline();return;}if(s.tab==='sync'){await global.SengokuCloudSync?.refresh?.();return;}if(s.tab==='recovery')return;if(pollBusy||disposed||!s.open||document.hidden||!s.user)return;pollBusy=true;clearTimeout(pollTimer);
 try{
  const before={guild:s.user.guildId,guildRole:s.user.guildRole,friends:s.friends.map(f=>f.id).join(','),friendDisplay:friendsSignature(),requests:JSON.stringify(s.requests),admin:s.user.isAdmin,staff:s.user.isStaff};await loadMe();if(!s.user)return;
  if(s.tab==='guild'&&(view||before.guild!==s.user.guildId||before.guildRole!==s.user.guildRole||s.guildSection==='members'))await loadGuild();
  if(s.tab==='admin'&&s.adminSection==='staff'&&s.user.isAdmin)await loadStaff();
  if(s.tab==='mail'){await loadMail();if(!s.confirm&&(!s.openedMail||view))render();}
  else if(!s.confirm&&(view||before.guild!==s.user.guildId||before.admin!==s.user.isAdmin||before.staff!==s.user.isStaff||(s.tab==='friends'&&before.friends!==s.friends.map(f=>f.id).join(','))))render();
  else if(s.tab==='friends'&&(before.friendDisplay!==friendsSignature()||before.requests!==JSON.stringify(s.requests)))refreshFriendsView();
  await loadChat();
 }catch(e){if(!silent&&e.code!=='STALE_IDENTITY')toast(e.message,true);if(e.status===401){acceptUser(null);s.error='領主情報を確認できませんでした。保存した領主データから再接続してください。';render();}}
 finally{pollBusy=false;schedulePoll();}
}
function open(tab='world'){if(disposed)return;if(s.accountBanned||s.accountAccessPending)tab='profile';if(tab==='moderation'&&s.user?.isAdmin===true&&global.SengokuModeration){close();return global.SengokuModeration.open();}if(tab==='letters'&&global.SengokuLetters){close();return global.SengokuLetters.openInbox();}if(tab==='trade'&&global.SengokuTrade){close();return global.SengokuTrade.openBox();}pauseRecentLogins();pauseGuildLists();clearTimeout(pollTimer);pollTimer=null;s.open=true;s.tab=tabs().some(t=>t.id===tab)?tab:'world';s.error='';render();if(!dialog.open)dialog.showModal();refresh({view:true});if(s.user&&!s.configLoaded&&!s.accountBanned)loadConfig();}
function close(){s.open=false;disposeVoiceView();destroyAvatarEditor();destroyGuildIconEditor();pauseRecentLogins();pauseGuildLists();clearTimeout(onlineTimer);onlineTimer=null;clearTimeout(pollTimer);pollTimer=null;clearConfirm();if(dialog.open)dialog.close();}
async function selectTab(tab){if(tab==='letters'&&global.SengokuLetters){close();await global.SengokuLetters.openInbox();return;}if(tab==='trade'&&global.SengokuTrade){close();await global.SengokuTrade.openBox();return;}pauseRecentLogins();pauseGuildLists();clearTimeout(pollTimer);pollTimer=null;clearTimeout(onlineTimer);onlineTimer=null;s.tab=tabs().some(t=>t.id===tab)?tab:'world';s.openedMail=null;render();await refresh({view:true});}
function downloadJSON(filename,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function claimGift(mailId){
 const epoch=authEpoch;const mail=s.mail.find(m=>String(m.id)===String(mailId));if(!mail?.gift)throw Error('この便りには贈り物がありません。');
 if(typeof global.SengokuBridge?.canReceiveGifts==='function'&&!global.SengokuBridge.canReceiveGifts())throw Error('ゲームの自動保存を利用できません。保存できるブラウザで受け取ってください。');
 if(typeof global.SengokuBridge?.applyGift!=='function')throw Error('ゲームの保存状態を確認できません。ゲームを再読み込みしてから受け取ってください。');
 const key=`${s.identity.id}:${mailId}`;let requestId=s.pending[key];
 if(!requestId){requestId=crypto.randomUUID();s.pending[key]=requestId;if(!saveJSON(CLAIMKEY,s.pending)){delete s.pending[key];throw Error('受け取りの記録を保存できません。ブラウザの保存設定を確認してください。');}}
 const r=await api('/mail/claim',{method:'POST',data:{mailId,requestId}});if(epoch!==authEpoch)throw staleIdentity();if(!r.receiptId||!r.gift)throw Error('受取結果を確認できませんでした。同じボタンで再確認してください。');
 const applied=await Promise.resolve(global.SengokuBridge.applyGift(r.gift,r.receiptId));if(epoch!==authEpoch)throw staleIdentity();if(!applied?.ok)throw Error(applied?.message||'ゲームへの反映を保存できませんでした。もう一度受け取りを確認してください。');
 delete s.pending[key];saveJSON(CLAIMKEY,s.pending);mail.claimed=true;toast(applied.already?'この贈り物は、すでにゲームへ反映されています。':'贈り物を受け取り、ゲームへ反映しました。');await loadMail();render();
}
async function click(event){
 const tab=event.target.closest('[data-social-tab]');if(tab){await selectTab(tab.dataset.socialTab);return;}
 const button=event.target.closest('[data-social]');if(!button)return;const command=button.dataset.social,id=button.dataset.id;
 if(command==='close'){close();return;}
 if(command==='confirm-cancel'){clearConfirm();return;}
 if(command==='confirm-yes'){const fn=s.confirm?.onConfirm;if(fn)await act('confirm',button,async()=>{await fn();clearConfirm();});return;}
 if(command==='identity-import'||command==='recovery-files'){$('#social-identity-file').click();return;}
 if(command==='recovery-open'){await selectTab('recovery');return;}
 if(command==='recovery-export'){await act(command,button,exportRecoveryBackup);return;}
 if(command==='recovery-retry'){await act(command,button,async()=>{const candidate=recovery||(recoveryHeld&&s.identity?{identity:s.identity,kind:'interrupted'}:null);if(candidate)await verifyRecovery(candidate);});return;}
 if(command==='recovery-clear'){recoveryEpoch++;recovery=null;render();return;}
 if(command==='recovery-connect'){await act(command,button,async()=>confirmUI(recoveryConfirmation(id)));return;}
 if(command==='identity-export'){if(s.identity)downloadJSON('sengoku-lord-identity.json',{format:'sengoku-lord-identity',version:1,id:s.identity.id,token:s.identity.token,name:s.user?.name||''});return;}
 if(command==='banned-recheck'){await act(command,button,async()=>{await global.SengokuCloudSync?.refresh?.();if(s.accountBanned)toast(s.accountBanned.message,true);else if(s.accountAccessPending)toast(s.accountAccessPending.message);else{render();toast('利用状態と最新の保存を確認しました。');}});return;}
 if(command==='reconnect'){await act(command,button,async()=>{await loadMe();s.error='';await global.SengokuCloudSync?.refresh?.();render();refresh({view:true});});return;}
 if(command==='sync-open'){await selectTab('sync');return;}
 if(command==='court-management'){if(!hasAdminChat())return;close();global.SengokuBridge?.openCourt?.({management:true});return;}
 if(command==='game-settings'){close();global.SengokuBridge?.openSettings?.();return;}
 if(command==='premium-open'){global.SengokuPremium?.open?.();return;}
 if(command==='evaluation-open'){close();global.SengokuBridge?.showEvaluation?.();return;}
 if(command==='sync-refresh'){await act(command,button,()=>global.SengokuCloudSync?.refresh?.());return;}
 if(command==='sync-takeover'){await act(command,button,async()=>{const r=await global.SengokuCloudSync?.takeOver?.();if(r?.writable)toast('この端末で進行を続けられます。');else toast(global.SengokuCloudSync?.getStatus?.().message||'接続状態を確認してください。',true);});return;}
 if(command==='news-refresh'||command==='news-more'){await loadAchievements({more:command==='news-more'});return;}
 if(command==='online-refresh'||command==='online-more'){await loadOnline({more:command==='online-more'});return;}
 if(command==='recent-logins-refresh'||command==='recent-logins-more'){await loadRecentLogins({more:command==='recent-logins-more'});return;}
 if(command==='guild-rankings-open'){await selectTab('guild-rankings');return;}
 if(command==='guild-rankings-refresh'||command==='guild-rankings-more'){await loadGuildRankings({more:command==='guild-rankings-more'});return;}
 if(command==='guild-section'){if(!s.user?.guildId)return;pauseGuildLists();clearTimeout(pollTimer);pollTimer=null;s.guildSection=['chat','members','treasury'].includes(id)?id:'chat';render();await refresh({view:true});return;}
 if(command==='guild-treasury-refresh'||command==='guild-treasury-more'){await loadGuildTreasury({more:command==='guild-treasury-more'});return;}
 if(command==='guild-member-role'||command==='guild-member-remove'){await act(command+':'+id,button,async()=>confirmUI(guildMemberConfirmation(id,command==='guild-member-role'?'role':'remove',button.dataset.role)));return;}
 if(command==='pair-create'){await act(command,button,async()=>{const epoch=authEpoch;await global.SengokuCloudSync?.flush?.();if(epoch!==authEpoch)throw staleIdentity();const r=await api('/devices/pair-code',{method:'POST',data:{}});if(typeof r.code!=='string'||!/^[A-Za-z0-9]{12}$/.test(r.code))throw Error('接続コードを確認できませんでした。');s.pairCode={code:r.code,expiresAt:r.expiresAt};s.tab='sync';render();});return;}
 if(command==='pair-copy'){await act(command,button,async()=>{if(!s.pairCode||Date.parse(s.pairCode.expiresAt)<=Date.now())throw Error('新しい接続コードを発行してください。');if(!global.navigator?.clipboard?.writeText)throw Error('表示された12文字のコードを別の端末へ入力してください。');await global.navigator.clipboard.writeText(s.pairCode.code);toast('接続コードをコピーしました。');});return;}
 if(command==='admin-restore'){await act(command,button,async()=>{if(!s.user?.isAdmin)throw Error('運営権限を確認してください。');const r=await global.SengokuBridge?.restoreAdminAssets?.();if(!r?.ok)throw Error(r?.message||'この端末で進行できる状態を確認してください。');await global.SengokuCloudSync?.flush?.();toast(r.message||'運営専用の武将を確認・復元しました。');});return;}
 if(command==='admin-section'){if(!hasAdminChat())return;if(id==='events'&&s.user?.isAdmin===true){if(global.SengokuEvents){close();await global.SengokuEvents.open({admin:true});}else toast('期間限定合戦を読み込めませんでした。画面を再読み込みしてください。',true);return;}if(id==='premium'&&s.user?.isAdmin===true){if(global.SengokuPremiumAdmin){await global.SengokuPremiumAdmin.open();}else toast('購入の確認画面を読み込めませんでした。画面を再読み込みしてください。',true);return;}if(id==='moderation'&&s.user?.isAdmin===true){if(global.SengokuModeration){close();await global.SengokuModeration.open();}else toast('プレイヤー管理を読み込めませんでした。画面を再読み込みしてください。',true);return;}s.adminSection=s.user.isAdmin&&['chat','staff','announcement','mail'].includes(id)?id:'chat';render();refresh({view:true});return;}
 if(command==='staff-refresh'){await act(command,button,loadStaff);return;}
 if(command==='staff-page'){if(!s.user?.isAdmin)return;const key=id==='candidates'?'staffCandidatePage':'staffPage';s[key]=Math.max(1,Number(button.dataset.page)||1);renderStaffLists();return;}
 if(command==='staff-appoint'||command==='staff-dismiss'){await act(command+':'+id,button,async()=>{confirmUI(staffConfirmation(id,command==='staff-appoint'?'appoint':'dismiss'));});return;}
 if(command==='friend-select'){s.friendId=id;render();refresh({view:true});return;}
 if(command==='mail-back'){s.openedMail=null;render();return;}
 if(command==='admin-select-player'){const p=s.adminPlayers.find(p=>String(p.id)===String(id)),select=$('#social-mail-target');if(p&&select){if(![...select.options].some(o=>o.value===String(id))){const o=document.createElement('option');o.value=id;o.textContent=`${playerText(p.name,p.evaluation,p.appearance)}（${p.id}）`;select.append(o);}select.value=id;toast(`${playerText(p.name,p.evaluation,p.appearance)} を宛先に設定しました。`);}return;}
 if(command==='logout'){confirmUI({title:'この端末の接続を解除しますか',description:'領主とクラウドの進行は残ります。この端末は同期を解除し、端末内の保存で遊べる状態になります。再接続には接続コードか領主データを使います。',confirmLabel:'接続を解除',danger:true,onConfirm:async()=>{await global.SengokuCloudSync?.flush?.();global.SengokuCloudSync?.stop?.();authEpoch++;recoveryEpoch++;recovery=null;recoveryHeld=false;clearPrivate();s.identity=null;s.user=null;s.accountBanned=null;s.accountAccessPending=null;accountEpoch++;global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();global.SengokuModeration?.refreshIdentity?.();global.SengokuPremiumRuntime?.refreshIdentity?.();global.SengokuEvents?.refreshAccess?.();global.SengokuCourt?.refreshAccess?.();global.SengokuVoice?.refreshAccess?.();global.SengokuProgress?.refresh?.();global.SengokuAlliance?.refreshAccess?.();global.SengokuConquest?.refreshAccess?.();global.SengokuNotifications?.refreshAccess?.();s.friends=[];s.requests=[];s.chats.clear();s.unreadMail=0;applyRoleAccess();try{localStorage.removeItem(IDKEY);}catch(_){}clearTimeout(pollTimer);render();}});return;}
 if(command==='guild-leave'){await act(command,button,async()=>confirmUI(guildLeaveConfirmation()));return;}
 if(command==='friend-remove'){const p=s.friends.find(f=>String(f.id)===String(id));confirmUI({title:'フレンドを解除しますか',description:`${playerText(p?.name||'この領主',p?.evaluation,p?.appearance)} とのフレンド関係を解除します。`,details:p?`<dl class="social-confirm-details"><dt>対象の領主</dt><dd>${playerName(p.name,p.evaluation,p.id,p.appearance,p.avatarVersion)}</dd><dt>公開ID</dt><dd><code>${esc(p.id)}</code></dd></dl>`:'',confirmLabel:'解除する',danger:true,onConfirm:async()=>{await api('/friends',{method:'DELETE',data:{userId:id}});s.friendId=null;await loadMe();render();}});return;}
 await act(command+':'+(id||''),button,async()=>{
  if(command==='guild-refresh'){await loadGuild();render();}
  if(command==='guild-join'){await api('/guild/join',{method:'POST',data:{guildId:id}});await loadMe();await loadGuild();render();await loadChat();toast('同盟に参加しました。');}
  if(command==='friend-request'){await api('/friends/request',{method:'POST',data:{userId:id}});await loadMe();render();toast('フレンド申請を送りました。');}
  if(command==='friend-accept'||command==='friend-reject'){await api('/friends/respond',{method:'POST',data:{userId:id,accept:command==='friend-accept'}});await loadMe();render();toast(command==='friend-accept'?'フレンドになりました。':'申請を辞退しました。');}
  if(command==='mail-refresh'){await loadMe();await loadMail();render();}
  if(command==='mail-open'){s.openedMail=id;await api('/mail/read',{method:'POST',data:{mailId:id}});const m=s.mail.find(m=>String(m.id)===String(id));if(m)m.read=true;await loadMe();render();}
  if(command==='mail-claim')await claimGift(id);
 });
}
async function submit(event){
 const form=event.target;if(!form.id?.startsWith('social-'))return;event.preventDefault();const data=new FormData(form),button=event.submitter||form.querySelector('[type=submit]');
 await act(form.id,button,async()=>{
  if(['social-staff-search-form','social-admin-search-form','social-announcement-form','social-admin-mail-form'].includes(form.id))requireAdmin();
  if(form.id==='social-guild-transfer-form'){confirmUI(guildTransferConfirmation({direction:String(data.get('direction')||''),resource:String(data.get('resource')||''),amount:String(data.get('amount')||'')}));return;}
  if(form.id==='social-register-form'){
   const name=normalizedPlayerName(data.get('name'));
   const r=await api('/session',{auth:false,method:'POST',data:{name,clan:String(data.get('clan')||'浪人'),newcomerProtection:true}}),identity={id:r.user?.id,token:r.token};if(!validIdentity(identity))throw Error('領主情報を保存できませんでした。');
   const saved=saveJSON(IDKEY,identity);installIdentity(identity,r.user);await loadMe();render();schedulePoll();await loadChat();toast(saved?'交流の間へようこそ。':'このブラウザに領主情報を保存できません。領主タブからデータを書き出してください。',!saved);
  }
  if(form.id==='social-profile-name-form'){await changeProfileName(form,data.get('name'));return;}
  if(form.id==='social-device-name-form'){global.SengokuCloudSync?.setDeviceName?.(String(data.get('name')||''));toast('この端末の名前を保存しました。');}
  if(form.id==='social-admin-recovery-form'){
   const epoch=authEpoch,selection=recoveryEpoch,roleEpoch=privilegeEpoch;let key=String(data.get('key')||'');const input=form.querySelector('[name=key]');if(input)input.value='';data.delete?.('key');
   if(!canShowOperatorRecovery()){key='';refreshOperatorRecoveryAccess();throw Error('この端末では運営の復旧操作を利用できません。');}
   if(!key||key.length>256)throw Error('初回に使用した運営登録キーを入力してください。');
   const requestId=adminRecoveryRequestId||(adminRecoveryRequestId=crypto.randomUUID()),payload={key,requestId,deviceName:global.SengokuCloudSync?.getDevice?.().name||'運営を復旧する端末'};key='';
   const pending=api('/admin/recover',{auth:false,method:'POST',data:payload});payload.key='';const r=await pending;
   if(epoch!==authEpoch||selection!==recoveryEpoch||roleEpoch!==privilegeEpoch||!canShowOperatorRecovery())throw staleIdentity();const identity={id:r.user?.id,token:r.token};if(!validIdentity(identity)||r.recovered!==true)throw Error('元の運営の領主情報を確認できませんでした。');
   adminRecoveryRequestId=null;form.reset();await verifyRecovery({identity,save:null,kind:'admin-key'});
  }
  if(form.id==='social-device-link-form'){
   const code=String(data.get('code')||'').replace(/[\s-]/g,'').trim();if(!/^[A-Za-z0-9]{12}$/.test(code))throw Error('接続コードは12文字で入力してください。');
   const epoch=authEpoch,r=await api('/devices/link',{auth:false,method:'POST',data:{code,deviceName:global.SengokuCloudSync?.getDevice?.().name||'この端末'}});if(epoch!==authEpoch)throw staleIdentity();
   const identity={id:r.user?.id,token:r.token};if(!validIdentity(identity))throw Error('接続先の領主を確認できませんでした。');form.reset();
   await verifyRecovery({identity,save:null,kind:'pair'});
  }
  if(form.id==='social-chat-form'){const c=channel(),text=String(data.get('text')||'').trim();if(!c||!text)return;await api('/chat',{method:'POST',data:{channel:c.channel,...(c.target?{target:c.target}:{}),text}});form.reset();await loadChat();$('#social-chat-input')?.focus();}
  if(form.id==='social-guild-create-form'){await api('/guild',{method:'POST',data:{name:String(data.get('name')||'').trim()}});await loadMe();await loadGuild();render();await loadChat();toast('新しい同盟を創設しました。');}
  if(form.id==='social-player-search-form'||form.id==='social-admin-search-form'||form.id==='social-staff-search-form'){
   const epoch=privilegeEpoch,query=String(data.get('q')||'').trim(),r=await api('/players?q='+encodeURIComponent(query));
   if(form.id==='social-staff-search-form'){if(epoch!==privilegeEpoch||!s.user?.isAdmin)return;s.staffQuery=query;s.staffCandidates=Array.isArray(r.players)?r.players:[];s.staffCandidatePage=1;renderStaffLists();}
   else if(form.id==='social-admin-search-form'){if(epoch!==privilegeEpoch||!s.user?.isAdmin)return;s.adminPlayers=r.players||[];const results=$('#social-admin-player-results');if(results)results.innerHTML=s.adminPlayers.length?playerCards(s.adminPlayers,'admin'):empty('領主が見つかりません','別の名前で検索してください。','search');}
   else{s.players=r.players||[];const results=$('#social-player-results');if(results)results.innerHTML=s.players.length?playerCards(s.players,'friend'):empty('領主が見つかりません','別の名前で検索してください。','search');}
  }
  if(form.id==='social-announcement-form'){const text=String(data.get('text')||'').trim();confirmUI({title:'御触書を更新しますか',description:'全プレイヤーの画面上部に表示されます。',details:`<div class="social-confirm-preview">${esc(text)||'サイトからのお知らせを非表示にします。領主の達成記録は引き続き表示します。'}</div>`,confirmLabel:'この内容で更新',onConfirm:async()=>{requireAdmin();await api('/admin/announcement',{method:'POST',data:{text}});s.config.announcement=text;renderAnnouncement();toast('御触書を更新しました。');}});}
  if(form.id==='social-admin-mail-form'){
   const target=String(data.get('target')||''),title=String(data.get('title')||'').trim(),mailBody=String(data.get('body')||'').trim();if(!title||!mailBody)throw Error('件名と本文を入力してください。');
   const gift={};for(const k of Object.keys(RES)){const amount=Number(data.get(k)||0);if(!Number.isSafeInteger(amount)||amount<0||amount>1000000)throw Error('贈り物は0〜1,000,000の整数で入力してください。');gift[k]=amount;}
   const recipientPlayer=[...s.friends,...s.adminPlayers].find(p=>String(p.id)===target),recipient=target==='all'?'全プレイヤー（今後登録する領主を含む）':playerText(recipientPlayer?.name||target,recipientPlayer?.evaluation,recipientPlayer?.appearance),payload={target,title,body:mailBody,gift:Object.values(gift).some(n=>n>0)?gift:null,requestId:crypto.randomUUID()};
   confirmUI({title:'このシステム便を送りますか',description:`宛先：${recipient}`,details:`<dl class="social-confirm-details"><dt>宛先</dt><dd>${recipientPlayer&&target!=='all'?playerName(recipientPlayer.name,recipientPlayer.evaluation,recipientPlayer.id,recipientPlayer.appearance,recipientPlayer.avatarVersion):esc(recipient)}</dd><dt>件名</dt><dd>${esc(title)}</dd><dt>贈り物</dt><dd>${esc(giftLabel(payload.gift))}</dd></dl><div class="social-confirm-preview">${esc(mailBody)}</div>`,confirmLabel:'この内容で送信',onConfirm:async()=>{requireAdmin();await api('/admin/mail',{method:'POST',data:payload});toast('システム便を送りました。');form.reset();}});
  }
 });
}
async function importIdentity(file){
 return importRecoveryFiles(file?[file]:[]);
}
function localRecoveryChoice(user){
 if(global.SengokuBridge?.hasStarted?.()===false){
  if(user?.isAdmin===true)return '<details class="domain-recovery-help"><summary>以前の進行を使わず、運営として新しく始める</summary><p>この端末ではまだゲームを開始していません。以前の未保存の進行は復元されませんが、運営の江戸城と德川家康Uで新しい進行を始められます。</p><button class="social-button" data-social="recovery-connect" data-id="new-admin">江戸城から新しく始めて接続</button></details>';
  return '<div class="social-notice">この端末ではまだゲームを開始していません。以前の進行を使わず新しく始める場合は、ゲーム画面で最初の城を選んで開始してから、引き継ぎ画面へ戻ってください。<div class="social-actions"><button class="social-button" data-social="close">ゲーム画面へ戻る</button></div></div>';
 }
 return '<details class="domain-recovery-help"><summary>以前の進行を使わず、この端末の進行で接続する</summary><p>この選択では、以前の未保存の進行は復元されません。現在この画面にある進行を、この領主の最初のクラウド保存にします。</p><button class="social-button" data-social="recovery-connect" data-id="local">この端末の進行を確認する</button></details>';
}
function recoveryView(){
 const helper=global.SengokuDomainRecovery;if(!helper)return empty('引き継ぎ機能を読み込めません','画面を再読み込みしてください。','upload');
 let pending='';
 if(recovery){const r=recovery,verified=r.verified===true,cloud=Boolean(r.snapshot?.save);
  pending=`<section class="domain-recovery-card domain-recovery-pending"><div class="domain-recovery-status-row"><span class="domain-recovery-step">${r.checking?'領主と保存を確認中':verified?'領主の認証を確認しました':'引き継ぎの確認を再開'}</span>${verified?role(r.user):''}</div><h3>${verified?playerName(r.user.name,r.user.evaluation,r.user.id,r.user.appearance,r.user.avatarVersion):'選択した領主'}</h3>${verified&&r.kind==='admin-key'?'<p class="domain-recovery-status">元の運営の登録を確認しました。使うゲーム進行を選ぶと、元の領主として接続が完了します。</p>':''}${verified?`<p>領主ID <code>${esc(r.user.id)}</code></p>`:''}${r.error?`<p class="social-feedback is-error">${esc(r.error)}</p>`:''}${r.checking?'<p>サーバーにある領主と進行を確認しています。現在の保存は変更しません。</p>':!verified?'<p>この画面を閉じず、通信を確認してから続けてください。</p><button class="social-button primary" data-social="recovery-retry">認証と保存を再確認</button>':cloud?`<p>サーバーに保存された進行があります。この進行を読み込み、同じ領主として接続します。${r.save?'選んだファイルの進行は自動で上書き送信しません。':''}</p><p class="social-small">最終保存 ${esc(date(r.snapshot.updatedAt)||'日時未記録')}</p><button class="social-button primary" data-social="recovery-connect" data-id="cloud">サーバーの進行で接続</button>`:r.prepared?`<p>サーバーにはまだゲームの進行が保存されていません。選んだゲームセーブを読み込み、この領主の進行として同期します。</p>${helper.summaryHtml(r.prepared.summary)}<button class="social-button primary" data-social="recovery-connect" data-id="file">このセーブを引き継ぐ</button>`:`<p><strong>領主の登録は確認できましたが、サーバーにゲームの進行は未保存です。</strong>以前の城・武将・資源を戻すには、以前の端末から書き出したゲームセーブも必要です。</p><button class="social-button primary" data-social="recovery-files">ゲームセーブを追加する</button>${localRecoveryChoice(r.user)}`}<div class="social-right"><button class="social-text-button" data-social="recovery-clear" ${r.checking?'disabled':''}>選んだ引き継ぎを取り消す</button></div></section>`;
 }
 const interrupted=recoveryHeld?`<div class="social-notice"><strong>前回の引き継ぎの保存が完了していません。</strong><br>自動同期を停止しています。サーバーの保存を確認し、ゲームセーブを選び直すか、この端末の進行を確認してから接続してください。${!recovery?'<div class="social-actions"><button class="social-button primary" data-social="recovery-retry">認証と保存を再確認</button></div>':''}</div>`:'';
 return interrupted+helper.guidance({adminRegistered:canShowOperatorRecovery(),hasIdentity:Boolean(s.identity)&&!recoveryHeld,operatorRecoveryAllowed:canShowOperatorRecovery()})+pending+linkForm();
}
function recoveryGuard(stage,epoch){if(epoch!==authEpoch||recovery!==stage)throw staleIdentity();}
function prepareRecovery(save,user,staffBase=null){
 const prepared=global.SengokuBridge?.prepareRecoverySave?.(save,{isAdmin:user?.isAdmin===true,isStaff:user?.isStaff===true&&user?.isAdmin!==true,staffBase});
 if(!prepared?.ok)throw Error(prepared?.message||'ゲームセーブの確認機能を読み込めませんでした。画面を再読み込みしてください。');return prepared;
}
async function verifyRecovery(candidate){
 const epoch=authEpoch,operation=++recoveryEpoch;
 const stage={identity:{id:candidate.identity.id,token:candidate.identity.token},save:candidate.save||null,kind:candidate.kind||'identity',verified:false,checking:true,error:'',user:null,snapshot:null,prepared:null};recovery=stage;s.tab='recovery';render();
 try{
  const me=await loadMe({token:stage.identity.token,commit:false});recoveryGuard(stage,epoch);if(operation!==recoveryEpoch)throw staleIdentity();
  if(String(me.user?.id)!==String(stage.identity.id))throw Error('領主IDと認証情報が一致しません。');
  const snapshot=await api('/sync',{token:stage.identity.token,background:true});recoveryGuard(stage,epoch);
  if(String(snapshot.user?.id)!==String(stage.identity.id))throw Error('接続先の領主と保存データが一致しません。');
  stage.user={...snapshot.user,isAdmin:snapshot.user.isAdmin===true,isStaff:snapshot.user.isStaff===true};stage.snapshot=snapshot;
  if(stage.kind==='admin-key'&&!stage.user.isAdmin)throw Error('現在の運営権限を確認できませんでした。認証と保存を再確認してください。');
  stage.verified=true;
  if(stage.save&&!snapshot.save)stage.prepared=prepareRecovery(stage.save,stage.user,stage.snapshot?.staffBase);
  return stage;
 }catch(error){if(error.code==='STALE_IDENTITY')throw error;stage.error=error.message||'領主と保存を確認できませんでした。';throw error;}
 finally{if(recovery===stage&&epoch===authEpoch){stage.checking=false;render();$('.domain-recovery-pending')?.scrollIntoView?.({block:'nearest'});}}
}
async function importRecoveryFiles(files){
 if(!files?.length)return;
 await act('recovery-import',null,async()=>{const epoch=authEpoch,candidate=await recoveryTools().readFiles(files,recovery);if(epoch!==authEpoch)throw staleIdentity();if(candidate)await verifyRecovery(candidate);});
}
function recoveryConfirmation(mode){
 const stage=recovery,epoch=authEpoch;if(!stage?.verified||stage.checking)throw Error('先に領主と保存を確認してください。');
 if(!['cloud','file','local','new-admin'].includes(mode))throw Error('引き継ぐ進行を選んでください。');
 const cloud=Boolean(stage.snapshot?.save);if(cloud&&mode!=='cloud'||!cloud&&mode==='cloud')throw Error('保存内容が変わりました。もう一度確認してください。');
 let selected=null,prepared=null;
 if(mode==='new-admin'){
  if(stage.user.isAdmin!==true||global.SengokuBridge?.hasStarted?.()!==false)throw Error('新しい運営の進行を始める条件を確認してください。');
  const fresh=global.SengokuBridge?.prepareNewRecoverySave?.({isAdmin:true,clan:stage.user.clan});if(!fresh?.ok)throw Error(fresh?.message||'新しい運営のセーブを準備できませんでした。画面を再読み込みしてください。');selected=fresh.save;prepared=prepareRecovery(selected,stage.user,stage.snapshot?.staffBase);
 }else if(mode!=='cloud'){selected=mode==='file'?stage.save:global.SengokuBridge?.getSave?.();if(mode==='local'&&recoveryHeld){try{const raw=localStorage.getItem('sengoku-tento-save-v2');if(raw)selected=JSON.parse(raw);}catch(_){throw Error('保存済みの進行を確認できません。ゲームセーブを選び直してください。');}}prepared=prepareRecovery(selected,stage.user,stage.snapshot?.staffBase);}
 const label=mode==='cloud'?'サーバーの進行で接続':mode==='file'?'セーブを引き継いで接続':mode==='new-admin'?'江戸城で新規開始して接続':'この端末の進行で接続';
 return{title:'この領主として再接続しますか',description:mode==='new-admin'?'以前の未保存の進行は復元されません。運営の江戸城と德川家康Uで、新しい進行を始めます。':mode==='local'?'以前の未保存の進行は復元されません。表示しているこの端末の進行を最初のクラウド保存にします。':mode==='cloud'?'サーバーの最新の進行を読み込みます。この端末の現在の進行は読み込み前にバックアップします。':'選んだゲームセーブを読み込み、同じ領主の進行として自動同期を始めます。',details:`<dl class="social-confirm-details"><dt>領主</dt><dd>${playerName(stage.user.name,stage.user.evaluation,stage.user.id,stage.user.appearance,stage.user.avatarVersion)} ${role(stage.user)}</dd><dt>ID</dt><dd>${esc(stage.user.id)}</dd></dl>${prepared?recoveryTools().summaryHtml(prepared.summary):''}`,confirmLabel:label,onConfirm:()=>commitRecovery(stage,epoch,mode,selected)};
}
async function commitRecovery(stage,epoch,mode,selected){
 recoveryGuard(stage,epoch);
 if(s.identity&&String(s.identity.id)!==String(stage.identity.id)){await global.SengokuCloudSync?.flush?.();recoveryGuard(stage,epoch);}
 const latest=await api('/sync',{token:stage.identity.token,background:true});recoveryGuard(stage,epoch);
 if(String(latest.user?.id)!==String(stage.identity.id))throw Error('接続先の領主を確認できませんでした。');
 if(Boolean(latest.save)!==Boolean(stage.snapshot?.save)||latest.user.isAdmin!==stage.user.isAdmin||Boolean(latest.user.isStaff)!==Boolean(stage.user.isStaff)){stage.snapshot=latest;stage.user=latest.user;stage.prepared=stage.save&&!latest.save?prepareRecovery(stage.save,latest.user,latest.staffBase):null;clearConfirm();render();throw Error('サーバーの保存または権限が更新されました。最新の内容を確認してから接続してください。');}
 const prepared=mode==='cloud'?null:prepareRecovery(selected,latest.user,latest.staffBase),identity={id:stage.identity.id,token:stage.identity.token};
 let previous;try{previous=localStorage.getItem(IDKEY);}catch(_){throw Error('このブラウザの保存領域を確認できません。現在の接続は変更していません。');}
 global.SengokuCloudSync?.stop?.({pending:true});
 const rollback=()=>{try{if(previous===null)localStorage.removeItem(IDKEY);else localStorage.setItem(IDKEY,previous);if(localStorage.getItem(IDKEY)!==previous)throw Error();if(s.identity)startCloud();else{global.SengokuBridge?.setSyncAccess?.({linked:false,ready:true,writable:true,reason:'local',message:''});applyRoleAccess();}return true;}catch(_){return false;}};
 if(!saveJSON(IDKEY,{...identity,pendingRecovery:true})){const restored=rollback();if(!restored)holdRecovery(identity);throw Error(restored?'領主情報を保存できませんでした。現在の接続を保持しています。':'保存領域を復元できなかったため同期を停止しています。引き継ぎ画面から再確認してください。');}
 if(prepared){let applied;try{applied=global.SengokuBridge?.applyRecoverySave?.(prepared.save,{isAdmin:latest.user.isAdmin===true,isStaff:latest.user.isStaff===true&&latest.user.isAdmin!==true,staffBase:latest.staffBase||null});}catch(_){applied={ok:false,message:'ゲームの進行を保存できませんでした。'};}if(!applied?.ok){const restored=rollback();if(!restored)holdRecovery(identity);throw Error((applied?.message||'ゲームの進行を保存できませんでした。')+(restored?' 現在の接続を保持しています。':' 同期を停止しています。引き継ぎ画面から再確認してください。'));}}
 if(!saveJSON(IDKEY,identity)){
  if(!prepared&&rollback())throw Error('接続の確定を保存できませんでした。現在の接続を保持しています。');
  holdRecovery(identity);throw Error(prepared?'進行の保存はできましたが接続の確定に失敗しました。引き継ぎ画面から再確認してください。':'接続の確定に失敗しました。同期を停止しています。引き継ぎ画面から再確認してください。');
 }
 installIdentity(identity,latest.user);s.tab='sync';render();schedulePoll();toast(mode==='cloud'?'同じ領主の保存と権限を確認し、再接続しています。':'ゲームセーブを読み込みました。領主を確認して自動同期を始めます。');
}
function holdRecovery(identity){
 saveJSON(IDKEY,{id:identity.id,token:identity.token,pendingRecovery:true});
 authEpoch++;recoveryEpoch++;clearPrivate();recoveryHeld=true;s.identity={id:identity.id,token:identity.token};s.user=null;s.friends=[];s.requests=[];s.unreadMail=0;s.tab='recovery';
 recovery={identity:s.identity,save:null,kind:'interrupted',verified:false,checking:false,error:'前回の引き継ぎの保存が完了していません。認証と保存を再確認してください。',user:null,snapshot:null,prepared:null};startCloud();render();
}
function exportRecoveryBackup(){
 if(!s.identity)throw Error('領主データがある端末で書き出してください。');
 if(recoveryHeld)throw Error('引き継ぎが途中です。先に領主と進行の組み合わせを確認してください。元の復旧ファイルはそのまま保管してください。');
 let save=global.SengokuBridge?.getSave?.();
 if(!global.SengokuCloudSync?.getStatus?.().ready){try{const raw=localStorage.getItem('sengoku-tento-save-v2');if(raw)save=JSON.parse(raw);}catch(_){}}
 const backup=recoveryTools().createBackup(s.identity,save,{name:s.user?.name||'',sourceOrigin:global.location?.origin||''});downloadJSON('sengoku-complete-backup.json',backup);toast('領主と進行の統合バックアップを書き出しました。');return{ok:true};
}
function pageClick(event){const button=event.target.closest('[data-action="community"]');if(button){event.preventDefault();open(button.dataset.communityTab||'world');}}
function lettersUpdated(event){if(String(event.detail?.ownerId||'')!==String(s.user?.id||''))return;s.unreadLetters=Math.max(0,Number(event.detail?.count)||0);header();}
function visibility(){achievementGeneration++;achievementBusy=false;clearTimeout(achievementTimer);achievementTimer=null;pauseRecentLogins();pauseGuildLists();clearTimeout(onlineTimer);onlineTimer=null;clearTimeout(configTimer);clearTimeout(pollTimer);configTimer=pollTimer=null;if(!document.hidden&&!disposed){loadConfig();loadAchievements();if(s.open)refresh({silent:true});}}
function init(){
 if(disposed||document.getElementById('community-modal'))return;const interruptedRecovery=restoreStoredIdentity();
 const pending=readJSON(CLAIMKEY,{});if(pending&&typeof pending==='object'&&!Array.isArray(pending))s.pending=Object.fromEntries(Object.entries(pending).filter(([k,v])=>k.length<240&&typeof v==='string'&&v.length<180));
 announcement=document.getElementById('announcement-bar');if(announcement){announcement.classList.add('social-announcement');announcement.innerHTML=`<button type="button" class="social-announcement-label" aria-label="御触書と領主の達成を読む">御触書</button><div class="social-announcement-window"><p class="social-announcement-text"></p></div><button type="button" class="social-announcement-toggle"></button>`;announcement.setAttribute('aria-label','御触書と領主の達成');announcement.querySelector('.social-announcement-label').addEventListener('click',()=>open('news'));announcement.querySelector('.social-announcement-toggle').addEventListener('click',()=>{s.paused=!s.paused;renderAnnouncement();});renderAnnouncement();}
 launcher=document.createElement('button');launcher.className='social-launcher';launcher.dataset.action='community';launcher.setAttribute('aria-label','交流の間を開く');launcher.innerHTML=`${icon('chat')}<span>交流</span><span class="social-unread" hidden></span>`;document.body.append(launcher);
 dialog=document.createElement('dialog');dialog.id='community-modal';dialog.className='social-dialog';dialog.setAttribute('aria-labelledby','social-dialog-title');
 dialog.innerHTML=`<header class="social-header"><div class="social-header-mon">${icon('chat')}</div><div><div class="social-eyebrow">SENGOKU COMMUNITY</div><h1 id="social-dialog-title">交流の間</h1></div><div class="social-header-status"><span id="social-connection"></span><small id="social-online-count"></small></div><button class="social-icon-button" data-social="close" aria-label="交流を閉じる">${icon('close')}</button></header><nav id="social-tabs" class="social-tabs" role="tablist" aria-label="交流のメニュー"></nav><div id="social-feedback" class="social-feedback" role="status" hidden></div><div id="social-dialog-body" class="social-body"></div><footer class="social-footer"><span>礼をもって語り、志でつながる。</span><span>ゲームは閉じずに続けられます</span></footer><div id="social-confirm-host"></div><input id="social-identity-file" type="file" accept="application/json,.json" multiple hidden>`;
 document.body.append(dialog);body=$('#social-dialog-body');dialog.addEventListener('click',click);dialog.addEventListener('submit',submit);dialog.addEventListener('input',profileNameInput);dialog.addEventListener('change',event=>{if(['social-guild-direction','social-guild-resource'].includes(event.target.id))refreshGuildTreasuryView();});
 dialog.addEventListener('close',()=>{s.open=false;disposeVoiceView();destroyAvatarEditor();destroyGuildIconEditor();pauseRecentLogins();pauseGuildLists();clearTimeout(onlineTimer);onlineTimer=null;clearTimeout(pollTimer);pollTimer=null;});dialog.addEventListener('cancel',event=>{if(s.confirm){event.preventDefault();clearConfirm();}});
 dialog.addEventListener('keydown',event=>{if(s.confirm&&event.key==='Tab'){const focusable=[...$('#social-confirm-host').querySelectorAll('button:not(:disabled),input,textarea,select')];if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement))){event.preventDefault();first.focus();}}return;}if(event.target.id==='social-chat-input'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();event.target.form.requestSubmit();}});
 $('#social-identity-file').addEventListener('change',event=>{const files=Array.from(event.target.files||[]);event.target.value='';importRecoveryFiles(files);});
 global.addEventListener?.('sengoku:letters-updated',lettersUpdated);document.addEventListener('click',pageClick);document.addEventListener('visibilitychange',visibility);syncUnsubscribe=global.SengokuCloudSync?.subscribe?.(renderSyncStatus);renderTabs();header();startCloud();loadConfig();loadAchievements();
 if(interruptedRecovery){open('recovery');verifyRecovery({identity:s.identity,save:null,kind:'interrupted'}).catch(error=>{if(error.code!=='STALE_IDENTITY')toast(error.message,true);});return;}
 if(s.identity){const epoch=authEpoch;s.meLoading=true;loadMe().catch(e=>{if(epoch===authEpoch){s.error=e.message;acceptUser(null);}}).finally(()=>{if(epoch!==authEpoch)return;s.meLoading=false;if(s.open){render();refresh({view:true});}});}
}
async function dispose(){disposed=true;disposeVoiceView();global.SengokuVoice?.dispose?.();global.SengokuEvents?.dispose?.();global.removeEventListener?.('sengoku:letters-updated',lettersUpdated);global.SengokuLetters?.dispose?.();global.SengokuTrade?.dispose?.();global.SengokuModeration?.dispose?.();global.SengokuPremiumRuntime?.dispose?.();global.SengokuPremiumAdmin?.dispose?.();achievementGeneration++;clearTimeout(achievementTimer);achievementTimer=null;destroyAvatarEditor();clearRecentLogins();clearGuildData();recoveryEpoch++;recovery=null;syncUnsubscribe?.();global.SengokuCloudSync?.stop?.();clearTimeout(onlineTimer);clearTimeout(configTimer);clearTimeout(pollTimer);for(const c of controllers)c.abort();controllers.clear();document.removeEventListener('click',pageClick);document.removeEventListener('visibilitychange',visibility);dialog?.remove();launcher?.remove();}
function moderationRequest(route,options={}){
 const method=options.method||'GET',valid=method==='GET'&&/^\/admin\/moderation\/(?:players|target|bans)(?:\?[^#]*)?$/.test(route)||method==='POST'&&route==='/admin/moderation';
 if(!valid)throw Error('プレイヤー管理の操作を確認してください。');
 if(!s.user?.isAdmin||s.accountBanned)throw Error('この操作には運営権限が必要です。');
 const owner=String(s.identity?.id),generation=authEpoch,privilege=privilegeEpoch;
 return api(route,{...options,background:true}).then(result=>{if(owner!==String(s.identity?.id)||generation!==authEpoch||privilege!==privilegeEpoch||!s.user?.isAdmin||s.accountBanned)throw staleIdentity();return result;});
}
function getEventContext(){
 const pending=Boolean(recoveryHeld||s.accountAccessPending||s.identity&&!s.user),banned=Boolean(s.accountBanned),ready=Boolean(s.user&&s.identity&&String(s.user.id)===String(s.identity.id)&&!pending&&!banned);
 const commands=ready?global.SengokuBridge?.getEventAccess?.():null;
 return {epoch:authEpoch,privilegeEpoch,accountEpoch,playerId:s.identity?String(s.identity.id):'',user:ready?{id:String(s.user.id),name:s.user.name,isAdmin:s.user.isAdmin===true,isStaff:s.user.isStaff===true,isBanned:false,avatarVersion:s.user.avatarVersion||null,evaluation:publicEvaluation(s.user.evaluation)}:null,isAdmin:ready&&s.user.isAdmin===true,connected:s.connected,pending,banned,commands:commands?{...commands}:null};
}
function getExpansionContext(){
 const context=getEventContext(),guildId=context.user&&s.user.guildId?String(s.user.guildId):null;
 return {...context,guildEpoch,guildId,guildName:context.user?s.user.guildName||null:null,guildRole:context.user?s.user.guildRole||null:null,user:context.user?{...context.user,guildId,guildName:s.user.guildName||null,guildRole:s.user.guildRole||null}:null,writable:context.commands?.writable===true};
}
async function expansionRequest(route,options={}){
 const method=options.method||'GET',path=String(route).split('?')[0];
 const read=method==='GET'&&['/progress','/alliance','/conquest','/conquest/history','/protection','/notifications'].includes(path);
 const write=method==='POST'&&['/progress/claim','/progress/exchange','/progress/acknowledge','/alliance/policy','/alliance/apply','/alliance/invite','/alliance/membership','/alliance/operations/create','/alliance/operations/rsvp','/alliance/operations/assign','/alliance/operations/cancel','/alliance/operations/complete','/alliance/rally/join','/alliance/rally/launch','/alliance/reinforcements/send','/alliance/units/recall','/alliance/units/claim','/alliance/treasury/request','/alliance/treasury/approve','/alliance/treasury/claim','/conquest/join','/conquest/action','/protection/end','/notifications/preferences','/notifications/subscribe','/notifications/unsubscribe','/guild/join'].includes(path)&&route===path;
 if(!read&&!write||typeof route!=='string'||route.length>500||route.includes('#'))throw Error('成長・同盟・大会の操作を確認してください。');
 const initial=getExpansionContext();if(!initial.user)throw Object.assign(Error(initial.banned?'この領主は利用停止中です。':'交流で領主登録・接続を確認してください。'),{code:'EXPANSION_IDENTITY_REQUIRED'});
 const scoped=path.startsWith('/alliance')||path.startsWith('/conquest');
 const verify=()=>{const current=getExpansionContext();if(initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.privilegeEpoch!==current.privilegeEpoch||initial.playerId!==current.playerId||scoped&&initial.guildEpoch!==current.guildEpoch||!current.user||current.pending||current.banned)throw staleIdentity();};
 verify();const result=await api(route,{method,data:options.data,background:true,identityEpoch:initial.epoch});verify();
 if(path==='/guild/join'||path==='/alliance/membership')await refresh({view:true});
 return result;
}
function getCourtContext(){const context=getEventContext();return{epoch:context.epoch,privilegeEpoch:context.privilegeEpoch,accountEpoch:context.accountEpoch,playerId:context.playerId,user:context.user,pending:context.pending,banned:context.banned,connected:context.connected};}
function getVoiceContext(){
 const context=getEventContext();
 return{...context,guildEpoch,guildId:context.user&&s.user.guildId?String(s.user.guildId):null,guildName:context.user?s.user.guildName||null:null};
}
async function voiceRequest(route,options={}){
 const method=options.method||'GET',invalid=()=>Object.assign(Error('通話の操作を確認してください。'),{status:400,code:'VOICE_INVALID_ROUTE'});
 if(typeof route!=='string'||route.length>250||route.includes('#')||route.split('?').length>2)throw invalid();
 const [path,query='']=route.split('?'),params=new URLSearchParams(query),entries=[...params.entries()],sessionPattern=/^vc_[a-f0-9]{32}$/;
 const room=method==='GET'&&path==='/voice/room',poll=method==='GET'&&path==='/voice/poll',write=method==='POST'&&['/voice/join','/voice/heartbeat','/voice/signal','/voice/leave'].includes(path);
 const keys=room?['channel']:poll?['sessionId','after']:[];
 if(!room&&!poll&&!write||write&&query||new Set(entries.map(([key])=>key)).size!==entries.length||entries.some(([key])=>!keys.includes(key)))throw invalid();
 if(room&&(entries.length!==1||!['guild','admin'].includes(params.get('channel')))||poll&&(!sessionPattern.test(params.get('sessionId')||'')||params.has('after')&&!/^\d{1,15}$/.test(params.get('after'))))throw invalid();
 const data=options.data,channel=room?params.get('channel'):path==='/voice/join'?data?.channel:null;
 if(write&&(!data||typeof data!=='object'||Array.isArray(data))||path==='/voice/join'&&!['guild','admin'].includes(channel)||write&&path!=='/voice/join'&&!sessionPattern.test(data?.sessionId||''))throw invalid();
 const initial=getVoiceContext();
 const permitted=context=>!disposed&&Boolean(context.user)&&!context.pending&&!context.banned&&(!channel||channel==='guild'&&Boolean(context.guildId)||channel==='admin'&&(context.user.isAdmin||context.user.isStaff));
 if(!permitted(initial))throw Object.assign(Error('所属同盟・通話権限と領主の接続を確認してください。'),{status:403,code:'VOICE_ACCESS_REQUIRED'});
 const verify=()=>{const current=getVoiceContext();if(!permitted(current)||initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.privilegeEpoch!==current.privilegeEpoch||initial.guildEpoch!==current.guildEpoch||initial.playerId!==current.playerId)throw staleIdentity();};
 verify();const result=await api(route,{method,data:write?data:undefined,auth:true,background:true,identityEpoch:initial.epoch,keepalive:path==='/voice/leave'});verify();return result;
}
async function branchRequest(route,options={}){
 const method=options.method||'GET',read=method==='GET'&&route==='/branches',write=method==='POST'&&/^\/branches\/(?:build|upgrade|repair)$/.test(route);
 if(!read&&!write)throw Object.assign(Error('支拠点の操作を確認してください。'),{status:400});
 const initial=getCourtContext();if(!initial.user||initial.pending||initial.banned)throw Object.assign(Error('接続中の領主を確認してください。'),{status:403,code:'BRANCH_IDENTITY_REQUIRED',retryable:true});
 const verify=()=>{const current=getCourtContext();if(initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.privilegeEpoch!==current.privilegeEpoch||initial.playerId!==current.playerId||!current.user||current.pending||current.banned)throw staleIdentity();};
 if(write){const sync=global.SengokuCloudSync,status=sync?.getStatus?.();if(global.SengokuBridge?.hasStarted?.()===false||!status?.linked||!status.ready||!status.writable||typeof options.data?.deviceId!=='string'||options.data.deviceId!==sync?.getDevice?.().id||!Number.isSafeInteger(options.data?.expectedRevision)||options.data.expectedRevision!==status.revision||typeof options.data?.campaignId!=='string'||!options.data.campaignId||!Number.isSafeInteger(options.data?.sequence)||options.data.sequence<0)throw Object.assign(Error('支拠点の最新の進行と操作端末を確認してください。'),{status:409,code:'BRANCH_SYNC_REQUIRED',retryable:true});}
 verify();const result=await api(route,{method,data:options.data,auth:true,background:true,identityEpoch:initial.epoch});verify();return result;
}
async function courtRequest(route,options={}){
 const method=options.method||'GET';if(typeof route!=='string'||route.length>1400||route.includes('#'))throw Object.assign(Error('御所の操作を確認してください。'),{status:400});
 const [pathname,query='']=route.split('?'),params=new URLSearchParams(query),thread=/^\/court\/audiences\/ca_[a-f0-9]{32}$/.test(pathname),reply=/^\/court\/audiences\/ca_[a-f0-9]{32}\/replies$/.test(pathname),read=method==='GET'&&(['/court','/court/chat','/court/audiences','/staff/court'].includes(pathname)||thread),write=method==='POST'&&(['/court/chat','/court/audiences','/admin/court/leader'].includes(pathname)||reply),keys=pathname==='/court/chat'?['after','contentRevision','limit']:pathname==='/court/audiences'?['cursor','limit']:thread?['before','limit']:[];
 const entries=[...params.entries()],validQuery=entries.every(([key,value])=>keys.includes(key)&&value.length<=1000&&![...value].some(c=>c.charCodeAt(0)<32)&&(key==='cursor'||/^\d+$/.test(value)))&&new Set(entries.map(([key])=>key)).size===entries.length&&(!params.has('limit')||Number(params.get('limit'))>=1&&Number(params.get('limit'))<=50);
 if(!read&&!write||!validQuery||write&&query||route.split('?').length>2)throw Object.assign(Error('御所の操作を確認してください。'),{status:400});
 const initial=getCourtContext(),management=pathname==='/staff/court'||pathname==='/admin/court/leader';
 if(!initial.user||initial.pending||initial.banned)throw Object.assign(Error('領主の接続を確認してから参内してください。'),{status:403});
 if(management&&!initial.user.isAdmin&&!initial.user.isStaff||pathname==='/admin/court/leader'&&!initial.user.isAdmin)throw Object.assign(Error('朝廷の管理権限を確認してください。'),{status:403});
 const verify=()=>{const current=getCourtContext();if(initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.privilegeEpoch!==current.privilegeEpoch||initial.playerId!==current.playerId||!current.user||current.pending||current.banned)throw staleIdentity();};
 const authoritySequence=pathname==='/court'&&method==='GET'?++courtAccessSequence:0;
 verify();const result=await api(route,{method,data:options.data,auth:true,background:true,identityEpoch:initial.epoch});verify();if(authoritySequence&&authoritySequence===courtAccessSequence)global.SengokuBridge?.applyCourtAccess?.({isCourtEmperor:result.self?.isCourtEmperor===true},initial);return result;
}
async function eventRequest(route,options={}){
 const method=options.method||'GET',publicRead=method==='GET'&&/^\/events(?:\/ev_[a-f0-9]{32})?$/.test(route),adminRead=method==='GET'&&route==='/admin/events',adminWrite=method==='POST'&&/^\/admin\/events\/(?:generate|ev_[a-f0-9]{32}\/(?:publish|end|discard))$/.test(route),battle=method==='POST'&&/^\/events\/ev_[a-f0-9]{32}\/battle$/.test(route),admin=adminRead||adminWrite;
 if(!publicRead&&!admin&&!battle)throw Object.assign(Error('期間限定合戦の操作を確認してください。'),{status:400});
 const initial=getEventContext();
 if(!publicRead&&!initial.user)throw Object.assign(Error(initial.banned?'この領主は利用停止中です。':'接続中の領主を確認してから利用してください。'),{status:403});
 if(admin&&!initial.isAdmin)throw Object.assign(Error('この操作には運営権限が必要です。'),{status:403});
 const verify=()=>{const current=getEventContext();if(initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.playerId!==current.playerId||admin&&(initial.privilegeEpoch!==current.privilegeEpoch||!current.isAdmin)||!publicRead&&(!current.user||current.pending||current.banned))throw staleIdentity();};
 if(battle){
  if(global.SengokuBridge?.hasStarted?.()===false)throw Object.assign(Error('はじめに本拠を選び、領主の進行を保存してください。'),{status:409});
  const sync=global.SengokuCloudSync,status=sync?.getStatus?.();
  // The app transaction bridge flushes and freezes the shared command balance.
  // A direct/old UI request must not skip its writer revision or reconciliation.
  if(!status?.linked||!status.ready||!status.writable||typeof options.data?.deviceId!=='string'||options.data.deviceId!==sync?.getDevice?.().id||!Number.isSafeInteger(options.data?.expectedRevision)||options.data.expectedRevision!==status.revision)throw Object.assign(Error('指令の同期を確認してから出陣してください。画面が古い場合は再読み込みしてください。'),{status:409,code:'EVENT_SYNC_REQUIRED'});
 }
 verify();
 const result=await api(route,{method,data:options.data,auth:Boolean(s.identity),background:true,identityEpoch:initial.epoch});verify();
 applyPlayerEvaluations(result.playerEvaluations||[]);
 if(battle&&result.rewardMailIds?.length)refreshMailStatus().catch(()=>{});
 return result;
}
async function roamingRequest(route,options={}){
 const method=options.method||'GET',publicRead=method==='GET'&&(route==='/roaming/deployment'||/^\/roaming\/map\?castleId=[A-Za-z0-9_-]{1,90}$/.test(route)),read=method==='GET'&&route==='/roaming/history',battle=method==='POST'&&route==='/roaming/battle',manageRead=method==='GET'&&route==='/staff/roaming',staffWrite=method==='POST'&&(route==='/staff/roaming/proposals'||/^\/staff\/roaming\/proposals\/[A-Za-z0-9_-]{1,90}\/cancel$/.test(route)),adminWrite=method==='POST'&&(route==='/admin/roaming/deployment'||/^\/admin\/roaming\/proposals\/[A-Za-z0-9_-]{1,90}\/(?:approve|reject)$/.test(route));
 if(!publicRead&&!read&&!battle&&!manageRead&&!staffWrite&&!adminWrite)throw Object.assign(Error('野良兵戦の操作を確認してください。'),{status:400});
 const initial=getEventContext(),management=manageRead||staffWrite||adminWrite;
 if(!publicRead&&!initial.user)throw Object.assign(Error(initial.banned?'この領主は利用停止中です。':'接続中の領主を確認してから利用してください。'),{status:403,code:'ROAMING_IDENTITY_REQUIRED',retryable:true});
 const permitted=context=>!management||Boolean(context.user?.isAdmin||!adminWrite&&context.user?.isStaff);
 if(!permitted(initial))throw Object.assign(Error('この操作に必要な管理権限を確認してください。'),{status:403});
 const verify=()=>{if(publicRead)return;const current=getEventContext();if(initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.privilegeEpoch!==current.privilegeEpoch||initial.playerId!==current.playerId||!current.user||current.pending||current.banned||!permitted(current))throw Object.assign(staleIdentity(),{retryable:true});};
 if(battle){
  if(global.SengokuBridge?.hasStarted?.()===false)throw Object.assign(Error('はじめに本拠を選び、領主の進行を保存してください。'),{status:409,code:'ROAMING_CAMPAIGN_REQUIRED',retryable:true});
  const sync=global.SengokuCloudSync,status=sync?.getStatus?.();
  // The campaign transaction bridge owns freezing, flushing and reconciliation.
  if(!status?.linked||!status.ready||!status.writable||typeof options.data?.deviceId!=='string'||options.data.deviceId!==sync?.getDevice?.().id||!Number.isSafeInteger(options.data?.expectedRevision)||options.data.expectedRevision!==status.revision)throw Object.assign(Error('指令の同期を確認してから出陣してください。画面が古い場合は再読み込みしてください。'),{status:409,code:'ROAMING_SYNC_REQUIRED',retryable:true});
 }
 verify();
 const result=await api(route,{method,data:options.data,auth:!publicRead,background:true,identityEpoch:initial.epoch});verify();
 return result;
}
async function covertRequest(route,options={}){
 const method=options.method||'GET',read=method==='GET'&&/^\/covert(?:\?cursor=[A-Za-z0-9_%-]+&limit=100)?$/.test(route),write=method==='POST'&&/^\/covert\/(?:hire|dispatch|recall|retaliate)$/.test(route);
 if(!read&&!write)throw Object.assign(Error('派遣部隊の操作を確認してください。'),{status:400});
 const initial=getEventContext();
 if(!initial.user)throw Object.assign(Error(initial.banned?'この領主は利用停止中です。':'接続中の領主を確認してから利用してください。'),{status:403,code:'COVERT_IDENTITY_REQUIRED',retryable:true});
 const verify=()=>{const current=getEventContext();if(initial.epoch!==current.epoch||initial.accountEpoch!==current.accountEpoch||initial.privilegeEpoch!==current.privilegeEpoch||initial.playerId!==current.playerId||!current.user||current.pending||current.banned)throw Object.assign(staleIdentity(),{retryable:true});};
 if(write){
  if(global.SengokuBridge?.hasStarted?.()===false)throw Object.assign(Error('はじめに本拠を選び、領主の進行を保存してください。'),{status:409,code:'COVERT_CAMPAIGN_REQUIRED',retryable:true});
  const sync=global.SengokuCloudSync,status=sync?.getStatus?.();
  if(!status?.linked||!status.ready||!status.writable||typeof options.data?.deviceId!=='string'||options.data.deviceId!==sync?.getDevice?.().id||!Number.isSafeInteger(options.data?.expectedRevision)||options.data.expectedRevision!==status.revision)throw Object.assign(Error('部隊の同期を確認してから操作してください。画面が古い場合は再読み込みしてください。'),{status:409,code:'COVERT_SYNC_REQUIRED',retryable:true});
 }
 verify();const result=await api(route,{method,data:options.data,background:true,identityEpoch:initial.epoch});verify();return result;
}
function tradeRequest(route,options={}){
 const method=options.method||'GET';
 const read=method==='GET'&&(/^\/trades(?:\/(?:recipient|tr_[a-f0-9]{32}))?(?:\?[^#]*)?$/.test(route)||/^\/players\?q=[^&#]+$/.test(route));
 const write=method==='POST'&&/^\/trades(?:\/tr_[a-f0-9]{32}\/(?:accept|cancel|reject|claim))?$/.test(route);
 if(!read&&!write)throw Error('交易の操作を確認してください。');
 if(!s.user)throw Error('領主登録・ログイン後に交易を利用できます。');
 return api(route,{...options,background:true});
}
function premiumReviewRequest(route,options={}){
 const method=options.method||'GET';
 if(!(method==='GET'&&/^\/admin\/premium\/reviews(?:\?[^#]*)?$/.test(route)||method==='POST'&&route==='/admin/premium/reviews'))throw Error('購入の確認操作を確認してください。');
 if(!s.user?.isAdmin||!s.identity||recoveryHeld||s.accountAccessPending||s.accountBanned)throw Error('この操作には接続中の運営権限が必要です。');
 const owner=String(s.identity.id),epoch=authEpoch,privilege=privilegeEpoch;
 return api(route,{method,data:options.body??options.data,background:true,identityEpoch:epoch}).then(result=>{
  if(owner!==String(s.identity?.id)||epoch!==authEpoch||privilege!==privilegeEpoch||!s.user?.isAdmin||recoveryHeld||s.accountAccessPending||s.accountBanned)throw staleIdentity();
  return result;
 });
}
function premiumRequest(route,options={}){
 const method=options.method||'GET';
 if(!(route==='/premium'&&method==='GET'||route==='/premium/checkout'&&method==='POST'||route==='/premium/appearance'&&method==='PUT'))throw Error('有料商品の操作を確認してください。');
 if(!s.user||!s.identity||recoveryHeld||s.accountAccessPending)throw Error('領主登録・ログイン後に利用できます。');
 if(s.accountBanned)throw accountBannedError();
 const owner=String(s.identity.id),epoch=authEpoch;
 return api(route,{...options,background:true,identityEpoch:epoch}).then(result=>{
  if(owner!==String(s.identity?.id)||epoch!==authEpoch||s.accountBanned)throw staleIdentity();
  return result;
 });
}
function acceptPremiumAppearance(playerId,value){
 const owner=String(playerId||'');if(!s.user||owner!==String(s.user.id)||owner!==String(s.identity?.id))return;
 const appearance=global.SengokuPremiumRuntime?.cleanAppearance?.(value)||null;
 applyPlayerEvaluations([{playerId:owner,appearance}]);
}
global.SengokuSocial={open,close,getExpansionContext,expansionRequest,getVoiceContext,voiceRequest,courtRequest,getCourtContext,branchRequest,eventRequest,roamingRequest,covertRequest,getEventContext,premiumRequest,premiumReviewRequest,acceptPremiumAppearance,getPremiumContext:()=>({epoch:authEpoch,playerId:s.identity?String(s.identity.id):'',user:s.user&&!recoveryHeld?{id:String(s.user.id),name:s.user.name,avatarVersion:s.user.avatarVersion||null,evaluation:publicEvaluation(s.user.evaluation)}:null,connected:s.connected,pending:!!s.identity&&!s.user,banned:!!s.accountBanned}),exportRecoveryBackup,tradeRequest,moderationRequest,observeContentRevision,getModerationContext:()=>({epoch:authEpoch,privilegeEpoch}),getUser:()=>s.user?{id:s.user.id,name:s.user.name,clan:s.user.clan,guildId:s.user.guildId||null,guildName:s.user.guildName||null,guildRole:s.user.guildRole||null,guildIconVersion:s.user.guildIconVersion||null,isAdmin:s.user.isAdmin===true,isStaff:s.user.isStaff===true,isBanned:s.user.isBanned===true,avatarVersion:s.user.avatarVersion||null,evaluation:publicEvaluation(s.user.evaluation),appearance:global.SengokuPremiumRuntime?.getAppearance?.()||null}:null,lettersRequest:(route,options={})=>{if(!/^\/letters(?:\/(?:summary|recipient|lt_[a-f0-9]{32}(?:\/(?:messages|read))?))?(?:\?[^#]*)?$/.test(route)||!['GET','POST'].includes(options.method||'GET'))throw Error('書状の操作を確認してください。');if(!s.user)throw Error('領主登録・ログイン後に書状を利用できます。');return api(route,{...options,background:true});},walkingRequest:(route,options={})=>{if(!['/walking/start','/walking/claim'].includes(route)||options.method!=='POST')throw Error('ウォーキングの操作を確認してください。');if(!s.user)throw Error('接続中の領主を確認してください。');return api(route,{...options,background:true});},fieldRequest:async(route,options={})=>{if(!/^\/field(?:\/me|\/attack|\/diplomacy)?(?:\?[^#]*)?$/.test(route))throw Error('フィールドの操作を確認してください。');const result=await api(route,options);if(route==='/field/attack'&&options.method==='POST'&&result.battle)refreshMailStatus();return result;},staffRequest:(route,options={})=>{const method=options.method||'GET';if(!(route==='/staff/base'&&method==='GET'||route==='/staff/base/upgrade'&&method==='POST'))throw Error('スタッフ共同拠点の操作を確認してください。');if(!s.user?.isStaff&&!s.user?.isAdmin)throw Error('スタッフ権限を確認してください。');return api(route,options);},guildRequest:(route,options={})=>{if(route!=='/guild/treasury/transfer'||options.method!=='POST')throw Error('同盟金庫の操作を確認してください。');return api(route,options);},refresh:()=>refresh({view:true}),dispose,setWorldClock:async values=>{if(!s.user?.isAdmin)throw Error('運営権限が必要です。');return api('/world-clock',{method:'PATCH',data:values});}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);

