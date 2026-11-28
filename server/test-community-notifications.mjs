import assert from 'node:assert/strict';
import {createECDH,generateKeyPairSync,randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {harness} from './test-support.mjs';
import {dispatchNotifications,dispatchMessageNotifications} from './notifications.js';

const NOW=Date.parse('2026-11-28T03:00:00Z'),prefs={enabled:true,battle:true,letter:true,operation:true,construction:true,event:true,chat:true,worldChat:false,announcement:true,quietStart:0,quietEnd:0,digestMinutes:0};
const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=keys.publicKey.export({format:'jwk'}),pushEnv={WEB_PUSH_PRIVATE_JWK:JSON.stringify(keys.privateKey.export({format:'jwk'})),WEB_PUSH_PUBLIC_KEY:Buffer.concat([Buffer.from([4]),Buffer.from(jwk.x,'base64url'),Buffer.from(jwk.y,'base64url')]).toString('base64url')};
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected}),me=async(h,p)=>(await h.api('/me',{token:p.token})).data;
let scopes=0,calls=0;
async function scope(name,run){const h=harness(),oldFetch=globalThis.fetch;h.now=NOW;Object.assign(h.env,pushEnv);h.pushes=[];globalThis.fetch=async(url,options)=>{h.pushes.push({url,options});return new Response(null,{status:201});};try{await run(h);scopes++;console.log('PASS '+name);}finally{globalThis.fetch=oldFetch;calls+=h.calls;h.close();}}
async function subscriber(h,name,options={}){const p=await h.session(name),ecdh=createECDH('prime256v1');ecdh.generateKeys();p.endpoint='https://fcm.googleapis.com/fcm/send/'+crypto.randomUUID();await h.api('/notifications/preferences',post(p,{...prefs,...options}));await h.api('/notifications/subscribe',post(p,{subscription:{endpoint:p.endpoint,keys:{p256dh:ecdh.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}}}));return p;}
async function immediate(h,p,path){return dispatchMessageNotifications(h.env,null,{path,actorId:p.user.id,since:h.now});}
async function tick(h){h.now+=60001;const result=await dispatchNotifications(h.env,null);assert.equal(result.failed||0,0);return result;}
function chat(h,p,room,channel){return Number(h.sql.prepare('INSERT INTO messages(room_key,channel,user_id,body,created_at) VALUES(?,?,?,?,?) RETURNING id').get(room,channel,p.user.id,'本文は通知に出さない',h.now).id);}
async function friends(h,a,b){await h.api('/friends/request',post(a,{userId:b.user.id}));await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));return'friend:'+([a.user.id,b.user.id].sort().join(':'));}
async function guild(h,p,name){return(await h.api('/guild',post(p,{name}))).data.guild.id;}
async function join(h,p,id){return h.api('/guild/join',post(p,{guildId:id}));}
async function alliance(h,p,action,body={}){return(await h.api('/alliance/'+action,post(p,{requestId:crypto.randomUUID(),...body}))).data;}
function mail(h,p,title,created=h.now){const id='audit_'+crypto.randomUUID();h.sql.prepare('INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,request_id,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,p.user.id,p.user.id,title,'秘密の本文','system:'+id,'hash',created);return id;}
async function savedPlayer(h,name){const p=await h.session(name);p.deviceId='writer-'+p.user.id;const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,save=h.fresh();save.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});return p;}
function envelope(h,p,extra={}){return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:Number(h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(p.user.id).revision),...extra};}

