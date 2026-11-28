import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {fixture,post,appoint,nominateSuccessor,certifySuccessor} from './test-court-support.mjs';
import {messageRegister} from './message-addressing.js';

// Node's SQLite permits 500 compound SELECT terms by default; production D1
// permits five. Prepare the actual read AND guarded write SQL with that limit
// in SQLite itself, including nested queries and expanded schema views.
const statements=new Map(),snapshotMarker='json_group_array(json_array(id,saveRevision';
function capture(sql,params){if(sql.includes(snapshotMarker))statements.set(sql,{sql,params});}
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
const prepare=(h,sender,audience)=>messageRegister(h.db,sender.user,audience,h.now,async ids=>new Map(ids.map(id=>[id,0])),fail);
const audienceIds=register=>JSON.parse(register.guard.args.at(-1))[3].map(row=>row[0]);
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Message regression tests must not contact production');};
let checks=0,calls=0;
const h=harness();
h.beforeStatement=capture;
h.beforeBatch=queries=>{for(const query of queries)capture(query.sql,query.params);};
try{
 const admin=await fixture(h,'通信検証の太政大臣',{admin:true});
 const retired=await fixture(h,'通信検証の前天皇',{staff:true}),emperor=await fixture(h,'通信検証の天皇',{staff:true});
 await appoint(h,retired);
 const succession=await nominateSuccessor(h,retired,emperor);await certifySuccessor(h,admin,succession.nomination);
 const regent=await fixture(h,'通信検証の摂政',{startCastle:'inuyama'}),external=await fixture(h,'通信検証の中納言',{startCastle:'himeji'}),deputy=await fixture(h,'通信検証の副官',{startCastle:'sunpu'}),ordinary=await fixture(h,'通信検証の一般領主',{startCastle:'kiyosu'});
 const regency=(await h.api('/admin/court/regent',{token:admin.token})).data;
 await h.api('/admin/court/regent',post(admin,{action:'appoint',targetPlayerId:regent.user.id,expectedRevision:regency.revision,requestId:crypto.randomUUID()}));
 h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run('chunagon',external.user.id,crypto.randomUUID(),admin.user.id,h.now);
 const delegation=(await h.api('/admin/deputy',{token:admin.token})).data;
 await h.api('/admin/deputy',post(admin,{action:'appoint',targetPlayerId:deputy.user.id,expectedRevision:delegation.revision,requestId:crypto.randomUUID()}));

 // Offline readers remain in the bounded public audience. Court titles must
 // still be included when they sort beyond that sample, without duplicates.
 const save=JSON.stringify(h.fresh());
 for(let i=0;i<50;i++){
  const id='u_aaa_message_'+String(i).padStart(2,'0');
  h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,id,id,'織田家',id,h.now,h.now-3600000);
  h.sql.prepare('INSERT INTO player_saves(user_id,save_json,revision,updated_at) VALUES(?,?,1,?)').run(id,save,h.now);
 }
 const prepared=await prepare(h,admin,{kind:'public'}),publicIds=audienceIds(prepared);
 assert.equal(publicIds.length,new Set(publicIds).size,'The sender already holding an office appears only once');
 const holders=[admin,emperor,regent,external,retired],holderIds=new Set(holders.map(holder=>holder.user.id));
 for(const holder of holders)assert(publicIds.includes(holder.user.id),'Every current public office remains in the audience');
 assert.equal(publicIds.filter(id=>!holderIds.has(id)).length,33,'Ordinary readers retain the bounded sample');
 assert(publicIds.filter(id=>id.startsWith('u_aaa_message_')).length>=31,'Offline readers fill the sample alongside at most two other ordinary players');
 assert.equal(await prepared.write('ここで待って'),'ここで待っていただけますか','Imperial audience still determines courtesy');
 for(const [kind,included,excluded]of [
  ['officials',[admin,emperor,regent],[external,retired,deputy]],
  ['operations',[admin,emperor,deputy],[external,retired,regent]]
 ]){
  const current=await prepare(h,admin,{kind}),ids=audienceIds(current);
  assert.deepEqual(new Set(ids),new Set(included.map(person=>person.user.id)));
  for(const person of excluded)assert(!ids.includes(person.user.id),'A public title does not grant private room membership');
  const query='SELECT 1 AS matched WHERE '+current.guard.sql;capture(query,current.guard.args);assert(h.sql.prepare(query).get(...current.guard.args));
 }
 checks++;console.log('PASS all public office sources, offline sample, deduplication and private audiences');

 const text='戦国VSへようこそ。城を育て、仲間と語らい、天下統一を目指しましょう。新商品が続々と増えています。ご注目ください。';
 for(const actor of [admin,deputy]){
  for(const announcement of [text,'']){
   const result=(await h.api('/admin/announcement',post(actor,{text:announcement}))).data;
   const config=(await h.api('/config')).data;
   assert.equal(result.announcement,config.announcement);
   assert.equal(announcement==='',config.announcement==='','Clearing an announcement still works');
   assert(!JSON.stringify(config).includes(actor.user.id),'Public announcement does not expose its operator');
  }
 }
 await h.api('/admin/announcement',post(ordinary,{text:'権限のない書き換え'},403));
 const world=(await h.api('/chat',post(ordinary,{channel:'world',text:'ここで待って',requestId:crypto.randomUUID()}))).data;
 assert.equal(world.message.text,'ここで待っていただけますか');
 assert.equal(h.sql.prepare('SELECT body FROM messages WHERE id=?').get(world.message.id).body,world.message.text);
 const mail=(await h.api('/admin/mail',post(deputy,{target:'all',title:'全員へのご案内',body:'ここで待って',requestId:crypto.randomUUID()}))).data;
 assert.equal(h.sql.prepare('SELECT body FROM mail_campaigns WHERE id=?').get(mail.mailId).body,'ここで待っていただけますか');
 const delivered=(await h.api('/mail',{token:ordinary.token})).data.mail.find(item=>item.id===mail.mailId);
 assert(delivered);assert(!JSON.stringify(delivered).includes(deputy.user.id));
 checks++;console.log('PASS admin/deputy notices and clearing, world chat, global mail and readback');

 const previous=(await h.api('/admin/announcement',post(admin,{text:'保存済みの御触書です。'}))).data.announcement;
 const noticeBefore=h.sql.prepare('SELECT * FROM notification_announcements ORDER BY id').all();
 let changed=false;
 const changeAudience=(sql,params)=>{
  capture(sql,params);
  if(changed||!sql.startsWith("INSERT INTO settings(key,value,updated_at) SELECT 'announcement'"))return;
  changed=true;h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(external.user.id);
 };
 h.beforeStatement=changeAudience;
 h.beforeBatch=queries=>{for(const query of queries)changeAudience(query.sql,query.params);};
 const rejected=(await h.api('/admin/announcement',post(admin,{text:'競合した本文です。'},409))).data;
 assert(changed);assert.equal(rejected.error.code,'MESSAGE_AUDIENCE_CHANGED');
 assert.equal((await h.api('/config')).data.announcement,previous,'A stale audience cannot overwrite the previous announcement');
 assert.deepEqual(h.sql.prepare('SELECT * FROM notification_announcements ORDER BY id').all(),noticeBefore,'A rejected announcement cannot leave a notification fact');
 h.beforeStatement=capture;
 h.beforeBatch=queries=>{for(const query of queries)capture(query.sql,query.params);};
 const retried=(await h.api('/admin/announcement',post(admin,{text:'再確認した御触書です。'}))).data;
 assert.equal((await h.api('/config')).data.announcement,retried.announcement);
 checks++;console.log('PASS audience changes reject the write atomically and a fresh retry succeeds');
 calls=h.calls;
}finally{h.close();globalThis.fetch=originalFetch;}

