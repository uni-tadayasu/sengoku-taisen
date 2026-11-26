/* Exercise the actual menu controller against canonical game controls. */
'use strict';
const assert = require('node:assert/strict');
const { createNavigationUI, normalizeQuery, filterEntries, highlightMatch } = require('../navigation-ui.js');
const { documentFixture } = require('./test-events-ui.cjs');
const tests = [], test = (name, run) => tests.push([name, run]);
const views = [['town', '城下町'], ['facilities', '城下普請帳'], ['map', '天下地図'], ['field', '共通フィールド'], ['roaming', '野良兵戦'], ['covert', '派遣部隊'], ['court', '京都御所'], ['officers', '武将名鑑'], ['crests', '家紋帳'], ['army', '軍団編成'], ['research', '技術研究'], ['council', '軍議']];
const actions = [['command-activity', '行動予定表'], ['events', '期間限定合戦'], ['progress', '成長手帳'], ['alliance-strategy', '同盟作戦'], ['conquest', '共有天下統一'], ['shogunate', '幕府の記録']];
const preferenceKey = 'sengoku-navigation-preferences-v1';
function fixture({ touch = false, unsupported = false, storage = new Map(), storageDenied = false } = {}) {
  const { doc } = documentFixture(), originalCreate = doc.createElement, calls = [], scrolls = [], frames = new Map(); let sequence = 0;
  function augment(node) {
    if (node._navigationFixtureReady) return node; node._navigationFixtureReady = true;
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(node), 'innerHTML');
    Object.defineProperty(node, 'innerHTML', { get() { return descriptor.get.call(this); }, set(value) { descriptor.set.call(this, value); for (const child of this.children) augment(child); } });
    node.classList.contains = value => node.className.split(/\s+/).includes(value);
    node.classList.add = value => node.classList.toggle(value, true);
    node.classList.remove = value => node.classList.toggle(value, false);
    node.removeAttribute = name => { delete node.attributes[name]; if (name === 'hidden') node.hidden = false; if (name === 'disabled') node.disabled = false; };
    node.appendChild = child => node.append(child);
    node.insertBefore = (child, before) => { child.remove(); child.parentElement = node; const index = node.children.indexOf(before); node.children.splice(index < 0 ? node.children.length : index, 0, child); return child; };
    node.getClientRects = () => { for (let parent = node; parent; parent = parent.parentElement) if (parent.hidden) return []; return [{}]; };
    node.click = () => { if (node.disabled) return; for (let parent = node; parent; parent = parent.parentElement) parent.dispatch('click', node); doc.dispatch('click', node); };
    if (unsupported && node.tagName === 'DIALOG') node.showModal = undefined;
    for (const child of node.children) augment(child);
    return node;
  }
  doc.createElement = tag => augment(originalCreate(tag));
  doc.documentElement = doc.createElement('html'); doc.body = doc.createElement('body'); doc.activeElement = doc.body;
  doc.getElementById = id => doc.querySelector('#' + id);
  const app = doc.createElement('div'); app.id = 'app'; app.inert = false; doc.body.append(app);
  const sidebar = doc.createElement('aside'); sidebar.className = 'sidebar'; app.append(sidebar);
  const nav = doc.createElement('nav'); nav.id = 'navigation'; sidebar.append(nav);
  const bottom = doc.createElement('div'); bottom.className = 'sidebar-bottom'; sidebar.append(bottom);
  const main = doc.createElement('main'); main.id = 'main'; main.setAttribute('data-view', 'town'); app.append(main);
  main.scrollIntoView = options => scrolls.push(options);
  const source = (parent, kind, id, label) => { const node = doc.createElement('button'); node.className = 'nav-item'; node.setAttribute('data-' + kind, id); node.innerHTML = '<span>' + label + '</span>'; parent.append(node); return node; };
  for (const [id, label] of views) source(nav, 'view', id, label);
  for (const [id, label] of actions) source(nav, 'action', id, label);
  nav.querySelector('[data-view="town"]').classList.add('active');
  for (const [id, label] of [['title-screen', 'タイトルへ'], ['hints', 'ヒント'], ['premium', '有料版・支援'], ['settings', '保存・設定']]) source(bottom, 'action', id, label);
  const social = doc.createElement('button'); social.className = 'social-launcher'; social.innerHTML = '<span>交流</span>'; social.addEventListener('click', () => calls.push('social')); doc.body.append(social);
  doc.addEventListener('click', event => {
    const node = event.target.closest('[data-view], [data-action]'); if (!node) return;
    const view = node.getAttribute('data-view'), action = node.getAttribute('data-action'); calls.push(view ? 'view:' + view : 'action:' + action);
    if (view) { for (const button of nav.querySelectorAll('button')) button.classList.toggle('active', button.getAttribute('data-view') === view); main.setAttribute('data-view', view); }
  });
  const storageWrites = [];
  const win = { document: doc, localStorage: { getItem(key) { assert.equal(key, preferenceKey, 'Navigation must not read account or game storage'); if (storageDenied) throw Error('Storage denied'); return storage.get(key) ?? null; }, setItem(key, value) { assert.equal(key, preferenceKey, 'Navigation must not change account or game storage'); if (storageDenied) throw Error('Storage denied'); storage.set(key, value); storageWrites.push(value); } }, navigator: { maxTouchPoints: touch ? 1 : 0 }, matchMedia: () => ({ matches: touch }), requestAnimationFrame: fn => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: id => frames.delete(id), events: {}, addEventListener: doc.addEventListener, removeEventListener: doc.removeEventListener };
  const drain = () => { let steps = 0; while (frames.size && steps++ < 20) { const [id, fn] = frames.entries().next().value; frames.delete(id); fn(); } assert(steps < 20, 'Animation loop did not settle'); };
  const api = createNavigationUI(win), get = selector => doc.querySelector(selector);
  const key = (extra = {}) => doc.dispatch('keydown', doc.activeElement, { key: 'k', ctrlKey: true, ...extra });
  return { api, doc, win, app, nav, bottom, main, social, calls, scrolls, get, key, drain, source, frames, storage, storageWrites };
}
function delayedNavigation(s) {
  const loading = s.doc.createElement('dialog'); loading.id = 'game-loading'; s.doc.body.append(loading);
  s.nav.querySelector('[data-view="army"]').addEventListener('click', () => { s.doc.body.classList.add('is-loading'); loading.showModal(); });
  assert(s.api.activate('view:army')); s.drain();
  assert.equal(s.main.getAttribute('data-view'), 'army'); assert.equal(s.scrolls.length, 0); assert.equal(s.frames.size, 0, 'Loading must not trigger a polling frame');
  return () => { loading.close(); s.doc.body.classList.remove('is-loading'); s.api.refresh(); s.drain(); };
}

