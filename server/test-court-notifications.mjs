import assert from 'node:assert/strict';
import {createECDH,createDecipheriv,generateKeyPairSync,hkdfSync,randomBytes} from 'node:crypto';
import worker from './index.js';
import {harness} from './test-support.mjs';
import {fixture,post,save,updateSave} from './test-court-support.mjs';

const NOW=Date.parse('2026-11-28T03:00:00Z'),base64=b=>Buffer.from(b).toString('base64url');
const vapid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),publicKey=vapid.publicKey.export({format:'jwk'});
const env={WEB_PUSH_PRIVATE_JWK:JSON.stringify(vapid.privateKey.export({format:'jwk'})),WEB_PUSH_PUBLIC_KEY:base64(Buffer.concat([Buffer.from([4]),Buffer.from(publicKey.x,'base64url'),Buffer.from(publicKey.y,'base64url')])),WEB_PUSH_SUBJECT:'mailto:test@example.invalid'};
const preferences={enabled:true,battle:false,letter:false,operation:false,construction:false,event:false,chat:true,worldChat:false,announcement:false,quietStart:0,quietEnd:0,digestMinutes:0};
function device(){const ecdh=createECDH('prime256v1');ecdh.generateKeys();const auth=randomBytes(16);return{ecdh,auth,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID(),keys:{p256dh:base64(ecdh.getPublicKey()),auth:base64(auth)}}};}
function decrypt(receiver,body){const data=Buffer.from(body),secret=receiver.ecdh.computeSecret(data.subarray(21,86)),ikm=hkdfSync('sha256',secret,receiver.auth,Buffer.concat([Buffer.from('WebPush: info\0'),receiver.ecdh.getPublicKey(),data.subarray(21,86)]),32),key=hkdfSync('sha256',ikm,data.subarray(0,16),Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,data.subarray(0,16),Buffer.from('Content-Encoding: nonce\0'),12),encrypted=data.subarray(86),cipher=createDecipheriv('aes-128-gcm',key,nonce);cipher.setAuthTag(encrypted.subarray(-16));const plain=Buffer.concat([cipher.update(encrypted.subarray(0,-16)),cipher.final()]);return JSON.parse(plain.subarray(0,-1).toString());}
let scopes=0,calls=0;
async function scope(name,run){const h=harness(),previous=globalThis.fetch;h.now=NOW;h.pushes=[];Object.assign(h.env,env);globalThis.fetch=async(url,options)=>{h.pushes.push({url,options});return new Response(null,{status:201});};try{await run(h);scopes++;console.log('PASS '+name);}finally{globalThis.fetch=previous;calls+=h.calls;h.close();}}
async function enable(h,p,options={}){p.device=device();await h.api('/notifications/preferences',post(p,{...preferences,...options}));await h.api('/notifications/subscribe',post(p,{subscription:p.device.subscription}));return p;}
async function tick(h,advance=60001){h.now+=advance;const result=(await h.api('/notifications/tick',{method:'POST',body:{}})).data;assert.equal(result.failed||0,0,JSON.stringify(result));return result;}
const chat=(h,p,text='PRIVATE_COURT_BODY')=>h.api('/court/chat',post(p,{requestId:crypto.randomUUID(),text}));
const audience=(h,p)=>h.api('/court/audiences',post(p,{requestId:crypto.randomUUID(),title:'PRIVATE_SUBJECT',text:'PRIVATE_AUDIENCE_BODY'}));
const reply=(h,p,id)=>h.api('/court/audiences/'+id+'/replies',post(p,{requestId:crypto.randomUUID(),text:'PRIVATE_REPLY_BODY'}));
const byDevice=(h,p)=>h.pushes.filter(push=>push.url===p.device.subscription.endpoint);
function changeSave(h,p,change){updateSave(h,p,change);h.sql.prepare('UPDATE player_saves SET updated_at=? WHERE user_id=?').run(h.now,p.user.id);}
function ban(h,player,by){h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?) ON CONFLICT(user_id) DO UPDATE SET active=1,revision=revision+1,updated_at=excluded.updated_at').run(player.user.id,by.user.id,h.now);}

