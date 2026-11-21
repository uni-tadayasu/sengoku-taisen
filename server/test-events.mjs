import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const DAY=86400000,checks=[];let calls=0,externalRequests=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{externalRequests++;throw Error('Timed event fixtures must stay local');};
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const get=async(h,path,p)=>(await h.api(path,{token:p?.token})).data;
const row=(h,p)=>({...h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id)});
const receipts=h=>Number(h.sql.prepare("SELECT COUNT(*) AS count FROM timed_event_requests WHERE action='battle'").get().count);
const count=(h,table)=>Number(h.sql.prepare('SELECT COUNT(*) AS count FROM '+table).get().count);
async function scope(name,fn){const h=harness();try{await fn(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function operator(h){const p=await h.session('イベント運営');await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));return p;}
async function player(h,name='イベント参加者',modify=()=>{}){
 const p=await h.session(name),deviceId='event-device-'+p.user.id,lease=(await h.api('/sync/lease',post(p,{deviceId}))).data,save=h.fresh();
 p.deviceId=deviceId;modify(save.state);
 save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId,revision:lease.revision,save}});return p;
}
async function draft(h,op,days=1,name='桶狭間の戦い',requestId=crypto.randomUUID()){return (await h.api('/admin/events/generate',post(op,{name,durationDays:days,requestId}))).data;}
async function change(h,op,event,action,requestId=crypto.randomUUID(),expected=200){return h.api('/admin/events/'+event.id+'/'+action,post(op,{requestId},expected));}
async function publish(h,op,days=1){const planned=await draft(h,op,days);return (await change(h,op,planned.event,'publish')).data.event;}
const battleBody=(event,requestId=crypto.randomUUID(),stage=2)=>({stageId:event.plan.stages[stage].id,tactic:event.plan.stages[stage].recommendedTactic,requestId});
async function battle(h,p,event,body=battleBody(event),expected=200){return h.api('/events/'+event.id+'/battle',post(p,{deviceId:p.deviceId||'unsaved-device',expectedRevision:row(h,p).revision??0,...body},expected));}
async function syncCurrent(h,p){
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 const game=GameEngine.fromSave(lease.save,GAME_OFFICERS,{isAdmin:lease.user.isAdmin,isStaff:lease.user.isStaff,staffBase:lease.staffBase});
 assert.equal(game.applyWorldClock(lease.clock).ok,true);
 return (await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:JSON.parse(game.exportSave())}})).data;
}
async function victory(fn){const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0):original.call(crypto,array);};try{return await fn();}finally{crypto.getRandomValues=original;}}
function noPrivate(value){const json=JSON.stringify(value);for(const key of ['creator_id','creatorId','isAdmin','isStaff','is_admin','is_staff','commit_token','request_hash'])assert(!json.includes('"'+key+'"'),key);}

