'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:data}=require('../engine.js');
const rosterContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterContext);
const officers=rosterContext.window.SENGOKU_OFFICERS;
let count=0;
function test(name,run){run();count++;console.log('PASS '+name);}
function game(options={}){return new Engine({officers,seed:17,...options});}
function branchGame(){
  const g=game({startCastle:'sakamoto'});
  g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false}];
  return g;
}
function deployment(troops=400){return{unitId:'wild_1_kiyosu_0',castleId:'kiyosu',encounterId:'road_scouts',deploymentRevision:1,slot:0,troops,available:true};}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))deepFreeze(child);}return value;}
function unchanged(g,run){
  const before=JSON.stringify(g.state),seed=g.state.seed,random=g.random;
  g.random=()=>{throw Error('Read-only battle advice must never draw RNG');};
  try{const value=run();assert.equal(JSON.stringify(g.state),before);assert.equal(g.state.seed,seed);return value;}finally{g.random=random;}
}
function preview(g,advice,policy=advice.policy){return advice.mode==='branch'?g.previewBranchBattle(advice.targetId,advice.tactic,advice.troops):advice.mode==='roaming'?g.previewRoamingBattle(advice.targetId,advice.tactic,advice.troops,{deploymentUnit:policy?.deploymentUnit}):g.previewBattle(advice.targetId,advice.tactic,advice.troops);}
function legal(g,advice,policy=advice.policy){
  assert.equal(advice.ok,true,advice.message);
  for(const choice of [advice,...advice.alternatives]){
    const p=preview(g,choice,policy);
    assert.equal(p.ok,true,p.message);assert(Number.isSafeInteger(choice.troops));assert(choice.troops>=300&&choice.troops<=g.state.troops);
    assert.equal(choice.foodCost,p.foodCost);assert.equal(choice.commandCost,1);
    assert.equal(choice.winChance,choice.mode==='roaming'?(p.predictedWin?100:0):p.winChance);
    assert(choice.estimatedLoss>=0&&choice.estimatedLoss<=choice.troops);
    assert.equal(choice.reserveAfter.troops,g.state.troops-choice.troops);assert.equal(choice.reserveAfter.rice,g.state.resources.rice-p.foodCost);
    assert(choice.reserveAfter.troops>=policy.reserveTroops);assert(choice.reserveAfter.rice>=policy.reserveRice);
  }
}

test('all three battle advisors are deterministic and read only, including frozen saves',()=>{
  for(const [g,options]of [[game(),{mode:'castle',targetId:'inuyama'}],[branchGame(),{mode:'branch',targetId:'nijo_north'}],[game(),{mode:'roaming',targetId:'road_scouts',deploymentUnit:deployment()}]]){
    deepFreeze(g.state);deepFreeze(options);
    const first=unchanged(g,()=>g.adviseBattle(options)),second=unchanged(g,()=>g.adviseBattle(options));
    assert.deepEqual(first,second);legal(g,first);assert(first.reasons.length>=3);
  }
});

test('each policy returns a legal recommendation with its stated safety threshold',()=>{
  const g=game(),thresholds={conserve:85,balanced:75,rapid:65},results=[];
  for(const [style,threshold]of Object.entries(thresholds)){
    const a=g.adviseBattle({mode:'castle',targetId:'inuyama',style});legal(g,a);
    assert.equal(a.minWinChance,threshold);assert(a.winChance>=threshold);assert.equal(a.meetsGoal,true);assert.equal(a.caution,false);assert.equal(a.recommendation,'attack');results.push(a);
  }
  assert(new Set(results.map(a=>a.tactic+':'+a.troops)).size>1,'Different policies should compare the same battlefield differently');
});

test('all returned alternatives preserve the requested troop and rice reserves',()=>{
  for(const [g,options]of [[game(),{mode:'castle',targetId:'inuyama'}],[branchGame(),{mode:'branch',targetId:'nijo_north'}],[game(),{mode:'roaming',targetId:'forest_bows'}]]){
    g.state.troops=4800;g.state.resources.rice=2500;
    const a=g.adviseBattle({...options,reserveTroops:1200,reserveRice:800});legal(g,a);
    assert.equal(new Set(a.alternatives.map(v=>v.tactic)).size,a.alternatives.length);
    assert(!a.alternatives.some(v=>v.tactic===a.tactic));
  }
});

