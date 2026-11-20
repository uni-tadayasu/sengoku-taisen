/* 戦国大戦・交流の間。認証キーはサーバー側のみ。 */
(function(global){
'use strict';
const IDKEY='sengoku-online-identity-v1', CLAIMKEY='sengoku-mail-claims-v1';
const DEFAULT='戦国大戦へようこそ。一城を育て、武将とともに、あなたの天下を描いてください。';
const RES={gold:'金',rice:'兵糧',wood:'木材',stone:'石材'};
const s={identity:null,user:null,friends:[],requests:[],unreadMail:0,config:{announcement:DEFAULT,adminClaimed:true,onlineCount:0},configLoaded:false,connected:false,tab:'world',friendId:null,chats:new Map(),guilds:[],guild:null,members:[],mail:[],players:[],adminPlayers:[],adminSection:'chat',openedMail:null,open:false,meLoading:false,error:'',paused:false,pending:{},confirm:null};
let dialog,body,launcher,announcement,configTimer=null,pollTimer=null,configBusy=false,pollBusy=false,disposed=false,authEpoch=0;
const busy=new Set(),controllers=new Set();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=selector=>dialog?.querySelector(selector);
const num=n=>Math.max(0,Number(n)||0).toLocaleString('ja-JP');
const paths={chat:'M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5',close:'m6 6 12 12M18 6 6 18',mail:'M3 5h18v14H3V5Zm0 1 9 7 9-7',people:'M9 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-6 8v-2a6 6 0 0 1 12 0v2M17 5a3 3 0 0 1 0 6m1 3a5 5 0 0 1 3 4v2',shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6',flag:'M5 21V3m0 1c5-4 8 4 14 0v10c-6 4-9-4-14 0',send:'m3 4 18 8-18 8 4-8-4-8Zm4 8h14',pause:'M8 5v14M16 5v14',play:'m8 4 12 8-12 8V4Z',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',upload:'M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5',search:'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm5-2 5.5 6',gift:'M3 9h18v4H3V9Zm2 4v8h14v-8M12 9v12M12 9C5 9 5 3 8 3s4 6 4 6Zm0 0c7 0 7-6 4-6s-4 6-4 6',user:'M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM4 21v-2a8 8 0 0 1 16 0v2',refresh:'M20 8a9 9 0 0 0-15-3L2 8m0-5v5h5M4 16a9 9 0 0 0 15 3l3-3m0 5v-5h-5'};
const icon=name=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name]||paths.chat}"/></svg>`;
const first=name=>esc(Array.from(String(name||'領主'))[0]);
const role=p=>p?.isAdmin?'<span class="social-role">運営</span>':'';
const giftLabel=g=>Object.entries(RES).filter(([k])=>Number(g?.[k])>0).map(([k,label])=>`${label} ${num(g[k])}`).join(' / ')||'添付なし';
function base(){try{const raw=global.SENGOKU_API_BASE;if(typeof raw!=='string'||!raw.trim())return null;const u=new URL(raw);if(!['https:','http:'].includes(u.protocol))return null;return raw.replace(/\/+$/,'').replace(/\/api\/v1$/,'')+'/api/v1';}catch(_){return null;}}
function validIdentity(v){return v&&typeof v==='object'&&(typeof v.id==='string'||Number.isSafeInteger(v.id))&&String(v.id).length>0&&String(v.id).length<180&&typeof v.token==='string'&&v.token.length>=20&&v.token.length<=8192&&!/\s/.test(v.token);}
function saveJSON(key,value){try{const raw=JSON.stringify(value);localStorage.setItem(key,raw);return localStorage.getItem(key)===raw;}catch(_){return false;}}
function readJSON(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch(_){return fallback;}}
function toast(message,error=false){global.SengokuBridge?.toast?.(message,error);const el=$('#social-feedback');if(el){el.textContent=message;el.classList.toggle('is-error',error);el.hidden=false;}}
function date(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d):'';}
function clearPrivate(){s.mail=[];s.openedMail=null;s.guild=null;s.members=[];s.guilds=[];s.players=[];s.adminPlayers=[];s.friendId=null;s.chats.clear();s.confirm=null;}
function connected(value){s.connected=value;header();}
async function api(route,{method='GET',data,auth=true,token}={}){
 const origin=base();if(!origin)throw Error('通信機能は現在利用できません。ゲーム本体は引き続き遊べます。');
 const loadingId=method!=='GET'?global.SengokuLoading?.begin('通信を届けています…'):null;
 const controller=new AbortController();controllers.add(controller);const timeout=setTimeout(()=>controller.abort(),12000);
 const headers={Accept:'application/json'};if(data!==undefined)headers['Content-Type']='application/json';
 const requestEpoch=authEpoch,implicitIdentity=token===undefined&&(auth||route==='/session');
 const bearer=token??(auth?s.identity?.token:null);if(bearer)headers.Authorization=`Bearer ${bearer}`;
 try{
  const response=await fetch(origin+route,{method,headers,body:data!==undefined?JSON.stringify(data):undefined,signal:controller.signal,credentials:'omit',cache:'no-store'});
  let result;try{result=await response.json();}catch(_){throw Error('通信の応答を読み取れませんでした。時間をおいてお試しください。');}
  if(implicitIdentity&&requestEpoch!==authEpoch){const stale=Error('接続する領主が変わったため、以前の通信処理を取り消しました。');stale.code='STALE_IDENTITY';throw stale;}
  if(!response.ok||result.ok===false){const error=Error(result?.error?.message||'通信処理を完了できませんでした。');error.code=result?.error?.code;error.status=response.status;throw error;}
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
 const count=$('#social-online-count');if(count)count.textContent=s.configLoaded?`最近の接続 ${num(s.config.onlineCount)} 人`:'城主たちの集う場所';
 const badge=launcher?.querySelector('.social-unread');if(badge){badge.textContent=s.unreadMail>99?'99+':String(s.unreadMail);badge.hidden=!s.unreadMail;}
 const mailBadge=$('[data-social-tab="mail"] .social-tab-count');if(mailBadge)mailBadge.textContent=s.unreadMail?String(s.unreadMail):'';
}
function renderAnnouncement(){
 if(!announcement)return;const text=String(s.config.announcement??DEFAULT).slice(0,300),line=announcement.querySelector('.social-announcement-text');if(line.textContent!==text)line.textContent=text;
 announcement.hidden=s.configLoaded&&text.length===0;announcement.classList.toggle('is-paused',s.paused);const button=announcement.querySelector('button');button.innerHTML=icon(s.paused?'play':'pause');button.setAttribute('aria-label',s.paused?'お知らせのスクロールを再開':'お知らせのスクロールを停止');button.setAttribute('aria-pressed',String(s.paused));
}
function tabs(){return[{id:'world',label:'世界',icon:'chat'},{id:'guild',label:'ギルド',icon:'flag'},{id:'friends',label:'フレンド',icon:'people'},{id:'mail',label:'郵便',icon:'mail'},{id:'profile',label:'領主',icon:'user'},...(s.user?.isAdmin?[{id:'admin',label:'運営',icon:'shield'}]:[])];}
function renderTabs(){const nav=$('#social-tabs');if(nav)nav.innerHTML=tabs().map(t=>`<button type="button" role="tab" aria-selected="${s.tab===t.id}" data-social-tab="${t.id}" class="${s.tab===t.id?'active':''}">${icon(t.icon)}${t.label}${t.id==='mail'?`<span class="social-tab-count">${s.unreadMail||''}</span>`:''}</button>`).join('');}
function registerView(){
 const clan=String(global.SengokuBridge?.getState?.()?.clan||'浪人');
 return `<div class="social-welcome"><div class="social-welcome-seal">交</div><div class="social-eyebrow">THE COMMON ROOM</div><h2>領主たちと、言葉を交わす。</h2><p>世界の会話、仲間とのギルド、友との文。<br>名前を決めたら、交流の間へお入りください。</p></div>${s.meLoading?'<div class="social-notice">領主情報を確認しています…</div>':`<form id="social-register-form" class="social-register-form"><label for="social-register-name">交流で表示する名前</label><input id="social-register-name" name="name" minlength="2" maxlength="16" autocomplete="nickname" placeholder="領主名（2〜16文字）" required><input name="clan" type="hidden" value="${esc(clan)}"><button class="social-button primary" type="submit" ${!base()?'disabled':''}>${icon('chat')}接続する</button></form>`}<div class="social-notice">登録は任意です。ゲーム本体は登録せず遊べます。交流にはインターネット接続が必要です。領主の認証情報はこのブラウザに保存されます。</div>${s.error?`<div class="social-feedback is-error">${esc(s.error)}</div>`:''}${!base()?'<div class="social-feedback is-error">通信機能は現在準備中です。城下町はそのままお楽しみいただけます。</div>':''}<div class="social-center"><button class="social-text-button" data-social="identity-import">以前の領主データを読み込む</button>${s.identity?'<button class="social-text-button" data-social="reconnect">接続を確認する</button>':''}</div>`;
}
function channel(){
 if(!s.user)return null;
 if(s.tab==='world')return{channel:'world',target:null,title:'世界の広場',caption:'すべての領主が集う、開かれた会話です。'};
 if(s.tab==='guild'&&s.user.guildId)return{channel:'guild',target:null,title:s.user.guildName||'ギルド',caption:'このギルドの仲間だけが読める会話です。'};
 if(s.tab==='friends'&&s.friendId&&s.friends.some(f=>String(f.id)===String(s.friendId)))return{channel:'friend',target:s.friendId,title:s.friends.find(f=>String(f.id)===String(s.friendId))?.name||'友との文',caption:'選んだフレンドと二人で話します。'};
 if(s.tab==='admin'&&s.user.isAdmin&&s.adminSection==='chat')return{channel:'admin',target:null,title:'運営の控え間',caption:'運営だけが参加できる連絡用の会話です。'};return null;
}
function chatKey(c){return `${c.channel}:${c.target||(c.channel==='guild'?s.user?.guildId:'')||''}`;}
function chatView(c){return `<section class="social-chat"><div class="social-section-heading"><div><h3>${esc(c.title)}</h3><p>${esc(c.caption)}</p></div><span class="social-small">5秒ごとに更新</span></div><div id="social-message-list" class="social-message-list" role="log" aria-live="polite" aria-relevant="additions text"></div><form id="social-chat-form" class="social-chat-form"><label class="social-sr-only" for="social-chat-input">メッセージ</label><textarea id="social-chat-input" name="text" rows="2" maxlength="300" placeholder="言葉を交わす…（300文字まで）" required></textarea><div class="social-chat-form-bottom"><span>Enterで送信 · Shift+Enterで改行</span><button type="submit" class="social-button primary">${icon('send')}送信</button></div></form></section>`;}
function renderMessages(){
 const c=channel(),list=$('#social-message-list');if(!c||!list)return;const cache=s.chats.get(chatKey(c)),messages=cache?.messages||[],nearBottom=list.scrollHeight-list.scrollTop-list.clientHeight<90,oldTop=list.scrollTop;
 if(!cache){list.innerHTML=empty('会話を読み込んでいます','しばらくお待ちください。');return;}
 if(!messages.length){list.innerHTML=empty('まだ、言葉は届いていません','最初のひと言から、交流を始めましょう。');return;}
 const signature=messages.map(m=>m.id).join(',');if(list.dataset.signature===signature)return;
 list.innerHTML=messages.map(m=>`<article class="social-message ${String(m.userId)===String(s.user.id)?'own':''}"><div class="social-avatar">${first(m.name)}</div><div class="social-message-content"><div class="social-message-meta"><strong>${esc(m.name)}</strong>${m.isAdmin?'<span class="social-role">運営</span>':''}<time>${esc(date(m.createdAt))}</time></div><p>${esc(m.text)}</p></div></article>`).join('');list.dataset.signature=signature;
 if(nearBottom||!cache.rendered)list.scrollTop=list.scrollHeight;else list.scrollTop=oldTop;cache.rendered=true;
}
function guildView(){
 if(s.user.guildId)return `<div class="social-guild-heading"><div class="social-guild-mon">${icon('flag')}</div><div><span class="social-eyebrow">YOUR GUILD</span><h2>${esc(s.user.guildName)}</h2><p>${s.guild?`${num(s.guild.memberCount)} / ${num(s.guild.maxMembers||50)} 人`:'仲間と歩む天下への道'} · ${s.user.guildRole==='owner'?'あなたは主宰です':'参加中'}</p></div><button class="social-button subtle" data-social="guild-leave">脱退</button></div><details class="social-member-details"><summary>所属する領主 <span>${s.members.length}人</span></summary><div class="social-member-grid">${s.members.map(p=>`<div><span class="social-avatar small">${first(p.name)}</span><strong>${esc(p.name)}</strong>${role(p)}</div>`).join('')||'<p class="social-small">所属情報を確認しています。</p>'}</div></details>${chatView(channel())}`;
 return `<div class="social-section-heading"><div><h2>志を同じくする仲間と。</h2><p>ギルドに参加すると、仲間だけの会話が使えます。</p></div><button class="social-icon-button" data-social="guild-refresh" aria-label="ギルド一覧を更新">${icon('refresh')}</button></div><form id="social-guild-create-form" class="social-inline-form"><label class="social-sr-only" for="social-guild-name">新しいギルド名</label><input id="social-guild-name" name="name" minlength="2" maxlength="24" placeholder="新しいギルド名（2〜24文字）" required><button class="social-button" type="submit">${icon('flag')}創設する</button></form><div class="social-card-list">${s.guilds.length?s.guilds.map(g=>`<article class="social-list-card"><span class="social-avatar">${first(g.name)}</span><div><h3>${esc(g.name)}</h3><p>主宰 ${esc(g.ownerName)} · ${num(g.memberCount)} / ${num(g.maxMembers||50)} 人</p></div><button class="social-button small" data-social="guild-join" data-id="${esc(g.id)}" ${g.memberCount>=g.maxMembers?'disabled':''}>参加</button></article>`).join(''):empty('新しい旗を立てよう','参加できるギルドはまだありません。あなたのギルドを創設できます。','flag')}</div>`;
}
function searchForm(prefix='player'){return `<form id="social-${prefix}-search-form" class="social-inline-form"><label class="social-sr-only" for="social-${prefix}-query">領主を探す</label><input id="social-${prefix}-query" name="q" minlength="2" maxlength="24" placeholder="領主の名前で探す" required><button class="social-button" type="submit">${icon('search')}検索</button></form>`;}
function playerCards(players,mode){return players.map(p=>`<article class="social-list-card"><span class="social-avatar small">${first(p.name)}</span><div><h3>${esc(p.name)} ${role(p)}</h3><p>${esc(p.clan||'浪人')}${p.guildName?' · '+esc(p.guildName):''}</p><code class="social-player-id">${esc(p.id)}</code></div>${mode==='friend'?(String(p.id)===String(s.user.id)?'<span class="social-small">あなた</span>':s.friends.some(f=>String(f.id)===String(p.id))?'<span class="social-small">フレンド</span>':s.requests.some(r=>String(r.id)===String(p.id))?'<span class="social-small">申請中</span>':`<button class="social-button small" data-social="friend-request" data-id="${esc(p.id)}">申請</button>`):`<button class="social-button small" data-social="admin-select-player" data-id="${esc(p.id)}">宛先にする</button>`}</article>`).join('');}
function friendsView(){
 const requests=s.requests.length?`<section class="social-requests"><h3>届いた申請・送った申請</h3>${s.requests.map(r=>`<article class="social-list-card"><span class="social-avatar small">${first(r.name)}</span><div><h3>${esc(r.name)}</h3><p>${r.direction==='incoming'?'あなたへ申請が届いています':'承認を待っています'}</p></div>${r.direction==='incoming'?`<button class="social-button small primary" data-social="friend-accept" data-id="${esc(r.id)}">承認</button><button class="social-button small subtle" data-social="friend-reject" data-id="${esc(r.id)}">辞退</button>`:'<span class="social-small">申請中</span>'}</article>`).join('')}</section>`:'';
 return `<details class="social-search-details" ${s.players.length?'open':''}><summary>${icon('search')}領主を探して、フレンド申請</summary>${searchForm()}<div id="social-player-results" class="social-card-list">${playerCards(s.players,'friend')}</div></details>${requests}<div class="social-friends-layout"><aside class="social-friend-list"><h3>フレンド <span>${s.friends.length}</span></h3>${s.friends.length?s.friends.map(f=>`<button class="social-friend ${String(s.friendId)===String(f.id)?'selected':''}" data-social="friend-select" data-id="${esc(f.id)}"><span class="social-avatar small">${first(f.name)}</span><span><b>${esc(f.name)}</b><small>${f.online?'最近接続':esc(f.clan||'浪人')}</small></span></button>`).join(''):'<p class="social-small">名前を検索して、申請を送りましょう。</p>'}</aside><div class="social-friend-conversation">${channel()?`${chatView(channel())}<div class="social-right"><button class="social-text-button danger" data-social="friend-remove" data-id="${esc(s.friendId)}">このフレンドを解除</button></div>`:empty('友との文をひらく','フレンドを選ぶと、二人だけで話せます。','people')}</div></div>`;
}
function mailView(){
 const selected=s.mail.find(m=>String(m.id)===String(s.openedMail));
 if(selected){const pending=s.pending[`${s.identity.id}:${selected.id}`];return `<button class="social-text-button" data-social="mail-back">受信一覧に戻る</button><article class="social-letter"><div class="social-eyebrow">SYSTEM LETTER</div><h2>${esc(selected.title)}</h2><div class="social-letter-date">運営から · ${esc(date(selected.createdAt))}</div><div class="social-letter-body">${esc(selected.body)}</div>${selected.gift?`<div class="social-gift"><span>${icon('gift')}</span><div><b>同封された贈り物</b><p>${esc(giftLabel(selected.gift))}</p></div><button class="social-button primary" data-social="mail-claim" data-id="${esc(selected.id)}" ${selected.claimed&&!pending?'disabled':''}>${pending?'受け取りを再確認':selected.claimed?'受取済み':'受け取る'}</button></div>`:''}</article>`;}
 return `<div class="social-section-heading"><div><h2>届いた便り</h2><p>運営からのお知らせと贈り物を確認できます。</p></div><button class="social-icon-button" data-social="mail-refresh" aria-label="郵便を更新">${icon('refresh')}</button></div><div class="social-card-list">${s.mail.length?s.mail.map(m=>`<button class="social-mail-row ${m.read?'':'unread'}" data-social="mail-open" data-id="${esc(m.id)}"><span class="social-mail-symbol">${icon(m.gift?'gift':'mail')}</span><span><b>${esc(m.title)}</b><small>${esc(date(m.createdAt))} · ${m.gift?(m.claimed?'贈り物は受取済み':'贈り物あり'):'お知らせ'}</small></span><span class="social-mail-state">${m.read?'既読':'未読'}</span></button>`).join(''):empty('まだ便りは届いていません','お知らせや贈り物は、こちらへ届きます。','mail')}</div>`;
}
function profileView(){return `<div class="social-profile-heading"><span class="social-profile-mon">${first(s.user.name)}</span><div><div class="social-eyebrow">YOUR IDENTITY</div><h2>${esc(s.user.name)} ${role(s.user)}</h2><p>${esc(s.user.clan||'浪人')} · ${s.user.guildName?esc(s.user.guildName):'ギルド未所属'}</p></div></div><div class="social-profile-id"><span>領主ID</span><code>${esc(s.user.id)}</code></div><section class="social-profile-section"><h3>領主データの引き継ぎ</h3><p>認証情報を書き出すと、別の端末でも同じ領主として接続できます。運営権限も同じ領主に引き継がれます。</p><div class="social-actions"><button class="social-button" data-social="identity-export">${icon('download')}領主データを書き出す</button><button class="social-button" data-social="identity-import">${icon('upload')}読み込む</button></div><div class="social-notice">このファイルは領主本人の認証情報を含みます。自分の端末間で使い、他の人には渡さないでください。ゲームの進行状況は、ゲーム側のセーブデータで別に引き継ぎます。</div></section>${!s.config.adminClaimed&&!s.user.isAdmin?`<section id="social-admin-claim" class="social-profile-section"><h3>運営登録</h3><p>運営者用の登録キーをお持ちの場合に使用します。登録が完了すると、この欄は他の領主には表示されません。</p><form id="social-admin-claim-form" class="social-inline-form"><label class="social-sr-only" for="social-admin-key">運営登録キー</label><input id="social-admin-key" name="key" type="password" autocomplete="off" maxlength="256" placeholder="運営登録キー" required><button class="social-button" type="submit">運営として登録</button></form></section>`:''}<div class="social-right"><button class="social-text-button danger" data-social="logout">この端末の接続を解除</button></div>`;}
function adminView(){
 if(!s.user.isAdmin)return empty('運営専用の画面です','この領主には運営権限がありません。','shield');
 const sections=[['chat','運営チャット'],['announcement','御触書'],['mail','システム便']];let content='';
 if(s.adminSection==='chat')content=chatView(channel());
 if(s.adminSection==='announcement')content=`<form id="social-announcement-form" class="social-admin-form"><h2>御触書を届ける</h2><p>画面上部を流れる、全プレイヤー向けのお知らせです。</p><label for="social-announcement-input">お知らせ本文</label><textarea id="social-announcement-input" name="text" maxlength="300" rows="5">${esc(s.config.announcement)}</textarea><button class="social-button primary" type="submit">内容を確認する</button></form>`;
 if(s.adminSection==='mail')content=`<div class="social-admin-form"><h2>システム便を送る</h2><p>全員、または指定した領主に、便りと資源を届けます。</p><details class="social-search-details"><summary>個別の宛先を探す</summary>${searchForm('admin')}<div id="social-admin-player-results" class="social-card-list">${playerCards(s.adminPlayers,'admin')}</div></details><form id="social-admin-mail-form"><label for="social-mail-target">宛先</label><select id="social-mail-target" name="target"><option value="all">全プレイヤー（今後登録する領主を含む）</option>${[...new Map([...s.friends,...s.adminPlayers].map(p=>[String(p.id),p])).values()].map(p=>`<option value="${esc(p.id)}">${esc(p.name)}（${esc(p.id)}）</option>`).join('')}</select><label for="social-mail-title">件名</label><input id="social-mail-title" name="title" maxlength="60" required placeholder="例：新たな季節への贈り物"><label for="social-mail-body">本文</label><textarea id="social-mail-body" name="body" maxlength="2000" rows="5" required placeholder="領主へ届ける言葉を記してください。"></textarea><fieldset class="social-gift-fields"><legend>贈り物（任意）</legend>${Object.entries(RES).map(([k,label])=>`<label>${label}<input name="${k}" type="number" min="0" max="1000000" step="1" value="0" inputmode="numeric"></label>`).join('')}</fieldset><button class="social-button primary" type="submit">送信内容を確認する</button></form></div>`;
 return `<div class="social-admin-heading">${icon('shield')}<div><span class="social-eyebrow">ADMINISTRATION</span><h2>運営の間</h2></div></div><div class="social-subtabs">${sections.map(([id,label])=>`<button data-social="admin-section" data-id="${id}" class="${s.adminSection===id?'active':''}">${label}</button>`).join('')}</div>${content}`;
}
function render(){
 if(!body)return;if(s.tab==='admin'&&!s.user?.isAdmin)s.tab='world';renderTabs();header();clearConfirm();
 body.innerHTML=!s.user?registerView():s.tab==='world'?chatView(channel()):s.tab==='guild'?guildView():s.tab==='friends'?friendsView():s.tab==='mail'?mailView():s.tab==='profile'?profileView():adminView();renderMessages();
}
function confirmUI({title,description,details,confirmLabel='実行する',danger=false,onConfirm}){
 s.confirm={onConfirm,returnFocus:document.activeElement};body.inert=true;$('#social-tabs').inert=true;const host=$('#social-confirm-host');
 host.innerHTML=`<section class="social-confirm" role="alertdialog" aria-modal="true" aria-labelledby="social-confirm-title"><div class="social-confirm-card"><div class="social-eyebrow">PLEASE CONFIRM</div><h2 id="social-confirm-title">${esc(title)}</h2><p>${esc(description)}</p>${details||''}<div class="social-actions"><button class="social-button subtle" data-social="confirm-cancel">戻る</button><button class="social-button ${danger?'danger':'primary'}" data-social="confirm-yes">${esc(confirmLabel)}</button></div></div></section>`;host.querySelector('[data-social="confirm-cancel"]').focus();
}
function clearConfirm(){const focus=s.confirm?.returnFocus;s.confirm=null;body.inert=false;$('#social-tabs').inert=false;$('#social-confirm-host').innerHTML='';if(focus?.isConnected)focus.focus();}
async function loadMe({token,commit=true}={}){const epoch=authEpoch,r=await api('/me',{token});if(commit&&epoch===authEpoch&&s.identity){const oldRole=s.user?.isAdmin;s.user=r.user;s.friends=r.friends||[];s.requests=r.requests||[];s.unreadMail=Number(r.unreadMail)||0;if(oldRole!==s.user.isAdmin)renderTabs();header();}return r;}
async function loadConfig(){
 if(configBusy||disposed||document.hidden)return;configBusy=true;clearTimeout(configTimer);
 try{const r=await api('/config',{auth:false});s.config={announcement:typeof r.announcement==='string'?r.announcement:DEFAULT,adminClaimed:Boolean(r.adminClaimed),onlineCount:Number(r.onlineCount)||0};s.configLoaded=true;renderAnnouncement();header();if(s.config.adminClaimed){const claim=$('#social-admin-claim');if(claim){const key=claim.querySelector('input');if(key)key.value='';claim.remove();}}}
 catch(_){connected(false);}finally{configBusy=false;if(!disposed&&!document.hidden)configTimer=setTimeout(loadConfig,30000);}
}
async function loadChat(){
 const c=channel();if(!c)return;const owner=s.identity?.id,key=chatKey(c),cache=s.chats.get(key)||{messages:[],after:0,rendered:false},params=new URLSearchParams({channel:c.channel});if(cache.after>0)params.set('after',String(cache.after));if(c.target)params.set('target',c.target);
 const r=await api('/chat?'+params);if(String(owner)!==String(s.identity?.id))return;const map=new Map(cache.messages.map(m=>[String(m.id),m]));for(const m of r.messages||[])map.set(String(m.id),m);
 cache.messages=[...map.values()].sort((a,b)=>Number(a.id)-Number(b.id)).slice(-200);cache.after=Number(r.nextAfter)||cache.after;s.chats.set(key,cache);if(channel()&&chatKey(channel())===key)renderMessages();
}
async function loadGuild(){const r=await api(s.user.guildId?'/guild':'/guilds');s.guild=r.guild||null;s.members=r.members||[];if(r.guilds)s.guilds=r.guilds;}
async function loadMail(){const r=await api('/mail');s.mail=r.mail||[];}
function schedulePoll(){clearTimeout(pollTimer);pollTimer=null;if(!disposed&&s.open&&s.user&&!document.hidden)pollTimer=setTimeout(()=>refresh({silent:true}),5000);}
async function refresh({view=false,silent=false}={}){
 if(pollBusy||disposed||!s.open||document.hidden||!s.user)return;pollBusy=true;clearTimeout(pollTimer);
 try{
  const before={guild:s.user.guildId,friends:s.friends.map(f=>f.id).join(','),requests:JSON.stringify(s.requests),admin:s.user.isAdmin};await loadMe();if(!s.user)return;
  if(s.tab==='guild'&&(view||before.guild!==s.user.guildId))await loadGuild();
  if(s.tab==='mail'){await loadMail();if(!s.confirm&&(!s.openedMail||view))render();}
  else if(!s.confirm&&(view||before.guild!==s.user.guildId||before.admin!==s.user.isAdmin||(s.tab==='friends'&&(before.friends!==s.friends.map(f=>f.id).join(',')||before.requests!==JSON.stringify(s.requests)))))render();
  await loadChat();
 }catch(e){if(!silent&&e.code!=='STALE_IDENTITY')toast(e.message,true);if(e.status===401){s.user=null;s.error='領主情報を確認できませんでした。保存した領主データから再接続してください。';render();}}
 finally{pollBusy=false;schedulePoll();}
}
function open(tab='world'){if(disposed)return;s.open=true;s.tab=tabs().some(t=>t.id===tab)?tab:'world';s.error='';render();if(!dialog.open)dialog.showModal();refresh({view:true});if(s.user&&!s.configLoaded)loadConfig();}
function close(){s.open=false;clearTimeout(pollTimer);pollTimer=null;clearConfirm();if(dialog.open)dialog.close();}
async function selectTab(tab){s.tab=tab;s.openedMail=null;render();await refresh({view:true});}
function downloadJSON(filename,data){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
async function claimGift(mailId){
 const mail=s.mail.find(m=>String(m.id)===String(mailId));if(!mail?.gift)throw Error('この便りには贈り物がありません。');
 if(typeof global.SengokuBridge?.canReceiveGifts==='function'&&!global.SengokuBridge.canReceiveGifts())throw Error('ゲームの自動保存を利用できません。保存できるブラウザで受け取ってください。');
 if(typeof global.SengokuBridge?.applyGift!=='function')throw Error('ゲームの保存状態を確認できません。ゲームを再読み込みしてから受け取ってください。');
 const key=`${s.identity.id}:${mailId}`;let requestId=s.pending[key];
 if(!requestId){requestId=crypto.randomUUID();s.pending[key]=requestId;if(!saveJSON(CLAIMKEY,s.pending)){delete s.pending[key];throw Error('受け取りの記録を保存できません。ブラウザの保存設定を確認してください。');}}
 const r=await api('/mail/claim',{method:'POST',data:{mailId,requestId}});if(!r.receiptId||!r.gift)throw Error('受取結果を確認できませんでした。同じボタンで再確認してください。');
 const applied=await Promise.resolve(global.SengokuBridge.applyGift(r.gift,r.receiptId));if(!applied?.ok)throw Error(applied?.message||'ゲームへの反映を保存できませんでした。もう一度受け取りを確認してください。');
 delete s.pending[key];saveJSON(CLAIMKEY,s.pending);mail.claimed=true;toast(applied.already?'この贈り物は、すでにゲームへ反映されています。':'贈り物を受け取り、ゲームへ反映しました。');await loadMail();render();
}
async function click(event){
 const tab=event.target.closest('[data-social-tab]');if(tab){await selectTab(tab.dataset.socialTab);return;}
 const button=event.target.closest('[data-social]');if(!button)return;const command=button.dataset.social,id=button.dataset.id;
 if(command==='close'){close();return;}
 if(command==='confirm-cancel'){clearConfirm();return;}
 if(command==='confirm-yes'){const fn=s.confirm?.onConfirm;if(fn)await act('confirm',button,async()=>{await fn();clearConfirm();});return;}
 if(command==='identity-import'){$('#social-identity-file').click();return;}
 if(command==='identity-export'){if(s.identity)downloadJSON('sengoku-lord-identity.json',{format:'sengoku-lord-identity',version:1,id:s.identity.id,token:s.identity.token,name:s.user?.name||''});return;}
 if(command==='reconnect'){await act(command,button,async()=>{await loadMe();s.error='';render();refresh({view:true});});return;}
 if(command==='admin-section'){s.adminSection=id;render();refresh({view:true});return;}
 if(command==='friend-select'){s.friendId=id;render();refresh({view:true});return;}
 if(command==='mail-back'){s.openedMail=null;render();return;}
 if(command==='admin-select-player'){const p=s.adminPlayers.find(p=>String(p.id)===String(id)),select=$('#social-mail-target');if(p&&select){if(![...select.options].some(o=>o.value===String(id))){const o=document.createElement('option');o.value=id;o.textContent=`${p.name}（${p.id}）`;select.append(o);}select.value=id;toast(`${p.name} を宛先に設定しました。`);}return;}
 if(command==='logout'){confirmUI({title:'この端末の接続を解除しますか',description:'領主そのものは残ります。再接続に備えて、領主データを書き出しておいてください。',confirmLabel:'接続を解除',danger:true,onConfirm:async()=>{authEpoch++;clearPrivate();s.identity=null;s.user=null;s.friends=[];s.requests=[];s.chats.clear();s.unreadMail=0;try{localStorage.removeItem(IDKEY);}catch(_){}clearTimeout(pollTimer);render();}});return;}
 if(command==='guild-leave'){confirmUI({title:`${s.user.guildName} を脱退しますか`,description:s.user.guildRole==='owner'?'主宰が最後の一人の場合はギルドが解散します。仲間がいる場合は主宰が引き継がれます。':'脱退すると、このギルドの会話は読めなくなります。',confirmLabel:'脱退する',danger:true,onConfirm:async()=>{await api('/guild/leave',{method:'POST',data:{}});await loadMe();await loadGuild();render();toast('ギルドを脱退しました。');}});return;}
 if(command==='friend-remove'){const p=s.friends.find(f=>String(f.id)===String(id));confirmUI({title:'フレンドを解除しますか',description:`${p?.name||'この領主'} とのフレンド関係を解除します。`,confirmLabel:'解除する',danger:true,onConfirm:async()=>{await api('/friends',{method:'DELETE',data:{userId:id}});s.friendId=null;await loadMe();render();}});return;}
 await act(command+':'+(id||''),button,async()=>{
  if(command==='guild-refresh'){await loadGuild();render();}
  if(command==='guild-join'){await api('/guild/join',{method:'POST',data:{guildId:id}});await loadMe();await loadGuild();render();await loadChat();toast('ギルドに参加しました。');}
  if(command==='friend-request'){await api('/friends/request',{method:'POST',data:{userId:id}});await loadMe();render();toast('フレンド申請を送りました。');}
  if(command==='friend-accept'||command==='friend-reject'){await api('/friends/respond',{method:'POST',data:{userId:id,accept:command==='friend-accept'}});await loadMe();render();toast(command==='friend-accept'?'フレンドになりました。':'申請を辞退しました。');}
  if(command==='mail-refresh'){await loadMail();render();}
  if(command==='mail-open'){s.openedMail=id;await api('/mail/read',{method:'POST',data:{mailId:id}});const m=s.mail.find(m=>String(m.id)===String(id));if(m)m.read=true;await loadMe();render();}
  if(command==='mail-claim')await claimGift(id);
 });
}
async function submit(event){
 const form=event.target;if(!form.id?.startsWith('social-'))return;event.preventDefault();const data=new FormData(form),button=event.submitter||form.querySelector('[type=submit]');
 await act(form.id,button,async()=>{
  if(form.id==='social-register-form'){
   const name=String(data.get('name')||'').trim();if(Array.from(name).length<2||Array.from(name).length>16)throw Error('領主名は2〜16文字で入力してください。');
   const r=await api('/session',{auth:false,method:'POST',data:{name,clan:String(data.get('clan')||'浪人')}}),identity={id:r.user?.id,token:r.token};if(!validIdentity(identity))throw Error('領主情報を保存できませんでした。');
   authEpoch++;clearPrivate();s.identity=identity;s.user=r.user;const saved=saveJSON(IDKEY,identity);await loadMe();render();schedulePoll();await loadChat();toast(saved?'交流の間へようこそ。':'このブラウザに領主情報を保存できません。領主タブからデータを書き出してください。',!saved);
  }
  if(form.id==='social-chat-form'){const c=channel(),text=String(data.get('text')||'').trim();if(!c||!text)return;await api('/chat',{method:'POST',data:{channel:c.channel,...(c.target?{target:c.target}:{}),text}});form.reset();await loadChat();$('#social-chat-input')?.focus();}
  if(form.id==='social-guild-create-form'){await api('/guild',{method:'POST',data:{name:String(data.get('name')||'').trim()}});await loadMe();await loadGuild();render();await loadChat();toast('新しいギルドを創設しました。');}
  if(form.id==='social-player-search-form'||form.id==='social-admin-search-form'){
   const r=await api('/players?q='+encodeURIComponent(String(data.get('q')||'').trim()));
   if(form.id==='social-admin-search-form'){s.adminPlayers=r.players||[];$('#social-admin-player-results').innerHTML=s.adminPlayers.length?playerCards(s.adminPlayers,'admin'):empty('領主が見つかりません','別の名前で検索してください。','search');}
   else{s.players=r.players||[];$('#social-player-results').innerHTML=s.players.length?playerCards(s.players,'friend'):empty('領主が見つかりません','別の名前で検索してください。','search');}
  }
  if(form.id==='social-admin-claim-form'){const key=String(data.get('key')||'');form.querySelector('[name=key]').value='';const r=await api('/admin/claim',{method:'POST',data:{key}});s.user=r.user;s.config.adminClaimed=true;await loadMe();s.tab='admin';render();await loadConfig();toast('この領主を運営として登録しました。領主データを書き出すと別端末へ引き継げます。');}
  if(form.id==='social-announcement-form'){const text=String(data.get('text')||'').trim();confirmUI({title:'御触書を更新しますか',description:'全プレイヤーの画面上部に表示されます。',details:`<div class="social-confirm-preview">${esc(text)||'お知らせを非表示にします。'}</div>`,confirmLabel:'この内容で更新',onConfirm:async()=>{await api('/admin/announcement',{method:'POST',data:{text}});s.config.announcement=text;renderAnnouncement();toast('御触書を更新しました。');}});}
  if(form.id==='social-admin-mail-form'){
   const target=String(data.get('target')||''),title=String(data.get('title')||'').trim(),mailBody=String(data.get('body')||'').trim();if(!title||!mailBody)throw Error('件名と本文を入力してください。');
   const gift={};for(const k of Object.keys(RES)){const amount=Number(data.get(k)||0);if(!Number.isSafeInteger(amount)||amount<0||amount>1000000)throw Error('贈り物は0〜1,000,000の整数で入力してください。');gift[k]=amount;}
   const recipient=target==='all'?'全プレイヤー（今後登録する領主を含む）':([...s.friends,...s.adminPlayers].find(p=>String(p.id)===target)?.name||target),payload={target,title,body:mailBody,gift:Object.values(gift).some(n=>n>0)?gift:null,requestId:crypto.randomUUID()};
   confirmUI({title:'このシステム便を送りますか',description:`宛先：${recipient}`,details:`<dl class="social-confirm-details"><dt>件名</dt><dd>${esc(title)}</dd><dt>贈り物</dt><dd>${esc(giftLabel(payload.gift))}</dd></dl><div class="social-confirm-preview">${esc(mailBody)}</div>`,confirmLabel:'この内容で送信',onConfirm:async()=>{await api('/admin/mail',{method:'POST',data:payload});toast('システム便を送りました。');form.reset();}});
  }
 });
}
async function importIdentity(file){
 if(!file)return;if(file.size>32768){toast('領主データの形式を確認してください。',true);return;}let value;try{value=JSON.parse(await file.text());if(!validIdentity(value))throw Error();}catch(_){toast('このファイルは領主データとして読み込めません。',true);return;}
 const identity={id:value.id,token:value.token};
 confirmUI({title:'この領主として接続しますか',description:s.identity?'この端末で接続している領主を切り替えます。ゲームの進行状況は変わりません。':'保存された領主情報でサーバーに接続します。',details:`<dl class="social-confirm-details"><dt>領主</dt><dd>${esc(value.name||'保存された領主')}</dd><dt>ID</dt><dd>${esc(identity.id)}</dd></dl>`,confirmLabel:'読み込んで接続',onConfirm:async()=>{
  const r=await loadMe({token:identity.token,commit:false});if(String(r.user.id)!==String(identity.id))throw Error('領主IDと認証情報が一致しません。');
  if(!saveJSON(IDKEY,identity))throw Error('このブラウザに領主情報を保存できませんでした。');
  authEpoch++;clearPrivate();s.identity=identity;s.user=r.user;s.friends=r.friends||[];s.requests=r.requests||[];s.unreadMail=r.unreadMail||0;s.chats.clear();s.friendId=null;s.error='';s.tab='profile';render();schedulePoll();toast('領主データを読み込みました。');
 }});
}
function pageClick(event){const button=event.target.closest('[data-action="community"]');if(button){event.preventDefault();open(button.dataset.communityTab||'world');}}
function visibility(){clearTimeout(configTimer);clearTimeout(pollTimer);configTimer=pollTimer=null;if(!document.hidden&&!disposed){loadConfig();if(s.open)refresh({silent:true});}}
function init(){
 if(disposed||document.getElementById('community-modal'))return;const saved=readJSON(IDKEY,null);if(validIdentity(saved))s.identity={id:saved.id,token:saved.token};
 const pending=readJSON(CLAIMKEY,{});if(pending&&typeof pending==='object'&&!Array.isArray(pending))s.pending=Object.fromEntries(Object.entries(pending).filter(([k,v])=>k.length<240&&typeof v==='string'&&v.length<180));
 announcement=document.getElementById('announcement-bar');if(announcement){announcement.classList.add('social-announcement');announcement.innerHTML=`<span class="social-announcement-label">御触書</span><div class="social-announcement-window"><p class="social-announcement-text"></p></div><button type="button" class="social-announcement-toggle"></button>`;announcement.querySelector('button').addEventListener('click',()=>{s.paused=!s.paused;renderAnnouncement();});renderAnnouncement();}
 launcher=document.createElement('button');launcher.className='social-launcher';launcher.dataset.action='community';launcher.setAttribute('aria-label','交流の間を開く');launcher.innerHTML=`${icon('chat')}<span>交流</span><span class="social-unread" hidden></span>`;document.body.append(launcher);
 dialog=document.createElement('dialog');dialog.id='community-modal';dialog.className='social-dialog';dialog.setAttribute('aria-labelledby','social-dialog-title');
 dialog.innerHTML=`<header class="social-header"><div class="social-header-mon">${icon('chat')}</div><div><div class="social-eyebrow">SENGOKU COMMUNITY</div><h1 id="social-dialog-title">交流の間</h1></div><div class="social-header-status"><span id="social-connection"></span><small id="social-online-count"></small></div><button class="social-icon-button" data-social="close" aria-label="交流を閉じる">${icon('close')}</button></header><nav id="social-tabs" class="social-tabs" role="tablist" aria-label="交流のメニュー"></nav><div id="social-feedback" class="social-feedback" role="status" hidden></div><div id="social-dialog-body" class="social-body"></div><footer class="social-footer"><span>礼をもって語り、志でつながる。</span><span>ゲームは閉じずに続けられます</span></footer><div id="social-confirm-host"></div><input id="social-identity-file" type="file" accept="application/json,.json" hidden>`;
 document.body.append(dialog);body=$('#social-dialog-body');dialog.addEventListener('click',click);dialog.addEventListener('submit',submit);
 dialog.addEventListener('close',()=>{s.open=false;clearTimeout(pollTimer);pollTimer=null;});dialog.addEventListener('cancel',event=>{if(s.confirm){event.preventDefault();clearConfirm();}});
 dialog.addEventListener('keydown',event=>{if(s.confirm&&event.key==='Tab'){const focusable=[...$('#social-confirm-host').querySelectorAll('button:not(:disabled),input,textarea,select')];if(focusable.length){const first=focusable[0],last=focusable[focusable.length-1];if(event.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement))){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement))){event.preventDefault();first.focus();}}return;}if(event.target.id==='social-chat-input'&&event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229){event.preventDefault();event.target.form.requestSubmit();}});
 $('#social-identity-file').addEventListener('change',event=>{const file=event.target.files?.[0];event.target.value='';importIdentity(file);});
 document.addEventListener('click',pageClick);document.addEventListener('visibilitychange',visibility);renderTabs();header();loadConfig();
 if(s.identity){s.meLoading=true;loadMe().catch(e=>{s.error=e.message;s.user=null;}).finally(()=>{s.meLoading=false;if(s.open){render();refresh({view:true});}});}
}
async function dispose(){disposed=true;clearTimeout(configTimer);clearTimeout(pollTimer);for(const c of controllers)c.abort();controllers.clear();document.removeEventListener('click',pageClick);document.removeEventListener('visibilitychange',visibility);dialog?.remove();launcher?.remove();}
global.SengokuSocial={open,close,refresh:()=>refresh({view:true}),dispose};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})(window);

