import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GameEngine as E,GAME_OFFICERS as officers} from './game-runtime.js';

// Independent family/estate review. All identities, clocks and API mutations
// live in test-support's in-memory SQLite; no production service is contacted.
const D=globalThis.SENGOKU_DATA,C=D.worldCalendar.monthsPerCycle*60000,U='of_b0616adde162:U';
const checks=[];let calls=0;
const owned=save=>Object.entries(save.state.castles).filter(([,castle])=>castle.owner===save.state.clan).map(([id])=>id).sort();
const post=(token,body,expected=200)=>({method:'POST',token,body,expected});
async function scope(name,run){
  const h=harness(),{sql,api}=h;
  const row=p=>sql.prepare('SELECT * FROM player_saves WHERE user_id=?').get(p.user.id);
  const clock=async()=> (await api('/world-clock')).data.clock;
  const at=elapsed=>sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=1,speed=1,revision=revision+1 WHERE id='world-v1'").run(elapsed,h.now);
  const sync=async p=>(await api('/sync?deviceId='+p.device,{token:p.token})).data;
  const put=async(p,save,expected=200)=>(await api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.device,revision:row(p).revision,save},expected})).data;
  const backup=p=>sql.prepare('SELECT * FROM staff_campaign_backups WHERE user_id=?').get(p.user.id);
  let admin;
  const role=async(p,action)=>(await api('/admin/staff',post(admin.token,{targetPlayerId:p.user.id,action,requestId:crypto.randomUUID()}))).data;
  const create=async(name,clan='織田家',{extra=false}={})=>{
    const p=await h.session(name,clan);p.device=p.user.id+'-writer';await api('/sync/lease',post(p.token,{deviceId:p.device}));
    const game=new E({officers,clan,startCastle:'himeji',seed:17});game.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};game.state.buildings.farm=5;game.state.castles.himeji.level=12;
    if(extra){game.state.castles.kiyosu={...game.state.castles.kiyosu,owner:clan,level:5};game.state.castles.nijo={...game.state.castles.nijo,owner:clan,level:33};}
    game.applyWorldClock(await clock());await put(p,JSON.parse(game.exportSave()));return p;
  };
  try{
    admin=await h.session('家名検証の運営');await api('/admin/claim',post(admin.token,{key:h.env.SENGOKU_ADMIN_KEY}));
    await run({h,sql,api,row,clock,at,sync,put,backup,role,create,admin});checks.push(name);console.log('PASS '+name);
  }finally{calls+=h.calls;h.close();}
}

