'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};
vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),clone=value=>JSON.parse(JSON.stringify(value)),tests=[];
const test=(name,run)=>tests.push([name,run]);
const record=(parent,direction='north',extra={})=>({id:parent+'_'+direction,parentCastleId:parent,direction,level:2,fallen:false,...extra});
function fixture(options={}){const g=new E({officers,seed:77,...options});g.state.resources={gold:900000,rice:900000,wood:900000,stone:900000};for(const id of ['nijo','osaka'])g.state.castles[id].owner=g.state.clan;g.state.branches=[record('nijo'),record('osaka')];return g;}
const total=g=>g.state.troops+g.ownedCastles().reduce((sum,c)=>sum+c.troops,0)+g.state.branches.reduce((sum,b)=>sum+(b.stationedTroops||0),0)+(g.state.march?.troops||0);
function move(g,from,to,troops){g.state.command=3;const before=total(g),resources=clone(g.state.resources),sequence=g.state.troopTransferSequence,result=g.transferTroops(from,to,troops);assert(result.ok,result.message);assert.equal(total(g),before);assert.deepEqual(g.state.resources,resources);assert.equal(g.state.command,2);assert.equal(g.state.troopTransferSequence,sequence+1);assert.equal(result.sourceBefore-result.sourceAfter,troops);assert.equal(result.destinationAfter-result.destinationBefore,troops);return result;}
function rejected(g,action,code){const before=clone(g.state),result=action();assert.equal(result.ok,false);if(code)assert.equal(result.code,code);assert.deepEqual(g.state,before);return result;}

test('all endpoint pair types debit exact finite troops; branch baseline is never withdrawable',()=>{
 const g=fixture(),baseline=g.branchDefense('nijo_north');assert.equal(g.troopTransferStatus().endpoints.find(e=>e.id==='branch:nijo_north').troops,0);
 rejected(g,()=>g.transferTroops('branch:nijo_north','army',1),'INSUFFICIENT_TROOPS');
 for(const [from,to,n] of [['army','castle:nijo',400],['castle:nijo','castle:osaka',200],['castle:osaka','branch:nijo_north',300],['branch:nijo_north','branch:osaka_north',120],['branch:osaka_north','castle:nijo',80],['branch:nijo_north','army',100],['castle:nijo','army',100]])move(g,from,to,n);
 assert.equal(g.branch('nijo_north').stationedTroops,80);assert.equal(g.branch('osaka_north').stationedTroops,40);
 const current=g.branchDefense('nijo_north');assert.equal(current.force,current.baselineTroops+80);assert.equal(current.stationedTroops,80);assert(current.power>baseline.power);
 const loaded=E.fromSave(g.exportSave(),officers);assert.equal(total(loaded),total(g));assert.equal(loaded.state.troopTransferSequence,7);assert.deepEqual(loaded.state.branches,g.state.branches);
});

test('quotes are read-only and reject malformed, foreign, identical, empty, unbuilt and over-capacity routes',()=>{
 const g=fixture(),before=clone(g.state),q=g.troopTransferQuote('army','castle:nijo',25);assert(q.ok);assert.equal(q.maxTroops,g.state.troops);assert.deepEqual(g.state,before);
 for(const amount of [0,-1,1.5,'1',NaN,Infinity,Number.MAX_SAFE_INTEGER])rejected(g,()=>g.transferTroops('army','castle:nijo',amount),'INVALID_TROOP_AMOUNT');
 rejected(g,()=>g.transferTroops('army','army',1),'SAME_TROOP_ENDPOINT');rejected(g,()=>g.transferTroops('castle:edo','army',1),'INVALID_TROOP_ENDPOINT');
 rejected(g,()=>g.transferTroops('branch:missing','army',1),'INVALID_TROOP_ENDPOINT');rejected(g,()=>g.transferTroops('army','castle:nijo',g.state.troops+1),'INSUFFICIENT_TROOPS');
 g.state.branches.push(record('nijo','east',{level:0}));rejected(g,()=>g.transferTroops('army','branch:nijo_east',1),'TROOP_ENDPOINT_UNAVAILABLE');
 g.state.castles.nijo.troops=E.ASSET_CAP;rejected(g,()=>g.transferTroops('army','castle:nijo',1),'TROOP_CAPACITY');
 g.state.castles.nijo.troops=0;g.state.command=0;rejected(g,()=>g.transferTroops('army','castle:nijo',1),'TROOP_TRANSFER_UNAVAILABLE');
});

