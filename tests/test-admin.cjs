const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D} = require('../engine.js');
const scope = {window:{}};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster = JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const IEYASU = 'of_b0616adde162';
const create = options => new E({officers:roster,seed:17,...options});
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}

test('ordinary Tokugawa starts with Ieyasu SSS and cannot choose Edo',()=>{
  assert.throws(()=>create({clan:'徳川家',startCastle:'edo'}),/江戸城以外/);
  const g=create({clan:'徳川家',startCastle:'okazaki'});
  assert.equal(g.isAdmin,false);
  assert.equal(g.state.home,'okazaki');
  assert.equal(g.officer(IEYASU).rank,'SSS');
  assert(g.ownsVariant(IEYASU,'SSS'));
  assert.equal(g.ownsVariant(IEYASU,'U'),false);
  assert.equal(g.canOwnCastle('edo'),false);
  assert.equal(g.canOwnOfficerVariant(IEYASU,'U'),false);
  assert.equal(g.collection().totalVariants,2047);
  assert.equal(g.unificationTarget(),127);
  const before=structuredClone(g.state);
  assert.equal(g.selectAdminCastle().ok,false);
  assert.equal(g.restoreAdminAssets().ok,false);
  assert.equal(g._grantOfficerVariant(IEYASU,'U'),null);
  assert.deepEqual(g.state,before);
  assert.equal(g.officer(IEYASU,'U').variantOwned,false,'artwork preview remains available');
});

test('direct recruitment and battlefield return grant ordinary Ieyasu at SSS',()=>{
  let g=create();
  g.state.resources.gold=999999;
  g.state.buildings.keep=12;
  assert.equal(g.recruitmentCost(IEYASU),1900);
  assert.equal(g.canRecruitOfficer(IEYASU).requiredLevel,12);
  assert(g.recruitOfficer(IEYASU).ok);
  assert.equal(g.highestOwnedRank(IEYASU),'SSS');
  g=create();
  for(const o of roster.filter(o=>o.clan==='徳川家'&&o.id!==IEYASU))g._grantOfficerVariant(o.id,o.rank);
  const target=g.adjacentTargets()[0].id;
  g.state.castles[target].owner='徳川家';
  g.state.castles[target].troops=100;
  g.state.troops=50000;
  g.state.resources.rice=999999;
  g.random=()=>0;
  const result=g.attack(target);
  assert(result.ok&&result.battle.won);
  assert.equal(result.battle.capturedOfficer,IEYASU);
  assert(g.ownsVariant(IEYASU,'SSS'));
  assert.equal(g.ownsVariant(IEYASU,'U'),false);
});

test('ordinary U draw pool contains 255 eligible people at the displayed exact odds',()=>{
  const g=create();
  g.state.magatama=999999;
  const pool=g.gachaPool('U');
  assert.equal(pool.length,255);
  assert.equal(pool.some(o=>o.id===IEYASU),false);
  assert.equal(g.gachaOdds().find(r=>r.rank==='U').perOfficerRate,1/255);
  for(let i=0;i<pool.length;i++){
    const rolls=[.995,(i+.5)/pool.length];g.random=()=>rolls.shift();
    const result=g.drawOfficers(1);
    assert(result.ok);
    assert.equal(result.results[0].officerId,pool[i].id);
    assert.equal(result.results[0].rank,'U');
  }
  let lower=0;
  for(const row of D.gacha.rates){
    if(row.rank==='U')continue;
    const eligible=g.gachaPool(row.rank),index=eligible.findIndex(o=>o.id===IEYASU);
    assert.equal(eligible.length,256);
    const rolls=[(lower+row.rate/2)/100,(index+.5)/eligible.length];g.random=()=>rolls.shift();
    const result=g.drawOfficers(1);assert(result.ok);
    assert.equal(result.results[0].officerId,IEYASU);
    assert.equal(result.results[0].rank,row.rank);
    lower+=row.rate;
  }
  assert.deepEqual(g.ownedRanks(IEYASU),D.ranks.filter(r=>r!=='U'));
  assert.equal(g.gachaPool('invalid').length,0);
});

