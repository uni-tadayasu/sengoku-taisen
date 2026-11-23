(function(global){
 'use strict';
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 function display(health,deferred=false){
  if(!health)return{known:false,current:'—',value:0,status:'unknown',label:deferred?'—':'未登用',activity:deferred?'—':'登用後に表示',factor:'—',description:deferred?'武将の体力':'未登用のため体力はありません'};
  const value=Math.max(0,Math.min(100,Number(health.current)||0)),current=Math.floor(value),status=value===0?'exhausted':value<60?'tired':'healthy',label=status==='healthy'?'良好':status==='tired'?'疲労':'消耗',activity=health.marching?'行軍中':value>=100?'全快':health.recovering?'回復中':'回復待機',factor=String(Math.round((Number(health.factor)||.5)*100));
  return{known:true,current:String(current),value,status,label,activity,factor,description:`体力 ${current} / 100、${label}、${activity}${health.marching?'・回復待機':''}。武将の戦闘時の能力 ${factor}%`};
 }
 function markup(game,id,options={}){
  if(!id||typeof game?.officerHealth!=='function')return'';
  const view=display(options.deferred?null:game.officerHealth(id),options.deferred),compact=options.compact?' officer-health--compact':'';
  return `<span class="officer-health${compact}" data-officer-health="${escape(id)}" data-health-status="${view.status}" data-stable-key="officer-health-${escape(id)}"><span class="officer-health-heading"><span class="officer-health-label">体力</span><span class="officer-health-state" data-health-state>${view.label}</span><span class="officer-health-number"><b data-health-current>${view.current}</b><span> / 100</span></span></span><span class="officer-health-gauge" data-health-gauge role="${view.known?'meter':'img'}" aria-label="${escape(view.description)}"${view.known?` aria-valuemin="0" aria-valuemax="100" aria-valuenow="${view.current}"`:''} style="--officer-health-value:${view.value.toFixed(2)}%"><span class="officer-health-fill" aria-hidden="true"></span></span><span class="officer-health-foot"><span data-health-activity>${view.activity}</span><span class="officer-health-factor">戦闘時 <b data-health-factor>${view.factor}</b>%</span></span></span>`;
 }
 function explanation(game){
  const rules=game?.data?.officerHealth||{winCost:15,lossCost:25,recoveryPerMonth:10,minCombatFactor:.5};
  return `実戦に参加した武将は勝利で${escape(rules.winCost??15)}、敗北で${escape(rules.lossCost??25)}消耗します。待機中はゲーム内1か月で${escape(rules.recoveryPerMonth??10)}回復し、行軍中は回復を待ちます。体力に応じて武将の戦闘時の数値能力が${Math.round((rules.minCombatFactor??.5)*100)}〜100%になります。特技は変わらず、体力0でも出陣できます。同じ人物の体力は全ランクで共通です。`;
 }
 function armyMarkup(game,options={}){
  if(typeof game?.officerHealth!=='function')return'';
  const wanted=[...new Set(options.ids||game.state?.army||[])],rows=game.armyHealth?.(wanted)?.officers,ids=rows?rows.map(row=>row.id):wanted.filter(id=>game.officerHealth(id));
  if(!ids.length)return'';
  return `<section class="officer-health-squad" aria-label="${escape(options.title||'出陣する武将の体力')}" data-stable-key="officer-health-squad"><h4>${escape(options.title||'出陣する武将の体力')}</h4><div class="officer-health-members">${ids.map(id=>`<div class="officer-health-member" data-stable-key="health-member-${escape(id)}"><strong class="officer-health-name">${escape(game.officer?.(id)?.name||id)}</strong>${markup(game,id,{compact:true,deferred:options.deferred})}</div>`).join('')}</div>${options.explain===false?'':`<details class="officer-health-help"><summary>体力の消耗・回復と戦闘への影響</summary><p>${explanation(game)}</p></details>`}</section>`;
 }
 function refresh(root=global.document,game=global.SengokuBridge?.getGame?.()){
  if(typeof game?.officerHealth!=='function'||!root?.querySelectorAll)return;
  const nodes=[...(root.matches?.('[data-officer-health]')?[root]:[]),...root.querySelectorAll('[data-officer-health]')];if(!nodes.length)return;
  const ids=[...new Set(nodes.map(node=>node.getAttribute('data-officer-health')))],rows=game.armyHealth?.(ids)?.officers,health=new Map(ids.map(id=>[id,display(null)]));
  for(const row of rows||ids.map(id=>({id,...game.officerHealth(id)})))health.set(row.id,display(Number.isFinite(row.current)?row:null));
  const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;},attribute=(node,name,value)=>{if(!node)return;if(value===null){if(node.hasAttribute(name))node.removeAttribute(name);}else if(node.getAttribute(name)!==value)node.setAttribute(name,value);};
  for(const node of nodes){
   const id=node.getAttribute('data-officer-health'),view=health.get(id),gauge=node.querySelector('[data-health-gauge]');
   text(node.querySelector('[data-health-current]'),view.current);text(node.querySelector('[data-health-state]'),view.label);text(node.querySelector('[data-health-activity]'),view.activity);text(node.querySelector('[data-health-factor]'),view.factor);attribute(node,'data-health-status',view.status);
   attribute(gauge,'role',view.known?'meter':'img');attribute(gauge,'aria-label',view.description);attribute(gauge,'aria-valuemin',view.known?'0':null);attribute(gauge,'aria-valuemax',view.known?'100':null);attribute(gauge,'aria-valuenow',view.known?view.current:null);
   const width=view.value.toFixed(2)+'%';if(gauge?.style?.getPropertyValue('--officer-health-value')!==width)gauge?.style?.setProperty('--officer-health-value',width);
  }
 }
 const api={markup,armyMarkup,explanation,refresh};global.SengokuOfficerHealthUI=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
