import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const state=(h,p)=>JSON.parse(row(h,p).save_json).state;
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
async function player(h,name,castleId,mode='lord'){
 const p=await h.session(name);p.deviceId='residency-covert-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 const start=(await h.api('/castles/residency/start',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,revision:lease.revision,castleId,mode,clan:'織田家',difficulty:'normal'}))).data;
 assert.equal(start.residency.role,mode);assert.equal(start.save.state.home,castleId);
 return p;
}
function tune(h,p,change){
 const saved=JSON.parse(row(h,p).save_json),game=GameEngine.fromSave(saved,GAME_OFFICERS);
 change(game.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(game.exportSave(),p.user.id);
}
function arm(h,p){tune(h,p,s=>{
 for(const key of Object.keys(s.resources))s.resources[key]=1000000;
 s.buildings.keep=32;s.buildings.barracks=32;s.buildings.wall=32;s.troops=30000;s.command=7;s.seed=1;
 s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;
});}
function weaken(h,p){tune(h,p,s=>{s.troops=10;s.castles[s.home].troops=10;s.castles[s.home].wall=1;s.buildings.wall=1;s.buildings.keep=1;s.army=[];s.seed=1;});}
function body(h,p,extra){const s=state(h,p);return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:s.walking.campaignId,sequence:s.covert.sequence,...extra};}
async function dispatch(h,p,target,{mode='station',count:units=1000}={}){
 await h.api('/covert/hire',post(p,body(h,p,{sourceCastleId:'nijo',count:units})));
 return(await h.api('/covert/dispatch',post(p,body(h,p,{sourceCastleId:'nijo',target:{kind:'player',playerId:target.user.id,castleId:state(h,target).home},count:units,mode})))).data;
}
async function arrive(h,p,march){h.now+=march.remainingMs;return(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;}
async function counterRequest(h,p,target,station){
 const incident='fixture-after-station-'+crypto.randomUUID();
 const clock=(await h.api('/world-clock')).data.clock;
 h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,defender_campaign_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?,?)').run(incident,target.user.id,p.user.id,state(h,p).walking.campaignId,clock.elapsedMs,JSON.stringify({castleId:'nijo'}),h.now);
 tune(h,p,s=>{s.seed=1;});
 await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
 return body(h,p,{stationId:station.id,incidentId:incident});
}
let scenarios=0,calls=0;
async function scope(name,fn){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements)assert(s.params.length<=100,'D1 binding limit: '+s.params.length+' '+s.sql.slice(0,80));return batch(statements);};try{await fn(h);scenarios++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Residency tests must not access the network');};
try{
await scope('covert home defeat promotes the earliest offline retainer once and preserves personal progress',async h=>{
 const lord=await player(h,'防衛する領主','kiyosu'),first=await player(h,'先に仕えた家臣','kiyosu','retainer'),second=await player(h,'次に仕えた家臣','kiyosu','retainer'),attacker=await player(h,'別の城の派遣主','inuyama');
 arm(h,attacker);weaken(h,lord);h.sql.prepare('UPDATE player_saves SET lease_expires_at=0 WHERE user_id=?').run(first.user.id);
 const firstSave=row(h,first).save_json,secondSave=row(h,second).save_json;
 const departure=await dispatch(h,attacker,lord),arrived=await arrive(h,attacker,departure.march),station=arrived.save.state.covert.stations[0];
 const request=await counterRequest(h,attacker,lord,station),result=(await h.api('/covert/retaliate',post(attacker,request))).data;
 assert.equal(result.result.battle.won,true);assert.equal(result.result.battle.succession.lordPlayerId,first.user.id);
 assert.equal(h.sql.prepare('SELECT lord_user_id FROM castle_seats WHERE castle_id=?').get('kiyosu').lord_user_id,first.user.id);
 assert.equal(row(h,first).save_json,firstSave);assert.equal(row(h,second).save_json,secondSave);
 const roster=(await h.api('/castles/residency?castleId=kiyosu',{token:lord.token})).data;
 assert.equal(roster.self.role,'retainer');assert.equal(roster.self.successionPosition,2);
 assert.deepEqual(roster.roster.retainers.map(x=>x.playerId),[second.user.id,lord.user.id]);
 const replay=(await h.api('/covert/retaliate',post(attacker,request))).data;
 assert(replay.idempotent);assert.equal(replay.result.battle.succession.lordPlayerId,first.user.id);
 assert.equal(count(h,'castle_successions'),1);assert.equal(count(h,'covert_battles'),1);
 assert.equal(state(h,attacker).covert.stations.length,1,'surviving stationed troops remain recallable');
});
await scope('same-household dispatch and a forged retainer target are rejected before spending',async h=>{
 const lord=await player(h,'同じ城の領主','kiyosu'),member=await player(h,'同じ城の家臣','kiyosu','retainer'),outsider=await player(h,'隣城の領主','inuyama');
 for(const p of [member,outsider]){arm(h,p);await h.api('/covert/hire',post(p,body(h,p,{sourceCastleId:'nijo',count:100})));}
 const saved=row(h,member).save_json;
 const own=(await h.api('/covert/dispatch',post(member,body(h,member,{sourceCastleId:'nijo',target:{kind:'player',playerId:lord.user.id,castleId:'kiyosu'},count:50,mode:'scout'}),409))).data;
 assert.equal(own.error.code,'HOUSEHOLD_ALLIED');assert.equal(row(h,member).save_json,saved);
 const invalid=(await h.api('/covert/dispatch',post(outsider,body(h,outsider,{sourceCastleId:'nijo',target:{kind:'player',playerId:member.user.id,castleId:'kiyosu'},count:50,mode:'station'}),409))).data;
 assert.equal(invalid.error.code,'RESIDENCY_TARGET_CHANGED');
});
await scope('a different lord taking office during covert travel cancels and refunds that dispatch exactly once',async h=>{
 const lord=await player(h,'交代前の領主','kiyosu'),heir=await player(h,'継ぐ家臣','kiyosu','retainer'),counter=await player(h,'常駐している派遣主','inuyama'),traveler=await player(h,'移動中の派遣主','inabayama');
 arm(h,counter);arm(h,traveler);weaken(h,lord);
 const ready=await dispatch(h,counter,lord),station=(await arrive(h,counter,ready.march)).save.state.covert.stations[0];
 await h.api('/sync/lease',post(traveler,{deviceId:traveler.deviceId}));
 const current=(await h.api('/world-clock')).data.clock;tune(h,traveler,s=>{s.worldClock={id:current.id,elapsedMs:current.elapsedMs};s.turn=Math.floor(current.elapsedMs/60000);s.realtime.elapsed=(current.elapsedMs%60000)/1000;});
 const traveling=await dispatch(h,traveler,lord,{mode:'scout',count:50});
 const receipt=h.sql.prepare('SELECT march_target_residency_json FROM covert_requests WHERE actor_id=? AND request_id=?').get(traveler.user.id,traveling.march.requestId);
 assert.equal(JSON.parse(receipt.march_target_residency_json).lordPlayerId,lord.user.id);
 const request=await counterRequest(h,counter,lord,station),won=(await h.api('/covert/retaliate',post(counter,request))).data;
 assert.equal(won.result.battle.succession.lordPlayerId,heir.user.id);
 const done=await arrive(h,traveler,traveling.march),result=done.history.find(x=>x.id===traveling.march.id);
 assert.equal(result.status,'cancelled');assert.equal(done.save.state.covert.reserves.nijo,50);assert.equal(done.save.state.covert.reports.length,0);
 const again=(await h.api('/marches?deviceId='+traveler.deviceId,{token:traveler.token})).data;
 assert.equal(again.save.state.covert.reserves.nijo,50);assert.equal(count(h,'castle_successions'),1);
});
await scope('covert commit rechecks household friendship and never debits a newly allied participant',async h=>{
 const lord=await player(h,'友好の城主','kiyosu'),actor=await player(h,'入城が競合する領主','inuyama');arm(h,actor);
 await h.api('/covert/hire',post(actor,body(h,actor,{sourceCastleId:'nijo',count:100})));const saved=row(h,actor).save_json;
 h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO covert_requests'))return;h.beforeBatch=null;h.sql.prepare('UPDATE castle_seats SET lord_user_id=NULL,lord_epoch=lord_epoch+1 WHERE lord_user_id=?').run(actor.user.id);h.sql.prepare('UPDATE castle_residents SET castle_id=?,revision=revision+1 WHERE user_id=?').run('kiyosu',actor.user.id);};
 await h.api('/covert/dispatch',post(actor,body(h,actor,{sourceCastleId:'nijo',target:{kind:'player',playerId:lord.user.id,castleId:'kiyosu'},count:50,mode:'scout'}),409));
 assert.equal(row(h,actor).save_json,saved);assert.equal(count(h,'covert_requests'),1,'only prior hiring receipt exists');
});
await scope('a changing first successor rolls back the entire covert battle and retry elects the current first retainer',async h=>{
 const lord=await player(h,'交代競合の領主','kiyosu'),first=await player(h,'離れる家臣','kiyosu','retainer'),second=await player(h,'残る家臣','kiyosu','retainer'),attacker=await player(h,'反撃する領主','inuyama');arm(h,attacker);weaken(h,lord);
 const departure=await dispatch(h,attacker,lord),station=(await arrive(h,attacker,departure.march)).save.state.covert.stations[0],request=await counterRequest(h,attacker,lord,station);
 const actorBefore=row(h,attacker).save_json,defenderBefore=row(h,lord).save_json,mailsBefore=count(h,'mail_campaigns');
 h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO covert_requests'))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(first.user.id);};
 await h.api('/covert/retaliate',post(attacker,request,409));
 assert.equal(row(h,attacker).save_json,actorBefore);assert.equal(row(h,lord).save_json,defenderBefore);assert.equal(count(h,'mail_campaigns'),mailsBefore);assert.equal(count(h,'covert_battles'),0);assert.equal(count(h,'castle_successions'),0);
 const result=(await h.api('/covert/retaliate',post(attacker,request))).data;
 assert.equal(result.result.battle.succession.lordPlayerId,second.user.id);assert.equal(count(h,'castle_successions'),1);
});
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,scenarios,calls,externalRequests:0}));
