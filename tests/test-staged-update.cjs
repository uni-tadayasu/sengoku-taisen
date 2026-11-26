'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {MessageChannel}=require('node:worker_threads');
const {setup}=require('./helpers/dom-model.cjs');
const root=path.resolve(__dirname,'..'),text=file=>fs.readFileSync(path.join(root,file),'utf8');
const edition=JSON.parse(text('site-metadata.json')).release,staged='9.9.9-20270101',origin='https://game.example',scope=origin+'/game/';
const url=name=>new URL(name,scope).href;
function target(){const handlers=new Map();return{addEventListener(event,cb){if(!handlers.has(event))handlers.set(event,new Set());handlers.get(event).add(cb);},async fire(event,data){await Promise.all([...(handlers.get(event)||[])].map(cb=>cb(data)));}};}
const settle=async()=>{for(let turn=0;turn<4;turn++)await new Promise(resolve=>setImmediate(resolve));};
function fakeClock(){
 let now=0,sequence=0;const timers=new Map();
 return{Date:class extends Date{static now(){return now;}},setTimeout(cb,delay){const id=++sequence;timers.set(id,{at:now+delay,cb});return id;},clearTimeout(id){timers.delete(id);},
  async tick(ms){const end=now+ms;for(;;){const next=[...timers].filter(([,timer])=>timer.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].cb();await settle();}now=end;await settle();}};
}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}
async function bootFixture(){
 const {doc:document,host}=setup(),win=target(),registration=target(),api=target(),clock=fakeClock();
 const html=text('index.html');host.innerHTML=html.slice(html.indexOf('<a href="#launch-enter"'),html.indexOf('<noscript>'));
 Object.assign(document,target(),{readyState:'loading',visibilityState:'visible',hidden:false});
 document.getElementById=id=>document.querySelector('#'+id);document.body.classList.add('at-title');
 const manifest=document.createElement('link');manifest.setAttribute('rel','manifest');manifest.href=url('manifest.webmanifest?v='+edition);document.body.appendChild(manifest);
 const calls={updates:0,saves:0,toasts:[],visits:[],cached:true,save:async()=>({ok:false,message:'保存失敗'}),update:async()=>{}};
 Object.assign(win,{MessageChannel,navigator:{serviceWorker:api,onLine:true},SENGOKU_AT_TITLE:true,location:{href:scope+'?room=kept#town',protocol:'https:',replace:dest=>calls.visits.push(dest)},
  caches:{has:async()=>calls.cached,open:async()=>({match:async()=>({status:200})})},SengokuArt:{decorate(){},readyCurrent:async()=>{}},
  SengokuBridge:{hasStarted:()=>true,getState:()=>({clan:'織田家',home:'kiyosu',officers:[]}),prepareReleaseSwitch:async()=>{calls.saves++;return calls.save();},toast:message=>calls.toasts.push(message)}});
 Object.assign(registration,{scope,waiting:null,update:async()=>{calls.updates++;await calls.update();}});api.register=async()=>registration;
 vm.runInNewContext(text('boot.js'),{window:win,document,URL,Date:clock.Date,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,requestAnimationFrame:cb=>cb(),performance});
 await document.fire('DOMContentLoaded');await win.fire('load');await settle();
 const node=id=>document.getElementById(id),click=async id=>{const button=node(id);await Promise.all([...button._events.get('click')||[]].map(cb=>cb({target:button})));};
 async function stage(version=staged){const worker=target();worker.postMessage=(message,ports)=>{assert.equal(message.type,'sengoku-release');ports[0].postMessage({release:version});};registration.installing=worker;await registration.fire('updatefound');registration.waiting=worker;await worker.fire('statechange');registration.installing=null;await settle();return worker;}
 return{document,win,registration,api,clock,calls,node,click,stage};
}

