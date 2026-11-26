// Alliance planning, membership rules and troop escrow. All valuable mutations
// share a receipt gate with the player save; a replay never repeats a transfer.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {marchDto,advanceReservedMarch} from './marches.js';
import {prepareResidencyCpuLosses} from './residency.js';
import {externalTroopSnapshotStatements} from './maintenance.js';
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
 if(ctx.maintenanceAdvance){const own=ctx.maintenanceAdvance,personal=await h.staffPersonalProgressStatement(db,user,own.save,ctx.now,GATE,args,own.journey.game.getStaffPersonalProgress?.());if(personal)statements.push(personal);}
 const done=await db.batch(statements);if(!rows(done[0]).length){const retry=await prior(ctx,body,action);if(retry.old)return finish(ctx,body,JSON.parse(retry.old.result_json),true);await h.requireAccountAccess(db,user);h.fail(409,'ALLIANCE_STATE_CHANGED','同盟・部隊・保存の状態が更新されました。更新してからお試しください。');}
 return finish(ctx,body,result,false);
}
function input(ctx,body){if(!body||typeof body!=='object'||Array.isArray(body))ctx.helpers.fail(400,'INVALID_INPUT','送信内容を確認してください。');body.requestId=id(ctx.helpers,body.requestId,'操作番号');return body;}
async function saved(ctx,body){
 const {helpers:h,db,user}=ctx;id(h,body.deviceId,'操作端末');integer(h,body.expectedRevision,'保存番号',0,1000000000);
 const row=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now);
 let save=h.normalizeGameSave(JSON.parse(row.save_json),user,ctx.now,{reading:true,clock});
 if(!save.state.worldClock||Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)h.fail(409,'CLOCK_STALE','本拠と共通時計を同期してください。');
 const guard={sql:'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)',args:[user.id,body.expectedRevision,body.deviceId,ctx.now,h.worldClockId||'world-v1',clock.revision]};
 const journey=await advanceReservedMarch(ctx,row,clock);save=journey.save;
 const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:journey.game.takeHomeDefenseLosses(),now:ctx.now,state:save.state});
 // Statement factories keep every advance side effect under the same receipt.
 ctx.maintenanceAdvance={save,journey};
 const extra=(gate,args)=>[
  ...h.branchProgressStatements(db,user.id,save,ctx.now,gate,args,{resolvedElapsedMs:journey.resolvedElapsedMs}),
  ...h.covertIncidentStatements(db,user.id,save,ctx.now,gate,args),...cpuLosses.statements(gate,args),
  ...h.saveAchievements(journey.before,save).map(event=>h.achievementStatement(db,user.id,event,ctx.now,gate,args)),
  ...externalTroopSnapshotStatements(db,[user.id],clock,gate,args)
 ];
 return{row,clock,save,guard:and(guard,journey.branches.guard,cpuLosses.guard),extra};
}
function saveStatement(ctx,body,save,gate,args){return stmt(ctx.db,'UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND '+gate,JSON.stringify(save),ctx.now,ctx.now+(ctx.helpers.syncLease||30000),ctx.user.id,...args);}
function contribution(db,key,guildId,userId,kind,amount,detail,now,gate='1=1',args=[]){return stmt(db,'INSERT INTO alliance_contributions(id,guild_id,user_id,kind,amount,detail,created_at) SELECT ?,?,?,?,?,?,? WHERE '+gate+' ON CONFLICT(id) DO NOTHING',key,guildId,userId,kind,amount,detail,now,...args);}
function unitGuard(unit){return{sql:"EXISTS(SELECT 1 FROM alliance_units WHERE id=? AND revision=? AND state=? AND troops=?)",args:[unit.id,unit.revision,unit.state,unit.troops]};}
function unitLiveSql(alias='u'){return alias+".state='stationed' AND ("+alias+".travel_phase IS NULL OR "+alias+".travel_phase='stationed') AND "+alias+".march_id IS NULL AND "+alias+".expires_at>? AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id="+alias+".owner_id AND gm.guild_id="+alias+".guild_id) AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id="+alias+".owner_id),0)="+alias+".owner_epoch AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id="+alias+".owner_id AND active=1)";}
function rosterGuard(units,now){
 // D1 accepts at most 100 bindings in one statement. A single JSON snapshot
 // keeps the atomic roster check bounded even when 200 aid units participate.
 return{sql:"NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN alliance_units u ON u.id=json_extract(snapshot.value,'$.id') WHERE u.id IS NULL OR u.revision<>json_extract(snapshot.value,'$.revision') OR u.troops<>json_extract(snapshot.value,'$.troops') OR NOT ("+unitLiveSql('u')+"))",args:[JSON.stringify(units.map(u=>({id:u.id,revision:u.revision,troops:u.troops}))),now]};
}
// Unit clocks use the same authoritative projection as the main-army clock.
// Keep this reader independent of index.js so defending another player does not
// introduce a circular import or trust a caller-supplied elapsed time.
async function unitClock(db,now){
 const row=await stmt(db,"SELECT * FROM world_clock WHERE id='world-v1'").first();
 if(!row)return{id:'world-v1',elapsedMs:0,running:false,speed:1,revision:-1,serverTime:new Date(now).toISOString(),baseElapsedMs:0,anchorRealMs:now};
 return{id:row.id,elapsedMs:Number(row.base_elapsed_ms)+(row.running?Math.max(0,now-Number(row.anchor_real_ms))*Number(row.speed):0),running:!!row.running,speed:Number(row.speed),revision:Number(row.revision),serverTime:new Date(now).toISOString(),baseElapsedMs:Number(row.base_elapsed_ms),anchorRealMs:Number(row.anchor_real_ms)};
}
const clockGuard=clock=>({sql:'EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)',args:[clock.id,clock.revision]});
const elapsedSql=now=>"(SELECT base_elapsed_ms+CASE WHEN running=1 THEN MAX(0,"+Math.floor(now)+"-anchor_real_ms)*speed ELSE 0 END FROM world_clock WHERE id='world-v1')";
function returnAssignments(clock,start=clock?String(Math.floor(clock.elapsedMs)):elapsedSql(Date.now())){
 // Old units have no route: preserve their already-stationed/claimable state.
 // New units always retain their original home and an immutable return route.
 const modern='home_castle_id IS NOT NULL AND return_travel_json IS NOT NULL',duration="CAST(json_extract(return_travel_json,'$.durationMs') AS INTEGER)",spent='MIN('+duration+',MAX(0,('+start+')-departed_elapsed_ms))',turning="travel_phase='outbound' AND ("+start+")<arrives_elapsed_ms";
 const partial="json_set(return_travel_json,'$.durationMs',MAX(1000,CAST(("+spent+"+999)/1000 AS INTEGER)*1000),'$.distanceKm',ROUND(json_extract(return_travel_json,'$.distanceKm')*"+spent+"/"+duration+",3),'$.sourceName',json_extract(return_travel_json,'$.sourceName')||'への道中')",route='CASE WHEN '+turning+' THEN '+partial+' ELSE return_travel_json END';
 return "travel_phase=CASE WHEN "+modern+" THEN 'returning' ELSE NULL END,travel_json=CASE WHEN "+modern+" THEN "+route+" ELSE travel_json END,return_travel_json=CASE WHEN "+modern+" THEN "+route+" ELSE return_travel_json END,departed_elapsed_ms=CASE WHEN "+modern+" THEN "+start+" ELSE NULL END,arrives_elapsed_ms=CASE WHEN "+modern+" THEN ("+start+")+CAST(json_extract(("+route+"),'$.durationMs') AS INTEGER) ELSE NULL END";
}
async function settleUnits(db,now,userId=null,providedClock=null){
 const clock=providedClock||await unitClock(db,now),guard=clockGuard(clock),scope=userId?' AND (u.owner_id=? OR u.target_id=?)':'',scopeArgs=userId?[userId,userId]:[];
 // Preserve escrow after expiry, membership changes, lost castles or a closed
 // operation. Late arrivals never become defenders or join an army already away.
 const invalid="u.expires_at<=? OR NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=u.owner_id AND gm.guild_id=u.guild_id) OR COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.owner_id),0)<>u.owner_epoch OR NOT EXISTS(SELECT 1 FROM guilds g WHERE g.id=u.guild_id) OR EXISTS(SELECT 1 FROM player_bans WHERE user_id=u.owner_id AND active=1) OR (u.kind='aid' AND (NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=u.target_id AND gm.guild_id=u.guild_id) OR COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.target_id),0)<>u.target_epoch OR EXISTS(SELECT 1 FROM player_bans WHERE user_id=u.target_id AND active=1) OR NOT EXISTS(SELECT 1 FROM player_saves ps WHERE ps.user_id=u.target_id AND json_extract(ps.save_json,'$.state.castles.'||u.castle_id||'.owner')=json_extract(ps.save_json,'$.state.clan')))) OR (u.kind='rally' AND NOT EXISTS(SELECT 1 FROM alliance_operations o WHERE o.id=u.operation_id AND o.status='planned' AND o.march_id IS NULL AND o.expires_at>? AND (o.staging_castle_id IS NULL OR EXISTS(SELECT 1 FROM player_saves ps WHERE ps.user_id=o.creator_id AND json_extract(ps.save_json,'$.state.home')=o.staging_castle_id AND COALESCE(json_extract(ps.save_json,'$.state.gameOver'),0)=0))))";
 // An expiry within the current clock epoch can be dated exactly. For an
 // earlier epoch, its anchor is a conservative latest departure; never invent
 // a historic speed or advance travel while the world clock is paused.
 const expiryStart="CASE WHEN expires_at<="+Math.floor(now)+" THEN MAX(COALESCE(departed_elapsed_ms,0),"+clock.baseElapsedMs+"+MAX(0,expires_at-"+clock.anchorRealMs+")*"+(clock.running?clock.speed:0)+") ELSE "+Math.floor(clock.elapsedMs)+" END";
 await db.batch([
  stmt(db,"UPDATE alliance_units AS u SET state='returning',revision=revision+1 WHERE u.state='stationed' AND u.march_id IS NULL"+scope+" AND ("+invalid+") AND "+guard.sql,...scopeArgs,now,now,...guard.args),
  stmt(db,"UPDATE alliance_units AS u SET "+returnAssignments(clock,expiryStart)+",revision=revision+1 WHERE u.state='returning' AND u.march_id IS NULL AND u.travel_phase IN ('outbound','stationed')"+scope+" AND "+guard.sql,...scopeArgs,...guard.args),
  stmt(db,"UPDATE alliance_units AS u SET travel_phase=CASE WHEN travel_phase='outbound' THEN 'stationed' ELSE 'arrived' END,revision=revision+1 WHERE u.march_id IS NULL AND ((u.state='stationed' AND u.travel_phase='outbound') OR (u.state='returning' AND u.travel_phase='returning')) AND u.arrives_elapsed_ms<=?"+scope+" AND "+guard.sql,clock.elapsedMs,...scopeArgs,...guard.args)
 ]);
 return clock;
}
export async function settleAllianceUnits(ctx){return settleUnits(ctx.db,ctx.now);}
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
 const {db,user,helpers:h,now}=ctx,worldClock=await unitClock(db,now);await settleUnits(db,now,null,worldClock);
 const current=await h.getUser(db,user.id),m=current.guild_id?await membership(db,user.id,current.guild_id):null;
 const own=rows(await stmt(db,'SELECT u.*,p.name AS owner_name,t.name AS target_name FROM alliance_units u JOIN users p ON p.id=u.owner_id LEFT JOIN users t ON t.id=u.target_id WHERE u.owner_id=? AND u.state<>? ORDER BY u.created_at DESC LIMIT 100',user.id,'claimed').all());
 const directory=rows(await stmt(db,'SELECT g.id,g.name,COUNT(gm.user_id) AS members,p.join_mode,p.description,p.activity FROM guilds g LEFT JOIN guild_members gm ON gm.guild_id=g.id LEFT JOIN alliance_policies p ON p.guild_id=g.id GROUP BY g.id ORDER BY members DESC,g.name LIMIT 100').all()).map(g=>({id:g.id,name:g.name,members:g.members,joinMode:g.join_mode||'open',description:g.description||'',activity:g.activity||''}));
 const applications=rows(await stmt(db,'SELECT a.*,g.name AS guild_name,u.name AS player_name FROM alliance_applications a JOIN guilds g ON g.id=a.guild_id JOIN users u ON u.id=a.user_id WHERE a.user_id=? OR (a.guild_id=? AND ?=1) ORDER BY a.updated_at DESC LIMIT 100',user.id,m?.guild_id||'',m&&(m.owner_id===user.id||m.officer)?1:0).all());
 if(!m){await h.requireAccountAccess(db,user);return{ok:true,guild:null,policy:null,operations:[],members:[],units:own.map(u=>unitDto(u,worldClock)),directory,applications:applications.map(applicationDto),withdrawals:[],contributions:[],clock:worldClock,serverNow:now};}
 const ops=rows(await stmt(db,"SELECT o.*,COALESCE(o.staging_castle_id,json_extract(ps.save_json,'$.state.home')) AS staging_castle_id FROM alliance_operations o LEFT JOIN player_saves ps ON ps.user_id=o.creator_id WHERE o.guild_id=? ORDER BY o.created_at DESC LIMIT 50",m.guild_id).all());
 const marchRows=rows(await stmt(db,"SELECT bm.* FROM battle_marches bm JOIN alliance_operations o ON o.march_id=bm.id WHERE o.guild_id=? AND bm.status='marching'",m.guild_id).all()),marchMap=new Map(marchRows.map(row=>[row.id,marchDto(row,worldClock,now)]));
 const rsvps=rows(await stmt(db,'SELECT r.*,u.name FROM alliance_rsvps r JOIN users u ON u.id=r.user_id JOIN alliance_operations o ON o.id=r.operation_id WHERE o.guild_id=? AND EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=r.user_id AND gm.guild_id=o.guild_id)',m.guild_id).all());
 const members=rows(await stmt(db,'SELECT gm.user_id AS id,u.name,gm.joined_at,EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=gm.user_id AND go.guild_id=gm.guild_id) AS officer FROM guild_members gm JOIN users u ON u.id=gm.user_id WHERE gm.guild_id=? ORDER BY gm.joined_at',m.guild_id).all()).map(p=>({id:p.id,name:p.name,role:p.id===m.owner_id?'owner':p.officer?'officer':'member',joinedAt:p.joined_at}));
 const units=rows(await stmt(db,"SELECT u.*,p.name AS owner_name,t.name AS target_name FROM alliance_units u JOIN users p ON p.id=u.owner_id LEFT JOIN users t ON t.id=u.target_id WHERE u.guild_id=? AND u.state='stationed' ORDER BY u.created_at DESC LIMIT 200",m.guild_id).all());
 const withdrawals=rows(await stmt(db,"SELECT w.*,u.name AS player_name FROM alliance_withdrawals w JOIN users u ON u.id=w.actor_id WHERE w.guild_id=? AND (w.actor_id=? OR ?=1) ORDER BY w.created_at DESC LIMIT 100",m.guild_id,user.id,m.owner_id===user.id?1:0).all());
 const contributions=rows(await stmt(db,'SELECT c.*,u.name FROM alliance_contributions c JOIN users u ON u.id=c.user_id WHERE c.guild_id=? ORDER BY c.created_at DESC LIMIT 100',m.guild_id).all()).map(c=>({id:c.id,playerId:c.user_id,name:c.name,kind:c.kind,amount:c.amount,detail:c.detail,createdAt:c.created_at}));
 const guard=m.owner_id===user.id?officerGuard(m,true):m.officer?officerGuard(m):memberGuard(m);if(!await stmt(db,'SELECT 1 AS ok WHERE '+guard.sql,...guard.args).first())h.fail(409,'ALLIANCE_STATE_CHANGED','同盟の所属・役職が変わりました。');
 await h.requireAccountAccess(db,user);
 return{ok:true,guild:{id:m.guild_id,name:current.guild_name,role:m.owner_id===user.id?'owner':m.officer?'officer':'member'},policy:policyDto(await stmt(db,'SELECT * FROM alliance_policies WHERE guild_id=?',m.guild_id).first()),operations:ops.map(o=>({...operationDto(o),march:o.march_id?marchMap.get(o.march_id)||null:null,rsvps:rsvps.filter(r=>r.operation_id===o.id).map(r=>({playerId:r.user_id,name:r.name,response:r.response})),troops:units.filter(u=>u.operation_id===o.id&&(!u.travel_phase||u.travel_phase==='stationed')).reduce((s,u)=>s+u.troops,0),travelingTroops:units.filter(u=>u.operation_id===o.id&&u.travel_phase==='outbound').reduce((s,u)=>s+u.troops,0)})),members,units:[...new Map([...own,...units].map(u=>[u.id,unitDto(u,worldClock)])).values()],directory,applications:applications.map(applicationDto),withdrawals:withdrawals.map(withdrawalDto),contributions,clock:worldClock,serverNow:now};
}
const operationDto=o=>({id:o.id,title:o.title,note:o.note,kind:o.kind,creatorId:o.creator_id,stagingCastleId:o.staging_castle_id||null,stagingCastleName:cast(o.staging_castle_id)?.name||null,targetPlayerId:o.target_player_id,castleId:o.castle_id,castleName:cast(o.castle_id)?.name||o.castle_id,branchId:o.branch_id,tactic:o.tactic,startsAt:o.starts_at,expiresAt:o.expires_at,status:o.march_id?'marching':o.status,assignments:JSON.parse(o.assignments_json),result:o.result_json?JSON.parse(o.result_json):null,revision:o.revision});
function unitDto(u,clock){
 const phase=['outbound','returning'].includes(u.travel_phase)?u.travel_phase:null,travel=u.travel_json?JSON.parse(u.travel_json):null;
 return{id:u.id,ownerId:u.owner_id,ownerName:u.owner_name||'',targetPlayerId:u.target_id,targetName:u.target_name||'',castleId:u.castle_id,castleName:cast(u.castle_id)?.name||u.castle_id,operationId:u.operation_id,marchId:u.march_id||null,kind:u.kind,state:u.march_id?'marching':phase==='outbound'?'outbound':u.state,phase,timeBasis:'world',travel,returnTravel:u.return_travel_json?JSON.parse(u.return_travel_json):null,departedElapsedMs:u.departed_elapsed_ms??null,arrivesElapsedMs:u.arrives_elapsed_ms??null,remainingMs:phase?Math.max(0,Number(u.arrives_elapsed_ms)-clock.elapsedMs):0,canClaim:u.state==='returning'&&!u.march_id&&(!u.travel_phase||u.travel_phase==='arrived'),troops:u.troops,sent:u.sent,expiresAt:u.expires_at,revision:u.revision};
}
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
 const stagingRow=b.kind==='attack'?await h.getSyncRow(db,user.id):null,stagingCastleId=stagingRow?.save_json?JSON.parse(stagingRow.save_json).state.home:null;
 if(b.kind==='attack'&&!cast(stagingCastleId))h.fail(409,'BASE_UNAVAILABLE','集結拠点となる本拠を共有してください。');
 const stagingGuard=stagingRow?{sql:'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',args:[user.id,stagingRow.revision]}:emptyGuard();
 const operationId='ao_'+crypto.randomUUID().replaceAll('-',''),limit={sql:"(SELECT COUNT(*) FROM alliance_operations WHERE guild_id=? AND status='planned' AND expires_at>?)<30",args:[m.guild_id,now]};
 const register=note?await h.resolveMessageRegister(db,user,{kind:'guild',id:m.guild_id},now):null;
 const spokenNote=register?await register.write(note):note;
 return commit(ctx,b,'operation-create',and(memberGuard(m),limit,stagingGuard,register?.guard||emptyGuard()),(gate,args)=>[stmt(db,'INSERT INTO alliance_operations(id,guild_id,creator_id,title,note,kind,target_player_id,castle_id,branch_id,tactic,starts_at,expires_at,created_at,resolution_seed,staging_castle_id) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE '+gate,operationId,m.guild_id,user.id,title,spokenNote,b.kind,targetId,castleId,branchId,b.tactic||'balanced',startsAt,expiresAt,now,crypto.randomUUID(),stagingCastleId,...args)],{operationId,message:'作戦と同盟専用の地図マークを登録しました。'});
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
 const next=action==='operation-cancel'?'cancelled':'completed',clock=await unitClock(db,ctx.now);
 return commit(ctx,b,action,and(o.creator_id===user.id?memberGuard(m):officerGuard(m),opGuard(o),clockGuard(clock)),(gate,args)=>[
 stmt(db,'UPDATE alliance_operations SET status=?,revision=revision+1 WHERE id=? AND '+gate,next,o.id,...args),
 stmt(db,"UPDATE alliance_units SET state='returning',"+returnAssignments(clock)+",revision=revision+1 WHERE operation_id=? AND state='stationed' AND "+gate,o.id,...args),
 ],{message:next==='cancelled'?'作戦を取り下げました。各部隊が本拠へ帰還を始めました。':'作戦を完了しました。各部隊が本拠へ帰還を始めました。'});
}
async function sendUnits(ctx,b,kind){
 const {db,user,helpers:h,now}=ctx,m=await requireMember(ctx),troops=integer(h,b.troops,'派遣兵数',1,50000);let targetId=null,targetEpoch=null,castleId,stagingCastleId=null,operationId=null,expiresAt,extra=emptyGuard();
 if(kind==='rally'){
  const o=await getOperation(ctx,b);if(o.kind!=='attack'||o.status!=='planned'||o.march_id||o.expires_at<=now)h.fail(409,'OPERATION_CLOSED','集結できる攻撃作戦を選んでください。');
  const organizerRow=await h.getSyncRow(db,o.creator_id),organizerState=organizerRow?.save_json?JSON.parse(organizerRow.save_json).state:null;
  stagingCastleId=o.staging_castle_id||organizerState?.home;if(!cast(stagingCastleId)||organizerState?.gameOver||organizerState?.home!==stagingCastleId)h.fail(409,'RALLY_BASE_CHANGED','主催者の集結拠点が変わりました。新しい作戦を作成してください。');
  operationId=o.id;castleId=o.castle_id;targetId=o.target_player_id;expiresAt=o.expires_at;extra=and(opGuard(o),{sql:'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',args:[o.creator_id,organizerRow.revision]},{sql:"COALESCE((SELECT SUM(troops) FROM alliance_units WHERE operation_id=? AND state='stationed'),0)+?<=? AND (SELECT COUNT(*) FROM alliance_units WHERE operation_id=? AND state='stationed')<50",args:[o.id,troops,MAX_RALLY,o.id]});
 }else{
  targetId=id(h,b.targetPlayerId,'援軍先');castleId=id(h,b.castleId,'守備する城');if(targetId===user.id)h.fail(400,'INVALID_TARGET','援軍は同盟の仲間へ派遣してください。');
  const target=await membership(db,targetId,m.guild_id);if(!target)h.fail(403,'GUILD_REQUIRED','援軍を送れるのは同じ同盟の領主です。');targetEpoch=target.epoch;
  const targetUser=await h.getUser(db,targetId),targetRow=await h.getSyncRow(db,targetId);if(!targetRow?.save_json||targetUser.ban_active)h.fail(409,'BASE_UNAVAILABLE','相手の本拠がまだ共有されていません。');
  const ts=JSON.parse(targetRow.save_json).state;if(!cast(castleId)||ts.castles[castleId]?.owner!==ts.clan)h.fail(409,'FIELD_TARGET_CHANGED','相手が所有する城を選んでください。');
  expiresAt=now+integer(h,b.hours??6,'駐屯時間',1,24)*3600000;extra=and(memberGuard(target),h.accountCommitGuard(targetUser),{sql:"EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND COALESCE((SELECT SUM(troops) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?),0)+?<=? AND (SELECT COUNT(*) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND expires_at>?)<200",args:[targetId,targetRow.revision,targetId,castleId,now,troops,100000,targetId,castleId,now]});
 }
 const state=await saved(ctx,b);if(state.save.state.troops<troops)h.fail(409,'INSUFFICIENT_FORCE','本隊の兵数が足りません。');
 if(state.save.state.gameOver)h.fail(409,'BASE_UNAVAILABLE','本拠を失っている間は兵を派遣できません。');
 if(!state.clock.running)h.fail(409,'WORLD_PAUSED','共通時間が停止中です。');
 const travel=globalThis.SengokuTravel.plan({sourceCastleId:state.save.state.home,targetCastleId:stagingCastleId||castleId}),returnTravel=travel&&globalThis.SengokuTravel.plan({sourceCastleId:travel.targetCastleId,targetCastleId:travel.sourceCastleId});
 if(!travel||!returnTravel)h.fail(409,'MARCH_ROUTE_UNAVAILABLE','派遣部隊の移動経路を確認できません。');
 const departedElapsedMs=Math.floor(state.clock.elapsedMs),arrivesElapsedMs=departedElapsedMs+travel.durationMs;
 state.save.state.troops-=troops;const unitId='au_'+crypto.randomUUID().replaceAll('-',''),limit={sql:"(SELECT COUNT(*) FROM alliance_units WHERE owner_id=? AND state<>'claimed')<?",args:[user.id,MAX_UNITS]};
 return commit(ctx,b,kind==='rally'?'rally-join':'aid-send',and(memberGuard(m),state.guard,extra,limit),(gate,args)=>[
 saveStatement(ctx,b,state.save,gate,args),
 stmt(db,"INSERT INTO alliance_units(id,guild_id,owner_id,owner_epoch,target_id,target_epoch,castle_id,operation_id,kind,state,troops,sent,expires_at,created_at,home_castle_id,travel_phase,travel_json,return_travel_json,departed_elapsed_ms,arrives_elapsed_ms) SELECT ?,?,?,?,?,?,?,?,?,'stationed',?,?,?,?,?,'outbound',?,?,?,? WHERE "+gate,unitId,m.guild_id,user.id,m.epoch,targetId,targetEpoch,castleId,operationId,kind,troops,troops,expiresAt,now,state.save.state.home,JSON.stringify(travel),JSON.stringify(returnTravel),departedElapsedMs,arrivesElapsedMs,...args),
 contribution(db,'send:'+unitId,m.guild_id,user.id,kind==='rally'?'rally':'aid',troops,kind==='rally'?'集結に兵を提供':'仲間の城へ援軍',now,gate,args),...state.extra(gate,args),
 ],{unitId,phase:'outbound',travel,departedElapsedMs,arrivesElapsedMs,message:(kind==='rally'?'集結拠点へ兵を派遣しました。':'援軍が出発しました。')+'到着まで'+globalThis.SengokuTravel.formatDuration(travel.durationMs)+'（1倍速）。到着後に現地の兵力へ加わります。'});
}
async function unitsAction(ctx,b,action){
 const {db,user,helpers:h}=ctx,clock=await settleUnits(db,ctx.now,user.id);const unit=await stmt(db,'SELECT * FROM alliance_units WHERE id=? AND owner_id=?',id(h,b.unitId,'部隊'),user.id).first();if(!unit)h.fail(404,'UNIT_NOT_FOUND','自分の派遣部隊を選んでください。');
 if(unit.march_id)h.fail(409,'ARMY_MARCHING','この部隊は進軍中です。到着して生存兵が戻るまでお待ちください。');
 if(action==='unit-recall'){
  if(unit.state==='claimed')h.fail(409,'UNIT_RETURNED','この部隊は帰還済みです。');
  if(unit.state==='returning')return commit(ctx,b,action,unitGuard(unit),()=>[],{message:unit.travel_phase==='returning'?'この部隊は既に帰還中です。到着後に受け取れます。':'この部隊は帰還済みです。本隊へ受け取れます。'});
  const original=unit.return_travel_json?JSON.parse(unit.return_travel_json):null,spent=unit.travel_phase==='outbound'?Math.max(0,Math.min(Number(unit.arrives_elapsed_ms)-Number(unit.departed_elapsed_ms),clock.elapsedMs-Number(unit.departed_elapsed_ms))):null;
  const route=original&&spent!==null?{...original,sourceName:original.sourceName+'への道中',distanceKm:Math.round(original.distanceKm*spent/original.durationMs*1000)/1000,durationMs:Math.max(1000,Math.ceil(spent/1000)*1000)}:original;
  const extra=route?{phase:'returning',travel:route,departedElapsedMs:clock.elapsedMs,arrivesElapsedMs:clock.elapsedMs+route.durationMs}:{};
  return commit(ctx,b,action,and(unitGuard(unit),clockGuard(clock)),(gate,args)=>[route?stmt(db,"UPDATE alliance_units SET state='returning',travel_phase='returning',travel_json=?,return_travel_json=?,departed_elapsed_ms=?,arrives_elapsed_ms=?,revision=revision+1 WHERE id=? AND "+gate,JSON.stringify(route),JSON.stringify(route),clock.elapsedMs,clock.elapsedMs+route.durationMs,unit.id,...args):stmt(db,"UPDATE alliance_units SET state='returning',revision=revision+1 WHERE id=? AND "+gate,unit.id,...args)],{...extra,message:'撤収を開始しました。帰還完了後に生存兵を「本隊へ受取」で戻せます。'});
 }
 if(unit.state!=='returning'||unit.travel_phase&&unit.travel_phase!=='arrived')h.fail(409,'UNIT_NOT_RETURNED','部隊の帰還が完了してから受け取れます。');
 const s=await saved(ctx,b),shared=user.is_staff&&!user.is_admin&&h.staffBaseDto?await h.staffBaseDto(db,user,s.clock,ctx.now):null;
 const game=GameEngine.fromSave(s.save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase:shared});
 const room=Math.max(0,Math.min(ASSET_LIMIT,game.availableTroopCapacity?game.availableTroopCapacity():game.troopCapacity())-s.save.state.troops),amount=Math.min(unit.troops,room);
 if(unit.troops>0&&amount<=0)h.fail(409,'TROOP_CAPACITY','本隊の収容力が不足しています。兵舎を増築するか本隊に空きを作ってください。残りの兵は保管されます。');
 s.save.state.troops+=amount;
 return commit(ctx,b,action,and(unitGuard(unit),s.guard),(gate,args)=>[
 saveStatement(ctx,b,s.save,gate,args),
 stmt(db,'UPDATE alliance_units SET troops=troops-?,state=?,revision=revision+1 WHERE id=? AND '+gate,amount,amount===unit.troops?'claimed':'returning',unit.id,...args),...s.extra(gate,args),
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
 const ctx={db,user,now,helpers:h},clock=await settleUnits(db,now);const m=await requireMember(ctx),o=await getOperation(ctx,{operationId});
 if(o.kind!=='attack'||o.status!=='planned'||(frozen?o.march_id!==frozen.marchId:o.march_id||o.starts_at>now||o.expires_at<=now))h.fail(409,'RALLY_NOT_READY','作戦の開始時刻から終了時刻までに出陣してください。');
 if(o.creator_id!==user.id&&m.owner_id!==user.id&&!m.officer)h.fail(403,'GUILD_ROLE_REQUIRED','作戦を作った領主または同盟役職者が出陣できます。');
 const stagingRow=await stmt(db,'SELECT save_json,revision FROM player_saves WHERE user_id=?',o.creator_id).first(),stagingState=stagingRow?.save_json?JSON.parse(stagingRow.save_json).state:null,stagingCastleId=frozen?.stagingCastleId||o.staging_castle_id||stagingState?.home;
 if(!frozen&&(!cast(stagingCastleId)||!stagingState||stagingState.gameOver||stagingState.home!==stagingCastleId))h.fail(409,'RALLY_BASE_CHANGED','集結拠点が変わりました。各部隊は帰還します。新しい作戦を作成してください。');
 const stagingGuard=!frozen?{sql:'EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?)',args:[o.creator_id,stagingRow.revision]}:emptyGuard();
 const units=rows(await stmt(db,"SELECT u.* FROM alliance_units u WHERE u.operation_id=? AND "+(frozen?"u.state='stationed' AND u.march_id=?":unitLiveSql('u'))+' ORDER BY u.id LIMIT 51',o.id,frozen?frozen.marchId:now).all());
 if(frozen&&(units.length!==frozen.units.length||units.some(u=>!frozen.units.some(v=>v.id===u.id&&v.troops===u.troops&&v.revision+1===u.revision))))h.fail(409,'RALLY_CHANGED','進軍中の集結部隊が変わったため帰還しました。');
 const frozenRoster={sql:"NOT EXISTS(SELECT 1 FROM json_each(?) snapshot LEFT JOIN alliance_units u ON u.id=json_extract(snapshot.value,'$.id') WHERE u.id IS NULL OR u.revision<>json_extract(snapshot.value,'$.revision') OR u.troops<>json_extract(snapshot.value,'$.troops') OR u.state<>'stationed' OR u.march_id<>? OR NOT EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=u.owner_id AND gm.guild_id=u.guild_id) OR COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.owner_id),0)<>u.owner_epoch OR EXISTS(SELECT 1 FROM player_bans WHERE user_id=u.owner_id AND active=1))",args:[JSON.stringify(units.map(u=>({id:u.id,revision:u.revision,troops:u.troops}))),frozen?.marchId||'']};
 if(frozen){for(const unit of units){const member=await membership(db,unit.owner_id,unit.guild_id);if(!member||member.epoch!==unit.owner_epoch||await stmt(db,'SELECT 1 AS banned FROM player_bans WHERE user_id=? AND active=1',unit.owner_id).first())h.fail(409,'RALLY_CHANGED','参加者の所属が変わったため、各部隊へ兵を返還します。');}}
 const troops=units.reduce((n,u)=>n+u.troops,0);if(units.length>50||troops<300||troops>MAX_RALLY)h.fail(409,'RALLY_FORCE','集結兵は300〜100,000人で出陣できます。');
 const ready=frozen?"state='stationed' AND march_id=?":"state='stationed' AND march_id IS NULL AND (travel_phase IS NULL OR travel_phase='stationed')",exact={sql:'(SELECT COUNT(*) FROM alliance_units WHERE operation_id=? AND '+ready+')=? AND (SELECT COALESCE(SUM(troops),0) FROM alliance_units WHERE operation_id=? AND '+ready+')=?',args:[o.id,...(frozen?[frozen.marchId]:[]),units.length,o.id,...(frozen?[frozen.marchId]:[]),troops]};
 const organizer=o.creator_id===user.id?memberGuard(m):officerGuard(m);
 const rollBytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['alliance-battle-v1',o.resolution_seed,o.id,units.map(u=>[u.id,u.troops])])));
 const roll=new DataView(rollBytes).getUint32(0)/4294967296;
 const returnTrips=units.filter(u=>u.home_castle_id).map(u=>({id:u.id,travel:globalThis.SengokuTravel.plan({sourceCastleId:o.castle_id,targetCastleId:u.home_castle_id,...(o.branch_id?{localOffsetKm:2}:{})})}));
 let allocation=null;
 return{stagingCastleId,returnTrips,maintenanceOwnerIds:[...new Set(units.map(u=>u.owner_id))],operationId:o.id,snapshot:{operationId:o.id,stagingCastleId,units:units.map(u=>({id:u.id,troops:u.troops,revision:u.revision}))},troops,roll,targetPlayerId:o.target_player_id,targetCastleId:o.castle_id,targetBranchId:o.branch_id||undefined,tactic:o.tactic,guard:and(organizer,opGuard(o),exact,frozen?frozenRoster:rosterGuard(units,now),clockGuard(clock),stagingGuard),
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
    ...allocation.flatMap(a=>[stmt(db,"UPDATE alliance_units SET troops=CASE WHEN campaign_retired=1 THEN 0 ELSE ? END,state=CASE WHEN campaign_retired=1 THEN 'claimed' ELSE ? END,march_id=NULL,"+returnAssignments(clock)+",revision=revision+1 WHERE id=? AND "+gate,a.returned,a.returned?'returning':'claimed',a.unit.id,...args),contribution(db,'rally:'+battle.id+':'+a.unit.id,o.guild_id,a.unit.owner_id,'attack',a.unit.troops,o.title+'：'+(battle.won?'勝利':'撤退')+'・生存兵'+a.returned,now,gate,args)]),
   ];
  }};
}
export function rallyMarchStatements(db,rally,marchId,gate,args){
 return [stmt(db,"UPDATE alliance_operations SET march_id=?,revision=revision+1 WHERE id=? AND "+gate,marchId,rally.operationId,...args),stmt(db,"UPDATE alliance_units SET march_id=?,revision=revision+1 WHERE id IN (SELECT json_extract(value,'$.id') FROM json_each(?)) AND state='stationed' AND (travel_phase IS NULL OR travel_phase='stationed') AND "+gate,marchId,JSON.stringify(rally.snapshot.units),...args),...rally.returnTrips.map(unit=>stmt(db,'UPDATE alliance_units SET return_travel_json=? WHERE id=? AND march_id=? AND '+gate,JSON.stringify(unit.travel),unit.id,marchId,...args))];
}
export function rallyMarchCancellation(db,march,gate,args){
 return [stmt(db,"UPDATE alliance_operations SET status='cancelled',march_id=NULL,revision=revision+1 WHERE march_id=? AND "+gate,march.id,...args),stmt(db,"UPDATE alliance_units SET troops=CASE WHEN campaign_retired=1 THEN 0 ELSE troops END,state=CASE WHEN campaign_retired=1 THEN 'claimed' ELSE 'returning' END,march_id=NULL,"+returnAssignments(null)+",revision=revision+1 WHERE march_id=? AND state='stationed' AND "+gate,march.id,...args)];
}
export async function getAllianceDefense(db,target,castleId,now){
 const clock=await settleUnits(db,now,target.id);const m=target.guild_id?await membership(db,target.id,target.guild_id):null;
 if(!m){const epoch=await stmt(db,'SELECT COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0) AS epoch',target.id).first();return{troops:0,guard:{sql:"NOT EXISTS(SELECT 1 FROM guild_members WHERE user_id=?) AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND (travel_phase IS NULL OR travel_phase='stationed') AND expires_at>?)",args:[target.id,target.id,epoch.epoch,target.id,castleId,now]},statements:()=>[]};}
 const units=rows(await stmt(db,"SELECT u.* FROM alliance_units u WHERE u.kind='aid' AND u.target_id=? AND u.castle_id=? AND "+unitLiveSql('u')+' AND u.target_epoch=? ORDER BY u.id LIMIT 201',target.id,castleId,now,m.epoch).all());
 const troops=units.reduce((n,u)=>n+u.troops,0),exact={sql:"(SELECT COUNT(*) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND (travel_phase IS NULL OR travel_phase='stationed') AND expires_at>?)=? AND (SELECT COALESCE(SUM(troops),0) FROM alliance_units WHERE target_id=? AND castle_id=? AND kind='aid' AND state='stationed' AND (travel_phase IS NULL OR travel_phase='stationed') AND expires_at>?)=?",args:[target.id,castleId,now,units.length,target.id,castleId,now,troops]};
 const guard=and(memberGuard(m),exact,rosterGuard(units,now),clockGuard(clock));
 return{maintenanceOwnerIds:[...new Set(units.map(u=>u.owner_id))],troops,guard,statements:(battle,gate,args)=>units.flatMap(u=>{
  const loss=battle.battleMode==='reward'||battle.battleMode==='branch'?0:Math.min(u.troops,Math.floor(u.troops*(battle.won?.1:.03))),survivors=u.troops-loss;
  return[stmt(db,'UPDATE alliance_units SET troops=?,state=?,'+(survivors&&battle.capture?.captured?returnAssignments(clock)+',':'')+'revision=revision+1 WHERE id=? AND '+gate,survivors,survivors?(battle.capture?.captured?'returning':'stationed'):'claimed',u.id,...args),contribution(db,'defense:'+battle.id+':'+u.id,u.guild_id,u.owner_id,'defense',u.troops,battle.castleName+'を援軍で防衛・兵損'+loss,now,gate,args)];
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
  await settleUnits(db,ctx.now);const operationId=id(h,body.operationId,'作戦'),o=await getOperation(ctx,{operationId});
  if(!h.fieldAttack)h.fail(503,'RALLY_UNAVAILABLE','集結出陣を準備しています。しばらくしてからお試しください。');
  // Frozen target and tactic come from the operation, not the request body.
  const units=rows(await stmt(db,"SELECT troops FROM alliance_units WHERE operation_id=? AND state='stationed' AND (travel_phase IS NULL OR travel_phase='stationed')",operationId).all()),troops=o.result_json?JSON.parse(o.result_json).pooledTroops:units.reduce((n,u)=>n+u.troops,0);
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
