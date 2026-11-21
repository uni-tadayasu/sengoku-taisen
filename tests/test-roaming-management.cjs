'use strict';
// Private-management state machine fixtures. No production account or network is used.
const assert=require('node:assert/strict');
const {createController,cleanDeployment,cleanProposal,confirmationMarkup,proposalMarkup}=require('../roaming-management.js');
const clone=value=>JSON.parse(JSON.stringify(value)),tests=[],test=(name,run)=>tests.push([name,run]);
const ADMIN={id:'lord-admin',name:'本人',isAdmin:true,isStaff:false},STAFF={id:'lord-staff',name:'担当者',isAdmin:false,isStaff:true};
const deployment=extra=>({revision:1,totalTroops:384000,squadSize:1000,respawnSeconds:300,totalSquads:384,...extra});
const context=user=>({user:clone(user),epoch:1,privilegeEpoch:1,accountEpoch:1,connected:true,pending:false,banned:false});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const error=(status,code='REJECTED')=>Object.assign(Error(code),{status,code});
function proposal(extra={}){return{id:'rdp_'+'1'.repeat(32),status:'pending',expectedRevision:1,config:{totalTroops:500000,squadSize:1000,respawnSeconds:120},requestedAt:'2026-11-22T00:00:00Z',note:'増員',requester:clone(STAFF),reviewedAt:null,appliedRevision:null,canApprove:true,canCancel:false,...extra};}
function setup({user=ADMIN,rows=[],storage,timeoutMs}={}){
 let ctx=context(user),current=deployment(),proposals=clone(rows),hook=null,ids=0,commits=0,readCount=0;
 const calls=[],changes=[],receipts=new Map(),stored=new Map(),memory=storage||{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 const dto=()=>({ok:true,deployment:clone(current),capabilities:{canApply:ctx.user?.isAdmin===true,canApprove:ctx.user?.isAdmin===true,canPropose:ctx.user?.isStaff===true&&!ctx.user?.isAdmin},proposals:proposals.filter(p=>ctx.user?.isAdmin||p.requester.id===ctx.user?.id).map(p=>({...clone(p),canApprove:p.status==='pending'&&p.expectedRevision===current.revision,canCancel:p.status==='pending'&&p.requester.id===ctx.user?.id})),serverNow:'2026-11-22T01:00:00Z'});
 function execute(route,settings){
  if(settings.method==='GET'){readCount++;return dto();}
  const b=settings.data,prior=receipts.get(b.requestId);if(prior)return{...dto(),...clone(prior),idempotent:true};
  if(b.expectedRevision!==current.revision)throw error(409,'ROAMING_DEPLOYMENT_CHANGED');
  let action,affected=null;
  if(route==='/admin/roaming/deployment')action='apply';
  else if(route==='/staff/roaming/proposals')action='propose';
  else {action=route.split('/').at(-1);affected=proposals.find(p=>route.includes('/'+p.id+'/'));if(!affected||affected.status!=='pending')throw error(409,'ROAMING_PROPOSAL_CHANGED');}
  if(['apply','approve','reject'].includes(action)&&!ctx.user.isAdmin)throw error(403);
  if(action==='propose'&&!ctx.user.isStaff)throw error(403);
  if(action==='propose'){affected=proposal({id:'rdp_'+String(++ids).padStart(32,'0'),expectedRevision:b.expectedRevision,config:Object.fromEntries(['totalTroops','squadSize','respawnSeconds'].map(k=>[k,b[k]])),note:b.note,requester:clone(ctx.user)});proposals.unshift(affected);}
  if(action==='apply'||action==='approve'){
   const c=action==='apply'?b:affected.config;current={revision:current.revision+1,...Object.fromEntries(['totalTroops','squadSize','respawnSeconds'].map(k=>[k,c[k]])),totalSquads:Math.ceil(c.totalTroops/c.squadSize)};
   if(affected){affected.status='approved';affected.appliedRevision=current.revision;}
   proposals.forEach(p=>{if(p.status==='pending')p.status='superseded';});commits++;
  }
  if(action==='reject'||action==='cancel')affected.status=action==='reject'?'rejected':'cancelled';
  const result={receipt:{action,requestId:b.requestId,proposalId:affected?.id||null,appliedRevision:['apply','approve'].includes(action)?current.revision:null},proposal:affected?clone(affected):null,idempotent:false};receipts.set(b.requestId,result);return{...dto(),...result};
 }
 const request=async(route,settings)=>{calls.push({route,settings:clone(settings)});return hook?hook(route,settings):execute(route,settings);};
 const options={getContext:()=>ctx,request,storage:memory,uuid:()=>`request-${++ids}`,onDeploymentChanged:value=>changes.push(value),...(timeoutMs?{timeoutMs}:{})};
 const controller=createController(options);
 return{controller,options,calls,changes,stored,execute,dto,get context(){return ctx;},set context(v){ctx=v;},get deployment(){return current;},set deployment(v){current=v;},get rows(){return proposals;},set rows(v){proposals=v;},get hook(){return hook;},set hook(v){hook=v;},get commits(){return commits;},get reads(){return readCount;}};
}

test('ordinary, unready, banned and disconnected users expose no management state or network reads',async()=>{
 for(const extra of [{user:{id:'ordinary'}},{pending:true},{banned:true},{connected:false},{user:{...ADMIN,isBanned:true}}]){
  const h=setup();h.context={...h.context,...extra};h.controller.refresh();assert.equal(h.controller.snapshot().authorized,false);assert.equal(await h.controller.open(),false);assert.equal(h.calls.length,0);assert.equal(h.controller.snapshot().deployment,null);
 }
});
test('opening loads once; routine refresh and close/reopen keep form and avoid background flicker work',async()=>{
 const h=setup();assert.equal(h.calls.length,0);await h.controller.open();assert.equal(h.reads,1);h.controller.update('totalTroops','450123');
 for(let i=0;i<40;i++)h.controller.refresh();assert.equal(h.reads,1);assert.equal(h.controller.snapshot().form.totalTroops,'450123');h.controller.close();await h.controller.open();assert.equal(h.reads,1);assert.equal(h.controller.snapshot().form.totalTroops,'450123');
});
test('admin applies only after explicit review and notifies the public map',async()=>{
 const h=setup();await h.controller.open();h.controller.update('totalTroops','500001');assert(h.controller.prepare('apply'));assert.equal(h.commits,0);assert.equal(h.calls.length,1);
 assert.match(confirmationMarkup(h.controller.snapshot().confirmation),/500,001/);assert(await h.controller.submit());assert.equal(h.commits,1);assert.equal(h.deployment.totalTroops,500001);assert.equal(h.deployment.totalSquads,501);assert.equal(h.changes.length,1);assert.equal(h.stored.size,0);assert.equal(h.controller.snapshot().pending,null);
});
test('staff submission preserves live deployment and records immutable reviewed values',async()=>{
 const h=setup({user:STAFF});await h.controller.open();assert.equal(h.controller.prepare('apply'),false);h.controller.update('totalTroops','640000');h.controller.update('note','近隣の戦闘数を増やす');assert(h.controller.prepare('propose'));
 assert.equal(h.controller.update('totalTroops','999000'),false);assert(await h.controller.submit());assert.equal(h.commits,0);assert.equal(h.deployment.revision,1);assert.equal(h.rows[0].config.totalTroops,640000);assert.equal(h.rows[0].status,'pending');assert.equal(h.changes.length,0);assert.match(h.controller.snapshot().message,/承認するまで/);
});
test('admin sees exact proposal diff and approves it rather than edited form values',async()=>{
 const h=setup({rows:[proposal()]});await h.controller.open();h.controller.update('totalTroops','999999');assert(h.controller.prepare('approve',h.rows[0].id));const record=h.controller.snapshot().confirmation;assert.equal(record.proposal.config.totalTroops,500000);assert.match(confirmationMarkup(record),/500,000/);assert(await h.controller.submit());assert.equal(h.deployment.totalTroops,500000);assert.equal(h.rows[0].status,'approved');assert.equal(h.commits,1);
});
test('staff cannot approve or reject and can only cancel a cancellable own proposal',async()=>{
 const h=setup({user:STAFF,rows:[proposal()]});await h.controller.open();const p=h.controller.snapshot().proposals[0];assert.equal(h.controller.prepare('approve',p.id),false);assert.equal(h.controller.prepare('reject',p.id),false);assert(h.controller.prepare('cancel',p.id));assert(await h.controller.submit());assert.equal(h.rows[0].status,'cancelled');assert.equal(h.commits,0);
});
test('stale, resolved and missing proposals never create approval writes',async()=>{
 for(const p of [proposal({expectedRevision:0}),proposal({expectedRevision:2}),proposal({status:'approved'})]){
  const h=setup({rows:[p]});await h.controller.open();assert.equal(h.controller.prepare('approve',p.id),false);assert.equal(h.calls.filter(c=>c.settings.method==='POST').length,0);
 }
 const h=setup();await h.controller.open();assert.equal(h.controller.prepare('approve','rdp_'+'2'.repeat(32)),false);
});
test('invalid limits, decimals, empty inputs and excessive squad counts are blocked locally',async()=>{
 for(const [field,value]of [['totalTroops',''],['totalTroops','-1'],['totalTroops','20000001'],['totalTroops','0.5'],['squadSize','299'],['squadSize','20001'],['respawnSeconds','59'],['respawnSeconds','3601'],['totalTroops','20000000']]){
  const h=setup();await h.controller.open();h.controller.update(field,value);assert.equal(h.controller.prepare('apply'),false,field+':'+value);assert.equal(h.calls.length,1);
 }
});
test('zero placement is allowed with explicit outcome in the review',async()=>{
 const h=setup();await h.controller.open();h.controller.update('totalTroops','0');assert(h.controller.prepare('apply'));assert.match(confirmationMarkup(h.controller.snapshot().confirmation),/野良兵戦の相手がいなく/);assert(await h.controller.submit());assert.equal(h.deployment.totalSquads,0);
});
test('manual refresh preserves unsent draft, adopts the new baseline, and clears previous review',async()=>{
 const h=setup();await h.controller.open();h.controller.update('totalTroops','654321');h.controller.update('note','下書き');assert(h.controller.prepare('apply'));h.deployment=deployment({revision:2,totalTroops:512000,totalSquads:512});await h.controller.reload();const s=h.controller.snapshot();assert.equal(s.confirmation,null);assert.equal(s.form.totalTroops,'654321');assert.equal(s.form.note,'下書き');assert.equal(s.deployment.revision,2);assert.equal(h.changes.length,1);assert(h.controller.prepare('apply'));assert.equal(h.controller.snapshot().confirmation.body.expectedRevision,2);
});
test('double submit shares one request and only applies once',async()=>{
 const h=setup(),wait=deferred();await h.controller.open();h.hook=async(route,settings)=>{await wait.promise;return h.execute(route,settings);};assert(h.controller.prepare('apply'));const a=h.controller.submit(),b=h.controller.submit();assert.strictEqual(a,b);await drain();assert.equal(h.calls.filter(c=>c.settings.method==='POST').length,1);wait.resolve();assert(await a);assert.equal(h.commits,1);
});
test('lost response persists original request across reopen and replays without another deployment',async()=>{
 const h=setup();await h.controller.open();h.hook=async(route,settings)=>{h.execute(route,settings);throw Error('response lost');};assert(h.controller.prepare('apply'));assert.equal(await h.controller.submit(),false);assert.equal(h.commits,1);const original=h.controller.snapshot().pending.body;
 h.controller.dispose();h.hook=null;const reopened=createController(h.options);await reopened.open();assert.deepEqual(reopened.snapshot().pending.body,original);assert(await reopened.submit());assert.equal(h.commits,1);assert.equal(h.stored.size,0);assert.match(reopened.snapshot().message,/記録済み/);
});
test('uncertain authorization, timeout, rate limit and server failures retain exact retry body',async()=>{
 for(const status of [401,403,408,429,500]){
  const h=setup();await h.controller.open();h.hook=async()=>{throw error(status);};assert(h.controller.prepare('apply'));const original=h.controller.snapshot().confirmation.body;assert.equal(await h.controller.submit(),false);assert.deepEqual(h.controller.snapshot().pending.body,original);assert.equal(h.stored.size,1);
 }
});
test('definite revision rejection releases pending intent and requires a fresh load',async()=>{
 const h=setup();await h.controller.open();h.hook=async()=>{throw error(409,'ROAMING_DEPLOYMENT_CHANGED');};assert(h.controller.prepare('apply'));assert.equal(await h.controller.submit(),false);assert.equal(h.controller.snapshot().pending,null);assert.equal(h.controller.snapshot().loaded,false);assert.equal(h.stored.size,0);assert.equal(h.controller.prepare('apply'),false);h.hook=null;assert(await h.controller.reload());assert(h.controller.prepare('apply'));
});
test('malformed or mismatched success receipts cannot clear an uncertain request',async()=>{
 for(const mismatch of ['requestId','action','proposalId','missingDTO']){
  const h=setup();await h.controller.open();h.hook=async(route,settings)=>{const r=h.execute(route,settings);if(mismatch==='missingDTO')delete r.deployment;else r.receipt[mismatch]='wrong';return r;};assert(h.controller.prepare('apply'));assert.equal(await h.controller.submit(),false);assert(h.controller.snapshot().pending);assert.equal(h.stored.size,1);
 }
});
test('role revocation during pending read purges private information before late response',async()=>{
 const h=setup({rows:[proposal()]}),wait=deferred(),response=h.dto();h.hook=()=>wait.promise;const read=h.controller.open();await drain();h.context={...h.context,user:{id:'ordinary'},privilegeEpoch:2};h.controller.refresh();assert.equal(h.controller.snapshot().authorized,false);wait.resolve(response);await read;assert.equal(h.controller.snapshot().deployment,null);assert.deepEqual(h.controller.snapshot().proposals,[]);
});
test('identity or privilege changes during write cannot display another actor private result',async()=>{
 for(const change of ['identity','privilege','banned','dispose']){
  const h=setup(),wait=deferred();await h.controller.open();h.hook=async(route,settings)=>{const r=h.execute(route,settings);await wait.promise;return r;};assert(h.controller.prepare('apply'));const write=h.controller.submit();await drain();
  if(change==='identity')h.context={...context({...ADMIN,id:'different-owner'}),epoch:2};else if(change==='privilege')h.context={...h.context,user:{...STAFF,id:ADMIN.id},privilegeEpoch:2};else if(change==='banned')h.context={...h.context,banned:true,accountEpoch:2};
  if(change==='dispose')h.controller.dispose();else h.controller.refresh();wait.resolve();assert.equal(await write,false);assert.equal(h.changes.length,0);assert.equal(h.controller.snapshot().deployment,null);assert.equal(h.controller.snapshot().message,'');
 }
});
test('staff management response containing another requester is rejected rather than rendered',async()=>{
 const h=setup({user:STAFF});h.hook=async()=>({...h.dto(),proposals:[proposal({requester:{id:'other-staff',name:'非公開の申請者'}})]});await h.controller.open();assert.equal(h.controller.snapshot().loaded,false);assert.deepEqual(h.controller.snapshot().proposals,[]);
});
test('storage failure stops a new mutation before it leaves the controller',async()=>{
 const h=setup({storage:{getItem:()=>null,setItem(){throw Error('保存不可');},removeItem(){}}});await h.controller.open();assert(h.controller.prepare('apply'));assert.equal(await h.controller.submit(),false);assert.equal(h.calls.length,1);assert.equal(h.commits,0);
});
test('a bounded timeout unlocks retry without replacing the submitted intent',async()=>{
 const h=setup({timeoutMs:8});await h.controller.open();h.hook=()=>new Promise(()=>{});assert(h.controller.prepare('apply'));assert.equal(await h.controller.submit(),false);assert.equal(h.controller.snapshot().sending,false);assert(h.controller.snapshot().pending);assert.match(h.controller.snapshot().error,/通信結果/);
});
test('pagination and escaped player strings keep large private histories readable and safe',async()=>{
 const rows=Array.from({length:14},(_,i)=>proposal({id:'rdp_'+(i+1).toString(16).padStart(32,'0'),status:i===0?'pending':'rejected',note:'<img src=x onerror=bad()>',requester:{...STAFF,name:'<script>bad</script>'}}));
 const h=setup({rows});await h.controller.open();assert(h.controller.page(3));assert.equal(h.controller.snapshot().page,3);assert(h.controller.page(10));assert.equal(h.controller.snapshot().page,3);assert(h.controller.prepare('approve',rows[0].id));assert.equal(h.controller.page(1),false);
 const review=confirmationMarkup(h.controller.snapshot().confirmation),row=proposalMarkup(h.controller.snapshot().proposals[0],h.controller.snapshot());assert.doesNotMatch(review+row,/<script>|<img src=x/);assert.match(review+row,/&lt;script&gt;/);
});
test('malformed stored operations are ignored and DTOs enforce exact soldier counts',async()=>{
 assert.equal(cleanDeployment(deployment({totalSquads:383})),null);assert.equal(cleanDeployment(deployment({revision:0})),null);assert.equal(cleanProposal(proposal({id:'anything'})),null);
 const h=setup();h.stored.set('sengoku-roaming-management-pending-v1:lord-admin',JSON.stringify({ownerId:ADMIN.id,action:'approve',body:{requestId:'x',expectedRevision:1},proposalId:'../admin',current:deployment()}));const fresh=createController(h.options);assert.equal(fresh.snapshot().pending,null);fresh.dispose();
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} roaming management UI scenarios passed; no live writes.`);})().catch(error=>{console.error(error);process.exitCode=1;});
