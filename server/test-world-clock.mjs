import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';

// Exercise the real Worker with an SQLite-backed D1 adapter. Transactions are
// synchronous here; Promise.all still interleaves authentication and validation,
// so competing compare-and-swap writes and redemptions reach the same database.
const database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
const journal=JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url),'utf8'));
for(const entry of journal.entries) {
  const migration=readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8');
  for(const sql of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(sql);
}
const db={
  lastError:null,
  prepare(sql){return this.statement(sql,[]);},
  statement(sql,params){
    const execute=()=>{try{return database.prepare(sql).all(...params);}catch(error){db.lastError={sql,error:String(error)};throw error;}};
    return {sql,params,bind(...values){return db.statement(sql,values);},
      async first(){return execute()[0]||null;},
      async all(){return {success:true,results:execute()};},
      async run(){try{const result=database.prepare(sql).run(...params);return {success:true,results:[],meta:{changes:Number(result.changes)}};}catch(error){db.lastError={sql,error:String(error)};throw error;}}
    };
  },
  async batch(statements){
    database.exec('BEGIN IMMEDIATE');
    try{const result=statements.map(s=>({success:true,results:database.prepare(s.sql).all(...s.params)}));database.exec('COMMIT');return result;}
    catch(error){database.exec('ROLLBACK');db.lastError={error:String(error)};throw error;}
  }
};
const env={DB:db,SENGOKU_ADMIN_KEY:crypto.randomUUID()+crypto.randomUUID()};
let clock=1795219200000,calls=0;
const maintenanceByToken=new Map();
const originalNow=Date.now;
Date.now=()=>clock;
const tick=(milliseconds)=>{clock+=milliseconds;};
const base=JSON.parse(readFileSync(new URL('./fixtures/valid-save.json',import.meta.url),'utf8'));
const fresh=()=>structuredClone(base);
const ieyasu='of_b0616adde162';
async function api(path,{method='GET',token,body,expected=200,ip='192.0.2.1',rawBody}={}) {
  // Match the current client envelope using only authority actually returned
  // for this token. rawBody remains available for deliberately old requests.
  if(path==='/sync'&&method==='PUT'&&rawBody===undefined&&body&&!Object.hasOwn(body,'maintenanceRevision')&&maintenanceByToken.has(token))body={...body,maintenanceRevision:maintenanceByToken.get(token).revision};
  const headers={Origin:'http://127.0.0.1:4173','CF-Connecting-IP':ip};
  if(token)headers.Authorization='Bearer '+token;
  if(body!==undefined||rawBody!==undefined)headers['Content-Type']='application/json';
  const request=new Request('https://communications.example/api/v1'+path,{method,headers,body:rawBody??(body===undefined?undefined:JSON.stringify(body))});
  const response=await worker.fetch(request,env,{});
  const text=await response.text(),data=text?JSON.parse(text):null;
  if(token&&data?.maintenanceAuthority)maintenanceByToken.set(token,data.maintenanceAuthority);
  calls++;
  assert.equal(response.status,expected,JSON.stringify({path,expected,status:response.status,data,sqlError:db.lastError}));
  assert.equal(response.headers.get('cache-control'),'no-store');
  return {data,response};
}
const post=(token,body,expected=200)=>({method:'POST',token,body,expected});
const write=(token,deviceId,revision,save,expected=200)=>({method:'PUT',token,body:{deviceId,revision,save},expected});
const session=async name=>(await api('/session',post(null,{name,clan:'織田家'}))).data;
const lease=async (token,deviceId,takeOver=false)=>(await api('/sync/lease',post(token,{deviceId,deviceName:deviceId,takeOver}))).data;
const presence=async (token,deviceId,online)=>(await api('/presence',post(token,{deviceId,deviceName:deviceId,online}))).data;

const getClock=async token=>(await api('/world-clock',{token})).data.clock;
const patchClock=async (token,body,expected=200)=>(await api('/world-clock',{method:'PATCH',token,body,expected})).data;
function anchored(elapsedMs){const save=fresh();save.state.worldClock={id:'world-v1',elapsedMs};save.state.turn=Math.floor(elapsedMs/60000);save.state.realtime.elapsed=(elapsedMs%60000)/1000;return save;}
try {
  const firstRequests=[1,2].map(()=>new Request('https://communications.example/api/v1/world-clock'));
  const firstResponses=await Promise.all(firstRequests.map(request=>worker.fetch(request,env,{})));calls+=2;
  assert(firstResponses.every(r=>r.status===200));
  const first=await firstResponses[0].json(),second=await firstResponses[1].json();assert.deepEqual(first,second);
  assert.equal(first.clock.id,'world-v1');assert.equal(first.clock.elapsedMs,0);assert.equal(first.clock.running,true);assert.equal(first.clock.speed,1);assert.equal(first.clock.revision,0);
  assert.equal(database.prepare('SELECT COUNT(*) AS n FROM world_clock').get().n,1);
  assert.deepEqual((await api('/config')).data.clock,first.clock);
  assert.deepEqual(first.clock.calendar,{startYear:1560,yearsPerCycle:56,monthsPerCycle:672,secondsPerMonth:60,cycle:1,year:1560,month:1});
  await patchClock(null,{running:false,revision:0},401);
  const a=await session('時計の領主A'),b=await session('時計の領主B'),admin=await session('共通時計の運営');
  await patchClock(a.token,{running:false,revision:0},403);
  await api('/admin/claim',post(admin.token,{key:env.SENGOKU_ADMIN_KEY}));
  tick(10000);
  assert.equal((await getClock(a.token)).elapsedMs,10000);assert.deepEqual(await getClock(a.token),await getClock(b.token));
  tick(500000);
  assert.equal((await getClock(b.token)).elapsedMs,510000,'clock advances while no players make requests');
  assert.deepEqual(await getClock(),await getClock(a.token),'guests and accounts observe the same world');
  const sped=(await patchClock(admin.token,{speed:4,revision:0})).clock;
  assert.equal(sped.elapsedMs,510000);assert.equal(sped.revision,1);assert.equal(sped.speed,4);
  tick(1500);assert.equal((await getClock()).elapsedMs,516000);
  const paused=(await patchClock(admin.token,{running:false,revision:1})).clock;assert.equal(paused.elapsedMs,516000);assert.equal(paused.running,false);
  tick(70000);assert.equal((await getClock()).elapsedMs,516000);
  await patchClock(b.token,{running:true,speed:4,revision:2},403);assert.equal((await getClock()).running,false);
  const changedPaused=(await patchClock(admin.token,{speed:2,revision:2})).clock;assert.equal(changedPaused.elapsedMs,516000);assert.equal(changedPaused.running,false);
  tick(5000);assert.equal((await getClock()).elapsedMs,516000);
  const resumed=(await patchClock(admin.token,{running:true,revision:3})).clock;assert.equal(resumed.elapsedMs,516000);
  tick(2000);assert.equal((await getClock()).elapsedMs,520000);
  const stale=await patchClock(admin.token,{speed:1,revision:0},409);assert.equal(stale.error.code,'CLOCK_REVISION_CONFLICT');
  await patchClock(admin.token,{speed:3,revision:4},400);await patchClock(admin.token,{running:'false',revision:4},400);await patchClock(admin.token,{elapsedMs:0,running:true,revision:4},400);await patchClock(admin.token,{revision:4},400);
  const controlRequests=[1,4].map(speed=>new Request('https://communications.example/api/v1/world-clock',{method:'PATCH',headers:{Authorization:'Bearer '+admin.token,'Content-Type':'application/json'},body:JSON.stringify({speed,revision:4})}));
  const controls=await Promise.all(controlRequests.map(request=>worker.fetch(request,env,{})));calls+=controls.length;assert.deepEqual(controls.map(r=>r.status).sort(),[200,409]);
  assert.equal((await getClock()).revision,5);assert.equal((await getClock()).elapsedMs,520000);
  await patchClock(admin.token,{speed:1,running:true,revision:5});
  const cycleMs=672*60000;tick(cycleMs-1-(await getClock()).elapsedMs);
  const last=(await getClock());assert.equal(last.calendar.year,1615);assert.equal(last.calendar.month,12);assert.equal(last.calendar.cycle,1);
  tick(1);const loop=await getClock();assert.equal(loop.elapsedMs,cycleMs);assert.equal(loop.calendar.year,1560);assert.equal(loop.calendar.month,1);assert.equal(loop.calendar.cycle,2);
  assert.equal(loop.elapsedMs,last.elapsedMs+1,'calendar wrapping never resets absolute time');

  const leaseA=await lease(a.token,'a-device');assert.deepEqual(leaseA.clock,await getClock());
  const legacy=(await api('/sync',write(a.token,'a-device',0,fresh()))).data;
  assert.deepEqual(legacy.save.state.worldClock,{id:'world-v1',elapsedMs:cycleMs},'legacy saves attach on their first upload before shared maintenance validation');assert(legacy.clock);
  assert.deepEqual(legacy.save.state.resources,base.state.resources,'attachment does not simulate historical income or upkeep');
  let save=anchored((await getClock()).elapsedMs);save.state.realtime.running=false;save.state.realtime.speed=4;save.state.worldClock.isAdmin=true;
  const saved=(await api('/sync',write(a.token,'a-device',1,save))).data;
  assert.deepEqual(saved.save.state.worldClock,{id:'world-v1',elapsedMs:cycleMs});assert.equal(saved.save.state.realtime.running,true);assert.equal(saved.save.state.realtime.speed,1);
  assert.deepEqual(saved.clock,await getClock());
  const pausedAgain=await patchClock(admin.token,{running:false,speed:4,revision:saved.clock.revision});
  const unchangedSave=(await api('/sync?deviceId=a-device',{token:a.token})).data;
  assert.deepEqual(unchangedSave.save,saved.save,'global clock changes cannot alter saved content at the same revision');
  assert.equal(unchangedSave.revision,saved.revision);assert.equal(unchangedSave.clock.running,false);assert.equal(unchangedSave.clock.speed,4);
  const unchangedLease=await lease(a.token,'a-device');assert.deepEqual(unchangedLease.save,saved.save,'lease snapshots preserve the same save fingerprint');
  await patchClock(admin.token,{running:true,speed:1,revision:pausedAgain.clock.revision});
  const downgrade=await api('/sync',write(a.token,'a-device',2,fresh(),409));assert.equal(downgrade.data.error.code,'CLOCK_ANCHOR_REQUIRED');
  const future=await api('/sync',write(a.token,'a-device',2,anchored(cycleMs+5001),400));assert.equal(future.data.error.code,'CLOCK_AHEAD');
  const mismatched=anchored(cycleMs);mismatched.state.turn++;
  const badTurn=await api('/sync',write(a.token,'a-device',2,mismatched,400));assert.equal(badTurn.data.error.code,'INVALID_CLOCK_ANCHOR');
  const wrongPhase=anchored(cycleMs+100);wrongPhase.state.realtime.elapsed=2;
  await api('/sync',write(a.token,'a-device',2,wrongPhase,400));
  const wrongId=anchored(cycleMs);wrongId.state.worldClock.id='personal-clock';await api('/sync',write(a.token,'a-device',2,wrongId,400));
  const nonInteger=anchored(cycleMs);nonInteger.state.worldClock.elapsedMs+=.5;await api('/sync',write(a.token,'a-device',2,nonInteger,400));
  const persistedA=()=>database.prepare('SELECT save_json,revision FROM player_saves WHERE user_id=?').get(a.user.id),beforeFuture=persistedA();
  const withinTolerance=(await api('/sync',write(a.token,'a-device',2,anchored(cycleMs+5000),409))).data;assert.equal(withinTolerance.error.code,'MAINTENANCE_REFRESH_REQUIRED');
  assert.deepEqual(persistedA(),beforeFuture,'The public clock tolerance cannot advance economic progress beyond its private sealed horizon');
  const currentCheckpoint=(await api('/sync',write(a.token,'a-device',2,anchored(cycleMs)))).data;assert.equal(currentCheckpoint.revision,3);
  const beforeRewind=persistedA(),offlineCheckpoint=(await api('/sync',write(a.token,'a-device',3,anchored(0),409))).data;
  assert.equal(offlineCheckpoint.error.code,'CLOCK_REWIND');assert.deepEqual(persistedA(),beforeRewind,'An old checkpoint cannot replace already settled resources or their time anchor');
  const snapshot=(await api('/sync?deviceId=a-device',{token:a.token})).data;assert.deepEqual(snapshot.clock,await getClock());
  const released=(await api('/sync/release',post(a.token,{deviceId:'a-device'}))).data;assert(released.clock);assert.equal(released.writerDeviceId,null);
  const beforeLarge=await getClock();tick(100002*60000-beforeLarge.elapsedMs);await lease(a.token,'a-device');
  const longSave=anchored(100002*60000);longSave.state.log.unshift({turn:100002,text:'世界の年月は続いています。',kind:'calendar'});longSave.state.treaties['武田家']=100008;longSave.state.scouted[Object.keys(longSave.state.castles)[1]]=100008;
  const longUser=await session('長い年月で初参加');await lease(longUser.token,'long-device');
  const longResult=(await api('/sync',write(longUser.token,'long-device',0,longSave))).data;
  assert.equal(longResult.save.state.turn,100002);assert.equal(longResult.save.state.log[0].turn,100002);assert.equal(longResult.save.state.treaties['武田家'],100008);
  assert.equal(longResult.save.state.worldClock.elapsedMs,100002*60000);
  assert.deepEqual((await api('/config')).data.clock,await getClock());
  console.log(JSON.stringify({ok:true,calls,checks:['atomic singleton initialization','identical public/account clock','elapsed time during disconnection','admin-only global pause/resume/speed','revision compare-and-swap including concurrent controls','rate changes preserve cumulative elapsed time','1560–1615 calendar loop without resetting elapsed','clock in config and every sync response','legacy save migration compatibility','retained validated worldClock checkpoints','server-owned running and speed on writes','stable save content across global control changes','private economic horizon rejects future anchors within public tolerance','consistent turn and fractional phase','atomic rejection of legacy regression','settled checkpoint rollback rejection','turn/log/treaty beyond old 100000 limit']},null,2));
} finally {Date.now=originalNow;database.close();}
