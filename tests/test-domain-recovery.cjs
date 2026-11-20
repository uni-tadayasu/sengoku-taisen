/* Local-only recovery tests: fake identities, fake HTTP and isolated storage. */
(async function(){
'use strict';
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const helper=require('../domain-recovery.js'),IDKEY='sengoku-online-identity-v1',GAMEKEY='sengoku-tento-save-v2';
const oldIdentity={id:'old-test',token:'o'.repeat(64)},identity={id:'operator-test',token:'t'.repeat(64)};
const save={game:'sengoku-tento',version:2,state:{clan:'徳川家',home:'edo',turn:0,officers:[{id:'test'}]}};
const copy=value=>JSON.parse(JSON.stringify(value));let checks=0;
function check(work){work();checks++;}
check(()=>assert.equal(helper.parse({...identity,isAdmin:true,isStaff:true}).identity.isAdmin,undefined));
check(()=>assert.equal(helper.combine([{...identity},save]).save.state.home,'edo'));
check(()=>assert.equal(helper.combine([save],{identity}).identity.id,identity.id));
check(()=>assert.throws(()=>helper.combine([save]),/進行だけ/));
check(()=>assert.throws(()=>helper.combine([identity,identity]),/1人分/));
check(()=>assert.throws(()=>helper.combine([save,save],{identity}),/1個だけ/));
check(()=>assert.throws(()=>helper.parse({format:helper.FORMAT,version:5,identity,save}),/バージョン/));
check(()=>assert.throws(()=>helper.parse({...identity,format:'other-product'})));
const bundle=helper.createBackup({...identity,isAdmin:true},save,{name:'<領主>',sourceOrigin:'https://old.example'});
check(()=>assert.equal(helper.parse(bundle).kind,'complete'));
check(()=>assert.equal(bundle.identity.isAdmin,undefined));
check(()=>assert(!helper.summaryHtml({clan:'<img>',home:'edo',turn:672,officers:1}).includes('第')));
check(()=>assert(helper.summaryHtml({clan:'<img>',home:'edo',turn:672,officers:1}).includes('1560年 1月')));
check(()=>assert(!helper.summaryHtml({clan:'<img>'}).includes('<img>')));
check(()=>assert(!helper.guidance({adminRegistered:true,hasIdentity:true}).includes(identity.token)));
await assert.rejects(helper.readFiles([{size:helper.MAX_FILE_BYTES+1,text:async()=>''}]),/4MB/);checks++;
await assert.rejects(helper.readFiles([{size:3,text:async()=>'{x}'}]),/JSON/);checks++;
const pair=await helper.readFiles([identity,save].map(value=>{const text=JSON.stringify(value);return{size:text.length,text:async()=>text};}));
check(()=>assert.equal(pair.kind,'files'));

function fixture({existing=true,cloud=null,isAdmin=true}={}){
 const storage=new Map(),calls=[],starts=[],stops=[],roles=[],prepared=[],applied=[],feedback=[],blobs=[];
 if(existing)storage.set(IDKEY,JSON.stringify(oldIdentity));storage.set(GAMEKEY,JSON.stringify({...save,state:{...save.state,clan:'旧進行',home:'old-home'}}));
 let blockIdentity=false,blockRollback=false,finalizeFailure=false,applyFailure=false,prepareFailure=false,apiFailure=null,releaseMe=null,delayMe=false,ready=true;
 let remote=cloud,remoteAdmin=isAdmin;let handler=null;
 const user=()=>({id:identity.id,name:'検証運営',clan:'徳川家',isAdmin:remoteAdmin,isStaff:false});
 const box={innerHTML:'',inert:false},tabs={innerHTML:'',inert:false},confirm={innerHTML:'',querySelector:()=>({focus(){}})};
 const doc={readyState:'loading',hidden:false,activeElement:null,addEventListener(){},removeEventListener(){},createElement:()=>({click(){}})};
 class TestURL extends URL{}TestURL.createObjectURL=blob=>{blobs.push(blob);return'blob:test';};TestURL.revokeObjectURL=()=>{};
 const context={console,URL:TestURL,URLSearchParams,AbortController,Blob,crypto:crypto.webcrypto,FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}},setTimeout,clearTimeout,document:doc,location:{origin:'https://www.kasai-solutions-inc.com'},
 localStorage:{getItem:key=>storage.get(key)??null,setItem(key,value){if(key===IDKEY&&((blockIdentity&&JSON.parse(value).id===identity.id)||(blockRollback&&JSON.parse(value).id===oldIdentity.id)||(finalizeFailure&&JSON.parse(value).id===identity.id&&JSON.parse(value).pendingRecovery!==true)))throw Error('test storage blocked');storage.set(key,value);},removeItem:key=>storage.delete(key)},SENGOKU_API_BASE:'https://local.invalid',
 fetch:async(url,options)=>{const route=new URL(url).pathname.replace('/api/v1','');calls.push({route,method:options.method,headers:options.headers});if(handler)return handler(route,options);if(apiFailure)throw Error(apiFailure);if(route==='/me'&&delayMe)await new Promise(resolve=>{releaseMe=resolve;});const payload=route==='/me'?{ok:true,user:user(),friends:[],requests:[]}:route==='/sync'?{ok:true,user:user(),save:copy(remote),revision:remote?3:0,updatedAt:'2026-11-21T00:00:00Z'}:{ok:true};return{ok:true,status:200,json:async()=>payload};},
 SengokuCloudSync:{stop:options=>stops.push(options),start:session=>starts.push(session),flush:async()=>{},getStatus:()=>({ready,linked:existing,writable:existing,message:'test'}),getDevice:()=>({id:'device-test',name:'検証端末'})},
 SengokuBridge:{getSave:()=>copy(save),getState:()=>copy(save.state),setAdminAccess:value=>roles.push(value),setSyncAccess(){},toast:(message,error)=>feedback.push({message,error}),prepareRecoverySave:(value,meta)=>{prepared.push({value,meta});return prepareFailure?{ok:false,message:'test save invalid'}:{ok:true,save:copy(value),summary:{clan:value.state.clan,home:meta.isAdmin?'edo':value.state.home,turn:value.state.turn,officers:value.state.officers.length}};},applyRecoverySave:(value,meta)=>{applied.push({value,meta});if(applyFailure)return{ok:false,message:'test game storage failed'};storage.set(GAMEKEY,JSON.stringify(value));return{ok:true};}}};
 context.window=context;vm.createContext(context);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../domain-recovery.js'),'utf8'),context);
 let source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8');source=source.replace('global.SengokuSocial={open','global.__recoveryTest={s,verifyRecovery,recoveryConfirmation,recoveryView,submit,installIdentity,importRecoveryFiles,exportRecoveryBackup,restoreStoredIdentity,startCloud,setEpoch:v=>{authEpoch=v;},getRecovery:()=>recovery};global.SengokuSocial={open');vm.runInContext(source,context);
 const t=context.__recoveryTest;if(existing){t.s.identity={...oldIdentity};t.s.user={id:oldIdentity.id,name:'以前の接続',isAdmin:false};}
 return{t,context,storage,calls,starts,stops,roles,prepared,applied,feedback,blobs,user,flags:options=>{if('blockIdentity'in options)blockIdentity=options.blockIdentity;if('blockRollback'in options)blockRollback=options.blockRollback;if('finalizeFailure'in options)finalizeFailure=options.finalizeFailure;if('applyFailure'in options)applyFailure=options.applyFailure;if('prepareFailure'in options)prepareFailure=options.prepareFailure;if('apiFailure'in options)apiFailure=options.apiFailure;if('delayMe'in options)delayMe=options.delayMe;if('ready'in options)ready=options.ready;},remote:(value,admin=remoteAdmin)=>{remote=value;remoteAdmin=admin;},handler:value=>{handler=value;},release:()=>releaseMe?.()};
}

// Identity alone never starts synchronization and never writes the current game.
{
 const f=fixture({existing:false});await f.t.verifyRecovery({identity});
 check(()=>assert.equal(f.starts.length,0));check(()=>assert.equal(f.storage.get(IDKEY),undefined));check(()=>assert.equal(f.applied.length,0));
 check(()=>assert(f.calls.every(call=>call.method==='GET')));check(()=>assert(f.t.recoveryView().includes('ゲームセーブを追加する')));check(()=>assert(!f.t.recoveryView().includes(identity.token)));
 check(()=>assert.throws(()=>f.t.recoveryConfirmation('file'),/./));
}
// A complete backup uses server-confirmed admin privileges, then starts exactly once.
{
 const f=fixture();await f.t.verifyRecovery({identity:{...identity,isAdmin:false},save});const confirm=f.t.recoveryConfirmation('file');
 check(()=>assert.equal(f.starts.length,0));check(()=>assert(confirm.details.includes('運営')));check(()=>assert(!confirm.details.includes(identity.token)));
 await confirm.onConfirm();check(()=>assert.equal(f.starts.length,1));check(()=>assert.equal(f.starts[0].id,identity.id));check(()=>assert.equal(f.applied.length,1));check(()=>assert.equal(f.applied[0].meta.isAdmin,true));check(()=>assert.equal(JSON.parse(f.storage.get(IDKEY)).id,identity.id));check(()=>assert.equal(f.t.s.user.isAdmin,false));
}
// Forged file role flags cannot confer operator assets.
{
 const f=fixture({isAdmin:false});await f.t.verifyRecovery({identity:{...identity,isAdmin:true},save});await f.t.recoveryConfirmation('file').onConfirm();check(()=>assert(f.prepared.every(call=>call.meta.isAdmin===false)));check(()=>assert.equal(f.applied[0].meta.isAdmin,false));
}
// Existing cloud saves take priority, even if a bundle contains malformed progress.
{
 const f=fixture({cloud:save});f.flags({prepareFailure:true});await f.t.verifyRecovery({identity,save:{bad:true}});check(()=>assert.equal(f.prepared.length,0));check(()=>assert.throws(()=>f.t.recoveryConfirmation('file'),/変わりました/));await f.t.recoveryConfirmation('cloud').onConfirm();check(()=>assert.equal(f.applied.length,0));check(()=>assert.equal(f.starts.length,1));
}
// A save appearing while the confirmation is open must be reviewed again.
{
 const f=fixture();await f.t.verifyRecovery({identity,save});const confirm=f.t.recoveryConfirmation('file');f.remote(save);await assert.rejects(confirm.onConfirm(),/更新されました/);checks++;check(()=>assert.equal(f.starts.length,0));check(()=>assert.equal(f.applied.length,0));check(()=>assert.equal(JSON.parse(f.storage.get(IDKEY)).id,oldIdentity.id));check(()=>assert(f.t.recoveryView().includes('サーバーの進行で接続')));
}
// Revoked operator access is not smuggled through an old confirmation.
{
 const f=fixture();await f.t.verifyRecovery({identity,save});const confirm=f.t.recoveryConfirmation('file');f.remote(null,false);await assert.rejects(confirm.onConfirm(),/権限が更新/);checks++;check(()=>assert.equal(f.applied.length,0));await f.t.recoveryConfirmation('file').onConfirm();check(()=>assert.equal(f.applied[0].meta.isAdmin,false));
}
// Failed identity persistence and failed game persistence keep the prior identity.
for(const failure of ['blockIdentity','applyFailure']){
 const f=fixture(),previousGame=f.storage.get(GAMEKEY);await f.t.verifyRecovery({identity,save});f.flags({[failure]:true});await assert.rejects(f.t.recoveryConfirmation('file').onConfirm(),/保存|storage/);checks++;
 check(()=>assert.equal(JSON.parse(f.storage.get(IDKEY)).id,oldIdentity.id));check(()=>assert.equal(f.t.s.identity.id,oldIdentity.id));check(()=>assert.equal(f.storage.get(GAMEKEY),previousGame));check(()=>assert(f.starts.every(session=>session.id===oldIdentity.id)));
}
// If rollback itself is blocked, no account may start synchronization.
{
 const f=fixture();await f.t.verifyRecovery({identity,save});f.flags({applyFailure:true,blockRollback:true});await assert.rejects(f.t.recoveryConfirmation('file').onConfirm(),/同期を停止/);checks++;check(()=>assert.equal(f.starts.length,0));check(()=>assert.equal(f.t.s.identity.id,identity.id));check(()=>assert.equal(JSON.parse(f.storage.get(IDKEY)).pendingRecovery,true));
}
// An abrupt close after the pending identity write cannot seed the wrong game on reload.
{
 const f=fixture({existing:false});f.storage.set(IDKEY,JSON.stringify({...identity,pendingRecovery:true}));
 check(()=>assert.equal(f.t.restoreStoredIdentity(),true));f.t.startCloud();check(()=>assert.equal(f.starts.length,0));
 await f.t.verifyRecovery({identity:f.t.s.identity});check(()=>assert.equal(f.starts.length,0));check(()=>assert(f.calls.every(call=>call.method==='GET')));check(()=>assert(f.t.recoveryView().includes('前回の引き継ぎの保存が完了していません')));check(()=>assert(f.t.recoveryView().includes('ゲームセーブを追加する')));
 check(()=>assert.throws(()=>f.t.exportRecoveryBackup(),/引き継ぎが途中/));
}
// Finalizing identity may fail after the new game was safely saved. Keep the
// target pending; never reconnect the OLD identity to this NEW game.
{
 const f=fixture();await f.t.verifyRecovery({identity,save});f.flags({finalizeFailure:true});
 await assert.rejects(f.t.recoveryConfirmation('file').onConfirm(),/進行の保存はできましたが接続の確定に失敗/);checks++;
 check(()=>assert.equal(f.starts.length,0));check(()=>assert.equal(f.t.s.identity.id,identity.id));check(()=>assert.equal(JSON.parse(f.storage.get(IDKEY)).pendingRecovery,true));check(()=>assert.equal(JSON.parse(f.storage.get(GAMEKEY)).state.clan,save.state.clan));
 const reboot=fixture({existing:false});reboot.storage.set(IDKEY,f.storage.get(IDKEY));reboot.storage.set(GAMEKEY,f.storage.get(GAMEKEY));reboot.t.restoreStoredIdentity();reboot.t.startCloud();await reboot.t.verifyRecovery({identity:reboot.t.s.identity});check(()=>assert.equal(reboot.starts.length,0));
 await reboot.t.recoveryConfirmation('local').onConfirm();check(()=>assert.equal(reboot.starts.length,1));check(()=>assert.equal(reboot.starts[0].id,identity.id));check(()=>assert.equal(JSON.parse(reboot.storage.get(IDKEY)).pendingRecovery,undefined));
}
// The ordinary previously saved identity remains compatible and starts normally.
{
 const f=fixture();check(()=>assert.equal(f.t.restoreStoredIdentity(),false));f.t.startCloud();check(()=>assert.equal(f.starts.length,1));check(()=>assert.equal(f.starts[0].id,oldIdentity.id));
}
// A local-progress choice is available only as an explicit separate confirmation.
{
 const f=fixture({existing:false});await f.t.verifyRecovery({identity});const confirm=f.t.recoveryConfirmation('local');check(()=>assert(confirm.description.includes('以前の未保存の進行は復元されません')));await confirm.onConfirm();check(()=>assert.equal(f.applied.length,1));check(()=>assert.equal(f.starts.length,1));
}
// Replacing identity during read-only verification discards the late response.
{
 const f=fixture();f.flags({delayMe:true});const pending=f.t.verifyRecovery({identity,save});f.t.setEpoch(2);f.release();await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');checks++;check(()=>assert.equal(f.starts.length,0));check(()=>assert.equal(f.applied.length,0));
}
// A consumed pairing credential stays in memory for a retry if verification fails.
{
 const f=fixture({existing:false});let linked=0;f.handler(async(route)=>{if(route==='/devices/link'){linked++;return{ok:true,status:200,json:async()=>({ok:true,user:{id:identity.id,isAdmin:true},token:identity.token})};}throw Error('temporary verification failure');});
 const form={id:'social-device-link-form',values:{code:'ABC123DEF456'},querySelector:()=>null,reset(){}};await f.t.submit({target:form,preventDefault(){}});check(()=>assert.equal(linked,1));check(()=>assert.equal(f.starts.length,0));check(()=>assert.equal(f.t.getRecovery().identity.id,identity.id));check(()=>assert(!f.t.recoveryView().includes(identity.token)));
 f.handler(null);await f.t.verifyRecovery(f.t.getRecovery());check(()=>assert.equal(f.t.getRecovery().verified,true));check(()=>assert.equal(linked,1));
}
// Offline export preserves the raw original game while role verification is pending.
{
 const f=fixture();f.flags({ready:false});f.t.exportRecoveryBackup();const exported=JSON.parse(await f.blobs[0].text());check(()=>assert.equal(exported.save.state.clan,'旧進行'));check(()=>assert.equal(exported.identity.id,oldIdentity.id));check(()=>assert.equal(exported.identity.isAdmin,undefined));check(()=>assert.equal(exported.format,'sengoku-complete-backup'));
}
console.log(`Domain recovery tests passed (${checks} assertions): origin migration guidance, complete/legacy files, authenticated role validation, cloud-first choices, no empty-cloud auto-upload, pairing retry, stale identity, storage rollback, explicit local-progress choice and private-token-free UI. No network requests were made.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
