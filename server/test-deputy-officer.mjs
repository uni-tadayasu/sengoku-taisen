import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const ID='of_45e0f4cb36ad',VARIANT=ID+':U',STATS=['lead','valor','intellect','politics'];
const post=(actor,body)=>({method:'POST',token:actor.token,body});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const stored=(h,p)=>JSON.parse(row(h,p).save_json);
const read=async(h,p,path)=>(await h.api(path,{token:p?.token})).data;
const snapshot=(h,p)=>read(h,p,'/sync?deviceId='+p.deviceId);
const view=s=>GameEngine.fromSave(s.save,GAME_OFFICERS,{isAdmin:s.user.isAdmin,isStaff:s.user.isStaff,isDeputy:s.user.isDeputy});
async function operator(h){const p=await h.session('島津義久の管理者');await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));return p;}
async function player(h,name,castleId='kiyosu'){
 const p=await h.session(name);p.deviceId='shimazu-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 await h.api('/castles/residency/start',post(p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode:'lord',clan:'織田家',difficulty:'normal'}));return p;
}
async function change(h,admin,p,action='appoint'){
 const current=await read(h,admin,'/admin/deputy');
 return (await h.api('/admin/deputy',post(admin,{targetPlayerId:p.user.id,action,expectedRevision:current.revision,requestId:crypto.randomUUID()}))).data;
}
function tune(h,p,update){const save=stored(h,p);update(save.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(save),p.user.id);}
async function write(h,p,save){const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;return (await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}})).data;}
const commander=(h,p)=>read(h,null,'/players/'+p.user.id+'/profile').then(value=>value.player.commander);
function special(s){const g=view(s),o=g.officer(ID);assert.equal(o.deputyExclusive,true);assert.equal(o.skill,'commander');assert.equal(o.rank,'U');assert.deepEqual(STATS.map(key=>o[key]),[100,100,100,100]);return g;}
let passed=0,calls=0;
async function scenario(name,run){const h=harness();try{await run(h);passed++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Deputy officer fixtures must not contact external services');};
try{
 await scenario('appointment grants the all-100 commander without altering resources or the current formation',async h=>{
  const admin=await operator(h),p=await player(h,'島津就任の領主'),before=stored(h,p).state;
  await change(h,admin,p);const current=await snapshot(h,p),g=special(current);
  assert.equal(current.entitlements.shimazuU,true);assert.equal(current.user.isAdmin,false);assert.equal(current.user.isStaff,false);
  assert.deepEqual(current.save.state.officers,[...new Set([...before.officers,ID])]);
  assert.deepEqual(current.save.state.officerVariants,[...new Set([...before.officerVariants,VARIANT])]);
  for(const key of ['army','resources','magatama','gachaHistory','buildings','tech'])assert.deepEqual(g.state[key],before[key],key);
  const beforeRestore=JSON.parse(g.exportSave()).state;assert.equal(g.restoreDeputyAssets().changed,false);assert.deepEqual(JSON.parse(g.exportSave()).state,beforeRestore);
  const stable=row(h,p);special(await snapshot(h,p));special(await snapshot(h,p));assert.deepEqual(row(h,p),stable);
 });
 await scenario('existing deputies recover a missing copy on reload and persist it exactly once through normal sync',async h=>{
  const admin=await operator(h),p=await player(h,'旧保存から復元');await change(h,admin,p);
  tune(h,p,s=>{s.officers=s.officers.filter(id=>id!==ID);s.officerVariants=s.officerVariants.filter(key=>!key.startsWith(ID+':'));s.army=s.army.filter(id=>id!==ID);delete s.officerHealth.values[ID];delete s.progress.officers[ID];});
  const before=row(h,p),first=await snapshot(h,p),g=special(first);assert.deepEqual(row(h,p),before);
  assert.equal(g.state.officers.filter(id=>id===ID).length,1);assert.equal(g.state.officerVariants.filter(key=>key===VARIANT).length,1);
  const saved=await write(h,p,JSON.parse(g.exportSave()));special(saved);
  const persisted=stored(h,p);assert.equal(persisted.state.officers.filter(id=>id===ID).length,1);assert.equal(persisted.state.officerVariants.filter(key=>key===VARIANT).length,1);
  const repeated=await snapshot(h,p);special(repeated);assert.deepEqual(repeated.save.state,persisted.state);
 });
 await scenario('restoration can assign slot one and the public portrait flag follows the verified serving role',async h=>{
  const admin=await operator(h),p=await player(h,'総大将を配備');await change(h,admin,p);
  const current=await snapshot(h,p),g=special(current),result=g.restoreDeputyAssets({assignCommander:true});assert.equal(result.ok,true);assert.equal(g.state.army[0],ID);
  await write(h,p,JSON.parse(g.exportSave()));
  assert.deepEqual(await commander(h,p),{officerId:ID,name:'島津義久',rank:'U',deputyExclusive:true});
  assert.deepEqual((await read(h,p,'/me')).user.commander,await commander(h,p));
  const before=stored(h,p).state;await change(h,admin,p,'dismiss');const dismissed=await snapshot(h,p),normal=view(dismissed).officer(ID);
  assert.equal(dismissed.user.isDeputy,false);assert.equal(dismissed.entitlements.shimazuU,false);assert.notEqual(normal.deputyExclusive,true);assert(STATS.some(key=>normal[key]!==100));
  assert.deepEqual(dismissed.save.state.officerVariants,before.officerVariants);assert.deepEqual(await commander(h,p),{officerId:ID,name:'島津義久',rank:'U'});
  await change(h,admin,p);special(await snapshot(h,p));assert.equal((await commander(h,p)).deputyExclusive,true);
 });
 await scenario('ordinary U owners and forged save flags never receive the special stats, art entitlement or operator powers',async h=>{
  const admin=await operator(h),deputy=await player(h,'正規のサブ運営'),ordinary=await player(h,'通常版の所有者','inuyama');await change(h,admin,deputy);
  const g=view(await snapshot(h,ordinary));g._grantOfficerVariant(ID,'U');assert.equal(g.assignArmy([ID]).ok,true);
  const forged=JSON.parse(g.exportSave());forged.isDeputy=true;forged.state.isDeputy=true;forged.state.deputyExclusive=true;forged.state.deputyAssets={officerId:ID,rank:'U'};
  const saved=await write(h,ordinary,forged),o=view(saved).officer(ID);
  assert.equal(saved.user.isDeputy,false);assert.equal(saved.entitlements.shimazuU,false);assert.notEqual(o.deputyExclusive,true);assert(STATS.some(key=>o[key]!==100));
  assert.equal(view(saved).restoreDeputyAssets().ok,false);assert.equal(Object.hasOwn(saved.save.state,'deputyExclusive'),false);assert.equal(Object.hasOwn(saved.save.state,'isDeputy'),false);
  assert.deepEqual(await commander(h,ordinary),{officerId:ID,name:'島津義久',rank:'U'});
  await h.api('/admin/deputy',{token:deputy.token,expected:403});await h.api('/admin/deputy',{token:ordinary.token,expected:403});
 });
}finally{globalThis.fetch=originalFetch;}
console.log(`PASS deputy special officer: ${passed} isolated Worker scenarios, ${calls} requests`);
