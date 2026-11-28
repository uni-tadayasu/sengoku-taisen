import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {COURT_OFFICES} from './court-offices.js';
import {nominateSuccessor,certifySuccessor,makeImperial} from './test-court-support.mjs';
import {readCourtProtection} from './court-protection.js';

const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
const seat=(h,id)=>h.sql.prepare('SELECT * FROM castle_seats WHERE castle_id=?').get(id);
const resources=['gold','rice','wood','stone'];
let checks=0,calls=0;
async function scope(name,fn){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements)assert(s.params.length<=100,'D1 binding limit: '+s.params.length+' '+s.sql.slice(0,80));return batch(statements);};
 try{await fn(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}
async function player(h,name,{home='kiyosu',holdings=[],admin=false,staff=false}={}){
 const p=await h.session(name);p.deviceId='court-protected-'+p.user.id;
 if(admin){await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));h.operator=p;}
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data,value=h.fresh(home),s=value.state;
 s.resources={gold:50000,rice:50000,wood:50000,stone:50000};s.troops=20000;s.buildings.keep=20;s.buildings.wall=7;
 s.castles[home].level=12;s.castles[home].troops=2000;
 s.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};s.turn=Math.floor(lease.clock.elapsedMs/60000);s.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
 for(const id of holdings){s.castles[id]={owner:s.clan,troops:1600,wall:6,level:9};if(!s.captureRewards.includes(id))s.captureRewards.push(id);}
 await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:lease.revision,save:value}});
 if(staff){await h.api('/admin/staff',post(h.operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));await h.api('/sync?deviceId='+p.deviceId,{token:p.token});}
 return p;
}
async function appoint(h,p,{officeId='chunagon',action='appoint'}={}){
 const directory=(await h.api('/admin/court/offices',{token:h.operator.token})).data;
 return(await h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action,officeId,targetPlayerId:p.user.id,expectedRevision:directory.revision}))).data;
}
function rawAppoint(h,p,officeId='chunagon'){
 h.sql.prepare('INSERT INTO court_office_appointments(office_id,user_id,appointment_token,appointed_by,appointed_at) VALUES(?,?,?,?,?)').run(officeId,p.user.id,crypto.randomUUID(),h.operator.user.id,h.now);
}
async function regent(h,p,action='appoint'){
 const directory=(await h.api('/admin/court/regent',{token:h.operator.token})).data;
 return h.api('/admin/court/regent',post(h.operator,{requestId:crypto.randomUUID(),action,targetPlayerId:p.user.id,expectedRevision:directory.revision}));
}
async function retiredEmperor(h,p){
 await h.api('/admin/staff',post(h.operator,{targetPlayerId:p.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 await h.api('/sync?deviceId='+p.deviceId,{token:p.token});
 makeImperial(h,p);
 await h.api('/admin/court/leader',post(h.operator,{requestId:crypto.randomUUID(),targetPlayerId:p.user.id}));
 const successor=await player(h,'即位する御所の領主',{home:'himeji',staff:true});
 const nomination=(await nominateSuccessor(h,p,successor)).nomination;
 await certifySuccessor(h,h.operator,nomination);
 const restored=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
 assert.equal(restored.user.isStaff,false);assert.equal(restored.entitlements.courtProtected,true);assert.equal(restored.save.state.home,'sento_gosho');
 return p;
}
async function protectAs(h,p,role){if(role==='regent')await regent(h,p);else await retiredEmperor(h,p);}
function tune(h,p,change){const value=save(h,p);change(value.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(value),p.user.id);}
const request=(h,a,d,castleId)=>({targetPlayerId:d.user.id,targetCastleId:castleId,troops:3000,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:a.deviceId,expectedRevision:row(h,a).revision});
async function win(fn){const original=crypto.getRandomValues;crypto.getRandomValues=function(v){return v instanceof Uint32Array&&v.length===1?v.fill(0):original.call(crypto,v);};try{return await fn();}finally{crypto.getRandomValues=original;}}
const status=async(h,p)=>(await h.api('/marches?deviceId='+p.deviceId,{token:p.token})).data;
async function depart(h,a,d,castleId){return win(async()=>(await h.api('/field/attack',post(a,request(h,a,d,castleId)))).data);}
async function settle(h,a,departure){h.now+=departure.march.remainingMs;const result=await status(h,a),receipt=result.history.find(item=>item.id===departure.march.id);assert.equal(receipt?.status,'resolved');return receipt.battle;}
async function transit(h,p){
 const snap=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
 const game=GameEngine.fromSave(snap.save,GAME_OFFICERS,{isAdmin:snap.user.isAdmin,isStaff:snap.user.isStaff,isCourtProtected:!!snap.entitlements?.courtProtected,staffBase:snap.staffBase,maintenanceAuthority:snap.maintenanceAuthority,courtEstateProjection:snap.courtEstateProjection,branchAuthority:{resolvedElapsedMs:snap.branchResolvedElapsedMs}});
 const moved=game.applyWorldClock(snap.clock,{maxSeconds:86400,deferCycleSettlement:true});assert(moved.ok&&!moved.pending&&!moved.courtEstatePending);return game.state;
}
async function retainer(h,lord,name='仕える家臣'){
 await h.api('/castles/residency?castleId='+save(h,lord).state.home,{token:lord.token});
 const p=await h.session(name);p.deviceId='court-retainer-'+p.user.id;
 const lease=(await h.api('/sync/lease',post(p,{deviceId:p.deviceId}))).data;
 await h.api('/castles/residency/start',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,revision:lease.revision,castleId:save(h,lord).state.home,mode:'retainer',clan:'織田家',difficulty:'normal'}));
 return p;
}
function beforeFieldCommit(h,fn){h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO field_requests'))return;h.beforeBatch=null;fn();};}
function legacyCpuDefeat(h,p){
 const home=save(h,p).state.home;
 tune(h,p,s=>{s.home=home;s.cycle.home=home;s.turn=8;s.realtime.elapsed=59;s.worldClock={id:'world-v1',elapsedMs:539000};s.troops=0;s.gameOver=false;s.army=[];s.seed=1;for(const castle of Object.values(s.castles))Object.assign(castle,{owner:'在地衆',troops:100000,wall:1,level:1});Object.assign(s.castles[home],{owner:s.clan,troops:100});});
 const source=save(h,p);let advanced=null;
 for(let seed=1;seed<1000;seed++){
  source.state.seed=seed;const game=GameEngine.fromSave(source,GAME_OFFICERS,{isCourtProtected:false});
  game.applyWorldClock({id:'world-v1',elapsedMs:540000,running:true,speed:1},{maxSeconds:86400,deferCycleSettlement:true});
  if(game.takeHomeDefenseLosses().some(event=>event.castleId===home)){advanced=JSON.parse(game.exportSave());break;}
 }
 assert(advanced,'unprotected legacy simulation must have an actual CPU defeat');
 h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(source),p.user.id);
 h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=539000,anchor_real_ms=?,revision=revision+1').run(h.now);h.now+=1000;
 return advanced;
}
async function upload(h,p,value,expected=200){
 // These cases exercise an older gameplay save's CPU-defeat claim, using the
 // current authenticated transport envelope. Keep that claimed defeat intact;
 // refreshing authority must not replace it with the server's undamaged save.
 const snap=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
 return h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:snap.revision,maintenanceRevision:snap.maintenanceAuthority.revision,courtEstateProof:snap.courtEstateProjection?.proof??null,save:value},expected});
}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Court base tests must never access a real service');};
try{
 await scope('the current Emperor retains verified occupation protection without exposing a new public role flag',async h=>{
  await player(h,'天皇保全の太政大臣',{admin:true});const emperor=await player(h,'在位する天皇',{staff:true});
  makeImperial(h,emperor);await h.api('/admin/court/leader',post(h.operator,{requestId:crypto.randomUUID(),targetPlayerId:emperor.user.id}));
  const snap=(await h.api('/sync?deviceId='+emperor.deviceId,{token:emperor.token})).data;assert.equal(snap.entitlements.courtProtected,true);assert.equal(snap.save.state.home,'kyoto_gosho');
  const visible=(await h.api('/field')).data.players.find(p=>p.playerId===emperor.user.id);assert.equal(visible.capturable,false);assert.equal(visible.homeCastleId,'kyoto_gosho');
  assert(!Object.hasOwn(visible,'isCourtProtected'));assert(!Object.hasOwn(visible,'courtProtected'));assert(!Object.hasOwn(visible,'entitlements'));
 });
 for(const role of ['regent','retired'])for(const targetKind of ['home','outpost'])await scope(role+' retains '+targetKind+' ownership after an actual winning attack',async h=>{
  await player(h,'皇室保全の太政大臣',{admin:true});const actor=await player(h,'皇室拠点への攻撃者',{home:'inuyama'}),defender=await player(h,'皇室の拠点領主');
  await protectAs(h,defender,role);const home=save(h,defender).state.home;if(role==='regent')await retainer(h,defender);
  tune(h,defender,s=>{s.resources={gold:50000,rice:50000,wood:50000,stone:50000};s.castles.nijo={owner:s.clan,troops:100,wall:1,level:1};s.castles[home].troops=100;s.castles[home].wall=1;s.buildings.wall=1;s.army=[];s.troops=100;});
  const castleId=targetKind==='home'?home:'nijo',before=seat(h,home),battle=await settle(h,actor,await depart(h,actor,defender,castleId));
  const sento=role==='retired'&&targetKind==='home';assert.equal(battle.won,true);assert.equal(battle.capture.captured,false);assert.equal(battle.battleMode,sento?'reward':'raid');assert.equal(battle.succession,undefined);
  if(sento){assert.deepEqual(battle.defenderLost,{troops:0,garrison:0});assert.equal(seat(h,home),undefined);}
  assert.equal(save(h,defender).state.castles[castleId].owner,save(h,defender).state.clan);assert.deepEqual(seat(h,home),before);assert.equal(battle.lootFraction,.5);assert(battle.loot.gold>0);
 });
 await scope('Regent protects its ordinary home against a legacy CPU-defeat save with the current sync envelope',async h=>{
  await player(h,'皇室同期の太政大臣',{admin:true});const lord=await player(h,'皇室同期の城主');await regent(h,lord);
  const home=save(h,lord).state.home;await retainer(h,lord);const oldClient=legacyCpuDefeat(h,lord),before=seat(h,home),done=(await upload(h,lord,oldClient)).data;
  assert.equal(done.entitlements.courtProtected,true);assert.equal(done.save.state.home,home);assert.equal(done.save.state.castles[home].owner,done.save.state.clan);assert.equal(done.save.state.gameOver,false);assert.deepEqual(seat(h,home),before);assert.equal(done.residency.role,'lord');
 });
 for(const appointedAtDeparture of [false,true])await scope('Regent '+(appointedAtDeparture?'dismissal':'appointment')+' during a march uses the current role on arrival',async h=>{
  await player(h,'摂政任期の太政大臣',{admin:true});const actor=await player(h,'摂政任期の攻撃者',{home:'inuyama'}),defender=await player(h,'摂政任期の守備者',{holdings:['nijo']});
  if(appointedAtDeparture)await regent(h,defender);
  const departure=await depart(h,actor,defender,'nijo');await regent(h,defender,appointedAtDeparture?'dismiss':'appoint');
  const battle=await settle(h,actor,departure);assert.equal(battle.won,true);assert.equal(battle.capture.captured,appointedAtDeparture);
 });
 await scope('Regent dismissal racing a siege commit retries under the current unprotected role',async h=>{
  await player(h,'摂政競合の太政大臣',{admin:true});const actor=await player(h,'摂政競合の攻撃者',{home:'inuyama'}),defender=await player(h,'摂政競合の守備者',{holdings:['nijo']});await regent(h,defender);
  const departure=await depart(h,actor,defender,'nijo'),beforeActor=row(h,actor),beforeDefender=row(h,defender);h.now+=departure.march.remainingMs;
  let raced=false;beforeFieldCommit(h,()=>{raced=true;h.sql.exec('DELETE FROM court_regent');});
  const pending=await status(h,actor);assert(raced);assert.equal(pending.active[0]?.id,departure.march.id);assert.deepEqual(row(h,actor),beforeActor);assert.deepEqual(row(h,defender),beforeDefender);
  const finished=await status(h,actor),battle=finished.history.find(m=>m.id===departure.march.id).battle;assert.equal(battle.capture.captured,true);
 });
 await scope('a banned Retired Emperor does not retain active protection through the historical succession record',async h=>{
  await player(h,'上皇利用確認の太政大臣',{admin:true});const retired=await player(h,'利用確認の上皇');await retiredEmperor(h,retired);
  assert.equal((await readCourtProtection(h.db,retired.user.id)).protected,true);
  h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(retired.user.id,h.operator.user.id,h.now);
  assert.equal((await readCourtProtection(h.db,retired.user.id)).protected,false);
 });
 await scope('a pending succession nomination does not protect a former Emperor after administrative dismissal',async h=>{
  await player(h,'退位未承認の太政大臣',{admin:true});const emperor=await player(h,'退位未承認の天皇',{staff:true}),successor=await player(h,'指名のみの後継者',{home:'himeji',staff:true});
  makeImperial(h,emperor);await h.api('/admin/court/leader',post(h.operator,{requestId:crypto.randomUUID(),targetPlayerId:emperor.user.id}));
  const nominated=await nominateSuccessor(h,emperor,successor);assert.equal(nominated.nomination.status,'pending');
  assert.equal(count(h,'court_succession_requests'),0);assert.equal(count(h,'court_retired_emperors'),0);
  await h.api('/admin/staff',post(h.operator,{requestId:crypto.randomUUID(),targetPlayerId:emperor.user.id,action:'dismiss'}));
  const restored=(await h.api('/sync?deviceId='+emperor.deviceId,{token:emperor.token})).data;
  assert.equal(restored.user.isStaff,false);assert.equal(restored.save.state.home,'kiyosu');assert.equal(restored.entitlements.courtProtected,false);
  assert.equal((await readCourtProtection(h.db,emperor.user.id)).protected,false);assert.equal(count(h,'court_retired_emperors'),0);
 });
 for(const office of COURT_OFFICES)await scope(office.title+' keeps an owned major outpost while normal damage and exact half-resource loot remain',async h=>{
  await player(h,'任命する太政大臣',{admin:true});const actor=await player(h,'攻める領主',{home:'inuyama'}),defender=await player(h,'任命される領主',{holdings:['nijo']});await appoint(h,defender,{officeId:office.id});
  const target=(await h.api('/field',{token:actor.token})).data.targets.find(t=>t.playerId===defender.user.id&&t.targetCastleId==='nijo');
  assert.equal(target.battleMode,'raid');assert.equal(target.capturable,false);assert.equal(target.attackable,true);
  const departure=await depart(h,actor,defender,'nijo');h.now+=departure.march.remainingMs;
  const defenderBefore=await transit(h,defender),done=await status(h,actor),battle=done.history.find(item=>item.id===departure.march.id).battle,after=save(h,defender).state;
  assert.equal(battle.won,true);assert.equal(battle.capture.captured,false);assert.equal(battle.battleMode,'raid');assert.equal(after.castles.nijo.owner,after.clan);assert.notEqual(save(h,actor).state.castles.nijo.owner,save(h,actor).state.clan);
  assert(battle.defenderLost.troops>0);assert(battle.defenderLost.garrison>0);assert(battle.durability.damage>0);assert.equal(battle.lootFraction,.5);
  for(const key of resources){assert.equal(battle.loot[key],Math.floor(defenderBefore.resources[key]/2),key+' transfers exactly one half');assert.equal(after.resources[key],defenderBefore.resources[key]-battle.loot[key]);}
  assert.equal(count(h,'castle_successions'),0);
 });
 await scope('an appointed major home keeps its home, cycle anchor and ownership after a winning siege',async h=>{
  await player(h,'本拠任命の太政大臣',{admin:true});const actor=await player(h,'大都市を攻める領主',{home:'inuyama'}),defender=await player(h,'大都市の太政官',{home:'osaka'});await appoint(h,defender);
  const battle=await settle(h,actor,await depart(h,actor,defender,'osaka')),after=save(h,defender).state;
  assert(battle.won);assert.equal(battle.capture.captured,false);assert.equal(after.home,'osaka');assert.equal(after.cycle.home,'osaka');assert.equal(row(h,defender).cycle_home,'osaka');assert.equal(after.castles.osaka.owner,after.clan);
 });
 await scope('a regular home retains its lord and FIFO retainers after field defeat',async h=>{
  await player(h,'領主保全の太政大臣',{admin:true});const actor=await player(h,'城主へ攻める領主',{home:'inuyama'}),defender=await player(h,'在任する城主');await retainer(h,defender);await appoint(h,defender);
  const before=seat(h,'kiyosu'),battle=await settle(h,actor,await depart(h,actor,defender,'kiyosu'));
  assert(battle.won);assert.equal(battle.capture.captured,false);assert.equal(battle.succession,undefined);assert.deepEqual(seat(h,'kiyosu'),before);assert.equal(count(h,'castle_successions'),0);
  const roster=(await h.api('/castles/residency?castleId=kiyosu',{token:defender.token})).data;assert.equal(roster.self.role,'lord');assert.equal(roster.roster.retainers.length,1);
 });
 await scope('an appointment during march protects arrival even when departure showed a capturable city',async h=>{
  await player(h,'進軍中任命の太政大臣',{admin:true});const actor=await player(h,'進軍中の領主',{home:'inuyama'}),defender=await player(h,'進軍中に任命される領主',{holdings:['nijo']});
  const departure=await depart(h,actor,defender,'nijo');await appoint(h,defender);const battle=await settle(h,actor,departure);
  assert(battle.won);assert.equal(battle.capture.captured,false);assert.equal(save(h,defender).state.castles.nijo.owner,save(h,defender).state.clan);
 });
 await scope('dismissal during march restores ordinary capture at arrival',async h=>{
  await player(h,'進軍中解任の太政大臣',{admin:true});const actor=await player(h,'解任後に到着する領主',{home:'inuyama'}),defender=await player(h,'解任される領主',{holdings:['nijo']});await appoint(h,defender);
  const departure=await depart(h,actor,defender,'nijo');await appoint(h,defender,{action:'dismiss'});const battle=await settle(h,actor,departure);
  assert(battle.won);assert.equal(battle.capture.captured,true);assert.notEqual(save(h,defender).state.castles.nijo.owner,save(h,defender).state.clan);assert.equal(save(h,actor).state.castles.nijo.owner,save(h,actor).state.clan);
 });
 for(const initiallyProtected of [false,true])await scope((initiallyProtected?'dismissal':'appointment')+' racing the final field commit is atomic and rechecks current protection on retry',async h=>{
  await player(h,'競合判定の太政大臣',{admin:true});const actor=await player(h,'競合判定の攻撃者',{home:'inuyama'}),defender=await player(h,'競合判定の守備者',{holdings:['nijo']});
  if(initiallyProtected)await appoint(h,defender);else await h.api('/admin/court/offices',{token:h.operator.token});
  const departure=await depart(h,actor,defender,'nijo'),beforeActor=row(h,actor),beforeDefender=row(h,defender);h.now+=departure.march.remainingMs;let invoked=false;
  beforeFieldCommit(h,()=>{invoked=true;if(initiallyProtected)h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(defender.user.id);else rawAppoint(h,defender);});
  const pending=await status(h,actor);assert(invoked);assert.equal(pending.active[0]?.id,departure.march.id);assert.deepEqual(row(h,actor),beforeActor);assert.deepEqual(row(h,defender),beforeDefender);assert.equal(count(h,'field_battles'),0);assert.equal(count(h,'castle_successions'),0);
  const complete=await status(h,actor),battle=complete.history.find(item=>item.id===departure.march.id).battle;assert.equal(battle.capture.captured,initiallyProtected);assert.equal(count(h,'field_battles'),1);
  assert.equal(save(h,defender).state.castles.nijo.owner===save(h,defender).state.clan,!initiallyProtected);
 });
 await scope('an invalid raw appointment blocked by a Kyoto office does not grant protection',async h=>{
  await player(h,'有効在任の太政大臣',{admin:true});await player(h,'京都の正式参議',{staff:true});const actor=await player(h,'未任命の攻撃者',{home:'inuyama'}),defender=await player(h,'無効任命の領主',{holdings:['nijo']});rawAppoint(h,defender,'sangi');
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM court_external_offices WHERE user_id=?').get(defender.user.id).n,0);
  const battle=await settle(h,actor,await depart(h,actor,defender,'nijo'));assert.equal(battle.capture.captured,true);
 });
 await scope('covert retaliation cannot force an appointed lord to hand the castle to a retainer',async h=>{
  await player(h,'反撃保全の太政大臣',{admin:true});const defender=await player(h,'反撃を受ける城主'),actor=await player(h,'反撃する派遣主',{home:'inuyama',holdings:['nijo']});await retainer(h,defender);await appoint(h,defender);
  tune(h,actor,s=>{for(const key of resources)s.resources[key]=1000000;s.buildings.keep=32;s.buildings.barracks=32;s.buildings.wall=32;s.troops=30000;s.command=7;s.seed=1;s.castles.nijo.troops=50000;});
  tune(h,defender,s=>{s.troops=10;s.castles.kiyosu.troops=10;s.castles.kiyosu.wall=1;s.buildings.wall=1;s.buildings.keep=1;s.army=[];s.seed=1;});
  const covertBody=extra=>{const s=save(h,actor).state;return{requestId:crypto.randomUUID(),deviceId:actor.deviceId,expectedRevision:row(h,actor).revision,campaignId:s.walking.campaignId,sequence:s.covert.sequence,...extra};};
  await h.api('/covert/hire',post(actor,covertBody({sourceCastleId:'nijo',count:1000})));
  const departure=(await h.api('/covert/dispatch',post(actor,covertBody({sourceCastleId:'nijo',target:{kind:'player',playerId:defender.user.id,castleId:'kiyosu'},count:1000,mode:'station'})))).data;
  h.now+=departure.march.remainingMs;const arrived=await status(h,actor),station=arrived.save.state.covert.stations[0],incident='fixture-'+crypto.randomUUID(),clock=(await h.api('/world-clock')).data.clock;
  h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,defender_campaign_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?,?)').run(incident,defender.user.id,actor.user.id,save(h,actor).state.walking.campaignId,clock.elapsedMs,JSON.stringify({castleId:'nijo'}),h.now);
  tune(h,actor,s=>{s.seed=1;});await h.api('/sync/lease',post(actor,{deviceId:actor.deviceId}));
  const before=seat(h,'kiyosu'),result=(await h.api('/covert/retaliate',post(actor,covertBody({stationId:station.id,incidentId:incident})))).data;
  assert.equal(result.result.battle.won,true);assert.equal(result.result.battle.succession,undefined);assert.deepEqual(seat(h,'kiyosu'),before);assert.equal(count(h,'castle_successions'),0);assert.equal(save(h,defender).state.castles.kiyosu.owner,save(h,defender).state.clan);
 });
 await scope('a legacy CPU-defeat save with the current sync envelope retains an appointed home and its lord seat',async h=>{
  await player(h,'旧端末保全の太政大臣',{admin:true});const lord=await player(h,'旧端末の在任城主'),heir=await retainer(h,lord);await appoint(h,lord);
  const heirBefore=row(h,heir).save_json,oldClient=legacyCpuDefeat(h,lord),done=(await upload(h,lord,oldClient)).data;
  assert.equal(done.entitlements.courtProtected,true);assert.equal(done.save.state.home,'kiyosu');assert.equal(done.save.state.cycle.home,'kiyosu');assert.equal(done.save.state.castles.kiyosu.owner,done.save.state.clan);assert.equal(done.save.state.gameOver,false);assert.equal(done.residency.role,'lord');assert.equal(seat(h,'kiyosu').lord_user_id,lord.user.id);assert.equal(row(h,heir).save_json,heirBefore);assert.equal(count(h,'castle_successions'),0);
 });
 await scope('a forged client court flag cannot protect an ordinary lord from trusted CPU succession',async h=>{
  await player(h,'偽装検証の太政大臣',{admin:true});const lord=await player(h,'役職のない城主'),heir=await retainer(h,lord),oldClient=legacyCpuDefeat(h,lord);
  oldClient.state.courtProtected=true;oldClient.state.entitlements={courtProtected:true};oldClient.state.courtOffice={title:'左大臣',kind:'official'};
  const done=(await upload(h,lord,oldClient)).data;
  assert.equal(done.entitlements.courtProtected,false);assert.equal(done.residency.role,'retainer');assert.equal(seat(h,'kiyosu').lord_user_id,heir.user.id);assert.equal(count(h,'castle_successions'),1);
 });
 for(const initiallyProtected of [false,true])await scope((initiallyProtected?'dismissal':'appointment')+' racing CPU sync cannot commit under stale protection',async h=>{
  await player(h,'CPU競合の太政大臣',{admin:true});const lord=await player(h,'CPU競合の城主'),heir=await retainer(h,lord);if(initiallyProtected)await appoint(h,lord);else await h.api('/admin/court/offices',{token:h.operator.token});
  const oldClient=legacyCpuDefeat(h,lord),before=row(h,lord);let invoked=false;
  h.beforeBatch=statements=>{if(!statements[0]?.sql.startsWith('UPDATE player_saves SET save_json='))return;h.beforeBatch=null;invoked=true;if(initiallyProtected)h.sql.prepare('DELETE FROM court_office_appointments WHERE user_id=?').run(lord.user.id);else rawAppoint(h,lord);};
  await upload(h,lord,oldClient,409);assert(invoked);assert.deepEqual(row(h,lord),before);assert.equal(count(h,'castle_successions'),0);
  const done=(await upload(h,lord,oldClient)).data;assert.equal(done.entitlements.courtProtected,!initiallyProtected);assert.equal(seat(h,'kiyosu').lord_user_id,initiallyProtected?heir.user.id:lord.user.id);assert.equal(count(h,'castle_successions'),initiallyProtected?1:0);
 });
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({ok:true,checks,calls,productionRequests:0}));
