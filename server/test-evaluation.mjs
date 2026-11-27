import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {harness,settleFieldMarch} from './test-support.mjs';
import {GameEngine as E,GAME_OFFICERS as officers} from './game-runtime.js';

const checks=[];let calls=0;
const post=(player,body,expected=200)=>({method:'POST',token:player?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const saved=(h,p)=>JSON.parse(row(h,p).save_json);
const evaluate=state=>E.publicEvaluation(state,{officers});
const zero=evaluate(null);
const ordinaryCrest={id:'castle_lord',cityName:'一般拠点',title:'城主の紋章'};
const json=value=>JSON.parse(JSON.stringify(value));
function gameplay(h){return createHash('sha256').update(JSON.stringify(['player_saves','staff_campaign_backups','staff_base','field_battles','field_requests','cycle_receipts'].map(table=>h.sql.prepare('SELECT * FROM '+table+' ORDER BY 1').all()))).digest('hex');}
async function scope(name,run){const h=harness();try{await run(h);checks.push(name);console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function fixture(h,name,change=()=>{},home='kiyosu'){
  const p=await h.session(name);p.deviceId='device-'+p.user.id;
  const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,value=h.fresh(home),s=value.state;
  s.resources={gold:100000,rice:100000,wood:100000,stone:100000};s.troops=20000;s.governors={keep:s.officers[3]};
  s.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};s.turn=Math.floor(lease.clock.elapsedMs/60000);s.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  change(s);p.snapshot=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:value}})).data;return p;
}
async function update(h,p,change){
  const value=saved(h,p),clock=(await h.api('/world-clock')).data.clock;change(value.state);
  value.state.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};value.state.turn=Math.floor(clock.elapsedMs/60000);value.state.realtime.elapsed=clock.elapsedMs%60000/1000;
  return (await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:value}})).data;
}
async function me(h,p){return (await h.api('/me',{token:p.token})).data;}
async function presence(h,p){await h.api('/presence',post(p,{deviceId:p.deviceId||'present',online:true}));}
async function appoint(h,operator,p,action='appoint'){return (await h.api('/admin/staff',post(operator,{targetPlayerId:p.user.id,action,requestId:crypto.randomUUID()}))).data;}
async function operator(h,name='評価の運営'){const p=await h.session(name);await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));return p;}
function compact(value){assert.deepEqual(Object.keys(value).sort(),['maxScore','rankId','rankIndex','rankName','score','version'].sort());assert.equal(value.version,1);assert.equal(value.maxScore,100000);assert(Number.isSafeInteger(value.score));}
async function victory(run){const original=crypto.getRandomValues;crypto.getRandomValues=function(array){return array instanceof Uint32Array&&array.length===1?array.fill(0):original.call(crypto,array);};try{return await run();}finally{crypto.getRandomValues=original;}}

await scope('unsaved identities receive zero rank and cannot submit or promote a title through profile, chat or save metadata',async h=>{
  const p=await h.session('未保存の評価');assert.deepEqual(p.user.evaluation,zero);assert.equal(zero.score,0);assert.equal(zero.rankName,'無位');compact(zero);
  const fake={version:1,score:100000,maxScore:100000,rankId:'shou-1',rankName:'正一位',rankIndex:16};
  const profile=(await h.api('/profile',{method:'PATCH',token:p.token,body:{name:p.user.name,evaluation:fake,isAdmin:true}})).data.user;
  assert.deepEqual(profile.evaluation,zero);assert.equal(profile.isAdmin,false);
  const message=(await h.api('/chat',post(p,{channel:'world',text:'称号は自称できません',evaluation:fake}))).data.message;assert.deepEqual(message.evaluation,zero);
  const noSave=gameplay(h);await me(h,p);assert.equal(gameplay(h),noSave);
  const q=await fixture(h,'保存済みの評価',s=>{s.evaluation=fake;s.score=100000;s.rankName='正一位';});
  assert.deepEqual(q.snapshot.user.evaluation,evaluate(q.snapshot.save.state));assert(q.snapshot.user.evaluation.score<100000);
  for(const key of ['evaluation','score','rankName'])assert.equal(key in saved(h,q).state,false);
  await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));const admin=(await me(h,p)).user;assert(admin.isAdmin);assert.deepEqual(admin.evaluation,zero,'Role badges do not grant an unsaved title');
});

