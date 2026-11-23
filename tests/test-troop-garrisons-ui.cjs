'use strict';
const assert=require('node:assert/strict'),{createController,createUI,cleanSnapshot,cleanResult,transferPreview,pageMarkup}=require('../troop-garrisons.js'),stable=require('../stable-dom.js'),{setup:domSetup}=require('./helpers/dom-model.cjs');
const tests=[],test=(name,run)=>tests.push([name,run]),copy=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<14;i++)await Promise.resolve();};
function fixture({storage,context,onChange}={}){
 const records=new Map(),receipts=new Map(),calls=[];
 let ctx=context||{playerId:'u_test_owner',user:{id:'u_test_owner'},epoch:1,accountEpoch:1,privilegeEpoch:1,campaignId:'campaign_test',readable:true,writable:true,reason:'別の端末で操作中です。'},serial=0,handler=null;
 const data={campaignId:'campaign_test',commandCost:1,command:{current:3,max:3},army:{troops:3000,capacity:100000000,recruitmentCapacity:4000,transportCapacity:100000000,recallCapacity:99997000},garrisons:[{castleId:'nijo',castleName:'二条城',majorCity:true,troops:100,canSend:true,sendReason:'',maxSend:3000,maxRecall:100}],availableCastles:[{castleId:'nijo',castleName:'二条城',majorCity:true,stationedTroops:100,maxSend:3000},{castleId:'sunpu',castleName:'駿府城',majorCity:false,stationedTroops:0,maxSend:3000}]};
 const saved=storage||{getItem:k=>records.get(k)??null,setItem:(k,v)=>records.set(k,v),removeItem:k=>records.delete(k)};
 function limits(){data.army.recallCapacity=Math.max(0,data.army.transportCapacity-data.army.troops);for(const row of data.garrisons){row.maxSend=row.canSend?data.army.troops:0;row.maxRecall=Math.min(row.troops,data.army.recallCapacity);}for(const row of data.availableCastles){row.maxSend=data.army.troops;row.stationedTroops=data.garrisons.find(item=>item.castleId===row.castleId)?.troops||0;}}
 async function base(route,settings){
  limits();if(settings.method==='GET')return{ok:true,...copy(data)};
  const old=receipts.get(settings.data.requestId);if(old)return{ok:true,idempotent:true,result:copy(old),...copy(data)};
  const action=route.split('/').at(-1),d=settings.data,station=data.garrisons.find(row=>row.castleId===d.castleId),castle=data.availableCastles.find(row=>row.castleId===d.castleId)||station;
  if(!castle||action==='send'&&!data.availableCastles.some(row=>row.castleId===d.castleId))throw Object.assign(Error('この城には領主がいるため派遣できません。'),{status:409});
  const troops=d.troops,armyBefore=data.army.troops,garrisonBefore=station?.troops||0;
  if(data.command.current<1||troops>(action==='send'?data.army.troops:Math.min(garrisonBefore,data.army.recallCapacity)))throw Object.assign(Error('人数または指令を確認してください。'),{status:409});
  data.army.troops+=action==='send'?-troops:troops;data.command.current--;const total=garrisonBefore+(action==='send'?troops:-troops);
  if(station)station.troops=total;else data.garrisons.push({castleId:d.castleId,castleName:castle.castleName,majorCity:castle.majorCity,troops:total,canSend:true,sendReason:'',maxSend:0,maxRecall:0});data.garrisons=data.garrisons.filter(row=>row.troops>0);limits();
  const result={requestId:d.requestId,action,castleId:d.castleId,castleName:castle.castleName,troops,armyBefore,armyAfter:data.army.troops,garrisonBefore,garrisonAfter:total,commandCost:1,message:action==='send'?'兵を派遣しました。':'兵が本隊に戻りました。'};receipts.set(d.requestId,copy(result));return{ok:true,result,...copy(data)};
 }
 const request=(route,settings)=>{calls.push({route,settings:copy(settings)});return handler?handler(route,settings,base):base(route,settings);};
 const options={request,getContext:()=>ctx,storage:saved,uuid:()=>`request_${++serial}`,onChange};
 const controller=createController(options);
 return{controller,options,data,calls,receipts,storage:saved,records,limits,posts:()=>calls.filter(call=>call.settings.method==='POST'),setContext:value=>{ctx=value;},getContext:()=>ctx,setHandler:value=>{handler=value;}};
}

