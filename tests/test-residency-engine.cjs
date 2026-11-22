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

test('relocation starts only at the chosen castle with exactly the existing officers, ranks and training',()=>{
  for(const role of ['lord','retainer']){
    const g=fresh({difficulty:'hard'}),s=g.state,extra=officers.find(o=>!s.officers.includes(o.id));
    assert(g._grantOfficerVariant(extra.id,'SS'));
    assert(g.assignArmy([extra.id,...s.army.slice(0,2)]).ok);
    assert(g.setOfficerRole(extra.id,'defense').ok);
    g.recordOfficerBattle({key:'pre-move-defense',won:true,role:'defense'});
    assert(g.saveArmyPreset(1,'守備隊').ok);
    assert(g.assignGovernor('farm',s.officers.find(id=>!s.army.includes(id))).ok);
    s.buildings.keep=16;s.tech[D.techs[0].id]=2;s.castles.ishikawa.owner=s.clan;
    assert(g.upgrade('farm').ok);s.turn=18;s.realtime.elapsed=20;
    const oldCampaign=s.walking.campaignId,original=structuredClone(s),defaults=fresh({startCastle:'sunpu',difficulty:'hard'}).state;
    const moved=g.relocateResidence('sunpu',{role});assert(moved.ok,moved.message);
    assert.deepEqual([moved.previousHome,moved.home,moved.role],['kiyosu','sunpu',role]);
    const next=g.state;assert.notEqual(next.walking.campaignId,oldCampaign);
    assert.equal(next.home,'sunpu');assert.equal(next.cycle.home,'sunpu');assert.equal(next.turn,0);
    for(const key of ['clan','difficulty','officers','officerVariants','army'])assert.deepEqual(next[key],original[key]);
    for(const key of ['officers','presets'])assert.deepEqual(next.progress[key],original.progress[key]);
    for(const key of ['buildings','tech','castles','jobs','governors','branches','lastBattle','march','marchHistory','stats','gachaHistory'])assert.deepEqual(next[key],defaults[key]);
    assert.deepEqual(g.ownedCastles().map(c=>c.id),['sunpu']);
    assert(!next.log.some(entry=>entry.text.includes('門出の贈り物')));assert.match(next.log[0].text,/駿府城へ本拠を移し/);assert.doesNotMatch(next.log[0].text,/領主|家臣/);assert(moved.message.includes(role==='lord'?'領主':'家臣'));
    assert.deepEqual(load(g).state,next);
  }
});

test('relocating repeatedly never refills spent currency, troops, garrison or granted rewards',()=>{
  const g=fresh({difficulty:'easy'}),s=g.state;
  assert(g.applyGift({gold:36,magatama:8},'household-mail-once').ok);
  const quest=D.quests[0].id;s.claimedQuests.push(quest);s.captureRewards.push('inuyama');
  assert(g.beginLocalWalkingSession('walk-residency-01').ok);assert(g.applyLocalWalkingProgress('walk-residency-01',7).ok);
  s.walking.serverSteps=11;Object.assign(s.resources,{gold:90000,rice:400,wood:0,stone:50000});
  s.magatama=0;s.troops=380;s.castles.kiyosu.troops=275;
  const collected=[...s.officerVariants];
  for(const home of ['sunpu','ishikawa','kiyosu','sunpu']){
    const before=g.state.walking.campaignId;assert(g.relocateResidence(home,{role:'lord'}).ok);
    assert.notEqual(g.state.walking.campaignId,before);
    assert.deepEqual(g.state.resources,{gold:4400,rice:400,wood:0,stone:1200});assert.equal(g.state.magatama,0);
    assert.equal(g.state.troops,380);assert.equal(g.state.castles[home].troops,275);
    assert.deepEqual(g.state.officerVariants,collected);assert.deepEqual(g.state.claimedQuests,[quest]);
    assert(g.state.captureRewards.includes('inuyama'));assert(g.state.captureRewards.includes(home));
    assert.deepEqual(g.state.giftReceipts,['household-mail-once']);assert.equal(g.applyGift({gold:36},'household-mail-once').already,true);
    assert.equal(g.state.walking.localSteps,7);assert.equal(g.state.walking.serverSteps,11);
    assert.equal(g.beginLocalWalkingSession('walk-residency-01').closed,true);assert(!g.applyLocalWalkingProgress('walk-residency-01',8).ok);
    assert(!g.canDrawOfficers(1).ok);
  }
});

