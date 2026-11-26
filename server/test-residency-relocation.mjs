import assert from 'node:assert/strict';
import {harness,syncFieldWriter} from './test-support.mjs';
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const current=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(current(h,p).save_json);
const seat=(h,id)=>h.sql.prepare('SELECT * FROM castle_seats WHERE castle_id=?').get(id);
const body=(h,p,castleId)=>({deviceId:p.deviceId,revision:current(h,p).revision,requestId:crypto.randomUUID(),castleId});
const call=(h,p,request,expected=200,read=false)=>h.api('/castles/residency/relocate'+(read?'?receipt=1':''),post(p,request,expected)).then(r=>r.data);
async function actor(h,name,castleId,mode='lord'){
 const p=await h.session(name);p.deviceId='relocation-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 await h.api('/castles/residency/start',post(p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'}));
 return p;
}
const command=(h,p,path,extra={},expected=200)=>h.api(path,post(p,{requestId:crypto.randomUUID(),expectedRevision:current(h,p).revision,deviceId:p.deviceId,...extra},expected)).then(r=>r.data);
const read=(h,p,path)=>h.api(path,{token:p.token}).then(r=>r.data);
const unit=(h,id)=>h.sql.prepare('SELECT * FROM alliance_units WHERE id=?').get(id);
async function finishUnitTravel(h,...actors){
 let remaining=0;for(const actor of actors){const view=await read(h,actor,'/alliance');remaining=Math.max(remaining,...view.units.filter(u=>u.ownerId===actor.user.id&&u.phase).map(u=>Math.ceil(u.remainingMs/view.clock.speed)));}
 h.now+=remaining;for(const actor of actors){await read(h,actor,'/alliance');await syncFieldWriter(h,actor);}
}

const change=async(h,p,update)=>{
 const s=save(h,p);update(s.state);
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:current(h,p).revision,save:s}});
};
const makeGuild=async(h,leader,members)=>{
 const guild=(await h.api('/guild',post(leader,{name:'遠征の同盟'}))).data.guild;
 for(const member of members)await h.api('/guild/join',post(member,{guildId:guild.id}));
 return guild;
};
const rally=async(h,leader,ally,target)=>{
 const op=(await command(h,leader,'/alliance/operations/create',{kind:'attack',title:'連合軍出陣',targetPlayerId:target.user.id,castleId:save(h,target).state.home,tactic:'balanced',startsAt:h.now,expiresAt:h.now+3600000})).result.operationId;
 const own=(await command(h,leader,'/alliance/rally/join',{operationId:op,troops:600})).result.unitId;
 const remote=(await command(h,ally,'/alliance/rally/join',{operationId:op,troops:700})).result.unitId;
 await finishUnitTravel(h,leader,ally);await syncFieldWriter(h,target);
 const launch=await command(h,leader,'/alliance/rally/launch',{operationId:op});
 assert(launch.marching);return {own,remote,march:launch.march,op};
};
let cases=0,calls=0,maxBindings=0;
async function test(label,fn){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100);}return batch(statements);};try{await fn(h);cases++;console.log('PASS '+label);}finally{calls+=h.calls;h.close();}}

