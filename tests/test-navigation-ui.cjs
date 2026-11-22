/* Exercise the actual menu controller against canonical game controls. */
'use strict';
const assert = require('node:assert/strict');
const { createNavigationUI, normalizeQuery, filterEntries } = require('../navigation-ui.js');
const { documentFixture } = require('./test-events-ui.cjs');
const tests = [], test = (name, run) => tests.push([name, run]);
const views = [['town', '城下町'], ['map', '天下地図'], ['field', '共通フィールド'], ['roaming', '野良兵戦'], ['covert', '派遣部隊'], ['court', '京都御所'], ['officers', '武将名鑑'], ['crests', '家紋帳'], ['army', '軍団編成'], ['research', '技術研究'], ['council', '軍議']];
const actions = [['events', '期間限定合戦'], ['progress', '成長手帳'], ['alliance-strategy', '同盟作戦'], ['conquest', '共有天下統一'], ['shogunate', '幕府の記録']];
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
  const entries = s.api.getEntries(); assert.equal(entries.length, 23);
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
  assert(filterEntries(s.api.getEntries(), '育成').some(entry => entry.key === 'view:town'));
  assert(filterEntries(s.api.getEntries(), 'ぐんし').some(entry => entry.key === 'view:council'));
  for (const key of ['view:map', 'view:field', 'view:roaming', 'action:events']) assert(filterEntries(s.api.getEntries(), '戦い').some(entry => entry.key === key));
  input.value = '軍師 ＡＩ'; input.dispatch('input'); assert(s.get('#navigation-results').textContent.includes('天下地図'));
  assert.equal(s.doc.activeElement, input); assert.equal(s.get('#navigation-query'), input);
  input.value = '<script>bad()</script>'; input.dispatch('input'); assert(s.get('#navigation-results').textContent.includes('見つかりません'));
  assert.equal(s.get('#navigation-results').querySelector('script'), null);
  s.get('[data-navigation-clear]').click(); assert.equal(input.value, ''); assert.equal(s.doc.activeElement, input);
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
  assert.deepEqual(s.calls, []); s.api.refresh(); assert(s.get('[data-navigation-quick="view:army"]').disabled);
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
  assert.equal(links.length, 2); for (const link of links) { assert.equal(link.getAttribute('target'), '_blank'); assert.equal(link.getAttribute('rel'), 'noopener'); }
  assert.equal(s.get('#navigation-results').querySelector('img'), null); assert.deepEqual(s.calls, []);
});

test('unsupported dialog and teardown keep original navigation available', () => {
  const unsupported = fixture({ unsupported: true }); assert.equal(unsupported.api, null); assert(!unsupported.doc.documentElement.classList.contains('sengoku-navigation-ready')); assert.equal(unsupported.nav.children.length, 16);
  const s = fixture(); s.api.open(); s.api.destroy(); assert(!s.doc.documentElement.classList.contains('sengoku-navigation-ready')); assert.equal(s.get('#navigation-dialog'), null); assert.equal(s.nav.children.length, 16); assert.equal(s.get('.navigation-quick-dock'), null); assert.equal(s.frames.size, 0);
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

let failed = 0;
for (const [name, run] of tests) { try { run(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.stack); } }
console.log(`${tests.length - failed}/${tests.length} navigation usability checks passed`);
if (failed) process.exitCode = 1;
