'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E}=require('../engine.js');
const Travel=require('../travel.js');
const context={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),context);
const officers=JSON.parse(JSON.stringify(context.window.SENGOKU_OFFICERS));
const create=()=>{const g=new E({officers,seed:1,isAdmin:true});g.state.covert.reserves.edo=100;g.state.resources.gold=g.state.resources.rice=100000;g.state.command=g.commandMax();return g;};
const saved=g=>{const value=JSON.parse(g.exportSave());delete value.savedAt;return value;};
const reload=g=>E.fromSave(saved(g),officers,{isAdmin:true});
const advance=(g,seconds)=>{const results=[];for(let left=seconds;left>1e-9;){const step=Math.min(5,left),r=g.tick(step);assert(r.ok);results.push(...(r.covertResults||[]));left-=step;}return results;};
const at=(g,elapsed)=>{g.state.turn=Math.floor(elapsed/60000);g.state.realtime.elapsed=(elapsed%60000)/1000;};
const send=(g,mode='scout',extra={})=>g.departCovertDispatch('edo',{kind:'castle',castleId:'kawagoe'},40,mode,{requestId:'return-trip',...extra});
let cases=0;const test=(name,run)=>{run();cases++;console.log('PASS '+name);};

test('scouts report at outbound arrival but remain unavailable until the exact return boundary',()=>{
 const g=create(),before=g.maintenance().troops.covert,departure=send(g),cost=departure.result.foodCost,route=departure.march.travel;
 assert(departure.accepted);advance(g,route.durationMs/1000-.001);
 assert.equal(g.state.covert.reports.length,0);assert.equal(g.state.covert.reserves.edo,60);
 advance(g,.001);const returning=g.state.covert.dispatches[0];
 assert.equal(returning.id,departure.march.id);assert.equal(returning.phase,'returning');
 assert.deepEqual(returning.travel,Travel.plan({sourceCastleId:'kawagoe',targetCastleId:'edo'}));
 assert.equal(returning.departedElapsedMs,departure.march.arrivesElapsedMs);
 assert.equal(returning.arrivesElapsedMs,departure.march.arrivesElapsedMs+returning.travel.durationMs);
 assert.equal(returning.foodCost,0);assert.equal(returning.commandCost,0);
 assert.equal(g.state.covert.reserves.edo,60);assert.equal(g.state.covert.reports.length,1);
 assert.equal(g.state.covert.history[0].foodCost,cost);assert.equal(g.state.covert.history[0].status,'marching');
 assert.equal(g.maintenance().troops.covert,before);
 const retry=send(g);assert(retry.idempotent&&retry.accepted);assert.equal(retry.march.phase,'returning');
 const h=reload(g);assert.deepEqual(h.state.covert,g.state.covert);
 advance(h,returning.travel.durationMs/1000-.001);assert.equal(h.state.covert.reserves.edo,60);
 advance(h,.001);assert.equal(h.state.covert.dispatches.length,0);assert.equal(h.state.covert.reserves.edo,100);
 assert.equal(h.state.covert.history[0].status,'resolved');assert.equal(h.state.covert.history[0].foodCost,cost);
 assert.equal(h.state.covert.reports.length,1);assert(h.state.covert.history[0].report);
 const final=saved(h);assert.deepEqual(h.settleCovertDue(),[]);assert.deepEqual(saved(h),final);
 assert(send(h).idempotent);assert.deepEqual(saved(h),final);
});

test('recall starts a free return trip and keeps its identity after local receipt history is trimmed',()=>{
 const g=create();const deployed=g.dispatchCovert('edo',{kind:'castle',castleId:'kawagoe'},40,'station',{requestId:'station-for-recall'});
 assert(deployed.ok);const request={requestId:'recall-party',sequence:g.state.covert.sequence,campaignId:g.state.walking.campaignId},before=saved(g),r=g.recallCovert(deployed.result.stationId,request);
 assert(r.ok&&r.accepted);assert.equal(r.march.phase,'returning');assert.equal(r.march.stationId,deployed.result.stationId);
 assert.equal(g.state.covert.stations.length,0);assert.equal(g.state.covert.reserves.edo,60);
 assert.equal(g.state.command,before.state.command);assert.deepEqual(g.state.resources,before.state.resources);
 for(let i=0;i<42;i++){g.state.command=g.commandMax();assert(g.hireCovert('edo',1,{requestId:'history-fill-'+i}).ok);}
 assert(!g.state.covert.history.some(row=>row.requestId===request.requestId));
 const h=reload(g),pending=saved(h),again=h.recallCovert(deployed.result.stationId,request);
 assert(again.ok&&again.idempotent&&again.accepted);assert.equal(again.march.id,r.march.id);assert.deepEqual(saved(h),pending);
 advance(h,r.march.travel.durationMs/1000);assert.equal(h.state.covert.reserves.edo,142);
 assert.equal(h.state.covert.dispatches.length,0);assert.doesNotThrow(()=>reload(h));
});