test('enhancement preserves all original destinations and never executes a game command while opening', () => {
  const s = fixture(), originals = [...s.nav.children, ...s.bottom.children.filter(node => node.tagName === 'BUTTON')];
  assert(s.api); assert(s.doc.documentElement.classList.contains('sengoku-navigation-ready'));
  const entries = s.api.getEntries(); assert.equal(entries.length, 26);
  for (const [id] of views) assert(entries.some(entry => entry.key === 'view:' + id));
  for (const [id] of actions) assert(entries.some(entry => entry.key === 'action:' + id));
  for (const id of ['settings', 'hints', 'premium', 'title-screen']) assert(entries.some(entry => entry.key === 'action:' + id));
  assert(entries.some(entry => entry.key === 'utility:social')); assert(entries.some(entry => entry.key === 'help:recovery'));
  assert(s.api.open()); assert.deepEqual(s.calls, []); for (const node of originals) assert(node.isConnected);
  assert.equal(s.doc.activeElement, s.get('#navigation-query')); assert.equal(s.get('.navigation-menu-trigger').getAttribute('aria-expanded'), 'true');
});

test('search understands full-width letters, kana and multiple purpose words without replacing the input', () => {
  const s = fixture(); s.api.open(); const input = s.get('#navigation-query'); input.focus();
  assert.equal(normalizeQuery(' ＮＰＣ '), 'npc'); assert.equal(normalizeQuery('ギルド'), 'ぎるど');
  assert(filterEntries(s.api.getEntries(), 'ＮＰＣ').some(entry => entry.key === 'view:roaming'));
  assert(filterEntries(s.api.getEntries(), '軍師 ＡＩ').some(entry => entry.key === 'view:map'));
  assert(filterEntries(s.api.getEntries(), 'ばくふ').some(entry => entry.key === 'action:shogunate'));
  assert(filterEntries(s.api.getEntries(), '帰還 予定').some(entry => entry.key === 'action:command-activity'));
  assert(filterEntries(s.api.getEntries(), '比較').some(entry => entry.key === 'view:officers'));
  assert(filterEntries(s.api.getEntries(), 'ふしん').some(entry => entry.key === 'view:facilities' && entry.group === '城と内政'));
  assert(filterEntries(s.api.getEntries(), '育成').some(entry => entry.key === 'view:town'));
  assert(filterEntries(s.api.getEntries(), 'ぐんし').some(entry => entry.key === 'view:council'));
  for (const key of ['view:map', 'view:field', 'view:roaming', 'action:events']) assert(filterEntries(s.api.getEntries(), '戦い').some(entry => entry.key === key));
  input.value = '軍師 ＡＩ'; input.dispatch('input'); assert(s.get('#navigation-results').textContent.includes('天下地図'));
  assert.equal(s.doc.activeElement, input); assert.equal(s.get('#navigation-query'), input);
  input.value = '<script>bad()</script>'; input.dispatch('input'); assert(s.get('#navigation-results').textContent.includes('見つかりません'));
  assert.equal(s.get('#navigation-results').querySelector('script'), null);
  s.get('[data-navigation-clear]').click(); assert.equal(input.value, ''); assert.equal(s.doc.activeElement, input);
});

test('a new search or clearing a query starts at the first match while refresh retains a focused guide link', () => {
  const s = fixture(); s.api.open();
  const query = s.get('#navigation-query'), results = s.get('#navigation-results');
  assert.equal(s.get('.navigation-favorites'), null);
  results.scrollTop = 360; query.value = '城'; query.dispatch('input');
  assert.equal(results.scrollTop, 0);
  results.scrollTop = 76; s.get('[data-navigation-clear]').click();
  assert.equal(results.scrollTop, 0); assert.equal(s.doc.activeElement, query);
  const guide = results.querySelector('[data-navigation-help="help:guide"]');
  guide.focus(); results.scrollTop = 245; s.api.toggleFavorite('view:map');
  assert.equal(s.doc.activeElement.getAttribute('data-navigation-help'), 'help:guide');
  assert.equal(results.scrollTop, 245); assert(s.get('.navigation-favorites'));
});

test('the menu retains combined filters and scroll on reopening and explicitly clears all conditions', () => {
  const s = fixture(); s.api.open();
  const category = s.get('#navigation-category'), query = s.get('#navigation-query'), results = s.get('#navigation-results');
  category.value = '合戦と天下'; category.dispatch('change');
  assert(results.querySelector('[data-navigation-target="view:map"]'));
  assert.equal(results.querySelector('[data-navigation-target="view:officers"]'), null);
  query.value = '派遣'; query.dispatch('input'); assert(results.querySelector('[data-navigation-target="view:covert"]'));
  assert.equal(results.querySelector('[data-navigation-target="view:map"]'), null);
  results.scrollTop = 145; s.api.close(); s.api.open();
  assert.equal(category.value, '合戦と天下'); assert.equal(query.value, '派遣'); assert.equal(results.scrollTop, 145);
  assert(results.querySelector('[data-navigation-target="view:covert"]'));
  s.get('[data-navigation-reset]').click(); assert.equal(category.value, ''); assert.equal(query.value, '');
  assert.equal(results.scrollTop, 0); assert(results.querySelector('[data-navigation-target="view:officers"]'));
  assert.equal(s.doc.activeElement, query); assert(s.get('[data-navigation-reset]').disabled);
});

