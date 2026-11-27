import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// Exercise the real Worker with synthetic identities and transactional SQLite.
const post=(actor,body,expected=200)=>({method:'POST',token:actor.token,body,expected});
const read=async(h,actor,path)=>(await h.api(path,{token:actor?.token})).data;
const run=(h,sql,...params)=>h.sql.prepare(sql).run(...params);
const one=(h,sql,...params)=>h.sql.prepare(sql).get(...params);
async function player(h,name,castleId){
 const p=await h.session(name);p.deviceId='operations-'+p.user.id;
 const lease=await readLease(h,p);
 await h.api('/castles/residency/start',post(p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode:'lord',clan:'織田家',difficulty:'normal'}));return p;
}
const readLease=async(h,p)=>(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
async function roles(h){
 const admin=await h.session('管理担当甲');await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
 const deputy=await player(h,'管理担当乙','kiyosu'),ordinary=await player(h,'通常領主','inuyama');
 const revision=(await read(h,admin,'/admin/deputy')).revision;
 await h.api('/admin/deputy',post(admin,{action:'appoint',targetPlayerId:deputy.user.id,expectedRevision:revision,requestId:crypto.randomUUID()}));
 return {admin,deputy,ordinary};
}
function publicOnly(payload){
 const forbidden=new Set(['isAdmin','isDeputy','isStaff','canOperate','is_admin','is_deputy','is_staff','adminPlayerId','adminUserId','operatorUserId']);
 function visit(value){if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){assert(!forbidden.has(key),'Public operational field '+key);visit(child);}}
 visit(payload);
}
let passed=0,calls=0,maxBindings=0;
async function scope(name,fn){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100);}return batch(statements);};try{await fn(h);passed++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const fetchOriginal=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No external requests permitted');};
try{
await scope('private capability preserves principal and deputy identities and excludes ordinary players',async h=>{
 const {admin,deputy,ordinary}=await roles(h);
 for(const [actor,isAdmin,isDeputy,canOperate]of [[admin,true,false,true],[deputy,false,true,true],[ordinary,false,false,false]]){
  const own=(await read(h,actor,'/me')).user;assert.equal(own.isAdmin,isAdmin);assert.equal(own.isDeputy,isDeputy);assert.equal(own.canOperate,canOperate);
 }
 const routes=['/admin/music','/admin/events','/admin/premium/reviews','/admin/premium/metrics','/admin/promotion','/admin/moderation/bans','/staff/recent-logins','/staff/roaming'];
 for(const path of routes){await h.api(path,{token:deputy.token});await h.api(path,{token:ordinary.token,expected:403});}
 const caps=(await read(h,deputy,'/staff/roaming')).capabilities;assert(caps.canApply&&caps.canApprove&&!caps.canPropose);
 const privateTarget=await read(h,deputy,'/admin/moderation/target?playerId='+admin.user.id);assert.equal(privateTarget.player.isAdmin,true);assert.equal(privateTarget.canBan,false);
 const sync=await read(h,deputy,'/sync');assert.equal(sync.entitlements.edo,false);assert.equal(sync.entitlements.ieyasuU,false);assert.equal(sync.entitlements.kagoshima,true);
});

await scope('principal appointments and all chancellor decisions remain unavailable to the deputy',async h=>{
 const {deputy,ordinary}=await roles(h),paths=['/admin/deputy','/admin/staff','/admin/court/offices','/admin/court/regent','/admin/court/succession'];
 for(const path of paths)await h.api(path,{token:deputy.token,expected:403});
 for(const path of [...paths.filter(p=>p!=='/admin/court/succession'),'/admin/court/leader','/admin/court/succession/csn_'+('a'.repeat(32))+'/approve','/admin/court/succession/csn_'+('a'.repeat(32))+'/reject'])await h.api(path,post(deputy,{targetPlayerId:ordinary.user.id,requestId:crypto.randomUUID()},403));
 assert.equal(one(h,'SELECT COUNT(*) n FROM staff_members').n,0);
 assert.equal(one(h,'SELECT COUNT(*) n FROM court_leader').n,0);
});

await scope('deputy updates announcements, sends anonymous site mail, controls music and shared time',async h=>{
 const {admin,deputy,ordinary}=await roles(h);
 await h.api('/admin/announcement',post(deputy,{text:'次回の催事をご案内します。'}));
 const config=await read(h,null,'/config');assert.equal(config.announcement,'次回の催事をご案内します。');assert(!JSON.stringify(config).includes(deputy.user.id));
 const body={target:ordinary.user.id,title:'参加のご案内',body:'合戦にご参加ください。',gift:{gold:10},requestId:crypto.randomUUID()};
 await h.api('/admin/mail',post(deputy,body));assert.equal((await h.api('/admin/mail',post(deputy,body))).data.alreadySent,true);
 const mail=await read(h,ordinary,'/mail');assert.equal(mail.mail.length,1);publicOnly(mail);assert(!JSON.stringify(mail).includes(deputy.user.id));assert(!JSON.stringify(mail).includes(deputy.user.name));
 await h.api('/admin/music',post(deputy,{enabled:true,mode:'continuous',expectedRevision:0,requestId:crypto.randomUUID()}));assert.equal((await read(h,null,'/music')).musicBroadcast.mode,'continuous');
 const clock=(await read(h,null,'/config')).clock;await h.api('/world-clock',{method:'PATCH',token:deputy.token,body:{revision:clock.revision,speed:2,running:false}});assert.equal((await read(h,null,'/config')).clock.speed,2);
 await h.api('/admin/music',{token:admin.token});
});

await scope('deputy performs moderation and expulsion while principal and own account remain protected',async h=>{
 const {admin,deputy,ordinary}=await roles(h);
 const body={targetPlayerId:ordinary.user.id,action:'ban',expectedRevision:0,requestId:crypto.randomUUID(),reason:'テスト管理メモ'};
 await h.api('/admin/moderation',post(deputy,body));assert.equal(one(h,'SELECT active FROM player_bans WHERE user_id=?',ordinary.user.id).active,1);
 await h.api('/admin/moderation',post(deputy,{...body,action:'unban',expectedRevision:1,requestId:crypto.randomUUID()}));
 for(const actor of [admin,deputy])await h.api('/admin/moderation',post(deputy,{...body,targetPlayerId:actor.user.id,requestId:crypto.randomUUID()},400));
 const target=await read(h,deputy,'/admin/moderation/target?playerId='+ordinary.user.id);
 await h.api('/admin/moderation/expel',post(deputy,{targetPlayerId:ordinary.user.id,expectedRevision:target.expulsion.revision,expectedCastleId:target.expulsion.castleId,expectedLordEpoch:target.expulsion.lordEpoch,requestId:crypto.randomUUID()}));
 assert.equal(one(h,'SELECT pending FROM player_expulsions WHERE user_id=?',ordinary.user.id).pending,1);assert.equal(one(h,"SELECT lord_user_id FROM castle_seats WHERE castle_id='inuyama'").lord_user_id,null);
});

await scope('deputy can publish and end events, apply deployments and review eligible payment holds',async h=>{
 const {deputy}=await roles(h),catalog=(await read(h,null,'/events/catalog')).battles;
 const draft=(await h.api('/admin/events/generate',post(deputy,{battleId:catalog[0].id,durationDays:1,requestId:crypto.randomUUID()}))).data.event;
 await h.api('/admin/events/'+draft.id+'/publish',post(deputy,{requestId:crypto.randomUUID()}));
 const visible=await read(h,null,'/events');publicOnly(visible);assert(!JSON.stringify(visible).includes(deputy.user.id));
 await h.api('/admin/events/'+draft.id+'/end',post(deputy,{requestId:crypto.randomUUID()}));
 await h.api('/admin/roaming/deployment',post(deputy,{expectedRevision:1,totalTroops:100000,squadSize:1000,respawnSeconds:120,requestId:crypto.randomUUID()}));assert.equal((await read(h,null,'/roaming/deployment')).deployment.totalTroops,100000);
 run(h,"INSERT INTO premium_events VALUES('evt_local_operations','fixture','ch_local_operations','fixture-hash','accepted','fixture',?,?,?)",h.now,h.now,crypto.randomUUID());
 run(h,'INSERT INTO premium_blocks(scope,object_id,source_event_id,reason,created_at,updated_at) VALUES(?,?,?,?,?,?)','charge','ch_local_operations','evt_local_operations','refund_review',h.now,h.now);
 const hold=(await read(h,deputy,'/admin/premium/reviews')).holds[0];
 await h.api('/admin/premium/reviews',post(deputy,{scope:hold.scope,objectId:hold.objectId,expectedRevision:hold.revision,expectedEventId:hold.eventId,reason:'ローカル試験用の正規確認結果',requestId:crypto.randomUUID()}));
 assert.equal((await read(h,deputy,'/admin/premium/reviews')).holds.length,0);
});

await scope('public profiles and shared rows omit operational role flags while preserving game distinctions',async h=>{
 const {admin,deputy,ordinary}=await roles(h);
 for(const actor of [admin,deputy]){
  await h.api('/presence',post(actor,{online:true,deviceId:actor.deviceId||'operations-admin'}));
  await h.api('/chat',post(actor,{channel:'world',text:'こんにちは。',requestId:crypto.randomUUID()}));
  const profile=await read(h,null,'/players/'+actor.user.id+'/profile');publicOnly(profile);
  if(actor===admin)assert.deepEqual(profile.player.courtOffice,{title:'太政大臣',kind:'chancellor'});
  assert(profile.player.cityHonors.some(c=>c.id===(actor===admin?'edo':'kagoshima')));
 }
 for(const path of ['/online','/field','/players?q='+encodeURIComponent('管理担当')])publicOnly(await read(h,null,path));
 publicOnly(await read(h,ordinary,'/chat?channel=world'));
 const own=await read(h,deputy,'/me');assert.equal(own.user.isDeputy,true);assert.equal(own.user.canOperate,true);
});

await scope('dismissal or reappointment during a write blocks old-term changes and private reads',async h=>{
 const {deputy}=await roles(h);
 const body={enabled:true,mode:'loop',expectedRevision:0,requestId:crypto.randomUUID()};
 h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO music_broadcast_requests')))return;h.beforeBatch=null;run(h,"UPDATE deputy_operator_state SET term_id=? WHERE id=1",crypto.randomUUID());};
 const blocked=await h.api('/admin/music',post(deputy,body,403));assert.equal(blocked.data.error.code,'OPERATIONAL_REQUIRED');assert.equal((await read(h,null,'/music')).musicBroadcast.revision,0);
 const receiptCount=one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n;assert.equal(receiptCount,0);
 let changed=false;h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-city-honors')))return;changed=true;run(h,'UPDATE deputy_operator_state SET user_id=NULL,term_id=NULL WHERE id=1');};
 await h.api('/admin/moderation/players?q='+encodeURIComponent('管理担当'),{token:deputy.token,expected:403});assert(changed);
 const own=await read(h,deputy,'/me');assert.equal(own.user.isDeputy,false);assert.equal(own.user.canOperate,false);
});

await scope('deputy joins private chat and voice; former-term calls cannot be revived',async h=>{
 const {admin,deputy,ordinary}=await roles(h);
 await h.api('/chat',post(deputy,{channel:'admin',text:'管理連絡です。',requestId:crypto.randomUUID()}));await h.api('/chat?channel=admin',{token:ordinary.token,expected:403});
 const joined=(await h.api('/voice/join',post(deputy,{channel:'admin',muted:true}))).data;
 assert(joined.sessionId);await h.api('/voice/join',post(admin,{channel:'admin',muted:true}));
 const roster=await read(h,admin,'/voice/room?channel=admin');assert.equal(roster.participants.length,2);assert(!JSON.stringify(roster).includes(deputy.user.id));
 run(h,'UPDATE deputy_operator_state SET term_id=? WHERE id=1',crypto.randomUUID());
 const fresh=await read(h,admin,'/voice/room?channel=admin');assert.equal(fresh.participants.length,1);
 await h.api('/voice/poll?sessionId='+joined.sessionId,{token:deputy.token,expected:409});
});
}finally{globalThis.fetch=fetchOriginal;}
console.log(JSON.stringify({passed,calls,maxBindings,externalRequests:0,realPlayerChanges:0}));
