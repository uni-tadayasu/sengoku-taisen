import assert from 'node:assert/strict';
import {harness,syncFieldWriter,settleFieldMarch} from './test-support.mjs';
import {fixture,post,row,save,count,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {applyFieldVictoryLoot,FIELD_LOOT_POLICY} from './field-loot.js';

const keys=['gold','rice','wood','stone'],zero=Object.fromEntries(keys.map(k=>[k,0]));
let checks=0,calls=0;
const scope=async(name,run)=>{const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}};
const postAttack=(h,p,body,expected=200)=>h.api('/field/attack',post(p,body,expected));
const request=(h,a,d,castleId=save(h,d).state.home,branchId)=>({deviceId:a.deviceId,expectedRevision:row(h,a).revision,requestId:crypto.randomUUID(),targetPlayerId:d.user.id,targetCastleId:castleId,...(branchId?{targetBranchId:branchId}:{}),troops:1000,tactic:'balanced'});
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
async function force(won,work){const old=crypto.getRandomValues;crypto.getRandomValues=function(v){return v instanceof Uint32Array&&v.length===1?v.fill(won?0:0xffffffff):old.call(crypto,v);};try{return await work();}finally{crypto.getRandomValues=old;}}
async function transit(h,p){
  const v=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
  const engine=GameEngine.fromSave(v.save,GAME_OFFICERS,{isAdmin:v.user.isAdmin,isDeputy:v.user.isDeputy,isStaff:v.user.isStaff,staffBase:v.staffBase,maintenanceAuthority:v.maintenanceAuthority,branchAuthority:{resolvedElapsedMs:v.branchResolvedElapsedMs}});
  const advanced=engine.applyWorldClock(v.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(advanced.ok&&!advanced.pending&&!advanced.settlementRequired);
  return JSON.parse(engine.exportSave()).state;
}
async function fight(h,a,d,body,{won=true}={}){
  const sent=(await force(won,()=>postAttack(h,a,body))).data;
  assert(sent.marching);assert.equal(sent.battle,null);assert.equal(count(h,'field_battles'),0,'departure alone cannot pay');
  const reserved=row(h,a);h.now+=sent.march.remainingMs;
  const beforeA=await transit(h,a),beforeD=await transit(h,d),rowD=row(h,d);
  const arrived=await status(h,a),receipt=arrived.history.find(x=>x.id===sent.march.id);assert.equal(receipt?.status,'resolved');
  return {battle:receipt.battle,beforeA,beforeD,rowD,reserved,arrived,sent};
}
function verifyTransfer(h,a,d,r){
  const {battle,beforeA,beforeD}=r,afterA=save(h,a).state,afterD=save(h,d).state;
  assert.equal(battle.lootPolicy,'half-resources-v1');assert.equal(battle.lootFraction,.5);assert.equal(battle.analysis.lootScale,1);assert.deepEqual(battle.rewards,zero);
  for(const key of keys){const expected=battle.won?Math.min(Math.floor(beforeD.resources[key]/2),100000000-beforeA.resources[key]):0;
    assert.equal(battle.loot[key],expected,key+' pays exactly the available half');
    assert.equal(afterA.resources[key],beforeA.resources[key]+expected,key+' attacker credits once');
    assert.equal(afterD.resources[key],beforeD.resources[key]-expected,key+' defender debits once');
    assert.equal(afterA.resources[key]+afterD.resources[key],beforeA.resources[key]+beforeD.resources[key],key+' is conserved');
  }
  assert.equal(afterA.magatama,beforeA.magatama);assert.equal(afterD.magatama,beforeD.magatama);
  assert.equal(battle.defenderRevision,r.rowD.revision+1);assert.equal(row(h,d).revision,battle.defenderRevision);
}
function seedBranch(h,d,parent='edo'){
  const branches=[{id:parent+'_north',parentCastleId:parent,direction:'north',level:3,fallen:false}];
  updateSave(h,d,s=>{s.branches=structuredClone(branches);});
  h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,1,?,?)').run(d.user.id,save(h,d).state.walking.campaignId,JSON.stringify({branches,jobs:[]}),h.now);
  return branches[0].id;
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Loot tests must not contact production');};
try{
  await scope('resource boundaries conserve odd amounts, empty stores, cap overflow and defeat',()=>{
    const a={gold:0,rice:99999998,wood:100000000,stone:12},d={gold:101,rice:101,wood:99,stone:1};
    const r=applyFieldVictoryLoot(a,d,true);assert.deepEqual(r.loot,{gold:50,rice:2,wood:0,stone:0});assert(r.capacityLimited);
    assert.deepEqual(d,{gold:51,rice:99,wood:99,stone:1});assert.deepEqual(a,{gold:50,rice:100000000,wood:100000000,stone:12});
    const initialA={...a},initialD={...d};assert.deepEqual(applyFieldVictoryLoot(a,d,false),{loot:zero,capacityLimited:false});assert.deepEqual(a,initialA);assert.deepEqual(d,initialD);
    assert.deepEqual(applyFieldVictoryLoot({...zero},{...zero},true),{loot:zero,capacityLimited:false});
    assert.equal(FIELD_LOOT_POLICY.assetCap,100000000);
  });
  for(const kind of ['ordinary','territory','capture','operator','staff','deputy','branch'])await scope(kind+' victory transfers half, protects unrelated assets and sends matching notices',async h=>{
    const admin=await fixture(h,'運営'+kind,{admin:true});
    const d=kind==='operator'||kind==='branch'?admin:await fixture(h,'守備'+kind,{staff:kind==='staff',holdings:kind==='capture'?['nijo']:kind==='territory'?['azuchi']:[]});
    if(kind==='deputy'){
      const state=(await h.api('/admin/deputy',{token:admin.token})).data;
      await h.api('/admin/deputy',post(admin,{targetPlayerId:d.user.id,action:'appoint',requestId:crypto.randomUUID(),expectedRevision:state.revision}));
    }
    const a=await fixture(h,'攻撃'+kind,{startCastle:'inuyama'}),castleId=kind==='capture'?'nijo':kind==='territory'?'azuchi':save(h,d).state.home,branchId=kind==='branch'?seedBranch(h,d):null;
    const sharedBefore=h.sql.prepare('SELECT * FROM staff_base').get(),body=request(h,a,d,castleId,branchId),oldDefender=save(h,d),oldRevision=row(h,d).revision;
    const r=await fight(h,a,d,body);assert(r.battle.won);verifyTransfer(h,a,d,r);
    if(kind==='territory'){
      assert.equal(r.battle.castleId,'azuchi');assert.equal(r.battle.battleMode,'raid');assert.equal(r.battle.capture.captured,false);
      assert.equal(save(h,d).state.home,r.beforeD.home);assert.equal(save(h,a).state.home,r.beforeA.home);
      assert.equal(save(h,d).state.castles.azuchi.owner,r.beforeD.castles.azuchi.owner,'An occupied ordinary territory uses the established raid rule');
      assert.equal(save(h,d).state.castles[r.beforeD.home].troops,r.beforeD.castles[r.beforeD.home].troops,'The selected outpost, not the home garrison, defends');
    }
    if(['operator','staff','deputy','branch'].includes(kind)){
      assert.deepEqual(r.battle.defenderLost,{troops:0,garrison:0});assert.equal(r.battle.capture.captured,false);
      assert.deepEqual(save(h,d).state.castles,r.beforeD.castles,'special-base troops and ownership keep ordinary time progression');
      assert.deepEqual(save(h,d).state.buildings,r.beforeD.buildings,'shared defense projection cannot leak into personal buildings');
      assert.equal(save(h,d).state.troops,r.beforeD.troops);assert.deepEqual(h.sql.prepare('SELECT * FROM staff_base').get(),sharedBefore);
    }
    if(kind==='branch')assert(save(h,d).state.branches.find(x=>x.id===branchId).fallen);
    const notices=h.sql.prepare('SELECT body FROM mail_campaigns ORDER BY target_user_id').all();assert.equal(notices.length,2);for(const n of notices){assert.match(n.body,/金銭[\d,]+・兵糧[\d,]+・木材[\d,]+・石材[\d,]+/);assert(!n.body.includes('undefined'));}
    const afterA=row(h,a),afterD=row(h,d),replay=(await postAttack(h,a,body)).data;assert(replay.idempotent);assert.equal(replay.battle.id,r.battle.id);assert.deepEqual(row(h,a),afterA);assert.deepEqual(row(h,d),afterD);assert.equal(count(h,'field_battles'),1);
    await h.api('/sync/lease',post(d,{deviceId:d.deviceId}));
    const stale=await h.api('/sync',{method:'PUT',token:d.token,body:{deviceId:d.deviceId,revision:oldRevision,save:oldDefender},expected:409});assert.equal(stale.data.error.code,'REVISION_CONFLICT');assert.equal(row(h,d).save_json,afterD.save_json);
    const rewind=await h.api('/sync',{method:'PUT',token:d.token,body:{deviceId:d.deviceId,revision:afterD.revision,save:oldDefender},expected:409});assert.equal(rewind.data.error.code,'CLOCK_REWIND');assert.equal(row(h,d).save_json,afterD.save_json,'a pre-battle backup cannot restore resources even with the latest revision');
    const current=(await h.api('/sync?deviceId='+d.deviceId,{token:d.token})).data;await h.api('/sync',{method:'PUT',token:d.token,body:{deviceId:d.deviceId,revision:current.revision,save:current.save}});assert.deepEqual(save(h,d).state.resources,current.save.state.resources,'plain old-style save envelope preserves the paid result');
  });
  await scope('a very strong attacker still earns half and the public rules disclose the policy',async h=>{
    const a=await fixture(h,'圧倒的攻め手',{startCastle:'inuyama'}),d=await fixture(h,'少数守備');
    updateSave(h,a,s=>s.troops=100000);updateSave(h,d,s=>{s.troops=0;s.army=[];s.buildings.wall=1;s.castles[s.home].troops=0;s.castles[s.home].wall=1;s.castles[s.home].level=1;});
    const body={...request(h,a,d),troops:100000},r=await fight(h,a,d,body);assert(r.battle.analysis.ratio>=8);verifyTransfer(h,a,d,r);assert(r.battle.loot.gold>500);
    const rules=(await h.api('/field')).data.rules;assert.equal(rules.lootPolicy,'half-resources-v1');assert.equal(rules.lootFraction,.5);assert.equal(rules.maxLootFraction,.5);assert.deepEqual(rules.victoryRewards,zero);
  });
  await scope('the receiving cap leaves overflow with the special-base defender',async h=>{
    const d=await fixture(h,'上限試験の運営',{admin:true}),a=await fixture(h,'上限試験の攻め手');
    updateSave(h,a,s=>s.resources={gold:100000000,rice:100000000,wood:100000000,stone:100000000});
    const r=await fight(h,a,d,request(h,a,d));verifyTransfer(h,a,d,r);assert(r.battle.lootCapacityLimited);assert.equal(r.battle.loot.wood,0);
  });
  await scope('a failed attack never steals resources or mints fixed rewards',async h=>{
    const d=await fixture(h,'敗戦試験の運営',{admin:true}),a=await fixture(h,'敗戦試験の攻め手');
    const r=await fight(h,a,d,request(h,a,d),{won:false});assert.equal(r.battle.won,false);verifyTransfer(h,a,d,r);assert.deepEqual(r.battle.loot,zero);
  });
  await scope('failed result commits roll back both balances and duplicate arrivals pay once',async h=>{
    const d=await fixture(h,'原子性試験の運営',{admin:true}),a=await fixture(h,'原子性試験の攻め手'),body=request(h,a,d),sent=(await force(true,()=>postAttack(h,a,body))).data;
    h.now+=sent.march.remainingMs;const escrow=row(h,a),defender=row(h,d);
    h.sql.exec("CREATE TRIGGER reject_loot BEFORE INSERT ON field_battles BEGIN SELECT RAISE(ABORT,'injected loot failure'); END");
    const failed=await status(h,a);assert(failed.active.some(x=>x.id===sent.march.id));assert.deepEqual(row(h,a),escrow);assert.deepEqual(row(h,d),defender);assert.equal(count(h,'field_requests'),0);assert.equal(count(h,'mail_campaigns'),0);
    h.sql.exec('DROP TRIGGER reject_loot');const beforeA=await transit(h,a),beforeD=await transit(h,d),rowD=row(h,d),results=await Promise.all([status(h,a),status(h,a)]);
    const battle=results[0].history.find(x=>x.id===sent.march.id).battle;verifyTransfer(h,a,d,{battle,beforeA,beforeD,rowD});assert.equal(count(h,'field_battles'),1);assert.equal(count(h,'field_requests'),1);assert.equal(count(h,'mail_campaigns'),2);
    const committed=[row(h,a),row(h,d)],retries=await Promise.all([postAttack(h,a,body),postAttack(h,a,body)]);assert(retries.every(r=>r.data.idempotent));assert.deepEqual([row(h,a),row(h,d)],committed);
  });
  await scope('competing arrivals cannot debit a protected castle twice',async h=>{
    const d=await fixture(h,'同時襲撃の運営',{admin:true}),a=await fixture(h,'同時攻め手甲'),b=await fixture(h,'同時攻め手乙');
    const sent=await force(true,()=>Promise.all([a,b].map(p=>postAttack(h,p,request(h,p,d)))));h.now+=Math.max(...sent.map(r=>r.data.march.remainingMs));
    let entered=0,release;const wait=new Promise(resolve=>release=resolve);h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;if(++entered===2){h.beforeBatch=null;release();}await wait;};
    const beforeRevision=row(h,d).revision;await Promise.all([status(h,a),status(h,b)]);const done=await Promise.all([status(h,a),status(h,b)]);
    assert.equal(entered,2);assert.deepEqual(done.map(x=>x.history[0].status).sort(),['cancelled','resolved']);assert.equal(count(h,'field_battles'),1);assert.equal(row(h,d).revision,beforeRevision+1);
  });
  for(const kind of ['ordinary','operator','staff','deputy'])await scope(kind+' player counterattack shares the conserved half-resource policy and durable history',async h=>{
    const admin=await fixture(h,'反撃検証の運営'+kind,{admin:true}),d=kind==='operator'?admin:await fixture(h,'反撃検証の標的'+kind,{staff:kind==='staff'});
    if(kind==='deputy'){
      const current=(await h.api('/admin/deputy',{token:admin.token})).data;
      await h.api('/admin/deputy',post(admin,{targetPlayerId:d.user.id,action:'appoint',requestId:crypto.randomUUID(),expectedRevision:current.revision}));
    }
    const a=await fixture(h,'反撃検証の攻め手'+kind,{holdings:['nijo'],startCastle:'kawagoe'}),raider=await fixture(h,'反撃契機の攻め手'+kind,{startCastle:'inuyama'});
    const covertBody=extra=>({requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:row(h,a).revision,campaignId:save(h,a).state.walking.campaignId,sequence:save(h,a).state.covert.sequence,...extra});
    await h.api('/covert/hire',post(a,covertBody({sourceCastleId:'nijo',count:400})));
    const sent=(await h.api('/covert/dispatch',post(a,covertBody({sourceCastleId:'nijo',target:{kind:'player',playerId:d.user.id,castleId:save(h,d).state.home},count:300,mode:'station'})))).data;
    h.now+=sent.march.remainingMs;await status(h,a);await syncFieldWriter(h,raider);
    const incoming=(await force(false,()=>postAttack(h,raider,request(h,raider,a,'nijo')))).data;
    const incident=await settleFieldMarch(h,raider,incoming);assert.equal(incident.won,false);await syncFieldWriter(h,a);
    const targetBefore=await transit(h,d),actorBefore=save(h,a).state,defenderRow=row(h,d),body=covertBody({stationId:actorBefore.covert.stations[0].id,incidentId:incident.id});
    const oldRandom=GameEngine.prototype.random;GameEngine.prototype.random=()=>0;let response;
    try{response=(await h.api('/covert/retaliate',post(a,body))).data;}finally{GameEngine.prototype.random=oldRandom;}
    const b=response.result.battle;assert(b.won);assert.equal(b.lootPolicy,'half-resources-v1');assert.equal(b.lootFraction,.5);
    for(const key of keys){const spent=key==='rice'?response.result.foodCost:0,expected=Math.min(Math.floor(targetBefore.resources[key]/2),100000000-(actorBefore.resources[key]-spent));assert.equal(b.loot[key],expected);assert.equal(save(h,a).state.resources[key],actorBefore.resources[key]-spent+expected);assert.equal(save(h,d).state.resources[key],targetBefore.resources[key]-expected);}
    assert.equal(row(h,d).revision,defenderRow.revision+1);assert.equal(response.covert.rules.lootPolicy,'half-resources-v1');assert.equal(response.covert.rules.lootFraction,.5);
    assert.deepEqual(response.covert.history.find(v=>v.requestId===body.requestId).battle.loot,b.loot);assert.deepEqual(save(h,a).state.covert.history.find(v=>v.requestId===body.requestId).battle.loot,b.loot);
    if(kind!=='ordinary'){const after=save(h,d).state;assert.deepEqual(b.defenderLost,{troops:0,garrison:0});assert.deepEqual(after.castles[after.home],targetBefore.castles[targetBefore.home]);assert.equal(after.troops,targetBefore.troops);assert.deepEqual(after.buildings,targetBefore.buildings);}
    const committed=[row(h,a),row(h,d)];const replay=(await h.api('/covert/retaliate',post(a,body))).data;assert(replay.idempotent);assert.deepEqual(replay.result.battle.loot,b.loot);assert.deepEqual([row(h,a),row(h,d)],committed);
  });
  console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
}finally{globalThis.fetch=originalFetch;}
