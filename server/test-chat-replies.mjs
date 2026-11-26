import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {fixture} from './test-court-support.mjs';

// Exercise the actual Worker, D1 statements and additive migrations. No live
// accounts or messages are created by this test.
const post=(actor,body,expected=200)=>({method:'POST',token:actor.token,body,expected});
const count=h=>Number(h.sql.prepare('SELECT COUNT(*) n FROM messages').get().n);
const messageRead=statements=>statements.some(s=>s.sql.includes('FROM messages m')&&s.sql.includes('CROSS JOIN moderation_state'));
async function chat(h,actor,channel='world',extra={},expected=200){h.now+=5100;return(await h.api('/chat',post(actor,{channel,text:'会話を確認します。',...extra},expected))).data;}
async function friends(h,a,b){await h.api('/friends/request',post(a,{userId:b.user.id}));await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));}
async function guild(h,owner,members=[]){const g=(await h.api('/guild',post(owner,{name:'返信を検証する同盟'}))).data.guild;for(const member of members)await h.api('/guild/join',post(member,{guildId:g.id}));return g;}
async function operator(h,actor){await h.api('/admin/claim',post(actor,{key:h.env.SENGOKU_ADMIN_KEY}));}
async function staff(h,admin,actor){await h.api('/admin/staff',post(admin,{targetPlayerId:actor.user.id,action:'appoint',requestId:crypto.randomUUID()}));}
let checks=0,calls=0;
async function scenario(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}

