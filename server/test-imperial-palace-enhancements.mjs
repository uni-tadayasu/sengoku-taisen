import assert from 'node:assert/strict';
import {harness,settleFieldMarch} from './test-support.mjs';
import {fixture,post,row,save,appoint,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

let checks=0,calls=0,maxBindings=0;
const metrics={},fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Imperial residence tests must remain local');};
async function scope(name,run){const h=harness(),statement=h.db.statement;h.db.statement=function(sql,args){maxBindings=Math.max(maxBindings,args.length);assert(args.length<=100,'D1 parameter limit');return statement.call(this,sql,args);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const lease=async(h,p)=>(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
function engine(s,projection=s.courtEstateProjection){return GameEngine.fromSave(s.save,GAME_OFFICERS,{isAdmin:s.user.isAdmin,isStaff:s.user.isStaff,isDeputy:s.user.isDeputy,isSento:s.entitlements.sentoGosho,isCourtProtected:!!s.entitlements.courtProtected,staffBase:s.staffBase,maintenanceAuthority:s.maintenanceAuthority,courtEstateProjection:projection});}
function seedPalace(h,values={}){
 const row=h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),base=JSON.parse(row.state_json),buildings={...base.initial.buildings,keep:8,farm:6,market:7,barracks:9,wall:5,academy:4,dojo:4,main_gate:3,library:2,envoy_house:2,...values};
 Object.assign(base,{initial:{castleLevel:7,buildings:structuredClone(buildings)},castleLevel:7,buildings,jobs:[],history:[],updatedElapsedMs:base.createdElapsedMs});
 h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='kyoto_gosho'").run(JSON.stringify(base));return base;
}
async function setup(h){
 const admin=await fixture(h,'仙洞検証の太政大臣',{admin:true}),retired=await fixture(h,'仙洞検証の天皇',{staff:true,startCastle:'kiyosu'}),successor=await fixture(h,'仙洞検証の後継',{staff:true,startCastle:'inuyama'});
 await appoint(h,retired);seedPalace(h);const nomination=await nominateSuccessor(h,retired,successor);await certifySuccessor(h,admin,nomination.nomination);
 return{admin,retired,successor};
}
async function ordain(h,p){const status=(await h.api('/court/retirement',{token:p.token})).data.retirement;return(await h.api('/court/retirement/ordain',post(p,{requestId:crypto.randomUUID(),expectedRevision:status.revision,successionId:status.successionId,confirmed:true}))).data;}
function ordinaryProjection(projection){const result=structuredClone(projection);delete result.enhancementWindows;return result;}

try{
 await scope('verified retirement moves to Sento and applies the higher palace levels exactly once',async h=>{
  const{retired}=await setup(h),s=await snapshot(h,retired),g=engine(s),baseline=engine(s,ordinaryProjection(s.courtEstateProjection)),original=structuredClone(s.save.state),shared=g.courtEstateEffects().enhancements;
  assert.equal(s.user.isSento,true);assert.equal(s.entitlements.sentoGosho,true);assert.equal(g.state.home,'sento_gosho');assert.equal(g.state.cycle.home,'sento_gosho');assert.equal(g.isStaff,false);assert.equal(g.isSento,true);assert.equal(s.residency,null);
  assert.equal(shared.mode,'maximum');assert.equal(shared.castleLevel,7);assert.equal(shared.buildings.dojo,4);assert.equal(g.effectiveBuildings().keep,16,'stronger personal keep survives');assert.equal(g.effectiveBuildings().farm,6);assert.equal(g.effectiveCastleLevel(g.state.home),7);
  // The formula oracle supplies the expected combined levels directly. A
  // second Sento personal save would correctly cap inherited-only facilities,
  // so it cannot stand in for a verified Kyoto projection.
  const reference=engine(s,ordinaryProjection(s.courtEstateProjection)),sentoIds=new Set(globalThis.SENGOKU_DATA.sentoRules.facilityIds),expectedBuildings=Object.fromEntries(globalThis.SENGOKU_DATA.buildings.map(building=>[building.id,Math.max(sentoIds.has(building.id)?Math.min(20,original.buildings[building.id]):0,shared.buildings[building.id])]));
  assert.deepEqual(g.effectiveBuildings(),expectedBuildings);assert.equal(g.buildingLevel('dojo'),0);assert.equal(g.effectiveBuildings().dojo,4);
  reference.effectiveBuildings=()=>expectedBuildings;reference.state.castles[reference.state.home].level=7;
  assert.equal(g.troopCapacity(),reference.troopCapacity());assert.equal(g._facilityEffect('military'),reference._facilityEffect('military'));assert.equal(g._facilityEffect('defense'),reference._facilityEffect('defense'));assert.equal(g.defensePower(g.state.home),reference.defensePower(reference.state.home));
  for(const key of ['gold','wood','stone'])assert.equal(g.income().gross[key],reference.income().gross[key]);assert.equal(g.income().rankRiceBonus.baseRice,reference.income().rankRiceBonus.baseRice);assert.deepEqual(g.maintenance().facilityUpkeep,reference.maintenance().facilityUpkeep);
  assert(g.troopCapacity()>baseline.troopCapacity());assert(g.defensePower(g.state.home)>baseline.defensePower(baseline.state.home));assert(g.income().rankRiceBonus.baseRice>baseline.income().rankRiceBonus.baseRice);assert(g.researchCost('commerce').gold<baseline.researchCost('commerce').gold);assert(g.diplomacyCost().gold<baseline.diplomacyCost().gold);
  assert.equal(g.commandMax(),baseline.commandMax());assert.equal(g.constructionSlots(),baseline.constructionSlots());assert.deepEqual(g.state.buildings,original.buildings);assert.deepEqual(g.state.castles,original.castles);
  const exported=JSON.parse(g.exportSave());assert(!JSON.stringify(exported).includes(s.courtEstateProjection.proof));assert(!Object.hasOwn(exported.state,'palaceCombatEffects'));assert(!Object.hasOwn(exported.state,'isSento'));
  const dto=(await h.api('/court/estate',{token:retired.token})).data.courtEstate;assert.equal(dto.home.id,'sento_gosho');assert.deepEqual(dto.effects.enhancements,shared);
  const health=(await h.api('/health')).data;assert.equal(health.features.sentoGosho,true);assert.equal(health.features.imperialPalaceEnhancements,true);
  metrics.stats={home:'sento_gosho',troopCapacityBefore:baseline.troopCapacity(),troopCapacityAfter:g.troopCapacity(),defenseBefore:baseline.defensePower(baseline.state.home),defenseAfter:g.defensePower(g.state.home),baseRiceBefore:baseline.income().rankRiceBonus.baseRice,baseRiceAfter:g.income().rankRiceBonus.baseRice};
 });
 await scope('Kyoto inherited facilities retain their full limits beyond the Sento personal catalogue',async h=>{
  const{retired}=await setup(h);seedPalace(h,{farm:30,dojo:28,main_gate:24});
  const s=await snapshot(h,retired),g=engine(s),before=structuredClone(g.state.buildings);
  assert.equal(g.buildingCatalog().length,12);assert.equal(g.buildingMax('farm'),20);assert.equal(g.buildingMax('dojo'),0);
  assert.equal(g.effectiveBuildings().farm,30);assert.equal(g.effectiveBuildings().dojo,28);assert.equal(g.effectiveBuildings().main_gate,24);
  const plain=engine(s,ordinaryProjection(s.courtEstateProjection));assert.equal(plain.effectiveBuildings().dojo,0);assert(g._facilityEffect('military')>plain._facilityEffect('military'));assert(g.defensePower(g.state.home)>plain.defensePower(plain.state.home));
  assert.deepEqual(g.state.buildings,before);assert.deepEqual(save(h,retired).state.buildings,before);
 });
 await scope('completed palace upgrades reach the retired holder at their exact completion boundary',async h=>{
  const{retired}=await setup(h),initial=await snapshot(h,retired),oldProjection=structuredClone(initial.courtEstateProjection),oldFarm=engine(initial).effectiveBuildings().farm;
  const view=(await h.api('/court/estate',{token:retired.token})).data.courtEstate;
  const result=(await h.api('/court/estate/upgrade',post(retired,{requestId:crypto.randomUUID(),kind:'building',id:'farm',baseRevision:view.base.revision,accessStamp:view.accessStamp,deviceId:retired.deviceId,expectedRevision:row(h,retired).revision}))).data;
  const deadline=result.receipt.completesElapsedMs;h.now+=deadline-result.receipt.startedElapsedMs;
  const s=await snapshot(h,retired),g=engine(s);g.state.worldClock.elapsedMs=deadline-1;g.state.turn=Math.floor((deadline-1)/60000);g.state.realtime.elapsed=(deadline-1)%60000/1000;assert.equal(g.effectiveBuildings().farm,oldFarm);
  const before=g.income().rankRiceBonus.baseRice;g.state.worldClock.elapsedMs=deadline;g.state.turn=Math.floor(deadline/60000);g.state.realtime.elapsed=deadline%60000/1000;assert.equal(g.effectiveBuildings().farm,oldFarm+1);assert.equal(g.income().rankRiceBonus.baseRice,before+450);
  assert(s.courtEstateProjection.base.history.some(event=>event.kind==='building'&&event.id==='farm'&&event.effectiveElapsedMs===deadline));assert.equal(save(h,retired).state.buildings.farm,initial.save.state.buildings.farm);assert.notEqual(s.courtEstateProjection.proof,oldProjection.proof);
  const current=await lease(h,retired),body={deviceId:retired.deviceId,revision:current.revision,save:current.save,maintenanceRevision:current.maintenanceAuthority.revision,courtEstateProof:oldProjection.proof};
  const rejected=(await h.api('/sync',{method:'PUT',token:retired.token,body,expected:409})).data;assert.equal(rejected.error.code,'COURT_ESTATE_REFRESH_REQUIRED');
 });
 await scope('ordination retains the same inherited stats while royal fallback receives neither residence nor enhancements',async h=>{
  const{admin,retired,successor}=await setup(h),before=engine(await snapshot(h,retired)).courtEstateCombatEffects();await ordain(h,retired);const cloistered=await snapshot(h,retired);assert.equal(cloistered.user.isSento,true);assert.deepEqual(engine(cloistered).courtEstateCombatEffects(),before);
  assert.equal((await h.api('/court/estate',{token:retired.token})).data.courtEstate.role.id,'cloistered-emperor');
  const third=await fixture(h,'仙洞検証の次代',{staff:true,startCastle:'odawara'}),nomination=await nominateSuccessor(h,successor,third);await certifySuccessor(h,admin,nomination.nomination);
  const returned=await snapshot(h,successor);assert.equal(returned.entitlements.sentoGosho,false);assert.notEqual(returned.save.state.home,'sento_gosho');assert.equal(engine(returned).courtEstateCombatEffects(),null);assert(!returned.courtEstateProjection?.enhancementWindows?.length);
 });
 await scope('untrusted save flags cannot acquire Sento or change the verified return address',async h=>{
  const{retired}=await setup(h),p=await fixture(h,'仙洞を自己申告する一般領主',{startCastle:'yonezawa'}),ordinary=await lease(h,p),forged=structuredClone(ordinary.save);forged.state.home='sento_gosho';forged.state.cycle.home='sento_gosho';forged.state.castles.sento_gosho.owner=forged.state.clan;forged.state.isSento=true;forged.state.isRetiredEmperor=true;
  const local=GameEngine.fromSave(forged,GAME_OFFICERS);assert.equal(local.isSento,false);assert.notEqual(local.state.home,'sento_gosho');assert.equal(local.canOwnCastle('sento_gosho'),false);
  const denied=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:ordinary.revision,save:forged},expected:403})).data;assert.equal(denied.error.code,'SENTO_ENTITLEMENT_REQUIRED');
  const s=await lease(h,retired),trueReturn=s.save.state.imperialResidence.returnHome,tampered=structuredClone(s.save);tampered.state.imperialResidence.returnHome='osaka';
  const accepted=(await h.api('/sync',{method:'PUT',token:retired.token,body:{deviceId:retired.deviceId,revision:s.revision,save:tampered}})).data;assert.equal(accepted.save.state.imperialResidence.returnHome,trueReturn);assert.equal(accepted.save.state.home,'sento_gosho');
  const directory=(await h.api('/castles/residency',{token:p.token})).data;assert.equal(directory.capacity,123);assert(!directory.castles.some(c=>c.castleId==='sento_gosho'));assert.throws(()=>new GameEngine({officers:GAME_OFFICERS,startCastle:'sento_gosho'}));
 });
 await scope('public defense and real outgoing and incoming field battles use the inherited numeric stats',async h=>{
  const{retired}=await setup(h),p=await fixture(h,'仙洞の実戦相手',{startCastle:'odawara'}),s=await lease(h,retired);
  const departure=(await h.api('/field/attack',post(retired,{requestId:crypto.randomUUID(),targetPlayerId:p.user.id,targetCastleId:'odawara',troops:300,tactic:'balanced',deviceId:retired.deviceId,expectedRevision:s.revision}))).data;
  const record=h.sql.prepare('SELECT payload_json FROM battle_marches WHERE actor_id=? AND request_id=?').get(retired.user.id,departure.march.requestId),profile=JSON.parse(record.payload_json).attackProfile;
  assert(profile.palaceCombatEffects.military>0);const powers=[.9,.95,1,1.08,1.16,1.25,1.35,1.5],ranks=['D','C','B','A','S','SS','SSS','U'],rankPower=profile.army.length?Math.round(profile.army.reduce((sum,id)=>sum+(Math.max(...ranks.map((rank,i)=>profile.officerVariants.includes(id+':'+rank)?powers[i]:0))||1)*GameEngine.officerCombatFactor(profile,id),0)/profile.army.length*1000)/1000:.75;
  const base=300*(.7+.5*profile.morale/100)*(1+profile.tech.discipline*.06+profile.tech.gunnery*.05)*rankPower,battle=await settleFieldMarch(h,retired,departure);assert.equal(battle.attackPower,Math.max(1,Math.round(base*(1+profile.palaceCombatEffects.military))));assert(battle.attackPower>Math.round(base));
  const attacker=await fixture(h,'仙洞への攻撃役',{startCastle:'ishikawa'}),ready=await lease(h,attacker),incoming=(await h.api('/field/attack',post(attacker,{requestId:crypto.randomUUID(),targetPlayerId:retired.user.id,targetCastleId:'sento_gosho',troops:300,tactic:'balanced',deviceId:attacker.deviceId,expectedRevision:ready.revision}))).data,incomingBattle=await settleFieldMarch(h,attacker,incoming);
  assert.equal(incomingBattle.battleMode,'reward');assert.deepEqual(incomingBattle.defenderLost,{troops:0,garrison:0});assert.equal(incomingBattle.capture.captured,false);
  const field=(await h.api('/field?limit=100',{token:attacker.token})).data,target=field.targets.find(target=>target.playerId===retired.user.id&&target.targetCastleId==='sento_gosho');assert(target);assert.equal(target.defensePower,incomingBattle.defensePower);assert.equal(target.palaceControl,null);assert.equal(target.shogunateIndependent,true);
  metrics.battle={attackWithoutPalace:Math.round(base),actualAttack:battle.attackPower,actualDefense:incomingBattle.defensePower};
 });
 await scope('Sento never becomes a start, unification, regional or CPU deployment target',async h=>{
  const{retired}=await setup(h),g=engine(await snapshot(h,retired)),plain=GameEngine.fromSave(JSON.parse(g.exportSave()),GAME_OFFICERS);
  assert(!g.getUnificationProof().targetCastleIds.includes('sento_gosho'));assert.equal(g.unificationTarget(),plain.unificationTarget());assert(!globalThis.SENGOKU_DATA.regionConquest.regions.some(region=>region.castleIds.includes('sento_gosho')));
  assert.deepEqual(GameEngine.roamingDeploymentUnits(GameEngine.roamingDeploymentDefaults(),'sento_gosho'),[]);assert(!GameEngine.roamingDeploymentSummary(GameEngine.roamingDeploymentDefaults()).castles.some(c=>c.castleId==='sento_gosho'));
  const before=structuredClone(g.state.castles.sento_gosho);for(let turn=6;turn<=180;turn+=3){g.state.turn=turn;g._cpuTurn();}assert.deepEqual(g.state.castles.sento_gosho,before);
  assert.equal(g.relocateResidence('yonezawa',{role:'lord'}).code,'RESIDENCY_FIXED_HOME');assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM castle_seats WHERE castle_id='sento_gosho'").get().n,0);
 });
 console.log(JSON.stringify({ok:true,checks,calls,maxBindings,productionRequests:0,metrics},null,2));
}finally{globalThis.fetch=fetch;}
