import assert from 'node:assert/strict';
import {createECDH,createDecipheriv,generateKeyPairSync,hkdfSync,randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {harness} from './test-support.mjs';
import {dispatchNotifications,dispatchMessageNotifications,notificationAnnouncementStatements,recordNotificationChatRead} from './notifications.js';

const NOW=Date.parse('2026-11-28T03:00:00Z'),base64=b=>Buffer.from(b).toString('base64url');
const vapid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=vapid.publicKey.export({format:'jwk'});
const env={WEB_PUSH_PRIVATE_JWK:JSON.stringify(vapid.privateKey.export({format:'jwk'})),WEB_PUSH_PUBLIC_KEY:base64(Buffer.concat([Buffer.from([4]),Buffer.from(publicKey.x,'base64url'),Buffer.from(publicKey.y,'base64url')])),WEB_PUSH_SUBJECT:'mailto:test@example.invalid'};
const preferences={enabled:true,battle:true,letter:true,operation:true,construction:true,event:true,chat:true,worldChat:false,announcement:true,quietStart:0,quietEnd:0,digestMinutes:0};
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
function device(){const ecdh=createECDH('prime256v1');ecdh.generateKeys();const auth=randomBytes(16);return{ecdh,auth,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID(),keys:{p256dh:base64(ecdh.getPublicKey()),auth:base64(auth)}}};}
function decrypt(receiver,body){
 const data=Buffer.from(body),salt=data.subarray(0,16),sender=data.subarray(21,86),secret=receiver.ecdh.computeSecret(sender);
 const ikm=hkdfSync('sha256',secret,receiver.auth,Buffer.concat([Buffer.from('WebPush: info\0'),receiver.ecdh.getPublicKey(),sender]),32),key=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const encrypted=data.subarray(86),cipher=createDecipheriv('aes-128-gcm',key,nonce);cipher.setAuthTag(encrypted.subarray(-16));const plain=Buffer.concat([cipher.update(encrypted.subarray(0,-16)),cipher.final()]);assert.equal(plain.at(-1),2);return JSON.parse(plain.subarray(0,-1).toString());
}
let scopes=0,apiCalls=0;
async function scope(name,fn){const h=harness(),oldFetch=globalThis.fetch;h.now=NOW;Object.assign(h.env,env);h.pushes=[];h.responseStatus=201;globalThis.fetch=async(url,options)=>{h.pushes.push({url,options});return new Response(null,{status:h.responseFor?h.responseFor(url):h.responseStatus});};try{await fn(h);console.log('PASS '+name);scopes++;}finally{globalThis.fetch=oldFetch;apiCalls+=h.calls;h.close();}}
async function setup(h,name,options={}){const p=await h.session(name),d=device();await h.api('/notifications/preferences',post(p,{...preferences,...options}));await h.api('/notifications/subscribe',post(p,{subscription:d.subscription}));return{...p,device:d};}
function friend(h,a,b){const ids=[a.user.id,b.user.id].sort();h.sql.prepare("INSERT INTO friendships(user_a,user_b,requested_by,status,created_at,updated_at) VALUES(?,?,?,'accepted',?,?)").run(...ids,a.user.id,h.now-100,h.now-100);return'friend:'+ids.join(':');}
function chat(h,p,room,channel='friend',created=h.now){return Number(h.sql.prepare('INSERT INTO messages(room_key,channel,user_id,body,created_at) VALUES(?,?,?,?,?) RETURNING id').get(room,channel,p.user.id,'PRIVATE_BODY_通知に出してはいけない',created).id);}
async function immediate(h,p,path='/chat'){return dispatchMessageNotifications(h.env,null,{path,actorId:p.user.id,since:h.now});}
async function tick(h,advance=60001){h.now+=advance;return dispatchNotifications(h.env,{elapsedMs:0,running:true,speed:1});}
async function announcement(h,p,text='PRIVATE_御触書'){await h.db.batch([h.db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('announcement',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at").bind(text,h.now),...notificationAnnouncementStatements(h.db,p.user.id,h.now)]);}

{
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries;
 for(const entry of entries.filter(e=>e.idx<53))for(const command of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(command);
 sql.exec("INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES('migration_user','old','old','clan','hash',1,1); INSERT INTO notification_preferences(user_id,enabled,quiet_start,quiet_end,digest_minutes,updated_at) VALUES('migration_user',1,23,7,15,100); INSERT INTO notification_outbox(id,user_id,category,title,body,due_at,created_at,lease_token,leased_until) VALUES('old_notice','migration_user','letter','title','body',110,100,'lease',123);");
 for(const command of readFileSync(new URL('./drizzle/0053_message_notifications.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(command);
 const p=sql.prepare('SELECT * FROM notification_preferences').get(),n=sql.prepare('SELECT * FROM notification_outbox').get();assert.equal(p.enabled,1);assert.equal(p.quiet_start,23);assert.equal(p.quiet_end,7);assert.equal(p.digest_minutes,15);assert.equal(p.worldChat,0);assert(p.chat_since>100);assert.equal(n.id,'old_notice');assert.equal(n.lease_token,'lease');assert.equal(n.leased_until,123);assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);sql.close();console.log('PASS migration preserves consent, quiet time and queued leases without historical chat replay');scopes++;
}

await scope('new defaults and old-client preference writes preserve message choices',async h=>{
 const p=await h.session('新規通知'),view=(await h.api('/notifications',{token:p.token})).data;assert.equal(view.preferences.enabled,false);assert.equal(view.preferences.chat,true);assert.equal(view.preferences.worldChat,false);assert.equal(view.preferences.announcement,true);assert.equal(view.preferences.digestMinutes,0);assert.equal(view.preferences.quietStart,view.preferences.quietEnd);
 await h.api('/notifications/preferences',post(p,{...preferences,chat:false,worldChat:true}));const legacy={...preferences};delete legacy.chat;delete legacy.worldChat;delete legacy.announcement;await h.api('/notifications/preferences',post(p,legacy));const latest=(await h.api('/notifications',{token:p.token})).data.preferences;assert.equal(latest.chat,false);assert.equal(latest.worldChat,true);await h.api('/notifications/preferences',post(p,{...preferences,chat:'yes'},400));
});

await scope('device read and test are owner-only, opt-in only and truthful about service acceptance',async h=>{
 const p=await setup(h,'受信確認'),other=await h.session('他の端末'),endpoint=p.device.subscription.endpoint;
 assert.equal((await h.api('/notifications/device',post(p,{endpoint}))).data.subscribed,true);assert.equal((await h.api('/notifications/device',post(other,{endpoint}))).data.subscribed,false);
 await h.api('/notifications/test',post(other,{endpoint},409));assert.equal(h.pushes.length,0);const test=(await h.api('/notifications/test',post(p,{endpoint}))).data;assert.equal(test.sent,1);const payload=decrypt(p.device,h.pushes[0].options.body);assert.equal(payload.destination,'notifications');assert.equal(h.sql.prepare('SELECT last_sent_at FROM notification_subscriptions WHERE endpoint=?').get(endpoint).last_sent_at,0,'test does not postpone real messages');
 h.responseStatus=403;await h.api('/notifications/test',post(p,{endpoint},503));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions').get().n,1,'provider configuration errors do not erase device consent');await h.api('/notifications/test',post(p,{endpoint},429));
 h.now+=60001;h.responseStatus=410;await h.api('/notifications/test',post(p,{endpoint},409));assert.equal((await h.api('/notifications/device',post(p,{endpoint}))).data.subscribed,false);
});

await scope('disabling consent during test encryption prevents a push',async h=>{
 const p=await setup(h,'試験停止'),endpoint=p.device.subscription.endpoint;h.beforeStatement=async query=>{if(!query.startsWith('SELECT 1 AS ok FROM notification_subscriptions'))return;h.beforeStatement=null;h.sql.prepare('UPDATE notification_preferences SET enabled=0 WHERE user_id=?').run(p.user.id);};await h.api('/notifications/test',post(p,{endpoint},409));assert.equal(h.pushes.length,0);
});

await scope('friend messages dispatch immediately to their recipient with no sender, outsider or body leakage',async h=>{
 const sender=await setup(h,'友達の送信者'),recipient=await setup(h,'友達の受信者'),outsider=await setup(h,'無関係の領主'),room=friend(h,sender,recipient);chat(h,sender,room);h.sql.prepare('INSERT INTO notification_scheduler(id,next_tick) VALUES(1,?)').run(h.now+60000);
 const results=await Promise.all([immediate(h,sender),immediate(h,sender)]);assert.equal(results.reduce((n,r)=>n+r.sent,0),1);assert.equal(h.pushes.length,1);assert.equal(h.pushes[0].url,recipient.device.subscription.endpoint);const payload=decrypt(recipient.device,h.pushes[0].options.body);assert.equal(payload.destination,'friends');assert(!JSON.stringify(payload).includes('PRIVATE_BODY'));assert(!JSON.stringify(payload).includes(sender.user.name));assert.equal((await tick(h)).sent,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE user_id=?').get(outsider.user.id).n,0);
});

await scope('world chat requires explicit choice and enabling it starts from that moment',async h=>{
 const sender=await h.session('世界の送信者'),p=await setup(h,'世界の受信者');chat(h,sender,'world','world');assert.equal((await immediate(h,sender)).sent,0);h.now+=100;await h.api('/notifications/preferences',post(p,{...preferences,worldChat:true}));assert.equal((await tick(h)).sent,0,'old world messages are not replayed');chat(h,sender,'world','world');assert.equal((await immediate(h,sender)).sent,1);assert.equal(decrypt(p.device,h.pushes.at(-1).options.body).destination,'world');
});

await scope('read messages and removed friendships are checked again at delivery',async h=>{
 const sender=await h.session('既読の送信者'),p=await setup(h,'既読の受信者'),room=friend(h,sender,p),id=chat(h,sender,room);
 await recordNotificationChatRead(h.db,p.user.id,room,id,h.now,{sql:'1=1',args:[]});assert.equal((await immediate(h,sender)).sent,0);h.now++;chat(h,sender,room);
 h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('DELETE FROM friendships WHERE user_a=? OR user_b=?').run(p.user.id,p.user.id);};assert.equal((await immediate(h,sender)).sent,0);assert.equal(h.pushes.length,0);
});

await scope('real authorized chat reads advance only through the returned message ids',async h=>{
 const sender=await h.session('実画面の送信者'),p=await setup(h,'実画面の受信者'),room=friend(h,sender,p),id=chat(h,sender,room);const read=(await h.api('/chat?channel=friend&target='+sender.user.id,{token:p.token})).data;assert.equal(read.messages.at(-1).id,id);assert.equal(h.sql.prepare('SELECT last_message_id FROM notification_chat_reads WHERE user_id=? AND room_key=?').get(p.user.id,room).last_message_id,id);assert.equal((await immediate(h,sender)).sent,0);h.now++;chat(h,sender,room);assert.equal((await immediate(h,sender)).sent,1);
});

await scope('disable and reenable during queue creation cannot resurrect older messages',async h=>{
 const sender=await h.session('再許可の送信者'),p=await setup(h,'再許可の受信者'),room=friend(h,sender,p);chat(h,sender,room);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO notification_outbox(')))return;h.beforeBatch=null;h.now++;await h.api('/notifications/preferences',post(p,{...preferences,enabled:false}));h.now++;await h.api('/notifications/preferences',post(p,preferences));};assert.equal((await immediate(h,sender)).sent,0);assert.equal((await tick(h)).sent,0);assert.equal(h.pushes.length,0);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE category='chat'").get().n,0);
});

await scope('guild membership and staff appointment scope cannot survive leave or reappointment',async h=>{
 const sender=await h.session('同盟の送信者'),p=await setup(h,'同盟の受信者');const gid='g_'+crypto.randomUUID();h.sql.prepare('INSERT INTO guilds(id,name,name_key,owner_id,created_at) VALUES(?,?,?,?,?)').run(gid,'同盟','同盟',sender.user.id,h.now-100);for(const player of [sender,p])h.sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(player.user.id,gid,h.now-100);chat(h,sender,'guild:'+gid,'guild');
 h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(p.user.id);h.sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(p.user.id,gid,h.now+1);};assert.equal((await immediate(h,sender)).sent,0);
 h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)").run(sender.user.id,h.now);h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run(p.user.id,sender.user.id,h.now-100,'term_a');h.now+=1000;chat(h,sender,'admin','admin');
 h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare("UPDATE staff_members SET term_id='term_b' WHERE user_id=?").run(p.user.id);};assert.equal((await immediate(h,sender)).sent,0);assert.equal(h.pushes.length,0);
});

await scope('announcements notify current content once, exclude sender and ignore cleared content',async h=>{
 const sender=await setup(h,'御触書の送信者'),p=await setup(h,'御触書の受信者');await announcement(h,sender);assert.equal((await immediate(h,sender,'/admin/announcement')).sent,1);const payload=decrypt(p.device,h.pushes[0].options.body);assert.equal(payload.destination,'news');assert(!JSON.stringify(payload).includes('PRIVATE_'));assert.equal((await tick(h)).sent,0);
 h.now++;await announcement(h,sender);h.sql.prepare("UPDATE settings SET value='' WHERE key='announcement'").run();assert.equal((await immediate(h,sender,'/admin/announcement')).sent,0);
});

await scope('per-device receipts retry failures without resending to successful devices',async h=>{
 const sender=await h.session('複数端末の送信者'),p=await setup(h,'複数端末の受信者'),second=device(),room=friend(h,sender,p);await h.api('/notifications/subscribe',post(p,{subscription:second.subscription}));chat(h,sender,room);h.responseFor=url=>url===second.subscription.endpoint?503:201;
 const first=await immediate(h,sender);assert.equal(first.sent,1);assert.equal(first.failed,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_delivery_receipts').get().n,1);assert.equal(h.sql.prepare('SELECT delivered_at FROM notification_outbox').get().delivered_at,null);
 h.responseFor=()=>201;assert.equal((await tick(h,300001)).sent,1);assert.equal(h.pushes.length,3);assert.equal(h.pushes[2].url,second.subscription.endpoint);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_delivery_receipts').get().n,2);assert.notEqual(h.sql.prepare('SELECT delivered_at FROM notification_outbox').get().delivered_at,null);
});

await scope('different device digest timers retain pending delivery and new devices do not receive queued history',async h=>{
 const sender=await h.session('間隔の送信者'),p=await setup(h,'間隔の受信者',{digestMinutes:5}),second=device(),room=friend(h,sender,p);await h.api('/notifications/subscribe',post(p,{subscription:second.subscription}));h.sql.prepare('UPDATE notification_subscriptions SET last_sent_at=? WHERE endpoint=?').run(h.now,second.subscription.endpoint);chat(h,sender,room);
 assert.equal((await immediate(h,sender)).sent,1);assert.equal(h.sql.prepare('SELECT delivered_at FROM notification_outbox').get().delivered_at,null);h.now++;const third=device();await h.api('/notifications/subscribe',post(p,{subscription:third.subscription}));assert.equal((await tick(h,300001)).sent,1);assert.equal(h.pushes.length,2);assert.equal(h.pushes[1].url,second.subscription.endpoint);assert.notEqual(h.sql.prepare('SELECT delivered_at FROM notification_outbox').get().delivered_at,null);
});

await scope('a slow provider leaves the unstarted scheduler recipients for the next tick',async h=>{
 const sender=await h.session('遅延試験の送信者'),players=[];for(let i=0;i<13;i++)players.push(await setup(h,'遅延受信'+i,{worldChat:true}));chat(h,sender,'world','world');let first=true;h.responseFor=()=>{if(first){first=false;h.now+=19000;}return 201;};
 const delivered=await dispatchNotifications(h.env,null);assert.equal(delivered.checked,6);assert.equal(delivered.sent,6);assert(h.sql.prepare('SELECT cursor FROM notification_scheduler WHERE id=1').get().cursor);const remaining=await tick(h);assert.equal(remaining.sent,7);assert.equal(h.pushes.length,13);assert.equal(new Set(h.pushes.map(p=>p.url)).size,13);assert.equal(h.sql.prepare('SELECT cursor FROM notification_scheduler WHERE id=1').get().cursor,'');
});

console.log(`Message notifications: ${scopes} scopes, ${apiCalls} API calls; all push requests mocked and payloads independently decrypted.`);
