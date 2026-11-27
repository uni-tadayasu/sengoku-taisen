import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,appoint,row,save,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {messageRegister} from './message-addressing.js';

let checks=0,calls=0;
async function scope(name,test){const h=harness();try{await test(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
function assign(h,operator,target){
 h.sql.prepare('INSERT OR IGNORE INTO court_regency_state(id,revision) VALUES(1,0)').run();
 h.sql.prepare('INSERT INTO court_regent(id,user_id,appointment_token,appointed_by,appointed_at) VALUES(1,?,?,?,?)').run(target.user.id,crypto.randomUUID(),operator.user.id,h.now);
}
const publicPerson=async(h,person)=>(await h.api('/players?q='+encodeURIComponent(person.user.name)+'&limit=50')).data.players.find(p=>p.id===person.user.id);
async function register(h,sender,audience){return messageRegister(h.db,sender.user,audience,h.now,async ids=>new Map(ids.map(id=>[id,0])),(status,code,message)=>{throw Object.assign(Error(message),{status,code});});}
const expected={title:'摂政',kind:'regent'};
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Public regency tests must not contact a real service');};
try{
 await scope('ordinary regency projects its title without changing the home, saved property or staff membership',async h=>{
  const operator=await fixture(h,'摂政表示の太政大臣',{admin:true}),ordinary=await fixture(h,'通常城の摂政');
  const before=row(h,ordinary);assign(h,operator,ordinary);
  const own=(await h.api('/me',{token:ordinary.token})).data.user;
  assert.deepEqual(own.courtOffice,expected);assert.equal(own.isStaff,false);assert.equal(own.isAdmin,false);assert.deepEqual(row(h,ordinary),before);
  assert.deepEqual((await publicPerson(h,ordinary)).courtOffice,expected);
  assert.equal((await h.api('/court',{token:ordinary.token})).data.self.title,'摂政');
  await h.api('/staff/court',{token:ordinary.token});
  assert(!['edo','kyoto_gosho'].includes(save(h,ordinary).state.home));
 });
 await scope('Kyoto regency replaces only its merit label and preserves the staff base',async h=>{
  const operator=await fixture(h,'京都摂政の太政大臣',{admin:true}),staff=await fixture(h,'京都の摂政',{staff:true});
  const before=row(h,staff);assign(h,operator,staff);
  const own=(await h.api('/me',{token:staff.token})).data.user;
  assert.equal(own.isStaff,true);assert.deepEqual(own.courtOffice,expected);assert.deepEqual(row(h,staff),before);
  assert.equal(save(h,staff).state.home,'kyoto_gosho');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_kyoto_offices WHERE user_id=?').get(staff.user.id).n,0);
  const directory=(await h.api('/admin/court/offices',{token:operator.token})).data;assert(!directory.offices.some(o=>o.blockedByKyoto));
 });
 await scope('a Kyoto regent may succeed to the crown and regency never reappears after the new reign',async h=>{
  const operator=await fixture(h,'摂政継承の太政大臣',{admin:true}),current=await fixture(h,'摂政に譲る天皇',{staff:true}),next=await fixture(h,'継承する摂政',{staff:true});
  await appoint(h,current);assign(h,operator,next);
  const nomination=(await nominateSuccessor(h,current,next)).nomination;
  assert.deepEqual((await publicPerson(h,next)).courtOffice,{title:'摂政',kind:'regent'});assert.deepEqual((await publicPerson(h,current)).courtOffice,{title:'天皇',kind:'emperor'});
  const result=await certifySuccessor(h,operator,nomination);
  assert.equal(result.receipt.targetPlayerId,next.user.id);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_regent').get().n,0);
  assert.deepEqual((await publicPerson(h,next)).courtOffice,{title:'天皇',kind:'emperor'});
  assert.deepEqual((await publicPerson(h,current)).courtOffice,{title:'上皇',kind:'retired-emperor'});
  await appoint(h,null);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_regent').get().n,0);
  assert.notEqual((await publicPerson(h,next)).courtOffice?.title,'摂政');
 });
 await scope('regent courtesy follows the canonical current appointment and stale sends are invalidated',async h=>{
  const operator=await fixture(h,'敬語摂政の太政大臣',{admin:true}),sender=await fixture(h,'摂政への使者'),target=await fixture(h,'敬語の摂政');
  assign(h,operator,target);
  const prepared=await register(h,sender,{kind:'person',id:target.user.id});assert.equal(await prepared.write('ここで待って'),'ここで待っていただけますか');
  const publicAudience=await register(h,sender,{kind:'public'}),privateAudience=await register(h,sender,{kind:'officials'});
  const ids=value=>JSON.parse(value.guard.args.at(-1))[3].map(row=>row[0]);assert(ids(publicAudience).includes(target.user.id));assert(ids(privateAudience).includes(target.user.id));
  h.sql.prepare('DELETE FROM court_regent WHERE id=1').run();
  assert(!h.sql.prepare('SELECT 1 AS matched WHERE '+prepared.guard.sql).get(...prepared.guard.args));
  assert.equal(await(await register(h,sender,{kind:'person',id:target.user.id})).write('ここで待って'),'ここで待って');
  assert.equal((await publicPerson(h,target)).courtOffice,null);
  await h.api('/staff/court',{token:target.token,expected:403});
 });
}finally{globalThis.fetch=network;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
