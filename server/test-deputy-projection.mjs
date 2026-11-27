import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const CYCLE_MS=672*60000;
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const read=async(h,p,path)=>(await h.api(path,{token:p?.token})).data;
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=(h,p)=>JSON.parse(row(h,p).save_json);
const evaluation=save=>GameEngine.publicEvaluation(save.state,{officers:GAME_OFFICERS});
function tune(h,p,edit){const value=saved(h,p);edit(value.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(value),p.user.id);return value;}
async function player(h,name,castleId='kiyosu'){
 const p=await h.session(name);p.deviceId='projection-'+p.user.id;
 const lease=await read(h,p,'/sync');await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
 await h.api('/castles/residency/start',post(p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode:'lord',clan:'織田家',difficulty:'normal'}));return p;
}
async function deputy(h){
 const admin=await h.session('表示検証の運営');await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
 const p=await player(h,'表示検証のサブ運営','himeji'),current=await read(h,admin,'/admin/deputy');
 await h.api('/admin/deputy',post(admin,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID(),expectedRevision:current.revision}));return p;
}
function pendingCycle(h,p,{storedHome=null}={}){
 const value=tune(h,p,s=>{s.worldClock.elapsedMs=CYCLE_MS-1000;s.turn=671;s.realtime.elapsed=59;s.upkeep.settledTurn=671;});
 h.sql.prepare('UPDATE player_saves SET cycle_index=0,cycle_home=?,lease_expires_at=? WHERE user_id=?').run(storedHome||value.state.home,h.now+30000,p.user.id);
 h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1 WHERE id=?').run(CYCLE_MS+1000,h.now,'world-v1');
}
let cases=0,requests=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 binding limit: '+s.params.length);}return batch(statements);};try{await run(h);cases++;console.log('PASS '+name);}finally{requests+=h.calls;h.close();}}

await scope('deputy public and court evaluations retain Kagoshima and independently owned ordinary castles',async h=>{
 const p=await deputy(h);
 tune(h,p,s=>{s.castles.kagoshima.level=7;s.castles.kiyosu.owner=s.clan;s.castles.kiyosu.level=3;});
 const snapshot=await read(h,p,'/sync'),expected=evaluation(snapshot.save),before=row(h,p);
 assert.equal(snapshot.user.isDeputy,true);assert.equal(snapshot.save.state.home,'kagoshima');assert.deepEqual(snapshot.user.evaluation,expected);
 const field=await read(h,p,'/field/me'),court=await read(h,p,'/court');
 assert.deepEqual(field.self.evaluation,expected);assert.deepEqual(court.evaluation,expected);assert.equal(field.self.homeCastleId,'kagoshima');
 assert.deepEqual(row(h,p),before,'Public and court projections must not rewrite a private save');
});

await scope('pending cycle evaluation preserves the deputy fixed home without counting retired outposts',async h=>{
 const p=await deputy(h);tune(h,p,s=>{s.castles.kagoshima.level=8;s.castles.kiyosu.owner=s.clan;s.castles.kiyosu.level=4;});pendingCycle(h,p);
 const before=row(h,p),projected=saved(h,p);for(const [id,c]of Object.entries(projected.state.castles))if(id!=='kagoshima'&&c.owner===projected.state.clan)c.owner='在地衆';
 const expected=evaluation(projected),profile=await read(h,p,'/players/'+p.user.id+'/profile'),court=await read(h,p,'/court'),field=await read(h,p,'/field/me');
 assert.deepEqual(profile.player.evaluation,expected);assert.deepEqual(court.evaluation,expected);assert.deepEqual(field.self.evaluation,expected);assert.equal(field.self.homeCastleId,'kagoshima');assert.deepEqual(row(h,p),before);
});

await scope('legacy ordinary Kagoshima is projected at its ordinary home with the original defense and no deputy reward base',async h=>{
 const p=await player(h,'旧鹿児島の表示');tune(h,p,s=>{[s.castles.kiyosu,s.castles.kagoshima]=[s.castles.kagoshima,s.castles.kiyosu];s.home='kagoshima';s.cycle.home='kagoshima';s.castles.kagoshima.level=9;s.castles.kagoshima.troops=4321;});
 h.sql.prepare("UPDATE player_saves SET cycle_home='kagoshima' WHERE user_id=?").run(p.user.id);h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(p.user.id);h.sql.prepare('UPDATE castle_seats SET lord_user_id=NULL WHERE lord_user_id=?').run(p.user.id);
 const before=row(h,p),snapshot=await read(h,p,'/sync'),field=await read(h,p,'/field/me');
 assert.equal(snapshot.save.state.home,'kiyosu');assert.equal(field.self.homeCastleId,'kiyosu');assert.equal(field.self.level,9);assert.equal(field.self.battleMode,'raid');assert.deepEqual(field.self.evaluation,evaluation(snapshot.save));assert.deepEqual(row(h,p),before);
});

await scope('obsolete Kagoshima cycle metadata cannot replace an ordinary player home in projection or settlement',async h=>{
 const p=await player(h,'旧周期情報の領主','himeji');pendingCycle(h,p,{storedHome:'kagoshima'});
 const before=row(h,p),field=await read(h,p,'/field/me'),court=await read(h,p,'/court');assert.equal(field.self.homeCastleId,'himeji');assert.equal(field.self.targetCastleId,'himeji');assert.equal(field.self.battleMode,'raid');assert.deepEqual(row(h,p),before);
 const expected=saved(h,p);for(const [id,c]of Object.entries(expected.state.castles))if(id!=='himeji'&&c.owner===expected.state.clan)c.owner='在地衆';assert.deepEqual(court.evaluation,evaluation(expected));
 h.sql.prepare('UPDATE player_saves SET lease_expires_at=0 WHERE user_id=?').run(p.user.id);
 const settled=await read(h,p,'/sync');assert.equal(settled.save.state.home,'himeji');assert.equal(settled.save.state.cycle.home,'himeji');assert.equal(row(h,p).cycle_home,'himeji');assert.equal(row(h,p).cycle_index,1);assert.notEqual(settled.save.state.castles.kagoshima.owner,settled.save.state.clan);
});

console.log(JSON.stringify({cases,localHttpRequests:requests,maxBindings,productionRequests:0}));
