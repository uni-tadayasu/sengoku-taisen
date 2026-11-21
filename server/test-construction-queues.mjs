import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine as Engine,GAME_OFFICERS as officers} from './game-runtime.js';

const checks=[];let calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
async function scope(name,run){
  const h=harness(),{api,sql}=h;
  const row=p=>sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id),save=p=>JSON.parse(row(p).save_json),baseRow=()=>sql.prepare("SELECT * FROM staff_base WHERE id='sunpu'").get(),baseState=()=>JSON.parse(baseRow().state_json);
  const clock=async()=> (await api('/world-clock')).data.clock;
  const at=elapsed=>sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=1,speed=1,revision=revision+1 WHERE id='world-v1'").run(elapsed,h.now);
  const sync=async p=>(await api('/sync?deviceId='+p.device,{token:p.token})).data;
  const put=async(p,value,expected=200)=>(await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.device,revision:row(p).revision,save:value},expected})).data;
  const base=async p=>(await api('/staff/base',{token:p.token})).data.staffBase;
  const balances=p=>({resources:structuredClone(save(p).state.resources),command:save(p).state.command,revision:row(p).revision});
  const request=(p,id='farm',kind='building')=>({id,kind,requestId:crypto.randomUUID(),deviceId:p.device,expectedRevision:row(p).revision,baseRevision:baseRow().revision});
  const upgrade=async(p,body=request(p),expected=200)=>(await api('/staff/base/upgrade',post(p,body,expected)));
  const setupBase=(change)=>{const state=baseState();change(state);sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1,updated_at=? WHERE id='sunpu'").run(JSON.stringify(state),h.now);};
  let admin;
  const role=async(p,action='appoint')=>(await api('/admin/staff',post(admin,{targetPlayerId:p.user.id,action,requestId:crypto.randomUUID()}))).data;
  const create=async(name,{staff=false,personalFarm=5}={})=>{const p=await h.session(name,'伊達家');p.device=p.user.id+'-writer';await api('/sync/lease',post(p,{deviceId:p.device}));const game=new Engine({clan:'伊達家',startCastle:'himeji',officers,seed:17});game.state.resources={gold:9000000,rice:9000000,wood:9000000,stone:9000000};game.state.buildings.farm=personalFarm;game.applyWorldClock(await clock());await put(p,JSON.parse(game.exportSave()));if(staff){await role(p);await sync(p);}return p;};
  const align=async p=>{const snapshot=await sync(p),game=Engine.fromSave(snapshot.save,officers,{isAdmin:snapshot.user.isAdmin,isStaff:snapshot.user.isStaff,staffBase:snapshot.staffBase});game.applyWorldClock(await clock());return put(p,JSON.parse(game.exportSave()));};
  try{admin=await h.session('連続普請の運営');await api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));await clock();at(0);await run({h,api,sql,row,save,baseRow,baseState,clock,at,sync,put,base,balances,request,upgrade,setupBase,role,create,align,admin});checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}
function paid(before,after,receipt){for(const key of ['gold','rice','wood','stone'])assert.equal(after.resources[key],before.resources[key]-(receipt.cost[key]||0));assert.equal(after.command,before.command-1);assert.equal(after.revision,before.revision+1);}

