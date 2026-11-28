'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setup, Node} = require('./helpers/dom-model.cjs');
const {transformSync} = require('esbuild');
const source = fs.readFileSync(require.resolve('../ambient-motion.js'), 'utf8');
const marker = 'data-ambient-visible';

// This deterministic fixture tests lifecycle and work bounds. The browser QA
// separately checks actual intersection geometry, clipping and rendered paint.
Object.defineProperty(Node.prototype, 'className', {
  get() { return this.getAttribute('class') || ''; },
  set(value) { this.setAttribute('class', value); }
});
const matches = Node.prototype.matches;
Node.prototype.matches = function (selector, scope) {
  if (selector.includes('.edition-mast') && selector.includes('input:not')) this.ownerDocument.ambientCandidateChecks = (this.ownerDocument.ambientCandidateChecks || 0) + 1;
  // The shared renderer fixture does not otherwise need this pseudo class.
  return matches.call(this, selector.replace(/:disabled\b/g, '[disabled]'), scope);
};
Node.prototype.getBoundingClientRect = function () {
  throw Error('Ambient lifecycle must not poll geometry.');
};
function events(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type) { for (const fn of [...listeners.get(type) || []]) fn({type}); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  }, extra);
}
function fixture(markup, {intersection = true} = {}) {
  const {doc, host} = setup();
  host.innerHTML = markup;
  Object.assign(doc, events(), {readyState: 'complete', hidden: false});
  doc.documentElement = doc.createElement('html');
  const root = doc.documentElement;
  root.setAttribute('data-presentation-motion', 'standard');
  root.setAttribute('data-cyber-fx', 'full');
  const timers = new Map(), observers = [], queries = [];
  const quiet = events({matches: false}), coarse = events({matches: false});
  const connection = events({saveData: false});
  let next = 0, io, computedReads = 0;
  function notify(record) {
    for (const observer of observers) {
      const {target, options} = observer;
      if (!target || (target !== record.target && (!options.subtree || !target.contains(record.target)))) continue;
      if (record.type === 'attributes' && (!options.attributes || options.attributeFilter && !options.attributeFilter.includes(record.attributeName))) continue;
      if (record.type === 'childList' && !options.childList) continue;
      if (record.type === 'characterData' && !options.characterData) continue;
      observer.callback([record]);
    }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    disconnect() { this.target = null; }
  }
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; this.observed = new Set(); io = this; }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.observed.clear(); }
    emit(elements = [...this.observed], visible = true) {
      this.callback(elements.filter(el => this.observed.has(el)).map(target => ({target, isIntersecting: visible, intersectionRatio: visible ? 1 : 0})));
    }
  }
  doc.onAttributeChange = record => notify({type: 'attributes', target: record.node, attributeName: record.name, oldValue: record.before});
  const win = events({
    document: doc, navigator: {connection}, MutationObserver,
    matchMedia(query) { queries.push(query); return query === '(pointer: coarse)' ? coarse : quiet; },
    getComputedStyle(el) { computedReads++; return {visibility: el.paintHidden ? 'hidden' : 'visible'}; },
    setTimeout(fn) { const id = ++next; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame() { throw Error('No animation frame loop is needed for ambient CSS.'); },
    setInterval() { throw Error('Ambient discovery must not poll.'); }
  });
  if (intersection) win.IntersectionObserver = IntersectionObserver;
  vm.runInNewContext(source, {window: win});
  function flush() {
    let turns = 0;
    while (timers.size) {
      assert(++turns < 8, 'An event must settle without creating recurring work.');
      for (const [id, fn] of [...timers]) { timers.delete(id); fn(); }
    }
  }
  function visible() { flush(); io?.emit(); flush(); }
  function preference(name, value) {
    root.setAttribute(name, value);
    notify({type: 'attributes', target: root, attributeName: name});
  }
  const marked = () => doc.querySelectorAll('[' + marker + '="true"]');
  const byId = id => doc.querySelector('#' + id);
  function stopped(label) {
    assert.equal(root.hasAttribute('data-ambient-running'), false, label);
    assert.equal(marked().length, 0, label + ': stale active paint');
    assert.equal(io?.observed.size || 0, 0, label + ': stale intersections');
    assert.equal(observers.filter(observer => observer.target === doc.body).length, 0, label + ': subtree work');
    assert.equal(timers.size, 0, label + ': pending work');
  }
  return {doc, host, root, win, quiet, coarse, connection, timers, observers, queries, io, flush, visible, preference, marked, byId, notify, stopped, reads: () => computedReads};
}

