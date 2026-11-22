/* Foreground, explicitly started tactical automation for the local world map. */
(function(global){
'use strict';
const clone=value=>JSON.parse(JSON.stringify(value));
function createController(options={}){
 const win=options.window||global,doc=options.document||win.document||{},bridge=typeof options.bridge==='function'?options.bridge:()=>options.bridge||win.SengokuBridge;
 const now=options.now||(()=>win.performance?.now?.()??Date.now()),later=options.setTimeout||win.setTimeout?.bind(win),cancel=options.clearTimeout||win.clearTimeout?.bind(win),interval=Math.max(8000,Number(options.intervalMs)||8000);
 const listeners=new Set();if(options.onChange)listeners.add(options.onChange);
 let active=false,starting=false,pending=false,disposed=false,epoch=0,runId=null,runScope='',phase='idle',message='作戦を入力して、軍師の判断を確かめましょう。',draft='',proposal=null,history=[],timer=null,startTask=null,nextAt=0;
 function access(){return bridge()?.getStrategyAccess?.()||{scopeId:'',canRun:false,canAct:false,message:'ゲームの進行を確認してください。'};}
 function visible(){return doc.hidden!==true&&doc.visibilityState!=='hidden';}
 function snapshot(){const a=access();return{active,starting,pending,phase,message,draft,proposal:proposal?clone(proposal):null,history:clone(history),canStart:a.canAct===true&&!pending&&!starting,startBlockedReason:!active&&!starting&&!pending&&!a.canAct?a.message||'現在の進行を確認しています。':'',nextInMs:active&&nextAt?Math.max(0,nextAt-now()):0};}
 function emit(){const value=snapshot();for(const listener of listeners){try{listener(value);}catch(_){}}return value;}
 function cancelTimer(){if(timer!==null){cancel?.(timer);timer=null;}nextAt=0;}
 function stop(why='user',text){const oldRun=runId;active=false;starting=false;runId=null;epoch++;cancelTimer();phase=why==='complete'?'complete':'paused';message=text||'次の自動出陣を停止しました。すでに出陣した部隊は、到着まで進軍を続けます。';if(oldRun)bridge()?.stopStrategy?.(oldRun);emit();return{ok:true};}
 function refreshAccess(){if(disposed)return;const a=access(),awaitingOwnResult=pending&&a.scopeId===runScope&&(a.runId===null||a.reason==='defeat');if((active||starting)&&(!visible()||a.scopeId!==runScope||!a.canRun&&!(awaitingOwnResult&&a.reason==='defeat')||runId&&a.runId!==undefined&&a.runId!==runId&&!awaitingOwnResult)){stop('access',!visible()?'画面が非表示のため自動進軍を停止しました。再表示しても自動では再開しません。':a.scopeId!==runScope?'領主・役職・物語が変わったため、自動進軍を停止しました。':a.message);return;}emit();}
 function preview(text){if(active||starting||pending)return{ok:false,message:'作戦を変更するには、先に自動進軍を停止してください。'};draft=String(text||'').trim();
  try{proposal=bridge()?.previewStrategy?.(draft)||{ok:false,message:'軍師AIを読み込めませんでした。'};phase=proposal.ok?'ready':'invalid';message=proposal.ok?(proposal.decision?.reason||proposal.message||'軍師の判断を確認してから開始してください。'):proposal.message||'作戦の意図を読み取れませんでした。';emit();return clone(proposal);}
  catch(error){proposal=null;phase='invalid';message=error.message||'作戦を確認できませんでした。';emit();return{ok:false,message};}
 }
 function schedule(delay=interval){cancelTimer();if(disposed||!active)return;nextAt=now()+delay;timer=later?.(()=>{timer=null;nextAt=0;tick();},delay);emit();}
 async function tick(){
  if(disposed||!active||pending)return;refreshAccess();if(!active)return;const a=access();
  if(!a.canAct){phase='waiting';message=a.message||'次の出陣機会を待っています。';schedule();return;}
  const g=epoch,id=runId;pending=true;phase='acting';message='現在の戦況を評価し、出陣と保存を確認しています。';emit();
  try{
   const result=await bridge().stepStrategy(id);
   if(disposed||g!==epoch||!active||runId!==id||access().scopeId!==runScope)return;
   if(result?.decision&&proposal){proposal.decision=clone(result.decision);if(result.executed&&result.confirmed!==false&&result.nextDecision?.progress)proposal.decision.progress=clone(result.nextDecision.progress);}
   if(result?.executed){const battle=result.battle||{};history.unshift({marchId:result.marchId||result.march?.id||'',marching:result.marching===true,castleName:battle.castleName||result.decision?.castleName||'拠点',won:typeof battle.won==='boolean'?battle.won:null,confirmed:result.confirmed!==false,ourLost:Number(battle.ourLost)||0,tacticName:result.decision?.tacticName||'',message:result.message||''});history=history.slice(0,8);}
   if(result?.arrived){const row=history.find(item=>item.marchId===result.marchId);if(row){row.marching=false;row.cancelled=result.cancelled===true;row.won=typeof result.battle?.won==='boolean'?result.battle.won:null;row.ourLost=Number(result.battle?.ourLost)||0;row.confirmed=true;row.message=result.message||'';}}
   if(!result?.ok||result.stop||result.shouldStop||result.executed&&result.battle?.won===false){stop(result?.ok?'complete':'error',result?.message||result?.decision?.reason||'作戦の実行を終了しました。');return;}
   phase=result.marching?'marching':result.executed?'active':'waiting';message=result.message||result.decision?.reason||'次の出陣に向けて戦況を見守っています。';
  }catch(error){if(g===epoch&&!disposed)stop('error',error.message||'自動進軍を停止しました。最新の進行を確認してください。');}
  finally{pending=false;if(!disposed){emit();if(active&&g===epoch)schedule();}}
 }
 function start(text){
  if(disposed)return Promise.resolve({ok:false});if(starting)return startTask;if(active||pending)return Promise.resolve({ok:false});
  const a=access();if(!visible()||!a.canAct){phase='paused';message=a.message||'この画面を表示してから開始してください。';emit();return Promise.resolve({ok:false});}
  draft=String(text||'').trim();starting=true;runScope=a.scopeId;const g=++epoch;phase='starting';message='作戦を現在の戦況で確認しています。';emit();
  const task=Promise.resolve().then(async()=>{try{
   if(disposed||g!==epoch||!visible()||access().scopeId!==runScope)return{ok:false,stale:true};
   const result=await bridge().beginStrategy(draft);
   if(disposed||g!==epoch||!visible()||access().scopeId!==runScope){if(result?.runId)bridge()?.stopStrategy?.(result.runId);return{ok:false,stale:true};}
   if(!result?.ok||!result.runId){proposal=result||null;phase='invalid';message=result?.message||'作戦を開始できませんでした。';return{ok:false};}
   runId=result.runId;proposal=clone(result);active=true;starting=false;history=[];phase='active';message='自動進軍を開始しました。8秒以上の間隔で現在の戦況を評価します。';schedule(0);return{ok:true};
  }catch(error){if(g===epoch&&!disposed){phase='invalid';message=error.message||'作戦を開始できませんでした。';}return{ok:false,error};}
  finally{if(g===epoch)starting=false;if(startTask===task)startTask=null;emit();}});startTask=task;return task;
 }
 function onVisibility(){if(!visible()&&(active||starting))stop('hidden','画面が非表示のため自動進軍を停止しました。再開は手動で行ってください。');else refreshAccess();}
 function onPageHide(){if(active||starting)stop('hidden','ページを閉じたため自動進軍を停止しました。');}
 doc.addEventListener?.('visibilitychange',onVisibility);win.addEventListener?.('pagehide',onPageHide);
 const subscriptions=[];for(const subscribe of [options.subscribeAccess||win.SengokuCloudSync?.subscribe?.bind(win.SengokuCloudSync),options.subscribeClock||win.SengokuWorldClock?.subscribe?.bind(win.SengokuWorldClock)])if(subscribe){const off=subscribe(refreshAccess);if(typeof off==='function')subscriptions.push(off);}
 return{start,stop,preview,refreshAccess,getState:snapshot,subscribe:fn=>{listeners.add(fn);fn(snapshot());return()=>listeners.delete(fn);},dispose(){if(disposed)return;stop('dispose');disposed=true;epoch++;doc.removeEventListener?.('visibilitychange',onVisibility);win.removeEventListener?.('pagehide',onPageHide);for(const off of subscriptions)off();listeners.clear();}};
}
const api={createController};if(typeof module!=='undefined'&&module.exports)module.exports=api;global.SengokuStrategy=api;
if(!global.document?.createElement)return;
let live=null,dialog=null,returnFocus=null,off=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const num=value=>Number.isFinite(Number(value))?Math.round(Number(value)).toLocaleString('ja-JP'):'—';
const icon=name=>`<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${name==='close'?'m6 6 12 12M6 18 18 6':'M4 3h13a3 3 0 0 1 3 3v15H6a3 3 0 0 1 0-6h14M4 3v15M8 7h8M8 11h6'}"/></svg>`;
function controller(){if(!live){live=createController({window:global});off=live.subscribe(render);}return live;}
function text(selector,value){const element=dialog?.querySelector(selector);if(element&&element.textContent!==String(value))element.textContent=value;}
function proposalHTML(proposal){
 if(!proposal)return '<div class="strategy-empty">作戦を入力すると、対象・戦法・兵数と判断理由をここに表示します。</div>';
 if(!proposal.ok)return `<div class="strategy-empty">${esc(proposal.message||'作戦の意図を確認してください。')}</div>`;
 const decision=proposal.decision||{},policy=proposal.policy||{},summary=Array.isArray(proposal.summary)?proposal.summary.join(' / '):proposal.summary||'',progress=decision.progress||{};
 return `<section class="strategy-plan"><div class="strategy-plan-heading"><span>軍師の判断</span><b>${decision.action==='attack'?'出陣候補':decision.action==='wait'?'機を待つ':'進軍を停止'}</b></div>${summary?`<p class="strategy-summary">${esc(summary)}</p>`:''}<p class="strategy-reason">${esc(decision.reason||proposal.message||'現在の戦況を確認しています。')}</p>${decision.action==='attack'?`<h3>${esc(decision.castleName)}</h3><div class="strategy-decision-grid"><div><span>戦法</span><b>${esc(decision.tacticName)}</b></div><div><span>出陣兵</span><b>${num(decision.troops)}<small>人</small></b></div><div><span>予想勝率</span><b>${num(decision.winChance)}<small>%</small></b></div><div><span>必要な兵糧</span><b>${num(decision.foodCost)}</b></div></div>${global.SengokuTravelUI?.preview(decision.travel)||''}`:''}<div class="strategy-limits"><span>出陣上限 <b>${num(progress.maxBattles??policy.maxBattles)}回</b></span><span>この作戦 <b>${num(progress.battles||0)}回</b> 出陣済み</span></div>${Array.isArray(proposal.warnings)&&proposal.warnings.length?`<p class="strategy-warning">${proposal.warnings.map(esc).join('<br>')}</p>`:''}<p class="strategy-risk">勝率は現在の戦力による予測です。出陣には指令・兵糧を使い、合戦では兵を失うことがあります。</p></section>`;
}
function render(value){
 for(const label of global.document.querySelectorAll?.('[data-strategy-status]')||[])label.textContent=value.active?'自動進軍 実行中':value.phase==='complete'?'作戦を終了':'作戦を考える';
 for(const button of global.document.querySelectorAll?.('[data-strategy-stop]')||[])button.hidden=!value.active;
 if(!dialog)return;dialog.dataset.phase=value.phase;text('[data-strategy-message]',value.startBlockedReason||value.message);text('[data-strategy-phase]',value.active?'自動進軍中':value.starting?'作戦を確認中':'自動進軍 停止中');
 const area=dialog.querySelector('#strategy-text'),start=dialog.querySelector('[data-strategy-action="start"]'),stop=dialog.querySelector('[data-strategy-action="stop"]');area.disabled=value.active||value.starting||value.pending;
 for(const button of dialog.querySelectorAll('[data-strategy-preset],[data-strategy-action="preview"]'))button.disabled=value.active||value.starting||value.pending;
 start.hidden=value.active;start.disabled=!value.canStart||!value.proposal?.ok||value.proposal?.decision?.action==='stop'||value.draft.trim()!==area.value.trim();start.title=value.startBlockedReason||'開始時に現在の戦況を評価し直します。';start.textContent=value.starting?'作戦を確認中…':'この作戦で自動進軍を開始';stop.hidden=!value.active&&!value.starting;stop.disabled=false;
 const plan=dialog.querySelector('[data-strategy-plan]'),html=proposalHTML(value.proposal);if(plan.innerHTML!==html)plan.innerHTML=html;
 const history=dialog.querySelector('[data-strategy-history]'),historyHTML=value.history.length?value.history.map(item=>`<li class="${item.marching||item.confirmed===false?'pending':item.won?'won':'lost'}"><span>${item.marching?'進軍中':item.cancelled?'取消':item.confirmed===false?'同期待ち':item.won?'占領':'撤退'}</span><div><b>${esc(item.castleName)}</b><small>${esc(item.tacticName)}${item.marching?' · 到着後に合戦':item.cancelled?'':` · 損失 ${num(item.ourLost)}人`}</small></div></li>`).join(''):'<li class="strategy-history-empty">この作戦の出陣結果はここに残ります。</li>';if(history.innerHTML!==historyHTML)history.innerHTML=historyHTML;
}
function close(){dialog?.close();if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;}
function open(){
 const current=controller();current.refreshAccess();if(!dialog){dialog=global.document.createElement('dialog');dialog.className='strategy-dialog';dialog.setAttribute('aria-labelledby','strategy-title');
  dialog.innerHTML=`<div class="strategy-shell"><header class="strategy-header"><div><span class="eyebrow">TACTICAL COUNCIL</span><h2 id="strategy-title">${icon('book')}軍師AI</h2></div><button class="icon-button" data-strategy-action="close" aria-label="軍師AIを閉じる">${icon('close')}</button></header><div class="strategy-body"><span class="strategy-phase" data-strategy-phase>自動進軍 停止中</span><h3 class="strategy-lead">目指す戦い方を、<br>軍師に伝える。</h3><p class="strategy-intro">作戦文と現在の戦況を評価する軍師AIが、<strong>天下地図の隣接城</strong>への攻め方を判断します。</p><label for="strategy-text">あなたの作戦</label><textarea id="strategy-text" maxlength="500" rows="4" placeholder="例：兵を温存して弱い城から攻める。3回まで。兵1000を残す。"></textarea><div class="strategy-presets"><button class="button small" data-strategy-preset="兵を温存して弱い城から攻める。3回まで。兵1000を残す。">堅実に広げる</button><button class="button small" data-strategy-preset="速攻で周りの城を攻める。5回まで。">速攻で進軍</button><button class="button small" data-strategy-preset="攻めるな。0回。">進軍を止める</button></div><button class="button strategy-preview" data-strategy-action="preview">${icon('book')}作戦を評価する</button><div data-strategy-plan></div><p class="strategy-message" data-strategy-message role="status"></p><section class="strategy-history"><h3>この作戦の出陣</h3><ol data-strategy-history></ol></section><div class="strategy-notes"><p>画面を開いている間、8秒以上の間隔で戦況を評価します。出陣後は到着・戦果の確定まで待機し、敗戦・出陣上限・目標達成で終了します。</p><p>この窓を閉じても、ゲーム画面が前景なら進軍は続きます。軍議・天下地図の「停止」で次の自動出陣を止められます。出陣済みの部隊の移動は続きます。画面の非表示・操作端末の交代・共通時間の停止では停止し、再開は手動です。</p><p>判断にはゲーム内の作戦解析と戦力評価を使います。戦況や作戦文を外部の生成AIへ送信しません。</p></div></div><footer class="strategy-actions"><button class="button gold" data-strategy-action="start" disabled>この作戦で自動進軍を開始</button><button class="button primary" data-strategy-action="stop" hidden>自動進軍を停止</button><button class="button" data-strategy-action="close">ゲーム画面へ</button></footer></div>`;
  global.document.body.appendChild(dialog);
  dialog.addEventListener('click',event=>{const button=event.target.closest('[data-strategy-action],[data-strategy-preset]');if(!button||button.disabled)return;const area=dialog.querySelector('#strategy-text');
   if(button.dataset.strategyPreset){area.value=button.dataset.strategyPreset;current.preview(area.value);return;}
   const action=button.dataset.strategyAction;if(action==='preview')current.preview(area.value);else if(action==='start')current.start(area.value).catch(()=>{});else if(action==='stop')current.stop();else if(action==='close')close();
  });
  dialog.addEventListener('input',event=>{if(event.target.id==='strategy-text')dialog.querySelector('[data-strategy-action="start"]').disabled=true;});
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 }
 returnFocus=global.document.activeElement;render(current.getState());if(!dialog.open)dialog.showModal();
}
Object.assign(api,{open,close,stop:()=>live?.stop(),refreshAccess:()=>live?.refreshAccess(),getState:()=>controller().getState(),dispose:()=>{off?.();live?.dispose();dialog?.remove();dialog=null;live=null;}});
if(global.document.readyState==='loading')global.document.addEventListener('DOMContentLoaded',controller,{once:true});else controller();
})(typeof window!=='undefined'?window:globalThis);
