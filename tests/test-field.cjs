'use strict';
const assert=require('node:assert/strict');
const F=require('../field.js');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
const player=(id,home='kiyosu',more={})=>({playerId:id,name:'領主'+id,clan:'織田家',homeCastleId:home,homeCastleName:'清洲城',level:3,defenseTroops:1200,defensePower:4200,attackable:true,relationship:'neutral',...more});
const ready=()=>({identity:{id:'me'},access:{writable:true},state:{troops:5000,command:3,resources:{rice:9000}},player:player('other'),me:{attack:{ready:true,availableTroops:5000,minTroops:300,maxTroops:100000,command:3,rice:9000},relationships:[]},troops:1000,tactic:'balanced'});
test('public bases contain only real valid accounts and never fabricate empty records',()=>{
  assert.deepEqual(F.normalizePlayers({players:[]}),[]);const result=F.normalizePlayers({players:[player('a'),player('a'),{name:'no id'},player('b','edo',{isAdmin:true,attackable:false})]});assert.equal(result.length,2);assert.equal(result[1].playerId,'b');assert.equal(result[1].attackable,false);
});
test('co-located players share one exact marker while remaining individually selectable',()=>{
  const people=F.normalizePlayers([player('a'),player('b'),player('op','edo',{isAdmin:true,attackable:false})]),coords={kiyosu:{lon:136.8432,lat:35.2162},edo:{lon:139.7528,lat:35.6852}};
  const groups=F.groupBases(people,coords,[],{id:'a'});assert.equal(groups.length,2);assert.deepEqual(groups[0].players.map(p=>p.playerId),['a','b']);assert.deepEqual(groups[0].geo,coords.kiyosu);assert.equal(groups[0].owner,'あなたの本拠');assert.equal(groups[1].reachable,false);assert.equal(F.groupBases(people,{},[]).length,0);
});
test('raid food costs follow the authoritative four tactic formulas',()=>{
  assert.equal(F.foodCost(1000,'balanced'),450);assert.equal(F.foodCost(1000,'assault'),525);assert.equal(F.foodCost(1000,'siege'),645);assert.equal(F.foodCost(1000,'ambush'),480);assert.equal(F.foodCost(1000,'unknown'),null);
});
test('valid attack produces only semantic fields for the guarded application facade',()=>{
  const result=F.attackValidation(ready());assert.equal(result.ok,true);assert.deepEqual(result.payload,{targetPlayerId:'other',troops:1000,tactic:'balanced'});assert.equal(result.foodCost,450);assert.equal('token'in result.payload,false);assert.equal('deviceId'in result.payload,false);
});
test('guest, follower, pending transaction, own base, admin and allies cannot raid',()=>{
  for(const mutate of [v=>v.identity=null,v=>v.access.writable=false,v=>v.access.fieldPending=true,v=>v.player.playerId='me',v=>v.player.isAdmin=true,v=>v.player.homeCastleId='edo',v=>v.me.relationships=[{targetPlayerId:'other',status:'allied'}],v=>v.player.attackable=false,v=>v.me.attack.ready=false,v=>v.clock={ready:false},v=>v.clock={ready:true,clock:{running:false}}]){const context=ready();mutate(context);assert.equal(F.attackValidation(context).ok,false);}
});
test('troop bounds, commands, rice and tactics are validated before confirmation',()=>{
  for(const mutate of [v=>v.troops=299,v=>v.troops=5001,v=>v.troops=1000.5,v=>v.troops=NaN,v=>v.state.command=0,v=>v.state.resources.rice=449,v=>v.tactic='unknown']){const context=ready();mutate(context);assert.equal(F.attackValidation(context).ok,false);}
});
test('incoming, outgoing and accepted relationships stay distinguishable',()=>{
  for(const status of ['incoming','outgoing','allied'])assert.equal(F.relationshipFor(player('a'),{relationships:[{targetPlayerId:'a',status}]},{id:'me'}),status);
  assert.equal(F.relationshipFor(player('me'),{}, {id:'me'}),'self');assert.equal(F.remainingLabel(360000),'6か月');assert.equal(F.remainingLabel(59999),'60秒');
});
test('public names and identifiers are escaped before entering clickable UI',()=>{
  const html=F.publicRow(player('a" onclick="steal()','kiyosu',{name:'<script>alert(1)</script>',clan:'<img src=x>'}));assert(!html.includes('<script>'));assert(!html.includes('<img src=x>'));assert(html.includes('&lt;script&gt;'));assert(html.includes('a&quot; onclick=&quot;steal()'));
});
test('staff Sunpu protection remains distinct from operator assets',()=>{
  const staff=F.normalizePlayers([player('staff','sunpu',{isStaff:true})])[0];assert.equal(staff.isStaff,true);assert.equal(staff.isAdmin,false);assert(F.publicRow(staff).includes('スタッフ'));
  const context=ready();context.player=staff;assert.equal(F.attackValidation(context).ok,false);assert.match(F.attackValidation(context).message,/駿府城/);
  context.player=player('staff','kiyosu',{isStaff:true});assert.equal(F.attackValidation(context).ok,false,'A stale location must not expose an appointed staff base to attack');
  context.player=player('legacy','sunpu');assert.equal(F.attackValidation(context).ok,false,'The reserved castle stays protected while a legacy player snapshot is migrating');
  const operator=F.normalizePlayers([player('operator','edo',{isStaff:true,isAdmin:true})])[0];assert.equal(operator.isStaff,false);assert(F.publicRow(operator).includes('運営'));
});
test('all five major cities retain level64 while ordinary castle levels remain bounded',()=>{
  const cities=['edo','sunpu','nijo','osaka','nagoya'];
  for(const id of cities){const [p]=F.normalizePlayers([player(id,id,{level:64})]);assert.equal(p.level,64);assert.match(F.publicRow(p),/Lv\.64/);}
  assert.equal(F.normalizePlayers([player('a','kiyosu',{level:64})])[0].level,32);
  assert.equal(F.normalizePlayers([player('a','sunpu',{level:999})])[0].level,64);
  const shared=F.groupBases(F.normalizePlayers([player('a','sunpu',{level:64,isStaff:true,attackable:false}),player('b','sunpu',{level:64,isStaff:true,attackable:false})]),{sunpu:{lon:138.3828,lat:34.9798}});
  assert.equal(shared.length,1);assert.equal(shared[0].level,64);assert.equal(shared[0].players.length,2);assert.equal(shared[0].reachable,false);
});
test('keep levels are distinct from castle levels and old or malformed data uses the first artwork safely',()=>{
  for(const [keepLevel,expected]of [[1,1],[8,8],[16,16],[32,32],[64,32],['24',24]]){
    const p=F.normalizePlayers([player('a','edo',{level:64,keepLevel})])[0];assert.equal(p.level,64);assert.equal(p.keepLevel,expected);assert.equal(p.keepLevelKnown,true);
    assert(F.publicRow(p).includes(`天守 Lv.${expected} · 城郭 Lv.64`));
  }
  for(const keepLevel of [undefined,null,0,-4,NaN,Infinity,'bad',{},true,2.5]){
    const p=F.normalizePlayers([player('a','edo',{level:64,keepLevel})])[0];assert.equal(p.keepLevel,1);assert.equal(p.keepLevelKnown,false);
    assert(F.publicRow(p).includes('天守 未取得'));assert.equal(F.normalizePlayers([p])[0].keepLevelKnown,false);
  }
});
test('co-located marker artwork follows selection, then the owner, then the strongest keep with stable ties',()=>{
  const people=F.normalizePlayers([player('b','kiyosu',{keepLevel:24,level:2}),player('a','kiyosu',{keepLevel:4,level:32}),player('c','kiyosu',{keepLevel:24,level:8})]);
  const coords={kiyosu:{lon:136.8432,lat:35.2162}},group=(who,selected='',list=people)=>F.groupBases(list,coords,[],who,selected)[0];
  assert.equal(group({id:'a'}).keepLevel,4);assert.equal(group({id:'a'}).displayPlayerId,'a');
  assert.equal(group({id:'a'},'b').keepLevel,24);assert.equal(group({id:'a'},'b').displayPlayerId,'b');
  assert.equal(group(null).displayPlayerId,'b');assert.equal(group(null,'',[...people].reverse()).displayPlayerId,'b');
  assert.equal(group(null).level,32,'The aggregate castle level remains separate from the keep artwork');
});
test('all 32 keep levels select different cells from the existing per-castle atlas',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{SENGOKU_DATA}=require('../engine.js');
  const scope={SENGOKU_DATA,document:{readyState:'loading',addEventListener(){}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8'),scope);
  const old=global.SengokuArt;global.SengokuArt=scope.SengokuArt;
  try{
    for(const homeCastleId of ['kiyosu','edo','sunpu']){
      const cells=new Set();
      for(let keepLevel=1;keepLevel<=32;keepLevel++){
        const p=F.normalizePlayers([player('a',homeCastleId,{level:64,keepLevel})])[0],html=F.castleAppearance(p),tile=scope.SengokuArt.tileInfo('castle',homeCastleId,keepLevel);
        assert(html.includes(`data-art-url="assets/castles/${homeCastleId}.webp"`));assert(html.includes(`data-field-keep-level="${keepLevel}"`));
        assert(html.includes(`data-art-x="${tile.x}"`));assert(html.includes(`data-art-y="${tile.y}"`));cells.add(tile.x+':'+tile.y);
      }
      assert.equal(cells.size,32,'Each keep level has its own existing artwork cell');
    }
    const missing=F.castleAppearance(player('a','edo',{level:64}));assert(missing.includes('data-field-keep-level="1"'));assert(missing.includes('天守 未取得'));
    const unsafe=F.castleAppearance(player('a','missing" onclick="alert(1)',{name:'<script>',keepLevel:3}));assert(!unsafe.includes('onclick="alert'));assert(unsafe.includes('field-castle-fallback'));
  }finally{if(old===undefined)delete global.SengokuArt;else global.SengokuArt=old;}
});

async function liveRefreshTest(){
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{SENGOKU_DATA}=require('../engine.js'),nodes=new Map(),listeners=new Map(),maps=[];
  const node=()=>{let markup='';return{htmlWrites:0,get innerHTML(){return markup;},set innerHTML(value){markup=value;this.htmlWrites++;},textContent:'',value:'',hidden:false,disabled:false,querySelector:()=>null,setAttribute(){}};};
  const doc={hidden:false,activeElement:null,readyState:'loading',addEventListener(){},removeEventListener(){}};
  const host={ownerDocument:doc,innerHTML:'',contains:()=>true,querySelector(selector){if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},querySelectorAll:()=>[],addEventListener(type,handler){listeners.set(type,handler);},removeEventListener(){}};
  let people=[player('me','kiyosu',{keepLevel:4,level:32}),player('other','kiyosu',{keepLevel:24,level:2})];
  const scope={SENGOKU_DATA,document:doc,setTimeout:()=>1,clearTimeout(){},SENGOKU_GEOGRAPHY:{castles:{kiyosu:{lon:136.8432,lat:35.2162}}},SengokuWorldMap:{mount(container,options){maps.push(options);return{update(next){maps.push(next);},destroy(){}};}}};scope.window=scope;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8'),scope);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../field.js'),'utf8'),scope);
  const controller=scope.SengokuField.mount(host,{stateKey:'keep-refresh-test',identity:{id:'me'},getSyncStatus:()=>({writable:true}),request:async route=>route.startsWith('/field/me')?{relationships:[],attack:{ready:false}}:{players:people,total:people.length}});
  try{
    await controller.refresh();assert.equal(maps.at(-1).castles[0].keepLevel,4);assert(nodes.get('[data-field-detail]').innerHTML.includes('data-field-keep-level="4"'));
    const button={dataset:{fieldAction:'select-player',playerId:'other'}};await listeners.get('click')({target:{closest:()=>button},stopPropagation(){}});
    assert.equal(maps.at(-1).castles[0].keepLevel,24);assert(nodes.get('[data-field-detail]').innerHTML.includes('data-field-keep-level="24"'));
    const detail=nodes.get('[data-field-detail]');detail.innerHTML=detail.innerHTML.replace('aria-busy="true"','aria-busy="false" data-art-ready="1"');
    let focusCalls=0,selection=null;const input={dataset:{fieldInput:'troops'},selectionStart:1,selectionEnd:3,focus(){focusCalls++;},setSelectionRange(...range){selection=range;}};
    doc.activeElement=input;detail.querySelector=selector=>selector==='[data-field-input="troops"]'?input:null;
    const unchangedWrites=detail.htmlWrites;await controller.refresh();
    assert.equal(detail.htmlWrites,unchangedWrites,'An unchanged shared refresh must preserve the loaded artwork DOM');
    assert(detail.innerHTML.includes('data-art-ready="1"'));assert.equal(focusCalls,0,'The existing focused input is retained without refocusing');
    people=[people[0],{...people[1],keepLevel:32}];await controller.refresh();
    const current=maps.at(-1),marker=current.castles[0];assert.equal(marker.displayPlayerId,'other');assert.equal(marker.keepLevel,32);
    assert(current.markerAppearance(marker).html.includes('data-field-keep-level="32"'));assert(current.markerTooltip(marker).description.includes('天守 Lv.32'));
    assert(nodes.get('[data-field-detail]').innerHTML.includes('data-field-keep-level="32"'));assert(nodes.get('[data-field-players]').innerHTML.includes('天守 Lv.32 · 城郭 Lv.2'));
    assert.equal(detail.htmlWrites,unchangedWrites+1,'A changed keep level must replace the detail once');assert.equal(focusCalls,1);assert.deepEqual(selection,[1,3]);
    people=[people[0],{...people[1],keepLevel:undefined}];await controller.refresh();assert.equal(maps.at(-1).castles[0].keepLevel,1);
    assert(nodes.get('[data-field-detail]').innerHTML.includes('天守 未取得'));
  }finally{controller.destroy();}
  count++;console.log('PASS a shared-information refresh updates selected self/other castle artwork without losing selection');
}
liveRefreshTest().then(()=>console.log(count+' shared-field presentation and action-guard checks passed.')).catch(error=>{console.error(error);process.exitCode=1;});
