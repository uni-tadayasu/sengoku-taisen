const assert=require('node:assert/strict');
const {createController,scrollAfterUpdate,mergeMessages,textLength,escape}=require('../letters.js');
const THREAD='lt_'+'1'.repeat(32),OTHER='lt_'+'2'.repeat(32);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
const drain=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const error=(message,status,code)=>Object.assign(Error(message),{status,code});
const tests=[];function test(name,run){tests.push({name,run});}
function setup({storage,server}={}){
  const values=storage||new Map(),calls=[],changes=[],timers=new Map();let serial=0,timerId=0,handler=null,visible=true,user={id:'u_me',name:'自分',guildId:null};
  const data=server||{target:{id:'u_target',name:'本拠の相手',clan:'伊達家',guildId:'g_old',guildName:'旧ギルド'},thread:{id:THREAD,kind:'player',title:'本拠の相手',peer:{id:'u_target',name:'本拠の相手'},unreadCount:2,lastSeq:2,updatedAt:'2026-11-21T00:00:00Z',canReply:true},messages:[1,2].map(seq=>({id:'m_'+seq,seq,threadId:THREAD,authorId:'u_target',authorName:'本拠の相手',text:'既存の書状'+seq,createdAt:'2026-11-21T00:00:00Z'})),receipts:new Map(),read:0};
  const base=async(route,options={})=>{
    const method=options.method||'GET',url=new URL(route,'https://local.invalid');
    if(url.pathname==='/letters/recipient')return{ok:true,player:{...data.target,id:url.searchParams.get('playerId')}};
    if(url.pathname==='/letters/summary')return{ok:true,unreadCount:Math.max(0,data.messages.filter(m=>m.seq>data.read&&m.authorId!==user.id).length),unreadThreads:1};
    if(url.pathname==='/letters'&&method==='GET')return{ok:true,threads:[{...data.thread,lastMessage:data.messages.at(-1)}],unreadCount:data.messages.filter(m=>m.seq>data.read&&m.authorId!==user.id).length,unreadThreads:1,nextCursor:null};
    if(method==='GET'&&url.pathname.startsWith('/letters/lt_')){
      let messages=data.messages.slice(),limit=Number(url.searchParams.get('limit')||40),hasOlder=false,hasNewer=false,nextBefore=null,nextAfter=null;
      if(url.searchParams.has('after')){messages=messages.filter(m=>m.seq>Number(url.searchParams.get('after')));hasNewer=messages.length>limit;messages=messages.slice(0,limit);nextAfter=hasNewer?messages.at(-1).seq:null;}
      else{if(url.searchParams.has('before'))messages=messages.filter(m=>m.seq<Number(url.searchParams.get('before')));hasOlder=messages.length>limit;messages=messages.slice(-limit);nextBefore=hasOlder?messages[0].seq:null;}
      return{ok:true,thread:{...data.thread},messages:structuredClone(messages),hasOlder,hasNewer,nextBefore,nextAfter,readCursor:messages.at(-1)?.seq||0};
    }
    if(url.pathname.endsWith('/read')){data.read=Math.max(data.read,Math.min(options.data.through,data.thread.lastSeq));return{ok:true,through:data.read,unreadCount:data.messages.filter(m=>m.seq>data.read&&m.authorId!==user.id).length,unreadThreads:0};}
    if(method==='POST'&&(url.pathname==='/letters'||url.pathname.endsWith('/messages'))){
      const id=options.data.requestId,prior=data.receipts.get(id);if(prior)return{...structuredClone(prior),idempotent:true};
      const seq=(data.messages.at(-1)?.seq||0)+1,message={id:'m_'+seq,seq,threadId:THREAD,authorId:user.id,authorName:user.name,text:options.data.text,createdAt:'2026-11-21T00:00:00Z'};data.messages.push(message);data.thread={...data.thread,lastSeq:seq};const result={ok:true,thread:{...data.thread},message:{...message},idempotent:false};data.receipts.set(id,structuredClone(result));return result;
    }
    throw Error('Unexpected local route '+route);
  };
  const options={getUser:()=>user,storage:{getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)},now:()=>1795219200000,uuid:()=>`request_${++serial}`,isVisible:()=>visible,setTimeout:(fn,ms)=>{timers.set(++timerId,{fn,ms});return timerId;},clearTimeout:id=>timers.delete(id),request:async(route,value)=>{calls.push({route,options:structuredClone(value||{})});return handler?handler(route,value||{},base):base(route,value||{});},onChange:s=>changes.push(s)};
  const controller=createController(options);
  return{controller,calls,changes,data,storage:values,options,base,setHandler:fn=>handler=fn,setUser:value=>user=value,setVisible:value=>visible=value,posts:()=>calls.filter(x=>x.options.method==='POST'&&!x.route.endsWith('/read'))};
}

