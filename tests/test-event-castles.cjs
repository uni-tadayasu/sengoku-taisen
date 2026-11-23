'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { SENGOKU_DATA } = require('../engine.js');
const catalog = require('../battle-catalog.js');
const target = (subject, data = SENGOKU_DATA) => catalog.targetCastleId(subject, data);
const entries = catalog.list(SENGOKU_DATA);
const historicalTargets = {
  nagashino: 'nagashino', kawagoe: 'kawagoe', ueda1: 'ueda', ueda2: 'ueda', odawara: 'odawara',
  oshijo: 'oshi', gifu: 'inabayama', osaka_winter: 'osaka', osaka_summer: 'osaka',
  gassantoda: 'gassan', koriyama: 'yoshida', kunohe: 'kunohe'
};

let passed = 0;
function check(name, test) {
  test(); passed++;
  console.log('PASS ' + name);
}

check('each selectable castle keeps its own map ID, including both Takamatsu and both Koriyama castles', () => {
  const sieges = entries.filter(b => b.category === 'castle');
  assert.equal(sieges.length, SENGOKU_DATA.castles.length);
  for (const battle of sieges) {
    const expected = battle.id.slice('castle:'.length);
    assert.equal(target(battle), expected);
    assert.equal(target({battleId: battle.id, battle, name: battle.name}), expected);
  }
});
check('every historical battle maps to its own represented castle or uses the scenario NPC', () => {
  const scenarios = entries.filter(b => b.category === 'historical');
  for (const battle of scenarios) {
    const expected = historicalTargets[battle.id.slice('history:'.length)] ?? null;
    assert.equal(target(battle.id), expected, battle.name);
    assert.equal(target({name: battle.name}), expected, battle.name);
  }
  for (const battle of entries.filter(b => b.category === 'roaming')) {
    assert.equal(target(battle), null);
    assert.equal(target({name: battle.name}), null);
  }
});
check('name-only plans handle genuine alternate labels, palace and castle suffixes and full-width input', () => {
  for (const [name, expected] of [
    [' 江戸 城 の 戦い　', 'edo'], ['　江戸の戦い', 'edo'], ['京都御所の戦い', 'kyoto_gosho'],
    ['駿府の戦い','sunpu'], ['山口館の戦い','yamaguchi'], ['金沢御坊の戦い','kanazawa'],
    ['河越城の戦い', 'kawagoe'], ['川越夜戦', 'kawagoe'], ['清須城の戦い', 'kiyosu'],
    ['大阪城の戦い', 'osaka'], ['大阪冬の陣', 'osaka'], ['岐阜の戦い','inabayama'],
    ['第２次 上田合戦', 'ueda'], ['躑躅ケ崎館の戦い','tsutsujigasaki']
  ]) assert.equal(target({name}), expected, name);
});
check('old homonyms require a qualifier, and a duplicate displayed name never selects the first record', () => {
  for (const name of ['高松城の戦い','高松の戦い','郡山城の戦い','郡山の戦い'])
    assert.equal(target({name}), null, name);
  for (const [name, expected] of [
    ['備中高松城の戦い','takamatsu'], ['讃岐高松城の戦い','sanuki_takamatsu'],
    ['大和郡山城の戦い','yamato_koriyama'], ['吉田郡山城の戦い','yoshida']
  ]) assert.equal(target({name}), expected, name);
  const synthetic = {castles: [{id: 'a', name: '江戸城'}, {id: 'b', name: '江戸城'}]};
  assert.equal(target({name: '江戸の戦い'}, synthetic), null);
  const duplicate = {castles: [{id: 'nagashino', name: '長篠城'}, {id: 'other', name: '長篠城'}]};
  assert.equal(target({name: '長篠の戦い'}, duplicate), null);
  assert.equal(target({battleId: 'history:nagashino'}, duplicate), 'nagashino');
});
check('unrepresented castles, nearby battlefields and stale or contradictory IDs fall back without guessing from the title', () => {
  for (const name of ['上田原の戦い','関ヶ原の戦い','川中島の戦い','長谷堂城の戦い','伏見城の戦い',
    '大津城の戦い','江戸と駿府の戦い','江戸城外の戦い','江戸城の戦い・後編','の戦い','石山合戦','']) {
    assert.equal(target({name}), null, name);
  }
  for (const battleId of ['castle:missing','history:missing','roaming:vanguard','invalid:id',''])
    assert.equal(target({battleId, name: '江戸城の戦い'}), null, battleId);
  assert.equal(target({battleId: 'castle:edo', battle: {id: 'castle:sunpu'}}), null);
  assert.equal(target('history:gifu', {castles: []}), null);
  assert.equal(target({name: '岐阜城の戦い'}, {castles: []}), null);
  assert.equal(target(null), null);
});
check('browser and Worker run the same versioned catalogue source', () => {
  assert.equal(fs.readFileSync(require.resolve('../battle-catalog.js'), 'utf8'),
    fs.readFileSync(require.resolve('../server/battle-catalog.js'), 'utf8'));
});
console.log(passed + ' event castle matching groups passed.');
