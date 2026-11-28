import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Structural condition shares the authoritative save/receipt transaction. It
// has its own game-time anchor so a delayed client cannot heal a recent siege.
export function durabilityElapsed(state){return Math.max(0,Math.round(Number(state?.worldClock?.elapsedMs??((state?.turn||0)*60000+(state?.realtime?.elapsed||0)*1000))));}
export function durabilityRecord(view){return{version:1,current:view.current,max:view.max,updatedElapsedMs:view.updatedElapsedMs,...(view.repairPendingHP!==undefined?{repairPendingHP:view.repairPendingHP}:{}),...(view.repairRemainder!==undefined?{repairRemainder:view.repairRemainder}:{})};}
const clone=value=>JSON.parse(JSON.stringify(value));
const recoveryMode=(state,id)=>id!=='kyoto_gosho'&&state.castles[id]?.owner===state.clan?'paid':'free';
export function castleDurability(state,castleId,elapsedMs=durabilityElapsed(state)){
 const row=state.castles[castleId],wall=row.wall;
 return GameEngine.durabilityView(row.durability,{castleId,level:row.level,wall,retainerCount:GameEngine.homeRetainerCount(state,castleId),elapsedMs,recoveryMode:recoveryMode(state,castleId)});
}
export function branchDurability(branch,elapsedMs){
 return GameEngine.durabilityView(branch.durability,{castleId:branch.parentCastleId,level:branch.level,branch:true,fallen:branch.fallen||branch.retreating,elapsedMs});
}
export function recordCastleSiege(state,castleId,{won,ratio=1,captured=false,elapsedMs=durabilityElapsed(state)}){
 const result=GameEngine.durabilityAfterBattle(castleDurability(state,castleId,elapsedMs),{won,ratio,captured,elapsedMs});
 state.castles[castleId].durability=result.record;return result;
}
// A legacy checkpoint receives its old free recovery only up to its own saved
// instant. Merely reading that checkpoint at a newer world time cannot heal it.
export function normalizeRepairProgress(state,raw,{isAdmin=false}={}){
 state.repair=GameEngine.normalizeRepairState(raw,state.turn);
 if(raw!==undefined)return state.repair;
 const elapsedMs=durabilityElapsed(state),anchor=(row,options)=>{
  if(row?.durability)row.durability={...durabilityRecord(GameEngine.durabilityView(row.durability,{...options,elapsedMs,recoveryMode:'free'})),repairPendingHP:0,repairRemainder:0};
 };
 for(const [castleId,row]of Object.entries(state.castles))if(recoveryMode(state,castleId)==='paid'&&(castleId!=='edo'||isAdmin))anchor(row,{castleId,level:row.level,wall:row.wall,retainerCount:GameEngine.homeRetainerCount(state,castleId)});
 for(const row of state.branches||[])if(recoveryMode(state,row.parentCastleId)==='paid'&&(row.parentCastleId!=='edo'||isAdmin))anchor(row,{castleId:row.parentCastleId,level:row.level,branch:true,fallen:row.fallen||row.retreating});
 return state.repair;
}
const count=(state,group,id)=>Number(state?.repair?.recovered?.[group]?.[id]||0);
function paidAnchor(raw,base,state,group,id,options){
 if(!raw||options.recoveryMode==='free')return raw;
 const difference=count(state,group,id)-count(base,group,id);
 if(!difference)return raw;
 const view=GameEngine.durabilityView(raw,options);
 // A proof replay may have repaired with a different private budget. Its
// simulated debit is never copied to the player's stock. Match its HP to the
// accepted paid receipt instead, and never add the same repair a second time.
 const added=difference>0?Math.min(difference,view.repairPendingHP||0,view.max-view.current):Math.max(difference,-view.current);
 // If a smaller household removes more capacity than the remaining HP, part
 // of a paid repair first offsets that loss. Preserve the absolute damage.
 const current=Math.max(0,Math.min(view.max,raw.current+view.max-raw.max+added));
 return{...durabilityRecord(view),current,repairPendingHP:Math.min(view.max-current,Math.max(0,(view.repairPendingHP||0)-Math.max(0,added))),repairRemainder:view.repairRemainder||0};
}
// Completion deadlines are authoritative only when their jobs already existed
// in the prior save. Queued jobs on the same structure run consecutively.
function castleTimeline(state,castleId,target,at){
 const retainerCount=GameEngine.homeRetainerCount(state,castleId);
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
  if(record)record=durabilityRecord(GameEngine.durabilityView(record,{castleId,level,wall,retainerCount,elapsedMs:event.at,recoveryMode:recoveryMode(state,castleId)}));
 }
 // Unobserved construction may add capacity, but cannot claim repair at the
 // larger maximum before its completion has been established.
 if(record&&(level!==target.level||wall!==target.wall))record=durabilityRecord(GameEngine.durabilityView(record,{castleId,level:target.level,wall:target.wall,retainerCount,elapsedMs:at,recoveryMode:recoveryMode(state,castleId)}));
 return record;
}