test('every authenticated operator starts at fixed Edo and receives Ieyasu U once',()=>{
  const g=create({isAdmin:true});
  assert.equal(g.isAdmin,true);
  assert.equal(g.state.home,'edo');
  assert.equal(g.ownedCastles().length,1);
  assert(g.ownsVariant(IEYASU,'U'));
  assert.equal(g.gachaPool('U').length,256);
  assert.equal(g.collection().totalVariants,2048);
  assert.equal(g.unificationTarget(),128);
  const before=structuredClone(g.state);
  assert.equal(g.restoreAdminAssets().changed,false);
  assert.equal(g.restoreAdminAssets().changed,false);
  assert.deepEqual(g.state,before);
  assert.deepEqual(E.fromSave(g.exportSave(),roster,{isAdmin:true}).state,g.state);
  for(const clan of D.clans){
    const admin=create({isAdmin:true,clan:clan.name,startCastle:clan.home});
    assert.equal(admin.state.home,'edo');
    assert.equal(admin.state.castles.edo.owner,clan.name);
    assert.equal(admin.ownedCastles().length,1);
    assert.deepEqual(admin.state.captureRewards,['edo']);
  }
});

test('operator authentication fixes Edo while retaining both castle progress and campaign assets',()=>{
  const g=create(),home=g.state.home,recruited=g.state.stats.recruited;
  Object.assign(g.state.castles[home],{level:19,wall:7,troops:5432});
  Object.assign(g.state.castles.edo,{level:5,wall:12,troops:6543});
  g.state.resources.gold=987654;g.state.resources.wood=876543;g.state.resources.stone=765432;
  assert(g.upgradeCastle(home).ok);assert(g.upgrade('farm').ok);
  const original=structuredClone(g.state);
  const result=g.setAdminAccess(true);
  assert(result.ok&&result.changed);
  assert.equal(g.state.home,'edo');
  assert.deepEqual(g.state.castles.edo,{owner:g.state.clan,level:19,wall:12,troops:6543});
  assert.deepEqual(g.state.castles[home],original.castles[home]);
  for(const key of ['resources','buildings','jobs','troops','army','governors','tech','magatama','realtime'])assert.deepEqual(g.state[key],original[key],key);
  assert(g.state.captureRewards.includes(home));assert(g.state.captureRewards.includes('edo'));
  assert(g.ownsVariant(IEYASU,'U'));
  assert.equal(g.state.stats.recruited,recruited+1);
  const before=structuredClone(g.state);
  assert.equal(g.setAdminAccess(true).changed,false);
  assert.deepEqual(g.state,before);
  assert.equal(g.restoreAdminAssets({grantCastle:true}).changed,false);
  assert.equal(g.state.home,'edo');
  assert.equal(g.state.castles.edo.owner,g.state.clan);
  assert(g.selectAdminCastle().ok);
  assert.equal(g.state.home,'edo');
  assert.equal(g.state.castles[home].owner,g.state.clan);
  const selected=structuredClone(g.state);
  assert.equal(g.selectAdminCastle().changed,false);
  assert.equal(g.selectAdminCastle(home).ok,false);
  assert.deepEqual(g.state,selected);
  assert.deepEqual(E.fromSave(g.exportSave(),roster,{isAdmin:true}).state,g.state);
  // Refreshing authentication must not refill a depleted garrison from old home.
  g.state.castles.edo.troops=37;
  assert.equal(g.setAdminAccess(true).changed,false);
  assert.equal(g.state.castles.edo.troops,37);
});

test('legacy operator loads migrate to Edo and retain valid in-progress castle work',()=>{
  for(const oldLevel of [19,32]){
    const g=create({isAdmin:true}),home='kiyosu';
    g.state.home=home;
    Object.assign(g.state.castles[home],{owner:g.state.clan,level:oldLevel,wall:9,troops:8765});
    Object.assign(g.state.castles.edo,{level:4,wall:6,troops:500});
    g.state.resources.gold=999999;g.state.resources.wood=999999;g.state.resources.stone=999999;
    assert(g.upgradeCastle('edo').ok);
    assert(g.upgrade('farm').ok);
    const raw=JSON.parse(g.exportSave()),original=structuredClone(raw),oldJob=raw.state.jobs.find(j=>j.kind==='castle');
    const loaded=E.fromSave(raw,roster,{isAdmin:true});
    assert.deepEqual(raw,original,'Load must not edit caller input');
    assert.equal(loaded.state.home,'edo');
    assert.deepEqual(loaded.state.castles.edo,{owner:g.state.clan,level:oldLevel,wall:9,troops:8765});
    assert.deepEqual(loaded.state.castles[home],original.state.castles[home]);
    assert.deepEqual(loaded.state.resources,g.state.resources);
    assert.deepEqual(loaded.state.jobs.find(j=>j.kind==='building'),g.state.jobs.find(j=>j.kind==='building'));
    const job=loaded.state.jobs.find(j=>j.kind==='castle'&&j.id==='edo');
    if(oldLevel===32)assert.equal(job,undefined);
    else assert.deepEqual(job,{...oldJob,targetLevel:oldLevel+1});
    assert.deepEqual(E.fromSave(loaded.exportSave(),roster,{isAdmin:true}).state,loaded.state,'Migrated jobs must remain saveable');
  }
});

