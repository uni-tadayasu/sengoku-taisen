import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import vm from 'node:vm';
import {harness} from './test-support.mjs';
import {GameEngine} from './game-runtime.js';

// API-level adversarial tests: only isolated SQLite fixtures are modified.
// No production accounts, sessions, remote services, or notifications are used.
const ROOT='/shogunate/governance',ACTION=ROOT+'/action',DAY=86400000,CAP=GameEngine.ASSET_CAP;
const TABLES=['shogunate_governance_accounts','shogunate_governance_requests'];
const clone=value=>JSON.parse(JSON.stringify(value));
const post=(p,body,expected=200)=>({method:'POST',token:p?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const state=(h,p)=>save(h,p).state;
const assets=(h,p)=>({...state(h,p).resources,magatama:state(h,p).magatama});
const ledger=h=>Object.fromEntries(TABLES.map(table=>[table,h.sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const requestCount=h=>count(h,'shogunate_governance_requests');
const newId=prefix=>prefix+crypto.randomUUID().replaceAll('-','');
const isActionBatch=statements=>statements.some(s=>s.sql.includes('INSERT INTO shogunate_governance_requests'));
const freeze=h=>h.sql.prepare('UPDATE world_clock SET running=0').run();
const dayOf=now=>new Date(now+4*3600000).toISOString().slice(0,10);
let passed=0,failed=0,calls=0,maxBindings=0,networkCalls=0;
const nativeFetch=globalThis.fetch;
globalThis.fetch=async()=>{networkCalls++;throw Error('Governance tests must not contact remote services');};
const browser={window:{}};
vm.runInNewContext(readFileSync(new URL('../shogunate-governance.js',import.meta.url),'utf8'),browser);
const frontend=browser.window.SengokuShogunateGovernance;

async function scope(name,fn){
 const h=harness();h.now=Date.UTC(2026,10,28,3);
 const originalStatement=h.db.statement.bind(h.db);
 h.db.statement=(sql,params)=>{maxBindings=Math.max(maxBindings,params.length);assert(params.length<=100,'D1 statement exceeds 100 bound parameters');return originalStatement(sql,params);};
 try{await fn(h);passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name);console.error(error);}finally{calls+=h.calls;h.close();}
}
async function lease(h,p){return(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;}
async function player(h,name='幕府政庁の検証',home='kiyosu'){
 const p=await h.session(name);p.deviceId=newId('gov-device-');const l=await lease(h,p),s=h.fresh(home);
 s.state.worldClock={id:l.clock.id,elapsedMs:l.clock.elapsedMs};s.state.turn=Math.floor(l.clock.elapsedMs/60000);s.state.realtime.elapsed=l.clock.elapsedMs%60000/1000;
 Object.assign(s.state.resources,{gold:1000000,rice:1000000,wood:1000000,stone:1000000});s.state.magatama=10000;
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:l.revision,save:s}});
 return p;
}
function grant(h,p,{opened=true,at=h.now-1000,name='織田幕府'}={}){
 const id=newId('sg_');h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at,opened_at,government_name) VALUES(?,?,'event',?,'幕府政庁検証の天下統一',?,?,?)").run(id,p.user.id,newId('event-'),at,opened?at:null,opened?name:null);return id;
}
async function founded(h,name){const p=await player(h,name);p.rightId=grant(h,p);freeze(h);return p;}
async function read(h,p){const result=(await h.api(ROOT,{token:p.token})).data;assert.equal(result.ok,true);return contract(result.governance);}
function contract(g){
 assert(frontend.cleanData(g),'The real browser validator must accept the actual API DTO');
 assert(g&&g.version===1);assert.equal(typeof g.available,'boolean');assert(Number.isSafeInteger(g.serverNow));
 assert.equal(g.calendar.resetHour,5);assert.equal(g.calendar.timeZone,'Asia/Tokyo');assert.match(g.calendar.day,/^\d{4}-\d{2}-\d{2}$/);assert(Number.isSafeInteger(g.calendar.nextResetAt));
 if(!g.available)return g;
 assert(g.government?.id);assert.equal(g.government.rank,'征夷大将軍');assert(Number.isSafeInteger(g.revision));
 assert.deepEqual(g.policies.map(v=>v.id).sort(),['agriculture','balanced','commerce','construction']);
 assert.deepEqual(g.projects.map(v=>v.id).sort(),['academy','granary','roads']);
 assert.deepEqual(g.duties.map(v=>v.id).sort(),['audience','inspection','relief']);
 assert.equal(g.policies.filter(v=>v.selected).length,1);assert.equal(g.policies.find(v=>v.selected).id,g.policyId);
 assert(g.projects.every(v=>v.level>=0&&v.level<=5&&v.maxLevel===5));assert(g.history.length<=30);
 assert(g.renown.points>=0&&g.renown.points<=1500);assert.equal(g.renown.totalLevels,5);assert.equal(g.renown.cap,1500);
 assert.equal(g.renown.level,[0,100,300,700,1500].filter(n=>g.renown.points>=n).length);
 return g;
}
async function body(h,p,kind,targetId,extra={}){const g=await read(h,p);return{kind,targetId,day:g.calendar.day,governanceRevision:g.revision,requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,...extra};}
async function invoke(h,p,b,expected=200){const r=await h.api(ACTION,post(p,b,expected));if(r.response.status===200){assert.equal(r.data.ok,true);assert(r.data.save&&r.data.clock,'Mutations return a complete authoritative sync snapshot');assert(Number.isSafeInteger(r.data.revision));assert.equal(r.data.save.state.magatama,state(h,p).magatama);contract(r.data.governance);}return r;}
async function action(h,p,kind,targetId,expected=200,extra={}){const b=await body(h,p,kind,targetId,extra);return{...await invoke(h,p,b,expected),body:b};}
async function change(h,p,fn){const r=row(h,p),s=JSON.parse(r.save_json);fn(s.state);return(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:r.revision,save:s}})).data;}
function assertDelta(before,after,receipt){for(const key of ['gold','rice','wood','stone','magatama'])assert.equal(after[key],before[key]-(receipt.cost[key]||0)+(receipt.reward[key]||0),'Atomic resource change for '+key);}
function courtSnapshot(h){
 const tables=h.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'court_%' OR name LIKE 'staff_%' OR name='shogunate_palace_control' OR name='deputy_operator_state') ORDER BY name").all();
 return Object.fromEntries(tables.map(({name})=>[name,h.sql.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'" ORDER BY rowid').all()]));
}

