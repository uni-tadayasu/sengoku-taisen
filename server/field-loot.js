// One policy for ordinary castles, major castles, special bases and branches.
// This helper is called only inside the server's receipt-gated battle result;
// both changed saves are persisted in one atomic, revision-checked D1 batch.
export const FIELD_LOOT_POLICY=Object.freeze({id:'half-resources-v1',fraction:.5,assetCap:100000000});
const RESOURCE_KEYS=Object.freeze(['gold','rice','wood','stone']);
export function applyFieldVictoryLoot(attacker,defender,won){
  const loot={};let capacityLimited=false;
  for(const key of RESOURCE_KEYS){
    const half=won?Math.floor(defender[key]*FIELD_LOOT_POLICY.fraction):0;
    const capacity=Math.max(0,FIELD_LOOT_POLICY.assetCap-attacker[key]);
    const amount=Math.min(half,capacity);
    loot[key]=amount;capacityLimited||=amount<half;
    attacker[key]+=amount;defender[key]-=amount;
  }
  return {loot,capacityLimited};
}
