/* 戦国大戦・交流の間。認証キーはサーバー側のみ。 */
(function(global){
'use strict';
const IDKEY='sengoku-online-identity-v1', CLAIMKEY='sengoku-mail-claims-v1';
const DEFAULT='戦国VSへようこそ。一城を育て、武将とともに、あなたの天下を描いてください。';
const RES={gold:'金',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
const s={identity:null,user:null,friends:[],requests:[],unreadMail:0,unreadLetters:0,config:{announcement:DEFAULT,adminClaimed:true,adminRecoveryAvailable:false,onlineCount:0},configLoaded:false,connected:false,tab:'world',friendId:null,chats:new Map(),guilds:[],guild:null,members:[],mail:[],players:[],adminPlayers:[],adminSection:'chat',staff:[],staffCandidates:[],staffLoaded:false,staffQuery:'',staffPage:1,staffCandidatePage:1,openedMail:null,open:false,meLoading:false,error:'',paused:false,pending:{},confirm:null,onlinePlayers:[],onlineTotal:0,onlineCursor:null,onlineLoaded:false,onlineError:'',pairCode:null,syncStatus:null};
let dialog,body,launcher,announcement,configTimer=null,pollTimer=null,configBusy=false,pollBusy=false,disposed=false,authEpoch=0,privilegeEpoch=0,onlineTimer=null,onlineEpoch=0,onlineBusy=false,syncUnsubscribe=null,recentLoginTimer=null,recentLoginGeneration=0,recentLoginBusy=false,avatarEditor=null,avatarGeneration=0,avatarMutationEpoch=0;
s.recentLogins={players:[],total:0,cursor:null,serverNow:null,windowStart:null,loaded:false,error:''};
let guildEpoch=0,guildListGeneration=0,guildListTimer=null,treasuryBusy=false,rankingsBusy=false;
s.guildSection='chat';s.guildTreasury={guildId:null,balance:null,ledger:[],cursor:null,loaded:false,error:'',serverNow:null};s.guildRankings={guilds:[],total:0,cursor:null,loaded:false,error:'',serverNow:null};
let achievementTimer=null,achievementBusy=false,achievementGeneration=0;
s.achievements={events:[],cursor:null,loaded:false,error:'',serverNow:null,expanded:false};
const guildRoleName=role=>({owner:'盟主',officer:'副盟主',member:'メンバー'})[role]||'メンバー';
const busy=new Set(),controllers=new Set();
let recovery=null,recoveryEpoch=0,recoveryHeld=false,adminRecoveryRequestId=null;
let mailStatusBusy=false,meGeneration=0;
const recoveryTools=()=>{if(!global.SengokuDomainRecovery)throw Error('復旧機能を読み込めませんでした。画面を再読み込みしてください。');return global.SengokuDomainRecovery;};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=selector=>dialog?.querySelector(selector);
const num=n=>Math.max(0,Number(n)||0).toLocaleString('ja-JP');
const paths={chat:'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5',close:'m6 6 12 12M18 6 6 18',mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7',people:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',flag:'M5 21V3m0 1c5-4 8 4 14 0v10c-6 4-9-4-14 0',send:'m3 4 18 8-18 8 4-8-4-8Zm4 8h14',pause:'M8 5v14M16 5v14',play:'m8 4 12 8-12 8V4Z',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',search:'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-2 5.5 6',gift:'M3 9h18v4H3V9Zm2 4v8h14v-8M12 9v12M12 9C5 9 5 3 8 3s4 6 4 6Zm0 0c7 0 7-6 4-6s-4 6-4 6',user:'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM4 21v-2a8 8 0 0 1 16 0v2',refresh:'M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5M4 16a9 9 0 0 0 15 3l3-3m0 5v-5h-5'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.chat}"/></svg>`;
const first=name=>esc(Array.from(String(name||'領主'))[0]);
const socialAvatar=(user,size='')=>global.SengokuAvatar?.markup(user,size)||`<span class="social-avatar ${['small','profile'].includes(size)?size:''}">${first(user?.name)}</span>`;
const role=p=>p?.isAdmin?'<span class="social-role">運営</span>':p?.isStaff?'<span class="social-role is-staff">スタッフ</span>':'';
const evaluationKey=value=>global.SengokuEvaluationUI?.key?.(value)||'';
const evaluationBadge=value=>global.SengokuEvaluationUI?.badge?.(value)||'';
function publicEvaluation(value){if(!evaluationKey(value))return null;const {version,score,maxScore,rankId,rankName,rankIndex}=value;return{version,score,maxScore,rankId,rankName,rankIndex};}
function playerName(name,evaluation,playerId=''){return `<span class="player-evaluation-person"><span class="player-evaluation-name">${esc(name)}</span><span class="player-evaluation-slot"${playerId?` data-player-evaluation="${esc(playerId)}"`:''} data-evaluation-key="${esc(evaluationKey(evaluation))}">${evaluationBadge(evaluation)}</span></span>`;}
function playerText(name,evaluation){const label=global.SengokuEvaluationUI?.label?.(evaluation);return String(name||'領主')+(label?`（${label}）`:'');}
function applyPlayerEvaluations(rows){
 const updates=new Map((Array.isArray(rows)?rows:[]).filter(row=>row&&['string','number'].includes(typeof row.playerId)&&Object.hasOwn(row,'evaluation')).map(row=>[String(row.playerId),publicEvaluation(row.evaluation)]));if(!updates.size)return;
 const update=(person,id='id',field='evaluation')=>{if(person&&updates.has(String(person[id])))person[field]=updates.get(String(person[id]));};
 update(s.user);for(const key of ['friends','requests','members','players','adminPlayers','staff','staffCandidates','onlinePlayers'])for(const person of s[key])update(person);
 for(const person of s.recentLogins.players)update(person);
 for(const cache of s.chats.values())for(const message of cache.messages||[])update(message,'userId');
 for(const event of s.achievements.events)update(event,'playerId','playerEvaluation');
 for(const entry of s.guildTreasury.ledger)update(entry,'playerId','playerEvaluation');
 for(const guild of [...s.guilds,...s.guildRankings.guilds])update(guild,'ownerId','ownerEvaluation');
 for(const mail of s.mail)for(const person of mail.participants||[])update(person,'playerId');
 // Only replace the non-interactive badge slot. Polling must leave composing
 // text, selection, focused controls and the profile's image editor mounted.
 for(const node of dialog?.querySelectorAll?.('[data-player-evaluation]')||[]){const value=updates.get(String(node.dataset.playerEvaluation));if(!updates.has(String(node.dataset.playerEvaluation)))continue;const key=evaluationKey(value);if(node.dataset.evaluationKey!==key){node.innerHTML=evaluationBadge(value);node.dataset.evaluationKey=key;}}
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
function clearGuildData({resetSection=true}={}){guildEpoch++;pauseGuildLists();s.guild=null;s.members=[];s.guildTreasury={guildId:null,balance:null,ledger:[],cursor:null,loaded:false,error:'',serverNow:null};if(resetSection)s.guildSection='chat';for(const key of s.chats.keys())if(key.startsWith('guild:'))s.chats.delete(key);for(const selector of ['#social-guild-ledger','#social-guild-balances','#social-guild-members']){const node=$(selector);if(node)node.textContent='';}if(s.confirm?.scope==='guild')clearConfirm();}
function clearAdminData(){privilegeEpoch++;refreshOperatorRecoveryAccess();destroyAvatarEditor();clearRecentLogins();for(const key of s.chats.keys())if(key.startsWith('admin:'))s.chats.delete(key);s.adminPlayers=[];s.staff=[];s.staffCandidates=[];s.staffLoaded=false;s.staffQuery='';s.staffPage=1;s.staffCandidatePage=1;s.adminSection='chat';if(s.confirm)clearConfirm();}
function clearPrivate(){clearAdminData();clearGuildData();s.mail=[];s.openedMail=null;s.guilds=[];s.players=[];s.friendId=null;s.chats.clear();s.confirm=null;s.pairCode=null;}
function canShowOperatorRecovery(){return s.configLoaded&&s.config.adminClaimed===true&&s.config.adminRecoveryAvailable===true&&s.connected===true&&!recoveryHeld&&Boolean(s.identity)&&s.user?.isAdmin===true&&String(s.user.id)===String(s.identity.id);}
function refreshOperatorRecoveryAccess(){
 const allowed=canShowOperatorRecovery(),host=$('[data-operator-recovery]');
 if(!allowed){const input=host?.querySelector('[name=key]');if(input)input.value='';if(host)host.textContent='';if(!s.identity||s.user?.isAdmin!==true||String(s.user.id)!==String(s.identity.id)||recoveryHeld)adminRecoveryRequestId=null;}
 else if(host&&!host.querySelector('#social-admin-recovery-form'))host.innerHTML=recoveryTools().operatorRecoveryForm();
}
function connected(value){s.connected=value;refreshOperatorRecoveryAccess();header();}
async function api(route,{method='GET',data,auth=true,token,background=false,keepalive=false,identityEpoch}={}){
 const origin=base();if(!origin)throw Error('通信機能は現在利用できません。ゲーム本体は引き続き遊べます。');
 const loadingId=!background&&method!=='GET'?global.SengokuLoading?.begin('通信を届けています…'):null;
 const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),12000);
 const headers={Accept:'application/json'};if(data!==undefined)headers['Content-Type']='application/json';
 const requestEpoch=identityEpoch??authEpoch,requestPrivilegeEpoch=privilegeEpoch,requestAvatarEpoch=avatarMutationEpoch,requestGuildEpoch=guildEpoch,requestGuildId=s.user?.guildId,implicitIdentity=identityEpoch!==undefined||(token===undefined&&(auth||route==='/session'||route==='/devices/link'||route==='/admin/recover'));
 if(implicitIdentity&&requestEpoch!==authEpoch){controllers.delete(controller);clearTimeout(timeout);if(loadingId)global.SengokuLoading?.end(loadingId);const e=Error('接続する領主が変わったため、以前の処理を取り消しました。');e.code='STALE_IDENTITY';throw e;}
 const bearer=token??(auth?s.identity?.token:null);if(bearer)headers.Authorization=`Bearer ${bearer}`;
 try{
  const response=await fetch(origin+route,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,signal:controller.signal,credentials:'omit',cache:'no-store',keepalive});
  let result;try{result=await response.json();}catch(_){throw Error('通信の応答を読み取れませんでした。時間をおいてお試しください。');}
  if(implicitIdentity&&requestEpoch!==authEpoch){const stale=Error('接続する領主が変わったため、以前の通信処理を取り消しました。');stale.code='STALE_IDENTITY';throw stale;}
  if(!response.ok||result.ok===false){const error=Error(result?.error?.message||'通信処理を完了できませんでした。');error.code=result?.error?.code;error.status=response.status;error.data=result;if(implicitIdentity&&auth&&bearer===s.identity?.token&&requestEpoch===authEpoch&&requestPrivilegeEpoch===privilegeEpoch&&s.user){if(['STAFF_CHAT_REQUIRED','STAFF_REQUIRED'].includes(error.code))acceptUser({...s.user,isAdmin:false,isStaff:false});else if(response.status===401)acceptUser(null);else if(error.code==='GUILD_REQUIRED'&&requestGuildEpoch===guildEpoch&&String(requestGuildId)===String(s.user.guildId)&&(!data?.guildId||String(data.guildId)===String(requestGuildId)))acceptUser({...s.user,guildId:null,guildName:null,guildRole:null});}throw error;}
  if(implicitIdentity&&requestAvatarEpoch!==avatarMutationEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,avatarVersion:s.user.avatarVersion||null};
  if(implicitIdentity&&requestGuildEpoch!==guildEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,guildId:s.user.guildId||null,guildName:s.user.guildName||null,guildRole:s.user.guildRole||null};
  if(implicitIdentity&&!/^\/sync(?:[/?]|$)/.test(route)&&requestPrivilegeEpoch!==privilegeEpoch&&s.user&&String(result.user?.id)===String(s.user.id))result.user={...result.user,isAdmin:s.user.isAdmin===true,isStaff:s.user.isStaff===true};
  connected(true);return result;
 }catch(error){
  if(error.name==='AbortError')throw Error('通信が混み合っています。少し待って、もう一度お試しください。');
  if(error instanceof TypeError){connected(false);throw Error('通信に接続できません。通信環境を確認してください。');}throw error;
 }finally{clearTimeout(timeout);controllers.delete(controller);if(loadingId)global.SengokuLoading?.end(loadingId);}
}
async function act(key,button,work){if(busy.has(key))return;busy.add(key);if(button)button.disabled=true;try{await work();}catch(e){if(e.code!=='STALE_IDENTITY')toast(e.message||'処理を完了できませんでした。',true);}finally{busy.delete(key);if(button?.isConnected)button.disabled=false;}}
function empty(title,detail,kind='chat'){return `<div class="social-empty">${icon(kind)}<h3>${esc(title)}</h3><p>${esc(detail)}</p></div>`;}
function header(){
 if(!dialog)return;const status=$('#social-connection');if(status){status.textContent=s.user?(s.connected?'接続中':'通信未接続'):'登録は任意です';status.classList.toggle('online',Boolean(s.user&&s.connected));}
 const count=$('#social-online-count');if(count)count.textContent=s.configLoaded?`接続中 ${num(s.config.onlineCount)} 人`:'城主たちの集う場所';
 const totalUnread=s.unreadMail+s.unreadLetters,badge=launcher?.querySelector('.social-unread');if(badge){badge.textContent=totalUnread>99?'99+':String(totalUnread);badge.hidden=!totalUnread;}launcher?.setAttribute('aria-label',totalUnread?`交流の間を開く（未読 ${num(totalUnread)} 件）`:'交流の間を開く');
 const lettersBadge=$('[data-social-tab="letters"] .social-tab-count');if(lettersBadge)lettersBadge.textContent=s.unreadLetters?String(s.unreadLetters):'';
 const mailBadge=$('[data-social-tab="mail"] .social-tab-count');if(mailBadge)mailBadge.textContent=s.unreadMail?String(s.unreadMail):'';
}
function renderAnnouncement(){
 if(!announcement)return;const notice=String(s.config.announcement??DEFAULT).slice(0,300),news=s.achievements.events.slice(0,3).map(e=>`${playerText(e.playerName,e.playerEvaluation)}：${e.title}`),text=[notice,...news].filter(Boolean).join('　◆　'),line=announcement.querySelector('.social-announcement-text');if(line.textContent!==text)line.textContent=text;
 announcement.hidden=s.configLoaded&&text.length===0;announcement.classList.toggle('is-paused',s.paused);const button=announcement.querySelector('.social-announcement-toggle');button.innerHTML=icon(s.paused?'play':'pause');button.setAttribute('aria-label',s.paused?'お知らせのスクロールを再開':'お知らせのスクロールを停止');button.setAttribute('aria-pressed',String(s.paused));
}
function tabs(){return[{id:'world',label:'世界',icon:'chat'},{id:'news',label:'御触書',icon:'flag'},{id:'online',label:'接続一覧',icon:'people'},{id:'sync',label:'端末同期',icon:'refresh'},{id:'recovery',label:'引き継ぎ',icon:'upload'},{id:'guild',label:'ギルド',icon:'flag'},{id:'guild-rankings',label:'ギルド順位',icon:'flag'},{id:'friends',label:'フレンド',icon:'people'},{id:'letters',label:'書状',icon:'mail'},{id:'trade',label:'交易',icon:'refresh'},{id:'mail',label:'郵便',icon:'mail'},{id:'profile',label:'領主',icon:'user'},...(hasAdminChat()?[{id:'admin',label:s.user.isAdmin?'運営':'運営チャット',icon:'shield'},{id:'recent-logins',label:'ログイン履歴',icon:'people'}]:[])];}

// Public records are emitted by accepted server transitions. No local log text
// or private chat, treasury balance, or login history is ever sent to this feed.
function cleanAchievement(event){
 if(!event||!['string','number'].includes(typeof event.id)||typeof event.id==='number'&&(!Number.isSafeInteger(event.id)||event.id<0)||typeof event.playerName!=='string'||!event.playerName.trim()||typeof event.title!=='string'||!event.title.trim()||typeof event.occurredAt!=='string'||!Number.isFinite(Date.parse(event.occurredAt)))return null;
 const id=String(event.id);if(!id.trim()||id.length>180||/[\u0000-\u001f\u007f]/.test(id))return null;
 const text=(value,max)=>String(value??'').slice(0,max);
 return{id,playerId:typeof event.playerId==='string'&&event.playerId.length<=180&&!/[\u0000-\u001f\u007f]/.test(event.playerId)?event.playerId:null,playerEvaluation:publicEvaluation(event.playerEvaluation),playerName:text(event.playerName,40),clan:text(event.clan,30),kind:text(event.kind,40),title:text(event.title,180),detail:text(event.detail,300),occurredAt:new Date(event.occurredAt).toISOString()};
}
function achievementTime(value){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(value));}
function achievementRows(){
 if(!s.achievements.loaded&&!s.achievements.events.length)return empty('達成の知らせを確認しています','領主たちの戦果がここに届きます。','flag');
 if(!s.achievements.events.length)return empty('達成の知らせはまだありません','これから記録された領主の戦果や発展を表示します。','flag');
 return s.achievements.events.map(e=>`<article class="social-achievement" data-event-id="${esc(e.id)}"><span class="social-achievement-seal" aria-hidden="true">${icon(e.kind.includes('cycle')?'gift':e.kind.includes('research')?'shield':'flag')}</span><div><div class="social-achievement-meta"><strong>${playerName(e.playerName,e.playerEvaluation,e.playerId)}</strong>${e.clan?`<span>${esc(e.clan)}</span>`:''}<time datetime="${esc(e.occurredAt)}">${esc(achievementTime(e.occurredAt))}</time></div><h3>${esc(e.title)}</h3>${e.detail?`<p>${esc(e.detail)}</p>`:''}</div></article>`).join('');
}
function achievementsView(){return `<section class="social-news"><div class="social-section-heading"><div><span class="social-eyebrow">天下に届く知らせ</span><h2>御触書・領主の達成</h2><p>領主の名前と成し遂げたことをお届けします。30秒ごとに更新・日本時間。</p></div><button class="social-icon-button" data-social="news-refresh" aria-label="御触書を更新">${icon('refresh')}</button></div><section class="social-news-notice"><h3>運営からのお知らせ</h3><p id="social-news-notice-text">${esc(s.config.announcement||'現在、運営からのお知らせはありません。')}</p></section><p id="social-news-status" class="social-small" role="status">${esc(s.achievements.error||'')}</p><div id="social-achievement-list" class="social-achievement-list">${achievementRows()}</div><div class="social-center"><button class="social-button" id="social-news-more" data-social="news-more" ${s.achievements.cursor?'':'hidden'}>以前の知らせを見る</button></div></section>`;}
function refreshAchievementView(){
 renderAnnouncement();if(!s.open||s.tab!=='news')return;
 const list=$('#social-achievement-list'),status=$('#social-news-status'),more=$('#social-news-more'),notice=$('#social-news-notice-text');
 if(notice)notice.textContent=s.config.announcement||'現在、運営からのお知らせはありません。';
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
  s.achievements.events=[...new Map(combined.map(e=>[e.id,e])).values()].sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt)).slice(0,200);applyPlayerEvaluations(events.map(event=>({playerId:event.playerId,evaluation:event.playerEvaluation})));
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
 const recoveryIntro=`<section class="domain-recovery-card"><span class="domain-recovery-step">以前の領主・運営の方へ</span><h3>サイト移転後も、同じ領主で続ける</h3><p>新しいアドレスでは、以前のブラウザ保存は自動で引き継がれません。接続コード、領主データ、または統合バックアップから再接続できます。</p><button class="social-button primary" data-social="recovery-open">引き継ぎ・データ復元を開く</button></section>`;
 const registration=s.meLoading?'<div class="social-notice">領主情報を確認しています…</div>':s.identity?'<div class="social-notice">保存されている領主との接続を確認してください。新しい領主で始める場合は、この端末の接続を解除してください。</div>':`<details class="domain-recovery-new"><summary>初めての方：新しく領主を登録する</summary><form id="social-register-form" class="social-register-form"><label for="social-register-name">交流で表示する名前</label><input id="social-register-name" name="name" minlength="2" maxlength="16" autocomplete="nickname" placeholder="領主名（2〜16文字）" required><input name="clan" type="hidden" value="${esc(clan)}"><button class="social-button primary" type="submit" ${!base()?'disabled':''}>${icon('chat')}新しい領主で接続</button></form></details>`;
 return `<div class="social-welcome"><div class="social-welcome-seal">交</div><div class="social-eyebrow">THE COMMON ROOM</div><h2>領主たちと、言葉を交わす。</h2><p>世界の会話、仲間とのギルド、友との文。</p></div>${recoveryIntro}${registration}<div class="social-notice">登録は任意です。交流にはインターネット接続が必要です。領主の認証情報はこのブラウザに保存され、同じ領主の端末で進行を自動同期します。</div>${s.error?`<div class="social-feedback is-error">${esc(s.error)}</div>`:''}${!base()?'<div class="social-feedback is-error">通信機能は現在準備中です。城下町はそのままお楽しみいただけます。</div>':''}${s.identity?'<div class="social-center"><button class="social-text-button" data-social="reconnect">接続を確認する</button><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>':''}`;
}
function channel(){
 if(!s.user)return null;
 if(s.tab==='world')return{channel:'world',target:null,title:'世界の広場',caption:'すべての領主が集う、開かれた会話です。'};
 if(s.tab==='guild'&&s.user.guildId&&s.guildSection==='chat')return{channel:'guild',target:null,title:s.user.guildName||'ギルド',caption:'このギルドの仲間だけが読める会話です。'};
 if(s.tab==='friends'&&s.friendId&&s.friends.some(f=>String(f.id)===String(s.friendId)))return{channel:'friend',target:s.friendId,title:s.friends.find(f=>String(f.id)===String(s.friendId))?.name||'友との文',player:s.friends.find(f=>String(f.id)===String(s.friendId)),caption:'選んだフレンドと二人で話します。'};
 if(s.tab==='admin'&&hasAdminChat()&&s.adminSection==='chat')return{channel:'admin',target:null,title:'運営の控え間',caption:'運営と任命されたスタッフが参加する、連絡用の会話です。'};return null;
}
function chatKey(c){return `${c.channel}:${c.target||(c.channel==='guild'?s.user?.guildId:'')||''}`;}
function chatView(c){return `<section class="social-chat"><div class="social-section-heading"><div><h3 data-social-chat-title>${c.player?playerName(c.player.name,c.player.evaluation,c.player.id):esc(c.title)}</h3><p>${esc(c.caption)}</p></div><span class="social-small">5秒ごとに更新</span></div><div id="social-message-list" class="social-message-list" role="log" aria-live="polite" aria-relevant="additions text"></div><form id="social-chat-form" class="social-chat-form"><label class="social-sr-only" for="social-chat-input">メッセージ</label><textarea id="social-chat-input" name="text" rows="2" maxlength="300" placeholder="言葉を交わす…（300文字まで）" required></textarea><div class="social-chat-form-bottom"><span>Enterで送信 · Shift+Enterで改行</span><button type="submit" class="social-button primary">${icon('send')}送信</button></div></form></section>`;}
function renderMessages(){
 const c=channel(),list=$('#social-message-list');if(!c||!list)return;const cache=s.chats.get(chatKey(c)),messages=cache?.messages||[],nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,oldTop=list.scrollTop;
 if(!cache){list.innerHTML=empty('会話を読み込んでいます','しばらくお待ちください。');return;}
 if(!messages.length){list.innerHTML=empty('まだ、言葉は届いていません','最初のひと言から、交流を始めましょう。');return;}
 const signature=JSON.stringify(messages.map(m=>[m.id,m.name,m.isAdmin===true,m.isStaff===true,m.avatarVersion||'',evaluationKey(m.evaluation)]));if(list.dataset.signature===signature)return;
 list.innerHTML=messages.map(m=>`<article class="social-message ${String(m.userId)===String(s.user.id)?'own':''}">${socialAvatar({...m,id:m.userId})}<div class="social-message-content"><div class="social-message-meta"><strong>${playerName(m.name,m.evaluation,m.userId)}</strong>${role(m)}<time>${esc(date(m.createdAt))}</time></div><p>${esc(m.text)}</p></div></article>`).join('');list.dataset.signature=signature;
 if(nearBottom||!cache.rendered)list.scrollTop=list.scrollHeight;else list.scrollTop=oldTop;cache.rendered=true;
}
function guildContext(){if(!s.user?.guildId||!s.identity)throw Error('ギルドに所属すると利用できます。');return{guildId:String(s.user.guildId),owner:String(s.identity.id),epoch:authEpoch,guildEpoch,role:s.user.guildRole||'member'};}
function guildCurrent(c){return Boolean(c&&c.epoch===authEpoch&&c.guildEpoch===guildEpoch&&c.owner===String(s.identity?.id)&&c.guildId===String(s.user?.guildId)&&!disposed);}
function requireGuildContext(c){if(!guildCurrent(c)){const error=Error('所属ギルドまたは役職が変わりました。現在の内容を確認して操作し直してください。');error.code='STALE_GUILD';throw error;}}
function canManageGuildMember(target,action){if(!s.user?.guildId||!target||String(target.id)===String(s.user.id)||(target.guildRole||'member')==='owner')return false;return action==='role'?s.user.guildRole==='owner':s.user.guildRole==='owner'||s.user.guildRole==='officer'&&(target.guildRole||'member')==='member';}
function guildMemberRows(){return s.members.length?s.members.map(p=>`<article class="social-guild-member"><div class="social-guild-member-person">${socialAvatar(p,'small')}<div><h3>${playerName(p.name,p.evaluation,p.id)} ${role(p)}</h3><p>${esc(p.clan||'浪人')} · <span class="guild-role guild-role-${['owner','officer'].includes(p.guildRole)?p.guildRole:'member'}">${guildRoleName(p.guildRole)}</span>${String(p.id)===String(s.user.id)?' · あなた':''}</p></div></div><div class="social-guild-member-actions">${canManageGuildMember(p,'role')?`<button class="social-button small" data-social="guild-member-role" data-id="${esc(p.id)}" data-role="${p.guildRole==='officer'?'member':'officer'}">${p.guildRole==='officer'?'メンバーに戻す':'副盟主に任命'}</button>`:''}${canManageGuildMember(p,'remove')?`<button class="social-button small subtle" data-social="guild-member-remove" data-id="${esc(p.id)}">除名</button>`:''}</div></article>`).join(''):empty('メンバーを確認しています','しばらくお待ちください。','people');}
function refreshGuildMembers(){const node=$('#social-guild-members');if(!node||s.tab!=='guild'||s.guildSection!=='members'||s.confirm)return;const focused=document.activeElement,key=node.contains?.(focused)?{action:focused.dataset.social,id:focused.dataset.id,role:focused.dataset.role}:null,top=body?.scrollTop||0;node.innerHTML=guildMemberRows();if(key)[...node.querySelectorAll('[data-social]')].find(el=>el.dataset.social===key.action&&el.dataset.id===key.id&&el.dataset.role===key.role)?.focus({preventScroll:true});if(body)body.scrollTop=top;}
function guildView(){
 if(s.user.guildId){const sections=[['chat','ギルド会話'],['members','役職・メンバー'],['treasury','共有金庫']];if(!sections.some(([id])=>id===s.guildSection))s.guildSection='chat';return `<div class="social-guild-heading"><div class="social-guild-mon">${icon('flag')}</div><div><span class="social-eyebrow">YOUR GUILD</span><h2>${esc(s.user.guildName)}</h2><p>${s.guild?`${num(s.guild.memberCount)} / ${num(s.guild.maxMembers||50)} 人`:'仲間と歩む天下への道'} · あなたは${guildRoleName(s.user.guildRole)}</p></div><button class="social-button subtle" data-social="guild-leave">脱退</button></div><div class="social-guild-subtabs" role="tablist" aria-label="ギルド内の画面">${sections.map(([id,label])=>`<button type="button" role="tab" aria-selected="${s.guildSection===id}" class="${s.guildSection===id?'active':''}" data-social="guild-section" data-id="${id}">${label}</button>`).join('')}</div>${s.guildSection==='treasury'?guildTreasuryView():s.guildSection==='members'?`<div class="social-section-heading"><div><h3>役職とメンバー</h3><p>盟主は副盟主の任命・解除ができます。盟主と副盟主は通常メンバーを除名でき、副盟主は盟主・他の副盟主を除名できません。</p></div><button class="social-icon-button" data-social="guild-refresh" aria-label="メンバーを更新">${icon('refresh')}</button></div><div id="social-guild-members" class="social-guild-members">${guildMemberRows()}</div><p class="social-guild-note">ギルド内の役職は、このギルドの管理に使います。サイトの運営・スタッフ権限とは別の役割です。</p>`:chatView(channel())}`;}
 return `<div class="social-section-heading"><div><h2>志を同じくする仲間と。</h2><p>会話、共有金庫、役職で仲間と力を合わせます。</p></div><button class="social-icon-button" data-social="guild-refresh" aria-label="ギルド一覧を更新">${icon('refresh')}</button></div><button class="social-button" data-social="guild-rankings-open">${icon('flag')}ギルド順位を見る</button><form id="social-guild-create-form" class="social-inline-form"><label class="social-sr-only" for="social-guild-name">新しいギルド名</label><input id="social-guild-name" name="name" minlength="2" maxlength="24" placeholder="新しいギルド名（2〜24文字）" required><button class="social-button" type="submit">${icon('flag')}創設する</button></form><div class="social-card-list">${s.guilds.length?s.guilds.map(g=>`<article class="social-list-card"><span class="social-avatar">${first(g.name)}</span><div><h3>${esc(g.name)}</h3><p>盟主 ${playerName(g.ownerName,g.ownerEvaluation,g.ownerId)} · ${num(g.memberCount)} / ${num(g.maxMembers||50)} 人</p></div><button class="social-button small" data-social="guild-join" data-id="${esc(g.id)}" ${g.memberCount>=g.maxMembers?'disabled':''}>参加</button></article>`).join(''):empty('新しい旗を立てよう','参加できるギルドはまだありません。あなたのギルドを創設できます。','flag')}</div>`;
}
function guildMemberConfirmation(targetId,action,nextRole){
 const context=guildContext(),target=s.members.find(p=>String(p.id)===String(targetId));if(!canManageGuildMember(target,action)||action==='role'&&!['officer','member'].includes(nextRole))throw Error('現在の役職では、このメンバーへの操作はできません。');
 const removing=action==='remove',payload={guildId:context.guildId,targetPlayerId:target.id,requestId:crypto.randomUUID(),...(!removing?{role:nextRole}:{})};
 return{scope:'guild',title:removing?'このメンバーを除名しますか':nextRole==='officer'?'副盟主に任命しますか':'副盟主の役職を解除しますか',description:removing?'この領主はギルドの会話・共有金庫を利用できなくなります。':nextRole==='officer'?'副盟主は通常メンバーを除名できます。共有金庫は全メンバーが利用できます。':'メンバーとして会話・共有金庫を引き続き利用できます。',details:`<dl class="social-confirm-details"><dt>ギルド</dt><dd>${esc(s.user.guildName)}</dd><dt>領主</dt><dd>${playerName(target.name,target.evaluation,target.id)}</dd><dt>現在の役職</dt><dd>${guildRoleName(target.guildRole)}</dd></dl>`,confirmLabel:removing?'このメンバーを除名':nextRole==='officer'?'副盟主に任命':'メンバーに戻す',danger:removing,onConfirm:async()=>{
  requireGuildContext(context);const current=s.members.find(p=>String(p.id)===String(target.id));if(!canManageGuildMember(current,action))throw Error('役職と対象メンバーを確認し直してください。');
  let result;try{result=await api(removing?'/guild/members/remove':'/guild/members/role',{method:'POST',data:payload});}catch(error){if(error.code==='GUILD_ROLE_REQUIRED'||error.code==='GUILD_MEMBER_NOT_FOUND'){await loadMe();await loadGuild();}throw error;}requireGuildContext(context);
  clearGuildData({resetSection:false});if(result.user)acceptUser(result.user);if(String(s.user?.guildId)===context.guildId){s.guild=result.guild||null;s.members=result.members||[];}clearConfirm();render();toast(removing?'メンバーを除名しました。':nextRole==='officer'?'副盟主に任命しました。':'メンバーに戻しました。');
 }};
}
function guildLeaveConfirmation(){const context=guildContext();return{scope:'guild',title:`${s.user.guildName} を脱退しますか`,description:s.user.guildRole==='owner'?'仲間が残る場合は盟主を引き継ぎます。最後の一人で共有金庫に資産が残っている場合は、先に金庫を空にしてください。':'脱退すると、このギルドの会話・共有金庫を利用できなくなります。',confirmLabel:'脱退する',danger:true,onConfirm:async()=>{requireGuildContext(context);const result=await api('/guild/leave',{method:'POST',data:{guildId:context.guildId}});requireGuildContext(context);acceptUser(result.user||{...s.user,guildId:null,guildName:null,guildRole:null});await loadMe();await loadGuild();render();toast('ギルドを脱退しました。');}};}
function personalGuildResource(resource){const game=global.SengokuBridge?.getState?.();return Math.max(0,Number(resource==='magatama'?game?.magatama:game?.resources?.[resource])||0);}
function guildBalances(){return Object.entries(RES).map(([key,label])=>`<div><span>${label}</span><strong>${s.guildTreasury.loaded?num(s.guildTreasury.balance?.[key]):'—'}</strong></div>`).join('');}
function guildLedgerRows(){const t=s.guildTreasury;if(!t.ledger.length)return empty(t.loaded?'出し入れの記録はまだありません':'共有金庫を読み込んでいます',t.loaded?'ギルドのメンバーが出し入れすると、ここに記録されます。':'しばらくお待ちください。','gift');return t.ledger.map(entry=>`<article class="social-guild-ledger-entry"><div><strong>${playerName(entry.name||'領主',entry.playerEvaluation,entry.playerId)}</strong><p>${entry.direction==='deposit'?'金庫に預け入れ':'金庫から受け取り'} · ${esc(RES[entry.resource]||entry.resource)}</p></div><b class="${entry.direction==='deposit'?'is-deposit':'is-withdraw'}">${entry.direction==='deposit'?'+':'−'}${num(entry.amount)}</b><time datetime="${esc(entry.createdAt)}">${esc(loginDate(entry.createdAt))}<small>JST</small></time></article>`).join('');}
function guildTransferAvailable(){const sync=global.SengokuCloudSync?.getStatus?.();return Boolean(s.user?.guildId&&s.guildTreasury.loaded&&String(s.guildTreasury.guildId)===String(s.user.guildId)&&global.SengokuBridge?.hasStarted?.()!==false&&typeof global.SengokuBridge?.guildTransfer==='function'&&sync?.linked&&sync.ready&&sync.writable);}
function guildTreasuryView(){return `<section class="social-guild-treasury"><div class="social-section-heading"><div><h3>みんなの共有金庫</h3><p>全メンバーが資源・勾玉を預け入れ、受け取って使用できます。</p></div><button class="social-icon-button" data-social="guild-treasury-refresh" aria-label="共有金庫を更新">${icon('refresh')}</button></div><div id="social-guild-balances" class="social-guild-balances">${guildBalances()}</div><form id="social-guild-transfer-form" class="social-guild-transfer-form"><label>操作<select name="direction" id="social-guild-direction"><option value="deposit">金庫へ預ける</option><option value="withdraw">受け取って使用</option></select></label><label>資産<select name="resource" id="social-guild-resource">${Object.entries(RES).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label>数量<input name="amount" type="number" min="1" max="1000000" step="1" value="100" inputmode="numeric" required></label><button id="social-guild-transfer-confirm" class="social-button primary" type="submit" ${!guildTransferAvailable()?'disabled':''}>出し入れを確認</button></form><p id="social-guild-personal-balance" class="social-guild-note"></p><p class="social-guild-note">出し入れは共有金庫とあなたの所持数へ同時に反映し、端末間で同期します。1回につき1〜1,000,000。金庫の資産と記録は所属メンバーだけが確認できます。</p><p id="social-guild-treasury-status" class="social-guild-status" role="status">${esc(s.guildTreasury.error||(!guildTransferAvailable()?'操作できる端末と保存・同期の状態を確認しています。':''))}</p><div class="social-section-heading"><div><h3>出し入れの記録</h3><p>日本時間 JST · 新しい記録から表示 · 30秒ごとに更新</p></div></div><div id="social-guild-ledger" class="social-guild-ledger">${guildLedgerRows()}</div><div class="social-actions"><button id="social-guild-ledger-more" class="social-button" data-social="guild-treasury-more" ${!s.guildTreasury.cursor?'hidden':''}>記録の続きを表示</button></div></section>`;}
function refreshGuildTreasuryView({rows=false}={}){if(s.tab!=='guild'||s.guildSection!=='treasury'||!s.user?.guildId||s.confirm)return;const t=s.guildTreasury,balances=$('#social-guild-balances'),ledger=$('#social-guild-ledger'),status=$('#social-guild-treasury-status'),more=$('#social-guild-ledger-more'),submit=$('#social-guild-transfer-confirm'),personal=$('#social-guild-personal-balance'),resource=$('#social-guild-resource')?.value||'gold';if(balances)balances.innerHTML=guildBalances();if(ledger&&rows){const top=body?.scrollTop||0;ledger.innerHTML=guildLedgerRows();if(body)body.scrollTop=top;}if(status){status.textContent=t.error||(treasuryBusy?'共有金庫を更新しています…':!guildTransferAvailable()?'この端末で保存・同期できる状態になると出し入れできます。':'');status.classList.toggle('is-error',Boolean(t.error));}if(more){if(!t.cursor&&document.activeElement===more)$('[data-social="guild-treasury-refresh"]')?.focus({preventScroll:true});more.hidden=!t.cursor;more.setAttribute('aria-disabled',String(treasuryBusy));}if(submit)submit.disabled=!guildTransferAvailable();if(personal)personal.textContent=`あなたの所持：${RES[resource]} ${num(personalGuildResource(resource))} · 共有金庫：${t.loaded?num(t.balance?.[resource]):'確認中'}`;}
function guildTransferConfirmation(values){const context=guildContext(),direction=values.direction,resource=values.resource,amount=Number(values.amount);if(!['deposit','withdraw'].includes(direction)||!Object.hasOwn(RES,resource)||!Number.isSafeInteger(amount)||amount<1||amount>1000000)throw Error('資産と数量を確認してください。数量は1〜1,000,000の整数です。');if(!guildTransferAvailable())throw Error('この端末でゲームを保存・同期できる状態を確認してください。');const available=direction==='deposit'?personalGuildResource(resource):Number(s.guildTreasury.balance?.[resource])||0;if(amount>available)throw Error(direction==='deposit'?'あなたの所持数が不足しています。':'共有金庫の残高が不足しています。');const payload=Object.freeze({guildId:context.guildId,direction,resource,amount,requestId:crypto.randomUUID()});return{scope:'guild',title:direction==='deposit'?'共有金庫へ預けますか':'金庫から受け取って使用しますか',description:direction==='deposit'?'あなたの所持数から共有金庫へ移します。ギルドの全メンバーが利用できる資産になります。':'共有金庫からあなたの所持数へ移します。受け取った資産はゲーム内で使用できます。',details:`<dl class="social-confirm-details"><dt>ギルド</dt><dd>${esc(s.user.guildName)}</dd><dt>資産</dt><dd>${RES[resource]} ${num(amount)}</dd><dt>操作</dt><dd>${direction==='deposit'?'金庫へ預ける':'受け取って使用'}</dd></dl>`,confirmLabel:direction==='deposit'?'この数量を預ける':'受け取って使用',onConfirm:async()=>{requireGuildContext(context);if(!guildTransferAvailable())throw Error('保存・同期の状態をもう一度確認してください。');const result=await global.SengokuBridge.guildTransfer(payload);requireGuildContext(context);if(!result?.ok)throw Error(result?.message||'出し入れの結果を確認できませんでした。同じ確認画面から再試行できます。');clearConfirm();await loadGuildTreasury();refreshGuildTreasuryView({rows:true});toast(`${RES[resource]} ${num(amount)}を${direction==='deposit'?'共有金庫へ預けました。':'受け取りました。'}`);}};}
function scheduleGuildLists(){clearTimeout(guildListTimer);guildListTimer=null;if(!disposed&&!document.hidden&&s.open&&(s.tab==='guild-rankings'||s.tab==='guild'&&s.guildSection==='treasury'&&s.user?.guildId))guildListTimer=setTimeout(()=>refresh({silent:true}),30000);}
async function loadGuildTreasury({more=false}={}){
 if(disposed||document.hidden||!s.open||s.tab!=='guild'||s.guildSection!=='treasury'||!s.user?.guildId||treasuryBusy||more&&!s.guildTreasury.cursor)return;
 const context=guildContext(),generation=++guildListGeneration,cursor=more?s.guildTreasury.cursor:null;treasuryBusy=true;clearTimeout(guildListTimer);guildListTimer=null;s.guildTreasury.error='';refreshGuildTreasuryView();
 const current=()=>guildCurrent(context)&&generation===guildListGeneration&&s.open&&!document.hidden&&s.tab==='guild'&&s.guildSection==='treasury';
 try{const r=await api('/guild/treasury?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{background:true});if(!current())return;if(String(r.guildId)!==context.guildId||!r.treasury||!Array.isArray(r.ledger))throw Error('共有金庫の所属と内容を確認できませんでした。');const rows=more?[...s.guildTreasury.ledger,...r.ledger]:r.ledger;s.guildTreasury={guildId:context.guildId,balance:r.treasury,ledger:[...new Map(rows.map(entry=>[String(entry.id),entry])).values()],cursor:r.nextCursor||null,loaded:true,error:'',serverNow:r.serverNow||null};refreshGuildTreasuryView({rows:true});}
 catch(error){if(current()&&error.code!=='STALE_IDENTITY'){s.guildTreasury.error=error.message||'共有金庫を読み込めませんでした。';refreshGuildTreasuryView({rows:true});}}
 finally{if(current()){treasuryBusy=false;refreshGuildTreasuryView();scheduleGuildLists();}}
}
function guildRankingRows(){const r=s.guildRankings;return r.guilds.length?r.guilds.map(g=>`<article class="social-guild-rank-row"><b class="social-guild-rank-position">${num(g.rank)}<small>位</small></b><div class="social-guild-rank-name"><h3>${esc(g.name)}</h3><p>盟主 ${playerName(g.ownerName,g.ownerEvaluation,g.ownerId)}</p></div><div class="social-guild-rank-stats"><div><span>総威信</span><strong>${num(g.totalPrestige)}</strong></div><div><span>メンバー</span><strong>${num(g.memberCount)}<small>人</small></strong></div><div><span>領有城</span><strong>${num(g.ownedCastles)}<small>城</small></strong></div></div></article>`).join(''):empty(r.loaded?'まだ順位のあるギルドはありません':r.error?'ギルド順位を読み込めませんでした':'ギルド順位を読み込んでいます',r.loaded?'仲間とギルドを結成して、威信を高めましょう。':r.error?'更新からもう一度お試しください。':'しばらくお待ちください。','flag');}
function guildRankingsView(){return `<section class="social-guild-rankings"><div class="social-section-heading"><div><span class="social-eyebrow">GUILD RANKINGS</span><h2>ギルド順位</h2><p>所属プレイヤーの威信を合計した「総威信」の高い順に表示します。</p></div><button class="social-button" data-social="guild-rankings-refresh">${icon('refresh')}更新</button></div><p id="social-guild-rankings-summary" class="social-guild-note">${s.guildRankings.loaded?`${num(s.guildRankings.total)}ギルド · 更新 ${loginDate(s.guildRankings.serverNow)} JST`:'集計を確認しています。'} · 30秒ごとに更新</p><p id="social-guild-rankings-status" class="social-guild-status" role="status">${esc(s.guildRankings.error)}</p><div id="social-guild-rankings-results" class="social-guild-rankings-results">${guildRankingRows()}</div><div class="social-actions"><button id="social-guild-rankings-more" class="social-button" data-social="guild-rankings-more" ${!s.guildRankings.cursor?'hidden':''}>順位の続きを表示</button></div><p class="social-guild-note">この順位はすべてのプレイヤーが閲覧できます。共有金庫の残高・出し入れの記録は公開されません。</p></section>`;}
function refreshGuildRankingsView({rows=false}={}){if(!s.open||s.tab!=='guild-rankings'||s.confirm)return;const r=s.guildRankings,summary=$('#social-guild-rankings-summary'),status=$('#social-guild-rankings-status'),results=$('#social-guild-rankings-results'),more=$('#social-guild-rankings-more');if(summary)summary.textContent=(r.loaded?`${num(r.total)}ギルド · 更新 ${loginDate(r.serverNow)} JST`:'集計を確認しています。')+' · 30秒ごとに更新';if(status){status.textContent=r.error||(rankingsBusy?'順位を更新しています…':'');status.classList.toggle('is-error',Boolean(r.error));}if(results&&rows){const top=body?.scrollTop||0;results.innerHTML=guildRankingRows();if(body)body.scrollTop=top;}if(more){more.hidden=!r.cursor;more.setAttribute('aria-disabled',String(rankingsBusy));}}
async function loadGuildRankings({more=false}={}){if(disposed||document.hidden||!s.open||s.tab!=='guild-rankings'||rankingsBusy||more&&!s.guildRankings.cursor)return;rankingsBusy=true;clearTimeout(guildListTimer);guildListTimer=null;const generation=++guildListGeneration,cursor=more?s.guildRankings.cursor:null;const current=()=>!disposed&&!document.hidden&&s.open&&s.tab==='guild-rankings'&&generation===guildListGeneration;s.guildRankings.error='';refreshGuildRankingsView();try{const r=await api('/guild/rankings?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''),{auth:false,background:true});if(!current())return;if(!Array.isArray(r.guilds))throw Error('ギルド順位の応答を確認できませんでした。');s.guildRankings={guilds:[...new Map((more?[...s.guildRankings.guilds,...r.guilds]:r.guilds).map(g=>[String(g.id),g])).values()].sort((a,b)=>(Number(a.rank)||0)-(Number(b.rank)||0)),total:Number(r.total)||0,cursor:r.nextCursor||null,loaded:true,error:'',serverNow:r.serverNow||new Date().toISOString()};refreshGuildRankingsView({rows:true});}catch(error){if(current()){s.guildRankings.error=error.message||'順位を読み込めませんでした。';refreshGuildRankingsView({rows:true});}}finally{if(current()){rankingsBusy=false;refreshGuildRankingsView();scheduleGuildLists();}}}

function searchForm(prefix='player'){return `<form id="social-${prefix}-search-form" class="social-inline-form"><label class="social-sr-only" for="social-${prefix}-query">領主を探す</label><input id="social-${prefix}-query" name="q" minlength="2" maxlength="24" placeholder="領主の名前で探す" required><button class="social-button" type="submit">${icon('search')}検索</button></form>`;}
function playerCards(players,mode){return players.map(p=>`<article class="social-list-card">${socialAvatar(p,'small')}<div><h3>${playerName(p.name,p.evaluation,p.id)} ${role(p)}</h3><p>${esc(p.clan||'浪人')}${p.guildName?' · '+esc(p.guildName):''}</p><code class="social-player-id">${esc(p.id)}</code></div>${mode==='friend'?(String(p.id)===String(s.user.id)?'<span class="social-small">あなた</span>':s.friends.some(f=>String(f.id)===String(p.id))?'<span class="social-small">フレンド</span>':s.requests.some(r=>String(r.id)===String(p.id))?'<span class="social-small">申請中</span>':`<button class="social-button small" data-social="friend-request" data-id="${esc(p.id)}">申請</button>`):`<button class="social-button small" data-social="admin-select-player" data-id="${esc(p.id)}">宛先にする</button>`}</article>`).join('');}
function friendRequestRows(){return s.requests.length?`<section class="social-requests"><h3>届いた申請・送った申請</h3>${s.requests.map(r=>`<article class="social-list-card">${socialAvatar(r,'small')}<div><h3>${playerName(r.name,r.evaluation,r.id)}</h3><p>${r.direction==='incoming'?'あなたへ申請が届いています':'承認を待っています'}</p></div>${r.direction==='incoming'?`<button class="social-button small primary" data-social="friend-accept" data-id="${esc(r.id)}">承認</button><button class="social-button small subtle" data-social="friend-reject" data-id="${esc(r.id)}">辞退</button>`:'<span class="social-small">申請中</span>'}</article>`).join('')}</section>`:'';}
function friendListRows(){return `<h3>フレンド <span>${s.friends.length}</span></h3>${s.friends.length?s.friends.map(f=>`<button class="social-friend ${String(s.friendId)===String(f.id)?'selected':''}" data-social="friend-select" data-id="${esc(f.id)}">${socialAvatar(f,'small')}<span><b>${playerName(f.name,f.evaluation,f.id)}</b><small>${f.online?'最近接続':esc(f.clan||'浪人')}</small></span></button>`).join(''):'<p class="social-small">名前を検索して、申請を送りましょう。</p>'}`;}
function friendsSignature(){return JSON.stringify(s.friends.map(f=>[f.id,f.name,f.clan,f.online,f.avatarVersion||'',evaluationKey(f.evaluation)]));}
function refreshFriendsView(){
 if(s.tab!=='friends'||s.confirm)return;
 const focused=document.activeElement,key=focused?.dataset?.social?{action:focused.dataset.social,id:focused.dataset.id}:null;
 for(const [selector,html]of [['#social-friend-list',friendListRows()],['#social-friend-requests',friendRequestRows()]]){const node=$(selector);if(node&&node.innerHTML!==html)node.innerHTML=html;}
 const c=channel(),heading=$('[data-social-chat-title]');if(heading&&c?.player){const html=playerName(c.player.name,c.player.evaluation,c.player.id);if(heading.innerHTML!==html)heading.innerHTML=html;}
 if(key&&focused?.isConnected===false)[...dialog.querySelectorAll('[data-social]')].find(node=>node.dataset.social===key.action&&node.dataset.id===key.id)?.focus({preventScroll:true});
}
function friendsView(){
 return `<details class="social-search-details" ${s.players.length?'open':''}><summary>${icon('search')}領主を探して、フレンド申請</summary>${searchForm()}<div id="social-player-results" class="social-card-list">${playerCards(s.players,'friend')}</div></details><div id="social-friend-requests">${friendRequestRows()}</div><div class="social-friends-layout"><aside id="social-friend-list" class="social-friend-list">${friendListRows()}</aside><div class="social-friend-conversation">${channel()?`${chatView(channel())}<div class="social-right"><button class="social-text-button danger" data-social="friend-remove" data-id="${esc(s.friendId)}">このフレンドを解除</button></div>`:empty('友との文をひらく','フレンドを選ぶと、二人だけで話せます。','people')}</div></div>`;
}
function mailParticipants(mail){const people=Array.isArray(mail.participants)?mail.participants.filter(p=>p&&typeof p.playerId==='string'&&typeof p.name==='string'&&['attacker','defender'].includes(p.side)):[];return people.length?`<div class="social-mail-participants">${people.map(p=>`<p>${p.side==='attacker'?'攻撃側':'守備側'}：${playerName(p.name,p.evaluation,p.playerId)}</p>`).join('')}</div>`:'';}
function mailView(){
 const selected=s.mail.find(m=>String(m.id)===String(s.openedMail));
 if(selected){const pending=s.pending[`${s.identity.id}:${selected.id}`];return `<button class="social-text-button" data-social="mail-back">受信一覧に戻る</button><article class="social-letter"><div class="social-eyebrow">SYSTEM LETTER</div><h2>${esc(selected.title)}</h2><div class="social-letter-date">${selected.source==='system'?'システムからの自動通知':'運営から'} · ${esc(date(selected.createdAt))}</div>${mailParticipants(selected)}<div class="social-letter-body">${esc(selected.body)}</div>${selected.gift?`<div class="social-gift"><span>${icon('gift')}</span><div><b>同封された贈り物</b><p>${esc(giftLabel(selected.gift))}</p></div><button class="social-button primary" data-social="mail-claim" data-id="${esc(selected.id)}" ${selected.claimed&&!pending?'disabled':''}>${pending?'受け取りを再確認':selected.claimed?'受取済み':'受け取る'}</button></div>`:''}</article>`;}
 return `<div class="social-section-heading"><div><h2>届いた便り</h2><p>対人戦の被攻撃・勝敗・本拠移転はシステムメールで自動通知します。運営のお知らせや、資源・勾玉の贈り物も届きます。</p></div><button class="social-icon-button" data-social="mail-refresh" aria-label="郵便を更新">${icon('refresh')}</button></div><div class="social-card-list">${s.mail.length?s.mail.map(m=>`<button class="social-mail-row ${m.read?'':'unread'}" data-social="mail-open" data-id="${esc(m.id)}"><span class="social-mail-symbol">${icon(m.gift?'gift':'mail')}</span><span><b>${esc(m.title)}</b><small>${esc(date(m.createdAt))} · ${m.source==='system'?'合戦の自動通知':m.gift?(m.claimed?'贈り物は受取済み':'贈り物あり'):'お知らせ'}</small></span><span class="social-mail-state">${m.read?'既読':'未読'}</span></button>`).join(''):empty('まだ便りは届いていません','対人戦の自動通知や、運営のお知らせ・贈り物は、こちらへ届きます。','mail')}</div>`;
}
function profileView(){return `<div class="social-profile-heading"><span id="social-profile-avatar" data-avatar-key="${esc(JSON.stringify([s.user.id,s.user.name,s.user.avatarVersion||null]))}">${socialAvatar(s.user,'profile')}</span><div><div class="social-eyebrow">YOUR IDENTITY</div><h2>${playerName(s.user.name,s.user.evaluation,s.user.id)} ${role(s.user)}</h2><p>${esc(s.user.clan||'浪人')} · ${s.user.guildName?esc(s.user.guildName):'ギルド未所属'}</p><button type="button" class="social-text-button" data-social="evaluation-open">総合評価を見る</button></div></div><div class="social-profile-id"><span>領主ID</span><code>${esc(s.user.id)}</code></div><div id="social-avatar-editor"></div><section class="social-profile-section"><h3>同じ領主で、どの端末からも</h3><p>端末を接続すると、城・武将・資源・進行状況を常に自動同期します。運営も同じ領主として接続すれば、登録済みの運営権限が反映されます。</p><div data-sync-status>${syncStatusCard()}</div><div class="social-actions"><button class="social-button primary" data-social="sync-open">${icon('refresh')}端末を接続・確認</button><button class="social-button" data-social="identity-export">${icon('download')}領主データを書き出す</button><button class="social-button" data-social="recovery-open">${icon('upload')}引き継ぎ・復元</button><button class="social-button" data-social="recovery-export">${icon('download')}統合バックアップ</button></div><div class="social-notice">領主データには本人の認証情報が含まれます。自分の端末間で使ってください。</div></section>${s.user.isAdmin?`<section class="social-profile-section"><h3>運営のゲーム設定</h3><p>運営の本拠は江戸城に固定されます。德川家康Uは特別イラストで付与され、同じ領主IDの端末へ同期します。</p><div class="social-actions"><button class="social-button" data-social="game-settings">ゲーム設定を開く</button><button class="social-button" data-social="admin-restore">德川家康Uを復元</button></div></section>`:''}${s.user.isStaff?`<section class="social-profile-section staff-base-notice"><h3>德川家 · スタッフ共同拠点 · 駿府城</h3><p>スタッフの家は德川家、本拠は占領されない駿府城に固定されます。城郭と城下町の施設を全スタッフで共有し、共同普請の成長が各端末へ自動で反映されます。</p><p>普請を指示したスタッフが自分の資源と指令を支払います。資源・武将・研究・奉行はそれぞれの領主のものです。</p><button class="social-button" data-social="game-settings">ゲーム設定を開く</button></section>`:''}${!s.config.adminClaimed&&!s.user.isAdmin&&!s.user.isStaff?`<section id="social-admin-claim" class="social-profile-section"><h3>初回運営登録</h3><p>運営者用の登録キーをお持ちの場合に使用します。登録が完了すると、この欄は他の領主には表示されません。</p><form id="social-admin-claim-form" class="social-inline-form"><label class="social-sr-only" for="social-admin-key">運営登録キー</label><input id="social-admin-key" name="key" type="password" autocomplete="off" maxlength="256" placeholder="運営登録キー" required><button class="social-button" type="submit">運営として登録</button></form></section>`:''}<div class="social-right"><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>`;}
function linkForm(){return `<section class="social-profile-section"><h3>別の端末の領主につなぐ</h3><p>接続済みの端末で「端末同期」からコードを発行し、こちらへ入力してください。同じ領主の最新の進行を読み込みます。</p><form id="social-device-link-form" class="social-inline-form"><label class="social-sr-only" for="social-device-code">12文字の接続コード</label><input id="social-device-code" name="code" minlength="12" maxlength="18" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="12文字の接続コード" required><button class="social-button primary" type="submit">この領主につなぐ</button></form></section>`;}
function syncStatusCard(){const v=s.syncStatus||global.SengokuCloudSync?.getStatus?.()||{message:'同期を準備しています。',writable:false};return `<div class="social-sync-status ${v.writable?'is-writer':''}" role="status"><strong>${v.linked?(v.writable?'自動同期中':v.ready?'進行を確認中':'初回同期中'):'端末内に保存'}</strong><p>${esc(v.message||'同期状態を確認しています。')}</p>${v.updatedAt?`<small>最終保存 ${esc(date(v.updatedAt))}</small>`:''}${v.linked&&v.ready&&!v.writable&&v.reason!=='hidden'?`<button class="social-button" data-social="sync-takeover">この端末で続ける</button>`:''}</div>`;}
function syncView(){
 if(!s.identity)return `<div class="social-section-heading"><div><h2>端末をつないで、続きを。</h2><p>PCとスマートフォンで同じ領主の進行を自動保存・同期します。</p></div></div>${registerView()}`;
 const v=global.SengokuCloudSync?.getDevice?.()||{name:'この端末'},code=s.pairCode,validCode=code&&Date.parse(code.expiresAt)>Date.now();
 return `<div class="social-section-heading"><div><h2>どの端末でも、同じ戦記。</h2><p>${playerName(s.user?.name||'確認中の領主',s.user?.evaluation,s.user?.id)} ${role(s.user)} · 進行・所持武将・城を自動同期します。</p></div><button class="social-icon-button" data-social="sync-refresh" aria-label="同期を確認">${icon('refresh')}</button></div><div data-sync-status>${syncStatusCard()}</div><div class="social-notice">同時に進行する端末は一つです。ほかの端末は最新の進行を自動表示します。「この端末で続ける」で切り替えられます。接続が切れた場合は、同期が戻るまで進行を一時停止します。</div><form id="social-device-name-form" class="social-inline-form"><label class="social-sr-only" for="social-device-name">この端末の名前</label><input id="social-device-name" name="name" maxlength="40" value="${esc(v.name)}" placeholder="例：自宅のパソコン" required><button class="social-button" type="submit">端末名を保存</button></form><section class="social-profile-section"><h3>もう一つの端末を接続</h3><p>新しい端末の「端末同期」に、この接続コードを入力してください。コードは10分間有効で、1回使うと失効します。</p><div class="social-actions"><button class="social-button primary" data-social="pair-create">接続コードを発行</button></div>${validCode?`<div class="social-pair-code"><code>${esc(code.code)}</code><button class="social-button small" data-social="pair-copy">コピー</button><p>${esc(date(code.expiresAt))} まで有効 · 自分の端末への接続用です。</p></div>`:''}</section>${linkForm()}<section class="social-profile-section"><h3>領主データで接続する</h3><p>保存してある領主データでも、同じ領主と運営権限を復元できます。</p><div class="social-actions"><button class="social-button" data-social="identity-export">${icon('download')}領主データを書き出す</button><button class="social-button" data-social="recovery-open">${icon('upload')}引き継ぎ・復元</button><button class="social-button" data-social="recovery-export">${icon('download')}統合バックアップ</button></div></section><div class="social-right"><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>`;
}
function onlineView(){return `<div class="social-section-heading"><div><h2>いま集う領主たち</h2><p>接続中 ${num(s.onlineTotal)}人 · 10秒ごとに更新</p></div><button class="social-icon-button" data-social="online-refresh" aria-label="接続一覧を更新">${icon('refresh')}</button></div><p class="social-online-caption">現在接続している全プレイヤーの一覧です。未登録でも閲覧できます。</p>${s.onlineError?`<div class="social-feedback is-error">${esc(s.onlineError)}</div>`:''}<div class="social-card-list">${s.onlinePlayers.length?s.onlinePlayers.map(p=>`<article class="social-list-card">${socialAvatar(p)}<div><h3>${playerName(p.name,p.evaluation,p.id)} ${role(p)}</h3><p>${esc(p.clan||'浪人')}${p.guildName?' · '+esc(p.guildName):''}</p></div><span class="social-online-label">${String(p.id)===String(s.identity?.id)?'あなた':'接続中'}</span></article>`).join(''):empty(s.onlineLoaded?'現在接続中の領主はいません':'接続一覧を読み込んでいます',s.onlineLoaded?'領主として接続すると、この一覧に表示されます。':'しばらくお待ちください。','people')}</div>${s.onlineCursor?'<div class="social-actions"><button class="social-button" data-social="online-more">続きを表示</button></div>':''}`;}
function renderSyncStatus(value){s.syncStatus=value;if(!dialog)return;dialog.querySelectorAll('[data-sync-status]').forEach(el=>{el.innerHTML=syncStatusCard();});refreshGuildTreasuryView();}
function destroyAvatarEditor(){avatarGeneration++;avatarEditor?.destroy?.();avatarEditor=null;}
function refreshProfileAvatar(){if(!s.user||s.tab!=='profile')return;const heading=$('#social-profile-avatar'),key=JSON.stringify([s.user.id,s.user.name,s.user.avatarVersion||null]);if(heading&&heading.dataset.avatarKey!==key){heading.innerHTML=socialAvatar(s.user,'profile');heading.dataset.avatarKey=key;}avatarEditor?.update?.(s.user);}
function mountProfileAvatar(){
 const host=$('#social-avatar-editor');if(!s.open||s.tab!=='profile'||!s.user||!host||!global.SengokuAvatar?.mount)return;
 const generation=avatarGeneration,epoch=authEpoch,roleEpoch=privilegeEpoch,owner=String(s.user.id);
 const current=()=>!disposed&&generation===avatarGeneration&&epoch===authEpoch&&roleEpoch===privilegeEpoch&&s.open&&s.tab==='profile'&&String(s.identity?.id)===owner&&String(s.user?.id)===owner&&host.isConnected!==false;
 avatarEditor=global.SengokuAvatar.mount(host,{user:{...s.user},request:async(route,options={})=>{if(!current())throw staleIdentity();if(route!=='/me/avatar'||!['PUT','DELETE'].includes(options.method))throw Error('アイコンの操作を確認してください。');const result=await api(route,{...options,identityEpoch:epoch,background:true});if(!current())throw staleIdentity();return result;},onUser:user=>{if(!current()||String(user?.id)!==owner)return;avatarMutationEpoch++;acceptUser(user);for(const key of ['friends','requests','members','players','adminPlayers','staff','staffCandidates','onlinePlayers'])s[key]=s[key].map(p=>String(p.id)===owner?{...p,avatarVersion:user.avatarVersion||null}:p);s.recentLogins.players=s.recentLogins.players.map(p=>String(p.id)===owner?{...p,avatarVersion:user.avatarVersion||null}:p);for(const cached of s.chats.values())for(const message of cached.messages||[])if(String(message.userId)===owner)message.avatarVersion=user.avatarVersion||null;refreshProfileAvatar();}});
}
function loginDate(value){const d=new Date(value);return value&&Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(d):'—';}
function recentLoginRows(){
 const r=s.recentLogins;if(!r.players.length)return empty(r.loaded?'過去24時間の接続記録はありません':r.error?'ログイン履歴を取得できませんでした':'ログイン履歴を読み込んでいます',r.loaded?'次の接続確認で一覧に反映されます。':r.error?'「更新」からもう一度お試しください。':'しばらくお待ちください。','people');
 return r.players.map(p=>`<article class="social-recent-login-row">${socialAvatar(p)}<div class="social-recent-login-person"><h3>${playerName(p.name,p.evaluation,p.id)} ${role(p)||'<span class="social-recent-login-role">領主</span>'}</h3><p>${esc(p.clan||'浪人')}</p></div><span class="social-recent-login-presence ${p.online===true?'is-online':''}">${p.online===true?'オンライン':'オフライン'}</span><div class="social-recent-login-time"><span>最終接続</span><time datetime="${esc(p.lastSeen)}">${esc(loginDate(p.lastSeen))}</time><small>日本時間 JST</small></div></article>`).join('');
}
function recentLoginWindow(){const r=s.recentLogins;return r.serverNow&&r.windowStart?`${loginDate(r.windowStart)} 〜 ${loginDate(r.serverNow)}（日本時間 JST）`:'対象期間を確認しています。表示時刻は日本時間 JST です。';}
function recentLoginsView(){
 if(!hasAdminChat())return empty('運営・スタッフ専用の一覧です','この領主には閲覧権限がありません。','shield');
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
 if(!user){const wasAdminTab=['admin','recent-logins'].includes(s.tab);s.user=null;s.unreadMail=0;s.unreadLetters=0;s.mail=[];s.openedMail=null;global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();clearAdminData();clearGuildData();if(wasAdminTab)s.tab='profile';if(!fromSync)applyRoleAccess();if(body&&(wasAdminTab||s.open)){clearConfirm();render();}return;}
 if(!s.identity||String(user.id)!==String(s.identity.id))throw staleIdentity();
 const previous=s.user,guildChanged=String(previous?.guildId||'')!==String(user.guildId||''),guildRoleChanged=(previous?.guildRole||'')!==(user.guildRole||''),roleChanged=(previous?.isAdmin===true)!==(user.isAdmin===true)||(previous?.isStaff===true)!==(user.isStaff===true&&user.isAdmin!==true),wasAdminTab=['admin','recent-logins'].includes(s.tab);
 s.user={...user,isAdmin:user.isAdmin===true,isStaff:user.isStaff===true&&user.isAdmin!==true};if(guildChanged||guildRoleChanged){clearGuildData({resetSection:guildChanged});if(s.open&&s.tab==='guild')render();}if(!fromSync)applyRoleAccess(s.user);
 if(roleChanged){clearAdminData();if(wasAdminTab&&!hasAdminChat())s.tab='profile';renderTabs();if(body&&(s.open||wasAdminTab)){clearConfirm();render();}if(s.open&&s.tab==='recent-logins'&&hasAdminChat())loadRecentLogins();}
 else if(!previous&&s.open&&!s.confirm)render();applyPlayerEvaluations([{playerId:s.user.id,evaluation:s.user.evaluation}]);if(!previous||guildChanged){global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();}refreshProfileAvatar();header();
}
function startCloud(){
 if(recoveryHeld){global.SengokuCloudSync?.stop?.({pending:true});global.SengokuBridge?.setSyncAccess?.({linked:true,ready:false,writable:false,reason:'recovery',message:'引き継ぎが途中です。保存内容を確認するまで同期を停止しています。'});return;}
 const identity=s.identity,epoch=authEpoch;if(!identity){global.SengokuCloudSync?.stop?.();applyRoleAccess();return;}
 global.SengokuBridge?.setSyncAccess?.({linked:true,ready:false,writable:false,reason:'initializing',message:'領主と最新の保存を確認しています…'});
 if(!global.SengokuCloudSync){s.error='同期機能を読み込めませんでした。画面を再読み込みしてください。';return;}
 global.SengokuCloudSync.start({id:identity.id,request:(route,options)=>api(route,{...options,token:identity.token,identityEpoch:epoch,background:true}),onUser:user=>{if(epoch===authEpoch)acceptUser(user,{fromSync:true});}});
}
function installIdentity(identity,user){global.SengokuCloudSync?.stop?.({pending:true});authEpoch++;recoveryEpoch++;recovery=null;recoveryHeld=false;clearPrivate();s.identity=identity;s.user=user?{...user,isAdmin:false,isStaff:false}:null;s.friends=[];s.requests=[];s.unreadMail=0;s.unreadLetters=0;global.SengokuLetters?.refreshIdentity?.();global.SengokuTrade?.refreshIdentity?.();s.error='';refreshOperatorRecoveryAccess();if(s.tab==='recent-logins'){s.tab='profile';render();}applyRoleAccess();startCloud();}
async function loadOnline({more=false}={}){
 if(disposed||document.hidden||!s.open||s.tab!=='online'||onlineBusy)return;onlineBusy=true;clearTimeout(onlineTimer);const epoch=++onlineEpoch;
 try{const cursor=more?s.onlineCursor:null,r=await api('/online'+(cursor?'?cursor='+encodeURIComponent(cursor):''),{auth:false,background:true});if(epoch!==onlineEpoch||disposed)return;const incoming=Array.isArray(r.players)?r.players:[];s.onlinePlayers=more?[...new Map([...s.onlinePlayers,...incoming].map(p=>[String(p.id),p])).values()]:incoming;s.onlineTotal=Number(r.total)||0;s.onlineCursor=r.nextCursor||null;s.onlineLoaded=true;s.onlineError='';s.config.onlineCount=s.onlineTotal;header();if(s.open&&s.tab==='online'&&!s.confirm)render();}
 catch(e){if(epoch===onlineEpoch){s.onlineError=e.message||'接続一覧を読み込めませんでした。';if(s.open&&s.tab==='online'&&!s.confirm)render();}}
 finally{onlineBusy=false;if(!disposed&&!document.hidden&&s.open&&s.tab==='online')onlineTimer=setTimeout(()=>loadOnline(),10000);}
}

function staffCards(players,{candidates=false}={}){return players.map(p=>{
 const own=String(p.id)===String(s.user?.id),operator=p.isAdmin===true,appointed=p.isStaff===true;
 const action=own?'<span class="social-small">あなた</span>':operator?'<span class="social-small">運営</span>':`<button class="social-button small ${appointed?'subtle':'primary'}" data-social="${appointed?'staff-dismiss':'staff-appoint'}" data-id="${esc(p.id)}">${appointed?'スタッフを解任':'スタッフに任命'}</button>`;
 return `<article class="social-list-card social-staff-card">${socialAvatar(p,'small')}<div><h3>${playerName(p.name,p.evaluation,p.id)} ${role(p)}</h3><p>${esc(p.clan||'浪人')}${!candidates&&p.appointedAt?' · '+esc(date(p.appointedAt))+' 任命':''}</p><code class="social-player-id">${esc(p.id)}</code></div>${action}</article>`;
}).join('');}
function staffList(candidates=false){
 const items=candidates?s.staffCandidates:s.staff,key=candidates?'staffCandidatePage':'staffPage',pages=Math.max(1,Math.ceil(items.length/4));s[key]=Math.max(1,Math.min(pages,s[key]||1));
 if(!items.length)return empty(candidates?(s.staffQuery?'領主が見つかりません':'任命する領主を探す'):(s.staffLoaded?'スタッフはまだいません':'スタッフを確認しています'),candidates?'登録済みの領主名で検索してください。':s.staffLoaded?'上の検索から領主を選んで任命できます。':'しばらくお待ちください。',candidates?'search':'people');
 return `<div class="social-card-list">${staffCards(items.slice((s[key]-1)*4,s[key]*4),{candidates})}</div>${pages>1?`<nav class="social-staff-pages" aria-label="${candidates?'候補':'スタッフ'}一覧のページ"><button class="social-button small subtle" data-social="staff-page" data-id="${candidates?'candidates':'roster'}" data-page="${s[key]-1}" ${s[key]===1?'disabled':''}>前へ</button><span>${s[key]} / ${pages} · ${num(items.length)}人</span><button class="social-button small subtle" data-social="staff-page" data-id="${candidates?'candidates':'roster'}" data-page="${s[key]+1}" ${s[key]===pages?'disabled':''}>次へ</button></nav>`:''}`;
}
function renderStaffLists(){
 const roster=$('#social-staff-roster'),candidates=$('#social-staff-results'),count=$('#social-staff-count');if(roster)roster.innerHTML=staffList();if(candidates)candidates.innerHTML=staffList(true);if(count)count.textContent=s.staffLoaded?`${num(s.staff.length)}人`:'確認中';
}
function setStaffRoster(list){s.staff=(Array.isArray(list)?list:[]).filter(p=>p&&typeof p.id==='string'&&p.isStaff===true&&!p.isAdmin);s.staffLoaded=true;const ids=new Set(s.staff.map(p=>String(p.id)));s.staffCandidates=s.staffCandidates.map(p=>({...p,isStaff:!p.isAdmin&&ids.has(String(p.id))}));applyPlayerEvaluations(s.staff.filter(p=>Object.hasOwn(p,'evaluation')).map(p=>({playerId:p.id,evaluation:p.evaluation})));}
async function loadStaff(){
 requireAdmin();const epoch=privilegeEpoch,r=await api('/admin/staff',{background:true});if(epoch!==privilegeEpoch||!s.user?.isAdmin)return null;setStaffRoster(r.staff);renderStaffLists();return r;
}
function staffView(){
 if(!s.user?.isAdmin)return'';
 return `<section class="social-staff-scope"><div>${icon('shield')}</div><div><h3>スタッフと運営チャットで連携する</h3><p>任命された領主は運営チャットに参加でき、過去24時間のログイン履歴を確認できます。本拠は保護された駿府城となり、全スタッフで城郭・城下町の成長を共有します。告知・配布・共通時間の変更、江戸城と德川家康Uの権限は運営に限定されます。</p></div></section><div class="social-staff-layout"><section class="social-staff-search"><h3>スタッフに任命する領主を探す</h3><form id="social-staff-search-form" class="social-inline-form"><label class="social-sr-only" for="social-staff-query">領主の名前</label><input id="social-staff-query" name="q" minlength="2" maxlength="24" value="${esc(s.staffQuery)}" placeholder="登録済みの領主名" required><button class="social-button" type="submit">${icon('search')}検索</button></form><div id="social-staff-results">${staffList(true)}</div></section><section class="social-staff-roster"><div class="social-section-heading"><div><h3>任命中のスタッフ <span id="social-staff-count">${s.staffLoaded?num(s.staff.length)+'人':'確認中'}</span></h3><p>解任すると運営チャットと共同拠点の利用権限がなくなり、個人の城下町に戻ります。</p></div><button class="social-icon-button" data-social="staff-refresh" aria-label="スタッフ名簿を更新">${icon('refresh')}</button></div><div id="social-staff-roster">${staffList()}</div></section></div>`;
}
function staffConfirmation(targetId,action){
 requireAdmin();if(!['appoint','dismiss'].includes(action))throw Error('スタッフの操作を確認してください。');
 const target=[...s.staffCandidates,...s.staff].find(p=>String(p.id)===String(targetId));if(!target||target.isAdmin||String(target.id)===String(s.user.id))throw Error('任命・解任する領主を選び直してください。');
 const epoch=privilegeEpoch,payload={targetPlayerId:target.id,action,requestId:crypto.randomUUID()},appoint=action==='appoint';
 return{title:appoint?'この領主をスタッフに任命しますか':'スタッフを解任しますか',description:appoint?'運営チャットへの参加とログイン履歴の確認ができ、家は德川家、本拠はスタッフ共同の駿府城になります。個人の資源や武将は維持されます。':'運営チャット・ログイン履歴・共同拠点の利用権限がなくなり、任命前の家と本拠に戻ります。共同の駿府城の成長は残ります。',details:`<dl class="social-confirm-details"><dt>領主</dt><dd>${playerName(target.name,target.evaluation,target.id)}</dd><dt>ID</dt><dd>${esc(target.id)}</dd><dt>権限</dt><dd>${appoint?'運営チャットへの参加':'スタッフを解任'}</dd></dl>`,confirmLabel:appoint?'この領主を任命':'スタッフを解任',danger:!appoint,onConfirm:async()=>{
   requireAdmin();if(epoch!==privilegeEpoch)throw staleIdentity();const result=await api('/admin/staff',{method:'POST',data:payload});if(epoch!==privilegeEpoch||!s.user?.isAdmin)throw staleIdentity();
   // result.user is the target player, never the logged-in operator.
   const updated=result.user;if(!updated||String(updated.id)!==String(target.id))throw Error('対象の任命状況を確認できませんでした。名簿を更新してください。');
   s.staffCandidates=s.staffCandidates.map(p=>String(p.id)===String(updated.id)?{...p,...updated}:p);setStaffRoster(result.staff);renderStaffLists();
   toast(updated.isStaff?`${playerText(updated.name,updated.evaluation)} をスタッフとして確認しました。`:`${playerText(updated.name,updated.evaluation)} はスタッフから解任されています。`);
  }};
}
function adminView(){
 if(!hasAdminChat())return empty('運営とスタッフの画面です','この領主には参加権限がありません。','shield');
 if(!s.user.isAdmin)s.adminSection='chat';
 const sections=s.user.isAdmin?[['chat','運営チャット'],['staff','スタッフ管理'],['announcement','御触書'],['mail','システム便']]:[['chat','運営チャット']];if(!sections.some(([id])=>id===s.adminSection))s.adminSection='chat';let content='';
 if(s.adminSection==='chat')content=chatView(channel());
 if(s.adminSection==='staff')content=staffView();
 if(s.adminSection==='announcement')content=`<form id="social-announcement-form" class="social-admin-form"><h2>御触書を届ける</h2><p>画面上部を流れる、全プレイヤー向けのお知らせです。</p><label for="social-announcement-input">お知らせ本文</label><textarea id="social-announcement-input" name="text" maxlength="300" rows="5">${esc(s.config.announcement)}</textarea><button class="social-button primary" type="submit">内容を確認する</button></form>`;
 if(s.adminSection==='mail')content=`<div class="social-admin-form"><h2>システム便を送る</h2><p>全員、または指定した領主に、便りと資源・勾玉を届けます。</p><details class="social-search-details"><summary>個別の宛先を探す</summary>${searchForm('admin')}<div id="social-admin-player-results" class="social-card-list">${playerCards(s.adminPlayers,'admin')}</div></details><form id="social-admin-mail-form"><label for="social-mail-target">宛先</label><select id="social-mail-target" name="target"><option value="all">全プレイヤー（今後登録する領主を含む）</option>${[...new Map([...s.friends,...s.adminPlayers].map(p=>[String(p.id),p])).values()].map(p=>`<option value="${esc(p.id)}">${esc(playerText(p.name,p.evaluation))}（${esc(p.id)}）</option>`).join('')}</select><label for="social-mail-title">件名</label><input id="social-mail-title" name="title" maxlength="60" required placeholder="例：新たな季節への贈り物"><label for="social-mail-body">本文</label><textarea id="social-mail-body" name="body" maxlength="2000" rows="5" required placeholder="領主へ届ける言葉を記してください。"></textarea><fieldset class="social-gift-fields"><legend>贈り物（任意）</legend>${Object.entries(RES).map(([k,label])=>`<label>${label}<input name="${k}" type="number" min="0" max="1000000" step="1" value="0" inputmode="numeric"></label>`).join('')}</fieldset><button class="social-button primary" type="submit">送信内容を確認する</button></form></div>`;
 return `<div class="social-admin-heading">${icon('shield')}<div><span class="social-eyebrow">${s.user.isAdmin?'ADMINISTRATION':'STAFF ROOM'}</span><h2>${s.user.isAdmin?'運営の間':'運営チャット'} ${role(s.user)}</h2></div></div>${s.user.isAdmin?`<div class="social-subtabs">${sections.map(([id,label])=>`<button data-social="admin-section" data-id="${id}" class="${s.adminSection===id?'active':''}">${label}</button>`).join('')}</div>`:''}${content}`;
}
function render(){
 if(!body)return;destroyAvatarEditor();if(['admin','recent-logins'].includes(s.tab)&&!hasAdminChat())s.tab='world';renderTabs();header();clearConfirm();
 body.innerHTML=s.tab==='news'?achievementsView():s.tab==='online'?onlineView():s.tab==='guild-rankings'?guildRankingsView():s.tab==='sync'?syncView():s.tab==='recovery'?recoveryView():!s.user?registerView():s.tab==='recent-logins'?recentLoginsView():s.tab==='world'?chatView(channel()):s.tab==='guild'?guildView():s.tab==='friends'?friendsView():s.tab==='mail'?mailView():s.tab==='profile'?profileView():adminView();renderMessages();mountProfileAvatar();refreshGuildTreasuryView();
}
function confirmUI({title,description,details,confirmLabel='実行する',danger=false,onConfirm,scope}){
 s.confirm={onConfirm,scope,returnFocus:document.activeElement};body.inert=true;$('#social-tabs').inert=true;const host=$('#social-confirm-host');
 host.innerHTML=`<section class="social-confirm" role="alertdialog" aria-modal="true" aria-labelledby="social-confirm-title"><div class="social-confirm-card"><div class="social-eyebrow">PLEASE CONFIRM</div><h2 id="social-confirm-title">${esc(title)}</h2><p>${esc(description)}</p>${details||''}<div class="social-actions"><button class="social-button subtle" data-social="confirm-cancel">戻る</button><button class="social-button ${danger?'danger':'primary'}" data-social="confirm-yes">${esc(confirmLabel)}</button></div></div></section>`;host.querySelector('[data-social="confirm-cancel"]').focus();
}
function clearConfirm(){const focus=s.confirm?.returnFocus;s.confirm=null;if(body)body.inert=false;const tabs=$('#social-tabs'),host=$('#social-confirm-host');if(tabs)tabs.inert=false;if(host)host.innerHTML='';if(focus?.isConnected)focus.focus();}
async function loadMe({token,commit=true,updateRelations=true}={}){const epoch=authEpoch,roleEpoch=privilegeEpoch,generation=commit?++meGeneration:0,r=await api('/me',{token});if(commit&&generation===meGeneration&&epoch===authEpoch&&roleEpoch===privilegeEpoch&&s.identity){acceptUser(r.user);if(updateRelations){s.friends=r.friends||[];s.requests=r.requests||[];applyPlayerEvaluations([...s.friends,...s.requests].filter(p=>Object.hasOwn(p,'evaluation')).map(p=>({playerId:p.id,evaluation:p.evaluation})));}s.unreadMail=Number(r.unreadMail)||0;header();}return r;}
async function refreshMailStatus(){
 if(mailStatusBusy||disposed||document.hidden||recoveryHeld||!s.identity||!s.user)return;
 mailStatusBusy=true;try{await loadMe({updateRelations:false});}catch(_){}finally{mailStatusBusy=false;}
}
async function loadConfig(){
 if(configBusy||disposed||document.hidden)return;configBusy=true;clearTimeout(configTimer);
 try{const r=await api('/config',{auth:false});s.config={announcement:typeof r.announcement==='string'?r.announcement:DEFAULT,adminClaimed:r.adminClaimed!==false,adminRecoveryAvailable:r.adminRecoveryAvailable===true,onlineCount:Number(r.onlineCount)||0};s.configLoaded=true;refreshOperatorRecoveryAccess();refreshAchievementView();header();if(s.config.adminClaimed){const claim=$('#social-admin-claim');if(claim){const key=claim.querySelector('input');if(key)key.value='';claim.remove();}}}
 catch(_){s.config.adminRecoveryAvailable=false;connected(false);}finally{configBusy=false;if(!disposed&&!document.hidden){refreshMailStatus();configTimer=setTimeout(loadConfig,30000);}}
}
async function loadChat(){
 const c=channel();if(!c)return;const owner=s.identity?.id,epoch=privilegeEpoch,membershipEpoch=guildEpoch,key=chatKey(c),cache=s.chats.get(key)||{messages:[],after:0,rendered:false},params=new URLSearchParams({channel:c.channel});if(cache.after>0)params.set('after',String(cache.after));if(c.target)params.set('target',c.target);
 const r=await api('/chat?'+params);if(String(owner)!==String(s.identity?.id)||c.channel==='admin'&&(epoch!==privilegeEpoch||!hasAdminChat())||c.channel==='guild'&&(membershipEpoch!==guildEpoch||!s.user?.guildId))return;const map=new Map(cache.messages.map(m=>[String(m.id),m]));for(const m of r.messages||[])map.set(String(m.id),m);
 cache.messages=[...map.values()].sort((a,b)=>Number(a.id)-Number(b.id)).slice(-200);cache.after=Number(r.nextAfter)||cache.after;s.chats.set(key,cache);applyPlayerEvaluations([...(r.messages||[]).filter(m=>Object.hasOwn(m,'evaluation')).map(m=>({playerId:m.userId,evaluation:m.evaluation})),...(Array.isArray(r.playerEvaluations)?r.playerEvaluations:[])]);if(channel()&&chatKey(channel())===key)renderMessages();
}
async function loadGuild(){if(!s.user)return null;const epoch=authEpoch,membershipEpoch=guildEpoch,owner=String(s.identity?.id),guildId=String(s.user.guildId||''),r=await api(guildId?'/guild':'/guilds');if(epoch!==authEpoch||membershipEpoch!==guildEpoch||owner!==String(s.identity?.id)||guildId!==String(s.user?.guildId||''))return null;s.guild=r.guild||null;s.members=r.members||[];if(r.guilds)s.guilds=r.guilds;applyPlayerEvaluations([...s.members.filter(p=>Object.hasOwn(p,'evaluation')).map(p=>({playerId:p.id,evaluation:p.evaluation})),...(r.guilds||[]).filter(g=>Object.hasOwn(g,'ownerEvaluation')).map(g=>({playerId:g.ownerId,evaluation:g.ownerEvaluation}))]);refreshGuildMembers();return r;}
async function loadMail(){const r=await api('/mail');s.mail=r.mail||[];applyPlayerEvaluations(s.mail.flatMap(mail=>mail.participants||[]));}
function schedulePoll(){clearTimeout(pollTimer);pollTimer=null;if(!disposed&&s.open&&s.user&&!['news','online','sync','recovery','recent-logins','guild-rankings'].includes(s.tab)&&!(s.tab==='guild'&&s.guildSection==='treasury')&&!document.hidden)pollTimer=setTimeout(()=>refresh({silent:true}),5000);}
async function refresh({view=false,silent=false}={}){
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
function open(tab='world'){if(disposed)return;if(tab==='letters'&&global.SengokuLetters){close();return global.SengokuLetters.openInbox();}if(tab==='trade'&&global.SengokuTrade){close();return global.SengokuTrade.openBox();}pauseRecentLogins();pauseGuildLists();clearTimeout(pollTimer);pollTimer=null;s.open=true;s.tab=tabs().some(t=>t.id===tab)?tab:'world';s.error='';render();if(!dialog.open)dialog.showModal();refresh({view:true});if(s.user&&!s.configLoaded)loadConfig();}
function close(){s.open=false;destroyAvatarEditor();pauseRecentLogins();pauseGuildLists();clearTimeout(onlineTimer);onlineTimer=null;clearTimeout(pollTimer);pollTimer=null;clearConfirm();if(dialog.open)dialog.close();}
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
 if(command==='reconnect'){await act(command,button,async()=>{await loadMe();s.error='';await global.SengokuCloudSync?.refresh?.();render();refresh({view:true});});return;}
 if(command==='sync-open'){await selectTab('sync');return;}
 if(command==='game-settings'){close();global.SengokuBridge?.openSettings?.();return;}
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
 if(command==='admin-section'){if(!hasAdminChat())return;s.adminSection=s.user.isAdmin&&['chat','staff','announcement','mail'].includes(id)?id:'chat';render();refresh({view:true});return;}
 if(command==='staff-refresh'){await act(command,button,loadStaff);return;}
 if(command==='staff-page'){if(!s.user?.isAdmin)return;const key=id==='candidates'?'staffCandidatePage':'staffPage';s[key]=Math.max(1,Number(button.dataset.page)||1);renderStaffLists();return;}
 if(command==='staff-appoint'||command==='staff-dismiss'){await act(command+':'+id,button,async()=>{confirmUI(staffConfirmation(id,command==='staff-appoint'?'appoint':'dismiss'));});return;}
 if(command==='friend-select'){s.friendId=id;render();refresh({view:true});return;}
 if(command==='mail-back'){s.openedMail=null;render();return;}
 if(command==='admin-select-player'){const p=s.adminPlayers.find(p=>String(p.id)===String(id)),select=$('#social-mail-target');if(p&&select){if(![...select.options].some(o=>o.value===String(id))){const o=document.createElement('option');o.value=id;o.textContent=`${playerText(p.name,p.evaluation)}（${p.id}）`;select.append(o);}select.value=id;toast(`${playerText(p.name,p.evaluation)} を宛先に設定しました。`);}return;}
 if(command==='logout'){confirmUI({title:'この端末の接続を解除しますか',description:'領主とクラウドの進行は残ります。この端末は同期を解除し、端末内の保存で遊べる状態になります。再接続には接続コードか領主データを使います。',confirmLabel:'接続を解除',danger:true,onConfirm:async()=>{await global.SengokuCloudSync?.flush?.();global.SengokuCloudSync?.stop?.();authEpoch++;recoveryEpoch++;recovery=null;recoveryHeld=false;clearPrivate();s.identity=null;s.user=null;s.friends=[];s.requests=[];s.chats.clear();s.unreadMail=0;applyRoleAccess();try{localStorage.removeItem(IDKEY);}catch(_){}clearTimeout(pollTimer);render();}});return;}
 if(command==='guild-leave'){await act(command,button,async()=>confirmUI(guildLeaveConfirmation()));return;}
 if(command==='friend-remove'){const p=s.friends.find(f=>String(f.id)===String(id));confirmUI({title:'フレンドを解除しますか',description:`${playerText(p?.name||'この領主',p?.evaluation)} とのフレンド関係を解除します。`,confirmLabel:'解除する',danger:true,onConfirm:async()=>{await api('/friends',{method:'DELETE',data:{userId:id}});s.friendId=null;await loadMe();render();}});return;}
 await act(command+':'+(id||''),button,async()=>{
  if(command==='guild-refresh'){await loadGuild();render();}
  if(command==='guild-join'){await api('/guild/join',{method:'POST',data:{guildId:id}});await loadMe();await loadGuild();render();await loadChat();toast('ギルドに参加しました。');}
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
  if(form.id==='social-admin-claim-form'&&(s.user?.isStaff||s.user?.isAdmin))throw Error('この領主には初回運営登録を表示していません。');
  if(form.id==='social-register-form'){
   const name=String(data.get('name')||'').trim();if(Array.from(name).length<2||Array.from(name).length>16)throw Error('領主名は2〜16文字で入力してください。');
   const r=await api('/session',{auth:false,method:'POST',data:{name,clan:String(data.get('clan')||'浪人')}}),identity={id:r.user?.id,token:r.token};if(!validIdentity(identity))throw Error('領主情報を保存できませんでした。');
   const saved=saveJSON(IDKEY,identity);installIdentity(identity,r.user);await loadMe();render();schedulePoll();await loadChat();toast(saved?'交流の間へようこそ。':'このブラウザに領主情報を保存できません。領主タブからデータを書き出してください。',!saved);
  }
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
  if(form.id==='social-guild-create-form'){await api('/guild',{method:'POST',data:{name:String(data.get('name')||'').trim()}});await loadMe();await loadGuild();render();await loadChat();toast('新しいギルドを創設しました。');}
  if(form.id==='social-player-search-form'||form.id==='social-admin-search-form'||form.id==='social-staff-search-form'){
   const epoch=privilegeEpoch,query=String(data.get('q')||'').trim(),r=await api('/players?q='+encodeURIComponent(query));
   if(form.id==='social-staff-search-form'){if(epoch!==privilegeEpoch||!s.user?.isAdmin)return;s.staffQuery=query;s.staffCandidates=Array.isArray(r.players)?r.players:[];s.staffCandidatePage=1;renderStaffLists();}
   else if(form.id==='social-admin-search-form'){if(epoch!==privilegeEpoch||!s.user?.isAdmin)return;s.adminPlayers=r.players||[];const results=$('#social-admin-player-results');if(results)results.innerHTML=s.adminPlayers.length?playerCards(s.adminPlayers,'admin'):empty('領主が見つかりません','別の名前で検索してください。','search');}
   else{s.players=r.players||[];const results=$('#social-player-results');if(results)results.innerHTML=s.players.length?playerCards(s.players,'friend'):empty('領主が見つかりません','別の名前で検索してください。','search');}
  }
  if(form.id==='social-admin-claim-form'){const key=String(data.get('key')||'');form.querySelector('[name=key]').value='';await api('/admin/claim',{method:'POST',data:{key}});global.SengokuCloudSync?.stop?.({pending:true});authEpoch++;s.config.adminClaimed=true;startCloud();await loadMe();s.tab='admin';render();await loadConfig();toast('この領主を運営として登録しました。領主データを書き出すと別端末へ引き継げます。');}
  if(form.id==='social-announcement-form'){const text=String(data.get('text')||'').trim();confirmUI({title:'御触書を更新しますか',description:'全プレイヤーの画面上部に表示されます。',details:`<div class="social-confirm-preview">${esc(text)||'運営からのお知らせを非表示にします。領主の達成記録は引き続き表示します。'}</div>`,confirmLabel:'この内容で更新',onConfirm:async()=>{requireAdmin();await api('/admin/announcement',{method:'POST',data:{text}});s.config.announcement=text;renderAnnouncement();toast('御触書を更新しました。');}});}
  if(form.id==='social-admin-mail-form'){
   const target=String(data.get('target')||''),title=String(data.get('title')||'').trim(),mailBody=String(data.get('body')||'').trim();if(!title||!mailBody)throw Error('件名と本文を入力してください。');
   const gift={};for(const k of Object.keys(RES)){const amount=Number(data.get(k)||0);if(!Number.isSafeInteger(amount)||amount<0||amount>1000000)throw Error('贈り物は0〜1,000,000の整数で入力してください。');gift[k]=amount;}
   const recipientPlayer=[...s.friends,...s.adminPlayers].find(p=>String(p.id)===target),recipient=target==='all'?'全プレイヤー（今後登録する領主を含む）':playerText(recipientPlayer?.name||target,recipientPlayer?.evaluation),payload={target,title,body:mailBody,gift:Object.values(gift).some(n=>n>0)?gift:null,requestId:crypto.randomUUID()};
   confirmUI({title:'このシステム便を送りますか',description:`宛先：${recipient}`,details:`<dl class="social-confirm-details"><dt>件名</dt><dd>${esc(title)}</dd><dt>贈り物</dt><dd>${esc(giftLabel(payload.gift))}</dd></dl><div class="social-confirm-preview">${esc(mailBody)}</div>`,confirmLabel:'この内容で送信',onConfirm:async()=>{requireAdmin();await api('/admin/mail',{method:'POST',data:payload});toast('システム便を送りました。');form.reset();}});
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
  pending=`<section class="domain-recovery-card domain-recovery-pending"><div class="domain-recovery-status-row"><span class="domain-recovery-step">${r.checking?'領主と保存を確認中':verified?'領主の認証を確認しました':'引き継ぎの確認を再開'}</span>${verified?role(r.user):''}</div><h3>${verified?playerName(r.user.name,r.user.evaluation,r.user.id):'選択した領主'}</h3>${verified&&r.kind==='admin-key'?'<p class="domain-recovery-status">元の運営の登録を確認しました。使うゲーム進行を選ぶと、元の領主として接続が完了します。</p>':''}${verified?`<p>領主ID <code>${esc(r.user.id)}</code></p>`:''}${r.error?`<p class="social-feedback is-error">${esc(r.error)}</p>`:''}${r.checking?'<p>サーバーにある領主と進行を確認しています。現在の保存は変更しません。</p>':!verified?'<p>この画面を閉じず、通信を確認してから続けてください。</p><button class="social-button primary" data-social="recovery-retry">認証と保存を再確認</button>':cloud?`<p>サーバーに保存された進行があります。この進行を読み込み、同じ領主として接続します。${r.save?'選んだファイルの進行は自動で上書き送信しません。':''}</p><p class="social-small">最終保存 ${esc(date(r.snapshot.updatedAt)||'日時未記録')}</p><button class="social-button primary" data-social="recovery-connect" data-id="cloud">サーバーの進行で接続</button>`:r.prepared?`<p>サーバーにはまだゲームの進行が保存されていません。選んだゲームセーブを読み込み、この領主の進行として同期します。</p>${helper.summaryHtml(r.prepared.summary)}<button class="social-button primary" data-social="recovery-connect" data-id="file">このセーブを引き継ぐ</button>`:`<p><strong>領主の登録は確認できましたが、サーバーにゲームの進行は未保存です。</strong>以前の城・武将・資源を戻すには、以前の端末から書き出したゲームセーブも必要です。</p><button class="social-button primary" data-social="recovery-files">ゲームセーブを追加する</button>${localRecoveryChoice(r.user)}`}<div class="social-right"><button class="social-text-button" data-social="recovery-clear" ${r.checking?'disabled':''}>選んだ引き継ぎを取り消す</button></div></section>`;
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
 return{title:'この領主として再接続しますか',description:mode==='new-admin'?'以前の未保存の進行は復元されません。運営の江戸城と德川家康Uで、新しい進行を始めます。':mode==='local'?'以前の未保存の進行は復元されません。表示しているこの端末の進行を最初のクラウド保存にします。':mode==='cloud'?'サーバーの最新の進行を読み込みます。この端末の現在の進行は読み込み前にバックアップします。':'選んだゲームセーブを読み込み、同じ領主の進行として自動同期を始めます。',details:`<dl class="social-confirm-details"><dt>領主</dt><dd>${playerName(stage.user.name,stage.user.evaluation,stage.user.id)} ${role(stage.user)}</dd><dt>ID</dt><dd>${esc(stage.user.id)}</dd></dl>${prepared?recoveryTools().summaryHtml(prepared.summary):''}`,confirmLabel:label,onConfirm:()=>commitRecovery(stage,epoch,mode,selected)};
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
 document.body.append(dialog);body=$('#social-dialog-body');dialog.addEventListener('click',click);dialog.addEventListener('submit',submit);dialog.addEventListener('change',event=>{if(['social-guild-direction','social-guild-resource'].includes(event.target.id))refreshGuildTreasuryView();});
 dialog.addEventListener('close',()=>{s.open=false;destroyAvatarEditor();pauseRecentLogins();pauseGuildLists();clearTimeout(onlineTimer);onlineTimer=null;clearTimeout(pollTimer);pollTimer=null;});dialog.addEventListener('cancel',event=>{if(s.confirm){event.preventDefault();clearConfirm();}});
 dialog.addEventListener('keydown',event=>{if(s.confirm&&event.key==='Tab'){const focusable=[...$('#social-confirm-host').querySelectorAll('button:not(:disabled),input,textarea,select')];if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement))){event.preventDefault();first.focus();}}return;}if(event.target.id==='social-chat-input'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();event.target.form.requestSubmit();}});
 $('#social-identity-file').addEventListener('change',event=>{const files=Array.from(event.target.files||[]);event.target.value='';importRecoveryFiles(files);});
 global.addEventListener?.('sengoku:letters-updated',lettersUpdated);document.addEventListener('click',pageClick);document.addEventListener('visibilitychange',visibility);syncUnsubscribe=global.SengokuCloudSync?.subscribe?.(renderSyncStatus);renderTabs();header();startCloud();loadConfig();loadAchievements();
 if(interruptedRecovery){open('recovery');verifyRecovery({identity:s.identity,save:null,kind:'interrupted'}).catch(error=>{if(error.code!=='STALE_IDENTITY')toast(error.message,true);});return;}
 if(s.identity){const epoch=authEpoch;s.meLoading=true;loadMe().catch(e=>{if(epoch===authEpoch){s.error=e.message;acceptUser(null);}}).finally(()=>{if(epoch!==authEpoch)return;s.meLoading=false;if(s.open){render();refresh({view:true});}});}
}
async function dispose(){disposed=true;global.removeEventListener?.('sengoku:letters-updated',lettersUpdated);global.SengokuLetters?.dispose?.();global.SengokuTrade?.dispose?.();achievementGeneration++;clearTimeout(achievementTimer);achievementTimer=null;destroyAvatarEditor();clearRecentLogins();clearGuildData();recoveryEpoch++;recovery=null;syncUnsubscribe?.();global.SengokuCloudSync?.stop?.();clearTimeout(onlineTimer);clearTimeout(configTimer);clearTimeout(pollTimer);for(const c of controllers)c.abort();controllers.clear();document.removeEventListener('click',pageClick);document.removeEventListener('visibilitychange',visibility);dialog?.remove();launcher?.remove();}
function tradeRequest(route,options={}){
 const method=options.method||'GET';
 const read=method==='GET'&&(/^\/trades(?:\/(?:recipient|tr_[a-f0-9]{32}))?(?:\?[^#]*)?$/.test(route)||/^\/players\?q=[^&#]+$/.test(route));
 const write=method==='POST'&&/^\/trades(?:\/tr_[a-f0-9]{32}\/(?:accept|cancel|reject|claim))?$/.test(route);
 if(!read&&!write)throw Error('交易の操作を確認してください。');
 if(!s.user)throw Error('領主登録・ログイン後に交易を利用できます。');
 return api(route,{...options,background:true});
}
global.SengokuSocial={open,close,exportRecoveryBackup,tradeRequest,getUser:()=>s.user?{id:s.user.id,name:s.user.name,clan:s.user.clan,guildId:s.user.guildId||null,guildName:s.user.guildName||null,guildRole:s.user.guildRole||null,isAdmin:s.user.isAdmin===true,isStaff:s.user.isStaff===true,avatarVersion:s.user.avatarVersion||null,evaluation:publicEvaluation(s.user.evaluation)}:null,lettersRequest:(route,options={})=>{if(!/^\/letters(?:\/(?:summary|recipient|lt_[a-f0-9]{32}(?:\/(?:messages|read))?))?(?:\?[^#]*)?$/.test(route)||!['GET','POST'].includes(options.method||'GET'))throw Error('書状の操作を確認してください。');if(!s.user)throw Error('領主登録・ログイン後に書状を利用できます。');return api(route,{...options,background:true});},walkingRequest:(route,options={})=>{if(!['/walking/start','/walking/claim'].includes(route)||options.method!=='POST')throw Error('ウォーキングの操作を確認してください。');if(!s.user)throw Error('接続中の領主を確認してください。');return api(route,{...options,background:true});},fieldRequest:async(route,options={})=>{if(!/^\/field(?:\/me|\/attack|\/diplomacy)?(?:\?[^#]*)?$/.test(route))throw Error('フィールドの操作を確認してください。');const result=await api(route,options);if(route==='/field/attack'&&options.method==='POST'&&result.battle)refreshMailStatus();return result;},staffRequest:(route,options={})=>{const method=options.method||'GET';if(!(route==='/staff/base'&&method==='GET'||route==='/staff/base/upgrade'&&method==='POST'))throw Error('スタッフ共同拠点の操作を確認してください。');if(!s.user?.isStaff&&!s.user?.isAdmin)throw Error('スタッフ権限を確認してください。');return api(route,options);},guildRequest:(route,options={})=>{if(route!=='/guild/treasury/transfer'||options.method!=='POST')throw Error('ギルド金庫の操作を確認してください。');return api(route,options);},refresh:()=>refresh({view:true}),dispose,setWorldClock:async values=>{if(!s.user?.isAdmin)throw Error('運営権限が必要です。');return api('/world-clock',{method:'PATCH',data:values});}};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);

