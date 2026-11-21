import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';

// Isolated, in-memory D1-compatible transactions. No production requests.
let calls=0;
function fixture(){
  const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
  const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
  for(const entry of journal.entries)for(const sql of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(sql);
  const db={beforeBatch:null,failBatch:false,prepare(sql){return this.statement(sql,[]);},statement(sql,params){return{sql,params,bind(...next){return db.statement(sql,next);},async first(){return database.prepare(sql).all(...params)[0]||null;},async all(){return{results:database.prepare(sql).all(...params),success:true};},async run(){const result=database.prepare(sql).run(...params);return{results:[],success:true,meta:{changes:Number(result.changes)}};}};},async batch(statements){if(this.beforeBatch){const hook=this.beforeBatch;this.beforeBatch=null;hook();}database.exec('BEGIN IMMEDIATE');try{const result=statements.map((s,i)=>{if(this.failBatch&&i===1){this.failBatch=false;throw Error('synthetic transaction interruption');}return{results:database.prepare(s.sql).all(...s.params),success:true};});database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}}};
  const env={DB:db,SENGOKU_ADMIN_KEY:'local-test-only-'+crypto.randomUUID()+crypto.randomUUID()};
  async function api(route,{body,token,expected=200,ip='192.0.2.5',origin='https://www.kasai-solutions-inc.com'}={}){
    const headers={Origin:origin,'CF-Connecting-IP':ip};if(body!==undefined)headers['Content-Type']='application/json';if(token)headers.Authorization='Bearer '+token;
    const res=await worker.fetch(new Request('https://test.invalid/api/v1'+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),env,{waitUntil(){}});const data=await res.json();calls++;
    assert.equal(res.status,expected,JSON.stringify({route,status:res.status,error:data.error}));assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(res.headers.get('set-cookie'),null);return{data,res};
  }
  async function owner(){const current=(await api('/session',{body:{name:'元の運営',clan:'徳川家'}})).data;await api('/admin/claim',{token:current.token,body:{key:env.SENGOKU_ADMIN_KEY}});return current;}
  const body=(requestId=crypto.randomUUID())=>({key:env.SENGOKU_ADMIN_KEY,deviceName:'復旧の検証端末',requestId});
  return{database,db,env,api,owner,body};
}

// Recovery does not create an operator before the first claim. Unknown operator
// and incorrect key use the same generic failure without disclosing credentials.
{
  const f=fixture();const absent=await f.api('/admin/recover',{body:f.body(),expected:403});const invalid=await f.api('/admin/recover',{body:{...f.body(),key:'wrong-key'},expected:403});assert.deepEqual(absent.data.error,invalid.data.error);
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM users').get().n,0);assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,0);assert(!Object.hasOwn((await f.api('/config')).data,'adminRecoveryAvailable'));f.database.close();
}
// The target is always the sole existing admin. Old tokens, user records, role
// membership and a byte-for-byte existing game save remain unchanged.
{
  const f=fixture(),admin=await f.owner();const ordinary=(await f.api('/session',{body:{name:'別の領主',clan:'織田家'}})).data;
  f.database.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,?,?)').run(admin.user.id,'{"preserved":"original-save"}',7,12345);
  f.database.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at) VALUES(?,?,?)').run(ordinary.user.id,admin.user.id,12345);
  const before={users:f.database.prepare('SELECT * FROM users ORDER BY id').all(),settings:f.database.prepare('SELECT * FROM settings').all(),saves:f.database.prepare('SELECT * FROM player_saves').all(),staff:f.database.prepare('SELECT * FROM staff_members').all()};
  assert(!Object.hasOwn((await f.api('/config')).data,'adminRecoveryAvailable'));assert.equal((await f.api('/me',{token:admin.token})).data.management.recoveryAvailable,true);
  const request=f.body();const recovered=(await f.api('/admin/recover',{body:request,token:ordinary.token})).data;
  assert.equal(recovered.recovered,true);assert.equal(recovered.user.id,admin.user.id);assert.equal(recovered.user.isAdmin,true);assert.equal(recovered.user.name,'元の運営');assert.match(recovered.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(recovered.token,admin.token);
  assert.deepEqual(f.database.prepare('SELECT * FROM users ORDER BY id').all(),before.users);assert.deepEqual(f.database.prepare('SELECT * FROM settings').all(),before.settings);assert.deepEqual(f.database.prepare('SELECT * FROM player_saves').all(),before.saves);assert.deepEqual(f.database.prepare('SELECT * FROM staff_members').all(),before.staff);
  const same=(await f.api('/admin/recover',{body:{...request,requestId:request.requestId.toUpperCase(),deviceName:'別の端末名'}})).data;assert.equal(same.token,recovered.token);assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,1);
  const second=(await f.api('/admin/recover',{body:f.body()})).data;assert.notEqual(second.token,recovered.token);assert.equal(second.user.id,admin.user.id);
  for(const token of [admin.token,recovered.token,second.token])assert.equal((await f.api('/me',{token})).data.user.isAdmin,true);
  const staff=(await f.api('/me',{token:ordinary.token})).data.user;assert.equal(staff.isAdmin,false);assert.equal(staff.isStaff,true);
  const persisted=JSON.stringify(f.database.prepare('SELECT * FROM user_sessions').all());assert(!persisted.includes(recovered.token));assert(!persisted.includes(second.token));assert(!persisted.includes(f.env.SENGOKU_ADMIN_KEY));
  f.database.close();
}
// Clients cannot select another target, change roles, omit the request UUID or
// use a staff token instead of the original operator key.
{
  const f=fixture(),admin=await f.owner(),other=(await f.api('/session',{body:{name:'支援スタッフ'}})).data;
  f.database.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at) VALUES(?,?,?)').run(other.user.id,admin.user.id,1);
  for(const extra of [{targetPlayerId:other.user.id},{isAdmin:true},{name:'名前変更'}])await f.api('/admin/recover',{body:{...f.body(),...extra},expected:400});
  const noRequest=f.body();delete noRequest.requestId;await f.api('/admin/recover',{body:noRequest,expected:400});
  await f.api('/admin/recover',{body:{...f.body(),requestId:'not-a-uuid'},expected:400});await f.api('/admin/recover',{body:{...f.body(),key:'x'.repeat(257)},expected:400});
  await f.api('/admin/recover',{body:{...f.body(),key:'wrong-key'},token:other.token,expected:403});
  assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,0);assert.equal((await f.api('/me',{token:other.token})).data.user.isAdmin,false);
  await f.api('/admin/claim',{body:{key:f.env.SENGOKU_ADMIN_KEY},token:other.token,expected:409});
  await f.api('/admin/recover',{body:f.body(),origin:'https://www.kasai-solutions-inc.com.attacker.invalid',expected:403});
  f.database.close();
}
// Concurrent lost-response retries create one session and return the same token.
{
  const f=fixture(),admin=await f.owner(),request=f.body();
  const results=await Promise.all([f.api('/admin/recover',{body:request,ip:'192.0.2.1'}),f.api('/admin/recover',{body:request,ip:'192.0.2.2'})]);assert.equal(results[0].data.token,results[1].data.token);assert.equal(results[0].data.user.id,admin.user.id);assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,1);
  f.database.close();
}
// A failed D1 batch rolls back the new session. A retry can finish safely.
{
  const f=fixture();await f.owner();const request=f.body();f.db.failBatch=true;await f.api('/admin/recover',{body:request,expected:500});assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,0);await f.api('/admin/recover',{body:request});assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,1);f.database.close();
}
// Replaying a recovery does not un-revoke an explicitly revoked device session.
{
  const f=fixture();await f.owner();const request=f.body();const recovered=(await f.api('/admin/recover',{body:request})).data;f.database.prepare('UPDATE user_sessions SET revoked_at=1').run();await f.api('/admin/recover',{body:request,expected:403});await f.api('/me',{token:recovered.token,expected:401});assert.equal(f.database.prepare('SELECT revoked_at FROM user_sessions').get().revoked_at,1);f.database.close();
}
// The role is checked again in the atomic insert if it changes during a request.
{
  const f=fixture();await f.owner();const other=(await f.api('/session',{body:{name:'競合用領主'}})).data;
  f.db.beforeBatch=()=>f.database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(other.user.id);
  await f.api('/admin/recover',{body:f.body(),expected:403});assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,0);f.database.close();
}
// Five failed attempts throttle the source even if the next key is correct.
{
  const f=fixture();await f.owner();for(let i=0;i<5;i++)await f.api('/admin/recover',{body:{...f.body(),key:'wrong-key'},expected:403});const blocked=await f.api('/admin/recover',{body:f.body(),expected:429});assert(Number(blocked.res.headers.get('retry-after'))>0);assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,0);assert(!JSON.stringify(f.database.prepare('SELECT scope FROM rate_limits').all()).includes('192.0.2.5'));f.database.close();
}
// Anonymous incorrect guesses cannot exhaust the rightful operator's allowance.
{
  const f=fixture();await f.owner();for(let i=0;i<30;i++)await f.api('/admin/recover',{body:{...f.body(),key:'wrong-key'},ip:'198.51.100.'+(i+1),expected:403});await f.api('/admin/recover',{body:f.body(),ip:'203.0.113.1'});assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,1);f.database.close();
}
// Correct-key requests still have a cross-IP cap to bound issued sessions.
{
  const f=fixture();await f.owner();for(let i=0;i<30;i++)await f.api('/admin/recover',{body:f.body(),ip:'198.51.100.'+(i+1)});await f.api('/admin/recover',{body:f.body(),ip:'203.0.113.1',expected:429});assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,30);f.database.close();
}
// A hidden/missing server secret is unavailable, never a bypass for empty keys.
{
  const f=fixture();await f.owner();delete f.env.SENGOKU_ADMIN_KEY;assert(!Object.hasOwn((await f.api('/config')).data,'adminRecoveryAvailable'));await f.api('/admin/recover',{body:{key:'anything',requestId:crypto.randomUUID()},expected:503});assert.equal(f.database.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n,0);f.database.close();
}
console.log(`Admin recovery backend tests passed (${calls} local HTTP calls): existing-owner-only authentication, immutable old credentials/save/roles, hash-only session persistence, HMAC retry idempotence, atomic concurrency/rollback, revocation, fresh role guard, staff denial, CORS, per-source/verified-owner throttling without global invalid-key lockout and missing-secret behavior. No production requests were made.`);
