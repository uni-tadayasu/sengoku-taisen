// Verify the new economy at the real local Worker/D1 boundaries. Existing
// holdings and immutable rewards survive; only future passive surplus changes.
import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';

const resources=['gold','rice','wood','stone'],thresholds={gold:5000,rice:9000,wood:3000,stone:2500},checks=[];
const clone=value=>structuredClone(value);
let calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const snapshot=async(h,p)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
const renew=async(h,p)=>(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
const engine=s=>GameEngine.fromSave(s.save,GAME_OFFICERS,{isAdmin:s.user.isAdmin,isStaff:s.user.isStaff,staffBase:s.staffBase,maintenanceAuthority:s.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:s.branchResolvedElapsedMs}});
const put=async(h,p,value,{legacy=false}={})=>{
 const outgoing=clone(value);if(legacy)delete outgoing.state.upkeep;
 return(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:outgoing,...(legacy?{}:{maintenanceRulesVersion:GameEngine.maintenanceRulesVersion})}})).data;
};
function rich(h,p,{troops=0}={}){
 updateSave(h,p,state=>{
  for(const key of Object.keys(state.buildings))state.buildings[key]=32;
  for(const key of Object.keys(state.tech))state.tech[key]=5;
  state.resources=Object.fromEntries(resources.map(key=>[key,1000000]));state.magatama=1000000;state.troops=troops;state.command=7;
  for(const castle of Object.values(state.castles))if(castle.owner===state.clan)castle.troops=0;
 });
}
function assertRates(income){
 for(const key of resources){
  const raw=income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key],threshold=thresholds[key];
  const expected=raw>threshold?Math.floor(threshold*(1+Math.log(raw/threshold))):raw;
  assert.equal(income.rawNet[key],raw,key+' raw balance');assert.equal(income[key],expected,key+' effective balance');assert.equal(income.net[key],expected);
  assert.equal(income.surplusAdjustment[key],raw-expected);assert(raw>threshold,'fixture exercises the surplus threshold for '+key);
 }
}
function branchBody(h,p,extra={}){
 const stored=save(h,p),ledger=h.sql.prepare('SELECT sequence FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,stored.state.walking.campaignId);
 return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:stored.state.walking.campaignId,sequence:ledger?.sequence||0,...extra};
}
function seedBranch(h,p,value){
 updateSave(h,p,state=>{state.branches=[clone(value)];state.jobs=state.jobs.filter(job=>job.kind!=='branch');});
 const current=save(h,p);
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?) ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=sequence+1,state_json=excluded.state_json,resolved_elapsed_ms=excluded.resolved_elapsed_ms')
  .run(p.user.id,current.state.walking.campaignId,JSON.stringify({branches:[value],jobs:[]}),current.state.worldClock.elapsedMs,h.now);
}
function holdings(count,home='kiyosu'){
 return['nijo',...globalThis.SENGOKU_DATA.castles.map(c=>c.id).filter(id=>!['edo','kyoto_gosho','nijo',home].includes(id))].slice(0,count-1);
}
async function victory(run){const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(0):old.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=old;}}

