import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,updateSave} from './test-court-support.mjs';
import {generateEventPlan,adviseEventDefense} from './event-planner.js';

const write=(h,path,p,body,expected=200)=>h.api(path,post(p,body,expected)).then(r=>r.data);
const detail=(h,id,p,expected=200,query='')=>h.api('/events/'+id+query,{token:p?.token,expected}).then(r=>r.data);
async function publish(h,op,battleId){
 const draft=await write(h,'/admin/events/generate',op,{battleId,durationDays:1,requestId:crypto.randomUUID()});
 return(await write(h,'/admin/events/'+draft.event.id+'/publish',op,{requestId:crypto.randomUUID()})).event;
}
async function resident(h,name,castleId,mode='lord'){
 const p=await h.session(name);p.deviceId='defense-'+p.user.id;
 const lease=await write(h,'/sync/lease',p,{deviceId:p.deviceId});
 const joined=await write(h,'/castles/residency/start',p,{deviceId:p.deviceId,revision:lease.revision,requestId:crypto.randomUUID(),castleId,mode,clan:'織田家',difficulty:'normal'});
 assert.equal(joined.residency.role,mode);return p;
}
const relocate=(h,p,castleId)=>write(h,'/castles/residency/relocate',p,{deviceId:p.deviceId,revision:row(h,p).revision,requestId:crypto.randomUUID(),castleId});
const state=h=>['player_saves','timed_events','timed_event_requests','timed_event_participants','timed_event_rewards','alliance_units','mail_campaigns'].map(table=>h.sql.prepare('SELECT * FROM '+table+' ORDER BY rowid').all());
function checkAdvice(response){
 const a=response.progress.defenseAdviser,o=response.event.opponent;assert(a&&o);
 assert.deepEqual(Object.keys(a).sort(),['castleId','castleName','defenseTroops','defensePower','reinforcementTroops','headline','summary','measures','stages'].sort());
 for(const key of ['castleId','castleName','defenseTroops','defensePower'])assert.equal(a[key],o[key]);
 assert(a.reinforcementTroops<=a.defenseTroops);assert(a.measures.length>0&&a.measures.length<=12);assert(a.stages.length===3);
 assert(a.measures.every(m=>[1,2,3].includes(m.priority)&&m.title.length<=160&&m.detail.length<=1500));
 assert(a.stages.every(s=>response.event.plan.stages.some(p=>p.id===s.stageId)&&response.event.plan.tactics.some(t=>t.id===s.attackTactic)&&s.defensePlan.length<=300));
 assert(a.summary.includes('勝率は算出しません'));assert(a.summary.includes('自動実行も行いません'));
 assert(!JSON.stringify(a).includes('winChance'));assert(!JSON.stringify(a).includes('userId'));assert(!JSON.stringify(a).includes('isAdmin'));
 return a;
}
let cases=0,calls=0;
async function scenario(label,run){const h=harness();try{await run(h);cases++;console.log('PASS '+label);}finally{calls+=h.calls;h.close();}}

await scenario('defense advice belongs to the authenticated incumbent only and reading it changes no campaign, command, reward or event',async h=>{
 const op=await fixture(h,'開催奉行',{admin:true}),owner=await resident(h,'姫路の現職領主','himeji'),retainer=await resident(h,'姫路の家臣','himeji','retainer'),other=await resident(h,'別の領主','okazaki');
 const event=await publish(h,op,'castle:himeji'),before=state(h);
 const own=checkAdvice(await detail(h,event.id,owner));assert.equal(own.castleId,'himeji');
 assert.equal((await detail(h,event.id)).progress,null);
 assert.equal((await detail(h,event.id,retainer)).progress.defenseAdviser,null);
 assert.equal((await detail(h,event.id,other,200,'?playerId='+owner.user.id+'&lordName='+encodeURIComponent(owner.user.name))).progress.defenseAdviser,null);
 assert.equal((await detail(h,event.id,op)).progress.defenseAdviser,null);
 assert.equal((await detail(h,event.id,{token:'not-a-valid-session'},401)).error.code,'AUTH_REQUIRED');
 assert.deepEqual(state(h),before,'advice has no combat or economy mutations');
 await write(h,'/admin/events/'+event.id+'/end',op,{requestId:crypto.randomUUID()});
 assert.equal((await detail(h,event.id,owner)).progress.defenseAdviser,null);
 const field=await publish(h,op,'history:sekigahara');assert.equal((await detail(h,field.id,owner)).progress.defenseAdviser,null);
});

