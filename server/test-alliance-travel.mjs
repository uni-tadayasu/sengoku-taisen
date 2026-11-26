import assert from 'node:assert/strict';
import {harness,syncFieldWriter,settleFieldMarch} from './test-support.mjs';
import {getAllianceDefense,settleAllianceUnits} from './alliance.js';

const reports=[];
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const read=(h,p)=>JSON.parse(row(h,p).save_json);
const unit=(h,id)=>h.sql.prepare('SELECT * FROM alliance_units WHERE id=?').get(id);
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const body=(h,p,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,...extra});
const cmd=async(h,p,path,extra={},expected=200)=>(await h.api('/alliance/'+path,post(p,body(h,p,extra),expected))).data;
const status=async(h,p)=>(await h.api('/alliance',{token:p.token})).data;
const dto=async(h,p,id)=>(await status(h,p)).units.find(u=>u.id===id);
async function player(h,name,home='kiyosu'){
 const p=await h.session(name);p.deviceId='alliance-travel-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,save=h.fresh(home);save.state.troops=5000;save.state.resources.rice=100000;save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save}});return p;
}
async function household(h,homes=['kiyosu','inuyama']){
 const owner=await player(h,'派遣元',homes[0]),target=await player(h,'派遣先',homes[1]),guild=(await h.api('/guild',post(owner,{name:'部隊移動試験同盟'}))).data.guild.id;
 await h.api('/guild/join',post(target,{guildId:guild}));return{owner,target,guild};
}
const defense=(h,p,guild)=>(getAllianceDefense(h.db,{id:p.user.id,guild_id:guild},read(h,p).state.home,h.now));
async function scope(name,fn){const h=harness(),batch=h.db.batch.bind(h.db);let maxBindings=0;h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 binding limit');}return batch(statements);};try{await fn(h);reports.push({name,calls:h.calls,maxBindings});}finally{h.close();}}

await scope('departure escrows once; no defense before the exact arrival; distant routes take longer',async h=>{
 const {owner,target,guild}=await household(h),request=body(h,owner,{targetPlayerId:target.user.id,castleId:'inuyama',troops:400,hours:1}),before=read(h,owner).state.troops;
 const sent=(await h.api('/alliance/reinforcements/send',post(owner,request))).data,id=sent.result.unitId;
 assert.equal(sent.result.travel.durationMs,26000);assert.equal(read(h,owner).state.troops,before-400);assert.equal((await dto(h,owner,id)).state,'outbound');assert.equal((await defense(h,target,guild)).troops,0);
 const replay=(await h.api('/alliance/reinforcements/send',post(owner,request))).data;assert(replay.idempotent);assert.equal(replay.result.unitId,id);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM alliance_units').get().n,1);
 assert.equal(h.sql.prepare('SELECT alliance_troops FROM external_troop_accounts WHERE user_id=?').get(owner.user.id).alliance_troops,400,'travel remains the owner’s upkeep responsibility');
 h.now+=25999;assert.equal((await defense(h,target,guild)).troops,0);assert.equal((await dto(h,owner,id)).remainingMs,1);
 h.now+=1;const views=await Promise.all([dto(h,owner,id),dto(h,owner,id)]);assert(views.every(v=>v.state==='stationed'&&v.phase===null));assert.equal((await defense(h,target,guild)).troops,400);assert.equal(unit(h,id).revision,1,'arrival is settled once');
 const far=globalThis.SengokuTravel.plan({sourceCastleId:'kiyosu',targetCastleId:'kagoshima'});assert(far.durationMs>sent.result.travel.durationMs*8);
});

await scope('turning back takes elapsed distance; paused and accelerated clocks preserve the return; claim replays once',async h=>{
 const {owner,target}=await household(h),sent=await cmd(h,owner,'reinforcements/send',{targetPlayerId:target.user.id,castleId:'inuyama',troops:400,hours:1}),id=sent.result.unitId;
 h.now+=5000;const recallBody=body(h,owner,{unitId:id}),recall=(await h.api('/alliance/units/recall',post(owner,recallBody))).data;
 assert.equal(recall.result.travel.durationMs,5000);assert.equal((await dto(h,owner,id)).phase,'returning');const deadline=unit(h,id).arrives_elapsed_ms;
 h.now+=1000;await h.api('/alliance/units/recall',post(owner,recallBody));await cmd(h,owner,'units/recall',{unitId:id});assert.equal(unit(h,id).arrives_elapsed_ms,deadline,'recall retries never extend or shorten the trip');
 await cmd(h,owner,'units/claim',{unitId:id},409);
 const clock=(await status(h,owner)).clock;h.sql.prepare('UPDATE world_clock SET running=0,base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(clock.elapsedMs,h.now);h.now+=60000;
 assert.equal((await dto(h,owner,id)).remainingMs,4000);assert.equal(read(h,owner).state.troops,4600);
 h.sql.prepare('UPDATE world_clock SET running=1,speed=4,anchor_real_ms=?,revision=revision+1').run(h.now);h.now+=999;assert.equal((await dto(h,owner,id)).canClaim,false);h.now+=1;assert.equal((await dto(h,owner,id)).canClaim,true);
 await syncFieldWriter(h,owner);const claimBody=body(h,owner,{unitId:id}),claim=(await h.api('/alliance/units/claim',post(owner,claimBody))).data;assert.equal(claim.result.receivedTroops,400);const saved=row(h,owner).save_json;
 assert((await h.api('/alliance/units/claim',post(owner,claimBody))).data.idempotent);assert.equal(row(h,owner).save_json,saved);assert.equal(unit(h,id).state,'claimed');
 assert.equal(h.sql.prepare('SELECT alliance_troops FROM external_troop_accounts WHERE user_id=?').get(owner.user.id).alliance_troops,0);
});

await scope('rally launches only arrived contributors and returns late arrivals and battle survivors separately',async h=>{
 const {owner:leader,target:ally,guild}=await household(h,['kiyosu','himeji']),enemy=await player(h,'集結の目標','inuyama');
 const op=(await cmd(h,leader,'operations/create',{kind:'attack',title:'到着を待つ集結',targetPlayerId:enemy.user.id,castleId:'inuyama',tactic:'balanced',startsAt:h.now,expiresAt:h.now+3600000})).result.operationId;
 const own=(await cmd(h,leader,'rally/join',{operationId:op,troops:1000})).result.unitId,remote=(await cmd(h,ally,'rally/join',{operationId:op,troops:1000})).result.unitId;
 let view=await status(h,leader);assert.equal(view.operations[0].stagingCastleId,'kiyosu');assert.equal(view.operations[0].troops,0);assert.equal(view.operations[0].travelingTroops,2000);
 await cmd(h,leader,'rally/launch',{operationId:op},409);h.now+=15000;view=await status(h,leader);assert.equal(view.operations[0].troops,1000);assert.equal(view.operations[0].travelingTroops,1000);
 const march=await cmd(h,leader,'rally/launch',{operationId:op});assert.equal(march.march.troops,1000);assert.equal(march.march.sourceCastleId,'kiyosu');assert.equal(unit(h,remote).march_id,null);
 const marching=(await status(h,leader)).operations.find(o=>o.id===op);assert.equal(marching.status,'marching');assert.equal(marching.march.id,march.march.id);assert(marching.march.remainingMs>0);assert.equal(h.sql.prepare('SELECT status FROM alliance_operations WHERE id=?').get(op).status,'planned','the DTO must not alter the durable operation state');
 const late=await dto(h,ally,remote);assert.equal(late.phase,'returning');assert.equal(late.canClaim,false);assert.equal(unit(h,remote).troops,1000);
 const battle=await settleFieldMarch(h,leader,march),survivor=await dto(h,leader,own);assert.equal(survivor.phase,'returning');assert.equal(survivor.travel.sourceCastleId,'inuyama');assert.equal(survivor.travel.targetCastleId,'kiyosu');assert.equal(battle.rally.participants,1);assert.equal(survivor.troops+battle.attackerLost+(battle.capture?.garrison||0),1000);
 await cmd(h,leader,'units/claim',{unitId:own},409);h.now+=survivor.remainingMs;assert.equal((await dto(h,leader,own)).canClaim,true);
});

await scope('a guild leader launching another creator’s operation departs from its fixed assembly castle',async h=>{
 const {owner:leader,target:creator}=await household(h,['kiyosu','inuyama']),enemy=await player(h,'別本拠からの集結目標','okazaki');
 const op=(await cmd(h,creator,'operations/create',{kind:'attack',title:'現地で集結する作戦',targetPlayerId:enemy.user.id,castleId:'okazaki',tactic:'balanced',startsAt:h.now,expiresAt:h.now+3600000})).result.operationId;
 const sent=await cmd(h,leader,'rally/join',{operationId:op,troops:1000});assert.equal(sent.result.travel.targetCastleId,'inuyama');
 h.now+=sent.result.travel.durationMs;await status(h,leader);await syncFieldWriter(h,leader);
 const departure=await cmd(h,leader,'rally/launch',{operationId:op});assert.equal(departure.march.sourceCastleId,'inuyama');assert.equal(read(h,leader).state.home,'kiyosu');
 const battle=await settleFieldMarch(h,leader,departure);assert.equal(battle.rally.participants,1);const returning=await dto(h,leader,sent.result.unitId);assert.equal(returning.travel.sourceCastleId,'okazaki');assert.equal(returning.travel.targetCastleId,'kiyosu');
});

await scope('closed operations, lost targets and expired contracts preserve soldiers until their return completes',async h=>{
 const {owner,target,guild}=await household(h),enemy=await player(h,'中止作戦の敵','okazaki');
 const op=(await cmd(h,owner,'operations/create',{kind:'attack',title:'撤収する集結',targetPlayerId:enemy.user.id,castleId:'okazaki',tactic:'balanced',startsAt:h.now,expiresAt:h.now+3600000})).result.operationId;
 const joined=(await cmd(h,target,'rally/join',{operationId:op,troops:300})).result.unitId,cancelBody=body(h,owner,{operationId:op});
 await h.api('/alliance/operations/cancel',post(owner,cancelBody));const deadline=unit(h,joined).arrives_elapsed_ms;h.now+=500;await h.api('/alliance/operations/cancel',post(owner,cancelBody));assert.equal(unit(h,joined).arrives_elapsed_ms,deadline);assert.equal((await dto(h,target,joined)).canClaim,false);
 const aid=(await cmd(h,owner,'reinforcements/send',{targetPlayerId:target.user.id,castleId:'inuyama',troops:400,hours:1})).result.unitId;
 const save=read(h,target);save.state.castles.inuyama.owner='在地衆';h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(save),target.user.id);
 await settleAllianceUnits({db:h.db,now:h.now});assert.equal(unit(h,aid).state,'returning');assert.equal(unit(h,aid).troops,400);assert.equal((await defense(h,target,guild)).troops,0);
 h.now+=26000;assert.equal((await dto(h,owner,aid)).canClaim,true);await syncFieldWriter(h,owner);
 save.state.castles.inuyama.owner=save.state.clan;h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(save),target.user.id);
 const timed=(await cmd(h,owner,'reinforcements/send',{targetPlayerId:target.user.id,castleId:'inuyama',troops:300,hours:1})).result.unitId;
 h.now+=3600000+26000;const expired=await dto(h,owner,timed);assert.equal(expired.canClaim,true,'stable clock epochs date contract expiry without adding another offline wait');assert.equal(expired.troops,300);
});