{
  const f = fixture('<header class="page-heading" id="heading">内政</header>' +
    Array.from({length: 90}, (_, i) => '<button id="control-' + i + '">命令</button>').join('') +
    Array.from({length: 45}, (_, i) => '<section class="panel" id="card-' + i + '">施設</section>').join(''));
  f.visible();
  assert.equal(f.marked().length, 64, 'Desktop has a fixed visible paint budget.');
  assert(f.byId('heading').hasAttribute(marker), 'Major shell should remain animated.');
  assert(f.marked().some(el => el.localName === 'button'));
  assert(f.marked().some(el => el.classList.contains('panel')), 'Controls must not starve cards.');
  const before = new Set(f.marked()), leaving = f.byId('control-0');
  f.io.emit([leaving], false); f.flush();
  assert.equal(leaving.hasAttribute(marker), false);
  assert.equal(f.marked().length, 64);
  assert(f.marked().some(el => !before.has(el)), 'Offscreen work must yield its slot.');
  f.coarse.matches = true; f.coarse.fire('change'); f.flush();
  assert.equal(f.marked().length, 40, 'Touch input uses the smaller active budget.');
  const disabled = f.marked().find(el => el.localName === 'button');
  disabled.disabled = true; f.flush();
  assert.equal(disabled.hasAttribute(marker), false);
  assert.equal(f.marked().length, 40, 'An unavailable control releases its slot.');
  const reads = f.reads(); f.flush(); f.flush();
  assert.equal(f.reads(), reads, 'Idle time must not reread styles.');
  f.win.SengokuAmbientMotion.destroy(); f.stopped('destroy');
}

