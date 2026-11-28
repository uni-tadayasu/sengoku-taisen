// The completed ordination ledger is the permanent receipt. It remains when
// a former cloistered Emperor changes title, starts another campaign or imports
// an older save; the current title and client-provided flags grant nothing.
const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
export const CLOISTERED_REWARD=Object.freeze({officerId:'special_goshirakawa_hoo',name:'後白河法皇',rank:'U'});
const PAIR=CLOISTERED_REWARD.officerId+':'+CLOISTERED_REWARD.rank;

export async function readCloisteredReward(db,userId){
 const row=await S(db,`SELECT MIN(o.created_at) AS earned_at
  FROM court_ordination_requests o JOIN court_succession_requests s
   ON s.commit_token=o.succession_id AND s.actor_id=o.actor_id
  WHERE o.actor_id=? AND o.created_at>=s.created_at`,userId).first();
 const earnedAt=row?.earned_at==null?null:Number(row.earned_at);
 return{...CLOISTERED_REWARD,earned:Number.isSafeInteger(earnedAt)&&earnedAt>=0,earnedAt};
}
export function applyCloisteredReward(save,reward,fail){
 const state=save?.state;if(!state)return save;
 const id=CLOISTERED_REWARD.officerId,owned=reward?.earned===true;
 if((state.officers.includes(id)||state.officerVariants.some(pair=>pair.split(':')[0]===id))&&!owned||state.officerVariants.some(pair=>pair.split(':')[0]===id&&pair!==PAIR)||state.gachaHistory.some(result=>result.officerId===id)){
  fail(409,'CLOISTERED_REWARD_REQUIRED','後白河法皇は法皇への就任が確定した領主だけが獲得できます。最新のクラウド保存を読み込んでください。');
 }
 if(owned){
  if(!state.officers.includes(id))state.officers.push(id);
  if(!state.officerVariants.includes(PAIR))state.officerVariants.push(PAIR);
  if(state.officerHealth?.values&&!Object.hasOwn(state.officerHealth.values,id))state.officerHealth.values[id]=100;
 }
 return save;
}
export async function reconcileCloisteredReward(db,userId,save,fail){
 return applyCloisteredReward(save,await readCloisteredReward(db,userId),fail);
}
