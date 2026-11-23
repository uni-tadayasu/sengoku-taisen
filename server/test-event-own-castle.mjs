import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,updateSave} from './test-court-support.mjs';

const write=(h,path,p,body,expected=200)=>h.api(path,post(p,body,expected)).then(r=>r.data);
const detail=(h,event,p)=>h.api('/events/'+event.id,{token:p?.token}).then(r=>r.data);
async function publish(h,op,battleId){
 const draft=await write(h,'/admin/events/generate',op,{battleId,durationDays:1,requestId:crypto.randomUUID()});
 return(await write(h,'/admin/events/'+draft.event.id+'/publish',op,{requestId:crypto.randomUUID()})).event;
}
const end=(h,op,event)=>write(h,'/admin/events/'+event.id+'/end',op,{requestId:crypto.randomUUID()});
async function resident(h,name,castleId,mode='lord'){
 const p=await h.session(name);p.deviceId='own-event-'+p.user.id;
 const lease=await write(h,'/sync/lease',p,{deviceId:p.deviceId});
 const joined=await write(h,'/castles/residency/start',p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'});
 assert.equal(joined.residency.role,mode);return p;
}
const relocate=(h,p,castleId)=>write(h,'/castles/residency/relocate',p,{deviceId:p.deviceId,revision:row(h,p).revision,requestId:crypto.randomUUID(),castleId});
const body=(h,p,extra={})=>({requestId:crypto.randomUUID(),stageId:'stage-1',tactic:'balanced',deviceId:p.deviceId,expectedRevision:row(h,p).revision,...extra});
const battle=(h,event,p,b=body(h,p),expected=200)=>write(h,'/events/'+event.id+'/battle',p,b,expected);
const economy=h=>['player_saves','timed_event_requests','timed_event_participants','timed_event_rewards','mail_campaigns','alliance_units'].map(table=>h.sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
const eligible=response=>assert.deepEqual(response.progress.battleEligibility,{canAttack:true,reason:null});
const own=response=>{assert.deepEqual(response.progress.battleEligibility,{canAttack:false,reason:'own_castle'});assert.deepEqual(response.progress.advisers,[]);};
function atCommit(h,fn){h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes('INSERT INTO timed_event_requests')||!statements[0].sql.includes("'battle'"))return;h.beforeBatch=null;await fn();};}
async function deniedWithoutMutation(h,event,p,b=body(h,p)){
 const before=economy(h),result=await battle(h,event,p,b,403);
 assert.equal(result.error.code,'EVENT_OWN_CASTLE');assert.deepEqual(economy(h),before);
}
let cases=0,calls=0,maxBindings=0;
async function scenario(label,run){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100);}return batch(statements);};
 try{await run(h);cases++;console.log('PASS '+label);}finally{calls+=h.calls;h.close();}
}

await scenario('an incumbent cannot spend commands or mutate a save by attacking their own event castle, while another lord can attack',async h=>{
 const op=await fixture(h,'催事の主催者',{admin:true}),owner=await resident(h,'姫路の領主','himeji'),other=await resident(h,'ほかの領主','okazaki');
 const event=await publish(h,op,'castle:himeji'),mine=await detail(h,event,owner);own(mine);assert(mine.progress.defenseAdviser);
 await deniedWithoutMutation(h,event,owner);
 // The ownership check precedes writer/cycle settlement, even with obsolete
 // metadata that would otherwise attempt synchronization or reject the lease.
 await deniedWithoutMutation(h,event,owner,body(h,owner,{expectedRevision:0,deviceId:'obsolete-device'}));
 const visitor=await detail(h,event);assert.equal(visitor.progress,null);assert(!JSON.stringify(visitor).includes('battleEligibility'));
 eligible(await detail(h,event,other));const accepted=await battle(h,event,other);
 assert.equal(accepted.battle.commandBefore-accepted.battle.commandAfter,1);assert.equal(accepted.battle.opponent.lordName,owner.user.name);
});

await scenario('succession between preparation and commit blocks the new incumbent without a battle receipt or another economy change',async h=>{
 const op=await fixture(h,'開催担当',{admin:true}),owner=await resident(h,'先代の領主','himeji'),successor=await resident(h,'先任家臣','himeji','retainer');
 const event=await publish(h,op,'castle:himeji');eligible(await detail(h,event,successor));
 let afterSuccession;
 atCommit(h,async()=>{await relocate(h,owner,'inuyama');afterSuccession=economy(h);});
 const rejected=await battle(h,event,successor,body(h,successor),403);assert.equal(rejected.error.code,'EVENT_OWN_CASTLE');
 assert(afterSuccession);assert.deepEqual(economy(h),afterSuccession);own(await detail(h,event,successor));
 await deniedWithoutMutation(h,event,successor);
});

