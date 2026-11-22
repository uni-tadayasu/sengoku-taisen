import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {prepareProtection,protectionStatus,protectionBattleStatements,enrollProtection} from './protection.js';

const h=harness();let passed=0;
const scope=async(name,work)=>{await work();passed++;console.log('PASS '+name);};
const post=(token,body,expected=200)=>({method:'POST',token,body,expected});
async function seed(p){
 p.device='device_'+p.user.id;const lease=(await h.api('/sync/lease',post(p.token,{deviceId:p.device,deviceName:'test'}))).data;
 const clock=(await h.api('/world-clock')).data.clock,save=h.fresh();save.state.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};save.state.turn=Math.floor(clock.elapsedMs/60000);save.state.realtime.elapsed=clock.elapsedMs%60000/1000;
 save.state.resources={gold:10000,rice:10000,wood:10000,stone:10000};save.state.troops=10000;
 return (await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.device,revision:lease.revision,save}})).data;
}
const user=p=>({...h.sql.prepare('SELECT * FROM users WHERE id=?').get(p.user.id),guild_id:null});
const fail=(status,code,message)=>{throw Object.assign(Error(message),{status,code});};
try{
 const a=(await h.api('/session',post(null,{name:'初心者A',clan:'織田家',newcomerProtection:true}))).data;
 const d=(await h.api('/session',post(null,{name:'初心者D',clan:'織田家',newcomerProtection:true}))).data;
 await seed(a);await seed(d);
 await scope('24-hour newcomer protection is persistent and an attack cannot spend through it',async()=>{
  const s=(await h.api('/protection',{token:a.token})).data;assert.equal(s.beginnerActive,true);assert.equal(s.beginnerUntil,h.now+86400000);
  const before=h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(a.user.id);
  const r=await h.api('/field/attack',post(a.token,{targetPlayerId:d.user.id,requestId:crypto.randomUUID(),deviceId:a.device,expectedRevision:before.revision,troops:1000,tactic:'balanced'},409));
  assert.equal(r.data.error.code,'BEGINNER_CONFIRM_REQUIRED');assert.equal(h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(a.user.id).save_json,before.save_json);
 });
 await scope('explicit exit is irreversible and replay cannot restore newcomer protection',async()=>{
  await h.api('/protection/end',post(a.token,{},400));await h.api('/protection/end',post(a.token,{confirm:true}));
  await h.api('/protection/end',post(a.token,{confirm:true}));await enrollProtection(h.db,user(a),h.now);
  assert.equal((await protectionStatus(h.db,a.user.id,h.now)).beginnerActive,false);
  const row=h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(a.user.id);
  const r=await h.api('/field/attack',post(a.token,{targetPlayerId:d.user.id,requestId:crypto.randomUUID(),deviceId:a.device,expectedRevision:row.revision,troops:1000,tactic:'balanced'},409));assert.equal(r.data.error.code,'TARGET_REALTIME_PROTECTED');
  const field=(await h.api('/field?limit=100',{token:a.token})).data;assert.equal(field.targets.find(t=>t.playerId===d.user.id).attackable,false);
 });
 await scope('a protection enrollment racing a commit invalidates the original guard',async()=>{
  const plain=await h.session('旧版領主');const raw=user(plain),prepared=await prepareProtection(h.db,user(a),raw,h.now,{fail});
  const check=()=>h.sql.prepare('SELECT ('+prepared.guard.sql+') AS permitted').get(...prepared.guard.args).permitted;
  assert.equal(check(),1);await enrollProtection(h.db,raw,h.now);assert.equal(check(),0);
 });
 await scope('field and covert attacks both count toward real-time reconstruction protection',async()=>{
  await h.api('/protection/end',post(d.token,{confirm:true}));
  for(let i=0;i<2;i++)h.sql.prepare('INSERT INTO covert_battles(id,attacker_id,defender_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?)').run('cb_fixture_'+i,a.user.id,d.user.id,i*60000,JSON.stringify({castleId:'kiyosu'}),h.now-1000*(i+1));
  const p=await prepareProtection(h.db,user(a),user(d),h.now,{fail});assert.equal(p.shieldUntil,h.now+7200000);
  await h.db.batch(protectionBattleStatements(h.db,d.user.id,h.now,p.shieldUntil,'1=1',[]));assert.equal((await protectionStatus(h.db,d.user.id,h.now)).recoveryActive,true);
  await assert.rejects(prepareProtection(h.db,user(a),user(d),h.now,{fail}),e=>e.code==='TARGET_REALTIME_PROTECTED');
  h.now+=7200001;assert.equal((await protectionStatus(h.db,d.user.id,h.now)).recoveryActive,false);
 });
 await scope('individual resources and magatama normalize legacy saves to one hundred million',async()=>{
  const p=await h.session('上限確認');await seed(p);const row=h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id),save=JSON.parse(row.save_json);
  save.state.resources={gold:999999999,rice:100000001,wood:100000000,stone:99999999};save.state.magatama=999999999;
  const written=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.device,revision:row.revision,save}})).data;
  assert.deepEqual(written.save.state.resources,{gold:100000000,rice:100000000,wood:100000000,stone:99999999});assert.equal(written.save.state.magatama,100000000);
 });
 console.log(JSON.stringify({passed,calls:h.calls}));
}finally{h.close();}
