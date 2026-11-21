/* Real social UI functions with synthetic responses only; no production mail. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8');
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
async function until(check){for(let i=0;i<60;i++){if(check())return;await Promise.resolve();}assert(check(),'Async checkpoint was not reached');}
function setup(){
 const requests=[],timers=new Map(),nodes=new Map(),attrs={};let sequence=0,handler=async()=>({ok:true});
 const user={id:'player-a',name:'確認領主',isAdmin:false,isStaff:false,guildId:null};
 const mailBadge={textContent:''},badge={textContent:'',hidden:true};nodes.set('[data-social-tab="mail"] .social-tab-count',mailBadge);
 const document={readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}};
 const c={console,URL,URLSearchParams,AbortController,document,Date,Intl,Map,Set,Promise,
  setTimeout:(fn,ms)=>{const id=++sequence;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://example.invalid',
  SengokuBridge:{setRoleAccess(){}},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};}
 };
 c.window=c;vm.createContext(c);vm.runInContext(source.replace('global.SengokuSocial={open','global.__mailTest={s,mailView,loadMe,loadConfig,refreshMailStatus,header,setUI:(d,l)=>{dialog=d;launcher=l;},switchIdentity:(id)=>{authEpoch++;s.identity={id,token:"b".repeat(64)};s.user={id,name:"別領主",isAdmin:false,isStaff:false};s.unreadMail=0;}};global.SengokuSocial={open'),c);
 const t=c.__mailTest;t.s.identity={id:user.id,token:'a'.repeat(64)};t.s.user={...user};t.s.open=false;
 t.setUI({querySelector:key=>nodes.get(key)||null,querySelectorAll:()=>[]},{querySelector:()=>badge,setAttribute:(k,v)=>attrs[k]=v});
 const response=(count=3)=>({ok:true,user:{...user},friends:[],requests:[],unreadMail:count});
 return{c,t,user,requests,timers,badge,mailBadge,attrs,response,setHandler:fn=>handler=fn};
}
const tests=[];const test=(name,run)=>tests.push({name,run});
test('system battle mail has its own sender and safe text, without a duplicate reward claim',()=>{
 const h=setup();h.t.s.mail=[{id:'m1',title:'【防衛敗北】大坂城',body:'大坂城 → 清洲城\n<script>unsafe</script>',source:'system',event:{kind:'field-battle'},gift:null,read:false,createdAt:'2026-11-21T08:00:00Z'}];
 let html=h.t.mailView();assert.match(html,/合戦の自動通知/);assert.match(html,/未読/);assert.match(html,/本拠移転/);
 h.t.s.openedMail='m1';html=h.t.mailView();assert.match(html,/システムからの自動通知/);assert.match(html,/大坂城 → 清洲城/);assert.match(html,/&lt;script&gt;/);assert(!html.includes('<script>'));assert(!html.includes('data-social="mail-claim"'));
 h.t.s.mail[0]={...h.t.s.mail[0],source:undefined,gift:{gold:100},claimed:false};html=h.t.mailView();assert.match(html,/運営から/);assert.match(html,/data-social="mail-claim"/);assert.match(html,/金 100/);
});
test('unread counts update while the community is closed and remain accessible',async()=>{
 const h=setup();h.setHandler(async()=>h.response(4));h.t.s.unreadLetters=2;await h.t.refreshMailStatus();
 assert.equal(h.t.s.open,false);assert.equal(h.t.s.unreadMail,4);assert.equal(h.mailBadge.textContent,'4');assert.equal(h.badge.textContent,'6');assert.equal(h.badge.hidden,false);assert.match(h.attrs['aria-label'],/未読 6 件/);assert(h.requests[0].url.endsWith('/me'));
});
test('the existing 30 second visible-page poll also checks automatic mail',async()=>{
 const h=setup();h.setHandler(async url=>url.endsWith('/config')?{ok:true,adminClaimed:true,announcement:'掲示',onlineCount:2}:h.response(7));
 await h.t.loadConfig();await until(()=>h.t.s.unreadMail===7);assert([...h.timers.values()].some(t=>t.ms===30000));assert(h.requests.some(r=>r.url.endsWith('/config')));assert(h.requests.some(r=>r.url.endsWith('/me')));
});
test('background checks deduplicate requests and skip hidden or signed-out pages',async()=>{
 const h=setup(),pending=deferred();h.setHandler(()=>pending.promise);const task=h.t.refreshMailStatus();await h.t.refreshMailStatus();assert.equal(h.requests.length,1);pending.resolve(h.response());await task;
 h.c.document.hidden=true;await h.t.refreshMailStatus();h.c.document.hidden=false;h.t.s.user=null;await h.t.refreshMailStatus();assert.equal(h.requests.length,1);
});
test('background unread polling leaves relation changes for the normal visible refresh',async()=>{
 const h=setup();h.t.s.friends=[{id:'old-friend'}];h.t.s.requests=[];
 h.setHandler(async()=>({...h.response(2),friends:[{id:'new-friend'}],requests:[{id:'pending',direction:'incoming'}]}));
 await h.t.refreshMailStatus();assert.equal(h.t.s.unreadMail,2);assert.equal(h.t.s.friends[0].id,'old-friend');assert.equal(h.t.s.requests.length,0);
 await h.t.loadMe();assert.equal(h.t.s.friends[0].id,'new-friend');assert.equal(h.t.s.requests[0].id,'pending');
});
test('a late unread response cannot undo a newer mark-read observation',async()=>{
 const h=setup(),old=deferred();let calls=0;h.setHandler(()=>++calls===1?old.promise:Promise.resolve(h.response(0)));
 const prior=h.t.refreshMailStatus();await h.t.loadMe();assert.equal(h.t.s.unreadMail,0);old.resolve(h.response(5));await prior;assert.equal(h.t.s.unreadMail,0);assert.equal(h.badge.hidden,true);
});
test('responses from a previous identity never update the new inbox badge',async()=>{
 const h=setup(),old=deferred();h.setHandler(()=>old.promise);const task=h.t.refreshMailStatus();h.t.switchIdentity('player-b');old.resolve(h.response(5));await task;assert.equal(h.t.s.unreadMail,0);assert.equal(h.t.s.user.id,'player-b');
 h.setHandler(async()=>({...h.response(2),user:{id:'player-b',name:'別領主',isAdmin:false,isStaff:false}}));await h.t.refreshMailStatus();assert.equal(h.t.s.unreadMail,2);assert.equal(h.requests.at(-1).options.headers.Authorization,'Bearer '+'b'.repeat(64));
});
test('a confirmed attack refreshes mail, while failed attacks do not fabricate a message',async()=>{
 const h=setup();h.setHandler(async url=>url.endsWith('/field/attack')?{ok:true,battle:{id:'confirmed'}}:h.response(1));
 const result=await h.c.SengokuSocial.fieldRequest('/field/attack',{method:'POST',data:{requestId:'test-only'}});assert.equal(result.battle.id,'confirmed');await until(()=>h.t.s.unreadMail===1);assert.equal(h.t.s.mail.length,0,'Messages are fetched from the server, never made up locally');
 h.setHandler(async()=>({ok:false,__status:409,error:{code:'FIELD_CHANGED',message:'changed'}}));const before=h.requests.length;await assert.rejects(h.c.SengokuSocial.fieldRequest('/field/attack',{method:'POST',data:{}}));assert.equal(h.requests.length,before+1);
});
test('a transient summary failure leaves the existing unread count and allows retry',async()=>{
 const h=setup();h.t.s.unreadMail=2;h.setHandler(async()=>{throw Error('temporary offline');});await h.t.refreshMailStatus();assert.equal(h.t.s.unreadMail,2);h.setHandler(async()=>h.response(4));await h.t.refreshMailStatus();assert.equal(h.t.s.unreadMail,4);
});
(async()=>{for(const t of tests){await t.run();console.log('PASS',t.name);}console.log(`${tests.length} system-mail UI checks passed; all responses were local fixtures.`);})().catch(error=>{console.error(error);process.exitCode=1;});
