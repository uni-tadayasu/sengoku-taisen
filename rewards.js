/* Account-owned login gifts and resumable, server-authoritative summons. */
(function(global){
 'use strict';
 const RANKS=['D','C','B','A','S','SS','SSS','U'];
 const WINDOWS=[{id:'morning',label:'朝',hours:'5:00–12:00'},{id:'day',label:'昼',hours:'12:00–18:00'},{id:'night',label:'夜',hours:'18:00–翌5:00'}];
 const ROUTES=['/rewards/login','/gacha/draw','/gacha/reroll','/gacha/choose'];
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));
 const card=value=>value&&typeof value.officerId==='string'&&value.officerId.length<=100&&RANKS.includes(value.rank)?{officerId:value.officerId,rank:value.rank}:null;
 function create(initial={}){
  let options=initial,identityKey='',generation=0,data=null,busy=false,loading=null,lastLoaded=0,pendingOperation=null,error='',unavailable=false,autoRetryAt=0,readSequence=0;
  const listeners=new Set(),now=()=>options.now?.()??Date.now(),storage=()=>options.storage||global.localStorage;
  const context=()=>options.getContext?.()||{},linked=()=>Boolean(context().user&&context().playerId&&!context().banned&&!context().pending);
  const scope=()=>[context().playerId||'',context().epoch??'',context().accountEpoch??'',options.getGame?.()?.state?.walking?.campaignId||''].join(':');
  const storageKey=()=>`sengoku-rewards-pending-v1:${encodeURIComponent([context().playerId||'',options.getGame?.()?.state?.walking?.campaignId||''].join(':'))}`;
  function identity(){const next=scope();if(next===identityKey)return;identityKey=next;generation++;readSequence++;data=null;busy=false;loading=null;lastLoaded=0;pendingOperation=null;error='';unavailable=false;autoRetryAt=0;try{const old=JSON.parse(storage()?.getItem(storageKey())||'null');if(old&&ROUTES.includes(old.route)&&old.payload&&typeof old.payload.requestId==='string')pendingOperation=old;}catch(_){}}
  function state(){identity();return {linked:linked(),loaded:Boolean(data),busy,loading:Boolean(loading),error,unavailable,rewards:clone(data),pendingOperation:clone(pendingOperation)};}
  function emit(){const value=state();for(const fn of listeners)try{fn(value);}catch(_){}}
  function accept(value){const r=value?.rewards||value;if(!r||!r.rerollPass||!r.login)throw Error('招集とログイン報酬の情報を確認できませんでした。');const next=clone(r);if(next.pending){const original=card(next.pending.original),rerolled=next.pending.rerolled?card(next.pending.rerolled):null;if(!original||next.pending.rerolled&&!rerolled||typeof next.pending.id!=='string')throw Error('保留中の招集を確認できませんでした。');next.pending={...next.pending,original,rerolled};}data=next;lastLoaded=now();unavailable=false;return next;}
  async function refresh({force=false}={}){
   identity();if(!linked()||!options.api)return null;if(loading)return loading;if(busy)return data;if(!force&&data&&now()-lastLoaded<60000)return data;
   const expected=identityKey,epoch=generation,serial=++readSequence;
   const request=(async()=>{try{const result=await options.api('/rewards');identity();if(expected!==identityKey||epoch!==generation||serial!==readSequence)return null;if(result?.ok===false)throw Object.assign(Error(result.error?.message||result.message||'報酬情報を読み込めませんでした。'),{code:result.error?.code});accept(result);error='';return data;}catch(e){identity();if(expected===identityKey&&epoch===generation&&serial===readSequence){error=e.message||'接続を確認してください。';unavailable=e.status===404||e.code==='NOT_FOUND';}return null;}finally{if(expected===identityKey&&epoch===generation&&serial===readSequence){loading=null;emit();}}})();
   loading=request;return request;
  }
  function savePending(value){storage()?.setItem(storageKey(),JSON.stringify(value));pendingOperation=value;}
  function clearPending(){storage()?.removeItem(storageKey());pendingOperation=null;}
  async function write(route,payload={},retry=false){
   identity();if(!linked())throw Error('交流で領主を登録・接続すると利用できます。');if(context().writable===false||context().gameWritable===false)throw Error(context().reason||'この端末の進行権を確認してください。');if(busy)throw Error('前の受取・招集を確認しています。');
   if(pendingOperation&&!retry)throw Error('前の操作の結果を確認してから続けてください。');
   if(!ROUTES.includes(route))throw Error('報酬の操作を確認してください。');
   const expected=identityKey,epoch=generation;
   if(!retry){const requestId=global.crypto?.randomUUID?.();if(!requestId)throw Error('安全な受付番号を作成できませんでした。画面を再読み込みしてください。');savePending({route,payload:{...payload,requestId}});}
   readSequence++;loading=null;busy=true;error='';emit();
   try{
    const result=await options.api(pendingOperation.route,{method:'POST',data:clone(pendingOperation.payload)});identity();if(expected!==identityKey||epoch!==generation)throw Object.assign(Error('領主の接続が変わりました。'),{code:'STALE_IDENTITY'});
    if(result?.ok===false)throw Object.assign(Error(result.error?.message||result.message||'操作を確認できませんでした。'),{code:result.error?.code});
    accept(result);clearPending();autoRetryAt=0;return result;
   }catch(e){
    identity();if(expected===identityKey&&epoch===generation){error=e.message||'通信が戻ってから前の操作を確認してください。';if(['INVALID_INPUT','INSUFFICIENT_MAGATAMA','GACHA_SHORTAGE','GACHA_PENDING','GACHA_UNAVAILABLE','GACHA_PENDING_CHANGED','REWARDS_STATE_CHANGED','REROLL_PAYMENT_REVERSED','REROLL_PASS_REQUIRED','REROLL_DAILY_LIMIT','GACHA_ALREADY_REROLLED','GACHA_ALREADY_CHOSEN','GACHA_PENDING_REQUIRED','REWARD_ALREADY_CLAIMED','LOGIN_BONUS_CLAIMED','MAGATAMA_CAP','REQUEST_ID_REUSED','REWARD_WINDOW_CHANGED'].includes(e.code)||e.status===400||e.status===404)clearPending();}
    throw e;
   }finally{if(expected===identityKey&&epoch===generation){busy=false;emit();}}
  }
  async function prime(){
   identity();if(!linked()||context().writable===false||context().gameWritable===false||busy||pendingOperation||now()<autoRetryAt||global.document?.hidden||global.SENGOKU_AT_TITLE===true)return false;
   const expected=identityKey,r=await refresh();if(expected!==identityKey||!r||r.login?.claimed!==false||busy||pendingOperation)return false;
   try{const result=await write('/rewards/login');const receipt=result.receipt||{},amount=Number(receipt.amount??receipt.granted??receipt.reward?.magatama??0);if(!result.idempotent&&amount>0){options.notify?.(`${r.login.label||(r.login.window==='noon'?'昼':WINDOWS.find(w=>w.id===r.login.window)?.label)||'今回'}のログインボーナス：勾玉${amount}を受け取りました。`);options.onReward?.(result);}return true;}catch(e){if(expected===identityKey){autoRetryAt=now()+(e.code==='MAGATAMA_CAP'?300000:60000);await refresh({force:true});}return false;}
  }
  const api={configure:value=>{options={...options,...value};identity();return api;},getState:state,refresh,prime,draw:count=>{if(![1,10].includes(count))return Promise.reject(Error('招集回数を確認してください。'));return write('/gacha/draw',{count});},reroll:drawId=>write('/gacha/reroll',{drawId}),choose:(drawId,choice)=>write('/gacha/choose',{drawId,choice}),claimLogin:()=>write('/rewards/login'),retry:()=>{identity();return pendingOperation?write(pendingOperation.route,pendingOperation.payload,true):Promise.reject(Error('確認中の操作はありません。'));},subscribe:fn=>{listeners.add(fn);fn(state());return()=>listeners.delete(fn);},accept:value=>{identity();accept(value);emit();}};
  return api;
 }
 function date(value){const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(d):'確認中';}
 function loginMarkup(value){
  const s=value||api.getState(),login=s.rewards?.login;
  if(!s.linked)return '<section class="login-bonus-panel"><div><span class="eyebrow">朝・昼・夜の贈り物</span><h3>各時間帯に勾玉30</h3><p>領主を登録・接続すると、1日最大90勾玉を受け取れます。</p></div><button class="button" data-action="login-bonus">登録・接続を確認</button></section>';
  const rows=WINDOWS.map(w=>{const record=Array.isArray(login?.windows)?login.windows.find(x=>[w.id,w.id==='day'?'noon':w.id].includes(x.id||x.key||x.window)):login?.windows?.[w.id];const active=(login?.window===w.id||w.id==='day'&&login?.window==='noon'),claimed=record?.claimed===true||active&&login?.claimed===true,amount=claimed?Math.max(0,Math.min(30,Number(record?.creditedAmount??record?.amount??30))):30;return `<div class="login-bonus-slot ${active?'is-current':''} ${claimed?'is-claimed':''}"><span>${w.label}<small>${w.hours}</small></span><b>+${amount}<small>勾玉</small></b><em>${claimed?'受取済み':active?'今回の時間帯':'この時間帯にアクセス'}</em></div>`;}).join('');
  return `<section class="login-bonus-panel" aria-label="朝昼夜のログインボーナス"><div class="login-bonus-heading"><div><span class="eyebrow">朝・昼・夜の贈り物</span><h3>ログインボーナス</h3></div><strong>1日最大90勾玉</strong></div><div class="login-bonus-grid">${rows}</div><p>日本時間・朝5時に更新。各時間帯の最初のアクセスで受け取れます。未受取分の持ち越しはありません。</p>${s.pendingOperation?'<button class="button gold" data-action="rewards-retry">前の操作の結果を確認</button>':login?.claimed===false?`<button class="button gold" data-action="login-bonus" ${s.busy?'disabled':''}>今回の30勾玉を受け取る</button>`:!login?`<button class="button" data-action="login-bonus" ${s.busy?'disabled':''}>${s.loading?'確認中…':'受取状況を確認'}</button>`:''}${s.error?`<p class="rewards-error" role="status">${esc(s.error)}</p>`:''}</section>`;
 }
 function passMarkup(value){
  const s=value||api.getState(),pass=s.rewards?.rerollPass,pending=s.rewards?.pending;
  return `<section class="gacha-pass-summary"><div><strong>${pass?.active?'30日再抽選パス':'単発招集の引き直し'}</strong><p>${pass?.active?`本日あと <b>${Number(pass.remainingToday)||0} / 3回</b> · 有効期限 ${date(pass.expiresAt)}（日本時間）`:'税込480円／30日間・自動更新なし。1日3枚まで、元の結果と引き直した結果から1枚を選べます。'}</p><small>1枚につき1回。日本時間の朝5時更新・持ち越しなし。10連は対象外。高ランクの確約はありません。</small></div><button class="button" data-action="premium">${pass?.active?'パスを確認':'内容を見る'}</button>${pending?'<div class="gacha-pending-notice"><span>まだ確定していない招集があります。消費済みの勾玉で結果を再開できます。</span><button class="button gold" data-action="gacha-resume">結果を選ぶ</button></div>':''}${s.pendingOperation?'<div class="gacha-pending-notice"><span>前の操作の結果を確認しています。</span><button class="button gold" data-action="rewards-retry">結果を確認</button></div>':''}</section>`;
 }
 const api=create();api.create=create;api.loginMarkup=loginMarkup;api.passMarkup=passMarkup;api.windows=WINDOWS;api.date=date;
 global.SengokuRewards=api;
 if(typeof module!=='undefined'&&module.exports)module.exports={create,loginMarkup,passMarkup};
})(typeof window!=='undefined'?window:globalThis);
