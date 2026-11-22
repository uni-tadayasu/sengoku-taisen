import assert from 'node:assert/strict';
import {harness,settleFieldMarch} from './test-support.mjs';

const checks=[];let calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=(h,p)=>JSON.parse(row(h,p).save_json);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const inbox=async(h,p)=>(await h.api('/mail',{token:p.token})).data.mail;
const unread=async(h,p)=>(await h.api('/me',{token:p.token})).data.unreadMail;
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function fixture(h,name,{admin=false,home='kiyosu',holdings=[]}={}){
  const p=await h.session(name);p.deviceId='device-'+p.user.id;if(admin)await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));
  const leased=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,value=h.fresh(),s=value.state;
  s.castles[s.home].owner='在地衆';s.home=home;s.castles[home]={owner:s.clan,level:20,wall:6,troops:2000};
  s.resources={gold:50000,rice:50000,wood:50000,stone:50000};s.troops=20000;s.buildings.keep=20;s.buildings.gold_mine=3;s.governors={gold_mine:s.officers[3]};
  for(const id of holdings)s.castles[id]={owner:s.clan,level:24,wall:8,troops:2500};
  s.worldClock={id:leased.clock.id,elapsedMs:leased.clock.elapsedMs};s.turn=Math.floor(leased.clock.elapsedMs/60000);s.realtime.elapsed=leased.clock.elapsedMs%60000/1000;
  await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:0,save:value}});return p;
}
const request=(h,a,d,castleId='kiyosu',extra={})=>({targetPlayerId:d.user.id,targetCastleId:castleId,requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:row(h,a).revision,troops:3000,tactic:'balanced',...extra});
const marches=async(h,actor)=>(await h.api('/marches?deviceId='+actor.deviceId,{token:actor.token})).data;
async function complete(h,actor,body){
  const departure=await attack(h,actor,body);
  assert.equal(count(h,'mail_campaigns'),0,'Departures do not notify recipients before combat');
  return {battle:await settleFieldMarch(h,actor,departure)};
}
const attack=async(h,a,body,expected=200)=>(await h.api('/field/attack',post(a,body,expected))).data;
async function outcome(won,run){const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(won?0:0xffffffff):original.call(crypto,array);};try{return await run();}finally{crypto.getRandomValues=original;}}
function barrier(h){let arrived=0,release;const wait=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;if(++arrived===2){h.beforeBatch=null;release();}await wait;};return()=>arrived;}
function assertNotice(mail,battle,side){assert.equal(mail.source,'system');assert.deepEqual(mail.event,{kind:'field-battle',battleId:battle.id,side});assert.equal(mail.gift,null);assert.equal(mail.claimed,false);assert.equal(mail.read,false);assert.equal(mail.createdAt,battle.createdAt);assert(mail.title.length<=60);assert(mail.body.length<=2000);assert(mail.body.includes(battle.castleName));assert(mail.body.includes(side==='attacker'?battle.defenderName:battle.attackerName));}

for(const mode of ['raid','capture','reward'])for(const won of [true,false])await scope(mode+' '+(won?'victory':'defeat')+' delivers both perspectives without claimable gifts',async h=>{
  const defender=await fixture(h,'通知の守備',{admin:mode==='reward',holdings:mode==='capture'?['nijo']:[]}),actor=await fixture(h,'通知の攻撃',{home:'inuyama'}),castle=mode==='reward'?'edo':mode==='capture'?'nijo':'kiyosu',prior=row(h,defender);
  const result=await outcome(won,()=>complete(h,actor,request(h,actor,defender,castle))),a=await inbox(h,actor),d=await inbox(h,defender);
  assert.equal(result.battle.battleMode,mode);assert.equal(a.length,1);assert.equal(d.length,1);assert.equal(count(h,'mail_campaigns'),2);assertNotice(a[0],result.battle,'attacker');assertNotice(d[0],result.battle,'defender');
  assert(a[0].title.includes(won?'勝利':'敗北'));assert(d[0].title.includes(won?'敗北':'勝利'));assert(d[0].body.includes('攻撃されました'));assert(a[0].body.includes('消費した兵糧'));assert(d[0].body.includes('資源の損失'));
  if(mode==='capture'&&won){assert(a[0].body.includes('所領に加え'));assert(d[0].body.includes('領有を失いました'));assert(d[0].body.includes('本拠は清洲城のまま'));assert(!d[0].body.includes('本拠の移転：'));}
  if(mode==='reward'){assert.deepEqual(row(h,defender),prior);assert(a[0].body.includes('勝利報酬：'));assert(d[0].body.includes('この戦闘による資源・兵・施設・軍団・奉行の損失はありません'));if(won)assert(a[0].body.includes('金銭500・兵糧500・木材500・石材500'));}
  const before=row(h,actor);assert.equal((await h.api('/mail/claim',post(actor,{mailId:a[0].id,requestId:crypto.randomUUID()},400))).data.error.code,'NO_GIFT');assert.deepEqual(row(h,actor),before,'reading notification grants no repeated battle reward');assert.equal(count(h,'mail_receipts'),0);
});

