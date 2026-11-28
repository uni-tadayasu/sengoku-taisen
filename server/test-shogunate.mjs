import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
// Optionally pass the frontend shogunate.js path to exercise the actual browser
// validators against these API responses, without duplicating their schema.
let frontend=null;
if(process.argv[2]){const source=readFileSync(process.argv[2],'utf8'),context={window:{}};assert(source.includes('global.SengokuShogunate={'));vm.runInNewContext(source.replace('global.SengokuShogunate={','global.__shogunateValidation={cleanData,cleanReceipt};global.SengokuShogunate={'),context);frontend=context.window.__shogunateValidation;}
function assertContract(value,receipt=null,record=null){
 assert(value.rights.length<=100);assert.equal(new Set(value.rights.map(r=>r.id)).size,value.rights.length);
 if(value.current)assert.deepEqual(value.rights.find(r=>r.id===value.current.id),value.current);
 if(receipt){const right=value.rights.find(r=>r.id===record.rightId);assert(right);assert.equal(receipt.rightId,right.id);if(receipt.status==='pending'){assert.equal(receipt.requestedAt,right.requestedAt);assert.equal(receipt.deadlineAt,right.deadlineAt);}else assert.equal(receipt.openedAt,right.openedAt);assert.equal(receipt.governmentName,right.governmentName);assert.equal(receipt.title,right.title);}
 if(frontend){const cleaned=frontend.cleanData(value);assert(cleaned,'The actual frontend must accept the shogunate DTO');if(receipt)assert(frontend.cleanReceipt(receipt,record,cleaned),'The actual frontend must accept the opening receipt');}
 return value;
}
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id),post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
let count=0,calls=0;
async function scope(name,fn){const h=harness();try{await fn(h);count++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function player(h,name='幕府の検証',home='kiyosu'){const p=await h.session(name);p.deviceId='sg-device-'+p.user.id;const l=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,s=h.fresh(home);s.state.worldClock={id:l.clock.id,elapsedMs:l.clock.elapsedMs};s.state.turn=Math.floor(l.clock.elapsedMs/60000);s.state.realtime.elapsed=l.clock.elapsedMs%60000/1000;await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:l.revision,save:s}});return p;}
async function change(h,p,fn,expected=200,deviceId=p.deviceId){const r=row(h,p),s=JSON.parse(r.save_json);fn(s.state);return h.api('/sync',{method:'PUT',token:p.token,body:{deviceId,revision:r.revision,save:s},expected});}
async function unify(h,p){return change(h,p,s=>{for(const [id,c] of Object.entries(s.castles))if(!['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(id))c.owner=s.clan;s.won=false;});}
const view=async(h,p)=>assertContract((await h.api('/shogunate',{token:p.token})).data.shogunate);
async function approveRight(h,applicant,rightId){
 if(!h.emperor){h.emperor=await h.session('承認を行う天皇');const term=crypto.randomUUID();h.sql.prepare('INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id) VALUES(?,?,?,?)').run(h.emperor.user.id,applicant.user.id,h.now,term);h.sql.prepare('INSERT INTO court_leader(id,user_id,term_id,appointment_token,appointed_by,updated_at) VALUES(1,?,?,?,?,?)').run(h.emperor.user.id,term,crypto.randomUUID(),applicant.user.id,h.now);}
 await h.api('/shogunate/approve',post(h.emperor,{rightId,requestId:crypto.randomUUID()}));
 return view(h,applicant);
}
async function forceFieldWin(run){const original=crypto.getRandomValues;crypto.getRandomValues=function(value){return value instanceof Uint32Array&&value.length===1?value.fill(0):original.call(crypto,value);};try{return await run();}finally{crypto.getRandomValues=original;}}
async function lastFieldCastle(h){
 const attacker=await player(h,'最後の城を攻める領主'),defender=await player(h,'最後の城を守る領主','inuyama');
 await change(h,attacker,s=>{for(const [id,c]of Object.entries(s.castles))if(!['edo','kyoto_gosho','kagoshima','sento_gosho','osaka'].includes(id))c.owner=s.clan;s.resources.rice=50000;s.troops=10000;s.command=3;});
 await change(h,defender,s=>{s.castles.osaka={owner:s.clan,troops:10,wall:1,level:1};});
 h.sql.prepare('UPDATE pvp_protection SET ended_at=?,revision=revision+1').run(h.now);
 const body={requestId:crypto.randomUUID(),deviceId:attacker.deviceId,expectedRevision:row(h,attacker).revision,targetPlayerId:defender.user.id,targetCastleId:'osaka',troops:1000,tactic:'balanced'};
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,0);
 return{attacker,defender,body};
}
await scope('unauthenticated requests fail and invented flags cannot grant rights',async h=>{await h.api('/shogunate',{expected:401});const p=await player(h);await change(h,p,s=>{s.shogunate={earned:true};s.won=true;});const v=await view(h,p);assert.equal(v.rights.length,0);assert.equal(v.campaign.target,126);assert(!v.campaign.achieved);await h.api('/shogunate/open',post(p,{rightId:'sg_'+'1'.repeat(32),requestId:crypto.randomUUID()},409));});
await scope('all eligible holdings grant once regardless of the imported won flag',async h=>{const p=await player(h);await unify(h,p);let v=await view(h,p);assert(v.campaign.achieved);assert.equal(v.rights.length,1);assert.equal(v.rights[0].sourceType,'campaign');assert.equal(v.rights[0].openedAt,null);await change(h,p,s=>s.resources.gold++);v=await view(h,p);assert.equal(v.rights.length,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,1);});
await scope('the last missing eligible castle prevents a grant; reserved castles are excluded',async h=>{const p=await player(h);await change(h,p,s=>{for(const [id,c] of Object.entries(s.castles))if(!['edo','kyoto_gosho','kagoshima','sento_gosho','osaka'].includes(id))c.owner=s.clan;});assert.equal((await view(h,p)).rights.length,0);await change(h,p,s=>s.castles.osaka.owner=s.clan);assert.equal((await view(h,p)).rights.length,1);});
await scope('opening records title once, retries preserve receipt, other users cannot spend it',async h=>{const p=await player(h),other=await player(h,'別の領主');await unify(h,p);const r=(await view(h,p)).rights[0],b={rightId:r.id,requestId:crypto.randomUUID()};await h.api('/shogunate/open',post(other,b,409));const before=row(h,p).save_json,first=(await h.api('/shogunate/open',post(p,b))).data;assert.equal(first.receipt.rank,null);assert.equal(first.receipt.status,'pending');assert.equal(first.shogunate.current,null);assert.equal(first.shogunate.rights[0].governmentName,'織田幕府');assert.equal(row(h,p).save_json,before,'opening does not change campaign resources');const retry=(await h.api('/shogunate/open',post(p,b))).data;assert(retry.idempotent);assert.deepEqual(retry.receipt,first.receipt);await h.api('/shogunate/open',post(p,{...b,requestId:crypto.randomUUID()},409));await h.api('/shogunate/open',post(p,{...b,rightId:'sg_'+'2'.repeat(32)},409));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_requests').get().n,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM staff_members').get().n,0);});
await scope('old saves cannot erase or reopen an achieved government',async h=>{const p=await player(h),old=JSON.parse(row(h,p).save_json);await unify(h,p);const right=(await view(h,p)).rights[0];await h.api('/shogunate/open',post(p,{rightId:right.id,requestId:crypto.randomUUID()}));await approveRight(h,p,right.id);await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:old}});const v=await view(h,p);assert.equal(v.rights.length,1);assert(v.current.openedAt);assert(!v.campaign.achieved);});
await scope('concurrent opening yields a single accepted title and record',async h=>{const p=await player(h);await unify(h,p);const right=(await view(h,p)).rights[0],answers=await Promise.all([1,2].map(()=>h.api('/shogunate/open',post(p,{rightId:right.id,requestId:crypto.randomUUID()},null))));assert.equal(answers.filter(r=>r.response.status===200).length,1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_requests').get().n,1);});
await scope('an opening transaction failure rolls back its receipt and right together',async h=>{const p=await player(h);await unify(h,p);const right=(await view(h,p)).rights[0],b={rightId:right.id,requestId:crypto.randomUUID()};h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO shogunate_requests')))statements.push(h.db.prepare('UPDATE absent_shogunate SET x=1'));};await h.api('/shogunate/open',post(p,b,500));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_requests').get().n,0);assert.equal(h.sql.prepare('SELECT opened_at FROM shogunate_rights').get().opened_at,null);h.beforeBatch=null;await h.api('/shogunate/open',post(p,b));});
await scope('stale writers cannot grant campaign rights and failed sync rolls back both',async h=>{const p=await player(h),fill=s=>{for(const [id,c] of Object.entries(s.castles))if(!['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(id))c.owner=s.clan;};await change(h,p,fill,409,'other-device');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,0);h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO shogunate_rights')))statements.push(h.db.prepare('UPDATE absent_grant SET x=1'));};const old=row(h,p).save_json;await change(h,p,fill,500);assert.equal(row(h,p).save_json,old);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,0);});
await scope('shared conquest full ownership rewards active guild contributors once',async h=>{
 h.now=Date.parse('2026-11-21T03:00:00Z');const a=await h.session('統一攻撃役'),b=await h.session('統一支援役'),idle=await h.session('統一待機役'),g=(await h.api('/guild',post(a,{name:'統一同盟'}))).data.guild;
 for(const p of [b,idle])await h.api('/guild/join',post(p,{guildId:g.id}));let d=(await h.api('/conquest',{token:a.token})).data;
 for(const p of [a,b,idle])await h.api('/conquest/join',post(p,{seasonId:d.season.id,requestId:crypto.randomUUID()}));d=(await h.api('/conquest',{token:a.token})).data;
 const target=d.castles.find(c=>c.neighbors?.length)||d.castles.find(c=>c.id==='osaka'),meta=globalThis.SENGOKU_DATA.castles.find(c=>c.id===target.id),source=meta.neighbors[0];
 h.sql.prepare('UPDATE conquest_castles SET owner_guild_id=?,stock=5000,protected_until=0 WHERE season_id=? AND castle_id<>?').run(g.id,d.season.id,target.id);
 h.sql.prepare('UPDATE conquest_members SET actions=1,transport_points=10 WHERE user_id=? AND season_id=?').run(b.user.id,d.season.id);
 assert.equal((await view(h,a)).rights.length,0);d=(await h.api('/conquest',{token:a.token})).data;const c=d.castles.find(c=>c.id===target.id),s=d.castles.find(c=>c.id===source),body={seasonId:d.season.id,requestId:crypto.randomUUID(),action:'attack',castleId:c.id,fromCastleId:s.id,troops:6000,tactic:'assault',expectedGuildRevision:d.guild.revision,expectedCastleRevision:c.revision,expectedSourceRevision:s.revision};
 const departure=(await h.api('/conquest/action',post(a,body))).data;assert(departure.marching);assert.equal((await view(h,a)).rights.length,0);h.now+=departure.march.durationMs;await h.api('/conquest',{token:a.token});const first=(await h.api('/conquest/action',post(a,body))).data;assert(first.result.battle.won);assert.equal((await view(h,a)).rights.length,1);assert.equal((await view(h,b)).rights.length,1);assert.equal((await view(h,idle)).rights.length,0);await h.api('/conquest/action',post(a,body));assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,2);
});
await scope('a decisive field capture records its right before an immediate cycle settlement and replays once',async h=>{
 const {attacker,body}=await lastFieldCastle(h),before=JSON.parse(row(h,attacker).save_json).state;
 h.afterBatch=async statements=>{
  if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.afterBatch=null;
  const earned=h.sql.prepare('SELECT * FROM shogunate_rights WHERE user_id=?').all(attacker.user.id);assert.equal(earned.length,1,'The capture commit itself must persist the right');assert.equal(earned[0].source_id,before.walking.campaignId+':'+before.cycle.index);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run((before.cycle.index+1)*672*60000,h.now);
  await h.api('/sync/settle',post(attacker,{deviceId:attacker.deviceId,revision:row(h,attacker).revision}));
 };
 const departure=(await forceFieldWin(()=>h.api('/field/attack',post(attacker,body)))).data;assert(departure.marching);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,0);h.now+=departure.march.durationMs;await h.api('/sync/lease',post(attacker,{deviceId:attacker.deviceId}));const arrived=(await h.api('/marches?deviceId='+attacker.deviceId,{token:attacker.token})).data,first={...arrived,battle:arrived.history[0].battle};assert(first.battle.capture.captured);assert.equal(first.save.state.cycle.index,before.cycle.index+1);
 const replay=(await h.api('/field/attack',post(attacker,body))).data;assert(replay.idempotent);assert.equal(replay.battle.id,first.battle.id);
 const current=await view(h,attacker);assert.equal(current.rights.length,2);assert.equal(current.campaign.achieved,true);assert.deepEqual(new Set(current.rights.map(right=>right.sourceId)),new Set([before.walking.campaignId+':'+before.cycle.index,before.walking.campaignId+':'+(before.cycle.index+1)]));assert.equal((await view(h,attacker)).rights.length,2,'the protected next cycle grants its own existing right once');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM field_requests').get().n,1);
});
await scope('field victory and campaign right roll back together if any arrival statement fails',async h=>{
 const {attacker,defender,body}=await lastFieldCastle(h),departure=(await forceFieldWin(()=>h.api('/field/attack',post(attacker,body)))).data,beforeA=row(h,attacker).save_json,beforeD=row(h,defender).save_json;
 h.now+=departure.march.durationMs;
 h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;assert(statements.some(s=>s.sql.includes('INSERT INTO shogunate_rights')));h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_field_shogunate SET value=1'));};
 const pending=(await h.api('/marches',{token:attacker.token})).data;assert.equal(pending.active.length,1);assert.equal(row(h,attacker).save_json,beforeA);assert.equal(row(h,defender).save_json,beforeD);
 for(const table of ['field_requests','field_battles','shogunate_rights'])assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 const done=(await h.api('/marches',{token:attacker.token})).data;assert.equal(done.history[0].status,'resolved');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_rights').get().n,1);
});
await scope('a changed field revision or runtime role cannot admit an arrival victory or grant its right',async h=>{
 const {attacker,defender,body}=await lastFieldCastle(h),departure=(await forceFieldWin(()=>h.api('/field/attack',post(attacker,body)))).data,beforeA=row(h,attacker).save_json,beforeD=row(h,defender).save_json;h.now+=departure.march.durationMs;
 for(const mutate of [()=>h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(attacker.user.id),()=>h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(attacker.user.id,h.now)]){
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO field_requests')))return;h.beforeBatch=null;mutate();};
  const pending=(await h.api('/marches',{token:attacker.token})).data;assert.equal(pending.active.length,1);assert.equal(row(h,attacker).save_json,beforeA);assert.equal(row(h,defender).save_json,beforeD);
  for(const table of ['field_requests','field_battles','shogunate_rights'])assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }
});
await scope('simultaneous request id reuse for different governments returns a conflict after commit',async h=>{
 const p=await player(h);await unify(h,p);const first=(await view(h,p)).rights[0],second='sg_'+crypto.randomUUID().replaceAll('-',''),requestId=crypto.randomUUID();
 h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event','event-concurrent-right','別の天下統一',?)").run(second,p.user.id,h.now);
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO shogunate_requests')))return;h.beforeBatch=null;await h.api('/shogunate/open',post(p,{rightId:second,requestId}));};
 const rejected=await h.api('/shogunate/open',post(p,{rightId:first.id,requestId},409));assert.equal(rejected.data.error.code,'REQUEST_ID_REUSED');assert.equal(h.sql.prepare('SELECT opened_at FROM shogunate_rights WHERE id=?').get(first.id).opened_at,null);assert.equal(h.sql.prepare('SELECT status FROM shogunate_approvals WHERE right_id=?').get(second).status,'pending');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM shogunate_requests').get().n,1);
});
await scope('an established government remains current beyond the latest one hundred rights',async h=>{
 const p=await player(h);await unify(h,p);const right=(await view(h,p)).rights[0];await h.api('/shogunate/open',post(p,{rightId:right.id,requestId:crypto.randomUUID()}));await approveRight(h,p,right.id);
 const insert=h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event',?,'後の天下統一',?)");
 for(let n=0;n<101;n++)insert.run('sg_'+crypto.randomUUID().replaceAll('-',''),p.user.id,'later-event-'+n,h.now+n+1);
 const current=await view(h,p);assert.equal(current.rights.length,100);assert.equal(current.rights[0].sourceId,'later-event-100');assert.equal(current.rights.at(-1).id,right.id);assert.equal(current.current.id,right.id);assert.equal(current.current.rank,'征夷大将軍');
});
await scope('opening and replay pin their requested right alongside current within the frontend limit',async h=>{
 const p=await player(h);await unify(h,p);const original=(await view(h,p)).rights[0],oldRequest={rightId:original.id,requestId:crypto.randomUUID()};
 const first=(await h.api('/shogunate/open',post(p,oldRequest))).data;assertContract(first.shogunate,first.receipt,oldRequest);await approveRight(h,p,original.id);
 const insert=h.sql.prepare("INSERT INTO shogunate_rights(id,user_id,source_type,source_id,title,earned_at) VALUES(?,?,'event',?,'別の天下統一',?)"),newCurrent='sg_'+crypto.randomUUID().replaceAll('-',''),unopened='sg_'+crypto.randomUUID().replaceAll('-','');
 insert.run(newCurrent,p.user.id,'older-current',h.now-2);insert.run(unopened,p.user.id,'older-unopened',h.now-1);h.now++;
 const currentRequest={rightId:newCurrent,requestId:crypto.randomUUID()},opened=(await h.api('/shogunate/open',post(p,currentRequest))).data;assertContract(opened.shogunate,opened.receipt,currentRequest);await approveRight(h,p,newCurrent);
 for(let n=0;n<101;n++)insert.run('sg_'+crypto.randomUUID().replaceAll('-',''),p.user.id,'later-large-'+n,h.now+n+1);
 const ordinary=await view(h,p);assert.equal(ordinary.current.id,newCurrent);assert(!ordinary.rights.some(r=>r.id===original.id||r.id===unopened));
 const replay=(await h.api('/shogunate/open',post(p,oldRequest))).data;assert(replay.idempotent);assertContract(replay.shogunate,replay.receipt,oldRequest);assert.equal(replay.shogunate.rights.length,100);assert.equal(replay.shogunate.current.id,newCurrent);assert.equal(replay.shogunate.rights[0].sourceId,'later-large-100');assert.deepEqual(replay.shogunate.rights.slice(-2).map(r=>r.id),[newCurrent,original.id]);
 h.now++;const olderRequest={rightId:unopened,requestId:crypto.randomUUID()},lateOpen=(await h.api('/shogunate/open',post(p,olderRequest))).data;assertContract(lateOpen.shogunate,lateOpen.receipt,olderRequest);const latest=await approveRight(h,p,unopened);assert.equal(latest.current.id,unopened);assert.equal(lateOpen.shogunate.rights.at(-1).id,unopened);assert.equal(lateOpen.shogunate.rights.length,100);
});
console.log(`${count} shogunate transaction scenarios / ${calls} API calls passed${frontend?' with actual frontend DTO and receipt validation':''}.`);
