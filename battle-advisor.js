/* Shared battle advice presentation. A proposal changes preparation only;
 * each battlefield retains its own preview, confirmation and execution. */
(function(global){
 'use strict';
 const STYLES=Object.freeze({conserve:{name:'兵を温存',minWinChance:85},balanced:{name:'標準',minWinChance:75},rapid:{name:'速度を優先',minWinChance:65}});
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
 const number=value=>finite(value)?Math.round(value).toLocaleString('ja-JP'):'—';
 const styleOf=value=>Object.hasOwn(STYLES,value)?value:'balanced';
 const safeChoice=choice=>({...choice,...(choice.reserveAfter?{reserveAfter:{...choice.reserveAfter}}:{}),...(Array.isArray(choice.reasons)?{reasons:[...choice.reasons]}:{})});

 // Presentation derives only arithmetic from the supplied authoritative
 // preview. An absent reserve or loss estimate stays absent, never zero.
 function readiness(advice={}){
  if(advice?.ok!==true)return null;
  const troops=finite(advice.troops)&&advice.troops>0?advice.troops:null;
  const loss=troops!==null&&finite(advice.estimatedLoss)&&advice.estimatedLoss<=troops?advice.estimatedLoss:null;
  const reserve=advice.reserveAfter&&typeof advice.reserveAfter==='object'?advice.reserveAfter:{};
  const min=finite(advice.minWinChance)&&advice.minWinChance<=100?advice.minWinChance:STYLES[styleOf(advice.style)].minWinChance;
  return{lossRate:loss===null?null:Math.round(loss/troops*1000)/10,survivors:loss===null?null:Math.max(0,Math.round(troops-loss)),reserveTroops:finite(reserve.troops)?reserve.troops:null,reserveFood:finite(reserve.rice)?reserve.rice:null,minWinChance:min,goalMet:advice.deterministic===true?advice.predictedWin===true:finite(advice.winChance)&&advice.winChance>=min,forecast:advice.approximate===true?'公開情報からの推定':advice.deterministic===true?'現在の戦力での判定':'合戦の予測'};
 }
 function readinessMarkup(advice){
  const r=readiness(advice);if(!r)return '';
  const metrics=[];
  if(r.lossRate!==null)metrics.push(`<div><dt>出陣兵の予想損失率</dt><dd>${r.lossRate.toLocaleString('ja-JP')}%</dd><small>予想生還兵 ${number(r.survivors)}人</small></div>`);
  if(r.reserveTroops!==null)metrics.push(`<div><dt>手元に残る兵</dt><dd>${number(r.reserveTroops)}人</dd><small>出陣中に使える予備兵</small></div>`);
  if(r.reserveFood!==null)metrics.push(`<div><dt>出陣後の兵糧</dt><dd>${number(r.reserveFood)}</dd><small>今回の出陣費用を差し引いた量</small></div>`);
  const warnings=[];
  if(r.reserveTroops===0)warnings.push('手元の兵をすべて出陣させる案です。別の出陣に回す予備兵は残りません。');
  if(r.reserveFood===0)warnings.push('今回の出陣で兵糧を使い切る見込みです。次の補給を確認してください。');
  const goal=advice.deterministic===true?(r.goalMet?'現在の条件では勝利予測':'現在の条件では敗北予測'):finite(advice.winChance)?`勝率の目安 ${number(r.minWinChance)}% ${r.goalMet?'に到達':'に未達'}`:'';
  return `<section class="battle-advisor-readiness" aria-label="出陣前の余力確認"><div class="battle-advisor-readiness-heading"><h4>出陣前の余力確認</h4><span>${esc(r.forecast)}</span></div>${goal?`<p class="battle-advisor-goal${r.goalMet?'':' is-below-goal'}">${esc(goal)}</p>`:''}${metrics.length?`<dl>${metrics.join('')}</dl>`:''}${warnings.length?`<ul class="battle-advisor-reserve-warnings">${warnings.map(value=>`<li>${esc(value)}</li>`).join('')}</ul>`:''}</section>`;
 }
 function reserveMarkup(policy, disabled){
  if(!policy)return '';
  const {reserveTroops,reserveRice,troops,rice,assetCap}=policy;
  if(![reserveTroops,reserveRice,troops,rice,assetCap].every(value=>Number.isSafeInteger(value)&&value>=0))return '';
  return `<details class="battle-advisor-reserves" data-stable-key="advisor-reserves">
   <summary>出陣後に残す兵・兵糧 <small>兵 ${number(reserveTroops)}人 ／ 兵糧 ${number(reserveRice)}</small></summary>
   <form data-battle-reserves data-applied-troops="${reserveTroops}" data-applied-rice="${reserveRice}" data-asset-cap="${assetCap}">
    <p>軍師が提案する兵数と戦法の条件です。出陣画面で兵数や戦法を手動変更すると、残る量も変わります。</p>
    <div class="battle-reserve-inputs">
     <label>残す兵数 <input class="input" type="text" inputmode="numeric" maxlength="16" data-battle-reserve="troops" value="${reserveTroops}"${disabled?' disabled':''}><small>手元の兵 ${number(troops)}人</small></label>
     <label>残す兵糧 <input class="input" type="text" inputmode="numeric" maxlength="16" data-battle-reserve="rice" value="${reserveRice}"${disabled?' disabled':''}><small>手元の兵糧 ${number(rice)}</small></label>
    </div>
    <p class="battle-reserve-error" role="alert" data-battle-reserve-error></p>
    <button type="submit" class="button" ${disabled?'disabled':''}>この条件で再提案</button>
   </form>
  </details>`;
 }
 function readReserveForm(form){
  const values={};
  const cap=Number(form.dataset.assetCap);
  const error=form.querySelector('[data-battle-reserve-error]');
  for(const key of ['troops','rice']){
   const input=form.querySelector(`[data-battle-reserve="${key}"]`);
   if(!input||input.disabled)return null;
   const raw=String(input.value).trim().normalize('NFKC'),value=Number(raw);
   if(!/^\d+$/.test(raw)||!Number.isSafeInteger(value)||!Number.isSafeInteger(cap)||value>cap){
    const details=form.closest('details');
    if(details)details.open=true;
    input.setAttribute('aria-invalid','true');
    error.textContent=`${key==='troops'?'残す兵数':'残す兵糧'}に0〜${number(cap)}の整数を入力してください。`;
    input.focus();
    return null;
   }
   input.removeAttribute('aria-invalid');
   values[key]=value;
  }
  error.textContent='';
  return {reserveTroops:values.troops,reserveRice:values.rice};
 }

 function comparisonMarkup(advice,options={}){
  const alternatives=Array.isArray(advice.alternatives)?advice.alternatives.filter(v=>v&&typeof v==='object').slice(0,3):[];
  if(!alternatives.length)return '';
  const rows=[advice,...alternatives],hasTroops=rows.some(c=>finite(c.troops)&&c.troops>0),hasLoss=rows.some(c=>finite(c.estimatedLoss)),hasCost=rows.some(c=>finite(c.foodCost));
  const outcome=c=>c.deterministic===true?c.predictedWin===true?'勝利予測':'敗北予測':finite(c.winChance)?number(c.winChance)+'%':'—';
  const difference=c=>{
   const parts=[];let comparable=0;
   if(finite(advice.estimatedLoss)&&finite(c.estimatedLoss)){comparable++;const delta=Math.round(c.estimatedLoss-advice.estimatedLoss);if(delta)parts.push('損失 '+(delta>0?'+':'−')+Math.abs(delta).toLocaleString('ja-JP')+'人');}
   if(finite(advice.foodCost)&&finite(c.foodCost)){comparable++;const delta=Math.round(c.foodCost-advice.foodCost);if(delta)parts.push((options.costShortLabel||'兵糧')+' '+(delta>0?'+':'−')+Math.abs(delta).toLocaleString('ja-JP'));}
   return parts.length?parts.join(' / '):comparable?'比較できる費用・損失は同じ':'比較用の費用・損失データなし';
  };
  return `<details class="battle-advisor-alternatives"><summary>他の戦法を比較</summary><p class="battle-advisor-comparison-note">推奨案との差を確認できます。勝率・損失は、出陣時の戦況で変わる場合があります。</p><div class="battle-advisor-comparison-scroll" tabindex="0" role="region" aria-label="戦法ごとの出陣比較"><table><thead><tr><th scope="col">戦法</th>${hasTroops?'<th scope="col">兵数</th>':''}<th scope="col">${advice.deterministic===true?'戦力比較':'予想勝率'}</th>${hasLoss?'<th scope="col">予想損失</th>':''}${hasCost?`<th scope="col">${esc(options.costShortLabel||'兵糧')}</th>`:''}</tr></thead><tbody>${rows.map((c,i)=>`<tr${i===0?' class="is-recommended"':''}><th scope="row">${i===0?'<small>推奨</small>':''}${esc(c.tacticName||c.tactic||'—')}</th>${hasTroops?`<td>${finite(c.troops)&&c.troops>0?number(c.troops)+'人':'—'}</td>`:''}<td>${esc(outcome(c))}</td>${hasLoss?`<td>${finite(c.estimatedLoss)?number(c.estimatedLoss)+'人':'—'}</td>`:''}${hasCost?`<td>${finite(c.foodCost)?number(c.foodCost):'—'}</td>`:''}</tr>`).join('')}</tbody></table></div>${hasLoss||hasCost?`<ul class="battle-advisor-comparison-deltas">${alternatives.map(c=>`<li><strong>${esc(c.tacticName||c.tactic||'—')}</strong><span>推奨案に対して ${esc(difference(c))}</span></li>`).join('')}</ul>`:''}</details>`;
 }

 // Callers supply their own authoritative preview formula. This comparator
 // never invents a combat formula or sends a battle request.
 function compare(candidates,options={}){
  const style=styleOf(options.style),minWinChance=finite(options.minWinChance)&&options.minWinChance<=100?options.minWinChance:STYLES[style].minWinChance;
  const legal=(Array.isArray(candidates)?candidates:[]).filter(c=>c&&c.ok!==false&&typeof c.tactic==='string'&&c.tactic&&finite(c.winChance)&&c.winChance<=100&&(c.troops===undefined||Number.isSafeInteger(c.troops)&&c.troops>=0)&&(c.foodCost===undefined||finite(c.foodCost))&&(c.estimatedLoss===undefined||finite(c.estimatedLoss))).map(c=>{
   const loss=c.estimatedLoss||0,food=c.foodCost||0,score=style==='conserve'?-loss-food*.08+c.winChance:style==='rapid'?c.winChance*30-loss*.1-food*.015:c.winChance*12-loss*.35-food*.035;
   return{...safeChoice(c),meetsGoal:c.winChance>=minWinChance,score:Math.round(score*100)/100};
  });
  if(!legal.length){const message=options.emptyMessage||'現在の条件では出陣できる案がありません。兵・兵糧・出陣条件を確認してください。';return{ok:false,style,minWinChance,message,reasons:[message],alternatives:[]};}
  const ready=legal.some(c=>c.meetsGoal),ranked=ready?legal.filter(c=>c.meetsGoal):legal;
  ranked.sort((a,b)=>(ready?0:b.winChance-a.winChance)||b.score-a.score||(a.foodCost||0)-(b.foodCost||0)||(a.troops||0)-(b.troops||0)||a.tactic.localeCompare(b.tactic));
  const best=ranked[0],alternatives=[];
  for(const candidate of ranked)if(candidate.tactic!==best.tactic&&!alternatives.some(v=>v.tactic===candidate.tactic)){alternatives.push(safeChoice(candidate));if(alternatives.length===3)break;}
  const reasons=Array.isArray(best.reasons)?best.reasons.filter(v=>typeof v==='string'&&v).slice(0,6):[];
  if(!reasons.length)reasons.push(`${STYLES[style].name}の方針で、${best.tacticName||best.tactic}${finite(best.troops)&&best.troops>0?'・兵'+number(best.troops)+'人':''}を提案します。`);
  if(!best.meetsGoal)reasons.unshift(`勝率${number(minWinChance)}%の目安に届きません。戦力や補給を整えてからの出陣を勧めます。`);
  return{ok:true,...safeChoice(best),targetName:options.targetName??best.targetName,style,minWinChance,caution:!best.meetsGoal,recommendation:best.meetsGoal?'attack':'prepare',message:reasons[0],reasons,alternatives};
 }

 function markup(advice,options={}){
  const a=advice&&typeof advice==='object'?advice:{ok:false,message:'戦場を選ぶと、軍師が戦法と戦力を比較します。'},style=styleOf(a.style),ready=a.ok===true,disabled=options.disabled===true||!ready,action=String(options.action||'apply');
  const reasons=(Array.isArray(a.reasons)?a.reasons:typeof a.message==='string'?[a.message]:[]).filter(v=>typeof v==='string'&&v).slice(0,6);
  const metric=(label,value)=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`,metrics=[];
  if(ready){
   metrics.push(metric('推奨戦法',a.tacticName||a.tactic||'—'));
   if(finite(a.troops)&&a.troops>0)metrics.push(metric('出陣兵数',number(a.troops)+'人'));
   if(a.deterministic===true)metrics.push(metric('戦力比較',a.predictedWin===true?'勝利予測':'敗北予測'));
   else if(finite(a.winChance))metrics.push(metric('予想勝率',number(a.winChance)+'%'));
   if(finite(a.estimatedLoss))metrics.push(metric('予想損失',number(a.estimatedLoss)+'人'));
   if(finite(a.foodCost))metrics.push(metric(options.costLabel||'消費兵糧',number(a.foodCost)));
  }
  return `<section class="battle-advisor${a.caution?' is-cautious':''}${ready?'':' is-unavailable'}" data-battle-advisor aria-label="軍師AIの提案"><header class="battle-advisor-heading"><div><span class="battle-advisor-label">軍師AI</span><h3>${a.caution?'戦力を整えるための軍議':'今回の一手'}</h3>${a.targetName?`<p>${esc(a.targetName)}</p>`:''}</div>${options.showStyles===false?'':`<label class="battle-advisor-style"><span>方針</span><select class="select" data-battle-advisor-style aria-label="軍師AIの方針"${options.disabled?' disabled':''}>${Object.entries(STYLES).map(([id,s])=>`<option value="${id}"${id===style?' selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`}</header>${reserveMarkup(options.reserves,options.disabled===true)}${metrics.length?`<dl class="battle-advisor-metrics">${metrics.join('')}</dl>`:''}${ready?readinessMarkup(a):''}${reasons.length?`<ul class="battle-advisor-reasons">${reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}${ready?comparisonMarkup(a,options):''}<footer class="battle-advisor-footer"><button type="button" class="button gold" data-battle-advisor-action="${esc(action)}"${disabled?' disabled':''}>${esc(options.applyLabel||'この案を反映')}</button><p>${esc(options.note||'案を反映したあと、出陣内容を確認できます。')}</p></footer></section>`;
 }

 function render(host,advice,options={}){
  if(!host)return;const html=markup(advice,options);
  if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(host,html);
  else if(host.innerHTML!==html)host.innerHTML=html;
 }

 function bind(host,options={}){
  if(!host?.addEventListener)return{dispose(){}};
  const action=String(options.action||'apply');
  const click=event=>{
   const button=event.target.closest?.('[data-battle-advisor-action]');
   if(!button||!host.contains(button)||button.disabled||button.dataset.battleAdvisorAction!==action)return;
   event.preventDefault();
   const form=host.querySelector('[data-battle-reserves]');
   if(form&&options.onReserveChange){
    const reserves=readReserveForm(form);
    if(!reserves)return;
    if(reserves.reserveTroops!==Number(form.dataset.appliedTroops)||reserves.reserveRice!==Number(form.dataset.appliedRice)){
     options.onReserveChange(reserves);
     return;
    }
   }
   const advice=options.getAdvice?.();
   if(!advice?.ok){options.onUnavailable?.(advice);return;}
   options.onApply?.(advice);
  };
  const change=event=>{const select=event.target;if(host.contains(select)&&select.matches?.('[data-battle-advisor-style]')&&!select.disabled&&Object.hasOwn(STYLES,select.value))options.onStyleChange?.(select.value);};
  const submit=event=>{
   const form=event.target;
   if(!form.matches?.('[data-battle-reserves]')||!host.contains(form))return;
   event.preventDefault();
   const reserves=readReserveForm(form);
   if(reserves)options.onReserveChange?.(reserves);
  };
  host.addEventListener('click',click);host.addEventListener('change',change);host.addEventListener('submit',submit);
  return{dispose(){host.removeEventListener('click',click);host.removeEventListener('change',change);host.removeEventListener('submit',submit);}};
 }
 const api={styles:STYLES,compare,readiness,markup,render,bind};global.SengokuBattleAdvisor=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
