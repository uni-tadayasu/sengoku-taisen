'use strict';
// Exercise the shipped application bridge, including its actual save/write path.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const field=source.slice(source.indexOf('  async function requestField('),source.indexOf('  async function departCampaign('));
const expansion=source.slice(source.indexOf('  function requestExpansion('),source.indexOf('  function configureProgress('));
const ROUTE='/shogunate/governance/action';
const copy=value=>JSON.parse(JSON.stringify(value));
function harness(){
 const calls=[],storage=new Map(),ctx={console,crypto:webcrypto,Date,JSON,URLSearchParams,fieldActionPending:false,roleEpoch:1};
 let revision=7,remoteRevision=7,writable=true,campaign='campaign-one',owner='player-one',transport=null,flushed=true;
 const status=()=>({linked:true,writable,revision});
 const social={getUser:()=>({id:owner}),expansionRequest:async(route,options={})=>{calls.push({type:'send',route,options:copy(options)});if(transport)return transport(route,options);if(options.method==='POST')remoteRevision++;return{ok:true,revision:remoteRevision,governance:{available:true}};}};
 const sync={getDevice:()=>({id:'device-one'}),getStatus:status,flush:async()=>{calls.push({type:'flush'});return{ok:flushed};},refresh:async()=>{calls.push({type:'refresh'});revision=remoteRevision;return{ok:true};}};
 Object.assign(ctx,{window:{SengokuSocial:social,SengokuCloudSync:sync,SengokuWorldClock:{refresh:async()=>calls.push({type:'clock'})}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k),key:i=>[...storage.keys()][i]??null,get length(){return storage.size;}},state:()=>({walking:{campaignId:campaign}}),requireWritable:()=>writable,canMutate:()=>writable,save:()=>{calls.push({type:'save'});return true;},processWorldClock(){},refreshLiveControls(){},queueWorldProgress(){}});
 vm.createContext(ctx);vm.runInContext(field+'\n'+expansion+'\nthis.api=requestExpansion;',ctx);
 return{ctx,api:ctx.api,calls,storage,setTransport:value=>transport=value,setWritable:value=>writable=value,setFlush:value=>flushed=value,setRemote:value=>remoteRevision=value,setCampaign:value=>campaign=value,setOwner:value=>owner=value};
}
const body=()=>({kind:'duty',targetId:'audience',day:'2026-11-28',governanceRevision:0,requestId:'governance-request-1'});
async function run(){
 let count=0;
 {
  const h=harness();await h.api('/shogunate/governance');assert.deepEqual(h.calls.map(x=>x.type),['send']);assert.equal(h.calls[0].route,'/shogunate/governance');count++;
 }
 {
  const h=harness(),payload=body();const result=await h.api(ROUTE,{method:'POST',data:payload});assert.equal(result.revision,8);
  assert.deepEqual(h.calls.map(x=>x.type),['clock','save','flush','send','refresh']);const sent=h.calls.find(x=>x.type==='send');
  assert.equal(sent.route,ROUTE);assert.deepEqual(sent.options.data,{...payload,deviceId:'device-one',expectedRevision:7});assert.equal(h.storage.size,0);assert.equal(h.ctx.fieldActionPending,false);count++;
 }
 {
  const h=harness();h.setFlush(false);await assert.rejects(h.api(ROUTE,{method:'POST',data:body()}));assert.equal(h.calls.filter(x=>x.type==='send').length,0);assert.equal(h.ctx.fieldActionPending,false);count++;
 }
 {
  const h=harness();h.setWritable(false);await assert.rejects(h.api(ROUTE,{method:'POST',data:body()}));assert.equal(h.calls.filter(x=>x.type==='send').length,0);count++;
 }
 {
  const h=harness();let accepted=false;h.setTransport(async()=>{if(!accepted){accepted=true;h.setRemote(8);throw Error('Response lost after commit');}return{ok:true,revision:8,governance:{available:true},idempotent:true};});
  await assert.rejects(h.api(ROUTE,{method:'POST',data:body()}));assert.equal(h.storage.size,1);assert([...h.storage.keys()][0].startsWith('sengoku-expansion-pending-v1:'));
  const retried=await h.api(ROUTE,{method:'POST',data:{...body(),requestId:'different-caller-id'}});assert(retried.idempotent);assert.equal(retried.effectiveRequestId,'governance-request-1');
  const sends=h.calls.filter(x=>x.type==='send');assert.equal(sends.length,2);assert.equal(sends[0].options.data.requestId,sends[1].options.data.requestId);assert.equal(sends[1].options.data.expectedRevision,8);assert.equal(h.storage.size,0);count++;
 }
 for(const invalidation of ['role','campaign','owner']){
  const h=harness();h.setTransport(async()=>{if(invalidation==='role')h.ctx.roleEpoch++;else if(invalidation==='campaign')h.setCampaign('new-campaign');else h.setOwner('other-player');return{ok:true,revision:8};});
  await assert.rejects(h.api(ROUTE,{method:'POST',data:body()}),e=>e.code==='STALE_IDENTITY');assert.equal(h.ctx.fieldActionPending,false);count++;
 }
 {
  const h=harness();h.setTransport(async()=>{throw Object.assign(Error('Day changed'),{status:409,code:'GOVERNANCE_DAY_CHANGED'});});
  await assert.rejects(h.api(ROUTE,{method:'POST',data:body()}));assert.equal(h.storage.size,0);count++;
 }
 // Actual social facade must admit the two new exact paths and keep its
 // authenticated epoch guard. This supplements the bridge's behavioral cases.
 const social=fs.readFileSync(require.resolve('../social.js'),'utf8');
 assert(social.includes("'/shogunate/governance'"));assert(social.includes("'/shogunate/governance/action'"));
 assert(source.includes("case 'shogunate-governance':closeModal();window.SengokuShogunateGovernance?.open();break;"));
 console.log(`${count} governance save-bridge scenarios passed.`);
}
run().catch(error=>{console.error(error);process.exitCode=1;});
