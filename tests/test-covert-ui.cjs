/* Private dispatch controller: real engine, isolated persistence, no live API. */
'use strict';
const assert=require('node:assert/strict');
global.SengokuTravel=require('../travel.js');
global.SengokuTravelUI=require('../travel-ui.js');
const {SengokuEngine:E}=require('../engine.js');
const {createController,markup,cleanSnapshot,cleanReceipt,targetKey}=require('../covert.js');
const clone=value=>JSON.parse(JSON.stringify(value));
function storage(){const values=new Map();return{values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function until(condition){for(let i=0;i<80;i++){if(condition())return;await Promise.resolve();}assert(condition(),'async checkpoint');}
function setup(extra={}){
 let game=extra.game||new E({isAdmin:true,seed:25}),status={ownerId:'lord-a',linked:false,online:true,writable:true,readable:true,stamp:'one',...extra.status},calls=0,id=0,resultCount=0;
 const store=extra.storage||storage(),requests=[];let hook,loadHook;
 const options={getGame:()=>game,getStatus:()=>status,storage:store,now:extra.now,onChange:extra.onChange,uuid:()=>`covert-ui-${++id}`,load:async cursor=>loadHook?loadHook(cursor):{ok:true,covert:game.covertStatus()},mutate:async(action,data)=>{
  calls++;requests.push({action,data:clone(data)});assert([...store.values.values()].some(value=>JSON.parse(value).data.requestId===data.requestId),'intent is durable before sending');
  if(hook)return hook(action,data);
  return execute(action,data);
 },onResult:()=>resultCount++};
 function execute(action,data){const r=action==='hire'?game.hireCovert(data.sourceCastleId,data.count,data):action==='dispatch'?game.departCovertDispatch(data.sourceCastleId,data.target,data.count,data.mode,data):action==='recall'?game.recallCovert(data.stationId,data):game.retaliateCovert(data.stationId,data.incidentId,data);return{...r,covert:game.covertStatus()};}
 const controller=createController(options);
 return{controller,options,store,requests,execute,get game(){return game;},set game(value){game=value;},get status(){return status;},set status(value){status=value;},set hook(value){hook=value;},set loadHook(value){loadHook=value;},get calls(){return calls;},get resultCount(){return resultCount;}};
}
const tests=[],test=(name,fn)=>tests.push([name,fn]);
async function hire(h,count=20){h.controller.update('hireInput',count);assert(h.controller.prepare('hire'));assert(await h.controller.submit());return h.controller.snapshot();}
function advanceDispatch(h){const arrival=h.game.state.covert.dispatches[0]?.arrivesElapsedMs;assert(Number.isFinite(arrival));h.game.state.turn=Math.floor(arrival/60000);h.game.state.realtime.elapsed=arrival%60000/1000;h.game.settleCovertDue();h.controller.refresh();}
async function station(h,count=10){await hire(h,count);h.controller.update('targetId',targetKey(h.controller.snapshot().covert.targets.find(t=>t.castleId==='odawara')));h.controller.update('mode','station');h.controller.update('countInput',count);assert(h.controller.prepare('dispatch'));assert(await h.controller.submit());assert.equal(h.controller.snapshot().stations.length,0);advanceDispatch(h);return h.controller.snapshot().stations[0];}

test('owned major-city sources expose exact ninja costs and all 129 destinations',()=>{
 const h=setup(),s=h.controller.snapshot();assert.equal(s.source.castleId,'edo');assert.equal(s.source.unitName,'忍者');assert.deepEqual(s.hirePreview.costs,{gold:30,rice:20,command:1});assert.equal(s.totalTargets,129);assert.equal(s.targets.length,12);assert.equal(s.pages,11);
 const ordinary=setup({game:new E({seed:1})});assert.equal(ordinary.controller.snapshot().source,undefined);const html=markup(ordinary.controller.snapshot());assert.match(html,/大都市拠点の確保が必要/);assert.match(html,/data-view="map"/);assert.doesNotMatch(html,/data-covert-action="prepare-hire"/);assert.doesNotMatch(html,/運営|スタッフ|isAdmin|isStaff/);
 h.game.state.castles.nijo.owner=h.game.state.clan;h.controller.refresh();assert(h.controller.update('sourceId','nijo'));assert.equal(h.controller.snapshot().source.unitName,'足軽');assert.deepEqual(h.controller.snapshot().hirePreview.costs,{gold:10,rice:10,command:1});
});

test('recruitment validates amounts, paid costs and capacity before a confirmed write',async()=>{
 const h=setup(),start=clone(h.game.state);for(const value of ['','0','-1','1.5','20001','Infinity']){h.controller.update('hireInput',value);assert.equal(h.controller.prepare('hire'),false);assert.equal(h.calls,0);}
 h.controller.update('hireInput','20');assert(h.controller.prepare('hire'));assert.equal(h.game.state.command,start.command);assert(await h.controller.submit());assert.equal(h.calls,1);assert.equal(h.game.state.covert.reserves.edo,20);assert.equal(h.game.state.resources.gold,start.resources.gold-60);assert.equal(h.game.state.resources.rice,start.resources.rice-40);assert.equal(h.store.values.size,0);assert.equal(h.resultCount,1);
 h.controller.update('hireInput',h.game.covertStatus().sources[0].capacity);assert.equal(h.controller.prepare('hire'),false);
});

test('all destinations remain searchable and selectable through pagination and filters',()=>{
 const h=setup();h.controller.setPage(11);assert(h.controller.snapshot().targets.length>0);const last=h.controller.snapshot().targets.at(-1);assert(h.controller.update('targetId',targetKey(last)));assert.equal(h.controller.snapshot().target.castleId,last.castleId);
 h.controller.update('query','名古屋');assert.equal(h.controller.snapshot().page,1);assert.equal(h.controller.snapshot().targetCount,1);h.controller.update('filter','player');assert.equal(h.controller.snapshot().targetCount,0);assert.match(markup(h.controller.snapshot()),/交流から領主を登録/);
 h.controller.update('query','');h.controller.update('filter','castle');assert.equal(h.controller.snapshot().targetCount,129);h.controller.update('sort','owner');assert.equal(h.controller.snapshot().targetCount,129);
});

test('scouting shows round-trip time, reports on arrival and waits for the return before reuse',async()=>{
 const h=setup();await hire(h,12);h.controller.update('countInput','12');h.controller.update('targetId',targetKey(h.controller.snapshot().covert.targets.find(t=>t.castleId==='nagoya')));assert(h.controller.prepare('dispatch'));const preview=h.controller.snapshot().confirmation;assert.deepEqual(preview.costs,{gold:0,rice:23,command:1});const before=h.game.state.resources.rice;assert(preview.travel);assert(preview.returnTravel);assert.match(markup(h.controller.snapshot()),/往復合計/);assert(await h.controller.submit());assert.equal(h.controller.snapshot().source.reserve,0);assert.equal(h.controller.snapshot().covert.reports.length,0);advanceDispatch(h);let s=h.controller.snapshot();assert.equal(s.covert.reports.length,1);assert.equal(s.covert.stations.length,0);assert.equal(s.source.reserve,0);assert.equal(s.covert.dispatches[0].phase,'returning');assert.equal(s.covert.dispatches[0].sourceCastleId,'nagoya');assert.match(markup(s),/帰還中/);assert.match(markup(s),/帰還まで/);assert.equal(h.controller.prepare('dispatch'),false);advanceDispatch(h);s=h.controller.snapshot();assert.equal(s.source.reserve,12);assert.equal(s.covert.dispatches.length,0);assert.equal(s.receipt.accepted,false);assert.equal(h.game.state.resources.rice,before-23);assert.match(markup(s),/調査と帰還を完了/);assert.equal(s.covert.reports[0].target.castleId,'nagoya');
});

test('stationing moves reserve, requires a later eligible incident, and recalls free with zero commands',async()=>{
 const h=setup(),st=await station(h,8);assert.equal(h.controller.snapshot().source.reserve,0);assert.equal(h.controller.snapshot().source.stationed,8);assert.equal(h.controller.prepare('retaliate',{stationId:st.id}),false);
 h.game.state.command=0;h.controller.refresh();assert(h.controller.prepare('recall',{stationId:st.id}));assert.deepEqual(h.controller.snapshot().confirmation.costs,{gold:0,rice:0,command:0});const trip=h.controller.snapshot().confirmation.travel;assert.equal(trip.sourceCastleId,'odawara');assert.equal(trip.targetCastleId,'edo');assert(await h.controller.submit());assert.equal(h.controller.snapshot().source.reserve,0);assert.equal(h.controller.snapshot().stations.length,0);assert.equal(h.controller.snapshot().covert.dispatches[0].phase,'returning');assert.match(h.controller.snapshot().message,/帰還中/);advanceDispatch(h);assert.equal(h.controller.snapshot().source.reserve,8);
});

test('a recall response loss keeps the same return and replays its arrival without adding troops twice',async()=>{
 const h=setup(),st=await station(h,10);h.game.state.command=0;h.controller.refresh();
 h.hook=async(action,data)=>{h.execute(action,data);throw Error('lost recall response');};
 assert(h.controller.prepare('recall',{stationId:st.id}));assert.equal(await h.controller.submit(),false);const original=h.controller.snapshot().pending.data.requestId;
 assert.equal(h.game.state.covert.reserves.edo,0);assert.equal(h.game.state.covert.dispatches.length,1);assert.equal(h.game.state.covert.stations.length,0);
 advanceDispatch(h);assert.equal(h.game.state.covert.reserves.edo,10);const sequence=h.game.state.covert.sequence;
 h.hook=async(action,data)=>{assert.equal(data.requestId,original);return h.execute(action,data);};assert.equal(await h.controller.submit(),true,h.controller.snapshot().error);
 assert.equal(h.game.state.covert.sequence,sequence);assert.equal(h.game.state.covert.reserves.edo,10);assert.equal(h.controller.snapshot().pending,null);assert.equal(h.store.values.size,0);assert.equal(h.controller.snapshot().receipt.accepted,false);
});

test('recall receipt rejects an outbound phase or a mismatched return route',async()=>{
 for(const changed of ['phase','route']){const h=setup(),st=await station(h,6);h.hook=async(action,data)=>{const response=h.execute(action,data);if(changed==='phase')response.result.march.phase='outbound';else response.result.march.travel=global.SengokuTravel.plan({sourceCastleId:'edo',targetCastleId:'odawara'});return response;};assert(h.controller.prepare('recall',{stationId:st.id}));assert.equal(await h.controller.submit(),false);assert(h.controller.snapshot().pending);assert.equal(h.game.state.covert.reserves.edo,0);}
});

test('station eligibility honors server stationIds and never enables retroactive counterattacks',async()=>{
 const h=setup(),st=await station(h,10);h.game.state.command=4;const value=h.game.covertStatus();value.incidents=[{id:'incident-old',sourceCastleId:'edo',kind:'field',occurredElapsedMs:st.createdElapsedMs,available:true,stationIds:['different-station'],expiresElapsedMs:null}];
 h.status={...h.status,linked:true,stamp:'online'};h.loadHook=async()=>({ok:true,covert:value});await h.controller.reload();assert.equal(h.controller.snapshot().stations[0].incidents.length,0);assert.equal(h.controller.prepare('retaliate',{stationId:st.id}),false);
 value.incidents[0].stationIds=[st.id];await h.controller.reload();assert.equal(h.controller.snapshot().stations[0].incidents.length,1);assert(h.controller.prepare('retaliate',{stationId:st.id}));assert.deepEqual(h.controller.snapshot().confirmation.data,{stationId:st.id,incidentId:'incident-old'});
});

test('Kyoto-origin retaliation at Edo uses the private Emperor or Regent capability while scouting and stationing remain available',async()=>{
 const h=setup(),st=await station(h,10);h.game.state.command=10;const value=h.game.covertStatus(),source=value.sources[0];source.castleId='kyoto_gosho';source.name='京都御所';source.reserve=20;source.unitType='ashigaru';source.unitName='足軽';value.stations[0].sourceCastleId='kyoto_gosho';value.stations[0].target={kind:'player',playerId:'operator',castleId:'edo',name:'江戸城',playerName:'領主'};value.incidents=[{id:'incident-kyoto',sourceCastleId:'kyoto_gosho',kind:'field',occurredElapsedMs:st.createdElapsedMs,available:true,stationIds:[st.id],expiresElapsedMs:null}];value.rules.canAttackEdoFromKyoto=false;
 h.status={...h.status,linked:true,stamp:'online'};h.loadHook=async()=>({ok:true,covert:value});await h.controller.reload();h.controller.update('sourceId','kyoto_gosho');h.controller.update('targetId',targetKey(value.targets.find(t=>t.castleId==='edo')));h.controller.update('countInput','5');
 for(const mode of ['scout','station']){h.controller.update('mode',mode);assert(h.controller.prepare('dispatch'));h.controller.cancel();}
 assert.equal(h.controller.prepare('retaliate',{stationId:st.id}),false);assert.match(h.controller.snapshot().stations[0].retaliatePreview.message,/在任中の天皇または摂政/);assert(h.controller.prepare('recall',{stationId:st.id}));h.controller.cancel();
 value.rules.canAttackEdoFromKyoto=true;await h.controller.reload();assert(h.controller.prepare('retaliate',{stationId:st.id}));h.controller.cancel();value.rules.canAttackEdoFromKyoto=false;value.stations[0].target.castleId='odawara';await h.controller.reload();assert(h.controller.prepare('retaliate',{stationId:st.id}));
});

test('a Kyoto Regent without the Emperor role can prepare retaliation and loses that permission on dismissal',async()=>{
 const game=new E({isStaff:true,isCourtRegent:true,seed:26}),h=setup({game});game.state.resources.gold=1000;game.state.resources.rice=1000;game.state.command=10;
 const buildings=clone(game.state.buildings);assert(game.applyStaffBase({id:'kyoto_gosho',revision:1,castleLevel:1,buildings,initial:{castleLevel:1,buildings},history:[],jobs:[]}).ok);
 assert.equal(game.isCourtEmperor,false);assert.equal(game.isCourtRegent,true);assert.equal(h.controller.snapshot().source.castleId,'kyoto_gosho');
 await hire(h,10);h.controller.update('targetId',targetKey(h.controller.snapshot().covert.targets.find(t=>t.castleId==='edo')));h.controller.update('mode','station');h.controller.update('countInput','10');assert(h.controller.prepare('dispatch'));assert(await h.controller.submit());advanceDispatch(h);
 const st=h.controller.snapshot().stations[0];assert.equal(st.sourceCastleId,'kyoto_gosho');assert.equal(st.target.castleId,'edo');game.state.command=10;game._recordCovertIncident('kyoto_gosho','edo');h.controller.refresh();
 assert.equal(h.controller.snapshot().covert.rules.canAttackEdoFromKyoto,true);assert.equal(h.controller.snapshot().stations[0].retaliatePreview.ok,true);assert(h.controller.prepare('retaliate',{stationId:st.id}));assert.equal(h.controller.snapshot().confirmation.action,'retaliate');h.controller.cancel();
 assert(game.setCourtAccess({isCourtRegent:false}).ok);h.controller.refresh();assert.equal(h.controller.snapshot().covert.rules.canAttackEdoFromKyoto,false);assert.equal(h.controller.prepare('retaliate',{stationId:st.id}),false);assert.match(h.controller.snapshot().stations[0].retaliatePreview.message,/在任中の天皇または摂政/);assert(h.controller.prepare('recall',{stationId:st.id}));assert.equal(h.calls,2,'reviewing and revoking retaliation never submits an attack');
});

test('a lost source disables new hire and dispatch while existing forces can return',async()=>{
 const h=setup(),st=await station(h,10);h.game.state.castles.edo.owner='他勢力';h.game.state.command=0;h.controller.refresh();const s=h.controller.snapshot();assert.equal(s.source,undefined);assert.match(markup(s),/大都市拠点の確保が必要/);assert.equal(h.controller.prepare('hire'),false);assert(h.controller.prepare('recall',{stationId:st.id}));assert(await h.controller.submit());assert.equal(h.game.state.covert.reserves.edo,0);advanceDispatch(h);assert.equal(h.game.state.covert.reserves.edo,10);
});

test('a changed sequence invalidates a prepared operation without a write',async()=>{
 const h=setup();assert(h.controller.prepare('hire'));h.game.hireCovert('edo',1,{requestId:'another-device'});h.controller.refresh();assert.equal(await h.controller.submit(),false);assert.equal(h.calls,0);assert.match(h.controller.snapshot().error,/状況が変わりました/);
});

test('uncertain result survives reopening and replays its original intent even after final command spent',async()=>{
 const h=setup();h.game.state.command=1;let committed;
 h.hook=async(action,data)=>{committed=h.execute(action,data);throw Error('response lost');};assert(h.controller.prepare('hire'));assert.equal(await h.controller.submit(),false);assert.equal(h.game.state.command,0);assert(h.controller.snapshot().pending);const requestId=h.requests[0].data.requestId;
 h.controller.dispose();const reopened=createController({...h.options,mutate:async(action,data)=>{assert.equal(data.requestId,requestId);return h.execute(action,data);}});
 assert(reopened.snapshot().pending);assert.equal(await reopened.submit(),true);assert.equal(reopened.snapshot().pending,null);assert.equal(h.game.state.covert.reserves.edo,10);assert.equal(h.game.state.covert.sequence,1);assert.equal(h.store.values.size,0);
});

test('timeout/rate-limit/server errors retain retry but definite validation rejection releases it',async()=>{
 for(const status of [401,403,408,429,500,400,409]){const h=setup();h.hook=async()=>{throw Object.assign(Error('rejected'),{status});};assert(h.controller.prepare('hire'));assert.equal(await h.controller.submit(),false);assert.equal(Boolean(h.controller.snapshot().pending),[401,403,408,429,500].includes(status),String(status));}
});

test('lost result followed by a client preflight 409 retains the original receipt lookup',async()=>{
 const h=setup();h.hook=async(action,data)=>{h.execute(action,data);throw Error('response lost');};assert(h.controller.prepare('hire'));assert.equal(await h.controller.submit(),false);const original=h.controller.snapshot().pending.data.requestId;
 h.hook=async()=>{throw Object.assign(Error('writer changed before HTTP'),{status:409,code:'COVERT_SYNC_REQUIRED',retryable:true});};assert.equal(await h.controller.submit(),false);assert.equal(h.controller.snapshot().pending.data.requestId,original);assert.equal(h.game.state.covert.reserves.edo,10);
 h.hook=async(action,data)=>{assert.equal(data.requestId,original);return h.execute(action,data);};assert.equal(await h.controller.submit(),true);assert.equal(h.game.state.covert.sequence,1);assert.equal(h.game.state.covert.reserves.edo,10);assert.equal(h.store.values.size,0);
});

test('malformed or mismatched successful receipts never clear the durable request',async()=>{
 for(const change of ['requestId','count','campaignId','foodCost']){const h=setup();h.hook=async(action,data)=>{const response=h.execute(action,data);response.result[change]=change==='count'?99:change==='foodCost'?-1:'wrong';return response;};assert(h.controller.prepare('hire'));assert.equal(await h.controller.submit(),false);assert(h.controller.snapshot().pending);assert.equal(h.resultCount,0);}
 const h=setup();h.hook=async(action,data)=>{const response=h.execute(action,{...data,requestId:'canonical-original'});return{...response,effectiveRequestId:'canonical-original'};};assert(h.controller.prepare('hire'));assert.equal(await h.controller.submit(),true);assert.equal(h.controller.snapshot().receipt.requestId,'canonical-original');
});

test('double activation coalesces and pending locks source/target edits',async()=>{
 const h=setup(),pause=deferred();h.hook=async(action,data)=>{await pause.promise;return h.execute(action,data);};assert(h.controller.prepare('hire'));const first=h.controller.submit(),second=h.controller.submit();await until(()=>h.calls===1);assert.equal(h.controller.update('hireInput','999'),false);assert.equal(h.controller.prepare('dispatch'),false);pause.resolve();assert.equal(await first,true);assert.equal(await second,true);assert.equal(h.calls,1);assert.equal(h.game.state.covert.sequence,1);
});

test('storage failure blocks writes before transmission',async()=>{
 const h=setup();h.store.setItem=()=>{throw Error('storage full');};assert(h.controller.prepare('hire'));assert.equal(await h.controller.submit(),false);assert.equal(h.calls,0);assert.equal(h.game.state.covert.sequence,0);assert.match(h.controller.snapshot().error,/storage full/);
});

test('account/campaign/dispose changes suppress an old result and keep its owner-scoped retry',async()=>{
 for(const change of ['owner','campaign','dispose']){const h=setup(),pause=deferred();h.hook=async(action,data)=>{const response=h.execute(action,data);await pause.promise;return response;};assert(h.controller.prepare('hire'));const task=h.controller.submit();await until(()=>h.calls===1);if(change==='owner')h.status={...h.status,ownerId:'lord-b',stamp:'two'};if(change==='campaign')h.game=new E({isAdmin:true,seed:4});if(change==='dispose')h.controller.dispose();else h.controller.refresh();pause.resolve();assert.equal(await task,false);assert.equal(h.resultCount,0);assert.equal(h.store.values.size,1);if(change!=='dispose'){assert.equal(h.controller.snapshot().receipt,null);assert.equal(h.controller.snapshot().pending,null);}}
});

test('registered target pagination drains all pages, deduplicates NPCs and searches later players',async()=>{
 const h=setup({status:{linked:true}}),first=h.game.covertStatus(),second=clone(first),cursors=[];
 first.targets.push({kind:'player',playerId:'lord-b',castleId:'nijo',name:'二条城',playerName:'先の領主'});first.targetCursor='lord-b';second.targets.push({kind:'player',playerId:'lord-c',castleId:'nagoya',name:'名古屋城',playerName:'最後の領主'});second.targetCursor=null;
 h.loadHook=async cursor=>{cursors.push(cursor);return{ok:true,covert:cursor?second:first};};assert.equal(await h.controller.reload(),true);assert.deepEqual(cursors,[undefined,'lord-b']);assert.equal(h.controller.snapshot().totalTargets,131);h.controller.update('query','最後の領主');assert.equal(h.controller.snapshot().targetCount,1);assert.equal(h.controller.snapshot().targets[0].playerId,'lord-c');
 const g=setup({game:h.game,status:{linked:true}});g.loadHook=async()=>({ok:true,covert:first});assert.equal(await g.controller.reload(),false);assert.equal(g.controller.snapshot().covert,null);assert.match(g.controller.snapshot().error,/続きを確認/);
});

test('read responses after identity change cannot leak private reports to the new player',async()=>{
 const h=setup({status:{linked:true}}),pause=deferred(),privateValue=h.game.covertStatus();h.loadHook=()=>pause.promise;const task=h.controller.reload();await Promise.resolve();h.status={...h.status,ownerId:'lord-new',readable:false,stamp:'new'};h.controller.refresh();pause.resolve({ok:true,covert:privateValue});assert.equal(await task,false);assert.equal(h.controller.snapshot().covert,null);
});

test('automatic refresh keeps an existing snapshot quiet while initial and requested reads show progress',async()=>{
 let time=1000,reads=0;const frames=[],h=setup({status:{linked:true},now:()=>time,onChange:s=>frames.push(s)}),initial=deferred();
 h.loadHook=()=>{reads++;return initial.promise;};h.controller.refresh();assert.equal(h.controller.snapshot().loading,true);assert.equal(h.controller.snapshot().covert,null);
 await until(()=>reads===1);initial.resolve({ok:true,covert:h.game.covertStatus()});await until(()=>!h.controller.snapshot().loading);const expected=markup(h.controller.snapshot());frames.length=0;
 const poll=deferred();h.loadHook=()=>{reads++;return poll.promise;};time+=45001;h.controller.refresh();await until(()=>reads===2);
 assert.equal(h.controller.snapshot().loading,false);assert.equal(markup(h.controller.snapshot()),expected);assert(frames.every(s=>!s.loading));assert.equal(h.calls,0);
 poll.resolve({ok:true,covert:h.game.covertStatus()});await until(()=>frames.length>=3);assert.equal(markup(h.controller.snapshot()),expected);assert(frames.every(s=>!s.loading));
 const manual=deferred();h.loadHook=()=>{reads++;return manual.promise;};const task=h.controller.reload();assert.equal(h.controller.snapshot().loading,true);await until(()=>reads===3);manual.resolve({ok:true,covert:h.game.covertStatus()});assert.equal(await task,true);assert.equal(h.controller.snapshot().loading,false);
 const pending=deferred();h.loadHook=()=>{reads++;return pending.promise;};time+=45001;h.controller.refresh();await until(()=>reads===4);const requested=h.controller.reload();assert.equal(h.controller.snapshot().loading,true);assert.equal(reads,4,'manual refresh coalesces the background read');pending.resolve({ok:true,covert:h.game.covertStatus()});assert.equal(await requested,true);assert.equal(h.controller.snapshot().loading,false);
});

test('markup escapes player-controlled names and uses genuine locked availability',()=>{
 const h=setup(),snapshot=h.controller.snapshot();snapshot.target={kind:'player',name:'<img src=x onerror=alert(1)>',playerName:'"<script>bad</script>'};snapshot.targets=[snapshot.target];snapshot.targetId=targetKey(snapshot.target);const html=markup(snapshot);assert.doesNotMatch(html,/<img src=x|<script>bad/);assert.match(html,/&lt;img/);assert.match(html,/aria-label="派遣部隊"/);
});

(async()=>{for(const[name,fn]of tests){await fn();console.log('PASS '+name);}console.log(tests.length+' covert UI scenarios passed; no live writes.');})().catch(error=>{console.error(error);process.exitCode=1;});
