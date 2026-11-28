'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E}=require('../engine.js');
const roster={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),roster);
const officers=JSON.parse(JSON.stringify(roster.window.SENGOKU_OFFICERS));
const fresh=(options={})=>new E({officers,seed:1,...options});
const clone=value=>JSON.parse(JSON.stringify(value));
let checks=0;
function test(name,fn){fn();checks++;console.log('PASS '+name);}
function vulnerable({home='kiyosu',outposts=[],protectedBase=false}={}){
 const g=fresh({isCourtProtected:protectedBase}),s=g.state;
 s.home=home;s.cycle.home=home;s.turn=9;s.realtime.elapsed=0;s.troops=2000;
 for(const castle of Object.values(s.castles))Object.assign(castle,{owner:'在地衆',troops:100000,wall:1,level:1});
 for(const id of [home,...outposts])Object.assign(s.castles[id],{owner:s.clan,troops:100});
 g.random=()=>0;return g;
}
const castleJob=id=>({kind:'castle',id,targetLevel:2,total:1,totalSeconds:60,remaining:1,remainingSeconds:50});

test('protection is explicit transient authority and cannot be restored by saved flags or a badge',()=>{
 const protectedGame=fresh({isCourtProtected:true});assert.equal(protectedGame.isCourtProtected,true);
 const saved=JSON.parse(protectedGame.exportSave());assert(!JSON.stringify(saved).includes('courtProtected'));assert(!JSON.stringify(saved).includes('isCourtProtected'));
 saved.isCourtProtected=true;saved.state.isCourtProtected=true;saved.state.courtProtected=true;saved.state.entitlements={courtProtected:true};saved.state.courtOffice={title:'左大臣',kind:'official'};
 assert.equal(E.fromSave(saved,officers).isCourtProtected,false);
 for(const title of ['天皇','摂政','上皇']){saved.state.courtOffice={title};saved.state.isCourtEmperor=true;saved.state.isCourtRegent=true;assert.equal(E.fromSave(saved,officers).isCourtProtected,false,title+' in an imported save is not authority');}
 assert.equal(E.fromSave(saved,officers,{isCourtProtected:true}).isCourtProtected,true);
 assert.equal(E.fromSave(saved,officers,{isCourtProtected:'true'}).isCourtProtected,false);
 assert.equal(fresh({isCourtProtected:1}).isCourtProtected,false);
 assert.equal(protectedGame.isAdmin,false);assert.equal(protectedGame.isStaff,false);assert.equal(protectedGame.isDeputy,false);
});
test('verified changes toggle protection without modifying personal progress',()=>{
 const g=fresh(),before=clone(g.state);assert(g.setCourtProtection(true).changed);assert.equal(g.isCourtProtected,true);assert.deepEqual(g.state,before);
 assert.equal(g.setCourtProtection(true).changed,false);assert.equal(g.setCourtProtection('true').ok,false);assert.equal(g.isCourtProtected,true);
 assert(g.setCourtProtection(false).changed);assert.equal(g.isCourtProtected,false);assert.deepEqual(g.state,before);
});
test('an actual losing CPU home defense retains ownership, works and home while inflicting damage',()=>{
 const control=vulnerable(),g=vulnerable({protectedBase:true}),s=g.state;
 s.jobs=[castleJob('kiyosu')];const works=clone(s.jobs),beforeDurability=g.castle('kiyosu').durability.current;
 control._cpuTurn();assert.equal(control.state.gameOver,true);assert.notEqual(control.state.castles.kiyosu.owner,control.state.clan);
 const events=g._cpuTurn();assert(events.length);assert.equal(s.castles.kiyosu.owner,s.clan);assert.equal(s.home,'kiyosu');assert.equal(s.cycle.home,'kiyosu');assert.equal(s.gameOver,false);
 assert(s.troops<2000);assert(s.castles.kiyosu.troops<100);assert(g.castle('kiyosu').durability.current<beforeDurability);assert.deepEqual(s.jobs,works);assert.deepEqual(g.takeHomeDefenseLosses(),[]);
 assert(!events.some(text=>/占領不可|占領できない|運営|サブ運営/.test(text)));
});
test('protection applies equally to a CPU attack on a non-home holding',()=>{
 const control=vulnerable({outposts:['ishikawa']}),g=vulnerable({outposts:['ishikawa'],protectedBase:true}),s=g.state;
 s.jobs=[castleJob('ishikawa')];const works=clone(s.jobs),before=g.castle('ishikawa').durability.current;
 control._cpuTurn();assert.notEqual(control.state.castles.ishikawa.owner,control.state.clan);
 g._cpuTurn();assert.equal(s.castles.ishikawa.owner,s.clan);assert.equal(s.castles.kiyosu.owner,s.clan);assert.equal(s.home,'kiyosu');assert(s.castles.ishikawa.troops<100);assert(g.castle('ishikawa').durability.current<before);assert.deepEqual(s.jobs,works);assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});
test('a protected parent castle keeps fallen branches and queued repairs after losing its defense',()=>{
 const g=vulnerable({home:'osaka',protectedBase:true}),s=g.state;
 s.branches=[{id:'osaka_north',parentCastleId:'osaka',direction:'north',level:1,fallen:true}];
 s.jobs=[castleJob('osaka'),{kind:'branch',id:'osaka_north',repair:true,targetLevel:1,total:1,totalSeconds:60,remaining:1,remainingSeconds:50}];
 const branches=clone(s.branches),jobs=clone(s.jobs);
 g._cpuTurn();assert.equal(s.castles.osaka.owner,s.clan);assert.deepEqual(s.branches,branches);assert.deepEqual(s.jobs,jobs);assert.deepEqual(g.takeBranchParentLosses(),[]);assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});
test('ending the current protection restores ordinary CPU occupation and succession receipts',()=>{
 const g=vulnerable({protectedBase:true});g._cpuTurn();assert.equal(g.state.castles.kiyosu.owner,g.state.clan);
 assert(g.setCourtProtection(false).ok);g.state.turn=12;g._cpuTurn();
 assert.notEqual(g.state.castles.kiyosu.owner,g.state.clan);assert.equal(g.state.gameOver,true);assert.equal(g.takeHomeDefenseLosses().length,1);
});
test('shared-clock catchup applies the verified current protection to a real scheduled defeat',()=>{
 const source=vulnerable(),g=E.fromSave(source.exportSave(),officers,{isCourtProtected:true});g.random=()=>0;
 g.state.turn=8;g.state.realtime.elapsed=59;g.state.worldClock={id:'court-world',elapsedMs:539000};
 const result=g.applyWorldClock({id:'court-world',elapsedMs:540000,running:true,speed:1},{maxSeconds:86400});
 assert(result.ok);assert.equal(g.state.castles.kiyosu.owner,g.state.clan);assert.equal(g.state.gameOver,false);assert.deepEqual(g.takeHomeDefenseLosses(),[]);
});
console.log(JSON.stringify({ok:true,checks}));
