import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {getAllianceDefense,prepareRallyAttack} from './alliance.js';

const reports=[];
const read=(h,p)=>JSON.parse(h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(p.user.id).save_json);
const rev=(h,p)=>h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(p.user.id).revision;
const edit=(h,p,f)=>{const save=read(h,p);f(save.state);h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(save),p.user.id);};
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const body=(h,p,more={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:p.deviceId?rev(h,p):undefined,...more});
const command=async(h,p,path,data={},expected=200)=>(await h.api('/alliance/'+path,post(p,body(h,p,data),expected))).data;
const status=async(h,p)=>(await h.api('/alliance',{token:p.token})).data;
const unit=(h,id)=>h.sql.prepare('SELECT * FROM alliance_units WHERE id=?').get(id);
const guild=async(h,p,name)=>(await h.api('/guild',post(p,{name}))).data.guild.id;
const join=(h,p,g,expected=200)=>h.api('/guild/join',post(p,{guildId:g},expected));
async function savePlayer(h,p){
 p.deviceId||='writer-'+p.user.id;
 await h.api('/sync/lease',post(p,{deviceId:p.deviceId,takeOver:true}));
 const prior=(await h.api('/sync',{token:p.token})).data,save=prior.save||h.fresh(),clock=(await h.api('/world-clock')).data.clock;
 save.state.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};save.state.turn=Math.floor(clock.elapsedMs/60000);save.state.realtime.elapsed=clock.elapsedMs%60000/1000;
 if(!prior.save){save.state.troops=5000;save.state.command=3;save.state.resources={gold:100000,rice:100000,wood:100000,stone:100000};}
 return (await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:prior.revision,save}})).data;
}
async function players(h,names){const out=[];for(const name of names){const p=await h.session(name);await savePlayer(h,p);out.push(p);}return out;}
async function policy(h,p,change={}){
 const current=await status(h,p);return command(h,p,'policy',{...current.policy,...change});
}
async function operation(h,p,target,change={}){
 return (await command(h,p,'operations/create',{kind:target?'attack':'gather',title:'秘密の東門作戦',note:'同盟だけに共有',targetPlayerId:target?.user.id||null,castleId:target?read(h,target).state.home:'osaka',tactic:'balanced',startsAt:h.now,expiresAt:h.now+3600000,...change})).result.operationId;
}
async function scenario(name,run){const h=harness(),batch=h.db.batch.bind(h.db);let maxBindings=0;h.db.batch=statements=>{for(const statement of statements){maxBindings=Math.max(maxBindings,statement.params.length);assert(statement.params.length<=100,'D1 binding limit exceeded: '+statement.params.length);}return batch(statements);};try{await run(h);reports.push({name,calls:h.calls,maxBindings});}finally{h.close();}}
const armyHelpers={idField:v=>v,fail:(status,code,message)=>{throw Object.assign(Error(message),{status,code});}};

