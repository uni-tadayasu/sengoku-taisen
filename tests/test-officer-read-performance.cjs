/* Fresh batch reads retain rank permissions, direct edits and economic effects. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {officers}=require('../tools/audit-economy.cjs');
const make=options=>new E({clan:'織田家',officers,seed:4917,...options});
const allIds=officers.map(officer=>officer.id);
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}

test('batch reads preserve requested order, duplicates, rank previews and unknown IDs',()=>{
 for(const options of [{},{isAdmin:true},{isStaff:true}]){
  const game=make(options);game.state.officerVariants=allIds.flatMap((id,index)=>D.ranks.filter((rank,i)=>game.canOwnOfficerVariant(id,rank)&&(index+i)%3===0).map(rank=>id+':'+rank)).reverse();
  const ids=[allIds[41],allIds[3],'missing',allIds[41],...allIds],before=structuredClone(game.state);
  for(const rank of [undefined,...D.ranks,'missing',null])assert.deepEqual(game.officerViews(ids,rank),ids.map(id=>game.officer(id,rank)));
  assert.deepEqual(game.officerViews([]),[]);assert.deepEqual(game.state,before);
 }
});
test('new ranks, same-length edits, imported state and role changes are visible immediately',()=>{
 const game=make(),id=allIds.find(id=>id!==D.adminAssets.officerId);
 game.state.officerVariants=[id+':C'];assert.equal(game.officerViews([id])[0].rank,'C');
 game.state.officerVariants[0]=id+':SS';assert.equal(game.officerViews([id])[0].rank,'SS');
 game.state.officerVariants.push(id+':U');assert.equal(game.officerViews([id])[0].rank,'U');
 game.state.officerVariants.splice(0,game.state.officerVariants.length,id+':D');assert.equal(game.officerViews([id])[0].rank,'D');
 const imported=make();imported._grantOfficerVariant(id,'S');imported.state.officerVariants=imported.state.officerVariants.filter(key=>!key.startsWith(id+':')).concat(id+':S');game.state=structuredClone(imported.state);assert.equal(game.officerViews([id])[0].rank,'S');
 const admin=D.adminAssets.officerId;game.state.officerVariants.push(admin+':U');assert.notEqual(game.officerViews([admin])[0].rank,'U');assert.equal(game.officerViews([admin],'U')[0].variantOwned,false);
 game.setAdminAccess(true);assert.equal(game.officerViews([admin])[0].rank,'U');assert.equal(game.officerViews([admin])[0].variantOwned,true);
 game.setAdminAccess(false);assert.notEqual(game.officerViews([admin])[0].rank,'U');assert.equal(game.officerViews([admin],'U')[0].variantOwned,false);
});
test('returned views are independent and cannot alter later reads or the roster',()=>{
 const game=make(),id=game.state.officers[0],before=game.officer(id),views=game.officerViews([id,id]);
 views[0].politics=-1;views[0].baseStats.politics=-2;views[0].variantOwned=false;
 assert.deepEqual(views[1],before);assert.deepEqual(game.officer(id),before);assert.deepEqual(game.officerViews([id])[0],before);
});
test('full collection reads avoid per-officer linear membership scans',()=>{
 const game=make();game.state.officerVariants=allIds.flatMap(id=>D.ranks.filter(rank=>game.canOwnOfficerVariant(id,rank)).map(rank=>id+':'+rank));
 const expected=allIds.map(id=>game.officer(id));let searches=0;game.state.officerVariants.includes=function(...args){searches++;return Array.prototype.includes.apply(this,args);};
 assert.deepEqual(game.officerViews(allIds),expected);assert.equal(searches,0);
 assert.equal(game.highestOwnedRank(allIds.find(id=>id!==D.adminAssets.officerId)),'U');assert.equal(searches,1);
});
test('income immediately reflects governor rank and assignment changes without touching health',()=>{
 const game=make(),merchant=officers.find(officer=>officer.skill==='merchant'&&officer.politics<100),other=officers.find(officer=>officer.skill==='farmer');
 game._grantOfficerVariant(merchant.id,'D');game._grantOfficerVariant(other.id,'D');game.state.governors={market:merchant.id};
 game.state.officerVariants=game.state.officerVariants.filter(key=>!key.startsWith(merchant.id+':')).concat(merchant.id+':D');const original=game.income().gross.gold,health=structuredClone(game.state.officerHealth);
 const index=game.state.officerVariants.indexOf(merchant.id+':D');game.state.officerVariants[index]=merchant.id+':U';assert(game.income().gross.gold>original);
 game.state.governors.market=other.id;assert.equal(game.income().gross.gold,Math.floor((180+game.state.buildings.keep*50+game.state.buildings.market*180*game.governorBonusFor('market',other.id)+game._facilityEffect('gold')+game.ownedCastles().length*100)*(1+game.state.tech.commerce*.12)*1.15));
 assert.deepEqual(game.state.officerHealth,health);
});
test('only the barracks description computes troop capacity',()=>{
 const game=make(),capacity=game.troopCapacity();let calls=0;game.troopCapacity=()=>{calls++;return capacity;};
 for(const building of D.buildings.filter(building=>building.core&&building.id!=='barracks'))assert(game.buildingSummary(building.id));
 assert.equal(calls,0);assert(game.buildingSummary('barracks').includes(capacity.toLocaleString()));assert.equal(calls,1);
});
console.log(checks+' officer read correctness/performance checks passed.');
