import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Structural condition shares the authoritative save/receipt transaction. It
// has its own game-time anchor so a delayed client cannot heal a recent siege.
export function durabilityElapsed(state){return Math.max(0,Math.round(Number(state?.worldClock?.elapsedMs??((state?.turn||0)*60000+(state?.realtime?.elapsed||0)*1000))));}
export function durabilityRecord(view){return{version:1,current:view.current,max:view.max,updatedElapsedMs:view.updatedElapsedMs};}
export function castleDurability(state,castleId,elapsedMs=durabilityElapsed(state)){
 const row=state.castles[castleId],wall=row.wall;
 return GameEngine.durabilityView(row.durability,{castleId,level:row.level,wall,elapsedMs});
}
export function branchDurability(branch,elapsedMs){
 return GameEngine.durabilityView(branch.durability,{castleId:branch.parentCastleId,level:branch.level,branch:true,fallen:branch.fallen||branch.retreating,elapsedMs});
}
export function recordCastleSiege(state,castleId,{won,ratio=1,captured=false,elapsedMs=durabilityElapsed(state)}){
 const result=GameEngine.durabilityAfterBattle(castleDurability(state,castleId,elapsedMs),{won,ratio,captured,elapsedMs});
 state.castles[castleId].durability=result.record;return result;
}
// Completion deadlines are authoritative only when their jobs already existed
// in the prior save. Queued jobs on the same structure run consecutively.
function castleTimeline(state,castleId,target,at){
 const source=state.castles[castleId],start=durabilityElapsed(state),ends=new Map(),events=[];
 let record=GameEngine.normalizeDurability(source.durability),level=source.level,wall=source.wall;
 for(const job of state.jobs||[]){
  const castle=job.kind==='castle'&&job.id===castleId,home=state.staffService?.personalHome||state.home;
  const rampart=job.kind==='building'&&job.id==='wall'&&home===castleId;
  if(!castle&&!rampart)continue;
  const key=job.kind+':'+job.id,seconds=Number(job.remainingSeconds??Number(job.remaining)*60);
  if(!Number.isFinite(seconds)||seconds<0)continue;
  const deadline=(ends.get(key)??start)+Math.round(seconds*1000);ends.set(key,deadline);
  if(deadline<=at&&job.targetLevel<=(castle?target.level:target.wall))events.push({at:deadline,castle,level:job.targetLevel});
 }
 events.sort((a,b)=>a.at-b.at);
 for(const event of events){
  if(event.castle)level=Math.max(level,event.level);else wall=Math.max(wall,event.level);
  if(record)record=durabilityRecord(GameEngine.durabilityView(record,{castleId,level,wall,elapsedMs:event.at}));
 }
 // Unobserved construction may add capacity, but cannot claim repair at the
 // larger maximum before its completion has been established.
 if(record&&(level!==target.level||wall!==target.wall))record=durabilityRecord(GameEngine.durabilityView(record,{castleId,level:target.level,wall:target.wall,elapsedMs:at}));
 return record;
}

// An imported local journey can legitimately restore a breached castle when
// it arrives. Replay the already trusted departure, never a newly uploaded
// owner flag or battle receipt. Online journeys are settled by their ledger.
function replayLocalCapture(before,state,admitted){
 const prior=before.state,march=prior.march;
 if(march?.authority!=='local'||march.kind!=='castle'||march.arrivesElapsedMs>admitted||state.castles[march.targetCastleId]?.owner!==state.clan||prior.castles[march.targetCastleId]?.owner===prior.clan)return null;
 try{
  const game=GameEngine.fromSave(before,GAME_OFFICERS,{isAdmin:prior.clan==='德川家'&&prior.home==='edo',isStaff:prior.home==='kyoto_gosho'});
  const start=durabilityElapsed(prior),seconds=Math.max(0,march.arrivesElapsedMs-start)/1000;
  if(seconds>86400)return null;
  game._advanceRealtime(seconds,{rebalanceTroops:false});game.resolveDueMarches();
  const result=game.state.marchHistory.find(row=>row.id===march.id);
  if(result?.status!=='resolved'||!result.battle?.won||!result.battle.durability?.captured)return null;
  if(game.state.worldClock)game.state.worldClock.elapsedMs=game.state.turn*60000+Math.round(game.state.realtime.elapsed*1000);
  return{castleId:march.targetCastleId,state:game.state};
 }catch{return null;}
}

export function reconcileCastleDurability(save,before,clock,{trustedStates=[]}={}){
 const state=save.state,prior=before?.state;
 if(!prior||state.walking?.campaignId!==prior.walking?.campaignId)return;
 const admitted=Math.min(clock.elapsedMs,durabilityElapsed(state)),local=replayLocalCapture(before,state,admitted),provenStates=trustedStates.filter(value=>value?.walking?.campaignId===state.walking.campaignId);
 for(const [id,row] of Object.entries(state.castles)){
  const old=prior.castles?.[id];if(!old||!old.durability&&!row.durability&&!provenStates.some(value=>value.castles?.[id]?.durability)&&local?.castleId!==id)continue;
  // A battle may be newer than the defender's economic checkpoint. Its
  // damage anchor is a lower bound, never a source of backwards recovery.
  let at=Math.max(admitted,Number(old.durability?.updatedElapsedMs||0)),authority=null;
  for(const proven of [...provenStates,...(local?.castleId===id?[local.state]:[])]){
   const current=proven?.castles?.[id];
   if(proven?.walking?.campaignId!==state.walking.campaignId||!current?.durability||current.owner!==row.owner)continue;
   const record=GameEngine.normalizeDurability(current.durability),oldAt=Number(old.durability?.updatedElapsedMs||0);
   if(record.updatedElapsedMs<oldAt||record.updatedElapsedMs>clock.elapsedMs)continue;
   if(current.owner===old.owner&&current.level===old.level&&current.wall===old.wall&&JSON.stringify(record)===JSON.stringify(old.durability))continue;
   if(!authority||record.updatedElapsedMs>authority.record.updatedElapsedMs||record.updatedElapsedMs===authority.record.updatedElapsedMs&&record.current<authority.record.current)authority={state:proven,record,captured:current.owner!==old.owner};
  }
  if(authority)at=Math.max(at,authority.record.updatedElapsedMs);
  const options={castleId:id,level:row.level,wall:row.wall,elapsedMs:at},base=authority?.state||prior;
  const anchor=castleTimeline(base,id,row,at),canonical=GameEngine.durabilityView(anchor,options),incoming=GameEngine.durabilityView(row.durability,options);
  const predatesCapture=authority?.captured&&Number(row.durability?.updatedElapsedMs||0)<authority.record.updatedElapsedMs;
  if(!predatesCapture&&incoming.current<canonical.current){
   // A fresh loss is allowed; normalize its capacity so a fabricated stored
   // maximum cannot increase the subsequent repair rate.
   const submitted=GameEngine.normalizeDurability(row.durability);
   row.durability=submitted?.max===canonical.max?submitted:durabilityRecord(incoming);
  }else if(anchor)row.durability=anchor;
  else delete row.durability;
 }
}
