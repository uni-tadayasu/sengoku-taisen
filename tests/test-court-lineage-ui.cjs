/* Real court controller, durable lineage receipts, and mounted family/name inputs. */
'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test');
const Court=require('../court.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const copy=value=>JSON.parse(JSON.stringify(value)),HOUSES={konoe:'近衛家',kujo:'九条家',ichijo:'一条家',nijo:'二条家',takatsukasa:'鷹司家'};
const requirement={rankId:'court-7',rankName:'従五位',minScore:35000},promotion={officeId:'sadaijin',officeName:'左大臣',minMerit:2000};
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
async function until(check){for(let i=0;i<100;i++){if(check())return;await Promise.resolve();}assert(check(),'async checkpoint');}
function fixture({imperial=false,chosen=imperial}={}){
 const records=new Map(),receipts=new Map(),storage={getItem:key=>records.get(key)||null,setItem:(key,value)=>records.set(key,value),removeItem:key=>records.delete(key)};
 const h={calls:[],frames:[],records,receipts,storage,hook:null,context:{epoch:1,privilegeEpoch:1,accountEpoch:1,playerId:'court-lord',user:{id:'court-lord',name:'公家領主',isStaff:true,isAdmin:false}}};let sequence=0;
 h.info={ok:true,eligible:true,requirement,evaluation:{score:35000,rankName:'従五位'},accessStamp:'court-access-one',self:{id:'court-lord',name:'公家領主',title:imperial?'左大臣':'参議',merit:imperial?2000:0},palace:{level:12,buildings:{},jobCount:0},features:{conversation:true,audience:true},membership:{isMember:true,canJoin:false,reason:'正式加入済み',requirement},lineage:{class:'kuge',houseId:chosen?'konoe':null,houseName:chosen?'近衛家':null,originalClan:'島津家',imperialHouseName:null,needsHouseSelection:!chosen,revision:chosen?1:0,termId:'legacy:term-one',canChooseHouse:!chosen,canCreateImperialHouse:imperial,reason:'',requirement:promotion}};
 h.respond=(route,args={})=>{
  if(route==='/court')return copy(h.info);
  assert.equal(args.method,'POST');assert(['/court/house','/court/imperial-house'].includes(route.split('?')[0]));
  const prior=receipts.get(args.data.requestId);if(prior)return{ok:true,idempotent:true,lineage:copy(h.info.lineage),receipt:copy(prior)};
  if(route.endsWith('?receipt=1'))throw Object.assign(Error('受付未確認'),{status:404,code:'COURT_LINEAGE_RECEIPT_PENDING'});
  const choosing=route==='/court/house',data=args.data,l=h.info.lineage;
  assert.equal(data.expectedRevision,l.revision);assert.equal(data.termId,l.termId);assert.equal(data.confirmed,true);
  if(choosing){l.houseId=data.houseId;l.houseName=HOUSES[data.houseId];l.needsHouseSelection=false;l.canChooseHouse=false;if(h.info.self.merit>=2000)l.canCreateImperialHouse=true;}
  else{l.class='imperial';l.imperialHouseName=data.name;l.canCreateImperialHouse=false;}
  l.revision++;const receipt={requestId:data.requestId,action:choosing?'choose-house':'create-imperial-house',houseId:l.houseId,name:choosing?null:data.name,revision:l.revision};receipts.set(data.requestId,copy(receipt));return{ok:true,idempotent:false,lineage:copy(l),receipt};
 };
 h.options={storage,getContext:()=>h.context,uuid:()=> 'lineage-request-'+(++sequence),onChange:s=>h.frames.push(s),request:async(route,args={})=>{h.calls.push({route,...copy(args)});return h.hook?h.hook(route,args):h.respond(route,args);}};
 h.controller=Court.createController(h.options);return h;
}
const posts=h=>h.calls.filter(call=>call.method==='POST');
const html=h=>Court.markup(h.controller.snapshot());

test('existing unselected members see all five families with no automatic selection',async()=>{
 const h=fixture();await h.controller.load();const {host,$}=setup();host.innerHTML=html(h);assert.equal($('#court-member-house').value,'');assert.deepEqual($('#court-member-house').options.map(row=>row.value),['',...Object.keys(HOUSES)]);assert($('[data-court-action="confirm-house"]').disabled);assert.equal(h.controller.confirmLineage('house'),false);assert.equal(await h.controller.submit('house'),false);assert.equal(posts(h).length,0);assert.match(html(h),/出身の家柄/);assert.match(html(h),/島津家/);h.controller.dispose();
});
test('family registration requires a separate confirmation, pins the term and revision, and adopts only an accepted result',async()=>{
 const h=fixture();await h.controller.load();h.controller.update('houseId','kujo');assert.equal(await h.controller.submit('house'),false);assert(h.controller.confirmLineage('house'));assert.match(html(h),/九条家を家柄として登録しますか/);
 const pause=deferred();h.hook=(route,args)=>args.method==='POST'?pause.promise:h.respond(route,args);const task=h.controller.submit('house');assert.equal(h.controller.snapshot().info.lineage.houseId,null);assert.equal(await h.controller.submit('house'),false);assert.equal(h.controller.update('houseId','nijo'),false);
 const sent=posts(h)[0];assert.deepEqual(sent,{route:'/court/house',method:'POST',data:{expectedRevision:0,termId:'legacy:term-one',confirmed:true,houseId:'kujo',requestId:'lineage-request-1'}});pause.resolve(h.respond(sent.route,sent));assert.equal(await task,true);assert.equal(h.controller.snapshot().info.lineage.houseId,'kujo');assert.equal(h.controller.snapshot().info.lineage.class,'kuge');assert.equal(h.records.size,0);assert.equal(h.controller.snapshot().pending,null);h.controller.dispose();
});
test('editing or cancelling a family review never sends the old choice',async()=>{
 const h=fixture();await h.controller.load();h.controller.update('houseId','ichijo');assert(h.controller.confirmLineage('house'));h.controller.update('houseId','nijo');assert.equal(h.controller.snapshot().confirmation,null);assert.equal(await h.controller.submit('house'),false);assert(h.controller.confirmLineage('house'));h.controller.cancel();assert.equal(await h.controller.submit('house'),false);assert.equal(posts(h).length,0);h.controller.dispose();
});
test('a title or local merit cannot grant imperial-house creation before the server grants creation permission',async()=>{
 const h=fixture({chosen:true});h.info.self.title='左大臣';h.info.self.merit=999999;await h.controller.load();h.controller.update('imperialName','桜宮');assert.equal(h.controller.confirmLineage('imperial-house'),false);assert.equal(await h.controller.submit('imperial-house'),false);assert.doesNotMatch(html(h),/court-imperial-name/);assert.equal(h.controller.snapshot().info.lineage.class,'kuge');assert.equal(posts(h).length,0);h.controller.dispose();
});
test('imperial-house names use NFKC and code-point limits, with a deliberate review before one-time creation',async()=>{
 const h=fixture({imperial:true});await h.controller.load();for(const name of ['','宮','宮'.repeat(21),'桜\n宮','桜\u0000宮']){h.controller.update('imperialName',name);assert.equal(h.controller.confirmLineage('imperial-house'),false);}
 h.controller.update('imperialName','　ＡＢ宮　');assert(h.controller.confirmLineage('imperial-house'));assert.equal(h.controller.snapshot().confirmation.name,'AB宮');assert.match(html(h),/宮家「AB宮」を創立し、皇族になりますか/);assert.equal(posts(h).length,0);assert.equal(await h.controller.submit('imperial-house'),true);assert.equal(posts(h)[0].data.name,'AB宮');assert.equal(h.controller.snapshot().info.lineage.imperialHouseName,'AB宮');assert.equal(h.controller.snapshot().info.lineage.class,'imperial');assert.equal(h.controller.confirmLineage('imperial-house'),false);assert.doesNotMatch(html(h),/court-imperial-name/);h.controller.dispose();
});
test('a changed name discards the preview and the exact normalized reviewed name is sent',async()=>{
 const h=fixture({imperial:true});await h.controller.load();h.controller.update('imperialName','桜宮');h.controller.confirmLineage('imperial-house');h.controller.update('imperialName','葵宮');assert.equal(h.controller.snapshot().confirmation,null);assert.equal(await h.controller.submit('imperial-house'),false);assert(h.controller.confirmLineage('imperial-house'));assert.equal(await h.controller.submit('imperial-house'),true);assert.equal(posts(h).length,1);assert.equal(posts(h)[0].data.name,'葵宮');h.controller.dispose();
});
test('lost responses recover the same accepted operation after reload without creating another house',async()=>{
 for(const kind of ['house','imperial-house']){
  const h=fixture({imperial:kind==='imperial-house'});await h.controller.load();h.controller.update(kind==='house'?'houseId':'imperialName',kind==='house'?'takatsukasa':'桜宮');assert(h.controller.confirmLineage(kind));h.hook=(route,args)=>{if(args.method==='POST'){h.respond(route,args);throw Error('通信断');}return h.respond(route,args);};assert.equal(await h.controller.submit(kind),false);assert.equal(h.records.size,1);const original=copy(posts(h)[0]);h.controller.dispose();h.hook=null;h.controller=Court.createController(h.options);await h.controller.load();assert.equal(h.controller.snapshot().pending.kind,kind);assert.equal(await h.controller.submit(),true);assert.equal(posts(h).at(-1).route,original.route+'?receipt=1');assert.deepEqual(posts(h).at(-1).data,original.data);assert.equal(h.receipts.size,1);assert.equal(h.records.size,0);h.controller.dispose();
 }
});
test('receipt absence never automatically creates a family or house; explicit resend retains the exact intent',async()=>{
 const h=fixture({imperial:true});await h.controller.load();h.controller.update('imperialName','桜宮');h.controller.confirmLineage('imperial-house');h.hook=(route,args)=>{if(args.method==='POST')throw Error('未配信');return h.respond(route,args);};assert.equal(await h.controller.submit('imperial-house'),false);h.hook=null;assert.equal(await h.controller.submit(),false);assert.equal(h.controller.snapshot().lineageReceiptMissing,true);assert.equal(h.receipts.size,0);assert.match(html(h),/同じ内容を再送する/);assert.equal(await h.controller.submit('lineage-resend'),true);assert.deepEqual(posts(h)[0].data,posts(h).at(-1).data);assert.equal(posts(h).filter(call=>!call.route.includes('?')).length,2);h.controller.dispose();
});
test('a verified rejection clears its pending record and lets the player revise the proposed name',async()=>{
 const h=fixture({imperial:true});await h.controller.load();h.controller.update('imperialName','桜宮');h.controller.confirmLineage('imperial-house');h.hook=(route,args)=>{if(args.method==='POST')throw Object.assign(Error('この宮家名は使用されています。'),{status:409,code:'COURT_IMPERIAL_HOUSE_NAME_TAKEN'});return h.respond(route,args);};assert.equal(await h.controller.submit('imperial-house'),false);assert.equal(h.controller.snapshot().pending,null);assert.equal(h.controller.snapshot().confirmation,null);assert.equal(h.records.size,0);assert.equal(h.controller.snapshot().drafts.imperialName,'桜宮');assert.match(h.controller.snapshot().error,/使用されています/);assert(h.controller.update('imperialName','葵宮'));h.controller.dispose();
});
test('a receipt for another choice, name, revision or request cannot change the displayed class or clear recovery',async()=>{
 for(const change of [r=>r.receipt.houseId='nijo',r=>r.receipt.name='別宮',r=>r.receipt.revision++,r=>r.receipt.requestId='other-request',r=>r.lineage.canCreateImperialHouse='true']){
  const h=fixture({imperial:true});await h.controller.load();h.controller.update('imperialName','桜宮');h.controller.confirmLineage('imperial-house');h.hook=(route,args)=>{if(args.method!=='POST')return h.respond(route,args);const r=h.respond(route,args);change(r);return r;};assert.equal(await h.controller.submit('imperial-house'),false);assert.equal(h.controller.snapshot().info.lineage.imperialHouseName,null);assert.equal(h.controller.snapshot().pending.lookup,true);assert.equal(h.records.size,1);h.controller.dispose();
 }
});
test('an account change discards a delayed accepted response and preserves only the original account recovery record',async()=>{
 const h=fixture();await h.controller.load();h.controller.update('houseId','konoe');h.controller.confirmLineage('house');const pause=deferred();h.hook=(route,args)=>args.method==='POST'?pause.promise:h.respond(route,args);const task=h.controller.submit('house'),sent=posts(h)[0],accepted=h.respond(sent.route,sent);h.context={...h.context,epoch:2,accountEpoch:2,playerId:'another-lord',user:{id:'another-lord',name:'別の領主'}};h.controller.refresh();pause.resolve(accepted);assert.equal(await task,false);const state=h.controller.snapshot();assert.equal(state.pending,null);assert.equal(state.confirmation,null);assert.equal(state.drafts.houseId,'');assert.equal(h.records.size,1);assert.doesNotMatch(Court.markup(state),/島津家|konoe/);h.controller.dispose();
});
test('background reads cannot resurrect a pre-write family state or replace a pending command',async()=>{
 const h=fixture();await h.controller.load();h.controller.update('houseId','kujo');h.controller.confirmLineage('house');const pause=deferred(),old=copy(h.info);let read=0;h.hook=(route,args)=>route==='/court'&&++read===1?pause.promise:h.respond(route,args);const poll=h.controller.load({background:true});assert.equal(await h.controller.submit('house'),true);pause.resolve(old);assert.equal(await poll,false);assert.equal(h.controller.snapshot().info.lineage.houseId,'kujo');assert.equal(h.controller.snapshot().pending,null);h.controller.dispose();
});
test('a changed revision or term disables and rejects the earlier confirmation',async()=>{
 for(const change of ['revision','term']){const h=fixture({imperial:true});await h.controller.load();h.controller.update('imperialName','桜宮');h.controller.confirmLineage('imperial-house');if(change==='revision')h.info.lineage.revision++;else h.info.lineage.termId='another-term';await h.controller.load({background:true});const {host,$}=setup();host.innerHTML=html(h);assert($('[data-court-action="commit-imperial-house"]').disabled);assert.match($('.court-lineage-stale').textContent,/更新されました/);assert.equal(await h.controller.submit('imperial-house'),false);assert.equal(posts(h).length,0);h.controller.dispose();}
});
test('storage failure prevents an irreversible family or name submission',async()=>{
 const h=fixture();h.storage.setItem=()=>{throw Error('保存不可');};await h.controller.load();h.controller.update('houseId','konoe');h.controller.confirmLineage('house');assert.equal(await h.controller.submit('house'),false);assert.equal(posts(h).length,0);assert.equal(h.controller.snapshot().info.lineage.houseId,null);h.controller.dispose();
});
test('malformed lineage data cannot authorize actions and custom names and origin are always escaped',async()=>{
 const h=fixture({imperial:true});const valid=copy(h.info.lineage);for(const change of [r=>r.class='emperor',r=>r.houseId='other',r=>r.houseName='<img>',r=>r.revision='1',r=>r.canCreateImperialHouse='true',r=>r.termId='',r=>r.imperialHouseName='宮'.repeat(21),r=>r.requirement.minMerit=NaN,r=>{r.class='imperial';r.canCreateImperialHouse=true;}]){const value=copy(valid);change(value);assert.throws(()=>Court.cleanLineage(value));}
 h.info.lineage.class='imperial';h.info.lineage.originalClan='<origin>';h.info.lineage.imperialHouseName='<img src=x>';h.info.lineage.canCreateImperialHouse=false;await h.controller.load();assert.match(html(h),/&lt;origin&gt;/);assert.match(html(h),/&lt;img src=x&gt;/);assert.doesNotMatch(html(h),/<img|<origin>/);h.controller.dispose();
});
test('mounted name entry and background polls preserve the input, draft, focus, caret and scroll',async()=>{
 const h=fixture({imperial:true}),{host,doc,$}=setup();global.SengokuStableDOM=stable;const mounted=Court.mount(host,h.options);await until(()=>!!mounted.controller.snapshot().info);const input=$('#court-imperial-name');input.focus();input.value='桜宮';input.dispatchEvent({type:'input'});input.setSelectionRange(1,2);host.scrollTop=383;await mounted.controller.load({background:true});assert.strictEqual($('#court-imperial-name'),input);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'桜宮');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,2);assert.equal(host.scrollTop,383);input.value='桜宮未確定';await mounted.controller.load({background:true});assert.equal(input.value,'桜宮未確定','uncommitted IME text is not overwritten by an unrelated poll');mounted.dispose();h.controller.dispose();delete global.SengokuStableDOM;
});
test('mounted Enter opens the name confirmation and only the final button sends it',async()=>{
 const h=fixture({imperial:true}),{host,$}=setup();global.SengokuStableDOM=stable;const mounted=Court.mount(host,h.options);await until(()=>!!mounted.controller.snapshot().info);const input=$('#court-imperial-name');input.value='桜宮';input.dispatchEvent({type:'input'});$('[data-court-form="imperial-house-preview"]').dispatchEvent({type:'submit'});assert.equal(mounted.controller.snapshot().confirmation.kind,'imperial-house');assert.equal(posts(h).length,0);assert($('.court-lineage-confirm').scrollIntoViewCalls>0);$('[data-court-action="commit-imperial-house"]').dispatchEvent({type:'click'});await until(()=>!mounted.controller.snapshot().sending);assert.equal(posts(h).length,1);assert.equal(posts(h)[0].data.name,'桜宮');mounted.dispose();h.controller.dispose();delete global.SengokuStableDOM;
});

test('only a validated result starts a background profile refresh and a failed refresh never undoes success',async()=>{
 let refreshes=0;global.SengokuSocial={refresh:()=>{refreshes++;return Promise.reject(Error('profile offline'));}};
 const h=fixture();await h.controller.load();h.controller.update('houseId','konoe');h.controller.confirmLineage('house');assert.equal(await h.controller.submit('house'),true);assert.equal(refreshes,1);assert.equal(h.controller.snapshot().info.lineage.houseId,'konoe');assert.equal(h.controller.snapshot().pending,null);assert.match(h.controller.snapshot().message,/登録しました/);h.controller.dispose();
 const bad=fixture();await bad.controller.load();bad.controller.update('houseId','kujo');bad.controller.confirmLineage('house');bad.hook=(route,args)=>{const result=bad.respond(route,args);if(args.method==='POST')result.receipt.houseId='nijo';return result;};assert.equal(await bad.controller.submit('house'),false);assert.equal(refreshes,1);bad.controller.dispose();delete global.SengokuSocial;
});
