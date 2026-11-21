'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const sources=['avatar.js','alliance-icon.js'].map(file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8'));
const OLD='a'.repeat(64),NEW='b'.repeat(64),GUILD={id:'g_alliance',name:'東雲同盟',iconVersion:OLD};
class Element{
 constructor(){this.handlers=new Map();this.value='';this.hidden=false;this.disabled=false;this.innerHTML='';this.textContent='';this.dataset={};this.classList={toggle(){},remove(){}};}
 addEventListener(type,handler){this.handlers.set(type,handler);}removeEventListener(type,handler){if(this.handlers.get(type)===handler)this.handlers.delete(type);}setAttribute(){}removeAttribute(){}click(){this.clicked=true;}contains(){return true;}emit(type,event={}){this.handlers.get(type)?.(event);}
}
function setup(){
 const images=[],revoked=[],draws=[],doc=new Element();doc.querySelectorAll=()=>[];let objectId=0;
 class Image{constructor(){images.push(this);}set src(value){this.url=value;}}
 const window={document:doc,SENGOKU_API_BASE:'https://game.example/api/v1',btoa:s=>Buffer.from(s,'binary').toString('base64')};
 const context={window,document:doc,URL:Object.assign(URL,{createObjectURL:()=>`blob:alliance-${++objectId}`,revokeObjectURL:url=>revoked.push(url)}),Image,Uint8Array,Blob,console};
 vm.createContext(context);for(const source of sources)vm.runInContext(source,context);
 const host=new Element(),selectors=new Map();
 for(const key of ['file','canvas','crop','zoom','x','y','status','current','zoom-label'])selectors.set(`[data-avatar-${key}]`,new Element());
 for(const key of ['choose','save','cancel','remove'])selectors.set(`[data-avatar="${key}"]`,new Element());
 const canvas=selectors.get('[data-avatar-canvas]');canvas.getContext=()=>({fillRect(){},drawImage(...args){draws.push(args);}});canvas.getBoundingClientRect=()=>({width:256});canvas.setPointerCapture=()=>{};canvas.toBlob=(cb,type)=>cb(new Blob([new Uint8Array([255,216,255,217])],{type}));
 host.querySelector=s=>selectors.get(s);host.querySelectorAll=()=>[...selectors.values()];
 const click=action=>{const target=selectors.get(`[data-avatar="${action}"]`);target.dataset.avatar=action;target.closest=()=>target;host.emit('click',{target,preventDefault(){}});};
 const file=(type='image/jpeg',size=5000)=>{const input=selectors.get('[data-avatar-file]');input.files=[{type,size}];input.emit('change');};
 const decode=(index=images.length-1,width=1600,height=1200)=>{const photo=images[index];photo.naturalWidth=width;photo.naturalHeight=height;photo.onload();return photo;};
 return{api:window.SengokuAllianceIcon,avatar:window.SengokuAvatar,window,doc,host,selectors,images,revoked,draws,canvas,click,file,decode};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
 await test('alliance URLs and escaped inline/profile markup are independent from player avatars',()=>{
  const q=setup();assert.equal(q.api.imageURL(GUILD),'https://game.example/api/v1/guild-icons/g_alliance?v='+OLD);
  for(const size of ['small','profile','inline'])assert.match(q.api.markup({...GUILD,name:'<同盟>'},size),new RegExp('social-alliance-icon-'+size));
  assert.match(q.api.markup({...GUILD,name:'<同盟>'}),/&lt;同盟&gt;/);assert(!q.api.markup(GUILD).includes('data-player-avatar'));
  q.avatar.observe({id:GUILD.id,name:'同じIDの領主',avatarVersion:OLD});q.api.observe({...GUILD,iconVersion:NEW});assert.equal(q.avatar.resolve({id:GUILD.id}).avatarVersion,OLD);assert.equal(q.api.resolve(GUILD).iconVersion,NEW);
  for(const version of ['javascript:alert(1)','A'.repeat(64),'a'.repeat(63),null])assert.equal(q.api.imageURL({...GUILD,iconVersion:version}),'');
  assert.equal(q.api.imageURL({...GUILD,id:'../avatar'}),'');q.window.SENGOKU_API_BASE='https://secret@example.com';assert.equal(q.api.imageURL(GUILD),'');
 });
 await test('late membership/list/ranking metadata cannot roll back a saved or removed alliance icon',()=>{
  const q=setup(),oldRequest=q.api.beginRequest();q.api.observe({...GUILD,iconVersion:NEW});const payload={user:{id:'lord',guildId:GUILD.id,guildName:GUILD.name,guildIconVersion:OLD},guild:{...GUILD},guilds:[{...GUILD}]};q.api.observe(payload,{requestSequence:oldRequest});assert.equal(payload.user.guildIconVersion,NEW);assert.equal(payload.guild.iconVersion,NEW);assert.equal(payload.guilds[0].iconVersion,NEW);
  const beforeRemoval=q.api.beginRequest();q.api.observe({...GUILD,iconVersion:null});q.api.observe({guild:{...GUILD,iconVersion:NEW}},{requestSequence:beforeRemoval});assert.equal(q.api.resolve(GUILD).iconVersion,null);assert(!q.api.markup(GUILD).includes('<img'));
  q.api.observe({state:{guild:{...GUILD,iconVersion:NEW}},user:{id:'lord',avatarVersion:NEW}});assert.equal(q.api.resolve(GUILD).iconVersion,null,'Game saves and player avatar DTOs never feed the guild registry');
 });
 await test('unchanged registry metadata never recreates a mounted image',()=>{
  const q=setup(),node=new Element();node.dataset={guildIcon:GUILD.id,guildIconName:GUILD.name,guildIconVersion:OLD};let patches=0;q.window.SengokuStableDOM={patch(){patches++;}};q.doc.querySelectorAll=()=>[node];q.api.observe({...GUILD});assert.equal(patches,0);q.api.observe({...GUILD,iconVersion:NEW});assert.equal(patches,1);q.api.observe({...GUILD,iconVersion:NEW});assert.equal(patches,1);assert.equal(node.dataset.guildIconVersion,NEW);
 });
 await test('device crop, zoom and pointer position use shared photo logic; save/reset target only the captured guild',async()=>{
  const q=setup();let payload,notified;const editor=q.api.mount(q.host,{guild:GUILD,request:async(route,options)=>{assert.equal(route,'/guild/icon');payload=options;return{ok:true,guild:{...GUILD,iconVersion:options.method==='DELETE'?null:NEW}};},onGuild:guild=>{notified=guild;q.api.observe(guild);}});
  assert.match(q.host.innerHTML,/同盟アイコン/);q.file();q.decode();await tick();q.selectors.get('[data-avatar-zoom]').value='2';q.selectors.get('[data-avatar-zoom]').emit('input');assert.equal(q.draws.at(-1)[3],600);
  q.canvas.emit('pointerdown',{button:0,pointerId:1,clientX:128,clientY:128});q.canvas.emit('pointermove',{pointerId:1,clientX:148,clientY:128});assert.notEqual(q.selectors.get('[data-avatar-x]').value,'50');q.canvas.emit('pointerup');
  const crop=q.draws.at(-1),before=q.draws.length;editor.update({...GUILD,iconVersion:NEW});assert.equal(q.draws.length,before);assert.equal(q.selectors.get('[data-avatar-crop]').hidden,false);
  q.click('save');await tick();assert.equal(payload.method,'PUT');assert.deepEqual(Object.keys(payload.data).sort(),['guildId','image']);assert.equal(payload.data.guildId,GUILD.id);assert.equal(Buffer.from(payload.data.image,'base64').length,4);assert.equal(notified.iconVersion,NEW);assert.match(q.selectors.get('[data-avatar-status]').textContent,/同盟アイコンを保存しました/);
  q.click('remove');await tick();assert.equal(payload.method,'DELETE');assert.deepEqual(JSON.parse(JSON.stringify(payload.data)),{guildId:GUILD.id});assert.equal(notified.iconVersion,null);assert(q.selectors.get('[data-avatar="remove"]').hidden);editor.destroy();
 });
 await test('decode/encode/upload failures preserve safe local state and permit retry',async()=>{
  const q=setup();let attempts=0;q.api.mount(q.host,{guild:GUILD,request:async()=>{attempts++;throw Error('接続を確認してください。');}});q.file('image/svg+xml');assert.equal(q.images.length,0);q.file();q.images[0].onerror();await tick();assert.match(q.selectors.get('[data-avatar-status]').textContent,/読み込めません/);assert(q.revoked.includes(q.images[0].url));
  q.file();q.decode();await tick();q.canvas.toBlob=cb=>cb(null);q.click('save');await tick();assert.equal(attempts,0);assert.match(q.selectors.get('[data-avatar-status]').textContent,/変換できません/);assert.equal(q.selectors.get('[data-avatar-crop]').hidden,false);assert.equal(q.selectors.get('[data-avatar="save"]').disabled,false);
  q.canvas.toBlob=(cb,type)=>cb(new Blob(['jpeg'],{type}));q.click('save');await tick();assert.equal(attempts,1);assert.match(q.selectors.get('[data-avatar-status]').textContent,/接続/);assert.equal(q.selectors.get('[data-avatar-crop]').hidden,false);
 });
 await test('destroy invalidates pending decode/encoding/upload and a wrong-guild reply cannot be applied',async()=>{
  const q=setup();let completed=0,resolve;const editor=q.api.mount(q.host,{guild:GUILD,request:()=>new Promise(r=>{resolve=r;}),onGuild:()=>completed++});q.file();q.decode();await tick();q.click('save');await tick();editor.destroy();resolve({ok:true,guild:{...GUILD,iconVersion:NEW}});await tick();assert.equal(completed,0);assert.equal(q.host.handlers.size,0);assert(q.revoked.length);
  const r=setup(),control=r.api.mount(r.host,{guild:GUILD,request:async()=>({ok:true,guild:{...GUILD,id:'another-guild',iconVersion:NEW}}),onGuild:()=>completed++});r.file();r.decode();await tick();r.click('save');await tick();assert.equal(completed,0);assert.match(r.selectors.get('[data-avatar-status]').textContent,/保存結果/);assert.equal(r.selectors.get('[data-avatar-crop]').hidden,false);control.destroy();
  const x=setup(),last=x.api.mount(x.host,{guild:GUILD,request:async()=>{},onGuild:()=>completed++});x.file();last.destroy();x.decode();await tick();assert.equal(x.draws.length,0);assert.equal(completed,0);
 });
 console.log(`${checks} alliance icon registry/editor groups passed with real avatar.js + alliance-icon.js. No external requests or persistent writes.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
