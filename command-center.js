/* A read-only briefing of the current campaign. Actions use the existing UI. */
(function (global) {
  'use strict';
  const resources = {gold:'金銭', rice:'兵糧', wood:'木材', stone:'石材'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const number = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('ja-JP');
  const signed = value => { const n = Number(value) || 0; return (n < 0 ? '−' : n > 0 ? '+' : '') + number(Math.abs(n)); };
  const filters = {all:'すべて',construction:'普請',research:'研究',marching:'進軍・派遣',returning:'帰還'};
  const checkedTimeFormat = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const marchKinds = {castle:'城への出陣',branch:'支拠点への出陣',field:'共通フィールド',roaming:'野良兵への出陣',rally:'同盟の集結軍',conquest:'天下争覇',covert:'部隊の派遣'};
  const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0,Number(value)) : 0;
  function duration(ms) {
    const seconds=Math.max(0,Math.ceil(nonnegative(ms)/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
    return (hours?hours+'時間':'')+(minutes?minutes+'分':'')+(rest||!hours&&!minutes?rest+'秒':'');
  }
  function operationClock(game, supplied) {
    const state=game?.state||{},live=supplied||global.SengokuWorldClock?.snapshot?.()?.clock||{},stored=state.worldClock||{},realtime=state.realtime||{};
    const speed=Number(live.speed??realtime.speed),elapsedMs=live.elapsedMs??stored.elapsedMs??((state.turn||0)*60000+(realtime.elapsed||0)*1000);
    return {elapsedMs:nonnegative(elapsedMs),realNowMs:nonnegative(live.realNowMs??Date.now()),running:(live.running??realtime.running)!==false,speed:[1,2,4].includes(speed)?speed:1};
  }
  // A budget is a transparent fixed-income projection, never a future save or
  // permission to spend. In particular, deficits may change at month-end.
  function buildBudget(game, targets = {}, options = {}) {
    const catalog=options.catalog||global.SENGOKU_DATA||{},cap=catalog.assetCap||100000000,monthMs=(catalog.secondsPerMonth||60)*1000;
    const income=options.income||game?.income?.()||{},clock=operationClock(game,options.clock),rows=[];
    let earliest=0,latest=Infinity;
    for(const [key,label] of Object.entries(resources)) {
      const raw=targets[key]??0,target=raw===''?0:Number(raw),valid=Number.isSafeInteger(target)&&target>=0;
      const current=Math.min(cap,Math.floor(nonnegative(game?.state?.resources?.[key]))),rawRate=Number(income.net?.[key]??income[key]??0),rate=Number.isFinite(rawRate)?rawRate:0;
      const deficit=valid?Math.max(0,target-current):0,months=deficit&&rate>0?deficit/rate:0;
      if(months>earliest)earliest=months;
      if(rate<0&&valid&&target>0&&current>=target)latest=Math.min(latest,(current-target)/-rate);
      rows.push({key,label,current,target,valid,rate,deficit,months,overCap:valid&&target>cap,blocked:deficit>0&&rate<=0,
        after:[1,3,6].map(month=>Math.max(0,Math.min(cap,Math.floor(current+rate*month))))});
    }
    const invalid=rows.some(row=>!row.valid),overCap=rows.filter(row=>row.overCap),blocked=rows.filter(row=>row.blocked);
    const ready=!invalid&&!overCap.length&&rows.every(row=>row.deficit===0),expires=!ready&&earliest>latest+1e-9;
    const status=invalid?'invalid':overCap.length?'cap':ready?'ready':blocked.length?'blocked':!clock.running?'paused':expires?'expires':'waiting';
    const limiting=rows.filter(row=>row.deficit&&row.rate>0&&Math.abs(row.months-earliest)<1e-9).map(row=>row.label);
    const waitMs=status==='waiting'?Math.ceil(earliest*monthMs/clock.speed/1000)*1000:null;
    const title={invalid:'目標は0以上の整数で入力',cap:'保有上限を超える予算です',ready:'必要な資源は揃っています',blocked:'現在の収支では不足を解消できません',paused:'共通時間は停止中です',expires:'揃う前に別の資源が不足します',waiting:'約'+duration(waitMs)+'で資源が揃う試算'}[status];
    const detail={invalid:'空欄は0として扱います。小数・負数は使えません。',cap:overCap.map(row=>row.label).join('・')+'は保有上限 '+number(cap)+' を超えています。',ready:'資源だけの判定です。必要な指令・解放条件・普請枠は各画面で確認できます。',blocked:blocked.map(row=>row.label).join('・')+'の生産を増やすか、予算を見直してください。',paused:'不足額は表示します。時間が動き始めると待ち時間を試算します。',expires:'赤字の資源が先に減るため、4資源が同時には揃わない試算です。',waiting:limiting.join('・')+'が揃うまでの目安 · 現在 '+clock.speed+'倍速'}[status];
    return {rows,status,title,detail,waitMs,clock,cap,earliest,latest,militaryDeficit:rows.some(row=>['gold','rice'].includes(row.key)&&row.rate<0)};
  }
  function budgetGoal(game, selection = {}, options = {}) {
    const catalog=options.catalog||global.SENGOKU_DATA||{},kind=selection.kind,id=selection.id,state=game?.state||{};
    if(kind==='custom')return {kind,title:'自由な予算',targets:selection.targets||{},note:'使いたい資源の合計を入力してください。',destination:'facilities'};
    if(!['building','research'].includes(kind))return {unavailable:true,title:'目標を選んでください',note:'施設・研究、または自由入力から選べます。'};
    const item=(kind==='building'?catalog.buildings:catalog.techs)?.find(row=>row.id===id);
    if(!item)return {unavailable:true,title:'目標が見つかりません',note:'一覧から選び直してください。'};
    if(game?.isStaff&&options.staffReady!==true)return {unavailable:true,title:'共同拠点を確認中です',note:'共同拠点の最新情報を確認してから費用を表示します。'};
    const jobs=game?.constructionJobs?.()||state.jobs||[];
    if(kind==='research'&&jobs.some(job=>job.kind==='research'&&job.id===id))return {unavailable:true,title:item.name+'は研究中です',note:'完成後の新しい段階で、次の費用を試算できます。'};
    const chain=jobs.filter(job=>job.kind===kind&&job.id===id&&(game?.isStaff?job.shared:!job.shared));
    const level=kind==='building'?Math.max(state.buildings?.[id]||0,...chain.map(job=>job.targetLevel||0)):state.tech?.[id]||0;
    const limit=kind==='building'?(catalog.buildingLimit||32):item.max;
    if(level>=limit)return {unavailable:true,title:item.name+'は最高段階です',note:'別の施設・研究を選んでください。'};
    const cost=kind==='building'?game?.costs?.(id,level):game?.researchCost?.(id);
    if(!cost)return {unavailable:true,title:'費用を確認できません',note:'施設・研究の詳細で確認してください。'};
    const notes=[];
    if(game?.isStaff)notes.push(kind==='building'?'共同普請の費用は着手する本人の資源から支払います。':'研究は個人の進行です。本人の資源から費用を支払います。');
    if(kind==='building') {
      const unlock=game?.buildingUnlock?.(id);if(unlock?.ok===false)notes.push(unlock.reason);
      if(chain.length)notes.push('予約済みの普請の、さらに次の段階です。');
    } else {
      if(level>=(state.buildings?.academy||0))notes.push('先に学問所の増築が必要です。');
      if(jobs.some(job=>job.kind==='research'))notes.push('進行中の研究が完了してから開始できます。');
    }
    notes.push('着手・予約は行いません。実行時の費用と条件は詳細で再確認できます。');
    return {kind,id,title:item.name+' Lv.'+(level+1)+' の必要資源',targets:cost,note:notes.join(' '),destination:kind==='building'?'facilities':'research'};
  }
  function operationTiming(row,clock) {
    const world=row.timeBasis!=='real',paused=world&&!clock.running,remaining=nonnegative(row.remainingMs),speed=world?clock.speed:1;
    const terminal=row.category==='construction'||row.category==='research'?'完成':row.category==='returning'?'帰還':'到着';
    return {time:remaining<=0?terminal+'を確認中':paused?'停止中 · 時刻未定':terminal+'まで '+duration(remaining/speed),
      timingNote:paused?'残り '+duration(remaining)+'（1倍速）':row.queued?'着工まで '+duration(row.startsInMs/speed):world&&clock.speed!==1?clock.speed+'倍速の目安':world?'1倍速の目安':'実時間で移動',
      sortMs:paused&&remaining>0?Infinity:remaining/speed,paused};
  }
  function buildOperations(game, options = {}) {
    const state=game?.state||{},catalog=options.catalog||global.SENGOKU_DATA||{},clock=operationClock(game,options.clock);
    const alliance=options.alliance??global.SengokuAlliance?.ownTravelSnapshot?.()??{available:false,status:'unloaded',active:[]};
    const allianceMarches=alliance.available&&Array.isArray(alliance.active)?alliance.active:[],allianceIds=new Set(allianceMarches.map(row=>row.id));
    const sourceJobs=options.jobs??game?.constructionJobs?.()??state.jobs??[],sourceMarches=options.marches??[];
    const jobs=Array.isArray(sourceJobs)?sourceJobs:[],marches=[...(Array.isArray(sourceMarches)?sourceMarches:[]),...allianceMarches],items=[];
    const jobCatalog={building:catalog.buildings||[],castle:catalog.castles||[],research:catalog.techs||[]};
    const branches=new Map((state.branches||[]).map(branch=>[branch.id,branch]));
    const branchName=job=>{const branch=branches.get(job.id),parent=(catalog.castles||[]).find(castle=>castle.id===branch?.parentCastleId)?.name;return branch?(parent||'拠点')+' '+({north:'北',east:'東',south:'南',west:'西'}[branch.direction]||'')+'支拠点'+(job.facilityId?'・'+(job.facilityName||(catalog.branchFacilities||[]).find(facility=>facility.id===job.facilityId)?.name||'施設'):''):'支拠点';};
    for(const [index,job] of jobs.entries()) {
      if(!job||!['building','castle','research','branch'].includes(job.kind))continue;
      const category=job.kind==='research'?'research':'construction',remaining=nonnegative(job.remainingSeconds??job.remaining*60),startsInMs=nonnegative(job.startsInSeconds)*1000;
      const total=nonnegative(job.totalSeconds??job.total*60),name=job.name||jobCatalog[job.kind]?.find(item=>item.id===job.id)?.name||(job.kind==='branch'?branchName(job):job.kind==='research'?'研究':job.kind==='castle'?'城郭':'施設');
      const scope=job.shared?'共同':game?.isStaff?'個人':'',level=Number.isSafeInteger(job.targetLevel)?' Lv.'+job.targetLevel:'';
      const row={id:'job:'+job.kind+':'+job.id+':'+(job.shared?'shared':'personal')+':'+(job.facilityId||'')+':'+(job.targetLevel??index)+':'+(job.queuePosition??index),category,
        name:name+level,detail:[scope,job.repair?'復旧工事':job.kind==='branch'?'支拠点の普請':'',job.queued?'予約 '+number(job.queuePosition||1)+'番目':'進行中'].filter(Boolean).join(' · '),
        remainingMs:nonnegative(job.finishesInSeconds??(startsInMs/1000+remaining))*1000,startsInMs,queued:job.queued===true,timeBasis:'world',
        progress:job.queued||!total?0:Math.max(0,Math.min(100,(1-remaining/total)*100)),destination:job.kind==='research'?'research':job.kind==='branch'||job.kind==='castle'?'map':'facilities',
        actionLabel:job.kind==='research'?'研究を見る':job.kind==='branch'||job.kind==='castle'?'地図を見る':'施設を見る'};
      items.push({...row,...operationTiming(row,clock)});
    }
    const seen=new Set();
    for(const march of marches) {
      if(!march||march.status!=='marching'||!march.id||seen.has(march.id))continue;
      seen.add(march.id);
      const travel=march.travel||march,category=march.phase==='returning'?'returning':'marching',world=march.timeBasis!=='real';
      const arrival=march.arrivesAtMs??march.arrivesElapsedMs,now=world?clock.elapsedMs:clock.realNowMs;
      const remaining=Number.isFinite(arrival)?Math.max(0,arrival-now):nonnegative(march.remainingMs??travel.durationMs);
      const source=travel.sourceName||march.sourceName||'派遣元',target=travel.targetName||march.targetName||'目的地';
      const departed=march.departedAtMs??march.departedElapsedMs,total=Number.isFinite(arrival)&&Number.isFinite(departed)?arrival-departed:nonnegative(travel.durationMs);
      const fromAlliance=allianceIds.has(march.id),purpose=fromAlliance?(march.allianceKind==='aid'?'同盟援軍':'同盟集結')+(category==='returning'?'の帰還':'への移動'):category==='returning'?'部隊の帰還':marchKinds[march.kind]||'部隊の移動';
      const row={id:'march:'+march.id,category,name:source+' → '+target,detail:purpose+' · '+number(march.troops)+'人'+(fromAlliance?' · 最終確認の情報':''),fromAlliance,
        remainingMs:remaining,queued:false,timeBasis:world?'world':'real',progress:total>0?Math.max(0,Math.min(100,(1-remaining/total)*100)):0,destination:fromAlliance?'alliance':'marches',actionLabel:fromAlliance?'同盟部隊を見る':'部隊を見る'};
      items.push({...row,...operationTiming(row,clock)});
    }
    items.sort((a,b)=>a.sortMs-b.sortMs||a.remainingMs-b.remainingMs||a.id.localeCompare(b.id));
    const counts=Object.fromEntries(Object.keys(filters).map(key=>[key,key==='all'?items.length:items.filter(row=>row.category===key).length]));
    const checkedAt=Number.isFinite(alliance.fetchedAt)?checkedTimeFormat.format(new Date(alliance.fetchedAt)):'';
    const allianceNote=alliance.available?'同盟部隊は '+checkedAt+' JST の取得情報です。移動の変更・到着結果は同盟作戦で再確認できます。':alliance.status==='unregistered'?'同盟部隊は領主登録後に確認できます。':alliance.status==='unavailable'?'同盟部隊を表示できません。領主の利用状態を同盟作戦で確認してください。':'同盟部隊は未取得です。同盟作戦を開くと、本人の援軍・集結の往復をここにも表示します。';
    return {items,counts,clock,allianceNote,allianceCount:allianceMarches.length,queued:items.filter(row=>row.queued).length,clockLabel:clock.running?'現在 '+clock.speed+'倍速 · 完成・到着が近い順':'共通時間は停止中 · 完成・到着時刻は未定'};
  }

  function build(game, options = {}) {
    const state = game?.state || {};
    const income = options.income || game?.income?.() || {};
    const jobs = options.jobs || game?.constructionJobs?.() || state.jobs || [];
    const marches = (options.marches || []).filter(march => march?.status === 'marching');
    const alliance=options.alliance??global.SengokuAlliance?.ownTravelSnapshot?.()??{available:false,status:'unloaded',active:[]};
    const knownMarches=new Set(marches.map(row=>row.id).filter(Boolean));
    const alliedMarches=alliance.available&&Array.isArray(alliance.active)?alliance.active.filter(row=>row?.status==='marching'&&!knownMarches.has(row.id)):[];
    const allMarches=[...marches,...alliedMarches];
    const queued = jobs.filter(job => job.queued === true).length;
    const available = (options.quests || []).filter(quest => {
      const status = game?.questStatus?.(quest.id);
      return status?.complete === true && status.claimed !== true;
    }).length;
    const deficit = Object.keys(resources).filter(key => Number(income.net?.[key] ?? income[key] ?? 0) < 0);
    const army = (state.army || []).filter(Boolean).length;
    const morale = Math.min(100, Math.max(0, Number(state.morale) || 0));
    const militaryDeficit = deficit.some(key => key === 'gold' || key === 'rice');
    const operations=buildOperations(game,{...options,jobs,marches,alliance});
    return {
      jobs: number(jobs.length),
      jobsDetail: jobs.length ? `${number(jobs.length - queued)}件進行 · ${number(queued)}件予約` : '普請と研究の状況',
      marches: number(allMarches.length),
      marchesDetail: allMarches.length ? `うち帰還中 ${number(allMarches.filter(march => march.phase === 'returning').length)}部隊${alliedMarches.length?' · 同盟'+number(alliedMarches.length)+'（最終確認）':''}` : '移動中の部隊を確認',
      quests: number(available),
      questsDetail: available ? '領主任務の報酬を確認' : '次の目標を確認',
      troops: number(state.troops),
      troopsDetail: `軍団 ${number(army)} / 3名 · 士気 ${number(morale)}`,
      gold: signed(income.net?.gold ?? income.gold),
      rice: signed(income.net?.rice ?? income.rice),
      goldNegative: Number(income.net?.gold ?? income.gold ?? 0) < 0,
      riceNegative: Number(income.net?.rice ?? income.rice ?? 0) < 0,
      operations: number(operations.items.length),
      nextTitle: operations.items[0]?.name||'進行中の予定はありません',
      nextTime: operations.items[0]?(operations.items[0].time+(operations.items[0].fromAlliance?' · 同盟の最終確認':'')):'普請・研究・移動を始めると表示します',
      nextTitle2: operations.items[1]?.name||'',
      nextTime2: operations.items[1]?(operations.items[1].time+(operations.items[1].fromAlliance?' · 同盟の最終確認':'')):'',
      hasSecond: operations.items.length>1,
      tone: deficit.length ? 'attention' : 'steady',
      note: militaryDeficit
        ? `${deficit.map(key => resources[key]).join('・')}が赤字見込みです。金銭・兵糧の赤字は月替わりの自動減兵対象です。`
        : deficit.length
          ? `${deficit.map(key => resources[key]).join('・')}が赤字見込みです。生産と修復費の内訳を確認できます。`
          : '現在の生産で、維持費・給与・修復費の見込みを賄えています。'
    };
  }

  function markup(game, options = {}) {
    const model = build(game, options);
    const icon = name => typeof options.icon === 'function' ? options.icon(name) : `<span data-icon="${name}" aria-hidden="true"></span>`;
    const tile = (key, label, unit, symbol, action, detail) => `<button type="button" class="domain-briefing-tile" ${action}><span class="domain-briefing-label">${icon(symbol)}${label}</span><strong class="${model[key].length>7?'domain-briefing-long-number':''}"><span data-briefing-value="${key}">${esc(model[key])}</span><small>${unit}</small></strong><span class="domain-briefing-detail" data-briefing-value="${detail}">${esc(model[detail])}</span></button>`;
    return `<section class="domain-briefing" id="domain-briefing" data-tone="${model.tone}" aria-labelledby="domain-briefing-title"><header><div><span class="domain-briefing-kicker">COMMAND DESK</span><h2 id="domain-briefing-title">領国の指揮台</h2></div><span class="domain-briefing-caption">いまの状況を、一目で。</span></header><div class="domain-briefing-grid">${tile('jobs','普請・研究','件','castle','data-action="town-section" data-id="town-reports-section"','jobsDetail')}${tile('marches','進軍・帰還','部隊','flag','data-action="command-activity" aria-haspopup="dialog"','marchesDetail')}${tile('quests','達成済み任務','件','scroll','data-view="council"','questsDetail')}${tile('troops','本隊の兵数','人','swords','data-view="army"','troopsDetail')}</div><button type="button" class="domain-activity-entry" data-action="command-activity" aria-haspopup="dialog"><span class="domain-activity-heading"><b>行動予定表</b><small><span data-briefing-value="operations">${esc(model.operations)}</span>件 · 一覧を見る</small></span><span class="domain-activity-next"><strong data-briefing-value="nextTitle">${esc(model.nextTitle)}</strong><small data-briefing-value="nextTime">${esc(model.nextTime)}</small></span><span class="domain-activity-next" data-briefing-second ${model.hasSecond?'':'hidden'}><strong data-briefing-value="nextTitle2">${esc(model.nextTitle2)}</strong><small data-briefing-value="nextTime2">${esc(model.nextTime2)}</small></span></button><button type="button" class="domain-briefing-ledger" data-action="economy-details" aria-haspopup="dialog"><span class="domain-briefing-ledger-title">${icon('coins')}毎月の収支 <small>見込み</small></span><span class="domain-briefing-ledger-values"><span>金銭 <b data-briefing-value="gold" class="${model.goldNegative?'is-negative':''}">${esc(model.gold)}</b></span><span>兵糧 <b data-briefing-value="rice" class="${model.riceNegative?'is-negative':''}">${esc(model.rice)}</b></span></span><span class="domain-briefing-ledger-open">内訳を見る ${icon('chevron')}</span></button><p class="domain-briefing-note" data-briefing-value="note">${esc(model.note)}</p><button type="button" class="domain-budget-entry" data-action="resource-planner" aria-haspopup="dialog">${icon('coins')}<span><b>資源計画</b><small>次の普請・研究までの不足と待ち時間</small></span>${icon('chevron')}</button></section>`;
  }

  function refresh(game, options = {}) {
    const host = global.document?.getElementById?.('domain-briefing');
    if (!host || host.closest?.('[hidden],[inert]')) return;
    const model = build(game, {...options, marches: options.marches || global.SengokuTravelUI?.snapshot?.()?.active || []});
    for (const node of host.querySelectorAll('[data-briefing-value]')) {
      const key = node.dataset.briefingValue;
      if (typeof model[key] !== 'string') continue;
      if (node.textContent !== model[key]) node.textContent = model[key];
      if (['jobs','marches','quests','troops'].includes(key)) node.parentElement?.classList.toggle('domain-briefing-long-number',model[key].length>7);
      if (key === 'gold' || key === 'rice') node.classList.toggle('is-negative', model[key + 'Negative']);
    }
    const second=host.querySelector('[data-briefing-second]');
    if(second)second.hidden=!model.hasSecond;
    if (host.dataset.tone !== model.tone) host.dataset.tone = model.tone;
  }

  function matchingOperations(model,filter='all',query='') {
    const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP');
    const words=normalize(query).trim().split(/\s+/).filter(Boolean);
    return model.items.filter(row=>(filter==='all'||row.category===filter)&&words.every(word=>normalize(row.name+' '+row.detail+' '+filters[row.category]).includes(word)));
  }
  function operationRow(row) {
    return `<li class="command-operation" data-stable-key="${esc(row.id)}" data-command-operation="${esc(row.id)}" data-kind="${row.category}"><div class="command-operation-content"><div class="command-operation-heading"><span class="command-operation-kind">${filters[row.category]}</span>${row.queued?'<span class="command-operation-queued">予約待ち</span>':''}</div><h3>${esc(row.name)}</h3><p>${esc(row.detail)}</p></div><div class="command-operation-time"><strong data-command-time="${esc(row.id)}">${esc(row.time)}</strong><small data-command-timing="${esc(row.id)}">${esc(row.timingNote)}</small></div><div class="command-operation-track" aria-hidden="true"><i data-command-progress="${esc(row.id)}" style="width:${Math.round(row.progress)}%"></i></div><button type="button" class="button small command-operation-open" data-command-go="${row.destination}" data-command-key="${esc(row.id)}"${row.destination==='alliance'?' data-action="alliance-strategy" data-command-dismiss':''}>${row.actionLabel}</button></li>`;
  }

  let activityDialog=null,activitySession=null;
  function identity(game) {
    const state=game?.state||{},access=global.SengokuSocial?.getExpansionContext?.()||{};
    return JSON.stringify([state.walking?.campaignId||state.campaignId||'',state.clan||'',game?.isStaff===true,game?.isAdmin===true,access.playerId||access.user?.id||'',access.epoch,access.accountEpoch,access.privilegeEpoch,access.pending===true,access.banned===true]);
  }
  function finishActivity() {
    const current=activitySession;
    if(!current)return;
    activitySession=null;
    current.unsubscribe?.();
    if(current.returnFocus?.isConnected)current.returnFocus.focus({preventScroll:true});
  }
  function close() {
    if(activityDialog?.open)activityDialog.close();
    finishActivity();
  }
  function ensureActivityDialog() {
    if(activityDialog)return activityDialog;
    const document=global.document;
    if(!document?.createElement)return null;
    activityDialog=document.createElement('dialog');
    activityDialog.className='command-activity-dialog';
    activityDialog.setAttribute('aria-labelledby','command-activity-title');
    activityDialog.setAttribute('aria-describedby','command-activity-note');
    activityDialog.innerHTML='<header class="command-activity-header"><div><p>領国の進行状況</p><h2 id="command-activity-title">行動予定表</h2></div><button type="button" class="button" data-command-close>閉じる</button></header><div class="command-activity-tools"><p class="command-activity-clock" data-command-clock></p><label class="command-activity-search"><span>城・施設・研究を探す</span><input type="search" class="input" data-command-query placeholder="例：田畑、清洲城、帰還" autocomplete="off"></label><div class="command-activity-filters" role="group" aria-label="予定の種類">'+Object.entries(filters).map(([key,label])=>'<button type="button" data-command-filter="'+key+'" aria-pressed="'+(key==='all')+'">'+label+'<span data-command-count="'+key+'">0</span></button>').join('')+'</div><p class="command-activity-count" data-command-result-count role="status" aria-live="polite"></p></div><div class="command-activity-scroll" data-command-scroll><ul class="command-operation-list" data-command-list></ul><div class="command-activity-empty" data-command-empty hidden><strong>該当する予定はありません</strong><p>普請・研究・進軍・帰還が始まると、ここに表示されます。</p><button type="button" class="button" data-command-reset>条件を解除</button></div><button type="button" class="button command-activity-more" data-command-more hidden>さらに40件を表示</button></div><footer class="command-activity-footer"><p id="command-activity-note">残り時間は現在の速度での目安です。速度・停止に連動し、完成・到着は確定後に各画面へ反映されます。</p><p><span data-command-alliance-note>同盟部隊は未取得です。</span><button type="button" class="text-link" data-action="alliance-strategy" data-command-dismiss>同盟作戦で確認</button></p></footer>';
    activityDialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    // Native close events are queued; an earlier close can arrive after reopen.
    activityDialog.addEventListener('close',()=>{if(!activityDialog.open)finishActivity();});
    activityDialog.addEventListener('input',event=>{
      if(!activitySession||!event.target.matches?.('[data-command-query]'))return;
      activitySession.query=event.target.value;
      activitySession.limit=40;
      renderActivity();
    });
    activityDialog.addEventListener('click',event=>{
      const button=event.target.closest?.('[data-command-close],[data-command-filter],[data-command-reset],[data-command-more],[data-command-go],[data-command-dismiss]');
      if(!button||!activitySession)return;
      if(button.hasAttribute('data-command-close')||button.hasAttribute('data-command-dismiss'))return close();
      if(button.hasAttribute('data-command-filter')){activitySession.filter=Object.hasOwn(filters,button.dataset.commandFilter)?button.dataset.commandFilter:'all';activitySession.limit=40;renderActivity();return;}
      if(button.hasAttribute('data-command-reset')){activitySession.filter='all';activitySession.query='';activitySession.limit=40;activityDialog.querySelector('[data-command-query]').value='';renderActivity();return;}
      if(button.hasAttribute('data-command-more')){activitySession.limit+=40;renderActivity();return;}
      const destination=button.dataset.commandGo,options=activitySession.options;
      close();
      if(destination==='marches')global.SengokuTravelUI?.open?.();else if(['research','map','facilities'].includes(destination))options.navigate?.(destination);
    });
    document.body.appendChild(activityDialog);
    return activityDialog;
  }
  function renderActivity(data,clock) {
    const session=activitySession;
    if(!session||!activityDialog?.open)return;
    const game=session.options.getGame?.()||session.options.game;
    if(!game||identity(game)!==session.scope||global.SENGOKU_AT_TITLE===true){close();return;}
    if(data)session.data=data;
    if(clock)session.clock=clock;
    const model=buildOperations(game,{catalog:session.options.catalog,marches:session.data?.active||[],clock:session.clock});
    const rows=matchingOperations(model,session.filter,session.query),visible=rows.slice(0,session.limit),byId=new Map(visible.map(row=>[row.id,row]));
    const text=(selector,value)=>{const node=activityDialog.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
    text('[data-command-clock]',model.clockLabel);
    text('[data-command-alliance-note]',model.allianceNote);
    for(const button of activityDialog.querySelectorAll('[data-command-filter]')) {
      button.setAttribute('aria-pressed',String(button.dataset.commandFilter===session.filter));
      const count=button.querySelector('[data-command-count]'),value=number(model.counts[button.dataset.commandFilter]);
      if(count&&count.textContent!==value)count.textContent=value;
    }
    text('[data-command-result-count]',rows.length?number(visible.length)+' / '+number(rows.length)+'件を表示 · 予約待ち '+number(rows.filter(row=>row.queued).length)+'件':'該当する予定はありません');
    const list=activityDialog.querySelector('[data-command-list]'),scroll=activityDialog.querySelector('[data-command-scroll]');
    const shape=JSON.stringify(visible.map(row=>[row.id,row.name,row.detail,row.category,row.queued,row.destination]));
    if(list.dataset.shape!==shape) {
      const top=scroll.scrollTop,dialogTop=activityDialog.scrollTop,focused=global.document.activeElement,focusKey=list.contains(focused)?focused?.dataset?.commandKey:null;
      const html=visible.map(operationRow).join('');
      if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(list,html);else list.innerHTML=html;
      list.dataset.shape=shape;
      scroll.scrollTop=top;
      activityDialog.scrollTop=dialogTop;
      if(focusKey){const next=Array.from(list.querySelectorAll('[data-command-key]')).find(node=>node.dataset.commandKey===focusKey);if(next&&global.document.activeElement!==next)next.focus({preventScroll:true});else if(!next)activityDialog.querySelector('[data-command-close]')?.focus({preventScroll:true});}
    }
    for(const node of list.querySelectorAll('[data-command-time],[data-command-timing],[data-command-progress]')) {
      const row=byId.get(node.dataset.commandTime||node.dataset.commandTiming||node.dataset.commandProgress);
      if(!row)continue;
      if(node.hasAttribute('data-command-progress')){const value=Math.round(row.progress)+'%';if(node.style.width!==value)node.style.width=value;}
      else {const value=node.hasAttribute('data-command-time')?row.time:row.timingNote;if(node.textContent!==value)node.textContent=value;}
    }
    activityDialog.querySelector('[data-command-empty]').hidden=rows.length>0;
    activityDialog.querySelector('[data-command-reset]').hidden=session.filter==='all'&&!session.query;
    activityDialog.querySelector('[data-command-more]').hidden=rows.length<=session.limit;
  }
  function open(options = {}) {
    const game=options.getGame?.()||options.game;
    if(!game)return false;
    const dialog=ensureActivityDialog();
    if(!dialog)return false;
    if(plannerSession)closePlanner();
    if(activitySession)close();
    const session={options,scope:identity(game),returnFocus:global.document.activeElement,filter:Object.hasOwn(filters,options.filter)?options.filter:'all',query:'',limit:40,unsubscribe:null};
    activitySession=session;
    dialog.querySelector('[data-command-query]').value='';
    dialog.showModal();
    if(typeof global.SengokuTravelUI?.subscribe==='function'){
      session.unsubscribe=global.SengokuTravelUI.subscribe((data,clock)=>{if(activitySession===session)renderActivity(data,clock);});
      if(activitySession!==session){session.unsubscribe?.();return false;}
    }
    else renderActivity(global.SengokuTravelUI?.snapshot?.()||{active:[]});
    if(activitySession!==session)return false;
    dialog.querySelector('[data-command-close]')?.focus({preventScroll:true});
    return true;
  }

  let plannerDialog=null,plannerSession=null;
  function finishPlanner() {
    const session=plannerSession;if(!session)return;
    plannerSession=null;session.unsubscribe?.();
    if(session.returnFocus?.isConnected)session.returnFocus.focus({preventScroll:true});
  }
  function closePlanner() {if(plannerDialog?.open)plannerDialog.close();finishPlanner();}
  function ensurePlannerDialog() {
    if(plannerDialog)return plannerDialog;
    const document=global.document;if(!document?.createElement)return null;
    const dialog=document.createElement('dialog');plannerDialog=dialog;
    dialog.className='command-activity-dialog resource-plan-dialog';
    dialog.setAttribute('aria-labelledby','resource-plan-title');
    dialog.innerHTML='<header class="command-activity-header"><div><p>次の一手の準備</p><h2 id="resource-plan-title">資源計画</h2></div><button type="button" class="button" data-budget-close>閉じる</button></header><div class="resource-plan-scroll"><label class="resource-plan-picker"><span>何を準備しますか</span><select class="select" data-budget-choice></select></label><h3 class="resource-plan-goal" data-budget-goal></h3><p class="resource-plan-note" data-budget-goal-note></p><section class="resource-plan-summary" aria-label="資源が揃う目安" data-budget-summary><strong data-budget-title></strong><p data-budget-detail></p></section><div class="resource-plan-grid">'+Object.entries(resources).map(([key,label])=>'<section class="resource-plan-card" data-budget-card="'+key+'"><h3>'+label+'</h3><dl><div><dt>現在</dt><dd data-budget-current="'+key+'"></dd></div><div><dt>毎月の差引</dt><dd data-budget-rate="'+key+'"></dd></div></dl><label><span>必要な合計</span><input class="input" type="number" min="0" step="1" inputmode="numeric" aria-label="'+label+'の必要な合計" data-budget-target="'+key+'"></label><div class="resource-plan-gap"><span>不足</span><strong data-budget-gap="'+key+'"></strong></div><div class="resource-plan-track" aria-hidden="true"><i data-budget-track="'+key+'"></i></div></section>').join('')+'</div><details class="resource-plan-forecast"><summary>1・3・6か月後の残高を試算</summary><p class="resource-plan-note">ゲーム内の月数です。現在の差引がそのまま続く場合を表示します。</p><div class="resource-plan-table"><table><thead><tr><th scope="col">資源</th>'+[1,3,6].map(month=>'<th scope="col">'+month+'か月後</th>').join('')+'</tr></thead><tbody>'+Object.entries(resources).map(([key,label])=>'<tr><th scope="row">'+label+'</th>'+[0,1,2].map(index=>'<td data-budget-after="'+key+':'+index+'"></td>').join('')+'</tr>').join('')+'</tbody></table></div></details><p class="resource-plan-note resource-plan-warning" data-budget-military hidden>金銭・兵糧の赤字は月替わりの自動減兵で変わるため、この試算どおりには進まない場合があります。</p><p class="resource-plan-note">生産・維持費・給与・次回修復費を含む現在の差引を固定した概算です。工事完成、報酬、戦闘、売買、追加支出などによる変化や月末の精算時点は含みません。自動で購入・建設・予約はしません。</p><div class="resource-plan-actions"><button type="button" class="button gold" data-budget-go="facilities">施設を見る</button><button type="button" class="button" data-budget-go="research">研究を見る</button></div></div>';
    dialog.addEventListener('cancel',event=>{event.preventDefault();closePlanner();});
    // A facility detail may remain beneath this dialog. Its global Escape
    // handler must not clear that underlying modal's live-refresh context.
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation?.();});
    dialog.addEventListener('close',()=>{if(!dialog.open)finishPlanner();});
    dialog.addEventListener('click',event=>{
      if(!plannerSession)return;
      const button=event.target.closest?.('[data-budget-close],[data-budget-go]');
      if(button){const destination=button.dataset.budgetGo,options=plannerSession.options;closePlanner();if(['facilities','research'].includes(destination))options.navigate?.(destination);return;}
      if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePlanner();}
    });
    dialog.addEventListener('change',event=>{if(plannerSession&&event.target.matches?.('[data-budget-choice]')){const [kind,id]=event.target.value.split(':');plannerSession.selection={kind,id,targets:plannerSession.draft};if(kind==='custom')for(const input of dialog.querySelectorAll('[data-budget-target]'))input.value=plannerSession.draft[input.dataset.budgetTarget];renderPlanner();}});
    dialog.addEventListener('input',event=>{
      if(!plannerSession||plannerSession.selection.kind!=='custom'||!event.target.matches?.('[data-budget-target]'))return;
      plannerSession.draft[event.target.dataset.budgetTarget]=event.target.value;renderPlanner();
    });
    document.body.appendChild(dialog);return dialog;
  }
  function renderPlanner(clock) {
    const session=plannerSession;if(!session||!plannerDialog?.open)return;
    const game=session.options.getGame?.()||session.options.game;
    if(!game||identity(game)!==session.scope||global.SENGOKU_AT_TITLE===true){closePlanner();return;}
    if(clock)session.clock=clock;
    const goal=budgetGoal(game,session.selection,{catalog:session.options.catalog,staffReady:session.options.staffReady?.()===true});
    const model=buildBudget(game,goal.targets,{catalog:session.options.catalog,clock:session.clock}),dialog=plannerDialog;
    const text=(selector,value)=>{const node=dialog.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
    text('[data-budget-goal]',goal.title);text('[data-budget-goal-note]',goal.note);
    text('[data-budget-title]',goal.unavailable?'費用の試算はできません':model.title);
    text('[data-budget-detail]',goal.unavailable?'目標を変更するか、各画面で現在の状態を確認してください。':model.detail);
    dialog.querySelector('[data-budget-summary]').dataset.state=goal.unavailable?'unavailable':model.status;
    for(const row of model.rows) {
      const input=dialog.querySelector('[data-budget-target="'+row.key+'"]');
      const auto=goal.kind!=='custom';input.readOnly=auto;input.disabled=goal.unavailable===true;
      if(auto){const value=goal.unavailable?'':String(row.target);if(input.value!==value)input.value=value;}
      input.setAttribute('aria-invalid',String(!row.valid));
      text('[data-budget-current="'+row.key+'"]',number(row.current));
      text('[data-budget-rate="'+row.key+'"]',signed(row.rate));
      dialog.querySelector('[data-budget-rate="'+row.key+'"]').classList.toggle('is-negative',row.rate<0);
      text('[data-budget-gap="'+row.key+'"]',goal.unavailable||!row.valid?'—':number(row.deficit));
      const track=dialog.querySelector('[data-budget-track="'+row.key+'"]'),width=(goal.unavailable||!row.valid?0:row.target?Math.min(100,row.current/row.target*100):100).toFixed(1)+'%';
      if(track.style.width!==width)track.style.width=width;
      row.after.forEach((value,index)=>text('[data-budget-after="'+row.key+':'+index+'"]',number(value)));
    }
    dialog.querySelector('[data-budget-military]').hidden=!model.militaryDeficit;
  }
  function openPlanner(options = {}) {
    const game=options.getGame?.()||options.game;if(!game)return false;
    const dialog=ensurePlannerDialog();if(!dialog)return false;
    if(activitySession)close();if(plannerSession)closePlanner();
    const catalog=options.catalog||global.SENGOKU_DATA||{},choice=dialog.querySelector('[data-budget-choice]');
    choice.innerHTML='<option value="custom">自由入力で予算を組む</option><optgroup label="施設の次の普請">'+(catalog.buildings||[]).map(row=>'<option value="building:'+esc(row.id)+'">'+esc(row.name)+'</option>').join('')+'</optgroup><optgroup label="次の研究">'+(catalog.techs||[]).map(row=>'<option value="research:'+esc(row.id)+'">'+esc(row.name)+'</option>').join('')+'</optgroup>';
    const kind=['building','research','custom'].includes(options.kind)?options.kind:'building',id=options.id||'farm';
    const selected=Array.from(choice.options).some(option=>option.value===kind+':'+id)?kind+':'+id:kind==='custom'?'custom':catalog.buildings?.length?'building:'+catalog.buildings[0].id:'custom';
    choice.value=selected;const [selectedKind,selectedId]=selected.split(':');
    const draft=Object.fromEntries(Object.keys(resources).map(key=>[key,String(Math.floor(nonnegative(game.state?.resources?.[key])))]));
    for(const input of dialog.querySelectorAll('[data-budget-target]'))input.value=draft[input.dataset.budgetTarget];
    const session={options,scope:identity(game),selection:{kind:selectedKind,id:selectedId,targets:draft},draft,returnFocus:global.document.activeElement,unsubscribe:null};
    plannerSession=session;dialog.showModal();dialog.scrollTop=0;dialog.querySelector('.resource-plan-scroll').scrollTop=0;
    if(typeof global.SengokuTravelUI?.subscribe==='function'){
      session.unsubscribe=global.SengokuTravelUI.subscribe((_data,clock)=>{if(plannerSession===session)renderPlanner(clock);});
      if(plannerSession!==session){session.unsubscribe?.();return false;}
    }else renderPlanner();
    if(plannerSession!==session)return false;
    dialog.querySelector('[data-budget-close]')?.focus({preventScroll:true});return true;
  }

  const api = {build, markup, refresh, buildOperations, matchingOperations, open, close, buildBudget, budgetGoal, openPlanner, closePlanner};
  global.SengokuCommandCenter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
