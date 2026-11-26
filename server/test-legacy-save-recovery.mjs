// Regression coverage for old saves joining the current shared runtime.
// All requests exercise the real Worker against local, in-memory SQLite.
import assert from 'node:assert/strict';
import {harness,syncFieldWriter} from './test-support.mjs';
import {fixture,post,row,save} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

let checks=0,calls=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Legacy recovery tests must stay local');};
const clone=value=>structuredClone(value);
const clock=elapsedMs=>({id:'world-v1',elapsedMs,running:true,speed:1});
async function scope(name,run){
  const h=harness();
  try{await run(h);checks++;console.log('PASS '+name);}
  finally{calls+=h.calls;h.close();}
}
async function player(h,name){
  const p=await h.session(name);p.deviceId='recovery-'+p.user.id;
  await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  return p;
}
const put=(h,p,value,expected=200)=>h.api('/sync',{
  method:'PUT',token:p.token,
  body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected
});

try{
  for(const [localTurn,sharedElapsed] of [[100,0],[0,123000],[1000,41700000]]){
    await scope('legacy local month '+localTurn+' joins shared time '+sharedElapsed+' without retroactive charges or grants',async h=>{
      await h.api('/config');
      h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?').run(sharedElapsed,h.now);
      const p=await player(h,'旧形式'+localTurn),raw=h.fresh();
      raw.state.turn=localTurn;raw.state.realtime.elapsed=17.25;
      raw.state.jobs=[{kind:'building',id:'farm',targetLevel:3,total:1,remaining:1,totalSeconds:60,remainingSeconds:40}];
      raw.state.treaties={'徳川家':localTurn+4};raw.state.scouted={inuyama:localTurn+2};
      delete raw.state.officerHealth;delete raw.state.worldClock;
      const original=clone(raw),result=(await put(h,p,raw)).data,accepted=result.save.state;
      assert.deepEqual(raw,original,'The imported object is unchanged');
      assert.deepEqual(accepted.worldClock,{id:'world-v1',elapsedMs:sharedElapsed});
      assert.equal(accepted.turn,Math.floor(sharedElapsed/60000));
      assert.equal(accepted.realtime.elapsed,sharedElapsed%60000/1000);
      assert.deepEqual(accepted.resources,original.state.resources);
      assert.equal(accepted.troops,original.state.troops);
      assert.equal(accepted.command,original.state.command);
      assert.equal(accepted.magatama,original.state.magatama);
      assert.deepEqual(accepted.jobs,original.state.jobs);
      assert.deepEqual(accepted.army,original.state.army);
      assert.deepEqual(accepted.officerVariants,original.state.officerVariants);
      assert.equal(accepted.treaties['徳川家'],accepted.turn+4);
      assert.equal(accepted.scouted.inuyama,accepted.turn+2);
      assert.equal(accepted.upkeep.settledTurn,accepted.turn);
      assert.equal(accepted.repair.settledTurn,accepted.turn);
      assert.equal(accepted.cycle.latestReward,null,'Clock attachment awards no past cycle');
      assert.equal(accepted.officerHealth.asOfElapsedMs,sharedElapsed);
      assert(Object.values(accepted.officerHealth.values).every(value=>value===100));
      assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM cycle_receipts').get().n,0);
      const committed=clone(row(h,p));
      assert.equal((await put(h,p,raw,409)).data.error.code,'CLOCK_ANCHOR_REQUIRED');
      assert.deepEqual(clone(row(h,p)),committed,'Replaying the unanchored file cannot replace the committed save');
    });
  }

  await scope('bad old saves and forged roles keep the last good cloud save',async h=>{
    const p=await fixture(h,'復元入力の検証'),before=clone(row(h,p));
    for(const change of [
      state=>{state.resources.gold=-1;},
      state=>{state.officerHealth={version:1,asOfElapsedMs:0,values:{unknown:100}};},
      state=>{state.jobs=[{kind:'building',id:'farm',targetLevel:32,total:1,remaining:1,totalSeconds:60,remainingSeconds:40}];}
    ]){
      const malformed=save(h,p);change(malformed.state);
      await put(h,p,malformed,400);assert.deepEqual(clone(row(h,p)),before);
    }
    const forged=save(h,p);forged.state.home='kyoto_gosho';
    forged.state.castles.kyoto_gosho.owner=forged.state.clan;
    forged.state.isStaff=true;forged.state.isCourtEmperor=true;
    assert.equal((await put(h,p,forged,403)).data.error.code,'STAFF_ENTITLEMENT_REQUIRED');
    assert.deepEqual(clone(row(h,p)),before);
  });

  await scope('legacy Kyoto castle work survives cloud round trips without changing the shared palace',async h=>{
    await fixture(h,'復元の運営',{admin:true});
    const p=await fixture(h,'復元する旧担当',{staff:true}),old=save(h,p);
    old.state.home='sunpu';old.state.cycle.home='sunpu';old.state.staffService={baseId:'sunpu'};
    old.state.castles.sunpu={owner:old.state.clan,level:63,wall:17,troops:6789};
    delete old.state.castles.kyoto_gosho;
    old.state.jobs=[{kind:'castle',id:'sunpu',targetLevel:64,total:1,remaining:1,totalSeconds:60,remainingSeconds:40}];
    h.sql.prepare('UPDATE player_saves SET save_json=?,cycle_home=? WHERE user_id=?').run(JSON.stringify(old),'sunpu',p.user.id);
    const sharedBefore=clone(h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get());
    const loaded=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
    const browser=GameEngine.fromSave(loaded.save,GAME_OFFICERS,{isStaff:true,staffBase:loaded.staffBase,maintenanceAuthority:loaded.maintenanceAuthority});
    assert.equal(browser.state.castles.kyoto_gosho.level,loaded.staffBase.castleLevel);
    const exported=JSON.parse(browser.exportSave());
    assert.equal(exported.state.castles.kyoto_gosho.level,63);
    assert.equal(exported.state.castles.kyoto_gosho.wall,17);
    assert.equal(exported.state.jobs[0].targetLevel,64);
    const accepted=(await put(h,p,exported)).data;
    assert.equal(accepted.save.state.castles.kyoto_gosho.level,63);
    assert.deepEqual(accepted.save.state.resources,old.state.resources);
    assert.equal(accepted.save.state.castles.kyoto_gosho.troops,6789);
    h.now+=40000;
    const completed=await syncFieldWriter(h,p);
    assert.equal(completed.save.state.castles.kyoto_gosho.level,64);
    assert.equal(completed.save.state.jobs.length,0);
    assert.equal(completed.save.state.stats.castleUpgrades,old.state.stats.castleUpgrades+1);
    const stable=(await put(h,p,completed.save)).data;
    assert.equal(stable.save.state.castles.kyoto_gosho.level,64);
    assert.equal(stable.save.state.stats.castleUpgrades,completed.save.state.stats.castleUpgrades);
    assert.deepEqual(stable.save.state.resources,completed.save.state.resources);
    assert.deepEqual(clone(h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get()),sharedBefore);
    assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_contributions').get().n,0);
    assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_base_requests').get().n,0);
    const reload=GameEngine.fromSave(stable.save,GAME_OFFICERS,{isStaff:true,staffBase:stable.staffBase});
    assert.equal(reload.state.castles.kyoto_gosho.level,stable.staffBase.castleLevel);
    assert.equal(JSON.parse(reload.exportSave()).state.castles.kyoto_gosho.level,64);
  });

  await scope('a legacy private palace job cannot affect shared income or complete twice',async h=>{
    const personal=new GameEngine({officers:GAME_OFFICERS,seed:17,startCastle:'nanao'});
    const raw=JSON.parse(GameEngine.fromSave(personal.exportSave(),GAME_OFFICERS,{isStaff:true}).exportSave());
    raw.state.castles.kyoto_gosho.level=63;raw.state.castles.kyoto_gosho.wall=17;
    raw.state.jobs=[{kind:'castle',id:'kyoto_gosho',targetLevel:64,total:1,remaining:1,totalSeconds:60,remainingSeconds:40}];
    const buildings=clone(personal.state.buildings),base={id:'kyoto_gosho',revision:1,castleLevel:5,buildings,initial:{castleLevel:5,buildings:clone(buildings)},history:[],jobs:[],accessSinceElapsedMs:0,personalClan:personal.state.clan,personalHome:personal.state.home,personalCycleHome:personal.state.home,personalHomeCastle:clone(personal.state.castles[personal.state.home]),personalBaseCastle:clone(personal.state.castles.kyoto_gosho)};
    const unchanged=clone(base),controlRaw=clone(raw);controlRaw.state.jobs=[];
    const game=GameEngine.fromSave(raw,GAME_OFFICERS,{isStaff:true,staffBase:base});
    const control=GameEngine.fromSave(controlRaw,GAME_OFFICERS,{isStaff:true,staffBase:base});
    for(const g of [game,control]){assert(g.applyWorldClock(clock(0)).ok);assert(g.applyWorldClock(clock(40000)).ok);}
    assert.equal(game.state.castles.kyoto_gosho.level,5);
    assert.deepEqual(game.state.resources,control.state.resources);
    assert.deepEqual(game.income(),control.income());
    assert.deepEqual(base,unchanged);
    const output=JSON.parse(game.exportSave());assert.equal(output.state.castles.kyoto_gosho.level,64);
    const reloaded=GameEngine.fromSave(output,GAME_OFFICERS,{isStaff:true,staffBase:base});
    reloaded.applyWorldClock(clock(40000));
    assert.equal(reloaded.state.stats.castleUpgrades,raw.state.stats.castleUpgrades+1);
    assert.equal(JSON.parse(reloaded.exportSave()).state.castles.kyoto_gosho.level,64);
    const resources=clone(reloaded.state.resources);
    assert(reloaded.setRoleAccess({isStaff:false}).ok);
    assert.equal(reloaded.state.home,personal.state.home);
    assert.equal(reloaded.state.castles.kyoto_gosho.level,1);
    assert.notEqual(reloaded.state.castles.kyoto_gosho.owner,reloaded.state.clan);
    assert.equal(reloaded.state.castles[personal.state.home].level,personal.state.castles[personal.state.home].level);
    assert.deepEqual(reloaded.state.resources,resources);
  });
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
