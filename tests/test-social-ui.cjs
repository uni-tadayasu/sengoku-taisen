(async function(){
 const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto');
 const storage=new Map(),requests=[],TOKEN='a'.repeat(64);let handler=async()=>({ok:true}),canReceive=true,bridgeSuccess=false,bridgeCalls=0;
 const context={console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:crypto.webcrypto,document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:async(url,options)=>{requests.push({url,options});const payload=await handler(url,options);return{ok:true,status:200,json:async()=>payload};},SENGOKU_API_BASE:'https://api.example.invalid',SengokuBridge:{canReceiveGifts:()=>canReceive,applyGift:()=>{bridgeCalls++;return bridgeSuccess?{ok:true}:{ok:false,retryable:true,message:'Local test save blocked'};},toast(){}}};
 context.window=context;vm.createContext(context);
 const filename=require('node:path').join(__dirname,'../social.js');
 let source=fs.readFileSync(filename,'utf8');
 source=source.replace('global.SengokuSocial={open','global.__socialTest={s,api,loadChat,claimGift,clearPrivate,setEpoch:v=>{authEpoch=v;}};global.SengokuSocial={open');
 vm.runInContext(source,context);const t=context.__socialTest;t.s.identity={id:'u_a',token:TOKEN};t.s.user={id:'u_a',name:'検証',isAdmin:false,guildId:null};t.s.tab='world';
 handler=async()=>({ok:true,messages:[],nextAfter:0});await t.loadChat();
 assert(!new URL(requests.at(-1).url).searchParams.has('after'));
 assert.equal(requests.at(-1).options.headers.Authorization,'Bearer '+TOKEN);assert(!requests.at(-1).url.includes(TOKEN));
 let resolve;handler=()=>new Promise(r=>{resolve=r;});
 const stale=t.api('/me');t.setEpoch(1);resolve({ok:true,user:{id:'u_old'}});await assert.rejects(stale,e=>e.code==='STALE_IDENTITY');
 let explicitResolve;handler=()=>new Promise(r=>{explicitResolve=r;});
 const imported=t.api('/me',{token:'b'.repeat(64)});t.setEpoch(2);explicitResolve({ok:true,user:{id:'u_import'}});assert.equal((await imported).user.id,'u_import');
 t.s.mail=[{id:'m1',gift:{gold:10,rice:0,wood:0,stone:0},claimed:false}];
 canReceive=false;const before=requests.length;await assert.rejects(t.claimGift('m1'));assert.equal(requests.length,before);
 canReceive=true;const ids=[];
 handler=async(url,options)=>{if(url.endsWith('/mail/claim')){const data=JSON.parse(options.body);ids.push(data.requestId);assert(storage.get('sengoku-mail-claims-v1').includes(data.requestId));return{ok:true,gift:{gold:10,rice:0,wood:0,stone:0},receiptId:'receipt1'};}if(url.endsWith('/mail'))return{ok:true,mail:[{id:'m1',gift:{gold:10,rice:0,wood:0,stone:0},claimed:true}]};return{ok:true};};
 await assert.rejects(t.claimGift('m1'),/Local test save blocked/);assert(t.s.pending['u_a:m1']);assert.equal(bridgeCalls,1);
 bridgeSuccess=true;await t.claimGift('m1');assert.equal(ids[0],ids[1]);assert.equal(bridgeCalls,2);assert.equal(t.s.pending['u_a:m1'],undefined);
 t.s.mail=[{body:'private'}];t.s.members=[{name:'private'}];t.s.players=[{name:'private'}];t.clearPrivate();assert.equal(t.s.mail.length,0);assert.equal(t.s.members.length,0);assert.equal(t.s.players.length,0);
 assert(source.includes('maxlength="300" rows="5"'));assert(source.includes('maxlength="60"'));assert(source.includes('maxlength="2000"'));assert(source.includes('max="1000000"'));
 console.log('Social local tests passed: latest-chat cursor, Bearer-only auth, stale auth rejection, explicit import auth, pre-claim save gate, durable retry ID across local failure, private-cache cleanup, server content limits. No network requests were made.');
})().catch(e=>{console.error(e);process.exitCode=1;});

