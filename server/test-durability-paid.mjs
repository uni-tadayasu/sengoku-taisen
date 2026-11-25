import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {castleDurability,durabilityRecord} from './durability.js';

const copy=structuredClone;
const clock=(h,at)=>h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(at,h.now);
const put=async(h,p,value,expected=200)=>(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected})).data;
function damage(h,p,id='kiyosu',current=2000){updateSave(h,p,s=>{s.castles[id].wall=1;s.castles[id].level=1;s.castles[id].durability={...durabilityRecord(castleDurability(s,id)),current,repairPendingHP:0,repairRemainder:0};s.resources.wood=s.resources.stone=1000;s.treaties=Object.fromEntries([...new Set(Object.values(s.castles).map(c=>c.owner))].filter(clan=>clan!==s.clan).map(clan=>[clan,1000]));});}
async function local(h,p,options={}){
 const snap=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 const game=GameEngine.fromSave(snap.save,GAME_OFFICERS,{maintenanceAuthority:snap.maintenanceAuthority});
 const result=game.applyWorldClock(snap.clock,options);assert(result.ok&&!result.pending);
 return{game,snap,value:JSON.parse(game.exportSave())};
}
function seedBranch(h,p,branch){updateSave(h,p,s=>{s.branches=[copy(branch)];});h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,0,?)').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches:[branch],jobs:[]}),h.now);}
let checks=0,calls=0;
async function test(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Paid repair checks stay local');};
try{
 await test('public map reads keep player damage fixed before the paid month is committed',async h=>{
  const p=await fixture(h,'地図の有料耐久',{holdings:['nijo']});damage(h,p,'nijo');clock(h,30000);const original=copy(row(h,p));
  const listing=(await h.api('/field',{token:p.token})).data.targets.find(target=>target.playerId===p.user.id&&target.targetCastleId==='nijo');assert.equal(listing.durability.current,2000);assert.deepEqual(copy(row(h,p)),original);
 });
 await test('old castle and branch anchors migrate only to their saved instant, then pay the next month',async h=>{
  const p=await fixture(h,'旧耐久移行',{holdings:['nijo']}),branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:3,fallen:false,durability:{version:1,current:1000,max:8000,updatedElapsedMs:0}};seedBranch(h,p,branch);
  updateSave(h,p,s=>{delete s.repair;s.worldClock.elapsedMs=120000;s.turn=2;s.realtime.elapsed=0;s.upkeep.settledTurn=2;s.castles.nijo.wall=1;s.castles.nijo.level=1;s.castles.nijo.durability={version:1,current:2000,max:20000,updatedElapsedMs:0};});clock(h,180000);const original=copy(row(h,p));
  const snap=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(snap.save.state.castles.nijo.durability.current,6000);assert.equal(snap.save.state.branches[0].durability.current,2600);assert.deepEqual(copy(row(h,p)),original);
  const listing=(await h.api('/field',{token:p.token})).data.targets.find(target=>target.playerId===p.user.id&&target.targetCastleId==='nijo');assert.equal(listing.durability.current,6000);assert.equal(listing.branches[0].durability.current,2600);assert.deepEqual(copy(row(h,p)),original);
  const {value}=await local(h,p),next=await put(h,p,value);assert.equal(next.save.state.castles.nijo.durability.current,8000);assert.equal(next.save.state.branches[0].durability.current,3400);assert.deepEqual(next.save.state.repair.spent,{wood:140,stone:112});assert.deepEqual(next.save.state.resources,value.state.resources);
 });
 await test('a modern monthly payment preserves its exact stock, HP and credit across sync and retry',async h=>{
  const p=await fixture(h,'有料城修復');damage(h,p);clock(h,60000);
  const {value}=await local(h,p);assert.equal(value.state.repair.recovered.castles.kiyosu,1000);assert.deepEqual(value.state.repair.spent,{wood:50,stone:40});
  const next=await put(h,p,value);assert.deepEqual(next.save.state.resources,value.state.resources);assert.deepEqual(next.save.state.repair,value.state.repair);assert.equal(castleDurability(next.save.state,'kiyosu').current,3000);assert.equal(next.repairAdjustment,undefined);
  const retry=await put(h,p,next.save);assert.deepEqual(retry.save.state.repair,next.save.state.repair);assert.deepEqual(retry.save.state.resources,next.save.state.resources);
  const forged=copy(retry.save);forged.state.castles.kiyosu.durability.current=10000;const fixed=await put(h,p,forged);assert.equal(castleDurability(fixed.save.state,'kiyosu').current,3000);assert.deepEqual(fixed.save.state.repair,retry.save.state.repair);
 });
 await test('legacy checkpoints pay only the months after the trusted receipt, never the earlier cumulative bill',async h=>{
  const p=await fixture(h,'旧版修復支払');damage(h,p);clock(h,60000);
  let {value}=await local(h,p,{settleRepairs:false});delete value.state.repair;
  const stock=copy(value.state.resources),first=await put(h,p,value);assert.equal(first.save.state.resources.wood,stock.wood-50);assert.equal(first.save.state.resources.stone,stock.stone-40);assert.equal(castleDurability(first.save.state,'kiyosu').current,3000);assert.equal(first.repairAdjustment.before,null);assert.deepEqual(first.repairAdjustment.resources,{wood:-50,stone:-40});
  clock(h,120000);({value}=await local(h,p,{settleRepairs:false}));delete value.state.repair;const secondStock=copy(value.state.resources),second=await put(h,p,value);
  assert.equal(second.save.state.resources.wood,secondStock.wood-50);assert.equal(second.save.state.resources.stone,secondStock.stone-40);assert.deepEqual(second.save.state.repair.spent,{wood:100,stone:80});assert.equal(castleDurability(second.save.state,'kiyosu').current,4000);
 });
 await test('legacy catch-up uses complete monthly proof receipts rather than only one month',async h=>{
  const p=await fixture(h,'旧版複数月修復');damage(h,p);clock(h,180000);
  const {value}=await local(h,p,{settleRepairs:false});delete value.state.repair;const stock=copy(value.state.resources),next=await put(h,p,value);
  assert.deepEqual(next.save.state.repair.spent,{wood:150,stone:120});assert.equal(next.save.state.resources.wood,stock.wood-150);assert.equal(next.save.state.resources.stone,stock.stone-120);assert.equal(castleDurability(next.save.state,'kiyosu').current,5000);
 });
 await test('a proof budget cannot charge or grant unpaid repair to a modern empty-stock checkpoint',async h=>{
  const p=await fixture(h,'資材不足修復');damage(h,p);clock(h,60000);
  const prior=save(h,p),{value}=await local(h,p,{settleRepairs:false});value.state.repair={...copy(prior.state.repair),settledTurn:1};value.state.resources.wood=value.state.resources.stone=0;
  const next=await put(h,p,value);assert.equal(castleDurability(next.save.state,'kiyosu').current,2000);assert.deepEqual(next.save.state.repair.spent,{wood:0,stone:0});assert.equal(next.save.state.resources.wood,0);assert.equal(next.save.state.resources.stone,0);
 });
 await test('legacy scarce materials fund proportional actual HP and preserve prepaid fractions',async h=>{
  const p=await fixture(h,'旧版資材不足');damage(h,p);clock(h,60000);
  const {value}=await local(h,p,{settleRepairs:false});delete value.state.repair;value.state.resources.wood=10;value.state.resources.stone=7;
  const next=await put(h,p,value);assert.equal(castleDurability(next.save.state,'kiyosu').current,2175);assert.deepEqual(next.save.state.repair.spent,{wood:9,stone:7});assert.deepEqual(next.save.state.repair.credit,{wood:25,stone:0});assert.equal(next.save.state.resources.wood,1);assert.equal(next.save.state.resources.stone,0);
 });
 for(const capped of [false,true])await test('a newer siege refunds only unperformed work'+(capped?' without overflowing capped stocks':''),async h=>{
  const p=await fixture(h,capped?'修復返金上限':'戦闘後の修復補正');damage(h,p);clock(h,120000);
  updateSave(h,p,s=>{s.castles.kiyosu.durability.current=1000;s.castles.kiyosu.durability.updatedElapsedMs=90000;});
  const snap=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,stale=copy(snap.save);stale.state.castles.kiyosu.durability.updatedElapsedMs=0;
  const game=GameEngine.fromSave(stale,GAME_OFFICERS,{maintenanceAuthority:snap.maintenanceAuthority});game.applyWorldClock(snap.clock);const value=JSON.parse(game.exportSave());assert.equal(value.state.repair.recovered.castles.kiyosu,2000);if(capped)value.state.resources.wood=value.state.resources.stone=GameEngine.ASSET_CAP;
  const stock=copy(value.state.resources),next=await put(h,p,value);assert.equal(next.save.state.repair.recovered.castles.kiyosu,500);assert.deepEqual(next.save.state.repair.spent,{wood:25,stone:20});assert.equal(castleDurability(next.save.state,'kiyosu').current,1500);assert.deepEqual(next.repairAdjustment.before,value.state.repair);assert.deepEqual(next.repairAdjustment.after,next.save.state.repair);assert.deepEqual(next.repairAdjustment.resources,capped?{wood:0,stone:0}:{wood:75,stone:60});assert.equal(next.save.state.resources.wood,Math.min(GameEngine.ASSET_CAP,stock.wood+75));assert.equal(next.save.state.resources.stone,Math.min(GameEngine.ASSET_CAP,stock.stone+60));
 });
 await test('canonical branches retain paid HP even though uploaded branch fields are discarded',async h=>{
  const p=await fixture(h,'支城有料修復',{holdings:['nijo']}),branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:3,fallen:false,durability:{version:1,current:1000,max:8000,updatedElapsedMs:0,repairPendingHP:0,repairRemainder:0}};seedBranch(h,p,branch);
  updateSave(h,p,s=>{s.treaties=Object.fromEntries([...new Set(Object.values(s.castles).map(c=>c.owner))].filter(clan=>clan!==s.clan).map(clan=>[clan,1000]));});clock(h,60000);
  const {value}=await local(h,p);assert.equal(value.state.repair.recovered.branches.nijo_north,800);const next=await put(h,p,value);assert.deepEqual(next.save.state.repair,value.state.repair);assert.deepEqual(next.save.state.resources,value.state.resources);assert.equal(next.save.state.branches[0].durability.current,1800);
  const retry=await put(h,p,next.save);assert.equal(retry.save.state.branches[0].durability.current,1800);assert.deepEqual(retry.save.state.resources,next.save.state.resources);
 });
 await test('monthly paid repair participates in CPU defense before authoritative ownership is decided',async h=>{
  const p=await fixture(h,'修復後の本拠防衛');clock(h,480000);
  updateSave(h,p,s=>{s.worldClock.elapsedMs=480000;s.turn=8;s.realtime.elapsed=0;s.seed=1;s.difficulty='hard';s.repair.settledTurn=8;s.upkeep.settledTurn=8;s.troops=0;s.buildings.wall=32;s.castles.kiyosu.wall=32;s.castles.kiyosu.troops=1000;s.resources={gold:900000,rice:900000,wood:1000,stone:1000};for(const[id,c]of Object.entries(s.castles))if(id!=='kiyosu'){c.owner='在地衆';c.troops=3000;}s.castles.kiyosu.durability={version:1,current:0,max:25500,updatedElapsedMs:480000,repairPendingHP:0,repairRemainder:0};});
  const prior=save(h,p),unpaid=GameEngine.fromSave(prior,GAME_OFFICERS);unpaid.applyWorldClock({id:'world-v1',elapsedMs:540000,running:true,speed:1},{settleRepairs:false});assert.notEqual(unpaid.state.castles.kiyosu.owner,prior.state.clan,'without repair this same raid captures the home');
  clock(h,540000);const {value}=await local(h,p);assert.equal(value.state.castles.kiyosu.owner,value.state.clan);assert.equal(value.state.repair.recovered.castles.kiyosu,2550);
  const next=await put(h,p,value);assert.equal(next.save.state.castles.kiyosu.owner,value.state.clan);assert.equal(next.save.state.home,'kiyosu');assert.deepEqual(next.save.state.repair,value.state.repair);assert.deepEqual(next.save.state.resources,value.state.resources);
 });
 await test('invalid prices, future receipts and impossible healing cannot buy free durability',async h=>{
  const p=await fixture(h,'修復記録検証');damage(h,p);
  const bad=save(h,p);bad.state.repair.spent.wood=1;assert.equal((await put(h,p,bad,400)).error.code,'INVALID_SAVE');
  const future=save(h,p);future.state.repair.settledTurn=1;assert.equal((await put(h,p,future,400)).error.code,'INVALID_SAVE');
  clock(h,60000);const {value}=await local(h,p);value.state.repair.recovered.castles.kiyosu=100000;value.state.repair.spent={wood:5000,stone:4000};value.state.repair.credit={wood:0,stone:0};assert.equal((await put(h,p,value,409)).error.code,'REPAIR_STATE_CHANGED');
 });
 await test('a failed repair commit rolls back resources and receipts and retry charges once',async h=>{
  const p=await fixture(h,'修復決済の原子性');damage(h,p);clock(h,60000);const {value}=await local(h,p,{settleRepairs:false});delete value.state.repair;const original=copy(row(h,p));
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('cycle_commit=?')&&s.sql.includes('branch_states')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_paid_repair_table SET value=1'));};
  await put(h,p,value,500);assert.deepEqual(copy(row(h,p)),original);const next=await put(h,p,value);assert.deepEqual(next.save.state.repair.spent,{wood:50,stone:40});assert.equal(next.save.state.resources.wood,value.state.resources.wood-50);assert.equal(next.save.state.resources.stone,value.state.resources.stone-40);
 });
 console.log(checks+' paid repair integration groups passed across '+calls+' local Worker calls.');
}finally{globalThis.fetch=fetch;}
