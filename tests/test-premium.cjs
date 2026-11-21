'use strict';
// Presentation-only premium contracts. No real checkout, storage or game save.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const catalog = require('../premium-catalog.js');
const { renderCatalog, createUI } = require('../premium.js');
const root = path.resolve(__dirname, '..');
const tests = [];
const test = (name, run) => tests.push([name, run]);
const validUrl = 'https://payments.example.test/packs/gold?plan=one-time#details';
const stagedProduct = () => ({ ...catalog.getProduct('gold-banner'), availability: 'available', purchaseUrl: validUrl });
function unavailable(state, reason) {
  assert.equal(state.enabled, false);
  assert.equal(state.url, '', 'A disabled result must not leak a usable checkout URL');
  assert.notEqual(state.status, 'available');
  if (reason) assert.equal(state.reason, reason);
}

test('the three planned products keep their prices and provide no active purchase or gameplay benefit', () => {
  const products = catalog.getProducts();
  assert.deepEqual(products.map(({ id, priceYen, billingPeriod, kind }) => ({ id, priceYen, billingPeriod, kind })), [
    { id: 'gold-banner', priceYen: 480, billingPeriod: 'one_time', kind: 'cosmetic' },
    { id: 'moonlit-castle', priceYen: 980, billingPeriod: 'one_time', kind: 'cosmetic' },
    { id: 'supporter', priceYen: 780, billingPeriod: 'month', kind: 'subscription' }
  ]);
  assert.deepEqual(catalog.getConfig(), { launchEnabled: false, currency: 'JPY', locale: 'ja-JP' });
  for (const product of products) {
    assert.equal(product.availability, 'preparing');
    assert.equal(product.purchaseUrl, '');
    assert.equal(product.taxIncluded, true);
    assert.equal(product.priceIsTentative, true);
    assert.equal(product.transferable, false);
    assert.equal(product.gameplayBenefits, false);
    unavailable(catalog.getPurchaseState(product.id), 'launch_disabled');
  }
});

test('caller changes to a product, benefit list or config cannot enable the real catalog', () => {
  const before = JSON.stringify(catalog.getProducts()), products = catalog.getProducts(), product = catalog.getProduct('gold-banner'), config = catalog.getConfig();
  products[0].priceYen = 1;
  products[0].benefits[0] = '勝利を保証する';
  products.push({ id: 'injected' });
  Object.assign(product, { availability: 'available', purchaseUrl: validUrl });
  product.benefits.push('有料権を付与');
  config.launchEnabled = true;
  assert.equal(JSON.stringify(catalog.getProducts()), before);
  assert.equal(catalog.getConfig().launchEnabled, false);
  unavailable(catalog.getPurchaseState('gold-banner'), 'launch_disabled');
  assert.equal(catalog.getProduct('injected'), null);
});

test('purchase readiness needs a known product, explicit launch and available state before considering a URL', () => {
  const product = stagedProduct();
  for (const launchEnabled of [false, undefined, null, 0, 1, 'true']) unavailable(catalog.getPurchaseState(product, { launchEnabled }), 'launch_disabled');
  for (const availability of ['preparing', '', undefined, true]) unavailable(catalog.getPurchaseState({ ...product, availability }, { launchEnabled: true }), 'product_preparing');
  for (const purchaseUrl of ['', null, undefined]) unavailable(catalog.getPurchaseState({ ...product, purchaseUrl }, { launchEnabled: true }), 'missing_url');
  unavailable(catalog.getPurchaseState({ ...product, id: 'unknown' }, { launchEnabled: true }), 'unknown_product');
  unavailable(catalog.getPurchaseState('unknown'), 'unknown_product');
  const ready = catalog.getPurchaseState(product, { launchEnabled: true });
  assert.equal(ready.enabled, true);
  assert.equal(ready.status, 'available');
  assert.equal(ready.url, validUrl);
  assert.equal(ready.label, '購入ページへ');
  unavailable(catalog.getPurchaseState('gold-banner'), 'launch_disabled');
});

