import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,appoint} from './test-court-support.mjs';

const casual='ここで待って',polite='ここで待っていただけますか';
let checks=0,calls=0;
async function scenario(label,test){
 const h=harness();try{await test(h);checks++;console.log('PASS '+label);}finally{calls+=h.calls;h.close();}
}
async function chat(h,actor,channel,target=null,text=casual,expected=200,extra={}){
 h.now+=5100;
 return (await h.api('/chat',post(actor,{channel,target,text,...extra},expected))).data;
}
async function letter(h,actor,target,text=casual,extra={},expected=200){
 return (await h.api('/letters',post(actor,{requestId:crypto.randomUUID(),destination:'player',targetPlayerId:target.user.id,text,...extra},expected))).data;
}
async function reply(h,actor,threadId,text=casual,expected=200){
 return (await h.api('/letters/'+threadId+'/messages',post(actor,{requestId:crypto.randomUUID(),text},expected))).data;
}
async function friends(h,a,b){
 await h.api('/friends/request',post(a,{userId:b.user.id}));
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));
}
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;

await scenario('upward, downward and equal-rank friend chat and letters use the actual recipient and preserve stored text on replay',async h=>{
 const senior=await fixture(h,'上位の領主',{score:35000}),junior=await h.session('新規の領主'),peer=await h.session('同位の領主');
 await friends(h,senior,junior);
 const up=await chat(h,junior,'friend',senior.user.id,casual,200,{isAdmin:true,rankIndex:99,convert:false});
 assert.equal(up.message.text,polite);
 assert.equal(h.sql.prepare('SELECT body FROM messages WHERE id=?').get(up.message.id).body,polite);
 assert.equal((await chat(h,senior,'friend',junior.user.id)).message.text,casual);
 assert.equal((await letter(h,junior,peer)).message.text,casual);
 const request={requestId:crypto.randomUUID()},first=await letter(h,junior,senior,casual,request);
 assert.equal(first.message.text,polite);assert.equal((await reply(h,senior,first.thread.id)).message.text,casual);
 assert.equal((await reply(h,junior,first.thread.id)).message.text,polite);
 assert.equal((await letter(h,junior,senior,'別の本文',request,409)).error.code,'LETTER_REQUEST_REUSED');
 h.sql.prepare('UPDATE player_saves SET save_json=NULL,revision=revision+1 WHERE user_id=?').run(senior.user.id);
 const replay=await letter(h,junior,senior,casual,request);assert(replay.idempotent);assert.equal(replay.message.id,first.message.id);assert.equal(replay.message.text,polite);
 assert.equal((await reply(h,junior,first.thread.id)).message.text,casual);
 assert(!JSON.stringify(first.message).includes('isStaff'));
});

await scenario('public office precedence, guild audience, outside guild-letter sender and application reviewers are derived by the Worker',async h=>{
 const chancellor=await fixture(h,'宰相',{admin:true}),official=await fixture(h,'参議役',{staff:true}),regular=await h.session('通常の領主'),other=await h.session('同盟外の領主');
 await appoint(h,official);
 assert.equal((await letter(h,chancellor,official)).message.text,polite);
 assert.equal((await letter(h,official,chancellor)).message.text,casual);
 assert.equal((await chat(h,chancellor,'admin')).message.text,polite);
 assert.equal((await chat(h,official,'admin')).message.text,casual);
 const guild=(await h.api('/guild',post(regular,{name:'敬語検証の同盟'}))).data.guild;
 await h.api('/guild/join',post(other,{guildId:guild.id}));
 assert.equal((await chat(h,other,'guild',guild.id)).message.text,casual);
 await h.api('/guild/join',post(official,{guildId:guild.id}));
 assert.equal((await chat(h,other,'guild',guild.id)).message.text,polite);
 assert.equal((await chat(h,official,'guild',guild.id)).message.text,casual);
 const outside=await letter(h,chancellor,regular,casual,{destination:'guild',guildId:guild.id});
 assert.equal(outside.message.text,polite);
 await h.api('/guild/leave',post(official,{guildId:guild.id}));
 assert.equal((await reply(h,regular,outside.thread.id)).message.text,polite,'The outside sender still reads replies');
 await h.api('/guild/join',post(official,{guildId:guild.id}));
 const operation=await h.api('/alliance/operations/create',post(regular,{requestId:crypto.randomUUID(),kind:'gather',title:'集合',note:casual,castleId:'kiyosu',startsAt:h.now,expiresAt:h.now+3600000}));
 assert.equal(h.sql.prepare('SELECT note FROM alliance_operations WHERE id=?').get(operation.data.result.operationId).note,polite);
 const applicant=await h.session('申請する領主');
 const officeGuild=(await h.api('/guild',post(chancellor,{name:'上位の同盟'}))).data.guild;
 await h.api('/alliance/apply',post(applicant,{requestId:crypto.randomUUID(),guildId:officeGuild.id,message:casual}));
 assert.equal(h.sql.prepare('SELECT message FROM alliance_applications WHERE guild_id=? AND user_id=?').get(officeGuild.id,applicant.user.id).message,polite);
 const privileged=await h.api('/admin/mail',post(chancellor,{requestId:crypto.randomUUID(),target:official.user.id,title:'確認',body:casual}));
 assert.equal(h.sql.prepare('SELECT body FROM mail_campaigns WHERE id=?').get(privileged.data.mailId).body,polite);
});