{
 const migrations=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries.map(entry=>({idx:entry.idx,tag:entry.tag,sql:readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8')}));
 const checked=spawnSync('python3',['-c',`
import json,sqlite3,sys
migrations=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT,5)
assert db.getlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT)==5
try:
    db.execute(' UNION ALL '.join('SELECT '+str(i) for i in range(6)))
except sqlite3.OperationalError as error:
    assert 'too many terms in compound SELECT' in str(error)
else:
    raise AssertionError('D1 compound SELECT limit was not enforced')
old_receipts=[]
old_notices=[]
for migration in migrations:
    if migration['idx']==57:
        people=[('migration_sender','sender','sender','clan','sender',1,1)]+[('migration_'+str(i),'name'+str(i),'key'+str(i),'clan','token'+str(i),1,1) for i in range(600)]
        db.executemany('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)',people)
        db.executemany("INSERT INTO friendships(user_a,user_b,requested_by,status,created_at,updated_at) VALUES(?,'migration_sender','migration_sender','pending',90,90)",[(p[0],) for p in people[1:]])
        db.executemany("INSERT INTO court_membership_requests(actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at) VALUES(?,?,?,?,?,'kiyosu',1,?,90)",[(p[0],'request'+str(i),'hash'+str(i),'commit'+str(i),'campaign'+str(i),'term'+str(i)) for i,p in enumerate(people[1:])])
        old_receipts=db.execute('SELECT * FROM court_membership_requests ORDER BY actor_id').fetchall()
    if migration['idx']==61:
        assert db.execute('SELECT COUNT(*) FROM notification_social_events WHERE push_eligible=0').fetchone()[0]==600
        db.execute("UPDATE notification_social_events SET read_at=123 WHERE user_id='migration_0'")
        db.execute("INSERT INTO notification_social_events(seq,id,user_id,actor_id,kind,destination,audience,created_at,expires_at,push_eligible) VALUES(9000,'deleted-high-water','migration_0','migration_sender','friend-request','friends','person',90,999,0)")
        db.execute("DELETE FROM notification_social_events WHERE id='deleted-high-water'")
        old_notices=db.execute('SELECT * FROM notification_social_events ORDER BY seq').fetchall()
    for index,statement in enumerate(migration['sql'].split('--> statement-breakpoint')):
        if not statement.strip():
            continue
        try:
            db.executescript(statement)
        except sqlite3.Error as error:
            raise AssertionError(migration['tag']+' statement '+str(index+1)+' violates the production migration limits: '+str(error)) from error
assert db.execute('SELECT actor_id,request_id,request_hash,commit_token,source_campaign_id,source_home,released_castle_count,term_id,created_at FROM court_membership_requests ORDER BY actor_id').fetchall()==old_receipts
assert db.execute('SELECT * FROM notification_social_events ORDER BY seq').fetchall()==old_notices
assert db.execute("SELECT seq FROM sqlite_sequence WHERE name='notification_social_events'").fetchone()[0]==9000
assert db.execute('SELECT COUNT(*) FROM court_lineages').fetchone()[0]==0
assert db.execute('PRAGMA foreign_key_check').fetchall()==[]
print(json.dumps({'compoundSelectLimit':5,'migrations':len(migrations),'newMigrations':[m['tag'] for m in migrations if m['idx']>=57],'preservedReceipts':len(old_receipts),'preservedNotices':len(old_notices)}))
`],{input:JSON.stringify(migrations),encoding:'utf8',maxBuffer:1024*1024});
 assert.equal(checked.status,0,checked.error?.message||checked.stderr);console.log('PASS every migration, including populated 0057–0062, executes under D1 limit: '+checked.stdout.trim());scopes++;
}

{
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');const entries=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries;
 for(const entry of entries.filter(e=>e.idx<57))for(const command of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(command);
 sql.exec("INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES('migration_user','old','old','clan','hash',1,1); INSERT INTO notification_preferences(user_id,enabled,updated_at,chat_since) VALUES('migration_user',1,100,70); INSERT INTO messages(room_key,channel,user_id,body,created_at) VALUES('world','world','migration_user','old',80);");
 sql.exec("INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES('migration_sender','sender','sender','clan','sender-hash',1,1),('migration_accepted','accepted','accepted','clan','accepted-hash',1,1); INSERT INTO friendships(user_a,user_b,requested_by,status,created_at,updated_at) VALUES('migration_sender','migration_user','migration_sender','pending',90,90),('migration_accepted','migration_user','migration_accepted','accepted',80,90);");
 for(const command of readFileSync(new URL('./drizzle/0057_community_notifications.sql',import.meta.url),'utf8').split('--> statement-breakpoint').filter(s=>s.trim()))sql.exec(command);
 const p=sql.prepare('SELECT * FROM notification_preferences').get();assert.equal(p.letter_since,100);assert.equal(p.battle_since,100);assert.equal(p.chat_since,70);assert.equal(sql.prepare('SELECT last_message_id FROM notification_chat_baseline').get().last_message_id,1);const migrated=sql.prepare('SELECT * FROM notification_social_events').all();assert.equal(migrated.length,1);assert.equal(migrated[0].kind,'friend-request');assert.equal(migrated[0].push_eligible,0);assert.equal(migrated[0].user_id,'migration_user');assert.equal(sql.prepare('PRAGMA foreign_key_check').all().length,0);sql.close();console.log('PASS community migration keeps existing consent, recovers pending inbox requests and excludes old chat history');scopes++;
}

await scope('closed-panel summaries count every authorized room without marking any message read',async h=>{
 const a=await h.session('会話の送信'),b=await h.session('会話の受信'),outsider=await h.session('別の領主'),room=await friends(h,a,b),g=await guild(h,a,'会話の同盟');await join(h,b,g);
 chat(h,a,'world','world');chat(h,a,'world','world');chat(h,b,'world','world');chat(h,a,'guild:'+g,'guild');const first=chat(h,a,room,'friend');
 let status=await me(h,b);assert.equal(status.unreadChat.world,2);assert.equal(status.unreadChat.guild,1);assert.equal(status.unreadChat.friends[a.user.id],1);assert.equal(status.unreadChat.total,4);assert.equal(status.unreadChat.latestId,first);
 const url='/chat?channel=friend&target='+a.user.id+'&read=manual';await h.api(url,{token:b.token});assert.equal((await me(h,b)).unreadChat.friends[a.user.id],1,'fetching or closing before render does not read');
 const second=chat(h,a,room,'friend');await h.api('/chat/read',post(b,{channel:'friend',target:a.user.id,lastId:second},400));await h.api('/chat/read',post(b,{channel:'world',lastId:first},400));
 const read=(await h.api('/chat/read',post(b,{channel:'friend',target:a.user.id,lastId:first}))).data;assert.equal(read.lastId,first);assert.equal((await me(h,b)).unreadChat.friends[a.user.id],1,'a message arriving during ACK remains unread');
 await h.api('/chat?channel=guild',{token:b.token});assert.equal((await me(h,b)).unreadChat.guild,0,'old clients retain GET/read compatibility');
 await h.api('/chat?channel=friend&target='+a.user.id+'&read=manual',{token:outsider.token,expected:403});assert.equal((await me(h,outsider)).unreadChat.friends[a.user.id],undefined);
 await h.api(url,{token:b.token});await h.api('/friends',{method:'DELETE',token:b.token,body:{userId:a.user.id}});await h.api('/chat/read',post(b,{channel:'friend',target:a.user.id,lastId:second},403));assert.equal((await me(h,b)).unreadChat.friends[a.user.id],undefined);
});

await scope('friend requests and replies notify their recipient once, including same-time re-requests',async h=>{
 const a=await subscriber(h,'申請する人'),b=await subscriber(h,'申請を受ける人'),other=await h.session('無関係な人');
 await Promise.all([h.api('/friends/request',post(a,{userId:b.user.id})),h.api('/friends/request',post(a,{userId:b.user.id}))]);let inbox=await me(h,b);assert.equal(inbox.unreadSocial.friends,1);const first=inbox.socialNotifications[0].id;assert.equal((await me(h,a)).unreadSocial.total,0);assert.equal((await me(h,other)).unreadSocial.total,0);assert.equal((await immediate(h,a,'/friends/request')).sent,1);assert.equal(h.pushes[0].url,b.endpoint);
 await h.api('/friends/request',post(a,{userId:b.user.id}));assert.equal((await immediate(h,a,'/friends/request')).sent,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM notification_social_events').get().n,1);
 assert.deepEqual((await h.api('/notifications/read',post(other,{ids:[first]}))).data.readIds,[]);assert.deepEqual((await h.api('/notifications/read',post(b,{ids:[first]}))).data.readIds,[first]);assert.deepEqual((await h.api('/notifications/read',post(b,{ids:[first]}))).data.readIds,[first]);assert.equal((await me(h,b)).unreadSocial.total,0);
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));assert.equal((await me(h,a)).socialNotifications[0].kind,'friend-accepted');assert.equal((await immediate(h,b,'/friends/respond')).sent,1);
 await h.api('/friends',{method:'DELETE',token:b.token,body:{userId:a.user.id}});await h.api('/friends/request',post(a,{userId:b.user.id}));inbox=await me(h,b);assert.equal(inbox.unreadSocial.friends,1);assert.notEqual(inbox.socialNotifications[0].id,first);assert.equal((await immediate(h,a,'/friends/request')).sent,1);
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:false}));assert.equal((await me(h,a)).socialNotifications[0].kind,'friend-declined');assert.equal((await immediate(h,b,'/friends/respond')).sent,1);assert.equal((await me(h,b)).unreadSocial.total,0);
});

