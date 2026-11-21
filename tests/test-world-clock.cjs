'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {create:clockFactory,calendar,CALENDAR}=require('../world-clock.js');
const scope={window:{}};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const game=options=>new E({officers:roster,difficulty:'easy',seed:785,...options});
const sample=(elapsedMs,more={})=>({id:'shared-world-v1',elapsedMs,running:true,speed:1,revision:0,serverTime:'2026-11-20T12:00:00.000Z',...more});
function clockHarness(options={}){
  let time=0,online=true,hidden=false,next=0;const timers=new Map(),requests=[];
  const fetch=options.fetch|| (async(url,request)=>{requests.push({url,request});return{ok:true,json:async()=>({ok:true,clock:sample(600000)})};});
  const clock=clockFactory({base:'https://local.test',offline:false,now:()=>time,online:()=>online,hidden:()=>hidden,setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id),fetch,...options});
  return{clock,requests,timers,advance:ms=>{time+=ms;},setOnline:value=>{online=value;},setHidden:value=>{hidden=value;}};
}
function productiveGame(){const g=game();for(const key of D.resources)g.state.resources[key]=500000;assert(g.upgrade('farm').ok);assert(g.upgrade('market').ok);assert(g.research('commerce').ok);return g;}
function sameProgress(actual,expected){
  const a=structuredClone(actual),b=structuredClone(expected);
  // Integration intervals may differ in their last IEEE754 bit; spendable integer
  // resources, jobs, CPU decisions, history and every other saved field stay exact.
  for(const key of D.resources){assert(Math.abs(a.realtime.incomeRemainders[key]-b.realtime.incomeRemainders[key])<1e-10,key+' fractional carry');a.realtime.incomeRemainders[key]=b.realtime.incomeRemainders[key];}
  assert.deepEqual(a,b);
}
const tests=[];function test(name,fn){tests.push({name,fn});}

test('one absolute clock maps all joining players to the same looping calendar',()=>{
  const time=100005*60000+23567,a=game({clan:'織田家'}),b=game({clan:'武田家'}),initialA=structuredClone(a.state.resources),initialB=structuredClone(b.state.resources);
  assert(a.applyWorldClock(sample(time)).migrated);assert(b.applyWorldClock(sample(time)).migrated);
  assert.equal(a.state.turn,100005);assert.deepEqual(a.calendar(),b.calendar());assert.equal(a.calendar().cycle,Math.floor(100005/672)+1);assert.equal(a.state.realtime.elapsed,23.567);
  assert.deepEqual(a.state.resources,initialA);assert.deepEqual(b.state.resources,initialB);
  assert.deepEqual(calendar(671*60000),{...CALENDAR,turn:671,cycle:1,year:1615,month:12,elapsed:0});
  assert.deepEqual(calendar(672*60000),{...CALENDAR,turn:672,cycle:2,year:1560,month:1,elapsed:0});
});

test('legacy retiming preserves assets, unfinished work and remaining treaty periods',()=>{
  const g=productiveGame();g.drawOfficers(1);g.state.turn=17;g.state.realtime.elapsed=33.25;g.state.realtime.commandProgress=7.5;g.state.treaties={'武田家':22,'毛利家':16};g.state.scouted={odawara:20,osaka:17};
  const prior=structuredClone(g.state),target=5000*60000+12001,result=g.applyWorldClock(sample(target));
  assert(result.ok&&result.migrated);for(const key of ['resources','buildings','tech','castles','officers','officerVariants','army','governors','jobs','stats','magatama','captureRewards','claimedQuests'])assert.deepEqual(g.state[key],prior[key],key);
  assert.deepEqual(g.state.treaties,{'武田家':5005});assert.deepEqual(g.state.scouted,{odawara:5003});assert.equal(g.state.realtime.commandProgress,7.5);
  assert(g.state.log.every(item=>item.turn<=5000));assert(g.state.gachaHistory.every(item=>item.turn<=5000));assert.deepEqual(E.fromSave(g.exportSave(),roster).state,g.state);
});

