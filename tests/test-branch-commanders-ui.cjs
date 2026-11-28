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
test('army and another branch assignments remain reserved, with actual location and capacity reasons',()=>{
 const {g,ids,branchId}=game();let dom=render(g,branchId),select=dom.$('[data-branch-commander-choice]');
 for(const[id,reason]of [[ids[0],/出陣軍団/],[ids[2],/支拠点/]]){
  assert(select.querySelector(`option[value="${id}"]`).disabled);assert(B.selectCommander(g,branchId,id));dom=render(g,branchId);assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert.match(dom.$('[data-branch-commander-reason]').textContent,reason);
 }
 assert(B.selectCommander(g,branchId,ids[3]));dom=render(g,branchId);assert.equal(dom.$('[data-action="assign-branch-commander"]').disabled,false);assert.equal(dom.$('[data-action="assign-branch-commander"]').getAttribute('data-officer'),ids[3]);assert.match(dom.host.textContent,/配置と解除に指令・資材は使いません/);
 assert(g.assignBranchCommander(branchId,ids[3]).ok);assert(g.assignBranchCommander(branchId,ids[4]).ok);assert(B.selectCommander(g,branchId,ids[5]));dom=render(g,branchId);assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert.match(dom.$('[data-branch-commander-reason]').textContent,/2名まで/);
});
test('governor transfer names the former facility before committing, preserving other posts and all resources',()=>{
 const {g,ids,branchId}=game(),before=structuredClone(g.state),building=g.branchCommanderStatus(branchId).candidates.find(row=>row.id===ids[1]).fromBuildingName;
 let dom=render(g,branchId),select=dom.$('[data-branch-commander-choice]'),option=select.querySelector(`option[value="${ids[1]}"]`);
 assert.equal(option.disabled,false);assert(option.textContent.includes(building+'の奉行から異動'));
 assert(B.selectCommander(g,branchId,ids[1]));dom=render(g,branchId);select=dom.$('[data-branch-commander-choice]');
 const preview=dom.$('[data-branch-commander-transfer]'),button=dom.$('[data-action="assign-branch-commander"]');
 assert(preview);assert(preview.textContent.includes(building+'の奉行を解除'));assert.match(preview.textContent,/元の施設は奉行が未配置/);assert.equal(button.disabled,false);
 for(const control of [select,button])assert(control.getAttribute('aria-describedby').split(' ').includes(preview.id));
 assert.deepEqual(g.state,before,'Selecting and previewing an officer must never transfer or spend anything');
 const readonly=render(g,branchId,{writable:false,writableReason:'保存権限を確認してください。'});assert(readonly.$('[data-action="assign-branch-commander"]').disabled);assert.equal(readonly.$('[data-branch-commander-reason]').textContent,'保存権限を確認してください。');assert.deepEqual(g.state,before);
 assert.equal(B.selectCommander(g,branchId,'unowned-officer'),false);assert.equal(B.commanderSelection(g,branchId),ids[1]);
 assert(g.assignBranchCommander(branchId,ids[1]).ok);assert.equal(g.state.governors.farm,undefined);assert(g.branch(branchId).commanders.includes(ids[1]));
 assert.deepEqual(g.state.army,before.army);assert.deepEqual(g.branch('nagoya_east').commanders,before.branches.find(row=>row.id==='nagoya_east').commanders);assert.deepEqual(g.state.resources,before.resources);assert.equal(g.state.command,before.command);assert.equal(g.state.troops,before.troops);
 dom=render(g,branchId);assert.equal(dom.$('[data-branch-commander-transfer]'),null);assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert.match(dom.$('[data-branch-commander-reason]').textContent,/配置済み/);
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

test('automatic placement previews exact candidates, preserves reserved posts and keeps optimal full formations available',()=>{
 const {g,branchId}=game(),plan=g.branchCommanderAutoPlan(branchId);assert(plan.ok);
 const before=structuredClone(g.state);
 let dom=render(g,branchId),button=dom.$('[data-action="auto-assign-branch-commanders"]');assert(button&&!button.disabled);assert.equal(button.getAttribute('data-id'),branchId);
 for(const row of plan.assignments)assert(dom.$('[data-branch-auto-preview]').textContent.includes(row.name));
 assert.deepEqual(g.state,before);assert(g.autoAssignBranchCommanders(branchId).ok);assert.equal(g.branch(branchId).commanders.length,2);assert.deepEqual(g.state.army,before.army);assert.deepEqual(g.branch('nagoya_east').commanders,before.branches.find(row=>row.id==='nagoya_east').commanders);assert.deepEqual(g.state.resources,before.resources);assert.equal(g.state.command,before.command);
 dom=render(g,branchId);assert.equal(dom.$('[data-action="auto-assign-branch-commanders"]').disabled,false);assert.match(dom.$('[data-branch-auto-preview]').textContent,/配置を維持/);const optimal=structuredClone(g.state);assert.equal(g.autoAssignBranchCommanders(branchId).changed,false);assert.deepEqual(g.state,optimal);
 g.state.branches.find(row=>row.id===branchId).fallen=true;dom=render(g,branchId);assert(dom.$('[data-action="auto-assign-branch-commanders"]').disabled);assert.match(dom.$('[data-branch-auto-preview]').textContent,/陥落/);
 const other=game();dom=render(other.g,other.branchId,{writable:false,writableReason:'同期を確認中です。'});assert(dom.$('[data-action="auto-assign-branch-commanders"]').disabled);assert.match(dom.$('[data-branch-auto-preview]').textContent,/同期/);
 const bulk=setup();stable.patch(bulk.host,B.renderAutoCommanders(other.g,'all',{writable:true}));assert.equal(bulk.$('button').getAttribute('data-id'),'all');assert.match(bulk.host.textContent,/全支拠点/);
});
test('routine sync retains branch instructions and previews through apply and recovery without collapsing rows',()=>{
 const previous=global.SengokuSyncNotices;global.SengokuSyncNotices=require('../sync-notices.js');
 try{
  const {g,branchId}=game(),before=JSON.stringify(g.state),dom=setup();
  const paint=helpers=>stable.patch(dom.host,B.render(g,'nijo',helpers),{key:'branch-sync'});
  const selector='[data-branch-commander-reason],[data-branch-auto-preview],[data-branch-troop-reason],[data-branch-order-reason]';
  paint({writable:true});const rows=dom.host.querySelectorAll(selector).map(node=>({node,text:node.textContent,hidden:node.hasAttribute('hidden')}));
  assert(rows.length>10);assert(rows.some(row=>row.text.includes('配置する武将')));assert(rows.some(row=>row.text.includes('使い切りました')));
  const picker=dom.$('[data-branch-commander-choice]');picker.focus();dom.host.scrollTop=330;
  for(const writableReason of ['最新の進行を反映しています…','別の更新を確認したため、最新の保存を読み込んでいます。','進行権を確認しています…']){
   paint({writable:false,writableReason});const pending=dom.host.querySelectorAll(selector);
   rows.forEach((row,index)=>{assert.strictEqual(pending[index],row.node);assert.equal(pending[index].textContent,row.text);assert.equal(pending[index].hasAttribute('hidden'),row.hidden);});
   assert(dom.$('[data-action="assign-branch-commander"]').disabled);assert(dom.$('[data-action="auto-assign-branch-commanders"]').disabled);assert(dom.$('[data-branch-troop-submit]').disabled);
   assert(dom.host.querySelectorAll('.branch-facility-action').every(node=>node.disabled));assert.strictEqual(dom.doc.activeElement,picker);assert.equal(dom.host.scrollTop,330);
   assert.equal(B.commanderReason(g,branchId,{writable:false,writableReason}),writableReason,'the authoritative write reason remains blocked');
   paint({writable:true});rows.forEach(row=>{assert.equal(row.node.textContent,row.text);assert.equal(row.node.hasAttribute('hidden'),row.hidden);});
  }
  assert.equal(JSON.stringify(g.state),before);
 }finally{if(previous===undefined)delete global.SengokuSyncNotices;else global.SengokuSyncNotices=previous;}
});
test('sync keeps legal order previews visible while every real write stays blocked until recovery',()=>{
 const previous=global.SengokuSyncNotices;global.SengokuSyncNotices=require('../sync-notices.js');
 try{
  const {g,branchId,ids}=game();g.state.buildings.keep=10;g.state.command=g.commandMax();g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g.state.troops=4000;
  assert(B.selectCommander(g,branchId,ids[3]));assert(B.setTroopTransferSelection(g,'nijo',{from:'army',to:'castle:nijo',troops:'20'}));assert(B.troopTransferQuote(g,'nijo').ok);
  const dom=setup(),paint=helpers=>stable.patch(dom.host,B.render(g,'nijo',helpers),{key:'legal-branch-sync'}),selectors=['[data-action="assign-branch-commander"]','[data-action="auto-assign-branch-commanders"]','[data-branch-troop-submit]','[data-branch-facility="farm"] .branch-facility-action','[data-action="upgrade-branch"]'];
  paint({writable:true});for(const selector of selectors)assert.equal(dom.$(selector).disabled,false,selector);
  const preview=dom.$('[data-branch-auto-preview]'),text=preview.textContent;assert(text);
  const pending={writable:false,writableReason:'最新の進行を反映しています…'};paint(pending);
  for(const selector of selectors)assert.equal(dom.$(selector).disabled,true,selector);assert.equal(preview.textContent,text);
  for(const reason of [B.commanderReason(g,branchId,pending),B.autoCommanderReason(g,branchId,pending),B.troopTransferReason(g,'nijo',pending),B.facilityReason(g,branchId,'farm',pending)])assert.equal(reason,pending.writableReason);
  paint({writable:true});for(const selector of selectors)assert.equal(dom.$(selector).disabled,false,selector);
 }finally{if(previous===undefined)delete global.SengokuSyncNotices;else global.SengokuSyncNotices=previous;}
});
test('real write failures and changed gameplay requirements still update branch guidance during sync',()=>{
 const previous=global.SengokuSyncNotices;global.SengokuSyncNotices=require('../sync-notices.js');
 try{
  const {g,branchId}=game(),dom=setup(),paint=helpers=>stable.patch(dom.host,B.render(g,'nijo',helpers),{key:'branch-sync-errors'});
  for(const writableReason of ['通信が切れています。','別の端末で操作中です。','保存領域を利用できません。']){
   paint({writable:false,writableReason});
   for(const selector of ['[data-branch-commander-reason]','[data-branch-auto-preview]','[data-branch-troop-reason]','.branch-facility-reason']){
    const node=dom.$(selector);assert.equal(node.textContent,writableReason);assert.equal(node.hasAttribute('hidden'),false);
   }
  }
  const pending={writable:false,writableReason:'最新の進行を反映しています…'};paint(pending);
  const facility=dom.$('.branch-facility-reason');assert.match(facility.textContent,/使い切りました/);
  g.state.command=g.commandMax();g.state.resources.gold=0;paint(pending);assert.match(facility.textContent,/資源/);
  g.state.branches.find(row=>row.id===branchId).fallen=true;paint(pending);assert.match(dom.$('[data-branch-commander-reason]').textContent,/陥落/);assert(dom.$('[data-action="assign-branch-commander"]').disabled);
 }finally{if(previous===undefined)delete global.SengokuSyncNotices;else global.SengokuSyncNotices=previous;}
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' branch officer UI checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