test('exact minimum food costs allow one legal sortie and never borrow reserved rice',()=>{
  const castle=game();castle.state.troops=1000;castle.state.resources.rice=340;
  let a=castle.adviseBattle({mode:'castle',targetId:'inuyama',reserveRice:100});legal(castle,a);assert.equal(a.troops,300);assert.equal(a.foodCost,240);assert.equal(a.reserveAfter.rice,100);
  castle.state.resources.rice=339;assert.equal(castle.adviseBattle(a.policy).ok,false);
  const roaming=game();roaming.state.resources.rice=192;
  a=roaming.adviseBattle({mode:'roaming',targetId:'road_scouts'});legal(roaming,a);assert.equal(a.tactic,'balanced');assert.equal(a.troops,300);assert.equal(a.foodCost,192);
  roaming.state.resources.rice=191;assert.equal(roaming.adviseBattle(a.policy).ok,false);
});

test('insufficient command, troops, or reserved resources cannot produce a sortie',()=>{
  for(const [make,options]of [[game,{mode:'castle',targetId:'inuyama'}],[branchGame,{mode:'branch',targetId:'nijo_north'}],[game,{mode:'roaming',targetId:'road_scouts'}]]){
    let g=make();g.state.command=0;assert.equal(unchanged(g,()=>g.adviseBattle(options)).ok,false);
    g=make();g.state.troops=299;assert.equal(g.adviseBattle(options).code,'BATTLE_TROOPS');
    g=make();assert.equal(g.adviseBattle({...options,reserveTroops:g.state.troops-299}).code,'BATTLE_TROOPS');
    g=make();assert.equal(g.adviseBattle({...options,reserveRice:g.state.resources.rice+1}).code,'BATTLE_RICE');
    g=make();g.state.gameOver=true;assert.equal(g.adviseBattle(options).ok,false);
  }
});

test('protected, friendly, allied, and nonadjacent castle restrictions remain effective',()=>{
  const g=game();
  for(const targetId of [g.state.home,'edo','kyoto_gosho','shuri','missing'])assert.equal(unchanged(g,()=>g.adviseBattle({mode:'castle',targetId})).ok,false,targetId);
  const enemy=g.state.castles.inuyama.owner;g.state.treaties[enemy]=g.state.turn+5;
  assert.equal(g.adviseBattle({mode:'castle',targetId:'inuyama'}).ok,false);
  assert.equal(game({isStaff:true}).adviseBattle({mode:'castle',targetId:'nijo'}).code,'BATTLE_GUARD','A staff member needs the verified shared base before any advice can be actionable');
});

test('branch advice addresses the branch itself and observes its lifecycle',()=>{
  const g=branchGame(),a=g.adviseBattle({mode:'branch',targetId:'nijo_north'});legal(g,a);
  assert.equal(a.branchId,'nijo_north');assert.equal(a.castleId,'nijo');assert.equal(a.parentCastleId,'nijo');
  assert.equal(g.adviseBattle({mode:'castle',targetId:'nijo'}).code,'BRANCHES_REQUIRED');
  g.state.branches[0].fallen=true;assert.equal(g.adviseBattle(a.policy).code,'BRANCH_FALLEN');
  g.state.branches[0].fallen=false;g.state.branches[0].level=0;assert.equal(g.adviseBattle(a.policy).code,'BRANCH_UNBUILT');
  g.state.branches[0].level=2;g.state.castles.nijo.owner=g.state.clan;assert.equal(g.adviseBattle(a.policy).ok,false);
  assert.equal(g.adviseBattle({mode:'branch',targetId:'missing'}).code,'BRANCH_NOT_FOUND');
});