try{
await scope('health advertises governance only with its required schema installed',async h=>{
 const health=(await h.api('/health')).data;assert.equal(health.features.shogunateGovernance,true);
 h.sql.exec('DROP TABLE shogunate_governance_requests');await h.api('/health',{expected:503});
});

await scope('authentication and strict body validation reject forged role, grants and unknown inputs',async h=>{
 await h.api(ROOT,{expected:401});await h.api(ACTION,{method:'POST',body:{},expected:401});
 const p=await founded(h),g=await read(h,p);assert.equal(g.available,true);const b=await body(h,p,'duty','audience'),before=ledger(h),original=assets(h,p);
 for(const patch of [{amount:99999999},{isAdmin:true},{rightId:p.rightId},{renown:999999},{targetId:'__proto__'},{kind:'open'},{day:'2026-11-40'},{governanceRevision:-1},{expectedRevision:-1},{deviceId:''}])await invoke(h,p,{...b,...patch},400);
 assert.deepEqual(ledger(h),before);assert.deepEqual(assets(h,p),original);
});

await scope('unopened, pending and another lord’s rights cannot unlock governance',async h=>{
 const p=await player(h),other=await player(h,'別の幕府の将軍','inuyama');grant(h,other);
 let g=await read(h,p);assert.equal(g.available,false);const id=grant(h,p,{opened:false});
 g=await read(h,p);assert.equal(g.available,false);
 await h.api('/shogunate/open',post(p,{rightId:id,requestId:crypto.randomUUID()}));
 g=await read(h,p);assert.equal(g.available,false);assert.equal(g.government,null);
 const denied=await invoke(h,p,{kind:'duty',targetId:'audience',day:dayOf(h.now),governanceRevision:0,deviceId:p.deviceId,expectedRevision:row(h,p).revision,requestId:crypto.randomUUID()},409);
 assert.equal(denied.data.error.code,'SHOGUNATE_REQUIRED');assert.equal(requestCount(h),0);assert.equal((await read(h,other)).available,true);
});

await scope('legacy, imperial-approved and deadline-expired governments unlock without changing roles',async h=>{
 const legacy=await founded(h,'旧来の将軍'),approved=await player(h,'承認後の将軍','inuyama'),expired=await player(h,'期限後の将軍','himeji'),emperor=await h.session('政庁検証の天皇');
 const term=crypto.randomUUID();h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run(emperor.user.id,legacy.user.id,h.now,term);h.sql.prepare('INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,?,?,?,?,?)').run(emperor.user.id,term,crypto.randomUUID(),legacy.user.id,h.now);
 const a=grant(h,approved,{opened:false}),e=grant(h,expired,{opened:false});
 await h.api('/shogunate/open',post(approved,{rightId:a,requestId:crypto.randomUUID()}));await h.api('/shogunate/open',post(expired,{rightId:e,requestId:crypto.randomUUID()}));
 await h.api('/shogunate/approve',post(emperor,{rightId:a,requestId:crypto.randomUUID()}));
 assert((await read(h,legacy)).available);assert((await read(h,approved)).available);assert.equal((await read(h,expired)).available,false);
 h.now+=3*DAY;const g=await read(h,expired);assert(g.available);assert.equal(g.government.id,e);assert.equal(h.sql.prepare('SELECT status FROM shogunate_approvals WHERE right_id=?').get(e).status,'expired');
 const before=courtSnapshot(h);await lease(h,approved);await action(h,approved,'duty','audience');await lease(h,expired);await action(h,expired,'duty','audience');
 assert.deepEqual(courtSnapshot(h),before);assert.equal(count(h,'staff_members'),1);assert.equal(h.sql.prepare('SELECT user_id FROM court_leader').get().user_id,emperor.user.id);
});

await scope('policy selection is meaningful, shared per day, and cannot be changed twice',async h=>{
 const p=await founded(h),initial=await read(h,p);assert.equal(initial.policyId,'balanced');
 const selected=await action(h,p,'policy','agriculture');assert.equal(selected.data.governance.policyId,'agriculture');assert.equal(selected.data.governance.policyChangedToday,true);
 assert.notDeepEqual(selected.data.governance.dailyReward,initial.dailyReward);const before=ledger(h);
 const second=await action(h,p,'policy','commerce',409);assert.equal(second.data.error.code,'GOVERNANCE_POLICY_LIMIT');
 assert.deepEqual(ledger(h),before);const replay=await invoke(h,p,selected.body);assert(replay.data.idempotent);assert.deepEqual(replay.data.receipt,selected.data.receipt);
 h.now=initial.calendar.nextResetAt;await lease(h,p);const next=await action(h,p,'policy','commerce');assert.equal(next.data.governance.policyId,'commerce');assert.notEqual(next.data.governance.calendar.day,initial.calendar.day);
});

await scope('public works spend their displayed costs, raise renown, and improve recurring rewards',async h=>{
 const p=await founded(h),initial=await read(h,p),court=courtSnapshot(h);let previous=initial;
 for(const id of ['granary','roads','academy']){
  const quote=previous.projects.find(v=>v.id===id),before=assets(h,p),result=await action(h,p,'project',id),receipt=result.data.receipt;
  assert.deepEqual(receipt.cost,quote.cost);assertDelta(before,assets(h,p),receipt);assert.equal(result.data.governance.projects.find(v=>v.id===id).level,1);assert.equal(result.data.governance.renown.points,previous.renown.points+20);
  previous=result.data.governance;
 }
 assert.notDeepEqual(previous.dailyReward,initial.dailyReward);assert(previous.milestones.find(v=>v.id==='first_work').eligible);assert(previous.milestones.find(v=>v.id==='all_works').eligible);assert.deepEqual(courtSnapshot(h),court);
 if(process.env.SENGOKU_GOVERNANCE_QA_DTO)writeFileSync(process.env.SENGOKU_GOVERNANCE_QA_DTO,JSON.stringify(previous,null,2));
});

await scope('project maximum and shortages never consume resources or create receipts',async h=>{
 const p=await founded(h);for(let level=1;level<=5;level++){const r=await action(h,p,'project','granary');assert.equal(r.data.governance.projects.find(v=>v.id==='granary').level,level);}
 const before=ledger(h),balance=assets(h,p),over=await action(h,p,'project','granary',409);assert.equal(over.data.error.code,'GOVERNANCE_PROJECT_MAX');assert.deepEqual(ledger(h),before);assert.deepEqual(assets(h,p),balance);
 await change(h,p,s=>{for(const key of ['gold','rice','wood','stone'])s.resources[key]=0;});
 const poor=ledger(h),blocked=await action(h,p,'project','roads',409);assert.equal(blocked.data.error.code,'GOVERNANCE_SHORTAGE');assert.deepEqual(ledger(h),poor);assert.equal((await read(h,p)).projects.find(v=>v.id==='roads').level,0);
 for(const id of ['relief','inspection']){const result=await action(h,p,'duty',id,409);assert.equal(result.data.error.code,'GOVERNANCE_SHORTAGE');}
});

await scope('three duties spend or reward once per dawn and report actual asset deltas',async h=>{
 const p=await founded(h);let g=await read(h,p);for(const id of ['audience','relief','inspection']){
  const duty=g.duties.find(v=>v.id===id),before=assets(h,p),r=await action(h,p,'duty',id);assertDelta(before,assets(h,p),r.data.receipt);assert.deepEqual(r.data.receipt.cost,duty.cost);assert.equal(r.data.receipt.renownGained,id==='audience'?10:15);assert(r.data.governance.duties.find(v=>v.id===id).claimed);g=r.data.governance;
  const original=clone(assets(h,p)),replay=await invoke(h,p,r.body);assert(replay.data.idempotent);assert.deepEqual(replay.data.receipt,r.data.receipt);assert.deepEqual(assets(h,p),original);
  const duplicate=await action(h,p,'duty',id,409);assert.equal(duplicate.data.error.code,'GOVERNANCE_CLAIMED');
 }
 assert.equal(g.renown.points,40);assert.equal(requestCount(h),3);
});

await scope('same request concurrent retries commit once and altered semantic reuse is rejected',async h=>{
 const p=await founded(h),b=await body(h,p,'duty','audience'),before=assets(h,p),results=await Promise.all([invoke(h,p,b,null),invoke(h,p,b,null)]);
 assert(results.some(r=>r.response.status===200));assert(results.every(r=>[200,409].includes(r.response.status)));assert.equal(requestCount(h),1);const accepted=results.find(r=>r.response.status===200).data;
 assertDelta(before,assets(h,p),accepted.receipt);const stable=assets(h,p),replay=await invoke(h,p,{...b,deviceId:'a-different-reader',expectedRevision:0,governanceRevision:0});assert(replay.data.idempotent);assert.deepEqual(replay.data.receipt,accepted.receipt);assert.deepEqual(assets(h,p),stable);
 for(const patch of [{targetId:'relief'},{kind:'project',targetId:'granary'},{day:'2026-11-27'}]){const result=await invoke(h,p,{...b,...patch},409);assert.equal(result.data.error.code,'REQUEST_ID_REUSED');}
});

await scope('different requests racing for one daily duty cannot double credit',async h=>{
 const p=await founded(h),b=await body(h,p,'duty','audience'),before=assets(h,p);
 const results=await Promise.all([invoke(h,p,b,null),invoke(h,p,{...b,requestId:crypto.randomUUID()},null)]);assert.equal(results.filter(r=>r.response.status===200).length,1);assert.equal(requestCount(h),1);assert.equal((await read(h,p)).renown.points,10);assertDelta(before,assets(h,p),results.find(r=>r.response.status===200).data.receipt);
});

await scope('stale writer, save, governance and day preconditions reject without partial changes',async h=>{
 const p=await founded(h),b=await body(h,p,'duty','audience'),before=ledger(h),balance=assets(h,p);
 for(const [patch,code] of [[{deviceId:'not-the-writer'},'LEASE_REQUIRED'],[{expectedRevision:b.expectedRevision-1},'REVISION_CONFLICT'],[{governanceRevision:b.governanceRevision+1},'GOVERNANCE_CHANGED'],[{day:'2026-11-27'},'GOVERNANCE_DAY_CHANGED']]){const r=await invoke(h,p,{...b,...patch},409);assert.equal(r.data.error.code,code);}
 assert.deepEqual(ledger(h),before);assert.deepEqual(assets(h,p),balance);assert.equal(requestCount(h),0);
});

await scope('receipt, save, cost and governance state roll back together on transaction failure',async h=>{
 const p=await founded(h),b=await body(h,p,'project','granary'),before=ledger(h),saved=row(h,p).save_json;
 h.beforeBatch=statements=>{if(isActionBatch(statements))statements.push(h.db.prepare('UPDATE missing_governance_fixture SET n=1'));};
 await invoke(h,p,b,500);assert.deepEqual(ledger(h),before);assert.equal(row(h,p).save_json,saved);h.beforeBatch=null;
 const retry=await invoke(h,p,b);assert.equal(retry.data.governance.projects.find(v=>v.id==='granary').level,1);assert.equal(requestCount(h),1);
});

await scope('role appointment and BAN changes at the final transaction cannot spend or reward',async h=>{
 const operator=await h.session('競合検証の任命者');
 for(const kind of ['role','ban']){
  const p=await founded(h,kind==='role'?'役職変更競合':'停止競合'),b=await body(h,p,'project','granary'),before=ledger(h),original=row(h,p).save_json;
  h.beforeBatch=statements=>{if(!isActionBatch(statements))return;h.beforeBatch=null;if(kind==='role')h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run(p.user.id,operator.user.id,h.now,crypto.randomUUID());else h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(p.user.id,'fixture',operator.user.id,h.now,h.now);};
  const r=await invoke(h,p,b,null);assert([403,409].includes(r.response.status));assert.deepEqual(ledger(h),before);assert.equal(row(h,p).save_json,original);
 }
});

await scope('a newer save arriving before commit cannot be overwritten by governance',async h=>{
 const p=await founded(h),b=await body(h,p,'project','roads'),before=ledger(h);let winner;
 h.beforeBatch=async statements=>{if(!isActionBatch(statements))return;h.beforeBatch=null;await change(h,p,s=>s.resources.gold-=123);winner=row(h,p).save_json;};
 const result=await invoke(h,p,b,409);assert.equal(result.data.error.code,'REVISION_CONFLICT');assert.deepEqual(ledger(h),before);assert.equal(row(h,p).save_json,winner);
});

await scope('a new current government arriving before commit invalidates the stale operation',async h=>{
 const p=await founded(h),b=await body(h,p,'project','roads'),before=ledger(h),saved=row(h,p).save_json;let next;
 h.beforeBatch=statements=>{if(!isActionBatch(statements))return;h.beforeBatch=null;next=grant(h,p,{at:h.now,name:'次代の幕府'});};
 const result=await invoke(h,p,b,409);assert.equal(result.data.error.code,'GOVERNANCE_CHANGED');assert.deepEqual(ledger(h),before);assert.equal(row(h,p).save_json,saved);assert.equal((await read(h,p)).government.id,next);
});

await scope('JST midnight does not reset duties; exactly 05:00 resets them independent of game speed',async h=>{
 const p=await founded(h);h.now=Date.UTC(2026,10,28,14,59,59);await lease(h,p);const first=await action(h,p,'duty','audience'),day=first.data.governance.calendar.day;
 h.now=Date.UTC(2026,10,28,15,0);assert.equal((await read(h,p)).calendar.day,day);assert((await read(h,p)).duties.find(v=>v.id==='audience').claimed);
 h.now=Date.UTC(2026,10,28,19,59,59,999);assert.equal((await read(h,p)).calendar.day,day);assert((await read(h,p)).duties.find(v=>v.id==='audience').claimed);
 h.now++;await lease(h,p);const after=await read(h,p);assert.notEqual(after.calendar.day,day);assert.equal(after.calendar.nextResetAt,h.now+DAY);assert.equal(after.duties.find(v=>v.id==='audience').claimed,false);
 await action(h,p,'duty','audience');assert.equal(requestCount(h),2);assert.equal((await read(h,p)).renown.points,20);
 const retainedDay=(await read(h,p)).calendar.day;h.now-=DAY;const backward=await read(h,p);assert.equal(backward.calendar.day,retainedDay);assert(backward.duties.find(v=>v.id==='audience').claimed);assert.equal(backward.renown.points,20);
});

await scope('old saves, newly founded governments and real relocation preserve governance progress and claims',async h=>{
 const p=await founded(h),old=save(h,p);await action(h,p,'project','granary');await action(h,p,'duty','audience');await action(h,p,'milestone','first_work');const established=await read(h,p);
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:old}});
 let g=await read(h,p);assert.equal(g.renown.points,established.renown.points);assert.equal(g.projects.find(v=>v.id==='granary').level,1);assert(g.duties.find(v=>v.id==='audience').claimed);assert(g.milestones.find(v=>v.id==='first_work').claimed);
 const next=grant(h,p,{at:h.now,name:'新たな幕府'});g=await read(h,p);assert.equal(g.government.id,next);assert.equal(g.renown.points,established.renown.points);await action(h,p,'duty','audience',409);await action(h,p,'milestone','first_work',409);
 const beforeCampaign=state(h,p).walking.campaignId;await h.api('/castles/residency/relocate',post(p,{deviceId:p.deviceId,revision:row(h,p).revision,requestId:crypto.randomUUID(),castleId:'inuyama'}));
 assert.notEqual(state(h,p).walking.campaignId,beforeCampaign);g=await read(h,p);assert.equal(g.renown.points,established.renown.points);assert.equal(g.projects.find(v=>v.id==='granary').level,1);assert(g.duties.find(v=>v.id==='audience').claimed);assert(g.milestones.find(v=>v.id==='first_work').claimed);
});

