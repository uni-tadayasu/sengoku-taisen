const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8'),TOKEN='q'.repeat(64),NOW='2026-11-22T10:00:00Z';
const event=(id,values={})=>({id:String(id),playerName:'検証用の領主',clan:'織田家',kind:'castle_capture',title:'検証用の占領達成',detail:'検証用データのみ',occurredAt:new Date(Date.parse(NOW)-Number(id||0)*1000).toISOString(),...values});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
function setup(){
 const requests=[],timers=new Map(),nodes=new Map(),focusCalls=[],navigation=[],documentListeners=new Map();let timerId=0,handler;
 const c={console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,
  setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),
  document:{readyState:'loading',hidden:false,activeElement:null,addEventListener:(n,f)=>documentListeners.set(n,f),removeEventListener:n=>documentListeners.delete(n)},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://api.example.invalid',
  history:{replaceState(...args){navigation.push(['history',...args]);}},scrollTo(...args){navigation.push(['scroll',...args]);},
  SengokuCloudSync:{start(){},stop(){},getStatus:()=>({linked:false,ready:false,writable:true})},SengokuBridge:{setAdminAccess(){},setSyncAccess(){},toast(){},hasStarted:()=>true},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};}
 };
 const make=()=>({_html:'',htmlWrites:0,textWrites:0,get innerHTML(){return this._html;},set innerHTML(v){this._html=String(v);this.htmlWrites++;},get textContent(){return this._html;},set textContent(v){this._html=String(v);this.textWrites++;},inert:false,isConnected:true,hidden:false,disabled:false,scrollTop:0,dataset:{},attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},contains(){return false;},querySelectorAll(){return[];},querySelector(){return null;},focus(options){focusCalls.push({node:this,options});c.document.activeElement=this;},getBoundingClientRect(){return{top:20,bottom:620};}});
 for(const id of ['social-tabs','social-confirm-host','social-achievement-list','social-news-status','social-news-more','social-news-notice-text'])nodes.set('#'+id,make());
 const body=make(),list=nodes.get('#social-achievement-list');
 list.querySelectorAll=()=>[...list.innerHTML.matchAll(/data-event-id="([^"]*)"/g)].map((m,index)=>({dataset:{eventId:m[1]},getBoundingClientRect:()=>({top:20+index*100-body.scrollTop,bottom:120+index*100-body.scrollTop})}));
 const line=make(),toggle=make(),announcement=make();announcement.querySelector=selector=>selector==='.social-announcement-text'?line:selector==='.social-announcement-toggle'?toggle:null;
 const dialog={open:true,removed:false,querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],showModal(){this.open=true;},close(){this.open=false;},remove(){this.removed=true;}};
 c.window=c;vm.createContext(c);
 const exposed='global.__achievementTest={s,api,tabs,cleanAchievement,achievementRows,achievementsView,loadAchievements,refreshAchievementView,renderAnnouncement,loadConfig,open,close,selectTab,visibility,schedulePoll,refresh,dispose,setUI:(d,b,a)=>{dialog=d;body=b;announcement=a;},lifecycle:()=>({achievementGeneration,achievementBusy,achievementTimer,disposed})};global.SengokuSocial={open';
 assert(source.includes('global.SengokuSocial={open'),'test seam tracks production export');vm.runInContext(source.replace('global.SengokuSocial={open',exposed),c);
 const t=c.__achievementTest;t.setUI(dialog,body,announcement);t.s.open=true;t.s.tab='news';
 handler=async url=>new URL(url).pathname.endsWith('/config')?{ok:true,announcement:'検証用のお知らせ',onlineCount:0,adminClaimed:true}:{ok:true,events:[],nextCursor:null,serverNow:NOW};
 const runPoll=async()=>{const entry=[...timers].find(([,v])=>v.ms===30000&&v.fn===t.loadAchievements);assert(entry,'one achievement poll is scheduled');timers.delete(entry[0]);await entry[1].fn();};
 return{c,t,body,list,line,toggle,announcement,dialog,nodes,requests,timers,focusCalls,navigation,setHandler:fn=>handler=fn,runPoll};
}
let passed=0;const failures=[];
async function test(name,run){try{await run();passed++;console.log('PASS '+name);}catch(error){failures.push(name);console.error('FAIL '+name+'\n'+error.stack);}}
(async()=>{
await test('guests and signed-in readers use the public feed without bearer credentials',async()=>{
 for(const signedIn of [false,true]){const b=setup();if(signedIn){b.t.s.identity={id:'actor',token:TOKEN};b.t.s.user={id:'actor',name:'検証領主',isAdmin:false,isStaff:false};}
 b.setHandler(async()=>({ok:true,events:[event(1)],nextCursor:null,serverNow:NOW}));await b.t.loadAchievements();
 assert.equal(b.requests.length,1);const request=b.requests[0],url=new URL(request.url);assert.equal(url.pathname,'/api/v1/achievements');assert.equal(url.searchParams.get('limit'),'20');assert.equal(request.options.headers.Authorization,undefined);assert.equal(request.options.credentials,'omit');assert.equal(request.options.method,'GET');
 assert.equal(b.t.s.achievements.loaded,true);assert(b.t.achievementsView().includes('検証用の領主'));assert(b.t.tabs().some(t=>t.id==='news'));}
});
await test('untrusted fields are escaped, bounded and projected without private data',async()=>{
 const b=setup(),attack='<img src=x onerror="alert(1)">';b.t.s.config.announcement='<script>NOTICE_SECRET</script>';
 b.setHandler(async()=>({ok:true,events:[event(1,{id:'<event>',playerName:attack,clan:'<家紋>',title:'<script>title</script>',detail:'<svg onload="danger()">&',kind:'research<script>',token:'SECRET_AUTH',email:'SECRET_EMAIL',lastSeenAt:'PRIVATE_LOGIN',treasury:{gold:'PRIVATE_GOLD'},privateChat:'PRIVATE_CHAT'})],nextCursor:null,serverNow:NOW}));
 await b.t.loadAchievements();const html=b.list.innerHTML,state=JSON.stringify(b.t.s.achievements.events);
 assert(html.includes('&lt;img'));assert(html.includes('&lt;script&gt;title&lt;/script&gt;'));assert(html.includes('&lt;svg'));assert(!html.includes('<script>'));assert(!html.includes('<img src=x'));
 for(const secret of ['SECRET_AUTH','SECRET_EMAIL','PRIVATE_LOGIN','PRIVATE_GOLD','PRIVATE_CHAT']){assert(!html.includes(secret));assert(!state.includes(secret));assert(!b.line.textContent.includes(secret));}
 assert.deepEqual(Object.keys(b.t.s.achievements.events[0]).sort(),['clan','detail','id','kind','occurredAt','playerAppearance','playerEvaluation','playerId','playerName','title']);
 const clean=b.t.cleanAchievement(event(2,{playerName:'名'.repeat(100),clan:'家'.repeat(100),kind:'k'.repeat(100),title:'達'.repeat(250),detail:'詳'.repeat(400)}));assert.equal(clean.playerName.length,40);assert.equal(clean.clan.length,30);assert.equal(clean.kind.length,40);assert.equal(clean.title.length,180);assert.equal(clean.detail.length,300);
 assert.equal(b.line.htmlWrites,0,'ticker uses textContent, never server HTML');assert(b.line.textContent.includes('<script>NOTICE_SECRET</script>'));
});
await test('malformed IDs, required names, titles and invalid dates cannot become public rows',()=>{
 const b=setup();for(const id of ['', '   ', NaN, Infinity, {}, null, 'x'.repeat(181)])assert.equal(b.t.cleanAchievement(event(1,{id})),null,'reject id '+String(id));
 for(const value of [null,{},'', ' ', 'not-a-date', Infinity, '2026-99-99'])assert.equal(b.t.cleanAchievement(event(1,{occurredAt:value})),null,'reject invalid date '+String(value));
 for(const playerName of ['', '   ',null,{}])assert.equal(b.t.cleanAchievement(event(1,{playerName})),null,'reject blank/malformed playerName');
 for(const title of ['', '   ',null,{}])assert.equal(b.t.cleanAchievement(event(1,{title})),null,'reject blank/malformed title');
 assert(b.t.cleanAchievement(event(1,{id:0})),'zero is a valid stable integer ID');assert.equal(b.t.cleanAchievement(null),null);
});
await test('the feed uses Japanese local time and a deterministic newest-first order',async()=>{
 const b=setup();b.setHandler(async()=>({ok:true,events:[event(3),event(1,{occurredAt:'2026-11-22T23:05:00Z'}),event(2)],nextCursor:null}));await b.t.loadAchievements();
 assert.deepEqual(Array.from(b.t.s.achievements.events,e=>e.id),['1','2','3']);assert(b.list.innerHTML.includes('11/23 08:05'));assert(b.list.innerHTML.includes('datetime="2026-11-22T23:05:00.000Z"'));
});
await test('pagination encodes cursors, deduplicates overlap and retains expanded history',async()=>{
 const b=setup();let n=0;b.setHandler(async url=>{const q=new URL(url).searchParams;if(!n++){assert.equal(q.get('cursor'),null);return{ok:true,events:[event(1),event(2)],nextCursor:'older/+=?'};}assert.equal(q.get('cursor'),'older/+=?');return{ok:true,events:[event(2),event(3)],nextCursor:'oldest'};});
 await b.t.loadAchievements();await b.t.loadAchievements({more:true});assert.deepEqual(Array.from(b.t.s.achievements.events,e=>e.id),['1','2','3']);assert.equal(b.t.s.achievements.expanded,true);assert.equal(b.t.s.achievements.cursor,'oldest');
 b.setHandler(async()=>({ok:true,events:[event(0)],nextCursor:'top-only'}));await b.t.loadAchievements();assert.deepEqual(Array.from(b.t.s.achievements.events,e=>e.id),['0','1','2','3']);assert.equal(b.t.s.achievements.cursor,'oldest');
});
await test('fresh top-page details replace older cached copies after pagination',async()=>{
 const b=setup();let n=0;b.setHandler(async()=>++n===1?{ok:true,events:[event(1,{title:'以前の題名'})],nextCursor:'older'}:{ok:true,events:[event(2)],nextCursor:null});await b.t.loadAchievements();await b.t.loadAchievements({more:true});
 b.setHandler(async()=>({ok:true,events:[event(1,{playerName:'更新された領主',title:'新しい題名'})],nextCursor:'older'}));await b.t.loadAchievements();
 assert.equal(b.t.s.achievements.events.find(e=>e.id==='1').title,'新しい題名');assert.equal(b.t.s.achievements.events.find(e=>e.id==='1').playerName,'更新された領主');assert(b.t.s.achievements.events.some(e=>e.id==='2'));
});
await test('history is bounded at 200 rows and cannot request more after reaching the cap',async()=>{
 const b=setup();let first=1;b.setHandler(async()=>{const start=first;first+=20;return{ok:true,events:Array.from({length:20},(_,i)=>event(start+i)),nextCursor:'page-'+first};});await b.t.loadAchievements();
 for(let i=0;i<10;i++)await b.t.loadAchievements({more:true});assert.equal(b.requests.length,10);assert.equal(b.t.s.achievements.events.length,200);assert.equal(b.t.s.achievements.cursor,null);assert.equal(b.nodes.get('#social-news-more').hidden,true);
});
await test('network errors retain existing public rows and recover without fabricated entries',async()=>{
 const b=setup();b.setHandler(async()=>({ok:true,events:[event(1)],nextCursor:'older'}));await b.t.loadAchievements();const before=b.list.innerHTML;
 b.setHandler(async()=>{throw Error('network unavailable');});await b.t.loadAchievements();assert.equal(b.list.innerHTML,before);assert.equal(b.t.s.achievements.cursor,'older');assert(b.nodes.get('#social-news-status').textContent.includes('更新できませんでした'));
 b.setHandler(async()=>({ok:true,events:[event(2)],nextCursor:null}));await b.runPoll();assert.equal(b.t.s.achievements.error,'');assert.deepEqual(Array.from(b.t.s.achievements.events,e=>e.id),['2']);
 const empty=setup();await empty.t.loadAchievements();assert(empty.t.achievementsView().includes('達成の知らせはまだありません'));assert.equal(empty.t.s.achievements.events.length,0);
});
await test('malformed response is an error without wiping previously accepted rows',async()=>{
 const b=setup();b.setHandler(async()=>({ok:true,events:[event(1)],nextCursor:null}));await b.t.loadAchievements();b.setHandler(async()=>({ok:true,events:{id:'invalid'}}));await b.t.loadAchievements();assert.equal(b.t.s.achievements.events.length,1);assert(b.t.s.achievements.error);
});
await test('polling leaves the open tab, active element and outer page untouched',async()=>{
 const b=setup(),active={value:'入力中',selectionStart:2,selectionEnd:2};b.c.document.activeElement=active;b.body.scrollTop=147;b.t.s.tab='profile';b.t.s.config.announcement='お知らせ';
 b.setHandler(async()=>({ok:true,events:[event(1)],nextCursor:null}));await b.t.loadAchievements();await b.runPoll();
 assert.equal(b.t.s.tab,'profile');assert.equal(b.body.htmlWrites,0);assert.equal(b.body.scrollTop,147);assert.equal(b.c.document.activeElement,active);assert.equal(active.value,'入力中');assert.equal(b.focusCalls.length,0);assert.equal(b.navigation.length,0);
 assert.equal(b.line.textWrites,1,'same ticker text does not restart its DOM content every poll');
 b.t.s.open=false;await b.runPoll();assert.equal(b.t.s.open,false);assert.equal(b.body.htmlWrites,0);assert.equal(b.t.s.tab,'profile');
});
await test('reading position in the news list follows the visible row when new rows arrive',async()=>{
 const b=setup(),focus={id:'social-news-more'};b.c.document.activeElement=focus;b.setHandler(async()=>({ok:true,events:[event(1),event(2),event(3),event(4)],nextCursor:null}));await b.t.loadAchievements();b.body.scrollTop=147;
 b.setHandler(async()=>({ok:true,events:[event(0),event(1),event(2),event(3),event(4)],nextCursor:null}));await b.runPoll();assert.equal(b.body.scrollTop,247,'100px prepended row compensated');assert.equal(b.body.htmlWrites,0);assert.equal(b.c.document.activeElement,focus);assert.equal(b.focusCalls.length,0);assert.equal(b.navigation.length,0);
});
await test('hidden tabs make no requests and delayed pre-hide data cannot replace the resumed feed',async()=>{
 const b=setup(),late=deferred();b.setHandler(()=>late.promise);const old=b.t.loadAchievements();assert.equal(b.t.lifecycle().achievementBusy,true);
 b.c.document.hidden=true;b.t.visibility();await b.t.loadAchievements();assert.equal(b.requests.length,1);assert.equal(b.timers.size,1,'only the existing network timeout remains');
 b.c.document.hidden=false;b.setHandler(async url=>new URL(url).pathname.endsWith('/config')?{ok:true,announcement:'現在のお知らせ'}:{ok:true,events:[event(1,{title:'現在の戦果'})],nextCursor:null});b.t.visibility();
 for(let i=0;i<8;i++)await Promise.resolve();late.resolve({ok:true,events:[event(2,{title:'古い応答'})],nextCursor:'stale'});await old;
 assert.equal(b.t.s.achievements.events[0].title,'現在の戦果');assert(!b.list.innerHTML.includes('古い応答'));assert.equal([...b.timers.values()].filter(t=>t.fn===b.t.loadAchievements).length,1);
});
await test('disposing the UI aborts requests and ignores late achievement responses',async()=>{
 const b=setup(),late=deferred();b.setHandler(()=>late.promise);const pending=b.t.loadAchievements();const signal=b.requests[0].options.signal;await b.t.dispose();assert.equal(signal.aborted,true);
 late.resolve({ok:true,events:[event(1)],nextCursor:null});await pending;assert.equal(b.t.s.achievements.events.length,0);assert.equal(b.list.htmlWrites,0);assert.equal(b.line.textWrites,0);assert.equal(b.timers.size,0);assert.equal(b.dialog.removed,true);
});
await test('concurrent refresh attempts share one request and one recurring timer',async()=>{
 const b=setup(),late=deferred();b.setHandler(()=>late.promise);const first=b.t.loadAchievements();await b.t.loadAchievements();await b.t.loadAchievements({more:true});assert.equal(b.requests.length,1);
 late.resolve({ok:true,events:[event(1)],nextCursor:null});await first;assert.equal([...b.timers.values()].filter(t=>t.fn===b.t.loadAchievements&&t.ms===30000).length,1);b.t.schedulePoll();assert.equal([...b.timers.values()].filter(t=>t.ms===5000).length,0);
});
console.log(`${passed} achievement UI checks passed; ${failures.length} failed. VM-only public fixtures; no network requests or persisted player data.`);if(failures.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