await scenario('Private plans, assignments, join approvals, one-use invitations and policy races',async h=>{
 const [owner,member,applicant,outsider]=await players(h,['作戦の盟主','東門の担当','加入申請者','別同盟の領主']),g=await guild(h,owner,'作戦試験同盟');
 await join(h,member,g);await guild(h,outsider,'別の同盟');
 const op=await operation(h,member,null);
 await command(h,owner,'operations/rsvp',{operationId:op,response:'yes'});
 await command(h,member,'operations/rsvp',{operationId:op,response:'maybe'});
 await command(h,member,'operations/assign',{operationId:op,playerId:owner.user.id,label:'東支拠点の守備を担当'});
 let own=await status(h,owner),task=own.operations[0].assignments[0];assert.equal(own.operations[0].rsvps.length,2);
 await command(h,owner,'operations/assign',{operationId:op,assignmentId:task.id,done:true});
 assert.equal((await status(h,member)).operations[0].assignments[0].done,true);
 const other=await status(h,outsider);assert.equal(other.operations.length,0);assert.equal(other.contributions.length,0);assert(!JSON.stringify(other).includes('秘密の東門'));
 await command(h,outsider,'operations/rsvp',{operationId:op,response:'yes'},404);
 await policy(h,owner,{joinMode:'approval',description:'初心者歓迎',activity:'日本時間20〜23時'});
 assert.equal((await join(h,applicant,g,403)).data.error.code,'GUILD_APPLICATION_REQUIRED');
 await command(h,applicant,'apply',{guildId:g,message:'夜に参加できます'});
 await command(h,member,'membership',{guildId:g,playerId:applicant.user.id,decision:'approve'},403);
 await command(h,owner,'membership',{guildId:g,playerId:applicant.user.id,decision:'approve'});
 await join(h,applicant,g);assert.equal((await status(h,applicant)).applications[0].status,'joined');
 await h.api('/guild/leave',post(applicant,{guildId:g}));
 await join(h,applicant,g,403);
 await policy(h,owner,{joinMode:'invite'});await command(h,applicant,'apply',{guildId:g,message:''},403);
 await command(h,owner,'invite',{guildId:g,playerId:applicant.user.id});
 await join(h,applicant,g);await h.api('/guild/leave',post(applicant,{guildId:g}));await join(h,applicant,g,403);
 await policy(h,owner,{joinMode:'open'});
 h.beforeStatement=(query)=>{if(query.startsWith('INSERT INTO guild_members')){h.beforeStatement=null;h.sql.prepare("UPDATE alliance_policies SET join_mode='invite',revision=revision+1 WHERE guild_id=?").run(g);}};
 await join(h,applicant,g,409);assert.equal(h.sql.prepare('SELECT guild_id FROM guild_members WHERE user_id=?').get(applicant.user.id),undefined);
 const before=(await status(h,owner)).policy.revision;
 h.beforeBatch=statements=>{if(statements[0]?.sql.includes('INSERT INTO alliance_requests')){h.beforeBatch=null;h.sql.prepare('UPDATE alliance_policies SET revision=revision+1 WHERE guild_id=?').run(g);}};
 await command(h,owner,'policy',{...(await status(h,owner)).policy,revision:before,description:'古い設定'},409);
 assert.notEqual((await status(h,owner)).policy.description,'古い設定');
});

await scenario('Treasury approval cannot bypass waiting, daily limits, capacity or changed membership',async h=>{
 const [owner,member]=await players(h,['金庫管理の盟主','金庫申請の仲間']),g=await guild(h,owner,'金庫規則試験');await join(h,member,g);
 const transfer=(p,data,expected=200)=>h.api('/guild/treasury/transfer',post(p,body(h,p,{guildId:g,direction:'withdraw',resource:'gold',amount:100,...data}),expected));
 await transfer(owner,{direction:'deposit',amount:5000});
 await policy(h,owner,{withdrawRole:'owner',dailyLimit:1000,approvalThreshold:100,newcomerHours:1});
 assert.equal((await transfer(member,{},403)).data.error.code,'TREASURY_NEW_MEMBER');
 const request=async amount=>(await command(h,member,'treasury/request',{resource:'gold',amount,transferRequestId:crypto.randomUUID()})).result.withdrawalId;
 const approved=await request(500);await command(h,owner,'treasury/approve',{withdrawalId:approved,decision:'approve'});
 await command(h,member,'treasury/claim',{withdrawalId:approved},403);
 h.now+=3600001;await savePlayer(h,owner);await savePlayer(h,member);
 assert.equal((await transfer(member,{},403)).data.error.code,'TREASURY_APPROVAL_REQUIRED');
 const before=read(h,member).state.resources.gold,r=await command(h,member,'treasury/claim',{withdrawalId:approved});
 assert.equal(r.save.state.resources.gold,before+500);
 assert.equal((await command(h,member,'treasury/claim',{withdrawalId:approved})).idempotent,true);
 const cap=await request(300);await command(h,owner,'treasury/approve',{withdrawalId:cap,decision:'approve'});
 edit(h,member,s=>{s.resources.gold=100000000;});
 assert.equal((await command(h,member,'treasury/claim',{withdrawalId:cap},409)).error.code,'ASSET_LIMIT');
 assert.equal(h.sql.prepare('SELECT status FROM alliance_withdrawals WHERE id=?').get(cap).status,'approved');
 assert.equal(h.sql.prepare('SELECT gold FROM guild_treasuries WHERE guild_id=?').get(g).gold,4500);
 edit(h,member,s=>{s.resources.gold=before+500;});await command(h,member,'treasury/claim',{withdrawalId:cap});
 const over=await request(300);await command(h,owner,'treasury/approve',{withdrawalId:over,decision:'approve'});
 assert.equal((await command(h,member,'treasury/claim',{withdrawalId:over},409)).error.code,'TREASURY_DAILY_LIMIT');
 assert.equal((await status(h,member)).contributions.filter(c=>c.kind==='treasury').length,1);
 await policy(h,owner,{newcomerHours:0});await h.api('/guild/leave',post(member,{guildId:g}));await join(h,member,g);
 assert.equal((await command(h,member,'treasury/claim',{withdrawalId:over},403)).error.code,'TREASURY_APPROVAL_REQUIRED');
});