test('calendar wrap resets captured bases, awards once and preserves development',()=>{
  const g=game({isAdmin:true});for(const castle of D.castles)g.state.castles[castle.id].owner=g.state.clan;g.state.buildings.keep=20;g.state.buildings.farm=17;g.state.castles[g.state.home].level=21;g.state.resources.gold=123456;g.state.magatama=12345;
  g.applyWorldClock(sample(671*60000+59000));g.state.treaties={'武田家':675};const officers=[...g.state.officerVariants],home=g.state.home;
  const result=g.applyWorldClock(sample(672*60000));assert(result.monthChanged);assert.equal(g.calendar().cycle,2);assert.equal(g.calendar().year,1560);assert.equal(g.calendar().month,1);assert.equal(g.state.home,home);assert.equal(g.state.buildings.keep,20);assert.equal(g.state.buildings.farm,17);assert.equal(g.state.castles[home].level,21);assert.deepEqual(g.state.officerVariants,officers);assert.deepEqual(g.state.treaties,{});assert.equal(g.ownedCastles().length,1);assert.equal(result.cycleRewards.length,1);assert.equal(result.cycleRewards[0].captured,127);assert(g.state.resources.gold>=123456);assert.equal(g.state.magatama,12345+D.gacha.monthlyReward+12700);
});


test('linked clients stop before the boundary until an authoritative settlement arrives',()=>{
 const g=game();g.state.castles.inabayama.owner=g.state.clan;g.applyWorldClock(sample(672*60000-2000));
 const money=g.state.magatama,result=g.applyWorldClock(sample(672*60000+1000),{deferCycleSettlement:true});
 assert(result.settlementRequired);assert.equal(result.pending,false);assert.equal(g.state.worldClock.elapsedMs,672*60000-1);assert.equal(g.state.cycle.index,0);assert.equal(g.state.magatama,money);assert.equal(g.ownedCastles().length,2);
 const again=g.applyWorldClock(sample(672*60000+2000),{deferCycleSettlement:true});assert.equal(again.changed,false);assert(again.settlementRequired);
 const authority=E.fromSave(g.exportSave(),roster),settled=authority.applyWorldClock(sample(672*60000));assert.equal(settled.cycleRewards[0].captured,1);assert.equal(authority.state.magatama,money+D.gacha.monthlyReward+100);assert.equal(authority.ownedCastles().length,1);
 assert.deepEqual(E.fromSave(authority.exportSave(),roster).state,authority.state);
});
test('a defeated lord restarts at the originally selected home on the next boundary',()=>{
 const g=game({startCastle:'inabayama'});g.applyWorldClock(sample(672*60000-1000));for(const c of Object.values(g.state.castles))if(c.owner===g.state.clan)c.owner='在地衆';g.state.gameOver=true;g.state.realtime.running=false;
 g.applyWorldClock(sample(672*60000));assert.equal(g.state.home,'inabayama');assert.equal(g.state.gameOver,false);assert.equal(g.state.castles.inabayama.owner,g.state.clan);assert.equal(g.state.cycle.latestReward.captured,0);assert.equal(g.state.realtime.running,true);
});
test('bounded catch-up does not falsely signal settlement before reaching the boundary',()=>{
 const g=game();g.applyWorldClock(sample(100000));const result=g.applyWorldClock(sample(672*60000),{deferCycleSettlement:true,maxSeconds:60});assert(result.pending);assert.equal(result.settlementRequired,false);assert.equal(g.state.worldClock.elapsedMs,160000);
});

test('continuous per-second progression and reconnect catch-up produce identical real game state',()=>{
  const a=productiveGame(),start=123*60000+4567;a.applyWorldClock(sample(start));const b=E.fromSave(a.exportSave(),roster);
  for(let elapsed=1000;elapsed<=600000;elapsed+=1000)a.applyWorldClock(sample(start+elapsed));
  assert(b.applyWorldClock(sample(start+600000)).ok);assert.deepEqual(b.state,a.state);assert.equal(a.state.jobs.length,0);assert.equal(a.state.stats.upgrades,2);assert.equal(a.state.stats.researches,1);
});

