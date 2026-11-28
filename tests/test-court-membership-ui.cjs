'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const Court=require('../court.js');
const copy=value=>JSON.parse(JSON.stringify(value));
const requirement={rankId:'court-7',rankName:'従五位',minScore:35000};
function harness(){
 const records=new Map(),storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
 const h={calls:[],accepted:[],records,storage,context:{epoch:1,accountEpoch:1,privilegeEpoch:1,playerId:'player-one',user:{id:'player-one',name:'領主',isStaff:false,isAdmin:false}},writer:{linked:true,ready:true,writable:true,revision:12},device:{id:'device-one'},hook:null,acceptHook:null};
 h.membership={isMember:false,canJoin:true,reason:'',requirement,homeCastleId:'kiyosu',homeCastleName:'清洲城',ownedCastleCount:2,ownedCastles:[{id:'kiyosu',name:'清洲城'},{id:'azuchi',name:'安土城'}],expectedRevision:12};
 h.info={ok:true,eligible:true,requirement,evaluation:{score:35000,rankName:'従五位'},accessStamp:'access-1',self:{id:'player-one',name:'領主'},palace:{level:3,buildings:{},jobCount:0},features:{conversation:true,audience:true},membership:h.membership};
 h.result=data=>({ok:true,user:{id:'player-one',isStaff:true,isAdmin:false,isDeputy:false},save:{state:{home:'kyoto_gosho'}},revision:13,membership:{isMember:true,canJoin:false,reason:'京都御所に正式加入しています。',requirement},admission:{requestId:data.requestId,castleId:'kyoto_gosho',previousHomeCastleId:data.expectedHomeCastleId,releasedCastleCount:2,termId:'membership-term-one',idempotent:false}});
 h.respond=(route,args)=>route==='/court'?copy(h.info):args.method==='GET'?{ok:true,membership:copy(h.membership)}:h.result(args.data);
 h.options={storage,getContext:()=>h.context,getSyncStatus:()=>h.writer,getDevice:()=>h.device,prepareMembership:async()=>({ok:true}),uuid:()=> 'membership-request-one',request:async(route,args)=>{h.calls.push({route,...copy(args)});return h.hook?h.hook(route,args):h.respond(route,args);},acceptMembership:async result=>{h.accepted.push(copy(result));if(h.acceptHook)return h.acceptHook(result);h.info.membership=result.membership;return{ok:true};}};
 h.controller=Court.createController(h.options);return h;
}
const writes=h=>h.calls.filter(call=>call.method==='POST');
test('rank failure cannot open a formal enrollment confirmation or send a command',async()=>{
 const h=harness();h.info.eligible=false;h.info.membership={...h.membership,canJoin:false,reason:'正式加入には従五位以上が必要です。'};
 await h.controller.load();assert.equal(await h.controller.confirmMembership(),false);assert.equal(await h.controller.submit('membership'),false);assert.equal(writes(h).length,0);assert.match(Court.markup(h.controller.snapshot()),/正式加入には従五位以上/);h.controller.dispose();
});
test('review lists the actual surrendered castles, escapes names, and cancellation never joins',async()=>{
 const h=harness();h.membership.ownedCastles[1].name='<img src=x>';await h.controller.load();assert.equal(await h.controller.confirmMembership(),true);
 const html=Court.markup(h.controller.snapshot());assert.match(html,/現在の拠点「清洲城」を手放し、京都御所へ正式に入りますか/);assert.match(html,/&lt;img src=x&gt;/);assert.match(html,/所持資源・勾玉/);assert.match(html,/出陣・派遣・同盟部隊/);assert.equal(writes(h).length,0);
 h.controller.cancel();assert.equal(h.controller.snapshot().confirmation,null);assert.equal(await h.controller.submit('membership'),false);assert.equal(writes(h).length,0);h.controller.dispose();
});
test('enrollment binds confirmation, authoritative save revision, home and current device',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();assert.equal(await h.controller.submit('membership'),true);
 assert.deepEqual(writes(h)[0],{route:'/court/membership',method:'POST',data:{deviceId:'device-one',expectedRevision:12,expectedHomeCastleId:'kiyosu',confirmed:true,requestId:'membership-request-one'}});assert.equal(h.accepted.length,1);assert.equal(h.records.size,0);assert.equal(h.controller.snapshot().pending,null);h.controller.dispose();
});
test('an unverified save revision or lost writer invalidates the earlier confirmation',async()=>{
 for(const change of ['revision','writer']){const h=harness();await h.controller.load();await h.controller.confirmMembership();if(change==='revision')h.writer.revision++;else h.writer.writable=false;
  assert.equal(await h.controller.submit('membership'),false);assert.equal(writes(h).length,0);assert.match(h.controller.snapshot().error,/正式加入の内容をもう一度確認/);h.controller.dispose();}
});
test('a follower can read admission information but cannot prepare the destructive join',async()=>{
 const h=harness();h.writer.writable=false;await h.controller.load();assert.equal(await h.controller.confirmMembership(),false);assert.equal(h.controller.snapshot().confirmation,null);assert.equal(writes(h).length,0);h.controller.dispose();
});
test('lost response persists one request through reload and recovery only reads its receipt',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.hook=(route,args)=>{if(args.method==='POST')throw Error('通信が途切れました');return h.respond(route,args);};
 assert.equal(await h.controller.submit('membership'),false);assert.equal(h.records.size,1);const original=copy(writes(h)[0].data);h.controller.dispose();
 h.hook=(route,args)=>route.includes('?receipt=1')?{...h.result(args.data),admission:{...h.result(args.data).admission,idempotent:true}}:h.respond(route,args);
 h.controller=Court.createController(h.options);await h.controller.load();assert.equal(h.controller.snapshot().pending.kind,'membership');assert.equal(await h.controller.submit(),true);
 assert.equal(writes(h).at(-1).route,'/court/membership?receipt=1');assert.deepEqual(writes(h).at(-1).data,original);assert.equal(h.records.size,0);h.controller.dispose();
});
test('a missing receipt never automatically resends a join; explicit resend retains its exact intent',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.hook=(route,args)=>{if(args.method==='POST')throw Error('応答なし');return h.respond(route,args);};await h.controller.submit('membership');
 h.hook=(route,args)=>{if(route.includes('?receipt=1'))throw Object.assign(Error('受付は未確認'),{status:404,code:'COURT_MEMBERSHIP_RECEIPT_PENDING'});return h.respond(route,args);};assert.equal(await h.controller.submit(),false);
 assert.equal(h.controller.snapshot().membershipReceiptMissing,true);assert.equal(writes(h).filter(row=>row.route==='/court/membership').length,1);assert.match(Court.markup(h.controller.snapshot()),/同じ加入内容を再送する/);
 assert.equal(await h.controller.submit('membership-resend'),true);assert.deepEqual(writes(h).at(-1).data,writes(h)[0].data);h.controller.dispose();
});
test('a malformed or mismatched receipt cannot adopt a snapshot or erase pending recovery',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.hook=(route,args)=>args.method==='POST'?{...h.result(args.data),admission:{...h.result(args.data).admission,previousHomeCastleId:'other-home'}}:h.respond(route,args);
 assert.equal(await h.controller.submit('membership'),false);assert.equal(h.accepted.length,0);assert.equal(h.records.size,1);assert.equal(h.controller.snapshot().pending.lookup,true);h.controller.dispose();
});
test('an account switch discards a delayed eligibility detail',async()=>{
 const h=harness();await h.controller.load();let resolve;h.hook=(route,args)=>route==='/court/membership'?new Promise(r=>{resolve=r;}):h.respond(route,args);const pending=h.controller.confirmMembership();
 for(let i=0;i<10&&!resolve;i++)await Promise.resolve();assert(resolve);h.context={...h.context,epoch:2,playerId:'player-two',user:{id:'player-two'}};resolve({ok:true,membership:copy(h.membership)});
 assert.equal(await pending,false);assert.equal(h.controller.snapshot().confirmation,null);assert.equal(writes(h).length,0);h.controller.dispose();
});
test('commit rejection clears the old confirmation and requires a new reviewed state',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.hook=(route,args)=>{if(args.method==='POST')throw Object.assign(Error('領地が変わりました'),{status:409,code:'REVISION_CONFLICT'});return h.respond(route,args);};assert.equal(await h.controller.submit('membership'),false);
 assert.equal(h.records.size,0);assert.equal(h.controller.snapshot().pending,null);assert.equal(h.controller.snapshot().confirmation,null);h.controller.dispose();
});
test('storage failure prevents a join from losing its recovery record',async()=>{
 const h=harness();h.storage.setItem=()=>{throw Error('保存不可');};await h.controller.load();await h.controller.confirmMembership();assert.equal(await h.controller.submit('membership'),false);assert.equal(writes(h).length,0);h.controller.dispose();
});
test('snapshot application can change the membership role without losing or duplicating the accepted receipt',async()=>{
 const h=harness();h.acceptHook=async result=>{h.info.membership=result.membership;h.context={...h.context,privilegeEpoch:2,user:{...h.context.user,isStaff:true}};h.controller.refresh();return{ok:true};};
 await h.controller.load();await h.controller.confirmMembership();assert.equal(await h.controller.submit('membership'),true);assert.equal(h.records.size,0);assert.equal(h.controller.snapshot().pending,null);assert.equal(h.accepted.length,1);assert.equal(writes(h).length,1);h.controller.dispose();
});