await scope('identity, sync, profile, online, friends, guild members, owners and recent logins publish one current evaluation',async h=>{
  const a=await fixture(h,'評価共有の甲',s=>{s.prestige=8000;s.stats.battles=20;s.stats.wins=15;s.buildings.keep=16;}),b=await fixture(h,'評価共有の乙'),admin=await operator(h);
  const expected=evaluate(saved(h,a).state),before=gameplay(h);compact(expected);
  assert.deepEqual(a.snapshot.user.evaluation,expected);assert.deepEqual((await me(h,a)).user.evaluation,expected);
  const profile=(await h.api('/profile',{method:'PATCH',token:a.token,body:{name:a.user.name}})).data.user;assert.deepEqual(profile.evaluation,expected);
  await presence(h,a);assert.deepEqual((await h.api('/online')).data.players.find(p=>p.id===a.user.id).evaluation,expected);
  assert.deepEqual((await h.api('/players?q='+encodeURIComponent('評価共有'),{token:b.token})).data.players.find(p=>p.id===a.user.id).evaluation,expected);
  await h.api('/friends/request',post(a,{userId:b.user.id}));assert.deepEqual((await me(h,b)).requests[0].evaluation,expected);
  await h.api('/friends/respond',post(b,{userId:a.user.id,accept:true}));assert.deepEqual((await me(h,b)).friends[0].evaluation,expected);
  const guild=(await h.api('/guild',post(a,{name:'位階確認の軍団'}))).data.guild;assert.deepEqual(guild.ownerEvaluation,expected);await h.api('/guild/join',post(b,{guildId:guild.id}));
  assert.deepEqual((await h.api('/guild',{token:b.token})).data.members.find(p=>p.id===a.user.id).evaluation,expected);
  assert.deepEqual((await h.api('/guilds',{token:b.token})).data.guilds[0].ownerEvaluation,expected);
  assert.deepEqual((await h.api('/guild/rankings')).data.guilds[0].ownerEvaluation,expected);
  assert.deepEqual((await h.api('/staff/recent-logins',{token:admin.token})).data.players.find(p=>p.id===a.user.id).evaluation,expected);
  assert.equal(gameplay(h),before,'Identity/list reads and social metadata never update gameplay saves');
});

await scope('empty chat deltas refresh recent same-room authors and do not expose a private-room participant',async h=>{
  const a=await fixture(h,'会話評価の甲'),b=await fixture(h,'会話評価の乙'),secret=await fixture(h,'非公開会話の領主');
  const world=(await h.api('/chat',post(a,{channel:'world',text:'以前の発言'}))).data.message;
  await h.api('/guild',post(secret,{name:'秘密の部屋'}));await h.api('/chat',post(secret,{channel:'guild',text:'別室の発言'}));
  const upgraded=await update(h,a,s=>{s.prestige=20000;});assert(upgraded.user.evaluation.score>world.evaluation.score);
  const before=gameplay(h),read=(await h.api('/chat?channel=world&after='+world.id,{token:b.token})).data;
  assert.deepEqual(read.messages,[]);assert.deepEqual(read.playerEvaluations,[{playerId:a.user.id,name:a.user.name,avatarVersion:null,courtOffice:null,cityHonors:[ordinaryCrest],evaluation:upgraded.user.evaluation,appearance:{nameplate:null,town:null,badge:null,ownedProducts:[]}}]);assert(!JSON.stringify(read).includes(secret.user.id));assert.equal(gameplay(h),before);
  const full=(await h.api('/chat?channel=world',{token:b.token})).data;assert.deepEqual(full.messages[0].evaluation,upgraded.user.evaluation);assert.equal(full.messages[0].text,world.text);
});