test('choosing a page delegates exactly once to its original control and updates the quick dock', () => {
  const s = fixture(); s.api.open(); s.get('[data-navigation-target="view:army"]').click(); s.drain();
  assert.deepEqual(s.calls, ['view:army']); assert.equal(s.api.isOpen(), false); assert.equal(s.main.getAttribute('data-view'), 'army');
  assert.equal(s.get('[data-navigation-quick="view:army"]').getAttribute('aria-current'), 'page');
  assert.equal(s.get('[data-navigation-quick="view:town"]').getAttribute('aria-current'), null);
  assert.equal(s.doc.activeElement, s.main);
  s.get('[data-navigation-quick="view:town"]').click(); s.drain(); assert.deepEqual(s.calls, ['view:army', 'view:town']);
});

test('disabled, removed and unknown routes cannot execute stale controls', () => {
  const s = fixture(); s.api.open(); const source = s.nav.querySelector('[data-view="army"]'); source.disabled = true;
  assert.equal(s.api.activate('view:army'), false); assert.deepEqual(s.calls, []); assert(s.api.isOpen());
  source.remove(); assert.equal(s.api.activate('view:army'), false); assert.equal(s.api.activate('action:attack'), false);
  assert.deepEqual(s.calls, []); s.api.refresh(); assert.equal(s.get('[data-navigation-quick="view:army"]'), null);
  assert(!s.api.getDock().includes('view:army')); assert.deepEqual(s.calls, []);
});

test('new source destinations remain discoverable without maintaining a second route list', () => {
  const s = fixture(); const node = s.source(s.nav, 'action', 'future-feature', '新しい機能');
  s.api.refresh(); assert(s.api.getEntries().some(entry => entry.key === 'action:future-feature')); s.api.open();
  s.get('[data-navigation-target="action:future-feature"]').click(); assert.deepEqual(s.calls, ['action:future-feature']); assert(node.isConnected);
});

test('keyboard shortcuts respect title/loading, other dialogs and editing fields', () => {
  const s = fixture();
  for (const cls of ['at-title', 'is-loading']) { s.doc.body.classList.add(cls); assert.equal(s.key().prevented, false); assert.equal(s.api.isOpen(), false); s.doc.body.classList.remove(cls); }
  s.app.inert = true; assert.equal(s.key().prevented, false); s.app.inert = false;
  const other = s.doc.createElement('dialog'); s.doc.body.append(other); other.showModal(); assert.equal(s.key().prevented, false); other.close();
  const input = s.doc.createElement('input'); s.doc.body.append(input); input.focus(); assert.equal(s.key().prevented, false);
  s.doc.body.focus(); assert.equal(s.key({ ctrlKey: false, metaKey: true }).prevented, true); assert(s.api.isOpen());
});

test('touch opening avoids the software keyboard and closing restores the initiating control', () => {
  const s = fixture({ touch: true }), trigger = s.get('[data-navigation-quick="menu"]'); trigger.focus(); trigger.click();
  assert(s.api.isOpen()); assert.equal(s.doc.activeElement, s.get('[data-navigation-close]'));
  s.get('[data-navigation-close]').click(); assert.equal(s.doc.activeElement, trigger); assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  trigger.click(); s.get('#navigation-dialog').close(); assert.equal(s.doc.activeElement, trigger);
});

test('opening another feature dialog never steals its focus on menu close', () => {
  const s = fixture(), other = s.doc.createElement('dialog'), confirm = s.doc.createElement('button'); other.append(confirm); s.doc.body.append(other);
  s.nav.querySelector('[data-action="events"]').addEventListener('click', () => { other.showModal(); confirm.focus(); });
  s.api.open(); s.get('[data-navigation-target="action:events"]').click(); s.drain();
  assert.deepEqual(s.calls, ['action:events']); assert(other.open); assert.equal(s.doc.activeElement, confirm); assert.equal(s.api.isOpen(), false);
});

test('compact destinations scroll below sticky headers once after loading completes', () => {
  const s = fixture({ touch: true }), finish = delayedNavigation(s);
  s.api.refresh(); s.drain(); assert.equal(s.scrolls.length, 0); assert.equal(s.frames.size, 0);
  finish(); assert.deepEqual(s.scrolls, [{ block: 'start', behavior: 'instant' }]); assert.equal(s.doc.activeElement, s.main);
  s.api.refresh(); s.api.refresh(); s.drain(); assert.equal(s.scrolls.length, 1, 'A later redraw must not replay navigation');
});

test('manual scrolling or new user intent cancels deferred scroll and focus', () => {
  for (const event of ['wheel', 'touchmove', 'pointerdown', 'keydown']) {
    const s = fixture({ touch: true }), finish = delayedNavigation(s), focus = s.doc.createElement('button'); s.doc.body.append(focus); focus.focus();
    s.doc.dispatch(event, s.main, event === 'keydown' ? { key: 'PageDown' } : {}); finish();
    assert.equal(s.scrolls.length, 0, event); assert.equal(s.doc.activeElement, focus, event);
  }
});

test('changed routes, title and recovery dialogs cancel pending navigation permanently', () => {
  for (const reason of ['route', 'title', 'recovery', 'dialog']) {
    const s = fixture(), finish = delayedNavigation(s), focus = s.doc.createElement('button'); s.doc.body.append(focus); focus.focus();
    if (reason === 'route') { s.main.setAttribute('data-view', 'map'); s.api.refresh(); s.main.setAttribute('data-view', 'army'); }
    if (reason === 'title') { s.doc.body.classList.add('at-title'); s.api.refresh(); s.doc.body.classList.remove('at-title'); }
    if (reason === 'recovery') {
      const recovery = s.doc.createElement('section'); recovery.setAttribute('role', 'dialog'); recovery.setAttribute('aria-modal', 'true'); recovery.append(focus); s.doc.body.append(recovery);
      s.doc.dispatch('focusin', focus); recovery.remove(); s.doc.body.append(focus); focus.focus();
    }
    if (reason === 'dialog') { const other = s.doc.createElement('dialog'); s.doc.body.append(other); other.showModal(); s.api.refresh(); other.close(); }
    finish(); assert.equal(s.scrolls.length, 0, reason); assert.equal(s.doc.activeElement, focus, reason);
  }
});

