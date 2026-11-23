'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E}=require('../engine.js');
const officer=(id,lead,extra={})=>({id,name:'検証 '+id,clan:'織田家',region:'東海',lead,intellect:lead,valor:lead,politics:70,rank:'D',rarity:'D',skill:'commander',description:'検証用',...extra});
const roster=[officer('main',100),officer('strong',99),officer('second',90),officer('third',85),officer('fourth',80),officer('fifth',75),officer('weak',30,{politics:95}),officer('weakest',20,{politics:90}),officer('tie_a',65),officer('tie_z',65)];
const branch=(parent,commanders=[])=>({id:parent+'_north',parentCastleId:parent,direction:'north',level:2,fallen:false,commanders});
function fixture({admin=false,ids=roster.map(o=>o.id),branches=[branch('nijo',['weak','weakest'])]}={}){
 const game=new E({officers:roster,clan:'織田家',seed:4919,isAdmin:admin});game.state.officers=ids.slice();game.state.officerVariants=ids.map(id=>id+':D');delete game.state.officerHealth;game.state.army=ids.includes('main')?['main']:[];game.state.governors={};game.state.branches=structuredClone(branches);game.state.command=0;
 for(const row of branches)game.state.castles[row.parentCastleId].owner=game.state.clan;
 return game;
}
const posts=game=>[...game.state.army,...game.state.branches.flatMap(row=>row.commanders),...Object.values(game.state.governors)];
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('full branch preview includes replacements, preserves state, and moves a stronger governor',()=>{
 const game=fixture();game.state.governors={farm:'strong',market:'second'};const before=structuredClone(game.state),plan=game.branchCommanderAutoPlan('nijo_north');
 assert(plan.ok&&plan.changed);assert.deepEqual(game.state,before);assert.deepEqual(plan.formations[0].previousCommanders,['weak','weakest']);assert.deepEqual(plan.formations[0].commanders,['strong','second']);assert.equal(plan.assignedCount,2);assert.equal(plan.changedCount,2);assert.equal(plan.replacedCount,2);assert.equal(plan.retainedCount,0);assert.equal(plan.releasedCount,2);assert.equal(plan.remainingSlots,0);assert.equal(plan.assignments[0].fromBuildingId,'farm');
 const applied=game.autoAssignBranchCommanders('nijo_north');assert(applied.ok&&applied.changed);assert.deepEqual(game.branch('nijo_north').commanders,['strong','second']);assert.deepEqual(game.state.governors,{});assert.deepEqual(game.state.army,before.army);assert.deepEqual(game.state.resources,before.resources);assert.equal(game.state.command,0);assert.equal(new Set(posts(game)).size,posts(game).length);
});

test('selected branch cannot take the main army or another branch commander',()=>{
 const game=fixture({branches:[branch('nijo',['weak','weakest']),branch('osaka',['strong','third'])]});game.state.governors={farm:'second'};
 const result=game.autoAssignBranchCommanders('nijo_north');assert(result.ok);assert.deepEqual(game.branch('osaka_north').commanders,['strong','third']);assert.deepEqual(game.branch('nijo_north').commanders,['second','fourth']);assert.deepEqual(game.state.army,['main']);assert(!game.state.governors.farm);
});

test('suitable full formation and equal-stat incumbent are stable no-ops',()=>{
 const game=fixture({ids:['main','strong','tie_a','tie_z'],branches:[branch('nijo',['tie_z','strong'])]}),before=structuredClone(game.state);
 const plan=game.branchCommanderAutoPlan('nijo_north');assert(plan.ok);assert.equal(plan.changed,false);assert.equal(plan.changedCount,0);assert.equal(plan.retainedCount,2);assert.deepEqual(plan.assignments,[]);assert.deepEqual(plan.formations[0].commanders,['tie_z','strong']);
 const result=game.autoAssignBranchCommanders('nijo_north');assert(result.ok&&!result.changed);assert.deepEqual(game.state,before,'No-op cannot add a log entry or reorder slots');
});