const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Economy verification must not contact a real service');};
try{
 await scope('server action accrues the exact reduced passive rate before charging a fixed construction price',async h=>{
  const p=await fixture(h,'黒字の増加速度',{holdings:['nijo']});rich(h,p);
  const before=await snapshot(h,p),game=engine(before),income=game.income(),quote=game.branchQuote('nijo','north'),fixed=clone(game.maintenance().facilityUpkeep);assertRates(income);assert(quote.ok);
  h.now+=12000;
  const body=branchBody(h,p,{parentCastleId:'nijo',direction:'north'}),result=(await h.api('/branches/build',post(p,body))).data;
  for(const key of resources)assert.equal(result.save.state.resources[key],before.save.state.resources[key]+Math.trunc(income.net[key]/5)-(quote.cost[key]||0),key);
  assert.equal(result.save.state.worldClock.elapsedMs,before.save.state.worldClock.elapsedMs+12000);assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed);
  const committed=clone(row(h,p)),repeated=(await h.api('/branches/build',post(p,body))).data;assert(repeated.idempotent);assert.deepEqual(clone(row(h,p)),committed);
 });

 for(const troops of [300000,2000000])await scope('monthly server settlement '+(troops===300000?'keeps a funded army despite surplus moderation':'removes only an unaffordable army once'),async h=>{
  const p=await fixture(h,'月ごとの資産調整'+troops,{holdings:['nijo']});rich(h,p,{troops});
  h.now+=59000;const loaded=await renew(h,p),game=engine(loaded);assert(game.applyWorldClock(loaded.clock).ok);
  const near=await put(h,p,JSON.parse(game.exportSave())),beforeGame=engine(near),fixed=clone(beforeGame.maintenance().facilityUpkeep);
  assert.equal(near.save.state.troops,troops);assert.equal(near.save.state.upkeep.settledTurn,0);
  h.now+=2000;const current=await snapshot(h,p),control=engine(current);assert(control.applyWorldClock(current.clock).ok);
  const quote=control.branchQuote('nijo','north');assert(quote.ok);
  const result=(await h.api('/branches/build',post(p,branchBody(h,p,{parentCastleId:'nijo',direction:'north'})))).data;
  for(const key of resources)assert.equal(result.save.state.resources[key],control.state.resources[key]-(quote.cost[key]||0),key);
  assert.equal(result.save.state.upkeep.settledTurn,1);assert.equal(result.save.state.troops,control.state.troops);assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed);
  const funded=engine(result);assert(funded.income().gold>=0&&funded.income().rice>=0);
  if(troops===300000)assert.equal(result.save.state.troops,troops,'moderation applies after upkeep and does not invent a troop deficit');
  else{assert(result.save.state.troops<troops);funded.state.troops++;assert(funded.income().gold<0||funded.income().rice<0,'one more soldier would still be unaffordable');}
  const repeated=await put(h,p,result.save);assert.equal(repeated.save.state.troops,result.save.state.troops);assert.deepEqual(repeated.save.state.resources,result.save.state.resources);assert.deepEqual(repeated.save.state.upkeep,result.save.state.upkeep);
 });

 await scope('an older release can flush its final balances and the new release accrues only future moderated income',async h=>{
  const p=await fixture(h,'更新前の最終保存');rich(h,p);const before=await snapshot(h,p),game=engine(before),income=game.income();assertRates(income);
  h.now+=30000;const intermediate=await renew(h,p),oldGame=engine(intermediate),moved=oldGame.applyWorldClock(intermediate.clock);assert(moved.ok&&!moved.pending&&!moved.maintenancePending);const old=JSON.parse(oldGame.exportSave());
  // Old documents post completed private balances. Preserve that final flush,
  // including its fraction, instead of guessing which earned assets to remove.
  for(const key of resources){const accrued=income.rawNet[key]/2;old.state.resources[key]=before.save.state.resources[key]+Math.trunc(accrued);old.state.realtime.incomeRemainders[key]=accrued-Math.trunc(accrued);}
  const flushed=await put(h,p,old,{legacy:true});assert.deepEqual(flushed.save.state.resources,old.state.resources);assert(flushed.writable);
  h.now+=30000;const current=await renew(h,p),modern=engine(current),rate=modern.income();assert(modern.applyWorldClock(current.clock).ok);
  for(const key of resources)assert.equal(modern.state.resources[key],old.state.resources[key]+Math.trunc(old.state.realtime.incomeRemainders[key]+rate.net[key]/2),key);
  const accepted=await put(h,p,JSON.parse(modern.exportSave()));assert.deepEqual(accepted.save.state.resources,modern.state.resources);assert.equal(accepted.save.state.upkeep.settledTurn,1);
 });

 await scope('large producers still receive full walking and mission rewards and transfer guild assets without scaling',async h=>{
  const p=await fixture(h,'獲得報酬はそのまま');rich(h,p);const initial=await snapshot(h,p);assertRates(engine(initial).income());
  h.sql.prepare('UPDATE world_clock SET running=0,base_elapsed_ms=0,anchor_real_ms=?,revision=revision+1').run(h.now);
  const started=(await h.api('/walking/start',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId}))).data.walkingSession;
  h.now+=5000;const body={deviceId:p.deviceId,expectedRevision:row(h,p).revision,sessionId:started.id,sessionToken:started.token,seq:started.lastSeq+1,totalSteps:10,activeMs:5000,finish:true};
  const walked=(await h.api('/walking/claim',post(p,body))).data;
  for(const key of resources)assert.equal(walked.save.state.resources[key],initial.save.state.resources[key]+20);assert.equal(walked.save.state.magatama,initial.save.state.magatama+20);
  const claimed=clone(row(h,p));assert((await h.api('/walking/claim',post(p,body))).data.idempotent);assert.deepEqual(clone(row(h,p)),claimed);
  await h.api('/progress',{token:p.token});updateSave(h,p,state=>{state.stats.upgrades++;});
  const progress=(await h.api('/progress',{token:p.token})).data.progress,mission=progress.missions.daily.find(item=>item.id==='build'),before=save(h,p);
  const missionBody={key:mission.key,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision};
  const rewarded=(await h.api('/progress/claim',post(p,missionBody))).data;assert.deepEqual(rewarded.receipt.rewards,{gold:300,wood:150});
  assert.equal(rewarded.save.state.resources.gold,before.state.resources.gold+300);assert.equal(rewarded.save.state.resources.wood,before.state.resources.wood+150);
  const guild=(await h.api('/guild',post(p,{name:'資産調整の検証軍'}))).data.guild,held=clone(save(h,p).state.resources);
  for(const direction of ['deposit','withdraw'])await h.api('/guild/treasury/transfer',post(p,{guildId:guild.id,direction,resource:'gold',amount:5000,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision}));
  assert.deepEqual(save(h,p).state.resources,held);assert.equal(h.sql.prepare('SELECT gold FROM guild_treasuries WHERE guild_id=?').get(guild.id).gold,0);
  assert((await h.api('/progress/claim',post(p,missionBody))).data.idempotent);assert.deepEqual(save(h,p).state.resources,held);
 });

 await scope('published event victory rewards remain full fixed amounts for a large producer',async h=>{
  const admin=await fixture(h,'報酬試験の運営',{admin:true}),p=await fixture(h,'豊かな領国の参加者');rich(h,p);assertRates(engine(await snapshot(h,p)).income());
  const catalog=globalThis.SengokuBattleCatalog.list(),choice=catalog.find(item=>item.name.includes('桶狭間'));
  const draft=(await h.api('/admin/events/generate',post(admin,{battleId:choice.id,durationDays:1,requestId:crypto.randomUUID()}))).data.event;
  const event=(await h.api('/admin/events/'+draft.id+'/publish',post(admin,{requestId:crypto.randomUUID()}))).data.event,stage=event.plan.stages[2],before=save(h,p);
  const body={stageId:stage.id,tactic:stage.recommendedTactic,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision};
  const result=await victory(async()=>(await h.api('/events/'+event.id+'/battle',post(p,body))).data);
  assert(result.battle.won);assert.deepEqual(result.battle.rewards,{gold:240,rice:320,wood:40,stone:40,magatama:8});
  for(const key of resources)assert.equal(result.save.state.resources[key],before.state.resources[key]+result.battle.rewards[key]);assert.equal(result.save.state.magatama,before.state.magatama+8);
  const committed=clone(row(h,p));assert((await h.api('/events/'+event.id+'/battle',post(p,body))).data.idempotent);assert.deepEqual(clone(row(h,p)),committed);
 });

 for(const [action,count] of [['build',5],['build',6],['build',20],['upgrade',6],['repair',6],['build-facility',6],['upgrade-facility',6]])await scope('server '+action+' charges 16 times the base price with '+count+' castles',async h=>{
  const p=await fixture(h,'上限価格'+action+count,{holdings:holdings(count)}),branchId='nijo_north';
  updateSave(h,p,state=>{state.resources=Object.fromEntries(resources.map(key=>[key,10000000]));});
  if(action!=='build')seedBranch(h,p,{id:branchId,parentCastleId:'nijo',direction:'north',level:3,fallen:action==='repair',...(action==='upgrade-facility'?{facilities:{market:1}}:{})});
  const before=await snapshot(h,p),game=engine(before),fixed=clone(game.maintenance().facilityUpkeep);assert.equal(game.upgradeCastleCount(),count);
  const unit=action.includes('facility')?GameEngine.branchFacilityCost('nijo','market',action==='upgrade-facility'?1:0):GameEngine.branchUpgradeCost('nijo',action==='build'?0:action==='repair'?2:3);
  const extra=action==='build'?{parentCastleId:'nijo',direction:'north'}:{branchId,...(action.includes('facility')?{facilityId:'market'}:{})};
  const body=branchBody(h,p,extra),result=(await h.api('/branches/'+action,post(p,body))).data;
  for(const key of resources)assert.equal(result.save.state.resources[key],before.save.state.resources[key]-(unit[key]||0)*16,key);
  assert.equal(result.save.state.jobs.find(job=>job.kind==='branch').totalSeconds,unit.seconds);assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed);
  const committed=clone(row(h,p));assert((await h.api('/branches/'+action,post(p,body))).data.idempotent);assert.deepEqual(clone(row(h,p)),committed);
 });

 for(const count of [6,20])await scope('joint Kyoto facility and castle prices share the 16 times cap for '+count+' personal castles',async h=>{
  await fixture(h,'共同価格の運営',{admin:true});const p=await fixture(h,'共同価格'+count,{staff:true,startCastle:'himeji',holdings:holdings(count,'himeji')});
  updateSave(h,p,state=>{state.resources=Object.fromEntries(resources.map(key=>[key,10000000]));});
  for(const kind of ['building','castle']){
   const before=await snapshot(h,p),game=engine(before),unitGame=engine(before),home=before.staffBase.personalHome;
   for(const castle of unitGame.ownedCastles())if(![home,'kyoto_gosho'].includes(castle.id))unitGame.state.castles[castle.id].owner='在地衆';
   assert.equal(game.upgradeCastleCount(),count);assert.equal(unitGame.upgradeCastleCount(),1);
   const id=kind==='castle'?'kyoto_gosho':'farm',unit=kind==='castle'?unitGame.castleUpgradeCost(id):unitGame.costs(id),fixed=clone(game.maintenance().facilityUpkeep);
   const body={kind,id,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:before.revision,baseRevision:before.staffBase.revision};
   const result=(await h.api('/staff/base/upgrade',post(p,body))).data;
   for(const key of resources){assert.equal(result.receipt.cost[key],(unit[key]||0)*16,key);assert.equal(result.save.state.resources[key],before.save.state.resources[key]-(unit[key]||0)*16);}
   assert.equal(result.receipt.completesElapsedMs-result.receipt.startedElapsedMs,unit.seconds*1000);assert.deepEqual(engine(result).maintenance().facilityUpkeep,fixed);
   const committed=clone(row(h,p));assert((await h.api('/staff/base/upgrade',post(p,body))).data.idempotent);assert.deepEqual(clone(row(h,p)),committed);
  }
 });
 console.log(JSON.stringify({checks:checks.length,localHttpCalls:calls,productionRequests:0}));
}finally{globalThis.fetch=originalFetch;}
