/* Attached outposts use engine quotes and parent geography; they are not castles. */
(function(global){
'use strict';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const directions={north:'北',east:'東',south:'南',west:'西'},parents=['edo','nijo','osaka','nagoya'],choices=new WeakMap();
const num=value=>Math.max(0,Math.floor(Number(value)||0)).toLocaleString('ja-JP');
function name(game,branchId){const branch=(game?.state?.branches||[]).find(row=>row.id===branchId);return branch?(game.castle(branch.parentCastleId)?.name||branch.parentCastleId)+' '+(directions[branch.direction]||'')+'支拠点':'支拠点';}
function selection(game,parentId){const status=game.branchStatus?.(parentId),available=status?.directions?.filter(row=>row.available)||[];let saved=choices.get(game);if(!saved){saved=new Map();choices.set(game,saved);}const current=saved.get(parentId);if(!available.some(row=>row.id===current))saved.set(parentId,available[0]?.id||'');return saved.get(parentId)||'';}
function selectDirection(game,parentId,direction){const status=game.branchStatus?.(parentId);if(!status?.directions?.some(row=>row.id===direction&&row.available))return false;selection(game,parentId);choices.get(game).set(parentId,direction);return true;}
function transferSelection(previous,next){const campaign=previous?.state?.walking?.campaignId;if(!campaign||campaign!==next?.state?.walking?.campaignId||previous.state.home!==next.state.home||previous.state.clan!==next.state.clan||previous.isAdmin!==next.isAdmin||previous.isStaff!==next.isStaff)return false;const saved=choices.get(previous);if(!saved)return false;choices.set(next,new Map(saved));for(const parentId of saved.keys())selection(next,parentId);return true;}
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
function facilityMarkup(game,branch,facility,helpers={}){
 const q=facility.quote||game.branchFacilityQuote?.(branch.id,facility.id)||{},job=facility.job,
  level=Math.max(0,Number(facility.level)||0),limit=Math.max(0,Number(facility.maxLevel)||0),
  finalLimit=branch.parentCastleId==='edo'?8:24,finished=level>=finalLimit,
  reason=facilityReason(game,branch.id,facility.id,helpers,q),
  state=branch.fallen?'paused':job?'working':finished?'complete':level?'active':'unbuilt',
  label=branch.fallen?'休止中':job?'普請中':finished?'大成':level?'稼働中':'未建設',
  action=level?'upgrade-branch-facility':'build-branch-facility',
  commandLabel=job?`Lv.${num(job.targetLevel)}へ普請中`:finished?`最大Lv.${num(finalLimit)}`:level?`Lv.${num(q.targetLevel||level+1)}へ増築`:'施設を建てる',
  artId=facility.artId||facility.id,key=helpers.jobKey||(j=>`${j.kind}:${j.id}:personal:${j.targetLevel}`),
  clock=helpers.jobClockText||(j=>`あと ${num(Math.ceil(j.remainingSeconds||0))}秒`),
  progress=job?Math.max(0,Math.min(100,game.constructionProgress?.(job)||0)):0,
  painting=global.SengokuArt?.facility?.(artId,'branch-facility-art',Math.max(1,level))||'<span class="branch-facility-art-fallback" aria-hidden="true">築</span>',
  current=facility.effectText||(level?'効果の詳細を確認してください。':'未建設'),
  next=facility.nextEffectText||facility.output||'',
  cost=q.cost&&(helpers.costHtml?helpers.costHtml(q.cost):`<p class="branch-facility-cost">金銭 ${num(q.cost.gold)} · 木材 ${num(q.cost.wood)} · 石材 ${num(q.cost.stone)} · ${num(q.cost.seconds)}秒</p>`);
 return `<article class="branch-facility-card" data-stable-key="branch-facility-${esc(branch.id)}-${esc(facility.id)}" data-branch-facility="${esc(facility.id)}" data-facility-state="${state}">
  <div class="branch-facility-visual">${painting}<span class="branch-facility-state">${label}</span><span class="branch-facility-level">Lv.<b>${num(level)}</b><small> / ${num(limit)}</small></span></div>
  <div class="branch-facility-content"><h5>${esc(facility.name)}</h5><p class="branch-facility-description">${esc(facility.description||facility.output||'')}</p>
   <dl class="branch-facility-effects"><div><dt>${branch.fallen?'現在の効果（休止中）':'現在の効果'}</dt><dd>${esc(current)}</dd></div>${next?`<div class="branch-facility-next"><dt>${job?'完成すると':finished?'到達した段階':'次の段階'}</dt><dd>${esc(next)}</dd></div>`:''}</dl>
   <div class="branch-facility-work" data-stable-key="branch-facility-work-${esc(branch.id)}-${esc(facility.id)}"${job?'':' hidden'}>${job?`<p>Lv.${num(job.targetLevel)}へ普請 <span data-job-clock="${esc(key(job))}">${esc(clock(job))}</span></p><div class="progress" aria-hidden="true"><i data-job-progress="${esc(key(job))}" style="width:${progress}%"></i></div>`:''}</div>
   <div class="branch-facility-order">${cost&&!job&&!finished?`${cost}<p class="branch-command">指令 ${num(q.commandCost||1)}回 · 工期は1倍速換算</p>`:''}<button type="button" class="button gold full branch-facility-action" data-stable-key="branch-facility-action-${esc(branch.id)}-${esc(facility.id)}" data-action="${action}" data-id="${esc(branch.id)}" data-facility="${esc(facility.id)}" aria-label="${esc(facility.name)}：${esc(commandLabel)}"${reason||job||finished?' disabled':''}>${commandLabel}</button><p class="branch-reason branch-facility-reason" data-branch-facility-reason="${esc(branch.id)}" data-facility="${esc(facility.id)}"${reason?'':' hidden'}>${esc(reason)}</p></div>
  </div></article>`;
}
function renderFacilities(game,branch,helpers={},expanded=false){
 if(!own(game,branch.parentCastleId)||!game.branchFacilityStatus)return'';
 const status=game.branchFacilityStatus(branch.id),facilities=status?.facilities||[];
 if(!facilities.length)return'';
 const slots=status.slots||facilities.length,built=status.builtCount||0,working=facilities.find(row=>row.job),
  key=helpers.jobKey||(j=>`${j.kind}:${j.id}:personal:${j.targetLevel}`),clock=helpers.jobClockText||(()=>''),
  bonus=bonusMarkup(status.bonuses),summary=branch.fallen?'陥落中 · 施設の効果は休止':bonusSummary(status.bonuses),note=branch.fallen?'支拠点を修復すると、完成済み施設の効果が戻ります。':branch.level<1?'支拠点が完成すると施設の普請を始められます。':`各施設は支拠点と同じLv.${num(status.maxLevel)}まで。支拠点の増築で、施設の上限も上がります。`;
 return `<details class="branch-facilities" data-stable-key="branch-facilities-${esc(branch.id)}"${expanded?' open':''}><summary><span class="branch-facility-seal" aria-hidden="true">築</span><span class="branch-facility-summary-copy"><strong>支城の施設</strong><span>建設済み <b>${num(built)} / ${num(slots)}</b> · 合計Lv.${num(status.totalLevels)}</span>${summary?`<span class="branch-facility-summary-effects">${esc(summary)}</span>`:''}</span><span class="branch-facility-disclosure" aria-hidden="true"></span></summary><div class="branch-facility-interior">
  <div class="branch-facility-overview"><div><span class="branch-facility-eyebrow">城下を育み、守りを磨く</span><p>${esc(note)}</p></div><div class="branch-facility-slots" aria-hidden="true">${facilities.map(row=>`<i class="${row.job?'is-working':row.level?'is-built':''}"></i>`).join('')}</div></div>
  ${bonus||`<p class="branch-facility-empty-benefit">${branch.fallen?'施設の生産・収容・防衛効果は休止中です。':'田畑や市場、兵舎を築くと、この支拠点から得られる効果をここで確認できます。'}</p>`}
  ${working?`<p class="branch-facility-running"><b>${esc(working.name)}を普請中</b><span data-job-clock="${esc(key(working.job))}">${esc(clock(working.job))}</span></p>`:''}
  <div class="branch-facility-grid">${facilities.map(facility=>facilityMarkup(game,branch,facility,helpers)).join('')}</div><p class="branch-facility-footnote">一つの支拠点で進められる普請は1件です。施設も通常の普請枠・資源・指令を使い、完成後に効果が加わります。</p>
 </div></details>`;
}
function render(game,parentId,helpers={}){
 if(parentId===(global.SENGOKU_DATA?.staffBaseId||'kyoto_gosho'))return '<section class="castle-branches branch-none" data-stable-key="branches-kyoto_gosho"><h3>支拠点</h3><p>京都御所には支拠点を設けません。</p></section>';
 if(!parents.includes(parentId)||!game.branchStatus)return'';
 const status=game.branchStatus(parentId),owned=own(game,parentId),writable=helpers.writable!==false,direction=selection(game,parentId),next=direction?quote(game,'build',{parentCastleId:parentId,direction}):null,cost=helpers.costHtml||(()=>''),clock=helpers.jobClockText||(()=>''),key=helpers.jobKey||(job=>`${job.kind}:${job.id}:personal:${job.targetLevel}`),rows=status.branches||[],active=rows.filter(branch=>branch.level>0&&!branch.fallen),limit=status.maxLevel|| (parentId==='edo'?8:24);
 const price=q=>q?.cost?cost(q.cost)+`<p class="branch-command">指令 ${num(q.commandCost||1)}回</p>`:'';
 const row=(branch,index)=>{
  const job=branch.job||game.constructionJobs?.().find(item=>item.kind==='branch'&&item.id===branch.id),branchJob=job&&!job.facilityId?job:null,
   q=!branchJob?quote(game,branch.fallen?'repair':'upgrade',{branchId:branch.id}):null,
   preview=!owned&&branch.level>0&&!branch.fallen?game.previewBranchBattle?.(branch.id,'balanced',game.state.troops):null;
  const construction=branchJob?`<p class="branch-progress-label">${branchJob.repair?'修復':'Lv.'+num(branchJob.targetLevel)+'へ普請'} · <span data-job-clock="${esc(key(branchJob))}">${esc(clock(branchJob))}</span></p><div class="progress" aria-hidden="true"><i data-job-progress="${esc(key(branchJob))}" style="width:${Math.max(0,Math.min(100,game.constructionProgress?.(branchJob)||0))}%"></i></div>`
   :owned?`${price(q)}${q?.cost&&q.targetLevel<=limit?`<button type="button" class="button full" data-action="${branch.fallen?'repair-branch':'upgrade-branch'}" data-id="${esc(branch.id)}"${writable&&q.ok?'':' disabled'}>${branch.fallen?'同じレベルで修復する':'Lv.'+num(q.targetLevel)+'へ増築する'}</button>${q.ok?'':`<p class="branch-reason">${esc(q.reason||q.message)}</p>`}`:`<p class="branch-reason">${esc(q?.reason||q?.message||'この支拠点の普請は現在できません。')}</p>`}`
   :branch.level>0&&!branch.fallen?`<button type="button" class="button primary full" data-action="prepare-branch-battle" data-id="${esc(branch.id)}"${preview?.ok&&writable?'':' disabled'}>この支拠点へ出陣</button>${preview?.ok?'':`<p class="branch-reason">${esc(preview?.message||preview?.reason||'出陣条件を確認してください。')}</p>`}`:'<p class="branch-reason">この支拠点は本城への進軍を遮りません。</p>';
  return `<article class="branch-card${branch.fallen?' is-fallen':''}" data-stable-key="branch-${esc(branch.id)}"><div class="branch-card-heading">${art(parentId,branch.direction,branch.level)}<div><h4>${esc(branch.name||name(game,branch.id))}</h4><b>${branch.level?`Lv.${num(branch.level)} / ${num(limit)}`:'建設中'}</b><span class="branch-status">${job?(job.facilityId?'施設普請中':job.repair?'修復中':'普請中'):branch.fallen?'陥落':branch.level>0?'防衛中':'未完成'}</span></div></div><div class="branch-defense-order">${construction}</div>${renderFacilities(game,branch,helpers,index===0)}</article>`;
 };
 return `<section class="castle-branches" data-stable-key="branches-${esc(parentId)}"><div class="branch-section-heading"><h3>支拠点</h3><b>${rows.length} / ${num(status.maxBranches)}</b></div><p>${esc(status.parentName||game.castle(parentId)?.name)}の東西南北から方位を選び、最大${num(status.maxBranches)}か所を築けます。各Lv.${num(limit)}まで成長します。</p><p class="branch-rule">${active.length?`防衛中の支拠点 ${active.length}か所を落とすと、本城へ出陣できます。`:'防衛中の支拠点はありません。'}支拠点は領地数に加算されません。</p><div class="branch-cards">${rows.map(row).join('')||'<p class="branch-empty">支拠点はまだありません。</p>'}</div>${owned&&rows.length<status.maxBranches?`<div class="branch-build" data-stable-key="branch-build-${esc(parentId)}"><label for="branch-direction-${esc(parentId)}">新しい支拠点の方位</label><select id="branch-direction-${esc(parentId)}" data-branch-parent="${esc(parentId)}">${(status.directions||[]).filter(item=>item.available).map(item=>`<option value="${esc(item.id)}"${item.id===direction?' selected':''}>${esc(directions[item.id]||item.name)}側</option>`).join('')}</select>${price(next)}<button class="button gold full" data-action="build-branch" data-id="${esc(parentId)}" data-direction="${esc(direction)}"${next?.ok&&writable?'':' disabled'}>${esc(directions[direction]||'選んだ方位')}に支拠点を築く</button>${next?.ok?'':`<p class="branch-reason">${esc(next?.reason||next?.message||status.reason||'建設できる方位を確認してください。')}</p>`}</div>`:''}<p class="branch-map-note">地図の支拠点は本城の方位を示す配置です。史実の所在地・距離を表すものではありません。</p></section>`;
}
function mapBranches(game){return parents.flatMap(parentId=>(game.branchStatus?.(parentId)?.branches||[]).map(branch=>({id:branch.id,parentCastleId:parentId,direction:branch.direction,name:branch.name||name(game,branch.id),level:branch.level,fallen:branch.fallen===true,building:!!branch.job,facilityBuilding:!!branch.job?.facilityId,own:own(game,parentId)})));}
function mapAppearance(marker){if(!marker?.branch)return null;return{html:`<span class="branch-map-art${marker.fallen?' is-fallen':''}">${art(marker.parentCastleId,marker.direction,marker.level,'branch-map-castle-art')}<span class="branch-map-direction">${esc(directions[marker.direction]||'')}</span><b>${marker.fallen?'陥落':marker.level?'Lv.'+num(marker.level):'普請'}</b></span>`,label:`${marker.name} ${marker.fallen?'陥落':marker.facilityBuilding?'施設普請中':marker.building?'普請中':'防衛中'} Lv.${num(marker.level)}。本城の${directions[marker.direction]||''}側を示す配置`};}
const api={render,renderFacilities,facilityReason,jobName,name,selection,selectDirection,transferSelection,quote,mapBranches,mapAppearance};global.SengokuBranches=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
