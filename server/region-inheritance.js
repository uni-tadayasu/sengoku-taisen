import {GameEngine} from './game-runtime.js';

// The engine owns the regional roster and the protected-city exclusions.
// Public projections reuse that same roster without simulating private saves.
const regions=globalThis.SENGOKU_DATA.regionConquest.regions;
const castles=globalThis.SENGOKU_DATA.castles;
const quote=value=>"'"+value.replaceAll("'","''")+"'";
export const regionNames=regions.map(row=>row.region);
export function inheritedCastleIds(ownedCastleIds){
 const complete=new Set(GameEngine.conqueredRegions(ownedCastleIds));
 return new Set(regions.filter(row=>complete.has(row.region)).flatMap(row=>row.castleIds));
}
export function inheritedStateCastles(state){
 return new Set([...protectedStateCastles(state)].filter(id=>state.castles[id]?.owner===state.clan));
}
export function releasedCastleIds(state){const stored=state?.cycle?.releasedCastles;return castles.filter(c=>Array.isArray(stored)&&stored.includes(c.id)).map(c=>c.id);}
export function recordCastleRelease(state,castleId){
 if(!castles.some(c=>c.id===castleId)||['edo','kyoto_gosho','kagoshima'].includes(castleId))throw Error('Invalid released castle');
 if(!state.cycle)state.cycle={index:Math.floor(state.turn/globalThis.SENGOKU_DATA.worldCalendar.monthsPerCycle),home:state.home,latestReward:null,retainedRegions:[],protectedRegions:protectedRegionNames(state)};
 const released=new Set([...releasedCastleIds(state),castleId]);state.cycle.releasedCastles=castles.filter(c=>released.has(c.id)).map(c=>c.id);if(state.cycle.home===castleId)state.cycle.home=state.home;return[...state.cycle.releasedCastles];
}
export function protectedRegionNames(state,{legacy=true}={}){
 const stored=state?.cycle?.protectedRegions,owned=()=>Object.entries(state?.castles||{}).filter(([,castle])=>castle.owner===state.clan).map(([id])=>id);
 const names=stored===undefined&&legacy?GameEngine.conqueredRegions(owned()):Array.isArray(stored)?stored:[];
 return regionNames.filter(region=>names.includes(region));
}
export function protectedStateCastles(state,options){
 const protectedRegions=new Set(protectedRegionNames(state,options)),released=new Set(releasedCastleIds(state));
 return new Set(regions.filter(row=>protectedRegions.has(row.region)).flatMap(row=>row.castleIds).filter(id=>!released.has(id)));
}
export function isRegionProtectedCastle(state,castleId,options){return state?.castles?.[castleId]?.owner===state?.clan&&protectedStateCastles(state,options).has(castleId);}
export function recordRegionConquests(state,capturedCastleId=null){
 if(capturedCastleId&&state.castles[capturedCastleId]?.owner===state.clan)state.cycle.releasedCastles=releasedCastleIds(state).filter(id=>id!==capturedCastleId);
 const complete=new Set([...protectedRegionNames(state),...GameEngine.conqueredRegions(Object.entries(state.castles).filter(([,castle])=>castle.owner===state.clan).map(([id])=>id))]);
 state.cycle.protectedRegions=regionNames.filter(region=>complete.has(region));return [...state.cycle.protectedRegions];
}
const rosterSql=row=>row.castleIds.map(quote).join(',');
const completeSql=row=>`(SELECT COUNT(*) FROM json_each(s.save_json,'$.state.castles') regional
 WHERE regional.key IN (${rosterSql(row)}) AND json_extract(regional.value,'$.owner')=json_extract(s.save_json,'$.state.clan'))=${row.castleIds.length}`;
const entitledSql=row=>`(EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.cycle.protectedRegions') entitlement WHERE entitlement.value=${quote(row.region)}) OR (json_type(s.save_json,'$.state.cycle.protectedRegions') IS NULL AND ${completeSql(row)}))`;
const notReleasedSql=idSql=>`NOT EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.cycle.releasedCastles') released WHERE released.value=${idSql})`;
const retainedCountSql=(row,homeSql=null)=>`(SELECT COUNT(*) FROM json_each(s.save_json,'$.state.castles') regional WHERE regional.key IN (${rosterSql(row)}) AND json_extract(regional.value,'$.owner')=json_extract(s.save_json,'$.state.clan') AND ${notReleasedSql('regional.key')}${homeSql?' AND regional.key<>('+homeSql+')':''})`;
export const anyInheritedRegionSql='('+regions.map(row=>'('+entitledSql(row)+' AND '+retainedCountSql(row)+'>0)').join(' OR ')+')';
export function inheritedCastleSql(castleId){
 const region=regions.find(row=>row.castleIds.includes(castleId));
 return region?'('+entitledSql(region)+' AND '+notReleasedSql(quote(castleId))+')':'0';
}
export function inheritedCastleCountSql(homeSql){
 return '('+regions.map(row=>`CASE WHEN ${entitledSql(row)} THEN ${retainedCountSql(row,homeSql)} ELSE 0 END`).join('+')+')';
}

// Keep the boundary history distinct from the permanent ownership entitlement.
// Only a settlement replaces this history; protectedRegions records conquest
// immediately and is retained independently through later cycles.
export function reconcileRegionInheritance(save,before,fail){
 const sameCampaign=before?.state.walking.campaignId===save.state.walking.campaignId;
 const retained=sameCampaign?(before.state.cycle?.retainedRegions||[]):[];
 if(sameCampaign&&JSON.stringify(save.state.cycle?.retainedRegions||[])!==JSON.stringify(retained))
  fail(409,'REGION_INHERITANCE_REQUIRED','地域継承に対応した最新の進行へ同期してください。画面を更新してから再開してください。');
 return [...retained];
}

export function reconcileRegionProtection(save,before,fail){
 const sameCampaign=before?.state.walking.campaignId===save.state.walking.campaignId;
 // Initial/imported campaigns retain the existing game's ownership trust
 // boundary, but a claimed region name alone never grants an entitlement.
 // Later uploads can only carry the server's already confirmed protection.
 const canonical=sameCampaign?protectedRegionNames(before.state):GameEngine.conqueredRegions(Object.entries(save.state.castles).filter(([,castle])=>castle.owner===save.state.clan).map(([id])=>id));
 const incoming=protectedRegionNames(save.state,{legacy:false});
 if(incoming.some(region=>!canonical.includes(region))||sameCampaign&&canonical.some(region=>!incoming.includes(region)))
  fail(409,'REGION_INHERITANCE_REQUIRED','地域制覇による占領保護を最新の保存へ同期してください。画面を更新してから再開してください。');
 if(sameCampaign)for(const id of protectedStateCastles(before.state))if(save.state.castles[id]?.owner!==save.state.clan)
  fail(409,'REGION_INHERITANCE_REQUIRED','制覇済み地域の占領は保護されています。最新の領地へ同期してから再開してください。');
 return [...canonical];
}

export function reconcileReleasedCastles(save,before,fail){
 const sameCampaign=before?.state.walking.campaignId===save.state.walking.campaignId,incoming=releasedCastleIds(save.state),canonical=sameCampaign?releasedCastleIds(before.state):incoming;
 if(JSON.stringify(incoming)!==JSON.stringify(canonical)||canonical.some(id=>save.state.castles[id]?.owner===save.state.clan||sameCampaign&&before.state.captureRewards.includes(id)&&!save.state.captureRewards.includes(id)))
  fail(409,'REGION_INHERITANCE_REQUIRED','手放した城の記録が更新されています。最新の領地へ同期してから再開してください。');
 return[...canonical];
}
