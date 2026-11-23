/* One-time development prices follow current personal holdings; upkeep does not. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=structuredClone;
const tests=[],test=(name,run)=>tests.push([name,run]);
const branch=(extra={})=>({id:'nijo_north',parentCastleId:'nijo',direction:'north',level:3,fallen:false,facilities:{farm:1},...extra});
function holdings(game,count){
 const candidates=D.castles.filter(c=>game.canOwnCastle(c.id)&&!(game.isStaff&&c.id===D.staffBaseId));
 const ids=['nijo',...candidates.map(c=>c.id).filter(id=>id!=='nijo')].filter(id=>candidates.some(c=>c.id===id)).slice(0,count),owned=new Set(ids);
 assert.equal(ids.length,count);
 for(const castle of D.castles){if(game.isStaff&&castle.id===D.staffBaseId)continue;game.state.castles[castle.id].owner=owned.has(castle.id)?game.state.clan:'在地衆';}
 return game;
}
function game(count=1,options={}){
 const g=new E({officers,seed:19,...options});
 if(!g.isStaff&&!g.isAdmin){g.state.home='nijo';g.state.cycle.home='nijo';g.state.captureRewards=['nijo'];}
 holdings(g,count);g.state.resources=Object.fromEntries(D.resources.map(key=>[key,D.assetCap]));g.state.branches=[branch()];g._cpuTurn=()=>[];return g;
}
function scaled(actual,base,multiplier){
 for(const [key,value]of Object.entries(base))assert.deepEqual(actual[key],D.resources.includes(key)?value*multiplier:value,key);
 assert.deepEqual(Object.keys(actual).sort(),Object.keys(base).sort(),'quotes keep their existing shape');
}
const operations=[
 {name:'town facility',quote:g=>g.costs('farm'),run:g=>g.upgrade('farm')},
 {name:'castle',quote:g=>g.castleUpgradeCost('nijo'),run:g=>g.upgradeCastle('nijo')},
 {name:'research',quote:g=>g.researchCost('commerce'),run:g=>g.research('commerce')},
 {name:'branch construction',quote:g=>g.branchQuote('nijo','south').cost,run:g=>g.buildBranch('nijo','south')},
 {name:'branch upgrade',quote:g=>g.branchQuote('nijo','north').cost,run:g=>g.upgradeBranch('nijo_north')},
 {name:'branch repair',prepare:g=>{g.state.branches[0].fallen=true;},quote:g=>g.branchRepairQuote('nijo_north').cost,run:g=>g.repairBranch('nijo_north')},
 {name:'branch facility construction',quote:g=>g.branchFacilityQuote('nijo_north','market').cost,run:g=>g.buildBranchFacility('nijo_north','market')},
 {name:'branch facility upgrade',quote:g=>g.branchFacilityQuote('nijo_north','farm').cost,run:g=>g.upgradeBranchFacility('nijo_north','farm')}
];

test('the shared scaler doubles only four resource prices and never mutates a base quote',()=>{
 const base={gold:123,rice:19,wood:5,stone:3,turns:2,seconds:120,commandCost:1,requiredLevel:8,magatama:300},before=copy(base);
 for(const count of [0,1,2,3,4,17,D.castles.length]){const multiplier=2**Math.max(0,count-1);assert.equal(E.upgradeCostMultiplier(count),multiplier);scaled(E.scaleUpgradeCost(base,count),base,multiplier);}
 assert.deepEqual(base,before);assert.equal(E.scaleUpgradeCost(null,3),null);
 for(const count of [-1,.5,NaN,Infinity,'2',D.castles.length+1])assert.throws(()=>E.scaleUpgradeCost(base,count));
 for(const value of [-1,Infinity,NaN])assert.throws(()=>E.scaleUpgradeCost({gold:value},2));
});

test('all development quotes use current territory with unchanged time and existing discounts',()=>{
 for(const operation of operations){
  const g=game();operation.prepare?.(g);g.state.buildings.academy=8;g.state.buildings.library=4;g.state.tech.commerce=2;
  const base=operation.quote(g);assert(base,operation.name);
  for(const count of [1,2,3,4,9,30,g.unificationTarget()]){holdings(g,count);assert.equal(g.upgradeCastleCount(),count);assert.equal(g.upgradeCostMultiplier(),2**(count-1));scaled(operation.quote(g),base,2**(count-1));}
 }
});

test('real captures increase the price, losses lower it, and past captures or branches are not counted',()=>{
 const g=game(),base=g.costs('farm');g.state.troops=50000;
 for(let count=2;count<=3;count++){
  const target=g.adjacentTargets().find(c=>!D.branchRules.parents.some(p=>p.id===c.id));assert(target);g.state.castles[target.id].troops=100;g.state.castles[target.id].wall=1;g.state.command=g.commandMax();g.random=()=>0;
  const result=g.attack(target.id,'assault',10000);assert(result.ok&&result.battle.won,result.message);assert.equal(g.upgradeCastleCount(),count);scaled(g.costs('farm'),base,2**(count-1));
 }
 const history=copy(g.state.captureRewards),lost=g.ownedCastles().find(c=>c.id!==g.state.home).id;g.state.castles[lost].owner='在地衆';assert.deepEqual(g.state.captureRewards,history);assert.equal(g.upgradeCastleCount(),2);scaled(g.costs('farm'),base,2);
 g.state.branches.push({id:'nijo_south',parentCastleId:'nijo',direction:'south',level:24,fallen:false,facilities:{market:24}});g.state.stats.wins=999;g.state.captureRewards=D.castles.map(c=>c.id);assert.equal(g.upgradeCastleCount(),2);scaled(g.costs('farm'),base,2);
 holdings(g,0);assert.equal(g.upgradeCastleCount(),0);assert.equal(g.upgradeCostMultiplier(),1);
});

test('each real action pays exactly its current quote once, using unchanged command and time costs',()=>{
 for(const operation of operations){
  const g=game(3);operation.prepare?.(g);const cost=operation.quote(g);g.state.resources=Object.fromEntries(D.resources.map(key=>[key,cost[key]||0]));const command=g.state.command,magatama=g.state.magatama;
  const result=operation.run(g);assert(result.ok,operation.name+': '+result.message);assert.deepEqual(g.state.resources,{gold:0,rice:0,wood:0,stone:0},operation.name);assert.equal(g.state.command,command-1,operation.name);assert.equal(g.state.magatama,magatama);assert.equal(g.state.jobs.length,1);assert.equal(g.state.jobs[0].totalSeconds,cost.seconds);assert.equal(g.state.jobs[0].remainingSeconds,cost.seconds);
 }
});

test('insufficient scaled resources reject every development action without partial state changes',()=>{
 for(const operation of operations){
  const g=game(3);operation.prepare?.(g);const cost=operation.quote(g);g.state.resources=Object.fromEntries(D.resources.map(key=>[key,cost[key]||0]));g.state.resources.gold--;const before=copy(g.state),result=operation.run(g);
  assert.equal(result.ok,false,operation.name);assert.deepEqual(g.state,before,operation.name);
 }
});

test('prices above the asset ceiling remain above it and cannot be bought at a capped discount',()=>{
 for(const operation of operations){
  const g=game(30);operation.prepare?.(g);const cost=operation.quote(g);assert(cost.gold>D.assetCap,operation.name);assert(Number.isFinite(cost.gold));const before=copy(g.state);assert.equal(operation.run(g).ok,false,operation.name);assert.deepEqual(g.state,before,operation.name);
 }
 const g=game();const base=g.costs('farm').gold;holdings(g,g.unificationTarget());assert.equal(g.costs('farm').gold,base*2**(g.unificationTarget()-1));assert(Number.isFinite(g.costs('farm').gold));assert.doesNotThrow(()=>JSON.stringify(g.costs('farm')));
});

test('queued upgrades use the holdings at payment time and existing paid work is not charged again',()=>{
 const g=game(),first=g.costs('farm'),start=copy(g.state.resources);assert(g.upgrade('farm').ok);const paid=copy(g.state.resources),job=copy(g.state.jobs[0]),baseNext=g.costs('farm');
 holdings(g,3);assert.deepEqual(g.state.resources,paid);assert.deepEqual(g.state.jobs[0],job);const second=g.costs('farm');scaled(second,baseNext,4);assert.deepEqual(second,g.costs('farm',3));
 assert(g.upgrade('farm').queued);for(const key of D.resources)assert.equal(g.state.resources[key],start[key]-(first[key]||0)-(second[key]||0));
 const before=copy(g.state.resources),jobs=copy(g.state.jobs);holdings(g,1);assert.deepEqual(g.state.resources,before);assert.deepEqual(g.state.jobs,jobs);const reloaded=E.fromSave(g.exportSave(),officers);assert.deepEqual(reloaded.state.resources,before);assert.deepEqual(reloaded.state.jobs,jobs);
});

test('shared Kyoto uses the paying staff member personal holdings and never adds another counted castle',()=>{
 const g=game(0,{isStaff:true});assert.equal(g.ownedCastles().length,1);assert.equal(g.upgradeCastleCount(),0);assert.equal(g.upgradeCostMultiplier(),1);const facility=g.costs('farm'),castle=g.castleUpgradeCost(D.staffBaseId);
 for(const count of [0,1,2,3]){holdings(g,count);assert.equal(g.ownedCastles().length,count+1);assert.equal(g.upgradeCastleCount(),count);scaled(g.costs('farm'),facility,2**Math.max(0,count-1));scaled(g.castleUpgradeCost(D.staffBaseId),castle,2**Math.max(0,count-1));}
 const ordinary=game();ordinary.state.castles.edo.owner=ordinary.state.clan;ordinary.state.castles[D.staffBaseId].owner=ordinary.state.clan;assert.equal(ordinary.upgradeCastleCount(),1,'role-restricted projected castles cannot count as ordinary ownership');
});

test('same-level upkeep stays fixed while extra castles add only their original recurring charge',()=>{
 const g=game();for(const castle of Object.values(g.state.castles))castle.troops=0;
 const rates={facility:g.facilityUpkeep('farm',3),castle:g.castleUpkeep('nijo',1),branch:g.branchUpkeep('nijo_north',3)},before=g.maintenance();
 assert.deepEqual(rates,{facility:{gold:6,rice:3,wood:3,stone:3},castle:{gold:2,rice:61,wood:1,stone:1},branch:{gold:6,rice:3,wood:3,stone:3}});
 holdings(g,4);assert.equal(g.upgradeCostMultiplier(),8);assert.deepEqual({facility:g.facilityUpkeep('farm',3),castle:g.castleUpkeep('nijo',1),branch:g.branchUpkeep('nijo_north',3)},rates);
 const after=g.maintenance();assert.equal(after.facilities.townLevels,before.facilities.townLevels);assert.equal(after.facilities.branchLevels,before.facilities.branchLevels);assert.equal(after.facilities.branchFacilityLevels,before.facilities.branchFacilityLevels);assert.deepEqual(after.troopUpkeep,before.troopUpkeep);
 for(const key of D.resources)assert.equal(after.facilityUpkeep[key]-before.facilityUpkeep[key],3*(D.maintenance.facilityLevel[key]+(key==='rice'?D.maintenance.castleRice:0)),key);
});

test('recruiting, officer employment, training, summons and level gates keep their previous prices',()=>{
 const g=game(),officer=officers.find(o=>!g.state.officers.includes(o.id)),measure=()=>({troops:g.recruitTroopCost(100),officer:g.recruitmentCost(officer.id),training:g.trainingCost(),single:g.gachaCost(1),ten:g.gachaCost(10),scout:g.scoutCost(),diplomacy:g.diplomacyCost(),unlock:g.buildingUnlock('mint'),command:g.commandMax(),slots:g.constructionSlots()}),base=measure();
 holdings(g,8);assert.equal(g.upgradeCostMultiplier(),128);assert.deepEqual(measure(),base);g.state.tech.commerce=g.state.buildings.academy;const before=copy(g.state);assert.equal(g.research('commerce').ok,false);assert.deepEqual(g.state,before);
});

for(const [name,run]of tests){run();console.log('PASS '+name);}console.log(`${tests.length} territory upgrade-cost checks passed. Local engine only; no services contacted.`);
