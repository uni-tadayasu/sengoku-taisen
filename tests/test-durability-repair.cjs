'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=structuredClone;
const game=options=>{const g=new E({officers,clan:'徳川家',seed:77,...options});g._cpuTurn=()=>[];return g;};
const load=g=>{const h=E.fromSave(g.exportSave(),officers,{isAdmin:g.isAdmin,isStaff:g.isStaff,staffBase:g.getStaffBase(),maintenanceAuthority:g.getMaintenanceAuthority()});h._cpuTurn=()=>[];return h;};
const elapsed=g=>g.state.turn*60000+Math.round(g.state.realtime.elapsed*1000);
const damage=(g,id=g.state.home,current=5000)=>{const row=g.state.castles[id],max=E.durabilityMax({castleId:id,level:row.level,wall:row.wall});row.durability={version:1,current,max,updatedElapsedMs:elapsed(g)};return row.durability;};
const clock=elapsedMs=>({id:'repair-clock',elapsedMs,running:true,speed:1});
function equalProgress(a,b){
 const left=copy(a.state),right=copy(b.state);
 for(const key of D.resources){assert(Math.abs(left.realtime.incomeRemainders[key]-right.realtime.incomeRemainders[key])<1e-7,key+' fractional carry');left.realtime.incomeRemainders[key]=right.realtime.incomeRemainders[key];}
 assert.deepEqual(left,right);
}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('paid views expose work without healing or spending, and NPC free recovery is explicit',()=>{
 const g=game(),id=g.state.home,record=damage(g),before=copy(g.state),income=g.income();
 const paid=E.durabilityView(record,{castleId:id,elapsedMs:60000}),free=E.durabilityView(record,{castleId:id,elapsedMs:60000,recoveryMode:'free'});
 assert.equal(paid.current,5000);assert.equal(paid.repairPendingHP,1000);assert.equal(paid.recoveryMode,'paid');
 assert.equal(free.current,6000);assert.equal(free.recoveryMode,'free');
 assert.deepEqual(income.operatingNet,{gold:530,rice:466,wood:197,stone:147});
 assert.deepEqual(income.repairUpkeep,{gold:0,rice:0,wood:50,stone:40});
 assert.deepEqual(income.net,{gold:530,rice:466,wood:147,stone:107});
 for(const key of D.resources)assert.equal(income.net[key],income.operatingNet[key]-income.repairUpkeep[key]);
 for(let i=0;i<10;i++){g.castle(id);g.income();g.maintenance();g.repairQuote();}
 assert.deepEqual(g.state,before);
 const enemy=D.castles.find(c=>g.state.castles[c.id].owner!==g.state.clan&&!['edo','kyoto_gosho'].includes(c.id)).id;
 damage(g,enemy,5000);g.state.realtime.elapsed=30;
 assert.equal(g.castle(enemy).durability.recoveryMode,'free');assert(g.castle(enemy).durability.current>5000);
 assert.equal(g.castle(id).durability.current,5000);
});

test('monthly repair charges exact materials once after operating income, including through save/reload',()=>{
 const g=game(),reference=load(g),id=g.state.home;damage(g);
 g._advanceRealtime(59.999);reference._advanceRealtime(59.999);assert.equal(g.castle(id).durability.current,5000);
 assert.deepEqual(g.state.resources,reference.state.resources);assert.deepEqual(g.state.repair.spent,{wood:0,stone:0});
 g._advanceRealtime(.001);reference._advanceRealtime(.001);
 assert.equal(g.castle(id).durability.current,6000);assert.equal(g.state.repair.settledTurn,1);
 assert.equal(reference.state.resources.wood-g.state.resources.wood,50);assert.equal(reference.state.resources.stone-g.state.resources.stone,40);
 assert.deepEqual(g.state.repair.recovered.castles,{[id]:1000});
 const restored=load(g),before=copy(restored.state);assert.equal(restored.settleMonthlyRepairs().changed,false);assert.deepEqual(restored.state,before);
});