test('fixed operator home is independent of optional U restoration and survives CPU invasions',()=>{
  const g=create();
  const result=g.setAdminAccess(true,{restoreAssets:false});
  assert(result.ok);assert.equal(g.state.home,'edo');assert.equal(g.state.castles.edo.owner,g.state.clan);
  assert.equal(g.ownsVariant(IEYASU,'U'),false,'Skipping U restoration does not skip the fixed home');
  g.state.troops=0;g.state.castles.edo.troops=0;
  for(const castle of D.castles)if(castle.id!=='edo')Object.assign(g.state.castles[castle.id],{owner:'武田家',troops:999999});
  g.random=()=>0;
  for(let turn=9;turn<=120;turn+=3){g.state.turn=turn;g._cpuTurn();}
  assert.equal(g.state.home,'edo');assert.equal(g.state.castles.edo.owner,g.state.clan);
  assert.equal(g.state.gameOver,false);
});

test('imported role flags cannot authorize U or Edo and never survive validation',()=>{
  const source=create({isAdmin:true,startCastle:'edo'});
  const raw=JSON.parse(source.exportSave());
  raw.isAdmin=true;raw.role='admin';raw.state.isAdmin=true;raw.state.role='admin';
  const normal=E.fromSave(raw,roster);
  assert.equal(normal.isAdmin,false);
  assert.equal(normal.state.home,'kiyosu');
  assert.equal(normal.state.castles.edo.owner===normal.state.clan,false);
  assert.equal(normal.ownsVariant(IEYASU,'U'),false);
  assert(normal.ownsVariant(IEYASU,'SSS'));
  assert.equal(Object.hasOwn(normal.state,'isAdmin'),false);
  assert.equal(Object.hasOwn(normal.state,'role'),false);
  assert.equal(E.fromSave(raw,roster,{isAdmin:'true'}).isAdmin,false);
  const authenticated=E.fromSave(raw,roster,{isAdmin:true});
  assert.equal(authenticated.state.home,'edo');
  assert(authenticated.ownsVariant(IEYASU,'U'));
  assert.equal(Object.hasOwn(JSON.parse(authenticated.exportSave()),'isAdmin'),false);
  assert.equal(Object.hasOwn(authenticated.state,'isAdmin'),false);
});

test('legacy Edo-only campaign migrates its castle progress and retains the whole game',()=>{
  const source=create({isAdmin:true,startCastle:'edo'});
  source.state.castles.edo.level=12;source.state.castles.edo.wall=7;source.state.castles.edo.troops=5432;
  source.state.resources.gold=98765;source.state.resources.wood=99999;source.state.resources.stone=99999;
  assert(source.upgradeCastle('edo').ok);
  const raw=JSON.parse(source.exportSave()),original=structuredClone(raw);
  const migrated=E.fromSave(raw,roster);
  assert.deepEqual(raw,original,'import must not mutate the input object');
  assert.equal(Object.keys(migrated.state.castles).length,128);
  assert.equal(migrated.state.home,'kiyosu');
  assert.deepEqual(migrated.state.castles.kiyosu,source.state.castles.edo);
  assert.deepEqual(migrated.state.resources,source.state.resources);
  assert.deepEqual(migrated.state.army,source.state.army);
  assert.equal(migrated.state.troops,source.state.troops);
  assert.equal(migrated.state.gameOver,false);
  assert.equal(migrated.state.jobs.some(j=>j.kind==='castle'&&j.id==='edo'),false);
  assert.equal(migrated.state.captureRewards.includes('edo'),false);
  assert(migrated.state.captureRewards.includes('kiyosu'));
  assert.deepEqual(E.fromSave(migrated.exportSave(),roster).state,migrated.state);
});

