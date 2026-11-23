/* Real transfer quotes and stable drafts. All campaigns and DOMs are in memory. */
'use strict';
const assert=require('node:assert/strict');
const {SengokuEngine:E}=require('../engine.js'),B=require('../branches.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const tests=[],test=(name,run)=>tests.push([name,run]);
function game(){
 const g=new E({seed:29});g.state.buildings.keep=10;g.state.command=g.commandMax();g.state.troops=4000;
 g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};
 for(const id of ['nijo','nagoya','sunpu']){g.state.castles[id].owner=g.state.clan;g.state.castles[id].level=4;g.state.castles[id].troops=900;}
 g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:4,fallen:false,stationedTroops:320},{id:'nijo_south',parentCastleId:'nijo',direction:'south',level:3,fallen:false,stationedTroops:80},{id:'nagoya_east',parentCastleId:'nagoya',direction:'east',level:2,fallen:false,stationedTroops:0}];
 return g;
}
const helpers={writable:true};
function mount(g,parent='nijo',options=helpers){const dom=setup();stable.patch(dom.host,B.render(g,parent,options),{key:'troop-ui'});return dom;}
function select(g,patch,parent='nijo'){assert(B.setTroopTransferSelection(g,parent,patch));return B.troopTransferQuote(g,parent);}

