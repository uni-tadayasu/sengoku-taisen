const assert=require('node:assert/strict');
globalThis.window=globalThis;
require('../officers-data.js');require('../engine.js');
const Engine=globalThis.SengokuEngine,D=globalThis.SENGOKU_DATA;
const make=options=>new Engine({clan:'織田家',seed:4321,...options});
const copy=value=>JSON.parse(JSON.stringify(value));
const id='of_45e0f4cb36ad',key=id+':U',stats=officer=>['lead','valor','intellect','politics'].map(name=>officer[name]);
let count=0;
function test(name,run){run();count++;console.log('PASS '+name);}

test('authenticated deputies receive all-100 Yoshihisa with the commander specialty',()=>{
  assert.deepEqual(D.deputyAssets,{castleId:'kagoshima',officerId:id,rank:'U'});
  const g=make({isDeputy:true}),officer=g.officer(id);
  assert.equal(officer.name,'島津義久');assert.equal(officer.rank,'U');assert.equal(officer.skill,'commander');
  assert.equal(officer.deputyExclusive,true);assert.deepEqual(stats(officer),[100,100,100,100]);
  assert.deepEqual(officer.baseStats,{lead:100,valor:100,intellect:100,politics:100});assert.equal(officer.rankBonus,0);
  assert.equal(g.state.officers.filter(value=>value===id).length,1);assert.equal(g.state.officerVariants.filter(value=>value===key).length,1);
  assert.deepEqual(g.officerViews([id])[0],officer);assert.deepEqual(g.officerViews([id],'U')[0],officer);
  assert.equal(globalThis.SENGOKU_OFFICERS.length,280);assert.equal(g.collection().totalVariants,2071);
});

test('ordinary Yoshihisa and lower paintings retain their original abilities and availability',()=>{
  const ordinary=make({clan:'島津家'});ordinary._grantOfficerVariant(id,'U');
  assert.deepEqual(stats(ordinary.officer(id)),[100,92,100,100]);assert(!ordinary.officer(id).deputyExclusive);
  assert(ordinary.gachaPool('U').some(o=>o.id===id));assert.equal(ordinary.baseOfficer(id).valor,77);
  const deputy=make({isDeputy:true});deputy._grantOfficerVariant(id,'SS');
  assert.deepEqual(stats(deputy.officer(id,'SS')),stats(ordinary.officer(id,'SS')));assert(!deputy.officer(id,'SS').deputyExclusive);
  deputy.state.officerVariants=deputy.state.officerVariants.filter(value=>value!==key);
  assert(!deputy.officer(id,'U').deputyExclusive);assert.equal(deputy.officer(id,'U').variantOwned,false);
  assert(deputy.restoreDeputyAssets().ok);assert(deputy.officer(id,'U').deputyExclusive);
});

test('appointment and legacy deputy saves add the painting without replacing formations or progress',()=>{
  const original=make(),before=copy(original.state),appointed=Engine.fromSave(original.exportSave(),original.roster,{isDeputy:true});
  assert.deepEqual(appointed.state.army,before.army);assert.deepEqual(appointed.state.resources,before.resources);
  assert.deepEqual(appointed.state.officerVariants,[...before.officerVariants,key]);
  const legacy=JSON.parse(appointed.exportSave());legacy.state.officers=legacy.state.officers.filter(value=>value!==id);legacy.state.officerVariants=legacy.state.officerVariants.filter(value=>!value.startsWith(id+':'));delete legacy.state.officerHealth.values[id];
  const restored=Engine.fromSave(legacy,original.roster,{isDeputy:true});assert(restored.officer(id).deputyExclusive);assert.deepEqual(restored.state.army,before.army);
  assert.equal(restored.state.stats.recruited,legacy.state.stats.recruited+1);
  const again=Engine.fromSave(restored.exportSave(),original.roster,{isDeputy:true});assert.deepEqual(again.state,restored.state);
});

test('restore is idempotent and never pays refunds, resources or free healing',()=>{
  const g=make({isDeputy:true});g.state.officerHealth.values[id]=35;const before=copy(g.state);
  for(let i=0;i<3;i++){const result=g.restoreDeputyAssets();assert.equal(result.ok,true);assert.equal(result.changed,false);}
  assert.deepEqual(g.state,before);
  g.state.officerVariants=g.state.officerVariants.filter(value=>value!==key);
  const restored=g.restoreDeputyAssets();assert.equal(restored.ok,true);assert.equal(restored.changed,true);
  assert.equal(g.state.officerHealth.values[id],35);assert.deepEqual(g.state.resources,before.resources);
  assert.equal(g.state.magatama,before.magatama);assert.deepEqual(g.state.stats,before.stats);
});