test('passive saves can advance during review if the same surrendered territory set is verified again',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.writer.revision=13;h.membership.expectedRevision=13;h.result=data=>({ok:true,user:{id:'player-one',isStaff:true},save:{state:{home:'kyoto_gosho'}},revision:14,membership:{isMember:true,canJoin:false,reason:'',requirement},admission:{requestId:data.requestId,castleId:'kyoto_gosho',previousHomeCastleId:'kiyosu',releasedCastleCount:2,termId:'membership-term-one',idempotent:false}});
 assert.equal(await h.controller.submit('membership'),true);assert.equal(writes(h)[0].data.expectedRevision,13);h.controller.dispose();
});
test('a changed territory list during confirmation requires explicit review again',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.membership.ownedCastles.push({id:'osaka',name:'大阪城'});h.membership.ownedCastleCount=3;
 assert.equal(await h.controller.submit('membership'),false);assert.equal(writes(h).length,0);assert.equal(h.controller.snapshot().confirmation,null);assert.match(h.controller.snapshot().error,/手放す拠点をもう一度確認/);h.controller.dispose();
});

test('post-commit snapshot conflicts retain the same membership receipt for recovery',async()=>{
 for(const code of ['STAFF_ROLE_CHANGED','COURT_ESTATE_REFRESH_REQUIRED','UNKNOWN_CONFLICT']){const h=harness();await h.controller.load();await h.controller.confirmMembership();h.hook=(route,args)=>{if(args.method==='POST')throw Object.assign(Error('結果の再確認が必要です'),{status:409,code});return h.respond(route,args);};
  assert.equal(await h.controller.submit('membership'),false);assert.equal(h.records.size,1);assert.equal(h.controller.snapshot().pending.lookup,true);h.controller.dispose();}
});

test('explicit recovery asks the server to resolve the original revision and clears a definitive stale-write rejection',async()=>{
 const h=harness();await h.controller.load();await h.controller.confirmMembership();h.hook=(route,args)=>{if(args.method==='POST')throw Error('応答なし');return h.respond(route,args);};await h.controller.submit('membership');
 h.hook=(route,args)=>{if(route.includes('?receipt=1'))throw Object.assign(Error('受付未確認'),{status:404,code:'COURT_MEMBERSHIP_RECEIPT_PENDING'});if(args.method==='POST'){assert.equal(args.recoverMembership,true);assert.equal(args.data.expectedRevision,12);throw Object.assign(Error('保存が更新されました'),{status:409,code:'REVISION_CONFLICT'});}return h.respond(route,args);};await h.controller.submit();h.writer.revision=14;
 assert.equal(await h.controller.submit('membership-resend'),false);assert.equal(h.records.size,0);assert.equal(h.controller.snapshot().pending,null);h.controller.dispose();
});
