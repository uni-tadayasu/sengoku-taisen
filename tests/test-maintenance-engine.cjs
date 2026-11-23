'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),copy=value=>JSON.parse(JSON.stringify(value));
const game=options=>{const g=new E({officers,seed:77,...options});g._cpuTurn=()=>[];return g;};
const rich=options=>{const g=game(options);g.state.resources={gold:10000000,rice:10000000,wood:10000000,stone:10000000};return g;};
const load=g=>{const restored=E.fromSave(g.exportSave(),officers,{isAdmin:g.isAdmin,isStaff:g.isStaff,staffBase:g.getStaffBase(),maintenanceAuthority:g.getMaintenanceAuthority()});restored._cpuTurn=()=>[];return restored;};
const own=(g,id)=>{g.state.castles[id].owner=g.state.clan;return g;};
const branch=(parent,direction,level,extra={})=>({id:parent+'_'+direction,parentCastleId:parent,direction,level,fallen:false,...extra});
const clock=elapsedMs=>({id:'maintenance-clock',elapsedMs,running:true,speed:1});
const snapshot=(elapsedMs,vacant=0,trade=0,alliance=0)=>({elapsedMs,vacant,trade,alliance});
const authority=(g,extra={})=>({version:1,campaignId:g.state.walking.campaignId,activatedElapsedMs:0,revision:1,asOfElapsedMs:60000,baseline:snapshot(0),changes:[],...extra});
const request=g=>({requestId:'maint-covert-'+g.state.covert.sequence,campaignId:g.state.walking.campaignId,sequence:g.state.covert.sequence});
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}
function equalProgress(a,b){
 const left=copy(a.state),right=copy(b.state);
 for(const key of D.resources){assert(Math.abs(left.realtime.incomeRemainders[key]-right.realtime.incomeRemainders[key])<1e-8,key+' fractional carry');left.realtime.incomeRemainders[key]=right.realtime.incomeRemainders[key];}
 assert.deepEqual(left,right);
}

test('initial four-resource income exposes actual gross, both expenses, net and nonoverlapping ownership breakdown',()=>{
 const g=game(),before=copy(g.state),m=g.maintenance(),income=g.income();
 assert.equal(m.totalTroops,4600);assert.deepEqual(m.troops,{field:3400,marching:0,castleGarrisons:1200,branchGarrisons:0,retreating:0,covert:0,external:0});
 assert.deepEqual(m.facilities,{townLevels:12,castleLevels:1,branchLevels:0,branchFacilityLevels:0,totalLevels:13});
 assert.deepEqual(m.troopUpkeep,{gold:184,rice:552,wood:0,stone:0});assert.deepEqual(m.facilityUpkeep,{gold:26,rice:73,wood:13,stone:13});
 assert.deepEqual(income.gross,{gold:850,rice:1070,wood:210,stone:160});assert.deepEqual(income.net,{gold:640,rice:445,wood:197,stone:147});
 for(const key of D.resources){assert.equal(income[key],income.net[key]);assert.equal(income[key],income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key]);}
 assert.equal(income.upkeep,m.totalUpkeep.rice);assert.equal(income.grossRice,income.gross.rice);assert.deepEqual(income.troopBreakdown,m.troops);assert.deepEqual(income.facilityLevels,m.facilities);assert.deepEqual(g.state,before);
 g._advanceRealtime(60);for(const key of D.resources)assert.equal(g.state.resources[key],before.resources[key]+income[key],key);assert.equal(g.state.magatama,before.magatama+D.gacha.monthlyReward);assert.equal(g.state.prestige,before.prestige);
});

test('upkeep rounds once after summing all real troops, supports zero and never caps aggregate ownership at one stock ceiling',()=>{
 const g=game();g.state.castles[g.state.home].troops=0;
 for(const [troops,gold,rice] of [[0,0,0],[1,1,1],[24,1,3],[25,1,3],[26,2,4],[100,4,12]]){g.state.troops=troops;assert.deepEqual(g.maintenance().troopUpkeep,{gold,rice,wood:0,stone:0});}
 g.state.troops=24;g.state.castles[g.state.home].troops=1;assert.deepEqual(g.maintenance().troopUpkeep,{gold:1,rice:3,wood:0,stone:0});
 own(g,'nijo');g.state.troops=E.ASSET_CAP;g.state.castles[g.state.home].troops=E.ASSET_CAP;g.state.castles.nijo.troops=E.ASSET_CAP;
 assert.equal(g.maintenance().totalTroops,3*E.ASSET_CAP);assert.equal(g.maintenance().troopUpkeep.gold,12000000);assert.equal(g.maintenance().troopUpkeep.rice,36000000);
 assert.equal(load(g).maintenance().totalTroops,3*E.ASSET_CAP);
});

