'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {MessageChannel}=require('node:worker_threads');
const root=path.resolve(__dirname,'..'),text=file=>fs.readFileSync(path.join(root,file),'utf8');
const edition=JSON.parse(text('site-metadata.json')).release,staged='9.9.9-20270101',origin='https://game.example',scope=origin+'/game/';
const url=name=>new URL(name,scope).href;
function target(){const handlers={};return{hidden:true,addEventListener:(event,cb)=>{handlers[event]=cb;},fire:(event,data)=>handlers[event]?.(data)};}

async function bootTest(){
 const button=target(),action=target(),status=target(),document=target(),win=target(),registration=target(),api=target();
 const nodes={'game-update-action':action,'game-update-open':button,'game-update-status':status};
 document.readyState='loading';document.getElementById=id=>nodes[id];document.querySelector=()=>({href:url('manifest.webmanifest?v='+edition)});
 let state={ok:false,message:'保存失敗'},checks=0,visits=[];
 Object.assign(win,{MessageChannel,navigator:{serviceWorker:api},location:{href:scope,protocol:'https:',replace:dest=>visits.push(dest)},
   caches:{has:async()=>true,open:async()=>({match:async()=>({status:200})})},SengokuBridge:{prepareReleaseSwitch:async()=>{checks++;return state;}}});
 Object.assign(registration,{scope,waiting:null,update:async()=>{}});
 api.register=async()=>registration;
 vm.runInNewContext(text('boot.js'),{window:win,document,URL,Date,setTimeout,clearTimeout});
 await win.fire('load');
 assert(action.hidden);assert.equal(visits.length,0);
 const worker=target();worker.postMessage=(message,ports)=>{assert.equal(message.type,'sengoku-release');ports[0].postMessage({release:staged});};
 registration.installing=worker;registration.fire('updatefound');registration.waiting=worker;worker.fire('statechange');
 for(let attempt=0;action.hidden&&attempt<25;attempt++)await new Promise(resolve=>setTimeout(resolve,4));
 assert.equal(action.hidden,false);assert.deepEqual(visits,[]);
 await button.fire('click');assert.equal(checks,1);assert.equal(status.textContent,'保存失敗');assert.deepEqual(visits,[]);
 state={ok:true};await button.fire('click');assert.deepEqual(visits,[scope+'?sengoku-version='+staged]);
 await api.fire('controllerchange');assert.equal(visits.length,1);
}

async function workerTest(){
 const events={},old='sengoku-taisen-v'+edition,next='sengoku-taisen-v'+staged;
 const rows=new Map([[old,new Map([[url('index.html'),'OLD DOC'],[url('same.bundle.js?v=oldhash'),'OLD CODE']])],[next,new Map([[url('index.html'),'NEW DOC'],[url('same.bundle.js?v=newhash'),'NEW CODE']])]]);
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

(async()=>{await bootTest();await workerTest();await saveTest();console.log('PASS waiting-only update action, confirmed save and cloud sync, chosen-tab staged offline load and older-tab continuity, including worker restart.');})().catch(error=>{console.error(error);process.exitCode=1;});
