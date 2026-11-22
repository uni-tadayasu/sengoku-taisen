'use strict';
// Pure fixtures only: no real checkout, account, storage or game save.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../premium-catalog.js');
const { renderCatalog, createUI, normalizeContext, expiryLabel } = require('../premium.js');
const root = path.resolve(__dirname, '..');
const tests = [], test = (name, run) => tests.push([name, run]);
const paymentBases = { 'gold-banner': 'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04', 'moonlit-castle': 'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05', supporter: 'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06' };
const checkoutURL = (id, reference = 'a'.repeat(32)) => paymentBases[id] + '?client_reference_id=' + reference;
const drain = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const decode = value => String(value).replace(/&(?:amp|lt|gt|quot|#39);/g, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[entity]));
class Element {
  constructor(tag, document) {
    this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null;
    this.attributes = {}; this.events = {}; this.id = ''; this.className = ''; this._text = ''; this._disabled = false; this.open = false; this.modalCalls = 0;
  }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'id') this.id = String(value); if (name === 'class') this.className = String(value); if (name === 'disabled') this._disabled = true; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
  get disabled() { return this._disabled; }
  set disabled(value) { this._disabled = Boolean(value); if (this._disabled) this.attributes.disabled = ''; else delete this.attributes.disabled; }
  get isConnected() { return this === this.document.body || this.document.body.contains(this); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this._text = String(value); for (const node of [...this.children]) node.remove(); }
  set innerHTML(html) {
    this._text = ''; for (const node of [...this.children]) node.remove();
    const stack = [this];
    for (const part of String(html).match(/<[^>]*>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; }
      if (!part.startsWith('<')) { stack.at(-1)._text += decode(part); continue; }
      const match = /^<([a-zA-Z0-9-]+)([\s\S]*?)\/?\s*>$/.exec(part); if (!match) continue;
      const node = new Element(match[1], this.document);
      for (const attr of match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], decode(attr[2] || ''));
      stack.at(-1).append(node);
      if (!part.endsWith('/>') && !['IMG', 'INPUT', 'BR', 'HR', 'META', 'LINK'].includes(node.tagName)) stack.push(node);
    }
  }
  append(node) { node.remove(); node.parentElement = this; this.children.push(node); return node; }
  remove() { if (!this.parentElement) return; if (this.contains(this.document.activeElement)) this.document.activeElement = this.document.body; const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector === '*') return true;
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    const attr = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attr) return this.hasAttribute(attr[1]) && (attr[2] === undefined || this.getAttribute(attr[1]) === attr[2]);
    return this.tagName === selector.toUpperCase();
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [node, ...node.querySelectorAll('*')]).filter(node => node.matches(selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(item => item !== handler); }
  dispatch(type, target = this, extra = {}) { const event = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; }, ...extra }; for (const handler of this.events[type] || []) handler(event); return event; }
  focus() { this.document.activeElement = this; }
  showModal() { this.modalCalls++; this.open = true; }
  close() { this.open = false; if (!this.deferCloseEvent) this.dispatch('close'); }
  scrollIntoView() {}
}
function documentFixture() {
  const doc = { readyState: 'complete', createElement: tag => new Element(tag, doc) };
  doc.body = doc.createElement('body'); doc.activeElement = doc.body;
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  const entry = doc.createElement('button'); doc.body.append(entry); entry.focus();
  return { doc, entry };
}

