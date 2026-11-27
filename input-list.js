/* Shared picker for inputs with a known set of choices. Each screen owns its data and selection. */
(function (global) {
  'use strict';
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase('ja');
  const pageSize = 40;
  let active = null;

  function open({trigger, title, options = [], onSelect, load, valid, emptyText = '候補がありません。', hint = ''}) {
    const doc = trigger?.ownerDocument;
    const canUse = () => trigger?.isConnected && !trigger.disabled &&
      !trigger.closest('[hidden],[inert],dialog:not([open])') && (!valid || valid());
    if (!doc || typeof onSelect !== 'function' || !canUse()) return;
    active?.close();
    const dialog = doc.createElement('dialog');
    dialog.id = 'sengoku-input-list';
    dialog.setAttribute('aria-labelledby', 'input-list-title');
    dialog.innerHTML = `<section class="input-list-panel"><header><h2 id="input-list-title"></h2>
      <button type="button" class="button small" data-list-close>閉じる</button></header>
      <p data-list-hint></p><label for="input-list-filter">候補を絞り込む</label>
      <input id="input-list-filter" class="input" type="search" autocomplete="off" aria-controls="input-list-items" placeholder="名前・キーワード">
      <p data-list-status role="status" aria-live="polite"></p>
      <div id="input-list-items" aria-labelledby="input-list-title"></div>
      <button type="button" class="button small" data-list-more>続きを表示</button>
      <button type="button" class="button small" data-list-retry hidden>再読み込み</button></section>`;
    const get = selector => dialog.querySelector(selector);
    const input = get('#input-list-filter'), rows = get('#input-list-items');
    const status = get('[data-list-status]'), more = get('[data-list-more]'), retry = get('[data-list-retry]');
    get('h2').textContent = title;
    get('[data-list-hint]').textContent = hint;
    get('[data-list-hint]').hidden = !hint;
    let results = [], count = 0, remote = [], initialResults = [], timer, guardTimer, request, generation = 0;
    let pending = false, failed = false, chosen = false;
    const current = () => active === dialog && dialog.open && canUse();
    function appendPage() {
      const start = count;
      let first;
      for (const option of results.slice(start, start + pageSize)) {
        const button = doc.createElement('button');
        button.type = 'button';
        button.dataset.listValue = String(option.value);
        if (!first) first = button;
        button.className = 'input-list-option';
        const label = doc.createElement('span');
        label.textContent = option.label;
        button.append(label);
        if (option.detail) {
          const detail = doc.createElement('small');
          detail.textContent = option.detail;
          button.append(detail);
        }
        button.addEventListener('click', () => {
          if (!current()) { dialog.close(); return; }
          chosen = true;
          dialog.close();
          onSelect(option);
        });
        rows.append(button);
        count++;
      }
      more.hidden = count >= results.length;
      return first;
    }
    function render() {
      const term = normalize(input.value.trim()), unique = new Map();
      const focused = rows.contains(doc.activeElement) ? doc.activeElement?.dataset.listValue : null;
      for (const option of [...options, ...initialResults]) {
        if (option?.value == null || !option.label) continue;
        if (!term || normalize([option.label, option.detail, option.keywords, option.value].join(' ')).includes(term)) unique.set(String(option.value), option);
      }
      for (const option of remote) if (option?.value != null && option.label) unique.set(String(option.value), option);
      results = [...unique.values()];
      rows.replaceChildren();
      count = 0;
      appendPage();
      status.textContent = pending ? '候補を取得中…' : failed ? '追加の候補を取得できませんでした。'
        : results.length ? results.length + '件' : term ? '一致する候補がありません。' : emptyText;
      retry.hidden = !failed;
      if (focused != null) {
        const match = Array.from(rows.querySelectorAll('[data-list-value]')).find(button => button.dataset.listValue === focused);
        (match || input).focus({preventScroll:true});
      }
    }
    function update(immediate) {
      clearTimeout(timer);
      request?.abort();
      const id = ++generation, query = input.value.trim();
      remote = []; failed = false; pending = Boolean(load);
      render();
      if (!load) return;
      const fetchOptions = async () => {
        if (!current()) { dialog.close(); return; }
        const controller = new AbortController();
        request = controller;
        try {
          const value = await load(query, controller.signal);
          if (id !== generation || !current()) return;
          remote = Array.isArray(value) ? value : [];
          if (!query) initialResults = remote;
        } catch {
          if (id !== generation || !current()) return;
          failed = true;
        } finally {
          if (id === generation && current()) { pending = false; render(); }
        }
      };
      if (immediate) fetchOptions();
      else timer = setTimeout(fetchOptions, 180);
    }
    more.addEventListener('click', () => appendPage()?.focus());
    retry.addEventListener('click', () => update(true));
    input.addEventListener('input', () => update(false));
    get('[data-list-close]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); event.stopPropagation(); });
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('close', () => {
      clearTimeout(timer); clearInterval(guardTimer);
      generation++; request?.abort(); dialog.remove();
      if (active === dialog) {
        active = null;
        if (!chosen && canUse()) trigger.focus({preventScroll:true});
      }
    }, {once:true});
    doc.body.append(dialog);
    dialog.showModal();
    active = dialog;
    guardTimer = setInterval(() => { if (!canUse()) dialog.close(); }, 600);
    input.focus({preventScroll:true});
    update(true);
  }
  global.SengokuInputList = {open};
})(typeof window !== 'undefined' ? window : globalThis);
