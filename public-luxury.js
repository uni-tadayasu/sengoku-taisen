/* Reading aids for public pages. No account, save, purchase or game state access. */
(function () {
  'use strict';
  const body = document.body;
  if (!body?.classList.contains('public-luxury')) return;
  const menu = document.querySelector('.public-nav-toggle');
  const nav = document.getElementById('public-site-nav');
  if (menu && nav && window.matchMedia) {
    const compact = window.matchMedia('(max-width: 900px)');
    const collapse = () => menu.setAttribute('aria-expanded', 'false');
    menu.hidden = false;
    menu.addEventListener('click', () => {
      menu.setAttribute('aria-expanded', String(menu.getAttribute('aria-expanded') !== 'true'));
    });
    menu.parentNode.addEventListener('keydown', event => {
      if (event.key === 'Escape' && compact.matches && menu.getAttribute('aria-expanded') === 'true') {
        collapse();
        menu.focus();
      }
    });
    nav.addEventListener('click', collapse);
    compact.addEventListener?.('change', collapse);
  }
  const article = document.querySelector('.article');
  const toc = document.querySelector('.toc-chapters');
  if (!article || !toc) return;
  const list = toc.querySelector('ul');
  const links = [...(list?.querySelectorAll('a[href^="#"]') || [])];
  const sections = links.map(link => ({ link, target: document.getElementById(link.hash.slice(1)) })).filter(entry => entry.target);
  if (!sections.length) return;
  const normalize = value => String(value).normalize('NFKC').toLocaleLowerCase('ja').replace(/[\u30a1-\u30f6]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60)).trim();
  const search = document.createElement('div');
  search.className = 'public-chapter-search';
  search.innerHTML = '<label for="public-chapter-query">知りたい項目を検索</label><input id="public-chapter-query" type="search" placeholder="城・武将・引き継ぎなど" autocomplete="off" aria-controls="public-chapter-list"><p class="public-search-status" role="status" aria-live="polite" aria-atomic="true"></p>';
  toc.before(search);
  list.id = 'public-chapter-list';
  const input = search.querySelector('input'), status = search.querySelector('[role="status"]');
  const empty = document.createElement('p');
  empty.className = 'public-search-empty'; empty.textContent = '該当する項目がありません。別の言葉で検索してください。'; empty.hidden = true; list.after(empty);
  status.textContent = '全' + links.length + '項目から探せます';
  input.addEventListener('input', () => {
    const terms = normalize(input.value).split(/\s+/).filter(Boolean);
    let count = 0;
    for (const link of links) {
      const target = document.getElementById(link.hash.slice(1));
      const title = target?.matches('section') ? target.querySelector('h2, h3')?.textContent : target?.textContent;
      const text = normalize(link.textContent + ' ' + (title || ''));
      const matches = terms.every(term => text.includes(term));
      link.closest('li').hidden = !matches;
      if (matches) count++;
    }
    if (terms.length) toc.open = true;
    empty.hidden = count !== 0;
    status.textContent = terms.length ? count + '件の項目が見つかりました' : '全' + links.length + '項目から探せます';
  });
  const progress = document.createElement('div');
  progress.className = 'public-reading-progress'; progress.setAttribute('aria-hidden', 'true');
  const bar = document.createElement('span'); progress.append(bar); body.append(progress);
  const actions = document.querySelector('.reading-actions');
  if (actions) {
    const top = document.createElement('a'); top.href = '#content'; top.className = 'public-back-top'; top.setAttribute('aria-label', 'ページの先頭へ戻る'); top.textContent = '↑'; actions.prepend(top);
  }
  let pending = false, active = null;
  function update() {
    pending = false;
    const root = document.documentElement, max = root.scrollHeight - root.clientHeight;
    const value = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
    bar.style.transform = 'scaleX(' + value.toFixed(4) + ')';
    const marker = Math.min(200, root.clientHeight * .3);
    let next = null;
    for (const entry of sections) { if (entry.target.getBoundingClientRect().top <= marker) next = entry.link; }
    if (next !== active) {
      active?.removeAttribute('aria-current'); next?.setAttribute('aria-current', 'location'); active = next;
    }
  }
  function schedule() { if (!pending) { pending = true; requestAnimationFrame(update); } }
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pageshow', schedule);
  schedule();
})();
