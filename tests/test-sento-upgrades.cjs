'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const Management=require('../management-model.js');
const copy=structuredClone;
const expectedIds=['keep','farm','market','lumber','quarry','barracks','wall','academy','rice_paddy','guardhouse','library','tea_house'];
const tests=[];const test=(name,run)=>tests.push([name,run]);
function fresh(options={}){const g=new E({officers:[],seed:17,...options});g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g._cpuTurn=()=>[];return g;}
function projection(g){return{version:1,campaignId:g.state.walking.campaignId,revision:1,proof:'verified-sento-cap-test',asOfElapsedMs:300000,accessWindows:[{fromElapsedMs:0,toElapsedMs:null}],enhancementWindows:[{fromElapsedMs:0,toElapsedMs:null}],base:{id:'kyoto_gosho',revision:1,createdElapsedMs:0,initial:{castleLevel:27,buildings:Object.fromEntries(D.buildings.map(b=>[b.id,b.id==='farm'?30:b.id==='dojo'?28:b.core?8:3]))},history:[],jobs:[]}};}

test('Sento exposes exactly twelve facilities capped at twenty while other residences retain sixty-four',()=>{
 const normal=fresh(),sento=fresh({isSento:true});
 assert.equal(normal.buildingCatalog().length,64);assert(normal.buildingCatalog().every(b=>normal.buildingMax(b.id)===32));
 assert.deepEqual(sento.buildingCatalog().map(b=>b.id),expectedIds);assert.deepEqual(D.sentoRules,{facilityIds:expectedIds,limit:20});
 assert.equal(sento.buildingMax(),20);assert(sento.buildingCatalog().every(b=>sento.buildingMax(b.id)===20));
 assert.equal(sento.state.home,'sento_gosho');assert.equal(sento.buildingMax('gold_mine'),0);assert.equal(sento.buildingMax('unknown'),0);
});

test('every Sento facility completes its twentieth stage and rejects a twenty-first reservation without spending',()=>{
 for(const id of expectedIds){
  const g=fresh({isSento:true});g.state.buildings.keep=20;g.state.buildings[id]=19;g.state.command=5;
  assert(g.upgrade(id).ok,id);assert.equal(g.state.jobs[0].targetLevel,20);const queued=copy(g.state);
  assert.equal(g.upgrade(id).ok,false,id);assert.equal(g.costs(id),null);assert.deepEqual(g.state,queued);
  g._advanceRealtime(180);assert.equal(g.state.buildings[id],20);assert.equal(g.buildingLevel(id),20);assert.equal(g.state.jobs.length,0);
  const saved=E.fromSave(g.exportSave(),[],{isSento:true});assert.equal(saved.buildingLevel(id),20);assert.equal(saved.upgrade(id).ok,false);
 }
});

test('the other fifty-two facilities cannot be quoted, built or queued for Sento',()=>{
 const g=fresh({isSento:true});g.state.buildings.keep=20;g.state.command=5;
 for(const building of D.buildings.filter(b=>!expectedIds.includes(b.id))){
  const before=copy(g.state);assert.equal(g.buildingUnlock(building.id).ok,false);assert.equal(g.costs(building.id,0),null);assert.equal(g.upgrade(building.id).ok,false);assert.deepEqual(g.state,before);
 }
});

test('legacy private development and paid work survive retirement, reload and departure without exceeding active Sento levels',()=>{
 const normal=fresh();normal.state.buildings.keep=32;normal.state.buildings.farm=27;normal.state.buildings.gold_mine=5;normal.state.command=7;
 assert(normal.upgrade('farm').ok);assert(normal.upgrade('gold_mine').ok);const original=copy(normal.state);
 const g=E.fromSave(normal.exportSave(),[],{isSento:true});g._cpuTurn=()=>[];
 assert.deepEqual(g.state.buildings,original.buildings);assert.deepEqual(g.state.resources,original.resources);assert.deepEqual(g.state.jobs,original.jobs);
 assert.equal(g.buildingLevel('farm'),20);assert.equal(g.buildingLevel('gold_mine'),0);assert.equal(g.commandMax(),5);assert.equal(g.constructionSlots(),4);
 assert.equal(g.effectiveBuildings().farm,20);assert.equal(g.effectiveBuildings().gold_mine,0);
 g._advanceRealtime(180);assert.equal(g.state.buildings.farm,28);assert.equal(g.state.buildings.gold_mine,6);assert.equal(g.state.jobs.length,0);
 assert.equal(g.effectiveBuildings().farm,20);assert.equal(g.effectiveBuildings().gold_mine,0);
 const reload=E.fromSave(g.exportSave(),[],{isSento:true});assert.equal(reload.state.buildings.farm,28);assert.equal(reload.buildingLevel('farm'),20);
 assert(reload.setSentoAccess(false).ok);assert.equal(reload.state.buildings.farm,28);assert.equal(reload.state.buildings.gold_mine,6);assert.equal(reload.buildingLevel('farm'),28);assert.equal(reload.buildingCatalog().length,64);
});

