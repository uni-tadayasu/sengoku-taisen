'use strict';
const assert = require('node:assert/strict');
const { createUI, normalize, formatWait, assetsMarkup } = require('../hints-ui.js');
const { build } = require('../hints.js');
const { SengokuEngine } = require('../engine.js');

// Small native-dialog surface: no network, storage, or browser is required.
class Element {
  constructor(tag, document) { this.tagName = tag.toUpperCase(); this.document = document; this.children = []; this.parentElement = null; this.attributes = {}; this.dataset = {}; this.events = {}; this.className = ''; this.id = ''; this.hidden = false; this.disabled = false; this.open = false; this.scrollTop = 0; this._text = ''; this.writes = 0; }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === 'class') this.className = String(value); if (name === 'id') this.id = String(value); if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value); if (name === 'hidden') this.hidden = true; }
  getAttribute(name) { return this.attributes[name] ?? null; }
  get isConnected() { return this === this.document.body || Boolean(this.document.body?.contains(this)); }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(''); }
  set textContent(value) { this.writes++; this._text = String(value); for (const child of [...this.children]) child.remove(); }
  get innerHTML() { return this._html || ''; }
  set innerHTML(html) {
    this.writes++; this._html = String(html); this._text = ''; for (const child of [...this.children]) child.remove();
    const stack = [this];
    for (const part of String(html).match(/<[^>]*>|[^<]+/g) || []) {
      if (part.startsWith('</')) { stack.pop(); continue; }
      if (!part.startsWith('<')) { stack.at(-1)._text += part.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); continue; }
      const parsed = /^<([a-zA-Z0-9-]+)([\s\S]*?)\/?\s*>$/.exec(part); if (!parsed) continue;
      const node = new Element(parsed[1], this.document);
      for (const attribute of parsed[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g)) node.setAttribute(attribute[1], attribute[2] || '');
      stack.at(-1).append(node); if (!part.endsWith('/>') && !['INPUT', 'BR', 'HR', 'IMG'].includes(node.tagName)) stack.push(node);
    }
  }
  append(node) { return this.insertBefore(node, null); }
  insertBefore(node, before) { node.remove(); node.parentElement = this; const index = before ? this.children.indexOf(before) : -1; this.children.splice(index < 0 ? this.children.length : index, 0, node); return node; }
  remove() { if (!this.parentElement) return; if (this.contains(this.document.activeElement)) this.document.activeElement = this.document.body; const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; }
  contains(node) { return this === node || this.children.some(child => child.contains(node)); }
  matches(selector) {
    if (selector.includes(',')) return selector.split(',').some(part => this.matches(part.trim()));
    if (selector.startsWith('.')) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return this.id === selector.slice(1);
    const attribute = /^\[([^=\]]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (attribute) { const name = attribute[1], key = name.startsWith('data-') ? name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase()) : null, value = key ? this.dataset[key] : this.attributes[name]; return value !== undefined && (attribute[2] === undefined || value === attribute[2]); }
    return selector === '*' || this.tagName === selector.toUpperCase();
  }
  closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
  querySelectorAll(selector) {
    const parts = selector.trim().split(/\s+/), descendants = this.children.flatMap(node => [node, ...node.querySelectorAll('*')]);
    if (parts.length === 1) return descendants.filter(node => node.matches(selector));
    const tail = parts.pop(), ancestor = parts.join(' ');
    return descendants.filter(node => node.matches(tail) && node.parentElement?.closest(ancestor));
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
  dispatch(type, target = this) { const event = { target, prevented: false, preventDefault() { this.prevented = true; } }; for (const handler of this.events[type] || []) handler(event); return event; }
  focus(options) { this.document.activeElement = this; this.focusOptions = options; }
  showModal() { this.open = true; }
  close() { this.open = false; this.dispatch('close'); }
}
const hint = (id, extra = {}) => ({ id, priority: 100, tone: 'advice', category: 'construction', title: '田畑を育てる ' + id, reason: '兵糧を増やすと、次の準備を進められます。', action: { kind: 'building', id: 'farm', label: '田畑を確認する' }, ...extra });
const report = (items = ['a', 'b', 'c', 'd', 'e'].map(id => hint(id)), extra = {}) => ({ scope: 'owner:first:castle', status: 'ready', title: '城下町から、次の準備を', summary: '今の資産と兵力に合わせた候補です。', items, ...extra });
const waitingReport = (context={},scope='owner:first:castle') => ({...build(new SengokuEngine({seed:47}),{started:true,writable:false,syncReady:true,clockReady:true,saveEnabled:true,syncReason:'writer',syncMessage:'変更を自動保存しています…',...context}),scope});
function setup(value = report(), options = {}) {
  const doc = { activeElement: null, createElement(tag) { return new Element(tag, doc); } }; doc.body = doc.createElement('body');
  doc.querySelector = selector => doc.body.querySelector(selector); doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  const entry = doc.createElement('button'); doc.body.append(entry); entry.focus();
  let model = value, calls = 0, follow = () => ({ ok: false, message: '候補を確認してください。' }), help = () => false, ui;
  const events = [], bridge = { getHints() { calls++; return model; }, followHint(id) { events.push({ id, open: ui.isOpen() }); return follow(id); }, openHintHelp() { events.push({ help: true, open: ui.isOpen() }); return help(); } };
  ui = createUI({ document: doc, bridge: () => bridge, now: options.now, viewport() {} });
  const $ = selector => doc.body.querySelector(selector);
  return { ui, doc, entry, $, events, get calls() { return calls; }, setModel(value) { model = value; }, onFollow(value) { follow = value; }, onHelp(value) { help = value; }, click(selector) { $('#hints-modal').dispatch('click', $(selector)); } };
}
const drain = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => resolve = done); return { promise, resolve }; };
let checks = 0;
async function test(name, run) { await run(); checks++; console.log('PASS ' + name); }