test('roaming advice uses the selected deployment and reports exact deterministic loss',()=>{
  const g=game(),unit=deployment(),a=g.adviseBattle({mode:'roaming',targetId:unit.encounterId,deploymentUnit:unit});legal(g,a);
  const p=preview(g,a);assert.equal(a.enemyTroops,unit.troops);assert.equal(a.estimatedLoss,p.expectedLoss);assert.equal(a.winChance,p.predictedWin?100:0);assert.equal(a.deterministic,true);assert.equal(a.unitId,unit.unitId);
  const originalUnit=JSON.stringify(unit);a.policy.deploymentUnit.troops=700;assert.equal(JSON.stringify(unit),originalUnit,'Advice must not expose the input deployment by reference');
  assert.equal(g.adviseBattle({mode:'roaming',targetId:unit.encounterId,deploymentUnit:{...unit,available:false}}).ok,false);
  assert.equal(g.adviseBattle({mode:'roaming',targetId:'forest_bows',deploymentUnit:unit}).ok,false);
  g.state.army=[];assert.equal(g.adviseBattle({mode:'roaming',targetId:'road_scouts'}).ok,false);
});

test('roaming deployment respects capacity and the one million per sortie limit',()=>{
  const g=game();g.state.troops=Engine.ASSET_CAP;g.state.resources.rice=Engine.ASSET_CAP;
  const a=g.adviseBattle({mode:'roaming',targetId:'ronin_vanguard'});legal(g,a);
  assert.equal(a.maxTroops,Math.min(g.troopCapacity(),1000000));assert(a.troops<=a.maxTroops);
  const capacity=g.troopCapacity;g.troopCapacity=()=>Engine.ASSET_CAP;
  const capped=g.adviseBattle({mode:'roaming',targetId:'ronin_vanguard'});legal(g,capped);assert.equal(capped.maxTroops,1000000);g.troopCapacity=capacity;
});

test('weak legal armies receive a preparation warning instead of a claim of safe victory',()=>{
  const g=game();g.state.troops=300;g.state.castles.inuyama.troops=Engine.ASSET_CAP;
  const castle=g.adviseBattle({mode:'castle',targetId:'inuyama'});legal(g,castle);assert.equal(castle.caution,true);assert.equal(castle.meetsGoal,false);assert.equal(castle.recommendation,'prepare');assert.match(castle.message,/届きません/);
  const roaming=g.adviseBattle({mode:'roaming',targetId:'ronin_vanguard'});legal(g,roaming);assert.equal(roaming.winChance,0);assert.equal(roaming.predictedWin,false);assert.equal(roaming.recommendation,'prepare');assert.match(roaming.message,/勝利できる編成がありません/);
});

test('invalid advisor settings fail without state changes or exceptions',()=>{
  const g=game(),base={mode:'castle',targetId:'inuyama'};
  for(const options of [null,[],false,{}, {...base,mode:'event'}, {...base,style:'unknown'}, {...base,style:'constructor'}, {...base,targetId:3}, ...[-1,0.5,NaN,Infinity,Engine.ASSET_CAP+1].flatMap(n=>[{...base,reserveTroops:n},{...base,reserveRice:n}]), {...base,deploymentUnit:deployment()}, {mode:'roaming',targetId:'road_scouts',deploymentUnit:{}}])assert.equal(unchanged(g,()=>g.adviseBattle(options)).ok,false);
});

test('reusing a policy recalculates current supplies, opponent strength and deployment availability',()=>{
  const g=game(),first=g.adviseBattle({mode:'castle',targetId:'inuyama'});legal(g,first);
  g.state.castles.inuyama.troops=Engine.ASSET_CAP;const tougher=unchanged(g,()=>g.adviseBattle(first.policy));legal(g,tougher);assert(tougher.winChance<first.winChance);assert.equal(tougher.recommendation,'prepare');
  g.state.resources.rice=0;assert.equal(unchanged(g,()=>g.adviseBattle(first.policy)).ok,false);
  g.state.resources.rice=5400;g.state.command=0;assert.equal(unchanged(g,()=>g.adviseBattle(first.policy)).ok,false);
  const wild=game(),a=wild.adviseBattle({mode:'roaming',targetId:'road_scouts',deploymentUnit:deployment()});
  assert.equal(wild.adviseBattle({...a.policy,deploymentUnit:{...a.policy.deploymentUnit,available:false}}).ok,false);
});

