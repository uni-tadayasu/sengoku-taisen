'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const fresh=options=>new E({officers,seed:1,startCastle:'ishikawa',difficulty:'normal',...options});
const ids=region=>D.regionConquest.regions.find(row=>row.region===region).castleIds;
const own=(g,id)=>{g.state.castles[id].owner=g.state.clan;if(!g.state.captureRewards.includes(id))g.state.captureRewards.push(id);};
const conquer=(g,region)=>{for(const id of ids(region))own(g,id);g.recordRegionConquests();};
const job=(kind,id)=>({kind,id,targetLevel:2,total:1,totalSeconds:60,remaining:1,remainingSeconds:50});
const noChange=(g,action)=>{const before=structuredClone(g.state),result=action();assert.equal(result.ok,false);assert.deepEqual(g.state,before);return result;};
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('only a current non-home nonexclusive holding can be released and every rejected action is inert',()=>{
 for(const options of [{},{isAdmin:true},{isStaff:true},{isDeputy:true}]){
  const g=fresh(options);own(g,'nagoya');assert.equal(g.canReleaseCastle('nagoya'),true);
  for(const id of [g.state.home,'edo','kyoto_gosho','kagoshima','missing','__proto__',null]){assert.equal(g.canReleaseCastle(id),false);assert.equal(noChange(g,()=>g.releaseCastle(id)).code,'CASTLE_RELEASE_UNAVAILABLE');}
  const enemy=D.castles.find(c=>g.state.castles[c.id].owner!==g.state.clan&&!['edo','kyoto_gosho','kagoshima'].includes(c.id)).id;
  assert.equal(noChange(g,()=>g.releaseCastle(enemy)).code,'CASTLE_RELEASE_UNAVAILABLE');
 }
});
test('release removes development, garrisons, branches, reserves and only their jobs without a refund or troop return',()=>{
 const g=fresh(),s=g.state;for(const id of ['nagoya','nijo'])own(g,id);
 Object.assign(s.castles.nagoya,{troops:1700,wall:8,level:9});s.castles.nagoya.durability={version:1,current:100,max:1000,updatedElapsedMs:0};
 s.branches=[{id:'nagoya_north',parentCastleId:'nagoya',direction:'north',level:1,fallen:false,stationedTroops:300},{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,stationedTroops:200}];
 s.jobs=[{...job('castle','nagoya'),targetLevel:10},job('branch','nagoya_north'),job('castle','nijo'),job('branch','nijo_north')];s.covert.reserves.nagoya=120;
 const before=structuredClone(s),result=g.releaseCastle('nagoya'),def=D.castles.find(c=>c.id==='nagoya');assert(result.ok);assert.equal(result.removedBranchCount,1);assert.equal(result.removedJobCount,2);assert.equal(result.lostGarrisonTroops,1700);assert.equal(result.lostBranchTroops,300);assert.equal(result.lostReserveTroops,120);
 assert.deepEqual(s.castles.nagoya,{owner:def.clan===s.clan?'在地衆':def.clan,troops:def.initialTroops,wall:def.wall,level:1});assert.deepEqual(s.branches,[before.branches[1]]);assert.deepEqual(s.jobs,before.jobs.slice(2));
 for(const key of ['resources','magatama','command','troops','captureRewards','troopTransferSequence'])assert.deepEqual(s[key],before[key],key);
 assert.equal(s.covert.reserves.nagoya,0);assert.equal(s.covert.sequence,before.covert.sequence+1);assert.deepEqual(g.releasedCastles(),['nagoya']);
 const loaded=E.fromSave(g.exportSave(),officers);assert.deepEqual(loaded.state.cycle,s.cycle);assert.deepEqual(loaded.state.covert,s.covert);assert.equal(noChange(g,()=>g.releaseCastle('nagoya')).code,'CASTLE_RELEASE_UNAVAILABLE');
});
test('a released protected castle stays excluded across settlements while every remaining regional castle stays protected',()=>{
 const g=fresh();conquer(g,'東海');assert(g.releaseCastle('nagoya').ok);assert(g.releaseCastle('sunpu').ok);
 assert.deepEqual(g.protectedRegions(),['東海']);assert.equal(g.isRegionProtectedCastle('nagoya'),false);assert.equal(g.isRegionProtectedCastle('sunpu'),false);
 for(let index=1;index<=3;index++){
  g.state.turn=index*672;const reward=g._settleCycle(index);assert.equal(reward.captured,ids('東海').length-2);
  for(const id of ids('東海')){const kept=!['nagoya','sunpu'].includes(id);assert.equal(g.state.castles[id].owner===g.state.clan,kept,id);assert.equal(g.isRegionProtectedCastle(id),kept,id);}
  assert.deepEqual(new Set(g.releasedCastles()),new Set(['nagoya','sunpu']));assert(g.state.captureRewards.includes('nagoya'));assert(g.state.captureRewards.includes('sunpu'));
  const saved=structuredClone(g.state);assert.equal(g._settleCycle(index),null);assert.deepEqual(g.state,saved);
 }
 assert.deepEqual(E.fromSave(g.exportSave(),officers).releasedCastles(),g.releasedCastles());
});
test('only an actual successful recapture clears that castle exclusion and first-capture currency cannot repeat',()=>{
 const g=fresh();conquer(g,'東海');g.releaseCastle('nagoya');g.releaseCastle('sunpu');g.state.turn=672;g._settleCycle(1);
 const old=structuredClone(g.state.castles.nagoya);g.state.castles.nagoya.owner=g.state.clan;g.recordRegionConquests();assert(g.releasedCastles().includes('nagoya'),'recalculation alone cannot recapture');g.state.castles.nagoya=old;
 Object.assign(g.state.castles.nagoya,{troops:10,wall:1,level:1});g.state.resources={gold:900000,rice:900000,wood:900000,stone:900000};g.state.troops=100000;g.state.command=g.commandMax();g.random=()=>0;
 const result=g.attack('nagoya','balanced',50000);assert(result.ok&&result.battle.won,result.message);assert.equal(result.battle.rewards.magatama,0);assert.equal(g.isRegionProtectedCastle('nagoya'),true);assert.deepEqual(g.releasedCastles(),['sunpu']);
 g.state.turn=1344;g._settleCycle(2);assert.equal(g.state.castles.nagoya.owner,g.state.clan);assert.notEqual(g.state.castles.sunpu.owner,g.state.clan);
});
test('active sourced covert troops block release but unrelated troops do not',()=>{
 const g=fresh();own(g,'nagoya');g.state.covert.stations=[{sourceCastleId:'nagoya'}];assert.equal(noChange(g,()=>g.releaseCastle('nagoya')).code,'CASTLE_RELEASE_UNITS_PENDING');
 g.state.covert.stations=[];g.state.covert.dispatches=[{sourceCastleId:'nagoya'}];assert.equal(noChange(g,()=>g.releaseCastle('nagoya')).code,'CASTLE_RELEASE_UNITS_PENDING');
 g.state.covert.dispatches=[];g.state.march={sourceCastleId:'nagoya'};assert.equal(noChange(g,()=>g.releaseCastle('nagoya')).code,'CASTLE_RELEASE_UNITS_PENDING');
 g.state.march=null;g.state.covert.stations=[{sourceCastleId:'nijo'}];assert(g.releaseCastle('nagoya').ok);
});
test('releasing a former cycle home uses the current home at later boundaries and clears a completed campaign flag',()=>{
 const g=fresh();for(const c of D.castles)if(g.canOwnCastle(c.id))own(g,c.id);g.recordRegionConquests();g._updateCampaignOutcome();assert.equal(g.state.won,true);
 g.state.home='nanao';assert.equal(g.state.cycle.home,'ishikawa');assert(g.releaseCastle('ishikawa').ok);assert.equal(g.state.cycle.home,'nanao');assert.equal(g.state.won,false);
 g.state.turn=672;g._settleCycle(1);assert.equal(g.state.home,'nanao');assert.notEqual(g.state.castles.ishikawa.owner,g.state.clan);
});
test('release metadata rejects malformed IDs and a new explicit campaign starts with no release history',()=>{
 const g=fresh();own(g,'nagoya');g.releaseCastle('nagoya');const saved=JSON.parse(g.exportSave());
 for(const values of [null,'nagoya',['missing'],['__proto__'],['edo'],['kyoto_gosho'],['kagoshima'],['nagoya','nagoya'],[1],{}]){const bad=structuredClone(saved);bad.state.cycle.releasedCastles=values;assert.throws(()=>E.fromSave(bad,officers),JSON.stringify(values));}
 const prior=g.state.walking.campaignId;assert(g.relocateResidence('nanao',{role:'lord'}).ok);assert.notEqual(g.state.walking.campaignId,prior);assert.deepEqual(g.releasedCastles(),[]);
});
test('staff, deputy and operator dismissal never restore a voluntarily released former home',()=>{
 for(const options of [{isStaff:true},{isDeputy:true}]){
  const g=fresh({startCastle:'kiyosu'});conquer(g,'東海');assert(g.setRoleAccess(options).ok);assert(g.releaseCastle('kiyosu').ok);const released=structuredClone(g.state.castles.kiyosu);
  assert(g.setRoleAccess({}, {deputyReturnHome:'kiyosu'}).ok);assert.notEqual(g.state.home,'kiyosu');assert.notEqual(g.state.castles.kiyosu.owner,g.state.clan);for(const key of ['troops','wall','level'])assert.equal(g.state.castles.kiyosu[key],released[key]);assert(g.releasedCastles().includes('kiyosu'));
  const returned=structuredClone(g.state);for(let i=0;i<2;i++){assert(g.setRoleAccess({}, {deputyReturnHome:'kiyosu'}).ok);assert.deepEqual(g.state.castles,returned.castles);assert.equal(g.state.home,returned.home);}
  g.state.turn=672;g._settleCycle(1);assert.notEqual(g.state.castles.kiyosu.owner,g.state.clan);
 }
 const g=fresh({isAdmin:true});own(g,'okazaki');assert(g.releaseCastle('okazaki').ok);assert(g.setRoleAccess({}).ok);assert.notEqual(g.state.home,'okazaki');assert.notEqual(g.state.castles.okazaki.owner,g.state.clan);assert(g.releasedCastles().includes('okazaki'));
});
assert.equal(fs.readFileSync(require.resolve('../engine.js'),'utf8'),fs.readFileSync(require.resolve('../server/game-engine.js'),'utf8'));
console.log(`${checks} castle release engine checks passed.`);
