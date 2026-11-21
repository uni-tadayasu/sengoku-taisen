import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Only an in-memory SQLite D1 double and local.invalid Worker requests are used.
const checks=[];let totalCalls=0;
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const create=(h,a,b,text='書状の本文',extra={})=>h.api('/letters',post(a,{requestId:crypto.randomUUID(),targetPlayerId:b.user.id,destination:'player',text,...extra}));
const reply=(h,a,id,text='返信',extra={})=>h.api('/letters/'+id+'/messages',post(a,{requestId:crypto.randomUUID(),text,...extra}));
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{totalCalls+=h.calls;h.close();}}
async function people(h){return{a:await h.session('書状を送る領主'),b:await h.session('同じ城の領主甲'),c:await h.session('同じ城の領主乙'),d:await h.session('ギルドの別メンバー'),e:await h.session('別の送り主')};}
async function guild(h,owner,member){const g=(await h.api('/guild',post(owner,{name:'書状検証の同盟'}))).data.guild;if(member)await h.api('/guild/join',post(member,{guildId:g.id}));return g;}

await scope('personal letters need no friendship or save lease and target the exact player',async h=>{
  const {a,b,c}=await people(h);assert.equal(count(h,'friendships'),0);assert.equal(count(h,'player_saves'),0);
  const found=(await h.api('/letters/recipient?playerId='+b.user.id,{token:a.token})).data.player;assert.equal(found.id,b.user.id);
  const first=(await create(h,a,b,'七尾城の甲殿へ')).data,second=(await create(h,a,c,'七尾城の乙殿へ')).data;assert.notEqual(first.thread.id,second.thread.id);
  const bInbox=(await h.api('/letters',{token:b.token})).data;assert.equal(bInbox.threads.length,1);assert.equal(bInbox.threads[0].id,first.thread.id);assert.equal(bInbox.unreadCount,1);
  await h.api('/letters/'+first.thread.id,{token:c.token,expected:404});await h.api('/letters/'+second.thread.id,{token:b.token,expected:404});
  const answer=(await reply(h,b,first.thread.id,'受け取りました')).data;assert.equal(answer.thread.id,first.thread.id);assert.equal(answer.message.authorId,b.user.id);
  const reverse=(await create(h,b,a,'同じ会話にもう一通')).data;assert.equal(reverse.thread.id,first.thread.id);assert.equal(count(h,'base_letter_threads'),2);
  assert.equal((await h.api('/letters/summary',{token:a.token})).data.unreadCount,2);assert.equal(count(h,'friendships'),0);assert.equal(count(h,'player_saves'),0);
  await h.api('/letters',{expected:401});await h.api('/letters/recipient?playerId='+a.user.id,{token:a.token,expected:400});
  h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)").run(c.user.id,h.now);
  await h.api('/letters/'+first.thread.id,{token:c.token,expected:404});
});

await scope('immutable request IDs survive response loss, concurrent retries and payload conflicts',async h=>{
  const {a,b,c}=await people(h),payload={requestId:'one-letter',targetPlayerId:b.user.id,destination:'player',text:'一度だけ届ける'};
  const first=(await h.api('/letters',post(a,payload))).data;assert.equal(first.idempotent,false);
  const retry=(await h.api('/letters',post(a,payload))).data;assert.equal(retry.idempotent,true);assert.equal(retry.message.id,first.message.id);assert.equal(count(h,'base_letter_messages'),1);
  await h.api('/letters',post(a,{...payload,text:'差し替え'},409));await h.api('/letters',post(a,{...payload,targetPlayerId:c.user.id},409));assert.equal(count(h,'base_letter_messages'),1);
  const simultaneous={...payload,requestId:'simultaneous',text:'競合しても一度だけ'};let inner;
  h.beforeBatch=async statements=>{if(!statements[0].sql.includes('INSERT INTO base_letter_requests'))return;h.beforeBatch=null;inner=(await h.api('/letters',post(a,simultaneous))).data;};
  const outer=(await h.api('/letters',post(a,simultaneous))).data;assert.equal(inner.idempotent,false);assert.equal(outer.idempotent,true);assert.equal(inner.message.id,outer.message.id);assert.equal(count(h,'base_letter_messages'),2);
  const lost={...payload,requestId:'lost-after-commit',text:'応答喪失の書状'};
  h.afterBatch=async statements=>{if(!statements[0].sql.includes('INSERT INTO base_letter_requests'))return;h.afterBatch=null;throw Error('Local test: response lost after committed batch');};
  await h.api('/letters',post(a,lost,500));assert.equal(count(h,'base_letter_messages'),3);
  const recovered=(await h.api('/letters',post(a,lost))).data;assert.equal(recovered.idempotent,true);assert.equal(count(h,'base_letter_messages'),3);assert.equal(count(h,'base_letter_requests'),3);
});

