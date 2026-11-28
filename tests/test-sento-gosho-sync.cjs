'use strict';
// Real browser engine and cloud/app authority boundary; all responses stay in memory.
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {harness}=require('./test-court-protection-sync.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
function projection(campaignId){
 return{version:1,campaignId,revision:1,proof:'verified-imperial-palace',asOfElapsedMs:120000,accessWindows:[{fromElapsedMs:0,toElapsedMs:null}],enhancementWindows:[{fromElapsedMs:0,toElapsedMs:null}],base:{id:'kyoto_gosho',revision:1,createdElapsedMs:0,initial:{castleLevel:12,buildings:Object.fromEntries(D.buildings.map(building=>[building.id,building.core?8:3]))},history:[],jobs:[]}};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('verified Sento authority and palace enhancements arrive together without replacing personal facility records',async()=>{
 const h=harness({sentoGosho:true,protectedOffice:true,courtProjection:projection});try{
  const before=copy(h.server.save.state);assert((await h.start()).ok);const game=h.c.game;
  assert.equal(game.isSento,true);assert.equal(game.state.home,'sento_gosho');assert.equal(game.courtEstateEffects().enhancements.mode,'maximum');assert.equal(game.effectiveBuildings().wall,8);assert.equal(game.effectiveCastleLevel(game.state.home),12);assert.deepEqual(game.state.buildings,before.buildings);
  assert.equal(h.applied[0].entitlements.sentoGosho,true);assert.equal(h.applied[0].sentoGoshoCampaignId,game.state.walking.campaignId);
  const economyOnly=game.getCourtEstateProjection();delete economyOnly.enhancementWindows;const ordinary=E.fromSave(game.exportSave(),game.roster,{isSento:true,courtEstateProjection:economyOnly});
  assert(game.troopCapacity()>ordinary.troopCapacity());assert(game.defensePower(game.state.home)>ordinary.defensePower(ordinary.state.home));assert(game._facilityEffect('military')>ordinary._facilityEffect('military'));
  h.c.setRoleAccess({isAdmin:false,isStaff:false,isDeputy:false});assert.equal(h.c.game.isSento,true,'A regular profile refresh preserves verified runtime authority');
  const save=JSON.parse(game.exportSave());assert.equal(save.isSento,undefined);assert.equal(save.state.isSento,undefined);assert.equal(save.state.courtEstateProjection,undefined);assert.equal(E.fromSave(save,game.roster).isSento,false);
 }finally{h.sync.stop();}
});
test('a display-only title or isSento user flag cannot grant the dedicated residence',async()=>{
 const h=harness();try{h.server.displaySento=true;assert((await h.start()).ok);assert.equal(h.c.game.isSento,false);assert.notEqual(h.c.game.state.home,'sento_gosho');assert.equal(h.c.game.courtEstateEffects().enhancements,undefined);}finally{h.sync.stop();}
});
test('file flags, foreign owners and mismatched campaigns cannot import Sento authority or palace bonuses',async()=>{
 const h=harness();try{
  await h.start();const saved=h.bridge.getSave(),id=saved.state.walking.campaignId,meta={source:'cloud',playerId:'court-player-a',sentoGoshoCampaignId:id,courtEstateCampaignId:id,entitlements:{sentoGosho:true},courtEstateProjection:projection(id)};
  saved.isSento=true;saved.entitlements={sentoGosho:true};saved.state.isSento=true;saved.state.courtEstateProjection=projection(id);
  for(const invalid of [{},{isSento:true},{...meta,source:'file'},{...meta,playerId:'another-player'},{...meta,sentoGoshoCampaignId:'another-campaign',courtEstateCampaignId:'another-campaign'}]){
   assert(h.c.applyCloudSave(saved,invalid).ok);assert.equal(h.c.game.isSento,false);assert.notEqual(h.c.game.state.home,'sento_gosho');assert.equal(h.c.game.courtEstateEffects().enhancements,undefined);
  }
 }finally{h.sync.stop();}
});
test('disconnect, account revalidation and suspension remove Sento access and all inherited enhancements',async()=>{
 for(const mode of ['stop','pending','ban']){
  const h=harness({sentoGosho:true,protectedOffice:true,courtProjection:projection});try{
   await h.start();assert.equal(h.c.game.isSento,true);if(mode==='stop')h.sync.stop();else if(mode==='pending')h.sync.invalidateAccountAccess({playerId:'court-player-a'});else h.sync.suspendAccount({playerId:'court-player-a'});
   assert.equal(h.c.game.isSento,false);assert.notEqual(h.c.game.state.home,'sento_gosho');assert.equal(h.c.game.getCourtEstateProjection(),null);assert.equal(h.c.game.courtEstateEffects().enhancements,undefined);
  }finally{h.sync.stop();}
 }
});
test('royal restoration revokes the dedicated residence and enhancement window while preserving the ordinary estate grant',async()=>{
 const h=harness({sentoGosho:true,protectedOffice:true,courtProjection:projection});try{
  await h.start();const ordinary=E.fromSave(h.server.save,h.c.game.roster,{isSento:false});h.server.save=JSON.parse(ordinary.exportSave());h.server.revision++;h.server.sentoGosho=false;h.server.displaySento=false;
  h.server.courtProjection={...projection(h.server.save.state.walking.campaignId),revision:2,proof:'closed-imperial-palace',enhancementWindows:[{fromElapsedMs:0,toElapsedMs:0}]};
  assert((await h.sync.refresh()).ok);assert.equal(h.c.game.isSento,false);assert.notEqual(h.c.game.state.home,'sento_gosho');assert.equal(h.c.game.courtEstateEffects().active,true);assert.equal(h.c.game.courtEstateEffects().enhancements,undefined);
 }finally{h.sync.stop();}
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' Sento palace authority and enhancement sync scenarios passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
