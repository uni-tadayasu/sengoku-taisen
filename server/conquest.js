// One common, exclusive-ownership battlefield. Its economy is independent of
// campaign saves and is never populated from client-supplied power or resources.
import './game-runtime.js';

const DAY=86400000,JST=9*3600000,WEEK=7*DAY;
const CASTLES=globalThis.SENGOKU_DATA.castles;
const BY_ID=new Map(CASTLES.map(c=>[c.id,c]));
const STRATEGIC=new Set(['edo','kyoto_gosho','nijo','osaka','nagoya']);
const RULES=Object.freeze({startTroops:12000,startSupplies:6000,maxTroops:100000000,maxSupplies:100000000,replenishMs:1800000,replenishTroops:400,replenishSupplies:1000,memberCooldownMs:20000,attackCooldownMs:30000,captureProtectionMs:300000,maxGarrison:100000000,maxStock:100000000,maxWall:5});
const TACTICS=Object.freeze({balanced:{name:'正攻法',power:1,loss:1,cost:1,wall:1},assault:{name:'総攻撃',power:1.18,loss:1.25,cost:1.2,wall:1},siege:{name:'包囲戦',power:1,loss:.85,cost:1.35,wall:.45},ambush:{name:'伏兵',power:1.08,loss:1,cost:1.1,wall:.8}});
const S=(db,sql,...a)=>db.prepare(sql).bind(...a),R=r=>r?.results||[];
const GATE='EXISTS(SELECT 1 FROM conquest_requests WHERE user_id=? AND request_id=? AND commit_token=?)';
const iso=ms=>new Date(ms).toISOString();
const memberScore=row=>Number(row?.attack_points||0)+Number(row?.reinforcement_points||0)+Number(row?.transport_points||0)+Number(row?.construction_points||0);
const honor=points=>points>=1000?'天下の功臣':points>=400?'戦線の柱':points>=100?'同盟の功労者':points>0?'戦場の働き手':'初陣の領主';