test('a new shared campaign starts at the authoritative current date without historical income or cycle rewards',()=>{
  const g=fresh();assert(g.applyWorldClock(clock(10000)).ok);
  g.setBranchAuthority({resolvedElapsedMs:10000});
  const now={...clock((D.worldCalendar.monthsPerCycle+2)*60000+23000),running:false,speed:4};
  g.state.resources.gold=35;g.state.magatama=3;
  const moved=g.relocateResidence('sunpu',{role:'retainer',worldClock:now});assert(moved.ok,moved.message);
  const s=g.state;assert.deepEqual(s.worldClock,{id:now.id,elapsedMs:now.elapsedMs});assert.equal(s.turn,D.worldCalendar.monthsPerCycle+2);
  assert.equal(s.realtime.elapsed,23);assert.equal(s.realtime.running,false);assert.equal(s.realtime.speed,4);
  assert.equal(s.cycle.index,1);assert.equal(s.cycle.latestReward,null);assert.equal(s.resources.gold,35);assert.equal(s.magatama,3);
  assert.equal(g.branchResolvedElapsedMs,0);assert.deepEqual(g.takeHomeDefenseLosses(),[]);assert.deepEqual(load(g).state,s);
  assert(g.relocateResidence('ishikawa',{role:'lord'}).ok);assert.equal(g.state.worldClock.elapsedMs,now.elapsedMs);
});

test('after a home defense loss, a different registered household may relocate to the private fallback home',()=>{
  const g=vulnerable(fresh(),{home:'ishikawa',outposts:['kiyosu']});
  g._cpuTurn();assert.equal(g.state.home,'kiyosu');assert.equal(g.state.cycle.home,'ishikawa');
  const same=g.relocateResidence('ishikawa',{role:'lord',residencyCastleId:'ishikawa'});assert.equal(same.code,'RESIDENCY_SAME_CASTLE');
  const changed=g.relocateResidence('kiyosu',{role:'retainer',residencyCastleId:'ishikawa'});
  assert(changed.ok);assert.equal(changed.previousHome,'kiyosu');assert.equal(g.state.cycle.home,'kiyosu');assert.deepEqual(load(g).state,g.state);
});

test('invalid relocation inputs leave both campaign identity and prior state intact',()=>{
  const g=fresh();g.applyWorldClock(clock(48000));const before=g.exportSave();
  for(const [castle,options,code] of [
    ['kiyosu',{role:'lord'},'RESIDENCY_SAME_CASTLE'],['unknown',{role:'lord'},'INVALID_CASTLE'],['constructor',{role:'lord'},'INVALID_CASTLE'],
    ...D.majorCityIds.map(id=>[id,{role:'retainer'},'INVALID_CASTLE']),
    ['sunpu',{role:'staff'},'INVALID_RESIDENCY_ROLE'],['sunpu',null,'INVALID_RESIDENCY_ROLE'],
    ['sunpu',{role:'retainer',worldClock:clock(2000)},'INVALID_WORLD_CLOCK'],
    ['sunpu',{role:'retainer',worldClock:{id:'bad'}},'INVALID_WORLD_CLOCK']
  ]){
    const result=g.relocateResidence(castle,options);assert.equal(result.ok,false);assert.equal(result.code,code);
    assert.deepEqual(JSON.parse(g.exportSave()).state,JSON.parse(before).state);
  }
  for(const options of [{isAdmin:true},{isStaff:true}]){
    const fixed=fresh(options),home=fixed.state.home,unchanged=JSON.parse(fixed.exportSave()).state;
    assert.equal(fixed.relocateResidence('sunpu',{role:'lord'}).code,'RESIDENCY_FIXED_HOME');assert.equal(fixed.state.home,home);
    assert.deepEqual(JSON.parse(fixed.exportSave()).state,unchanged);
  }
});

test('defeat and pending actions end in the old campaign without synthetic succession or refunds',()=>{
  const defeated=vulnerable();defeated._cpuTurn();assert(defeated.state.gameOver);
  assert(defeated.relocateResidence('sunpu',{role:'retainer'}).ok);assert(!defeated.state.gameOver);
  assert.equal(defeated.state.castles.sunpu.troops,0);assert.deepEqual(defeated.takeHomeDefenseLosses(),[]);
  const g=fresh();g.state.castles.nijo.owner=g.state.clan;
  assert(g.hireCovert('nijo',20).ok);
  assert(g.departCovertDispatch('nijo',{kind:'castle',castleId:'odawara'},10,'station').ok);
  assert(g.departAttack('inuyama','balanced',300).ok);
  assert(g.state.march);assert(g.state.covert.dispatches.length);
  const troops=g.state.troops,rice=g.state.resources.rice;
  assert(g.relocateResidence('sunpu',{role:'lord'}).ok);assert.equal(g.state.march,null);assert.deepEqual(g.state.covert.dispatches,[]);
  assert.equal(g.state.roaming.sequence,0);assert.equal(g.state.troops,troops);assert.equal(g.state.resources.rice,rice);
  assert.deepEqual(load(g).state,g.state);
});

console.log(`Residency engine: ${count} tests passed.`);
