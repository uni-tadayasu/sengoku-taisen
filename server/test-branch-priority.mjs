import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,row,save,updateSave} from './test-court-support.mjs';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

const ledger=(h,p)=>h.sql.prepare('SELECT * FROM branch_states WHERE actor_id=? AND campaign_id=?').get(p.user.id,save(h,p).state.walking.campaignId);
const receipts=(h,p)=>h.sql.prepare('SELECT * FROM branch_deployment_requests WHERE actor_id=? ORDER BY request_id').all(p.user.id);
const body=(h,p,extra={})=>({requestId:crypto.randomUUID(),deviceId:p.deviceId,expectedRevision:row(h,p).revision,campaignId:save(h,p).state.walking.campaignId,sequence:ledger(h,p)?.sequence||0,branchId:'all',...extra});
const stable=(h,p)=>structuredClone({save:row(h,p),ledger:ledger(h,p),receipts:receipts(h,p)});
async function seeded(h,name,{admin=false}={}){
 const p=await fixture(h,name,{admin,holdings:['nijo']}),branches=['nijo',...(admin?['edo']:[])].map(parent=>({id:parent+'_north',parentCastleId:parent,direction:'north',level:1,fallen:false}));
 updateSave(h,p,s=>{s.branches=structuredClone(branches);s.governors={farm:s.officers[1],keep:s.officers[2],...(admin?{market:s.officers[3]}:{})};s.army=s.officers.filter(id=>!Object.values(s.governors).includes(id));s.command=0;});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches,jobs:[]}),save(h,p).state.worldClock.elapsedMs,h.now);
 return p;
}
async function seededFull(h,name,{admin=false}={}){
 const p=await fixture(h,name,{admin,holdings:['nijo','osaka']}),game=GameEngine.fromSave(save(h,p),GAME_OFFICERS,{isAdmin:admin}),parents=['nijo','osaka',...(admin?['edo']:[])],capacity=admin?5:4;
 const ids=game.roster.filter(officer=>game.canOwnOfficerVariant(officer.id,'A')).slice(0,capacity+3).map(officer=>officer.id);
 game.state.officers=[];game.state.officerVariants=[];delete game.state.officerHealth;
 for(const id of ids)game._grantOfficerVariant(id,'A');
 const main=ids.at(-1),ranked=game.officerViews(ids.filter(id=>id!==main)).sort((a,b)=>b.lead-a.lead||b.intellect-a.intellect||b.valor-a.valor||(a.id<b.id?-1:1)),strong=ranked.slice(0,2).map(officer=>officer.id),posted=ranked.slice(2).reverse().map(officer=>officer.id);
 const branches=parents.map(parent=>({id:parent+'_north',parentCastleId:parent,direction:'north',level:2,fallen:false,commanders:posted.splice(0,parent==='edo'?1:2)}));
 updateSave(h,p,s=>{s.officers=structuredClone(game.state.officers);s.officerVariants=structuredClone(game.state.officerVariants);s.officerHealth=structuredClone(game.state.officerHealth);s.stats.recruited=game.state.stats.recruited;s.branches=structuredClone(branches);s.jobs=[];s.army=[main];s.governors={farm:strong[0],keep:strong[1]};s.command=0;});
 h.sql.prepare('INSERT INTO branch_states(actor_id,campaign_id,sequence,state_json,resolved_elapsed_ms,updated_at) VALUES(?,?,1,?,?,?)').run(p.user.id,save(h,p).state.walking.campaignId,JSON.stringify({branches,jobs:[]}),save(h,p).state.worldClock.elapsedMs,h.now);
 const canonical=GameEngine.fromSave(save(h,p),GAME_OFFICERS,{isAdmin:admin}),available=canonical.officerViews(canonical.state.officers.filter(id=>!canonical.state.army.includes(id))).sort((a,b)=>b.lead-a.lead||b.intellect-a.intellect||b.valor-a.valor||(a.id<b.id?-1:1));return{p,strong,ranked:available.map(officer=>officer.id),capacity};
}
const roles=s=>[...s.army,...s.branches.flatMap(branch=>branch.commanders||[]),...Object.values(s.governors)];
let checks=0,calls=0;
async function scope(name,run){const h=harness();try{await run(h);checks++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
const network=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Priority checks must stay local');};
try{
 await scope('one authoritative command transfers governors into branch vacancies and leaves the main army intact',async h=>{
  const p=await seeded(h,'優先配置'),before=save(h,p),request=body(h,p),r=(await h.api('/branches/auto-assign-officers',post(p,request))).data,s=r.save.state;
  assert.equal(r.result.branchAssignedCount,2);assert.equal(r.result.branchAssignments.length,2);assert(r.result.assignments.length>0);assert.equal(r.result.assignedCount,0);assert(r.result.changed);
  assert.deepEqual(s.army,before.state.army);assert.deepEqual(new Set(s.branches[0].commanders),new Set(Object.values(before.state.governors)));assert.deepEqual(s.governors,{});assert.deepEqual(s.resources,before.state.resources);assert.equal(s.command,0);
  assert.deepEqual(JSON.parse(ledger(h,p).state_json).branches[0].commanders,s.branches[0].commanders);assert.equal(receipts(h,p).length,1);
  const committed=stable(h,p),retry=(await h.api('/branches/auto-assign-officers',post(p,{...request,expectedRevision:0,deviceId:'reader'}))).data;assert(retry.idempotent);assert.deepEqual(retry.result,r.result);assert.deepEqual(stable(h,p),committed);
  const old=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:before}})).data;
  assert.deepEqual(old.save.state.branches[0].commanders,s.branches[0].commanders);assert.deepEqual(old.save.state.governors,{});assert.deepEqual(old.save.state.army,before.state.army);
 });
 await scope('manual and branch-only automatic assignments remove only the transferred facility posts',async h=>{
  for(const mode of ['assign-commander','auto-assign-commanders']){
   const p=await seeded(h,mode==='assign-commander'?'個別優先手動':'個別優先自動'),before=save(h,p),officer=before.state.governors.farm;
   const r=(await h.api('/branches/'+mode,post(p,body(h,p,{branchId:'nijo_north',...(mode==='assign-commander'?{officerId:officer}:{})})))).data;
   assert.deepEqual(r.save.state.army,before.state.army);
   for(const id of r.save.state.branches[0].commanders)assert(!Object.values(r.save.state.governors).includes(id));
   if(mode==='assign-commander'){assert.equal(r.save.state.governors.farm,undefined);assert.equal(r.save.state.governors.keep,before.state.governors.keep);}else assert.deepEqual(r.save.state.governors,{});
  }
 });
 await scope('the compound command fills exactly one Edo commander and two commanders for another major city',async h=>{
  const p=await seeded(h,'江戸と大都市の定員',{admin:true}),before=save(h,p),r=(await h.api('/branches/auto-assign-officers',post(p,body(h,p)))).data;
  assert.equal(r.result.branchAssignedCount,3);assert.equal(r.save.state.branches.find(branch=>branch.parentCastleId==='edo').commanders.length,1);assert.equal(r.save.state.branches.find(branch=>branch.parentCastleId==='nijo').commanders.length,2);assert.deepEqual(r.save.state.army,before.state.army);assert.deepEqual(r.save.state.governors,{});
 });
 await scope('a full selected branch replaces weaker commanders with governors while preserving other branch posts',async h=>{
  const {p,strong}=await seededFull(h,'満員支拠点の入替'),before=save(h,p),request=body(h,p,{branchId:'nijo_north'}),r=(await h.api('/branches/auto-assign-commanders',post(p,request))).data,s=r.save.state;
  assert.equal(r.result.replacedCount,2);assert.equal(r.result.changedCount,2);assert.equal(r.result.changed,true);assert.deepEqual(new Set(s.branches.find(branch=>branch.id==='nijo_north').commanders),new Set(strong));
  assert.deepEqual(s.branches.find(branch=>branch.id==='osaka_north'),before.state.branches.find(branch=>branch.id==='osaka_north'));assert.deepEqual(s.army,before.state.army);assert.deepEqual(s.governors,{});assert.deepEqual(s.resources,before.state.resources);assert.equal(s.command,0);assert.equal(new Set(roles(s)).size,roles(s).length);
  const displaced=before.state.branches.find(branch=>branch.id==='nijo_north').commanders;assert(displaced.every(id=>s.officers.includes(id)&&!roles(s).includes(id)));
  assert.deepEqual(JSON.parse(ledger(h,p).state_json).branches,s.branches.slice().sort((a,b)=>a.id.localeCompare(b.id)));
  const old=(await h.api('/sync',{method:'PUT',token:p.token,body:{deviceId:p.deviceId,revision:row(h,p).revision,save:before}})).data.save.state;
  assert.deepEqual(new Set(old.branches.find(branch=>branch.id==='nijo_north').commanders),new Set(strong));assert.deepEqual(old.governors,{});
 });
 await scope('full global replacement respects Edo one and other cities two, then assigns displaced officers as governors',async h=>{
  const {p,ranked,capacity}=await seededFull(h,'全支拠点の満員入替',{admin:true}),before=save(h,p),r=(await h.api('/branches/auto-assign-officers',post(p,body(h,p)))).data,s=r.save.state;
  assert(r.result.branchAssignedCount>0);assert(r.result.branchReplacedCount>0);assert.deepEqual(new Set(s.branches.flatMap(branch=>branch.commanders)),new Set(ranked.slice(0,capacity)));assert.deepEqual(new Set(Object.values(s.governors)),new Set(ranked.slice(capacity)));assert.deepEqual(s.army,before.state.army);
  for(const branch of s.branches)assert.equal(branch.commanders.length,branch.parentCastleId==='edo'?1:2);
  assert.equal(new Set(roles(s)).size,roles(s).length);assert.deepEqual(s.resources,before.state.resources);assert.equal(s.command,0);assert.doesNotThrow(()=>GameEngine.fromSave(r.save,GAME_OFFICERS,{isAdmin:true}));
  const sequence=ledger(h,p).sequence,again=(await h.api('/branches/auto-assign-officers',post(p,body(h,p)))).data;
  assert.equal(again.result.changed,false);assert.equal(again.result.branchAssignedCount,0);assert.equal(ledger(h,p).sequence,sequence);assert.deepEqual(again.save.state.branches,s.branches);assert.deepEqual(again.save.state.governors,s.governors);
 });
 await scope('a lost full-branch replacement response replays one immutable receipt without repeating swaps',async h=>{
  const {p,strong}=await seededFull(h,'満員入替の再送'),request=body(h,p,{branchId:'nijo_north'});
  h.afterBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.afterBatch=null;throw Error('Local replacement response lost');};
  await h.api('/branches/auto-assign-commanders',post(p,request,500));const committed=stable(h,p),result=JSON.parse(receipts(h,p)[0].result_json);assert.equal(result.replacedCount,2);assert.equal(receipts(h,p).length,1);
  const retry=(await h.api('/branches/auto-assign-commanders',post(p,{...request,deviceId:'reader',expectedRevision:0}))).data;assert(retry.idempotent);assert.deepEqual(retry.result,result);assert.deepEqual(stable(h,p),committed);assert.deepEqual(new Set(retry.save.state.branches.find(branch=>branch.id==='nijo_north').commanders),new Set(strong));
  await h.api('/branches/auto-assign-commanders',post(p,{...request,branchId:'all'},409));assert.deepEqual(stable(h,p),committed);
 });
 await scope('a failed full-branch replacement rolls back old commanders and transferred governors together',async h=>{
  const {p}=await seededFull(h,'満員入替の一括復元'),before=stable(h,p);
  h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_replacement_table SET value=1'));};
  await h.api('/branches/auto-assign-officers',post(p,body(h,p),500));assert.deepEqual(stable(h,p),before);assert.equal(receipts(h,p).length,0);
 });
 await scope('invalid scope and a concurrent branch transition leave governors, commanders and receipts atomic',async h=>{
  const p=await seeded(h,'優先配置競合'),before=stable(h,p);
  await h.api('/branches/auto-assign-officers',post(p,body(h,p,{branchId:'nijo_north'}),400));assert.deepEqual(stable(h,p),before);
  const request=body(h,p);let concurrent;
  h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;h.sql.prepare('UPDATE branch_states SET sequence=sequence+1 WHERE actor_id=?').run(p.user.id);concurrent=stable(h,p);};
  await h.api('/branches/auto-assign-officers',post(p,request,409));assert(concurrent);assert.deepEqual(stable(h,p),concurrent);assert.equal(receipts(h,p).length,0);
  h.beforeBatch=statements=>{if(!statements[0]?.sql.includes('INSERT INTO branch_deployment_requests'))return;h.beforeBatch=null;statements.push(h.db.prepare('UPDATE missing_priority_table SET value=1'));};
  await h.api('/branches/auto-assign-officers',post(p,body(h,p),500));assert.deepEqual(stable(h,p),concurrent);
 });
 console.log(checks+' priority integration groups passed across '+calls+' local Worker calls.');
}finally{globalThis.fetch=network;}
