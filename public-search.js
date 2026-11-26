/* Public guide search. The index is loaded only after the reader opens search. */
(function () {
  'use strict';
  const triggers = [...document.querySelectorAll('[data-public-search]')];
  const source = triggers.find(link => link.dataset.searchIndex)?.dataset.searchIndex;
  if (!source || !window.HTMLDialogElement || !window.HTMLDialogElement.prototype.showModal) return;
  if (document.body.dataset.publicSearchReady === 'true') return;
  const indexURL = new URL(source, window.location.href);
  const guideURL = new URL('guide/', indexURL);
  if (indexURL.origin !== window.location.origin) return;
  document.body.dataset.publicSearchReady = 'true';
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('ja')
    .replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)).replace(/\s+/g, ' ').trim();
  const aliases = [
    ['セーブ', '保存'], ['引継ぎ', '引き継ぎ'], ['スマートフォン', 'スマホ'],
    ['bgm', '音楽'], ['ガチャ', '招集'], ['初心者', '初めて', '始め方']
  ].map(group => group.map(normalize));
  let dialog, input, results, status, retry, opener, entries, loadPromise, timer, appliedQuery;

  function create() {
    if (dialog) return;
    dialog = document.createElement('dialog');
    dialog.className = 'public-search-dialog';
    dialog.setAttribute('aria-labelledby', 'public-search-title');
    dialog.innerHTML = '<div class="public-search-shell"><header class="public-search-heading"><div><p>戦国VS 公式ガイド</p><h2 id="public-search-title">知りたいことを、すぐに。</h2></div><button type="button" class="public-search-close" aria-label="ガイド検索を閉じる">閉じる</button></header><div class="public-search-field"><label for="public-search-input">遊び方・引き継ぎ・更新情報をまとめて検索</label><div><span class="public-search-symbol" aria-hidden="true"></span><input id="public-search-input" type="search" placeholder="城の強化、武将、BGMなど" autocomplete="off" spellcheck="false" aria-controls="public-search-results"><button type="button" class="public-search-reset" aria-label="入力した検索語を消す" disabled>解除</button></div></div><div class="public-search-suggestions" role="group" aria-label="目的から探す"><button type="button" data-search-query="始め方">始め方</button><button type="button" data-search-query="城郭">城の強化</button><button type="button" data-search-query="武将">武将</button><button type="button" data-search-query="同盟">同盟</button><button type="button" data-search-query="BGM">BGM</button><button type="button" data-search-query="引き継ぎ">引き継ぎ</button></div><div class="public-search-results-heading"><p role="status" aria-live="polite" aria-atomic="true"></p><button class="public-search-retry" type="button" hidden>再読み込み</button></div><ol id="public-search-results" class="public-search-results" aria-label="検索結果"></ol><footer class="public-search-footer"><a class="public-search-all">遊び方をすべて読む</a><span><kbd>↑</kbd><kbd>↓</kbd> で選択 <kbd>Esc</kbd> で閉じる</span></footer></div>';
    document.body.append(dialog);
    input = dialog.querySelector('input');
    results = dialog.querySelector('.public-search-results');
    status = dialog.querySelector('[role="status"]');
    retry = dialog.querySelector('.public-search-retry');
    dialog.querySelector('.public-search-all').href = guideURL.href;
    dialog.querySelector('.public-search-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
    dialog.addEventListener('close', () => {
      clearTimeout(timer);
      document.body.classList.remove('public-search-open');
      if (opener?.isConnected) {
        const returnTo = opener.getClientRects().length ? opener : document.querySelector('.public-nav-toggle');
        returnTo?.focus({preventScroll:true});
      }
    });
    input.addEventListener('input', event => {
      if (event.isComposing || event.keyCode === 229) return;
      clearTimeout(timer);
      timer = setTimeout(render, 100);
    });
    input.addEventListener('compositionend', () => { clearTimeout(timer); render(); });
    dialog.querySelector('.public-search-reset').addEventListener('click', () => {
      input.value = ''; render(); input.focus({preventScroll:true});
    });
    for (const button of dialog.querySelectorAll('[data-search-query]')) button.addEventListener('click', () => {
      input.value = button.dataset.searchQuery; render(); input.focus({preventScroll:true});
    });
    retry.addEventListener('click', load);
    dialog.addEventListener('keydown', event => {
      if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === 'Escape') {
        // A search input otherwise consumes the first Escape to clear its
        // value. Match the dialog's visible keyboard help in one keypress.
        event.preventDefault(); dialog.close(); return;
      }
      const links = [...results.querySelectorAll('a')];
      const index = links.indexOf(document.activeElement);
      if (event.target !== input && index < 0) return;
      if (event.key === 'ArrowDown' && links.length) {
        event.preventDefault(); links[Math.min(index + 1, links.length - 1)].focus();
      } else if (event.key === 'ArrowUp' && index >= 0) {
        event.preventDefault(); (index === 0 ? input : links[index - 1]).focus();
      } else if (event.key === 'Enter' && event.target === input) {
        // Commit a pending input before following the result, without an IME
        // confirmation key ever triggering navigation.
        event.preventDefault(); clearTimeout(timer); render(); results.querySelector('a')?.click();
      }
    });
    results.addEventListener('click', event => {
      const link = event.target.closest('a');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const target = new URL(link.href);
      if (target.pathname === location.pathname && target.search === location.search) {
        dialog.close();
        // Native fragment navigation remains responsible for the address and
        // history; close the dialog first so the anchor is visible.
      }
    });
  }

  function termsFor(query) {
    return normalize(query).split(' ').filter(Boolean).map(term => aliases.find(group => group.includes(term)) || [term]);
  }

  function excerpt(entry, groups) {
    const position = groups.flat().map(term => entry.searchBody.indexOf(term)).filter(index => index >= 0).sort((a, b) => a - b)[0] || 0;
    const start = Math.max(0, position - 35);
    return (start ? '…' : '') + entry.body.slice(start, start + 155) + (entry.body.length > start + 155 ? '…' : '');
  }

  function render() {
    if (!entries) return;
    const query = normalize(input.value);
    dialog.querySelector('.public-search-reset').disabled = !input.value;
    if (query === appliedQuery) return;
    appliedQuery = query;
    const groups = termsFor(query);
    const matches = entries.map((entry, index) => {
      let score = 0;
      for (const group of groups) {
        const title = group.some(term => entry.searchTitle.includes(term));
        const keyword = group.some(term => entry.searchKeywords.includes(term));
        const body = group.some(term => entry.searchBody.includes(term));
        if (!title && !keyword && !body) return null;
        score += title ? 12 : keyword ? 8 : 1;
      }
      return {entry, score, index};
    }).filter(Boolean).sort((a, b) => b.score - a.score || a.index - b.index);
    const visible = matches.slice(0, query ? 24 : 8);
    results.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const {entry} of visible) {
      const item = document.createElement('li'), link = document.createElement('a');
      link.href = entry.url;
      const category = document.createElement('span'); category.className = 'public-search-category'; category.textContent = entry.page;
      const title = document.createElement('strong'); title.textContent = entry.title;
      const detail = document.createElement('span'); detail.className = 'public-search-excerpt'; detail.textContent = excerpt(entry, groups);
      const arrow = document.createElement('span'); arrow.className = 'public-search-arrow'; arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = '→';
      link.append(category, title, detail, arrow); item.append(link); fragment.append(item);
    }
    if (!visible.length) {
      const empty = document.createElement('li'); empty.className = 'public-search-no-results';
      const title = document.createElement('strong'); title.textContent = '見つかりませんでした';
      const text = document.createElement('p'); text.textContent = '「城」「保存」など、短い言葉でも検索できます。上の項目から探すこともできます。';
      empty.append(title, text); fragment.append(empty);
    }
    results.append(fragment); results.scrollTop = 0;
    status.textContent = !query ? 'まずはこちらから · 全' + entries.length + '項目を検索できます' :
      matches.length > visible.length ? matches.length + '件中、関連の高い' + visible.length + '件を表示' : matches.length + '件の項目が見つかりました';
  }

  async function load() {
    if (entries) { render(); return; }
    if (loadPromise) return loadPromise;
    retry.hidden = true;
    status.textContent = '公式ガイドを読み込んでいます…';
    results.setAttribute('aria-busy', 'true');
    loadPromise = (async () => {
      try {
        const response = await fetch(indexURL.href, {credentials:'same-origin'});
        if (!response.ok) throw Error('Guide index unavailable');
        const index = await response.json();
        if (index.schemaVersion !== 1 || !Array.isArray(index.entries)) throw Error('Invalid guide index');
        entries = index.entries.filter(entry => entry && ['title', 'page', 'href', 'body'].every(key => typeof entry[key] === 'string'))
          .map(entry => {
            const url = new URL(entry.href, indexURL);
            if (url.origin !== indexURL.origin || !['http:', 'https:', 'file:'].includes(url.protocol)) return null;
            return {...entry, url:url.href, searchTitle:normalize(entry.title), searchKeywords:normalize(entry.keywords || ''), searchBody:normalize(entry.body)};
          }).filter(Boolean);
        if (!entries.length) throw Error('Empty guide index');
        appliedQuery = null; render();
      } catch (_) {
        entries = null;
        status.textContent = '検索の読み込みができませんでした。再読み込みするか、下の「遊び方をすべて読む」からお進みください。';
        retry.hidden = false;
      } finally {
        results.removeAttribute('aria-busy');
        loadPromise = null;
      }
    })();
    return loadPromise;
  }

  function open(trigger) {
    create(); opener = trigger;
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('public-search-open');
    input.focus({preventScroll:true});
    load();
  }
  for (const trigger of triggers) {
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault(); open(trigger);
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key !== '/' || event.repeat || event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey || dialog?.open) return;
    if (event.target.isContentEditable || event.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return;
    event.preventDefault(); open(document.activeElement);
  });
})();
