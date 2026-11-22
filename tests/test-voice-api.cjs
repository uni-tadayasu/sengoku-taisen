/* Real social voice facade: auth, room restrictions, and delayed-access races. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../social.js'),'utf8');
const PLAYER='u_'+'1'.repeat(32),TOKEN='a'.repeat(64),SESSION='vc_'+'b'.repeat(32),PEER='vc_'+'c'.repeat(32),copy=value=>JSON.parse(JSON.stringify(value));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
function harness({guest=false,admin=false,staff=false,guild=true}={}){
 const calls=[],voiceEvents=[];let transport=async()=>({data:{ok:true,participants:[]}});
 const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){},querySelectorAll:()=>[]},
  localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://fixture.invalid',
  SengokuBridge:{setRoleAccess(){},applyCourtAccess(){},toast(){}},
  SengokuCloudSync:{getStatus:()=>({linked:true,ready:true,writable:false}),suspendAccount(){},invalidateAccountAccess(){}},
  SengokuVoice:{refreshAccess:()=>voiceEvents.push('refresh'),leave:reason=>voiceEvents.push(['leave',reason])},
  fetch:async(url,options)=>{calls.push({url,method:options.method,headers:copy(options.headers),body:options.body?JSON.parse(options.body):null,keepalive:options.keepalive,credentials:options.credentials});const response=await transport(url,options),status=response.status||200;return{ok:status>=200&&status<300,status,json:async()=>response.data};}
 };
 scope.window=scope;vm.createContext(scope);
 const injection='global.__voiceApiTest={s,changeIdentity(){authEpoch++;s.identity={id:"other-player",token:"b".repeat(64)};s.user={id:"other-player",name:"別の領主",isAdmin:false,isStaff:false};},changeRole(){privilegeEpoch++;s.user.isStaff=!s.user.isStaff;},changeGuild(){guildEpoch++;s.user.guildId="guild-next";},pending(){accountEpoch++;s.accountAccessPending={};},hold(){recoveryHeld=true;},clearGuild:clearGuildData,clearAdmin:clearAdminData,clearPrivate,acceptUser,markAccountAccessChanged,markAccountBanned};';
 vm.runInContext(source.replace('global.SengokuSocial={open',injection+'global.SengokuSocial={open'),scope);
 const control=scope.__voiceApiTest;if(!guest){control.s.identity={id:PLAYER,token:TOKEN};control.s.user={id:PLAYER,name:'通話領主',isAdmin:admin,isStaff:staff,guildId:guild?'guild-one':null,guildName:guild?'検証同盟':null,guildRole:guild?'member':null};}
 return{api:scope.SengokuSocial,control,calls,voiceEvents,setTransport:value=>transport=value};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
const routeCases=[['/voice/room?channel=guild',{}],['/voice/poll?sessionId='+SESSION+'&after=25',{}],['/voice/join',{method:'POST',data:{channel:'guild',muted:false}}],['/voice/heartbeat',{method:'POST',data:{sessionId:SESSION,muted:true}}],['/voice/signal',{method:'POST',data:{sessionId:SESSION,toSessionId:PEER,kind:'offer',payload:{type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'}}}],['/voice/leave',{method:'POST',data:{sessionId:SESSION}}]];

test('room reads and every signaling operation use only the current bearer on follower devices',async()=>{
 const h=harness();for(const[route,options]of routeCases)await h.api.voiceRequest(route,{...options,auth:false,token:'forged-token',keepalive:true});
 assert.equal(h.calls.length,routeCases.length);assert(h.calls.every(call=>call.headers.Authorization==='Bearer '+TOKEN&&call.credentials==='omit'));assert.equal(h.calls.filter(call=>call.keepalive===true).length,1);assert.equal(h.calls.at(-1).url,'https://fixture.invalid/api/v1/voice/leave');assert.deepEqual(h.calls[4].body,routeCases[4][1].data);
 const context=h.api.getVoiceContext();assert.equal(context.playerId,PLAYER);assert.equal(context.guildId,'guild-one');assert.equal(context.guildName,'検証同盟');assert.equal(typeof context.guildEpoch,'number');assert(!JSON.stringify(context).includes(TOKEN));
});
test('the transport accepts exact admin rooms only for current staff or operator accounts',async()=>{
 for(const roles of [{staff:true},{admin:true}]){const h=harness(roles);await h.api.voiceRequest('/voice/room?channel=admin');await h.api.voiceRequest('/voice/join',{method:'POST',data:{channel:'admin',muted:true}});assert.equal(h.calls.length,2);}
 const h=harness();h.control.s.user.title='天皇';for(const [route,options]of [['/voice/room?channel=admin',{}],['/voice/join',{method:'POST',data:{channel:'admin'}}]])await assert.rejects(h.api.voiceRequest(route,options),error=>error.code==='VOICE_ACCESS_REQUIRED');assert.equal(h.calls.length,0);
 const unaffiliated=harness({guild:false});for(const[route,options]of [routeCases[0],routeCases[2]])await assert.rejects(unaffiliated.api.voiceRequest(route,options),error=>error.status===403);assert.equal(unaffiliated.calls.length,0);
});
test('foreign routes, path traversal, malformed sessions and duplicate query keys never reach HTTP',async()=>{
 const h=harness({admin:true});const invalid=[['/admin/staff','GET'],['/voice/../admin/staff','POST'],['/voice/room','GET'],['/voice/room?channel=world','GET'],['/voice/room?channel=guild&channel=admin','GET'],['/voice/room?channel=guild&owner=other','GET'],['/voice/room?channel=guild#private','GET'],['/voice/poll?sessionId='+SESSION+'&after=-1','GET'],['/voice/poll?sessionId='+SESSION+'&after=1&after=2','GET'],['/voice/poll?sessionId=../../me','GET'],['/voice/poll?sessionId='+SESSION+'&after=9999999999999999','GET'],['/voice/poll?sessionId='+SESSION+'?after=1','GET'],['/voice/join?channel=guild','POST'],['/voice/join','DELETE'],['/voice/leave','GET']];
 for(const [route,method]of invalid)await assert.rejects(h.api.voiceRequest(route,{method,data:{channel:'guild',sessionId:SESSION}}),error=>error.status===400);
 for(const [route,data]of [['/voice/join',{channel:'world'}],['/voice/heartbeat',{}],['/voice/signal',{sessionId:'other'}],['/voice/leave',[]]])await assert.rejects(h.api.voiceRequest(route,{method:'POST',data}),error=>error.status===400);assert.equal(h.calls.length,0);
});
test('guests, stale identities, recovery, bans and pending verification cannot signal or inspect rooms',async()=>{
 for(const scenario of ['guest','unverified','mismatched','banned','pending','hold']){const h=harness({guest:scenario==='guest'});if(scenario==='unverified')h.control.s.user=null;else if(scenario==='mismatched')h.control.s.user.id='another';else if(scenario==='banned')h.control.s.accountBanned={playerId:PLAYER};else if(['pending','hold'].includes(scenario))h.control[scenario]();for(const[route,options]of routeCases)await assert.rejects(h.api.voiceRequest(route,options),error=>error.status===403);assert.equal(h.calls.length,0);}
});
test('identity, role, guild and moderation epochs discard late private rosters and signaling responses',async()=>{
 for(const change of ['changeIdentity','changeRole','changeGuild','pending','hold'])for(const[route,options]of routeCases){const h=harness({admin:true}),pause=deferred();h.setTransport(()=>pause.promise);const pending=h.api.voiceRequest(route,options);h.control[change]();pause.resolve({data:{ok:true,sessionId:SESSION,participants:[{name:'古い部屋の相手'}]}});await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');}
});
test('membership and staff access errors update identity and immediately notify the active call',async()=>{
 const guild=harness();guild.setTransport(async()=>({status:403,data:{ok:false,error:{code:'GUILD_REQUIRED',message:'所属同盟を確認してください。'}}}));await assert.rejects(guild.api.voiceRequest('/voice/room?channel=guild'),error=>error.code==='GUILD_REQUIRED');assert.equal(guild.api.getVoiceContext().guildId,null);assert(guild.voiceEvents.includes('refresh'));
 const staff=harness({staff:true});staff.setTransport(async()=>({status:403,data:{ok:false,error:{code:'STAFF_CHAT_REQUIRED',message:'参加権限が変わりました。'}}}));await assert.rejects(staff.api.voiceRequest('/voice/room?channel=admin'),error=>error.code==='STAFF_CHAT_REQUIRED');assert.equal(staff.api.getVoiceContext().user.isStaff,false);assert(staff.voiceEvents.includes('refresh'));
});
test('server bans, account revalidation and token expiry stop calls through existing identity hooks',async()=>{
 for(const [code,status]of [['ACCOUNT_BANNED',403],['ACCOUNT_ACCESS_CHANGED',409],['INVALID_TOKEN',401]]){const h=harness({staff:true});h.setTransport(async()=>({status,data:{ok:false,error:{code,message:'利用状態が変わりました。'}}}));await assert.rejects(h.api.voiceRequest('/voice/poll?sessionId='+SESSION),error=>error.code===code);assert(h.voiceEvents.includes('refresh'));assert(!h.api.getVoiceContext().user);if(status!==401)assert(h.voiceEvents.some(e=>Array.isArray(e)&&e[0]==='leave'));}
});
test('a delayed denial for an old identity cannot remove the current account or its room membership',async()=>{
 const h=harness({staff:true}),pause=deferred();h.setTransport(()=>pause.promise);const pending=h.api.voiceRequest('/voice/room?channel=admin');h.control.changeIdentity();h.control.s.user.guildId='current-guild';pause.resolve({status:403,data:{ok:false,error:{code:'GUILD_REQUIRED',message:'old response'}}});await assert.rejects(pending,error=>error.code==='STALE_IDENTITY');assert.equal(h.api.getVoiceContext().playerId,'other-player');assert.equal(h.api.getVoiceContext().guildId,'current-guild');assert.equal(h.voiceEvents.length,0);
});
test('guild, role and private-data invalidation explicitly notify or terminate the current call',async()=>{
 const h=harness({staff:true});h.control.clearGuild();h.control.clearAdmin();assert.equal(h.voiceEvents.filter(e=>e==='refresh').length,2);h.control.clearPrivate();assert(h.voiceEvents.some(e=>Array.isArray(e)&&e[0]==='leave'));
});

(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' real social voice transport checks passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
