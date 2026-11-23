'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const fresh=options=>new E({officers,seed:1,...options});
const clone=value=>structuredClone(value);
const save=g=>JSON.parse(g.exportSave());
const quiet=g=>{g._cpuTurn=()=>[];return g;};
const clock=(elapsedMs,extra={})=>({id:'health-world',elapsedMs,running:true,speed:1,...extra});
const health=g=>clone(g.state.officerHealth);
const advance=(g,seconds,step=5)=>{for(let left=seconds;left>1e-9;){const delta=Math.min(left,step);g.tick(delta);left-=delta;}};
const hurt=(g,ids=g.state.army,key='health-loss')=>g.recordOfficerBattle({key,won:false,army:ids});
const weakTarget=g=>{const target=g.adjacentTargets().find(c=>g.previewBattle(c.id,'balanced',1500).ok);assert(target);g.state.castles[target.id].troops=100;g.state.castles[target.id].wall=1;return target.id;};
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}

test('legacy saves initialize every owned person at 100 at the saved game time',()=>{
  const g=fresh(),old=save(g);old.state.turn=73;old.state.realtime.elapsed=5.5;delete old.state.officerHealth;
  const restored=E.fromSave(old,officers);
  assert.equal(restored.state.officerHealth.asOfElapsedMs,73*60000+5500);
  assert.deepEqual(Object.keys(restored.state.officerHealth.values),restored.state.officers);
  for(const id of restored.state.officers)assert.equal(restored.officerHealth(id).current,100);
  assert.equal(restored.officerHealth('not-owned'),null);
  assert.deepEqual(E.fromSave(restored.exportSave(),officers).state.officerHealth,restored.state.officerHealth);
});

test('rank upgrades and duplicate paintings share one person health; only a new person starts full',()=>{
  const g=fresh(),id=g.state.army[0];hurt(g,[id]);assert.equal(g.officerHealth(id).current,75);
  assert(g._grantOfficerVariant(id,'S'));assert.equal(g.officerHealth(id).current,75);
  assert(g._grantOfficerVariant(id,'S'));assert.equal(g.officerHealth(id).current,75);
  const newcomer=officers.find(o=>!g.state.officers.includes(o.id)&&g.canOwnOfficerVariant(o.id,'D'));
  g._grantOfficerVariant(newcomer.id,'D');assert.equal(g.officerHealth(newcomer.id).current,100);
  assert.equal(g.officerHealth(id).current,75);
  assert.deepEqual(E.fromSave(g.exportSave(),officers).state.officerHealth,g.state.officerHealth);
});

test('one real battle consumes exactly 15 for a win or 25 for a loss, once per participating person',()=>{
  const g=fresh(),[a,b]=g.state.army,waiting=g.state.officers.find(id=>!g.state.army.includes(id));
  assert(g.recordOfficerBattle({key:'health-win',won:true,army:[a,a]}));
  assert.equal(g.officerHealth(a).current,85);assert.equal(g.officerHealth(b).current,100);
  assert(g.recordOfficerBattle({key:'health-defense',won:false,army:[a,b],role:'defense'}));
  assert.equal(g.officerHealth(a).current,60);assert.equal(g.officerHealth(b).current,75);assert.equal(g.officerHealth(waiting).current,100);
  const before=clone(g.state);assert.equal(E.recordOfficerBattleState(g.state,{key:'health-defense',won:false,army:[a,b],role:'defense',elapsedMs:60000}),false);
  assert.deepEqual(g.state,before,'a replay neither charges again nor advances recovery');
});

test('health zero halves numerical combat ability without altering permanent stats, rank, skills, ownership or sortie availability',()=>{
  const g=fresh(),id=g.state.army[0];g.assignArmy([id]);const officer=clone(g.officer(id)),healthy=g.armyStats(),target=weakTarget(g);
  for(let n=0;n<4;n++)hurt(g,[id],'exhaust-'+n);
  const exhausted=g.officerHealth(id);assert.equal(exhausted.current,0);assert.equal(exhausted.factor,.5);assert.equal(exhausted.status,'exhausted');
  assert.deepEqual(g.officer(id),officer);for(const key of ['lead','valor','intellect','politics'])assert.equal(g.armyStats()[key],Math.round(healthy[key]*.5));
  assert(g.previewBattle(target,'balanced',1500).ok);assert(g.state.officers.includes(id));
  const result=g.attack(target,'balanced',1500);assert(result.ok,result.message);assert.equal(g.officerHealth(id).current,0);
});

