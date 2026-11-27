const assert=require('node:assert/strict');
globalThis.window=globalThis;
require('../officers-data.js');require('../engine.js');
const Engine=globalThis.SengokuEngine,D=globalThis.SENGOKU_DATA;
const make=options=>new Engine({clan:'織田家',seed:4321,...options});
const copy=value=>JSON.parse(JSON.stringify(value));
let count=0;
function test(name,run){run();count++;console.log('PASS '+name);}
test('Kagoshima is reserved for an authenticated deputy, separate from Kyoto and Edo',()=>{
  assert.equal(D.deputyBaseId,'kagoshima');
  assert.throws(()=>make({startCastle:'kagoshima'}));
  const deputy=make({isDeputy:true});assert(deputy.isDeputy);assert(!deputy.isAdmin&&!deputy.isStaff);
  assert.equal(deputy.state.home,'kagoshima');assert.equal(deputy.state.cycle.home,'kagoshima');
  assert.equal(deputy.relocateResidence('inuyama',{role:'lord'}).code,'RESIDENCY_FIXED_HOME');
  assert(!make().canOwnCastle('kagoshima'));assert(deputy.canOwnCastle('kagoshima'));
  const admin=make({isAdmin:true,isDeputy:true});assert(!admin.isDeputy);assert.equal(admin.state.home,'edo');
});
test('appointments move home progress and retain personal assets; dismissals restore the requested ordinary home',()=>{
  const g=make({startCastle:'inuyama'}),old=g.state;
  old.castles.inuyama={...old.castles.inuyama,troops:321,wall:7,level:8};old.resources.gold=12345;old.magatama=321;
  const assets=copy(old.resources),officers=copy(old.officerVariants),appointed=Engine.fromSave(g.exportSave(),g.roster,{isDeputy:true});
  assert.equal(appointed.state.home,'kagoshima');assert.equal(appointed.state.castles.kagoshima.troops,321);assert.equal(appointed.state.castles.kagoshima.level,8);
  assert.notEqual(appointed.state.castles.inuyama.owner,appointed.state.clan);assert.deepEqual(appointed.state.resources,assets);assert.deepEqual(appointed.state.officerVariants,officers);
  const again=Engine.fromSave(appointed.exportSave(),g.roster,{isDeputy:true});assert.deepEqual(again.state.castles.kagoshima,appointed.state.castles.kagoshima);
  const dismissed=Engine.fromSave(appointed.exportSave(),g.roster,{deputyReturnHome:'inuyama'});assert.equal(dismissed.state.home,'inuyama');assert.equal(dismissed.state.castles.inuyama.troops,321);assert.equal(dismissed.state.castles.inuyama.level,8);assert.deepEqual(dismissed.state.resources,assets);assert.equal(dismissed.state.magatama,321);
});
test('save flags do not grant the deputy role and legacy Kagoshima holdings migrate safely',()=>{
  const g=make(),save=JSON.parse(g.exportSave());save.state.isDeputy=true;save.state.home='kagoshima';save.state.cycle.home='kagoshima';save.state.castles.kagoshima={owner:save.state.clan,troops:345,wall:3,level:5};
  const ordinary=Engine.fromSave(save,g.roster);assert(!ordinary.isDeputy);assert.notEqual(ordinary.state.home,'kagoshima');assert(!ordinary.ownedCastleIds().includes('kagoshima'));assert.equal(ordinary.state.castles[ordinary.state.home].troops,345);
});
test('dismissal permits recorded major city homes while protected homes and automatic fallbacks remain excluded',()=>{
  for(const home of ['nijo','osaka','nagoya']){
    const original=make();original.state.home=home;original.state.cycle.home=home;original.state.castles[home]={owner:original.state.clan,troops:789,wall:11,level:24};
    const appointed=Engine.fromSave(original.exportSave(),original.roster,{isDeputy:true});assert.equal(appointed.state.home,'kagoshima');assert.equal(appointed.state.castles.kagoshima.level,24);
    const dismissed=Engine.fromSave(appointed.exportSave(),original.roster,{deputyReturnHome:home});assert.equal(dismissed.state.home,home);assert.equal(dismissed.state.cycle.home,home);assert.equal(dismissed.state.castles[home].level,24);assert.equal(dismissed.state.castles[home].troops,789);assert(!dismissed.isDeputy);assert(!dismissed.ownedCastleIds().includes('kagoshima'));
    const automatic=Engine.fromSave(appointed.exportSave(),original.roster);assert(!D.majorCityIds.includes(automatic.state.home));assert.notEqual(automatic.state.home,'kagoshima');
    for(const protectedHome of ['edo','kyoto_gosho','kagoshima']){const forbidden=Engine.fromSave(appointed.exportSave(),original.roster,{deputyReturnHome:protectedHome});assert(!D.majorCityIds.includes(forbidden.state.home));assert(!forbidden.ownedCastleIds().includes(protectedHome));}
  }
});
test('calendar settlement keeps the active deputy home and cannot revive it after dismissal',()=>{
  const boundary=D.worldCalendar.monthsPerCycle*60000,clock=elapsedMs=>({id:'deputy-cycle',elapsedMs,running:true,speed:1,revision:0}),g=make({isDeputy:true});
  g.state.castles.kagoshima.level=24;g.state.castles.nijo.owner=g.state.clan;g.state.buildings.keep=16;const variants=copy(g.state.officerVariants);
  assert(g.applyWorldClock(clock(boundary-1000)).ok);const result=g.applyWorldClock(clock(boundary));assert(result.ok);assert.equal(result.cycleRewards.length,1);assert.equal(g.state.home,'kagoshima');assert.equal(g.state.cycle.home,'kagoshima');assert.equal(g.state.cycle.index,1);assert.equal(g.state.castles.kagoshima.level,24);assert.deepEqual(g.state.officerVariants,variants);
  const dismissed=Engine.fromSave(g.exportSave(),g.roster,{deputyReturnHome:'osaka'});assert.equal(dismissed.state.home,'osaka');assert.equal(dismissed.state.cycle.home,'osaka');assert.equal(dismissed.state.cycle.index,1);assert(!dismissed.isDeputy);assert(!dismissed.ownedCastleIds().includes('kagoshima'));
  const restored=Engine.fromSave(dismissed.exportSave(),g.roster);assert.equal(restored.state.home,'osaka');assert.equal(restored.state.castles.osaka.level,24);assert.equal(restored.state.buildings.keep,16);assert.deepEqual(restored.state.officerVariants,variants);assert(!restored.canOwnCastle('kagoshima'));
  const next=restored.applyWorldClock(clock(boundary*2),{maxSeconds:86400});assert(next.ok&&!next.pending);assert.equal(restored.state.cycle.index,2);assert.equal(restored.state.home,'osaka');assert.equal(restored.state.cycle.home,'osaka');assert(!restored.ownedCastleIds().includes('kagoshima'));
});
test('victory grants rewards without capturing or damaging the protected NPC base',()=>{
  const g=make({clan:'島津家',startCastle:'uchijo'});g.state.troops=100000;g.state.resources.rice=100000;g.random=()=>0;
  const before=copy(g.state.castles.kagoshima),gold=g.state.resources.gold,roster=copy(g.state.officerVariants);
  const result=g.attack('kagoshima','balanced',10000);assert(result.ok);assert(result.battle.won);assert.equal(result.battle.captured,false);assert.equal(result.battle.battleMode,'reward');
  assert.deepEqual(g.state.castles.kagoshima,before);assert.equal(g.state.resources.gold,gold+500);assert.equal(result.battle.rewards.rice,500);assert.equal(result.battle.rewards.magatama,0);assert.deepEqual(g.state.officerVariants,roster);
  assert(!g.state.captureRewards.includes('kagoshima'));assert.equal(result.battle.garrison,0);
  assert.doesNotMatch(result.message+result.battle.phases.map(phase=>phase.text).join(''),/占領|領有|サブ運営/);
  assert.doesNotThrow(()=>Engine.fromSave(g.exportSave(),g.roster));
});
test('defeat also keeps the protected castle and pays no victory reward',()=>{
  const g=make({clan:'島津家',startCastle:'uchijo'});g.random=()=>.9999;const before=copy(g.state.castles.kagoshima),gold=g.state.resources.gold;
  const result=g.attack('kagoshima','balanced',300);assert(result.ok);assert(!result.battle.won);assert.deepEqual(g.state.castles.kagoshima,before);assert.equal(g.state.resources.gold,gold);
});
test('CPU cycles cannot transfer Kagoshima, including an active deputy home',()=>{
  for(const options of [{},{isDeputy:true}]){const g=make(options),owner=g.state.castles.kagoshima.owner;for(let turn=6;turn<300;turn+=3){g.state.turn=turn;g._cpuTurn();assert.equal(g.state.castles.kagoshima.owner,owner);}if(options.isDeputy)assert.equal(g.state.home,'kagoshima');}
});
test('normal unification and autonomous conquest exclude protected Kagoshima',()=>{
  const g=make();assert(!g.getUnificationProof().targetCastleIds.includes('kagoshima'));
  assert(!g.compileStrategy('鹿児島城を攻める').ok);
  assert.equal(g.relocateResidence('kagoshima',{role:'retainer'}).code,'INVALID_CASTLE');
});
console.log('PASS deputy engine: '+count+' scenarios');