test('bounded reconnect batches survive save/reload and converge to a continuous update',()=>{
  const a=productiveGame(),start=30*60000+21543;a.applyWorldClock(sample(start));let b=E.fromSave(a.exportSave(),roster);const end=start+630125;
  for(let elapsed=1000;elapsed<=630000;elapsed+=1000)a.applyWorldClock(sample(start+elapsed));a.applyWorldClock(sample(end));
  let pending=true,batches=0;while(pending){const result=b.applyWorldClock(sample(end),{maxSeconds:60});pending=result.pending;batches++;assert(batches<20);b=E.fromSave(b.exportSave(),roster);}
  assert(batches>1);sameProgress(b.state,a.state);assert.equal(b.state.worldClock.elapsedMs,end);
});

test('duplicate and old snapshots cannot pay income or complete jobs twice',()=>{
  const g=productiveGame();g.applyWorldClock(sample(100000));g.applyWorldClock(sample(180000));const before=structuredClone(g.state);
  for(const ms of [180000,180000,120000,100000]){const result=g.applyWorldClock(sample(ms));assert.equal(result.changed,false);assert.deepEqual(g.state,before);}
});

test('operator pause applies the final elapsed interval once and then holds every resource',()=>{
  const g=productiveGame();g.applyWorldClock(sample(100000));assert(g.applyWorldClock(sample(110000,{running:false,revision:1})).ok);const paused=structuredClone(g.state);
  assert.equal(g.state.realtime.running,false);for(let i=0;i<5;i++){g.applyWorldClock(sample(110000,{running:false,revision:1}));assert.deepEqual(g.state,paused);}
  g.applyWorldClock(sample(120000,{running:true,speed:4,revision:2}));assert.equal(g.state.realtime.speed,4);assert.equal(g.state.worldClock.elapsedMs,120000);
});

test('personal ticking, speed and pause are disabled after a shared anchor is present',()=>{
  const g=game();g.applyWorldClock(sample(10000));const before=structuredClone(g.state);
  assert.equal(g.tick(5).changed,false);assert.equal(g.setSpeed(4).ok,false);assert.equal(g.setRunning(false).ok,false);assert.equal(g.nextTurn().ok,false);assert.deepEqual(g.state,before);
});

test('large absolute turns and fractional phase survive validated save round trips',()=>{
  const g=game();g.applyWorldClock(sample(500123*60000+12345));assert.deepEqual(E.fromSave(g.exportSave(),roster).state,g.state);
  for(const mutate of [s=>s.turn++,s=>s.realtime.elapsed+=.1,s=>s.worldClock.elapsedMs=-1,s=>s.worldClock.elapsedMs+=.5,s=>s.worldClock.id='',s=>s.worldClock.id='x'.repeat(101)]){const raw=JSON.parse(g.exportSave());mutate(raw.state);assert.throws(()=>E.fromSave(raw,roster));}
});

test('malformed clock samples reject atomically and cannot create an unloadable save',()=>{
  const g=game(),before=structuredClone(g.state);
  for(const invalid of [sample(0,{id:''}),sample(-1),sample(1.5),sample(NaN),sample(100,{running:'true'}),sample(100,{speed:3}),sample(100,{id:'x'.repeat(101)}),sample(60000000000000)]){assert.equal(g.applyWorldClock(invalid).ok,false,JSON.stringify(invalid));assert.deepEqual(g.state,before);}
});

test('defeated campaigns retain the shared calendar while their economy remains stopped',()=>{
  const g=game();g.applyWorldClock(sample(100000));g.state.gameOver=true;const resources=structuredClone(g.state.resources);g.applyWorldClock(sample(120000));assert.equal(g.state.turn,2);assert.equal(g.state.worldClock.elapsedMs,120000);assert.deepEqual(g.state.resources,resources);assert.equal(g.state.realtime.running,false);
});