await scope('guild correspondence is isolated from internal chat and from other external senders',async h=>{
  const {a,b,c,d,e}=await people(h),g=await guild(h,b,d);
  await h.api('/chat',post(b,{channel:'guild',text:'内部会議だけの秘密'}));
  const selected=(await h.api('/letters/recipient?playerId='+b.user.id,{token:a.token})).data.player;assert.equal(selected.guildId,g.id);
  const first=(await create(h,a,b,'ギルドへの外部連絡',{destination:'guild',guildId:g.id})).data;
  assert.equal(first.thread.kind,'guild');assert.equal(first.thread.guild.id,g.id);assert.equal(first.thread.sender.id,a.user.id);
  for(const actor of [a,b,d]){const data=(await h.api('/letters/'+first.thread.id,{token:actor.token})).data;assert.equal(data.messages.length,1);assert(!JSON.stringify(data).includes('内部会議だけの秘密'));}
  for(const actor of [c,e]){await h.api('/letters/'+first.thread.id,{token:actor.token,expected:404});await h.api('/letters/'+first.thread.id+'/messages',post(actor,{requestId:crypto.randomUUID(),text:'侵入'},404));}
  const second=(await create(h,e,b,'別の送り主の連絡',{destination:'guild',guildId:g.id})).data;assert.notEqual(first.thread.id,second.thread.id);await h.api('/letters/'+second.thread.id,{token:a.token,expected:404});
  const answer=(await reply(h,d,first.thread.id,'メンバーからの返信')).data;assert.equal(answer.message.authorId,d.user.id);
  assert.equal((await h.api('/letters',{token:b.token})).data.threads.length,2);assert.equal((await h.api('/letters',{token:a.token})).data.threads.length,1);
  await h.api('/guild/join',post(c,{guildId:g.id}));assert.equal((await h.api('/letters/'+first.thread.id,{token:c.token})).data.messages.length,2);
  const again=(await create(h,a,d,'同じギルドの別領主経由',{destination:'guild',guildId:g.id})).data;assert.equal(again.thread.id,first.thread.id);
});

await scope('guild membership is rechecked at send commit and old destinations never redirect',async h=>{
  const {a,b,c,d}=await people(h),g=await guild(h,b,d),other=(await h.api('/guild',post(c,{name:'移籍後の同盟'}))).data.guild;
  const old=(await create(h,a,d,'以前のギルドへの便り',{destination:'guild',guildId:g.id})).data;
  const payload={requestId:'membership-race',targetPlayerId:d.user.id,destination:'guild',guildId:g.id,text:'誤送信してはいけない書状'};
  h.beforeBatch=async statements=>{if(!statements[0].sql.includes('INSERT INTO base_letter_requests'))return;h.beforeBatch=null;h.sql.prepare('UPDATE guild_members SET guild_id=? WHERE user_id=?').run(other.id,d.user.id);};
  const result=(await h.api('/letters',post(a,payload,409))).data;assert.equal(result.error.code,'LETTER_TARGET_CHANGED');assert.equal(count(h,'base_letter_messages'),1);assert.equal(count(h,'base_letter_requests'),1);
  assert.equal((await h.api('/letters',{token:c.token})).data.threads.length,0);await h.api('/letters/'+old.thread.id,{token:d.token,expected:404});
  const oldReplay=(await h.api('/letters',post(a,{requestId:'membership-race',targetPlayerId:d.user.id,destination:'guild',guildId:g.id,text:payload.text},409))).data;assert.equal(oldReplay.error.code,'LETTER_TARGET_CHANGED');
  const oldReply=(await reply(h,a,old.thread.id,'明示した以前のギルドへ返信')).data;assert.equal(oldReply.thread.guild.id,g.id);
  const fresh=(await create(h,a,d,'新しい所属を確認した便り',{destination:'guild',guildId:other.id})).data;assert.equal(fresh.thread.guild.id,other.id);assert.notEqual(fresh.thread.id,old.thread.id);
});