await scope('world mentions and replies notify only the addressed player without enabling every world post',async h=>{
 const sender=await h.session('世界の話し手'),target=await subscriber(h,'呼びかける相手'),other=await subscriber(h,'別の読者');
 chat(h,sender,'world','world');assert.equal((await immediate(h,sender,'/chat')).sent,0);
 const mention=chat(h,sender,'world','world');h.sql.prepare('UPDATE messages SET mentions_json=? WHERE id=?').run(JSON.stringify([target.user.id]),mention);assert.equal((await immediate(h,sender,'/chat')).sent,1);assert.equal(h.pushes[0].url,target.endpoint);assert.equal(h.sql.prepare('SELECT category FROM notification_outbox WHERE id=?').get('chat:'+target.user.id+':'+mention).category,'chat');
 const original=chat(h,target,'world','world'),reply=chat(h,sender,'world','world');h.sql.prepare('UPDATE messages SET reply_to_id=? WHERE id=?').run(original,reply);assert.equal((await immediate(h,sender,'/chat')).sent,1);assert.equal(h.pushes[1].url,target.endpoint);assert.equal((await immediate(h,sender,'/chat')).sent,0);assert.equal(h.pushes.filter(p=>p.url===other.endpoint).length,0);
});

await scope('a read, revocation or opted-out chat category wins before community push delivery',async h=>{
 const a=await h.session('申請送信'),b=await subscriber(h,'配信直前に確認');await h.api('/friends/request',post(a,{userId:b.user.id}));
 h.beforeStatement=query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('UPDATE notification_social_events SET read_at=? WHERE user_id=?').run(h.now,b.user.id);};assert.equal((await immediate(h,a,'/friends/request')).sent,0);assert.equal(h.pushes.length,0);
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:false}));await h.api('/friends/request',post(a,{userId:b.user.id}));await h.api('/notifications/preferences',post(b,{...prefs,chat:false}));assert.equal((await me(h,b)).unreadSocial.friends,1,'in-game inbox works without push permission');assert.equal((await immediate(h,a,'/friends/request')).sent,0);
 h.now++;await h.api('/notifications/preferences',post(b,prefs));assert.equal((await immediate(h,a,'/friends/request')).sent,0,'enabling does not replay the disabled period');
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:false}));h.now++;await h.api('/friends/request',post(a,{userId:b.user.id}));h.beforeStatement=query=>{if(!query.startsWith('UPDATE notification_subscriptions SET last_sent_at=?'))return;h.beforeStatement=null;h.sql.prepare('DELETE FROM friendships').run();};assert.equal((await immediate(h,a,'/friends/request')).sent,0);assert.equal(h.pushes.length,0);
});

