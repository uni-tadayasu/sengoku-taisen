'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {setup, Node} = require('./helpers/dom-model.cjs');
const {transformSync} = require('esbuild');

// Exercise the actual lifecycle with controllable animation completions and
// MutationObserver delivery. The DOM fixture has no layout/animation engine.
const {doc, host: main} = setup();
const timers = new Map(), frames = new Map();
let handle = 0, mutation;
Object.defineProperties(Node.prototype, {
  className: {get() { return this.getAttribute('class') || ''; }, set(value) { this.setAttribute('class', value); }},
  children: {get() { return this.childNodes.filter(node => node.nodeType === 1); }},
  childElementCount: {get() { return this.children.length; }}
});
Node.prototype.animate = function () { return {cancel() {}}; };
doc.documentElement = doc.createElement('html');
doc.readyState = 'complete';
doc.getElementById = id => doc.querySelector('#' + id);
doc.addEventListener = doc.body.addEventListener.bind(doc.body);
doc.removeEventListener = doc.body.removeEventListener.bind(doc.body);
main.id = 'main';
main.dataset.view = 'town';
main.innerHTML = '<header class="page-heading"><span class="chapter-symbol"></span></header><button>施設</button>';
const style = {display:'block', visibility:'visible', position:'static', transform:'none', opacity:'1', getPropertyValue:() => ''};
let mediaQuery;
const system = new EventTarget();
system.matches = false;
const win = Object.assign(new EventTarget(), {
  document:doc, innerWidth:1024, innerHeight:768, getComputedStyle:() => style, matchMedia(query) { mediaQuery = query; return system; },
  requestAnimationFrame(fn) { frames.set(++handle, fn); return handle; }, cancelAnimationFrame:id => frames.delete(id),
  setTimeout(fn) { timers.set(++handle, fn); return handle; }, clearTimeout:id => timers.delete(id),
  MutationObserver:class { constructor(fn) { mutation = fn; } observe() {} disconnect() {} }
});
vm.runInNewContext(fs.readFileSync(require.resolve('../interaction-motion.js'), 'utf8'), {window:win});
function flush(queue) {
  for (const [id, fn] of [...queue]) { queue.delete(id); fn(); }
}
const heading = main.querySelector('header'), button = main.querySelector('button');
const waveCount = () => doc.querySelectorAll('.ui-motion-clip').length;
const click = () => button.dispatchEvent({type:'click', detail:0});
button.focus();
mutation(); flush(frames);
assert.equal(heading.hasAttribute('data-chronicle-entry'), false);
main.dataset.view = 'map'; mutation(); flush(frames);
assert(heading.hasAttribute('data-chronicle-entry'));
flush(timers);
assert.equal(heading.hasAttribute('data-chronicle-entry'), false);
mutation(); assert.equal(frames.size, 0, 'Same view must not replay on a clock/DOM refresh');
for (let i = 0; i < 10; i++) click();
assert.equal(waveCount(), 6, 'Rapid activations reuse the bounded effect lifetime');
assert.equal(doc.querySelectorAll('.ui-motion-layer').length, 1);
assert.equal(doc.querySelectorAll('[data-raden-seal]').length, 0, 'Ordinary controls only use the stroke');
button.classList.add('hotspot'); click();
assert.equal(doc.querySelectorAll('.ui-motion-clip[data-raden-seal]').length, 1);
assert.equal(button.hasAttribute('data-raden-seal'), false, 'The protected facility target must never receive the seal overlay');
assert.equal(doc.querySelector('.ui-motion-layer').inert, true);
assert.strictEqual(doc.activeElement, button);
flush(timers);
assert.equal(doc.querySelector('.ui-motion-layer'), null);

assert.deepEqual(mediaQuery.split(',').map(part => part.trim()).sort(), ['(forced-colors: active)', '(prefers-contrast: more)', '(prefers-reduced-motion: reduce)']);
for (const setting of ['system', 'quiet']) {
  if (setting === 'system') system.matches = true;
  else doc.documentElement.setAttribute('data-presentation-motion', 'quiet');
  main.dataset.view = setting === 'system' ? 'army' : 'officers'; mutation(); flush(frames);
  click();
  assert.equal(heading.hasAttribute('data-chronicle-entry'), false, setting);
  assert.equal(waveCount(), 0, setting);
  system.matches = false;
}
doc.documentElement.setAttribute('data-presentation-motion', 'standard');
click(); assert.equal(waveCount(), 1);
win.dispatchEvent(new Event('sengoku-presentation-change'));
assert.equal(waveCount(), 0);
win.SengokuMotion.destroy();
click(); assert.equal(waveCount(), 0);
console.log('PASS view entry and cleanup, 10 rapid activations bounded to 6 clips, preserved focus, system/quiet suppression and preference change cleanup.');

const sheet = fs.readFileSync(require.resolve('../raden-motion.css'), 'utf8');
const {code, warnings} = transformSync(sheet, {loader:'css', minifyWhitespace:true});
assert.deepEqual(warnings, []);
// esbuild normalizes CSS whitespace and quotes. Retain rule ancestry when
// checking the three display preferences so an unrelated guarded block cannot
// accidentally satisfy a check for an unconditional animation elsewhere.
const scopes = [], activations = [];
for (const [, body, delimiter] of code.matchAll(/([^{}]*)([{}])/g)) {
  if (delimiter === '{') { scopes.push(body.trim()); continue; }
  if (/(?:^|;)animation:/.test(body)) {
    const selector = scopes.at(-1), media = scopes.slice(0,-1).join(' ');
    for (const preference of ['prefers-reduced-motion:no-preference','forced-colors:none','prefers-contrast:no-preference']) {
      assert(media.includes(preference), selector + ' must honor ' + preference);
    }
    let depth = 0, start = 0;
    for (let i = 0; i <= selector.length; i++) {
      if (selector[i] === '(') depth++;
      if (selector[i] === ')') depth--;
      if (depth === 0 && (selector[i] === ',' || i === selector.length)) {
        const branch = selector.slice(start, i).trim();
        assert(branch.startsWith('html[data-presentation-motion=standard][data-cyber-fx=full]'), branch);
        assert.match(branch,/body\.at-title #launch-screen|\[data-chronicle-entry\]|dialog\[open\]|\.ui-motion-clip/,'Unexpected idle animation on '+branch);
        start = i + 1;
      }
    }
    assert.doesNotMatch(body,/\binfinite\b/);
    if (selector.includes('::')) assert.match(body,/(?:^|;)pointer-events:none(?:;|$)/);
    activations.push(selector);
  }
  scopes.pop();
}
for (const trigger of ['body.at-title #launch-screen', '[data-chronicle-entry]', 'dialog[open]', '.ui-motion-clip::after', '.ui-motion-clip[data-raden-seal]::before']) {
  assert(activations.some(selector => selector.includes(trigger)), 'Missing effect for ' + trigger);
}
console.log('PASS bounded title, chapter, dialog and input CSS effects under system, contrast, quiet and low-decoration gates.');
