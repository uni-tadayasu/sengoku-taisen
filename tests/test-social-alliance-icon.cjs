'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8'),icons=fs.readFileSync(path.join(__dirname,'../alliance-icon.js'),'utf8'),TOKEN='a'.repeat(64),OLD='1'.repeat(64),NEW='2'.repeat(64);
const GUILD={id:'g_alliance',name:'東雲同盟',ownerId:'actor',ownerName:'本人',iconVersion:OLD,memberCount:3,maxMembers:50};
function setup(guildRole='owner',isAdmin=false){
 const requests=[],mounts=[],nodes=new Map();let handler=async()=>({ok:true}),destroyed=0;
 const actor={id:'actor',name:'本人',clan:'織田家',isAdmin,isStaff:false,avatarVersion:OLD,guildId:GUILD.id,guildName:GUILD.name,guildRole,guildIconVersion:OLD};
 const c={console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},
  document:{readyState:'loading',hidden:false,activeElement:null,addEventListener(){},removeEventListener(){},querySelectorAll:()=>[]},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://api.example.invalid',SengokuBridge:{setAdminAccess(){},setSyncAccess(){},toast(){}},SengokuCloudSync:{start(){},stop(){}},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};},
  SengokuAvatar:{markup:user=>`<span data-player-avatar="${user?.id}"></span>`,mountPhotoEditor:(host,options)=>{const mounted={host,...options,destroyed:false,updates:[]};mounts.push(mounted);return{update(guild){mounted.updates.push(guild);},destroy(){mounted.destroyed=true;destroyed++;}};}}
 };
 const make=()=>({innerHTML:'',textContent:'',inert:false,isConnected:true,scrollTop:0,dataset:{},classList:{toggle(){}},setAttribute(){},focus(){},querySelectorAll:()=>[],contains:()=>false});
 for(const id of ['social-guild-icon-editor','social-guild-icon','social-guild-heading-name','social-guild-heading-summary','social-guild-members','social-tabs','social-confirm-host'])nodes.set('#'+id,make());
 const body=make(),dialog={querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],open:true,close(){this.open=false;},remove(){}};
 c.window=c;vm.createContext(c);vm.runInContext(icons,c);vm.runInContext(source.replace('global.SengokuSocial={open','global.__allianceTest={s,api,render,acceptUser,installIdentity,loadMe,loadGuild,refresh,close,guildView,guildRankingRows,refreshGuildMembers,setUI:(d,b)=>{dialog=d;body=b;}};global.SengokuSocial={open'),c);
 const t=c.__allianceTest;t.setUI(dialog,body);t.s.identity={id:'actor',token:TOKEN};t.s.user={...actor};t.s.guild={...GUILD};t.s.members=[{...actor},{id:'member',name:'仲間',guildRole:'member'}];t.s.open=true;t.s.tab='guild';t.s.guildSection='members';t.s.configLoaded=true;c.SengokuAllianceIcon.observe({...GUILD});
 return{c,t,actor,body,dialog,nodes,requests,mounts,setHandler:fn=>handler=fn,destroyCount:()=>destroyed};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