test('repair is a full inventory expense after surplus adjustment, without altering gold, rice, salaries or caps',()=>{
 const g=game();for(const b of D.buildings)g.state.buildings[b.id]=32;
 const spare=g.state.officers.find(id=>!g.state.army.includes(id));assert(g.assignGovernor('wall',spare).ok);
 const reference=load(g),max=E.durabilityMax({castleId:g.state.home,level:g.state.castles[g.state.home].level,wall:g.state.castles[g.state.home].wall});
 damage(g,g.state.home,Math.floor(max/2));const income=g.income();assert(income.surplusAdjustment.wood>0);assert.equal(income.governorSalary.gold,50);
 g._advanceRealtime(60);reference._advanceRealtime(60);
 assert.equal(reference.state.resources.wood-g.state.resources.wood,g.state.repair.spent.wood);
 assert.equal(reference.state.resources.stone-g.state.resources.stone,g.state.repair.spent.stone);
 assert.equal(g.state.resources.gold,reference.state.resources.gold);assert.equal(g.state.resources.rice,reference.state.resources.rice);
 assert.equal(D.assetCap,100000000);assert.equal(g.income().governorSalary.gold,50);
});

test('damage halfway through a month is prorated and a second battle preserves earlier unpaid work',()=>{
 const g=game(),id=g.state.home;g._advanceRealtime(30);damage(g);g._advanceRealtime(30);
 assert.equal(g.castle(id).durability.current,5500);assert.deepEqual(g.state.repair.spent,{wood:25,stone:20});
 g._advanceRealtime(30);const battle=g._damageCastleDurability(id,{won:false,ratio:1});
 assert.equal(battle.after,3000);assert.equal(g.state.castles[id].durability.repairPendingHP,500);
 g._advanceRealtime(30);assert.equal(g.castle(id).durability.current,4000);
 assert.deepEqual(g.state.repair.spent,{wood:75,stone:60});assert.equal(g.state.repair.recovered.castles[id],1500);
});

test('fractional material costs use prepaid credit and are independent of repair chunk sizes',()=>{
 const pay=chunks=>{let g=game();g.state.resources.wood=g.state.resources.stone=100000;let total=0;
  for(const [index,hp]of chunks.entries()){
   damage(g,g.state.home,10000-hp);g.state.turn++;g.state.realtime.elapsed=0;
   const result=g.settleMonthlyRepairs();assert.equal(result.repairedHP,hp);total+=hp;
   assert.deepEqual(E.normalizeRepairState(g.state.repair,g.state.turn),g.state.repair);
   if(index===0||index===chunks.length-1)g=load(g);
  }
  assert.equal(g.state.repair.recovered.castles[g.state.home],total);return g;
 };
 const whole=pay([1000]),ones=pay(Array(1000).fill(1)),split=pay([17,983]);
 for(const g of [whole,ones,split]){assert.deepEqual(g.state.repair.spent,{wood:50,stone:40});assert.deepEqual(g.state.repair.credit,{wood:0,stone:0});assert.equal(g.state.resources.wood,99950);assert.equal(g.state.resources.stone,99960);}
});

test('scarce materials permit only affordable HP, spend neither resource when one is absent, and never create backlog debt',()=>{
 const g=game(),id=g.state.home;damage(g);g.state.resources.wood=5;g.state.resources.stone=4;g.state.turn=1;
 const first=g.settleMonthlyRepairs();assert(first.limited);assert.equal(first.requestedHP,1000);assert.equal(first.repairedHP,100);
 assert.equal(g.castle(id).durability.current,5100);assert.equal(g.state.resources.wood,0);assert.equal(g.state.resources.stone,0);
 g.state.turn=2;assert.equal(g.settleMonthlyRepairs().repairedHP,0);
 g.state.resources.wood=50;g.state.resources.stone=40;assert.equal(g.castle(id).durability.current,5100);
 g.state.turn=3;assert.equal(g.settleMonthlyRepairs().repairedHP,1000,'Unfunded work must not allow a later month to exceed its 10% rate');
 assert.equal(g.castle(id).durability.current,6100);
 const blocked=game();damage(blocked);blocked.state.resources.wood=100;blocked.state.resources.stone=0;blocked.state.turn=1;
 assert.equal(blocked.settleMonthlyRepairs().repairedHP,0);assert.equal(blocked.state.resources.wood,100);assert.equal(blocked.state.resources.stone,0);
});