test('body limits count Unicode code points and output escaping preserves text only',async()=>{
  assert.equal(textLength(' 🦉'.trim().repeat(1000)),1000);assert.equal(textLength('  か\u3099  '),1);assert.equal(escape('<img onerror="x"> & \'hi\''),'&lt;img onerror=&quot;x&quot;&gt; &amp; &#39;hi&#39;');
  const h=setup();await h.controller.openCompose({playerId:'u_target'});h.controller.setDraft('🦉'.repeat(1001));assert.equal(await h.controller.send(),false);assert.equal(h.posts().length,0);h.controller.dispose();
});

test('double-click shares one in-flight request and response loss resumes the identical saved request',async()=>{
  const h=setup(),wait=deferred();await h.controller.openCompose({playerId:'u_target',destination:'guild'});h.controller.setDraft('ギルドへ一度だけ');let committed;
  h.setHandler(async(route,options,base)=>{if(options.method==='POST'&&route==='/letters'){committed=await base(route,options);return wait.promise;}return base(route,options);});
  const one=h.controller.send(),two=h.controller.send();assert.equal(one,two);await drain();assert.equal(h.posts().length,1);wait.reject(Error('local response loss'));assert.equal(await one,false);const pending=h.controller.getState().pending;assert(pending);assert.equal(h.data.receipts.size,1);assert.equal(pending.data.guildId,'g_old');h.controller.dispose();
  const restored=setup({storage:h.storage,server:h.data});await restored.controller.openCompose({playerId:'u_target',destination:'guild'});assert.equal(restored.controller.getState().draft,'ギルドへ一度だけ');restored.controller.setDraft('送信確認中に書いた次の下書き');assert.equal(await restored.controller.retry(),true);
  assert.deepEqual(restored.posts()[0].options.data,pending.data);assert.equal(restored.data.receipts.size,1);assert.equal(restored.controller.getState().pending,null);assert.equal(restored.controller.getState().draft,'送信確認中に書いた次の下書き');assert.equal(restored.controller.getState().view,'compose');restored.controller.dispose();
});

test('typing during delivery is retained while a successful unchanged draft opens its conversation',async()=>{
  const h=setup(),wait=deferred();await h.controller.openCompose({playerId:'u_target'});h.controller.setDraft('先の本文');h.setHandler(async(route,options,base)=>{const result=await base(route,options);return options.method==='POST'&&route==='/letters'?wait.promise.then(()=>result):result;});
  const sending=h.controller.send();await drain();h.controller.setDraft('後から書いた本文');wait.resolve();await sending;assert.equal(h.controller.getState().draft,'後から書いた本文');assert.equal(h.controller.getState().view,'compose');
  h.setHandler(null);await h.controller.send();assert.equal(h.controller.getState().view,'thread');assert.equal(h.controller.getState().draft,'');assert.equal(h.controller.getState().messages.at(-1).text,'後から書いた本文');h.controller.dispose();
});

test('a stale guild refuses delivery, retains the draft and requires an explicit new destination',async()=>{
  const h=setup();await h.controller.openCompose({playerId:'u_target',destination:'guild'});h.controller.setDraft('宛先を確認してから');let first=true;
  h.setHandler(async(route,options,base)=>{if(first&&route==='/letters'&&options.method==='POST'){first=false;h.data.target.guildId='g_new';h.data.target.guildName='新ギルド';throw error('所属変更',409,'LETTER_TARGET_CHANGED');}return base(route,options);});
  await h.controller.send();let state=h.controller.getState();assert.equal(state.pending,null);assert.equal(state.needsTargetConfirm,true);assert.equal(state.guildId,null);assert.equal(state.target.guildId,'g_new');assert.equal(state.draft,'宛先を確認してから');
  assert.equal(await h.controller.send(),false);assert.equal(h.posts().length,1);h.controller.setDestination('guild');assert.equal(h.controller.getState().guildId,'g_new');await h.controller.send();assert.equal(h.posts().length,2);assert.equal(h.posts()[1].options.data.guildId,'g_new');assert.notEqual(h.posts()[0].options.data.requestId,h.posts()[1].options.data.requestId);h.controller.dispose();
});

