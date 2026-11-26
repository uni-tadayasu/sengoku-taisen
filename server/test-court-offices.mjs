import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {fixture,post,count,appoint,updateSave} from './test-court-support.mjs';
import {COURT_OFFICES} from './court-offices.js';

let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const directory=(h,p=h.operator,query='')=>h.api('/admin/court/offices'+query,{token:p.token});
const seat=(data,id)=>data.offices.find(office=>office.id===id);
async function action(h,officeId,target,kind='appoint',options={}){
 const expectedRevision=options.revision??(await directory(h)).data.revision;
 const body={requestId:options.requestId||crypto.randomUUID(),action:kind,officeId,targetPlayerId:target.user.id,expectedRevision};
 return h.api('/admin/court/offices',post(options.actor||h.operator,body,options.expected??200));
}
function merit(h,staff,points){
 let i=0;h.sql.prepare('DELETE FROM court_contributions WHERE actor_id=?').run(staff.user.id);
 while(points>0){const value=Math.min(128,points);h.sql.prepare("INSERT INTO court_contributions VALUES(?,?,?,'castle','kyoto_gosho',?,?,?,?)").run('office-merit-'+crypto.randomUUID(),staff.user.id,'staff-term',value,value,i++,h.now);points-=value;}
}
const state=h=>({appointments:h.sql.prepare('SELECT * FROM court_office_appointments ORDER BY office_id').all(),requests:h.sql.prepare('SELECT * FROM court_office_requests ORDER BY request_id').all()});
const offline=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court office tests must not contact a real service');};
try{
 await scope('schema-only migration, admin-only access and immutable operator office',async h=>{
  const migration=readFileSync(new URL('./drizzle/0039_external_court_offices.sql',import.meta.url),'utf8');
  assert(!/^INSERT INTO/m.test(migration),'deployment must not seed runtime rows');
  assert.equal(count(h,'court_office_state'),0);
  const admin=await fixture(h,'固定の太政大臣',{admin:true}),staff=await fixture(h,'御所の参議',{staff:true}),player=await fixture(h,'外部の領主');
  await h.api('/admin/court/offices',{expected:401});
  for(const person of [staff,player]){await h.api('/admin/court/offices',{token:person.token,expected:403});await action(h,'chunagon',player,'appoint',{actor:person,expected:403,revision:0});}
  assert.equal(count(h,'court_office_state'),0,'non-admin requests do not initialize administration state');
  const info=(await directory(h)).data;assert.equal(count(h,'court_office_state'),1);assert.equal(info.chancellor.id,admin.user.id);assert.equal(info.chancellor.title,'太政大臣');assert.equal(info.chancellor.fixed,true);assert.equal(info.offices.length,6);assert.equal(seat(info,'sangi').blockedByKyoto,true);
  for(const officeId of ['chancellor','daijodaijin','太政大臣','emperor','天皇'])for(const kind of ['appoint','dismiss']){const response=await action(h,officeId,admin,kind,{expected:400});assert.equal(response.data.error.code,'COURT_OFFICE_FIXED');}
  for(const target of [admin,staff])await action(h,'sadaijin',target,'appoint',{expected:400});
  assert.equal((await h.api('/court',{token:admin.token})).data.self.title,'太政大臣');assert.equal(count(h,'court_office_appointments'),0);
  assert.equal((await h.api('/health')).data.status,'ready');
 });
 await scope('all six Kyoto merit slots are excluded and the emperor releases his merit slot',async h=>{
  await fixture(h,'京都照合の運営',{admin:true});const staff=await fixture(h,'京都照合の担当',{staff:true}),player=await fixture(h,'他拠点候補');
  for(const definition of COURT_OFFICES){merit(h,staff,definition.minMerit);const info=(await directory(h)).data;assert.equal(info.offices.filter(office=>office.blockedByKyoto).length,1);assert.equal(seat(info,definition.id).blockedByKyoto,true);const denied=await action(h,definition.id,player,'appoint',{revision:info.revision,expected:409});assert.equal(denied.data.error.code,'COURT_OFFICE_KYOTO_CONFLICT');}
  await appoint(h,staff);const info=(await directory(h)).data;assert.equal(info.offices.some(office=>office.blockedByKyoto),false);assert.equal((await h.api('/court',{token:staff.token})).data.self.title,'天皇');
 });
 await scope('appointment appears publicly and personally without adding staff, operator or audience powers',async h=>{
  await fixture(h,'表示検証の運営',{admin:true});await fixture(h,'表示検証の担当',{staff:true});const player=await fixture(h,'表示検証の任命先',{score:35000});
  const result=(await action(h,'chunagon',player)).data;assert.equal(result.idempotent,false);assert.equal(seat(result,'chunagon').holder.id,player.user.id);assert.equal(seat(result,'chunagon').available,false);assert(seat(result,'chunagon').appointmentToken);
  const candidate=result.candidates.find(p=>p.id===player.user.id);assert.equal(candidate.officeId,'chunagon');assert.equal(candidate.courtOffice.title,'中納言');assert(candidate.homeCastleId);assert(candidate.homeCastleName);
  const self=(await h.api('/court',{token:player.token})).data;assert.equal(self.self.title,'中納言');assert.equal(self.self.canAppoint,false);assert.equal(self.self.canRespond,false);
  const publicUser=(await h.api('/players?q='+encodeURIComponent('表示検証の任命先')+'&limit=50')).data.players.find(p=>p.id===player.user.id);assert.deepEqual(publicUser.courtOffice,{title:'中納言',kind:'official'});assert(!Object.hasOwn(publicUser,'appointmentToken'));
  const current=(await h.api('/me',{token:player.token})).data.user;assert.equal(current.isAdmin,false);assert.equal(current.isStaff,false);
  await h.api('/staff/court',{token:player.token,expected:403});await h.api('/admin/court/offices',{token:player.token,expected:403});
  const message=(await h.api('/court/chat',post(player,{requestId:crypto.randomUUID(),text:'外部領主の参内'}))).data.message;assert.equal(message.author.kind,'visitor');assert.equal(message.author.id,player.user.id);
  assert.equal(count(h,'staff_members'),1);
 });
 await scope('one user and one holder per office, no implicit replacement, replay never resurrects a dismissal',async h=>{
  await fixture(h,'再送検証の運営',{admin:true});const first=await fixture(h,'第一の任命先'),second=await fixture(h,'第二の任命先');
  const revision=(await directory(h)).data.revision,requestId=crypto.randomUUID();
  const original=(await action(h,'dainagon',first,'appoint',{revision,requestId})).data;assert.equal((await action(h,'dainagon',first,'appoint',{revision,requestId})).data.idempotent,true);
  await action(h,'dainagon',second,'appoint',{expected:409});await action(h,'udaijin',first,'appoint',{expected:409});
  await action(h,'dainagon',second,'dismiss',{expected:409});assert.equal(count(h,'court_office_appointments'),1);
  await action(h,'udaijin',second,'appoint',{revision,expected:409});
  await action(h,'dainagon',first,'dismiss');const replay=(await action(h,'dainagon',first,'appoint',{revision,requestId})).data;assert.equal(replay.idempotent,true);assert.equal(seat(replay,'dainagon').holder,null);
  await action(h,'dainagon',second,'appoint',{revision,requestId,expected:409});
  const next=(await action(h,'dainagon',second)).data;assert.notEqual(next.revision,original.revision);assert.equal(seat(next,'dainagon').holder.id,second.user.id);
 });
 await scope('Kyoto promotions permanently revoke collisions and do not revive after another promotion',async h=>{
  await fixture(h,'昇進検証の運営',{admin:true});const staff=await fixture(h,'昇進する京都担当',{staff:true}),player=await fixture(h,'外部中納言');
  const revision=(await directory(h)).data.revision,requestId=crypto.randomUUID();await action(h,'chunagon',player,'appoint',{revision,requestId});
  merit(h,staff,50);assert.equal(count(h,'court_office_appointments'),0);assert.equal(seat((await directory(h)).data,'chunagon').blockedByKyoto,true);
  merit(h,staff,200);assert.equal(seat((await directory(h)).data,'chunagon').available,true);assert.equal(count(h,'court_office_appointments'),0);
  const replay=(await action(h,'chunagon',player,'appoint',{revision,requestId})).data;assert.equal(replay.idempotent,true);assert.equal(count(h,'court_office_appointments'),0);
 });
 await scope('staff appointment, emperor removal and term replacement all reconcile in their own transaction',async h=>{
  const admin=await fixture(h,'異動検証の運営',{admin:true}),staff=await fixture(h,'天皇検証の担当',{staff:true}),first=await fixture(h,'外部参議'),second=await fixture(h,'外部左大臣');
  await appoint(h,staff);await action(h,'sangi',first);await appoint(h,null);assert.equal(count(h,'court_office_appointments'),0);
  await appoint(h,staff);await action(h,'sangi',first);h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('new-term',staff.user.id);assert.equal(count(h,'court_office_appointments'),0);
  await action(h,'sadaijin',second);await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:second.user.id,action:'appoint'}));assert.equal(count(h,'court_office_appointments'),0);
  await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:second.user.id,action:'dismiss'}));assert.equal(count(h,'court_office_appointments'),0);
 });
 await scope('BAN, invalid home and operator changes clear old external appointments permanently',async h=>{
  const admin=await fixture(h,'在任失効の運営',{admin:true}),target=await fixture(h,'在任失効の対象');
  await action(h,'udaijin',target);h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(target.user.id,'fixture',admin.user.id,h.now,h.now);assert.equal(count(h,'court_office_appointments'),0);
  h.sql.prepare('UPDATE player_bans SET active=0,revision=revision+1 WHERE user_id=?').run(target.user.id);assert.equal(count(h,'court_office_appointments'),0);
  await action(h,'udaijin',target);updateSave(h,target,s=>{s.home='kyoto_gosho';});assert.equal(count(h,'court_office_appointments'),0);
  updateSave(h,target,s=>{s.home='kiyosu';});await action(h,'udaijin',target);h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(target.user.id);assert.equal(count(h,'court_office_appointments'),0);
 });
 await scope('competing appointments serialize and duplicate retries commit only once',async h=>{
  await fixture(h,'競合検証の運営',{admin:true});const first=await fixture(h,'競合の第一'),second=await fixture(h,'競合の第二'),revision=(await directory(h)).data.revision;
  let entered=0,release;const barrier=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_office_requests')))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const requests=[first,second].map(target=>h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action:'appoint',officeId:'naidaijin',targetPlayerId:target.user.id,expectedRevision:revision},null)));
  const result=await Promise.all(requests);assert.deepEqual(result.map(r=>r.response.status).sort(),[200,409]);assert.equal(count(h,'court_office_appointments'),1);assert.equal(count(h,'court_office_requests'),1);
  const winner=result.find(r=>r.response.status===200).data.offices.find(o=>o.id==='naidaijin').holder.id;await action(h,'naidaijin',winner===first.user.id?first:second,'dismiss');
  const nextRevision=(await directory(h)).data.revision,requestId=crypto.randomUUID();let hits=0,releaseAgain;const again=new Promise(resolve=>releaseAgain=resolve);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_office_requests')))return;if(++hits===2){h.beforeBatch=null;releaseAgain();}await again;};
  const duplicate=await Promise.all([action(h,'naidaijin',first,'appoint',{revision:nextRevision,requestId}),action(h,'naidaijin',first,'appoint',{revision:nextRevision,requestId})]);assert.deepEqual(duplicate.map(r=>r.data.idempotent).sort(),[false,true]);assert.equal(count(h,'court_office_appointments'),1);
 });
 await scope('mid-flight promotion or operator loss prevents all appointment writes',async h=>{
  const admin=await fixture(h,'競合認可の運営',{admin:true}),staff=await fixture(h,'競合昇進の担当',{staff:true}),target=await fixture(h,'競合任命の対象');
  const before=state(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_office_requests')))return;h.beforeBatch=null;merit(h,staff,50);};
  await action(h,'chunagon',target,'appoint',{expected:409});assert.deepEqual(state(h),before);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_office_requests')))return;h.beforeBatch=null;h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run(target.user.id,admin.user.id,h.now,'promoted');};
  await action(h,'sadaijin',target,'appoint',{expected:409});assert.deepEqual(state(h),before);
  const other=await fixture(h,'権限失効の任命先');h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_office_requests')))return;h.beforeBatch=null;h.sql.prepare("DELETE FROM settings WHERE key='adminUserId'").run();};
  await action(h,'sadaijin',other,'appoint',{expected:409});assert.deepEqual(state(h),before);
 });
 await scope('rollback and lost responses preserve exactly-once request receipts',async h=>{
  await fixture(h,'障害検証の運営',{admin:true});const target=await fixture(h,'障害検証の任命先');const before=state(h),revision=(await directory(h)).data.revision;
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_office_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_court_office_fixture SET value=1'));};
  await action(h,'dainagon',target,'appoint',{revision,expected:500});assert.deepEqual(state(h),before);
  const requestId=crypto.randomUUID();h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO court_office_requests'))){h.afterBatch=null;throw Error('fixture response loss');}};
  await action(h,'dainagon',target,'appoint',{revision,requestId,expected:500});assert.equal(count(h,'court_office_appointments'),1);
  assert.equal((await action(h,'dainagon',target,'appoint',{revision,requestId})).data.idempotent,true);assert.equal(count(h,'court_office_requests'),1);
 });
 await scope('bounded literal candidate search and final directory revision guards',async h=>{
  await fixture(h,'候補検索の運営',{admin:true});await fixture(h,'御所検索の担当',{staff:true});const player=await fixture(h,'候補検索の対象');
  const found=(await directory(h,undefined,'?q='+encodeURIComponent('候補検索の対象')+'&limit=1')).data;assert.equal(found.candidates.length,1);assert.equal(found.candidates[0].id,player.user.id);assert.equal(found.hasMore,false);
  assert.equal((await directory(h,undefined,'?q=%25')).data.candidates.length,0);
  for(const query of ['?limit=0','?limit=51','?limit=-1','?q='+encodeURIComponent('あ'.repeat(81))])await h.api('/admin/court/offices'+query,{token:h.operator.token,expected:400});
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('court-offices-directory')))return;h.afterBatch=null;h.sql.prepare('UPDATE court_office_state SET revision=revision+1 WHERE id=1').run();};
  await h.api('/admin/court/offices',{token:h.operator.token,expected:409});
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('public-court-office')))return;h.afterBatch=null;h.sql.prepare('UPDATE court_office_state SET revision=revision+1 WHERE id=1').run();};
  await h.api('/admin/court/offices',{token:h.operator.token,expected:409});
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('public-court-office')))return;h.afterBatch=null;h.sql.prepare("DELETE FROM settings WHERE key='adminUserId'").run();};
  await h.api('/admin/court/offices',{token:h.operator.token,expected:409});
 });
}finally{globalThis.fetch=offline;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
