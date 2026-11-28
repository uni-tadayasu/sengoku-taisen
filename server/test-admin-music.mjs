import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';

const INITIAL={enabled:false,mode:'loop',revision:0,startedAt:null,updatedAt:null};
const RELEASE_VERSION=JSON.parse(readFileSync(new URL('./package.json',import.meta.url),'utf8')).version;
const BASE=Date.UTC(2026,10,27,6);
const one=(h,sql,...params)=>h.sql.prepare(sql).get(...params);
const run=(h,sql,...params)=>h.sql.prepare(sql).run(...params);
const draft=(overrides={})=>({enabled:true,mode:'loop',expectedRevision:0,requestId:crypto.randomUUID(),...overrides});
async function owner(h){const actor=await h.session('音楽の運営');run(h,"INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)",actor.user.id,h.now);return actor;}
const put=(h,a,body,expected=200)=>h.api('/admin/music',{method:'POST',token:a.token,body,expected});
const read=async(h,a)=>(await h.api('/admin/music',{token:a.token})).data;
const publicState=async h=>(await h.api('/config')).data;
let passed=0,calls=0,externalRequests=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('External requests are forbidden');};
async function scope(name,fn){const h=harness();h.now=BASE;try{await fn(h);passed++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}

try{
await scope('anonymous defaults, private management and no identity leakage',async h=>{
  const initial=await publicState(h);assert.deepEqual(initial.musicBroadcast,INITIAL);assert.equal(initial.serverNow,new Date(BASE).toISOString());assert.equal(initial.features.adminMusicBroadcast,true);assert.equal(initial.version,RELEASE_VERSION);
  const admin=await owner(h),guest=await h.session('一般領主');
  run(h,'INSERT INTO staff_members(user_id,appointed_by,appointed_at) VALUES(?,?,?)',guest.user.id,admin.user.id,h.now);
  assert.deepEqual((await read(h,admin)).musicBroadcast,INITIAL);
  await h.api('/admin/music',{expected:401});await h.api('/admin/music',{method:'POST',body:draft(),expected:401});
  await h.api('/admin/music',{token:guest.token,expected:403});await put(h,guest,draft(),403);
  run(h,'DELETE FROM staff_members WHERE user_id=?',guest.user.id);await put(h,guest,draft(),403);
  const visible=JSON.stringify(await publicState(h));for(const secret of [admin.user.id,admin.token,guest.user.id,guest.token,h.env.SENGOKU_ADMIN_KEY])assert(!visible.includes(secret));
  assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,0);
  await h.api('/health');
});

await scope('frequent anonymous music polls have no gameplay or identity side effects',async h=>{
  const tables=h.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const snapshot=()=>tables.map(({name})=>({name,rows:h.sql.prepare('SELECT * FROM "'+name+'"').all()}));
  const before=snapshot();
  const music=(await h.api('/music')).data;assert.deepEqual(music,{ok:true,musicBroadcast:INITIAL,serverNow:new Date(BASE).toISOString()});
  await h.api('/music',{headers:{Authorization:'Bearer deliberately-invalid'}});
  await h.api('/music',{origin:'https://www.kasai-solutions-inc.com.attacker.invalid',expected:403});
  assert.deepEqual(snapshot(),before);
});

await scope('ON, loop to continuous, OFF and restart use authoritative real time',async h=>{
  const a=await owner(h);
  const first=(await put(h,a,draft())).data;assert.equal(first.changed,true);assert.equal(first.idempotent,false);assert.equal(first.appliedRevision,1);
  assert.deepEqual(first.musicBroadcast,{enabled:true,mode:'loop',revision:1,startedAt:new Date(BASE).toISOString(),updatedAt:new Date(BASE).toISOString()});
  h.now+=7000;const continuous=(await put(h,a,draft({mode:'continuous',expectedRevision:1}))).data;
  assert.equal(continuous.musicBroadcast.mode,'continuous');assert.equal(continuous.musicBroadcast.revision,2);assert.equal(continuous.musicBroadcast.startedAt,new Date(h.now).toISOString());
  h.now+=9000;const off=(await put(h,a,draft({enabled:false,mode:'continuous',expectedRevision:2}))).data;
  assert.equal(off.musicBroadcast.enabled,false);assert.equal(off.musicBroadcast.startedAt,null);assert.equal(off.musicBroadcast.revision,3);
  h.now+=2000;const again=(await put(h,a,draft({mode:'continuous',expectedRevision:3}))).data;
  assert.equal(again.musicBroadcast.startedAt,new Date(h.now).toISOString());assert.equal(again.musicBroadcast.revision,4);
  assert.deepEqual((await publicState(h)).musicBroadcast,again.musicBroadcast);
  assert.deepEqual((await h.api('/music')).data.musicBroadcast,again.musicBroadcast);
});

await scope('same desired state preserves playhead and repeated request IDs are idempotent',async h=>{
  const a=await owner(h),request=draft(),first=(await put(h,a,request)).data;
  h.now+=12345;const repeated=(await put(h,a,{...request,requestId:request.requestId.toUpperCase()})).data;
  assert.equal(repeated.idempotent,true);assert.deepEqual(repeated.musicBroadcast,first.musicBroadcast);assert.equal(repeated.requestId,request.requestId);
  const same=(await put(h,a,draft({expectedRevision:1}))).data;assert.equal(same.changed,false);assert.equal(same.appliedRevision,1);assert.deepEqual(same.musicBroadcast,first.musicBroadcast);
  assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,2);
});

