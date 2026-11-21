/* Exercise the shipped selection guard and existing image guard without a
   browser session. Native editing/interaction defaults are modeled by events. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../selection-lock.js'), 'utf8');
const imageSource = fs.readFileSync(path.join(__dirname, '../image-protect.js'), 'utf8');
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }
function element(localName, attrs = {}, parentElement = null) {
  return { nodeType: 1, localName, parentElement, type: attrs.type || 'text',
    getAttribute: name => Object.hasOwn(attrs, name) ? String(attrs[name]) : null,
    closest: () => null,
  };
}
function harness({ touch = false, images = false } = {}) {
  const listeners = new Map();
  const selection = { text: 'existing editable range', removeAllRanges() { this.text = ''; } };
  const document = { readyState: 'loading',
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    getSelection: () => selection,
  };
  const window = { document, navigator: { maxTouchPoints: touch ? 5 : 0 }, getSelection: () => selection };
  const context = vm.createContext({ window, document });
  vm.runInContext(source, context);
  if (images) vm.runInContext(imageSource, context);
  function dispatch(type, target, extra = {}, nativeDefault = () => {}) {
    const event = { type, target, cancelable: true, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; }, ...extra };
    for (const listener of listeners.get(type) || []) listener(event);
    if (!event.defaultPrevented) nativeDefault();
    return event;
  }
  return { window, document, dispatch, selection };
}

test('desktop and touch page text cannot start a selection, including dynamically added text nodes', () => {
  for (const touch of [false, true]) {
    const h = harness({ touch });
    for (const tag of ['p', 'h1', 'h2', 'span', 'button', 'a', 'label', 'pre', 'th', 'td']) {
      const parent = element(tag), text = { nodeType: 3, parentElement: parent };
      let selected = false;
      assert(h.dispatch('selectstart', text, {}, () => selected = true).defaultPrevented, tag);
      assert.equal(selected, false);
    }
  }
});

test('all text-entry types and readonly connection/export fields retain native selection and copy', () => {
  const h = harness({ touch: true });
  const fields = [element('textarea'), element('textarea', { readonly: '' }),
    ...[undefined, 'text', 'search', 'tel', 'url', 'email', 'password', 'number', 'date', 'datetime-local', 'month', 'week', 'time', 'unknown-falls-back-to-text']
      .map(type => element('input', { ...(type ? { type } : {}), readonly: '' }))];
  for (const field of fields) {
    let selection = '', clipboard = '';
    assert(!h.dispatch('selectstart', field, {}, () => selection = 'saved connection code').defaultPrevented);
    assert(!h.dispatch('copy', field, {}, () => clipboard = selection).defaultPrevented);
    assert.equal(clipboard, 'saved connection code');
    assert(!h.dispatch('keydown', field, { key: 'ArrowLeft', shiftKey: true }).defaultPrevented);
    assert(!h.dispatch('keydown', field, { key: 'a', ctrlKey: true }).defaultPrevented);
  }
});

test('contenteditable inheritance respects false islands and editing re-enabled inside them', () => {
  const h = harness();
  for (const value of ['', 'true', 'TRUE', 'plaintext-only']) {
    const editor = element('div', { contenteditable: value }), span = element('span', {}, editor);
    const invalidInherited = element('span', { contenteditable: 'inherit' }, span);
    assert(!h.dispatch('selectstart', span).defaultPrevented);
    assert(!h.dispatch('selectstart', { nodeType: 3, parentElement: invalidInherited }).defaultPrevented);
    const island = element('div', { contenteditable: 'false' }, editor), label = element('b', {}, island);
    assert(h.dispatch('selectstart', label).defaultPrevented);
    const inner = element('div', { contenteditable: 'true' }, island), inputText = element('span', {}, inner);
    assert(!h.dispatch('selectstart', inputText).defaultPrevented);
    assert(!h.dispatch('selectstart', element('textarea', {}, island)).defaultPrevented);
  }
});

test('retargeted editor events and noncancelable selections are handled without clearing ranges', () => {
  const h = harness(), host = element('custom-editor'), input = element('input');
  assert(!h.dispatch('selectstart', host, { composedPath: () => [input, host, h.document] }).defaultPrevented);
  const p = element('p');
  assert(!h.dispatch('selectstart', p, { cancelable: false }).defaultPrevented);
  h.dispatch('selectionchange', input);
  assert.equal(h.selection.text, 'existing editable range');
});

test('map drag, pinch, double-tap/double-click and desktop zoom events retain their defaults', () => {
  for (const touch of [false, true]) {
    const h = harness({ touch }), map = element('div'), actions = [];
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'touchstart', 'touchmove', 'touchend', 'dblclick']) {
      assert(!h.dispatch(type, map, { detail: 2, touches: [{ target: map }, { target: map }] }, () => actions.push(type)).defaultPrevented);
    }
    assert.equal(actions.length, 7);
    assert(!h.dispatch('wheel', map, { ctrlKey: true }).defaultPrevented);
    assert(!h.dispatch('keydown', map, { key: '+', ctrlKey: true }).defaultPrevented);
    assert(!h.dispatch('keydown', map, { key: '0', metaKey: true }).defaultPrevented);
  }
});

test('sliders, selects and buttons still change values or activate by pointer and keyboard', () => {
  const h = harness({ touch: true });
  for (const field of [element('input', { type: 'range' }), element('select'), element('button'), element('input', { type: 'checkbox' })]) {
    let activations = 0;
    for (const type of ['pointerdown', 'pointermove', 'click', 'keydown', 'input', 'change']) {
      assert(!h.dispatch(type, field, { key: 'Enter' }, () => activations++).defaultPrevented);
    }
    assert.equal(activations, 6);
  }
  assert(!h.dispatch('selectstart', element('option', {}, element('select'))).defaultPrevented);
});

test('image protection retains copy menus and text dragging inside editable fields while still protecting artwork', () => {
  const h = harness({ images: true }), artwork = element('div');
  for (const field of [element('input', { readonly: '' }, artwork), element('textarea', { readonly: '' }, artwork), element('span', {}, element('div', { contenteditable: '' }, artwork))]) {
    field.closest = () => artwork;
    assert(!h.dispatch('contextmenu', field).defaultPrevented);
    assert(!h.dispatch('dragstart', field).defaultPrevented);
    assert(!h.dispatch('selectstart', field).defaultPrevented);
  }
  const image = element('img', {}, artwork);image.closest = () => image;
  assert(h.dispatch('contextmenu', image).defaultPrevented);
  assert(h.dispatch('dragstart', image).defaultPrevented);
});

console.log(checks + ' text-selection and editing behavior checks passed.');
