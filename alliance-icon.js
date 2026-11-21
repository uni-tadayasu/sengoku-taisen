/* Alliance-owned icons are separate from player photos and their registry. */
(function(global){
'use strict';
const groups=new Map(),VERSION=/^[a-f0-9]{64}$/,ID=/^[A-Za-z0-9_-]{1,150}$/;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanVersion=value=>typeof value==='string'&&VERSION.test(value)?value:null;
let sequence=0;
function beginRequest(){return ++sequence;}
function resolve(guild){const id=String(guild?.guildId||guild?.id||''),known=groups.get(id);return{id,name:known?.name||String(guild?.guildName||guild?.name||'同盟'),iconVersion:known?known.iconVersion:cleanVersion(Object.hasOwn(guild||{},'guildIconVersion')?guild.guildIconVersion:guild?.iconVersion)};}
function imageURL(guild){
 if(!ID.test(String(guild?.id||''))||!cleanVersion(guild?.iconVersion))return '';
 try{const base=new URL(String(global.SENGOKU_API_BASE||''));if(!['https:','http:'].includes(base.protocol)||base.username||base.password)return '';return base.href.replace(/\/+$/,'').replace(/\/api\/v1$/,'')+'/api/v1/guild-icons/'+encodeURIComponent(guild.id)+'?v='+guild.iconVersion;}catch(_){return '';}
}
function contents(guild){const letter=esc(Array.from(String(guild?.name||'同盟'))[0]),url=imageURL(guild);return `<span class="social-alliance-initial" aria-hidden="true">${letter}</span>${url?`<img data-alliance-icon-image src="${esc(url)}" width="256" height="256" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">`:''}`;}
function markup(guild,size=''){
 const current=resolve(guild),kind=['small','profile','inline'].includes(size)?size:'',url=imageURL(current);
 return `<span class="social-alliance-icon${kind?' social-alliance-icon-'+kind:''}${url?' has-photo':''}" data-guild-icon="${esc(current.id)}" data-guild-icon-name="${esc(current.name)}" data-guild-icon-version="${esc(current.iconVersion||'')}" aria-hidden="true">${contents(current)}</span>`;
}
// Normalize late metadata in-place before callers store it. A local accepted
// upload is observed with a fresh sequence, so earlier polls cannot undo it.
function observe(payload,{requestSequence}={}){
 const order=Number.isSafeInteger(requestSequence)?requestSequence:beginRequest(),seen=new Set(),skip=new Set(['save','state','entitlements','appearance']);
 const take=(value,id,nameKey,versionKey)=>{id=String(id||'');if(!ID.test(id)||!Object.hasOwn(value,versionKey))return;const prior=groups.get(id),stale=prior&&order<prior.sequence,iconVersion=stale?prior.iconVersion:cleanVersion(value[versionKey]),name=stale?prior.name:String(value[nameKey]||prior?.name||'同盟');value[versionKey]=iconVersion;groups.set(id,{name,iconVersion,sequence:Math.max(order,prior?.sequence||0)});if(groups.size>4096)groups.delete(groups.keys().next().value);};
 const visit=value=>{if(!value||typeof value!=='object'||seen.has(value))return;seen.add(value);take(value,value.guildId,'guildName','guildIconVersion');take(value,value.id,'name','iconVersion');for(const [key,child]of Object.entries(value))if(!skip.has(key))visit(child);};
 visit(payload);refresh();return payload;
}
function refresh(root=global.document){
 const nodes=[...(root?.matches?.('[data-guild-icon]')?[root]:[]),...(root?.querySelectorAll?.('[data-guild-icon]')||[])];
 for(const node of nodes){const guild=groups.get(String(node.dataset.guildIcon));if(!guild)continue;const version=guild.iconVersion||'';if(node.dataset.guildIconVersion===version&&node.dataset.guildIconName===guild.name)continue;node.dataset.guildIconVersion=version;node.dataset.guildIconName=guild.name;const current={id:node.dataset.guildIcon,...guild};node.classList?.toggle('has-photo',Boolean(imageURL(current)));if(global.SengokuStableDOM)global.SengokuStableDOM.patch(node,contents(current));else node.innerHTML=contents(current);}
}
function mount(host,{guild,request,onGuild}={}){
 if(!host||!guild?.id||typeof request!=='function'||!global.SengokuAvatar?.mountPhotoEditor)return{update(){},destroy(){}};
 return global.SengokuAvatar.mountPhotoEditor(host,{user:guild,request,onUser:onGuild,adapter:{title:'同盟アイコン',intro:'端末の写真から、仲間の旗印を。',description:'保存したアイコンは同盟の見出し・一覧・順位に表示され、同盟の全メンバーに共有されます。変更できるのは盟主です。',markup,imageURL,version:value=>value?.iconVersion,result:value=>value?.guild,route:'/guild/icon',data:(current,image)=>({guildId:String(current.id),...(image===undefined?{}:{image})})}});
}
global.document?.addEventListener?.('error',event=>{const image=event.target;if(image?.matches?.('img[data-alliance-icon-image]')){image.hidden=true;image.parentElement?.classList.remove('has-photo');}},true);
global.SengokuAllianceIcon=Object.freeze({markup,mount,imageURL,observe,refresh,beginRequest,resolve});
})(window);
