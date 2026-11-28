/* The canonical Kyoto holding is shared; personal campaign ownership is unchanged. */
(function (global) {
  'use strict';
  const ASSETS = { gold: '金銭', rice: '兵糧', wood: '木材', stone: '石材' };
  const DENIED = new Set(['COURT_ESTATE_REQUIRED', 'COURT_ESTATE_ACCESS_CHANGED']);
  const DEFINITIVE = new Set(['INVALID_INPUT', 'REQUEST_ID_REUSED', 'COURT_ESTATE_REQUIRED', 'COURT_ESTATE_ACCESS_CHANGED', 'STAFF_BASE_CHANGED', 'BUILDING_MAX', 'STAFF_BUILDING_BUSY', 'STAFF_BUILDING_SLOTS', 'BUILDING_LOCKED', 'COMMAND_REQUIRED', 'INSUFFICIENT_ASSETS', 'WORLD_PAUSED', 'CLOCK_STALE']);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const integer = (v, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= min && v <= max;
  const text = (v, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
  const assets = value => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => Object.hasOwn(ASSETS, k)) && Object.keys(ASSETS).every(k => integer(value[k], 0, 100000000)) ? Object.fromEntries(Object.keys(ASSETS).map(k => [k, value[k]])) : null;
  function cleanEffects(value) {
    if (!value || typeof value.active !== 'boolean' || value.castleId !== 'kyoto_gosho' || !integer(value.castleLevel, value.active ? 1 : 0, 128) || !integer(value.holdingCount, 0, 1) || value.holdingCount !== (value.active ? 1 : 0) || !assets(value.baseIncome) || !integer(value.baseTroopCapacity, 0, 100000000) || !assets(value.facilityUpkeep)) return null;
    return { active: value.active, castleId: 'kyoto_gosho', castleLevel: value.castleLevel, holdingCount: value.holdingCount, baseIncome: assets(value.baseIncome), baseTroopCapacity: value.baseTroopCapacity, facilityUpkeep: assets(value.facilityUpkeep) };
  }
  function cleanData(v) {
    if (!v || v.version !== 1 || v.eligible !== true || typeof v.canDevelop !== 'boolean' || !text(v.accessStamp, 1200) || !id(v.role?.id) || !text(v.role.title, 100) || v.holding?.id !== 'kyoto_gosho' || v.holding.shared !== true || v.holding.ownership !== 'shared' || v.holding.homePreserved !== true || !id(v.home?.id) || !text(v.home.name, 100) || !assets(v.resources) || !integer(v.command, 0, 100000000) || !integer(v.slots?.used) || !integer(v.slots?.max, 1, 100) || !Number.isFinite(Date.parse(v.serverNow))) return null;
    const b = v.base, effects = cleanEffects(v.effects);
    if (v.effects != null && !effects) return null;
    if (!b || !integer(b.revision) || !integer(b.castleLevel, 1, 128) || b.maxCastleLevel !== 128 || !integer(b.updatedElapsedMs) || !b.buildings || Array.isArray(b.buildings) || Object.keys(b.buildings).length > 100 || Object.entries(b.buildings).some(([k, n]) => !id(k) || !integer(n, 0, 32)) || !Array.isArray(b.jobs) || b.jobs.length > 2500 || !Array.isArray(v.actions) || v.actions.length > 101) return null;
    const jobs = b.jobs.map(j => j && id(j.jobId) && ['castle', 'building'].includes(j.kind) && id(j.id) && integer(j.targetLevel, 1, j.kind === 'castle' ? 128 : 32) && integer(j.startedElapsedMs) && integer(j.completesElapsedMs, j.startedElapsedMs) && id(j.startedBy?.id) && text(j.startedBy.name, 100) ? { jobId: j.jobId, kind: j.kind, id: j.id, targetLevel: j.targetLevel, startedElapsedMs: j.startedElapsedMs, completesElapsedMs: j.completesElapsedMs, startedBy: { id: j.startedBy.id, name: j.startedBy.name } } : null);
    const actions = v.actions.map(a => {
      if (!a || !['castle', 'building'].includes(a.kind) || !id(a.id) || !text(a.name, 100) || !integer(a.level, a.kind === 'castle' ? 1 : 0, a.kind === 'castle' ? 128 : 32) || a.maxLevel !== (a.kind === 'castle' ? 128 : 32) || a.kind === 'castle' && a.id !== 'kyoto_gosho' || a.kind === 'building' && !Object.hasOwn(b.buildings, a.id) || a.targetLevel != null && !integer(a.targetLevel, a.level + 1, a.maxLevel) || a.cost != null && !assets(a.cost) || !integer(a.seconds, 0, 31536000) || typeof a.queued !== 'boolean' || typeof a.enabled !== 'boolean' || a.reason != null && typeof a.reason !== 'string' || a.code != null && typeof a.code !== 'string' || a.enabled && (a.targetLevel == null || !assets(a.cost))) return null;
      return { kind: a.kind, id: a.id, name: a.name, category: typeof a.category === 'string' ? a.category.slice(0, 100) : '', level: a.level, maxLevel: a.maxLevel, targetLevel: a.targetLevel ?? null, cost: a.cost == null ? null : assets(a.cost), seconds: a.seconds, queued: a.queued, enabled: a.enabled, reason: (a.reason || '').slice(0, 500), code: (a.code || '').slice(0, 120) };
    });
    if (jobs.some(j => !j) || actions.some(a => !a) || new Set(jobs.map(j => j.jobId)).size !== jobs.length || new Set(actions.map(a => a.kind + ':' + a.id)).size !== actions.length || actions.filter(a => a.kind === 'castle').length !== 1 || actions.filter(a => a.kind === 'building').length !== Object.keys(b.buildings).length) return null;
    return { version: 1, eligible: true, canDevelop: v.canDevelop, accessStamp: v.accessStamp, role: { id: v.role.id, title: v.role.title, jurisdiction: v.role.jurisdiction === 'external' ? 'external' : null }, holding: { id: 'kyoto_gosho', name: '京都御所', shared: true, ownership: 'shared', homePreserved: true }, home: { id: v.home.id, name: v.home.name }, base: { revision: b.revision, castleLevel: b.castleLevel, maxCastleLevel: 128, buildings: clone(b.buildings), jobs, updatedElapsedMs: b.updatedElapsedMs }, resources: assets(v.resources), command: v.command, slots: { used: v.slots.used, max: v.slots.max }, effects, actions, serverNow: v.serverNow };
  }
  function cleanClock(v) { return v && integer(Math.floor(v.elapsedMs)) && typeof v.running === 'boolean' && Number.isFinite(v.speed) && v.speed > 0 && v.speed <= 10000 ? { elapsedMs: v.elapsedMs, running: v.running, speed: v.speed } : null; }
  const key = owner => 'sengoku-court-estate-pending-v1:' + encodeURIComponent(owner);
  const cleanPending = v => v && id(v.requestId) && ['castle', 'building'].includes(v.kind) && id(v.id) && integer(v.baseRevision) && text(v.accessStamp, 1200) ? { requestId: v.requestId, kind: v.kind, id: v.id, baseRevision: v.baseRevision, accessStamp: v.accessStamp } : null;
  const now = () => global.performance?.now?.() ?? Date.now();
  const context = () => global.SengokuBridge?.getExpansionAccess?.() || global.SengokuSocial?.getExpansionContext?.() || {};
  const stampOf = c => JSON.stringify([c.playerId || '', c.epoch ?? null, c.accountEpoch ?? null, c.privilegeEpoch ?? null, Boolean(c.user), Boolean(c.pending), Boolean(c.banned), Boolean(c.user?.isBanned)]);
  const allowed = c => id(c.playerId) && c.user?.id === c.playerId && !c.pending && !c.banned && !c.user.isBanned;
  const writable = c => allowed(c) && c.writable !== false && c.gameWritable !== false && c.connected !== false;
  let dialog = null, focus = null, data = null, clock = null, busy = false, pending = null, confirmation = null, identityKey = '', owner = '', generation = 0, receivedAt = 0, lastAttempt = -Infinity, timer = null, error = '', message = '', tab = 'castle', filter = '', accessHint = null;
  function readPending(actor) { try { return cleanPending(JSON.parse(global.localStorage?.getItem(key(actor)) || 'null')); } catch (_) { return null; } }
  function notify() { global.SengokuBridge?.refreshCourtEstateSurfaces?.(); }
  function identity() {
    const c = context(), stamp = stampOf(c);
    if (stamp !== identityKey) { identityKey = stamp; owner = c.playerId || ''; generation++; data = null; clock = null; busy = false; confirmation = null; accessHint = null; lastAttempt = -Infinity; pending = allowed(c) ? readPending(owner) : null; error = ''; message = ''; tab = 'castle'; filter = ''; close(); }
    return c;
  }
  const current = (stamp, gen) => { const c = identity(); return allowed(c) && identityKey === stamp && generation === gen; };
  const elapsed = () => clock ? clock.elapsedMs + Math.max(0, now() - receivedAt) * (clock.running ? clock.speed : 0) : 0;
  const fresh = () => data && now() - receivedAt <= 45000;
  function clearPending(record) { if (readPending(owner)?.requestId === record.requestId) try { global.localStorage.removeItem(key(owner)); } catch (_) {} pending = null; }
  function adopt(view, time) { if (data?.accessStamp !== view.accessStamp || data?.base.revision !== view.base.revision) confirmation = null; data = view; clock = time; receivedAt = now(); accessHint = true; notify(); }
  function revoke() { data = null; clock = null; confirmation = null; accessHint = false; notify(); }
  function updateAccess(value) { identity(); if (value === false) { generation++; busy = false; lastAttempt = now(); revoke(); render(); } else if (value === true) { const changed = accessHint !== true; accessHint = true; if (changed) { lastAttempt = -Infinity; notify(); } } }
  function holding() { identity(); return fresh() && data.canDevelop ? clone({ ...data.holding, castleLevel: data.base.castleLevel, buildings: data.base.buildings, home: data.home, role: data.role, revision: data.base.revision, jobs: data.base.jobs.length, effects: data.effects }) : null; }
  const canAct = () => writable(context()) && fresh() && data.canDevelop && !busy && !pending;
  const findAction = (kind, target) => data?.actions.find(a => a.kind === kind && a.id === target);
  const amount = v => Number(v).toLocaleString('ja-JP');
  const costText = v => Object.entries(ASSETS).filter(([k]) => v?.[k] > 0).map(([k, name]) => name + ' ' + amount(v[k])).join('・') || '資源の消費なし';
  const duration = seconds => { const n = Math.max(0, Math.ceil(seconds)); return n >= 3600 ? Math.floor(n / 3600) + '時間 ' + Math.ceil(n % 3600 / 60) + '分' : n >= 60 ? Math.floor(n / 60) + '分 ' + n % 60 + '秒' : n + '秒'; };
  const costMarkup = v => `<dl class="estate-cost">${Object.entries(ASSETS).filter(([k]) => v?.[k] > 0).map(([k, name]) => `<div${data.resources[k] < v[k] ? ' class="is-short"' : ''}><dt>${name}</dt><dd>${amount(v[k])}</dd></div>`).join('')}</dl>`;
  function effectsMarkup() {
    const effects = data?.effects; if (!effects?.active) return '';
    return `<section class="estate-effects" aria-labelledby="estate-effects-title"><h3 id="estate-effects-title">一般拠点と同じ領地効果</h3><p>京都御所1城分の収入・兵数上限・維持費を、あなたの領地に加算します。</p><h4>城郭の基礎収入 / 月</h4><dl>${Object.entries(ASSETS).map(([k, name]) => `<div><dt>${name}</dt><dd>+${amount(effects.baseIncome[k])}</dd></div>`).join('')}</dl><p class="estate-effects-note">表示は勢力・技術・位階の補正前です。実際の収支は城下町の財政に反映されます。</p><p>兵数上限の基礎加算 <b>+${amount(effects.baseTroopCapacity)}人</b></p><p>拠点維持費 / 月：${esc(costText(effects.facilityUpkeep))}</p><p class="estate-effects-note">領有城数による強化費用の倍率にも1城として数えます。京都御所の施設効果は、本拠の施設へ重複して加算しません。</p></section>`;
  }
  function actionCard(a) {
    const chain = data.base.jobs.filter(j => j.kind === a.kind && j.id === a.id);
    return `<article class="estate-card"><div class="estate-card-heading"><h3>${esc(a.name)}</h3><b>Lv.${a.level}<small> / ${a.maxLevel}</small></b></div>${a.kind === 'castle' ? `<div class="estate-palace-art">${global.SengokuArt?.castle?.('kyoto_gosho', 'estate-castle-art', Math.max(a.level, data.base.buildings.keep || 1)) || '<span aria-hidden="true">御所</span>'}</div><p>役職者と京都御所のメンバーが同じ城郭を育てます。</p>` : ''}${chain.length ? `<p class="estate-chain">Lv.${chain.at(-1).targetLevel}まで手配済み・${chain.length}段階</p>` : ''}${a.targetLevel != null ? `<p class="estate-next">${a.queued ? '次の増築を予約' : '次の強化'}：Lv.${a.targetLevel}</p>${costMarkup(a.cost)}<p class="estate-time">指令 1回・普請 ${esc(duration(a.seconds))}</p>` : '<p class="estate-complete">最高レベルまで手配済みです。</p>'}${a.reason ? `<p class="estate-reason">${esc(a.reason)}</p>` : ''}<button class="button ${a.enabled ? 'gold' : ''}" data-estate="prepare" data-kind="${a.kind}" data-target="${esc(a.id)}"${!canAct() || !a.enabled ? ' disabled' : ''}>${a.targetLevel == null ? '最高段階' : a.queued ? '次の増築を予約' : '強化内容を確認'}</button></article>`;
  }
  function jobsMarkup() {
    return data.base.jobs.length ? `<ol class="estate-jobs">${data.base.jobs.map(j => { const a = findAction(j.kind, j.id), queued = j.startedElapsedMs > elapsed(), fraction = Math.min(100, Math.max(0, (elapsed() - j.startedElapsedMs) * 100 / Math.max(1, j.completesElapsedMs - j.startedElapsedMs))); return `<li><div><strong>${esc(a?.name || j.id)} Lv.${j.targetLevel}</strong><span>${queued ? '予約中' : '普請中'}</span></div><progress max="100" value="${fraction}" data-estate-progress="${esc(j.jobId)}" aria-label="${esc(a?.name || j.id)}の普請進捗"></progress><p><span data-estate-countdown="${esc(j.jobId)}">${elapsed() >= j.completesElapsedMs ? '完成を確認しています' : '完成まで ' + duration((j.completesElapsedMs - elapsed()) / 1000)}</span>・${esc(j.startedBy.name)}の普請</p></li>`; }).join('')}</ol>` : '<div class="estate-empty"><h3>進行中の共同普請はありません</h3><p>城郭や施設の強化を始めると、ここに完成までの進捗が表示されます。</p></div>';
  }
  function confirmationMarkup() {
    if (!confirmation) return '';
    const a = confirmation.action;
    return `<section class="estate-confirm" aria-labelledby="estate-confirm-title"><h3 id="estate-confirm-title" tabindex="-1">${esc(a.name)}をLv.${a.targetLevel}へ${a.queued ? '増築予約' : '強化'}しますか？</h3><p>あなたの資源と指令1回を使います。</p>${costMarkup(a.cost)}<p>普請時間：${esc(duration(a.seconds))}。${a.queued ? '前の段階が完成してから順に進みます。' : '完成後に全員の京都御所へ反映されます。'}</p><div class="estate-confirm-actions"><button class="button" data-estate="cancel"${busy ? ' disabled' : ''}>戻る</button><button class="button gold" data-estate="confirm"${!canAct() ? ' disabled' : ''}>資源を使って共同普請</button></div></section>`;
  }
  function render() {
    if (!dialog) return;
    const c = context(), body = dialog.querySelector('.estate-content'), scroll = body.scrollTop, active = global.document.activeElement, focusAction = body.contains(active) ? active?.getAttribute?.('data-estate') : null, focusTarget = focusAction ? active.getAttribute('data-target') : null, focusTab = focusAction ? active.getAttribute('data-tab') : null;
    let html = `<p class="estate-status ${error ? 'is-error' : ''}" role="${error ? 'alert' : 'status'}">${esc(error || message)}</p>`;
    if (pending) html += `<section class="estate-pending"><p>前の共同普請の結果を確認してください。同じ受付番号で再確認します。</p><button class="button gold" data-estate="retry"${busy || !writable(c) ? ' disabled' : ''}>前の普請の結果を確認</button></section>`;
    if (!data) html += `<div class="estate-empty"><h3>${busy ? '共同領地を確認しています' : accessHint === false ? '京都御所の役職を確認してください' : '京都御所の共同領地'}</h3><p>${accessHint === false ? '現在の役職では共同普請を利用できません。一般の拠点と領土は引き続き利用できます。' : '摂政・任命太政官などの役職者は、本拠を維持しながら京都御所を共同で育てられます。'}</p></div>`;
    else {
      html += `<section class="estate-holdings" aria-label="あなたの領土"><article><small>${data.home.id === 'kyoto_gosho' ? 'あなたの本拠・共同領地' : 'あなたの本拠'}</small><h3>${esc(data.home.name)}</h3><p>現在の本拠を維持</p></article>${data.home.id !== 'kyoto_gosho' ? `<article class="is-shared"><small>役職による共同領地</small><h3>京都御所</h3><p>${esc(data.role.title)}として共同普請</p></article>` : ''}</section><p class="estate-intro">京都御所をあなたの共同領地として管理します。城郭・施設の成長と工事は全役職者で共有します。</p><div class="estate-summary"><span>城郭 <b>Lv.${data.base.castleLevel} / 128</b></span><span>共同普請枠 <b>${data.slots.used} / ${data.slots.max}</b></span><span>あなたの指令 <b>${data.command}回</b></span></div><details class="estate-balances"><summary>あなたの所持資源</summary><div>${Object.entries(ASSETS).map(([k, name]) => `<span>${name} <b>${amount(data.resources[k])}</b></span>`).join('')}</div></details>`;
      if (!writable(c)) html += `<p class="estate-readonly">${esc(c.reason || 'この端末の操作権と保存の同期が整うと共同普請できます。')}</p>`;
      html += confirmationMarkup() + `<nav class="estate-tabs" aria-label="共同領地の項目">${[['castle', '城郭'], ['facilities', '施設'], ['jobs', '普請状況']].map(([k, label]) => `<button class="button" data-estate="tab" data-tab="${k}" aria-pressed="${tab === k}">${label}${k === 'jobs' ? ' ' + data.base.jobs.length : ''}</button>`).join('')}</nav>`;
      if (tab === 'jobs') html += jobsMarkup();
      else if (tab === 'castle') html += `<div class="estate-castle-grid">${actionCard(data.actions.find(a => a.kind === 'castle'))}<div>${effectsMarkup()}<section class="estate-guidance"><h3>本拠と京都御所を共に育てる</h3><p>本拠の城下町はこれまでどおり育成できます。京都御所ではこの画面から城郭と施設を強化します。</p><p>城郭はLv.128、施設はLv.32まで。費用を支払った領主の工事として、共同普請の進捗を共有します。</p><p>役職を離れると共同領地の利用権が終了します。完成した強化と手配済みの普請は京都御所に残ります。</p></section></div></div>`;
      else {
        const categories = [...new Set(data.actions.filter(a => a.kind === 'building').map(a => a.category).filter(Boolean))], items = data.actions.filter(a => a.kind === 'building' && (!filter || a.category === filter));
        html += `<div class="estate-filters" aria-label="施設の分類"><button class="button small" data-estate="filter" data-filter="" aria-pressed="${!filter}">すべて ${data.actions.filter(a => a.kind === 'building').length}</button>${categories.map(k => `<button class="button small" data-estate="filter" data-filter="${esc(k)}" aria-pressed="${filter === k}">${esc(global.SENGOKU_DATA?.categories?.[k] || k)}</button>`).join('')}</div><div class="estate-grid">${items.map(actionCard).join('')}</div>`;
      }
    }
    body.innerHTML = html; body.scrollTop = scroll;
    if (focusAction) { const target = [...body.querySelectorAll('[data-estate]')].find(node => node.getAttribute('data-estate') === focusAction && node.getAttribute('data-target') === focusTarget && node.getAttribute('data-tab') === focusTab); target?.focus?.({ preventScroll: true }); }
    dialog.querySelector('[data-estate="reload"]').disabled = busy;
  }
  async function request(route, options) { if (global.SengokuBridge?.requestExpansion) return global.SengokuBridge.requestExpansion(route, options); if (options.method === 'POST') throw Error('本拠と端末の同期を確認してください。'); return global.SengokuSocial.expansionRequest(route, options); }
  async function load({ silent = false } = {}) {
    const c = identity(); if (!allowed(c) || busy) return false;
    const stamp = identityKey, gen = generation; busy = true; lastAttempt = now(); if (!silent) error = ''; render();
    try {
      if (!silent && writable(c)) await global.SengokuCloudSync?.flush?.();
      if (!current(stamp, gen)) return false;
      const result = await request('/court/estate', { method: 'GET' });
      if (!current(stamp, gen)) return false;
      const view = result?.ok === true ? cleanData(result.courtEstate) : null, time = cleanClock(result.clock);
      if (!view || !time) throw Error('京都御所の強化情報を確認できませんでした。最新情報を取得してください。');
      adopt(view, time); if (!silent) confirmation = null; return true;
    } catch (e) { if (current(stamp, gen)) { if (DENIED.has(e.code) || Number(e.status) === 403) revoke(); if (!silent || dialog) error = e.message || '共同領地を読み込めませんでした。'; } return false; }
    finally { if (current(stamp, gen)) { busy = false; render(); } }
  }
  function ensure() { const c = identity(); if (allowed(c) && !busy && now() - lastAttempt >= 30000) void load({ silent: true }); }
  function prepare(kind, target) {
    identity(); const a = findAction(kind, target); if (!canAct() || !a?.enabled) return false;
    confirmation = { action: clone(a), baseRevision: data.base.revision, accessStamp: data.accessStamp }; error = ''; message = ''; render();
    const title = dialog?.querySelector('#estate-confirm-title'); title?.focus?.({ preventScroll: true }); title?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' }); return true;
  }
  function validReceipt(r, record, result) {
    const effectiveId = result.effectiveRequestId == null ? record.requestId : result.effectiveRequestId;
    return r && id(effectiveId) && r.requestId === effectiveId && id(r.jobId) && r.kind === record.kind && r.id === record.id && integer(r.targetLevel, 1, r.kind === 'castle' ? 128 : 32) && assets(r.cost) && integer(r.baseRevision, record.baseRevision + 1) && integer(r.playerRevision) && typeof r.queued === 'boolean' && integer(r.startedElapsedMs) && integer(r.completesElapsedMs, r.startedElapsedMs);
  }
  async function execute(retry = false) {
    const c = identity(); if (!writable(c) || busy || retry && !pending || !retry && (!confirmation || !canAct())) return false;
    const stamp = identityKey, gen = generation; error = ''; message = '';
    if (!pending) {
      const a = findAction(confirmation.action.kind, confirmation.action.id);
      if (!a?.enabled || confirmation.baseRevision !== data.base.revision || confirmation.accessStamp !== data.accessStamp) { confirmation = null; error = '役職や共同普請が更新されました。内容を確認し直してください。'; render(); return false; }
      try { const record = cleanPending({ requestId: global.crypto.randomUUID(), kind: a.kind, id: a.id, baseRevision: data.base.revision, accessStamp: data.accessStamp }); if (!record) throw Error('受付番号を作成できませんでした。'); const encoded = JSON.stringify(record); global.localStorage.setItem(key(owner), encoded); if (global.localStorage.getItem(key(owner)) !== encoded) throw Error('普請の受付情報を保存できません。端末の保存設定を確認してください。'); pending = record; } catch (e) { error = e.message; render(); return false; }
    }
    const record = clone(pending); confirmation = null; busy = true; render(); let reload = false;
    try {
      const result = await request('/court/estate/upgrade', { method: 'POST', data: record });
      if (!current(stamp, gen)) return false;
      const view = result?.ok === true ? cleanData(result.courtEstate) : null, time = cleanClock(result.clock);
      if (!view || !time || !validReceipt(result.receipt, record, result)) throw Error('共同普請の結果を確認できませんでした。同じ受付番号で結果を確認してください。');
      adopt(view, time); clearPending(record); const a = findAction(record.kind, record.id);
      message = `${a?.name || '京都御所'} Lv.${result.receipt.targetLevel}${result.idempotent ? 'への普請の受付済み記録を確認しました。' : result.receipt.queued ? 'への共同普請を予約しました。' : 'への共同普請を開始しました。'}`;
      global.SengokuBridge?.playInterfaceSound?.(result.idempotent ? 'tap' : 'build'); return true;
    } catch (e) {
      if (!current(stamp, gen)) return false;
      error = e.message || '接続を確認して、前の普請の結果を再確認してください。';
      if (DENIED.has(e.code) || Number(e.status) === 403 && e.retryable !== true) revoke();
      if (e.retryable !== true && (DEFINITIVE.has(e.code) || [400, 404].includes(Number(e.status)))) { clearPending(record); reload = true; }
      return false;
    } finally {
      if (current(stamp, gen)) { busy = false; render(); if (reload) { const previous = error; await load({ silent: true }); if (current(stamp, gen)) { error = previous; render(); } } }
    }
  }
  function tick() {
    identity(); if (!dialog) return;
    for (const j of data?.base.jobs || []) { const progress = dialog.querySelector('[data-estate-progress="' + j.jobId + '"]'), label = dialog.querySelector('[data-estate-countdown="' + j.jobId + '"]'); if (progress) progress.value = Math.min(100, Math.max(0, (elapsed() - j.startedElapsedMs) * 100 / Math.max(1, j.completesElapsedMs - j.startedElapsedMs))); if (label) label.textContent = elapsed() >= j.completesElapsedMs ? '完成を確認しています' : '完成まで ' + duration((j.completesElapsedMs - elapsed()) / 1000); }
    if (!busy && !pending && (now() - lastAttempt >= 15000 || data?.base.jobs.some(j => j.completesElapsedMs <= elapsed()) && now() - lastAttempt >= 3000)) void load({ silent: true });
  }
  function close() { if (timer != null) { global.clearInterval?.(timer); timer = null; } if (!dialog) return; const old = dialog, target = focus; dialog = null; focus = null; confirmation = null; old.close?.(); old.remove(); if (target?.isConnected) target.focus?.({ preventScroll: true }); }
  function open(options = {}) {
    const c = identity(); if (!allowed(c)) { global.SengokuBridge?.toast?.('交流で領主を登録・接続して、京都御所の役職を確認してください。', true); return Promise.resolve(false); }
    if (['castle', 'facilities', 'jobs'].includes(options.tab)) tab = options.tab;
    if (dialog) { render(); return Promise.resolve(true); }
    focus = global.document.activeElement; dialog = global.document.createElement('dialog'); dialog.className = 'estate-dialog'; dialog.setAttribute('aria-labelledby', 'estate-title');
    dialog.innerHTML = '<header class="estate-header"><div><small>本拠と共に育てる、朝廷の領地</small><h2 id="estate-title">京都御所の共同領地</h2></div><button class="button" data-estate="close" aria-label="共同領地を閉じる">閉じる</button></header><div class="estate-content"></div><footer class="estate-footer"><span>強化の完成は全員に共有</span><button class="button" data-estate="reload">最新情報を取得</button></footer>';
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.addEventListener('click', e => { const b = e.target?.closest?.('[data-estate]'); if (!b || b.disabled || !dialog?.contains(b)) return; e.preventDefault(); const action = b.getAttribute('data-estate'); if (action === 'close') close(); else if (action === 'reload') void load(); else if (action === 'tab' && ['castle', 'facilities', 'jobs'].includes(b.getAttribute('data-tab'))) { tab = b.getAttribute('data-tab'); render(); } else if (action === 'filter') { filter = b.getAttribute('data-filter') || ''; render(); } else if (action === 'prepare') prepare(b.getAttribute('data-kind'), b.getAttribute('data-target')); else if (action === 'cancel' && !busy) { confirmation = null; render(); } else if (action === 'confirm') void execute(); else if (action === 'retry') void execute(true); });
    global.document.body.appendChild(dialog); render(); dialog.showModal(); timer = global.setInterval?.(tick, 1000) ?? null; return load();
  }
  global.SengokuCourtEstate = { open, close, refresh: load, refreshAccess: () => { const old = identityKey; identity(); if (old !== identityKey) notify(); }, updateAccess, ensure, holding, prepare, confirm: () => execute(), retry: () => execute(true), cleanData, getState: () => { identity(); return { data: clone(data), clock: clone(clock), busy, owner, pending: clone(pending), hasConfirmation: Boolean(confirmation), error, message, tab }; } };
})(typeof window !== 'undefined' ? window : globalThis);
