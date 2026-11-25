'use strict';
// Actual engine checks for salary accounting, assignment changes and saved time.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=value=>JSON.parse(JSON.stringify(value));
const game=options=>{const g=new E({officers,clan:'徳川家',seed:77,...options});g._cpuTurn=()=>[];return g;};
const load=g=>{const h=E.fromSave(g.exportSave(),officers,{isAdmin:g.isAdmin,isStaff:g.isStaff,staffBase:g.getStaffBase(),maintenanceAuthority:g.getMaintenanceAuthority()});h._cpuTurn=()=>[];return h;};
const spare=g=>g.state.officers.find(id=>!g.state.army.includes(id));
const assign=(g,building='wall',id=spare(g))=>{assert(id);const result=g.assignGovernor(building,id);assert(result.ok,result.message);return id;};
const clock=elapsedMs=>({id:'governor-salary-clock',elapsedMs,running:true,speed:1});
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('a valid appointment adds only its salary and accounting reads never debit money',()=>{
 const g=game(),before=copy(g.state),base=g.income();
 assert.deepEqual(g.governorPayroll(),{count:0,perOfficer:50,gold:0,rice:0,wood:0,stone:0});
 assert.equal(D.maintenance.governorMonthlyGold,50);
 assert.equal(base.governorCount,0);assert.deepEqual(base.governorSalary,{gold:0,rice:0,wood:0,stone:0});
 assign(g);const assigned=copy(g.state),income=g.income(),m=g.maintenance();
 assert.equal(income.governorCount,1);assert.equal(m.governorCount,1);assert.equal(income.gold,base.gold-50);
 assert.deepEqual(income.governorSalary,{gold:50,rice:0,wood:0,stone:0});
 assert.deepEqual(income.facilityUpkeep,base.facilityUpkeep);assert.deepEqual(income.troopUpkeep,base.troopUpkeep);
 for(const key of D.resources){
  assert.equal(m.totalUpkeep[key],m.troopUpkeep[key]+m.facilityUpkeep[key]+m.governorSalary[key]);
  assert.equal(income.net[key],income.gross[key]-m.totalUpkeep[key]-income.surplusAdjustment[key]);
  if(key!=='gold')assert.equal(income[key],base[key]);
 }
 for(let i=0;i<10;i++){g.governorPayroll();g.maintenance();g.income();g.previewRecruitment(100);g.recruitmentBudget();}
 assert.deepEqual(g.state,assigned);assert.deepEqual(g.state.resources,before.resources);
});

test('quotes ignore unbuilt facilities, missing or unowned officers and duplicate appointments',()=>{
 const g=game(),id=spare(g),unbuilt=D.buildings.find(b=>!g.state.buildings[b.id]),unowned=officers.find(o=>!g.state.officers.includes(o.id)).id;
 const before=copy(g.state),quote=g.governorPayroll({wall:id,keep:id,[unbuilt.id]:g.state.officers[0],farm:'unknown-officer',market:unowned,'unknown-building':g.state.officers[1]});
 assert.equal(quote.count,1);assert.equal(quote.gold,50);assert.deepEqual(g.state,before);
});

test('projected appointments preserve instance-bound roles and external troop expenses without changing state',()=>{
 for(const options of [{},{isAdmin:true}]){
  const g=game(options),id=officers.find(o=>g.canOwnOfficerVariant(o.id,'D')&&!g.state.army.includes(o.id)).id;
  assert(g._grantOfficerVariant(id,'D'));
  const authority={version:1,campaignId:g.state.walking.campaignId,activatedElapsedMs:0,revision:1,asOfElapsedMs:60000,baseline:{elapsedMs:0,vacant:100,trade:125,alliance:150},changes:[]};
  assert(g.setMaintenanceAuthority(authority).ok);
  const appointments=Object.freeze({wall:id}),before=copy(g.state),reference=load(g);reference.state.governors={...appointments};
  const projected=g.income({governors:appointments}),maintenance=g.maintenance({governors:appointments});
  assert.deepEqual(projected,reference.income());assert.deepEqual(maintenance,reference.maintenance());
  assert.equal(maintenance.troops.external,375);assert.equal(projected.governorSalary.gold,50);
  assert.deepEqual(g.state,before);assert.deepEqual(g.getMaintenanceAuthority(),authority);
  assert.equal(g.income().governorSalary.gold,0,'A quote must not install the proposed appointments');
 }
});

