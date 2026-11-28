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
const paymentBases = { 'gold-banner': 'https://buy.stripe.com/fZu6oI3Iwdcd5kn4Um9MY04', 'moonlit-castle': 'https://buy.stripe.com/dRmdRa6UI2xz6or1Ia9MY05', supporter: 'https://buy.stripe.com/7sY8wQdj6dcdbILaeG9MY06', 'vermilion-banner': 'https://buy.stripe.com/aFa8wQ3Iw5JL1479aC9MY07', 'silver-banner': 'https://buy.stripe.com/aFacN65QE4FHeUXaeG9MY08', 'phoenix-medallion': 'https://buy.stripe.com/8x2aEY5QE5JL00386y9MY09', 'sakura-town': 'https://buy.stripe.com/3cI6oIfre5JLeUX5Yq9MY0a', 'snow-town': 'https://buy.stripe.com/28EaEYfrec893cfeuW9MY0b', 'castle-heritage': 'https://buy.stripe.com/eVq7sM3IwgopcMP72u9MY0d' };
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
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.attributes.hidden = ''; else delete this.attributes.hidden; }
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
  let context = initial, claim = async () => context, checkout = async id => ({ productId: id, url: checkoutURL(id) }), equip = async (id, slot) => {
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
    claimSupporterReward(periodId, productId) { calls.push(['claim', periodId, productId]); return claim(periodId, productId); },
    async trackEvent(event, productId) { calls.push(['event', event, productId]); return true; },
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
    const host = element.hasAttribute('data-premium-preview') || element.hasAttribute('data-premium-filter') ? get('[data-premium-catalog]') : get('#premium-modal'); host.dispatch('click', element);
  }
  return { doc, entry, ui, runtime, windows, calls, get, click, listeners, context: () => context,
    set(value) { context = value; for (const listener of listeners) listener(context); },
    onCheckout(fn) { checkout = fn; }, onEquip(fn) { equip = fn; }, onClaim(fn) { claim = fn; }
  };
}
function assertUnavailable(container) {
  assert.equal(container.querySelectorAll('[data-premium-equip]').length, 0);
  const buttons = container.querySelectorAll('[data-premium-purchase]'); assert.equal(buttons.length, 10);
  for (const button of buttons) { assert.equal(button.tagName, 'BUTTON'); assert.equal(button.disabled, true); assert.equal(button.getAttribute('href'), null); }
}

