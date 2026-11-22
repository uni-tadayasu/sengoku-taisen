'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const roster={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),roster);
const officers=JSON.parse(JSON.stringify(roster.window.SENGOKU_OFFICERS));
const fresh=(options={})=>new E({officers,seed:1,...options});
const load=g=>E.fromSave(g.exportSave(),officers);
const clock=elapsedMs=>({id:'residency-world',elapsedMs,running:true,speed:1});
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}

function vulnerable(g=fresh(),{home='kiyosu',outposts=[]}={}){
  const s=g.state;s.home=home;s.cycle.home=home;s.turn=9;s.realtime.elapsed=0;s.troops=0;
  for(const castle of Object.values(s.castles))Object.assign(castle,{owner:'在地衆',troops:100000,wall:1,level:1});
  for(const id of [home,...outposts])Object.assign(s.castles[id],{owner:s.clan,troops:100});
  g.random=()=>0;
  return g;
}

test('actual CPU home defeat emits one stable loss and does not alter defeat behavior',()=>{
  const g=vulnerable(),s=g.state,campaignId=s.walking.campaignId;
  const events=g._cpuTurn();
  assert(s.gameOver);
  assert.notEqual(s.castles.kiyosu.owner,s.clan);
  assert(events.some(text=>text.includes('清洲城を失いました')));
  const losses=g.takeHomeDefenseLosses();
  assert.equal(losses.length,1);
  const loss=losses[0];
  assert.equal(loss.kind,'cpu');assert.equal(loss.castleId,'kiyosu');
  assert.equal(loss.campaignId,campaignId);assert.equal(loss.cycle,0);
  assert.equal(loss.turn,9);assert.equal(loss.occurredElapsedMs,540000);
  assert(D.castles.find(c=>c.id===loss.sourceCastleId).neighbors.includes('kiyosu'));
  assert.equal(loss.id,`cpu-home:${campaignId}:0:9:${loss.sourceCastleId}:kiyosu`);
  assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});

test('shared-clock catchup records the battle month, not the later polling time',()=>{
  const g=vulnerable();g.state.turn=8;g.state.realtime.elapsed=59;g.state.worldClock={id:'residency-world',elapsedMs:539000};
  const result=g.applyWorldClock(clock(570000),{maxSeconds:86400});
  assert(result.ok);assert(g.state.gameOver);
  assert.equal(g.state.worldClock.elapsedMs,570000);
  assert.equal(g.takeHomeDefenseLosses()[0].occurredElapsedMs,540000);
});

test('captured outpost and successful home defense cannot cause succession',()=>{
  const outpost=vulnerable(fresh(),{outposts:['ishikawa']});
  outpost._cpuTurn();
  assert.notEqual(outpost.state.castles.ishikawa.owner,outpost.state.clan);
  assert.equal(outpost.state.home,'kiyosu');assert.equal(outpost.state.gameOver,false);
  assert.deepEqual(outpost.takeHomeDefenseLosses(),[]);
  const defended=vulnerable();defended.state.castles.kiyosu.troops=100000000;
  const events=defended._cpuTurn();
  assert(events.some(text=>text.includes('撃退')));
  assert.equal(defended.state.castles.kiyosu.owner,defended.state.clan);
  assert.deepEqual(defended.takeHomeDefenseLosses(),[]);
});

test('a home can lose with another holding surviving and records the former home',()=>{
  const g=vulnerable(fresh(),{home:'ishikawa',outposts:['kiyosu']});
  g._cpuTurn();
  assert.equal(g.state.gameOver,false);assert.equal(g.state.home,'kiyosu');
  const losses=g.takeHomeDefenseLosses();assert.equal(losses.length,1);
  assert.equal(losses[0].castleId,'ishikawa');
});

test('a fallen branch retains the parent home and produces no home-defense receipt',()=>{
  const g=vulnerable(fresh(),{home:'osaka'});
  g.state.branches=[{id:'osaka_north',parentCastleId:'osaka',direction:'north',level:1,fallen:false}];
  const events=g._cpuTurn();
  assert(g.state.branches[0].fallen);assert(events.some(text=>text.includes('支拠点')));
  assert.equal(g.state.castles.osaka.owner,g.state.clan);
  assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});

test('outgoing attack loss does not count as a defended-home loss',()=>{
  const g=fresh();g.state.castles.inuyama.troops=100000000;g.state.castles.inuyama.wall=32;g.random=()=>.999999;
  const result=g.attack('inuyama','balanced',300);
  assert(result.ok,result.message);assert.equal(result.battle.won,false);
  assert.equal(g.state.castles.kiyosu.owner,g.state.clan);
  assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});

test('cycle territory resets and role projection do not manufacture defense losses',()=>{
  const g=vulnerable();g.state.turn=671;g.state.realtime.elapsed=59;
  const result=g.tick(1);assert(result.ok);assert.equal(g.state.cycle.index,1);
  assert.equal(g.state.castles.kiyosu.owner,g.state.clan);
  assert.deepEqual(g.takeHomeDefenseLosses(),[]);
  const admin=fresh({isAdmin:true});admin.restoreAdminAssets();
  assert.deepEqual(admin.takeHomeDefenseLosses(),[]);
  assert.deepEqual(E.fromSave(admin.exportSave(),officers,{isAdmin:true}).takeHomeDefenseLosses(),[]);
});

test('export preserves pending trusted receipts but importing cannot restore or forge them',()=>{
  const g=vulnerable();g._cpuTurn();
  const saved=JSON.parse(g.exportSave());
  assert.equal(JSON.stringify(saved).includes('cpu-home:'),false);
  const forged={id:'cpu-home:forged',kind:'cpu',campaignId:saved.state.walking.campaignId,castleId:'kiyosu',sourceCastleId:'inuyama',cycle:0,turn:9,occurredElapsedMs:540000};
  saved.homeDefenseLosses=[forged];saved.state.homeDefenseLosses=[forged];saved.state.residency={role:'lord',homeDefenseLosses:[forged]};
  const imported=E.fromSave(saved,officers);
  assert.deepEqual(imported.takeHomeDefenseLosses(),[]);
  assert.equal(Object.hasOwn(imported.state,'homeDefenseLosses'),false);
  assert.equal(Object.hasOwn(imported.state,'residency'),false);
  assert.equal(g.takeHomeDefenseLosses().length,1);
  assert.deepEqual(load(g).takeHomeDefenseLosses(),[]);
});

test('trusted replays of the same pre-battle save produce the same receipt identity',()=>{
  const g=vulnerable(),replayed=load(g);replayed.random=()=>0;
  g._cpuTurn();replayed._cpuTurn();
  assert.deepEqual(g.takeHomeDefenseLosses(),replayed.takeHomeDefenseLosses());
});

test('bounded receipts preserve earliest losses until drained and cannot cross campaigns',()=>{
  const g=vulnerable();
  for(let i=0;i<260;i++){
    vulnerable(g);g.state.turn=9+i*3;g.state.cycle.index=Math.floor(g.state.turn/672);g.state.gameOver=false;
    g._cpuTurn();
  }
  const losses=g.takeHomeDefenseLosses();
  assert.equal(losses.length,256);assert.equal(losses[0].turn,9);assert.equal(losses.at(-1).turn,774);
  assert.equal(new Set(losses.map(loss=>loss.id)).size,256);
  assert.deepEqual(g.takeHomeDefenseLosses(),[]);
  vulnerable(g);g.state.gameOver=false;g._cpuTurn();
  g.state.walking.campaignId='another-campaign';
  assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});

console.log(`Residency engine: ${count} tests passed.`);