test('several damaged castles and active branches share a fixed material budget proportionally and deterministically',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;g.state.castles.nijo.wall=1;damage(g);damage(g,'nijo',10000);
 g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false,commanders:[],stationedTroops:0,durability:{version:1,current:3250,max:6500,updatedElapsedMs:0}}];
 g.state.resources.wood=50;g.state.resources.stone=40;
 const before=copy(g.state),quote=g.repairQuote();assert.equal(quote.requestedHP,3650);assert.equal(quote.repairedHP,1000);assert.equal(quote.cost.wood,50);assert.equal(quote.cost.stone,40);
 const amounts=Object.fromEntries(quote.allocations.map(row=>[row.kind+':'+row.id,row.repairedHP]));
 assert.deepEqual(amounts,{'branch:nijo_north':178,'castle:nijo':548,'castle:okazaki':274});assert.deepEqual(g.state,before);
 const h=load(g);h.state.castles=Object.fromEntries(Object.entries(h.state.castles).reverse());assert.deepEqual(h.repairQuote(),quote);
 g.state.turn=1;const result=g.settleMonthlyRepairs();assert.deepEqual(result.cost,quote.cost);
 assert.equal(g.state.repair.recovered.branches.nijo_north,178);assert.equal(g.state.repair.recovered.castles.nijo,548);
});

test('full castles, unbuilt/fallen/retreating branches and enemy holdings do not consume personal repair materials',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;
 g.state.branches=[
  {id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:true,durability:{version:1,current:0,max:6500,updatedElapsedMs:0}},
  {id:'nijo_east',parentCastleId:'nijo',direction:'east',level:0,fallen:false},
  {id:'nijo_south',parentCastleId:'nijo',direction:'south',level:2,fallen:false,retreating:true,durability:{version:1,current:2000,max:6500,updatedElapsedMs:0}}
 ];
 damage(g,'kiyosu',5000);g.state.turn=1;const before=copy(g.state.resources),result=g.settleMonthlyRepairs();
 assert.equal(result.repairedHP,0);assert.deepEqual(g.state.resources,before);assert.deepEqual(g.state.repair.spent,{wood:0,stone:0});
 assert.equal(g.branch('nijo_north').durability.current,0);assert.equal(g.branch('nijo_east').durability.max,0);
});

test('existing fallen-branch reconstruction pays its quoted construction price and adds no ordinary HP fee on completion',()=>{
 const g=game();g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g.state.castles.nijo.owner=g.state.clan;
 g.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:true,commanders:[],stationedTroops:0,durability:{version:1,current:0,max:6500,updatedElapsedMs:0}}];
 const quote=g.branchRepairQuote('nijo_north'),before=copy(g.state.resources);assert(quote.ok);assert(g.repairBranch('nijo_north').ok);
 for(const key of D.resources)assert.equal(before[key]-g.state.resources[key],quote.cost[key]||0);
 g._advanceRealtime(quote.cost.seconds);assert.equal(g.branch('nijo_north').durability.current,6500);
 assert.deepEqual(g.state.repair.spent,{wood:0,stone:0});assert.deepEqual(g.state.repair.recovered.branches,{});
});

test('shared Kyoto durability never charges a staff member while that member still pays for their personal castle',()=>{
 const personal=game({clan:'豊臣家'}),home=personal.state.home;damage(personal,home,5000);
 const buildings=copy(personal.state.buildings),base={id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings:copy(buildings)},buildings:copy(buildings),jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0,personalClan:personal.state.clan,personalHome:home,personalCycleHome:home,personalBaseCastle:copy(personal.state.castles.kyoto_gosho),personalHomeCastle:copy(personal.state.castles[home]),durability:{version:1,current:20000,max:40000,updatedElapsedMs:0}};
 const g=E.fromSave(personal.exportSave(),officers,{isStaff:true,staffBase:base});g._cpuTurn=()=>[];
 assert.equal(g.castle('kyoto_gosho').durability.recoveryMode,'free');assert.equal(g.castle(home).durability.recoveryMode,'paid');
 assert(g.repairQuote().allocations.every(row=>row.id!=='kyoto_gosho'));
 g._advanceRealtime(60);assert.equal(g.state.repair.recovered.castles.kyoto_gosho,undefined);
 const hp=g.state.repair.recovered.castles[home];assert(hp>0);assert.equal(g.state.repair.spent.wood,Math.ceil(hp*.05));assert.equal(g.state.repair.spent.stone,Math.ceil(hp*.04));
 assert.equal(g.getStaffPersonalProgress().castle.durability.current,g.state.castles[home].durability.current);
 assert.deepEqual(load(g).state.repair,g.state.repair);
});

