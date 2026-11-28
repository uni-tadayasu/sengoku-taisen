import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {harness} from './test-support.mjs';
import {fixture,post,updateSave,row,save} from './test-court-support.mjs';
import worker from './index.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Local performance checks must not contact production');};
const checks=[];let apiCalls=0;
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{apiCalls+=h.calls;h.close();}}
const ownerKey=t=>[t.playerId,t.targetCastleId,t.homeCastleId,t.name,t.relationship];
const sorted=values=>values.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const minimal=payload=>sorted(payload.targets.map(ownerKey));
const appointOffice=(h,admin,p)=>h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run('chunagon',p.user.id,crypto.randomUUID(),admin.user.id,h.now);
try{
 await scope('compact ownership matches the full public map without battle, save or evaluation work',async h=>{
  const a=await fixture(h,'地図の閲覧者',{startCastle:'inuyama'}),b=await fixture(h,'領地の城主',{startCastle:'kiyosu',holdings:['nijo','osaka','nagoya','azuchi']});
  const [first,second]=[a.user.id,b.user.id].sort();
  h.sql.prepare("INSERT INTO field_relations(user_a,user_b,status,proposed_by,expires_elapsed_ms,updated_elapsed_ms,revision,updated_at) VALUES(?,?,'allied',?,600000,0,1,?)").run(first,second,a.user.id,h.now);
  const full=(await h.api('/field?limit=100',{token:a.token})).data;
  const queries=[];h.beforeStatement=sql=>queries.push(sql);h.beforeBatch=items=>queries.push(...items.map(item=>item.sql));
  const compact=(await h.api('/field?view=owners&limit=100',{token:a.token})).data;
  assert.equal(compact.ownersIncludeTerritories,true);
  assert.deepEqual(minimal(compact),minimal(full));
  assert(!queries.some(sql=>sql.includes('/* player-evaluation */')),'Owner labels never normalize a complete campaign');
  assert(!queries.some(sql=>sql.includes(' AS officer_health_json')||sql.includes(' AS branches_json')),'Owner labels never load defensive state');
  assert(!queries.some(sql=>sql.includes('public-court-office')||sql.includes('public-city-honors')),'Unconsumed decorations do not issue queries');
  assert.doesNotMatch(JSON.stringify(compact),/"(?:isAdmin|isStaff|isDeputy|save|state|defensePower|resources|entitlements)":/);
  assert(compact.targets.some(t=>t.playerId===b.user.id&&t.relationship==='allied'));
  const fullBytes=Buffer.byteLength(JSON.stringify(full)),ownerBytes=Buffer.byteLength(JSON.stringify(compact));
  assert(ownerBytes<fullBytes*.55,{fullBytes,ownerBytes});
  console.log(JSON.stringify({fixturePlayers:2,fullBytes,ownerBytes,bytesReductionPercent:Math.round((1-ownerBytes/fullBytes)*100),ownerQueries:queries.length}));
  h.beforeStatement=null;h.beforeBatch=null;
  const page=(await h.api('/field?view=owners&limit=1',{token:a.token})).data;assert(page.nextCursor);
  const next=(await h.api('/field?view=owners&limit=1&cursor='+page.nextCursor,{token:a.token})).data;
  assert.deepEqual(sorted([...page.targets,...next.targets].map(ownerKey)),minimal(compact));assert.equal(next.nextCursor,null);
  // Role-migration projections must agree without waiting for a save rewrite.
  updateSave(h,b,s=>{s.home='kagoshima';s.castles.kagoshima.owner=s.clan;});
  assert.deepEqual(minimal((await h.api('/field?view=owners&limit=100',{token:a.token})).data),minimal((await h.api('/field?limit=100',{token:a.token})).data));
 });

 await scope('ordinary occupied holdings expose guarded raids in both maps and vanish at the old-cycle boundary',async h=>{
  const a=await fixture(h,'所領の閲覧者',{startCastle:'inuyama'}),b=await fixture(h,'私領の城主',{startCastle:'kiyosu',holdings:['azuchi','nijo']});
  const full=(await h.api('/field?limit=100',{token:a.token})).data,holding=full.targets.find(t=>t.playerId===b.user.id&&t.targetCastleId==='azuchi');
  assert.equal(holding.displayOnly,false);assert.equal(holding.holdingKind,'territory');assert.equal(holding.homeCastleId,'kiyosu');assert.equal(holding.attackable,true);assert.equal(holding.battleMode,'raid');assert.equal(holding.capturable,false);assert(holding.defensePower>0);
  const compact=(await h.api('/field?view=owners&limit=100',{token:a.token})).data;
  assert.deepEqual(minimal(compact),minimal(full));
  assert.equal(compact.targets.find(t=>t.playerId===b.user.id&&t.targetCastleId==='azuchi').holdingKind,'territory');
  assert.equal(compact.targets.find(t=>t.playerId===b.user.id&&t.targetCastleId==='azuchi').defensePower,undefined,'Compact map ownership never computes battle strength');
  assert.equal(full.targets.find(t=>t.playerId===b.user.id&&t.targetCastleId==='nijo').battleMode,'capture');
  const before=row(h,b).save_json;
  h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=40320000,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(h.now);
  const cycled=(await h.api('/field?limit=100',{token:a.token})).data;
  assert(!cycled.targets.some(t=>t.playerId===b.user.id&&['azuchi','nijo'].includes(t.targetCastleId)));
  assert(cycled.targets.some(t=>t.playerId===b.user.id&&t.targetCastleId==='kiyosu'));
  assert.deepEqual(minimal((await h.api('/field?view=owners&limit=100',{token:a.token})).data),minimal(cycled));
  assert.equal(row(h,b).save_json,before,'A field read never settles or rewrites another campaign');
 });

 await scope('many occupied territories share one army profile without changing home or outpost defenses',async h=>{
  const player=await fixture(h,'多数領地の城主',{startCastle:'kiyosu',holdings:['azuchi']});
  updateSave(h,player,s=>{
    s.officers=GAME_OFFICERS.map(officer=>officer.id);
    s.officerVariants=s.officers.flatMap(id=>['D','C','B','A','S','SS','SSS','U'].map(rank=>id+':'+rank));
    s.army=s.officers.slice(0,3);
  });
  const fields=target=>({castleId:target.targetCastleId,defenseTroops:target.defenseTroops,defensePower:target.defensePower,armySummary:target.armySummary,durability:target.durability});
  const before=(await h.api('/field?limit=100',{token:player.token})).data.targets.map(fields);
  updateSave(h,player,s=>{for(const [id,castle] of Object.entries(s.castles))if(!['edo','kyoto_gosho','kagoshima'].includes(id))castle.owner=s.clan;});
  const original=GameEngine.officerCombatFactor;let calls=0;
  GameEngine.officerCombatFactor=function(...args){calls++;return original.apply(this,args);};
  try{
    const expanded=(await h.api('/field?limit=100',{token:player.token})).data.targets;
    assert(expanded.length>=120);
    for(const target of before)assert.deepEqual(fields(expanded.find(row=>row.targetCastleId===target.castleId)),target,'Additional territories cannot change the existing defenses');
    assert.equal(calls,3,'Each of the three officers is evaluated once per player, not once per castle');
    assert(expanded.every(row=>row.armySummary.officerCount===3&&row.armySummary.rankPower===1.5));
    console.log(JSON.stringify({occupiedTargets:expanded.length,armyProfileOfficerEvaluations:calls}));
  }finally{GameEngine.officerCombatFactor=original;}
 });

 await scope('a retainer whose only public outpost expired leaves both the population and owner pagination',async h=>{
  const lord=await fixture(h,'周回を迎える清洲城主',{startCastle:'kiyosu'}),retainer=await fixture(h,'二条を占領した清洲家臣',{startCastle:'kiyosu',holdings:['nijo']});
  const before=(await h.api('/field?limit=100',{token:lord.token})).data;
  assert.equal(before.total,2);assert.equal(new Set(before.targets.map(t=>t.playerId)).size,2);
  assert((await h.api('/field?view=owners&limit=100',{token:lord.token})).data.targets.some(t=>t.playerId===retainer.user.id));
  const stored=row(h,retainer).save_json;
  h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=40320000,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(h.now);
  const after=(await h.api('/field?limit=1',{token:lord.token})).data;
  assert.equal(after.total,1);assert.equal(new Set(after.targets.map(t=>t.playerId)).size,1);assert.equal(after.targets[0].playerId,lord.user.id);assert.equal(after.nextCursor,null);
  const compact=(await h.api('/field?view=owners&limit=1',{token:lord.token})).data;
  assert.deepEqual(minimal(compact),minimal(after));assert.equal(compact.nextCursor,null,'An expired outpost must not occupy an empty later owner page');
  assert.equal(row(h,retainer).save_json,stored,'Read-only expiry never rewrites the former holder save');
 });

 await scope('only the qualified viewer sees their additional Kyoto estate, including a page outside their home row',async h=>{
  const admin=await fixture(h,'地図管理の領主',{admin:true}),member=await fixture(h,'御所に駐在する領主',{staff:true,startCastle:'okazaki'}),minister=await fixture(h,'普請を行う領主',{startCastle:'inuyama'}),other=await fixture(h,'外から見る領主',{startCastle:'kiyosu'});
  appointOffice(h,admin,minister);
  const before=row(h,minister).save_json;
  for(const view of ['', '&view=owners']){
    const self=(await h.api('/field?limit=1'+view,{token:minister.token})).data;
    const estate=self.targets.find(t=>t.playerId===minister.user.id&&t.targetCastleId==='kyoto_gosho');
    assert(estate?.displayOnly);assert.equal(estate.holdingKind,'court-estate');assert.equal(estate.canDevelopCourtEstate,true);assert.equal(estate.homeCastleId,'inuyama');
    const publicView=(await h.api('/field?limit=100'+view,{token:other.token})).data;
    assert(!publicView.targets.some(t=>t.playerId===minister.user.id&&t.targetCastleId==='kyoto_gosho'));
    assert(publicView.targets.some(t=>t.playerId===member.user.id&&t.targetCastleId==='kyoto_gosho'),'Existing Kyoto residences remain public');
    if(self.nextCursor){const later=(await h.api('/field?limit=100'+view+'&cursor='+self.nextCursor,{token:minister.token})).data;assert(!later.targets.some(t=>t.playerId===minister.user.id&&t.holdingKind==='court-estate'));}
  }
  assert.equal(row(h,minister).save_json,before,'The additional shared estate does not relocate the personal home');
  h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(minister.user.id);
  for(const view of ['', '&view=owners'])assert(!(await h.api('/field?limit=100'+view,{token:minister.token})).data.targets.some(t=>t.playerId===minister.user.id&&t.targetCastleId==='kyoto_gosho'));
  appointOffice(h,admin,minister);let revoked=false;
  h.beforeBatch=statements=>{if(!revoked&&statements.some(s=>s.sql.includes('FROM users u LEFT JOIN premium_appearances'))){revoked=true;h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(minister.user.id);}};
  const raced=await h.api('/field?view=owners&limit=100',{token:minister.token,expected:409});assert(revoked);assert.equal(raced.data.error.code,'COURT_ESTATE_ACCESS_CHANGED');
 });

 await scope('a retainer with an appointed office is counted once for their own visible Kyoto estate',async h=>{
  const admin=await fixture(h,'家臣地図の管理者',{admin:true}),lord=await fixture(h,'清洲の先任領主',{startCastle:'kiyosu'}),retainer=await fixture(h,'清洲の任命家臣',{startCastle:'kiyosu'});
  appointOffice(h,admin,retainer);
  const self=(await h.api('/field?limit=100',{token:retainer.token})).data,publicView=(await h.api('/field?limit=100')).data;
  assert(self.targets.some(t=>t.playerId===retainer.user.id&&t.holdingKind==='court-estate'));
  assert.equal(self.total,publicView.total+1);
  assert.equal(new Set(self.targets.map(t=>t.playerId)).size,self.total);
  const page=(await h.api('/field?limit=1',{token:retainer.token})).data;
  assert.equal(page.total,self.total);
  if(page.nextCursor)assert.equal((await h.api('/field?limit=100&cursor='+page.nextCursor,{token:retainer.token})).data.total,self.total);
 });

 await scope('simultaneous audience polls share one maintenance attempt and failed attempts retry immediately',async h=>{
  await h.api('/config');let tickWrites=0,approvalScans=0;
  h.beforeStatement=sql=>{if(sql.includes("VALUES('battleMarchTick'"))tickWrites++;if(sql.includes('SELECT a.right_id FROM shogunate_approvals'))approvalScans++;};
  async function burst(n){const pending=[];const start=performance.now();const result=await Promise.all(Array.from({length:n},()=>worker.fetch(new Request('https://local.invalid/api/v1/world-clock'),h.env,{waitUntil:promise=>pending.push(promise)})));assert(result.every(r=>r.status===200));await Promise.all(pending);return{requests:n,backgroundTasks:pending.length,ms:Math.round(performance.now()-start)};}
  const measured=await burst(100);assert.equal(tickWrites,1);assert.equal(approvalScans,1);assert.equal(measured.backgroundTasks,1);
  h.now+=1000;await burst(20);assert.equal(tickWrites,2);assert.equal(approvalScans,2);
  h.now+=1000;let fail=true;
  h.beforeStatement=sql=>{if(sql.includes("VALUES('battleMarchTick'")){tickWrites++;if(fail){fail=false;throw Error('Local transient tick failure');}}};
  await burst(5);const failedAt=tickWrites;await burst(1);assert.equal(tickWrites,failedAt+1,'A failed maintenance attempt does not fill the cooldown');
  console.log(JSON.stringify({...measured,maintenanceTickWrites:1,approvalScans:1}));
 });
 console.log(JSON.stringify({ok:true,checks:checks.length,apiCalls}));
}finally{globalThis.fetch=originalFetch;}