test('desktop navigation focuses its pane without scrolling the document', () => {
  const s = fixture(); s.doc.documentElement.classList.add('sengoku-desktop-fit'); const finish = delayedNavigation(s);
  finish(); assert.equal(s.scrolls.length, 0); assert.equal(s.doc.activeElement, s.main); assert.equal(s.frames.size, 0);
});

test('public help links preserve the game in its tab and source labels are escaped', () => {
  const s = fixture(); const unknown = s.source(s.nav, 'action', 'custom', 'temporary'); unknown.children[0].textContent = '<img src=x onerror=bad()>';
  s.api.open(); const links = s.get('#navigation-results').querySelectorAll('a');
  assert.equal(links.length, 3); assert(links.some(link => link.getAttribute('href') === 'sengoku-vs/#share')); for (const link of links) { assert.equal(link.getAttribute('target'), '_blank'); assert.equal(link.getAttribute('rel'), 'noopener'); }
  assert.equal(s.get('#navigation-results').querySelector('img'), null); assert.deepEqual(s.calls, []);
});

test('unsupported dialog and teardown keep original navigation available', () => {
  const unsupported = fixture({ unsupported: true }); assert.equal(unsupported.api, null); assert(!unsupported.doc.documentElement.classList.contains('sengoku-navigation-ready')); assert.equal(unsupported.nav.children.length, views.length + actions.length);
  const s = fixture(); s.api.open(); s.api.destroy(); assert(!s.doc.documentElement.classList.contains('sengoku-navigation-ready')); assert.equal(s.get('#navigation-dialog'), null); assert.equal(s.nav.children.length, views.length + actions.length); assert.equal(s.get('.navigation-quick-dock'), null); assert.equal(s.frames.size, 0);
});

test('favorite controls are separate buttons, preserve focus and never execute destinations', () => {
  const s = fixture(); s.api.open(); const pin = s.get('[data-navigation-pin="view:army"]');
  assert.equal(pin.tagName, 'BUTTON'); assert.equal(pin.getAttribute('type'), 'button');
  assert.equal(pin.parentElement.tagName, 'DIV'); assert.equal(pin.querySelector('button'), null);
  assert.equal(pin.getAttribute('aria-pressed'), 'false'); pin.focus(); s.get('#navigation-results').scrollTop = 120; pin.click();
  assert.deepEqual(s.calls, []); assert(s.api.isOpen()); assert.deepEqual(s.api.getPreferences().favorites, ['view:army']);
  assert.equal(s.doc.activeElement.getAttribute('data-navigation-pin'), 'view:army'); assert.equal(s.doc.activeElement.getAttribute('aria-pressed'), 'true');
  assert.equal(s.doc.activeElement.closest('[data-navigation-scope]').getAttribute('data-navigation-scope'), 'all');
  assert.equal(s.get('#navigation-results').scrollTop, 120);
  const favoritePin = s.get('.navigation-favorites').querySelector('[data-navigation-pin="view:army"]'); favoritePin.focus(); favoritePin.click();
  assert.deepEqual(s.api.getPreferences().favorites, []); assert.equal(s.doc.activeElement.getAttribute('data-navigation-pin'), 'view:army');
  assert.equal(s.doc.activeElement.getAttribute('aria-pressed'), 'false'); assert.deepEqual(s.calls, []);
});

test('favorites are capped at six and restore from preferences without storing game state', () => {
  const s = fixture(); s.api.open(); const keys = views.slice(0, 7).map(([key]) => 'view:' + key);
  for (const key of keys.slice(0, 6)) assert(s.api.toggleFavorite(key));
  assert.equal(s.api.toggleFavorite(keys[6]), false); assert(s.get('#navigation-result-status').textContent.includes('6件まで'));
  assert.deepEqual(s.api.getPreferences().favorites, keys.slice(0, 6)); assert.deepEqual(s.calls, []);
  const next = fixture({ storage: s.storage }); next.api.open(); assert.deepEqual(next.api.getPreferences().favorites, keys.slice(0, 6));
  assert.equal(next.get('.navigation-favorites').querySelectorAll('[data-navigation-pin]').length, 6);
  assert(next.api.toggleFavorite(keys[0])); assert(next.api.toggleFavorite(keys[6]));
  assert.deepEqual(next.api.getPreferences().favorites, keys.slice(1, 7)); assert.equal(s.storage.size, 1);
});

test('unknown, hidden and removed sources never appear through saved favorites or recent history', () => {
  const storage = new Map([[preferenceKey, JSON.stringify({ favorites: ['action:staff-hidden', 'view:army', 'view:town', 'view:army', '<img>'], recent: ['action:staff-hidden', 'view:army', 'view:map'] })]]);
  const s = fixture({ storage }); s.nav.querySelector('[data-view="army"]').hidden = true;
  s.nav.querySelector('[data-view="map"]').remove(); s.api.open();
  assert.deepEqual(s.api.getPreferences(), { favorites: ['view:town'], recent: [] });
  assert(!s.get('#navigation-results').textContent.includes('staff-hidden')); assert.equal(s.get('[data-navigation-pin="view:army"]'), null);
  assert.equal(s.api.toggleFavorite('action:staff-hidden'), false); assert.equal(s.api.activate('view:army'), false); assert.equal(s.api.activate('view:map'), false);
  assert.deepEqual(s.calls, []);
});

