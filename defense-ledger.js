/* Read-only defense and repair ledger. Quotes come from the live engine; opening
 * or filtering this screen never advances time, pays materials or issues orders. */
(function (global) {
  'use strict';
  const KINDS = {all:'城と支拠点',castle:'城',branch:'支拠点'};
  const STATUSES = {all:'すべて',damaged:'損傷あり',shortage:'資材不足',rebuild:'復旧が必要',sound:'健全'};
  const SORTS = {damage:'損傷が大きい順',recovery:'回復予定が多い順',troops:'守備・配置兵が少ない順',name:'名前順'};
  const DIRECTIONS = {north:'北',east:'東',south:'南',west:'西'};
  const PAGE_SIZE = 24;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const amount = value => finite(value) ? Math.floor(value) : null;
  const num = value => finite(value) ? Math.floor(value).toLocaleString('ja-JP') : '不明';
  const normalize = value => String(value ?? '').normalize('NFKC').replace(/德/g,'徳').toLocaleLowerCase('ja-JP').trim();
  const safeRead = fn => { try { return fn(); } catch (_) { return null; } };
  function quoteView(raw) {
    if (!raw || !['elapsedMs','requestedHP','repairedHP'].every(key => finite(raw[key])) ||
      raw.repairedHP > raw.requestedHP || !['wood','stone'].every(key => finite(raw.cost?.[key]) && finite(raw.requiredCost?.[key])) || !Array.isArray(raw.allocations)) return null;
    const allocations = new Map();
    for (const row of raw.allocations) {
      if (!row || !['castle','branch'].includes(row.kind) || typeof row.id !== 'string' ||
        !['current','max','requestedHP','repairedHP','after'].every(key => finite(row[key])) || row.current > row.max ||
        row.repairedHP > row.requestedHP || row.after !== row.current + row.repairedHP || row.after > row.max) return null;
      const key = row.kind + ':' + row.id;
      if (allocations.has(key)) return null;
      allocations.set(key, {requested:row.requestedHP,recovery:row.repairedHP,after:row.after});
    }
    return {elapsedMs:raw.elapsedMs,requested:raw.requestedHP,recovery:raw.repairedHP,
      unfilled:raw.requestedHP-raw.repairedHP,limited:raw.repairedHP<raw.requestedHP,
      cost:{wood:raw.cost.wood,stone:raw.cost.stone},required:{wood:raw.requiredCost.wood,stone:raw.requiredCost.stone},allocations};
  }
  function durabilityView(raw) {
    if (!raw || !finite(raw.current) || !finite(raw.max) || raw.current > raw.max) return null;
    return {current:raw.current,max:raw.max,missing:raw.max-raw.current,ratio:raw.max?raw.current/raw.max:null,
      recoveryMode:raw.recoveryMode==='free'?'free':raw.recoveryMode==='paid'?'paid':'unknown'};
  }
  function owned(game, id, catalog) {
    const s = game?.state;
    if (!s?.clan || s.castles?.[id]?.owner !== s.clan) return false;
    if (id === (catalog.adminAssets?.castleId || 'edo') && game.isAdmin !== true) return false;
    if (id === (catalog.staffBaseId || 'kyoto_gosho') && game.isStaff !== true) return false;
    return typeof game.canOwnCastle === 'function' && game.canOwnCastle(id) === true;
  }
  function repairFor(row, view, quote) {
    if (!view || !quote) return null;
    const allocation = quote.allocations.get(row.key);
    if (allocation) return {...allocation,unfilled:allocation.requested-allocation.recovery};
    // Full, unfinished and fallen bases do not participate in paid automatic
    // repairs. A damaged active base missing from a quote remains unknown.
    if (view.missing === 0 || row.inactive) return {requested:0,recovery:0,after:view.current,unfilled:0};
    return null;
  }
  function build(game, options = {}) {
    const s = game?.state || {},catalog = options.catalog || game?.data || global.SENGOKU_DATA || {};
    const sharedId = catalog.staffBaseId || 'kyoto_gosho',adminId = catalog.adminAssets?.castleId || 'edo';
    const sharedReady = game?.isStaff !== true || Boolean(safeRead(() => game.getStaffBase?.())) &&
      (typeof options.staffReady !== 'function' || safeRead(options.staffReady) === true);
    // income().repair already includes production and maintenance until the next
    // month. repairQuote() deliberately uses only the materials held right now.
    const income = sharedReady ? options.income || safeRead(() => game.income?.()) : null;
    const forecast = quoteView(income?.repair);
    const current = sharedReady ? quoteView(options.currentQuote || safeRead(() => game.repairQuote?.())) : null;
    const elapsed = finite(s.turn) && finite(s.realtime?.elapsed) ? s.turn * 60000 + s.realtime.elapsed * 1000 : null;
    const nextMonth = finite(s.turn) ? (s.turn + 1) * 60000 : null;
    const rows = [],castles = new Map(),jobs = safeRead(() => game.constructionJobs?.()) || s.jobs || [];
    const jobFor = (kind,id) => Array.isArray(jobs) ? jobs.filter(job => job?.kind===kind && job.id===id) : [];
    for (const def of catalog.castles || []) {
      if (!owned(game,def.id,catalog)) continue;
      const castle = safeRead(() => game.castle?.(def.id));
      if (!castle) continue;
      castles.set(def.id,castle);
      const shared = def.id === sharedId,known = !shared || sharedReady;
      rows.push({key:'castle:'+def.id,kind:'castle',id:def.id,parentCastleId:def.id,name:castle.name||def.name||def.id,
        province:castle.province||def.province||'',owner:castle.owner,home:def.id===s.home,shared,protected:shared||def.id===adminId,
        known,view:known?durabilityView(castle.durability):null,raw:s.castles?.[def.id],level:amount(castle.level),wall:amount(castle.wall),
        troops:known?amount(castle.troops):null,defense:known?amount(safeRead(() => game.defensePower?.(def.id))):null,
        fallen:false,retreating:false,inactive:false,jobs:jobFor('castle',def.id)});
    }
    for (const record of Array.isArray(s.branches) ? s.branches : []) {
      if (!record || typeof record.id !== 'string' || !castles.has(record.parentCastleId) || record.parentCastleId===sharedId) continue;
      const branch = safeRead(() => game.branch?.(record.id));
      if (!branch) continue;
      const parent = castles.get(record.parentCastleId),inactive = branch.fallen===true || branch.retreating===true || !finite(branch.level) || branch.level<1;
      const defense = inactive ? null : safeRead(() => game.branchDefense?.(record.id));
      rows.push({key:'branch:'+record.id,kind:'branch',id:record.id,parentCastleId:record.parentCastleId,
        name:(parent.name||record.parentCastleId)+' '+(DIRECTIONS[branch.direction]||'')+'支拠点',province:parent.province||'',owner:parent.owner,
        home:false,shared:false,protected:false,known:true,view:durabilityView(branch.durability),raw:record,
        level:amount(branch.level),wall:null,troops:amount(defense?.stationedTroops ?? branch.stationedTroops ?? (record.stationedTroops===undefined?0:record.stationedTroops)),
        defense:amount(defense?.power),fallen:branch.fallen===true,retreating:branch.retreating===true,inactive,jobs:jobFor('branch',record.id)});
    }
    for (const row of rows) {
      const view = row.view;
      row.current = view?.current ?? null; row.max = view?.max ?? null; row.missing = view?.missing ?? null; row.ratio = view?.ratio ?? null;
      row.recoveryMode = view?.recoveryMode || 'unknown';
      row.rebuilding = row.jobs.some(job => job.repair===true);
      row.requested = null; row.recovery = null; row.after = null; row.unfilled = null; row.currentRecovery = null;
      if (view?.recoveryMode==='paid') {
        const planned = repairFor(row,view,forecast),held = repairFor(row,view,current);
        if (planned) Object.assign(row,planned);
        row.currentRecovery = held?.recovery ?? null;
      } else if (view?.recoveryMode==='free' && row.known && finite(nextMonth)) {
        const projected = safeRead(() => game.constructor.durabilityView(row.raw?.durability,{castleId:row.id,level:row.level,wall:row.wall,elapsedMs:nextMonth,recoveryMode:'free'}));
        if (finite(projected?.current) && projected.current>=view.current && projected.max===view.max) {
          row.recovery=projected.current-view.current;row.after=projected.current;row.requested=row.recovery;row.unfilled=0;
        }
      }
      row.status = !view?'unknown':row.retreating?'retreating':row.rebuilding?'rebuilding':row.fallen?'fallen':!view.max?'unbuilt':view.missing===0?'sound':row.unfilled>0?'shortage':'damaged';
      row.label = {unknown:'状況を確認',retreating:'撤収中',rebuilding:'復旧工事中',fallen:'復旧が必要',unbuilt:'建設中',sound:'健全',shortage:'資材不足',damaged:row.recoveryMode==='free'?'自動回復中':'修復対象'}[row.status];
      row.actionLabel = row.fallen || row.rebuilding ? '復旧工事を確認' : row.kind==='branch'?'支拠点を確認':'城の詳細を確認';
      delete row.raw;delete row.view;delete row.jobs;
    }
    const clock = options.clock === undefined ? s.realtime : options.clock;
    const running = clock?.running;
    const speed = clock?.speed;
    const waitSeconds = running===true && finite(speed) && speed>0 && finite(nextMonth) && finite(elapsed) ? Math.max(0,Math.ceil((nextMonth-elapsed)/1000/speed)) : null;
    const summary = {bases:rows.length,castles:rows.filter(row=>row.kind==='castle').length,branches:rows.filter(row=>row.kind==='branch').length,
      damaged:rows.filter(row=>row.missing>0).length,shortage:forecast?rows.filter(row=>row.unfilled>0).length:null,rebuild:rows.filter(row=>row.fallen&&!row.rebuilding&&!row.retreating).length,
      unknown:rows.filter(row=>row.current===null).length,recovery:forecast?.recovery??null,unfilled:forecast?.unfilled??null};
    const totals = quote => quote ? {requested:quote.requested,recovery:quote.recovery,unfilled:quote.unfilled,limited:quote.limited,cost:quote.cost,required:quote.required} : null;
    return {rows,summary,current:totals(current),forecast:totals(forecast),materials:{wood:amount(s.resources?.wood),stone:amount(s.resources?.stone)},
      elapsedMs:elapsed,nextMonthMs:nextMonth,running:running===true,speed:finite(speed)?speed:null,waitSeconds,sharedReady,
      note:!sharedReady?'京都御所の共同拠点を確認できると、修復の見込みを表示できます。':!forecast?'次の月替わりの修復を計算できません。最新の状況で再計算してください。':'',
      clockLabel:running===false?'共通時間は停止中です。次の月替わりの試算を表示しています。':waitSeconds===null?'次の月替わりの時刻は不明です。':`計算時点で、次の月替わりまで約${waitSeconds>=60?Math.floor(waitSeconds/60)+'分':''}${waitSeconds%60||waitSeconds<60?waitSeconds%60+'秒':''}（${speed}倍速）`};
  }
  function normalizedFilters(raw = {}) {
    return {kind:Object.hasOwn(KINDS,raw.kind)?raw.kind:'all',status:Object.hasOwn(STATUSES,raw.status)?raw.status:'all',
      sort:Object.hasOwn(SORTS,raw.sort)?raw.sort:'damage',query:String(raw.query??'').slice(0,100)};
  }
  function filter(model, raw = {}) {
    const settings=normalizedFilters(raw),terms=normalize(settings.query).split(/\s+/).filter(Boolean);
    const rows=(model?.rows||[]).filter(row => (settings.kind==='all'||row.kind===settings.kind) &&
      (settings.status==='all'||settings.status==='damaged'&&row.missing>0||settings.status==='shortage'&&row.unfilled>0||settings.status==='rebuild'&&row.fallen&&!row.rebuilding&&!row.retreating||settings.status==='sound'&&row.status==='sound') &&
      terms.every(term=>normalize([row.name,row.province,row.owner,row.home?'本拠':'',row.shared?'共同 京都御所':'',row.label].join(' ')).includes(term)));
    const compareName=(a,b)=>a.name.localeCompare(b.name,'ja')||a.key.localeCompare(b.key);
    const knownFirst=(a,b,key,descending=false)=>a[key]===null?(b[key]===null?0:1):b[key]===null?-1:(descending?b[key]-a[key]:a[key]-b[key]);
    return rows.sort((a,b) => settings.sort==='name'?compareName(a,b):settings.sort==='recovery'?knownFirst(a,b,'recovery',true)||compareName(a,b):
      settings.sort==='troops'?knownFirst(a,b,'troops')||compareName(a,b):Number(b.fallen&&!b.rebuilding)-Number(a.fallen&&!a.rebuilding)||knownFirst(a,b,'ratio')||knownFirst(a,b,'missing',true)||compareName(a,b));
  }
  function rowMarkup(row) {
    const percent=row.ratio===null?null:Math.max(0,Math.min(100,row.ratio*100));
    const recovery=row.inactive?(row.rebuilding?'復旧工事の完成時に修復':row.retreating?'撤収の結果を詳細で確認':row.fallen?'自動修復の対象外':'建設完了後に稼働'):
      row.recovery===null?'回復見込みは不明':row.recoveryMode==='free'?`次の月替わり時点 ＋${num(row.recovery)}（資材不要）`:`次の月替わり ＋${num(row.recovery)}`;
    return `<li class="defense-ledger-card" data-stable-key="${esc(row.key)}" data-defense-row="${esc(row.key)}" data-state="${row.status}">
      <header><div class="defense-ledger-card-labels"><span>${KINDS[row.kind]}</span>${row.home?'<span class="is-home">本拠</span>':''}${row.shared?'<span>共同拠点</span>':''}</div><span class="defense-ledger-state">${row.label}</span></header>
      <h3>${esc(row.name)}</h3><p class="defense-ledger-location">${esc(row.province)}${row.province?'国 · ':''}城郭・拠点 Lv.${num(row.level)}</p>
      <div class="defense-ledger-durability"><span>現在の耐久</span><strong>${num(row.current)}<small> / ${num(row.max)}</small></strong></div>
      ${percent===null?`<p class="defense-ledger-unknown">${row.max===0?'建設が完了すると耐久が備わります。':'耐久の情報を確認できません。'}</p>`:`<div class="defense-ledger-meter" role="meter" aria-label="${esc(row.name)}の耐久" aria-valuemin="0" aria-valuemax="${Math.max(1,row.max)}" aria-valuenow="${row.current}"><i style="width:${percent.toFixed(2)}%"></i></div>`}
      <dl class="defense-ledger-base-stats"><div><dt>${row.kind==='branch'?'配置兵':'守備兵'}</dt><dd>${num(row.troops)}<small>人</small></dd></div><div><dt>${row.kind==='branch'?'基準の支拠点防衛力':'対CPU防衛力'}</dt><dd>${row.inactive?'稼働対象外':num(row.defense)}</dd></div><div><dt>不足している耐久</dt><dd>${num(row.missing)}</dd></div></dl>
      <div class="defense-ledger-repair"><b>${recovery}</b>${row.unfilled>0?`<p>資材の制約で、今回の修復予定から${num(row.unfilled)}が未充足です。</p>`:''}${!row.inactive&&row.recoveryMode==='paid'&&row.requested!==null?`<small>今回の修復予定 ${num(row.requested)} · 配分後 ${num(row.recovery)}</small>`:''}${!row.inactive&&row.recoveryMode==='paid'&&row.currentRecovery!==null?`<small>現在の所持材料だけなら ＋${num(row.currentRecovery)}</small>`:''}</div>
      <button type="button" class="button defense-ledger-base-button" data-defense-open="${esc(row.key)}">${row.actionLabel}</button></li>`;
  }
  function summaryMarkup(model) {
    const s=model.summary;
    const stats=[['管理する拠点',s.bases,'城 '+s.castles+'・支拠点 '+s.branches],['確認できた損傷拠点',s.damaged,s.unknown?'状況不明 '+s.unknown+'拠点':'復旧待ち '+s.rebuild+'拠点'],['次月の資材不足',s.shortage,s.unfilled===null?'次月の見込みは確認できません':'修復予定のうち '+num(s.unfilled)+'が未充足'],['次月の有料修復',s.recovery,'資材を使う拠点の回復見込み']];
    return `<div class="defense-ledger-summary">${stats.map(([label,value,note])=>`<div><span>${label}</span><strong>${num(value)}</strong><small>${note}</small></div>`).join('')}</div>
      <details class="defense-ledger-materials" open><summary>修復に使う木材・石材</summary><p>「次の月替わり」は、現在の生産・維持費が続いた場合の見込みです。</p><table><caption>修復予定と実際に使える資材の比較</caption><thead><tr><th scope="col">資材</th><th scope="col">現在の所持</th><th scope="col">所持分だけでの消費</th><th scope="col">次月の消費見込み</th><th scope="col">予定全量の必要額</th></tr></thead><tbody>${[['wood','木材'],['stone','石材']].map(([key,label])=>`<tr><th scope="row">${label}</th>${[['現在の所持',model.materials[key]],['所持分だけでの消費',model.current?.cost[key]],['次月の消費見込み',model.forecast?.cost[key]],['予定全量の必要額',model.forecast?.required[key]]].map(([title,value])=>`<td><span class="defense-ledger-material-label" aria-hidden="true">${title}</span><b>${num(value)}</b></td>`).join('')}</tr>`).join('')}</tbody></table><p>資材が足りないときは、各拠点の修復予定量に応じて自動で配分します。並べ替えは表示順のみを変更します。必要額は満タンまでの総額ではなく、次回1回分です。</p></details>`;
  }
  let dialog=null,session=null;
  function context(options) { return options.getContext?.() || global.SengokuSocial?.getExpansionContext?.() || {}; }
  function accessPending(options, access=context(options)) {
    return access.pending===true || access.banned===true || access.user?.isBanned===true || access.rolePending===true ||
      global.SengokuBridge?.getRoleAccess?.()?.pending===true || global.SengokuBridge?.hasStarted?.()===false;
  }
  function scope(game, options) {
    const s=game?.state||{},access=context(options),role=global.SengokuBridge?.getRoleAccess?.()||{};
    return JSON.stringify([s.walking?.campaignId||s.campaignId||'',s.clan||'',s.home||'',game?.isAdmin===true,game?.isStaff===true,
      access.playerId||access.user?.id||'',access.epoch,access.accountEpoch,access.privilegeEpoch,access.roleEpoch,
      access.pending===true,access.banned===true,access.user?.isBanned===true,access.rolePending===true,role.epoch,role.pending===true]);
  }
  function finish() {
    const previous=session;if(!previous)return;session=null;
    previous.unsubscribe?.();
    if(previous.returnFocus?.isConnected)previous.returnFocus.focus({preventScroll:true});
    previous.options.onClose?.();
  }
  function close() { if(dialog?.open)dialog.close();finish(); }
  function activeGame() {
    if(!session)return null;
    const game=session.options.getGame?.()||session.options.game;
    if(!game||scope(game,session.options)!==session.scope||accessPending(session.options)||global.SENGOKU_AT_TITLE===true){close();return null;}
    return game;
  }
  function text(selector,value) { const node=dialog?.querySelector(selector);if(node&&node.textContent!==value)node.textContent=value; }
  function renderRows(resetScroll=false) {
    if(!session||!dialog?.open||!activeGame())return;
    const rows=filter(session.model,session.filters),visible=rows.slice(0,session.limit),list=dialog.querySelector('[data-defense-list]'),scroll=dialog.querySelector('[data-defense-scroll]');
    const top=resetScroll?0:scroll.scrollTop,focused=global.document.activeElement,focusKey=list.contains(focused)?focused?.dataset?.defenseOpen:null;
    const html=visible.map(rowMarkup).join('');
    if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(list,html);else if(list.innerHTML!==html)list.innerHTML=html;
    scroll.scrollTop=top;
    if(focusKey&&global.document.activeElement!==focused){const next=Array.from(list.querySelectorAll('[data-defense-open]')).find(node=>node.dataset.defenseOpen===focusKey);(next||dialog.querySelector('[data-defense-refresh]'))?.focus({preventScroll:true});}
    text('[data-defense-count]',`${visible.length} / ${rows.length}拠点を表示（全${session.model.summary.bases}拠点）`);
    dialog.querySelector('[data-defense-empty]').hidden=rows.length>0;
    dialog.querySelector('[data-defense-more]').hidden=rows.length<=session.limit;
    dialog.querySelector('[data-defense-reset]').disabled=session.filters.kind==='all'&&session.filters.status==='all'&&!session.filters.query&&session.filters.sort==='damage';
  }
  function recompute() {
    const game=activeGame();if(!game)return false;
    const scroll=dialog.querySelector('[data-defense-scroll]'),scrollTop=scroll.scrollTop;
    const model=build(game,{catalog:session.options.catalog,clock:session.options.getClock?.(),staffReady:session.options.staffReady});session.model=model;session.stale=false;
    const host=dialog.querySelector('[data-defense-summary]'),details=host.querySelector('details'),wasOpen=details?.open;
    const html=summaryMarkup(model);
    if(global.SengokuStableDOM?.patch)global.SengokuStableDOM.patch(host,html);else host.innerHTML=html;
    if(wasOpen!==undefined)host.querySelector('details').open=wasOpen;
    text('[data-defense-clock]',model.clockLabel);text('[data-defense-note]',model.note);
    dialog.querySelector('[data-defense-note]').hidden=!model.note;
    text('[data-defense-update]','計算時点の状況です。進行後は再計算できます。');
    renderRows();scroll.scrollTop=scrollTop;return true;
  }
  function invalidate() {
    if(!session||!dialog?.open||!activeGame())return false;
    // This is intentionally O(1). Resource ticks and auto-save notifications
    // never trigger another quote or replace a search field under the user.
    if(!session.stale){session.stale=true;text('[data-defense-update]','領国の状況が変わりました。再計算で現在の見込みを確認できます。');}
    return true;
  }
  function ensureDialog() {
    if(dialog)return dialog;
    const document=global.document;if(!document?.createElement)return null;
    const node=document.createElement('dialog');if(typeof node.showModal!=='function')return null;
    node.className='defense-ledger';node.setAttribute('aria-labelledby','defense-ledger-title');node.setAttribute('aria-describedby','defense-ledger-description');
    node.innerHTML=`<header class="defense-ledger-header"><div><span>領国を守る</span><h2 id="defense-ledger-title">修復・守備台帳</h2><p id="defense-ledger-description">城と支拠点の損傷、守り、次の月替わりの修復をまとめて確認。</p></div><button type="button" class="button" data-defense-close>閉じる</button></header>
      <div class="defense-ledger-scroll" data-defense-scroll><section data-defense-summary aria-label="修復の見込み"></section><p class="defense-ledger-note" data-defense-note hidden></p>
      <section class="defense-ledger-tools" aria-label="拠点を探す"><div class="defense-ledger-update"><div><p data-defense-clock></p><p data-defense-update role="status"></p></div><button type="button" class="button gold" data-defense-refresh>最新の状況で再計算</button></div>
      <div class="defense-ledger-search"><label for="defense-site-query">城名・国・領主を検索</label><input id="defense-site-query" type="search" class="input" data-defense-query maxlength="100" autocomplete="off" placeholder="例：清洲、京都、本拠"><button type="button" class="button small" data-defense-input-list aria-label="自領の拠点一覧から選ぶ">一覧</button></div><div class="defense-ledger-selects">${[['kind','拠点の種類',KINDS],['status','状態',STATUSES],['sort','表示順',SORTS]].map(([key,label,values])=>`<label><span>${label}</span><select class="select" data-defense-filter="${key}">${Object.entries(values).map(([value,name])=>`<option value="${value}">${name}</option>`).join('')}</select></label>`).join('')}</div><div class="defense-ledger-results"><p data-defense-count role="status" aria-live="polite"></p><button type="button" class="text-link" data-defense-reset>条件をリセット</button></div></section>
      <ul class="defense-ledger-list" data-defense-list></ul><div class="defense-ledger-empty" data-defense-empty hidden><strong>条件に合う拠点はありません</strong><p>城名や絞り込み条件を変えて確認できます。</p></div><button type="button" class="button defense-ledger-more" data-defense-more hidden>さらに24拠点を表示</button>
      <footer class="defense-ledger-footer"><p>今の領国で管理する拠点の一覧です。城の対CPU防衛力には本隊からの加勢が含まれます。支拠点の基準防衛力は通常戦法・攻撃側の破城技術なしの値です。共通フィールドの対人戦力とは条件が異なります。</p><p>普請の完成、追加の支出、合戦による損傷で見込みは変わります。陥落した支拠点には復旧工事が必要です。京都御所の城郭は共同普請で育てます。</p></footer></div>`;
    node.addEventListener('cancel',event=>{event.preventDefault();close();});
    // Let native cancellation close this layer without clearing the base
    // detail dialog's refresh context in the app's document Escape handler.
    node.addEventListener('keydown',event=>{if(event.key==='Escape')event.stopPropagation?.();});
    node.addEventListener('close',()=>{if(!node.open)finish();});
    node.addEventListener('compositionstart',event=>{if(session&&event.target.matches?.('[data-defense-query]'))session.composing=true;});
    node.addEventListener('compositionend',event=>{if(session&&event.target.matches?.('[data-defense-query]')){session.composing=false;session.filters.query=event.target.value.slice(0,100);session.limit=PAGE_SIZE;renderRows();}});
    node.addEventListener('input',event=>{if(!session||!event.target.matches?.('[data-defense-query]'))return;session.filters.query=event.target.value.slice(0,100);if(!session.composing&&!event.isComposing){session.limit=PAGE_SIZE;renderRows();}});
    node.addEventListener('change',event=>{if(!session||!event.target.matches?.('[data-defense-filter]'))return;session.filters=normalizedFilters({...session.filters,[event.target.dataset.defenseFilter]:event.target.value});session.limit=PAGE_SIZE;renderRows();});
    node.addEventListener('click',event=>{
      if(event.target===node&&event.detail>0&&(event.button??0)===0){
        const rect=node.getBoundingClientRect();
        if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom){close();return;}
      }
      const button=event.target.closest?.('[data-defense-close],[data-defense-refresh],[data-defense-reset],[data-defense-more],[data-defense-open],[data-defense-input-list]');
      if(!button||button.disabled||!session)return;
      if(button.hasAttribute('data-defense-close'))return close();
      if(button.hasAttribute('data-defense-refresh'))return recompute();
      if(button.hasAttribute('data-defense-more')){session.limit+=PAGE_SIZE;renderRows();return;}
      if(button.hasAttribute('data-defense-reset')){session.filters=normalizedFilters();session.limit=PAGE_SIZE;node.querySelector('[data-defense-query]').value='';for(const field of node.querySelectorAll('[data-defense-filter]'))field.value=session.filters[field.dataset.defenseFilter];renderRows();return;}
      const game=activeGame();if(!game)return;
      if(button.hasAttribute('data-defense-input-list')){
        if(session.stale&&!recompute())return;
        const owner=session,input=node.querySelector('[data-defense-query]');
        const options=filter(session.model,{...session.filters,query:''}).map(row=>({
          value:row.name,label:row.name,detail:[row.province,KINDS[row.kind],row.label].filter(Boolean).join('・'),keywords:row.owner
        }));
        global.SengokuInputList?.open({trigger:button,title:'自領の拠点一覧',options,
          emptyText:'この条件に合う自領の拠点がありません。',valid:()=>session===owner&&node.open&&Boolean(activeGame()),
          onSelect(option){input.value=option.value;input.dispatchEvent(new Event('input',{bubbles:true}));}});
        return;
      }
      const row=session.model.rows.find(row=>row.key===button.dataset.defenseOpen);
      if(!row)return;
      // A snapshot may outlive a conquest. Recheck the existing ownership guard
      // before following its route; never send a mutation from the ledger.
      if(!owned(game,row.parentCastleId,session.options.catalog||game.data||global.SENGOKU_DATA||{}))return recompute();
      if(row.kind==='branch'&&safeRead(()=>game.branch?.(row.id))?.parentCastleId!==row.parentCastleId)return recompute();
      const options=session.options,destination={kind:row.kind,id:row.id,parentCastleId:row.parentCastleId};
      close();options.openBase?.(destination);
    });
    document.body.appendChild(node);dialog=node;return node;
  }
  function open(options = {}) {
    const game=options.getGame?.()||options.game,access=context(options);
    if(!game?.state||global.SENGOKU_AT_TITLE===true||accessPending(options,access))return false;
    const node=ensureDialog();if(!node)return false;
    if(session)close();
    session={options,scope:scope(game,options),returnFocus:global.document.activeElement,filters:normalizedFilters(options.filters),limit:PAGE_SIZE,composing:false,stale:false,model:null,unsubscribe:null};
    node.querySelector('[data-defense-query]').value=session.filters.query;
    for(const field of node.querySelectorAll('[data-defense-filter]'))field.value=session.filters[field.dataset.defenseFilter];
    node.showModal();node.querySelector('[data-defense-scroll]').scrollTop=0;
    if(!recompute())return false;
    const currentSession=session;
    if(typeof options.subscribe==='function') {
      let subscribed=false;
      const unsubscribe=options.subscribe(()=>{if(session===currentSession){if(subscribed)invalidate();else activeGame();}});
      subscribed=true;
      if(session===currentSession)currentSession.unsubscribe=unsubscribe;
      else unsubscribe?.();
    }
    if(session!==currentSession)return false;
    node.querySelector('[data-defense-close]').focus({preventScroll:true});return true;
  }
  function destroy() {close();dialog?.remove();dialog=null;}
  const api={build,filter,open,close,invalidate,refreshAccess:()=>Boolean(activeGame()),destroy};
  global.SengokuDefenseLedger=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
