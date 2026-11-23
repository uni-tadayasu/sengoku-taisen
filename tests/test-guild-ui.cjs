const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8'),TOKEN='q'.repeat(64),NOW='2026-11-22T10:00:00Z';
const balance={gold:5000,rice:6000,wood:7000,stone:8000,magatama:9000,revision:1};
const member=(id,guildRole='member')=>({id,name:'領主 '+id,clan:'織田家',guildId:'g1',guildName:'霞の盟約',guildRole,isAdmin:false,isStaff:false});
function setup(role='owner'){
 const requests=[],transfers=[],timers=new Map(),nodes=new Map(),notices=[];let timerId=0,handler,transfer=async()=>({ok:true});
 const c={console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,FormData:class{constructor(f){this.v=f.values;}get(k){return this.v[k]??null;}},
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),document:{readyState:'loading',hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://api.example.invalid',
  SengokuCloudSync:{start(){},stop(){},getStatus:()=>({linked:true,ready:true,writable:true})},
  SengokuBridge:{setAdminAccess(){},setSyncAccess(){},toast:(message,error)=>notices.push({message,error}),hasStarted:()=>true,getState:()=>({resources:{gold:10000,rice:10000,wood:10000,stone:10000},magatama:10000}),applyGift(){throw Error('Guild transfer must never apply a gift locally');},guildTransfer:async payload=>{transfers.push(payload);return transfer(payload);}},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};}
 };
 const make=()=>({_html:'',writes:0,get innerHTML(){return this._html;},set innerHTML(v){this._html=v;this.writes++;},get textContent(){return this._html;},set textContent(v){this._html=v;},inert:false,isConnected:true,scrollTop:47,dataset:{},attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},contains(){return false;},querySelectorAll(){return[];},querySelector(){return{focus(){}};},focus(){c.document.activeElement=this;}});
 for(const id of ['social-tabs','social-confirm-host','social-guild-balances','social-guild-ledger','social-guild-members','social-guild-treasury-status','social-guild-ledger-more','social-guild-transfer-confirm','social-guild-personal-balance','social-guild-rankings-summary','social-guild-rankings-status','social-guild-rankings-results','social-guild-rankings-more'])nodes.set('#'+id,make());
 const body=make(),dialog={open:true,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],close(){this.open=false;},remove(){}};
 c.window=c;vm.createContext(c);vm.runInContext(source.replace('global.SengokuSocial={open','global.__guildTest={s,api,loadMe,loadGuild,loadChat,loadGuildTreasury,loadGuildRankings,guildView,guildRankingsView,guildMemberConfirmation,guildTransferConfirmation,guildLeaveConfirmation,canManageGuildMember,acceptUser,installIdentity,clearPrivate,selectTab,close,visibility,schedulePoll,refresh,submit,setUI:(d,b)=>{dialog=d;body=b;},lifecycle:()=>({guildEpoch,guildListGeneration,treasuryBusy,rankingsBusy})};global.SengokuSocial={open'),c);
 const t=c.__guildTest;t.setUI(dialog,body);t.s.identity={id:'actor',token:TOKEN};t.s.user=member('actor',role);t.s.open=true;t.s.tab='guild';t.s.guildSection='treasury';t.s.guild={id:'g1',name:'霞の盟約',memberCount:4,maxMembers:50};t.s.members=[t.s.user,member('leader','owner'),member('vice','officer'),member('other')];t.s.guildTreasury={guildId:'g1',balance:{...balance},ledger:[],cursor:null,loaded:true,error:''};
 handler=async url=>{const route=new URL(url).pathname;if(route.endsWith('/me'))return{ok:true,user:t.s.user,friends:[],requests:[]};if(route.endsWith('/guild/treasury'))return{ok:true,guildId:t.s.user.guildId,treasury:{...balance},ledger:[],nextCursor:null,serverNow:NOW};if(route.endsWith('/guild'))return{ok:true,guild:t.s.guild,members:t.s.members};if(route.endsWith('/guilds'))return{ok:true,guilds:[]};if(route.endsWith('/chat'))return{ok:true,messages:[],nextAfter:0};return{ok:true};};
 return{c,t,body,nodes,requests,transfers,timers,notices,setHandler:fn=>handler=fn,setTransfer:fn=>transfer=fn};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const me=user=>({ok:true,user:{...user},friends:[],requests:[]});