test('army presets and previews use each selected person health and never mutate state',()=>{
  const g=fresh(),[a,b]=g.state.army;g.assignArmy([a]);hurt(g,[a]);hurt(g,[a],'second-loss');
  assert(g.saveArmyPreset(0,'交代',[b]).ok);const preset=g.previewArmyPreset(0);
  for(const key of ['lead','valor','intellect','politics'])assert.equal(preset.stats[key],g.armyStats([b])[key]);
  const target=weakTarget(g),before=clone(g.state),analysis=g.battleAnalysis(target,'ambush',1500),simulation=g.simulateArmy({castleId:target,tactic:'ambush',troops:1500,army:[a]});
  assert.equal(analysis.attackPower,simulation.attackPower);assert.equal(Math.round(analysis.factors.reduce((power,f)=>power*f.multiplier,1)),analysis.attackPower);
  for(let n=0;n<5;n++){g.officerHealth(a);g.armyHealth();g.previewBattle(target,'ambush',1500);g.previewArmyPreset(0);}
  assert.deepEqual(g.state,before);
  g.state.command=0;const rejected=clone(g.state);assert.equal(g.attack(target,'balanced',1500).ok,false);assert.deepEqual(g.state,rejected);
});

test('recovery is ten per game month, pauses with local time, and follows game speed',()=>{
  const g=quiet(fresh()),id=g.state.army[0];hurt(g,[id]);assert.equal(g.officerHealth(id).current,75);
  g.setRunning(false);advance(g,60);assert.equal(g.officerHealth(id).current,75);assert.equal(g.officerHealth(id).recovering,false);
  g.setRunning(true);advance(g,30);assert.equal(g.officerHealth(id).current,80);
  g.setSpeed(2);advance(g,15);assert.equal(g.officerHealth(id).current,85);
  assert.equal(g.state.officerHealth.asOfElapsedMs,60000);assert(g.officerHealth(id).recovering);
});

test('short ticks and long shared-clock catch-up recover exactly the same amount and cap at 100',()=>{
  const a=quiet(fresh()),ids=[...a.state.army];hurt(a,ids);hurt(a,ids,'twice');a.applyWorldClock(clock(0));
  const b=quiet(E.fromSave(a.exportSave(),officers));
  for(let elapsed=1000;elapsed<=123000;elapsed+=1000)a.applyWorldClock(clock(elapsed));
  a.applyWorldClock(clock(123007));b.applyWorldClock(clock(123007));assert.deepEqual(health(a),health(b));
  const c=quiet(E.fromSave(b.exportSave(),officers));c.applyWorldClock(clock(3600000));assert.equal(c.officerHealth(ids[0]).current,100);
  const settled=health(c);c.applyWorldClock(clock(3600000));c.applyWorldClock(clock(10000));assert.deepEqual(health(c),settled);
  assert.deepEqual(E.fromSave(c.exportSave(),officers).state.officerHealth,c.state.officerHealth);
});

test('a paused shared clock applies its final elapsed interval once and display reads do not refill health',()=>{
  const g=quiet(fresh()),id=g.state.army[0];hurt(g,[id]);g.applyWorldClock(clock(0));g.applyWorldClock(clock(6000,{running:false}));
  assert.equal(g.officerHealth(id).current,76);const before=clone(g.state);
  g.applyWorldClock(clock(6000,{running:false}));g.tick(5);g.officerHealth(id);g.armyStats();assert.deepEqual(g.state,before);
  assert.equal(g.officerHealth(id).recovering,false);
});

test('waiting for an authoritative maintenance interval also bounds recovery to the confirmed game time',()=>{
  const g=quiet(fresh()),id=g.state.army[0];hurt(g,[id]);g.applyWorldClock(clock(0));
  const authority={version:1,campaignId:g.state.walking.campaignId,activatedElapsedMs:0,revision:1,asOfElapsedMs:6000,baseline:{elapsedMs:0,vacant:0,trade:0,alliance:0},changes:[]};
  assert(g.setMaintenanceAuthority(authority).ok);assert(g.applyWorldClock(clock(60000)).maintenancePending);
  assert.equal(g.officerHealth(id).current,76);assert.equal(g.state.officerHealth.asOfElapsedMs,6000);
  g._advanceRealtime(60);assert.equal(g.officerHealth(id).current,76);
  assert(g.setMaintenanceAuthority({...authority,revision:2,asOfElapsedMs:60000}).ok);g.applyWorldClock(clock(60000));assert.equal(g.officerHealth(id).current,85);
});

