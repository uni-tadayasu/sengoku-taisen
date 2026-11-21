'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E}=require('../engine.js'),scope={window:{}};
vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const make=()=>{const game=new E({officers:roster,clan:'徳川家',startCastle:'okazaki',seed:451});game.state.resources={gold:120000,rice:180000,wood:120000,stone:120000};game.state.buildings.keep=8;game.state.buildings.barracks=8;game.state.troops=18000;game.state.morale=100;game.state.command=4;return game;};
const checks=[],game=make(),before=JSON.stringify(game.state),compiled=game.compileStrategy('兵を温存して弱い城から攻める。兵糧を1000残す。3回まで');
assert(compiled.ok);const plan=game.planStrategy(compiled.policy);assert.equal(plan.action,'attack');assert.equal(JSON.stringify(game.state),before);
assert(plan.reserveAfter.troops>=1000&&plan.reserveAfter.rice>=1000&&plan.winChance>=85);assert(!['edo','sunpu'].includes(plan.castleId));
checks.push('compile and preview are read-only, including random seed; the chosen deployment respects reserves and protected bases');
const once=E.fromSave(game.exportSave(),roster),result=once.executeStrategy(compiled.policy,plan);assert(result.ok&&result.changed);const after=JSON.stringify(once.state),duplicate=once.executeStrategy(compiled.policy,plan);assert(!duplicate.ok&&!duplicate.changed);assert.equal(JSON.stringify(once.state),after);
checks.push('one decision executes once; replay cannot attack or pay a second time');
const changed=make(),policy=changed.compileStrategy('弱い城から攻める').policy,oldPlan=changed.planStrategy(policy);changed.state.resources.rice++;const current=JSON.stringify(changed.state);assert.equal(changed.executeStrategy(policy,oldPlan).code,'STRATEGY_CHANGED');assert.equal(JSON.stringify(changed.state),current);
checks.push('a changed game state invalidates the earlier decision without mutation');
for(const text of ['攻撃しない','0回']){const c=game.compileStrategy(text);assert(c.ok);assert.equal(game.planStrategy(c.policy).action,'stop');}
assert.equal(game.compileStrategy('xxx未知文のみ').ok,false);assert.equal(game.compileStrategy('清洲城を攻める。清洲城は攻めない').ok,false);
checks.push('global prohibition, zero budget, unknown text and conflicting targets are handled explicitly');
const avoidClan=game.compileStrategy('武田家には攻撃しない。弱い城から攻める');assert(avoidClan.ok&&!avoidClan.policy.hold&&avoidClan.policy.excludeClans.includes('武田家'));const honorAllies=game.compileStrategy('味方の城は攻めない。弱い城から攻める');assert(honorAllies.ok&&!honorAllies.policy.hold);
checks.push('clan and ally prohibitions preserve their intended scope');
for(const mutate of [g=>g.state.walking.campaignId='another-campaign',g=>g.state.cycle.index++,g=>g.state.home='kiyosu',g=>g.setRoleAccess({isAdmin:true})]){const g=E.fromSave(game.exportSave(),roster);mutate(g);assert.equal(g.planStrategy(compiled.policy).action,'stop');}
checks.push('campaign, cycle, home and authenticated-role changes retire the prior strategy');
const loss=make(),lossPolicy=loss.compileStrategy('弱い城から攻める').policy,lossPlan=loss.planStrategy(lossPolicy);loss.random=()=>0.9999;const lost=loss.executeStrategy(lossPolicy,lossPlan);assert(lost.ok&&!lost.battle.won&&lost.shouldStop);assert.equal(lost.stopReason,'defeat');
checks.push('a defeated automatic attack instructs the runner to stop');
console.log(JSON.stringify({ok:true,checks,example:{castle:plan.castleName,tactic:plan.tacticName,troops:plan.troops,winChance:plan.winChance,food:plan.foodCost}},null,2));
