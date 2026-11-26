/* Shared travel presentation. Only the engine/server can settle an arrival. */
(function(global){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_:-]{1,160}$/.test(value)?value:'';
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const clone=value=>JSON.parse(JSON.stringify(value));
const kinds={castle:'城への出陣',branch:'支拠点への出陣',field:'共通フィールド',roaming:'野良兵への出陣',rally:'同盟の集結軍',conquest:'天下争覇',covert:'部隊の派遣'};
function cleanTravel(value){
 if(!value||!id(value.sourceCastleId)||!id(value.targetCastleId)||!finite(value.distanceKm)||value.distanceKm>25000||!finite(value.durationMs)||value.durationMs>31*86400000)return null;
 const name=(value,key,castleId)=>String(value[key]||global.SengokuTravel?.coordinates?.[castleId]?.name||castleId).slice(0,120);
 return{sourceCastleId:value.sourceCastleId,targetCastleId:value.targetCastleId,sourceName:name(value,'sourceName',value.sourceCastleId),targetName:name(value,'targetName',value.targetCastleId),distanceKm:value.distanceKm,durationMs:value.durationMs};
}
function cleanMarch(value){
 if(!value||!id(value.id)||!Object.hasOwn(kinds,value.kind))return null;
 const phase=value.phase==='returning'?'returning':'outbound',travel=cleanTravel(value.travel?{...value.travel,...(phase==='outbound'?{sourceName:value.sourceName||value.travel.sourceName,targetName:value.targetName||value.travel.targetName}:{})}:value),status=value.status||'marching',timeBasis=value.timeBasis||'world';
 const departedAtMs=value.departedAtMs??value.departedElapsedMs,arrivesAtMs=value.arrivesAtMs??value.arrivesElapsedMs;
 if(!travel||!['marching','resolved','cancelled'].includes(status)||!['world','real'].includes(timeBasis)||!finite(departedAtMs)||!finite(arrivesAtMs)||arrivesAtMs<departedAtMs||arrivesAtMs-departedAtMs>31*86400000)return null;
 if(value.battle!=null&&(typeof value.battle!=='object'||Array.isArray(value.battle)||typeof value.battle.won!=='boolean'))return null;
 return{id:value.id,authority:value.authority==='local'?'local':'server',requestId:id(value.requestId||value.options?.requestId),kind:value.kind,status,phase,timeBasis,travel,...travel,departedAtMs,arrivesAtMs,remainingMs:finite(value.remainingMs)?value.remainingMs:null,troops:finite(value.troops)?Math.floor(value.troops):0,tactic:typeof value.tactic==='string'?value.tactic.slice(0,40):'',campaignId:id(value.campaignId),message:typeof value.message==='string'?value.message.slice(0,1000):'',actorPlayerId:id(String(value.actorPlayerId||value.playerId||'')),returnPendingTroops:finite(value.returnPendingTroops)?Math.floor(value.returnPendingTroops):0,returnPendingSupplies:finite(value.returnPendingSupplies)?Math.floor(value.returnPendingSupplies):0,battle:value.battle?clone(value.battle):null,receipt:value.receipt&&typeof value.receipt==='object'?clone(value.receipt):null};
}
function acceptedMarch(result,requestId){
 if(result?.ok!==true||result.accepted!==true||result.marching!==true)return null;
 const march=cleanMarch(result.march);
 if(!march||march.status!=='marching'||requestId&&march.requestId!==requestId)return null;
 return march;
}
function completedMarch(result,requestId){
 if(result?.ok!==true||result.marching===true)return null;
 const march=cleanMarch(result.march?{...result.march,battle:result.march.battle??result.battle}:null);
 if(!march||!['resolved','cancelled'].includes(march.status)||requestId&&march.requestId!==requestId||march.status==='resolved'&&march.kind!=='covert'&&!march.battle)return null;
 return march;
}
function commandMarch(result,requestId){return acceptedMarch(result,requestId)||completedMarch(result,requestId);}
function formatDuration(ms){if(global.SengokuTravel?.formatDuration)return global.SengokuTravel.formatDuration(ms);const seconds=Math.max(0,Math.ceil((Number(ms)||0)/1000));return seconds>=60?Math.floor(seconds/60)+'分'+seconds%60+'秒':seconds+'秒';}
function remainingMs(march,clock={}){
 if(march.status!=='marching')return 0;
 const now=march.timeBasis==='real'?clock.realNowMs:clock.elapsedMs;
 return finite(now)?Math.max(0,march.arrivesAtMs-now):Math.max(0,march.remainingMs??march.durationMs);
}
function countdown(march,clock={}){const remaining=remainingMs(march,clock),arrival=march.phase==='returning'?'帰還':'到着';return remaining===0?arrival+'を確認中':march.timeBasis==='world'&&clock.running===false?'共通時間が停止中 · 残り '+formatDuration(remaining):arrival+'まで '+formatDuration(remaining);}
function countdownMarkup(value,clock={}){const march=cleanMarch(value);return march?`<strong data-march-countdown="${esc(march.id)}" data-march-arrives="${march.arrivesAtMs}" data-march-basis="${march.timeBasis}" data-march-phase="${march.phase}">${esc(countdown(march,clock))}</strong>`:'';}
function preview(value,{timeBasis='world',compact=false,purpose='battle'}={}){
 const travel=cleanTravel(value);if(!travel)return '';
 const action={battle:'到着後に合戦を行います。',scout:'到着後に調査し、帰路へ向かいます。帰還するまで再派遣できません。',station:'到着後に常駐を開始します。',return:'派遣元へ到着してから、部隊を再び使えます。',aid:'到着後に仲間の城の防衛へ加わります。',rally:'集結地点へ到着してから、集結軍へ加わります。'}[purpose]||'到着後に任務を開始します。';
 return `<div class="travel-preview${compact?' compact':''}"><span class="travel-route"><b>${esc(travel.sourceName)}</b><span aria-label="から">→</span><b>${esc(travel.targetName)}</b></span><span class="travel-metrics"><span>距離 <strong>${travel.distanceKm.toLocaleString('ja-JP',{maximumFractionDigits:1})} km</strong></span><span>移動 <strong>${esc(formatDuration(travel.durationMs))}</strong></span></span><small>${timeBasis==='real'?'実時間':'共通時間'}で移動し、${action}${timeBasis==='real'?'':'時間の速度・停止に連動します。'}</small></div>`;
}
function createStore(){
 let scope='',remote=new Map(),local=new Map();
 const newer=(previous,incoming)=>previous&&(previous.status!=='marching'&&incoming.status==='marching'||previous.phase==='returning'&&incoming.phase==='outbound')?previous:incoming;
 function record(value){const clean=cleanMarch(value);if(!clean)return null;const m=newer(remote.get(clean.id)||local.get(clean.id),clean);(m.authority==='local'?local:remote).set(m.id,m);return m;}
 return{
  reset(next=''){if(scope!==next){scope=next;remote.clear();local.clear();}},scope:()=>scope,record,
  local(rows){local=new Map((rows||[]).map(cleanMarch).filter(Boolean).map(m=>[m.id,m]));},
  accept(result,requestId){const m=acceptedMarch(result,requestId);return m?record(m):null;},
  ingest(payload,{kind}={}){
   if(!payload||!Array.isArray(payload.active)||!Array.isArray(payload.history)||payload.active.length+payload.history.length>1200)return false;
   const rows=[...payload.active,...payload.history].map(cleanMarch);if(rows.some(m=>!m))return false;
   const previous=new Map(remote);for(const [key,value] of remote)if(!kind||value.kind===kind)remote.delete(key);
   for(const row of rows)if(!kind||row.kind===kind)remote.set(row.id,newer(previous.get(row.id)||local.get(row.id),row));return true;
  },
  snapshot(){const all=new Map(local);for(const [key,value] of remote)all.set(key,newer(all.get(key),value));const rows=[...all.values()];return{active:rows.filter(m=>m.status==='marching').sort((a,b)=>(a.remainingMs??a.durationMs)-(b.remainingMs??b.durationMs)),history:rows.filter(m=>m.status!=='marching').sort((a,b)=>b.arrivesAtMs-a.arrivesAtMs).slice(0,30)};}
 };
}
const headlessStore=createStore();
const api={cleanTravel,cleanMarch,acceptedMarch,completedMarch,commandMarch,formatDuration,remainingMs,countdown,countdownMarkup,preview,createStore,accept:(result,requestId)=>headlessStore.accept(result,requestId),record:value=>headlessStore.record(value),ingest:(payload,options)=>headlessStore.ingest(payload?.marches||payload,options),snapshot:()=>headlessStore.snapshot(),refresh(){},open(){}};
global.SengokuTravelUI=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(!global.document?.createElement)return;
let options={},store=createStore(),launcher=null,dialog=null,returnFocus=null,polling=false,pollAt=0,serverOffset=0,scope='',seen=new Set(),initialized=false,selectedReport=null;
function context(){return options.getContext?.()||{};}
function clocks(){const clock=global.SengokuWorldClock?.snapshot?.()?.clock;return{elapsedMs:clock?.elapsedMs??options.getElapsedMs?.(),running:clock?.running,realNowMs:Date.now()+serverOffset};}
function checkScope(){const current=context(),next=String(current.scope||'');if(scope!==next){scope=next;store.reset(next);seen.clear();initialized=false;selectedReport=null;pollAt=0;close();}return current;}
function snapshot(){checkScope();store.local(options.getLocal?.()||[]);return store.snapshot();}
function genericReport(march){const b=march.battle,n=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');return `<section class="travel-report"><h3>${esc(march.targetName)} · ${march.status==='cancelled'?'出陣の取り消し':b?b.won?'戦勝の報せ':'撤退の報せ':'到着の報せ'}</h3><p>${esc(march.message||'到着結果を反映しました。')}</p>${b?`<dl><div><dt>出陣兵</dt><dd>${n(b.ourBefore??b.deployed??b.troops??march.troops)}人</dd></div><div><dt>自軍の損失</dt><dd>${n(b.ourLost??b.attackerLost)}人</dd></div><div><dt>敵軍の損失</dt><dd>${n(b.enemyLost??b.defenderLost?.troops??b.defenderLost)}人</dd></div></dl>${b.rewards?`<p>戦利品 ${Object.entries(b.rewards).filter(([key,value])=>['gold','rice','wood','stone','magatama'].includes(key)&&Number(value)>0).map(([key,value])=>esc(({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'})[key])+' '+n(value)).join(' / ')||'なし'}</p>`:''}`:''}${march.returnPendingTroops||march.returnPendingSupplies?`<p class="travel-return-pending">帰還待ち：兵 ${n(march.returnPendingTroops)}人 / 物資 ${n(march.returnPendingSupplies)}。保有上限の空きができると反映されます。</p>`:''}<button class="button" data-travel-back>進軍一覧へ</button></section>`;}
function ensure(){
 if(!launcher){launcher=global.document.createElement('button');launcher.type='button';launcher.className='travel-launcher';launcher.setAttribute('aria-haspopup','dialog');launcher.setAttribute('aria-label','進軍中の部隊と戦果を確認');launcher.addEventListener('click',open);global.document.body.appendChild(launcher);}
 if(!dialog){dialog=global.document.createElement('dialog');dialog.className='travel-dialog';dialog.setAttribute('aria-labelledby','travel-title');dialog.innerHTML='<header><div><small>出陣状況</small><h2 id="travel-title">進軍と戦果</h2></div><button class="button small" data-travel-close>閉じる</button></header><div class="travel-body"></div>';dialog.addEventListener('click',event=>{const button=event.target.closest('[data-travel-close],[data-travel-report],[data-travel-back]');if(!button)return;if(button.hasAttribute('data-travel-close'))return close();if(button.hasAttribute('data-travel-back')){selectedReport=null;render();return;}const march=snapshot().history.find(row=>row.id===button.dataset.travelReport);if(!march)return;selectedReport=march;if(options.onReport?.(clone(march))===true){close();return;}render();});dialog.addEventListener('cancel',event=>{event.preventDefault();close();});global.document.body.appendChild(dialog);}
}
function render(){
 const current=checkScope();ensure();const data=snapshot(),clock=clocks();launcher.hidden=current.started===false||global.SENGOKU_AT_TITLE===true||!data.active.length&&!data.history.length;
 const label=data.active.length?`進軍中 ${data.active.length}隊 · ${countdown(data.active[0],clock)}`:'到着した部隊の結果を確認';if(launcher.textContent!==label)launcher.textContent=label;
 for(const node of global.document.querySelectorAll('[data-march-countdown]')){const m=data.active.find(row=>row.id===node.dataset.marchCountdown);if(m)node.textContent=countdown(m,clock);else if(finite(Number(node.dataset.marchArrives))&&['world','real'].includes(node.dataset.marchBasis))node.textContent=countdown({status:'marching',arrivesAtMs:Number(node.dataset.marchArrives),timeBasis:node.dataset.marchBasis,phase:node.dataset.marchPhase},clock);}
 if(!dialog.open)return;
 const body=dialog.querySelector('.travel-body');if(selectedReport)selectedReport=data.history.find(m=>m.id===selectedReport.id)||selectedReport;
 const html=selectedReport?genericReport(selectedReport):`<p class="travel-explainer">距離に応じて移動します。出陣済みの部隊は、軍師AIを停止しても到着まで進軍を続けます。</p>${data.active.length?`<h3>進軍中</h3><ul class="travel-list">${data.active.map(m=>`<li><span class="travel-kind">${esc(m.phase==='returning'?'部隊の帰還':kinds[m.kind])}</span><h4>${esc(m.sourceName)} → ${esc(m.targetName)}</h4><p>${m.distanceKm.toLocaleString('ja-JP',{maximumFractionDigits:1})} km · ${m.troops.toLocaleString('ja-JP')}人</p><strong data-travel-countdown="${esc(m.id)}">${esc(countdown(m,clock))}</strong></li>`).join('')}</ul>`:'<p class="travel-empty">進軍中の部隊はありません。</p>'}${data.history.length?`<h3>到着した部隊</h3><ul class="travel-list">${data.history.map(m=>`<li><span class="travel-kind">${esc(kinds[m.kind])}</span><h4>${esc(m.targetName)}</h4><p>${esc(m.status==='cancelled'?'出陣を取り消しました':m.battle?m.battle.won?'勝利しました':'撤退しました':m.phase==='returning'?'帰還しました':'到着しました')}</p><button class="button small" data-travel-report="${esc(m.id)}">${m.status==='cancelled'?'詳細を確認':m.battle?'戦果を確認':'結果を確認'}</button></li>`).join('')}</ul>`:''}`;
 // Keep the focused report/close button and scroll position during countdowns.
 const shape=JSON.stringify([selectedReport?.id,selectedReport?.returnPendingTroops,selectedReport?.returnPendingSupplies,data.active.map(m=>[m.id,m.phase,m.arrivesAtMs,m.troops,m.sourceCastleId,m.targetCastleId]),data.history.map(m=>[m.id,m.status,m.phase])]);
 if(body.dataset.shape!==shape){const scroll=body.scrollTop,focused=global.document.activeElement,reportFocus=body.contains(focused)?focused?.dataset?.travelReport:null,backFocus=body.contains(focused)&&focused?.hasAttribute?.('data-travel-back');if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(body,html);else body.innerHTML=html;body.dataset.shape=shape;body.scrollTop=scroll;if(reportFocus||backFocus){const next=[...body.querySelectorAll('[data-travel-report],[data-travel-back]')].find(node=>backFocus?node.hasAttribute('data-travel-back'):node.dataset.travelReport===reportFocus);if(next&&global.document.activeElement!==next)next.focus({preventScroll:true});}}else for(const node of body.querySelectorAll('[data-travel-countdown]')){const m=data.active.find(row=>row.id===node.dataset.travelCountdown);if(m)node.textContent=countdown(m,clock);}
}
function open(){ensure();returnFocus=global.document.activeElement;selectedReport=null;if(!dialog.open)dialog.showModal();render();}
function close(){if(dialog?.open)dialog.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
async function poll(force=false){
 const current=checkScope();if(polling||!current.linked||!current.ready||!options.request||global.document.hidden||!force&&Date.now()-pollAt<10000)return;
 const expected=scope;polling=true;pollAt=Date.now();try{const result=await options.request();if(expected!==String(context().scope||''))return;if(result?.ok!==true)return;
 const serverNow=typeof result.serverNow==='string'?Date.parse(result.serverNow):result.serverNow;if(Number.isFinite(serverNow))serverOffset=serverNow-Date.now();
 store.ingest(result);render();options.onChange?.(store.snapshot());
 }catch(_){/* Show the existing march until its authoritative result is known. */}finally{polling=false;}
}
function refresh(){const data=snapshot();for(const row of data.history){if(initialized&&!seen.has(row.id))options.onArrival?.(clone(row));seen.add(row.id);}initialized=true;render();poll();}
Object.assign(api,{configure(next){options={...options,...next};refresh();},refresh,open,close,snapshot,record(value){checkScope();const march=store.record(value);if(march)render();return march;},accept(result,requestId){checkScope();const march=store.accept(result,requestId);if(march){render();poll(true);}return march;},ingest(payload,{kind}={}){checkScope();const serverNow=typeof payload?.serverNow==='string'?Date.parse(payload.serverNow):payload?.serverNow;if(Number.isFinite(serverNow))serverOffset=serverNow-Date.now();const result=store.ingest(payload?.marches||payload,{kind});render();return result;},poll});
global.setInterval?.(()=>{if(!global.document.hidden&&options.getContext)refresh();},1000);
})(typeof window!=='undefined'?window:globalThis);
