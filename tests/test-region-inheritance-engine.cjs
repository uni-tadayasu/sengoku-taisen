'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const protectedIds=['edo','kyoto_gosho','kagoshima'],cycleMs=672*60000;
const fresh=(options={})=>new E({officers,seed:1489,difficulty:'normal',startCastle:'ishikawa',...options});
const clone=structuredClone,clock=elapsedMs=>({id:'region-inheritance-test',elapsedMs,running:true,speed:1});
const regionIds=region=>D.castles.filter(c=>c.region===region&&!protectedIds.includes(c.id)).map(c=>c.id);
const own=(g,id)=>{g.state.castles[id].owner=g.state.clan;if(!g.state.captureRewards.includes(id))g.state.captureRewards.push(id);};
const conquer=(g,region)=>{for(const id of regionIds(region))own(g,id);};
const settle=(g,index)=>{g.state.turn=index*672;g.state.realtime.elapsed=0;return g._settleCycle(index);};
const rich=g=>{g.state.resources={gold:9000000,rice:9000000,wood:9000000,stone:9000000};return g;};
const act=(g,fn)=>{g.state.command=g.commandMax();const result=fn();assert(result.ok,result.message||result.reason);return result;};
const branch=(parent,extra={})=>({id:parent+'_north',parentCastleId:parent,direction:'north',level:2,fallen:false,...extra});
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name);}

test('regional conquest reads current ownership without mutating state or trusting retained history',()=>{
  const g=fresh(),before=clone(g.state);
  assert.deepEqual(g.conqueredRegions(),[]);assert.deepEqual(g.state,before);
  assert.equal(D.regionConquest.regions.length,9);assert.deepEqual(D.regionConquest.protectedCastleIds,protectedIds);
  assert.equal(D.regionConquest.regions.reduce((n,r)=>n+r.castleIds.length,0),126);
  for(const row of D.regionConquest.regions)assert.deepEqual(row.castleIds,regionIds(row.region));
  conquer(g,'東海');conquer(g,'四国');g.state.cycle.retainedRegions=['中国'];
  const completed=clone(g.state);assert.deepEqual(g.conqueredRegions(),['東海','四国']);assert.deepEqual(g.state,completed);
  assert.deepEqual(E.conqueredRegions(new Set(g.ownedCastleIds())),['東海','四国']);
  g.state.castles.yuzuki.owner='在地衆';assert.deepEqual(g.conqueredRegions(),['東海']);
});

test('complete Tokai and Shikoku retain each castle while an incomplete region resets and home stays',()=>{
  const g=fresh();conquer(g,'東海');conquer(g,'四国');own(g,'nanao');
  g.state.castles.nagoya={owner:g.state.clan,troops:1777,wall:7,level:8,durability:{version:1,current:13700,max:34000,updatedElapsedMs:1000}};
  g.state.castles.nanao={owner:g.state.clan,troops:947,wall:8,level:11};
  g.state.castles.ishikawa={owner:g.state.clan,troops:1700,wall:6,level:9};
  const kept=[...regionIds('東海'),...regionIds('四国')],before=clone(g.state.castles),resources=clone(g.state.resources),magatama=g.state.magatama;
  const reward=settle(g,1);
  assert.deepEqual(reward,{cycle:0,captured:26,gold:26000,rice:26000,magatama:2600});
  for(const id of [...kept,'ishikawa'])assert.deepEqual(g.state.castles[id],before[id],id);
  const nanao=D.castles.find(c=>c.id==='nanao');assert.deepEqual(g.state.castles.nanao,{owner:nanao.clan,troops:nanao.initialTroops,wall:nanao.wall,level:1});
  assert.deepEqual(g.state.cycle.retainedRegions,['東海','四国']);assert.equal(g.ownedCastleIds().length,26);
  assert.deepEqual(new Set(g.state.captureRewards),new Set(['ishikawa',...kept]));
  assert.equal(g.state.resources.gold,resources.gold+26000);assert.equal(g.state.resources.rice,resources.rice+26000);assert.equal(g.state.magatama,magatama+2600);
  const settled=clone(g.state);assert.equal(g._settleCycle(1),null);assert.deepEqual(g.state,settled);
  assert.deepEqual(E.fromSave(g.exportSave(),officers).state,g.state);
});