test('role revocation safely moves Edo home, deduplicates SSS and is idempotent',()=>{
  const g=create({isAdmin:true});
  g._grantOfficerVariant(IEYASU,'SSS');
  g.selectAdminCastle();
  const resources=structuredClone(g.state.resources),officers=[...g.state.officers];
  assert(g.setAdminAccess(false).changed);
  assert.equal(g.state.home,'kiyosu');
  assert.equal(g.state.castles.edo.owner===g.state.clan,false);
  assert.deepEqual(g.ownedRanks(IEYASU),['SSS']);
  assert.deepEqual(g.state.officers,officers);
  assert.deepEqual(g.state.resources,resources);
  assert.equal(g.state.officerVariants.filter(v=>v===IEYASU+':SSS').length,1);
  const before=structuredClone(g.state);
  assert.equal(g.setAdminAccess(false).changed,false);
  assert.deepEqual(g.state,before);
  assert.equal(g.setAdminAccess('true').ok,false);
  assert.equal(g.isAdmin,false);
  assert.deepEqual(g.state,before);
});

test('legacy Ieyasu U history migrates to valid SSS history without duplicate ownership',()=>{
  const g=create({isAdmin:true,clan:'徳川家'});
  g._grantOfficerVariant(IEYASU,'SSS');
  const pool=g.gachaPool('U'),index=pool.findIndex(o=>o.id===IEYASU),rolls=[.995,(index+.5)/pool.length];
  g.random=()=>rolls.shift();assert(g.drawOfficers(1).ok);
  const migrated=E.fromSave(g.exportSave(),roster);
  assert.equal(migrated.state.gachaHistory[0].rank,'SSS');
  assert.equal(migrated.state.officerVariants.filter(v=>v===IEYASU+':SSS').length,1);
  assert.equal(migrated.state.officerVariants.includes(IEYASU+':U'),false);
  assert.equal(migrated.state.stats.gachaDraws,1);
  assert.deepEqual(E.fromSave(migrated.exportSave(),roster).state,migrated.state);
});

test('ordinary campaign can conquer all 127 eligible castles and claim unification',()=>{
  const g=create();g.state.resources.rice=9999999;
  while(g.ownedCastles().length<127){
    const target=g.adjacentTargets()[0];assert(target);assert.notEqual(target.id,'edo');
    g.state.command=3;g.state.troops=50000;g.state.seed=1;
    const result=g.attack(target.id);assert(result.ok&&result.battle.won);
  }
  assert.equal(g.state.won,true);
  assert.equal(g.questStatus('unify').target,127);
  assert(g.claimQuest('unify').ok);
  assert.equal(g.adjacentTargets().length,0);
  const before=structuredClone(g.state);
  assert.equal(g.attack('edo').ok,false);
  assert.equal(g.upgradeCastle('edo').ok,false);
  assert.deepEqual(g.state,before);
  const loaded=E.fromSave(g.exportSave(),roster);
  assert.equal(loaded.state.won,true);
  assert.equal(loaded.state.castles.edo.owner===loaded.state.clan,false);
});

test('only the U Ieyasu variant uses 德 while stable IDs, ordinary names and clan names remain unchanged',()=>{
  const ordinary=create({clan:'徳川家'}),operator=create({clan:'徳川家',isAdmin:true}),canonical=roster.find(o=>o.id===IEYASU);
  assert.equal(canonical.name,'徳川家康');assert.equal(ordinary.officer(IEYASU).name,'徳川家康');assert.equal(operator.officer(IEYASU).name,'德川家康');
  for(const rank of D.ranks){const variant=operator.officer(IEYASU,rank);assert.equal(variant.id,IEYASU);assert.equal(variant.clan,'徳川家');assert.equal(variant.name,rank==='U'?'德川家康':'徳川家康');}
  assert.equal(ordinary.officer(IEYASU,'U').name,'德川家康','The unowned exclusive artwork preview uses its variant name');
  assert.equal(ordinary.canOwnOfficerVariant(IEYASU,'U'),false);assert.equal(operator.baseOfficer(IEYASU).name,'徳川家康');assert.equal(D.clans.find(c=>c.name==='徳川家').leader,'徳川家康');
  const loaded=E.fromSave(operator.exportSave(),roster,{isAdmin:true});assert.equal(loaded.officer(IEYASU).name,'德川家康');loaded.setAdminAccess(false);assert.equal(loaded.officer(IEYASU).name,'徳川家康');assert.equal(loaded.highestOwnedRank(IEYASU),'SSS');
});

console.log(`${count} operator privilege, migration and campaign tests passed.`);
