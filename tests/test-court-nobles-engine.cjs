const assert=require('node:assert/strict');
globalThis.window=globalThis;
require('../officers-data.js');require('../engine.js');
const Engine=globalThis.SengokuEngine,D=globalThis.SENGOKU_DATA,roster=globalThis.SENGOKU_OFFICERS,nobles=roster.filter(o=>o.courtNoble);
const make=options=>new Engine({clan:'織田家',seed:12345,...options});
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
test('24 distinct court nobles have complete canonical data and balanced fixed-price tiers',()=>{
 assert.equal(roster.length,280);assert.equal(nobles.length,24);assert.equal(D.courtNobles.length,24);assert.equal(new Set(nobles.map(o=>o.name)).size,24);assert.equal(new Set(nobles.map(o=>o.id)).size,24);
 for(const [rank,cost] of [['SS',1200],['SSS',2400],['U',4800]]){const tier=nobles.filter(o=>o.rank===rank);assert.equal(tier.length,8);assert(tier.every(o=>o.cost===cost));}
 assert(nobles.every(o=>o.skillName&&o.skillDescription&&o.title&&o.house&&o.portrait==='assets/court-nobles/'+o.id+'.webp'));
});
test('ordinary starters, recruitment and all gacha ranks exclude court-only characters',()=>{
 for(const clan of D.clans){const g=make({clan:clan.name});assert(g.state.officers.every(id=>!g.baseOfficer(id).courtNoble));}
 for(const options of [{},{isAdmin:true},{isStaff:true},{isDeputy:true}]){const g=make(options);g.state.resources.gold=D.assetCap;g.state.buildings.keep=32;for(const rank of D.ranks)assert(g.gachaPool(rank).every(o=>!o.courtNoble));for(const o of nobles){const before=JSON.stringify(g.state);assert.equal(g.canRecruitOfficer(o.id).ok,false);assert.match(g.canRecruitOfficer(o.id).reason,/京都御所/);assert.equal(g.recruitOfficer(o.id).ok,false);assert.equal(JSON.stringify(g.state),before);}}
});
test('only each canonical rank is ownable and purchased nobles persist through save and role changes',()=>{
 const g=make();for(const o of nobles){for(const rank of D.ranks)assert.equal(g.canOwnOfficerVariant(o.id,rank),rank===o.rank);const acquired=g._grantOfficerVariant(o.id,o.rank);assert(acquired.isNewOfficer);assert.equal(g._grantOfficerVariant(o.id,'D'),null);}
 const copy=Engine.fromSave(g.exportSave(),roster);for(const o of nobles){assert.equal(copy.officer(o.id).rank,o.rank);assert.equal(copy.officerHealth(o.id).current,100);assert.equal(copy.ownedRanks(o.id).length,1);}
 copy.setRoleAccess({isStaff:true});copy.setRoleAccess({});for(const o of nobles)assert(copy.state.officers.includes(o.id));
 const forged=JSON.parse(g.exportSave());forged.state.officerVariants.push(nobles[0].id+':D');assert.throws(()=>Engine.fromSave(forged,roster));
});
test('new collection totals include 24 guaranteed portraits without changing 2047 ordinary outcomes',()=>{
 const g=make();assert.equal(D.ranks.reduce((total,rank)=>total+g.gachaPool(rank).length,0),2047);assert.equal(g.collection().totalVariants,2071);assert.equal(make({isAdmin:true}).collection().totalVariants,2072);
});
test('court interior skills improve actual production and acquired officers accept military assignments',()=>{
 const g=make(),farmer=nobles.find(o=>o.skill==='farmer');g._grantOfficerVariant(farmer.id,farmer.rank);const before=g.income().grossRice;assert.equal(g.assignGovernor('farm',farmer.id).ok,true);assert(g.income().grossRice>before);
 const commander=nobles.find(o=>o.skill==='commander');g._grantOfficerVariant(commander.id,commander.rank);assert.equal(g.assignArmy([commander.id]).ok,true);assert.equal(g.armyStats().count,1);
 const normal=g.previewRoamingBattle('road_scouts','balanced',300).attackPower,base=g.baseOfficer(commander.id),prior=base.skill;try{base.skill='administrator';const without=g.previewRoamingBattle('road_scouts','balanced',300).attackPower;assert(normal>without);}finally{base.skill=prior;}
});
console.log(`${checks} court-noble engine checks passed.`);