await scope('home loss mail records old and new castles and the preserved development',async h=>{
  const actor=await fixture(h,'移転通知の攻撃'),defender=await fixture(h,'移転通知の守備',{home:'osaka'}),before=saved(h,defender);
  const result=await outcome(true,()=>complete(h,actor,request(h,actor,defender,'osaka'))),mail=(await inbox(h,defender))[0],after=saved(h,defender);
  assert.equal(mail.title,'【敗北・本拠移転】大坂城');assert(mail.body.includes('本拠の移転：大坂城 → 清洲城。'));assert(mail.body.includes('施設・軍団・奉行・所持武将・研究'));assert(mail.body.includes('戦闘後に残った資源と兵'));assert(mail.body.includes('施設の普請も継続'));assert(mail.body.includes('城郭はLv.20'));assert(mail.body.includes('次の周回も新しい本拠'));assert.equal(result.battle.capture.defenderHomeCastleId,'kiyosu');
  for(const key of ['army','governors','buildings','officers','tech'])assert.deepEqual(after.state[key],before.state[key]);assert.equal(after.state.home,'kiyosu');assert.equal(row(h,defender).cycle_home,'kiyosu');
  const attackerMail=(await inbox(h,actor))[0];assert(attackerMail.body.includes('あなたの本拠は清洲城のまま'));assert(attackerMail.body.includes('大坂城から清洲城へ移りました'));
});

await scope('offline defender receives unread mail later with recipient-only access',async h=>{
  const actor=await fixture(h,'不在通知の攻撃',{home:'inuyama'}),defender=await fixture(h,'不在通知の守備'),other=await fixture(h,'通知の第三者',{home:'okazaki'});
  h.sql.prepare('UPDATE player_saves SET writer_device_id=NULL,writer_device_name=NULL,lease_expires_at=0 WHERE user_id=?').run(defender.user.id);
  const result=await outcome(true,()=>complete(h,actor,request(h,actor,defender))),defenderRow=row(h,defender);h.now+=31000;
  assert.equal(await unread(h,defender),1);assert.equal(await unread(h,actor),1);assert.equal(await unread(h,other),0);
  const mail=(await inbox(h,defender))[0];assertNotice(mail,result.battle,'defender');assert.equal(await unread(h,defender),1,'listing does not consume unread state');assert.deepEqual(row(h,defender),defenderRow,'mail checks do not change the offline save or writer lease');assert.deepEqual(await inbox(h,other),[]);
  await h.api('/mail/read',post(other,{mailId:mail.id},404));await h.api('/mail/claim',post(other,{mailId:mail.id,requestId:'private-mail'},404));
  await h.api('/mail/read',post(defender,{mailId:mail.id}));assert.equal(await unread(h,defender),0);assert.equal(await unread(h,actor),1);assert.equal((await inbox(h,defender))[0].read,true);
  await h.api('/mail/read',post(defender,{mailId:mail.id}));assert.equal(count(h,'mail_reads'),1);
});

