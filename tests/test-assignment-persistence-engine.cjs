/* Save/reload and authenticated-role boundaries use the real engine and roster. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {SengokuEngine:E}=require('../engine.js');
const scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const create=options=>new E({officers:roster,clan:'織田家',seed:17,...options});
const save=game=>JSON.parse(game.exportSave());
const assignments=game=>structuredClone({army:game.state.army,governors:game.state.governors});
function arrange(game,{shared=false}={}){
  const [first,second,third,fourth]=game.state.officers;
  assert(game.assignArmy([third,first]).ok);
  assert(game.assignGovernor('farm',second).ok);
  if(shared)assert(game.assignGovernor('gold_mine',fourth).ok);
  return assignments(game);
}
function staffFixture(){
  const personal=create(),s=personal.state,buildings={...s.buildings,gold_mine:1};
  const base={id:'sunpu',revision:1,accessSinceElapsedMs:0,castleLevel:1,buildings,
    initial:{buildings:structuredClone(buildings),castleLevel:1},history:[],jobs:[],
    personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,
    personalSunpu:structuredClone(s.castles.sunpu),personalHomeCastle:structuredClone(s.castles[s.home])};
  const game=E.fromSave(personal.exportSave(),roster,{isStaff:true,staffBase:base});
  return {game,base,expected:arrange(game,{shared:true})};
}
let count=0;
function test(name,run){run();count++;console.log('PASS '+name);}

for(const role of [{},{isAdmin:true}])test(`${role.isAdmin?'operator':'ordinary'} custom army order and governors survive repeated reloads and role refreshes`,()=>{
  let game=create(role);const expected=arrange(game);
  for(let restart=0;restart<3;restart++){
    const stored=save(game),source=structuredClone(stored);
    game=E.fromSave(stored,roster,role);
    assert.deepEqual(stored,source,'Reading a save must not mutate its source object');
    assert.deepEqual(assignments(game),expected);
    game.setRoleAccess(role);
    assert.deepEqual(assignments(game),expected);
  }
});

test('an intentionally empty army stays empty after a reload instead of receiving the constructor army',()=>{
  let game=create();assert(game.assignArmy([]).ok);
  for(const [index,building]of ['farm','market','academy'].entries())assert(game.assignGovernor(building,game.state.officers[index]).ok);
  const expected=assignments(game);
  for(let restart=0;restart<3;restart++){game=E.fromSave(game.exportSave(),roster);assert.deepEqual(assignments(game),expected);}
});

test('legacy optional-field migration preserves custom assignments',()=>{
  const game=create(),expected=arrange(game),legacy=save(game);
  for(const key of ['officerVariants','gachaHistory','giftReceipts','walking','cycle'])delete legacy.state[key];
  const restored=E.fromSave(legacy,roster);
  assert.deepEqual(assignments(restored),expected);
  assert.deepEqual(assignments(E.fromSave(restored.exportSave(),roster)),expected);
});

test('verified staff reloads keep appointments on shared facilities absent from the personal estate',()=>{
  const fixture=staffFixture();let game=fixture.game;
  for(let restart=0;restart<3;restart++){
    const stored=save(game);
    assert.equal(stored.state.buildings.gold_mine,0,'Shared levels must not leak into personal saves');
    assert.deepEqual(stored.state.governors,fixture.expected.governors);
    game=E.fromSave(stored,roster,{isStaff:true,staffBase:fixture.base});
    assert.equal(game.state.buildings.gold_mine,1);
    assert.deepEqual(assignments(game),fixture.expected);
    game.setRoleAccess({isStaff:true});
    game.applyStaffBase({...fixture.base,revision:restart+2});
    assert.deepEqual(assignments(game),fixture.expected);
  }
});

test('an unverified imported staff view has no privileges and leaves its original source available for verification',()=>{
  const {game,base,expected}=staffFixture(),stored=save(game),source=structuredClone(stored);
  const unverified=E.fromSave(stored,roster);
  assert.equal(unverified.isStaff,false);
  assert.equal(unverified.isAdmin,false);
  assert.equal(unverified.canOwnCastle('sunpu'),false);
  assert.equal(unverified.getStaffBase(),null);
  assert.deepEqual(unverified.state.army,expected.army);
  assert.deepEqual(stored,source,'An unverified display must never replace the raw source used by the app');
  const verified=E.fromSave(stored,roster,{isStaff:true,staffBase:base});
  assert.deepEqual(assignments(verified),expected);
});

test('confirmed dismissal removes shared-only appointments while keeping the personal governor and army',()=>{
  const fixture=staffFixture(),expected={army:fixture.expected.army,governors:{farm:fixture.expected.governors.farm}};
  const stored=save(fixture.game),demoted=E.fromSave(stored,roster,{isStaff:false});
  assert.deepEqual(assignments(demoted),expected);
  assert.equal(demoted.canOwnCastle('sunpu'),false);
  assert.equal(demoted.state.buildings.gold_mine,0);
  fixture.game.setRoleAccess({isAdmin:false,isStaff:false});
  assert.deepEqual(assignments(fixture.game),expected);
  assert.equal(fixture.game.getStaffBase(),null);
  assert.deepEqual(assignments(E.fromSave(demoted.exportSave(),roster)),expected);
});

console.log(`${count} assignment persistence engine tests passed. No remote service or player data was accessed.`);
