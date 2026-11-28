/* An account-owned shogunate government. Mutations use the game's save bridge. */
(function (global) {
  'use strict';
  const ASSETS = { gold: '金銭', rice: '兵糧', wood: '木材', stone: '石材', magatama: '勾玉' };
  const GROUPS = { policy: 'policies', project: 'projects', duty: 'duties', milestone: 'milestones' };
  const TABS = [['duties', '日次政務'], ['policies', '国策'], ['projects', '公共事業'], ['milestones', '発展目標'], ['history', '政務履歴']];
  const DEFINITIVE = new Set(['SHOGUNATE_REQUIRED', 'GOVERNANCE_DAY_CHANGED', 'GOVERNANCE_CHANGED', 'GOVERNANCE_POLICY_SELECTED', 'GOVERNANCE_POLICY_LIMIT', 'GOVERNANCE_PROJECT_MAX', 'GOVERNANCE_SHORTAGE', 'GOVERNANCE_CLAIMED', 'GOVERNANCE_MILESTONE_INCOMPLETE', 'GOVERNANCE_REWARD_CAP', 'GOVERNANCE_RENOWN_CAP', 'REQUEST_ID_REUSED', 'INVALID_INPUT']);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const num = (v, min = 0, max = 1000000000) => Number.isSafeInteger(v) && v >= min && v <= max;
  const str = (v, max = 600) => typeof v === 'string' && v.length > 0 && v.length <= max;
  const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v);
  const day = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v + 'T00:00:00Z'));
  const time = v => Number.isSafeInteger(v) && v >= 0 && Number.isFinite(new Date(v).getTime());
  const reason = v => v == null || typeof v === 'string' && v.length <= 600;
  const assets = value => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !Object.hasOwn(ASSETS, k) || !num(value[k], 0, 100000000))) return null;
    return Object.fromEntries(Object.keys(ASSETS).filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
  };
  function cleanHistory(v) {
    if (!v || !id(v.id) || !Object.hasOwn(GROUPS, v.kind) || !id(v.targetId) || !str(v.name, 160) || !time(v.at) || !day(v.day) || !num(v.renownGained) || !assets(v.cost) || !assets(v.reward)) return null;
    return { id: v.id, kind: v.kind, targetId: v.targetId, name: v.name, at: v.at, day: v.day, cost: assets(v.cost), reward: assets(v.reward), renownGained: v.renownGained };
  }
  function cleanData(v) {
    if (!v || v.version !== 1 || typeof v.available !== 'boolean' || !reason(v.reason) || !time(v.serverNow) || !num(v.revision) || !day(v.calendar?.day) || !time(v.calendar?.nextResetAt) || v.calendar.resetHour !== 5 || v.calendar.timeZone !== 'Asia/Tokyo' || !id(v.policyId) || typeof v.policyChangedToday !== 'boolean' || !assets(v.resources) || !assets(v.dailyReward)) return null;
    const r = v.renown;
    if (!r || !num(r.points) || !num(r.level, 1, 5) || r.totalLevels !== 5 || !str(r.name, 100) || !num(r.levelStart) || r.points < r.levelStart || r.nextLevelAt != null && (!num(r.nextLevelAt, 1) || r.nextLevelAt <= r.levelStart)) return null;
    let government = null;
    if (v.government != null) {
      const g = v.government;
      if (!/^sg_[a-f0-9]{32}$/.test(g.id) || !str(g.name, 160) || g.rank !== '征夷大将軍' || !time(g.openedAt)) return null;
      government = { id: g.id, name: g.name, rank: g.rank, openedAt: g.openedAt };
    }
    if (v.available !== Boolean(government)) return null;
    const cleanList = (key, max, check) => {
      if (!Array.isArray(v[key]) || v[key].length > max) return null;
      const values = v[key].map(item => {
        if (!item || !id(item.id) || !str(item.name, 160) || !str(item.description) || !reason(item.reason)) return null;
        return check(item);
      });
      return values.some(item => !item) || new Set(values.map(item => item.id)).size !== values.length ? null : values;
    };
    const base = i => ({ id: i.id, name: i.name, description: i.description, reason: i.reason || null });
    const policies = cleanList('policies', 12, i => typeof i.selected === 'boolean' && typeof i.canSelect === 'boolean' && assets(i.reward) ? { ...base(i), selected: i.selected, canSelect: i.canSelect, reward: assets(i.reward) } : null);
    const projects = cleanList('projects', 12, i => num(i.level, 0, 5) && i.maxLevel === 5 && num(i.renownReward) && str(i.effect) && typeof i.canUpgrade === 'boolean' && assets(i.cost) ? { ...base(i), level: i.level, maxLevel: i.maxLevel, cost: assets(i.cost), renownReward: i.renownReward, effect: i.effect, canUpgrade: i.canUpgrade } : null);
    const duties = cleanList('duties', 12, i => num(i.renownReward) && typeof i.claimed === 'boolean' && typeof i.canComplete === 'boolean' && assets(i.cost) && assets(i.reward) ? { ...base(i), cost: assets(i.cost), reward: assets(i.reward), renownReward: i.renownReward, claimed: i.claimed, canComplete: i.canComplete } : null);
    const milestones = cleanList('milestones', 30, i => num(i.progress) && num(i.target, 1) && typeof i.eligible === 'boolean' && typeof i.claimed === 'boolean' && typeof i.canClaim === 'boolean' && assets(i.reward) ? { ...base(i), progress: i.progress, target: i.target, eligible: i.eligible, claimed: i.claimed, reward: assets(i.reward), canClaim: i.canClaim } : null);
    if (!policies || !projects || !duties || !milestones || !Array.isArray(v.history) || v.history.length > 50) return null;
    const history = v.history.map(cleanHistory);
    if (history.some(i => !i) || new Set(history.map(i => i.id)).size !== history.length) return null;
    if (v.available && (!policies.some(p => p.id === v.policyId && p.selected) || policies.filter(p => p.selected).length !== 1)) return null;
    return { version: 1, available: v.available, reason: v.reason || null, government, serverNow: v.serverNow, calendar: { day: v.calendar.day, nextResetAt: v.calendar.nextResetAt, resetHour: 5, timeZone: 'Asia/Tokyo' }, revision: v.revision, policyId: v.policyId, policyChangedToday: v.policyChangedToday, resources: assets(v.resources), renown: { points: r.points, level: r.level, name: r.name, levelStart: r.levelStart, nextLevelAt: r.nextLevelAt ?? null, totalLevels: 5 }, dailyReward: assets(v.dailyReward), policies, projects, duties, milestones, history };
  }
  const pendingKey = owner => 'sengoku-governance-pending-v1:' + encodeURIComponent(owner);
  function cleanPending(v) {
    return v && Object.hasOwn(GROUPS, v.kind) && id(v.targetId) && day(v.day) && num(v.governanceRevision) && id(v.requestId) ? { kind: v.kind, targetId: v.targetId, day: v.day, governanceRevision: v.governanceRevision, requestId: v.requestId } : null;
  }
  const now = () => global.performance?.now?.() ?? Date.now();
  const context = () => global.SengokuBridge?.getExpansionAccess?.() || global.SengokuSocial?.getExpansionContext?.() || {};
  const stampOf = c => JSON.stringify([c.playerId || '', c.epoch ?? null, c.accountEpoch ?? null, c.privilegeEpoch ?? null, Boolean(c.user), Boolean(c.pending), Boolean(c.banned), Boolean(c.user?.isBanned)]);
  const allowed = c => id(c.playerId) && c.user && c.user.id === c.playerId && !c.pending && !c.banned && !c.user.isBanned;
  const writable = c => allowed(c) && c.writable !== false && c.gameWritable !== false && c.connected !== false;
  const clockLabel = v => new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(v));
  const amountLabel = (v, empty = 'なし') => Object.entries(ASSETS).filter(([k]) => v?.[k] > 0).map(([k, name]) => name + ' ' + Number(v[k]).toLocaleString('ja-JP')).join('・') || empty;
  const assetsMarkup = (v, cls = '', empty = 'なし') => {
    const values = Object.entries(ASSETS).filter(([k]) => v?.[k] > 0);
    return values.length ? `<span class="gov-assets ${cls}">${values.map(([k, name]) => `<span class="gov-asset gov-asset-${k}"><span>${name}</span><b>${Number(v[k]).toLocaleString('ja-JP')}</b></span>`).join('')}</span>` : `<span class="gov-muted">${esc(empty)}</span>`;
  };
  let dialog = null, focus = null, data = null, busy = false, error = '', message = '', confirmation = null, pending = null, identityKey = '', ownerId = '', generation = 0, receivedAt = 0, tab = 'duties', timer = null, lastWritable = null, nextRolloverPoll = 0;
  function readPending(owner) { try { return cleanPending(JSON.parse(global.localStorage?.getItem(pendingKey(owner)) || 'null')); } catch (_) { return null; } }
  function identity() {
    const c = context(), stamp = stampOf(c);
    if (stamp !== identityKey) {
      identityKey = stamp; ownerId = String(c.playerId || ''); generation++; data = null; busy = false; error = ''; message = ''; confirmation = null; tab = 'duties'; nextRolloverPoll = 0; pending = allowed(c) ? readPending(ownerId) : null;
      if (dialog) close();
    }
    return c;
  }
  const isCurrent = (stamp, gen) => { const c = identity(); return allowed(c) && stamp === identityKey && gen === generation; };
  const serverTime = () => data ? data.serverNow + Math.max(0, now() - receivedAt) : null;
  const expired = () => data && serverTime() >= data.calendar.nextResetAt;
  const entryFor = (kind, targetId) => data?.[GROUPS[kind]]?.find(i => i.id === targetId);
  const eligible = (kind, item) => Boolean(item && ({ policy: item.canSelect, project: item.canUpgrade, duty: item.canComplete, milestone: item.canClaim })[kind]);
  function adopt(view) { data = view; receivedAt = now(); }
  function clearPending(record) {
    const stored = readPending(ownerId);
    if (stored?.requestId === record.requestId) try { global.localStorage.removeItem(pendingKey(ownerId)); } catch (_) {}
    pending = null;
  }
  function canAct() { return writable(context()) && data?.available && !busy && !pending && !expired(); }
  function button(kind, item, label) {
    return `<button class="button ${eligible(kind, item) ? 'gold' : ''}" data-gov="prepare" data-kind="${kind}" data-target="${esc(item.id)}" ${!canAct() || !eligible(kind, item) ? 'disabled' : ''}>${esc(label)}</button>`;
  }
  function cardFooter(kind, item, label) {
    return `<div class="gov-card-footer">${item.reason ? `<p class="gov-muted">${esc(item.reason)}</p>` : ''}${button(kind, item, label)}</div>`;
  }
  function tabContent() {
    if (tab === 'policies') return `<p class="gov-intro">幕府の方針を一つ選びます。国策の変更は日本時間の朝5時から翌朝5時までに1回。選んだ方針は日次政務の褒賞配分に反映されます。</p><div class="gov-grid">${data.policies.map(i => `<article class="gov-card ${i.selected ? 'is-selected' : ''}"><div class="gov-card-title"><h3>${esc(i.name)}</h3>${i.selected ? '<span class="gov-badge">施行中</span>' : ''}</div><p>${esc(i.description)}</p><div class="gov-values"><small>この国策での日次政務褒賞</small>${assetsMarkup(i.reward)}</div>${cardFooter('policy', i, i.selected ? '施行中' : '国策を選ぶ')}</article>`).join('')}</div>`;
    if (tab === 'projects') return `<p class="gov-intro">資源を使って三つの公共事業を育てます。事業はそれぞれLv.5まで発展し、日次政務の褒賞と幕府の威信が増えます。</p><div class="gov-grid gov-grid-three">${data.projects.map(i => `<article class="gov-card"><div class="gov-card-title"><h3>${esc(i.name)}</h3><span class="gov-badge">Lv.${i.level} / ${i.maxLevel}</span></div><div class="gov-level-track" aria-label="${esc(i.name)} レベル${i.level}、最大${i.maxLevel}">${Array.from({ length: i.maxLevel }, (_, n) => `<span class="${n < i.level ? 'is-filled' : ''}"></span>`).join('')}</div><p>${esc(i.description)}</p><p class="gov-effect">${esc(i.effect)}</p>${i.level < i.maxLevel ? `<div class="gov-values"><small>Lv.${i.level + 1}への費用</small>${assetsMarkup(i.cost)}<span class="gov-renown-reward">威信 +${i.renownReward}</span></div>` : '<p class="gov-effect">この事業は最大レベルです。</p>'}${cardFooter('project', i, i.level >= i.maxLevel ? '発展完了' : '発展させる')}</article>`).join('')}</div>`;
    if (tab === 'milestones') return `<p class="gov-intro">事業や威信の発展に応じた、一度限りの褒賞です。達成条件と受取状況は幕府名が変わっても引き継ぎます。</p><div class="gov-grid">${data.milestones.map(i => `<article class="gov-card ${i.claimed ? 'is-complete' : ''}"><div class="gov-card-title"><h3>${esc(i.name)}</h3>${i.claimed ? '<span class="gov-badge">受取済み</span>' : ''}</div><p>${esc(i.description)}</p><div class="gov-goal-progress"><span>${Math.min(i.progress, i.target).toLocaleString('ja-JP')} / ${i.target.toLocaleString('ja-JP')}</span><progress value="${Math.min(i.progress, i.target)}" max="${i.target}" aria-label="${esc(i.name)}の達成状況"></progress></div><div class="gov-values"><small>達成褒賞</small>${assetsMarkup(i.reward)}</div>${cardFooter('milestone', i, i.claimed ? '受取済み' : i.eligible ? '褒賞を受け取る' : '達成を目指す')}</article>`).join('')}</div>`;
    if (tab === 'history') return `<p class="gov-intro">最近の政務と、実際に増減した資源・威信を確認できます。</p>${data.history.length ? `<ol class="gov-history">${data.history.map(i => `<li><div><strong>${esc(i.name)}</strong><time datetime="${new Date(i.at).toISOString()}">${esc(clockLabel(i.at))}（日本時間）</time></div>${Object.values(i.cost).some(Boolean) ? `<p>費用：${esc(amountLabel(i.cost))}</p>` : ''}${Object.values(i.reward).some(Boolean) ? `<p>受取：${esc(amountLabel(i.reward))}</p>` : ''}${i.renownGained ? `<p class="gov-renown-reward">威信 +${i.renownGained}</p>` : ''}</li>`).join('')}</ol>` : '<div class="gov-empty"><h3>最初の政務を始めましょう</h3><p>国策の選択や日次政務、公共事業の記録がここに残ります。</p></div>'}`;
    return `<p class="gov-intro">毎日取り組める三つの政務です。それぞれ1日1回。資源を領内に還元し、幕府の威信を育てましょう。</p><div class="gov-grid gov-grid-three">${data.duties.map(i => `<article class="gov-card ${i.claimed ? 'is-complete' : ''}"><div class="gov-card-title"><h3>${esc(i.name)}</h3>${i.claimed ? '<span class="gov-badge">本日完了</span>' : ''}</div><p>${esc(i.description)}</p><div class="gov-values"><small>費用</small>${assetsMarkup(i.cost, '', '費用なし')}<small>褒賞</small>${assetsMarkup(i.reward, '', '威信を獲得')}<span class="gov-renown-reward">威信 +${i.renownReward}</span></div>${cardFooter('duty', i, i.claimed ? '本日完了' : '政務を行う')}</article>`).join('')}</div>`;
  }
  function confirmMarkup() {
    if (!confirmation) return '';
    const { kind, item } = confirmation, reward = kind === 'policy' ? item.reward : item.reward || {}, cost = item.cost || {}, renown = item.renownReward || 0;
    const expected = Object.fromEntries(Object.entries(reward).map(([key, value]) => [key, Math.min(value, Math.max(0, 100000000 - (data.resources[key] || 0) + (cost[key] || 0)))])), capped = Object.keys(reward).some(key => expected[key] < reward[key]);
    const title = kind === 'policy' ? 'この国策を施行しますか？' : kind === 'project' ? '公共事業を発展させますか？' : kind === 'duty' ? 'この政務を実行しますか？' : '発展褒賞を受け取りますか？';
    return `<section class="gov-confirm" role="region" aria-labelledby="gov-confirm-title"><h3 id="gov-confirm-title" tabindex="-1">${title}</h3><p><strong>${esc(item.name)}</strong>${kind === 'project' ? `：Lv.${item.level} から Lv.${item.level + 1}` : ''}</p>${kind === 'policy' ? `<p>本日の国策変更枠を1回使用します。次の日次政務から、下記の褒賞配分が適用されます。</p><p>${esc(amountLabel(reward))}</p>` : `<p>費用：${esc(amountLabel(cost, '費用なし'))}</p><p>褒賞：${esc(amountLabel(reward, renown ? '威信 +' + renown : 'なし'))}${Object.values(reward).some(Boolean) && renown ? '・威信 +' + renown : ''}</p>`}${kind === 'project' ? `<p>${esc(item.effect)}</p>` : ''}${kind !== 'policy' && capped ? `<p class="gov-muted">所持上限を考慮した受取予定：${esc(amountLabel(expected, '資源の加算なし'))}。上限を超える分は加算されません。</p>` : ''}<div class="gov-confirm-actions"><button class="button" data-gov="cancel" ${busy ? 'disabled' : ''}>戻る</button><button class="button gold" data-gov="confirm" ${!canAct() ? 'disabled' : ''}>${kind === 'policy' ? '国策を施行する' : kind === 'project' ? '資源を使って発展' : kind === 'duty' ? '政務を実行する' : '褒賞を受け取る'}</button></div></section>`;
  }
  function render() {
    if (!dialog) return;
    const c = context(), body = dialog.querySelector('.gov-content');
    let content = `<p class="gov-status ${error ? 'is-error' : ''}" role="${error ? 'alert' : 'status'}">${esc(error || message || '')}</p>`;
    if (pending) content += `<section class="gov-pending"><p>前の政務の結果を確認しています。同じ操作番号で再確認できます。</p><button class="button gold" data-gov="retry" ${busy || !writable(c) ? 'disabled' : ''}>前の政務の結果を確認</button></section>`;
    if (!writable(c)) content += `<p class="gov-readonly" role="status">${esc(c.reason || '現在は閲覧できます。政務を行うには、この端末の進行権と同期を確認してください。')}</p>`;
    if (!data) content += `<div class="gov-empty"><h3>${busy ? '幕府政庁を確認しています' : '幕府政庁を読み込む'}</h3><p>開設の記録と、幕府の発展状況を確認します。</p></div>`;
    else if (!data.available) content += `<div class="gov-empty"><span class="gov-seal" aria-hidden="true">幕</span><h3>幕府開設後に政庁が開かれます</h3><p>${esc(data.reason || '天下統一で開設権を獲得し、幕府の記録から開設を申請してください。')}</p><p>開設後は国策・公共事業・日次政務・発展目標が利用できます。</p><button class="button gold" data-gov="records">幕府の記録を開く</button></div>`;
    else {
      const r = data.renown, progress = r.nextLevelAt == null ? 100 : Math.min(100, Math.max(0, (r.points - r.levelStart) * 100 / (r.nextLevelAt - r.levelStart)));
      content += `<section class="gov-hero"><div class="gov-heading"><span class="gov-seal" aria-hidden="true">幕</span><div><small>${esc(data.government.rank)}の政庁</small><h3>${esc(data.government.name)}</h3><p>幕府Lv.${r.level}・${esc(r.name)}</p></div></div><div class="gov-renown"><div><span>幕府の威信</span><strong>${r.points.toLocaleString('ja-JP')}<small>${r.nextLevelAt == null ? ' / 最高段階' : ' / ' + r.nextLevelAt.toLocaleString('ja-JP')}</small></strong></div><progress value="${progress}" max="100" aria-label="幕府レベルの進行"></progress><small>${r.nextLevelAt == null ? '最高段階に到達しました。' : '次の段階まで 威信 ' + Math.max(0, r.nextLevelAt - r.points).toLocaleString('ja-JP')}</small></div></section><div class="gov-summary"><p><span>日次政務の褒賞</span>${assetsMarkup(data.dailyReward)}</p><p class="gov-reset">日本時間・毎朝5時更新<br>次回 ${esc(clockLabel(data.calendar.nextResetAt))}</p></div><p class="gov-growth-note">幕府Lvが上がるたび、日次政務の勾玉が5増加します。Lv.5で40勾玉になります。</p><details class="gov-balance"><summary>現在の所持資源を確認</summary>${assetsMarkup(data.resources)}</details>`;
      if (expired()) content += '<p class="gov-readonly">政務の日付が変わりました。最新の政庁を確認してください。</p>';
      content += confirmMarkup();
      content += `<nav class="gov-tabs" aria-label="幕府政庁の項目">${TABS.map(([key, name]) => `<button class="button ${tab === key ? 'is-active' : ''}" data-gov="tab" data-tab="${key}" aria-current="${tab === key ? 'page' : 'false'}">${name}${key === 'milestones' && data.milestones.some(i => i.canClaim) ? '<span class="gov-tab-ready" aria-label="受取可能">受取可</span>' : ''}</button>`).join('')}</nav><section class="gov-tab-content" aria-label="${TABS.find(i => i[0] === tab)?.[1] || ''}">${tabContent()}</section><p class="gov-footnote">国策・公共事業の効果は日次政務の褒賞に反映されます。幕府名が変わっても発展と受取状況を引き継ぎます。</p>`;
    }
    body.innerHTML = content;
    dialog.querySelector('[data-gov="reload"]').disabled = busy;
    lastWritable = writable(c);
  }
  async function request(route, options = { method: 'GET' }) {
    if (global.SengokuBridge?.requestExpansion) return global.SengokuBridge.requestExpansion(route, options);
    if (options.method === 'POST') throw Error('進行の同期を確認してから、政務をやり直してください。');
    return global.SengokuSocial.expansionRequest(route, options);
  }
  async function load() {
    const c = identity(); if (!allowed(c) || busy) return false;
    const stamp = identityKey, gen = generation; busy = true; error = ''; render();
    try {
      if (writable(c)) await global.SengokuCloudSync?.flush?.();
      if (!isCurrent(stamp, gen)) return false;
      const result = await request('/shogunate/governance', { method: 'GET' });
      if (!isCurrent(stamp, gen)) return false;
      const view = result?.ok === true ? cleanData(result.governance) : null;
      if (!view) throw Error('政庁の情報を確認できませんでした。もう一度更新してください。');
      adopt(view); confirmation = null; return true;
    } catch (e) { if (isCurrent(stamp, gen)) error = e.message || '幕府政庁を読み込めませんでした。'; return false; }
    finally { if (isCurrent(stamp, gen)) { busy = false; render(); } }
  }
  function prepare(kind, targetId) {
    identity(); if (!canAct()) return false;
    const item = entryFor(kind, targetId); if (!eligible(kind, item)) return false;
    confirmation = { kind, item: clone(item), day: data.calendar.day, revision: data.revision }; error = ''; message = ''; render();
    const title = dialog?.querySelector('#gov-confirm-title'); title?.focus?.({ preventScroll: true }); title?.scrollIntoView?.({ block: 'nearest', behavior: 'auto' });
    return true;
  }
  async function execute(retry = false) {
    const c = identity(); if (!allowed(c) || !writable(c) || busy || retry && !pending || !retry && (pending || !confirmation || !canAct())) return false;
    const stamp = identityKey, gen = generation;
    error = ''; message = '';
    if (!pending) {
      const chosen = confirmation, item = entryFor(chosen.kind, chosen.item.id);
      if (!eligible(chosen.kind, item) || chosen.day !== data.calendar.day || chosen.revision !== data.revision) { confirmation = null; error = '政務の内容が更新されました。もう一度選んでください。'; render(); return false; }
      try {
        const record = cleanPending({ kind: chosen.kind, targetId: chosen.item.id, day: chosen.day, governanceRevision: chosen.revision, requestId: global.crypto?.randomUUID?.() });
        if (!record) throw Error('操作番号を作成できませんでした。画面を開き直してください。');
        const encoded = JSON.stringify(record); global.localStorage.setItem(pendingKey(ownerId), encoded);
        if (global.localStorage.getItem(pendingKey(ownerId)) !== encoded) throw Error('政務の確認情報を保存できません。端末の保存設定を確認してください。');
        pending = record;
      } catch (e) { error = e.message || '政務の確認情報を保存できません。'; render(); return false; }
    }
    const record = clone(pending); confirmation = null; busy = true; render(); let refresh = false;
    try {
      const result = await request('/shogunate/governance/action', { method: 'POST', data: record });
      if (!isCurrent(stamp, gen)) return false;
      const view = result?.ok === true ? cleanData(result.governance) : null, receipt = cleanHistory(result?.receipt);
      // The save bridge can recover an older durable operation with the same
      // semantic body. Its effective ID is the one actually sent and verified.
      const effectiveId = result?.effectiveRequestId == null ? record.requestId : id(result.effectiveRequestId) ? result.effectiveRequestId : null;
      if (!view || !receipt || !effectiveId || receipt.id !== effectiveId || receipt.kind !== record.kind || receipt.targetId !== record.targetId || receipt.day !== record.day) throw Error('政務の結果を確認できませんでした。同じ操作の結果を確認してください。');
      adopt(view); clearPending(record);
      const offered = assets(result.receipt.offeredReward), reduced = offered && Object.keys(offered).some(key => offered[key] > (receipt.reward[key] || 0));
      message = `${receipt.name}${result.idempotent ? 'の実行済み記録を確認しました。' : 'を実行しました。'}${Object.values(receipt.reward).some(Boolean) ? ' 受取：' + amountLabel(receipt.reward) + '。' : reduced ? ' 資源は所持上限のため加算されませんでした。' : ''}${receipt.renownGained ? ' 威信 +' + receipt.renownGained + '。' : ''}${reduced && Object.values(receipt.reward).some(Boolean) ? ' 所持上限までの資源を受け取りました。' : ''}`;
      global.SengokuBridge?.playInterfaceSound?.(result.idempotent ? 'tap' : 'reward');
      return true;
    } catch (e) {
      if (!isCurrent(stamp, gen)) return false;
      error = e.message || '接続を確認して、前の政務の結果を確認してください。';
      if (e.retryable !== true && (DEFINITIVE.has(e.code) || [400, 404].includes(Number(e.status)))) { clearPending(record); refresh = true; }
      return false;
    } finally {
      if (isCurrent(stamp, gen)) {
        busy = false; render();
        if (refresh) { const previous = error; await load(); if (isCurrent(stamp, gen)) { error = previous; render(); } }
      }
    }
  }
  function tick() {
    identity(); if (!dialog) return;
    if (lastWritable !== writable(context())) render();
    if (data && expired() && !busy && !pending && now() >= nextRolloverPoll) { confirmation = null; nextRolloverPoll = now() + 30000; void load(); }
  }
  function close() {
    if (timer != null) { global.clearInterval?.(timer); timer = null; }
    if (!dialog) return;
    const old = dialog, target = focus; dialog = null; focus = null; confirmation = null;
    old.close?.(); old.remove(); if (target?.isConnected) target.focus?.({ preventScroll: true });
  }
  function open() {
    const c = identity();
    if (!allowed(c)) { global.SengokuBridge?.toast?.('交流で領主を登録・接続すると、幕府政庁を確認できます。', true); return Promise.resolve(false); }
    if (dialog) { render(); return Promise.resolve(true); }
    focus = global.document.activeElement; dialog = global.document.createElement('dialog'); dialog.className = 'gov-dialog'; dialog.setAttribute('aria-labelledby', 'gov-title');
    dialog.innerHTML = '<header class="gov-header"><div><small>天下を治め、次の繁栄へ</small><h2 id="gov-title">幕府政庁</h2></div><button class="button" data-gov="close" aria-label="幕府政庁を閉じる">閉じる</button></header><div class="gov-content"></div><footer class="gov-footer"><button class="button" data-gov="records">幕府の記録</button><button class="button" data-gov="reload">政庁を更新</button></footer>';
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
    dialog.addEventListener('click', e => {
      const b = e.target?.closest?.('[data-gov]'); if (!b || b.disabled || !dialog?.contains(b)) return; e.preventDefault();
      switch (b.getAttribute('data-gov')) {
        case 'close': close(); break;
        case 'records': close(); global.SengokuShogunate?.open?.(); break;
        case 'reload': void load(); break;
        case 'tab': if (TABS.some(t => t[0] === b.getAttribute('data-tab'))) { tab = b.getAttribute('data-tab'); render(); } break;
        case 'prepare': prepare(b.getAttribute('data-kind'), b.getAttribute('data-target')); break;
        case 'cancel': if (!busy) { confirmation = null; render(); } break;
        case 'confirm': void execute(); break;
        case 'retry': void execute(true); break;
      }
    });
    global.document.body.appendChild(dialog); render(); dialog.showModal(); timer = global.setInterval?.(tick, 1000) ?? null;
    return load();
  }
  global.SengokuShogunateGovernance = { open, close, refresh: load, refreshAccess: identity, prepare, confirm: () => execute(), retry: () => execute(true), cleanData, getState: () => { identity(); return { loaded: Boolean(data), busy, owner: ownerId, data: clone(data), hasPending: Boolean(pending), pending: clone(pending), hasConfirmation: Boolean(confirmation), error, message, tab }; } };
})(typeof window !== 'undefined' ? window : globalThis);
