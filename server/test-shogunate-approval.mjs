import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateKeyPairSync} from 'node:crypto';
import vm from 'node:vm';
import worker from './index.js';
import {harness} from './test-support.mjs';
import {fixture} from './test-court-support.mjs';
import {settleShogunateApprovals,readPalaceControl,SHOGUNATE_APPROVAL_WINDOW_MS} from './shogunate.js';

const post=(player,body,expected=200)=>({method:'POST',token:player?.token,body,expected});
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const approval=(h,rightId)=>h.sql.prepare('SELECT * FROM shogunate_approvals WHERE right_id=?').get(rightId);
const right=(h,rightId)=>h.sql.prepare('SELECT * FROM shogunate_rights WHERE id=?').get(rightId);
const request=(rightId)=>({rightId,requestId:crypto.randomUUID()});
let checks=0,calls=0;
const frontendSource=readFileSync(new URL('../shogunate.js',import.meta.url),'utf8'),sandbox={window:{}};
vm.runInNewContext(frontendSource.replace('global.SengokuShogunate={','global.__validation={cleanData,cleanReceipt};global.SengokuShogunate={'),sandbox);
const validation=sandbox.window.__validation;
function contract(data,receipt,record){const v=validation.cleanData(data);assert(v,'Actual frontend must accept server shogunate DTO');if(receipt)assert(validation.cleanReceipt(receipt,record,v),'Actual frontend must accept immutable receipt');return v;}
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function court(h){
 const operator=await h.session('太政大臣'),emperor=await h.session('承認する天皇'),staff=await h.session('一般の御所担当');
 await h.api('/admin/claim',post(operator,{key:h.env.SENGOKU_ADMIN_KEY}));
 for(const p of [emperor,staff])await h.api('/admin/staff',post(operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 h.sql.prepare("INSERT INTO court_lineages(user_id,house_id,imperial_house_name,imperial_house_key,revision,created_at,updated_at) VALUES(?,'konoe','承認宮','承認宮',1,?,?)").run(emperor.user.id,h.now,h.now);
 await h.api('/admin/court/leader',post(operator,{targetPlayerId:emperor.user.id,requestId:crypto.randomUUID()}));
 return{operator,emperor,staff};
}
async function applicant(h,name='統一した領主'){
 const player=await h.session(name),rightId='sg_'+crypto.randomUUID().replaceAll('-','');
 h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event',?,'天下統一の功績',?)").run(rightId,player.user.id,crypto.randomUUID(),h.now);
 return{...player,rightId};
}
const submit=async(h,p,body=request(p.rightId))=>({...((await h.api('/shogunate/open',post(p,body))).data),body});
const read=async(h,p)=>(await h.api('/shogunate',{token:p.token})).data.shogunate;
const approve=async(h,emperor,rightId,body=request(rightId),expected=200)=>(await h.api('/shogunate/approve',post(emperor,body,expected))).data;
const snapshots=h=>Object.fromEntries(['shogunate_rights','shogunate_approvals','shogunate_requests','shogunate_approval_requests','shogunate_palace_control'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
function configureTick(h){
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),key=pair.privateKey.export({format:'jwk'}),publicKey=pair.publicKey.export({format:'jwk'});
 Object.assign(h.env,{WEB_PUSH_PRIVATE_JWK:JSON.stringify(key),WEB_PUSH_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(publicKey.x,'base64url'),Buffer.from(publicKey.y,'base64url')]).toString('base64url'),WEB_PUSH_SUBJECT:'mailto:fixture@example.invalid'});
}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Shogunate tests cannot contact a real service');};
try{
 await scope('submission starts a real 72-hour pending application without creating a title or transferring roles',async h=>{
  const p=await applicant(h),before={users:count(h,'users'),staff:count(h,'staff_members'),saves:count(h,'player_saves')},first=await submit(h,p);
  assert.equal(first.receipt.status,'pending');assert.equal(first.receipt.openedAt,null);assert.equal(first.receipt.rank,null);assert.equal(first.receipt.requestedAt,h.now);assert.equal(first.receipt.deadlineAt,h.now+259200000);assert.equal(SHOGUNATE_APPROVAL_WINDOW_MS,259200000);
  const v=contract(first.shogunate,first.receipt,first.body);assert.equal(v.current,null);assert.equal(v.rights[0].approvalStatus,'pending');assert.equal(v.rights[0].governmentName,'織田幕府');assert.equal(v.palaceControl,null);assert.equal(v.canApprove,false);assert.deepEqual(v.approvals,[]);
  assert.deepEqual({users:count(h,'users'),staff:count(h,'staff_members'),saves:count(h,'player_saves')},before);
  const replay=(await h.api('/shogunate/open',post(p,first.body))).data;assert(replay.idempotent);assert.deepEqual(replay.receipt,first.receipt);assert.equal(count(h,'shogunate_approvals'),1);
  await h.api('/shogunate/open',post(p,request(p.rightId),409));
 });
 await scope('only the appointed Emperor sees and approves applications; operator and ordinary staff cannot',async h=>{
  const{operator,emperor,staff}=await court(h),p=await applicant(h);await submit(h,p);
  for(const actor of [operator,staff,p]){const v=await read(h,actor);assert.equal(v.canApprove,false);assert.deepEqual(v.approvals,[]);const blocked=await approve(h,actor,p.rightId,request(p.rightId),403);assert.equal(blocked.error.code,'SHOGUNATE_EMPEROR_REQUIRED');}
  const v=contract(await read(h,emperor));assert.equal(v.canApprove,true);assert.equal(v.approvals.length,1);assert.equal(v.approvals[0].applicant.id,p.user.id);assert.equal(v.approvals[0].applicant.name,p.user.name);
  const before=h.sql.prepare('SELECT * FROM staff_members ORDER BY user_id').all(),approved=await approve(h,emperor,p.rightId);
  assert.equal(approved.approvalReceipt.status,'approved');assert.equal(approved.approvalReceipt.approvedAt,h.now);contract(approved.shogunate);
  assert.equal(approval(h,p.rightId).approved_by,emperor.user.id);const own=contract(await read(h,p));assert.equal(own.current.rank,'征夷大将軍');assert.equal(own.current.approvalStatus,'approved');assert.equal(own.current.openedAt,h.now);assert.equal(own.palaceControl,null);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_members ORDER BY user_id').all(),before);
 });
 await scope('approval one millisecond before the deadline wins and never subjects Kyoto',async h=>{
  const{emperor}=await court(h),p=await applicant(h),first=await submit(h,p);h.now=first.receipt.deadlineAt-1;
  await approve(h,emperor,p.rightId);h.now++;
  assert.equal((await settleShogunateApprovals(h.db,h.now)).settled,0);const v=await read(h,p);assert.equal(v.current.approvalStatus,'approved');assert.equal(v.palaceControl,null);
 });
 await scope('exact deadline and offline timeout open once and establish shared Kyoto control',async h=>{
  const{emperor}=await court(h),p=await applicant(h),first=await submit(h,p);h.now=first.receipt.deadlineAt-1;
  assert.equal((await settleShogunateApprovals(h.db,h.now)).settled,0);assert.equal(right(h,p.rightId).opened_at,null);h.now++;
  assert.equal((await settleShogunateApprovals(h.db,h.now)).settled,1);assert.equal(right(h,p.rightId).opened_at,first.receipt.deadlineAt);assert.equal(approval(h,p.rightId).status,'expired');
  const control=await readPalaceControl(h.db);assert.deepEqual(control,{castleId:'kyoto_gosho',rightId:p.rightId,controller:{id:p.user.id,name:p.user.name},governmentName:'織田幕府',controlledAt:first.receipt.deadlineAt});
  const v=contract(await read(h,p));assert.equal(v.current.approvalStatus,'expired');assert.deepEqual(JSON.parse(JSON.stringify(v.palaceControl)),control);
  await approve(h,emperor,p.rightId,request(p.rightId),409);const before=snapshots(h);await settleShogunateApprovals(h.db,h.now+1);assert.deepEqual(snapshots(h),before);
  const retry=(await h.api('/shogunate/open',post(p,first.body))).data;assert(retry.idempotent);assert.deepEqual(retry.receipt,first.receipt);contract(retry.shogunate,retry.receipt,first.body);
 });
 await scope('GET settles missed deadlines after no process was running',async h=>{
  const p=await applicant(h),first=await submit(h,p);h.now=first.receipt.deadlineAt+14*86400000;
  const v=contract(await read(h,p));assert.equal(v.current.openedAt,first.receipt.deadlineAt);assert.equal(v.palaceControl.controlledAt,first.receipt.deadlineAt);assert.equal(approval(h,p.rightId).updated_at,h.now);
 });
 await scope('the unauthenticated notification tick expires applications without an online player or push subscriber',async h=>{
  configureTick(h);const p=await applicant(h),first=await submit(h,p);h.now=first.receipt.deadlineAt;
  const beforeCalls=h.calls,result=(await h.api('/notifications/tick',{method:'POST',body:{}})).data;
  assert.equal(result.ok,true);assert.notEqual(result.configured,false);assert.equal(result.sent,0);assert.equal(h.calls,beforeCalls+1);assert.equal(count(h,'notification_subscriptions'),0);
  assert.equal(approval(h,p.rightId).status,'expired');assert.equal((await readPalaceControl(h.db)).controller.id,p.user.id);
  const settled=snapshots(h);h.now+=60001;await h.api('/notifications/tick',{method:'POST',body:{}});assert.deepEqual(snapshots(h),settled);
 });
 await scope('the Worker scheduler resolves an offline deadline through waitUntil without an authenticated request',async h=>{
  configureTick(h);const p=await applicant(h),first=await submit(h,p);h.now=first.receipt.deadlineAt;const beforeCalls=h.calls,work=[];
  await worker.scheduled({scheduledTime:h.now},h.env,{waitUntil(promise){work.push(promise);}});assert.equal(work.length,1);await Promise.all(work);
  assert.equal(h.calls,beforeCalls);assert.equal(approval(h,p.rightId).status,'expired');assert.equal(right(h,p.rightId).opened_at,first.receipt.deadlineAt);assert.equal((await readPalaceControl(h.db)).rightId,p.rightId);
  const settled=snapshots(h);await worker.scheduled({},h.env,{});assert.deepEqual(snapshots(h),settled);
 });
 await scope('court and shared-field projections show the same sovereign while preserving Kyoto staff roles and protected targets',async h=>{
  await fixture(h,'地図の太政大臣',{admin:true});const official=await fixture(h,'地図の御所担当',{staff:true}),p=await applicant(h),first=await submit(h,p);
  const staffBefore=h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(official.user.id);h.now=first.receipt.deadlineAt;
  // An anonymous field read is a catch-up path in its own right; do not read
  // /shogunate first, which could mask a missing integration.
  const field=(await h.api('/field')).data;assert.equal(approval(h,p.rightId).status,'expired');assert.equal(field.palaceControl.controller.id,p.user.id);
  const palaces=field.targets.filter(target=>target.targetCastleId==='kyoto_gosho');assert(palaces.length>0);for(const target of palaces){assert.deepEqual(target.palaceControl,field.palaceControl);assert.equal(target.capturable,false);assert.equal(target.battleMode,'reward');assert.equal(target.playerId,official.user.id);}
  const courtView=(await h.api('/court',{token:official.token})).data;assert.deepEqual(courtView.palace.control,field.palaceControl);assert.equal(courtView.palace.id,'kyoto_gosho');assert.deepEqual(h.sql.prepare('SELECT * FROM staff_members WHERE user_id=?').get(official.user.id),staffBefore);
  assert.equal(h.sql.prepare('SELECT 1 FROM staff_members WHERE user_id=?').get(p.user.id),undefined);
  // Court info also catches up a later deadline independently of the field.
  h.now+=1;const q=await applicant(h,'朝廷読込の申請者'),later=await submit(h,q);h.now=later.receipt.deadlineAt;const next=(await h.api('/court',{token:official.token})).data;assert.equal(approval(h,q.rightId).status,'expired');assert.equal(next.palace.control.controller.id,q.user.id);
 });
 await scope('old pending applications stay visible after over one hundred newer earned rights and receipt replays stay bounded',async h=>{
  const p=await applicant(h),first=await submit(h,p),insert=h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event',?,'後の天下統一',?)");
  for(let n=0;n<105;n++)insert.run('sg_'+crypto.randomUUID().replaceAll('-',''),p.user.id,'new-earned-'+n,h.now+n+1);
  const normal=await read(h,p);contract(normal);assert.equal(normal.rights.length,100);assert.equal(normal.rights.filter(r=>r.id===p.rightId).length,1);assert.equal(normal.rights.find(r=>r.id===p.rightId).approvalStatus,'pending');assert.equal(normal.pendingHasMore,false);
  const replay=(await h.api('/shogunate/open',post(p,first.body))).data;contract(replay.shogunate,replay.receipt,first.body);assert.equal(replay.shogunate.rights.length,100);assert.deepEqual(replay.receipt,first.receipt);
 });
 await scope('more than one hundred pending applications prioritize oldest deadlines without losing current or requested receipts',async h=>{
  const p=await applicant(h),first=await submit(h,p),insert=h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at,government_name) VALUES(?,?,'event',?,'次の天下統一',?,'次の幕府')"),pending=h.sql.prepare("INSERT INTO shogunate_approvals(right_id,status,requested_at,deadline_at,updated_at) VALUES(?,'pending',?,?,?)");
  const legacy='sg_'+crypto.randomUUID().replaceAll('-','');insert.run(legacy,p.user.id,'legacy-current',h.now-1);h.sql.prepare('UPDATE shogunate_rights SET opened_at=? WHERE id=?').run(h.now-1,legacy);
  for(let n=0;n<105;n++){const id='sg_'+crypto.randomUUID().replaceAll('-',''),at=h.now+n+1;insert.run(id,p.user.id,'pending-extra-'+n,at);pending.run(id,at,at+SHOGUNATE_APPROVAL_WINDOW_MS,at);}
  const view=await read(h,p);contract(view);assert.equal(view.rights.length,100);assert.equal(view.pendingHasMore,true);assert(view.rights.some(r=>r.id===p.rightId));assert.equal(view.current.id,legacy);assert.equal(Math.max(...view.rights.map(r=>r.deadlineAt)),first.receipt.deadlineAt+98);
  const replay=(await h.api('/shogunate/open',post(p,first.body))).data;contract(replay.shogunate,replay.receipt,first.body);assert.equal(replay.shogunate.rights.length,100);assert(replay.shogunate.rights.some(r=>r.id===p.rightId));
  h.now+=106;const newest='sg_'+crypto.randomUUID().replaceAll('-','');insert.run(newest,p.user.id,'newest-request',h.now);const latest=await submit(h,p,request(newest));contract(latest.shogunate,latest.receipt,latest.body);assert.equal(latest.shogunate.rights.length,100);assert.equal(latest.shogunate.current.id,legacy);assert(latest.shogunate.rights.some(r=>r.id===p.rightId));assert(latest.shogunate.rights.some(r=>r.id===newest));assert.equal(latest.shogunate.pendingHasMore,true);
 });
 await scope('replayed approval preserves one receipt and rejects a reused operation for another right',async h=>{
  const{emperor}=await court(h),p=await applicant(h),q=await applicant(h,'別の申請者'),first=await submit(h,p);await submit(h,q);
  const body=request(p.rightId),a=await approve(h,emperor,p.rightId,body),replay=await approve(h,emperor,p.rightId,body);assert(replay.idempotent);assert.deepEqual(replay.approvalReceipt,a.approvalReceipt);
  const reused=await approve(h,emperor,q.rightId,{...body,rightId:q.rightId},409);assert.equal(reused.error.code,'REQUEST_ID_REUSED');assert.equal(approval(h,q.rightId).status,'pending');assert.equal(count(h,'shogunate_approval_requests'),1);
  const retry=(await h.api('/shogunate/open',post(p,first.body))).data;assert.deepEqual(retry.receipt,first.receipt);contract(retry.shogunate,retry.receipt,first.body);
 });
 await scope('simultaneous approvals have one commit and an approval versus deadline race cannot reverse either result',async h=>{
  const{emperor}=await court(h),p=await applicant(h);const submitted=await submit(h,p);
  const answers=await Promise.all([1,2].map(()=>h.api('/shogunate/approve',post(emperor,request(p.rightId),null))));assert.equal(answers.filter(r=>r.response.status===200).length,1);assert.equal(count(h,'shogunate_approval_requests'),1);
  const q=await applicant(h,'締切と競合する申請'),last=await submit(h,q);h.now=last.receipt.deadlineAt-1;
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO shogunate_approval_requests')))return;h.beforeBatch=null;await settleShogunateApprovals(h.db,last.receipt.deadlineAt);};
  await approve(h,emperor,q.rightId,request(q.rightId),409);assert.equal(approval(h,q.rightId).status,'expired');assert.equal((await readPalaceControl(h.db)).rightId,q.rightId);assert.equal(count(h,'shogunate_approval_requests'),1);assert(approval(h,p.rightId).resolved_at<submitted.receipt.deadlineAt);
 });
 await scope('revocation, replacement token, staff term and ban changes at commit cannot approve',async h=>{
  const{operator,emperor}=await court(h);
  for(const kind of ['revoke','token','term','ban']){
   await h.api('/admin/court/leader',post(operator,{targetPlayerId:emperor.user.id,requestId:crypto.randomUUID()}));const p=await applicant(h,kind+'の申請者');await submit(h,p);const before=snapshots(h);
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO shogunate_approval_requests')))return;h.beforeBatch=null;
    if(kind==='revoke')h.sql.exec('DELETE FROM court_leader');
    if(kind==='token')h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID());
    if(kind==='term')h.sql.prepare('UPDATE staff_members SET term_id=? WHERE user_id=?').run(crypto.randomUUID(),emperor.user.id);
    if(kind==='ban')h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(emperor.user.id,operator.user.id,h.now);
   };
   const r=await h.api('/shogunate/approve',post(emperor,request(p.rightId),null));assert([403,409].includes(r.response.status));assert.deepEqual(snapshots(h),before);h.resetRates();
  }
 });
 await scope('a private approval list is withdrawn if the Emperor appointment changes during final response assembly',async h=>{
  const{emperor}=await court(h),p=await applicant(h);await submit(h,p);let changed=false;
  const original=h.db.prepare.bind(h.db);h.db.prepare=function(sql){const statement=original(sql);if(sql.includes('AS applicant_name')){const bind=statement.bind.bind(statement);statement.bind=(...args)=>{const bound=bind(...args),all=bound.all.bind(bound);bound.all=async()=>{const value=await all();if(!changed){changed=true;h.sql.prepare('UPDATE court_leader SET appointment_token=?').run(crypto.randomUUID());}return value;};return bound;};}return statement;};
  const result=await h.api('/shogunate',{token:emperor.token,expected:null});assert(changed);assert.equal(result.response.status,409);assert.equal(result.data.error.code,'COURT_ACCESS_CHANGED');assert.equal(result.data.shogunate,undefined);
 });
 await scope('submission, approval and expiry each roll back all durable effects together',async h=>{
  const{emperor}=await court(h),p=await applicant(h),body=request(p.rightId),before=snapshots(h);
  h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO shogunate_requests')))statements.push(h.db.prepare('UPDATE absent_shogunate_transaction SET value=1'));};
  await h.api('/shogunate/open',post(p,body,500));assert.deepEqual(snapshots(h),before);h.beforeBatch=null;const first=await submit(h,p,body),pending=snapshots(h);
  h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO shogunate_approval_requests')))statements.push(h.db.prepare('UPDATE absent_shogunate_transaction SET value=1'));};
  await approve(h,emperor,p.rightId,request(p.rightId),500);assert.deepEqual(snapshots(h),pending);h.beforeBatch=null;h.now=first.receipt.deadlineAt;
  h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes("SET status='expired'")))statements.push(h.db.prepare('UPDATE absent_shogunate_transaction SET value=1'));};
  await assert.rejects(settleShogunateApprovals(h.db,h.now));assert.deepEqual(snapshots(h),pending);h.beforeBatch=null;assert.equal((await settleShogunateApprovals(h.db,h.now)).settled,1);
 });
 await scope('concurrent and reordered sweeps cannot overwrite newer Kyoto sovereignty with an older deadline',async h=>{
  const a=await applicant(h,'古い申請者'),first=await submit(h,a);h.now+=1000;const b=await applicant(h,'新しい申請者'),second=await submit(h,b);h.now=second.receipt.deadlineAt;
  const original=h.db.prepare.bind(h.db);let reversed=false;h.db.prepare=function(sql){const statement=original(sql);if(!reversed&&sql.includes('SELECT a.right_id FROM shogunate_approvals')){reversed=true;const bind=statement.bind.bind(statement);statement.bind=(...args)=>{const bound=bind(...args),all=bound.all.bind(bound);bound.all=async()=>{const result=await all();return{...result,results:result.results.reverse()};};return bound;};}return statement;};
  await Promise.all([settleShogunateApprovals(h.db,h.now),settleShogunateApprovals(h.db,h.now)]);assert.equal(approval(h,a.rightId).status,'expired');assert.equal(approval(h,b.rightId).status,'expired');assert(first.receipt.deadlineAt<second.receipt.deadlineAt);assert.equal((await readPalaceControl(h.db)).controller.id,b.user.id);
 });
 await scope('banned applicants are held without extending deadlines and cannot supersede newer control after restoration',async h=>{
  const{operator,emperor}=await court(h),a=await applicant(h,'停止される申請者'),first=await submit(h,a);
  h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(a.user.id,operator.user.id,h.now);
  assert.equal((await read(h,emperor)).approvals.length,0);await approve(h,emperor,a.rightId,request(a.rightId),409);
  h.now+=1;const b=await applicant(h,'有効な申請者'),second=await submit(h,b);h.now=second.receipt.deadlineAt;await settleShogunateApprovals(h.db,h.now);assert.equal(approval(h,a.rightId).status,'pending');assert.equal((await readPalaceControl(h.db)).controller.id,b.user.id);
  h.sql.prepare('UPDATE player_bans SET active=0,revision=revision+1 WHERE user_id=?').run(a.user.id);await settleShogunateApprovals(h.db,h.now);assert.equal(approval(h,a.rightId).deadline_at,first.receipt.deadlineAt);assert.equal(approval(h,a.rightId).status,'expired');assert.equal((await readPalaceControl(h.db)).controller.id,b.user.id);
 });
 await scope('pre-migration opened governments and old receipts remain historical, never retroactively subjecting Kyoto',async h=>{
  const p=await applicant(h),body=request(p.rightId),receipt={rightId:p.rightId,governmentName:'以前の幕府',rank:'征夷大将軍',openedAt:h.now-1000,title:'天下統一の功績'};
  h.sql.prepare('UPDATE shogunate_rights SET opened_at=?,government_name=?,opened_request_id=? WHERE id=?').run(receipt.openedAt,receipt.governmentName,body.requestId,p.rightId);
  const digest=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['open',p.rightId])))).toString('hex');
  h.sql.prepare('INSERT INTO shogunate_requests(user_id,request_id,right_id,request_hash,commit_token,result_json,created_at) VALUES(?,?,?,?,?,?,?)').run(p.user.id,body.requestId,p.rightId,digest,crypto.randomUUID(),JSON.stringify(receipt),receipt.openedAt);
  h.now+=10*SHOGUNATE_APPROVAL_WINDOW_MS;const v=contract(await read(h,p));assert.equal(v.current.approvalStatus,'legacy');assert.equal(v.current.openedAt,receipt.openedAt);assert.equal(v.palaceControl,null);assert.equal(count(h,'shogunate_approvals'),0);
  const replay=(await h.api('/shogunate/open',post(p,body))).data;assert.deepEqual(replay.receipt,receipt);contract(replay.shogunate,replay.receipt,body);
 });
}finally{globalThis.fetch=network;}
console.log(`${checks} Emperor approval scenarios / ${calls} API calls passed with actual frontend validation.`);
