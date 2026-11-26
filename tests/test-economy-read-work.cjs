/* Economic reads remain fresh without constructing unrelated display models. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {fixture,officers}=require('../tools/audit-economy.cjs');
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const copy=value=>JSON.parse(JSON.stringify(value));
function expectedBonus(category,officer){
 if(!officer)return 1;
 const specialist=officer.skill==='farmer'&&category==='rice'||officer.skill==='merchant'&&category==='gold'||officer.skill==='engineer'&&['wood','stone','defense','research'].includes(category);
 return 1+(officer.politics||0)/400+(specialist?.1:officer.skill==='administrator'?.05:0);
}

test('every rank, specialty and runtime role has the same political bonus as its public officer view',()=>{
 const categories=[...new Map(D.buildings.map(building=>[building.category,building])).values()];
 for(const role of [{},{isAdmin:true},{isStaff:true}]){
  const game=new E({officers,seed:57,...role});
  for(const rank of D.ranks){
   game.state.officerVariants=officers.map(officer=>officer.id+':'+rank);
   const assignments=Object.fromEntries(officers.map(officer=>[officer.id,officer.id])),before=copy(game.state),batch=game._governorViews(assignments);
   for(const officer of officers){const view=game.officer(officer.id);
    for(const building of categories){
     const expected=expectedBonus(building.category,view);
     assert.equal(game.governorBonusFor(building.id,officer.id),expected);
     assert.equal(game.governorBonusFor(building.id,officer.id,batch),expected);
    }
   }
   assert.equal(game.governorBonusFor('farm','missing'),1);
   assert.deepEqual(game.state,before,'economic projections never mutate ranks or the save');
  }
 }
});
test('same-length rank replacement, reassignment and role changes update the very next economic read',()=>{
 const game=fixture(8,4),merchant=officers.find(officer=>officer.skill==='merchant'&&officer.politics<85),admin=D.adminAssets.officerId;
 game.state.officerVariants=[merchant.id+':D'];game.state.governors={market:merchant.id};
 const low=game.income().gross.gold;game.state.officerVariants[0]=merchant.id+':U';assert(game.income().gross.gold>low);
 game.state.governors={};const vacant=game.income().gross.gold;assert(vacant<low);
 game.state.officerVariants=[admin+':U'];game.state.governors={market:admin};
 const ordinary=game.governorBonusFor('market',admin);game.setAdminAccess(true);
 assert.equal(game.governorBonusFor('market',admin),expectedBonus('gold',game.officer(admin)));
 assert(game.governorBonusFor('market',admin)>=ordinary);
 game.setAdminAccess(false);assert.equal(game.governorBonusFor('market',admin),ordinary);
});
test('income, upkeep and capacity avoid constructing any castle or full officer display view',()=>{
 const game=fixture(32,100);game.state.officers=officers.map(officer=>officer.id);
 game.state.officerVariants=officers.flatMap(officer=>D.ranks.filter(rank=>game.canOwnOfficerVariant(officer.id,rank)).map(rank=>officer.id+':'+rank));
 game.state.governors=Object.fromEntries(D.buildings.map((building,index)=>[building.id,officers[index+3].id]));
 const expected={income:game.income(),maintenance:game.maintenance(),capacity:game.troopCapacity()},before=copy(game.state);
 game.castle=()=>assert.fail('An economic read must not construct a castle display view');
 game._officerView=()=>assert.fail('An economic read must not construct a complete officer display view');
 for(let tick=0;tick<60;tick++){
  assert.deepEqual(game.income(),expected.income);assert.deepEqual(game.maintenance(),expected.maintenance);assert.equal(game.troopCapacity(),expected.capacity);
 }
 assert.deepEqual(game.state,before);
});
test('ownership IDs are independent fresh snapshots that obey administrator and staff access',()=>{
 const game=fixture(8,6),ids=game.ownedCastleIds();assert.deepEqual(ids,game.ownedCastles().map(castle=>castle.id));
 ids.length=0;assert.equal(game.ownedCastleIds().length,6);
 const removed=game.ownedCastleIds().find(id=>id!==game.state.home),old=game.state.castles[removed].owner;
 game.state.castles[removed].owner='別の家';assert(!game.ownedCastleIds().includes(removed));game.state.castles[removed].owner=old;
 game.state.castles.edo.owner=game.state.clan;game.state.castles.kyoto_gosho.owner=game.state.clan;
 assert(!game.ownedCastleIds().includes('edo'));assert(!game.ownedCastleIds().includes('kyoto_gosho'));
 game.setAdminAccess(true);assert(game.ownedCastleIds().includes('edo'));assert(!game.ownedCastleIds().includes('kyoto_gosho'));
 game.setRoleAccess({isAdmin:false,isStaff:true});assert(game.ownedCastleIds().includes('kyoto_gosho'));assert(!game.ownedCastleIds().includes('edo'));
});
console.log(`${checks} economic read correctness/work groups passed. 60 developed-state ticks: 0 castle or complete officer display models.`);