await scope('clock revision and transaction faults cannot complete or double an arrival',async h=>{
 const {owner,target}=await household(h),sent=await cmd(h,owner,'reinforcements/send',{targetPlayerId:target.user.id,castleId:'inuyama',troops:300,hours:1}),id=sent.result.unitId;
 h.now+=sent.result.travel.durationMs;
 h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('travel_phase=CASE WHEN travel_phase='))){h.beforeBatch=null;h.sql.exec('UPDATE world_clock SET revision=revision+1');}};
 await settleAllianceUnits({db:h.db,now:h.now});assert.equal(unit(h,id).travel_phase,'outbound');assert.equal(unit(h,id).revision,0);
 h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('travel_phase=CASE WHEN travel_phase='))){h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_alliance_arrival SET value=1'));}};
 await assert.rejects(settleAllianceUnits({db:h.db,now:h.now}));assert.equal(unit(h,id).travel_phase,'outbound');assert.equal(unit(h,id).revision,0);
 await Promise.all([settleAllianceUnits({db:h.db,now:h.now}),settleAllianceUnits({db:h.db,now:h.now})]);assert.equal(unit(h,id).travel_phase,'stationed');assert.equal(unit(h,id).revision,1);assert.equal(unit(h,id).troops,300);
});

await scope('legacy stationed and returning units remain usable without retroactive travel',async h=>{
 const {owner,target,guild}=await household(h),epoch=h.sql.prepare('SELECT COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0) n').get(owner.user.id).n,targetEpoch=h.sql.prepare('SELECT COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=?),0) n').get(target.user.id).n;
 h.sql.prepare("INSERT INTO alliance_units(id,guild_id,owner_id,owner_epoch,target_id,target_epoch,castle_id,kind,state,troops,sent,expires_at,created_at) VALUES('legacy-unit',?,?,?,?,?,'inuyama','aid','stationed',300,300,?,?)").run(guild,owner.user.id,epoch,target.user.id,targetEpoch,h.now+3600000,h.now);
 assert.equal((await defense(h,target,guild)).troops,300);await cmd(h,owner,'units/recall',{unitId:'legacy-unit'});assert.equal((await dto(h,owner,'legacy-unit')).canClaim,true);
 const claimed=await cmd(h,owner,'units/claim',{unitId:'legacy-unit'});assert.equal(claimed.result.receivedTroops,300);assert.equal(unit(h,'legacy-unit').state,'claimed');
});

console.log(JSON.stringify({ok:true,checks:reports,productionRequests:0},null,2));