await scenario('an earlier battle remains replayable after its attacker becomes the castle lord and after the event ends',async h=>{
 const op=await fixture(h,'戦いの主催者',{admin:true}),owner=await resident(h,'譲る領主','himeji'),successor=await resident(h,'譲られる家臣','himeji','retainer');
 const event=await publish(h,op,'castle:himeji'),request=body(h,successor),accepted=await battle(h,event,successor,request);
 await relocate(h,owner,'inuyama');own(await detail(h,event,successor));await deniedWithoutMutation(h,event,successor);
 const before=economy(h),replayed=await battle(h,event,successor,request);assert(replayed.idempotent);own(replayed);
 assert.deepEqual(replayed.battle,accepted.battle);assert.deepEqual(replayed.rewardMailIds,accepted.rewardMailIds);assert.deepEqual(economy(h),before);
 await end(h,op,event);const afterEnd=economy(h),ended=await battle(h,event,successor,request);
 assert(ended.idempotent);assert.deepEqual(ended.battle,accepted.battle);own(ended);assert.deepEqual(economy(h),afterEnd);
});

await scenario('every claimant of a disputed major city is blocked even outside the first two public candidates',async h=>{
 const op=await fixture(h,'都市の催事担当',{admin:true}),a=await fixture(h,'都市領主一',{startCastle:'himeji'}),b=await fixture(h,'都市領主二',{startCastle:'okazaki'}),c=await fixture(h,'都市領主三',{startCastle:'inuyama'}),visitor=await fixture(h,'都市の訪問者',{startCastle:'kiyosu'});
 for(const p of [op,a,b,c,visitor])updateSave(h,p,s=>{s.castles.osaka.owner=[a,b,c].includes(p)?s.clan:'在地衆';});
 const event=await publish(h,op,'history:osaka_winter');
 for(const p of [a,b,c]){const response=await detail(h,event,p);assert.equal(response.event.opponent,null);assert.equal(response.progress.defenseAdviser,null);own(response);await deniedWithoutMutation(h,event,p);}
 eligible(await detail(h,event,visitor));const accepted=await battle(h,event,visitor);assert.equal(accepted.battle.opponent,null);assert.equal(accepted.battle.enemyPower,event.plan.stages[0].enemyPower);
});

await scenario('a third claimant appearing after preview or just before commit invalidates eligibility even when the first two candidates do not change',async h=>{
 const op=await fixture(h,'所有確認の開催者',{admin:true}),players=await Promise.all([fixture(h,'候補一',{startCastle:'himeji'}),fixture(h,'候補二',{startCastle:'okazaki'}),fixture(h,'候補三',{startCastle:'inuyama'})]);
 players.sort((a,b)=>a.user.id.localeCompare(b.user.id));const [first,second,actor]=players;
 for(const p of [op,...players])updateSave(h,p,s=>{s.castles.nijo.owner=[first,second].includes(p)?s.clan:'在地衆';});
 const event=await publish(h,op,'castle:nijo');eligible(await detail(h,event,actor));
 let afterAcquisition;
 h.beforeStatement=sql=>{if(!sql.startsWith('SELECT 1 AS event_defense_current'))return;h.beforeStatement=null;updateSave(h,actor,s=>{s.castles.nijo.owner=s.clan;});afterAcquisition=economy(h);};
 const stale=await detail(h,event,actor);assert.equal(stale.event.opponent,null);assert.deepEqual(stale.progress.battleEligibility,{canAttack:false,reason:'refresh_required'});assert.equal(stale.progress.defenseAdviser,null);assert.deepEqual(economy(h),afterAcquisition);
 updateSave(h,actor,s=>{s.castles.nijo.owner='在地衆';});eligible(await detail(h,event,actor));
 atCommit(h,()=>{updateSave(h,actor,s=>{s.castles.nijo.owner=s.clan;});afterAcquisition=economy(h);});
 const denied=await battle(h,event,actor,body(h,actor),403);assert.equal(denied.error.code,'EVENT_OWN_CASTLE');assert.deepEqual(economy(h),afterAcquisition);
});

await scenario('fixed residences, shared palace ownership and a late staff appointment cannot attack their own event target',async h=>{
 const op=await fixture(h,'江戸の領主',{admin:true}),a=await fixture(h,'御所の領主一',{staff:true}),b=await fixture(h,'御所の領主二',{staff:true}),visitor=await fixture(h,'御所へ向かう領主',{startCastle:'himeji'});
 const edo=await publish(h,op,'castle:edo');own(await detail(h,edo,op));await deniedWithoutMutation(h,edo,op);await end(h,op,edo);
 const event=await publish(h,op,'castle:kyoto_gosho');
 for(const p of [a,b]){const response=await detail(h,event,p);assert.equal(response.event.opponent,null);own(response);await deniedWithoutMutation(h,event,p);}
 eligible(await detail(h,event,visitor));let afterAppointment;
 atCommit(h,async()=>{await write(h,'/admin/staff',op,{targetPlayerId:visitor.user.id,action:'appoint',requestId:crypto.randomUUID()});afterAppointment=economy(h);});
 const denied=await battle(h,event,visitor,body(h,visitor),403);assert.equal(denied.error.code,'EVENT_OWN_CASTLE');assert.deepEqual(economy(h),afterAppointment);own(await detail(h,event,visitor));
 await write(h,'/admin/staff',op,{targetPlayerId:visitor.user.id,action:'dismiss',requestId:crypto.randomUUID()});eligible(await detail(h,event,visitor));
});

console.log(JSON.stringify({cases,localHttpRequests:calls,maxBindings,productionRequests:0}));