await scope('shared facility stages charge their future-level price and share one construction slot',async c=>{
  const {h,create,setupBase,baseState,request,upgrade,balances,at,base,sync,clock}=c,a=await create('連続A',{staff:true}),b=await create('連続B',{staff:true}),d=await create('連続C',{staff:true});
  setupBase(s=>{s.initial.buildings.farm=5;s.buildings.farm=5;s.history=[];s.jobs=[];});
  const initial=await sync(a),game=Engine.fromSave(initial.save,officers,{isStaff:true,staffBase:initial.staffBase});
  const firstBefore=balances(a),first=(await upgrade(a)).data;paid(firstBefore,balances(a),first.receipt);assert.equal(first.receipt.targetLevel,6);assert.equal(first.receipt.queued,false);assert.equal(first.receipt.startedElapsedMs,0);assert.equal(first.receipt.completesElapsedMs,60000);
  const nextBefore=balances(b),next=(await upgrade(b)).data;paid(nextBefore,balances(b),next.receipt);assert.equal(next.receipt.targetLevel,7);assert.equal(next.receipt.queued,true);assert.equal(next.receipt.queuePosition,1);assert.equal(next.receipt.startedElapsedMs,60000);assert.equal(next.receipt.completesElapsedMs,180000);assert.equal(next.receipt.cost.gold,game.costs('farm',6).gold);assert(next.receipt.cost.gold>first.receipt.cost.gold);
  const third=(await upgrade(a)).data;assert.equal(third.receipt.targetLevel,8);assert.equal(third.receipt.startedElapsedMs,180000);assert.equal(third.receipt.completesElapsedMs,300000);
  await upgrade(b,request(b,'market'));assert.equal(new Set(baseState().jobs.map(j=>j.kind+':'+j.id)).size,2);const blocked=balances(d);assert.equal((await upgrade(d,request(d,'quarry'),409)).data.error.code,'STAFF_BUILDING_SLOTS');assert.deepEqual(balances(d),blocked);
  const fourth=(await upgrade(d)).data;assert.equal(fourth.receipt.targetLevel,9);assert.equal(baseState().jobs.length,5);assert.equal(baseState().buildings.farm,5);
  at(59999);assert.equal((await base(a)).buildings.farm,5);at(60000);assert.equal((await base(a)).buildings.farm,6);assert.equal(baseState().jobs.filter(j=>j.id==='farm').length,3);at(90000);
  const state=await base(a);game.applyStaffBase(state);game.applyWorldClock(await clock());const jobs=game.constructionJobs().filter(j=>j.shared&&j.id==='farm');assert.equal(jobs.length,3);assert.equal(jobs[0].queued,false);assert.equal(jobs[0].remainingSeconds,90);assert.equal(jobs[1].queued,true);assert.equal(jobs[1].remainingSeconds,120);assert.equal(jobs[1].startsInSeconds,90);assert.equal(game.state.buildings.farm,6);
  const allAtStart=await sync(b),long=Engine.fromSave(allAtStart.save,officers,{isStaff:true,staffBase:state}),pieces=Engine.fromSave(allAtStart.save,officers,{isStaff:true,staffBase:state}),world=await clock();
  long.applyWorldClock({...world,elapsedMs:420000});for(const elapsedMs of [60000,90000,180000,240000,300000,420000])pieces.applyWorldClock({...world,elapsedMs});assert.deepEqual(long.state.resources,pieces.state.resources);assert.equal(long.state.buildings.farm,9);assert.equal(JSON.parse(long.exportSave()).state.buildings.farm,5,'Shared growth never overwrites the personal baseline');
  at(420000);const finished=await base(a);assert.equal(finished.buildings.farm,9);assert.equal(finished.jobs.length,0);assert.equal(finished.history.filter(e=>e.id==='farm').length,4);h.resetRates();
});

await scope('concurrent staff queue reservations and lost responses never create a free or duplicate stage',async c=>{
  const {h,create,baseState,baseRow,request,upgrade,balances,sql}=c,a=await create('競合普請A',{staff:true}),b=await create('競合普請B',{staff:true}),d=await create('競合普請C',{staff:true});await upgrade(a);
  const before=[balances(b),balances(d)],bodies=[request(b),request(d)];let entered=0,release;const gate=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests')))return;entered++;if(entered===2){h.beforeBatch=null;release();}await gate;};
  const outcomes=await Promise.all([upgrade(b,bodies[0],null),upgrade(d,bodies[1],null)]);assert.deepEqual(outcomes.map(r=>r.response.status).sort(),[200,409]);assert.equal(baseState().jobs.length,2);const winner=outcomes[0].response.status===200?0:1,loser=1-winner,players=[b,d];paid(before[winner],balances(players[winner]),outcomes[winner].data.receipt);assert.deepEqual(balances(players[loser]),before[loser]);
  const retry=(await upgrade(players[loser],request(players[loser]))).data;assert.equal(retry.receipt.targetLevel,5);paid(before[loser],balances(players[loser]),retry.receipt);assert.equal(baseState().jobs.length,3);
  const lost=request(a),lossBefore=balances(a);h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests'))){h.afterBatch=null;throw Error('local queue response lost after commit');}};await upgrade(a,lost,500);assert.equal(baseState().jobs.length,4);
  const replay=(await upgrade(a,{...lost,deviceId:'replacement-device',expectedRevision:0})).data;assert.equal(replay.idempotent,true);assert.equal(baseState().jobs.length,4);paid(lossBefore,balances(a),replay.receipt);assert.equal(sql.prepare('SELECT COUNT(*) n FROM staff_base_requests').get().n,4);
  const beforeGuard={actor:balances(d),base:baseRow().state_json},stale=request(d);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO staff_base_requests')))return;h.beforeBatch=null;sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(d.user.id);};await upgrade(d,stale,403);assert.deepEqual(balances(d),beforeGuard.actor);assert.equal(baseRow().state_json,beforeGuard.base);
});

