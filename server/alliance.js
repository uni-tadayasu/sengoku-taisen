// Alliance planning, membership rules and troop escrow. All valuable mutations
// share a receipt gate with the player save; a replay never repeats a transfer.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {marchDto} from './marches.js';
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=result=>result?.results||[];
const clone=value=>JSON.parse(JSON.stringify(value));
const emptyGuard=()=>({sql:'1=1',args:[]});
const and=(...guards)=>({sql:guards.map(g=>'('+g.sql+')').join(' AND ')||'1=1',args:guards.flatMap(g=>g.args)});
const GATE='EXISTS(SELECT 1 FROM alliance_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const DAY=86400000,MAX_UNITS=50,MAX_RALLY=100000,ASSET_LIMIT=100000000;
const POLICY={joinMode:'open',description:'',activity:'',withdrawRole:'all',dailyLimit:100000000,approvalThreshold:1000000,newcomerHours:0,revision:0};
const dayStart=now=>Math.floor((now+9*3600000)/DAY)*DAY-9*3600000;
const integer=(h,value,name,min,max)=>{if(!Number.isSafeInteger(value)||value<min||value>max)h.fail(400,'INVALID_INPUT',name+'の数値を確認してください。');return value;};
const text=(h,value,name,max,optional=false)=>h.textField(value,name,max,{optional});
const id=(h,value,name)=>h.idField(value,name);
const cast=id=>globalThis.SENGOKU_DATA?.castles?.find(c=>c.id===id);
const policyDto=row=>row?{joinMode:row.join_mode,description:row.description,activity:row.activity,withdrawRole:row.withdraw_role,dailyLimit:row.daily_limit,approvalThreshold:row.approval_threshold,newcomerHours:row.newcomer_hours,revision:row.revision}:{...POLICY};
async function policy(db,guildId){const row=await stmt(db,'SELECT * FROM alliance_policies WHERE guild_id=?',guildId).first();return{...policyDto(row),guard:row?{sql:'EXISTS(SELECT 1 FROM alliance_policies WHERE guild_id=? AND revision=?)',args:[guildId,row.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM alliance_policies WHERE guild_id=?)',args:[guildId]}};}
async function membership(db,userId,guildId){return stmt(db,'SELECT gm.*,COALESCE(e.epoch,0) AS epoch,g.owner_id,EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=gm.user_id AND go.guild_id=gm.guild_id) AS officer FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id LEFT JOIN voice_membership_epochs e ON e.user_id=gm.user_id WHERE gm.user_id=? AND gm.guild_id=?',userId,guildId).first();}
function memberGuard(member){return member?{sql:'EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=?) AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0)=?',args:[member.user_id,member.guild_id,member.user_id,member.epoch]}:{sql:'0=1',args:[]};}
function officerGuard(member,ownerOnly=false){const memberPart=memberGuard(member),role={sql:ownerOnly?'EXISTS(SELECT 1 FROM guilds WHERE id=? AND owner_id=?)':'(EXISTS(SELECT 1 FROM guilds WHERE id=? AND owner_id=?) OR EXISTS(SELECT 1 FROM guild_officers WHERE guild_id=? AND user_id=?))',args:ownerOnly?[member.guild_id,member.user_id]:[member.guild_id,member.user_id,member.guild_id,member.user_id]};return and(memberPart,role);}
async function requireMember(ctx,ownerOnly=false,officer=false){const m=await membership(ctx.db,ctx.user.id,ctx.user.guild_id);if(!m)ctx.helpers.fail(403,'GUILD_REQUIRED','同盟へ参加してからご利用ください。');if(ownerOnly&&m.owner_id!==ctx.user.id||officer&&m.owner_id!==ctx.user.id&&!m.officer)ctx.helpers.fail(403,'GUILD_ROLE_REQUIRED',ownerOnly?'盟主が設定できます。':'盟主または副盟主が操作できます。');return m;}
function receiptDigestBody(raw){const value={...raw};delete value.deviceId;delete value.expectedRevision;delete value.requestId;return value;}
async function prior(ctx,body,action){const digest=await ctx.helpers.hash(JSON.stringify([action,receiptDigestBody(body)])),old=await stmt(ctx.db,'SELECT * FROM alliance_requests WHERE actor_id=? AND request_id=?',ctx.user.id,body.requestId).first();if(old&&old.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の同盟操作で使用されています。');return{digest,old};}
async function finish(ctx,body,result,idempotent=false){await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);let snapshot={};if(body.deviceId&&ctx.helpers.syncSnapshot)snapshot=await ctx.helpers.syncSnapshot(ctx.db,await ctx.helpers.getSyncRow(ctx.db,ctx.user.id),await ctx.helpers.getUser(ctx.db,ctx.user.id),body.deviceId,Date.now());return{...snapshot,ok:true,result,idempotent};}
async function commit(ctx,body,action,guard,changes,result,prepared=null){
 const p=prepared||await prior(ctx,body,action);if(p.old)return finish(ctx,body,JSON.parse(p.old.result_json),true);
 const {db,user,helpers:h}=ctx,nonce=crypto.randomUUID(),args=[user.id,body.requestId,nonce],access=h.roleCommitGuard?h.roleCommitGuard(user):h.accountCommitGuard(user),full=and(guard,access);
 const statements=[stmt(db,'INSERT INTO alliance_requests(actor_id,request_id,request_hash,commit_token,result_json,created_at) SELECT ?,?,?,?,?,? WHERE '+full.sql+' ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id',user.id,body.requestId,p.digest,nonce,JSON.stringify(result),ctx.now,...full.args),...changes(GATE,args)];
 const done=await db.batch(statements);if(!rows(done[0]).length){const retry=await prior(ctx,body,action);if(retry.old)return finish(ctx,body,JSON.parse(retry.old.result_json),true);await h.requireAccountAccess(db,user);h.fail(409,'ALLIANCE_STATE_CHANGED','同盟・部隊・保存の状態が更新されました。更新してからお試しください。');}
 return finish(ctx,body,result,false);
}
function input(ctx,body){if(!body||typeof body!=='object'||Array.isArray(body))ctx.helpers.fail(400,'INVALID_INPUT','送信内容を確認してください。');body.requestId=id(ctx.helpers,body.requestId,'操作番号');return body;}
async function saved(ctx,body){
 const {helpers:h,db,user}=ctx;id(h,body.deviceId,'操作端末');integer(h,body.expectedRevision,'保存番号',0,1000000000);
 const row=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 const save=h.normalizeGameSave(JSON.parse(row.save_json),user,ctx.now,{reading:true,clock});
 if(!save.state.worldClock||Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)h.fail(409,'CLOCK_STALE','本拠と共通時計を同期してください。');
 const guard={sql:'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)',args:[user.id,body.expectedRevision,body.deviceId,ctx.now,h.worldClockId||'world-v1',clock.revision]};
 return{row,clock,save,guard};
}
function saveStatement(ctx,body,save,gate,args){return stmt(ctx.db,'UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND '+gate,JSON.stringify(save),ctx.now,ctx.now+(ctx.helpers.syncLease||30000),ctx.user.id,...args);}
function contribution(db,key,guildId,userId,kind,amount,detail,now,gate='1=1',args=[]){return stmt(db,'INSERT INTO alliance_contributions(id,guild_id,user_id,kind,amount,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE '+gate+' ON CONFLICT(id) DO NOTHING',key,guildId,userId,kind,amount,detail,now,...args);}
function unitGuard(unit){return{sql:"EXISTS(SELECT 1 FROM alliance_units WHERE id=? AND revision=? AND state=? AND troops=?)",args:[unit.id,unit.revision,unit.state,unit.troops]};}
function unitLiveSql(alias='u'){return alias+".state='stationed' AND "+alias+".expires_at>? AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id="+alias+".owner_id AND gm.guild_id="+alias+".guild_id) AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id="+alias+".owner_id),0)="+alias+".owner_epoch AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id="+alias+".owner_id AND active=1)";}
function rosterGuard(units,now){
 // D1 accepts at most 100 bindings in one statement. A single JSON snapshot
 // keeps the atomic roster check bounded even when 200 aid units participate.
 return{sql:"NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN alliance_units u ON u.id=json_extract(snapshot.value,'$.id') WHERE u.id IS NULL OR u.revision<>json_extract(snapshot.value,'$.revision') OR u.troops<>json_extract(snapshot.value,'$.troops') OR NOT ("+unitLiveSql('u')+"))",args:[JSON.stringify(units.map(u=>({id:u.id,revision:u.revision,troops:u.troops}))),now]};
}
async function settleUnits(db,now,userId=null){
 // Expiry or a changed membership never deletes escrow. It becomes claimable.
 const scope=userId?' AND (u.owner_id=? OR u.target_id=?)':'';
 await stmt(db,"UPDATE alliance_units AS u SET state='returning',revision=revision+1 WHERE u.state='stationed' AND u.march_id IS NULL"+scope+" AND (u.expires_at<=? OR NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=u.owner_id AND gm.guild_id=u.guild_id) OR COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.owner_id),0)<>u.owner_epoch OR NOT EXISTS(SELECT 1 FROM guilds g WHERE g.id=u.guild_id) OR EXISTS(SELECT 1 FROM player_bans WHERE user_id=u.owner_id AND active=1) OR (u.kind='aid' AND (NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=u.target_id AND gm.guild_id=u.guild_id) OR COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.target_id),0)<>u.target_epoch OR EXISTS(SELECT 1 FROM player_bans WHERE user_id=u.target_id AND active=1) OR NOT EXISTS(SELECT 1 FROM player_saves ps WHERE ps.user_id=u.target_id AND json_extract(ps.save_json,'$.state.castles.'||u.castle_id||'.owner')=json_extract(ps.save_json,'$.state.clan')))) OR (u.kind='rally' AND NOT EXISTS(SELECT 1 FROM alliance_operations o WHERE o.id=u.operation_id AND o.status='planned' AND o.expires_at>?)))",...(userId?[userId,userId]:[]),now,now).run();
}
export async function assertGuildJoinAllowed(ctx,guildId){
 const {db,user,helpers:h}=ctx,p=await policy(db,guildId);if(p.joinMode==='open')return p.guard;
 const app=await stmt(db,"SELECT * FROM alliance_applications WHERE guild_id=? AND user_id=? AND status IN ('approved','invited') AND expires_at>?",guildId,user.id,ctx.now).first();
 if(!app)h.fail(403,p.joinMode==='invite'?'GUILD_INVITE_REQUIRED':'GUILD_APPLICATION_REQUIRED',p.joinMode==='invite'?'この同盟は招待制です。':'この同盟は加入申請の承認が必要です。');
 return and(p.guard,{sql:"EXISTS(SELECT 1 FROM alliance_applications WHERE guild_id=? AND user_id=? AND revision=? AND status IN ('approved','invited') AND expires_at>?)",args:[guildId,user.id,app.revision,ctx.now]});
}
export async function treasuryGuard(ctx,body){
 if(body.direction!=='withdraw')return{...emptyGuard(),statements:()=>[]};
 const {db,user,helpers:h,now}=ctx,m=await requireMember(ctx),p=await policy(db,body.guildId);
 const owner=m.owner_id===user.id,officer=owner||!!m.officer;
 if(!owner&&now-m.joined_at<p.newcomerHours*3600000)h.fail(403,'TREASURY_NEW_MEMBER','加入直後の出金待機期間です。');
 const approval=await stmt(db,"SELECT * FROM alliance_withdrawals WHERE actor_id=? AND transfer_request_id=? AND guild_id=? AND status='approved' AND resource=? AND amount=? AND actor_epoch=? AND expires_at>?",user.id,body.requestId,body.guildId,body.resource,body.amount,m.epoch,now).first();
 const needsApproval=!owner&&(body.amount>p.approvalThreshold||p.withdrawRole==='owner'||p.withdrawRole==='officers'&&!officer);
 if(needsApproval&&!approval)h.fail(403,'TREASURY_APPROVAL_REQUIRED','同盟作戦の金庫管理から出金申請を送り、盟主の承認を受けてください。');
 const limitGuard={sql:"COALESCE((SELECT SUM(amount) FROM guild_asset_requests WHERE guild_id=? AND actor_id=? AND direction='withdraw' AND created_at>=?),0)+?<=?",args:[body.guildId,user.id,dayStart(now),body.amount,p.dailyLimit]};
 const total=await stmt(db,"SELECT COALESCE(SUM(amount),0) AS n FROM guild_asset_requests WHERE guild_id=? AND actor_id=? AND direction='withdraw' AND created_at>=?",body.guildId,user.id,dayStart(now)).first();
 if(!owner&&Number(total.n)+body.amount>p.dailyLimit)h.fail(409,'TREASURY_DAILY_LIMIT','本日の出金上限に達しています。日本時間0時に更新されます。');
 const approvalGuard=needsApproval?{sql:"EXISTS(SELECT 1 FROM alliance_withdrawals WHERE id=? AND revision=? AND status='approved' AND expires_at>?)",args:[approval.id,approval.revision,now]}:emptyGuard();
 return{...and(p.guard,memberGuard(m),owner?emptyGuard():limitGuard,approvalGuard),statements:(gate,args)=>[
 ...(approval?[stmt(db,"UPDATE alliance_withdrawals SET status='used',revision=revision+1 WHERE id=? AND "+gate,approval.id,...args)]:[]),
 ]};
}
export function treasuryContributionStatements(db,user,body,now,gate,args){return body.direction==='deposit'?[contribution(db,'treasury:'+user.id+':'+body.requestId,body.guildId,user.id,'treasury',body.amount,body.resource+'を寄付',now,gate,args)]:[];}
async function status(ctx){
 const {db,user,helpers:h,now}=ctx;await settleUnits(db,now,user.id);
 const current=await h.getUser(db,user.id),m=current.guild_id?await membership(db,user.id,current.guild_id):null;
 const own=rows(await stmt(db,'SELECT u.*,p.name AS owner_name,t.name AS target_name FROM alliance_units u JOIN users p ON p.id=u.owner_id LEFT JOIN users t ON t.id=u.target_id WHERE u.owner_id=? AND u.state<>? ORDER BY u.created_at DESC LIMIT 100',user.id,'claimed').all());
 const directory=rows(await stmt(db,'SELECT g.id,g.name,COUNT(gm.user_id) AS members,p.join_mode,p.description,p.activity FROM guilds g LEFT JOIN guild_members gm ON gm.guild_id=g.id LEFT JOIN alliance_policies p ON p.guild_id=g.id GROUP BY g.id ORDER BY members DESC,g.name LIMIT 100').all()).map(g=>({id:g.id,name:g.name,members:g.members,joinMode:g.join_mode||'open',description:g.description||'',activity:g.activity||''}));
 const applications=rows(await stmt(db,'SELECT a.*,g.name AS guild_name,u.name AS player_name FROM alliance_applications a JOIN guilds g ON g.id=a.guild_id JOIN users u ON u.id=a.user_id WHERE a.user_id=? OR (a.guild_id=? AND ?=1) ORDER BY a.updated_at DESC LIMIT 100',user.id,m?.guild_id||'',m&&(m.owner_id===user.id||m.officer)?1:0).all());
 if(!m){await h.requireAccountAccess(db,user);return{ok:true,guild:null,policy:null,operations:[],members:[],units:own.map(unitDto),directory,applications:applications.map(applicationDto),withdrawals:[],contributions:[],serverNow:now};}
 const ops=rows(await stmt(db,'SELECT * FROM alliance_operations WHERE guild_id=? ORDER BY created_at DESC LIMIT 50',m.guild_id).all());
 const marchRows=rows(await stmt(db,"SELECT bm.* FROM battle_marches bm JOIN alliance_operations o ON o.march_id=bm.id WHERE o.guild_id=? AND bm.status='marching'",m.guild_id).all()),worldClock=await h.getWorldClock(db,now),marchMap=new Map(marchRows.map(row=>[row.id,marchDto(row,worldClock,now)]));
 const rsvps=rows(await stmt(db,'SELECT r.*,u.name FROM alliance_rsvps r JOIN users u ON u.id=r.user_id JOIN alliance_operations o ON o.id=r.operation_id WHERE o.guild_id=? AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=r.user_id AND gm.guild_id=o.guild_id)',m.guild_id).all());
 const members=rows(await stmt(db,'SELECT gm.user_id AS id,u.name,gm.joined_at,EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=gm.user_id AND go.guild_id=gm.guild_id) AS officer FROM guild_members gm JOIN users u ON u.id=gm.user_id WHERE gm.guild_id=? ORDER BY gm.joined_at',m.guild_id).all()).map(p=>({id:p.id,name:p.name,role:p.id===m.owner_id?'owner':p.officer?'officer':'member',joinedAt:p.joined_at}));
 const units=rows(await stmt(db,"SELECT u.*,p.name AS owner_name,t.name AS target_name FROM alliance_units u JOIN users p ON p.id=u.owner_id LEFT JOIN users t ON t.id=u.target_id WHERE u.guild_id=? AND u.state='stationed' ORDER BY u.created_at DESC LIMIT 200",m.guild_id).all());
 const withdrawals=rows(await stmt(db,"SELECT w.*,u.name AS player_name FROM alliance_withdrawals w JOIN users u ON u.id=w.actor_id WHERE w.guild_id=? AND (w.actor_id=? OR ?=1) ORDER BY w.created_at DESC LIMIT 100",m.guild_id,user.id,m.owner_id===user.id?1:0).all());
 const contributions=rows(await stmt(db,'SELECT c.*,u.name FROM alliance_contributions c JOIN users u ON u.id=c.user_id WHERE c.guild_id=? ORDER BY c.created_at DESC LIMIT 100',m.guild_id).all()).map(c=>({id:c.id,playerId:c.user_id,name:c.name,kind:c.kind,amount:c.amount,detail:c.detail,createdAt:c.created_at}));
 const guard=m.owner_id===user.id?officerGuard(m,true):m.officer?officerGuard(m):memberGuard(m);if(!await stmt(db,'SELECT 1 AS ok WHERE '+guard.sql,...guard.args).first())h.fail(409,'ALLIANCE_STATE_CHANGED','同盟の所属・役職が変わりました。');
 await h.requireAccountAccess(db,user);
 return{ok:true,guild:{id:m.guild_id,name:current.guild_name,role:m.owner_id===user.id?'owner':m.officer?'officer':'member'},policy:policyDto(await stmt(db,'SELECT * FROM alliance_policies WHERE guild_id=?',m.guild_id).first()),operations:ops.map(o=>({...operationDto(o),march:o.march_id?marchMap.get(o.march_id)||null:null,rsvps:rsvps.filter(r=>r.operation_id===o.id).map(r=>({playerId:r.user_id,name:r.name,response:r.response})),troops:units.filter(u=>u.operation_id===o.id).reduce((s,u)=>s+u.troops,0)})),members,units:[...new Map([...own,...units].map(u=>[u.id,unitDto(u)])).values()],directory,applications:applications.map(applicationDto),withdrawals:withdrawals.map(withdrawalDto),contributions,serverNow:now};
}
const operationDto=o=>({id:o.id,title:o.title,note:o.note,kind:o.kind,creatorId:o.creator_id,targetPlayerId:o.target_player_id,castleId:o.castle_id,castleName:cast(o.castle_id)?.name||o.castle_id,branchId:o.branch_id,tactic:o.tactic,startsAt:o.starts_at,expiresAt:o.expires_at,status:o.status,assignments:JSON.parse(o.assignments_json),result:o.result_json?JSON.parse(o.result_json):null,revision:o.revision});
const unitDto=u=>({id:u.id,ownerId:u.owner_id,ownerName:u.owner_name||'',targetPlayerId:u.target_id,targetName:u.target_name||'',castleId:u.castle_id,castleName:cast(u.castle_id)?.name||u.castle_id,operationId:u.operation_id,marchId:u.march_id||null,kind:u.kind,state:u.march_id?'marching':u.state,troops:u.troops,sent:u.sent,expiresAt:u.expires_at,revision:u.revision});
const applicationDto=a=>({guildId:a.guild_id,guildName:a.guild_name,playerId:a.user_id,name:a.player_name,status:a.status,message:a.message,expiresAt:a.expires_at,revision:a.revision});
const withdrawalDto=w=>({id:w.id,playerId:w.actor_id,name:w.player_name,resource:w.resource,amount:w.amount,status:w.status,transferRequestId:w.transfer_request_id,expiresAt:w.expires_at,revision:w.revision});

async function updatePolicy(ctx,b){
 const {db,helpers:h}=ctx,m=await requireMember(ctx,true),p=await policy(db,m.guild_id);
 integer(h,b.revision,'設定番号',0,1000000000);if(b.revision!==p.revision)h.fail(409,'ALLIANCE_STATE_CHANGED','同盟の設定が更新されています。');
 if(!['open','approval','invite'].includes(b.joinMode)||!['all','officers','owner'].includes(b.withdrawRole))h.fail(400,'INVALID_INPUT','加入方法と出金できる役職を選んでください。');
 const desc=text(h,b.description,'募集文',300,true),activity=text(h,b.activity,'活動時間',80,true);
 integer(h,b.dailyLimit,'1日の出金上限',0,100000000);integer(h,b.approvalThreshold,'承認が必要な金額',0,1000000);integer(h,b.newcomerHours,'加入後の待機時間',0,168);
 return commit(ctx,b,'policy',and(officerGuard(m,true),p.guard),(gate,args)=>[stmt(db,'INSERT INTO alliance_policies(guild_id,join_mode,description,activity,withdraw_role,daily_limit,approval_threshold,newcomer_hours,revision) SELECT ?,?,?,?,?,?,?,?,1 WHERE '+gate+' ON CONFLICT(guild_id) DO UPDATE SET join_mode=excluded.join_mode,description=excluded.description,activity=excluded.activity,withdraw_role=excluded.withdraw_role,daily_limit=excluded.daily_limit,approval_threshold=excluded.approval_threshold,newcomer_hours=excluded.newcomer_hours,revision=alliance_policies.revision+1',m.guild_id,b.joinMode,desc,activity,b.withdrawRole,b.dailyLimit,b.approvalThreshold,b.newcomerHours,...args)],{message:'同盟の募集・金庫ルールを保存しました。'});
}
async function application(ctx,b,action){
 const {db,user,helpers:h,now}=ctx,guildId=id(h,b.guildId,'同盟'),p=await policy(db,guildId);
 if(!await stmt(db,'SELECT id FROM guilds WHERE id=?',guildId).first())h.fail(404,'GUILD_NOT_FOUND','同盟が見つかりません。');
 let targetId=user.id,state='pending',guard=p.guard,message='';
 if(action==='apply'){
  if(user.guild_id)h.fail(409,'ALREADY_IN_GUILD','現在の同盟を脱退してから申請してください。');
  if(p.joinMode==='invite')h.fail(403,'GUILD_INVITE_REQUIRED','この同盟は招待制です。');
  message=text(h,b.message,'ひとこと',200,true);
  if(message){const register=await h.resolveMessageRegister(db,user,{kind:'guild-officers',id:guildId},now);message=await register.write(message);guard=and(guard,register.guard);}
  guard=and(guard,{sql:'NOT EXISTS(SELECT 1 FROM guild_members WHERE user_id=?)',args:[user.id]});
 }else{
  const m=await requireMember(ctx,false,true);if(m.guild_id!==guildId)h.fail(403,'GUILD_REQUIRED','所属同盟で操作してください。');
  targetId=id(h,b.playerId,'対象の領主');if(targetId===user.id)h.fail(400,'INVALID_TARGET','別の領主を選んでください。');
  const target=await h.getUser(db,targetId);if(!target||target.ban_active)h.fail(404,'PLAYER_NOT_FOUND','対象の領主を確認できません。');
  if(action==='invite'){if(target.guild_id)h.fail(409,'ALREADY_IN_GUILD','対象の領主は同盟に所属しています。');state='invited';}
  else{if(!['approve','deny'].includes(b.decision))h.fail(400,'INVALID_INPUT','承認か辞退を選んでください。');const old=await stmt(db,"SELECT * FROM alliance_applications WHERE guild_id=? AND user_id=? AND status='pending' AND expires_at>?",guildId,targetId,now).first();if(!old)h.fail(409,'APPLICATION_CHANGED','申請が見つからないか、期限切れです。');state=b.decision==='approve'?'approved':'denied';guard=and(guard,{sql:"EXISTS(SELECT 1 FROM alliance_applications WHERE guild_id=? AND user_id=? AND revision=? AND status='pending')",args:[guildId,targetId,old.revision]});message=old.message;}
  guard=and(guard,officerGuard(m),h.accountCommitGuard(target),state==='denied'?emptyGuard():{sql:'NOT EXISTS(SELECT 1 FROM guild_members WHERE user_id=?)',args:[targetId]});
 }
 return commit(ctx,b,action,guard,(gate,args)=>[stmt(db,'INSERT INTO alliance_applications(guild_id,user_id,status,message,created_at,updated_at,expires_at,revision) SELECT ?,?,?,?,?,?,?,1 WHERE '+gate+' ON CONFLICT(guild_id,user_id) DO UPDATE SET status=excluded.status,message=excluded.message,updated_at=excluded.updated_at,expires_at=excluded.expires_at,revision=alliance_applications.revision+1',guildId,targetId,state,message,now,now,now+7*DAY,...args)],{message:state==='pending'?'加入申請を送りました。':state==='invited'?'招待を送りました。':state==='approved'?'申請を承認しました。本人が参加すると加入が完了します。':'申請を辞退しました。'});
}
async function getOperation(ctx,b){const o=await stmt(ctx.db,'SELECT * FROM alliance_operations WHERE id=? AND guild_id=?',id(ctx.helpers,b.operationId,'作戦'),ctx.user.guild_id).first();if(!o)ctx.helpers.fail(404,'OPERATION_NOT_FOUND','所属同盟の作戦が見つかりません。');return o;}
function opGuard(o){return{sql:'EXISTS(SELECT 1 FROM alliance_operations WHERE id=? AND revision=? AND status=?)',args:[o.id,o.revision,o.status]};}
async function createOperation(ctx,b){
 const {db,user,helpers:h,now}=ctx,m=await requireMember(ctx),title=text(h,b.title,'作戦名',60),note=text(h,b.note,'作戦内容',500,true),castleId=id(h,b.castleId,'城');
 if(!cast(castleId)||!['attack','defend','gather'].includes(b.kind)||!['balanced','assault','siege','ambush'].includes(b.tactic||'balanced'))h.fail(400,'INVALID_INPUT','作戦の種類・城・戦法を選んでください。');
 const startsAt=integer(h,b.startsAt,'開始日時',now-60000,now+30*DAY),expiresAt=integer(h,b.expiresAt,'終了日時',Math.max(now+60000,startsAt+60000),Math.min(now+31*DAY,startsAt+DAY));
 const targetId=b.targetPlayerId?id(h,b.targetPlayerId,'対象の領主'):null,branchId=b.branchId?id(h,b.branchId,'支拠点'):null;
 if(b.kind==='attack'&&!targetId)h.fail(400,'TARGET_REQUIRED','集結攻撃では相手の領主を選んでください。');
 if(targetId){const target=await h.getUser(db,targetId);if(!target||target.ban_active)h.fail(404,'PLAYER_NOT_FOUND','対象の領主が見つかりません。');if(b.kind==='attack'&&target.guild_id===m.guild_id)h.fail(409,'ALLIED_TARGET','同じ同盟の領主へ攻撃作戦は作成できません。');}
 if(branchId&&branchId!==castleId+'_north'&&branchId!==castleId+'_east'&&branchId!==castleId+'_south'&&branchId!==castleId+'_west')h.fail(400,'INVALID_INPUT','対象都市の支拠点を選んでください。');
 const operationId='ao_'+crypto.randomUUID().replaceAll('-',''),limit={sql:"(SELECT COUNT(*) FROM alliance_operations WHERE guild_id=? AND status='planned' AND expires_at>?)<30",args:[m.guild_id,now]};
 const register=note?await h.resolveMessageRegister(db,user,{kind:'guild',id:m.guild_id},now):null;
 const spokenNote=register?await register.write(note):note;
 return commit(ctx,b,'operation-create',and(memberGuard(m),limit,register?.guard||emptyGuard()),(gate,args)=>[stmt(db,'INSERT INTO alliance_operations(id,guild_id,creator_id,title,note,kind,target_player_id,castle_id,branch_id,tactic,starts_at,expires_at,created_at,resolution_seed) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE '+gate,operationId,m.guild_id,user.id,title,spokenNote,b.kind,targetId,castleId,branchId,b.tactic||'balanced',startsAt,expiresAt,now,crypto.randomUUID(),...args)],{operationId,message:'作戦と同盟専用の地図マークを登録しました。'});
}
async function updateOperation(ctx,b,action){
 const {db,user,helpers:h}=ctx,m=await requireMember(ctx),o=await getOperation(ctx,b);
 if(o.status!=='planned'||o.expires_at<=ctx.now)h.fail(409,'OPERATION_CLOSED','この作戦は終了しています。');
 if(action==='operation-rsvp'){
  if(!['yes','maybe','no'].includes(b.response))h.fail(400,'INVALID_INPUT','参加予定を選んでください。');
  return commit(ctx,b,action,and(memberGuard(m),opGuard(o)),(gate,args)=>[stmt(db,'INSERT INTO alliance_rsvps(operation_id,user_id,response,updated_at) SELECT ?,?,?,? WHERE '+gate+' ON CONFLICT(operation_id,user_id) DO UPDATE SET response=excluded.response,updated_at=excluded.updated_at',o.id,user.id,b.response,ctx.now,...args)],{message:'参加予定を更新しました。'});
 }
 const organizer=o.creator_id===user.id||m.owner_id===user.id||m.officer;
 if(o.march_id)h.fail(409,'ARMY_MARCHING','この作戦は出陣済みです。到着後に結果をご確認ください。');
 if(action==='operation-assign'){
  const assignments=JSON.parse(o.assignments_json),assignmentId=b.assignmentId?id(h,b.assignmentId,'担当項目'):null;let assignmentGuard=emptyGuard();
  if(assignmentId&&typeof b.done==='boolean'){
   const assignment=assignments.find(a=>a.id===assignmentId);if(!assignment)h.fail(404,'ASSIGNMENT_NOT_FOUND','担当項目が見つかりません。');
   if(assignment.playerId!==user.id&&!organizer)h.fail(403,'GUILD_ROLE_REQUIRED','本人または作戦の担当者が変更できます。');assignment.done=b.done;
  }else{
   if(!organizer)h.fail(403,'GUILD_ROLE_REQUIRED','作戦を作った領主または同盟役職者が担当を設定できます。');
   const playerId=id(h,b.playerId,'担当の領主'),target=await membership(db,playerId,m.guild_id);if(!target)h.fail(400,'GUILD_REQUIRED','同盟のメンバーを選んでください。');assignmentGuard=memberGuard(target);
   if(assignments.length>=12)h.fail(409,'ASSIGNMENT_LIMIT','担当項目は作戦ごとに12件までです。');
   assignments.push({id:'task_'+crypto.randomUUID().replaceAll('-',''),playerId,label:text(h,b.label,'担当内容',80),done:false});
  }
  const roleGuard=organizer&&o.creator_id!==user.id?officerGuard(m):memberGuard(m);
  return commit(ctx,b,action,and(roleGuard,assignmentGuard,opGuard(o)),(gate,args)=>[stmt(db,'UPDATE alliance_operations SET assignments_json=?,revision=revision+1 WHERE id=? AND '+gate,JSON.stringify(assignments),o.id,...args)],{message:'担当と進行状況を更新しました。'});
 }
 if(!organizer)h.fail(403,'GUILD_ROLE_REQUIRED','作戦を作った領主または同盟役職者が終了できます。');
 const next=action==='operation-cancel'?'cancelled':'completed';
 return commit(ctx,b,action,and(o.creator_id===user.id?memberGuard(m):officerGuard(m),opGuard(o)),(gate,args)=>[
 stmt(db,'UPDATE alliance_operations SET status=?,revision=revision+1 WHERE id=? AND '+gate,next,o.id,...args),
 stmt(db,"UPDATE alliance_units SET state='returning',revision=revision+1 WHERE operation_id=? AND state='stationed' AND "+gate,o.id,...args),
 ],{message:next==='cancelled'?'作戦を取り下げました。集結中の兵は受取待ちへ戻ります。':'作戦を完了しました。集結中の兵は受取待ちへ戻ります。'});
}
async function sendUnits(ctx,b,kind){
 const {db,user,helpers:h,now}=ctx,m=await requireMember(ctx),troops=integer(h,b.troops,'派遣兵数',1,50000);let targetId=null,targetEpoch=null,castleId,operationId=null,expiresAt,extra=emptyGuard();
 if(kind==='rally'){
  const o=await getOperation(ctx,b);if(o.kind!=='attack'||o.status!=='planned'||o.march_id||o.expires_at<=now)h.fail(409,'OPERATION_CLOSED','集結できる攻撃作戦を選んでください。');
  operationId=o.id;castleId=o.castle_id;targetId=o.target_player_id;expiresAt=o.expires_at;extra=and(opGuard(o),{sql:"COALESCE((SELECT SUM(troops) FROM alliance_units WHERE operation_id=? AND state='stationed'),0)+?<=? AND (SELECT COUNT(*) FROM alliance_units WHERE operation_id=? AND state='stationed')<50",args:[o.id,troops,MAX_RALLY,o.id]});
 }else{
  targetId=id(h,b.targetPlayerId,'援軍先');castleId=id(h,b.castleId,'守備する城');if(targetId===user.id)h.fail(400,'INVALID_TARGET','援軍は同盟の仲間へ派遣してください。');
  const target=await membership(db,targetId,m.guild_id);if(!target)h.fail(403,'GUILD_REQUIRED','援軍を送れるのは同じ同盟の領主です。');targetEpoch=target.epoch;
  const targetUser=await h.getUser(db,targetId),targetRow=await h.getSyncRow(db,targetId);if(!targetRow?.save_json||targetUser.ban_active)h.fail(409,'BASE_UNAVAILABLE','相手の本拠がまだ共有されていません。');
  const ts=JSON.parse(targetRow.save_json).state;if(!cast(castleId)||ts.castles[castleId]?.owner!==ts.clan)h.fail(409,'FIELD_TARGET_CHANGED','相手が所有する城を選んでください。');
  expiresAt=now+integer(h,b.hours??6,'駐屯時間',1,24)*3600000;extra=and(memberGuard(target),h.accountCommitGuard(targetUser),{sql:"EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND COALESCE((SELECT SUM(troops) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?),0)+?<=? AND (SELECT COUNT(*) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?)<200",args:[targetId,targetRow.revision,targetId,castleId,now,troops,100000,targetId,castleId,now]});
 }
 const state=await saved(ctx,b);if(state.save.state.troops<troops)h.fail(409,'INSUFFICIENT_FORCE','本隊の兵数が足りません。');
 if(state.save.state.gameOver)h.fail(409,'BASE_UNAVAILABLE','本拠を失っている間は兵を派遣できません。');
 state.save.state.troops-=troops;const unitId='au_'+crypto.randomUUID().replaceAll('-',''),limit={sql:"(SELECT COUNT(*) FROM alliance_units WHERE owner_id=? AND state<>'claimed')<?",args:[user.id,MAX_UNITS]};
 return commit(ctx,b,kind==='rally'?'rally-join':'aid-send',and(memberGuard(m),state.guard,extra,limit),(gate,args)=>[
 saveStatement(ctx,b,state.save,gate,args),
 stmt(db,"INSERT INTO alliance_units(id,guild_id,owner_id,owner_epoch,target_id,target_epoch,castle_id,operation_id,kind,state,troops,sent,expires_at,created_at) SELECT ?,?,?,?,?,?,?,?,?,'stationed',?,?,?,? WHERE "+gate,unitId,m.guild_id,user.id,m.epoch,targetId,targetEpoch,castleId,operationId,kind,troops,troops,expiresAt,now,...args),
 contribution(db,'send:'+unitId,m.guild_id,user.id,kind==='rally'?'rally':'aid',troops,kind==='rally'?'集結に兵を提供':'仲間の城へ援軍',now,gate,args),
 ],{unitId,message:kind==='rally'?'兵を集結へ派遣しました。出陣後の生存兵は各参加者へ戻ります。':'援軍を派遣しました。期限・脱退・撤収で生存兵が受取待ちへ戻ります。'});
}
async function unitsAction(ctx,b,action){
 const {db,user,helpers:h}=ctx;await settleUnits(db,ctx.now,user.id);const unit=await stmt(db,'SELECT * FROM alliance_units WHERE id=? AND owner_id=?',id(h,b.unitId,'部隊'),user.id).first();if(!unit)h.fail(404,'UNIT_NOT_FOUND','自分の派遣部隊を選んでください。');
 if(unit.march_id)h.fail(409,'ARMY_MARCHING','この部隊は進軍中です。到着して生存兵が戻るまでお待ちください。');
 if(action==='unit-recall'){
  if(unit.state==='claimed')h.fail(409,'UNIT_RETURNED','この部隊は帰還済みです。');
  return commit(ctx,b,action,unitGuard(unit),(gate,args)=>[stmt(db,"UPDATE alliance_units SET state='returning',revision=revision+1 WHERE id=? AND "+gate,unit.id,...args)],{message:'撤収しました。生存兵を「本隊へ受取」で戻せます。'});
 }
 if(unit.state!=='returning')h.fail(409,'UNIT_NOT_RETURNED','部隊が帰還待ちになってから受け取れます。');
 const s=await saved(ctx,b),shared=user.is_staff&&!user.is_admin&&h.staffBaseDto?await h.staffBaseDto(db,user,s.clock,ctx.now):null;
 const game=GameEngine.fromSave(s.save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase:shared});
 const room=Math.max(0,Math.min(ASSET_LIMIT,game.availableTroopCapacity?game.availableTroopCapacity():game.troopCapacity())-s.save.state.troops),amount=Math.min(unit.troops,room);
 if(unit.troops>0&&amount<=0)h.fail(409,'TROOP_CAPACITY','本隊の収容力が不足しています。兵舎を増築するか本隊に空きを作ってください。残りの兵は保管されます。');
 s.save.state.troops+=amount;
 return commit(ctx,b,action,and(unitGuard(unit),s.guard),(gate,args)=>[
 saveStatement(ctx,b,s.save,gate,args),
 stmt(db,'UPDATE alliance_units SET troops=troops-?,state=?,revision=revision+1 WHERE id=? AND '+gate,amount,amount===unit.troops?'claimed':'returning',unit.id,...args),
 ],{receivedTroops:amount,remainingTroops:unit.troops-amount,message:amount+'人が本隊へ帰還しました。'+(unit.troops>amount?'収容できない兵は受取待ちに残しています。':'')});
}
async function withdrawAction(ctx,b,action){
 const {db,user,helpers:h,now}=ctx,m=await requireMember(ctx);
 if(action==='treasury-request'){
  if(!['gold','rice','wood','stone','magatama'].includes(b.resource))h.fail(400,'INVALID_INPUT','出金する資産を選んでください。');
  const amount=integer(h,b.amount,'出金数量',1,1000000),transferRequestId=id(h,b.transferRequestId,'出金の操作番号'),wid='aw_'+crypto.randomUUID().replaceAll('-','');
  const limit={sql:"(SELECT COUNT(*) FROM alliance_withdrawals WHERE actor_id=? AND status='pending' AND expires_at>?)<10",args:[user.id,now]};
  return commit(ctx,b,action,and(memberGuard(m),limit),(gate,args)=>[stmt(db,"INSERT INTO alliance_withdrawals(id,guild_id,actor_id,actor_epoch,transfer_request_id,resource,amount,status,created_at,expires_at) SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE "+gate,wid,m.guild_id,user.id,m.epoch,transferRequestId,b.resource,amount,now,now+DAY,...args)],{withdrawalId:wid,message:'盟主へ出金申請を送りました。承認後、この画面から受け取れます。'});
 }
 if(m.owner_id!==user.id)h.fail(403,'GUILD_ROLE_REQUIRED','盟主だけが出金申請を承認できます。');
 const w=await stmt(db,"SELECT * FROM alliance_withdrawals WHERE id=? AND guild_id=? AND status='pending' AND expires_at>?",id(h,b.withdrawalId,'出金申請'),m.guild_id,now).first();
 if(!w)h.fail(409,'WITHDRAWAL_CHANGED','出金申請は処理済みか期限切れです。');if(!['approve','deny'].includes(b.decision))h.fail(400,'INVALID_INPUT','承認または辞退を選んでください。');
 const target=await membership(db,w.actor_id,m.guild_id);if(!target||target.epoch!==w.actor_epoch)h.fail(409,'GUILD_MEMBERSHIP_CHANGED','申請者の所属が変わっています。');
 return commit(ctx,b,action,and(officerGuard(m,true),memberGuard(target),{sql:"EXISTS(SELECT 1 FROM alliance_withdrawals WHERE id=? AND revision=? AND status='pending')",args:[w.id,w.revision]}),(gate,args)=>[stmt(db,'UPDATE alliance_withdrawals SET status=?,approved_by=?,revision=revision+1 WHERE id=? AND '+gate,b.decision==='approve'?'approved':'denied',user.id,w.id,...args)],{message:b.decision==='approve'?'出金を承認しました。申請者が受取操作を行うと移動します。':'出金申請を辞退しました。'});
}

// Called only by the internal fifth argument to fieldAttack. The caller first
// uses the original target/branch/protection/court rules, then adds force to its
// calculation; the frozen guard and statements join the same battle receipt.
export async function prepareRallyAttack(db,user,operationId,now,h,frozen=null){
 const ctx={db,user,now,helpers:h};await settleUnits(db,now);const m=await requireMember(ctx),o=await getOperation(ctx,{operationId});
 if(o.kind!=='attack'||o.status!=='planned'||(frozen?o.march_id!==frozen.marchId:o.march_id||o.starts_at>now||o.expires_at<=now))h.fail(409,'RALLY_NOT_READY','作戦の開始時刻から終了時刻までに出陣してください。');
 if(o.creator_id!==user.id&&m.owner_id!==user.id&&!m.officer)h.fail(403,'GUILD_ROLE_REQUIRED','作戦を作った領主または同盟役職者が出陣できます。');
 const units=rows(await stmt(db,"SELECT u.* FROM alliance_units u WHERE u.operation_id=? AND "+(frozen?"u.state='stationed' AND u.march_id=?":unitLiveSql('u'))+' ORDER BY u.id LIMIT 51',o.id,frozen?frozen.marchId:now).all());
 if(frozen&&(units.length!==frozen.units.length||units.some(u=>!frozen.units.some(v=>v.id===u.id&&v.troops===u.troops&&v.revision+1===u.revision))))h.fail(409,'RALLY_CHANGED','進軍中の集結部隊が変わったため帰還しました。');
 const frozenRoster={sql:"NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN alliance_units u ON u.id=json_extract(snapshot.value,'$.id') WHERE u.id IS NULL OR u.revision<>json_extract(snapshot.value,'$.revision') OR u.troops<>json_extract(snapshot.value,'$.troops') OR u.state<>'stationed' OR u.march_id<>? OR NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=u.owner_id AND gm.guild_id=u.guild_id) OR COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.owner_id),0)<>u.owner_epoch OR EXISTS(SELECT 1 FROM player_bans WHERE user_id=u.owner_id AND active=1))",args:[JSON.stringify(units.map(u=>({id:u.id,revision:u.revision,troops:u.troops}))),frozen?.marchId||'']};
 if(frozen){for(const unit of units){const member=await membership(db,unit.owner_id,unit.guild_id);if(!member||member.epoch!==unit.owner_epoch||await stmt(db,'SELECT 1 AS banned FROM player_bans WHERE user_id=? AND active=1',unit.owner_id).first())h.fail(409,'RALLY_CHANGED','参加者の所属が変わったため、各部隊へ兵を返還します。');}}
 const troops=units.reduce((n,u)=>n+u.troops,0);if(units.length>50||troops<300||troops>MAX_RALLY)h.fail(409,'RALLY_FORCE','集結兵は300〜100,000人で出陣できます。');
 const exact={sql:"(SELECT COUNT(*) FROM alliance_units WHERE operation_id=? AND state='stationed')=? AND (SELECT COALESCE(SUM(troops),0) FROM alliance_units WHERE operation_id=? AND state='stationed')=?",args:[o.id,units.length,o.id,troops]};
 const organizer=o.creator_id===user.id?memberGuard(m):officerGuard(m);
 const rollBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['alliance-battle-v1',o.resolution_seed,o.id,units.map(u=>[u.id,u.troops])])));
 const roll=new DataView(rollBytes).getUint32(0)/4294967296;
 let allocation=null;
 return{operationId:o.id,snapshot:{operationId:o.id,units:units.map(u=>({id:u.id,troops:u.troops,revision:u.revision}))},troops,roll,targetPlayerId:o.target_player_id,targetCastleId:o.castle_id,targetBranchId:o.branch_id||undefined,tactic:o.tactic,guard:and(organizer,opGuard(o),exact,frozen?frozenRoster:rosterGuard(units,now)),
  applyResult(battle,attackerState){
   const spent=Math.min(troops,Number(battle.attackerLost||0)+Number(battle.capture?.garrison||0)),returned=troops-spent;
   // Existing capture logic subtracts its new garrison too. Removing the
   // surviving escrow restores the leader's original unpledged standing army.
   attackerState.troops=Math.max(0,attackerState.troops-returned);
   let previous=0,used=0;allocation=units.map((u,i)=>{const end=previous+u.troops;const loss=i===units.length-1?spent-used:Math.floor(end*spent/troops)-Math.floor(previous*spent/troops);previous=end;used+=loss;return{unit:u,returned:u.troops-loss,lost:loss};});
   battle.rally={operationId:o.id,title:o.title,participants:units.length,pooledTroops:troops,returnedTroops:returned,garrison:Math.min(spent,Number(battle.capture?.garrison||0))};
  },
  statements(battle,gate,args){
   if(!allocation)throw Error('Rally result must be allocated before committing');
   return[
    stmt(db,"UPDATE alliance_operations SET status='completed',result_json=?,march_id=NULL,revision=revision+1 WHERE id=? AND "+gate,JSON.stringify({battleId:battle.id,won:battle.won,pooledTroops:troops,attackerLost:battle.attackerLost,castleName:battle.castleName,branchName:battle.branchName||null}),o.id,...args),
    ...allocation.flatMap(a=>[stmt(db,"UPDATE alliance_units SET troops=?,state=?,march_id=NULL,revision=revision+1 WHERE id=? AND "+gate,a.returned,a.returned?'returning':'claimed',a.unit.id,...args),contribution(db,'rally:'+battle.id+':'+a.unit.id,o.guild_id,a.unit.owner_id,'attack',a.unit.troops,o.title+'：'+(battle.won?'勝利':'撤退')+'・生存兵'+a.returned,now,gate,args)]),
   ];
  }};
}
export function rallyMarchStatements(db,rally,marchId,gate,args){
 return [stmt(db,"UPDATE alliance_operations SET march_id=?,revision=revision+1 WHERE id=? AND "+gate,marchId,rally.operationId,...args),stmt(db,"UPDATE alliance_units SET march_id=?,revision=revision+1 WHERE operation_id=? AND state='stationed' AND "+gate,marchId,rally.operationId,...args)];
}
export function rallyMarchCancellation(db,march,gate,args){
 return [stmt(db,"UPDATE alliance_operations SET status='cancelled',march_id=NULL,revision=revision+1 WHERE march_id=? AND "+gate,march.id,...args),stmt(db,"UPDATE alliance_units SET state='returning',march_id=NULL,revision=revision+1 WHERE march_id=? AND state='stationed' AND "+gate,march.id,...args)];
}
export async function getAllianceDefense(db,target,castleId,now){
 await settleUnits(db,now,target.id);const m=target.guild_id?await membership(db,target.id,target.guild_id):null;
 if(!m){const epoch=await stmt(db,'SELECT COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0) AS epoch',target.id).first();return{troops:0,guard:{sql:"NOT EXISTS(SELECT 1 FROM guild_members WHERE user_id=?) AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?)",args:[target.id,target.id,epoch.epoch,target.id,castleId,now]},statements:()=>[]};}
 const units=rows(await stmt(db,"SELECT u.* FROM alliance_units u WHERE u.kind='aid' AND u.target_id=? AND u.castle_id=? AND "+unitLiveSql('u')+' AND u.target_epoch=? ORDER BY u.id LIMIT 201',target.id,castleId,now,m.epoch).all());
 const troops=units.reduce((n,u)=>n+u.troops,0),exact={sql:"(SELECT COUNT(*) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?)=? AND (SELECT COALESCE(SUM(troops),0) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?)=?",args:[target.id,castleId,now,units.length,target.id,castleId,now,troops]};
 const guard=and(memberGuard(m),exact,rosterGuard(units,now));
 return{troops,guard,statements:(battle,gate,args)=>units.flatMap(u=>{
  const loss=battle.battleMode==='reward'||battle.battleMode==='branch'?0:Math.min(u.troops,Math.floor(u.troops*(battle.won?.1:.03))),survivors=u.troops-loss;
  return[stmt(db,'UPDATE alliance_units SET troops=?,state=?,revision=revision+1 WHERE id=? AND '+gate,survivors,survivors?(battle.capture?.captured?'returning':'stationed'):'claimed',u.id,...args),contribution(db,'defense:'+battle.id+':'+u.id,u.guild_id,u.owner_id,'defense',u.troops,battle.castleName+'を援軍で防衛・兵損'+loss,now,gate,args)];
 })};
}
export async function handleAlliance(ctx){
 const {helpers:h,path,method,user,db}=ctx;await h.requireAccountAccess(db,user);
 if(path==='/alliance'&&method==='GET')return status(ctx);
 if(method!=='POST')h.fail(404,'NOT_FOUND','同盟作戦の操作を確認してください。');
 const body=input(ctx,await h.readBody(ctx.request)),actions={
  '/alliance/policy':'policy','/alliance/apply':'apply','/alliance/invite':'invite','/alliance/membership':'membership',
  '/alliance/operations/create':'operation-create','/alliance/operations/rsvp':'operation-rsvp','/alliance/operations/assign':'operation-assign','/alliance/operations/cancel':'operation-cancel','/alliance/operations/complete':'operation-complete',
  '/alliance/rally/join':'rally-join','/alliance/reinforcements/send':'aid-send','/alliance/units/recall':'unit-recall','/alliance/units/claim':'unit-claim',
  '/alliance/treasury/request':'treasury-request','/alliance/treasury/approve':'treasury-approve',
 };
 if(path==='/alliance/rally/launch'){
  const operationId=id(h,body.operationId,'作戦'),o=await getOperation(ctx,{operationId});
  if(!h.fieldAttack)h.fail(503,'RALLY_UNAVAILABLE','集結出陣を準備しています。しばらくしてからお試しください。');
  // Frozen target and tactic come from the operation, not the request body.
  const units=rows(await stmt(db,"SELECT troops FROM alliance_units WHERE operation_id=? AND state='stationed'",operationId).all()),troops=o.result_json?JSON.parse(o.result_json).pooledTroops:units.reduce((n,u)=>n+u.troops,0);
  return h.fieldAttack(db,user,{targetPlayerId:o.target_player_id,targetCastleId:o.castle_id,...(o.branch_id?{targetBranchId:o.branch_id}:{}),troops:Math.max(300,troops),tactic:o.tactic,requestId:body.requestId,deviceId:body.deviceId,expectedRevision:body.expectedRevision},ctx.now,{rallyId:operationId});
 }
 if(path==='/alliance/treasury/claim'){
  const w=await stmt(db,"SELECT * FROM alliance_withdrawals WHERE id=? AND actor_id=? AND guild_id=? AND status IN ('approved','used')",id(h,body.withdrawalId,'出金申請'),user.id,user.guild_id).first();if(!w)h.fail(409,'TREASURY_APPROVAL_REQUIRED','承認済みの自分の出金申請を選んでください。');
  return h.guildTransfer(db,user,{guildId:w.guild_id,direction:'withdraw',resource:w.resource,amount:w.amount,requestId:w.transfer_request_id,deviceId:body.deviceId,expectedRevision:body.expectedRevision},ctx.now);
 }
 const action=actions[path];if(!action)h.fail(404,'NOT_FOUND','その同盟操作は見つかりませんでした。');
 const old=await prior(ctx,body,action);if(old.old)return finish(ctx,body,JSON.parse(old.old.result_json),true);
 await h.budget(db,'alliance:'+user.id,60,60000,ctx.now);
 if(action==='policy')return updatePolicy(ctx,body);
 if(['apply','invite','membership'].includes(action))return application(ctx,body,action);
 if(action==='operation-create')return createOperation(ctx,body);
 if(action.startsWith('operation-'))return updateOperation(ctx,body,action);
 if(action==='rally-join'||action==='aid-send')return sendUnits(ctx,body,action==='rally-join'?'rally':'aid');
 if(action.startsWith('unit-'))return unitsAction(ctx,body,action);
 if(action.startsWith('treasury-'))return withdrawAction(ctx,body,action);
 h.fail(404,'NOT_FOUND','その同盟操作は見つかりませんでした。');
}