await scope('sequential and simultaneous retries preserve the same two unread notices',async h=>{
  const actor=await fixture(h,'再送通知の攻撃',{home:'inuyama'}),defender=await fixture(h,'再送通知の守備'),body=request(h,actor,defender);
  const results=await outcome(true,()=>Promise.all([attack(h,actor,body),attack(h,actor,body)]));
  assert.equal(results[0].march.id,results[1].march.id);assert.deepEqual(results.map(r=>r.idempotent).sort(),[false,true]);assert.equal(count(h,'mail_campaigns'),0);
  h.now+=results[0].march.remainingMs;const arrived=barrier(h);
  await Promise.all([marches(h,actor),marches(h,actor)]);assert.equal(arrived(),2);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'mail_campaigns'),2);
  const original=h.sql.prepare('SELECT * FROM mail_campaigns ORDER BY id').all(),defenderMail=(await inbox(h,defender))[0];await h.api('/mail/read',post(defender,{mailId:defenderMail.id}));
  const replay=await attack(h,actor,body);assert.equal(replay.idempotent,true);assert.deepEqual(h.sql.prepare('SELECT * FROM mail_campaigns ORDER BY id').all(),original);assert.equal(await unread(h,defender),0,'retry does not reopen a previously read message');assert.equal(await unread(h,actor),1);
  assert.equal((await attack(h,actor,{...body,troops:3001},409)).error.code,'REQUEST_ID_REUSED');assert.equal(count(h,'mail_campaigns'),2);
});

await scope('a second notification write failure rolls back battle, saves, receipt and first mail',async h=>{
  const actor=await fixture(h,'原子通知の攻撃'),defender=await fixture(h,'原子通知の守備',{home:'nijo'}),body=request(h,actor,defender,'nijo');
  const departure=await outcome(true,()=>attack(h,actor,body)),beforeA=row(h,actor),beforeD=row(h,defender);
  h.now+=departure.march.remainingMs;
  h.sql.exec("CREATE TRIGGER reject_second_notice BEFORE INSERT ON mail_campaigns WHEN NEW.request_id LIKE 'system:field:%:defender' BEGIN SELECT RAISE(ABORT,'test notification failure'); END");
  const pending=await marches(h,actor);assert.equal(pending.active[0].id,departure.march.id);assert.deepEqual(row(h,actor),beforeA);assert.deepEqual(row(h,defender),beforeD);
  for(const table of ['field_battles','field_requests','mail_campaigns','mail_reads'])assert.equal(count(h,table),0,table+' rolls back');
  h.sql.exec('DROP TRIGGER reject_second_notice');const done=await marches(h,actor);assert.equal(done.history[0].status,'resolved');
  assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'mail_campaigns'),2);assert.equal(saved(h,defender).state.home,'kiyosu');
});

await scope('lost battle response and later retry do not duplicate mail or winnings',async h=>{
  const actor=await fixture(h,'応答喪失の攻撃',{home:'inuyama'}),defender=await fixture(h,'応答喪失の守備'),body=request(h,actor,defender);let invoked=false;
  h.afterBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;h.afterBatch=null;invoked=true;throw new Error('test response lost after committed transaction');};
  const departure=await outcome(true,()=>attack(h,actor,body));h.now+=departure.march.remainingMs;await marches(h,actor);assert(invoked);assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'mail_campaigns'),2);const afterA=row(h,actor),afterD=row(h,defender),mail=h.sql.prepare('SELECT * FROM mail_campaigns ORDER BY id').all();
  const retry=await attack(h,actor,body);assert.equal(retry.idempotent,true);assert.deepEqual(row(h,actor),afterA);assert.deepEqual(row(h,defender),afterD);assert.deepEqual(h.sql.prepare('SELECT * FROM mail_campaigns ORDER BY id').all(),mail);
});

await scope('competing attacks notify only the committed battle and its two participants',async h=>{
  const a=await fixture(h,'競合通知甲',{home:'inuyama'}),b=await fixture(h,'競合通知乙',{home:'okazaki'}),d=await fixture(h,'競合通知守備');
  const departures=await outcome(true,()=>Promise.all([a,b].map(actor=>attack(h,actor,request(h,actor,d)))));
  assert(departures.every(r=>r.marching));assert.equal(count(h,'mail_campaigns'),0);
  h.now+=Math.max(...departures.map(r=>r.march.remainingMs));const arrived=barrier(h);
  await Promise.all([marches(h,a),marches(h,b)]);assert.equal(arrived(),2);
  const records=await Promise.all([a,b].map(actor=>marches(h,actor)));assert.deepEqual(records.map(r=>r.history[0].status).sort(),['cancelled','resolved']);
  const winner=records.findIndex(r=>r.history[0].status==='resolved'),winning=[a,b][winner],losing=[a,b][1-winner];
  assert.equal(count(h,'mail_campaigns'),2);assert.equal((await inbox(h,winning)).length,1);assert.equal((await inbox(h,losing)).length,0);assert.equal((await inbox(h,d)).length,1);const mail=(await inbox(h,d))[0];assert.equal(mail.event.battleId,records[winner].history[0].battle.id);
});