// An imported local journey can legitimately restore a breached castle when
// it arrives. Replay the already trusted departure, never a newly uploaded
// owner flag or battle receipt. Online journeys are settled by their ledger.
function replayLocalCapture(before,state,admitted){
 const prior=before.state,march=prior.march;
 if(march?.authority!=='local'||march.kind!=='castle'||march.arrivesElapsedMs>admitted||state.castles[march.targetCastleId]?.owner!==state.clan||prior.castles[march.targetCastleId]?.owner===prior.clan)return null;
 try{
  const game=GameEngine.fromSave(before,GAME_OFFICERS,{isAdmin:prior.clan==='德川家'&&prior.home==='edo',isStaff:prior.home==='kyoto_gosho',isDeputy:prior.home==='kagoshima'});
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
  const base=authority?.state||prior,options={castleId:id,level:row.level,wall:row.wall,retainerCount:GameEngine.homeRetainerCount(state,id),elapsedMs:at,recoveryMode:recoveryMode(base,id)};
  const anchor=paidAnchor(castleTimeline(base,id,row,at),base,state,'castles',id,options),canonical=GameEngine.durabilityView(anchor,options),incoming=GameEngine.durabilityView(row.durability,options);
  const predatesCapture=authority?.captured&&Number(row.durability?.updatedElapsedMs||0)<authority.record.updatedElapsedMs;
  if(!predatesCapture&&incoming.current<canonical.current){
   // A fresh loss is allowed; normalize its capacity so a fabricated stored
   // maximum cannot increase the subsequent repair rate.
   const submitted=GameEngine.normalizeDurability(row.durability);
   row.durability=options.recoveryMode==='paid'?{...durabilityRecord(incoming),repairPendingHP:Math.min(incoming.repairPendingHP||0,canonical.repairPendingHP||0),repairRemainder:Math.min(incoming.repairRemainder||0,canonical.repairRemainder||0)}:submitted?.max===canonical.max?submitted:durabilityRecord(incoming);
  }else if(anchor)row.durability=anchor;
  else delete row.durability;
 }
}

