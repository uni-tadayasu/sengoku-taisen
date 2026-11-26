'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SengokuEngine} = require('../engine.js');
const read = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const source = read('app.js');
const start = source.indexOf('  function saveComparisonMarkup(');
const end = source.indexOf('\n  function confirmFileImport(', start);
assert(start > 0 && end > start);
const escapeSource = source.split('\n').find(line => line.includes('const esc ='));
const context = {window:{}};
vm.runInNewContext(read('officers-data.js'), context);
const compare = vm.runInNewContext(
  escapeSource + '\n' + source.slice(start, end) + '\nsaveComparisonMarkup', context);
const roster = context.window.SENGOKU_OFFICERS;
const current = new SengokuEngine({officers:roster, seed:11, startCastle:'kiyosu'});
const file = JSON.parse(current.exportSave());
file.state.resources.gold = 123456;
file.state.troops = 12345;
file.savedAt = '2026-11-27T01:23:45.000Z';
const candidate = SengokuEngine.fromSave(file, roster);
const currentBefore = JSON.stringify(current.state);
const candidateBefore = JSON.stringify(candidate.state);

function row(html, label) {
  const result = html.match(new RegExp('<tr><th scope="row">' + label + '</th>(.*?)</tr>'));
  assert(result, label);
  return result[1];
}
function test(label, callback) {
  callback();
  console.log('PASS ' + label);
}

test('comparison shows both validated saves, full resource counts, real castle names and recorded file time', () => {
  const html = compare(current, candidate, file, 'save.json');
  assert.match(html, /現在の戦役.*読み込むセーブ/);
  assert.match(html, /同じ戦役・同じ進行月/);
  assert.match(html, /ファイル内の保存日時[^<]*2026/);
  assert.match(row(html, '本拠'), /<td>清洲城<\/td><td>清洲城<\/td>/);
  assert.match(row(html, '進行年月'), /第1周 · 1560年1月/);
  assert.match(row(html, '領有拠点'), new RegExp(current.ownedCastleIds().length + '城'));
  assert.match(row(html, '手持ち兵'), /save-value-changed">12,345人/);
  assert.match(row(html, '金銭'), /save-value-changed">123,456/);
  for (const name of ['兵糧', '木材', '石材', '勾玉']) row(html, name);
  assert.match(html, /<details><summary>資源も比較する<\/summary>/);
  assert.equal(JSON.stringify(current.state), currentBefore);
  assert.equal(JSON.stringify(candidate.state), candidateBefore);
});
test('month comparisons use absolute turns across a calendar cycle and only for one identified campaign', () => {
  const later = SengokuEngine.fromSave(file, roster);
  later.state.turn = 672;
  assert.match(compare(current, later, file), /現在より672か月先/);
  assert.match(row(compare(current, later, file), '進行年月'), /第2周 · 1560年1月/);
  assert.match(compare(later, current, file), /現在より672か月前/);
  const foreign = new SengokuEngine({officers:roster, seed:17});
  const foreignHtml = compare(current, foreign, JSON.parse(foreign.exportSave()));
  assert.match(foreignHtml, /別の戦役/);
  assert.doesNotMatch(foreignHtml, /同じ戦役|か月前|か月先/);
});
test('legacy state-only saves and shared legacy identifiers have no claimed account match or manufactured timestamp', () => {
  const legacy = JSON.parse(JSON.stringify(file.state));
  delete legacy.walking;
  delete legacy.roaming;
  delete legacy.covert;
  const legacyGame = SengokuEngine.fromSave(legacy, roster);
  assert.equal(legacyGame.state.walking.campaignId, 'legacy_v1');
  const html = compare(current, legacyGame, legacy);
  assert.match(html, /識別情報がない/);
  assert.match(html, /保存日時　記録なし/);
  const resaved = JSON.parse(legacyGame.exportSave());
  assert.match(compare(legacyGame, legacyGame, resaved), /識別情報がない/);
});
test('untrusted filenames and invalid metadata remain plain text while preview and confirmation use the real checked route', () => {
  const weird = compare(current, candidate, {...file, savedAt:'invalid'}, '<img src=x onerror=call()> & "a"');
  assert.match(weird, /&lt;img src=x onerror=call\(\)&gt; &amp; &quot;a&quot;/);
  assert.doesNotMatch(weird, /<img|Invalid Date|NaN/);
  assert.match(weird, /保存日時　記録なし/);
  const handler = source.slice(source.indexOf("  $('#save-import').addEventListener('change'"), source.indexOf('\n  let installPrompt=null;'));
  assert(handler.indexOf('prepareFileImport(raw,scope)') < handler.indexOf('saveComparisonMarkup(game,importedGame,JSON.parse(raw),file.name)'));
  assert.match(handler, /data-action="confirm-import"/);
  assert.match(source, /if\(activeModal!=='import'\|\|!importedGame\)return false;/);
});
