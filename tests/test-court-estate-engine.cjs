/* Shared Kyoto grants the existing extra-castle economy over verified periods. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=structuredClone;
const clock=elapsedMs=>({id:'court-estate-clock',elapsedMs,running:true,speed:1,revision:0});
function fresh(options={}){const game=new E({officers:[],seed:17,...options});game.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};game._cpuTurn=()=>[];return game;}
function projection(game,changes={}){return{version:1,campaignId:game.state.walking.campaignId,revision:1,proof:'court-estate-proof-1',asOfElapsedMs:300000,accessWindows:[{fromElapsedMs:0,toElapsedMs:null}],base:{id:'kyoto_gosho',revision:1,createdElapsedMs:0,initial:{castleLevel:1},history:[],jobs:[]},...changes};}
function apply(game,value){const result=game.setCourtEstateProjection(value);assert(result.ok,result.message);return result;}
function extraCastle(game,level){const id=D.castles.find(c=>game.canOwnCastle(c.id)&&c.id!==game.state.home&&!D.majorCityIds.includes(c.id)).id;Object.assign(game.state.castles[id],{owner:game.state.clan,level,troops:0});return id;}
function rate(game){const income=game.income();return{gross:income.gross,net:income.net,operatingNet:income.operatingNet,facilityUpkeep:income.facilityUpkeep,troopUpkeep:income.troopUpkeep,capacity:game.troopCapacity(),priceCount:game.upgradeCastleCount(),farm:game.costs('farm'),castle:game.castleUpgradeCost(game.state.home),research:game.researchCost('commerce')};}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('one shared castle uses exactly one ordinary castle income, capacity, prices and upkeep across clans and levels',()=>{
 for(const clan of ['織田家','北条家','徳川家'])for(const level of [1,3,32]){
  const g=fresh({clan});for(const id of ['commerce','cultivation','forestry','masonry'])g.state.tech[id]=2;
  const normal=E.fromSave(g.exportSave(),[]),id=extraCastle(normal,level),p=projection(g);p.base.initial.castleLevel=level;apply(g,p);
  assert.equal(g.evaluation().rankId,normal.evaluation().rankId,'comparison has identical rank modifiers');
  assert.deepEqual(rate(g),rate(normal),clan+' Lv.'+level);assert.equal(g.state.castles[id].owner===g.state.clan,false);
  const effects=g.courtEstateEffects();assert.equal(effects.holdingCount,1);assert.equal(effects.baseTroopCapacity,500);assert.deepEqual(effects.baseIncome,{gold:100+(level-1)*15,rice:170+(level-1)*20,wood:40+(level-1)*5,stone:30+(level-1)*5});assert.deepEqual(effects.facilityUpkeep,{gold:level*2,rice:level+60,wood:level,stone:level});
 }
});

test('existing governors and capacity ceilings apply to the shared castle through the normal formula',()=>{
 const g=fresh({officers}),candidate=g.state.officers.find(id=>!g.state.army.includes(id));assert(candidate);g.state.governors.barracks=candidate;
 const normal=E.fromSave(g.exportSave(),officers);extraCastle(normal,1);apply(g,projection(g));assert.equal(g.troopCapacity(),normal.troopCapacity());assert(g.troopCapacity()>6500);
 for(const building of D.buildings)g.state.buildings[building.id]=32;assert(g.troopCapacity()<=D.assetCap);
 const before=copy(g.state);g.courtEstateEffects();g.income();assert.deepEqual(g.state,before,'reading the effect never produces assets');
});

test('authority stays outside saves and cannot change personal home, clan, buildings, armies or legal ownership',()=>{
 const g=fresh(),before=copy(g.state),targets=g.adjacentTargets().map(c=>c.id),income=g.income(),p=projection(g);apply(g,p);
 assert.deepEqual(g.state,before);assert.equal(g.isStaff,false);assert.equal(g.isAdmin,false);assert.equal(g.canOwnCastle('kyoto_gosho'),false);assert.deepEqual(g.ownedCastleIds(),[g.state.home]);assert.deepEqual(g.adjacentTargets().map(c=>c.id),targets);
 assert.equal(g.upgradeCastle('kyoto_gosho').ok,false);assert.deepEqual(g.state,before);assert.equal(g.buildBranch('kyoto_gosho','north').ok,false);assert.deepEqual(g.state,before);
 const saved=JSON.parse(g.exportSave());assert(!JSON.stringify(saved).includes('courtEstate'));assert.deepEqual(saved.state,before);
 const reload=E.fromSave(saved,[]);assert.equal(reload.getCourtEstateProjection(),null);assert.deepEqual(reload.income(),income);
 saved.state.courtEstateProjection=p;saved.courtEstateProjection=p;saved.state.entitlements={courtEstate:true};saved.state.courtOffice={title:'摂政'};
 const forged=E.fromSave(saved,[],{isCourtProtected:true,isCourtRegent:true});assert.equal(forged.getCourtEstateProjection(),null);assert.equal(forged.courtEstateEffects().active,false);
 const verified=E.fromSave(saved,[],{courtEstateProjection:p});assert.deepEqual(verified.income(),g.income());
 const exposed=g.getCourtEstateProjection();exposed.base.initial.castleLevel=128;exposed.accessWindows[0].toElapsedMs=0;assert.equal(g.courtEstateEffects().castleLevel,1);assert.equal(g.courtEstateEffects().active,true);
 apply(g,null);assert.deepEqual(g.income(),income);assert.deepEqual(g.state,before);
});

test('grant, castle completion, revocation and reappointment integrate only their exact time intervals',()=>{
 const g=fresh(),saved=g.exportSave(),p=projection(g,{asOfElapsedMs:55000,accessWindows:[{fromElapsedMs:5000,toElapsedMs:25000},{fromElapsedMs:35000,toElapsedMs:50000}]});
 p.base.history=[{kind:'castle',id:'kyoto_gosho',level:2,effectiveElapsedMs:15000}];p.base.jobs=[{kind:'castle',id:'kyoto_gosho',targetLevel:3,completesElapsedMs:40000}];apply(g,p);
 const reference=E.fromSave(saved,[]),id=extraCastle(reference,1),enemy=reference.state.castles[id].owner;reference.state.castles[id].owner='在地衆';
 for(const [seconds,level]of [[5,0],[10,1],[10,2],[10,0],[5,2],[10,3],[5,0]]){reference.state.castles[id].owner=level?enemy:'在地衆';reference.state.castles[id].level=level||1;reference._advanceRealtime(seconds);}
 g._advanceRealtime(55);assert.deepEqual(g.state.resources,reference.state.resources);for(const key of D.resources)assert(Math.abs(g.state.realtime.incomeRemainders[key]-reference.state.realtime.incomeRemainders[key])<1e-8);
 assert.equal(g.courtEstateEffects().active,false);assert.equal(g.state.castles.kyoto_gosho.level,1);assert.equal(g.state.jobs.length,0,'shared jobs never enter the private queue');
 const settled=copy(g.state);g._advanceRealtime(1);assert.deepEqual(g.state,settled,'an expired authority horizon cannot continue earning');
});

test('historical windows replay after revocation and survive a save reload without duplicate production',()=>{
 const source=fresh();source.applyWorldClock(clock(0));const p=projection(source,{asOfElapsedMs:55000,accessWindows:[{fromElapsedMs:10000,toElapsedMs:30000}]});
 const whole=E.fromSave(source.exportSave(),[],{courtEstateProjection:p}),parts=E.fromSave(source.exportSave(),[],{courtEstateProjection:p});assert.equal(whole.isCourtProtected,false);
 whole.applyWorldClock(clock(55000));parts.applyWorldClock(clock(20000));const restored=E.fromSave(parts.exportSave(),[],{courtEstateProjection:p});restored.applyWorldClock(clock(55000));
 assert.deepEqual(restored.state.resources,whole.state.resources);for(const key of D.resources)assert(Math.abs(restored.state.realtime.incomeRemainders[key]-whole.state.realtime.incomeRemainders[key])<1e-8);assert.equal(restored.courtEstateEffects().active,false);
 const before=copy(restored.state);assert.equal(restored.applyWorldClock(clock(55000)).changed,false);assert.equal(restored.applyWorldClock(clock(20000)).changed,false);assert.deepEqual(restored.state,before);
});

test('current snapshots cap catchup and refreshing the horizon resumes exactly once',()=>{
 const g=fresh();g.applyWorldClock(clock(0));const p=projection(g,{asOfElapsedMs:20000,hasMore:true});p.base.history=[{kind:'castle',id:'kyoto_gosho',level:2,effectiveElapsedMs:40000}];apply(g,p);const result=g.applyWorldClock(clock(55000));assert.equal(result.courtEstatePending,true);assert.equal(g.state.worldClock.elapsedMs,20000);assert.equal(g.courtEstateEffects().castleLevel,1,'a canonical completion beyond a paged authority horizon remains future');
 const paused=copy(g.state);g.applyWorldClock(clock(55000));assert.deepEqual(g.state,paused);const latest={...p,asOfElapsedMs:55000,hasMore:false};apply(g,latest);g.applyWorldClock(clock(55000));assert.equal(g.courtEstateEffects().castleLevel,2);
 const control=E.fromSave({game:'sengoku-tento',version:2,state:{...copy(paused),worldClock:{id:'court-estate-clock',elapsedMs:20000}}},[],{courtEstateProjection:latest});control.applyWorldClock(clock(55000));assert.deepEqual(g.state.resources,control.state.resources);
 assert.deepEqual(g.getCourtEstateStatus(),{campaignId:p.campaignId,revision:1,baseRevision:1,proof:p.proof,asOfElapsedMs:55000});
});

test('stale or malformed authority is rejected atomically, while verified historical pruning is accepted',()=>{
 const g=fresh(),p=projection(g,{revision:3,asOfElapsedMs:60000});p.base.revision=4;apply(g,p);const current=g.getCourtEstateProjection(),before=copy(g.state);
 const invalid=[{...p,campaignId:'other-campaign'},{...p,version:2},{...p,proof:''},{...p,accessWindows:[{fromElapsedMs:10,toElapsedMs:20},{fromElapsedMs:19,toElapsedMs:null}]},{...p,accessWindows:[{fromElapsedMs:0,toElapsedMs:null},{fromElapsedMs:10,toElapsedMs:null}]},{...p,base:{...p.base,initial:{castleLevel:129}}},{...p,base:{...p.base,jobs:[{kind:'castle',id:'kyoto_gosho',targetLevel:3,completesElapsedMs:60000}]}}];
 for(const value of invalid){assert.equal(g.setCourtEstateProjection(value).ok,false);assert.deepEqual(g.getCourtEstateProjection(),current);assert.deepEqual(g.state,before);}
 for(const value of [{...p,revision:2},{...p,asOfElapsedMs:59999},{...p,base:{...p.base,revision:3}}])assert.equal(g.setCourtEstateProjection(value).code,'COURT_ESTATE_PROJECTION_STALE');
 apply(g,{...p,revision:4,proof:'updated-proof',accessWindows:[],hasMore:true});assert.equal(g.courtEstateEffects().active,false);assert.equal(g.getCourtEstateStatus().hasMore,true);
});

test('replay detection ignores future jobs and cosmetic revisions but detects already accrued changes',()=>{
 const g=fresh();g._advanceRealtime(20);const p=projection(g,{asOfElapsedMs:60000,accessWindows:[{fromElapsedMs:5000,toElapsedMs:null}]});assert(g.courtEstateProjectionRequiresReplay(p,{fromElapsedMs:0}));assert(!g.courtEstateProjectionRequiresReplay(p,{fromElapsedMs:20000}));apply(g,p);
 const future=copy(p);future.base.revision++;future.proof='future-work';future.base.jobs=[{kind:'castle',id:'kyoto_gosho',targetLevel:2,completesElapsedMs:30000}];assert(!g.courtEstateProjectionRequiresReplay(future,{fromElapsedMs:0}));
 const ended=copy(p);ended.revision++;ended.accessWindows[0].toElapsedMs=15000;assert(g.courtEstateProjectionRequiresReplay(ended,{fromElapsedMs:0}));assert(!g.courtEstateProjectionRequiresReplay(ended,{fromElapsedMs:20000}));
 const pruned={...p,accessWindows:[]};assert(!g.courtEstateProjectionRequiresReplay(pruned,{fromElapsedMs:20000}));assert(g.courtEstateProjectionRequiresReplay(null,{fromElapsedMs:0}));
});

test('shared ownership starts at base creation and completed levels do not arrive early',()=>{
 const g=fresh(),p=projection(g,{asOfElapsedMs:50000});p.base.createdElapsedMs=10000;p.base.history=[{kind:'castle',id:'kyoto_gosho',level:2,effectiveElapsedMs:30000}];apply(g,p);assert.equal(g.courtEstateEffects().active,false);
 g._advanceRealtime(10);assert.equal(g.courtEstateEffects().castleLevel,1);g._advanceRealtime(19.999);assert.equal(g.courtEstateEffects().castleLevel,1);g._advanceRealtime(.001);assert.equal(g.courtEstateEffects().castleLevel,2);
});

test('cycle settlement preserves the shared level without adding conquest rewards or changing personal home',()=>{
 const g=fresh(),cycleMs=D.worldCalendar.monthsPerCycle*60000,home=g.state.home,clan=g.state.clan;
 const p=projection(g,{asOfElapsedMs:cycleMs+60000});p.base.initial.castleLevel=32;apply(g,p);const reward=g._settleCycle(1);
 assert.equal(reward.captured,0);assert.equal(g.state.home,home);assert.equal(g.state.clan,clan);assert.equal(g.state.castles.kyoto_gosho.level,1);assert.equal(g.courtEstateEffects().castleLevel,32);assert.equal(g.upgradeCastleCount(),2);assert.equal(g.ownedCastleIds().length,1);
});

test('staff shared projection is never counted twice and earlier ordinary service still earns its valid interval',()=>{
 const personal=fresh(),buildings=copy(personal.state.buildings),base={id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings},buildings:copy(buildings),history:[],jobs:[],createdElapsedMs:0,updatedElapsedMs:60000,accessSinceElapsedMs:30000,clanSinceElapsedMs:30000,personalClan:personal.state.clan,personalHome:personal.state.home,personalCycleHome:personal.state.home,personalBaseCastle:copy(personal.state.castles.kyoto_gosho),personalHomeCastle:copy(personal.state.castles[personal.state.home])};
 const p=projection(personal,{asOfElapsedMs:55000,accessWindows:[{fromElapsedMs:0,toElapsedMs:30000}]});
 const staff=E.fromSave(personal.exportSave(),[],{isStaff:true,staffBase:base,courtEstateProjection:p});assert.equal(staff.state.home,personal.state.home);assert.equal(staff.courtEstateEffects().active,true);
 staff._advanceRealtime(30);staff._projectStaffAt(30000);assert.equal(staff.state.home,'kyoto_gosho');assert.equal(staff.courtEstateEffects().active,false);
 const income=staff.income(),capacity=staff.troopCapacity(),count=staff.upgradeCastleCount();apply(staff,null);assert.deepEqual(staff.income(),income);assert.equal(staff.troopCapacity(),capacity);assert.equal(staff.upgradeCastleCount(),count);
});

test('campaign reset drops previous authority and browser and Worker engines stay identical',()=>{
 const g=fresh();apply(g,projection(g));g.state.walking.campaignId='replacement-campaign';assert.equal(g.getCourtEstateProjection(),null);assert.equal(g.courtEstateEffects().active,false);
 assert.equal(fs.readFileSync(path.join(__dirname,'../engine.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../server/game-engine.js'),'utf8'));
});

console.log(JSON.stringify({ok:true,checks}));