test('branch reassignment and main-army marches preserve the fee basis while virtual parent support is not charged twice',()=>{
 const g=own(rich(),'nijo');g.state.branches=[branch('nijo','north',2,{stationedTroops:0})];const total=g.maintenance().totalTroops,cost=g.maintenance().troopUpkeep;
 assert(g.branchDefense('nijo_north').baselineTroops>0);assert(g.transferTroops('army','branch:nijo_north',100).ok);assert.equal(g.maintenance().totalTroops,total);assert.deepEqual(g.maintenance().troopUpkeep,cost);assert.equal(g.maintenance().troops.branchGarrisons,100);
 assert(g.transferTroops('branch:nijo_north','castle:'+g.state.home,1).ok);assert.equal(g.maintenance().totalTroops,total);assert.deepEqual(g.maintenance().troopUpkeep,cost);
 g.state.command=3;const target=g.adjacentTargets().find(c=>g.previewBattle(c.id,'balanced',1000).ok);assert(target);assert(g.departAttack(target.id,'balanced',1000).ok);assert.equal(g.maintenance().troops.marching,1000);assert.equal(g.maintenance().totalTroops,total);assert.deepEqual(g.maintenance().troopUpkeep,cost);
 const h=load(g);assert.equal(h.maintenance().totalTroops,total);h.state.march.kind='rally';assert.equal(h.maintenance().troops.marching,0);assert.equal(h.maintenance().totalTroops,total-1000);
 assert(h.setMaintenanceAuthority(authority(h,{baseline:snapshot(0,0,0,1000)})).ok);assert.equal(h.maintenance().totalTroops,total);assert.deepEqual(h.maintenance().troopUpkeep,cost);
});

test('fallen and retreating explicit soldiers remain chargeable while inactive structures incur no facility fee',()=>{
 const g=own(own(rich(),'nijo'),'osaka');g.state.branches=[branch('nijo','north',2,{stationedTroops:17,facilities:{farm:1}}),branch('nijo','east',3,{fallen:true,stationedTroops:19,facilities:{market:2}}),branch('osaka','north',4,{fallen:true,retreating:true,stationedTroops:23})];
 const m=g.maintenance();assert.equal(m.troops.branchGarrisons,36);assert.equal(m.troops.retreating,23);assert.equal(m.facilities.branchLevels,2);assert.equal(m.facilities.branchFacilityLevels,1);
 const before=m.totalTroops,castleTroops=g.state.castles.nijo.troops;g.state.castles.nijo.owner='在地衆';g._pruneBranches();const lost=g.maintenance();
 assert.equal(lost.totalTroops,before-castleTroops);assert.equal(lost.troops.branchGarrisons,0);assert.equal(lost.troops.retreating,59);assert.equal(lost.facilities.branchLevels,0);assert.equal(lost.facilities.branchFacilityLevels,0);assert.equal(load(g).maintenance().totalTroops,lost.totalTroops);
});

test('hired ninja and ashigaru are counted once through reserves, marching, stations, recall and historical reports',()=>{
 const g=own(rich({isAdmin:true}),'nijo'),initial=g.maintenance().totalTroops;
 assert(g.hireCovert('edo',80,request(g)).ok);assert(g.hireCovert('nijo',70,request(g)).ok);assert.equal(g.maintenance().totalTroops,initial+150);assert.equal(g.maintenance().troops.covert,150);
 const target={kind:'castle',castleId:'kagoshima'};const sent=g.departCovertDispatch('edo',target,30,'station',request(g));assert(sent.ok,sent.message);assert.equal(g.state.covert.reserves.edo,50);assert.equal(g.state.covert.dispatches[0].count,30);assert.equal(g.maintenance().troops.covert,150);
 g.state.command=3;const direct=g.dispatchCovert('nijo',target,20,'station',request(g));assert(direct.ok);assert.equal(g.maintenance().troops.covert,150);assert(g.state.covert.reports.length>0);assert(g.state.covert.history.length>0);
 let restored=load(g);assert.equal(restored.maintenance().troops.covert,150);const duration=(restored.state.covert.dispatches[0].arrivesElapsedMs-restored._covertElapsed())/1000;restored._advanceRealtime(duration);assert.equal(restored.state.covert.dispatches.length,0);assert.equal(restored.maintenance().troops.covert,150);
 for(const station of [...restored.state.covert.stations])assert(restored.recallCovert(station.id,request(restored)).ok);assert.equal(restored.state.covert.stations.length,0);assert.equal(restored.maintenance().troops.covert,150);assert.equal(load(restored).maintenance().troops.covert,150);
});