test('capacity increases preserve absolute damage and old-rate work without charging for newly built HP',()=>{
 const g=game(),id=g.state.home;g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};damage(g);g._advanceRealtime(30);
 g.state.castles[id].level=2;g._anchorCastleDurability(id);assert.equal(g.castle(id).durability.current,7000);assert.equal(g.castle(id).durability.repairPendingHP,500);
 g._advanceRealtime(30);assert.equal(g.castle(id).durability.current,8100);assert.equal(g.state.repair.recovered.castles[id],1100);
 assert.deepEqual(g.state.repair.spent,{wood:55,stone:44});
 const actual=game();actual.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};damage(actual);assert(actual.upgradeCastle(actual.state.home).ok);
 actual._advanceRealtime(60);assert.equal(actual.castle(actual.state.home).durability.current,8000);assert.deepEqual(actual.state.repair.spent,{wood:50,stone:40});
});

test('long clock catch-up equals fractional ticks with zero initial stock, repairs, construction and reloads',()=>{
 const initial=game();initial.state.resources={gold:0,rice:0,wood:0,stone:0};damage(initial);initial.state.castles.nijo.owner=initial.state.clan;damage(initial,'nijo',10000);
 initial.state.jobs=[{kind:'building',id:'wall',targetLevel:2,remaining:1,total:1,remainingSeconds:45,totalSeconds:60}];
 assert(initial.applyWorldClock(clock(0)).ok);const whole=load(initial);let pieces=load(initial);
 whole.applyWorldClock(clock(360250));
 for(let at=250;at<=360250;at+=250){pieces.applyWorldClock(clock(at));if(at%17250===0)pieces=load(pieces);}
 equalProgress(pieces,whole);assert(whole.state.repair.spent.wood>0);assert.equal(whole.state.repair.settledTurn,6);
 const before=copy(pieces.state);assert.equal(pieces.applyWorldClock(clock(360250)).changed,false);assert.deepEqual(pieces.state,before);
});

test('a resource-limited repair resumes only at later month boundaries and full restoration stops all charges',()=>{
 const g=game(),id=g.state.home;damage(g,id,9900);g._advanceRealtime(60);assert.equal(g.castle(id).durability.current,10000);
 assert.deepEqual(g.state.repair.spent,{wood:5,stone:4});const paid=copy(g.state.repair.spent);
 g._advanceRealtime(180);assert.deepEqual(g.state.repair.spent,paid);assert.equal(g.income().repair.repairedHP,0);assert.equal(g.income().repairUpkeep.wood,0);
});

test('old saves preserve their already-visible legacy HP without charging, then start paid repair prospectively',()=>{
 const g=game(),id=g.state.home;damage(g);g._advanceRealtime(30);const raw=JSON.parse(g.exportSave());delete raw.state.repair;
 const balances=copy(raw.state.resources),restored=E.fromSave(raw,officers);restored._cpuTurn=()=>[];
 assert.deepEqual(restored.state.resources,balances);assert.equal(restored.castle(id).durability.current,5500);
 assert.equal(restored.state.castles[id].durability.updatedElapsedMs,30000);assert.equal(restored.state.castles[id].durability.repairPendingHP,0);
 assert.deepEqual(restored.state.repair.spent,{wood:0,stone:0});assert.equal(load(restored).castle(id).durability.current,5500);
 restored._advanceRealtime(30);assert.equal(restored.castle(id).durability.current,6000);assert.deepEqual(restored.state.repair.spent,{wood:25,stone:20});
});

