/* Private national encounter deployment controls. The server owns approval and publication. */
(function(global){
 'use strict';
 const STORAGE_KEY='sengoku-roaming-management-pending-v1:',PAGE_SIZE=6;
 const STATUS={pending:'承認待ち',approved:'承認・反映済み',rejected:'却下',cancelled:'取り下げ済み',superseded:'配置更新により終了'};
 const ACTION={apply:'配置を反映',propose:'承認を申請',approve:'承認して反映',reject:'申請を却下',cancel:'申請を取り下げ'};
 const FIELDS=['totalTroops','squadSize','respawnSeconds'];
 const clone=value=>JSON.parse(JSON.stringify(value));
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=value=>Number.isFinite(value)?value.toLocaleString('ja-JP'):'—';
 const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
 const id=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(value);
 const proposalId=value=>typeof value==='string'&&/^rdp_[a-f0-9]{32}$/.test(value);
 const date=value=>{const d=new Date(value);return value&&Number.isFinite(d.getTime())?d.toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'日時不明';};
 function config(value){
  if(!value||!integer(value.totalTroops,0,20000000)||!integer(value.squadSize,300,20000)||!integer(value.respawnSeconds,60,3600)||Math.ceil(value.totalTroops/value.squadSize)>4096)return null;
  return Object.fromEntries(FIELDS.map(key=>[key,value[key]]));
 }
 function cleanDeployment(value){const result=config(value);return result&&integer(value.revision,1,1000000000)&&value.totalSquads===Math.ceil(result.totalTroops/result.squadSize)?{...result,revision:value.revision,totalSquads:value.totalSquads}:null;}
 function cleanProposal(value){
  const clean=config(value?.config);
  if(!clean||!proposalId(value.id)||!Object.hasOwn(STATUS,value.status)||!integer(value.expectedRevision,1,1000000000)||!id(value.requester?.id)||typeof value.requester?.name!=='string'||typeof value.note!=='string'||value.note.length>1000)return null;
  return {id:value.id,status:value.status,expectedRevision:value.expectedRevision,config:clean,requestedAt:typeof value.requestedAt==='string'?value.requestedAt:'',note:value.note,requester:{id:value.requester.id,name:value.requester.name.slice(0,120)},reviewedAt:typeof value.reviewedAt==='string'?value.reviewedAt:null,appliedRevision:integer(value.appliedRevision,1,1000000000)?value.appliedRevision:null,canApprove:value.canApprove===true,canCancel:value.canCancel===true};
 }
 function createController(options={}){
  const getContext=options.getContext||(()=>global.SengokuSocial?.getEventContext?.()),request=options.request||((route,settings)=>global.SengokuSocial.roamingRequest(route,settings)),uuid=options.uuid||(()=>global.crypto.randomUUID());
  let storage;try{storage=options.storage??global.localStorage;}catch(_){}
  let disposed=false,stamp='',generation=0,readSequence=0,flight=null;
  const empty=()=>({authorized:false,ownerId:'',isAdmin:false,open:false,loaded:false,loading:false,sending:false,deployment:null,capabilities:{canApply:false,canApprove:false,canPropose:false},proposals:[],form:{totalTroops:'',squadSize:'',respawnSeconds:'',note:''},dirty:false,page:1,confirmation:null,pending:null,error:'',message:'',change:'init'});
  let state=empty();
  function context(){const c=getContext()||{},u=c.user,admin=u?.isAdmin===true,staff=u?.isStaff===true&&!admin;return {ownerId:id(u?.id)?u.id:'',isAdmin:admin,isStaff:staff,allowed:!!u?.id&&(admin||staff)&&!c.pending&&!c.banned&&u.isBanned!==true&&c.connected!==false,stamp:JSON.stringify([u?.id||'',admin,staff,c.epoch??null,c.privilegeEpoch??null,c.accountEpoch??null,!!c.pending,!!c.banned,u?.isBanned===true,c.connected!==false])};}
  const key=owner=>STORAGE_KEY+encodeURIComponent(owner);
  function validRecord(value,who){
   if(!value||value.ownerId!==who.ownerId||!Object.hasOwn(ACTION,value.action)||!id(value.body?.requestId)||!integer(value.body?.expectedRevision,1,1000000000)||!cleanDeployment(value.current))return false;
   if(['apply','approve','reject'].includes(value.action)&&!who.isAdmin||value.action==='propose'&&!who.isStaff)return false;
   if(['apply','propose'].includes(value.action))return !!config(value.body)&&typeof value.body.note==='string'&&value.body.note.length<=300;
   return proposalId(value.proposalId)&&!!cleanProposal(value.proposal)&&value.proposalId===value.proposal.id;
  }
  function readPending(who){try{const value=JSON.parse(storage?.getItem(key(who.ownerId))||'null');return validRecord(value,who)?value:null;}catch(_){return null;}}
  function persist(record){if(!storage?.setItem)throw Error('操作記録を保存できません。ブラウザの保存設定を確認してください。');const value=JSON.stringify(record);storage.setItem(key(record.ownerId),value);if(storage.getItem(key(record.ownerId))!==value)throw Error('操作記録の保存を確認できませんでした。');}
  function clear(record){try{const saved=JSON.parse(storage?.getItem(key(record.ownerId))||'null');if(saved?.body?.requestId===record.body.requestId)storage.removeItem(key(record.ownerId));}catch(_){}
  }
  const snapshot=()=>clone(state);
  function emit(change='status'){if(!disposed){state.change=change;options.onChange?.(snapshot());}}
  function identity(){const who=context();if(stamp!==who.stamp){stamp=who.stamp;generation++;readSequence++;flight=null;state={...empty(),authorized:who.allowed,ownerId:who.ownerId,isAdmin:who.isAdmin,pending:who.allowed?readPending(who):null};emit('identity');}return who;}
  const current=g=>!disposed&&g===generation&&context().stamp===stamp&&context().allowed;
  function notify(deployment){try{options.onDeploymentChanged?.(clone(deployment));}catch(_){}
  }
  function accept(result,{preserveForm=true,notifyChange=true}={}){
   const deployment=cleanDeployment(result?.deployment),who=context(),proposals=Array.isArray(result?.proposals)&&result.proposals.length<=100?result.proposals.map(cleanProposal):null;
   if(result?.ok!==true||!deployment||!result.capabilities||!proposals||proposals.some(value=>!value)||!who.isAdmin&&proposals.some(value=>value.requester.id!==who.ownerId))throw Error('配置情報の応答を確認できませんでした。もう一度取得してください。');
   const previous=state.deployment;
   state.deployment=deployment;state.proposals=proposals;state.loaded=true;
   state.capabilities={canApply:who.isAdmin&&result.capabilities.canApply===true,canApprove:who.isAdmin&&result.capabilities.canApprove===true,canPropose:who.isStaff&&result.capabilities.canPropose===true};
   state.page=Math.min(state.page,Math.max(1,Math.ceil(proposals.length/PAGE_SIZE)));
   if(!preserveForm||!state.dirty){state.form={...Object.fromEntries(FIELDS.map(field=>[field,String(deployment[field])])),note:''};state.dirty=false;}
   if(notifyChange&&previous&&previous.revision!==deployment.revision)notify(deployment);
  }
  async function call(route,settings,g){
   if(!current(g))throw Object.assign(Error('利用権限が変わりました。'),{code:'STALE_IDENTITY'});
   let timer;
   const timeoutMs=options.timeoutMs??30000;
   try{return await Promise.race([Promise.resolve().then(()=>{if(!current(g))throw Object.assign(Error('利用権限が変わりました。'),{code:'STALE_IDENTITY'});return request(route,settings);}),new Promise((_,reject)=>{timer=global.setTimeout(()=>reject(Object.assign(Error('通信結果を確認できませんでした。同じ操作番号で再確認してください。'),{code:'TIMEOUT'})),timeoutMs);})]);}
   finally{global.clearTimeout(timer);}
  }
  async function reload(){
   identity();if(disposed||!state.authorized||!state.open||state.loading||state.sending)return false;
   const g=generation,seq=++readSequence;state.loading=true;state.error='';state.confirmation=null;emit('loading');
   try{const result=await call('/staff/roaming',{method:'GET'},g);identity();if(!current(g)||seq!==readSequence)return false;accept(result);emit('loaded');return true;}
   catch(error){identity();if(current(g)&&seq===readSequence){state.error=error.message||'配置情報を取得できませんでした。';emit('error');}return false;}
   finally{if(current(g)&&seq===readSequence){state.loading=false;emit();}}
  }
  async function open(){identity();if(disposed||!state.authorized)return false;state.open=true;emit('open');if(!state.loaded)await reload();return true;}
  function close(){identity();if(disposed)return;state.open=false;state.confirmation=null;emit('close');}
  function update(field,value){identity();if(disposed||!state.authorized||!state.loaded||state.sending||state.pending||state.confirmation||!FIELDS.includes(field)&&field!=='note')return false;state.form[field]=String(value).slice(0,field==='note'?300:12);state.dirty=true;state.error='';emit('input');return true;}
  function values(){const value={...Object.fromEntries(FIELDS.map(field=>[field,state.form[field].trim()===''?NaN:Number(state.form[field])])),note:state.form.note.trim()};return config(value)?value:null;}
  function prepare(action,selectedId){
   identity();if(disposed||!state.authorized||!state.open||!state.loaded||state.loading||state.sending||state.pending||!Object.hasOwn(ACTION,action))return false;
   state.error='';state.message='';
   let body={expectedRevision:state.deployment.revision},proposal=null;
   if(action==='apply'||action==='propose'){
    if(!state.capabilities[action==='apply'?'canApply':'canPropose'])return false;
    const input=values();if(!input){state.error='総兵数は0〜20,000,000人、1部隊は300〜20,000人、再出現は60〜3,600秒の整数で指定してください。部隊数は4,096以内です。';emit('error');return false;}body={...body,...input};
   }else{
    proposal=state.proposals.find(value=>value.id===selectedId);
    if(!proposal||proposal.status!=='pending')return false;
    if(action==='cancel'&&!proposal.canCancel||['approve','reject'].includes(action)&&!state.capabilities.canApprove||action==='approve'&&(!proposal.canApprove||proposal.expectedRevision!==state.deployment.revision))return false;
   }
   const requestId=String(uuid());if(!id(requestId)){state.error='操作番号を作成できませんでした。画面を開き直してください。';emit('error');return false;}
   state.confirmation={ownerId:state.ownerId,action,proposalId:proposal?.id||null,proposal:proposal?clone(proposal):null,current:clone(state.deployment),body:{...body,requestId}};emit('confirm');return true;
  }
  function back(){identity();if(!disposed&&!state.sending&&!state.pending){state.confirmation=null;emit('back');}}
  function route(record){if(record.action==='apply')return'/admin/roaming/deployment';if(record.action==='propose')return'/staff/roaming/proposals';return(record.action==='cancel'?'/staff':'/admin')+'/roaming/proposals/'+record.proposalId+'/'+record.action;}
  function capability(record){return record.action==='apply'?state.capabilities.canApply:record.action==='propose'?state.capabilities.canPropose:record.action==='cancel'?true:state.capabilities.canApprove;}
  function submit(){
   identity();if(disposed||!state.authorized||!state.open||!state.loaded||state.loading)return Promise.resolve(false);if(flight)return flight;
   const record=state.pending||state.confirmation;if(!record||!validRecord(record,context())||!capability(record))return Promise.resolve(false);
   // A pending replay must keep its original revision; only a new confirmation
   // is compared with the latest loaded deployment before the first write.
   if(!state.pending&&record.body.expectedRevision!==state.deployment.revision){state.confirmation=null;state.error='配置が更新されました。内容を確認し直してください。';emit('error');return Promise.resolve(false);}
   try{persist(record);}catch(error){state.error=error.message;emit('error');return Promise.resolve(false);}
   const g=generation;state.pending=clone(record);state.confirmation=null;state.sending=true;state.error='';state.message='';emit('sending');
   const operation=(async()=>{
    try{
     const result=await call(route(record),{method:'POST',data:clone(record.body)},g);identity();if(!current(g))return false;
     if(result?.ok!==true)throw Object.assign(Error(result?.error?.message||result?.message||'操作結果を確認できませんでした。'),{status:result?.status,code:result?.error?.code||result?.code});
     const receipt=result.receipt;
     if(!receipt||receipt.action!==record.action||receipt.requestId!==record.body.requestId||(receipt.proposalId||null)!==(record.proposalId||result.proposal?.id||null)||['apply','approve'].includes(record.action)&&!integer(receipt.appliedRevision,1,1000000000)||record.action==='propose'&&(!proposalId(result.proposal?.id)||FIELDS.some(field=>result.proposal.config?.[field]!==record.body[field])||result.proposal.note!==record.body.note))throw Error('送信した操作と結果が一致するか確認できませんでした。同じ操作番号で再確認してください。');
     accept(result,{preserveForm:!['apply','propose'].includes(record.action),notifyChange:false});clear(record);state.pending=null;
     state.message=result.idempotent?'記録済みの操作結果を確認しました。重ねて配置・申請していません。':({apply:'全国の野良兵配置を更新しました。',propose:'配置の変更を申請しました。運営が承認するまで、全国の配置は変わりません。',approve:'この申請を承認し、全国へ反映しました。',reject:'この申請を却下しました。',cancel:'この申請を取り下げました。'})[record.action];
     if(['apply','approve'].includes(record.action))notify(state.deployment);
     emit('settled');return true;
    }catch(error){
     identity();if(!current(g))return false;
     state.error=error.message||'操作結果を確認できませんでした。';
     if(Number(error.status)>=400&&Number(error.status)<500&&![401,403,408,429].includes(Number(error.status))&&error.retryable!==true){clear(record);state.pending=null;state.loaded=false;state.capabilities={canApply:false,canApprove:false,canPropose:false};state.error+=' 最新の配置を取得してから確認し直してください。';}
     emit('error');return false;
    }finally{if(current(g)){state.sending=false;flight=null;emit();}}
   })();flight=operation;return operation;
  }
  function page(value){identity();if(disposed||state.sending||state.confirmation||state.pending)return false;state.page=Math.max(1,Math.min(Math.max(1,Math.ceil(state.proposals.length/PAGE_SIZE)),Number(value)||1));emit('page');return true;}
  identity();
  return{snapshot,open,close,reload,update,prepare,back,submit,page,refresh(){identity();return snapshot();},dispose(){disposed=true;generation++;readSequence++;flight=null;state=empty();}};
 }
 function metrics(value){return value?`<dl class="rm-metrics"><div><dt>全国の総兵数</dt><dd>${number(value.totalTroops)}<small>人</small></dd></div><div><dt>配置する部隊</dt><dd>${number(value.totalSquads??Math.ceil(value.totalTroops/value.squadSize))}<small>部隊</small></dd></div><div><dt>撃退後の再出現</dt><dd>${number(value.respawnSeconds)}<small>秒</small></dd></div></dl>`:'';}
 function comparison(current,next){return `<div class="rm-comparison"><table><caption>現在の配置と変更内容</caption><thead><tr><th scope="col">設定</th><th scope="col">現在</th><th scope="col">変更後</th></tr></thead><tbody>${[['totalTroops','全国の総兵数','人'],['squadSize','1部隊の兵数','人'],['respawnSeconds','再出現まで','秒']].map(([key,label,unit])=>`<tr><th scope="row">${label}</th><td>${number(current[key])}${unit}</td><td class="${current[key]!==next[key]?'is-changed':''}">${number(next[key])}${unit}</td></tr>`).join('')}</tbody></table></div>`;}
 function confirmationMarkup(record,pending=false){
  if(!record)return'';const action=record.action,next=record.proposal?.config||record.body,changes=['apply','propose','approve'].includes(action),heading=pending?'送信した内容':({apply:'この配置を全国へ反映しますか？',propose:'この配置の承認を申請しますか？',approve:'この申請を承認して反映しますか？',reject:'この申請を却下しますか？',cancel:'この申請を取り下げますか？'})[action];
  return `<h3 tabindex="-1">${heading}</h3>${record.proposal?`<p class="rm-note">申請者：${esc(record.proposal.requester.name)} · ${date(record.proposal.requestedAt)}</p>`:''}${comparison(record.current,next)}${(record.proposal?.note||record.body.note)?`<p class="rm-note-text">${esc(record.proposal?.note||record.body.note)}</p>`:''}<p>${action==='propose'?'申請内容は送信後に変更できません。運営がこの内容を承認したときだけ、全国へ反映されます。':action==='approve'?'表示した申請内容を全国へ反映します。ほかの未承認の申請は終了します。':action==='apply'?'新しい部隊を全国へ配置します。現在の部隊と再出現待ちは、新しい配置へ切り替わります。':action==='reject'?'全国の配置は変えず、この申請を終了します。':'全国の配置は変えず、自分の申請を取り下げます。'}</p>${changes&&next.totalTroops===0?'<p class="rm-zero">総兵数は0人です。反映すると野良兵戦の相手がいなくなります。</p>':''}${pending?`<p class="rm-note">操作番号：<code>${esc(record.body.requestId)}</code></p>`:`<div class="rm-actions"><button type="button" class="button" data-rm-action="back">戻って確認</button><button type="button" class="button gold" data-rm-action="submit">${ACTION[action]}</button></div>`}`;
 }
 function proposalMarkup(proposal,s){
  const pending=proposal.status==='pending',stale=pending&&proposal.expectedRevision!==s.deployment?.revision,locked=s.sending||s.loading||!!s.pending||!!s.confirmation||!s.loaded;
  return `<article class="rm-proposal"><header><div><h4>${esc(proposal.requester.name)}の申請</h4><p class="rm-note">${date(proposal.requestedAt)} · 配置 第${proposal.expectedRevision}版への変更</p></div><span class="rm-badge ${pending&&!stale?'is-pending':''}">${stale?'再申請が必要':STATUS[proposal.status]}</span></header><div class="rm-proposal-values"><span>全国 <b>${number(proposal.config.totalTroops)}人</b></span><span>1部隊 <b>${number(proposal.config.squadSize)}人</b></span><span>再出現 <b>${number(proposal.config.respawnSeconds)}秒</b></span></div>${proposal.note?`<p class="rm-note-text">${esc(proposal.note)}</p>`:''}${stale?'<p class="rm-note">申請後に全国の配置が変わっています。最新の配置を確認して再申請してください。</p>':''}${pending?`<div class="rm-actions">${s.capabilities.canApprove?`<button type="button" class="button" data-rm-action="reject" data-rm-proposal="${proposal.id}" ${locked?'disabled':''}>却下の確認</button><button type="button" class="button gold" data-rm-action="approve" data-rm-proposal="${proposal.id}" ${locked||stale||!proposal.canApprove?'disabled':''}>内容を確認して承認</button>`:''}${proposal.canCancel?`<button type="button" class="button" data-rm-action="cancel" data-rm-proposal="${proposal.id}" ${locked?'disabled':''}>申請を取り下げる</button>`:''}</div>`:''}${proposal.appliedRevision?`<p class="rm-note">配置 第${proposal.appliedRevision}版へ反映済み</p>`:''}</article>`;
 }
 function shell(prefix){return `<details class="roaming-management"><summary><span><b>全国の野良兵配置</b><small data-rm-role></small></span><span class="rm-summary-label">設定を開く</span></summary><div class="rm-body"><header class="rm-heading"><div><span class="eyebrow">DEPLOYMENT CONTROL</span><h2>全国への配置設定</h2><p data-rm-intro></p></div><button type="button" class="button" data-rm-action="reload">最新の配置を取得</button></header><div data-rm-current></div><p class="rm-feedback" data-rm-feedback role="status" aria-live="polite" tabindex="-1" hidden></p><section class="rm-pending" data-rm-pending hidden></section><section class="rm-confirm" data-rm-confirm hidden></section><form class="rm-form" data-rm-form><div class="rm-fields"><label for="${prefix}-totalTroops">全国の総兵数<span>0〜20,000,000人</span><input id="${prefix}-totalTroops" name="totalTroops" type="number" inputmode="numeric" min="0" max="20000000" step="1" required></label><label for="${prefix}-squadSize">1部隊の兵数<span>300〜20,000人</span><input id="${prefix}-squadSize" name="squadSize" type="number" inputmode="numeric" min="300" max="20000" step="1" required></label><label for="${prefix}-respawnSeconds">撃退後の再出現まで<span>60〜3,600秒</span><input id="${prefix}-respawnSeconds" name="respawnSeconds" type="number" inputmode="numeric" min="60" max="3600" step="1" required></label></div><p class="rm-calculation" data-rm-calculation aria-live="polite"></p><label for="${prefix}-note">変更のメモ<span>任意・300文字まで</span><textarea id="${prefix}-note" name="note" rows="2" maxlength="300" placeholder="配置を変更する目的など"></textarea></label><p class="rm-note">部隊数は4,096以内です。全国128城の周辺へ均等に振り分け、端数は最後の部隊に配置します。</p><div class="rm-actions"><button type="submit" class="button gold" data-rm-prepare></button></div></form><section class="rm-proposals"><div class="rm-section-title"><h3>配置変更の申請</h3><span data-rm-proposal-count></span></div><div data-rm-proposals></div><div class="rm-pagination" data-rm-pagination hidden><button type="button" class="button" data-rm-action="previous">前の申請</button><span data-rm-page></span><button type="button" class="button" data-rm-action="next">次の申請</button></div></section><p class="rm-footer">この設定と申請内容は、権限のある本人だけに表示します。日時は日本時間です。</p></div></details>`;}
 let mountSequence=0;
 function mount(host,options={}){
  if(!host)return{refresh(){},dispose(){}};
  const prefix='roaming-management-'+(++mountSequence);let alive=true,shellStamp='',controller,focusIntent='';
  const $=selector=>host.querySelector(selector),html=(node,value)=>{if(node&&node.innerHTML!==value)node.innerHTML=value;};
  function render(s){
   if(!alive)return;
   if(!s.authorized){host.innerHTML='';host.hidden=true;shellStamp='';return;}
   host.hidden=false;const key=s.ownerId+':'+s.isAdmin;
   if(shellStamp!==key){host.innerHTML=shell(prefix);shellStamp=key;}
   const active=host.ownerDocument?.activeElement,owned=host.contains(active),details=$('details');if(details.open!==s.open)details.open=s.open;
   $('[data-rm-role]').textContent=s.isAdmin?'運営用の設定・承認':'スタッフ用の配置申請';
   $('[data-rm-intro]').textContent=s.isAdmin?'全国の配置を直接変更できます。スタッフから届いた申請も、内容を確認して承認できます。':'配置の変更を運営へ申請できます。運営が承認するまで、全国の配置は変わりません。';
   html($('[data-rm-current]'),s.deployment?`<p class="rm-current-label">現在の配置 · 第${s.deployment.revision}版</p>${metrics(s.deployment)}`:`<p class="rm-note">${s.loading?'現在の配置を確認しています…':'最新の配置を取得してください。'}</p>`);
   const message=s.error||s.message,feedback=$('[data-rm-feedback]');feedback.hidden=!message;feedback.textContent=message;feedback.dataset.error=String(!!s.error);feedback.setAttribute('role',s.error?'alert':'status');
   const locked=s.loading||s.sending||!!s.pending||!!s.confirmation||!s.loaded;
   $('[data-rm-action="reload"]').disabled=s.loading||s.sending||!!s.confirmation;
   const form=$('[data-rm-form]');form.hidden=!!s.confirmation||!!s.pending;
   for(const field of [...FIELDS,'note']){const input=form.elements.namedItem(field);if(input.value!==s.form[field])input.value=s.form[field];input.disabled=locked;}
   const ready=s.isAdmin?s.capabilities.canApply:s.capabilities.canPropose,prepare=$('[data-rm-prepare]');prepare.disabled=locked||!ready;
   const label=s.isAdmin?'配置内容を確認する':'申請内容を確認する';if(prepare.textContent!==label)prepare.textContent=label;
   const value=config(Object.fromEntries(FIELDS.map(field=>[field,s.form[field].trim()===''?NaN:Number(s.form[field])]))),count=value?Math.ceil(value.totalTroops/value.squadSize):0,remainder=value?.totalTroops%value?.squadSize;
   $('[data-rm-calculation]').textContent=value?value.totalTroops===0?'総兵数0人：野良兵戦の相手を配置しません。':`${number(count)}部隊を全国へ配置します。${remainder?`最後の部隊は${number(remainder)}人です。`:''}`:'人数と再出現までの秒数を入力してください。';
   const confirm=$('[data-rm-confirm]');confirm.hidden=!s.confirmation;html(confirm,confirmationMarkup(s.confirmation));
   const pending=$('[data-rm-pending]');pending.hidden=!s.pending;html(pending,s.pending?`<p class="rm-pending-status">${s.sending?'操作結果を確認しています…':'送信した操作の結果が未確認です'}</p>${confirmationMarkup(s.pending,true)}<button type="button" class="button gold" data-rm-action="submit" ${s.sending||s.loading||!s.loaded?'disabled':''}>同じ操作の結果を確認</button>`:'');
   $('[data-rm-proposal-count]').textContent=s.loaded?`${number(s.proposals.filter(p=>p.status==='pending').length)}件の承認待ち / ${number(s.proposals.length)}件`:'';
   html($('[data-rm-proposals]'),s.proposals.length?s.proposals.slice((s.page-1)*PAGE_SIZE,s.page*PAGE_SIZE).map(p=>proposalMarkup(p,s)).join(''):`<p class="rm-empty">${s.loading?'申請を確認しています…':s.loaded?'配置変更の申請はありません。':'最新の申請を取得してください。'}</p>`);
   const pages=Math.max(1,Math.ceil(s.proposals.length/PAGE_SIZE));$('[data-rm-pagination]').hidden=pages<=1;$('[data-rm-page]').textContent=`${s.page} / ${pages}`;
   $('[data-rm-action="previous"]').disabled=locked||s.page<=1;$('[data-rm-action="next"]').disabled=locked||s.page>=pages;
   let focus;
   if(focusIntent==='confirm'&&s.confirmation)focus=confirm.querySelector('h3');
   else if(focusIntent==='back')focus=prepare;
   else if(s.change==='settled'&&(owned||!active||active===host.ownerDocument?.body))focus=feedback;
   else if(s.sending&&owned&&active?.dataset?.rmAction==='submit')focus=pending.querySelector('h3');
   if(focus){focus.focus?.({preventScroll:true});if(focusIntent==='confirm'||s.change==='settled')focus.scrollIntoView?.({block:'nearest',behavior:'auto'});}
   focusIntent='';global.SengokuArt?.decorate?.();options.onChange?.(s);
  }
  controller=createController({...options,onChange:render});
  const click=event=>{const button=event.target.closest?.('[data-rm-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();const action=button.dataset.rmAction;if(action==='reload')void controller.reload();else if(action==='back'){focusIntent='back';controller.back();}else if(action==='submit')void controller.submit();else if(action==='previous'||action==='next')controller.page(controller.snapshot().page+(action==='next'?1:-1));else if(['approve','reject','cancel'].includes(action)){focusIntent='confirm';controller.prepare(action,button.dataset.rmProposal);}};
  const input=event=>{if(event.target.closest?.('[data-rm-form]'))controller.update(event.target.name,event.target.value);};
  const submit=event=>{if(!event.target.matches?.('[data-rm-form]'))return;event.preventDefault();focusIntent='confirm';controller.prepare(controller.snapshot().isAdmin?'apply':'propose');};
  const toggle=event=>{if(!event.target.matches?.('.roaming-management'))return;const s=controller.snapshot();if(event.target.open&&!s.open)void controller.open();else if(!event.target.open&&s.open)controller.close();};
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('submit',submit);host.addEventListener('toggle',toggle,true);render(controller.snapshot());
  return{controller,refresh:()=>controller.refresh(),refreshContext:()=>controller.refresh(),dispose(){alive=false;controller.dispose();host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('submit',submit);host.removeEventListener('toggle',toggle,true);host.innerHTML='';host.hidden=true;}};
 }
 const api={createController,mount,cleanDeployment,cleanProposal,confirmationMarkup,proposalMarkup};global.SengokuRoamingManagement=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