test('existing automatic strategy rechecks its full state token and campaign scope',()=>{
  const g=game();g.state.troops=20000;g.state.resources.rice=50000;
  const compiled=g.compileStrategy('兵を温存');assert.equal(compiled.ok,true,compiled.message);
  const decision=unchanged(g,()=>g.planStrategy(compiled.policy));assert.equal(decision.action,'attack');
  g.state.resources.rice--;
  const stale=unchanged(g,()=>g.executeStrategy(compiled.policy,decision));assert.equal(stale.ok,false);assert.equal(stale.code,'STRATEGY_CHANGED');assert.equal(stale.changed,false);
  g.state.cycle.index++;const changed=unchanged(g,()=>g.planStrategy(compiled.policy));assert.equal(changed.action,'stop');assert.equal(changed.code,'STRATEGY_SCOPE_CHANGED');
});

test('unification proof ignores saved victory flags and checks every eligible holding',()=>{
  const g=game();g.state.won=true;
  const before=unchanged(g,()=>g.getUnificationProof());assert.equal(before.achieved,false);assert.equal(before.owned,1);assert.equal(before.target,127);assert.equal(before.campaignId,g.state.walking.campaignId);
  for(const id of before.targetCastleIds)g.state.castles[id].owner=g.state.clan;g.state.won=false;
  const proof=unchanged(g,()=>g.getUnificationProof());assert.equal(proof.achieved,true);assert.equal(proof.owned,127);assert.equal(proof.target,127);assert(!proof.targetCastleIds.includes('edo'));assert(!proof.targetCastleIds.includes('kyoto_gosho'));
  g.state.castles.inuyama.owner='在地衆';assert.equal(g.getUnificationProof().achieved,false);
});

test('unification proof uses verified roles and returns independent arrays',()=>{
  for(const [options,role,target,included,excluded]of [[{},'player',127,'kiyosu','edo'],[{isAdmin:true},'admin',128,'edo','kyoto_gosho'],[{isStaff:true},'staff',128,'kyoto_gosho','edo']]){
    const g=game(options);g.state.isAdmin=true;g.state.isStaff=true;g.state.isCourtEmperor=true;
    const p=unchanged(g,()=>g.getUnificationProof());assert.equal(p.role,role);assert.equal(p.target,target);assert(p.targetCastleIds.includes(included));assert(!p.targetCastleIds.includes(excluded));
    p.targetCastleIds.length=0;p.ownedCastleIds.length=0;assert.equal(g.getUnificationProof().target,target);assert.equal(g.getUnificationProof().owned,1);
  }
});

test('cycle settlement removes the current unification proof and keeps the existing payout',()=>{
  const g=game(),proof=g.getUnificationProof();for(const id of proof.targetCastleIds)g.state.castles[id].owner=g.state.clan;
  assert.equal(g.getUnificationProof().achieved,true);const before={gold:g.state.resources.gold,rice:g.state.resources.rice,magatama:g.state.magatama};
  const reward=g._settleCycle(1),after=unchanged(g,()=>g.getUnificationProof());
  assert.equal(reward.captured,126);assert.equal(after.cycle,1);assert.equal(after.achieved,false);assert.equal(after.owned,1);assert.equal(after.campaignId,proof.campaignId);
  assert.equal(g.state.resources.gold,before.gold+126000);assert.equal(g.state.resources.rice,before.rice+126000);assert.equal(g.state.magatama,before.magatama+12600);
});

test('advice and proof preserve the existing version two save contract',()=>{
  const g=game(),saved=JSON.parse(g.exportSave()),restored=Engine.fromSave(saved,officers),before=JSON.stringify(restored.state);
  legal(restored,restored.adviseBattle({mode:'castle',targetId:'inuyama'}));restored.getUnificationProof();
  assert.equal(JSON.stringify(restored.state),before);const after=JSON.parse(restored.exportSave());assert.equal(after.version,2);assert.equal(after.state.version,2);assert.deepEqual(Object.keys(after.state).sort(),Object.keys(saved.state).sort());assert.equal(after.state.shogunate,undefined);
});

console.log(`Battle advisor engine: ${count} tests passed.`);
