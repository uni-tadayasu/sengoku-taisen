const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../viewport-lock.js'), 'utf8');
const layoutSource = fs.readFileSync(path.join(__dirname, '../layout-controls.js'), 'utf8');
let checks = 0;
function test(name, run) { run(); checks++; console.log('PASS ' + name); }
function events(target = {}) {
  const listeners = new Map();
  return Object.assign(target, {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, values = {}) {
      const event = { type, cancelable: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values };
      for (const fn of listeners.get(type) || []) fn(event);
      return event;
    },
    listeners,
  });
}
function element() {
  const attrs = new Map(), styles = new Map(), classes = new Set();
  const node = events({ hidden: false, isConnected: true, dataset: {}, children: [], offsetHeight: 50,
    classList: { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name), toggle(name, active) { if (active) classes.add(name); else classes.delete(name); } },
    style: { getPropertyValue: name => styles.get(name) || '', setProperty: (name, value) => styles.set(name, value), removeProperty: name => styles.delete(name) },
    getAttribute: name => attrs.get(name) ?? null, setAttribute: (name, value) => attrs.set(name, String(value)), removeAttribute: name => attrs.delete(name), hasAttribute: name => attrs.has(name),
    getBoundingClientRect: () => ({ width: 1280, height: 900, x: 0, y: 0, left: 0, top: 0, right: 1280, bottom: 900 }),
    append(...nodes) { this.children.push(...nodes); }, insertBefore(node) { this.children.push(node); },
    querySelector: () => null, querySelectorAll: () => [], remove() { this.isConnected = false; }, focus() {},
  });
  return node;
}
function viewportHarness({ points = 5, coarse = false } = {}) {
  const root = element(), meta = element(), media = events({ matches: coarse });
  const original = 'width=device-width, initial-scale=1, viewport-fit=cover';
  meta.setAttribute('content', original);
  const document = events({ documentElement: root, querySelector: selector => selector === 'meta[name="viewport"]' ? meta : null });
  const window = events({ document, navigator: { maxTouchPoints: points }, matchMedia: () => media });
  vm.runInNewContext(source, { window });
  return { window, document, root, meta, media, original, api: window.SengokuViewportLock };
}
test('touch tablet with a fine pointer locks page scale before body creation', () => {
  const h = viewportHarness();
  assert(h.api.isActive()); assert(h.root.classList.contains('sengoku-touch-locked'));
  assert(h.meta.getAttribute('content').includes('minimum-scale=1'));
  assert(h.meta.getAttribute('content').includes('maximum-scale=1'));
  assert(h.meta.getAttribute('content').includes('user-scalable=no'));
  assert(h.meta.getAttribute('content').includes('viewport-fit=cover'));
});
test('scrolling, text entry and regular wheel events retain their browser defaults', () => {
  const h = viewportHarness(), target = { closest: () => null };
  assert(!h.document.dispatch('touchmove', { touches: [{ target }] }).defaultPrevented);
  assert(!h.document.dispatch('wheel', { target, deltaY: 100 }).defaultPrevented);
  assert(!h.document.dispatch('keydown', { key: 'a', target }).defaultPrevented);
  assert(!h.document.dispatch('keydown', { key: 'a', ctrlKey: true, target }).defaultPrevented);
});
test('native pinch and tablet browser zoom shortcuts are blocked outside maps', () => {
  const h = viewportHarness(), target = { closest: () => null };
  assert(h.document.dispatch('touchmove', { touches: [{ target }, { target }] }).defaultPrevented);
  assert(h.document.dispatch('gesturestart', { target }).defaultPrevented);
  assert(h.document.dispatch('gesturechange', { target }).defaultPrevented);
  assert(h.document.dispatch('wheel', { target, ctrlKey: true }).defaultPrevented);
  assert(h.document.dispatch('keydown', { target, key: '+', ctrlKey: true }).defaultPrevented);
  assert(h.document.dispatch('keydown', { target, key: '0', metaKey: true }).defaultPrevented);
});
test('map pinch and wheel reach the existing camera handlers without pointer interception', () => {
  const h = viewportHarness(), map = {}, target = { closest: selector => selector === '.sg-map-surface' ? map : null };
  assert(!h.document.dispatch('touchmove', { touches: [{ target }, { target }] }).defaultPrevented);
  assert(!h.document.dispatch('wheel', { target, ctrlKey: true }).defaultPrevented);
  assert(!h.document.listeners.has('pointerdown')); assert(!h.document.listeners.has('pointermove'));
  const outside = { closest: () => null };
  assert(h.document.dispatch('touchmove', { touches: [{ target }, { target: outside }] }).defaultPrevented);
  // Prevent Safari from scaling the page in addition to the map's own camera.
  assert(h.document.dispatch('gesturechange', { target }).defaultPrevented);
});
test('ordinary desktop keeps browser zoom and original viewport metadata', () => {
  const h = viewportHarness({ points: 0, coarse: false });
  assert(!h.api.isActive()); assert.equal(h.meta.getAttribute('content'), h.original);
  assert(!h.document.dispatch('gesturechange').defaultPrevented);
  assert(!h.document.dispatch('wheel', { ctrlKey: true }).defaultPrevented);
  assert(!h.document.dispatch('keydown', { ctrlKey: true, key: '+' }).defaultPrevented);
});
test('coarse-pointer change, orientation and page-cache restore keep policy current without rewriting layout', () => {
  const h = viewportHarness({ points: 0 });
  h.media.matches = true; h.media.dispatch('change'); assert(h.api.isActive());
  const locked = h.meta.getAttribute('content');
  h.window.dispatch('orientationchange'); h.window.dispatch('resize'); h.window.dispatch('pageshow');
  assert.equal(h.meta.getAttribute('content'), locked);
  h.media.matches = false; h.media.dispatch('change');
  assert(!h.api.isActive()); assert.equal(h.meta.getAttribute('content'), h.original);
  h.window.navigator.maxTouchPoints = 5; h.window.dispatch('pageshow'); assert(h.api.isActive());
  h.api.destroy(); assert.equal(h.meta.getAttribute('content'), h.original);
  assert(!h.document.dispatch('gesturechange').defaultPrevented);
});
function layoutHarness() {
  const root = element(), body = element(), app = element(), main = element(), sidebar = element(), header = element(), destination = element();
  const frames = [], media = events({ matches: false });
  const saved = JSON.stringify({ version: 1, values: { sidebar: 260, townHeight: 640, mapRatio: 65 } });
  const storage = new Map([['sengoku-layout-v1', saved]]);
  root.classList.add('sengoku-desktop-fit');
  header.getBoundingClientRect = () => ({ width: 1280, height: 90 });
  app.querySelector = selector => ({ '.sidebar': sidebar, '.topbar': header, '.sidebar-bottom': destination }[selector] || null);
  const doc = events({ documentElement: root, body, readyState: 'complete', hidden: false,
    getElementById: id => ({ app, main }[id] || null), querySelector: () => null, querySelectorAll: () => [],
    createElement(tag) { const node = element(); if (tag === 'section') { const feedback = element(), reset = element(), done = element(); node.querySelector = selector => ({ '#layout-resize-status': feedback, '[data-layout-reset]': reset, '[data-layout-done]': done }[selector] || null); } return node; },
  });
  const window = events({ document: doc, navigator: { maxTouchPoints: 0 }, matchMedia: () => media,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, cancelAnimationFrame() {}, clearTimeout() {},
    innerWidth: 1280, innerHeight: 900, getComputedStyle: () => ({ columnGap: '20px' }),
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
  });
  vm.runInNewContext(layoutSource, { window });
  function flush() { while (frames.length) frames.shift()(); }
  flush();
  return { window, root, destination, storage, saved, flush, api: window.SengokuLayout };
}
test('switching an existing desktop layout to touch clears geometry but preserves saved PC preferences', () => {
  const h = layoutHarness(), button = h.destination.children[0];
  assert.equal(h.root.style.getPropertyValue('--layout-sidebar-width'), '260.00px'); assert(!button.hidden);
  h.window.navigator.maxTouchPoints = 5;
  h.root.classList.add('sengoku-touch-locked');
  h.api.refresh(); h.flush();
  for (const attr of ['data-layout-sidebar', 'data-layout-townheight', 'data-layout-mapratio']) assert(!h.root.hasAttribute(attr));
  assert.equal(h.root.style.getPropertyValue('--layout-sidebar-width'), '');
  assert.equal(h.root.style.getPropertyValue('--layout-map-left'), '');
  assert(button.hidden); assert.equal(h.api.open(), false); assert.equal(h.api.reset(), false);
  assert.equal(h.storage.get('sengoku-layout-v1'), h.saved);
  h.window.navigator.maxTouchPoints = 0; h.root.classList.remove('sengoku-touch-locked');
  h.api.refresh(); h.flush(); assert.equal(h.root.style.getPropertyValue('--layout-sidebar-width'), '260.00px');
  assert(!button.hidden);
});
console.log(checks + ' touch viewport and layout behavior checks passed.');
