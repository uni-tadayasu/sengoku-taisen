/* Production notification entry routing, without opening a real browser. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
function fn(name){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
const initialization=source.match(/^  let primedProgressOwner=.*\n  try\{noticeRecapPending=.*\n/m)?.[0];assert(initialization,'actual startup query parser');
const swMessage=source.split('\n').find(line=>line.includes("navigator.serviceWorker?.addEventListener?.('message'"));assert(swMessage,'actual Service Worker message listener');
function fixture(options={}){
 const location=new URL(options.url||'https://game.example.invalid/?notice=1'),opened=[],replaced=[],handlers=new Map(),control={identity:{playerId:'u_first',user:{id:'u_first'}},writable:options.writable!==false,primes:0,configures:0,historyFails:false,openBlocked:false};
 const history={state:{position:12,source:'existing-navigation'},replaceState:(value,title,url)=>{if(control.historyFails)throw Error('history unavailable');replaced.push({value,title,url});location.href=new URL(url,location).href;}};
 const context={URL,URLSearchParams,console,startPending:false,saveEnabled:true,syncAccess:{ready:true,rolePending:false,banned:false,writable:control.writable},state:()=>({walking:{campaignId:'entry-campaign'}}),canMutate:()=>control.writable,syncMessage:()=>'',configureProgress:()=>control.configures++,openExpansion:(kind,tab)=>{if(control.openBlocked)return false;opened.push({kind,tab});},
  navigator:{serviceWorker:{addEventListener:(type,callback)=>handlers.set(type,callback)}},window:{location,history,SengokuCourt:{mount:()=>{}},SengokuSocial:{getExpansionContext:()=>control.identity,open:()=>{}},SengokuProgress:{prime:async()=>control.primes++,getState:()=>({loaded:true})}}};
 vm.createContext(context);vm.runInContext([initialization,fn('getExpansionAccess'),fn('openPendingRecap'),fn('primeProgress'),swMessage,'globalThis.entry={primeProgress,openPendingRecap,pending:()=>noticeRecapPending};'].join('\n'),context,{filename:'app-notification-entry.js'});
 return{context,control,location,history,opened,replaced,entry:context.entry,message:(type,destination)=>handlers.get('message')({data:{type,destination}})};
}
const tests=[],test=(name,run)=>tests.push([name,run]);

test('a notification waits through startup, account verification, role resolution and a ban without losing its intent',async()=>{
 const checks=[
  ['start selection',f=>f.context.startPending=true,f=>f.context.startPending=false],
  ['initial synchronization',f=>f.context.syncAccess.ready=false,f=>f.context.syncAccess.ready=true],
  ['role verification',f=>f.context.syncAccess.rolePending=true,f=>f.context.syncAccess.rolePending=false],
  ['account ban',f=>f.context.syncAccess.banned=true,f=>f.context.syncAccess.banned=false],
  ['identity verification',f=>f.control.identity.user=null,f=>f.control.identity.user={id:'u_first'}]
 ];
 for(const[label,block,release]of checks){const f=fixture({writable:false});block(f);await f.entry.primeProgress();await f.entry.primeProgress();assert.equal(f.opened.length,0,label);assert.equal(f.replaced.length,0,label);assert.equal(f.entry.pending(),true,label);release(f);await f.entry.primeProgress();assert.deepEqual(f.opened,[{kind:'progress',tab:'recap'}],label);assert.equal(f.entry.pending(),false,label);}
});

test('a synchronized follower opens the report without writer access, mutation or mission priming',async()=>{
 const f=fixture({writable:false});assert.equal(f.context.getExpansionAccess().writable,false);await f.entry.primeProgress();assert.deepEqual(f.opened,[{kind:'progress',tab:'recap'}]);assert.equal(f.control.primes,0);assert.equal(f.control.configures,0);assert.equal(f.context.syncAccess.writable,false);
 for(let i=0;i<4;i++)await f.entry.primeProgress();assert.equal(f.opened.length,1);assert.equal(f.replaced.length,1);
});

test('consuming a notification removes only its query parameter and retains the page path, other filters, fragment and history state',async()=>{
 const f=fixture({url:'https://game.example.invalid/sengoku-vs/?source=push&notice=1&filter=army&filter=governor#report',writable:false}),previous=f.history.state;await f.entry.primeProgress();
 assert.equal(f.replaced.length,1);assert.strictEqual(f.replaced[0].value,previous);assert.equal(f.replaced[0].title,'');assert.equal(f.location.pathname,'/sengoku-vs/');assert.equal(f.location.searchParams.has('notice'),false);assert.equal(f.location.searchParams.get('source'),'push');assert.deepEqual(f.location.searchParams.getAll('filter'),['army','governor']);assert.equal(f.location.hash,'#report');assert.equal(f.location.origin,'https://game.example.invalid');
});

test('Service Worker messages coalesce while startup is pending and open once when a read-only session is ready',async()=>{
 const f=fixture({url:'https://game.example.invalid/?source=existing#town',writable:false});await f.entry.primeProgress();assert.equal(f.opened.length,0);f.message('unrelated-message');assert.equal(f.entry.pending(),false);f.context.syncAccess.ready=false;
 f.message('sengoku-open-recap');f.message('sengoku-open-recap');assert.equal(f.entry.pending(),true);assert.equal(f.opened.length,0);f.context.syncAccess.ready=true;await f.entry.primeProgress();assert.equal(f.opened.length,1);await f.entry.primeProgress();f.entry.openPendingRecap();assert.equal(f.opened.length,1);assert.equal(f.location.href,'https://game.example.invalid/?source=existing#town');
});

test('ordinary visits do not open a report, and a writer still primes only once after an explicit notification',async()=>{
 for(const suffix of ['','?notice=0','?notice=other']){const f=fixture({url:'https://game.example.invalid/'+suffix,writable:false});await f.entry.primeProgress();assert.equal(f.opened.length,0);assert.equal(f.replaced.length,0);}
 const f=fixture();await f.entry.primeProgress();await f.entry.primeProgress();assert.equal(f.opened.length,1);assert.equal(f.control.primes,1);assert.equal(f.control.configures,1);
});

test('an unavailable history API does not lose the report or reopen it on the next readiness check',async()=>{
 const f=fixture({writable:false});f.control.historyFails=true;await f.entry.primeProgress();assert.equal(f.opened.length,1);assert.equal(f.entry.pending(),false);await f.entry.primeProgress();assert.equal(f.opened.length,1);
});

test('message notifications wait for account readiness then open only their authorized social screen',async()=>{
 for(const destination of ['mail','letters','world','guild','friends','admin','news']){
  const f=fixture({url:'https://game.example.invalid/?notice='+destination,writable:false});f.context.syncAccess.rolePending=true;
  await f.entry.primeProgress();assert.equal(f.opened.length,0);assert.equal(f.entry.pending(),true);
  f.context.syncAccess.rolePending=false;await f.entry.primeProgress();
  assert.deepEqual(f.opened,[{kind:'social',tab:destination}]);assert.equal(f.control.primes,0);assert.equal(f.location.searchParams.has('notice'),false);
 }
});

test('court notifications wait for the mounted module and account readiness, then use the court entry',async()=>{
 for(const destination of ['courtChat','courtAudiences']){
  const f=fixture({url:'https://game.example.invalid/?notice='+destination,writable:false});
  const court=f.context.window.SengokuCourt;delete f.context.window.SengokuCourt;await f.entry.primeProgress();assert.equal(f.opened.length,0);assert.equal(f.entry.pending(),true);
  f.context.window.SengokuCourt=court;f.context.syncAccess.rolePending=true;await f.entry.primeProgress();assert.equal(f.opened.length,0);
  f.context.syncAccess.rolePending=false;await f.entry.primeProgress();assert.deepEqual(f.opened,[{kind:'court',tab:destination}]);assert.equal(f.location.searchParams.has('notice'),false);
  f.message('sengoku-open-notification',destination);assert.deepEqual(f.opened.at(-1),{kind:'court',tab:destination});
 }
});

test('a court notification waits while an existing uncertain operation blocks navigation',async()=>{
 const f=fixture({url:'https://game.example.invalid/?notice=courtAudiences',writable:false});f.control.openBlocked=true;
 await f.entry.primeProgress();assert.equal(f.entry.pending(),true);assert.equal(f.opened.length,0);assert.equal(f.location.searchParams.get('notice'),'courtAudiences');
 f.control.openBlocked=false;await f.entry.primeProgress();assert.deepEqual(f.opened,[{kind:'court',tab:'courtAudiences'}]);assert.equal(f.entry.pending(),false);assert.equal(f.location.searchParams.has('notice'),false);
});

test('new Service Worker destinations are allowlisted and consumed once without navigating to payload URLs',async()=>{
 const f=fixture({url:'https://game.example.invalid/',writable:false});
 f.message('sengoku-open-notification','https://untrusted.invalid/');assert.equal(f.entry.pending(),false);assert.equal(f.opened.length,0);
 f.context.syncAccess.ready=false;f.message('sengoku-open-notification','letters');assert.equal(f.opened.length,0);
 f.context.syncAccess.ready=true;await f.entry.primeProgress();assert.deepEqual(f.opened,[{kind:'social',tab:'letters'}]);await f.entry.primeProgress();assert.equal(f.opened.length,1);
 const t=fixture({url:'https://game.example.invalid/?notice=notifications',writable:false});await t.entry.primeProgress();assert.deepEqual(t.opened,[{kind:'notifications',tab:'notifications'}]);
});

(async()=>{let failed=0;for(const[name,run]of tests){try{await run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}console.log(`${tests.length-failed}/${tests.length} notification entry scenarios passed.`);if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
