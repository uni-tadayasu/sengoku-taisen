import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,updateSave} from './test-court-support.mjs';

const detail=(h,id,p)=>h.api('/events/'+id,{token:p?.token}).then(r=>r.data);
const write=(h,path,p,b,expected=200)=>h.api(path,post(p,b,expected)).then(r=>r.data);
async function publish(h,op,battleId){
 const draft=await write(h,'/admin/events/generate',op,{battleId,durationDays:1,requestId:crypto.randomUUID()});
 return(await write(h,'/admin/events/'+draft.event.id+'/publish',op,{requestId:crypto.randomUUID()})).event;
}
const sortie=(h,p,id,requestId=crypto.randomUUID(),expected=200)=>write(h,'/events/'+id+'/battle',p,{requestId,stageId:'stage-1',tactic:'balanced',deviceId:p.deviceId,expectedRevision:row(h,p).revision},expected);
const field=async(h,p,owner,id)=>(await h.api('/field',{token:p.token})).data.targets.find(t=>t.playerId===owner.user.id&&t.targetCastleId===id);
function atCommit(h,fn){h.beforeBatch=async statements=>{if(!statements[0]?.sql.includes("INSERT INTO timed_event_requests")||!statements[0].sql.includes("'battle'"))return;h.beforeBatch=null;await fn();};}
const plain=o=>assert.deepEqual(Object.keys(o).sort(),['castleId','castleName','defensePower','defenseTroops','lordName','castleOwnerId','castleAppearance'].sort());
let cases=0,requests=0,maxBindings=0;
async function scenario(label,run){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100);}return batch(statements);};
 try{await run(h);cases++;console.log('PASS '+label);}finally{requests+=h.calls;h.close();}
}

await scenario('a contested metropolitan city changes between NPC and its sole real defender and commit races do not spend commands',async h=>{
 const op=await fixture(h,'開催奉行',{admin:true}),a=await fixture(h,'実戦参加者',{startCastle:'inuyama'}),owner=await fixture(h,'二条守備者',{startCastle:'okazaki'}),rival=await fixture(h,'二条領有者',{startCastle:'himeji'});
 const owned=(p,yes)=>updateSave(h,p,s=>{s.castles.nijo.owner=yes?s.clan:'在地衆';s.castles.nijo.troops=8000;s.castles.nijo.wall=7;});
 for(const p of [op,a,owner,rival])owned(p,false);
 const event=await publish(h,op,'castle:nijo'),id=event.id;
 assert.equal(event.opponent,null);assert.equal((await detail(h,id)).event.opponent,null);
 const initial=row(h,a);atCommit(h,()=>owned(owner,true));const req=crypto.randomUUID();
 assert.equal((await sortie(h,a,id,req,409)).error.code,'EVENT_STATE_CHANGED');assert.deepEqual(row(h,a),initial);
 const occupied=await detail(h,id,a),target=await field(h,a,owner,'nijo');
 plain(occupied.event.opponent);assert.equal(occupied.event.opponent.lordName,owner.user.name);
 assert.equal(occupied.event.opponent.defensePower,target.defensePower);assert.equal(occupied.event.opponent.defenseTroops,target.defenseTroops);
 const frozen=await sortie(h,a,id,req);assert.deepEqual(frozen.battle.opponent,occupied.event.opponent);
 assert.equal(frozen.battle.enemyPower,target.defensePower);
 const before=row(h,a),other=crypto.randomUUID();atCommit(h,()=>owned(rival,true));
 assert.equal((await sortie(h,a,id,other,409)).error.code,'EVENT_STATE_CHANGED');assert.deepEqual(row(h,a),before);
 const uncertain=await detail(h,id,a);assert.equal(uncertain.event.opponent,null);
 const npc=await sortie(h,a,id,other);assert.equal(npc.battle.opponent,null);assert.equal(npc.battle.enemyPower,event.plan.stages[0].enemyPower);
 const replay=await sortie(h,a,id,req);assert(replay.idempotent);assert.deepEqual(replay.battle,frozen.battle);assert.equal(replay.event.opponent,null);
});

