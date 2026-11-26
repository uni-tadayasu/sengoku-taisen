import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import worker from './index.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const state=(h,p)=>JSON.parse(row(h,p).save_json).state;
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
async function player(h,name,change=()=>{}){const p=await h.session(name);p.deviceId='device-'+p.user.id;const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,save=h.fresh();save.state.troops=5000;save.state.resources.rice=50000;change(save.state);save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});return p;}
// Public opponents need separate households. Preserve their original starting
// assets while moving the enemy home from Kiyosu to nearby Inuyama (26 seconds).
async function enemy(h,name,change=()=>{}){return player(h,name,s=>{[s.castles.kiyosu,s.castles.inuyama]=[s.castles.inuyama,s.castles.kiyosu];s.home='inuyama';if(s.cycle)s.cycle.home=s.home;change(s);});}
const fieldBody=(h,p,t,extra={})=>({targetPlayerId:t.user.id,targetCastleId:state(h,t).home,deviceId:p.deviceId,expectedRevision:row(h,p).revision,requestId:crypto.randomUUID(),troops:1000,tactic:'balanced',...extra});
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
async function arrive(h,p,m){h.now+=m.remainingMs;return status(h,p);}
let scenarios=0,calls=0;
async function scope(name,fn){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const st of statements)assert(st.params.length<=100,'D1 binding limit: '+st.params.length+' '+st.sql.slice(0,90));return batch(statements);};try{await fn(h);scenarios++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Travel tests must never access the network');};
try{
await scope('field departure escrows everything, short distance arrives exactly once, replay and expired lease are safe',async h=>{
 const p=await player(h,'近距離の領主'),t=await enemy(h,'目標の領主'),before=structuredClone(state(h,p)),defender=structuredClone(state(h,t)),body=fieldBody(h,p,t),accepted=(await h.api('/field/attack',post(p,body))).data;
 assert(accepted.accepted&&accepted.marching);assert.equal(accepted.battle,null);assert.equal(accepted.march.durationMs,26000);assert.equal(count(h,'field_battles'),0);assert.deepEqual(state(h,t),defender);assert.equal(state(h,p).troops,before.troops-body.troops);assert.equal(state(h,p).command,before.command-1);assert.equal(state(h,p).resources.rice,before.resources.rice-450);assert.equal(accepted.save.state.march.authority,'server');
 const duplicate=(await h.api('/field/attack',post(p,body))).data;assert.equal(duplicate.march.id,accepted.march.id);assert(duplicate.idempotent);assert.equal(count(h,'battle_marches'),1);
 h.now+=25999;assert.equal((await status(h,p)).active.length,1);assert.equal(count(h,'field_battles'),0);
 h.sql.prepare('UPDATE player_saves SET lease_expires_at=0 WHERE user_id=?').run(p.user.id);h.now+=1;
 const done=await status(h,p);assert.equal(done.active.length,0);assert.equal(done.history[0].status,'resolved');assert.equal(count(h,'field_battles'),1);assert.equal(done.save.state.march,null);const troops=done.save.state.troops;
 await status(h,p);const replay=(await h.api('/field/attack',post(p,body))).data;assert(replay.battle);assert.equal(count(h,'field_battles'),1);assert.equal(state(h,p).troops,troops);assert.equal(row(h,p).lease_expires_at,0,'trusted arrival does not create a browser lease');
});
await scope('far destinations take longer and offline scheduled settlement continues after writer lease expires',async h=>{
 const p=await player(h,'遠距離の領主'),t=await enemy(h,'遠方の領主',s=>{s.castles.kagoshima.owner=s.clan;s.home='kagoshima';});
 const r=(await h.api('/field/attack',post(p,fieldBody(h,p,t)))).data;assert(r.march.distanceKm>500);assert(r.march.durationMs>250000);
 h.now+=30000;assert.equal((await status(h,p)).active.length,1);h.now+=r.march.durationMs;
 await worker.scheduled({},h.env,{});assert.equal(h.sql.prepare('SELECT status FROM battle_marches WHERE id=?').get(r.march.id).status,'resolved');assert.equal(count(h,'field_battles'),1);const final=await status(h,p);assert.equal(final.active.length,0);assert.equal(final.save.state.worldClock.elapsedMs,final.clock.elapsedMs);
});
await scope('old imported saves cannot erase reservations; a lost target cancels and refunds once',async h=>{
 const p=await player(h,'返還する領主'),t=await enemy(h,'移転する領主'),before=JSON.parse(row(h,p).save_json),r=(await h.api('/field/attack',post(p,fieldBody(h,p,t)))).data;
 const denied=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:r.revision,save:before},expected:409});assert.equal(denied.data.error.code,'ARMY_MARCHING');
 const target=JSON.parse(row(h,t).save_json);target.state.castles.inuyama.owner='斎藤家';target.state.castles.inabayama.owner=target.state.clan;target.state.home='inabayama';h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(target),t.user.id);
 const transit=GameEngine.fromSave(r.save,GAME_OFFICERS);transit.applyWorldClock({...r.clock,elapsedMs:r.march.arrivesAtMs},{maxSeconds:86400,deferCycleSettlement:true});const expectedRice=transit.state.resources.rice+r.save.state.march.foodCost;const done=await arrive(h,p,r.march);assert.equal(done.history[0].status,'cancelled');assert.equal(count(h,'field_battles'),0);assert.equal(done.save.state.troops,before.state.troops);assert.equal(done.save.state.resources.rice,expectedRice);assert.equal(done.save.state.worldClock.elapsedMs,r.march.arrivesAtMs);await status(h,p);assert.equal(state(h,p).troops,before.state.troops);
});
await scope('shared pause freezes remaining distance and accelerated world time reaches arrival sooner',async h=>{
 const p=await player(h,'時計の領主'),t=await enemy(h,'時計の目標'),r=(await h.api('/field/attack',post(p,fieldBody(h,p,t)))).data;
 const clock=(await h.api('/world-clock')).data.clock;h.sql.prepare('UPDATE world_clock SET running=0,base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(clock.elapsedMs,h.now);h.now+=60000;assert.equal((await status(h,p)).active[0].remainingMs,r.march.remainingMs);assert.equal(count(h,'field_battles'),0);
 h.sql.prepare('UPDATE world_clock SET running=1,speed=4,anchor_real_ms=?,revision=revision+1').run(h.now);h.now+=6500;assert.equal((await status(h,p)).history[0].status,'resolved');
});
await scope('online CPU castle battle uses authoritative saved reservation and returns a single arrival receipt',async h=>{
 const p=await player(h,'CPU進軍'),before=structuredClone(state(h,p)),body={kind:'castle',targetId:'inabayama',tactic:'balanced',troops:1000,campaignId:before.walking.campaignId,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision};
 const accepted=(await h.api('/marches/campaign',post(p,body))).data;assert(accepted.marching);assert.equal(accepted.save.state.troops,before.troops-1000);assert.equal(accepted.save.state.stats.battles,before.stats.battles);assert.equal(accepted.save.state.castles.inabayama.owner,before.castles.inabayama.owner);
 const done=await arrive(h,p,accepted.march);assert.equal(done.active.length,0);assert.equal(done.history[0].status,'resolved');assert(done.history[0].battle);assert.equal(done.save.state.stats.battles,before.stats.battles+1);assert.doesNotThrow(()=>GameEngine.fromSave(done.save,GAME_OFFICERS));
 const again=(await h.api('/marches/campaign',post(p,body))).data;assert(again.idempotent);assert.equal(again.battle.won,done.history[0].battle.won);assert.equal(state(h,p).stats.battles,before.stats.battles+1);
});
await scope('roaming pending produces no loot or respawn before arrival and shares the main army lock',async h=>{
 const p=await player(h,'野良進軍'),t=await enemy(h,'別の攻撃先'),d=GameEngine.roamingDeploymentDefaults(),unit=GameEngine.roamingDeploymentSummary(d).castles.flatMap(c=>GameEngine.roamingDeploymentUnits(d,c.castleId)).find(u=>u.encounterId==='road_scouts'),s=state(h,p),body={encounterId:unit.encounterId,unitId:unit.unitId,castleId:unit.castleId,deploymentRevision:d.revision,tactic:'balanced',troops:1000,campaignId:s.walking.campaignId,sequence:0,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision};
 const accepted=(await h.api('/roaming/battle',post(p,body))).data;assert(accepted.marching);assert.equal(count(h,'roaming_battles'),0);assert.equal(count(h,'roaming_unit_cooldowns'),0);assert.equal(state(h,p).roaming.sequence,0);
 const block=await h.api('/field/attack',post(p,fieldBody(h,p,t),409));assert.equal(block.data.error.code,'ARMY_MARCHING');
 const done=await arrive(h,p,accepted.march);assert.equal(done.history[0].status,'resolved');assert.equal(count(h,'roaming_battles'),1);assert.equal(done.save.state.roaming.sequence,1);const again=(await h.api('/roaming/battle',post(p,body))).data;assert(again.idempotent);assert.equal(count(h,'roaming_battles'),1);
});
await scope('covert dispatch keeps intelligence private until arrival, refreshes target state and creates one station',async h=>{
 const p=await player(h,'偵察進軍',s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),t=await enemy(h,'偵察目標');
 const covertBody=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});
 await h.api('/covert/hire',post(p,covertBody({sourceCastleId:'nijo',count:100})));
 const body=covertBody({sourceCastleId:'nijo',target:{kind:'player',playerId:t.user.id,castleId:state(h,t).home},count:40,mode:'station'}),r=(await h.api('/covert/dispatch',post(p,body))).data;
 assert(r.accepted&&r.marching);assert.equal(r.result.report,undefined);assert.equal(r.covert.reports.length,0);assert.equal(r.covert.stations.length,0);assert.equal(r.covert.dispatches[0].authority,'server');assert.equal(r.covert.sources.find(x=>x.castleId==='nijo').reserve,60);
 const preview=GameEngine.fromSave(r.save,GAME_OFFICERS);preview.applyWorldClock({...r.clock,elapsedMs:r.march.arrivesAtMs});assert.equal(preview.state.covert.stations.length,0,'client cannot settle a server dispatch');assert.equal(preview.state.covert.dispatches.length,1);
 const target=JSON.parse(row(h,t).save_json);target.state.resources.gold=1337;h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(target),t.user.id);const targetSaved=row(h,t).save_json;
 const done=await arrive(h,p,r.march);assert.equal(done.active.length,0);assert.equal(done.history.find(x=>x.id===r.march.id).status,'resolved');assert.equal(done.save.state.covert.stations.length,1);assert.equal(done.save.state.covert.reports[0].snapshot.resources.gold,1337);assert.equal(done.save.state.covert.reports[0].observedElapsedMs,r.march.arrivesAtMs);assert.equal(row(h,t).save_json,targetSaved,'scouting does not mutate target');
 const again=(await h.api('/covert/dispatch',post(p,body))).data;assert(again.idempotent);assert.equal(again.marching,false);assert.equal(again.result.report.snapshot.resources.gold,1337);assert.equal(again.save.state.covert.stations.length,1);
 assert.equal((await h.api('/covert',{token:t.token})).data.covert.reports.length,0);
});
await scope('covert target campaign replacement cancels transit and returns reserved units without a report',async h=>{
 const p=await player(h,'偵察帰還',s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),t=await enemy(h,'偵察切替');const body=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});
 await h.api('/covert/hire',post(p,body({sourceCastleId:'nijo',count:100})));const r=(await h.api('/covert/dispatch',post(p,body({sourceCastleId:'nijo',target:{kind:'player',playerId:t.user.id,castleId:state(h,t).home},count:50,mode:'scout'})))).data;
 const target=JSON.parse(row(h,t).save_json);target.state.walking.campaignId='replaced-target-campaign';delete target.state.covert;delete target.state.roaming;h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(target),t.user.id);
 const done=await arrive(h,p,r.march);assert.equal(done.history[0].status,'cancelled');assert.equal(done.save.state.covert.dispatches.length,0);assert.equal(done.save.state.covert.reserves.nijo,100);assert.equal(done.save.state.covert.reports.length,0);await status(h,p);assert.equal(state(h,p).covert.reserves.nijo,100);
});
await scope('rally escrow remains locked in transit and surviving units return to each contributor',async h=>{
 const p=await player(h,'集結主将'),ally=await player(h,'集結仲間'),t=await enemy(h,'集結目標');const guild=(await h.api('/guild',post(p,{name:'進軍同盟'}))).data.guild.id;await h.api('/guild/join',post(ally,{guildId:guild}));
 const cmd=async(actor,path,extra,expected=200)=>(await h.api('/alliance/'+path,post(actor,{requestId:crypto.randomUUID(),deviceId:actor.deviceId,expectedRevision:row(h,actor).revision,...extra},expected))).data;
 const op=(await cmd(p,'operations/create',{kind:'attack',title:'進軍試験',note:'到着後に戦う',targetPlayerId:t.user.id,castleId:state(h,t).home,tactic:'balanced',startsAt:h.now,expiresAt:h.now+60000})).result.operationId;
 const a=(await cmd(p,'rally/join',{operationId:op,troops:1000})).result.unitId,b=(await cmd(ally,'rally/join',{operationId:op,troops:1500})).result.unitId,standing=state(h,p).troops;
 assert.equal((await h.api('/alliance',{token:p.token})).data.operations[0].troops,0);h.now+=15000;
 const r=await cmd(p,'rally/launch',{operationId:op});assert(r.marching);assert.equal(r.battle,null);assert.equal(state(h,p).troops,standing);assert.equal(count(h,'field_battles'),0);
 const view=(await h.api('/alliance',{token:ally.token})).data;assert.equal(view.operations[0].march.id,r.march.id);assert.equal(view.units.find(u=>u.id===b).state,'marching');assert.equal((await cmd(ally,'units/recall',{unitId:b},409)).error.code,'ARMY_MARCHING');await cmd(p,'operations/cancel',{operationId:op},409);
 const done=await arrive(h,p,r.march);assert.equal(done.history[0].status,'resolved');assert.equal(state(h,p).troops,standing);const battle=done.history[0].battle,units=h.sql.prepare('SELECT * FROM alliance_units WHERE id IN (?,?)').all(a,b);assert.equal(units.reduce((n,u)=>n+u.troops,0)+battle.attackerLost+(battle.capture?.garrison||0),2500);assert(units.every(u=>u.march_id===null&&['returning','claimed'].includes(u.state)));assert.equal(h.sql.prepare('SELECT status FROM alliance_operations WHERE id=?').get(op).status,'completed');
});
await scope('arrival commit races and transactional failures leave escrow pending and retry exactly once',async h=>{
 const p=await player(h,'競合進軍'),t=await enemy(h,'競合目標'),r=(await h.api('/field/attack',post(p,fieldBody(h,p,t)))).data;h.now+=r.march.durationMs;
 h.beforeBatch=statements=>{if(statements.some(st=>st.sql.includes('INSERT INTO field_requests'))){h.beforeBatch=null;h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(p.user.id);}};
 const race=await status(h,p);assert.equal(race.active.length,1);assert.equal(count(h,'field_battles'),0);assert.equal(state(h,p).troops,4000);
 h.beforeBatch=statements=>{if(statements.some(st=>st.sql.includes('INSERT INTO field_requests'))){h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_travel_fixture SET invalid=1'));}};
 const fault=await status(h,p);assert.equal(fault.active.length,1);assert.equal(count(h,'field_battles'),0);assert.equal(state(h,p).troops,4000);
 const results=await Promise.all([status(h,p),status(h,p)]);assert(results.every(v=>v.active.length===0));assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);
});
await scope('offline saved CPU departure is promoted once without spending its reservation twice',async h=>{
 const p=await player(h,'持ち込む進軍'),before=JSON.parse(row(h,p).save_json),local=GameEngine.fromSave(before,GAME_OFFICERS),r=local.departAttack('inabayama','balanced',1000);assert(r.ok);const imported=JSON.parse(local.exportSave()),request={deviceId:p.deviceId,revision:row(h,p).revision,save:imported};
 const synced=(await h.api('/sync',{method:'PUT',token:p.token,body:request})).data;assert.equal(synced.save.state.troops,4000);assert.equal(synced.save.state.march.authority,'server');assert.equal(count(h,'battle_marches'),1);
 const pending=(await status(h,p)).active[0],done=await arrive(h,p,pending);assert.equal(done.history[0].status,'resolved');assert.equal(done.save.state.stats.battles,1);
 await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));const beforeReplay={save:row(h,p).save_json,revision:row(h,p).revision,marches:h.sql.prepare('SELECT * FROM battle_marches ORDER BY id').all()};
 const replay=await h.api('/sync',{method:'PUT',token:p.token,body:{...request,revision:row(h,p).revision},expected:409});assert.equal(replay.data.error.code,'CLOCK_REWIND');assert.equal(count(h,'battle_marches'),1);
 assert.deepEqual({save:row(h,p).save_json,revision:row(h,p).revision,marches:h.sql.prepare('SELECT * FROM battle_marches ORDER BY id').all()},beforeReplay,'Replaying an old anchor changes no saved marker, resources, revision or arrival receipt');
});
await scope('field branch targets remain intact throughout travel and fall only on a winning arrival',async h=>{
 const p=await player(h,'支城へ進軍'),t=await enemy(h,'支城守備',s=>{s.castles.nijo.owner=s.clan;});const branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false},target=JSON.parse(row(h,t).save_json);target.state.branches=[branch];h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(target),t.user.id);h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(actor_id,campaign_id) DO UPDATE SET state_json=excluded.state_json,sequence=sequence+1').run(t.user.id,target.state.walking.campaignId,JSON.stringify({branches:[branch],jobs:[]}),h.now);
 const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(0):old.call(crypto,value);};let r;try{r=(await h.api('/field/attack',post(p,fieldBody(h,p,t,{targetCastleId:'nijo',targetBranchId:'nijo_north'})))).data;}finally{crypto.getRandomValues=old;}
 assert(r.marching);assert.equal(state(h,t).branches[0].fallen,false);assert.equal(count(h,'field_battles'),0);assert.equal(r.march.travel.branchDirection,'north');const done=await arrive(h,p,r.march);assert.equal(done.history[0].status,'resolved');assert.equal(done.history[0].battle.branchFallen,true);assert.equal(state(h,t).branches[0].fallen,true);assert.equal(state(h,t).castles.nijo.owner,target.state.clan);assert.equal(done.history[0].battle.capture.captured,false);
});
await scope('roaming deployment changes cancel arrivals and preserve unclaimed unit cooldowns',async h=>{
 const p=await player(h,'配置変更待ち'),d=GameEngine.roamingDeploymentDefaults(),u=GameEngine.roamingDeploymentSummary(d).castles.flatMap(c=>GameEngine.roamingDeploymentUnits(d,c.castleId))[0],s=state(h,p),body={encounterId:u.encounterId,unitId:u.unitId,castleId:u.castleId,deploymentRevision:d.revision,tactic:'balanced',troops:1000,campaignId:s.walking.campaignId,sequence:0,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision},r=(await h.api('/roaming/battle',post(p,body))).data;
 h.sql.exec('UPDATE roaming_deployment SET revision=revision+1');const done=await arrive(h,p,r.march);assert.equal(done.history[0].status,'cancelled');assert.equal(done.save.state.troops,5000);assert.equal(count(h,'roaming_battles'),0);assert.equal(count(h,'roaming_unit_cooldowns'),0);
});
await scope('legacy field requests pin their originally selected home through delayed arrival',async h=>{
 const p=await player(h,'旧版の出陣'),t=await enemy(h,'旧版の目標'),body=fieldBody(h,p,t);delete body.targetCastleId;const r=(await h.api('/field/attack',post(p,body))).data;assert(r.marching);const done=await arrive(h,p,r.march);assert.equal(done.history[0].status,'resolved');assert.equal(done.history[0].battle.castleId,'inuyama');assert.equal((await h.api('/field/attack',post(p,body))).data.battle.id,done.history[0].battle.id);
});
await scope('an unanchored first cloud import preserves one fixed arrival deadline and settles offline',async h=>{
 const p=await h.session('未同期の進軍');p.deviceId='unanchored-device';await h.api('/world-clock');h.now+=3600000;const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,local=GameEngine.fromSave(h.fresh(),GAME_OFFICERS);delete local.state.worldClock;assert(local.departAttack('inabayama','balanced',1000).ok);const imported=JSON.parse(local.exportSave());
 const saved=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:imported}})).data;assert.equal(saved.save.state.worldClock.elapsedMs,lease.clock.elapsedMs);assert(saved.save.state.march.arrivesElapsedMs>lease.clock.elapsedMs);const pending=(await status(h,p)).active[0];h.now+=1000;assert.equal((await status(h,p)).active[0].arrivesAtMs,pending.arrivesAtMs);h.now+=pending.durationMs;await worker.scheduled({},h.env,{});assert.equal(h.sql.prepare('SELECT status FROM battle_marches').get().status,'resolved');
});
await scope('a covert dispatch from an earlier world cycle cancels offline without requiring a browser lease',async h=>{
 const p=await player(h,'周回派遣',s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),body=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});await h.api('/covert/hire',post(p,body({sourceCastleId:'nijo',count:100})));const r=(await h.api('/covert/dispatch',post(p,body({sourceCastleId:'nijo',target:{kind:'castle',castleId:'osaka'},count:50,mode:'scout'})))).data;
 h.now+=672*60000;await worker.scheduled({},h.env,{});const canonical=JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=?').get(p.user.id).state_json);assert.equal(canonical.dispatches.length,0);assert.equal(canonical.history.find(x=>x.requestId===r.result.requestId).status,'cancelled');assert.equal(canonical.reserves.nijo,100);assert.equal(canonical.reports.length,0);await worker.scheduled({},h.env,{});assert.equal(JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=?').get(p.user.id).state_json).reserves.nijo,100);
});
await scope('field capture credits loot after journey income and freezes the departing combat profile',async h=>{
 const p=await player(h,'到着前後の兵糧'),t=await enemy(h,'到着後の城',s=>{s.castles.nijo={owner:s.clan,troops:10,wall:1,level:1};}),before=state(h,p),body=fieldBody(h,p,t,{targetCastleId:'nijo'});const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(0):old.call(crypto,value);};let accepted;try{accepted=(await h.api('/field/attack',post(p,body))).data;}finally{crypto.getRandomValues=old;}
 const altered=JSON.parse(row(h,p).save_json);altered.state.morale=0;altered.state.army=[];h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(altered),p.user.id);const transit=GameEngine.fromSave(altered,GAME_OFFICERS);transit.applyWorldClock({...accepted.clock,elapsedMs:accepted.march.arrivesAtMs},{maxSeconds:86400,deferCycleSettlement:true});assert.notEqual(transit.state.castles.nijo.owner,transit.state.clan);
 const done=await arrive(h,p,accepted.march),battle=done.history[0].battle;assert(battle.capture.captured);assert.equal(done.save.state.worldClock.elapsedMs,accepted.march.arrivesAtMs);assert.equal(done.save.state.turn,Math.floor(accepted.march.arrivesAtMs/60000));assert.equal(battle.analysis.morale,before.morale);for(const key of ['gold','rice','wood','stone'])assert.equal(done.save.state.resources[key],transit.state.resources[key]+battle.loot[key]+battle.rewards[key]);const game=GameEngine.fromSave(done.save,GAME_OFFICERS),after=structuredClone(game.state);game.applyWorldClock(done.clock);assert.deepEqual(game.state,after,'refresh cannot replay journey with a newly captured castle');
});
await scope('troops already stationed at their target retaliate without a second geographical journey',async h=>{
 const p=await player(h,'常駐からの反撃',s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),t=await enemy(h,'常駐相手'),body=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});await h.api('/covert/hire',post(p,body({sourceCastleId:'nijo',count:100})));const r=(await h.api('/covert/dispatch',post(p,body({sourceCastleId:'nijo',target:{kind:'player',playerId:t.user.id,castleId:state(h,t).home},count:50,mode:'station'})))).data,arrived=await arrive(h,p,r.march),station=arrived.save.state.covert.stations[0];assert(station);const incident='fixture-incoming-after-arrival';h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,defender_campaign_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?,?)').run(incident,t.user.id,p.user.id,state(h,p).walking.campaignId,arrived.clock.elapsedMs,JSON.stringify({castleId:'nijo'}),h.now);await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));const counter=(await h.api('/covert/retaliate',post(p,body({stationId:station.id,incidentId:incident})))).data;assert(counter.result.battle);assert.equal(counter.marching,undefined);assert.equal(counter.save.state.covert.dispatches.length,0);assert.equal(count(h,'covert_battles'),1);
});
await scope('scout returns stay reserved, survive target disappearance and settle once without a writer lease',async h=>{
 const p=await player(h,'復路の偵察隊',s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),t=await enemy(h,'偵察後に不在の領主');
 const body=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});
 await h.api('/covert/hire',post(p,body({sourceCastleId:'nijo',count:100})));
 const request=body({sourceCastleId:'nijo',target:{kind:'player',playerId:t.user.id,castleId:state(h,t).home},count:40,mode:'scout'}),departure=(await h.api('/covert/dispatch',post(p,request))).data;
 const arrived=await arrive(h,p,departure.march),back=arrived.active.find(m=>m.id===departure.march.id);
 assert.equal(back.phase,'returning');assert.equal(back.sourceCastleId,'inuyama');assert.equal(back.targetCastleId,'nijo');assert.equal(arrived.save.state.covert.reserves.nijo,60);assert.equal(arrived.save.state.covert.reports.length,1);
 const replay=(await h.api('/covert/dispatch',post(p,request))).data;assert(replay.idempotent&&replay.marching);assert.equal(replay.result.foodCost,departure.result.foodCost);assert.equal(replay.result.commandCost,1);assert(replay.result.report);
 // Compact save history may roll over while a long return is still underway.
 // Its durable request receipt must retain the original cost and intelligence.
 h.sql.prepare("UPDATE player_saves SET save_json=json_set(save_json,'$.state.covert.history',json('[]')) WHERE user_id=?").run(p.user.id);
 h.sql.prepare("UPDATE covert_states SET state_json=json_set(state_json,'$.history',json('[]')) WHERE actor_id=?").run(p.user.id);
 h.sql.prepare('UPDATE player_saves SET save_json=NULL WHERE user_id=?').run(t.user.id);h.sql.prepare('UPDATE player_saves SET lease_expires_at=0 WHERE user_id=?').run(p.user.id);
 h.now+=back.remainingMs-1;assert.equal((await status(h,p)).active.find(m=>m.id===back.id).phase,'returning');assert.equal(state(h,p).covert.reserves.nijo,60);
 h.now++;await worker.scheduled({},h.env,{});const done=await status(h,p);assert.equal(done.active.length,0);assert.equal(done.save.state.covert.reserves.nijo,100);assert.equal(done.save.state.covert.reports.length,1);assert.equal(row(h,p).lease_expires_at,0);
 const finished=(await h.api('/covert/dispatch',post(p,request))).data;assert(finished.idempotent);assert.equal(finished.march.status,'resolved');assert.equal(finished.result.foodCost,departure.result.foodCost);assert.equal(finished.result.commandCost,1);assert.equal(finished.result.createdElapsedMs,departure.result.createdElapsedMs);assert.equal(finished.result.report.snapshot.garrison,replay.result.report.snapshot.garrison);await status(h,p);assert.equal(state(h,p).covert.reserves.nijo,100);
});
await scope('a delayed offline scout sweep completes both legs against the original travel deadline',async h=>{
 const p=await player(h,'留守中の往復',s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),body=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});
 await h.api('/covert/hire',post(p,body({sourceCastleId:'nijo',count:100})));const request=body({sourceCastleId:'nijo',target:{kind:'castle',castleId:'osaka'},count:40,mode:'scout'}),departure=(await h.api('/covert/dispatch',post(p,request))).data;
 h.now+=departure.march.durationMs*2+1000;await worker.scheduled({},h.env,{});
 const canonical=JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=?').get(p.user.id).state_json);assert.equal(canonical.dispatches.length,0);assert.equal(canonical.reserves.nijo,100);assert.equal(canonical.reports.length,1);assert.equal(canonical.history[0].status,'resolved');assert.equal(canonical.history[0].march.arrivesElapsedMs,departure.march.arrivesAtMs+departure.march.durationMs);
 await worker.scheduled({},h.env,{});assert.equal(JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=?').get(p.user.id).state_json).reserves.nijo,100);
});
await scope('older long covert journeys cannot starve a later short journey in the bounded background sweep',async h=>{
 await h.api('/world-clock');const long=[];let short;
 for(let i=0;i<14;i++){
  h.now++;const p=await player(h,'派遣順序'+i,s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;}),body=extra=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:state(h,p).walking.campaignId,sequence:state(h,p).covert.sequence,...extra});await h.api('/covert/hire',post(p,body({sourceCastleId:'nijo',count:10})));const departure=(await h.api('/covert/dispatch',post(p,body({sourceCastleId:'nijo',target:{kind:'castle',castleId:i<13?'kagoshima':'nijo'},count:5,mode:'scout'})))).data;
  if(i<13){assert(departure.march.durationMs>15000);long.push(p);}else{assert.equal(departure.march.durationMs,15000);short=p;}
 }
 h.now+=15000;await worker.scheduled({},h.env,{});
 const canonical=p=>JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=?').get(p.user.id).state_json);
 assert.equal(canonical(short).dispatches.length,1);assert.equal(canonical(short).dispatches[0].phase,'returning');assert.equal(canonical(short).reports.length,1);assert.equal(canonical(short).history[0].status,'marching');assert(long.every(p=>canonical(p).dispatches.length===1),'long journeys must remain pending without occupying the due work budget');h.now+=15000;await worker.scheduled({},h.env,{});assert.equal(canonical(short).dispatches.length,0);assert.equal(canonical(short).history[0].status,'resolved');
});
console.log(`${scenarios} durable travel scenarios passed (${calls} isolated HTTP requests).`);
}finally{globalThis.fetch=originalFetch;}
