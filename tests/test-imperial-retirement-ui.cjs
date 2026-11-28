'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Court=require('../court.js'),PublicCourt=require('../public-court.js');
const clone=value=>JSON.parse(JSON.stringify(value)),tests=[];
const test=(name,run)=>tests.push([name,run]);
const pause=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const TIME=1795881600000,ID='retired-succession-one';
const retired=(patch={})=>({kind:'retired-emperor',isReturnedImperial:false,isRetiredEmperor:true,isCloisteredEmperor:false,title:'上皇',canOrdain:true,revision:0,successionId:ID,retiredAt:TIME,ordainedAt:null,canRelocate:false,base:{id:'sento_gosho',name:'仙洞御所',fixed:true},shogunateIndependent:true,reason:'',...patch});
const packet=row=>({ok:true,retirement:clone(row),serverNow:new Date(TIME).toISOString()});
function fixture({record=retired(),store=new Map()}={}){
 let context={playerId:'u_retired',epoch:1,accountEpoch:1,privilegeEpoch:1,user:{id:'u_retired',name:'退位した領主',isAdmin:false,isStaff:false}},seq=0,hook=null,moves=0;
 const storage={getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)},calls=[];
 const info={ok:true,eligible:false,requirement:{rankId:'court-7',rankName:'従五位',minScore:35000},evaluation:{score:0,rankName:'無位'},self:{id:context.playerId,name:context.user.name,title:record.title,isRetiredEmperor:record.isRetiredEmperor,isReturnedImperial:record.isReturnedImperial,isCloisteredEmperor:record.isCloisteredEmperor,canOrdain:record.canOrdain,shogunateIndependent:record.shogunateIndependent},palace:{id:'kyoto_gosho',level:1,buildings:{},control:null},features:{},accessStamp:'retirement-one',contentRevision:0};
 const state={record:clone(record)},receipts=new Map();
 async function respond(route,args){
  if(route==='/court')return clone(info);
  if(route==='/court/retirement')return packet(state.record);
  assert.equal(route,'/court/retirement/ordain');assert.equal(args.method,'POST');
  const old=receipts.get(args.data.requestId);if(old)return{...packet(state.record),receipt:clone(old),idempotent:true};
  assert.equal(args.data.confirmed,true);assert.equal(args.data.successionId,state.record.successionId);assert.equal(args.data.expectedRevision,state.record.revision);
  const capacity=state.record.capacity?{shared:{limit:1,count:1,available:false,holder:{id:context.playerId,name:context.user.name,kind:'cloistered-emperor',title:'法皇'}},retired:{limit:1,count:0,available:false,holder:null},cloistered:{limit:1,count:1,available:false,holder:{id:context.playerId,name:context.user.name}}}:null;
  state.record=retired({kind:'cloistered-emperor',isCloisteredEmperor:true,title:'法皇',canOrdain:false,revision:1,ordainedAt:TIME+1000,capacity});Object.assign(info.self,{title:'法皇',isCloisteredEmperor:true,canOrdain:false});
  const receipt={requestId:args.data.requestId,action:'ordain',successionId:ID,revision:1,ordainedAt:TIME+1000,title:'法皇'};receipts.set(args.data.requestId,receipt);return{...packet(state.record),receipt:clone(receipt),idempotent:false};
 }
 const options={storage,getContext:()=>context,uuid:()=>`retirement-command-${++seq}`,request:async(route,args={})=>{calls.push({route,...clone(args)});return hook?hook(route,args):respond(route,args);},onRetirementRelocation:async()=>{moves++;}};
 const controller=Court.createController(options);
 return{controller,options,info,state,store,calls,respond,get moves(){return moves;},get context(){return context;},set context(value){context=value;},set hook(value){hook=value;}};
}
test('retired status verifies the independent Sento residence even without admission rank',async()=>{
 const h=fixture();await h.controller.load();const snapshot=h.controller.snapshot(),html=Court.markup(snapshot);
 assert.equal(snapshot.retirement.canRelocate,false);assert.equal(snapshot.retirement.base.id,'sento_gosho');assert.match(html,/幕府から独立/);assert.doesNotMatch(html,/data-court-action="retirement-relocate"/);assert.match(html,/二つの身分で合計一人の共通枠/);assert.match(html,/仙洞御所の城下町へ/);
 assert.match(html,/京都御所の強化を継承/);assert.match(html,/高い方のレベルを能力計算に適用/);
 assert.equal(await h.controller.relocateRetirement(),false);assert.equal(h.moves,0);assert.equal(h.calls.filter(row=>row.method==='POST').length,0);
});
test('ordination requires review and one confirmed command then keeps the shared seat and Sento residence',async()=>{
 const h=fixture();await h.controller.load();assert.equal(await h.controller.submit('retirement'),false);assert.equal(h.calls.filter(row=>row.method==='POST').length,0);
 assert.equal(h.controller.confirmRetirement(),true);assert.match(Court.markup(h.controller.snapshot()),/法皇から上皇へ戻すことはできません/);assert.equal(await h.controller.submit('retirement'),true);
 assert.equal(h.calls.filter(row=>row.method==='POST').length,1);assert.equal(h.controller.snapshot().retirement.isCloisteredEmperor,true);assert.equal(h.controller.snapshot().retirement.canRelocate,false);assert.equal(h.controller.snapshot().retirement.base.id,'sento_gosho');assert.equal(h.controller.snapshot().pending,null);assert.equal(h.store.size,0);assert.equal(h.controller.confirmRetirement(),false);
 assert.match(Court.markup(h.controller.snapshot()),/京都御所の強化を継承/);
});
test('a failed reply keeps one durable operation and reload retries the same receipt',async()=>{
 const h=fixture();await h.controller.load();h.controller.confirmRetirement();h.hook=async(route,args)=>{if(args.method!=='POST')return h.respond(route,args);await h.respond(route,args);throw Error('通信が中断しました');};
 assert.equal(await h.controller.submit('retirement'),false);const sent=h.calls.find(row=>row.method==='POST').data;assert.equal(h.controller.snapshot().pending.data.requestId,sent.requestId);
 const retry=Court.createController({...h.options,request:(route,args)=>h.respond(route,args)});assert.equal(retry.snapshot().pending.data.requestId,sent.requestId);assert.equal(await retry.submit(),true);for(let i=0;i<100&&retry.snapshot().loading;i++)await Promise.resolve();assert.equal(retry.snapshot().retirement.title,'法皇');assert.equal(retry.snapshot().pending,null);assert.equal(h.store.size,0);
});
test('ordination changes title inside the one shared seat without opening another retirement seat',async()=>{
 const holder={id:'u_retired',name:'退位した領主'},capacity={shared:{limit:1,count:1,available:false,holder:{...holder,kind:'retired-emperor',title:'上皇'}},retired:{limit:1,count:1,available:false,holder},cloistered:{limit:1,count:0,available:false,holder:null}};
 const h=fixture({record:retired({capacity})});await h.controller.load();assert.equal(h.controller.confirmRetirement(),true);assert.match(Court.markup(h.controller.snapshot()),/同じ共通枠の中で身分を変更/);assert.equal(await h.controller.submit('retirement'),true);
 const current=h.controller.snapshot().retirement;assert.equal(current.capacity.shared.count,1);assert.equal(current.capacity.shared.available,false);assert.equal(current.capacity.shared.holder.title,'法皇');assert.equal(current.capacity.retired.count,0);assert.equal(current.capacity.retired.available,false);assert.equal(current.capacity.cloistered.count,1);assert.equal(current.base.id,'sento_gosho');
});
test('double clicks and a changed identity cannot adopt another account ordination',async()=>{
 const h=fixture(),deferred=pause();await h.controller.load();h.controller.confirmRetirement();h.hook=(route,args)=>args.method==='POST'?deferred.promise:h.respond(route,args);const first=h.controller.submit('retirement');assert.equal(await h.controller.submit('retirement'),false);assert.equal(h.calls.filter(row=>row.method==='POST').length,1);
 const pending=h.controller.snapshot().pending;h.context={...h.context,playerId:'u_other',epoch:2,user:{id:'u_other',name:'別の領主'}};deferred.resolve(await h.respond(pending.route,{method:'POST',data:pending.data}));assert.equal(await first,false);assert.equal(h.controller.snapshot().retirement,null);assert.equal(h.controller.snapshot().pending,null);assert.equal(h.store.size,1);
});
test('a denied ordination and stale retirement review cannot be submitted',async()=>{
 const h=fixture({record:retired({canOrdain:false,reason:'退位した身分が変わりました。'})});await h.controller.load();assert.equal(h.controller.confirmRetirement(),false);assert.match(Court.markup(h.controller.snapshot()),/退位した身分が変わりました/);
 h.state.record.canOrdain=true;await h.controller.load();assert.equal(h.controller.confirmRetirement(),true);h.state.record.canOrdain=false;await h.controller.load();assert.equal(h.controller.snapshot().confirmation,null);assert.equal(await h.controller.submit('retirement'),false);assert.equal(h.calls.filter(row=>row.method==='POST').length,0);
});
test('inconsistent retirement DTOs and mismatched receipts never become authority',()=>{
 for(const invalid of [retired({title:'天皇'}),retired({shogunateIndependent:false}),retired({retiredAt:-1}),retired({ordainedAt:TIME}),retired({kind:'cloistered-emperor',isCloisteredEmperor:true,title:'法皇',ordainedAt:TIME-1}),retired({isRetiredEmperor:false}),retired({canRelocate:true}),retired({base:{id:'kyoto_gosho',name:'京都御所',fixed:true}})])assert.throws(()=>Court.cleanRetirement(packet(invalid)));
 const h=retired({kind:'cloistered-emperor',isCloisteredEmperor:true,title:'法皇',canOrdain:false,revision:1,ordainedAt:TIME+1}),pending={data:{requestId:'request-one',successionId:ID,expectedRevision:0}};
 assert.throws(()=>Court.cleanRetirementResult({...packet(h),idempotent:false,receipt:{requestId:'other',action:'ordain',successionId:ID,revision:1,ordainedAt:TIME+1,title:'法皇'}},pending));
});
test('formal imperial members retaining their ordinary base appear with their current base and house',()=>{
 const result=Court.cleanSuccession({ok:true,canNominate:true,approvalRequired:true,sourceAppointmentToken:'current-term',candidates:[{id:'u_heir',name:'宮家の当主',termId:'retained-term',homeCastleId:'azuchi',homeCastleName:'安土城',imperialHouseName:'桜宮'}],pending:null,history:[],historyHasMore:false});
 assert.equal(result.candidates[0].homeCastleId,'azuchi');assert.equal(result.candidates[0].imperialHouseName,'桜宮');
});
test('cloistered Emperor badge uses a server-issued distinct title and complete inline art',()=>{
 const value={title:'法皇',kind:'cloistered-emperor'};assert.deepEqual(PublicCourt.normalize(value),value);assert.equal(PublicCourt.normalize({title:'法皇',kind:'retired-emperor'}),null);
 const html=PublicCourt.badge({courtOffice:value});assert.match(html,/public-court-cloistered-emperor/);assert.match(html,/data-court-seal="lotus"/);assert.doesNotMatch(html,/<img/);
});
test('a predecessor returning to imperial class can relocate but gets no retired-title independence or ordination',async()=>{
 const h=fixture({record:retired({kind:'imperial',title:'皇族',isRetiredEmperor:false,isReturnedImperial:true,canOrdain:false,canRelocate:true,base:null,shogunateIndependent:false})});await h.controller.load();
 const html=Court.markup(h.controller.snapshot());assert.match(html,/皇族に戻って退位しました/);assert.match(html,/data-court-action="retirement-relocate"/);assert.doesNotMatch(html,/data-court-action="confirm-retirement"/);assert.match(html,/皇族として通常の扱い/);assert.equal(h.controller.confirmRetirement(),false);assert.equal(await h.controller.relocateRetirement(),true);assert.equal(h.moves,1);
 assert.doesNotMatch(html,/court-retirement-enhancements|京都御所の強化を継承/);
});
test('imperial class survives abdication without inventing a house for a legacy Emperor',()=>{
 const person={courtLineage:{class:'imperial',houseId:null,houseName:null,imperialHouseName:null,originalClan:'島津家'}};assert.equal(PublicCourt.lineageText(person),'皇族');assert.equal(PublicCourt.lineage(person).originalClan,'島津家');
 const value=Court.cleanLineage({class:'imperial',houseId:null,houseName:null,imperialHouseName:null,originalClan:'島津家',needsHouseSelection:false,revision:0,termId:null,canChooseHouse:false,canCreateImperialHouse:false,reason:'',requirement:{officeId:'sadaijin',officeName:'左大臣',minMerit:2000}});assert.equal(value.class,'imperial');assert.equal(value.imperialHouseName,null);
});
test('current occupied seats and the royal fallback are displayed without promising an outdated retirement title',()=>{
 const capacity={shared:{limit:1,count:1,available:false,holder:{id:'u_joko',name:'在位中の上皇',kind:'retired-emperor',title:'上皇'}},retired:{limit:1,count:1,available:false,holder:{id:'u_joko',name:'在位中の上皇'}},cloistered:{limit:1,count:0,available:false,holder:null}};
 const data=Court.cleanSuccession({ok:true,canNominate:true,approvalRequired:true,sourceAppointmentToken:'current-term',candidates:[],pending:null,history:[],historyHasMore:false,capacity,retirementPreview:{kind:'imperial',title:'皇族'}});
 assert.equal(data.retirementPreview.title,'皇族');assert.equal(data.capacity.retired.holder.name,'在位中の上皇');assert.equal(data.capacity.cloistered.available,false);assert.equal(data.capacity.shared.count,1);
 assert.throws(()=>Court.cleanSuccession({ok:true,canNominate:true,approvalRequired:true,sourceAppointmentToken:'current-term',candidates:[],pending:null,history:[],historyHasMore:false,capacity:{...capacity,retired:{...capacity.retired,available:true}}}));
});
test('relocation reads a verified returned-imperial record and synchronizes the ordinary home before opening',async()=>{
 const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),body=source.slice(source.indexOf('  async function openRetirementRelocation(){'),source.indexOf('  function openRelocation(){'));
 for(const kind of ['imperial']){
  const actions=[],context={playerId:'u_retired',epoch:1,accountEpoch:1,user:{id:'u_retired'},pending:false,banned:false};
  const scope={window:{SengokuSocial:{getCourtContext:()=>context,courtRequest:async()=>{actions.push('read');return packet(retired({kind,title:kind==='imperial'?'皇族':kind==='cloistered-emperor'?'法皇':'上皇',isRetiredEmperor:kind!=='imperial',isReturnedImperial:kind==='imperial',canRelocate:true,base:null}));},refresh:async()=>actions.push('role')},SengokuCloudSync:{refresh:async()=>actions.push('home')}},canShowRelocation:()=>actions.includes('home'),openRelocation:()=>actions.push('choose')};
  vm.createContext(scope);vm.runInContext(body+'globalThis.run=openRetirementRelocation;',scope);await scope.run();assert.deepEqual(actions,['read','role','home','choose']);
 }
});
test('a past accepted ordination receipt never restores a retired title after the player becomes Emperor again',()=>{
 const pending={data:{requestId:'receipt-one',successionId:ID,expectedRevision:0}},value={ok:true,idempotent:true,retirement:{kind:'none',title:null,isRetiredEmperor:false,isReturnedImperial:false,isCloisteredEmperor:false,canOrdain:false,canRelocate:false,shogunateIndependent:false,revision:0,successionId:null,retiredAt:null,ordainedAt:null,reason:''},receipt:{requestId:'receipt-one',action:'ordain',successionId:ID,revision:1,ordainedAt:TIME+1,title:'法皇'}};
 const result=Court.cleanRetirementResult(value,pending);assert.equal(result.kind,'none');assert.equal(result.isCloisteredEmperor,false);assert.equal(result.shogunateIndependent,false);assert.throws(()=>Court.cleanRetirementResult({...value,idempotent:false},pending));
});
test('an admission snapshot carries its verified retirement state without an extra retirement request',async()=>{
 const h=fixture();h.info.retirement=clone(h.state.record);await h.controller.load();assert.equal(h.controller.snapshot().retirement.title,'上皇');assert.deepEqual(h.calls.map(row=>row.route),['/court']);
});
test('the verified ordination reward is shown with reserved portrait space and never granted by UI flags',async()=>{
 const reward={officerId:'special_goshirakawa_hoo',name:'後白河法皇',rank:'U',earned:false,earnedAt:null},h=fixture({record:retired({reward})});await h.controller.load();
 let html=Court.markup(h.controller.snapshot());assert.match(html,/後白河法皇/);assert.match(html,/width="96" height="128"/);assert.match(html,/統率100・武勇100・知略100・政治100/);assert.match(html,/法皇就任の特別褒賞/);assert.doesNotMatch(html,/獲得済み/);
 const calls=[],previous=global.SengokuCloudSync;global.SengokuCloudSync={refresh:async()=>{calls.push('sync');return{ok:true};}};
 h.hook=async(route,args)=>{const value=await h.respond(route,args);if(route==='/court/retirement/ordain'){h.state.record.reward={...reward,earned:true,earnedAt:TIME+1000};value.retirement.reward=clone(h.state.record.reward);}return value;};
 try{h.controller.confirmRetirement();assert.equal(await h.controller.submit('retirement'),true);assert.deepEqual(calls,['sync']);html=Court.markup(h.controller.snapshot());assert.match(html,/法皇就任の褒賞・獲得済み/);assert.match(html,/軍団・奉行に配置/);assert.match(h.controller.snapshot().message,/後白河法皇 U/);}finally{global.SengokuCloudSync=previous;}
 const valid=packet(retired({reward}));for(const patch of [{officerId:'of_fake'},{rank:'SSS'},{earned:true},{earnedAt:TIME}])assert.throws(()=>Court.cleanRetirement({...valid,retirement:{...valid.retirement,reward:{...reward,...patch}}}));
});
test('ordination saves writable local progress first and a failed save or identity switch sends no command',async()=>{
 for(const mode of ['success','failed','switched']){
  const h=fixture(),previous=global.SengokuCloudSync,events=[];await h.controller.load();h.controller.confirmRetirement();
  global.SengokuCloudSync={getStatus:()=>({writable:true}),flush:async()=>{events.push('flush');if(mode==='switched')h.context={...h.context,epoch:2,playerId:'other',user:{id:'other'}};return{ok:mode!=='failed',message:'保存を再確認してください'};},refresh:async()=>{events.push('refresh');return{ok:true};}};
  h.hook=(route,args)=>{if(args.method==='POST')events.push('post');return h.respond(route,args);};
  try{assert.equal(await h.controller.submit('retirement'),mode==='success');assert.deepEqual(events,mode==='success'?['flush','post','refresh']:['flush']);assert.equal(h.calls.filter(row=>row.method==='POST').length,mode==='success'?1:0);if(mode==='failed')assert.match(h.controller.snapshot().error,/保存を再確認/);}finally{global.SengokuCloudSync=previous;}
 }
});
test('a completed ordination keeps its receipt when character synchronization needs a later retry',async()=>{
 const h=fixture(),previous=global.SengokuCloudSync;await h.controller.load();h.controller.confirmRetirement();global.SengokuCloudSync={refresh:async()=>({ok:false,message:'offline'})};
 try{assert.equal(await h.controller.submit('retirement'),true);assert.equal(h.controller.snapshot().retirement.title,'法皇');assert.equal(h.controller.snapshot().pending,null);assert.match(h.controller.snapshot().message,/次回の同期時に再確認/);assert.equal(h.calls.filter(row=>row.method==='POST').length,1);}finally{global.SengokuCloudSync=previous;}
});
(async()=>{for(const [name,run]of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} imperial retirement UI checks passed.`);})().catch(error=>{console.error(error);process.exitCode=1;});
