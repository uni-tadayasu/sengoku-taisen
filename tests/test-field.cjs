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
console.log(count+' shared-field presentation and action-guard checks passed.');
