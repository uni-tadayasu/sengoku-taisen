/* Click-path serialization and recovery checks with a full campaign. No network. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {fixture,officers}=require('../tools/audit-economy.cjs');
const {SENGOKU_DATA}=require('../engine.js');
const clone=value=>JSON.parse(JSON.stringify(value)),memory=()=>{const values=new Map();return{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};};
// Existing recovery records use these UTF-16 checksums. Optimizing the capture
// path must remain compatible with checkpoints written by earlier releases.
function legacyHash(value){let a=2166136261,b=3339675911;for(let i=0;i<value.length;i++){a=Math.imul(a^value.charCodeAt(i),16777619);b=Math.imul(b^value.charCodeAt(i),2246822519);}return(a>>>0).toString(16)+':'+(b>>>0).toString(16);}
function load(source){
 const scope={console,Date,JSON,Math,crypto:crypto.webcrypto,localStorage:memory(),sessionStorage:memory(),navigator:{onLine:true,userAgent:'test'},setTimeout,clearTimeout,addEventListener(){},document:{hidden:false,addEventListener(){}}};scope.window=scope;
 vm.runInNewContext(source,scope);return scope.SengokuCloudSync;
}
function largeSave(){
 const game=fixture(32,20);game.state.officers=officers.map(officer=>officer.id);game.state.officerVariants=officers.flatMap(officer=>SENGOKU_DATA.ranks.filter(rank=>game.canOwnOfficerVariant(officer.id,rank)).map(rank=>officer.id+':'+rank));
 for(const id of game.state.officers)game.state.officerHealth[id]=100;
 return JSON.parse(game.exportSave());
}
async function client(api){
 let current=largeSave(),stored=clone(current),canonical=clone(current),revision=4,writer=null,reads=0,durableReads=0,hold=null;
 const storage=memory(),now=2000000000000,timers=new Map();let timerId=0;
 const bridge={hasStarted:()=>true,getSave:()=>{reads++;return clone(current);},getStoredSave:()=>{durableReads++;return clone(stored);},getRoleAccess:()=>({pending:false}),setRoleAccess(){},setSyncAccess(){},applyCloudSave:save=>{current=clone(save);stored=clone(save);return{ok:true};}};
 const sync=api.create({device:{id:'test',name:'test'},bridge:()=>bridge,storage,now:()=>now,hidden:()=>false,online:()=>true,setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id)});
 const snapshot=()=>({ok:true,user:{id:'test',isAdmin:false,isStaff:false},save:clone(canonical),revision,serverTime:new Date(now).toISOString(),writerDeviceId:writer,leaseExpiresAt:new Date(now+30000).toISOString(),writable:writer===sync.getDevice().id});
 await sync.start({id:'test',onUser(){},request:async(route,options={})=>{
  if(route==='/presence')return{ok:true};
  if(route.startsWith('/sync?'))return snapshot();
  if(route==='/sync/lease'){writer=options.data.deviceId;return snapshot();}
  if(route==='/sync/release'){writer=null;return snapshot();}
  if(route==='/sync'&&options.method==='PUT'){
   assert.equal(options.data.revision,revision);canonical=clone(options.data.save);revision++;const result=snapshot();
   if(hold){const gate=hold;hold=null;await gate;}
   return result;
  }
  throw Error('Unexpected route '+route);
 }});
 reads=durableReads=0;
 return{sync,storage,bridge,mutate:fn=>fn(current.state),persist:()=>{stored=clone(current);},current:()=>clone(current),canonical:()=>clone(canonical),counts:()=>({reads,durableReads}),reset:()=>{reads=durableReads=0;},hold:promise=>{hold=promise;}};
}
async function main(){
 const api=load(fs.readFileSync(path.join(__dirname,'../cloud-sync.js'),'utf8'));let checks=0;
 const c=await client(api);
 for(let step=0;step<20;step++){
  c.mutate(state=>{state.resources.gold+=1;state.army=state.officers.slice(0,step%2?1:2);});c.persist();c.reset();c.sync.notifySave();
  assert.deepEqual(c.counts(),{reads:1,durableReads:1},'one save notification must export each full current/durable snapshot at most once');
  const pending=JSON.parse(c.storage.getItem('sengoku-sync-pending-v1'));assert.deepEqual(pending.snapshot,c.current());assert.equal(pending.local,pending.durable);assert.equal(pending.local,legacyHash(api.fingerprint(c.current())));assert.equal(pending.ack,legacyHash(api.fingerprint(c.canonical())));
 }
 checks++;console.log('PASS rapid saved actions capture each large runtime/durable snapshot once and retain the exact pending state');
 let release;const held=new Promise(resolve=>{release=resolve;});c.hold(held);const flight=c.sync.flush();
 for(let i=0;i<30;i++)await Promise.resolve();
 c.mutate(state=>{state.resources.rice+=7;state.army=[state.officers[1]];});c.persist();c.sync.notifySave();const latest=c.current();release();await flight;
 assert.deepEqual(c.current(),latest);assert.deepEqual(JSON.parse(c.storage.getItem('sengoku-sync-pending-v1')).snapshot,latest);await c.sync.flush();assert.deepEqual(c.canonical().state,latest.state);assert.equal(c.storage.getItem('sengoku-sync-pending-v1'),null);
 checks++;console.log('PASS a delayed acknowledgement preserves later actions and writes a fresh recovery checkpoint');
 c.mutate(state=>{state.resources.wood+=3;});c.persist();c.sync.notifySave();const prior=c.storage.getItem('sengoku-sync-pending-v1'),write=c.storage.setItem;c.storage.setItem=()=>{throw Error('quota');};c.mutate(state=>{state.resources.stone+=9;});c.persist();c.sync.notifySave();assert.equal(c.storage.getItem('sengoku-sync-pending-v1'),prior);assert.equal(c.current().state.resources.stone,c.canonical().state.resources.stone+9);c.storage.setItem=write;
 checks++;console.log('PASS a failed checkpoint write retains the previous durable checkpoint and the latest live assets');
 c.sync.stop();
 const invalid=await client(api),cycle={};cycle.self=cycle;invalid.bridge.getSave=()=>({state:cycle});invalid.sync.notifySave();assert.equal(invalid.sync.getStatus().writable,false);assert.equal(invalid.sync.getStatus().reason,'error');invalid.sync.stop();
 checks++;console.log('PASS an unserializable runtime still stops writes before sending an invalid save');
 console.log(checks+' sync snapshot reuse groups passed. No external requests.');
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={load,client,largeSave};