await scope('pending level32 is the cap, resources are paid per stage, and castle upgrades remain single',async c=>{
  const {create,setupBase,upgrade,request,balances,baseState,sql,row,save,at,base,align}=c,a=await create('上限普請A',{staff:true});
  setupBase(s=>{s.initial.buildings.farm=s.buildings.farm=30;s.jobs=[];s.history=[];});await upgrade(a);const final=(await upgrade(a)).data;assert.equal(final.receipt.targetLevel,32);const before=balances(a),jobs=structuredClone(baseState().jobs);assert.equal((await upgrade(a,request(a),409)).data.error.code,'BUILDING_MAX');assert.deepEqual(balances(a),before);assert.deepEqual(baseState().jobs,jobs);
  at(final.receipt.completesElapsedMs);await base(a);await align(a);assert.equal((await base(a)).buildings.farm,32);
  const poor=save(a);poor.state.resources.wood=0;sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(poor),a.user.id);const noMoney=balances(a);assert.equal((await upgrade(a,request(a,'market'),409)).data.error.code,'INSUFFICIENT_ASSETS');assert.deepEqual(balances(a),noMoney);assert.equal(baseState().jobs.length,0);
  poor.state.resources.wood=9000000;poor.state.command=3;sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(poor),a.user.id);const castle=(await upgrade(a,request(a,'sunpu','castle'))).data;assert.equal(castle.receipt.targetLevel,2);const castleBefore=balances(a);assert.equal((await upgrade(a,request(a,'sunpu','castle'),409)).data.error.code,'STAFF_BUILDING_BUSY');assert.deepEqual(balances(a),castleBefore);assert.equal(baseState().jobs.length,1);assert(row(a));
});

await scope('appointment preserves a personal facility chain and dismissal restores its exact progress',async c=>{
  const {create,sync,put,role,at,clock,upgrade,request,base,save,align}=c,p=await create('任命前に連続普請'),other=await create('共同普請の確認係',{staff:true});let initial=await sync(p),game=Engine.fromSave(initial.save,officers);
  assert(game.upgrade('farm').ok);assert(game.upgrade('farm').ok);assert.deepEqual(game.state.jobs.map(j=>j.targetLevel),[6,7]);await put(p,JSON.parse(game.exportSave()));
  at(15000);await role(p);let staff=await sync(p);assert.equal(staff.save.state.buildings.farm,5);assert.deepEqual(staff.save.state.jobs.map(j=>j.targetLevel),[6,7]);game=Engine.fromSave(staff.save,officers,{isStaff:true,staffBase:staff.staffBase});game.applyWorldClock(await clock());assert.equal(game.state.jobs[0].remainingSeconds,45);assert.equal(game.state.jobs[1].remainingSeconds,120);await put(p,JSON.parse(game.exportSave()));
  const shared=(await upgrade(p,request(p))).data;assert.equal(shared.receipt.targetLevel,3);assert.equal(shared.receipt.startedElapsedMs,15000);
  at(60000);staff=await sync(p);game=Engine.fromSave(staff.save,officers,{isStaff:true,staffBase:staff.staffBase});game.applyWorldClock(await clock());assert.equal(game.state.buildings.farm,2);assert.equal(JSON.parse(game.exportSave()).state.buildings.farm,6);assert.equal(game.state.jobs.length,1);assert.equal(game.state.jobs[0].remainingSeconds,120);await put(p,JSON.parse(game.exportSave()));
  at(75000);assert.equal((await base(other)).buildings.farm,3);await align(p);assert.equal(save(p).state.buildings.farm,6);
  at(90000);await role(p,'dismiss');const restored=await sync(p);assert.equal(restored.user.isStaff,false);assert.equal(restored.save.state.home,'himeji');assert.equal(restored.save.state.clan,'伊達家');assert.equal(restored.save.state.buildings.farm,6);assert.equal(restored.save.state.jobs.length,1);assert.equal(restored.save.state.jobs[0].targetLevel,7);assert.equal(restored.save.state.jobs[0].remainingSeconds,90);assert.equal((await base(other)).buildings.farm,3);
  game=Engine.fromSave(restored.save,officers);at(180000);game.applyWorldClock(await clock());assert.equal(game.state.buildings.farm,7);assert.equal(game.state.jobs.length,0);
});