test('blocked storage and malformed preferences retain a working in-memory menu', () => {
  const s = fixture({ storageDenied: true }); s.api.open(); assert(s.api.toggleFavorite('view:army'));
  assert.deepEqual(s.api.getPreferences().favorites, ['view:army']); assert(s.get('#navigation-result-status').textContent.includes('この起動中のみ'));
  assert(s.api.activate('view:army')); s.drain(); assert.deepEqual(s.api.getPreferences().recent, ['view:army']);
  s.api.open(); assert(s.api.clearRecent()); assert.deepEqual(s.api.getPreferences().recent, []);
  const malformed = fixture({ storage: new Map([[preferenceKey, '{bad json']]) }); assert(malformed.api.open()); assert.deepEqual(malformed.api.getPreferences(), { favorites: [], recent: [] });
});

test('recent destinations record accepted controls once, deduplicate, cap at five and clear', () => {
  const s = fixture(); const keys = ['view:town', 'view:map', 'view:army', 'view:research', 'view:officers', 'view:crests'];
  for (const key of keys) { assert(s.api.activate(key)); s.drain(); }
  assert.equal(s.storageWrites.length, keys.length, 'A delegated source click must not write twice');
  assert.deepEqual(s.api.getPreferences().recent, [...keys].reverse().slice(0, 5));
  s.nav.querySelector('[data-view="army"]').click(); s.drain(); assert.deepEqual(s.api.getPreferences().recent, ['view:army', 'view:crests', 'view:officers', 'view:research', 'view:map']);
  const before = s.storageWrites.length; s.api.activate('view:army'); s.drain(); assert.equal(s.storageWrites.length, before);
  s.api.open(); s.api.toggleFavorite('view:army'); assert(!s.get('.navigation-recent').textContent.includes('軍団編成'), 'Favorite shortcuts should not be duplicated in recent shortcuts');
  const input = s.get('#navigation-query'); s.get('[data-navigation-clear-recent]').click(); assert.deepEqual(s.api.getPreferences().recent, []); assert.equal(s.doc.activeElement, input);
  assert.deepEqual(s.api.getPreferences().favorites, ['view:army']); assert.deepEqual(JSON.parse(s.storage.get(preferenceKey)).recent, []);
});

test('failed or disabled navigation does not create recent history and refresh leaves controls attached', () => {
  const s = fixture(); s.api.open(); const source = s.nav.querySelector('[data-view="army"]'); source.disabled = true;
  assert.equal(s.api.activate('view:army'), false); assert.equal(s.api.activate('action:unknown'), false); assert.deepEqual(s.api.getPreferences().recent, []);
  source.disabled = false; source.click = () => {}; assert(s.api.activate('view:army')); s.drain(); assert.deepEqual(s.api.getPreferences().recent, []);
  s.api.open(); const pin = s.get('[data-navigation-pin="view:army"]'), input = s.get('#navigation-query'); pin.focus();
  s.api.refresh(); s.api.refresh(); assert.equal(s.get('[data-navigation-pin="view:army"]'), pin); assert.equal(s.get('#navigation-query'), input); assert.equal(s.doc.activeElement, pin);
});


test('pinned desktop shortcuts delegate to current sources once and disappear when no favorites remain', () => {
  const s = fixture({ storage: new Map([[preferenceKey, JSON.stringify({ favorites: ['view:army', 'view:map'] })]]) });
  const rail = s.get('.navigation-favorites-rail');
  assert.equal(rail.hidden, false);
  assert.equal(rail.querySelectorAll('[data-navigation-favorite]').length, 2);
  rail.querySelector('[data-navigation-favorite="view:army"]').click(); s.drain();
  assert.deepEqual(s.calls, ['view:army']);
  assert.equal(rail.querySelector('[data-navigation-favorite="view:army"]').getAttribute('aria-current'), 'page');
  s.nav.querySelector('[data-view="map"]').disabled = true; s.api.refresh();
  assert(rail.querySelector('[data-navigation-favorite="view:map"]').disabled);
  rail.querySelector('[data-navigation-favorite="view:map"]').click(); assert.deepEqual(s.calls, ['view:army']);
  assert(s.api.toggleFavorite('view:army')); assert(s.api.toggleFavorite('view:map'));
  assert.equal(rail.hidden, true);
});

test('pinned help links preserve normal link behavior and editing opens the existing finder', () => {
  const s = fixture(); assert(s.api.toggleFavorite('help:guide'));
  const rail = s.get('.navigation-favorites-rail'), guide = rail.querySelector('[data-navigation-favorite="help:guide"]');
  assert.equal(guide.tagName, 'A'); assert.equal(guide.getAttribute('href'), 'guide/');
  assert.equal(guide.getAttribute('target'), '_blank'); assert.equal(guide.getAttribute('rel'), 'noopener');
  guide.click(); assert.deepEqual(s.api.getPreferences().recent, ['help:guide']); assert.deepEqual(s.calls, []);
  rail.querySelector('[data-navigation-edit-favorites]').click(); assert(s.api.isOpen());
  s.api.destroy(); assert.equal(s.get('.navigation-favorites-rail'), null);
});

test('search keyboard travel skips disabled entries and leaves text editing native', () => {
  const s = fixture(); s.nav.querySelector('[data-view="army"]').disabled = true; s.api.open();
  const dialog = s.get('#navigation-dialog'), query = s.get('#navigation-query');
  query.value = '軍'; query.dispatch('input'); query.focus();
  const targets = [...s.get('#navigation-results').querySelectorAll('[data-navigation-target], [data-navigation-help]')].filter(node => !node.disabled);
  assert(targets.length > 1);
  const down = dialog.dispatch('keydown', query, { key: 'ArrowDown' }); assert(down.prevented); assert.equal(s.doc.activeElement, targets[0]);
  dialog.dispatch('keydown', targets[0], { key: 'End' }); assert.equal(s.doc.activeElement, targets.at(-1));
  dialog.dispatch('keydown', targets.at(-1), { key: 'Home' }); assert.equal(s.doc.activeElement, targets[0]);
  query.focus(); const home = dialog.dispatch('keydown', query, { key: 'Home' }); assert.equal(home.prevented, false); assert.equal(s.doc.activeElement, query);
  dialog.dispatch('keydown', query, { key: 'ArrowDown', isComposing: true }); assert.equal(s.doc.activeElement, query);
  assert.deepEqual(s.calls, []);
});

