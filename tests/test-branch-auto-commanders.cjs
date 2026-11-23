'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),clone=value=>JSON.parse(JSON.stringify(value)),tests=[];
const test=(name,run)=>tests.push([name,run]);
const branch=(parent,direction='north',extra={})=>({id:parent+'_'+direction,parentCastleId:parent,direction,level:2,fallen:false,commanders:[],...extra});
function fixture({admin=false,count=12}={}){
 const game=new E({officers,seed:4910,isAdmin:admin});
 const ids=game.roster.filter(row=>game.canOwnOfficerVariant(row.id,'A')).slice(0,count).map(row=>row.id);
 game.state.officers=[];game.state.officerVariants=[];for(const id of ids)game._grantOfficerVariant(id,'A');
 game.state.army=[];game.state.governors={};game.state.command=0;
 for(const id of ['nijo','osaka','nagoya'])game.state.castles[id].owner=game.state.clan;
 game.state.branches=[branch('nijo'),branch('nijo','south'),branch('osaka'),...(admin?[branch('edo')]:[])];
 return{game,ids};
}
function unchanged(game,run){const before=clone(game.state),result=run();assert.deepEqual(game.state,before);return result;}
test('automatic preview is read-only, ranks owned abilities and excludes every existing assignment',()=>{
 const {game,ids}=fixture();game.state.army=[ids[0]];game.state.governors={farm:ids[1]};assert(game.assignBranchCommander('osaka_north',ids[2]).ok);
 const best=ids.slice(3).map(id=>game.officer(id)).sort((a,b)=>b.lead-a.lead||b.intellect-a.intellect||b.valor-a.valor||(a.id<b.id?-1:1));
 const plan=unchanged(game,()=>game.branchCommanderAutoPlan('nijo_north'));assert(plan.ok);assert.equal(plan.assignments.length,2);
 assert.deepEqual(plan.assignments.map(row=>row.officerId),best.slice(0,2).map(row=>row.id));assert.equal(plan.commandCost,0);
 const resources=clone(game.state.resources),army=clone(game.state.army),governors=clone(game.state.governors);
 assert(game.autoAssignBranchCommanders('nijo_north').ok);assert.equal(game.state.command,0);assert.deepEqual(game.state.resources,resources);assert.deepEqual(game.state.army,army);assert.deepEqual(game.state.governors,governors);assert.deepEqual(game.branch('osaka_north').commanders,[ids[2]]);
});
test('each Edo branch holds one and other cities two while current commanders remain in their slots',()=>{
 const {game,ids}=fixture({admin:true});assert(game.assignBranchCommander('nijo_north',ids[0]).ok);
 const result=game.autoAssignBranchCommanders('all');assert(result.ok);assert.equal(result.assignments.length,6);
 assert.equal(game.branch('edo_north').commanders.length,1);for(const id of ['nijo_north','nijo_south','osaka_north'])assert.equal(game.branch(id).commanders.length,2);
 assert.equal(game.branch('nijo_north').commanders[0],ids[0]);const assigned=game.state.branches.flatMap(row=>row.commanders);assert.equal(new Set(assigned).size,assigned.length);
 assert.equal(unchanged(game,()=>game.autoAssignBranchCommanders('all')).code,'BRANCH_COMMANDER_NO_SLOTS');
});
test('limited free officers first cover separate eligible branches and leave unavailable branches untouched',()=>{
 const {game,ids}=fixture({count:2});game.state.branches.push(branch('nagoya','east',{fallen:true}),branch('nagoya','west',{level:0}),branch('edo'));
 const result=game.autoAssignBranchCommanders('all');assert(result.ok);assert.equal(result.assignments.length,2);assert.equal(new Set(result.assignments.map(row=>row.branchId)).size,2);assert.equal(result.remainingSlots,4);
 assert(game.state.branches.filter(row=>['nagoya_east','nagoya_west','edo_north'].includes(row.id)).every(row=>row.commanders.length===0));assert.equal(new Set(game.state.branches.flatMap(row=>row.commanders)).size,ids.length);
 assert.equal(unchanged(game,()=>game.autoAssignBranchCommanders('all')).code,'BRANCH_COMMANDER_NO_CANDIDATES');
});
test('foreign, missing, unbuilt, fallen and retreating targets cannot mutate formations',()=>{
 const {game}=fixture();for(const id of ['missing','edo_north',undefined])assert.equal(unchanged(game,()=>game.autoAssignBranchCommanders(id)).ok,false);
 for(const patch of [{fallen:true},{level:0},{retreating:true,fallen:true}]){Object.assign(game.state.branches[0],patch);assert.equal(unchanged(game,()=>game.autoAssignBranchCommanders('nijo_north')).ok,false);Object.assign(game.state.branches[0],{level:2,fallen:false,retreating:false});}
 game.state.castles.nijo.owner='他家';assert.equal(unchanged(game,()=>game.autoAssignBranchCommanders('nijo_north')).ok,false);
});
test('automatic placements survive save/load and cannot duplicate officers in army or governors',()=>{
 const {game}=fixture();const result=game.autoAssignBranchCommanders('all');assert(result.ok);const loaded=E.fromSave(game.exportSave(),officers);
 assert.deepEqual(loaded.state.branches,game.state.branches);for(const row of result.assignments){assert.equal(loaded.assignArmy([row.officerId]).ok,false);assert.equal(loaded.assignGovernor('farm',row.officerId).ok,false);}
 loaded.autoAssignGovernors();assert(!Object.values(loaded.state.governors).some(id=>result.assignments.some(row=>row.officerId===id)));
});
for(const[name,run]of tests){run();console.log('PASS '+name);}
assert.equal(fs.readFileSync(path.join(__dirname,'../engine.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../server/game-engine.js'),'utf8'));
console.log(tests.length+' automatic branch placement groups passed; no game services used.');
