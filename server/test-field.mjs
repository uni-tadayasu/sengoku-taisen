import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';

// Exercise the real Worker with an SQLite-backed D1 adapter. Transactions are
// synchronous here; Promise.all still interleaves authentication and validation,
// so competing compare-and-swap writes and redemptions reach the same database.
const database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
for(const entry of journal.entries) {
  const migration=readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8');
  for(const sql of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(sql);
}
const db={
  lastError:null,
  prepare(sql){return this.statement(sql,[]);},
  statement(sql,params){
    const execute=()=>{try{return database.prepare(sql).all(...params);}catch(error){db.lastError={sql,error:String(error)};throw error;}};
    return {sql,params,bind(...values){return db.statement(sql,values);},
      async first(){return execute()[0]||null;},
      async all(){return {success:true,results:execute()};},
      async run(){try{const result=database.prepare(sql).run(...params);return {success:true,results:[],meta:{changes:Number(result.changes)}};}catch(error){db.lastError={sql,error:String(error)};throw error;}}
    };
  },
  async batch(statements){
    database.exec('BEGIN IMMEDIATE');
    try{const result=statements.map(s=>({success:true,results:database.prepare(s.sql).all(...s.params)}));database.exec('COMMIT');return result;}
    catch(error){database.exec('ROLLBACK');db.lastError={error:String(error)};throw error;}
  }
};
const env={DB:db,SENGOKU_ADMIN_KEY:crypto.randomUUID()+crypto.randomUUID()};
let clock=1795219200000,calls=0;
const originalNow=Date.now;
Date.now=()=>clock;
const tick=(milliseconds)=>{clock+=milliseconds;};
const base=JSON.parse(readFileSync(new URL('./fixtures/valid-save.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(base);
const ieyasu='of_b0616adde162';
async function api(path,{method='GET',token,body,expected=200,ip='192.0.2.1',rawBody}={}) {
  const headers={Origin:'http://127.0.0.1:4173','CF-Connecting-IP':ip};
  if(token)headers.Authorization='Bearer '+token;
  if(body!==undefined||rawBody!==undefined)headers['Content-Type']='application/json';
  const request=new Request('https://communications.example/api/v1'+path,{method,headers,body:rawBody??(body===undefined?undefined:JSON.stringify(body))});
  const response=await worker.fetch(request,env,{});
  const text=await response.text(),data=text?JSON.parse(text):null;
  calls++;
  assert.equal(response.status,expected,JSON.stringify({path,expected,status:response.status,data,sqlError:db.lastError}));
  assert.equal(response.headers.get('cache-control'),'no-store');
  return {data,response};
}
const post=(token,body,expected=200)=>({method:'POST',token,body,expected});
const write=(token,deviceId,revision,save,expected=200)=>({method:'PUT',token,body:{deviceId,revision,save},expected});
const session=async name=>(await api('/session',post(null,{name,clan:'織田家'}))).data;
const lease=async (token,deviceId,takeOver=false)=>(await api('/sync/lease',post(token,{deviceId,deviceName:deviceId,takeOver}))).data;
const presence=async (token,deviceId,online)=>(await api('/presence',post(token,{deviceId,deviceName:deviceId,online}))).data;

const getClock=async()=>(await api('/world-clock')).data.clock;
const snapshot=async player=>(await api('/sync?deviceId='+player.deviceId,{token:player.token})).data;
async function upload(player) {
  await lease(player.token,player.deviceId);
  let prior=await snapshot(player);const current=await getClock();
  while(prior.save&&prior.save.state.cycle.index<Math.floor(current.elapsedMs/(672*60000)))prior=(await api('/sync/settle',post(player.token,{deviceId:player.deviceId,revision:prior.revision}))).data;
  const save=prior.save||fresh();
  save.state.worldClock={id:current.id,elapsedMs:current.elapsedMs};save.state.turn=Math.floor(current.elapsedMs/60000);save.state.realtime.elapsed=current.elapsedMs%60000/1000;
  if(!prior.save){save.state.resources={gold:30000,rice:50000,wood:20000,stone:20000};save.state.troops=5000;save.state.castles[save.state.home].troops=1500;save.state.command=3;}
  return (await api('/sync',write(player.token,player.deviceId,prior.revision,save))).data;
}
async function player(name){const p=await session(name);p.deviceId='device-'+p.user.id;await upload(p);return p;}
const attackBody=(actor,target,revision,requestId=crypto.randomUUID(),troops=3000)=>({targetPlayerId:target.user.id,deviceId:actor.deviceId,expectedRevision:revision,requestId,troops,tactic:'balanced'});
const attack=async (actor,body,expected=200)=>(await api('/field/attack',post(actor.token,body,expected))).data;
const diplomacyBody=(actor,target,revision,action,requestId=crypto.randomUUID())=>({targetPlayerId:target.user.id,deviceId:actor.deviceId,expectedRevision:revision,requestId,action});
const diplomacy=async (actor,body,expected=200)=>(await api('/field/diplomacy',post(actor.token,body,expected))).data;
const me=async p=>(await api('/field/me?deviceId='+p.deviceId,{token:p.token})).data;
const dbSave=p=>JSON.parse(database.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(p.user.id).save_json);
const battles=()=>Number(database.prepare('SELECT COUNT(*) AS n FROM field_battles').get().n);
try {
  const a=await player('共有領主A'),b=await player('共有領主B'),c=await player('共有領主C'),admin=await session('共有地図の運営');admin.deviceId='operator-device';
  await api('/admin/claim',post(admin.token,{key:env.SENGOKU_ADMIN_KEY}));await upload(admin);
  const missing=await session('未保存の領主');missing.deviceId='missing-save';
  await presence(a.token,a.deviceId,true);
  const publicList=(await api('/field?limit=2')).data;
  assert.equal(publicList.total,4);assert.equal(publicList.players.length,2);assert(publicList.nextCursor);assert(publicList.players.every(p=>!p.self&&!p.attackable));
  const next=(await api('/field?limit=2&cursor='+publicList.nextCursor)).data;assert.equal(next.players.length,2);assert.equal(next.nextCursor,null);
  const all=(await api('/field?limit=100',{token:a.token})).data;
  assert.equal(all.players.filter(p=>p.homeCastleId==='kiyosu').length,3,'co-located players retain separate identities');
  assert.equal(all.players.find(p=>p.playerId===admin.user.id).homeCastleId,'edo');assert.equal(all.players.find(p=>p.playerId===admin.user.id).attackable,false);
  assert(all.players.find(p=>p.playerId===a.user.id).self);assert(all.players.find(p=>p.playerId===a.user.id).online);
  assert.equal(all.players.find(p=>p.playerId===b.user.id).online,false);assert(all.players.find(p=>p.playerId===b.user.id).attackable);
  const publicText=JSON.stringify(publicList);for(const secret of ['token','writer_device','deviceName','resources','save_json','request_hash','commit_token'])assert(!publicText.includes(secret));
  assert((await me(a)).attack.ready);assert.equal((await me(missing)).self,null);assert.equal((await me(missing)).attack.ready,false);
  await api('/field?limit=101',{expected:400});await api('/field/me',{expected:401});
  await api('/field/attack',post(null,attackBody(a,b,1),401));
  assert.equal((await attack(a,attackBody(a,a,1),400)).error.code,'INVALID_TARGET');
  assert.equal((await attack(a,{...attackBody(a,b,1),targetPlayerId:'u_absent'},404)).error.code,'FIELD_PLAYER_NOT_FOUND');
  assert.equal((await attack(a,attackBody(a,admin,1),403)).error.code,'TARGET_PROTECTED');
  assert.equal((await attack(a,{...attackBody(a,b,1),deviceId:'other-device'},409)).error.code,'LEASE_REQUIRED');
  assert.equal((await attack(a,attackBody(a,b,0),409)).error.code,'REVISION_CONFLICT');
  await attack(a,{...attackBody(a,b,1),won:true},400);await attack(a,attackBody(a,b,1,crypto.randomUUID(),299),400);
  await attack(a,attackBody(a,b,1,crypto.randomUUID(),100001),400);await attack(a,{...attackBody(a,b,1),tactic:'forged'},400);
  assert.equal((await attack(a,attackBody(a,b,1,crypto.randomUUID(),10000),409)).error.code,'INSUFFICIENT_FORCE');
  const beforeA=dbSave(a),beforeB=dbSave(b),request=attackBody(a,b,1),first=await attack(a,request);
  assert.equal(first.idempotent,false);assert.equal(first.revision,2);assert.equal(first.battle.attackerRevision,2);assert.equal(first.battle.defenderRevision,2);assert.equal(battles(),1);
  const afterA=dbSave(a),afterB=dbSave(b);
  assert.equal(afterA.state.home,beforeA.state.home);assert.equal(afterB.state.home,beforeB.state.home);
  assert.deepEqual(Object.fromEntries(Object.entries(afterB.state.castles).map(([id,s])=>[id,s.owner])),Object.fromEntries(Object.entries(beforeB.state.castles).map(([id,s])=>[id,s.owner])));
  assert(first.battle.attackerLost<=Math.floor(request.troops*.35));assert(first.battle.defenderLost.troops<=beforeB.state.troops*.1);assert(first.battle.defenderLost.garrison<=beforeB.state.castles[beforeB.state.home].troops*.1);
  assert.equal(afterA.state.troops,beforeA.state.troops-first.battle.attackerLost);assert.equal(afterB.state.troops,beforeB.state.troops-first.battle.defenderLost.troops);
  for(const resource of ['gold','rice','wood','stone']){assert(first.battle.loot[resource]<=500);assert(first.battle.loot[resource]<=beforeB.state.resources[resource]*.05);assert.equal(afterA.state.resources[resource]+afterB.state.resources[resource],beforeA.state.resources[resource]+beforeB.state.resources[resource]-(resource==='rice'?first.battle.foodCost:0));}
  const replay=await attack(a,request);assert(replay.idempotent);assert.deepEqual(replay.battle,first.battle);assert.equal(replay.revision,2);assert.equal(battles(),1);assert.deepEqual(dbSave(a),afterA);assert.deepEqual(dbSave(b),afterB);
  assert.equal((await attack(a,{...request,targetPlayerId:c.user.id},409)).error.code,'REQUEST_ID_REUSED');
  assert.equal((await attack(a,attackBody(a,c,2),409)).error.code,'ATTACK_COOLDOWN');
  assert.equal((await attack(c,attackBody(c,b,1),409)).error.code,'TARGET_PROTECTED');
  assert.equal((await api('/sync',write(b.token,b.deviceId,1,beforeB,409))).data.error.code,'REVISION_CONFLICT');
  assert.deepEqual(dbSave(b),afterB,'a stale active defender cannot erase the raid');
  assert.equal((await me(a)).battles[0].id,first.battle.id);assert.equal((await me(b)).battles[0].id,first.battle.id);assert.equal((await me(c)).battles.length,0);
  assert.equal((await me(a)).attack.remainingCooldownMs,60000);
  tick(60000);assert.equal((await attack(a,attackBody(a,b,2),409)).error.code,'LEASE_REQUIRED');
  await upload(a);await upload(b);await upload(c);
  const replayAfterSave=await attack(a,request);assert(replayAfterSave.idempotent);assert.equal(replayAfterSave.revision,3,'replay returns current save rather than the old operation snapshot');
  const proposal=diplomacyBody(a,b,3,'propose'),proposalCopies=await Promise.all([diplomacy(a,proposal),diplomacy(a,proposal)]),outgoing=proposalCopies[0];assert.equal(outgoing.relationship.status,'outgoing');
  assert.deepEqual(proposalCopies.map(r=>r.idempotent).sort(),[false,true],'concurrent duplicate proposal changes the relation once');
  assert.equal((await me(b)).relationships[0].status,'incoming');
  assert.equal((await diplomacy(a,diplomacyBody(a,b,3,'accept'),409)).error.code,'DIPLOMACY_STATE');
  assert.equal((await diplomacy(c,diplomacyBody(c,a,2,'accept'),409)).error.code,'DIPLOMACY_STATE');
  const accepted=await diplomacy(b,diplomacyBody(b,a,3,'accept'));assert.equal(accepted.relationship.status,'allied');assert.equal(accepted.relationship.remainingMs,360000);
  const repeatedProposal=await diplomacy(a,proposal);assert(repeatedProposal.idempotent);assert.equal(repeatedProposal.relationship.status,'allied');
  assert.equal((await attack(a,attackBody(a,b,3),409)).error.code,'ALLIED_TARGET');
  assert.equal((await diplomacy(a,diplomacyBody(a,b,3,'cancel'),409)).error.code,'DIPLOMACY_STATE');
  assert.equal((await api('/field',{token:a.token})).data.players.find(p=>p.playerId===b.user.id).relationship,'allied');
  await diplomacy(a,diplomacyBody(a,c,3,'propose'));const cancelled=await diplomacy(a,diplomacyBody(a,c,3,'cancel'));assert.equal(cancelled.relationship,null);
  await diplomacy(c,diplomacyBody(c,a,2,'propose'));const reject=diplomacyBody(a,c,3,'reject');assert.equal((await diplomacy(a,reject)).relationship,null);assert((await diplomacy(a,reject)).idempotent);
  await diplomacy(b,diplomacyBody(b,c,3,'propose'));
  const beforeRace=battles(),raceRequests=[
    new Request('https://communications.example/api/v1/field/diplomacy',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(diplomacyBody(c,b,2,'accept'))}),
    new Request('https://communications.example/api/v1/field/attack',{method:'POST',headers:{Authorization:'Bearer '+b.token,'Content-Type':'application/json'},body:JSON.stringify(attackBody(b,c,3))})
  ];
  const race=await Promise.all(raceRequests.map(r=>worker.fetch(r,env,{})));calls+=2;
  assert.deepEqual(race.map(r=>r.status).sort(),[200,409],'either consent or attack wins the concurrent operation');
  const bc=database.prepare('SELECT * FROM field_relations WHERE user_a=? AND user_b=?').get(...[b.user.id,c.user.id].sort());
  assert(bc.status==='allied'?battles()===beforeRace:battles()===beforeRace+1);
  const d=await player('同時襲撃の守備領主');
  const aRev=(await snapshot(a)).revision,cRev=(await snapshot(c)).revision,beforeConcurrent=battles();
  const concurrentBodies=[attackBody(a,d,aRev),attackBody(c,d,cRev)];
  const concurrentRequests=concurrentBodies.map((body,i)=>new Request('https://communications.example/api/v1/field/attack',{method:'POST',headers:{Authorization:'Bearer '+[a,c][i].token,'Content-Type':'application/json'},body:JSON.stringify(body)}));
  const concurrent=await Promise.all(concurrentRequests.map(r=>worker.fetch(r,env,{})));calls+=2;
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal(battles(),beforeConcurrent+1);assert.equal((await snapshot(d)).revision,2,'the defender changes exactly once');
  const x=await player('原子更新の攻撃領主'),y=await player('原子更新の守備領主'),rollbackRequest=attackBody(x,y,1),beforeX=dbSave(x),beforeY=dbSave(y),beforeRollback=battles(),realBatch=db.batch.bind(db);
  db.batch=async statements=>realBatch(statements.some(s=>s.sql.includes('INSERT INTO field_battles'))?[...statements,db.prepare('INSERT INTO missing_failure_injection(value) VALUES(1)')]:statements);
  try{await attack(x,rollbackRequest,500);}finally{db.batch=realBatch;}
  assert.deepEqual(dbSave(x),beforeX);assert.deepEqual(dbSave(y),beforeY);assert.equal(battles(),beforeRollback);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM field_requests WHERE actor_id=? AND request_id=?').get(x.user.id,rollbackRequest.requestId).n,0);
  const duplicateRetries=await Promise.all([attack(x,rollbackRequest),attack(x,rollbackRequest)]);
  assert.deepEqual(duplicateRetries.map(r=>r.idempotent).sort(),[false,true]);assert.deepEqual(duplicateRetries[0].battle,duplicateRetries[1].battle);assert.equal(battles(),beforeRollback+1);
  const large=672*60000+1;tick(large-(await getClock()).elapsedMs);await upload(a);await upload(b);
  const expired=(await me(a)).relationships;assert(!expired.some(r=>r.targetPlayerId===b.user.id),'alliances expire using monotonic elapsed time across the calendar loop');
  assert.equal((await getClock()).calendar.cycle,2);assert.equal((await me(a)).attack.remainingCooldownMs,0);
  const shared=await getClock();await api('/world-clock',{method:'PATCH',token:admin.token,body:{running:false,revision:shared.revision}});
  assert.equal((await attack(a,attackBody(a,b,(await snapshot(a)).revision),409)).error.code,'WORLD_PAUSED');
  assert((await api('/field',{token:a.token})).data.players.filter(p=>!p.self).every(p=>!p.attackable));
  const formerOperator=dbSave(admin);formerOperator.state.castles.kiyosu.owner='在地衆';formerOperator.state.castles.okazaki.owner=formerOperator.state.clan;
  database.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(formerOperator),admin.user.id);
  database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(b.user.id);
  const recovered=(await snapshot(admin)).save.state;
  const publicRecovered=(await api('/field',{token:a.token})).data.players.find(p=>p.playerId===admin.user.id);
  assert.equal(recovered.home,'okazaki');assert.equal(publicRecovered.homeCastleId,recovered.home,'revoked-operator map location matches the same owned-castle migration as sync');
  database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(admin.user.id);
  console.log(JSON.stringify({ok:true,calls,battles:battles(),checks:['real co-located bases and public privacy','operator always based at protected Edo','active writer and revision checks','server-owned outcome and bounded losses/loot','atomic updates of both saves','replay idempotence and payload reuse rejection','defender stale-save rejection','common-clock cooldown and protection','two-sided consent, rejection, cancellation and expiry','attack-versus-consent race','competing raids on one defender','transaction rollback and safe retry','current snapshot on delayed replay','looping calendar settles territory and clears prior diplomacy','global pause blocks attacks','revoked-role public base agrees with sync migration']},null,2));
}finally{Date.now=originalNow;database.close();}