await scope('delayed retries return the latest OFF state without re-enabling music',async h=>{
  const a=await owner(h),request=draft();await put(h,a,request);h.now+=1000;
  const off=(await put(h,a,draft({enabled:false,expectedRevision:1}))).data;
  h.now+=1000;const replay=(await put(h,a,request)).data;
  assert.equal(replay.idempotent,true);assert.equal(replay.appliedRevision,1);assert.equal(replay.musicBroadcast.revision,2);assert.deepEqual(replay.musicBroadcast,off.musicBroadcast);
  assert.equal((await put(h,a,{...request,mode:'continuous'},409)).data.error.code,'REQUEST_ID_REUSED');
  assert.equal((await put(h,a,draft({enabled:false}),409)).data.error.code,'MUSIC_REVISION_CONFLICT');
});

await scope('strict input and same-origin restrictions reject unsafe transport state',async h=>{
  const a=await owner(h);
  for(const changes of [{enabled:1},{mode:'repeat'},{expectedRevision:-1},{expectedRevision:1.2},{expectedRevision:'0'},{expectedRevision:Number.MAX_SAFE_INTEGER},{requestId:'invalid'},{requestId:'00000000-0000-0000-0000-000000000000'},{url:'https://example.invalid/audio.mp3'},{startedAt:new Date(h.now).toISOString()}])await put(h,a,draft(changes),400);
  for(const key of ['enabled','mode','expectedRevision','requestId']){const body=draft();delete body[key];await put(h,a,body,400);}
  await h.api('/admin/music',{method:'PUT',token:a.token,body:draft(),expected:405});
  await h.api('/admin/music',{method:'POST',token:a.token,body:draft(),origin:'https://www.kasai-solutions-inc.com.attacker.invalid',expected:403});
  assert.deepEqual((await publicState(h)).musicBroadcast,INITIAL);assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,0);
});

await scope('concurrent retries commit once and concurrent distinct commands use revision CAS',async h=>{
  const a=await owner(h),request=draft();
  const retries=await Promise.all([put(h,a,request),put(h,a,request)]);
  assert.equal(retries.filter(r=>r.data.idempotent).length,1);assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,1);
  const race=await Promise.all([put(h,a,draft({enabled:false,expectedRevision:1}),null),put(h,a,draft({mode:'continuous',expectedRevision:1}),null)]);
  assert.deepEqual(race.map(r=>r.response.status).sort(),[200,409]);assert.equal((await publicState(h)).musicBroadcast.revision,2);assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,2);
});