test('owned ordinary castles expose the same transfer form; foreign castles do not',()=>{
 const g=game(),before=JSON.stringify(g.state),dom=mount(g,'sunpu');
 assert(dom.$('[data-branch-troop-form]'));assert.match(dom.host.textContent,/兵の配置・移動/);assert.equal(dom.$('[data-branch-troop-field="from"]').value,'army');assert.equal(dom.$('[data-branch-troop-field="to"]').value,'castle:sunpu');
 assert.match(dom.host.textContent,/移動に指令1回/);assert.match(dom.host.textContent,/その拠点に駐留/);assert.match(dom.host.textContent,/移動先に「本隊」を選んで戻せます/);assert.equal(JSON.stringify(g.state),before);
 g.state.castles.sunpu.owner='他家';assert.equal(B.renderTroopTransfer(g,'sunpu',helpers),'');assert.equal(B.setTroopTransferSelection(g,'sunpu',{troops:'10'}),false);
});
test('simultaneous map and modal forms have unique accessible labels but share the selected route',()=>{
 const g=game();select(g,{from:'castle:nagoya',to:'branch:nijo_south',troops:'50'});const dom=setup();
 stable.patch(dom.host,B.renderTroopTransfer(g,'nijo',{...helpers,surface:'map'})+B.renderTroopTransfer(g,'nijo',{...helpers,surface:'modal'}),{key:'both-surfaces'});
 const ids=dom.host.querySelectorAll('[id]').map(node=>node.id);assert.equal(new Set(ids).size,ids.length);
 for(const label of dom.host.querySelectorAll('label[for]'))assert(dom.$('#'+label.getAttribute('for')));
 for(const amount of dom.host.querySelectorAll('[data-branch-troop-field="troops"]'))assert.equal(amount.value,'50');
 assert(dom.$('[data-branch-troop-surface="map"]'));assert(dom.$('[data-branch-troop-surface="modal"]'));
});
test('army, castle and branch routes display the engine maximum, count changes and exact stationed stock',()=>{
 const g=game();
 for(const[from,to]of [['army','branch:nijo_north'],['branch:nijo_north','army'],['castle:nijo','castle:nagoya'],['branch:nijo_north','branch:nijo_south']]){
  const before=JSON.stringify(g.state),q=select(g,{from,to,troops:'20'}),expected=g.troopTransferQuote(from,to,20);assert.deepEqual(q,expected);assert(q.ok,q.reason);
  const dom=mount(g),preview=dom.$('.branch-troop-preview');assert.equal(dom.$('[data-branch-troop-submit]').disabled,false);assert.equal(dom.$('[data-branch-troop-field="troops"]').getAttribute('max'),String(q.maxTroops));
  for(const count of [q.sourceBefore,q.sourceAfter,q.destinationBefore,q.destinationAfter])assert(preview.textContent.includes(count.toLocaleString('ja-JP')));
  assert.equal(dom.$('[data-branch-stationed="nijo_north"]').textContent,'320人');assert.match(dom.host.textContent,/本城からの守備支援は、この人数には含みません/);assert.equal(JSON.stringify(g.state),before);
 }
});
test('a fallen branch remains a withdrawal source and cannot receive another troop order',()=>{
 const g=game();g.state.branches[0].fallen=true;
 const endpoint=g.troopTransferStatus().endpoints.find(row=>row.id==='branch:nijo_north');assert(endpoint.canSource);assert.equal(endpoint.canDestination,false);
 let q=select(g,{from:endpoint.id,to:'army',troops:'100'}),dom=mount(g);assert(q.ok,q.reason);assert.equal(dom.$('[data-branch-troop-field="from"]').querySelector('option[value="branch:nijo_north"]').disabled,false);assert.equal(dom.$('[data-branch-troop-field="to"]').querySelector('option[value="branch:nijo_north"]').disabled,true);
 q=select(g,{from:'army',to:endpoint.id,troops:'100'});dom=mount(g);assert.equal(q.ok,false);assert(dom.$('[data-branch-troop-submit]').disabled);assert.match(dom.$('.branch-troop-location-reason').textContent,/撤収/);
});
test('invalid counts and read-only access keep explicit reasons and never enable a transfer',()=>{
 const g=game();
 for(const troops of ['', '0', '-1', '1.5', '2e3', '9007199254740992']){
  const q=select(g,{from:'army',to:'castle:nijo',troops}),dom=mount(g);assert.equal(q.ok,false);assert(dom.$('[data-branch-troop-submit]').disabled);assert(dom.$('[data-branch-troop-reason]').textContent);
 }
 select(g,{from:'army',to:'castle:nijo',troops:'20'});const dom=mount(g,'nijo',{writable:false,writableReason:'別の端末で操作中です。'});assert(dom.$('[data-branch-troop-submit]').disabled);assert.equal(dom.$('[data-branch-troop-reason]').textContent,'別の端末で操作中です。');
 const before=B.troopTransferSelection(g,'nijo');assert.equal(B.setTroopTransferSelection(g,'nijo',{from:'castle:nagoya',to:'castle:unowned-imaginary'}),false);assert.deepEqual(B.troopTransferSelection(g,'nijo'),before);
});
test('availability changes invalidate the existing destination without silently choosing another base',()=>{
 const g=game();select(g,{from:'army',to:'castle:nagoya',troops:'250'});g.state.castles.nagoya.owner='他家';
 const dom=mount(g);assert.equal(B.troopTransferSelection(g,'nijo').to,'castle:nagoya');assert.equal(dom.$('[data-branch-troop-field="to"]').value,'castle:nagoya');assert.match(dom.$('[data-branch-troop-field="to"]').textContent,/選択していた拠点を確認/);assert(dom.$('[data-branch-troop-submit]').disabled);
});
test('focused count, open inventory and chosen route survive resource ticks and canonical save replacement',()=>{
 const g=game();select(g,{from:'branch:nijo_north',to:'castle:nagoya',troops:'120'});const dom=mount(g),amount=dom.$('[data-branch-troop-field="troops"]'),source=dom.$('[data-branch-troop-field="from"]'),details=dom.$('.branch-troop-roster');
 details.open=true;amount.focus();amount.value='120';dom.host.scrollTop=420;g.state.command=0;
 stable.patch(dom.host,B.render(g,'nijo',helpers),{key:'troop-ui'});assert.strictEqual(dom.$('[data-branch-troop-field="troops"]'),amount);assert.strictEqual(dom.$('[data-branch-troop-field="from"]'),source);assert.strictEqual(dom.doc.activeElement,amount);assert.equal(amount.value,'120');assert.equal(details.open,true);assert.equal(dom.host.scrollTop,420);assert(dom.$('[data-branch-troop-submit]').disabled);
 const candidate=E.fromSave(g.exportSave());assert(B.transferSelection(g,candidate));assert.deepEqual(B.troopTransferSelection(candidate,'nijo'),{from:'branch:nijo_north',to:'castle:nagoya',troops:'120'});
 stable.patch(dom.host,B.render(candidate,'nijo',helpers),{key:'troop-ui'});assert.strictEqual(dom.$('[data-branch-troop-field="troops"]'),amount);assert.equal(amount.value,'120');assert.equal(details.open,true);assert.equal(dom.host.scrollTop,420);
 const unrelated=game();assert.equal(B.transferSelection(candidate,unrelated),false);assert.deepEqual(B.troopTransferSelection(unrelated,'nijo'),{from:'army',to:'castle:nijo',troops:'1'});
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' troop transfer UI checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