const route=request=>new URL(request.url).pathname.replace('/api/v1','');
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
await test('guild roles limit appointment/removal independently of site operator privileges',()=>{
 for(const role of ['owner','officer','member']){const b=setup(role),t=b.t;assert.equal(t.canManageGuildMember(member('other'),'role'),role==='owner');assert.equal(t.canManageGuildMember(member('other'),'remove'),role!=='member');assert.equal(t.canManageGuildMember(member('vice','officer'),'remove'),role==='owner');assert.equal(t.canManageGuildMember(member('leader','owner'),'remove'),false);assert.equal(t.canManageGuildMember(t.s.user,'remove'),false);t.s.guildSection='members';const html=t.guildView();assert(html.includes('盟主'));assert(html.includes('副盟主'));assert(html.includes('メンバー'));if(role==='member'){t.s.user.isAdmin=true;assert.equal(t.canManageGuildMember(member('other'),'role'),false);assert.equal(t.canManageGuildMember(member('other'),'remove'),false);}}
});
await test('management confirmation pins guild/target/role and retries the same operation UUID',async()=>{
 const b=setup(),confirmation=b.t.guildMemberConfirmation('other','role','officer');assert.equal(b.requests.length,0);const payloads=[];let calls=0;b.setHandler(async(_url,options)=>{payloads.push(JSON.parse(options.body));if(++calls===1)throw Error('lost response');return{ok:true,user:b.t.s.user,guild:b.t.s.guild,members:b.t.s.members.map(p=>p.id==='other'?{...p,guildRole:'officer'}:p)};});
 await assert.rejects(confirmation.onConfirm(),/lost response/);await confirmation.onConfirm();assert.equal(payloads[0].guildId,'g1');assert.equal(payloads[0].targetPlayerId,'other');assert.equal(payloads[0].role,'officer');assert(payloads[0].requestId);assert.equal(payloads[0].requestId,payloads[1].requestId);assert.equal(b.t.s.user.id,'actor');assert.equal(b.t.s.members.find(p=>p.id==='other').guildRole,'officer');
});
await test('old member management and treasury confirmations cannot act after guild or role changes',async()=>{
 for(const change of ['role','guild']){const b=setup(),management=b.t.guildMemberConfirmation('other','remove'),transfer=b.t.guildTransferConfirmation({direction:'deposit',resource:'gold',amount:100});b.t.acceptUser({...b.t.s.user,...(change==='role'?{guildRole:'member'}:{guildId:'g2',guildName:'別の盟約',guildRole:'owner'})});const before=b.requests.length;await assert.rejects(management.onConfirm(),e=>e.code==='STALE_GUILD');await assert.rejects(transfer.onConfirm(),e=>e.code==='STALE_GUILD');assert.equal(b.requests.length,before);assert.equal(b.transfers.length,0);}
});
await test('all five assets use the authoritative bridge, with stable retry payloads and no local gift application',async()=>{
 for(const resource of ['gold','rice','wood','stone','magatama'])for(const direction of ['deposit','withdraw']){const b=setup('member'),confirmation=b.t.guildTransferConfirmation({direction,resource,amount:123});let tries=0;b.setTransfer(async()=>{if(++tries===1)throw Error('uncertain network');return{ok:true};});await assert.rejects(confirmation.onConfirm(),/uncertain network/);await confirmation.onConfirm();assert.equal(b.transfers.length,2);assert.equal(b.transfers[0],b.transfers[1]);assert.equal(b.transfers[0].guildId,'g1');assert.equal(b.transfers[0].resource,resource);assert.equal(b.transfers[0].direction,direction);assert.equal(b.transfers[0].amount,123);assert(b.transfers[0].requestId);assert.equal(Object.isFrozen(b.transfers[0]),true);}
});
await test('invalid amounts, unknown assets, unavailable save access and insufficient balances never transfer',()=>{
 const b=setup('member');for(const amount of [0,-1,.5,1000001,Infinity,NaN,'bad'])assert.throws(()=>b.t.guildTransferConfirmation({direction:'deposit',resource:'gold',amount}));for(const resource of ['unknown','__proto__','constructor'])assert.throws(()=>b.t.guildTransferConfirmation({direction:'deposit',resource,amount:1}));assert.throws(()=>b.t.guildTransferConfirmation({direction:'withdraw',resource:'gold',amount:6000}),/残高/);assert.throws(()=>b.t.guildTransferConfirmation({direction:'deposit',resource:'gold',amount:10001}),/所持数/);b.c.SengokuCloudSync.getStatus=()=>({linked:true,ready:true,writable:false});assert.throws(()=>b.t.guildTransferConfirmation({direction:'deposit',resource:'gold',amount:1}),/保存・同期/);assert.equal(b.transfers.length,0);
});
await test('late treasury, roster and guild chat responses cannot reappear after leaving and rejoining the same guild',async()=>{
 for(const kind of ['treasury','roster','chat']){const b=setup(),late=deferred();if(kind==='chat')b.t.s.guildSection='chat';b.setHandler(()=>late.promise);const pending=kind==='treasury'?b.t.loadGuildTreasury():kind==='roster'?b.t.loadGuild():b.t.loadChat();b.t.acceptUser({...b.t.s.user,guildId:null,guildName:null,guildRole:null});b.t.acceptUser(member('actor','member'));late.resolve({ok:true,guildId:'g1',treasury:{...balance,gold:999888},ledger:[{id:'private',name:'old private'}],guild:{id:'g1'},members:[member('old-private')],messages:[{id:88,text:'OLD PRIVATE CHAT'}],nextAfter:88});await pending;assert.equal(b.t.s.guildTreasury.balance,null,kind);assert.equal(b.t.s.members.length,0,kind);assert(!b.t.s.chats.has('guild:g1'),kind);}
});
await test('older /me and sync metadata cannot restore a guild membership or former officer role',async()=>{
 for(const kind of ['me','sync']){const b=setup('officer'),old={...b.t.s.user},late=deferred();b.setHandler(()=>late.promise);const pending=kind==='me'?b.t.loadMe():b.t.api('/sync');b.t.acceptUser({...old,guildRole:'member'});late.resolve({ok:true,user:old,friends:[],requests:[]});const result=await pending;assert.equal(b.t.s.user.guildRole,'member');assert.equal(result.user.guildRole,'member');}
 const b=setup(),old={...b.t.s.user},late=deferred();b.setHandler(()=>late.promise);const pending=b.t.loadMe();b.t.acceptUser({...old,guildId:'g2',guildName:'新しい盟約',guildRole:'member'});late.resolve({ok:true,user:old});await pending;assert.equal(b.t.s.user.guildId,'g2');assert.equal(b.t.s.user.guildRole,'member');
});
await test('treasury pagination is private, cursor-safe and discarded after an identity switch',async()=>{
 const b=setup();let n=0;b.setHandler(async url=>{const q=new URL(url).searchParams;if(!n++)return{ok:true,guildId:'g1',treasury:balance,ledger:[{id:'a',name:'<private>',resource:'gold',direction:'deposit',amount:3,createdAt:NOW}],nextCursor:'opaque/+=',serverNow:NOW};assert.equal(q.get('cursor'),'opaque/+=');return{ok:true,guildId:'g1',treasury:balance,ledger:[{id:'a'},{id:'b'}],nextCursor:null,serverNow:NOW};});await b.t.loadGuildTreasury();assert.equal(b.requests[0].options.headers.Authorization,'Bearer '+TOKEN);assert(b.nodes.get('#social-guild-ledger').innerHTML.includes('&lt;private&gt;'));await b.t.loadGuildTreasury({more:true});assert.equal(b.t.s.guildTreasury.ledger.length,2);
 const late=deferred();b.setHandler(()=>late.promise);const pending=b.t.loadGuildTreasury();b.t.installIdentity({id:'next',token:'x'.repeat(64)},member('next'));late.resolve({ok:true,guildId:'g1',treasury:balance,ledger:[{id:'secret'}]});await pending;assert.equal(b.t.s.guildTreasury.ledger.length,0);
});
await test('GUILD_REQUIRED immediately removes private contents without clearing a newer unrelated membership',async()=>{
 const b=setup();b.setHandler(async()=>({__status:403,ok:false,error:{code:'GUILD_REQUIRED',message:'not a member'}}));await b.t.loadGuildTreasury();assert.equal(b.t.s.user.guildId,null);assert.equal(b.t.s.guildTreasury.loaded,false);assert.equal(b.t.s.members.length,0);
 const c=setup();c.setHandler(async()=>({__status:403,ok:false,error:{code:'GUILD_REQUIRED',message:'wrong guild'}}));await assert.rejects(c.t.api('/guild/treasury/transfer',{method:'POST',data:{guildId:'old-guild'}}));assert.equal(c.t.s.user.guildId,'g1');
});
await test('public rankings expose only prestige/member/castle fields and need no identity',async()=>{
 const b=setup();b.t.s.user=null;b.t.s.identity=null;b.t.s.tab='guild-rankings';b.setHandler(async()=>({ok:true,guilds:[{id:'g1',name:'<盟約>',ownerName:'<盟主>',rank:1,memberCount:6,totalPrestige:1250,ownedCastles:12,treasury:{gold:987654321},ledger:[{name:'SECRET_LEDGER'}]}],total:1,serverNow:NOW,nextCursor:null}));await b.t.loadGuildRankings();assert.equal(b.requests[0].options.headers.Authorization,undefined);const html=b.t.guildRankingsView();assert(html.includes('&lt;盟約&gt;'));assert(html.includes('&lt;盟主&gt;'));assert(html.includes('総威信'));assert(html.includes('1,250'));assert(html.includes('領有城'));assert(!html.includes('987654321'));assert(!html.includes('SECRET_LEDGER'));b.t.schedulePoll();assert.equal([...b.timers.values()].filter(t=>t.ms===5000).length,0);assert.equal([...b.timers.values()].filter(t=>t.ms===30000).length,1);b.t.close();assert.equal([...b.timers.values()].filter(t=>t.ms===30000).length,0);
});
await test('member refresh reloads current roles without rebuilding the whole view',async()=>{
 const b=setup('officer');b.t.s.guildSection='members';let roster=0;b.setHandler(async url=>{const path=new URL(url).pathname;if(path.endsWith('/me'))return{ok:true,user:{...b.t.s.user,guildRole:'member'},friends:[],requests:[]};if(path.endsWith('/guild')){roster++;return{ok:true,guild:{id:'g1',memberCount:3},members:[member('other','officer')]};}return{ok:true,messages:[],nextAfter:0};});await b.t.refresh({silent:true});assert.equal(roster,1);assert.equal(b.t.s.user.guildRole,'member');assert.equal(b.t.s.members[0].guildRole,'officer');assert(b.nodes.get('#social-guild-members').innerHTML.includes('副盟主'));
});
await test('a busy poll immediately drains only the latest requested view without a timer or duplicate reads',async()=>{
 const b=setup(),old=deferred(),user={...b.t.s.user};let summaries=0;b.t.s.tab='world';b.t.s.guildSection='chat';
 b.setHandler(async url=>{const path=new URL(url).pathname;if(path.endsWith('/me'))return++summaries===1?old.promise:me(user);if(path.endsWith('/guild'))return{ok:true,guild:{id:'g1',memberCount:2},members:[member('latest')]};return{ok:true,messages:[],nextAfter:0,mail:[]};});
 const active=b.t.refresh({silent:true});await b.t.selectTab('friends');await b.t.selectTab('mail');await b.t.selectTab('guild');await b.t.refresh({view:true});assert.equal(b.requests.length,2,'only the original world reads are in flight');
 old.resolve(me(user));await active;assert.deepEqual(b.requests.map(route),['/me','/chat','/me','/guild','/chat']);assert.equal(new URL(b.requests.at(-1).url).searchParams.get('channel'),'guild');assert.equal(b.t.s.members[0].id,'latest');assert.equal(b.t.s.tab,'guild');assert.equal([...b.timers.values()].filter(t=>t.ms===5000).length,1,'one future poll remains; no timer was executed to drain the view');
});
await test('the latest view also loads after the obsolete poll fails without showing its error on the new screen',async()=>{
 const b=setup(),old=deferred(),user={...b.t.s.user};let summaries=0;b.t.s.guildSection='members';
 b.setHandler(async url=>new URL(url).pathname.endsWith('/me')?++summaries===1?old.promise:me(user):{ok:true,mail:[{id:'fresh',title:'最新の便り',body:'取得済み',read:false,createdAt:NOW}]});
 const active=b.t.refresh({view:true});await b.t.selectTab('mail');old.resolve({ok:false,__status:503,error:{code:'TEMPORARY',message:'古い画面の通信失敗'}});await active;
 assert.deepEqual(b.requests.map(route),['/me','/me','/mail']);assert.equal(b.t.s.tab,'mail');assert.match(b.body.innerHTML,/最新の便り/);assert.equal(b.notices.length,0);
});
await test('closing discards a queued view and a late poll cannot redraw or schedule it',async()=>{
 const b=setup(),old=deferred(),user={...b.t.s.user};b.t.s.guildSection='members';b.setHandler(()=>old.promise);const active=b.t.refresh({silent:true});await b.t.selectTab('mail');b.t.close();const writes=b.body.writes;
 old.resolve(me(user));await active;assert.equal(b.requests.length,1);assert.equal(b.body.writes,writes);assert.equal(b.t.s.open,false);assert.equal([...b.timers.values()].filter(t=>t.ms===5000).length,0);
});
await test('changing or losing the identity discards its queued view and late private responses',async()=>{
 for(const change of ['replace','signed-out']){
  const b=setup(),old=deferred(),user={...b.t.s.user};b.t.s.guildSection='members';b.setHandler(()=>old.promise);const active=b.t.refresh({silent:true});await b.t.selectTab('mail');
  if(change==='replace')b.t.installIdentity({id:'next',token:'x'.repeat(64)},member('next'));else b.t.acceptUser(null);const writes=b.body.writes;
  old.resolve(me(user));await active;assert.equal(b.requests.length,1);assert.equal(b.body.writes,writes);assert.equal(b.t.s.mail.length,0);assert.equal(b.notices.length,0);assert.equal(b.t.s.user?.id,change==='replace'?'next':undefined);
 }
});
await test('a newly requested view after close or identity replacement survives only in its new scope',async()=>{
 for(const change of ['reopen','replace']){
  const b=setup(),old=deferred(),user={...b.t.s.user};let summaries=0;b.t.s.guildSection='members';
  b.setHandler(async url=>new URL(url).pathname.endsWith('/me')?++summaries===1?old.promise:me(b.t.s.user):{ok:true,guild:{id:'g1',memberCount:1},members:[member('new-scope')]});
  const active=b.t.refresh({silent:true});await b.t.selectTab('mail');if(change==='reopen'){b.t.close();b.t.s.open=true;}else b.t.installIdentity({id:'next',token:'x'.repeat(64)},member('next'));b.t.s.guildSection='members';await b.t.selectTab('guild');
  old.resolve(me(user));await active;assert.deepEqual(b.requests.map(route),['/me','/me','/guild']);assert.equal(b.t.s.members[0].id,'new-scope');assert.equal(b.t.s.tab,'guild');assert.equal(b.requests[1].options.headers.Authorization,'Bearer '+(change==='replace'?'x'.repeat(64):TOKEN));
 }
});
await test('queued private views still verify current membership and cannot reuse a revoked role',async()=>{
 const b=setup(),old=deferred(),user={...b.t.s.user};let summaries=0;b.t.s.tab='world';b.t.s.guildSection='chat';
 b.setHandler(async url=>{const path=new URL(url).pathname;if(path.endsWith('/me'))return++summaries===1?old.promise:me({...user,guildId:null,guildName:null,guildRole:null});return{ok:true,messages:[],nextAfter:0,guilds:[]};});
 const active=b.t.refresh({silent:true});await b.t.selectTab('guild');old.resolve(me(user));await active;assert.deepEqual(b.requests.map(route),['/me','/chat','/me','/guilds']);assert.equal(b.t.s.user.guildId,null);assert(!b.requests.some(r=>new URL(r.url).searchParams.get('channel')==='guild'));
 const a=setup(),prior=deferred();a.t.s.user={...a.t.s.user,isAdmin:true};a.t.s.tab='world';a.setHandler(async url=>new URL(url).pathname.endsWith('/me')?prior.promise:{ok:true,messages:[],nextAfter:0});
 const running=a.t.refresh({silent:true});await a.t.selectTab('admin');prior.resolve(me({...a.t.s.user,isAdmin:false}));await running;assert.equal(a.t.s.tab,'profile');assert.equal(a.t.s.user.isAdmin,false);assert.deepEqual(a.requests.map(route),['/me','/chat']);assert(!a.requests.some(r=>new URL(r.url).searchParams.get('channel')==='admin'));
});
await test('switching from a busy poll to treasury queues one verified read and keeps its slower timer',async()=>{
 const b=setup(),old=deferred(),user={...b.t.s.user};let summaries=0;b.t.s.tab='world';
 b.setHandler(async url=>{const path=new URL(url).pathname;if(path.endsWith('/me'))return++summaries===1?old.promise:me(user);if(path.endsWith('/guild/treasury'))return{ok:true,guildId:'g1',treasury:balance,ledger:[],serverNow:NOW};return{ok:true,messages:[],nextAfter:0};});
 const active=b.t.refresh({silent:true});await b.t.selectTab('guild');assert.equal(b.requests.length,2);old.resolve(me(user));await active;assert.deepEqual(b.requests.map(route),['/me','/chat','/me','/guild/treasury']);assert.equal([...b.timers.values()].filter(t=>t.ms===5000).length,0);assert.equal([...b.timers.values()].filter(t=>t.ms===30000).length,1);
});
console.log(`${count} guild UI permission, treasury and ranking checks passed. No network requests were made.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