await scope('guild applications, invitations and decisions reach only current recipients and officers',async h=>{
 const owner=await subscriber(h,'通知の盟主'),officer=await subscriber(h,'通知の副盟主'),member=await subscriber(h,'通知の同盟員'),applicant=await subscriber(h,'加入申請者'),g=await guild(h,owner,'加入通知同盟');await join(h,officer,g);await join(h,member,g);h.sql.prepare('INSERT INTO guild_officers(user_id,guild_id,appointed_by,appointed_at) VALUES(?,?,?,?)').run(officer.user.id,g,owner.user.id,h.now);
 const requestId=crypto.randomUUID(),data={requestId,guildId:g,message:'通知に本文は出さない'};await alliance(h,applicant,'apply',data);await alliance(h,applicant,'apply',data);
 assert.equal((await me(h,owner)).unreadSocial.guild,1);assert.equal((await me(h,officer)).unreadSocial.guild,1);assert.equal((await me(h,member)).unreadSocial.total,0);assert.equal((await me(h,applicant)).unreadSocial.total,0);assert.equal((await immediate(h,applicant,'/alliance/apply')).sent,2);
 await alliance(h,owner,'membership',{guildId:g,playerId:applicant.user.id,decision:'approve'});assert.equal((await me(h,applicant)).socialNotifications[0].kind,'guild-approved');assert.equal((await me(h,owner)).unreadSocial.guild,0);assert.equal((await me(h,officer)).unreadSocial.guild,0);assert.equal((await immediate(h,owner,'/alliance/membership')).sent,1);
 await alliance(h,owner,'invite',{guildId:g,playerId:applicant.user.id});assert.equal((await me(h,applicant)).socialNotifications[0].kind,'guild-invitation');assert.equal((await me(h,applicant)).unreadSocial.guild,1);await join(h,applicant,g);assert.equal((await me(h,applicant)).unreadSocial.guild,0);assert.equal((await immediate(h,owner,'/alliance/invite')).sent,0,'consumed invitations do not deliver later');
 const next=await h.session('新たな申請者');await alliance(h,next,'apply',{guildId:g,message:''});h.sql.prepare('DELETE FROM guild_officers WHERE user_id=?').run(officer.user.id);h.now++;h.sql.prepare('INSERT INTO guild_officers(user_id,guild_id,appointed_by,appointed_at) VALUES(?,?,?,?)').run(officer.user.id,g,owner.user.id,h.now);assert.equal((await me(h,officer)).unreadSocial.guild,0,'reappointment cannot revive an old officer notice');h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(officer.user.id);await join(h,officer,g);h.sql.prepare('INSERT INTO guild_officers(user_id,guild_id,appointed_by,appointed_at) VALUES(?,?,?,?)').run(officer.user.id,g,owner.user.id,h.now);assert.equal((await me(h,officer)).unreadSocial.guild,0,'leave/rejoin cannot revive an old officer notice');
 await alliance(h,owner,'membership',{guildId:g,playerId:next.user.id,decision:'deny'});assert.equal((await me(h,next)).socialNotifications[0].kind,'guild-declined');
});

