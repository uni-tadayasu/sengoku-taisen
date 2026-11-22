/* Opening a shogunate records an earned right after explicit confirmation. */
(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric'}).format(new Date(v));
 const integer=(v,min=0,max=999999999)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 const text=(v,max=300)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const time=v=>Number.isSafeInteger(v)&&v>=0&&Number.isFinite(new Date(v).getTime());
 const rightId=v=>typeof v==='string'&&/^sg_[a-f0-9]{32}$/.test(v);
 const requestId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(v);
 let dialog=null,data=null,busy=false,error='',message='',confirmation=null,pending=null,stamp='',ownerId='',epoch=0,focus=null;
 const context=()=>global.SengokuSocial?.getExpansionContext?.()||{};
 const pendingKey=id=>'sengoku-shogunate-pending-v1:'+encodeURIComponent(id);
 const request=(route,options)=>global.SengokuSocial.expansionRequest(route,options);
 function access(){
  const c=context(),id=String(c.playerId||c.user?.id||''),allowed=!!(id&&c.user&&String(c.user.id)===id&&!c.pending&&!c.banned&&!c.user.isBanned);
  return{id,allowed,stamp:JSON.stringify([id,c.epoch??null,c.privilegeEpoch??null,c.accountEpoch??null,allowed,!!c.pending,!!c.banned,!!c.user?.isAdmin,!!c.user?.isStaff])};
 }
 function cleanPending(value){return value&&rightId(value.rightId)&&requestId(value.requestId)?{rightId:value.rightId,requestId:value.requestId}:null;}
 function readPending(id){try{return cleanPending(JSON.parse(global.localStorage?.getItem(pendingKey(id))||'null'));}catch(_){return null;}}
 function clearPending(id,record){try{const stored=readPending(id);if(stored?.rightId===record.rightId&&stored.requestId===record.requestId)global.localStorage?.removeItem(pendingKey(id));}catch(_){} }
 function identity(){
  const who=access();if(stamp===who.stamp)return who;
  stamp=who.stamp;ownerId=who.id;epoch++;data=null;busy=false;error='';message='';confirmation=null;pending=who.allowed?readPending(who.id):null;
  if(dialog)close();return who;
 }
 function current(who,turn){const latest=identity();return latest.allowed&&latest.stamp===who.stamp&&turn===epoch;}
 function cleanRight(value){
  if(!value||!rightId(value.id)||!['campaign','event','conquest'].includes(value.sourceType)||!text(value.sourceId,240)||!text(value.title)||!time(value.earnedAt)||value.battleId!=null&&!text(value.battleId,120)||value.openedAt!=null&&(!time(value.openedAt)||!text(value.governmentName,160)||value.rank!=='征夷大将軍'))return null;
  return{id:value.id,sourceType:value.sourceType,sourceId:value.sourceId,title:value.title,battleId:value.battleId||null,earnedAt:value.earnedAt,openedAt:value.openedAt??null,governmentName:value.openedAt==null?null:value.governmentName,rank:value.openedAt==null?null:value.rank};
 }
 function cleanData(value){
  if(!value||!Array.isArray(value.rights)||value.rights.length>100)return null;
  const rights=value.rights.map(cleanRight);if(rights.some(r=>!r)||new Set(rights.map(r=>r.id)).size!==rights.length)return null;
  let opened=null,campaign=null;
  if(value.current!=null){opened=cleanRight(value.current);if(!opened||opened.openedAt==null||!rights.some(r=>JSON.stringify(r)===JSON.stringify(opened)))return null;}
  if(value.campaign!=null){const c=value.campaign;if(!integer(c.owned)||!integer(c.target,1)||c.owned>c.target||typeof c.achieved!=='boolean'||!integer(c.cycle))return null;campaign={owned:c.owned,target:c.target,achieved:c.achieved,cycle:c.cycle};}
  return{rights,current:opened,campaign};
 }
 function cleanReceipt(value,record,view){
  if(!value||value.rightId!==record.rightId||!text(value.governmentName,160)||value.rank!=='征夷大将軍'||!time(value.openedAt)||!text(value.title))return null;
  const right=view.rights.find(r=>r.id===record.rightId);
  return right&&right.openedAt===value.openedAt&&right.governmentName===value.governmentName&&right.title===value.title?{rightId:value.rightId,governmentName:value.governmentName,rank:value.rank,openedAt:value.openedAt,title:value.title}:null;
 }
 function refreshAccess(){identity();}
 function render(){if(!dialog)return;const body=dialog.querySelector('.shogunate-content'),rights=data?.rights||[];
  body.innerHTML=`<p class="shogunate-status ${error?'is-error':''}" role="${error?'alert':'status'}">${esc(error||message||'')}</p>${pending?'<p class="notice">幕府開設の結果を確認しています。同じ操作番号で確認するため、二重に開設されることはありません。</p><button class="button" data-shogunate="retry" '+(busy?'disabled':'')+'>結果を確認する</button>':''}
  ${data?.current?`<section class="shogunate-current"><small>開設した幕府</small><h3>${esc(data.current.governmentName)}</h3><p>征夷大将軍 · ${esc(date(data.current.openedAt))} 開設</p><p>${esc(data.current.title)}</p></section>`:''}
  <p>天下統一の功績を受け取り、自らの幕府を開きます。幕府名と「征夷大将軍」の称号が、領主の記録に残ります。</p>
  ${data?.campaign?`<p class="notice">天下地図の統一対象：${data.campaign.owned} / ${data.campaign.target} 城</p>`:''}
  <h3>幕府開設権</h3>${rights.length?rights.map(r=>`<article class="shogunate-right"><div><h4>${esc(r.title)}</h4><p>${esc(({campaign:'天下地図',event:'期間限定合戦',conquest:'共有天下統一大会'})[r.sourceType])} · ${esc(date(r.earnedAt))} 達成</p>${r.openedAt!=null?`<p>${esc(r.governmentName)} · 開設済み</p>`:''}</div>${r.openedAt!=null?'':`<button class="button gold" data-shogunate="prepare" data-right="${esc(r.id)}" ${busy||pending?'disabled':''}>幕府を開く</button>`}</article>`).join(''):`<div class="notice">${busy?'統一の記録を確認しています。':'幕府開設権はまだありません。天下地図の全対象城を制覇するか、天下統一が結末となるイベントの達成条件を満たしてください。共有天下統一大会では、全城制覇時に同じ同盟で参戦・支援した領主が獲得します。'}</div>`}
  ${confirmation?`<section class="shogunate-confirm"><h3 tabindex="-1" data-shogunate-confirm-title>幕府を開設しますか？</h3><p>「${esc(confirmation.title)}」で獲得した権利を使い、幕府を開設した功績を記録します。</p><div class="shogunate-actions"><button class="button" data-shogunate="cancel" ${busy?'disabled':''}>戻る</button><button class="button gold" data-shogunate="confirm" ${busy?'disabled':''}>幕府を開設する</button></div></section>`:''}`;
  dialog.querySelector('[data-shogunate="reload"]').disabled=busy;
 }
 async function load(){
  const who=identity();if(!who.allowed||busy)return false;const turn=epoch;busy=true;error='';render();
  try{
   await global.SengokuCloudSync?.flush?.();if(!current(who,turn))return false;
   const result=await request('/shogunate',{method:'GET'});if(!current(who,turn))return false;
   const view=result?.ok===true?cleanData(result.shogunate):null;if(!view)throw Error('幕府の記録を確認できませんでした。記録を更新してください。');
   data=view;if(confirmation&&!view.rights.some(r=>r.id===confirmation.id&&r.openedAt==null))confirmation=null;return true;
  }catch(e){if(current(who,turn))error=e.message||'幕府の記録を取得できませんでした。';return false;}
  finally{if(current(who,turn)){busy=false;render();}}
 }
 function prepare(id){
  const who=identity();if(!who.allowed||busy||pending)return false;
  confirmation=data?.rights.find(r=>r.id===id&&r.openedAt==null)||null;error='';render();
  dialog?.querySelector('[data-shogunate-confirm-title]')?.focus?.({preventScroll:true});return!!confirmation;
 }
 async function establish(){
  const who=identity();if(busy||!who.allowed||!pending&&!confirmation)return false;const turn=epoch;error='';message='';
  if(!pending){
   if(!data?.rights.some(r=>r.id===confirmation.id&&r.openedAt==null))return false;
   try{
    const record=cleanPending({rightId:confirmation.id,requestId:global.crypto.randomUUID()});if(!record)throw Error('操作番号を作成できません。画面を開き直してください。');
    const saved=JSON.stringify(record);global.localStorage.setItem(pendingKey(who.id),saved);if(global.localStorage.getItem(pendingKey(who.id))!==saved)throw Error('操作記録を保存できません。端末の保存設定を確認してください。');pending=record;
   }catch(e){error=e.message||'操作記録を保存できません。端末の保存設定を確認してください。';render();return false;}
  }
  const record={...pending};confirmation=null;busy=true;render();
  try{
   if(!current(who,turn))return false;
   const result=await request('/shogunate/open',{method:'POST',data:{...record}});if(!current(who,turn))return false;
   const view=result?.ok===true?cleanData(result.shogunate):null,receipt=view?cleanReceipt(result.receipt,record,view):null;
   if(!view||!receipt)throw Error('幕府開設の結果を確認できませんでした。同じ操作の結果を確認してください。');
   data=view;message=result.idempotent?'開設済みの'+receipt.governmentName+'の記録を確認しました。':receipt.governmentName+'を開設しました。';pending=null;clearPending(who.id,record);return true;
  }catch(e){
   if(!current(who,turn))return false;error=e.message||'接続を確認し、同じ操作で結果を確認してください。';
   if(['SHOGUNATE_RIGHT_REQUIRED','SHOGUNATE_ALREADY_OPENED','REQUEST_ID_REUSED','INVALID_INPUT'].includes(e.code)){pending=null;clearPending(who.id,record);}return false;
  }finally{if(current(who,turn)){busy=false;render();}}
 }
 function close(){if(!dialog)return;const previous=dialog,target=focus;dialog=null;focus=null;previous.close?.();previous.remove();if(target?.isConnected)target.focus?.({preventScroll:true});}
 function open(){
  const who=identity();if(!who.allowed){global.SengokuBridge?.toast?.('交流で領主登録・接続を確認すると、幕府の功績を記録できます。',true);return Promise.resolve(false);}
  if(dialog){render();return Promise.resolve(true);}focus=global.document.activeElement;dialog=global.document.createElement('dialog');dialog.className='shogunate-dialog';dialog.setAttribute('aria-labelledby','shogunate-title');dialog.innerHTML='<header class="shogunate-header"><div><small>天下統一の功績</small><h2 id="shogunate-title">幕府の記録</h2></div><button class="button small" data-shogunate="close" aria-label="幕府の記録を閉じる">×</button></header><div class="shogunate-content"></div><footer class="shogunate-actions"><button class="button" data-shogunate="reload">記録を更新</button><button class="button primary" data-shogunate="close">閉じる</button></footer>';
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('click',e=>{
   const b=e.target?.closest?.('[data-shogunate]');if(!b||b.disabled||!dialog?.contains(b))return;e.preventDefault();
   switch(b.getAttribute('data-shogunate')){case'close':close();break;case'reload':load();break;case'prepare':prepare(b.getAttribute('data-right'));break;case'cancel':if(!busy&&!pending){confirmation=null;render();}break;case'confirm':case'retry':establish();break;}
  });
  global.document.body.appendChild(dialog);render();dialog.showModal();return load();
 }
 global.SengokuShogunate={open,close,refreshAccess,getState:()=>{identity();return{busy,hasPending:!!pending,loaded:!!data,owner:ownerId,hasConfirmation:!!confirmation,error,message};}};
})(typeof window!=='undefined'?window:globalThis);
