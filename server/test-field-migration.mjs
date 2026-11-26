import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

const h=harness(),checks=[],post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const OriginalDate=Date;
// Canonical engine exports and Worker request times share the fixture clock.
globalThis.Date=class extends OriginalDate{constructor(...args){super(...(args.length?args:[h.now]));}static now(){return h.now;}};
const row=p=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const read=p=>JSON.parse(row(p).save_json);
const snapshot=async(p,expected=200)=>(await h.api('/sync?deviceId='+p.deviceId,{token:p.token,expected})).data;
const work=(kind,id,targetLevel)=>({kind,id,targetLevel,total:1,remaining:1,totalSeconds:60,remainingSeconds:33});
async function fixture(name,{home='kiyosu',admin=false}={}){
  const p=await h.session(name);p.deviceId='device-'+p.user.id;if(admin)await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));
  const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,value=h.fresh(),s=value.state;
  s.castles[s.home].owner='在地衆';s.home=home;s.castles[home].owner=s.clan;s.castles[home].level=12;s.buildings.keep=20;s.buildings.gold_mine=3;
  s.army=[s.officers[2],s.officers[0],s.officers[1]];s.governors={gold_mine:s.officers[3]};
  for(const id of ['nijo','osaka','nagoya'])s.castles[id]={owner:s.clan,level:id===home?48:47,wall:7,troops:1500};
  s.castles.edo.level=64;s.castles.sunpu.level=32;
  s.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};s.turn=Math.floor(lease.clock.elapsedMs/60000);s.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  s.jobs=[work('building','gold_mine',4),work('castle','nagoya',48)];
  await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:0,save:value}});return p;
}
function store(p,value){h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(value),p.user.id);}
try{
  const p=await fixture('旧城郭の領主'),canonical=read(p),old=structuredClone(canonical);
  old.state.castles.nijo.level=49;old.state.castles.osaka.level=64;old.state.castles.nagoya.level=63;old.state.jobs.find(j=>j.kind==='castle').targetLevel=64;store(p,old);
  const durable=row(p),loaded=await snapshot(p),expected=structuredClone(old);
  for(const id of ['nijo','osaka','nagoya'])expected.state.castles[id].level=48;
  expected.state.jobs=expected.state.jobs.filter(j=>j.kind!=='castle');
  assert.deepEqual(loaded.save,expected,'only historical 49–64 castle levels and their jobs are migrated');assert.deepEqual(row(p),durable,'reading does not rewrite the durable source or its revision');
  assert.equal(loaded.save.state.castles.edo.level,64);assert.equal(loaded.save.state.castles.sunpu.level,32);
  const publicTargets=(await h.api('/field?limit=100')).data.targets.filter(t=>t.playerId===p.user.id&&['nijo','osaka','nagoya'].includes(t.targetCastleId));assert.equal(publicTargets.length,3);assert(publicTargets.every(t=>t.level===48&&t.keepLevel===32));
  checks.push('legacy levels 49, 63 and 64 read as 48 with all other state preserved');
  h.now+=1000;
  const resaved=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:loaded.revision,save:loaded.save}})).data;
  assert.equal(resaved.save.savedAt,new Date(h.now).toISOString());assert.notEqual(resaved.save.savedAt,expected.savedAt,'A new commit updates the export timestamp');
  assert.deepEqual(resaved.save,{...expected,savedAt:new Date(h.now).toISOString()});assert.deepEqual((await snapshot(p)).save,resaved.save);checks.push('migrated state reuploads unchanged with a new save timestamp and reloads stably');

  const boundary=structuredClone(canonical);boundary.state.castles.nagoya.level=48;boundary.state.jobs.find(j=>j.kind==='castle').targetLevel=49;store(p,boundary);
  const migrated=await snapshot(p);assert.equal(migrated.save.state.castles.nagoya.level,48);assert.deepEqual(migrated.save.state.jobs,boundary.state.jobs.filter(j=>j.kind!=='castle'));assert.equal(row(p).save_json,JSON.stringify(boundary));checks.push('a historical level-48 to 49 job is removed even when its castle is already at the new cap');
  for(const mutate of [
    s=>s.castles.nijo.level=65,
    s=>s.castles.nijo.level=49.5,
    s=>s.castles.kiyosu.level=33,
    s=>s.jobs.find(j=>j.kind==='castle').targetLevel=63,
    s=>{s.castles.nagoya.level=64;s.jobs.find(j=>j.kind==='castle').targetLevel=65;},
    s=>{s.castles.nagoya.level=48;s.jobs.find(j=>j.kind==='castle').targetLevel=49;s.jobs.find(j=>j.kind==='castle').remainingSeconds=-1;},
    s=>{s.castles.nagoya.level=48;s.jobs.find(j=>j.kind==='castle').targetLevel=49;s.castles.nagoya.owner='在地衆';}
  ]){const invalid=structuredClone(canonical);mutate(invalid.state);store(p,invalid);const before=row(p);assert.equal((await snapshot(p,400)).error.code,'INVALID_SAVE');assert.deepEqual(row(p),before);}
  checks.push('invalid levels, skipped targets, ownership and job timing are still rejected before migration');
  store(p,canonical);
  for(const mutate of [s=>s.castles.nijo.level=49,s=>{s.castles.nagoya.level=48;s.jobs.find(j=>j.kind==='castle').targetLevel=49;}]){
    const invalid=structuredClone(canonical);mutate(invalid.state);const before=row(p);const rejected=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:before.revision,save:invalid},expected:400})).data;assert.equal(rejected.error.code,'INVALID_SAVE');assert.deepEqual(row(p),before);
  }
  checks.push('new uploads cannot increase metropolitan castles beyond 48');

  const operator=await fixture('城郭移行の運営',{admin:true}),staff=await fixture('旧本拠のスタッフ',{home:'nijo'});
  await h.api('/admin/staff',post(operator,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));await snapshot(staff);
  const staffBackup=h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id),personal=JSON.parse(staffBackup.save_json),live=read(staff);personal.state.castles.nijo.level=64;live.state.castles.nijo.level=64;
  h.sql.prepare('UPDATE staff_campaign_backups SET save_json=? WHERE user_id=?').run(JSON.stringify(personal),staff.user.id);store(staff,live);
  const originalBackup=h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id),originalRow=row(staff),projected=await snapshot(staff);
  assert.equal(projected.staffBase.personalHome,'nijo');assert.equal(projected.staffBase.personalHomeCastle.level,48);assert.equal(projected.save.state.castles.nijo.level,48);assert.equal(projected.save.state.home,'kyoto_gosho');assert.deepEqual(h.sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id),originalBackup);assert.deepEqual(row(staff),originalRow);
  checks.push('staff personal-home DTO projects legacy 64 as 48 without changing its backup');
  await h.api('/admin/staff',post(operator,{targetPlayerId:staff.user.id,action:'dismiss',requestId:crypto.randomUUID()}));const restored=await snapshot(staff);assert.equal(restored.save.state.home,'nijo');assert.equal(restored.save.state.castles.nijo.level,48);assert.deepEqual(restored.save.state.army,canonical.state.army);assert.deepEqual(restored.save.state.governors,canonical.state.governors);assert.deepEqual(restored.save.state.buildings,canonical.state.buildings);checks.push('staff dismissal preserves development and restores the migrated home safely');
  console.log(JSON.stringify({ok:true,calls:h.calls,checks},null,2));
}finally{globalThis.Date=OriginalDate;h.close();}
