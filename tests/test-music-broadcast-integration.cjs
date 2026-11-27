'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {pathToFileURL}=require('node:url');
const clone=value=>JSON.parse(JSON.stringify(value));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const root=path.resolve(__dirname,'..');

async function run(){
  const {harness}=await import(pathToFileURL(path.join(root,'server/test-support.mjs')));
  const {fixture}=await import(pathToFileURL(path.join(root,'tests/helpers/music-fixture.mjs')));
  const h=harness();h.now=Date.UTC(2026,10,27,6);
  const musicFixture=fixture({recordings:true,media:true,now:h.now,decodeDuration:202.12});
  const player=new musicFixture.Music({volume:23});player.setAuto(false);await player.play('battle-storm');
  const calls=[],errors=[],timers=new Map();let timerId=0,hold=null;
  const document=musicFixture.document;document.readyState='loading';
  const context={URL,URLSearchParams,AbortController,crypto,console,document,localStorage:{getItem(){return null;}},SENGOKU_API_BASE:'https://api.example.invalid',music:player,musicBroadcastState:null,musicBroadcastNow:null,musicBroadcastReceivedAt:0,refreshMusicPlayback(){},musicPlaybackFailed:error=>errors.push(error),setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)};
  context.window=context;
  context.fetch=async(url,options)=>{
    const route=new URL(url).pathname.replace('/api/v1','');calls.push({route,options:clone({...options,signal:undefined})});
    const reply=await h.api(route,{method:options.method,token:options.headers.Authorization?.replace(/^Bearer /,''),body:options.body?JSON.parse(options.body):undefined,expected:null});
    if(hold&&route==='/music'){const wait=hold;hold=null;await wait.promise;}
    return {ok:reply.response.ok,status:reply.response.status,json:async()=>clone(reply.data)};
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root,'music-broadcast.js'),'utf8'),context);
  const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),begin=app.indexOf('  function applyMusicBroadcast('),end=app.indexOf('  function ensureAudio(',begin);
  assert(begin>=0&&end>begin,'real app bridge must be present');vm.runInContext(app.slice(begin,end),context);
  context.SengokuBridge={applyMusicBroadcast:context.applyMusicBroadcast,setRoleAccess(){},setSyncAccess(){}};
  let social=fs.readFileSync(path.join(root,'social.js'),'utf8');
  social=social.replace('global.SengokuSocial={open','global.__musicTest={s,loadConfig,loadMusicBroadcast,pauseMusicBroadcast,observeMusicBroadcast,musicBroadcastRequest,getPromotionContext,setController:value=>musicBroadcastController=value,bumpPrivilege:()=>privilegeEpoch++};global.SengokuSocial={open');
  vm.runInContext(social,context);
  const test=context.__musicTest;
  let checks=0,controller;
  try{
    await test.loadConfig();await flush();
    assert.equal(calls[0].route,'/config');assert.equal(calls[0].options.headers.Authorization,undefined);assert.equal(player.currentId,'battle-storm');
    assert([...timers.values()].some(t=>t.ms===5000));assert([...timers.values()].some(t=>t.ms===30000));checks++;

    const operator=await h.session('接合試験の運営');
    h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)").run(operator.user.id,h.now);
    // Keep the exact actor/token seen by the actual Social request adapter.
    test.s.identity={id:operator.user.id,token:operator.token};test.s.user={id:operator.user.id,isAdmin:true,isStaff:false};
    controller=context.SengokuMusicBroadcast.create({getContext:()=>({...test.getPromotionContext(),identity:test.s.identity}),request:test.musicBroadcastRequest,onUpdate:test.observeMusicBroadcast});
    test.setController(controller);
    assert.equal(await controller.refresh(),true);
    assert.equal(await controller.setEnabled(true),true);await flush();
    const post=calls.find(c=>c.route==='/admin/music'&&c.options.method==='POST'),body=JSON.parse(post.options.body);
    assert.deepEqual(Object.keys(body).sort(),['enabled','expectedRevision','mode','requestId']);assert.equal(body.enabled,true);assert.equal(body.mode,'loop');assert.equal(body.expectedRevision,0);assert.equal(post.options.headers.Authorization,'Bearer '+operator.token);
    assert.equal(player.currentId,'operation-broadcast');assert.equal(player.broadcast.revision,1);assert.equal(player.volume,23);assert.equal(player.auto,false);checks++;

    const put=async values=>(await h.api('/admin/music',{method:'POST',token:operator.token,body:{requestId:crypto.randomUUID(),...values}})).data;
    h.now+=6000;musicFixture.setNow(h.now);const newer=await put({enabled:true,mode:'continuous',expectedRevision:1});
    await test.loadMusicBroadcast();await flush();
    const publicCall=calls.filter(c=>c.route==='/music').at(-1);assert.equal(publicCall.options.headers.Authorization,undefined);assert.equal(publicCall.options.method,'GET');assert.equal(publicCall.options.cache,'no-store');
    assert.equal(player.broadcast.mode,'continuous');assert.equal(player.broadcast.revision,2);assert.equal(controller.getState().musicBroadcast.revision,2);checks++;

    const old={enabled:true,mode:'loop',revision:1,startedAt:new Date(h.now-6000).toISOString(),updatedAt:new Date(h.now-6000).toISOString()};
    assert.equal(test.observeMusicBroadcast(old,new Date(h.now).toISOString()),false);assert.equal(player.broadcast.revision,2);checks++;

    hold=deferred();const delayed=hold,request=test.loadMusicBroadcast();
    for(let i=0;i<50&&!calls.some(c=>c.route==='/music'&&c!==publicCall);i++)await Promise.resolve();
    await flush();document.hidden=true;test.pauseMusicBroadcast();
    h.now+=2000;musicFixture.setNow(h.now);const stopped=await put({enabled:false,mode:'continuous',expectedRevision:2});
    delayed.resolve();await request;await flush();assert.equal(player.broadcast.revision,2);assert(![...timers.values()].some(t=>t.ms===5000),'hidden clients do not schedule a music poll');
    document.hidden=false;await test.loadMusicBroadcast();await flush();assert.equal(player.broadcast.enabled,false);assert.equal(player.broadcast.revision,3);assert.equal(player.currentId,'battle-storm');assert.equal(controller.getState().musicBroadcast.enabled,false);checks++;

    player.pause();h.now+=1000;musicFixture.setNow(h.now);await put({enabled:true,mode:'loop',expectedRevision:3});await test.loadMusicBroadcast();await flush();
    assert.equal(player.playing,false);assert.equal(player.volume,23);assert.equal(player.broadcast.enabled,true);checks++;

    // The management adapter must not accept another route or caller-selected auth.
    assert.throws(()=>test.musicBroadcastRequest('/admin/mail',{method:'POST',body:{}}),/操作/);
    await test.musicBroadcastRequest('/admin/music',{method:'GET',auth:false,token:'attempted-substitution'});assert.equal(calls.at(-1).options.headers.Authorization,'Bearer '+operator.token);
    test.s.user.isAdmin=false;test.s.user.isStaff=true;assert.throws(()=>test.musicBroadcastRequest('/admin/music'),/運営権限/);test.s.user.isAdmin=true;checks++;

    const originalFetch=context.fetch,late=deferred();context.fetch=async(url,options)=>{const result=await originalFetch(url,options);await late.promise;return result;};
    const stale=test.musicBroadcastRequest('/admin/music');await flush();test.bumpPrivilege();late.resolve();await assert.rejects(stale,error=>error.code==='STALE_IDENTITY');context.fetch=originalFetch;checks++;

    assert.equal(errors.length,0);assert(newer.musicBroadcast.enabled);assert.equal(stopped.musicBroadcast.enabled,false);
    console.log(`Music broadcast integration passed (${checks} scenarios, ${h.calls} local Worker API calls). Real Social transport, operator controller, public polling, app bridge and audio player connected; no external requests.`);
  }finally{controller?.dispose();await player.dispose();h.close();}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
