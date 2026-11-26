// Exercise the Worker, save revisions and durable battle receipts in local D1.
import assert from 'node:assert/strict';
import {harness,settleFieldMarch,syncFieldWriter} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const clone=value=>structuredClone(value);
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const put=async(h,p,value,expected=200)=>(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected})).data;
const envelope=(h,p,extra={})=>({deviceId:p.deviceId,expectedRevision:row(h,p).revision,requestId:crypto.randomUUID(),...extra});
const health=(h,p)=>save(h,p).state.officerHealth;
const rounded=value=>Math.round(value*6000)/6000;
function setHealth(h,p,value,ids=null){
 updateSave(h,p,s=>{
  s.officerHealth=GameEngine.normalizeOfficerHealth(s.officerHealth,s);
  for(const id of ids||s.officers)s.officerHealth.values[id]=value;
 });
}
async function force(won,run){
 const old=crypto.getRandomValues;
 crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(won?0:0xffffffff):old.call(crypto,value);};
 try{return await run();}finally{crypto.getRandomValues=old;}
}
async function publish(h,op,battleId='history:okehazama'){
 const draft=(await h.api('/admin/events/generate',post(op,{battleId,durationDays:1,requestId:crypto.randomUUID()}))).data.event;
 return (await h.api('/admin/events/'+draft.id+'/publish',post(op,{requestId:crypto.randomUUID()}))).data.event;
}
const eventBody=(h,p,event,extra={})=>envelope(h,p,{stageId:event.plan.stages[0].id,tactic:event.plan.stages[0].recommendedTactic,...extra});
const eventFight=async(h,p,event,body=eventBody(h,p,event),expected=200)=>(await h.api('/events/'+event.id+'/battle',post(p,body,expected))).data;
const attackBody=(h,p,target,extra={})=>envelope(h,p,{targetPlayerId:target.user.id,troops:1000,tactic:'balanced',...extra});
const fieldTarget=async(h,p,viewer)=>(await h.api('/field?limit=100',{token:viewer?.token})).data.players.find(target=>target.playerId===p.user.id);

