const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../social.js'),'utf8'),TOKEN='a'.repeat(64),OLD='1'.repeat(64),NEW='2'.repeat(64);
function setup(role='ordinary'){
 const requests=[],mounts=[],marks=[],nodes=new Map();let handler=async()=>({ok:true}),destroyed=0;
 const actor={id:'actor',name:'本人',clan:'織田家',isAdmin:role==='admin',isStaff:role==='staff',avatarVersion:OLD,guildId:null};
 const c={console,URL,URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,setTimeout:()=>1,clearTimeout(){},
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){},removeItem(){}},SENGOKU_API_BASE:'https://api.example.invalid',
  SengokuBridge:{setAdminAccess(){},setSyncAccess(){},toast(){}},SengokuCloudSync:{start(){},stop(){}},
  fetch:async(url,options)=>{requests.push({url,options});const r=await handler(url,options);return{ok:!r.__status,status:r.__status||200,json:async()=>r};},
  SengokuAvatar:{markup:(user,size)=>{marks.push({user,size});return `<span data-avatar-owner="${user?.id}" data-version="${user?.avatarVersion||''}"></span>`;},mount:(host,options)=>{const mounted={host,...options,destroyed:false,updates:[]};mounts.push(mounted);return{update(user){mounted.updates.push(user);},destroy(){mounted.destroyed=true;destroyed++;}};}}
 };
 const make=()=>({innerHTML:'',textContent:'',inert:false,isConnected:true,scrollTop:0,dataset:{},classList:{toggle(){}},setAttribute(){},focus(){}});
 for(const id of ['social-avatar-editor','social-profile-avatar','social-tabs','social-confirm-host'])nodes.set('#'+id,make());
 const body=make(),dialog={querySelector:selector=>nodes.get(selector)||null,querySelectorAll:()=>[],open:true,close(){this.open=false;},remove(){}};
 c.window=c;vm.createContext(c);vm.runInContext(source.replace('global.SengokuSocial={open','global.__avatarSocialTest={s,api,render,acceptUser,installIdentity,loadMe,close,profileView,onlineView,friendsView,guildView,playerCards,staffCards,recentLoginsView,renderMessages,setUI:(d,b)=>{dialog=d;body=b;}};global.SengokuSocial={open'),c);
 const t=c.__avatarSocialTest;t.setUI(dialog,body);t.s.identity={id:'actor',token:TOKEN};t.s.user=role==='guest'?null:{...actor};t.s.open=true;t.s.tab='profile';t.s.configLoaded=true;
 return{c,t,actor,body,dialog,nodes,requests,mounts,marks,setHandler:fn=>handler=fn,destroyCount:()=>destroyed};
}
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
let count=0;async function test(name,run){await run();count++;console.log('PASS '+name);}
(async()=>{
await test('chat polling retains existing messages, loaded avatars, reading position and draft across additions and removals',()=>{
 const mounted=setup(),{host,doc}=require('./helpers/dom-model.cjs').setup(),list=doc.createElement('section'),draft=doc.createElement('textarea');
 host.appendChild(list);host.appendChild(draft);list.scrollHeight=1500;list.clientHeight=300;
 mounted.c.SengokuStableDOM=require('../stable-dom.js');mounted.nodes.set('#social-message-list',list);
 mounted.t.s.tab='world';
 const message=id=>({id,userId:'other',name:'参陣した領主',avatarVersion:OLD,text:'伝令 '+id,createdAt:'2026-11-22T00:00:00Z'});
 const cache={messages:Array.from({length:24},(_,i)=>message(i+1)),after:24};mounted.t.s.chats.set('world:',cache);
 mounted.t.renderMessages();const original=list.querySelectorAll('article'),portrait=original[0].querySelector('[data-avatar-owner]');
 portrait.setAttribute('data-loaded','true');draft.value='編集中の文';draft.focus();draft.setSelectionRange(1,3);list.scrollTop=140;
 for(let i=0;i<45;i++)mounted.t.renderMessages();
 assert(list.querySelectorAll('article').every((node,index)=>node===original[index]));
 cache.messages.push(message(25));mounted.t.renderMessages();assert.equal(list.querySelectorAll('article').length,25);
 assert(original.every((node,index)=>list.querySelectorAll('article')[index]===node));
 assert.strictEqual(original[0].querySelector('[data-avatar-owner]'),portrait);assert.equal(portrait.getAttribute('data-loaded'),'true');
 cache.messages.splice(1,1);cache.messages[2].text='更新された伝令';mounted.t.renderMessages();
 assert(!list.contains(original[1]));assert(list.contains(original[3]));assert.match(original[3].textContent,/更新された伝令/);
 assert.equal(list.scrollTop,140);assert.strictEqual(doc.activeElement,draft);assert.equal(draft.value,'編集中の文');
 assert.equal(draft.selectionStart,1);assert.equal(draft.selectionEnd,3);
});
await test('every registered role receives the profile editor and guests do not',()=>{
 for(const role of ['ordinary','staff','admin','guest']){const b=setup(role);b.t.render();assert.equal(b.mounts.length,role==='guest'?0:1);if(role!=='guest'){assert.match(b.body.innerHTML,/id="social-avatar-editor"/);assert.equal(b.mounts[0].user.id,'actor');assert(b.marks.some(m=>m.size==='profile'));}}
});
await test('player surfaces use the shared photo renderer and chat normalizes userId with avatar refresh signatures',()=>{
 const b=setup('admin'),p={id:'other',name:'他の領主',clan:'武田家',avatarVersion:NEW,isStaff:true};
 b.t.s.onlinePlayers=[p];b.t.onlineView();b.t.playerCards([p],'friend');b.t.staffCards([p]);b.t.s.friends=[p];b.t.s.requests=[{...p,direction:'incoming'}];b.t.friendsView();b.t.s.user.guildId='guild';b.t.s.user.guildName='一門';b.t.s.members=[p];b.t.s.tab='guild';b.t.s.guildSection='members';b.t.guildView();b.t.s.recentLogins={players:[{...p,lastSeen:'2026-11-22T00:00:00Z'}],loaded:true,total:1};b.t.recentLoginsView();assert(b.marks.filter(m=>m.user.id==='other'&&m.user.avatarVersion===NEW).length>=7);
 const list={innerHTML:'',dataset:{},scrollHeight:10,scrollTop:0,clientHeight:100};b.nodes.set('#social-message-list',list);b.t.s.tab='world';const message={id:19,userId:'other',name:p.name,avatarVersion:OLD,text:'こんにちは',createdAt:'2026-11-22T00:00:00Z'};b.t.s.chats.set('world:',{messages:[message],after:19});b.t.renderMessages();assert(list.innerHTML.includes(`data-avatar-owner="other" data-version="${OLD}"`));message.avatarVersion=NEW;b.t.renderMessages();assert(list.innerHTML.includes(`data-version="${NEW}"`));
});
await test('saving uses only the current authenticated avatar endpoint and retains the editor success state',async()=>{
 const b=setup();b.t.render();const editor=b.mounts[0];b.setHandler(async()=>({ok:true,user:{...b.actor,avatarVersion:NEW}}));const result=await editor.request('/me/avatar',{method:'PUT',data:{image:'jpeg-base64'}});editor.onUser(result.user);
 assert.equal(new URL(b.requests[0].url).pathname,'/api/v1/me/avatar');assert.equal(b.requests[0].options.headers.Authorization,'Bearer '+TOKEN);assert.deepEqual(JSON.parse(b.requests[0].options.body),{image:'jpeg-base64'});assert.equal(b.t.s.user.avatarVersion,NEW);assert.equal(b.c.SengokuSocial.getUser().avatarVersion,NEW);assert.equal(b.mounts.length,1);assert.equal(b.destroyCount(),0);assert(b.nodes.get('#social-profile-avatar').innerHTML.includes(NEW));
 const n=b.requests.length;await assert.rejects(editor.request('/admin/mail',{method:'POST',data:{}}),/アイコンの操作/);assert.equal(b.requests.length,n);
 b.setHandler(async()=>({ok:true,user:{...b.actor,avatarVersion:null}}));const removed=await editor.request('/me/avatar',{method:'DELETE'});editor.onUser(removed.user);assert.equal(b.t.s.user.avatarVersion,null);assert.equal(b.mounts.length,1);
});
await test('routine profile checks never remount an in-progress editor',async()=>{
 const b=setup();b.t.render();b.setHandler(async()=>({ok:true,user:b.actor,friends:[],requests:[]}));await b.t.loadMe();const marks=b.marks.length;await b.t.loadMe();assert.equal(b.marks.length,marks,'Unchanged profile metadata does not recreate its image');assert.equal(b.mounts.length,1);assert.equal(b.destroyCount(),0);b.setHandler(async()=>({ok:true,user:{...b.actor,avatarVersion:NEW},friends:[],requests:[]}));await b.t.loadMe();assert.equal(b.mounts.length,1);assert.equal(b.mounts[0].updates.at(-1).avatarVersion,NEW,'Other-device updates reach the mounted editor without dropping a crop');
});
await test('an older metadata response cannot restore a pre-upload avatar version',async()=>{
 const b=setup();b.t.render();const late=deferred();b.setHandler(()=>late.promise);const me=b.t.loadMe();b.mounts[0].onUser({...b.actor,avatarVersion:NEW});late.resolve({ok:true,user:{...b.actor,avatarVersion:OLD},friends:[],requests:[]});await me;assert.equal(b.t.s.user.avatarVersion,NEW);assert.equal(b.mounts.length,1);
});
await test('close, identity switch, role change and disposal retire old request and callback lifetimes',async()=>{
 for(const action of ['close','identity','role','dispose']){const b=setup('admin');b.t.render();const editor=b.mounts[0],late=deferred();b.setHandler(()=>late.promise);const request=editor.request('/me/avatar',{method:'PUT',data:{image:'old-upload'}});if(action==='close')b.t.close();if(action==='identity')b.t.installIdentity({id:'next',token:'b'.repeat(64)},{id:'next',name:'次の領主'});if(action==='role')b.t.acceptUser({...b.actor,isAdmin:false,isStaff:false},{fromSync:true});if(action==='dispose')await b.c.SengokuSocial.dispose();const version=b.t.s.user?.avatarVersion,id=b.t.s.user?.id,role=b.t.s.user?.isAdmin;late.resolve({ok:true,user:{...b.actor,avatarVersion:NEW}});await assert.rejects(request,e=>e.code==='STALE_IDENTITY');editor.onUser({...b.actor,avatarVersion:NEW,isAdmin:true});assert.equal(b.t.s.user?.avatarVersion,version,action);assert.equal(b.t.s.user?.id,id,action);assert.equal(b.t.s.user?.isAdmin,role,action);assert.equal(editor.destroyed,true,action);}
});
console.log(`${count} social/avatar integration checks passed. No network requests were made.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
