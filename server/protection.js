// Real-time newcomer and reconstruction protection; never restored from a save.
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
export const PROTECTION_RULES=Object.freeze({beginnerHours:24,repeatedWindowMinutes:30,repeatedHits:3,recoveryMinutes:120});
export async function enrollProtection(db,user,now){
 if(!user||user.is_admin||user.is_staff)return;
 const until=Number(user.created_at)+86400000;
 if(!Number.isFinite(until)||until<=now)return;
 await stmt(db,'INSERT INTO pvp_protection(user_id,beginner_until) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) ON CONFLICT(user_id) DO NOTHING',user.id,until,user.id).run();
}
export async function protectionStatus(db,userId,now){
 const p=await stmt(db,'SELECT * FROM pvp_protection WHERE user_id=?',userId).first();
 return {exists:!!p,beginnerUntil:p&&!p.ended_at?Number(p.beginner_until):0,recoveryUntil:Number(p?.recovery_until||0),beginnerActive:!!p&&!p.ended_at&&p.beginner_until>now,recoveryActive:Number(p?.recovery_until||0)>now,revision:Number(p?.revision||0),serverNow:now,rules:PROTECTION_RULES};
}
export async function prepareProtection(db,actor,target,now,{reward=false,fail}={}){
 const [a,d]=await Promise.all([protectionStatus(db,actor.id,now),protectionStatus(db,target.id,now)]);
 if(a.beginnerActive)fail(409,'BEGINNER_CONFIRM_REQUIRED','対人出陣の前に、初心者保護を解除する確認が必要です。');
 if(!reward&&(d.beginnerActive||d.recoveryActive))fail(409,'TARGET_REALTIME_PROTECTED',d.beginnerActive?'相手は初心者保護中です。':'相手は復興保護中です。');
 if(actor.guild_id&&actor.guild_id===target.guild_id)fail(409,'SAME_GUILD_TARGET','同じ同盟の仲間には出陣できません。');
 const guard={sql:`COALESCE((SELECT revision+1 FROM pvp_protection WHERE user_id=?),0)=? AND COALESCE((SELECT revision+1 FROM pvp_protection WHERE user_id=?),0)=? AND NOT EXISTS(SELECT 1 FROM guild_members a JOIN guild_members d ON d.guild_id=a.guild_id WHERE a.user_id=? AND d.user_id=?)`,args:[actor.id,a.exists?a.revision+1:0,target.id,d.exists?d.revision+1:0,actor.id,target.id]};
 const hits=await stmt(db,"SELECT COUNT(*) AS n FROM (SELECT id FROM field_battles WHERE defender_id=? AND created_at>? AND json_extract(result_json,'$.battleMode')<>'reward' UNION ALL SELECT id FROM covert_battles WHERE defender_id=? AND created_at>? AND json_extract(result_json,'$.castleId') NOT IN ('edo','kyoto_gosho'))",target.id,now-1800000,target.id,now-1800000).first();
 const shieldUntil=!reward&&Number(hits?.n||0)+1>=3?now+7200000:0;
 return {guard,shieldUntil};
}
export function protectionBattleStatements(db,targetId,now,shieldUntil,gate,args){
 if(!shieldUntil)return[];
 return[stmt(db,`INSERT INTO pvp_protection(user_id,beginner_until,recovery_until,revision) SELECT ?,0,?,1 WHERE ${gate}
 ON CONFLICT(user_id) DO UPDATE SET recovery_until=MAX(pvp_protection.recovery_until,excluded.recovery_until),revision=pvp_protection.revision+1`,targetId,shieldUntil,...args)];
}
export async function decorateProtectedTargets(db,players,viewer,now){
 if(!players.length)return players;
 const ids=[...new Set(players.map(p=>p.playerId))],placeholders=ids.map(()=>'?').join(',');
 const records=(await stmt(db,`SELECT u.id,g.guild_id,p.beginner_until,p.ended_at,p.recovery_until FROM users u LEFT JOIN guild_members g ON g.user_id=u.id LEFT JOIN pvp_protection p ON p.user_id=u.id WHERE u.id IN (${placeholders})`,...ids).all()).results||[];
 const map=new Map(records.map(p=>[p.id,p]));
 for(const player of players){
  const p=map.get(player.playerId),own=player.playerId===viewer?.id;
  const beginner=p&&!p.ended_at&&p.beginner_until>now,recovery=p&&p.recovery_until>now;
  const sameGuild=!own&&viewer?.guild_id&&viewer.guild_id===p?.guild_id;
  const protectedTarget=!own&&player.battleMode!=='reward'&&(beginner||recovery);
  player.protectionUntil=player.battleMode==='reward'?0:Math.max(beginner?p.beginner_until:0,recovery?p.recovery_until:0);
  if(sameGuild||protectedTarget){player.attackable=false;player.attackReason=sameGuild?'同じ同盟の仲間です。':beginner?'初心者保護中です。':'復興保護中です。';for(const branch of player.branches||[]){branch.attackable=false;branch.attackReason=player.attackReason;}}
 }
 return players;
}
export async function handleProtection(ctx){
 const {db,user,now,path,method,request,helpers:h}=ctx;
 await h.requireAccountAccess(db,user);
 if(path==='/protection'&&method==='GET'){
  await enrollProtection(db,user,now);return{ok:true,...await protectionStatus(db,user.id,now)};
 }
 if(path==='/protection/end'&&method==='POST'){
  const body=await h.readBody(request);if(body.confirm!==true)h.fail(400,'CONFIRM_REQUIRED','対人出陣に伴う初心者保護の解除を確認してください。');
  await enrollProtection(db,user,now);const g=h.accountCommitGuard(user);
  await stmt(db,`UPDATE pvp_protection SET ended_at=?,revision=revision+1 WHERE user_id=? AND ended_at IS NULL AND ${g.sql}`,now,user.id,...g.args).run();
  return{ok:true,...await protectionStatus(db,user.id,now)};
 }
 h.fail(404,'NOT_FOUND','保護の操作を確認してください。');
}
