import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';

const database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
for(const entry of journal.entries){
  const migration=readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8');
  for(const sql of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(sql);
}
const db={
  lastError:null,
  prepare(sql){return this.statement(sql,[]);},
  statement(sql,params){
    const runAll=()=>{try{return database.prepare(sql).all(...params);}catch(error){db.lastError={sql,error:String(error)};throw error;}};
    return {sql,params,
      bind(...next){return db.statement(sql,next);},
      async first(){return runAll()[0]||null;},
      async all(){return {results:runAll(),success:true};},
      async run(){try{const result=database.prepare(sql).run(...params);return {results:[],success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}catch(error){db.lastError={sql,error:String(error)};throw error;}}
    };
  },
  async batch(statements){
    database.exec('BEGIN IMMEDIATE');
    try{const results=statements.map(s=>{try{return {results:database.prepare(s.sql).all(...s.params),success:true};}catch(error){db.lastError={sql:s.sql,error:String(error)};throw error;}});database.exec('COMMIT');return results;}
    catch(error){database.exec('ROLLBACK');throw error;}
  }
};
const env={DB:db,SENGOKU_ADMIN_KEY:crypto.randomUUID()+crypto.randomUUID()};
let clock=1795190400000;
const originalNow=Date.now;
Date.now=()=>clock;
const tick=(n=6000)=>{clock+=n;};
let calls=0;
async function api(path,{method='GET',token,body,origin='http://127.0.0.1:4173',ip,expected=200,rawBody}={}){
  const headers={};
  if(origin!==null)headers.Origin=origin;
  if(token)headers.Authorization='Bearer '+token;
  if(ip)headers['CF-Connecting-IP']=ip;
  if(body!==undefined||rawBody!==undefined)headers['Content-Type']='application/json';
  const request=new Request('https://communications.example'+path,{method,headers,body:rawBody??(body!==undefined?JSON.stringify(body):undefined)});
  const res=await worker.fetch(request,env,{waitUntil(){}});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{data=text;}
  calls++;
  assert.equal(res.status,expected,JSON.stringify({path,expected,actual:res.status,data,sqlError:db.lastError}));
  assert.equal(res.headers.get('cache-control'),'no-store');
  assert.equal(res.headers.get('x-content-type-options'),'nosniff');
  return {data,res};
}
async function session(name){return (await api('/api/v1/session',{method:'POST',body:{name,clan:'織田家'}})).data;}
const auth=(s,body)=>({method:'POST',token:s.token,body});

try{
  await api('/api/v1/health');
  const initial=await api('/api/v1/config');assert.equal(initial.data.adminClaimed,false);
  await api('/api/v1/me',{expected:401});
  await api('/api/v1/session',{method:'POST',body:{name:'禁止された接続'},origin:'https://untrusted.example',expected:403});
  const nullCors=await api('/api/v1/config',{origin:'null'});assert.equal(nullCors.res.headers.get('access-control-allow-origin'),'null');
  const domainCors=await api('/api/v1/config',{origin:'https://www.kasai-solutions-inc.com'});assert.equal(domainCors.res.headers.get('access-control-allow-origin'),'https://www.kasai-solutions-inc.com');
  const domainPreflight=await api('/api/v1/me',{method:'OPTIONS',origin:'https://www.kasai-solutions-inc.com',expected:204});assert.equal(domainPreflight.res.headers.get('access-control-allow-origin'),'https://www.kasai-solutions-inc.com');
  await api('/api/v1/config',{origin:'https://www.kasai-solutions-inc.com.attacker.example',expected:403});
  await api('/api/v1/config',{origin:'http://www.kasai-solutions-inc.com',expected:403});
  const oldDomainCors=await api('/api/v1/config',{origin:'https://uni-tadayasu.github.io'});assert.equal(oldDomainCors.res.headers.get('access-control-allow-origin'),'https://uni-tadayasu.github.io');
  const preflight=await api('/api/v1/config',{method:'OPTIONS',expected:204});assert.equal(preflight.res.headers.get('access-control-allow-credentials'),null);
  await api('/api/v1/session',{method:'POST',rawBody:'x'.repeat(17000),expected:413});

  const a=await session('赤備え領主'),b=await session('青備え領主'),c=await session('緑備え領主'),d=await session('試験領主');
  assert.notEqual(a.token,b.token);assert.equal(a.token.length,43);
  const tokenRows=database.prepare('SELECT token_hash FROM users').all();assert(tokenRows.every(r=>r.token_hash.length===64&&r.token_hash!==a.token));
  await api('/api/v1/session',{method:'POST',body:{name:a.user.name},expected:409});
  const defaults=await api('/api/v1/session',{method:'POST',body:{}});assert.match(defaults.data.user.name,/^旅の領主/);
  const profile=await api('/api/v1/profile',{method:'PATCH',token:c.token,body:{name:'緑備えの領主',isAdmin:true,role:'admin'}});assert.equal(profile.data.user.isAdmin,false);
  const search=await api('/api/v1/players?q='+encodeURIComponent('備え'),{token:a.token});assert(search.data.players.length>=2);
  await api('/api/v1/players?q=x',{token:a.token,expected:400});
  const injectable=await session("木下' OR 1=1--");
  const escapedSearch=await api('/api/v1/players?q='+encodeURIComponent("' OR"),{token:a.token});assert.equal(escapedSearch.data.players.length,1);assert.equal(escapedSearch.data.players[0].id,injectable.user.id);

  const post=await api('/api/v1/chat',auth(a,{channel:'world',text:'天下の皆さま、よろしく。',userId:b.user.id,isAdmin:true}));assert.equal(post.data.message.userId,a.user.id);assert.equal(Object.hasOwn(post.data.message,'isAdmin'),false);
  const world=await api('/api/v1/chat?channel=world',{token:b.token});assert.equal(world.data.messages[0].text,'天下の皆さま、よろしく。');
  await api('/api/v1/chat',{...auth(a,{channel:'world',text:'連投'}),expected:429});tick();
  await api('/api/v1/chat',{...auth(a,{channel:'world',text:'字'.repeat(301)}),expected:400});
  const cursor=await api('/api/v1/chat?channel=world&after='+post.data.message.id,{token:b.token});assert.equal(cursor.data.messages.length,0);

  const createdGuild=await api('/api/v1/guild',auth(a,{name:'風林火山'}));const guildId=createdGuild.data.guild.id;
  await api('/api/v1/guild/join',auth(b,{guildId}));
  await api('/api/v1/chat?channel=guild',{token:c.token,expected:403});
  await api('/api/v1/chat',{...auth(c,{channel:'guild',target:guildId,text:'権限外'}),expected:403});
  await api('/api/v1/chat',auth(a,{channel:'guild',text:'我らの軍議。'}));tick();
  const guildMessages=await api('/api/v1/chat?channel=guild',{token:b.token});assert.equal(guildMessages.data.messages[0].text,'我らの軍議。');
  const memberList=await api('/api/v1/guild',{token:b.token});assert.equal(memberList.data.members.length,2);
  await api('/api/v1/guild',{...auth(a,{name:'もう一つ'}),expected:409});
  await api('/api/v1/guild/leave',auth(a,{}));
  const afterLeave=await api('/api/v1/guild',{token:b.token});assert.equal(afterLeave.data.guild.ownerId,b.user.id);assert.equal(afterLeave.data.members.length,1);
  await api('/api/v1/chat?channel=guild',{token:a.token,expected:403});

  await api('/api/v1/friends/request',auth(a,{userId:c.user.id}));
  const pending=await api('/api/v1/me',{token:c.token});assert.equal(pending.data.requests[0].direction,'incoming');
  await api('/api/v1/chat?channel=friend&target='+c.user.id,{token:a.token,expected:403});
  await api('/api/v1/friends/respond',{...auth(a,{userId:c.user.id,accept:true}),expected:403});
  await api('/api/v1/friends/respond',auth(c,{userId:a.user.id,accept:true}));
  await api('/api/v1/chat',auth(a,{channel:'friend',target:c.user.id,text:'友にのみ届く書状。'}));tick();
  const friendChat=await api('/api/v1/chat?channel=friend&target='+a.user.id,{token:c.token});assert.equal(friendChat.data.messages[0].text,'友にのみ届く書状。');
  await api('/api/v1/chat?channel=friend&target='+a.user.id,{token:b.token,expected:403});
  await api('/api/v1/friends',{method:'DELETE',token:c.token,body:{userId:a.user.id}});
  await api('/api/v1/chat?channel=friend&target='+c.user.id,{token:a.token,expected:403});

  for(let i=0;i<5;i++)await api('/api/v1/admin/claim',{...auth(d,{key:'incorrect-test-key'}),expected:403});
  await api('/api/v1/admin/claim',{...auth(d,{key:env.SENGOKU_ADMIN_KEY}),expected:429});
  const claimRequests=[a,b].map(s=>new Request('https://communications.example/api/v1/admin/claim',{method:'POST',headers:{Authorization:'Bearer '+s.token,'Content-Type':'application/json'},body:JSON.stringify({key:env.SENGOKU_ADMIN_KEY})}));
  const claimResponses=await Promise.all(claimRequests.map(r=>worker.fetch(r,env,{})));
  calls+=claimRequests.length;
  assert.deepEqual(claimResponses.map(r=>r.status).sort(),[200,409]);
  const admin=claimResponses[0].status===200?a:b,nonAdmin=admin===a?b:a;
  assert.equal(database.prepare("SELECT COUNT(*) AS n FROM settings WHERE key='adminUserId'").get().n,1);
  const adminMe=await api('/api/v1/me',{token:admin.token});assert.equal(adminMe.data.user.isAdmin,true);
  await api('/api/v1/admin/claim',auth(admin,{}));
  await api('/api/v1/admin/claim',{...auth(c,{key:env.SENGOKU_ADMIN_KEY}),expected:409});
  await api('/api/v1/admin/announcement',{...auth(nonAdmin,{text:'偽のお知らせ'}),expected:403});
  await api('/api/v1/admin/announcement',auth(admin,{text:'初陣のお知らせ'}));
  const updatedConfig=await api('/api/v1/config');assert.equal(updatedConfig.data.adminClaimed,true);assert.equal(updatedConfig.data.announcement,'初陣のお知らせ');
  await api('/api/v1/admin/announcement',auth(admin,{text:''}));assert.equal((await api('/api/v1/config')).data.announcement,'');
  await api('/api/v1/chat?channel=admin',{token:nonAdmin.token,expected:403});
  tick();await api('/api/v1/chat',auth(admin,{channel:'admin',text:'運営軍議'}));
  const adminChat=await api('/api/v1/chat?channel=admin',{token:admin.token});assert.equal(Object.hasOwn(adminChat.data.messages[0],'isAdmin'),false);

  const campaign={target:'all',title:'初陣の贈り物',body:'領国づくりにお役立てください。',gift:{gold:500,rice:700,wood:200,stone:100},requestId:'send-test-0001'};
  await api('/api/v1/admin/mail',{...auth(nonAdmin,campaign),expected:403});
  const sent=await api('/api/v1/admin/mail',auth(admin,campaign));
  const sentAgain=await api('/api/v1/admin/mail',auth(admin,campaign));assert.equal(sentAgain.data.mailId,sent.data.mailId);assert.equal(sentAgain.data.alreadySent,true);
  const legacyZeroRetry=await api('/api/v1/admin/mail',auth(admin,{...campaign,gift:{...campaign.gift,magatama:0}}));assert.equal(legacyZeroRetry.data.mailId,sent.data.mailId);assert.equal(legacyZeroRetry.data.alreadySent,true,'zero magatama preserves the old four-resource send hash');
  await api('/api/v1/admin/mail',{...auth(admin,{...campaign,title:'別内容'}),expected:409});
  const future=await session('新たな領主');assert.equal((await api('/api/v1/mail',{token:future.token})).data.mail.length,1);
  const mailbox=await api('/api/v1/mail',{token:c.token});assert.equal(mailbox.data.mail[0].claimed,false);assert.equal((await api('/api/v1/me',{token:c.token})).data.unreadMail,1);
  const claimBody={mailId:sent.data.mailId,requestId:'claim-test-0001'};
  const gift=await api('/api/v1/mail/claim',auth(c,claimBody));assert.equal(gift.data.alreadyClaimed,false);assert.deepEqual(gift.data.gift,campaign.gift);
  const giftAgain=await api('/api/v1/mail/claim',auth(c,claimBody));assert.equal(giftAgain.data.alreadyClaimed,true);assert.equal(giftAgain.data.receiptId,gift.data.receiptId);assert.deepEqual(giftAgain.data.gift,campaign.gift);
  await api('/api/v1/mail/claim',{...auth(c,{...claimBody,requestId:'claim-test-0002'}),expected:409});
  assert.equal((await api('/api/v1/me',{token:c.token})).data.unreadMail,0);
  const personal=await api('/api/v1/admin/mail',auth(admin,{target:d.user.id,title:'個別書状',body:'この領主だけに届けます。',gift:{gold:30,magatama:700},requestId:'send-test-0002'}));
  await api('/api/v1/mail/claim',{...auth(c,{mailId:personal.data.mailId,requestId:'stolen-gift'}),expected:404});
  await api('/api/v1/mail/read',{...auth(c,{mailId:personal.data.mailId}),expected:404});
  assert.equal((await api('/api/v1/mail',{token:d.token})).data.mail.length,2);
  await api('/api/v1/mail/read',auth(d,{mailId:personal.data.mailId}));
  const raceBodies=['one','two'].map(id=>new Request('https://communications.example/api/v1/mail/claim',{method:'POST',headers:{Authorization:'Bearer '+d.token,'Content-Type':'application/json'},body:JSON.stringify({mailId:personal.data.mailId,requestId:'concurrent-'+id})}));
  const race=await Promise.all(raceBodies.map(r=>worker.fetch(r,env,{})));calls+=raceBodies.length;assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mail_receipts WHERE mail_id=? AND user_id=?').get(personal.data.mailId,d.user.id).n,1);
  const raceGift=JSON.parse(database.prepare('SELECT gift_json FROM mail_receipts WHERE mail_id=? AND user_id=?').get(personal.data.mailId,d.user.id).gift_json);assert.deepEqual(raceGift,{gold:30,rice:0,wood:0,stone:0,magatama:700});

  const magatamaMail={target:'all',title:'勾玉の贈り物',body:'登用にお役立てください。',gift:{magatama:3000},requestId:'send-magatama-only'};
  const magatamaSent=await api('/api/v1/admin/mail',auth(admin,magatamaMail)),magatamaGift={gold:0,rice:0,wood:0,stone:0,magatama:3000};
  const magatamaAgain=await api('/api/v1/admin/mail',auth(admin,{...magatamaMail,gift:magatamaGift}));assert.equal(magatamaAgain.data.mailId,magatamaSent.data.mailId);assert(magatamaAgain.data.alreadySent);
  const magatamaInbox=(await api('/api/v1/mail',{token:c.token})).data.mail.find(m=>m.id===magatamaSent.data.mailId);assert.deepEqual(magatamaInbox.gift,magatamaGift);
  const magatamaClaim={mailId:magatamaSent.data.mailId,requestId:'claim-magatama-once'};
  const magatamaReceived=await api('/api/v1/mail/claim',auth(c,magatamaClaim));assert.deepEqual(magatamaReceived.data.gift,magatamaGift);assert(!magatamaReceived.data.alreadyClaimed);
  const magatamaReplayed=await api('/api/v1/mail/claim',auth(c,magatamaClaim));assert.deepEqual(magatamaReplayed.data.gift,magatamaGift);assert.equal(magatamaReplayed.data.receiptId,magatamaReceived.data.receiptId);assert(magatamaReplayed.data.alreadyClaimed);
  await api('/api/v1/mail/claim',{...auth(c,{...magatamaClaim,requestId:'claim-magatama-second-id'}),expected:409});
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM mail_receipts WHERE mail_id=? AND user_id=?').get(magatamaSent.data.mailId,c.user.id).n,1);
  for(const amount of [-1,1.5,1000001,'3000',{}])await api('/api/v1/admin/mail',{...auth(admin,{...magatamaMail,gift:{magatama:amount},requestId:crypto.randomUUID()}),expected:400});
  await api('/api/v1/admin/mail',{...auth(admin,{...magatamaMail,gift:{magatama:1,isAdmin:true},requestId:crypto.randomUUID()}),expected:400});
  const maxMail=await api('/api/v1/admin/mail',auth(admin,{...magatamaMail,target:d.user.id,gift:{magatama:1000000},requestId:'send-max-magatama'}));
  const maxGift=await api('/api/v1/mail/claim',auth(d,{mailId:maxMail.data.mailId,requestId:'claim-max-magatama'}));assert.equal(maxGift.data.gift.magatama,1000000);
  const zeroMail=await api('/api/v1/admin/mail',auth(admin,{...magatamaMail,gift:{magatama:0},requestId:'send-zero-magatama'}));
  assert.equal((await api('/api/v1/mail',{token:c.token})).data.mail.find(m=>m.id===zeroMail.data.mailId).gift,null);
  await api('/api/v1/mail/claim',{...auth(c,{mailId:zeroMail.data.mailId,requestId:'claim-zero-magatama'}),expected:400});
  const support=await api('/api/v1/admin/staff',auth(admin,{targetPlayerId:nonAdmin.user.id,action:'appoint',requestId:'appoint-gift-support'}));assert(support.data.user.isStaff);assert(!support.data.user.isAdmin);
  await api('/api/v1/admin/mail',{...auth(nonAdmin,{...magatamaMail,requestId:'staff-cannot-send-magatama'}),expected:403});
  const staffGift=await api('/api/v1/mail/claim',auth(nonAdmin,{mailId:magatamaSent.data.mailId,requestId:'staff-can-receive-magatama'}));assert.equal(staffGift.data.gift.magatama,3000);
  const storedSettings=database.prepare('SELECT * FROM settings').all();assert(!JSON.stringify(storedSettings).includes(env.SENGOKU_ADMIN_KEY));
  assert.equal((await api('/api/v1/config')).data.onlineCount,0,'authenticated requests alone do not create foreground presence');
  console.log(JSON.stringify({ok:true,calls,checks:['schema migration','hashed bearer auth','CORS and input limits','identity and name uniqueness','shared world chat','5-second chat throttle','guild membership isolation and deterministic ownership transfer','mutual friendship authorization','admin rate limit and concurrent single claim','admin-only endpoints','broadcast and personal mail isolation','atomic gift receipts and retry idempotency','old four-resource gift hash compatibility','magatama-only and mixed gifts with integer/cap validation','magatama replay and concurrent claim safety','staff cannot send but can receive magatama','no stored plaintext key/token']},null,2));
} finally {
  Date.now=originalNow;
  database.close();
}
