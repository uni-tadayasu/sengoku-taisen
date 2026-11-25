'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS)),fresh=()=>new E({officers:roster,seed:4918}),clone=structuredClone;
const branch=(parent='nijo',extra={})=>({id:parent+'_north',parentCastleId:parent,direction:'north',level:2,fallen:false,...extra});
const quiet=g=>{g._cpuTurn=()=>[];return g;};let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
function damage(g,id,fraction=.5){const view=g.castle(id).durability;g.state.castles[id].durability={version:1,current:Math.round(view.max*fraction),max:view.max,updatedElapsedMs:g.state.turn*60000+Math.round(g.state.realtime.elapsed*1000)};return g.castle(id).durability;}
function prepare(g){g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};g.state.command=3;return g;}
test('every ordinary/major/protected castle starts full and reads are pure',()=>{
 const g=fresh(),before=clone(g.state);
 for(const c of D.castles){const view=g.castle(c.id).durability;assert(view.max>0);assert.equal(view.current,view.max);assert.equal(view.ratio,1);assert.equal(view.fortificationFactor,1);}
 assert.equal(E.durabilityMax({castleId:'kiyosu'}),10000);assert.equal(E.durabilityMax({castleId:'nijo'}),20000);assert.equal(E.durabilityMax({castleId:'edo'}),30000);assert.equal(E.durabilityMax({castleId:'kyoto_gosho'}),40000);assert.deepEqual(g.state,before);
});
test('legacy import initializes views at full and explicit damage survives save and reload',()=>{
 const g=fresh(),old=JSON.parse(g.exportSave());for(const row of Object.values(old.state.castles))delete row.durability;
 const a=E.fromSave(old,roster);assert.equal(a.castle(a.state.home).durability.ratio,1);damage(a,a.state.home,.3);
 const b=E.fromSave(a.exportSave(),roster);assert.deepEqual(b.castle(b.state.home).durability,a.castle(a.state.home).durability);assert.deepEqual(b.state.castles[b.state.home].durability,a.state.castles[a.state.home].durability);
});
test('paid repair settles ten percent at the monthly boundary and pure views cannot double heal or charge',()=>{
 const g=quiet(fresh()),id=g.state.home,initial=damage(g,id,.2),anchor=clone(g.state.castles[id].durability);
 for(let i=0;i<12;i++)g.tick(5);assert.equal(g.castle(id).durability.current,initial.current+initial.max/10);
 const settled=clone(g.state);for(let i=0;i<15;i++){g.castle(id);g.income();g.repairQuote();}assert.deepEqual(g.state,settled);
 assert.deepEqual(g.state.repair.spent,{wood:50,stone:40});
 const b=E.fromSave(g.exportSave(),roster);assert.equal(b.castle(id).durability.current,g.castle(id).durability.current);
 const a=E.durabilityView(anchor,{castleId:id,elapsedMs:600000,recoveryMode:'free'});assert.equal(a.current,a.max);
 assert.equal(E.durabilityView(anchor,{castleId:id,elapsedMs:600000}).current,initial.current);
 assert.equal(E.durabilityView({...anchor,updatedElapsedMs:60000},{castleId:id,elapsedMs:0}).current,initial.current);
});
test('clock migration preserves existing damage instead of healing through the time-origin offset',()=>{
 const g=quiet(fresh()),id=g.state.home;damage(g,id,.3);g.tick(5);const before=g.castle(id).durability.current;
 const r=g.applyWorldClock({id:'shared-durability',elapsedMs:6000000,running:true,speed:1});assert(r.ok);assert.equal(g.castle(id).durability.current,before);assert.equal(g.state.castles[id].durability.updatedElapsedMs,6000000);
 g.applyWorldClock({id:'shared-durability',elapsedMs:6060000,running:true,speed:1});assert.equal(g.castle(id).durability.current,before+g.castle(id).durability.max/10);
});
test('unbuilt and fallen branches stay zero and never repair themselves',()=>{
 const g=fresh();g.state.castles.nijo.owner=g.state.clan;g.state.branches=[branch('nijo',{fallen:true})];
 assert.equal(g.branch('nijo_north').durability.current,0);assert.equal(g.branch('nijo_north').durability.recoveryPerMonth,0);
 g.state.turn=100;assert.equal(g.branch('nijo_north').durability.current,0);g.state.branches[0].level=0;g.state.branches[0].fallen=false;assert.equal(g.branch('nijo_north').durability.max,0);
});
test('stronger castle levels retain absolute missing durability',()=>{
 const g=quiet(prepare(fresh())),id=g.state.home,before=damage(g,id,.25),missing=before.max-before.current;
 g.state.castles[id].level++;g._anchorCastleDurability(id);const after=g.castle(id).durability;
 assert.equal(after.max-before.max,2000);assert.equal(after.max-after.current,missing);
 const prior=after.current;g.tick(5);assert.equal(g.castle(id).durability.current,prior);assert.equal(g.castle(id).durability.repairPendingHP,Math.floor(after.max/120));
});
test('actual castle construction changes capacity at its completion time',()=>{
 const g=quiet(prepare(fresh())),id=g.state.home,before=damage(g,id,.2),quote=g.upgradeCastle(id);assert(quote.ok,quote.message);
 g._advanceRealtime(60);const after=g.castle(id).durability;assert.equal(after.max,before.max+2000);assert.equal(after.current,before.current+before.max/10+2000);assert.equal(g.state.castles[id].durability.updatedElapsedMs,60000);
});
test('damaged fortifications reduce defense without changing troop stocks or bare base force',()=>{
 const g=fresh(),id=g.state.home;g.state.castles[id].level=8;g.state.castles[id].wall=8;g.state.buildings.wall=8;const before=g.defensePower(id),troops=g.state.castles[id].troops;
 damage(g,id,0);assert(g.defensePower(id)<before);assert(g.defensePower(id)>troops);assert.equal(g.state.castles[id].troops,troops);
});
test('failed real siege records persistent damage and victory breaches then restores one quarter',()=>{
 const g=prepare(fresh()),id=g.adjacentTargets()[0].id;g.state.castles[id].troops=100000;g.state.troops=1000;g.random=()=>.999;
 const before=g.castle(id).durability.current,loss=g.attack(id,'balanced',1000);assert(loss.ok,loss.message);assert.equal(loss.battle.won,false);assert(loss.battle.durability.damage>0);assert.equal(g.castle(id).durability.current,before-loss.battle.durability.damage);
 const reloaded=E.fromSave(g.exportSave(),roster);assert.deepEqual(reloaded.state.lastBattle.durability,loss.battle.durability);
 g.state.command=3;g.state.troops=100000;g.state.castles[id].troops=10;g.random=()=>0;const win=g.attack(id,'balanced',100000);assert(win.ok,win.message);assert(win.battle.won);assert.equal(win.battle.durability.breachCurrent,0);assert(win.battle.durability.breached);assert.equal(g.castle(id).durability.current,Math.round(g.castle(id).durability.max*.25));assert.equal(g.state.castles[id].owner,g.state.clan);
});
test('branch defeat damage accumulates and destruction stays at zero',()=>{
 const g=prepare(fresh()),parent=g.adjacentTargets().find(c=>D.branchRules.parents.some(p=>p.id===c.id))?.id||'nijo';g.state.castles[D.castles.find(c=>c.neighbors.includes(parent)).id].owner=g.state.clan;g.state.castles[parent].owner='在地衆';g.state.castles[parent].troops=100000;g.state.branches=[branch(parent)];g.state.troops=1000;g.random=()=>.999;
 const first=g.attackBranch(parent+'_north','balanced',1000);assert(first.ok,first.message);assert(!first.battle.won);assert(first.battle.durability.damage>0);
 g.state.command=3;g.state.troops=100000;g.state.castles[parent].troops=10;g.random=()=>0;const second=g.attackBranch(parent+'_north','balanced',100000);assert(second.ok,second.message);assert(second.battle.won);assert(g.state.branches[0].fallen);assert.equal(g.branch(parent+'_north').durability.current,0);assert.equal(second.battle.durability.after,0);
});
test('paid branch repair restores full when the existing construction completes',()=>{
 const g=quiet(prepare(fresh()));g.state.castles.nijo.owner=g.state.clan;g.state.branches=[branch('nijo',{fallen:true,durability:{version:1,current:0,max:6500,updatedElapsedMs:0}})];
 const result=g.repairBranch('nijo_north');assert(result.ok,result.message);g._advanceRealtime(60);assert(!g.state.branches[0].fallen);assert.equal(g.branch('nijo_north').durability.ratio,1);
});
test('CPU capture writes damage without bypassing protected ownership',()=>{
 const g=prepare(fresh());for(const row of Object.values(g.state.castles))row.owner=g.state.clan;
 const attacker=D.castles.find(c=>c.neighbors.every(id=>!['edo','kyoto_gosho'].includes(id)));g.state.castles[attacker.id].owner='在地衆';g.state.castles[attacker.id].troops=10000000;
 const target=attacker.neighbors[0];g.state.turn=9;g.state.troops=0;g.state.castles[target].troops=1;g.random=()=>0;
 g._cpuTurn();assert.equal(g.state.castles[target].owner,'在地衆');assert.equal(g.castle(target).durability.ratio,.25);
});
test('local covert retaliation retains durability damage and its idempotent history receipt',()=>{
 const g=prepare(new E({officers:roster,seed:17,isAdmin:true})),request=()=>({requestId:'durability-covert-'+g.state.covert.sequence,campaignId:g.state.walking.campaignId,sequence:g.state.covert.sequence});
 assert(g.hireCovert('edo',100,request()).ok);const stationed=g.dispatchCovert('edo',{kind:'castle',castleId:'kagoshima'},50,'station',request());assert(stationed.ok,stationed.message);
 g.state.turn=9;for(const c of D.castles)if(c.id!==g.state.home)g.state.castles[c.id].owner='在地衆';g.random=()=>0;g._cpuTurn();g.state.command=3;
 const owner=g.state.castles.kagoshima.owner,options=request(),incident=g.state.covert.incidents[0],result=g.retaliateCovert(stationed.result.stationId,incident.id,options);assert(result.ok,result.message);const battle=result.result.battle;
 assert(battle.durability.damage>0);assert(!battle.durability.captured);assert.equal(g.state.castles.kagoshima.owner,owner);assert.equal(g.castle('kagoshima').durability.current,battle.durability.after);
 const loaded=E.fromSave(g.exportSave(),roster,{isAdmin:true});assert.deepEqual(loaded.state.covert.history[0].battle.durability,battle.durability);const before=clone(loaded.state);assert(loaded.retaliateCovert(stationed.result.stationId,incident.id,options).idempotent);assert.deepEqual(loaded.state,before);
});
test('malformed imported durability and battle results are rejected',()=>{
 const g=fresh(),raw=JSON.parse(g.exportSave()),id=g.state.home;
 for(const durability of [null,{}, {version:1,current:-1,max:10000,updatedElapsedMs:0},{version:1,current:10001,max:10000,updatedElapsedMs:0},{version:1,current:1.2,max:10000,updatedElapsedMs:0},{version:1,current:1,max:Infinity,updatedElapsedMs:0},{version:1,current:1,max:10000,updatedElapsedMs:-1}]){const bad=clone(raw);bad.state.castles[id].durability=durability;assert.throws(()=>E.fromSave(bad,roster));}
 assert.throws(()=>E.normalizeDurabilityBattle({before:1,after:0,damage:2,max:10000,breached:false,captured:false,record:{version:1,current:0,max:10000,updatedElapsedMs:0}}));
});
console.log(count+' durability engine groups passed.');

