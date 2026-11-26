(function(global){
 'use strict';
 const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const num=value=>Math.floor(value).toLocaleString('ja-JP');
 function display(raw){
  if(!raw||!Number.isFinite(raw.current)||!Number.isFinite(raw.max)||raw.max<0)return null;
  const max=Math.max(0,Math.floor(raw.max)),current=Math.min(max,Math.max(0,Math.floor(raw.current))),ratio=max?current/max:0;
  const recovery=Number.isFinite(raw.recoveryPerMonth)?Math.max(0,Math.floor(raw.recoveryPerMonth)):0;
  const status=!max?'unbuilt':current===0?'breached':ratio<.3?'critical':ratio<1?'damaged':'sound';
  const label=!max?'未完成':current===0?'損壊':ratio<.3?'大破':ratio<1?'修復待ち':'健全';
  const paid=raw.recoveryMode!=='free',repair=!max?'完成時に耐久が備わります':!recovery?'復旧工事で修復':current===max?'耐久満タン・修復費なし':paid?`月替わりに最大 +${num(recovery)} ／ 木材${num(Math.ceil(recovery*.05))}・石材${num(Math.ceil(recovery*.04))}以内`:`自動修復 +${num(recovery)} / 月`;
  return{max,current,ratio,recovery,status,label,description:`耐久 ${num(current)} / ${num(max)}、${label}`,repair};
 }
 function markup(raw,options={}){
  const view=display(raw);if(!view)return'';
  const live=options.live&&['castle','branch'].includes(options.kind)&&options.id;
  return `<span class="base-durability${options.compact?' base-durability--compact':''}" data-durability-status="${view.status}" data-stable-key="durability-${esc(options.kind||'base')}-${esc(options.id||'view')}"${live?` data-durability-live="${esc(options.kind)}" data-durability-id="${esc(options.id)}"`:''}><span class="base-durability-heading"><span>${esc(options.label||'耐久')}</span><span class="base-durability-status" data-durability-label>${view.label}</span><span class="base-durability-numbers"><b data-durability-current>${num(view.current)}</b><span> / </span><span data-durability-max>${num(view.max)}</span></span></span><span class="base-durability-gauge" data-durability-gauge role="meter" aria-label="${esc(view.description)}" aria-valuemin="0" aria-valuemax="${Math.max(1,view.max)}" aria-valuenow="${view.current}" style="--durability-fill:${(view.ratio*100).toFixed(2)}%"><i aria-hidden="true"></i></span>${options.compact?'':`<span class="base-durability-repair" data-durability-repair>${view.repair}</span>`}</span>`;
 }
 function summary(raw){const view=display(raw);return view?`耐久 ${num(view.current)} / ${num(view.max)}`:'';}
 function battleMarkup(result){
  if(!result||!['before','after','damage','max'].every(key=>Number.isFinite(result[key])))return'';
  const before=Math.max(0,result.before),after=Math.max(0,result.after),damage=Math.max(0,result.damage);
  return `<section class="durability-battle-report" data-stable-key="battle-durability"><h4>拠点の耐久</h4><div><span>戦闘前 <b>${num(before)}</b></span><span>損傷 <b>−${num(damage)}</b></span><span>戦闘後 <b>${num(after)}</b></span></div>${result.captured?'<p>占領した城は最大耐久の25%から復旧を始めます。</p>':result.breached?'<p>城壁が突破されました。</p>':''}</section>`;
 }
 function explanation(){return '耐久は城や支拠点の守りの状態です。城郭・城壁・支拠点のレベルで最大値が増え、損傷すると城壁などの防御効果が弱まります。自領の城と稼働中の支拠点は、月替わりに最大耐久の10%まで修復します。回復100につき木材5・石材4を使い、月途中の損傷は経過時間に応じて計算します。資材不足時は回復量を抑え、満タン後は消費しません。陥落した支拠点は、見積額を一括払いする復旧工事が必要です。';}
 function refresh(root=global.document,game=global.SengokuBridge?.getGame?.()){
  if(!root?.querySelectorAll||!game||(root.ownerDocument||root).hidden)return;
  const indexed=root===global.document&&global.SengokuLiveDOM?.nodes?.('[data-durability-live]');
  const nodes=(indexed||[...(root.matches?.('[data-durability-live]')?[root]:[]),...root.querySelectorAll('[data-durability-live]')]).filter(node=>node.isConnected!==false&&!node.closest?.('[hidden],[inert],dialog:not([open])')&&!(global.SENGOKU_AT_TITLE===true&&node.closest?.('#app')));if(!nodes.length)return;
  const views=new Map(),text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;},attr=(node,key,value)=>{if(node&&node.getAttribute(key)!==value)node.setAttribute(key,value);};
  for(const node of nodes){
   const kind=node.getAttribute('data-durability-live'),id=node.getAttribute('data-durability-id'),key=kind+':'+id;
   if(!views.has(key))views.set(key,display((kind==='branch'?game.branch?.(id):game.castle?.(id))?.durability));
   const view=views.get(key);if(!view)continue;
   text(node.querySelector('[data-durability-current]'),num(view.current));text(node.querySelector('[data-durability-max]'),num(view.max));text(node.querySelector('[data-durability-label]'),view.label);text(node.querySelector('[data-durability-repair]'),view.repair);attr(node,'data-durability-status',view.status);
   const gauge=node.querySelector('[data-durability-gauge]');attr(gauge,'aria-label',view.description);attr(gauge,'aria-valuemax',String(Math.max(1,view.max)));attr(gauge,'aria-valuenow',String(view.current));
   const width=(view.ratio*100).toFixed(2)+'%';if(gauge?.style?.getPropertyValue('--durability-fill')!==width)gauge?.style?.setProperty('--durability-fill',width);
  }
 }
 const api={display,markup,summary,battleMarkup,explanation,refresh};global.SengokuDurabilityUI=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