await scenario('Troop escrow is atomic, replayable, capacity-safe and survives leaving or expiration',async h=>{
 const [owner,member,target]=await players(h,['集結主将','集結参加者','攻撃先の領主']),g=await guild(h,owner,'兵の保全試験');await join(h,member,g);
 const op=await operation(h,owner,target),before=read(h,member).state.troops,b=body(h,member,{operationId:op,troops:500});
 let arrived=0,release;const wait=new Promise(resolve=>release=resolve);
 h.beforeBatch=async statements=>{if(statements[0]?.sql.includes('INSERT INTO alliance_requests')){if(++arrived===2){h.beforeBatch=null;release();}await wait;}};
 const twins=await Promise.all([h.api('/alliance/rally/join',post(member,b)),h.api('/alliance/rally/join',post(member,b))]);
 assert.deepEqual(twins.map(r=>r.data.idempotent).sort(),[false,true]);
 const id=twins[0].data.result.unitId;assert.equal(read(h,member).state.troops,before-500);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM alliance_units').get().n,1);
 await command(h,owner,'units/recall',{unitId:id},404);
 await command(h,member,'units/recall',{unitId:id});
 const capacity=GameEngine.fromSave(read(h,member),GAME_OFFICERS).troopCapacity();
 edit(h,member,s=>{s.troops=capacity-100;});
 const claim=await command(h,member,'units/claim',{unitId:id});assert.equal(claim.result.receivedTroops,100);assert.equal(unit(h,id).troops,400);
 await command(h,member,'units/claim',{unitId:id},409);assert.equal(unit(h,id).troops,400);
 edit(h,member,s=>{s.troops=capacity-400;});await command(h,member,'units/claim',{unitId:id});assert.equal(unit(h,id).state,'claimed');
 const left=(await command(h,member,'rally/join',{operationId:op,troops:400})).result.unitId;
 await h.api('/guild/leave',post(member,{guildId:g}));
 assert.equal((await status(h,member)).units.find(u=>u.id===left).state,'returning');
 await command(h,member,'units/claim',{unitId:left});assert.equal(unit(h,left).state,'claimed');
 await join(h,member,g);
 const aid=(await command(h,member,'reinforcements/send',{targetPlayerId:owner.user.id,castleId:read(h,owner).state.home,troops:300,hours:1})).result.unitId;
 h.now+=3600001;assert.equal((await status(h,member)).units.find(u=>u.id===aid).state,'returning');
 await savePlayer(h,member);await command(h,member,'units/claim',{unitId:aid});assert.equal(unit(h,aid).troops,0);
 edit(h,owner,s=>{s.castles.nijo={owner:s.clan,troops:100,wall:1,level:1};});
 const lostCastleAid=(await command(h,member,'reinforcements/send',{targetPlayerId:owner.user.id,castleId:'nijo',troops:300,hours:1})).result.unitId;
 edit(h,owner,s=>{s.castles.nijo.owner='在地衆';});
 assert.equal((await status(h,member)).units.find(u=>u.id===lostCastleAid).state,'returning');
 assert.equal(unit(h,lostCastleAid).troops,300);await command(h,member,'units/claim',{unitId:lostCastleAid});
});