test('shared Kyoto troops and staff personal backups are not duplicate personal soldiers or castle levels',()=>{
 const g=rich({clan:'豊臣家'}),home=g.state.home,personalTroops=g.state.castles[home].troops;assert(g.setRoleAccess({isAdmin:false,isStaff:true}).ok);const buildings=copy(g.state.buildings);
 assert(g.applyStaffBase({id:'kyoto_gosho',revision:1,castleLevel:10,initial:{castleLevel:10,buildings},buildings,jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0}).ok);
 g.state.castles.kyoto_gosho.troops=9000000;const m=g.maintenance();assert.equal(m.troops.castleGarrisons,personalTroops);assert.equal(m.totalTroops,g.state.troops+personalTroops);assert.equal(m.facilities.castleLevels,g.state.castles[home].level);
 assert.equal(m.facilityUpkeep.rice,m.facilities.totalLevels+g.ownedCastles().length*60);assert.deepEqual(g.castleUpkeep('kyoto_gosho'),{gold:0,rice:60,wood:0,stone:0});assert.equal(load(g).maintenance().totalTroops,m.totalTroops);
});

test('per-facility quotes are bounded, read-only monthly costs and queued town/castle work charges only after completion',()=>{
 let g=rich(),before=copy(g.state);assert.deepEqual(g.facilityUpkeep('farm'),{gold:4,rice:2,wood:2,stone:2});assert.deepEqual(g.facilityUpkeep('farm',3),{gold:6,rice:3,wood:3,stone:3});assert.deepEqual(g.facilityUpkeep('farm',0),{gold:0,rice:0,wood:0,stone:0});assert.deepEqual(g.castleUpkeep(g.state.home),{gold:2,rice:61,wood:1,stone:1});assert.deepEqual(g.branchUpkeep('nijo_north',2),{gold:4,rice:2,wood:2,stone:2});
 for(const level of [-1,.5,NaN,Infinity,'1',33])assert.equal(g.facilityUpkeep('farm',level),null);assert.equal(g.facilityUpkeep('missing',1),null);assert.equal(g.branchUpkeep('edo_north',9),null);assert.equal(g.branchUpkeep('nijo_north',25),null);assert.equal(g.branchUpkeep('missing',1),null);assert.equal(g.castleUpkeep(g.state.home,0),null);assert.equal(g.castleUpkeep('__proto__',1),null);assert.deepEqual(g.state,before);
 const facilities=g.maintenance().facilities.totalLevels,fees=g.maintenance().facilityUpkeep;assert(g.upgrade('farm').ok);assert(g.upgrade('farm').ok);assert(g.upgradeCastle(g.state.home).ok);assert.equal(g.maintenance().facilities.totalLevels,facilities);assert.deepEqual(g.maintenance().facilityUpkeep,fees);
 g._advanceRealtime(59.75);assert.equal(g.maintenance().facilities.totalLevels,facilities);g=load(g);assert.deepEqual(g.maintenance().facilityUpkeep,fees);g._advanceRealtime(.25);assert.equal(g.maintenance().facilities.totalLevels,facilities+2);assert.equal(g.state.jobs.length,1);g._advanceRealtime(60);assert.equal(g.maintenance().facilities.totalLevels,facilities+3);
});

test('server-recorded branch facility completion times split both production and fees at their exact boundaries',()=>{
 const g=own(rich(),'nijo');g.state.branches=[branch('nijo','north',3,{facilities:{market:3},facilityCompletedAt:{market:[0,15000,45000]}})];
 const before=copy(g.state.resources),rate1=g.income();assert.equal(g.maintenance().facilities.branchFacilityLevels,1);g._advanceRealtime(15);const rate2=g.income();assert.equal(g.maintenance().facilities.branchFacilityLevels,2);assert.equal(rate2.gold-rate1.gold,43);assert.equal(rate2.wood-rate1.wood,-1);
 const restored=load(g);restored._advanceRealtime(30);const rate3=restored.income();assert.equal(restored.maintenance().facilities.branchFacilityLevels,3);assert.equal(rate3.gold-rate2.gold,43);restored._advanceRealtime(15);
 for(const key of D.resources){const expected=(rate1[key]*15+rate2[key]*30+rate3[key]*15)/60;assert.equal(restored.state.resources[key],before[key]+Math.trunc(expected),key);assert(Math.abs(restored.state.realtime.incomeRemainders[key]-(expected-Math.trunc(expected)))<1e-8,key+' carry');}
});

