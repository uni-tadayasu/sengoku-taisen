/* Growth, first-play guidance, army sets and truthful combat analysis. */
(function(global){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num=v=>Math.floor(Number(v)||0).toLocaleString('ja-JP'),copy=v=>JSON.parse(JSON.stringify(v));
 const RES={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'},TAB={missions:'任務',army:'編成セット',analysis:'合戦研究',officers:'武将の成長',recap:'留守中の報告',history:'歴代の記録',guide:'初陣ガイド'},STAT={lead:'統率',valor:'武勇',intellect:'知略',politics:'政治'};
 const initialSelection=()=>({castleId:'',tactic:'balanced',troops:'1000',preset:'current',officerId:'',exchangeId:'',rank:'S'});
 let options={},overlay=null,tab='missions',data=null,busy=false,error='',message='',stamp='',generation=0,readSerial=0,writing=false,pending=null,confirmation=null,focused=null,tutorial=null,lastTutorial='',selection=initialSelection();
 let renderedTab='',drafts=new Map(),scrollPositions=new Map(),backdropPointer=false;
 const game=()=>options.getGame?.(),context=()=>options.getContext?.()||{},owner=()=>String(context().playerId||context().ownerId||context().user?.id||''),key=()=>`sengoku-progress-pending-v1:${owner()}`;
 function identity(){const current=owner()+':'+(game()?.state.walking?.campaignId||'');if(current!==stamp){stamp=current;generation++;readSerial++;data=null;confirmation=null;pending=null;busy=false;writing=false;error='';message='';selection=initialSelection();drafts.clear();scrollPositions.clear();try{const restored=JSON.parse(global.localStorage?.getItem(key())||'null');if(restored&&['/progress/claim','/progress/exchange'].includes(restored.route)&&restored.payload&&typeof restored.payload.requestId==='string')pending=restored;}catch(_){}if(overlay)close({restoreFocus:false,remember:false});}return current;}
 const allowed=()=>context().writable!==false&&context().gameWritable!==false;
 const linked=()=>Boolean(owner());
 const resultMessage=r=>{if(r?.ok===false)throw Error(r.message||'操作を完了できませんでした。');message=r?.message||'更新しました。';return r;};
 function mutate(fn){if(!allowed())throw Error(context().reason||'この端末で操作できる状態を確認してください。');if(!options.mutate)throw Error('保存の準備ができていません。');const r=options.mutate(fn);if(r&&typeof r.then==='function')throw Error('保存操作の形式を確認してください。');return resultMessage(r);}
 function setStatus(){if(!overlay)return;const el=overlay.querySelector('.progress-status');el.textContent=error||message||'';el.classList.toggle('is-error',Boolean(error));}
 function rewards(v){return Object.entries(v||{}).filter(([,n])=>n).map(([k,n])=>`${RES[k]||k} +${num(n)}`).join(' · ');}
 function date(v){return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
 function button(action,text,extra='',disabled=false){return`<button type="button" class="progress-button" data-progress-action="${action}" ${extra} ${disabled?'disabled':''}>${text}</button>`;}
 function missionCard(m){const exhausted=m.kind==='daily'&&data.dailyClaimed>=data.dailyLimit,ready=m.progress>=m.target&&!m.claimed&&!exhausted;return`<article class="progress-card ${m.claimed?'is-claimed':''}"><h4>${esc(m.name)}</h4><div class="progress-reward">${rewards(m.reward)}</div><div class="progress-meter"><i style="width:${Math.min(100,m.progress/m.target*100)}%"></i></div><div class="progress-card-footer"><span class="progress-meta">${num(m.progress)} / ${num(m.target)}</span>${button('claim',m.claimed?'受取済み':exhausted?'本日は3件達成':'報酬を受け取る',`data-key="${esc(m.key)}"`,!ready||busy||Boolean(pending))}</div></article>`;}
 function missionsView(){if(!data)return`<p class="progress-intro">${linked()?'成長任務を読み込んでいます。':'領主登録と自動保存を終えると、日次・週次任務の報酬を受け取れます。編成セットや初陣ガイドはこの端末でも使えます。'}</p>${button('reload','任務を確認')}`;const groups=[['daily','今日の選択任務'],['weekly','今週の任務'],['returning','お帰りなさい'],['recovery','復興の支援'],['achievements','長く歩む実績']];return`<p class="progress-intro">今日の候補から好きな3件を達成できます。日付は日本時間、週は月曜日に更新します。ゲーム内の倍速や年月には連動しません。</p><p class="progress-meta">各資産は1億まで所持できます。上限を超える報酬は切り捨てられ、履歴には実際に増えた量が残ります。</p><div class="progress-summary"><div><span>本日の受取</span><b>${data.dailyClaimed} / ${data.dailyLimit}</b></div><div><span>次の日次更新</span><b>${date(data.calendar.nextDay)}</b></div><div><span>次の週次更新</span><b>${date(data.calendar.nextWeek)}</b></div></div>${groups.filter(([k])=>data.missions[k]?.length).map(([k,label])=>`<h3>${label}</h3><div class="progress-card-grid">${data.missions[k].map(missionCard).join('')}</div>`).join('')}`;}
 function reviewArmyPreset(g,slot){
  const preview=g.previewArmyPreset(slot);if(!preview?.ok)return preview||{ok:false,message:'編成セットを確認できません。'};
  const members=preview.army.map(id=>{const officer=g.officer(id);return{id,name:officer?.name||id,rank:officer?.rank||''};});
  const blocked=[];
  for(const member of members){
   if(!g.state.officers.includes(member.id)){blocked.push({id:member.id,reason:member.name+'は現在の家臣にいません。'});continue;}
   const branch=g.state.branches.find(row=>(row.commanders||[]).includes(member.id));
   if(branch)blocked.push({id:member.id,branchId:branch.id,reason:member.name+'は'+(g.branch?.(branch.id)?.name||branch.name||'支拠点')+'に配置中です。支拠点の配置を解除してから比較し直してください。'});
  }
  // Compare the content the player reviewed, not a mutable slot number. The
  // same check runs inside the actual mutation callback immediately before it
  // delegates to the engine's ordinary ownership and assignment guards.
  const reviewKey=JSON.stringify([g.state.home,g.state.clan,g.isStaff===true,g.isAdmin===true,preview.slot,preview.name,members,g.state.army,preview.stats,preview.current,preview.removedGovernors,blocked]);
  return{...preview,preset:true,members,blocked,reviewKey};
 }
 function revealPresetReview(){
  const region=overlay?.querySelector('.progress-preset-confirm'),heading=region?.querySelector('h3');
  if(heading){heading.setAttribute('tabindex','-1');heading.focus({preventScroll:true});region.scrollIntoView({block:'start',behavior:'instant'});}
 }
 function armyView(){const g=game(),p=g.state.progress;return`<p class="progress-intro">現在の軍団を名前付きで5組保存できます。切り替え前に能力と、軍団へ移る奉行を確認します。</p>${global.SengokuOfficerHealthUI?.armyMarkup(g,{title:'現在の軍団の体力'})||''}${confirmation?.preset?`<div class="progress-preset-confirm"><h3>「${esc(confirmation.name)}」へ切り替えますか？</h3><p>${confirmation.members.map(member=>esc(member.name)+' '+esc(member.rank)).join('・')}</p>${global.SengokuOfficerHealthUI?.armyMarkup(g,{ids:confirmation.army,title:'切替後の武将の体力',explain:false})||''}<table class="progress-table"><thead><tr><th>能力</th><th>現在</th><th>切替後</th></tr></thead><tbody>${Object.keys(STAT).map(k=>`<tr><td>${STAT[k]}</td><td>${confirmation.current[k]}</td><td>${confirmation.stats[k]}</td></tr>`).join('')}</tbody></table>${confirmation.removedGovernors.length?`<p class="progress-warning">奉行から外れる武将：${confirmation.removedGovernors.map(v=>`${esc(v.name)}（${esc(v.building)}）`).join('、')}</p>`:'<p>奉行の変更はありません。</p>'}${confirmation.blocked.map(row=>'<p class="progress-warning">'+esc(row.reason)+'</p>').join('')}<p class="progress-meta">確認時の比較です。編成・能力・奉行の配置が変わった場合は、最新の内容をもう一度確認します。</p><div class="progress-inline">${button('apply-preset','確認して切り替える',`data-slot="${confirmation.slot}"`,!allowed()||confirmation.blocked.length>0)}${button('cancel-preset','戻る')}</div></div>`:''}<div class="progress-card-grid">${Array.from({length:5},(_,slot)=>{const s=p.presets.find(v=>v.slot===slot);return`<article class="progress-card"><h4>編成 ${slot+1}</h4><label><span class="progress-meta">編成名</span><input maxlength="24" data-preset-name="${slot}" value="${esc(s?.name||'')}" placeholder="攻城用、野良兵用など"></label><p>${s?s.army.map(id=>esc(g.officer(id)?.name||id)).join('・'):'未保存'}</p><div class="progress-inline">${button('save-preset',s?'現在の軍団で上書き':'現在の軍団を保存',`data-slot="${slot}"`,!allowed())}${s?button('preview-preset','比較して切り替える',`data-slot="${slot}"`,!allowed())+button('delete-preset','削除',`data-slot="${slot}"`,!allowed()):''}</div></article>`;}).join('')}</div>`;}
 function analysisView(){const g=game(),targets=g.data.castles.filter(c=>g.state.castles[c.id].owner!==g.state.clan);if(!targets.some(c=>c.id===selection.castleId))selection.castleId=(g.adjacentTargets()[0]||targets[0])?.id||'';const preset=g.state.progress.presets.find(v=>String(v.slot)===selection.preset),army=preset?.army||g.state.army,p=selection.castleId?g.simulateArmy({castleId:selection.castleId,tactic:selection.tactic,troops:Number(selection.troops),army}):null;return`<p class="progress-intro">兵・資源・指令を消費せず、通常のCPU攻城戦を比較します。実際の出陣時には、隣接・支拠点・兵糧などの条件も確認します。</p><form class="progress-form" data-progress-form="analysis"><label>目標の城<select name="castleId">${targets.map(c=>`<option value="${c.id}" ${c.id===selection.castleId?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>編成<select name="preset"><option value="current">現在の軍団</option>${g.state.progress.presets.map(s=>`<option value="${s.slot}" ${String(s.slot)===selection.preset?'selected':''}>${esc(s.name)}</option>`).join('')}</select></label><label>戦法<select name="tactic">${g.data.tactics.map(t=>`<option value="${t.id}" ${t.id===selection.tactic?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label><label>兵数<input name="troops" type="number" min="300" max="${g.state.troops}" step="1" value="${esc(selection.troops)}"></label><button type="submit" class="progress-button primary">試算する</button></form>${global.SengokuOfficerHealthUI?.armyMarkup(g,{ids:army,title:'試算に使う武将の体力'})||''}${p?.attackPower?`<div class="progress-summary"><div><span>自軍戦力</span><b>${num(p.attackPower)}</b></div><div><span>敵軍戦力</span><b>${num(p.defensePower)}</b></div><div><span>予想勝率</span><b>${p.winChance}%</b></div><div><span>実戦の兵糧</span><b>${num(p.foodCost)}</b></div></div><table class="progress-table"><thead><tr><th>自軍戦力の要素</th><th>倍率・兵数</th></tr></thead><tbody>${p.factors.map((v,i)=>`<tr><td>${esc(v.label)}</td><td>${i?'× '+v.multiplier.toFixed(3):num(v.multiplier)+'人'}</td></tr>`).join('')}</tbody></table><p class="progress-warning">${esc(p.probabilityNote)}${p.ok?'':' 現在の出陣条件：'+esc(p.message)}</p>${p.notes.map(n=>`<p>${esc(n)}</p>`).join('')}`:'<p>試算する城と兵数を選んでください。</p>'}<h3>最近の戦報と改善点</h3>${reportList(g.state.progress.reports)}`;}
 function reportList(list){return list.length?`<div class="progress-log">${list.map(r=>`<article><b>${esc(r.name)}</b> <span class="progress-pill">${r.won?'勝利':'撤退'}</span><p>自軍 ${num(r.attack)} ／ 敵軍 ${num(r.defense)} · ${r.chance}% · 兵損 ${num(r.lost)}</p><p>${esc(r.summary)}</p></article>`).join('')}</div>`:'<p class="progress-meta">更新後の出陣から、編成と勝敗の分析が記録されます。</p>';}
 function officersView(){const g=game(),list=g.state.officers.map(id=>g.officer(id));if(!list.some(o=>o.id===selection.officerId))selection.officerId=list[0]?.id||'';const officer=g.officer(selection.officerId),m=g.officerMastery(selection.officerId),pool=g.gachaPool(selection.rank);if(!pool.some(o=>o.id===selection.exchangeId))selection.exchangeId=pool[0]?.id||'';const ex=data?.exchange;return`<p class="progress-intro">出陣・勝利・防衛・内政の経験が武将ごとに残ります。分野を選ぶと、その経験に応じた熟練称号を獲得します。熟練称号による能力の上乗せはありません。</p><form class="progress-form" data-progress-form="officer"><label>愛用武将<select name="officerId">${list.map(o=>`<option value="${o.id}" ${o.id===selection.officerId?'selected':''}>${esc(o.name)} ${o.rank}</option>`).join('')}</select></label><button class="progress-button" type="submit">記録を見る</button></form><article class="progress-card"><h3>${esc(officer?.name)} <span class="progress-pill">${esc(m.title)}</span></h3>${global.SengokuOfficerHealthUI?.markup(g,officer?.id)||''}<div class="progress-summary"><div><span>出陣</span><b>${num(m.sorties)}</b></div><div><span>勝利</span><b>${num(m.wins)}</b></div><div><span>防衛熟練</span><b>${num(m.defenses)}</b></div><div><span>内政熟練</span><b>${num(m.administration)}</b></div></div><p>現在の熟練 ${num(m.xp)} ${m.next?'／ 次の称号まで '+num(Math.max(0,m.next-m.xp)):'／ この分野を極めました'}</p><div class="progress-inline">${Object.entries(g.constructor.progressRoles).map(([k,v])=>button('officer-role',v+ (m.role===k?' ✓':''),`data-role="${k}"`,!allowed())).join('')}</div></article><h3>絵巻の証で高ランクを迎える</h3><p class="progress-intro">招集1回につき証1、同一絵巻の重複で追加2を獲得します。既存の勾玉返還も続きます。証をためると、所持していない指定ランクの絵巻を選べます。</p>${ex?`<div class="progress-summary"><div><span>使える絵巻の証</span><b>${num(ex.available)}</b></div><div><span>累計獲得</span><b>${num(ex.earned)}</b></div></div><form class="progress-form" data-progress-form="exchange"><label>ランク<select name="rank" data-progress-rank>${Object.entries(ex.costs).map(([r,c])=>`<option value="${r}" ${r===selection.rank?'selected':''}>${r} · 証${c}</option>`).join('')}</select></label><label>武将<select name="exchangeId">${pool.map(o=>`<option value="${o.id}" ${o.id===selection.exchangeId?'selected':''}>${esc(o.name)}${g.ownsVariant(o.id,selection.rank)?'（所持済み）':''}</option>`).join('')}</select></label><button type="submit" class="progress-button primary" ${busy||!allowed()?'disabled':''}>交換内容を確認</button></form>${confirmation?.exchange?`<div class="progress-preset-confirm"><p>${esc(confirmation.name)} ${confirmation.rank}を絵巻の証${num(confirmation.cost)}と交換しますか？</p><div class="progress-inline">${button('exchange','確認して交換', '',busy)}${button('cancel-preset','戻る')}</div></div>`:''}`:'<p>領主登録後に、証の残高と交換できる武将を確認できます。</p>'}`;}
 function recapView(){const g=game(),r=data?.recap;if(!r)return`<p class="progress-intro">前回の確認から1分以上経つと、生産・普請・研究・本拠の変化をまとめて表示します。</p>${button('reload','最新の報告を確認')}<h3>最近の合戦</h3>${reportList(g.state.progress.reports.slice(0,5))}`;return`<p class="progress-intro">${date(r.since)} から ${date(r.until)} の領国の変化です。資源は消費・報酬を含む差し引きです。</p><div class="progress-summary">${Object.entries(r.resources).map(([k,v])=>`<div><span>${RES[k]}</span><b class="${v<0?'progress-loss':'progress-gain'}">${v>=0?'+':''}${num(v)}</b></div>`).join('')}</div><p>本隊の兵：${r.troopDelta>=0?'+':''}${num(r.troopDelta)}人 · 未読のシステム便 ${r.unreadMail}件 · 受取可能な任務 ${num(r.unclaimed)}件</p><h3>留守中の防衛 ${num(r.attackCount)}戦</h3><div class="progress-log">${(r.attacks||[]).map(b=>`<article><b>${esc(b.castleName)} · ${b.held?'防衛成功':'攻撃を受けました'}</b><p>${date(b.at)} · ${global.SengokuCityHonors?.slot?.(b.attackerPlayerId)||''}${esc(b.attackerName)}${global.SengokuPublicCourt?.slot?.(b.attackerPlayerId)||''} · 兵損 ${num(b.lost)}</p></article>`).join('')||'<p>この期間の対人防衛はありません。</p>'}</div>${r.home!==r.oldHome?`<p class="progress-warning">本拠が ${esc(g.data.castles.find(c=>c.id===r.oldHome)?.name||r.oldHome)} から ${esc(g.data.castles.find(c=>c.id===r.home)?.name||r.home)} へ変わりました。</p>`:''}<h3>完成した普請</h3><p>${r.completedBuildings.map(v=>`${esc(g.data.buildings.find(b=>b.id===v.id)?.name||v.id)} Lv.${v.level}`).join(' ／ ')||'この期間に完成した施設はありません。'}</p><p>${(r.completedCastles||[]).map(v=>`${esc(g.data.castles.find(c=>c.id===v.id)?.name||v.id)} 城郭 Lv.${v.level}`).join(' ／ ')}</p><h3>進んだ研究</h3><p>${r.completedResearch.map(v=>`${esc(g.data.techs.find(t=>t.id===v.id)?.name||v.id)} Lv.${v.level}`).join(' ／ ')||'この期間に完成した研究はありません。'}</p><div class="progress-inline">${button('acknowledge','報告を確認しました')}${button('tab','任務の報酬を確認','data-tab="missions"')}${button('mail','システム郵便を開く')}</div><h3>最近の合戦</h3>${reportList(g.state.progress.reports.slice(0,5))}`;}
 function historyView(){const p=game().state.progress;return`<div class="progress-summary"><div><span>最高占領城数（本拠除く）</span><b>${num(p.best.captured)}</b></div><div><span>記録された勝利</span><b>${num(Math.max(p.best.wins,game().state.stats.wins+game().state.roaming.wins))}</b></div><div><span>達成した成長任務</span><b>${num(data?.claimedCount)}</b></div></div><h3>歴代の領国</h3><div class="progress-log">${p.cycles.length?p.cycles.map(v=>`<article><span class="progress-pill">${esc(v.title)}</span><p>占領 ${num(v.captured)}城 · 累計攻城勝利 ${num(v.wins)}戦</p></article>`).join(''):'<p>次の領地精算から、成績と記念称号が残ります。</p>'}</div><h3>受け取った褒賞</h3><div class="progress-log">${data?.history?.length?data.history.map(v=>`<article><b>${esc(v.name)}</b><p>${date(v.at)} · ${v.kind==='exchange'?'絵巻の証 '+num(v.cost):rewards(v.rewards)}</p></article>`).join(''):'<p>日次・週次任務や絵巻交換の履歴をここに残します。</p>'}</div>`;}
 function guideView(){const g=game(),t=g.tutorialStatus(data?.claimedCount||0);return`<p class="progress-intro">実際の画面を操作して、「育てる・備える・戦う・受け取る」を一周します。途中で閉じても同じ段階から再開できます。</p><div class="progress-log">${g.constructor.tutorialSteps.map((v,i)=>`<article><b>${i+1}. ${esc(v.title)}</b> ${i<t.stage?'✓':''}<p>${esc(v.text)}</p></article>`).join('')}</div><div class="progress-inline" style="margin-top:16px">${button('tutorial-start',t.status==='complete'?'達成済み':t.status==='new'?'初陣ガイドを始める':'続きから再開', '',t.status==='complete'||!allowed())}${button('tutorial-restart','最初から確認', '',!allowed())}</div>`;}
 function fieldKey(node){
  if(node.hasAttribute('data-preset-name'))return 'preset:'+node.getAttribute('data-preset-name');
  const form=node.closest('[data-progress-form]'),name=node.getAttribute('name');
  return form&&name?form.dataset.progressForm+':'+name:null;
 }
 function captureView(){
  if(!overlay||!renderedTab)return;
  const values=new Map();
  for(const node of overlay.querySelectorAll('.progress-body input,.progress-body select,.progress-body textarea')){
   const key=fieldKey(node);if(key)values.set(key,node.value);
  }
  drafts.set(renderedTab,values);
  const pane=overlay.querySelector('.progress-content');
  scrollPositions.set(renderedTab,{top:pane.scrollTop,left:pane.scrollLeft});
 }
 function patchRegion(node,html,key){
  if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(node,html,{key,preserveInputs:true});
  else if(node.innerHTML!==html)node.innerHTML=html;
 }
 function restoreFields(resetFields=[]){
  const values=drafts.get(tab)||new Map();
  for(const node of overlay.querySelectorAll('.progress-body input,.progress-body select,.progress-body textarea')){
   const key=fieldKey(node);if(!key)continue;
   let value=values.get(key);
   if(resetFields.includes(key))value=node.localName==='select'?(Array.from(node.options).find(o=>o.hasAttribute('selected'))||node.options[0])?.value||'':node.getAttribute('value')||'';
   if(value===undefined)continue;
   if(node.localName==='select'&&!Array.from(node.options).some(o=>o.value===value))continue;
   if(node.value!==value)node.value=value;
   values.set(key,value);
  }
  drafts.set(tab,values);
 }
 function render({resetFields=[]}={}){
  if(!overlay)return;
  captureView();
  const views={missions:missionsView,army:armyView,analysis:analysisView,officers:officersView,recap:recapView,history:historyView,guide:guideView};
  const previous=global.document.activeElement,ownedFocus=previous&&overlay.contains(previous),oldKey=ownedFocus?fieldKey(previous):null;
  const caret=oldKey?{start:previous.selectionStart,end:previous.selectionEnd,direction:previous.selectionDirection}:null;
  const sameTab=renderedTab===tab;
  patchRegion(overlay.querySelector('.progress-tabs'),Object.entries(TAB).map(([id,name])=>`<button type="button" id="progress-tab-${id}" role="tab" aria-controls="progress-panel" aria-selected="${tab===id}" tabindex="${tab===id?'0':'-1'}" data-progress-action="tab" data-tab="${id}">${name}</button>`).join(''),[stamp,'tabs']);
  const body=overlay.querySelector('.progress-body');
  patchRegion(body,views[tab](),[stamp,tab]);
  body.setAttribute('aria-labelledby','progress-tab-'+tab);
  restoreFields(resetFields);
  patchRegion(overlay.querySelector('.progress-pending'),pending?`<div class="progress-warning">結果が未確認の${pending.route.endsWith('exchange')?'絵巻交換':'任務報酬'}があります。${button('retry','同じ操作を再確認','',busy)}</div>`:'',[stamp,'pending']);
  setStatus();
  // Source-aware updates normally retain the same node. This fallback also
  // preserves a field when the DOM helper was unavailable during loading.
  if(sameTab&&oldKey&&!previous.isConnected){
   const replacement=Array.from(body.querySelectorAll('input,select,textarea')).find(node=>fieldKey(node)===oldKey);
   replacement?.focus({preventScroll:true});
   if(replacement&&typeof caret?.start==='number'&&replacement.setSelectionRange)try{replacement.setSelectionRange(caret.start,caret.end,caret.direction||'none');}catch(_){}
  }else if(sameTab&&ownedFocus&&(!previous.isConnected||previous.disabled)){
   overlay.querySelector('#progress-tab-'+tab)?.focus({preventScroll:true});
  }
  const position=scrollPositions.get(tab)||{top:0,left:0},pane=overlay.querySelector('.progress-content');
  pane.scrollTop=position.top;pane.scrollLeft=position.left;renderedTab=tab;
 }
 function selectTab(next,{focus=false}={}){
  if(!overlay||!Object.hasOwn(TAB,next))return false;
  if(next!==tab){captureView();tab=next;confirmation=null;error='';message='';render();}
  const target=overlay.querySelector('#progress-tab-'+tab),strip=overlay.querySelector('.progress-tabs');
  if(focus)target?.focus({preventScroll:true});
  // Only move the horizontal tab strip; never scroll the body or page.
  const bounds=strip.getBoundingClientRect(),item=target?.getBoundingClientRect();
  if(item&&strip.scrollWidth>strip.clientWidth){if(item.left<bounds.left)strip.scrollLeft+=item.left-bounds.left;else if(item.right>bounds.right)strip.scrollLeft+=item.right-bounds.right;}
  return true;
 }
 async function load(){identity();if(!linked()||!options.api||writing)return false;const expected=stamp,epoch=generation,request=++readSerial;busy=true;try{const r=await options.api('/progress');identity();if(stamp!==expected||generation!==epoch||request!==readSerial)return false;if(r?.ok===false)throw Error(r.error?.message||'成長記録を取得できません。');data=r.progress;error='';return true;}catch(e){identity();if(stamp===expected&&generation===epoch&&request===readSerial)error=e.message||'成長記録を取得できません。';return false;}finally{if(stamp===expected&&generation===epoch&&request===readSerial){busy=false;render();refresh();}}}
 async function requestMutation(route,payload){identity();if(busy)return;if(!linked())throw Error('交流で領主登録してから受け取れます。');if(!allowed())throw Error(context().reason||'この端末の操作権を確認してください。');const expected=stamp,epoch=generation;busy=true;writing=true;readSerial++;error='';
   if(!pending){pending={route,payload:{...payload,requestId:global.crypto.randomUUID()}};try{global.localStorage.setItem(key(),JSON.stringify(pending));}catch(e){pending=null;busy=false;writing=false;throw Error('操作記録を保存できません。ブラウザの保存設定を確認してください。');}}
   render();try{const r=await options.api(pending.route,{method:'POST',data:pending.payload});identity();if(stamp!==expected||generation!==epoch)return;if(r?.ok===false)throw Object.assign(Error(r.error?.message||'受取を確認できません。'),{code:r.error?.code});data=r.progress||data;message=r.receipt?.name?`「${r.receipt.name}」を反映しました。`:'反映しました。';if(!r.idempotent)global.SengokuBridge?.playInterfaceSound?.(pending.route==='/progress/claim'?'reward':'trade');pending=null;global.localStorage.removeItem(key());confirmation=null;
   }catch(e){identity();if(stamp===expected&&generation===epoch){global.SengokuBridge?.playInterfaceSound?.('error');error=e.message||'通信を確認して再試行してください。';if(['MISSION_EXPIRED','MISSION_CLAIMED','MISSION_INCOMPLETE','DAILY_LIMIT','EXCHANGE_SHORTAGE','VARIANT_OWNED','INVALID_INPUT','REQUEST_ID_REUSED'].includes(e.code)){pending=null;global.localStorage.removeItem(key());}}}finally{if(stamp===expected&&generation===epoch){busy=false;writing=false;render();refresh();}}
 }
 async function acknowledge(){
  identity();if(busy)return false;
  if(!linked()||!allowed())throw Error(context().reason||'この端末で操作できる状態を確認してください。');
  const expected=stamp,epoch=generation;busy=true;writing=true;readSerial++;error='';render();
  try{
   const r=await options.api('/progress/acknowledge',{method:'POST',data:{}});identity();
   if(stamp!==expected||generation!==epoch)return false;
   if(r?.ok===false)throw Error(r.error?.message||'報告の確認を保存できませんでした。');
   data=r.progress;message='留守中の報告を確認しました。';return true;
  }catch(e){identity();if(stamp===expected&&generation===epoch)error=e.message||'報告の確認を保存できませんでした。';return false;}
  finally{if(stamp===expected&&generation===epoch){busy=false;writing=false;render();refresh();}}
 }
 async function action(e){const surface=overlay;identity();const target=e.target.closest('[data-progress-action]');if(!surface||surface!==overlay||!target||!surface.contains(target)||target.disabled)return;const a=target.dataset.progressAction,expected=stamp,epoch=generation;error='';message='';try{
  if(a==='close')return close();if(a==='tab'){selectTab(target.dataset.tab,{focus:true});return;}
  if(a==='reload'){await load();return;}if(a==='claim'){await requestMutation('/progress/claim',{key:target.dataset.key});return;}if(a==='retry'){await requestMutation(pending.route,pending.payload);return;}
  if(a==='save-preset'){const slot=Number(target.dataset.slot),name=overlay.querySelector(`[data-preset-name="${slot}"]`).value;mutate(g=>g.saveArmyPreset(slot,name));if(confirmation?.preset&&confirmation.slot===slot)confirmation=null;const input=overlay?.querySelector(`[data-preset-name="${slot}"]`);if(input)input.value=game().state.progress.presets.find(v=>v.slot===slot)?.name||'';}
  if(a==='preview-preset'){
   const next=reviewArmyPreset(game(),Number(target.dataset.slot));confirmation=next?.ok?next:null;render();refresh();
   if(!confirmation)throw Error(next?.message||'編成セットを確認できません。');revealPresetReview();return;
  }
  if(a==='apply-preset'){
   const slot=Number(target.dataset.slot),reviewed=confirmation;let revised=false;
   if(!reviewed?.preset||reviewed.slot!==slot)throw Error('編成セットを比較してから、切り替える内容を確認してください。');
   try{
    mutate(g=>{
     const latest=reviewArmyPreset(g,slot);
     if(!latest?.ok){confirmation=null;revised=true;return latest||{ok:false,message:'編成セットを確認できません。'};}
     if(latest.reviewKey!==reviewed.reviewKey){confirmation=latest;revised=true;return{ok:false,message:'編成セット・能力・配置が変わりました。最新の比較を確認してから、もう一度切り替えてください。'};}
     if(latest.blocked.length)return{ok:false,message:latest.blocked.map(row=>row.reason).join(' ')};
     return g.applyArmyPreset(slot,{confirmGovernors:true});
    });
    confirmation=null;
   }catch(error){if(revised){render();refresh();revealPresetReview();}throw error;}
  }
  if(a==='delete-preset'){const slot=Number(target.dataset.slot);mutate(g=>g.deleteArmyPreset(slot));if(confirmation?.preset&&confirmation.slot===slot)confirmation=null;const input=overlay?.querySelector(`[data-preset-name="${slot}"]`);if(input)input.value='';}
  if(a==='cancel-preset')confirmation=null;
  if(a==='officer-role')mutate(g=>g.setOfficerRole(selection.officerId,target.dataset.role));
  if(a==='exchange'){await requestMutation('/progress/exchange',{officerId:confirmation.officerId,rank:confirmation.rank});return;}
  if(a==='acknowledge'){await acknowledge();return;}
  if(a==='mail'){close();options.openMail?.();return;}
  if(a==='tutorial-start'||a==='tutorial-restart'){mutate(g=>g.updateTutorial(a==='tutorial-restart'?'restart':'start',data?.claimedCount||0));close();goTutorial();return;}
  render();refresh();
 }catch(e){identity();if(stamp===expected&&generation===epoch){error=e.message||'操作を完了できませんでした。';setStatus();}}}
 function submit(e){const surface=overlay;identity();const form=e.target.closest('[data-progress-form]');if(!surface||surface!==overlay||!form||!surface.contains(form))return;e.preventDefault();error='';try{const v=Object.fromEntries(new FormData(form));if(form.dataset.progressForm==='analysis'){if(!Number.isSafeInteger(Number(v.troops))||Number(v.troops)<300||Number(v.troops)>game().state.troops)throw Error('兵数は300人以上、所持兵数以下で試算してください。');Object.assign(selection,v);}else if(form.dataset.progressForm==='officer'){selection.officerId=v.officerId;}else if(form.dataset.progressForm==='exchange'){Object.assign(selection,v);const g=game(),cost=data.exchange.costs[v.rank];if(g.ownsVariant(v.exchangeId,v.rank))throw Error('この絵巻は所持済みです。');if(data.exchange.available<cost)throw Error('絵巻の証が不足しています。');confirmation={exchange:true,officerId:v.exchangeId,rank:v.rank,cost,name:g.baseOfficer(v.exchangeId)?.name};}render();}catch(err){error=err.message;setStatus();}}
 function close({restoreFocus=true,remember=true}={}){
  if(!overlay)return;
  if(remember)captureView();
  const dialog=overlay,returnFocus=focused;
  overlay=null;renderedTab='';focused=null;confirmation=null;backdropPointer=false;
  // A closed view must not adopt an old read into the next opening. An
  // already-submitted claim keeps its receipt/idempotency path alive.
  readSerial++;if(!writing)busy=false;
  if(dialog.open)dialog.close();dialog.remove();
  if(restoreFocus&&returnFocus?.isConnected)try{returnFocus.focus({preventScroll:true});}catch(_){}
  options.onClose?.();refresh();
 }
 function keyboard(e){
  if(!overlay||e.defaultPrevented||e.isComposing||e.keyCode===229||e.ctrlKey||e.metaKey||e.altKey)return;
  const active=e.target.closest?.('[role="tab"]');
  if(!active||!overlay.querySelector('.progress-tabs').contains(active))return;
  if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
  const tabs=Object.keys(TAB),index=tabs.indexOf(active.dataset.tab);
  const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(index+(e.key==='ArrowLeft'?-1:1)+tabs.length)%tabs.length;
  e.preventDefault();selectTab(tabs[next],{focus:true});
 }
 function open(which='missions'){
  identity();if(!game()?.state?.progress||!global.document)return false;
  const next=Object.hasOwn(TAB,which)?which:'missions';
  if(overlay){selectTab(next,{focus:true});return true;}
  const dialog=global.document.createElement('dialog');
  if(typeof dialog.showModal!=='function'){options.notify?.('成長手帳を開けませんでした。対応するブラウザでお試しください。',true);return false;}
  tab=next;focused=global.document.activeElement;overlay=dialog;renderedTab='';backdropPointer=false;
  dialog.className='progress-overlay';dialog.setAttribute('aria-labelledby','progress-title');
  dialog.innerHTML='<section class="progress-dialog"><header class="progress-header"><div><span class="progress-eyebrow">GROWTH & STRATEGY</span><h2 id="progress-title">成長と戦略の記録</h2><p>次の一手を選び、あなたの歩みを残す。</p></div><button type="button" class="progress-close" data-progress-action="close" aria-label="閉じる">×</button></header><nav class="progress-tabs" role="tablist" aria-label="成長の記録"></nav><div class="progress-content"><div class="progress-status" role="status" aria-live="polite"></div><div class="progress-pending"></div><div class="progress-body" id="progress-panel" role="tabpanel" tabindex="0"></div></div></section>';
  global.document.body.appendChild(dialog);
  dialog.addEventListener('pointerdown',e=>{backdropPointer=e.target===dialog;});
  dialog.addEventListener('click',e=>{if(e.target===dialog&&backdropPointer){close();return;}backdropPointer=false;void action(e);});
  dialog.addEventListener('submit',submit);
  dialog.addEventListener('change',e=>{if(e.target.matches('[data-progress-rank]')){selection.rank=e.target.value;selection.exchangeId='';confirmation=null;render({resetFields:['exchange:exchangeId']});}});
  dialog.addEventListener('keydown',keyboard);
  // Native modal cancellation reaches only the topmost dialog. No document
  // Escape listener can also close a different surface behind it.
  dialog.addEventListener('cancel',e=>{if(e.target===dialog){e.preventDefault();close();}});
  dialog.addEventListener('close',()=>{if(overlay===dialog)close();});
  render();dialog.showModal();dialog.querySelector('.progress-close').focus({preventScroll:true});refresh();void load();return true;
 }
 function clearHighlight(){global.document?.querySelectorAll('.progress-tutorial-target').forEach(n=>n.classList.remove('progress-tutorial-target'));}
 function goTutorial(){const t=game().tutorialStatus(data?.claimedCount||0);options.navigate?.(t.step.view);refresh();}
 function refresh(){if(!global.document)return;identity();const g=game();clearHighlight();if(!g?.state?.progress)return;global.SengokuOfficerHealthUI?.refresh(overlay,g);const t=g.tutorialStatus(data?.claimedCount||0);if(t.status!=='active'||overlay){tutorial?.remove();tutorial=null;lastTutorial='';return;}
  if(!tutorial){tutorial=global.document.createElement('aside');tutorial.className='progress-tutorial';tutorial.setAttribute('aria-label','初陣ガイド');global.document.body.appendChild(tutorial);tutorial.addEventListener('click',e=>{const b=e.target.closest('[data-tutorial]');if(!b)return;try{if(b.dataset.tutorial==='pause'){mutate(x=>x.updateTutorial('pause'));refresh();}else if(b.dataset.tutorial==='navigate')goTutorial();else if(b.dataset.tutorial==='next'){mutate(x=>x.updateTutorial('next',data?.claimedCount||0));goTutorial();}}catch(e){options.notify?.(e.message);}});}
  const next=JSON.stringify([t.stage,t.complete,t.step.title]);if(next!==lastTutorial){lastTutorial=next;tutorial.innerHTML=`<small>初陣の章 ${t.stage+1} / ${t.total}</small><h3>${esc(t.step.title)}</h3><p>${esc(t.step.text)}</p><div class="progress-inline"><button type="button" class="progress-button" data-tutorial="navigate">操作画面へ</button><button type="button" class="progress-button primary" data-tutorial="next" ${t.complete?'':'disabled'}>次へ</button><button type="button" class="progress-button" data-tutorial="pause">後で</button></div>`;}
  const candidate=global.document.querySelector(t.step.selector)||global.document.querySelector(`[data-view="${t.step.view}"]`);candidate?.classList.add('progress-tutorial-target');
 }
 function configure(opts={}){options={...options,...opts};identity();return api;}
 const api={configure,open,close,refresh,prime:load,claimMission:key=>requestMutation('/progress/claim',{key}),retry:()=>pending?requestMutation(pending.route,pending.payload):Promise.resolve(false),startTutorial(){identity();try{mutate(g=>g.updateTutorial('start',data?.claimedCount||0));goTutorial();}catch(e){options.notify?.(e.message);}},destroy(){close({restoreFocus:false,remember:false});tutorial?.remove();tutorial=null;clearHighlight();generation++;readSerial++;busy=false;writing=false;drafts.clear();scrollPositions.clear();selection=initialSelection();options={};},getState(){return{tab,busy,hasPending:Boolean(pending),loaded:Boolean(data),owner:owner(),data:data?copy(data):null};}};
 global.SengokuProgress=api;
 if(typeof module!=='undefined'&&module.exports)module.exports={SengokuProgress:api,escape:esc};
})(typeof window!=='undefined'?window:globalThis);
