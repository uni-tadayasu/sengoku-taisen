/* Exercise the real photo editor, social API and registry across GET/write races. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const avatarSource=fs.readFileSync(require.resolve('../avatar.js'),'utf8'),socialSource=fs.readFileSync(require.resolve('../social.js'),'utf8');
const OLD='1'.repeat(64),NEW='2'.repeat(64),TOKEN='a'.repeat(64),copy=value=>JSON.parse(JSON.stringify(value));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};}
class Node{
  constructor(){this.handlers=new Map();this.dataset={};this.innerHTML='';this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.inert=false;this.isConnected=true;this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name),remove:name=>this.classes.delete(name)};}
  addEventListener(event,handler){this.handlers.set(event,handler);}removeEventListener(event){this.handlers.delete(event);}
  setAttribute(){}removeAttribute(){}contains(){return true;}querySelectorAll(){return [];}querySelector(){return null;}emit(event,values={}){this.handlers.get(event)?.(values);}
}
function setup(){
  const document=new Node();document.readyState='loading';document.hidden=false;const requests=[],images=[],nodes=new Map(),selectors=new Map();let handler=async()=>({ok:true}),objectId=0;
  const actor={id:'u_avatar_race',name:'葵の領主',clan:'織田家',isAdmin:false,isStaff:false,avatarVersion:OLD,guildId:null};
  const scope={document,console,URL:class extends URL{static createObjectURL(){return 'blob:avatar-'+(++objectId);}static revokeObjectURL(){}},URLSearchParams,AbortController,Intl,Date,crypto:require('node:crypto').webcrypto,Uint8Array,Blob,
    Image:class{constructor(){images.push(this);}set src(value){this.url=value;}},btoa:text=>Buffer.from(text,'binary').toString('base64'),setTimeout:()=>1,clearTimeout(){},SENGOKU_API_BASE:'https://api.example.invalid',
    localStorage:{getItem:()=>null,setItem(){throw Error('An avatar change must not rewrite saved identity');},removeItem(){throw Error('An avatar change must not delete saved identity');}},
    SengokuBridge:{setRoleAccess(){},setSyncAccess(){},toast(){}},SengokuCloudSync:{start(){},stop(){}},
    fetch:async(url,options)=>{requests.push({url,options});const result=await handler(url,options);return{ok:true,status:200,json:async()=>copy(result)};}};
  scope.window=scope;vm.createContext(scope);vm.runInContext(avatarSource,scope);
  const host=new Node();nodes.set('#social-avatar-editor',host);nodes.set('#social-profile-avatar',new Node());
  for(const key of ['file','canvas','crop','zoom','x','y','status','current','zoom-label'])selectors.set('[data-avatar-'+key+']',new Node());
  for(const key of ['choose','save','cancel','remove']){const node=new Node();node.dataset.avatar=key;node.closest=()=>node;selectors.set('[data-avatar="'+key+'"]',node);}
  const canvas=selectors.get('[data-avatar-canvas]');canvas.getContext=()=>({fillRect(){},drawImage(){}});canvas.getBoundingClientRect=()=>({width:256});canvas.toBlob=(callback,type)=>callback(new Blob([new Uint8Array([255,216,255,217])],{type}));
  host.querySelector=selector=>selectors.get(selector)||null;host.querySelectorAll=()=>[...selectors.values()];
  const dialog=new Node(),body=new Node();dialog.querySelector=selector=>nodes.get(selector)||null;dialog.open=true;
  const expose='global.__avatarRaceTest={s,api,loadMe,mountProfileAvatar,setUI:(d,b)=>{dialog=d;body=b;}};';
  vm.runInContext(socialSource.replace('global.SengokuSocial={open',expose+'global.SengokuSocial={open'),scope);
  const t=scope.__avatarRaceTest;t.setUI(dialog,body);t.s.identity={id:actor.id,token:TOKEN};t.s.user=copy(actor);t.s.open=true;t.s.tab='profile';t.s.configLoaded=true;
  t.s.chats.set('world:',{messages:[{id:1,userId:actor.id,name:actor.name,avatarVersion:OLD,text:'投稿済みの本文'}]});scope.SengokuAvatar.observe(actor);t.mountProfileAvatar();
  const click=action=>host.emit('click',{target:selectors.get('[data-avatar="'+action+'"]'),preventDefault(){}});
  async function choose(){const input=selectors.get('[data-avatar-file]');input.files=[{type:'image/jpeg',size:1000}];input.emit('change');const image=images.at(-1);image.naturalWidth=640;image.naturalHeight=480;image.onload();await tick();}
  return{scope,t,actor,nodes,selectors,requests,click,choose,setHandler:fn=>handler=fn};
}
(async()=>{
  for(const method of ['PUT','DELETE']){
    const h=setup(),write=deferred(),lateRead=deferred();let reads=0;
    const readResult=()=>({ok:true,user:{...h.actor,avatarVersion:OLD},friends:[],requests:[]});
    h.setHandler((url,options)=>{
      assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
      if(options.method===method){assert(new URL(url).pathname.endsWith('/me/avatar'));if(method==='PUT')assert.deepEqual(Object.keys(JSON.parse(options.body)),['image']);return write.promise;}
      assert.equal(options.method,'GET');assert(new URL(url).pathname.endsWith('/me'));return ++reads===1?readResult():lateRead.promise;
    });
    if(method==='PUT')await h.choose();h.click(method==='PUT'?'save':'remove');await tick();
    assert.equal(h.requests.filter(row=>row.options.method===method).length,1,'the real editor starts one pending mutation');
    await h.t.loadMe();assert.equal(h.t.s.user.avatarVersion,OLD,'an overlapping GET may still observe the old server value');
    const pendingRead=h.t.loadMe();await tick();
    const expected=method==='PUT'?NEW:null;write.resolve({ok:true,user:{...h.actor,avatarVersion:expected}});await tick();await tick();
    assert.equal(h.t.s.user.avatarVersion,expected,'the later successful write must win over the overlapping GET');assert.equal(h.scope.SengokuSocial.getUser().avatarVersion,expected);
    const status=h.selectors.get('[data-avatar-status]').textContent;assert(status.includes(method==='PUT'?'保存しました':'標準アイコンに戻しました'),'the real editor reaches its successful state');
    const shown=h.scope.SengokuAvatar.markup({id:h.actor.id});assert.equal(shown.includes('<img'),method==='PUT');if(expected)assert(shown.includes('?v='+expected));
    assert.equal(h.t.s.chats.get('world:').messages[0].avatarVersion,expected,'old own posts adopt the completed icon change');
    lateRead.resolve(readResult());await pendingRead;
    assert.equal(h.t.s.user.avatarVersion,expected,'a delayed pre-commit GET cannot restore the old photo');assert.equal(h.t.s.identity.token,TOKEN);assert.equal(h.t.s.user.id,h.actor.id);
    const final=h.scope.SengokuAvatar.markup({id:h.actor.id,avatarVersion:OLD});assert.equal(final.includes('<img'),method==='PUT');if(expected)assert(final.includes('?v='+expected));else assert(final.includes('>葵</span>'));
    assert.equal(h.selectors.get('[data-avatar="remove"]').hidden,method==='DELETE');assert.equal(h.selectors.get('[data-avatar="save"]').disabled,false);
    assert.equal(h.t.s.chats.get('world:').messages[0].text,'投稿済みの本文');
    console.log('PASS real '+method+' editor -> overlapping stale GET -> successful write -> delayed stale GET preserves committed avatar and identity');
  }
  console.log('2 avatar write/API ordering integrations passed using real avatar.js and social.js. No external requests or saved-data writes.');
})().catch(error=>{console.error(error);process.exitCode=1;});