await scenario('a metropolitan defender role change before save synchronization rejects stale home and outpost forecasts without spending a command',async h=>{
 const op=await fixture(h,'合戦開催者',{admin:true}),a=await fixture(h,'合戦参加者',{startCastle:'inuyama'}),owner=await fixture(h,'二条の守備者',{startCastle:'okazaki'});
 for(const p of [op,a])updateSave(h,p,s=>{s.castles.nijo.owner='在地衆';});
 // Earlier campaigns may retain a metropolitan home even though new players
 // now start in an ordinary castle. Role changes precede their next sync.
 updateSave(h,owner,s=>{s.home='nijo';s.cycle.home='nijo';s.castles.nijo.owner=s.clan;s.castles.nijo.troops=8000;s.castles.nijo.wall=1;s.buildings.wall=10;});
 const id=(await publish(h,op,'castle:nijo')).id,home=(await detail(h,id,a)).event.opponent,ownerRevision=row(h,owner).revision;
 plain(home);assert(home.defensePower>0);
 const initial=row(h,a),first=crypto.randomUUID();
 atCommit(h,()=>write(h,'/admin/staff',op,{targetPlayerId:owner.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 assert.equal((await sortie(h,a,id,first,409)).error.code,'EVENT_STATE_CHANGED');assert.deepEqual(row(h,a),initial);
 assert.equal(row(h,owner).revision,ownerRevision,'appointment has not synchronized the defender save');
 assert.equal(h.sql.prepare('SELECT COUNT(*) AS n FROM timed_event_requests WHERE actor_id=? AND request_id=?').get(a.user.id,first).n,0);
 const outpost=(await detail(h,id,a)).event.opponent;plain(outpost);
 assert(outpost.defenseTroops<home.defenseTroops);assert(outpost.defensePower<home.defensePower);
 const frozen=await sortie(h,a,id,first);assert.deepEqual(frozen.battle.opponent,outpost);
 const beforeDismissal=row(h,a),second=crypto.randomUUID();
 atCommit(h,()=>write(h,'/admin/staff',op,{targetPlayerId:owner.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
 assert.equal((await sortie(h,a,id,second,409)).error.code,'EVENT_STATE_CHANGED');assert.deepEqual(row(h,a),beforeDismissal);
 assert.equal(row(h,owner).revision,ownerRevision,'dismissal has not synchronized the defender save');
 assert.deepEqual((await detail(h,id,a)).event.opponent,home);
 assert.deepEqual((await sortie(h,a,id,second)).battle.opponent,home);
 const replay=await sortie(h,a,id,first);assert(replay.idempotent);assert.deepEqual(replay.battle,frozen.battle);assert.deepEqual(replay.event.opponent,home);
});

await scenario('authorized stationed reinforcements contribute only while present and a changing defense cannot charge a stale forecast',async h=>{
 const op=await fixture(h,'合戦開催者',{admin:true}),a=await fixture(h,'陣形を試す領主',{startCastle:'inuyama'}),owner=await fixture(h,'城を守る領主',{startCastle:'okazaki'}),helper=await fixture(h,'援軍を派遣する領主',{startCastle:'himeji'});
 const castleId='okazaki',id=(await publish(h,op,'castle:'+castleId)).id;
 const guild=(await write(h,'/guild',owner,{name:'城の援軍'})).guild;
 await write(h,'/guild/join',helper,{guildId:guild.id});
 const start=(await detail(h,id)).event.opponent;assert(start);const old=row(h,a);
 const b={requestId:crypto.randomUUID(),expectedRevision:row(h,helper).revision,deviceId:helper.deviceId,targetPlayerId:owner.user.id,castleId,troops:500,hours:1};
 atCommit(h,()=>write(h,'/alliance/reinforcements/send',helper,b));
 const key=crypto.randomUUID();assert.equal((await sortie(h,a,id,key,409)).error.code,'EVENT_STATE_CHANGED');assert.deepEqual(row(h,a),old);
 const active=(await detail(h,id,a)).event.opponent,target=await field(h,a,owner,castleId);
 assert.equal(active.defenseTroops,start.defenseTroops+500);assert.equal(active.defensePower,target.defensePower);
 const guard=row(h,owner),escrow=h.sql.prepare('SELECT * FROM alliance_units WHERE target_id=?').get(owner.user.id);
 assert.deepEqual((await sortie(h,a,id,key)).battle.opponent,active);assert.deepEqual(row(h,owner),guard);
 assert.deepEqual(h.sql.prepare('SELECT * FROM alliance_units WHERE target_id=?').get(owner.user.id),escrow);
 h.now=escrow.expires_at;assert.deepEqual((await detail(h,id)).event.opponent,start);
});

await scenario('fixed castles resolve only a single eligible defender and expose no account roles or protected fields',async h=>{
 const op=await fixture(h,'江戸の守備者',{admin:true}),a=await fixture(h,'城の来訪者',{startCastle:'okazaki'});
 const edo=await publish(h,op,'castle:edo'),e=(await detail(h,edo.id)).event.opponent;
 plain(e);assert.equal(e.lordName,op.user.name);assert.equal(e.defensePower,(await field(h,a,op,'edo')).defensePower);
 await write(h,'/admin/events/'+edo.id+'/end',op,{requestId:crypto.randomUUID()});
 const palace=await publish(h,op,'castle:kyoto_gosho');assert.equal(palace.opponent,null);
 const member=await fixture(h,'御所の守備者',{staff:true});
 const current=(await detail(h,palace.id)).event.opponent;plain(current);assert.equal(current.lordName,member.user.name);assert.equal(current.defensePower,(await field(h,a,member,'kyoto_gosho')).defensePower);
 const other=await fixture(h,'御所の増員',{staff:true});assert.equal((await detail(h,palace.id)).event.opponent,null);
 await write(h,'/admin/staff',op,{targetPlayerId:other.user.id,action:'dismiss',requestId:crypto.randomUUID()});
 assert.equal((await detail(h,palace.id)).event.opponent.lordName,member.user.name);
});
console.log(JSON.stringify({cases,localHttpRequests:requests,maxBindings}));
