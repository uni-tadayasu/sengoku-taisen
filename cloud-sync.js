/* 戦国VS・端末間の自動保存。一つの領主につき、進行する端末は一つ。 */
(function(global){
'use strict';
const NAME_KEY='sengoku-device-name-v1',PENDING_KEY='sengoku-sync-pending-v1';
function fingerprint(save){
 if(!save||typeof save!=='object'||!save.state||typeof save.state!=='object')return'';
 const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;
 // Household strength has its own roster revision. Admissions and departures
 // must not invalidate the pending edits attached to this personal save.
 const {retainerSupport,...personalState}=save.state;
 return JSON.stringify(sorted(personalState));
}
function hash(value){let a=2166136261,b=3339675911;const imul=Math.imul;for(let i=0;i<value.length;i++){const code=value.charCodeAt(i);a=imul(a^code,16777619);b=imul(b^code,2246822519);}return(a>>>0).toString(16)+':'+(b>>>0).toString(16);}
// The server may project an earned, permanent reward before the personal save
// revision changes. Admit only this known additive grant; economic, campaign
// and authority changes still use the ordinary canonical recovery path.
function mergeCloisteredReward(sent,snapshot,current,{exact=false}={}){
 const id='special_goshirakawa_hoo',pair=id+':U',receipt=snapshot.cloisteredReward,a=sent?.state,b=snapshot.save?.state,c=current?.state;
 if(receipt?.officerId!==id||receipt.rank!=='U'||receipt.earned!==true||!Number.isSafeInteger(receipt.earnedAt)||receipt.earnedAt<0||![a,b,c].every(state=>Array.isArray(state?.officers)&&Array.isArray(state?.officerVariants)))return null;
 const values=state=>state.officerHealth?.values,healthMap=state=>values(state)&&typeof values(state)==='object'&&!Array.isArray(values(state));
 const add={officer:!a.officers.includes(id),variant:!a.officerVariants.includes(pair),health:healthMap(a)&&!Object.hasOwn(values(a),id)};
 if(!Object.values(add).some(Boolean)||!b.officers.includes(id)||!b.officerVariants.includes(pair)||add.health&&values(b)?.[id]!==100)return null;
 function grant(save){
  const next=JSON.parse(JSON.stringify(save)),state=next.state;let changed=false;
  if(add.officer&&!state.officers.includes(id)){state.officers.push(id);changed=true;}
  if(add.variant&&!state.officerVariants.includes(pair)){state.officerVariants.push(pair);changed=true;}
  if(add.health&&healthMap(state)&&!Object.hasOwn(values(state),id)){values(state)[id]=100;changed=true;}
  return{save:next,changed};
 }
 if(exact&&fingerprint(grant(sent).save)!==fingerprint(snapshot.save))return null;
 return grant(current);
}
// Reconcile only the authoritative branch/parent delta. A resource tick or a
// new ordinary action must not prevent that delta, or be rolled back by it.
function mergeBranchCorrection(sent,canonical,current,{troopsSeparate=false}={}){
 const a=sent?.state,b=canonical?.state,c=current?.state,copy=value=>JSON.parse(JSON.stringify(value)),same=(left,right)=>fingerprint({state:left})===fingerprint({state:right});
 if(!a||!b||!c)return{changed:false,pending:false};
 const parents=[...new Set([...(a.branches||[]),...(b.branches||[])].map(row=>row.parentCastleId))].filter(id=>['edo','nijo','osaka','nagoya'].includes(id));
 if(!parents.length)return{changed:false,pending:false};
 if(!a.walking?.campaignId||a.walking.campaignId!==b.walking?.campaignId||a.walking.campaignId!==c.walking?.campaignId||a.clan!==b.clan||a.clan!==c.clan||a.worldClock?.id!==b.worldClock?.id||a.worldClock?.id!==c.worldClock?.id)return{changed:false,pending:true};
 const elapsed=state=>Number.isFinite(state.worldClock?.elapsedMs)?state.worldClock.elapsedMs:(state.turn||0)*60000+(state.realtime?.elapsed||0)*1000,at=elapsed(c);
 function parts(state,parent){
  const branches=copy((state.branches||[]).filter(row=>row.parentCastleId===parent)).sort((x,y)=>x.id.localeCompare(y.id)),byId=new Map(branches.map(row=>[row.id,row])),jobs=[];
  for(const job of state.jobs||[]){if(job.kind!=='branch'||!byId.has(job.id))continue;const deadline=Number.isSafeInteger(job.completesElapsedMs)?job.completesElapsedMs:Math.round(elapsed(state)+job.remainingSeconds*1000),remainingSeconds=Math.min(job.totalSeconds,Math.max(0,(deadline-at)/1000));
   if(remainingSeconds<=1e-8){const branch=byId.get(job.id);if(job.facilityId){global.SengokuEngine?.completeBranchFacility?.(branch,job,deadline);}else{branch.level=job.targetLevel;branch.fallen=false;if(job.repair)delete branch.durability;else if(branch.durability&&global.SengokuEngine?.durabilityView){const view=global.SengokuEngine.durabilityView(branch.durability,{castleId:branch.parentCastleId,level:branch.level,branch:true,elapsedMs:deadline});branch.durability=conditionRecord(view);}}}
   else jobs.push({...copy(job),completesElapsedMs:deadline,remainingSeconds,remaining:Math.ceil((remainingSeconds-1e-8)/60)});
  }
  jobs.sort((x,y)=>x.id.localeCompare(y.id));return{owner:state.castles?.[parent]?.owner,branches,jobs};
 }
 const semantic=part=>({...part,branches:part.branches.map(({durability,...branch})=>branch),...(troopsSeparate?{branches:part.branches.map(({stationedTroops,durability,...branch})=>branch)}:{}),jobs:part.jobs.map(({remaining,remainingSeconds,...job})=>job)}),changes=[];let hasDelta=false;
 for(const parent of parents){const before=parts(a,parent),after=parts(b,parent),live=parts(c,parent);if(same(semantic(before),semantic(after)))continue;hasDelta=true;if(same(semantic(live),semantic(after)))continue;
  // A later branch action or CPU transition needs its own authoritative reply.
  if(!same(semantic(live),semantic(before)))return{changed:false,pending:true};changes.push({parent,after});
 }
 if(!hasDelta)return{changed:false,pending:false};
 const paths=[['home'],['cycle','home'],['gameOver'],['won'],['realtime','running']],read=(state,path)=>path.reduce((value,key)=>value?.[key],state),summary=[];
 for(const path of paths){const before=read(a,path),after=read(b,path),live=read(c,path);if(before===after||live===after||after===undefined)continue;if(live!==before)return{changed:false,pending:true};summary.push({path,value:after});}
 if(!changes.length&&!summary.length)return{changed:false,pending:false};
 const merged=copy(current),state=merged.state;
 for(const {parent,after}of changes){if(!state.castles?.[parent])return{changed:false,pending:true};state.castles[parent].owner=after.owner;const liveBranches=new Map((state.branches||[]).map(row=>[row.id,row]));state.branches=(state.branches||[]).filter(row=>row.parentCastleId!==parent).concat(after.branches.map(branch=>{const live=liveBranches.get(branch.id);return live&&!branch.fallen&&!branch.retreating&&branch.level>=live.level&&!live.fallen&&!live.retreating?{...branch,...(live.durability?{durability:copy(live.durability)}:{})}:branch;}));state.jobs=(state.jobs||[]).filter(job=>job.kind!=='branch'||!job.id.startsWith(parent+'_')).concat(after.jobs);}
 const commanders=new Set((state.branches||[]).flatMap(branch=>branch.commanders||[]));for(const [facility,id]of Object.entries(state.governors||{}))if(commanders.has(id))delete state.governors[facility];
 for(const {path,value}of summary){let target=state;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=value;}
 return{changed:true,pending:false,save:merged};
}
function conditionRecord(view){
 return{version:1,current:view.current,max:view.max,updatedElapsedMs:view.updatedElapsedMs,...(Number.isSafeInteger(view.repairPendingHP)?{repairPendingHP:view.repairPendingHP}:{}),...(Number.isSafeInteger(view.repairRemainder)?{repairRemainder:view.repairRemainder}:{})};
}
// Merge structural damage independently of other branch changes. Recovery paid
// after a request was sent remains attached to its materials and receipt.
function mergeCastleDurabilityCorrection(sent,canonical,current){
 const a=sent?.state,b=canonical?.state,c=current?.state,same=(left,right)=>JSON.stringify(left??null)===JSON.stringify(right??null),scope=state=>JSON.stringify([state?.walking?.campaignId,state?.clan,state?.worldClock?.id,state?.cycle?.index]);
 if(!a?.walking?.campaignId||scope(a)!==scope(b)||scope(a)!==scope(c))return{changed:false,save:current};
 const at=Number.isSafeInteger(c.worldClock?.elapsedMs)?c.worldClock.elapsedMs:(c.turn||0)*60000+(c.realtime?.elapsed||0)*1000,engine=global.SengokuEngine;let merged=null;
 // A later payment cannot be safely replayed over an earlier loss/removal of
 // that base. The authoritative transition may have ended repair eligibility.
 for(const kind of ['castles','branches'])for(const [id,count]of Object.entries(c.repair?.recovered?.[kind]||{})){
  if(count<=(a.repair?.recovered?.[kind]?.[id]||0))continue;
  const target=kind==='castles'?b.castles?.[id]:(b.branches||[]).find(row=>row.id===id),eligible=kind==='castles'?target?.owner===b.clan:target&&target.level>0&&!target.fallen&&!target.retreating&&b.castles?.[target.parentCastleId]?.owner===b.clan;
  if(!eligible)return{conflict:true,changed:false,save:current};
 }
 const pools=[['castles',Object.entries(b.castles||{})],['branches',(b.branches||[]).map(row=>[row.id,row])]];
 for(const [kind,rows]of pools)for(const [id,after]of rows){
  const branch=kind==='branches',find=(state,key)=>branch?(state.branches||[]).find(row=>row.id===key):state.castles?.[key],before=find(a,id),live=find(c,id);
  if(!before||!live||branch&&(before.parentCastleId!==after.parentCastleId||live.parentCastleId!==after.parentCastleId||live.fallen!==after.fallen||live.retreating!==after.retreating)||!branch&&(before.owner!==after.owner||live.owner!==after.owner)||same(before.durability,after.durability))continue;
  let record=after.durability;
  if(!same(live.durability,before.durability)&&engine?.durabilityView){
   const owned=branch?c.castles?.[live.parentCastleId]?.owner===c.clan:live.owner===c.clan;
   // Compare every record at the same live capacity. A joining retainer can
   // add capacity while a save is in flight without repairing structural damage.
   const options={castleId:branch?live.parentCastleId:id,level:live.level,...(branch?{branch:true,fallen:live.fallen||live.retreating}:{wall:live.wall,retainerCount:engine.homeRetainerCount?.(c,id)||0}),elapsedMs:at,recoveryMode:owned?'paid':'free'};
   const paidLater=owned?Math.max(0,(c.repair?.recovered?.[kind]?.[id]||0)-(a.repair?.recovered?.[kind]?.[id]||0)):0;
   const paidCorrection=owned?(b.repair?.recovered?.[kind]?.[id]||0)-(a.repair?.recovered?.[kind]?.[id]||0):0;
   let authoritative=engine.durabilityView(record,options),local=engine.durabilityView(live.durability,options);
   const baseline=engine.durabilityView(before.durability,options),expectedLocal=Math.min(local.max,baseline.current+paidLater),ordinaryCapacityChange=owned&&local.current===expectedLocal;
   // Without an ordered damage journal, recovery followed by another hit can
   // be indistinguishable from the CPU hit already present in this reply.
   // Preserve a backup and use the complete canonical state in that case.
   if(owned&&(paidLater||paidCorrection)&&!ordinaryCapacityChange)return{conflict:true,changed:false,save:current};
   if(paidLater&&!live.fallen&&!live.retreating){
    const anchor=Math.max(Number(record?.updatedElapsedMs||0),Number(live.durability?.updatedElapsedMs||0)),prior=engine.durabilityView(record,{...options,elapsedMs:anchor});
    if(prior.current+paidLater>prior.max)return{conflict:true,changed:false,save:current};
    record={...conditionRecord(prior),current:Math.min(prior.max,prior.current+paidLater),repairPendingHP:Math.min(prior.repairPendingHP||0,live.durability?.repairPendingHP||0),repairRemainder:live.durability?.repairRemainder||0};
    authoritative=engine.durabilityView(record,options);
   }
   // A later local siege may be worse than the acknowledged condition. Never
   // add the same hit twice or turn that later damage into recovery.
   if(ordinaryCapacityChange){
    // Building completion increases capacity while preserving absolute
    // damage. It must not hide repair HP which the same reply has charged.
    record=conditionRecord(authoritative);
   }else if(local.current<=authoritative.current)continue;
  }
  merged=merged||JSON.parse(JSON.stringify(current));const target=branch?merged.state.branches.find(row=>row.id===id):merged.state.castles[id];
  if(record===undefined)delete target.durability;else target.durability=JSON.parse(JSON.stringify(record));
 }
 return{changed:!!merged,save:merged||current};
}
// A repair acknowledgement corrects only its material delta and cumulative
// receipt. Recompute prepaid cents after adding subsequent local recovery so
// fractional credits cannot be refunded or charged a second time.
function mergeRepairCorrection(sent,snapshot,current){
 const dto=snapshot.repairAdjustment;if(!dto)return{changed:false,save:current};
 const a=sent?.state,b=snapshot.save?.state,c=current?.state,engine=global.SengokuEngine,conflict={conflict:true};
 const scope=state=>JSON.stringify([state?.walking?.campaignId,state?.clan,state?.worldClock?.id,state?.cycle?.index]);
 if(dto.version!==1||dto.committedRevision!==snapshot.revision||!dto.before||!a?.repair||!c?.repair||!a.walking?.campaignId||scope(a)!==scope(b)||scope(a)!==scope(c)||typeof engine?.normalizeRepairState!=='function')return conflict;
 try{
  const prior=engine.normalizeRepairState(a.repair,a.turn),source=engine.normalizeRepairState(b.repair,b.turn),live=engine.normalizeRepairState(c.repair,c.turn),same=(left,right)=>fingerprint({state:left})===fingerprint({state:right});
  if(!same(prior,dto.before)||!same(source,dto.after)||source.settledTurn>c.turn||live.settledTurn<prior.settledTurn)return conflict;
  const recovered={castles:{},branches:{}};let hp=0,laterHP=0;
  for(const kind of ['castles','branches'])for(const id of new Set([...Object.keys(prior.recovered[kind]),...Object.keys(source.recovered[kind]),...Object.keys(live.recovered[kind])])){
   const later=(live.recovered[kind][id]||0)-(prior.recovered[kind][id]||0),value=(source.recovered[kind][id]||0)+later;
   if(!Number.isSafeInteger(later)||later<0||!Number.isSafeInteger(value)||value<0)return conflict;if(value)recovered[kind][id]=value;hp+=value;laterHP+=later;
  }
  // Both sides may have settled the same previously unacknowledged month.
  // Their cumulative counters cannot safely be added without a month journal.
  if(laterHP&&source.settledTurn>prior.settledTurn&&live.settledTurn>prior.settledTurn)return conflict;
  const spent={},credit={},resources={...c.resources};
  for(const [key,rate]of [['wood',5],['stone',4]]){
   const canonicalStock=Math.min(engine.ASSET_CAP,a.resources[key]+prior.spent[key]-source.spent[key]);
   if(!Number.isSafeInteger(dto.resources?.[key])||canonicalStock<0||b.resources[key]!==canonicalStock||dto.resources[key]!==b.resources[key]-a.resources[key])return conflict;
   const cents=hp*rate;if(!Number.isSafeInteger(cents))return conflict;spent[key]=Math.ceil(cents/100);credit[key]=spent[key]*100-cents;
   const laterCostCorrection=(live.spent[key]-prior.spent[key])-(spent[key]-source.spent[key]);
   const value=resources[key]+dto.resources[key]+laterCostCorrection;if(!Number.isSafeInteger(value)||value<0)return conflict;resources[key]=Math.min(engine.ASSET_CAP,value);
  }
  const repair=engine.normalizeRepairState({version:1,settledTurn:Math.max(source.settledTurn,live.settledTurn),spent,credit,recovered},c.turn),save=JSON.parse(JSON.stringify(current));save.state.repair=repair;save.state.resources=resources;
  return{changed:!same(repair,c.repair)||!same(resources,c.resources),save};
 }catch{return conflict;}
}
function upkeepStocks(state,user){
 return{army:state.troops,castles:Object.fromEntries(Object.entries(state.castles||{}).filter(([id,castle])=>castle.owner===state.clan&&(id!=='edo'||user?.isAdmin===true)&&(id!=='kyoto_gosho'||user?.isStaff===true&&user?.isAdmin!==true)&&(id!=='kagoshima'||user?.isDeputy===true&&user?.isAdmin!==true&&user?.isStaff!==true)).map(([id,castle])=>[id,castle.troops])),branches:Object.fromEntries((state.branches||[]).map(branch=>[branch.id,branch.stationedTroops||0]))};
}
function upkeepMap(stocks){
 if(!stocks||!stocks.castles||!stocks.branches||Array.isArray(stocks.castles)||Array.isArray(stocks.branches))return null;
 const map=new Map([['army:army',stocks.army],...Object.entries(stocks.castles).map(([id,count])=>['castle:'+id,count]),...Object.entries(stocks.branches).map(([id,count])=>['branch:'+id,count])]);
 return[...map.values()].every(value=>Number.isSafeInteger(value)&&value>=0)?map:null;
}
function staffSnapshotWithTroops(snapshot,state){
 const home=snapshot.staffBase?.personalHome;
 if(snapshot.user?.isStaff!==true||snapshot.user?.isAdmin===true||!snapshot.staffBase?.personalHomeCastle||state.staffService?.personalHome!==home||state.castles?.[home]?.owner!==state.clan)return snapshot;
 return{...snapshot,staffBase:{...snapshot.staffBase,personalHomeCastle:{...snapshot.staffBase.personalHomeCastle,troops:state.castles[home].troops}}};
}
function monthlyUpkeepState(state){
 const value=state?.upkeep;
 if(!value||value.version!==1||!Number.isSafeInteger(value.settledTurn)||value.settledTurn<0||value.settledTurn>state.turn||!value.branchReductions||Array.isArray(value.branchReductions)||typeof value.branchReductions!=='object'||Object.values(value.branchReductions).some(count=>!Number.isSafeInteger(count)||count<0))return null;
 return value;
}
function mergeMonthlyUpkeep(sent,canonical,current){
 const a=sent?.state,b=canonical?.state,c=current?.state,prior=monthlyUpkeepState(a),source=monthlyUpkeepState(b),live=monthlyUpkeepState(c);
 if(!source||!live||!a?.walking?.campaignId||a.walking.campaignId!==b.walking?.campaignId||a.walking.campaignId!==c.walking?.campaignId||a.worldClock?.id!==b.worldClock?.id||a.worldClock?.id!==c.worldClock?.id||source.settledTurn>c.turn)return{changed:false,save:current};
 const branchReductions={};
 for(const id of new Set([...Object.keys(source.branchReductions),...Object.keys(live.branchReductions),...Object.keys(prior?.branchReductions||{})])){
  const committed=source.branchReductions[id]||0,before=prior?.branchReductions[id]||0,current=live.branchReductions[id]||0;
  // A newly accepted campaign starts a fresh server receipt baseline. Keep
  // losses after the submitted import, without reviving its discarded history.
  const count=committed<before?committed+Math.max(0,current-before):Math.max(current,committed);
  if(count)branchReductions[id]=count;
 }
 const upkeep={version:1,settledTurn:Math.max(source.settledTurn,live.settledTurn),branchReductions};
 if(fingerprint({state:upkeep})===fingerprint({state:live}))return{changed:false,save:current};
 const save=JSON.parse(JSON.stringify(current));save.state.upkeep=upkeep;return{changed:true,save};
}
// Replay only ordinary troop changes over the committed layout. Local automatic
// reductions are recorded explicitly and replayed as affordable-total limits,
// so the same reduction on both sides cannot be subtracted a second time.
function mergeUpkeepCorrection(sent,snapshot,current,journal){
 const dto=snapshot.upkeepAdjustment,a=sent?.state,b=snapshot.save?.state,c=current?.state,conflict={conflict:true};
 if(!dto||dto.version!==1||dto.committedRevision!==snapshot.revision||!Number.isSafeInteger(dto.removed)||dto.removed<=0||!Array.isArray(dto.allocations))return conflict;
 if(!journal?.current||journal.overflow||!Array.isArray(journal.records)||journal.records.length>128)return conflict;
 const scope=state=>JSON.stringify([state?.walking?.campaignId,state?.clan,state?.home,state?.worldClock?.id,state?.cycle?.index]);
 if(!a?.walking?.campaignId||scope(a)!==scope(b)||scope(a)!==scope(c))return conflict;
 const stocks=state=>upkeepStocks(state,snapshot.user),before=upkeepMap(dto.before),after=upkeepMap(dto.after),canonical=upkeepMap(stocks(b));
 if(!before||!after||!canonical||after.size!==canonical.size||[...after].some(([key,value])=>canonical.get(key)!==value))return conflict;
 const allocations=new Map();let removed=0;
 for(const row of dto.allocations){const key=row.kind+':'+row.id;if(!['army','castle','branch'].includes(row.kind)||row.kind==='army'&&row.id!=='army'||key==='castle:kyoto_gosho'||allocations.has(key)||!Number.isSafeInteger(row.removed)||row.removed<=0)return conflict;allocations.set(key,row.removed);}
 for(const key of new Set([...before.keys(),...after.keys()])){const delta=(before.get(key)||0)-(after.get(key)||0);if(delta<0||delta!==(allocations.get(key)||0))return conflict;removed+=delta;allocations.delete(key);}
 if(allocations.size||removed!==dto.removed)return conflict;
 const branches=mergeBranchCorrection(sent,snapshot.save,current,{troopsSeparate:true});if(branches.pending)return conflict;
 const monthly=mergeMonthlyUpkeep(sent,snapshot.save,branches.changed?branches.save:current),merged=monthly.changed?monthly.save:branches.changed?branches.save:JSON.parse(JSON.stringify(current)),target=new Map(after);
 const canonicalMonthly=monthlyUpkeepState(b),currentMonthly=monthlyUpkeepState(c),branchReductions=canonicalMonthly&&currentMonthly?{...canonicalMonthly.branchReductions}:null;
 if(canonicalMonthly&&canonicalMonthly.settledTurn>c.turn)return conflict;
 let source=upkeepMap(stocks(a));if(!source)return conflict;
 function replay(next){
  if(!next)return false;
  for(const key of new Set([...source.keys(),...next.keys()])){
   const delta=(next.get(key)||0)-(source.get(key)||0),value=(target.get(key)||0)+delta;
   // Linked transfers/departures already await flush. If a different state
   // transition consumed a now-missing source, never clamp it and mint its
   // destination; retain a backup and reload the complete canonical state.
   if(!Number.isSafeInteger(value)||value<0||!target.has(key)&&value!==0)return false;
   if(target.has(key))target.set(key,value);
  }
  source=next;return true;
 }
 for(const record of journal.records){
  const prior=upkeepMap(record.before),next=upkeepMap(record.after);
  if(!prior||!next||!Array.isArray(record.order)||!Number.isSafeInteger(record.limit)||record.limit<0||!replay(prior))return conflict;
  const order=record.order.map(row=>row.kind+':'+row.id);
  if(new Set(order).size!==order.length||order.some(key=>key==='castle:kyoto_gosho'||!prior.has(key)))return conflict;
  let excess=Math.max(0,order.reduce((sum,key)=>sum+(target.get(key)||0),0)-record.limit);
  if(record.monthlyTurn!==undefined&&(!Number.isSafeInteger(record.monthlyTurn)||record.monthlyTurn<a.turn||record.monthlyTurn>c.turn))return conflict;
  for(const key of order){const reduction=Math.min(excess,target.get(key)||0);if(reduction){target.set(key,target.get(key)-reduction);excess-=reduction;
    // Count the loss actually replayed over the canonical stocks. The same
    // month settled on both sides must not create a second branch receipt.
    if(branchReductions&&record.monthlyTurn!==undefined&&key.startsWith('branch:')){const id=key.slice(7),count=(branchReductions[id]||0)+reduction;if(!Number.isSafeInteger(count))return conflict;branchReductions[id]=count;}
  }}
  source=next;
 }
 if(!replay(upkeepMap(stocks(c))))return conflict;
 const state=merged.state,actual=upkeepMap(stocks(state));if(!actual)return conflict;
 if(branchReductions)state.upkeep={version:1,settledTurn:Math.max(canonicalMonthly.settledTurn,currentMonthly.settledTurn),branchReductions};
 for(const [key,value]of target)if(!actual.has(key)&&value!==0)return conflict;
 for(const [key,value]of actual)if(!target.has(key)&&value!==0)return conflict;
 state.troops=target.get('army:army');
 for(const [id,castle]of Object.entries(state.castles))if(target.has('castle:'+id))castle.troops=target.get('castle:'+id);
 for(const branch of state.branches||[])branch.stationedTroops=target.get('branch:'+branch.id)||0;
 const home=state.staffService?.personalHome;
 if(home&&state.staffService.personalHomeCastle&&state.castles[home]?.owner===state.clan)state.staffService.personalHomeCastle.troops=state.castles[home].troops;
 return{changed:fingerprint(merged)!==fingerprint(current),save:merged,snapshot:staffSnapshotWithTroops(snapshot,state)};
}
function makeDevice(){
 const random=()=>global.crypto?.randomUUID?.()||'device-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2);
 // A fresh document suffix also separates duplicated tabs, whose sessionStorage is copied.
 let stem;try{stem=sessionStorage.getItem('sengoku-device-tab-v1');if(!stem){stem=random();sessionStorage.setItem('sengoku-device-tab-v1',stem);}}catch(_){stem=random();}
 let name;try{name=localStorage.getItem(NAME_KEY);}catch(_){}
 const ua=global.navigator?.userAgent||'';
 return{id:(stem+'-'+random()).slice(0,90),name:String(name||(/iPad|Tablet/i.test(ua)?'タブレット':/Mobile|Android|iPhone/i.test(ua)?'スマートフォン':'パソコン')).slice(0,40)};
}
function create(options={}){
 const device={...(options.device||makeDevice())},deviceStem=device.id.slice(0,36),now=options.now||(()=>Date.now()),hidden=options.hidden||(()=>Boolean(global.document?.hidden)),online=options.online||(()=>global.navigator?.onLine!==false),bridge=options.bridge||(()=>global.SengokuBridge),storage=options.storage||global.localStorage;
 const later=options.setTimeout||global.setTimeout.bind(global),cancel=options.clearTimeout||global.clearTimeout.bind(global);
 const listeners=new Set();let session=null,generation=0,queue=Promise.resolve(),initialized=false,applying=false,dirty=false,ack='',revision=0,leaseDeadline=0,lastLeaseAt=0,refreshPending=null,attempt=null,banned=false,banMessage='',accessRefreshPending=false;
 let pollTimer=null,saveTimer=null,presenceTimer=null,expiryTimer=null,branchAuthoritySnapshot=null,branchCorrectionPending=null,maintenanceAuthoritySnapshot=null,courtEstateProjectionSnapshot=null,expulsion=null;
 let status={linked:false,ready:true,writable:true,banned:false,reason:'local',message:'',revision:0,updatedAt:null,leaseExpiresAt:null,writerDeviceName:null,deviceName:device.name};
 const valid=g=>Boolean(session&&g===generation);
 const rolePending=()=>bridge()?.getRoleAccess?.().pending===true;
 const local=()=>{const currentBridge=bridge(),save=currentBridge?.getSave?.();if(save===null&&currentBridge?.hasStarted?.()===false)return null;if(!save||typeof save!=='object'||!save.state||typeof save.state!=='object')throw Error('ゲームの保存データを確認できませんでした。');return save;};
 const localSnapshot=()=>{const save=local();return{save,key:fingerprint(save)};};
 const stored=fallback=>{const currentBridge=bridge();return currentBridge?.getStoredSave?currentBridge.getStoredSave():fallback===undefined?local():fallback;};
 function checkpoint(current){
  if(!session||!initialized||rolePending())return;
  // A clock tick can advance the runtime after the primary local save. Keep the
  // exact pending snapshot and the durable source it belongs to in one write.
  // A failed storage write leaves the previous checkpoint and game save intact.
  // Reuse a snapshot only within the synchronous operation that captured it.
  // Every response/authority application takes a new snapshot, so actions made
  // during a request still survive without repeatedly exporting the same save.
  try{if(dirty){const {save,key}=current||localSnapshot(),durable=stored(save),durableKey=durable===save?key:fingerprint(durable);if(!save||!durableKey)return;const localHash=hash(key),durableHash=durableKey===key?localHash:hash(durableKey);storage?.setItem(PENDING_KEY,JSON.stringify({id:String(session.id),revision,ack:hash(ack),local:localHash,durable:durableHash,snapshot:save,attempt,...(branchCorrectionPending?{branchCorrectionPending:true}:{})}));}else{const old=JSON.parse(storage?.getItem(PENDING_KEY)||'null');if(old?.id===String(session.id))storage?.removeItem(PENDING_KEY);}}catch(_){}
 }
 function canResume(remoteKey,remoteRevision){
  try{const pending=JSON.parse(storage?.getItem(PENDING_KEY)||'null');if(pending?.id!==String(session.id)||pending.branchCorrectionPending===true)return null;
   const baseline=pending.revision===remoteRevision&&pending.ack===hash(remoteKey)||pending.attempt?.revision+1===remoteRevision&&pending.attempt?.key===hash(remoteKey);if(!baseline)return null;
   const durable=stored(),durableKey=fingerprint(durable),savedKey=fingerprint(pending.snapshot);
   if(savedKey&&pending.local===hash(savedKey)&&durableKey&&pending.durable===hash(durableKey))return pending.snapshot;
   // Older versions stored only a hash. Compare the unchanged on-disk source as
   // well as the runtime, which may have undergone a role/schema migration.
   return durableKey&&pending.local===hash(durableKey)?durable:null;
  }catch(_){return null;}
 }
 function emit(patch={}){
  status={...status,...patch,banned,expulsion:expulsion?{...expulsion}:null,deviceName:device.name};
  if(banned)status={...status,linked:true,ready:false,writable:false,reason:'banned',message:banMessage,leaseExpiresAt:null,writerDeviceName:null};
  bridge()?.setSyncAccess?.({...status});
  for(const fn of listeners){try{fn({...status});}catch(_){}}
 }
 function clearTimers(){for(const t of [pollTimer,saveTimer,presenceTimer,expiryTimer])if(t!==null)cancel(t);pollTimer=saveTimer=presenceTimer=expiryTimer=null;}
 function suspendAccount({playerId,message}={}){
  if(!session||playerId!==undefined&&String(playerId)!==String(session.id))return false;
  const changed=!banned;
  if(changed){checkpoint();generation++;queue=Promise.resolve();refreshPending=null;initialized=false;applying=false;attempt=null;}
  banned=true;accessRefreshPending=false;banMessage=message||'この領主は利用を停止されています。解除後に接続を再確認してください。';leaseDeadline=0;clearTimers();emit();roleAccess({},true);
  if(changed)session.onUser?.({id:session.id,isBanned:true,isAdmin:false,isStaff:false,isDeputy:false});
  schedulePoll();return true;
 }
 function invalidateAccountAccess({playerId,message}={}){
  if(!session||playerId!==undefined&&String(playerId)!==String(session.id))return false;
  checkpoint();generation++;queue=Promise.resolve();refreshPending=null;initialized=false;applying=false;attempt=null;leaseDeadline=0;accessRefreshPending=true;clearTimers();roleAccess({},true);session?.onUser?.(null);
  emit({linked:true,ready:false,writable:false,reason:'access-changed',message:message||'領主の利用状態が更新されました。最新の接続状態を確認しています。',leaseExpiresAt:null});schedulePoll();return true;
 }
 function roleAccess(user={},pending=false,entitlements=null){if(pending){branchAuthoritySnapshot=null;branchCorrectionPending=null;maintenanceAuthoritySnapshot=null;courtEstateProjectionSnapshot=null;}const current=bridge(),roles={isAdmin:user.isAdmin===true,isStaff:user.isStaff===true&&user.isAdmin!==true,isDeputy:user.isDeputy===true&&user.isAdmin!==true&&user.isStaff!==true,isSento:!pending&&entitlements?.sentoGosho===true,pending};if(current?.setRoleAccess)current.setRoleAccess(roles);else current?.setAdminAccess?.(roles.isAdmin);}
 function applyCourtProtection(snapshot,g){if(!valid(g)||String(snapshot.user?.id)!==String(session.id))return;return bridge()?.applyCourtProtection?.({source:'cloud',playerId:String(session.id),entitlements:{courtProtected:snapshot.entitlements?.courtProtected===true,...(typeof snapshot.entitlements?.courtEstate==='boolean'?{courtEstate:snapshot.entitlements.courtEstate}:{})}});}
 function courtEstateProjectionMeta(snapshot){
  const playerId=String(snapshot.user?.id||''),campaignId=String(snapshot.save?.state?.walking?.campaignId||''),raw=snapshot.courtEstateProjection,previous=courtEstateProjectionSnapshot,same=previous&&previous.playerId===playerId&&previous.campaignId===campaignId;
  if(raw!=null&&(raw.version!==1||raw.campaignId!==campaignId||!Number.isSafeInteger(raw.revision)||raw.revision<0||!Number.isSafeInteger(raw.base?.revision)||raw.base.revision<0||!Number.isSafeInteger(raw.asOfElapsedMs)||raw.asOfElapsedMs<0||typeof raw.proof!=='string'||!raw.proof))throw Error('京都御所の領地効果を確認できませんでした。同期を再確認します。');
  let projection=raw||null;
  if(same&&previous.projection){
   const old=previous.projection;
   // A role's historical windows persist after dismissal. An older queued
   // snapshot cannot remove them or reinstate a superseded appointment.
   if(!projection||projection.revision<old.revision||projection.revision===old.revision&&(projection.base.revision<old.base.revision||projection.base.revision===old.base.revision&&projection.asOfElapsedMs<old.asOfElapsedMs))projection=old;
  }
  courtEstateProjectionSnapshot={playerId,campaignId,projection:projection?JSON.parse(JSON.stringify(projection)):null};
  return{source:'cloud',playerId,sentoGoshoCampaignId:campaignId,courtEstateCampaignId:campaignId,courtEstateProjection:projection?JSON.parse(JSON.stringify(projection)):null};
 }
 function applyCourtEstateProjection(snapshot,g){
  if(!valid(g)||String(snapshot.user?.id)!==String(session.id))return;
  const result=bridge()?.applyCourtEstateProjection?.(courtEstateProjectionMeta(snapshot));
  if(result?.ok===false&&!result.ignored)throw Error(result.message||'京都御所の領地効果を反映できませんでした。');
  return result;
 }
 function courtEstateReplayRequired(snapshot){
  const current=bridge(),live=current?.getState?.(),canonical=snapshot.save?.state,previous=current?.getCourtEstateProjection?.()||courtEstateProjectionSnapshot?.projection||null,next=snapshot.courtEstateProjection||null;
  if(!initialized||!live?.walking?.campaignId||live.walking.campaignId!==canonical?.walking?.campaignId||(previous?.proof||null)===(next?.proof||null))return false;
  if(previous&&next&&(next.revision<previous.revision||next.revision===previous.revision&&next.base.revision<previous.base.revision))return false;
  const elapsed=state=>state.worldClock?.elapsedMs??state.turn*60000+(state.realtime?.elapsed||0)*1000;
  // A new proof must not validate balances already advanced using an older
  // entitlement. Restore the canonical checkpoint and retain a local backup.
  return elapsed(live)>elapsed(canonical)&&(typeof current?.courtEstateProjectionRequiresReplay!=='function'||current.courtEstateProjectionRequiresReplay(next,{fromElapsedMs:elapsed(canonical)}));
 }
 function applyStaffBase(snapshot,g){if(!valid(g)||snapshot.user?.isStaff!==true||snapshot.user?.isAdmin===true)return;const result=bridge()?.applyStaffBase?.(snapshot.staffBase||null);if(result?.ok===false)throw Error(result.message||'スタッフ共同拠点を確認できませんでした。');}
 function branchAuthorityMeta(snapshot){
  const meta={source:'cloud',playerId:String(snapshot.user?.id||''),branchCampaignId:String(snapshot.save?.state?.walking?.campaignId||''),branchResolvedElapsedMs:Number.isSafeInteger(snapshot.branchResolvedElapsedMs)&&snapshot.branchResolvedElapsedMs>=0?snapshot.branchResolvedElapsedMs:0},previous=branchAuthoritySnapshot;
  if(previous&&previous.meta.playerId===meta.playerId&&previous.meta.branchCampaignId===meta.branchCampaignId){
   // A direct authenticated command/read can finish before an older queued sync.
   // Keep its authority through that save replacement, including an older zero.
   if(previous.revision>snapshot.revision)return{...previous.meta};
   if(meta.branchResolvedElapsedMs>0)meta.branchResolvedElapsedMs=Math.max(meta.branchResolvedElapsedMs,previous.meta.branchResolvedElapsedMs);
  }
  branchAuthoritySnapshot={revision:snapshot.revision,meta};return{...meta};
 }
 function applyBranchAuthority(snapshot,g){if(!valid(g)||String(snapshot.user?.id)!==String(session.id))return;return bridge()?.applyBranchAuthority?.(branchAuthorityMeta(snapshot));}
 function maintenanceAuthorityMeta(snapshot){
  const playerId=String(snapshot.user?.id||''),campaignId=String(snapshot.save?.state?.walking?.campaignId||''),authority=snapshot.maintenanceAuthority,previous=maintenanceAuthoritySnapshot;
  const same=previous&&previous.playerId===playerId&&previous.campaignId===campaignId;
  if(authority!==undefined&&authority!==null&&(!authority||typeof authority!=='object'||authority.campaignId!==campaignId||!Number.isSafeInteger(authority.revision)||authority.revision<0||!Number.isSafeInteger(authority.asOfElapsedMs)||authority.asOfElapsedMs<0))throw Error('兵の維持費の台帳を確認できませんでした。同期を再確認します。');
  const next=same&&(!authority||previous.authority.revision>authority.revision||previous.authority.revision===authority.revision&&previous.authority.asOfElapsedMs>authority.asOfElapsedMs)?previous.authority:authority;
  if(next)maintenanceAuthoritySnapshot={playerId,campaignId,authority:JSON.parse(JSON.stringify(next))};
  else if(!same)maintenanceAuthoritySnapshot=null;
  return{source:'cloud',playerId,maintenanceAuthority:next?JSON.parse(JSON.stringify(next)):null};
 }
 function applyMaintenanceAuthority(snapshot,g,{deferFutureBaseline=false}={}){
  if(!valid(g)||String(snapshot.user?.id)!==String(session.id))return;
  const meta=maintenanceAuthorityMeta(snapshot);if(!meta.maintenanceAuthority)return;
  const result=bridge()?.applyMaintenanceAuthority?.(meta);
  if(result?.ok===false&&!result.ignored){
   const state=bridge()?.getState?.(),elapsed=state?.worldClock?.elapsedMs??(state?.turn||0)*60000+(state?.realtime?.elapsed||0)*1000;
   // A successful command can advance the canonical save before its body is
   // reconciled locally. Keep its metadata, but apply that later baseline only
   // with the matching save; a committed command is never reported as failed.
   if(deferFutureBaseline&&result.code==='MAINTENANCE_AUTHORITY_INCOMPLETE'&&meta.maintenanceAuthority.baseline.elapsedMs>Math.max(elapsed,meta.maintenanceAuthority.activatedElapsedMs))return{ok:true,deferred:true};
   throw Error(result.message||'兵の維持費の台帳を読み込めませんでした。');
  }return result;
 }
 function olderBranchSnapshot(snapshot){const previous=branchAuthoritySnapshot;return Boolean(previous&&previous.meta.playerId===String(snapshot.user?.id)&&previous.meta.branchCampaignId===snapshot.save?.state?.walking?.campaignId&&previous.revision>snapshot.revision);}
 function observeBranchSnapshot(snapshot){
  const current=bridge(),role=current?.getRoleAccess?.(),campaignId=current?.getState?.()?.walking?.campaignId;
  if(!session||!initialized||banned||accessRefreshPending||role?.pending||!snapshot?.user||snapshot.user.isBanned||String(snapshot.user.id)!==String(session.id)||!Number.isSafeInteger(snapshot.revision)||snapshot.revision<revision||branchAuthoritySnapshot&&snapshot.revision<branchAuthoritySnapshot.revision||!campaignId||snapshot.save?.state?.walking?.campaignId!==campaignId||role&&(Boolean(snapshot.user.isAdmin)!==role.isAdmin||Boolean(snapshot.user.isStaff&&!snapshot.user.isAdmin)!==role.isStaff||Boolean(snapshot.user.isDeputy&&!snapshot.user.isAdmin&&!snapshot.user.isStaff)!==Boolean(role.isDeputy)||(snapshot.entitlements?.sentoGosho===true)!==Boolean(role.isSento)))return{ok:false,ignored:true};
  applyCourtProtection(snapshot,generation);if(courtEstateReplayRequired(snapshot)){void refresh();return{ok:true,deferred:true};}applyCourtEstateProjection(snapshot,generation);applyMaintenanceAuthority(snapshot,generation,{deferFutureBaseline:true});return applyBranchAuthority(snapshot,generation)||{ok:true};
 }
 function setRole(snapshot){
  const user=snapshot?.user;if(!user||String(user.id)!==String(session?.id))throw Error('同期する領主を確認できませんでした。');
  roleAccess(user,false,snapshot.entitlements);session.onUser?.(user);applyCourtProtection(snapshot,generation);
 }
 function observeResidency(result){if(Number.isSafeInteger(result?.residencyRevision))global.SengokuResidency?.observe?.(result,{playerId:String(session?.id||''),revision:result.residencyRevision});}
 function lease(snapshot){
  const server=Date.parse(snapshot.serverTime),until=Date.parse(snapshot.leaseExpiresAt),duration=Number.isFinite(server)&&Number.isFinite(until)?until-server:Number.isFinite(until)?until-now():0;
  const mine=snapshot.writerDeviceId===device.id&&snapshot.writable!==false&&duration>1000;
  leaseDeadline=mine?now()+Math.max(0,Math.min(30000,duration)-1000):0;
  if(expiryTimer!==null)cancel(expiryTimer);expiryTimer=null;
  const g=generation;if(leaseDeadline>now())expiryTimer=later(()=>{expiryTimer=null;if(!valid(g))return;leaseDeadline=0;emit({writable:false,reason:'lease-expired',message:'進行権を確認しています…',leaseExpiresAt:null});if(!hidden())refresh();},Math.max(1,leaseDeadline-now()));
  status.writerDeviceName=snapshot.writerDeviceName||(snapshot.writerDeviceId&&snapshot.writerDeviceId!==device.id?'別の端末':null);
  status.leaseExpiresAt=leaseDeadline?new Date(leaseDeadline).toISOString():null;
 }
 function access(){
  const writable=initialized&&leaseDeadline>now()&&!hidden()&&online()&&!rolePending();
  const awaitingStart=bridge()?.hasStarted?.()===false,reason=!online()?'offline':hidden()?'hidden':rolePending()?'auth':writable?(awaitingStart?'awaiting-start':'writer'):'follower';
  emit({linked:true,ready:initialized,writable,revision,reason,awaitingStart,leaseExpiresAt:leaseDeadline?new Date(leaseDeadline).toISOString():null,message:reason==='offline'?'通信が戻ると共通時刻までの進行を反映します。':reason==='hidden'?'この画面を開くと同期を再開します。':reason==='auth'?'領主の権限を確認しています。確認が終わるまで操作と保存を待機しています。':reason==='awaiting-start'?(expulsion?'管理操作により拠点から追放されました。入城する城を選び直してください。':'開始する城を選ぶと、この領主の進行を保存します。'):writable?'':`${status.writerDeviceName||'別の端末'}の進行を自動で反映しています。`});
 }
 function schedulePoll(){if(pollTimer!==null)cancel(pollTimer);pollTimer=null;const g=generation;if(session&&!hidden())pollTimer=later(()=>{pollTimer=null;if(valid(g))refresh();},banned?30000:5000);}
 function enqueue(work){const g=generation;const task=queue.catch(()=>{}).then(()=>valid(g)?work(g):undefined);queue=task.catch(()=>{});return task;}
 async function request(g,route,opts={}){
  if(!valid(g))return null;if(banned&&!((opts.method||'GET')==='GET'&&route.startsWith('/sync?')))return null;
  const before=bridge()?.getRoleAccess?.();let result;
  try{result=await session.request(route,{...opts,background:true});}catch(error){if(valid(g)){if(error?.code==='ACCOUNT_BANNED')suspendAccount({playerId:session.id,message:error.message});else if(['ACCOUNT_ACCESS_CHANGED','BASE_EXPELLED'].includes(error?.code))invalidateAccountAccess({playerId:session.id,message:error.message});}throw error;}
  if(!valid(g))return null;
  const current=bridge()?.getRoleAccess?.();
  if(before&&current&&before.epoch!==current.epoch&&result?.user&&(Boolean(result.user.isAdmin)!==current.isAdmin||Boolean(result.user.isStaff&&!result.user.isAdmin)!==current.isStaff||Boolean(result.user.isDeputy&&!result.user.isAdmin&&!result.user.isStaff)!==Boolean(current.isDeputy)||Object.hasOwn(current,'isCourtProtected')&&result.entitlements&&(result.entitlements.courtProtected===true)!==current.isCourtProtected)){const error=Error('役職が更新されたため、最新の権限と共同拠点を再確認しています。');error.code='STALE_ROLE';throw error;}
  return result;
 }
 async function apply(save,snapshot,g,{reason='remote',backup=false,backupRuntime=false}={}){
  if(!valid(g))return false;emit({writable:false,reason:'applying',message:'最新の進行を反映しています…'});applying=true;
  try{const result=await bridge()?.applyCloudSave?.(save,{isAdmin:snapshot.user.isAdmin===true,isStaff:snapshot.user.isStaff===true&&snapshot.user.isAdmin!==true,isDeputy:snapshot.user.isDeputy===true&&snapshot.user.isAdmin!==true&&snapshot.user.isStaff!==true,staffBase:snapshot.staffBase||null,isCourtProtected:snapshot.entitlements?.courtProtected===true,entitlements:snapshot.entitlements||{},...branchAuthorityMeta(snapshot),...maintenanceAuthorityMeta(snapshot),...courtEstateProjectionMeta(snapshot),reason,backup,backupRuntime});if(!valid(g))return false;if(result!==true&&result?.ok!==true)throw Error(result?.message||'最新データをこの端末に保存できませんでした。');return true;}
  finally{if(valid(g))applying=false;}
 }
 async function snapshot(result,g,{force=false,reason='remote'}={}){
  if(!valid(g)||!result)return false;
  if(!Number.isSafeInteger(result.revision)||result.revision<0||result.revision<revision)throw Error('同期データの更新番号を確認できませんでした。再接続して確認します。');
  if(result.user?.isBanned===true){suspendAccount({playerId:session.id});return false;}
  if(!result.user||String(result.user.id)!==String(session.id))throw Error('同期する領主を確認できませんでした。');
  if(olderBranchSnapshot(result))throw Error('支拠点の新しい更新を確認しています。最新の保存へ同期します。');
  if(banned){banned=false;banMessage='';status.banned=false;initialized=false;}
  const estateReplay=courtEstateReplayRequired(result);if(estateReplay){force=true;reason='court-estate-authority';}
  setRole(result);const remote=result.save,remoteKey=remote?fingerprint(remote):'';
  if(result.expulsion?.pending===true){
   const value=result.expulsion;
   if(remote!==null||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.castleId!=='string')throw Error('追放後の拠点状態を確認できませんでした。再接続してください。');
   expulsion={pending:true,revision:value.revision,castleId:value.castleId,castleName:String(value.castleName||value.castleId),expelledAt:value.expelledAt||null};
   emit({writable:false,reason:'applying',message:'追放後の拠点選択を準備しています。'});
   const accepted=await bridge()?.applyExpulsion?.(expulsion,{source:'cloud',playerId:String(session.id)});if(!valid(g))return false;
   if(accepted!==true&&accepted?.ok!==true||bridge()?.hasStarted?.()!==false)throw Error(accepted?.message||'拠点選択を読み込めませんでした。ページを更新してください。');
   branchAuthoritySnapshot=branchCorrectionPending=maintenanceAuthoritySnapshot=courtEstateProjectionSnapshot=null;ack='';dirty=false;attempt=null;revision=result.revision;initialized=true;checkpoint();
   observeResidency(result);if(result.clock)global.SengokuWorldClock?.accept(result.clock);status.updatedAt=result.updatedAt||null;lease(result);access();return true;
  }
  expulsion=null;
  if(branchCorrectionPending&&result.writerDeviceId!==device.id){force=true;reason='branch-canonical';}
  if(remote&&!remoteKey)throw Error('同期データの形式を確認できませんでした。');
  if(remote&&(!initialized||force||result.revision>revision||remoteKey!==ack)){
   let beforeSave=null,before='',unreadable=false;try{beforeSave=local();before=fingerprint(beforeSave);}catch(_){unreadable=true;}
   const backup=unreadable||Boolean(before)&&(!initialized||force||(dirty&&before!==remoteKey));
   const reward=!force&&initialized&&!branchCorrectionPending&&result.revision===revision&&result.writable===true&&result.writerDeviceId===device.id&&leaseDeadline>now()&&!rolePending()&&ack&&before&&before!==ack?mergeCloisteredReward({state:JSON.parse(ack)},result,beforeSave,{exact:true}):null;
   // Reopen only an unsent save whose exact server baseline is still authoritative.
   // A changed baseline always goes through the bridge's local-backup path.
   const resume=!force&&canResume(remoteKey,result.revision);
   if(!await apply(resume||reward?.save||remote,result,g,{reason:resume?'resume':reward?'cloistered-reward':!initialized?'initial':reason,backup:resume?Boolean(before)&&before!==fingerprint(resume):reward?false:backup,backupRuntime:Boolean(branchCorrectionPending)||estateReplay}))return false;
   branchCorrectionPending=null;ack=remoteKey;dirty=fingerprint(local())!==ack;
  }else if(!remote&&!initialized){ack='';dirty=Boolean(localSnapshot().save);}
  else if(remote&&branchCorrectionPending){const corrected=mergeBranchCorrection(branchCorrectionPending,remote,local());if(corrected.changed){if(!await apply(corrected.save,result,g,{reason:'branch-canonical'}))return false;}if(!corrected.pending)branchCorrectionPending=null;dirty=fingerprint(local())!==ack;}
  // The branch ledger may be newer than the player's economic checkpoint. Its
  // trusted cursor must reach the engine before a clock notification can catch up.
  applyCourtEstateProjection(result,g);applyMaintenanceAuthority(result,g);applyBranchAuthority(result,g);observeResidency(result);if(result.clock)global.SengokuWorldClock?.accept(result.clock);
  applyStaffBase(result,g);revision=result.revision;initialized=true;attempt=null;checkpoint();status.updatedAt=result.updatedAt||null;lease(result);access();return true;
 }
 function fail(error,g){
  if(!valid(g)||error?.code==='STALE_IDENTITY')return;
  if(error?.code==='ACCOUNT_BANNED'){suspendAccount({playerId:session.id,message:error.message});return;}
  if(banned){emit();return;}
  const auth=error?.status===401;if(auth){roleAccess({},true);session.onUser?.(null);}
  emit({linked:true,ready:initialized,writable:false,reason:auth?'auth':online()?'error':'offline',message:auth?'領主情報を再接続してください。接続するまで操作を待機しています。':error?.message||'通信が戻ると共通時刻までの進行を反映します。'});
 }
 function scheduleSave(){if(saveTimer!==null||!session||!status.writable||hidden())return;const g=generation;saveTimer=later(()=>{saveTimer=null;if(valid(g))flush();},1000);}
 function notifySave(){if(!session||banned||applying||!initialized||rolePending())return;try{const current=localSnapshot();dirty=Boolean(current.save)&&current.key!==ack;checkpoint(current);if(dirty&&status.writable)scheduleSave();}catch(e){fail(e,generation);}}
 async function recoverConflict(g){
  emit({writable:false,reason:'conflict',message:'別の更新を確認したため、最新の保存を読み込んでいます…'});
  const result=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));
  if(result)await snapshot(result,g,{force:true,reason:'conflict'});
 }
 async function flushCore(g,{suspended=false,keepalive=false}={}){
  if(!valid(g)||banned||!initialized||rolePending()||!online()||leaseDeadline<=now()||(!suspended&&(!status.writable||hidden())))return{ok:false};
  const save=local();if(!save){dirty=false;attempt=null;checkpoint();if(!suspended)access();return{ok:true,waitingForStart:true};}
  const sent=fingerprint(save);dirty=sent!==ack;if(!dirty){if(!suspended)access();return{ok:true,unchanged:true};}
  attempt={revision,key:hash(sent)};checkpoint({save,key:sent});let finishUpkeep=null;
  try{
   const currentBridge=bridge(),hasAuthorityReader=typeof currentBridge?.getMaintenanceAuthority==='function';
   const authority=hasAuthorityReader?currentBridge.getMaintenanceAuthority():maintenanceAuthoritySnapshot?.authority;
   if(hasAuthorityReader&&maintenanceAuthoritySnapshot?.campaignId&&(!authority||authority.campaignId!==save.state.walking?.campaignId))throw Object.assign(Error('兵の維持費を最新の保存と照合しています。'),{code:'MAINTENANCE_REFRESH_REQUIRED'});
   const maintenanceRevision=authority&&authority.campaignId===save.state.walking?.campaignId?authority.revision:undefined;
   const maintenanceRulesVersion=Number(global.SengokuEngine?.maintenanceRulesVersion)||1;
   const courtProjection=currentBridge?.getCourtEstateProjection?.()||courtEstateProjectionSnapshot?.projection;
   // Replacement campaigns still prove the last accepted server baseline;
   // the response supplies a fresh projection bound to the new campaign.
   const courtEstateProof=courtProjection?.proof;
   finishUpkeep=currentBridge?.beginUpkeepSync?.()||null;
   const result=await request(g,'/sync',{method:'PUT',data:{deviceId:device.id,revision,save,maintenanceRulesVersion,...(Number.isSafeInteger(maintenanceRevision)?{maintenanceRevision}:{}),...(typeof courtEstateProof==='string'?{courtEstateProof}:{})},keepalive});if(!result)return{ok:false};
   if(!Number.isSafeInteger(result.revision)||result.revision<=revision||!fingerprint(result.save))throw Error('自動保存の結果を確認できませんでした。');
   const estateReplay=courtEstateReplayRequired(result);setRole(result);const journal=finishUpkeep?.(),canonical=fingerprint(result.save),currentSave=local(),current=fingerprint(currentSave),staleBranch=olderBranchSnapshot(result);let effective=result;
   // A save response must never erase actions performed while that request was in flight.
   if(staleBranch&&(result.upkeepAdjustment||result.repairAdjustment)){await recoverConflict(g);return{ok:false,conflict:true};}
   if(estateReplay){if(!await apply(result.save,result,g,{reason:'court-estate-authority',backup:true,backupRuntime:true}))return{ok:false};branchCorrectionPending=null;}
   else if(staleBranch)branchCorrectionPending=save;
   else if(current===sent&&canonical!==current){if(!await apply(result.save,result,g,{reason:'canonical',backup:false}))return{ok:false};branchCorrectionPending=null;}
   else if(result.upkeepAdjustment){
    const corrected=mergeUpkeepCorrection(save,result,currentSave,journal);
    if(corrected.conflict){if(!await apply(result.save,result,g,{reason:'upkeep-conflict',backup:true,backupRuntime:true}))return{ok:false};}
    else{const condition=mergeCastleDurabilityCorrection(save,result.save,corrected.save),repair=mergeRepairCorrection(save,result,condition.save);effective=corrected.snapshot;if(condition.conflict||repair.conflict){if(!await apply(result.save,result,g,{reason:'repair-conflict',backup:true,backupRuntime:true}))return{ok:false};effective=result;}else if((corrected.changed||condition.changed||repair.changed)&&!await apply(repair.save,effective,g,{reason:'upkeep-canonical',backup:false}))return{ok:false};}
    branchCorrectionPending=null;
   }
   else{
    const corrected=mergeBranchCorrection(save,result.save,currentSave),monthly=mergeMonthlyUpkeep(save,result.save,corrected.changed?corrected.save:currentSave),condition=mergeCastleDurabilityCorrection(save,result.save,monthly.save),repair=mergeRepairCorrection(save,result,condition.save),preserved=repair.save||condition.save,home=result.staffBase?.personalHome;
    // The server may have needed no reduction while a later local governor
    // change did. Its old personal-home backup must not replenish that loss.
    if(home&&journal?.current&&!journal.overflow&&save.state.walking?.campaignId===preserved.state.walking?.campaignId&&save.state.clan===preserved.state.clan&&journal.records.some(record=>(record.before.castles[home]||0)>(record.after.castles[home]||0)))effective=staffSnapshotWithTroops(result,preserved.state);
    branchCorrectionPending=corrected.pending?save:null;if(condition.conflict||repair.conflict){if(!await apply(result.save,result,g,{reason:'repair-conflict',backup:true,backupRuntime:true}))return{ok:false};branchCorrectionPending=null;effective=result;}else if((corrected.changed||monthly.changed||condition.changed||repair.changed)&&!await apply(preserved,effective,g,{reason:repair.changed?'repair-canonical':corrected.changed?'branch-canonical':monthly.changed?'upkeep-month':'durability-canonical',backup:false}))return{ok:false};
   }
   if(!valid(g))return{ok:false};
   const reward=String(result.user?.id)===String(session.id)?mergeCloisteredReward(save,result,local()):null;
   if(reward?.changed&&!await apply(reward.save,effective,g,{reason:'cloistered-reward',backup:false}))return{ok:false};
   applyCourtEstateProjection(effective,g);applyMaintenanceAuthority(effective,g);applyBranchAuthority(effective,g);observeResidency(effective);if(effective.clock)global.SengokuWorldClock?.accept(effective.clock);applyStaffBase(effective,g);revision=result.revision;ack=canonical;const latest=localSnapshot();dirty=latest.key!==ack;initialized=true;attempt=null;checkpoint(latest);status.updatedAt=result.updatedAt||null;lease(result);access();if(dirty&&!suspended)scheduleSave();return{ok:true};
  }catch(error){
   if(!valid(g))return{ok:false};
   if(error.code==='DEFENSE_CLOCK_PENDING'){
    // The owner still has the writer lease. Keep the unacknowledged local
    // snapshot and try again once the server reaches this month.
    if(!suspended)scheduleSave();
    return{ok:false,pending:true};
   }
   if(['REVISION_CONFLICT','LEASE_REQUIRED','CYCLE_SETTLEMENT_REQUIRED','REGION_INHERITANCE_REQUIRED','CLOCK_REWIND','MAINTENANCE_REFRESH_REQUIRED','COURT_ESTATE_REFRESH_REQUIRED'].includes(error.code)){await recoverConflict(g);return{ok:false,conflict:true};}throw error;}
  finally{finishUpkeep?.();}
 }
 async function refreshCore(g,{takeOver=false,settleCycle=false}={}){
  if(!valid(g)||hidden()||!online()){if(valid(g))access();return{ok:false};}
  if(settleCycle&&initialized&&leaseDeadline>now()){
   const flushed=await flushCore(g);if(!flushed.ok)return flushed;
   try{const settled=await request(g,'/sync/settle',{method:'POST',data:{deviceId:device.id,revision}});if(!settled||!await snapshot(settled,g))return{ok:false};}
   catch(error){if(['REVISION_CONFLICT','LEASE_REQUIRED'].includes(error.code)){await recoverConflict(g);return{ok:false,conflict:true};}throw error;}
  }
  const resumePresence=banned||accessRefreshPending;
  // Renewing our still-valid lease already returns the complete authoritative
  // snapshot. Do not wait for the same large save twice on every renewal.
  // Initial sessions and followers continue to read before claiming a lease.
  const renewFirst=initialized&&!resumePresence&&!rolePending()&&!takeOver&&!settleCycle&&leaseDeadline>now()&&now()-lastLeaseAt>=10000;
  let result;
  if(renewFirst){
   try{result=await request(g,'/sync/lease',{method:'POST',data:{deviceId:device.id,deviceName:device.name,takeOver:false}});if(result)lastLeaseAt=now();}
   catch(error){if(error.code!=='LEASE_HELD')throw error;const latest=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));if(latest)await snapshot(latest,g);return{ok:false,held:true};}
  }else result=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));
  if(!result||!await snapshot(result,g))return{ok:false};
  if(resumePresence&&!banned){accessRefreshPending=false;await presence(true);if(!valid(g))return{ok:false};schedulePresence();}
  const until=Date.parse(result.leaseExpiresAt),server=Date.parse(result.serverTime)||now(),other=result.writerDeviceId&&result.writerDeviceId!==device.id&&until>server;
  if(takeOver||!other&&(leaseDeadline<=now()||now()-lastLeaseAt>=10000)){
   try{result=await request(g,'/sync/lease',{method:'POST',data:{deviceId:device.id,deviceName:device.name,takeOver:Boolean(takeOver)}});if(!result)return{ok:false};lastLeaseAt=now();if(!await snapshot(result,g))return{ok:false};}
   catch(error){if(error.code!=='LEASE_HELD')throw error;const latest=await request(g,'/sync?deviceId='+encodeURIComponent(device.id));if(latest)await snapshot(latest,g);return{ok:false,held:true};}
  }
  if(!valid(g))return{ok:false};access();if(status.writable)await flushCore(g);return{ok:true,writable:status.writable};
 }
 function refresh(settings={}){
  if(!session)return Promise.resolve({ok:false});if(refreshPending&&!settings.takeOver&&!settings.settleCycle)return refreshPending;
  const g=generation,task=enqueue(async gen=>{try{return await refreshCore(gen,settings);}catch(e){fail(e,gen);return{ok:false,message:e.message};}});
  refreshPending=task;task.finally(()=>{if(valid(g)){if(refreshPending===task)refreshPending=null;schedulePoll();}});return task;
 }
 function flush(){if(saveTimer!==null)cancel(saveTimer);saveTimer=null;return enqueue(async g=>{try{return await flushCore(g);}catch(e){fail(e,g);return{ok:false,message:e.message};}});}
 async function presence(value,{keepalive=false}={}){
  const g=generation;if(!session||banned||value&&(hidden()||!online()))return;
  try{await request(g,'/presence',{method:'POST',data:{deviceId:device.id,deviceName:device.name,online:value},keepalive});}catch(_){}
 }
 function schedulePresence(){if(presenceTimer!==null)cancel(presenceTimer);presenceTimer=null;const g=generation;if(session&&!banned&&!hidden())presenceTimer=later(async()=>{presenceTimer=null;if(!valid(g)||hidden())return;await presence(true);if(valid(g))schedulePresence();},20000);}
 function start(next){
  stop({pending:true});generation++;device.id=(deviceStem+'-'+(global.crypto?.randomUUID?.()||generation+'-'+now().toString(36))).slice(0,90);session={id:next.id,request:next.request,onUser:next.onUser};queue=Promise.resolve();initialized=false;applying=false;dirty=false;ack='';revision=0;leaseDeadline=0;lastLeaseAt=0;refreshPending=null;attempt=null;banned=false;banMessage='';accessRefreshPending=false;
  expulsion=null;emit({linked:true,ready:false,writable:false,reason:'initializing',message:'領主と最新の保存を確認しています…',revision:0,updatedAt:null,leaseExpiresAt:null,writerDeviceName:null});roleAccess({},true);
  if(!hidden()){presence(true);schedulePresence();return refresh();}access();return Promise.resolve({ok:false,hidden:true});
 }
 function stop({pending=false}={}){
  checkpoint();const previous=banned?null:session;generation++;session=null;clearTimers();queue=Promise.resolve();refreshPending=null;initialized=false;applying=false;dirty=false;ack='';revision=0;leaseDeadline=0;banned=false;banMessage='';accessRefreshPending=false;branchAuthoritySnapshot=null;branchCorrectionPending=null;maintenanceAuthoritySnapshot=null;courtEstateProjectionSnapshot=null;
  expulsion=null;emit({linked:pending,ready:!pending,writable:!pending,reason:pending?'initializing':'local',message:pending?'領主と最新の保存を確認しています…':'',revision:0,updatedAt:null,leaseExpiresAt:null,writerDeviceName:null});roleAccess({},pending);
  if(previous){for(const [route,data]of [['/presence',{deviceId:device.id,deviceName:device.name,online:false}],['/sync/release',{deviceId:device.id}]]){try{Promise.resolve(previous.request(route,{method:'POST',data,background:true,keepalive:true})).catch(()=>{});}catch(_){}}}
 }
 function visibilityChanged(){
  if(!session)return;
  if(banned){clearTimers();emit();if(!hidden())refresh();return;}
  if(hidden()){
   const g=generation;clearTimers();emit({writable:false,reason:'hidden',message:'この画面を開くと同期を再開します。'});
   enqueue(async gen=>{try{if(!valid(gen)||!hidden())return;if(leaseDeadline>now()&&online())await flushCore(gen,{suspended:true});if(!valid(gen)||!hidden())return;await presence(false);if(!valid(gen)||!hidden())return;await request(gen,'/sync/release',{method:'POST',data:{deviceId:device.id}});if(valid(gen)){leaseDeadline=0;emit({writable:false,leaseExpiresAt:null});}}catch(e){fail(e,gen);}}).finally(()=>{if(valid(g)&&!hidden())refresh();});
  }else{presence(true);schedulePresence();refresh();}
 }
 function connectionChanged(){if(!session)return;if(banned){emit();if(online()&&!hidden())refresh();return;}if(!online()){if(saveTimer!==null)cancel(saveTimer);saveTimer=null;emit({writable:false,reason:'offline',message:'通信が戻ると共通時刻までの進行を反映します。'});}else if(!hidden()){presence(true);schedulePresence();refresh();}}
 function pageHidden(){
  if(!session)return Promise.resolve();if(banned){clearTimers();emit();return Promise.resolve();}clearTimers();checkpoint();emit({writable:false,reason:'hidden',message:'この画面を開くと同期を再開します。'});presence(false,{keepalive:true});
  return enqueue(async g=>{try{const final=await flushCore(g,{suspended:true,keepalive:true});if(!valid(g)||!final?.ok)return;await request(g,'/sync/release',{method:'POST',data:{deviceId:device.id},keepalive:true});if(valid(g)){leaseDeadline=0;emit({writable:false,leaseExpiresAt:null});}}catch(e){fail(e,g);}});
 }
 function setDeviceName(value){const name=Array.from(String(value||'').trim()).slice(0,40).join('');if(!name)throw Error('端末名を入力してください。');try{localStorage.setItem(NAME_KEY,name);}catch(_){throw Error('端末名を保存できませんでした。');}device.name=name;emit();if(session&&!hidden())presence(true);return name;}
 function acceptSnapshot(result,{reason='residency-admission'}={}){return enqueue(async g=>{if(!valid(g)||banned||!result?.user||String(result.user.id)!==String(session.id))return{ok:false};if(!Number.isSafeInteger(result.revision)||result.revision<0)throw Error('入城後の保存番号を確認できませんでした。');if(result.revision<revision)return{ok:true,superseded:true};
  // A background sync may already have applied this move and subsequently
  // observed a lease transfer or unsaved gameplay at the same save revision.
  if(['residency-relocation','court-membership','court-noble-exchange'].includes(reason)&&initialized&&result.revision===revision){observeResidency(result);return{ok:true,superseded:true};}
  const ok=await snapshot(result,g,{force:true,reason});if(ok)schedulePoll();return{ok};});}
 return{start,stop,refresh,acceptSnapshot,observeBranchSnapshot,suspendAccount,invalidateAccountAccess,takeOver:()=>refresh({takeOver:true}),flush,notifySave,visibilityChanged,connectionChanged,pageHidden,setDeviceName,getStatus:()=>({...status}),getDevice:()=>({...device}),subscribe:fn=>{listeners.add(fn);fn({...status});return()=>listeners.delete(fn);}};
}
const sync=create();sync.create=create;sync.fingerprint=fingerprint;global.SengokuCloudSync=sync;
global.addEventListener?.('sengoku:game-saved',()=>sync.notifySave());
global.addEventListener?.('online',()=>sync.connectionChanged());global.addEventListener?.('offline',()=>sync.connectionChanged());global.addEventListener?.('pagehide',()=>sync.pageHidden());global.addEventListener?.('pageshow',()=>sync.visibilityChanged());
global.document?.addEventListener?.('visibilitychange',()=>sync.visibilityChanged());
})(window);

