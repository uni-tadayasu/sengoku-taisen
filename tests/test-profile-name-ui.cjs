/* Synthetic-only regression coverage for the real profile name form and transport. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const premium=require('../premium-runtime.js');
const SOURCE=fs.readFileSync(require.resolve('../social.js'),'utf8');
const copy=value=>JSON.parse(JSON.stringify(value));
function harness(){
 const id='u_'+'1'.repeat(32),token='a'.repeat(64),original={id,name:'元の領主',clan:'織田家',isAdmin:false,isStaff:false,guildId:null,appearance:{nameplate:'gold-banner',town:null,badge:null,ownedProducts:['gold-banner']}};
 const requests=[],notices=[],writes=[],calls={sync:0,premium:0},storage=new Map();let user=copy(original),handler=async url=>url.endsWith('/me')?{ok:true,user:copy(user),friends:[],requests:[]}:{ok:true};
 const input={id:'social-profile-name',value:user.name,disabled:false,isConnected:true},button={disabled:false,isConnected:true};
 const form={id:'social-profile-name-form',dataset:{playerId:id,currentName:user.name},querySelector:selector=>selector==='[name=name]'?input:selector==='[type=submit]'?button:null};input.form=form;
 const feedback={textContent:'',hidden:true,classList:{toggle(){}}},body={innerHTML:'',inert:false};
 const nameSlot={dataset:{premiumPlayer:id,premiumPlayerName:user.name},innerHTML:premium.nameMarkup(user.name,user.appearance)};
 const nodes=new Map([['#social-profile-name-form',form],['[data-profile-name-feedback]',feedback]]),dialog={querySelector:selector=>nodes.get(selector)||null,querySelectorAll:selector=>selector==='[data-premium-player]'?[nameSlot]:[]};
 const scope={console,URL,URLSearchParams,AbortController,crypto:crypto.webcrypto,setTimeout,clearTimeout,
  document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){}},
  FormData:class{constructor(f){this.form=f;}get(key){return key==='name'?this.form.querySelector('[name=name]')?.value:null;}},
  localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>{writes.push({key,value});storage.set(key,value);},removeItem:key=>{writes.push({key});storage.delete(key);}},
  fetch:async(url,options)=>{requests.push({url,options,payload:options.body?JSON.parse(options.body):null});const result=await handler(url,options);return{ok:!result.__status,status:result.__status||200,json:async()=>result};},
  SENGOKU_API_BASE:'https://api.example.invalid',
  SengokuBridge:{setRoleAccess(){},setSyncAccess(){},toast:(message,error)=>notices.push({message,error})},
  SengokuCloudSync:{start(){},stop(){},refresh:async()=>{calls.sync++;},getDevice:()=>({id:'device',name:'確認端末'}),getStatus:()=>({linked:true,ready:true,writable:false})},
  SengokuPremiumRuntime:{...premium,getAppearance:()=>copy(original.appearance),refreshIdentity(){},refresh:async()=>{calls.premium++;},disconnect(){}}
 };
 scope.window=scope;vm.createContext(scope);
 const source=SOURCE.replace('global.SengokuSocial={open','global.__profileTest={s,api,submit,profileView,registerView,normalizedPlayerName,profileNameInput,changeProfileName,applyPlayerEvaluations,installIdentity,acceptUser,loadMe,setUI:(d,b)=>{dialog=d;body=b;}};global.SengokuSocial={open');
 vm.runInContext(source,scope);const t=scope.__profileTest;
 t.s.identity={id,token};t.s.user=copy(user);t.s.connected=true;t.s.tab='profile';t.s.open=true;t.setUI(dialog,body);
 const submit=()=>t.submit({target:form,submitter:button,preventDefault(){}});
 const enter=value=>{input.value=value;t.profileNameInput({target:input});};
 return{scope,t,id,token,original,requests,notices,writes,calls,input,button,form,feedback,nameSlot,body,enter,submit,setHandler:fn=>{handler=fn;},setUser:value=>{user=copy(value);},user:()=>copy(user)};
}
const tests=[];const test=(name,run)=>tests.push({name,run});
const failure=(code,message,status=409)=>({ok:false,__status:status,error:{code,message}});

test('the owner profile shows an escaped current name and registration shares Unicode-aware limits',()=>{
 const h=harness();h.t.s.user.name='<名&旗>';const html=h.t.profileView();
 assert(html.includes('領主名を変更'));assert(html.includes('value="&lt;名&amp;旗&gt;"'));assert(html.includes('data-player-id="'+h.id+'"'));assert(html.includes('1〜24文字'));assert(!html.includes('maxlength="24"'));const identity=h.t.s.identity;h.t.s.identity=null;assert(h.t.registerView().includes('領主名（1〜24文字）'));h.t.s.identity=identity;
 assert.equal(h.t.normalizedPlayerName('  Cafe\u0301  '),'Café');assert.equal(h.t.normalizedPlayerName('家'),'家');assert.equal(h.t.normalizedPlayerName('🏯'.repeat(24)),'🏯'.repeat(24));
 for(const value of ['', '  ','家'.repeat(25),'🏯'.repeat(25),'領\u0000主'])assert.throws(()=>h.t.normalizedPlayerName(value));
});
test('a successful owner-only rename preserves identity, purchases and saved state and refreshes account data',async()=>{
 const h=harness(),before=JSON.stringify(h.t.s.identity),appearance=copy(h.t.s.user.appearance);h.enter('  さくらCafe\u0301  ');
 h.setHandler(async(url,options)=>{if(options.method==='PATCH'){assert(url.endsWith('/profile'));assert.deepEqual(JSON.parse(options.body),{name:'さくらCafé',expectedName:'元の領主'});h.setUser({...h.original,name:'さくらCafé'});return{ok:true,user:h.user()};}assert(url.endsWith('/me'));return{ok:true,user:h.user(),friends:[],requests:[]};});
 await h.submit();assert.equal(h.t.s.user.name,'さくらCafé');assert.equal(h.input.value,'さくらCafé');assert.equal(h.form.dataset.currentName,'さくらCafé');assert.equal(JSON.stringify(h.t.s.identity),before);assert.deepEqual(copy(h.t.s.user.appearance),appearance);assert(h.nameSlot.innerHTML.includes('さくらCafé'));assert(h.nameSlot.innerHTML.includes('data-premium-product="gold-banner"'));assert.equal(h.calls.sync,1);assert.equal(h.calls.premium,1);assert.equal(h.writes.length,0);assert.equal(h.input.disabled,false);assert.equal(h.button.disabled,false);assert(h.feedback.textContent.includes('変更しました'));
});
test('unchanged, invalid or another player form cannot issue a rename request',async()=>{
 const h=harness();h.enter(' 元の領主 ');await h.submit();assert.equal(h.requests.length,0);assert(h.feedback.textContent.includes('同じ'));
 for(const value of ['', '領'.repeat(25),'<\u0000>']){h.enter(value);await h.submit();assert.equal(h.requests.length,0);assert.equal(h.input.value,value);assert.equal(h.button.disabled,false);}
 h.form.dataset.playerId='u_'+'2'.repeat(32);h.enter('変更先');await h.submit();assert.equal(h.requests.length,0);assert.equal(h.t.s.user.name,'元の領主');
});
test('twenty-four emoji are accepted without a UTF-16 maxlength truncating the input',async()=>{
 const h=harness(),name='🏯'.repeat(24);h.enter(name);h.setHandler(async(url,options)=>{if(options.method==='PATCH'){assert.equal(JSON.parse(options.body).name,name);h.setUser({...h.original,name});}return{ok:true,user:h.user(),friends:[],requests:[]};});await h.submit();assert.equal(h.t.s.user.name,name);assert.equal(h.requests.filter(r=>r.options.method==='PATCH').length,1);
});
test('duplicate names keep the draft and current identity while restoring the controls',async()=>{
 const h=harness();h.enter('使用中の領主');h.setHandler(async()=>failure('NAME_TAKEN','その領主名は使用されています。'));await h.submit();assert.equal(h.input.value,'使用中の領主');assert.equal(h.t.s.profileNameEdit.value,'使用中の領主');assert.equal(h.t.s.user.name,'元の領主');assert(h.feedback.textContent.includes('使用されています'));assert.equal(h.input.disabled,false);assert.equal(h.button.disabled,false);assert.equal(h.requests.length,1);assert.equal(h.calls.sync,0);
});
test('a concurrent device rename reloads the current name and never retries an old expectation automatically',async()=>{
 const h=harness();h.enter('希望の名前');let attempts=0;
 h.setHandler(async(url,options)=>{if(options.method==='PATCH'){attempts++;if(attempts===1){h.setUser({...h.original,name:'別端末の名前'});return failure('PROFILE_CHANGED','名前が変更されました。');}assert.equal(JSON.parse(options.body).expectedName,'別端末の名前');h.setUser({...h.original,name:'希望の名前'});}return{ok:true,user:h.user(),friends:[],requests:[]};});
 await h.submit();assert.equal(attempts,1);assert.equal(h.t.s.user.name,'別端末の名前');assert.equal(h.input.value,'希望の名前');assert.equal(h.form.dataset.currentName,'別端末の名前');assert(h.feedback.textContent.includes('別端末の名前'));await h.submit();assert.equal(attempts,2);assert.equal(h.t.s.user.name,'希望の名前');
});
test('one in-flight rename disables both controls and ignores a second submission',async()=>{
 const h=harness();h.enter('新しい領主');let resolve;
 h.setHandler((url,options)=>options.method==='PATCH'?new Promise(r=>{resolve=r;}):Promise.resolve({ok:true,user:h.user(),friends:[],requests:[]}));
 const first=h.submit();assert.equal(h.input.disabled,true);assert.equal(h.button.disabled,true);await h.submit();assert.equal(h.requests.length,1);h.setUser({...h.original,name:'新しい領主'});resolve({ok:true,user:h.user()});await first;assert.equal(h.input.disabled,false);assert.equal(h.button.disabled,false);
});
test('an unknown network outcome can resend the same desired name and expected name safely',async()=>{
 const h=harness();h.enter('再送する領主');let attempts=0;
 h.setHandler(async(url,options)=>{if(options.method==='PATCH'){attempts++;h.setUser({...h.original,name:'再送する領主'});if(attempts===1)throw Error('応答を受け取れませんでした。');}return{ok:true,user:h.user(),friends:[],requests:[]};});
 await h.submit();assert.equal(h.input.value,'再送する領主');assert.equal(h.form.dataset.currentName,'元の領主');assert.equal(h.t.s.user.name,'元の領主');await h.submit();const posts=h.requests.filter(r=>r.options.method==='PATCH');assert.equal(posts.length,2);assert.deepEqual(posts[0].payload,posts[1].payload);assert.equal(h.t.s.user.name,'再送する領主');
});
test('older me and sync responses cannot roll the committed name back',async()=>{
 const h=harness();let resolveOld;h.setHandler((url,options)=>url.includes('/sync?')?new Promise(r=>{resolveOld=r;}):Promise.resolve({ok:true,user:h.user(),friends:[],requests:[]}));const old=h.t.api('/sync?deviceId=device');
 h.enter('確定後の名前');h.setHandler(async(url,options)=>{if(options.method==='PATCH')h.setUser({...h.original,name:'確定後の名前'});return{ok:true,user:h.user(),friends:[],requests:[]};});await h.submit();resolveOld({ok:true,user:copy(h.original)});const result=await old;assert.equal(result.user.name,'確定後の名前');h.t.acceptUser(result.user,{fromSync:true});assert.equal(h.t.s.user.name,'確定後の名前');h.t.s.chats.set('world:',{messages:[{userId:h.id,name:'元の領主',text:'元の領主という言葉は本文に残る'}]});h.t.applyPlayerEvaluations([{playerId:h.id,name:'元の領主'}]);assert.equal(h.t.s.user.name,'確定後の名前');assert.equal(h.t.s.chats.get('world:').messages[0].name,'確定後の名前');assert.equal(h.t.s.chats.get('world:').messages[0].text,'元の領主という言葉は本文に残る');
});
test('late rename responses cannot cross an identity change',async()=>{
 const h=harness();h.enter('以前の本人の希望');let resolve;
 h.setHandler(()=>new Promise(r=>{resolve=r;}));const pending=h.submit();const next={id:'u_'+'2'.repeat(32),name:'別の領主'};h.t.installIdentity({id:next.id,token:'b'.repeat(64)},next);resolve({ok:true,user:{...h.original,name:'以前の本人の希望'}});await pending;assert.equal(h.t.s.user.id,next.id);assert.equal(h.t.s.user.name,'別の領主');assert.equal(h.t.s.identity.token,'b'.repeat(64));assert.equal(h.t.s.profileNameEdit,null);assert.equal(h.calls.sync,0);assert(!h.notices.some(row=>row.message.includes('変更しました')));
});
test('a failed post-commit refresh reports a completed rename without restoring the old name',async()=>{
 const h=harness();h.enter('変更完了');h.setHandler(async(url,options)=>{if(options.method==='PATCH')return{ok:true,user:{...h.original,name:'変更完了'}};throw Error('再取得が一時失敗');});await h.submit();assert.equal(h.t.s.user.name,'変更完了');assert.equal(h.input.value,'変更完了');assert(h.feedback.textContent.includes('領主名を変更しました'));assert.equal(h.input.disabled,false);assert.equal(h.writes.length,0);
});
(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} profile-name UI checks passed. Synthetic data only; no network, storage changes, or purchases.`);})().catch(error=>{console.error(error);process.exitCode=1;});