test('all branches reconsider full posts, retain top incumbents and enforce Edo1 other2',()=>{
 const game=fixture({admin:true,branches:[branch('edo',['weak']),branch('nijo',['weakest','fifth']),branch('osaka',['fourth','third'])]});game.state.governors={farm:'strong',market:'second'};
 const result=game.autoAssignBranchCommanders('all');assert(result.ok&&result.changed);assert.equal(result.replacedCount,2);assert.equal(result.retainedCount,3);assert.equal(result.assignedCount,5);assert.equal(result.releasedCount,2);
 assert.equal(game.branch('edo_north').commanders.length,1);for(const id of ['nijo_north','osaka_north'])assert.equal(game.branch(id).commanders.length,2);
 assert.deepEqual(new Set(game.state.branches.flatMap(row=>row.commanders)),new Set(['strong','second','third','fourth','fifth']));assert.deepEqual(game.branch('osaka_north').commanders,['fourth','third']);assert.deepEqual(game.state.governors,{});assert.deepEqual(game.state.army,['main']);
 const before=structuredClone(game.state),again=game.autoAssignBranchCommanders('all');assert(again.ok&&!again.changed);assert.equal(again.changedCount,0);assert.deepEqual(game.state,before);
});

test('global governor optimization releases replaced commanders into the facility pool',()=>{
 const game=fixture({ids:['main','strong','second','weak','weakest']});game.state.governors={farm:'strong',market:'second'};const before=structuredClone(game.state),plan=game.planGovernorAssignments();assert.deepEqual(game.state,before);
 assert.equal(plan.branchAssignedCount,2);assert.equal(plan.branchReplacedCount,2);assert.equal(plan.branchReleasedCount,2);assert.deepEqual(new Set(Object.values(plan.governors)),new Set(['weak','weakest']));
 const result=game.autoAssignGovernors();assert(result.ok&&result.changed);assert.deepEqual(game.branch('nijo_north').commanders,['strong','second']);assert.deepEqual(new Set(Object.values(game.state.governors)),new Set(['weak','weakest']));assert.equal(new Set(posts(game)).size,posts(game).length);assert.deepEqual(game.state.army,before.army);assert.deepEqual(game.state.resources,before.resources);assert.equal(game.state.command,0);
 const repeated=game.autoAssignGovernors();assert.equal(repeated.branchAssignedCount,0);assert.equal(repeated.branchRetainedCount,2);assert.equal(repeated.changed,false);
 const restored=E.fromSave(game.exportSave(),roster);assert.deepEqual(restored.state.branches,game.state.branches);assert.deepEqual(restored.state.governors,game.state.governors);
});

test('ineligible branch officers remain reserved and scarce officers cover first slots without needless moves',()=>{
 const inactive=branch('nagoya',['strong']);inactive.fallen=true;
 const game=fixture({ids:['main','strong','second'],branches:[branch('nijo'),branch('osaka',['second']),inactive]});const before=structuredClone(game.state),result=game.autoAssignBranchCommanders('all');
 assert(result.ok&&!result.changed);assert.equal(result.remainingSlots,3);assert.deepEqual(game.state,before);assert.deepEqual(game.branch('osaka_north').commanders,['second']);assert.deepEqual(game.branch('nagoya_north').commanders,['strong']);
 const uneven=fixture({ids:['main','strong','second'],branches:[branch('nijo',['strong','second']),branch('osaka')]});const distributed=uneven.autoAssignBranchCommanders('all');assert(distributed.changed);assert.equal(uneven.branch('nijo_north').commanders.length,1);assert.equal(uneven.branch('osaka_north').commanders.length,1);assert.equal(distributed.assignments.length,1);assert.equal(distributed.changedCount,2);assert.equal(distributed.assignments[0].fromBranchId,'nijo_north');assert.equal(distributed.releasedCount,0);
});

test('single-batch planning does not rebuild each branch candidate roster',()=>{
 const game=fixture({branches:[branch('nijo'),branch('osaka'),branch('nagoya')]}),original=game.officerViews.bind(game);let batches=0;game.officerViews=(...args)=>{batches++;return original(...args);};game.branchCommanderStatus=()=>{throw Error('Full per-branch roster scan is not needed');};
 const before=structuredClone(game.state),plan=game.branchCommanderAutoPlan('all');assert(plan.ok);assert.equal(batches,1);assert.deepEqual(game.state,before);assert.equal(plan.assignedCount,6);
});

console.log(count+' branch reassignment groups passed; all operations stayed local.');
