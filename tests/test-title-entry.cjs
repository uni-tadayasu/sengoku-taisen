'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {setup} = require('./helpers/dom-model.cjs');

async function testEntry() {
  const {doc, host} = setup();
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  host.innerHTML = html.slice(html.indexOf('<a href="#launch-enter"'), html.indexOf('<noscript>'));
  doc.getElementById = id => doc.querySelector('#' + id);
  doc.readyState = 'complete';
  doc.body.classList.add('at-title');
  doc.body.classList.toggle = (name, enabled) => enabled ? doc.body.classList.add(name) : doc.body.classList.remove(name);
  const steps = [];
  const waiting = [];
  const win = {
    SENGOKU_AT_TITLE: true,
    SengokuBridge: {hasStarted: () => false, renderGameplay() { assert.equal(win.SENGOKU_AT_TITLE, false); steps.push('draw'); }, openStartSelection() { steps.push('select'); }},
    SengokuArt: {decorate() {}, readyCurrent: () => new Promise(resolve => waiting.push(resolve))}
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'boot.js'), 'utf8'), {
    window: win, document: doc, requestAnimationFrame: cb => cb(), setTimeout, clearTimeout, performance
  });
  const skip = doc.getElementById('game-skip-link');
  const status = doc.getElementById('art-load-status');
  const loading = doc.getElementById('game-loading');
  assert.deepEqual(steps, [], 'opening the title must not start gameplay painting');
  win.SengokuTitle.enter();
  win.SengokuTitle.enter();
  assert.deepEqual(steps, ['draw', 'select'], 'paint once, then open the start selection');
  assert.equal(doc.activeElement.id, 'main');
  assert.equal(skip.getAttribute('href'), '#main');
  assert.equal(loading.hidden, true, 'Optional art must not open a blocking dialog');
  await Promise.resolve();
  assert.equal(waiting.length, 1, 'Selection opened even though the artwork is pending');
  const nextView = win.SengokuLoading.ready();
  await Promise.resolve();
  await new Promise(resolve => setTimeout(resolve, 440));
  assert.equal(status.hidden, false);
  waiting[0]();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(status.hidden, false, 'An old view must not end the current view’s status');
  win.SengokuTitle.home();
  assert.equal(skip.getAttribute('href'), '#launch-enter');
  assert.equal(status.hidden, true);
  assert.equal(doc.activeElement.id, 'launch-enter');
  waiting[1]();
  await nextView;
  assert.equal(status.hidden, true);
  win.SengokuTitle.enter();
  assert.deepEqual(steps, ['draw', 'select', 'draw', 'select']);
  await Promise.resolve();waiting.at(-1)();
  console.log('PASS title entry, skip targets and stale-artwork handling while images are still downloading.');
}
testEntry().catch(error => {console.error(error);process.exitCode = 1;});
