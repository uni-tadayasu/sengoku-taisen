// Occupation protection is a property of a current, effective court office.
// Raw appointment rows and client-supplied badges never confer protection.
// The Kyoto view already removes retired emperors and the separate regency.
export function courtProtectionSql(userIdSql) {
 return `(${userIdSql}=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
  OR EXISTS(SELECT 1 FROM court_kyoto_offices cp_kyoto WHERE cp_kyoto.user_id=${userIdSql})
  OR EXISTS(SELECT 1 FROM court_external_offices cp_external WHERE cp_external.user_id=${userIdSql}))`;
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
