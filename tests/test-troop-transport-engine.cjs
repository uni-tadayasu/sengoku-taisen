'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E}=require('../engine.js'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const clone=value=>JSON.parse(JSON.stringify(value));
const game=()=>{const g=new E({officers,seed:1});g.state.resources={gold:E.ASSET_CAP,rice:E.ASSET_CAP,wood:E.ASSET_CAP,stone:E.ASSET_CAP};return g;};
const load=g=>E.fromSave(g.exportSave(),officers,{isStaff:g.isStaff,isAdmin:g.isAdmin});
function depart(g){const target=g.adjacentTargets().find(c=>g.previewBattle(c.id,'balanced',1000).ok);assert(target);g.state.castles[target.id].troops=100;g.state.castles[target.id].wall=1;const result=g.departAttack(target.id,'balanced',1000);assert(result.ok,result.message);return result.march;}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('transport stock above building capacity survives ordinary export and reload through the ownership ceiling',()=>{
 const g=game(),normal=g.troopCapacity();assert(normal<2500000);
 for(const troops of [2500000,E.ASSET_CAP]){
  g.state.troops=troops;const before=clone(g.state);assert.equal(g.troopTransportCapacity(),E.ASSET_CAP);assert.deepEqual(g.state,before);
  const restored=load(g);assert.equal(restored.state.troops,troops);assert.equal(restored.troopCapacity(),normal);assert.equal(restored.troopTransportCapacity(),E.ASSET_CAP);
  assert.deepEqual(Object.keys(restored.state),Object.keys(before));
 }
});

test('transport allowance does not expand recruitment or branch-to-army capacity',()=>{
 const g=game(),normal=g.troopCapacity();g.state.troops=normal-100;assert(g.recruitTroops(100).ok);assert.equal(g.state.troops,normal);
 let before=clone(g.state);assert.equal(g.recruitTroops(100).ok,false);assert.deepEqual(g.state,before);
 assert.equal(g.troopTransferStatus().endpoints.find(e=>e.id==='army').capacity,normal);
 const quote=g.troopTransferQuote('castle:'+g.state.home,'army',1);assert.equal(quote.ok,false);assert.equal(quote.code,'TROOP_CAPACITY');assert.equal(quote.maxTroops,0);
 g.state.troops=2500000;before=clone(g.state);assert.equal(g.recruitTroops(100).ok,false);assert.deepEqual(g.state,before);assert.equal(g.troopTransportCapacity(),E.ASSET_CAP);
});

test('local and server main-army marches reserve transport room while externally pooled rallies do not',()=>{
 const g=game();depart(g);assert.equal(g.troopTransportCapacity(),E.ASSET_CAP-1000);assert.equal(load(g).troopTransportCapacity(),E.ASSET_CAP-1000);
 for(const kind of ['castle','branch','roaming','field','rally']){
  const raw=JSON.parse(g.exportSave());raw.state.march.authority='server';raw.state.march.kind=kind;
  delete raw.state.march.profile;delete raw.state.march.seed;delete raw.state.march.commandBefore;
  const restored=E.fromSave(raw,officers),before=clone(restored.state);assert.equal(restored.troopTransportCapacity(),E.ASSET_CAP-(kind==='rally'?0:1000));assert.deepEqual(restored.state,before);
 }
});

test('a cancelled march returns every soldier after transport fills all unreserved room and replays without a second refund',()=>{
 const g=game(),march=depart(g);g.state.troops=g.troopTransportCapacity();const restored=load(g);
 restored.state.castles[march.sourceCastleId].owner='在地衆';const result=restored.resolveDueMarches();assert.equal(result.length,1);assert.equal(result[0].status,'cancelled');assert.equal(restored.state.troops,E.ASSET_CAP);assert.equal(restored.state.march,null);
 const after=clone(restored.state);assert.deepEqual(restored.resolveDueMarches(),[]);assert.deepEqual(restored.state,after);assert.equal(load(restored).state.troops,E.ASSET_CAP);
});

test('combat returns survivors above recruitment capacity without clipping anything beyond actual battle losses and occupation',()=>{
 const g=game(),march=depart(g);g.state.troops=g.troopTransportCapacity();const restored=load(g),receipts=[];
 for(let remaining=march.travel.durationMs/1000;remaining>0;){const seconds=Math.min(5,remaining);receipts.push(...restored.tick(seconds).marchResults);remaining-=seconds;}
 assert.equal(receipts.length,1);assert.equal(receipts[0].status,'resolved');const battle=receipts[0].battle;
 assert.equal(restored.state.troops,E.ASSET_CAP-battle.ourLost-battle.garrison);assert(restored.state.troops>restored.troopCapacity());assert.equal(load(restored).state.troops,restored.state.troops);
});

test('cycle cancellation and staff role changes retain transported field stock',()=>{
 const g=game();depart(g);g.state.troops=g.troopTransportCapacity();g._settleCycle(1);assert.equal(g.state.troops,E.ASSET_CAP);assert.equal(g.state.march,null);assert.equal(g.state.marchHistory[0].status,'cancelled');assert.equal(load(g).state.troops,E.ASSET_CAP);
 const personal=game();personal.state.troops=2500000;assert(personal.setRoleAccess({isAdmin:false,isStaff:true}).ok);
 const buildings=clone(personal.state.buildings);assert(personal.applyStaffBase({id:'kyoto_gosho',revision:1,castleLevel:1,initial:{castleLevel:1,buildings},buildings,jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0}).ok);
 assert.equal(personal.state.troops,2500000);assert.equal(load(personal).state.troops,2500000);personal._settleCycle(1);assert.equal(personal.state.troops,2500000);assert(personal.setRoleAccess({isAdmin:false,isStaff:false}).ok);assert.equal(load(personal).state.troops,2500000);
});

assert.equal(fs.readFileSync(require.resolve('../engine.js'),'utf8'),fs.readFileSync(require.resolve('../server/game-engine.js'),'utf8'));
console.log(`Troop transport engine: ${count} groups passed; browser and Worker engines match.`);