test('saved flags and non-deputy roles cannot authorize the painting or restore action',()=>{
  const deputy=make({isDeputy:true}),forged=JSON.parse(deputy.exportSave());
  forged.state.isDeputy=true;forged.state.deputyExclusive=true;
  for(const options of [{},{isAdmin:true,isDeputy:true},{isStaff:true,isDeputy:true}]){
    const g=Engine.fromSave(forged,deputy.roster,options);assert.equal(g.isDeputy,false);assert(!g.officer(id).deputyExclusive);
    const before=copy(g.state);assert.equal(g.restoreDeputyAssets().ok,false);assert.deepEqual(g.state,before);
  }
  const fresh=make({isDeputy:true}),before=copy(fresh.state);assert.equal(fresh.restoreDeputyAssets({assignCommander:'yes'}).ok,false);assert.deepEqual(fresh.state,before);
});

test('dismissal immediately removes special abilities and reappointment restores them without duplicating copies',()=>{
  const g=make({clan:'島津家'});g._grantOfficerVariant(id,'U');const ordinary=copy(g.officer(id)),variants=copy(g.state.officerVariants),army=copy(g.state.army);
  assert(g.setRoleAccess({isDeputy:true}).ok);assert(g.officer(id).deputyExclusive);assert.deepEqual(g.state.army,army);
  assert(g.setRoleAccess({}, {deputyReturnHome:'uchijo'}).ok);assert.deepEqual(g.officer(id),ordinary);assert.deepEqual(g.state.officerVariants,variants);
  assert(g.setRoleAccess({isDeputy:true}).ok);assert(g.officer(id).deputyExclusive);assert.deepEqual(g.state.officerVariants,variants);
  const saved=JSON.parse(g.exportSave());assert(!Object.hasOwn(saved.state,'deputyExclusive'));assert(!Object.hasOwn(saved.state,'isDeputy'));
});

test('explicit commander deployment uses existing formation and governor assignment rules',()=>{
  const g=make({isDeputy:true}),oldArmy=copy(g.state.army),resources=copy(g.state.resources),command=g.state.command;
  assert(g.assignGovernor('farm',id).ok);
  const result=g.restoreDeputyAssets({assignCommander:true});assert.equal(result.ok,true);assert.equal(result.commanderAssigned,true);
  assert.deepEqual(g.state.army,[id,...oldArmy.slice(0,2)]);assert(!Object.values(g.state.governors).includes(id));
  assert.deepEqual(g.state.resources,resources);assert.equal(g.state.command,command);
  const before=copy(g.state);assert.equal(g.restoreDeputyAssets({assignCommander:true}).changed,false);assert.deepEqual(g.state,before);
});

test('a stationed officer stays stationed when commander deployment is rejected',()=>{
  const g=make({isDeputy:true});g.state.castles.nijo.owner=g.state.clan;
  g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,commanders:[id]}];
  const before=copy(g.state);const result=g.restoreDeputyAssets({assignCommander:true});
  assert.equal(result.ok,false);assert.equal(result.granted,true);assert.equal(result.commanderAssigned,false);assert.match(result.message,/支拠点/);
  assert.deepEqual(g.state,before);assert.equal(g.restoreDeputyAssets().ok,true);
});

test('combat and formation simulation use the deputy abilities without changing the real state',()=>{
  const g=make({isDeputy:true});assert(g.assignArmy([id]).ok);
  const a=g.armyStats();assert.equal(a.lead,100);assert.equal(a.valor,100);assert.equal(a.intellect,100);
  const target=g.adjacentTargets().find(c=>g.canOwnCastle(c.id));assert(target);
  const expected=g.battleAnalysis(target.id,'balanced',300),before=copy(g.state),simulated=g.simulateArmy({castleId:target.id,tactic:'balanced',troops:300,army:[id]});
  assert.equal(simulated.attackPower,expected.attackPower);assert.deepEqual(g.state,before);
  const ordinary=Engine.fromSave(g.exportSave(),g.roster),encounter=g.roamingEncounters()[0].id;
  assert(g.previewRoamingBattle(encounter,'balanced',300).attackPower>ordinary.previewRoamingBattle(encounter,'balanced',300).attackPower);
});

console.log('PASS deputy officer: '+count+' scenarios');