function repairError(message){const error=new Error(message);error.code='REPAIR_STATE_CHANGED';throw error;}
function receiptFromCounters(recovered,settledTurn){
 const total=Object.values(recovered.castles).concat(Object.values(recovered.branches)).reduce((sum,value)=>sum+BigInt(value),0n),spent={},credit={};
 for(const [key,rate]of [['wood',5n],['stone',4n]]){const units=(total*rate+99n)/100n;spent[key]=Number(units);credit[key]=Number(units*100n-total*rate);}
 return GameEngine.normalizeRepairState({version:1,settledTurn,spent,credit,recovered},settledTurn);
}
function mergeCounters(a,b){return Object.fromEntries(['castles','branches'].map(group=>[group,Object.fromEntries([...new Set([...Object.keys(a[group]),...Object.keys(b[group])])].map(id=>[id,Math.max(a[group][id]||0,b[group][id]||0)]))]));}
function availableReceipt(base,wanted,resources){
 const allocations=[];let total=0;
 for(const group of ['castles','branches'])for(const [id,value]of Object.entries(wanted.recovered[group])){const delta=value-(base.recovered[group][id]||0);if(delta>0){allocations.push({group,id,delta});total+=delta;}}
 const affordable=Math.min(total,...[['wood',5],['stone',4]].map(([key,rate])=>Math.floor((resources[key]*100+base.credit[key])/rate)));
 if(affordable>=total)return wanted;
 let remainder=affordable;
 const recovered=clone(base.recovered);
 for(const row of allocations){row.take=total?Math.floor(row.delta*affordable/total):0;remainder-=row.take;}
 allocations.sort((a,b)=>(b.delta*affordable%total)-(a.delta*affordable%total)||((a.group+':'+a.id)<(b.group+':'+b.id)?-1:1));
 for(const row of allocations){if(remainder&&row.take<row.delta){row.take++;remainder--;}recovered[row.group][row.id]=(recovered[row.group][row.id]||0)+row.take;}
 return receiptFromCounters(recovered,wanted.settledTurn);
}
function validateRepairIncrease(state,prior,incoming,clock,proofs){
 const previous=prior.repair,months=Math.max(0,incoming.settledTurn-previous.settledTurn),end=Math.min(clock.elapsedMs,incoming.settledTurn*60000),start=durabilityElapsed(prior),elapsed=Math.max(0,end-start),recovered=clone(incoming.recovered);
 for(const group of ['castles','branches'])for(const [id,value]of Object.entries(incoming.recovered[group])){
  const delta=value-(previous.recovered[group][id]||0);if(delta<=0)continue;
  if(!months)repairError('同じ月の修復を重複して保存できません。最新の保存へ同期してください。');
  const old=group==='castles'?prior.castles[id]:(prior.branches||[]).find(row=>row.id===id),row=group==='castles'?state.castles[id]:(state.branches||[]).find(row=>row.id===id),options=group==='castles'?{castleId:id,retainerCount:GameEngine.homeRetainerCount(state,id),level:Math.max(old?.level||1,row?.level||1),wall:Math.max(old?.wall||1,row?.wall||1)}:{castleId:row?.parentCastleId||old?.parentCastleId,level:Math.max(old?.level||0,row?.level||0),branch:true};
  // A repair may already have been paid while more retainers occupied the
  // home. Its previous committed siege/repair anchor supplied that work rate.
  const startingCastle=group==='castles'&&id===(prior.cycle?.home||prior.home);
  const maximum=Math.max(GameEngine.durabilityMax(options),startingCastle?old?.durability?.max||0:0),proven=Math.max(0,...proofs.map(proof=>count(proof,group,id)-(previous.recovered[group][id]||0))),work=Math.floor(maximum*elapsed/600000)+(old?.durability?.repairPendingHP||0)+1;
  if(delta>Math.max(proven,Math.min(months*Math.round(maximum*.1),work)))repairError('修復量と経過した月を確認できません。最新の保存へ同期してください。');
  // A foreign battle can be newer than the defender's economic checkpoint.
  // The client may have paid using the superseded pre-siege anchor. Admit
  // only work after the authoritative hit and refund that unperformed part.
  // A hit produced inside this very proof is different: its earlier paid HP
  // was actually spent before the hit and must remain in the cumulative bill.
  if(Number(old?.durability?.updatedElapsedMs)>start){
   const duration=Math.max(0,end-old.durability.updatedElapsedMs),afterHit=Math.floor((maximum*duration+(old.durability.repairRemainder||0))/600000)+(old.durability.repairPendingHP||0),limit=Math.max(proven,Math.min(months*Math.round(maximum*.1),afterHit));
   recovered[group][id]=(previous.recovered[group][id]||0)+Math.min(delta,limit);
  }
 }
 return receiptFromCounters(recovered,incoming.settledTurn);
}
// This is the only repair/resource merge for an uploaded campaign. Ordinary
// construction, rewards and other local stock changes remain in the upload.
// Replays prove battles with paid repairs enabled, but their resources are
// scratch values: adopting them would charge an already-paid client twice.
export function reconcilePaidRepairs(save,before,clock,{hasRepairReceipt=true,trustedStates=[],branchState=null,isAdmin=false,isStaff=false,isDeputy=false,isCourtProtected=false,courtEstateProjection=null}={}){
 const state=save.state,submitted=hasRepairReceipt?clone(state.repair):null,startResources={wood:state.resources.wood,stone:state.resources.stone},prior=before?.state;
 if(!prior||state.walking.campaignId!==prior.walking.campaignId){
  // Establish the first trusted anchor at the capacity of the actual seat.
  const id=state.cycle?.home||state.home,row=state.castles[id];
  if(row?.durability){
   const view=castleDurability(state,id,row.durability.updatedElapsedMs);
   if(row.durability.max!==view.max)row.durability=durabilityRecord(view);
  }
  return null;
 }
 const previous=GameEngine.normalizeRepairState(prior.repair,prior.turn),client=GameEngine.normalizeRepairState(state.repair,state.turn),proofs=trustedStates.filter(value=>value?.walking?.campaignId===state.walking.campaignId);
 if(!proofs.length&&durabilityElapsed(state)>durabilityElapsed(prior)){
  try{
   const game=GameEngine.fromSave(before,GAME_OFFICERS,{isAdmin,isStaff,isDeputy,isCourtProtected,courtEstateProjection}),result=game.applyWorldClock({...clock,elapsedMs:Math.min(clock.elapsedMs,durabilityElapsed(state))},{maxSeconds:86400,deferCycleSettlement:true,rebalanceTroops:false});
   if(result.ok&&!result.pending&&!result.settlementRequired)proofs.push(game.state);
  }catch{}
 }
 const baseline={...prior,repair:previous};
 const admitted=hasRepairReceipt?validateRepairIncrease(state,baseline,client,clock,proofs):null;
 let accepted=receiptFromCounters(hasRepairReceipt?mergeCounters(previous.recovered,admitted.recovered):clone(previous.recovered),Math.max(previous.settledTurn,hasRepairReceipt?client.settledTurn:previous.settledTurn));
 const submittedSpent=hasRepairReceipt?client.spent:previous.spent;
 for(const key of ['wood','stone']){
  const owed=accepted.spent[key]-submittedSpent[key];
  if(owed>state.resources[key])repairError('確定済み修復の資材を確認できません。最新の保存へ同期してください。');
  state.resources[key]=Math.min(GameEngine.ASSET_CAP,state.resources[key]-owed);
 }
 // Old clients and explicitly deferred checkpoints have not paid the elapsed
// months. Use the monthly proof receipt, limited to their remaining real stock.
 if(accepted.settledTurn<state.turn){
  let recovered=clone(accepted.recovered),turn=accepted.settledTurn;
  for(const proof of proofs)if(proof.repair&&proof.repair.settledTurn<=state.turn){recovered=mergeCounters(recovered,proof.repair.recovered);turn=Math.max(turn,proof.repair.settledTurn);}
  const wanted=receiptFromCounters(recovered,Math.max(turn,state.turn)),affordable=availableReceipt(accepted,wanted,state.resources);
  for(const key of ['wood','stone'])state.resources[key]-=affordable.spent[key]-accepted.spent[key];
  accepted=affordable;
 }
 state.repair=accepted;
 reconcileCastleDurability(save,before,clock,{trustedStates:proofs});
 const branchBase=branchState||proofs.find(proof=>(proof.branches||[]).length)||baseline;
 for(const row of state.branches||[]){
  if(!row.durability||row.fallen||row.retreating||row.level<1||recoveryMode(state,row.parentCastleId)!=='paid')continue;
  row.durability=paidAnchor(row.durability,branchBase,state,'branches',row.id,{castleId:row.parentCastleId,level:row.level,branch:true,elapsedMs:Math.min(clock.elapsedMs,durabilityElapsed(state)),recoveryMode:'paid'});
 }
 const resources={wood:state.resources.wood-startResources.wood,stone:state.resources.stone-startResources.stone};
 return JSON.stringify(submitted)!==JSON.stringify(state.repair)||resources.wood||resources.stone?{version:1,before:submitted,after:clone(state.repair),resources}:null;
}
