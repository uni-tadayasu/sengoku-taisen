import assert from 'node:assert/strict';
import {harness,settleFieldMarch,syncFieldWriter} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {castleDurability,branchDurability,durabilityRecord} from './durability.js';

const put=async(h,p,value,expected=200)=>(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value},expected})).data;
const branchRow=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const branchState=(h,p)=>JSON.parse(branchRow(h,p)?.state_json||'{"branches":[],"jobs":[]}');
const branchBody=(h,p,extra)=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:branchRow(h,p)?.sequence||0,...extra});
const command=async(h,p,action,extra,expected=200)=>(await h.api('/branches/'+action,post(p,branchBody(h,p,extra),expected))).data;
const attackBody=(h,p,target,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,targetPlayerId:target.user.id,targetCastleId:'nijo',troops:1000,tactic:'balanced',...extra});
const setClock=(h,at)=>h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(at,h.now);
async function force(won,run){const old=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(won?0:0xffffffff):old.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=old;}}
function seedBranch(h,p,branch){
 updateSave(h,p,s=>{s.branches=[structuredClone(branch)];});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,1,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches:[branch],jobs:[]}),h.now);
}
async function fight(h,p,request,won){const departure=(await force(won,()=>h.api('/field/attack',post(p,request)))).data;return settleFieldMarch(h,p,departure);}
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Durability checks must stay local');};
try{
 await scope('old saves expose full durability without rewriting their revision or adding a new stock',async h=>{
  const p=await fixture(h,'耐久旧記録',{holdings:['nijo']}),stored=structuredClone(row(h,p));
  const snapshot=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
  const game=GameEngine.fromSave(snapshot.save,GAME_OFFICERS);
  for(const id of Object.keys(game.state.castles)){const d=game.castle(id).durability;assert(d.max>0);assert.equal(d.current,d.max);}
  const targets=(await h.api('/field',{token:p.token})).data.targets.filter(x=>x.playerId===p.user.id);assert(targets.length);assert(targets.every(x=>x.durability.current===x.durability.max));
  assert.deepEqual(structuredClone(row(h,p)),stored);
 });
 await scope('missing or forged full durability cannot heal an authoritative castle and malformed records are rejected',async h=>{
  const p=await fixture(h,'耐久同期',{holdings:['nijo']});
  updateSave(h,p,s=>{const d=castleDurability(s,'nijo');s.castles.nijo.durability=durabilityRecord({...d,current:Math.floor(d.max*.3)});});
  const original=save(h,p).state.castles.nijo.durability;
  for(const edit of [s=>{delete s.castles.nijo.durability;},s=>{s.castles.nijo.durability.current=s.castles.nijo.durability.max;},s=>{s.castles.nijo.durability={version:1,current:1,max:1,updatedElapsedMs:0};}]){
   const value=save(h,p);edit(value.state);const next=await put(h,p,value);assert.deepEqual(next.save.state.castles.nijo.durability,original);
  }
  const bad=save(h,p);bad.state.castles.nijo.durability.current=-1;assert.equal((await put(h,p,bad,400)).error.code,'INVALID_SAVE');
  const ahead=save(h,p);ahead.state.castles.nijo.durability.updatedElapsedMs=1;assert.equal((await put(h,p,ahead,400)).error.code,'INVALID_SAVE');
 });
 await scope('natural repair follows the game clock once across reads, writes, pauses and writer takeover',async h=>{
  const p=await fixture(h,'耐久自然修復',{holdings:['nijo']});
  updateSave(h,p,s=>{const d=castleDurability(s,'nijo');s.castles.nijo.durability=durabilityRecord({...d,current:d.max/4});});
  const original=save(h,p).state.castles.nijo.durability;h.now+=30000;await syncFieldWriter(h,p);
  assert.equal(castleDurability(save(h,p).state,'nijo').current,original.current+Math.floor(original.max*.05));
  const first=save(h,p).state.castles.nijo.durability;await put(h,p,save(h,p));assert.deepEqual(save(h,p).state.castles.nijo.durability,first);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=0,revision=revision+1').run(30000,h.now);h.now+=600000;await syncFieldWriter(h,p);assert.deepEqual(save(h,p).state.castles.nijo.durability,first);
  p.deviceId+='-second';await h.api('/sync/lease',post(p,{deviceId:p.deviceId,takeOver:true}));const older=save(h,p);delete older.state.castles.nijo.durability;await put(h,p,older);assert.deepEqual(save(h,p).state.castles.nijo.durability,first);
 });
 await scope('real failed sieges lower structure, expose its defense effect and replay their damage once',async h=>{
  const d=await fixture(h,'耐久防衛',{holdings:['nijo']}),a=await fixture(h,'耐久攻撃',{startCastle:'sakamoto'}),request=attackBody(h,a,d),battle=await fight(h,a,request,false);
  assert(!battle.won);assert(battle.durability.damage>0);assert.equal(battle.durability.before-battle.durability.after,battle.durability.damage);assert.deepEqual(save(h,d).state.castles.nijo.durability,battle.durability.record);
  const committed=structuredClone(row(h,d)),replay=(await h.api('/field/attack',post(a,request))).data;assert(replay.idempotent);assert.deepEqual(replay.battle.durability,battle.durability);assert.deepEqual(structuredClone(row(h,d)),committed);
  const target=(await h.api('/field',{token:a.token})).data.targets.find(x=>x.playerId===d.user.id&&x.targetCastleId==='nijo');assert.equal(target.durability.current,battle.durability.after);assert(target.durability.fortificationFactor<1);
  const old=save(h,d);delete old.state.castles.nijo.durability;await put(h,d,old);assert.deepEqual(save(h,d).state.castles.nijo.durability,battle.durability.record);
 });
 await scope('capturing a city preserves levels and starts the new holding at a quarter of its structural maximum',async h=>{
  const d=await fixture(h,'耐久陥落',{holdings:['nijo']}),a=await fixture(h,'耐久占領',{startCastle:'sakamoto'}),level=save(h,d).state.castles.nijo.level,battle=await fight(h,a,attackBody(h,a,d),true);
  assert(battle.capture.captured&&battle.capture.newlyOwned);assert(battle.durability.breached&&battle.durability.captured);assert.equal(battle.durability.breachCurrent,0);assert.equal(battle.durability.after,Math.round(battle.durability.max*.25));
  assert.equal(save(h,a).state.castles.nijo.level,level);assert.deepEqual(save(h,a).state.castles.nijo.durability,battle.durability.record);assert.deepEqual(save(h,d).state.castles.nijo.durability,battle.durability.record);
 });
 await scope('branch damage is ledger-authoritative, fallen defenses stay at zero and paid repair restores them',async h=>{
  const d=await fixture(h,'耐久支城',{holdings:['nijo']}),a=await fixture(h,'耐久支城攻撃',{startCastle:'sakamoto'}),branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:3,fallen:false};seedBranch(h,d,branch);
  const battle=await fight(h,a,attackBody(h,a,d,{targetBranchId:branch.id}),true);assert(battle.branchFallen);assert.equal(battle.durability.after,0);assert.equal(branchState(h,d).branches[0].durability.current,0);
  const forged=save(h,d);delete forged.state.branches[0].durability;forged.state.branches[0].fallen=false;await put(h,d,forged);assert.equal(branchState(h,d).branches[0].durability.current,0);assert(branchState(h,d).branches[0].fallen);
  await syncFieldWriter(h,d);await command(h,d,'repair',{branchId:branch.id});const job=branchState(h,d).jobs[0];setClock(h,job.completesElapsedMs-1);
  let target=(await h.api('/field',{token:a.token})).data.targets.find(x=>x.playerId===d.user.id&&x.targetCastleId==='nijo');assert.equal(target.branches[0].durability.current,0);
  setClock(h,job.completesElapsedMs);target=(await h.api('/field',{token:a.token})).data.targets.find(x=>x.playerId===d.user.id&&x.targetCastleId==='nijo');assert(!target.branches[0].fallen);assert.equal(target.branches[0].durability.current,target.branches[0].durability.max);
 });
 await scope('a failed battle commit rolls back durability together with its receipt and a retry applies one hit',async h=>{
  const d=await fixture(h,'耐久原子保存',{holdings:['nijo']}),a=await fixture(h,'耐久原子攻撃',{startCastle:'sakamoto'}),request=attackBody(h,a,d),departure=(await force(false,()=>h.api('/field/attack',post(a,request)))).data,before=structuredClone(row(h,d));h.now+=departure.march.remainingMs;
  h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_durability_table SET value=1'));};
  const pending=(await h.api('/marches?deviceId='+a.deviceId,{token:a.token})).data;assert(pending.active.some(x=>x.id===departure.march.id));assert.deepEqual(structuredClone(row(h,d)),before);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM field_requests').get().n,0);
  const resolved=(await h.api('/marches?deviceId='+a.deviceId,{token:a.token})).data,battle=resolved.history.find(x=>x.id===departure.march.id).battle;assert.deepEqual(save(h,d).state.castles.nijo.durability,battle.durability.record);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM field_requests').get().n,1);
 });
 await scope('protected reward battles do not damage or rewrite the defending special base',async h=>{
  const d=await fixture(h,'耐久江戸',{admin:true}),a=await fixture(h,'耐久報酬攻撃',{startCastle:'sakamoto'}),before=structuredClone(row(h,d)),battle=await fight(h,a,attackBody(h,a,d,{targetCastleId:'edo'}),true);
  assert.equal(battle.battleMode,'reward');assert.equal(battle.durability,undefined);assert.deepEqual(structuredClone(row(h,d)),before);
 });
 console.log(checks+' durability integration groups passed across '+calls+' local Worker calls.');
}finally{globalThis.fetch=network;}