await scope('empty private-letter deltas update both participants while outsiders and departed guild members remain isolated',async h=>{
  const a=await fixture(h,'書状評価の甲'),b=await fixture(h,'書状評価の乙'),c=await fixture(h,'書状評価の第三者');
  const sent=(await h.api('/letters',post(a,{requestId:'evaluation-letter',destination:'player',targetPlayerId:b.user.id,text:'位階の確認'}))).data;
  assert.deepEqual(sent.message.authorEvaluation,evaluate(saved(h,a).state));assert.deepEqual(sent.thread.peer.evaluation,evaluate(saved(h,b).state));
  const upgraded=await update(h,a,s=>{s.prestige=16000;}),before=gameplay(h);
  const read=(await h.api('/letters/'+sent.thread.id+'?after='+sent.message.seq,{token:b.token})).data;
  assert.deepEqual(read.messages,[]);assert.deepEqual(read.thread.peer.evaluation,upgraded.user.evaluation);assert.deepEqual(read.thread.lastMessage.authorEvaluation,upgraded.user.evaluation);
  assert.deepEqual(new Set(read.playerEvaluations.map(p=>p.playerId)),new Set([a.user.id,b.user.id]));assert.deepEqual(read.playerEvaluations.find(p=>p.playerId===a.user.id).evaluation,upgraded.user.evaluation);
  await h.api('/letters/'+sent.thread.id,{token:c.token,expected:404});assert.equal(gameplay(h),before);
  const guild=(await h.api('/guild',post(b,{name:'書状評価の軍団'}))).data.guild;await h.api('/guild/join',post(c,{guildId:guild.id}));
  const outside=(await h.api('/letters',post(a,{requestId:'evaluation-guild-letter',destination:'guild',targetPlayerId:b.user.id,guildId:guild.id,text:'外からの書状'}))).data;
  const guildRead=(await h.api('/letters/'+outside.thread.id,{token:c.token})).data;assert.deepEqual(guildRead.thread.sender.evaluation,upgraded.user.evaluation);assert.deepEqual(guildRead.thread.contextPlayer.evaluation,evaluate(saved(h,b).state));
  await h.api('/guild/leave',post(c,{}));let evaluationReads=0;h.beforeBatch=statements=>{evaluationReads+=statements.filter(s=>s.sql.includes('/* player-evaluation */')).length;};
  await h.api('/letters/'+outside.thread.id+'?after='+outside.message.seq,{token:c.token,expected:404});assert.equal(evaluationReads,0,'Denied thread reads never evaluate or disclose participants');
});

await scope('shared staff facilities and due jobs affect the title through read-only projection, then demotion restores personal development',async h=>{
  const admin=await operator(h),staff=await fixture(h,'共同評価のスタッフ',s=>{s.buildings.keep=3;s.castles[s.home].level=7;});
  const personal=json(saved(h,staff));await appoint(h,admin,staff);await h.api('/sync?deviceId='+staff.deviceId,{token:staff.token});
  const sharedRow=h.sql.prepare("SELECT * FROM staff_base WHERE id='kyoto_gosho'").get(),shared=JSON.parse(sharedRow.state_json);
  shared.castleLevel=shared.initial.castleLevel=64;shared.buildings.keep=shared.initial.buildings.keep=8;shared.buildings.gold_mine=shared.initial.buildings.gold_mine=4;
  shared.jobs=[{jobId:'eval-job',kind:'building',id:'keep',targetLevel:9,totalSeconds:60,queuedAtElapsedMs:0,startedElapsedMs:0,completesElapsedMs:60000,startedBy:{id:staff.user.id,name:staff.user.name}}];
  h.sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='kyoto_gosho'").run(JSON.stringify(shared));
  const backup=JSON.parse(h.sql.prepare('SELECT save_json FROM staff_campaign_backups WHERE user_id=?').get(staff.user.id).save_json).state;
  const base={...shared,id:'kyoto_gosho',revision:sharedRow.revision+1,accessSinceElapsedMs:0,clanSinceElapsedMs:0,personalClan:backup.clan,personalHome:backup.home,personalCycleHome:backup.cycle.home,personalBaseCastle:backup.castles.kyoto_gosho,personalHomeCastle:backup.castles[backup.home]};
  const game=E.fromSave(saved(h,staff),officers,{isStaff:true,staffBase:base}),before=gameplay(h),current=(await me(h,staff)).user;
  assert.deepEqual(current.evaluation,evaluate(game.state));assert.notDeepEqual(current.evaluation,evaluate(saved(h,staff).state));assert.equal(gameplay(h),before);
  h.now+=60000;game._projectStaffAt(60000);const due=(await me(h,staff)).user;assert.deepEqual(due.evaluation,evaluate(game.state));assert(due.evaluation.score>current.evaluation.score);assert.equal(gameplay(h),before,'A title read never settles the shared construction row');
  const dismissal=await appoint(h,admin,staff,'dismiss');assert.equal(dismissal.user.isStaff,false);assert.deepEqual(dismissal.user.evaluation,evaluate(E.fromSave(personal,officers).state));
  const afterDismiss=gameplay(h);assert.deepEqual((await me(h,staff)).user.evaluation,dismissal.user.evaluation);assert.equal(gameplay(h),afterDismiss,'Reading a former staff title does not perform the campaign restoration write');
});

