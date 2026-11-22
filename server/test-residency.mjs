import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {RESIDENCY_CASTLES} from './residency.js';

const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const seat=(h,id='kiyosu')=>h.sql.prepare('SELECT * FROM castle_seats WHERE castle_id=?').get(id);
const member=(h,p)=>h.sql.prepare('SELECT * FROM castle_residents WHERE user_id=?').get(p.user.id);
const count=(h,t)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+t).get().n;
async function account(h,name){const p=await h.session(name);p.deviceId='residency-'+p.user.id;await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));return p;}
function startBody(h,p,castleId,mode='lord'){return{deviceId:p.deviceId,revision:row(h,p).revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'};}
async function player(h,name,castleId='kiyosu',mode='lord'){const p=await account(h,name);p.admissionBody=startBody(h,p,castleId,mode);p.initial=(await h.api('/castles/residency/start',post(p,p.admissionBody))).data;return p;}
function tune(h,p,change){const game=GameEngine.fromSave(save(h,p),GAME_OFFICERS);change(game.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(game.exportSave(),p.user.id);}
async function upload(h,p,data,expected=200){return(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:data},expected})).data;}
async function directory(h,p,query=''){return(await h.api('/castles/residency'+query,{token:p?.token})).data;}
function legacy(h,id,castleId,{created=0,dead=false}={}){const game=new GameEngine({officers:GAME_OFFICERS,clan:'織田家',startCastle:castleId,seed:1});game.state.worldClock={id:'world-v1',elapsedMs:0};game.state.gameOver=dead;h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,id,id,'織田家',id,created,h.now);h.sql.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at,cycle_index,cycle_home) VALUES(?,?,1,?,0,?)').run(id,game.exportSave(),h.now,castleId);return h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(id).save_json;}
function weakHome(h,p){
 tune(h,p,s=>{s.home='kiyosu';s.cycle.home='kiyosu';s.turn=8;s.realtime.elapsed=59;s.worldClock={id:'world-v1',elapsedMs:539000};s.troops=0;s.gameOver=false;s.army=[];s.seed=1;for(const c of Object.values(s.castles))Object.assign(c,{owner:'在地衆',troops:100000,wall:1,level:1});Object.assign(s.castles.kiyosu,{owner:s.clan,troops:100});});
 // Find a deterministic engine seed that defeats this normalized weak home.
 const source=save(h,p);let found=false;
 for(let seed=1;seed<1000;seed++){source.state.seed=seed;const game=GameEngine.fromSave(source,GAME_OFFICERS);game.applyWorldClock({id:'world-v1',elapsedMs:540000,running:true,speed:1},{maxSeconds:86400,deferCycleSettlement:true});if(game.takeHomeDefenseLosses().some(e=>e.castleId==='kiyosu')){found=true;break;}}
 assert(found,'weak home must have a reproducible actual CPU defense loss');h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(source),p.user.id);
 h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=539000,anchor_real_ms=?,revision=revision+1').run(h.now);return source;
}
function advanceCpu(h,p){const game=GameEngine.fromSave(save(h,p),GAME_OFFICERS);h.now+=1000;game.applyWorldClock({id:'world-v1',elapsedMs:540000,running:true,speed:1},{maxSeconds:86400,deferCycleSettlement:true});assert(game.takeHomeDefenseLosses().some(e=>e.castleId==='kiyosu'));return JSON.parse(game.exportSave());}
async function attack(h,p,t){tune(h,p,s=>{s.troops=10000;s.resources.rice=100000;s.buildings.keep=32;s.buildings.barracks=32;s.command=7;s.morale=100;});tune(h,t,s=>{s.troops=10;s.castles[s.home].troops=10;s.castles[s.home].wall=1;s.buildings.wall=1;s.buildings.keep=1;s.army=[];});const body={deviceId:p.deviceId,expectedRevision:row(h,p).revision,requestId:crypto.randomUUID(),targetPlayerId:t.user.id,targetCastleId:save(h,t).state.home,troops:5000,tactic:'assault'},original=crypto.getRandomValues;crypto.getRandomValues=function(v){return v instanceof Uint32Array&&v.length===1?v.fill(0):original.call(crypto,v);};try{return{body,data:(await h.api('/field/attack',post(p,body))).data};}finally{crypto.getRandomValues=original;}}
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
let scenarios=0,calls=0;
async function scope(name,fn){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements)assert(s.params.length<=100,'D1 binding limit: '+s.params.length+' '+s.sql.slice(0,80));return batch(statements);};try{await fn(h);scenarios++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Residency tests must never access the network');};
try{
await scope('admission is canonical, idempotent after later saves, preserves FIFO on restart, and hides retainers from field homes',async h=>{
 const lord=await player(h,'領主'),first=await player(h,'先着家臣','kiyosu','retainer'),second=await player(h,'後着家臣','kiyosu','retainer'),neighbor=await player(h,'隣城','inuyama'),order=member(h,first).join_order;
 const initialEpoch=seat(h).lord_epoch;assert.equal(first.initial.residency.successionPosition,1);assert.equal(second.initial.residency.successionPosition,2);
 const incoming=save(h,first);incoming.state.resources.gold+=1;await upload(h,first,incoming);
 const replay=(await h.api('/castles/residency/start',post(first,first.admissionBody))).data;assert(replay.admission.idempotent);assert.equal(replay.save.state.resources.gold,incoming.state.resources.gold);assert.equal(member(h,first).join_order,order);
 await h.api('/castles/residency/start',post(first,startBody(h,first,'kiyosu','retainer')));assert.equal(member(h,first).join_order,order);assert.equal(seat(h).lord_epoch,initialEpoch);
 const d=await directory(h,first,'?castleId=kiyosu&limit=1');assert.equal(d.roster.total,2);assert.equal(d.roster.retainers[0].playerId,first.user.id);assert(d.roster.nextCursor);assert.equal((await directory(h,first,'?castleId=kiyosu&cursor='+d.roster.nextCursor)).roster.retainers[0].playerId,second.user.id);
 const f=(await h.api('/field',{token:first.token})).data;assert.deepEqual(new Set(f.players.map(x=>x.playerId)),new Set([lord.user.id,neighbor.user.id]));assert.equal(f.players.find(x=>x.playerId===lord.user.id).attackable,false);
 assert.equal((await h.api('/field/me',{token:first.token})).data.residency.successionPosition,1);
 const denied=(await h.api('/field/attack',post(first,{deviceId:first.deviceId,expectedRevision:row(h,first).revision,requestId:crypto.randomUUID(),targetPlayerId:lord.user.id,targetCastleId:'kiyosu',troops:300,tactic:'balanced'},409))).data;assert.equal(denied.error.code,'HOUSEHOLD_ALLIED');assert.equal(count(h,'battle_marches'),0);
});
await scope('the last of 124 seats has one atomic winner and full castles still accept FIFO retainers',async h=>{
 for(const c of RESIDENCY_CASTLES.filter(c=>c.id!=='kiyosu'))legacy(h,'legacy-'+c.id,c.id);
 const a=await account(h,'最後の席A'),b=await account(h,'最後の席B'),before=await directory(h);assert.equal(before.capacity,124);assert.equal(before.occupied,123);assert(!before.full);
 const outcomes=await Promise.all([a,b].map(p=>h.api('/castles/residency/start',post(p,startBody(h,p,'kiyosu'),null))));assert.deepEqual(outcomes.map(x=>x.response.status).sort(),[200,409]);const loser=outcomes[0].response.status===409?a:b;assert.equal(row(h,loser).save_json,null);
 const all=await directory(h);assert(all.full);assert.equal(all.occupied,124);assert(!all.castles.some(c=>['edo','kyoto_gosho','nijo','osaka','nagoya'].includes(c.castleId)));
 const joined=(await h.api('/castles/residency/start',post(loser,startBody(h,loser,'kiyosu','retainer')))).data;assert.equal(joined.residency.successionPosition,1);assert.equal(count(h,'castle_residents'),125);
});
await scope('legacy duplicate migration is deterministic, skips a defeated incumbent, and preserves every personal save',async h=>{
 const dead=legacy(h,'legacy-a','kiyosu',{created:1,dead:true}),first=legacy(h,'legacy-b','kiyosu',{created:2}),second=legacy(h,'legacy-c','kiyosu',{created:2});
 const d=await directory(h,null,'?castleId=kiyosu');assert.equal(d.roster.lord.playerId,'legacy-b');assert.deepEqual(d.roster.retainers.map(r=>[r.playerId,r.successionPosition]),[['legacy-a',null],['legacy-c',1]]);
 for(const [id,original] of [['legacy-a',dead],['legacy-b',first],['legacy-c',second]])assert.equal(h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(id).save_json,original);
 await directory(h);assert.equal(count(h,'castle_residents'),3);assert.equal(seat(h).lord_epoch,1);
});
await scope('a winning field home defense defeat promotes an offline first retainer, appends the lord, and replays once',async h=>{
 const lord=await player(h,'敗れた領主'),first=await player(h,'最古の家臣','kiyosu','retainer'),second=await player(h,'次の家臣','kiyosu','retainer'),attacker=await player(h,'攻撃側','inuyama');h.sql.prepare('UPDATE player_saves SET lease_expires_at=0 WHERE user_id=?').run(first.user.id);const firstSave=row(h,first).save_json,secondSave=row(h,second).save_json;
 const departure=await attack(h,attacker,lord);h.now+=departure.data.march.remainingMs;const done=await status(h,attacker),battle=done.history[0].battle;assert(battle.won);assert.equal(battle.succession.lordPlayerId,first.user.id);assert.equal(seat(h).lord_user_id,first.user.id);assert.equal(row(h,first).save_json,firstSave);assert.equal(row(h,second).save_json,secondSave);
 const d=await directory(h,lord,'?castleId=kiyosu');assert.deepEqual(d.roster.retainers.map(r=>r.playerId),[second.user.id,lord.user.id]);assert.equal(d.self.successionPosition,2);
 const replay=(await h.api('/field/attack',post(attacker,departure.body))).data;assert.equal(replay.battle.id,battle.id);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'castle_successions'),1);assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM mail_campaigns WHERE request_id LIKE 'system:succession:%'").get().n,2);
});
await scope('a first retainer joining at battle commit retries the complete battle instead of losing the succession',async h=>{
 const lord=await player(h,'家臣到着前の領主'),attacker=await player(h,'競合の攻撃側','inuyama'),newcomer=await account(h,'到着する家臣'),join=startBody(h,newcomer,'kiyosu','retainer');const departure=await attack(h,attacker,lord);h.now+=departure.data.march.remainingMs;
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.beforeBatch=null;await h.api('/castles/residency/start',post(newcomer,join));};
 const pending=await status(h,attacker);assert.equal(pending.active.length,1);assert.equal(count(h,'field_battles'),0);assert.equal(count(h,'castle_successions'),0);const done=await status(h,attacker);assert.equal(done.history[0].battle.succession.lordPlayerId,newcomer.user.id);assert.equal(count(h,'castle_successions'),1);
});
await scope('uploaded loss, fake event, moved home and same-home defeated restart cannot forge succession or hide a lord',async h=>{
 const lord=await player(h,'改ざんを防ぐ領主'),heir=await player(h,'待つ家臣','kiyosu','retainer'),originalOrder=member(h,heir).join_order;
 const forged=save(h,lord);forged.state.home='inuyama';forged.state.castles.kiyosu.owner='在地衆';forged.state.castles.inuyama.owner=forged.state.clan;forged.state.gameOver=true;forged.state.homeDefenseLosses=[{kind:'cpu',castleId:'kiyosu',occurredElapsedMs:999999,id:'forged'}];forged.state.residency={role:'retainer',join_order:0};
 const fixed=await upload(h,lord,forged);assert.equal(fixed.save.state.home,'kiyosu');assert.equal(fixed.save.state.cycle.home,'kiyosu');assert.equal(row(h,lord).cycle_home,'kiyosu');assert(!fixed.save.state.gameOver);assert.equal(fixed.save.state.castles.kiyosu.owner,fixed.save.state.clan);assert.equal(seat(h).lord_user_id,lord.user.id);assert.equal(member(h,heir).join_order,originalOrder);assert.equal(count(h,'castle_successions'),0);
 const next=JSON.parse(new GameEngine({officers:GAME_OFFICERS,clan:'織田家',startCastle:'kiyosu'}).exportSave());next.state.worldClock=save(h,lord).state.worldClock;next.state.gameOver=true;next.state.castles.kiyosu.owner='在地衆';const fixedNew=await upload(h,lord,next);assert.equal(fixedNew.save.state.home,'kiyosu');assert.equal(fixedNew.save.state.gameOver,false);assert.equal(seat(h).lord_user_id,lord.user.id);
 const moved=JSON.parse(new GameEngine({officers:GAME_OFFICERS,clan:'織田家',startCastle:'inuyama'}).exportSave());moved.state.worldClock=save(h,lord).state.worldClock;assert.equal((await upload(h,lord,moved,409)).error.code,'RESIDENCY_HOME_CHANGED');assert.equal(member(h,lord).castle_id,'kiyosu');
});
await scope('trusted CPU replay from the committed checkpoint promotes FIFO and preserves the heir private campaign',async h=>{
 const lord=await player(h,'CPU守備'),heir=await player(h,'CPU継承','kiyosu','retainer'),heirBefore=row(h,heir).save_json;weakHome(h,lord);const advanced=advanceCpu(h,lord),done=await upload(h,lord,advanced);
 assert.equal(seat(h).lord_user_id,heir.user.id);assert.equal(done.residency.role,'retainer');assert.equal(row(h,heir).save_json,heirBefore);assert.equal(count(h,'castle_successions'),1);assert.equal(h.sql.prepare('SELECT kind FROM castle_successions').get().kind,'cpu');assert.equal(done.save.state.gameOver,true);assert.equal(done.residency.eligible,false);
 const again=await upload(h,lord,done.save);assert.equal(again.residency.role,'retainer');assert.equal(count(h,'castle_successions'),1);assert.equal(h.sql.prepare("SELECT COUNT(*) AS n FROM mail_campaigns WHERE request_id LIKE 'system:succession:%'").get().n,2);
});
await scope('a CPU loss without an eligible retainer vacates the seat while preserving the defeated affiliation',async h=>{
 const lord=await player(h,'家臣なしCPU');weakHome(h,lord);const done=await upload(h,lord,advanceCpu(h,lord));assert.equal(seat(h).lord_user_id,null);assert.equal(done.residency.role,'retainer');assert.equal(done.residency.successionPosition,null);assert.equal((await directory(h)).occupied,0);
 const restarted=save(h,lord);restarted.state.gameOver=false;restarted.state.castles.kiyosu.owner=restarted.state.clan;const healthy=await upload(h,lord,restarted);assert.equal(healthy.residency.successionPosition,1);assert.equal((await directory(h,lord,'?castleId=kiyosu')).roster.retainers[0].successionPosition,1);
});
await scope('a pre-appointment CPU loss at the exact tenure boundary cannot demote or hide the new lord',async h=>{
 const lord=await player(h,'境界の新領主'),heir=await player(h,'境界の家臣','kiyosu','retainer');weakHome(h,lord);h.sql.prepare('UPDATE castle_seats SET lord_since_elapsed_ms=540000 WHERE castle_id=?').run('kiyosu');const done=await upload(h,lord,advanceCpu(h,lord));assert.equal(seat(h).lord_user_id,lord.user.id);assert.equal(count(h,'castle_successions'),0);assert.equal(done.save.state.gameOver,false);assert.equal(done.save.state.home,'kiyosu');assert.equal(done.save.state.castles.kiyosu.owner,done.save.state.clan);assert.equal(member(h,heir).castle_id,'kiyosu');
});
await scope('a changing CPU successor rolls back the save and the same proof can elect the next retainer on retry',async h=>{
 const lord=await player(h,'CPU競合領主'),first=await player(h,'CPU離脱家臣','kiyosu','retainer'),second=await player(h,'CPU残留家臣','kiyosu','retainer');weakHome(h,lord);const before=row(h,lord).save_json,advanced=advanceCpu(h,lord);
 h.beforeBatch=statements=>{if(!statements[0]?.sql.startsWith('UPDATE player_saves SET save_json='))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(first.user.id);};await upload(h,lord,advanced,409);assert.equal(row(h,lord).save_json,before);assert.equal(count(h,'castle_successions'),0);assert.equal(count(h,'castle_residency_cpu_cursors'),0);await upload(h,lord,advanced);assert.equal(seat(h).lord_user_id,second.user.id);assert.equal(count(h,'castle_successions'),1);
});
await scope('privileged incumbents leave no ghost seat and the earliest ordinary retainer inherits',async h=>{
 const lord=await player(h,'任命前の領主'),heir=await player(h,'任命後の後継','kiyosu','retainer');h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)").run(lord.user.id,h.now);const d=await directory(h);assert.equal(d.occupied,1);assert.equal(seat(h).lord_user_id,heir.user.id);assert.equal(member(h,lord),undefined);assert.equal((await directory(h,lord)).self,null);assert.equal(count(h,'castle_successions'),0);
});
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,scenarios,calls,externalRequests:0}));
