'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {SengokuEngine: Engine, SENGOKU_DATA: catalog} = require('../engine.js');
const command = require('../command-center.js');
const {setup} = require('./helpers/dom-model.cjs');

const clock = {ready: true, running: true, speed: 2, elapsedMs: 0, realNowMs: 1000000};
const game = new Engine({seed: 20, clan: '織田家'});
const journeys = [
  ['near', 120000, 'world'], ['pastMinute', 120001, 'world'],
  ['far', 600001, 'world'], ['due', 0, 'world'], ['return', 60000, 'real']
].map(([id, remaining, timeBasis]) => ({
  id, status: 'marching', phase: id === 'return' ? 'returning' : 'outbound',
  timeBasis, arrivesAtMs: remaining + (timeBasis === 'real' ? clock.realNowMs : 0),
  sourceName: '清洲城', targetName: '岡崎城', troops: 1600
}));
function operations(timing) {
  return command.buildOperations(game, {clock: timing, marches: journeys, catalog});
}
function ids(model, timeWindow, filter = 'all', query = '') {
  return Array.from(command.matchingOperations(model, filter, query, timeWindow), row => row.id);
}

const save = JSON.stringify(game.state);
let model = operations(clock);
assert.deepEqual(ids(model, 'minute').sort(), ['march:near', 'march:return']);
assert.deepEqual(ids(model, 'fiveMinutes').sort(), ['march:near', 'march:pastMinute', 'march:return']);
assert.deepEqual(ids(model, 'due'), ['march:due']);
assert.deepEqual(ids(model, 'minute', 'returning', ' 岡崎 '), ['march:return']);
assert.deepEqual(ids(model, 'minute', 'returning', '長篠'), []);
console.log('PASS minute boundaries, clock speed, mission type and query compose without losing overdue records');

model = operations({...clock, running: false});
assert.deepEqual(ids(model, 'paused').sort(), ['march:far', 'march:near', 'march:pastMinute']);
assert.deepEqual(ids(model, 'due'), ['march:due']);
assert.deepEqual(ids(model, 'minute'), ['march:return']);
model = operations({...clock, ready: false});
assert.equal(model.items.length, 5);
for (const row of model.items.filter(row => row.timeBasis === 'world')) {
  assert.equal(row.time, '共通時刻を確認中');
  assert.equal(row.sortMs, Infinity);
}
assert.deepEqual(ids(model, 'paused'), []);
assert.deepEqual(ids(model, 'due'), []);
assert.deepEqual(ids(model, 'minute'), ['march:return']);
assert.equal(JSON.stringify(game.state), save);
console.log('PASS unconfirmed and paused shared clocks remain distinct from due receipts and real-time journeys');

const buildingGame = new Engine({seed: 30});
Object.assign(buildingGame.state.resources, {gold: 1e6, rice: 1e6, wood: 1e6, stone: 1e6});
assert(buildingGame.upgrade('farm').ok);
assert(buildingGame.upgrade('farm').ok);
assert(buildingGame.research('cultivation').ok);
const oneSpeed = command.buildOperations(buildingGame, {catalog, clock: {...clock, speed: 1}});
const immediate = command.matchingOperations(oneSpeed, 'all', '', 'minute');
assert.deepEqual(immediate.map(row => row.category).sort(), ['construction', 'research']);
assert(immediate.every(row => !row.queued));
const accelerated = command.buildOperations(buildingGame, {catalog, clock});
const farms = command.matchingOperations(accelerated, 'construction', '田畑', 'minute');
assert.equal(farms.length, 2);
assert.equal(farms[1].queued, true);
assert.equal(farms[1].sortMs, 60000);
console.log('PASS consecutive real facility reservations enter the window at completion, alongside ongoing research');

const {doc, host} = setup();
let current = {...clock};
let snapshotReady = true;
let account = 'first';
const listeners = new Set();
const win = {
  document: doc, SENGOKU_DATA: catalog,
  SengokuWorldClock: {snapshot: () => ({ready: snapshotReady, clock: current})},
  SengokuSocial: {getExpansionContext: () => ({playerId: account})},
  SengokuTravelUI: {
    subscribe(listener) {
      listeners.add(listener);
      listener({active: journeys}, current);
      return () => listeners.delete(listener);
    }
  }
};
vm.runInNewContext(fs.readFileSync(require.resolve('../command-center.js'), 'utf8'), {window: win});
const ui = win.SengokuCommandCenter;
host.innerHTML = '<button>予定表を開く</button>';
host.querySelector('button').focus();
function open(options = {}) { assert(ui.open({getGame: () => game, ...options})); }
function emit() { for (const callback of listeners) callback({active: journeys}, current); }
function q(selector) { return doc.querySelector('dialog').querySelector(selector); }
function setWindow(value) {
  const picker = q('[data-command-window]');
  picker.value = value;
  picker.dispatchEvent({type: 'change'});
}
function visible() { return doc.querySelector('dialog').querySelectorAll('[data-command-operation]').length; }

open();
setWindow('minute');
assert.equal(visible(), 2);
const search = q('[data-command-query]');
search.value = '岡崎';
search.dispatchEvent({type: 'input'});
search.focus();
search.setSelectionRange(1, 2);
q('[data-command-scroll]').scrollTop = 85;
current = {...current, elapsedMs: 2};
emit();
assert.equal(visible(), 3);
assert.equal(doc.activeElement, search);
assert.equal(search.selectionStart, 1);
assert.equal(q('[data-command-scroll]').scrollTop, 85);
snapshotReady = false;
emit();
assert.equal(visible(), 1);
assert.match(q('[data-command-clock]').textContent, /共通時刻を確認中/);
snapshotReady = true;
current = {...current, speed: 1};
emit();
assert.equal(visible(), 1);
ui.close();
assert.equal(listeners.size, 0);
open();
assert.equal(q('[data-command-window]').value, 'minute');
assert.equal(q('[data-command-query]').value, '岡崎');
assert.equal(q('[data-command-scroll]').scrollTop, 85);
console.log('PASS subscribed refresh preserves input, focus, scroll and the time window across detail navigation');

setWindow('paused');
assert.equal(visible(), 0);
assert.equal(q('[data-command-reset]').hidden, false);
q('[data-command-reset]').dispatchEvent({type:'click'});
assert.equal(visible(), 5);
assert.equal(q('[data-command-window]').value, 'all');
assert.equal(q('[data-command-query]').value, '');
setWindow('due');
ui.close();
open({filter: 'returning'});
assert.equal(q('[data-command-window]').value, 'all');
assert.equal(visible(), 1);
setWindow('due');
account = 'second';
emit();
assert.equal(doc.querySelector('dialog').open, false);
open();
assert.equal(q('[data-command-window]').value, 'all');
assert.equal(visible(), 5);
ui.close();
assert.equal(listeners.size, 0);
console.log('PASS empty filters, direct category links and switched accounts recover without a stale time window');