await scope('role adoption and administrative recovery are projected without gaining arbitrary titles or changing saved formations',async h=>{
  const p=await fixture(h,'役職評価の領主',s=>{s.prestige=9000;s.castles[s.home].level=24;}),before=gameplay(h),raw=saved(h,p);
  const claimed=(await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}))).data;const admin=E.fromSave(raw,officers,{isAdmin:true});
  assert(claimed.user.isAdmin);assert.deepEqual(claimed.user.evaluation,evaluate(admin.state));assert.equal(gameplay(h),before);
  const recover=(await h.api('/admin/recover',{method:'POST',body:{key:h.env.SENGOKU_ADMIN_KEY,requestId:crypto.randomUUID(),deviceName:'評価端末'}})).data;
  assert.equal(recover.user.id,p.user.id);assert.deepEqual(recover.user.evaluation,claimed.user.evaluation);assert.equal(gameplay(h),before);
});

await scope('a pending world cycle counts only the retained home and does not simulate, grant rewards or reset the durable save',async h=>{
  const p=await fixture(h,'周回評価の領主',s=>{s.castles.nijo={owner:s.clan,level:48,wall:5,troops:2000};s.castles.osaka={owner:s.clan,level:48,wall:5,troops:2000};s.castles[s.home].level=20;});
  const original=saved(h,p),previous=evaluate(original.state),projection=E.fromSave(original,officers);projection._settleCycle(1);
  h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=0').run(672*60000,h.now);
  const before=gameplay(h),result=(await me(h,p)).user.evaluation;assert.deepEqual(result,evaluate(projection.state));assert(result.score<previous.score);assert.equal(gameplay(h),before);
  assert.deepEqual(saved(h,p).state.army,original.state.army);assert.deepEqual(saved(h,p).state.governors,original.state.governors);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM cycle_receipts').get().n,0);
});

await scope('committed PvP wins, field targets, history, system-mail participants, achievements and guild ledgers agree without changing receipts',async h=>{
  const a=await fixture(h,'合戦評価の攻撃'),d=await fixture(h,'合戦評価の守備',s=>{s.castles.nijo={owner:s.clan,level:20,wall:4,troops:1000};},'inuyama');
  const body={requestId:'evaluation-battle',targetPlayerId:d.user.id,targetCastleId:'nijo',troops:3000,tactic:'balanced',deviceId:a.deviceId,expectedRevision:row(h,a).revision};
  const previousWins=saved(h,a).state.stats.wins,departure=(await victory(()=>h.api('/field/attack',post(a,body)))).data;
  const completed=await settleFieldMarch(h,a,departure);
  const result=(await h.api('/field/attack',post(a,body))).data,expectedA=evaluate(saved(h,a).state),expectedD=evaluate(saved(h,d).state);
  assert.equal(result.battle.id,completed.id);
  assert.equal(saved(h,a).state.stats.wins,previousWins+1);assert.deepEqual(result.battle.attackerEvaluation,expectedA);assert.deepEqual(result.battle.defenderEvaluation,expectedD);
  const immutable=h.sql.prepare('SELECT result_json FROM field_requests WHERE actor_id=? AND request_id=?').get(a.user.id,body.requestId).result_json;assert(!immutable.includes('Evaluation'));
  const field=(await h.api('/field',{token:a.token})).data,before=gameplay(h);for(const p of field.targets)assert.deepEqual(p.evaluation,p.playerId===a.user.id?expectedA:expectedD);
  const history=(await h.api('/field/me?deviceId='+a.deviceId,{token:a.token})).data;assert.deepEqual(history.battles[0].attackerEvaluation,expectedA);
  for(const actor of [a,d]){const mail=(await h.api('/mail',{token:actor.token})).data.mail[0];assert.equal(mail.source,'system');assert.deepEqual(mail.participants,[{playerId:a.user.id,name:a.user.name,avatarVersion:null,courtOffice:null,cityHonors:[{id:'nijo',cityName:'二条御所',title:'二条御所の勲章'},ordinaryCrest],side:'attacker',evaluation:expectedA,appearance:{nameplate:null,town:null,badge:null,ownedProducts:[]}},{playerId:d.user.id,name:d.user.name,avatarVersion:null,courtOffice:null,cityHonors:[ordinaryCrest],side:'defender',evaluation:expectedD,appearance:{nameplate:null,town:null,badge:null,ownedProducts:[]}}]);}
  const events=(await h.api('/achievements')).data.events.filter(e=>e.playerId===a.user.id);assert(events.length);for(const event of events)assert.deepEqual(event.playerEvaluation,expectedA);
  const replay=(await h.api('/field/attack',post(a,body))).data;assert(replay.idempotent);assert.deepEqual(replay.battle.attackerEvaluation,expectedA);assert.equal(gameplay(h),before);
  await h.api('/sync/lease',post(a,{deviceId:a.deviceId}));
  const guild=(await h.api('/guild',post(a,{name:'評価資産の軍団'}))).data.guild,receipt=(await h.api('/guild/treasury/transfer',post(a,{guildId:guild.id,resource:'gold',amount:100,direction:'deposit',requestId:'evaluation-transfer',deviceId:a.deviceId,expectedRevision:row(h,a).revision}))).data.receipt;
  assert.deepEqual(receipt.playerEvaluation,expectedA);assert.deepEqual((await h.api('/guild/treasury',{token:a.token})).data.ledger[0].playerEvaluation,expectedA);
  assert(!h.sql.prepare('SELECT result_json FROM guild_asset_requests WHERE actor_id=?').get(a.user.id).result_json.includes('Evaluation'));
});

