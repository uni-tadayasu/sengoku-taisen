'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),scope={window:{}};vm.createContext(scope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),scope);const officers=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
const make=()=>{const g=new E({officers,seed:77});for(const k of D.resources)g.state.resources[k]=9000000;return g;};
const tests=[];function test(name,fn){tests.push([name,fn]);}
const state=g=>JSON.parse(g.exportSave()).state;
test('each queued level pays its own cost and one command, while one chain uses one slot',()=>{
 const g=make(),first=g.costs('farm'),second=g.costs('farm',3),before=structuredClone(g.state.resources);assert(g.upgrade('farm').ok);const quote=g.costs('farm');assert.deepEqual(quote,second);const queued=g.upgrade('farm');assert(queued.ok&&queued.queued);assert.equal(queued.targetLevel,4);assert.equal(g.state.command,1);assert.equal(g.constructionChains(),1);
 for(const k of D.resources)assert.equal(g.state.resources[k],before[k]-(first[k]||0)-(second[k]||0));assert(g.upgradeCastle(g.state.home).ok);assert.equal(g.constructionChains(),2);
 const beforeReject=state(g);assert.equal(g.upgrade('market').ok,false);assert.deepEqual(state(g),beforeReject);
 const jobs=g.constructionJobs().filter(j=>j.id==='farm');assert.deepEqual(jobs.map(j=>[j.targetLevel,j.shared,j.queued,j.startsInSeconds,j.finishesInSeconds]),[[3,false,false,0,60],[4,false,true,60,120]]);
});
test('only the head progresses and stage completion changes income at that precise time',()=>{
 const g=make();g.upgrade('farm');g.upgrade('farm');const base=g.income();g._advanceRealtime(59.5);assert.equal(g.state.buildings.farm,2);assert.equal(g.state.jobs[0].remainingSeconds,.5);assert.equal(g.state.jobs[1].remainingSeconds,60);
 const loaded=E.fromSave(g.exportSave(),officers);assert.deepEqual(state(loaded),state(g));loaded._advanceRealtime(.5);assert.equal(loaded.state.buildings.farm,3);assert.equal(loaded.state.jobs.length,1);assert.equal(loaded.state.jobs[0].remainingSeconds,60);assert(loaded.income().rice>base.rice);loaded._advanceRealtime(59.5);assert.equal(loaded.state.buildings.farm,3);loaded._advanceRealtime(.5);assert.equal(loaded.state.buildings.farm,4);assert.equal(loaded.state.stats.upgrades,2);assert.equal(loaded.state.jobs.length,0);
});
test('continuous and saved/reloaded catch-up preserve all queued outcomes and resources',()=>{
 const a=make();a.state.buildings.keep=32;a.state.command=7;for(let i=0;i<4;i++)assert(a.upgrade('farm').ok);assert(a.upgrade('market').ok);assert(a.upgradeCastle(a.state.home).ok);assert(a.research('commerce').ok);const b=E.fromSave(a.exportSave(),officers);a._advanceRealtime(600);let restored=b;for(let i=0;i<60;i++){restored._advanceRealtime(10);restored=E.fromSave(restored.exportSave(),officers);}const x=state(a),y=state(restored);for(const k of D.resources){assert(Math.abs(x.realtime.incomeRemainders[k]-y.realtime.incomeRemainders[k])<1e-8);x.realtime.incomeRemainders[k]=y.realtime.incomeRemainders[k];}assert.deepEqual(x,y);
});
test('full stage32 reservations cap each facility while six long chains remain six slots',()=>{
 const g=make();g.state.buildings.keep=32;const ids=['gold_mine','silver_mine','trade_port','wholesale','artisan_town','post_town'];for(const id of ids)for(let level=1;level<=32;level++){g.state.command=7;assert(g.upgrade(id).ok,id+' '+level);}assert.equal(g.state.jobs.length,192);assert.equal(g.constructionChains(),6);g.state.command=7;const before=state(g);assert.equal(g.upgrade('gold_mine').ok,false);assert.equal(g.upgrade('market').ok,false);assert.deepEqual(state(g),before);assert.equal(E.fromSave(g.exportSave(),officers).state.jobs.length,192);
});
test('invalid gaps, duplicate levels, partly elapsed tails and fake projection metadata reject or sanitize',()=>{
 const g=make();g.upgrade('farm');g.upgrade('farm');for(const change of [s=>s.jobs[1].targetLevel=6,s=>s.jobs[1].targetLevel=3,s=>{s.jobs[1].remainingSeconds=59;s.jobs[1].remaining=1;},s=>s.jobs.reverse()]){const save=JSON.parse(g.exportSave());change(save.state);assert.throws(()=>E.fromSave(save,officers));}
 const raw=JSON.parse(g.exportSave());raw.state.jobs[0].shared=true;raw.state.jobs[0].queued=true;raw.state.jobs[0].startsInSeconds=999;const restored=E.fromSave(raw,officers);assert.equal(restored.state.jobs[0].shared,undefined);assert.equal(restored.constructionJobs()[0].shared,false);assert.equal(restored.constructionJobs()[0].queued,false);
});
test('legacy Sunpu migration does not deduplicate personal facility reservations',()=>{
 const g=make();g.upgrade('farm');g.upgrade('farm');const raw=JSON.parse(g.exportSave());raw.state.castles[g.state.home].owner='在地衆';raw.state.home='sunpu';raw.state.cycle.home='sunpu';raw.state.castles.sunpu.owner=raw.state.clan;const migrated=E.fromSave(raw,officers);assert.notEqual(migrated.state.home,'sunpu');assert.equal(migrated.state.jobs.length,2);assert.deepEqual(migrated.state.jobs.map(j=>j.targetLevel),[3,4]);assert.equal(E.fromSave(migrated.exportSave(),officers).state.jobs.length,2);
});
test('shared future jobs stay queued until their server deadlines and local upgrades cannot modify them',()=>{
 const ordinary=make(),g=E.fromSave(ordinary.exportSave(),officers,{isStaff:true}),initial=structuredClone(ordinary.state.buildings),base={id:'sunpu',revision:1,castleLevel:1,initial:{castleLevel:1,buildings:initial},buildings:initial,history:[],createdElapsedMs:0,updatedElapsedMs:0,accessSinceElapsedMs:0,clanSinceElapsedMs:0,jobs:[{jobId:'one',kind:'building',id:'farm',targetLevel:3,totalSeconds:60,startedElapsedMs:0,completesElapsedMs:60000},{jobId:'two',kind:'building',id:'farm',targetLevel:4,totalSeconds:60,startedElapsedMs:60000,completesElapsedMs:120000}]};assert(g.applyStaffBase(base).ok);let jobs=g.constructionJobs();assert.equal(jobs.length,2);assert.equal(jobs[1].queued,true);assert.equal(jobs[1].startsInSeconds,60);assert.equal(g.costs('farm').gold,g.costs('farm',4).gold);assert.equal(g.upgrade('farm').ok,false);
 g._advanceRealtime(60);assert.equal(g.state.buildings.farm,3);jobs=g.constructionJobs();assert.equal(jobs.length,1);assert.equal(jobs[0].queued,false);g._advanceRealtime(60);assert.equal(g.state.buildings.farm,4);assert.equal(g.constructionJobs().length,0);assert.equal(state(g).buildings.farm,2);
 for(const change of [b=>b.jobs[1].targetLevel=5,b=>b.jobs[1].startedElapsedMs=59000,b=>b.jobs[1].jobId='one']){const bad=structuredClone(base);bad.revision=2;change(bad);assert.equal(g.applyStaffBase(bad).ok,false);}
});
for(const [name,fn] of tests){fn();console.log('PASS '+name);}console.log(tests.length+' construction queue engine checks passed.');
