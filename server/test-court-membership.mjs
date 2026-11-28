import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
let checks=0,calls=0,maxBindings=0;
const details=async(h,p)=>(await h.api('/court/membership',{token:p.token})).data.membership;
const request=async(h,p,extra={})=>{const preview=await details(h,p);return{requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:preview.expectedRevision,expectedHomeCastleId:preview.homeCastleId,confirmed:true,houseId:'konoe',...extra};};
const join=(h,p,body,expected=200,query='')=>h.api('/court/membership'+query,post(p,body,expected));
const dbState=h=>JSON.stringify(['court_membership_requests','court_retained_memberships','court_lineages','staff_members','staff_campaign_backups','branch_states','castle_residents','castle_seats','player_saves'].map(t=>[t,h.sql.prepare('SELECT * FROM '+t).all()]));
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 bind limit: '+s.params.length+' '+s.sql.slice(0,90));}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const fetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Membership tests must not contact a real service');};
try{
 await scope('rank requirement is authoritative and confirmation is mandatory',async h=>{
  await fixture(h,'受入責任者',{admin:true});const low=await fixture(h,'資格不足',{score:34999}),high=await fixture(h,'資格成立',{score:35000});
  await h.api('/court/membership',{expected:401});assert.equal((await details(h,low)).canJoin,false);assert.equal((await details(h,high)).canJoin,true);
  const status=(await h.api('/court',{token:high.token})).data.membership;assert.equal(status.requirement.minScore,35000);
  const insufficient=await join(h,low,await request(h,low),403);assert.equal(insufficient.data.error.code,'COURT_RANK_REQUIRED');
  const body=await request(h,high);await join(h,high,{...body,confirmed:false},400);await join(h,high,{...body,score:999999,isAdmin:true},400);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests').get().n,0);
 });
 await scope('enrollment releases ordinary territory and keeps major cities, identity, assets, officers and collected progress',async h=>{
  const admin=await fixture(h,'正式加入責任者',{admin:true}),player=await fixture(h,'正式加入者',{score:35000});
  updateSave(h,player,s=>{s.castles.nijo.owner=s.clan;s.castles.nijo.level=8;s.castles.inabayama.owner=s.clan;s.stats.gachaDraws=20;});
  const before=save(h,player),preview=await details(h,player),body=await request(h,player),joined=(await join(h,player,body)).data;
  assert.equal(joined.user.id,player.user.id);assert.equal(joined.user.isStaff,true);assert.equal(joined.user.isAdmin,false);assert.equal(joined.user.isDeputy,false);
  assert.equal(joined.save.state.home,'kyoto_gosho');assert.equal(joined.save.state.cycle.home,'kyoto_gosho');assert.equal(joined.membership.isMember,true);
  assert.deepEqual(joined.save.state.resources,before.state.resources);assert.equal(joined.save.state.magatama,before.state.magatama);
  assert.deepEqual(joined.save.state.officers,before.state.officers);assert.deepEqual(joined.save.state.officerVariants,before.state.officerVariants);assert.deepEqual(joined.save.state.tech,before.state.tech);
  assert.deepEqual(Object.entries(joined.save.state.castles).filter(([,c])=>c.owner===joined.save.state.clan).map(([id])=>id).sort(),['kyoto_gosho','nijo']);assert.equal(joined.save.state.castles.nijo.level,8);
  assert.deepEqual(preview.retainedCastles.map(c=>c.id),['nijo']);assert.deepEqual(preview.releasedCastles.map(c=>c.id).sort(),['inabayama','kiyosu']);assert.equal(preview.joinMode,'kyoto');assert.equal(preview.destinationHomeCastleId,'kyoto_gosho');
  assert.notEqual(joined.save.state.walking.campaignId,before.state.walking.campaignId);assert.equal(joined.admission.releasedCastleCount,preview.releasedCastleCount);assert.equal(joined.admission.retainedCastleCount,1);assert.equal(joined.admission.joinMode,'kyoto');assert.equal(joined.admission.destinationHomeCastleId,'kyoto_gosho');
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM castle_residents WHERE user_id=?').get(player.user.id).n,0);
  assert.equal(h.sql.prepare('SELECT lord_user_id FROM castle_seats WHERE castle_id=?').get(before.state.home).lord_user_id,null);
  assert.equal((await h.api('/court',{token:player.token})).data.self.title,'参議');
  await h.api('/admin/staff',post(player,{requestId:crypto.randomUUID(),action:'appoint',targetPlayerId:admin.user.id},403));
  await h.api('/admin/music',{token:player.token,expected:403});
  const sync=(await h.api('/sync?deviceId='+player.deviceId,{token:player.token})).data;
  assert.equal(sync.save.state.castles[before.state.home].owner===sync.save.state.clan,false,'ordinary sync must not resurrect the surrendered castle');
  const totals=(await h.api('/progress',{token:player.token})).data.progress;
  assert(totals);const initial=h.sql.prepare('SELECT data_json FROM progress_accounts WHERE user_id=?').get(player.user.id);assert.equal(JSON.parse(initial.data_json).totals.draws,20,'retained draw counts must be observed only once');
  await h.api('/sync',{method:'PUT',token:player.token,body:{deviceId:player.deviceId,revision:sync.revision,save:before},expected:409});
 });
 await scope('household departure promotes the longest serving eligible retainer',async h=>{
  await fixture(h,'家臣承継責任者',{admin:true});const lord=await fixture(h,'退く城主',{score:35000}),retainer=await fixture(h,'繰上げ家臣',{startCastle:'kiyosu'});
  await details(h,lord);const departed=(await join(h,lord,await request(h,lord))).data;assert.equal(departed.admission.previousHomeCastleId,'kiyosu');
  assert.equal(h.sql.prepare("SELECT lord_user_id FROM castle_seats WHERE castle_id='kiyosu'").get().lord_user_id,retainer.user.id);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM castle_residents WHERE user_id=?').get(lord.user.id).n,0);
 });
 await scope('Kyoto admission keeps only the major cities of protected regions and dismissal cannot recreate their entitlements',async h=>{
  const admin=await fixture(h,'制覇領地の受入責任者',{admin:true}),player=await fixture(h,'制覇領地を手放す加入者',{score:35000,startCastle:'ishikawa'}),tokai=globalThis.SENGOKU_DATA.regionConquest.regions.find(region=>region.region==='東海').castleIds;
  updateSave(h,player,s=>{for(const id of tokai)s.castles[id].owner=s.clan;s.castles.nagoya.level=8;s.castles.nagoya.wall=6;s.castles.nijo.owner=s.clan;s.cycle.protectedRegions=['東海'];s.cycle.retainedRegions=['東海'];s.jobs.push({kind:'castle',id:'nagoya',targetLevel:9,total:1,totalSeconds:60,remaining:1,remainingSeconds:50});});
  const preview=await details(h,player);assert.equal(preview.ownedCastleCount,tokai.length+2);assert.deepEqual(preview.ownedCastles.map(c=>c.id).sort(),[...tokai,'ishikawa','nijo'].sort());
  assert.deepEqual(preview.retainedCastles.map(c=>c.id).sort(),['nagoya','nijo']);assert.equal(preview.retainedCastleCount,2);assert.equal(preview.releasedCastleCount,tokai.length);
  const joined=(await join(h,player,await request(h,player))).data;assert.equal(joined.admission.releasedCastleCount,tokai.length);assert.equal(joined.admission.retainedCastleCount,2);assert.equal(joined.save.state.home,'kyoto_gosho');assert.deepEqual(joined.save.state.cycle.protectedRegions,[]);assert.deepEqual(joined.save.state.cycle.retainedRegions,[]);
  for(const id of [...tokai.filter(id=>id!=='nagoya'),'ishikawa']){assert.notEqual(joined.save.state.castles[id].owner,joined.save.state.clan,id);assert.equal(joined.save.state.castles[id].level,1,id);}
  for(const id of ['nagoya','nijo'])assert.equal(joined.save.state.castles[id].owner,joined.save.state.clan,id);assert.equal(joined.save.state.castles.nagoya.level,8);assert.equal(joined.save.state.castles.nagoya.wall,6);assert(joined.save.state.jobs.some(job=>job.kind==='castle'&&job.id==='nagoya'));
  const backup=JSON.parse(h.sql.prepare('SELECT save_json FROM staff_campaign_backups WHERE user_id=?').get(player.user.id).save_json);assert(['nagoya','nijo'].includes(backup.state.home));assert.deepEqual(backup.state.cycle.protectedRegions,[]);assert.deepEqual(backup.state.cycle.retainedRegions,[]);assert.deepEqual(Object.entries(backup.state.castles).filter(([,c])=>c.owner===backup.state.clan).map(([id])=>id).sort(),['nagoya','nijo']);
  await h.api('/admin/staff',post(admin,{targetPlayerId:player.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const restored=(await h.api('/sync?deviceId='+player.deviceId,{token:player.token})).data;assert.equal(restored.user.isStaff,false);assert.equal(restored.save.state.home,backup.state.home);assert.deepEqual(restored.save.state.cycle.protectedRegions,[]);assert.deepEqual(restored.save.state.cycle.retainedRegions,[]);
  for(const id of tokai.filter(id=>id!=='nagoya'))assert.notEqual(restored.save.state.castles[id].owner,restored.save.state.clan,id);assert.equal(restored.save.state.castles.nagoya.level,8);
  const reconnected=(await h.api('/sync?deviceId='+player.deviceId,{token:player.token})).data;assert.deepEqual(reconnected.save.state.cycle.protectedRegions,[]);for(const id of tokai.filter(id=>id!=='nagoya'))assert.notEqual(reconnected.save.state.castles[id].owner,reconnected.save.state.clan,id);
 });
 await scope('lost responses and retries never re-enroll, charge, or erase a later campaign',async h=>{
  const admin=await fixture(h,'再送受入責任者',{admin:true}),player=await fixture(h,'再送加入者',{score:35000}),body=await request(h,player);
  h.afterBatch=statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests'))){h.afterBatch=null;throw Error('membership response was lost');}};
  await join(h,player,body,500);const state=save(h,player),recovered=(await join(h,player,body,200,'?receipt=1')).data;
  assert.equal(recovered.admission.idempotent,true);assert.equal(recovered.save.state.walking.campaignId,state.state.walking.campaignId);
  const receiptCount=h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests').get().n;assert.equal(receiptCount,1);
  await join(h,player,{...body,requestId:crypto.randomUUID()},409);
  await join(h,player,{...body,expectedHomeCastleId:'inabayama'},409);
  await h.api('/admin/staff',post(admin,{targetPlayerId:player.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
  const dismissed=(await join(h,player,body,200,'?receipt=1')).data;assert.equal(dismissed.user.isStaff,false);assert.equal(dismissed.membership.isMember,false);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(player.user.id).n,0);
 });
 await scope('stale confirmation and wrong device are rejected before state changes',async h=>{
  await fixture(h,'競合責任者',{admin:true});const player=await fixture(h,'競合加入者',{score:35000}),body=await request(h,player);
  const before=save(h,player);await join(h,player,{...body,expectedHomeCastleId:'inabayama'},409);await join(h,player,{...body,deviceId:'different-device'},409);
  await join(h,player,{...body,requestId:crypto.randomUUID()},404,'?receipt=1');
  updateSave(h,player,s=>{s.prestige+=2;});await join(h,player,body,409);assert.equal(save(h,player).state.home,before.state.home);
  const next=await request(h,player);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;h.beforeBatch=null;updateSave(h,player,s=>{s.prestige=0;});};
  await join(h,player,next,409);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM staff_members WHERE user_id=?').get(player.user.id).n,0);
 });
 await scope('active main armies and alliance participants must finish before voluntary enrollment',async h=>{
  await fixture(h,'部隊参加責任者',{admin:true});const player=await fixture(h,'出陣中加入者',{score:35000}),target=await fixture(h,'出陣先領主',{startCastle:'inuyama'});
  const departed=(await h.api('/field/attack',post(player,{targetPlayerId:target.user.id,targetCastleId:'inuyama',deviceId:player.deviceId,expectedRevision:row(h,player).revision,requestId:crypto.randomUUID(),troops:1000,tactic:'balanced'}))).data;
  assert.equal(departed.marching,true);const body=await request(h,player),refused=await join(h,player,body,409);assert.equal(refused.data.error.code,'ARMY_MARCHING');assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests').get().n,0);
  const waiting=await fixture(h,'同盟部隊加入者',{score:35000}),q=await request(h,waiting);
  h.sql.prepare("INSERT INTO alliance_units(id,guild_id,owner_id,owner_epoch,castle_id,kind,state,troops,sent,expires_at,created_at) VALUES(?,?,?,0,'kiyosu','aid','stationed',1000,1000,?,?)").run('membership-aid','fixture-guild',waiting.user.id,h.now+3600000,h.now);
  assert.equal((await join(h,waiting,q,409)).data.error.code,'ARMY_MARCHING');
 });
 await scope('two concurrent confirmations create one membership and one new campaign',async h=>{
  await fixture(h,'同時加入責任者',{admin:true});const player=await fixture(h,'同時加入者',{score:35000}),body=await request(h,player);
  let pending=0,release;const ready=new Promise(resolve=>release=resolve);
  h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;if(++pending===2){h.beforeBatch=null;release();}await ready;};
  const results=await Promise.all([join(h,player,body),join(h,player,body)]);assert.equal(pending,2);assert.deepEqual(results.map(r=>r.data.admission.idempotent).sort(),[false,true]);
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests').get().n,1);assert.equal(results[0].data.save.state.walking.campaignId,results[1].data.save.state.walking.campaignId);
 });
 await scope('a moderation change at commit prevents enrollment without releasing the old base',async h=>{
  const admin=await fixture(h,'資格変更責任者',{admin:true}),player=await fixture(h,'資格変更加入者',{score:35000}),body=await request(h,player),before=save(h,player);
  h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;h.beforeBatch=null;h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?)').run(player.user.id,admin.user.id,h.now,h.now);};
  assert.equal((await join(h,player,body,403)).data.error.code,'ACCOUNT_BANNED');
  assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM court_membership_requests').get().n,0);assert.equal(save(h,player).state.home,before.state.home);assert.equal(save(h,player).state.castles[before.state.home].owner,before.state.clan);
 });
 await scope('receipt transaction rolls back household, role and save together',async h=>{
  await fixture(h,'原子性責任者',{admin:true});const player=await fixture(h,'原子性加入者',{score:35000}),body=await request(h,player);await h.api('/castles/residency',{token:player.token});
  const before=dbState(h);h.beforeBatch=statements=>{if(!statements.some(s=>s.sql.startsWith('INSERT INTO court_membership_requests')))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_membership_table SET value=1'));};
  await join(h,player,body,500);assert.equal(dbState(h),before);
 });
 console.log(`Court membership: ${checks} scenarios, ${calls} API calls, max ${maxBindings} D1 bindings`);
}finally{globalThis.fetch=fetch;}