await scenario('A real pooled battle consumes only escrow, allocates losses and recovers a lost response once',async h=>{
 const [leader,ally,enemy]=await players(h,['共同出陣の主将','共同出陣の仲間','共同出陣の敵']),g=await guild(h,leader,'共同出陣試験');await join(h,ally,g);
 const op=await operation(h,leader,enemy);
 const first=(await command(h,leader,'rally/join',{operationId:op,troops:1200})).result.unitId;
 const second=(await command(h,ally,'rally/join',{operationId:op,troops:1800})).result.unitId;
 const before=read(h,leader).state.troops,enemyBefore=read(h,enemy).state.troops,launch=body(h,leader,{operationId:op});
 const u={id:leader.user.id,guild_id:g},one=await prepareRallyAttack(h.db,u,op,h.now,armyHelpers),two=await prepareRallyAttack(h.db,u,op,h.now,armyHelpers);
 assert.equal(one.troops,3000);assert.equal(one.roll,two.roll);
 h.afterBatch=statements=>{if(statements[0]?.sql.includes('INSERT INTO field_requests')){h.afterBatch=null;throw Error('Local lost response after pooled battle commit');}};
 await h.api('/alliance/rally/launch',post(leader,launch,500));
 const replay=(await h.api('/alliance/rally/launch',post(leader,{...launch,expectedRevision:0,deviceId:'different-device'}))).data;
 assert.equal(replay.idempotent,true);assert.equal(replay.battle.troops,3000);
 assert.equal(read(h,leader).state.troops,before,'leader cannot keep the participants surviving force');
 assert.equal(unit(h,first).troops+unit(h,second).troops+replay.battle.attackerLost+replay.battle.capture.garrison,3000);
 assert.equal(read(h,enemy).state.troops,enemyBefore-replay.battle.defenderLost.troops);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM field_battles').get().n,1);
 assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM alliance_contributions WHERE kind='attack'").get().n,2);
 assert.equal((await status(h,leader)).operations[0].status,'completed');
 await h.api('/field/attack',post(leader,body(h,leader,{requestId:launch.requestId,targetPlayerId:enemy.user.id,targetCastleId:read(h,enemy).state.home,troops:3000,tactic:'balanced'}),409));
 const allyReturned=unit(h,second).troops,claimBody=body(h,ally,{unitId:second});await h.api('/alliance/units/claim',post(ally,claimBody));await h.api('/alliance/units/claim',post(ally,claimBody));
 const collected=read(h,ally).state.troops;assert.equal(collected,3200+allyReturned,'returned troops are only added once');
});

await scenario('Stationed aid changes real defense; membership and zero-support races cancel the attack',async h=>{
 const [defender,helper,attacker]=await players(h,['援軍先の領主','援軍の領主','援軍を攻める領主']),g=await guild(h,defender,'援軍試験');await join(h,helper,g);
 const castle=read(h,defender).state.home,baseline=(await h.api('/field',{token:attacker.token})).data.targets.find(t=>t.playerId===defender.user.id&&t.targetCastleId===castle);
 const aid=(await command(h,helper,'reinforcements/send',{targetPlayerId:defender.user.id,castleId:castle,troops:1500,hours:1})).result.unitId;
 const support=await getAllianceDefense(h.db,{id:defender.user.id,guild_id:g},castle,h.now);assert.equal(support.troops,1500);
 const before=read(h,attacker),attackBody=body(h,attacker,{targetPlayerId:defender.user.id,targetCastleId:castle,troops:1500,tactic:'balanced'});
 h.beforeBatch=statements=>{if(statements[0]?.sql.includes('INSERT INTO field_requests')){h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(helper.user.id);}};
 await h.api('/field/attack',post(attacker,attackBody,409));assert.deepEqual(read(h,attacker),before);
 assert.equal((await status(h,helper)).units.find(u=>u.id===aid).state,'returning');await join(h,helper,g);
 const active=(await command(h,helper,'reinforcements/send',{targetPlayerId:defender.user.id,castleId:castle,troops:1000,hours:1})).result.unitId;
 const battle=(await h.api('/field/attack',post(attacker,body(h,attacker,{targetPlayerId:defender.user.id,targetCastleId:castle,troops:1500,tactic:'balanced'})))).data.battle;
 assert(battle.defensePower>baseline.defensePower,'aid must affect actual combat, not merely its card');
 assert.equal(unit(h,active).troops,battle.won?900:970);
 const empty=await h.session('同盟未所属の守備者'),zero=await getAllianceDefense(h.db,{id:empty.user.id,guild_id:null},'kiyosu',h.now);
 assert.equal(zero.troops,0);assert(h.sql.prepare('SELECT 1 AS ok WHERE '+zero.guard.sql).get(...zero.guard.args));
 await join(h,empty,g);assert.equal(h.sql.prepare('SELECT 1 AS ok WHERE '+zero.guard.sql).get(...zero.guard.args),undefined);
});

