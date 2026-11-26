'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:catalog}=require('../engine.js');
const Travel=require('../travel.js'),TravelUI=require('../travel-ui.js');
const allianceSource=fs.readFileSync(require.resolve('../alliance.js'),'utf8'),commandSource=fs.readFileSync(require.resolve('../command-center.js'),'utf8');
const clone=value=>JSON.parse(JSON.stringify(value));
const context=()=>({playerId:'u_self',epoch:1,accountEpoch:2,guildEpoch:3,privilegeEpoch:4,guildId:'g_one',guildRole:'member',pending:false,banned:false,user:{id:'u_self',guildId:'g_one',guildRole:'member',isBanned:false}});
const route=Travel.plan({sourceCastleId:'kiyosu',targetCastleId:'odawara'});
const unit=(extra={})=>({id:'au_self',ownerId:'u_self',ownerName:'自分',targetPlayerId:'u_other',targetName:'他領主名',kind:'aid',state:'outbound',phase:'outbound',travel:route,departedElapsedMs:1000,arrivesElapsedMs:1000+route.durationMs,remainingMs:route.durationMs,troops:300,marchId:null,...extra});
const payload=(units=[unit()],extra={})=>({ok:true,serverNow:1000000,clock:{elapsedMs:1000,running:true,speed:1},guild:{id:'g_one',name:'同盟',role:'member'},units,operations:[],members:[],directory:[],applications:[],withdrawals:[],contributions:[],...extra});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
function harness(){
  let current=context(),game=new Engine({seed:12,clan:'織田家'}),data=payload(),reads=0,writes=0,reader=null,writer=null;
  const storage=new Map(),saved={getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)};
  const win={SengokuTravel:Travel,SengokuTravelUI:TravelUI,SENGOKU_DATA:catalog,crypto:{randomUUID:()=> 'request_one'},SengokuSocial:{getExpansionContext:()=>current}};
  vm.runInNewContext(allianceSource,{window:win});vm.runInNewContext(commandSource,{window:win});
  const options={getContext:()=>current,getGame:()=>game,storage:saved,request:async()=>{reads++;return reader?reader():data;},mutate:async()=>{writes++;return writer?writer():{ok:true};}};
  return {win,api:win.SengokuAlliance,command:win.SengokuCommandCenter,options,
    create(){return win.SengokuAlliance.createController(options);},get context(){return current;},set context(value){current=value;},get game(){return game;},set game(value){game=value;},get data(){return data;},set data(value){data=value;},set reader(value){reader=value;},set writer(value){writer=value;},get counts(){return{reads,writes};}};
}
let checks=0;async function test(name,fn){await fn();checks++;console.log('PASS '+name);}
(async()=>{
 await test('unknown alliance movements remain explicitly unloaded without fetching',()=>{
  const h=harness(),snapshot=h.api.ownTravelSnapshot(),model=h.command.buildOperations(h.game,{catalog});
  assert.equal(snapshot.available,false);assert.equal(snapshot.status,'unloaded');assert.equal(snapshot.active.length,0);assert.match(model.allianceNote,/未取得/);assert.deepEqual(h.counts,{reads:0,writes:0});
 });
 await test('only authenticated personal moving units are retained from an authorized alliance response',async()=>{
  const h=harness(),back=Travel.plan({sourceCastleId:'odawara',targetCastleId:'kiyosu'});
  h.data=payload([unit(),unit({id:'au_back',kind:'rally',state:'returning',phase:'returning',travel:back}),unit({id:'au_private',ownerId:'u_someone',ownerName:'秘密の仲間'}),unit({id:'au_ready',state:'stationed',phase:null}),unit({id:'au_battle',marchId:'battle_one'})]);
  const c=h.create();assert(await c.load());const snapshot=h.api.ownTravelSnapshot();assert.equal(snapshot.available,true);assert.equal(snapshot.active.length,2);assert.deepEqual(Array.from(snapshot.active,row=>row.id),['alliance-unit:au_self','alliance-unit:au_back']);
  const text=JSON.stringify(snapshot);assert(!text.includes('秘密の仲間'));assert(!text.includes('u_someone'));assert(!text.includes('targetPlayerId'));assert(!text.includes('ownerName'));assert(!text.includes('u_other'));c.dispose();
 });
 await test('closing the alliance view preserves a read-only copy without extra requests',async()=>{
  const h=harness(),c=h.create();await c.load();c.dispose();const before=JSON.stringify(h.game.state),first=h.api.ownTravelSnapshot();first.active[0].travel.sourceName='書き換え';first.active[0].troops=0;
  for(let i=0;i<50;i++){const snapshot=h.api.ownTravelSnapshot();assert.equal(snapshot.active[0].troops,300);assert.equal(snapshot.active[0].travel.sourceName,'清洲城');h.command.buildOperations(h.game,{catalog});}
  assert.deepEqual(h.counts,{reads:1,writes:0});assert.equal(JSON.stringify(h.game.state),before);
 });
 await test('account, membership and privilege epochs each invalidate retained private movements',async()=>{
  for(const key of ['epoch','accountEpoch','guildEpoch','privilegeEpoch']){
    const h=harness(),c=h.create();await c.load();h.context={...h.context,[key]:h.context[key]+1};const result=h.api.ownTravelSnapshot();assert.equal(result.available,false,key);assert.equal(result.active.length,0,key);h.context=context();assert.equal(h.api.ownTravelSnapshot().available,false,'old snapshots cannot reappear');c.dispose();
  }
 });
 await test('pending, banned, sign-out and another account invalidate cached units without a request',async()=>{
  for(const change of [c=>({...c,pending:true}),c=>({...c,banned:true}),c=>({...c,user:null}),c=>({...c,playerId:'u_new',user:{...c.user,id:'u_new'}}),c=>({...c,user:{...c.user,guildId:'g_two'}})]){
    const h=harness(),c=h.create();await c.load();h.context=change(h.context);assert.equal(h.api.ownTravelSnapshot().active.length,0);assert.deepEqual(h.counts,{reads:1,writes:0});c.dispose();
  }
 });
 await test('changing campaign data invalidates movements belonging to the old campaign',async()=>{
  const h=harness(),c=h.create();await c.load();h.game.state.walking.campaignId='new_campaign';assert.equal(h.api.ownTravelSnapshot().available,false);assert.equal(h.api.ownTravelSnapshot().active.length,0);c.dispose();
 });
 await test('a response begun in the previous campaign cannot be attached to the new campaign',async()=>{
  const h=harness(),pending=deferred();h.reader=()=>pending.promise;const c=h.create(),loading=c.load();h.game.state.walking.campaignId='new_campaign';
  pending.resolve(payload());await loading;assert.equal(h.api.ownTravelSnapshot().available,false);assert.equal(h.api.ownTravelSnapshot().active.length,0);c.dispose();
 });
 await test('late responses for a former member never populate the command desk',async()=>{
  const h=harness(),pending=deferred();h.reader=()=>pending.promise;const c=h.create(),loading=c.load();h.context={...h.context,guildEpoch:99,guildId:'g_two',user:{...h.context.user,guildId:'g_two'}};
  pending.resolve(payload());assert.equal(await loading,false);assert.equal(h.api.ownTravelSnapshot().available,false);assert.equal(h.api.ownTravelSnapshot().active.length,0);c.dispose();
 });
 await test('an older server snapshot cannot replace a newer response from another view instance',async()=>{
  const h=harness(),old=deferred();h.reader=()=>old.promise;const first=h.create(),pending=first.load();h.reader=null;h.data=payload([unit({id:'au_new',troops:500})],{serverNow:1000100});const second=h.create();await second.load();
  old.resolve(payload([unit({id:'au_old'})],{serverNow:1000000}));await pending;
  assert.equal(h.api.ownTravelSnapshot().active[0].id,'alliance-unit:au_new');first.dispose();second.dispose();
 });
 await test('uncertain mutations invalidate old movements instead of guessing their new direction',async()=>{
  const h=harness(),c=h.create();await c.load();h.writer=()=>{throw Error('reply lost');};assert.equal(await c.send('/alliance/units/recall',{unitId:'au_self'}),false);
  assert.equal(h.api.ownTravelSnapshot().available,false);assert.equal(h.api.ownTravelSnapshot().active.length,0);assert.deepEqual(h.counts,{reads:1,writes:1});c.dispose();
 });
 await test('a read begun before a mutation cannot restore outbound units while recall is pending',async()=>{
  const h=harness(),c=h.create();await c.load();const old=deferred(),write=deferred();h.reader=()=>old.promise;const loading=c.load();h.writer=()=>write.promise;const sending=c.send('/alliance/units/recall',{unitId:'au_self'});
  old.resolve(payload());await loading;assert.equal(h.api.ownTravelSnapshot().available,false);
  h.reader=null;h.data=payload([unit({state:'returning',phase:'returning'})],{serverNow:1000200});write.resolve({ok:true});assert.equal(await sending,true);assert.equal(h.api.ownTravelSnapshot().active[0].phase,'returning');c.dispose();
 });
 await test('another view cannot publish a snapshot fetched during an unresolved mutation',async()=>{
  const h=harness(),first=h.create();await first.load();const write=deferred();h.writer=()=>write.promise;const sending=first.send('/alliance/units/recall',{unitId:'au_self'}),second=h.create();await second.load();
  assert.equal(h.api.ownTravelSnapshot().available,false);const old=deferred();h.reader=()=>old.promise;const loading=second.load();
  h.reader=null;h.data=payload([unit({state:'returning',phase:'returning'})],{serverNow:1000200});write.resolve({ok:true});assert.equal(await sending,true);
  old.resolve(payload([unit({id:'au_stale'})],{serverNow:1000300}));await loading;assert.equal(h.api.ownTravelSnapshot().active[0].id,'alliance-unit:au_self');assert.equal(h.api.ownTravelSnapshot().active[0].phase,'returning');first.dispose();second.dispose();
 });
 await test('an existing post-mutation refresh supplies the confirmed new return route',async()=>{
  const h=harness(),c=h.create();await c.load();const back=Travel.plan({sourceCastleId:'odawara',targetCastleId:'kiyosu'});h.data=payload([unit({state:'returning',phase:'returning',travel:back})],{serverNow:1000200});assert(await c.send('/alliance/units/recall',{unitId:'au_self'}));
  const model=h.command.buildOperations(h.game,{catalog,clock:{elapsedMs:1000,realNowMs:1000000,speed:2,running:true}}),row=model.items[0];
  assert.equal(row.category,'returning');assert.equal(row.name,'小田原城 → 清洲城');assert.equal(row.destination,'alliance');assert.equal(row.actionLabel,'同盟部隊を見る');assert.match(row.detail,/同盟援軍/);assert.match(row.detail,/最終確認/);assert.match(model.allianceNote,/取得情報/);assert.deepEqual(h.counts,{reads:2,writes:1});c.dispose();
 });
 await test('a successful empty list is distinguished from movements that were never loaded',async()=>{
  const h=harness();h.data=payload([]);const c=h.create();await c.load();const snapshot=h.api.ownTravelSnapshot(),model=h.command.buildOperations(h.game,{catalog});
  assert.equal(snapshot.available,true);assert.equal(snapshot.active.length,0);assert.doesNotMatch(model.allianceNote,/未取得/);c.dispose();
 });
 await test('a former member can still see their own returning soldiers supplied by the server',async()=>{
  const h=harness();h.context={...h.context,guildId:null,guildRole:null,user:{...h.context.user,guildId:null,guildRole:null}};h.data=payload([unit({state:'returning',phase:'returning'})],{guild:null});const c=h.create();await c.load();assert.equal(h.api.ownTravelSnapshot().available,true);assert.equal(h.api.ownTravelSnapshot().active.length,1);c.dispose();
 });
 await test('server and client membership mismatches do not turn private data into a cached snapshot',async()=>{
  const h=harness();h.data=payload([unit()],{guild:{id:'g_different'}});const c=h.create();await c.load();assert.equal(h.api.ownTravelSnapshot().available,false);c.dispose();
 });
 await test('authorization errors clear the last successful snapshot',async()=>{
  for(const status of [401,403]){const h=harness(),c=h.create();await c.load();h.reader=()=>{throw Object.assign(Error('access denied'),{status});};assert.equal(await c.load(),false);assert.equal(h.api.ownTravelSnapshot().available,false);c.dispose();}
 });
 await test('an authorization failure also invalidates successful responses already in flight',async()=>{
  const h=harness(),first=h.create();await first.load();const old=deferred();h.reader=()=>old.promise;const loading=first.load();
  h.reader=()=>{throw Object.assign(Error('access denied'),{status:403});};const second=h.create();await second.load();assert.equal(h.api.ownTravelSnapshot().available,false);
  old.resolve(payload());await loading;assert.equal(h.api.ownTravelSnapshot().available,false);first.dispose();second.dispose();
 });
 await test('elapsed countdowns never settle a cached arrival or award returning troops',async()=>{
  const h=harness(),c=h.create();await c.load();const before=JSON.stringify(h.game.state),original=clone(h.api.ownTravelSnapshot()),model=h.command.buildOperations(h.game,{catalog,clock:{elapsedMs:1e9,realNowMs:1000000,running:false,speed:4}});
  assert.equal(model.items[0].time,'到着を確認中');assert.equal(model.items[0].destination,'alliance');assert.equal(h.api.ownTravelSnapshot().active[0].status,'marching');assert.equal(JSON.stringify(h.game.state),before);assert.deepEqual(clone(h.api.ownTravelSnapshot()),original);assert.deepEqual(h.counts,{reads:1,writes:0});c.dispose();
 });
 console.log(checks+' alliance operations projection checks passed. No external requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