async function bootTest(){
 const {node,click,stage,calls,win,document,api,registration}=await bootFixture();
 assert(node('game-update-action').hidden);assert.equal(calls.visits.length,0);
 win.SengokuTitle.enter();await settle();
 const draft=document.createElement('textarea');document.getElementById('main').appendChild(draft);draft.value='入力中の文章';draft.focus();
 await stage();
 assert.equal(node('game-update-action').hidden,false);assert.equal(node('game-update-notice').hidden,false);
 assert.equal(document.activeElement,draft);assert.equal(draft.value,'入力中の文章');assert.equal(calls.saves,0);assert.deepEqual(calls.visits,[]);
 await click('game-update-return');assert.equal(calls.saves,1);assert.equal(win.SENGOKU_AT_TITLE,false);assert.equal(node('game-update-notice-status').textContent,'保存失敗');assert.deepEqual(calls.visits,[]);
 assert.equal(draft.value,'入力中の文章');assert.equal(document.activeElement,draft);
 const save=deferred();calls.save=()=>save.promise;
 const returning=click('game-update-return');await settle();await click('game-update-return');assert.equal(calls.saves,2,'Repeated clicks must share one save operation');
 save.resolve({ok:true});await returning;assert.equal(win.SENGOKU_AT_TITLE,true);assert.deepEqual(calls.visits,[],'Returning to title must not reload');
 assert.equal(node('game-update-open').disabled,false);assert.equal(document.activeElement,node('game-update-open'));assert.equal(draft.value,'入力中の文章');
 assert.equal(node('game-update-notice-status').textContent,'','Completed saving must clear the gameplay progress message');
 await click('launch-enter');await settle();assert.equal(win.SENGOKU_AT_TITLE,false);assert.equal(node('game-update-notice').hidden,false);assert.equal(node('game-update-notice-label').textContent,'新版あり');assert.equal(node('game-update-return').disabled,false);assert.equal(node('game-update-notice-status').textContent,'','Deferring the update and resuming gameplay must not show a stale saving state');assert.equal(calls.saves,2);assert.deepEqual(calls.visits,[]);
 win.SengokuTitle.home();
 calls.cached=false;await click('game-update-open');assert.equal(calls.saves,2);assert.match(node('game-update-status').textContent,/新版の準備/);assert.deepEqual(calls.visits,[]);calls.cached=true;
 calls.save=async()=>({ok:false,message:'同期失敗'});await click('game-update-open');assert.equal(node('game-update-status').textContent,'同期失敗');assert.deepEqual(calls.visits,[]);
 const switching=deferred();calls.save=()=>switching.promise;const opening=click('game-update-open');await settle();registration.waiting=null;switching.resolve({ok:true});await opening;
 assert.deepEqual(calls.visits,[],'A replaced waiting worker must not receive the earlier choice');
 await stage();calls.save=async()=>({ok:true});await click('game-update-open');assert.deepEqual(calls.visits,[scope+'?room=kept&sengoku-version='+staged+'#town']);
 await api.fire('controllerchange');assert.equal(calls.visits.length,1);
}

async function discoveryTest(){
 const {win,document,clock,calls,click,node}=await bootFixture();
 await clock.tick(59999);assert.equal(calls.updates,0);await clock.tick(1);assert.equal(calls.updates,1);
 document.visibilityState='hidden';document.hidden=true;await document.fire('visibilitychange');await clock.tick(180000);assert.equal(calls.updates,1,'Hidden tabs must stop polling');
 const update=deferred();calls.update=()=>update.promise;document.visibilityState='visible';document.hidden=false;
 await document.fire('visibilitychange');await win.fire('focus');await win.fire('focus');await settle();
 assert.equal(calls.updates,2);const manual=click('game-update-check-button');await settle();await clock.tick(120000);assert.equal(calls.updates,2,'Focus, visibility, manual and overdue timers must share the active request');
 assert.equal(node('game-update-check-button').disabled,true);update.resolve();await manual;await settle();assert.equal(node('game-update-check-button').disabled,false);
 calls.update=async()=>{};
 // The long request may already be due for its next normal check; do not let a
 // burst of restoration events start several checks at the same timestamp.
 await clock.tick(1);const afterLong=calls.updates;await win.fire('focus');await document.fire('visibilitychange');await settle();assert.equal(calls.updates,afterLong);
 win.navigator.onLine=false;await win.fire('offline');await clock.tick(180000);assert.equal(calls.updates,afterLong);
 await click('game-update-menu-check');assert.match(node('game-update-check-status').textContent,/オフライン/);assert.equal(calls.updates,afterLong);
 win.navigator.onLine=true;await win.fire('online');await win.fire('focus');await document.fire('visibilitychange');await settle();assert.equal(calls.updates,afterLong+1);
 await win.fire('pagehide');await clock.tick(120000);assert.equal(calls.updates,afterLong+1);
 await win.fire('pageshow');await settle();assert.equal(calls.updates,afterLong+2);assert.equal(calls.saves,0);assert.deepEqual(calls.visits,[]);
}