await scenario('the court register follows current offices and a private official reply follows the actual petitioner',async h=>{
 const chancellor=await fixture(h,'公家の宰相',{admin:true}),official=await fixture(h,'内裏の担当',{staff:true}),visitor=await fixture(h,'参内の領主',{score:35000});
 const sent=(await h.api('/court/chat',post(visitor,{requestId:crypto.randomUUID(),text:casual}))).data;
 assert.equal(sent.message.text,polite);
 const req={requestId:crypto.randomUUID(),title:'城からの使者',text:casual};
 const opened=(await h.api('/court/audiences',post(visitor,req))).data;
 assert.equal(opened.message.text,polite);
 const answer=(await h.api('/court/audiences/'+opened.thread.id+'/replies',post(official,{requestId:crypto.randomUUID(),text:casual}))).data;
 assert.equal(answer.message.text,casual);assert.equal(answer.message.author.name,'朝廷');assert.equal(answer.message.author.id,null);
 const thread=(await h.api('/court/audiences/'+opened.thread.id,{token:visitor.token})).data;
 assert.deepEqual(thread.messages.map(m=>m.text),[polite,casual]);
 await appoint(h,official);
 assert.equal((await chat(h,chancellor,'world',visitor.user.id,casual,200,{honorific:false})).message.text,polite);
 assert.equal((await chat(h,official,'world',visitor.user.id)).message.text,casual);
});

await scenario('speech and audience membership are fenced at write time, rejected expansions do not store truncated letters',async h=>{
 const junior=await h.session('下位の使者'),peer=await h.session('同位の使者'),higher=await fixture(h,'高位の使者',{score:35000});
 const before=count(h,'base_letter_messages');
 const original='あ'.repeat(999)+'。',rejected=await letter(h,junior,higher,original,{},400);
 assert.equal(rejected.error.code,'POLITE_TEXT_TOO_LONG');assert.equal(count(h,'base_letter_messages'),before);
 const equal=await letter(h,junior,peer,original);assert.equal(Array.from(equal.message.text).length,1000);
 await friends(h,junior,peer);
 h.beforeStatement=async query=>{
  if(!query.startsWith('INSERT INTO messages('))return;
  h.beforeStatement=null;
  await h.api('/admin/claim',post(peer,{key:h.env.SENGOKU_ADMIN_KEY}));
 };
 const race=await chat(h,junior,'friend',peer.user.id,casual,409);assert.equal(race.error.code,'MESSAGE_AUDIENCE_CHANGED');assert.equal(count(h,'messages'),0);
 assert.equal((await chat(h,junior,'friend',peer.user.id)).message.text,polite);
 const owner=await h.session('同盟の主'),member=await h.session('同盟の使者');
 const guild=(await h.api('/guild',post(owner,{name:'権限競合の同盟'}))).data.guild;await h.api('/guild/join',post(member,{guildId:guild.id}));
 h.beforeBatch=async statements=>{
  if(!statements.some(s=>s.sql.includes('INSERT INTO base_letter_requests')))return;
  h.beforeBatch=null;await h.api('/guild/join',post(peer,{guildId:guild.id}));
 };
 const overlapping=await letter(h,junior,owner,casual,{destination:'guild',guildId:guild.id},409);
 assert.equal(overlapping.error.code,'MESSAGE_AUDIENCE_CHANGED');
 assert.equal((await letter(h,junior,owner,casual,{destination:'guild',guildId:guild.id})).message.text,polite);
});

await scenario('large public audiences have a bounded courtesy rule, private equal-rank recipients remain unchanged',async h=>{
 const speaker=await h.session('広場の領主'),peer=await h.session('別の領主');
 assert.equal((await chat(h,speaker,'world')).message.text,casual);
 const sample=JSON.stringify(h.fresh());
 for(let i=0;i<35;i++){
  const id='u_bound_'+i,name='広場の領主'+i;
  h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,name,name,'織田家','local-'+id,h.now,h.now);
  h.sql.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,?)').run(id,sample,h.now);
 }
 let decoded=0;
 h.beforeBatch=statements=>{for(const q of statements)if(q.sql.includes('/* player-evaluation */'))decoded+=q.params.length;};
 assert.equal((await chat(h,speaker,'world')).message.text,polite);
 assert(decoded<=1,'Broad public sends must not decode the saved world population'); // response decoration may load the sender.
 assert.equal((await letter(h,speaker,peer)).message.text,casual);
});
console.log(JSON.stringify({checks,calls,productionRequests:0}));