test('protected office bases are excluded from Kanto Kinki and Kyushu completion for every role',()=>{
  for(const [region,protectedId] of [['関東','edo'],['近畿','kyoto_gosho'],['九州','kagoshima']]){
    const g=fresh();conquer(g,region);assert.notEqual(g.state.castles[protectedId].owner,g.state.clan);
    assert.deepEqual(g.conqueredRegions(),[region]);settle(g,1);
    assert.deepEqual(g.state.cycle.retainedRegions,[region]);assert.notEqual(g.state.castles[protectedId].owner,g.state.clan);
    for(const id of regionIds(region))assert.equal(g.state.castles[id].owner,g.state.clan,id);
  }
  for(const [options,home,region] of [[{isAdmin:true},'edo','関東'],[{isStaff:true},'kyoto_gosho','近畿'],[{isDeputy:true},'kagoshima','九州']]){
    const g=fresh(options);conquer(g,region);settle(g,1);
    assert.equal(g.state.home,home);assert.equal(g.state.castles[home].owner,g.state.clan);assert.deepEqual(g.state.cycle.retainedRegions,[region]);
    for(const id of protectedIds.filter(id=>id!==home))assert.notEqual(g.state.castles[id].owner,g.state.clan,id);
  }
});

test('region completion is reevaluated at each boundary and losing one castle releases that incomplete region',()=>{
  const g=fresh();conquer(g,'四国');settle(g,1);
  g.state.castles.yuzuki.owner='在地衆';assert.deepEqual(g.state.cycle.retainedRegions,['四国']);assert.deepEqual(g.conqueredRegions(),[]);
  const reward=settle(g,2);assert.equal(reward.captured,9);
  assert.deepEqual(g.state.cycle.retainedRegions,[]);assert.deepEqual(g.ownedCastleIds(),['ishikawa']);assert.deepEqual(g.state.captureRewards,['ishikawa']);
});

test('retained castle queues and branch troops facilities damage and queues survive, released branches withdraw',()=>{
  const g=rich(fresh());conquer(g,'東海');own(g,'nijo');g.state.buildings.keep=32;
  g.state.branches=[branch('nagoya',{stationedTroops:137,facilities:{farm:1},facilityCompletedAt:{farm:[0]},durability:{version:1,current:2000,max:5000,updatedElapsedMs:0}}),branch('nijo',{stationedTroops:91})];
  act(g,()=>g.upgradeCastle('nagoya'));act(g,()=>g.upgradeCastle('nijo'));
  act(g,()=>g.upgradeBranch('nagoya_north'));act(g,()=>g.upgradeBranchFacility('nagoya_north','farm'));act(g,()=>g.upgradeBranch('nijo_north'));
  const retainedBranch=clone(g.state.branches[0]),keptJobs=clone(g.state.jobs.filter(j=>j.id==='nagoya'||j.id==='nagoya_north'));
  settle(g,1);assert.deepEqual(g.state.branches[0],retainedBranch);assert.deepEqual(g.state.jobs,keptJobs);
  assert.deepEqual(g.state.branches[1],branch('nijo',{stationedTroops:91,fallen:true,retreating:true}));
  const loaded=E.fromSave(g.exportSave(),officers);assert.deepEqual(loaded.state.branches,g.state.branches);assert.deepEqual(loaded.state.jobs,g.state.jobs);
  loaded._cpuTurn=()=>[];loaded._advanceRealtime(120);assert.equal(loaded.state.castles.nagoya.level,2);assert.equal(loaded.branch('nagoya_north').level,3);assert.equal(loaded.branch('nagoya_north').facilities.farm,2);
});

test('recapturing an inherited castle cannot grant the first conquest reward again',()=>{
  const g=rich(fresh());conquer(g,'四国');own(g,'nanao');settle(g,1);
  assert(g.state.captureRewards.includes('yuzuki'));assert(!g.state.captureRewards.includes('nanao'));
  g.state.castles.yuzuki={...g.state.castles.yuzuki,owner:'在地衆',troops:10,wall:1};g.state.troops=50000;g.random=()=>0;
  const result=act(g,()=>g.attack('yuzuki','balanced',50000));assert(result.battle.won);assert.equal(result.battle.rewards.magatama,0);
  assert(!result.battle.phases.some(phase=>phase.title==='初攻略の褒賞'));assert.deepEqual(g.conqueredRegions(),['四国']);
});