test('checkout validation rejects executable, relative, ambiguous and credential-bearing URLs', () => {
  const invalidUrls = [
    'javascript:alert(1)', 'data:text/html,checkout', 'http://payments.example.test/checkout',
    '//payments.example.test/checkout', '/checkout', 'https:payments.example.test',
    'https://', 'https:///payments.example.test', 'https://user:secret@payments.example.test/',
    'https://@payments.example.test/', 'https://payments.example.test@other.example.test/',
    ' https://payments.example.test/', 'https://payments.example.test/ ',
    'https://payments.example.test/\n', 'https://payments.example.test/\t', 'https://payments.example.test/\u0000',
    'https://payments.example.test/\\other', 'https://payments.example.test:99999/',
    480, new URL(validUrl), { toString: () => validUrl }
  ];
  for (const purchaseUrl of invalidUrls) unavailable(catalog.getPurchaseState({ ...stagedProduct(), purchaseUrl }, { launchEnabled: true }), 'invalid_url');
});

// Only the native-dialog and preview DOM operations used by this presentation.
// This deliberately provides no browser payment, persistence or game API.
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
function assertPreparing(element) {
  const purchases = element.querySelectorAll('[data-premium-purchase]');
  assert.equal(purchases.length, 3);
  for (const purchase of purchases) {
    assert.equal(purchase.tagName, 'BUTTON');
    assert.equal(purchase.disabled, true);
    assert.equal(purchase.getAttribute('href'), null);
    assert.equal(purchase.textContent, '販売準備中');
  }
  assert.match(element.textContent, /予定価格・税込/);
  assert.match(element.textContent, /現在は購入・申し込みできません/);
  assert.doesNotMatch(element.textContent, /購入済み|支払い完了/);
}

test('static cards are honest about preparation, and mounted previews only change their own sample', () => {
  const { doc } = documentFixture(), container = doc.createElement('section');
  container.innerHTML = renderCatalog({ catalog, assetPrefix: '../', idPrefix: 'test-premium' }); doc.body.append(container);
  assertPreparing(container);
  assert.deepEqual(container.querySelectorAll('.premium-price').map(node => node.textContent), ['480円予定価格・税込', '980円予定価格・税込', '780円 / 月予定価格・税込']);
  assert(container.querySelectorAll('[data-premium-preview]').every(button => button.disabled));
  const ui = createUI({ document: doc, catalog }), section = container.querySelector('[data-premium-catalog]');
  assert.equal(ui.mount(container), 1); assert.equal(ui.mount(container), 0);
  for (const key of ['gold-banner', 'moonlit-castle', 'supporter', 'standard']) {
    const button = section.querySelector('[data-premium-preview="' + key + '"]');
    assert.equal(button.disabled, false); section.dispatch('click', button);
    assert.equal(section.getAttribute('data-premium-selected'), key);
    assert.equal(section.querySelector('[data-premium-stage]').getAttribute('data-premium-preview-mode'), key);
    for (const candidate of section.querySelectorAll('[data-premium-preview]')) assert.equal(candidate.getAttribute('aria-pressed'), String(candidate.getAttribute('data-premium-preview') === key));
    assertPreparing(section);
  }
  ui.dispose();
  assert(section.querySelectorAll('[data-premium-preview]').every(button => button.disabled));
  const missing = doc.createElement('section'); missing.innerHTML = renderCatalog({ catalog: {} });
  assert.equal(missing.querySelectorAll('[data-premium-purchase]').length, 0);
  assert.match(missing.textContent, /現在は購入できません/);
});

test('the native dialog supports Escape and close controls, resets previews and returns keyboard focus', () => {
  const { doc, entry } = documentFixture(), ui = createUI({ document: doc, catalog });
  assert.equal(doc.querySelector('#premium-modal'), null);
  assert.equal(ui.open(), true);
  const dialog = doc.querySelector('#premium-modal'), heading = dialog.querySelector('#premium-dialog-title');
  assert.equal(dialog.modalCalls, 1); assert.equal(ui.isOpen(), true);
  assert.equal(dialog.getAttribute('aria-labelledby'), heading.id); assert.equal(heading.getAttribute('tabindex'), '-1'); assert.equal(doc.activeElement, heading);
  assertPreparing(dialog);
  const section = dialog.querySelector('[data-premium-catalog]'); section.dispatch('click', section.querySelector('[data-premium-preview="supporter"]'));
  const escape = dialog.dispatch('keydown', heading, { key: 'Escape' });
  assert(escape.prevented && escape.stopped); assert.equal(ui.isOpen(), false); assert.equal(doc.activeElement, entry);
  assert.equal(dialog.querySelectorAll('[data-premium-catalog]').length, 0); assert.equal(ui.close(), false);
  ui.open(); assert.equal(dialog.querySelector('[data-premium-catalog]').getAttribute('data-premium-selected'), 'standard');
  const cancel = dialog.dispatch('cancel'); assert(cancel.prevented && cancel.stopped); assert.equal(doc.activeElement, entry);
  ui.open(); dialog.dispatch('click', dialog.querySelector('[data-premium-close]')); assert.equal(ui.isOpen(), false); assert.equal(doc.activeElement, entry);
  ui.open(); dialog.deferCloseEvent = true; ui.close(); ui.open();
  const reopened = dialog.querySelector('[data-premium-catalog]'); reopened.dispatch('click', reopened.querySelector('[data-premium-preview="gold-banner"]'));
  dialog.dispatch('close');
  assert.equal(ui.isOpen(), true); assert.equal(dialog.querySelector('[data-premium-catalog]'), reopened); assert.equal(reopened.getAttribute('data-premium-selected'), 'gold-banner'); assert.equal(doc.activeElement, heading);
  dialog.deferCloseEvent = false;
  ui.dispose(); assert.equal(doc.querySelector('#premium-modal'), null);
  const unsupported = documentFixture(), create = unsupported.doc.createElement;
  unsupported.doc.createElement = tag => { const node = create(tag); if (tag === 'dialog') node.showModal = undefined; return node; };
  const fallback = createUI({ document: unsupported.doc, catalog });
  assert.equal(fallback.open(), false); assert.equal(fallback.isOpen(), false); assert.equal(unsupported.doc.activeElement, unsupported.entry); fallback.dispose();
});