await scope('role loss during atomic mutation cannot change broadcast state',async h=>{
  const a=await owner(h),other=await h.session('新しい管理者');
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO music_broadcast_requests')))return;h.beforeBatch=null;run(h,"UPDATE settings SET value=? WHERE key='adminUserId'",other.user.id);};
  assert.equal((await put(h,a,draft(),403)).data.error.code,'OPERATIONAL_REQUIRED');assert.deepEqual((await publicState(h)).musicBroadcast,INITIAL);assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,0);
});

await scope('account ban and ban-lift epoch changes also block in-flight mutations',async h=>{
  const a=await owner(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO music_broadcast_requests')))return;h.beforeBatch=null;run(h,'INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)',a.user.id,a.user.id,h.now);};
  assert.equal((await put(h,a,draft(),403)).data.error.code,'ACCOUNT_BANNED');assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,0);
  run(h,'UPDATE player_bans SET active=0,revision=2');
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO music_broadcast_requests')))return;h.beforeBatch=null;run(h,'UPDATE player_bans SET revision=3');};
  assert.equal((await put(h,a,draft(),409)).data.error.code,'ACCOUNT_ACCESS_CHANGED');assert.deepEqual((await publicState(h)).musicBroadcast,INITIAL);
});

await scope('transaction failure rolls back receipt and state, then permits safe retry',async h=>{
  const a=await owner(h),request=draft();
  h.sql.exec("CREATE TRIGGER test_music_abort BEFORE UPDATE ON music_broadcast_state BEGIN SELECT RAISE(ABORT,'fixture transaction failure'); END");
  await put(h,a,request,500);assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,0);assert.deepEqual((await publicState(h)).musicBroadcast,INITIAL);
  h.sql.exec('DROP TRIGGER test_music_abort');const retry=(await put(h,a,request)).data;assert.equal(retry.idempotent,false);assert.equal(retry.musicBroadcast.revision,1);
});

await scope('in-flight stale expected revision is rejected at the commit boundary',async h=>{
  const a=await owner(h);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO music_broadcast_requests')))return;h.beforeBatch=null;run(h,"UPDATE music_broadcast_state SET mode='continuous',revision=1,updated_at=? WHERE id=1",h.now);};
  assert.equal((await put(h,a,draft(),409)).data.error.code,'MUSIC_REVISION_CONFLICT');assert.equal(one(h,'SELECT COUNT(*) n FROM music_broadcast_requests').n,0);
  const current=(await read(h,a)).musicBroadcast;assert.equal(current.enabled,false);assert.equal(current.mode,'continuous');assert.equal(current.revision,1);
});

await scope('no-op default requests remain OFF and throttling does not invalidate receipts',async h=>{
  const a=await owner(h),request=draft({enabled:false}),first=(await put(h,a,request)).data;
  assert.equal(first.changed,false);assert.deepEqual(first.musicBroadcast,INITIAL);
  run(h,'UPDATE rate_limits SET count=60 WHERE scope=?','admin-music:'+a.user.id);
  await put(h,a,draft(),429);assert.equal((await put(h,a,request)).data.idempotent,true);
});

// Apply the additive migration to a non-empty previous schema and compare every
// existing row rather than trusting a new empty fixture to prove preservation.
{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
  const apply=entry=>{for(const q of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))db.exec(q);};
  for(const entry of journal.entries.filter(e=>e.idx<42))apply(entry);
  db.prepare("INSERT INTO users(id,token_hash,name,name_key,clan,created_at,last_seen) VALUES('migration-user','fixture-token-hash','既存領主','既存領主','織田家',1,2)").run();
  db.prepare("INSERT INTO settings(key,value,updated_at) VALUES('announcement','既存のお知らせ',3)").run();
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const snapshot=()=>tables.map(({name})=>({name,rows:db.prepare('SELECT * FROM "'+name+'"').all()}));
  const before=snapshot();apply(journal.entries.find(e=>e.idx===42));assert.deepEqual(snapshot(),before);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(db.prepare('SELECT enabled FROM music_broadcast_state').get().enabled,0);db.close();passed++;console.log('PASS additive 0042 migration preserves every existing table row');
}
assert.equal(externalRequests,0);
console.log(`Admin music tests passed (${passed} scenarios, ${calls} local API calls, no external requests).`);
}finally{globalThis.fetch=originalFetch;}
