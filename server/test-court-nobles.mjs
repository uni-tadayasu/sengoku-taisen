import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const nobles=GAME_OFFICERS.filter(officer=>officer.courtNoble),first=nobles[0],second=nobles[1],clone=value=>JSON.parse(JSON.stringify(value));
let checks=0,calls=0,maxBindings=0;
async function scope(name,run){const h=harness(),batch=h.db.batch.bind(h.db);h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100,'D1 bind limit');}return batch(statements);};try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const view=async(h,p)=>(await h.api('/court/nobles',{token:p.token})).data;
const input=(h,p,id=first.id,requestId=crypto.randomUUID())=>({requestId,deviceId:p.deviceId,expectedRevision:row(h,p).revision,officerId:id});
const buy=(h,p,body=input(h,p),expected=200)=>h.api('/court/nobles/exchange',post(p,body,expected));
async function player(h,name='参内して公家を迎える',{score=35000,staff=false,...rest}={}){const p=await fixture(h,name,{score,staff,...rest});updateSave(h,p,s=>s.magatama=100000);return p;}
const ledger=(h,p)=>h.sql.prepare("SELECT COUNT(*) AS n FROM reward_requests WHERE actor_id=? AND kind='court_noble'").get(p.user.id).n;

await scope('catalog has 24 unique fixed-rank characters and uses existing admission access',async h=>{
 await h.api('/court/nobles',{expected:401});const low=await player(h,'参内資格未達',{score:34999}),visitor=await player(h);
 const no=await view(h,low),yes=await view(h,visitor);assert.equal(no.eligible,false);assert.match(no.reason,/35,000/);assert.equal(yes.eligible,true);assert.equal(yes.total,24);assert.equal(yes.ownedCount,0);assert.equal(yes.balance,100000);
 assert.equal(new Set(yes.catalog.map(o=>o.id)).size,24);assert.equal(new Set(yes.catalog.map(o=>o.name)).size,24);for(const rank of ['SS','SSS','U'])assert.equal(yes.catalog.filter(o=>o.rank===rank).length,8);
 assert(yes.catalog.every(o=>o.portrait==='assets/court-nobles/'+o.id+'.webp'&&o.cost>0&&!o.owned));
 assert.equal((await buy(h,low,input(h,low),403)).data.error.code,'COURT_NOBLE_ACCESS_REQUIRED');assert.equal(ledger(h,low),0);
 assert.equal((await h.api('/me',{token:visitor.token})).data.user.courtMember,false);
});
await scope('exchange debits exactly once, acquires a usable officer and has an idempotent retry',async h=>{
 const p=await player(h),body=input(h,p),before=save(h,p),r=(await buy(h,p,body)).data,s=r.save.state;
 assert.equal(r.receipt.officerId,first.id);assert.equal(r.receipt.cost,first.cost);assert.equal(r.idempotent,false);assert.equal(s.magatama,before.state.magatama-first.cost);assert.equal(r.nobles.balance,s.magatama);assert.equal(r.nobles.ownedCount,1);
 assert(s.officers.includes(first.id));assert(s.officerVariants.includes(first.id+':'+first.rank));assert.equal(s.officerHealth.values[first.id],100);assert.equal(s.stats.gachaDraws,before.state.stats.gachaDraws);
 const g=GameEngine.fromSave(r.save,GAME_OFFICERS);assert.equal(g.assignArmy([first.id]).ok,true);assert.equal(g.officer(first.id).rank,first.rank);
 const restored=GameEngine.fromSave(g.exportSave(),GAME_OFFICERS);assert(restored.state.officers.includes(first.id));assert.equal(restored.officer(first.id).skill,first.skill);
 const retry=(await buy(h,p,{...body,expectedRevision:0})).data;assert.equal(retry.idempotent,true);assert.equal(retry.save.state.magatama,s.magatama);assert.equal(ledger(h,p),1);
 assert.equal((await buy(h,p,input(h,p),409)).data.error.code,'COURT_NOBLE_OWNED');assert.equal(save(h,p).state.magatama,s.magatama);
 assert.equal((await buy(h,p,{...body,officerId:second.id},409)).data.error.code,'REQUEST_ID_REUSED');
});
await scope('all 24 nobles can be collected and cost exactly the displayed total',async h=>{
 const p=await player(h);for(const officer of nobles)await buy(h,p,input(h,p,officer.id));
 const v=await view(h,p);assert.equal(v.ownedCount,24);assert(v.catalog.every(o=>o.owned));assert.equal(v.balance,100000-nobles.reduce((sum,o)=>sum+o.cost,0));assert.equal(ledger(h,p),24);
 assert.equal(save(h,p).state.officers.filter(id=>id.startsWith('kuge_')).length,24);
});
await scope('insufficient balance and client price or rank fields never alter funds',async h=>{
 const p=await player(h);updateSave(h,p,s=>s.magatama=first.cost-1);const before=JSON.stringify(save(h,p));
 assert.equal((await buy(h,p,input(h,p),409)).data.error.code,'COURT_NOBLE_SHORTAGE');
 for(const extra of [{cost:0},{rank:'D'},{isStaff:true},{balance:100000},{officerId:'__proto__'}])await buy(h,p,{...input(h,p),...extra},400);
 assert.equal(JSON.stringify(save(h,p)),before);assert.equal(ledger(h,p),0);
});
await scope('parallel clicks and lost responses cannot charge or acquire twice',async h=>{
 const p=await player(h),body=input(h,p),responses=await Promise.all([buy(h,p,body),buy(h,p,body)]);
 assert(responses.some(r=>r.data.idempotent));assert.equal(ledger(h,p),1);assert.equal(save(h,p).state.magatama,100000-first.cost);
 const next=input(h,p,second.id);h.afterBatch=statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO reward_requests'))){h.afterBatch=null;throw Error('simulated lost exchange response');}};
 await buy(h,p,next,500);const accepted=await buy(h,p,next);assert.equal(accepted.data.idempotent,true);assert.equal(ledger(h,p),2);assert.equal(save(h,p).state.magatama,100000-first.cost-second.cost);
});
await scope('forged saved nobles and rank variants cannot bypass the exchange',async h=>{
 const p=await player(h),snap=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;
 const forged=clone(snap.save);forged.state.officers.push(first.id);forged.state.officerVariants.push(first.id+':'+first.rank);forged.state.officerHealth.values[first.id]=100;
 const r=await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:snap.revision,save:forged},expected:409});assert.equal(r.data.error.code,'COURT_NOBLE_RECEIPT_REQUIRED');
 forged.state.officerVariants[forged.state.officerVariants.length-1]=first.id+':D';await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:snap.revision,save:forged},expected:400});assert.equal(ledger(h,p),0);
});
await scope('older imports restore purchased nobles without returning spent magatama',async h=>{
 const p=await player(h),before=save(h,p),r=(await buy(h,p)).data;
 const imported=clone(r.save);imported.state.officers=before.state.officers;imported.state.officerVariants=before.state.officerVariants;delete imported.state.officerHealth.values[first.id];
 const synced=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:r.revision,save:imported}})).data;
 assert(synced.save.state.officers.includes(first.id));assert(synced.save.state.officerVariants.includes(first.id+':'+first.rank));assert.equal(synced.save.state.magatama,100000-first.cost);assert.equal(ledger(h,p),1);
});
await scope('formal Kyoto members keep their purchased nobles after dismissal',async h=>{
 const admin=await fixture(h,'公家任用の責任者',{admin:true}),p=await player(h,'京都御所の正式所属',{staff:true,score:35000});
 assert.equal((await h.api('/me',{token:p.token})).data.user.courtMember,true);await buy(h,p);
 await h.api('/admin/staff',post(admin,{targetPlayerId:p.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
 const current=(await h.api('/sync?deviceId='+p.deviceId,{token:p.token})).data;assert.equal(current.user.courtMember,false);assert(current.save.state.officers.includes(first.id));assert.equal(current.save.state.magatama,100000-first.cost);
});
await scope('a server-created new residency campaign restores purchased nobles immediately',async h=>{
 const p=await player(h);await buy(h,p);const previous=save(h,p).state.walking.campaignId;
 const result=(await h.api('/castles/residency/start',post(p,{requestId:crypto.randomUUID(),deviceId:p.deviceId,revision:row(h,p).revision,castleId:'inuyama',mode:'lord',clan:'織田家',difficulty:'normal'}))).data;
 assert.notEqual(result.save.state.walking.campaignId,previous);assert(result.save.state.officers.includes(first.id));assert(result.save.state.officerVariants.includes(first.id+':'+first.rank));assert.equal(result.save.state.officerHealth.values[first.id],100);assert(save(h,p).state.officers.includes(first.id));assert.equal(ledger(h,p),1);
});
await scope('retained-base formal admission remains eligible after score falls',async h=>{
 await fixture(h,'保持入会の責任者',{admin:true});const admin=await player(h,'本拠保持の正式加入');const officeDirectory=(await h.api('/admin/court/offices',{token:h.operator.token})).data;await h.api('/admin/court/offices',post(h.operator,{requestId:crypto.randomUUID(),action:'appoint',officeId:'sadaijin',targetPlayerId:admin.user.id,expectedRevision:officeDirectory.revision}));const details=(await h.api('/court/membership',{token:admin.token})).data.membership;
 const joined=(await h.api('/court/membership',post(admin,{requestId:crypto.randomUUID(),deviceId:admin.deviceId,expectedRevision:details.expectedRevision,expectedHomeCastleId:details.homeCastleId,confirmed:true,houseId:'konoe'}))).data;
 assert.equal(joined.admission.joinMode,'retained-base');assert.equal(joined.user.courtMember,true);
 updateSave(h,admin,s=>{s.prestige=0;});
 assert.equal((await view(h,admin)).eligible,true);const r=await buy(h,admin);assert(r.data.save.state.officers.includes(first.id));assert.equal(r.data.save.state.home,'kiyosu');
});
await scope('revoked admission during the atomic commit rejects the exchange without debit',async h=>{
 const admin=await fixture(h,'変更時の責任者',{admin:true}),p=await player(h,'交換途中の任命解除',{staff:true,score:34999}),body=input(h,p),before=save(h,p).state.magatama;
 h.beforeBatch=statements=>{if(statements.some(s=>s.sql.startsWith('INSERT INTO reward_requests'))){h.beforeBatch=null;h.sql.prepare('DELETE FROM staff_members WHERE user_id=?').run(p.user.id);}};
 await buy(h,p,body,409);assert.equal(ledger(h,p),0);assert.equal(save(h,p).state.magatama,before);
});
console.log(`${checks} court noble transaction scenarios passed (${calls} API calls, max ${maxBindings} SQL bindings).`);