test('a server battle with a newer absolute health anchor cannot heal again during old-clock catch-up',()=>{
  const g=quiet(fresh()),id=g.state.army[0];
  assert(E.recordOfficerBattleState(g.state,{key:'future-defense',won:false,role:'defense',army:[id],elapsedMs:60000}));
  assert.equal(g.officerHealth(id).current,75);assert.equal(g.state.turn,0);assert.equal(g.state.officerHealth.asOfElapsedMs,60000);
  const restored=quiet(E.fromSave(g.exportSave(),officers));advance(restored,60);assert.equal(restored.officerHealth(id).current,75);
  advance(restored,6);assert.equal(restored.officerHealth(id).current,76);
  const relocated=quiet(E.fromSave(g.exportSave(),officers));assert(relocated.relocateResidence('okazaki',{role:'lord'}).ok);
  assert.equal(relocated.state.officerHealth.asOfElapsedMs,60000);advance(relocated,60);assert.equal(relocated.officerHealth(id).current,75);
});

test('a local march freezes participants and power, prevents their recovery, and charges them at resolution after army changes',()=>{
  const g=quiet(fresh()),deployed=[...g.state.army],resting=g.state.officers.find(id=>!deployed.includes(id));
  hurt(g,[...deployed,resting]);const target=weakTarget(g),departure=g.departAttack(target,'balanced',1500);assert(departure.accepted);
  const m=departure.march;assert(g.assignArmy([resting]).ok);assert.equal(g.officerHealth(deployed[0]).marching,true);assert.equal(g.officerHealth(resting).marching,false);
  const midway=Math.min(5,m.travel.durationMs/2000);advance(g,midway);assert.equal(g.officerHealth(deployed[0]).current,75);assert(g.officerHealth(resting).current>75);
  const h=quiet(E.fromSave(g.exportSave(),officers));assert.deepEqual(h.state.march.profile.army,deployed);
  advance(h,m.travel.durationMs/1000-midway);const battle=h.state.marchHistory[0].battle;assert(battle);
  for(const id of deployed)assert.equal(h.officerHealth(id).current,battle.won?60:50);
  assert(h.officerHealth(resting).current>=g.officerHealth(resting).current);assert.equal(h.state.progress.officers[resting].sorties,1,'the replacement only has its setup loss');
  const before=health(h);assert.deepEqual(h.resolveDueMarches(),[]);assert.deepEqual(health(h),before);
  advance(h,6);for(const id of deployed)assert.equal(h.officerHealth(id).current,(battle.won?60:50)+1);
});

test('server march markers persist exact army IDs and keep their recovery paused even when overdue or re-formed',()=>{
  const g=quiet(fresh()),deployed=[...g.state.army],resting=g.state.officers.find(id=>!deployed.includes(id));hurt(g,[...deployed,resting]);
  const m=g.departAttack(weakTarget(g),'balanced',1500).march;g.state.march={...m,authority:'server',army:[...m.profile.army]};delete g.state.march.profile;
  assert(g.assignArmy([resting]).ok);const h=quiet(E.fromSave(g.exportSave(),officers));assert.deepEqual(h.state.march.army,deployed);
  h._advanceRealtime(120);for(const id of deployed)assert.equal(h.officerHealth(id).current,75);assert.equal(h.officerHealth(resting).current,95);
  assert(h.state.march);assert.deepEqual(E.fromSave(h.exportSave(),officers).state.officerHealth,h.state.officerHealth);
});

test('cancelled marches do not consume battle health and recovery resumes after cancellation',()=>{
  const g=quiet(fresh()),id=g.state.army[0];hurt(g,[id]);g.departAttack(weakTarget(g),'balanced',1500);advance(g,1);
  assert.equal(g.officerHealth(id).current,75);const cancelled=g._cancelMarch('取りやめ');assert.equal(cancelled.status,'cancelled');assert.equal(g.officerHealth(id).current,75);
  advance(g,6);assert.equal(g.officerHealth(id).current,76);
});

