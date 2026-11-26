/* A read-only briefing of the current campaign. Actions use the existing UI. */
(function (global) {
  'use strict';
  const resources = {gold:'金銭', rice:'兵糧', wood:'木材', stone:'石材'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const number = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('ja-JP');
  const signed = value => { const n = Number(value) || 0; return (n < 0 ? '−' : n > 0 ? '+' : '') + number(Math.abs(n)); };
  const filters = {all:'すべて',construction:'普請',research:'研究',marching:'進軍・派遣',returning:'帰還'};
  const timeWindows = {all:'すべての予定',minute:'残り1分以内',fiveMinutes:'残り5分以内',due:'確定待ち',paused:'再開待ち'};
  const PLAN_LIMIT = 8;
  const PLAN_STORAGE_KEY = 'sengoku-resource-plans-v1', PLAN_STORAGE_VERSION = 1;
  const PLAN_STORAGE_LIMIT = 6, PLAN_STORAGE_BYTES = 16384, PLAN_SAVE_DELAY = 350;
  const checkedTimeFormat = new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const marchKinds = {castle:'城への出陣',branch:'支拠点への出陣',field:'共通フィールド',roaming:'野良兵への出陣',rally:'同盟の集結軍',conquest:'天下争覇',covert:'部隊の派遣'};
  const nonnegative = value => Number.isFinite(Number(value)) ? Math.max(0,Number(value)) : 0;
  function duration(ms) {
    const seconds=Math.max(0,Math.ceil(nonnegative(ms)/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;
    return (hours?hours+'時間':'')+(minutes?minutes+'分':'')+(rest||!hours&&!minutes?rest+'秒':'');
  }
  function operationClock(game, supplied) {
    const shared=global.SengokuWorldClock?.snapshot?.();
    const state=game?.state||{},live=supplied||shared?.clock||{},stored=state.worldClock||{},realtime=state.realtime||{};
    const speed=Number(live.speed??realtime.speed),elapsedMs=live.elapsedMs??stored.elapsedMs??((state.turn||0)*60000+(realtime.elapsed||0)*1000);
    return {ready:shared?.ready!==false&&supplied?.ready!==false,elapsedMs:nonnegative(elapsedMs),realNowMs:nonnegative(live.realNowMs??Date.now()),running:(live.running??realtime.running)!==false,speed:[1,2,4].includes(speed)?speed:1};
  }
  // A budget is a transparent fixed-income projection, never a future save or
  // permission to spend. In particular, deficits may change at month-end.
  function buildBudget(game, targets = {}, options = {}) {
    const catalog=options.catalog||global.SENGOKU_DATA||{},cap=catalog.assetCap||100000000,monthMs=(catalog.secondsPerMonth||60)*1000;
    const income=options.income||game?.income?.()||{},clock=operationClock(game,options.clock),rows=[];
    let earliest=0,latest=Infinity;
    for(const [key,label] of Object.entries(resources)) {
      const raw=targets[key]??0,target=raw===''?0:Number(raw),rawReserve=options.reserve?.[key]??0,reserve=rawReserve===''?0:Number(rawReserve),required=target+reserve;
      const targetValid=Number.isSafeInteger(target)&&target>=0,reserveValid=Number.isSafeInteger(reserve)&&reserve>=0;
      const valid=targetValid&&reserveValid&&Number.isSafeInteger(required);
      const current=Math.min(cap,Math.floor(nonnegative(game?.state?.resources?.[key]))),rawRate=Number(income.net?.[key]??income[key]??0),rate=Number.isFinite(rawRate)?rawRate:0;
      const deficit=valid?Math.max(0,required-current):0,months=deficit&&rate>0?deficit/rate:0;
      if(months>earliest)earliest=months;
      if(rate<0&&valid&&required>0&&current>=required)latest=Math.min(latest,(current-required)/-rate);
      rows.push({key,label,current,target,reserve,required,targetValid,reserveValid,valid,rate,deficit,months,overCap:valid&&required>cap,blocked:deficit>0&&rate<=0,
        after:[1,3,6].map(month=>Math.max(0,Math.min(cap,Math.floor(current+rate*month))))});
    }
    const invalid=rows.some(row=>!row.valid),overCap=rows.filter(row=>row.overCap),blocked=rows.filter(row=>row.blocked);
    const ready=!invalid&&!overCap.length&&rows.every(row=>row.deficit===0),expires=!ready&&earliest>latest+1e-9;
    const status=invalid?'invalid':overCap.length?'cap':ready?'ready':blocked.length?'blocked':!clock.running?'paused':expires?'expires':'waiting';
    const limiting=rows.filter(row=>row.deficit&&row.rate>0&&Math.abs(row.months-earliest)<1e-9).map(row=>row.label);
    const waitMs=status==='waiting'?Math.ceil(earliest*monthMs/clock.speed/1000)*1000:null;
    const hasReserve=rows.some(row=>row.valid&&row.reserve>0);
    const title={invalid:'費用と備蓄は0以上の整数で入力',cap:'保有上限を超える予算です',ready:hasReserve?'費用と残す備蓄が揃っています':'必要な資源は揃っています',blocked:'現在の収支では不足を解消できません',paused:'共通時間は停止中です',expires:'揃う前に別の資源が不足します',waiting:'約'+duration(waitMs)+'で資源が揃う試算'}[status];
    const detail={invalid:'空欄は0として扱います。小数・負数は使えません。',cap:overCap.map(row=>row.label).join('・')+'の費用と備蓄の合計が保有上限 '+number(cap)+' を超えています。',ready:'資源だけの判定です。必要な指令・解放条件・普請枠は各画面で確認できます。',blocked:blocked.map(row=>row.label).join('・')+'の生産を増やすか、予算を見直してください。',paused:'不足額は表示します。時間が動き始めると待ち時間を試算します。',expires:'赤字の資源が先に減るため、4資源が同時には揃わない試算です。',waiting:limiting.join('・')+'が揃うまでの目安 · 現在 '+clock.speed+'倍速'}[status];
    return {rows,status,title,detail,hasReserve,waitMs,clock,cap,earliest,latest,militaryDeficit:rows.some(row=>['gold','rice'].includes(row.key)&&row.rate<0)};
  }
  function budgetGoal(game, selection = {}, options = {}) {
    const catalog=options.catalog||global.SENGOKU_DATA||{},kind=selection.kind,id=selection.id,state=game?.state||{};
    if(kind==='plan')return combinedBudgetGoal(game,selection.items,options);
    if(kind==='custom')return {kind,title:'自由な予算',targets:selection.targets||{},note:'使いたい資源の合計を入力してください。',destination:'facilities'};
    if(!['building','research'].includes(kind))return {unavailable:true,title:'目標を選んでください',note:'施設・研究、または自由入力から選べます。'};
    const item=(kind==='building'?catalog.buildings:catalog.techs)?.find(row=>row.id===id);
    if(!item)return {unavailable:true,title:'目標が見つかりません',note:'一覧から選び直してください。'};
    if(game?.isStaff&&options.staffReady!==true)return {unavailable:true,title:'共同拠点を確認中です',note:'共同拠点の最新情報を確認してから費用を表示します。'};
    const jobs=options.jobs??game?.constructionJobs?.()??state.jobs??[];
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
  // Plan rows are distinct next-stage goals. Reading a plan never queues work,
  // changes a facility level, or treats one purchase as already completed.
  function combinedBudgetGoal(game, selections = [], options = {}) {
    const items=[],seen=new Set(),targets=Object.fromEntries(Object.keys(resources).map(key=>[key,0]));
    if(!Array.isArray(selections)||selections.length>PLAN_LIMIT)return {kind:'plan',unavailable:true,items,title:'計画は'+PLAN_LIMIT+'件までです',note:'施設・研究の異なる目標を選び直してください。'};
    const sharedOptions=selections.length?{...options,jobs:options.jobs??game?.constructionJobs?.()??game?.state?.jobs??[]}:options;
    for(const selection of selections){
      if(!selection||!['building','research'].includes(selection.kind)||typeof selection.id!=='string')return {kind:'plan',unavailable:true,items,title:'計画の目標を確認してください',note:'施設・研究から選び直してください。'};
      const key=selection.kind+':'+selection.id;
      if(seen.has(key))continue;
      seen.add(key);
      const goal=budgetGoal(game,selection,sharedOptions);
      items.push({...goal,key});
      if(!goal.unavailable)for(const resource of Object.keys(resources)){
        const cost=Number(goal.targets?.[resource]??0);
        if(!Number.isSafeInteger(cost)||cost<0||!Number.isSafeInteger(targets[resource]+cost))return {kind:'plan',unavailable:true,items,title:'計画の費用を確認できません',note:'各目標の詳細で費用を確認してください。'};
        targets[resource]+=cost;
      }
    }
    const unavailable=items.filter(item=>item.unavailable);
    if(!items.length)return {kind:'plan',unavailable:true,items,title:'計画に目標を追加してください',note:'施設・研究を選び「計画へ追加」を押すと、まとめて費用を試算できます。'};
    return {kind:'plan',items,targets,unavailable:unavailable.length>0,title:items.length+'件の普請・研究をまとめて準備',
      note:unavailable.length?'確認が必要な目標が'+unavailable.length+'件あります。項目を見直すまで、合計の試算を保留します。':'各目標の次の1段階を合算しています。新しい予約・完成後は、次の段階へ見積もりを更新します。研究は同時1件です。実際の着手順・条件は各画面で確認できます。',destination:'facilities'};
  }
  function operationTiming(row,clock) {
    const world=row.timeBasis!=='real',paused=world&&!clock.running,remaining=nonnegative(row.remainingMs),speed=world?clock.speed:1;
    const terminal=row.category==='construction'||row.category==='research'?'完成':row.category==='returning'?'帰還':'到着';
    if(world&&!clock.ready)return {time:'共通時刻を確認中',timingNote:'受信後に残り時間を表示',sortMs:Infinity,paused:false};
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
      const target={kind:job.kind,id:job.id,shared:job.shared===true};
      if(job.kind==='castle')target.parentCastleId=job.id;
      if(job.kind==='branch')target.parentCastleId=branches.get(job.id)?.parentCastleId||'';
      const row={id:'job:'+job.kind+':'+job.id+':'+(job.shared?'shared':'personal')+':'+(job.facilityId||'')+':'+(job.targetLevel??index)+':'+(job.queuePosition??index),category,target,
        name:name+level,detail:[scope,job.repair?'復旧工事':job.kind==='branch'?'支拠点の普請':'',job.queued?'予約 '+number(job.queuePosition||1)+'番目':'進行中'].filter(Boolean).join(' · '),
        remainingMs:nonnegative(job.finishesInSeconds??(startsInMs/1000+remaining))*1000,startsInMs,queued:job.queued===true,timeBasis:'world',
        progress:job.queued||!total?0:Math.max(0,Math.min(100,(1-remaining/total)*100)),destination:job.kind==='research'?'research':job.kind==='branch'||job.kind==='castle'?'map':'facilities',
        actionLabel:job.kind==='research'?'この研究を見る':job.kind==='branch'?'この支拠点を開く':job.kind==='castle'?'この城郭を開く':'この施設を開く'};
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
    return {items,counts,clock,allianceNote,allianceCount:allianceMarches.length,queued:items.filter(row=>row.queued).length,clockLabel:!clock.ready?'共通時刻を確認中 · 実時間の移動は継続':clock.running?'現在 '+clock.speed+'倍速 · 完成・到着が近い順':'共通時間は停止中 · 実時間の移動は継続'};
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

  function withinTimeWindow(row,window) {
    switch(window) {
      case 'minute': return row.sortMs > 0 && row.sortMs <= 60000;
      case 'fiveMinutes': return row.sortMs > 0 && row.sortMs <= 300000;
      case 'due': return row.sortMs === 0;
      case 'paused': return row.paused && row.remainingMs > 0;
      default: return true;
    }
  }
  function matchingOperations(model,filter='all',query='',timeWindow='all') {
    const normalize=value=>String(value??'').normalize('NFKC').toLocaleLowerCase('ja-JP');
    const words=normalize(query).trim().split(/\s+/).filter(Boolean);
    return model.items.filter(row=>(filter==='all'||row.category===filter)&&withinTimeWindow(row,timeWindow)&&words.every(word=>normalize(row.name+' '+row.detail+' '+filters[row.category]).includes(word)));
  }
  function operationRow(row) {
    return `<li class="command-operation" data-stable-key="${esc(row.id)}" data-command-operation="${esc(row.id)}" data-kind="${row.category}"><div class="command-operation-content"><div class="command-operation-heading"><span class="command-operation-kind">${filters[row.category]}</span>${row.queued?'<span class="command-operation-queued">予約待ち</span>':''}</div><h3>${esc(row.name)}</h3><p>${esc(row.detail)}</p></div><div class="command-operation-time"><strong data-command-time="${esc(row.id)}">${esc(row.time)}</strong><small data-command-timing="${esc(row.id)}">${esc(row.timingNote)}</small></div><div class="command-operation-track" aria-hidden="true"><i data-command-progress="${esc(row.id)}" style="width:${Math.round(row.progress)}%"></i></div><button type="button" class="button small command-operation-open" data-command-go="${row.destination}" data-command-key="${esc(row.id)}" aria-label="${esc(row.name+'：'+row.actionLabel)}"${row.destination==='alliance'?' data-action="alliance-strategy" data-command-dismiss':''}>${row.actionLabel}</button></li>`;
  }

  let activityDialog=null,activitySession=null,activityDraft=null;
  const transientCampaignScopes=new WeakMap();let transientCampaignSequence=0;
  function liveCampaignScope(game) {
    const campaign=game?.state?.walking?.campaignId||game?.state?.campaignId;
    if(campaign&&campaign!=='legacy_v1')return campaign;
    // Old saves share the migration marker. They cannot safely share either a
    // durable plan or a draft after a different save replaces the game object.
    if(!game||typeof game!=='object')return '';
    if(!transientCampaignScopes.has(game))transientCampaignScopes.set(game,++transientCampaignSequence);
    return 'session:'+transientCampaignScopes.get(game);
  }
  function identity(game) {
    const state=game?.state||{},access=global.SengokuSocial?.getExpansionContext?.()||{},role=global.SengokuBridge?.getRoleAccess?.()||{};
    return JSON.stringify([liveCampaignScope(game),state.clan||'',state.home||'',game?.isStaff===true,game?.isAdmin===true,access.playerId||access.user?.id||'',access.epoch,access.accountEpoch,access.privilegeEpoch,access.pending===true,access.banned===true,access.rolePending===true,access.user?.id||'',access.user?.isAdmin===true,access.user?.isStaff===true,access.user?.isBanned===true,role.epoch,role.pending===true,global.SengokuBridge?.hasStarted?.()===false]);
  }
  function finishActivity() {
    const current=activitySession;
    if(!current)return;
    activityDraft={scope:current.scope,filter:current.filter,timeWindow:current.timeWindow,query:current.query,limit:current.limit,
      top:activityDialog.querySelector('[data-command-scroll]').scrollTop,dialogTop:activityDialog.scrollTop};
    activitySession=null;
    current.unsubscribe?.();
    if(current.returnFocus?.isConnected)current.returnFocus.focus({preventScroll:true});
  }
  function close() {
    if(activityDialog?.open)activityDialog.close();
    finishActivity();
  }
  function currentActivityGame() {
    const session=activitySession;if(!session)return null;
    const game=session.options.getGame?.()||session.options.game,access=global.SengokuSocial?.getExpansionContext?.()||{},role=global.SengokuBridge?.getRoleAccess?.()||{};
    if(!game||identity(game)!==session.scope||global.SENGOKU_AT_TITLE===true||access.pending===true||access.banned===true||access.rolePending===true||access.user?.isBanned===true||role.pending===true||global.SengokuBridge?.hasStarted?.()===false){close();return null;}
    return game;
  }
  function ensureActivityDialog() {
    if(activityDialog)return activityDialog;
    const document=global.document;
    if(!document?.createElement)return null;
    activityDialog=document.createElement('dialog');
    activityDialog.className='command-activity-dialog';
    activityDialog.setAttribute('aria-labelledby','command-activity-title');
    activityDialog.setAttribute('aria-describedby','command-activity-note');
    activityDialog.innerHTML='<header class="command-activity-header"><div><p>領国の進行状況</p><h2 id="command-activity-title">行動予定表</h2></div><button type="button" class="button" data-command-close>閉じる</button></header><div class="command-activity-tools"><p class="command-activity-clock" data-command-clock></p><div class="command-activity-fields"><label class="command-activity-search"><span>城・施設・研究を探す</span><input type="search" class="input" data-command-query maxlength="100" placeholder="例：田畑、清洲城、帰還" autocomplete="off"></label><label class="command-activity-window"><span>残り時間・状態</span><select class="select" data-command-window>'+Object.entries(timeWindows).map(([key,label])=>'<option value="'+key+'">'+label+'</option>').join('')+'</select></label></div><div class="command-activity-filters" role="group" aria-label="予定の種類">'+Object.entries(filters).map(([key,label])=>'<button type="button" data-command-filter="'+key+'" aria-pressed="'+(key==='all')+'">'+label+'<span data-command-count="'+key+'">0</span></button>').join('')+'</div><p class="command-activity-count" data-command-result-count role="status" aria-live="polite"></p></div><div class="command-activity-scroll" data-command-scroll><ul class="command-operation-list" data-command-list></ul><div class="command-activity-empty" data-command-empty hidden><strong>該当する予定はありません</strong><p data-command-empty-note>普請・研究・進軍・帰還が始まると、ここに表示されます。</p><button type="button" class="button" data-command-reset>条件を解除</button></div><button type="button" class="button command-activity-more" data-command-more hidden>さらに40件を表示</button></div><footer class="command-activity-footer"><p id="command-activity-note">残り時間は現在の速度での目安です。速度・停止に連動し、完成・到着は確定後に各画面へ反映されます。</p><p><span data-command-alliance-note>同盟部隊は未取得です。</span><button type="button" class="text-link" data-action="alliance-strategy" data-command-dismiss>同盟作戦で確認</button></p></footer>';
    activityDialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    // Keep Escape local to this layer; the underlying detail retains its live
    // refresh context and receives focus again after native cancellation.
    activityDialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation?.();});
    activityDialog.addEventListener('compositionstart',event=>{if(activitySession&&event.target.matches?.('[data-command-query]'))activitySession.composing=true;});
    activityDialog.addEventListener('compositionend',event=>{
      if(!event.target.matches?.('[data-command-query]')||!currentActivityGame())return;
      activitySession.composing=false;activitySession.query=event.target.value.slice(0,100);activitySession.limit=40;renderActivity();
    });
    // Native close events are queued; an earlier close can arrive after reopen.
    activityDialog.addEventListener('close',()=>{if(!activityDialog.open)finishActivity();});
    activityDialog.addEventListener('change',event=>{
      if(!event.target.matches?.('[data-command-window]')||!currentActivityGame())return;
      activitySession.timeWindow=Object.hasOwn(timeWindows,event.target.value)?event.target.value:'all';
      activitySession.limit=40;
      renderActivity();
    });
    activityDialog.addEventListener('input',event=>{
      if(!event.target.matches?.('[data-command-query]')||!currentActivityGame())return;
      if(event.isComposing||activitySession.composing)return;
      activitySession.query=event.target.value.slice(0,100);
      activitySession.limit=40;
      renderActivity();
    });
    activityDialog.addEventListener('click',event=>{
      if(event.target===activityDialog&&event.detail>0&&(event.button??0)===0){
        const rect=activityDialog.getBoundingClientRect();
        if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){close();return;}
      }
      const button=event.target.closest?.('[data-command-close],[data-command-filter],[data-command-reset],[data-command-more],[data-command-go],[data-command-dismiss]');
      if(!button||button.disabled)return;
      if(!currentActivityGame()){event.preventDefault?.();event.stopPropagation?.();return;}
      if(button.hasAttribute('data-command-close')||button.hasAttribute('data-command-dismiss'))return close();
      if(button.hasAttribute('data-command-filter')){activitySession.filter=Object.hasOwn(filters,button.dataset.commandFilter)?button.dataset.commandFilter:'all';activitySession.limit=40;renderActivity();return;}
      if(button.hasAttribute('data-command-reset')){activitySession.filter='all';activitySession.timeWindow='all';activitySession.query='';activitySession.limit=40;
        activityDialog.querySelector('[data-command-window]').value='all';activityDialog.querySelector('[data-command-query]').value='';renderActivity();return;}
      if(button.hasAttribute('data-command-more')){activitySession.limit+=40;renderActivity();return;}
      const destination=button.dataset.commandGo,options=activitySession.options;
      const target=activitySession.model?.items.find(row=>row.id===button.dataset.commandKey)?.target;
      close();
      // Route from the rendered read-only model. The app rechecks the current
      // target before opening it, including completed work and lost castles.
      if(target&&typeof options.openOperation==='function'&&options.openOperation({...target})===true)return;
      if(destination==='marches')global.SengokuTravelUI?.open?.();else if(['research','map','facilities'].includes(destination))options.navigate?.(destination);
    });
    document.body.appendChild(activityDialog);
    return activityDialog;
  }
  function renderActivity(data,clock) {
    const session=activitySession;
    if(!session||!activityDialog?.open)return;
    const game=currentActivityGame();if(!game)return;
    if(data)session.data=data;
    if(clock)session.clock=clock;
    const model=buildOperations(game,{catalog:session.options.catalog,marches:session.data?.active||[],clock:session.clock});
    session.model=model;
    const rows=matchingOperations(model,session.filter,session.query,session.timeWindow),visible=rows.slice(0,session.limit),byId=new Map(visible.map(row=>[row.id,row]));
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
    const shape=JSON.stringify(visible.map(row=>[row.id,row.name,row.detail,row.category,row.queued,row.destination,row.target]));
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
    if(!rows.length)text('[data-command-empty-note]',model.items.length?'条件を変更すると、ほかの予定を確認できます。':'普請・研究・進軍・帰還が始まると、ここに表示されます。');
    activityDialog.querySelector('[data-command-reset]').hidden=session.filter==='all'&&session.timeWindow==='all'&&!session.query;
    activityDialog.querySelector('[data-command-more]').hidden=rows.length<=session.limit;
  }
  function open(options = {}) {
    const game=options.getGame?.()||options.game;
    if(!game)return false;
    const dialog=ensureActivityDialog();
    if(!dialog)return false;
    if(plannerSession)closePlanner();
    if(activitySession)close();
    const scope=identity(game),saved=activityDraft?.scope===scope?activityDraft:null,explicit=Object.hasOwn(filters,options.filter);
    if(!saved)activityDraft=null;
    const session={options,scope,returnFocus:global.document.activeElement,filter:explicit?options.filter:saved?.filter||'all',timeWindow:explicit?'all':saved?.timeWindow||'all',query:explicit?'':saved?.query||'',limit:explicit?40:saved?.limit||40,composing:false,model:null,unsubscribe:null};
    activitySession=session;
    dialog.querySelector('[data-command-query]').value=session.query;
    dialog.querySelector('[data-command-window]').value=session.timeWindow;
    dialog.showModal();
    if(typeof global.SengokuTravelUI?.subscribe==='function'){
      session.unsubscribe=global.SengokuTravelUI.subscribe((data,clock)=>{if(activitySession===session)renderActivity(data,clock);});
      if(activitySession!==session){session.unsubscribe?.();return false;}
    }
    else renderActivity(global.SengokuTravelUI?.snapshot?.()||{active:[]});
    if(activitySession!==session)return false;
    // Restore after the rows exist so a previous short list cannot clamp the
    // saved scroll position before its expanded page has been rebuilt.
    dialog.scrollTop=explicit?0:saved?.dialogTop||0;
    dialog.querySelector('[data-command-scroll]').scrollTop=explicit?0:saved?.top||0;
    dialog.querySelector('[data-command-close]')?.focus({preventScroll:true});
    return true;
  }

  let plannerDialog=null,plannerSession=null,plannerDraft=null;
  // Epochs protect a live UI from identity changes, but reset on page reload.
  // Durable plans are instead scoped to the stable owner, campaign, home and
  // actual role. They are display preferences, separate from game save data.
  function persistentPlannerScope(game) {
    const state=game?.state||{},access=global.SengokuSocial?.getExpansionContext?.()||{},role=global.SengokuBridge?.getRoleAccess?.()||{};
    if(access.pending===true||access.banned===true||access.user?.isBanned===true||access.rolePending===true||role.pending===true||global.SengokuBridge?.hasStarted?.()===false)return null;
    const campaign=state.walking?.campaignId||state.campaignId,home=state.home,clan=state.clan;
    const player=access.playerId||access.user?.id||'';
    if(campaign==='legacy_v1')return null;
    if(![campaign,home,clan].every(value=>typeof value==='string'&&value.length>0&&value.length<=160)||typeof player!=='string'||player.length>160)return null;
    if(player&&(!access.user||access.user.id!==player||(access.user.isAdmin===true)!==(game?.isAdmin===true)||(!access.user.isAdmin&&access.user.isStaff===true)!==(game?.isStaff===true)))return null;
    return JSON.stringify([player?'player:'+player:'local',campaign,home,clan,game?.isAdmin===true,game?.isStaff===true]);
  }
  function validStoredScope(value) {
    if(typeof value!=='string'||value.length>1000)return null;
    try {
      const parts=JSON.parse(value);
      if(!Array.isArray(parts)||parts.length!==6||!parts.slice(0,4).every(v=>typeof v==='string'&&v.length>0&&v.length<=167)||
        ![true,false].includes(parts[4])||![true,false].includes(parts[5])||!(parts[0]==='local'||parts[0].startsWith('player:')&&parts[0].length>7))return null;
      return JSON.stringify(parts);
    } catch (_) {return null;}
  }
  function safePlannerInput(value) {
    // Retain harmless incomplete/invalid numeric drafts such as a negative or
    // decimal. The existing budget validator will still display them as invalid.
    // Markup, nonfinite values, objects and impractically large numbers cannot
    // become a persisted value or silently turn into a zero budget.
    if(typeof value!=='string'||value.length>24)return false;
    if(value==='')return true;
    if(!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d{1,2})?$/.test(value))return false;
    const numeric=Number(value);return Number.isFinite(numeric)&&Math.abs(numeric)<=Number.MAX_SAFE_INTEGER;
  }
  function plannerData(raw) {
    if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Array.isArray(raw.plan)||raw.plan.length>PLAN_LIMIT||
      !raw.selection||typeof raw.selection!=='object'||!['building','research','custom','plan'].includes(raw.selection.kind))return null;
    const validGoal=goal=>goal&&typeof goal==='object'&&!Array.isArray(goal)&&['building','research'].includes(goal.kind)&&typeof goal.id==='string'&&/^[a-z][a-z0-9_]{0,63}$/.test(goal.id);
    if(raw.plan.some(goal=>!validGoal(goal))||['building','research'].includes(raw.selection.kind)&&!validGoal(raw.selection))return null;
    for(const name of ['reserve','draft'])if(!raw[name]||typeof raw[name]!=='object'||Array.isArray(raw[name])||!Object.keys(resources).every(key=>Object.hasOwn(raw[name],key)&&safePlannerInput(raw[name][key])))return null;
    const seen=new Set(),plan=[];
    for(const goal of raw.plan){const key=goal.kind+':'+goal.id;if(!seen.has(key)){seen.add(key);plan.push({kind:goal.kind,id:goal.id});}}
    return {selection:{kind:raw.selection.kind,...(['building','research'].includes(raw.selection.kind)?{id:raw.selection.id}:{})},plan,
      reserve:Object.fromEntries(Object.keys(resources).map(key=>[key,raw.reserve[key]])),draft:Object.fromEntries(Object.keys(resources).map(key=>[key,raw.draft[key]]))};
  }
  function plannerStore(storage) {
    let text;
    try {text=storage.getItem(PLAN_STORAGE_KEY);}catch(_){return{records:[],unavailable:true};}
    try {
      if(text===null)return{records:[]};
      if(typeof text!=='string'||text.length*2>PLAN_STORAGE_BYTES)return{records:[],invalid:true};
      const parsed=JSON.parse(text);
      if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return{records:[],invalid:true};
      if(parsed.version!==PLAN_STORAGE_VERSION)return{records:[],version:true};
      if(!Array.isArray(parsed.records)||parsed.records.length>PLAN_STORAGE_LIMIT)return{records:[],invalid:true};
      const records=[],rejected=[],seen=new Set();
      for(const record of parsed.records){
        const scope=validStoredScope(record?.scope),data=plannerData(record?.data);
        if(!scope||!data||!Number.isSafeInteger(record.updatedAt)||record.updatedAt<0||seen.has(scope)){rejected.push(typeof record?.scope==='string'?record.scope:'');continue;}
        seen.add(scope);records.push({scope,updatedAt:Math.min(record.updatedAt,Date.now()),data});
      }
      return{records,rejected,invalid:rejected.length>0};
    }catch(_){return{records:[],invalid:true};}
  }
  function persistenceStatus(session) {
    if(!plannerDialog||plannerSession!==session)return;
    const label=session.persistenceError||(!session.storage||!session.durableScope?'この起動中の計画を保持します。端末への保存は現在利用できません。':'この端末の同じ領主・戦役・本拠・役割で再開できます。最近編集した6組まで保存し、容量に応じて古い計画から整理します。');
    const node=plannerDialog.querySelector('[data-budget-storage-note]');if(node&&node.textContent!==label)node.textContent=label;
  }
  function snapshotPlanner(session) {return {selection:{kind:session.selection.kind,id:session.selection.id},plan:session.plan.map(row=>({kind:row.kind,id:row.id})),reserve:{...session.reserve},draft:{...session.draft}};}
  function mergePlannerEdits(session,data,current) {
    const baseline=session.baseline;
    if(!current||!baseline)return data;
    // A retained dialog is a snapshot. Apply only its changed fields so an
    // unrelated edit cannot revert a newer plan saved in another tab.
    const changed=key=>JSON.stringify(data[key])!==JSON.stringify(baseline[key]);
    return {selection:changed('selection')?data.selection:current.selection,plan:changed('plan')?data.plan:current.plan,
      reserve:Object.fromEntries(Object.keys(resources).map(key=>[key,data.reserve[key]!==baseline.reserve[key]?data.reserve[key]:current.reserve[key]])),
      draft:Object.fromEntries(Object.keys(resources).map(key=>[key,data.draft[key]!==baseline.draft[key]?data.draft[key]:current.draft[key]]))};
  }
  function flushPlanner(session=plannerSession) {
    if(!session)return false;
    if(session.saveTimer!==null){global.clearTimeout?.(session.saveTimer);session.saveTimer=null;}
    if(!session.dirty||!session.storage||!session.durableScope)return false;
    const game=session.options.getGame?.()||session.options.game;
    // A delayed input/close callback must never write across an account, role or
    // campaign transition, including a temporarily unconfirmed role.
    if(!game||identity(game)!==session.scope||persistentPlannerScope(game)!==session.durableScope||global.SENGOKU_AT_TITLE===true)return false;
    const data=plannerData(snapshotPlanner(session));
    if(!data){session.persistenceError='入力に保存できない値があります。この起動中は入力を保持します。数値を確認してください。';persistenceStatus(session);return false;}
    const stored=plannerStore(session.storage);
    if(stored.version){session.persistenceError='保存された計画の形式が異なるため、上書きせずこの起動中だけ保持します。';persistenceStatus(session);return false;}
    if(stored.invalid){session.persistenceError='保存された計画を確認できません。元のデータを上書きせず、この起動中だけ保持します。';persistenceStatus(session);return false;}
    if(stored.unavailable){session.persistenceError='この端末の計画を読み取れません。元のデータを上書きせず、この起動中だけ保持します。';persistenceStatus(session);return false;}
    const merged=mergePlannerEdits(session,data,stored.records.find(record=>record.scope===session.durableScope)?.data);
    const records=stored.records.filter(record=>record.scope!==session.durableScope).sort((a,b)=>b.updatedAt-a.updatedAt);
    records.unshift({scope:session.durableScope,updatedAt:Date.now(),data:merged});records.length=Math.min(records.length,PLAN_STORAGE_LIMIT);
    let text=JSON.stringify({version:PLAN_STORAGE_VERSION,records});
    while(text.length*2>PLAN_STORAGE_BYTES&&records.length>1){records.pop();text=JSON.stringify({version:PLAN_STORAGE_VERSION,records});}
    if(text.length*2>PLAN_STORAGE_BYTES){session.persistenceError='計画の保存量を確認できないため、この起動中だけ保持します。';persistenceStatus(session);return false;}
    try {session.storage.setItem(PLAN_STORAGE_KEY,text);session.baseline=snapshotPlanner(session);session.dirty=false;
      session.persistenceError=JSON.stringify(merged)!==JSON.stringify(data)?'別の画面の変更も残して保存しました。最新の計画は開き直すと確認できます。':'';
      persistenceStatus(session);return true;}
    catch(_){session.persistenceError='この端末に計画を保存できません。この起動中の計画は引き続き使えます。';persistenceStatus(session);return false;}
  }
  function plannerEdited(session=plannerSession) {
    if(!session)return;
    session.dirty=true;
    if(!session.storage||!session.durableScope)return;
    if(session.saveTimer!==null)global.clearTimeout?.(session.saveTimer);
    session.saveTimer=typeof global.setTimeout==='function'?global.setTimeout(()=>{if(plannerSession===session)flushPlanner(session);},PLAN_SAVE_DELAY):null;
  }
  function plannerCurrent(session=plannerSession) {
    if(!session)return false;
    const game=session.options.getGame?.()||session.options.game;
    if(!game||identity(game)!==session.scope||global.SENGOKU_AT_TITLE===true){closePlanner();return false;}
    return true;
  }
  function finishPlanner() {
    const session=plannerSession;if(!session)return;
    flushPlanner(session);
    plannerDraft={scope:session.scope,...snapshotPlanner(session),baseline:session.baseline,dirty:session.dirty,persistenceError:session.persistenceError,
      view:{top:plannerDialog.scrollTop,scroll:plannerDialog.querySelector('.resource-plan-scroll').scrollTop,reserve:plannerDialog.querySelector('.resource-plan-reserve').open,forecast:plannerDialog.querySelector('.resource-plan-forecast').open}};
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
    dialog.innerHTML='<header class="command-activity-header"><div><p>次の一手の準備</p><h2 id="resource-plan-title">資源計画</h2></div><button type="button" class="button" data-budget-close>閉じる</button></header><div class="resource-plan-scroll">' +
      '<div class="resource-plan-select-row"><label class="resource-plan-picker"><span>何を準備しますか</span><select class="select" data-budget-choice></select></label><button type="button" class="button gold" data-budget-add>計画へ追加</button></div>' +
      '<p class="resource-plan-note" data-budget-storage-note></p><p class="resource-plan-note" data-budget-restore-note hidden></p><p class="resource-plan-feedback" data-budget-feedback role="status" aria-live="polite"></p><section class="resource-plan-basket" data-budget-basket hidden aria-labelledby="resource-plan-basket-title"><header><div><h3 id="resource-plan-basket-title">まとめて準備</h3><p><span data-budget-plan-count>0</span> / '+PLAN_LIMIT+'件 · 異なる目標の次の1段階</p></div><button type="button" class="button" data-budget-total>合計を試算</button></header><ul data-budget-plan-list></ul><div class="resource-plan-basket-footer"><small>普請の予約・完成に応じて、準備する段階と費用も進みます。</small><button type="button" class="text-link" data-budget-clear-plan>計画を空にする</button></div></section>' +
      '<h3 class="resource-plan-goal" data-budget-goal></h3><p class="resource-plan-note" data-budget-goal-note></p><section class="resource-plan-summary" aria-label="資源が揃う目安" data-budget-summary><strong data-budget-title></strong><p data-budget-detail></p></section>' +
      '<div class="resource-plan-grid">'+Object.entries(resources).map(([key,label])=>'<section class="resource-plan-card" data-budget-card="'+key+'"><h3>'+label+'</h3><dl><div><dt>現在</dt><dd data-budget-current="'+key+'"></dd></div><div><dt>毎月の差引</dt><dd data-budget-rate="'+key+'"></dd></div></dl><label><span>目標の費用</span><input class="input" type="number" min="0" step="1" inputmode="numeric" aria-label="'+label+'の必要な合計" data-budget-target="'+key+'"></label><dl class="resource-plan-reserve-values"><div><dt>残す備蓄</dt><dd data-budget-reserved="'+key+'">0</dd></div><div><dt>必要な総額</dt><dd data-budget-required="'+key+'"></dd></div></dl><div class="resource-plan-gap"><span>不足</span><strong data-budget-gap="'+key+'"></strong></div><div class="resource-plan-track" aria-hidden="true"><i data-budget-track="'+key+'"></i></div></section>').join('')+'</div>' +
      '<details class="resource-plan-reserve"><summary>使わずに残す備蓄を決める<span data-budget-reserve-summary></span></summary><p class="resource-plan-note">費用を支払った後も手元に残したい量です。「費用＋備蓄」が全資源で揃う時点を試算します。実際の資源を取り置く操作は行いません。</p><div class="resource-plan-reserve-grid">'+Object.entries(resources).map(([key,label])=>'<label><span>'+label+'</span><input class="input" type="number" min="0" step="1" inputmode="numeric" value="0" aria-label="使わずに残す'+label+'の備蓄" data-budget-reserve="'+key+'"></label>').join('')+'</div><button type="button" class="text-link" data-budget-reserve-reset>備蓄をすべて0に戻す</button></details>' +
      '<details class="resource-plan-forecast"><summary>1・3・6か月後の残高を試算</summary><p class="resource-plan-note">ゲーム内の月数です。現在の差引がそのまま続く場合を表示します。計画の費用を支払う前の残高です。</p><div class="resource-plan-table"><table><thead><tr><th scope="col">資源</th>'+[1,3,6].map(month=>'<th scope="col">'+month+'か月後</th>').join('')+'</tr></thead><tbody>'+Object.entries(resources).map(([key,label])=>'<tr><th scope="row">'+label+'</th>'+[0,1,2].map(index=>'<td data-budget-after="'+key+':'+index+'"></td>').join('')+'</tr>').join('')+'</tbody></table></div></details>' +
      '<p class="resource-plan-note resource-plan-warning" data-budget-military hidden>金銭・兵糧の赤字は月替わりの自動減兵で変わるため、この試算どおりには進まない場合があります。</p><p class="resource-plan-note">施設・研究は現在の進行から次の1段階を選びます。普請を予約するとその先の段階へ進み、研究中の目標は完成後に次の費用を計算します。費用や待ち時間は固定されません。</p><p class="resource-plan-note">生産・維持費・給与・次回修復費を含む現在の差引を固定した概算です。工事完成、報酬、戦闘、売買、追加支出などによる変化や月末の精算時点は含みません。自動で購入・建設・予約はしません。</p><div class="resource-plan-actions"><button type="button" class="button gold resource-plan-target" data-budget-open-target hidden></button><button type="button" class="button" data-budget-go="facilities">施設を見る</button><button type="button" class="button" data-budget-go="research">研究を見る</button></div></div>';
    dialog.addEventListener('cancel',event=>{event.preventDefault();closePlanner();});
    // A facility detail may remain beneath this dialog. Its global Escape
    // handler must not clear that underlying modal's live-refresh context.
    dialog.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation?.();});
    dialog.addEventListener('close',()=>{if(!dialog.open)finishPlanner();});
    global.addEventListener?.('pagehide',()=>flushPlanner());
    document.addEventListener?.('visibilitychange',()=>{if(document.hidden)flushPlanner();});
    dialog.addEventListener('click',event=>{
      if(!plannerSession)return;
      if(!plannerCurrent())return;
      const session=plannerSession,game=session.options.getGame?.()||session.options.game;
      const announce=message=>{dialog.querySelector('[data-budget-feedback]').textContent=message;};
      const showPlan=()=>{if(session.selection.kind!=='plan'){session.selection={kind:'plan'};plannerEdited(session);}dialog.querySelector('[data-budget-choice]').value='plan';renderPlanner();};
      if(event.target.closest?.('[data-budget-add]')){
        const selection=session.selection,key=selection.kind+':'+selection.id;
        if(!['building','research'].includes(selection.kind))return;
        if(session.plan.some(row=>row.kind+':'+row.id===key)){announce('この目標は計画に入っています。');return;}
        if(session.plan.length>=PLAN_LIMIT){announce('計画は'+PLAN_LIMIT+'件までです。項目を外してから追加してください。');return;}
        const goal=budgetGoal(game,selection,{catalog:session.options.catalog,staffReady:session.options.staffReady?.()===true});
        if(goal.unavailable){announce(goal.title);renderPlanner();return;}
        session.plan.push({kind:selection.kind,id:selection.id});plannerEdited(session);showPlan();announce(goal.title+'を計画に追加しました。');dialog.querySelector('[data-budget-total]').focus({preventScroll:true});return;
      }
      if(event.target.closest?.('[data-budget-total]')){showPlan();announce(session.plan.length+'件の合計を表示しています。');return;}
      const remove=event.target.closest?.('[data-budget-remove]');
      if(remove){const next=session.plan.filter(row=>row.kind+':'+row.id!==remove.dataset.budgetRemove);if(next.length!==session.plan.length){session.plan=next;plannerEdited(session);}renderPlanner();announce('計画から目標を外しました。');return;}
      if(event.target.closest?.('[data-budget-clear-plan]')){if(session.plan.length){session.plan=[];plannerEdited(session);}renderPlanner();announce('計画を空にしました。');dialog.querySelector('[data-budget-choice]').focus({preventScroll:true});return;}
      if(event.target.closest?.('[data-budget-reserve-reset]')){if(Object.values(session.reserve).some(value=>value!=='0')){for(const input of dialog.querySelectorAll('[data-budget-reserve]')){session.reserve[input.dataset.budgetReserve]='0';input.value='0';}plannerEdited(session);}renderPlanner();announce('残す備蓄をすべて0に戻しました。');return;}
      if(event.target.closest?.('[data-budget-open-target]')){
        const {kind,id}=session.selection,catalog=session.options.catalog;
        if(!['building','research'].includes(kind)||!(kind==='building'?catalog.buildings:catalog.techs)?.some(row=>row.id===id))return;
        const options=session.options,target={kind,id,shared:kind==='building'&&game.isStaff===true};
        // Finish saving the draft and release its clock listener before the
        // existing application route checks the current target and opens it.
        closePlanner();
        if(options.openOperation?.(target)!==true)options.navigate?.(kind==='building'?'facilities':'research');
        return;
      }
      const button=event.target.closest?.('[data-budget-close],[data-budget-go]');
      if(button){const destination=button.dataset.budgetGo,options=plannerSession.options;closePlanner();if(['facilities','research'].includes(destination))options.navigate?.(destination);return;}
      if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closePlanner();}
    });
    dialog.addEventListener('change',event=>{
      if(!event.target.matches?.('[data-budget-choice]')||!plannerCurrent())return;
      const [kind,id]=event.target.value.split(':');if(!['building','research','custom','plan'].includes(kind))return;
      const changed=plannerSession.selection.kind!==kind||plannerSession.selection.id!==id;
      plannerSession.selection={kind,id,targets:plannerSession.draft};
      if(kind==='custom')for(const input of dialog.querySelectorAll('[data-budget-target]'))input.value=plannerSession.draft[input.dataset.budgetTarget];
      if(changed)plannerEdited();dialog.querySelector('[data-budget-feedback]').textContent='';renderPlanner();
    });
    dialog.addEventListener('input',event=>{
      if(!plannerCurrent())return;
      if(event.target.matches?.('[data-budget-reserve]')){const key=event.target.dataset.budgetReserve;if(!Object.hasOwn(resources,key))return;if(plannerSession.reserve[key]!==event.target.value){plannerSession.reserve[key]=event.target.value;plannerEdited();}renderPlanner();return;}
      if(plannerSession.selection.kind!=='custom'||!event.target.matches?.('[data-budget-target]'))return;
      const key=event.target.dataset.budgetTarget;if(!Object.hasOwn(resources,key))return;
      if(plannerSession.draft[key]!==event.target.value){plannerSession.draft[key]=event.target.value;plannerEdited();}renderPlanner();
    });
    document.body.appendChild(dialog);return dialog;
  }
  function renderPlanner(clock) {
    const session=plannerSession;if(!session||!plannerDialog?.open)return;
    const game=session.options.getGame?.()||session.options.game;
    if(!game||identity(game)!==session.scope||global.SENGOKU_AT_TITLE===true){closePlanner();return;}
    if(clock)session.clock=clock;
    const goalOptions={catalog:session.options.catalog,staffReady:session.options.staffReady?.()===true,jobs:game?.constructionJobs?.()??game?.state?.jobs??[]};
    const plan=combinedBudgetGoal(game,session.plan,goalOptions);
    const goal=session.selection.kind==='plan'?plan:budgetGoal(game,session.selection,goalOptions);
    const model=buildBudget(game,goal.targets,{catalog:session.options.catalog,clock:session.clock,reserve:session.reserve}),dialog=plannerDialog;
    const text=(selector,value)=>{const node=dialog.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value;};
    text('[data-budget-goal]',goal.title);text('[data-budget-goal-note]',goal.note);
    const target=dialog.querySelector('[data-budget-open-target]'),targetKind=session.selection.kind,
      targetRow=(targetKind==='building'?session.options.catalog.buildings:targetKind==='research'?session.options.catalog.techs:[])?.find(row=>row.id===session.selection.id);
    const targetHidden=!targetRow;if(target.hidden!==targetHidden)target.hidden=targetHidden;if(target.disabled!==targetHidden)target.disabled=targetHidden;
    if(targetRow)text('[data-budget-open-target]',targetRow.name+(targetKind==='building'?'の詳細を開く':'の研究を見る'));
    text('[data-budget-title]',goal.unavailable?'費用の試算はできません':model.title);
    text('[data-budget-detail]',goal.unavailable?'目標を変更するか、各画面で現在の状態を確認してください。':model.detail);
    dialog.querySelector('[data-budget-summary]').dataset.state=goal.unavailable?'unavailable':model.status;
    const add=dialog.querySelector('[data-budget-add]'),key=session.selection.kind+':'+session.selection.id,inPlan=session.plan.some(row=>row.kind+':'+row.id===key);
    add.disabled=goal.unavailable===true||!['building','research'].includes(session.selection.kind)||inPlan||session.plan.length>=PLAN_LIMIT;
    text('[data-budget-add]',inPlan?'追加済み':'計画へ追加');
    const basket=dialog.querySelector('[data-budget-basket]');basket.hidden=!session.plan.length;
    text('[data-budget-plan-count]',number(session.plan.length));
    const list=dialog.querySelector('[data-budget-plan-list]');
    const shape=JSON.stringify(plan.items.map(item=>[item.key,item.title,item.targets,item.note,item.unavailable]));
    if(list.dataset.shape!==shape){
      const scroll=dialog.querySelector('.resource-plan-scroll'),top=scroll.scrollTop,focused=global.document.activeElement,focusKey=list.contains(focused)?focused?.dataset?.budgetRemove:null;
      const html=plan.items.map(item=>'<li data-stable-key="'+esc(item.key)+'" data-budget-plan-item="'+esc(item.key)+'"'+(item.unavailable?' class="is-unavailable"':'')+'><div><strong>'+esc(item.title)+'</strong><p class="resource-plan-item-cost">'+(item.unavailable?'現在は費用を確認できません':Object.entries(resources).filter(([key])=>Number(item.targets?.[key])>0).map(([key,label])=>label+' '+number(item.targets[key])).join(' · ')||'資源の費用なし')+'</p><details><summary>着手条件・注意点</summary><p>'+esc(item.note)+'</p></details></div><button type="button" class="button small" data-budget-remove="'+esc(item.key)+'" aria-label="'+esc(item.title)+'を計画から外す">外す</button></li>').join('');
      if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(list,html);else list.innerHTML=html;
      list.dataset.shape=shape;scroll.scrollTop=top;
      if(focusKey){const next=Array.from(list.querySelectorAll('[data-budget-remove]')).find(node=>node.dataset.budgetRemove===focusKey);(next||dialog.querySelector('[data-budget-choice]')).focus({preventScroll:true});}
    }
    text('[data-budget-reserve-summary]',model.rows.some(row=>!row.reserveValid)?'入力を確認':model.hasReserve?'設定あり':'未設定');
    for(const row of model.rows) {
      const input=dialog.querySelector('[data-budget-target="'+row.key+'"]');
      const auto=goal.kind!=='custom';input.readOnly=auto;input.disabled=goal.unavailable===true;
      if(auto){const value=goal.unavailable?'':String(row.target);if(input.value!==value)input.value=value;}
      input.setAttribute('aria-invalid',String(!row.targetValid));
      dialog.querySelector('[data-budget-reserve="'+row.key+'"]').setAttribute('aria-invalid',String(!row.reserveValid));
      text('[data-budget-current="'+row.key+'"]',number(row.current));
      text('[data-budget-rate="'+row.key+'"]',signed(row.rate));
      dialog.querySelector('[data-budget-rate="'+row.key+'"]').classList.toggle('is-negative',row.rate<0);
      text('[data-budget-reserved="'+row.key+'"]',row.reserveValid?number(row.reserve):'入力を確認');
      text('[data-budget-required="'+row.key+'"]',goal.unavailable||!row.valid?'—':number(row.required));
      text('[data-budget-gap="'+row.key+'"]',goal.unavailable||!row.valid?'—':number(row.deficit));
      const track=dialog.querySelector('[data-budget-track="'+row.key+'"]'),width=(goal.unavailable||!row.valid?0:row.required?Math.min(100,row.current/row.required*100):100).toFixed(1)+'%';
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
    choice.innerHTML='<option value="custom">自由入力で予算を組む</option><option value="plan">まとめた計画の合計</option><optgroup label="施設の次の普請">'+(catalog.buildings||[]).map(row=>'<option value="building:'+esc(row.id)+'">'+esc(row.name)+'</option>').join('')+'</optgroup><optgroup label="次の研究">'+(catalog.techs||[]).map(row=>'<option value="research:'+esc(row.id)+'">'+esc(row.name)+'</option>').join('')+'</optgroup>';
    const scope=identity(game),durableScope=persistentPlannerScope(game),memory=plannerDraft?.scope===scope?plannerDraft:null;
    if(!memory)plannerDraft=null;
    let storage=null,stored={records:[]},persistenceError='',restoreReason='';
    if(durableScope){
      try {const candidate=global.localStorage;if(candidate&&typeof candidate.getItem==='function'&&typeof candidate.setItem==='function')storage=candidate;}catch(_){}
      if(storage)stored=plannerStore(storage);
      if(stored.version)persistenceError='保存された計画の形式が異なるため、復元・上書きをせずこの起動中だけ保持します。';
      else if(stored.invalid)persistenceError='保存された計画を確認できません。元のデータを上書きせず、この起動中だけ保持します。';
      else if(stored.unavailable)persistenceError='この端末の計画を読み取れません。元のデータを上書きせず、この起動中だけ保持します。';
    }
    const record=!stored.version&&!stored.invalid&&!stored.unavailable?stored.records.find(row=>row.scope===durableScope):null;
    // An unchanged memory draft may predate another tab's saved plan. Restore
    // the current durable record unless this tab still has unsaved edits.
    const restoreStored=Boolean(record)&&memory?.dirty!==true;
    const saved=restoreStored?record.data:memory;
    // Keep an unsaved in-memory draft and its warning when the dialog reopens.
    // If a quota/access failure has cleared, retry the same draft after opening.
    if(memory?.dirty&&!persistenceError)persistenceError=memory.persistenceError||'';
    if(!saved&&stored.records.length&&!persistenceError)restoreReason='この領主・戦役・本拠・役割に合う計画がないため、新しい計画を表示しています。以前の計画はそのまま保持します。';
    const explicit=['building','research','custom','plan'].includes(options.kind);
    const kind=explicit?options.kind:saved?.selection.kind||'building',id=typeof options.id==='string'?options.id:saved?.selection.kind===kind?saved.selection.id:'farm';
    let selected=Array.from(choice.options).some(option=>option.value===kind+':'+id)?kind+':'+id:['custom','plan'].includes(kind)?kind:'';
    // Keep a well-formed retired target visible as unavailable. Dropping it
    // would make a partially restored plan appear cheaper or already funded.
    if(!selected&&saved?.selection.kind===kind&&saved.selection.id===id&&['building','research'].includes(kind)){
      selected=kind+':'+id;choice.insertAdjacentHTML('beforeend','<option value="'+esc(selected)+'">以前の目標（現在は利用不可）</option>');
    }
    if(!selected)selected=catalog.buildings?.length?'building:'+catalog.buildings[0].id:'custom';
    choice.value=selected;const [selectedKind,selectedId]=selected.split(':');
    const draft=saved?{...saved.draft}:Object.fromEntries(Object.keys(resources).map(key=>[key,String(Math.floor(nonnegative(game.state?.resources?.[key])))]));
    const reserve=saved?{...saved.reserve}:Object.fromEntries(Object.keys(resources).map(key=>[key,'0']));
    for(const input of dialog.querySelectorAll('[data-budget-target]'))input.value=draft[input.dataset.budgetTarget];
    for(const input of dialog.querySelectorAll('[data-budget-reserve]'))input.value=reserve[input.dataset.budgetReserve];
    dialog.querySelector('[data-budget-feedback]').textContent='';
    const session={options:{...options,catalog},scope,durableScope,storage,persistenceError,dirty:memory?.dirty===true,saveTimer:null,selection:{kind:selectedKind,id:selectedId,targets:draft},draft,reserve,plan:saved?saved.plan.map(row=>({...row})):[],returnFocus:global.document.activeElement,unsubscribe:null,
      baseline:memory?.dirty?memory.baseline:saved?snapshotPlanner(saved):null};
    if(!session.baseline){session.baseline=snapshotPlanner(session);if(explicit&&!saved)session.baseline.selection=null;}
    if(restoreStored){
      const targets=[...session.plan,...(['building','research'].includes(selectedKind)?[session.selection]:[])];
      const unknown=targets.some(goal=>!(goal.kind==='building'?catalog.buildings:catalog.techs)?.some(item=>item.id===goal.id));
      if(unknown)restoreReason='保存した目標に、現在の一覧にない項目があります。費用は確定せず、目標を選び直すか計画から外すまで保持します。';
      else if(Object.values({...draft,...Object.fromEntries(Object.entries(reserve).map(([key,value])=>['reserve_'+key,value]))}).some(value=>value!==''&&(!Number.isSafeInteger(Number(value))||Number(value)<0)))restoreReason='保存した入力に0以上の整数ではない値があります。入力を確認してください。';
    }
    const restored=dialog.querySelector('[data-budget-restore-note]');restored.textContent=restoreReason;restored.hidden=!restoreReason;
    plannerSession=session;persistenceStatus(session);dialog.showModal();dialog.scrollTop=0;dialog.querySelector('.resource-plan-scroll').scrollTop=0;
    if(typeof global.SengokuTravelUI?.subscribe==='function'){
      session.unsubscribe=global.SengokuTravelUI.subscribe((_data,clock)=>{if(plannerSession===session)renderPlanner(clock);});
      if(plannerSession!==session){session.unsubscribe?.();return false;}
    }else renderPlanner();
    if(plannerSession!==session)return false;
    const view=memory?.selection.kind===selectedKind&&memory.selection.id===selectedId?memory.view:null;
    dialog.querySelector('.resource-plan-reserve').open=view?.reserve===true;
    dialog.querySelector('.resource-plan-forecast').open=view?.forecast===true;
    // Restore only this goal's in-memory position, after its rows exist. A
    // different goal or campaign starts at its heading instead of stale content.
    dialog.scrollTop=view?.top||0;dialog.querySelector('.resource-plan-scroll').scrollTop=view?.scroll||0;
    if(memory?.dirty||explicit&&(!saved||saved.selection.kind!==selectedKind||saved.selection.id!==selectedId))plannerEdited(session);
    dialog.querySelector('[data-budget-close]')?.focus({preventScroll:true});return true;
  }

  const api = {build, markup, refresh, buildOperations, matchingOperations, open, close, buildBudget, budgetGoal, combinedBudgetGoal, openPlanner, closePlanner};
  global.SengokuCommandCenter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
