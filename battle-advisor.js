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
  const alternatives=ready&&Array.isArray(a.alternatives)?a.alternatives.slice(0,3):[];
  return `<section class="battle-advisor${a.caution?' is-cautious':''}${ready?'':' is-unavailable'}" data-battle-advisor aria-label="軍師AIの提案"><header class="battle-advisor-heading"><div><span class="battle-advisor-label">軍師AI</span><h3>${a.caution?'戦力を整えるための軍議':'今回の一手'}</h3>${a.targetName?`<p>${esc(a.targetName)}</p>`:''}</div>${options.showStyles===false?'':`<label class="battle-advisor-style"><span>方針</span><select class="select" data-battle-advisor-style aria-label="軍師AIの方針"${options.disabled?' disabled':''}>${Object.entries(STYLES).map(([id,s])=>`<option value="${id}"${id===style?' selected':''}>${esc(s.name)}</option>`).join('')}</select></label>`}</header>${metrics.length?`<dl class="battle-advisor-metrics">${metrics.join('')}</dl>`:''}${reasons.length?`<ul class="battle-advisor-reasons">${reasons.map(reason=>`<li>${esc(reason)}</li>`).join('')}</ul>`:''}${alternatives.length?`<details class="battle-advisor-alternatives"><summary>他の戦法を比較</summary><ul>${alternatives.map(choice=>`<li><strong>${esc(choice.tacticName||choice.tactic)}</strong><span>${[finite(choice.troops)&&choice.troops>0?'兵'+number(choice.troops)+'人':'',finite(choice.winChance)?'勝率'+number(choice.winChance)+'%':'',finite(choice.estimatedLoss)?'損失'+number(choice.estimatedLoss)+'人':'',finite(choice.foodCost)?(options.costShortLabel||'兵糧')+number(choice.foodCost):''].filter(Boolean).map(esc).join(' · ')}</span></li>`).join('')}</ul></details>`:''}<footer class="battle-advisor-footer"><button type="button" class="button gold" data-battle-advisor-action="${esc(action)}"${disabled?' disabled':''}>${esc(options.applyLabel||'この案を反映')}</button><p>${esc(options.note||'案を反映したあと、出陣内容を確認できます。')}</p></footer></section>`;
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
   event.preventDefault();const advice=options.getAdvice?.();
   if(!advice?.ok){options.onUnavailable?.(advice);return;}
   options.onApply?.(advice);
  };
  const change=event=>{const select=event.target;if(host.contains(select)&&select.matches?.('[data-battle-advisor-style]')&&!select.disabled&&Object.hasOwn(STYLES,select.value))options.onStyleChange?.(select.value);};
  host.addEventListener('click',click);host.addEventListener('change',change);
  return{dispose(){host.removeEventListener('click',click);host.removeEventListener('change',change);}};
 }
 const api={styles:STYLES,compare,markup,render,bind};global.SengokuBattleAdvisor=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