async function navigationDuringSaveTest(){
 for(const fromTitle of [true,false]){
  const {win,document,calls,click,stage,node}=await bootFixture();
  if(!fromTitle)win.SengokuTitle.enter();
  await stage();
  const save=deferred();calls.save=()=>save.promise;
  const pending=click(fromTitle?'game-update-open':'game-update-return');await settle();
  assert.equal(calls.saves,1);
  // A slow save may finish after the player has left and returned to the
  // same screen. Its boolean state alone cannot identify the original visit.
  if(fromTitle){win.SengokuTitle.enter();win.SengokuTitle.home();}
  else{win.SengokuTitle.home();win.SengokuTitle.enter();}
  const focusAfterNavigation=document.activeElement;
  save.resolve({ok:true});await pending;
  assert.deepEqual(calls.visits,[],'An earlier update choice must not reload a later title visit');
  assert.equal(win.SENGOKU_AT_TITLE,fromTitle,'A completed save must not undo the newer navigation');
  assert.equal(node('game-update-open').disabled,false);assert.equal(node('game-update-return').disabled,false);
  assert.equal(node(fromTitle?'game-update-status':'game-update-notice-status').textContent,'');
  assert.equal(document.activeElement,focusAfterNavigation,'A stale save must not steal focus from the newer screen');
  calls.save=async()=>({ok:true});await click(fromTitle?'game-update-open':'game-update-return');
  if(fromTitle)assert.equal(calls.visits.length,1,'A fresh explicit update choice remains usable');
  else assert.equal(win.SENGOKU_AT_TITLE,true,'A fresh explicit return choice remains usable');
 }
}

async function manualTest(){
 const {calls,click,clock,node}=await bootFixture();
 const update=deferred();calls.update=()=>update.promise;
 const first=click('game-update-check-button'),second=click('game-update-menu-check');await settle();assert.equal(calls.updates,1);update.resolve();await Promise.all([first,second]);
 assert.match(node('game-update-check-status').textContent,/新しい更新はありません/);
 await click('game-update-check-button');assert.equal(calls.updates,1);assert.match(node('game-update-check-status').textContent,/直前に確認/);
 await clock.tick(10000);calls.update=async()=>{throw Error('network');};await click('game-update-check-button');assert.equal(calls.updates,2);assert.match(node('game-update-check-status').textContent,/確認できません/);
 calls.update=async()=>{};await clock.tick(59999);assert.equal(calls.updates,2);await clock.tick(1);assert.equal(calls.updates,3,'Automatic checking must recover after a network failure');
 assert.equal(calls.saves,0);assert.deepEqual(calls.visits,[]);
}