await scope('unreadable saves and missing historical participants stay unverified instead of being demoted to zero',async h=>{
  const p=await fixture(h,'未確認評価の領主'),prior=row(h,p);h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run('{invalid-json',p.user.id);
  assert.equal((await me(h,p)).user.evaluation,null);assert.equal(row(h,p).save_json,'{invalid-json');
  h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(prior.save_json,p.user.id);
  const guild=(await h.api('/guild',post(p,{name:'旧記録の評価'}))).data.guild;
  await h.api('/guild/treasury/transfer',post(p,{guildId:guild.id,resource:'gold',amount:1,direction:'deposit',requestId:'old-evaluation-transfer',deviceId:p.deviceId,expectedRevision:row(h,p).revision}));
  h.sql.prepare("UPDATE guild_asset_requests SET result_json=json_set(result_json,'$.playerId','u_missing') WHERE actor_id=?").run(p.user.id);
  assert.equal((await h.api('/guild/treasury',{token:p.token})).data.ledger[0].playerEvaluation,null);
});

await scope('a full 100-player public page batches IDs and normalizes each large save once, without leaking raw gameplay',async h=>{
  await h.api('/world-clock');const game=new E({officers,seed:18});
  for(const officer of officers)for(const rank of globalThis.SENGOKU_DATA.ranks)game._grantOfficerVariant(officer.id,rank);
  for(const def of globalThis.SENGOKU_DATA.buildings)game.state.buildings[def.id]=32;
  game.state.log=Array.from({length:200},(_,i)=>({turn:0,kind:'test',text:'記録'+i+'・'.repeat(900)}));
  const raw=game.exportSave(),insertUser=h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)'),insertSave=h.sql.prepare('INSERT INTO player_saves(user_id,save_json,revision) VALUES(?,?,1)'),insertPresence=h.sql.prepare('INSERT INTO player_presence(user_id,device_id,device_name,online,last_seen) VALUES(?,?,?,1,?)');
  for(let i=0;i<100;i++){const id='u_bulk_'+String(i).padStart(3,'0');insertUser.run(id,'多数評価'+i,'bulk'+i,game.state.clan,'hash'+i,h.now,h.now);insertSave.run(id,raw);insertPresence.run(id,'device','fixture',h.now);}
  let evaluated=0;const original=E.publicEvaluation,queryIds=[];E.publicEvaluation=(state,options)=>{if(state)evaluated++;return original(state,options);};h.beforeBatch=statements=>{for(const statement of statements)if(statement.sql.includes('/* player-evaluation */'))queryIds.push(...statement.params);};
  let response;const start=performance.now();try{response=(await h.api('/online?limit=100')).data;}finally{E.publicEvaluation=original;}
  assert.equal(response.players.length,100);assert.equal(evaluated,100);assert.equal(queryIds.length,100);assert.equal(new Set(queryIds).size,100);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM player_saves WHERE save_json<>? OR revision<>1').get(raw).n,0);
  for(const player of response.players){compact(player.evaluation);assert.deepEqual(player.evaluation,response.players[0].evaluation);}
  const text=JSON.stringify(response);for(const privateKey of ['save_json','backup_json','token_hash','officerVariants','governors','resources','log'])assert(!text.includes('"'+privateKey+'"'));
  console.log('INFO 100 large-save players evaluated once each in '+Math.round(performance.now()-start)+' ms (local SQLite fixture).');
});

console.log(JSON.stringify({passed:checks.length,localHttpCalls:calls,productionRequests:0}));