test('the ten products have fixed prices, real artwork and truthful gameplay benefit flags', () => {
  assert.deepEqual(catalog.getProducts().map(product => [product.id, product.priceYen, product.billingPeriod, product.slot]), [
    ['gold-banner', 480, 'one_time', 'nameplate'], ['moonlit-castle', 980, 'one_time', 'town'], ['supporter', 780, 'month', 'badge'],
    ['reroll-pass-30d', 480, 'one_time', undefined], ['vermilion-banner', 580, 'one_time', 'nameplate'], ['silver-banner', 580, 'one_time', 'nameplate'], ['phoenix-medallion', 780, 'one_time', 'badge'], ['sakura-town', 980, 'one_time', 'town'], ['snow-town', 980, 'one_time', 'town'], ['castle-heritage', 980, 'one_time', 'town']
  ]);
  for (const product of catalog.getProducts()) {
    assert.equal(product.taxIncluded, true); assert.equal(product.priceIsTentative, false); assert.equal(product.transferable, false); assert.equal(product.gameplayBenefits, product.id === 'reroll-pass-30d');
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
  const links = section.querySelectorAll('[data-premium-purchase]'); assert.equal(links.length, 10);
  for (const [index, product] of catalog.getProducts().entries()) { assert.equal(links[index].tagName, 'A'); assert.equal(links[index].getAttribute('href'), '../?premium=' + product.id); assert(html.includes('../' + product.art.src)); }
  assert.doesNotMatch(html, /buy\.stripe\.com|data-premium-equip|data-premium-account|予定価格|販売準備中/);
  assert.match(section.textContent, /月額780円（税込）で自動更新/); assert.match(section.textContent, /現在の利用期間の末日/);
  const ui = createUI({ document: doc, catalog, runtime: { getContext() { throw Error('Public page must not read account state'); } } });
  ui.mount(section); const preview = section.querySelector('[data-premium-catalog]');
  preview.dispatch('click', preview.querySelector('[data-premium-preview="gold-banner"]'));
  const landscape = preview.querySelector('[data-premium-landscape]');
  assert.equal(preview.getAttribute('data-premium-selected'), 'gold-banner');
  assert.equal(landscape.getAttribute('src'), '../assets/responsive/castle-town-raden-1536.webp');
  assert.match(landscape.getAttribute('alt'), /翡翠/);
  for (const width of [400,720,1080,1536]) {
    assert(landscape.getAttribute('srcset').includes(`castle-town-raden-${width}.webp ${width}w`));
  }
  for (const product of catalog.getProducts().filter(item => item.slot === 'town')) {
    preview.dispatch('click', preview.querySelector(`[data-premium-preview="${product.id}"]`));
    assert.equal(landscape.getAttribute('src'), '../' + product.art.src);
    assert.equal(landscape.getAttribute('alt'), product.id === 'castle-heritage' ? '姫路城の城郭と城下町を描いた専用絵巻' : product.art.alt);
    assert(landscape.getAttribute('srcset').includes(`${product.id === 'castle-heritage' ? 'himeji' : product.id}-400.webp 400w`));
  }
  ui.dispose();
});

test('all additional previews use their actual asset and category filters keep every item reachable', () => {
  const {doc}=documentFixture(),section=doc.createElement('section');
  section.innerHTML=renderCatalog({catalog,surface:'public',assetPrefix:'../',gamePrefix:'../'});doc.body.append(section);
  const ui=createUI({document:doc,catalog});ui.mount(section);
  const container=section.querySelector('[data-premium-catalog]');
  for(const id of ['vermilion-banner','silver-banner','phoenix-medallion','sakura-town','snow-town','castle-heritage']){
    const product=catalog.getProduct(id);
    container.dispatch('click',container.querySelector('[data-premium-preview="'+id+'"]'));
    const stage=container.querySelector('[data-premium-stage]');
    assert.equal(stage.getAttribute('data-premium-preview-slot'),product.slot);
    const picture=stage.querySelector(product.slot==='nameplate'?'.premium-preview-banner':product.slot==='badge'?'.premium-preview-supporter':'[data-premium-landscape]');
    assert.equal(picture.getAttribute('src'),'../'+product.art.src);
  }
  for(const [slot,count] of [['nameplate',3],['town',4],['badge',2],['pass',1],['all',10]]){
    const button=container.querySelector('[data-premium-filter="'+slot+'"]');container.dispatch('click',button);
    const visible=container.querySelectorAll('[data-premium-slot]').filter(item=>!item.hidden);
    assert.equal(visible.length,count);assert.equal(button.getAttribute('aria-pressed'),'true');
  }
  ui.dispose();
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

function supporterPeriod(claimedProductId = null) {
  return { periodId: 'srp_fixture_202611', periodKey: '202611', startsAt: '2026-11-20T12:00:00.000Z', endsAt: '2026-12-20T12:00:00.000Z', claimedProductId, choices: catalog.getSupporterChoices('202611').map(item => item.id) };
}

test('active reroll pass displays its real deadline and daily remainder without offering equipment or duplicate checkout', async () => {
  const value = ready();
  value.products = value.products.map(product => product.id === 'reroll-pass-30d' ? { ...product, owned: true, canPurchase: true, expiresAt: '2026-12-27T04:00:00.000Z' } : product);
  value.rerollPass = { active: true, expiresAt: '2026-12-27T04:00:00.000Z', dailyLimit: 3, usedToday: 2, remainingToday: 1, nextResetAt: '2026-11-27T20:00:00.000Z', countsVerified: true };
  const s = setup(value); s.ui.open('reroll-pass-30d'); await drain();
  const card = s.get('[data-premium-product="reroll-pass-30d"]');
  assert.match(card.textContent, /残り 1 \/ 3 回/); assert.match(card.textContent, /2026年12月27日/); assert.match(card.textContent, /2026年11月28日 05:00/);
  assert.match(card.textContent, /武将の獲得結果に影響する有料特典/); assert.match(card.textContent, /10人招集は対象外/); assert.match(card.textContent, /自動更新はありません/);
  assert.equal(s.get('[data-premium-purchase="reroll-pass-30d"]').disabled, true);
  assert.equal(s.get('[data-premium-equip="reroll-pass-30d"]'), null);
  assert.equal(s.get('[data-premium-preview="reroll-pass-30d"]'), null);
  s.click('[data-premium-purchase="reroll-pass-30d"]'); assert.equal(s.calls.some(call => call[0] === 'checkout'), false);
  s.set({ ...value, rerollPass: { ...value.rerollPass, countsVerified: false } });
  assert.match(s.get('[data-premium-product="reroll-pass-30d"]').textContent, /本日の残り回数は再確認/);
  assert.doesNotMatch(s.get('[data-premium-product="reroll-pass-30d"]').textContent, /残り 1 \/ 3 回/);
  s.ui.dispose();
});

test('pass purchase confirmation states real-time duration, single draw rules and paid gameplay effect before checkout', async () => {
  const s = setup(); s.ui.open('reroll-pass-30d'); await drain();
  s.click('[data-premium-purchase="reroll-pass-30d"]'); const note = s.get('[data-premium-confirm]').textContent;
  assert.match(note, /480円 \/ 30日/); assert.match(note, /実時間30日間/); assert.match(note, /自動更新はありません/);
  assert.match(note, /1日3回/); assert.match(note, /元の武将と新しい武将から1人/); assert.match(note, /05:00（日本時間）/); assert.match(note, /武将の獲得結果に影響/);
  assert.equal(s.calls.filter(call => call[0] === 'checkout').length, 0);
  s.ui.dispose();
});

test('a paid-period cosmetic is previewed, confirmed, received without optimism and kept after supporter cancellation', async () => {
  const period = supporterPeriod(), id = period.choices[1];
  const value = ready({ supporterRewards: { periods: [period] }, appearance: { nameplate: null, ownedProducts: [] } });
  const s = setup(value), wait = deferred(); s.onClaim(() => wait.promise); s.ui.open('supporter'); await drain();
  assert.equal(s.get('[data-premium-supporter]').querySelectorAll('[data-premium-reward-choice]').length, 3);
  s.click('[data-premium-preview="' + id + '"]');
  assert.equal(s.get('[data-premium-stage]').getAttribute('data-premium-preview-slot'), 'nameplate');
  assert.equal(s.get('[data-premium-stage]').getAttribute('data-premium-reward-preview'), 'true');
  assert.equal(s.get('.premium-preview-banner').getAttribute('src'), catalog.getProduct(id).art.src);
  assert(s.get('[data-premium-stage]').getAttribute('style').includes(catalog.getProduct(id).palette.background));
  s.click('[data-premium-reward-choice="' + id + '"]');
  assert.match(s.get('[data-premium-confirm]').textContent, /確定後は別の外観に変更できません/);
  assert.match(s.get('[data-premium-confirm]').textContent, /追加の支払いはありません/);
  assert.equal(s.calls.filter(call => call[0] === 'claim').length, 0);
  s.click('[data-premium-ui="claim-reward"]'); s.click('[data-premium-ui="claim-reward"]');
  assert.deepEqual(s.calls.filter(call => call[0] === 'claim'), [['claim', period.periodId, id]]);
  assert.equal(s.get('[data-premium-equip="' + id + '"]'), null);
  const received = ready({ supporterRewards: { periods: [supporterPeriod(id)] }, appearance: { nameplate: null, ownedProducts: [id] } });
  s.set(received); wait.resolve(received); await drain();
  assert(s.get('[data-premium-equip="' + id + '"]')); assert.equal(s.get('[data-premium-reward-choice="' + id + '"]'), null);
  assert.match(s.get('[data-premium-supporter]').textContent, /解約後も所持/);
  assert.equal(s.context().products.find(product => product.id === 'supporter').owned, false);
  s.click('[data-premium-equip="' + id + '"]'); await drain();
  assert(s.calls.some(call => call[0] === 'equip' && call[1] === id && call[2] === 'nameplate'));
  assert.equal(s.windows.length, 0); assert(!s.calls.some(call => call[0] === 'checkout')); s.ui.dispose();
});

test('changing account cancels a pending reward confirmation and clears old paid-period choices', async () => {
  const period = supporterPeriod(), s = setup(ready({ supporterRewards: { periods: [period] } })); s.ui.open(); await drain();
  s.click('[data-premium-reward-choice="' + period.choices[0] + '"]');
  s.set(ready({ user: userB }));
  assert.equal(s.get('[data-premium-confirm]').hidden, true); assert.equal(s.get('[data-premium-reward-choice]'), null);
  assert.equal(s.calls.filter(call => call[0] === 'claim').length, 0); s.ui.dispose();
});

test('shop views and explicit checkout starts are measured without fabricated successful purchase events', async () => {
  const s = setup(); s.ui.open(); await drain(); s.ui.refresh(); s.ui.refresh();
  assert.equal(s.calls.filter(call => call[0] === 'event' && call[1] === 'shop_view').length, 1);
  s.click('[data-premium-purchase="gold-banner"]'); assert.equal(s.calls.filter(call => call[0] === 'event' && call[1] === 'checkout_start').length, 0);
  s.click('[data-premium-ui="checkout"]'); await drain();
  assert.deepEqual(s.calls.filter(call => call[0] === 'event').map(call => call.slice(1)), [['shop_view', undefined], ['checkout_start', 'gold-banner']]);
  assert.equal(s.context().products[0].owned, false); s.ui.dispose();
});

test('castle preview selects distinct named art without granting or changing equipment', async () => {
  const entries = catalog.getCastleScenes();
  assert.equal(entries.length, 129);
  assert.equal(entries.filter(item => !item.included).length, 123);
  assert.deepEqual(entries.filter(item => item.included).map(item => item.id).sort(), ['edo','kagoshima','kyoto_gosho','nagoya','nijo','osaka']);
  const s = setup(); s.ui.open(); await drain();
  const picker = s.get('[data-premium-castle-select]');
  assert(picker); assert.equal(picker.querySelectorAll('option').length, 129);
  picker.value = 'matsumoto'; s.get('[data-premium-catalog]').dispatch('change', picker);
  assert.match(s.get('[data-premium-landscape]').getAttribute('src'), /castle-scenes\/matsumoto-720\.webp$/);
  assert.match(s.get('[data-premium-preview-title]').textContent, /松本城/);
  assert(!s.calls.some(call => ['equip','checkout'].includes(call[0])));
  picker.value = 'kagoshima'; s.get('[data-premium-catalog]').dispatch('change', picker);
  assert.match(s.get('[data-premium-landscape]').getAttribute('src'), /kagoshima-town-day-720\.webp$/);
  assert.doesNotMatch(picker.textContent + s.get('[data-premium-preview-description]').textContent, /無料対象|購入不要|無料の専用|（無料）/);
  picker.value = '../invalid'; s.get('[data-premium-catalog]').dispatch('change', picker);
  assert.match(s.get('[data-premium-landscape]').getAttribute('src'), /kagoshima-town-day-720\.webp$/);
  s.ui.dispose();
});

test('a location that already has its own scene receives no purchase solicitation or free-target announcement', async () => {
  const initial = ready(); initial.products.find(item => item.id === 'castle-heritage').canPurchase = false;
  initial.products.find(item => item.id === 'castle-heritage').purchaseBlockReason = 'castle_art_included';
  const s = setup(initial); s.ui.open(); await drain();
  const card = s.get('[data-premium-product="castle-heritage"]'); assert.equal(card.hidden, true);
  s.click('[data-premium-filter="town"]'); assert.equal(card.hidden, true);
  assert.doesNotMatch(s.get('[data-premium-preview-description]').textContent, /無料対象|購入不要/);
  s.click('[data-premium-filter="nameplate"]'); s.set(ready()); assert.equal(card.hidden, true);
  s.click('[data-premium-filter="town"]'); assert.equal(card.hidden, false);
  s.set(initial); assert.equal(card.hidden, true);
  const owned = ready(); Object.assign(owned.products.find(item => item.id === 'castle-heritage'), { owned: true, equipped: true, canPurchase: false, purchaseBlockReason: 'owned' });
  s.set(owned); assert.equal(card.hidden, false);
  assert.equal(s.get('[data-premium-purchase="castle-heritage"]'), null);
  assert.equal(s.get('[data-premium-equip="castle-heritage"]').hasAttribute('data-premium-remove'), true);
  s.ui.dispose();
});

test('an independently mounted game catalog keeps an included castle product hidden during filtering', () => {
  const initial = ready(); Object.assign(initial.products.find(item => item.id === 'castle-heritage'), { canPurchase: false, purchaseBlockReason: 'castle_art_included' });
  const { doc } = documentFixture(), section = doc.createElement('section');
  section.innerHTML = renderCatalog({ catalog, surface: 'game', context: initial }); doc.body.append(section);
  const ui = createUI({ document: doc, catalog }); ui.mount(section);
  const container = section.querySelector('[data-premium-catalog]'), card = section.querySelector('[data-premium-product="castle-heritage"]');
  assert.equal(card.hidden, true);
  for (const slot of ['town', 'nameplate', 'all']) {
    container.dispatch('click', container.querySelector(`[data-premium-filter="${slot}"]`));
    assert.equal(card.hidden, true);
  }
  ui.dispose();
});

(async () => {
  for (const [name, run] of tests) { await run(); console.log('PASS ' + name); }
  console.log(JSON.stringify({ passed: tests.length, realPayments: 0, gameSaves: 0, fixtureOnly: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
