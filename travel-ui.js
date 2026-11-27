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
// Compare arrival order in real waiting time even when a world clock is paused
// or accelerated. Zero still means confirmation is due, never a settled battle.
function arrivalDelay(march,clock={}){const left=remainingMs(march,clock);return !left||march.timeBasis==='real'?left:clock.running===false?Infinity:left/(finite(clock.speed)&&clock.speed>0?clock.speed:1);}
function countdown(march,clock={}){const remaining=remainingMs(march,clock),arrival=march.phase==='returning'?'帰還':'到着';return remaining===0?arrival+'を確認中':march.timeBasis==='world'&&clock.running===false?'共通時間が停止中 · 残り '+formatDuration(remaining):arrival+'まで '+formatDuration(remaining);}
function countdownMarkup(value,clock={}){const march=cleanMarch(value);return march?`<strong data-march-countdown="${esc(march.id)}" data-march-arrives="${march.arrivesAtMs}" data-march-basis="${march.timeBasis}" data-march-phase="${march.phase}">${esc(countdown(march,clock))}</strong>`:'';}
const stages=Object.freeze({all:'すべて',outbound:'進軍中',returning:'帰還中',history:'到着・戦果'});
const orders=Object.freeze({arrival:'到着が近い順',troops:'兵数が多い順',distance:'距離が近い順'});
function searchText(value){return String(value??'').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-0x60));}
function cleanFilters(value={}){return{stage:Object.hasOwn(stages,value.stage)?value.stage:'all',kind:Object.hasOwn(kinds,value.kind)?value.kind:'all',order:Object.hasOwn(orders,value.order)?value.order:'arrival',query:typeof value.query==='string'?value.query.slice(0,100):''};}
function filterMarches(rows,filters={},clock={}){
 const f=cleanFilters(filters),words=searchText(f.query).trim().split(/\s+/).filter(Boolean);
 const matching=(Array.isArray(rows)?rows:[]).filter(m=>m&&Object.hasOwn(kinds,m.kind)&&(f.kind==='all'||m.kind===f.kind)&&(f.stage==='all'||f.stage==='history'&&m.status!=='marching'||f.stage==='outbound'&&m.status==='marching'&&m.phase!=='returning'||f.stage==='returning'&&m.status==='marching'&&m.phase==='returning')&&words.every(word=>searchText([m.sourceName,m.targetName,kinds[m.kind]].join(' ')).includes(word)));
 return matching.sort((a,b)=>{
  if(f.order==='troops'&&a.troops!==b.troops)return b.troops-a.troops;
  if(f.order==='distance'&&a.distanceKm!==b.distanceKm)return a.distanceKm-b.distanceKm;
  if(a.status==='marching'&&b.status==='marching')return arrivalDelay(a,clock)-arrivalDelay(b,clock)||a.id.localeCompare(b.id);
  if(a.status!==b.status&&(a.status==='marching'||b.status==='marching'))return a.status==='marching'?-1:1;
  // World elapsed time cannot be compared with an epoch timestamp. Completed
  // records keep the authoritative store's order unless a metric was chosen.
  return 0;
 });
}
function progress(march,clock={}){
 if(march.status!=='marching')return 100;
 const duration=march.arrivesAtMs-march.departedAtMs,left=remainingMs(march,clock);
 return duration>0?Math.max(0,Math.min(100,Math.floor((1-left/duration)*100))):left===0?100:0;
}
function waitingLabel(march,clock={}){
 if(march.status==='cancelled')return '出陣は取り消されました。';
 if(march.status==='resolved')return march.phase==='returning'?'帰還が確認されました。':'到着が確認されました。';
 if(remainingMs(march,clock)===0)return '結果が届くまで、この部隊の到着は未確定です。';
 if(march.timeBasis==='real')return '実時間で進行';
 if(clock.running===false)return '共通時間を再開すると移動が進みます。';
 if(!finite(clock.elapsedMs)||!finite(clock.speed)||clock.speed===0)return '共通時間で進行 · 速度の確定後に待ち時間を表示';
 return '実時間の目安 約'+formatDuration(arrivalDelay(march,clock))+' · 共通時間 '+clock.speed+'倍速';
}
function summarize(data={},clock={}){
 const active=Array.isArray(data.active)?data.active:[],history=Array.isArray(data.history)?data.history:[];
 return{active:active.length,outbound:active.filter(m=>m.phase!=='returning').length,returning:active.filter(m=>m.phase==='returning').length,awaiting:active.filter(m=>remainingMs(m,clock)===0).length,troops:active.reduce((total,m)=>total+(finite(m.troops)?m.troops:0),0),history:history.length,wins:history.filter(m=>m.status==='resolved'&&m.battle?.won===true).length,losses:history.filter(m=>m.status==='resolved'&&m.battle?.won===false).length};
}
function boardMarkup(data,filters={},clock={}){
 const f=cleanFilters(filters),active=filterMarches(data.active,f,clock),history=filterMarches(data.history,f,clock),filtered=f.query.trim()||f.kind!=='all'||f.stage!=='all';
 const card=m=>`<li data-stable-key="march-${esc(m.id)}"><div class="travel-card-heading"><span class="travel-kind">${esc(m.phase==='returning'?'部隊の帰還':kinds[m.kind])}</span><span class="travel-clock-tag">${m.timeBasis==='real'?'実時間':'共通時間'}</span></div><h4>${esc(m.sourceName)} → ${esc(m.targetName)}</h4><p>${m.distanceKm.toLocaleString('ja-JP',{maximumFractionDigits:1})} km · ${m.troops.toLocaleString('ja-JP')}人</p><strong data-travel-countdown="${esc(m.id)}">${esc(countdown(m,clock))}</strong><progress max="100" value="${progress(m,clock)}" data-travel-progress="${esc(m.id)}" aria-label="${esc(m.targetName)}への移動進捗"></progress><small data-travel-wait="${esc(m.id)}">${esc(waitingLabel(m,clock))}</small></li>`;
 const report=m=>`<li data-stable-key="report-${esc(m.id)}"><div class="travel-card-heading"><span class="travel-kind">${esc(kinds[m.kind])}</span><span class="travel-result-tag${m.status==='resolved'&&m.battle?m.battle.won?' is-victory':' is-retreat':''}">${esc(m.status==='cancelled'?'取消':m.battle?m.battle.won?'勝利':'撤退':m.phase==='returning'?'帰還':'到着')}</span></div><h4>${esc(m.targetName)}</h4><p>${esc(m.sourceName)}から · ${m.troops.toLocaleString('ja-JP')}人</p><button class="button small" data-travel-report="${esc(m.id)}">${m.status==='cancelled'?'詳細を確認':m.battle?'戦果を確認':'結果を確認'}</button></li>`;
 const empty=!active.length&&!history.length?`<p class="travel-empty">${filtered?'条件に合う部隊はありません。城名や絞り込みを変更してください。':'進軍中の部隊はありません。'}</p>`:'';
 return `<p class="travel-explainer">出陣済みの部隊は軍師AIを停止しても進みます。共通時間の停止・速度は、共通時間で移動する部隊に反映されます。</p><p class="travel-result-count" data-travel-result-count role="status">${active.length}隊が移動中 · 到着記録 ${history.length}件${filtered?'（絞り込み中）':''}</p>${active.length?`<h3>進軍中の部隊</h3><ul class="travel-list">${active.map(card).join('')}</ul>`:''}${history.length?`<h3>到着した部隊 <small>保管中の最新${data.history.length}件から表示</small></h3><ul class="travel-list travel-history">${history.map(report).join('')}</ul>`:''}${empty}`;
}
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
  snapshot(clock={}){const all=new Map(local);for(const [key,value] of remote)all.set(key,newer(all.get(key),value));const rows=[...all.values()];return{active:rows.filter(m=>m.status==='marching').sort((a,b)=>arrivalDelay(a,clock)-arrivalDelay(b,clock)||a.id.localeCompare(b.id)),history:rows.filter(m=>m.status!=='marching').sort((a,b)=>b.arrivesAtMs-a.arrivesAtMs).slice(0,30)};}
 };
}
const headlessStore=createStore();
const api={cleanTravel,cleanMarch,acceptedMarch,completedMarch,commandMarch,formatDuration,remainingMs,arrivalDelay,countdown,countdownMarkup,preview,createStore,cleanFilters,filterMarches,progress,waitingLabel,summarize,boardMarkup,accept:(result,requestId)=>headlessStore.accept(result,requestId),record:value=>headlessStore.record(value),ingest:(payload,options)=>headlessStore.ingest(payload?.marches||payload,options),snapshot:clock=>headlessStore.snapshot(clock),refresh(){},open(){},subscribe(listener){if(typeof listener==='function')listener(headlessStore.snapshot(),{});return()=>{};}};
global.SengokuTravelUI=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
if(!global.document?.createElement)return;
const doc=global.document,subscribers=new Set(),countdownNodes=new Set();
let options={},store=createStore(),launcher=null,dialog=null,returnFocus=null,polling=false,pollAt=0,serverOffset=0,scope='',seen=new Set(),previousActive=new Set(),initialized=false,selectedReport=null;
let refreshTimer=null,countdownObserver=null,countdownTracking=false,renderedShape='',dialogCounters=[],dialogProgress=[],dialogWaits=[],filters=cleanFilters();
function context(){return options.getContext?.()||{};}
function clocks(){const clock=global.SengokuWorldClock?.snapshot?.()?.clock;return{elapsedMs:clock?.elapsedMs??options.getElapsedMs?.(),running:clock?.running,speed:clock?.speed,realNowMs:Date.now()+serverOffset};}
function checkScope(){const current=context(),next=String(current.scope||'');if(scope!==next){scope=next;store.reset(next);seen.clear();previousActive.clear();initialized=false;selectedReport=null;filters=cleanFilters();renderedShape='';pollAt=0;serverOffset=0;close();syncControls();}return current;}
// Capture each local/remote state once within an update. Never retain a local
// save snapshot across an asynchronous request, an action or a clock tick.
function capture(){const current=checkScope(),clock=clocks();store.local(options.getLocal?.()||[]);return{current,clock,data:store.snapshot(clock)};}
function snapshot(){return capture().data;}
function text(node,value){if(node.textContent!==value)node.textContent=value;}
function trackCountdowns(root){if(root?.matches?.('[data-march-countdown]'))countdownNodes.add(root);for(const node of root?.querySelectorAll?.('[data-march-countdown]')||[])countdownNodes.add(node);}
function startCountdownTracking(){
 if(countdownTracking)return;countdownTracking=true;trackCountdowns(doc.body);
 if(global.MutationObserver){countdownObserver=new global.MutationObserver(records=>{for(const record of records){if(record.type==='attributes'){const node=record.target;if(node.hasAttribute('data-march-countdown'))countdownNodes.add(node);else countdownNodes.delete(node);}else for(const node of record.addedNodes||[])if(node.nodeType===1)trackCountdowns(node);}for(const node of countdownNodes)if(!node.isConnected)countdownNodes.delete(node);});countdownObserver.observe(doc.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-march-countdown']});}
}
function updateCountdowns(data,clock){
 // Browsers without MutationObserver keep the existing fallback. Normally only
 // newly mounted subtrees are scanned, not the entire application every second.
 if(!countdownObserver){countdownNodes.clear();trackCountdowns(doc.body);}
 const active=new Map(data.active.map(row=>[row.id,row]));
 for(const node of countdownNodes){
  if(!node.isConnected){countdownNodes.delete(node);continue;}
  if(node.closest('[hidden],[inert],dialog:not([open])'))continue;
  const march=active.get(node.dataset.marchCountdown);
  if(march)text(node,countdown(march,clock));
  else if(finite(Number(node.dataset.marchArrives))&&['world','real'].includes(node.dataset.marchBasis))text(node,countdown({status:'marching',arrivesAtMs:Number(node.dataset.marchArrives),timeBasis:node.dataset.marchBasis,phase:node.dataset.marchPhase},clock));
 }
 return active;
}
function scheduleRefresh(){
 if(refreshTimer!==null)global.clearTimeout?.(refreshTimer);refreshTimer=null;
 if(!doc.hidden&&options.getContext&&global.setTimeout)refreshTimer=global.setTimeout(()=>{refreshTimer=null;refresh();},1000);
}
function notify(frame){for(const listener of subscribers){try{listener(frame.data,frame.clock);}catch(_){}}}
function genericReport(march){const b=march.battle,n=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP'),message=b?.battleMode==='reward'?(b.won?'合戦に勝利しました。獲得した報酬を確認できます。':'合戦から撤退しました。兵力と兵糧を整えて再び出陣できます。'):march.message||'到着結果を反映しました。';return `<section class="travel-report"><h3>${esc(march.targetName)} · ${march.status==='cancelled'?'出陣の取り消し':b?b.won?'戦勝の報せ':'撤退の報せ':'到着の報せ'}</h3><p>${esc(message)}</p>${b?`<dl><div><dt>出陣兵</dt><dd>${n(b.ourBefore??b.deployed??b.troops??march.troops)}人</dd></div><div><dt>自軍の損失</dt><dd>${n(b.ourLost??b.attackerLost)}人</dd></div><div><dt>敵軍の損失</dt><dd>${n(b.enemyLost??b.defenderLost?.troops??b.defenderLost)}人</dd></div></dl>${b.rewards?`<p>戦利品 ${Object.entries(b.rewards).filter(([key,value])=>['gold','rice','wood','stone','magatama'].includes(key)&&Number(value)>0).map(([key,value])=>esc(({gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'})[key])+' '+n(value)).join(' / ')||'なし'}</p>`:''}`:''}${march.returnPendingTroops||march.returnPendingSupplies?`<p class="travel-return-pending">帰還待ち：兵 ${n(march.returnPendingTroops)}人 / 物資 ${n(march.returnPendingSupplies)}。保有上限の空きができると反映されます。</p>`:''}<button class="button" data-travel-back>進軍一覧へ</button></section>`;}
function syncControls(){
 if(!dialog)return;
 for(const key of ['query','kind','order']){const node=dialog.querySelector('[data-travel-filter="'+key+'"]');if(node&&node.value!==filters[key])node.value=filters[key];}
 for(const button of dialog.querySelectorAll('[data-travel-stage]'))button.setAttribute('aria-pressed',String(button.dataset.travelStage===filters.stage));
}
function resetFilters(){filters=cleanFilters();syncControls();selectedReport=null;paint();}
function changeFilter(event){
 const node=event.target,key=node?.dataset?.travelFilter;
 if(!['query','kind','order'].includes(key)||event.isComposing)return;
 filters=cleanFilters({...filters,[key]:node.value});selectedReport=null;paint();
}
function ensure(){
 if(!launcher){launcher=doc.createElement('button');launcher.type='button';launcher.className='travel-launcher';launcher.setAttribute('aria-haspopup','dialog');launcher.setAttribute('aria-label','進軍中の部隊と戦果を確認');launcher.addEventListener('click',open);doc.body.appendChild(launcher);}
 if(!dialog){
  dialog=doc.createElement('dialog');dialog.className='travel-dialog';dialog.setAttribute('aria-labelledby','travel-title');
  dialog.innerHTML=`<header><div><small>作戦状況</small><h2 id="travel-title">進軍と戦果</h2></div><button type="button" class="button small" data-travel-close>閉じる</button></header><div class="travel-tools"><div class="travel-summary" aria-label="部隊の状況"><div><span>移動中の兵</span><strong data-travel-summary="troops">0人</strong></div><div><span>帰還中</span><strong data-travel-summary="returning">0隊</strong></div><div><span>到着を確認中</span><strong data-travel-summary="awaiting">0隊</strong></div></div><div class="travel-stage-tabs" role="group" aria-label="移動状況で絞り込み">${Object.entries(stages).map(([key,label])=>`<button type="button" data-travel-stage="${key}" aria-pressed="${key==='all'}">${label}<span data-travel-stage-count="${key}"></span></button>`).join('')}</div><div class="travel-filters"><div class="travel-search"><label for="travel-query">城・任務を検索</label><input id="travel-query" type="search" maxlength="100" placeholder="出発地・目的地の城名" data-travel-filter="query" autocomplete="off"><button type="button" class="button small" data-travel-input-list aria-label="出発地・目的地の一覧から選ぶ">一覧</button></div><label><span>任務</span><select data-travel-filter="kind"><option value="all">すべての任務</option>${Object.entries(kinds).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><label><span>並び順</span><select data-travel-filter="order">${Object.entries(orders).map(([key,label])=>`<option value="${key}">${label}</option>`).join('')}</select></label><button type="button" class="button small" data-travel-reset>絞り込み解除</button></div></div><div class="travel-body"></div>`;
  dialog.addEventListener('click',event=>{
   if(event.target===dialog&&typeof event.clientX==='number'){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom){close();return;}}
   const button=event.target.closest?.('[data-travel-close],[data-travel-report],[data-travel-back],[data-travel-stage],[data-travel-reset],[data-travel-input-list]');if(!button||!dialog.contains(button))return;
   if(button.hasAttribute('data-travel-close'))return close();
   if(button.hasAttribute('data-travel-reset'))return resetFilters();
   if(button.hasAttribute('data-travel-input-list')){
    const {data,clock}=capture(),owner=scope,places=new Map();
    for(const march of filterMarches([...data.active,...data.history],{...filters,query:''},clock)){
     for(const [name,role] of [[march.sourceName,'出発地'],[march.targetName,'目的地']]){
      if(!name)continue;
      if(!places.has(name))places.set(name,new Set());
      places.get(name).add(role);
     }
    }
    const candidates=Array.from(places,([name,roles])=>({value:name,label:name,detail:Array.from(roles).join('・')}));
    global.SengokuInputList?.open({trigger:button,title:'進軍・帰還の拠点一覧',options:candidates,
     emptyText:'この条件に合う進軍・帰還の記録がありません。',valid:()=>dialog.open&&String(context().scope||'')===owner,
     onSelect(option){const input=dialog.querySelector('[data-travel-filter="query"]');input.value=option.value;input.dispatchEvent(new Event('input',{bubbles:true}));}});
    return;
   }
   if(button.hasAttribute('data-travel-stage')){filters=cleanFilters({...filters,stage:button.dataset.travelStage});selectedReport=null;syncControls();paint();return;}
   if(button.hasAttribute('data-travel-back')){selectedReport=null;paint();return;}
   const frame=capture(),march=frame.data.history.find(row=>row.id===button.dataset.travelReport);if(!march)return;selectedReport=march;
   if(options.onReport?.(clone(march))===true){close();return;}paint(frame);
  });
  dialog.addEventListener('input',event=>{if(event.target?.dataset?.travelFilter==='query')changeFilter(event);});
  dialog.addEventListener('compositionend',changeFilter);
  dialog.addEventListener('change',event=>{if(event.target?.dataset?.travelFilter!=='query')changeFilter(event);});
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});doc.body.appendChild(dialog);syncControls();
 }
 startCountdownTracking();
}
function renderSummary(data,clock){
 const totals=summarize(data,clock);
 for(const key of ['troops','returning','awaiting'])text(dialog.querySelector('[data-travel-summary="'+key+'"]'),totals[key].toLocaleString('ja-JP')+(key==='troops'?'人':'隊'));
 const counts={all:totals.active+totals.history,outbound:totals.outbound,returning:totals.returning,history:totals.history};
 for(const key of Object.keys(stages))text(dialog.querySelector('[data-travel-stage-count="'+key+'"]'),String(counts[key]));
 dialog.querySelector('.travel-tools').hidden=!!selectedReport;
}
function render(frame){
 ensure();if(doc.hidden)return;
 const {current,data,clock}=frame;launcher.hidden=current.started===false||global.SENGOKU_AT_TITLE===true||!data.active.length&&!data.history.length;
 if(!launcher.hidden)text(launcher,data.active.length?`進軍中 ${data.active.length}隊 · ${countdown(data.active[0],clock)}`:'到着した部隊の結果を確認');
 const active=updateCountdowns(data,clock);
 if(!dialog.open)return;
 const body=dialog.querySelector('.travel-body');if(selectedReport)selectedReport=data.history.find(m=>m.id===selectedReport.id)||selectedReport;
 // Include every displayed field, but no changing countdown, in the structure
 // key. A corrected result with the same id must still repaint its report.
 const shape=JSON.stringify(selectedReport||[filters,data.active.map(m=>[m.id,m.kind,m.phase,m.arrivesAtMs,m.timeBasis,m.troops,m.sourceName,m.targetName,m.distanceKm]),data.history.map(m=>[m.id,m.kind,m.status,m.phase,m.sourceName,m.targetName,m.troops,m.distanceKm,!!m.battle,m.battle?.won])]);
 renderSummary(data,clock);
 if(renderedShape!==shape){
 const html=selectedReport?genericReport(selectedReport):boardMarkup(data,filters,clock);
  const scroll=body.scrollTop,focused=doc.activeElement,reportFocus=body.contains(focused)?focused?.dataset?.travelReport:null,backFocus=body.contains(focused)&&focused?.hasAttribute?.('data-travel-back');
  if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(body,html);else body.innerHTML=html;
  renderedShape=shape;dialogCounters=[...body.querySelectorAll('[data-travel-countdown]')];dialogProgress=[...body.querySelectorAll('[data-travel-progress]')];dialogWaits=[...body.querySelectorAll('[data-travel-wait]')];body.scrollTop=scroll;
  if(reportFocus||backFocus){const next=[...body.querySelectorAll('[data-travel-report],[data-travel-back]')].find(node=>backFocus?node.hasAttribute('data-travel-back'):node.dataset.travelReport===reportFocus);if(next&&doc.activeElement!==next)next.focus({preventScroll:true});}
 }
 for(const node of dialogCounters){const march=active.get(node.dataset.travelCountdown);if(march)text(node,countdown(march,clock));}
 for(const node of dialogProgress){const march=active.get(node.dataset.travelProgress);if(march){const value=String(progress(march,clock));if(node.getAttribute('value')!==value)node.setAttribute('value',value);}}
 for(const node of dialogWaits){const march=active.get(node.dataset.travelWait);if(march)text(node,waitingLabel(march,clock));}
}
function paint(frame=capture()){render(frame);notify(frame);return frame;}
function open(){const frame=capture();ensure();returnFocus=doc.activeElement;selectedReport=null;if(!dialog.open)dialog.showModal();paint(frame);scheduleRefresh();}
function close(){if(dialog?.open)dialog.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
async function poll(force=false){
 const current=checkScope();if(polling||!current.linked||!current.ready||!options.request||global.document.hidden||!force&&Date.now()-pollAt<10000)return;
 const expected=scope;polling=true;pollAt=Date.now();try{const result=await options.request();if(expected!==String(context().scope||''))return;if(result?.ok!==true)return;
 const serverNow=typeof result.serverNow==='string'?Date.parse(result.serverNow):result.serverNow;if(Number.isFinite(serverNow))serverOffset=serverNow-Date.now();
 store.ingest(result);const frame=paint();options.onChange?.(frame.data);
 }catch(_){/* Show the existing march until its authoritative result is known. */}finally{polling=false;}
}
function refresh(){
 const frame=capture();for(const row of frame.data.history){if(initialized&&!seen.has(row.id))options.onArrival?.(clone(row),previousActive.has(row.id));seen.add(row.id);}initialized=true;
 // An initial server poll may include old reports. Sound only a march observed in flight.
 previousActive.clear();if(!doc.hidden)for(const row of frame.data.active)previousActive.add(row.id);
 paint(frame);scheduleRefresh();void poll();
}
Object.assign(api,{
 configure(next){options={...options,...next};refresh();},refresh,open,close,snapshot,
 // Views subscribe while open and reuse this update's read-only data, avoiding
 // a second per-second timer and a second export of all local journeys.
 subscribe(listener){if(typeof listener!=='function')return()=>{};subscribers.add(listener);const frame=capture();try{listener(frame.data,frame.clock);}catch(_){}return()=>subscribers.delete(listener);},
 record(value){checkScope();const march=store.record(value);if(march)paint();return march;},
 accept(result,requestId){checkScope();const march=store.accept(result,requestId);if(march){paint();void poll(true);}return march;},
 ingest(payload,{kind}={}){checkScope();const serverNow=typeof payload?.serverNow==='string'?Date.parse(payload.serverNow):payload?.serverNow;if(Number.isFinite(serverNow))serverOffset=serverNow-Date.now();const result=store.ingest(payload?.marches||payload,{kind});paint();return result;},poll
});
// The game clock normally calls refresh. Each call rearms this fallback, so a
// guarded/stopped simulation still updates travel without two permanent timers.
doc.addEventListener?.('visibilitychange',()=>{if(doc.hidden){previousActive.clear();scheduleRefresh();}else if(options.getContext)refresh();});
})(typeof window!=='undefined'?window:globalThis);