test('server lists and maxima are bounded, and send plus partial recall use exact conserved counts',async()=>{
 const h=fixture();await h.controller.open();assert.equal(h.posts().length,0);h.controller.setDestination('sunpu');h.controller.setAmount('250');const q=h.controller.preview('send');assert(q.ok);assert.equal(q.armyAfter,2750);assert.equal(q.garrisonAfter,250);assert(await h.controller.send());assert.equal(h.data.command.current,2);assert.equal(h.controller.getState().result.troops,250);
 h.controller.setAmount('100','sunpu');assert(await h.controller.recall('sunpu'));assert.equal(h.data.army.troops,2850);assert.equal(h.data.garrisons.find(row=>row.castleId==='sunpu').troops,150);assert.equal(h.data.command.current,1);assert.deepEqual(Object.keys(h.posts()[0].settings.data).sort(),['campaignId','castleId','requestId','troops']);
 const invalid=copy(h.data);invalid.availableCastles[0].maxSend=invalid.army.troops+1;assert.equal(cleanSnapshot(invalid),null);invalid.availableCastles[0].maxSend=0;invalid.garrisons[0].maxRecall=invalid.garrisons[0].troops+1;assert.equal(cleanSnapshot(invalid),null);const legacy=copy(h.data);delete legacy.army.transportCapacity;delete legacy.army.recruitmentCapacity;legacy.army.capacity=4000;legacy.army.recallCapacity=4000-legacy.army.troops;assert.equal(cleanSnapshot(legacy).army.transportCapacity,4000);const inflated=copy(h.data);inflated.army.recallCapacity++;assert.equal(cleanSnapshot(inflated),null);h.controller.dispose();
});
test('guests, read-only sessions, invalid integers, no commands and the full total stock limit do not write',async()=>{
 const guest=fixture({context:{playerId:'',user:null,readable:false,writable:false,reason:'領主を接続してください。'}});await guest.controller.open();assert.equal(guest.calls.length,0);assert.equal(await guest.controller.send(),false);guest.controller.dispose();
 const h=fixture();await h.controller.open();h.controller.setDestination('sunpu');for(const raw of ['','0','-1','1.5','2e2','9007199254740992','3001']){h.controller.setAmount(raw);assert.equal(await h.controller.send(),false);}assert.equal(h.posts().length,0);
 h.controller.setAmount('200');h.setContext({...h.getContext(),writable:false});assert.equal(await h.controller.send(),false);assert.match(h.controller.getState().error,/別の端末/);h.setContext({...h.getContext(),writable:true});h.data.command.current=0;await h.controller.refresh();assert.equal(await h.controller.send(),false);
 h.data.command.current=3;h.data.army.troops=h.data.army.transportCapacity;await h.controller.refresh();h.controller.setAmount('1','nijo');assert.equal(await h.controller.recall('nijo'),false);assert.match(h.controller.preview('recall','nijo').message,/保有上限に空き/);assert.equal(h.posts().length,0);h.controller.dispose();
});
test('garrison recalls bypass a full normal base and preserve stock above one million',async()=>{
 const h=fixture();h.data.army.troops=h.data.army.recruitmentCapacity;await h.controller.open();assert(h.controller.getState().data.army.recallCapacity>h.data.army.recruitmentCapacity);h.controller.setAmount('40','nijo');assert(h.controller.preview('recall','nijo').ok);assert(await h.controller.recall('nijo'));assert.equal(h.data.army.troops,4040);assert.equal(h.data.garrisons[0].troops,60);assert.match(pageMarkup(h.controller.getState()),/拠点の空き容量に関係なく/);
 h.data.army.troops=1200000;await h.controller.refresh();h.controller.setAmount('30','nijo');assert(await h.controller.recall('nijo'));assert.equal(h.data.army.troops,1200030);assert.equal(h.data.garrisons[0].troops,30);assert.equal(h.controller.getState().result.armyAfter,1200030);h.controller.dispose();
});
test('only the remaining transport ceiling limits a partial recall and keeps all unreturned soldiers',async()=>{
 const h=fixture();h.data.army.transportCapacity=99999000;h.data.army.troops=99998999;await h.controller.open();h.controller.setAmount('2','nijo');assert.equal(h.controller.preview('recall','nijo').maxTroops,1);assert.equal(await h.controller.recall('nijo'),false);assert.equal(h.posts().length,0);assert.equal(h.data.garrisons[0].troops,100);
 h.controller.maximum('recall','nijo');assert(await h.controller.recall('nijo'));assert.equal(h.data.army.troops,99999000);assert.equal(h.data.garrisons[0].troops,99);assert.equal(h.data.command.current,2);h.controller.setAmount('1','nijo');assert.equal(await h.controller.recall('nijo'),false);assert.match(h.controller.preview('recall','nijo').message,/出陣中の兵を含めた保有上限/);assert.equal(h.data.garrisons[0].troops,99);h.controller.dispose();
});
test('a destination that becomes occupied remains selected but unavailable; own recall still works',async()=>{
 const h=fixture();await h.controller.open();h.controller.setDestination('nijo');h.controller.setAmount('20');h.data.availableCastles=h.data.availableCastles.filter(row=>row.castleId!=='nijo');h.data.garrisons[0].canSend=false;h.data.garrisons[0].sendReason='現在は領主がいるため追加派遣できません。';await h.controller.refresh();
 assert.equal(h.controller.getState().castleId,'nijo');assert.equal(h.controller.preview('send').ok,false);assert.match(pageMarkup(h.controller.getState()),/選択していた城へは現在派遣できません/);assert.equal(await h.controller.send(),false);h.controller.setAmount('30','nijo');assert(await h.controller.recall('nijo'));assert.equal(h.data.garrisons[0].troops,70);h.controller.dispose();
});
test('an uncertain committed result survives reload and retries the same request without double spending',async()=>{
 const h=fixture();await h.controller.open();h.controller.setDestination('sunpu');h.controller.setAmount('240');let lost=false;h.setHandler(async(route,settings,base)=>{const result=await base(route,settings);if(settings.method==='POST'&&!lost){lost=true;throw TypeError('返信を受信できませんでした。');}return result;});
 assert.equal(await h.controller.send(),false);assert(h.controller.getState().pending);const requestId=h.posts()[0].settings.data.requestId;assert.equal(h.data.army.troops,2760);h.controller.dispose();
 const next=createController(h.options);await next.open();assert.equal(h.posts().length,1,'Opening never automatically replays an operation');assert(next.getState().pending);assert(await next.retry());assert.equal(h.posts()[1].settings.data.requestId,requestId);assert.equal(h.data.command.current,2);assert.equal(h.receipts.size,1);assert.equal(next.getState().pending,null);next.dispose();
});
test('double clicks and a closed view cannot duplicate an in-flight dispatch',async()=>{
 const h=fixture(),wait=deferred();await h.controller.open();h.controller.setDestination('sunpu');h.controller.setAmount('120');h.setHandler(async(route,settings,base)=>{if(settings.method==='POST'){await wait.promise;}return base(route,settings);});
 const first=h.controller.send();await drain();assert.equal(await h.controller.send(),false);assert.equal(h.controller.setAmount('200'),false);h.controller.close();wait.resolve();assert(await first);assert.equal(h.posts().length,1);assert.equal(h.controller.getState().open,false);assert.equal(h.data.army.troops,2880);h.controller.dispose();
});
test('malformed receipts remain pending; confirmed rejections clear pending; storage failure sends nothing',async()=>{
 const h=fixture();await h.controller.open();h.controller.setDestination('sunpu');h.controller.setAmount('10');h.setHandler(async(route,settings,base)=>{const result=await base(route,settings);if(settings.method==='POST')result.result.armyAfter++;return result;});assert.equal(await h.controller.send(),false);assert(h.controller.getState().pending);h.setHandler(null);assert(await h.controller.retry());h.controller.dispose();
 const rejected=fixture();await rejected.controller.open();rejected.controller.setDestination('sunpu');rejected.controller.setAmount('10');rejected.setHandler(async(route,settings,base)=>{if(settings.method==='POST')throw Object.assign(Error('空城ではありません。'),{status:409});return base(route,settings);});assert.equal(await rejected.controller.send(),false);assert.equal(rejected.controller.getState().pending,null);rejected.controller.dispose();
 const blocked=fixture({storage:{getItem:()=>null,setItem:()=>{throw Error('保存できません。');}}});await blocked.controller.open();blocked.controller.setDestination('sunpu');blocked.controller.setAmount('10');assert.equal(await blocked.controller.send(),false);assert.equal(blocked.posts().length,0);blocked.controller.dispose();
});
test('account and privilege changes discard late personal displays and retain the old owner receipt record',async()=>{
 const h=fixture(),wait=deferred();await h.controller.open();h.controller.setDestination('sunpu');h.controller.setAmount('90');h.setHandler(async(route,settings,base)=>{if(settings.method==='POST'){const result=await base(route,settings);await wait.promise;return result;}return base(route,settings);});
 const pending=h.controller.send();await drain();h.setContext({...h.getContext(),playerId:'u_other',user:{id:'u_other'},accountEpoch:2});h.controller.getState();wait.resolve();assert.equal(await pending,false);const state=h.controller.getState();assert.equal(state.ownerId,'u_other');assert.equal(state.data,null);assert.equal(state.result,null);assert.equal(state.pending,null);assert(h.storage.getItem('sengoku-troop-garrison-ui-pending-v1:u_test_owner'));h.controller.dispose();
});
test('an immediate identity change stops the queued write, while a retryable sync rejection keeps its exact request',async()=>{
 const changed=fixture();await changed.controller.open();changed.controller.setDestination('sunpu');changed.controller.setAmount('40');const queued=changed.controller.send();changed.setContext({...changed.getContext(),playerId:'u_other',user:{id:'u_other'},accountEpoch:2});assert.equal(await queued,false);assert.equal(changed.posts().length,0);assert(changed.storage.getItem('sengoku-troop-garrison-ui-pending-v1:u_test_owner'));changed.controller.dispose();
 const h=fixture();await h.controller.open();h.controller.setDestination('sunpu');h.controller.setAmount('40');h.setHandler((route,settings,base)=>{if(settings.method==='POST')throw Object.assign(Error('操作端末を再確認しています。'),{status:409,retryable:true});return base(route,settings);});assert.equal(await h.controller.send(),false);const requestId=h.controller.getState().pending.data.requestId;assert.equal(h.controller.getState().sending,false);h.setHandler(null);assert(await h.controller.retry());assert.equal(h.posts()[1].settings.data.requestId,requestId);assert.equal(h.data.army.troops,2960);assert.equal(h.data.command.current,2);h.controller.dispose();
});
test('real dialog rendering retains the focused count and scroll during status updates',async()=>{
 const dom=domSetup(),create=dom.doc.createElement.bind(dom.doc);dom.doc.createElement=name=>{const node=create(name);if(name==='dialog'){node.showModal=()=>{node.open=true;};node.close=()=>{node.open=false;node.dispatchEvent({type:'close',bubbles:false});};}return node;};
 const h=fixture(),previous=global.SengokuStableDOM;global.SengokuStableDOM=stable;const ui=createUI({...h.options,document:dom.doc,autoPoll:false,setTimeout:()=>1,clearTimeout:()=>{}});
 try{await ui.open();ui.controller.setDestination('sunpu');ui.controller.setAmount('125');const input=dom.doc.querySelector('#troop-garrison-send-amount'),body=dom.doc.querySelector('[data-garrison-body]');input.focus();body.scrollTop=300;await ui.controller.refresh();assert.strictEqual(dom.doc.querySelector('#troop-garrison-send-amount'),input);assert.strictEqual(dom.doc.activeElement,input);assert.equal(input.value,'125');assert.equal(body.scrollTop,300);assert(dom.doc.querySelector('[data-garrison-form="recall"]'));}
 finally{ui.dispose();h.controller.dispose();global.SengokuStableDOM=previous;}
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' vacant-castle garrison UI checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
