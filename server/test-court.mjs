import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {honorificText} from './honorific-text.js';
import {fixture,post,row,save,count,appoint,updateSave} from './test-court-support.mjs';

let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const info=(h,p)=>h.api('/court',{token:p.token});
const chat=(h,p,text='参内しました。',requestId=crypto.randomUUID(),expected=200)=>h.api('/court/chat',post(p,{requestId,text},expected));
const audience=(h,p,title='領国の相談',text='水路の整備について伺います。',requestId=crypto.randomUUID(),expected=200)=>h.api('/court/audiences',post(p,{requestId,title,text},expected));
const reply=(h,p,id,text='承知しました。',requestId=crypto.randomUUID(),expected=200)=>h.api('/court/audiences/'+id+'/replies',post(p,{requestId,text},expected));
const allPrivateTables=['court_chat','court_audience_threads','court_audience_messages','court_requests','court_leader'];
const snapshot=h=>Object.fromEntries(allPrivateTables.map(name=>[name,h.sql.prepare('SELECT * FROM '+name).all()]));
const offline=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court tests must not contact a real service');};
try{
 await scope('authoritative exact admission threshold, authenticated read and protected routes',async h=>{
  const low=await fixture(h,'参内前',{score:34999}),high=await fixture(h,'従五位',{score:35000}),admin=await fixture(h,'朝廷運営',{admin:true}),staff=await fixture(h,'朝廷担当',{staff:true});
  await h.api('/court',{expected:401});const lower=(await info(h,low)).data,upper=(await info(h,high)).data;
  assert.equal(lower.eligible,false);assert.equal(lower.evaluation.score,34999);assert.equal(upper.eligible,true);assert.equal(upper.evaluation.score,35000);assert.equal(upper.self.title,'従五位');assert.equal(upper.requirement.rankId,'court-7');assert.equal(upper.palace.maxLevel,128);assert.equal(upper.palace.id,'kyoto_gosho');
  assert.equal((await info(h,admin)).data.self.title,'太政大臣');assert.equal((await info(h,staff)).data.self.title,'参議');
  for(const path of ['/court/chat','/court/audiences'])await h.api(path,{token:low.token,expected:403});
  await chat(h,low,'資格を偽装',undefined,403);await h.api('/court/chat',post(high,{requestId:crypto.randomUUID(),text:'本文',score:99999,isStaff:true},400));
  await h.api('/staff/court',{token:high.token,expected:403});assert.equal(count(h,'court_chat'),0);
 });
 await scope('chat replay, conflict, ordered delta, bounded input and neutral official identities',async h=>{
  const admin=await fixture(h,'公開しない運営名',{admin:true}),staff=await fixture(h,'公開しない担当名',{staff:true}),visitor=await fixture(h,'参内者',{score:35000});
  const requestId=crypto.randomUUID(),first=(await chat(h,visitor,'最初の会話',requestId)).data,again=(await chat(h,visitor,'最初の会話',requestId)).data;
  assert.equal(first.idempotent,false);assert.equal(again.idempotent,true);assert.equal(first.message.id,again.message.id);assert.equal(count(h,'court_chat'),1);
  await chat(h,visitor,'書き換え',requestId,409);await chat(h,admin,'朝廷からのお知らせ');await chat(h,staff,'朝廷のご案内');
  const list=(await h.api('/court/chat',{token:visitor.token})).data;assert.deepEqual(list.messages.map(m=>m.text),[honorificText('最初の会話'),'朝廷からのお知らせ',honorificText('朝廷のご案内')]);assert.deepEqual(list.messages.slice(1).map(m=>m.author.name),['朝廷','朝廷']);
  for(const m of list.messages.slice(1)){assert.equal(m.author.id,null);assert.equal(m.author.avatarVersion,null);assert.equal(m.author.evaluation,null);}
  assert(!JSON.stringify(list).includes(admin.user.id));assert(!JSON.stringify(list).includes(staff.user.id));assert(!JSON.stringify(list).includes('isAdmin'));
  const delta=(await h.api('/court/chat?after='+first.message.seq+'&contentRevision='+list.contentRevision,{token:visitor.token})).data;assert.equal(delta.messages.length,2);assert.equal(delta.reset,false);
  const page=(await h.api('/court/chat?limit=2',{token:visitor.token})).data;assert(page.hasMore);assert.equal(page.messages.length,2);
  for(const text of ['', ' '.repeat(3), 'あ'.repeat(301), 'bad\u0000body'])await chat(h,visitor,text,undefined,400);
  await h.api('/court/chat?after=-1',{token:visitor.token,expected:400});await h.api('/court/chat?limit=51',{token:visitor.token,expected:400});
 });
 await scope('private audience isolation, staff replies, visitor followups and durable replay',async h=>{
  const admin=await fixture(h,'謁見の運営',{admin:true}),staff=await fixture(h,'謁見の担当',{staff:true}),one=await fixture(h,'謁見者一',{score:35000}),two=await fixture(h,'謁見者二',{score:35000});
  const requestId=crypto.randomUUID(),created=(await audience(h,one,undefined,undefined,requestId)).data,id=created.thread.id;
  assert.match(id,/^ca_[a-f0-9]{32}$/);assert.equal(created.thread.status,'open');assert.equal((await audience(h,one,undefined,undefined,requestId)).data.idempotent,true);
  assert.equal(count(h,'court_audience_threads'),1);await h.api('/court/audiences/'+id,{token:two.token,expected:404});await reply(h,two,id,'他人への返信',undefined,404);
  assert.equal((await h.api('/court/audiences',{token:two.token})).data.threads.length,0);assert.equal((await h.api('/court/audiences',{token:staff.token})).data.threads.length,1);
  const replyId=crypto.randomUUID(),answered=(await reply(h,staff,id,'朝廷の回答',replyId)).data;assert.equal(answered.thread.status,'answered');assert.equal(answered.message.author.name,'朝廷');assert.equal(answered.message.author.id,null);assert.equal((await reply(h,staff,id,'朝廷の回答',replyId)).data.idempotent,true);
  assert.equal((await reply(h,one,id,'追加の質問')).data.thread.status,'open');const detail=(await h.api('/court/audiences/'+id+'?limit=2',{token:one.token})).data;
  assert.equal(detail.thread.messageCount,3);assert.equal(detail.messages.length,2);assert.equal(detail.hasOlder,true);assert(detail.nextBefore);assert(!JSON.stringify(detail).includes(staff.user.id));
  const older=(await h.api('/court/audiences/'+id+'?before='+detail.nextBefore,{token:one.token})).data;assert.equal(older.messages.length,1);assert.equal(older.hasOlder,false);
  await audience(h,two,'別件','もう一つの相談');const page=(await h.api('/court/audiences?limit=1',{token:admin.token})).data;assert(page.nextCursor);assert.equal((await h.api('/court/audiences?limit=1&cursor='+page.nextCursor,{token:admin.token})).data.threads.length,1);
  await audience(h,one,'あ'.repeat(81),'本文',undefined,400);await audience(h,one,'件名','あ'.repeat(1001),undefined,400);await h.api('/court/audiences?cursor=broken',{token:one.token,expected:400});
 });
 await scope('same request concurrent replay and failure rollbacks leave no duplicate or partial text',async h=>{
  const visitor=await fixture(h,'同時参内',{score:35000}),requestId=crypto.randomUUID();let entered=0,release;const barrier=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_requests')))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const result=await Promise.all([chat(h,visitor,'同時の会話',requestId),chat(h,visitor,'同時の会話',requestId)]);assert.equal(entered,2);assert.deepEqual(result.map(r=>r.data.idempotent).sort(),[false,true]);assert.equal(count(h,'court_chat'),1);
  const before=snapshot(h),lost=crypto.randomUUID();h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_court_fixture SET value=1'));};await audience(h,visitor,undefined,undefined,lost,500);assert.deepEqual(snapshot(h),before);
  h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO court_requests'))){h.afterBatch=null;throw Error('local response loss');}};await audience(h,visitor,undefined,undefined,lost,500);assert.equal(count(h,'court_audience_threads'),1);assert.equal((await audience(h,visitor,undefined,undefined,lost)).data.idempotent,true);assert.equal(count(h,'court_audience_messages'),1);
 });
 await scope('operator office is fixed and appointment is authorized, idempotent and term-bound',async h=>{
  const admin=await fixture(h,'任命する運営',{admin:true}),staff=await fixture(h,'任命される担当',{staff:true}),other=await fixture(h,'一般の領主',{score:35000});
  const firstInfo=(await info(h,staff)).data,requestId=crypto.randomUUID();await h.api('/admin/court/leader',post(staff,{requestId:crypto.randomUUID(),targetPlayerId:staff.user.id},403));await appoint(h,other,400);await appoint(h,admin,400);
  const result=(await appoint(h,staff,200,requestId)).data;assert.equal(result.leaderId,staff.user.id);assert.equal(result.roster.find(p=>p.id===admin.user.id).title,'太政大臣');assert.equal(result.roster.find(p=>p.id===staff.user.id).title,'天皇');assert.equal((await appoint(h,staff,200,requestId)).data.idempotent,true);
  const crowned=(await info(h,staff)).data;assert(crowned.self.isCourtEmperor);assert.notEqual(crowned.accessStamp,firstInfo.accessStamp);assert.equal(crowned.self.title,'天皇');
  await appoint(h,null);assert.equal((await info(h,staff)).data.self.isCourtEmperor,false);await appoint(h,staff,200,requestId);assert.equal(count(h,'court_leader'),0,'old replay cannot restore a revoked appointment');
  await appoint(h,staff);await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:staff.user.id,action:'dismiss'}));assert.equal(count(h,'court_leader'),0);
  await h.api('/admin/staff',post(admin,{requestId:crypto.randomUUID(),targetPlayerId:staff.user.id,action:'appoint'}));assert.equal((await info(h,staff)).data.self.title,'参議');
 });
 await scope('appointment guards a target demotion or replacement while the write is suspended',async h=>{
  await fixture(h,'競合任命の運営',{admin:true});const staff=await fixture(h,'競合任命の担当',{staff:true});
  const before=count(h,'court_requests');h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_requests')))return;h.beforeBatch=null;h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run('replacement-term',staff.user.id);};
  const result=await appoint(h,staff,409);assert.equal(result.data.error.code,'COURT_LEADER_CHANGED');assert.equal(count(h,'court_requests'),before);assert.equal(count(h,'court_leader'),0);
 });
 await scope('rank loss and staff demotion before commit prevent all Court writes',async h=>{
  const admin=await fixture(h,'権限検証の運営',{admin:true}),staff=await fixture(h,'権限検証の担当',{staff:true}),visitor=await fixture(h,'権限検証の参内者',{score:35000});
  for(const [player,change] of [[visitor,()=>updateSave(h,visitor,s=>{s.prestige=0;})],[staff,()=>h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id)]]){
   const before=snapshot(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO court_requests')))return;h.beforeBatch=null;change();};await chat(h,player,'失効した送信',undefined,409);assert.deepEqual(snapshot(h),before);
  }
  assert.equal((await info(h,visitor)).data.eligible,false);await h.api('/staff/court',{token:staff.token,expected:403});assert.equal(count(h,'court_chat'),0);assert.equal((await info(h,admin)).data.self.title,'太政大臣');
 });
 await scope('in-flight read rejects obsolete private text after content purge or role/rank changes',async h=>{
  await fixture(h,'読み取り運営',{admin:true});const visitor=await fixture(h,'読む参内者',{score:35000}),peer=await fixture(h,'書く参内者',{score:35000});await chat(h,peer,'削除対象の会話');
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('FROM court_chat m JOIN users')))return;h.afterBatch=null;h.sql.exec('DELETE FROM court_chat; UPDATE moderation_state SET content_revision=content_revision+1');};const stale=await h.api('/court/chat',{token:visitor.token,expected:409});assert(!JSON.stringify(stale.data).includes('削除対象'));
  const next=(await h.api('/court/chat?after=999&contentRevision=0',{token:visitor.token})).data;assert.equal(next.reset,true);assert.equal(next.messages.length,0);
  const created=(await audience(h,visitor,'消去される件名','消去される本文')).data;h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('FROM court_audience_threads t JOIN users')))return;h.afterBatch=null;h.sql.exec("UPDATE court_audience_threads SET title='削除された謁見'; DELETE FROM court_audience_messages; UPDATE moderation_state SET content_revision=content_revision+1");};const privateStale=await h.api('/court/audiences/'+created.thread.id,{token:visitor.token,expected:409});assert(!JSON.stringify(privateStale.data).includes('消去される'));
  await chat(h,peer,'後の会話');h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('FROM court_chat m JOIN users')))return;h.afterBatch=null;updateSave(h,visitor,s=>{s.prestige=0;});};await h.api('/court/chat',{token:visitor.token,expected:409});
 });
 await scope('a visitor promoted during response decoration is not disclosed as a public official identity',async h=>{
  const admin=await fixture(h,'秘匿検証の運営',{admin:true}),reader=await fixture(h,'秘匿検証の読者',{score:35000}),writer=await fixture(h,'秘匿される新担当',{score:35000});await chat(h,writer,'任命前の会話');
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('FROM court_chat m JOIN users')))return;h.afterBatch=null;h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run(writer.user.id,admin.user.id,h.now,'promoted-mid-read');};const stale=await h.api('/court/chat',{token:reader.token,expected:409});assert(!JSON.stringify(stale.data).includes(writer.user.id));
  const list=(await h.api('/court/chat',{token:reader.token})).data;assert.equal(list.messages[0].author.name,'朝廷');assert.equal(list.messages[0].author.id,null);
 });
}finally{globalThis.fetch=offline;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
