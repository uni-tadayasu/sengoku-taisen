/* Bound production/read work without caching mutable campaign or role state. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {fixture,officers}=require('../tools/audit-economy.cjs');
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}
const content=save=>{const {savedAt,...rest}=save;return rest;};

test('a full collection reads abilities only for the active army and distinct completed-facility governors',()=>{
 const game=fixture(32,100);game.state.officers=officers.map(officer=>officer.id);
 game.state.officerVariants=officers.flatMap(officer=>D.ranks.filter(rank=>game.canOwnOfficerVariant(officer.id,rank)).map(rank=>officer.id+':'+rank));
 game.state.army=officers.slice(0,3).map(officer=>officer.id);
 game.state.governors=Object.fromEntries(D.buildings.map((building,index)=>[building.id,officers[index+3].id]));
 let abilityReads=0;
 const observed=officers.map(officer=>{const row={...officer};for(const stat of ['lead','valor','intellect','politics'])Object.defineProperty(row,stat,{get(){abilityReads++;return officer[stat];},enumerable:true});return row;});
 const expected=game.evaluation();assert.deepEqual(E.evaluateState(game.state,{officers:observed}),expected);
 assert.equal(abilityReads,3*3+D.buildings.length,'unassigned officers do not construct abilities every tick');
 abilityReads=0;game.state.army=[];game.state.governors={};
 E.evaluateState(game.state,{officers:observed});assert.equal(abilityReads,0);
 // Same-length, in-place changes must be visible on the immediate next read.
 const id=game.state.officers[0];game.state.officerVariants=[id+':D'];game.state.army=[id];
 const initial=game.evaluation().breakdown.find(row=>row.id==='formation').score;
 game.state.officerVariants[0]=id+':U';assert(game.evaluation().breakdown.find(row=>row.id==='formation').score>initial);
 game.state.army=[];assert.equal(game.evaluation().breakdown.find(row=>row.id==='formation').score,0);
});

test('adjacency constructs only returned enemy castle views and keeps access/ownership edits current',()=>{
 const game=fixture(16,100),expected=game.adjacentTargets(),reads=[],castle=game.castle.bind(game);
 game.castle=id=>{reads.push(id);return castle(id);};
 assert.deepEqual(game.adjacentTargets(),expected);assert.deepEqual(reads,expected.map(row=>row.id));
 const captured=expected.find(row=>game.canOwnCastle(row.id));assert(captured);
 game.state.castles[captured.id].owner=game.state.clan;assert(!game.adjacentTargets().some(row=>row.id===captured.id));
});

test('quest counts and upkeep troop snapshots avoid all decorative castle projections',()=>{
 const game=fixture(16,100),expected=D.quests.map(quest=>game.questStatus(quest.id)),troops=game.upkeepTroopSnapshot();
 game.castle=()=>assert.fail('counting holdings or reading troops must not calculate durability');
 for(let tick=0;tick<60;tick++){assert.deepEqual(D.quests.map(quest=>game.questStatus(quest.id)),expected);assert.deepEqual(game.upkeepTroopSnapshot(),troops);}
 const id=game.ownedCastleIds()[0];game.state.castles[id].troops++;assert.equal(game.upkeepTroopSnapshot().castles[id],troops.castles[id]+1);
});

test('object snapshots, compact local saves and readable downloads retain the same isolated save schema',()=>{
 for(const role of [{},{isAdmin:true},{isStaff:true},{isDeputy:true}]){
  const game=new E({officers,seed:45,...role}),expected=content(JSON.parse(game.exportSave())),snapshot=game.exportSnapshot();
  assert.deepEqual(content(snapshot),expected);assert.deepEqual(content(JSON.parse(game.exportSave({compact:true}))),expected);
  assert(game.exportSave({compact:true}).length<game.exportSave().length);
  const restored=E.fromSave(game.exportSave({compact:true}),officers,role);
  assert.deepEqual(content(restored.exportSnapshot()),expected);
  snapshot.state.resources.gold=0;snapshot.state.buildings.farm=0;snapshot.state.officers.length=0;
  assert.deepEqual(content(game.exportSnapshot()),expected,'a caller cannot mutate the live game through its snapshot');
 }
});

test('staff snapshots export the personal estate while leaving the projected Kyoto buildings intact',()=>{
 const game=new E({clan:'伊達家',startCastle:'himeji',officers,seed:14}),personalFarm=game.state.buildings.farm;
 game.setRoleAccess({isStaff:true});const buildings={...game.state.buildings,farm:12};
 const result=game.applyStaffBase({id:'kyoto_gosho',revision:1,castleLevel:3,buildings,initial:{castleLevel:3,buildings:{...buildings}},history:[],jobs:[],updatedElapsedMs:0,accessSinceElapsedMs:0,personalClan:'伊達家',protected:true});assert(result.ok);
 const snapshot=game.exportSnapshot();assert.equal(snapshot.state.buildings.farm,personalFarm);assert.equal(game.state.buildings.farm,12);
 snapshot.state.buildings.farm=1;snapshot.state.staffService.personalHomeCastle.level=20;
 assert.equal(game.state.buildings.farm,12);assert.notEqual(game.exportSnapshot().state.staffService.personalHomeCastle.level,20);
});

test('the sync bridge uses an isolated object snapshot while pending roles retain their original durable source',()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),definition=source.split('\n').find(line=>line.startsWith('  function getGameSave('));assert(definition);
 const current={game:'sengoku-tento',state:{resources:{gold:55}}};let snapshots=0,exports=0;
 const context={startPending:false,saveEnabled:true,syncAccess:{rolePending:false},pendingRoleSave:null,game:{exportSnapshot(){snapshots++;return structuredClone(current);},exportSave(){exports++;throw Error('formatted serialization must not be used for sync');}},JSON};
 vm.createContext(context);vm.runInContext(definition,context);
 const snapshot=context.getGameSave();snapshot.state.resources.gold=0;assert.equal(context.getGameSave().state.resources.gold,55);assert.equal(snapshots,2);assert.equal(exports,0);
 context.syncAccess.rolePending=true;context.pendingRoleSave=JSON.stringify({state:{resources:{gold:17}}});assert.equal(context.getGameSave().state.resources.gold,17);assert.equal(snapshots,2);
 context.startPending=true;assert.equal(context.getGameSave(),null);context.startPending=false;context.saveEnabled=false;assert.throws(()=>context.getGameSave(),/同期しません/);
});
console.log(`${checks} runtime read/snapshot groups passed. Full collection: 73 ability reads; unchanged synchronization schema.`);