test('late settlement catches up both legs in one pass without changing the travel deadline',()=>{
 const g=create(),d=send(g);at(g,d.march.arrivesElapsedMs+d.march.travel.durationMs+1234);
 const complete=g.settleCovertDue();assert(complete.length>0);
 assert.equal(g.state.covert.dispatches.length,0);assert.equal(g.state.covert.reserves.edo,100);
 assert.equal(g.state.covert.reports.length,1);assert.equal(g.state.covert.history[0].status,'resolved');
 assert.equal(g.state.covert.history[0].march.arrivesElapsedMs,d.march.arrivesElapsedMs+d.march.travel.durationMs);
 assert.doesNotThrow(()=>reload(g));
});

test('a player scouting return needs no second target snapshot and local ticks settle it on time',()=>{
 const g=create(),snapshot={level:1,troops:100,garrison:200,wall:1,defensePower:400};
 const d=g.departCovertDispatch('edo',{kind:'player',playerId:'other-lord',castleId:'kawagoe'},40,'scout',{requestId:'player-scout',targetSnapshot:snapshot});
 assert(d.accepted);at(g,d.march.arrivesElapsedMs);
 g.settleCovertDue({targetSnapshots:{'other-lord:kawagoe':{snapshot,battleCursor:9}}});
 assert.equal(g.state.covert.dispatches[0].phase,'returning');assert.equal(g.state.covert.reserves.edo,60);
 const h=reload(g),back=h.state.covert.dispatches[0];advance(h,back.travel.durationMs/1000-.001);
 assert.equal(h.state.covert.reserves.edo,60);advance(h,.001);
 assert.equal(h.state.covert.reserves.edo,100);assert.equal(h.state.covert.dispatches.length,0);
 assert.equal(h.state.covert.reports.length,1);assert.equal(h.state.covert.history[0].resolvedElapsedMs,back.arrivesElapsedMs);
});

test('canceling the return never refunds an already completed scouting mission twice',()=>{
 const g=create(),d=send(g);advance(g,d.march.travel.durationMs/1000);
 const resources=structuredClone(g.state.resources),command=g.state.command,result=g.cancelCovertDispatch(d.march.id,'境界の検証');
 assert(result);assert.equal(g.state.covert.reserves.edo,100);assert.deepEqual(g.state.resources,resources);assert.equal(g.state.command,command);
 const final=saved(g);assert.equal(g.cancelCovertDispatch(d.march.id,'重複'),null);assert.deepEqual(saved(g),final);
 assert.doesNotThrow(()=>reload(g));
});

test('authoritative returning parties cannot settle or refund through a client clock',()=>{
 const g=create(),d=send(g);advance(g,d.march.travel.durationMs/1000);
 g.state.covert.dispatches[0].authority='server';g.state.covert.history[0].march.authority='server';
 const h=reload(g),back=h.state.covert.dispatches[0];advance(h,back.travel.durationMs/1000+5);
 assert.equal(h.state.covert.dispatches.length,1);assert.equal(h.state.covert.reserves.edo,60);
 assert.equal(h.cancelCovertDispatch(back.id,'client'),null);assert.deepEqual(h.settleCovertDue(),[]);
 assert(h.settleCovertDue({authoritative:true}).length);assert.equal(h.state.covert.reserves.edo,100);
 assert.deepEqual(h.settleCovertDue({authoritative:true}),[]);
});

test('return routing and cost data are validated while old outbound saves remain readable',()=>{
 const g=create(),d=send(g),old=saved(g);delete old.state.covert.dispatches[0].phase;delete old.state.covert.history[0].march.phase;
 assert.doesNotThrow(()=>E.fromSave(old,officers,{isAdmin:true}));
 advance(g,d.march.travel.durationMs/1000);
 for(const corrupt of [m=>m.phase='unknown',m=>m.travel.durationMs++,m=>m.arrivesElapsedMs--,m=>m.foodCost=1,m=>m.commandCost=1]){
  const value=saved(g);corrupt(value.state.covert.dispatches[0]);assert.throws(()=>E.fromSave(value,officers,{isAdmin:true}));
 }
});
console.log(`Covert return travel: ${cases} scenarios passed.`);