const userA = { id: 'u_' + '1'.repeat(32), name: '一城の領主' }, userB = { id: 'u_' + '2'.repeat(32), name: '次の領主' };
function ready(extra = {}) {
  return { status: 'ready', ready: true, user: userA, products: catalog.getProducts().map(product => ({ id: product.id, owned: false, equipped: false, expiresAt: null, canPurchase: true })), appearance: { nameplate: null, town: null, badge: null }, portalUrl: '', error: '', ...extra };
}
function setup(initial = ready(), options = {}) {
  const { doc, entry } = documentFixture(), listeners = new Set(), windows = [], calls = [];
  let context = initial, checkout = async id => ({ productId: id, url: checkoutURL(id) }), equip = async (id, slot) => {
    const changed = catalog.getProducts().find(product => product.slot === slot)?.id;
    context = { ...context, products: context.products.map(product => product.id === changed ? { ...product, equipped: Boolean(id) } : product) };
    for (const listener of listeners) listener(context); return context;
  };
  const runtime = {
    getContext: () => context,
    refresh: async () => { calls.push(['refresh']); return context; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    checkout(id) { calls.push(['checkout', id]); return checkout(id); },
    equip(id, slot) { calls.push(['equip', id, slot]); return equip(id, slot); },
    openRegistration() { calls.push(['register']); }
  };
  const openWindow = () => {
    if (options.blockPopup) return null;
    const win = { location: { href: 'about:blank' }, opener: {}, closed: false, close() { this.closed = true; } }; windows.push(win); return win;
  };
  const ui = createUI({ document: doc, catalog, runtime, openWindow });
  const get = selector => doc.querySelector(selector);
  function click(selector) {
    const element = get(selector); assert(element, 'Missing UI control: ' + selector);
    const host = element.hasAttribute('data-premium-preview') ? get('[data-premium-catalog]') : get('#premium-modal'); host.dispatch('click', element);
  }
  return { doc, entry, ui, runtime, windows, calls, get, click, listeners, context: () => context,
    set(value) { context = value; for (const listener of listeners) listener(context); },
    onCheckout(fn) { checkout = fn; }, onEquip(fn) { equip = fn; }
  };
}
function assertUnavailable(container) {
  assert.equal(container.querySelectorAll('[data-premium-equip]').length, 0);
  const buttons = container.querySelectorAll('[data-premium-purchase]'); assert.equal(buttons.length, 3);
  for (const button of buttons) { assert.equal(button.tagName, 'BUTTON'); assert.equal(button.disabled, true); assert.equal(button.getAttribute('href'), null); }
}

test('the three finished products have fixed prices, real artwork and no gameplay benefit', () => {
  assert.deepEqual(catalog.getProducts().map(product => [product.id, product.priceYen, product.billingPeriod, product.slot]), [
    ['gold-banner', 480, 'one_time', 'nameplate'], ['moonlit-castle', 980, 'one_time', 'town'], ['supporter', 780, 'month', 'badge']
  ]);
  for (const product of catalog.getProducts()) {
    assert.equal(product.taxIncluded, true); assert.equal(product.priceIsTentative, false); assert.equal(product.transferable, false); assert.equal(product.gameplayBenefits, false);
    assert(fs.existsSync(path.join(root, product.art.src))); assert.equal(product.purchaseUrl, undefined);
    assert.equal(catalog.getPurchaseState({ ...product, availability: 'available', purchaseUrl: checkoutURL(product.id) }, { launchEnabled: true }).enabled, false);
  }
  const before = JSON.stringify(catalog.getProducts()), copy = catalog.getProduct('gold-banner'); copy.art.src = 'https://invalid.example/art'; copy.benefits.push('優遇'); copy.priceYen = 1;
  assert.equal(JSON.stringify(catalog.getProducts()), before); assert.equal(catalog.getConfig().checkoutRequiresAccount, true);
});

test('only the correct product destination with one opaque reference is accepted', () => {
  for (const id of Object.keys(paymentBases)) assert.equal(catalog.checkoutURL(id, checkoutURL(id)), checkoutURL(id));
  for (const value of [paymentBases['gold-banner'], checkoutURL('moonlit-castle'), checkoutURL('gold-banner') + '&email=private@example.test', checkoutURL('gold-banner') + '&client_reference_id=' + 'b'.repeat(32), checkoutURL('gold-banner') + '#success', checkoutURL('gold-banner', 'short'), checkoutURL('gold-banner', 'a'.repeat(201)), checkoutURL('gold-banner', 'user@example.test'), 'javascript:alert(1)', '/checkout', 'https://user:password@buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04?client_reference_id=' + 'a'.repeat(32), 'https://checkout.example.test/?client_reference_id=' + 'a'.repeat(32), checkoutURL('gold-banner') + '\n', checkoutURL('gold-banner').replace('https:', 'http:')]) assert.equal(catalog.checkoutURL('gold-banner', value), '', String(value));
  assert.equal(catalog.checkoutURL('unknown', checkoutURL('gold-banner')), '');
});

test('the public page renders real artwork and game entry links, without direct checkout or ownership', () => {
  const html = renderCatalog({ catalog, surface: 'public', assetPrefix: '../', gamePrefix: '../', context: ready({ products: [{ id: 'gold-banner', owned: true, equipped: true }] }) });
  const { doc } = documentFixture(), section = doc.createElement('section'); section.innerHTML = html; doc.body.append(section);
  const links = section.querySelectorAll('[data-premium-purchase]'); assert.equal(links.length, 3);
  for (const [index, product] of catalog.getProducts().entries()) { assert.equal(links[index].tagName, 'A'); assert.equal(links[index].getAttribute('href'), '../?premium=' + product.id); assert(html.includes('../' + product.art.src)); }
  assert.doesNotMatch(html, /buy\.stripe\.com|data-premium-equip|data-premium-account|予定価格|販売準備中/);
  assert.match(section.textContent, /月額780円（税込）で自動更新/); assert.match(section.textContent, /現在の利用期間の末日/);
  const ui = createUI({ document: doc, catalog, runtime: { getContext() { throw Error('Public page must not read account state'); } } });
  ui.mount(section); const preview = section.querySelector('[data-premium-catalog]');
  preview.dispatch('click', preview.querySelector('[data-premium-preview="gold-banner"]'));
  assert.equal(preview.getAttribute('data-premium-selected'), 'gold-banner'); assert.equal(preview.querySelector('[data-premium-landscape]').getAttribute('src'), '../assets/castle-town.webp?v=4.9.3-20261123');
  preview.dispatch('click', preview.querySelector('[data-premium-preview="moonlit-castle"]'));
  assert.equal(preview.querySelector('[data-premium-landscape]').getAttribute('src'), '../assets/premium/moonlit-castle-v1.webp'); ui.dispose();
});

test('loading, unready, anonymous, offline, error and banned states never allow purchase or equip', async () => {
  for (const state of [...['loading', 'anonymous', 'offline', 'error', 'banned'].map(status => ({ status, ready: true })), { status: 'ready', ready: false }]) {
    const s = setup(ready({ ...state, products: catalog.getProducts().map(product => ({ id: product.id, owned: true, equipped: true, canPurchase: true })) })); s.ui.open(); await drain();
    assertUnavailable(s.get('#premium-modal')); s.click('[data-premium-preview="supporter"]'); s.click('[data-premium-purchase="supporter"]');
    assert.equal(s.calls.some(call => ['checkout', 'equip'].includes(call[0])), false); assert.equal(s.windows.length, 0); s.ui.dispose();
  }
  const s = setup({ status: 'anonymous', ready: false, user: null }); s.ui.open(); await drain(); s.click('[data-premium-ui="register"]'); assert.equal(s.ui.isOpen(), false); assert(s.calls.some(call => call[0] === 'register')); s.ui.dispose();
});

test('purchase confirmation names the account and subscription terms before a checkout request', async () => {
  const s = setup(); s.ui.open('supporter'); await drain();
  assert.equal(s.get('[data-premium-catalog]').getAttribute('data-premium-selected'), 'supporter');
  s.click('[data-premium-purchase="supporter"]'); const confirmation = s.get('[data-premium-confirm]');
  assert.match(confirmation.textContent, /一城の領主/); assert(confirmation.textContent.includes(userA.id)); assert.match(confirmation.textContent, /780円 \/ 月（税込）/); assert.match(confirmation.textContent, /自動更新/); assert.match(confirmation.textContent, /期間の末日/);
  assert.equal(s.calls.filter(call => call[0] === 'checkout').length, 0); assert.equal(s.windows.length, 0);
  const wait = deferred(); s.onCheckout(() => wait.promise); s.click('[data-premium-ui="checkout"]');
  assert.equal(s.windows.length, 1); assert.equal(s.windows[0].location.href, 'about:blank'); assert.equal(s.windows[0].opener, null);
  s.click('[data-premium-ui="checkout"]'); assert.equal(s.calls.filter(call => call[0] === 'checkout').length, 1);
  wait.resolve({ productId: 'supporter', url: checkoutURL('supporter') }); await drain();
  assert.equal(s.windows[0].location.href, checkoutURL('supporter')); assert.equal(s.context().products.find(product => product.id === 'supporter').owned, false);
  assert.match(s.get('[data-premium-feedback]').textContent, /購入状態を再確認/); assert.equal(s.get('[data-premium-purchase="supporter"]').disabled, false); s.ui.dispose();
});

test('blocked popups expose an explicit validated continuation link without granting anything', async () => {
  const s = setup(ready(), { blockPopup: true }); s.ui.open(); await drain(); s.click('[data-premium-purchase="gold-banner"]'); s.click('[data-premium-ui="checkout"]'); await drain();
  const link = s.get('.premium-checkout-continuation'); assert(link); assert.equal(link.getAttribute('href'), checkoutURL('gold-banner')); assert.equal(link.getAttribute('rel'), 'noopener noreferrer'); assert.equal(s.context().products[0].owned, false); s.ui.dispose();
});

test('incorrect checkout URLs and errors close the empty tab and leave the account unowned', async () => {
  for (const response of [{ productId: 'gold-banner', url: paymentBases['gold-banner'] }, { productId: 'supporter', url: checkoutURL('supporter') }, new Error('購入先を確認できません')]) {
    const s = setup(); s.onCheckout(async () => { if (response instanceof Error) throw response; return response; }); s.ui.open(); await drain(); s.click('[data-premium-purchase="gold-banner"]'); s.click('[data-premium-ui="checkout"]'); await drain();
    assert.equal(s.windows[0].closed, true); assert.equal(s.get('.premium-checkout-continuation'), null); assert.equal(s.get('[data-premium-feedback]').getAttribute('role'), 'alert'); assert.equal(s.context().products[0].owned, false); assert.equal(s.get('[data-premium-purchase="gold-banner"]').disabled, false); s.ui.dispose();
  }
});

test('an old checkout cannot navigate or close a newer account checkout window', async () => {
  const s = setup(), first = deferred(), second = deferred(); let request = 0;
  s.onCheckout(() => ++request === 1 ? first.promise : second.promise); s.ui.open(); await drain(); s.click('[data-premium-purchase="gold-banner"]'); s.click('[data-premium-ui="checkout"]');
  s.set(ready({ user: userB })); assert.equal(s.windows[0].closed, true); assert.equal(s.get('[data-premium-confirm]').hidden, true); assert(!s.get('[data-premium-account]').textContent.includes(userA.id));
  s.click('[data-premium-purchase="gold-banner"]'); s.click('[data-premium-ui="checkout"]'); assert.equal(s.windows.length, 2);
  first.resolve({ productId: 'gold-banner', url: checkoutURL('gold-banner', 'x'.repeat(32)) }); await drain(); assert.equal(s.windows[1].closed, false); assert.equal(s.windows[1].location.href, 'about:blank');
  second.resolve({ productId: 'gold-banner', url: checkoutURL('gold-banner', 'y'.repeat(32)) }); await drain(); assert.equal(s.windows[1].location.href, checkoutURL('gold-banner', 'y'.repeat(32))); s.ui.dispose();
});

test('server ownership and equip updates preserve previews and details, and no equip is optimistic', async () => {
  const initial = ready(); initial.products[0].owned = true; initial.products[0].canPurchase = false;
  const s = setup(initial), wait = deferred(); s.onEquip(() => wait.promise); s.ui.open(); await drain(); s.click('[data-premium-preview="moonlit-castle"]');
  const details = s.get('.premium-product-details'); details.open = true; s.click('[data-premium-equip="gold-banner"]');
  assert.deepEqual(s.calls.find(call => call[0] === 'equip'), ['equip', 'gold-banner', 'nameplate']); assert.equal(s.context().products[0].equipped, false);
  s.set({ ...s.context(), products: s.context().products.map(product => product.id === 'gold-banner' ? { ...product, equipped: true } : product) }); wait.resolve(s.context()); await drain();
  assert.equal(s.get('[data-premium-equip="gold-banner"]').hasAttribute('data-premium-remove'), true); assert.equal(s.get('[data-premium-catalog]').getAttribute('data-premium-selected'), 'moonlit-castle'); assert.equal(details.open, true);
  s.onEquip(async (id, slot) => { assert.equal(id, null); assert.equal(slot, 'nameplate'); throw Error('装備変更を確認できません'); }); s.click('[data-premium-equip="gold-banner"]'); await drain();
  assert.equal(s.get('[data-premium-equip="gold-banner"]').hasAttribute('data-premium-remove'), true); assert.match(s.get('[data-premium-feedback]').textContent, /装備変更を確認できません/); s.ui.dispose();
});

test('subscription expiry and revocation are presented from the current account response', async () => {
  const initial = ready({ portalUrl: 'https://billing.stripe.com/p/session/test' }); initial.products[2] = { id: 'supporter', owned: true, equipped: true, expiresAt: '2030-01-31T15:00:00.000Z', canPurchase: false };
  const s = setup(initial); s.ui.open('supporter'); await drain(); assert.match(s.get('.premium-expiry').textContent, /2030年2月1日/); assert.match(s.get('.premium-expiry').textContent, /日本時間/); assert(s.get('.premium-contract-link'));
  s.set(ready()); assert.equal(s.get('[data-premium-equip="supporter"]'), null); assert.equal(s.get('[data-premium-catalog]').getAttribute('data-premium-selected'), 'supporter');
  assert.equal(normalizeContext(ready({ portalUrl: 'javascript:alert(1)' })).portalUrl, ''); assert.equal(expiryLabel('invalid'), ''); s.ui.dispose();
});

test('Escape restores the settings opener and queued close does not erase a reopened dialog', async () => {
  const s = setup(); s.ui.open(); await drain(); const dialog = s.get('#premium-modal'), heading = s.get('#premium-dialog-title');
  const escape = dialog.dispatch('keydown', heading, { key: 'Escape' }); assert(escape.prevented && escape.stopped); assert.equal(s.ui.isOpen(), false); assert.equal(s.doc.activeElement, s.entry); assert.equal(s.listeners.size, 0);
  s.ui.open(); await drain(); dialog.deferCloseEvent = true; s.ui.close(); s.ui.open('gold-banner'); await drain(); const reopened = s.get('[data-premium-catalog]'); dialog.dispatch('close');
  assert.equal(s.ui.isOpen(), true); assert.equal(s.get('[data-premium-catalog]'), reopened); assert.equal(reopened.getAttribute('data-premium-selected'), 'gold-banner');
  dialog.deferCloseEvent = false; s.ui.dispose(); assert.equal(s.get('#premium-modal'), null); assert.equal(s.listeners.size, 0);
});

test('the account and purchase confirmation show the matching portrait before the name and rank after it', async () => {
  const savedAvatar = global.SengokuAvatar, savedRank = global.SengokuEvaluationUI;
  global.SengokuAvatar = { markup: (user, size) => `<span class="test-avatar" data-player-avatar="${user.id}" data-avatar-version="${user.avatarVersion || ''}" data-avatar-size="${size}"></span>` };
  global.SengokuEvaluationUI = require('../player-evaluation.js');
  const rank = { version: 1, score: 22000, maxScore: 100000, rankIndex: 4, rankId: 'rank-four', rankName: '正七位' };
  let s;
  try {
    const owner = { ...userA, name: '<領主 & 旗>', avatarVersion: 'a'.repeat(64), evaluation: { ...rank, privateSave: 'secret' } };
    const normalized = normalizeContext(ready({ user: owner })); assert.deepEqual(normalized.user.evaluation, rank); assert(!JSON.stringify(normalized).includes('privateSave'));
    s = setup(ready({ user: owner })); s.ui.open(); await drain(); s.click('[data-premium-purchase="gold-banner"]');
    for (const host of [s.get('[data-premium-account]'), s.get('[data-premium-confirm-user]')]) {
      const identity = host.querySelector('.player-evaluation-person'); assert(identity); assert.equal(identity.children[0].getAttribute('data-player-avatar'), userA.id); assert.equal(identity.children[0].getAttribute('data-avatar-version'), 'a'.repeat(64)); assert.equal(identity.children[1].textContent, owner.name); assert.equal(identity.children[2].getAttribute('data-evaluation-rank'), rank.rankId);
    }
    const confirmation = s.get('[data-premium-confirm]'), checkout = s.get('[data-premium-ui="checkout"]'); checkout.focus();
    s.set(ready({ user: { ...owner, avatarVersion: null, evaluation: null } }));
    assert.equal(s.get('[data-premium-confirm]'), confirmation); assert.equal(s.get('[data-premium-ui="checkout"]'), checkout); assert.equal(s.doc.activeElement, checkout);
    for (const host of [s.get('[data-premium-account]'), s.get('[data-premium-confirm-user]')]) { assert.equal(host.querySelector('[data-player-avatar]').getAttribute('data-avatar-version'), ''); assert.equal(host.querySelector('[data-evaluation-rank]'), null); }
    const invalid = normalizeContext(ready({ user: { ...owner, avatarVersion: '" onerror="bad', evaluation: { ...rank, score: -1 } } })); assert.equal(invalid.user.avatarVersion, null); assert.equal(invalid.user.evaluation, null);
    s.set(ready({ user: { ...userB, avatarVersion: 'b'.repeat(64), evaluation: rank } })); assert.equal(confirmation.hidden, true); assert.equal(s.get('[data-premium-account]').querySelector('[data-player-avatar]').getAttribute('data-player-avatar'), userB.id); assert(!s.calls.some(call => call[0] === 'checkout'));
  } finally { s?.ui.dispose(); global.SengokuAvatar = savedAvatar; global.SengokuEvaluationUI = savedRank; }
});

test('forged success parameters and local storage never grant ownership or mutate a game save', async () => {
  const { doc } = documentFixture(), effects = [], reads = [], game = { resources: { gold: 10, magatama: 25 }, premium: [] }, before = JSON.stringify(game);
  const storage = { getItem(key) { reads.push(key); return JSON.stringify({ owned: true, premium: ['gold-banner'], success: true }); }, setItem(...args) { effects.push(['write', ...args]); }, removeItem(...args) { effects.push(['remove', ...args]); } };
  const location = new URL('https://fixture.example.test/?premium=gold-banner&success=true&payment_status=paid'), blocked = name => (...args) => { effects.push([name, ...args]); throw Error(name); };
  const window = { document: doc, location, URL, URLSearchParams, localStorage: storage, sessionStorage: storage, fetch: blocked('fetch'), open: blocked('open'), SengokuBridge: { getState: () => game, save: blocked('save') } };
  const context = vm.createContext({ window, document: doc, URL, URLSearchParams, console });
  vm.runInContext(fs.readFileSync(path.join(root, 'premium-catalog.js'), 'utf8'), context); vm.runInContext(fs.readFileSync(path.join(root, 'premium.js'), 'utf8'), context);
  window.SengokuPremium.open('gold-banner'); await drain(); assertUnavailable(doc.querySelector('#premium-modal'));
  const element = doc.querySelector('[data-premium-catalog]'); element.dispatch('click', element.querySelector('[data-premium-preview="supporter"]')); doc.querySelector('#premium-modal').dispatch('click', element.querySelector('[data-premium-purchase="supporter"]'));
  assert.equal(JSON.stringify(game), before); assert.deepEqual(effects, []); assert.deepEqual(reads, []); window.SengokuPremium.dispose();
});

(async () => {
  for (const [name, run] of tests) { await run(); console.log('PASS ' + name); }
  console.log(JSON.stringify({ passed: tests.length, realPayments: 0, gameSaves: 0, fixtureOnly: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