await test('relocation updates the cloud campaign, rolls back the old seat to its oldest eligible retainer, and starts without fresh financial grants',async h=>{
 const a=await actor(h,'移転元領主','kiyosu'),b=await actor(h,'先着家臣','kiyosu','retainer'),c=await actor(h,'目的領主','inuyama');
 let old=save(h,a);old.state.resources.gold=90;old.state.tech.siege=2;old.state.buildings.keep=8;old.state.magatama=15;old.state.stats.gachaDraws=5;old.state.stats.gachaDuplicates=2;
 const uploaded=(await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:current(h,a).revision,save:old}})).data;
 old=uploaded.save;
 const q=body(h,a,'inuyama'),newer=await call(h,a,q);
 assert.equal(newer.admission.mode,'retainer');assert.equal(newer.residency.role,'retainer');assert.equal(newer.save.state.home,'inuyama');
 assert.equal(seat(h,'inuyama').lord_user_id,c.user.id);assert.equal(seat(h,'kiyosu').lord_user_id,b.user.id);
 assert.equal(newer.save.state.tech.siege,0);assert.equal(newer.save.state.buildings.keep,2);assert(newer.save.state.resources.gold<=90);assert(newer.save.state.magatama<=15);
 assert.deepEqual(newer.save.state.officerVariants,old.state.officerVariants);assert.notEqual(newer.save.state.walking.campaignId,old.state.walking.campaignId);
 assert.equal(JSON.parse(h.sql.prepare('SELECT data_json FROM progress_accounts WHERE user_id=?').get(a.user.id).data_json).points,9);
 const repeat=await call(h,a,q);assert(repeat.admission.idempotent);assert.equal(repeat.revision,newer.revision);
 const again=await call(h,a,body(h,a,'himeji'));assert.equal(again.admission.mode,'lord');
 assert.equal((await read(h,a,'/progress')).progress.exchange.available,9);
 const replay=await call(h,a,{...q,deviceId:'read-only-current-device'},200,true);
 assert(replay.admission.idempotent);assert.equal(replay.admission.mode,'retainer');assert.equal(replay.admission.castleId,'inuyama');assert.equal(replay.save.state.home,'himeji');assert.equal(replay.writable,false);
 assert.equal((await call(h,a,{...q,castleId:'himeji'},409,true)).error.code,'REQUEST_ID_REUSED');
 await call(h,a,body(h,a,'kiyosu'));const tired=await h.api('/sync',{method:'PUT',token:a.token,body:{deviceId:a.deviceId,revision:current(h,a).revision,save:old},expected:409});
 assert.equal(tired.data.error.code,'CAMPAIGN_RELOCATED');assert.equal((await read(h,a,'/progress')).progress.exchange.available,9);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM castle_retired_campaigns WHERE actor_id=?').get(a.user.id).n,3);
});

await test('simultaneous arrivals assign exactly one lord, departure leaves a vacant seat without a successor, and double submissions commit once',async h=>{
 const a=await actor(h,'入城一番','kiyosu'),b=await actor(h,'入城二番','inuyama');
 const qa=body(h,a,'himeji'),qb=body(h,b,'himeji');
 h.beforeBatch=async statements=>{
  if(!statements.some(s=>s.sql.includes('INSERT INTO castle_retired_campaigns')))return;
  h.beforeBatch=null;
  const first=await call(h,b,qb);assert.equal(first.admission.mode,'lord');
 };
 const second=await call(h,a,qa);
 assert.equal(second.admission.mode,'retainer');assert.equal(seat(h,'himeji').lord_user_id,b.user.id);assert.equal(seat(h,'kiyosu').lord_user_id,null);
 const same=body(h,a,'inuyama');const results=await Promise.all([call(h,a,same),call(h,a,same)]);
 assert.deepEqual(results.map(r=>r.admission.idempotent).sort(),[false,true]);assert.equal(seat(h,'inuyama').lord_user_id,a.user.id);
 assert.equal((await call(h,a,body(h,a,'inuyama'),409)).error.code,'RESIDENCY_SAME_CASTLE');
});

