import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
const CYCLE=672*60000;
const h=harness();
const post=(token,body)=>({method:'POST',token,body});
const clock=elapsed=>h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=1,speed=1 WHERE id=?').run(elapsed,h.now,'world-v1');
async function fixture(name='周回検証の領主',home='kiyosu'){
 h.resetRates();const user=await h.session(name);await h.api('/world-clock');clock(CYCLE-1000);
 await h.api('/sync/lease',post(user.token,{deviceId:'device-a'}));
 const save=h.fresh(home),s=save.state;s.turn=671;s.worldClock={id:'world-v1',elapsedMs:CYCLE-1000};s.realtime.elapsed=59;
 s.castles.inabayama.owner=s.clan;s.castles.inuyama.owner=s.clan;s.castles[s.home].level=7;s.resources.gold=10000;s.resources.rice=20000;s.magatama=5000;
 s.jobs=[{kind:'castle',id:'inabayama',targetLevel:2,total:3,remaining:3,totalSeconds:180,remainingSeconds:180}];
 const saved=(await h.api('/sync',{method:'PUT',token:user.token,body:{deviceId:'device-a',revision:0,save}})).data;
 return {user,saved};
}
try{
 const {user,saved}=await fixture();assert.equal(saved.save.state.cycle.index,0);assert.equal((await h.api('/achievements')).data.events.length,0,'first save has no fabricated historical achievements');
 clock(CYCLE);let entered=0,release;const barrier=new Promise(resolve=>{release=resolve;});
 h.beforeBatch=async statements=>{if(statements[0]?.sql.includes('cycle_commit=?')&&statements[0]?.sql.includes('NOT EXISTS(SELECT 1 FROM cycle_receipts')){entered++;if(entered===2)release();await barrier;}};
 const [a,b]=await Promise.all([h.api('/sync/settle',post(user.token,{deviceId:'device-a',revision:1})),h.api('/sync/settle',post(user.token,{deviceId:'device-a',revision:1}))]);h.beforeBatch=null;
 assert.equal(entered,2,'both calls compete on same pre-boundary save');
 const next=a.data;assert.deepEqual(a.data.save,b.data.save);assert.equal(next.revision,2);assert.equal(next.save.state.cycle.index,1);assert.equal(next.save.state.cycle.latestReward.captured,2);
 assert.equal(next.save.state.cycle.latestReward.gold,2000);assert.equal(next.save.state.cycle.latestReward.magatama,200);
 assert.equal(next.save.state.magatama,5000+200+globalThis.SENGOKU_DATA.gacha.monthlyReward);assert.equal(next.save.state.castles[next.save.state.home].level,7);
 assert.equal(Object.values(next.save.state.castles).filter(c=>c.owner===next.save.state.clan).length,1);assert.equal(next.save.state.jobs.length,0);
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM cycle_receipts WHERE user_id=?').get(user.user.id).n,1);
 for(let i=0;i<4;i++)assert.equal((await h.api('/sync?deviceId=device-a',{token:user.token})).data.revision,2);
 const replay=await h.api('/sync',{method:'PUT',token:user.token,body:{deviceId:'device-a',revision:1,save:saved.save},expected:409});assert(['REVISION_CONFLICT','CYCLE_SETTLEMENT_REQUIRED'].includes(replay.data.error.code));
 const ancient=structuredClone(saved.save);await h.api('/sync',{method:'PUT',token:user.token,body:{deviceId:'device-a',revision:2,save:ancient},expected:409});
 assert.equal((await h.api('/sync',{token:user.token})).data.save.state.magatama,next.save.state.magatama,'old imported cycle cannot repeat or erase the grant');
 const feed=(await h.api('/achievements')).data;assert.equal(feed.events.length,1);assert.equal(feed.events[0].playerName,'周回検証の領主');assert.equal(feed.events[0].value,2);assert.equal(feed.events[0].kind,'cycle');
 assert.deepEqual(Object.keys(feed.events[0]).sort(),['id','playerId','playerName','playerEvaluation','playerAppearance','playerAvatarVersion','playerCourtOffice','avatarVersion','clan','kind','title','detail','targetId','targetName','value','occurredAt'].sort());
 await h.api('/achievements?limit=51',{expected:400});await h.api('/achievements?cursor=not-valid',{expected:400});
 const progress=structuredClone(next.save);progress.state.buildings.keep=4;progress.state.tech.commerce=1;
 const upgraded=(await h.api('/sync',{method:'PUT',token:user.token,body:{deviceId:'device-a',revision:2,save:progress}})).data;
 const publicRows=(await h.api('/achievements?limit=1')).data;assert(publicRows.nextCursor);const more=(await h.api('/achievements?limit=1&cursor='+encodeURIComponent(publicRows.nextCursor))).data;assert.notEqual(publicRows.events[0].id,more.events[0].id);
 assert.equal((await h.api('/achievements')).data.events.length,3);await h.api('/sync',{method:'PUT',token:user.token,body:{deviceId:'device-a',revision:3,save:upgraded.save}});assert.equal((await h.api('/achievements')).data.events.length,3,'repeat save produces no repeated milestone');
 // Lazy settlement is bounded. Later unplayed cycles contain no captured castles.
 h.now+=31000;clock(CYCLE*7);let current=(await h.api('/sync',{token:user.token})).data;assert.equal(current.save.state.cycle.index,3);
 for(let i=0;i<3&&current.save.state.cycle.index<7;i++)current=(await h.api('/sync',{token:user.token})).data;
 assert.equal(current.save.state.cycle.index,7);const receipts=h.sql.prepare('SELECT * FROM cycle_receipts WHERE user_id=? ORDER BY cycle_index').all(user.user.id);assert.equal(receipts.length,7);assert(receipts.slice(1).every(r=>r.captured===0&&r.magatama===0));
 // A forced receipt write failure rolls the state, grant, and feed back together.
 h.resetRates();const second=await fixture('原子的な精算');clock(CYCLE);
 h.sql.exec("CREATE TRIGGER reject_cycle BEFORE INSERT ON cycle_receipts BEGIN SELECT RAISE(ABORT,'local simulated outage'); END");
 await h.api('/sync/settle',{...post(second.user.token,{deviceId:'device-a',revision:1}),expected:500});
 assert.equal(h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(second.user.user.id).revision,1);
 h.sql.exec('DROP TRIGGER reject_cycle');assert.equal((await h.api('/sync/settle',post(second.user.token,{deviceId:'device-a',revision:1}))).data.save.state.cycle.latestReward.captured,2);

 // Reader polls preserve the active writer's final unsaved occupation.
 const dirty=await fixture('境界直前の操作');clock(CYCLE);
 const polled=(await h.api('/sync?deviceId=follower',{token:dirty.user.token})).data;assert.equal(polled.revision,1);assert.equal(polled.save.state.cycle.index,0);
 const fieldPoll=(await h.api('/field/me?deviceId=device-a',{token:dirty.user.token})).data;assert.equal(fieldPoll.self?.cycle?.index,undefined);assert.equal(h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(dirty.user.user.id).revision,1);
 await h.api('/sync/settle',{...post(dirty.user.token,{deviceId:'follower',revision:1}),expected:409});
 const last=structuredClone(dirty.saved.save);last.state.castles.odani.owner=last.state.clan;last.state.worldClock.elapsedMs=CYCLE-1;last.state.realtime.elapsed=59.999;
 const final=(await h.api('/sync',{method:'PUT',token:dirty.user.token,body:{deviceId:'device-a',revision:1,save:last}})).data;
 assert.equal(final.save.state.cycle.latestReward.captured,3,'final preboundary capture is counted before the atomic reset');assert.equal(final.revision,3);
 // An unchanged checkpoint at boundary−1 is explicitly finalized by the writer.
 const unchanged=await fixture('変更のない境界');const almost=structuredClone(unchanged.saved.save);clock(CYCLE-1);almost.state.worldClock.elapsedMs=CYCLE-1;almost.state.realtime.elapsed=59.999;
 const ready=(await h.api('/sync',{method:'PUT',token:unchanged.user.token,body:{deviceId:'device-a',revision:1,save:almost}})).data;clock(CYCLE);
 assert.equal((await h.api('/sync',{token:unchanged.user.token})).data.revision,ready.revision);
 assert.equal((await h.api('/sync/settle',post(unchanged.user.token,{deviceId:'device-a',revision:ready.revision}))).data.save.state.cycle.index,1);
 // Public field/ranking projections drop stale captures at the boundary without forcing the writer.
 const projected=await fixture('公開地図の検証','himeji');const guild=(await h.api('/guild',post(projected.user.token,{name:'周回する軍団'}))).data.guild;
 assert.equal((await h.api('/guild/rankings')).data.guilds.find(g=>g.id===guild.id).ownedCastles,3);clock(CYCLE);
 assert.equal((await h.api('/guild/rankings')).data.guilds.find(g=>g.id===guild.id).ownedCastles,1);
 const field=(await h.api('/field?limit=100')).data.players.find(p=>p.playerId===projected.user.user.id);assert.equal(field.homeCastleId,'himeji');assert.equal(field.attackable,false);
 assert.equal(h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(projected.user.user.id).revision,1);
 await h.api('/guild/treasury/transfer',{...post(projected.user.token,{guildId:guild.id,direction:'deposit',resource:'gold',amount:10,requestId:'old-writer',deviceId:'old-device',expectedRevision:1}),expected:409});
 assert.equal(h.sql.prepare('SELECT revision FROM player_saves WHERE user_id=?').get(projected.user.user.id).revision,1,'stale writer command cannot trigger settlement');
 // Legacy sub-millisecond real-time phases receive a consistent millisecond anchor.
 h.resetRates();clock(CYCLE-1000);const fractional=await h.session('端数時刻の移行');await h.api('/sync/lease',post(fractional.token,{deviceId:'fraction'}));const old=h.fresh();old.state.realtime.elapsed=.123456;
 await h.api('/sync',{method:'PUT',token:fractional.token,body:{deviceId:'fraction',revision:0,save:old}});h.now+=31000;clock(CYCLE);
 const fraction=(await h.api('/sync',{token:fractional.token})).data;assert.equal(fraction.save.state.cycle.index,1);assert.equal(fraction.save.state.worldClock.elapsedMs%60000/1000,fraction.save.state.realtime.elapsed);
 // Operators retain their exclusive protected Edo base and U grant across reset.
 h.resetRates();clock(CYCLE-1000);const admin=await h.session('周回する運営');await h.api('/admin/claim',post(admin.token,{key:h.env.SENGOKU_ADMIN_KEY}));await h.api('/sync/lease',post(admin.token,{deviceId:'admin'}));const adminSave=h.fresh();adminSave.state.turn=671;adminSave.state.realtime.elapsed=59;adminSave.state.worldClock={id:'world-v1',elapsedMs:CYCLE-1000};
 await h.api('/sync',{method:'PUT',token:admin.token,body:{deviceId:'admin',revision:0,save:adminSave}});clock(CYCLE);
 const adminNext=(await h.api('/sync/settle',post(admin.token,{deviceId:'admin',revision:1}))).data.save.state;
 assert.equal(adminNext.clan,'德川家');assert.equal(adminNext.home,'edo');assert.equal(adminNext.castles.edo.owner,'德川家');assert.equal(Object.values(adminNext.castles).filter(c=>c.owner===adminNext.clan).length,1);assert(adminNext.officerVariants.includes('of_b0616adde162:U'));

 // Demotion does not recreate the exclusive clan, Edo entitlement, or U variant.
 h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(user.user.id);clock(CYCLE*2);
 const revoked=(await h.api('/sync/settle',post(admin.token,{deviceId:'admin',revision:2}))).data.save.state;
 assert.equal(revoked.clan,'徳川家');assert.notEqual(revoked.home,'edo');assert.notEqual(revoked.castles.edo.owner,revoked.clan);assert(!revoked.officerVariants.includes('of_b0616adde162:U'));

 // Takeover during engine computation does not let the old writer close the new writer's cycle.
 const takeover=await fixture('精算中の端末切替');clock(CYCLE);let switched=false;
 h.beforeBatch=async statements=>{if(!switched&&statements[0]?.sql.includes('NOT EXISTS(SELECT 1 FROM cycle_receipts')){switched=true;h.sql.prepare('UPDATE player_saves SET writer_device_id=?,lease_expires_at=? WHERE user_id=?').run('new-device',h.now+30000,takeover.user.user.id);}};
 const lostLease=(await h.api('/sync/settle',post(takeover.user.token,{deviceId:'device-a',revision:1}))).data;h.beforeBatch=null;
 assert.equal(lostLease.save.state.cycle.index,0);assert.equal(lostLease.writable,false);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM cycle_receipts WHERE user_id=?').get(takeover.user.user.id).n,0);
 assert.equal((await h.api('/sync/settle',post(takeover.user.token,{deviceId:'new-device',revision:1}))).data.save.state.cycle.index,1);
 // A formerly offline target that acquires a lease while being read is likewise left to its writer.
 const readerRace=await fixture('読み込み中の操作再開');h.now+=31000;clock(CYCLE);let acquired=false;
 h.beforeBatch=async statements=>{if(!acquired&&statements[0]?.sql.includes('NOT EXISTS(SELECT 1 FROM cycle_receipts')){acquired=true;h.sql.prepare('UPDATE player_saves SET writer_device_id=?,lease_expires_at=? WHERE user_id=?').run('resumed',h.now+30000,readerRace.user.user.id);}};
 const raced=(await h.api('/sync',{token:readerRace.user.token})).data;h.beforeBatch=null;assert.equal(raced.save.state.cycle.index,0);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM cycle_receipts WHERE user_id=?').get(readerRace.user.user.id).n,0);

 // Server-completed construction during boundary catch-up is announced atomically too.
 const complete=await fixture('普請を終えた領主');const work=structuredClone(complete.saved.save);work.state.buildings.keep=3;work.state.jobs=[{kind:'building',id:'keep',targetLevel:4,total:1,remaining:1,totalSeconds:60,remainingSeconds:1}];
 await h.api('/sync',{method:'PUT',token:complete.user.token,body:{deviceId:'device-a',revision:1,save:work}});clock(CYCLE);
 await h.api('/sync/settle',post(complete.user.token,{deviceId:'device-a',revision:2}));
 const completedFeed=(await h.api('/achievements?limit=50')).data.events.filter(e=>e.playerId===complete.user.user.id);assert(completedFeed.some(e=>e.kind==='building'&&e.targetId==='keep'&&e.value===4));
 // Existing saves at rollout are anchored at rollout, not paid for old calendar loops.
 h.sql.prepare("UPDATE settings SET value='10' WHERE key='cyclePolicyStart'").run();clock(CYCLE*10+1000);
 const legacy=await h.session('古い記録の復帰');await h.api('/sync/lease',post(legacy.token,{deviceId:'legacy'}));
 h.sql.prepare('UPDATE player_saves SET save_json=?,revision=1,cycle_index=NULL,cycle_home=NULL WHERE user_id=?').run(JSON.stringify(h.fresh()),legacy.user.id);
 const migrated=(await h.api('/sync',{token:legacy.token})).data;assert.equal(migrated.save.state.cycle.index,10);assert.equal(migrated.save.state.cycle.latestReward,null);assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM cycle_receipts WHERE user_id=?').get(legacy.user.id).n,0);
 console.log(JSON.stringify({ok:true,calls:h.calls,checks:['concurrent same-boundary CAS','exact one reward receipt and public event','home and development retained','captured castles and foreign jobs reset','old save/revision cannot repeat grant','public bounded feed with pagination and privacy','accepted milestones only, no historical seeding','bounded multi-cycle catch-up without repeated captured rewards','transaction rollback and retry','rollout anchor prevents retroactive rewards','active writer dirty snapshot protected from reader and field polls','final preboundary capture included before reset','unchanged checkpoint explicit settlement and follower denial','public field and guild counts project new cycle immediately','legacy fractional clock migration','operator Edo/U retained and demotion restrictions preserved','commit-time writer takeover and resumed-target lease race','stale commands cannot force another writer settlement','server-completed construction announced atomically']}));
}finally{h.close();}