test('multi-cycle offline catch-up awards once per distinct cycle and preserves inheritance after reload',()=>{
  const g=rich(fresh());conquer(g,'四国');g._cpuTurn=()=>[];g.applyWorldClock(clock(cycleMs-1000));
  const result=g.applyWorldClock(clock(cycleMs*3),{maxSeconds:86400});assert.equal(result.pending,false);
  assert.deepEqual(result.cycleRewards.map(r=>({cycle:r.cycle,captured:r.captured,magatama:r.magatama})),[0,1,2].map(cycle=>({cycle,captured:10,magatama:1000})));
  assert.deepEqual(g.state.cycle.retainedRegions,['四国']);assert.equal(g.ownedCastleIds().length,11);
  const loaded=E.fromSave(g.exportSave(),officers),before=clone(loaded.state);loaded._cpuTurn=()=>[];
  assert.equal(loaded.applyWorldClock(clock(cycleMs*3)).changed,false);assert.deepEqual(loaded.state,before);
  const next=loaded.applyWorldClock(clock(cycleMs*4),{maxSeconds:86400});assert.equal(next.cycleRewards.length,1);assert.equal(next.cycleRewards[0].cycle,3);assert.equal(next.cycleRewards[0].captured,10);
  for(const id of regionIds('四国'))assert(loaded.state.captureRewards.includes(id));
});

test('all nine regions retain unification proof and won state across settlement and save restore',()=>{
  const g=fresh();for(const c of D.castles)if(!protectedIds.includes(c.id))own(g,c.id);
  settle(g,1);assert.equal(g.state.won,true);assert.equal(g.state.gameOver,false);assert.equal(g.getUnificationProof().achieved,true);assert.equal(g.ownedCastleIds().length,126);
  assert.equal(g.state.cycle.retainedRegions.length,9);const h=E.fromSave(g.exportSave(),officers);assert.equal(h.state.won,true);assert.equal(h.getUnificationProof().achieved,true);
});

test('legacy saves default to no inherited history, malformed regions fail and live losses remain loadable',()=>{
  const g=fresh(),legacy=JSON.parse(g.exportSave());delete legacy.state.cycle.retainedRegions;
  assert.deepEqual(E.fromSave(legacy,officers).state.cycle.retainedRegions,[]);delete legacy.state.cycle;assert.deepEqual(E.fromSave(legacy,officers).state.cycle.retainedRegions,[]);
  conquer(g,'東海');conquer(g,'四国');settle(g,1);const saved=JSON.parse(g.exportSave());
  for(const value of [null,'東海',['未知'],['東海','東海'],[1],{},Array(10).fill('東海')]){const bad=clone(saved);bad.state.cycle.retainedRegions=value;assert.throws(()=>E.fromSave(bad,officers));}
  saved.state.cycle.retainedRegions=['四国','東海'];saved.state.castles.yuzuki.owner='在地衆';
  const restored=E.fromSave(saved,officers);assert.deepEqual(restored.state.cycle.retainedRegions,['東海','四国']);assert.deepEqual(restored.conqueredRegions(),['東海']);assert.equal(restored.state.castles.yuzuki.owner,'在地衆');
});

test('a pre-appointment boundary retains completed regions under the personal home before Kyoto becomes active',()=>{
  const personal=fresh({startCastle:'nanao'});conquer(personal,'四国');personal.applyWorldClock(clock(cycleMs-1000));
  const s=personal.state,buildings=clone(s.buildings),base={id:'kyoto_gosho',revision:1,accessSinceElapsedMs:cycleMs+2000,castleLevel:64,buildings,initial:{buildings:clone(buildings),castleLevel:64},history:[],jobs:[],personalHome:s.home,personalCycleHome:s.cycle.home,personalBaseCastle:clone(s.castles.kyoto_gosho),personalHomeCastle:clone(s.castles[s.home])};
  const staff=E.fromSave(personal.exportSave(),officers,{isStaff:true,staffBase:base});
  personal.applyWorldClock(clock(cycleMs+1000));staff.applyWorldClock(clock(cycleMs+1000));
  assert.equal(staff.state.home,'nanao');assert.equal(staff.state.cycle.home,'nanao');assert.deepEqual(staff.state.cycle.retainedRegions,['四国']);
  assert.deepEqual(staff.state.cycle.latestReward,personal.state.cycle.latestReward);for(const id of regionIds('四国'))assert.deepEqual(staff.state.castles[id],personal.state.castles[id]);
  staff.applyWorldClock(clock(cycleMs+2000));assert.equal(staff.state.home,'kyoto_gosho');assert.equal(staff.state.castles.kyoto_gosho.level,64);
  for(const id of regionIds('四国'))assert.equal(staff.state.castles[id].owner,staff.state.clan,id);
});

console.log(`${passed}/${passed} regional inheritance checks passed.`);