try{
 await scope('health advertises timed events only when all four event tables are available',async h=>{
  const ready=await get(h,'/health');assert.equal(ready.status,'ready');assert.equal(ready.version,'3.19.0');assert.equal(ready.features.timedEvents,true);
  for(const table of ['timed_events','timed_event_requests','timed_event_participants','timed_event_rewards']){
   h.sql.exec('ALTER TABLE '+table+' RENAME TO fixture_hidden');
   const unavailable=(await h.api('/health',{expected:503})).data;assert.equal(unavailable.error.code,'SERVICE_UNAVAILABLE');assert.equal(unavailable.features,undefined);
   h.sql.exec('ALTER TABLE fixture_hidden RENAME TO '+table);
  }
  assert.equal((await get(h,'/health')).status,'ready');
 });
 await scope('operator-only planning, strict input, private drafts and stable request retries',async h=>{
  const op=await operator(h),p=await h.session('一般の領主');
  await h.api('/admin/events',{expected:401});
  await h.api('/admin/events/generate',post(p,{name:'試験合戦',durationDays:1,requestId:'forged',isAdmin:true},403));
  await h.api('/admin/staff',post(op,{targetPlayerId:p.user.id,action:'appoint',requestId:'staff-appoint'}));
  await h.api('/admin/events',{token:p.token,expected:403});
  for(const durationDays of [0,8,1.5,'2',null])await h.api('/admin/events/generate',post(op,{name:'試験合戦',durationDays,requestId:crypto.randomUUID()},400));
  for(const name of ['', '字'.repeat(61), '戦\u0000い', '川\nの戦い','夜\t合戦','戦\u0085い'])await h.api('/admin/events/generate',post(op,{name,durationDays:1,requestId:crypto.randomUUID()},400));
  await h.api('/admin/events/generate',post(op,{name:'試験合戦',durationDays:1,requestId:'client-plan',plan:{},seed:'forged'},400));
  const first=await draft(h,op,7,'  戦い <script>  ','same-draft'),again=await draft(h,op,7,'戦い <script>','same-draft');
  assert.equal(first.event.name,'戦い <script>');assert.equal(first.event.status,'draft');assert.equal(first.event.startsAt,null);assert.equal(first.event.endsAt,null);
  assert.equal(again.idempotent,true);assert.deepEqual(again.event,first.event);assert.equal(count(h,'timed_events'),1);
  await h.api('/admin/events/generate',post(op,{name:'別の戦い',durationDays:7,requestId:'same-draft'},409));
  assert.deepEqual((await get(h,'/events')).events,[]);await h.api('/events/'+first.event.id,{expected:404});
  assert.equal((await get(h,'/admin/events',op)).events.length,1);noPrivate(first);noPrivate(await get(h,'/admin/events',op));
 });
 await scope('publishing is atomic, a draft is immutable, and early end permits the next event',async h=>{
  const op=await operator(h),one=(await draft(h,op)).event,two=(await draft(h,op,2,'長篠の戦い')).event;
  const outcomes=await Promise.all([change(h,op,one,'publish','publish-one',null),change(h,op,two,'publish','publish-two',null)]);
  assert.deepEqual(outcomes.map(r=>r.response.status).sort(),[200,409]);
  const active=outcomes.find(r=>r.response.status===200).data.event,inactive=active.id===one.id?two:one;
  assert.equal(Date.parse(active.endsAt)-Date.parse(active.startsAt),active.durationDays*DAY);
  const replay=await change(h,op,active,'publish',active.id===one.id?'publish-one':'publish-two');assert.equal(replay.data.idempotent,true);
  await change(h,op,active,'publish','republish',409);await change(h,op,active,'discard','discard-live',409);
  const visible=await get(h,'/events');assert.equal(visible.events.length,1);noPrivate(visible);
  h.now+=1000;const ended=(await change(h,op,active,'end','end-one')).data;assert.equal(ended.event.status,'ended');assert.equal(ended.event.endedAt,new Date(h.now).toISOString());
  assert.equal((await change(h,op,active,'end','end-one')).data.idempotent,true);
  const next=(await change(h,op,inactive,'publish')).data;assert.equal(next.event.status,'active');assert.equal(count(h,'timed_event_participants'),0);
 });
 await scope('draft cap has an idempotent discard escape and discarded plans stay private',async h=>{
  const op=await operator(h),first=(await draft(h,op)).event,stored=h.sql.prepare('SELECT * FROM timed_events WHERE id=?').get(first.id);
  for(let i=1;i<30;i++)h.sql.prepare("INSERT INTO timed_events(id,creator_id,name,duration_days,status,plan_json,created_at) VALUES(?,?,?,?,'draft',?,?)").run('ev_'+crypto.randomUUID().replaceAll('-',''),op.user.id,'保管企画'+i,1,stored.plan_json,h.now);
  const blocked=await h.api('/admin/events/generate',post(op,{name:'上限の企画',durationDays:1,requestId:'cap'},409));assert.equal(blocked.data.error.code,'EVENT_DRAFT_LIMIT');
  const discarded=(await change(h,op,first,'discard','discard-one')).data;assert.equal(discarded.event.status,'discarded');assert.equal(discarded.event.startsAt,null);
  assert.equal((await change(h,op,first,'discard','discard-one')).data.idempotent,true);
  await h.api('/events/'+first.id,{expected:404});assert(!(await get(h,'/admin/events',op)).events.some(e=>e.id===first.id));
  assert.equal((await draft(h,op,1,'上限の企画','cap')).event.status,'draft');
 });
 await scope('battle spends one saved command through the writer revision and leaves army assets intact',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h),unsaved=await h.session('未開始');
  const empty=await get(h,'/events/'+event.id,p);assert.equal(empty.progress.points,0);assert.deepEqual(empty.progress.command,{available:3,max:3,cost:1});assert.equal(empty.event.plan.commandCost,1);assert(!Object.hasOwn(empty.event.plan,'dailyAttempts'));
  for(const key of ['attemptsToday','attemptsLeft','dayIndex','nextResetAt'])assert(!Object.hasOwn(empty.progress,key));
  assert.equal((await get(h,'/events/'+event.id)).progress,null);
  assert.equal((await get(h,'/events/'+event.id,unsaved)).progress.command,null);
  assert.equal((await battle(h,unsaved,event,battleBody(event),409)).data.error.code,'SAVE_REQUIRED');
  await battle(h,p,event,{...battleBody(event),points:999999},400);await battle(h,p,event,{...battleBody(event),stageId:'other'},400);await battle(h,p,event,{...battleBody(event),tactic:'other'},400);
  await h.api('/events/'+event.id+'/battle',post(p,battleBody(event),400));
  // An event now mutates the common command pool, so another writer is fenced out.
  h.sql.prepare('UPDATE player_saves SET writer_device_id=?,lease_expires_at=? WHERE user_id=?').run('another-device',h.now+999999,p.user.id);
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'LEASE_REQUIRED');assert.equal(receipts(h),0);
  h.sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run(p.deviceId,p.user.id);
  const before=structuredClone(row(h,p)),world=JSON.stringify(h.sql.prepare('SELECT * FROM world_clock').all());
  const first=(await battle(h,p,event,battleBody(event,'battle-save'))).data;assert(first.battle.won);assert.equal(first.battle.requestId,'battle-save');assert.equal(first.progress.battles,1);
  assert.equal(first.revision,before.revision+1);assert.equal(first.battle.playerRevision,first.revision);assert.equal(first.battle.commandCost,1);assert.equal(first.battle.commandBefore,3);assert.equal(first.battle.commandAfter,2);assert.equal(first.save.state.command,2);assert.equal(first.progress.command.available,2);assert.equal(first.writable,true);assert.equal(first.writerDeviceId,p.deviceId);
  const expectedState=JSON.parse(before.save_json).state;expectedState.command--;assert.deepEqual(first.save.state,expectedState);
  assert.equal(JSON.stringify(h.sql.prepare('SELECT * FROM world_clock').all()),world);assert.equal(count(h,'field_battles'),0);
  const save=JSON.parse(row(h,p).save_json);save.state.army=[];save.state.morale=0;h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(save),p.user.id);
  const second=(await battle(h,p,event)).data;assert(second.battle.playerPower<first.battle.playerPower);
  const lost=JSON.parse(row(h,p).save_json);for(const castle of Object.values(lost.state.castles))if(castle.owner===lost.state.clan)castle.owner='在地衆';lost.state.gameOver=true;
  h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(lost),p.user.id);
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'BASE_UNAVAILABLE');assert.equal(receipts(h),2);
 }));
 await scope('concurrent battles use revision CAS and each command and milestone is spent once',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h),before=structuredClone(row(h,p));
  const outcomes=await Promise.all(Array.from({length:8},(_,i)=>battle(h,p,event,battleBody(event,'concurrent-'+i),null)));
  assert.equal(outcomes.filter(r=>r.response.status===200).length,1);assert.equal(outcomes.filter(r=>r.data.error?.code==='REVISION_CONFLICT').length,7);
  assert.equal(receipts(h),1);assert.equal(row(h,p).revision,before.revision+1);assert.equal(JSON.parse(row(h,p).save_json).state.command,2);
  await battle(h,p,event);await battle(h,p,event);assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'INSUFFICIENT_COMMAND');
  assert.equal(receipts(h),3);assert.equal(count(h,'timed_event_rewards'),3);assert.equal(count(h,'mail_campaigns'),3);
  const snapshot=await get(h,'/events/'+event.id,p);assert.equal(snapshot.progress.points,360);assert.equal(snapshot.progress.wins,3);assert.equal(snapshot.progress.command.available,0);assert.equal(snapshot.leaderboard[0].name,p.user.name);assert(snapshot.leaderboard[0].evaluation);assert.equal(snapshot.leaderboard[0].avatarVersion,null);noPrivate(snapshot);
  const accepted=outcomes.find(r=>r.response.status===200).data,repeat=(await battle(h,p,event,battleBody(event,accepted.battle.requestId))).data;
  assert.equal(repeat.idempotent,true);assert.deepEqual(repeat.battle,accepted.battle);assert.deepEqual(repeat.rewardMailIds,accepted.rewardMailIds);assert.equal(receipts(h),3);
  await battle(h,p,event,{...battleBody(event,accepted.battle.requestId),stageId:'stage-1'},409);
  const mail=(await get(h,'/mail',p)).mail;assert.equal(mail.length,3);for(const item of mail){assert.equal(item.source,'system');assert.equal(item.event.kind,'timed-event');assert.equal(item.event.eventId,event.id);assert(item.gift);noPrivate(item);}
  const claim=(await h.api('/mail/claim',post(p,{mailId:mail[0].id,requestId:'event-gift'}))).data;
  const replay=(await h.api('/mail/claim',post(p,{mailId:mail[0].id,requestId:'event-gift'}))).data;assert.equal(replay.receiptId,claim.receiptId);assert.equal(replay.alreadyClaimed,true);
 }));
 await scope('the event uses real-time expiry while stopped world time allows spending remaining commands',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op,2),p=await player(h),started=h.now;
  const clock=(await get(h,'/world-clock')).clock;await h.api('/world-clock',{method:'PATCH',token:op.token,body:{revision:clock.revision,running:false,speed:4}});
  for(let i=0;i<3;i++)await battle(h,p,event,battleBody(event,'paused-'+i));
  h.now=started+DAY;let progress=(await get(h,'/events/'+event.id,p)).progress;assert.equal(progress.command.available,0);assert.equal(progress.battles,3);
  await syncCurrent(h,p);assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'INSUFFICIENT_COMMAND');
  h.now=started+2*DAY;const ended=await get(h,'/events/'+event.id,p);assert.equal(ended.event.status,'ended');assert.equal(ended.event.endedAt,event.endsAt);assert.equal(ended.progress.command.available,0);
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'EVENT_ENDED');
  assert.equal((await battle(h,p,event,battleBody(event,'paused-0'))).data.idempotent,true);
  const next=await publish(h,op);assert.equal(next.status,'active');assert.equal(receipts(h),3);
 }));
 await scope('ordinary command recovery retains partial progress and allows fourth and later sorties',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h,'指令回復の領主',s=>{s.command=1;s.realtime.commandProgress=17;});
  const first=(await battle(h,p,event,battleBody(event,'recover-first'))).data;assert.equal(first.save.state.command,0);assert.equal(first.save.state.realtime.commandProgress,17);
  const empty=structuredClone(row(h,p));assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'INSUFFICIENT_COMMAND');assert.deepEqual(row(h,p),empty);
  h.now+=3000;let fresh=await syncCurrent(h,p);assert.equal(fresh.save.state.command,1);assert.equal(fresh.save.state.realtime.commandProgress,0);await battle(h,p,event);
  for(let i=0;i<3;i++){h.now+=20000;fresh=await syncCurrent(h,p);assert.equal(fresh.save.state.command,1);await battle(h,p,event);}
  assert.equal(receipts(h),5);assert.equal((await get(h,'/events/'+event.id,p)).progress.battles,5);
  const clock=(await get(h,'/world-clock')).clock;await h.api('/world-clock',{method:'PATCH',token:op.token,body:{revision:clock.revision,speed:4}});
  h.now+=5000;fresh=await syncCurrent(h,p);assert.equal(fresh.save.state.command,1);const sixth=(await battle(h,p,event)).data;assert.equal(sixth.progress.battles,6);assert.equal(sixth.save.state.command,0);
 }));
 await scope('legacy plans retain every enemy and reward while the old daily quota is removed',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h,'七指令の領主',s=>{s.buildings.keep=32;s.command=7;}),legacy=structuredClone(event.plan);
  delete legacy.commandCost;legacy.dailyAttempts=3;legacy.rules=['挑戦は開催開始から24時間ごとに3回まで。',...legacy.rules.filter(rule=>!rule.includes('指令'))];
  const serialized=JSON.stringify(legacy);h.sql.prepare('UPDATE timed_events SET plan_json=? WHERE id=?').run(serialized,event.id);
  const detail=await get(h,'/events/'+event.id,p);assert.equal(detail.event.plan.commandCost,1);assert(!Object.hasOwn(detail.event.plan,'dailyAttempts'));assert.deepEqual(detail.event.plan.stages,legacy.stages);assert.deepEqual(detail.event.plan.milestones,legacy.milestones);assert.deepEqual(detail.progress.command,{available:7,max:7,cost:1});
  for(let i=0;i<7;i++)await battle(h,p,event,battleBody(event,'legacy-'+i));
  assert.equal(receipts(h),7);assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'INSUFFICIENT_COMMAND');assert.equal(count(h,'mail_campaigns'),3);
  assert.equal(h.sql.prepare('SELECT plan_json FROM timed_events WHERE id=?').get(event.id).plan_json,serialized);
 }));
 await scope('stale saves cannot restore spent commands and replay always returns the latest snapshot',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h),before=structuredClone(row(h,p)),body=battleBody(event,'save-fence');
  const first=(await battle(h,p,event,body)).data;assert.equal(first.save.state.command,2);
  const stale=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:before.revision,save:JSON.parse(before.save_json)},expected:409});assert.equal(stale.data.error.code,'REVISION_CONFLICT');assert.equal(JSON.parse(row(h,p).save_json).state.command,2);
  const ordinary=structuredClone(first.save);ordinary.state.command--;
  const saved=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:first.revision,save:ordinary}})).data;
  const replay=(await battle(h,p,event,{...body,deviceId:'different-device',expectedRevision:before.revision})).data;
  assert.equal(replay.idempotent,true);assert.equal(replay.revision,saved.revision);assert.equal(replay.save.state.command,1);assert.equal(replay.progress.command.available,1);assert.equal(replay.writable,false);assert.deepEqual(replay.battle,first.battle);assert.equal(receipts(h),1);
 }));
 await scope('auto-save and an event battle cannot both overwrite the same campaign revision',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h),before=row(h,p),ordinary=JSON.parse(before.save_json);ordinary.state.command--;
  const outcomes=await Promise.all([
   battle(h,p,event,{...battleBody(event,'save-race'),expectedRevision:before.revision},null),
   h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:before.revision,save:ordinary},expected:null})
  ]);
  assert.deepEqual(outcomes.map(result=>result.response.status).sort(),[200,409]);assert.equal(row(h,p).revision,before.revision+1);assert.equal(JSON.parse(row(h,p).save_json).state.command,2);
  assert.equal(receipts(h),outcomes[0].response.status===200?1:0);assert(outcomes.some(result=>result.data.error?.code==='REVISION_CONFLICT'));
 }));
 await scope('lease and world-clock changes at commit reject a battle without spending a command',async h=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h);
  h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare('UPDATE player_saves SET lease_expires_at=? WHERE user_id=?').run(h.now,p.user.id);}};
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'LEASE_REQUIRED');assert.equal(receipts(h),0);assert.equal(JSON.parse(row(h,p).save_json).state.command,3);
  await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
  h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare('UPDATE world_clock SET revision=revision+1').run();}};
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'WORLD_CLOCK_CHANGED');assert.equal(receipts(h),0);assert.equal(JSON.parse(row(h,p).save_json).state.command,3);
  h.now+=16000;assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'CLOCK_STALE');assert.equal(receipts(h),0);
 });
 await scope('staff command capacity uses shared keep levels without overwriting personal buildings',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h,'共同城の領主');
  await h.api('/admin/staff',post(op,{targetPlayerId:p.user.id,action:'appoint',requestId:'command-staff'}));await get(h,'/sync?deviceId='+p.deviceId,p);
  const base=JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='sunpu'").get().state_json);base.buildings.keep=32;h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='sunpu'").run(JSON.stringify(base));
  const save=JSON.parse(row(h,p).save_json),personalKeep=save.state.buildings.keep;save.state.command=7;h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(save),p.user.id);
  assert.deepEqual((await get(h,'/events/'+event.id,p)).progress.command,{available:7,max:7,cost:1});
  const result=(await battle(h,p,event)).data;assert.deepEqual(result.progress.command,{available:6,max:7,cost:1});assert.equal(result.save.state.command,6);assert.equal(JSON.parse(row(h,p).save_json).state.buildings.keep,personalKeep);assert.equal(result.staffBase.buildings.keep,32);
 }));
 await scope('reward insert failure rolls the entire battle back and a retry is safe',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h),body=battleBody(event,'rollback'),before=structuredClone(row(h,p));
  h.sql.exec("CREATE TRIGGER fail_event_reward BEFORE INSERT ON timed_event_rewards BEGIN SELECT RAISE(ABORT,'fixture reward failure'); END");
  await battle(h,p,event,body,500);assert.equal(receipts(h),0);assert.equal(count(h,'timed_event_participants'),0);assert.equal(count(h,'timed_event_rewards'),0);assert.equal(count(h,'mail_campaigns'),0);assert.deepEqual(row(h,p),before);
  h.sql.exec('DROP TRIGGER fail_event_reward');const result=(await battle(h,p,event,body)).data;assert.equal(result.idempotent,false);assert.equal(receipts(h),1);assert.equal(result.rewardMailIds.length,2);
 }));
 await scope('a lost response replays the committed battle and mail without a second award',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h),body=battleBody(event,'lost-response');
  h.afterBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.afterBatch=null;throw Error('fixture lost response');}};
  await battle(h,p,event,body,500);assert.equal(receipts(h),1);assert.equal(count(h,'mail_campaigns'),2);
  const replay=(await battle(h,p,event,body)).data;assert.equal(replay.idempotent,true);assert.equal(replay.progress.battles,1);assert.equal(replay.rewardMailIds.length,2);assert.equal(count(h,'mail_campaigns'),2);
 }));
 await scope('save revision and event-end races consume no attempts and send no gifts',async h=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h);
  h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(p.user.id);}};
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'REVISION_CONFLICT');assert.equal(receipts(h),0);
  h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare("UPDATE timed_events SET status='ended',ended_at=?,revision=revision+1 WHERE id=?").run(h.now,event.id);}};
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'EVENT_ENDED');assert.equal(receipts(h),0);assert.equal(count(h,'mail_campaigns'),0);
 });
 await scope('BAN and account generation races block the event transaction',async h=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h);
  const intervene=(active,revision)=>{h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,revision=excluded.revision').run(p.user.id,active,revision,'fixture',op.user.id,h.now,h.now);}};};
  intervene(1,1);assert.equal((await battle(h,p,event,battleBody(event),403)).data.error.code,'ACCOUNT_BANNED');assert.equal(receipts(h),0);
  h.sql.prepare('UPDATE player_bans SET active=0,revision=2 WHERE user_id=?').run(p.user.id);
  intervene(0,4);assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'ACCOUNT_ACCESS_CHANGED');assert.equal(receipts(h),0);assert.equal(count(h,'mail_campaigns'),0);
 });
 await scope('operator loss and staff membership races cannot commit stale authority',async h=>{
  const op=await operator(h),p=await player(h),event=await publish(h,op);
  h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) VALUES(?,?,?,?,0)').run(p.user.id,op.user.id,h.now,'new-term');}};
  assert.equal((await battle(h,p,event,battleBody(event),409)).data.error.code,'EVENT_STATE_CHANGED');assert.equal(receipts(h),0);
  h.beforeBatch=async statements=>{if(statements[0].sql.includes('INSERT INTO timed_event_requests')){h.beforeBatch=null;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(p.user.id);}};
  await h.api('/admin/events/generate',post(op,{name:'権限喪失中',durationDays:1,requestId:'stale-admin'},403));assert.equal(count(h,'timed_events'),1);assert.equal(count(h,'mail_campaigns'),0);
 });
 await scope('leaderboards resolve current avatars and rank, cap at twenty and omit banned players',async h=>victory(async()=>{
  const op=await operator(h),event=await publish(h,op),p=await player(h);
  const image=Buffer.from(readFileSync(new URL('./fixtures/avatar/baseline.jpg',import.meta.url))).toString('base64');
  const avatar=(await h.api('/me/avatar',{method:'PUT',token:p.token,body:{image}})).data.user.avatarVersion;
  await battle(h,p,event);
  for(let i=0;i<21;i++){const member=await h.session('順位試験'+i);h.sql.prepare('INSERT INTO timed_event_participants(event_id,user_id,points,wins,battles,updated_at) VALUES(?,?,?,0,1,?)').run(event.id,member.user.id,i,h.now);}
  let board=(await get(h,'/events/'+event.id)).leaderboard;assert.equal(board.length,20);assert.equal(board[0].playerId,p.user.id);assert.equal(board[0].avatarVersion,avatar);assert(board[0].evaluation.rankName);noPrivate(board);
  h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(p.user.id,'fixture',op.user.id,h.now,h.now);
  board=(await get(h,'/events/'+event.id)).leaderboard;assert.equal(board.length,20);assert(!board.some(entry=>entry.playerId===p.user.id));assert.equal(board[0].rank,1);
 }));
 assert.equal(externalRequests,0);
 console.log(`Timed events regression passed: ${checks.length} groups, ${calls} API calls, no external requests.`);
}finally{globalThis.fetch=originalFetch;}
