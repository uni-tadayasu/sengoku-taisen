'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const make=(opts={})=>{const g=new E({officers,seed:7,...opts});g.state.troops=50000;g.state.resources.rice=900000;return g;};
const tests=[];function test(name,fn){tests.push([name,fn]);}
test('text compilation preserves explicit zero and numbers, rejects unknown and contradictory instructions',()=>{const g=make();assert.equal(g.compileStrategy('兵糧を1000残す').policy.reserveRice,1000);assert.equal(g.compileStrategy('兵1000を残す').policy.reserveTroops,1000);assert.equal(g.compileStrategy('3回まで').policy.maxBattles,3);const zero=g.compileStrategy('攻める。0回');assert.equal(zero.policy.maxBattles,0);assert.equal(g.planStrategy(zero.policy).action,'stop');for(const text of ['xxx未知文のみ','東は避けて攻める','清洲城を目指す。清洲城は攻めない','江戸城を目指す','3.5回まで','-1回','兵を-100残す','他のプレイヤーへ攻撃'])assert.equal(g.compileStrategy(text).ok,false,text);const negative=g.compileStrategy('武田家には攻撃しない。味方の城は攻めない。弱い城から攻略');assert(negative.ok);assert.equal(negative.policy.hold,false);assert(negative.policy.excludeClans.includes('武田家'));});
test('all houses can evaluate candidates without resources, RNG or other state changes',()=>{for(const clan of D.clans){const g=make({clan:clan.name}),before=JSON.stringify(g.state),compiled=g.compileStrategy('兵を温存して弱い城から攻める。兵糧を1000残す。3回まで');assert(compiled.ok);const plan=g.planStrategy(compiled.policy);assert.equal(JSON.stringify(g.state),before);assert(['attack','wait'].includes(plan.action));if(plan.action==='attack'){assert(plan.winChance>=compiled.policy.minWinChance);assert(plan.reserveAfter.troops>=compiled.policy.reserveTroops);assert(plan.reserveAfter.rice>=1000);assert(g.adjacentTargets().some(c=>c.id===plan.castleId));assert(!['edo','kyoto_gosho'].includes(plan.castleId));assert.equal(g.planStrategy(compiled.policy).token,plan.token);}}});
test('ordinary negative grammar never becomes an affirmative attack',()=>{const g=make();for(const text of ['城は攻めてはいけない','攻撃をしない','攻撃はしない','出陣してはいけません','攻撃は避ける']){const result=g.compileStrategy(text);assert(result.ok,text);assert.equal(result.policy.hold,true,text);assert.equal(g.planStrategy(result.policy).action,'stop',text);}const excluded=g.compileStrategy('武田家には攻撃をしない。江戸城は攻めてはいけない。味方の城は攻めない。弱い城から攻める');assert(excluded.ok);assert.equal(excluded.policy.hold,false);assert(excluded.policy.excludeClans.includes('武田家'));assert(excluded.policy.excludeCastleIds.includes('edo'));});
test('goal routing respects protected castles and treaties and already-owned goals stop immediately',()=>{const g=make(),own=g.compileStrategy('清洲城を目指す');assert.equal(g.planStrategy(own.policy).code,'STRATEGY_TARGET_REACHED');const target=g.adjacentTargets()[0],policy=g.compileStrategy(target.name+'を目指す').policy;snapshot=g.planStrategy(policy);assert.equal(snapshot.castleId,target.id);g.state.treaties[target.owner]=g.state.turn+6;assert.equal(g.planStrategy(policy).action,'wait');const region=g.compileStrategy('九州を目指す。関東は攻めない');assert(region.ok);const plan=g.planStrategy(region.policy);if(plan.action==='attack')assert.notEqual(g.castle(plan.castleId).region,'関東');});
function arrive(game,march){
  const receipts=[];
  let remaining=march.remainingMs/1000;
  while(remaining>0){
    const seconds=Math.min(remaining,1);
    const tick=game.tick(seconds);
    receipts.push(...tick.marchResults);
    remaining-=seconds;
  }
  assert.equal(receipts.length,1);
  assert.equal(receipts[0].id,march.id);
  assert.equal(receipts[0].status,'resolved');
  return receipts[0];
}
test('same decision cannot execute twice or after unrelated manual state mutations',()=>{
  const g=make(),policy=g.compileStrategy('弱い城から攻める。3回まで').policy,decision=g.planStrategy(policy);
  assert.equal(decision.action,'attack');g.state.resources.gold++;
  const before=JSON.stringify(g.state);
  assert.equal(g.executeStrategy(policy,decision).code,'STRATEGY_CHANGED');assert.equal(JSON.stringify(g.state),before);
  const fresh=g.planStrategy(policy);assert.notEqual(fresh.token,decision.token);g.random=()=>0;
  const result=g.executeStrategy(policy,fresh);assert(result.ok&&result.marching);assert.equal(g.state.stats.battles,0);
  const after=JSON.stringify(g.state);
  assert.equal(g.executeStrategy(policy,fresh).ok,false);assert.equal(JSON.stringify(g.state),after);
  assert(arrive(g,result.march).battle.won);assert.equal(g.state.stats.battles,1);
  assert.equal(g.executeStrategy(policy,fresh).ok,false);
});
test('a final command pays at departure and the victory or defeat arrives once',()=>{
  const g=make(),target=g.adjacentTargets()[0];g.state.command=1;g.random=()=>0;
  const policy=g.compileStrategy(target.name+'を目指す。5回まで').policy,result=g.executeStrategy(policy,g.planStrategy(policy));
  assert(result.ok&&result.marching);assert.equal(g.state.command,0);
  assert.equal(g.planStrategy(policy).code,'STRATEGY_MARCHING');
  assert(arrive(g,result.march).battle.won);assert.equal(g.planStrategy(policy).code,'STRATEGY_TARGET_REACHED');
  const losing=make();losing.random=()=>.9999;
  const p=losing.compileStrategy('弱い城から攻める').policy,r=losing.executeStrategy(p,losing.planStrategy(p));
  assert(r.ok&&r.marching);assert.equal(losing.state.stats.battles,0);
  assert.equal(arrive(losing,r.march).battle.won,false);assert.equal(losing.state.stats.battles,1);
  assert.equal(losing.state.march,null);assert.deepEqual(losing.resolveDueMarches(),[]);
});
test('scope, source readiness, command, clock and resource constraints prevent execution',()=>{for(const change of [g=>g.state.walking.campaignId='changed',g=>g.state.cycle.index++,g=>g.setRoleAccess({isAdmin:true}),g=>g.state.home=g.adjacentTargets()[0].id]){const g=make(),p=g.compileStrategy('弱い城から攻める').policy;change(g);assert.equal(g.planStrategy(p).action,'stop');}
 for(const change of [g=>g.state.command=0,g=>g.state.realtime.running=false,g=>g.state.resources.rice=100,g=>g.state.troops=300]){const g=make(),p=g.compileStrategy('弱い城から攻める').policy;change(g);const before=JSON.stringify(g.state),d=g.planStrategy(p);assert.equal(d.action,'wait');assert.equal(g.executeStrategy(p,d).ok,false);assert.equal(JSON.stringify(g.state),before);}const staff=make({isStaff:true}),p=staff.compileStrategy('弱い城から攻める').policy;assert.equal(staff.planStrategy(p).code,'STAFF_BASE_PENDING');});
test('manual battle counts toward the run limit and full exact tokens reject forged decisions',()=>{const g=make(),p=g.compileStrategy('弱い城から攻める。1回まで').policy,d=g.planStrategy(p),before=JSON.stringify(g.state);assert.equal(g.executeStrategy(p,{...d,troops:d.troops+1}).ok,false);assert.equal(JSON.stringify(g.state),before);g.random=()=>0;assert(g.attack(d.castleId,d.tactic,d.troops).ok);assert.equal(g.planStrategy(p).code,'STRATEGY_LIMIT');});
let snapshot;for(const [name,fn] of tests){fn();console.log('PASS '+name);}console.log(tests.length+' strategy engine checks passed.');
