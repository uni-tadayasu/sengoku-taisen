import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import vm from 'node:vm';

// Runs the actual cloud coordinator, game engine and HTTP Worker together.
// By default it uses the server sources shipped beside the game. To inspect the
// canonical Sites checkout before packaging, set SENGOKU_TEST_BACKEND_ROOT.
// No request leaves this process and all player data lives in an in-memory DB.
const require=createRequire(import.meta.url);
const {SengokuEngine:E}=require('../engine.js');
const {create:createWorldClock}=require('../world-clock.js');
const root=fileURLToPath(new URL('..',import.meta.url));
const backend=process.env.SENGOKU_TEST_BACKEND_ROOT||path.join(root,'server');
const workerFile=existsSync(path.join(backend,'worker/index.js'))?path.join(backend,'worker/index.js'):path.join(backend,'index.js');
const {default:worker}=await import(pathToFileURL(workerFile).href);
const rosterScope={window:{}};
vm.runInNewContext(readFileSync(path.join(root,'officers-data.js'),'utf8'),rosterScope);
const roster=JSON.parse(JSON.stringify(rosterScope.window.SENGOKU_OFFICERS));
const IEYASU='of_b0616adde162';

const database=new DatabaseSync(':memory:');
database.exec('PRAGMA foreign_keys=ON');
const journal=JSON.parse(readFileSync(path.join(backend,'drizzle/meta/_journal.json'),'utf8'));
for(const entry of journal.entries){
  const migration=readFileSync(path.join(backend,'drizzle',entry.tag+'.sql'),'utf8');
  for(const sql of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))database.exec(sql);
}
// Same transaction boundaries as scripts/test-sync.mjs in the backend checkout.
const db={
  lastError:null,
  prepare(sql){return this.statement(sql,[]);},
  statement(sql,params){
    const execute=()=>{try{return database.prepare(sql).all(...params);}catch(error){db.lastError={sql,error:String(error)};throw error;}};
    return{sql,params,bind(...values){return db.statement(sql,values);},
      async first(){return execute()[0]||null;},
      async all(){return{success:true,results:execute()};},
      async run(){const result=database.prepare(sql).run(...params);return{success:true,results:[],meta:{changes:Number(result.changes)}};}
    };
  },
  async batch(statements){
    database.exec('BEGIN IMMEDIATE');
    try{const result=statements.map(s=>({success:true,results:database.prepare(s.sql).all(...s.params)}));database.exec('COMMIT');return result;}
    catch(error){database.exec('ROLLBACK');db.lastError={error:String(error)};throw error;}
  }
};
const env={DB:db,SENGOKU_ADMIN_KEY:crypto.randomUUID()+crypto.randomUUID()};
const originalNow=Date.now;
let clock=1795219200000,timerSequence=0;
Date.now=()=>clock;
const timers=new Map(),requests=[],pending=new Set(),devices=[];
const setTimer=(fn,delay=0)=>{const id=++timerSequence;timers.set(id,{fn,at:clock+delay});return id;};
const clearTimer=id=>timers.delete(id);
function memoryStorage(){const values=new Map();return{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const browser={crypto,Date,JSON,Promise,URL,TextEncoder,TextDecoder,
  navigator:{onLine:true,userAgent:'IntegrationTest'},document:{hidden:false,addEventListener(){}},
  localStorage:memoryStorage(),sessionStorage:memoryStorage(),setTimeout:setTimer,clearTimeout:clearTimer,addEventListener(){}};
browser.window=browser;
vm.runInNewContext(readFileSync(path.join(root,'cloud-sync.js'),'utf8'),browser,{filename:'cloud-sync.js'});

async function api(route,{method='GET',token,data}={}){
  const headers={Origin:'http://127.0.0.1:4173','CF-Connecting-IP':'192.0.2.41'};
  if(token)headers.Authorization='Bearer '+token;
  if(data!==undefined)headers['Content-Type']='application/json';
  const response=await worker.fetch(new Request('https://integration.invalid/api/v1'+route,{method,headers,body:data===undefined?undefined:JSON.stringify(data)}),env,{});
  const result=await response.json();
  requests.push({method,route,status:response.status});
  if(!response.ok||result.ok===false){const error=new Error(result.error?.message||'Integration API failure');error.code=result.error?.code;error.status=response.status;throw error;}
  return result;
}
function transport(token){return(route,options={})=>{
  const task=api(route,{method:options.method||'GET',token,data:options.data});
  pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
};}
async function clockTransport(url,options={}){
  const route=new URL(url).pathname.slice('/api/v1'.length);
  const response=await worker.fetch(new Request(url,{...options,headers:{Origin:'http://127.0.0.1:4173'}}),env,{});
  requests.push({method:options.method||'GET',route,status:response.status});return response;
}
async function settle(){while(pending.size)await Promise.allSettled([...pending]);}
const writes=()=>requests.filter(r=>r.method==='PUT'&&r.route==='/sync').length;
const persistedState=device=>JSON.parse(device.persisted).state;
const stateEqual=(a,b,message)=>assert.deepEqual(JSON.parse(JSON.stringify(a)),JSON.parse(JSON.stringify(b)),message);
const makeGame=(options={})=>{const game=new E({officers:roster,seed:17,...options});game.setRunning(false);return game;};

function makeDevice(name,initialGame){
  const device={name,game:initialGame,persisted:initialGame.exportSave(),backups:[],access:{linked:false,ready:true,writable:true},user:null};
  // Each virtual browser has its own monotonic origin, clock client and storage.
  // The coordinator's actual global clock.accept hook is exercised as in the app.
  const monotonicOffset=devices.length*7654321;
  device.worldClock=createWorldClock({base:'https://integration.invalid',offline:false,fetch:clockTransport,now:()=>clock+monotonicOffset,hidden:()=>false,online:()=>true,setTimeout:setTimer,clearTimeout:clearTimer});
  const deviceBrowser={...browser,localStorage:memoryStorage(),sessionStorage:memoryStorage(),SengokuWorldClock:device.worldClock};deviceBrowser.window=deviceBrowser;
  vm.runInNewContext(readFileSync(path.join(root,'cloud-sync.js'),'utf8'),deviceBrowser,{filename:'cloud-sync.js'});
  const bridge={
    getSave:()=>JSON.parse(device.game.exportSave()),
    // Mirrors the app bridge's validated role restoration and durable apply,
    // omitting only DOM painting. It deliberately uses engine.fromSave, whose
    // state insertion order differs from the server's canonical key order.
    setAdminAccess(value){
      const isAdmin=value===true;
      if(isAdmin&&!device.game.isAdmin&&device.access.linked&&!device.access.ready)device.game=E.fromSave(device.persisted,roster,{isAdmin:true});
      return device.game.setAdminAccess(isAdmin);
    },
    setSyncAccess(value){device.access={...value};},
    applyCloudSave(save,meta={}){
      try{
        const candidate=E.fromSave(save,roster,{isAdmin:meta.isAdmin===true});
        if(meta.backup)device.backups.push(device.persisted);
        const stored=candidate.exportSave();device.persisted=stored;device.game=candidate;return{ok:true};
      }catch(error){return{ok:false,message:error.message};}
    }
  };
  device.cloud=deviceBrowser.SengokuCloudSync.create({bridge:()=>bridge,device:{id:'test-'+name,name},now:()=>clock,hidden:()=>false,online:()=>true,setTimeout:setTimer,clearTimeout:clearTimer});
  device.start=async identity=>{device.identity=identity;const result=await device.cloud.start({id:identity.user.id,request:transport(identity.token),onUser:user=>{device.user=user;}});await settle();assert.notEqual(device.cloud.getStatus().reason,'error',device.cloud.getStatus().message);return result;};
  device.persist=()=>{assert(device.cloud.getStatus().writable,'Only the active writer can persist an action');device.persisted=device.game.exportSave();device.cloud.notifySave();};
  devices.push(device);return device;
}
function applyConfirmed(device,{maxSeconds=7200}={}){
  const snapshot=device.worldClock.snapshot();assert(snapshot.ready&&snapshot.clock,'A confirmed clock sample is required');
  assert(Number.isSafeInteger(snapshot.clock.confirmedElapsedMs),'Display interpolation must expose the separately confirmed server time');
  return device.game.applyWorldClock({...snapshot.clock,elapsedMs:snapshot.clock.confirmedElapsedMs},{maxSeconds,deferCycleSettlement:device.access.linked});
}

let checks=0;
async function test(name,run){await run();checks++;console.log('PASS '+name);}
try{
  const alice=await api('/session',{method:'POST',data:{name:'連携統合の領主',clan:'織田家'}});
  const bob=await api('/session',{method:'POST',data:{name:'独立統合の領主',clan:'織田家'}});
  const operator=await api('/session',{method:'POST',data:{name:'運営統合の領主',clan:'織田家'}});
  await api('/admin/claim',{method:'POST',token:operator.token,data:{key:env.SENGOKU_ADMIN_KEY}});
  const a=makeDevice('first',makeGame()),b=makeDevice('second',makeGame({seed:999}));
  // The other account starts from a migrated legacy Edo/U save. It must upload
  // valid ordinary state, not gain privileges or disturb Alice's account.
  const legacy=makeGame({isAdmin:true,startCastle:'edo'});
  legacy.state.castles.edo.level=19;legacy.state.resources.gold=7777;
  // Recreate a pre-3.5 operator save, when the chosen clan could still be Oda.
  // New operator construction now correctly forces 德川家, so it is not itself
  // a legacy fixture. Keep exactly one owned castle while restoring the old shape.
  for(const [id,castle]of Object.entries(legacy.state.castles))if(id==='edo')castle.owner='織田家';else if(castle.owner===legacy.state.clan||castle.owner==='織田家')castle.owner='在地衆';
  legacy.state.clan='織田家';
  const c=makeDevice('other',E.fromSave(legacy.exportSave(),roster));

  await test('first writer uploads once and the second device pulls real engine state',async()=>{
    await a.start(alice);
    assert.equal(a.cloud.getStatus().writable,true);
    assert.equal(a.cloud.getStatus().revision,1);
    assert.equal(writes(),1);
    const remote=await api('/sync',{token:alice.token});
    assert.notEqual(JSON.stringify(remote.save.state),JSON.stringify(E.fromSave(remote.save,roster).state),'Fixture must expose server/engine key-order differences');
    assert.equal(browser.SengokuCloudSync.fingerprint(remote.save),browser.SengokuCloudSync.fingerprint(JSON.parse(a.game.exportSave())));
    await b.start(alice);
    assert.equal(b.cloud.getStatus().writable,false);
    assert.equal(b.cloud.getStatus().revision,1);
    stateEqual(b.game.state,a.game.state);
    stateEqual(persistedState(b),a.game.state);
    assert.equal(b.backups.length,1);
    assert.equal(writes(),1,'Follower pulls must never echo a canonical state back');
  });

  await test('ordinary migrated legacy state syncs under a separate account',async()=>{
    await c.start(bob);
    assert.equal(c.cloud.getStatus().writable,true);
    assert.equal(c.game.isAdmin,false);
    assert.equal(c.game.state.home,'kiyosu');
    assert.equal(c.game.state.castles.kiyosu.level,19);
    assert.equal(c.game.state.castles.edo.owner===c.game.state.clan,false);
    assert(c.game.ownsVariant(IEYASU,'SSS'));
    assert.equal(c.game.ownsVariant(IEYASU,'U'),false);
    const stored=await api('/sync',{token:bob.token});
    stateEqual(stored.save.state,c.game.state);
    assert.equal((await api('/sync',{token:alice.token})).revision,1);
    assert.equal(a.game.state.resources.gold,3200);
  });

  await test('paused unchanged engines do not PUT repeatedly after server canonicalization',async()=>{
    const before=writes();
    for(let i=0;i<6;i++){
      clock+=1000;
      for(const device of [a,b,c])device.cloud.notifySave();
      await Promise.all([a.cloud.refresh(),b.cloud.refresh(),c.cloud.refresh()]);
      await Promise.all([a.cloud.flush(),b.cloud.flush(),c.cloud.flush()]);
    }
    assert.equal(writes(),before,'Object key order and savedAt must not create dirty saves');
    assert.equal(a.cloud.getStatus().revision,1);
    assert.equal(c.cloud.getStatus().revision,1);
  });

  await test('a real gameplay action flushes and its follower preserves the same state',async()=>{
    assert(a.game.upgrade('farm').ok);a.persist();
    assert((await a.cloud.flush()).ok);
    assert.equal(a.cloud.getStatus().revision,2);
    await b.cloud.refresh();
    stateEqual(a.game.state,b.game.state);
    stateEqual(persistedState(b),a.game.state);
    assert.equal(b.game.state.jobs[0].id,'farm');
    assert.equal(c.game.state.resources.gold,7777);
  });

  await test('explicit takeover disables the old writer and reverses update flow',async()=>{
    assert((await b.cloud.takeOver()).ok);
    assert.equal(b.cloud.getStatus().writable,true);
    await a.cloud.refresh();
    assert.equal(a.cloud.getStatus().writable,false);
    assert.equal(a.cloud.getStatus().writerDeviceName,'second');
    assert(b.game.upgrade('market').ok);b.persist();
    assert((await b.cloud.flush()).ok);
    await a.cloud.refresh();
    assert.equal(a.cloud.getStatus().revision,3);
    stateEqual(a.game.state,b.game.state);
    assert.equal(a.game.state.jobs.length,2);
    const remote=await api('/sync',{token:alice.token});
    assert.equal(remote.writerDeviceId,b.cloud.getDevice().id);
    const before=writes();await a.cloud.flush();await b.cloud.refresh();assert.equal(writes(),before);
  });

  const op=makeDevice('operator',makeGame()),phone=makeDevice('operator-phone',makeGame({seed:55}));
  await test('authenticated operator restores U, uses fixed Edo and links a second device',async()=>{
    await op.start(operator);
    assert.equal(op.game.isAdmin,true);
    assert.equal(op.game.state.home,'edo','Authenticated operators have a fixed Edo base');
    assert(op.game.ownsVariant(IEYASU,'U'));
    assert(op.game.selectAdminCastle().ok);op.persist();await op.cloud.flush();
    assert.equal(op.game.state.home,'edo');
    const code=await api('/devices/pair-code',{method:'POST',token:operator.token,data:{}});
    const linked=await api('/devices/link',{method:'POST',data:{code:code.code,deviceName:'統合試験のスマートフォン'}});
    assert.equal(linked.user.id,operator.user.id);
    assert.notEqual(linked.token,operator.token);
    await phone.start(linked);
    assert.equal(phone.game.isAdmin,true);
    assert.equal(phone.game.state.home,'edo');
    assert.equal(phone.game.state.officerVariants.filter(v=>v===IEYASU+':U').length,1);
    stateEqual(phone.game.state,op.game.state);
    assert.equal(phone.cloud.getStatus().writable,false);
    const before=writes();
    await op.cloud.refresh();await phone.cloud.refresh();await op.cloud.flush();
    assert.equal(writes(),before,'Restoring the same entitlement must remain idempotent');
  });

  await test('legacy first uploads join the real shared clock without retroactive production',async()=>{
    assert.equal(b.game.state.worldClock,undefined);assert.equal(c.game.state.worldClock,undefined);
    const beforeB=structuredClone(b.game.state.resources),beforeC=structuredClone(c.game.state.resources),jobs=structuredClone(b.game.state.jobs);
    await b.worldClock.start();await c.worldClock.start();
    assert.equal(b.worldClock.snapshot().clock.confirmedElapsedMs,c.worldClock.snapshot().clock.confirmedElapsedMs);
    assert(applyConfirmed(b).migrated);assert(applyConfirmed(c).migrated);
    stateEqual(b.game.state.resources,beforeB);stateEqual(c.game.state.resources,beforeC);stateEqual(b.game.state.jobs,jobs);
    b.persist();c.persist();assert((await b.cloud.flush()).ok);assert((await c.cloud.flush()).ok);
    await a.cloud.refresh();stateEqual(a.game.state,b.game.state);assert.equal(a.game.state.worldClock.id,'world-v1');
    const remote=await api('/sync',{token:alice.token});stateEqual(remote.save.state,b.game.state);assert.equal(remote.save.state.worldClock.elapsedMs,remote.clock.elapsedMs);
    assert.equal(c.game.ownsVariant(IEYASU,'U'),false);assert.equal(c.game.state.home,'kiyosu');
  });

  await test('operator clock changes preserve queued gameplay and never save interpolated future time',async()=>{
    const authority=(await api('/world-clock')).clock;
    await api('/world-clock',{method:'PATCH',token:operator.token,data:{speed:4,revision:authority.revision}});
    await b.worldClock.refresh();applyConfirmed(b);
    assert(b.game.research('commerce').ok);b.persist();
    const queued=JSON.parse(b.game.exportSave()),beforeBackups=b.backups.length;
    clock+=1000;const running=(await api('/world-clock')).clock;
    await api('/world-clock',{method:'PATCH',token:operator.token,data:{running:false,revision:running.revision}});
    clock+=4000;
    assert(b.worldClock.snapshot().clock.elapsedMs>b.worldClock.snapshot().clock.confirmedElapsedMs+15000,'Fixture must include a speculative speed-four display clock');
    const beforeConfirmed=structuredClone(b.game.state);assert.equal(applyConfirmed(b).changed,false);stateEqual(b.game.state,beforeConfirmed);
    // The GET in refresh observes the changed global controls while the action is
    // still dirty. It must not replace the queued research with the older save.
    assert((await b.cloud.refresh()).ok);assert.equal(b.backups.length,beforeBackups,'Clock controls alone must not trigger a save replacement');
    assert(b.game.state.jobs.some(job=>job.kind==='research'&&job.id==='commerce'),'Queued research survives the operator stop');
    assert.equal(b.game.state.resources.gold,queued.state.resources.gold,'The accepted action is not silently refunded');
    assert(applyConfirmed(b).ok);b.persist();assert((await b.cloud.flush()).ok);
    const stored=await api('/sync',{token:alice.token});assert.equal(stored.save.state.worldClock.elapsedMs,stored.clock.elapsedMs);assert.equal(stored.save.state.realtime.running,false);
    await a.cloud.refresh();stateEqual(a.game.state,b.game.state);assert.equal(a.worldClock.snapshot().clock.confirmedElapsedMs,stored.clock.elapsedMs);
    await c.worldClock.refresh();applyConfirmed(c);c.persist();assert((await c.cloud.flush()).ok);
    assert.equal(c.game.state.turn,b.game.state.turn);assert.equal(c.game.state.realtime.elapsed,b.game.state.realtime.elapsed);
    const paused=structuredClone(b.game.state),before=writes();clock+=6000;await b.worldClock.refresh();assert.equal(applyConfirmed(b).changed,false);b.cloud.notifySave();await b.cloud.flush();stateEqual(b.game.state,paused);assert.equal(writes(),before,'A shared pause must not generate repeated uploads');
  });

  await test('reconnect, takeover and calendar wrap share one confirmed timeline without double production',async()=>{
    const paused=(await api('/world-clock')).clock;
    await api('/world-clock',{method:'PATCH',token:operator.token,data:{speed:1,running:true,revision:paused.revision}});
    const cycleMs=672*60000;clock+=cycleMs-2000-paused.elapsedMs;
    assert((await b.cloud.refresh()).ok);assert.equal(b.worldClock.snapshot().clock.confirmedElapsedMs,cycleMs-2000,'Coordinator sync response refreshes its real clock client');
    let result,batches=0;do{result=applyConfirmed(b);batches++;assert(batches<10);}while(result.pending);
    assert(batches>1||b.game.state.gameOver);b.persist();assert((await b.cloud.flush()).ok);
    await a.cloud.refresh();stateEqual(a.game.state,b.game.state);assert.equal(a.game.calendar().year,1615);assert.equal(a.game.calendar().month,12);
    assert((await a.cloud.takeOver()).ok);await b.cloud.refresh();assert.equal(a.cloud.getStatus().writable,true);assert.equal(b.cloud.getStatus().writable,false);
    const assets={buildings:structuredClone(a.game.state.buildings),officers:[...a.game.state.officerVariants]},previousClock=a.game.state.worldClock.elapsedMs;
    clock+=2000;await a.worldClock.start();assert.equal(a.worldClock.snapshot().clock.confirmedElapsedMs,cycleMs);assert(applyConfirmed(a).ok);
    assert.equal(a.game.state.worldClock.elapsedMs,cycleMs-1);a.persist();assert((await a.cloud.flush()).ok);assert((await a.cloud.refresh({settleCycle:true})).ok);
    assert.equal(a.game.calendar().cycle,2);assert.equal(a.game.calendar().year,1560);assert.equal(a.game.calendar().month,1);assert.equal(a.game.state.worldClock.elapsedMs,previousClock+2000);
    stateEqual(a.game.state.buildings,assets.buildings);stateEqual(a.game.state.officerVariants,assets.officers);assert.equal(a.game.ownedCastles().length,1);
    await b.cloud.refresh();stateEqual(a.game.state,b.game.state);assert.equal(b.worldClock.snapshot().clock.calendar.cycle,2);
    const before=writes(),after=structuredClone(a.game.state);await a.worldClock.refresh();assert.equal(applyConfirmed(a).changed,false);a.cloud.notifySave();await a.cloud.flush();await b.cloud.refresh();stateEqual(a.game.state,after);assert.equal(writes(),before);
  });

  await test('real field raids update both writers and preserve an overwritten defender action as a backup',async()=>{
    // Begin living campaigns at the current common date; no retroactive income
    // is earned by replacing the completed catch-up fixtures above.
    await a.cloud.refresh();await c.cloud.refresh();await op.cloud.refresh();
    a.game=makeGame();c.game=makeGame();
    applyConfirmed(a);applyConfirmed(c);applyConfirmed(op);
    for(const device of [a,c,op]){device.persist();assert((await device.cloud.flush()).ok);}
    const listing=await api('/field?limit=100',{token:alice.token});
    assert.equal(listing.players.length,3,'Only the three actual saved accounts appear');
    assert.equal(listing.players.find(p=>p.playerId===alice.user.id).homeCastleId,'kiyosu');
    assert.equal(listing.players.find(p=>p.playerId===bob.user.id).homeCastleId,'kiyosu','Colocated bases remain separate real accounts');
    const protectedOperator=listing.players.find(p=>p.playerId===operator.user.id);
    assert.equal(protectedOperator.homeCastleId,'edo');assert.equal(protectedOperator.attackable,true);assert.equal(protectedOperator.battleMode,'reward');assert.equal(protectedOperator.capturable,false,'Edo permits reward duels while keeping its owner protected');
    const own=await api('/field/me?deviceId='+a.cloud.getDevice().id,{token:alice.token});
    const follower=await api('/field/me?deviceId='+b.cloud.getDevice().id,{token:alice.token});
    assert.equal(own.attack.ready,true);assert.equal(follower.attack.ready,false,'The follower device cannot command a field raid');
    const beforeA=structuredClone(a.game.state),beforeC=structuredClone(c.game.state);
    const attackerRevision=a.cloud.getStatus().revision,defenderRevision=c.cloud.getStatus().revision,backups=c.backups.length;
    assert(c.game.upgrade('farm').ok);c.persist();
    const queued=JSON.parse(c.persisted);
    const payload={targetPlayerId:bob.user.id,troops:300,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.cloud.getDevice().id,expectedRevision:attackerRevision};
    const result=await api('/field/attack',{method:'POST',token:alice.token,data:payload});
    assert.equal(result.idempotent,false);assert.equal(result.revision,attackerRevision+1);
    assert.equal(result.battle.defenderRevision,defenderRevision+1);
    assert.equal(result.save.state.troops,beforeA.troops-result.battle.attackerLost);
    assert.equal(result.save.state.command,beforeA.command-1);
    assert.equal(result.save.state.resources.rice,beforeA.resources.rice-result.battle.foodCost+result.battle.loot.rice);
    assert.equal(result.save.state.home,beforeA.home);
    await a.cloud.refresh();await c.cloud.refresh();
    const defender=await api('/sync',{token:bob.token});
    stateEqual(a.game.state,result.save.state);stateEqual(c.game.state,defender.save.state);
    assert.equal(c.cloud.getStatus().revision,defenderRevision+1);
    assert.equal(c.backups.length,backups+1,'A raid cannot silently discard a dirty local action');
    stateEqual(JSON.parse(c.backups.at(-1)).state,queued.state);
    assert.equal(c.game.state.jobs.length,beforeC.jobs.length,'The old dirty action must not be replayed over authoritative raid damage');
    assert.equal(c.game.state.troops,beforeC.troops-result.battle.defenderLost.troops);
    assert.equal(c.game.state.castles[c.game.state.home].troops,beforeC.castles[beforeC.home].troops-result.battle.defenderLost.garrison);
    for(const resource of ['gold','rice','wood','stone'])assert.equal(c.game.state.resources[resource],beforeC.resources[resource]-result.battle.loot[resource]);
    stateEqual(c.game.state.officerVariants,beforeC.officerVariants);assert.equal(c.game.state.home,beforeC.home);
    const before=writes();await c.cloud.flush();assert.equal(writes(),before,'A replaced dirty save must not undo the raid on its next flush');
    const replay=await api('/field/attack',{method:'POST',token:alice.token,data:payload});
    assert.equal(replay.idempotent,true);assert.equal(replay.revision,result.revision);stateEqual(replay.battle,result.battle);
    stateEqual((await api('/sync',{token:bob.token})).save.state,defender.save.state);
  });

  await test('mutual field diplomacy preserves game revisions and blocks raids after acceptance',async()=>{
    const revisionA=a.cloud.getStatus().revision,revisionC=c.cloud.getStatus().revision;
    const beforeA=structuredClone(a.game.state),beforeC=structuredClone(c.game.state);
    const proposal={targetPlayerId:bob.user.id,action:'propose',requestId:crypto.randomUUID(),deviceId:a.cloud.getDevice().id,expectedRevision:revisionA};
    const proposed=await api('/field/diplomacy',{method:'POST',token:alice.token,data:proposal});
    assert.equal(proposed.relationship.status,'outgoing');
    const incoming=await api('/field/me?deviceId='+c.cloud.getDevice().id,{token:bob.token});
    assert.equal(incoming.relationships.find(r=>r.targetPlayerId===alice.user.id).status,'incoming');
    const accepted=await api('/field/diplomacy',{method:'POST',token:bob.token,data:{targetPlayerId:alice.user.id,action:'accept',requestId:crypto.randomUUID(),deviceId:c.cloud.getDevice().id,expectedRevision:revisionC}});
    assert.equal(accepted.relationship.status,'allied');
    const listing=await api('/field?limit=100',{token:alice.token}),target=listing.players.find(p=>p.playerId===bob.user.id);
    assert.equal(target.relationship,'allied');assert.equal(target.attackable,false);
    await assert.rejects(api('/field/attack',{method:'POST',token:alice.token,data:{targetPlayerId:bob.user.id,troops:300,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.cloud.getDevice().id,expectedRevision:revisionA}}),error=>error.code==='ALLIED_TARGET');
    await a.cloud.refresh();await c.cloud.refresh();
    assert.equal(a.cloud.getStatus().revision,revisionA);assert.equal(c.cloud.getStatus().revision,revisionC);
    stateEqual(a.game.state,beforeA);stateEqual(c.game.state,beforeC);
  });

  await test('a server-claimed magatama gift survives failed local storage and syncs exactly once after retry',async()=>{
    const before=structuredClone(a.game.state),persisted=a.persisted,revision=a.cloud.getStatus().revision;
    const sent=await api('/admin/mail',{method:'POST',token:operator.token,data:{target:alice.user.id,title:'勾玉の統合確認',body:'ローカル統合テスト専用の便りです。',gift:{gold:25,magatama:900},requestId:crypto.randomUUID()}});
    const payload={mailId:sent.mailId,requestId:crypto.randomUUID()};
    const first=await api('/mail/claim',{method:'POST',token:alice.token,data:payload});
    assert.equal(first.alreadyClaimed,false);assert.equal(first.gift.magatama,900);
    // Run the actual app transaction bridge without DOM. A successful server
    // claim precedes the local save, so retrying the same receipt must recover.
    const app=readFileSync(path.join(root,'app.js'),'utf8'),start=app.indexOf('  function applyDurableGift('),end=app.indexOf('\n  }',start);
    assert(start>=0&&end>start);let storageBlocked=true;
    const scope={game:a.game,state:()=>a.game.state,canMutate:()=>a.cloud.getStatus().writable,saveEnabled:true,syncMessage:()=>'',save:()=>{if(storageBlocked)return false;a.persist();return true;},renderHeader(){},refreshLiveControls(){},preserveInteraction(){},refreshActiveModal(){},render(){},$:()=>null};
    vm.runInNewContext(app.slice(start,end+4),scope,{filename:'app-gift-bridge.js'});
    const failed=scope.applyDurableGift(first.gift,first.receiptId);assert.equal(failed.ok,false);assert.equal(failed.retryable,true);stateEqual(a.game.state,before);assert.equal(a.persisted,persisted);assert.equal(a.cloud.getStatus().revision,revision);
    const retry=await api('/mail/claim',{method:'POST',token:alice.token,data:payload});assert.equal(retry.alreadyClaimed,true);assert.equal(retry.receiptId,first.receiptId);stateEqual(retry.gift,first.gift);
    storageBlocked=false;assert.equal(scope.applyDurableGift(retry.gift,retry.receiptId).ok,true);assert((await a.cloud.flush()).ok);await b.cloud.refresh();
    assert.equal(a.game.state.magatama,before.magatama+900);assert.equal(a.game.state.resources.gold,before.resources.gold+25);assert.equal(a.game.state.giftReceipts.filter(id=>id===first.receiptId).length,1);stateEqual(a.game.state,b.game.state);
    const saved=await api('/sync',{token:alice.token});assert.equal(saved.save.state.magatama,before.magatama+900);assert(saved.save.state.giftReceipts.includes(first.receiptId));
    scope.game=a.game;const after=structuredClone(a.game.state),beforeWrites=writes(),replay=await api('/mail/claim',{method:'POST',token:alice.token,data:payload});assert.equal(scope.applyDurableGift(replay.gift,replay.receiptId).already,true);await a.cloud.flush();assert.equal(writes(),beforeWrites);stateEqual(a.game.state,after);
  });

  await test('a normal poll preserves a dirty writer’s final capture until its own save closes the cycle',async()=>{
    const cycleMs=672*60000,current=(await api('/world-clock')).clock;
    if(!current.running||current.speed!==1)await api('/world-clock',{method:'PATCH',token:operator.token,data:{running:true,speed:1,revision:current.revision}});
    const start=(await api('/world-clock')).clock,boundary=(Math.floor(start.elapsedMs/cycleMs)+1)*cycleMs;
    clock+=boundary-1000-start.elapsedMs;await a.cloud.takeOver();await a.worldClock.refresh();
    a.game=makeGame();applyConfirmed(a);a.game.state.castles.inabayama.owner=a.game.state.clan;a.persist();assert((await a.cloud.flush()).ok);
    a.game.state.castles.odani.owner=a.game.state.clan;a.persist();
    clock+=1000;await a.worldClock.refresh();const result=applyConfirmed(a);assert(result.settlementRequired);a.persist();
    const baseline=a.cloud.getStatus().revision;assert((await a.cloud.refresh()).ok);
    assert.equal(a.game.state.cycle.latestReward.captured,2);assert.equal(a.game.ownedCastles().length,1);assert(a.cloud.getStatus().revision>=baseline+2);
    await b.cloud.refresh();stateEqual(a.game.state,b.game.state);
  });
  await test('an unchanged boundary checkpoint sends an explicit settlement rather than looping forever',async()=>{
    const cycleMs=672*60000,current=(await api('/world-clock')).clock,boundary=(Math.floor(current.elapsedMs/cycleMs)+1)*cycleMs;
    clock+=boundary-1-current.elapsedMs;await a.cloud.refresh();await a.worldClock.refresh();
    a.game=makeGame();applyConfirmed(a);a.persist();assert((await a.cloud.flush()).ok);const beforeWrites=writes();
    clock+=1;await a.worldClock.refresh();const result=applyConfirmed(a);assert(result.settlementRequired);assert.equal(result.changed,false);
    const beforeSettle=requests.filter(r=>r.route==='/sync/settle').length;
    assert((await a.cloud.refresh({settleCycle:true})).ok);assert.equal(writes(),beforeWrites);assert(requests.filter(r=>r.route==='/sync/settle').length>beforeSettle);
    assert.equal(a.game.state.worldClock.elapsedMs,boundary);assert.equal(a.game.state.cycle.index,Math.floor(boundary/cycleMs));
  });

  await settle();
  console.log(JSON.stringify({ok:true,integrationChecks:checks,httpRequests:requests.length,saveWrites:writes(),productionRequests:0},null,2));
}finally{
  for(const device of devices){device.cloud.stop();device.worldClock.stop();}
  await settle();timers.clear();Date.now=originalNow;database.close();
}
