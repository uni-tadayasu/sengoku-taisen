/* Domain checks for the shared, read-only player evaluation. No network/players. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};
vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const evaluate=(state,officers=[])=>E.evaluateState(state,{officers});
const category=(value,id)=>value.breakdown.find(item=>item.id===id).score;
const unit=(id,more={})=>({id,name:id,clan:'織田家',lead:100,valor:50,intellect:0,politics:100,rank:'D',skill:'commander',...more});
let tests=0;
function test(name,fn){fn();tests++;console.log(`PASS ${name}`);}
function freeze(value){if(value&&typeof value==='object'){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}

test('an unstarted account is unranked; every documented boundary is inclusive',()=>{
  const empty=evaluate(null);
  assert.equal(empty.score,0);assert.equal(empty.rankName,'無位');assert.equal(empty.toNext,5000);
  const thresholds=[0,5000,10000,15000,20000,25000,30000,35000,40000,45000,50000,60000,70000,80000,90000,95000,98000];
  const names=['無位','従八位','正八位','従七位','正七位','従六位','正六位','従五位','正五位','従四位','正四位','従三位','正三位','従二位','正二位','従一位','正一位'];
  assert.deepEqual(D.evaluationRanks.map(r=>r.minScore),thresholds);
  thresholds.forEach((threshold,i)=>{
    assert.equal(E.evaluationRank(threshold).name,names[i]);
    if(i)assert.equal(E.evaluationRank(threshold-1).name,names[i-1]);
  });
  for(const invalid of [NaN,Infinity,-100,'100000'])assert.equal(E.evaluationRank(invalid).name,'無位');
  assert.equal(E.evaluationRank(200000).name,'正一位');
});
test('castle tier limits and only held castles count toward territory',()=>{
  const value=evaluate({clan:'織田家',castles:{kiyosu:{owner:'織田家',level:999},osaka:{owner:'織田家',level:999},sunpu:{owner:'織田家',level:999},edo:{owner:'徳川家',level:64},invented:{owner:'織田家',level:64}}});
  assert.equal(category(value,'territory'),6700); // 3×600 + (32+48+32)×43.75
  assert.equal(category(evaluate({castles:{kiyosu:{level:32}}}),'territory'),0);
});
test('completed facilities/research count, queued construction and balances do not',()=>{
  const state={buildings:{keep:32},tech:{cultivation:5},jobs:[{kind:'building',id:'farm',targetLevel:32}],resources:{gold:999999999},troops:1000000};
  const value=evaluate(state);
  assert.equal(category(value,'buildings'),312);assert.equal(category(value,'research'),1250);
  state.jobs=[];state.resources={gold:0};state.troops=0;
  assert.deepEqual(evaluate(state),value);
  state.buildings.farm=32;assert.equal(category(evaluate(state),'buildings'),625);
});
test('unique officers and best held rarity prevent duplicate gacha score inflation',()=>{
  const officers=[unit('a')],state={officers:['a'],officerVariants:['a:D']};
  assert.equal(category(evaluate(state,officers),'officers'),85); // 60 + 1×25
  state.officerVariants.push('a:U');assert.equal(category(evaluate(state,officers),'officers'),260);
  state.officers.push('a','missing');state.officerVariants.push('a:U','missing:U','a:UNKNOWN');
  assert.equal(category(evaluate(state,officers),'officers'),260);
});
test('formation rewards valid assigned ability and excludes overlaps/vacant facilities',()=>{
  const officers=[unit('a'),unit('b',{skill:'engineer'})];
  const state={officers:['a','b'],officerVariants:['a:D','b:D'],army:['a','a','missing'],governors:{academy:'b',farm:'b',market:'a',fake:'b'},buildings:{academy:1,market:1}};
  // a: (100+50+0)/900×6000 = 1000. b: a full suitable governor = 6000/64.
  assert.equal(category(evaluate(state,officers),'formation'),1093);
  state.buildings.academy=0;assert.equal(category(evaluate(state,officers),'formation'),1000);
  state.army=[];assert.equal(category(evaluate(state,officers),'formation'),66); // a can govern market now
});
test('milestones and recorded walking are capped and produce integer points',()=>{
  const state={prestige:20000,stats:{wins:100},walking:{localSteps:600000,serverSteps:400000}};
  const value=evaluate(state);
  assert.equal(category(value,'merit'),15000);assert.equal(category(value,'walking'),5000);
  state.prestige=Number.MAX_SAFE_INTEGER;state.stats.wins=Number.MAX_SAFE_INTEGER;state.walking.serverSteps=Number.MAX_SAFE_INTEGER;
  assert.deepEqual(evaluate(state),value);
  assert.equal(category(evaluate({walking:{localSteps:199,serverSteps:0}}),'walking'),0);
  assert.equal(category(evaluate({walking:{localSteps:199,serverSteps:1}}),'walking'),1);
});
test('one exact score drives title, progress, and the compact public DTO',()=>{
  const state={prestige:10000};
  const value=evaluate(state);
  assert.equal(value.score,5000);assert.equal(value.rankName,'従八位');assert.equal(value.rankIndex,1);
  assert.equal(value.toNext,5000);assert.equal(value.progressPercent,0);
  assert.deepEqual(E.publicEvaluation(state,{officers:[]}),{version:1,score:5000,maxScore:100000,rankId:'court-1',rankName:'従八位',rankIndex:1});
  state.prestige=15000;assert.equal(evaluate(state).progressPercent,50);
  state.evaluation={score:100000,rankName:'正一位'};state.rank='正一位';
  assert.equal(evaluate(state).rankName,'従八位');
});
test('every real campaign and save round trip stays unchanged when evaluated',()=>{
  for(const clan of D.clans){
    const game=new E({officers:roster,clan:clan.name,seed:25}),before=structuredClone(game.state);
    freeze(game.state);const value=game.evaluation();
    assert.deepEqual(game.state,before);assert(value.score>0&&value.score<15000);
    assert.equal(value.score,value.breakdown.reduce((sum,item)=>sum+item.score,0));
    assert.equal(value.breakdown.reduce((sum,item)=>sum+item.maxScore,0),100000);
    const restored=E.fromSave(game.exportSave(),roster);
    assert.deepEqual(restored.evaluation(),value);
    assert.deepEqual(restored.state.army,before.army);assert.deepEqual(restored.state.governors,before.governors);
  }
});
test('shared job author titles refresh without changing construction or personal progress',()=>{
  const game=new E({officers:roster,clan:'伊達家',isStaff:true,seed:31});
  const buildings=structuredClone(game.state.buildings);
  const base={id:'sunpu',revision:1,castleLevel:1,buildings,initial:{castleLevel:1,buildings:structuredClone(buildings)},history:[],jobs:[{jobId:'qa-shared-job',kind:'building',id:'farm',targetLevel:3,startedElapsedMs:0,completesElapsedMs:60000,totalSeconds:60,startedBy:{id:'peer',name:'着工者',evaluation:E.publicEvaluation({prestige:10000},{officers:roster})}}],accessSinceElapsedMs:0,personalClan:'伊達家'};
  assert.equal(game.applyStaffBase(base).ok,true);
  const before=structuredClone(game.state),stored=JSON.parse(game.exportSave()).state;
  const incoming=structuredClone(base);incoming.jobs[0].startedBy.name='改名した着工者';incoming.jobs[0].startedBy.evaluation=E.publicEvaluation({prestige:20000},{officers:roster});
  assert.deepEqual(game.applyStaffBase(incoming),{ok:true,changed:true,displayOnly:true});
  assert.deepEqual(game.state,before);assert.deepEqual(JSON.parse(game.exportSave()).state,stored);
  assert.equal(game.getStaffBase().jobs[0].startedBy.evaluation.rankName,'正八位');
  assert.equal(game.getStaffBase().jobs[0].targetLevel,3);
  assert.deepEqual(game.applyStaffBase(incoming),{ok:true,changed:false});
  incoming.jobs[0].startedBy.id='different-player';
  assert.deepEqual(game.applyStaffBase(incoming),{ok:true,changed:false});
  assert.equal(game.getStaffBase().jobs[0].startedBy.id,'peer');
});
test('an ordinary fully developed campaign can attain the highest title',()=>{
  const game=new E({officers:roster,seed:3});
  for(const o of roster)game._grantOfficerVariant(o.id,game.canOwnOfficerVariant(o.id,'U')?'U':'SSS');
  for(const b of D.buildings)game.state.buildings[b.id]=32;
  for(const t of D.techs)game.state.tech[t.id]=5;
  for(const c of D.castles)if(game.canOwnCastle(c.id)){game.state.castles[c.id].owner=game.state.clan;game.state.castles[c.id].level=game.castleLevelLimit(c.id);}
  game.state.prestige=20000;game.state.stats.wins=100;game.state.walking.localSteps=1000000;
  const best=game.state.officers.map(id=>game.officer(id)).sort((a,b)=>(b.lead+b.valor+b.intellect)-(a.lead+a.valor+a.intellect)).slice(0,3);
  game.assignArmy(best.map(o=>o.id));const plan=game.planGovernorAssignments();assert.equal(plan.ok,true);game.state.governors={...plan.governors};
  const value=game.evaluation();assert.equal(value.rankName,'正一位');assert(value.score<=100000);assert.equal(value.nextRank,null);assert.equal(value.toNext,0);assert.equal(value.progressPercent,100);
  console.log(`Highest attainable fixture: ${value.score.toLocaleString()} / 100,000`);
});
console.log(`${tests} player evaluation domain tests passed`);