await scenario('Rallies honor target protection and intact branches, and escrow funds the captured garrison',async h=>{
 const [leader,ally,enemy]=await players(h,['包囲作戦の主将','包囲作戦の仲間','支城の城主']),g=await guild(h,leader,'城郭集結試験');await join(h,ally,g);
 edit(h,enemy,s=>{s.castles.nijo={owner:s.clan,troops:100,wall:1,level:1};});
 const branch={id:'nijo_north',parentCastleId:'nijo',direction:'north',level:1,fallen:false},seed=fallen=>{
  const branches=[{...branch,fallen}];edit(h,enemy,s=>{s.branches=branches;});
  h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,updated_at) VALUES(?,?,1,?,?) ON CONFLICT(actor_id,campaign_id) DO UPDATE SET sequence=sequence+1,state_json=excluded.state_json').run(enemy.user.id,read(h,enemy).state.walking.campaignId,JSON.stringify({branches,jobs:[]}),h.now);
 };seed(false);
 let op=await operation(h,leader,enemy,{castleId:'nijo'});const a=(await command(h,leader,'rally/join',{operationId:op,troops:1500})).result.unitId,b=(await command(h,ally,'rally/join',{operationId:op,troops:1500})).result.unitId;
 const before=[read(h,leader),read(h,enemy),unit(h,a),unit(h,b)];
 assert.equal((await command(h,leader,'rally/launch',{operationId:op},409)).error.code,'BRANCHES_REQUIRED');
 assert.deepEqual([read(h,leader),read(h,enemy),unit(h,a),unit(h,b)],before);
 h.sql.prepare('INSERT INTO pvp_protection(user_id,beginner_until) VALUES(?,?)').run(enemy.user.id,h.now+86400000);
 assert.equal((await command(h,leader,'rally/launch',{operationId:op},409)).error.code,'TARGET_REALTIME_PROTECTED');
 assert.equal(unit(h,a).troops+unit(h,b).troops,3000);
 h.sql.prepare('DELETE FROM pvp_protection WHERE user_id=?').run(enemy.user.id);
 const branchOp=await operation(h,leader,enemy,{castleId:'nijo',branchId:'nijo_north'});await command(h,ally,'rally/join',{operationId:branchOp,troops:600});
 const branchResult=(await command(h,leader,'rally/launch',{operationId:branchOp})).battle;
 assert.equal(branchResult.battleMode,'branch');assert.equal(branchResult.capture.captured,false);assert.deepEqual(branchResult.defenderLost,{troops:0,garrison:0});
 // A deterministic fixture selects a roll below the field's minimum win
 // probability; production always uses the immutable server-generated ID.
 const roster=h.sql.prepare("SELECT id,troops FROM alliance_units WHERE operation_id=? AND state='stationed' ORDER BY id").all(op).map(u=>[u.id,u.troops]),battleSeed=h.sql.prepare('SELECT resolution_seed FROM alliance_operations WHERE id=?').get(op).resolution_seed;
 assert(!JSON.stringify(await status(h,leader)).includes(battleSeed),'The battle seed must never be published');
 let fixtureId;for(let i=0;i<10000;i++){const candidate='ao_capture_fixture_'+i,hex=createHash('sha256').update(JSON.stringify(['alliance-battle-v1',battleSeed,candidate,roster])).digest('hex');if(parseInt(hex.slice(0,8),16)/4294967296<.05){fixtureId=candidate;break;}}assert(fixtureId);
 h.sql.prepare('UPDATE alliance_operations SET id=? WHERE id=?').run(fixtureId,op);h.sql.prepare('UPDATE alliance_units SET operation_id=? WHERE operation_id=?').run(fixtureId,op);op=fixtureId;
 seed(true);const at=read(h,leader).state.worldClock.elapsedMs+60000;
 h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,revision=revision+1').run(at,h.now);
 for(const p of [leader,ally,enemy])edit(h,p,s=>{s.worldClock.elapsedMs=at;s.turn=Math.floor(at/60000);s.realtime.elapsed=at%60000/1000;s.command=3;});
 const standing=read(h,leader).state.troops,captured=(await command(h,leader,'rally/launch',{operationId:op})).battle;
 assert.equal(captured.capture.captured,true);assert(captured.capture.garrison>0);
 assert.equal(unit(h,a).troops+unit(h,b).troops+captured.attackerLost+captured.capture.garrison,3000);
 assert.equal(read(h,leader).state.troops,standing);assert.equal(read(h,leader).state.castles.nijo.troops,captured.capture.garrison);
 assert.equal(read(h,leader).state.castles.nijo.owner,read(h,leader).state.clan);assert.notEqual(read(h,enemy).state.castles.nijo.owner,read(h,enemy).state.clan);
});

console.log(JSON.stringify({ok:true,calls:reports.reduce((n,r)=>n+r.calls,0),checks:reports,productionRequests:0},null,2));