await scope('treasury requests and their result notify the owner and exact applicant',async h=>{
 const owner=await subscriber(h,'金庫通知盟主'),member=await subscriber(h,'金庫通知申請者'),other=await subscriber(h,'金庫通知別員'),g=await guild(h,owner,'金庫通知同盟');await join(h,member,g);await join(h,other,g);
 const request=await alliance(h,member,'treasury/request',{resource:'gold',amount:100,transferRequestId:crypto.randomUUID()});assert.equal((await me(h,owner)).socialNotifications[0].kind,'treasury-request');assert.equal((await me(h,other)).unreadSocial.total,0);assert.equal((await immediate(h,member,'/alliance/treasury/request')).sent,1);
 await alliance(h,owner,'treasury/approve',{withdrawalId:request.result.withdrawalId,decision:'approve'});assert.equal((await me(h,member)).socialNotifications[0].kind,'treasury-approved');assert.equal((await immediate(h,owner,'/alliance/treasury/approve')).sent,1);assert.equal((await me(h,owner)).unreadSocial.total,0);
 h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(member.user.id);assert.equal((await me(h,member)).unreadSocial.total,0);
});

await scope('trade proposal, approval, rejection and cancellation are atomic and recipient-only',async h=>{
 const a=await savedPlayer(h,'交易送信'),b=await savedPlayer(h,'交易受信'),other=await h.session('交易無関係');
 const propose=async extra=>(await h.api('/trades',post(a,envelope(h,a,{targetPlayerId:b.user.id,offer:{gold:10},want:{rice:5},...extra})))).data;
 const act=async(p,id,action)=>h.api('/trades/'+id+'/'+action,post(p,envelope(h,p)));
 const requestId=crypto.randomUUID(),first=await propose({requestId});await propose({requestId,expectedRevision:1});assert.equal((await me(h,b)).unreadSocial.trade,1);assert.equal((await me(h,a)).unreadSocial.trade,0);assert.equal((await me(h,other)).unreadSocial.trade,0);
 await act(b,first.trade.id,'accept');assert.equal((await me(h,a)).socialNotifications[0].kind,'trade-accepted');assert.equal((await me(h,b)).unreadSocial.trade,0);await act(a,first.trade.id,'claim');assert.equal((await me(h,a)).unreadSocial.trade,1,'claiming assets does not manufacture a second event');
 const second=await propose();await act(b,second.trade.id,'reject');assert((await me(h,a)).socialNotifications.some(n=>n.kind==='trade-rejected'));
 const third=await propose();await act(a,third.trade.id,'cancel');assert.equal((await me(h,b)).socialNotifications[0].kind,'trade-cancelled');assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM notification_social_events').get().n,6);
});

