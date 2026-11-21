import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const h=harness(),{sql,api}=h,checks=[],C=672*60000;
const post=(token,body,expected=200)=>({method:'POST',token,body,expected});
const clock=async()=> (await api('/world-clock')).data.clock;
const at=elapsed=>sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=1,speed=1,revision=revision+1 WHERE id='world-v1'").run(elapsed,h.now);
const row=p=>sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
const sync=async p=>(await api('/sync?deviceId='+p.device,{token:p.token})).data;
const role=async(p,action)=>(await api('/admin/staff',post(admin.token,{targetPlayerId:p.user.id,action,requestId:crypto.randomUUID()}))).data;
const put=async(p,save)=>(await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.device,revision:row(p).revision,save}})).data;
const back=p=>sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(p.user.id);
async function create(name,{home='himeji',clan='織田家',farm=2,castle=1,job=false}={}){
 const p=await h.session(name,clan);p.device=p.user.id+'-writer';await api('/sync/lease',post(p.token,{deviceId:p.device}));
 const g=new GameEngine({clan,startCastle:home,seed:7,officers:GAME_OFFICERS});g.applyWorldClock(await clock());g.state.buildings.farm=farm;g.state.castles[home].level=castle;g.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};
 if(job)assert(g.upgrade('farm').ok);await put(p,JSON.parse(g.exportSave()));return p;
}
let admin;
try{
 admin=await h.session('個人進行保護の運営');await api('/admin/claim',post(admin.token,{key:h.env.SENGOKU_ADMIN_KEY}));
 const a=await create('任期をまたぐ領主',{farm:5,castle:12,job:true});at(30000);await role(a,'appoint');const appointed=await sync(a);
 assert.equal(appointed.staffBase.personalHome,'himeji');assert.equal(appointed.staffBase.accessSinceElapsedMs,30000);assert.equal(appointed.save.state.home,'sunpu');assert.equal(JSON.parse(back(a).save_json).state.home,'himeji');
 const baseRow=sql.prepare("SELECT * FROM staff_base WHERE id='sunpu'").get(),shared=JSON.parse(baseRow.state_json);
 shared.history=[{jobId:'history-a',kind:'building',id:'farm',level:3,effectiveElapsedMs:45000},{jobId:'history-b',kind:'building',id:'farm',level:4,effectiveElapsedMs:90000}];shared.buildings.farm=4;
 sql.prepare("UPDATE staff_base SET state_json=?,revision=revision+1 WHERE id='sunpu'").run(JSON.stringify(shared));at(120000);
 const historical=await sync(a),expected=GameEngine.fromSave(historical.save,GAME_OFFICERS,{isStaff:true,staffBase:historical.staffBase});expected.applyWorldClock(await clock());const expectedPrivate=JSON.parse(expected.exportSave());
 await role(a,'dismiss');const publicAfterDismiss=(await api('/field')).data.players.find(p=>p.playerId===a.user.id);assert.equal(publicAfterDismiss.homeCastleId,'himeji');assert.equal(publicAfterDismiss.isStaff,false);
 const restored=await sync(a);assert.equal(restored.user.isStaff,false);assert.equal(restored.staffBase,null);assert.equal(restored.save.state.home,'himeji');assert.equal(restored.save.state.cycle.home,'himeji');assert.equal(restored.save.state.castles.himeji.level,12);assert.equal(restored.save.state.buildings.farm,6);assert.equal(restored.save.state.jobs.length,0);assert.equal(back(a).active,0);assert.equal(back(a).left_elapsed_ms,120000);
 assert.deepEqual(restored.save.state.resources,expectedPrivate.state.resources);assert.equal(restored.save.state.magatama,expectedPrivate.state.magatama);GameEngine.fromSave(restored.save,GAME_OFFICERS);
 const bytes=row(a).save_json;await sync(a);assert.equal(row(a).save_json,bytes,'repeated read does not repeat membership income or restore assets');
 checks.push('exact admission and departure times preserve queued personal jobs, separate facilities, resources and original chosen home');

 // A new term in the very same real millisecond cannot reuse a prior backup.
 await role(a,'appoint');const second=await sync(a),oldTerm=back(a).term_id;await role(a,'dismiss');await role(a,'appoint');const reappointed=await sync(a);assert.notEqual(back(a).term_id,oldTerm);assert.equal(reappointed.save.state.home,'sunpu');assert.equal(reappointed.staffBase.personalHome,'himeji');assert.equal(reappointed.save.state.buildings.farm,6);assert.equal(reappointed.staffBase.buildings.farm,4);
 // Guild balances and the normal server-confirmed gift flow use personal saves.
 const guild=(await api('/guild',post(a.token,{name:'共同城と個人資産の検証'}))).data.guild;
 const beforeTransfer=await sync(a),amount=1234,transfer=(await api('/guild/treasury/transfer',post(a.token,{guildId:guild.id,direction:'deposit',resource:'gold',amount,requestId:crypto.randomUUID(),deviceId:a.device,expectedRevision:beforeTransfer.revision}))).data;
 assert.equal(transfer.save.state.resources.gold,beforeTransfer.save.state.resources.gold-amount);assert.equal(transfer.save.state.buildings.farm,6);assert.equal(transfer.staffBase.buildings.farm,4);assert.equal(transfer.staffBase.revision,beforeTransfer.staffBase.revision);
 const mailed=(await api('/admin/mail',post(admin.token,{target:a.user.id,title:'スタッフへの褒賞検証',body:'ローカル検証用',gift:{magatama:77},requestId:crypto.randomUUID()}))).data,claimBody={mailId:mailed.mailId,requestId:crypto.randomUUID()},claimed=(await api('/mail/claim',post(a.token,claimBody))).data;
 const gifted=GameEngine.fromSave(transfer.save,GAME_OFFICERS,{isStaff:true,staffBase:transfer.staffBase});assert(gifted.applyGift(claimed.gift,claimed.receiptId).ok);const giftSave=await put(a,JSON.parse(gifted.exportSave()));assert.equal(giftSave.save.state.magatama,transfer.save.state.magatama+77);assert.equal(giftSave.save.state.buildings.farm,6);assert.equal(giftSave.staffBase.buildings.farm,4);assert.equal(giftSave.staffBase.revision,transfer.staffBase.revision);const repeatedGift=(await api('/mail/claim',post(a.token,claimBody))).data;assert(repeatedGift.alreadyClaimed);assert(gifted.applyGift(repeatedGift.gift,repeatedGift.receiptId).already);
 checks.push('same-timestamp reappointment creates a new term; guild transfers and replayed magatama gifts preserve individual/shared separation');

 // Finish an old personal castle job exactly as the world enters its next cycle.
 at(C-1);const pending=await sync(a),s=structuredClone(pending.save);s.state.turn=671;s.state.realtime.elapsed=59.999;s.state.worldClock.elapsedMs=C-1;s.state.castles.himeji={...s.state.castles.himeji,owner:s.state.clan,level:18};s.state.jobs=[{kind:'castle',id:'himeji',remaining:1,total:1,remainingSeconds:.001,totalSeconds:60,targetLevel:19}];
 const preBoundary=await put(a,s),sharedBefore=JSON.parse(sql.prepare("SELECT state_json FROM staff_base WHERE id='sunpu'").get().state_json);at(C+1000);
 const settled=(await api('/sync/settle',post(a.token,{deviceId:a.device,revision:preBoundary.revision}))).data;
 assert.equal(settled.save.state.home,'sunpu');assert.equal(settled.save.state.cycle.index,1);assert.equal(settled.save.state.castles.himeji.level,1);assert.equal(settled.save.state.cycle.latestReward.captured,1);assert.equal(JSON.parse(back(a).save_json).state.castles.himeji.level,19);assert.deepEqual(JSON.parse(sql.prepare("SELECT state_json FROM staff_base WHERE id='sunpu'").get().state_json),sharedBefore);
 await role(a,'dismiss');const postCycle=await sync(a);assert.equal(postCycle.save.state.home,'himeji');assert.equal(postCycle.save.state.castles.himeji.level,19);assert.equal(postCycle.save.state.buildings.farm,6);assert.equal(sql.prepare('SELECT COUNT(*) n FROM cycle_receipts WHERE user_id=?').get(a.user.id).n,1);GameEngine.fromSave(postCycle.save,GAME_OFFICERS);
 checks.push('shared base survives cycle reset; old personal home construction and exactly-once rewards survive dismissal');

 const legacy=await create('旧駿府本拠の一般領主',{home:'kiyosu'}),legacySave=JSON.parse(row(legacy).save_json);legacySave.state.home='sunpu';legacySave.state.cycle.home='sunpu';legacySave.state.castles.sunpu={owner:legacySave.state.clan,troops:4200,wall:8,level:12};legacySave.state.jobs=[{kind:'castle',id:'kiyosu',targetLevel:2,total:1,remaining:1,totalSeconds:60,remainingSeconds:30}];
 sql.prepare("UPDATE player_saves SET save_json=?,cycle_home='sunpu' WHERE user_id=?").run(JSON.stringify(legacySave),legacy.user.id);
 const legacyPublic=(await api('/field')).data.players.find(p=>p.playerId===legacy.user.id);assert.equal(legacyPublic.homeCastleId,'kiyosu');assert.equal(legacyPublic.level,12);
 const legacyMoved=await sync(legacy);assert.equal(legacyMoved.save.state.home,'kiyosu');assert.equal(legacyMoved.save.state.castles.kiyosu.level,12);assert.equal(legacyMoved.save.state.castles.kiyosu.troops,4200);assert.equal(legacyMoved.save.state.jobs[0].targetLevel,13);GameEngine.fromSave(legacyMoved.save,GAME_OFFICERS);await put(legacy,legacyMoved.save);
 await role(legacy,'appoint');await sync(legacy);await role(legacy,'dismiss');const legacyRestored=await sync(legacy);assert.equal(legacyRestored.save.state.home,'kiyosu');assert.equal(legacyRestored.save.state.castles.kiyosu.level,12);
 checks.push('old ordinary Sunpu campaigns retain development at eligible home, rebase existing jobs, and restore safely after staff service');

 // These are new writes, so the three capturable cities must use today's cap.
 const ordinary=await create('一般大都市Lv上限'),majorSave=JSON.parse(row(ordinary).save_json),capturableCities=['nijo','osaka','nagoya'];
 for(const id of capturableCities)majorSave.state.castles[id]={...majorSave.state.castles[id],owner:majorSave.state.clan,level:48};
 const major=await put(ordinary,majorSave),majorBytes=row(ordinary).save_json;
 for(const id of capturableCities){
  assert.equal(major.save.state.castles[id].level,48);
  const overCap=structuredClone(major.save);overCap.state.castles[id].level=49;
  const rejected=(await api('/sync',{method:'PUT',token:ordinary.token,body:{deviceId:ordinary.device,revision:major.revision,save:overCap},expected:400})).data;
  assert.equal(rejected.error.code,'INVALID_SAVE');assert.equal(row(ordinary).revision,major.revision);assert.equal(row(ordinary).save_json,majorBytes);
 }
 const tooHigh=structuredClone(major.save);tooHigh.state.castles.himeji.level=33;await api('/sync',{method:'PUT',token:ordinary.token,body:{deviceId:ordinary.device,revision:major.revision,save:tooHigh},expected:400});
 const spoof=structuredClone(major.save);spoof.state.isStaff=true;spoof.state.staffBase={castleLevel:64};spoof.state.home='sunpu';spoof.state.castles.sunpu.owner=spoof.state.clan;await api('/sync',{method:'PUT',token:ordinary.token,body:{deviceId:ordinary.device,revision:major.revision,save:spoof},expected:403});
 const oldClient=await create('旧スタッフ版の保存',{clan:'伊達家',home:'nanao',castle:9});await role(oldClient,'appoint');await sync(oldClient);const oldBody=JSON.parse(row(oldClient).save_json),oldOfficers=[...oldBody.state.officerVariants];for(const c of Object.values(oldBody.state.castles)){if(c.owner===oldBody.state.clan)c.owner='伊達家';else if(c.owner==='伊達家')c.owner='在地衆';}oldBody.state.clan='伊達家';sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(oldBody),oldClient.user.id);oldBody.state.resources.gold+=123;const oldRevision=row(oldClient).revision,oldResult=await put(oldClient,oldBody);assert.equal(oldResult.revision,oldRevision+1);assert.equal(oldResult.save.state.clan,'德川家');assert.equal(oldResult.save.state.resources.gold,oldBody.state.resources.gold);assert.deepEqual(oldResult.save.state.officerVariants,oldOfficers);assert.equal(JSON.parse(back(oldClient).save_json).state.clan,'伊達家');assert.equal(oldResult.staffBase.personalHome,'nanao');
 checks.push('a still-valid v3.7 writer can directly upload the old staff family without a spurious conflict or loss of personal progress');
 await role(legacy,'appoint');const beforePromotion=await sync(legacy);sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(legacy.user.id);const promoted=await sync(legacy);assert.equal(promoted.user.isAdmin,true);assert.equal(promoted.user.isStaff,false);assert.equal(promoted.save.state.home,'edo');assert.equal(promoted.save.state.clan,'德川家');assert(promoted.save.state.officerVariants.includes('of_b0616adde162:U'));assert.notEqual(promoted.save.state.castles.sunpu.owner,promoted.save.state.clan);assert.equal(promoted.save.state.buildings.farm,beforePromotion.save.state.buildings.farm);assert.equal(back(legacy).active,0);GameEngine.fromSave(promoted.save,GAME_OFFICERS,{isAdmin:true});
 checks.push('staff promotion restores individual assets before applying fixed protected Edo and exclusive operator U');
 checks.push('new saves accept all three capturable cities at level 48 and reject 49 without changing saved data; ordinary castles cap at 32; imported role flags cannot grant Sunpu');
 console.log(JSON.stringify({ok:true,calls:h.calls,checks,productionRequests:0},null,2));
}finally{h.close();}
