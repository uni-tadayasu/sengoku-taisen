/* Player-owned photo icons. Only a cropped, metadata-free JPEG leaves this device. */
(function(global){
'use strict';
const SIZE=256,MAX_BYTES=49152,MAX_FILE_BYTES=20*1024*1024;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const people=new Map(),VERSION=/^[a-f0-9]{64}$/,PLAYER=/^[A-Za-z0-9_-]{1,150}$/;
let sequence=0;
const cleanVersion=value=>typeof value==='string'&&VERSION.test(value)?value:null;
function beginRequest(){return ++sequence;}
function current(user){const id=String(user?.playerId||user?.userId||user?.id||''),known=people.get(id);return {id,name:known?.name||String(user?.name||'領主'),avatarVersion:known?known.avatarVersion:cleanVersion(user?.avatarVersion)};}
function imageURL(user){
 if(!user?.id||typeof user.avatarVersion!=='string'||!/^[a-f0-9]{64}$/.test(user.avatarVersion))return '';
 try{const base=new URL(String(global.SENGOKU_API_BASE||''));if(!['https:','http:'].includes(base.protocol)||base.username||base.password)return '';return base.href.replace(/\/+$/,'').replace(/\/api\/v1$/,'')+'/api/v1/avatars/'+encodeURIComponent(user.id)+'?v='+user.avatarVersion;}catch(_){return '';}
}
function contents(user){const letter=esc(Array.from(String(user?.name||'領主'))[0]),url=imageURL(user);return `<span class="social-avatar-initial" aria-hidden="true">${letter}</span>${url?`<img data-avatar-image src="${esc(url)}" width="256" height="256" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">`:''}`;}
function markup(user,size=''){
 const person=current(user),kind=['small','profile','inline'].includes(size)?size:'',cls=kind==='small'?' small':kind==='profile'?' social-avatar-profile':kind==='inline'?' social-avatar-inline':'',url=imageURL(person);
 return `<span class="social-avatar${cls}${url?' has-photo':''}" data-player-avatar="${esc(person.id)}" data-player-avatar-name="${esc(person.name)}" data-avatar-version="${esc(person.avatarVersion||'')}" data-avatar-size="${kind}" aria-hidden="true">${contents(person)}</span>`;
}
// Every accepted API response supplies the current public icon. A request that
// began before a newer response or a local upload cannot restore an old image.
function observe(payload,{requestSequence,pinnedUser}={}){
 const order=Number.isSafeInteger(requestSequence)?requestSequence:beginRequest(),seen=new Set(),skip=new Set(['save','state','entitlements','appearance']),pin=String(pinnedUser?.id||'');
 const take=(value,id,nameKey,versionKey)=>{
  id=String(id||'');if(!PLAYER.test(id)||!Object.hasOwn(value,versionKey))return;
  const prior=people.get(id),pinned=pin===id;
  const avatarVersion=prior&&order<prior.sequence?prior.avatarVersion:cleanVersion(pinned?pinnedUser.avatarVersion:value[versionKey]);
  const nameSequence=prior?.nameSequence??prior?.sequence??0,name=prior&&order<nameSequence?prior.name:String((pinned?pinnedUser.name:null)||value[nameKey]||prior?.name||'領主');
  value[versionKey]=avatarVersion;people.set(id,{name,avatarVersion,sequence:Math.max(order,prior?.sequence||0),nameSequence:Math.max(order,nameSequence)});
  if(people.size>4096)people.delete(people.keys().next().value);
 };
 const visit=value=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);
  take(value,value.playerId||value.userId||value.id,typeof value.name==='string'?'name':'playerName','avatarVersion');
  for(const [idKey,nameKey,versionKey]of [['playerId','playerName','playerAvatarVersion'],['ownerId','ownerName','ownerAvatarVersion'],['authorId','authorName','authorAvatarVersion'],['targetPlayerId','targetName','targetAvatarVersion'],['attackerPlayerId','attackerName','attackerAvatarVersion'],['defenderPlayerId','defenderName','defenderAvatarVersion'],['actorPlayerId','actorName','actorAvatarVersion']])take(value,value[idKey],nameKey,versionKey);
  for(const [key,child]of Object.entries(value))if(!skip.has(key))visit(child);
 };
 visit(payload);refresh();return payload;
}
function rename(user){const id=String(user?.id||'');if(!PLAYER.test(id)||typeof user.name!=='string')return;const prior=people.get(id);people.set(id,{name:user.name,avatarVersion:prior?prior.avatarVersion:cleanVersion(user.avatarVersion),sequence:prior?.sequence||0,nameSequence:beginRequest()});refresh();}
function refresh(root=global.document){
 const nodes=[...(root?.matches?.('[data-player-avatar]')?[root]:[]),...(root?.querySelectorAll?.('[data-player-avatar]')||[])];
 for(const node of nodes){const person=people.get(String(node.dataset.playerAvatar));if(!person)continue;const version=person.avatarVersion||'';if(node.dataset.avatarVersion===version&&node.dataset.playerAvatarName===person.name)continue;
  node.dataset.avatarVersion=version;node.dataset.playerAvatarName=person.name;const user={id:node.dataset.playerAvatar,...person};node.classList?.toggle('has-photo',Boolean(imageURL(user)));if(global.SengokuStableDOM)global.SengokuStableDOM.patch(node,contents(user));else node.innerHTML=contents(user);
 }
}
function cropRect(width,height,zoom=1,x=50,y=50){
 const side=Math.min(width,height)/clamp(Number(zoom)||1,1,3);
 return {x:(width-side)*clamp(Number(x)||0,0,100)/100,y:(height-side)*clamp(Number(y)||0,0,100)/100,width:side,height:side};
}
function canvasJPEG(canvas,quality){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('写真をアイコンに変換できませんでした。別の写真をお試しください。')),'image/jpeg',quality));}
async function encode(canvas){
 for(const quality of [.88,.76,.64,.5]){const blob=await canvasJPEG(canvas,quality);if(blob.type!=='image/jpeg')throw Error('このブラウザーでは写真の変換に対応していません。');if(blob.size<=MAX_BYTES){const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);return global.btoa(binary);}}
 throw Error('写真を小さくできませんでした。別の写真をお試しください。');
}
function mount(host,{user,request,onUser}={}){
 if(!host||!user?.id||typeof request!=='function')return {destroy(){}};
 let disposed=false,operation=0,objectURL=null,photo=null,saving=false,drag=null,current={...user};
 const events=[];
 const listen=(target,event,handler,options)=>{target.addEventListener(event,handler,options);events.push(()=>target.removeEventListener(event,handler,options));};
 host.innerHTML=`<section class="social-profile-section avatar-editor" aria-labelledby="avatar-editor-title"><div class="avatar-editor-heading"><div><h3 id="avatar-editor-title">領主アイコン</h3><p>端末の写真から、あなたの目印を。</p></div><div data-avatar-current>${markup(user,'profile')}</div></div><p class="avatar-editor-description">保存したアイコンは他のプレイヤーにも表示され、同じ領主の端末へ同期されます。</p><input data-avatar-file type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" class="social-sr-only" tabindex="-1" aria-label="領主アイコンにする写真"><div class="social-actions"><button type="button" class="social-button primary" data-avatar="choose">端末の写真を選ぶ</button><button type="button" class="social-button subtle" data-avatar="remove" ${imageURL(user)?'':'hidden'}>標準アイコンに戻す</button></div><div class="avatar-crop" data-avatar-crop hidden><div class="avatar-crop-preview"><canvas width="256" height="256" data-avatar-canvas aria-label="丸い領主アイコンのプレビュー"></canvas><small>ドラッグ・スワイプで位置を調整</small></div><div class="avatar-crop-controls"><label>拡大 <output data-avatar-zoom-label>1.0倍</output><input type="range" data-avatar-zoom min="1" max="3" step="0.05" value="1" aria-label="写真の拡大率"></label><label>左右の位置<input type="range" data-avatar-x min="0" max="100" step="1" value="50" aria-label="写真の左右の位置"></label><label>上下の位置<input type="range" data-avatar-y min="0" max="100" step="1" value="50" aria-label="写真の上下の位置"></label><div class="social-actions"><button type="button" class="social-button primary" data-avatar="save">このアイコンで保存</button><button type="button" class="social-button subtle" data-avatar="cancel">取り消す</button></div></div></div><p data-avatar-status class="avatar-status" role="status" aria-live="polite"></p><p class="avatar-file-help">JPEG・PNG・WebPなどの写真（20MBまで）。写真全体は送らず、選んだ範囲だけを保存します。</p></section>`;
 const el=selector=>host.querySelector(selector),input=el('[data-avatar-file]'),canvas=el('[data-avatar-canvas]'),context=canvas.getContext('2d',{alpha:false}),crop=el('[data-avatar-crop]'),zoom=el('[data-avatar-zoom]'),x=el('[data-avatar-x]'),y=el('[data-avatar-y]'),status=el('[data-avatar-status]');
 function message(text,error=false){if(disposed)return;status.textContent=text;status.classList.toggle('is-error',error);}
 function busy(value){saving=value;for(const button of host.querySelectorAll('button,input[type=range]'))button.disabled=value;host.setAttribute('aria-busy',String(value));}
 function releasePhoto(){if(objectURL)URL.revokeObjectURL(objectURL);objectURL=null;photo=null;drag=null;input.value='';crop.hidden=true;}
 function draw(){if(!photo||disposed)return;const r=cropRect(photo.naturalWidth,photo.naturalHeight,zoom.value,x.value,y.value);context.fillStyle='#17212b';context.fillRect(0,0,SIZE,SIZE);context.drawImage(photo,r.x,r.y,r.width,r.height,0,0,SIZE,SIZE);el('[data-avatar-zoom-label]').value=Number(zoom.value).toFixed(1)+'倍';}
 async function choose(file){
  if(!file||saving||disposed)return;const sequence=++operation;releasePhoto();
  if(file.size<=0||file.size>MAX_FILE_BYTES){message('20MB以内の写真を選んでください。',true);return;}
  if(!/^image\/(?:jpeg|png|webp|heic|heif)$/i.test(file.type)){message('JPEG・PNG・WebP形式の写真を選んでください。',true);return;}
  message('写真を読み込んでいます…');
  const url=URL.createObjectURL(file);objectURL=url;const next=new Image();
  try{await new Promise((resolve,reject)=>{next.onload=resolve;next.onerror=()=>reject(Error('この写真を読み込めませんでした。JPEG・PNG・WebPに変換した写真をお試しください。'));next.src=url;});
   if(disposed||sequence!==operation)return;
   if(!next.naturalWidth||!next.naturalHeight||next.naturalWidth*next.naturalHeight>64000000)throw Error('写真の解像度が大きすぎます。小さくした写真を選んでください。');
   photo=next;zoom.value='1';x.value=y.value='50';crop.hidden=false;draw();message('丸い枠で仕上がりを確認してから保存してください。');
  }catch(error){if(!disposed&&sequence===operation){releasePhoto();message(error.message,true);}}
 }
 async function save(){
  if(!photo||saving||disposed)return;const sequence=++operation;busy(true);message('アイコンを保存しています…');
  try{const image=await encode(canvas);if(disposed||sequence!==operation)return;const result=await request('/me/avatar',{method:'PUT',data:{image}});if(disposed||sequence!==operation)return;if(String(result.user?.id)!==String(current.id)||!imageURL(result.user))throw Error('保存結果を確認できませんでした。もう一度お試しください。');current={...result.user};releasePhoto();el('[data-avatar-current]').innerHTML=markup(current,'profile');el('[data-avatar="remove"]').hidden=false;message('領主アイコンを保存しました。');onUser?.(result.user);
  }catch(error){if(!disposed&&sequence===operation&&error.code!=='STALE_IDENTITY')message(error.message||'アイコンを保存できませんでした。',true);}
  finally{if(!disposed&&sequence===operation)busy(false);}
 }
 async function remove(){
  if(saving||disposed)return;const sequence=++operation;busy(true);message('標準アイコンに戻しています…');
  try{const result=await request('/me/avatar',{method:'DELETE'});if(disposed||sequence!==operation)return;if(String(result.user?.id)!==String(current.id)||result.user.avatarVersion)throw Error('変更結果を確認できませんでした。');current={...result.user};releasePhoto();el('[data-avatar-current]').innerHTML=markup(current,'profile');el('[data-avatar="remove"]').hidden=true;message('標準アイコンに戻しました。');onUser?.(result.user);
  }catch(error){if(!disposed&&sequence===operation&&error.code!=='STALE_IDENTITY')message(error.message||'アイコンを変更できませんでした。',true);}
  finally{if(!disposed&&sequence===operation)busy(false);}
 }
 listen(input,'change',()=>choose(input.files?.[0]));
 listen(host,'click',event=>{const button=event.target.closest('[data-avatar]');if(!button||!host.contains(button)||saving)return;event.preventDefault();const action=button.dataset.avatar;if(action==='choose')input.click();if(action==='save')save();if(action==='remove')remove();if(action==='cancel'){operation++;releasePhoto();message('変更を取り消しました。');}});
 for(const range of [zoom,x,y])listen(range,'input',draw);
 listen(canvas,'pointerdown',event=>{if(!photo||saving||event.button!==0)return;const r=cropRect(photo.naturalWidth,photo.naturalHeight,zoom.value,x.value,y.value);drag={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:r.x,y:r.y,side:r.width};canvas.setPointerCapture?.(event.pointerId);});
 listen(canvas,'pointermove',event=>{if(!drag||drag.pointerId!==event.pointerId||!photo||saving)return;const width=canvas.getBoundingClientRect().width||SIZE,dx=(event.clientX-drag.startX)*drag.side/width,dy=(event.clientY-drag.startY)*drag.side/width;const maxX=photo.naturalWidth-drag.side,maxY=photo.naturalHeight-drag.side;x.value=String(maxX?clamp((drag.x-dx)/maxX*100,0,100):50);y.value=String(maxY?clamp((drag.y-dy)/maxY*100,0,100):50);draw();});
 listen(canvas,'pointerup',()=>{drag=null;});listen(canvas,'pointercancel',()=>{drag=null;});
 return {
  update(next){if(disposed||!next||String(next.id)!==String(current.id)||saving)return;if(next.avatarVersion===current.avatarVersion&&next.name===current.name)return;current={...next};el('[data-avatar-current]').innerHTML=markup(current,'profile');el('[data-avatar="remove"]').hidden=!imageURL(current);},
  destroy(){if(disposed)return;disposed=true;operation++;releasePhoto();for(const stop of events)stop();host.removeAttribute('aria-busy');}
 };
}
document.addEventListener('error',event=>{const image=event.target;if(image?.matches?.('img[data-avatar-image]')){image.hidden=true;image.parentElement?.classList.remove('has-photo');}},true);
global.SengokuAvatar=Object.freeze({markup,mount,imageURL,observe,refresh,beginRequest,resolve:current,rename});
})(window);