await scope('queued buildings survive a world-cycle settlement while reservations remain paid once',async c=>{
  const {at,create,upgrade,request,base,save,sync,api,clock}=c,C=globalThis.SENGOKU_DATA.worldCalendar.monthsPerCycle*60000;at(C-30000);const p=await create('周回をまたぐ共同普請',{staff:true});const first=(await upgrade(p)).data,second=(await upgrade(p)).data;assert(first.receipt.completesElapsedMs>C);const before=save(p).state.resources;
  at(C+30000);let snapshot=await sync(p);snapshot=(await api('/sync/settle',post(p,{deviceId:p.device,revision:snapshot.revision}))).data;assert.equal(snapshot.save.state.cycle.index,1);const after=await base(p);assert.equal(after.buildings.farm,first.receipt.targetLevel);assert.equal(after.jobs.length,1);assert.equal(after.jobs[0].targetLevel,second.receipt.targetLevel);assert.equal(after.jobs[0].startedElapsedMs,first.receipt.completesElapsedMs);
  const game=Engine.fromSave(snapshot.save,officers,{isStaff:true,staffBase:after});game.applyWorldClock(await clock());assert.equal(game.constructionJobs().filter(j=>j.shared).length,1);assert(game.state.resources.gold>=before.gold);assert.equal(game.state.buildings.farm,first.receipt.targetLevel);
});

await scope('cloud save validation accepts sequential chains but rejects gaps, duplicate targets and progressed future work',async c=>{
  const {create,sync,put}=c,p=await create('保存する連続普請'),initial=await sync(p),game=Engine.fromSave(initial.save,officers);assert(game.upgrade('farm').ok);assert(game.upgrade('farm').ok);const good=JSON.parse(game.exportSave()),extra=structuredClone(good);Object.assign(extra.state.jobs[0],{shared:true,queued:true,startsInSeconds:99999,startedBy:{id:'forged'}});const cleaned=await put(p,extra);for(const key of ['shared','queued','startsInSeconds','startedBy'])assert.equal(cleaned.save.state.jobs[0][key],undefined,'Derived shared fields cannot be forged through a personal save');
  const variants=[];let bad=structuredClone(good);bad.state.jobs[1].targetLevel=bad.state.jobs[0].targetLevel;variants.push(bad);bad=structuredClone(good);bad.state.jobs[1].targetLevel++;variants.push(bad);bad=structuredClone(good);bad.state.jobs.reverse();variants.push(bad);bad=structuredClone(good);bad.state.jobs[1].remainingSeconds--;bad.state.jobs[1].remaining=Math.ceil(bad.state.jobs[1].remainingSeconds/60);variants.push(bad);bad=structuredClone(good);bad.state.jobs[1].targetLevel=33;variants.push(bad);
  for(const value of variants)await put(p,value,400);
  const many=structuredClone(good);many.state.buildings.keep=32;many.state.command=7;many.state.jobs=[];
  const ids=globalThis.SENGOKU_DATA.buildings.filter(b=>!b.core).slice(0,6).map(b=>b.id);
  for(const id of ids)for(let target=1;target<=32;target++){const cost=game.costs(id,target-1);many.state.jobs.push({kind:'building',id,targetLevel:target,total:cost.turns,remaining:cost.turns,totalSeconds:cost.seconds,remainingSeconds:cost.seconds});}
  many.state.jobs.push({kind:'research',id:'commerce',targetLevel:1,total:1,remaining:1,totalSeconds:60,remainingSeconds:60});assert.equal(many.state.jobs.length,193);await put(p,many);Engine.fromSave(many,officers);
});

console.log(JSON.stringify({passed:checks.length,localHttpCalls:calls,productionRequests:0}));
