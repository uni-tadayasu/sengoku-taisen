/* Visible current court offices, separate from a player's evaluation rank. */
(function(global){
 'use strict';
 // The same eight offices are issued by the Kyoto court. The seal artwork is
 // purely presentational and never grants or infers an appointment.
 const OFFICES=Object.freeze({
  参議:{kind:'official',seal:'fan',art:'<path d="M3 9q9-9 18 0l-9 12Z M7 7l5 14 5-14 M12 5v16"/>'},
  中納言:{kind:'official',seal:'scroll',art:'<path d="M5 4h12a2 2 0 0 1 2 2v2h-4V6a2 2 0 0 1 2-2 M5 4a2 2 0 0 0-2 2v11h11a2 2 0 0 0 0 4H5a2 2 0 0 1-2-2 M15 8v7 M6 9h6 M6 12h5"/>'},
  大納言:{kind:'official',seal:'book',art:'<path d="M12 7C9 4 6 4 3 5v13c4-1 7 0 9 3 2-3 5-4 9-3V5c-3-1-6-1-9 2v14 M6 9l3 1 M15 10l3-1"/>'},
  内大臣:{kind:'official',seal:'gate',art:'<path d="m2 10 10-6 10 6 M4 11h16 M6 12v6 M18 12v6 M10 12v6 M14 12v6 M3 20h18"/>'},
  右大臣:{kind:'official',seal:'feather',art:'<path d="M4 20 18 6 M7 17c-1-7 4-13 14-14-1 9-6 16-14 14Z M11 13v-4 M11 13h5"/>'},
  左大臣:{kind:'official',seal:'pine',art:'<path d="M12 21v-8 m-1 5-5-4 M13 15l5-4 M6 9 2 13h8L6 9Z M17 6l-5 5h10l-5-5Z M11 2 7 6h8l-4-4Z"/>'},
  太政大臣:{kind:'chancellor',seal:'stamp',art:'<path d="M8 11V9c0-2 2-2 2-4a2 2 0 0 1 4 0c0 2 2 2 2 4v2 M5 12h14v5H5z M3 20h18 M9 15h6"/>'},
  天皇:{kind:'emperor',seal:'sun',art:'<circle cx="12" cy="12" r="4"/><path d="M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2"/>'}
 });
 const cache=new Map(),versions=new Map();
 let sequence=0,floor=0;
 const validId=value=>typeof value==='string'&&(/^(?:u_)[A-Za-z0-9_]{1,96}$/.test(value)||/^vc_[a-f0-9]{32}$/.test(value));
 const playerId=player=>typeof player==='string'?player:player?.playerId||player?.userId||player?.id||player?.sessionId;
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const normalize=value=>value&&typeof value==='object'&&typeof value.title==='string'&&Object.hasOwn(OFFICES,value.title)&&OFFICES[value.title].kind===value.kind?{title:value.title,kind:value.kind}:null;
 const FIELDS=[['playerId','playerCourtOffice'],['ownerId','ownerCourtOffice'],['authorId','authorCourtOffice'],['targetPlayerId','targetCourtOffice'],['attackerPlayerId','attackerCourtOffice'],['defenderPlayerId','defenderCourtOffice'],['actorPlayerId','actorCourtOffice'],['lordPlayerId','lordCourtOffice'],['previousLordPlayerId','previousLordCourtOffice']];
 const SKIP=new Set(['save','state','entitlements','staffBase','appearance','courtOffice']);
 function refresh(){
  for(const node of global.document?.querySelectorAll?.('[data-court-player]')||[]){
   const id=node.dataset.courtPlayer,current=node.dataset.courtSelf==='true'?selfOffice(id):office(id);
   // Keep the mounted artwork and its fallback state on unchanged polls.
   if(current&&node.childNodes?.length===1&&node.firstElementChild?.dataset?.courtSeal===OFFICES[current.title].seal)continue;
   if(!current&&node.childNodes?.length===0)continue;
   const html=current?badgeTitle(current.title):'';
   // This slot owns its entire contents. Record replacements so its parent
   // can reconcile the same badge after the asynchronously loaded office arrives.
   const stable=global.SengokuStableDOM;
   if(stable){
    stable.forget(node);
    stable.patch(node,html);
   }else if(node.innerHTML!==html)node.innerHTML=html;
  }
 }
 function update(payload,{requestSequence}={}){
  const revision=Number.isSafeInteger(requestSequence)?requestSequence:++sequence;if(revision<floor)return payload;
  const accept=(id,value)=>{if(revision<(versions.get(id)||0))return;versions.set(id,revision);cache.set(id,normalize(value));};
  function visit(value){
   if(!value||typeof value!=='object')return;
   const id=value.playerId||value.userId||value.id||value.sessionId;if(validId(id)&&Object.hasOwn(value,'courtOffice'))accept(id,value.courtOffice);
   for(const [idKey,officeKey]of FIELDS)if(validId(value[idKey])&&Object.hasOwn(value,officeKey))accept(value[idKey],value[officeKey]);
   for(const [key,child]of Object.entries(value))if(!SKIP.has(key))visit(child);
  }
  visit(payload);
  // Only the explicit shared base DTO carries verified construction owners.
  // Local saves and their nested projections remain outside the identity cache.
  const jobs=payload?.staffBase?.jobs;
  if(Array.isArray(jobs))for(const job of jobs){const owner=job?.startedBy;if(validId(owner?.id)&&Object.hasOwn(owner,'courtOffice'))accept(owner.id,owner.courtOffice);}
  refresh();return payload;
 }
 function office(player){
  if(typeof player==='string')return normalize(cache.get(player));
  if(player&&Object.hasOwn(player,'courtOffice'))return normalize(player.courtOffice);
  return normalize(cache.get(playerId(player)));
 }
 function badgeTitle(title){
  if(typeof title!=='string'||!Object.hasOwn(OFFICES,title))return '';
  const {kind,seal,art}=OFFICES[title];
  const relief=`<img class="public-court-relief" src="assets/court-badges/${seal}-relief.webp" width="24" height="24" alt="" decoding="async" loading="lazy" draggable="false">`;
  const linework=`<svg class="public-court-linework" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round">${art}</svg>`;
  const icon=`<span class="public-court-icon" data-stable-key="court-seal-${seal}" aria-hidden="true">${relief}${linework}</span>`;
  return `<span class="public-court-badge public-court-${kind}" data-court-seal="${seal}" role="img" aria-label="役職：${title}" title="役職：${title}">${icon}<span class="public-court-title">${title}</span></span>`;
 }
 // Resource errors do not bubble. Capture them once for every newly mounted
 // office, so an uncached badge still has its own seal when playing offline.
 global.document?.addEventListener?.('error',event=>{
  if(event.target?.matches?.('img.public-court-relief'))event.target.hidden=true;
 },true);
 function badge(player){const current=office(player);return current?badgeTitle(current.title):'';}
 function slot(player){const id=playerId(player);return validId(id)?`<span class="public-court-slot" data-court-player="${escape(id)}">${badge(player)}</span>`:badge(player);}
 // Self badges follow the verified current connection, never an old campaign,
 // cached role flag, or a caller-supplied office on an arbitrary player object.
 function selfOffice(player){const id=playerId(player),current=global.SengokuSocial?.getPublicCourtIdentity?.();return validId(id)&&id===current?office(id):null;}
 function selfBadge(player){return badge({courtOffice:selfOffice(player)});}
 function selfSlot(player){const id=playerId(player);return validId(id)?`<span class="public-court-slot public-court-self" data-court-player="${escape(id)}" data-court-self="true">${selfBadge(id)}</span>`:'';}
 function forget(player){const id=playerId(player);if(!validId(id))return;versions.set(id,++sequence);cache.delete(id);refresh();}
 const api={update,office,badge,badgeTitle,slot,selfOffice,selfBadge,selfSlot,selfText:player=>selfOffice(player)?.title||'',forget,refresh,normalize,beginRequest:()=>++sequence,text:player=>office(player)?.title||'',clear(){cache.clear();versions.clear();floor=++sequence;refresh();}};global.SengokuPublicCourt=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
