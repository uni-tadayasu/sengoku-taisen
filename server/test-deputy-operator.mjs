import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

// The deputy's authority is exercised only through real Worker routes, with
// local transactional SQLite and a fully migrated fixture database.
const post=(actor,body,expected=200)=>({method:'POST',token:actor?.token,body,expected});
const row=(h,p)=>h.sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const save=(h,p)=>JSON.parse(row(h,p).save_json);
const member=(h,p)=>h.sql.prepare('SELECT * FROM castle_residents WHERE user_id=?').get(p.user.id);
const seat=(h,id)=>h.sql.prepare('SELECT * FROM castle_seats WHERE castle_id=?').get(id);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
const read=async(h,p,path)=>(await h.api(path,{token:p?.token})).data;
const startBody=(h,p,castleId,mode='lord')=>({deviceId:p.deviceId,revision:row(h,p).revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'});
async function player(h,name,castleId='kiyosu',mode='lord'){
 const p=await h.session(name);p.deviceId='deputy-'+p.user.id;
 await h.api('/sync/lease',post(p,{deviceId:p.deviceId}));
 await h.api('/castles/residency/start',post(p,startBody(h,p,castleId,mode)));return p;
}
async function operator(h){const p=await h.session('鹿児島任免の運営');await h.api('/admin/claim',post(p,{key:h.env.SENGOKU_ADMIN_KEY}));return p;}
const registry=(h,admin)=>read(h,admin,'/admin/deputy');
async function command(h,admin,target,action='appoint',extra={}){const current=await registry(h,admin);return{targetPlayerId:target.user.id,action,requestId:crypto.randomUUID(),expectedRevision:current.revision,...extra};}
const change=async(h,admin,body,expected=200)=>(await h.api('/admin/deputy',post(admin,body,expected))).data;
async function appoint(h,admin,target){return change(h,admin,await command(h,admin,target));}
async function dismiss(h,admin,target){return change(h,admin,await command(h,admin,target,'dismiss'));}
function tune(h,p,update){const value=save(h,p);update(value.state);h.sql.prepare('UPDATE player_saves SET save_json=?,revision=revision+1 WHERE user_id=?').run(JSON.stringify(value),p.user.id);}
const effects=h=>Object.fromEntries(['deputy_operator_state','deputy_role_requests','deputy_campaign_backups','castle_seats','castle_residents','player_saves'].map(table=>[table,h.sql.prepare('SELECT * FROM '+table).all()]));
const isRoleBatch=statements=>statements.some(s=>s.sql.includes('INSERT INTO deputy_role_requests'));
const reject=async(h,admin,body)=>{const result=await h.api('/admin/deputy',post(admin,body,null));assert(result.response.status>=400&&result.response.status<500,JSON.stringify(result.data));return result.data;};
let scenarios=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 binding limit: '+s.params.length);}return batch(statements);};try{await run(h);scenarios++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Deputy operator tests must not access any external service');};
try{
await scope('only the primary operator can appoint a started ordinary player, with strict input and protected targets',async h=>{
 const admin=await operator(h),target=await player(h,'任命候補'),peer=await player(h,'一般の閲覧者','inuyama'),q=await command(h,admin,target),before=effects(h);
 await h.api('/admin/deputy',{expected:401});await h.api('/admin/deputy',{token:peer.token,expected:403});
 await change(h,null,q,401);await change(h,peer,q,403);assert.deepEqual(effects(h),before);
 for(const extra of [{action:'replace'},{expectedRevision:-1},{expectedRevision:'0'},{requestId:null},{targetPlayerId:null},{isAdmin:true}])await change(h,admin,{...q,...extra},400);
 assert.deepEqual(effects(h),before);await reject(h,admin,{...q,targetPlayerId:admin.user.id});
 const empty=await h.session('開始前の候補');await reject(h,admin,{...q,targetPlayerId:empty.user.id});
 await h.api('/admin/staff',post(admin,{targetPlayerId:peer.user.id,action:'appoint',requestId:crypto.randomUUID()}));await reject(h,admin,{...q,targetPlayerId:peer.user.id});
 const banned=await player(h,'停止中の候補','himeji');await h.api('/admin/moderation',post(admin,{targetPlayerId:banned.user.id,action:'ban',requestId:crypto.randomUUID(),expectedRevision:0}));await reject(h,admin,{...q,targetPlayerId:banned.user.id});
 const expelled=await player(h,'再入城待ち候補','okazaki'),info=await read(h,admin,'/admin/moderation/target?playerId='+expelled.user.id);
 await h.api('/admin/moderation/expel',post(admin,{targetPlayerId:expelled.user.id,requestId:crypto.randomUUID(),expectedRevision:info.expulsion.revision,expectedCastleId:info.expulsion.castleId,expectedLordEpoch:info.expulsion.lordEpoch}));
 await reject(h,admin,{...q,targetPlayerId:expelled.user.id});assert.equal((await registry(h,admin)).deputy,null);assert.equal(count(h,'deputy_role_requests'),0);
});

await scope('appointment fixes Kagoshima as the deputy home and preserves personal progress without granting primary authority',async h=>{
 const admin=await operator(h),target=await player(h,'鹿児島のサブ運営'),retainer=await player(h,'元城に残る家臣','kiyosu','retainer');
 tune(h,target,s=>{s.resources={gold:12345,rice:23456,wood:34567,stone:45678};s.buildings.keep=8;s.tech.siege=2;s.magatama=321;});
 const before=save(h,target),retainerBefore=member(h,retainer),retainerSave=row(h,retainer),result=await appoint(h,admin,target);
 assert.equal(result.deputy.id,target.user.id);assert.equal(result.action,'appoint');assert(result.revision>0);
 const snapshot=await read(h,target,'/sync?deviceId='+target.deviceId);assert.equal(snapshot.user.isDeputy,true);assert.equal(snapshot.user.isAdmin,false);assert.equal(snapshot.user.isStaff,false);
 assert.equal(snapshot.save.state.home,'kagoshima');assert.equal(snapshot.save.state.cycle.home,'kagoshima');assert.equal(row(h,target).cycle_home,'kagoshima');assert.equal(snapshot.save.state.castles.kagoshima.owner,snapshot.save.state.clan);
 for(const key of ['clan','resources','buildings','tech','magatama'])assert.deepEqual(snapshot.save.state[key],before.state[key],key+' must survive appointment');
 const special=globalThis.SENGOKU_DATA.deputyAssets;
 assert.deepEqual(snapshot.save.state.officers,[...new Set([...before.state.officers,special.officerId])]);
 assert.deepEqual(snapshot.save.state.officerVariants,[...new Set([...before.state.officerVariants,special.officerId+':'+special.rank])]);
 assert.equal(member(h,target),undefined);assert.equal(seat(h,'kiyosu').lord_user_id,null);assert.deepEqual(member(h,retainer),retainerBefore);assert.deepEqual(row(h,retainer),retainerSave);
 const field=await read(h,target,'/field/me');assert.equal(field.self.homeCastleId,'kagoshima');assert.equal(field.self.battleMode,'reward');assert.equal(field.self.capturable,false);
 const directory=await read(h,null,'/castles/residency');assert.equal(directory.capacity,123);assert(!directory.castles.some(c=>c.castleId==='kagoshima'));await h.api('/castles/residency?castleId=kagoshima',{expected:400});
 await h.api('/admin/moderation/bans',{token:target.token,expected:200});await h.api('/admin/deputy',{token:target.token,expected:403});
 const start=await h.api('/castles/residency/start',post(target,startBody(h,target,'inuyama'),null));assert(start.response.status>=400&&start.response.status<500);
 const move=await h.api('/castles/residency/relocate',post(target,{deviceId:target.deviceId,revision:row(h,target).revision,requestId:crypto.randomUUID(),castleId:'inuyama'},null));assert(move.response.status>=400&&move.response.status<500);
 assert.equal(save(h,target).state.home,'kagoshima');
});

await scope('Kagoshima cannot accept ordinary lords or retainers, including forged imported role labels',async h=>{
 const admin=await operator(h),deputy=await player(h,'正式なサブ運営'),ordinary=await player(h,'一般の領主','inuyama');await appoint(h,admin,deputy);
 for(const mode of ['lord','retainer'])await h.api('/castles/residency/start',post(ordinary,startBody(h,ordinary,'kagoshima',mode),400));
 const imported=save(h,ordinary);imported.isDeputy=true;imported.state.isDeputy=true;imported.state.home='kagoshima';imported.state.cycle.home='kagoshima';imported.state.castles.kagoshima.owner=imported.state.clan;
 const attempt=await h.api('/sync',{method:'PUT',token:ordinary.token,body:{deviceId:ordinary.deviceId,revision:row(h,ordinary).revision,save:imported},expected:null});assert([200,400,403,409].includes(attempt.response.status),JSON.stringify({status:attempt.response.status,error:attempt.data?.error}));
 const current=await read(h,ordinary,'/sync');assert.equal(current.user.isDeputy,false);assert.notEqual(current.save.state.home,'kagoshima');assert.notEqual(current.save.state.castles.kagoshima.owner,current.save.state.clan);assert.equal((await registry(h,admin)).deputy.id,deputy.user.id);
});

await scope('a legacy ordinary Kagoshima save migrates its progress and persistent cycle home to an available ordinary residence',async h=>{
 const target=await player(h,'従来の鹿児島領主');
 tune(h,target,s=>{[s.castles.kiyosu,s.castles.kagoshima]=[s.castles.kagoshima,s.castles.kiyosu];s.home='kagoshima';s.cycle.home='kagoshima';s.resources.gold=12345;s.buildings.keep=8;s.castles.kagoshima.level=7;});
 // Reproduce the 0049 migration's preserved save and released legacy seat.
 h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(target.user.id);h.sql.prepare('UPDATE castle_seats SET lord_user_id=NULL WHERE lord_user_id=?').run(target.user.id);
 h.sql.prepare("UPDATE player_saves SET cycle_home='kagoshima' WHERE user_id=?").run(target.user.id);
 const before=save(h,target),snapshot=await read(h,target,'/sync?deviceId='+target.deviceId);assert.notEqual(snapshot.save.state.home,'kagoshima');assert.equal(snapshot.save.state.resources.gold,before.state.resources.gold);assert.equal(snapshot.save.state.buildings.keep,8);assert.equal(snapshot.save.state.castles[snapshot.save.state.home].level,7);
 await h.api('/sync',{method:'PUT',token:target.token,body:{deviceId:target.deviceId,revision:snapshot.revision,save:snapshot.save}});
 const restored=await read(h,target,'/sync');assert.equal(row(h,target).cycle_home,restored.save.state.home);assert.equal(restored.residency.castleId,restored.save.state.home);assert.equal(restored.residency.role,'lord');
});

await scope('one deputy slot requires dismissal before replacement, and old requests never reappoint or dismiss a later term',async h=>{
 const admin=await operator(h),first=await player(h,'第一のサブ運営'),second=await player(h,'第二のサブ運営','inuyama'),q=await command(h,admin,first);
 const results=await Promise.all([change(h,admin,q),change(h,admin,q)]);assert(results.some(r=>r.idempotent));assert.equal(count(h,'deputy_role_requests'),1);
 await change(h,admin,{...q,targetPlayerId:second.user.id},409);await reject(h,admin,await command(h,admin,second));assert.equal((await registry(h,admin)).deputy.id,first.user.id);
 await reject(h,admin,await command(h,admin,second,'dismiss'));await change(h,admin,{...await command(h,admin,first,'dismiss'),expectedRevision:0},409);
 const dismissal=await command(h,admin,first,'dismiss');await change(h,admin,dismissal);const secondTerm=await appoint(h,admin,second);assert.equal(secondTerm.deputy.id,second.user.id);
 const latest=effects(h);assert.equal((await change(h,admin,q)).idempotent,true);assert.equal((await change(h,admin,dismissal)).idempotent,true);assert.deepEqual(effects(h),latest);assert.equal((await registry(h,admin)).deputy.id,second.user.id);
});

await scope('dismissal returns to the former castle with progress earned during service and restores a free lord seat',async h=>{
 const admin=await operator(h),target=await player(h,'復帰するサブ運営');await appoint(h,admin,target);
 tune(h,target,s=>{s.resources.gold+=77;s.buildings.keep=9;s.tech.siege=3;});const during=save(h,target);
 const result=await dismiss(h,admin,target);assert.equal(result.deputy,null);assert.equal(result.action,'dismiss');
 const restored=await read(h,target,'/sync?deviceId='+target.deviceId);assert.equal(restored.user.isDeputy,false);assert.equal(restored.save.state.home,'kiyosu');assert.equal(row(h,target).cycle_home,'kiyosu');
 for(const key of ['resources','buildings','tech','officers','officerVariants','magatama'])assert.deepEqual(restored.save.state[key],during.state[key],key+' earned during service must remain');
 assert.equal(restored.residency.castleId,'kiyosu');assert.equal(restored.residency.role,'lord');assert.equal(seat(h,'kiyosu').lord_user_id,target.user.id);assert.notEqual(restored.save.state.castles.kagoshima.owner,restored.save.state.clan);
});

await scope('dismissal to an occupied former castle returns as a retainer and never displaces the new lord',async h=>{
 const admin=await operator(h),target=await player(h,'家臣として戻るサブ運営');await appoint(h,admin,target);
 const replacement=await player(h,'元城へ入城した領主'),oldSeat=seat(h,'kiyosu'),replacementSave=row(h,replacement);await dismiss(h,admin,target);
 const restored=await read(h,target,'/sync');assert.equal(restored.save.state.home,'kiyosu');assert.equal(restored.residency.role,'retainer');assert.equal(restored.residency.lordPlayerId,replacement.user.id);assert.equal(seat(h,'kiyosu').lord_user_id,replacement.user.id);assert.equal(seat(h,'kiyosu').lord_epoch,oldSeat.lord_epoch);assert.deepEqual(row(h,replacement),replacementSave);
});

await scope('dismissal returns legacy major city residents to their recorded home and restores major city development',async h=>{
 const admin=await operator(h);
 for(const home of ['nijo','osaka','nagoya']){
  const target=await player(h,'旧大城本拠の領主 '+home);
  tune(h,target,s=>{s.home=home;s.cycle.home=home;s.castles.kiyosu.owner='在地衆';s.castles[home]={...s.castles[home],owner:s.clan,troops:789,wall:11,level:40};s.resources.gold=12345;});
  // Existing major city homes predate ordinary household admission and have
  // no ordinary seat. A real membership, if present, remains authoritative.
  h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(target.user.id);h.sql.prepare('UPDATE castle_seats SET lord_user_id=NULL WHERE lord_user_id=?').run(target.user.id);h.sql.prepare('UPDATE player_saves SET cycle_home=? WHERE user_id=?').run(home,target.user.id);
  const original=save(h,target);await appoint(h,admin,target);assert.equal(save(h,target).state.home,'kagoshima');assert.equal(h.sql.prepare('SELECT original_home FROM deputy_campaign_backups WHERE user_id=?').get(target.user.id).original_home,home);
  await dismiss(h,admin,target);const restored=await read(h,target,'/sync');assert.equal(restored.save.state.home,home);assert.equal(restored.save.state.cycle.home,home);assert.equal(row(h,target).cycle_home,home);assert.equal(restored.save.state.castles[home].level,40);assert.equal(restored.save.state.castles[home].troops,789);assert.equal(restored.save.state.resources.gold,original.state.resources.gold);assert.equal(restored.residency,null);assert.equal(restored.user.isDeputy,false);assert.notEqual(restored.save.state.castles.kagoshima.owner,restored.save.state.clan);
 }
});

await scope('a dismissed Kyoto staff member restores the personal campaign before entering deputy service',async h=>{
 const admin=await operator(h),target=await player(h,'京都から鹿児島へ移る領主','himeji'),original=save(h,target);
 const staff=action=>h.api('/admin/staff',post(admin,{targetPlayerId:target.user.id,action,requestId:crypto.randomUUID()}));
 await staff('appoint');assert.equal((await read(h,target,'/sync')).save.state.home,'kyoto_gosho');
 await staff('dismiss');
 // No intervening player sync: the role action must resolve the pending
 // personal campaign restoration itself or require it explicitly.
 const response=await h.api('/admin/deputy',post(admin,await command(h,admin,target),null));
 if(response.response.status!==200){assert.equal(response.response.status,409);await read(h,target,'/sync');await appoint(h,admin,target);}
 const serving=await read(h,target,'/sync');assert.equal(serving.save.state.home,'kagoshima');assert.equal(serving.save.state.clan,original.state.clan);
 assert.equal(h.sql.prepare('SELECT original_home FROM deputy_campaign_backups WHERE user_id=?').get(target.user.id).original_home,'himeji');
 await dismiss(h,admin,target);const restored=await read(h,target,'/sync');assert.equal(restored.save.state.home,'himeji');assert.equal(restored.save.state.clan,original.state.clan);
});

await scope('the operator can dismiss a banned deputy while the account ban remains enforced',async h=>{
 const admin=await operator(h),target=await player(h,'停止されたサブ運営','himeji');await appoint(h,admin,target);
 await h.api('/admin/moderation',post(admin,{targetPlayerId:target.user.id,action:'ban',requestId:crypto.randomUUID(),expectedRevision:0}));
 await h.api('/sync',{token:target.token,expected:403});
 await dismiss(h,admin,target);assert.equal((await registry(h,admin)).deputy,null);assert.equal(save(h,target).state.home,'himeji');
 assert.equal(h.sql.prepare('SELECT active FROM player_bans WHERE user_id=?').get(target.user.id).active,1);await h.api('/sync',{token:target.token,expected:403});
 const available=(await read(h,null,'/castles/residency')).castles.find(c=>c.castleId==='himeji');assert.equal(available.available,true);
 const status=await read(h,admin,'/admin/moderation/target?playerId='+target.user.id);
 await h.api('/admin/moderation',post(admin,{targetPlayerId:target.user.id,action:'unban',requestId:crypto.randomUUID(),expectedRevision:status.ban.revision}));
 const restored=await read(h,target,'/sync');assert.equal(restored.user.isDeputy,false);assert.equal(restored.save.state.home,'himeji');
});

await scope('role changes reject stale target saves and a replaced primary operator at commit, with atomic rollback',async h=>{
 const admin=await operator(h),target=await player(h,'競合対象'),q=await command(h,admin,target);let saveRace=false;
 h.beforeBatch=statements=>{if(isRoleBatch(statements)){h.beforeBatch=null;saveRace=true;h.sql.prepare('UPDATE player_saves SET revision=revision+1 WHERE user_id=?').run(target.user.id);}};
 await change(h,admin,q,409);assert(saveRace);assert.equal((await registry(h,admin)).deputy,null);assert.equal(save(h,target).state.home,'kiyosu');
 const before=effects(h);h.sql.exec("CREATE TRIGGER deputy_fixture_rollback BEFORE UPDATE OF save_json ON player_saves BEGIN SELECT RAISE(ABORT,'fixture deputy rollback'); END");
 await change(h,admin,q,500);assert.deepEqual(effects(h),before);h.sql.exec('DROP TRIGGER deputy_fixture_rollback');
 const replacement=await h.session('新たな運営');let adminRace=false;
 h.beforeBatch=statements=>{if(isRoleBatch(statements)){h.beforeBatch=null;adminRace=true;h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(replacement.user.id);}};
 await change(h,admin,q,403);assert(adminRace);assert.equal(count(h,'deputy_role_requests'),0);assert.equal(save(h,target).state.home,'kiyosu');
});

await scope('an in-flight ordinary save cannot overwrite an appointment or restore the former home',async h=>{
 const admin=await operator(h),target=await player(h,'保存中の任命候補'),q=await command(h,admin,target),old=save(h,target),revision=row(h,target).revision;let hit=false;
 old.state.resources.gold-=1;h.beforeBatch=async statements=>{if(statements.some(s=>s.sql.includes('UPDATE player_saves SET save_json='))){h.beforeBatch=null;hit=true;await change(h,admin,q);}};
 await h.api('/sync',{method:'PUT',token:target.token,body:{deviceId:target.deviceId,revision,save:old},expected:409});assert(hit);assert.equal(save(h,target).state.home,'kagoshima');assert.equal((await read(h,target,'/me')).user.isDeputy,true);
});

await scope('active army marches and covert dispatches require return before appointment',async h=>{
 const admin=await operator(h),target=await player(h,'出撃中の任命候補'),enemy=await player(h,'出撃先','inuyama');
 tune(h,target,s=>{s.troops=5000;s.resources.rice=10000;});
 const march=(await h.api('/field/attack',post(target,{targetPlayerId:enemy.user.id,targetCastleId:'inuyama',troops:500,tactic:'balanced',requestId:crypto.randomUUID(),deviceId:target.deviceId,expectedRevision:row(h,target).revision}))).data;assert(march.marching);
 await reject(h,admin,await command(h,admin,target));assert.equal(save(h,target).state.home,'kiyosu');assert.equal(h.sql.prepare('SELECT status FROM battle_marches WHERE id=?').get(march.march.id).status,'marching');
 const spy=await player(h,'派遣中の任命候補','himeji');tune(h,spy,s=>{s.castles.nijo.owner=s.clan;s.resources.gold=10000;s.resources.rice=10000;s.troops=5000;});
 const body=extra=>({requestId:crypto.randomUUID(),deviceId:spy.deviceId,expectedRevision:row(h,spy).revision,campaignId:save(h,spy).state.walking.campaignId,sequence:save(h,spy).state.covert.sequence,...extra});
 await h.api('/covert/hire',post(spy,body({sourceCastleId:'nijo',count:100})));
 const dispatch=(await h.api('/covert/dispatch',post(spy,body({sourceCastleId:'nijo',count:30,mode:'scout',target:{kind:'player',playerId:enemy.user.id,castleId:'inuyama'}})))).data;assert(dispatch.marching);
 await reject(h,admin,await command(h,admin,spy));assert.equal(save(h,spy).state.home,'himeji');assert.equal((await registry(h,admin)).deputy,null);
});

await scope('a won online attack on Kagoshima transfers resource loot once without capturing the home',async h=>{
 const admin=await operator(h),deputy=await player(h,'防衛するサブ運営'),attacker=await player(h,'鹿児島攻略の挑戦者','uchijo');await appoint(h,admin,deputy);
 tune(h,attacker,s=>{s.troops=10000;s.resources.rice=100000;s.buildings.keep=32;s.buildings.barracks=32;s.morale=100;});
 tune(h,deputy,s=>{s.troops=1;s.castles.kagoshima.troops=1;s.castles.kagoshima.wall=1;s.castles.kagoshima.level=1;s.buildings.wall=1;s.buildings.keep=1;s.army=[];});
 const defended=row(h,deputy),body={targetPlayerId:deputy.user.id,targetCastleId:'kagoshima',troops:5000,tactic:'assault',requestId:crypto.randomUUID(),deviceId:attacker.deviceId,expectedRevision:row(h,attacker).revision};
 const originalRandom=crypto.getRandomValues;let departure;
 crypto.getRandomValues=function(values){return values instanceof Uint32Array&&values.length===1?values.fill(0):originalRandom.call(crypto,values);};
 try{departure=(await h.api('/field/attack',post(attacker,body))).data;}finally{crypto.getRandomValues=originalRandom;}
 assert(departure.marching);h.now+=departure.march.remainingMs;
 const arrived=await read(h,attacker,'/marches?deviceId='+attacker.deviceId),receipt=arrived.history.find(m=>m.id===departure.march.id);assert.equal(receipt.status,'resolved');assert.equal(receipt.battle.won,true);assert.equal(receipt.battle.battleMode,'reward');assert(receipt.battle.loot.gold>0);assert.equal(receipt.battle.rewards.gold,0);assert.equal(receipt.battle.lootPolicy,'half-resources-v1');
 assert.equal(receipt.battle.capture.captured,false);assert.equal(row(h,deputy).revision,defended.revision+1);for(const key of ['gold','rice','wood','stone']){const remaining=save(h,deputy).state.resources[key],transferred=receipt.battle.loot[key];assert.equal(transferred,Math.floor((remaining+transferred)/2));}assert.equal(save(h,deputy).state.castles.kagoshima.owner,save(h,deputy).state.clan);assert.equal((await registry(h,admin)).deputy.id,deputy.user.id);
 const after=row(h,attacker);const replay=(await h.api('/field/attack',post(attacker,body))).data;assert(replay.idempotent);assert.equal(replay.battle.id,receipt.battle.id);assert.deepEqual(row(h,attacker),after);
});
}finally{globalThis.fetch=originalFetch;}
console.log(`Deputy operator: ${scenarios} scenarios, ${calls} Worker requests; max ${maxBindings} SQL bindings.`);
