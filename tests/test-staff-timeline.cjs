const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),context);
const officers=JSON.parse(JSON.stringify(context.window.SENGOKU_OFFICERS));
const create=options=>new E({officers,seed:17,...options});
const clock=elapsedMs=>({id:'staff-timeline-test',elapsedMs,running:true,speed:1});
const cycleMs=D.worldCalendar.monthsPerCycle*60000;
const raw=game=>JSON.parse(game.exportSave());
function baseFor(game,accessSinceElapsedMs=0,options={}){
  const state=game.state,buildings={...state.buildings,...options.buildings};
  return {id:'sunpu',revision:1,accessSinceElapsedMs,castleLevel:options.castleLevel||1,buildings,initial:{buildings,castleLevel:options.castleLevel||1},history:[],jobs:[],personalHome:state.home,personalCycleHome:state.cycle.home,personalSunpu:structuredClone(state.castles.sunpu),personalHomeCastle:structuredClone(state.castles[state.home]),...options};
}
function staffFrom(game,base){return E.fromSave(game.exportSave(),officers,{isStaff:true,staffBase:base});}
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
function sameResources(a,b){assert.deepEqual(a.state.resources,b.state.resources);for(const key of D.resources)assert(Math.abs(a.state.realtime.incomeRemainders[key]-b.state.realtime.incomeRemainders[key])<1e-8,key);}

test('shared completion exactly at a month boundary affects that monthly bonus',()=>{
  const personal=create();personal.applyWorldClock(clock(180000));
  const base=baseFor(personal,0);base.buildings={...base.buildings,market:3};base.history=[{kind:'building',id:'market',level:3,effectiveElapsedMs:240000}];
  const game=staffFrom(personal,base);game.random=()=>0;
  const result=game.applyWorldClock(clock(240000));
  assert.equal(game.state.buildings.market,3);
  assert(result.events.includes('城下で市が賑わい、臨時収入560を得ました。'));
});

test('pre-appointment catch-up retains personal ownership, home, facilities and income',()=>{
  const personal=create({startCastle:'nanao'});personal.applyWorldClock(clock(0));
  const base=baseFor(personal,100000,{buildings:{...personal.state.buildings,market:20,keep:16},castleLevel:48});
  const game=staffFrom(personal,base);
  assert.equal(game.state.home,'nanao');assert.equal(game.state.castles.sunpu.owner,personal.state.castles.sunpu.owner);
  personal.applyWorldClock(clock(99999));game.applyWorldClock(clock(99999));sameResources(personal,game);
  assert.deepEqual(game.state.buildings,personal.state.buildings);assert.equal(game.state.cycle.home,'nanao');
  personal.applyWorldClock(clock(100000));game.applyWorldClock(clock(100000));sameResources(personal,game);
  assert.equal(game.state.home,'sunpu');assert.equal(game.state.castles.sunpu.owner,game.state.clan);assert.equal(game.state.castles.sunpu.level,48);
  assert.equal(game.state.buildings.market,20);assert.equal(raw(game).state.buildings.market,personal.state.buildings.market);
  personal.applyWorldClock(clock(160000));game.applyWorldClock(clock(160000));assert(game.state.resources.gold>personal.state.resources.gold);
});

test('appointment inside a long interval matches persisted incremental catch-up',()=>{
  const personal=create();personal.upgrade('farm');personal.applyWorldClock(clock(0));
  const base=baseFor(personal,90000,{buildings:{...personal.state.buildings,keep:8,market:9},castleLevel:33});
  base.history=[{kind:'building',id:'market',level:10,effectiveElapsedMs:240000}];base.buildings={...base.buildings,market:10};
  const whole=staffFrom(personal,base);let stepped=staffFrom(personal,base);whole.applyWorldClock(clock(600000));
  for(let elapsed=10000;elapsed<=600000;elapsed+=10000){stepped.applyWorldClock(clock(elapsed));stepped=E.fromSave(stepped.exportSave(),officers,{isStaff:true,staffBase:base});}
  sameResources(whole,stepped);
  for(const key of ['home','cycle','troops','morale','command','magatama','buildings','castles','stats','jobs','tech','seed'])assert.deepEqual(whole.state[key],stepped.state[key],key);
  assert.deepEqual(raw(whole).state.buildings,raw(stepped).state.buildings);assert.equal(raw(whole).state.buildings.farm,3);
});

test('a cycle boundary before appointment preserves the original campaign home',()=>{
  const personal=create({startCastle:'nanao'});personal.state.castles.kiyosu.owner=personal.state.clan;personal.applyWorldClock(clock(cycleMs-1000));
  const base=baseFor(personal,cycleMs+2000,{buildings:{...personal.state.buildings,keep:20},castleLevel:64});
  const game=staffFrom(personal,base);personal.applyWorldClock(clock(cycleMs+1000));game.applyWorldClock(clock(cycleMs+1000));
  assert.equal(game.state.home,'nanao');assert.equal(game.state.cycle.home,'nanao');assert.notEqual(game.state.castles.sunpu.owner,game.state.clan);
  assert.deepEqual(game.state.cycle.latestReward,personal.state.cycle.latestReward);sameResources(personal,game);
  game.applyWorldClock(clock(cycleMs+2000));assert.equal(game.state.home,'sunpu');assert.equal(game.state.castles.sunpu.level,64);
});

