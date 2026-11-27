'use strict';
const assert=require('node:assert/strict');
const {create,clean,markup}=require('../deputy-operator.js');
const {setup:dom}=require('./helpers/dom-model.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const ADMIN={id:'u_operator',name:'運営',isAdmin:true,isBanned:false},TARGET={id:'u_target',name:'任命対象',clan:'織田家'};
const cases=[],test=(name,run)=>cases.push([name,run]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function fixture({actor=ADMIN,store=new Map(),deputy=null}={}){
 let user=clone(actor),epoch=1,handler=null,id=0,writes=0;
 const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
 const server={revision:deputy?1:0,deputy},receipts=new Map(),calls=[],view=dom();
 const base=async(route,options)=>{
  if(route.startsWith('/admin/moderation/players?'))return{ok:true,players:[clone(TARGET)]};
  assert.equal(route,'/admin/deputy');
  if(options.method==='POST'){
   const b=options.data;
   if(receipts.has(b.requestId))return{ok:true,...clone(server),action:b.action,idempotent:true};
   if(b.expectedRevision!==server.revision)throw Object.assign(Error('役職が更新されました'),{status:409});
   writes++;server.revision++;server.deputy=b.action==='appoint'?{...TARGET,isDeputy:true,appointedAt:'2026-11-27T07:00:00.000Z'}:null;receipts.set(b.requestId,clone(b));
   return{ok:true,...clone(server),action:b.action,idempotent:false};
  }
  return{ok:true,...clone(server)};
 };
 const options={storage,getUser:()=>user,getContext:()=>({epoch,privilegeEpoch:1}),uuid:()=> 'request_'+(++id),request:async(route,opt)=>{calls.push({route,options:clone(opt)});return handler?handler(route,opt,base):base(route,opt);}};
 const controller=create(options);
 return{controller,view,storage,store,options,server,calls,receipts,writes:()=>writes,setHandler:h=>{handler=h;},setUser:value=>{user=clone(value);epoch++;},postCalls:()=>calls.filter(c=>c.options.method==='POST'),base};
}
async function choose(f){await f.controller.mount(f.view.host);f.controller.setQuery('任命');await f.controller.search();assert(f.controller.prepare('appoint',TARGET.id));}

test('state validation and safe markup keep the confirmed deputy bounded',()=>{
 assert.deepEqual(clean({ok:true,revision:0,deputy:null}),{revision:0,deputy:null});
 for(const value of [{ok:false,revision:0,deputy:null},{ok:true,revision:-1,deputy:null},{ok:true,revision:0,deputy:{}},{ok:true,revision:0,deputy:TARGET}])assert.equal(clean(value),null);
 const f=fixture(),html=markup({authorized:true,loaded:true,ownerId:ADMIN.id,results:[{...TARGET,name:'<img src=x onerror=alert(1)>'}],revision:0});
 assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('鹿児島城'));assert(html.includes('家臣を受け付けません'));assert(html.includes('勝利報酬'));assert(html.includes('data-deputy-search'));f.controller.dispose();
});

test('only the current primary operator can read, search or mutate',async()=>{
 for(const actor of [null,{...ADMIN,isAdmin:false,isStaff:true},{...ADMIN,isAdmin:false,isDeputy:true},{...ADMIN,isBanned:true}]){
  const f=fixture({actor});assert.equal(await f.controller.mount(f.view.host),false);assert.equal(f.controller.setQuery('任命'),false);assert.equal(await f.controller.search(),false);assert.equal(f.controller.prepare('appoint',TARGET.id),false);assert.equal(await f.controller.confirm(),false);assert.equal(await f.controller.retry(),false);assert.equal(f.calls.length,0);assert.match(f.view.host.textContent,/運営だけ/);f.controller.dispose();
 }
});

test('appointment requires a review, preserves the chosen identity, and closes the single slot',async()=>{
 const f=fixture();await choose(f);assert.equal(f.writes(),0);assert.match(f.view.host.textContent,/この領主をサブ運営に任命/);assert.match(f.view.host.textContent,/u_target/);assert(await f.controller.confirm());assert.equal(f.writes(),1);assert.equal(f.postCalls()[0].options.data.targetPlayerId,TARGET.id);assert.equal(f.postCalls()[0].options.data.expectedRevision,0);assert.equal(f.controller.getState().deputy.id,TARGET.id);assert.equal(f.controller.getState().pending,null);assert.equal(f.store.size,0);assert.match(f.view.host.textContent,/先に解雇/);assert.equal(f.controller.prepare('appoint',TARGET.id),false);f.controller.dispose();
});

test('dismissal reviews the incumbent and reports the ordinary base fallback',async()=>{
 const f=fixture({deputy:{...TARGET,isDeputy:true}});await f.controller.mount(f.view.host);assert(f.controller.prepare('dismiss'));assert.match(f.view.host.textContent,/元の通常拠点/);assert.match(f.view.host.textContent,/家臣として戻り/);assert.equal(f.writes(),0);f.controller.cancel();assert.equal(f.writes(),0);assert(f.controller.prepare('dismiss'));assert(await f.controller.confirm());assert.equal(f.postCalls()[0].options.data.action,'dismiss');assert.equal(f.postCalls()[0].options.data.expectedRevision,1);assert.equal(f.controller.getState().deputy,null);f.controller.dispose();
});

test('a lost response survives remount and retries the exact accepted operation once',async()=>{
 const f=fixture();await choose(f);let lost=true;f.setHandler(async(route,opt,base)=>{const result=await base(route,opt);if(opt.method==='POST'&&lost){lost=false;throw Error('lost after commit');}return result;});
 assert.equal(await f.controller.confirm(),false);assert.equal(f.writes(),1);const original=f.postCalls()[0].options.data;assert(f.controller.getState().pending);assert.equal(f.controller.prepare('dismiss'),false);f.controller.dispose();
 const resumed=create(f.options),view=dom();await resumed.mount(view.host);assert.equal(resumed.getState().pending.body.requestId,original.requestId);assert.match(view.host.textContent,/再試行/);assert(await resumed.retry());assert.equal(f.writes(),1);assert.deepEqual(f.postCalls()[1].options.data,original);assert.equal(resumed.getState().pending,null);assert.equal(f.store.size,0);resumed.dispose();
});

test('failed durable pending storage prevents any administrative write',async()=>{
 const f=fixture();await choose(f);f.storage.setItem=()=>{throw Error('blocked storage');};assert.equal(await f.controller.confirm(),false);assert.equal(f.postCalls().length,0);assert(f.controller.getState().confirm);assert.match(f.controller.getState().error,/保存できません/);f.controller.dispose();
});

test('a changed appointment is refreshed after CAS rejection without automatically resubmitting',async()=>{
 const f=fixture();await choose(f);f.server.revision=1;f.server.deputy={id:'u_other',name:'別のサブ運営',isDeputy:true};assert.equal(await f.controller.confirm(),false);assert.equal(f.postCalls().length,1);assert.equal(f.writes(),0);assert.equal(f.controller.getState().deputy.id,'u_other');assert.equal(f.controller.getState().pending,null);assert.equal(f.controller.getState().confirm,null);assert.match(f.controller.getState().status,/役職や対象/);f.controller.dispose();
});

test('an account change discards stale private reads and never submits a previous confirmation',async()=>{
 const f=fixture(),gate=deferred();f.setHandler(()=>gate.promise);const first=f.controller.mount(f.view.host);f.setUser({id:'u_other',name:'一般',isAdmin:false});f.controller.refreshIdentity();gate.resolve({ok:true,revision:1,deputy:{...TARGET,isDeputy:true}});assert.equal(await first,false);assert.equal(f.controller.getState().authorized,false);assert.equal(f.controller.getState().deputy,null);assert.equal(await f.controller.confirm(),false);assert.equal(f.postCalls().length,0);f.controller.dispose();
});

test('duplicate confirmation is locked while the first request is pending',async()=>{
 const f=fixture();await choose(f);const gate=deferred();f.setHandler(async(route,opt,base)=>{if(opt.method==='POST'){await gate.promise;return base(route,opt);}return base(route,opt);});const first=f.controller.confirm();assert.equal(await f.controller.confirm(),false);assert.equal(await f.controller.retry(),false);assert.equal(f.postCalls().length,1);gate.resolve();assert(await first);assert.equal(f.writes(),1);f.controller.dispose();
});

test('malformed success never clears the pending receipt or reports the action complete',async()=>{
 const f=fixture();await choose(f);f.setHandler(async(route,opt,base)=>opt.method==='POST'?{ok:true,revision:1,deputy:null,action:'dismiss',idempotent:false}:base(route,opt));assert.equal(await f.controller.confirm(),false);assert(f.controller.getState().pending);assert.equal(f.controller.getState().status,'');assert.match(f.controller.getState().error,/通信結果/);f.controller.dispose();
});
test('mounted reviews reveal the entire confirmation and restore keyboard focus after cancel or completion',async()=>{
 const f=fixture();await choose(f);const {doc,host}=f.view;assert.equal(host.querySelector('.deputy-confirm').scrollIntoViewCalls,1);assert.equal(doc.activeElement,host.querySelector('#deputy-confirm-title'));
 host.querySelector('[data-deputy="cancel"]').focus();f.controller.cancel();assert.equal(doc.activeElement,host.querySelector('[data-deputy="appoint"]'));assert.equal(doc.activeElement.disabled,false);
 assert(f.controller.prepare('appoint',TARGET.id));host.querySelector('[data-deputy="confirm"]').focus();assert(await f.controller.confirm());assert.equal(doc.activeElement,host.querySelector('[data-deputy="dismiss"]'));
 assert(f.controller.prepare('dismiss'));host.querySelector('[data-deputy="confirm"]').focus();assert(await f.controller.confirm());assert.equal(doc.activeElement,host.querySelector('#deputy-query'));assert.equal(doc.activeElement.disabled,false);f.controller.dispose();
});
test('a completed search cannot steal focus from a control the operator moved to while waiting',async()=>{
 const f=fixture();await f.controller.mount(f.view.host);f.controller.setQuery('任命');f.view.host.querySelector('#deputy-query').focus();const gate=deferred();f.setHandler(()=>gate.promise);const search=f.controller.search(),outside=f.view.doc.createElement('button');f.view.doc.body.appendChild(outside);outside.focus();gate.resolve({ok:true,players:[clone(TARGET)]});assert(await search);assert.equal(f.view.doc.activeElement,outside);f.controller.dispose();
});

(async()=>{for(const [name,run] of cases){await run();console.log('PASS '+name);}console.log('deputy operator UI: '+cases.length+' scenarios passed');})().catch(error=>{console.error(error);process.exitCode=1;});
