const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {setup:domSetup}=require('./helpers/dom-model.cjs');
global.SengokuTravel=require('../travel.js');
global.SengokuTravelUI=require('../travel-ui.js');
const {createController,parseDate,inputDate,operationCard,policyView,unitsView,unitJourney,unitCanClaim}=require('../alliance.js');
const now=Date.parse('2026-11-22T03:00:00Z');
const context=()=>({playerId:'u_one',epoch:1,guildId:'g_one'});
const data=()=>({ok:true,serverNow:now,guild:{id:'g_one',name:'同盟',role:'member'},policy:{joinMode:'approval',description:'参加歓迎',activity:'20時〜',withdrawRole:'officers',dailyLimit:100000000,approvalThreshold:500,newcomerHours:24,revision:1},operations:[],members:[],units:[],directory:[],applications:[],withdrawals:[],contributions:[]});
const store=()=>{const values=new Map();return{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k),values};};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
 await test('unauthenticated context never loads alliance data',async()=>{
  let calls=0;const c=createController({getContext:()=>({}),request:()=>{calls++;}});
  assert.equal(await c.load(),false);assert.equal(calls,0);assert.match(c.snapshot().error,/領主を登録/);c.dispose();
 });
 await test('JST dates remain correct independent of browser timezone',async()=>{
  assert.equal(inputDate(now),'2026-11-22T12:00');assert.equal(parseDate('2026-11-22T12:00'),now);
  assert.equal(parseDate('2026-12-01T00:00'),Date.parse('2026-11-30T15:00:00Z'));
 });
 await test('an uncertain mutation keeps the same request on retry and browser reopen',async()=>{
  const storage=store(),sent=[];let failure=true;
  const options={getContext:context,storage,request:async()=>data(),mutate:async(route,b)=>{sent.push({route,data:JSON.parse(JSON.stringify(b))});if(failure)throw Error('通信切断');return{ok:true,result:{message:'帰還しました'}};}};
  const c=createController(options);await c.load();assert.equal(await c.send('/alliance/units/claim',{unitId:'au_one'}),false);
  const requestId=c.snapshot().pending.data.requestId;
  assert.equal(await c.send('/alliance/units/claim',{unitId:'au_two'}),false);assert.equal(sent.length,1,'pending same-route intent must not become a different transfer');
  c.dispose();failure=false;
  const restored=createController(options);await restored.load();assert.equal(restored.snapshot().pending.data.requestId,requestId);
  assert.equal(await restored.retry(),true);assert.deepEqual(sent[0],sent[1]);assert.equal(restored.snapshot().pending,null);assert.equal(storage.values.size,0);restored.dispose();
 });
 await test('fresh API conflicts clear an uncommitted intent, allowing correction',async()=>{
  const storage=store();let status=409,calls=0;
  const c=createController({getContext:context,storage,request:async()=>data(),mutate:async()=>{calls++;throw Object.assign(Error('収容力が足りません'),{status});}});
  await c.load();assert.equal(await c.send('/alliance/units/claim',{unitId:'au_one'}),false);assert.equal(c.snapshot().pending,null);assert.equal(storage.values.size,0);
  status=403;await c.send('/alliance/policy',{revision:0});assert.equal(c.snapshot().pending,null);assert.equal(calls,2);c.dispose();
 });
 await test('late data and target requests are discarded on membership changes',async()=>{
  let identity=context();const response=deferred(),target=deferred();
  const c=createController({getContext:()=>identity,request:()=>response.promise,readField:()=>target.promise,storage:store()});
  const loading=c.load(),targets=c.loadTargets();identity={playerId:'u_two',epoch:2,guildId:'g_two'};
  response.resolve(data());target.resolve({targets:[{playerId:'private-target'}]});
  assert.equal(await loading,false);assert.equal(await targets,false);assert.equal(c.snapshot().data,null);assert.deepEqual(c.snapshot().targets,[]);c.dispose();
 });
 await test('an old account mutation cannot publish data or block a new account',async()=>{
  let identity=context(),calls=0;const old=deferred(),storage=store();
  const c=createController({getContext:()=>identity,request:async()=>data(),storage,mutate:async()=>{if(++calls===1)return old.promise;return{ok:true};}});
  const pending=c.send('/alliance/units/claim',{unitId:'au_old'});identity={playerId:'u_new',epoch:2,guildId:'g_new'};
  assert.equal(c.snapshot().sending,false);assert.equal(c.snapshot().pending,null);
  assert.equal(await c.send('/alliance/units/claim',{unitId:'au_new'}),true);
  old.resolve({ok:true,result:{message:'旧アカウントの内容'}});assert.equal(await pending,false);
  assert(!c.snapshot().message.includes('旧アカウント'));assert.equal(c.snapshot().pending,null);c.dispose();
 });
 await test('a slow background read cannot overwrite the post-commit refresh',async()=>{
  let reads=0;const stale=deferred(),latest=data();latest.guild.name='新しい同盟状態';
  const c=createController({getContext:context,storage:store(),request:async()=>{reads++;return reads===2?stale.promise:reads>=3?latest:data();},mutate:async()=>({ok:true})});
  await c.load();const loading=c.load();assert.equal(await c.send('/alliance/operations/rsvp',{operationId:'ao_one',response:'yes'}),true);
  stale.resolve(data());assert.equal(await loading,false);assert.equal(c.snapshot().data.guild.name,'新しい同盟状態');c.dispose();
 });
 await test('storage failure never sends a nonrecoverable asset mutation',async()=>{
  let writes=0;const c=createController({getContext:context,storage:{setItem(){throw Error('full');},getItem(){return null;}},request:async()=>data(),mutate:async()=>{writes++;}});
  assert.equal(await c.send('/alliance/rally/join',{operationId:'ao_one',troops:1000}),false);assert.equal(writes,0);assert.match(c.snapshot().error,/保存/);c.dispose();
 });
 await test('private plan cards escape names and only show authorized assignment controls',async()=>{
  const d=data();d.members=[{id:'u_two',name:'<img src=x onerror=alert(1)>'}];
  const op={id:'ao_one',title:'<script>alert(1)</script>',note:'安全な表示',kind:'attack',creatorId:'u_other',startsAt:now,expiresAt:now+60000,status:'planned',castleName:'大坂城',castleId:'osaka',branchId:'osaka_east',troops:1000,assignments:[{id:'task_1',playerId:'u_two',label:'<b>東門</b>',done:false}],rsvps:[],result:null};
  const html=operationCard(op,d,{id:'u_one'});assert(!html.includes('<script>'));assert(!html.includes('<img'));assert(html.includes('&lt;script&gt;'));assert(html.includes('東支拠点'));
  assert(!html.includes('data-alliance="launch"'));assert(!html.includes('data-alliance="task"'));assert(!html.includes('data-alliance-form="assignment"'));
  assert(operationCard(op,d,{id:'u_two'}).includes('data-alliance="task"'));
  d.guild.role='owner';const owner=operationCard(op,d,{id:'u_one'});assert(owner.includes('data-alliance="launch"'));assert(owner.includes('data-alliance-form="assignment"'));
  assert(policyView(d,{id:'u_one'}).includes('max="100000000"'));
  d.guild.role='member';assert(!policyView(d,{id:'u_one'}).includes('data-alliance-form="policy"'));
 });
 await test('aid and rally units show travel and cannot be claimed until authoritative return arrival',()=>{
  const d=data(),route=global.SengokuTravel.plan({sourceCastleId:'kiyosu',targetCastleId:'odawara'});d.clock={elapsedMs:1000,running:true};
  const unit={id:'au_trip',ownerId:'u_one',targetPlayerId:'u_two',targetName:'仲間',castleId:'odawara',castleName:'小田原城',kind:'aid',state:'outbound',phase:'outbound',travel:route,departedElapsedMs:1000,arrivesElapsedMs:1000+route.durationMs,remainingMs:route.durationMs,canClaim:false,troops:600,expiresAt:now+3600000};d.units=[unit];
  let html=unitsView(d,{id:'u_one'});assert.match(html,/援軍先へ移動中/);assert.match(html,/到着まで/);assert(!html.includes('data-alliance="claim"'));assert(html.includes('data-alliance="recall"'));assert.equal(unitJourney(unit).travel.sourceCastleId,'kiyosu');
  const back=global.SengokuTravel.plan({sourceCastleId:'odawara',targetCastleId:'kiyosu'});Object.assign(unit,{phase:'returning',state:'returning',travel:back});html=unitsView(d,{id:'u_one'});assert.match(html,/帰還中/);assert.match(html,/帰還まで/);assert(!html.includes('data-alliance="claim"'));assert.equal(unitCanClaim(unit),false);
  d.clock.elapsedMs=unit.arrivesElapsedMs+1;html=unitsView(d,{id:'u_one'});assert.match(html,/帰還を確認中/);assert(!html.includes('data-alliance="claim"'),'a client clock cannot settle an arrival');
  Object.assign(unit,{phase:null,canClaim:true});html=unitsView(d,{id:'u_one'});assert(html.includes('data-alliance="claim"'));assert.equal(unitCanClaim(unit),true);
  Object.assign(unit,{phase:'outbound',state:'outbound',kind:'rally',canClaim:false});assert.match(unitsView(d,{id:'u_one'}),/集結地点へ移動中/);
  const legacy={state:'returning'};assert.equal(unitCanClaim(legacy),true);assert.equal(unitCanClaim({...legacy,canClaim:false}),false);
 });
 await test('gathering preview uses the fixed rally origin and reports soldiers still in transit',()=>{
  const d=data(),op={id:'ao_trip',title:'集結',note:'',kind:'attack',creatorId:'u_one',stagingCastleId:'edo',castleId:'odawara',castleName:'小田原城',startsAt:now,expiresAt:now+600000,status:'planned',troops:300,travelingTroops:700,assignments:[],rsvps:[]};
  const html=operationCard(op,d,{id:'u_one'},{game:{state:{home:'kiyosu'}}});assert.match(html,/移動中 700人/);assert.match(html,/集結地点へ到着してから/);assert.match(html,/江戸城/);assert.match(html,/清洲城/);
 });
 await test('mounted alliance countdown updates each second without rebuilding an edited form',async()=>{
  const {host,doc}=domSetup(),timers=[],d=data(),route=global.SengokuTravel.plan({sourceCastleId:'kiyosu',targetCastleId:'odawara'});let elapsed=1000;
  d.units=[{id:'au_timer',ownerId:'u_one',kind:'aid',state:'outbound',phase:'outbound',travel:route,departedElapsedMs:1000,arrivesElapsedMs:1000+route.durationMs,remainingMs:route.durationMs,troops:400,expiresAt:now+3600000}];
  const window={document:doc,SengokuStableDOM:require('../stable-dom.js'),SengokuTravel:global.SengokuTravel,SengokuTravelUI:global.SengokuTravelUI,SengokuWorldClock:{snapshot:()=>({clock:{elapsedMs:elapsed,running:true}})},setInterval:fn=>{timers.push(fn);return timers.length;},clearInterval:()=>{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../alliance.js'),'utf8'),{window,Intl,Date,FormData,Map,Set,Number,String,Object,Math,JSON});
  const mounted=window.SengokuAlliance.mount(host,{getContext:context,storage:store(),request:async()=>d,getGame:()=>({state:{home:'kiyosu'}})});for(let i=0;i<30;i++)await Promise.resolve();
  host.querySelector('[data-alliance="tab"][data-id="units"]').dispatchEvent({type:'click'});
  const counter=host.querySelector('[data-alliance-unit-countdown]'),input=host.querySelector('input[name="troops"]');assert(counter);assert(input);const before=counter.textContent;input.focus();input.value='735';host.scrollTop=250;
  elapsed+=1000;timers[0]();assert.strictEqual(host.querySelector('[data-alliance-unit-countdown]'),counter);assert.notEqual(counter.textContent,before);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'735');assert.equal(host.scrollTop,250);mounted.destroy();
 });
 console.log('Alliance browser: '+count+' scenarios passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