test('clock extrapolation uses monotonic time and becomes unready after fifteen seconds',async()=>{
  const h=clockHarness();await h.clock.start();assert.equal(h.requests.length,1);assert.equal(h.requests[0].url,'https://local.test/api/v1/world-clock');assert.equal(h.requests[0].request.cache,'no-store');
  const wall=Date.now;try{Date.now=()=>0;h.advance(5000);assert.equal(h.clock.snapshot().clock.elapsedMs,605000);Date.now=()=>9e15;h.advance(10000);assert.equal(h.clock.snapshot().clock.elapsedMs,615000);assert.equal(h.clock.snapshot().ready,true);h.advance(1);assert.equal(h.clock.snapshot().ready,false);}finally{Date.now=wall;h.clock.stop();}
});

test('clock revisions reject out-of-order control changes and lower elapsed snapshots',()=>{
  const h=clockHarness();assert(h.clock.accept(sample(500000,{revision:2,speed:4})));h.advance(1000);assert.equal(h.clock.snapshot().clock.elapsedMs,504000);
  assert.equal(h.clock.accept(sample(510000,{revision:1,running:false})),false);assert.equal(h.clock.accept(sample(499000,{revision:2})),false);assert.equal(h.clock.snapshot().clock.speed,4);
  h.clock.accept(sample(505000,{revision:3,running:false}));h.advance(10000);assert.equal(h.clock.snapshot().clock.elapsedMs,505000);assert.equal(h.clock.snapshot().clock.running,false);h.clock.stop();
});

test('offline transport blocks shared-clock readiness and refresh restores it',async()=>{
  const h=clockHarness();await h.clock.start();h.setOnline(false);assert.equal(h.clock.snapshot().ready,false);await h.clock.refresh();assert.equal(h.requests.length,1);h.setOnline(true);h.advance(20000);await h.clock.refresh();assert.equal(h.requests.length,2);assert.equal(h.clock.snapshot().ready,true);h.clock.stop();
});

test('responses from an older stopped session cannot overwrite a restarted clock',async()=>{
  const replies=[];const h=clockHarness({fetch:()=>new Promise(resolve=>replies.push(resolve))});
  const first=h.clock.start();await Promise.resolve();assert.equal(replies.length,1);h.clock.stop();const second=h.clock.start();await Promise.resolve();assert.equal(replies.length,2);
  replies[0]({ok:true,json:async()=>({ok:true,clock:sample(999000,{revision:9})})});await first;assert.equal(h.clock.snapshot().ready,false);
  replies[1]({ok:true,json:async()=>({ok:true,clock:sample(200000,{revision:1})})});await second;assert.equal(h.clock.snapshot().clock.elapsedMs,200000);h.clock.stop();
});

test('a synchronous fetch failure permits the next refresh to retry',async()=>{
  let calls=0;const h=clockHarness({fetch:()=>{calls++;if(calls===1)throw Error('transport initialization failed');return Promise.resolve({ok:true,json:async()=>({ok:true,clock:sample(123000)})});}});
  await h.clock.start();assert.equal(h.clock.snapshot().ready,false);await h.clock.refresh();assert.equal(calls,2);assert.equal(h.clock.snapshot().clock.elapsedMs,123000);h.clock.stop();
});

test('file distribution continues from its saved phase without calling a server',async()=>{
  let fetched=false;const h=clockHarness({offline:true,initialState:()=>({turn:4321,realtime:{elapsed:17.25}}),fetch:()=>{fetched=true;throw Error('offline');}});await h.clock.start();assert.equal(h.clock.snapshot().mode,'offline');assert.equal(h.clock.snapshot().clock.elapsedMs,4321*60000+17250);h.advance(45000);assert.equal(h.clock.snapshot().clock.elapsedMs,4321*60000+62250);assert.equal(h.clock.snapshot().ready,true);assert.equal(fetched,false);h.clock.stop();
});

(async()=>{let failures=0;for(const {name,fn}of tests){try{await fn();console.log('PASS '+name);}catch(error){failures++;console.error('FAIL '+name+'\n'+error.stack);}}console.log(`${tests.length-failures}/${tests.length} shared-clock engine and transport checks passed.`);if(failures)process.exitCode=1;})();
