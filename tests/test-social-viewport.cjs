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
function harness({ width = 390, height = 844, points = 0, coarse = false } = {}) {
  const vars = new Map(), frames = new Map(); let sequence = 0;
  const input = { value: '作戦を送ります', selectionStart: 3, selectionEnd: 3 }, send = {};
  const form = { contains: target => target === input || target === send };
  const body = node({ querySelector: () => chat, querySelectorAll: () => [] });
  const chat = { parentElement: body, querySelector: () => form };
  const dialog = node({ open: true, matches: selector => selector === '.social-dialog', querySelector: () => body });
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
    cancelAnimationFrame: id => frames.delete(id)
  };
  vm.runInNewContext(source, { window: environment });
  const api = environment.SengokuSocialViewport;
  function refresh() {
    api.refresh(); let passes = 0;
    while (frames.size) { assert(++passes < 6); const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback()); }
  }
  return { environment, document, input, send, dialog, body, vars, api, refresh };
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
test('closing and disposing dialogs releases temporary layout without altering text', () => {
  const h = harness({ height: 390 }); h.refresh(); h.dialog.open = false; h.refresh();
  assert(!h.body.hasAttribute('data-touch-chat-layout')); assert(!h.dialog.hasAttribute('data-touch-composing'));
  h.api.destroy(); assert.equal(h.vars.size, 0); assert.equal(h.input.value, '作戦を送ります');
});
console.log(checks + ' compact conversation behavior checks passed.');