test('all four expenses can make net negative, stop at zero without phantom debt, and leave special assets unchanged',()=>{
 const g=game();for(const b of D.buildings)if(['military','defense','research','diplomacy'].includes(b.category))g.state.buildings[b.id]=32;g.state.troops=E.ASSET_CAP;g.state.resources={gold:1,rice:1,wood:1,stone:1};
 const special={magatama:g.state.magatama,prestige:g.state.prestige};for(const key of D.resources)assert(g.income()[key]<0,key+' deficit');g._advanceRealtime(5);
 assert.deepEqual(g.state.resources,{gold:0,rice:0,wood:0,stone:0});assert.deepEqual(g.state.realtime.incomeRemainders,{gold:0,rice:0,wood:0,stone:0});g._advanceRealtime(5);assert.equal(g.state.magatama,special.magatama);assert.equal(g.state.prestige,special.prestige);
 g.state.buildings=copy(game().state.buildings);g.state.troops=0;g.state.castles[g.state.home].troops=0;const income=g.income();g._advanceRealtime(5);for(const key of D.resources)assert.equal(g.state.resources[key],Math.trunc(income[key]/12),key+' no carried debt');assert.equal(load(g).state.resources.gold,g.state.resources.gold);
});

test('trusted external timelines begin at activation and integrate historical changes instead of applying the latest total retroactively',()=>{
 const g=rich();g.state.troops=17;g.state.castles[g.state.home].troops=8;g.applyWorldClock(clock(0));const noExternal=load(g),dto=authority(g,{activatedElapsedMs:15000,baseline:snapshot(15000,100),changes:[snapshot(30000,0,200),snapshot(45000,0,0,300)]});
 assert(g.setMaintenanceAuthority(dto).ok);assert.equal(g.maintenance().troops.external,0);assert.equal(g.applyWorldClock(clock(60000)).pending,false);noExternal.applyWorldClock(clock(60000));
 assert.equal(g.state.resources.gold,noExternal.state.resources.gold-6);assert.equal(g.state.resources.rice,noExternal.state.resources.rice-18);assert.equal(g.state.resources.wood,noExternal.state.resources.wood);assert.equal(g.maintenance().troops.external,300);assert.equal(load(g).maintenance().troops.external,300);
});

test('confirmed authority caps engine advancement without a pending busy-loop and a same-boundary update resumes exactly once',()=>{
 const g=rich();g.applyWorldClock(clock(0));const dto=authority(g,{asOfElapsedMs:10000,baseline:snapshot(0,100)});assert(g.setMaintenanceAuthority(dto).ok);
 const first=g.applyWorldClock(clock(20000));assert.equal(first.maintenancePending,true);assert.equal(first.pending,false);assert.equal(g.state.worldClock.elapsedMs,10000);const before=copy(g.state);
 const again=g.applyWorldClock(clock(20000));assert.equal(again.changed,false);assert.equal(again.pending,false);assert.deepEqual(g.state,before);assert.equal(g._advanceRealtime(20).changed,false);assert.deepEqual(g.state,before);
 const next={...dto,revision:2,asOfElapsedMs:20000,changes:[snapshot(10000,0,200)]};assert(g.setMaintenanceAuthority(next).ok);assert.equal(g.maintenance().troops.external,200);assert(g.applyWorldClock(clock(20000)).changed);assert.equal(g.state.worldClock.elapsedMs,20000);assert.equal(g.applyWorldClock(clock(20000)).changed,false);
 const retro={...next,revision:3,asOfElapsedMs:30000,changes:[snapshot(9999,300),snapshot(10000,0,200)]};assert.equal(g.setMaintenanceAuthority(retro).code,'MAINTENANCE_AUTHORITY_REWRITE');assert.deepEqual(g.getMaintenanceAuthority(),next);
 const local=rich();assert(local.setMaintenanceAuthority(authority(local,{asOfElapsedMs:1500})).ok);assert(local.tick(5).maintenancePending);assert.equal(local.state.realtime.elapsed,1.5);assert.equal(local.tick(5).changed,false);
});