test('half-month service is charged proportionally and dismissal stops future salary',()=>{
 const g=game(),reference=load(g),id=assign(g);
 g._advanceRealtime(30);reference._advanceRealtime(30);
 assert.equal(reference.state.resources.gold-g.state.resources.gold,25);
 assert(g.assignGovernor('wall',null).ok);g._advanceRealtime(30);reference._advanceRealtime(30);
 assert.equal(reference.state.resources.gold-g.state.resources.gold,25);assert.equal(g.income().governorCount,0);
 assign(g,'wall',id);g._advanceRealtime(30);reference._advanceRealtime(30);
 assert.equal(reference.state.resources.gold-g.state.resources.gold,50);
 for(const key of ['rice','wood','stone'])assert.equal(g.state.resources[key],reference.state.resources[key]);
});

test('moving between facilities pays once and army or branch assignment ends governor salary',()=>{
 const g=game(),id=assign(g);assert(g.assignGovernor('academy',id).ok);assert.equal(g.income().governorCount,1);assert(!g.state.governors.wall);
 assert(g.assignArmy([id]).ok);assert.equal(g.income().governorCount,0);
 assert(g.assignGovernor('wall',id).ok);g.state.castles.nijo.owner=g.state.clan;
 g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,commanders:[],stationedTroops:0}];
 const result=g.assignBranchCommander('nijo_north',id);assert(result.ok,result.message);
 assert.equal(g.income().governorCount,0);assert.deepEqual(g.state.branches[0].commanders,[id]);
});

test('fractional salary survives saves and catch-up matches small clock steps',()=>{
 const initial=game();assign(initial);assert(initial.applyWorldClock(clock(0)).ok);
 const whole=load(initial);let pieces=load(initial);
 assert(whole.applyWorldClock(clock(180250)).ok);
 for(let elapsed=250;elapsed<=180250;elapsed+=250){
  assert(pieces.applyWorldClock(clock(elapsed)).ok);
  if(elapsed%17500===0)pieces=load(pieces);
 }
 assert.deepEqual(pieces.state.resources,whole.state.resources);
 assert.equal(pieces.state.worldClock.elapsedMs,180250);assert.equal(pieces.state.turn,whole.state.turn);
 for(const key of D.resources)assert(Math.abs(pieces.state.realtime.incomeRemainders[key]-whole.state.realtime.incomeRemainders[key])<1e-7,key);
 const saved=copy(pieces.state),restored=load(pieces);assert.deepEqual(restored.state.resources,saved.resources);
 assert.equal(restored.applyWorldClock(clock(180250)).changed,false);
 assert.deepEqual(restored.state.resources,saved.resources);assert.equal(restored.income().governorCount,1);
});

test('an existing save needs no payroll field and loading alone never back-charges',()=>{
 const g=game();assign(g);g._advanceRealtime(17.25);const raw=JSON.parse(g.exportSave()),balances=copy(raw.state.resources);
 assert(!Object.hasOwn(raw.state,'payroll'));assert(!Object.hasOwn(raw.state,'governorSalary'));
 const restored=E.fromSave(raw,officers);assert.deepEqual(restored.state.resources,balances);
 assert.equal(restored.income().governorSalary.gold,50);assert.deepEqual(restored.state.resources,balances);
 assert.deepEqual(load(restored).state.resources,balances);
});