test('clock-origin changes do not turn their time offset into HP or charges and monthly receipts remain idempotent',()=>{
 const g=game(),id=g.state.home;damage(g);g._advanceRealtime(5);const balances=copy(g.state.resources);
 g.applyWorldClock({id:'different-repair-clock',elapsedMs:6000000,running:true,speed:1});assert.equal(g.castle(id).durability.current,5000);
 assert.deepEqual(g.state.resources,balances);assert.equal(g.state.repair.settledTurn,100);assert.deepEqual(g.state.repair.spent,{wood:0,stone:0});
 assert.equal(g.settleMonthlyRepairs().changed,false);g.applyWorldClock({id:'different-repair-clock',elapsedMs:6060000,running:true,speed:1});
 assert.equal(g.castle(id).durability.current,6000);assert.deepEqual(g.state.repair.spent,{wood:50,stone:40});
});

test('a partial-authority month can defer its repair decision until the complete state is available exactly once',()=>{
 const initial=game();damage(initial);initial.applyWorldClock(clock(0));const direct=load(initial),deferred=load(initial);
 direct.applyWorldClock(clock(60000));deferred.applyWorldClock(clock(60000),{settleRepairs:false});
 assert.equal(deferred.state.repair.settledTurn,0);assert.equal(deferred.castle(deferred.state.home).durability.current,5000);
 const result=deferred.settleMonthlyRepairs();assert.equal(result.repairedHP,1000);
 assert.deepEqual(deferred.state.resources,direct.state.resources);assert.deepEqual(deferred.state.repair,direct.state.repair);
 assert.deepEqual(deferred.state.castles[deferred.state.home].durability,direct.state.castles[direct.state.home].durability);
 const before=copy(deferred.state);assert.equal(deferred.settleMonthlyRepairs().changed,false);assert.deepEqual(deferred.state,before);
});

test('cumulative recovery receipts survive renewed damage and a branch being removed and rebuilt',()=>{
 const g=game();g.state.castles.nijo.owner=g.state.clan;
 const make=at=>({id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false,commanders:[],stationedTroops:0,durability:{version:1,current:2500,max:5000,updatedElapsedMs:at}});
 g.state.branches=[make(0)];g._advanceRealtime(60);assert.equal(g.state.repair.recovered.branches.nijo_north,500);
 const paid=copy(g.state.repair.spent);g.state.branches=[];assert.deepEqual(load(g).state.repair.spent,paid);
 g.state.branches=[make(60000)];g._advanceRealtime(60);assert.equal(g.state.repair.recovered.branches.nijo_north,1000);
 assert.deepEqual(g.state.repair.spent,{wood:50,stone:40});assert.deepEqual(load(g).state.repair,g.state.repair);
});

test('receipt and pending-work validation rejects future, malformed, unknown and economically inconsistent records',()=>{
 const g=game(),base=copy(g.state.repair),bad=[];
 const change=fn=>{const v=copy(base);fn(v);bad.push(v);};
 change(v=>v.settledTurn=1);change(v=>v.spent.wood=1);change(v=>v.credit.wood=100);change(v=>v.credit.stone=-1);
 change(v=>v.recovered.castles.unknown=1);change(v=>v.recovered.branches.unknown=1);change(v=>v.recovered.castles[g.state.home]=.5);
 change(v=>v.recovered.castles[g.state.home]=Number.MAX_SAFE_INTEGER+1);
 for(const value of bad)assert.throws(()=>E.normalizeRepairState(value,0));
 for(const property of [{repairPendingHP:-1},{repairPendingHP:1.5},{repairRemainder:600000},{repairRemainder:-1}])assert.throws(()=>E.normalizeDurability({version:1,current:5000,max:10000,updatedElapsedMs:0,...property}));
 const receipt={version:1,settledTurn:1,spent:{wood:1,stone:1},credit:{wood:95,stone:96},recovered:{castles:{[g.state.home]:1},branches:{}}};
 assert.deepEqual(E.normalizeRepairState(receipt,1),receipt);
 const raw=JSON.parse(g.exportSave());raw.state.repair=bad[1];assert.throws(()=>E.fromSave(raw,officers));
});

console.log(count+' paid durability repair groups passed.');
