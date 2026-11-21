import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const payload=(extra={})=>({requestId:crypto.randomUUID(),expectedRevision:1,totalTroops:256123,squadSize:1000,respawnSeconds:120,...extra});
const row=(h,p)=>({...h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id)});
const state=(h,p)=>JSON.parse(row(h,p).save_json).state;
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const deployment=h=>h.sql.prepare('SELECT * FROM roaming_deployment WHERE id=1').get();
let checks=0,calls=0;
async function scope(name,fn){const h=harness();try{await fn(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function roles(h){
 const admin=await h.session('配置を承認する領主');await h.api('/admin/claim',post(admin,{key:h.env.SENGOKU_ADMIN_KEY}));
 const staff=await h.session('配置を申請する領主'),other=await h.session('別の配置担当'),ordinary=await h.session('地図を見る領主');
 for(const p of [staff,other])await h.api('/admin/staff',post(admin,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 return{admin,staff,other,ordinary};
}
async function player(h,name='野外の領主'){
 const p=await h.session(name);p.deviceId='map-device-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,save=h.fresh();
 save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});return p;
}
function unitFor(h,encounterId='road_scouts'){
 const r=deployment(h),d={revision:r.revision,totalTroops:r.total_troops,squadSize:r.squad_size,respawnSeconds:r.respawn_seconds};
 return GameEngine.roamingDeploymentSummary(d).castles.flatMap(c=>GameEngine.roamingDeploymentUnits(d,c.castleId)).find(u=>u.encounterId===encounterId);
}
function battleInput(h,p,u=unitFor(h),extra={}){const r=row(h,p),s=state(h,p);return{deviceId:p.deviceId,expectedRevision:r.revision,campaignId:s.walking.campaignId,sequence:s.roaming.sequence,requestId:crypto.randomUUID(),encounterId:u.encounterId,unitId:u.unitId,castleId:u.castleId,deploymentRevision:u.deploymentRevision,tactic:'balanced',troops:1000,...extra};}
const getManage=(h,p)=>h.api('/staff/roaming',{token:p.token});
const propose=async(h,staff,body=payload())=>(await h.api('/staff/roaming/proposals',post(staff,body))).data;
const act=(h,p,id,action,body={},expected=200)=>h.api('/'+(action==='cancel'?'staff':'admin')+'/roaming/proposals/'+id+'/'+action,post(p,{requestId:crypto.randomUUID(),expectedRevision:1,...body},expected));
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Deployment tests must never use real network');};
try{
 await scope('public deployment and local maps expose exact counts, cooldowns and no management identities',async h=>{
  const {admin,staff,ordinary}=await roles(h),d=(await h.api('/roaming/deployment')).data;
  assert.equal(d.deployment.revision,1);assert.equal(d.deployment.totalTroops,384000);assert.equal(d.deployment.totalSquads,384);assert.equal(d.castles.length,128);
  assert.equal(d.castles.reduce((n,c)=>n+c.squads,0),384);assert.equal(d.castles.reduce((n,c)=>n+c.troops,0),384000);
  const map=(await h.api('/roaming/map?castleId=edo')).data;assert.equal(map.units.length,3);assert(map.units.every(u=>u.castleId==='edo'&&u.available&&u.respawnAt===null));
  for(const source of [d,map]){const json=JSON.stringify(source);for(const hidden of ['requester','isAdmin','isStaff',admin.user.id,staff.user.id])assert(!json.includes(hidden),hidden);}
  await h.api('/roaming/map?castleId=missing',{expected:400});await h.api('/roaming/map',{expected:400});
  await h.api('/staff/roaming',{expected:401});await h.api('/staff/roaming',{token:ordinary.token,expected:403});
  assert.deepEqual((await getManage(h,admin)).data.capabilities,{canApply:true,canApprove:true,canPropose:false});
  assert.deepEqual((await getManage(h,staff)).data.capabilities,{canApply:false,canApprove:false,canPropose:true});
 });
 await scope('admin applies exact total without approval, including a partial last squad and durable replay',async h=>{
  const {admin}=await roles(h),body=payload(),first=(await h.api('/admin/roaming/deployment',post(admin,body))).data;
  assert.equal(first.deployment.revision,2);assert.equal(first.deployment.totalTroops,256123);assert.equal(first.deployment.totalSquads,257);assert.equal(first.receipt.action,'apply');assert.equal(first.receipt.requestId,body.requestId);assert.equal(first.receipt.proposalId,null);assert.equal(count(h,'roaming_deployment_proposals'),0);
  const pub=(await h.api('/roaming/deployment')).data;assert.equal(pub.castles.reduce((n,c)=>n+c.troops,0),256123);
  const map=(await h.api('/roaming/map?castleId=ishikawa')).data;assert(map.units.some(u=>u.troops===123));
  const replay=(await h.api('/admin/roaming/deployment',post(admin,body))).data;assert(replay.idempotent);assert.deepEqual(replay.receipt,first.receipt);assert.equal(replay.deployment.revision,2);
  await h.api('/admin/roaming/deployment',post(admin,{...body,totalTroops:1000},409));assert.equal(deployment(h).revision,2);
 });
 await scope('staff only proposes immutable config; admin approval is required and binds its exact content',async h=>{
  const {admin,staff,other}=await roles(h),body=payload({note:'北から南まで均等配置'}),pending=await propose(h,staff,body),id=pending.proposal.id;
  assert.equal(pending.proposal.status,'pending');assert.equal(pending.proposal.requester.id,staff.user.id);assert.equal(pending.deployment.revision,1);assert.equal(deployment(h).total_troops,384000);
  await h.api('/admin/roaming/deployment',post(staff,body,403));await act(h,staff,id,'approve',{},403);await act(h,other,id,'cancel',{},409);
  assert.equal((await getManage(h,other)).data.proposals.length,0);
  await act(h,admin,id,'approve',{totalTroops:999999},400);assert.equal(deployment(h).revision,1);
  const approved=(await act(h,admin,id,'approve')).data;assert.equal(approved.deployment.totalTroops,body.totalTroops);assert.equal(approved.deployment.squadSize,body.squadSize);assert.equal(approved.deployment.respawnSeconds,body.respawnSeconds);assert.equal(approved.deployment.revision,2);assert.equal(approved.proposal.status,'approved');assert.equal(approved.proposal.appliedRevision,2);
 });
 await scope('cancel and rejection keep deployment unchanged and prevent later approval',async h=>{
  const {admin,staff}=await roles(h),one=(await propose(h,staff)).proposal,two=(await propose(h,staff,payload({totalTroops:5000}))).proposal;
  const rejected=(await act(h,admin,one.id,'reject')).data;assert.equal(rejected.proposal.status,'rejected');assert.equal(rejected.deployment.revision,1);
  const cancelled=(await act(h,staff,two.id,'cancel')).data;assert.equal(cancelled.proposal.status,'cancelled');assert.equal(cancelled.deployment.revision,1);
  await act(h,admin,one.id,'approve',{},409);await act(h,admin,two.id,'approve',{},409);assert.equal(deployment(h).total_troops,384000);
 });
 await scope('strict config validation rejects coercion, excess slots and unknown approval fields',async h=>{
  const {admin,staff}=await roles(h);
  for(const bad of [{totalTroops:-1},{totalTroops:1.5},{totalTroops:'3000'},{totalTroops:20000001},{totalTroops:20000000,squadSize:300},{squadSize:0},{squadSize:299},{squadSize:20001},{respawnSeconds:59},{respawnSeconds:3601},{respawnSeconds:'120'},{expectedRevision:0},{expectedRevision:1.2},{expectedRevision:'1'},{note:'長'.repeat(301)},{approved:true}])await h.api('/admin/roaming/deployment',post(admin,payload(bad),400));
  await h.api('/staff/roaming/proposals',post(admin,payload(),403));await h.api('/admin/roaming/deployment',{method:'POST',body:payload(),expected:401});
  await h.api('/staff/roaming/proposals',post(staff,payload({note:{evil:true}}),400));assert.equal(deployment(h).revision,1);assert.equal(count(h,'roaming_deployment_requests'),0);
 });
 await scope('proposal retransmission retains one immutable proposal and reusing its request ID cannot change it',async h=>{
  const {staff}=await roles(h),body=payload(),first=await propose(h,staff,body),again=await propose(h,staff,body);
  assert(again.idempotent);assert.equal(first.proposal.id,again.proposal.id);assert.equal(count(h,'roaming_deployment_proposals'),1);
  await h.api('/staff/roaming/proposals',post(staff,{...body,note:'差し替え'},409));assert.equal(count(h,'roaming_deployment_requests'),1);
 });
 await scope('new direct configuration supersedes pending proposals and stale reads cannot approve or apply them',async h=>{
  const {admin,staff}=await roles(h),p=(await propose(h,staff)).proposal;
  await h.api('/admin/roaming/deployment',post(admin,payload({totalTroops:128000})));
  assert.equal((await getManage(h,staff)).data.proposals[0].status,'superseded');
  await act(h,admin,p.id,'approve',{},409);await act(h,admin,p.id,'approve',{expectedRevision:2},409);
  await h.api('/staff/roaming/proposals',post(staff,payload(),409));await h.api('/admin/roaming/deployment',post(admin,payload(),409));assert.equal(deployment(h).total_troops,128000);
 });
 await scope('concurrent admin changes have one revision winner and no orphan receipts',async h=>{
  const {admin}=await roles(h),a=payload({totalTroops:1000}),b=payload({totalTroops:2000}),out=await Promise.all([h.api('/admin/roaming/deployment',post(admin,a,null)),h.api('/admin/roaming/deployment',post(admin,b,null))]);
  assert.deepEqual(out.map(r=>r.response.status).sort(),[200,409]);assert.equal(deployment(h).revision,2);assert.equal(count(h,'roaming_deployment_requests'),1);
 });
 await scope('competing approval and rejection resolve once and successful receipt remains replayable',async h=>{
  const {admin,staff}=await roles(h),p=(await propose(h,staff)).proposal,approveBody={requestId:crypto.randomUUID(),expectedRevision:1},rejectBody={requestId:crypto.randomUUID(),expectedRevision:1};
  const out=await Promise.all([act(h,admin,p.id,'approve',approveBody,null),act(h,admin,p.id,'reject',rejectBody,null)]);assert.deepEqual(out.map(r=>r.response.status).sort(),[200,409]);
  const winner=out.find(r=>r.response.status===200).data,body=winner.receipt.action==='approve'?approveBody:rejectBody;
  const replay=(await act(h,admin,p.id,winner.receipt.action,body)).data;assert(replay.idempotent);assert.deepEqual(replay.receipt,winner.receipt);assert.equal(count(h,'roaming_deployment_requests'),2);
 });
 await scope('staff revocation or reappointment invalidates old proposals before approval',async h=>{
  const {admin,staff}=await roles(h),p=(await propose(h,staff)).proposal;
  await h.api('/admin/staff',post(admin,{targetPlayerId:staff.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  await act(h,admin,p.id,'approve',{},409);assert.equal((await getManage(h,admin)).data.proposals[0].status,'superseded');
  await h.api('/admin/staff',post(admin,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));await act(h,admin,p.id,'approve',{},409);assert.equal(deployment(h).revision,1);
 });
 await scope('role and ban changes at commit block proposal creation and approval atomically',async h=>{
  const {admin,staff,ordinary}=await roles(h);let once=true;
  h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('INSERT INTO roaming_deployment_requests'))){once=false;h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id);}};
  await h.api('/staff/roaming/proposals',post(staff,payload(),403));assert.equal(count(h,'roaming_deployment_requests'),0);assert.equal(count(h,'roaming_deployment_proposals'),0);
  h.beforeBatch=null;await h.api('/admin/staff',post(admin,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));const proposal=(await propose(h,staff)).proposal;
  once=true;h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('INSERT INTO roaming_deployment_requests'))){once=false;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(ordinary.user.id);}};
  await act(h,admin,proposal.id,'approve',{},403);assert.equal(deployment(h).revision,1);assert.equal(count(h,'roaming_deployment_requests'),1);
 });
 await scope('requester dismissal in the approval commit window cannot grant its old plan',async h=>{
  const {admin,staff}=await roles(h),p=(await propose(h,staff)).proposal;let once=true;
  h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('INSERT INTO roaming_deployment_requests'))){once=false;h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(staff.user.id);}};
  await act(h,admin,p.id,'approve',{},409);assert.equal(deployment(h).revision,1);assert.equal(count(h,'roaming_deployment_requests'),1);
 });
 await scope('banned requesters cannot propose or be approved, and a mid-commit ban blocks direct apply',async h=>{
  const {admin,staff,ordinary}=await roles(h),p=(await propose(h,staff)).proposal;
  const ban=id=>h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(id,'local fixture',ordinary.user.id,h.now,h.now);
  ban(staff.user.id);await h.api('/staff/roaming/proposals',post(staff,payload(),403));await h.api('/staff/roaming',{token:staff.token,expected:403});await act(h,admin,p.id,'approve',{},409);assert.equal(deployment(h).revision,1);
  let once=true;h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('INSERT INTO roaming_deployment_requests'))){once=false;ban(admin.user.id);}};
  await h.api('/admin/roaming/deployment',post(admin,payload(),403));assert.equal(deployment(h).revision,1);assert.equal(count(h,'roaming_deployment_requests'),1);
 });
 await scope('pending proposal limit is enforced in the committing transaction without replacing existing proposals',async h=>{
  const {staff}=await roles(h);for(let i=0;i<10;i++)await propose(h,staff,payload({totalTroops:1000+i}));
  const denied=await h.api('/staff/roaming/proposals',post(staff,payload(),409));assert.equal(denied.data.error.code,'ROAMING_PROPOSAL_LIMIT');assert.equal(count(h,'roaming_deployment_proposals'),10);assert.equal(count(h,'roaming_deployment_requests'),10);assert.equal(deployment(h).revision,1);
 });
 await scope('lost post-commit approval response is recovered by its original request without reapplying configuration',async h=>{
  const {admin,staff}=await roles(h),p=(await propose(h,staff)).proposal,body={requestId:crypto.randomUUID(),expectedRevision:1};let once=true;
  h.afterBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('UPDATE roaming_deployment SET'))){once=false;throw Error('local fixture dropped response');}};
  await act(h,admin,p.id,'approve',body,500);assert.equal(deployment(h).revision,2);assert.equal(count(h,'roaming_deployment_requests'),2);h.afterBatch=null;
  const recovered=(await act(h,admin,p.id,'approve',body)).data;assert(recovered.idempotent);assert.equal(recovered.receipt.requestId,body.requestId);assert.equal(recovered.receipt.appliedRevision,2);assert.equal(deployment(h).revision,2);
 });
 await scope('deployment write failure rolls back the receipt, revision and proposal together',async h=>{
  const {admin,staff}=await roles(h),p=(await propose(h,staff)).proposal,body={requestId:crypto.randomUUID(),expectedRevision:1};let once=true;
  h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('UPDATE roaming_deployment SET'))){once=false;ss.push(h.db.prepare('UPDATE no_such_deployment_table SET absent=1'));}};
  await act(h,admin,p.id,'approve',body,500);assert.equal(deployment(h).revision,1);assert.equal(count(h,'roaming_deployment_requests'),1);assert.equal((await getManage(h,admin)).data.proposals[0].status,'pending');
  h.beforeBatch=null;assert.equal((await act(h,admin,p.id,'approve',body)).data.idempotent,false);assert.equal(deployment(h).revision,2);
 });
 await scope('a zero deployment removes all map targets and old configuration IDs cannot be used',async h=>{
  const {admin}=await roles(h),p=await player(h),body=battleInput(h,p);
  const applied=(await h.api('/admin/roaming/deployment',post(admin,payload({totalTroops:0})))).data;assert.equal(applied.deployment.totalSquads,0);
  const pub=(await h.api('/roaming/deployment')).data;assert(pub.castles.every(c=>c.squads===0&&c.troops===0));assert.deepEqual((await h.api('/roaming/map?castleId=edo')).data.units,[]);
  await h.api('/roaming/battle',post(p,body,409));assert.equal(count(h,'roaming_battles'),0);
 });
 await scope('map battle uses canonical unit, shares victory cooldown, preserves receipts and allows timed respawn',async h=>{
  const p=await player(h),other=await player(h,'別の戦う領主'),u=unitFor(h),body=battleInput(h,p,u),first=(await h.api('/roaming/battle',post(p,body))).data;
  assert(first.battle.won);assert.equal(first.battle.unitId,u.unitId);assert.equal(first.battle.castleId,u.castleId);assert.equal(first.battle.deploymentRevision,u.deploymentRevision);assert.equal(first.battle.enemyTroops,u.troops);assert.equal(first.battle.respawnAt,h.now+300000);assert.equal(first.save.state.roaming.history[0].respawnAt,first.battle.respawnAt);
  const map=(await h.api('/roaming/map?castleId='+u.castleId)).data;assert.equal(map.units.find(x=>x.unitId===u.unitId).available,false);
  const before=row(h,other).save_json;await h.api('/roaming/battle',post(other,battleInput(h,other,u),409));assert.equal(row(h,other).save_json,before);
  assert((await h.api('/roaming/battle',post(p,body))).data.idempotent);assert.equal(count(h,'roaming_battles'),1);assert.equal(count(h,'roaming_unit_cooldowns'),1);
  h.now+=300000;assert.equal((await h.api('/roaming/map?castleId='+u.castleId)).data.units.find(x=>x.unitId===u.unitId).available,true);
 });
 await scope('two players winning the same unit concurrently can receive only one set of rewards',async h=>{
  const one=await player(h),two=await player(h,'競り合う領主'),u=unitFor(h),before=[row(h,one).save_json,row(h,two).save_json];
  const out=await Promise.all([h.api('/roaming/battle',post(one,battleInput(h,one,u),null)),h.api('/roaming/battle',post(two,battleInput(h,two,u),null))]);assert.deepEqual(out.map(r=>r.response.status).sort(),[200,409]);assert.equal(count(h,'roaming_battles'),1);assert.equal(count(h,'roaming_unit_cooldowns'),1);
  const loser=out[0].response.status===409?0:1;assert.equal(row(h,[one,two][loser]).save_json,before[loser]);
 });
 await scope('defeat leaves a unit available and cannot poison its global cooldown',async h=>{
  const p=await player(h),u=unitFor(h,'ronin_vanguard'),r=(await h.api('/roaming/battle',post(p,battleInput(h,p,u,{troops:300})))).data;
  assert.equal(r.battle.won,false);assert.equal(r.battle.respawnAt,null);assert.equal(count(h,'roaming_unit_cooldowns'),0);assert.equal((await h.api('/roaming/map?castleId='+u.castleId)).data.units.find(x=>x.unitId===u.unitId).available,true);
 });
 await scope('forged unit IDs, castle, type, revision and missing map target fail without debits',async h=>{
  const p=await player(h),body=battleInput(h,p),before=row(h,p).save_json;
  for(const bad of [{unitId:'wild_1_forged_0'},{castleId:'edo'},{encounterId:'ronin_vanguard'},{deploymentRevision:2}])await h.api('/roaming/battle',post(p,{...body,...bad},409));
  for(const bad of [{deploymentRevision:0},{deploymentRevision:'1'},{unitId:null},{castleId:null},{enemyTroops:1}])await h.api('/roaming/battle',post(p,{...body,...bad},400));
  const old={...body};delete old.unitId;delete old.castleId;delete old.deploymentRevision;assert.equal((await h.api('/roaming/battle',post(p,old,400))).data.error.code,'ROAMING_MAP_REQUIRED');
  assert.equal(row(h,p).save_json,before);assert.equal(count(h,'roaming_battles'),0);
 });
 await scope('deployment replacement during battle commit cannot charge a stale map selection',async h=>{
  const p=await player(h),body=battleInput(h,p),before=row(h,p).save_json;let once=true;
  h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('INSERT INTO roaming_battles'))){once=false;h.sql.exec('UPDATE roaming_deployment SET revision=revision+1');}};
  const r=await h.api('/roaming/battle',post(p,body,409));assert.equal(r.data.error.code,'ROAMING_DEPLOYMENT_CHANGED');assert.equal(row(h,p).save_json,before);assert.equal(count(h,'roaming_battles'),0);assert.equal(count(h,'roaming_unit_cooldowns'),0);
 });
 await scope('battle database failure rolls back the unit cooldown and reward as one transaction',async h=>{
  const p=await player(h),body=battleInput(h,p),before=row(h,p).save_json;let once=true;
  h.beforeBatch=ss=>{if(once&&ss.some(s=>s.sql.includes('INSERT INTO roaming_unit_cooldowns'))){once=false;ss.push(h.db.prepare('UPDATE no_such_roaming_map_table SET absent=1'));}};
  await h.api('/roaming/battle',post(p,body,500));assert.equal(row(h,p).save_json,before);assert.equal(count(h,'roaming_battles'),0);assert.equal(count(h,'roaming_unit_cooldowns'),0);h.beforeBatch=null;assert((await h.api('/roaming/battle',post(p,body))).data.battle.won);
 });
 await scope('legacy pre-map receipts remain replayable but cannot authorize a new template-only battle',async h=>{
  const p=await player(h),r=row(h,p),save=JSON.parse(r.save_json),game=GameEngine.fromSave(save,GAME_OFFICERS),body={deviceId:p.deviceId,expectedRevision:r.revision,campaignId:save.state.walking.campaignId,sequence:0,requestId:crypto.randomUUID(),encounterId:'road_scouts',tactic:'balanced',troops:1000},b=game.battleRoaming(body.encounterId,body.tactic,body.troops,body).battle;
  const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([body.campaignId,body.sequence,body.encounterId,body.tactic,body.troops])))).toString('hex');
  h.sql.prepare('INSERT INTO roaming_battles(actor_id,request_id,campaign_id,sequence,request_hash,commit_token,result_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(p.user.id,body.requestId,body.campaignId,0,hash,'legacy-token',JSON.stringify(b),h.now);
  h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(game.exportSave(),p.user.id);
  const before=row(h,p).save_json,reply=(await h.api('/roaming/battle',post(p,body))).data;assert(reply.idempotent);assert.deepEqual(reply.battle,b);assert.equal(row(h,p).save_json,before);assert.equal(count(h,'roaming_unit_cooldowns'),0);
  await h.api('/roaming/battle',post(p,{...body,requestId:crypto.randomUUID(),sequence:1},400));assert.equal(count(h,'roaming_battles'),1);
 });
 console.log(`${checks} national deployment and approval scenarios passed (${calls} local API requests).`);
}finally{globalThis.fetch=originalFetch;}
