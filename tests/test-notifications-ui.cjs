/* Exercise the actual opt-in dialog with a deterministic DOM and browser Push.
 * No permission prompt, real endpoint or network request is used. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(path.join(__dirname,'../notifications.js'),'utf8');
const OWNER_KEY='sengoku-push-owner-v1',clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
async function settle(){for(let i=0;i<50;i++)await Promise.resolve();}
const defaults={enabled:false,battle:true,letter:true,operation:true,construction:true,event:true,quietStart:22,quietEnd:8,digestMinutes:15};
function fixture(options={}){
 const {doc}=setup(),create=doc.createElement.bind(doc),trace=[],calls=[],stored=new Map(),rows=new Map(),notices=[];
 doc.createElement=name=>{const node=create(name);if(name==='dialog'){node.showModal=()=>node.open=true;node.close=()=>node.open=false;}return node;};
 const control={identity:{playerId:'u_first',user:{id:'u_first'}},gesture:false,permission:'granted',onPermission:null,onGetSubscription:null,onGetRegistration:null,onRequest:null,subscription:null,subscribes:0,unsubscribes:0,permissions:0};
 function subscription(id='new-endpoint'){
  const value={endpoint:'https://push.example.invalid/'+id,keys:{p256dh:'public-key',auth:'auth-key'}};
  const sub={endpoint:value.endpoint,toJSON:()=>clone(value),unsubscribe:async()=>{trace.push('browser-unsubscribe');control.unsubscribes++;if(control.subscription===sub)control.subscription=null;return true;}};
  return sub;
 }
 const registration={pushManager:{
  getSubscription:async()=>{trace.push('get-subscription');return control.onGetSubscription?control.onGetSubscription():control.subscription;},
  subscribe:async data=>{trace.push('browser-subscribe');control.subscribes++;assert.equal(data.userVisibleOnly,true);assert.deepEqual([...data.applicationServerKey],[1,2,3]);control.subscription=subscription();return control.subscription;}
 }};
 const navigator={serviceWorker:{register:async url=>{trace.push('register');assert.equal(url,'./sw.js');return registration;},ready:Promise.resolve(registration),getRegistration:async()=>{trace.push('get-registration');return control.onGetRegistration?control.onGetRegistration():registration;}}};
 const Notification={requestPermission:()=>{assert(control.gesture,'browser permission must begin in the original click handler');trace.push('permission');control.permissions++;return control.onPermission?control.onPermission():Promise.resolve(control.permission);}};
 function row(){const id=control.identity.playerId;if(!rows.has(id))rows.set(id,{ok:true,configured:options.configured!==false,publicKey:'AQID',devices:0,preferences:clone(defaults)});return rows.get(id);}
 const request=async(route,args={})=>{const call={owner:control.identity.playerId,route,method:args.method||'GET',data:clone(args.data||{})};calls.push(call);trace.push(call.method+' '+route);if(control.onRequest){const result=await control.onRequest(call);if(result!==undefined)return result;}if(route==='/notifications/preferences')row().preferences=clone(args.data);if(route==='/notifications/subscribe')row().devices=1;if(route==='/notifications/unsubscribe')row().devices=0;return route==='/notifications'?clone(row()):{ok:true};};
 class FormData{constructor(form){this.values=new Map();for(const input of form.querySelectorAll('input,select')){if(input.getAttribute('type')==='checkbox'&&!input.checked)continue;this.values.set(input.getAttribute('name'),input.value);}}has(key){return this.values.has(key);}get(key){return this.values.get(key)??null;}}
 const window={isSecureContext:options.supported!==false,PushManager:function(){},Notification};
 vm.runInNewContext(source,{window,document:doc,navigator,Notification,FormData,Uint8Array,atob,console,localStorage:{getItem:key=>stored.get(key)??null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)}},{filename:'notifications.js'});
 const api=window.SengokuNotifications;
 const open=()=>api.open({getContext:()=>control.identity,request,notify:(...args)=>notices.push(args)});
 const $=selector=>doc.body.querySelector(selector);
 const click=kind=>{const button=$('[data-notification="'+kind+'"]');assert(button,'rendered '+kind+' button');control.gesture=true;try{button.dispatchEvent({type:'click'});}finally{control.gesture=false;}};
 return{api,control,stored,rows,row,trace,calls,doc,open,click,$,subscription,notices};
}
const tests=[],test=(name,run)=>tests.push([name,run]);

test('opening is passive, while explicit enable requests permission inside the gesture and saves selected settings',async()=>{
 const f=fixture();f.open();await settle();assert.equal(f.control.permissions,0);assert.equal(f.control.subscribes,0);assert.deepEqual(f.calls.map(c=>c.route),['/notifications']);
 f.$('[name="battle"]').checked=false;f.$('[name="quietStart"]').value='23';f.$('[name="quietEnd"]').value='7';f.$('[name="digestMinutes"]').value='60';
 f.click('enable');assert.equal(f.control.permissions,1,'permission begins before the click returns');f.click('enable');await settle();
 assert.equal(f.control.permissions,1,'a second click cannot start another permission operation');assert.equal(f.control.subscribes,1);assert.equal(f.stored.get(OWNER_KEY),'u_first');
 assert.deepEqual(f.calls.map(c=>c.route),['/notifications','/notifications/subscribe','/notifications/preferences','/notifications']);
 assert.deepEqual(f.row().preferences,{...defaults,enabled:true,battle:false,quietStart:23,quietEnd:7,digestMinutes:60});
 assert(f.trace.indexOf('permission')<f.trace.indexOf('register'));assert(f.trace.indexOf('browser-subscribe')<f.trace.indexOf('POST /notifications/subscribe'));assert.match(f.$('dialog').textContent,/この端末の通知を有効にしました/);
});

test('denied permission and an unconfigured service do not register a browser endpoint',async()=>{
 const f=fixture();f.control.permission='denied';f.open();await settle();f.click('enable');await settle();assert.equal(f.control.subscribes,0);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.match(f.$('dialog').textContent,/通知が許可されませんでした/);assert.equal(f.$('[data-notification="enable"]').disabled,false);
 const missing=fixture({configured:false});missing.open();await settle();assert.equal(missing.$('[data-notification="enable"]').disabled,true);missing.click('enable');assert.equal(missing.control.permissions,0);
});

test('disabling persists the opt out before deleting both server and browser subscriptions',async()=>{
 const f=fixture();f.row().preferences.enabled=true;f.row().devices=1;f.control.subscription=f.subscription('existing');f.stored.set(OWNER_KEY,'u_first');f.open();await settle();f.click('disable');await settle();
 assert.equal(f.row().preferences.enabled,false);assert.equal(f.control.unsubscribes,1);assert.equal(f.control.subscription,null);assert.equal(f.stored.has(OWNER_KEY),false);
 assert.deepEqual(f.calls.filter(c=>c.method==='POST').map(c=>c.route),['/notifications/preferences','/notifications/unsubscribe']);assert(f.trace.indexOf('POST /notifications/preferences')<f.trace.indexOf('POST /notifications/unsubscribe'));assert(f.trace.indexOf('POST /notifications/unsubscribe')<f.trace.indexOf('browser-unsubscribe'));assert.match(f.$('dialog').textContent,/通知を停止しました/);
});

test('identity refresh closes private settings and removes the old local push subscription without changing the new account',async()=>{
 const f=fixture(),focus=f.doc.createElement('button');f.doc.body.appendChild(focus);focus.focus();f.control.subscription=f.subscription('old-owner');f.stored.set(OWNER_KEY,'u_first');f.open();await settle();f.control.identity={playerId:'u_second',user:{id:'u_second'}};await f.api.refreshAccess();
 assert.equal(f.$('dialog'),null);assert.equal(f.doc.activeElement,focus);assert.equal(f.control.unsubscribes,1);assert.equal(f.stored.has(OWNER_KEY),false);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});

test('an identity change while permission is pending prevents browser and server registration',async()=>{
 const f=fixture(),waiting=deferred();f.control.onPermission=()=>waiting.promise;f.open();await settle();f.click('enable');f.control.identity={playerId:'u_second',user:{id:'u_second'}};waiting.resolve('granted');await settle();assert.equal(f.control.subscribes,0);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);assert.equal(f.stored.has(OWNER_KEY),false);
});

test('an identity change while checking an existing subscription prevents a new browser subscription',async()=>{
 const f=fixture(),waiting=deferred();f.control.onGetSubscription=()=>waiting.promise;f.open();await settle();f.click('enable');await settle();assert(f.trace.includes('get-subscription'));f.control.identity={playerId:'u_second',user:{id:'u_second'}};waiting.resolve(null);await settle();assert.equal(f.control.subscribes,0);assert.equal(f.calls.filter(c=>c.method==='POST').length,0);
});

test('an identity change during disable cannot send unsubscribe with another account credentials',async()=>{
 const f=fixture(),waiting=deferred(),sub=f.subscription('first-owner');f.control.subscription=sub;f.stored.set(OWNER_KEY,'u_first');f.row().preferences.enabled=true;f.control.onGetSubscription=()=>waiting.promise;f.open();await settle();f.click('disable');await settle();assert(f.trace.includes('get-subscription'));f.control.identity={playerId:'u_second',user:{id:'u_second'}};waiting.resolve(sub);await settle();
 assert.equal(f.calls.filter(c=>c.owner==='u_second'&&c.method==='POST').length,0);assert.equal(f.calls.filter(c=>c.route==='/notifications/unsubscribe').length,0);
});

test('unsupported browsers still save quiet hours and categories, and unregistered players see the registration path',async()=>{
 const f=fixture({supported:false});f.open();await settle();assert.equal(f.$('[data-notification="enable"]').disabled,true);f.$('[name="letter"]').checked=false;f.click('save');await settle();assert.equal(f.row().preferences.letter,false);assert.equal(f.control.permissions,0);assert.match(f.$('dialog').textContent,/プッシュ通知を利用できません/);
 f.api.close();f.control.identity={};f.open();assert.equal(f.$('dialog'),null);assert.equal(f.notices.length,1);assert.match(f.notices[0][0],/領主登録/);
});

(async()=>{let failed=0;for(const[name,run]of tests){try{await run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}console.log(`${tests.length-failed}/${tests.length} notification dialog scenarios passed.`);if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