await scenario('current walls, castle, research, army and stationed aid change the recommendations without granting any defense buff',async h=>{
 const op=await fixture(h,'開催者',{admin:true}),owner=await resident(h,'守備を整える領主','okazaki'),ally=await fixture(h,'援軍の領主',{startCastle:'himeji'});
 const event=await publish(h,op,'castle:okazaki');
 updateSave(h,owner,s=>{s.troops=0;s.castles.okazaki.troops=0;s.buildings.wall=1;s.castles.okazaki.level=1;s.tech.discipline=0;s.army=[];});
 const low=checkAdvice(await detail(h,event.id,owner));
 for(const id of ['troops','wall','castle','discipline','army'])assert.equal(low.measures.find(m=>m.id===id).priority,1);
 const before=row(h,owner);assert.deepEqual(checkAdvice(await detail(h,event.id,owner)),low);assert.deepEqual(row(h,owner),before);
 updateSave(h,owner,s=>{s.troops=18000;s.castles.okazaki.troops=4000;s.buildings.wall=32;s.castles.okazaki.level=32;s.tech.discipline=5;s.army=s.officers.slice(0,1);s.officerVariants=[...new Set([...s.officerVariants,...s.army.map(id=>id+':U')])];});
 const improved=checkAdvice(await detail(h,event.id,owner));assert(improved.defensePower>low.defensePower);
 for(const id of ['wall','castle','discipline','army'])assert.equal(improved.measures.find(m=>m.id===id).priority,3);
 assert(improved.measures.find(m=>m.id==='wall').detail.includes('上限'));assert(improved.measures.find(m=>m.id==='castle').detail.includes('上限'));
 const guild=(await write(h,'/guild',owner,{name:'防衛軍議の同盟'})).guild;await write(h,'/guild/join',ally,{guildId:guild.id});
 await write(h,'/alliance/reinforcements/send',ally,{requestId:crypto.randomUUID(),expectedRevision:row(h,ally).revision,deviceId:ally.deviceId,targetPlayerId:owner.user.id,castleId:'okazaki',troops:500,hours:1});
 const supported=checkAdvice(await detail(h,event.id,owner));assert.equal(supported.reinforcementTroops,500);assert.equal(supported.defenseTroops,improved.defenseTroops+500);assert(supported.defensePower>improved.defensePower);
 const unit=h.sql.prepare('SELECT * FROM alliance_units WHERE target_id=?').get(owner.user.id),afterAid=state(h);
 checkAdvice(await detail(h,event.id,owner));assert.deepEqual(state(h),afterAid);
 h.now=unit.expires_at;const expired=checkAdvice(await detail(h,event.id,owner));assert.equal(expired.reinforcementTroops,0);assert.equal(expired.defensePower,improved.defensePower);
});

await scenario('late lord succession prevents the former lord receiving a defense plan and the new lord receives fresh advice',async h=>{
 const op=await fixture(h,'催事担当',{admin:true}),owner=await resident(h,'先代の領主','himeji'),successor=await resident(h,'次代の領主','himeji','retainer');
 const event=await publish(h,op,'castle:himeji');checkAdvice(await detail(h,event.id,owner));
 h.beforeStatement=async sql=>{if(!sql.startsWith('SELECT 1 AS event_defense_current'))return;h.beforeStatement=null;await relocate(h,owner,'inuyama');};
 const stale=await detail(h,event.id,owner);assert.equal(stale.progress.defenseAdviser,null);
 assert.equal((await detail(h,event.id,owner)).progress.defenseAdviser,null);
 const current=checkAdvice(await detail(h,event.id,successor));assert.equal(current.castleId,'himeji');
 await relocate(h,successor,'sunpu');const vacant=await detail(h,event.id,successor);assert.equal(vacant.event.opponent,null);assert.equal(vacant.progress.defenseAdviser,null);
});