(async () => {
  await test('closed UI does not evaluate or retain the private model', () => {
    const s = setup(); assert.equal(s.ui.refresh(), false); assert.equal(s.calls, 0); s.ui.open(); assert.equal(s.calls, 1);
    s.ui.close(); assert.equal(s.$('[data-hints-primary]').children.length, 0); assert.equal(s.$('[data-hints-title]').textContent, ''); s.ui.refresh(); assert.equal(s.calls, 1); assert.equal(s.doc.activeElement, s.entry); assert.equal(s.ui.close(), false);
  });
  await test('only three candidates are prominent, with the rest in an accessible collapsed list', () => {
    const s = setup(); s.ui.open(); assert.equal(s.$('[data-hints-primary]').children.length, 3); assert.equal(s.$('[data-hints-others]').children.length, 2); assert.equal(s.$('.hints-other').open, false); assert.equal(s.$('[data-hints-count]').textContent, '2件'); assert.equal(s.$('#hints-modal').getAttribute('aria-labelledby'), 'hints-title'); assert.equal(s.doc.activeElement, s.$('#hints-title')); s.ui.dispose();
  });
  await test('the town entry shares one fresh report with the dialog and stops evaluation when both are absent', () => {
    const s = setup(), entry = s.doc.createElement('section'); entry.setAttribute('data-hint-entry', ''); entry.innerHTML = '<strong data-hint-title></strong><p data-hint-reason></p>'; s.doc.body.append(entry);
    assert(s.ui.refresh()); assert.equal(s.calls, 1); assert.equal(s.ui.isOpen(), false); assert.equal(s.$('#hints-modal'), null); assert.equal(s.$('[data-hint-title]').textContent, '田畑を育てる a');
    s.ui.open(); assert.equal(s.calls, 2); s.setModel(report([hint('new', { title: '兵糧を確保する', reason: '新しい領主では兵糧が不足しています。' })], { scope: 'new-owner' })); s.ui.refresh(); assert.equal(s.calls, 3); assert.equal(s.$('[data-hint-title]').textContent, '兵糧を確保する'); assert.equal(s.$('h3').textContent, '兵糧を確保する');
    s.ui.close(); s.setModel(report([], { status: 'blocked', title: '同期を確認しています', summary: '確認後に最新の候補を表示します。', scope: 'blocked-owner' })); s.ui.refresh(); assert.equal(s.calls, 4); assert.equal(s.$('[data-hint-title]').textContent, '同期を確認しています'); assert.equal(s.$('[data-hint-reason]').textContent, '確認後に最新の候補を表示します。');
    entry.remove(); assert.equal(s.ui.refresh(), false); assert.equal(s.calls, 4); s.ui.dispose();
  });
  await test('unchanged refreshes keep card DOM, keyboard focus, scroll and expanded candidates', () => {
    const s = setup(); s.ui.open(); const card = s.$('[data-hints-primary]').children[0], button = s.$('[data-hint-follow="a"]'), main = s.$('.hints-main'), details = s.$('.hints-other'), oldWrites = card.writes;
    button.focus(); main.scrollTop = 315; details.open = true; assert.equal(s.ui.refresh(), false); assert.equal(s.$('[data-hints-primary]').children[0], card); assert.equal(card.writes, oldWrites); assert.equal(s.doc.activeElement, button); assert.equal(main.scrollTop, 315); assert.equal(details.open, true); s.ui.dispose();
  });
  await test('routine refresh is throttled for two seconds while explicit open, permission refresh and failed navigation stay fresh', async () => {
    let time = 1000; const s = setup(report(), { now: () => time }); s.ui.open(); assert.equal(s.calls, 1);
    time = 2999; s.ui.refresh({ throttled: true }); assert.equal(s.calls, 1);
    time = 3000; s.ui.refresh({ throttled: true }); assert.equal(s.calls, 2);
    time = 3001; s.setModel(report([hint('a')], { scope: 'permission-changed', status: 'blocked', title: '同期を確認しています' })); s.ui.refresh(); assert.equal(s.calls, 3); assert.equal(s.$('[data-hints-title]').textContent, '同期を確認しています');
    s.ui.open(); assert.equal(s.calls, 4); s.click('[data-hint-follow="a"]'); await drain(); assert.equal(s.calls, 5); s.ui.close(); time = 6000; s.ui.refresh({ throttled: true }); assert.equal(s.calls, 5); s.ui.dispose();
  });
  await test('changing cost and waiting time updates text without replacing the focused action', () => {
    const s = setup(report([hint('a', { waitSeconds: 91, cost: { gold: 100 } }), hint('b'), hint('c'), hint('d')])); s.ui.open(); const button = s.$('[data-hint-follow="a"]'), card = button.parentElement;
    button.focus(); s.$('.hints-main').scrollTop = 270; s.$('.hints-other').open = true;
    s.setModel(report([hint('a', { waitSeconds: 90, cost: { gold: 200 }, missing: { gold: 40 } }), hint('b'), hint('c'), hint('d')])); assert(s.ui.refresh());
    assert.equal(s.$('[data-hint-follow="a"]'), button); assert.equal(s.doc.activeElement, button); assert.equal(s.$('.hints-main').scrollTop, 270); assert.equal(s.$('.hints-other').open, true); assert.match(card.querySelector('.hints-wait').textContent, /ゲーム内 1分30秒/); assert.match(card.querySelector('.hints-resources').textContent, /200/); assert.match(card.querySelector('.hints-resources').textContent, /不足している資産/); s.ui.dispose();
  });
  await test('clock resampling keeps visible hints, focus, scroll and the town summary stable', async () => {
    let time = 1000; const ready = report(), s = setup(ready, { now: () => time });
    const entry = s.doc.createElement('section'); entry.setAttribute('data-hint-entry', ''); entry.innerHTML = '<strong data-hint-title></strong><p data-hint-reason></p>'; s.doc.body.append(entry);
    const pending = report([hint('clock-pending', { title: '共通時刻を確認しています' })], { status: 'blocked', title: '共通時刻を確認しています' });
    s.ui.open(); const card = s.$('[data-hints-primary]').children[0], button = s.$('[data-hint-follow="b"]'); button.focus();
    s.$('.hints-main').scrollTop = 240; s.$('.hints-other').open = true;
    const title = s.$('[data-hint-title]').textContent, summary = s.$('[data-hint-reason]').textContent;
    for (let i = 0; i < 8; i++) {
      time += 100; s.setModel(i % 2 ? ready : pending); assert.equal(s.ui.refresh(), false);
      assert.equal(s.$('[data-hints-primary]').children[0], card); assert.equal(s.doc.activeElement, button);
      assert.equal(s.$('.hints-main').scrollTop, 240); assert.equal(s.$('.hints-other').open, true);
      assert.equal(s.$('[data-hint-title]').textContent, title); assert.equal(s.$('[data-hint-reason]').textContent, summary);
      assert(!s.doc.body.textContent.includes('共通時刻を確認しています'));
    }
    s.setModel(pending); s.click('[data-hint-follow="b"]'); await drain();
    assert.deepEqual(s.events.at(-1), { id: 'b', open: true }); assert(s.ui.isOpen());
    assert.equal(s.$('[data-hints-primary]').children[0], card); s.ui.dispose();
  });
  await test('clock-only fallback never revives another identity, a blocked state, a closed dialog or expired advice', () => {
    let time = 1000; const pending = scope => report([hint('clock-pending', { title: '共通時刻を確認しています' })], { status: 'blocked', title: '共通時刻を確認しています', scope });
    const s = setup(report(), { now: () => time }); s.ui.open();
    s.setModel(pending('owner:other:castle')); s.ui.refresh(); assert.equal(s.$('[data-hint-follow="a"]'), null); assert(!s.doc.body.textContent.includes('共通時刻を確認しています'));
    s.setModel(report()); s.ui.refresh(); s.setModel(report([hint('account-banned')], { status: 'blocked', title: '利用停止中' })); s.ui.refresh(); assert.equal(s.$('[data-hint-follow="a"]'), null);
    s.setModel(pending('owner:first:castle')); s.ui.refresh(); assert.equal(s.$('[data-hint-follow="a"]'), null);
    s.setModel(report()); s.ui.refresh(); time = 31001; s.setModel(pending('owner:first:castle')); s.ui.refresh(); assert.equal(s.$('[data-hint-follow="a"]'), null);
    s.setModel(report()); s.ui.refresh(); s.ui.close(); s.setModel(pending('owner:first:castle')); s.ui.open(); assert.equal(s.$('[data-hint-follow="a"]'), null); s.ui.dispose();
  });
  await test('saving, applying, conflict, settlement and walking waits keep existing cards and the town entry still', () => {
    let time=1000;const s=setup(report(),{now:()=>time}),entry=s.doc.createElement('section');
    entry.setAttribute('data-hint-entry','');entry.innerHTML='<strong data-hint-title></strong><p data-hint-reason></p>';s.doc.body.append(entry);s.ui.open();
    const card=s.$('[data-hints-primary]').children[0],button=s.$('[data-hint-follow="b"]'),main=s.$('.hints-main'),details=s.$('.hints-other'),heading=s.$('[data-hint-title]'),summary=s.$('[data-hint-reason]');
    button.focus();main.scrollTop=237;details.open=true;const writes=[heading.writes,summary.writes];
    for(const context of [{syncReady:false,syncReason:'initializing'},{clockReady:false},{syncReason:'applying'},{syncReason:'conflict'},{syncReason:'writer',syncMessage:'占領した拠点の集計と報酬を同期しています。'},{syncReason:'local',syncMessage:'実行中の操作の結果を確認しています。完了後にヒントを更新します。'}]){
      time+=100;const model=waitingReport(context);assert.equal(model.status,'blocked');assert.equal(model.transient,true);s.setModel(model);assert.equal(s.ui.refresh(),false);
      assert.strictEqual(s.$('[data-hints-primary]').children[0],card);assert.strictEqual(s.doc.activeElement,button);assert.equal(main.scrollTop,237);assert(details.open);
      assert.deepEqual([heading.writes,summary.writes],writes);assert(!/自動保存しています|同期しています|操作の結果を確認しています/.test(s.doc.body.textContent));
    }
    s.ui.dispose();
  });
  await test('first-load waits use one fixed card without routine progress text or an invented navigation action', () => {
    const s=setup(waitingReport({syncReady:false,syncReason:'initializing'}));s.ui.open();
    const card=s.$('[data-hints-primary]').children[0];assert.equal(s.$('[data-hints-title]').textContent,'次の一手');assert(card.querySelector('button').hidden);
    for(const context of [{syncReason:'applying'},{syncReason:'conflict'},{clockReady:false},{syncReason:'writer',syncMessage:'占領した拠点の集計と報酬を同期しています。'}]){
      s.setModel(waitingReport(context));assert.equal(s.ui.refresh(),false);assert.strictEqual(s.$('[data-hints-primary]').children[0],card);
      assert(!/自動保存|同期しています|保存データを確認|操作を再開する準備/.test(s.doc.body.textContent));assert(card.querySelector('button').hidden);
    }
    s.ui.dispose();
  });
  await test('real connection, role, account and storage problems replace retained advice immediately', () => {
    for(const context of [...['offline','error','auth','follower','identity','access-changed'].map(syncReason=>({syncReason,syncMessage:'実際の接続問題です。'})),{banned:true},{rolePending:true},{saveEnabled:false}]){
      const s=setup(report(),{now:()=>1000});s.ui.open();const model=waitingReport({syncReady:false,clockReady:false,...context});
      assert.notEqual(model.transient,true);s.setModel(model);s.ui.refresh();assert.equal(s.$('[data-hint-follow="a"]'),null);assert.equal(s.$('[data-hints-title]').textContent,model.title);
      s.setModel(waitingReport());s.ui.refresh();assert.equal(s.$('[data-hint-follow="a"]'),null,'a later wait must not revive advice from before a real problem');s.ui.dispose();
    }
  });
  await test('changing transient phases never extends thirty seconds or transfers advice to a new scope', () => {
    let time=1000;const s=setup(report(),{now:()=>time});s.ui.open();
    time=30999;s.setModel(waitingReport({syncReason:'applying'}));s.ui.refresh();assert(s.$('[data-hint-follow="a"]'));
    time=31000;s.setModel(waitingReport({syncReason:'conflict'}));s.ui.refresh();assert.equal(s.$('[data-hint-follow="a"]'),null);assert(!s.doc.body.textContent.includes('自動保存'));
    time=2000;s.setModel(waitingReport());s.ui.refresh();assert.equal(s.$('[data-hint-follow="a"]'),null,'expired advice cannot return after a clock rollback');
    s.setModel(report());s.ui.refresh();s.setModel(waitingReport({syncReason:'applying'},'owner:replacement:castle'));s.ui.refresh();assert.equal(s.$('[data-hint-follow="a"]'),null);assert.equal(s.$('.hints-main').scrollTop,0);s.ui.dispose();
  });
  await test('reordered visible candidates preserve the same focused action node', () => {
    const s = setup(); s.ui.open(); const button = s.$('[data-hint-follow="b"]'); button.focus(); s.$('.hints-main').scrollTop = 110;
    s.setModel(report(['b', 'a', 'c', 'd', 'e'].map(id => hint(id)))); s.ui.refresh(); assert.equal(s.$('[data-hints-primary]').children[0], button.parentElement); assert.equal(s.doc.activeElement, button); assert.equal(s.$('.hints-main').scrollTop, 110); s.ui.dispose();
  });
  await test('a new identity scope clears old private text, feedback and expanded state immediately', async () => {
    const s = setup(); s.ui.open(); s.$('.hints-other').open = true; s.click('[data-hint-follow="a"]'); await drain(); assert.equal(s.$('[data-hints-feedback]').hidden, false);
    s.$('.hints-main').scrollTop = 310; s.$('[data-hint-follow="b"]').focus(); s.setModel(report([hint('new', { title: '新しい領主の候補' })], { scope: 'owner:second:castle' })); s.ui.refresh();
    assert.equal(s.$('[data-hint-follow="a"]'), null); assert.equal(s.$('.hints-other').open, false); assert.equal(s.$('[data-hints-feedback]').hidden, true); assert.equal(s.$('.hints-main').scrollTop, 0); assert.equal(s.doc.activeElement, s.$('#hints-title')); assert.equal(s.$('[data-hints-primary]').children[0].querySelector('h3').textContent, '新しい領主の候補'); s.ui.dispose();
  });
  await test('navigation is checked before closing, and failed current candidates keep the dialog open', async () => {
    const s = setup(); s.ui.open(); s.click('[data-hint-follow="a"]'); await drain(); assert.deepEqual(s.events[0], { id: 'a', open: true }); assert.equal(s.ui.isOpen(), true); assert.equal(s.$('[data-hints-feedback]').textContent, '候補を確認してください。'); assert.equal(s.$('[data-hint-follow="a"]').disabled, false);
    s.onFollow(() => { s.ui.close(); return { ok: true }; }); s.click('[data-hint-follow="b"]'); await drain(); assert.equal(s.ui.isOpen(), false); assert.equal(s.doc.activeElement, s.entry); s.ui.open(); assert.equal(s.$('[data-hints="guide"]').disabled, false); s.ui.dispose();
  });
  await test('a delayed failure for a previous identity cannot restore feedback or old candidates', async () => {
    const s = setup(), wait = deferred(); s.onFollow(() => wait.promise); s.ui.open(); s.click('[data-hint-follow="a"]');
    s.setModel(report([hint('new')], { scope: 'owner:new:castle' })); s.ui.refresh(); wait.resolve({ ok: false, message: '前の領主の結果' }); await drain(); assert.equal(s.$('[data-hints-feedback]').hidden, true); assert.equal(s.$('[data-hint-follow="a"]'), null); assert.equal(s.$('[data-hint-follow="new"]').disabled, false); assert.equal(s.$('[data-hints="guide"]').disabled, false); s.ui.dispose();
  });
  await test('guide navigation uses its own read-only bridge callback and Escape restores focus', async () => {
    const s = setup(); s.onHelp(() => { s.ui.close(); return { ok: true }; }); s.ui.open(); s.click('[data-hints="guide"]'); await drain(); assert.deepEqual(s.events[0], { help: true, open: true }); assert.equal(s.ui.isOpen(), false); s.ui.open(); const event = s.$('#hints-modal').dispatch('cancel'); assert(event.prevented); assert.equal(s.ui.isOpen(), false); assert.equal(s.doc.activeElement, s.entry); s.ui.dispose();
  });
  await test('no-candidate states replace previous suggestions without inventing an action', () => {
    const s = setup(); s.ui.open(); s.setModel(report([], { status: 'blocked', title: '同期を確認しています' })); s.ui.refresh(); assert.equal(s.$('[data-hints-primary]').children.length, 0); assert.equal(s.$('.hints-other').hidden, true); assert.equal(s.$('[data-hints-empty]').hidden, false); assert.equal(s.$('[data-hints-title]').textContent, '同期を確認しています'); s.ui.dispose();
  });
  await test('text cannot create markup, and resource formatting only exposes the five known assets', () => {
    const item = normalize(report([hint('a', { title: '<script>attack()</script>', reason: '<img src=x onerror=attack()>', cost: { gold: 1234, rice: -1, unknown: 44 }, missing: { stone: 22 }, waitSeconds: 0 })])).items[0];
    const html = assetsMarkup(item); assert.match(html, /金銭/); assert.match(html, /1,234/); assert.match(html, /石材/); assert(!html.includes('unknown')); assert(!html.includes('兵糧'));
    const s = setup(report([hint('a', { title: item.title, reason: item.reason })])); s.ui.open(); assert.equal(s.$('script'), null); assert.equal(s.$('img'), null); assert.equal(s.$('h3').textContent, item.title); assert.equal(formatWait(0), '0秒'); assert.equal(formatWait(60), '1分'); assert.equal(formatWait(3661), '1時間1分1秒'); s.ui.dispose();
  });
  console.log('\n' + checks + ' hint UI checks passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
