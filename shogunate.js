/* Server-owned shogunate applications, imperial approval and palace sovereignty. */
(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const date=v=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'long',day:'numeric'}).format(new Date(v));
 const deadline=v=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(v))+'（日本時間）';
 const integer=(v,min=0,max=999999999)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 const text=(v,max=300)=>typeof v==='string'&&v.length>0&&v.length<=max;
 const time=v=>Number.isSafeInteger(v)&&v>=0&&Number.isFinite(new Date(v).getTime());
 const rightId=v=>typeof v==='string'&&/^sg_[a-f0-9]{32}$/.test(v);
 const playerId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,150}$/.test(v);
 const requestId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(v);
 const WINDOW_MS=72*60*60*1000;
 const statuses=['available','pending','approved','expired','legacy'];
 const monotonic=()=>global.performance?.now?.()??Date.now();
 let dialog=null,data=null,busy=false,error='',message='',confirmation=null,pending=null,stamp='',ownerId='',epoch=0,focus=null,timer=null,receivedAt=0,lastPoll=0;
 const context=()=>global.SengokuSocial?.getExpansionContext?.()||{};
 const pendingKey=id=>'sengoku-shogunate-pending-v1:'+encodeURIComponent(id);
 const request=(route,options)=>global.SengokuSocial.expansionRequest(route,options);
 function access(){
  const c=context(),id=String(c.playerId||c.user?.id||''),allowed=!!(id&&c.user&&String(c.user.id)===id&&!c.pending&&!c.banned&&!c.user.isBanned);
  return{id,allowed,stamp:JSON.stringify([id,c.epoch??null,c.privilegeEpoch??null,c.accountEpoch??null,allowed,!!c.pending,!!c.banned,!!c.user?.isAdmin,!!c.user?.isStaff])};
 }
 function cleanPending(value){return value&&rightId(value.rightId)&&requestId(value.requestId)&&(value.action==null||value.action==='approve')?{rightId:value.rightId,requestId:value.requestId,...(value.action==='approve'?{action:'approve'}:{})}:null;}
 function readPending(id){try{return cleanPending(JSON.parse(global.localStorage?.getItem(pendingKey(id))||'null'));}catch(_){return null;}}
 function clearPending(id,record){try{const stored=readPending(id);if(stored?.rightId===record.rightId&&stored.requestId===record.requestId&&stored.action===record.action)global.localStorage?.removeItem(pendingKey(id));}catch(_){} }
 function identity(){
  const who=access();if(stamp===who.stamp)return who;
  stamp=who.stamp;ownerId=who.id;epoch++;data=null;busy=false;error='';message='';confirmation=null;pending=who.allowed?readPending(who.id):null;
  if(dialog)close();return who;
 }
 function current(who,turn){const latest=identity();return latest.allowed&&latest.stamp===who.stamp&&turn===epoch;}
 function cleanRight(value){
  if(!value||!rightId(value.id)||!['campaign','event','conquest'].includes(value.sourceType)||!text(value.sourceId,240)||!text(value.title)||!time(value.earnedAt)||value.battleId!=null&&!text(value.battleId,120)||value.openedAt!=null&&(!time(value.openedAt)||!text(value.governmentName,160)||value.rank!=='征夷大将軍'))return null;
  const status=value.approvalStatus??(value.openedAt==null?'available':'legacy'),opened=value.openedAt!=null;
  if(!statuses.includes(status)||(['approved','expired','legacy'].includes(status)!==opened))return null;
  const submitted=['pending','approved','expired'].includes(status);
  if(submitted&&(!time(value.requestedAt)||!time(value.deadlineAt)||value.deadlineAt!==value.requestedAt+WINDOW_MS||!text(value.governmentName,160)))return null;
  if(['approved','expired'].includes(status)&&(!time(value.resolvedAt)||value.resolvedAt<value.requestedAt))return null;
  if(status==='pending'&&(value.rank!=null||value.resolvedAt!=null))return null;
  return{id:value.id,sourceType:value.sourceType,sourceId:value.sourceId,title:value.title,battleId:value.battleId||null,earnedAt:value.earnedAt,openedAt:value.openedAt??null,governmentName:opened||submitted?value.governmentName:null,rank:opened?'征夷大将軍':null,approvalStatus:status,requestedAt:submitted?value.requestedAt:null,deadlineAt:submitted?value.deadlineAt:null,resolvedAt:submitted?value.resolvedAt??null:null};
 }
 function cleanControl(value){
  if(!value||value.castleId!=='kyoto_gosho'||!rightId(value.rightId)||!playerId(value.controller?.id)||!text(value.controller?.name,80)||!text(value.governmentName,160)||!time(value.controlledAt))return null;
  return{castleId:'kyoto_gosho',rightId:value.rightId,controller:{id:value.controller.id,name:value.controller.name},governmentName:value.governmentName,controlledAt:value.controlledAt};
 }
 function cleanData(value){
  if(!value||!Array.isArray(value.rights)||value.rights.length>100)return null;
  const rights=value.rights.map(cleanRight);if(rights.some(r=>!r)||new Set(rights.map(r=>r.id)).size!==rights.length)return null;
  let opened=null,campaign=null;
  if(value.current!=null){opened=cleanRight(value.current);if(!opened||opened.openedAt==null||!rights.some(r=>JSON.stringify(r)===JSON.stringify(opened)))return null;}
  if(value.campaign!=null){const c=value.campaign;if(!integer(c.owned)||!integer(c.target,1)||c.owned>c.target||typeof c.achieved!=='boolean'||!integer(c.cycle))return null;campaign={owned:c.owned,target:c.target,achieved:c.achieved,cycle:c.cycle};}
  const modern=value.serverNow!=null||value.canApprove!=null||rights.some(r=>['pending','approved','expired'].includes(r.approvalStatus));
  if(modern&&(!time(value.serverNow)||value.approvalWindowMs!==WINDOW_MS||typeof value.canApprove!=='boolean'||!Array.isArray(value.approvals)||value.approvals.length>100))return null;
  const approvals=(value.approvals||[]).map(row=>{const right=cleanRight(row);return right?.approvalStatus==='pending'&&playerId(row.applicant?.id)&&text(row.applicant?.name,80)?{...right,applicant:{id:row.applicant.id,name:row.applicant.name}}:null;});
  if(approvals.some(r=>!r)||new Set(approvals.map(r=>r.id)).size!==approvals.length||approvals.length&&value.canApprove!==true)return null;
  const palaceControl=value.palaceControl==null?null:cleanControl(value.palaceControl);if(value.palaceControl!=null&&!palaceControl)return null;
  return{rights,current:opened,campaign,serverNow:modern?value.serverNow:null,approvalWindowMs:WINDOW_MS,canApprove:value.canApprove===true,approvals,approvalsHasMore:value.approvalsHasMore===true,pendingHasMore:value.pendingHasMore===true,palaceControl};
 }
 function cleanReceipt(value,record,view){
  if(!value||value.rightId!==record.rightId||!text(value.governmentName,160)||!text(value.title))return null;
  const right=view.rights.find(r=>r.id===record.rightId);if(!right)return null;
  if(value.status==='pending')return time(value.requestedAt)&&time(value.deadlineAt)&&value.deadlineAt===value.requestedAt+WINDOW_MS&&value.openedAt==null&&value.rank==null&&right.requestedAt===value.requestedAt&&right.deadlineAt===value.deadlineAt&&right.governmentName===value.governmentName&&right.title===value.title?{status:'pending',rightId:value.rightId,governmentName:value.governmentName,title:value.title,requestedAt:value.requestedAt,deadlineAt:value.deadlineAt}:null;
  return value.rank==='征夷大将軍'&&time(value.openedAt)&&right.openedAt===value.openedAt&&right.governmentName===value.governmentName&&right.title===value.title?{rightId:value.rightId,governmentName:value.governmentName,rank:value.rank,openedAt:value.openedAt,title:value.title}:null;
 }
 function adopt(view){data=view;receivedAt=monotonic();lastPoll=receivedAt;}
 function serverTime(){return data?.serverNow==null?null:data.serverNow+Math.max(0,monotonic()-receivedAt);}
 function remaining(until){const now=serverTime();if(now==null)return'残り時間を確認中';const seconds=Math.max(0,Math.ceil((until-now)/1000));return seconds?'残り '+Math.floor(seconds/86400)+'日 '+Math.floor(seconds/3600)%24+'時間 '+Math.floor(seconds/60)%60+'分':'承認期限を過ぎました。確定結果を確認してください。';}
 function waitNotice(r){return`<p class="shogunate-deadline">承認期限：<time datetime="${new Date(r.deadlineAt).toISOString()}">${esc(deadline(r.deadlineAt))}</time><span data-shogunate-deadline="${r.deadlineAt}">${esc(remaining(r.deadlineAt))}</span></p>`;}
 function statusLabel(r){return({available:'未申請',pending:'天皇・摂政の承認待ち',approved:'天皇承認済み（摂政代行を含む）',expired:'承認期限切れで開設',legacy:'開設済み'})[r.approvalStatus];}
 function refreshAccess(){identity();}
 function render(){if(!dialog)return;const body=dialog.querySelector('.shogunate-content'),rights=data?.rights||[],locked=busy||!!pending;
  body.innerHTML=`<p class="shogunate-status ${error?'is-error':''}" role="${error?'alert':'status'}">${esc(error||message||'')}</p>${pending?`<p class="notice">${pending.action==='approve'?'幕府承認':'幕府開設申請'}の結果を確認しています。同じ操作番号で確認するため、二重に処理されることはありません。</p><button class="button" data-shogunate="retry" ${busy?'disabled':''}>結果を確認する</button>`:''}
  ${data?.palaceControl?`<section class="shogunate-palace"><small>京都御所の支配</small><h3>${esc(data.palaceControl.governmentName)}の支配下</h3><p>支配領主：${esc(data.palaceControl.controller.name)} · ${esc(deadline(data.palaceControl.controlledAt))}から</p><p>開設申請が3日以内に承認されなかったため、京都御所はこの幕府の支配下に入りました。</p></section>`:''}
  ${data?.current?`<section class="shogunate-current"><small>${esc(statusLabel(data.current))}</small><h3>${esc(data.current.governmentName)}</h3><p>征夷大将軍 · ${esc(date(data.current.openedAt))} 開設</p><p>${esc(data.current.title)}</p></section>`:''}
  <p>幕府開設権を使い、天皇へ開設を申請します。天皇または摂政が承認すると幕府が開かれ、「征夷大将軍」の称号が記録されます。</p><p class="notice shogunate-rule">承認期限は申請から現実時間で3日間（72時間）です。期限までに承認されなければ幕府が開かれ、京都御所も申請した領主の支配下に入ります。ログアウト中も期限は進みます。</p>
  ${data?.canApprove?`<section class="shogunate-approvals" aria-labelledby="shogunate-approvals-title"><h3 id="shogunate-approvals-title">天皇・摂政への幕府開設申請</h3><p>天皇または摂政として、各申請の期限内に承認してください。</p>${data.approvals.length?data.approvals.map(r=>`<article class="shogunate-right shogunate-approval"><div><h4>${esc(r.governmentName)}</h4><p>申請者：${esc(r.applicant.name)} · ${esc(r.title)}</p>${waitNotice(r)}</div><button class="button gold" data-shogunate="prepare-approval" data-right="${esc(r.id)}" data-shogunate-approval-deadline="${r.deadlineAt}" ${locked||r.deadlineAt<=serverTime()?'disabled':''}>承認内容を確認</button></article>`).join(''):'<p class="court-empty">承認待ちの申請はありません。</p>'}${data.approvalsHasMore?'<p>期限の近い100件を表示しています。承認後に記録を更新すると続きが表示されます。</p>':''}</section>`:''}
  ${data?.campaign?`<p class="notice">天下地図の統一対象：${data.campaign.owned} / ${data.campaign.target} 城</p>`:''}
  <h3>幕府開設権</h3>${data?.pendingHasMore?'<p>承認待ちの申請は期限の近いものから表示しています。承認後に記録を更新すると続きが表示されます。</p>':''}${rights.length?rights.map(r=>`<article class="shogunate-right"><div><h4>${esc(r.title)}</h4><p>${esc(({campaign:'天下地図',event:'期間限定合戦',conquest:'共有天下統一大会'})[r.sourceType])} · ${esc(date(r.earnedAt))} 達成</p><p class="shogunate-right-status">${esc(r.governmentName?r.governmentName+' · ':'')}${esc(statusLabel(r))}</p>${r.approvalStatus==='pending'?waitNotice(r):''}</div>${r.approvalStatus==='available'?`<button class="button gold" data-shogunate="prepare" data-right="${esc(r.id)}" ${locked?'disabled':''}>開設を申請</button>`:''}</article>`).join(''):`<div class="notice">${busy?'統一の記録を確認しています。':'幕府開設権はまだありません。天下地図の全対象城を制覇するか、天下統一が結末となるイベントの達成条件を満たしてください。共有天下統一大会では、全城制覇時に同じ同盟で参戦・支援した領主が獲得します。'}</div>`}
  ${confirmation?`<section class="shogunate-confirm"><h3 tabindex="-1" data-shogunate-confirm-title>${confirmation.kind==='approve'?'幕府開設を承認しますか？':'幕府開設を申請しますか？'}</h3><p>${confirmation.kind==='approve'?`${esc(confirmation.applicant.name)}の「${esc(confirmation.governmentName)}」の開設を承認します。`:`「${esc(confirmation.title)}」で獲得した権利を使い、天皇へ幕府開設を申請します。`}</p>${confirmation.kind==='approve'?waitNotice(confirmation):'<p>申請後3日以内に天皇または摂政が承認します。承認されないまま期限を迎えると、京都御所もあなたの支配下に入ります。</p>'}<div class="shogunate-actions"><button class="button" data-shogunate="cancel" ${busy?'disabled':''}>戻る</button><button class="button gold" data-shogunate="confirm" ${confirmation.kind==='approve'?`data-shogunate-approval-deadline="${confirmation.deadlineAt}"`:''} ${busy||confirmation.kind==='approve'&&confirmation.deadlineAt<=serverTime()?'disabled':''}>${confirmation.kind==='approve'?'開設を承認する':'天皇へ申請する'}</button></div></section>`:''}`;
  dialog.querySelector('[data-shogunate="reload"]').disabled=busy;
 }
 async function load(){
  const who=identity();if(!who.allowed||busy)return false;const turn=epoch;busy=true;error='';render();
  try{
   await global.SengokuCloudSync?.flush?.();if(!current(who,turn))return false;
   const result=await request('/shogunate',{method:'GET'});if(!current(who,turn))return false;
   const view=result?.ok===true?cleanData(result.shogunate):null;if(!view)throw Error('幕府の記録を確認できませんでした。記録を更新してください。');
   adopt(view);if(confirmation&&!(confirmation.kind==='approve'?view.canApprove&&view.approvals.some(r=>r.id===confirmation.id):view.rights.some(r=>r.id===confirmation.id&&r.approvalStatus==='available')))confirmation=null;return true;
  }catch(e){if(current(who,turn))error=e.message||'幕府の記録を取得できませんでした。';return false;}
  finally{if(current(who,turn)){busy=false;render();}}
 }
 function prepare(id,kind='open'){
  const who=identity();if(!who.allowed||busy||pending)return false;
  const right=kind==='approve'?(data?.canApprove?data.approvals.find(r=>r.id===id&&r.deadlineAt>serverTime()):null):data?.rights.find(r=>r.id===id&&r.approvalStatus==='available');
  confirmation=right?{...right,kind}:null;error='';render();
  dialog?.querySelector('[data-shogunate-confirm-title]')?.focus?.({preventScroll:true});return!!confirmation;
 }
 async function establish(){
  const who=identity();if(busy||!who.allowed||!pending&&!confirmation)return false;const turn=epoch;error='';message='';
  if(!pending){
   const approving=confirmation.kind==='approve';
   if(approving?(!data?.canApprove||!data.approvals.some(r=>r.id===confirmation.id&&r.deadlineAt>serverTime())):!data?.rights.some(r=>r.id===confirmation.id&&r.approvalStatus==='available'))return false;
   try{
    const record=cleanPending({rightId:confirmation.id,requestId:global.crypto.randomUUID(),...(approving?{action:'approve'}:{})});if(!record)throw Error('操作番号を作成できません。画面を開き直してください。');
    const saved=JSON.stringify(record);global.localStorage.setItem(pendingKey(who.id),saved);if(global.localStorage.getItem(pendingKey(who.id))!==saved)throw Error('操作記録を保存できません。端末の保存設定を確認してください。');pending=record;
   }catch(e){error=e.message||'操作記録を保存できません。端末の保存設定を確認してください。';render();return false;}
  }
  const record={...pending},approving=record.action==='approve';confirmation=null;busy=true;render();
  try{
   if(!current(who,turn))return false;
   const result=await request(approving?'/shogunate/approve':'/shogunate/open',{method:'POST',data:{rightId:record.rightId,requestId:record.requestId}});if(!current(who,turn))return false;
   const view=result?.ok===true?cleanData(result.shogunate):null,receipt=approving?result?.approvalReceipt:view?cleanReceipt(result.receipt,record,view):null;
   if(!view||!receipt||approving&&(receipt.rightId!==record.rightId||receipt.status!=='approved'||!time(receipt.approvedAt)))throw Error('幕府の操作結果を確認できませんでした。同じ操作の結果を確認してください。');
   adopt(view);
   if(approving)message=result.idempotent?'幕府開設を承認した記録を確認しました。':'幕府開設を承認しました。';
   else if(receipt.status==='pending'){const right=view.rights.find(r=>r.id===record.rightId);message=right.approvalStatus==='pending'?(result.idempotent?'開設申請の記録を確認しました。':'天皇へ'+receipt.governmentName+'の開設を申請しました。')+' 承認期限：'+deadline(receipt.deadlineAt):receipt.governmentName+'の申請記録を確認しました。現在：'+statusLabel(right)+'。';}
   else message=result.idempotent?'開設済みの'+receipt.governmentName+'の記録を確認しました。':receipt.governmentName+'を開設しました。';
   pending=null;clearPending(who.id,record);return true;
  }catch(e){
   if(!current(who,turn))return false;error=e.message||'接続を確認し、同じ操作で結果を確認してください。';
   if(['SHOGUNATE_RIGHT_REQUIRED','SHOGUNATE_ALREADY_OPENED','SHOGUNATE_ALREADY_REQUESTED','SHOGUNATE_APPROVAL_PENDING','SHOGUNATE_NOT_PENDING','SHOGUNATE_APPROVAL_EXPIRED','SHOGUNATE_APPROVAL_CHANGED','COURT_EMPEROR_REQUIRED','COURT_ACCESS_CHANGED','REQUEST_ID_REUSED','INVALID_INPUT'].includes(e.code)||approving&&e.status===403){pending=null;clearPending(who.id,record);if(approving){data=null;confirmation=null;}}return false;
  }finally{if(current(who,turn)){busy=false;render();}}
 }
 function tick(){
  identity();if(!dialog||!data)return;
  for(const node of dialog.querySelectorAll('[data-shogunate-deadline]'))node.textContent=remaining(Number(node.getAttribute('data-shogunate-deadline')));
  for(const node of dialog.querySelectorAll('[data-shogunate-approval-deadline]'))if(Number(node.getAttribute('data-shogunate-approval-deadline'))<=serverTime())node.disabled=true;
  if(!busy&&!pending&&!confirmation&&(data.canApprove||data.rights.some(r=>r.approvalStatus==='pending'))&&monotonic()-lastPoll>=30000){lastPoll=monotonic();void load();}
 }
 function close(){if(timer!=null){global.clearInterval?.(timer);timer=null;}if(!dialog)return;const previous=dialog,target=focus;dialog=null;focus=null;previous.close?.();previous.remove();if(target?.isConnected)target.focus?.({preventScroll:true});}
 function open(){
  const who=identity();if(!who.allowed){global.SengokuBridge?.toast?.('交流で領主登録・接続を確認すると、幕府の功績を記録できます。',true);return Promise.resolve(false);}
  if(dialog){render();return Promise.resolve(true);}focus=global.document.activeElement;dialog=global.document.createElement('dialog');dialog.className='shogunate-dialog';dialog.setAttribute('aria-labelledby','shogunate-title');dialog.innerHTML='<header class="shogunate-header"><div><small>天下統一の功績と朝廷の承認</small><h2 id="shogunate-title">幕府の記録</h2></div><button class="button small" data-shogunate="close" aria-label="幕府の記録を閉じる">×</button></header><div class="shogunate-content"></div><footer class="shogunate-actions"><button class="button" data-shogunate="reload">記録を更新</button><button class="button primary" data-shogunate="close">閉じる</button></footer>';
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.addEventListener('click',e=>{
   const b=e.target?.closest?.('[data-shogunate]');if(!b||b.disabled||!dialog?.contains(b))return;e.preventDefault();
   switch(b.getAttribute('data-shogunate')){case'close':close();break;case'reload':load();break;case'prepare':prepare(b.getAttribute('data-right'));break;case'prepare-approval':prepare(b.getAttribute('data-right'),'approve');break;case'cancel':if(!busy&&!pending){confirmation=null;render();}break;case'confirm':case'retry':establish();break;}
  });
  global.document.body.appendChild(dialog);render();dialog.showModal();timer=global.setInterval?.(tick,1000)??null;return load();
 }
 global.SengokuShogunate={open,close,refreshAccess,getState:()=>{identity();return{busy,hasPending:!!pending,loaded:!!data,owner:ownerId,hasConfirmation:!!confirmation,error,message};}};
})(typeof window!=='undefined'?window:globalThis);