test('returning army capacity reserves actual soldiers already on a march and never clips overflow',()=>{
 const g=fixture(),target=g.adjacentTargets()[0];g.state.troops=g.troopCapacity();assert(g.departAttack(target.id,'balanced',1000).ok);g.state.command=3;
 assert.equal(g.troopTransferQuote('castle:nijo','army',1).maxTroops,0);rejected(g,()=>g.transferTroops('castle:nijo','army',1),'TROOP_CAPACITY');
 move(g,'army','castle:nijo',100);assert.equal(g.troopTransferQuote('castle:nijo','army',100).maxTroops,100);move(g,'castle:nijo','army',100);
 assert.equal(g.state.troops+g.state.march.troops,g.troopCapacity());
});

test('shared Kyoto is visibly unavailable as personal troop stock while staff can move their own army and castles',()=>{
 const g=fixture({isStaff:true}),buildings=clone(g.state.buildings);assert(g.applyStaffBase({id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings},buildings,jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0}).ok);
 const endpoint=g.troopTransferStatus().endpoints.find(e=>e.id==='castle:kyoto_gosho');assert(endpoint);assert(!endpoint.available&&!endpoint.canSource&&!endpoint.canDestination);assert.equal(endpoint.reason,'共同拠点の兵は個人の駐留兵として移動できません。');
 rejected(g,()=>g.transferTroops('castle:nijo','castle:kyoto_gosho',1),'TROOP_ENDPOINT_UNAVAILABLE');rejected(g,()=>g.transferTroops('castle:kyoto_gosho','army',1),'TROOP_ENDPOINT_UNAVAILABLE');move(g,'army','castle:nijo',100);move(g,'castle:nijo','army',100);
});

test('fallen branch soldiers remain exact stock, can withdraw, and cannot receive until repair',()=>{
 const g=fixture();move(g,'army','branch:nijo_north',300);const owned=g.state.castles.nijo.troops;assert(g._fallBranch('nijo_north'));
 assert.equal(g.branch('nijo_north').stationedTroops,300);assert.equal(g.state.castles.nijo.troops,owned);
 const endpoint=g.troopTransferStatus().endpoints.find(e=>e.id==='branch:nijo_north');assert(endpoint.canSource&&!endpoint.canDestination);
 rejected(g,()=>g.transferTroops('army','branch:nijo_north',1),'TROOP_ENDPOINT_UNAVAILABLE');move(g,'branch:nijo_north','army',300);
 assert(g.branch('nijo_north').fallen);assert.equal(g.branch('nijo_north').stationedTroops,0);
});

test('parent loss, new cycles and administrator revocation retain bounded withdrawal-only escrow without crediting any army',()=>{
 const g=fixture();move(g,'army','branch:nijo_north',300);const field=g.state.troops;g.state.branches[0].facilities={farm:1};g.state.castles.nijo.owner='在地衆';g._pruneBranches();
 let branch=g.branch('nijo_north');assert(branch.retreating&&branch.fallen);assert.equal(branch.stationedTroops,300);assert.equal(g.state.troops,field);assert.equal(g.branchDefense(branch.id),null);assert.equal(g.activeBranches('nijo').length,0);assert.deepEqual(branch.facilities,{});
 const restored=E.fromSave(g.exportSave(),officers);assert(restored.branch(branch.id).retreating);restored.state.castles.nijo.owner=restored.state.clan;rejected(restored,()=>restored.repairBranch(branch.id));move(restored,'branch:nijo_north','castle:osaka',300);assert.equal(restored.branch(branch.id),null);
 const cycle=fixture();move(cycle,'army','branch:nijo_north',250);const army=cycle.state.troops;cycle._settleCycle(1);assert.equal(cycle.branch('nijo_north').stationedTroops,250);assert(cycle.branch('nijo_north').retreating);assert.equal(cycle.state.troops,army);
 const admin=fixture({isAdmin:true});admin.state.branches.push(record('edo'));move(admin,'army','branch:edo_north',200);const after=admin.state.troops;admin.setRoleAccess({isAdmin:false});assert(admin.branch('edo_north').retreating);assert.equal(admin.state.troops,after);move(admin,'branch:edo_north','castle:nijo',200);assert.equal(admin.branch('edo_north'),null);
});

