import assert from 'node:assert/strict';
import {createECDH,createDecipheriv,createPublicKey,generateKeyPairSync,hkdfSync,randomBytes,verify} from 'node:crypto';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {dispatchNotifications,notificationQuiet,notificationSaveStatements} from './notifications.js';
import {allowedPushEndpoint,encryptPush,sendWebPush,vapidAuthorization} from './web-push.js';

const NOW=Date.parse('2026-11-21T03:00:00Z'),base64=b=>Buffer.from(b).toString('base64url');
const vapid=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),vapidJwk=vapid.privateKey.export({format:'jwk'}),publicJwk=vapid.publicKey.export({format:'jwk'});
const vapidEnv={WEB_PUSH_PRIVATE_JWK:JSON.stringify(vapidJwk),WEB_PUSH_PUBLIC_KEY:base64(Buffer.concat([Buffer.from([4]),Buffer.from(publicJwk.x,'base64url'),Buffer.from(publicJwk.y,'base64url')])),WEB_PUSH_SUBJECT:'mailto:push@example.invalid'};
const preference={enabled:true,battle:true,letter:true,operation:true,construction:true,event:true,quietStart:0,quietEnd:0,digestMinutes:5};
let scopes=0,calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
function client(id=crypto.randomUUID()){
 const ecdh=createECDH('prime256v1');ecdh.generateKeys();const auth=randomBytes(16);
 return{ecdh,auth,subscription:{endpoint:'https://fcm.googleapis.com/fcm/send/'+id,keys:{p256dh:base64(ecdh.getPublicKey()),auth:base64(auth)}}};
}
function decrypt(client,body){
 const data=Buffer.from(body),salt=data.subarray(0,16),recordSize=data.readUInt32BE(16),keyLength=data[20];assert.equal(recordSize,4096);assert.equal(keyLength,65);
 const sender=data.subarray(21,21+keyLength),secret=client.ecdh.computeSecret(sender);
 const ikm=hkdfSync('sha256',secret,client.auth,Buffer.concat([Buffer.from('WebPush: info\0'),client.ecdh.getPublicKey(),sender]),32);
 const key=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: aes128gcm\0'),16),nonce=hkdfSync('sha256',ikm,salt,Buffer.from('Content-Encoding: nonce\0'),12);
 const encrypted=data.subarray(21+keyLength),cipher=createDecipheriv('aes-128-gcm',key,nonce);cipher.setAuthTag(encrypted.subarray(-16));
 const clear=Buffer.concat([cipher.update(encrypted.subarray(0,-16)),cipher.final()]);assert.equal(clear.at(-1),2,'RFC 8188 final record delimiter');return JSON.parse(clear.subarray(0,-1).toString('utf8'));
}
function checkVapid(header,endpoint,now){
 const matched=/^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(header);assert(matched);assert.equal(matched[2],vapidEnv.WEB_PUSH_PUBLIC_KEY);
 const [head,body,signature]=matched[1].split('.'),metadata=JSON.parse(Buffer.from(head,'base64url')),claims=JSON.parse(Buffer.from(body,'base64url'));
 assert.deepEqual(metadata,{typ:'JWT',alg:'ES256'});assert.equal(claims.aud,new URL(endpoint).origin);assert.equal(claims.sub,vapidEnv.WEB_PUSH_SUBJECT);assert.equal(claims.exp,Math.floor(now/1000)+43200);
 assert.equal(Buffer.from(signature,'base64url').length,64);assert(verify('sha256',Buffer.from(head+'.'+body),{key:createPublicKey({key:publicJwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')));
}
async function scope(name,run){
 const h=harness();h.now=NOW;Object.assign(h.env,vapidEnv);const originalFetch=globalThis.fetch;h.pushes=[];h.fetchStatus=201;
 globalThis.fetch=async(url,options)=>{h.pushes.push({url,options});if(h.onFetch)await h.onFetch(url,options);return new Response(null,{status:h.fetchStatus});};
 try{await run(h);scopes++;console.log('PASS '+name);}finally{globalThis.fetch=originalFetch;calls+=h.calls;h.close();}
}
async function setup(h,name='通知の領主',options={}){const player=await h.session(name),device=client();await h.api('/notifications/preferences',post(player,{...preference,...options}));await h.api('/notifications/subscribe',post(player,{subscription:device.subscription}));return{...player,device};}
function mail(h,p,title='戦勝報告',createdAt=h.now){const id='mail_'+crypto.randomUUID();h.sql.prepare('INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,request_id,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,p.user.id,p.user.id,title,'ロック画面に出してはいけない詳細','system:test:'+id,'hash',createdAt);return id;}
function ban(h,p){h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?) ON CONFLICT(user_id) DO UPDATE SET active=1,revision=revision+1,updated_at=excluded.updated_at').run(p.user.id,p.user.id,h.now);}
async function tick(h,clock={elapsedMs:0,running:true,speed:1},advance=60001){h.now+=advance;const result=await dispatchNotifications(h.env,clock);assert.equal(result.failed||0,0,JSON.stringify(result));return result;}
function save(h,p,value){h.sql.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,?) ON CONFLICT(user_id) DO UPDATE SET save_json=excluded.save_json,revision=player_saves.revision+1,updated_at=excluded.updated_at').run(p.user.id,JSON.stringify(value),h.now);}
function clockSave(h){const value=h.fresh();value.state.worldClock={id:'world-v1',elapsedMs:0};value.state.walking={...(value.state.walking||{}),campaignId:'notification_campaign'};return value;}
function operation(h,p,guildId,startsAt=h.now+180000){const id='op_'+crypto.randomUUID();h.sql.prepare("INSERT INTO alliance_operations(id,guild_id,creator_id,title,kind,castle_id,starts_at,expires_at,created_at) VALUES(?,?,?,'集合','gather','kiyosu',?,?,?)").run(id,guildId,p.user.id,startsAt,startsAt+3600000,h.now);return id;}

await scope('RFC 8291 independent receiver decryption, tamper rejection and RFC 8292 signature',async h=>{
 const device=client(),subscription={endpoint:device.subscription.endpoint,...device.subscription.keys},payload={title:'普請が完成しました',body:'城下町で確認できます。',tag:'sengoku-update',url:'/?notice=1'};
 const body=await encryptPush(subscription,payload);assert.deepEqual(decrypt(device,body),payload);const tampered=new Uint8Array(body);tampered[tampered.length-18]^=1;assert.throws(()=>decrypt(device,tampered));
 const auth=await vapidAuthorization(subscription.endpoint,h.env,h.now);checkVapid(auth,subscription.endpoint,h.now);
 assert((await sendWebPush(subscription,payload,h.env,h.now)).ok);assert.equal(h.pushes.length,1);const sent=h.pushes[0];assert.deepEqual(decrypt(device,sent.options.body),payload);checkVapid(sent.options.headers.Authorization,sent.url,h.now);
 assert.equal(sent.options.method,'POST');assert.equal(sent.options.redirect,'error');assert.equal(sent.options.headers['Content-Encoding'],'aes128gcm');assert.equal(sent.options.headers.TTL,'3600');
 assert((await sendWebPush(subscription,payload,h.env,h.now,async()=>false)).cancelled);assert.equal(h.pushes.length,1,'post-encryption cancellation never calls fetch');
 for(const endpoint of ['http://fcm.googleapis.com/x','https://fcm.googleapis.com.attacker.invalid/x','https://attacker.invalid/push','https://127.0.0.1/','https://name:pass@fcm.googleapis.com/','https://fcm.googleapis.com:444/','https://web.push.apple.com/#x'])assert.equal(allowedPushEndpoint(endpoint),false,endpoint);
 for(const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/token','https://web.push.apple.com/token','https://wns2-par02p.notify.windows.com/w/?token'])assert.equal(allowedPushEndpoint(endpoint),true);
});

await scope('notification defaults, explicit opt in, validation, device ownership and unsubscribe',async h=>{
 await h.api('/notifications',{expected:401});const p=await h.session('通知の初期値'),view=(await h.api('/notifications',{token:p.token})).data;assert.equal(view.preferences.enabled,false);assert.equal(view.devices,0);assert.equal(view.configured,true);assert.equal(view.publicKey,vapidEnv.WEB_PUSH_PUBLIC_KEY);
 await h.api('/notifications/preferences',post(p,{...preference,quietStart:24},400));await h.api('/notifications/preferences',post(p,{...preference,digestMinutes:1},400));
 const device=client();await h.api('/notifications/subscribe',post(p,{subscription:{...device.subscription,endpoint:'https://example.invalid/push'}},400));await h.api('/notifications/subscribe',post(p,{subscription:{...device.subscription,keys:{...device.subscription.keys,auth:'x'}}},400));
 await h.api('/notifications/subscribe',post(p,{subscription:device.subscription}));mail(h,p);assert.equal((await tick(h)).sent,0,'subscription alone does not opt in');
 await h.api('/notifications/preferences',post(p,preference));await h.api('/notifications/subscribe',post(p,{subscription:device.subscription}));assert.equal((await h.api('/notifications',{token:p.token})).data.devices,1);
 const other=await h.session('別の通知領主');assert.equal((await h.api('/notifications/subscribe',post(other,{subscription:device.subscription},409))).data.error.code,'PUSH_OTHER_ACCOUNT');
 await h.api('/notifications/unsubscribe',post(other,{endpoint:device.subscription.endpoint}));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions').get().n,1);await h.api('/notifications/unsubscribe',post(p,{all:true}));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions').get().n,0);
 delete h.env.WEB_PUSH_PRIVATE_JWK;assert.equal((await h.api('/notifications',{token:p.token})).data.configured,false);await h.api('/notifications/subscribe',post(p,{subscription:device.subscription},503));
});

await scope('device count and endpoint ownership remain atomic under concurrent registration',async h=>{
 const p=await setup(h,'端末上限'),other=await h.session('端末の競合相手');for(let i=0;i<3;i++)await h.api('/notifications/subscribe',post(p,{subscription:client().subscription}));
 const attempts=await Promise.all([h.api('/notifications/subscribe',post(p,{subscription:client().subscription},null)),h.api('/notifications/subscribe',post(p,{subscription:client().subscription},null))]);assert.deepEqual(attempts.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions WHERE user_id=?').get(p.user.id).n,5);
 await h.api('/notifications/unsubscribe',post(p,{all:true}));const shared=client(),race=await Promise.all([h.api('/notifications/subscribe',post(p,{subscription:shared.subscription},null)),h.api('/notifications/subscribe',post(other,{subscription:shared.subscription},null))]);assert.deepEqual(race.map(r=>r.response.status).sort(),[200,409]);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions WHERE endpoint=?').get(shared.subscription.endpoint).n,1);
 const before=h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions').get().n;h.beforeStatement=async query=>{if(!query.startsWith('INSERT INTO notification_subscriptions'))return;h.beforeStatement=null;ban(h,other);};await h.api('/notifications/subscribe',post(other,{subscription:client().subscription},403));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions').get().n,before);
});

await scope('digest coalesces unread facts once, suppresses private text and waits between sends',async h=>{
 const p=await setup(h);mail(h,p);mail(h,p,'手紙が届きました');const first=await tick(h);assert.equal(first.sent,1);assert.equal(h.pushes.length,1);const payload=decrypt(p.device,h.pushes[0].options.body);assert.equal(payload.title,'戦国VS：2件のお知らせ');assert(!JSON.stringify(payload).includes('ロック画面に出してはいけない'));
 const delivered=h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NOT NULL').get().n;assert.equal(delivered,2);const duplicate=await dispatchNotifications(h.env,{elapsedMs:0,running:true,speed:1});assert.equal(duplicate.waiting,true);assert.equal(h.pushes.length,1);
 mail(h,p,'新着便');assert.equal((await tick(h)).sent,0);assert.equal((await tick(h,undefined,240001)).sent,1);assert.equal(h.pushes.length,2);assert.equal((await tick(h,undefined,600001)).sent,0,'settled facts never resend');
 const read=mail(h,p);h.sql.prepare('INSERT INTO mail_reads(mail_id,user_id,read_at) VALUES(?,?,?)').run(read,p.user.id,h.now);assert.equal((await tick(h,undefined,600001)).sent,0);
});

await scope('JST quiet windows, category preferences and disabling pending notifications',async h=>{
 const quiet={quiet_start:22,quiet_end:8};assert(notificationQuiet(quiet,Date.parse('2026-11-21T13:00:00Z')));assert(notificationQuiet(quiet,Date.parse('2026-11-21T22:59:59Z')));assert(!notificationQuiet(quiet,Date.parse('2026-11-21T23:00:00Z')));assert(!notificationQuiet({quiet_start:8,quiet_end:8},NOW));
 assert(notificationQuiet({quiet_start:10,quiet_end:14},NOW));assert(!notificationQuiet({quiet_start:10,quiet_end:14},Date.parse('2026-11-21T05:00:00Z')));
 const p=await setup(h,'休止時間',{quietStart:11,quietEnd:14,battle:false});mail(h,p);mail(h,p,'書状のお知らせ');assert.equal((await tick(h)).sent,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,1,'disabled category is not queued');
 await h.api('/notifications/preferences',post(p,{...preference,enabled:false}));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NULL').get().n,0);h.now+=300001;await h.api('/notifications/preferences',post(p,preference));assert.equal((await tick(h)).sent,0,'reenabling does not replay disabled-period history');mail(h,p);assert.equal((await tick(h)).sent,1);
});

await scope('opt out, quiet change, category change, ban and unsubscribe win at the send commit',async h=>{
 for(const change of ['off','quiet','category','ban','remove']){
  const p=await setup(h,'最終確認'+change);mail(h,p);h.beforeStatement=async(query,params)=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?')||params[2]!==p.user.id)return;h.beforeStatement=null;
   if(change==='off')h.sql.prepare('UPDATE notification_preferences SET enabled=0,updated_at=updated_at+1 WHERE user_id=?').run(p.user.id);
   if(change==='quiet')h.sql.prepare('UPDATE notification_preferences SET quiet_start=11,quiet_end=14,updated_at=updated_at+1 WHERE user_id=?').run(p.user.id);
   if(change==='category')h.sql.prepare('UPDATE notification_preferences SET battle=0,updated_at=updated_at+1 WHERE user_id=?').run(p.user.id);
   if(change==='ban')ban(h,p);
   if(change==='remove')h.sql.prepare('DELETE FROM notification_subscriptions WHERE user_id=?').run(p.user.id);
  };assert.equal((await tick(h)).sent,0,change);assert.equal(h.pushes.length,0,change);
 }
});

await scope('overlapping scheduler claims cannot send the same notification twice',async h=>{
 const p=await setup(h,'重複配信防止',{digestMinutes:0});mail(h,p);let release,entered;const pending=new Promise(r=>release=r),started=new Promise(r=>entered=r);h.onFetch=async()=>{entered();await pending;};
 const first=dispatchNotifications(h.env,{elapsedMs:0,running:true,speed:1});await started;assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE lease_token<>\'\' AND delivered_at IS NULL').get().n,1);h.now+=60001;
 const second=await dispatchNotifications(h.env,{elapsedMs:0,running:true,speed:1});assert.equal(second.sent,0);assert.equal(h.pushes.length,1);release();assert.equal((await first).sent,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NOT NULL').get().n,1);
});

await scope('failed push retries after backoff and expired subscriptions are removed',async h=>{
 const p=await setup(h,'再送の通知');mail(h,p);h.fetchStatus=503;let result=await dispatchNotifications(h.env,{elapsedMs:0,running:true,speed:1});assert.equal(result.failed,1);assert.equal(result.sent,0);assert.equal(h.sql.prepare('SELECT failure_count FROM notification_subscriptions').get().failure_count,1);h.fetchStatus=201;assert.equal((await tick(h)).sent,0);assert.equal((await tick(h,undefined,300001)).sent,1);
 mail(h,p);h.fetchStatus=410;assert.equal((await tick(h,undefined,300001)).sent,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_subscriptions').get().n,0);
});

await scope('planned operations and guild letters recheck cancellation, membership and read state',async h=>{
 const a=await setup(h,'作戦通知'),b=await h.session('同盟からの差出人');const g=(await h.api('/guild',post(a,{name:'通知確認同盟'}))).data.guild;const op=operation(h,a,g.id);
 h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare("UPDATE alliance_operations SET status='cancelled' WHERE id=?").run(op);};assert.equal((await tick(h)).sent,0);
 operation(h,a,g.id,h.now+180000);h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(a.user.id);};assert.equal((await tick(h,undefined,300001)).sent,0);
 h.sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(a.user.id,g.id,h.now);const thread='thread_'+crypto.randomUUID(),letter='letter_'+crypto.randomUUID();h.sql.prepare("INSERT INTO base_letter_threads(id,kind,sender_id,guild_id,created_at,updated_at) VALUES(?,'guild',?,?,?,?)").run(thread,b.user.id,g.id,h.now,h.now);h.sql.prepare('INSERT INTO base_letter_messages(id,thread_id,sender_id,body,created_at) VALUES(?,?,?,?,?)').run(letter,thread,b.user.id,'秘密の文章',h.now);
 h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(a.user.id);};assert.equal((await tick(h,undefined,300001)).sent,0);assert.equal(h.pushes.length,0);
});

await scope('world clock schedules queued construction in sequence and respects pauses and cancellation',async h=>{
 const p=await setup(h,'普請の通知',{digestMinutes:0}),value=clockSave(h);value.state.jobs=[{kind:'building',id:'gold_mine',targetLevel:1,remainingSeconds:60},{kind:'building',id:'gold_mine',targetLevel:2,remainingSeconds:60}];save(h,p,value);
 assert.equal((await tick(h,{elapsedMs:0,running:true,speed:1})).sent,0);assert.deepEqual(h.sql.prepare('SELECT world_due_elapsed FROM notification_outbox ORDER BY world_due_elapsed').all().map(r=>r.world_due_elapsed),[60000,120000]);
 assert.equal((await tick(h,{elapsedMs:0,running:false,speed:1},300001)).sent,0);assert.equal((await tick(h,{elapsedMs:60000,running:true,speed:1})).sent,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NOT NULL').get().n,1);
 value.state.buildings.gold_mine=1;value.state.jobs=[];value.state.worldClock.elapsedMs=60000;save(h,p,value);assert.equal((await tick(h,{elapsedMs:120000,running:true,speed:1})).sent,0,'cancelled second construction cannot notify');
});

await scope('branch body and facilities with the same target level keep independent FIFO notices',async h=>{
 const p=await setup(h,'支城普請の通知',{digestMinutes:0}),value=clockSave(h),id='nijo_north';
 value.state.branches=[{id,parentCastleId:'nijo',direction:'north',level:0,fallen:false,facilities:{}}];
 value.state.jobs=[{}, {facilityId:'farm'}, {facilityId:'market'}].map(params=>({kind:'branch',id,targetLevel:1,remainingSeconds:60,...params}));
 save(h,p,value);
 await tick(h,{elapsedMs:0,running:true,speed:1},0);
 const forecasts=h.sql.prepare("SELECT id,world_due_elapsed FROM notification_outbox WHERE category='construction' ORDER BY world_due_elapsed").all();
 assert.deepEqual(forecasts.map(row=>row.world_due_elapsed),[60000,120000,180000]);
 assert.equal(new Set(forecasts.map(row=>row.id)).size,3);
 const before=structuredClone(value);
 value.state.worldClock.elapsedMs=60000;value.state.branches[0].level=1;value.state.jobs.shift();
 save(h,p,value);await h.db.batch(notificationSaveStatements(h.db,p.user.id,before,value,h.now));
 assert.equal((await tick(h,{elapsedMs:60000,running:true,speed:1})).sent,1);
 const partial=structuredClone(value);
 value.state.worldClock.elapsedMs=120000;value.state.branches[0].facilities.farm=1;value.state.jobs=[];
 save(h,p,value);await h.db.batch(notificationSaveStatements(h.db,p.user.id,partial,value,h.now));
 assert.equal((await tick(h,{elapsedMs:120000,running:true,speed:1})).sent,1);
 assert.equal((await tick(h,{elapsedMs:180000,running:true,speed:1})).sent,0);
 const delivered=h.sql.prepare("SELECT id FROM notification_outbox WHERE delivered_at IS NOT NULL AND category='construction'").all().map(row=>row.id).sort();
 assert.deepEqual(delivered,forecasts.slice(0,2).map(row=>row.id).sort());
});

await scope('an outstanding pre-queue facility forecast is replaced once on upgrade',async h=>{
 const p=await setup(h,'旧版の支城通知',{digestMinutes:0}),value=clockSave(h),id='nijo_north';
 value.state.branches=[{id,level:1,fallen:false,facilities:{}}];
 value.state.jobs=[{kind:'branch',id,facilityId:'farm',targetLevel:1,remainingSeconds:60}];
 save(h,p,value);
 const oldId='job:'+p.user.id+':notification_campaign:branch:'+id+':1';
 h.sql.prepare("INSERT INTO notification_outbox(id,user_id,category,title,body,due_at,world_due_elapsed,created_at) VALUES(?,?,'construction','普請が完成しました','普請',?,60000,?)").run(oldId,p.user.id,h.now+60000,h.now);
 assert.equal((await tick(h,{elapsedMs:60000,running:true,speed:1})).sent,1);
 const entries=h.sql.prepare("SELECT id FROM notification_outbox WHERE category='construction'").all();
 assert.deepEqual(entries.map(row=>row.id),[oldId+':facility:farm']);
});

await scope('completed work removed from jobs remains observable, while stale saves cannot send',async h=>{
 const p=await setup(h,'完成履歴'),before=clockSave(h),after=structuredClone(before);after.state.buildings.gold_mine=2;after.state.tech.agriculture=1;save(h,p,after);
 const additions=notificationSaveStatements(h.db,p.user.id,before,after,h.now);assert(additions.length>=3);await h.db.batch(additions);assert.equal((await tick(h,{elapsedMs:120000,running:true,speed:1})).sent,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NOT NULL').get().n,additions.length);
 await h.db.batch(notificationSaveStatements(h.db,p.user.id,before,after,h.now));assert.equal((await tick(h,{elapsedMs:120000,running:true,speed:1},300001)).sent,0,'same completed levels are idempotent');
 const next=structuredClone(after);next.state.buildings.gold_mine=3;save(h,p,next);await h.db.batch(notificationSaveStatements(h.db,p.user.id,after,next,h.now));h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;const reset=clockSave(h);reset.state.walking.campaignId='new_campaign';save(h,p,reset);};assert.equal((await tick(h,{elapsedMs:120000,running:true,speed:1},300001)).sent,0,'campaign change during encryption rejects stale job');
});

await scope('real sync commits completion notices atomically with the saved game',async h=>{
 const p=await setup(h,'同期した普請'),deviceId='notification-sync-device';let lease=(await h.api('/sync/lease',post(p,{deviceId}))).data;
 const value=h.fresh();value.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};value.state.turn=Math.floor(lease.clock.elapsedMs/60000);value.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 let stored=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId,revision:lease.revision,save:value}})).data;
 let game=GameEngine.fromSave(stored.save,GAME_OFFICERS);assert(game.upgrade('gold_mine').ok);stored=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId,revision:stored.revision,save:JSON.parse(game.exportSave())}})).data;
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0,'no scheduler observed the queued job');
 h.now+=61000;lease=(await h.api('/sync/lease',post(p,{deviceId}))).data;game=GameEngine.fromSave(lease.save,GAME_OFFICERS);assert(game.applyWorldClock(lease.clock).ok);assert.equal(game.state.buildings.gold_mine,1);assert.equal(game.state.jobs.length,0);
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.startsWith('UPDATE player_saves SET save_json=')))return;h.beforeBatch=null;h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(p.user.id);};
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId,revision:lease.revision,save:JSON.parse(game.exportSave())},expected:409});assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,0,'failed save must not announce completion');
 lease=(await h.api('/sync/lease',post(p,{deviceId}))).data;await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId,revision:lease.revision,save:JSON.parse(game.exportSave())}});
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox').get().n,1,'successful save recorded completion even after job disappeared');assert.equal((await tick(h,lease.clock)).sent,1);assert.match(decrypt(p.device,h.pushes[0].options.body).title,/普請/);
});