await scenario('special castle advice remains private and is withdrawn after a role change or ambiguous defenders',async h=>{
 const op=await fixture(h,'江戸の守備者',{admin:true}),visitor=await resident(h,'来訪する領主','okazaki');
 const edo=await publish(h,op,'castle:edo');checkAdvice(await detail(h,edo.id,op));assert.equal((await detail(h,edo.id,visitor)).progress.defenseAdviser,null);assert.equal((await detail(h,edo.id)).progress,null);
 await write(h,'/admin/events/'+edo.id+'/end',op,{requestId:crypto.randomUUID()});
 const palace=await publish(h,op,'castle:kyoto_gosho'),member=await fixture(h,'御所の守備者',{staff:true});checkAdvice(await detail(h,palace.id,member));
 h.beforeStatement=async sql=>{if(!sql.startsWith('SELECT 1 AS event_defense_current'))return;h.beforeStatement=null;await write(h,'/admin/staff',op,{targetPlayerId:member.user.id,action:'dismiss',requestId:crypto.randomUUID()});};
 const stale=await detail(h,palace.id,member);assert.equal(stale.progress.defenseAdviser,null);
 assert.equal((await detail(h,palace.id,member)).progress.defenseAdviser,null);
 await write(h,'/admin/staff',op,{targetPlayerId:member.user.id,action:'appoint',requestId:crypto.randomUUID()});
 checkAdvice(await detail(h,palace.id,member));
 const second=await fixture(h,'御所のもう一人の守備者',{staff:true});
 for(const p of [member,second]){const result=await detail(h,palace.id,p);assert.equal(result.event.opponent,null);assert.equal(result.progress.defenseAdviser,null);}
});

await scenario('a committed battle keeps its successful receipt when late defensive changes withdraw advice, and its retry cannot spend or award twice',async h=>{
 const op=await fixture(h,'主催者',{admin:true}),owner=await resident(h,'イベント対象の領主','himeji'),event=await publish(h,op,'castle:himeji');
 const before=checkAdvice(await detail(h,event.id,owner));
 const body={requestId:crypto.randomUUID(),stageId:'stage-2',tactic:'raid',deviceId:owner.deviceId,expectedRevision:row(h,owner).revision};
 h.beforeStatement=async sql=>{if(!sql.startsWith('SELECT 1 AS event_defense_current'))return;h.beforeStatement=null;assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM timed_event_requests WHERE actor_id=? AND request_id=?').get(owner.user.id,body.requestId).n,1);updateSave(h,owner,s=>{s.castles.himeji.troops+=100;});};
 const battle=await write(h,'/events/'+event.id+'/battle',owner,body);assert.equal(battle.progress.defenseAdviser,null);
 assert.equal(battle.battle.commandBefore-battle.battle.commandAfter,1);assert.equal(battle.battle.enemyPower,before.defensePower);
 const saved=state(h),replay=await write(h,'/events/'+event.id+'/battle',owner,body),fresh=checkAdvice(replay);assert(fresh.defensePower>before.defensePower);assert(replay.idempotent);assert.deepEqual(replay.battle,battle.battle);assert.deepEqual(state(h),saved);
});

const plan=generateEventPlan({battleId:'castle:himeji',durationDays:1,seed:'defense-pure'}),profile={castleId:'himeji',castleName:'姫路城',defenseTroops:1700,defensePower:2800,reinforcementTroops:100,garrisonTroops:700,fieldTroops:2000,homeContribution:900,wallLevel:2,castleLevel:3,castleMaxLevel:32,disciplineLevel:1,armyCount:1,armyRankPower:1,isHome:true};
const frozen=JSON.stringify({plan,profile}),advice=adviseEventDefense(plan,profile);
assert.deepEqual(advice,adviseEventDefense(plan,profile));assert.equal(JSON.stringify({plan,profile}),frozen);
assert(new Set(advice.stages.map(s=>s.defensePlan)).size>1);
for(const stage of advice.stages){const configured=plan.stages.find(s=>s.id===stage.stageId);assert.equal(configured.tacticMultipliers[stage.attackTactic],Math.max(...Object.values(configured.tacticMultipliers)));}
assert.throws(()=>adviseEventDefense(plan,{...profile,castleId:'okazaki'}));assert.throws(()=>adviseEventDefense(plan,{...profile,armyRankPower:NaN}));
console.log('PASS deterministic defense planning preserves its input and distinguishes stage risks without an invented attacking army');
console.log(JSON.stringify({cases:cases+1,localHttpRequests:calls,productionRequests:0}));