let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Officer health fixtures must stay local');};
try{
 await scope('legacy saves initialize at full health and reads do not mutate their revision',async h=>{
  const p=await fixture(h,'旧記録の体力');updateSave(h,p,s=>{delete s.officerHealth;});
  const stored=clone(row(h,p)),current=await snapshot(h,p);
  assert(current.save.state.officers.every(id=>current.save.state.officerHealth.values[id]===100));
  assert.deepEqual(clone(row(h,p)),stored);
  const accepted=await put(h,p,current.save);assert.deepEqual(accepted.save.state.officerHealth,current.save.state.officerHealth);
 });

 await scope('new offline health and marching officers migrate to the shared clock before future-anchor checks',async h=>{
  for(const marching of [false,true]){
   const p=await h.session('初回移行'+marching);p.deviceId='health-import-'+p.user.id;
   const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,game=new GameEngine({officers:GAME_OFFICERS,seed:17});
   game.state.turn=100;game.state.realtime.elapsed=0;game.state.officerHealth={version:1,asOfElapsedMs:6000000,values:Object.fromEntries(game.state.officers.map(id=>[id,17]))};
   if(marching)assert(game.departAttack('inuyama','balanced',1000).ok);
   const imported=JSON.parse(game.exportSave()),result=await put(h,p,imported);
   assert.equal(result.save.state.worldClock.elapsedMs,lease.clock.elapsedMs);assert.equal(result.save.state.officerHealth.asOfElapsedMs,lease.clock.elapsedMs);assert(Object.values(health(h,p).values).every(value=>value===17));
   if(marching){assert.equal(result.save.state.march.authority,'server');assert.deepEqual(result.save.state.march.army,imported.state.march.profile.army);}
   else{h.now+=60000;await syncFieldWriter(h,p);assert(Object.values(health(h,p).values).every(value=>value===27));}
  }
  const p=await h.session('未来体力を偽る初回');p.deviceId='future-import';await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  const game=new GameEngine({officers:GAME_OFFICERS,seed:17});game.state.officerHealth.asOfElapsedMs=1;
  assert.equal((await put(h,p,JSON.parse(game.exportSave()),400)).error.code,'INVALID_SAVE');assert.equal(row(h,p).save_json,null);
 });

 await scope('a legacy canonical local-time save is compared after the same clock migration',async h=>{
  const p=await h.session('保存済み時刻の移行');p.deviceId='legacy-clock';await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  const local=h.fresh();local.state.turn=100;local.state.realtime.elapsed=0;delete local.state.worldClock;
  // Simulate a save persisted by the pre-clock service. New uploads now attach
  // every old format to the shared clock before the first write.
  h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(local),p.user.id);
  updateSave(h,p,s=>{s.officerHealth={version:1,asOfElapsedMs:6000000,values:Object.fromEntries(s.officers.map(id=>[id,23]))};});
  const current=await snapshot(h,p),game=GameEngine.fromSave(current.save,GAME_OFFICERS);assert(game.applyWorldClock(current.clock).ok);
  for(const id of game.state.officers)game.state.officerHealth.values[id]=100;
  const attached=await put(h,p,JSON.parse(game.exportSave()));assert(Object.values(attached.save.state.officerHealth.values).every(value=>value===23));assert.equal(attached.save.state.officerHealth.asOfElapsedMs,current.clock.elapsedMs);
  const downgrade=clone(attached.save);delete downgrade.state.worldClock;
  assert.equal((await put(h,p,downgrade,409)).error.code,'CLOCK_ANCHOR_REQUIRED');
 });

 await scope('missing fields, rank changes and writer takeover cannot refill an existing officer',async h=>{
  const p=await fixture(h,'持ち越す体力');setHealth(h,p,37);
  for(const edit of [s=>{delete s.officerHealth;},s=>{s.officerHealth.values={};},s=>{for(const id of s.officers)s.officerHealth.values[id]=100;},s=>{s.officerVariants=[...new Set([...s.officerVariants,s.officers[0]+':SSS'])];}]){
   const imported=save(h,p);edit(imported.state);const result=await put(h,p,imported);
   assert(result.save.state.officers.every(id=>result.save.state.officerHealth.values[id]===37));
  }
  const old=save(h,p);p.deviceId+='-second';
  await h.api('/sync/lease',post(p,{deviceId:p.deviceId,takeOver:true}));delete old.state.officerHealth;
  assert((await put(h,p,old)).save.state.officers.every(id=>health(h,p).values[id]===37));
  const malformed=save(h,p);malformed.state.officerHealth.asOfElapsedMs=999999999;
  assert.equal((await put(h,p,malformed,400)).error.code,'INVALID_SAVE');
  const ahead=save(h,p);ahead.state.officerHealth.asOfElapsedMs+=1;assert.equal((await put(h,p,ahead,400)).error.code,'INVALID_SAVE');
  const futureClock=save(h,p);futureClock.state.worldClock.elapsedMs=5000;futureClock.state.realtime.elapsed=5;
  assert.equal((await put(h,p,futureClock,409)).error.code,'MAINTENANCE_REFRESH_REQUIRED');assert(Object.values(health(h,p).values).every(value=>value===37));assert.equal(health(h,p).asOfElapsedMs,0);
 });

 await scope('a missing exchanged officer regains their canonical health after the receipt restores ownership',async h=>{
  const p=await fixture(h,'交換武将の体力');updateSave(h,p,s=>{s.stats.gachaDraws=40;});
  const older=save(h,p),game=GameEngine.fromSave(older,GAME_OFFICERS),id=game.gachaPool('S').find(o=>!game.state.officers.includes(o.id)).id;
  await h.api('/progress/exchange',post(p,envelope(h,p,{officerId:id,rank:'S'})));setHealth(h,p,22,[id]);
  const result=await put(h,p,older);assert(result.save.state.officers.includes(id));assert.equal(result.save.state.officerHealth.values[id],22);
 });

 await scope('recovery follows game time once, across repeated writes and paused wall time',async h=>{
  const p=await fixture(h,'休息する武将');setHealth(h,p,40);h.now+=30000;
  const first=await syncFieldWriter(h,p);assert(first.save.state.officers.every(id=>health(h,p).values[id]===45));
  await put(h,p,save(h,p));assert(Object.values(health(h,p).values).every(value=>value===45));
  h.now+=30000;await syncFieldWriter(h,p);assert(Object.values(health(h,p).values).every(value=>value===50));
  const at=health(h,p).asOfElapsedMs;h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=0,revision=revision+1').run(at,h.now);
  h.now+=600000;await syncFieldWriter(h,p);assert(Object.values(health(h,p).values).every(value=>value===50));
 });

 await scope('canonical CPU defense replay charges exhaustion once even when an upload claims full health',async h=>{
  const p=await fixture(h,'CPU戦の体力');
  updateSave(h,p,s=>{
   s.turn=8;s.realtime.elapsed=59;s.worldClock.elapsedMs=539000;s.troops=0;s.seed=1;s.treaties={};
   for(const castle of Object.values(s.castles))Object.assign(castle,{owner:'在地衆',troops:100000,wall:1,level:1});
   Object.assign(s.castles.kiyosu,{owner:s.clan,troops:100});s.officerHealth={version:1,asOfElapsedMs:539000,values:Object.fromEntries(s.officers.map(id=>[id,60]))};
  });
  const source=save(h,p),clock={id:'world-v1',elapsedMs:540000,running:true,speed:1};let advanced=null;
  for(let seed=1;seed<1000;seed++){
   source.state.seed=seed;const game=GameEngine.fromSave(source,GAME_OFFICERS);game.applyWorldClock(clock,{maxSeconds:86400,deferCycleSettlement:true});
   if(game.takeHomeDefenseLosses().some(event=>event.castleId==='kiyosu')){advanced=JSON.parse(game.exportSave());break;}
  }
  assert(advanced);h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(source),p.user.id);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=540000,anchor_real_ms=?,revision=revision+1').run(h.now);await snapshot(h,p);
  const expected=clone(advanced.state.officerHealth);for(const id of advanced.state.officers)advanced.state.officerHealth.values[id]=100;
  const result=await put(h,p,advanced);assert.deepEqual(result.save.state.officerHealth,expected);
  const replay=clone(result.save);for(const id of replay.state.officers)replay.state.officerHealth.values[id]=100;
  assert.deepEqual((await put(h,p,replay)).save.state.officerHealth,expected);
 });

 await scope('event wins and defeats consume only participants and receipts survive lost responses',async h=>{
  const op=await fixture(h,'体力イベント運営',{admin:true}),p=await fixture(h,'体力イベント参加者'),event=await publish(h,op);setHealth(h,p,80);
  const initial=save(h,p),army=initial.state.army,firstBody=eventBody(h,p,event),won=await force(true,()=>eventFight(h,p,event,firstBody));
  assert(won.battle.won);for(const id of initial.state.officers)assert.equal(health(h,p).values[id],army.includes(id)?65:80);
  const lost=await force(false,()=>eventFight(h,p,event));assert.equal(lost.battle.won,false);for(const id of army)assert.equal(health(h,p).values[id],40);
  const committed=clone(row(h,p)),replayed=await eventFight(h,p,event,{...firstBody,expectedRevision:0,deviceId:'another-reader'});assert(replayed.idempotent);assert.deepEqual(clone(row(h,p)),committed);
  const request=eventBody(h,p,event);h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO timed_event_requests')&&s.sql.includes("'battle'")))return;h.afterBatch=null;throw Error('Local response lost after event commit');};
  await force(true,()=>eventFight(h,p,event,request,500));const afterLostResponse=clone(row(h,p));
  assert((await eventFight(h,p,event,request)).idempotent);assert.deepEqual(clone(row(h,p)),afterLostResponse);for(const id of army)assert.equal(health(h,p).values[id],25);
 });

 await scope('an event ahead of the ordinary save anchor cannot recover its old interval twice',async h=>{
  const op=await fixture(h,'時刻イベント運営',{admin:true}),p=await fixture(h,'時刻イベント参加者'),event=await publish(h,op);setHealth(h,p,80);
  const old=save(h,p),army=[...old.state.army];h.now+=10000;
  await force(true,()=>eventFight(h,p,event));const after=clone(health(h,p));
  assert.equal(after.asOfElapsedMs,10000);assert.equal(save(h,p).state.worldClock.elapsedMs,0);
  delete old.state.officerHealth;await put(h,p,old);assert.deepEqual(health(h,p),after);
  h.now+=5000;await syncFieldWriter(h,p);for(const id of army)assert.equal(health(h,p).values[id],67.5);
 });

 await scope('public field strength uses the same current health without writing a player save',async h=>{
  const p=await fixture(h,'体力と守備力',{startCastle:'inuyama'}),viewer=await fixture(h,'守備力を見る領主');
  const full=await fieldTarget(h,p,viewer);setHealth(h,p,0);const stored=clone(row(h,p)),tired=await fieldTarget(h,p,viewer);
  assert(Math.abs(tired.defensePower/full.defensePower-.5)<.002);assert.deepEqual(clone(row(h,p)),stored);
  setHealth(h,p,50);const half=await fieldTarget(h,p,viewer);assert(Math.abs(half.defensePower/full.defensePower-.75)<.002);
  h.now+=60000;const rested=await fieldTarget(h,p,viewer);assert(Math.abs(rested.defensePower/full.defensePower-.8)<.002);assert(Object.values(health(h,p).values).every(value=>value===50));
 });

 await scope('field departure freezes officers and strength while a replacement army cannot heal the march',async h=>{
  const p=await fixture(h,'進軍する武将'),target=await fixture(h,'迎え撃つ武将',{startCastle:'inuyama'});setHealth(h,p,40);setHealth(h,target,70);
  const before=save(h,p),army=[...before.state.army],replacement=before.state.officers.find(id=>!army.includes(id));assert(replacement);
  const body=attackBody(h,p,target),departure=(await force(true,()=>h.api('/field/attack',post(p,body)))).data;
  let march=h.sql.prepare('SELECT * FROM battle_marches WHERE id=?').get(departure.march.id),payload=JSON.parse(march.payload_json);
  assert.deepEqual(payload.marker.army,army);assert(army.every(id=>payload.attackProfile.officerHealth.values[id]===40));
  const powers={D:.9,C:.95,B:1,A:1.08,S:1.16,SS:1.25,SSS:1.35,U:1.5};
  const rankPower=Math.round(army.reduce((sum,id)=>sum+Math.max(...Object.entries(powers).map(([rank,power])=>before.state.officerVariants.includes(id+':'+rank)?power:0))*.7,0)/army.length*1000)/1000;
  const expectedAttack=Math.max(1,Math.round(body.troops*(.7+.5*before.state.morale/100)*(1+before.state.tech.discipline*.06+before.state.tech.gunnery*.05)*rankPower));
  // A pre-upgrade durable marker has the snapshot in its payload, not in marker.army.
  delete payload.marker.army;h.sql.prepare('UPDATE battle_marches SET payload_json=? WHERE id=?').run(JSON.stringify(payload),march.id);
  const edited=save(h,p);edited.state.army=[replacement];edited.state.governors=Object.fromEntries(Object.entries(edited.state.governors).filter(([,id])=>id!==replacement));for(const id of army)edited.state.officerHealth.values[id]=100;
  const accepted=await put(h,p,edited);assert.deepEqual(accepted.save.state.march.army,army);for(const id of army)assert.equal(health(h,p).values[id],40);
  const defenderBefore=save(h,target),battle=await settleFieldMarch(h,p,departure);assert.equal(battle.attackPower,expectedAttack);assert(battle.won);
  for(const id of army)assert.equal(health(h,p).values[id],25);
  assert(health(h,p).values[replacement]>40);
  const defended=GameEngine.projectOfficerHealth(defenderBefore.state,battle.occurredElapsedMs);for(const id of defenderBefore.state.army)assert.equal(health(h,target).values[id],rounded(defended.values[id]-25));
  const after=clone(health(h,p));assert((await h.api('/field/attack',post(p,body))).data.idempotent);assert.deepEqual(health(h,p),after);
 });

 await scope('branch defense consumes its assigned commanders and preserves the home army',async h=>{
  const p=await fixture(h,'支城へ攻める領主',{startCastle:'sakamoto'}),target=await fixture(h,'支城の指揮官',{holdings:['nijo']}),initial=save(h,target),commander=initial.state.officers.find(id=>!initial.state.army.includes(id));assert(commander);
  const branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false,commanders:[commander]};
  updateSave(h,target,s=>{s.branches=[clone(branch)];s.governors=Object.fromEntries(Object.entries(s.governors).filter(([,id])=>id!==commander));});setHealth(h,target,80,[commander]);
  h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?)').run(target.user.id,initial.state.walking.campaignId,JSON.stringify({branches:[branch],jobs:[]}),0,h.now);
  const before=save(h,target),body=attackBody(h,p,target,{targetCastleId:'nijo',targetBranchId:branch.id}),departure=(await force(true,()=>h.api('/field/attack',post(p,body)))).data;
  const battle=await settleFieldMarch(h,p,departure);assert.equal(battle.battleMode,'branch');assert(battle.won);
  const expected=GameEngine.projectOfficerHealth(before.state,battle.occurredElapsedMs);assert.equal(health(h,target).values[commander],rounded(expected.values[commander]-25));
  for(const id of before.state.army)assert.equal(health(h,target).values[id],100);
 });

 await scope('staff appointment and return preserve the current officers rather than the old backup health',async h=>{
  const op=await fixture(h,'体力人事運営',{admin:true}),p=await fixture(h,'体力を持ち帰る家臣',{startCastle:'inuyama'});setHealth(h,p,42);
  await h.api('/admin/staff',post(op,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));await snapshot(h,p);
  assert(Object.values(health(h,p).values).every(value=>value===42));setHealth(h,p,19);
  await h.api('/admin/staff',post(op,{targetPlayerId:p.user.id,action:'dismiss',requestId:crypto.randomUUID()}));const returned=await snapshot(h,p);
  assert.equal(returned.save.state.home,'inuyama');assert(returned.save.state.officers.every(id=>returned.save.state.officerHealth.values[id]===19));
 });

 await scope('event reference defenders and Edo reward defenders retain their stored health and revision',async h=>{
  const op=await fixture(h,'体力非更新の江戸',{admin:true}),p=await fixture(h,'参照戦の参加者',{startCastle:'kawagoe'}),target=await fixture(h,'長篠の参照先',{startCastle:'nagashino'}),event=await publish(h,op,'history:nagashino');setHealth(h,target,35);setHealth(h,op,25);
  const targetBefore=clone(row(h,target));await force(true,()=>eventFight(h,p,event));assert.deepEqual(clone(row(h,target)),targetBefore);
  const operatorBefore=clone(row(h,op)),departure=(await force(true,()=>h.api('/field/attack',post(p,attackBody(h,p,op,{targetCastleId:'edo'}))))).data;
  const battle=await settleFieldMarch(h,p,departure);assert.equal(battle.battleMode,'reward');assert.deepEqual(clone(row(h,op)),operatorBefore);
 });
 console.log(JSON.stringify({checks,apiCalls:calls}));
}finally{globalThis.fetch=network;}
