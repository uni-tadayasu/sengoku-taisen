'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const fresh=(options={})=>new E({officers,seed:1,difficulty:'easy',...options});
const ids=region=>D.regionConquest.regions.find(row=>row.region===region).castleIds;
const own=(g,id)=>{g.state.castles[id].owner=g.state.clan;};
const conquer=(g,region)=>ids(region).forEach(id=>own(g,id));
const job=id=>({kind:'castle',id,targetLevel:2,total:1,totalSeconds:60,remaining:1,remainingSeconds:50});
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('the final successful castle capture records its whole region immediately and survives reload',()=>{
 const g=fresh(),s=g.state,last='shimabara';for(const id of ids('九州'))if(id!==last)own(g,id);
 s.resources={gold:900000,rice:900000,wood:900000,stone:900000};s.troops=100000;s.castles[last]={owner:'在地衆',troops:10,wall:1,level:1};g.random=()=>0;
 assert.deepEqual(g.conqueredRegions(),[]);assert.deepEqual(g.protectedRegions(),[]);
 const result=g.attack(last,'balanced',50000);assert(result.ok&&result.battle.won);assert.deepEqual(g.protectedRegions(),['九州']);assert.deepEqual(s.cycle.retainedRegions,[],'protection starts before the next boundary');
 for(const id of ids('九州'))assert(g.isRegionProtectedCastle(id),id);assert.equal(g.isRegionProtectedCastle('kagoshima'),false);assert.equal(g.isRegionProtectedCastle('kiyosu'),false);
 const loaded=E.fromSave(g.exportSave(),officers);assert.deepEqual(loaded.protectedRegions(),['九州']);assert(loaded.isRegionProtectedCastle(last));assert.equal(loaded.recordRegionConquests().changed,false);
});

