/* Attached outposts use engine quotes and parent geography; they are not castles. */
(function(global){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const directions={north:'北',east:'東',south:'南',west:'西'},parents=['edo','nijo','osaka','nagoya'],choices=new WeakMap(),troopChoices=new WeakMap(),commanderChoices=new WeakMap();
const num=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');
const notice=value=>global.SengokuSyncNotices?.visibleText?.(value)??String(value??'');
function name(game,branchId){const branch=(game?.state?.branches||[]).find(row=>row.id===branchId);return branch?(game.castle(branch.parentCastleId)?.name||branch.parentCastleId)+' '+(directions[branch.direction]||'')+'支拠点':'支拠点';}
function selection(game,parentId){const status=game.branchStatus?.(parentId),available=status?.directions?.filter(row=>row.available)||[];let saved=choices.get(game);if(!saved){saved=new Map();choices.set(game,saved);}const current=saved.get(parentId);if(!available.some(row=>row.id===current))saved.set(parentId,available[0]?.id||'');return saved.get(parentId)||'';}
function selectDirection(game,parentId,direction){const status=game.branchStatus?.(parentId);if(!status?.directions?.some(row=>row.id===direction&&row.available))return false;selection(game,parentId);choices.get(game).set(parentId,direction);return true;}
function transferSelection(previous,next){const campaign=previous?.state?.walking?.campaignId;if(!campaign||campaign!==next?.state?.walking?.campaignId||previous.state.home!==next.state.home||previous.state.clan!==next.state.clan||previous.isAdmin!==next.isAdmin||previous.isStaff!==next.isStaff)return false;const saved=choices.get(previous),troops=troopChoices.get(previous),commanders=commanderChoices.get(previous);if(!saved&&!troops&&!commanders)return false;if(saved){choices.set(next,new Map(saved));for(const parentId of saved.keys())selection(next,parentId);}if(troops)troopChoices.set(next,new Map([...troops].map(([id,draft])=>[id,{...draft}])));if(commanders)commanderChoices.set(next,new Map(commanders));return true;}
function quote(game,action,{parentCastleId,direction,branchId,facilityId}={}){if(action==='build-facility'||action==='upgrade-facility')return game.branchFacilityQuote?.(branchId,facilityId);if(action==='build')return game.branchQuote?.(parentCastleId,direction);if(action==='repair')return game.branchRepairQuote?.(branchId);const branch=(game.state.branches||[]).find(row=>row.id===branchId);return branch?game.branchQuote?.(branch.parentCastleId,branch.direction):{ok:false,reason:'支拠点が見つかりません。'};}
function own(game,parentId){const castle=game.castle?.(parentId);return castle?.owner===game.state.clan&&game.canOwnCastle?.(parentId)!==false;}
function art(parentId,direction,level,className='branch-art'){return global.SengokuArt?.branch?.(parentId,direction,Math.max(1,level),className)||global.SengokuArt?.castle?.(parentId,className,Math.max(1,level))||'<span class="branch-art-fallback" aria-hidden="true">城</span>';}
function jobName(game,job){
 const facility=job?.facilityId&&(global.SENGOKU_DATA?.branchFacilities||[]).find(row=>row.id===job.facilityId);
 return job?.name||name(game,job?.id)+(job?.facilityId?' · '+(job.facilityName||facility?.name||'支城施設'):'');
}
function facilityReason(game,branchId,facilityId,helpers={},currentQuote){
 if(helpers.writable===false)return helpers.writableReason||'同期と保存の確認後に施設を普請できます。';
 const q=currentQuote||game.branchFacilityQuote?.(branchId,facilityId);
 return q?.ok?'':q?.reason||q?.message||'施設の建設条件を確認してください。';
}
function percent(value){return Number((Math.max(0,Number(value)||0)*100).toFixed(2)).toLocaleString('ja-JP');}
function bonusMarkup(bonuses={}){
 const income=bonuses.income||{},rows=[];
 for(const [resource,label]of [['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材']])if(income[resource]>0)rows.push([label,`+${num(income[resource])}`, '/月']);
 if(bonuses.capacity>0)rows.push(['兵の収容',`+${num(bonuses.capacity)}`,'人']);
 if(bonuses.defense>0)rows.push(['支城の防衛',`+${percent(bonuses.defense)}`,'%']);
 if(bonuses.siegeDefense>0)rows.push(['堀の防衛',`+${percent(bonuses.siegeDefense)}`,'%']);
 return rows.length?`<dl class="branch-facility-bonuses">${rows.map(([label,value,unit])=>`<div><dt>${label}</dt><dd>${value}<small>${unit}</small></dd></div>`).join('')}</dl>`:'';
}
function bonusSummary(bonuses={}){
 const income=bonuses.income||{},parts=[];
 for(const[resource,label]of [['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材']])if(income[resource]>0)parts.push(`${label}+${num(income[resource])}/月`);
 if(bonuses.capacity>0)parts.push(`兵数上限+${num(bonuses.capacity)}`);
 if(bonuses.defense>0)parts.push(`防衛+${percent(bonuses.defense)}%`);
 if(bonuses.siegeDefense>0)parts.push(`堀+${percent(bonuses.siegeDefense)}%`);
 return parts.join(' · ');
}
function workKey(job){return `${job.kind}:${job.id}:personal:${job.targetLevel}${job.facilityId?':'+job.facilityId:''}`;}
function workClock(job){return job.queued?`着工まで ${num(Math.ceil(job.startsInSeconds||0))}秒 · 工期 ${num(job.totalSeconds)}秒`:`あと ${num(Math.ceil(job.remainingSeconds||0))}秒`;}
function price(q,helpers){
 if(!q?.cost)return '';
 const c=q.cost,cost=helpers.costHtml?helpers.costHtml(c):`<p class="branch-facility-cost">金銭 ${num(c.gold)} · 木材 ${num(c.wood)} · 石材 ${num(c.stone)} · 工期 ${num(c.seconds)}秒</p>`;
 return cost+`<p class="branch-command">指令 ${num(q.commandCost??1)}回${q.queued&&q.queuePosition>1?' · 予約順 '+num(q.queuePosition)+'番目':''}</p>`;
}
function queueMarkup(branch,jobs,helpers){
 if(!jobs.length)return '';
 const key=helpers.jobKey||workKey,clock=helpers.jobClockText||workClock;
 const lines=jobs.map((job,i)=>{
  const facility=job.facilityId&&(global.SENGOKU_DATA?.branchFacilities||[]).find(item=>item.id===job.facilityId);
  const target=job.facilityId?(facility?.name||job.facilityName||'支城施設'):(job.repair?'支拠点の修復':'支拠点');
  return `<li data-stable-key="branch-queue-${esc(key(job))}" data-branch-queue-position="${i+1}"><span class="branch-queue-position">${i+1}</span><div><strong>${esc(target)} Lv.${num(job.targetLevel)}</strong><span class="branch-queue-state">${job.queued?'着工待ち':'着工中'}</span><small data-job-clock="${esc(key(job))}">${esc(clock(job))}</small></div></li>`;
 });
 return `<section class="branch-queue" data-branch-queue="${esc(branch.id)}" aria-label="${esc(branch.name||'支拠点')}の普請の順番"><h5>普請の順番 <small>${num(jobs.length)}件</small></h5><ol>${lines.join('')}</ol></section>`;
}
function facilityMarkup(game,branch,facility,helpers={}){
 const q=facility.quote||game.branchFacilityQuote?.(branch.id,facility.id)||{},job=facility.job,
  level=Math.max(0,Number(facility.level)||0),limit=Math.max(0,Number(facility.maxLevel)||0),
  finalLimit=branch.parentCastleId==='edo'?8:24,target=q.targetLevel??(level+1),bookedLevel=q.queuedLevel??(job?.targetLevel||level),
  finished=level>=finalLimit,fullyBooked=bookedLevel>=finalLimit,
  reason=facilityReason(game,branch.id,facility.id,helpers,q),
  state=branch.fallen?'paused':job?'working':finished?'complete':level?'active':'unbuilt',
  label=branch.fallen?'休止中':job?(job.queued?'着工待ち':'普請中'):finished?'大成':level?'稼働中':'未建設',
  action=bookedLevel?'upgrade-branch-facility':'build-branch-facility',
  commandLabel=finished?`最大Lv.${num(finalLimit)}`:fullyBooked?`Lv.${num(finalLimit)}まで予約済み`:q.queued?(target===1?'Lv.1の建設を予約':`Lv.${num(target)}を予約`):level?`Lv.${num(target)}へ増築`:'施設を建てる',
  artId=facility.artId||facility.id,key=helpers.jobKey||workKey,clock=helpers.jobClockText||workClock,
  progress=job&&!job.queued?Math.max(0,Math.min(100,game.constructionProgress?.(job)||0)):0,
  painting=global.SengokuArt?.facility?.(artId,'branch-facility-art',Math.max(1,level))||'<span class="branch-facility-art-fallback" aria-hidden="true">築</span>',
  current=facility.effectText||(level?'効果の詳細を確認してください。':'未建設'),next=facility.nextEffectText||facility.output||'';
 return `<article class="branch-facility-card" data-stable-key="branch-facility-${esc(branch.id)}-${esc(facility.id)}" data-branch-facility="${esc(facility.id)}" data-facility-state="${state}">
  <div class="branch-facility-visual">${painting}<span class="branch-facility-state">${label}</span><span class="branch-facility-level">Lv.<b>${num(level)}</b><small> / ${num(limit)}</small></span></div>
  <div class="branch-facility-content"><h5>${esc(facility.name)}</h5><p class="branch-facility-description">${esc(facility.description||facility.output||'')}</p>
   <dl class="branch-facility-effects"><div><dt>${branch.fallen?'現在の効果（休止中）':'現在の効果'}</dt><dd>${esc(current)}</dd></div>${next&&!fullyBooked?`<div class="branch-facility-next"><dt>${target<=(q.maxLevel??limit)?'Lv.'+num(target)+'の効果':'次の段階'}</dt><dd>${esc(next)}</dd></div>`:''}</dl>
   <div class="branch-facility-work" data-stable-key="branch-facility-work-${esc(branch.id)}-${esc(facility.id)}"${job?'':' hidden'}>${job?`<p>Lv.${num(job.targetLevel)}へ${job.queued?'着工待ち':'普請中'} <span data-job-clock="${esc(key(job))}">${esc(clock(job))}</span></p>${bookedLevel>job.targetLevel?`<p>Lv.${num(bookedLevel)}まで予約済み</p>`:''}<div class="progress" aria-hidden="true"><i data-job-progress="${esc(key(job))}" style="width:${progress}%"></i></div>`:''}</div>
   <div class="branch-facility-order">${fullyBooked?'':price(q,helpers)}<button type="button" class="button gold full branch-facility-action" data-stable-key="branch-facility-action-${esc(branch.id)}-${esc(facility.id)}" data-action="${action}" data-id="${esc(branch.id)}" data-facility="${esc(facility.id)}" aria-label="${esc(facility.name)}：${esc(commandLabel)}"${reason||fullyBooked?' disabled':''}>${commandLabel}</button><p class="branch-reason branch-facility-reason" data-branch-order-reason data-branch-facility-reason="${esc(branch.id)}" data-facility="${esc(facility.id)}"${notice(reason)?'':' hidden'}>${esc(notice(reason))}</p></div>
  </div></article>`;
}
function renderFacilities(game,branch,helpers={},expanded=false){
 if(!own(game,branch.parentCastleId)||!game.branchFacilityStatus)return'';
 const status=game.branchFacilityStatus(branch.id),facilities=status?.facilities||[];
 if(!facilities.length)return'';
 const slots=status.slots||facilities.length,built=status.builtCount||0,projected=status.queuedLevel??branch.level;
 const bonus=bonusMarkup(status.bonuses),summary=branch.fallen?'陥落中 · 施設の効果は休止':bonusSummary(status.bonuses);
 const note=branch.fallen?'支拠点を修復すると、完成済み施設の効果が戻ります。':projected>branch.level?`支拠点は現在Lv.${num(branch.level)}。予約済みの本体Lv.${num(projected)}まで、施設の建設・増築を続けて予約できます。`:branch.level<1?'先に支拠点の建設を手配してください。':`各施設は支拠点と同じLv.${num(branch.level)}まで。支拠点の増築を予約すると、施設の次の段階も手配できます。`;
 return `<details class="branch-facilities" data-stable-key="branch-facilities-${esc(branch.id)}"${expanded?' open':''}><summary><span class="branch-facility-seal" aria-hidden="true">築</span><span class="branch-facility-summary-copy"><strong>支城の施設</strong><span>建設済み <b>${num(built)} / ${num(slots)}</b> · 合計Lv.${num(status.totalLevels)}</span>${summary?`<span class="branch-facility-summary-effects">${esc(summary)}</span>`:''}</span><span class="branch-facility-disclosure" aria-hidden="true"></span></summary><div class="branch-facility-interior">
  <div class="branch-facility-overview"><div><span class="branch-facility-eyebrow">城下を育み、守りを磨く</span><p>${esc(note)}</p></div><div class="branch-facility-slots" aria-hidden="true">${facilities.map(row=>`<i class="${row.job?'is-working':row.level?'is-built':''}"></i>`).join('')}</div></div>
  ${bonus||`<p class="branch-facility-empty-benefit">${branch.fallen?'施設の生産・収容・防衛効果は休止中です。':'田畑や市場、兵舎を築くと、この支拠点から得られる効果をここで確認できます。'}</p>`}
  <div class="branch-facility-grid">${facilities.map(facility=>facilityMarkup(game,branch,facility,helpers)).join('')}</div>
 </div></details>`;
}
function commanderSelection(game,branchId){return commanderChoices.get(game)?.get(branchId)||'';}
function selectCommander(game,branchId,officerId){
 const branch=game.branch?.(branchId)||(game.state.branches||[]).find(row=>row.id===branchId),status=game.branchCommanderStatus?.(branchId),id=String(officerId||'');
 if(!branch||!own(game,branch.parentCastleId)||!status||id&&!status.candidates?.some(row=>row.id===id))return false;
 let saved=commanderChoices.get(game);if(!saved){saved=new Map();commanderChoices.set(game,saved);}saved.set(branchId,id);return true;
}
function commanderReason(game,branchId,helpers={},currentStatus){
 if(helpers.writable===false)return helpers.writableReason||'同期と保存の確認後に武将を配置できます。';
 const status=currentStatus||game.branchCommanderStatus?.(branchId);
 if(!status)return'武将の配置情報を確認できません。';
 if(!status.available)return status.reason||'現在、この支拠点に武将を配置できません。';
 if((status.commanders||[]).length>=status.limit)return `この支拠点の配置武将は${num(status.limit)}名までです。`;
 const selected=commanderSelection(game,branchId),candidate=status.candidates?.find(row=>row.id===selected);
 if(!candidate)return selected?'選択していた武将の所属を確認してください。':'配置する武将を選んでください。';
 return candidate.available?'':candidate.reason||'この武将は現在配置できません。';
}
function autoCommanderReason(game,branchId,helpers={}){
 if(helpers.writable===false)return helpers.writableReason||'同期と保存の確認後に武将を配置できます。';
 const plan=game.branchCommanderAutoPlan?.(branchId);
 return plan?.ok?'':plan?.message||'武将の配置情報を確認できません。';
}
function renderAutoCommanders(game,branchId,helpers={}){
 const plan=game.branchCommanderAutoPlan?.(branchId);if(!plan)return'';
 const all=branchId==='all',reason=autoCommanderReason(game,branchId,helpers),surface=helpers.surface==='modal'?'modal':'map',key='branch-auto-'+surface+'-'+branchId;
 const preview=plan.ok?(all?`${num(plan.assignments.length)}名を、所有する全支拠点の空き枠へ配置します。`:`配置候補：${plan.assignments.map(row=>`${row.name}（${row.rank}）`).join('・')}`):plan.message;
 return `<div class="branch-auto-commanders" data-stable-key="${esc(key)}"${all?` data-branch-auto-panel="all" data-branch-auto-surface="${surface}"`:""}><button type="button" class="button gold full" data-action="auto-assign-branch-commanders" data-id="${esc(branchId)}" aria-describedby="${esc(key)}-preview"${reason?' disabled':''}>${all?'全支拠点にまとめておまかせ配置':'この支拠点におまかせ配置'}</button><p id="${esc(key)}-preview" class="branch-commander-note" data-branch-auto-preview>${esc(notice(helpers.writable===false?reason:preview))}</p><p class="branch-commander-note">統率・知略・武勇の順で未配置の武将を選びます。現在の配置を保ち、指令・資材は使いません。</p></div>`;
}
function renderCommanders(game,branch,helpers={}){
 if(!branch||!own(game,branch.parentCastleId)||!game.branchCommanderStatus)return'';
 const status=game.branchCommanderStatus(branch.id);if(!status)return'';
 const assigned=status.commanders||[],candidates=status.candidates||[],limit=Math.max(0,Math.min(2,Number(status.limit)||0)),selected=commanderSelection(game,branch.id),candidate=candidates.find(row=>row.id===selected),reason=commanderReason(game,branch.id,helpers,status),surface=helpers.surface==='modal'?'modal':'map',key='branch-commanders-'+surface+'-'+branch.id;
 const portrait=row=>global.SengokuArt?.portrait?.(game.officer?.(row.id)||row)||`<span class="branch-commander-portrait-fallback" aria-hidden="true">${esc(String(row.name||'将').slice(0,1))}</span>`;
 const person=(row,context='slot')=>`<div class="branch-commander-portrait" data-stable-key="${esc(key+'-'+context+'-portrait-'+row.id)}">${portrait(row)}</div><div class="branch-commander-person"><span class="officer-rank-label rank-${esc(row.rank)}">${esc(row.rank)}</span><strong>${esc(row.name)}</strong></div>${global.SengokuOfficerHealthUI?.markup(game,row.id,{compact:true,deferred:true})||''}`;
 const slots=Array.from({length:limit},(_,index)=>{const row=assigned[index];return `<article class="branch-commander-slot${row?' is-filled':''}" data-stable-key="${esc(key+'-slot-'+index)}"><span class="branch-commander-slot-label">配置枠 ${index+1}</span>${row?`${person(row)}<button type="button" class="button small" data-action="remove-branch-commander" data-id="${esc(branch.id)}" data-officer="${esc(row.id)}" aria-label="${esc(row.name)}の配置を解除"${helpers.writable===false?' disabled':''}>配置を解除</button>`:'<div class="branch-commander-empty"><span aria-hidden="true">将</span><strong>未配置</strong></div>'}</article>`;}).join('');
 const missing=selected&&!candidate?`<option value="${esc(selected)}" selected disabled>選択していた武将を確認してください</option>`:'';
 return `<section class="branch-commanders" data-stable-key="${esc(key)}" data-branch-commander-panel="${esc(branch.id)}" data-branch-commander-surface="${surface}" aria-labelledby="${esc(key)}-title"><div class="branch-commander-heading"><h5 id="${esc(key)}-title">配置武将</h5><span><b data-branch-commander-count>${num(assigned.length)}</b> / ${num(limit)}名</span></div><p class="branch-commander-intro">${branch.parentCastleId==='edo'?'江戸城':'二条・大坂・名古屋'}の支拠点には、${num(limit)}名まで配置できます。</p><div class="branch-commander-slots">${slots}</div>${renderAutoCommanders(game,branch.id,helpers)}<div class="branch-commander-order"><label for="${esc(key)}-choice">配置する武将</label><select id="${esc(key)}-choice" data-stable-key="${esc(key)}-choice" data-branch-commander-choice="${esc(branch.id)}" aria-describedby="${esc(key)}-reason"><option value=""${selected?'':' selected'}>所持武将から選択</option>${missing}${candidates.map(row=>`<option value="${esc(row.id)}"${row.id===selected?' selected':''}${row.available?'':' disabled'}>${esc(row.name)} · ${esc(row.rank)}${row.available?'':'（'+esc(row.reason||'配置不可')+'）'}</option>`).join('')}</select>${candidate?`<div class="branch-commander-preview" data-stable-key="${esc(key)}-preview">${person(candidate,'preview')}</div>`:''}<button type="button" class="button gold full" data-action="assign-branch-commander" data-id="${esc(branch.id)}" data-officer="${esc(selected)}"${reason?' disabled':''}>この武将を配置する</button><p class="branch-commander-reason" id="${esc(key)}-reason" data-branch-commander-reason role="status"${notice(reason)?'':' hidden'}>${esc(notice(reason))}</p><p class="branch-commander-note">軍団・奉行・ほかの支拠点に配置中の武将は、元の配置を解除してから選べます。配置と解除に指令・資材は使いません。</p></div></section>`;
}
function troopEndpoints(game){return game.troopTransferStatus?.()?.endpoints||[];}
function endpointAllowed(endpoint,side){return Boolean(endpoint)&&(typeof endpoint[side==='from'?'canSource':'canDestination']==='boolean'?endpoint[side==='from'?'canSource':'canDestination']:endpoint.available!==false);}
function endpointReason(endpoint,side){return endpoint?.[side==='from'?'sourceReason':'destinationReason']||endpoint?.reason||'';}
function troopTransferSelection(game,parentId){
 let saved=troopChoices.get(game);if(!saved){saved=new Map();troopChoices.set(game,saved);}
 if(!saved.has(parentId)){
  const endpoints=troopEndpoints(game),army=endpoints.find(row=>row.id==='army'&&endpointAllowed(row,'from')),source=army||endpoints.find(row=>endpointAllowed(row,'from')),
   parent=endpoints.find(row=>row.id==='castle:'+parentId&&endpointAllowed(row,'to')&&row.id!==source?.id),destination=parent||endpoints.find(row=>endpointAllowed(row,'to')&&row.id!==source?.id);
  saved.set(parentId,{from:source?.id||'',to:destination?.id||'',troops:'1'});
 }
 return {...saved.get(parentId)};
}
function setTroopTransferSelection(game,parentId,patch={}){
 if(!game||!own(game,parentId))return false;
 const draft=troopTransferSelection(game,parentId),endpoints=troopEndpoints(game);let changed=false;
 for(const key of ['from','to','troops']){
  if(!Object.hasOwn(patch,key))continue;
  const value=String(patch[key]??'').slice(0,key==='troops'?20:180);
  if(key!=='troops'&&value&&!endpoints.some(row=>row.id===value))return false;
  draft[key]=value;changed=true;
 }
 if(changed)troopChoices.get(game).set(parentId,draft);
 return changed;
}
function troopTransferQuote(game,parentId){
 const draft=troopTransferSelection(game,parentId),amount=/^[0-9]+$/.test(draft.troops)?Number(draft.troops):0;
 if(!game.troopTransferQuote)return{ok:false,reason:'兵の移動情報を確認できません。',maxTroops:0,from:draft.from,to:draft.to,troops:0};
 return game.troopTransferQuote(draft.from,draft.to,Number.isSafeInteger(amount)?amount:0);
}
function troopTransferReason(game,parentId,helpers={},currentQuote){
 if(helpers.writable===false)return helpers.writableReason||'同期と保存の確認後に兵を移動できます。';
 const q=currentQuote||troopTransferQuote(game,parentId);
 return q?.ok?'':q?.reason||q?.message||'兵の移動条件を確認してください。';
}
function troopCost(q){
 const labels={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'},resources=Object.entries(q.cost||{}).filter(([key,value])=>labels[key]&&Number(value)>0).map(([key,value])=>labels[key]+' '+num(value));
 return `移動に指令${num(q.commandCost??1)}回${resources.length?' · '+resources.join(' · '):' · 資材の消費なし'}`;
}
function renderTroopTransfer(game,parentId,helpers={}){
 if(!own(game,parentId)||!game.troopTransferStatus||!game.troopTransferQuote)return'';
 const endpoints=troopEndpoints(game),draft=troopTransferSelection(game,parentId),q=troopTransferQuote(game,parentId),source=endpoints.find(row=>row.id===draft.from),destination=endpoints.find(row=>row.id===draft.to),reason=troopTransferReason(game,parentId,helpers,q),max=Math.max(0,Number(q.maxTroops)||0),surface=helpers.surface==='modal'?'modal':'map',key='branch-troop-'+surface+'-'+parentId;
 const option=(row,side)=>`<option value="${esc(row.id)}"${row.id===draft[side]?' selected':''}${endpointAllowed(row,side)?'':' disabled'}>${esc(row.name)} · ${num(row.troops)}人${endpointAllowed(row,side)?'':'（利用不可）'}</option>`;
 function options(side){
  const selected=endpoints.some(row=>row.id===draft[side]);
  const empty=`<option value=""${draft[side]?'':' selected'}>移動${side==='from'?'元':'先'}を選択</option>`;
  const missing=draft[side]&&!selected?`<option value="${esc(draft[side])}" selected disabled>選択していた拠点を確認してください</option>`:'';
  return empty+missing+[['army','本隊'],['castle','城'],['branch','支拠点']].map(([kind,label])=>{const rows=endpoints.filter(row=>row.kind===kind);return rows.length?`<optgroup label="${label}">${rows.map(row=>option(row,side)).join('')}</optgroup>`:'';}).join('');
 }
 const stock=row=>row?`現在 <b>${num(row.troops)}</b>人 / 上限 ${num(row.capacity)}人`:'拠点を選んでください。';
 const after=(before,value)=>`<span>${num(before)}</span><span class="branch-troop-arrow" aria-hidden="true">→</span><strong><span class="sr-only">移動後 </span>${q.ok&&Number.isSafeInteger(value)?num(value):'—'}<small>人</small></strong>`;
 const roster=endpoints.map(row=>`<li data-stable-key="${esc(key+'-stock-'+row.id)}"><div><strong>${esc(row.name)}</strong>${row.reason?`<small>${esc(row.reason)}</small>`:''}</div><span><b>${num(row.troops)}</b><small> / ${num(row.capacity)}人</small></span></li>`).join('');
 return `<section class="branch-troop-transfer" data-stable-key="${esc(key)}" data-branch-troop-panel="${esc(parentId)}" data-branch-troop-surface="${surface}" aria-labelledby="${esc(key)}-title">
  <header class="branch-troop-heading"><span class="branch-troop-eyebrow">兵を配置し、守りを整える</span><h3 id="${esc(key)}-title">兵の配置・移動</h3><p>配置した兵は、その拠点に駐留します。別の拠点へ移すか、移動先に「本隊」を選んで戻せます。</p><p class="branch-troop-cycle-note">時代開始時の本拠以外にある城の守備兵は、時代の切り替わりに領地とともにリセットされます。残す兵は切り替わり前に本隊へ戻してください。支拠点の駐留兵は「帰還待機」から撤収できます。</p></header>
  <details class="branch-troop-roster" data-stable-key="${esc(key)}-roster"><summary>現在の兵の配置 <span>${num(endpoints.length)}か所</span></summary><ul>${roster}</ul></details>
  <form class="branch-troop-form" data-branch-troop-form data-branch-troop-parent="${esc(parentId)}" novalidate>
   <div class="branch-troop-route">${[['from','移動元',source],['to','移動先',destination]].map(([side,label,endpoint])=>`<div class="branch-troop-location"><label for="${esc(key+'-'+side)}">${label}</label><select id="${esc(key+'-'+side)}" name="${side}" data-stable-key="${esc(key+'-'+side)}" data-branch-troop-field="${side}" data-branch-troop-parent="${esc(parentId)}" aria-describedby="${esc(key+'-'+side+'-stock')}">${options(side)}</select><p id="${esc(key+'-'+side+'-stock')}" class="branch-troop-stock">${stock(endpoint)}</p>${endpoint&&!endpointAllowed(endpoint,side)?`<p class="branch-troop-location-reason">${esc(endpointReason(endpoint,side))}</p>`:''}</div>`).join('')}</div>
   <label for="${esc(key)}-troops">移動する人数</label><div class="branch-troop-amount"><input id="${esc(key)}-troops" name="troops" type="number" inputmode="numeric" min="1" max="${max}" step="1" required value="${esc(draft.troops)}" data-stable-key="${esc(key)}-troops" data-branch-troop-field="troops" data-branch-troop-parent="${esc(parentId)}" aria-describedby="${esc(key)}-limit ${esc(key)}-reason"><span>人</span><button type="button" class="button small" data-action="branch-troop-max" data-id="${esc(parentId)}"${max>0?'':' disabled'}>最大 ${num(max)}人</button></div>
   <p class="branch-troop-limit" id="${esc(key)}-limit">移動できる人数 <b data-branch-troop-max>${num(max)}</b>人まで</p>
   <dl class="branch-troop-preview" aria-label="移動後の兵数"><div><dt>移動元</dt><dd>${source?after(q.sourceBefore??source.troops,q.sourceAfter):'—'}</dd></div><div><dt>移動先</dt><dd>${destination?after(q.destinationBefore??destination.troops,q.destinationAfter):'—'}</dd></div></dl>
   <div class="branch-troop-order"><p class="branch-troop-cost" data-branch-troop-cost>${esc(troopCost(q))}<span>指令残り <b>${num(game.state.command)}</b>回</span></p><button type="submit" class="button gold full" data-stable-key="${esc(key)}-submit" data-branch-troop-submit${reason?' disabled':''}>兵を移動する</button><p class="branch-troop-reason" id="${esc(key)}-reason" data-branch-troop-reason role="status"${notice(reason)?'':' hidden'}>${esc(notice(reason))}</p></div>
  </form>
 </section>`;
}
function renderBranches(game,parentId,helpers={}){
 if(parentId===(global.SENGOKU_DATA?.staffBaseId||'kyoto_gosho'))return '<section class="castle-branches branch-none" data-stable-key="branches-kyoto_gosho"><h3>支拠点</h3><p>京都御所には支拠点を設けません。</p></section>';
 if(!parents.includes(parentId)||!game.branchStatus)return'';
 const status=game.branchStatus(parentId),owned=own(game,parentId),writable=helpers.writable!==false,direction=selection(game,parentId),next=direction?quote(game,'build',{parentCastleId:parentId,direction}):null,rows=status.branches||[],active=rows.filter(branch=>branch.level>0&&!branch.fallen),limit=status.maxLevel|| (parentId==='edo'?8:24);
 function orderReason(q){
  const reason=writable?q?.reason||q?.message||'':helpers.writableReason||'同期と保存の確認後に普請できます。';
  return `<p class="branch-reason" data-branch-order-reason${notice(reason)?'':' hidden'}>${esc(notice(reason))}</p>`;
 }
 const row=(branch,index)=>{
  const jobs=branch.jobs||[branch.job].filter(Boolean),job=jobs[0],
   q=owned?quote(game,branch.fallen?'repair':'upgrade',{branchId:branch.id}):null,
   preview=!owned&&branch.level>0&&!branch.fallen?game.previewBranchBattle?.(branch.id,'balanced',game.state.troops):null;
  const bodyLabel=branch.fallen?'同じレベルで修復する':q?.queued?`支拠点 Lv.${num(q.targetLevel)}を予約`:`Lv.${num(q?.targetLevel)}へ増築する`;
  const construction=owned?q?.cost&&q.targetLevel<=limit?`${price(q,helpers)}<button type="button" class="button full" data-action="${branch.fallen?'repair-branch':'upgrade-branch'}" data-id="${esc(branch.id)}"${writable&&q.ok?'':' disabled'}>${bodyLabel}</button>${orderReason(q)}`:`<p class="branch-reason">${esc(q?.reason||q?.message||'この支拠点の普請は現在できません。')}</p>`
   :branch.level>0&&!branch.fallen?`<button type="button" class="button primary full" data-action="prepare-branch-battle" data-id="${esc(branch.id)}"${preview?.ok&&writable?'':' disabled'}>この支拠点へ出陣</button>${preview?.ok?'':`<p class="branch-reason">${esc(preview?.message||preview?.reason||'出陣条件を確認してください。')}</p>`}`:'<p class="branch-reason">この支拠点は本城への進軍を遮りません。</p>';
  const stationed=owned?troopEndpoints(game).find(row=>row.id==='branch:'+branch.id)?.troops??branch.stationedTroops??0:0;
  return `<article class="branch-card${branch.fallen?' is-fallen':''}" data-stable-key="branch-${esc(branch.id)}"><div class="branch-card-heading">${art(parentId,branch.direction,branch.level)}<div><h4>${esc(branch.name||name(game,branch.id))}</h4><b>${branch.level?`Lv.${num(branch.level)} / ${num(limit)}`:'建設中'}</b><span class="branch-status">${job?(job.facilityId?'施設普請中':job.repair?'修復中':'普請中'):branch.fallen?'陥落':branch.level>0?'防衛中':'未完成'}</span></div></div>${owned?`<div class="branch-stationed"><span>配置済みの駐留兵</span><strong data-branch-stationed="${esc(branch.id)}">${num(stationed)}<small>人</small></strong><p>${branch.fallen?'残っている駐留兵は、移動元にこの支拠点を選んで撤収できます。':'この兵を配置・移動できます。本城からの守備支援は、この人数には含みません。'}</p></div>`:''}${renderCommanders(game,branch,helpers)}${owned?queueMarkup(branch,jobs,helpers):''}<div class="branch-defense-order">${construction}</div>${renderFacilities(game,branch,helpers,index===0)}</article>`;
 };
 const instructions=owned?`<p class="branch-booking-rule">指令残り <b data-branch-commands>${num(game.state.command)}</b> 回。普請1件につき指令1回と資材を使います。同じ支拠点では本体と施設が予約順に着工し、別の支拠点は普請枠の範囲で並行して進みます。</p>`:'';
 return `<section class="castle-branches" data-stable-key="branches-${esc(parentId)}"><div class="branch-section-heading"><h3>支拠点</h3><b>${rows.length} / ${num(status.maxBranches)}</b></div><p>${esc(status.parentName||game.castle(parentId)?.name)}の東西南北から方位を選び、最大${num(status.maxBranches)}か所を築けます。各Lv.${num(limit)}まで成長します。</p><p class="branch-rule">${active.length?`防衛中の支拠点 ${active.length}か所を落とすと、本城へ出陣できます。`:'防衛中の支拠点はありません。'}支拠点は領地数に加算されません。</p>${instructions}${owned&&rows.length?renderAutoCommanders(game,'all',helpers):''}<div class="branch-cards">${rows.map(row).join('')||'<p class="branch-empty">支拠点はまだありません。</p>'}</div>${owned&&rows.length<status.maxBranches?`<div class="branch-build" data-stable-key="branch-build-${esc(parentId)}"><label for="branch-direction-${esc(parentId)}">新しい支拠点の方位</label><select id="branch-direction-${esc(parentId)}" data-branch-parent="${esc(parentId)}">${(status.directions||[]).filter(item=>item.available).map(item=>`<option value="${esc(item.id)}"${item.id===direction?' selected':''}>${esc(directions[item.id]||item.name)}側</option>`).join('')}</select>${price(next,helpers)}<button class="button gold full" data-action="build-branch" data-id="${esc(parentId)}" data-direction="${esc(direction)}"${next?.ok&&writable?'':' disabled'}>${esc(directions[direction]||'選んだ方位')}に支拠点を築く</button>${orderReason(next)}</div>`:''}<p class="branch-map-note">地図の支拠点は本城の方位を示す配置です。史実の所在地・距離を表すものではありません。</p></section>`;
}
function render(game,parentId,helpers={}){return renderTroopTransfer(game,parentId,helpers)+renderBranches(game,parentId,helpers);}
function mapBranches(game){return parents.flatMap(parentId=>(game.branchStatus?.(parentId)?.branches||[]).map(branch=>({id:branch.id,parentCastleId:parentId,direction:branch.direction,name:branch.name||name(game,branch.id),level:branch.level,fallen:branch.fallen===true,building:!!branch.job,facilityBuilding:!!branch.job?.facilityId,own:own(game,parentId)})));}
function mapAppearance(marker){if(!marker?.branch)return null;return{html:`<span class="branch-map-art${marker.fallen?' is-fallen':''}">${art(marker.parentCastleId,marker.direction,marker.level,'branch-map-castle-art')}<span class="branch-map-direction">${esc(directions[marker.direction]||'')}</span><b>${marker.fallen?'陥落':marker.level?'Lv.'+num(marker.level):'普請'}</b></span>`,label:`${marker.name} ${marker.fallen?'陥落':marker.facilityBuilding?'施設普請中':marker.building?'普請中':'防衛中'} Lv.${num(marker.level)}。本城の${directions[marker.direction]||''}側を示す配置`};}
const api={render,renderCommanders,renderAutoCommanders,autoCommanderReason,commanderSelection,selectCommander,commanderReason,renderTroopTransfer,troopTransferSelection,setTroopTransferSelection,troopTransferQuote,troopTransferReason,renderFacilities,facilityReason,jobName,name,selection,selectDirection,transferSelection,quote,mapBranches,mapAppearance};global.SengokuBranches=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