await scope('large digests stay within D1 parameter limits and retain every completion',async h=>{
 const p=await setup(h,'まとめ通知',{digestMinutes:0}),before=clockSave(h),after=structuredClone(before);after.state.buildings.gold_mine=17;save(h,p,after);await h.db.batch(notificationSaveStatements(h.db,p.user.id,before,after,h.now));
 let maxBindings=0;h.beforeStatement=async(query,params)=>{maxBindings=Math.max(maxBindings,params.length);assert(params.length<=100,'D1 allows at most 100 bound parameters per statement');};
 for(let i=0;i<3;i++)assert.equal((await tick(h,{elapsedMs:0,running:true,speed:1})).sent,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NOT NULL').get().n,17);assert(maxBindings>=70);assert.equal(h.pushes.length,3);
});

await scope('stale cleanup, clock changes and long-offline jobs retain correct notification receipts',async h=>{
 const p=await setup(h,'普請の競合確認',{digestMinutes:0}),before=clockSave(h),completed=structuredClone(before);save(h,p,before);completed.state.buildings.gold_mine=1;
 h.beforeStatement=async query=>{if(!query.startsWith("SELECT id,world_due_elapsed FROM notification_outbox WHERE user_id=? AND category='construction'"))return;h.beforeStatement=null;save(h,p,completed);await h.db.batch(notificationSaveStatements(h.db,p.user.id,before,completed,h.now));};
 assert.equal((await tick(h)).sent,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM notification_outbox WHERE delivered_at IS NULL').get().n,1,'an old save snapshot cannot delete a newly committed completion');assert.equal((await tick(h,undefined,300001)).sent,1);
 const next=structuredClone(completed);next.state.buildings.gold_mine=2;save(h,p,next);await h.db.batch(notificationSaveStatements(h.db,p.user.id,completed,next,h.now));h.sql.prepare("INSERT INTO world_clock(id,base_elapsed_ms,anchor_real_ms,running,speed,revision) VALUES('world-v1',0,?,1,1,0) ON CONFLICT(id) DO UPDATE SET revision=0").run(h.now);
 h.beforeStatement=async query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.exec("UPDATE world_clock SET revision=revision+1,running=0 WHERE id='world-v1'");};assert.equal((await tick(h,{id:'world-v1',elapsedMs:0,running:true,speed:1,revision:0})).sent,0);assert.equal((await tick(h,{id:'world-v1',elapsedMs:0,running:false,speed:1,revision:1},300001)).sent,1);
 const stale=structuredClone(next);stale.state.jobs=[{kind:'building',id:'gold_mine',targetLevel:3,remainingSeconds:60}];save(h,p,stale);assert.equal((await tick(h,{elapsedMs:60000,running:true,speed:1},60001)).sent,1);const deliveredCount=h.pushes.length;await tick(h,{elapsedMs:9*86400000,running:true,speed:1},9*86400000);await tick(h,{elapsedMs:9*86400000,running:true,speed:1});assert.equal(h.pushes.length,deliveredCount,'a user staying offline past retention cannot be renotified about the same job');
});

await scope('event expiry reminders reach existing events and the unauthenticated tick stays bounded',async h=>{
 const p=await setup(h,'終了前のお知らせ');const id='event_'+crypto.randomUUID(),start=h.now-23.5*3600000;h.sql.prepare("INSERT INTO timed_events(id,creator_id,name,duration_days,status,plan_json,created_at,starts_at,ends_at) VALUES(?,?, '公開合戦',1,'active','{}',?,?,?)").run(id,p.user.id,start,start,start+86400000);
 assert.equal((await tick(h)).sent,1);assert.match(decrypt(p.device,h.pushes[0].options.body).title,/まもなく終了/);const trigger=await h.api('/notifications/tick',{method:'POST',body:{}});assert.equal(trigger.data.waiting,true);assert.equal(h.pushes.length,1);
 ban(h,p);await h.api('/notifications',{token:p.token,expected:403});assert.equal((await tick(h,undefined,300001)).sent,0);
});

console.log(`Notifications: ${scopes} scopes, ${calls} API calls; all push traffic mocked, RFC payloads independently decrypted and VAPID signatures verified.`);