test('verified Kyoto enhancements retain their higher levels and facilities outside the Sento catalogue',()=>{
 const g=fresh({isSento:true});g.state.buildings.keep=32;g.state.buildings.farm=32;g.state.buildings.dojo=32;
 const raw=copy(g.state.buildings);assert.equal(g.buildingLevel('farm'),20);assert.equal(g.effectiveBuildings().dojo,0);
 assert(g.setCourtEstateProjection(projection(g)).ok);assert.equal(g.effectiveBuildings().farm,30);assert.equal(g.effectiveBuildings().dojo,28);assert.equal(g.effectiveCastleLevel(g.state.home),27);
 assert.equal(g.buildingLevel('farm'),20);assert.equal(g.buildingLevel('dojo'),0);assert.deepEqual(g.state.buildings,raw);
 assert(g.setCourtEstateProjection(null).ok);assert.equal(g.effectiveBuildings().farm,20);assert.equal(g.effectiveBuildings().dojo,0);assert.deepEqual(g.state.buildings,raw);
});

test('all own economic and combat facility effects use capped levels, including legacy imports',()=>{
 const legacy=fresh({isSento:true}),capped=fresh({isSento:true});
 for(const b of D.buildings){legacy.state.buildings[b.id]=32;capped.state.buildings[b.id]=expectedIds.includes(b.id)?20:0;}
 // Evaluation retains historical personal progress; compare rice before its rank bonus.
 assert.deepEqual(legacy.effectiveBuildings(),capped.effectiveBuildings());
 for(const key of ['gold','wood','stone'])assert.equal(legacy.income().gross[key],capped.income().gross[key]);assert.equal(legacy.income().rankRiceBonus.baseRice,capped.income().rankRiceBonus.baseRice);
 assert.equal(legacy.troopCapacity(),capped.troopCapacity());assert.equal(legacy.defensePower(legacy.state.home),capped.defensePower(capped.state.home));
 assert.equal(legacy.researchCost('commerce').gold,capped.researchCost('commerce').gold);assert.equal(legacy.diplomacyCost().gold,capped.diplomacyCost().gold);
});

test('facility ledger filters a full global catalogue and shows active Sento levels',()=>{
 const g=fresh({isSento:true});g.state.buildings.farm=32;g.state.buildings.gold_mine=32;
 const rows=Management.facilityRows(g,D.buildings);assert.equal(rows.length,12);assert.deepEqual(rows.map(row=>row.building.id),expectedIds);assert(rows.every(row=>row.maximum===20));
 const farm=rows.find(row=>row.building.id==='farm');assert.equal(farm.level,20);assert.equal(farm.status,'complete');assert.deepEqual(farm.cost,{});
 assert.equal(Management.facilityRows(fresh(),D.buildings).length,64);
});

test('ordination reward stays out of ordinary acquisition and only owns its fixed U variant',()=>{
 const special={id:'special_goshirakawa_hoo',name:'後白河法皇',rank:'U',rarity:'U',cloisteredReward:true,clan:'仙洞御所',lead:100,valor:100,intellect:100,politics:100,skill:'commander'};
 const g=fresh({officers:[special],isSento:true});assert.deepEqual(g.state.officers,[]);assert(D.ranks.every(rank=>!g.gachaPool(rank).length));assert.equal(g.canRecruitOfficer(special.id).ok,false);assert.match(g.canRecruitOfficer(special.id).reason,/法皇への就任/);
 assert.equal(g.canOwnOfficerVariant(special.id,'U'),true);assert.equal(g.canOwnOfficerVariant(special.id,'D'),false);assert.equal(g.collection().totalVariants,1);
 g._grantOfficerVariant(special.id,'U');const view=g.officer(special.id);for(const stat of ['lead','valor','intellect','politics'])assert.equal(view[stat],100);
 const restored=E.fromSave(g.exportSave(),[special],{isSento:true});assert(restored.ownsVariant(special.id,'U'));assert.equal(restored.collection().variants,1);
 const forged=JSON.parse(g.exportSave());forged.state.officerVariants.push(special.id+':D');assert.throws(()=>E.fromSave(forged,[special],{isSento:true}));
});

for(const [name,run] of tests){run();console.log('PASS '+name);}console.log(tests.length+' Sento construction and ordination-reward scenarios passed.');