test('authority stays outside saves, validates scope and monotonicity, returns defensive copies, and clears on account invalidation',()=>{
 const g=game(),dto=authority(g,{baseline:snapshot(0,7,11,13),hasMore:true});assert(g.setMaintenanceAuthority(dto).ok);dto.baseline.vacant=999;assert.equal(g.maintenance().troops.external,31);
 const returned=g.getMaintenanceAuthority();returned.baseline.trade=999;assert.equal(g.maintenance().troops.external,31);assert.deepEqual(g.getMaintenanceStatus(),{campaignId:g.state.walking.campaignId,revision:1,asOfElapsedMs:60000,hasMore:true});
 const status=g.getMaintenanceStatus();status.revision=999;assert.equal(g.getMaintenanceStatus().revision,1);const canonical=g.getMaintenanceAuthority(),before=copy(g.state);
 for(const change of [v=>v.campaignId='different',v=>v.version=2,v=>v.revision=-1,v=>v.asOfElapsedMs=1.5,v=>v.baseline.vacant=-1,v=>v.baseline.trade=NaN,v=>v.baseline.alliance=1000000000001,v=>v.changes=[snapshot(0,1)],v=>v.changes=[snapshot(2,1),snapshot(1,2)],v=>v.changes=[snapshot(60001,1)],v=>v.hasMore='yes']){const bad=copy(canonical);change(bad);assert.equal(g.setMaintenanceAuthority(bad).ok,false);assert.deepEqual(g.getMaintenanceAuthority(),canonical);assert.deepEqual(g.state,before);}
 assert.equal(g.setMaintenanceAuthority({...canonical,revision:0}).code,'MAINTENANCE_AUTHORITY_STALE');assert.equal(g.setMaintenanceAuthority({...canonical,asOfElapsedMs:59999}).code,'MAINTENANCE_AUTHORITY_STALE');
 const raw=JSON.parse(g.exportSave());assert(!('maintenanceAuthority'in raw));assert(!('maintenanceAuthority'in raw.state));assert.equal(E.fromSave(raw,officers).getMaintenanceAuthority(),null);
 raw.maintenanceAuthority=copy(canonical);raw.state.maintenanceAuthority=copy(canonical);raw.state.externalTroops=9000000;const untrusted=E.fromSave(raw,officers);assert.equal(untrusted.getMaintenanceAuthority(),null);assert.equal(untrusted.maintenance().troops.external,0);
 assert.deepEqual(load(g).getMaintenanceAuthority(),canonical);assert(g.setMaintenanceAuthority(null).ok);assert.equal(g.getMaintenanceStatus(),null);assert.equal(g.maintenance().troops.external,0);assert.equal(g.setMaintenanceAuthority(null).changed,false);
 assert(g.setMaintenanceAuthority(canonical).ok);g.state.walking.campaignId='another-campaign';assert.equal(g.getMaintenanceAuthority(),null);assert.equal(g.getMaintenanceStatus(),null);
});

test('millisecond seals and completion boundaries do not reject valid authority through floating-point conversion noise',()=>{
 for(const elapsedMs of [2007,2011,4015,60000+2007]){
  const g=own(rich(),'nijo');g.applyWorldClock(clock(elapsedMs));const dto=authority(g,{asOfElapsedMs:elapsedMs,baseline:snapshot(0,5),changes:[snapshot(elapsedMs,50)]});assert(g.setMaintenanceAuthority(dto).ok,elapsedMs+' current seal');
  g.state.branches=[branch('nijo','north',1,{facilities:{market:1},facilityCompletedAt:{market:[elapsedMs]}})];assert.equal(g.maintenance().troops.external,50);assert.equal(g.maintenance().facilities.branchFacilityLevels,1);assert.equal(g.branchFacilityBonuses().income.gold,45);
  const before=copy(g.state);assert.equal(g._advanceRealtime(5).changed,false);assert.deepEqual(g.state,before);assert.equal(load(g).getMaintenanceStatus().asOfElapsedMs,elapsedMs);
 }
});

test('long catch-up, fractional ticks and reloads converge across construction and many external rate boundaries',()=>{
 const base=rich();assert(base.upgrade('farm').ok);assert(base.upgrade('market').ok);base.applyWorldClock(clock(0));
 const changes=Array.from({length:120},(_,i)=>snapshot((i+1)*14573,(i*37)%301,(i*17)%107,(i*61)%499));assert(base.setMaintenanceAuthority(authority(base,{asOfElapsedMs:1800000,baseline:snapshot(0,3,5,7),changes})).ok);
 const fast=load(base);let stepped=load(base);fast.applyWorldClock(clock(1800000));
 for(let at=1237;at<1800000;at+=1237){stepped.applyWorldClock(clock(at));if(at%3711===0)stepped=load(stepped);}stepped.applyWorldClock(clock(1800000));equalProgress(fast,stepped);assert.equal(fast.state.jobs.length,0);assert.equal(fast.state.worldClock.elapsedMs,1800000);
 const balances=copy(fast.state.resources);assert.equal(fast.applyWorldClock(clock(1800000)).changed,false);assert.deepEqual(fast.state.resources,balances);
});

console.log(`Maintenance engine: ${count} groups passed.`);