test('thread polling keeps the route and draft, and replies do not skip an unseen incoming message',async()=>{
  const h=setup();await h.controller.openThread(THREAD);h.controller.setDraft('返信の途中');h.data.messages.push({id:'m_3',seq:3,threadId:THREAD,authorId:'u_target',authorName:'相手',text:'未取得の返信',createdAt:'2026-11-21T00:00:00Z'});h.data.thread.lastSeq=3;
  await h.controller.refresh();assert.equal(h.controller.getState().view,'thread');assert.equal(h.controller.getState().draft,'返信の途中');assert.deepEqual(h.controller.getState().messages.map(x=>x.seq),[1,2,3]);
  h.data.messages.push({id:'m_4',seq:4,threadId:THREAD,authorId:'u_target',authorName:'相手',text:'送信前に来た書状',createdAt:'2026-11-21T00:00:00Z'});h.data.thread.lastSeq=4;
  await h.controller.send();assert.deepEqual(h.controller.getState().messages.map(x=>x.seq),[1,2,3,4,5]);assert.equal(h.controller.getState().messages[3].text,'送信前に来た書状');assert(h.calls.some(x=>x.route.includes('after=3')));h.controller.dispose();
});

test('old pages merge without duplicates and reading position remains stable on prepend or polling',async()=>{
  const h=setup();h.data.messages=Array.from({length:90},(_,index)=>({id:'m_'+(index+1),seq:index+1,threadId:THREAD,authorId:'u_target',authorName:'相手',text:'長い履歴'+(index+1),createdAt:'2026-11-21T00:00:00Z'}));h.data.thread.lastSeq=90;
  await h.controller.openThread(THREAD);assert.equal(h.controller.getState().messages.length,40);h.controller.setDraft('履歴を読んでから返信');await h.controller.loadOlder();assert.equal(h.controller.getState().messages.length,80);await h.controller.loadOlder();assert.equal(h.controller.getState().messages.length,90);assert.equal(h.controller.getState().hasOlder,false);assert.equal(h.controller.getState().draft,'履歴を読んでから返信');
  assert.equal(scrollAfterUpdate({top:120,height:1000,clientHeight:400,nextHeight:1300}),120,'new arrivals must not move an older reading position');
  assert.equal(scrollAfterUpdate({top:600,height:1000,clientHeight:400,nextHeight:1300}),900,'a reader at the bottom follows the new arrival');
  assert.equal(scrollAfterUpdate({top:20,height:1000,clientHeight:400,nextHeight:1800,prepend:true}),820,'prepending history retains the same visible message');
  assert.deepEqual(mergeMessages([{seq:2,text:'old'},{seq:4}],[{seq:1},{seq:2,text:'updated'}]).map(x=>x.seq),[1,2,4]);h.controller.dispose();
});

test('read acknowledgements only cover visible opened conversations and coalesce while in flight',async()=>{
  const h=setup();await h.controller.openThread(THREAD);h.setVisible(false);await h.controller.markRead();assert(!h.calls.some(x=>x.route.endsWith('/read')));h.setVisible(true);
  const wait=deferred();let first=true;h.setHandler(async(route,options,base)=>{if(route.endsWith('/read')&&first){first=false;return wait.promise;}return base(route,options);});
  const reading=h.controller.markRead();await drain();assert.equal(h.calls.filter(x=>x.route.endsWith('/read')).length,1);
  h.data.messages.push({id:'m_3',seq:3,threadId:THREAD,authorId:'u_target',authorName:'相手',text:'追加',createdAt:'2026-11-21T00:00:00Z'});h.data.thread.lastSeq=3;await h.controller.refresh();await h.controller.markRead();assert.equal(h.calls.filter(x=>x.route.endsWith('/read')).length,1);
  wait.resolve({through:2,unreadCount:1,unreadThreads:1});await reading;await drain();assert.deepEqual(h.calls.filter(x=>x.route.endsWith('/read')).map(x=>x.options.data.through),[2,3]);await h.controller.markRead();assert.equal(h.calls.filter(x=>x.route.endsWith('/read')).length,2);h.controller.close();await h.controller.markRead();assert.equal(h.calls.filter(x=>x.route.endsWith('/read')).length,2);h.controller.dispose();
});