await scope('former members lose read, reply, unread and replay access, including late revocation',async h=>{
  const {a,b,c,d}=await people(h),g=await guild(h,b,d),first=(await create(h,a,b,'脱退後は見られない内容',{destination:'guild',guildId:g.id})).data;
  const sentPayload={requestId:'member-reply',text:'在籍中の返信'};await h.api('/letters/'+first.thread.id+'/messages',post(d,sentPayload));
  h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(d.user.id);
  for(const path of ['/letters/'+first.thread.id,'/letters/'+first.thread.id+'?after=0'])await h.api(path,{token:d.token,expected:404});
  await h.api('/letters/'+first.thread.id+'/messages',post(d,sentPayload,404));await h.api('/letters/'+first.thread.id+'/read',post(d,{through:99999},404));assert.equal((await h.api('/letters/summary',{token:d.token})).data.unreadCount,0);assert.equal((await h.api('/letters',{token:d.token})).data.threads.length,0);
  await h.api('/guild/join',post(c,{guildId:g.id}));const before=count(h,'base_letter_messages');
  h.beforeBatch=async statements=>{if(!statements[0].sql.includes('INSERT INTO base_letter_requests'))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(c.user.id);};
  await h.api('/letters/'+first.thread.id+'/messages',post(c,{requestId:'late-revoke',text:'遅い権限剥奪'},404));assert.equal(count(h,'base_letter_messages'),before);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM base_letter_requests WHERE request_id=?').get('late-revoke').n,0);
  await h.api('/guild/join',post(c,{guildId:g.id}));
  h.beforeBatch=async statements=>{if(!statements[0].sql.includes('SELECT t.*'))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(c.user.id);};
  const read=await h.api('/letters/'+first.thread.id,{token:c.token,expected:404});assert(!JSON.stringify(read.data).includes('脱退後は見られない内容'));
  h.beforeStatement=async query=>{if(!query.includes('INSERT INTO base_letter_reads'))return;h.beforeStatement=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);};
  await h.api('/letters/'+first.thread.id+'/read',post(b,{through:99999},404));
});

await scope('unread watermarks are per member, monotone, bounded, and pagination has no gaps',async h=>{
  const {a,b,c,d}=await people(h),g=await guild(h,b,d),first=(await create(h,a,b,'一通目',{destination:'guild',guildId:g.id})).data,id=first.thread.id;
  for(let i=2;i<=7;i++)await reply(h,a,id,'書状'+i);assert.equal((await h.api('/letters/summary',{token:b.token})).data.unreadCount,7);
  const latest=(await h.api('/letters/'+id+'?limit=2',{token:b.token})).data;assert.equal(latest.messages.length,2);assert(latest.hasOlder);assert.equal(latest.messages[1].text,'書状7');
  const older=(await h.api('/letters/'+id+'?limit=2&before='+latest.nextBefore,{token:b.token})).data;assert.equal(older.messages[1].text,'書状5');assert(older.messages[1].seq<latest.messages[0].seq);
  const all=[];let after=0,more=true;while(more){const page=(await h.api('/letters/'+id+'?limit=2&after='+after,{token:b.token})).data;all.push(...page.messages);after=page.messages.at(-1)?.seq||after;more=page.hasNewer;}assert.equal(all.length,7);assert.equal(new Set(all.map(m=>m.id)).size,7);assert.deepEqual(all.map(m=>m.seq),[...all.map(m=>m.seq)].sort((x,y)=>x-y));
  await h.api('/letters/'+id+'/read',post(b,{through:all[2].seq}));assert.equal((await h.api('/letters/summary',{token:b.token})).data.unreadCount,4);assert.equal((await h.api('/letters/summary',{token:d.token})).data.unreadCount,7);
  await h.api('/letters/'+id+'/read',post(b,{through:all[0].seq}));assert.equal((await h.api('/letters/summary',{token:b.token})).data.unreadCount,4);
  const clamped=(await h.api('/letters/'+id+'/read',post(b,{through:Number.MAX_SAFE_INTEGER}))).data;assert.equal(clamped.through,all[6].seq);assert.equal(clamped.unreadCount,0);
  await reply(h,a,id,'新たな未読');assert.equal((await h.api('/letters/summary',{token:b.token})).data.unreadCount,1);await h.api('/letters/'+id+'?before=2&after=1',{token:b.token,expected:400});
  await create(h,a,b,'本人宛');await create(h,a,c,'別の本拠宛');const page1=(await h.api('/letters?limit=2',{token:a.token})).data;assert.equal(page1.threads.length,2);assert(page1.nextCursor);const page2=(await h.api('/letters?limit=2&cursor='+encodeURIComponent(page1.nextCursor),{token:a.token})).data;assert.equal(page2.threads.length,1);assert.equal(new Set([...page1.threads,...page2.threads].map(t=>t.id)).size,3);
});

