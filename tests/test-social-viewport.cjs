'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../social-viewport.js'), 'utf8');
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }
function node(extra = {}) {
  const attributes = new Map();
  return { attributes, hasAttribute: key => attributes.has(key), setAttribute: (key, value) => attributes.set(key, value), removeAttribute: key => attributes.delete(key), ...extra };
}
function harness({ width = 390, height = 844, points = 0, coarse = false, tabs = null, mentionMenu = null } = {}) {
  const vars = new Map(), frames = new Map(), mutations = [], queries = { dialog: 0, body: 0 }; let sequence = 0;
  const input = { value: '作戦を送ります', selectionStart: 3, selectionEnd: 3 }, send = {};
  const form = { contains: target => target === input || target === send };
  const body = node({ querySelector: () => { queries.body++; return chat; }, querySelectorAll: () => [] });
  const chat = { parentElement: body, querySelector: () => form };
  const dialog = node({ open: true, matches: selector => selector === '.social-dialog', querySelector: selector => { queries.dialog++; return selector === '.social-tabs' ? tabs : selector === '#social-chat-mention-menu' ? mentionMenu : body; } });
  const document = {
    body: {}, readyState: 'complete', activeElement: input,
    documentElement: { style: { getPropertyValue: key => vars.get(key), setProperty: (key, value) => vars.set(key, value), removeProperty: key => vars.delete(key) } },
    querySelectorAll: selector => selector.startsWith('[data-') ? [dialog, body] : [dialog],
    addEventListener() {}, removeEventListener() {}
  };
  const environment = {
    document, navigator: { maxTouchPoints: points }, innerWidth: width, innerHeight: height,
    visualViewport: { width, height, offsetLeft: 0, offsetTop: 0, addEventListener() {}, removeEventListener() {} },
    matchMedia: () => ({ matches: coarse, addEventListener() {}, removeEventListener() {} }),
    addEventListener() {}, removeEventListener() {},
    requestAnimationFrame: callback => { frames.set(++sequence, callback); return sequence; },
    cancelAnimationFrame: id => frames.delete(id),
    MutationObserver: class { constructor(callback) { mutations.push(callback); } observe() {} disconnect() {} }
  };
  vm.runInNewContext(source, { window: environment });
  const api = environment.SengokuSocialViewport;
  function refresh() {
    api.refresh(); let passes = 0;
    while (frames.size) { assert(++passes < 6); const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); }
  }
  return { environment, document, input, send, dialog, body, vars, api, refresh, queries, mutate: records => mutations[0](records), pending: () => frames.size };
}
test('narrow mouse windows use a bounded chat history and visible composer', () => {
  for (const width of [320, 390, 768, 820, 1024]) {
    const h = harness({ width }); h.refresh();
    assert(h.dialog.hasAttribute('data-touch-chat'), width + 'px');
    assert(h.body.hasAttribute('data-touch-chat-layout'));
    assert(!h.dialog.hasAttribute('data-touch-compact'));
  }
});
test('keyboard resize preserves the draft, caret and send-button position', () => {
  const h = harness(); h.refresh();
  Object.assign(h.environment.visualViewport, { height: 310, offsetTop: 124 }); h.refresh();
  assert(h.dialog.hasAttribute('data-touch-compact')); assert(h.dialog.hasAttribute('data-touch-composing'));
  assert.equal(h.vars.get('--social-viewport-height'), '310.000px'); assert.equal(h.vars.get('--social-viewport-top'), '124.000px');
  assert.equal(h.document.activeElement, h.input); assert.equal(h.input.value, '作戦を送ります'); assert.equal(h.input.selectionStart, 3); assert.equal(h.input.selectionEnd, 3);
  h.document.activeElement = h.send; h.refresh(); assert(h.dialog.hasAttribute('data-touch-composing'), 'Tapping Send must retain the same compact composer');
  h.document.activeElement = {}; h.refresh(); assert(!h.dialog.hasAttribute('data-touch-composing'));
});
test('desktop resizing restores normal chat layout without replacing its input', () => {
  const h = harness({ width: 1440 }); h.refresh(); assert(!h.body.hasAttribute('data-touch-chat-layout'));
  h.environment.innerWidth = h.environment.visualViewport.width = 430; h.refresh(); assert(h.body.hasAttribute('data-touch-chat-layout'));
  h.environment.innerWidth = h.environment.visualViewport.width = 1440; h.refresh(); assert(!h.body.hasAttribute('data-touch-chat-layout')); assert(!h.dialog.hasAttribute('data-touch-chat')); assert.equal(h.document.activeElement, h.input);
});
test('wide touch tablets retain their composer with an attached fine pointer', () => {
  const h = harness({ width: 1366, points: 5 }); h.refresh(); assert(h.body.hasAttribute('data-touch-chat-layout'));
});
test('keyboard focus inside the portalled mention picker keeps the same compact composer', () => {
  const option = {}, close = {}, mentionMenu = { contains: target => target === option || target === close };
  const h = harness({ height: 310, mentionMenu }); h.refresh();
  for (const active of [option, close, h.input, h.send]) {
    h.document.activeElement = active; h.refresh();
    assert(h.dialog.hasAttribute('data-touch-composing'));
    assert(h.body.hasAttribute('data-touch-chat-layout'));
    assert.equal(h.input.value, '作戦を送ります');
  }
  h.document.activeElement = {}; h.refresh(); assert(!h.dialog.hasAttribute('data-touch-composing'));
});
test('closing and disposing dialogs releases temporary layout without altering text', () => {
  const h = harness({ height: 390 }); h.refresh(); h.dialog.open = false; h.refresh();
  assert(!h.body.hasAttribute('data-touch-chat-layout')); assert(!h.dialog.hasAttribute('data-touch-composing'));
  h.api.destroy(); assert.equal(h.vars.size, 0); assert.equal(h.input.value, '作戦を送ります');
});
test('offscreen selected tabs reveal within their strip without moving the profile or draft', () => {
  for (const width of [320, 820, 1440]) {
    let geometryReads = 0, selected;
    const tabs = {
      clientWidth: Math.min(width - 32, 1000), scrollWidth: 1600, scrollLeft: 0,
      querySelector: () => selected,
      getBoundingClientRect() { geometryReads++; return { left: 16, right: 16 + this.clientWidth }; }
    };
    const tabAt = (left, right) => ({ getBoundingClientRect() { geometryReads++; return { left: left - tabs.scrollLeft, right: right - tabs.scrollLeft }; } });
    selected = tabAt(1350, 1450);
    const h = harness({ width, tabs }); h.body.scrollTop = 417; h.refresh();
    assert.equal(tabs.scrollLeft, 1450 - (16 + tabs.clientWidth) + 8);
    assert.equal(h.body.scrollTop, 417); assert.equal(h.document.activeElement, h.input);
    assert.equal(h.input.value, '作戦を送ります'); assert.equal(h.input.selectionStart, 3);
    const afterReveal = geometryReads;
    tabs.scrollLeft = 200; // Reading the menu manually must survive quiet polls.
    for (let i = 0; i < 30; i++) h.refresh();
    assert.equal(tabs.scrollLeft, 200); assert.equal(geometryReads, afterReveal);
    selected = tabAt(16, 100); h.refresh();
    assert(tabs.scrollLeft <= 0, 'Switching back to the first tab reveals it');
  }
});
test('reopening and resizing reveal the selected tab while closed dialogs never move', () => {
  const tabs = {
    clientWidth: 500, scrollWidth: 1400, scrollLeft: 0,
    querySelector: () => selected,
    getBoundingClientRect: () => ({ left: 0, right: tabs.clientWidth })
  };
  const selected = { getBoundingClientRect: () => ({ left: 1000 - tabs.scrollLeft, right: 1100 - tabs.scrollLeft }) };
  const h = harness({ tabs }); h.refresh(); assert.equal(tabs.scrollLeft, 608);
  h.dialog.open = false; tabs.scrollLeft = 0; h.refresh(); assert.equal(tabs.scrollLeft, 0);
  h.dialog.open = true; h.refresh(); assert.equal(tabs.scrollLeft, 608);
  tabs.clientWidth = 300; h.refresh(); assert.equal(tabs.scrollLeft, 808);
  h.api.destroy();
});
test('background conversation updates never schedule layout for retained closed dialogs', () => {
  const h = harness(); h.refresh();
  const target = { nodeType: 1, closest: () => h.dialog, matches: () => false };
  const text = { nodeType: 3 }, element = { nodeType: 1 };
  for (let i = 0; i < 100; i++) h.mutate([{ type: 'childList', target, addedNodes: [text], removedNodes: [text] }]);
  assert.equal(h.pending(), 0, 'Timestamp and counter text never schedules composer work');
  h.mutate([{ type: 'childList', target, addedNodes: [element], removedNodes: [] }]);
  assert.equal(h.pending(), 1, 'Replacing the visible chat/form still schedules one pass'); h.refresh();
  h.dialog.open = false; h.refresh();
  const settled = { ...h.queries };
  for (let i = 0; i < 100; i++) {
    h.mutate([{ type: 'childList', target, addedNodes: [element], removedNodes: [element] }]);
    assert.equal(h.pending(), 0, 'Closed history updates remain idle');
    h.refresh();
  }
  assert.deepEqual(h.queries, settled, 'Resize and focus updates skip already-cleared closed history');
  assert.equal(h.input.value, '作戦を送ります'); assert.equal(h.input.selectionStart, 3);
  h.dialog.open = true;
  h.mutate([{ type: 'attributes', attributeName: 'open', target: { ...target, matches: () => true } }]);
  assert.equal(h.pending(), 1); h.refresh();
  assert(h.body.hasAttribute('data-touch-chat-layout'), 'Reopening restores the composer normally');
  h.mutate([{ type: 'attributes', attributeName: 'aria-selected', target }]);
  assert.equal(h.pending(), 1, 'Selecting another visible conversation tab remains responsive');
  h.api.destroy();
});
console.log(checks + ' compact conversation behavior checks passed.');
