/* Real application transaction facade; deferred transports never contact an API. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine}=require('../engine.js');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
const rosterScope={window:{}};vm.createContext(rosterScope);vm.runInContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterScope);
const roster=rosterScope.window.SENGOKU_OFFICERS;
const ID='tr_'+'a'.repeat(32),OTHER_ID='tr_'+'b'.repeat(32),PREFIX='sengoku-trade-pending-v1:';
const clone=value=>JSON.parse(JSON.stringify(value));
const records=h=>[...h.stored].filter(([key])=>key.startsWith(PREFIX));
const pending=h=>JSON.parse(records(h)[0]?.[1]||'null');
const proposal={targetPlayerId:'player-b',offer:{gold:100,wood:20},want:{rice:70,magatama:3}};
function fn(name){
  const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);
  const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);
  const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);
}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
async function until(predicate){for(let i=0;i<60;i++){if(predicate())return;await Promise.resolve();}assert(predicate(),'Transaction checkpoint not reached');}
function setup({stored=new Map()}={}){
  const trace=[],posts=[],events=[],acceptedClocks=[];
  let game=new SengokuEngine({officers:roster,seed:17});
  const clock={id:'trade-clock',elapsedMs:100000,confirmedElapsedMs:100000,running:true,speed:1,revision:1,calendar:{turn:1,year:1560,month:2,cycle:1,elapsed:40}};
  if(stored.has('save'))game=SengokuEngine.fromSave(stored.get('save'),roster);else{game.applyWorldClock(clock);stored.set('save',game.exportSave());}
  const control={user:{id:'player-a',name:'交易の領主',isAdmin:false,isStaff:false},deviceId:'trade-tab-a',status:{linked:true,ready:true,writable:true,revision:7,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},clock,clockReady:true,flushes:0,refreshes:0,uuidCalls:0,queued:0};
  const social={getUser:()=>control.user?{...control.user}:null,tradeRequest:async(route,options)=>{const call={route,options:clone(options)};posts.push(call);trace.push('post');return control.onPost?control.onPost(call):{ok:true,revision:control.status.revision,trade:{id:ID,status:'pending'},receipt:{id:'tx-local'}};}};
  const sync={getStatus:()=>({...control.status}),getDevice:()=>({id:control.deviceId}),
    flush:async()=>{control.flushes++;trace.push('flush');return control.onFlush?control.onFlush():{ok:true};},
    refresh:async()=>{control.refreshes++;trace.push('refresh');return control.onRefresh?control.onRefresh():{ok:true};}};
  let c;c={
    game,roster,SengokuEngine,URLSearchParams,Date,JSON,Math,Promise,state:()=>c.game.state,
    syncAccess:{...control.status},saveKey:'save',backupKey:'backups',saveEnabled:true,saveWarning:'',
    worldCatchingUp:false,worldSettlementPending:false,worldSettlementRetryAt:0,worldCatchupTimer:null,worldClockStatusKey:'',fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,startPending:false,roleEpoch:1,
    selectedCastle:'',lastRealtime:0,saveCounter:0,importedGame:null,activeModal:'',
    localStorage:{get length(){return stored.size;},key:index=>[...stored.keys()][index]??null,getItem:key=>stored.get(key)||null,setItem:(key,value)=>{if(control.storageError)throw Error('storage unavailable');stored.set(key,value);},removeItem:key=>stored.delete(key)},
    crypto:{randomUUID:()=>{control.uuidCalls++;return'trade-request-'+control.uuidCalls;}},
    window:{SengokuSocial:social,SengokuCloudSync:sync,SengokuWorldClock:{snapshot:()=>({ready:control.clockReady,clock:control.clock,message:'clock'}),refresh:async()=>{trace.push('clock');return control.onClock?control.onClock():{ok:true};},accept:clock=>{acceptedClocks.push(clock);control.clock=clock;}},dispatchEvent:event=>{events.push(event.type);trace.push('save');}},
    CustomEvent:class{constructor(type){this.type=type;}},performance:{now:()=>1000},document:{hidden:false},$:()=>null,
    setTimeout:()=>1,clearTimeout(){},toast(){},render(){},renderHeader(){},refreshLiveControls(){},refreshJobTimers(){},refreshActiveModal(){},queueWorldProgress:()=>control.queued++,preserveInteraction(){},closeModal(){},updateBattlePreview(){},syncMusic(){},
  };
  vm.createContext(c);vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave','applyCloudSave','applyDurableGift','processWorldClock','requestField','requestTrade','spendableAssets'].map(fn).join('\n'),c);
  return{c,control,stored,trace,posts,events,acceptedClocks};
}
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}

(async()=>{
await test('the public trade facade allows only the five precise POST routes and returns copied personal balances',async()=>{
  const h=setup(),balances=h.c.spendableAssets();assert.deepEqual(Object.keys(balances).sort(),['gold','rice','wood','stone','magatama'].sort());
  assert.equal(balances.gold,h.c.game.state.resources.gold);assert.equal(balances.magatama,h.c.game.state.magatama);balances.gold=0;assert.notEqual(h.c.game.state.resources.gold,0);
  for(const [route,method]of [['/trades','GET'],['/trades/'+ID,'POST'],['/trades/'+ID+'/accept?admin=1','POST'],['/trades/'+ID+'/accept/extra','POST'],['/trades/'+ID+'/claim','DELETE'],['/trades/tr_invalid/claim','POST'],['/trades/recipient','POST'],['/admin/claim','POST']])await assert.rejects(h.c.requestTrade(route,{method,data:{}}));
  assert.equal(h.posts.length,0);assert.equal(h.control.flushes,0);
  await h.c.requestTrade('/trades',{data:proposal});for(const action of ['accept','cancel','reject','claim'])await h.c.requestTrade('/trades/'+ID+'/'+action,{data:{}});assert.equal(h.posts.length,5);
});

await test('an offer flushes first, freezes game actions, overrides transport fields and waits for confirmed revision',async()=>{
  const h=setup(),flush=deferred(),response=deferred(),refresh=deferred(),before=clone(h.c.game.state);
  h.control.onFlush=()=>flush.promise;h.control.onPost=()=>response.promise;h.control.onRefresh=()=>refresh.promise;
  const task=h.c.requestTrade('/trades',{data:{...proposal,deviceId:'spoof',expectedRevision:999}});
  await until(()=>h.control.flushes===1);assert.deepEqual(h.trace.slice(0,3),['clock','save','flush']);assert.equal(h.posts.length,0);assert.equal(h.c.canMutate(),false);assert.equal(h.c.save(),false);assert.equal(h.c.applyDurableGift({gold:5},'during-trade').ok,false);
  h.control.clock={...h.control.clock,elapsedMs:150000,confirmedElapsedMs:150000};h.c.processWorldClock();assert.deepEqual(clone(h.c.game.state),before);
  h.control.status.revision=19;flush.resolve({ok:true});await until(()=>h.posts.length===1);
  const body=h.posts[0].options.data;assert.equal(body.expectedRevision,19);assert.equal(body.deviceId,'trade-tab-a');assert.deepEqual(body.offer,proposal.offer);assert.deepEqual(body.want,proposal.want);assert.equal(pending(h).requestId,body.requestId);
  await assert.rejects(h.c.requestTrade('/trades/'+ID+'/accept',{data:{}}));assert.equal(h.posts.length,1);
  response.resolve({ok:true,revision:20,trade:{id:ID},receipt:{id:'escrow-committed'}});await until(()=>h.control.refreshes===1);assert.equal(h.c.canMutate(),false);assert.equal(pending(h).committed,true);assert.equal(pending(h).committedRevision,20);
  assert.deepEqual(clone(h.c.game.state),before,'An HTTP response cannot optimistically debit the wallet');
  h.c.game.applyWorldClock(h.control.clock);h.control.status.revision=20;refresh.resolve({ok:true});assert.equal((await task).receipt.id,'escrow-committed');assert.equal(h.c.fieldActionPending,false);assert.equal(records(h).length,0);
});

await test('failed local save, flush, pending durability, follower access or stale clock never sends a transaction',async()=>{
  for(const mode of ['unregistered','unlinked','follower','expired','clock','save','flush','pending-storage']){
    const h=setup();if(mode==='unregistered')h.control.user=null;if(mode==='unlinked'){h.control.status.linked=false;h.c.syncAccess.linked=false;}
    if(mode==='follower'){h.control.status.writable=false;h.c.syncAccess.writable=false;}if(mode==='expired')h.c.syncAccess.leaseExpiresAt=new Date(Date.now()-1).toISOString();if(mode==='clock')h.control.clockReady=false;
    if(mode==='save')h.c.saveEnabled=false;if(mode==='flush')h.control.onFlush=async()=>({ok:false});if(mode==='pending-storage')h.control.onFlush=async()=>{h.control.storageError=true;return{ok:true};};
    await assert.rejects(h.c.requestTrade('/trades',{data:proposal}));assert.equal(h.posts.length,0,mode);assert.equal(h.c.fieldActionPending,false);assert.equal(records(h).length,0);
  }
});

await test('response loss persists the exact offer across reload, key order changes and new UI/device IDs',async()=>{
  const h=setup(),receipts=new Map();let executions=0;
  h.control.onPost=async call=>{executions++;receipts.set(call.options.data.requestId,{ok:true,revision:8,trade:{id:ID},receipt:{id:'one-escrow'}});throw Error('response lost');};
  await assert.rejects(h.c.requestTrade('/trades',{data:{...proposal,requestId:'original-intent'}}),/response lost/);
  const original=pending(h);assert.equal(original.requestId,'original-intent');assert.deepEqual(original.payload.offer,proposal.offer);assert.equal(h.control.refreshes,1);
  const resumed=setup({stored:h.stored});resumed.control.status.revision=22;resumed.control.deviceId='reopened-tab';
  resumed.control.onPost=async call=>{assert.equal(call.options.data.expectedRevision,22);assert.equal(call.options.data.deviceId,'reopened-tab');const result=receipts.get(call.options.data.requestId);if(!result)executions++;return result||{ok:true,revision:23};};
  const result=await resumed.c.requestTrade('/trades',{data:{want:{magatama:3,rice:70},offer:{wood:20,gold:100},targetPlayerId:'player-b',requestId:'replacement-ui'}});
  assert.equal(result.receipt.id,'one-escrow');assert.equal(executions,1);assert.equal(resumed.posts[0].options.data.requestId,original.requestId);assert.equal(records(resumed).length,0);
});

await test('each semantic proposal and trade action has its own persistent retry key',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Error('uncertain response');};
  for(const [route,data]of [['/trades',proposal],['/trades',{...proposal,want:{rice:71}}],['/trades',{...proposal,targetPlayerId:'player-c'}],['/trades/'+ID+'/accept',{}],['/trades/'+ID+'/reject',{}],['/trades/'+OTHER_ID+'/claim',{}]])await assert.rejects(h.c.requestTrade(route,{data}),/uncertain response/);
  assert.equal(records(h).length,6);assert.equal(new Set(h.posts.map(call=>call.options.data.requestId)).size,6);
  const expected=h.posts.find(call=>call.route==='/trades/'+ID+'/accept').options.data.requestId;
  h.control.onPost=async call=>({ok:true,revision:7,trade:{id:ID},receipt:{id:call.options.data.requestId}});
  const result=await h.c.requestTrade('/trades/'+ID+'/accept',{data:{requestId:'new-ui'}});assert.equal(result.receipt.id,expected);assert.equal(records(h).length,5);
});

await test('all state transitions require a confirmed response revision before clearing their durable key',async()=>{
  for(const route of ['/trades','/trades/'+ID+'/accept','/trades/'+ID+'/cancel','/trades/'+ID+'/reject','/trades/'+ID+'/claim']){
    for(const mode of ['stale','offline','missing-revision']){
      const h=setup(),data=route==='/trades'?proposal:{};
      h.control.onPost=async()=>({ok:true,...(mode==='missing-revision'?{}:{revision:10}),trade:{id:ID},receipt:{id:'committed'}});h.control.onRefresh=async()=>({ok:mode!=='offline'});
      await assert.rejects(h.c.requestTrade(route,{data}),error=>error.code==='TRADE_RECONCILE_PENDING');
      const key=pending(h).requestId;assert.equal(pending(h).committed,true);assert.equal(h.c.fieldActionPending,false);
      h.control.onPost=async()=>{throw Object.assign(Error('reconnect required'),{status:403});};
      await assert.rejects(h.c.requestTrade(route,{data}),/reconnect required/);assert.equal(pending(h).requestId,key,'Post-commit rejection cannot retire an uncertain monetary operation');
    }
  }
});

await test('definitive uncommitted conflicts retire only their own key and retain other unresolved offers',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Error('response lost');};await assert.rejects(h.c.requestTrade('/trades',{data:proposal}));const original=records(h)[0];
  h.control.onPost=async()=>{throw Object.assign(Error('trade was cancelled'),{status:409,code:'TRADE_CLOSED'});};
  await assert.rejects(h.c.requestTrade('/trades/'+ID+'/accept',{data:{}}),/trade was cancelled/);assert.deepEqual(records(h),[original]);assert.equal(h.c.fieldActionPending,false);
});

await test('identity changes at every await boundary cannot send or apply another lord’s result',async()=>{
  for(const stage of ['clock','flush','response','refresh']){
    const h=setup(),switchUser=()=>{h.control.user={id:'player-new',name:'別の領主'};h.control.deviceId='new-lord-tab';};
    if(stage==='clock')h.control.onClock=async()=>{switchUser();return{ok:true};};if(stage==='flush')h.control.onFlush=async()=>{switchUser();return{ok:true};};
    h.control.onPost=async()=>{if(stage==='response')switchUser();return{ok:true,revision:7,trade:{id:ID},receipt:{id:'old-owner'},clock:h.control.clock};};
    if(stage==='refresh')h.control.onRefresh=async()=>{switchUser();return{ok:true};};
    await assert.rejects(h.c.requestTrade('/trades',{data:proposal}),error=>error.code==='STALE_IDENTITY');assert.equal(h.c.fieldActionPending,false);assert.equal(h.posts.length,['clock','flush'].includes(stage)?0:1);
    if(stage==='response')assert.equal(h.acceptedClocks.length,0);if(['clock','flush'].includes(stage))assert.equal(records(h).length,0);
  }
});

await test('a new identity cannot reuse an old identity’s matching semantic pending proposal',async()=>{
  const h=setup();h.control.onPost=async()=>{throw Error('response lost');};await assert.rejects(h.c.requestTrade('/trades',{data:proposal}));const old=records(h)[0],oldId=pending(h).requestId;
  h.control.user={id:'player-new',name:'新領主'};h.control.deviceId='new-tab';h.control.onPost=async call=>({ok:true,revision:7,trade:{id:OTHER_ID},receipt:{id:call.options.data.requestId}});
  await h.c.requestTrade('/trades',{data:proposal});assert.notEqual(h.posts.at(-1).options.data.requestId,oldId);assert.deepEqual(records(h),[old]);
});

await test('claim applies only the canonical synced save while preserving army, governors and queued construction',async()=>{
  const h=setup(),s=h.c.game.state,gate=deferred();s.governors.farm=s.officers.find(id=>!s.army.includes(id));s.buildings.farm=5;s.jobs.push({kind:'building',id:'farm',targetLevel:6,total:1,remaining:1,totalSeconds:60,remainingSeconds:60});
  const preserved=state=>clone(Object.fromEntries(['home','cycle','army','governors','buildings','jobs','officers','officerVariants','walking'].map(key=>[key,state[key]])));
  const before=preserved(s),gold=s.resources.gold,remote=JSON.parse(h.c.game.exportSave());remote.state.resources.gold+=77;
  h.control.onPost=async()=>({ok:true,revision:9,trade:{id:ID,status:'accepted'},receipt:{id:'claim-once'}});
  h.control.onRefresh=async()=>{if(h.control.refreshes===1)return{ok:true};await gate.promise;assert.equal(h.c.applyCloudSave(remote,{isAdmin:false,isStaff:false}).ok,true);h.control.status.revision=9;return{ok:true};};
  const task=h.c.requestTrade('/trades/'+ID+'/claim',{data:{}});await until(()=>h.control.refreshes===2);assert.equal(h.c.game.state.resources.gold,gold);assert.equal(h.c.canMutate(),false);
  gate.resolve();await task;assert.equal(h.c.game.state.resources.gold,gold+77);assert.deepEqual(preserved(h.c.game.state),before);assert.deepEqual(preserved(JSON.parse(h.stored.get('save')).state),before);assert.equal(records(h).length,0);
});

await test('late lease loss during flush never posts, and retry resumes only after the writer is ready',async()=>{
  const h=setup();h.control.onFlush=async()=>{h.control.status.writable=false;return{ok:true};};
  await assert.rejects(h.c.requestTrade('/trades/'+ID+'/claim',{data:{}}));assert.equal(h.posts.length,0);assert.equal(records(h).length,0);assert.equal(h.c.fieldActionPending,false);
  h.control.status.writable=true;h.control.onFlush=async()=>({ok:true});await h.c.requestTrade('/trades/'+ID+'/claim',{data:{}});assert.equal(h.posts.length,1);
});

console.log(`${checks} trade transaction bridge scenarios passed with real application helpers; no live network requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
