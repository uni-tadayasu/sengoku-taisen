/* A read-only briefing of the current campaign. Actions use the existing UI. */
(function (global) {
  'use strict';
  const resources = {gold:'金銭', rice:'兵糧', wood:'木材', stone:'石材'};
  const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
  const number = value => Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('ja-JP');
  const signed = value => { const n = Number(value) || 0; return (n < 0 ? '−' : n > 0 ? '+' : '') + number(Math.abs(n)); };

  function build(game, options = {}) {
    const state = game?.state || {};
    const income = options.income || game?.income?.() || {};
    const jobs = options.jobs || game?.constructionJobs?.() || state.jobs || [];
    const marches = (options.marches || []).filter(march => march?.status === 'marching');
    const queued = jobs.filter(job => job.queued === true).length;
    const available = (options.quests || []).filter(quest => {
      const status = game?.questStatus?.(quest.id);
      return status?.complete === true && status.claimed !== true;
    }).length;
    const deficit = Object.keys(resources).filter(key => Number(income.net?.[key] ?? income[key] ?? 0) < 0);
    const army = (state.army || []).filter(Boolean).length;
    const morale = Math.min(100, Math.max(0, Number(state.morale) || 0));
    const militaryDeficit = deficit.some(key => key === 'gold' || key === 'rice');
    return {
      jobs: number(jobs.length),
      jobsDetail: jobs.length ? `${number(jobs.length - queued)}件進行 · ${number(queued)}件予約` : '普請と研究の状況',
      marches: number(marches.length),
      marchesDetail: marches.length ? `うち帰還中 ${number(marches.filter(march => march.phase === 'returning').length)}部隊` : '移動中の部隊を確認',
      quests: number(available),
      questsDetail: available ? '領主任務の報酬を確認' : '次の目標を確認',
      troops: number(state.troops),
      troopsDetail: `軍団 ${number(army)} / 3名 · 士気 ${number(morale)}`,
      gold: signed(income.net?.gold ?? income.gold),
      rice: signed(income.net?.rice ?? income.rice),
      goldNegative: Number(income.net?.gold ?? income.gold ?? 0) < 0,
      riceNegative: Number(income.net?.rice ?? income.rice ?? 0) < 0,
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
    return `<section class="domain-briefing" id="domain-briefing" data-tone="${model.tone}" aria-labelledby="domain-briefing-title"><header><div><span class="domain-briefing-kicker">COMMAND DESK</span><h2 id="domain-briefing-title">領国の指揮台</h2></div><span class="domain-briefing-caption">いまの状況を、一目で。</span></header><div class="domain-briefing-grid">${tile('jobs','普請・研究','件','castle','data-action="town-section" data-id="town-reports-section"','jobsDetail')}${tile('marches','進軍・帰還','部隊','flag','data-action="command-marches" aria-haspopup="dialog"','marchesDetail')}${tile('quests','達成済み任務','件','scroll','data-view="council"','questsDetail')}${tile('troops','本隊の兵数','人','swords','data-view="army"','troopsDetail')}</div><button type="button" class="domain-briefing-ledger" data-action="economy-details" aria-haspopup="dialog"><span class="domain-briefing-ledger-title">${icon('coins')}毎月の収支 <small>見込み</small></span><span class="domain-briefing-ledger-values"><span>金銭 <b data-briefing-value="gold" class="${model.goldNegative?'is-negative':''}">${esc(model.gold)}</b></span><span>兵糧 <b data-briefing-value="rice" class="${model.riceNegative?'is-negative':''}">${esc(model.rice)}</b></span></span><span class="domain-briefing-ledger-open">内訳を見る ${icon('chevron')}</span></button><p class="domain-briefing-note" data-briefing-value="note">${esc(model.note)}</p></section>`;
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
    if (host.dataset.tone !== model.tone) host.dataset.tone = model.tone;
  }

  const api = {build, markup, refresh};
  global.SengokuCommandCenter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
