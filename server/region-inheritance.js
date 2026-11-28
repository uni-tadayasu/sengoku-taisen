import {GameEngine} from './game-runtime.js';

// The engine owns the regional roster and the protected-city exclusions.
// Public projections reuse that same roster without simulating private saves.
const regions=globalThis.SENGOKU_DATA.regionConquest.regions;
const quote=value=>"'"+value.replaceAll("'","''")+"'";
export const regionNames=regions.map(row=>row.region);
export function inheritedCastleIds(ownedCastleIds){
 const complete=new Set(GameEngine.conqueredRegions(ownedCastleIds));
 return new Set(regions.filter(row=>complete.has(row.region)).flatMap(row=>row.castleIds));
}
export function inheritedStateCastles(state){
 return inheritedCastleIds(Object.entries(state.castles).filter(([,castle])=>castle.owner===state.clan).map(([id])=>id));
}
const rosterSql=row=>row.castleIds.map(quote).join(',');
const completeSql=row=>`(SELECT COUNT(*) FROM json_each(s.save_json,'$.state.castles') regional
 WHERE regional.key IN (${rosterSql(row)}) AND json_extract(regional.value,'$.owner')=json_extract(s.save_json,'$.state.clan'))=${row.castleIds.length}`;
export const anyInheritedRegionSql='('+regions.map(row=>'('+completeSql(row)+')').join(' OR ')+')';
export function inheritedCastleSql(castleId){
 const region=regions.find(row=>row.castleIds.includes(castleId));
 return region?'('+completeSql(region)+')':'0';
}
export function inheritedCastleCountSql(homeSql){
 return '('+regions.map(row=>`CASE WHEN ${completeSql(row)} THEN ${row.castleIds.length}-CASE WHEN (${homeSql}) IN (${rosterSql(row)}) THEN 1 ELSE 0 END ELSE 0 END`).join('+')+')';
}

// This is boundary history, not an ownership entitlement. A later battle may
// remove any inherited castle; only a new settlement can replace the history.
export function reconcileRegionInheritance(save,before,fail){
 const sameCampaign=before?.state.walking.campaignId===save.state.walking.campaignId;
 const retained=sameCampaign?(before.state.cycle?.retainedRegions||[]):[];
 if(sameCampaign&&JSON.stringify(save.state.cycle?.retainedRegions||[])!==JSON.stringify(retained))
  fail(409,'REGION_INHERITANCE_REQUIRED','地域継承に対応した最新の進行へ同期してください。画面を更新してから再開してください。');
 return [...retained];
}