{
  const f = fixture('<input id="draft" value="編集中の文章"><button id="ok">進む</button>' +
    '<button id="disabled" disabled>待機</button><button id="aria-disabled" aria-disabled="true">待機</button>' +
    '<button id="busy" aria-busy="true">準備中</button><section hidden><button id="hidden">隠す</button></section>' +
    '<section inert><button id="inert">隠す</button></section><section aria-hidden="true"><button id="aria-hidden">隠す</button></section>' +
    '<dialog><button id="closed-dialog">隠す</button></dialog><button id="marker" class="sg-map-marker">城</button>' +
    '<button id="hotspot" class="hotspot"><span role="button" id="hotspot-child">施設</span></button>' +
    '<button id="handle" data-layout-handle>配置</button><svg><g id="svg" role="button"></g></svg>' +
    '<section class="panel" id="paint-hidden">見えない</section><span id="clock">12:00</span>');
  f.byId('paint-hidden').paintHidden = true;
  const draft = f.byId('draft'); draft.focus(); draft.value = '入力途中を保つ';
  f.visible();
  for (const id of ['disabled','aria-disabled','busy','hidden','inert','aria-hidden','closed-dialog','marker','hotspot','hotspot-child','handle','svg','paint-hidden']) {
    assert.equal(f.byId(id).hasAttribute(marker), false, id + ' must not animate');
  }
  assert.equal(f.marked().length, 2);
  const stage = f.doc.querySelector('.ambient-atmosphere');
  assert.equal(stage.getAttribute('aria-hidden'), 'true'); assert.equal(stage.inert, true);
  assert.equal(stage.hasAttribute(marker), false);
  assert.strictEqual(f.doc.activeElement, draft); assert.equal(draft.value, '入力途中を保つ');
  const clock = f.byId('clock'), oldText = clock.firstChild, newText = f.doc.createTextNode('12:01');
  clock.replaceChildren(newText);
  f.notify({type: 'childList', target: clock, addedNodes: [newText], removedNodes: [oldText]});
  assert.equal(f.timers.size, 0, 'A text-only clock refresh must schedule no scan.');
  f.notify({type: 'characterData', target: newText});
  assert.equal(f.timers.size, 0);
  const added = f.doc.createElement('button'); added.id = 'added'; f.host.append(added);
  f.notify({type: 'childList', target: f.host, addedNodes: [added], removedNodes: []});
  f.visible(); assert(added.hasAttribute(marker));
  added.remove();
  f.notify({type: 'childList', target: f.host, addedNodes: [], removedNodes: [added]}); f.flush();
  assert.equal(added.hasAttribute(marker), false); assert.equal(f.io.observed.has(added), false);
  for (const [label, pause, resume] of [
    ['hidden tab', () => { f.doc.hidden = true; f.doc.fire('visibilitychange'); }, () => { f.doc.hidden = false; f.doc.fire('visibilitychange'); }],
    ['quiet setting', () => f.preference('data-presentation-motion', 'quiet'), () => f.preference('data-presentation-motion', 'standard')],
    ['low decoration', () => f.preference('data-cyber-fx', 'low'), () => f.preference('data-cyber-fx', 'full')],
    ['system accessibility', () => { f.quiet.matches = true; f.quiet.fire('change'); }, () => { f.quiet.matches = false; f.quiet.fire('change'); }],
    ['data saver', () => { f.connection.saveData = true; f.connection.fire('change'); }, () => { f.connection.saveData = false; f.connection.fire('change'); }],
    ['page cache', () => f.win.fire('pagehide'), () => f.win.fire('pageshow')]
  ]) {
    pause(); f.stopped(label); resume(); f.visible();
    assert.equal(f.root.getAttribute('data-ambient-running'), 'true', label + ': resume');
    assert.equal(f.marked().length, 2, label + ': visible surfaces resume');
    assert.equal(f.doc.querySelectorAll('.ambient-atmosphere').length, 1, label + ': reuse one stage');
    assert.strictEqual(f.doc.activeElement, draft); assert.equal(draft.value, '入力途中を保つ');
  }
  assert(f.queries.some(query => query.includes('prefers-reduced-motion') && query.includes('forced-colors') && query.includes('prefers-contrast')));
  f.win.SengokuAmbientMotion.destroy(); f.stopped('destroy');
  assert.equal(f.doc.querySelector('.ambient-atmosphere'), null);
  assert(f.observers.every(observer => !observer.target));
  assert.equal(f.doc.listenerCount() + f.win.listenerCount() + f.quiet.listenerCount() + f.coarse.listenerCount() + f.connection.listenerCount(), 0);
  f.io.emit(); f.win.SengokuAmbientMotion.refresh(); f.win.SengokuAmbientMotion.destroy();
  f.stopped('late callbacks after destroy');
}

{
  const f = fixture('<button id="underlying">背面</button><dialog open id="front"><button id="front-button">操作</button></dialog><dialog open id="other"><button id="other-button">別画面</button></dialog>');
  f.byId('front-button').focus(); f.visible();
  assert(f.byId('front-button').hasAttribute(marker));
  assert.equal(f.byId('underlying').hasAttribute(marker), false);
  assert.equal(f.byId('other-button').hasAttribute(marker), false, 'The focused dialog has priority over DOM order.');
  f.byId('front').open = false; f.byId('other-button').focus(); f.visible();
  assert(f.byId('other-button').hasAttribute(marker));
  assert.equal(f.byId('front-button').hasAttribute(marker), false);
  f.win.SengokuAmbientMotion.destroy();
}

{
  const f = fixture('<section id="list">' + Array.from({length: 960}, (_, i) => '<button id="large-' + i + '">命令</button>').join('') + '</section>');
  f.flush();
  const controls = [f.byId('large-0'), f.byId('large-1'), f.byId('large-2')];
  f.io.emit(controls); f.flush();
  f.doc.ambientCandidateChecks = 0;
  f.io.emit([controls[0]], false); f.flush();
  assert(f.doc.ambientCandidateChecks <= 2, 'Changing one intersection only rechecks the 2 visible candidates, not 960 retained controls.');
  assert.equal(f.marked().length, 2);
  f.io.emit(controls.slice(1));
  assert.equal(f.timers.size, 0, 'Repeated unchanged intersections do not schedule work.');
  f.doc.ambientCandidateChecks = 0;
  f.byId('list').classList.add('art-ready');
  assert.equal(f.timers.size, 0, 'Decoded panel artwork must not traverse the retained list.');
  assert.equal(f.doc.ambientCandidateChecks, 0);
  f.byId('list').setAttribute('hidden', ''); f.flush();
  assert.equal(f.marked().length, 0, 'Ancestor visibility still pauses all affected candidates.');
  f.byId('list').removeAttribute('hidden'); f.flush();
  assert.equal(f.marked().length, 2);
  f.win.SengokuAmbientMotion.destroy();
}