test('appointment exactly at a cycle boundary uses the shared home for the new cycle',()=>{
  const personal=create({startCastle:'nanao'});personal.applyWorldClock(clock(cycleMs-1000));
  const base=baseFor(personal,cycleMs,{castleLevel:64});const game=staffFrom(personal,base);
  game.applyWorldClock(clock(cycleMs));assert.equal(game.state.home,'sunpu');assert.equal(game.state.cycle.home,'sunpu');assert.equal(game.state.castles.sunpu.level,64);
  assert.equal(game.state.cycle.latestReward.captured,1);assert.notEqual(game.state.castles.nanao.owner,game.state.clan);
});

test('a linked client waiting for pre-appointment cycle settlement keeps the personal checkpoint',()=>{
  const personal=create({startCastle:'nanao'});personal.applyWorldClock(clock(cycleMs-1000));
  const base=baseFor(personal,cycleMs+2000),game=staffFrom(personal,base);
  const pending=game.applyWorldClock(clock(cycleMs+5000),{deferCycleSettlement:true});
  assert.equal(pending.settlementRequired,true);assert.equal(game.state.worldClock.elapsedMs,cycleMs-1);assert.equal(game.state.home,'nanao');assert.equal(game.state.cycle.home,'nanao');
  const settled=E.fromSave(game.exportSave(),officers,{isStaff:true,staffBase:base});settled.applyWorldClock(clock(cycleMs+5000));
  assert.equal(settled.state.home,'sunpu');assert.equal(settled.state.cycle.latestReward.captured,0);assert.equal(settled.state.cycle.index,1);
});

test('a defeated personal campaign resumes only at the appointment timestamp',()=>{
  const personal=create();personal.applyWorldClock(clock(0));personal.state.castles[personal.state.home].owner='在地衆';personal._updateCampaignOutcome();
  const base=baseFor(personal,60000,{buildings:{...personal.state.buildings,market:12}}),game=staffFrom(personal,base);
  assert.equal(game.state.gameOver,true);game.applyWorldClock(clock(59999));assert.deepEqual(game.state.resources,personal.state.resources);
  const expectedRaw=raw(personal);expectedRaw.state.turn=1;expectedRaw.state.worldClock.elapsedMs=60000;expectedRaw.state.realtime.elapsed=0;
  const expected=E.fromSave(expectedRaw,officers,{isStaff:true,staffBase:base});
  game.applyWorldClock(clock(120000));expected.applyWorldClock(clock(120000));sameResources(game,expected);
  assert.equal(game.state.home,'sunpu');assert.equal(game.state.gameOver,false);assert.equal(game.state.realtime.running,true);
});

test('former home construction completed at rollover survives in personal progress',()=>{
  const personal=create({startCastle:'nanao'});personal.state.resources.gold=999999;personal.state.resources.wood=999999;personal.state.resources.stone=999999;personal.applyWorldClock(clock(cycleMs-60000));
  const game=staffFrom(personal,baseFor(personal,0,{castleLevel:64}));assert(game.upgradeCastle('nanao').ok);
  game.applyWorldClock(clock(cycleMs));assert.equal(game.state.castles.nanao.level,1);assert.notEqual(game.state.castles.nanao.owner,game.state.clan);
  const progress=game.getStaffPersonalProgress();assert.equal(progress.home,'nanao');assert.equal(progress.castle.level,2);assert.equal(progress.castle.owner,game.state.clan);
  const updatedBase={...game.getStaffBase(),personalHomeCastle:progress.castle},restored=E.fromSave(game.exportSave(),officers,{isStaff:true,staffBase:updatedBase});assert.equal(restored.getStaffPersonalProgress().castle.level,2);
  progress.castle.level=32;assert.equal(game.getStaffPersonalProgress().castle.level,2,'Returned progress must not mutate the internal backup');
});

test('personal wall jobs improve personal progress while shared walls remain independent',()=>{
  const personal=create();assert(personal.upgrade('wall').ok);personal.applyWorldClock(clock(0));
  const base=baseFor(personal,30000,{buildings:{...personal.state.buildings,wall:15}}),game=staffFrom(personal,base);
  game.applyWorldClock(clock(60000));assert.equal(game.state.buildings.wall,15);assert.equal(game.state.castles.sunpu.wall,15);
  assert.equal(raw(game).state.buildings.wall,2);assert.equal(game.getStaffPersonalProgress().castle.wall,2);
});

test('a same-revision personalized progress update is retained without changing shared levels',()=>{
  const personal=create(),base=baseFor(personal),game=staffFrom(personal,base),next=structuredClone(base);next.personalHomeCastle.level=7;
  assert.equal(game.applyStaffBase(next).changed,true);assert.equal(game.getStaffPersonalProgress().castle.level,7);assert.equal(game.state.castles.sunpu.level,1);
  assert.equal(game.applyStaffBase(next).changed,false);
});

test('invalid personal timeline metadata cannot replace a valid projection',()=>{
  const personal=create(),base=baseFor(personal),game=staffFrom(personal,base),before=raw(game);
  for(const patch of [{accessSinceElapsedMs:-1},{personalHome:'edo'},{personalCycleHome:'sunpu'},{personalSunpu:{...base.personalSunpu,level:65}},{personalHomeCastle:{...base.personalHomeCastle,level:33}}]){
    assert.equal(game.applyStaffBase({...base,revision:2,...patch}).ok,false);assert.deepEqual(raw(game).state,before.state);
  }
});

console.log(`${count} staff timeline tests passed.`);