test('membership changes discard private rendered data and ignore a late old-membership response',async()=>{
  const h=setup();h.setUser({id:'u_me',name:'自分',guildId:'g_old'});h.data.thread={...h.data.thread,kind:'guild',guild:{id:'g_old',name:'旧ギルド'},sender:{id:'u_external',name:'外部'}};await h.controller.openThread(THREAD);
  const wait=deferred();h.setHandler(async(route,options,base)=>route.includes('after=')?wait.promise:base(route,options));const refresh=h.controller.refresh();await drain();h.setUser({id:'u_me',name:'自分',guildId:'g_new'});h.controller.refreshIdentity();await drain();assert.equal(h.controller.getState().view,'inbox');assert.equal(h.controller.getState().messages.length,0);
  wait.resolve({thread:{...h.data.thread},messages:[{id:'secret',seq:999,text:'失効した権限の内容'}]});await refresh;assert(!JSON.stringify(h.controller.getState().messages).includes('失効した権限の内容'));assert.equal(h.controller.getState().view,'inbox');h.controller.dispose();
});

test('authoritative 404 on refresh removes a revoked thread rather than retaining its cached messages',async()=>{
  const h=setup();await h.controller.openThread(THREAD);assert.equal(h.controller.getState().messages.length,2);h.setHandler(async(route,options,base)=>{if(route.includes('after='))throw error('閲覧権限がありません',404,'LETTER_NOT_FOUND');return base(route,options);});await h.controller.refresh();const state=h.controller.getState();assert.equal(state.view,'inbox');assert.equal(state.messages.length,0);assert.equal(state.thread,null);assert.equal(state.threads.length,0);h.controller.dispose();
});

test('late send results cannot enter a different account and pending records stay with their owner',async()=>{
  const h=setup(),wait=deferred();await h.controller.openCompose({playerId:'u_target'});h.controller.setDraft('元の領主の下書き');let result;
  h.setHandler(async(route,options,base)=>{const response=await base(route,options);if(options.method==='POST'&&route==='/letters'){result=response;return wait.promise;}return response;});const sending=h.controller.send();await drain();
  h.setUser({id:'u_other',name:'別の領主',guildId:null});h.controller.refreshIdentity();await drain();assert.equal(h.controller.getState().pending,null);wait.resolve(result);await sending;assert.equal(h.controller.getState().ownerId,'u_other');assert.equal(h.controller.getState().thread,null);assert.equal(h.controller.getState().draft,'');assert.equal(h.posts().length,1);
  h.setHandler(null);h.setUser({id:'u_me',name:'自分',guildId:null});h.controller.refreshIdentity();await drain();assert(h.controller.getState().pending);await h.controller.retry();assert.equal(h.data.receipts.size,1);assert.equal(h.controller.getState().pending,null);h.controller.dispose();
});

test('missing durable storage prevents unsafe sends and forged persisted routes are ignored',async()=>{
  const h=setup();h.options.storage.setItem=()=>{throw Error('storage blocked');};const controller=createController(h.options);await controller.openCompose({playerId:'u_target'});controller.setDraft('保存できない本文');assert.equal(await controller.send(),false);assert.equal(h.posts().length,0);assert(controller.getState().error.includes('送信番号'));controller.dispose();h.controller.dispose();
  const store=new Map([['sengoku-letters-v1:u_me:pending',JSON.stringify({ownerId:'u_me',route:'/admin/staff',data:{requestId:'bad',text:'forged'},draftKey:'x',originalDraft:'forged'})]]),fresh=setup({storage:store});await fresh.controller.openInbox();assert.equal(fresh.controller.getState().pending,null);assert.equal(await fresh.controller.retry(),false);assert.equal(fresh.posts().length,0);fresh.controller.dispose();
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} local controller, continuity and retry checks passed. No network requests were made.`);})().catch(error=>{console.error(error);process.exitCode=1;});
