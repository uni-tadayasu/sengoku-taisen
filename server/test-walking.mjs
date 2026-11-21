import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// All sessions and mutations below use the local in-memory D1 harness only.
const h=harness(),{sql,api}=h,checks=[];
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const row=p=>sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=p=>JSON.parse(row(p).save_json);
const account=p=>sql.prepare('SELECT * FROM walking_accounts WHERE user_id=?').get(p.user.id);
const count=p=>Number(sql.prepare('SELECT COUNT(*) n FROM walking_receipts wr JOIN walking_sessions ws ON ws.id=wr.session_id WHERE ws.user_id=?').get(p.user.id).n);
const balances=p=>({resources:saved(p).state.resources,magatama:saved(p).state.magatama,revision:row(p).revision});
const lease=async p=>(await api('/sync/lease',post(p,{deviceId:p.deviceId,takeOver:true}))).data;
const startBody=(p,more={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(p).revision,campaignId:saved(p).state.walking?.campaignId||'legacy_v1',...more});
const start=async(p,body=startBody(p),expected=200)=>(await api('/walking/start',post(p,body,expected)));
const claimBody=(p,session,more={})=>({deviceId:p.deviceId,expectedRevision:row(p).revision,sessionId:session.id,sessionToken:session.token,seq:session.lastSeq+1,totalSteps:session.totalSteps,activeMs:session.activeMs,finish:false,...more});
const claim=(p,body,expected=200)=>api('/walking/claim',post(p,body,expected));
async function fixture(name,{legacy=false}={}){
 h.resetRates();const p=await h.session(name);p.deviceId='device-'+p.user.id;const l=await lease(p);
 const g=new GameEngine({clan:'織田家',officers:GAME_OFFICERS,seed:7});g.applyWorldClock((await api('/world-clock')).data.clock);const save=JSON.parse(g.exportSave());if(legacy)delete save.state.walking;
 await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:l.revision,save}});return p;
}
function paid(before,after,steps){for(const k of ['gold','rice','wood','stone'])assert.equal(after.resources[k],Math.min(999999999,before.resources[k]+steps*2),k);assert.equal(after.magatama,Math.min(999999999,before.magatama+steps*2));assert.equal(after.revision,before.revision+(steps>0?1:0));}
function barrier(fragment){let arrived=0,release;const pending=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes(fragment))){arrived++;if(arrived===2){h.beforeBatch=null;release();}await pending;}};return()=>arrived;}
try{
 await api('/world-clock');sql.prepare("UPDATE world_clock SET running=0,base_elapsed_ms=0,anchor_real_ms=?,speed=1 WHERE id='world-v1'").run(h.now);
 const p=await fixture('歩行の基本'),req=startBody(p),initial=balances(p),first=(await start(p,req)).data,s=first.walkingSession;
 assert.equal(s.campaignId,saved(p).state.walking.campaignId);assert.equal(s.totalSteps,0);assert.equal(s.lastSeq,0);assert.equal(s.closed,false);assert.equal(first.walkingRules.rewardPerStep,2);assert.equal(first.clock.running,false);
 assert(sql.prepare("SELECT value FROM settings WHERE key='walkingSigningKey'").get().value);assert(!JSON.stringify(first).includes('walkingSigningKey'));
 const same=(await start(p,req)).data;assert.equal(same.idempotent,true);assert.equal(same.walkingSession.id,s.id);assert.equal(same.walkingSession.token,s.token);
 assert.equal((await start(p,startBody(p),409)).data.error.code,'WALKING_ACTIVE');assert.deepEqual(balances(p),initial);
 const tooSoon=claimBody(p,s,{totalSteps:2,activeMs:0});assert.equal((await claim(p,tooSoon,400)).data.error.code,'WALKING_RATE_EXCEEDED');
 h.now+=5000;const payload=claimBody(p,s,{totalSteps:10,activeMs:5000}),awarded=(await claim(p,payload)).data;
 paid(initial,balances(p),10);assert.equal(account(p).total_steps,10);assert.equal(awarded.save.state.walking.serverSteps,10);assert.equal(count(p),1);
 const replay=(await claim(p,{...payload,deviceId:'old-document',expectedRevision:0})).data;assert(replay.idempotent);assert.deepEqual(replay.receipt,awarded.receipt);paid(initial,balances(p),10);
 assert.equal((await claim(p,{...payload,totalSteps:11},409)).data.error.code,'WALKING_SEQUENCE_REUSED');
 await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:initial.revision,save:first.save},expected:409});assert.equal(account(p).total_steps,10);
 h.now+=5000;const heartbeat=(await claim(p,claimBody(p,awarded.walkingSession,{activeMs:10000}))).data;assert.equal(heartbeat.receipt.deltaSteps,0);assert.equal(heartbeat.revision,awarded.revision);assert.equal(heartbeat.walkingSession.lastSeq,2);
 const done=(await claim(p,claimBody(p,heartbeat.walkingSession,{finish:true}))).data;assert(done.walkingSession.closed);assert.equal(done.receipt.deltaSteps,0);assert.equal(account(p).total_steps,10);
 assert.equal((await claim(p,claimBody(p,done.walkingSession,{totalSteps:11,activeMs:11000}),409)).data.error.code,'WALKING_SESSION_CLOSED');
 checks.push('signed start, live start exclusion, paused clock, five-asset grant, zero-step heartbeat and durable replay');

 const delayed=await fixture('通信遅延の歩行'),ds=(await start(delayed)).data.walkingSession;h.now+=6000;
 const d1=(await claim(delayed,claimBody(delayed,ds,{totalSteps:10,activeMs:5000}))).data;h.now+=4200;
 const d2=(await claim(delayed,claimBody(delayed,d1.walkingSession,{totalSteps:20,activeMs:10000}))).data;assert.equal(d2.receipt.deltaSteps,10);
 assert.equal((await claim(delayed,claimBody(delayed,d2.walkingSession,{totalSteps:22,activeMs:10200}),400)).data.error.code,'WALKING_RATE_EXCEEDED');
 assert.equal((await claim(delayed,claimBody(delayed,d2.walkingSession,{totalSteps:41,activeMs:10200}),400)).data.error.code,'WALKING_RATE_EXCEEDED');
 checks.push('variable network delivery, strict total rate and no zero-time per-sequence jitter farming');

 await lease(p);const beforeLoops=balances(p);
 for(let i=0;i<3;i++){const loop=(await start(p)).data.walkingSession;await claim(p,claimBody(p,loop,{totalSteps:1,activeMs:0,finish:true}),400);await claim(p,claimBody(p,loop,{finish:true}));}
 assert.deepEqual(balances(p),beforeLoops);assert.equal(account(p).total_steps,10);
 const startRace=await fixture('開始の同時競合');barrier('INSERT INTO walking_sessions');
 const startsTogether=await Promise.all([start(startRace,startBody(startRace),null),start(startRace,startBody(startRace),null)]);assert.deepEqual(startsTogether.map(r=>r.response.status).sort(),[200,409]);assert.equal(sql.prepare('SELECT COUNT(*) n FROM walking_sessions WHERE user_id=?').get(startRace.user.id).n,1);
 checks.push('repeated immediate start/finish earns zero and simultaneous starts cannot replace one another');

 const duplicate=await fixture('同時歩行再送'),ss=(await start(duplicate)).data.walkingSession;h.now+=5000;
 const db=claimBody(duplicate,ss,{totalSteps:15,activeMs:5000}),beforeDup=balances(duplicate),entered=barrier('INSERT INTO walking_receipts');
 const race=await Promise.all([claim(duplicate,db),claim(duplicate,db)]);assert.equal(entered(),2);assert.deepEqual(race.map(r=>r.data.idempotent).sort(),[false,true]);paid(beforeDup,balances(duplicate),15);assert.equal(count(duplicate),1);
 h.now+=5000;const next=race[0].data.walkingSession,b1=claimBody(duplicate,next,{totalSteps:20,activeMs:10000}),b2={...b1,totalSteps:21};barrier('INSERT INTO walking_receipts');
 const collision=await Promise.all([claim(duplicate,b1,null),claim(duplicate,b2,null)]);assert.deepEqual(collision.map(r=>r.response.status).sort(),[200,409]);assert.equal(count(duplicate),2);assert([20,21].includes(account(duplicate).total_steps));
 checks.push('simultaneous identical receipts and different payloads cannot both grant');

 const starts=await fixture('開始応答喪失'),sb=startBody(starts);h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO walking_sessions'))){h.afterBatch=null;throw Error('test lost start response');}};
 await start(starts,sb,500);const recoveredStart=(await start(starts,sb)).data;assert(recoveredStart.idempotent);assert.equal(sql.prepare('SELECT COUNT(*) n FROM walking_sessions WHERE user_id=?').get(starts.user.id).n,1);
 h.now+=5000;const cb=claimBody(starts,recoveredStart.walkingSession,{totalSteps:10,activeMs:5000}),beforeLost=balances(starts);
 h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO walking_receipts'))){h.afterBatch=null;throw Error('test lost committed response');}};
 await claim(starts,cb,500);paid(beforeLost,balances(starts),10);
 starts.deviceId='reloaded-document';await lease(starts);const recovered=(await claim(starts,{...cb,deviceId:starts.deviceId,expectedRevision:row(starts).revision})).data;assert(recovered.idempotent);paid(beforeLost,balances(starts),10);
 h.now+=5000;const unseen=claimBody(starts,recovered.walkingSession,{totalSteps:15,activeMs:10000});starts.deviceId='reloaded-again';await lease(starts);
 const rebound=(await claim(starts,{...unseen,deviceId:starts.deviceId})).data;assert.equal(rebound.receipt.deltaSteps,5);assert.equal(account(starts).total_steps,15);
 checks.push('lost start/claim responses, authenticated document reload and current-writer unacknowledged tail');

 const expiry=await fixture('離席の最終精算'),es=(await start(expiry)).data.walkingSession;h.now+=100000;await lease(expiry);
 const expired=claimBody(expiry,es,{totalSteps:12,activeMs:6000});assert.equal((await claim(expiry,expired,409)).data.error.code,'WALKING_EXPIRED');
 const tail=(await claim(expiry,{...expired,finish:true})).data;assert.equal(tail.receipt.deltaSteps,12);assert(tail.walkingSession.closed);
 h.now+=100000;await lease(expiry);const retried=(await claim(expiry,{...expired,finish:true,expectedRevision:0})).data;assert(retried.idempotent);assert.equal(account(expiry).total_steps,12);
 const ns=(await start(expiry)).data.walkingSession;h.now+=40000;await lease(expiry);
 assert.equal((await claim(expiry,claimBody(expiry,ns,{totalSteps:121,activeMs:31000,finish:true}),400)).data.error.code,'WALKING_RATE_EXCEEDED');
 const replacement=(await start(expiry)).data.walkingSession;
 assert.equal((await claim(expiry,claimBody(expiry,ns,{totalSteps:10,activeMs:5000,finish:true}),409)).data.error.code,'WALKING_SESSION_CLOSED');assert.notEqual(replacement.id,ns.id);
 checks.push('bounded expired finish, expired receipt replay and replacement session isolation');

 const identities=await fixture('歩行の物語分離'),other=await fixture('別の領主'),ids=(await start(identities)).data.walkingSession;
 await claim(other,claimBody(other,ids),403);await claim(identities,{...claimBody(identities,ids),sessionToken:'forged'},403);
 h.now+=5000;const oldPayload=claimBody(identities,ids,{totalSteps:10,activeMs:5000});
 const fresh=new GameEngine({officers:GAME_OFFICERS,seed:10});fresh.applyWorldClock((await api('/world-clock')).data.clock);
 await api('/sync',{method:'PUT',token:identities.token,body:{deviceId:identities.deviceId,revision:row(identities).revision,save:JSON.parse(fresh.exportSave())}});
 assert.equal((await claim(identities,{...oldPayload,expectedRevision:row(identities).revision},409)).data.error.code,'WALKING_CAMPAIGN_CHANGED');
 assert.notEqual((await start(identities)).data.walkingSession.campaignId,ids.campaignId);
 const legacy=await fixture('従来保存の歩行',{legacy:true});assert.equal(saved(legacy).state.walking.campaignId,'legacy_v1');const ls=(await start(legacy)).data.walkingSession;h.now+=5000;
 const legacyAward=(await claim(legacy,claimBody(legacy,ls,{totalSteps:10,activeMs:5000}))).data;
 const imported=structuredClone(legacyAward.save);imported.state.walking.serverSteps=0;imported.state.resources.gold-=20;
 const importedResult=(await api('/sync',{method:'PUT',token:legacy.token,body:{deviceId:legacy.deviceId,revision:row(legacy).revision,save:imported}})).data;
 assert.equal(importedResult.save.state.walking.serverSteps,10);assert.equal(importedResult.save.state.resources.gold,imported.state.resources.gold,'import never top-ups previously credited currency');assert.equal(account(legacy).total_steps,10);
 const replayLegacy=(await claim(legacy,claimBody(legacy,ls,{totalSteps:10,activeMs:5000}))).data;assert(replayLegacy.idempotent);assert.equal(saved(legacy).state.resources.gold,imported.state.resources.gold);
 checks.push('account/campaign binding, forged token rejection and old-save ledger normalization without top-ups');

 for(const scenario of ['revision','lease','role','campaign']){
   const r=await fixture('歩行競合'+scenario),ws=(await start(r)).data.walkingSession;h.now+=5000;const body=claimBody(r,ws,{totalSteps:10,activeMs:5000}),before={save:row(r).save_json,total:account(r).total_steps,count:count(r)};
   h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO walking_receipts')))return;h.beforeBatch=null;
     if(scenario==='revision')sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(r.user.id);
     if(scenario==='lease')sql.prepare('UPDATE player_saves SET writer_device_id=? WHERE user_id=?').run('new-writer',r.user.id);
     if(scenario==='role')sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(r.user.id,h.now);
     if(scenario==='campaign')sql.prepare("UPDATE player_saves SET save_json=json_set(save_json,'$.state.walking.campaignId','new-campaign') WHERE user_id=?").run(r.user.id);
   };
   await claim(r,body,409);assert.equal(account(r).total_steps,before.total);assert.equal(count(r),before.count);if(scenario!=='campaign')assert.equal(row(r).save_json,before.save);
   if(scenario==='role')sql.prepare("DELETE FROM settings WHERE key='adminUserId'").run();
 }
 checks.push('commit-time save revision, device takeover, role and campaign guards');

 const rollback=await fixture('歩行の原子的復旧'),rs=(await start(rollback)).data.walkingSession;h.now+=5000;const rb=claimBody(rollback,rs,{totalSteps:10,activeMs:5000}),rbBefore={row:row(rollback),account:account(rollback),count:count(rollback)};
 sql.exec("CREATE TEMP TRIGGER reject_walking_account BEFORE UPDATE ON walking_accounts BEGIN SELECT RAISE(ABORT,'test rollback'); END");await claim(rollback,rb,500);sql.exec('DROP TRIGGER reject_walking_account');
 assert.deepEqual(row(rollback),rbBefore.row);assert.deepEqual(account(rollback),rbBefore.account);assert.equal(count(rollback),rbBefore.count);await claim(rollback,rb);
 const cap=await fixture('歩行の上限');const capSave=saved(cap);for(const k of ['gold','rice','wood','stone'])capSave.state.resources[k]=999999998;capSave.state.magatama=999999999;
 await api('/sync',{method:'PUT',token:cap.token,body:{deviceId:cap.deviceId,revision:row(cap).revision,save:capSave}});const cs=(await start(cap)).data.walkingSession;h.now+=5000;
 const capped=(await claim(cap,claimBody(cap,cs,{totalSteps:10,activeMs:5000}))).data;assert.deepEqual(capped.receipt.rewards,{gold:1,rice:1,wood:1,stone:1,magatama:0});assert.equal(account(cap).total_steps,10);
 sql.prepare("UPDATE world_clock SET speed=4,running=0 WHERE id='world-v1'").run();h.now+=5000;const sped=(await claim(cap,claimBody(cap,capped.walkingSession,{totalSteps:20,activeMs:10000}))).data;assert.equal(sped.receipt.deltaSteps,10);assert.equal(account(cap).total_steps,20);
 checks.push('full transaction rollback, per-asset clamps and game clock speed independence');

 const operator=await fixture('歩く運営');await api('/admin/claim',post(operator,{key:h.env.SENGOKU_ADMIN_KEY}));await api('/sync',{token:operator.token});
 const staff=await fixture('歩くスタッフ');await api('/admin/staff',post(operator,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));await api('/sync',{token:staff.token});
 for(const [lord,home,isAdmin] of [[operator,'edo',true],[staff,'sunpu',false]]){const started=(await start(lord)).data,ws=started.walkingSession,before=balances(lord),protectedState=started.save.state;h.now+=5000;const result=(await claim(lord,claimBody(lord,ws,{totalSteps:10,activeMs:5000}))).data;paid(before,balances(lord),10);assert.equal(result.save.state.home,home);assert.equal(result.save.state.clan,'德川家');assert.deepEqual(result.save.state.officerVariants,protectedState.officerVariants);assert.equal(result.save.state.officerVariants.includes('of_b0616adde162:U'),isAdmin);assert.deepEqual(result.save.state.castles,protectedState.castles);}
 checks.push('operator and staff receive the same reward without changing protected homes or officer entitlements');
 console.log(JSON.stringify({ok:true,calls:h.calls,checks},null,2));
}finally{h.close();}