{
  const f = fixture('<section id="container"><button id="candidate">操作</button></section><span id="late">後から追加</span>');
  f.visible();
  const container = f.byId('container'), control = f.byId('candidate'), late = f.byId('late');
  container.classList.add('hotspot'); f.flush();
  assert.equal(control.hasAttribute(marker), false, 'Adding an exclusion to an ancestor releases descendant work.');
  assert.equal(f.io.observed.has(control), false);
  container.classList.remove('hotspot'); f.visible();
  assert(control.hasAttribute(marker), 'Removing an exclusion restores descendant admission.');
  late.setAttribute('role','button'); f.visible();
  assert(late.hasAttribute(marker), 'A new interactive role is registered without a subtree rescan.');
  late.setAttribute('role','separator'); f.flush();
  assert.equal(late.hasAttribute(marker), false);
  f.win.SengokuAmbientMotion.destroy();
}

{
  const f = fixture('<button>旧ブラウザー</button>', {intersection: false});
  assert.equal(f.root.getAttribute('data-ambient-running'), 'true');
  assert.equal(f.marked().length, 0, 'Without IO, retain only the decorative atmosphere.');
  assert.equal(f.timers.size, 0, 'No fallback geometry polling.');
  f.win.SengokuAmbientMotion.destroy(); f.stopped('fallback destroy');
}

// Follow each animation to its keyframes. Geometry or opacity animation on
// live UI would move hit targets or fade labels; only decorative pseudos may
// use those properties. This checks the emitted CSS rather than source wording.
const sheet = fs.readFileSync(require.resolve('../ambient-motion.css'), 'utf8');
const {code, warnings} = transformSync(sheet, {loader: 'css', minifyWhitespace: true});
assert.deepEqual(warnings, []);
const scopes = [], keyframes = new Map(), animations = [];
for (const [, body, delimiter] of code.matchAll(/([^{}]*)([{}])/g)) {
  if (delimiter === '{') { scopes.push(body.trim()); continue; }
  const frame = scopes.find(scope => scope.startsWith('@keyframes '));
  if (frame) {
    const name = frame.slice('@keyframes '.length);
    if (!keyframes.has(name)) keyframes.set(name, new Set());
    for (const match of body.matchAll(/(?:^|;)([\w-]+):/g)) keyframes.get(name).add(match[1]);
  } else {
    const animation = /(?:^|;)animation:([^;]+)/.exec(body);
    if (animation) {
      const selector = scopes.at(-1), media = scopes.slice(0, -1).join(' ');
      for (const preference of ['prefers-reduced-motion:no-preference', 'forced-colors:none', 'prefers-contrast:no-preference']) assert(media.includes(preference), selector + ' must honor ' + preference);
      assert(selector.includes('data-ambient-running=true'), selector + ': lifecycle gate');
      animations.push({selector, name: animation[1].split(' ')[0]});
    }
  }
  scopes.pop();
}
assert(animations.length > 0);
for (const {selector, name} of animations) {
  assert(keyframes.has(name), 'Missing keyframes for ' + name);
  if (!selector.includes('::')) {
    assert(selector.includes('data-ambient-visible=true'), 'Live targets require intersection admission.');
    assert.deepEqual([...keyframes.get(name)], ['border-top-color'], 'Live text and hit targets must stay stationary and opaque.');
  }
}
console.log('PASS ambient visible budgets, offscreen reuse, excluded targets, observer/timer cleanup, no clock polling, focus/input continuity, all preference lifecycle gates, dialog priority and decorative-only motion.');