const editRequest=(editor,method='PUT')=>editor.request('/guild/icon',{method,data:{guildId:GUILD.id,...(method==='PUT'?{image:'jpeg-base64'}:{})}});
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
 await test('only the alliance leader sees device icon settings, independent of site administrator role',()=>{
  for(const role of ['owner','officer','member'])for(const admin of [true,false]){const b=setup(role,admin);b.t.render();assert.equal(b.mounts.length,role==='owner'?1:0);assert.equal(b.body.innerHTML.includes('id="social-guild-icon-editor"'),role==='owner');assert.match(b.body.innerHTML,/YOUR ALLIANCE/);assert(!b.body.innerHTML.includes('ギルド'));}
 });
 await test('membership heading, available alliances and rankings use the independent guild icon renderer',()=>{
  const b=setup();assert(b.t.guildView().includes('data-guild-icon="'+GUILD.id+'"'));b.t.s.user.guildId=null;b.t.s.guilds=[{...GUILD}];assert(b.t.guildView().includes('/guild-icons/'+GUILD.id));b.t.s.guildRankings={guilds:[{...GUILD,rank:1,totalPrestige:10,ownedCastles:3}],loaded:true};assert(b.t.guildRankingRows().includes('social-alliance-icon-small'));assert(!b.t.guildRankingRows().includes('data-player-avatar="'+GUILD.id+'"'));
 });
 await test('save/reset use only the captured alliance endpoint and preserve the mounted success state',async()=>{
  const b=setup();b.t.render();const editor=b.mounts[0];b.setHandler(async(_url,options)=>({ok:true,guild:{...GUILD,iconVersion:options.method==='DELETE'?null:NEW}}));let result=await editRequest(editor);editor.onUser(result.guild);assert.equal(new URL(b.requests[0].url).pathname,'/api/v1/guild/icon');assert.equal(b.requests[0].options.headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(JSON.parse(b.requests[0].options.body),{guildId:GUILD.id,image:'jpeg-base64'});assert.equal(b.t.s.user.guildIconVersion,NEW);assert.equal(b.c.SengokuSocial.getUser().guildIconVersion,NEW);assert.equal(b.t.s.user.avatarVersion,OLD);assert.equal(b.mounts.length,1);assert.equal(b.destroyCount(),0);
  const n=b.requests.length;await assert.rejects(editor.request('/me/avatar',{method:'PUT',data:{guildId:GUILD.id,image:'wrong'}}),/同盟アイコン/);await assert.rejects(editor.request('/guild/icon',{method:'PUT',data:{guildId:'other',image:'wrong'}}),/同盟アイコン/);await assert.rejects(editor.request('/guild/icon',{method:'POST',data:{guildId:GUILD.id}}),/同盟アイコン/);assert.equal(b.requests.length,n);
  result=await editRequest(editor,'DELETE');editor.onUser(result.guild);assert.equal(b.t.s.user.guildIconVersion,null);assert.equal(b.c.SengokuAllianceIcon.resolve(GUILD).iconVersion,null);assert.equal(b.mounts.length,1);
 });
 await test('regular polls and explicit refreshes retain crop editor and unchanged member DOM',async()=>{
  const b=setup();b.t.render();const html=b.body.innerHTML,editor=b.mounts[0];b.setHandler(async url=>new URL(url).pathname==='/api/v1/me'?{ok:true,user:{...b.actor},friends:[],requests:[]}:{ok:true,guild:{...GUILD},members:b.t.s.members});await b.t.refresh({silent:true});await b.t.refresh({silent:true});assert.equal(b.mounts.length,1);assert.equal(editor.destroyed,false);assert.equal(b.body.innerHTML,html);b.t.render();assert.equal(b.mounts.length,1,'Manual refresh of the same members view keeps the crop');assert.equal(b.destroyCount(),0);
  let writes=0;const members=b.nodes.get('#social-guild-members');members.dataset={};Object.defineProperty(members,'innerHTML',{get:()=>'',set:()=>writes++});b.t.refreshGuildMembers();b.t.refreshGuildMembers();assert.equal(writes,1,'Unchanged member rows are not rebuilt on each poll');
  b.setHandler(async()=>({ok:true,user:{...b.actor,guildIconVersion:NEW},friends:[],requests:[]}));await b.t.loadMe();assert.equal(b.mounts.length,1);assert.equal(editor.updates.at(-1).iconVersion,NEW);
 });
 await test('real API ordering normalizes old /me and /guild responses after accepted upload or removal',async()=>{
  for(const version of [NEW,null]){const b=setup();b.t.render();const late=deferred();b.setHandler(()=>late.promise);const me=b.t.loadMe(),guild=b.t.loadGuild();b.mounts[0].onUser({...GUILD,iconVersion:version});late.resolve({ok:true,user:{...b.actor,guildIconVersion:OLD},guild:{...GUILD,iconVersion:OLD},members:b.t.s.members,friends:[],requests:[]});await Promise.all([me,guild]);assert.equal(b.t.s.user.guildIconVersion,version);assert.equal(b.t.s.guild.iconVersion,version);assert.equal(b.c.SengokuAllianceIcon.resolve(GUILD).iconVersion,version);assert.equal(b.mounts.length,1);}
 });
 await test('membership, role, identity, account and close changes discard pending mutation results and callbacks',async()=>{
  for(const action of ['close','identity','role','membership','privilege','banned','dispose']){const b=setup('owner',true);b.t.render();const editor=b.mounts[0],late=deferred();b.setHandler(()=>late.promise);const request=editRequest(editor);if(action==='close')b.t.close();if(action==='identity')b.t.installIdentity({id:'next',token:'b'.repeat(64)},{id:'next',name:'次の領主'});if(action==='role')b.t.acceptUser({...b.actor,guildRole:'member'});if(action==='membership')b.t.acceptUser({...b.actor,guildId:'new-guild',guildName:'次の同盟',guildRole:'member',guildIconVersion:null});if(action==='privilege')b.t.acceptUser({...b.actor,isAdmin:false});if(action==='banned')b.t.acceptUser({...b.actor,isBanned:true});if(action==='dispose')await b.c.SengokuSocial.dispose();const before=JSON.stringify(b.t.s.user);late.resolve({ok:true,guild:{...GUILD,iconVersion:NEW}});await assert.rejects(request,e=>e.code==='STALE_IDENTITY');editor.onUser({...GUILD,iconVersion:NEW});assert.equal(JSON.stringify(b.t.s.user),before,action);assert.equal(b.c.SengokuAllianceIcon.resolve(GUILD).iconVersion,OLD,action+' does not accept stale writes into the registry');assert(editor.destroyed,action);}
 });
 await test('server-side loss of leader role refreshes membership and retires the active crop editor',async()=>{
  const b=setup();b.t.render();b.setHandler(async url=>new URL(url).pathname==='/api/v1/guild/icon'?{__status:403,ok:false,error:{code:'GUILD_ROLE_REQUIRED',message:'盟主だけが変更できます。'}}:{ok:true,user:{...b.actor,guildRole:'member'},friends:[],requests:[]});await assert.rejects(editRequest(b.mounts[0]),e=>e.code==='GUILD_ROLE_REQUIRED');assert.equal(b.t.s.user.guildRole,'member');assert.equal(b.mounts[0].destroyed,true);assert.equal(b.c.SengokuAllianceIcon.resolve(GUILD).iconVersion,OLD);
 });
 console.log(`${count} social/alliance icon integration groups passed. No external requests or persistent writes.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