function vulnerable(protectedRegion){
 const g=fresh({startCastle:'sunpu'}),s=g.state;s.turn=9;s.troops=2000;
 for(const castle of Object.values(s.castles))Object.assign(castle,{owner:'在地衆',troops:100000,wall:1,level:1});
 conquer(g,'東海');for(const id of ids('東海'))s.castles[id].troops=100;
 s.jobs=[job('sunpu')];if(protectedRegion)g.recordRegionConquests();g.random=()=>0;return g;
}
test('an actual losing CPU defense cannot transfer a protected home or cancel its construction',()=>{
 const control=vulnerable(false),g=vulnerable(true),s=g.state,before=g.castle('sunpu').durability.current;
 const unprotected=control._cpuTurn();assert(unprotected.some(text=>text.includes('駿府')));assert.notEqual(control.state.castles.sunpu.owner,control.state.clan);
 const works=structuredClone(s.jobs),events=g._cpuTurn();assert(events.length);assert.equal(s.castles.sunpu.owner,s.clan);assert.equal(s.home,'sunpu');assert.equal(s.cycle.home,'sunpu');assert.equal(s.gameOver,false);
 assert(s.troops<2000);assert(s.castles.sunpu.troops<100);assert(g.castle('sunpu').durability.current<before);assert.deepEqual(s.jobs,works);assert.deepEqual(g.takeHomeDefenseLosses(),[]);assert.deepEqual(g.takeBranchParentLosses(),[]);
 assert(g.setCourtProtection(false).ok);s.turn=12;g._cpuTurn();assert.equal(s.castles.sunpu.owner,s.clan,'regional protection does not depend on a court role');
});
test('regional protection survives multiple settlements without adding excluded office bases or duplicating rewards',()=>{
 const g=fresh({startCastle:'ishikawa'});conquer(g,'東海');conquer(g,'九州');g.recordRegionConquests();
 for(let index=1;index<=3;index++){
  g.state.turn=index*672;const reward=g._settleCycle(index);assert.equal(reward.captured,30);assert.deepEqual(g.protectedRegions(),['東海','九州']);
  for(const id of [...ids('東海'),...ids('九州')])assert.equal(g.state.castles[id].owner,g.state.clan);
  const saved=structuredClone(g.state);assert.equal(g._settleCycle(index),null);assert.deepEqual(g.state,saved);
 }
 assert.notEqual(g.state.castles.kagoshima.owner,g.state.clan);assert.deepEqual(E.fromSave(g.exportSave(),officers).protectedRegions(),['東海','九州']);
});
test('only the current complete region migrates from old saves and protection lists reject malformed names',()=>{
 const g=fresh();conquer(g,'東海');const old=JSON.parse(g.exportSave());delete old.state.cycle.protectedRegions;old.state.cycle.retainedRegions=['九州'];
 const loaded=E.fromSave(old,officers);assert.deepEqual(loaded.protectedRegions(),['東海']);assert.equal(loaded.isRegionProtectedCastle('funai'),false);
 for(const protectedRegions of [null,'東海',['未知'],['東海','東海'],[1],{}]){const invalid=structuredClone(old);invalid.state.cycle.protectedRegions=protectedRegions;assert.throws(()=>E.fromSave(invalid,officers));}
 const modern=JSON.parse(g.exportSave());assert.deepEqual(E.fromSave(modern,officers).protectedRegions(),[],'loading a modern snapshot does not invent a new server entitlement');
});
test('deputy appointment and return keep protected ownership without duplicating garrisons, growth or construction',()=>{
 const g=fresh({startCastle:'kiyosu'});conquer(g,'東海');g.recordRegionConquests();const s=g.state;
 Object.assign(s.castles.kiyosu,{level:8,wall:7,troops:321});s.jobs=[{...job('kiyosu'),targetLevel:9}];
 assert(g.setRoleAccess({isDeputy:true}).ok);assert.equal(s.home,'kagoshima');assert.equal(s.castles.kagoshima.troops,321);assert.equal(s.castles.kiyosu.troops,0);assert.equal(s.castles.kiyosu.level,8);assert.equal(s.castles.kiyosu.wall,7);assert.deepEqual(s.jobs.map(j=>[j.id,j.targetLevel]),[['kiyosu',9]]);
 for(const id of ids('東海'))assert.equal(s.castles[id].owner,s.clan,id);
 const appointed=structuredClone(s.castles);for(let i=0;i<3;i++){assert(g.setRoleAccess({isDeputy:true}).ok);assert.deepEqual(g.state.castles,appointed);assert.deepEqual(g.protectedRegions(),['東海']);}
 const loaded=E.fromSave(g.exportSave(),officers,{isDeputy:true});assert.deepEqual(loaded.state.castles,appointed);assert.deepEqual(loaded.state.jobs,s.jobs);
 Object.assign(loaded.state.castles.kiyosu,{troops:123,level:9,wall:8});Object.assign(loaded.state.castles.kagoshima,{troops:300,level:10,wall:6});loaded.state.jobs=[{...job('kiyosu'),targetLevel:10,remainingSeconds:40},{...job('kagoshima'),targetLevel:11}];
 assert(loaded.setRoleAccess({}, {deputyReturnHome:'kiyosu'}).ok);assert.equal(loaded.state.home,'kiyosu');assert.equal(loaded.state.castles.kiyosu.troops,423);assert.equal(loaded.state.castles.kiyosu.level,10);assert.equal(loaded.state.castles.kiyosu.wall,8);assert.deepEqual(loaded.state.jobs,[{...job('kiyosu'),targetLevel:11,remainingSeconds:40}]);
 assert.notEqual(loaded.state.castles.kagoshima.owner,loaded.state.clan);for(const id of ids('東海'))assert.equal(loaded.state.castles[id].owner,loaded.state.clan,id);
 const returned=structuredClone(loaded.state.castles);for(let i=0;i<3;i++){assert(loaded.setRoleAccess({}, {deputyReturnHome:'kiyosu'}).ok);assert.deepEqual(loaded.state.castles,returned);}
 assert.deepEqual(E.fromSave(loaded.exportSave(),officers).state.castles,returned);
 assert(loaded.setRoleAccess({isDeputy:true}).ok);assert.equal(loaded.state.castles.kiyosu.troops,0);assert.equal(loaded.state.castles.kagoshima.troops,423);
 assert(loaded.setRoleAccess({}, {deputyReturnHome:'kiyosu'}).ok);assert.deepEqual(loaded.state.castles,returned);assert.equal(loaded.state.jobs.length,1);
});
test('an explicit new campaign starts without the former regional entitlement',()=>{
 const g=fresh();conquer(g,'東海');g.recordRegionConquests();const before=g.state.walking.campaignId;
 const moved=g.relocateResidence('ishikawa',{role:'lord'});assert(moved.ok);assert.notEqual(g.state.walking.campaignId,before);assert.deepEqual(g.protectedRegions(),[]);assert.equal(g.isRegionProtectedCastle('sunpu'),false);
});
console.log(`${checks} regional protection engine checks passed.`);
