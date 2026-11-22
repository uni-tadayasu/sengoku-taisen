import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';

let scopes=0,calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const offer={type:'offer',sdp:'v=0\r\no=- 123456 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\na=sendrecv\r\na=rtpmap:111 opus/48000/2\r\n'};
const candidate={candidate:'candidate:1 1 UDP 2122252543 192.0.2.10 50000 typ host',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'testUfrag'};
const join=(h,p,channel='guild',muted=false,expected=200)=>h.api('/voice/join',post(p,{channel,muted},expected));
const poll=(h,p,id,after=0,expected=200)=>h.api('/voice/poll?sessionId='+id+'&after='+after,{token:p.token,expected});
const heartbeat=(h,p,id,muted=false,expected=200)=>h.api('/voice/heartbeat',post(p,{sessionId:id,muted},expected));
const signal=(h,p,id,to,kind='offer',payload=offer,expected=200)=>h.api('/voice/signal',post(p,{sessionId:id,toSessionId:to,kind,payload},expected));
const leave=(h,p,id,expected=200)=>h.api('/voice/leave',post(p,{sessionId:id},expected));
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
async function scope(name,run){const h=harness();try{await run(h);scopes++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function alliance(h,n=2,label='通話同盟'){
 const players=[];for(let i=0;i<n;i++)players.push(await h.session(label+'領主'+i));
 const guild=(await h.api('/guild',post(players[0],{name:label}))).data.guild;
 for(const player of players.slice(1))await h.api('/guild/join',post(player,{guildId:guild.id}));
 return {players,guild};
}
async function administration(h){
 const admin=await h.session('通信運営'),staff=await h.session('通信担当');
 await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
 h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run(staff.user.id,admin.user.id,h.now,'test-staff-term');
 return {admin,staff};
}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Voice tests must not contact a real service');};
try{
 await scope('authentication, exact channels and no privilege disclosure in guild roster',async h=>{
  const {players:[a,b],guild}=await alliance(h),outsider=await h.session('通話の外'),{admin,staff}=await administration(h);
  await h.api('/voice/room?channel=guild',{expected:401});await h.api('/voice/join',post(null,{channel:'guild',muted:false},401));
  assert.equal((await join(h,outsider,'guild',false,403)).data.error.code,'GUILD_REQUIRED');assert.equal((await join(h,a,'admin',false,403)).data.error.code,'STAFF_CHAT_REQUIRED');
  for(const channel of ['world','friend','','guild:forged'])await join(h,a,channel,false,400);
  await h.api('/voice/room?channel=guild&channel=admin',{token:a.token,expected:400});await h.api('/voice/room?channel=guild&target=other',{token:a.token,expected:400});
  await h.api('/voice/join',post(a,{channel:'guild',muted:false,isAdmin:true},400));await h.api('/voice/join',post(a,{channel:'guild',muted:'yes'},400));
  await h.api('/guild/join',post(admin,{guildId:guild.id}));await h.api('/guild/join',post(staff,{guildId:guild.id}));
  const one=(await join(h,a)).data,two=(await join(h,b,'guild',true)).data;await join(h,admin);await join(h,staff);
  assert.match(one.sessionId,/^vc_[a-f0-9]{32}$/);assert.equal(one.heartbeatMs,10000);assert.equal(one.leaseMs,45000);assert.equal(one.pollMs,2000);assert.equal(one.room.maxParticipants,8);assert.equal(one.relayAvailable,false);
  const roster=(await h.api('/voice/room?channel=guild',{token:a.token})).data;assert.equal(roster.participants.length,4);assert.equal(roster.participants.find(p=>p.sessionId===one.sessionId).isSelf,true);assert.equal(roster.participants.find(p=>p.sessionId===two.sessionId).muted,true);
  for(const participant of roster.participants)assert.deepEqual(Object.keys(participant).sort(),['courtOffice','isSelf','joinedAt','muted','name','sessionId']);
  const serialized=JSON.stringify(roster);for(const p of [a,b,admin,staff])assert(!serialized.includes(p.user.id));assert(!serialized.includes('isAdmin'));assert(!serialized.includes('isStaff'));assert.equal(roster.participants.find(p=>p.name===admin.user.name).courtOffice.title,'太政大臣');assert.equal(roster.participants.find(p=>p.name===staff.user.name).courtOffice.title,'参議');
 });
 await scope('offer answer ICE ordering, stable replay receipts, ack and exact room isolation',async h=>{
  const {players:[a,b]}=await alliance(h),{players:[other]}=await alliance(h,1,'別同盟'),{admin}=await administration(h),one=(await join(h,a)).data,two=(await join(h,b)).data,elsewhere=(await join(h,other)).data,privateCall=(await join(h,admin,'admin')).data;
  assert.equal((await signal(h,a,one.sessionId,elsewhere.sessionId,'offer',offer,410)).data.error.code,'VOICE_PEER_LEFT');await signal(h,a,one.sessionId,privateCall.sessionId,'offer',offer,410);
  await signal(h,other,one.sessionId,two.sessionId,'offer',offer,410);await signal(h,a,one.sessionId,one.sessionId,'offer',offer,400);
  const sent=(await signal(h,a,one.sessionId,two.sessionId)).data;assert.equal((await signal(h,a,one.sessionId,two.sessionId)).data.id,sent.id);assert.equal(count(h,'voice_signals'),1);
  const ice=(await signal(h,a,one.sessionId,two.sessionId,'ice',candidate)).data,received=(await poll(h,b,two.sessionId)).data;assert.deepEqual(received.signals.map(s=>s.kind),['offer','ice']);assert.equal(received.after,ice.id);assert(received.signals.every(s=>s.fromSessionId===one.sessionId));
  assert.deepEqual((await poll(h,a,one.sessionId)).data.signals,[]);await poll(h,b,two.sessionId,received.after);assert.equal(count(h,'voice_signals'),2,'acked records retain deduplication receipt');
  assert.equal((await signal(h,a,one.sessionId,two.sessionId)).data.id,sent.id);assert.equal((await poll(h,b,two.sessionId,received.after)).data.signals.length,0,'lost-response retry cannot redeliver a consumed description');
  const answer={type:'answer',sdp:offer.sdp.replace('123456 2','123456 3')};await signal(h,b,two.sessionId,one.sessionId,'answer',answer);assert.equal((await poll(h,a,one.sessionId)).data.signals[0].payload.type,'answer');
  await leave(h,b,two.sessionId);await leave(h,b,two.sessionId);assert.equal((await poll(h,a,one.sessionId)).data.participants.length,1);assert.equal(count(h,'voice_signals'),0);await poll(h,b,two.sessionId,0,410);
 });
 await scope('atomic capacity remains eight under simultaneous joins and account replacement',async h=>{
  const {players}=await alliance(h,10);for(const p of players.slice(0,7))await join(h,p);
  let entered=0,release;const barrier=new Promise(resolve=>release=resolve);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO voice_sessions')))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
  const result=await Promise.all(players.slice(7,9).map(p=>join(h,p,'guild',false,null)));assert.deepEqual(result.map(r=>r.response.status).sort(),[200,409]);assert.equal(count(h,'voice_sessions'),8);
  assert.equal((await join(h,players[9],'guild',false,409)).data.error.code,'VOICE_ROOM_FULL');
  const old=h.sql.prepare('SELECT id FROM voice_sessions WHERE user_id=?').get(players[0].user.id).id,replacement=(await join(h,players[0],'guild',true)).data;assert.notEqual(old,replacement.sessionId);assert.equal(count(h,'voice_sessions'),8);await poll(h,players[0],old,0,410);
  await leave(h,players[0],old);assert.equal((await poll(h,players[0],replacement.sessionId)).data.participants.length,8,'late old leave cannot remove replacement call');
 });
 await scope('mute heartbeat, lease expiry and replacement never retarget old signaling',async h=>{
  const {players:[a,b]}=await alliance(h),one=(await join(h,a)).data,two=(await join(h,b)).data;
  await signal(h,a,one.sessionId,two.sessionId);const replacement=(await join(h,b)).data;assert.equal((await poll(h,b,replacement.sessionId)).data.signals.length,0);await signal(h,a,one.sessionId,two.sessionId,'offer',offer,410);
  h.now+=10000;const beat=(await heartbeat(h,a,one.sessionId,true)).data;assert.equal(beat.participants.find(p=>p.isSelf).muted,true);assert.equal(count(h,'voice_signals'),0,'bounded heartbeat cleanup removes orphaned signals');
  h.now+=35001;await poll(h,b,replacement.sessionId,0,410);assert.equal((await poll(h,a,one.sessionId)).data.participants.length,1);h.now+=10000;await heartbeat(h,a,one.sessionId,false,410);
  const renewed=(await join(h,b)).data;assert.equal(renewed.participants.length,1);assert.equal(count(h,'voice_sessions'),1);
 });
 await scope('membership removal and same-millisecond rejoin invalidate old session and pending signals',async h=>{
  const {players:[a,b],guild}=await alliance(h),one=(await join(h,a)).data,two=(await join(h,b)).data;await signal(h,b,two.sessionId,one.sessionId);
  const oldEpoch=h.sql.prepare('SELECT epoch FROM voice_membership_epochs WHERE user_id=?').get(b.user.id).epoch,joinedAt=h.sql.prepare('SELECT joined_at FROM guild_members WHERE user_id=?').get(b.user.id).joined_at;
  h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);assert.equal((await poll(h,b,two.sessionId,0,409)).data.error.code,'VOICE_ACCESS_CHANGED');assert.equal((await poll(h,a,one.sessionId)).data.signals.length,0);
  h.sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(b.user.id,guild.id,joinedAt);assert(h.sql.prepare('SELECT epoch FROM voice_membership_epochs WHERE user_id=?').get(b.user.id).epoch>oldEpoch);
  await heartbeat(h,b,two.sessionId,false,409);await signal(h,b,two.sessionId,one.sessionId,'offer',offer,409);const next=(await join(h,b)).data;assert.notEqual(next.sessionId,two.sessionId);
  await leave(h,a,next.sessionId);assert.equal((await poll(h,b,next.sessionId)).data.participants.length,2,'a caller cannot remove another participant');
 });
 await scope('staff term revocation, reappointment and bans invalidate active sessions',async h=>{
  const {admin,staff}=await administration(h),one=(await join(h,admin,'admin')).data,two=(await join(h,staff,'admin')).data;await signal(h,staff,two.sessionId,one.sessionId);
  h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id);assert.equal((await poll(h,admin,one.sessionId)).data.participants.length,1);assert.equal((await poll(h,admin,one.sessionId)).data.signals.length,0);await poll(h,staff,two.sessionId,0,409);
  h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run(staff.user.id,admin.user.id,h.now,'new-staff-term');await heartbeat(h,staff,two.sessionId,false,409);
  const replacement=(await join(h,staff,'admin')).data;h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(staff.user.id,'fixture',admin.user.id,h.now,h.now);
  assert.equal((await poll(h,staff,replacement.sessionId,0,403)).data.error.code,'ACCOUNT_BANNED');assert.equal((await poll(h,admin,one.sessionId)).data.participants.length,1);
  h.sql.prepare('UPDATE player_bans SET active=0,revision=2 WHERE user_id=?').run(staff.user.id);await heartbeat(h,staff,replacement.sessionId,false,409);assert.equal((await join(h,staff,'admin')).data.participants.length,2);
 });
 await scope('commit races prevent stale joining, sending and lease extension',async h=>{
  const {players:[a,b],guild}=await alliance(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO voice_sessions')))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);};
  await join(h,b,'guild',false,409);assert.equal(count(h,'voice_sessions'),0);await h.api('/guild/join',post(b,{guildId:guild.id}));
  const one=(await join(h,a)).data,two=(await join(h,b)).data;h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO voice_signals')))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);};
  await signal(h,a,one.sessionId,two.sessionId,'offer',offer,410);assert.equal(count(h,'voice_signals'),0);await h.api('/guild/join',post(b,{guildId:guild.id}));const renewed=(await join(h,b)).data;
  const prior=h.sql.prepare('SELECT lease_until FROM voice_sessions WHERE id=?').get(renewed.sessionId).lease_until;h.now+=1000;h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('UPDATE voice_sessions SET muted=')))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);};
  await heartbeat(h,b,renewed.sessionId,true,409);assert.equal(h.sql.prepare('SELECT lease_until FROM voice_sessions WHERE id=?').get(renewed.sessionId).lease_until,prior);
 });
 await scope('final-response guards withhold stale rosters and SDP after membership changes',async h=>{
  const {players:[a,b],guild}=await alliance(h),one=(await join(h,a)).data,two=(await join(h,b)).data;await signal(h,b,two.sessionId,one.sessionId);
  h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('SELECT s.id,s.from_session_id')))return;h.afterBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(b.user.id);};
  const denied=await poll(h,a,one.sessionId,0,409);assert.equal(denied.data.error.code,'VOICE_ROSTER_CHANGED');assert.equal(denied.data.signals,undefined);assert(!JSON.stringify(denied.data).includes('123456'));assert.equal((await poll(h,a,one.sessionId)).data.signals.length,0);
  await h.api('/guild/join',post(b,{guildId:guild.id}));await join(h,b);h.afterBatch=statements=>{if(!statements.some(s=>s.sql.includes('SELECT v.id,u.name')))return;h.afterBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(a.user.id);};
  const lost=await h.api('/voice/room?channel=guild',{token:a.token,expected:409});assert.equal(lost.data.participants,undefined);await poll(h,a,one.sessionId,0,409);
 });
 await scope('audio-only validation, bounded pending queue, rate limits and query validation',async h=>{
  const {players:[a,b]}=await alliance(h),one=(await join(h,a)).data,two=(await join(h,b)).data;
  const invalidOffers=[{...offer,type:'answer'},{...offer,sdp:offer.sdp+'m=video 9 UDP/TLS/RTP/SAVPF 96\r\n'},{...offer,sdp:offer.sdp.replace('m=audio','m=application')},{...offer,sdp:'v=0\r\n'},{...offer,sdp:offer.sdp+'a=x:'+ 'x'.repeat(12000)},{...offer,sdp:offer.sdp+'\u0000'},{...offer,token:'forged'}];
  for(const payload of invalidOffers)await signal(h,a,one.sessionId,two.sessionId,'offer',payload,400);
  for(const payload of [{...candidate,sdpMLineIndex:1},{...candidate,candidate:'candidate:bad\nline'},{...candidate,usernameFragment:'bad\0text'},null,{candidate:'x'}])await signal(h,a,one.sessionId,two.sessionId,'ice',payload,400);
  await signal(h,a,one.sessionId,two.sessionId,'video',offer,400);await h.api('/voice/poll?sessionId='+one.sessionId+'&after=-1',{token:a.token,expected:400});await h.api('/voice/poll?sessionId='+one.sessionId+'&after=9007199254740992',{token:a.token,expected:400});
  const endOfCandidates={candidate:'',sdpMid:'0',sdpMLineIndex:0,usernameFragment:'testUfrag'};await signal(h,a,one.sessionId,two.sessionId,'ice',endOfCandidates);const end=(await poll(h,b,two.sessionId)).data;assert.deepEqual(end.signals[0].payload,endOfCandidates);await poll(h,b,two.sessionId,end.after);
  const insert=h.sql.prepare("INSERT INTO voice_signals(room_key,from_session_id,to_session_id,kind,payload_json,payload_hash,created_at) VALUES(?,?,?,'ice',?,?,?)");for(let i=0;i<240;i++)insert.run(one.room.id,one.sessionId,two.sessionId,JSON.stringify(candidate),'full-'+i,h.now);
  assert.equal((await signal(h,a,one.sessionId,two.sessionId,'offer',offer,429)).data.error.code,'VOICE_SIGNAL_BACKLOG');h.sql.exec('UPDATE voice_signals SET acknowledged=1');await signal(h,a,one.sessionId,two.sessionId);
  h.sql.prepare('UPDATE rate_limits SET count=300 WHERE scope=?').run('voice-signal:'+a.user.id);assert.equal((await signal(h,a,one.sessionId,two.sessionId,'ice',candidate,429)).data.error.code,'RATE_LIMITED');
 });
 await scope('optional TURN credentials are short lived, renewable and never expose shared secret',async h=>{
  const {players:[a]}=await alliance(h,1);h.now+=590000;h.env.VOICE_TURN_SHARED_SECRET='voice-fixture-private-secret-'+crypto.randomUUID();h.env.VOICE_TURN_URLS=JSON.stringify(['turn:relay.example.test:3478?transport=udp','turns:relay.example.test:5349?transport=tcp']);
  const call=(await join(h,a)).data;assert.equal(call.relayAvailable,true);assert.equal(call.iceServers.length,2);const turn=call.iceServers[1],expires=Number(turn.username.split(':')[0]);assert.equal(expires,Math.floor(h.now/600000)*600+3600);assert(turn.username.endsWith(call.sessionId));assert.equal(turn.credential,createHmac('sha1',h.env.VOICE_TURN_SHARED_SECRET).update(turn.username).digest('base64'));assert(!JSON.stringify(call).includes(h.env.VOICE_TURN_SHARED_SECRET));
  h.now+=10000;const beat=(await heartbeat(h,a,call.sessionId)).data;assert.notEqual(beat.iceServers[1].credential,turn.credential);assert(Date.parse(beat.iceServersExpiresAt)>Date.parse(call.iceServersExpiresAt));
  h.env.VOICE_TURN_URLS='https://forged.invalid';assert.equal((await heartbeat(h,a,call.sessionId)).data.relayAvailable,false);
 });
 await scope('schema readiness checks voice tables and membership triggers; migration seeds old members',async h=>{
  const {players:[a,b]}=await alliance(h);const health=(await h.api('/health')).data;assert.equal(health.version,'4.0.0');assert.equal(health.features.audioCalls,true);
  h.sql.exec('DROP TRIGGER voice_guild_move');assert.equal((await h.api('/health',{expected:503})).data.error.code,'SERVICE_UNAVAILABLE');
  h.sql.exec('DROP TRIGGER voice_guild_join; DROP TRIGGER voice_guild_leave; DROP TABLE voice_signals; DROP TABLE voice_sessions; DROP TABLE voice_membership_epochs');await h.api('/health',{expected:503});
  for(const sql of readFileSync(new URL('./drizzle/0021_audio_calls.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(v=>v.trim()).filter(Boolean))h.sql.exec(sql);
  assert.equal(count(h,'voice_membership_epochs'),2);assert.equal((await join(h,a)).data.participants.length,1);assert.equal((await join(h,b)).data.participants.length,2);assert.equal((await h.api('/health')).data.status,'ready');
 });
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,scopes,calls,productionRequests:0}));