export function conquestSeason(now){
 const date=new Date(now+JST),day=Date.UTC(date.getUTCFullYear(),date.getUTCMonth(),date.getUTCDate())-JST;
 let start=day-((date.getUTCDay()+1)%7)*DAY;
 if(now>=start+2*DAY)start+=WEEK;
 const id='cq_'+new Date(start+JST).toISOString().slice(0,10).replaceAll('-','');
 return{id,name:new Date(start+JST).toISOString().slice(0,10).replaceAll('-','/')+' 週末天下争覇',startsAt:iso(start),endsAt:iso(start+2*DAY),startsMs:start,endsMs:start+2*DAY,status:now<start?'upcoming':'active'};
}
function supply(row,now,season){
 const cursor=Math.max(Number(row.replenished_at),Number(season.starts_at)),until=Math.min(now,Number(season.ends_at)),ticks=Math.max(0,Math.floor((until-cursor)/RULES.replenishMs));
 return{troops:Math.min(RULES.maxTroops,Number(row.troops)+ticks*RULES.replenishTroops),supplies:Math.min(RULES.maxSupplies,Number(row.supplies)+ticks*RULES.replenishSupplies),replenishedAt:cursor+ticks*RULES.replenishMs};
}
function strict(raw,fields,h){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!fields.includes(k)))h.fail(400,'INVALID_INPUT','大会の送信内容を確認してください。');
}
function integer(value,name,min,max,h){if(!Number.isSafeInteger(value)||value<min||value>max)h.fail(400,'INVALID_INPUT',name+'の数値を確認してください。');return value;}
async function memberContext(ctx){
 const {db,user,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 const member=await S(db,'SELECT gm.guild_id,gm.joined_at,g.name,ve.epoch FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id JOIN voice_membership_epochs ve ON ve.user_id=gm.user_id WHERE gm.user_id=?',user.id).first();
 if(!member)h.fail(403,'CONQUEST_GUILD_REQUIRED','同盟に所属してから大会へ参加してください。');
 const access=h.accountCommitGuard?h.accountCommitGuard(user):h.roleCommitGuard(user);
 return{guildId:member.guild_id,name:member.name,epoch:Number(member.epoch),guard:{sql:`${access.sql} AND EXISTS(SELECT 1 FROM guild_members gm JOIN voice_membership_epochs ve ON ve.user_id=gm.user_id WHERE gm.user_id=? AND gm.guild_id=? AND ve.epoch=?)`,args:[...access.args,user.id,member.guild_id,Number(member.epoch)]}};
}
async function readStandings(db,seasonId){
 const found=R(await S(db,`SELECT g.guild_id,g.guild_name,g.captures,g.defenses,g.support_points,
  COUNT(c.castle_id) AS castles,COALESCE(SUM(CASE WHEN c.castle_id IS NULL THEN 0 WHEN c.castle_id IN ('edo','kyoto_gosho','nijo','osaka','nagoya') THEN 4 ELSE 1 END),0) AS territory
  FROM conquest_guilds g LEFT JOIN conquest_castles c ON c.season_id=g.season_id AND c.owner_guild_id=g.guild_id
  WHERE g.season_id=? GROUP BY g.guild_id ORDER BY g.guild_id`,seasonId).all());
 return found.map(r=>({guildId:r.guild_id,name:r.guild_name,castles:Number(r.castles),territory:Number(r.territory),captures:Number(r.captures),defenses:Number(r.defenses),support:Math.min(2000,Number(r.support_points)),score:Number(r.territory)*100+Number(r.captures)*25+Number(r.defenses)*20+Math.min(2000,Number(r.support_points))})).sort((a,b)=>b.score-a.score||b.territory-a.territory||a.guildId.localeCompare(b.guildId)).map((r,i)=>({...r,rank:i+1,title:i===0&&r.score>0?'天下覇者':i<3&&r.score>0?'三傑の同盟':r.score>0?'天下争覇の同盟':'参陣同盟'}));
}
async function settleEnded(ctx){
 const {db}=ctx,now=Date.now(),ended=R(await S(db,"SELECT id FROM conquest_seasons WHERE ends_at<=? AND (status='open' OR results_json IS NULL) ORDER BY ends_at LIMIT 12",now).all());
 for(const row of ended){
  // Close mutation admission first. A result snapshot can then never race an
  // attack that was admitted while the aggregate was being read.
  await S(db,"UPDATE conquest_seasons SET status='ended' WHERE id=? AND status='open' AND ends_at<=?",row.id,now).run();
  const standings=await readStandings(db,row.id);
  await S(db,"UPDATE conquest_seasons SET results_json=?,finalized_at=? WHERE id=? AND status='ended' AND results_json IS NULL",JSON.stringify(standings),now,row.id).run();
 }
}
async function ensureSeason(ctx){
 await settleEnded(ctx);
 const meta=conquestSeason(Date.now()),{db}=ctx;
 const existing=await S(db,'SELECT * FROM conquest_seasons WHERE id=?',meta.id).first();
 if(existing)return existing;
 await db.batch([
  S(db,'INSERT INTO conquest_seasons(id,starts_at,ends_at,created_at) VALUES(?,?,?,?) ON CONFLICT(id) DO NOTHING',meta.id,meta.startsMs,meta.endsMs,Date.now()),
  ...CASTLES.map(c=>S(db,'INSERT INTO conquest_castles(season_id,castle_id,garrison,wall) VALUES(?,?,?,?) ON CONFLICT(season_id,castle_id) DO NOTHING',meta.id,c.id,STRATEGIC.has(c.id)?2200:650+Math.max(1,Math.min(3,c.wall))*150,STRATEGIC.has(c.id)?3:Math.max(1,Math.min(2,c.wall))))
 ]);
 return S(db,'SELECT * FROM conquest_seasons WHERE id=?',meta.id).first();
}
function seasonDto(row,now){return{id:row.id,name:new Date(Number(row.starts_at)+JST).toISOString().slice(0,10).replaceAll('-','/')+' 週末天下争覇',startsAt:iso(Number(row.starts_at)),endsAt:iso(Number(row.ends_at)),status:row.status==='ended'||now>=Number(row.ends_at)?'ended':now<Number(row.starts_at)?'upcoming':'active'};}
async function history(ctx){
 const {db,user}=ctx,found=R(await S(db,"SELECT * FROM conquest_seasons WHERE status='ended' ORDER BY starts_at DESC LIMIT 12").all());
 const mine=R(await S(db,`SELECT m.*,g.guild_name FROM conquest_members m JOIN conquest_guilds g ON g.season_id=m.season_id AND g.guild_id=m.guild_id WHERE m.user_id=? ORDER BY m.season_id DESC LIMIT 52`,user.id).all());
 const best=mine.reduce((a,m)=>memberScore(m)>a.points?{points:memberScore(m),seasonId:m.season_id,title:honor(memberScore(m))}:a,{points:0,seasonId:null,title:'初陣の領主'});
 return{seasons:found.map(row=>{const self=mine.find(m=>m.season_id===row.id),standings=JSON.parse(row.results_json||'[]');return{...seasonDto(row,Date.now()),standings,self:self?{guildId:self.guild_id,guildName:self.guild_name,points:memberScore(self),title:honor(memberScore(self))}:null};}),best};
}
async function snapshot(ctx,season=null){
 const {db,user,helpers:h}=ctx;season=season||await ensureSeason(ctx);const now=Date.now();
 const [castleResult,standings,member,guildMembership,past]=await Promise.all([
  S(db,'SELECT c.*,g.guild_name FROM conquest_castles c LEFT JOIN conquest_guilds g ON g.season_id=c.season_id AND g.guild_id=c.owner_guild_id WHERE c.season_id=? ORDER BY c.castle_id',season.id).all(),
  readStandings(db,season.id),S(db,'SELECT * FROM conquest_members WHERE season_id=? AND user_id=?',season.id,user.id).first(),
  S(db,'SELECT gm.guild_id,g.name FROM guild_members gm JOIN guilds g ON g.id=gm.guild_id WHERE gm.user_id=?',user.id).first(),history(ctx)
 ]);
 const activeGuild=member&&guildMembership?.guild_id===member.guild_id?await S(db,'SELECT * FROM conquest_guilds WHERE season_id=? AND guild_id=?',season.id,member.guild_id).first():null;
 const reserves=activeGuild?supply(activeGuild,now,season):null;
 const roster=activeGuild?R(await S(db,`SELECT m.user_id,u.name,m.attack_points,m.reinforcement_points,m.transport_points,m.construction_points,m.actions FROM conquest_members m JOIN users u ON u.id=m.user_id WHERE m.season_id=? AND m.guild_id=? AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=m.user_id AND b.active=1) ORDER BY (m.attack_points+m.reinforcement_points+m.transport_points+m.construction_points) DESC,u.name LIMIT 50`,season.id,activeGuild.guild_id).all()).map(m=>({playerId:m.user_id,name:m.name,attack:Number(m.attack_points),reinforcement:Number(m.reinforcement_points),transport:Number(m.transport_points),construction:Number(m.construction_points),points:memberScore(m),actions:Number(m.actions),title:honor(memberScore(m))})):[];
 const records=activeGuild?R(await S(db,`SELECT q.result_json,q.created_at,q.user_id,u.name FROM conquest_requests q JOIN users u ON u.id=q.user_id WHERE q.season_id=? AND q.guild_id=? AND q.action<>'join' ORDER BY q.created_at DESC,q.request_id DESC LIMIT 30`,season.id,activeGuild.guild_id).all()).map(r=>({...JSON.parse(r.result_json),actorPlayerId:r.user_id,actorName:r.name,createdAt:iso(Number(r.created_at))})):[];
 await h.requireAccountAccess(db,user);
 const currentMembership=await S(db,'SELECT guild_id FROM guild_members WHERE user_id=?',user.id).first();
 if(activeGuild&&currentMembership?.guild_id!==activeGuild.guild_id)h.fail(409,'CONQUEST_MEMBERSHIP_CHANGED','同盟の所属が変わりました。大会を開き直してください。');
 const owned=R(castleResult).filter(c=>c.owner_guild_id===activeGuild?.guild_id).map(c=>c.castle_id);
 return{ok:true,serverNow:iso(now),season:seasonDto(season,now),rules:{...RULES,normalCampaignUnaffected:true,timezone:'Asia/Tokyo',schedule:'毎週土曜 00:00〜月曜 00:00（日本時間）',tactics:Object.entries(TACTICS).map(([id,t])=>({id,name:t.name})),scoreDescription:'領地価値×100＋初攻略城数×25＋防衛成功×20＋支援戦功（上限2,000）'},
  castles:R(castleResult).map(row=>{const c=BY_ID.get(row.castle_id);return{id:c.id,name:c.name,province:c.province,region:c.region,x:c.x,y:c.y,neighbors:c.neighbors.slice(),strategic:STRATEGIC.has(c.id),value:STRATEGIC.has(c.id)?4:1,ownerGuildId:row.owner_guild_id,ownerName:row.guild_name||null,garrison:Number(row.garrison),wall:Number(row.wall),stock:row.owner_guild_id===activeGuild?.guild_id?Number(row.stock):null,revision:Number(row.revision),protectedUntil:iso(Number(row.protected_until)),mine:row.owner_guild_id===activeGuild?.guild_id};}),standings,
  self:{joined:Boolean(member),lockedGuildId:member?.guild_id||null,currentGuildId:guildMembership?.guild_id||null,currentGuildName:guildMembership?.name||null,eligible:Boolean(guildMembership)&&(!member||member.guild_id===guildMembership.guild_id),points:memberScore(member),title:honor(memberScore(member)),nextActionAt:iso(Number(member?.last_action_at||0)+RULES.memberCooldownMs)},
  guild:activeGuild?{id:activeGuild.guild_id,name:activeGuild.guild_name,revision:Number(activeGuild.revision),troops:reserves.troops,supplies:reserves.supplies,nextReplenishAt:iso(reserves.replenishedAt+RULES.replenishMs),nextAttackAt:iso(Number(activeGuild.last_attack_at)+RULES.attackCooldownMs),ownedCastleIds:owned}:null,contributions:roster,records,history:past.seasons,best:past.best};
}
async function prior(ctx,requestId,digest){
 const receipt=await S(ctx.db,'SELECT * FROM conquest_requests WHERE user_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(receipt&&receipt.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別の大会操作に使われています。');return receipt;
}
async function result(ctx,receipt,idempotent){const current=await snapshot(ctx);return{...current,result:JSON.parse(receipt.result_json),idempotent};}
async function join(ctx){
 const {db,user,helpers:h}=ctx,raw=await h.readBody(ctx.request);strict(raw,['seasonId','requestId'],h);
 const requestId=h.idField(raw.requestId,'操作番号'),seasonId=h.idField(raw.seasonId,'大会'),digest=await h.hash(JSON.stringify(['join',seasonId])),old=await prior(ctx,requestId,digest);
 if(old)return result(ctx,old,true);
 const season=await ensureSeason(ctx);if(seasonId!==season.id)h.fail(409,'CONQUEST_SEASON_CHANGED','新しい大会へ切り替わっています。表示を更新してください。');
 const member=await memberContext(ctx),locked=await S(db,'SELECT guild_id FROM conquest_members WHERE season_id=? AND user_id=?',seasonId,user.id).first();
 if(locked&&locked.guild_id!==member.guildId)h.fail(409,'CONQUEST_GUILD_LOCKED','この大会は最初に参加した同盟でのみ出陣できます。次の大会から新しい同盟で参加できます。');
 await h.budget(db,'conquest-join:'+user.id,12,60000,Date.now());
 const nonce=crypto.randomUUID(),now=Date.now(),gateArgs=[user.id,requestId,nonce],message='大会に参加しました。同盟の兵と物資を共有し、仲間と天下を目指しましょう。';
 await db.batch([
  S(db,`INSERT INTO conquest_requests(user_id,request_id,season_id,guild_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,'join',?,?,?,? WHERE ${member.guard.sql} AND EXISTS(SELECT 1 FROM conquest_seasons WHERE id=? AND status='open' AND ends_at>?) AND NOT EXISTS(SELECT 1 FROM conquest_members WHERE season_id=? AND user_id=? AND guild_id<>?) ON CONFLICT(user_id,request_id) DO NOTHING`,user.id,requestId,seasonId,member.guildId,digest,nonce,JSON.stringify({action:'join',seasonId,message}),now,...member.guard.args,seasonId,now,seasonId,user.id,member.guildId),
  S(db,`INSERT INTO conquest_guilds(season_id,guild_id,guild_name,troops,supplies,replenished_at,joined_at) SELECT ?,?,?,?,?,?,? WHERE ${GATE} ON CONFLICT(season_id,guild_id) DO NOTHING`,seasonId,member.guildId,member.name,RULES.startTroops,RULES.startSupplies,Math.max(now,Number(season.starts_at)),now,...gateArgs),
  S(db,`INSERT INTO conquest_members(season_id,user_id,guild_id,joined_at) SELECT ?,?,?,? WHERE ${GATE} ON CONFLICT(season_id,user_id) DO NOTHING`,seasonId,user.id,member.guildId,now,...gateArgs)
 ]);
 const saved=await prior(ctx,requestId,digest);if(!saved)h.fail(409,'CONQUEST_MEMBERSHIP_CHANGED','所属または参加資格が変わりました。最新の状態を確認してください。');return result(ctx,saved,saved.commit_token!==nonce);
}

// Pure calculation is shared by the server's validation tests. Battles are
// deterministic: the preview is an estimate only while revisions can change.
export function conquestBattle({troops,tactic='balanced',garrison,wall}){
 const t=TACTICS[tactic]||TACTICS.balanced,attack=Math.round(troops*t.power),defense=Math.round((garrison+150)*(1+wall*.12*t.wall)),won=attack>defense;
 const attackerLost=Math.min(troops,Math.ceil(troops*(won?.12:.32)*t.loss)),enemyLost=won?garrison:Math.min(garrison,Math.floor(attack*.42));
 const survivors=troops-attackerLost,garrisonPlaced=won?Math.min(RULES.maxGarrison,Math.max(100,Math.floor(survivors*.45))):0;
 return{won,attackPower:attack,defensePower:defense,attackerLost,enemyLost,garrisonPlaced,returned:survivors-garrisonPlaced,supplyCost:Math.ceil((150+troops*.16)*t.cost)};
}
async function act(ctx){
 const {db,user,helpers:h}=ctx,raw=await h.readBody(ctx.request);
 strict(raw,['seasonId','requestId','action','castleId','fromCastleId','troops','amount','tactic','expectedGuildRevision','expectedCastleRevision','expectedSourceRevision'],h);
 const requestId=h.idField(raw.requestId,'操作番号'),seasonId=h.idField(raw.seasonId,'大会'),castleId=h.idField(raw.castleId,'城'),action=raw.action;
 if(!['attack','reinforce','transport','build'].includes(action)||!BY_ID.has(castleId))h.fail(400,'INVALID_INPUT','城と大会での役割を選んでください。');
 const guildRevision=integer(raw.expectedGuildRevision,'同盟の更新番号',0,1e9,h),castleRevision=integer(raw.expectedCastleRevision,'城の更新番号',0,1e9,h);
 const fromId=raw.fromCastleId==null||raw.fromCastleId===''?null:h.idField(raw.fromCastleId,'出陣元'),troops=['attack','reinforce'].includes(action)?integer(raw.troops,'兵数',100,10000,h):0,amount=action==='transport'?integer(raw.amount,'輸送物資',100,3000,h):0,tactic=action==='attack'?(raw.tactic||'balanced'):'balanced';
 if(!TACTICS[tactic])h.fail(400,'INVALID_INPUT','戦法を選んでください。');
 const sourceRevision=fromId?integer(raw.expectedSourceRevision,'出陣元の更新番号',0,1e9,h):null;
 const digest=await h.hash(JSON.stringify([seasonId,action,castleId,fromId,troops,amount,tactic,guildRevision,castleRevision,sourceRevision])),old=await prior(ctx,requestId,digest);
 if(old)return result(ctx,old,true);
 const season=await ensureSeason(ctx),now=Date.now();
 if(season.id!==seasonId||season.status!=='open'||now<Number(season.starts_at)||now>=Number(season.ends_at))h.fail(409,'CONQUEST_CLOSED','大会は毎週土曜 00:00〜月曜 00:00（日本時間）に開催します。');
 const member=await memberContext(ctx),participant=await S(db,'SELECT * FROM conquest_members WHERE season_id=? AND user_id=?',seasonId,user.id).first();
 if(!participant)h.fail(409,'CONQUEST_JOIN_REQUIRED','先に大会へ参加してください。');
 if(participant.guild_id!==member.guildId)h.fail(409,'CONQUEST_GUILD_LOCKED','大会中は参加時の同盟でのみ行動できます。');
 if(Number(participant.last_action_at)+RULES.memberCooldownMs>now)h.fail(429,'CONQUEST_COOLDOWN','次の行動まで少しお待ちください。');
 const [guild,castle,ownedResult]=await Promise.all([S(db,'SELECT * FROM conquest_guilds WHERE season_id=? AND guild_id=?',seasonId,member.guildId).first(),S(db,'SELECT * FROM conquest_castles WHERE season_id=? AND castle_id=?',seasonId,castleId).first(),S(db,'SELECT castle_id FROM conquest_castles WHERE season_id=? AND owner_guild_id=?',seasonId,member.guildId).all()]);
 if(!guild||!castle||Number(guild.revision)!==guildRevision||Number(castle.revision)!==castleRevision)h.fail(409,'CONQUEST_CHANGED','戦況が更新されました。最新の兵数と城を確認してください。');
 const own=castle.owner_guild_id===member.guildId,reserve=supply(guild,now,season),owned=R(ownedResult).map(c=>c.castle_id),next={owner:castle.owner_guild_id,garrison:Number(castle.garrison),wall:Number(castle.wall),stock:Number(castle.stock),protectedUntil:Number(castle.protected_until)};
 let source=null,battle=null,troopCost=0,poolSupplyCost=0,sourceStock=null,firstCapture=false,points=0,contributionColumn='',message='',defenseGuild=null;
 if(action==='attack'){
  if(own)h.fail(409,'CONQUEST_FRIENDLY_FIRE','同じ同盟の城には攻撃できません。');
  if(Number(guild.last_attack_at)+RULES.attackCooldownMs>now)h.fail(429,'CONQUEST_ATTACK_COOLDOWN','同盟の次の出陣まで少しお待ちください。');
  if(Number(castle.protected_until)>now)h.fail(409,'CONQUEST_PROTECTED','この城は攻略直後の保護期間です。');
  if(owned.length){
   if(!fromId||!BY_ID.get(fromId)?.neighbors.includes(castleId))h.fail(409,'CONQUEST_ADJACENCY','自同盟の城に隣接する城へ出陣してください。');
   source=await S(db,'SELECT * FROM conquest_castles WHERE season_id=? AND castle_id=?',seasonId,fromId).first();
   if(!source||source.owner_guild_id!==member.guildId||Number(source.revision)!==sourceRevision)h.fail(409,'CONQUEST_SOURCE_CHANGED','出陣元の領有または物資が更新されました。');
  }else if(fromId||STRATEGIC.has(castleId))h.fail(409,'CONQUEST_LANDING','最初の足場は通常城から選んでください。');
  if(troops>reserve.troops)h.fail(409,'CONQUEST_TROOPS','大会の待機兵が不足しています。');
  battle=conquestBattle({troops,tactic,garrison:Number(castle.garrison),wall:Number(castle.wall)});
  if(source){if(Number(source.stock)<battle.supplyCost)h.fail(409,'CONQUEST_STOCK','出陣元の物資が不足しています。輸送で補給してください。');sourceStock=Number(source.stock)-battle.supplyCost;}
  else{poolSupplyCost=battle.supplyCost;if(reserve.supplies<poolSupplyCost)h.fail(409,'CONQUEST_SUPPLIES','大会の共通物資が不足しています。');}
  troopCost=battle.attackerLost+battle.garrisonPlaced;
  if(battle.won){
   firstCapture=!await S(db,'SELECT 1 AS found FROM conquest_captures WHERE season_id=? AND guild_id=? AND castle_id=?',seasonId,member.guildId,castleId).first();
   next.owner=member.guildId;next.garrison=battle.garrisonPlaced;next.wall=Math.max(1,next.wall-1);next.stock=800;next.protectedUntil=now+RULES.captureProtectionMs;points=firstCapture?(STRATEGIC.has(castleId)?100:40):0;
   message=BY_ID.get(castleId).name+'を攻略しました。生存兵の一部を守備隊へ配置しました。';
  }else{next.garrison=Math.max(0,next.garrison-battle.enemyLost);defenseGuild=castle.owner_guild_id;message=BY_ID.get(castleId).name+'から撤退しました。敵の守備兵にも損害を与えました。';}
  contributionColumn='attack_points';
 }else{
  if(!own)h.fail(403,'CONQUEST_OWN_CASTLE','支援できるのは自同盟の城です。');
  if(fromId)h.fail(400,'INVALID_INPUT','この役割に出陣元の指定は不要です。');
  if(action==='reinforce'){
   if(troops>reserve.troops)h.fail(409,'CONQUEST_TROOPS','大会の待機兵が不足しています。');
   if(next.garrison+troops>RULES.maxGarrison)h.fail(409,'CONQUEST_GARRISON_FULL','城の守備兵は100,000,000人までです。');
   const cost=Math.ceil(troops*.08);if(next.stock<cost)h.fail(409,'CONQUEST_STOCK','城の物資が不足しています。先に輸送してください。');
   troopCost=troops;next.garrison+=troops;next.stock-=cost;points=Math.ceil(troops/100);contributionColumn='reinforcement_points';message=BY_ID.get(castleId).name+'へ援軍を配置しました。';
  }else if(action==='transport'){
   if(reserve.supplies<amount)h.fail(409,'CONQUEST_SUPPLIES','同盟の共通物資が不足しています。');
   if(next.stock+amount>RULES.maxStock)h.fail(409,'CONQUEST_STOCK_FULL','城の物資は100,000,000までです。');
   poolSupplyCost=amount;next.stock+=amount;points=Math.ceil(amount/100);contributionColumn='transport_points';message=BY_ID.get(castleId).name+'へ物資を届けました。';
  }else{
   if(next.wall>=RULES.maxWall)h.fail(409,'CONQUEST_WALL_MAX','城壁は最大まで強化されています。');
   const cost=400*(next.wall+1);if(next.stock<cost)h.fail(409,'CONQUEST_STOCK','普請の物資が不足しています。必要物資 '+cost+'。');
   next.stock-=cost;next.wall++;points=40;contributionColumn='construction_points';message=BY_ID.get(castleId).name+'の城壁を Lv.'+next.wall+' に強化しました。';
  }
 }
 // Support scores represent consumed deliveries/work and are season bounded.
 if(action!=='attack')points=Math.max(0,Math.min(points,1000-(Number(participant.reinforcement_points)+Number(participant.transport_points)+Number(participant.construction_points))));
 await h.budget(db,'conquest-action:'+user.id,12,60000,now);
 const nonce=crypto.randomUUID(),gateArgs=[user.id,requestId,nonce],record={action,seasonId,castleId,castleName:BY_ID.get(castleId).name,fromCastleId:fromId,troops,amount,tactic,points,message,...(battle?{battle}:{}),wall:next.wall,garrison:next.garrison,stock:next.stock};
 const sourceGuard=source?{sql:' AND EXISTS(SELECT 1 FROM conquest_castles WHERE season_id=? AND castle_id=? AND owner_guild_id=? AND revision=?)',args:[seasonId,fromId,member.guildId,sourceRevision]}:{sql:'',args:[]};
 const landingGuard=action==='attack'&&!source?{sql:' AND NOT EXISTS(SELECT 1 FROM conquest_castles WHERE season_id=? AND owner_guild_id=?)',args:[seasonId,member.guildId]}:{sql:'',args:[]};
 const captureGuard=firstCapture?{sql:' AND NOT EXISTS(SELECT 1 FROM conquest_captures WHERE season_id=? AND guild_id=? AND castle_id=?)',args:[seasonId,member.guildId,castleId]}:{sql:'',args:[]};
 await db.batch([
  S(db,`INSERT INTO conquest_requests(user_id,request_id,season_id,guild_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,?,?,? WHERE ${member.guard.sql}
   AND EXISTS(SELECT 1 FROM conquest_seasons WHERE id=? AND status='open' AND starts_at<=? AND ends_at>?)
   AND EXISTS(SELECT 1 FROM conquest_guilds WHERE season_id=? AND guild_id=? AND revision=?)
   AND EXISTS(SELECT 1 FROM conquest_members WHERE season_id=? AND user_id=? AND guild_id=? AND last_action_at=?)
   AND EXISTS(SELECT 1 FROM conquest_castles WHERE season_id=? AND castle_id=? AND revision=?)${sourceGuard.sql}${landingGuard.sql}${captureGuard.sql}
   ON CONFLICT(user_id,request_id) DO NOTHING`,user.id,requestId,seasonId,member.guildId,action,digest,nonce,JSON.stringify(record),now,...member.guard.args,seasonId,now,now,seasonId,member.guildId,guildRevision,seasonId,user.id,member.guildId,participant.last_action_at,seasonId,castleId,castleRevision,...sourceGuard.args,...landingGuard.args,...captureGuard.args),
  S(db,`UPDATE conquest_guilds SET guild_name=?,troops=?,supplies=?,replenished_at=?,revision=revision+1,captures=captures+?,support_points=support_points+?,last_attack_at=? WHERE season_id=? AND guild_id=? AND ${GATE}`,member.name,reserve.troops-troopCost,reserve.supplies-poolSupplyCost,reserve.replenishedAt,firstCapture?1:0,action==='attack'?0:points,action==='attack'?now:guild.last_attack_at,seasonId,member.guildId,...gateArgs),
  S(db,`UPDATE conquest_castles SET owner_guild_id=?,garrison=?,wall=?,stock=?,protected_until=?,revision=revision+1 WHERE season_id=? AND castle_id=? AND ${GATE}`,next.owner,next.garrison,next.wall,next.stock,next.protectedUntil,seasonId,castleId,...gateArgs),
  S(db,`UPDATE conquest_members SET ${contributionColumn}=${contributionColumn}+?,actions=actions+1,last_action_at=? WHERE season_id=? AND user_id=? AND ${GATE}`,points,now,seasonId,user.id,...gateArgs),
  ...(source?[S(db,`UPDATE conquest_castles SET stock=?,revision=revision+1 WHERE season_id=? AND castle_id=? AND ${GATE}`,sourceStock,seasonId,fromId,...gateArgs)]:[]),
  ...(firstCapture?[S(db,`INSERT INTO conquest_captures(season_id,guild_id,castle_id,user_id,captured_at) SELECT ?,?,?,?,? WHERE ${GATE} ON CONFLICT DO NOTHING`,seasonId,member.guildId,castleId,user.id,now,...gateArgs)]:[]),
  ...(defenseGuild?[S(db,`UPDATE conquest_guilds SET defenses=defenses+1,revision=revision+1 WHERE season_id=? AND guild_id=? AND ${GATE}`,seasonId,defenseGuild,...gateArgs)]:[])
 ]);
 const saved=await prior(ctx,requestId,digest);if(!saved){await h.requireAccountAccess(db,user);h.fail(409,'CONQUEST_CHANGED','別の領主の行動、所属変更または大会終了により戦況が変わりました。最新表示から選び直してください。');}
 return result(ctx,saved,saved.commit_token!==nonce);
}
export async function handleConquest(ctx){
 const {path,method,helpers:h}=ctx;await h.requireAccountAccess(ctx.db,ctx.user);
 if(path==='/conquest'&&method==='GET')return snapshot(ctx);
 if(path==='/conquest/history'&&method==='GET'){await settleEnded(ctx);return{ok:true,serverNow:iso(Date.now()),...(await history(ctx))};}
 if(path==='/conquest/join'&&method==='POST')return join(ctx);
 if(path==='/conquest/action'&&method==='POST')return act(ctx);
 h.fail(404,'NOT_FOUND','その共有天下統一の操作は見つかりませんでした。');
}