test('legacy imports default marker and stock to zero; malformed stock, escrow and marker cannot enter saves',()=>{
 const g=fixture(),raw=JSON.parse(g.exportSave());delete raw.state.troopTransferSequence;const loaded=E.fromSave(raw,officers);assert.equal(loaded.state.troopTransferSequence,0);assert.equal(loaded.branch('nijo_north').stationedTroops,undefined);
 for(const value of [-1,1.5,'1',null,1000000001]){const bad=clone(raw);bad.state.troopTransferSequence=value;assert.throws(()=>E.fromSave(bad,officers));}
 for(const value of [-1,1.5,'1',null,E.ASSET_CAP+1]){const bad=clone(raw);bad.state.branches[0].stationedTroops=value;assert.throws(()=>E.fromSave(bad,officers));}
 for(const extra of [{retreating:true},{retreating:true,stationedTroops:1},{retreating:true,stationedTroops:1,fallen:true,facilities:{farm:1}},{retreating:'yes'}]){const bad=clone(raw);Object.assign(bad.state.branches[0],extra);assert.throws(()=>E.fromSave(bad,officers));}
});

test('Edo holds one commander and other major branches two, with durable owned IDs and no hidden combat bonus',()=>{
 const g=fixture({isAdmin:true});g.state.branches.push(record('edo'));g.state.army=[];const ids=g.state.officers.slice(0,3),resources=clone(g.state.resources),command=g.state.command,power=g.branchDefense('nijo_north').power;
 assert(g.assignBranchCommander('nijo_north',ids[0]).ok);assert(g.assignBranchCommander('nijo_north',ids[1]).ok);rejected(g,()=>g.assignBranchCommander('nijo_north',ids[2]));assert(g.assignBranchCommander('edo_north',ids[2]).ok);
 assert.equal(g.branchCommanderStatus('edo_north').limit,1);assert.equal(g.branchCommanderStatus('nijo_north').limit,2);assert.equal(g.branchDefense('nijo_north').power,power);assert.deepEqual(g.state.resources,resources);assert.equal(g.state.command,command);
 const loaded=E.fromSave(g.exportSave(),officers,{isAdmin:true});assert.deepEqual(loaded.branch('nijo_north').commanders,ids.slice(0,2));assert(loaded.removeBranchCommander('nijo_north',ids[0]).ok);assert(loaded.assignBranchCommander('osaka_north',ids[0]).ok);
 loaded._fallBranch('nijo_north');rejected(loaded,()=>loaded.assignBranchCommander('nijo_north',ids[0]));assert(loaded.removeBranchCommander('nijo_north',ids[1]).ok);
});

test('commander conflicts are explicit across branches, army, governors, auto assignment and malformed imports',()=>{
 const g=fixture(),ids=g.state.officers.slice(0,3);rejected(g,()=>g.assignBranchCommander('nijo_north',ids[0]));g.assignArmy([]);g.assignGovernor('farm',ids[0]);rejected(g,()=>g.assignBranchCommander('nijo_north',ids[0]));assert(g.assignBranchCommander('nijo_north',ids[1]).ok);
 rejected(g,()=>g.assignBranchCommander('osaka_north',ids[1]));rejected(g,()=>g.assignArmy([ids[1]]));rejected(g,()=>g.assignGovernor('farm',ids[1]));g.autoAssignGovernors();assert(!Object.values(g.state.governors).includes(ids[1]));
 const raw=JSON.parse(g.exportSave());for(const change of [s=>s.branches[0].commanders=['foreign'],s=>s.branches[0].commanders=[ids[1],ids[1]],s=>s.branches[1].commanders=[ids[1]],s=>s.army=[ids[1]],s=>s.governors.farm=ids[1],s=>s.branches[0].commanders=[...ids]]){const bad=clone(raw);change(bad.state);assert.throws(()=>E.fromSave(bad,officers));}
 g.state.castles.nijo.owner='在地衆';g._pruneBranches();assert.equal(g.branch('nijo_north'),null);assert(g.assignArmy([ids[1]]).ok);
});

for(const [name,run]of tests){run();console.log('PASS '+name);}
assert.equal(fs.readFileSync(path.join(__dirname,'../engine.js'),'utf8'),fs.readFileSync(path.join(__dirname,'../server/game-engine.js'),'utf8'));
console.log(`${tests.length} finite troop and branch commander groups passed; browser/Worker engines match.`);