await scope('plain text validation, Unicode limits, strict payloads and budget preserve accepted replays',async h=>{
  const {a,b}=await people(h),text='<img src=x onerror=alert(1)>\n<strong>文字列のまま</strong>',accepted=(await create(h,a,b,text)).data;assert.equal(accepted.message.text,text);assert.equal((await h.api('/letters/'+accepted.thread.id,{token:b.token})).data.messages[0].text,text);
  assert.equal((await create(h,a,b,'🦉'.repeat(1000))).data.message.text,'🦉'.repeat(1000));
  const basic={requestId:'invalid',targetPlayerId:b.user.id,destination:'player',text:'本文'};
  for(const change of [{text:'🦉'.repeat(1001)},{text:'   '},{text:'x\u0000y'},{destination:'world'},{targetPlayerId:a.user.id},{requestId:'bad/id'},{text:123},{guildId:'fake'},{userId:a.user.id}])await h.api('/letters',post(a,{...basic,...change},400));
  const nfc=(await create(h,a,b,'  か\u3099  ')).data;assert.equal(nfc.message.text,'が');
  await h.api('/letters?limit=101',{token:a.token,expected:400});await h.api('/letters?cursor=broken',{token:a.token,expected:400});await h.api('/letters/not-a-thread',{token:a.token,expected:404});
  h.resetRates();const payload={...basic,requestId:'budget-replay'};await h.api('/letters',post(a,payload));for(let i=1;i<20;i++)await h.api('/letters',post(a,{...payload,requestId:'budget-'+i}));await h.api('/letters',post(a,{...payload,requestId:'over-budget'},429));assert.equal((await h.api('/letters',post(a,payload))).data.idempotent,true);
});

await scope('failed message inserts roll back receipt, thread and unread state atomically',async h=>{
  const {a,b}=await people(h),payload={requestId:'rollback-retry',targetPlayerId:b.user.id,destination:'player',text:'一括保存の検証'};
  h.sql.exec("CREATE TRIGGER fail_letter_insert BEFORE INSERT ON base_letter_messages BEGIN SELECT RAISE(ABORT,'Local test transaction failure'); END");
  await h.api('/letters',post(a,payload,500));for(const table of ['base_letter_requests','base_letter_threads','base_letter_messages'])assert.equal(count(h,table),0);
  h.sql.exec('DROP TRIGGER fail_letter_insert');const result=(await h.api('/letters',post(a,payload))).data;assert.equal(result.idempotent,false);assert.equal(count(h,'base_letter_messages'),1);assert.equal((await h.api('/letters/summary',{token:b.token})).data.unreadCount,1);
});

console.log(JSON.stringify({passed:checks.length,localHttpCalls:totalCalls,productionRequests:0}));
