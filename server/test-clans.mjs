import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const h=harness(),{api,sql}=h;
const freshAt=(clan,home)=>{const save=h.fresh(),s=save.state,previous=s.clan;for(const castle of Object.values(s.castles))if(castle.owner===previous||castle.owner===clan)castle.owner='在地衆';s.clan=clan;s.home=home;s.castles[home].owner=clan;s.captureRewards=[home];return save;};
const lease=async p=>(await api('/sync/lease',{method:'POST',token:p.token,body:{deviceId:p.user.id+'-device'}})).data;
const write=(p,revision,save,expected=200)=>api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.user.id+'-device',revision,save},expected});
try{
 const ordinary=await h.session('徳川の一般領主','徳川家'),staff=await h.session('支援の領主'),admin=await h.session('自由な領主名');
 assert.equal(ordinary.user.clan,'徳川家');for(const clan of ['德川家',' 德川家 '])assert.equal((await api('/session',{method:'POST',body:{name:'偽の運営',clan},expected:403})).data.error.code,'ADMIN_CLAN_REQUIRED');
 await api('/admin/claim',{method:'POST',token:admin.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});await api('/admin/staff',{method:'POST',token:admin.token,body:{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}});
 const identity=(await api('/me',{token:admin.token})).data.user;assert.equal(identity.name,'自由な領主名');assert.equal(identity.clan,'德川家');assert(identity.isAdmin);
 assert.equal((await api('/profile',{method:'PATCH',token:ordinary.token,body:{name:ordinary.user.name,clan:'德川家'},expected:403})).data.error.code,'ADMIN_CLAN_REQUIRED');const staffProfile=(await api('/profile',{method:'PATCH',token:staff.token,body:{name:staff.user.name,clan:'德川家'}})).data.user;assert.equal(staffProfile.clan,'德川家');assert(staffProfile.isStaff&&!staffProfile.isAdmin);
 await lease(ordinary);const old=await write(ordinary,0,freshAt('徳川家','himeji'));assert.equal(old.data.save.state.clan,'徳川家');assert.equal(old.data.save.state.home,'himeji');assert.equal(Object.values(old.data.save.state.castles).filter(c=>c.owner==='徳川家').length,1);
 const forged=freshAt('德川家','himeji');forged.state.isAdmin=true;forged.isAdmin=true;assert.equal((await write(ordinary,1,forged,403)).data.error.code,'ADMIN_CLAN_REQUIRED');
 await lease(staff);const staffSave=(await write(staff,0,forged)).data;assert.equal(staffSave.save.state.clan,'德川家');assert.equal(staffSave.save.state.home,'sunpu');assert(!staffSave.user.isAdmin);assert.deepEqual(staffSave.entitlements,{edo:false,ieyasuU:false});assert(!staffSave.save.state.officerVariants.includes('of_b0616adde162:U'));
 // Metropolitan castles are excluded by the first-start selector only. Existing
 // ordinary cloud campaigns at Osaka, Nijo and Nagoya must remain importable.
 let revision=1;for(const city of ['osaka','nijo','nagoya']){const saved=await write(ordinary,revision++,freshAt('徳川家',city));assert.equal(saved.data.save.state.home,city);assert((await api('/field')).data.players.find(p=>p.playerId===ordinary.user.id).majorCity);}
 const edo=freshAt('徳川家','edo');assert.equal((await write(ordinary,revision,edo,403)).data.error.code,'ADMIN_ENTITLEMENT_REQUIRED');
 const legacy=h.fresh(),before=structuredClone(legacy.state);legacy.state.castles.himeji.owner=legacy.state.clan;legacy.state.captureRewards.push('himeji');legacy.state.resources.gold=12345;
 await lease(admin);const adminSaved=(await write(admin,0,legacy)).data;assert.equal(adminSaved.user.name,'自由な領主名');assert.equal(adminSaved.user.clan,'德川家');assert.equal(adminSaved.save.state.clan,'德川家');assert.equal(adminSaved.save.state.home,'edo');assert.equal(adminSaved.save.state.resources.gold,12345);
 for(const [id,castle] of Object.entries(adminSaved.save.state.castles)){if(legacy.state.castles[id].owner===legacy.state.clan||id==='edo')assert.equal(castle.owner,'德川家');else assert.equal(castle.owner,before.castles[id].owner);}
 assert.equal(adminSaved.save.state.castles.okazaki.owner,'徳川家','normal Tokugawa AI territory is not granted to an operator of another previous house');
 const again=(await write(admin,1,adminSaved.save)).data;assert.deepEqual(again.save.state,adminSaved.save.state);
 const adminBase=(await api('/field',{token:ordinary.token})).data.players.find(p=>p.playerId===admin.user.id);assert.equal(adminBase.clan,'徳川家');assert.equal(adminBase.homeCastleId,'edo');assert.equal(adminBase.attackable,true);assert.equal(adminBase.battleMode,'reward');assert.equal(adminBase.capturable,false);assert(adminBase.majorCity);
 // Earlier import checks intentionally use legacy, unanchored saves. Prepare
 // the attack through the real engine clock path rather than forging an anchor.
 const latest=(await api('/sync',{token:ordinary.token})).data,clock=(await api('/world-clock')).data.clock;
 const alignedGame=GameEngine.fromSave(latest.save,GAME_OFFICERS);alignedGame.applyWorldClock(clock);
 const aligned=(await write(ordinary,latest.revision,JSON.parse(alignedGame.exportSave()))).data;revision=aligned.revision;
 const defenderBefore=sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(admin.user.id),sharedBefore=sql.prepare("SELECT * FROM staff_base WHERE id='sunpu'").get();
 const attack={targetPlayerId:admin.user.id,targetCastleId:'edo',deviceId:ordinary.user.id+'-device',expectedRevision:revision,requestId:crypto.randomUUID(),troops:300,tactic:'balanced'};
 let reward;const random=crypto.getRandomValues;crypto.getRandomValues=array=>array.fill(0);
 try{reward=(await api('/field/attack',{method:'POST',token:ordinary.token,body:attack})).data;}finally{crypto.getRandomValues=random;}
 assert.equal(reward.battle.battleMode,'reward');assert.equal(reward.battle.won,true);assert.equal(reward.battle.defenderRevision,defenderBefore.revision);
 assert.deepEqual(reward.battle.defenderLost,{troops:0,garrison:0});assert.deepEqual(reward.battle.loot,{gold:0,rice:0,wood:0,stone:0});assert.deepEqual(reward.battle.rewards,{gold:500,rice:500,wood:500,stone:500});
 for(const key of ['gold','rice','wood','stone'])assert.equal(reward.save.state.resources[key],aligned.save.state.resources[key]+500-(key==='rice'?reward.battle.foodCost:0));
 assert.equal(reward.save.state.home,aligned.save.state.home);assert.notEqual(reward.save.state.castles.edo.owner,reward.save.state.clan);
 assert.deepEqual(sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(admin.user.id),defenderBefore,'Edo reward combat preserves the entire defender row, including save and revision');assert.deepEqual(sql.prepare("SELECT * FROM staff_base WHERE id='sunpu'").get(),sharedBefore);
 await api('/field/attack',{method:'POST',token:ordinary.token,body:{...attack,isAdmin:true,castleId:'edo',won:true},expected:400});assert.equal(Number(sql.prepare('SELECT COUNT(*) n FROM field_battles').get().n),1);
 assert.equal(JSON.parse(sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(admin.user.id).save_json).state.castles.edo.owner,'德川家');
 // Revocation converts only the old holdings; same-spelling ordinary AI castles
 // are neutralized before the reserved house becomes an ordinary house.
 sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(staff.user.id);
 const migrated=(await api('/sync',{token:admin.token})).data;assert.equal(migrated.user.clan,'徳川家');assert.equal(migrated.save.state.clan,'徳川家');assert.equal(migrated.save.state.castles.okazaki.owner,'在地衆');assert.equal(migrated.save.state.castles.himeji.owner,'徳川家');assert.notEqual(migrated.save.state.home,'edo');assert.equal(migrated.save.state.castles.edo.owner,'太田家');assert.equal(migrated.save.state.resources.gold,12345);assert.equal(migrated.revision,2);assert(!migrated.save.state.officerVariants.includes('of_b0616adde162:U'));
 const canonical=(await write(admin,2,migrated.save)).data;assert.equal(canonical.save.state.clan,'徳川家');assert.deepEqual((await api('/sync',{token:admin.token})).data.save,canonical.save);
 console.log(JSON.stringify({ok:true,calls:h.calls,checks:['distinct reserved 德川家 and ordinary playable 徳川家','server-authoritative profile/session/save enforcement','admin fixed Edo and unchanged chosen lord name','ownership-only deterministic migration and idempotent restoration','revocation does not grant ordinary Tokugawa NPC castles','Edo victory rewards the attacker without capture or defender/shared-base writes; forged battle results rejected','existing metropolitan home saves remain valid'],productionRequests:0},null,2));
}finally{h.close();}
