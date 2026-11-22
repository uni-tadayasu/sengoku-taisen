(async function(){
 const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
 const storage=new Map(),requests=[],TOKEN='a'.repeat(64),roles=[],syncSessions=[],giftCalls=[],feedback=[];let handler=async()=>({ok:true}),canReceive=true,bridgeSuccess=false,bridgeCalls=0,overlays=0;
 const context={FormData:class{constructor(form){this.values=form.values;}get(key){return this.values[key]??null;}},console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:crypto.webcrypto,document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(url,options)=>{requests.push({url,options});const payload=await handler(url,options);return{ok:!payload.__status,status:payload.__status||200,json:async()=>payload};},SENGOKU_API_BASE:'https://api.example.invalid',SengokuLoading:{begin(){overlays++;return overlays;},end(){}},SengokuCloudSync:{stop(){},start:session=>{syncSessions.push(session);},getStatus:()=>({linked:true,ready:true,writable:false,reason:'follower',message:'別の端末から同期中'}),getDevice:()=>({id:'device',name:'検証端末'})},SengokuBridge:{setAdminAccess:role=>roles.push(role),setSyncAccess(){},canReceiveGifts:()=>canReceive,applyGift:(gift,receiptId)=>{bridgeCalls++;giftCalls.push({gift,receiptId});return bridgeSuccess?{ok:true}:{ok:false,retryable:true,message:'Local test save blocked'};},toast:(message,error)=>feedback.push({message,error})}};
 context.window=context;vm.createContext(context);
 const filename=require('node:path').join(__dirname,'../social.js');
 let source=fs.readFileSync(filename,'utf8');
 source=source.replace('global.SengokuSocial={open','global.__socialTest={s,api,loadMe,canShowOperatorRecovery,loadChat,claimGift,clearPrivate,installIdentity,onlineView,syncView,registerView,tabs,acceptUser,channel,role,adminView,profileView,loadStaff,staffView,staffConfirmation,giftLabel,mailView,submit,clearConfirm,setUI:(d,b)=>{dialog=d;body=b;},setEpoch:v=>{authEpoch=v;}};global.SengokuSocial={open');
 vm.runInContext(source,context);const t=context.__socialTest;t.s.identity={id:'u_a',token:TOKEN};t.s.user={id:'u_a',name:'検証',isAdmin:false,guildId:null};t.s.tab='world';
 handler=async()=>({ok:true,messages:[],nextAfter:0});await t.loadChat();
 assert(!new URL(requests.at(-1).url).searchParams.has('after'));
 assert.equal(requests.at(-1).options.headers.Authorization,'Bearer '+TOKEN);assert(!requests.at(-1).url.includes(TOKEN));
 assert.equal(requests.at(-1).options.redirect,'error');assert.equal(requests.at(-1).options.referrerPolicy,'no-referrer');
 const trusted=context.SENGOKU_API_BASE;
 for(const invalid of ['http://api.example.invalid','https://account@example.invalid','https://example.invalid/?custom=1']){
  context.SENGOKU_API_BASE=invalid;const count=requests.length;await assert.rejects(t.api('/me'));assert.equal(requests.length,count);
 }
 context.SENGOKU_API_BASE=trusted;
 let resolve;handler=()=>new Promise(r=>{resolve=r;});
 const stale=t.api('/me');t.setEpoch(1);resolve({ok:true,user:{id:'u_old'}});await assert.rejects(stale,e=>e.code==='STALE_IDENTITY');
 let explicitResolve;handler=()=>new Promise(r=>{explicitResolve=r;});
 const imported=t.api('/me',{token:'b'.repeat(64)});t.setEpoch(2);explicitResolve({ok:true,user:{id:'u_import'}});assert.equal((await imported).user.id,'u_import');
 t.s.mail=[{id:'m1',gift:{gold:10,rice:0,wood:0,stone:0},claimed:false}];
 canReceive=false;const before=requests.length;await assert.rejects(t.claimGift('m1'));assert.equal(requests.length,before);
 canReceive=true;const ids=[];
 handler=async(url,options)=>{if(url.endsWith('/mail/claim')){const data=JSON.parse(options.body);ids.push(data.requestId);assert(storage.get('sengoku-mail-claims-v1').includes(data.requestId));return{ok:true,gift:{gold:10,rice:0,wood:0,stone:0},receiptId:'receipt1'};}if(url.endsWith('/mail'))return{ok:true,mail:[{id:'m1',gift:{gold:10,rice:0,wood:0,stone:0},claimed:true}]};return{ok:true};};
 await assert.rejects(t.claimGift('m1'),/Local test save blocked/);assert(t.s.pending['u_a:m1']);assert.equal(bridgeCalls,1);
 bridgeSuccess=true;await t.claimGift('m1');assert.equal(ids[0],ids[1]);assert.equal(bridgeCalls,2);assert.equal(t.s.pending['u_a:m1'],undefined);
 // Magatama-only mail keeps its full reward through a failed local save and retry.
 const magGift={gold:0,rice:0,wood:0,stone:0,magatama:2700},magClaimIds=[];
 t.s.mail=[{id:'m-mag',title:'勾玉の褒賞',body:'招集にお使いください。',createdAt:'2026-11-21T00:00:00Z',gift:magGift,claimed:false}];t.s.openedMail='m-mag';
 assert(t.mailView().includes('勾玉 2,700'));assert.equal(t.giftLabel({gold:10,rice:0,wood:0,stone:0}),'金 10');assert.equal(t.giftLabel({magatama:0}),'添付なし');
 handler=async(url,options)=>{if(url.endsWith('/mail/claim')){magClaimIds.push(JSON.parse(options.body).requestId);return{ok:true,gift:magGift,receiptId:'receipt-mag'};}if(url.endsWith('/mail'))return{ok:true,mail:[{id:'m-mag',gift:magGift,claimed:true}]};return{ok:true};};
 bridgeSuccess=false;await assert.rejects(t.claimGift('m-mag'),/Local test save blocked/);assert(t.s.pending['u_a:m-mag']);assert.deepEqual(giftCalls.at(-1),{gift:magGift,receiptId:'receipt-mag'});
 bridgeSuccess=true;await t.claimGift('m-mag');assert.equal(magClaimIds[0],magClaimIds[1]);assert.deepEqual(giftCalls.at(-1),{gift:magGift,receiptId:'receipt-mag'});assert.equal(t.s.pending['u_a:m-mag'],undefined);
 t.s.mail=[{body:'private'}];t.s.members=[{name:'private'}];t.s.players=[{name:'private'}];t.clearPrivate();assert.equal(t.s.mail.length,0);assert.equal(t.s.members.length,0);assert.equal(t.s.players.length,0);
 handler=async()=>({ok:true});const beforeOverlays=overlays;await t.api('/presence',{method:'POST',data:{online:true},background:true});await t.api('/sync/lease',{method:'POST',data:{deviceId:'device'},background:true});assert.equal(overlays,beforeOverlays,'background synchronization never opens a loading overlay');
 const beforeStale=requests.length;await assert.rejects(t.api('/sync',{identityEpoch:1,background:true}),e=>e.code==='STALE_IDENTITY');assert.equal(requests.length,beforeStale,'obsolete explicit-token generations are rejected before sending');
 handler=async()=>({__status:409,ok:false,error:{code:'REVISION_CONFLICT',message:'newer save'}});await assert.rejects(t.api('/sync',{method:'PUT',data:{},background:true}),e=>e.code==='REVISION_CONFLICT'&&e.status===409&&e.data.error.code==='REVISION_CONFLICT');
 t.installIdentity({id:'operator',token:TOKEN},{id:'operator',name:'運営候補',isAdmin:true});assert.equal(t.s.user.isAdmin,false,'pair/session response alone does not confer admin UI');assert.equal(roles.at(-1),false);assert.equal(syncSessions.at(-1).id,'operator');assert(!JSON.stringify(t.syncView()).includes(TOKEN),'identity token is never placed in sync UI');
 handler=async()=>({ok:true,user:{id:'operator',name:'運営',isAdmin:true},management:{recoveryAvailable:true},friends:[],requests:[]});await t.loadMe();assert.equal(t.canShowOperatorRecovery(),true);assert.equal(t.s.user.isAdmin,true);assert.equal(roles.at(-1),true,'only verified /me updates the bridge role');
 const roleChecks=[];context.SengokuBridge.setRoleAccess=role=>roleChecks.push({...role});
 t.acceptUser(null);assert.deepEqual(roleChecks.at(-1),{isAdmin:false,isStaff:false,pending:true},'An unknown linked identity suspends its role without confirming demotion');
 t.acceptUser({id:'operator',name:'一般領主',isAdmin:false,isStaff:false});assert.equal(t.canShowOperatorRecovery(),false);t.s.config.adminClaimed=false;t.s.config.adminRecoveryAvailable=true;assert(!t.profileView().includes('social-admin-claim'));assert(!t.profileView().includes('初回運営登録'));assert(!t.syncView().includes('運営'));assert.deepEqual(roleChecks.at(-1),{isAdmin:false,isStaff:false,pending:false},'A verified ordinary identity confirms the role restriction');
 t.acceptUser({id:'operator',name:'運営',isAdmin:true});assert.deepEqual(roleChecks.at(-1),{isAdmin:true,isStaff:false,pending:false});delete context.SengokuBridge.setRoleAccess;
 t.s.pairCode={code:'ABC123DEF456',expiresAt:new Date(Date.now()+600000).toISOString()};assert(t.syncView().includes('ABC123DEF456'));assert(!t.syncView().includes(TOKEN));
 t.s.user=null;t.s.onlinePlayers=[{id:'public',name:'<script>bad</script>',clan:'<clan>',isAdmin:false}];t.s.onlineLoaded=true;t.s.onlineTotal=1;const publicView=t.onlineView();assert(publicView.includes('&lt;script&gt;'));assert(!publicView.includes('<script>'));assert(t.tabs().some(tab=>tab.id==='online'));assert(t.tabs().some(tab=>tab.id==='sync'));assert(!t.registerView().includes('id="social-register-form"'),'linked identity cannot be replaced through an unconfirmed registration form');
 let pendingLink;handler=()=>new Promise(resolve=>{pendingLink=resolve;});const link=t.api('/devices/link',{auth:false,method:'POST',data:{code:'ABC123DEF456'}});t.installIdentity({id:'replacement',token:'c'.repeat(64)},{id:'replacement',name:'新しい領主',isAdmin:false});pendingLink({ok:true,user:{id:'operator'},token:TOKEN});await assert.rejects(link,e=>e.code==='STALE_IDENTITY','pending pairing responses cannot replace a newer identity');
 assert(source.includes('maxlength="300" rows="5"'));assert(source.includes('maxlength="60"'));assert(source.includes('maxlength="2000"'));assert(source.includes('max="1000000"'));
 // Staff is a separately verified chat role, never an operator entitlement.
 t.installIdentity({id:'staff-actor',token:TOKEN},{id:'staff-actor',name:'連絡係',clan:'德川家',isAdmin:false,isStaff:true});
 assert.equal(t.s.user.isStaff,false,'An imported/session role must await a verified server response');
 handler=async()=>({ok:true,user:{id:'staff-actor',name:'連絡係',clan:'德川家',isAdmin:false,isStaff:true},friends:[],requests:[]});await t.loadMe();
 assert.equal(t.s.user.isStaff,true);assert.equal(roles.at(-1),false,'Staff never grants game operator access');
 assert.equal(context.SengokuSocial.getUser().clan,'德川家');assert.equal(context.SengokuSocial.getUser().isStaff,true);assert.equal(context.SengokuSocial.getUser().isAdmin,false);assert(!JSON.stringify(context.SengokuSocial.getUser()).includes(TOKEN));
 assert(t.tabs().some(tab=>tab.id==='admin'));t.s.tab='admin';t.s.adminSection='mail';const staffView=t.adminView();
 assert.equal(t.s.adminSection,'chat');assert.equal(t.channel().channel,'admin');assert(staffView.includes('スタッフ'));
 assert(!staffView.includes('social-admin-mail-form'));assert(!staffView.includes('social-announcement-form'));assert(!staffView.includes('social-staff-search-form'));assert(!staffView.includes('data-social="admin-section"'));
 t.s.config.adminClaimed=false;assert.match(t.profileView(),/家は德川家、本拠は占領されない京都御所/);assert(!t.profileView().includes('家名・資源'));assert(!t.profileView().includes('social-admin-claim-form'));assert(!t.profileView().includes('data-social="admin-restore"'));
 const staffReadCount=requests.length;await assert.rejects(t.loadStaff(),/運営権限/);await assert.rejects(context.SengokuSocial.setWorldClock({running:false}),/運営権限/);assert.throws(()=>t.staffConfirmation('other','appoint'),/運営権限/);assert.equal(requests.length,staffReadCount,'Staff-only actor sends no owner-only requests');
 for(const clan of ['徳川家','德川家']){t.acceptUser({id:'staff-actor',name:'一般領主',clan,isAdmin:false,isStaff:false});assert(!t.tabs().some(tab=>tab.id==='admin'));assert(!t.profileView().includes('data-social="admin-restore"'));assert.equal(roles.at(-1),false);}
 t.acceptUser({id:'staff-actor',name:'連絡係',clan:'德川家',isAdmin:false,isStaff:true});t.s.tab='admin';

 // A demotion received through the actual coordinator callback clears both the
 // visible private view and caches; a previously authorized late response cannot
 // put private messages back after the role has been removed.
 const uiBody={innerHTML:'SECRET PRIVATE CHAT',inert:true},uiTabs={innerHTML:'',inert:true},uiConfirm={innerHTML:'OLD PRIVATE CONFIRMATION'};
 const uiDialog={querySelector:selector=>({'#social-tabs':uiTabs,'#social-confirm-host':uiConfirm}[selector]||null),querySelectorAll:()=>[]};
 t.setUI(uiDialog,uiBody);t.s.chats.set('admin:',{messages:[{id:1,text:'SECRET PRIVATE CHAT'}],after:1});t.s.chats.set('world:',{messages:[{id:2,text:'PUBLIC'}],after:2});t.s.confirm={onConfirm(){throw Error('old confirmation must be discarded');}};
 let lateChat;handler=()=>new Promise(resolve=>{lateChat=resolve;});const privateLoad=t.loadChat();
 syncSessions.at(-1).onUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:false});
 assert.equal(t.s.tab,'profile');assert.equal(t.s.confirm,null);assert.equal(uiConfirm.innerHTML,'');assert.equal(uiBody.inert,false);assert(!uiBody.innerHTML.includes('SECRET PRIVATE CHAT'));assert(!t.s.chats.has('admin:'));assert(t.s.chats.has('world:'));
 lateChat({ok:true,messages:[{id:3,text:'LATE PRIVATE CHAT'}],nextAfter:3});await privateLoad;assert(!t.s.chats.has('admin:'),'Late authorized responses cannot refill a revoked cache');assert(!t.tabs().some(tab=>tab.id==='admin'));t.setUI(null,null);
 t.acceptUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:true});t.s.tab='admin';t.s.chats.set('admin:',{messages:[{id:4,text:'private'}],after:4});
 handler=async()=>({ok:true,user:{id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:false},friends:[],requests:[]});await t.loadMe();assert.equal(t.s.tab,'profile');assert(!t.s.chats.has('admin:'));
 t.acceptUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:true});t.s.tab='admin';let oldMe;handler=()=>new Promise(resolve=>{oldMe=resolve;});const staleRoleLoad=t.loadMe();syncSessions.at(-1).onUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:false});oldMe({ok:true,user:{id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:true},friends:[],requests:[]});await staleRoleLoad;assert.equal(t.s.user.isStaff,false,'An older in-flight /me cannot restore a role removed by a newer sync response');
 t.acceptUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:true});t.s.tab='admin';t.s.chats.set('admin:',{messages:[{id:5,text:'private'}],after:5});
 handler=async()=>({__status:403,ok:false,error:{code:'STAFF_CHAT_REQUIRED',message:'staff role was removed'}});await assert.rejects(t.loadChat(),error=>error.code==='STAFF_CHAT_REQUIRED');assert.equal(t.s.user.isStaff,false);assert.equal(t.s.tab,'profile');assert(!t.s.chats.has('admin:'));

 // The confirmation holds one operation UUID across uncertain-response retries.
 // Its response describes the target and must not replace the operator identity.
 t.acceptUser({id:'staff-actor',name:'運営本人',isAdmin:true,isStaff:true});assert.equal(t.s.user.isStaff,false,'Operator has the owner badge, never an additional staff role');t.s.tab='admin';t.s.adminSection='staff';
 const target={id:'target-player',name:'<script>連絡役</script>',clan:'武田家',isAdmin:false,isStaff:false};t.s.staffCandidates=[target];
 handler=async()=>({ok:true,staff:[]});await t.loadStaff();const ownerView=t.adminView();assert(ownerView.includes('スタッフ管理'));assert(ownerView.includes('social-staff-search-form'));assert(ownerView.includes('&lt;script&gt;'));assert(!ownerView.includes('<script>'));
 const beforeConfirm=requests.length,confirmation=t.staffConfirmation(target.id,'appoint');assert.equal(requests.length,beforeConfirm,'Opening confirmation cannot appoint anyone');assert(confirmation.details.includes('&lt;script&gt;'));assert.equal(confirmation.confirmLabel,'この領主を任命');assert.match(confirmation.description,/家は德川家、本拠はスタッフ共同の京都御所/);assert(!confirmation.description.includes('家名・個人資源は維持'));
 const operationIds=[];let attempts=0;
 handler=async(url,options)=>{assert(url.endsWith('/admin/staff'));const payload=JSON.parse(options.body);operationIds.push(payload.requestId);assert.equal(payload.targetPlayerId,target.id);assert.equal(payload.action,'appoint');attempts++;if(attempts===1)throw Error('response lost after commit');return{ok:true,user:{...target,clan:'德川家',isStaff:true},staff:[{...target,clan:'德川家',isStaff:true,appointedAt:new Date().toISOString(),appointedBy:'staff-actor'}],action:'appoint',idempotent:true};};
 await assert.rejects(confirmation.onConfirm(),/response lost/);await confirmation.onConfirm();assert(operationIds[0]);assert.equal(operationIds[0],operationIds[1]);assert.equal(t.s.user.id,'staff-actor');assert.equal(t.s.user.name,'運営本人');assert.equal(t.s.user.isAdmin,true);assert.equal(t.s.identity.token,TOKEN);assert.equal(t.s.staff.length,1);assert.equal(t.s.staffCandidates[0].isStaff,true);assert.equal(t.s.staffCandidates[0].clan,'德川家');
 const dismissal=t.staffConfirmation(target.id,'dismiss');assert.equal(dismissal.danger,true);assert.equal(dismissal.confirmLabel,'スタッフを解任');assert.match(dismissal.description,/任命前の家と本拠に戻ります/);
 handler=async(url,options)=>{const payload=JSON.parse(options.body);assert.equal(payload.action,'dismiss');assert.notEqual(payload.requestId,operationIds[0],'A new explicit intent uses a new operation UUID');return{ok:true,user:target,staff:[],action:'dismiss',idempotent:false};};await dismissal.onConfirm();assert.equal(t.s.staff.length,0);assert.equal(t.s.staffCandidates[0].isStaff,false);assert.equal(t.s.user.isAdmin,true);
 handler=async()=>({ok:true,user:target,staff:[],action:'appoint',idempotent:true});await confirmation.onConfirm();assert.equal(t.s.staffCandidates[0].isStaff,false,'Replaying an older appointment displays the current dismissed state');
 t.s.staffCandidates.push({id:'staff-actor',name:'運営本人',isAdmin:true});assert.throws(()=>t.staffConfirmation('staff-actor','appoint'));
 let lateRoster;handler=()=>new Promise(resolve=>{lateRoster=resolve;});const privateRoster=t.loadStaff();const pendingConfirm=t.staffConfirmation(target.id,'appoint');t.acceptUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:false},{fromSync:true});lateRoster({ok:true,staff:[{...target,isStaff:true}]});await privateRoster;assert.equal(t.s.staff.length,0);const deniedCount=requests.length;await assert.rejects(pendingConfirm.onConfirm(),/運営権限/);assert.equal(requests.length,deniedCount,'A revoked owner cannot confirm an old appointment');
 assert.equal(t.role({isStaff:true}),'');assert.equal(t.role({isAdmin:true,isStaff:true}),'');assert.equal(t.role({isAdmin:false,isStaff:false}),'');
 // Exercise the real form submit and confirmation path, including lost-response
 // retries, legacy zero amounts, boundaries and staff-only permission rejection.
 t.acceptUser({id:'staff-actor',name:'運営本人',clan:'徳川家',isAdmin:true,isStaff:false});t.s.tab='admin';t.s.adminSection='mail';
 const mailAdminView=t.adminView();assert(mailAdminView.includes('name="magatama" type="number" min="0" max="1000000" step="1"'));
 assert(mailAdminView.includes('資源・勾玉'));assert(t.profileView().includes('德川家康Uを復元'));assert(!t.profileView().includes('徳川家康U'));
 const giftUiBody={innerHTML:'',inert:false},giftUiTabs={innerHTML:'',inert:false},giftUiHost={innerHTML:'',querySelector:()=>({focus(){}})};
 const giftUiDialog={querySelector:selector=>({'#social-tabs':giftUiTabs,'#social-confirm-host':giftUiHost}[selector]||null),querySelectorAll:()=>[]};
 t.setUI(giftUiDialog,giftUiBody);
 const baseValues={target:'all',title:'勾玉のお届け',body:'領主の皆さまへの贈り物です。',gold:'0',rice:'0',wood:'0',stone:'0',magatama:'1000000'};
 const submitButton={disabled:false,isConnected:true};let resetCount=0;
 const mailForm={id:'social-admin-mail-form',values:{...baseValues},querySelector:()=>submitButton,reset(){resetCount++;}};
 const submitMail=()=>t.submit({target:mailForm,submitter:submitButton,preventDefault(){}});
 const sendCount=requests.length;await submitMail();assert.equal(requests.length,sendCount,'Preparing a gift confirmation never sends mail');assert(giftUiHost.innerHTML.includes('勾玉 1,000,000'));
 const mailConfirmation=t.s.confirm,mailRequestIds=[];let sendAttempts=0;
 handler=async(url,options)=>{assert(url.endsWith('/admin/mail'));const payload=JSON.parse(options.body);mailRequestIds.push(payload.requestId);assert.deepEqual(payload.gift,{gold:0,rice:0,wood:0,stone:0,magatama:1000000});if(++sendAttempts===1)throw Error('mail response lost');return{ok:true,mailId:'mail-mag',alreadySent:true};};
 await assert.rejects(mailConfirmation.onConfirm(),/mail response lost/);await mailConfirmation.onConfirm();assert(mailRequestIds[0]);assert.equal(mailRequestIds[0],mailRequestIds[1]);assert.equal(resetCount,1);t.clearConfirm();
 // Older forms without a magatama value remain valid and zero gifts stay unattached.
 mailForm.values={...baseValues,gold:'25'};delete mailForm.values.magatama;await submitMail();assert(giftUiHost.innerHTML.includes('金 25'));assert(!giftUiHost.innerHTML.includes('勾玉 0'));
 handler=async(url,options)=>{const payload=JSON.parse(options.body);assert.equal(payload.gift.gold,25);assert.equal(payload.gift.magatama,0);return{ok:true,mailId:'legacy-mail'};};await t.s.confirm.onConfirm();t.clearConfirm();
 mailForm.values={...baseValues,magatama:'0'};await submitMail();assert(giftUiHost.innerHTML.includes('添付なし'));
 handler=async(url,options)=>{assert.equal(JSON.parse(options.body).gift,null);return{ok:true,mailId:'plain-mail'};};await t.s.confirm.onConfirm();t.clearConfirm();
 for(const amount of ['-1','0.5','1000001','Infinity','NaN','invalid']){mailForm.values={...baseValues,magatama:amount};const beforeInvalid=requests.length;await submitMail();assert.equal(requests.length,beforeInvalid);assert.equal(t.s.confirm,null);assert.match(feedback.at(-1).message,/0〜1,000,000の整数/);}
 t.acceptUser({id:'staff-actor',name:'連絡係',isAdmin:false,isStaff:true});t.s.adminSection='mail';assert(!t.adminView().includes('name="magatama"'));
 mailForm.values={...baseValues,magatama:'300'};const staffSendCount=requests.length;await submitMail();assert.equal(requests.length,staffSendCount);assert.equal(t.s.confirm,null);assert.match(feedback.at(-1).message,/運営権限/);t.setUI(null,null);
 console.log('Social local tests passed: prior chat/auth/gift/sync regressions plus separate verified staff role, chat-only routing, owner-only controls, /me and sync demotion, visible/cache cleanup, late private responses, 403 revocation, confirmation UUID retries, target identity isolation, stale staff operations, magatama-only mail display/claim, sender confirmation retries, legacy gift compatibility, amount boundaries and staff send denial. No network requests were made.');
})().catch(e=>{console.error(e);process.exitCode=1;});

