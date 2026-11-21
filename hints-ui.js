/* Contextual guidance. All navigation is rechecked by the game bridge. */
(function (global) {
  'use strict';
  const categories = { system: '現在の状況', supplies: '備蓄', command: '指令', quest: '任務', army: '軍団', governors: '奉行', construction: '普請', research: '研究', officers: '武将', battle: '天下地図' };
  const resources = { gold: '金銭', rice: '兵糧', wood: '木材', stone: '石材', magatama: '勾玉' };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  const icon = () => '<svg class="hints-icon" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M15 3v26M10 29h10M7 6h16l5 5-5 5H7l3-5-3-5Z"/><path d="M15 11h7m-3-3 3 3-3 3"/></svg>';
  const arrow = '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h12m-5-5 5 5-5 5"/></svg>';
  function assetMap(value) {
    const result = {};
    for (const key of Object.keys(resources)) if (Number.isFinite(value?.[key]) && value[key] > 0) result[key] = Math.ceil(value[key]);
    return result;
  }
  function normalize(report) {
    const seen = new Set(), items = [];
    for (const raw of Array.isArray(report?.items) ? report.items : []) {
      const id = text(raw?.id, 180);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, category: categories[raw.category] || 'ヒント', tone: ['urgent', 'advice', 'success', 'muted'].includes(raw.tone) ? raw.tone : 'advice', title: text(raw.title, 180), reason: text(raw.reason, 1200), detail: text(raw.detail, 1200), label: text(raw.action?.label, 120), cost: assetMap(raw.cost), missing: assetMap(raw.missing), waitSeconds: Number.isFinite(raw.waitSeconds) && raw.waitSeconds >= 0 ? raw.waitSeconds : null });
      if (items.length === 10) break;
    }
    return { scope: text(report?.scope, 500), status: ['ready', 'blocked', 'not-started', 'game-over'].includes(report?.status) ? report.status : 'blocked', title: text(report?.title, 200) || '今できることを見つけましょう', summary: text(report?.summary, 1200), items };
  }
  function formatWait(value) {
    const total = Math.ceil(Math.max(0, value)), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
    return (hours ? hours.toLocaleString('ja-JP') + '時間' : '') + (minutes ? minutes + '分' : '') + (seconds || !hours && !minutes ? seconds + '秒' : '');
  }
  function assetsMarkup(item) {
    return [['cost', '必要な資産'], ['missing', '不足している資産']].map(([key, label]) => {
      const entries = Object.entries(item[key]);
      return entries.length ? '<div class="hints-resource-group' + (key === 'missing' ? ' is-missing' : '') + '"><span>' + label + '</span><ul>' + entries.map(([name, amount]) => '<li>' + resources[name] + '<strong>' + esc(amount.toLocaleString('ja-JP')) + '</strong></li>').join('') + '</ul></div>' : '';
    }).join('');
  }
  function createUI(options = {}) {
    const doc = options.document || global.document;
    const bridge = options.bridge || (() => global.SengokuBridge);
    const viewport = options.viewport || (() => global.SengokuSocialViewport?.refresh?.());
    const now = options.now || (() => global.performance?.now?.() ?? Date.now());
    let dialog = null, main, heading, title, summary, primary, details, others, count, feedback, empty, returnFocus = null;
    let current = null, signature = '', generation = 0, navigating = false, serial = 0, lastEvaluation = null;
    const cards = new Map();
    const setText = (node, value) => { if (node.textContent !== value) node.textContent = value; };
    const clearFeedback = () => { if (feedback) { feedback.hidden = true; setText(feedback, ''); } };
    function showFeedback(message) { if (feedback) { feedback.hidden = false; setText(feedback, message || '状況が変わりました。最新のヒントから選び直してください。'); } }
    function ensure() {
      if (dialog) return true;
      if (!doc?.body) return false;
      dialog = doc.createElement('dialog');
      dialog.id = 'hints-modal'; dialog.className = 'hints-dialog'; dialog.setAttribute('aria-labelledby', 'hints-title');
      dialog.innerHTML = '<header class="hints-header"><span class="hints-mark">' + icon() + '</span><div><span class="hints-eyebrow">いまの領国に合うヒント</span><h1 id="hints-title" tabindex="-1">次の一手</h1></div><button type="button" class="hints-close" data-hints="close" aria-label="ヒントを閉じる"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header><div class="hints-main"><section class="hints-intro"><h2 data-hints-title></h2><p data-hints-summary></p></section><p class="hints-feedback" data-hints-feedback role="status" aria-live="polite" hidden></p><div class="hints-list" data-hints-primary aria-label="おすすめの次の一手"></div><p class="hints-empty" data-hints-empty hidden>状況が変わると、ここに次の候補が表示されます。遊び方も参考にしてください。</p><details class="hints-other"><summary><span>ほかにできること</span><span class="hints-count" data-hints-count></span><span class="hints-chevron" aria-hidden="true"></span></summary><div class="hints-list" data-hints-others></div></details><p class="hints-note">ボタンを押すと、内容を確認できる画面を開きます。</p></div><footer class="hints-footer"><span>状況に合わせて更新されます</span><button type="button" class="hints-guide" data-hints="guide">遊び方を読む' + arrow + '</button></footer>';
      doc.body.append(dialog);
      const $ = selector => dialog.querySelector(selector);
      main = $('.hints-main'); heading = $('#hints-title'); title = $('[data-hints-title]'); summary = $('[data-hints-summary]'); primary = $('[data-hints-primary]'); details = $('.hints-other'); others = $('[data-hints-others]'); count = $('[data-hints-count]'); feedback = $('[data-hints-feedback]'); empty = $('[data-hints-empty]');
      dialog.addEventListener('click', event => {
        const button = event.target.closest('[data-hints],[data-hint-follow]');
        if (!button || !dialog.contains(button) || button.disabled) return;
        if (button.dataset.hints === 'close') close();
        else if (button.dataset.hints === 'guide') follow(null);
        else if (button.dataset.hintFollow) follow(button.dataset.hintFollow);
      });
      dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
      dialog.addEventListener('close', () => { if (!dialog?.open) reset(); });
      return true;
    }
    function makeCard(id) {
      const node = doc.createElement('article'), key = 'hint-item-title-' + (++serial);
      node.setAttribute('aria-labelledby', key);
      node.innerHTML = '<div class="hints-card-meta"><span class="hints-rank"></span><span class="hints-category"></span></div><h3 id="' + key + '"></h3><p class="hints-reason"></p><p class="hints-detail" hidden></p><div class="hints-resources" hidden></div><p class="hints-wait" hidden></p><button type="button" class="hints-action" data-hint-follow="' + esc(id) + '"><span></span>' + arrow + '</button>';
      const find = selector => node.querySelector(selector);
      return { node, rank: find('.hints-rank'), category: find('.hints-category'), title: find('h3'), reason: find('.hints-reason'), detail: find('.hints-detail'), resources: find('.hints-resources'), wait: find('.hints-wait'), button: find('.hints-action'), label: find('.hints-action span'), assetKey: '' };
    }
    function updateCard(card, item, index) {
      const className = 'hints-card is-' + item.tone + (index < 3 ? ' is-recommended' : '');
      if (card.node.className !== className) card.node.className = className;
      setText(card.rank, String(index + 1).padStart(2, '0')); card.rank.hidden = index >= 3;
      setText(card.category, item.category); setText(card.title, item.title); setText(card.reason, item.reason);
      setText(card.detail, item.detail); card.detail.hidden = !item.detail;
      const assetKey = JSON.stringify([item.cost, item.missing]);
      if (card.assetKey !== assetKey) { card.resources.innerHTML = assetsMarkup(item); card.assetKey = assetKey; }
      card.resources.hidden = !Object.keys(item.cost).length && !Object.keys(item.missing).length;
      setText(card.wait, item.waitSeconds === null ? '' : '目安：ゲーム内 ' + formatWait(item.waitSeconds)); card.wait.hidden = item.waitSeconds === null;
      setText(card.label, item.label); card.button.hidden = !item.label; card.button.disabled = navigating;
    }
    function reset() {
      generation++; navigating = false; current = null; signature = '';
      for (const card of cards.values()) card.node.remove();
      cards.clear();
      if (details) details.open = false;
      if (main) main.scrollTop = 0;
      if (title) setText(title, '');
      if (summary) setText(summary, '');
      const guide = dialog?.querySelector('[data-hints="guide"]');
      if (guide) guide.disabled = false;
      clearFeedback();
    }
    function updateEntries(next, entries) {
      let changed = false;
      const best = next.items[0], values = { '[data-hint-title]': best?.title || next.title, '[data-hint-reason]': best?.reason || next.summary };
      for (const entry of entries) for (const [selector, value] of Object.entries(values)) {
        const node = entry.querySelector(selector);
        if (node && node.textContent !== value) { setText(node, value); changed = true; }
      }
      return changed;
    }
    function render(next) {
      const key = JSON.stringify(next);
      if (signature === key) return false;
      const changedScope = current && next.scope !== current.scope;
      const focused = doc.activeElement, hadFocus = dialog.contains(focused), scroll = main.scrollTop;
      if (changedScope) reset();
      current = next; signature = key;
      setText(title, next.title); setText(summary, next.summary); summary.hidden = !next.summary;
      dialog.dataset.status = next.status;
      const ids = new Set(next.items.map(item => item.id));
      for (const [id, card] of cards) if (!ids.has(id)) { card.node.remove(); cards.delete(id); }
      next.items.forEach((item, index) => {
        let card = cards.get(item.id);
        if (!card) { card = makeCard(item.id); cards.set(item.id, card); }
        updateCard(card, item, index);
        const host = index < 3 ? primary : others, position = index < 3 ? index : index - 3;
        if (host.children[position] !== card.node) host.insertBefore(card.node, host.children[position] || null);
      });
      const rest = Math.max(0, next.items.length - 3);
      setText(count, String(rest) + '件'); details.hidden = rest === 0; empty.hidden = next.items.length !== 0;
      if ((hadFocus && doc.activeElement !== focused) || (changedScope && dialog.open)) {
        const available = !changedScope && dialog.contains(focused) && (!others.contains(focused) || details.open);
        (available ? focused : heading).focus({ preventScroll: true });
      }
      main.scrollTop = changedScope ? 0 : scroll;
      return true;
    }
    function read() {
      lastEvaluation = now();
      try {
        const report = bridge()?.getHints?.();
        if (report) return report;
      } catch { showFeedback('ヒントを読み込めませんでした。少し待ってから、もう一度開いてください。'); }
      return { scope: 'unavailable', status: 'blocked', title: 'ヒントを準備しています', summary: '状況を確認できると、ここに次の一手が表示されます。', items: [] };
    }
    function open() {
      if (!ensure()) return false;
      if (dialog.open) { refresh(); return true; }
      returnFocus = doc.activeElement;
      const next = normalize(read());
      updateEntries(next, doc.querySelectorAll('[data-hint-entry]'));
      render(next); dialog.showModal(); heading.focus({ preventScroll: true }); viewport();
      return true;
    }
    function refresh({ throttled = false } = {}) {
      const entries = doc?.querySelectorAll('[data-hint-entry]') || [];
      if (!dialog?.open && !entries.length) return false;
      const elapsed = lastEvaluation === null ? Infinity : now() - lastEvaluation;
      if (throttled && elapsed >= 0 && elapsed < 2000) return false;
      const next = normalize(read()), changed = updateEntries(next, entries);
      return dialog?.open ? render(next) || changed : changed;
    }
    function close() {
      if (!dialog?.open) return false;
      const previous = returnFocus; returnFocus = null;
      dialog.close(); reset();
      if (previous?.isConnected && typeof previous.focus === 'function') previous.focus({ preventScroll: true });
      return true;
    }
    async function follow(id) {
      if (!dialog?.open || navigating) return false;
      const token = generation; navigating = true; clearFeedback();
      for (const card of cards.values()) card.button.disabled = true;
      const guide = dialog.querySelector('[data-hints="guide"]'); guide.disabled = true;
      try {
        const service = bridge(), callback = id === null ? service?.openHintHelp : service?.followHint;
        const result = typeof callback === 'function' ? await callback.call(service, id) : false;
        if (token !== generation || !dialog.open) return result;
        if (result === false || result?.ok === false) { refresh(); if (token === generation && dialog.open) showFeedback(result?.message); }
        return result;
      } catch {
        if (token === generation && dialog.open) { refresh(); if (token === generation && dialog.open) showFeedback('画面を開けませんでした。最新のヒントからもう一度選んでください。'); }
        return false;
      } finally {
        if (token === generation) {
          navigating = false; guide.disabled = false;
          for (const card of cards.values()) card.button.disabled = false;
        }
      }
    }
    function dispose() { close(); dialog?.remove(); dialog = null; }
    return { open, refresh, close, dispose, isOpen: () => Boolean(dialog?.open), icon };
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createUI, normalize, formatWait, assetsMarkup };
  global.SengokuHintsUI = createUI();
})(typeof window !== 'undefined' ? window : globalThis);