test('roaming retries return the original receipt without further health loss',()=>{
  const g=fresh(),id=g.state.army[0],encounter=g.roamingEncounters()[0],options={requestId:'health-roaming',campaignId:g.state.walking.campaignId,sequence:0};
  const result=g.battleRoaming(encounter.id,'balanced',1500,options);assert(result.ok,result.message);assert.equal(g.officerHealth(id).current,result.battle.won?85:75);
  const before=health(g);assert(g.battleRoaming(encounter.id,'balanced',1500,options).idempotent);assert.deepEqual(health(g),before);
  const restored=E.fromSave(g.exportSave(),officers);assert(restored.battleRoaming(encounter.id,'balanced',1500,options).idempotent);assert.deepEqual(health(restored),before);
});

test('CPU branch defense charges its stationed commander and leaves the unrelated main army untouched',()=>{
  const g=fresh({difficulty:'hard'}),commander=g.state.officers.find(id=>!g.state.army.includes(id));
  for(const castle of Object.values(g.state.castles)){castle.owner='在地衆';castle.troops=100000;}
  g.state.home=g.state.cycle.home='nijo';g.state.castles.nijo={owner:g.state.clan,troops:100,wall:1,level:1};g.state.troops=300;
  g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,commanders:[commander]}];g.state.turn=9;g.random=()=>0;
  assert(g._cpuTurn().length);assert.equal(g.officerHealth(commander).current,75);
  for(const id of g.state.army)assert.equal(g.officerHealth(id).current,100);
  assert.equal(g.officerMastery(commander).defenses,1);
});

test('clock migration, relocation and calendar wrap preserve the same person health without a free refill',()=>{
  const g=quiet(fresh()),id=g.state.army[0];hurt(g,[id]);advance(g,6);const current=g.officerHealth(id).current;
  g.applyWorldClock(clock(5000*60000));assert.equal(g.officerHealth(id).current,current);assert.equal(g.state.officerHealth.asOfElapsedMs,5000*60000);
  g.applyWorldClock(clock(5000*60000+6000));assert.equal(g.officerHealth(id).current,current+1);
  const before=g.officerHealth(id).current,relocated=g.relocateResidence('okazaki',{role:'lord'});assert(relocated.ok,relocated.message);assert.equal(g.officerHealth(id).current,before);
  g._settleCycle(g.state.cycle.index+1);assert.equal(g.officerHealth(id).current,before);
  assert.deepEqual(E.fromSave(g.exportSave(),officers).state.officerHealth,g.state.officerHealth);
});

test('revoking the exclusive administrator rank preserves the person health and a loadable save',()=>{
  const g=fresh({isAdmin:true}),id=D.adminAssets.officerId;g.state.officerVariants=g.state.officerVariants.filter(key=>!key.startsWith(id+':')||key===id+':U');
  hurt(g,[id]);assert.equal(g.officerHealth(id).current,75);assert(g.setRoleAccess({isAdmin:false,isStaff:false}).ok);
  assert(g.state.officers.includes(id));assert(g.state.officerVariants.includes(id+':SSS'));assert(!g.state.officerVariants.includes(id+':U'));
  assert.equal(E.fromSave(g.exportSave(),officers).officerHealth(id).current,75);
});

test('malformed health cannot introduce unknown people, invalid values or unsafe recovery clocks',()=>{
  const g=fresh(),id=g.state.army[0];
  for(const mutate of [h=>h.version=2,h=>h.asOfElapsedMs=-1,h=>h.asOfElapsedMs=1.5,h=>h.asOfElapsedMs=Number.MAX_SAFE_INTEGER,h=>h.values[id]=-1,h=>h.values[id]=101,h=>h.values[id]='75',h=>h.values[id]=null,h=>h.values.unknown=50,h=>h.values=[]]){
    const raw=save(g);mutate(raw.state.officerHealth);assert.throws(()=>E.fromSave(raw,officers));
  }
  const raw=save(g);delete raw.state.officerHealth.values[id];assert.equal(E.fromSave(raw,officers).officerHealth(id).current,100);
  const original=clone(g.state);const projected=E.projectOfficerHealth(g.state,60000);assert.equal(projected.asOfElapsedMs,60000);assert.deepEqual(g.state,original);
});

console.log(`${count} officer health engine scenarios passed.`);
