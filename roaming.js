/* Repeatable CPU encounters; campaign writes belong to the supplied bridge. */
(function(global){
 'use strict';
 const KEY='sengoku-roaming-pending-v1:',RESOURCES={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
 const clone=v=>JSON.parse(JSON.stringify(v)),identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,90}$/.test(v),integer=(v,min=0,max=999999999)=>Number.isSafeInteger(v)&&v>=min&&v<=max;
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const number=v=>Number.isFinite(v)?Number(v).toLocaleString('ja-JP'):'—';
 const payloadOK=d=>d&&identifier(d.encounterId)&&identifier(d.tactic)&&identifier(d.requestId)&&identifier(d.campaignId)&&integer(d.sequence,0,10000000)&&integer(d.troops,300,1000000);
 function cleanBattle(b,d){
  if(!b||!payloadOK(d)||b.requestId!==d.requestId||b.campaignId!==d.campaignId||b.sequence!==d.sequence||b.encounterId!==d.encounterId||b.tactic!==d.tactic||b.deployed!==d.troops||typeof b.won!=='boolean'||b.commandCost!==1||!integer(b.ourLost,0,b.deployed)||b.survivors!==b.deployed-b.ourLost||!integer(b.foodCost)||!integer(b.commandBefore,1,7)||b.commandAfter!==b.commandBefore-1||!b.rewards||Object.keys(RESOURCES).some(k=>!integer(b.rewards[k]))||!integer(b.prestigeGain,0,30))return null;
  if(!integer(b.attackPower,0,1e12)||!integer(b.enemyPower,0,1e12)||!integer(b.enemyTroops,1,1000000)||!integer(b.enemyLost,0,b.enemyTroops)||!integer(b.turn)||typeof b.encounterName!=='string'||b.encounterName.length>100||typeof b.tacticName!=='string'||b.tacticName.length>100)return null;
  return Object.fromEntries(['requestId','campaignId','sequence','encounterId','encounterName','tactic','tacticName','won','deployed','ourLost','survivors','enemyTroops','enemyLost','attackPower','enemyPower','foodCost','commandCost','commandBefore','commandAfter','rewards','prestigeGain','turn'].map(k=>[k,clone(b[k])]));
 }
 function createController(options={}){
  const getGame=options.getGame||(()=>global.SengokuBridge?.getGame?.()),getStatus=options.getStatus||(()=>({writable:false,reason:'本拠を確認しています。'}));
  const request=options.battle||(data=>global.SengokuBridge.roamingBattle(data)),uuid=options.uuid||(()=>global.crypto.randomUUID());
  let storage;try{storage=options.storage??global.localStorage;}catch(_){}
  let disposed=false,stamp='',generation=0,flight=null;
  let state={selectedId:'road_scouts',tactic:'balanced',troopsInput:'1000',confirmation:null,pending:null,sending:false,error:'',message:'',battle:null};
  function context(){const g=getGame(),s=getStatus()||{},campaignId=g?.state?.walking?.campaignId||'',ownerId=String(s.ownerId||'local'),linked=s.linked===true;return{...s,ownerId,campaignId,linked,writable:s.writable===true,online:s.online!==false,stamp:JSON.stringify([ownerId,campaignId,s.stamp??'',linked]),game:g};}
  const key=who=>KEY+encodeURIComponent(who.ownerId)+':'+encodeURIComponent(who.campaignId);
  function readPending(who){try{const r=JSON.parse(storage?.getItem(key(who))||'null');return r?.ownerId===who.ownerId&&r.campaignId===who.campaignId&&payloadOK(r.data)?r:null;}catch(_){return null;}}
  function persist(who,record){if(!storage?.setItem)throw Error('出陣の操作記録を保存できません。ブラウザの保存設定を確認してください。');const value=JSON.stringify(record);storage.setItem(key(who),value);if(storage.getItem(key(who))!==value)throw Error('出陣の操作記録を保存できませんでした。');}
  function clear(who,record){try{if(readPending(who)?.data.requestId===record.data.requestId)storage.removeItem(key(who));}catch(_){} }
  function identity(){const who=context();if(stamp!==who.stamp){stamp=who.stamp;generation++;flight=null;const max=who.game?Math.min(who.game.state.troops,who.game.troopCapacity()):0;state={selectedId:'road_scouts',tactic:'balanced',troopsInput:String(Math.min(1000,Math.max(0,max))),confirmation:null,pending:readPending(who),sending:false,error:'',message:'',battle:null};if(state.pending){state.selectedId=state.pending.data.encounterId;state.tactic=state.pending.data.tactic;state.troopsInput=String(state.pending.data.troops);}}return who;}
  const current=(g,expected)=>!disposed&&g===generation&&context().stamp===expected;
  function preview(who=context()){return who.game?.previewRoamingBattle(state.selectedId,state.tactic,state.troopsInput.trim()===''?NaN:Number(state.troopsInput))||{ok:false,message:'本拠を読み込んでから出陣できます。'};}
  function snapshot(){const who=context(),game=who.game,p=preview(who);return{...clone(state),status:{writable:who.writable,online:who.online,linked:who.linked,ownerId:who.ownerId,reason:who.reason||''},preview:clone(p),encounters:game?.roamingEncounters?.()||[],tactics:clone(game?.data?.roaming?.tactics||[]),army:game?.armyStats?.()||{count:0,lead:0,valor:0,intellect:0},resources:{rice:game?.state?.resources?.rice||0,command:game?.state?.command||0,troops:game?.state?.troops||0,maxTroops:game?Math.min(game.state.troops,game.troopCapacity()):0},history:clone(game?.state?.roaming?.history||[]),wins:game?.state?.roaming?.wins||0,total:game?.state?.roaming?.sequence||0};}
  function emit(){if(!disposed)options.onChange?.(snapshot());}
  const fingerprint=(who,p)=>JSON.stringify([who.campaignId,who.game?.state?.roaming?.sequence,state.selectedId,state.tactic,p.troops,p.attackPower,p.enemyPower,p.foodCost,p.expectedLoss,p.predictedWin]);
  function select(id){const who=identity();if(state.sending||state.pending)return false;if(!who.game?.roamingEncounters().some(e=>e.id===id))return false;state.selectedId=id;state.confirmation=null;state.error='';emit();return true;}
  function setTactic(id){const who=identity();if(state.sending||state.pending||!who.game?.data?.roaming?.tactics.some(t=>t.id===id))return false;state.tactic=id;state.confirmation=null;state.error='';emit();return true;}
  function setTroops(value){identity();if(state.sending||state.pending)return false;state.troopsInput=String(value).slice(0,12);state.confirmation=null;state.error='';emit();return true;}
  function prepare(){const who=identity(),p=preview(who);state.error='';if(state.pending||state.sending)return false;if(!who.writable||who.linked&&!who.online||!p.ok){state.error=who.reason||(!who.online&&who.linked?'接続を確認してから出陣してください。':p.message);emit();return false;}state.confirmation={fingerprint:fingerprint(who,p)};emit();return true;}
  function cancel(){identity();if(!state.sending){state.confirmation=null;emit();}}
  async function submit(){
   const who=identity();if(disposed)return false;if(flight)return flight;
   if(!who.writable||who.linked&&!who.online){state.error=who.reason||'接続と本拠の保存状態を確認してから出陣してください。';emit();return false;}
   let record=state.pending;
   if(!record){const p=preview(who);if(!state.confirmation||!p.ok||state.confirmation.fingerprint!==fingerprint(who,p)){state.confirmation=null;state.error='兵や軍団の状況が変わりました。戦力と費用を確認してください。';emit();return false;}record={ownerId:who.ownerId,campaignId:who.campaignId,data:{encounterId:state.selectedId,tactic:state.tactic,troops:p.troops,requestId:uuid(),campaignId:who.campaignId,sequence:who.game.state.roaming.sequence}};if(!payloadOK(record.data)){state.error='出陣の操作番号を作成できませんでした。';emit();return false;}try{persist(who,record);}catch(e){state.error=e.message;emit();return false;}state.pending=record;}
   const g=generation,expected=stamp;state.sending=true;state.error='';state.message='';state.confirmation=null;emit();
   const operation=(async()=>{
    try{const result=await request(clone(record.data));if(!current(g,expected))return false;
     if(result?.ok!==true)throw Object.assign(Error(result?.message||result?.error?.message||'出陣できませんでした。'),{status:result?.status||409,code:result?.code||result?.error?.code});
     // The bridge may recover its older durable operation after this UI's
     // pending record was lost. Accept its explicit canonical ID only after
     // every campaign, sequence and battle-choice field still matches.
     const effective=identifier(result.effectiveRequestId)?{...record.data,requestId:result.effectiveRequestId}:record.data;
     const b=cleanBattle(result.battle,effective);if(!b)throw Error('戦果を確認できませんでした。同じ出陣の結果を再確認してください。');
     clear(who,record);state.pending=null;state.battle=b;state.message=result.idempotent?'記録済みの戦果を確認しました。追加の消費や報酬はありません。':b.won?'敵部隊を撃退しました。戦果は本拠へ反映済みです。':'部隊は撤退しました。生存兵は本拠へ戻りました。';
     options.onResult?.(result);emit();return true;
    }catch(error){if(!current(g,expected))return false;state.error=error.message||'通信結果を確認できませんでした。';if(Number(error.status)>=400&&Number(error.status)<500&&![408,429].includes(Number(error.status))){clear(who,record);state.pending=null;}return false;}
    finally{if(current(g,expected)){state.sending=false;flight=null;emit();}}
   })();flight=operation;return operation;
  }
  function refresh(){identity();emit();return snapshot();}
  identity();
  return{snapshot,refresh,select,setTactic,setTroops,prepare,cancel,submit,dispose(){disposed=true;generation++;flight=null;}};
 }
 function rewardsMarkup(rewards){return Object.entries(RESOURCES).filter(([k])=>rewards?.[k]>0).map(([k,name])=>`<span>${name} <b>+${number(rewards[k])}</b></span>`).join('')||'<span>獲得報酬なし</span>';}
 function reportMarkup(b){if(!b)return'';return `<section class="roaming-report ${b.won?'is-victory':'is-defeat'}" aria-label="野良兵戦の戦果"><div class="roaming-report-title"><span>${b.won?'勝利':'撤退'}</span><h2>${esc(b.encounterName)}</h2><small>${esc(b.tacticName)}</small></div><div class="roaming-result-grid"><div>出陣兵数<b>${number(b.deployed)}</b></div><div>失った兵<b>${number(b.ourLost)}</b></div><div>帰還兵<b>${number(b.survivors)}</b></div><div>消費兵糧<b>${number(b.foodCost)}</b></div></div><div class="roaming-rewards">${rewardsMarkup(b.rewards)}${b.prestigeGain?`<span>威信 <b>+${number(b.prestigeGain)}</b></span>`:''}</div><p>指令を${b.commandCost}消費。領地の占領・城郭への被害はありません。</p></section>`;}
 function markup(s){
  const p=s.preview,chosen=s.encounters.find(e=>e.id===s.selectedId),locked=s.sending||Boolean(s.pending),ready=s.status.writable&&(!s.status.linked||s.status.online)&&p.ok,canRetry=s.status.writable&&(!s.status.linked||s.status.online)&&!s.sending;
  const art=e=>global.SengokuArt?.facility?.(e.art,'roaming-illustration',Math.min(32,4+e.tier*4))||'';
  return `<section class="roaming-page" aria-label="野良兵戦"><header class="roaming-heading"><div><span class="eyebrow">FIELD ENCOUNTERS · CPU</span><h1>野良兵戦</h1><p>街道や山野の兵士と戦い、軍団の力を試す。</p></div><div class="roaming-record"><b>${number(s.wins)}</b>勝 <span>/ ${number(s.total)}戦</span></div></header><div class="roaming-supplies"><span>指令 <b>${number(s.resources.command)}</b></span><span>兵糧 <b>${number(s.resources.rice)}</b></span><span>本拠の兵 <b>${number(s.resources.troops)}</b></span><span>軍団 <b>${number(s.army.count)}名</b></span></div><details class="roaming-help"><summary>野良兵戦の遊び方・消費と報酬</summary><ol><li>強さと兵種の違う6部隊から相手を選びます。同じ部隊に何度でも挑戦できます。</li><li>出陣兵数と戦術を選び、軍団の統率・武勇・知略を含む戦力を確認します。軍団は「軍団編成」で変更できます。</li><li>1回につき指令1と表示された兵糧を消費し、勝敗に応じて兵を失います。勝利時は資源・勾玉・威信を獲得します。</li><li>戦力比較で勝敗が決まります。領地は占領せず、攻城戦の任務や自動出陣の回数には加算されません。</li></ol><p>指令回復は通常の共通時間に従います。通信が途切れた場合は「同じ出陣の結果を確認」で安全に再確認できます。</p><button type="button" class="button" data-view="army">軍団編成を開く</button></details><div class="roaming-encounters" role="group" aria-label="戦うCPU部隊">${s.encounters.map(e=>`<button type="button" class="roaming-enemy ${e.id===s.selectedId?'is-selected':''}" data-roaming-action="select" data-roaming-id="${esc(e.id)}" aria-pressed="${e.id===s.selectedId}" ${locked?'disabled':''}>${art(e)}<span class="roaming-enemy-copy"><small>強さ ${e.tier} / 6 · ${esc(e.terrain)} · ${esc(e.units)}</small><strong>${esc(e.name)}</strong><span>敵兵 ${number(e.enemyTroops)}人</span></span></button>`).join('')}</div><section class="roaming-preparation" aria-label="出陣準備"><div><span class="eyebrow">SELECTED ENCOUNTER</span><h2>${esc(chosen?.name||'相手を選択')}</h2><p>${esc(chosen?.description||'')}</p><div class="roaming-rewards" aria-label="勝利時の基本報酬">${rewardsMarkup(chosen?.rewards)}</div><small>報酬は所持上限まで反映されます。</small></div><div class="roaming-controls"><label for="roaming-troops">出陣兵数 <span>300〜${number(s.resources.maxTroops)}人</span></label><input id="roaming-troops" class="input" type="number" inputmode="numeric" min="300" max="${s.resources.maxTroops}" step="1" value="${esc(s.troopsInput)}" ${locked?'disabled':''}><div class="roaming-troop-shortcuts"><button type="button" class="button" data-roaming-action="half" ${locked?'disabled':''}>半数</button><button type="button" class="button" data-roaming-action="all" ${locked?'disabled':''}>出陣可能な全兵</button></div><label for="roaming-tactic">戦術</label><select id="roaming-tactic" class="select" ${locked?'disabled':''}>${s.tactics.map(t=>`<option value="${esc(t.id)}"${t.id===s.tactic?' selected':''}>${esc(t.name)}</option>`).join('')}</select><p class="roaming-tactic-description">${esc(s.tactics.find(t=>t.id===s.tactic)?.description||'')}</p></div></section><section class="roaming-forecast" aria-label="戦力と消費"><div><span>自軍の戦力</span><b>${number(p.attackPower)}</b></div><div><span>敵軍の戦力</span><b>${number(p.enemyPower||chosen?.enemyPower)}</b></div><div><span>指令 / 兵糧</span><b>1 / ${number(p.foodCost)}</b></div><div><span>予想損失</span><b>${number(p.expectedLoss)}人</b></div><p class="${p.predictedWin?'is-favored':'is-danger'}">${p.attackPower?`${p.predictedWin?'勝利見込み':'敗北見込み'} · 現在の軍団・兵数・戦術による判定`:'出陣兵数を指定してください。'}</p></section>${s.error?`<p class="notice roaming-error" role="alert">${esc(s.error)}</p>`:''}${s.message?`<p class="notice" role="status">${esc(s.message)}</p>`:''}${s.pending?`<div class="roaming-pending"><p>${s.sending?'出陣の結果を確認しています。':'結果が未確認の出陣があります。同じ操作番号で確認し、二重消費を防ぎます。'}</p><button type="button" class="button gold full" data-roaming-action="submit" ${!canRetry?'disabled':''}>${s.sending?'戦果を確認中…':'同じ出陣の結果を確認'}</button></div>`:s.confirmation?`<div class="roaming-confirm" aria-label="出陣の最終確認"><h3>${esc(chosen?.name)}へ出陣しますか？</h3><p>${number(p.troops)}人が${esc(p.tacticName)}で出陣。指令1・兵糧${number(p.foodCost)}を消費し、予想損失は${number(p.expectedLoss)}人です。</p><div><button type="button" class="button" data-roaming-action="cancel">準備に戻る</button><button type="button" class="button gold" data-roaming-action="submit" ${!ready?'disabled':''}>確定して出陣</button></div></div>`:`<div class="roaming-start"><p>${esc(s.status.reason||(!s.status.online&&s.status.linked?'オンライン接続を確認してください。':!p.ok?p.message:'戦力・消費・兵の損失を確認して出陣してください。'))}</p><button type="button" class="button gold full" data-roaming-action="prepare" ${!ready?'disabled':''}>出陣内容を確認</button></div>`}${reportMarkup(s.battle)}<section class="roaming-history"><h2>野良兵戦の記録 <small>最新20戦</small></h2>${s.history.length?`<ol>${s.history.map(b=>`<li><span class="roaming-history-outcome ${b.won?'is-favored':'is-danger'}">${b.won?'勝利':'撤退'}</span><div><b>${esc(b.encounterName)}</b><small>${esc(b.tacticName)} · 兵${number(b.deployed)}人 / 損失${number(b.ourLost)}人</small></div><span>金銭 +${number(b.rewards.gold)}<br>勾玉 +${number(b.rewards.magatama)}</span></li>`).join('')}</ol>`:'<p class="subtitle">まだ野良兵戦の記録はありません。</p>'}</section></section>`;
 }
 function mount(host,options={}){
  if(!host)return{refresh(){},dispose(){}};
  let alive=true,lastMarkup='',regions=new Map(),focusIntent='',awaitingResultFocus=false;
  const regionKey=el=>el.classList.contains('roaming-error')?'error':el.getAttribute('role')==='status'?'message':/^roaming-(start|pending|confirm)$/.test(el.classList[0])?'action':el.classList[0];
  function focusKey(el){if(!el||!host.contains(el))return null;if(el.id)return{id:el.id};if(el.dataset?.roamingAction)return{action:el.dataset.roamingAction,encounter:el.dataset.roamingId||''};if(el.dataset?.view)return{view:el.dataset.view};if(el.matches?.('.roaming-help summary'))return{help:true};if(el.matches?.('.roaming-confirm,.roaming-pending,.roaming-report'))return{region:el.classList[0]};return null;}
  function findFocus(key){if(!key)return null;if(key.id)return host.querySelector('#'+key.id);if(key.help)return host.querySelector('.roaming-help summary');if(key.region)return host.querySelector('.'+key.region);return [...host.querySelectorAll('button')].find(el=>key.view?el.dataset.view===key.view:el.dataset.roamingAction===key.action&&(el.dataset.roamingId||'')===key.encounter)||null;}
  function patchPreparation(live,fresh){
   if(live.firstElementChild.innerHTML!==fresh.firstElementChild.innerHTML)live.firstElementChild.innerHTML=fresh.firstElementChild.innerHTML;
   // Keep native inputs/selects attached while time, resources or forecasts
   // change. Replacing a focused select can dismiss its browser-owned menu.
   for(const id of ['roaming-troops','roaming-tactic']){const current=live.querySelector('#'+id),next=fresh.querySelector('#'+id);current.disabled=next.disabled;for(const name of ['min','max'])if(next.hasAttribute(name)&&current.getAttribute(name)!==next.getAttribute(name))current.setAttribute(name,next.getAttribute(name));if(current.value!==next.value)current.value=next.value;}
   for(const selector of ['label[for="roaming-troops"] span','.roaming-tactic-description']){const current=live.querySelector(selector),next=fresh.querySelector(selector);if(current.textContent!==next.textContent)current.textContent=next.textContent;}
   for(const action of ['half','all'])live.querySelector('[data-roaming-action="'+action+'"]').disabled=fresh.querySelector('[data-roaming-action="'+action+'"]').disabled;
  }
  function patchEncounters(live,fresh){
   for(const next of fresh.querySelectorAll('[data-roaming-id]')){const current=[...live.querySelectorAll('[data-roaming-id]')].find(el=>el.dataset.roamingId===next.dataset.roamingId);if(!current)return false;current.disabled=next.disabled;current.setAttribute('aria-pressed',next.getAttribute('aria-pressed'));current.classList.toggle('is-selected',next.classList.contains('is-selected'));const copy=current.querySelector('.roaming-enemy-copy'),newCopy=next.querySelector('.roaming-enemy-copy');if(copy.innerHTML!==newCopy.innerHTML)copy.innerHTML=newCopy.innerHTML;}return true;
  }
  function patch(html){
   const template=host.ownerDocument?.createElement?.('template');
   if(!template){host.innerHTML=html;return;}
   template.innerHTML=html;const fresh=template.content.firstElementChild,page=host.querySelector('.roaming-page'),updated=new Map();
   if(!page){host.innerHTML=html;for(const child of fresh.children)updated.set(regionKey(child),child.outerHTML);regions=updated;return;}
   const existing=new Map([...page.children].map(el=>[regionKey(el),el]));
   for(const [index,next] of [...fresh.children].entries()){
    const key=regionKey(next),raw=next.outerHTML;let live=existing.get(key);updated.set(key,raw);
    if(!live||regions.get(key)!==raw){
     if(live&&key==='roaming-preparation')patchPreparation(live,next);
     else if(live&&key==='roaming-encounters'&&patchEncounters(live,next)){}
     else{if(live)live.replaceWith(next);live=next;}
    }
    const at=page.children[index];if(at!==live)page.insertBefore(live,at||null);existing.delete(key);
   }
   for(const old of existing.values())old.remove();regions=updated;
  }
  function render(s){
   if(!alive)return;const html=markup(s);if(lastMarkup===html)return;
   const active=host.ownerDocument?.activeElement,ownedFocus=host.contains(active),locator=focusKey(active),selection=locator?{start:active.selectionStart,end:active.selectionEnd}:null,top=host.scrollTop,helpOpen=host.querySelector('.roaming-help')?.open;
   patch(html);lastMarkup=html;host.scrollTop=top;const help=host.querySelector('.roaming-help');if(help&&helpOpen)help.open=true;
   let next=findFocus(locator);
   if(focusIntent==='confirmation'&&s.confirmation)next=host.querySelector('.roaming-confirm');
   else if(focusIntent==='prepare')next=host.querySelector('[data-roaming-action="prepare"]');
   else if(awaitingResultFocus&&s.battle&&!s.pending){if(ownedFocus||!active||active===host.ownerDocument?.body)next=host.querySelector('.roaming-report');awaitingResultFocus=false;}
   if(s.sending&&(!next||next.disabled)&&locator?.action==='submit')next=host.querySelector('.roaming-pending');
   if(next&&!next.disabled){if(!next.matches?.('button,input,select,summary,[tabindex]'))next.setAttribute?.('tabindex','-1');if(host.ownerDocument?.activeElement!==next)next.focus?.({preventScroll:true});if(typeof selection?.start==='number'&&locator?.id===next.id)try{next.setSelectionRange(selection.start,selection.end);}catch(_){}}
   focusIntent='';global.SengokuArt?.decorate?.();options.onChange?.(s);
  }
  const controller=createController({...options,onChange:render});
  const click=event=>{const button=event.target.closest?.('[data-roaming-action]');if(!button||!host.contains(button)||button.disabled)return;event.preventDefault();const action=button.dataset.roamingAction;if(action==='select')controller.select(button.dataset.roamingId);else if(action==='prepare'){focusIntent='confirmation';controller.prepare();}else if(action==='cancel'){focusIntent='prepare';controller.cancel();}else if(action==='submit'){awaitingResultFocus=true;void controller.submit();}else if(action==='all'||action==='half'){const max=controller.snapshot().resources.maxTroops;controller.setTroops(Math.min(max,Math.max(300,action==='all'?max:Math.floor(max/2))));}};
  const input=event=>{if(event.target.id==='roaming-troops')controller.setTroops(event.target.value);};
  const change=event=>{if(event.target.id==='roaming-tactic')controller.setTactic(event.target.value);};
  host.addEventListener('click',click);host.addEventListener('input',input);host.addEventListener('change',change);controller.refresh();
  return{refresh:()=>controller.refresh(),controller,dispose(){alive=false;controller.dispose();host.removeEventListener('click',click);host.removeEventListener('input',input);host.removeEventListener('change',change);}};
 }
 const api={createController,mount,markup,reportMarkup,cleanBattle};global.SengokuRoaming=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