test('backdrop dismissal requires a pointer press outside and ignores dialog padding or drags from controls', () => {
  const s = fixture(); s.api.open(); const dialog = s.get('#navigation-dialog');
  dialog.getBoundingClientRect = () => ({ left: 10, right: 800, top: 10, bottom: 600 });
  dialog.dispatch('pointerdown', dialog); dialog.dispatch('click', dialog, { clientX: 15, clientY: 15 }); assert(s.api.isOpen());
  dialog.dispatch('pointerdown', s.get('#navigation-query')); dialog.dispatch('click', dialog, { clientX: 1, clientY: 1 }); assert(s.api.isOpen());
  dialog.dispatch('pointerdown', dialog); dialog.dispatch('click', dialog, { clientX: 1, clientY: 1 }); assert.equal(s.api.isOpen(), false);
  assert.deepEqual(s.calls, []);
});


test('personal dock selections swap duplicate slots, persist and delegate exactly once', () => {
  const s = fixture({ touch: true }); s.api.open();
  const first = s.get('[data-navigation-slot="0"]');
  first.value = 'view:officers'; first.dispatch('change');
  assert.deepEqual(s.api.getDock(), ['view:officers', 'view:map', 'view:army']);
  assert.deepEqual(s.calls, []); assert(s.api.isOpen());
  assert(s.api.setDockSlot(1, 'view:officers'));
  assert.deepEqual(s.api.getDock(), ['view:map', 'view:officers', 'view:army']);
  assert.equal(s.get('[data-navigation-slot="0"]').value, 'view:map');
  assert.equal(s.get('[data-navigation-slot="1"]').value, 'view:officers');
  assert.deepEqual(JSON.parse(s.storage.get(preferenceKey)).dock, ['view:map', 'view:officers', 'view:army']);
  s.api.close(); s.get('[data-navigation-quick="view:officers"]').click(); s.drain();
  assert.deepEqual(s.calls, ['view:officers']);
  assert.equal(s.get('[data-navigation-quick="view:officers"]').getAttribute('aria-current'), 'page');
  const next = fixture({ touch: true, storage: s.storage });
  assert.deepEqual(next.api.getDock(), ['view:map', 'view:officers', 'view:army']);
  next.api.open(); next.get('[data-navigation-reset-dock]').click();
  assert.deepEqual(next.api.getDock(), ['view:town', 'view:map', 'view:army']);
  assert.deepEqual(next.calls, []);
});

test('dock uses only live canonical sources and rejects unavailable or external destinations', () => {
  const s = fixture(); s.api.open();
  for (const [slot,key] of [[-1,'view:map'],[3,'view:map'],[0,'help:guide'],[0,'action:delete-save'],[0,'action:staff-hidden']]) {
    assert.equal(s.api.setDockSlot(slot,key), false);
  }
  s.nav.querySelector('[data-view="officers"]').disabled = true;
  assert.equal(s.api.setDockSlot(0,'view:officers'), false);
  s.nav.querySelector('[data-view="officers"]').disabled = false;
  assert(s.api.setDockSlot(0,'view:officers'));
  s.nav.querySelector('[data-view="officers"]').hidden = true; s.api.refresh();
  assert(!s.api.getDock().includes('view:officers')); assert.equal(s.get('[data-navigation-quick="view:officers"]'), null);
  s.nav.querySelector('[data-view="officers"]').hidden = false; s.api.refresh();
  assert.equal(s.api.getDock()[0], 'view:officers', 'Temporary availability must not destroy the saved preference');
  s.nav.querySelector('[data-view="officers"]').disabled = true; s.api.refresh();
  assert(s.get('[data-navigation-quick="view:officers"]').disabled);
  s.get('[data-navigation-quick="view:officers"]').click(); assert.deepEqual(s.calls, []);
});

test('dock edits respect loading, title and other modal surfaces', () => {
  const s = fixture();
  for (const cls of ['at-title','is-loading']) {
    s.doc.body.classList.add(cls); assert.equal(s.api.setDockSlot(0,'view:officers'), false); assert.equal(s.api.resetDock(), false); s.doc.body.classList.remove(cls);
  }
  const other = s.doc.createElement('dialog'); s.doc.body.append(other); other.showModal();
  assert.equal(s.api.setDockSlot(0,'view:officers'), false); assert.equal(s.api.resetDock(), false);
  assert.deepEqual(s.api.getDock(), ['view:town', 'view:map', 'view:army']); assert.deepEqual(s.calls, []);
});

test('dock accepts legacy preferences and survives malformed or denied storage', () => {
  for (const dock of [['view:map','view:map','view:map'], ['<img>'], ['help:guide','view:map','view:army']]) {
    const s = fixture({ storage: new Map([[preferenceKey, JSON.stringify({ dock })]]) });
    assert.deepEqual(s.api.getDock(), ['view:town', 'view:map', 'view:army']);
  }
  const s = fixture({ storageDenied: true }); s.api.open();
  assert(s.api.setDockSlot(0,'action:events')); assert.deepEqual(s.api.getDock(), ['action:events','view:map','view:army']);
  assert(s.get('#navigation-result-status').textContent.includes('この起動中のみ'));
  assert.deepEqual(s.calls, []);
  s.api.close(); s.get('[data-navigation-quick="action:events"]').click();
  assert.deepEqual(s.calls, ['action:events']);
});

