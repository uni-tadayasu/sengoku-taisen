const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8');
const NOW='2026-11-22T03:00:00.000Z',START='2026-11-21T03:00:00.000Z',TOKEN='a'.repeat(64);
const user=(id,lastSeen,extra={})=>({id,name:'領主 '+id,clan:'織田家',isAdmin:false,isStaff:false,online:false,lastSeen,...extra});
const response=(players=[],extra={})=>({ok:true,players,total:players.length,serverNow:NOW,windowStart:START,nextCursor:null,...extra});
function setup(role='admin'){
 const requests=[],timers=new Map(),nodes=new Map();let timerId=0,handler=async()=>response();
 const c={console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
  document:{readyState:'loading',hidden:false,activeElement:null,addEventListener(){},removeEventListener(){}},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://api.example.invalid',
  SengokuBridge:{setAdminAccess(){},setSyncAccess(){},toast(){}},SengokuCloudSync:{start(){},stop(){},flush:async()=>{}},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};}
 };
 function node(){return{_html:'',_text:'',get innerHTML(){return this._html;},set innerHTML(v){this._html=v;this._text='';},get textContent(){return this._text;},set textContent(v){this._text=v;this._html='';},hidden:false,inert:false,isConnected:true,scrollTop:240,attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},focus(){c.document.activeElement=this;}};}
 for(const id of ['social-tabs','social-confirm-host','social-recent-login-count','social-recent-login-window','social-recent-login-status','social-recent-login-results','social-recent-login-refresh','social-recent-login-more'])nodes.set('#'+id,node());
 const body=node(),dialog={open:true,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],close(){this.open=false;},showModal(){this.open=true;},remove(){}};
 c.window=c;vm.createContext(c);
 vm.runInContext(source.replace('global.SengokuSocial={open','global.__recentLoginTest={s,tabs,api,acceptUser,installIdentity,loadRecentLogins,recentLoginsView,loginDate,selectTab,click,close,visibility,clearPrivate,schedulePoll,setUI:(d,b)=>{dialog=d;body=b;},lifecycle:()=>({recentLoginBusy,recentLoginGeneration})};global.SengokuSocial={open'),c);
 const t=c.__recentLoginTest;t.setUI(dialog,body);t.s.identity={id:'actor',token:TOKEN};t.s.user=role==='guest'?null:{id:'actor',name:'本人',clan:'徳川家',isAdmin:role==='admin',isStaff:role==='staff'};t.s.open=true;t.s.tab='recent-logins';t.s.configLoaded=true;
 return{c,t,body,dialog,nodes,requests,timers,setHandler:fn=>handler=fn,refreshTimers:()=>[...timers.values()].filter(v=>v.ms===30000)};
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
let count=0;async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
await test('only verified operators and staff see or request the private history',async()=>{
 for(const role of ['guest','ordinary','staff','admin']){const b=setup(role),allowed=['staff','admin'].includes(role);assert.equal(b.t.tabs().some(t=>t.id==='recent-logins'),allowed);await b.t.loadRecentLogins();assert.equal(b.requests.length,allowed?1:0);if(!allowed)assert.match(b.t.recentLoginsView(),/閲覧権限がありません/);assert(b.t.tabs().some(t=>t.id==='online'));}
});
await test('history is authenticated, latest first, escaped and explicitly rendered in JST',async()=>{
 const b=setup();b.setHandler(async()=>response([user('old','2026-11-21T20:00:00Z'),user('new','2026-11-22T02:00:00Z',{name:'<script>name</script>',clan:'<clan>',isStaff:true,online:true}),user('outside','2026-11-20T00:00:00Z'),user('future','2026-11-23T00:00:00Z')],{total:2}));
 await b.t.loadRecentLogins();assert.equal(new URL(b.requests[0].url).pathname,'/api/v1/staff/recent-logins');assert.equal(new URL(b.requests[0].url).searchParams.get('limit'),'50');assert.equal(b.requests[0].options.headers.Authorization,'Bearer '+TOKEN);assert(!b.requests[0].url.includes(TOKEN));
 assert.deepEqual(Array.from(b.t.s.recentLogins.players,p=>p.id),['new','old']);const html=b.t.recentLoginsView();assert(html.includes('&lt;script&gt;'));assert(!html.includes('<script>'));assert(html.includes('&lt;clan&gt;'));assert(html.includes('スタッフ'));assert(html.includes('オンライン'));assert(html.includes('オフライン'));assert(html.includes('2026/11/22 11:00:00'));assert(html.includes('日本時間 JST'));assert(html.includes('過去24時間にログイン・接続を確認した領主'));assert(html.includes('2人 · 2人を表示'));assert.equal(b.refreshTimers().length,1);
});
await test('load-more forwards the opaque cursor, merges without duplicates, and refresh resets the window',async()=>{
 const b=setup();let step=0;b.setHandler(async(url)=>{const query=new URL(url).searchParams;if(step++===0){assert(!query.has('cursor'));return response([user('a','2026-11-22T02:00:00Z')],{total:3,nextCursor:'opaque/+?='});}if(step===2){assert.equal(query.get('cursor'),'opaque/+?=');return response([user('a','2026-11-22T02:00:00Z'),user('b','2026-11-22T01:00:00Z'),user('c','2026-11-21T21:00:00Z')],{total:3});}assert(!query.has('cursor'));return response([user('fresh','2026-11-22T02:59:00Z')]);});
 await b.t.loadRecentLogins();await b.t.loadRecentLogins({more:true});assert.deepEqual(Array.from(b.t.s.recentLogins.players,p=>p.id),['a','b','c']);assert.equal(b.t.s.recentLogins.cursor,null);const n=b.requests.length;await b.t.loadRecentLogins({more:true});assert.equal(b.requests.length,n);await b.t.loadRecentLogins();assert.deepEqual(Array.from(b.t.s.recentLogins.players,p=>p.id),['fresh']);
});
await test('refresh preserves its controls, keyboard focus and scroll while presenting loading/empty/error states',async()=>{
 const b=setup(),pending=deferred(),button=b.nodes.get('#social-recent-login-refresh');b.c.document.activeElement=button;b.setHandler(()=>pending.promise);const p=b.t.loadRecentLogins();assert.equal(button.attrs['aria-busy'],'true');assert.equal(b.c.document.activeElement,button);assert.match(b.nodes.get('#social-recent-login-status').textContent,/更新しています/);pending.resolve(response());await p;assert.equal(b.c.document.activeElement,button);assert.equal(b.body.scrollTop,240);assert.equal(button.attrs['aria-busy'],'false');assert.match(b.nodes.get('#social-recent-login-results').innerHTML,/過去24時間の接続記録はありません/);
 b.setHandler(async()=>{throw Error('通信テストエラー');});await b.t.loadRecentLogins();assert.match(b.nodes.get('#social-recent-login-status').textContent,/通信テストエラー/);assert.equal(button.attrs['aria-busy'],'false');assert.equal(b.refreshTimers().length,1);
});
await test('demotion clears private content immediately and ignores a late authorized response',async()=>{
 const b=setup('staff');b.setHandler(async()=>response([user('secret','2026-11-22T02:00:00Z')]));await b.t.loadRecentLogins();assert(b.nodes.get('#social-recent-login-results').innerHTML.includes('secret'));
 const late=deferred();b.setHandler(()=>late.promise);const p=b.t.loadRecentLogins();b.t.acceptUser({id:'actor',name:'本人',isAdmin:false,isStaff:false},{fromSync:true});assert.equal(b.t.s.tab,'profile');assert.equal(b.t.s.recentLogins.players.length,0);assert.equal(b.nodes.get('#social-recent-login-results').innerHTML,'');assert.equal(b.refreshTimers().length,0);
 late.resolve(response([user('late-secret','2026-11-22T02:00:00Z')]));await p;assert.equal(b.t.s.recentLogins.players.length,0);assert(!b.t.tabs().some(t=>t.id==='recent-logins'));assert.equal(b.refreshTimers().length,0);
});
await test('STAFF_REQUIRED and an invalid current session discard the role and private cached list',async()=>{
 for(const status of [403,401]){const b=setup('staff');b.t.s.recentLogins=response([user('secret','2026-11-22T02:00:00Z')],{cursor:'old',loaded:true,error:'old'});b.setHandler(async()=>({__status:status,ok:false,error:{code:status===403?'STAFF_REQUIRED':'UNAUTHORIZED',message:'denied'}}));await b.t.loadRecentLogins();assert.equal(b.t.s.tab,'profile');assert.equal(b.t.s.recentLogins.players.length,0);assert.equal(b.t.s.recentLogins.total,0);assert.equal(b.t.s.recentLogins.cursor,null);assert.equal(b.t.s.recentLogins.error,'');assert.equal(b.refreshTimers().length,0);assert.equal(b.t.s.user?.isStaff||false,false);}
});
await test('identity switches, auth invalidation, logout and disposal all reject in-flight private data',async()=>{
 for(const action of ['identity','auth','logout','dispose']){const b=setup(),late=deferred();b.setHandler(()=>late.promise);const p=b.t.loadRecentLogins();if(action==='identity')b.t.installIdentity({id:'replacement',token:'b'.repeat(64)},{id:'replacement',name:'次の領主'});if(action==='auth')b.t.acceptUser(null);if(action==='logout'){b.t.clearPrivate();b.t.s.identity=null;b.t.s.user=null;}if(action==='dispose')await b.c.SengokuSocial.dispose();late.resolve(response([user('secret','2026-11-22T02:00:00Z')]));await p;assert.equal(b.t.s.recentLogins.players.length,0,action);assert.equal(b.refreshTimers().length,0,action);}
});
await test('tab departure, close and page hiding stop refresh and invalidate pending responses',async()=>{
 for(const action of ['tab','close','hidden']){const b=setup(),late=deferred();b.setHandler(()=>late.promise);const p=b.t.loadRecentLogins();if(action==='tab')await b.t.selectTab('recovery');if(action==='close')b.t.close();if(action==='hidden'){b.c.document.hidden=true;b.t.visibility();}late.resolve(response([user('secret','2026-11-22T02:00:00Z')]));await p;assert.equal(b.t.s.recentLogins.players.length,0,action);assert.equal(b.refreshTimers().length,0,action);assert.equal(b.t.lifecycle().recentLoginBusy,false);}
});
await test('a stale finally cannot clear a newer request or create an extra timer',async()=>{
 const b=setup(),old=deferred(),fresh=deferred();let n=0;b.setHandler(()=>++n===1?old.promise:fresh.promise);const first=b.t.loadRecentLogins();b.t.close();b.t.s.open=true;b.t.s.tab='recent-logins';const second=b.t.loadRecentLogins();old.resolve(response([user('old','2026-11-22T02:00:00Z')]));await first;assert.equal(b.t.lifecycle().recentLoginBusy,true);assert.equal(b.refreshTimers().length,0);fresh.resolve(response([user('fresh','2026-11-22T02:30:00Z')]));await second;assert.deepEqual(Array.from(b.t.s.recentLogins.players,p=>p.id),['fresh']);assert.equal(b.refreshTimers().length,1);assert.equal(b.t.lifecycle().recentLoginBusy,false);
});
await test('the visible history owns one 30-second refresh and does not use chat polling',async()=>{
 const b=setup();await b.t.loadRecentLogins();b.t.schedulePoll();assert.equal([...b.timers.values()].filter(v=>v.ms===5000).length,0);const timer=b.refreshTimers()[0];assert(timer);await timer.fn();assert.equal(b.requests.length,2);assert.equal(b.refreshTimers().length,1);b.t.close();assert.equal(b.refreshTimers().length,0);
});
console.log(`${count} private recent-login UI checks passed. No network requests were made.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