await scope('court chat uses canonical admission, hides all private content and supports the immediate Worker hook',async h=>{
 const admin=await enable(h,await fixture(h,'通知の太政大臣',{admin:true})),visitor=await enable(h,await fixture(h,'通知の参内者',{score:35000})),staff=await enable(h,await fixture(h,'通知の担当者',{staff:true})),low=await enable(h,await fixture(h,'通知の入場前',{score:34999}));
 assert.equal(h.sql.prepare('SELECT eligible FROM notification_court_access WHERE user_id=?').get(low.user.id).eligible,0);
 h.sql.prepare("INSERT INTO notification_scheduler(id,next_tick,cursor) VALUES(1,0,'u_previous_page') ON CONFLICT(id) DO UPDATE SET next_tick=0,cursor='u_previous_page'").run();const schedulerBefore=h.sql.prepare('SELECT * FROM notification_scheduler').get();h.now++;
 const pending=[],response=await worker.fetch(new Request('https://local.invalid/api/v1/court/chat',{method:'POST',headers:{Origin:'https://www.kasai-solutions-inc.com',Authorization:'Bearer '+admin.token,'Content-Type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),text:'PRIVATE_COURT_BODY'})}),h.env,{waitUntil:promise=>pending.push(promise)});assert.equal(response.status,200,JSON.stringify(await response.json()));await Promise.all(pending);
 assert.deepEqual(h.sql.prepare('SELECT * FROM notification_scheduler').get(),schedulerBefore,'a message POST runs targeted delivery without consuming a second periodic recipient batch');assert.equal(h.pushes.length,2);assert.equal(byDevice(h,admin).length,0);assert.equal(byDevice(h,low).length,0);assert.equal(byDevice(h,staff).length,1);const payload=decrypt(visitor.device,byDevice(h,visitor)[0].options.body);assert.equal(payload.destination,'courtChat');assert(!JSON.stringify(payload).includes('PRIVATE'));assert(!JSON.stringify(payload).includes(admin.user.id));assert(!JSON.stringify(payload).includes(admin.user.name));
});

await scope('authorized court reads use returned seq and suppress already read conversations',async h=>{
 const admin=await fixture(h,'既読の太政大臣',{admin:true}),p=await enable(h,await fixture(h,'既読の参内者',{score:35000}));h.now++;const written=(await chat(h,admin)).data;const read=(await h.api('/court/chat',{token:p.token})).data;assert.equal(read.messages.at(-1).seq,written.message.seq);assert.equal(h.sql.prepare("SELECT last_message_id FROM notification_chat_reads WHERE user_id=? AND room_key='court:chat'").get(p.user.id).last_message_id,written.message.seq);await h.api('/court/chat?after=999999&contentRevision='+read.contentRevision,{token:p.token});assert.equal(h.sql.prepare("SELECT last_message_id FROM notification_chat_reads WHERE user_id=? AND room_key='court:chat'").get(p.user.id).last_message_id,written.message.seq,'a future cursor does not mark unseen messages read');assert.equal((await tick(h)).sent,0);h.now++;await chat(h,admin);assert.equal((await tick(h)).sent,1);
});

await scope('routine save revisions preserve the stable admission checkpoint and pending new messages',async h=>{
 const admin=await fixture(h,'保存の太政大臣',{admin:true}),p=await enable(h,await fixture(h,'保存の参内者',{score:35000})),since=h.sql.prepare('SELECT since FROM notification_court_access WHERE user_id=?').get(p.user.id).since;h.now+=10;await chat(h,admin);h.now+=10;changeSave(h,p,s=>{s.resources.gold+=1;});assert.equal((await tick(h)).sent,1);assert.equal(h.sql.prepare('SELECT since FROM notification_court_access WHERE user_id=?').get(p.user.id).since,since);
});

await scope('a save revision changed during source validation defers a valid notice instead of deleting it',async h=>{
 const admin=await fixture(h,'再検証の太政大臣',{admin:true}),p=await enable(h,await fixture(h,'再検証の参内者',{score:35000}));h.now++;await chat(h,admin);let changed=false;h.beforeStatement=async query=>{if(changed||!query.includes(' AS source_ok,')||!query.includes('FROM court_chat'))return;changed=true;changeSave(h,p,s=>{s.resources.gold+=1;});};assert.equal((await tick(h)).sent,0);assert(changed);assert.equal(h.sql.prepare("SELECT delivered_at FROM notification_outbox WHERE id LIKE 'court-chat:%'").get().delivered_at,null);h.beforeStatement=null;assert.equal((await tick(h,300001)).sent,1);
});

await scope('new admission and rank loss/reentry do not backfill old court messages',async h=>{
 const admin=await fixture(h,'再入場の太政大臣',{admin:true}),p=await enable(h,await fixture(h,'再入場の参内者',{score:35000}),{quietStart:11,quietEnd:14}),saved=save(h,p);h.now+=10;await chat(h,admin);assert.equal((await tick(h)).sent,0);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE id LIKE 'court-chat:%' AND delivered_at IS NULL").get().n,1);
 h.now+=10;changeSave(h,p,s=>{s.prestige=0;});assert.equal((await tick(h)).sent,0);assert.equal(h.sql.prepare('SELECT eligible FROM notification_court_access WHERE user_id=?').get(p.user.id).eligible,0);
 h.now+=10;changeSave(h,p,s=>{s.prestige=saved.state.prestige;});await h.api('/notifications/preferences',post(p,preferences));assert.equal((await tick(h)).sent,0,'same eligible access stamp cannot replay the prior admission');h.now++;await chat(h,admin);assert.equal((await tick(h)).sent,1);
 const low=await enable(h,await fixture(h,'新規参内の領主',{score:34999}));h.now++;await chat(h,admin);await tick(h);const previous=byDevice(h,low).length;h.now++;changeSave(h,low,s=>{s.prestige+=2;});assert.equal((await h.api('/court',{token:low.token})).data.eligible,true);await tick(h);assert.equal(byDevice(h,low).length,previous,'messages from before eligibility do not replay');h.now++;await chat(h,admin);await tick(h);assert.equal(byDevice(h,low).length,previous+1);
});

await scope('private audience replies reach only the requester and current court officials',async h=>{
 const admin=await fixture(h,'謁見の太政大臣',{admin:true}),requester=await fixture(h,'謁見の申請者',{score:35000}),outsider=await fixture(h,'謁見の第三者',{score:35000}),staff=await fixture(h,'謁見の担当者',{staff:true}),created=(await audience(h,requester)).data;h.now++;await enable(h,requester);await enable(h,outsider);await enable(h,staff);h.now++;await reply(h,admin,created.thread.id);assert.equal((await tick(h)).sent,2);assert.equal(byDevice(h,outsider).length,0);const payload=decrypt(requester.device,byDevice(h,requester)[0].options.body);assert.equal(payload.destination,'courtAudiences');assert(!JSON.stringify(payload).includes('PRIVATE'));assert(!JSON.stringify(payload).includes(created.thread.id));
 const read=(await h.api('/court/audiences/'+created.thread.id,{token:requester.token})).data;assert.equal(h.sql.prepare('SELECT last_message_id FROM notification_chat_reads WHERE user_id=? AND room_key=?').get(requester.user.id,'court:audience:'+created.thread.id).last_message_id,Math.max(...read.messages.map(m=>m.seq)));assert.equal((await tick(h)).sent,0);
 h.now++;await reply(h,admin,created.thread.id);ban(h,requester,admin);assert.equal((await tick(h)).sent,0,'banned requester hides this audience from every notification recipient');
});

await scope('court rank, appointment and deleted-source races are checked after encryption',async h=>{
 const admin=await fixture(h,'競合の太政大臣',{admin:true}),p=await enable(h,await fixture(h,'競合の参内者',{score:35000}));h.now++;await chat(h,admin);h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;changeSave(h,p,s=>{s.prestige=0;});};assert.equal((await tick(h)).sent,0);
 const staff=await enable(h,await fixture(h,'競合の担当者',{staff:true}));h.now++;await chat(h,admin);h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('UPDATE staff_members SET term_id=?,appointed_at=? WHERE user_id=?').run('new_term',h.now,staff.user.id);};assert.equal((await tick(h)).sent,0);h.now++;await chat(h,admin);h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.exec('DELETE FROM court_chat');};assert.equal((await tick(h)).sent,0);assert.equal(h.pushes.length,0);
});

await scope('batched court notices share admission guards and remain within D1 limits',async h=>{
 const admin=await fixture(h,'一括の太政大臣',{admin:true}),p=await enable(h,await fixture(h,'一括の参内者',{score:35000}));h.now++;for(let i=0;i<8;i++)h.sql.prepare("INSERT INTO court_chat(id,author_id,author_kind,body,created_at) VALUES(?,?,'court','PRIVATE_BATCH',?)").run('cc_'+crypto.randomUUID().replaceAll('-',''),admin.user.id,h.now);
 let maxBindings=0;const inspect=(sql,params)=>{maxBindings=Math.max(maxBindings,params.length);assert(params.length<=100,'D1 bound parameter limit');for(let i=0;i<params.length;i++)if(typeof params[i]==='string'&&params[i].endsWith('%'))assert(Buffer.byteLength(params[i])<=50,'D1 LIKE pattern limit');};h.beforeStatement=inspect;h.beforeBatch=items=>{for(const item of items)inspect(item.sql,item.params);};assert.equal((await tick(h)).sent,1);assert.equal((await tick(h)).sent,1);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM notification_outbox WHERE id LIKE 'court-chat:%' AND delivered_at IS NOT NULL").get().n,8);assert(maxBindings>=25);assert(maxBindings<=100);assert.equal(decrypt(p.device,h.pushes[0].options.body).destination,'courtChat');
});

console.log(`Court notifications: ${scopes} scopes, ${calls} API calls; canonical court authorization, actual Worker dispatch, mock push delivery.`);