const migrations=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8')).entries.map(entry=>readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8'));
const python=spawnSync('python3',['-c',`
import json, sqlite3, sys
payload=json.load(sys.stdin)
db=sqlite3.connect(':memory:')
for migration in payload['migrations']:
    db.executescript(migration)
db.setlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT, 5)
assert db.getlimit(sqlite3.SQLITE_LIMIT_COMPOUND_SELECT) == 5
try:
    db.execute(' UNION '.join('SELECT '+str(i) for i in range(6)))
except sqlite3.OperationalError as error:
    assert 'too many terms in compound SELECT' in str(error)
else:
    raise AssertionError('The production compound SELECT limit was not enforced')
for index, statement in enumerate(payload['statements']):
    try:
        db.execute('EXPLAIN '+statement['sql'], statement['params']).fetchall()
    except sqlite3.Error as error:
        raise AssertionError('Message statement '+str(index)+' violates the D1 limit: '+str(error)) from error
print(json.dumps({'preparedStatements':len(payload['statements']),'compoundSelectLimit':5}))
`],{input:JSON.stringify({migrations,statements:[...statements.values()]}),encoding:'utf8',maxBuffer:1024*1024});
assert.equal(python.status,0,python.error?.message||python.stderr);
assert(statements.size>=5,'Both the public snapshot and distinct guarded writes must be prepared');
console.log('PASS actual message SQL prepares within the D1 compound SELECT limit '+python.stdout.trim());
console.log(JSON.stringify({checks:checks+1,localHttpRequests:calls,preparedStatements:statements.size,productionRequests:0}));
