const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { SengokuEngine, SENGOKU_DATA } = require('../engine.js');
const scope = { window: {} };
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../officers-data.js'), 'utf8'), scope);
const roster = JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
assert.equal(roster.length, 281);
assert.equal(new Set(roster.map(o => o.id)).size, 281);
assert.equal(new Set(roster.map(o => o.name)).size, 281);
const ranks = ['D','C','B','A','S','SS','SSS','U'];
const expected = [40,52,48,42,30,30,22,17];
for (let i = 0; i < ranks.length; i++) assert.equal(roster.filter(o => o.rank === ranks[i]).length, expected[i]);
for (const officer of roster) {
  assert(ranks.includes(officer.rank));
  assert.equal(officer.rarity, officer.rank);
  for (const field of ['lead','valor','intellect','politics']) assert(Number.isInteger(officer[field]) && officer[field] >= 1 && officer[field] <= 100);
}
for (const clan of SENGOKU_DATA.clans) {
  const game = new SengokuEngine({officers:roster,clan:clan.name,seed:11});
  assert.equal(game.state.officers.length, 4);
  assert(game.state.officers.some(id => game.officer(id).name === clan.leader));
  assert.deepEqual(SengokuEngine.fromSave(game.exportSave(),roster).state, game.state);
}
assert.equal(SENGOKU_DATA.castles.length, 130);
assert.equal(SENGOKU_DATA.buildings.length, 64);
assert.equal(SENGOKU_DATA.buildingLimit, 32);
console.log('PASS actual roster: 281 unique people, 8 exact rank counts, all 8 playable families, and game-save roundtrips.');