await scope('milestones require real persistent progress and pay exactly once',async h=>{
 const p=await founded(h),start=await read(h,p);assert.equal(start.milestones.find(v=>v.id==='first_work').eligible,false);
 const premature=await action(h,p,'milestone','first_work',409);assert.equal(premature.data.error.code,'GOVERNANCE_MILESTONE_INCOMPLETE');assert.equal(requestCount(h),0);
 await action(h,p,'project','academy');const before=assets(h,p),claim=await action(h,p,'milestone','first_work');assert.equal(claim.data.receipt.reward.magatama,30);assert.equal(claim.data.receipt.reward.gold,1000);assertDelta(before,assets(h,p),claim.data.receipt);assert(claim.data.governance.milestones.find(v=>v.id==='first_work').claimed);
 await action(h,p,'milestone','first_work',409);const replay=await invoke(h,p,claim.body);assert(replay.data.idempotent);assert.deepEqual(replay.data.receipt,claim.data.receipt);assert.equal(requestCount(h),2);
});

await scope('capped resources retain actual credit in receipts and replays cannot recover discarded overflow',async h=>{
 const p=await founded(h);await change(h,p,s=>{for(const key of ['gold','rice','wood','stone'])s.resources[key]=CAP;s.resources.gold=CAP-2;s.magatama=CAP;});
 const first=await action(h,p,'duty','audience');assert.equal(first.data.receipt.reward.gold,Math.min(2,first.data.receipt.offeredReward.gold||0));assert(first.data.receipt.renownGained>0);
 for(const key of ['rice','wood','stone','magatama'])assert.equal(first.data.receipt.reward[key]||0,0);
 await change(h,p,s=>s.resources.gold-=100);const before=assets(h,p),again=await invoke(h,p,first.body);assert(again.data.idempotent);assert.deepEqual(again.data.receipt,first.data.receipt);assert.deepEqual(assets(h,p),before);
});

