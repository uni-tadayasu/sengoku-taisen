/* Run the production Service Worker Push handlers without a real browser. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8'),clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{resolve,promise};};
function fixture(options={}){
 const handlers=new Map(),shown=[],opened=[],trace=[],control={windows:[],onShow:null};
 const self={location:{origin:'https://game.example.invalid'},addEventListener:(name,fn)=>handlers.set(name,fn),registration:{scope:options.scope,showNotification:async(title,options)=>{shown.push({title,options:clone(options)});if(control.onShow)await control.onShow();}},clients:{matchAll:async options=>{assert.deepEqual(clone(options),{type:'window',includeUncontrolled:true});trace.push('match');return control.windows;},openWindow:async url=>{opened.push(url);trace.push('open');}}};
 vm.runInNewContext(source,{self,URL,Response,console},{filename:'sw.js'});
 function emit(type,data={}){let waiting;const event={...data,waitUntil:value=>waiting=value};handlers.get(type)(event);assert(waiting&&typeof waiting.then==='function','event extends its lifetime through asynchronous work');return waiting;}
 const click=()=>emit('notificationclick',{notification:{data:{url:'https://untrusted.example.invalid/'},close:()=>trace.push('close')}});
 return{handlers,shown,opened,trace,control,emit,click};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('authenticated Push payload renders bounded text, local artwork and a single quiet replacement tag',async()=>{
 const f=fixture(),waiting=deferred();f.control.onShow=()=>waiting.promise;let finished=false;
 const result=f.emit('push',{data:{json:()=>({title:'a'.repeat(140),body:'b'.repeat(300),url:'https://untrusted.example.invalid/',icon:'https://untrusted.example.invalid/x',tag:'unbounded-'+Math.random()})}}).then(()=>finished=true);
 assert.equal(f.shown.length,1);const {title,options}=f.shown[0];assert.equal(title,'a'.repeat(100));assert.equal(options.body,'b'.repeat(240));assert.equal(options.tag,'sengoku-update');assert.equal(options.renotify,false);assert.match(options.icon,/^\.\/assets\/branding\//);assert.match(options.badge,/^\.\/assets\/branding\//);assert.deepEqual(options.data,{url:'/?notice=1'});assert(!JSON.stringify(options).includes('untrusted'));await Promise.resolve();assert.equal(finished,false);waiting.resolve();await result;
});
test('missing, malformed and non-string Push fields use the generic report text',async()=>{
 const f=fixture();for(const data of [undefined,{json:()=>{throw Error('bad JSON');}},{json:()=>null},{json:()=>({title:{},body:21})}]){await f.emit('push',{data});const notice=f.shown.at(-1);assert.equal(notice.title,'戦国VSのお知らせ');assert.equal(notice.options.body,'領国の報告を確認してください。');}
 assert.equal(f.shown.length,4);
});
test('notification clicks close immediately, await the existing game focus and request the return recap',async()=>{
 const f=fixture(),waiting=deferred(),messages=[];f.control.windows=[{url:'https://another.example.invalid/',focus:()=>{throw Error('foreign tab');}},{url:'https://game.example.invalid/?old=1',focus:async()=>{f.trace.push('focus');await waiting.promise;},postMessage:value=>{messages.push(clone(value));f.trace.push('message');}}];
 const result=f.click();assert.equal(f.trace[0],'close');for(let i=0;i<10;i++)await Promise.resolve();assert(f.trace.includes('focus'));assert.equal(messages.length,0);waiting.resolve();await result;assert.deepEqual(messages,[{type:'sengoku-open-recap'}]);assert.equal(f.opened.length,0);assert.deepEqual(f.trace,['close','match','focus','message']);
});
test('when there is no game window, notification clicks open only the local recap entry',async()=>{
 const f=fixture();f.control.windows=[{url:'https://other.example.invalid/',focus:()=>{throw Error('foreign tab');}}];await f.click();assert.deepEqual(f.opened,['./?notice=1']);assert.deepEqual(f.trace,['close','match','open']);
});
test('chat and mail notifications preserve only an allowed screen and tap into the game',async()=>{
 for(const destination of ['mail','letters','world','guild','friends','admin','news','notifications','courtChat','courtAudiences']){
  const f=fixture();await f.emit('push',{data:{json:()=>({title:'戦国VS',destination,url:'https://untrusted.invalid/'})}});
  assert.deepEqual(f.shown[0].options.data,{destination});assert.equal(f.shown[0].options.tag,'sengoku-'+destination);
  await f.emit('notificationclick',{notification:{data:f.shown[0].options.data,close:()=>{}}});assert.deepEqual(f.opened,['./?notice='+destination]);
 }
});
test('a notification never focuses an unrelated guide page and respects a subdirectory game scope',async()=>{
 const f=fixture({scope:'https://game.example.invalid/game/'}),received=[];
 f.control.windows=[{url:'https://game.example.invalid/guide/',focus:()=>{throw Error('unrelated guide');}},{url:'https://game.example.invalid/game/?old=1',focus:async()=>{},postMessage:value=>received.push(clone(value))}];
 await f.emit('notificationclick',{notification:{data:{destination:'letters'},close:()=>{}}});
 assert.deepEqual(received,[{type:'sengoku-open-notification',destination:'letters'}]);assert.equal(f.opened.length,0);
});
test('a closing game tab does not prevent another game window or the safe entry from opening',async()=>{
 const f=fixture();f.control.windows=[{url:'https://game.example.invalid/',focus:async()=>{throw Error('closed');}}];
 await f.emit('notificationclick',{notification:{data:{destination:'javascript:bad'},close:()=>{}}});assert.deepEqual(f.opened,['./?notice=1']);
});
(async()=>{let failed=0;for(const[name,run]of tests){try{await run();console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+'\n'+error.stack);}}console.log(`${tests.length-failed}/${tests.length} Service Worker notification scenarios passed.`);if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