test('purpose choices refine discovery without issuing game commands and reset restores all purposes', () => {
  const s = fixture(); s.api.open();
  const purposes = s.get('.navigation-purpose-row'); assert.equal(purposes.hidden, false);
  s.get('[data-navigation-purpose="battle"]').click();
  assert.equal(s.get('#navigation-category').value, '合戦と天下'); assert.equal(s.get('#navigation-query').value, '戦い');
  assert(s.get('[data-navigation-target="view:roaming"]')); assert.equal(s.get('[data-navigation-target="view:officers"]'), null);
  assert.equal(purposes.hidden, true); assert.deepEqual(s.calls, []);
  s.get('[data-navigation-reset]').click(); assert.equal(purposes.hidden, false);
  s.get('[data-navigation-purpose="records"]').click();
  assert(s.get('[data-navigation-target="action:progress"]')); assert.deepEqual(s.calls, []);
});

test('search prioritizes visible destination names and discovers travel, repair and payroll terms', () => {
  const s = fixture();
  assert.equal(filterEntries(s.api.getEntries(), '城下町')[0].key, 'view:town');
  assert.equal(filterEntries(s.api.getEntries(), '武将')[0].key, 'view:officers');
  for (const term of ['帰還', '移動時間', '到着']) {
    const query = term === '移動時間' ? '移動 時間' : term;
    assert(filterEntries(s.api.getEntries(), query).some(entry => entry.key === 'view:covert'));
  }
  for (const term of ['修復', '給料', '給与']) assert(filterEntries(s.api.getEntries(), term).some(entry => entry.key === 'view:facilities'));
  s.api.open(); const input = s.get('#navigation-query');
  input.value = '武将'; input.dispatch('input');
  const results = s.get('#navigation-results');
  assert.equal(results.querySelector('[data-navigation-target]').getAttribute('data-navigation-target'), 'view:officers');
  assert(results.querySelector('mark')); assert(results.querySelector('.navigation-entry-category'));
  assert(s.get('#navigation-dialog').classList.contains('is-filtered'));
  s.get('[data-navigation-reset]').click(); assert(!s.get('#navigation-dialog').classList.contains('is-filtered'));
  assert.deepEqual(s.calls, []);
});

test('search highlights remain escaped and handle overlapping words and normalized kana safely', () => {
  assert.equal(highlightMatch('軍団編成', '軍 軍団'), '<mark>軍団</mark>編成');
  assert.equal(highlightMatch('セーブを保存', 'せーぶ'), '<mark>セーブ</mark>を保存');
  assert.equal(highlightMatch('ＡＩ軍師', 'ai'), '<mark>ＡＩ</mark>軍師');
  assert.equal(highlightMatch('㍻の記録', '平成'), '㍻の記録');
  const malicious = highlightMatch('<script>alert("x")</script>', 'script');
  assert(!malicious.includes('<script>')); assert(malicious.includes('&lt;<mark>script</mark>&gt;'));
});

test('empty results can expand the category without losing the query or execute a destination', () => {
  const s = fixture(); s.api.open();
  const category = s.get('#navigation-category'), input = s.get('#navigation-query');
  category.value = '城と内政'; category.dispatch('change');
  input.value = '派遣'; input.dispatch('input');
  const recover = s.get('[data-navigation-clear-category]'); assert(recover);
  recover.click(); assert.equal(category.value, ''); assert.equal(input.value, '派遣');
  assert.equal(s.doc.activeElement, input); assert(s.get('[data-navigation-target="view:covert"]'));
  assert.deepEqual(s.calls, []); assert.equal(s.storageWrites.length, 0);
  input.value = '該当しない機能'; input.dispatch('input');
  assert.equal(s.get('[data-navigation-clear-category]'), null);
  s.get('[data-navigation-suggestion="保存"]').click();
  assert.equal(input.value, '保存'); assert.equal(category.value, ''); assert(s.get('[data-navigation-target="action:settings"]'));
  assert.deepEqual(s.calls, []); assert.equal(s.storageWrites.length, 0);
});

test('Enter opens a unique live destination once and never treats IME or ambiguous input as navigation', () => {
  const s = fixture(); s.api.open();
  const input = s.get('#navigation-query'), dialog = s.get('#navigation-dialog'); input.focus();
  for (const query of ['', '軍']) {
    input.value = query; input.dispatch('input');
    assert.equal(dialog.dispatch('keydown', input, { key: 'Enter' }).prevented, false);
  }
  input.value = '軍団編成'; input.dispatch('input');
  for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true }]) {
    assert.equal(dialog.dispatch('keydown', input, { key: 'Enter', ...extra }).prevented, false);
  }
  assert.deepEqual(s.calls, []);
  assert(dialog.dispatch('keydown', input, { key: 'Enter' }).prevented); s.drain();
  assert.deepEqual(s.calls, ['view:army']); assert.equal(s.api.isOpen(), false);
  s.api.open(); input.focus(); input.value = '派遣'; input.dispatch('input');
  s.nav.querySelector('[data-view="covert"]').disabled = true;
  assert.equal(dialog.dispatch('keydown', input, { key: 'Enter' }).prevented, false); assert(s.api.isOpen());
  assert.deepEqual(s.calls, ['view:army']);
  input.value = '遊び方'; input.dispatch('input');
  assert.equal(dialog.dispatch('keydown', input, { key: 'Enter' }).prevented, false); assert(s.api.isOpen());
});

test('current location and category counts update from visible canonical controls without replacing the input', () => {
  const s = fixture(); s.api.open(); const input = s.get('#navigation-query');
  assert.equal(s.get('#navigation-current-location').textContent, '現在の画面：城下町');
  const destinationCount = s.api.getEntries().length;
  assert(s.get('#navigation-category').textContent.includes(`全分類 · ${destinationCount}項目`));
  s.api.activate('view:army'); s.drain(); s.api.open();
  assert.equal(s.get('#navigation-current-location').textContent, '現在の画面：軍団編成');
  s.nav.querySelector('[data-view="officers"]').hidden = true; s.api.refresh();
  assert(s.get('#navigation-category').textContent.includes(`全分類 · ${destinationCount - 1}項目`));
  assert.equal(s.get('#navigation-query'), input); assert.deepEqual(s.calls, ['view:army']);
});