test('forged success URLs and browser storage never grant ownership, call payment APIs or alter game saves', () => {
  const { doc } = documentFixture(), container = doc.createElement('section');
  container.innerHTML = renderCatalog({ catalog, assetPrefix: '../' }); doc.body.append(container);
  const game = { state: { resources: { gold: 100, magatama: 25 }, ownedPremium: [], supporter: false } }, before = JSON.stringify(game);
  const effects = [], reads = [], stored = JSON.stringify({ launchEnabled: true, premium: true, payment_status: 'paid', purchased: ['gold-banner', 'moonlit-castle', 'supporter'] });
  const storage = { getItem(key) { reads.push(key); return stored; }, setItem(...args) { effects.push(['storage-write', ...args]); }, removeItem(...args) { effects.push(['storage-remove', ...args]); }, clear() { effects.push(['storage-clear']); } };
  const location = new URL('https://fixture.example.test/premium/?premium=true&success=true&payment_status=paid&productId=supporter&launchEnabled=true#purchased');
  const blocked = name => (...args) => { effects.push([name, ...args]); throw Error('Unexpected external or save operation: ' + name); };
  const bridge = { save: blocked('save'), grantPremium: blocked('grant-premium'), requestField: blocked('server-mutation'), state: () => game.state };
  const window = { document: doc, location, localStorage: storage, sessionStorage: storage, URL, URLSearchParams, game, SengokuBridge: bridge, fetch: blocked('fetch'), open: blocked('open'), navigator: { sendBeacon: blocked('beacon') } };
  const context = vm.createContext({ window, document: doc, location, localStorage: storage, sessionStorage: storage, URL, URLSearchParams, console, game, SengokuBridge: bridge, fetch: window.fetch, save: bridge.save });
  vm.runInContext(fs.readFileSync(path.join(root, 'premium-catalog.js'), 'utf8'), context, { filename: 'premium-catalog.js' });
  vm.runInContext(fs.readFileSync(path.join(root, 'premium.js'), 'utf8'), context, { filename: 'premium.js' });
  const ui = window.SengokuPremium; assertPreparing(container); ui.open();
  const dialog = doc.querySelector('#premium-modal'), section = dialog.querySelector('[data-premium-catalog]');
  section.dispatch('click', section.querySelector('[data-premium-preview="supporter"]'));
  section.dispatch('click', section.querySelector('[data-premium-purchase="supporter"]'));
  assertPreparing(dialog);
  for (const product of window.SengokuPremiumCatalog.getProducts()) unavailable(window.SengokuPremiumCatalog.getPurchaseState(product.id), 'launch_disabled');
  ui.close(); ui.dispose();
  assert.equal(JSON.stringify(game), before);
  assert.deepEqual(effects, []); assert.deepEqual(reads, []);
  assert.equal(location.search.includes('payment_status=paid'), true, 'The forged success URL was actually present');
});

(async () => {
  for (const [name, run] of tests) {
    await run();
    console.log('PASS ' + name);
  }
  console.log(JSON.stringify({ passed: tests.length, realPayments: 0, gameSaves: 0, fixtureOnly: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