await scope('an entirely capped milestone preserves the claim until some actual reward fits',async h=>{
 const p=await founded(h);await action(h,p,'project','granary');await change(h,p,s=>{s.resources.gold=CAP;s.magatama=CAP;});
 const before=ledger(h),blocked=await action(h,p,'milestone','first_work',409);assert.equal(blocked.data.error.code,'GOVERNANCE_REWARD_CAP');assert.deepEqual(ledger(h),before);assert.equal((await read(h,p)).milestones.find(v=>v.id==='first_work').claimed,false);
 await change(h,p,s=>s.resources.gold-=100);const claim=await action(h,p,'milestone','first_work');assert.equal(claim.data.receipt.reward.gold,100);assert.equal(claim.data.receipt.reward.magatama,0);assert(claim.data.governance.milestones.find(v=>v.id==='first_work').claimed);
});

await scope('maximum development and renown stay bounded, leave capped duties unspent, and bound history',async h=>{
 const p=await founded(h);let g;
 for(const id of ['granary','roads','academy'])for(let level=0;level<5;level++)g=(await action(h,p,'project',id)).data.governance;
 assert.equal(g.renown.points,900);assert.equal(g.renown.level,4);assert(g.milestones.find(v=>v.id==='master_works').eligible);
 for(let day=0;day<15;day++){
  if(day){h.now=g.calendar.nextResetAt;await lease(h,p);h.resetRates();}
  for(const id of ['audience','relief','inspection'])g=(await action(h,p,'duty',id)).data.governance;
 }
 assert.equal(g.renown.points,1500);assert.equal(g.renown.level,5);assert.equal(g.renown.nextLevelAt,null);assert.equal(g.history.length,30);assert(g.milestones.find(v=>v.id==='renown_1500').eligible);
 h.now=g.calendar.nextResetAt;await lease(h,p);h.resetRates();const before=assets(h,p),entries=requestCount(h);
 for(const id of ['relief','inspection']){const r=await action(h,p,'duty',id,409);assert.equal(r.data.error.code,'GOVERNANCE_RENOWN_CAP');}
 assert.deepEqual(assets(h,p),before);assert.equal(requestCount(h),entries);
 await change(h,p,s=>{for(const key of ['gold','rice','wood','stone'])s.resources[key]=CAP;s.magatama=CAP;});const capped=await action(h,p,'duty','audience',409);assert.equal(capped.data.error.code,'GOVERNANCE_REWARD_CAP');assert.equal((await read(h,p)).duties.find(v=>v.id==='audience').claimed,false);
});
}finally{globalThis.fetch=nativeFetch;}

console.log(`${passed} governance scenarios passed; ${failed} failed; ${calls} isolated API calls; max ${maxBindings} D1 bindings; ${networkCalls} external requests.`);
assert.equal(networkCalls,0);assert.equal(failed,0,'Governance adversarial scenarios failed');
