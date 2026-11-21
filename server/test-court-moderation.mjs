import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Real local Worker routes and transactional SQLite. No production mutations.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const rows=(h,table)=>h.sql.prepare('SELECT * FROM '+table).all();
const tables=['court_chat','court_audience_threads','court_audience_messages','court_leader','court_contributions','court_requests','moderation_state','moderation_requests','player_bans'];
const snapshot=h=>Object.fromEntries(tables.map(table=>[table,rows(h,table)]));
const revision=(h,target)=>Number(h.sql.prepare('SELECT revision FROM player_bans WHERE user_id=?').get(target.user.id)?.revision||0);
const body=(h,target,action='ban')=>({targetPlayerId:target.user.id,action,requestId:crypto.randomUUID(),expectedRevision:revision(h,target)});
async function fixture(h){
  const admin=await h.session('朝廷検証の運営'),target=await h.session('対象の朝廷役職者'),peer=await h.session('保存する参内者');
  await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
  await h.api('/admin/staff',post(admin,{targetPlayerId:target.user.id,action:'appoint',requestId:crypto.randomUUID()}));
  const term=h.sql.prepare('SELECT term_id FROM staff_members WHERE user_id=?').get(target.user.id).term_id;
  h.sql.prepare('INSERT INTO court_leader(id,user_id,term_id,appointed_by,updated_at,appointment_token) VALUES(1,?,?,?,?,?)').run(target.user.id,term,admin.user.id,h.now,crypto.randomUUID());
  for(const [id,author,kind,text] of [['cc_target',target,'court','削除する談話本文'],['cc_peer',peer,'visitor','保存する談話本文']])h.sql.prepare('INSERT INTO court_chat(id,author_id,author_kind,body,created_at) VALUES(?,?,?,?,?)').run(id,author.user.id,kind,text,h.now);
  for(const [id,requester,title] of [['ca_target',target,'削除する謁見の件名'],['ca_peer',peer,'保存する謁見の件名']])h.sql.prepare("INSERT INTO court_audience_threads VALUES(?,?,?,'answered',?,?)").run(id,requester.user.id,title,h.now,h.now);
  for(const [id,thread,author,kind,text] of [['cm_target1','ca_target',target,'court','削除する最初の本文'],['cm_peer1','ca_target',peer,'visitor','保存する他者の返信'],['cm_peer2','ca_peer',peer,'visitor','保存する他者の本文'],['cm_target2','ca_peer',target,'court','削除する担当者の返信']])h.sql.prepare('INSERT INTO court_audience_messages(id,thread_id,author_id,author_kind,body,created_at) VALUES(?,?,?,?,?,?)').run(id,thread,author.user.id,kind,text,h.now);
  h.sql.prepare("INSERT INTO court_contributions VALUES('completed-job',?,?,'castle','kyoto_gosho',2,2,60000,?)").run(target.user.id,term,h.now);
  h.sql.prepare("INSERT INTO court_requests VALUES(?,'prior-court-request','chat','redacted-hash','nonce','cc_target',NULL,?)").run(target.user.id,h.now);
  h.now+=1000;
  return{admin,target,peer};
}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;calls+=h.calls;console.log('PASS '+name);}finally{h.close();}}

await scope('court text removal is author-scoped and counts are included in the same moderation receipt',async h=>{
  const{admin,target,peer}=await fixture(h),before=await h.api('/admin/moderation/target?playerId='+target.user.id,{token:admin.token});
  assert.deepEqual(before.data.counts,{chatMessages:1,letterMessages:2,pendingTrades:0});
  const contribution=rows(h,'court_contributions'),requests=rows(h,'court_requests');
  const result=(await h.api('/admin/moderation',post(admin,body(h,target)))).data;
  assert.deepEqual(result.receipt.deleted,{chatMessages:1,letterMessages:2});
  assert.equal(result.contentRevision,before.data.contentRevision+1);
  assert.deepEqual(rows(h,'court_chat').map(row=>row.author_id),[peer.user.id]);
  assert.deepEqual(rows(h,'court_audience_messages').map(row=>row.body),['保存する他者の返信','保存する他者の本文']);
  const threads=rows(h,'court_audience_threads');
  assert.equal(threads.find(row=>row.id==='ca_target').title,'削除された謁見');
  assert.equal(threads.find(row=>row.id==='ca_peer').title,'保存する謁見の件名');
  assert(threads.every(row=>row.updated_at===h.now));
  assert.deepEqual(rows(h,'court_leader'),[]);
  assert.deepEqual(rows(h,'court_contributions'),contribution);
  assert.deepEqual(rows(h,'court_requests'),requests);
  assert(!JSON.stringify(snapshot(h)).includes('削除する'));
});

await scope('unban and old moderation request retries cannot restore deleted court text or the former appointment',async h=>{
  const{admin,target}=await fixture(h),ban=body(h,target),first=(await h.api('/admin/moderation',post(admin,ban))).data;
  const replay=(await h.api('/admin/moderation',post(admin,ban))).data;
  assert.equal(replay.idempotent,true);assert.deepEqual(replay.receipt,first.receipt);
  await h.api('/admin/moderation',post(admin,body(h,target,'unban')));
  const after=snapshot(h);await h.api('/admin/moderation',post(admin,ban));
  assert.deepEqual(snapshot(h),after);assert.deepEqual(rows(h,'court_leader'),[]);
  assert(!JSON.stringify(after).includes('削除する'));
  assert.equal(rows(h,'court_contributions').length,1);
});

await scope('a failure in any court purge step rolls back the ban, text, appointment and content revision',async h=>{
  const{admin,target}=await fixture(h),ban=body(h,target),before=snapshot(h);
  for(const [table,event] of [['court_audience_threads','UPDATE'],['court_chat','DELETE'],['court_audience_messages','DELETE'],['court_leader','DELETE']]){
    h.sql.exec(`CREATE TRIGGER fail_court BEFORE ${event} ON ${table} BEGIN SELECT RAISE(ABORT,'local court purge failure'); END`);
    await h.api('/admin/moderation',post(admin,ban,500));assert.deepEqual(snapshot(h),before);
    h.sql.exec('DROP TRIGGER fail_court');
  }
  assert.equal((await h.api('/admin/moderation',post(admin,ban))).data.ban.active,true);
});

await scope('staff cannot moderate and a lost operator credential cannot purge court records at commit',async h=>{
  const{admin,target,peer}=await fixture(h),before=snapshot(h);
  await h.api('/admin/moderation',post(target,body(h,peer),403));assert.deepEqual(snapshot(h),before);
  let intercepted=false;
  h.beforeBatch=async statements=>{
    if(!statements.some(statement=>statement.sql.includes('INSERT INTO moderation_requests')))return;
    intercepted=true;h.beforeBatch=null;
    h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(peer.user.id);
  };
  await h.api('/admin/moderation',post(admin,body(h,target),403));assert(intercepted);
  assert.deepEqual(snapshot(h),before);
});

console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
