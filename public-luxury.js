/* Reading aids for public pages. No account, save, purchase or game state access. */
(function () {
  'use strict';
  const body = document.body;
  if (!body?.classList.contains('public-luxury') || body.dataset.publicReadingReady === 'true') return;
  body.dataset.publicReadingReady = 'true';
  const menu = document.querySelector('.public-nav-toggle');
  const nav = document.getElementById('public-site-nav');
  if (menu && nav && window.matchMedia) {
    const compact = window.matchMedia('(max-width: 900px)');
    const collapse = () => menu.setAttribute('aria-expanded', 'false');
    menu.hidden = false;
    menu.addEventListener('click', () => {
      menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && compact.matches && menu.getAttribute('aria-expanded') === 'true') {
        event.preventDefault();
        collapse();
        menu.focus();
      }
    });
    document.addEventListener('click', event => {
      if (compact.matches && !menu.parentNode.contains(event.target)) collapse();
    });
    document.addEventListener('focusin', event => {
      if (compact.matches && !menu.parentNode.contains(event.target)) collapse();
    });
    nav.addEventListener('click', collapse);
    compact.addEventListener?.('change', collapse);
  }
  const article = document.querySelector('.article');
  const toc = document.querySelector('.toc-chapters');
  if (!article || !toc) return;
  const topics = document.querySelector('.quick-topics');
  const compactReader = window.matchMedia?.('(max-width: 900px), (max-height: 520px)');
  function setIndexLayout() {
    toc.open = !compactReader?.matches || window.location?.hash === '#page-contents';
    if (topics) topics.open = !compactReader?.matches;
  }
  setIndexLayout();
  compactReader?.addEventListener?.('change', setIndexLayout);
  document.addEventListener('click', event => {
    if (event.target.closest?.('a[href="#page-contents"]')) toc.open = true;
  });
  window.addEventListener('hashchange', () => {
    if (window.location?.hash === '#page-contents') toc.open = true;
  });
  const list = toc.querySelector('ul');
  const links = [...(list?.querySelectorAll('a[href^="#"]') || [])];
  const sections = links.map(link => ({ link, target: document.getElementById(link.hash.slice(1)) })).filter(entry => entry.target);
  if (!sections.length) return;
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('ja').replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)).trim();
  const search = document.createElement('div');
  search.className = 'public-chapter-search';
  search.innerHTML = '<label for="public-chapter-query">知りたい項目を検索</label><div class="public-search-control"><input id="public-chapter-query" type="search" placeholder="城・武将・引き継ぎなど" autocomplete="off" aria-controls="public-chapter-list"><button class="public-search-clear" type="button" aria-label="検索条件を解除" disabled>解除</button></div><p class="public-search-status" role="status" aria-live="polite" aria-atomic="true"></p>';
  list.before(search);
  list.id = 'public-chapter-list';
  const input = search.querySelector('input'), status = search.querySelector('[role="status"]'), clear = search.querySelector('button');
  const empty = document.createElement('p');
  empty.className = 'public-search-empty'; empty.textContent = '該当する項目がありません。別の言葉で検索してください。'; empty.hidden = true; list.after(empty);
  const chapters = sections.map(({ link, target }) => ({
    link,
    name: normalize(link.textContent + ' ' + (target.matches('section') ? target.querySelector('h2, h3')?.textContent || '' : target.textContent)),
    text: normalize(target.textContent)
  }));
  status.textContent = '全' + links.length + '項目から探せます';
  let appliedQuery = '';
  function filter() {
    const query = normalize(input.value).replace(/\s+/g, ' ');
    clear.disabled = !input.value;
    if (query === appliedQuery) return;
    appliedQuery = query;
    const terms = query.split(' ').filter(Boolean);
    const matches = text => terms.every(term => text.includes(term));
    const namesMatch = chapters.some(chapter => matches(chapter.name));
    let count = 0;
    for (const chapter of chapters) {
      const show = matches(namesMatch ? chapter.name : chapter.text);
      chapter.link.closest('li').hidden = !show;
      if (show) count++;
    }
    if (terms.length) toc.open = true;
    list.scrollTop = 0;
    empty.hidden = count !== 0;
    if (!terms.length) status.textContent = '全' + links.length + '項目から探せます';
    else if (count && !namesMatch) status.textContent = '本文に含まれる項目が' + count + '件あります';
    else status.textContent = count + '件の項目が見つかりました';
    invalidate();
  }
  input.addEventListener('input', event => { if (!event.isComposing) filter(); });
  input.addEventListener('compositionend', filter);
  function resetSearch() { input.value = ''; filter(); input.focus(); }
  clear.addEventListener('click', resetSearch);
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape' && input.value) { event.preventDefault(); resetSearch(); }
    if (event.key === 'ArrowDown') {
      const first = chapters.find(chapter => !chapter.link.closest('li').hidden);
      if (first) { event.preventDefault(); toc.open = true; first.link.focus(); }
    }
  });
  const current = document.createElement('div');
  current.className = 'public-current-chapter';
  current.innerHTML = '<span>現在の項目</span><a href="' + sections[0].link.hash + '"></a>';
  const currentLink = current.querySelector('a');
  currentLink.textContent = sections[0].link.textContent;
  toc.before(current);
  const progress = document.createElement('div');
  progress.className = 'public-reading-progress'; progress.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('span'); progress.append(bar); body.append(progress);
  const actions = document.querySelector('.reading-actions');
  if (actions) {
    const top = document.createElement('a'); top.href = '#content'; top.className = 'public-back-top'; top.setAttribute('aria-label', 'ページの先頭へ戻る'); top.textContent = '先頭'; actions.prepend(top);
  }
  let pending = false, active = null, measureNeeded = true, starts = [];
  function update() {
    pending = false;
    const root = document.documentElement, max = root.scrollHeight - root.clientHeight;
    const value = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    // Read chapter geometry only after a layout change, before any style writes.
    // Scrolling a long guide then needs no per-chapter layout measurements.
    if (measureNeeded) {
      starts = sections.map(entry => entry.target.getBoundingClientRect().top + window.scrollY);
      measureNeeded = false;
    }
    const marker = Math.min(200, root.clientHeight * .3);
    let low = 0, high = starts.length - 1, index = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if (starts[middle] <= window.scrollY + marker) { index = middle; low = middle + 1; }
      else high = middle - 1;
    }
    const next = index >= 0 ? sections[index].link : null;
    const transform = 'scaleX(' + value.toFixed(4) + ')';
    if (bar.style.transform !== transform) bar.style.transform = transform;
    if (next !== active) {
      active?.removeAttribute('aria-current'); next?.setAttribute('aria-current', 'location'); active = next;
      const selected = next || sections[0].link;
      currentLink.href = selected.hash;
      currentLink.textContent = selected.textContent;
      currentLink.setAttribute('title', selected.textContent);
    }
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(update); } }
  function invalidate() { measureNeeded = true; schedule(); }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', invalidate, { passive: true });
  window.addEventListener('pageshow', invalidate);
  window.addEventListener('load', invalidate);
  toc.addEventListener('toggle', invalidate);
  topics?.addEventListener('toggle', invalidate);
  document.addEventListener('load', invalidate, true);
  if (window.ResizeObserver) new window.ResizeObserver(invalidate).observe(body);
  document.fonts?.ready?.then(invalidate).catch(() => {});
  schedule();
})();