await scope('quiet-hour edits retain unqueued mail while category opt-in does not replay old facts',async h=>{
 const p=await subscriber(h,'保存後も通知する人');const first=mail(h,p,'お知らせ'),battle=mail(h,p,'戦勝報告');h.now+=1000;await h.api('/notifications/preferences',post(p,{...prefs,quietStart:22,quietEnd:7}));await tick(h);
 for(const id of [first,battle])assert(h.sql.prepare('SELECT delivered_at FROM notification_outbox WHERE id=?').get('mail:'+p.user.id+':'+id)?.delivered_at);
 await h.api('/notifications/preferences',post(p,{...prefs,letter:false}));const disabled=mail(h,p,'停止中の通知');h.now++;await h.api('/notifications/preferences',post(p,prefs));const current=mail(h,p,'再開後の通知');await tick(h);assert.equal(h.sql.prepare('SELECT id FROM notification_outbox WHERE id=?').get('mail:'+p.user.id+':'+disabled),undefined);assert(h.sql.prepare('SELECT delivered_at FROM notification_outbox WHERE id=?').get('mail:'+p.user.id+':'+current)?.delivered_at);
});

await scope('more than twenty unread letters drain exactly once and disabled battle mail cannot starve letters',async h=>{
 const p=await subscriber(h,'大量書状の受信',{battle:false}),sender=await h.session('大量書状の送信'),pair=[p.user.id,sender.user.id].sort();h.sql.prepare("INSERT INTO base_letter_threads(id,kind,user_a,user_b,created_at,updated_at) VALUES('backlog','player',?,?,?,?)").run(...pair,h.now,h.now);
 for(let i=0;i<25;i++)h.sql.prepare("INSERT INTO base_letter_messages(id,thread_id,sender_id,body,created_at) VALUES(?,'backlog',?,'本文',?)").run('letter_'+i,sender.user.id,h.now);for(let i=0;i<25;i++)mail(h,p,'戦勝報告');const ordinary=mail(h,p,'通常の郵便'),gift=mail(h,p,'戦勝の贈り物');h.sql.prepare('UPDATE mail_campaigns SET gift_json=? WHERE id=?').run(JSON.stringify({gold:100}),gift);
 for(let i=0;i<6;i++)await tick(h);const stats=h.sql.prepare("SELECT COUNT(*) AS n,SUM(delivered_at IS NOT NULL) AS delivered FROM notification_outbox WHERE user_id=? AND category='letter'").get(p.user.id);assert.equal(stats.n,27);assert.equal(stats.delivered,27);for(const id of [ordinary,gift])assert(h.sql.prepare('SELECT delivered_at FROM notification_outbox WHERE id=?').get('mail:'+p.user.id+':'+id)?.delivered_at);const before=h.pushes.length;await tick(h);assert.equal(h.pushes.length,before);
});