await scope('role-conflicted and invalid attempts never create a battle notification',async h=>{
  const actor=await fixture(h,'拒否通知の攻撃',{home:'inuyama'}),defender=await fixture(h,'拒否通知の守備'),body=request(h,actor,defender);await attack(h,actor,{...body,expectedRevision:0},409);await attack(h,actor,{...body,targetCastleId:'edo'},409);assert.equal(count(h,'mail_campaigns'),0);
  let invoked=false;h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;h.beforeBatch=null;invoked=true;h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)").run(defender.user.id,h.now);};
  const departure=await outcome(true,()=>attack(h,actor,body)),escrow=row(h,actor);h.now+=departure.march.remainingMs;
  const pending=await marches(h,actor);assert(invoked);assert.equal(pending.active[0].id,departure.march.id);assert.deepEqual(row(h,actor),escrow);
  const final=await marches(h,actor);assert.equal(final.history[0].status,'cancelled');assert.equal(count(h,'mail_campaigns'),0);assert.equal(count(h,'field_battles'),0);
});

await scope('operator mail cannot impersonate the reserved system source and retains its gift flow',async h=>{
  const operator=await fixture(h,'送信元の運営',{admin:true}),recipient=await fixture(h,'送信元の受取'),body={target:recipient.user.id,title:'【戦闘勝利】江戸城',body:'自動通知に似た件名でも運営のお知らせです。',gift:{gold:3},requestId:'manual-mail',source:'system',event:{kind:'field-battle',battleId:'fb_fake',side:'defender'}};
  const sent=(await h.api('/admin/mail',post(operator,body))).data,mail=(await inbox(h,recipient))[0];assert.equal(mail.id,sent.mailId);assert.equal(mail.source,'site');assert.equal(mail.event,null);assert.equal(mail.gift.gold,3);
  const claim=(await h.api('/mail/claim',post(recipient,{mailId:mail.id,requestId:'manual-gift-claim'}))).data;assert.equal(claim.gift.gold,3);assert.equal(claim.alreadyClaimed,false);
  await h.api('/admin/mail',post(operator,{...body,requestId:'system:field:fb_'+ 'a'.repeat(32)+':attacker'},400));assert.equal(count(h,'mail_campaigns'),1);
  await h.api('/admin/mail',post(recipient,{...body,requestId:'user-cannot-send'},403));assert.equal(count(h,'mail_campaigns'),1);
});

await scope('Kyoto palace notice is private to the attacked staff member and does not modify protected progress',async h=>{
  const operator=await fixture(h,'京都御所通知の運営',{admin:true}),staff=await fixture(h,'京都御所通知のスタッフ'),otherStaff=await fixture(h,'別の京都御所スタッフ'),actor=await fixture(h,'京都御所通知の攻撃');
  for(const p of [staff,otherStaff]){await h.api('/admin/staff',post(operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));await h.api('/sync?deviceId='+p.deviceId,{token:p.token});}
  const before=row(h,staff),other=row(h,otherStaff),shared=h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get();
  const result=await outcome(true,()=>complete(h,actor,request(h,actor,staff,'kyoto_gosho')));assert.equal(result.battle.battleMode,'reward');assert.deepEqual(row(h,staff),before);assert.deepEqual(row(h,otherStaff),other);assert.deepEqual(h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),shared);
  assert.equal((await inbox(h,staff)).length,1);assert.equal((await inbox(h,otherStaff)).length,0);assert.equal((await inbox(h,operator)).length,0);assert((await inbox(h,staff))[0].body.includes('通常の時刻進行・共同普請は継続'));
});

console.log(JSON.stringify({ok:true,calls,checks:checks.length},null,2));