await scope('all eight personal families round-trip exact estates without acquiring Tokugawa NPC castles',async c=>{
  const {h,api,clock,sync,put,role,create,admin}=c;
  assert.equal(D.staffClan.name,'德川家');assert.equal(D.staffClan.home,'kyoto_gosho');
  for(const [index,clan] of D.clans.map(x=>x.name).entries()){
    const freshStaff=new E({officers,isStaff:true,clan,seed:17});assert.equal(freshStaff.state.clan,'德川家');assert.equal(freshStaff.state.home,'kyoto_gosho');assert.equal(freshStaff.ownedCastles().length,1);assert(!freshStaff.ownsVariant('of_b0616adde162','U'));
    const p=await create('家名検証'+index,clan,{extra:true}),before=(await sync(p)).save,expected=owned(before);
    await role(p,'appoint');let staff=await sync(p);
    assert.equal(staff.save.state.clan,'德川家');assert.equal(staff.save.state.home,'kyoto_gosho');assert.equal(staff.staffBase.personalClan,clan);assert.equal(staff.staffBase.personalHome,'himeji');assert.deepEqual(owned(staff.save),[...expected,'kyoto_gosho'].sort());
    assert.deepEqual(staff.save.state.officerVariants,before.state.officerVariants);assert(!staff.save.state.officerVariants.includes(U));assert.notEqual(staff.save.state.castles.edo.owner,'德川家');
    for(const castle of D.castles.filter(x=>x.clan==='徳川家'&&!expected.includes(x.id)))assert.notEqual(staff.save.state.castles[castle.id].owner,'德川家',castle.id);
    const game=E.fromSave(staff.save,officers,{isStaff:true,staffBase:staff.staffBase});game.applyWorldClock(await clock());
    assert.equal(game.state.clan,'德川家');assert.equal(game.restoreAdminAssets().ok,false);assert.equal(game.selectAdminCastle().ok,false);
    game.state.castles.osaka={...game.state.castles.osaka,owner:game.state.clan,level:43};staff=await put(p,JSON.parse(game.exportSave()));
    const me=(await api('/me',{token:p.token})).data.user,found=(await api('/players?q='+encodeURIComponent(p.user.name),{token:admin.token})).data.players.find(x=>x.id===p.user.id),field=(await api('/field')).data.players.find(x=>x.playerId===p.user.id);
    assert.equal(me.clan,'德川家');assert.equal(me.isStaff,true);assert.equal(me.isAdmin,false);assert.equal(found.clan,'徳川家');assert.equal(Object.hasOwn(found,'isStaff'),false);assert.equal(Object.hasOwn(found,'isAdmin'),false);
    assert.equal(field.clan,'徳川家');assert.equal(field.homeCastleId,'kyoto_gosho');assert.equal(Object.hasOwn(field,'isAdmin'),false);assert.equal(Object.hasOwn(field,'isStaff'),false);
    const event=(await api('/achievements?limit=50')).data.events.find(x=>x.playerId===p.user.id&&x.targetId==='osaka');assert(event);assert.equal(event.clan,'徳川家');
    if(index===0){
      await api('/presence',post(p.token,{deviceId:p.device,deviceName:'検証端末',online:true}));const online=(await api('/online')).data.players.find(x=>x.id===p.user.id);assert.equal(online.clan,'徳川家');assert.equal(Object.hasOwn(online,'isAdmin'),false);
      const exclusive=structuredClone(staff.save);if(!exclusive.state.officers.includes('of_b0616adde162'))exclusive.state.officers.push('of_b0616adde162');exclusive.state.officerVariants.push(U);await put(p,exclusive,403);
      const edo=structuredClone(staff.save);edo.state.home='edo';edo.state.castles.edo.owner=edo.state.clan;await put(p,edo,403);
      await api('/admin/announcement',post(p.token,{text:'権限なし'},403));
    }
    await role(p,'dismiss');
    const immediate=(await api('/field')).data.players.find(x=>x.playerId===p.user.id);
    assert.equal(immediate,undefined,'A dismissed officer has no public palace home');
    assert.equal((await api('/me',{token:p.token})).data.user.clan,clan);
    const restored=await sync(p);assert.equal(restored.save.state.clan,clan);assert.equal(restored.user.clan,clan);assert.equal(restored.user.isStaff,false);assert.deepEqual(owned(restored.save),[...expected,'osaka'].sort());assert.equal(restored.save.state.castles.osaka.level,43);assert.equal(restored.save.state.castles.himeji.level,12);assert.equal(restored.save.state.buildings.farm,5);assert.equal(restored.staffBase,null);E.fromSave(restored.save,officers);
    const seated=await put(p,restored.save);
    const publicHome=(await api('/field')).data.players.find(x=>x.playerId===p.user.id);
    assert.equal(Boolean(publicHome),seated.residency.role==='lord');
    if(publicHome){assert.equal(publicHome.clan,clan);assert.equal(publicHome.homeCastleId,'himeji');}
    if(index===0){const forged=structuredClone(staff.save);forged.state.isAdmin=true;forged.state.isStaff=true;forged.state.staffService={baseId:'kyoto_gosho',personalClan:'德川家'};await put(p,forged,403);await api('/staff/base',{token:p.token,expected:403});}
  }
  await api('/session',post(null,{name:'偽装德川家',clan:'德川家'},403));
});

await scope('cycle reset and reverse transfer do not absorb ordinary Tokugawa CPU territories',async c=>{
  const {api,at,sync,put,role,create,clock}=c;at(C-1);const p=await create('周回と元徳川家','徳川家',{extra:true});await role(p,'appoint');const prior=await sync(p);at(C+1000);
  let settled=(await api('/sync/settle',post(p.token,{deviceId:p.device,revision:prior.revision}))).data;
  const ordinaryTokugawa=D.castles.filter(x=>x.clan==='徳川家'&&x.id!=='edo').map(x=>x.id);
  assert(ordinaryTokugawa.some(id=>settled.save.state.castles[id].owner==='徳川家'));assert.deepEqual(owned(settled.save),['kyoto_gosho']);
  // Newly captured cities use the current cap, then retain that exact growth on dismissal.
  const game=E.fromSave(settled.save,officers,{isStaff:true,staffBase:settled.staffBase});game.applyWorldClock(await clock());game.state.castles.nijo={...game.state.castles.nijo,owner:game.state.clan,level:48};settled=await put(p,JSON.parse(game.exportSave()));
  await role(p,'dismiss');const restored=await sync(p);assert.equal(restored.save.state.clan,'徳川家');assert.deepEqual(owned(restored.save),['himeji','nijo']);assert.equal(restored.save.state.castles.himeji.level,12);assert.equal(restored.save.state.castles.nijo.level,48);
  for(const id of ordinaryTokugawa)assert.notEqual(restored.save.state.castles[id].owner,'徳川家',id);E.fromSave(restored.save,officers);
});

