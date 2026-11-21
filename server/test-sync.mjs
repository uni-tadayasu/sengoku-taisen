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

try {
  const alice=await session('同期の領主'),bob=await session('別の領主'),operator=await session('運営同期の領主');
  await api('/sync',{expected:401});
  await api('/sync',{token:'x'.repeat(43),expected:401});
  const preflight=await api('/sync',{method:'OPTIONS',expected:204});
  assert(preflight.response.headers.get('access-control-allow-methods').split(',').includes('PUT'));
  assert.equal((await api('/config')).data.onlineCount,0,'registration is not foreground presence');
  const initial=(await api('/sync?deviceId=deviceA',{token:alice.token})).data;
  assert.equal(initial.save,null);assert.equal(initial.revision,0);assert.equal(initial.writerDeviceId,null);assert.equal(initial.writable,false);
  assert.deepEqual(initial.entitlements,{edo:false,ieyasuU:false});
  let firstLease=await lease(alice.token,'deviceA');
  assert.equal(firstLease.writable,true);assert.equal(Date.parse(firstLease.leaseExpiresAt)-clock,30000);
  const busy=await api('/sync/lease',post(alice.token,{deviceId:'deviceB'},409));assert.equal(busy.data.error.code,'LEASE_HELD');
  tick(1000);
  const spectator=(await api('/sync?deviceId=deviceB',{token:alice.token})).data;
  assert.equal(spectator.writable,false);assert.equal(spectator.leaseExpiresAt,firstLease.leaseExpiresAt,'reads must not renew or steal the lease');
  const noLease=await api('/sync',write(bob.token,'deviceA',0,fresh(),409));assert.equal(noLease.data.error.code,'LEASE_REQUIRED');
  let save=fresh();save.isAdmin=true;save.state.isAdmin=true;save.state.role='admin';save.state.resources.isAdmin=true;
  const saved=(await api('/sync',write(alice.token,'deviceA',0,save))).data;
  assert.equal(saved.revision,1);assert.equal(saved.save.state.isAdmin,undefined);assert.equal(saved.save.isAdmin,undefined);assert.equal(saved.save.state.role,undefined);assert.equal(saved.save.state.resources.isAdmin,undefined);
  assert.equal(saved.save.savedAt,save.savedAt);assert.equal(saved.user.isAdmin,false);
  const secondDevice=(await api('/sync?deviceId=deviceB',{token:alice.token})).data;
  assert.deepEqual(secondDevice.save,saved.save);assert.equal(secondDevice.revision,1);
  const other=(await api('/sync?userId='+alice.user.id,{token:bob.token})).data;
  assert.equal(other.save,null,'another authenticated user cannot select someone else\'s cloud save');
  await lease(bob.token,'deviceA');
  await api('/sync',{method:'PUT',token:bob.token,body:{deviceId:'deviceA',revision:0,save:fresh(),userId:alice.user.id}});
  assert.equal((await api('/sync',{token:alice.token})).data.revision,1);
  const stale=await api('/sync',write(alice.token,'deviceA',0,fresh(),409));assert.equal(stale.data.error.code,'REVISION_CONFLICT');
  const competing=[fresh(),fresh()];competing[0].state.resources.gold=4321;competing[1].state.resources.gold=5678;
  const requests=competing.map(save=>new Request('https://communications.example/api/v1/sync',{method:'PUT',headers:{Authorization:'Bearer '+alice.token,'Content-Type':'application/json'},body:JSON.stringify({deviceId:'deviceA',revision:1,save})}));
  const results=await Promise.all(requests.map(request=>worker.fetch(request,env,{})));calls+=results.length;
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const afterRace=(await api('/sync',{token:alice.token})).data;
  assert.equal(afterRace.revision,2);assert([4321,5678].includes(afterRace.save.state.resources.gold));
  await api('/sync/release',post(alice.token,{deviceId:'not-the-holder'}));
  assert.equal((await api('/sync',{token:alice.token})).data.writerDeviceId,'deviceA');
  await lease(alice.token,'deviceB',true);
  const displaced=await api('/sync',write(alice.token,'deviceA',2,fresh(),409));assert.equal(displaced.data.error.code,'LEASE_REQUIRED');
  await api('/sync/release',post(alice.token,{deviceId:'deviceB'}));
  firstLease=await lease(alice.token,'deviceA');
  tick(30000);
  const expired=await api('/sync',write(alice.token,'deviceA',2,fresh(),409));assert.equal(expired.data.error.code,'LEASE_REQUIRED');
  await lease(alice.token,'deviceB');
  await api('/sync',write(alice.token,'deviceB',2,fresh()));
  const invalid=fresh();invalid.state.resources.gold=-1;
  await api('/sync',write(alice.token,'deviceB',3,invalid,400));
  const malicious=fresh();malicious.state.isAdmin=true;malicious.state.officers.push(ieyasu);malicious.state.officerVariants.push(ieyasu+':U');
  const forbiddenOfficer=await api('/sync',write(alice.token,'deviceB',3,malicious,403));assert.equal(forbiddenOfficer.data.error.code,'ADMIN_ENTITLEMENT_REQUIRED');
  const edo=fresh();edo.state.home='edo';edo.state.castles.edo.owner=edo.state.clan;
  await api('/sync',write(alice.token,'deviceB',3,edo,403));
  edo.state.home='kiyosu';await api('/sync',write(alice.token,'deviceB',3,edo,403));
  const ordinaryIeyasu=fresh();ordinaryIeyasu.state.officers.push(ieyasu);ordinaryIeyasu.state.officerVariants.push(ieyasu+':SSS');
  await api('/sync',write(alice.token,'deviceB',3,ordinaryIeyasu));
  const beforeBad=(await api('/sync',{token:alice.token})).data;
  await api('/sync',{method:'PUT',token:alice.token,rawBody:' '.repeat(2*1024*1024+1),expected:413});
  assert.equal((await api('/sync',{token:alice.token})).data.revision,beforeBad.revision);
  await api('/admin/claim',post(operator.token,{key:env.SENGOKU_ADMIN_KEY}));
  const opLease=await lease(operator.token,'operatorA');assert.deepEqual(opLease.entitlements,{edo:true,ieyasuU:true});
  const opSave=(await api('/sync',write(operator.token,'operatorA',0,fresh()))).data;
  assert.equal(opSave.user.isAdmin,true);assert.equal(opSave.save.state.home,'edo');
  assert.equal(opSave.user.clan,'德川家');assert.equal(opSave.save.state.clan,'德川家');
  assert.equal(opSave.save.state.castles.edo.owner,'德川家');assert.equal(opSave.save.state.castles[base.state.home].owner,'德川家');
  assert.deepEqual(opSave.save.state.resources,base.state.resources);assert.deepEqual(opSave.save.state.buildings,base.state.buildings);
  assert.equal(opSave.save.state.officers.filter(id=>id===ieyasu).length,1);
  assert.equal(opSave.save.state.officerVariants.filter(id=>id===ieyasu+':U').length,1);
  const restored=(await api('/sync',write(operator.token,'operatorA',1,opSave.save))).data;
  assert.deepEqual(restored.save.state,opSave.save.state,'repeat restoration changes no resources or collection counts');
  const opEdo=fresh();opEdo.state.home='edo';opEdo.state.castles.edo.owner=opEdo.state.clan;
  const selectedEdo=(await api('/sync',write(operator.token,'operatorA',2,opEdo))).data;
  const legacy=structuredClone(selectedEdo.save);
  legacy.state.castles.kiyosu.owner='在地衆';legacy.state.castles.edo.level=17;legacy.state.castles.edo.troops=3210;
  if(!legacy.state.captureRewards.includes('edo'))legacy.state.captureRewards.push('edo');
  database.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(legacy),operator.user.id);
  database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(bob.user.id);
  const revoked=(await api('/sync?deviceId=operatorA',{token:operator.token})).data;
  assert.equal(revoked.user.isAdmin,false);assert.deepEqual(revoked.entitlements,{edo:false,ieyasuU:false});
  assert.equal(revoked.revision,3);assert.equal(revoked.writerDeviceId,'operatorA');assert.equal(revoked.leaseExpiresAt,selectedEdo.leaseExpiresAt);
  assert.equal(revoked.save.state.clan,'徳川家');assert.equal(revoked.save.state.home,'okazaki');assert.equal(revoked.save.state.castles.okazaki.level,17);assert.equal(revoked.save.state.castles.okazaki.troops,3210);
  assert.notEqual(revoked.save.state.castles.edo.owner,revoked.save.state.clan);assert(!revoked.save.state.captureRewards.includes('edo'));
  assert(revoked.save.state.officerVariants.includes(ieyasu+':SSS'));assert(!revoked.save.state.officerVariants.includes(ieyasu+':U'));
  assert.deepEqual(revoked.save.state.resources,legacy.state.resources);
  await api('/sync',write(operator.token,'operatorA',3,legacy,403));
  database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(operator.user.id);
  // A previously stored administrator save missing the grant is restored on read
  // without silently changing revision or lease ownership.
  database.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(fresh()),operator.user.id);
  const normalized=(await api('/sync',{token:operator.token})).data;
  assert.equal(normalized.revision,3);assert(normalized.save.state.officerVariants.includes(ieyasu+':U'));

  const pairCode=(await api('/devices/pair-code',post(operator.token,{}))).data;
  assert.match(pairCode.code,/^[0-9A-HJKMNP-TV-Z]{12}$/);assert.equal(Date.parse(pairCode.expiresAt)-clock,600000);
  const codeRow=database.prepare('SELECT * FROM pairing_codes WHERE user_id=?').get(operator.user.id);
  assert.equal(codeRow.code_hash.length,64);assert(!JSON.stringify(codeRow).includes(pairCode.code));
  const linkBodies=['phone','tablet'].map(deviceName=>new Request('https://communications.example/api/v1/devices/link',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.4'},body:JSON.stringify({code:pairCode.code,deviceName})}));
  const linkResults=await Promise.all(linkBodies.map(request=>worker.fetch(request,env,{})));calls+=linkResults.length;
  assert.deepEqual(linkResults.map(r=>r.status).sort(),[200,410]);
  const linked=await linkResults.find(r=>r.status===200).json();
  assert.notEqual(linked.token,operator.token);assert.equal(linked.user.id,operator.user.id);assert.equal(linked.user.isAdmin,true);
  assert.equal((await api('/me',{token:linked.token})).data.user.isAdmin,true);
  assert.equal((await api('/me',{token:operator.token})).data.user.id,operator.user.id,'the original recovery identity stays valid');
  assert.equal((await api('/sync',{token:linked.token})).data.revision,3);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM user_sessions WHERE user_id=?').get(operator.user.id).n,1);
  const sessionRow=database.prepare('SELECT * FROM user_sessions WHERE user_id=?').get(operator.user.id);assert(!JSON.stringify(sessionRow).includes(linked.token));
  await api('/devices/link',post(null,{code:pairCode.code},410));
  const expireCode=(await api('/devices/pair-code',post(alice.token,{}))).data;
  tick(600000);await api('/devices/link',post(null,{code:expireCode.code},410));
  await api('/devices/pair-code',post(null,{},401));
  for(let i=0;i<12;i++)await api('/devices/link',{...post(null,{code:'000000000000'},410),ip:'192.0.2.99'});
  const throttled=await api('/devices/link',{...post(null,{code:'000000000000'},429),ip:'192.0.2.99'});assert.equal(throttled.data.error.code,'RATE_LIMITED');

  // Only foreground heartbeats contribute. Auth reads, save sync and paired
  // devices may continue in the background without appearing online.
  assert.equal((await api('/config')).data.onlineCount,0);
  await presence(alice.token,'tab-a',true);await presence(alice.token,'tab-b',true);await presence(operator.token,'op-tab',true);
  const online=(await api('/online')).data;
  assert.equal(online.total,2);assert.equal(online.players.length,2);assert(online.players.every(p=>p.online));
  assert.equal(online.players.find(p=>p.id===operator.user.id).isAdmin,true);
  const publicJson=JSON.stringify(online);for(const secret of [alice.token,operator.token,linked.token,'token_hash','device_name','last_seen','192.0.2.'])assert(!publicJson.includes(secret));
  assert.equal((await api('/config')).data.onlineCount,2);
  const page1=(await api('/online?limit=1')).data;assert.equal(page1.players.length,1);assert(page1.nextCursor);
  const page2=(await api('/online?limit=1&cursor='+page1.nextCursor)).data;assert.equal(page2.players.length,1);assert.equal(page2.nextCursor,null);assert.notEqual(page1.players[0].id,page2.players[0].id);
  await api('/online?limit=101',{expected:400});
  await presence(alice.token,'tab-a',false);assert.equal((await api('/config')).data.onlineCount,2,'second foreground device keeps a single user online');
  await presence(alice.token,'tab-b',false);assert.equal((await api('/config')).data.onlineCount,1);
  assert.equal((await api('/me',{token:alice.token})).data.user.online,false);
  await api('/sync',{token:alice.token});assert.equal((await api('/config')).data.onlineCount,1);
  tick(90000);
  await api('/me',{token:operator.token});assert.equal((await api('/online')).data.total,0,'at 90s the old presence expires even after authenticated reads');
  await presence(linked.token,'phone',true);assert.equal((await api('/online')).data.players[0].id,operator.user.id);

  console.log(JSON.stringify({ok:true,calls,checks:['schema-only migrations','real save validation and authority-field removal','cross-user isolation','single writer lease and explicit takeover','atomic concurrent revision conflict','read-only sync does not renew lease','30-second lease expiry','2MiB body limit','server-exclusive Edo and U Ieyasu','idempotent administrator restoration','revoked-role read migration preserves progress and strict write restrictions','hashed expiring one-time pairing','concurrent redemption and per-device tokens','original recovery token compatibility','pairing IP rate limit','public privacy-safe paginated presence','deduplicated foreground-only online count','90-second disconnect expiry']},null,2));
} finally {
  Date.now=originalNow;database.close();
}
