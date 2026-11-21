import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';

const database=new DatabaseSync(':memory:');database.exec('PRAGMA foreign_keys=ON');
for(const entry of JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries)for(const sql of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(sql);
const db={beforeBatch:null,prepare(sql){return this.statement(sql,[]);},statement(sql,params){return{sql,params,bind(...args){return db.statement(sql,args);},async first(){return database.prepare(sql).all(...params)[0]||null;},async all(){return{success:true,results:database.prepare(sql).all(...params)};},async run(){const r=database.prepare(sql).run(...params);return{success:true,results:[],meta:{changes:Number(r.changes)}};}};},async batch(statements){if(this.beforeBatch){const hook=this.beforeBatch;this.beforeBatch=null;hook();}database.exec('BEGIN IMMEDIATE');try{const result=statements.map(s=>({success:true,results:database.prepare(s.sql).all(...s.params)}));database.exec('COMMIT');return result;}catch(e){database.exec('ROLLBACK');throw e;}}};
const env={DB:db,SENGOKU_ADMIN_KEY:'local-only-'+crypto.randomUUID()},WINDOW=24*60*60*1000;
let now=1795219200000,calls=0;const originalNow=Date.now;Date.now=()=>now;
async function api(route,{token,body,expected=200}={}){const headers={Origin:'https://www.kasai-solutions-inc.com','CF-Connecting-IP':'192.0.2.10'};if(token)headers.Authorization='Bearer '+token;if(body)headers['Content-Type']='application/json';const res=await worker.fetch(new Request('https://local.invalid/api/v1'+route,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined}),env,{});const data=await res.json();calls++;assert.equal(res.status,expected,JSON.stringify({route,status:res.status,error:data.error}));assert.equal(res.headers.get('cache-control'),'no-store');return data;}
const session=name=>api('/session',{body:{name,clan:'織田家'}});
const encode=values=>Buffer.from(JSON.stringify(values)).toString('base64url');
try{
 const admin=await session('接続一覧の運営'),staff=await session('接続一覧スタッフ'),ordinary=await session('接続一覧一般');
 await api('/admin/claim',{token:admin.token,body:{key:env.SENGOKU_ADMIN_KEY}});
 await api('/admin/staff',{token:admin.token,body:{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}});
 assert.equal((await api('/staff/recent-logins',{expected:401})).error.code,'AUTH_REQUIRED');
 assert.equal((await api('/staff/recent-logins',{token:ordinary.token,expected:403})).error.code,'STAFF_REQUIRED');
 const seed=(id,lastSeen)=>database.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,id,id,'徳川家','not-a-real-token-'+id,now-WINDOW*2,lastSeen);
 for(let i=0;i<60;i++)seed('u_recent_'+String(i).padStart(3,'0'),now-1000-i*1000);
 seed('u_tie_a',now-1500);seed('u_tie_b',now-1500);seed('u_boundary',now-WINDOW);seed('u_older',now-WINDOW-1);seed('u_future',now+1);
 database.prepare('INSERT INTO user_sessions(token_hash,user_id,device_name,created_at,last_seen) VALUES(?,?,?,?,?)').run('test-session-one','u_recent_000','private device name one',now,now);
 database.prepare('INSERT INTO user_sessions(token_hash,user_id,device_name,created_at,last_seen) VALUES(?,?,?,?,?)').run('test-session-two','u_recent_000','private device name two',now,now);
 for(const device of ['private-device-a','private-device-b'])database.prepare('INSERT INTO player_presence(user_id,device_id,device_name,online,last_seen) VALUES(?,?,?,?,?)').run('u_recent_000',device,'private presence name',1,now);
 const first=await api('/staff/recent-logins',{token:admin.token});assert.equal(first.players.length,50);assert.equal(first.total,66);assert(first.nextCursor);assert.equal(first.serverNow,new Date(now).toISOString());assert.equal(first.windowStart,new Date(now-WINDOW).toISOString());assert.equal(first.players.filter(p=>p.id==='u_recent_000').length,1);assert(first.players.find(p=>p.id==='u_recent_000').online);
 const second=await api('/staff/recent-logins?limit=50&cursor='+first.nextCursor,{token:staff.token});assert.equal(second.players.length,16);assert.equal(second.total,66);assert.equal(second.nextCursor,null);
 const all=[...first.players,...second.players];assert.equal(new Set(all.map(p=>p.id)).size,66);assert(all.some(p=>p.id==='u_boundary'));assert(!all.some(p=>p.id==='u_older'||p.id==='u_future'));
 for(let i=1;i<all.length;i++){const a=all[i-1],b=all[i],t=Date.parse(a.lastSeen)-Date.parse(b.lastSeen);assert(t>0||t===0&&a.id<b.id,'Newest-first ordering uses a stable ascending ID tie break');}
 assert(all.findIndex(p=>p.id==='u_tie_a')<all.findIndex(p=>p.id==='u_tie_b'));
 const allowed=new Set(['id','name','clan','isAdmin','isStaff','guildId','guildName','guildRole','online','lastSeen','avatarVersion']);for(const p of all){assert(Object.keys(p).every(key=>allowed.has(key)));assert(Number.isFinite(Date.parse(p.lastSeen)));}
 const serialized=JSON.stringify(first);for(const forbidden of ['token_hash','base64','device_name','private device','private-device','192.0.2.10',admin.token,env.SENGOKU_ADMIN_KEY])assert(!serialized.includes(forbidden));
 for(const route of ['/me','/online','/players?q=u_recent']){const result=await api(route,{token:admin.token});assert(!JSON.stringify(result).includes('lastSeen'),'Restricted timestamps stay out of generic public/user projections');}
 let cursor=null,ids=[];do{const page=await api('/staff/recent-logins?limit=7'+(cursor?'&cursor='+cursor:''),{token:staff.token});assert(page.players.length<=7);ids.push(...page.players.map(p=>p.id));cursor=page.nextCursor;}while(cursor);assert.equal(ids.length,66);assert.equal(new Set(ids).size,66);
 for(const limit of ['0','51','100','-1','1.5','NaN','','01','1e1'])await api('/staff/recent-logins?limit='+limit,{token:admin.token,expected:400});
 for(const cursorValue of ['', '%bad', 'AAAA', encode({v:1}),encode([2,now,now,'x']),encode([1,now+1,now,'x']),encode([1,now-WINDOW-1,now-WINDOW-1,'x']),encode([1,now,now+1,'x']),encode([1,now,now,'x OR 1=1']),encode([1,now,1.5,'x']),encode([1,now,now,'x'.repeat(91)])])assert.equal((await api('/staff/recent-logins?cursor='+encodeURIComponent(cursorValue),{token:admin.token,expected:400})).error.code,'INVALID_CURSOR');
 // Cursor-supplied positions cannot extend the current rolling time window.
 const anchored=await api('/staff/recent-logins?limit=1',{token:admin.token});const initialNow=now;now+=120000;seed('u_new_after_anchor',now);
 const later=await api('/staff/recent-logins?cursor='+anchored.nextCursor,{token:admin.token});assert.equal(later.serverNow,new Date(now).toISOString());assert.equal(later.windowStart,new Date(now-WINDOW).toISOString());assert(later.players.every(p=>Date.parse(p.lastSeen)>=now-WINDOW&&Date.parse(p.lastSeen)<=initialNow));assert(!later.players.some(p=>p.id==='u_boundary'||p.id==='u_new_after_anchor'));
 // The latest authenticated use is throttled to one update per 60 seconds.
 const seen=Number(database.prepare('SELECT last_seen FROM users WHERE id=?').get(admin.user.id).last_seen);now+=30000;await api('/staff/recent-logins',{token:admin.token});assert.equal(Number(database.prepare('SELECT last_seen FROM users WHERE id=?').get(admin.user.id).last_seen),seen);now+=30001;await api('/staff/recent-logins',{token:admin.token});assert.equal(Number(database.prepare('SELECT last_seen FROM users WHERE id=?').get(admin.user.id).last_seen),now);
 // Fresh SQL guards reject revocation after authenticate but before the read.
 db.beforeBatch=()=>database.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id);
 const revoked=await api('/staff/recent-logins',{token:staff.token,expected:403});assert.equal(revoked.error.code,'STAFF_REQUIRED');assert.equal(revoked.players,undefined);await api('/staff/recent-logins',{token:staff.token,expected:403});
 db.beforeBatch=()=>database.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(ordinary.user.id);
 assert.equal((await api('/staff/recent-logins',{token:admin.token,expected:403})).error.code,'STAFF_REQUIRED');
 console.log(JSON.stringify({ok:true,calls,checks:['server-owned admin/staff roles and in-query revocation','rolling inclusive 24h boundary and future exclusion','one entry per user across sessions/presence','newest-first stable keyset pagination, 50 maximum','bounded opaque cursor and invalid input rejection','current time caps forged/stale cursor windows','safe projection without public lastSeen leakage','authenticated last_seen 60-second precision'],productionRequests:0},null,2));
}finally{Date.now=originalNow;database.close();}
