/* Real branch officer rules and source-preserving rendering, without services. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E}=require('../engine.js'),B=require('../branches.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const tests=[],test=(name,run)=>tests.push([name,run]);
function game(parent='nijo'){
 const g=new E({officers,seed:29,isAdmin:parent==='edo'});g.state.castles[parent].owner=g.state.clan;g.state.castles.nagoya.owner=g.state.clan;
 g.state.branches=[{id:parent+'_north',parentCastleId:parent,direction:'north',level:3,fallen:false,commanders:[]},{id:'nagoya_east',parentCastleId:'nagoya',direction:'east',level:2,fallen:false,commanders:[]}];
 const ids=g.roster.filter(row=>g.canOwnOfficerVariant(row.id,'A')).slice(0,8).map(row=>row.id);for(const id of ids)g._grantOfficerVariant(id,'A');g.state.army=[ids[0]];g.state.governors={farm:ids[1]};g.state.command=0;
 assert(g.assignBranchCommander('nagoya_east',ids[2]).ok);return{g,ids,branchId:parent+'_north',parent};
}
function render(g,branchId,helpers={writable:true}){const dom=setup();stable.patch(dom.host,B.renderCommanders(g,g.branch(branchId),helpers),{key:'commanders'});return dom;}

test('Edo has one placement slot and each other major city has two, with actual owned officer art and rank',()=>{
 const art=[];global.SengokuArt={portrait:officer=>{art.push({id:officer.id,rank:officer.rank});return `<span class="portrait-frame" data-officer="${officer.id}" data-rank="${officer.rank}"></span>`;}};
 try{for(const parent of ['edo','nijo','osaka','nagoya']){
  const {g,ids,branchId}=game(parent);if(parent==='nagoya')g.state.branches=g.state.branches.filter(row=>row.id!=='nagoya_east');assert(g.assignBranchCommander(branchId,ids[3]).ok);
  const before=JSON.stringify(g.state),dom=render(g,branchId),limit=parent==='edo'?1:2;
  assert.equal(dom.host.querySelectorAll('.branch-commander-slot').length,limit);assert.equal(dom.host.querySelectorAll('.is-filled').length,1);assert.equal(dom.$('[data-branch-commander-count]').textContent,'1');
  assert(dom.host.textContent.includes(g.officer(ids[3]).name));assert(art.some(row=>row.id===ids[3]&&row.rank===g.officer(ids[3]).rank));assert.equal(JSON.stringify(g.state),before);
 }}finally{delete global.SengokuArt;}
});
test('army, governor and another branch assignments are unavailable with their actual location reasons',()=>{
 const {g,ids,branchId}=game();let dom=render(g,branchId),select=dom.$('[data-branch-commander-choice]');
 for(const[id,reason]of [[ids[0],/出陣軍団/],[ids[1],/奉行/],[ids[2],/支拠点/]]){
  assert(select.querySelector(`option[value="${id}"]`).disabled);assert(B.selectCommander(g,branchId,id));dom=render(g,branchId);assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert.match(dom.$('[data-branch-commander-reason]').textContent,reason);
 }
 assert(B.selectCommander(g,branchId,ids[3]));dom=render(g,branchId);assert.equal(dom.$('[data-action="assign-branch-commander"]').disabled,false);assert.equal(dom.$('[data-action="assign-branch-commander"]').getAttribute('data-officer'),ids[3]);assert.match(dom.host.textContent,/配置と解除に指令・資材は使いません/);
 assert(g.assignBranchCommander(branchId,ids[3]).ok);assert(g.assignBranchCommander(branchId,ids[4]).ok);assert(B.selectCommander(g,branchId,ids[5]));dom=render(g,branchId);assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert.match(dom.$('[data-branch-commander-reason]').textContent,/2名まで/);
});
test('fallen branches keep removal available, while unavailable persistence blocks both mutations',()=>{
 const {g,ids,branchId}=game();assert(g.assignBranchCommander(branchId,ids[3]).ok);g.state.branches.find(row=>row.id===branchId).fallen=true;assert(B.selectCommander(g,branchId,ids[4]));
 let dom=render(g,branchId);assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert.equal(dom.$('[data-action="remove-branch-commander"]').disabled,false);assert.match(dom.$('[data-branch-commander-reason]').textContent,/陥落/);
 dom=render(g,branchId,{writable:false,writableReason:'同期を確認しています。'});assert(dom.host.querySelectorAll('button').every(node=>node.disabled));assert.equal(dom.$('[data-branch-commander-reason]').textContent,'同期を確認しています。');
 assert(g.removeBranchCommander(branchId,ids[3]).ok);assert.equal(render(g,branchId).host.querySelectorAll('.is-filled').length,0);
});
test('focused candidate and painted portrait survive refresh, including a canonical save replacement',()=>{
 const {g,ids,branchId}=game();assert(B.selectCommander(g,branchId,ids[3]));const dom=render(g,branchId),select=dom.$('[data-branch-commander-choice]'),preview=dom.$('.branch-commander-preview');select.focus();dom.host.scrollTop=270;
 g.state.command=3;stable.patch(dom.host,B.renderCommanders(g,g.branch(branchId),{writable:true}),{key:'commanders'});assert.strictEqual(dom.$('[data-branch-commander-choice]'),select);assert.strictEqual(dom.$('.branch-commander-preview'),preview);assert.strictEqual(dom.doc.activeElement,select);assert.equal(dom.host.scrollTop,270);
 const candidate=E.fromSave(g.exportSave(),officers);assert(B.transferSelection(g,candidate));assert.equal(B.commanderSelection(candidate,branchId),ids[3]);stable.patch(dom.host,B.renderCommanders(candidate,candidate.branch(branchId),{writable:true}),{key:'commanders'});assert.strictEqual(dom.$('[data-branch-commander-choice]'),select);assert.equal(select.value,ids[3]);assert.equal(dom.host.scrollTop,270);
 assert(candidate.assignBranchCommander(branchId,ids[3]).ok);stable.patch(dom.host,B.renderCommanders(candidate,candidate.branch(branchId),{writable:true}),{key:'commanders'});assert.equal(dom.$('[data-branch-commander-count]').textContent,'1');assert.match(dom.$('[data-branch-commander-reason]').textContent,/配置済み/);assert(dom.$('[data-action="assign-branch-commander"]').disabled);
});
test('map and modal placement controls have unique labels and foreign branches expose no picker',()=>{
 const {g,branchId}=game(),dom=setup();stable.patch(dom.host,B.renderCommanders(g,g.branch(branchId),{writable:true,surface:'map'})+B.renderCommanders(g,g.branch(branchId),{writable:true,surface:'modal'}),{key:'both'});
 const ids=dom.host.querySelectorAll('[id]').map(node=>node.id);assert.equal(new Set(ids).size,ids.length);for(const label of dom.host.querySelectorAll('label[for]'))assert(dom.$('#'+label.getAttribute('for')));
 g.state.castles.nijo.owner='他家';assert.equal(B.renderCommanders(g,g.branch(branchId),{writable:true}),'');assert.equal(B.selectCommander(g,branchId,''),false);
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' branch officer UI checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
