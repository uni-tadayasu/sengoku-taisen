/* Independent assignment oracle plus real save/server compatibility checks.
 * All HTTP-shaped calls below run against the in-memory local Worker harness. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const realRoster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const create=(officers=realRoster,options={})=>new E({officers,clan:'織田家',seed:17,...options});
const officer=(id,politics=80,skill='commander')=>({id,name:'検証 '+id,clan:'織田家',region:'東海',lead:70,valor:70,intellect:70,politics,rank:'D',rarity:'D',skill,description:'検証用'});
const save=game=>JSON.parse(game.exportSave());
const facilities=game=>D.buildings.filter(b=>game.state.buildings[b.id]>0);
const candidates=game=>game.state.officers.filter(id=>!game.state.army.includes(id));
const close=(actual,expected,message)=>assert(Math.abs(actual-expected)<1e-9,message||`${actual} != ${expected}`);
function ownAll(game){for(const o of game.roster)assert(game._grantOfficerVariant(o.id,'D'));return game;}
function fixture(roster){
  const game=create(roster);game.state.officers=roster.map(o=>o.id);
  game.state.officerVariants=roster.map(o=>o.id+':D');game.state.army=[];game.state.governors={};return game;
}
function exceptGovernors(game){const state=structuredClone(game.state);delete state.governors;return state;}

// Independent domain scoring, expressed as integer increments above 1.0.
// It intentionally does not call the production scoring or matching helpers.
function suitability(game,buildingId,officerId){
  if(!officerId)return 0;
  const o=game.officer(officerId),category=D.buildings.find(b=>b.id===buildingId).category;
  const specialties={farmer:['rice'],merchant:['gold'],engineer:['wood','stone','defense','research']};
  return o.politics+(specialties[o.skill]?.includes(category)?40:o.skill==='administrator'?20:0);
}
function bruteForce(game){
  const buildings=facilities(game),ids=candidates(game),required=Math.min(buildings.length,ids.length),used=new Set();
  let best={score:-Infinity,retained:-1};
  function visit(row,score,retained){
    if(row===buildings.length){
      if(used.size===required&&(score>best.score||score===best.score&&retained>best.retained))best={score,retained};
      return;
    }
    if(buildings.length-row>required-used.size)visit(row+1,score,retained);
    if(used.size===required)return;
    const b=buildings[row];
    for(const id of ids)if(!used.has(id)){
      used.add(id);visit(row+1,score+suitability(game,b.id,id),retained+Number(game.state.governors[b.id]===id));used.delete(id);
    }
  }
  visit(0,0,0);return best;
}
function assertPlan(game,plan){
  assert.equal(plan.ok,true);const buildings=facilities(game),ids=candidates(game),entries=Object.entries(plan.governors);
  assert.equal(plan.facilityCount,buildings.length);assert.equal(plan.candidateCount,ids.length);
  assert.equal(plan.assignedCount,Math.min(buildings.length,ids.length));assert.equal(entries.length,plan.assignedCount);
  assert.equal(new Set(entries.map(([,id])=>id)).size,entries.length,'Each officer can govern at most one facility');
  assert.equal(plan.vacantCount,buildings.length-entries.length);
  assert.deepEqual(plan.assignments.map(a=>a.buildingId),buildings.map(b=>b.id));
  let score=buildings.length,prior=buildings.length;
  for(const assignment of plan.assignments){
    const {buildingId,officerId,previousOfficerId}=assignment;
    assert.equal(officerId,plan.governors[buildingId]||null);
    assert.equal(previousOfficerId,game.state.governors[buildingId]||null);
    if(officerId)assert(ids.includes(officerId),'Only owned officers outside the army are eligible');
    close(assignment.bonus,1+suitability(game,buildingId,officerId)/400);
    close(assignment.previousBonus,1+suitability(game,buildingId,previousOfficerId)/400);
    score+=suitability(game,buildingId,officerId)/400;prior+=suitability(game,buildingId,previousOfficerId)/400;
  }
  close(plan.totalBonus,score);close(plan.previousTotalBonus,prior);
  assert(entries.every(([id])=>buildings.some(b=>b.id===id)),'Unbuilt facilities must not receive assignments');
  const changed=[...new Set([...Object.keys(game.state.governors),...Object.keys(plan.governors)])].filter(id=>(game.state.governors[id]||null)!==(plan.governors[id]||null)).length;
  assert.equal(plan.changedCount,changed);assert.equal(plan.changed,changed>0);
  assert.equal(plan.clearedCount,Object.keys(game.state.governors).filter(id=>game.state.governors[id]&&!plan.governors[id]).length);
}
function assertOptimal(game){
  const plan=game.planGovernorAssignments(),best=bruteForce(game);assertPlan(game,plan);
  close((plan.totalBonus-plan.facilityCount)*400,best.score,'The plan must maximize the combined actual governor bonuses');
  assert.equal(plan.assignments.filter(a=>a.officerId&&a.officerId===a.previousOfficerId).length,best.retained,'Keep the greatest number of current assignments among equally suitable plans');
  return plan;
}
const tests=[];const test=(name,run)=>tests.push({name,run});

test('a pure preview beats a facility-first greedy assignment',()=>{
  const game=fixture([officer('a-merchant',100,'merchant'),officer('b-general',95)]),before=structuredClone(game.state),reference=game.state.governors;
  const plan=assertOptimal(game);assert.equal(plan.governors.market,'a-merchant');
  close(plan.totalBonus,8+(100+40+95)/400);
  assert(plan.totalBonus>8+(100+95)/400,'A greedy choice for the first keep slot would lose the merchant specialty');
  assert.deepEqual(game.state,before);assert.equal(game.state.governors,reference);
  assert.deepEqual(game.planGovernorAssignments(),plan,'Previewing must not consume randomness or alter later recommendations');
});

test('exhaustive small cases verify global suitability and retention, including an excess candidate pool',()=>{
  const sets=[
    [officer('merchant',100,'merchant'),officer('farmer',90,'farmer'),officer('engineer',80,'engineer'),officer('admin',85,'administrator')],
    [officer('low-farmer',22,'farmer'),officer('general',90),officer('admin',71,'administrator')],
    [officer('engineer-a',80,'engineer'),officer('engineer-b',80,'engineer'),officer('general',80)],
    [officer('merchant',62,'merchant'),officer('farmer',67,'farmer'),officer('engineer',90,'engineer'),officer('admin',75,'administrator'),officer('general',95)]
  ];
  for(const [index,roster]of sets.entries()){
    const game=fixture(roster);
    if(index===sets.length-1)for(const b of D.buildings)game.state.buildings[b.id]=['keep','farm','market'].includes(b.id)?1:0;
    game.state.governors={keep:roster[0].id,market:roster[1].id};assertOptimal(game);
  }
});

test('the same actual specialty multiplier is used for every facility and the current highest rank',()=>{
  const game=fixture([officer('farmer',70,'farmer'),officer('merchant',70,'merchant'),officer('engineer',70,'engineer'),officer('admin',70,'administrator'),officer('warrior',70,'cavalry')]);
  game._grantOfficerVariant('engineer','U');assert.equal(game.officer('engineer').politics,85);
  for(const b of D.buildings)for(const o of game.roster)close(game.governorBonusFor(b.id,o.id),1+suitability(game,b.id,o.id)/400,b.id+' / '+o.id);
  close(game.governorBonusFor('market','merchant'),1.275);close(game.governorBonusFor('keep','admin'),1.225);
  close(game.governorBonusFor('wall','engineer'),1.3125);close(game.governorBonusFor('barracks','warrior'),1.175);
  assert.equal(game.governorBonusFor('farm',null),1);assert.equal(game.governorBonusFor('farm','missing'),1);
});

test('rank upgrades change the chosen candidate pool without assigning one officer multiple times',()=>{
  const game=fixture([officer('learner',80),...Array.from({length:8},(_,i)=>officer('veteran-'+i,85))]);
  const initial=game.autoAssignGovernors();assert(!Object.values(initial.governors).includes('learner'));
  for(const rank of D.ranks)game._grantOfficerVariant('learner',rank);
  assert.equal(game.officer('learner').politics,95);
  const upgraded=game.planGovernorAssignments();assertPlan(game,upgraded);
  assert(Object.values(upgraded.governors).includes('learner'));assert.equal(upgraded.candidateCount,9);
  assert(upgraded.totalBonus>initial.totalBonus);assert.equal(Object.values(upgraded.governors).filter(id=>id==='learner').length,1);
  game._grantOfficerVariant('learner','D');assert.deepEqual(game.planGovernorAssignments().governors,upgraded.governors);
});

test('army officers stay excluded and every other state field remains unchanged even with zero commands',()=>{
  const game=fixture([officer('army-a',100,'administrator'),officer('army-b',100,'engineer'),officer('army-c',100,'farmer'),officer('civil-a',40),officer('civil-b',35,'merchant')]);
  game.state.army=['army-c','army-a','army-b'];game.state.command=0;game.state.resources={gold:0,rice:0,wood:0,stone:0};
  const before=exceptGovernors(game),plan=game.planGovernorAssignments();assertPlan(game,plan);
  const applied=game.autoAssignGovernors();assert.equal(applied.ok,true);assert.equal(applied.assignedCount,2);
  assert.deepEqual(exceptGovernors(game),before,'Assignment must not change army order, currency, command, log, RNG, progress, jobs or collection');
  assert.deepEqual(game.state.governors,plan.governors);assert.notEqual(game.state.governors,applied.governors);
  const assigned=structuredClone(game.state.governors);applied.governors.keep='army-a';
  assert.deepEqual(game.state.governors,assigned,'Editing the preview/result object cannot mutate the committed state');
});

test('existing governors are available for a better reassignment and are retained when equally optimal',()=>{
  const game=fixture([officer('merchant',80,'merchant'),officer('general',80)]);
  game.state.governors={keep:'merchant',market:'general'};const better=assertOptimal(game);
  assert.equal(better.governors.market,'merchant');assert(better.totalBonus>better.previousTotalBonus);
  const tied=fixture(['a','b','c','d'].map(id=>officer(id)));
  tied.state.governors={academy:'a',market:'b'};const plan=assertOptimal(tied);
  assert.equal(plan.governors.academy,'a');assert.equal(plan.governors.market,'b');
  tied.autoAssignGovernors();const reference=tied.state.governors,snapshot=structuredClone(tied.state);
  const repeated=tied.autoAssignGovernors();assert.equal(repeated.changed,false);assert.equal(repeated.changedCount,0);
  assert.equal(tied.state.governors,reference);assert.deepEqual(tied.state,snapshot);
});

test('an actual suitability improvement takes priority over keeping current appointments',()=>{
  const roster=Array.from({length:8},(_,i)=>officer('old-'+i,80));roster.push(officer('better',81));
  const game=fixture(roster);game.state.governors=Object.fromEntries(facilities(game).map((b,i)=>[b.id,'old-'+i]));
  const plan=game.planGovernorAssignments();assertPlan(game,plan);
  assert(Object.values(plan.governors).includes('better'));assert.equal(plan.changedCount,1);
  close(plan.totalBonus-plan.previousTotalBonus,1/400);
});

test('ties are stable across officer acquisition and roster ordering',()=>{
  const roster=['d','b','a','c'].map(id=>officer(id)),first=fixture(roster),second=fixture([...roster].reverse());
  first.state.governors={academy:'c'};second.state.governors={academy:'c'};
  assert.deepEqual(first.planGovernorAssignments().governors,second.planGovernorAssignments().governors);
  first.state.officers.reverse();assert.deepEqual(first.planGovernorAssignments().governors,second.planGovernorAssignments().governors);
});

test('too few candidates leave explicit vacancies and zero candidates are a harmless no-op',()=>{
  const few=fixture([officer('only',80,'farmer')]);const plan=few.planGovernorAssignments();assertPlan(few,plan);
  assert.equal(plan.governors.farm,'only');assert.equal(plan.vacantCount,7);assert.equal(plan.assignments.filter(a=>a.officerId===null).length,7);
  for(const roster of [[],['a','b','c'].map(id=>officer(id))]){
    const game=fixture(roster);game.state.army=roster.map(o=>o.id);const before=structuredClone(game.state),empty=game.autoAssignGovernors();
    assertPlan(game,empty);assert.equal(empty.changed,false);assert.equal(empty.assignedCount,0);assert.deepEqual(game.state,before);
  }
});

test('eligibility follows completed construction, including upgrades and inherited advanced facilities',()=>{
  const game=ownAll(create());game.state.army=[];game.state.buildings.keep=1;game.state.buildings.mint=1;
  game.state.jobs=[{kind:'building',id:'gold_mine',targetLevel:1,remaining:1,total:1,remainingSeconds:45,totalSeconds:60},{kind:'building',id:'farm',targetLevel:3,remaining:1,total:1,remainingSeconds:45,totalSeconds:60}];
  assert.equal(game.buildingUnlock('mint').ok,false,'The fixture deliberately has a previously built advanced facility');
  const plan=game.planGovernorAssignments();assertPlan(game,plan);
  assert(plan.governors.mint);assert(plan.governors.farm);assert.equal(plan.governors.gold_mine,undefined);
  assert.equal(plan.facilityCount,9);const before=exceptGovernors(game);game.autoAssignGovernors();assert.deepEqual(exceptGovernors(game),before);
});

test('all 64 facilities can be assigned from the complete roster without duplicates or army changes',()=>{
  const game=ownAll(create());for(const b of D.buildings)game.state.buildings[b.id]=1;
  const before=exceptGovernors(game),plan=game.planGovernorAssignments();assertPlan(game,plan);
  assert.equal(plan.facilityCount,64);assert.equal(plan.assignedCount,64);assert.equal(plan.candidateCount,realRoster.length-game.state.army.length);
  assert(plan.candidateCount>200);assert.equal(plan.vacantCount,0);assert(Number.isFinite(plan.totalBonus));
  game.autoAssignGovernors();assert.deepEqual(exceptGovernors(game),before);assert.equal(game.autoAssignGovernors().changed,false);
});

test('commit recomputes after a preview so newly assigned army officers cannot be moved into a facility',()=>{
  const game=fixture([officer('merchant',100,'merchant'),officer('farmer',90,'farmer'),officer('general',80)]);
  const preview=game.planGovernorAssignments();assert.equal(preview.governors.market,'merchant');
  assert(game.assignArmy(['merchant']).ok);game.state.buildings.gold_mine=1;game._grantOfficerVariant('general','U');
  const before=exceptGovernors(game),current=game.planGovernorAssignments(),committed=game.autoAssignGovernors();
  assert.equal(committed.candidateCount,2);assert.equal(committed.facilityCount,9);assert.deepEqual(committed.governors,current.governors);
  assert(!Object.values(committed.governors).includes('merchant'));assert.deepEqual(exceptGovernors(game),before);
});

for(const role of [{},{isAdmin:true}])test(`${role.isAdmin?'operator':'ordinary'} batch assignments survive repeated exports and reloads`,()=>{
  let game=ownAll(create(realRoster,role));for(const b of D.buildings)game.state.buildings[b.id]=Math.max(1,game.state.buildings[b.id]);
  game.state.army=game.state.officers.slice(0,3).reverse();assert(game.autoAssignGovernors().ok);
  const expected={army:structuredClone(game.state.army),governors:structuredClone(game.state.governors)},schema=save(game).version;
  for(let restart=0;restart<3;restart++){
    const raw=save(game),source=structuredClone(raw);game=E.fromSave(raw,realRoster,role);
    assert.deepEqual(raw,source);assert.equal(save(game).version,schema);
    assert.deepEqual({army:game.state.army,governors:game.state.governors},expected);assert.equal(game.autoAssignGovernors().changed,false);
  }
});

function staffFixture(){
  const personal=ownAll(create()),s=personal.state,buildings={...s.buildings,gold_mine:1};
  const base={id:'sunpu',revision:1,accessSinceElapsedMs:0,castleLevel:1,buildings,
    initial:{buildings:structuredClone(buildings),castleLevel:1},history:[],jobs:[],
    personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,
    personalSunpu:structuredClone(s.castles.sunpu),personalHomeCastle:structuredClone(s.castles[s.home])};
  return{game:E.fromSave(personal.exportSave(),realRoster,{isStaff:true,staffBase:base}),base};
}
test('staff use projected shared facilities while their personal levels and shared base stay intact',()=>{
  const {game,base}=staffFixture(),before=exceptGovernors(game),baseBefore=structuredClone(base),viewBefore=game.getStaffBase();
  const plan=game.planGovernorAssignments();assertPlan(game,plan);assert.equal(plan.facilityCount,9);assert(plan.governors.gold_mine);
  game.autoAssignGovernors();assert.deepEqual(exceptGovernors(game),before);assert.deepEqual(base,baseBefore);assert.deepEqual(game.getStaffBase(),viewBefore);
  const raw=save(game);assert.equal(raw.state.buildings.gold_mine,0);assert.deepEqual(raw.state.governors,plan.governors);
  const reloaded=E.fromSave(raw,realRoster,{isStaff:true,staffBase:base});
  assert.equal(reloaded.state.buildings.gold_mine,1);assert.deepEqual(reloaded.state.governors,plan.governors);assert.equal(reloaded.autoAssignGovernors().changed,false);
});

test('staff cannot assign before the shared facility projection has arrived',()=>{
  const game=create(realRoster,{isStaff:true}),before=structuredClone(game.state);
  assert.equal(game.getStaffBase(),null);assert.equal(game.planGovernorAssignments().ok,false);assert.equal(game.autoAssignGovernors().ok,false);
  assert.deepEqual(game.state,before);
});

test('an explicit batch handles dormant staff appointments without losing officers or changing the army',()=>{
  const {game,base}=staffFixture();game.autoAssignGovernors();const dormant=game.state.governors.gold_mine;
  const revised=structuredClone(base);revised.revision++;revised.buildings.gold_mine=0;revised.initial.buildings.gold_mine=0;
  game.applyStaffBase(revised);assert.equal(game.state.buildings.gold_mine,0);assert.equal(game.state.governors.gold_mine,dormant);
  const before=exceptGovernors(game),plan=game.planGovernorAssignments();assertPlan(game,plan);assert.equal(plan.clearedCount,1);
  game.autoAssignGovernors();assert.equal(game.state.governors.gold_mine,undefined);assert(game.state.officers.includes(dormant));assert.deepEqual(exceptGovernors(game),before);
});

test('a batch with no built facilities is safe and clears only explicit stale appointments',()=>{
  const game=fixture([officer('a')]);for(const b of D.buildings)game.state.buildings[b.id]=0;
  const before=structuredClone(game.state),empty=game.autoAssignGovernors();assertPlan(game,empty);assert.equal(empty.changed,false);assert.deepEqual(game.state,before);
  game.state.governors={farm:'a'};const prior=exceptGovernors(game),cleared=game.autoAssignGovernors();
  assert.equal(cleared.changed,true);assert.equal(cleared.clearedCount,1);assert.deepEqual(game.state.governors,{});assert.deepEqual(exceptGovernors(game),prior);
});

test('the existing local Worker accepts and preserves an ordinary batch with the current save schema',async()=>{
  const {harness}=await import('../server/test-support.mjs'),h=harness();
  try{
    const player=await h.session('一括奉行の保存検証'),deviceId='auto-governor-local';
    const lease=(await h.api('/sync/lease',{method:'POST',token:player.token,body:{deviceId,takeOver:true}})).data;
    const game=ownAll(create());game.applyWorldClock((await h.api('/world-clock')).data.clock);
    for(const b of D.buildings)game.state.buildings[b.id]=Math.max(1,game.state.buildings[b.id]);
    game.state.army=game.state.officers.slice(0,3).reverse();game.autoAssignGovernors();
    const expected=structuredClone({army:game.state.army,governors:game.state.governors});
    const written=(await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId,revision:lease.revision,save:save(game)}})).data;
    const read=(await h.api('/sync?deviceId='+deviceId,{token:player.token})).data;
    for(const result of [written,read])assert.deepEqual({army:result.save.state.army,governors:result.save.state.governors},expected);
    assert.equal(read.save.version,save(game).version);assert.equal(Object.keys(read.save.state.governors).length,64);
  }finally{h.close();}
});

test('the existing local Worker preserves staff assignments on shared-only facilities',async()=>{
  const {harness}=await import('../server/test-support.mjs'),h=harness();
  try{
    const admin=await h.session('一括奉行の運営');await h.api('/admin/claim',{method:'POST',token:admin.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});
    const player=await h.session('一括奉行のスタッフ'),deviceId='staff-auto-governor-local';
    const lease=(await h.api('/sync/lease',{method:'POST',token:player.token,body:{deviceId,takeOver:true}})).data;
    const personal=ownAll(create());personal.applyWorldClock((await h.api('/world-clock')).data.clock);
    await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId,revision:lease.revision,save:save(personal)}});
    await h.api('/admin/staff',{method:'POST',token:admin.token,body:{targetPlayerId:player.user.id,action:'appoint',requestId:crypto.randomUUID()}});
    await h.api('/sync?deviceId='+deviceId,{token:player.token});
    const shared=JSON.parse(h.sql.prepare("SELECT state_json FROM staff_base WHERE id='kyoto_gosho'").get().state_json);
    shared.buildings.gold_mine=1;shared.initial.buildings.gold_mine=1;
    h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='kyoto_gosho'").run(JSON.stringify(shared));
    const latest=(await h.api('/sync?deviceId='+deviceId,{token:player.token})).data;
    const game=E.fromSave(latest.save,realRoster,{isStaff:true,staffBase:latest.staffBase});
    game.applyWorldClock(latest.clock);game.autoAssignGovernors();
    assert(game.state.governors.gold_mine);assert.equal(save(game).state.buildings.gold_mine,0);
    const expected=structuredClone({army:game.state.army,governors:game.state.governors});
    const written=(await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId,revision:latest.revision,save:save(game)}})).data;
    const read=(await h.api('/sync?deviceId='+deviceId,{token:player.token})).data;
    for(const result of [written,read]){
      assert.deepEqual({army:result.save.state.army,governors:result.save.state.governors},expected);assert.equal(result.save.state.buildings.gold_mine,0);
    }
    const restored=E.fromSave(read.save,realRoster,{isStaff:true,staffBase:read.staffBase});assert.deepEqual(restored.state.governors,expected.governors);
  }finally{h.close();}
});

(async()=>{
  for(const {name,run}of tests){await run();console.log('PASS '+name);}
  console.log(`${tests.length} automatic governor tests passed. Local in-memory services only; no production requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
