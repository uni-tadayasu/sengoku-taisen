'use strict';
// Isolated identities and responses only; no live management actions.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const PLAYER='u_deputy',TOKEN='fixture-session-token-that-is-never-sent',NOW='2026-11-28T00:00:00.000Z';
const copy=value=>JSON.parse(JSON.stringify(value));
const deputy=()=>({id:PLAYER,name:'検証用領主',isAdmin:false,isStaff:false,isDeputy:true,canOperate:true,isBanned:false});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};
const tests=[],test=(name,run)=>tests.push([name,run]);
function social(){
 const calls=[],roles=[],storage=new Map();let handler=async()=>({ok:true});
 const scope={console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:crypto.webcrypto,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
  SENGOKU_API_BASE:'https://deputy-test.invalid',SengokuBridge:{setRoleAccess:role=>roles.push(copy(role)),setSyncAccess(){},applyCourtAccess(){}},
  fetch:async(url,options)=>{calls.push({url,options:copy(options)});const data=await handler(url,options);return{ok:!data.__status,status:data.__status||200,json:async()=>data};}
 };
 scope.window=scope;vm.createContext(scope);
 const source=fs.readFileSync(require.resolve('../social.js'),'utf8').replace('global.SengokuSocial={open','global.__ops={s,api,tabs,channel,adminView,loadChat,acceptUser,loadStaff,staffConfirmation,musicBroadcastRequest,canShowOperatorRecovery,bumpPrivilege:()=>privilegeEpoch++};global.SengokuSocial={open');
 vm.runInContext(source,scope);const t=scope.__ops;t.s.identity={id:PLAYER,token:TOKEN};t.s.user=deputy();
 return{scope,t,api:scope.SengokuSocial,calls,roles,setHandler:value=>handler=value};
}
test('the deputy gets the operational room without principal or Chancellor controls',()=>{
 const h=social(),html=h.t.adminView();
 for(const section of ['moderation','premium','promotion','music','events','announcement','mail'])assert(html.includes('data-id="'+section+'"'),section);
 for(const section of ['staff','deputy'])assert(!html.includes('data-id="'+section+'"'),section);
 assert(!html.includes('court-management'));assert(h.t.tabs().some(row=>row.id==='admin'));assert(h.t.tabs().some(row=>row.id==='recent-logins'));
 assert.equal(h.api.getUser().isAdmin,false);assert.equal(h.api.getUser().isStaff,false);assert.equal(h.api.getUser().isDeputy,true);assert.equal(h.api.getUser().canOperate,true);
 assert.equal(h.api.getEventContext().isAdmin,false);assert.equal(h.api.getEventContext().canOperate,true);assert.equal(h.api.getPromotionContext().isAdmin,false);assert.equal(h.api.getPromotionContext().canOperate,true);assert.equal(h.t.canShowOperatorRecovery(),false);
});
test('Chancellor, Kyoto appointment, deputy appointment and recovery remain unavailable',async()=>{
 const h=social(),post={method:'POST',data:{requestId:'test-request'}};
 assert.throws(()=>h.api.deputyRequest('/admin/deputy'),/運営権限/);await assert.rejects(h.t.loadStaff(),/運営権限/);assert.throws(()=>h.t.staffConfirmation('u_target','appoint'),/運営権限/);
 for(const [route,options]of [['/admin/court/offices',{}],['/admin/court/regent',post],['/admin/court/leader',post],['/admin/court/succession',{}],['/admin/court/succession/csn_'+'a'.repeat(32)+'/approve',post],['/staff/court',{}]])await assert.rejects(h.api.courtRequest(route,options),error=>error.status===403);
 await assert.rejects(h.api.courtEventRequest('/court/events'),error=>error.status===403);assert.throws(()=>h.api.staffRequest('/staff/base'),/スタッフ権限/);assert.equal(h.calls.length,0);
});
test('operational facades use the deputy session and exact supported routes',async()=>{
 const h=social(),override={auth:false,token:'not-the-current-session'};
 await h.api.moderationRequest('/admin/moderation/bans',override);
 await h.api.moderationRequest('/admin/moderation/expel',{...override,method:'POST',data:{requestId:'reviewed-operation'}});
 await h.api.premiumReviewRequest('/admin/premium/reviews',override);
 await h.api.premiumReviewRequest('/admin/premium/reviews',{...override,method:'POST',body:{requestId:'reviewed-hold'}});
 await h.api.promotionRequest('/admin/promotion?days=14',override);
 await h.t.musicBroadcastRequest('/admin/music',{...override,method:'POST',body:{enabled:false}});
 await h.api.eventRequest('/admin/events',override);
 await h.api.eventRequest('/admin/events/generate',{...override,method:'POST',data:{battleId:'history:kawanakajima'}});
 await h.api.roamingRequest('/staff/roaming',override);
 await h.api.roamingRequest('/admin/roaming/deployment',{...override,method:'POST',data:{}});
 await h.api.voiceRequest('/voice/room?channel=admin',override);
 await h.api.setWorldClock({running:false});
 assert.equal(h.calls.length,12);assert(h.calls.every(call=>call.options.headers.Authorization==='Bearer '+TOKEN));assert(h.calls.every(call=>!call.url.includes(TOKEN)));assert.equal(h.api.getUser().isAdmin,false);
 assert.throws(()=>h.api.moderationRequest('/admin/deputy'),/操作/);await assert.rejects(h.api.eventRequest('/admin/court/leader',{method:'POST'}),error=>error.status===400);
});
test('private chat includes deputies and a later loss clears its cache',async()=>{
 const h=social();h.t.s.tab='admin';h.t.s.adminSection='chat';h.setHandler(async()=>({ok:true,messages:[],nextAfter:0}));
 assert.equal(h.t.channel().channel,'admin');await h.t.loadChat();assert.equal(new URL(h.calls[0].url).searchParams.get('channel'),'admin');
 h.t.s.chats.set('admin:',{messages:[{text:'private'}],after:1});h.t.acceptUser({...deputy(),isDeputy:false,canOperate:false},{fromSync:true});
 assert(!h.t.s.chats.has('admin:'));assert(!h.t.tabs().some(row=>row.id==='admin'));assert.equal(h.t.s.tab,'profile');
});
test('all delayed operational reads are discarded after deputy revocation',async()=>{
 for(const call of [h=>h.api.moderationRequest('/admin/moderation/bans'),h=>h.api.premiumReviewRequest('/admin/premium/reviews'),h=>h.api.promotionRequest('/admin/promotion?days=14'),h=>h.t.musicBroadcastRequest('/admin/music'),h=>h.api.eventRequest('/admin/events'),h=>h.api.roamingRequest('/staff/roaming'),h=>h.api.voiceRequest('/voice/room?channel=admin'),h=>h.api.setWorldClock({running:true})]){
  const h=social(),late=deferred();h.setHandler(()=>late.promise);const pending=call(h);h.t.acceptUser({...deputy(),isDeputy:false,canOperate:false},{fromSync:true});late.resolve({ok:true,private:'must not be accepted'});await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');assert.equal(h.api.getUser().canOperate,false);
 }
});
test('a principal-only denial preserves deputy access; an operational denial revokes it',async()=>{
 const h=social();h.setHandler(async()=>({__status:403,ok:false,error:{code:'ADMIN_REQUIRED',message:'principal only'}}));
 await assert.rejects(h.t.api('/admin/court/offices'),error=>error.code==='ADMIN_REQUIRED');assert.equal(h.api.getUser().isDeputy,true);assert.equal(h.api.getUser().isAdmin,false);assert.equal(h.api.getUser().canOperate,true);
 h.setHandler(async()=>({__status:403,ok:false,error:{code:'OPERATIONAL_REQUIRED',message:'role removed'}}));
 await assert.rejects(h.api.moderationRequest('/admin/moderation/bans'),error=>error.code==='OPERATIONAL_REQUIRED');assert.equal(h.api.getUser().canOperate,false);assert.equal(h.api.getUser().isDeputy,false);assert(!h.t.adminView().includes('data-id="moderation"'));
});
test('a revoked capability or unverified identity cannot use operational transport',async()=>{
 for(const mutate of [h=>h.t.s.user.canOperate=false,h=>h.t.s.user.isBanned=true,h=>h.t.s.user={...deputy(),isDeputy:false,canOperate:true},h=>h.t.s.identity.id='another',h=>h.t.s.accountAccessPending={}]){
  const h=social();mutate(h);assert.throws(()=>h.api.moderationRequest('/admin/moderation/bans'),/運営権限/);await assert.rejects(h.api.eventRequest('/admin/events'),error=>error.status===403);await assert.rejects(h.api.promotionRequest('/admin/promotion?days=14'),/運営権限/);assert.equal(h.calls.length,0);
 }
});
const emptyReport=()=>({ok:true,timezone:'Asia/Tokyo',range:{from:'2026-11-13',to:'2026-11-26',days:14},events:[],totals:{landing:0,play_click:0},accounts:{total:0,createdInRange:0},serverNow:NOW});
const controllerCases=[
 {name:'moderation',factory:opts=>require('../moderation.js').createController(opts),open:c=>c.open('bans'),response:()=>({ok:true,bans:[],nextCursor:null,contentRevision:0})},
 {name:'purchase review',factory:opts=>require('../premium-admin.js').createController(opts),open:c=>c.open(),response:()=>({ok:true,holds:[],nextCursor:null,serverNow:NOW})},
 {name:'promotion',factory:opts=>require('../promotion-admin.js').createController(opts),open:c=>c.open(),response:emptyReport},
 {name:'music',factory:opts=>require('../music-broadcast.js').create(opts),open:c=>c.refresh(),response:()=>({ok:true,musicBroadcast:{enabled:false,mode:'loop',revision:0,startedAt:null,updatedAt:null},serverNow:NOW})},
 {name:'event administration',factory:opts=>require('../events.js').createController(opts),open:c=>c.open({admin:true}),response:()=>({ok:true,events:[],catalog:[],serverNow:NOW})}
];
for(const row of controllerCases)test(row.name+' controller permits a deputy and clears delayed data on revocation',async()=>{
 let user=deputy(),revision=1,handler=async()=>row.response();const calls=[],storage=new Map();
 const context=()=>({user,playerId:PLAYER,identity:{id:PLAYER,token:TOKEN},isAdmin:user.isAdmin,canOperate:user.canOperate,epoch:1,privilegeEpoch:revision,accountEpoch:1,pending:false,banned:false});
 const options={getUser:()=>user,getContext:context,storage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},request:async(route,settings)=>{calls.push({route,settings});return handler();}};
 let c=row.factory(options);await row.open(c);assert.equal(c.getState().authorized,true);assert(calls.length>0);assert.equal(user.isAdmin,false);c.dispose();
 const late=deferred();handler=()=>late.promise;c=row.factory(options);const pending=row.open(c);user={...user,isDeputy:false,canOperate:false};revision++;late.resolve(row.response());await pending;const state=c.getState();assert.equal(state.authorized,false);assert.equal(state.report??null,null);assert.equal(state.selected??null,null);assert.equal(state.target??null,null);if(state.holds)assert.equal(state.holds.length,0);if(state.events)assert.equal(state.events.length,0);c.dispose();
 const before=calls.length;user={...deputy(),isDeputy:false,canOperate:true};c=row.factory(options);await row.open(c);assert.equal(c.getState().authorized,false);assert.equal(calls.length,before);c.dispose();
});
(async()=>{for(const [name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' deputy operations UI checks passed; no live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
