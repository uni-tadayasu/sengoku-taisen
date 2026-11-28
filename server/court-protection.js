// Occupation protection follows current server-authorized court status.
// The Kyoto view includes the Emperor, but excludes the separate Regent and
// Retired Emperor titles. Resolve those records explicitly so their ordinary
// homes remain protected after delegation, abdication or a voluntary move.
// Client-supplied badges and historical nominations never confer protection.
export function courtProtectionSql(userIdSql) {
 return `(${userIdSql}=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  OR EXISTS(SELECT 1 FROM court_kyoto_offices cp_kyoto WHERE cp_kyoto.user_id=${userIdSql})
  OR EXISTS(SELECT 1 FROM court_external_offices cp_external WHERE cp_external.user_id=${userIdSql})
  OR ((EXISTS(SELECT 1 FROM court_regent cp_regent WHERE cp_regent.id=1 AND cp_regent.user_id=${userIdSql})
    OR EXISTS(SELECT 1 FROM court_retired_emperors cp_retired JOIN court_succession_requests cp_succession ON cp_succession.commit_token=cp_retired.succession_id
      AND cp_succession.actor_id=cp_retired.user_id AND cp_succession.target_id=cp_retired.successor_id WHERE cp_retired.user_id=${userIdSql}))
   AND NOT EXISTS(SELECT 1 FROM player_bans cp_ban WHERE cp_ban.user_id=${userIdSql} AND cp_ban.active=1)
   AND NOT EXISTS(SELECT 1 FROM player_expulsions cp_expulsion WHERE cp_expulsion.user_id=${userIdSql} AND cp_expulsion.pending=1)))`;
}

export async function readCourtProtection(db,userId) {
 const row=await db.prepare(`SELECT ${courtProtectionSql('cp_user.id')} AS protected FROM users cp_user WHERE cp_user.id=?`).bind(userId).first();
 const protectedBase=!!row?.protected;
 return {protected:protectedBase,guard:{
  sql:`EXISTS(SELECT 1 FROM users cp_user WHERE cp_user.id=? AND ${courtProtectionSql('cp_user.id')}=?)`,
  args:[userId,protectedBase?1:0]
 }};
}

// Old clients may upload a CPU defeat after the office was appointed. Keep
// established ownership within the same campaign/cycle without restoring
// resources, garrisons or damage. Explicit relocation and cycle settlement
// create their own authoritative campaign and are deliberately outside this.
export function retainCourtHoldings(save,before,user,clock) {
 const state=save?.state,prior=before?.state;
 if(!user.is_court_protected||!state||!prior||state.walking?.campaignId!==prior.walking?.campaignId
  ||state.clan!==prior.clan||state.cycle?.index!==prior.cycle?.index)return;
 let changed=false;
 for(const [id,castle]of Object.entries(prior.castles||{})){
  const current=state.castles?.[id];
  if(castle.owner===prior.clan&&current&&current.owner!==state.clan){
   current.owner=state.clan;
   // A captured castle's uploaded army belongs to the enemy, not its lord.
   current.troops=0;changed=true;
  }
 }
 if(changed){
  if(prior.castles?.[prior.home]?.owner===prior.clan)state.home=prior.home;
  state.gameOver=false;
  if(state.realtime)state.realtime.running=!!clock?.running;
 }
}