await scope('bounded inbox pages keep complete counts and acknowledging one page retains later events',async h=>{
 const a=await h.session('大量受信'),senders=[];for(let i=0;i<32;i++){const b=(await h.api('/session',{method:'POST',body:{name:'申請'+i,clan:'織田家'},headers:{'CF-Connecting-IP':'192.0.2.'+(40+i)}})).data;senders.push(b);await h.api('/friends/request',post(b,{userId:a.user.id}));}
 const g=await guild(h,senders[0],'別分類の通知');await alliance(h,senders[0],'invite',{guildId:g,playerId:a.user.id});
 let inbox=await me(h,a);assert.equal(inbox.unreadSocial.friends,32);assert.equal(inbox.unreadSocial.guild,1,'counts include destinations beyond the first page');assert.equal(inbox.unreadSocial.total,33);assert.equal(inbox.socialNotifications.length,30);const ids=inbox.socialNotifications.map(n=>n.id),latest=inbox.unreadSocial.latestId;assert.equal((await h.api('/notifications/read',post(a,{ids}))).data.readIds.length,30);inbox=await me(h,a);assert.equal(inbox.unreadSocial.friends,2);assert.equal(inbox.socialNotifications.length,3);assert.equal(inbox.unreadSocial.latestId,latest);
});

await scope('pre-release actionable requests enter the inbox without old pushes, while their new replies still notify',async h=>{
 const a=await subscriber(h,'移行前の申請者'),b=await subscriber(h,'移行前の受信者'),owner=await subscriber(h,'移行前の盟主'),member=await subscriber(h,'移行前の同盟員'),expired=await h.session('期限切れの申請者'),g=await guild(h,owner,'移行時の同盟');await join(h,member,g);
 await h.api('/friends/request',post(a,{userId:b.user.id}));await alliance(h,a,'apply',{guildId:g,message:''});await alliance(h,owner,'invite',{guildId:g,playerId:b.user.id});
 await alliance(h,member,'treasury/request',{resource:'gold',amount:10,transferRequestId:crypto.randomUUID()});const approved=await alliance(h,member,'treasury/request',{resource:'rice',amount:10,transferRequestId:crypto.randomUUID()});await alliance(h,owner,'treasury/approve',{withdrawalId:approved.result.withdrawalId,decision:'approve'});
 h.sql.prepare("INSERT INTO trades(id,sender_id,recipient_id,sender_name,recipient_name,offer_json,want_json,status,created_at,updated_at) VALUES('migration_trade',?,?,?,?,'{}','{}','pending',?,?)").run(a.user.id,b.user.id,a.user.name,b.user.name,h.now,h.now);
 h.sql.prepare("INSERT INTO alliance_applications(guild_id,user_id,status,message,created_at,updated_at,expires_at,revision) VALUES(?,?,'pending','',?,?,?,1)").run(g,expired.user.id,h.now-200,h.now-200,h.now-1);
 // Execute the exact migration backfill against pre-existing domain records.
 h.sql.prepare('DELETE FROM notification_social_events').run();const migration=readFileSync(new URL('./drizzle/0057_community_notifications.sql',import.meta.url),'utf8'),backfill=migration.match(/-- BEGIN COMMUNITY INBOX BACKFILL\n([\s\S]*?)\n-- END COMMUNITY INBOX BACKFILL/)[1].replaceAll("CAST(strftime('%s','now') AS INTEGER)*1000",String(h.now));h.sql.exec(backfill);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM notification_social_events WHERE push_eligible<>0').get().n,0);const inbox=await me(h,b);assert.equal(inbox.unreadSocial.friends,1);assert.equal(inbox.unreadSocial.guild,1);assert.equal(inbox.unreadSocial.trade,1);assert.equal((await me(h,owner)).unreadSocial.guild,2);assert.equal((await me(h,member)).socialNotifications[0].kind,'treasury-approved');assert.equal((await me(h,expired)).unreadSocial.total,0);assert(!h.sql.prepare('SELECT id FROM notification_social_events WHERE subject_id=?').get(expired.user.id));
 assert.equal((await immediate(h,a,'/friends/request')).sent,0);assert.equal((await tick(h)).sent,0);assert.equal(h.pushes.length,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM notification_outbox').get().n,0);
 await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));assert.equal((await me(h,a)).socialNotifications[0].kind,'friend-accepted');assert.equal(h.sql.prepare("SELECT push_eligible FROM notification_social_events WHERE kind='friend-accepted'").get().push_eligible,1);assert.equal((await immediate(h,b,'/friends/respond')).sent,1);assert.equal(h.pushes[0].url,a.endpoint);
});

console.log(`Community notifications: ${scopes} scopes, ${calls} API calls; local SQLite and mocked push only.`);