test('dormant staff appointments cost nothing until their shared facility is completed',()=>{
 const personal=game({clan:'豊臣家'}),extra=D.buildings.find(b=>!b.core),id=spare(personal);
 personal.state.buildings[extra.id]=1;assign(personal,extra.id,id);
 const home=personal.state.home,buildings=copy(personal.state.buildings);buildings[extra.id]=0;
 const base={id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings:copy(buildings)},buildings:copy(buildings),jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0,personalClan:personal.state.clan,personalHome:home,personalCycleHome:home,personalBaseCastle:copy(personal.state.castles.kyoto_gosho),personalHomeCastle:copy(personal.state.castles[home])};
 const g=E.fromSave(personal.exportSave(),officers,{isStaff:true,staffBase:base});
 assert.equal(g.state.governors[extra.id],id);assert.equal(g.state.buildings[extra.id],0);assert.equal(g.income().governorCount,0);
 assert.equal(load(g).income().governorCount,0);
 const complete=copy(base);complete.revision++;complete.initial.buildings[extra.id]=complete.buildings[extra.id]=1;
 assert(g.applyStaffBase(complete).ok);assert.equal(g.income().governorCount,1);assert.equal(g.income().governorSalary.gold,50);
 const before=copy(g.state),shared=copy(g.getStaffBase()),reference=load(g);reference.state.governors={};
 assert.deepEqual(g.income({governors:{}}),reference.income(),'A staff projection retains shared-base maintenance exclusions');
 assert.deepEqual(g.state,before);assert.deepEqual(g.getStaffBase(),shared);
});

test('recruitment limits, reserves and existing troop reductions account for salaries',()=>{
 const g=game();g.state.buildings.farm=32;g.state.buildings.barracks=32;g.state.troops=0;g.state.castles[g.state.home].troops=0;
 g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};assign(g);
 const income=g.income(),budget=g.recruitmentBudget(income),fee=income.governorSalary.gold;
 let expected=0;
 for(let n=0;n<=20000;n++)if(Math.ceil(n/25)+income.facilityUpkeep.gold+fee<=income.gross.gold&&Math.ceil(3*n/25)+income.facilityUpkeep.rice<=income.gross.rice)expected=n;
 assert(expected>0&&expected<20000);assert.equal(budget.sustainableMax,expected);
 const last=g.previewRecruitment(expected,income),next=g.previewRecruitment(expected+1,income);
 assert(last.sustainable);assert(!next.sustainable);assert.equal(last.governorSalary.gold,50);
 assert.equal(last.totalUpkeep.gold,last.troopUpkeep.gold+income.facilityUpkeep.gold+50);
 assert.equal(last.reserve.gold,Math.max(budget.minimumReserve.gold,last.totalUpkeep.gold*budget.reserveMonths));
 g.state.troops=expected+1;const balances=copy(g.state.resources),result=g.rebalanceTroopsForUpkeep();
 assert.equal(result.removed,1);assert.equal(g.maintenance().totalTroops,expected);
 assert.equal(g.income().governorSalary.gold,50);assert.deepEqual(g.state.resources,balances);
 g.state.troops++;assert(g.income().gold<0||g.income().rice<0);
});

test('salary has no debt, morale penalty or automatic dismissal when gold reaches zero',()=>{
 const g=game();for(const b of D.buildings)if(['military','defense','research','diplomacy'].includes(b.category))g.state.buildings[b.id]=32;
 g.state.buildings.keep=1;g.state.buildings.market=1;
 g.state.troops=0;g.state.castles[g.state.home].troops=0;g.state.resources.gold=1;
 const id=assign(g),morale=g.state.morale,magatama=g.state.magatama;
 assert(g.income().gold<0);g._advanceRealtime(5);
 assert.equal(g.state.resources.gold,0);assert.equal(g.state.governors.wall,id);
 assert.equal(g.state.morale,morale);assert.equal(g.state.magatama,magatama);assert.equal(g.state.realtime.incomeRemainders.gold,0);
});

test('all sixty-four active appointments have a bounded salary and high-income rows reconcile',()=>{
 const g=game();g.state.army=[];const candidates=officers.filter(o=>g.canOwnOfficerVariant(o.id,o.rank)).slice(0,D.buildings.length);
 assert.equal(candidates.length,64);
 for(let i=0;i<D.buildings.length;i++){
  const building=D.buildings[i],officer=candidates[i];g.state.buildings[building.id]=32;g._grantOfficerVariant(officer.id,officer.rank);
  assert(g.assignGovernor(building.id,officer.id).ok);
 }
 const income=g.income();assert.equal(income.governorCount,64);assert.equal(income.governorSalary.gold,3200);
 for(const key of D.resources)assert.equal(income.net[key],income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key]-income.governorSalary[key]-income.surplusAdjustment[key]);
 assert.equal(load(g).income().governorSalary.gold,3200);
});
console.log(count+' governor salary checks passed.');

