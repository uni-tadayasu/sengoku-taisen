/* Sender-owned troops at server-confirmed vacant castles. No local settlement. */
(function(global){
'use strict';
const STORE='sengoku-troop-garrison-ui-pending-v1:',LIMIT=100000000;
const clone=value=>JSON.parse(JSON.stringify(value));
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,180}$/.test(value);
const integer=(value,min=0,max=LIMIT)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const text=(value,max=300)=>typeof value==='string'&&value.length>0&&value.length<=max;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');
const amount=value=>/^[0-9]+$/.test(String(value))&&integer(Number(value),1)?Number(value):null;
function cleanSnapshot(value){
 const transportCapacity=value?.army?.transportCapacity??value?.army?.capacity,recruitmentCapacity=value?.army?.recruitmentCapacity;
 if(!value||!identifier(value.campaignId)||value.commandCost!==1||!integer(value.command?.current)||!integer(value.command?.max,1)||value.command.current>value.command.max||!integer(value.army?.troops)||!integer(value.army?.capacity)||!integer(transportCapacity)||recruitmentCapacity!==undefined&&!integer(recruitmentCapacity)||!integer(value.army?.recallCapacity)||value.army.recallCapacity>Math.max(0,transportCapacity-value.army.troops)||!Array.isArray(value.garrisons)||!Array.isArray(value.availableCastles)||value.garrisons.length>500||value.availableCastles.length>500)return null;
 const castle=row=>row&&identifier(row.castleId)&&text(row.castleName,120)&&typeof row.majorCity==='boolean';
 const garrisons=value.garrisons.map(row=>castle(row)&&integer(row.troops,1)&&typeof row.canSend==='boolean'&&typeof row.sendReason==='string'&&row.sendReason.length<=1500&&integer(row.maxSend,0,value.army.troops)&&integer(row.maxRecall,0,Math.min(row.troops,value.army.recallCapacity))?{castleId:row.castleId,castleName:row.castleName,majorCity:row.majorCity,troops:row.troops,canSend:row.canSend,sendReason:row.sendReason,maxSend:row.maxSend,maxRecall:row.maxRecall}:null);
 const availableCastles=value.availableCastles.map(row=>castle(row)&&integer(row.stationedTroops)&&integer(row.maxSend,0,value.army.troops)?{castleId:row.castleId,castleName:row.castleName,majorCity:row.majorCity,stationedTroops:row.stationedTroops,maxSend:row.maxSend}:null);
 if([...garrisons,...availableCastles].some(row=>!row)||[garrisons,availableCastles].some(rows=>new Set(rows.map(row=>row.castleId)).size!==rows.length))return null;
 return{campaignId:value.campaignId,commandCost:1,command:{current:value.command.current,max:value.command.max},army:{troops:value.army.troops,capacity:value.army.capacity,transportCapacity,...(recruitmentCapacity===undefined?{}:{recruitmentCapacity}),recallCapacity:value.army.recallCapacity},garrisons,availableCastles};
}
function cleanResult(value,record){
 const d=record.data;
 if(!value||value.requestId!==d.requestId||value.action!==record.action||value.castleId!==d.castleId||value.troops!==d.troops||!text(value.castleName,120)||value.commandCost!==1||!text(value.message,1500)||!['armyBefore','armyAfter','garrisonBefore','garrisonAfter'].every(key=>integer(value[key])))return null;
 const sign=record.action==='send'?1:-1;
 if(value.armyAfter!==value.armyBefore-sign*d.troops||value.garrisonAfter!==value.garrisonBefore+sign*d.troops)return null;
 return{requestId:value.requestId,action:value.action,castleId:value.castleId,castleName:value.castleName,troops:value.troops,armyBefore:value.armyBefore,armyAfter:value.armyAfter,garrisonBefore:value.garrisonBefore,garrisonAfter:value.garrisonAfter,commandCost:1,message:value.message};
}
function transferPreview(state,action,castleId=state.castleId){
 const data=state.data,recall=action==='recall',row=recall?data?.garrisons.find(item=>item.castleId===castleId):data?.availableCastles.find(item=>item.castleId===castleId),raw=recall?state.recallAmounts?.[castleId]??'1':state.sendAmount,troops=amount(raw),maxTroops=row?(recall?row.maxRecall:row.maxSend):0;
 const result={ok:false,action,castleId,castleName:row?.castleName||'',troops,maxTroops,commandCost:1,armyBefore:data?.army.troops??0,garrisonBefore:row?(recall?row.troops:row.stationedTroops):0};
 const fail=message=>({...result,message});
 if(!state.access?.readable)return fail(state.access?.reason||'領主登録と端末同期を確認してください。');
 if(!data)return fail(state.loading?'兵の配置を確認しています。':'最新の兵の配置を読み込んでください。');
 if(state.sending||state.pending)return fail('前の操作の結果を確認してから次の兵を動かせます。');
 if(!state.access.writable)return fail(state.access.reason||'この端末の操作権と保存を確認してください。');
 if(!row)return fail(recall?'この城に駐留している自分の兵を確認してください。':castleId?'この城へは現在派遣できません。空城の一覧を更新してください。':'派遣先の空城を選んでください。');
 if(maxTroops<1)return fail(recall?'出陣中の兵を含めた保有上限に空きがありません。駐留兵はそのまま残ります。':data.army.troops<1?'派遣できる本隊の兵がいません。':'この城に追加で駐留できる人数の上限に達しています。');
 if(troops===null||troops>maxTroops)return fail(`人数を1〜${num(maxTroops)}人の整数で入力してください。`);
 if(data.command.current<1)return fail('兵の派遣・帰還には指令1回が必要です。');
 return{...result,ok:true,message:'',armyAfter:data.army.troops+(recall?troops:-troops),garrisonAfter:result.garrisonBefore+(recall?-troops:troops)};
}
function createController(options={}){
 const request=options.request||((route,settings)=>global.SengokuBridge.troopGarrisons(route,settings));
 const getContext=options.getContext||(()=>global.SengokuSocial?.getTroopGarrisonContext?.()||{}),notify=options.onChange||(()=>{}),uuid=options.uuid||(()=>global.crypto.randomUUID());
 let storage;try{storage=options.storage??global.localStorage;}catch(_){}
 let disposed=false,stamp='',generation=0,loadSequence=0,flight=null;
 const empty=()=>({open:false,ownerId:'',data:null,castleId:'',sendAmount:'100',recallAmounts:{},loading:false,sending:false,pending:null,result:null,error:'',message:'',change:'init'});
 let state=empty();
 function context(){
  const c=getContext()||{},playerId=typeof c.playerId==='string'?c.playerId:typeof c.user?.id==='string'?c.user.id:'',readable=Boolean(playerId&&c.user?.id===playerId&&!c.pending&&!c.banned&&c.readable!==false),writable=readable&&c.writable===true;
  return{playerId,readable,writable,campaignId:typeof c.campaignId==='string'?c.campaignId:'',reason:String(c.reason||c.message||(!readable?'領主登録と端末同期を確認してください。':'操作端末と保存・共通時刻を確認しています。')),stamp:JSON.stringify([playerId,c.epoch??null,c.accountEpoch??null,c.privilegeEpoch??null,c.campaignId??null,readable])};
 }
 const key=owner=>STORE+encodeURIComponent(owner);
 function validPending(value,owner){
  if(!value||value.ownerId!==owner||!['send','recall'].includes(value.action)||value.route!=='/troop-garrisons/'+value.action||!identifier(value.data?.requestId)||!identifier(value.data?.campaignId)||!identifier(value.data?.castleId)||!integer(value.data?.troops,1))return null;
  return{ownerId:owner,action:value.action,route:value.route,data:{requestId:value.data.requestId,campaignId:value.data.campaignId,castleId:value.data.castleId,troops:value.data.troops}};
 }
 function readPending(owner){try{return validPending(JSON.parse(storage?.getItem(key(owner))||'null'),owner);}catch(_){return null;}}
 function persist(record){const value=JSON.stringify(record);if(!storage?.setItem)throw Error('操作の記録を保存できません。ブラウザの保存設定を確認してください。');storage.setItem(key(record.ownerId),value);if(storage.getItem(key(record.ownerId))!==value)throw Error('操作の記録を保存できませんでした。');}
 function clear(record){try{if(readPending(record.ownerId)?.data.requestId===record.data.requestId)storage.removeItem(key(record.ownerId));}catch(_){} }
 function snapshot(){const c=context();return clone({...state,access:{readable:c.readable,writable:c.writable,reason:c.reason}});}
 function emit(change='status'){if(!disposed){state.change=change;notify(snapshot());}}
 function identity(){
  const c=context();if(stamp!==c.stamp){const open=state.open;stamp=c.stamp;generation++;loadSequence++;flight=null;state={...empty(),open,ownerId:c.playerId,pending:c.readable?readPending(c.playerId):null};emit('identity');}return c;
 }
 const current=(g,expected)=>!disposed&&generation===g&&context().stamp===expected;
 function adopt(value,c){const data=cleanSnapshot(value);if(!data||c.campaignId&&data.campaignId!==c.campaignId)return false;state.data=data;return true;}
 async function refresh({quiet=false}={}){
  const c=identity();if(disposed||!c.readable||state.sending||state.loading)return false;
  const g=generation,expected=c.stamp,seq=++loadSequence;state.loading=true;if(!quiet)state.error='';emit('loading');
  try{
   const result=await request('/troop-garrisons',{method:'GET'});if(!current(g,expected)||seq!==loadSequence){identity();return false;}
   if(result?.ok!==true)throw Error(result?.error?.message||'兵の配置を読み込めませんでした。');
   if(!adopt(result,c))throw Error('兵の配置情報を確認できませんでした。もう一度更新してください。');
   emit('loaded');return true;
  }catch(error){if(current(g,expected)&&seq===loadSequence){state.error=error.message||'兵の配置を読み込めませんでした。';emit('error');}return false;}
  finally{if(current(g,expected)&&seq===loadSequence){state.loading=false;emit('settled');}}
 }
 function setDestination(value){identity();if(state.sending||state.pending)return false;state.castleId=String(value||'').slice(0,180);state.error='';emit('draft');return true;}
 function setAmount(value,castleId){identity();if(state.sending||state.pending)return false;const raw=String(value??'').slice(0,20);if(castleId)state.recallAmounts[castleId]=raw;else state.sendAmount=raw;state.error='';emit('draft');return true;}
 function maximum(action,castleId=state.castleId){const preview=transferPreview(snapshot(),action,castleId);return preview.maxTroops>0?setAmount(String(preview.maxTroops),action==='recall'?castleId:null):false;}
 function perform(record){
  if(flight)return flight;const c=identity();if(disposed||!c.readable||!c.writable||state.sending){state.error=c.reason;emit('error');return Promise.resolve(false);}
  const g=generation,expected=c.stamp;loadSequence++;state.loading=false;state.pending=record;state.sending=true;state.error='';state.message='';emit('sending');
  const job=Promise.resolve().then(async()=>{
   try{
    if(!current(g,expected)){identity();return false;}
    const response=await request(record.route,{method:'POST',data:clone(record.data)});
    if(!current(g,expected)){identity();return false;}
    if(response?.ok===false)throw Object.assign(Error(response?.error?.message||'兵の移動を確認できませんでした。'),{status:response?.status||400,retryable:response?.retryable===true||response?.error?.retryable===true});
    if(response?.ok!==true)throw Error('通信結果の形式を確認できませんでした。同じ操作の結果を再確認してください。');
    const receipt=cleanResult(response.result,record),data=cleanSnapshot(response);
    if(!receipt||!data||c.campaignId&&data.campaignId!==c.campaignId)throw Error('結果の内容を確認できませんでした。同じ操作の結果を再確認してください。');
    clear(record);state.pending=null;state.result=receipt;state.data=data;state.message=receipt.message;emit('result');return true;
   }catch(error){
    if(!current(g,expected)){identity();return false;}
    const status=Number(error.status);
    if(status>=400&&status<500&&status!==408&&status!==429&&error.retryable!==true){clear(record);state.pending=null;}
    state.error=error.message||'通信結果を確認できませんでした。';emit('error');return false;
   }finally{if(current(g,expected)){state.sending=false;flight=null;emit('settled');}}
  });flight=job;return job;
 }
 function submit(action,castleId=state.castleId){
  identity();if(disposed||state.sending||state.pending)return Promise.resolve(false);
  const preview=transferPreview(snapshot(),action,castleId);if(!preview.ok){state.error=preview.message;emit('error');return Promise.resolve(false);}
  try{const requestId=String(uuid());if(!identifier(requestId))throw Error('操作番号を確認できませんでした。');const record={ownerId:state.ownerId,action,route:'/troop-garrisons/'+action,data:{requestId,campaignId:state.data.campaignId,castleId:preview.castleId,troops:preview.troops}};persist(record);return perform(record);}
  catch(error){state.error=error.message||'操作を記録できませんでした。';emit('error');return Promise.resolve(false);}
 }
 async function open(){identity();if(disposed)return false;state.open=true;emit('open');return refresh();}
 function close(){state.open=false;emit('close');}
 return{open,close,refresh,setDestination,setAmount,maximum,send:()=>submit('send'),recall:castleId=>submit('recall',castleId),retry:()=>{identity();return state.pending?perform(state.pending):Promise.resolve(false);},preview:(action,castleId)=>{identity();return transferPreview(snapshot(),action,castleId);},getState:()=>{identity();return snapshot();},refreshIdentity:()=>{const before=generation;identity();if(state.open&&before!==generation)return refresh();emit('access');return Promise.resolve(true);},dispose:()=>{disposed=true;generation++;loadSequence++;flight=null;}};
}
const disabled=value=>value?' disabled':'';
function quoteMarkup(q){return `<div class="troop-garrison-quote"><span>移動に指令1回 · 資材の消費なし</span>${q.ok?`<dl><div><dt>本隊</dt><dd>${num(q.armyBefore)} <span aria-hidden="true">→</span> <b>${num(q.armyAfter)}</b>人</dd></div><div><dt>この城の駐留兵</dt><dd>${num(q.garrisonBefore)} <span aria-hidden="true">→</span> <b>${num(q.garrisonAfter)}</b>人</dd></div></dl>`:''}<p data-garrison-quote-reason${q.message?'':' hidden'}>${esc(q.message)}</p></div>`;}
function pageMarkup(state){
 if(!state.access.readable)return `<section class="troop-garrison-empty"><h2>領主と本隊を確認してください</h2><p>${esc(state.access.reason)}</p><button type="button" class="troop-garrison-button" data-garrison="register">領主登録・端末同期へ</button></section>`;
 const data=state.data;if(!data)return `<section class="troop-garrison-empty"><h2>${state.loading?'兵の配置を確認しています':'最新の配置を読み込んでください'}</h2><p>派遣できる空城と、自分の駐留部隊を確認します。</p></section>`;
 const locked=state.sending||Boolean(state.pending),send=transferPreview(state,'send'),selected=data.availableCastles.some(row=>row.castleId===state.castleId),total=data.garrisons.reduce((sum,row)=>sum+row.troops,0);
 const sendOptions=`<option value=""${state.castleId?'':' selected'}>空城を選択してください</option>${state.castleId&&!selected?`<option value="${esc(state.castleId)}" selected disabled>選択していた城へは現在派遣できません</option>`:''}${data.availableCastles.map(row=>`<option value="${esc(row.castleId)}"${row.castleId===state.castleId?' selected':''}>${esc(row.castleName)}${row.majorCity?'（大都市）':''} · 自軍 ${num(row.stationedTroops)}人</option>`).join('')}`;
 return `<section class="troop-garrison-intro"><p>本隊の兵を空城へ派遣し、自分の駐留部隊として配置します。駐留兵は必要な人数を本隊へ戻せます。本拠や所属は変わりません。</p><dl class="troop-garrison-totals"><div><dt>本隊の兵</dt><dd>${num(data.army.troops)}<small>人</small></dd></div><div><dt>空城への駐留兵</dt><dd>${num(total)}<small>人</small></dd></div><div><dt>指令</dt><dd>${num(data.command.current)}<small> / ${num(data.command.max)}</small></dd></div></dl></section>
 <section class="troop-garrison-section"><div class="troop-garrison-section-heading"><h2>空城へ派遣する</h2><span>${num(data.availableCastles.length)}城</span></div><p class="troop-garrison-note">現在、派遣できる城の一覧です。派遣確定時にも空城であることを確認します。</p>
 <form data-garrison-form="send" novalidate><label for="troop-garrison-castle">派遣先の城</label><select id="troop-garrison-castle" data-garrison-destination${disabled(locked||!data.availableCastles.length)}>${sendOptions}</select><label for="troop-garrison-send-amount">派遣する人数</label><div class="troop-garrison-amount"><input id="troop-garrison-send-amount" type="number" inputmode="numeric" min="1" max="${send.maxTroops}" step="1" value="${esc(state.sendAmount)}" data-garrison-amount="send" aria-describedby="troop-garrison-send-limit"${disabled(locked)}><span>人</span><button type="button" class="troop-garrison-button is-small" data-garrison="max-send"${disabled(locked||send.maxTroops<1)}>最大 ${num(send.maxTroops)}人</button></div><p id="troop-garrison-send-limit" class="troop-garrison-note">派遣できる人数は${num(send.maxTroops)}人までです。</p>${quoteMarkup(send)}<button type="submit" class="troop-garrison-button is-primary"${disabled(!send.ok)}>この城へ兵を派遣する</button></form></section>
 <section class="troop-garrison-section"><div class="troop-garrison-section-heading"><h2>自分の駐留部隊</h2><span>${num(data.garrisons.length)}か所</span></div><p class="troop-garrison-note">帰還は拠点の空き容量に関係なく受け入れます。現在の受入枠はあと${num(data.army.recallCapacity)}人です。保有上限に収まらない兵は駐留を続けます。</p><div class="troop-garrison-list">${data.garrisons.map(row=>{const q=transferPreview(state,'recall',row.castleId),id='troop-garrison-recall-'+row.castleId;return `<article class="troop-garrison-card" data-stable-key="garrison-${esc(row.castleId)}"><header><div><span>${row.majorCity?'大都市の駐留部隊':'駐留部隊'}</span><h3>${esc(row.castleName)}</h3></div><strong>${num(row.troops)}<small>人</small></strong></header>${!row.canSend&&row.sendReason?`<p class="troop-garrison-note">${esc(row.sendReason)}</p>`:''}<form data-garrison-form="recall" data-castle="${esc(row.castleId)}" novalidate><label for="${esc(id)}">本隊へ戻す人数</label><div class="troop-garrison-amount"><input id="${esc(id)}" type="number" inputmode="numeric" min="1" max="${q.maxTroops}" step="1" value="${esc(state.recallAmounts[row.castleId]??'1')}" data-garrison-amount="recall" data-castle="${esc(row.castleId)}"${disabled(locked)}><span>人</span><button type="button" class="troop-garrison-button is-small" data-garrison="max-recall" data-castle="${esc(row.castleId)}"${disabled(locked||q.maxTroops<1)}>最大 ${num(q.maxTroops)}人</button></div>${quoteMarkup(q)}<button type="submit" class="troop-garrison-button"${disabled(!q.ok)}>本隊へ戻す</button></form></article>`;}).join('')||'<p class="troop-garrison-empty-note">空城に駐留している自分の兵はいません。</p>'}</div></section>`;
}
function createUI(options={}){
 const doc=options.document||global.document;let dialog,body,feedback,pending,controller,returnFocus,lastOpen=false,disposed=false,pollTimer=null;
 const later=options.setTimeout||global.setTimeout?.bind(global),cancel=options.clearTimeout||global.clearTimeout?.bind(global);
 const patch=(node,html)=>{if(!node)return;if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(node,html,{key:'troop-garrisons',preserveInputs:false});else if(node.innerHTML!==html)node.innerHTML=html;};
 function render(state){
  options.onChange?.(state);if(!dialog)return;
  if(!state.open){if(dialog.open)dialog.close();if(lastOpen){lastOpen=false;if(returnFocus?.isConnected)returnFocus.focus?.({preventScroll:true});}return;}
  if(!dialog.open){dialog.showModal();global.SengokuSocialViewport?.refresh?.();}
  const scrollTop=body.scrollTop;patch(body,pageMarkup(state));body.scrollTop=scrollTop;
  const message=state.error||state.message;feedback.hidden=!message;feedback.dataset.error=String(Boolean(state.error));feedback.setAttribute('role',state.error?'alert':'status');feedback.textContent=message;
  pending.hidden=!state.pending;
  if(state.pending)patch(pending,`<strong>${state.sending?'兵の移動結果を確認しています':'結果を確認してから、次の操作へ進めます'}</strong><p>${state.pending.action==='send'?'派遣':'帰還'} ${num(state.pending.data.troops)}人。同じ処理の結果を確認し、兵や指令を重ねて消費しません。</p><button type="button" class="troop-garrison-button" data-garrison="retry"${disabled(state.sending||!state.access.writable)}>同じ操作の結果を確認</button>`);
  dialog.querySelector('[data-garrison="refresh"]').disabled=state.loading||state.sending;
  if(!lastOpen){lastOpen=true;dialog.querySelector('#troop-garrison-title')?.focus?.({preventScroll:true});}
 }
 function ensure(){
  if(dialog||!doc?.body)return;
  dialog=doc.createElement('dialog');dialog.id='troop-garrison-dialog';dialog.className='troop-garrison-dialog';dialog.setAttribute('aria-labelledby','troop-garrison-title');
  dialog.innerHTML='<header class="troop-garrison-header"><div><span>交易の間 · 兵の配置</span><h1 id="troop-garrison-title" tabindex="-1">空城への兵の派遣</h1></div><button type="button" class="troop-garrison-button is-small" data-garrison="refresh">更新</button><button type="button" class="troop-garrison-close" data-garrison="close" aria-label="兵の派遣を閉じる">×</button></header><div class="troop-garrison-feedback" data-garrison-feedback role="status" hidden></div><div class="troop-garrison-pending" data-garrison-pending hidden></div><main class="troop-garrison-body" data-garrison-body></main><footer class="troop-garrison-footer">派遣・帰還に指令1回 · 駐留兵は派遣した領主の部隊です</footer>';
  doc.body.append(dialog);body=dialog.querySelector('[data-garrison-body]');feedback=dialog.querySelector('[data-garrison-feedback]');pending=dialog.querySelector('[data-garrison-pending]');
  dialog.addEventListener('click',event=>{const node=event.target.closest?.('[data-garrison]');if(!node||node.disabled||!dialog.contains(node))return;event.preventDefault();const action=node.dataset.garrison;if(action==='close')controller.close();else if(action==='refresh')controller.refresh();else if(action==='retry')controller.retry();else if(action==='max-send')controller.maximum('send');else if(action==='max-recall')controller.maximum('recall',node.dataset.castle);else if(action==='register'){controller.close();global.SengokuSocial?.open?.('sync');}});
  dialog.addEventListener('input',event=>{const node=event.target;if(node.hasAttribute('data-garrison-amount'))controller.setAmount(node.value,node.dataset.garrisonAmount==='recall'?node.dataset.castle:null);});
  dialog.addEventListener('change',event=>{if(event.target.hasAttribute('data-garrison-destination'))controller.setDestination(event.target.value);});
  dialog.addEventListener('submit',event=>{const form=event.target.closest?.('[data-garrison-form]');if(!form)return;event.preventDefault();if(form.dataset.garrisonForm==='send')controller.send();else controller.recall(form.dataset.castle);});
  dialog.addEventListener('cancel',event=>{event.preventDefault();controller.close();});dialog.addEventListener('close',()=>{if(controller.getState().open)controller.close();});
 }
 controller=createController({...options,onChange:render});
 async function poll(){if(disposed)return;const state=controller.getState();if(state.open&&!doc?.hidden&&!state.sending)await controller.refresh({quiet:true});if(!disposed&&later)pollTimer=later(poll,15000);}
 async function open(){if(disposed)return false;ensure();if(!dialog)return false;returnFocus=doc.activeElement;global.SengokuTrade?.close?.();global.SengokuSocial?.close?.();const result=await controller.open();if(!pollTimer&&options.autoPoll!==false&&later)pollTimer=later(poll,15000);return result;}
 return{open,close:()=>controller.close(),getState:()=>controller.getState(),refreshIdentity:()=>controller.refreshIdentity(),controller,dispose:()=>{disposed=true;cancel?.(pollTimer);controller.dispose();dialog?.remove();}};
}
let instance;const ensure=()=>instance||(instance=createUI());
const api={createController,createUI,cleanSnapshot,cleanResult,transferPreview,pageMarkup,open:()=>ensure().open(),close:()=>instance?.close(),getState:()=>instance?.getState(),refreshIdentity:()=>instance?.refreshIdentity(),dispose:()=>{instance?.dispose();instance=null;}};
global.SengokuTroopGarrisons=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