await test('receipt-only requests never move a player, and verified access, protected castles, revisions and durable atomicity are enforced',async h=>{
 const a=await actor(h,'本拠検証','kiyosu'),q=body(h,a,'inuyama');
 for(const id of ['edo','kyoto_gosho','nijo','osaka','nagoya'])await call(h,a,{...q,castleId:id},400);
 await call(h,a,{...q,mode:'lord'},400);
 assert.equal((await call(h,a,{...q,deviceId:'other'},409)).error.code,'LEASE_REQUIRED');
 assert.equal((await call(h,a,{...q,revision:q.revision-1},409)).error.code,'REVISION_CONFLICT');
 assert.equal((await call(h,a,q,404,true)).error.code,'RELOCATION_RECEIPT_PENDING');
 h.sql.exec("CREATE TRIGGER block_home_move BEFORE UPDATE OF save_json ON player_saves BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
 await call(h,a,q,500);assert.equal(seat(h,'kiyosu').lord_user_id,a.user.id);assert.equal(seat(h,'inuyama').lord_user_id,null);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM castle_retired_campaigns').get().n,0);
 h.sql.exec('DROP TRIGGER block_home_move');assert.equal((await call(h,a,q)).admission.mode,'lord');
 await h.api('/admin/claim',post(a,{key:h.env.SENGOKU_ADMIN_KEY}));
 assert.equal((await call(h,a,body(h,a,'kiyosu'),403)).error.code,'RESIDENCY_PROTECTED');
 const staff=await actor(h,'任命後の元領主','himeji');
 await h.api('/admin/staff',post(a,{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 assert.equal((await call(h,staff,body(h,staff,'kiyosu'),403)).error.code,'RESIDENCY_PROTECTED');
});
await test('departing a commanded rally closes walking and conquest, preserves foreign aid and guild supplies, and cannot reclaim retired private troops',async h=>{
 h.now=Date.parse('2026-11-21T03:00:00Z');
 const a=await actor(h,'転居する総大将','kiyosu'),b=await actor(h,'援軍を送る領主','okazaki'),enemy=await actor(h,'攻められる領主','inuyama');
 await makeGuild(h,a,[b]);
 const aid=(await command(h,b,'/alliance/reinforcements/send',{targetPlayerId:a.user.id,castleId:'kiyosu',troops:300,hours:1})).result.unitId;
 const oldCampaign=save(h,a).state.walking.campaignId,walk=(await command(h,a,'/walking/start',{campaignId:oldCampaign})).walkingSession.id;
 let map=await read(h,a,'/conquest');await h.api('/conquest/join',post(a,{seasonId:map.season.id,requestId:crypto.randomUUID()}));
 map=await read(h,a,'/conquest');const cq={seasonId:map.season.id,requestId:crypto.randomUUID(),action:'attack',castleId:'inuyama',troops:2500,tactic:'balanced',expectedGuildRevision:map.guild.revision,expectedCastleRevision:map.castles.find(c=>c.id==='inuyama').revision};
 const conquest=(await h.api('/conquest/action',post(a,cq))).data;assert.equal(conquest.marching,true);
 const field=await rally(h,a,b,enemy),request=body(h,a,'himeji'),oldTroops=save(h,a).state.troops;
 const moved=await call(h,a,request);assert(moved.save.state.troops<=oldTroops);assert.equal(moved.residency.castleId,'himeji');
 assert.equal(h.sql.prepare('SELECT closed FROM walking_sessions WHERE id=?').get(walk).closed,1);
 assert.equal(h.sql.prepare('SELECT active_session_id FROM walking_accounts WHERE user_id=?').get(a.user.id).active_session_id,null);
 assert.equal(h.sql.prepare('SELECT status FROM battle_marches WHERE id=?').get(field.march.id).status,'cancelled');
 assert.equal(unit(h,field.own).state,'claimed');assert.equal(unit(h,field.own).troops,0);
 await finishUnitTravel(h,b);
 for(const [id,count] of [[field.remote,700],[aid,300]]){
  assert.equal(unit(h,id).state,'returning');assert.equal(unit(h,id).troops,count);
  assert.equal((await command(h,b,'/alliance/units/claim',{unitId:id})).result.receivedTroops,count);
 }
 const returned=h.sql.prepare('SELECT status,return_troops,return_supplies FROM conquest_marches WHERE id=?').get(conquest.march.id);
 assert.deepEqual({...returned},{status:'cancelled',return_troops:2500,return_supplies:550});
 assert.equal((await read(h,a,'/conquest')).guild.troops,map.guild.troops);
 const paid=(await h.api('/conquest/action',post(a,cq))).data;assert(paid.idempotent);assert(paid.result.cancelled);assert.equal(paid.guild.supplies,map.guild.supplies);
 const retry=await call(h,a,request);assert(retry.admission.idempotent);assert.equal(retry.save.state.troops,moved.save.state.troops);
 await command(h,a,'/alliance/units/claim',{unitId:field.own},409);
 assert.equal((await read(h,a,'/conquest')).guild.supplies,map.guild.supplies);
});
await test('a participant moving during another commander’s march keeps the deployed army intact through combat and retires only their own survivors',async h=>{
 const a=await actor(h,'進軍する指揮官','kiyosu'),b=await actor(h,'遠征中の家臣','okazaki'),enemy=await actor(h,'遠征対戦相手','inuyama');
 await makeGuild(h,a,[b]);const field=await rally(h,a,b,enemy);
 const pledged=unit(h,field.remote),moved=await call(h,b,body(h,b,'himeji'));
 assert.equal(unit(h,field.remote).campaign_retired,1);assert.equal(unit(h,field.remote).troops,700);assert.equal(unit(h,field.remote).revision,pledged.revision);
 h.now+=field.march.remainingMs;const result=await read(h,a,'/marches?deviceId='+a.deviceId);
 assert.equal(result.history.find(m=>m.id===field.march.id).status,'resolved');
 const battle=JSON.parse(h.sql.prepare('SELECT result_json FROM field_battles WHERE attacker_id=?').get(a.user.id).result_json);
 assert.equal(battle.troops,1300);assert.equal(battle.rally.participants,2);
 assert.equal(unit(h,field.remote).troops,0);assert.equal(unit(h,field.remote).state,'claimed');
 assert.equal(unit(h,field.own).campaign_retired,0);assert.equal(save(h,b).state.troops,moved.save.state.troops);
});
await test('relocating while spies travel cancels their original receipt and fresh sync cannot recover old reserves or scouting rewards',async h=>{
 const a=await actor(h,'派遣中の城主','kiyosu'),b=await actor(h,'偵察対象','inuyama');
 await change(h,a,s=>{s.resources.gold=1000000;s.resources.rice=1000000;s.buildings.keep=32;s.castles.nijo.owner=s.clan;s.castles.nijo.troops=50000;});
 const covered=()=>({campaignId:save(h,a).state.walking.campaignId,sequence:save(h,a).state.covert.sequence});
 await command(h,a,'/covert/hire',{...covered(),sourceCastleId:'nijo',count:100});
 const dispatch={requestId:crypto.randomUUID(),...covered(),sourceCastleId:'nijo',target:{kind:'player',playerId:b.user.id,castleId:'inuyama'},count:60,mode:'scout'};
 const dispatched=await command(h,a,'/covert/dispatch',dispatch);assert(dispatched.marching);
 const oldId=covered().campaignId,moved=await call(h,a,body(h,a,'himeji'));
 const replay=await command(h,a,'/covert/dispatch',dispatch);assert(replay.idempotent);assert.equal(replay.marching,false);assert.equal(replay.march.status,'cancelled');assert.match(replay.march.message,/旧戦役/);
 const retired=JSON.parse(h.sql.prepare('SELECT state_json FROM covert_states WHERE actor_id=? AND campaign_id=?').get(a.user.id,oldId).state_json);
 assert.equal(retired.dispatches.length,0);assert.equal(retired.reports.length,0);
 const active=(await read(h,a,'/sync')).save.state;assert.notEqual(active.walking.campaignId,oldId);assert.equal(active.covert.dispatches.length,0);
 assert.equal(Number(active.covert.reserves.nijo||0),0);assert.equal(active.covert.reports.length,0);assert.equal(active.home,moved.residency.castleId);
});
await test('single-army departure from a legacy player with no seat never restores the committed force after relocation or retry',async h=>{
 const lord=await actor(h,'旧城の現職','kiyosu'),a=await actor(h,'旧版の家臣','kiyosu','retainer'),enemy=await actor(h,'転居前の敵将','inuyama');
 await change(h,a,s=>{s.troops=1800;});
 const attack={requestId:crypto.randomUUID(),targetPlayerId:enemy.user.id,targetCastleId:'inuyama',troops:800,tactic:'balanced'};
 const launched=await command(h,a,'/field/attack',attack);assert(launched.marching);const before=save(h,a);
 // A formerly unsynchronised resident lacks a directory entry. The original
 // private home is still usable as the starting point, with no claim to its lord.
 h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(a.user.id);
 const moved=await call(h,a,body(h,a,'himeji'));
 assert.equal(moved.residency.role,'lord');assert.equal(seat(h,'kiyosu').lord_user_id,lord.user.id);
 assert.equal(moved.save.state.troops,before.state.troops);assert.equal(moved.save.state.march,null);
 const replay=await command(h,a,'/field/attack',attack);assert(replay.idempotent);assert.equal(replay.marching,false);
 assert.equal(replay.march.status,'cancelled');assert.equal(replay.save.state.troops,moved.save.state.troops);
 h.now+=launched.march.remainingMs;await read(h,a,'/marches');assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM field_battles').get().n,0);
});
console.log(JSON.stringify({cases,localHttpRequests:calls,maxBindings,productionRequests:0}));