async function workerTest(){
 const events={},old='sengoku-taisen-v'+edition,next='sengoku-taisen-v'+staged;
 const rows=new Map([[old,new Map([[url('index.html'),'OLD DOC'],[url('same.bundle.js?v=oldhash'),'OLD CODE']])],[next,new Map([[url('index.html'),'NEW DOC'],[url('same.bundle.js?v=newhash'),'NEW CODE']])]]);
 const art=(cache,stem,value)=>rows.get(cache).set(url('assets/responsive/'+stem+'.webp'),value);
 art(old,'war-jade-240','current chapter');art(next,'war-jade-240','waiting chapter');
 art(old,'war-240','legacy chapter');art(next,'war-kasumi-240','future chapter');
 art(old,'brand-20261127-jade-48','current crest');art(next,'brand-20270101-kasumi-48','future crest');
 const clients=new Map([['selected',{url:scope+'?sengoku-version='+staged}],['other',{url:scope}]]);
 let forced=0;
 const self={location:{origin},registration:{scope,waiting:{}},clients:{get:async id=>clients.get(id)},skipWaiting:()=>forced++,addEventListener:(type,cb)=>{events[type]=cb;}};
 const caches={has:async name=>rows.has(name),open:async name=>({match:async key=>{const value=rows.get(name)?.get(key);return value&&new Response(value);}})};
 const restart=()=>vm.runInNewContext(text('sw.js'),{self,caches,Response,URL,Request,Headers,fetch:async()=>{throw Error('offline');}});
 restart();
 let response;events.message({data:{type:'sengoku-release'},ports:[{postMessage:value=>{response=value;}}]});assert.equal(response.release,edition);
 async function req(name,kind,clientId,resultingClientId){
   let result;events.fetch({clientId,resultingClientId,request:{url:url(name),method:'GET',mode:kind,headers:new Headers()},respondWith:value=>{result=value;},waitUntil:()=>{}});
   return(await result).text();
 }
 assert.equal(await req('./?sengoku-version='+staged,'navigate','', 'selected'),'NEW DOC');
 assert.equal(await req('same.bundle.js?v=newhash','cors','selected'),'NEW CODE');
 assert.equal(await req('./','navigate','','other'),'OLD DOC');
 assert.equal(await req('same.bundle.js?v=oldhash','cors','other'),'OLD CODE');
 restart();
 assert.equal(await req('same.bundle.js?v=newhash','cors','selected'),'NEW CODE');
 assert.equal(await req('same.bundle.js?v=oldhash','cors','other'),'OLD CODE');
 assert.equal(await req('assets/responsive/war-jade-panel-900.webp','cors','selected'),'waiting chapter');
 assert.equal(await req('assets/responsive/war-jade-panel-900.webp','cors','other'),'current chapter');
 assert.equal(await req('assets/responsive/war-panel-900.webp','cors','other'),'legacy chapter');
 assert.equal(await req('assets/chronicle/war-kasumi.webp','cors','selected'),'future chapter');
 assert.equal(await req('assets/responsive/brand-20270101-kasumi-144.webp','cors','selected'),'future crest');
 assert.equal(await req('assets/responsive/brand-20261127-jade-144.webp','cors','other'),'current crest');
 assert.equal(forced,0);
}

async function saveTest(){
 const helper=text('app.js').match(/  async function prepareReleaseSwitch\(\)\{[\s\S]*?\n  \}/)[0];
 let live={state:{turn:5}},local={state:{turn:4}},writes=0,flushes=0;
 const ctx={window:{SengokuCloudSync:{flush:async()=>{flushes++;return{ok:true};}}},startPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,worldSettlementPending:false,
  syncAccess:{linked:true,writable:true},saveEnabled:true,saveChangedInAnotherTab:false,canMutate:()=>true,getGameSave:()=>live,getStoredSave:()=>local,save:()=>{writes++;local=JSON.parse(JSON.stringify(live));return true;}};
 vm.runInNewContext(helper+';this.check=prepareReleaseSwitch;',ctx);
 assert((await ctx.check()).ok);assert.equal(writes,1);assert.equal(flushes,1);
 ctx.saveChangedInAnotherTab=true;local.state.turn=10;assert(!(await ctx.check()).ok);assert.equal(writes,1);assert.equal(local.state.turn,10);
 ctx.fieldActionPending=true;assert(!(await ctx.check()).ok);ctx.fieldActionPending=false;
 ctx.saveChangedInAnotherTab=false;local=live;ctx.window.SengokuCloudSync.flush=async()=>({ok:false});assert(!(await ctx.check()).ok);
}

(async()=>{await bootTest();await navigationDuringSaveTest();await discoveryTest();await manualTest();await workerTest();await saveTest();console.log('PASS visible/online update discovery, focus and manual coalescing, saved gameplay-to-title choice, save-failure retention, chosen-tab staged offline load and older-tab continuity, including worker restart.');})().catch(error=>{console.error(error);process.exitCode=1;});
