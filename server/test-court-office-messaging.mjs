import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post} from './test-court-support.mjs';
import {messageRegister} from './message-addressing.js';

const casual='ここで待って',polite='ここで待っていただけますか';
let checks=0,calls=0;
async function scenario(name,test){
 const h=harness();try{await test(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}
function assign(h,operator,target,office='sangi',token=crypto.randomUUID()){
 h.sql.prepare('INSERT OR IGNORE INTO court_office_state(id,revision) VALUES(1,0)').run();
 h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run(office,target.user.id,token,operator.user.id,h.now);
}
function dismiss(h,target){h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(target.user.id);}
async function friends(h,a,b){
 await h.api('/friends/request',post(a,{userId:b.user.id}));
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));
}
async function chat(h,sender,target,expected=200){
 h.now+=5100;
 return(await h.api('/chat',post(sender,{channel:'friend',target:target.user.id,text:casual},expected))).data;
}
const storedMessages=h=>h.sql.prepare('SELECT COUNT(*) AS count FROM messages').get().count;
async function register(h,sender,audience){
 return messageRegister(h.db,sender.user,audience,h.now,async ids=>new Map(ids.map(id=>[id,0])),(status,code,message)=>{throw Object.assign(Error(message),{status,code});});
}
const snapshotIds=prepared=>JSON.parse(prepared.guard.args.at(-1))[3].map(row=>row[0]);
const guardMatches=(h,prepared)=>!!h.sql.prepare('SELECT 1 AS matched WHERE '+prepared.guard.sql).get(...prepared.guard.args);

await scenario('external titles determine private speech without accepting caller-supplied role claims',async h=>{
 const operator=await fixture(h,'任命する運営',{admin:true}),ordinary=await fixture(h,'一般の使者'),low=await fixture(h,'参議の使者'),high=await fixture(h,'左大臣の使者');
 assign(h,operator,low,'sangi');assign(h,operator,high,'sadaijin');
 for(const [sender,target,expected]of [[ordinary,low,polite],[low,ordinary,casual],[low,high,polite],[high,low,casual]]){
  const prepared=await register(h,sender,{kind:'person',id:target.user.id});
  assert.equal(await prepared.write(casual),expected);assert(guardMatches(h,prepared));
 }
 const forged={user:{...ordinary.user,courtOffice:{title:'太政大臣',kind:'chancellor'},isAdmin:true,isStaff:true}};
 assert.equal(await(await register(h,forged,{kind:'person',id:high.user.id})).write(casual),polite);
});

await scenario('public audiences retain every external office beyond the ordinary sample while private court recipients remain staff-only',async h=>{
 const operator=await fixture(h,'広場の運営',{admin:true}),sender=await fixture(h,'広場の送信者'),staff=await fixture(h,'御所の担当者',{staff:true});
 const sample=JSON.stringify(h.fresh());
 const seed=(id,name)=>{
  h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,name,name,'織田家','fixture-'+id,h.now,h.now);
  h.sql.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,?)').run(id,sample,h.now);
  return{user:{id,name}};
 };
 for(let i=0;i<50;i++)seed('u_aaa_sample_'+String(i).padStart(2,'0'),'広場の一般領主'+i);
 const external=seed('u_zzz_external_chunagon','最後に並ぶ中納言');assign(h,operator,external,'chunagon');
 const publicAudience=await register(h,sender,{kind:'public'}),publicIds=snapshotIds(publicAudience);
 assert(publicIds.includes(external.user.id),'An external office must never disappear behind the ordinary-player limit');
 assert(publicIds.includes(operator.user.id));assert(publicIds.includes(staff.user.id));
 assert.equal(publicIds.filter(id=>id.startsWith('u_aaa_sample_')).length,33,'The public comparison must keep its bounded ordinary audience');
 const privateIds=snapshotIds(await register(h,sender,{kind:'officials'}));
 assert.deepEqual(new Set(privateIds),new Set([operator.user.id,staff.user.id,sender.user.id]));
 assert(!privateIds.includes(external.user.id),'A title is not permission to receive a private court audience');
});

await scenario('a grant during message insertion rejects the stale register before storing text',async h=>{
 const operator=await fixture(h,'授与の運営',{admin:true}),sender=await fixture(h,'授与前の送信者'),target=await fixture(h,'授与される相手');
 await friends(h,sender,target);
 h.beforeStatement=query=>{if(!query.startsWith('INSERT INTO messages('))return;h.beforeStatement=null;assign(h,operator,target,'sangi');};
 const result=await chat(h,sender,target,409);
 assert.equal(result.error.code,'MESSAGE_AUDIENCE_CHANGED');assert.equal(storedMessages(h),0);
 assert.equal((await chat(h,sender,target)).message.text,polite);
});

await scenario('dismissal during message insertion rejects the old title and a retry uses the current register',async h=>{
 const operator=await fixture(h,'解任の運営',{admin:true}),sender=await fixture(h,'解任時の送信者'),target=await fixture(h,'解任される相手');
 assign(h,operator,target,'sangi');await friends(h,sender,target);
 h.beforeStatement=query=>{if(!query.startsWith('INSERT INTO messages('))return;h.beforeStatement=null;dismiss(h,target);};
 const result=await chat(h,sender,target,409);
 assert.equal(result.error.code,'MESSAGE_AUDIENCE_CHANGED');assert.equal(storedMessages(h),0);
 assert.equal((await chat(h,sender,target)).message.text,casual);
});

await scenario('revoke and reappoint cannot revive a captured send guard even when the final title and token match',async h=>{
 const operator=await fixture(h,'再任の運営',{admin:true}),sender=await fixture(h,'再任時の使者'),target=await fixture(h,'再任される領主'),token=crypto.randomUUID();
 assign(h,operator,target,'sangi',token);
 const prepared=await register(h,sender,{kind:'person',id:target.user.id});assert(guardMatches(h,prepared));
 dismiss(h,target);assign(h,operator,target,'sangi',token);
 assert(!guardMatches(h,prepared),'A completed dismissal must invalidate already prepared sends');
 assert.equal(await(await register(h,sender,{kind:'person',id:target.user.id})).write(casual),polite);
});

await scenario('external titles remain visitor identities and never grant private court or staff-chat access',async h=>{
 const operator=await fixture(h,'身分確認の運営',{admin:true}),external=await fixture(h,'拝謁する中納言',{score:35000}),ordinary=await fixture(h,'位階不足の参議');
 assign(h,operator,external,'chunagon');assign(h,operator,ordinary,'sangi');
 const info=(await h.api('/court',{token:external.token})).data;
 assert.equal(info.self.canRespond,false);assert.equal(info.self.canAppoint,false);assert.equal(info.self.isCourtEmperor,false);
 await h.api('/staff/court',{token:external.token,expected:403});
 await h.api('/chat',post(external,{channel:'admin',text:casual},403));
 await h.api('/court/chat',post(ordinary,{requestId:crypto.randomUUID(),text:casual},403));
 const sent=(await h.api('/court/chat',post(external,{requestId:crypto.randomUUID(),text:casual}))).data;
 assert.equal(sent.message.author.kind,'visitor');assert.equal(sent.message.author.id,external.user.id);
 assert.equal(sent.message.author.name,external.user.name);assert.equal(sent.message.author.courtOffice.title,'中納言');
});

console.log(JSON.stringify({checks,calls,productionRequests:0}));