// A pre-upgrade message and the unmodified old INSERT must survive the new
// columns, independently of the current request implementation.
{
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 try{
  const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries;
  const apply=entry=>{for(const part of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(part);};
  for(const entry of entries.filter(e=>e.idx<36))apply(entry);
  sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run('u_legacy','以前の領主','legacy','織田家','hash',1,1);
  const oldInsert=sql.prepare('INSERT INTO messages(room_key,channel,user_id,body,created_at) VALUES(?,?,?,?,?)');
  oldInsert.run('world','world','u_legacy','移行前の本文',1);
  apply(entries.find(e=>e.idx===36));
  oldInsert.run('world','world','u_legacy','旧WorkerのINSERT',2);
  for(const row of sql.prepare('SELECT * FROM messages ORDER BY id').all()){assert.equal(row.reply_to_id,null);assert.equal(row.mentions_json,'[]');}
  assert.equal(sql.prepare('SELECT COUNT(*) n FROM messages').get().n,2);
  checks++;console.log('PASS existing rows and old-worker INSERT keep additive-column defaults');
 }finally{sql.close();}
}

await scenario('legacy clients, bounded Unicode reply previews, explicit mentions and live names',async h=>{
 const a=await h.session('返信する領主'),b=await h.session('名前が変わる領主');
 const legacy=(await chat(h,b,'world',{text:'🏯'.repeat(121)})).message;
 assert.equal(legacy.replyToId,null);assert.equal(legacy.replyTo,null);assert.deepEqual(legacy.mentions,[]);
 const sent=(await chat(h,a,'world',{replyToId:legacy.id,mentionIds:[b.user.id],replyTo:{text:'偽造引用'},mentions:[{userId:b.user.id,name:'偽造名'}]})).message;
 assert.equal(sent.replyToId,legacy.id);assert.equal(sent.replyTo.userId,b.user.id);assert.equal(sent.replyTo.text,'🏯'.repeat(120));assert.equal(sent.replyTo.truncated,true);
 assert.deepEqual(sent.mentions.map(m=>({userId:m.userId,name:m.name,avatarVersion:m.avatarVersion})),[{userId:b.user.id,name:b.user.name,avatarVersion:null}]);
 const stored=h.sql.prepare('SELECT reply_to_id,mentions_json FROM messages WHERE id=?').get(sent.id);
 assert.equal(stored.reply_to_id,legacy.id);assert.deepEqual(JSON.parse(stored.mentions_json),[b.user.id]);
 await h.api('/profile',{method:'PATCH',token:b.token,body:{name:'改名した領主'}});
 const read=(await h.api('/chat?channel=world',{token:a.token})).data.messages.find(m=>m.id===sent.id);
 assert.equal(read.replyTo.name,'改名した領主');assert.equal(read.mentions[0].name,'改名した領主');assert.equal(read.mentions[0].avatarVersion,null);
 assert(!JSON.stringify(read).includes('isAdmin'));assert(!JSON.stringify(read).includes('isStaff'));assert.equal(read.replyTo.replyTo,undefined);
 const health=(await h.api('/health')).data;assert(health.features.chatReplies&&health.features.chatMentions);
 const full=await chat(h,a,'world',{text:'🏯'.repeat(300)});assert.equal(Array.from(full.message.text).length,300);
 const throttled=await h.api('/chat',post(a,{channel:'world',text:'続けて送信'},429));assert.equal(throttled.data.error.code,'RATE_LIMITED');
 await chat(h,a,'world',{text:'🏯'.repeat(301)},400);
});

await scenario('metadata accepts only positive IDs and at most eight distinct valid recipients',async h=>{
 const a=await h.session('検証する領主'),b=await h.session('メンション相手');
 const before=count(h);
 for(const replyToId of [0,-1,1.25,'1',{},[],Number.MAX_SAFE_INTEGER+1])assert.equal((await chat(h,a,'world',{replyToId},400)).error.code,'INVALID_REPLY');
 for(const mentionIds of [null,{},'u_value',[null],[{}],['<script>'],[b.user.id,b.user.id],Array.from({length:9},(_,i)=>'u_'+i)])assert.equal((await chat(h,a,'world',{mentionIds},400)).error.code,'INVALID_MENTIONS');
 assert.equal((await chat(h,a,'world',{replyToId:999999},400)).error.code,'CHAT_REPLY_UNAVAILABLE');
 assert.equal((await chat(h,a,'world',{mentionIds:['u_missing']},400)).error.code,'CHAT_MENTION_UNAVAILABLE');
 assert.equal(count(h),before);
 const targets=[a,b];for(let i=0;i<6;i++){h.resetRates();targets.push(await h.session('上限検証'+i));}
 assert.equal((await chat(h,a,'world',{mentionIds:targets.map(p=>p.user.id)})).message.mentions.length,8);
});

await scenario('honorific conversion keeps explicit recipient IDs and the transformed reply body',async h=>{
 const senior=await fixture(h,'敬語の相手',{score:35000}),junior=await h.session('敬語で返す領主');await friends(h,senior,junior);
 const parent=(await chat(h,senior,'friend',{target:junior.user.id,text:'確認をお願いします。'})).message;
 const text='@敬語の相手 ここで待って';
 const legacy=(await chat(h,junior,'friend',{target:senior.user.id,text})).message;
 const enhanced=(await chat(h,junior,'friend',{target:' '+senior.user.id+' ',text,replyToId:parent.id,mentionIds:[senior.user.id]})).message;
 assert.notEqual(enhanced.text,text);assert.equal(enhanced.text,legacy.text);assert.equal(enhanced.mentions[0].userId,senior.user.id);assert.equal(enhanced.mentions[0].name,senior.user.name);
 assert.equal(enhanced.replyTo.text,parent.text);assert.equal(enhanced.replyTo.id,parent.id);
 assert.equal(h.sql.prepare('SELECT body FROM messages WHERE id=?').get(enhanced.id).body,enhanced.text);
 assert((await h.api('/chat?channel=friend&target='+encodeURIComponent(' '+senior.user.id+' '),{token:junior.token})).data.messages.some(m=>m.id===enhanced.id));
});

await scenario('reply IDs cannot cross world, guild, friend or operator rooms',async h=>{
 const a=await h.session('兼任する領主'),b=await h.session('同盟の仲間'),c=await h.session('別の友達');
 await operator(h,a);await staff(h,a,b);const g=await guild(h,a,[b]);await friends(h,a,b);await friends(h,a,c);
 const sources=[];
 for(const [channel,target] of [['world',null],['guild',g.id],['friend',b.user.id],['admin',null]])sources.push({channel,target,message:(await chat(h,a,channel,{target,text:'非公開本文:'+channel})).message});
 for(const source of sources){
  const destination=source.channel==='world'?'guild':'world',target=destination==='guild'?g.id:null;
  const denied=await chat(h,a,destination,{target,replyToId:source.message.id},400);
  assert.equal(denied.error.code,'CHAT_REPLY_UNAVAILABLE');assert(!JSON.stringify(denied).includes('非公開本文:'));
 }
 assert.equal((await chat(h,a,'friend',{target:c.user.id,replyToId:sources[2].message.id},400)).error.code,'CHAT_REPLY_UNAVAILABLE');
 for(const source of sources){const result=await chat(h,a,source.channel,{target:source.target,replyToId:source.message.id});assert.equal(result.message.replyTo.id,source.message.id);}
 await h.api('/chat?channel=admin',{token:c.token,expected:403});await h.api('/chat?channel=guild&target='+g.id,{token:c.token,expected:403});
});

await scenario('mention scope uses current guild membership, friend pair and operator roster',async h=>{
 const a=await h.session('メンションする盟主'),b=await h.session('同盟員'),outside=await h.session('同盟外');
 await operator(h,a);await staff(h,a,b);const g=await guild(h,a,[b]);await friends(h,a,b);
 for(const [channel,target] of [['guild',g.id],['friend',b.user.id],['admin',null]]){
  assert.equal((await chat(h,a,channel,{target,mentionIds:[outside.user.id]},400)).error.code,'CHAT_MENTION_UNAVAILABLE');
  assert.deepEqual((await chat(h,a,channel,{target,mentionIds:[b.user.id,a.user.id]})).message.mentions.map(m=>m.userId),[b.user.id,a.user.id]);
 }
 assert.equal((await chat(h,a,'world',{mentionIds:[outside.user.id]})).message.mentions[0].userId,outside.user.id);
 const parent=(await chat(h,b,'guild',{text:'退出前の連絡'})).message;
 await h.api('/guild/leave',post(b,{guildId:g.id}));
 assert.equal((await chat(h,a,'guild',{replyToId:parent.id})).message.replyTo.text,parent.text);
 assert.equal((await chat(h,a,'guild',{mentionIds:[b.user.id]},400)).error.code,'CHAT_MENTION_UNAVAILABLE');
});

await scenario('moderation removes referenced bodies without copying them into replies or mention metadata',async h=>{
 const admin=await h.session('削除を検証する運営'),author=await h.session('引用される領主'),reply=await h.session('返信を残す領主');
 await operator(h,admin);
 const parent=(await chat(h,author,'world',{text:'削除する引用本文'})).message;
 const child=(await chat(h,reply,'world',{replyToId:parent.id,mentionIds:[author.user.id]})).message;
 await h.api('/admin/moderation',post(admin,{targetPlayerId:author.user.id,action:'ban',expectedRevision:0,requestId:crypto.randomUUID()}));
 const data=(await h.api('/chat?channel=world&after='+child.id+'&contentRevision=0',{token:reply.token})).data;
 assert(data.reset);assert(data.contentRevision>0);assert(!JSON.stringify(data).includes('削除する引用本文'));
 const remaining=data.messages.find(m=>m.id===child.id);assert.deepEqual(remaining.replyTo,{id:parent.id,unavailable:true});assert.deepEqual(remaining.mentions,[]);
 assert.equal((await chat(h,reply,'world',{replyToId:parent.id},400)).error.code,'CHAT_REPLY_UNAVAILABLE');
 assert.equal((await chat(h,reply,'world',{mentionIds:[author.user.id]},400)).error.code,'CHAT_MENTION_UNAVAILABLE');
 const columns=h.sql.prepare('PRAGMA table_info(messages)').all().map(row=>row.name);
 assert.deepEqual(columns.filter(name=>/reply|mention/.test(name)),['reply_to_id','mentions_json']);
});

await scenario('parent deletion and recipient departure are checked again in the INSERT',async h=>{
 const a=await h.session('競合を検証する領主'),b=await h.session('競合する宛先');const g=await guild(h,a,[b]);
 const parent=(await chat(h,b,'guild',{text:'競合する返信先'})).message;
 let hit=false;const before=count(h);
 h.beforeStatement=query=>{if(query.startsWith('INSERT INTO messages(')){h.beforeStatement=null;hit=true;h.sql.prepare('DELETE FROM messages WHERE id=?').run(parent.id);}};
 assert.equal((await chat(h,a,'guild',{replyToId:parent.id},409)).error.code,'CHAT_CONTEXT_CHANGED');assert(hit);assert.equal(count(h),before-1);
 hit=false;
 h.beforeStatement=query=>{if(query.startsWith('INSERT INTO messages(')){h.beforeStatement=null;hit=true;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);}};
 assert.equal((await chat(h,a,'guild',{target:g.id,mentionIds:[b.user.id]},409)).error.code,'CHAT_CONTEXT_CHANGED');assert(hit);assert.equal(count(h),before-1);
});

