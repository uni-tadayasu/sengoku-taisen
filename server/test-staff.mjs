import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

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
let clock=1795219200000,calls=0;const maintenanceByToken=new Map();
const originalNow=Date.now;
Date.now=()=>clock;
const tick=(milliseconds)=>{clock+=milliseconds;};
const base=JSON.parse(readFileSync(new URL('./fixtures/valid-save.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(base);
const ieyasu='of_b0616adde162';
async function api(path,{method='GET',token,body,expected=200,ip='192.0.2.1',rawBody}={}) {
  if(path==='/sync'&&method==='PUT'&&body&&!Object.hasOwn(body,'maintenanceRevision')&&maintenanceByToken.has(token))body={...body,maintenanceRevision:maintenanceByToken.get(token).revision};
  const headers={Origin:'http://127.0.0.1:4173','CF-Connecting-IP':ip};
  if(token)headers.Authorization='Bearer '+token;
  if(body!==undefined||rawBody!==undefined)headers['Content-Type']='application/json';
  const request=new Request('https://communications.example/api/v1'+path,{method,headers,body:rawBody??(body===undefined?undefined:JSON.stringify(body))});
  const response=await worker.fetch(request,env,{});
  const text=await response.text(),data=text?JSON.parse(text):null;
  if(token&&data?.maintenanceAuthority)maintenanceByToken.set(token,data.maintenanceAuthority);
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

const assign=async (operator,target,action,requestId=crypto.randomUUID(),expected=200)=>(await api('/admin/staff',post(operator?.token,{targetPlayerId:target.user.id,action,requestId},expected))).data;
const me=async p=>(await api('/me',{token:p.token})).data.user;
const adminRead=async (p,expected=200)=>(await api('/chat?channel=admin',{token:p?.token,expected})).data;
const memberCount=id=>Number(database.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(id).n);
function progress(snapshot,clock){
  const game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,staffBase:snapshot.staffBase,maintenanceAuthority:snapshot.maintenanceAuthority});
  const advanced=game.applyWorldClock(clock,{maxSeconds:86400,deferCycleSettlement:true});assert(advanced.ok&&!advanced.pending&&!advanced.settlementRequired);
  return {state:JSON.parse(game.exportSave()).state,personal:game.getStaffPersonalProgress()};
}
try{
  const operator=await session('役職管理の運営'),a=await session('支援スタッフA'),b=await session('一般領主B'),c=await session('一般領主C');
  for(const p of [operator,a,b,c]){assert.equal(p.user.isAdmin,false);assert.equal(p.user.isStaff,false);}
  await api('/admin/staff',{expected:401});await api('/admin/staff',{token:a.token,expected:403});
  await assign(a,b,'appoint',crypto.randomUUID(),403);await adminRead(a,403);
  await api('/admin/claim',post(operator.token,{key:env.SENGOKU_ADMIN_KEY}));
  assert.equal((await me(operator)).isAdmin,true);assert.equal((await me(operator)).isStaff,false);
  assert.deepEqual((await api('/admin/staff',{token:operator.token})).data.staff,[]);
  await assign(operator,operator,'appoint',crypto.randomUUID(),400);await assign(operator,operator,'dismiss',crypto.randomUUID(),400);
  await api('/admin/staff',post(operator.token,{targetPlayerId:'u_missing',action:'appoint',requestId:crypto.randomUUID()},404));
  await api('/admin/staff',post(operator.token,{targetPlayerId:a.user.id,action:'promote-admin'},400));
  await api('/admin/staff',post(operator.token,{targetPlayerId:a.user.id,action:'appoint',isAdmin:true},400));
  const appointId=crypto.randomUUID(),appointed=await assign(operator,a,'appoint',appointId);
  assert.equal(appointed.idempotent,false);assert.equal(appointed.action,'appoint');assert.equal(appointed.user.isStaff,true);assert.equal(appointed.user.isAdmin,false);
  assert.equal(appointed.staff.length,1);assert.equal(appointed.staff[0].appointedBy,operator.user.id);assert(Number.isFinite(Date.parse(appointed.staff[0].appointedAt)));
  assert.equal(memberCount(a.user.id),1);assert.equal((await me(a)).isStaff,true);
  const replay=await assign(operator,a,'appoint',appointId);assert(replay.idempotent);assert.equal(memberCount(a.user.id),1);
  const missingRequestId=(await api('/admin/staff',post(operator.token,{targetPlayerId:a.user.id,action:'appoint'},400))).data;assert.equal(missingRequestId.error.code,'INVALID_INPUT');assert.equal(memberCount(a.user.id),1);
  const naturalReplay=await assign(operator,a,'appoint');assert(naturalReplay.idempotent);assert.equal(naturalReplay.staff[0].appointedAt,appointed.staff[0].appointedAt);
  await assign(operator,b,'appoint',appointId,409);await assign(operator,a,'dismiss',appointId,409);
  const staffLease=await lease(a.token,'staff-device');assert.equal(staffLease.user.isStaff,true);assert.deepEqual(staffLease.entitlements,{courtProtected:true,edo:false,ieyasuU:false,kagoshima:false,shimazuU:false});
  const saved=(await api('/sync',write(a.token,'staff-device',0,fresh()))).data;
  assert.equal(saved.user.isAdmin,false);assert.equal(saved.user.isStaff,true);assert.equal(saved.save.state.home,'kyoto_gosho');assert(saved.staffBase?.protected);assert(!saved.save.state.officerVariants.includes(ieyasu+':U'));
  const edo=fresh();edo.state.home='edo';edo.state.castles.edo.owner=edo.state.clan;
  assert.equal((await api('/sync',write(a.token,'staff-device',1,edo,403))).data.error.code,'ADMIN_ENTITLEMENT_REQUIRED');
  const exclusive=fresh();exclusive.state.officers.push(ieyasu);exclusive.state.officerVariants.push(ieyasu+':U');
  await api('/sync',write(a.token,'staff-device',1,exclusive,403));
  const forged=structuredClone(saved.save);forged.state.isStaff=true;forged.state.isAdmin=true;forged.state.role='admin';
  const stripped=(await api('/sync',write(a.token,'staff-device',saved.revision,forged))).data;assert.equal(stripped.save.state.isStaff,undefined);assert.equal(stripped.save.state.role,undefined);assert.equal(stripped.user.isAdmin,false);
  await api('/admin/staff',{token:a.token,expected:403});await assign(a,b,'appoint',crypto.randomUUID(),403);await assign(a,a,'dismiss',crypto.randomUUID(),403);
  await api('/admin/announcement',post(a.token,{text:'権限なし'},403));
  await api('/admin/mail',post(a.token,{target:'all',title:'権限なし',body:'送信不可',gift:null,requestId:crypto.randomUUID()},403));
  await api('/world-clock',{method:'PATCH',token:a.token,body:{running:false,revision:0},expected:403});
  assert.equal((await api('/admin/claim',post(a.token,{key:env.SENGOKU_ADMIN_KEY},409))).data.error.code,'ADMIN_CLAIMED');
  assert.equal(database.prepare("SELECT value FROM settings WHERE key='adminUserId'").get().value,operator.user.id);
  const ownerMessage=(await api('/chat',post(operator.token,{channel:'admin',text:'ローカル検証用の運営軍議'}))).data.message;assert.equal(Object.hasOwn(ownerMessage,'isAdmin'),false);assert.equal(Object.hasOwn(ownerMessage,'isStaff'),false);
  assert.equal((await adminRead(a)).messages[0].id,ownerMessage.id);
  const staffMessage=(await api('/chat',post(a.token,{channel:'admin',text:'ローカル検証用の支援報告',isAdmin:true,userId:operator.user.id}))).data.message;
  assert.equal(staffMessage.userId,a.user.id);assert.equal(Object.hasOwn(staffMessage,'isAdmin'),false);assert.equal(Object.hasOwn(staffMessage,'isStaff'),false);
  assert.equal((await adminRead(operator)).messages.length,2);await adminRead(b,403);
  assert.equal((await api('/chat?channel=world',{token:b.token})).data.messages.length,0,'staff chat never appears in world chat');
  await presence(a.token,'staff-device',true);
  const online=(await api('/online')).data.players.find(p=>p.id===a.user.id);assert.equal(Object.hasOwn(online,'isStaff'),false);assert.equal(Object.hasOwn(online,'isAdmin'),false);
  const found=(await api('/players?q='+encodeURIComponent('支援スタッフ'),{token:operator.token})).data.players.find(p=>p.id===a.user.id);assert.equal(Object.hasOwn(found,'isStaff'),false);
  const field=(await api('/field',{token:b.token})).data.players.find(p=>p.playerId===a.user.id);assert.equal(Object.hasOwn(field,'isStaff'),false);assert.equal(Object.hasOwn(field,'isAdmin'),false);assert.equal(field.homeCastleId,'kyoto_gosho');assert.equal(field.attackable,true);assert.equal(field.battleMode,'reward');assert.equal(field.capturable,false);
  await lease(b.token,'ordinary-device');
  const attackerGame=GameEngine.fromSave(fresh(),GAME_OFFICERS);attackerGame.applyWorldClock((await api('/world-clock')).data.clock);
  const attackerSaved=(await api('/sync',write(b.token,'ordinary-device',0,JSON.parse(attackerGame.exportSave())))).data;
  const defenderBefore=database.prepare('SELECT * FROM player_saves WHERE user_id=?').get(a.user.id),sharedBefore=database.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),backupBefore=database.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(a.user.id);
  let defeat;const random=crypto.getRandomValues;crypto.getRandomValues=array=>array.fill(0xffffffff);
  try{defeat=(await api('/field/attack',post(b.token,{targetPlayerId:a.user.id,targetCastleId:'kyoto_gosho',troops:300,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:'ordinary-device',expectedRevision:attackerSaved.revision}))).data;}finally{crypto.getRandomValues=random;}
  assert(defeat.marching);assert.equal(defeat.battle,null);tick(defeat.march.remainingMs);
  const arrivalClock=(await api('/world-clock')).data.clock,defenderArrival=progress((await api('/sync',{token:a.token})).data,arrivalClock),attackerArrival=progress((await api('/sync?deviceId=ordinary-device',{token:b.token})).data,arrivalClock);
  const arrived=(await api('/marches?deviceId=ordinary-device',{token:b.token})).data;
  assert.equal(arrived.history[0].id,defeat.march.id);assert.equal(arrived.history[0].status,'resolved');defeat={save:arrived.save,battle:arrived.history[0].battle};
  assert.equal(defeat.battle.battleMode,'reward');assert.equal(defeat.battle.won,false);assert.equal(defeat.battle.defenderRevision,defenderBefore.revision+1);assert.deepEqual(defeat.battle.defenderLost,{troops:0,garrison:0});
  assert.deepEqual(defeat.battle.loot,{gold:0,rice:0,wood:0,stone:0});assert.deepEqual(defeat.battle.rewards,{gold:0,rice:0,wood:0,stone:0});
  assert.equal(defeat.battle.lootPolicy,'half-resources-v1');assert.equal(defeat.battle.lootFraction,.5);assert.deepEqual(defeat.save.state.resources,attackerArrival.state.resources,'A defeated attacker receives no resources beyond ordinary progress');
  assert.equal(defeat.save.state.home,attackerSaved.save.state.home);assert.notEqual(defeat.save.state.castles.kyoto_gosho.owner,defeat.save.state.clan);
  const defenderAfter=database.prepare('SELECT * FROM player_saves WHERE user_id=?').get(a.user.id),defenderState=JSON.parse(defenderAfter.save_json).state;
  assert.equal(defenderAfter.revision,defeat.battle.defenderRevision);assert.deepEqual(defenderState.resources,defenderArrival.state.resources,'Defended resources retain ordinary time progression without any loot debit');
  assert.deepEqual(defenderState.castles,defenderArrival.state.castles);assert.deepEqual(defenderState.buildings,defenderArrival.state.buildings);assert.equal(defenderState.troops,defenderArrival.state.troops);assert.equal(defenderState.magatama,defenderArrival.state.magatama);
  assert.deepEqual(database.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),sharedBefore);
  const backupAfter=database.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(a.user.id),personal=JSON.parse(backupAfter.save_json).state;
  assert.equal(backupAfter.term_id,backupBefore.term_id);assert.equal(personal.home,JSON.parse(backupBefore.save_json).state.home);assert.deepEqual(personal.resources,JSON.parse(backupBefore.save_json).state.resources);
  if(defenderArrival.personal)for(const key of ['level','wall','troops'])assert.equal(personal.castles[personal.home][key],defenderArrival.personal.castle[key],'Personal home '+key+' follows ordinary progress only');
  const code=(await api('/devices/pair-code',post(a.token,{}))).data.code;
  const linked=(await api('/devices/link',post(null,{code,deviceName:'スタッフの別端末'}))).data;assert(linked.user.isStaff);assert(!linked.user.isAdmin);await adminRead(linked);
  const dismissId=crypto.randomUUID(),dismissed=await assign(operator,a,'dismiss',dismissId);assert.equal(dismissed.idempotent,false);assert.equal(dismissed.user.isStaff,false);assert.equal(dismissed.staff.length,0);assert.equal(memberCount(a.user.id),0);
  assert.equal((await me(a)).isStaff,false);assert.equal((await api('/sync',{token:a.token})).data.user.isStaff,false);assert.equal((await me(linked)).isStaff,false);
  await adminRead(a,403);await adminRead(linked,403);
  tick(6000);await api('/chat',post(a.token,{channel:'admin',text:'解除後には届かない'},403));await api('/chat',post(linked.token,{channel:'admin',text:'連携端末からも届かない'},403));
  assert((await assign(operator,a,'dismiss',dismissId)).idempotent);
  const lateAppointRetry=await assign(operator,a,'appoint',appointId);assert(lateAppointRetry.idempotent);assert.equal(lateAppointRetry.user.isStaff,false,'an old appointment retry cannot undo a later dismissal');
  await api('/admin/staff',post(operator.token,{targetPlayerId:a.user.id,action:'appoint'},400));assert.equal(memberCount(a.user.id),0,'a request without a stable operation ID cannot reappoint a dismissed member');
  const concurrentId=crypto.randomUUID(),copies=await Promise.all([assign(operator,a,'appoint',concurrentId),assign(operator,a,'appoint',concurrentId)]);
  assert.deepEqual(copies.map(r=>r.idempotent).sort(),[false,true]);assert.equal(memberCount(a.user.id),1);
  assert((await me(a)).isStaff);assert((await adminRead(a)).messages.length>=2);

  // Revocation after authentication must still prevent the actual private read.
  const realBatch=db.batch.bind(db);
  db.batch=async statements=>{if(statements[0]?.sql.startsWith('SELECT 1 AS allowed WHERE'))database.prepare('DELETE FROM staff_members WHERE user_id=?').run(a.user.id);return realBatch(statements);};
  try{await adminRead(a,403);}finally{db.batch=realBatch;}
  assert.equal(memberCount(a.user.id),0);
  await assign(operator,a,'appoint');tick(6000);
  const beforeMessages=Number(database.prepare("SELECT COUNT(*) AS n FROM messages WHERE room_key='admin'").get().n),realStatement=db.statement.bind(db);
  db.statement=(sql,params)=>{const st=realStatement(sql,params);if(sql.startsWith('INSERT INTO messages')&&sql.includes('FROM staff_members')&&params[2]===a.user.id){const first=st.first;st.first=async()=>{database.prepare('DELETE FROM staff_members WHERE user_id=?').run(a.user.id);return first();};}return st;};
  try{await api('/chat',post(a.token,{channel:'admin',text:'送信直前の解除で拒否'},403));}finally{db.statement=realStatement;}
  assert.equal(Number(database.prepare("SELECT COUNT(*) AS n FROM messages WHERE room_key='admin'").get().n),beforeMessages);

  // Role assignment is guarded again in its transaction, not by a stale JS flag.
  db.batch=async statements=>{if(statements[0]?.sql.includes('INSERT INTO staff_role_requests'))database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(b.user.id);return realBatch(statements);};
  const staleOwnerRequest=crypto.randomUUID();
  try{await assign(operator,c,'appoint',staleOwnerRequest,403);}finally{db.batch=realBatch;database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(operator.user.id);}
  assert.equal(memberCount(c.user.id),0);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM staff_role_requests WHERE request_id=?').get(staleOwnerRequest).n,0);

  const rollbackId=crypto.randomUUID();
  db.batch=async statements=>realBatch(statements[0]?.sql.includes('INSERT INTO staff_role_requests')?[...statements,db.prepare('INSERT INTO missing_role_failure(value) VALUES(1)')]:statements);
  try{await assign(operator,c,'appoint',rollbackId,500);}finally{db.batch=realBatch;}
  assert.equal(memberCount(c.user.id),0);assert.equal(database.prepare('SELECT COUNT(*) AS n FROM staff_role_requests WHERE request_id=?').get(rollbackId).n,0);
  const safeRetry=await assign(operator,c,'appoint',rollbackId);assert(!safeRetry.idempotent);assert(safeRetry.user.isStaff);assert(!safeRetry.user.isAdmin);
  const appointment=assign(operator,b,'appoint'),removal=assign(operator,b,'dismiss');await Promise.all([appointment,removal]);
  assert.equal((await me(b)).isStaff,memberCount(b.user.id)===1);assert.equal((await me(b)).isAdmin,false);
  const roster=(await api('/admin/staff',{token:operator.token})).data.staff;assert(roster.every(p=>p.isStaff&&!p.isAdmin));assert(!JSON.stringify(roster).includes('token'));
  assert.equal(database.prepare("SELECT value FROM settings WHERE key='adminUserId'").get().value,operator.user.id);
  console.log(JSON.stringify({ok:true,calls,checks:['separate server-owned staff and operator roles','operator-only appoint and dismiss','no self appointment or authority-field escalation','idempotent and concurrent role operations','old retry cannot reverse later dismissal','staff chat read/write without public role badges','no privileged assets or administrative controls for staff','Kyoto palace defeat transfers no resources, commits ordinary defender progress and preserves troops, facilities, ownership and shared base','paired devices inherit and lose staff access','private roles on me/sync and concealed roles on online/search/field','revocation between authentication and SQL read/write','transactional primary-operator guard','rollback and safe role-operation retry','single primary operator preserved']},null,2));
}finally{Date.now=originalNow;database.close();}

