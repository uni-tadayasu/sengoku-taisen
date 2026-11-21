'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const text=fs.readFileSync(path.join(__dirname,'../avatar.js'),'utf8').replace('global.SengokuAvatar=Object.freeze({markup,mount,imageURL});','global.SengokuAvatar=Object.freeze({markup,mount,imageURL});global.testAvatar={cropRect,encode};');
class Element {
 constructor(){this.handlers=new Map();this.value='';this.hidden=false;this.disabled=false;this.innerHTML='';this.textContent='';this.classList={toggle(){},remove(){}};this.dataset={};}
 addEventListener(type,handler){this.handlers.set(type,handler);}
 removeEventListener(type,handler){if(this.handlers.get(type)===handler)this.handlers.delete(type);}
 setAttribute(){}removeAttribute(){}click(){this.clicked=true;}contains(){return true;}
 emit(type,event={}){this.handlers.get(type)?.(event);}
}
function setup(){
 const images=[],revoked=[],draws=[],doc=new Element();let objectId=0;
 class Image {constructor(){images.push(this);}set src(value){this.url=value;}}
 const window={SENGOKU_API_BASE:'https://game.example/api/v1',btoa:s=>Buffer.from(s,'binary').toString('base64')};
 const context={window,document:doc,URL:Object.assign(URL,{createObjectURL:()=>`blob:qa-${++objectId}`,revokeObjectURL:url=>revoked.push(url)}),Image,Uint8Array,Blob,console};vm.runInNewContext(text,context);
 const host=new Element(),selectors=new Map(),ranges=[];
 for(const key of ['file','canvas','crop','zoom','x','y','status','current','zoom-label'])selectors.set(`[data-avatar-${key}]`,new Element());
 for(const key of ['choose','save','cancel','remove'])selectors.set(`[data-avatar="${key}"]`,new Element());
 const canvas=selectors.get('[data-avatar-canvas]');canvas.getContext=()=>({fillRect(){},drawImage(...args){draws.push(args);}});canvas.getBoundingClientRect=()=>({width:256});canvas.setPointerCapture=()=>{};canvas.toBlob=(cb,type)=>cb(new Blob([new Uint8Array([255,216,255,217])],{type}));
 for(const key of ['zoom','x','y'])ranges.push(selectors.get(`[data-avatar-${key}]`));
 host.querySelector=s=>selectors.get(s);host.querySelectorAll=()=>[...selectors.values()];
 const click=action=>{const target=selectors.get(`[data-avatar="${action}"]`);target.dataset.avatar=action;target.closest=()=>target;host.emit('click',{target,preventDefault(){}});};
 const file=(type='image/jpeg',size=5000)=>{const input=selectors.get('[data-avatar-file]');input.files=[{type,size}];input.emit('change');};
 return{api:window.SengokuAvatar,test:window.testAvatar,window,host,selectors,images,revoked,draws,click,file};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
let checks=0;function pass(){checks++;}
(async()=>{
 const q=setup(),user={id:'u_photo',name:'<script>城主</script>',avatarVersion:'a'.repeat(64)};
 assert.equal(q.api.imageURL(user),'https://game.example/api/v1/avatars/u_photo?v='+'a'.repeat(64));assert(q.api.markup(user).includes('&lt;'));assert(!q.api.markup(user).includes('<script>'));assert(q.api.markup(user,'profile').includes('social-avatar-profile'));assert(q.api.markup(user,'" onclick="bad').includes('class="social-avatar has-photo"'));pass();
 for(const version of ['javascript:alert(1)','" onerror="alert(1)','a'.repeat(63),'A'.repeat(64),null])assert.equal(q.api.imageURL({...user,avatarVersion:version}),'');
 q.window.SENGOKU_API_BASE='javascript:alert(1)';assert.equal(q.api.imageURL(user),'');q.window.SENGOKU_API_BASE='https://secret@example.com';assert.equal(q.api.imageURL(user),'');q.window.SENGOKU_API_BASE='https://game.example';pass();
 for(const [width,height] of [[100,300],[300,100],[4000,3000]])for(const zoom of [1,1.5,3])for(const x of [0,50,100])for(const y of [0,50,100]){const r=q.test.cropRect(width,height,zoom,x,y);assert(r.x>=0&&r.y>=0);assert(r.x+r.width<=width+1e-6&&r.y+r.height<=height+1e-6);assert.equal(r.width,r.height);}pass();
 const quality=[];const encoded=await q.test.encode({toBlob(cb,type,value){quality.push(value);cb(new Blob([new Uint8Array(value>.7?60000:40000)],{type}));}});assert.equal(Buffer.from(encoded,'base64').length,40000);assert.deepEqual(quality,[.88,.76,.64]);await assert.rejects(q.test.encode({toBlob(cb){cb(new Blob(['wrong'],{type:'image/png'}));}}),/変換/);pass();
 let saved=0,requests=0,resolveSave;const editor=q.api.mount(q.host,{user,request:()=>{requests++;return new Promise(resolve=>{resolveSave=resolve;});},onUser:()=>{saved++;}});
 q.file('image/svg+xml');assert.match(q.selectors.get('[data-avatar-status]').textContent,/JPEG/);assert.equal(q.images.length,0);q.file('image/jpeg',20*1024*1024+1);assert.equal(q.images.length,0);assert.match(q.selectors.get('[data-avatar-status]').textContent,/20MB/);pass();
 q.file();const first=q.images[0];q.file();const second=q.images[1];second.naturalWidth=1600;second.naturalHeight=1200;second.onload();await tick();assert.equal(q.draws.at(-1)[0],second);first.naturalWidth=800;first.naturalHeight=600;first.onload();await tick();assert.equal(q.draws.at(-1)[0],second,'A late photo decode cannot replace a newer selection');assert(q.revoked.includes(first.url));const beforeUpdate=q.draws.length;editor.update({...user,avatarVersion:'b'.repeat(64)});assert.equal(q.draws.length,beforeUpdate);assert.equal(q.selectors.get('[data-avatar-crop]').hidden,false,'Cross-device photo metadata keeps an unfinished crop');assert(q.selectors.get('[data-avatar-current]').innerHTML.includes('b'.repeat(64)));pass();
 q.click('save');await tick();assert.equal(requests,1);assert.equal(saved,0);editor.destroy();resolveSave({ok:true,user});await tick();assert.equal(saved,0,'Closing or changing identity must discard a pending result');assert(q.revoked.includes(second.url));assert.equal(q.host.handlers.size,0);pass();
 const r=setup();let payload,notified;
 const control=r.api.mount(r.host,{user,request:async(route,options)=>{assert.equal(route,'/me/avatar');payload=options;return{ok:true,user:options.method==='DELETE'?{...user,avatarVersion:null}:user};},onUser:u=>{notified=u;}});
 r.file();r.images[0].naturalWidth=1000;r.images[0].naturalHeight=700;r.images[0].onload();await tick();r.click('save');await tick();assert.equal(payload.method,'PUT');assert.deepEqual(Object.keys(payload.data),['image']);assert.equal(Buffer.from(payload.data.image,'base64').length,4);assert.equal(notified.id,user.id);assert.equal(r.selectors.get('[data-avatar-crop]').hidden,true);assert.match(r.selectors.get('[data-avatar-status]').textContent,/保存しました/);pass();
 r.click('remove');await tick();assert.equal(payload.method,'DELETE');assert.equal(notified.avatarVersion,null);assert.equal(r.selectors.get('[data-avatar="remove"]').hidden,true);control.destroy();pass();
 const s=setup();s.api.mount(s.host,{user,request:async()=>{throw Error('接続できません');}});s.file();s.images[0].naturalWidth=300;s.images[0].naturalHeight=300;s.images[0].onload();await tick();s.click('save');await tick();assert.equal(s.selectors.get('[data-avatar-crop]').hidden,false,'A failed upload retains the crop for a retry');assert.match(s.selectors.get('[data-avatar-status]').textContent,/接続できません/);assert.equal(s.selectors.get('[data-avatar="save"]').disabled,false);pass();
 console.log(`Avatar tests passed: ${checks} meaningful groups (safe image URLs/escaping, crop bounds, JPEG limit, file validation, decode race, disposal, own-user upload/reset and retry). No network requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
