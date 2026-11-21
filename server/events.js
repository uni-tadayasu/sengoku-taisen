// Timed NPC battles spend the campaign's shared command through its current
// writer revision. The save, battle receipt, points and mail commit together.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {generateEventPlan,normalizeEventPlan,resolveEventBattle} from './event-planner.js';

const DAY_MS=86400000;
const COMMAND_COST=1;
const MAX_DRAFTS=30;
const eventStmt=(db,sql,...params)=>db.prepare(sql).bind(...params);
const eventRows=result=>result?.results||[];
const eventIso=value=>value===null||value===undefined?null:new Date(Number(value)).toISOString();
const EVENT_ADMIN="EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)";
const EVENT_GATE='EXISTS(SELECT 1 FROM timed_event_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const eventStatus=(row,now)=>['draft','discarded'].includes(row.status)?row.status:row.ended_at!==null||row.status==='ended'||Number(row.ends_at)<=now?'ended':'active';

function eventDto(row,now){
 const status=eventStatus(row,now);
 return {id:row.id,name:row.name,durationDays:Number(row.duration_days),status,startsAt:eventIso(row.starts_at),endsAt:eventIso(row.ends_at),endedAt:eventIso(row.ended_at??(status==='ended'?row.ends_at:null)),createdAt:eventIso(row.created_at),plan:normalizeEventPlan(JSON.parse(row.plan_json))};
}
async function eventCommand(ctx,raw,now,snapshot=null){
 if(!raw)return null;
 try{
  const {db,user,helpers:h}=ctx,current=snapshot?.user?{...user,is_admin:snapshot.user.isAdmin,is_staff:snapshot.user.isStaff}:user;
  const save=typeof raw==='string'?JSON.parse(raw):raw,clock=snapshot?.clock||await h.getWorldClock(db,now);
  const game=GameEngine.fromSave(h.normalizeGameSave(save,current,now,{reading:true,clock}),GAME_OFFICERS,{isAdmin:!!current.is_admin,isStaff:!!current.is_staff});
  if(current.is_staff&&!current.is_admin){
   const shared=snapshot?.staffBase||(await eventStmt(db,"SELECT state_json FROM staff_base WHERE id='sunpu'").first())?.state_json;
   const base=typeof shared==='string'?JSON.parse(shared):shared;
   if(base?.buildings){let keep=base.buildings.keep;for(const job of base.jobs||[])if(job.kind==='building'&&job.id==='keep'&&job.completesElapsedMs<=clock.elapsedMs)keep=Math.max(keep,job.targetLevel);game.state.buildings.keep=keep;}
  }
  return {available:game.state.command,max:game.commandMax(),cost:COMMAND_COST};
 }catch{return null;}
}
async function eventProgress(ctx,row,now,snapshot=null){
 if(!ctx.user)return null;
 const {db,user}=ctx;
 const result=await db.batch([
  eventStmt(db,'SELECT points,wins,battles FROM timed_event_participants WHERE event_id=? AND user_id=?',row.id,user.id),
  eventStmt(db,'SELECT save_json FROM player_saves WHERE user_id=?',user.id),
  eventStmt(db,'SELECT milestone_id,mail_id,awarded_at FROM timed_event_rewards WHERE event_id=? AND user_id=? ORDER BY awarded_at,milestone_id',row.id,user.id)
 ]);
 const participant=eventRows(result[0])[0],command=await eventCommand(ctx,snapshot?snapshot.save:eventRows(result[1])[0]?.save_json,now,snapshot);
 return {points:Number(participant?.points||0),wins:Number(participant?.wins||0),battles:Number(participant?.battles||0),command,rewards:eventRows(result[2]).map(reward=>({milestoneId:reward.milestone_id,mailId:reward.mail_id,awardedAt:eventIso(reward.awarded_at)}))};
}
async function eventLeaderboard(ctx,id){
 const found=eventRows(await eventStmt(ctx.db,`SELECT p.user_id,u.name,p.points,p.wins,p.battles FROM timed_event_participants p JOIN users u ON u.id=p.user_id
  WHERE p.event_id=? AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=p.user_id AND b.active=1)
  ORDER BY p.points DESC,p.wins DESC,p.updated_at,p.user_id LIMIT 20`,id).all());
 return found.map((player,index)=>({rank:index+1,playerId:player.user_id,name:player.name,points:Number(player.points),wins:Number(player.wins),battles:Number(player.battles),evaluation:ctx.helpers.evaluationRef(player.user_id)}));
}
async function requireEventAdmin(ctx){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 const current=await ctx.helpers.getUser(ctx.db,ctx.user.id);ctx.helpers.requireAdmin(current||{});
}
function eventBody(raw,allowed,h){
 if(Object.keys(raw).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','イベントの送信内容を確認してください。');
 return h.idField(raw.requestId,'操作番号');
}
async function eventRow(ctx,id,{publicOnly=false}={}){
 const row=await eventStmt(ctx.db,'SELECT * FROM timed_events WHERE id=?'+(publicOnly?" AND status IN ('active','ended')":''),id).first();
 if(!row)ctx.helpers.fail(404,'EVENT_NOT_FOUND','このイベントは見つからないか、まだ開催されていません。');
 return row;
}
async function eventPrior(ctx,requestId,digest){
 const prior=await eventStmt(ctx.db,'SELECT * FROM timed_event_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(prior&&prior.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別のイベント操作に使われています。');
 return prior;
}
async function eventResult(ctx,receipt,idempotent,body=null){
 const now=Date.now(),result=JSON.parse(receipt.result_json),row=await eventRow(ctx,result.eventId);
 const response={ok:true,serverNow:eventIso(now),event:eventDto(row,now),idempotent};
 if(receipt.action==='battle'){
  const {db,helpers:h}=ctx,current=await h.getUser(db,ctx.user.id),snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,ctx.user.id),current,body.deviceId,now);
  Object.assign(response,snapshot,{progress:await eventProgress(ctx,row,now,snapshot),battle:result.battle,rewardMailIds:result.rewardMailIds||[]});
 }
 else await requireEventAdmin(ctx);
 return response;
}
async function eventGenerate(ctx){
 const {db,user,request,helpers:h}=ctx,raw=await h.readBody(request),requestId=eventBody(raw,['name','durationDays','requestId'],h);
 const name=h.textField(raw.name,'戦いの名前',60),days=raw.durationDays;
 if(/[\u0000-\u001F\u007F-\u009F]/u.test(name))h.fail(400,'INVALID_INPUT','戦いの名前は改行・制御文字を含めず入力してください。');
 if(!Number.isInteger(days)||days<1||days>7)h.fail(400,'INVALID_INPUT','開催期間は1〜7日の整数にしてください。');
 const digest=await h.hash(JSON.stringify(['generate',name,days])),prior=await eventPrior(ctx,requestId,digest);
 if(prior)return eventResult(ctx,prior,true);
 await h.budget(db,'event-design:'+user.id,20,60000,ctx.now);
 const id=h.uid('ev_'),plan=generateEventPlan({name,durationDays:days,seed:h.uid('seed_')}),nonce=crypto.randomUUID(),now=Date.now(),guard=h.roleCommitGuard(user),gateArgs=[user.id,requestId,nonce];
 await db.batch([
  eventStmt(db,`INSERT INTO timed_event_requests(actor_id,request_id,event_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,'generate',?,?,?,? WHERE ${EVENT_ADMIN} AND ${guard.sql} AND (SELECT COUNT(*) FROM timed_events WHERE status='draft')<${MAX_DRAFTS}
   ON CONFLICT(actor_id,request_id) DO NOTHING`,user.id,requestId,id,digest,nonce,JSON.stringify({eventId:id}),now,user.id,...guard.args),
  eventStmt(db,`INSERT INTO timed_events(id,creator_id,name,duration_days,status,plan_json,created_at)
   SELECT ?,?,?,?,'draft',?,? WHERE ${EVENT_GATE}`,id,user.id,name,days,JSON.stringify(plan),now,...gateArgs)
 ]);
 const saved=await eventPrior(ctx,requestId,digest);
 if(!saved){
  await requireEventAdmin(ctx);
  const count=await eventStmt(db,"SELECT COUNT(*) AS count FROM timed_events WHERE status='draft'").first();
  if(Number(count.count)>=MAX_DRAFTS)h.fail(409,'EVENT_DRAFT_LIMIT','未開催の企画は30件までです。既存の企画を開催してから生成してください。');
  h.fail(409,'EVENT_CHANGED','領主の状態が更新されました。もう一度生成してください。');
 }
 return eventResult(ctx,saved,saved.commit_token!==nonce);
}
async function eventChange(ctx,id,action){
 const {db,user,request,helpers:h}=ctx,raw=await h.readBody(request),requestId=eventBody(raw,['requestId'],h);
 const digest=await h.hash(JSON.stringify([action,id])),prior=await eventPrior(ctx,requestId,digest);
 if(prior)return eventResult(ctx,prior,true);
 const row=await eventRow(ctx,id),now=Date.now();
 if(action==='publish'&&row.status!=='draft')h.fail(409,'EVENT_ALREADY_PUBLISHED','このイベントはすでに開催されています。');
 if(action==='discard'&&row.status!=='draft')h.fail(409,'EVENT_CHANGED','未開催の企画だけを破棄できます。');
 if(action==='end'&&eventStatus(row,now)!=='active')h.fail(409,'EVENT_ENDED','このイベントは開催中ではありません。');
 await h.budget(db,'event-manage:'+user.id,30,60000,now);
 const nonce=crypto.randomUUID(),guard=h.roleCommitGuard(user),gateArgs=[user.id,requestId,nonce],condition=action==='publish'
  ?"e.status='draft' AND NOT EXISTS(SELECT 1 FROM timed_events live WHERE live.status='active' AND live.ended_at IS NULL AND live.ends_at>?)"
  :action==='discard'?"e.status='draft'":"e.status='active' AND e.ended_at IS NULL AND e.starts_at<=? AND e.ends_at>?";
 await db.batch([
  eventStmt(db,`INSERT INTO timed_event_requests(actor_id,request_id,event_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,?,? FROM timed_events e WHERE e.id=? AND e.revision=? AND ${condition} AND ${EVENT_ADMIN} AND ${guard.sql}
   ON CONFLICT(actor_id,request_id) DO NOTHING`,user.id,requestId,id,action,digest,nonce,JSON.stringify({eventId:id}),now,id,row.revision,...(action==='publish'?[now]:action==='end'?[now,now]:[]),user.id,...guard.args),
  action==='publish'
   ?eventStmt(db,`UPDATE timed_events SET status='active',starts_at=?,ends_at=?+duration_days*${DAY_MS},revision=revision+1 WHERE id=? AND ${EVENT_GATE}`,now,now,id,...gateArgs)
   :action==='discard'?eventStmt(db,`UPDATE timed_events SET status='discarded',revision=revision+1 WHERE id=? AND ${EVENT_GATE}`,id,...gateArgs)
   :eventStmt(db,`UPDATE timed_events SET status='ended',ended_at=?,revision=revision+1 WHERE id=? AND ${EVENT_GATE}`,now,id,...gateArgs)
 ]);
 const saved=await eventPrior(ctx,requestId,digest);
 if(!saved){
  await requireEventAdmin(ctx);
  const current=await eventRow(ctx,id);
  if(action==='publish'&&current.status==='draft')h.fail(409,'EVENT_ALREADY_ACTIVE','別のイベントが開催中です。終了してから開催してください。');
  h.fail(409,'EVENT_CHANGED','イベントの開催状態が更新されました。最新の内容を確認してください。');
 }
 return eventResult(ctx,saved,saved.commit_token!==nonce);
}
async function eventBattle(ctx,id){
 const {db,user,request,helpers:h}=ctx,raw=await h.readBody(request),requestId=eventBody(raw,['stageId','tactic','requestId','deviceId','expectedRevision'],h);
 const stageId=h.idField(raw.stageId,'戦場'),tactic=h.idField(raw.tactic,'戦術'),deviceId=h.idField(raw.deviceId,'端末');
 if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)h.fail(400,'INVALID_INPUT','保存の更新番号が正しくありません。');
 const body={requestId,stageId,tactic,deviceId,expectedRevision:raw.expectedRevision};
 const digest=await h.hash(JSON.stringify(['battle',id,stageId,tactic])),prior=await eventPrior(ctx,requestId,digest);
 if(prior)return eventResult(ctx,prior,true,body);
 const row=await eventRow(ctx,id,{publicOnly:true}),plan=normalizeEventPlan(JSON.parse(row.plan_json));
 if(!plan.stages.some(stage=>stage.id===stageId)||!plan.tactics.some(choice=>choice.id===tactic))h.fail(400,'INVALID_INPUT','このイベントの戦場と戦術を選択してください。');
 if(eventStatus(row,Date.now())!=='active')h.fail(409,'EVENT_ENDED','このイベントは終了しました。');
 const savedRow=await h.settleWriterCycle(db,user,deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 const save=h.normalizeGameSave(JSON.parse(savedRow.save_json),user,ctx.now,{reading:true,clock});
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff});
 if(game.state.gameOver)h.fail(409,'BASE_UNAVAILABLE','本拠を失っている間はイベントに挑戦できません。');
 if(!save.state.worldClock)h.fail(409,'CLOCK_ANCHOR_REQUIRED','先に共通時計へ同期してください。');
 if(clock.elapsedMs-save.state.worldClock.elapsedMs>15000)h.fail(409,'CLOCK_STALE','共通時計と本拠を同期してから出陣してください。');
 if(save.state.command<COMMAND_COST)h.fail(409,'INSUFFICIENT_COMMAND','指令が不足しています。通常の指令が回復してから出陣してください。');
 await h.budget(db,'event-battle:'+user.id,30,60000,ctx.now);
 const now=Date.now(),nonce=crypto.randomUUID(),guard=h.roleCommitGuard(user),gateArgs=[user.id,requestId,nonce];
 if(eventStatus(row,now)!=='active')h.fail(409,'EVENT_ENDED','このイベントは終了しました。');
 const roll=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296;
 const commandBefore=save.state.command;
 const battle={...resolveEventBattle(plan,{stageId,tactic,army:game.armyStats(),morale:game.state.morale},roll),id:h.uid('eb_'),requestId,commandCost:COMMAND_COST,commandBefore,commandAfter:commandBefore-COMMAND_COST,playerRevision:Number(savedRow.revision)+1,createdAt:eventIso(now)};
 save.state.command-=COMMAND_COST;save.savedAt=eventIso(now);
 const updatedSave=h.normalizeGameSave(save,user,now,{clock});
 const statements=[
  eventStmt(db,`INSERT INTO timed_event_requests(actor_id,request_id,event_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,'battle',?,?,?,? FROM timed_events e WHERE e.id=? AND e.status='active' AND e.ended_at IS NULL AND e.starts_at<=? AND e.ends_at>? AND e.revision=?
   AND EXISTS(SELECT 1 FROM player_saves ps WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND ps.save_json IS NOT NULL AND json_extract(ps.save_json,'$.state.command')>=?)
   AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${guard.sql}
   ON CONFLICT(actor_id,request_id) DO NOTHING`,user.id,requestId,id,digest,nonce,JSON.stringify({eventId:id,battle,rewardMailIds:[]}),now,id,now,now,row.revision,user.id,body.expectedRevision,deviceId,now,COMMAND_COST,h.worldClockId,clock.revision,...guard.args),
  eventStmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${EVENT_GATE}`,JSON.stringify(updatedSave),now,now+h.syncLease,user.id,...gateArgs),
  eventStmt(db,`INSERT INTO timed_event_participants(event_id,user_id,points,wins,battles,updated_at) SELECT ?,?,?,?,1,? WHERE ${EVENT_GATE}
   ON CONFLICT(event_id,user_id) DO UPDATE SET points=timed_event_participants.points+excluded.points,wins=timed_event_participants.wins+excluded.wins,battles=timed_event_participants.battles+1,updated_at=excluded.updated_at`,id,user.id,battle.points,battle.won?1:0,now,...gateArgs)
 ];
 for(const milestone of plan.milestones){
  const mailId=`m_ev_${id.slice(3)}_${user.id.slice(2)}_${milestone.id.slice(-1)}`,mailRequest=`system:event:${id}:${milestone.id}`;
  const title=Array.from(`【催事報酬】${row.name}・${milestone.title}`).slice(0,60).join('');
  const body=`期間限定合戦「${row.name}」で「${milestone.title}」を達成しました。\n目標：${milestone.points}点。\n贈り物を受け取り、本拠の資源・勾玉に反映してください。イベント終了後も受け取れます。`;
  const giftJson=JSON.stringify(milestone.gift),payloadHash=await h.hash(JSON.stringify({target:user.id,title,body,gift:milestone.gift}));
  statements.push(
   eventStmt(db,`INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,gift_json,request_id,payload_hash,created_at)
    SELECT ?,?,?,?,?,?,?,?,? WHERE ${EVENT_GATE}
    AND EXISTS(SELECT 1 FROM timed_event_participants WHERE event_id=? AND user_id=? AND points>=?)
    AND NOT EXISTS(SELECT 1 FROM timed_event_rewards WHERE event_id=? AND user_id=? AND milestone_id=?)`,mailId,user.id,user.id,title,body,giftJson,mailRequest,payloadHash,now,...gateArgs,id,user.id,milestone.points,id,user.id,milestone.id),
   eventStmt(db,`INSERT INTO timed_event_rewards(event_id,user_id,milestone_id,mail_id,request_id,awarded_at)
    SELECT ?,?,?,?,?,? WHERE ${EVENT_GATE} AND EXISTS(SELECT 1 FROM mail_campaigns WHERE id=?)
    ON CONFLICT(event_id,user_id,milestone_id) DO NOTHING`,id,user.id,milestone.id,mailId,requestId,now,...gateArgs,mailId)
  );
 }
 statements.push(eventStmt(db,`UPDATE timed_event_requests SET result_json=json_set(result_json,'$.rewardMailIds',json((SELECT json_group_array(mail_id) FROM timed_event_rewards WHERE event_id=? AND user_id=? AND request_id=?)))
  WHERE actor_id=? AND request_id=? AND commit_token=?`,id,user.id,requestId,...gateArgs));
 await db.batch(statements);
 const saved=await eventPrior(ctx,requestId,digest);
 if(!saved){
  await h.requireAccountAccess(db,user);
  h.fieldWriter(await h.getSyncRow(db,user.id),deviceId,body.expectedRevision,Date.now());
  const current=await eventRow(ctx,id),freshNow=Date.now();
  if(eventStatus(current,freshNow)!=='active')h.fail(409,'EVENT_ENDED','このイベントは終了しました。');
  if((await h.getWorldClock(db,freshNow)).revision!==clock.revision)h.fail(409,'WORLD_CLOCK_CHANGED','共通時計が更新されました。同期してからお試しください。');
  h.fail(409,'EVENT_STATE_CHANGED','本拠または領主の状態が更新されました。最新の状態でもう一度挑戦してください。');
 }
 return eventResult(ctx,saved,saved.commit_token!==nonce,body);
}

export async function handleEvents(ctx){
 const {db,user,now,path,method,helpers:h}=ctx;
 if(path==='/events'&&method==='GET'){
  const found=eventRows(await eventStmt(db,`SELECT * FROM timed_events WHERE status IN ('active','ended')
   ORDER BY CASE WHEN status='active' AND ended_at IS NULL AND ends_at>? THEN 0 ELSE 1 END,starts_at DESC,id DESC LIMIT 20`,now).all());
  return {ok:true,serverNow:eventIso(now),events:found.map(row=>eventDto(row,now))};
 }
 const detail=/^\/events\/(ev_[a-f0-9]{32})$/.exec(path);
 if(detail&&method==='GET'){
  const row=await eventRow(ctx,detail[1],{publicOnly:true});
  return {ok:true,serverNow:eventIso(now),event:eventDto(row,now),progress:await eventProgress(ctx,row,now),leaderboard:await eventLeaderboard(ctx,row.id)};
 }
 if(path==='/admin/events'||path.startsWith('/admin/events/')){
  h.requireAdmin(user||{});await requireEventAdmin(ctx);
  if(path==='/admin/events'&&method==='GET'){
   const found=eventRows(await eventStmt(db,`SELECT * FROM timed_events WHERE status<>'discarded' AND ${EVENT_ADMIN}
    ORDER BY CASE WHEN status='active' AND ended_at IS NULL AND ends_at>? THEN 0 WHEN status='draft' THEN 1 ELSE 2 END,created_at DESC,id DESC LIMIT 50`,user.id,now).all());
   await requireEventAdmin(ctx);
   return {ok:true,serverNow:eventIso(now),events:found.map(row=>eventDto(row,now))};
  }
  if(path==='/admin/events/generate'&&method==='POST')return eventGenerate(ctx);
  const change=/^\/admin\/events\/(ev_[a-f0-9]{32})\/(publish|end|discard)$/.exec(path);
  if(change&&method==='POST')return eventChange(ctx,change[1],change[2]);
 }
 const battle=/^\/events\/(ev_[a-f0-9]{32})\/battle$/.exec(path);
 if(battle&&method==='POST'&&user)return eventBattle(ctx,battle[1]);
 h.fail(404,'NOT_FOUND','そのイベント機能は見つかりませんでした。');
}
