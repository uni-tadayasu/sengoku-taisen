import assert from 'node:assert/strict';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {castleDurability,reconcileCastleDurability} from './durability.js';

const copy=structuredClone,record=(current,max,updatedElapsedMs)=>({version:1,current,max,updatedElapsedMs});
function checkpoint({current=1000,max=10000,at=0,level=1,wall=1,owner='織田家',jobs=[]}={}){
 return{state:{clan:'織田家',home:'kiyosu',walking:{campaignId:'durability-transitions'},worldClock:{id:'world-v1',elapsedMs:at},turn:Math.floor(at/60000),realtime:{elapsed:at%60000/1000},jobs,castles:{kiyosu:{owner,level,wall,...(current===null?{}:{durability:record(current,max,0)})}}}};
}
function at(save,time){save.state.worldClock.elapsedMs=time;save.state.turn=Math.floor(time/60000);save.state.realtime.elapsed=time%60000/1000;return save;}
let groups=0;function test(name,run){run();groups++;console.log('PASS '+name);}

test('sync checkpoints preserve the repair anchor and exact month total',()=>{
 let before=checkpoint({current:2000});const original=copy(before.state.castles.kiyosu.durability);
 for(let step=1;step<=12;step++){
  const incoming=at(copy(before),step*5000);reconcileCastleDurability(incoming,before,{elapsedMs:step*5000});
  assert.deepEqual(incoming.state.castles.kiyosu.durability,original);before=incoming;
 }
 assert.equal(castleDurability(before.state,'kiyosu').current,3000);
 const stable=copy(before);reconcileCastleDurability(before,stable,{elapsedMs:60000});assert.deepEqual(before,stable);
});

test('a trusted castle job switches recovery capacity only at its completion',()=>{
 const before=checkpoint({jobs:[{kind:'castle',id:'kiyosu',targetLevel:2,remainingSeconds:60}]}),incoming=at(copy(before),120000);
 incoming.state.castles.kiyosu.level=2;incoming.state.castles.kiyosu.durability=record(4000,12000,60000);incoming.state.jobs=[];
 reconcileCastleDurability(incoming,before,{elapsedMs:120000});assert.equal(castleDurability(incoming.state,'kiyosu').current,5200);assert.deepEqual(incoming.state.castles.kiyosu.durability,record(4000,12000,60000));
 const first=copy(incoming);reconcileCastleDurability(incoming,before,{elapsedMs:120000});assert.deepEqual(incoming,first);
});

test('queued castle work and concurrent walls retain their separate deadlines',()=>{
 const before=checkpoint({jobs:[{kind:'castle',id:'kiyosu',targetLevel:2,remainingSeconds:60},{kind:'castle',id:'kiyosu',targetLevel:3,remainingSeconds:60},{kind:'building',id:'wall',targetLevel:2,remainingSeconds:30}]}),incoming=at(copy(before),180000);
 incoming.state.castles.kiyosu.level=3;incoming.state.castles.kiyosu.wall=2;incoming.state.jobs=[];
 // 0..30s: 500 repair; wall +500. 30..60s: 525 repair;
 // castle +2000. 60..120s:1250 repair; castle +2000.
 incoming.state.castles.kiyosu.durability=record(7775,14500,120000);
 reconcileCastleDurability(incoming,before,{elapsedMs:180000});assert.equal(castleDurability(incoming.state,'kiyosu').current,9225);assert.equal(incoming.state.castles.kiyosu.durability.updatedElapsedMs,120000);
});

test('an unproved owner change or forged capture receipt cannot refill damage',()=>{
 const before=checkpoint({current:0,owner:'在地衆'}),incoming=copy(before);incoming.state.castles.kiyosu.owner=incoming.state.clan;incoming.state.castles.kiyosu.durability.current=2500;
 incoming.state.marchHistory=[{status:'resolved',targetCastleId:'kiyosu',battle:{won:true,durability:{captured:true}}}];
 reconcileCastleDurability(incoming,before,{elapsedMs:0});assert.equal(castleDurability(incoming.state,'kiyosu').current,0);
});

test('a trusted local journey can breach a weak castle and restore its quarter',()=>{
 const game=new GameEngine({officers:GAME_OFFICERS,seed:1}),id=game.adjacentTargets()[0].id;
 game.state.resources.rice=100000;game.state.castles[id].troops=1;game.state.castles[id].wall=3;
 game.state.castles[id].durability=record(0,GameEngine.durabilityMax({castleId:id,level:1,wall:3}),0);
 game.applyWorldClock({id:'world-v1',elapsedMs:0,running:true,speed:1});
 const launched=game.departAttack(id,'balanced',3000);assert(launched.ok,launched.message);const before=JSON.parse(game.exportSave()),arrives=game.state.march.arrivesElapsedMs;
 game.applyWorldClock({id:'world-v1',elapsedMs:arrives,running:true,speed:1});assert(game.state.marchHistory[0].battle.won);
 const incoming=JSON.parse(game.exportSave()),expected=copy(incoming.state.castles[id].durability);
 assert.equal(expected.current,Math.round(expected.max*.25));reconcileCastleDurability(incoming,before,{elapsedMs:arrives});assert.deepEqual(incoming.state.castles[id].durability,expected);
 const stable=copy(incoming);reconcileCastleDurability(incoming,before,{elapsedMs:arrives});assert.deepEqual(incoming,stable);
});

test('trusted CPU capture replaces older damage, while later siege damage survives',()=>{
 const before=checkpoint({current:0,owner:'在地衆'}),proven=at(copy(before),60000);proven.state.castles.kiyosu.owner=proven.state.clan;proven.state.castles.kiyosu.durability=record(2500,10000,60000);
 const incoming=at(copy(before),120000);incoming.state.castles.kiyosu.owner=incoming.state.clan;
 reconcileCastleDurability(incoming,before,{elapsedMs:120000},{trustedStates:[proven.state]});assert.equal(castleDurability(incoming.state,'kiyosu').current,3500);
 const damaged=at(copy(incoming),120000);damaged.state.castles.kiyosu.durability=record(1000,10000,90000);
 reconcileCastleDurability(damaged,before,{elapsedMs:120000},{trustedStates:[proven.state]});assert.equal(castleDurability(damaged.state,'kiyosu').current,1500);
});

test('new authoritative damage survives when both legacy records were missing',()=>{
 const before=checkpoint({current:null}),incoming=at(copy(before),60000),proven=at(copy(before),60000);proven.state.castles.kiyosu.durability=record(7000,10000,60000);
 reconcileCastleDurability(incoming,before,{elapsedMs:60000},{trustedStates:[proven.state]});assert.deepEqual(incoming.state.castles.kiyosu.durability,proven.state.castles.kiyosu.durability);
});

test('an older replay cannot rewind a newer authoritative siege anchor',()=>{
 const before=checkpoint({current:2000,at:30000});before.state.castles.kiyosu.durability.updatedElapsedMs=90000;
 const incoming=at(copy(before),60000),older=at(copy(before),60000);older.state.castles.kiyosu.durability=record(8000,10000,60000);delete incoming.state.castles.kiyosu.durability;
 reconcileCastleDurability(incoming,before,{elapsedMs:90000},{trustedStates:[older.state]});assert.deepEqual(incoming.state.castles.kiyosu.durability,before.state.castles.kiyosu.durability);
});

console.log(groups+' durability transition groups passed; no service or network writes.');