await scenario('friend revocation is enforced inside reads and writes and after response projection',async h=>{
 const a=await h.session('友情を検証する領主'),b=await h.session('会話する友達');await friends(h,a,b);
 const parent=(await chat(h,b,'friend',{target:a.user.id,text:'二人だけの本文'})).message;
 const revoke=()=>h.sql.exec('DELETE FROM friendships');let hit=false;
 h.beforeBatch=statements=>{if(messageRead(statements)){h.beforeBatch=null;hit=true;revoke();}};
 const denied=(await h.api('/chat?channel=friend&target='+b.user.id,{token:a.token,expected:403})).data;
 assert(hit);assert.equal(denied.error.code,'FRIENDSHIP_REQUIRED');assert.equal(denied.messages,undefined);
 await friends(h,a,b);hit=false;const before=count(h);
 h.beforeStatement=query=>{if(query.startsWith('INSERT INTO messages(')){h.beforeStatement=null;hit=true;revoke();}};
 assert.equal((await chat(h,a,'friend',{target:b.user.id,replyToId:parent.id,mentionIds:[b.user.id]},403)).error.code,'FRIENDSHIP_REQUIRED');assert(hit);assert.equal(count(h),before);
 await friends(h,a,b);hit=false;
 h.afterBatch=statements=>{if(messageRead(statements)){h.afterBatch=null;hit=true;revoke();}};
 const final=(await h.api('/chat?channel=friend&target='+b.user.id,{token:a.token,expected:403})).data;
 assert(hit);assert.equal(final.error.code,'FRIENDSHIP_REQUIRED');assert(!JSON.stringify(final).includes('二人だけの本文'));
});

await scenario('a purge after the message snapshot cannot return stale quoted text',async h=>{
 const a=await h.session('返却競合の領主'),b=await h.session('削除対象の引用元');
 const parent=(await chat(h,b,'world',{text:'返してはいけない引用'})).message;
 await chat(h,a,'world',{replyToId:parent.id});let hit=false;
 h.afterBatch=statements=>{if(messageRead(statements)){h.afterBatch=null;hit=true;h.sql.prepare('DELETE FROM messages WHERE id=?').run(parent.id);h.sql.exec('UPDATE moderation_state SET content_revision=content_revision+1 WHERE id=1');}};
 const result=(await h.api('/chat?channel=world',{token:a.token,expected:409})).data;
 assert(hit);assert.equal(result.error.code,'CONTENT_CHANGED');assert(!JSON.stringify(result).includes('返してはいけない引用'));
});

console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
