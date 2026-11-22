/* Branch facility rules, paid jobs, exact income boundaries and save validation. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=v=>structuredClone(v),tests=[];
const test=(name,run)=>tests.push([name,run]);
const record=(parent='nijo',level=1,direction='north')=>({id:parent+'_'+direction,parentCastleId:parent,direction,level,fallen:false});
function ready(parent='nijo',level=1){const g=new E({officers,seed:91,isAdmin:parent==='edo'});g.state.castles[parent].owner=g.state.clan;g.state.resources={gold:9000000,rice:9000000,wood:9000000,stone:9000000};g.state.branches=[record(parent,level)];g._cpuTurn=()=>[];return g;}
function reject(g,run){const before=copy(g.state),r=run();assert.equal(r.ok,false,r.message);assert.deepEqual(g.state,before);return r;}
function finish(g,run){g.state.command=g.commandMax();const result=run();assert(result.ok,result.message);const job=g.state.jobs.find(j=>j.id===result.branchId);assert(job);g._advanceRealtime(job.remainingSeconds);assert(!g.state.jobs.some(j=>j.id===result.branchId));return result;}

test('every legal branch has its own six or twelve fixed slots and old saves receive no free facilities',()=>{
 assert.equal(D.branchFacilities.length,12);assert.equal(new Set(D.branchFacilities.map(d=>d.id)).size,12);
 for(const parent of D.branchRules.parents){const g=ready(parent.id,parent.maxLevel),before=copy(g.state),s=g.branchFacilityStatus(parent.id+'_north');assert.equal(s.slots,parent.id==='edo'?6:12);assert.equal(s.facilities.length,s.slots);assert.equal(s.maxLevel,parent.maxLevel);assert.equal(s.builtCount,0);assert.equal(s.totalLevels,0);assert(s.facilities.every(d=>d.level===0&&d.quote.ok&&d.artId===d.id));assert.deepEqual(g.state,before);const loaded=E.fromSave(g.exportSave(),officers,{isAdmin:parent.id==='edo'});assert.deepEqual(loaded.state.branches,g.state.branches);assert.deepEqual(loaded.branchFacilityBonuses(),{income:{gold:0,rice:0,wood:0,stone:0},capacity:0,defense:0,siegeDefense:0});}
 const g=ready('edo',8);for(const id of ['granary','trade_port','sawmill','stoneworks','drill_ground','moat','keep','__proto__'])reject(g,()=>g.buildBranchFacility('edo_north',id));
 for(const id of ['kyoto_gosho_north','sunpu_north','missing']){assert.equal(g.branchFacilityStatus(id).slots,0);reject(g,()=>g.buildBranchFacility(id,'farm'));}
});

test('construction charges the exact quote once and resumes fractional progress after reload',()=>{
 const g=ready('nijo',3),quote=g.branchFacilityQuote('nijo_north','market'),before=copy(g.state),result=g.buildBranchFacility('nijo_north','market');assert(result.ok);assert.equal(result.facilityId,'market');assert.equal(result.targetLevel,1);
 for(const key of D.resources)assert.equal(g.state.resources[key],before.resources[key]-(quote.cost[key]||0));assert.equal(g.state.command,before.command-1);assert.equal(g.state.jobs[0].kind,'branch');assert.equal(g.state.jobs[0].id,'nijo_north');assert.equal(g.state.jobs[0].facilityId,'market');assert.equal(g.state.jobs[0].totalSeconds,quote.cost.seconds);assert.equal(g.branch('nijo_north').level,3);assert.equal(g.branchFacilityStatus('nijo_north').facilities.find(d=>d.id==='market').level,0);
 g._advanceRealtime(21.125);const loaded=E.fromSave(g.exportSave(),officers);loaded._cpuTurn=()=>[];assert.equal(loaded.state.jobs[0].remainingSeconds,38.875);loaded._advanceRealtime(38.874);assert.equal(loaded.branchFacilityStatus('nijo_north').builtCount,0);loaded._advanceRealtime(.001);assert.equal(loaded.branch('nijo_north').facilities.market,1);assert.equal(loaded.branch('nijo_north').level,3);assert.deepEqual(loaded.state.branches[0].facilityCompletedAt.market,[60000]);assert.deepEqual(loaded.state.stats,before.stats);assert.deepEqual(E.fromSave(loaded.exportSave(),officers).state.branches,loaded.state.branches);
 reject(loaded,()=>loaded.buildBranchFacility('nijo_north','market'));assert(loaded.upgradeBranchFacility('nijo_north','market').ok);reject(loaded,()=>loaded.upgradeBranchFacility('nijo_north','market'));
});

test('branch upgrades, repairs and facilities share one job and the common construction capacity',()=>{
 const g=ready('nijo',3);g.state.branches.push(record('nijo',3,'south'));assert(g.buildBranchFacility('nijo_north','farm').ok);reject(g,()=>g.buildBranchFacility('nijo_north','market'));reject(g,()=>g.upgradeBranch('nijo_north'));reject(g,()=>g.repairBranch('nijo_north'));assert(g.buildBranchFacility('nijo_south','farm').ok);assert.equal(g.constructionChains(),2);g.state.command=3;reject(g,()=>g.upgrade('farm'));g._advanceRealtime(60);assert.equal(g.branch('nijo_north').facilities.farm,1);assert.equal(g.branch('nijo_south').facilities.farm,1);assert.equal(g.branchFacilityBonuses().income.rice,200);
 const busy=ready('osaka',4);assert(busy.upgrade('farm').ok);assert(busy.upgradeCastle(busy.state.home).ok);busy.state.command=3;reject(busy,()=>busy.buildBranchFacility('osaka_north','market'));
});

test('permission, completion, command, resources, local pause and completed branch level guard every start',()=>{
 const g=ready('nijo',1);reject(g,()=>g.upgradeBranchFacility('nijo_north','farm'));finish(g,()=>g.buildBranchFacility('nijo_north','farm'));reject(g,()=>g.upgradeBranchFacility('nijo_north','farm'));assert.match(g.branchFacilityQuote('nijo_north','farm').reason,/支拠点を増築/);finish(g,()=>g.upgradeBranch('nijo_north'));assert.equal(g.branchFacilityQuote('nijo_north','farm').maxLevel,2);assert(g.upgradeBranchFacility('nijo_north','farm').ok);
 for(const change of [g=>g.state.command=0,g=>g.state.resources.stone=0,g=>g.state.realtime.running=false,g=>g.state.branches[0].fallen=true,g=>g.state.castles.nijo.owner='在地衆',g=>g.state.gameOver=true]){const denied=ready();change(denied);reject(denied,()=>denied.buildBranchFacility('nijo_north','farm'));}
 const unbuilt=ready();unbuilt.state.branches=[];assert(unbuilt.buildBranch('nijo','north').ok);assert.equal(unbuilt.branchFacilityStatus('nijo_north').facilities.length,12);assert.equal(unbuilt.branchFacilityStatus('nijo_north').maxLevel,0);reject(unbuilt,()=>unbuilt.buildBranchFacility('nijo_north','farm'));
});

test('all facility types reach but never exceed the branch cap, with paid 60/120/180-second jobs',()=>{
 for(const parent of D.branchRules.parents){const g=ready(parent.id,parent.maxLevel),branchId=parent.id+'_north';for(const def of g.branchFacilityStatus(branchId).facilities){for(let level=0;level<parent.maxLevel;level++){g.state.command=g.commandMax();const quote=g.branchFacilityQuote(branchId,def.id);assert(quote.ok);assert.equal(quote.targetLevel,level+1);assert.equal(quote.cost.seconds,level>=16?180:level>=8?120:60);finish(g,()=>level?g.upgradeBranchFacility(branchId,def.id):g.buildBranchFacility(branchId,def.id));assert.equal(g.branch(branchId).facilities[def.id],level+1);}reject(g,()=>g.upgradeBranchFacility(branchId,def.id));assert.equal(g.branchFacilityQuote(branchId,def.id).cost,null);}assert.equal(g.branchFacilityStatus(branchId).builtCount,parent.facilitySlots);assert.equal(g.branchFacilityStatus(branchId).totalLevels,parent.facilitySlots*parent.maxLevel);assert.doesNotThrow(()=>E.fromSave(g.exportSave(),officers,{isAdmin:parent.id==='edo'}));}
});

test('bonuses are additive, own active branches only, and never multiply main-town technology or grant troops',()=>{
 const g=ready('nijo',4),baseline={income:g.income(),capacity:g.troopCapacity(),troops:g.state.troops,owned:g.ownedCastles().length,evaluation:g.evaluation()};g.state.branches[0].facilities={farm:2,market:2,lumber:2,quarry:2,barracks:2,watchtower:2,granary:2,trade_port:2,sawmill:2,stoneworks:2,drill_ground:2,moat:2};
 const bonuses=g.branchFacilityBonuses();assert.deepEqual(bonuses.income,{gold:160,rice:350,wood:140,stone:120});assert.equal(bonuses.capacity,500);assert.equal(bonuses.defense,.02);assert.equal(bonuses.siegeDefense,.015);for(const key of D.resources)assert.equal(g.income()[key]-baseline.income[key],bonuses.income[key]);assert.equal(g.troopCapacity()-baseline.capacity,500);assert.equal(g.state.troops,baseline.troops);assert.equal(g.ownedCastles().length,baseline.owned);assert.deepEqual(g.evaluation(),baseline.evaluation);
 g.state.branches[0].fallen=true;assert.deepEqual(g.income(),baseline.income);assert.equal(g.troopCapacity(),baseline.capacity);assert.equal(g.branchFacilityStatus('nijo_north').builtCount,12);assert.equal(g.branchFacilityStatus('nijo_north').active,false);g.state.branches[0].fallen=false;g.state.castles.nijo.owner='在地衆';assert.equal(g.branchFacilityBonuses().capacity,0);
});

test('defense facilities affect only their branch and moat bonuses are reduced by siege technology and tactic',()=>{
 const g=ready('osaka',8);g.state.branches.push(record('osaka',8,'south'));const parent=g.defensePower('osaka'),baseline=g.branchDefense('osaka_north');g.state.branches[0].facilities={watchtower:8,moat:8};const normal=g.branchDefense('osaka_north');assert.equal(normal.power,Math.round((baseline.force+200)*(1+8*.08)*(1+g.castle('osaka').wall*.03)*1.14));assert.equal(g.branchDefense('osaka_south').power,baseline.power);assert.equal(g.defensePower('osaka'),parent);
 const siege=g.branchDefense('osaka_north','siege',5);assert.equal(siege.facilityMultiplier,1+.08+.06*.4*.5);assert(siege.power<normal.power);assert.deepEqual(E.prototype.branchDefense.call({branch:()=>g.branch('osaka_north'),castle:()=>g.castle('osaka')},'osaka_north','siege',5),siege);
});

test('falling cancels paid facility work, retains completed levels and restores their effects only after repair',()=>{
 const g=ready('nijo',4);finish(g,()=>g.buildBranchFacility('nijo_north','market'));const levels=copy(g.state.branches[0].facilities);assert(g.upgradeBranchFacility('nijo_north','market').ok);g._advanceRealtime(20);assert(g._fallBranch('nijo_north'));assert.equal(g.state.jobs.length,0);assert.deepEqual(g.state.branches[0].facilities,levels);assert.equal(g.branchFacilityBonuses().income.gold,0);const loaded=E.fromSave(g.exportSave(),officers);loaded._cpuTurn=()=>[];assert.equal(loaded.branchFacilityBonuses().income.gold,0);finish(loaded,()=>loaded.repairBranch('nijo_north'));assert.equal(loaded.branchFacilityBonuses().income.gold,45);assert.equal(loaded.state.branches[0].facilities.market,1);
 assert(loaded.buildBranchFacility('nijo_north','farm').ok);loaded.state.castles.nijo.owner='在地衆';const saved=JSON.parse(loaded.exportSave());assert.equal(saved.state.branches.length,0);assert.equal(saved.state.jobs.filter(j=>j.kind==='branch').length,0);
});

test('production activates at exact completion and a later authoritative level cannot produce retroactively',()=>{
 const g=ready('nijo',3),control=ready('nijo',3);assert(g.buildBranchFacility('nijo_north','market').ok);control.state.resources=copy(g.state.resources);control.state.command=g.state.command;g._advanceRealtime(60);control._advanceRealtime(60);assert.deepEqual(g.state.resources,control.state.resources);g._advanceRealtime(60);control._advanceRealtime(60);assert.equal(g.state.resources.gold-control.state.resources.gold,45);
 const historical=ready('nijo',3),plain=ready('nijo',3);historical.state.branches[0].facilities={market:2};historical.state.branches[0].facilityCompletedAt={market:[45000,105000]};assert.equal(historical.branchFacilityBonuses().income.gold,0);historical._advanceRealtime(135);plain._advanceRealtime(135);assert.equal(historical.state.resources.gold-plain.state.resources.gold,90,'45/min for 60 seconds plus 90/min for 30 seconds');assert.equal(historical.branchFacilityBonuses().income.gold,90);
});

test('first common-clock adoption preserves existing facility effects and remaining construction time',()=>{
 for(const at of [0,240000]){const g=ready('nijo',3);finish(g,()=>g.buildBranchFacility('nijo_north','market'));g._advanceRealtime(15);assert(g.upgradeBranchFacility('nijo_north','market').ok);g._advanceRealtime(10);const before=g.branchFacilityBonuses(),remaining=g.state.jobs[0].remainingSeconds;assert(g.applyWorldClock({id:'world-v1',elapsedMs:at,running:true,speed:1}).migrated);assert.deepEqual(g.branchFacilityBonuses(),before);assert.equal(g.state.jobs[0].remainingSeconds,remaining);assert.equal(g.state.branches[0].facilityCompletedAt.market[0],Math.max(0,at-25000));assert.doesNotThrow(()=>E.fromSave(g.exportSave(),officers));}
});

test('save validation rejects unknown/excess facilities, invalid levels, forged job stages and malformed completion times',()=>{
 const g=ready('nijo',3);assert(g.buildBranchFacility('nijo_north','farm').ok);const initial=JSON.parse(g.exportSave());
 const mutations=[s=>s.branches[0].facilities=null,s=>s.branches[0].facilities=[],s=>s.branches[0].facilities={farm:-1},s=>s.branches[0].facilities={farm:1.5},s=>s.branches[0].facilities={farm:'1'},s=>s.branches[0].facilities={farm:4},s=>s.branches[0].facilities={keep:1},s=>s.branches[0].facilities=JSON.parse('{"__proto__":1}'),s=>s.jobs[0].facilityId='keep',s=>s.jobs[0].facilityId=null,s=>s.jobs[0].targetLevel=2,s=>s.jobs[0].repair=true,s=>s.jobs[0].kind='building',s=>s.jobs.push({...s.jobs[0],facilityId:'market'}),s=>{s.jobs[0].total=2;s.jobs[0].totalSeconds=120;},s=>s.branches[0].fallen=true,s=>s.branches[0].level=0];
 for(const change of mutations){const raw=copy(initial);change(raw.state);assert.throws(()=>E.fromSave(raw,officers));}
 g._advanceRealtime(60);const complete=JSON.parse(g.exportSave());for(const times of [null,[],{farm:[]},{farm:[-1]},{farm:[1.5]},{farm:['60000']},{farm:[60000,70000]},{market:[60000]},{farm:[60000],unknown:[60000]}]){const raw=copy(complete);raw.state.branches[0].facilityCompletedAt=times;assert.throws(()=>E.fromSave(raw,officers));}
 const edo=ready('edo',8);edo.state.branches[0].facilities={granary:1};assert.throws(()=>E.fromSave(edo.exportSave(),officers,{isAdmin:true}));
});

for(const [name,run] of tests){run();console.log('PASS '+name);}
assert.equal(fs.readFileSync(path.join(__dirname,'../server/game-engine.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../engine.js'),'utf8'));
console.log(tests.length+' branch facility engine groups passed; no live services.');