// Use browser-shaped, shared search storage so canonical navigation tests above
// keep their stricter assertion that ordinary menu actions only read preferences.
function savedSearchFixture(options = {}) {
  const h = fixture(options), data = options.data || new Map();
  const owner = {playerId:'lord-a', campaign:'campaign-a', pending:false};
  h.win.SengokuBridge = {hasStarted: () => true, getState: () => ({walking:{campaignId:owner.campaign}})};
  h.win.SengokuSocial = {getExpansionContext: () => ({playerId:owner.playerId, user:{id:owner.playerId}, pending:owner.pending})};
  const legacy = h.win.localStorage;
  h.win.localStorage = {
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: key => key === preferenceKey ? legacy.getItem(key) : data.get(key) ?? null,
    setItem: (key, value) => key === preferenceKey ? legacy.setItem(key, value) : data.set(key, value),
    removeItem: key => data.delete(key)
  };
  const query = h.get('#navigation-query'), category = h.get('#navigation-category');
  function type(text, group = '') {
    query.value = text; query.dispatch('input'); category.value = group; category.dispatch('change');
  }
  function clear() { h.get('[data-navigation-reset]').click(); }
  return {...h, data, owner, query, category, type, clear};
}

test('an explicit saved search restores its words and category after reload without executing a command', () => {
  const h = savedSearchFixture(); h.api.open();
  h.type('移動時間', '合戦と天下'); assert.equal(h.data.size, 0);
  h.get('[data-filter-save]').click(); assert.equal(h.data.size, 1);
  assert(h.get('[data-filter-save]').disabled);
  const next = savedSearchFixture({data:h.data, touch:true}); next.api.open();
  const recall = next.get('[data-filter-recall]'); assert(recall); recall.click();
  assert.equal(next.query.value,'移動時間'); assert.equal(next.category.value,'合戦と天下');
  assert(next.get('[data-navigation-target="view:covert"]')); assert.deepEqual(next.calls,[]);
  assert(next.doc.activeElement.hasAttribute('data-navigation-target'));
});

test('saved conditions retain other tabs’ independent changes and reload normalized duplicates only once', () => {
  const a = savedSearchFixture(), b = savedSearchFixture({data:a.data});
  a.api.open(); b.api.open(); a.type('ブショウ'); a.get('[data-filter-save]').click();
  b.type('施設'); b.get('[data-filter-save]').click(); assert.equal(a.data.size,2);
  a.clear(); a.doc.dispatch.call(a.win,'storage', null, {key:[...a.data.keys()].at(-1)});
  assert.equal(a.get('#navigation-results').querySelectorAll('[data-filter-recall]').length,2);
  a.type('ぶしょう'); assert(a.get('[data-filter-save]').disabled);
  a.clear(); a.get('[data-filter-remove]').click(); assert.equal(a.data.size,1);
  b.clear(); b.doc.dispatch.call(b.win,'storage', null, {key:null}); assert.equal(b.get('#navigation-results').querySelectorAll('[data-filter-recall]').length,1);
});

test('saved search actions check fresh identity and visible sources, including detached or blocked controls', () => {
  const h = savedSearchFixture(); h.api.open(); h.type('派遣'); h.get('[data-filter-save]').click(); h.clear();
  const original = h.get('[data-filter-recall]'); h.owner.playerId = 'lord-b'; original.click();
  assert.equal(h.query.value,''); assert.equal(h.get('[data-filter-recall]'),null); assert.deepEqual(h.calls,[]);
  h.owner.playerId = 'lord-a'; h.owner.campaign = 'campaign-b'; h.api.refresh(); assert.equal(h.get('[data-filter-recall]'),null);
  h.owner.campaign = 'campaign-a'; h.api.refresh(); const fresh = h.get('[data-filter-recall]'); assert(fresh);
  const other = h.doc.createElement('dialog'); h.doc.body.append(other); other.showModal(); fresh.click(); assert.equal(h.query.value,''); other.close();
  h.nav.querySelector('[data-view="covert"]').hidden = true; fresh.click(); assert.equal(h.get('[data-navigation-target="view:covert"]'),null);
  h.clear(); h.owner.pending = true; h.api.refresh(); assert.equal(h.get('[data-filter-recall]'),null);
  h.owner.pending = false; h.owner.campaign = 'legacy_v1'; h.type('守備'); assert.equal(h.get('[data-filter-save]'),null);
});

test('IME text is only reflected after composition, malformed storage and inaccessible writes stay harmless', () => {
  const h = savedSearchFixture(); h.api.open();
  h.query.dispatch('compositionstart'); h.query.value='家臣'; h.query.dispatch('input');
  h.api.refresh(); assert.equal(h.get('[data-filter-save]'),null);
  h.query.focus(); const enter = h.get('#navigation-dialog').dispatch('keydown',h.query,{key:'Enter'});
  assert.equal(enter.prevented,false); assert.deepEqual(h.calls,[]);
  h.query.dispatch('compositionend'); assert(h.get('[data-filter-save]')); h.get('[data-filter-save]').click();
  const key = [...h.data.keys()][0]; h.data.set(key + 'invalid','{'); h.data.set(key + 'wrong','["武将","unknown"]');
  h.clear(); h.api.close(); h.api.open(); assert.equal(h.get('#navigation-results').querySelectorAll('[data-filter-recall]').length,1);
  h.type('<img src=x>'); const write = h.win.localStorage.setItem; h.win.localStorage.setItem = () => {throw Error('quota');};
  h.get('[data-filter-save]').click(); assert(h.get('#navigation-result-status').textContent.includes('更新できません'));
  h.win.localStorage.setItem = write; h.get('[data-filter-save]').click(); h.clear();
  assert.equal(h.get('#navigation-results').querySelector('img'),null); assert(h.get('#navigation-results').textContent.includes('<img src=x>'));
});

let failed = 0;
for (const [name, run] of tests) { try { run(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.stack); } }
console.log(`${tests.length - failed}/${tests.length} navigation usability checks passed`);
if (failed) process.exitCode = 1;