await scope('personal, legacy shared and fixed-family income use separate exact timestamp intervals',async c=>{
  const {h,sql,at,sync,role,create,clock}=c,p=await create('家名切替の旧スタッフ','織田家'),original=(await sync(p)).save;
  sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('staffClanPolicyStart','90000',?) ON CONFLICT(key) DO UPDATE SET value='90000'").run(h.now);
  at(30000);await role(p,'appoint');const response=await sync(p),base=response.staffBase;assert.equal(base.accessSinceElapsedMs,30000);assert.equal(base.clanSinceElapsedMs,90000);assert.equal(base.personalClan,'織田家');
  const game=E.fromSave(response.save,officers,{isStaff:true,staffBase:base}),ordinary=E.fromSave(original,officers);assert.equal(game.state.clan,'織田家');assert.equal(game.state.home,'himeji');
  const world=await clock();game.applyWorldClock({...world,elapsedMs:30000});ordinary.applyWorldClock({...world,elapsedMs:30000});assert.deepEqual(game.state.resources,ordinary.state.resources);assert.equal(game.state.clan,'織田家');assert.equal(game.state.home,'kyoto_gosho');
  const privateRate=game.income().gold,gold=game.state.resources.gold,territory=owned(JSON.parse(game.exportSave()));game.applyWorldClock({...world,elapsedMs:90000});assert.equal(game.state.resources.gold-gold,privateRate);assert.equal(game.state.clan,'德川家');assert.deepEqual(owned(JSON.parse(game.exportSave())),territory);
  const fixedRate=game.income().gold;assert(fixedRate<privateRate,'Oda bonus must stop at the rollout timestamp');const after=game.state.resources.gold;game.applyWorldClock({...world,elapsedMs:150000});assert.equal(game.state.resources.gold-after,fixedRate);
  const oneBatch=E.fromSave(response.save,officers,{isStaff:true,staffBase:base});oneBatch.applyWorldClock({...world,elapsedMs:150000});assert.deepEqual(oneBatch.state.resources,game.state.resources);assert.equal(oneBatch.state.seed,game.state.seed);
  at(150000);await role(p,'dismiss');const restored=await sync(p);assert.equal(restored.save.state.clan,'織田家');assert.equal(restored.save.state.home,'himeji');assert.deepEqual(restored.save.state.resources,game.state.resources);E.fromSave(restored.save,officers);
});

await scope('operator and staff transitions keep Edo and U exclusive despite their shared family name',async c=>{
  const {h,sql,api,sync,role,create,admin,backup}=c,p=await create('運営スタッフ切替','織田家',{extra:true});await role(p,'appoint');const staff=await sync(p),before=owned(staff.save).filter(id=>id!=='kyoto_gosho');
  // A recovered deployment may retain staff rows after losing its admin setting.
  sql.prepare("DELETE FROM settings WHERE key='adminUserId'").run();await api('/admin/claim',post(p.token,{key:h.env.SENGOKU_ADMIN_KEY}));const operator=await sync(p);
  assert.equal(operator.user.isAdmin,true);assert.equal(operator.user.isStaff,false);assert.equal(operator.save.state.home,'edo');assert.equal(operator.save.state.clan,'德川家');assert(operator.save.state.officerVariants.includes(U));assert.deepEqual(owned(operator.save),[...before,'edo'].sort());assert.equal(operator.staffBase,null);assert.equal(backup(p).active,0);
  // Restore the canonical operator; the existing staff membership must not
  // retain the exclusive officer or Edo on its next verified synchronization.
  sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(admin.user.id);const returned=await sync(p);
  assert.equal(returned.user.isAdmin,false);assert.equal(returned.user.isStaff,true);assert.equal(returned.save.state.home,'kyoto_gosho');assert.equal(returned.save.state.clan,'德川家');assert(!returned.save.state.officerVariants.includes(U));assert.notEqual(returned.save.state.castles.edo.owner,'德川家');
  const personalClan=returned.staffBase.personalClan;await role(p,'dismiss');const ordinary=await sync(p);assert.equal(ordinary.save.state.clan,personalClan);assert.equal(ordinary.user.clan,personalClan);assert(!ordinary.save.state.officerVariants.includes(U));assert(!['edo','kyoto_gosho'].includes(ordinary.save.state.home));E.fromSave(ordinary.save,officers);
});

console.log(JSON.stringify({ok:true,calls,checks,productionRequests:0},null,2));
