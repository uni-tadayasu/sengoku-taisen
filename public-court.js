/* Visible current court offices, separate from a player's evaluation rank. */
(function(global){
 'use strict';
 const OFFICES=Object.freeze({太政大臣:'chancellor',天皇:'emperor',参議:'official',中納言:'official',大納言:'official',内大臣:'official',右大臣:'official',左大臣:'official'}),cache=new Map(),versions=new Map();
 let sequence=0,floor=0;
 const validId=value=>typeof value==='string'&&(/^(?:u_)[A-Za-z0-9_]{1,96}$/.test(value)||/^vc_[a-f0-9]{32}$/.test(value));
 const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
 const normalize=value=>value&&typeof value==='object'&&Object.hasOwn(OFFICES,value.title)&&OFFICES[value.title]===value.kind?{title:value.title,kind:value.kind}:null;
 const FIELDS=[['playerId','playerCourtOffice'],['ownerId','ownerCourtOffice'],['authorId','authorCourtOffice'],['targetPlayerId','targetCourtOffice'],['attackerPlayerId','attackerCourtOffice'],['defenderPlayerId','defenderCourtOffice'],['actorPlayerId','actorCourtOffice']];
 const SKIP=new Set(['save','state','entitlements','staffBase','appearance','courtOffice']);
 function refresh(){for(const node of global.document?.querySelectorAll?.('[data-court-player]')||[]){const html=badge(node.dataset.courtPlayer);if(node.innerHTML!==html)node.innerHTML=html;}}
 function update(payload,{requestSequence}={}){
  const revision=Number.isSafeInteger(requestSequence)?requestSequence:++sequence;if(revision<floor)return payload;
  const accept=(id,value)=>{if(revision<(versions.get(id)||0))return;versions.set(id,revision);cache.set(id,normalize(value));};
  function visit(value){
   if(!value||typeof value!=='object')return;
   const id=value.playerId||value.userId||value.id||value.sessionId;if(validId(id)&&Object.hasOwn(value,'courtOffice'))accept(id,value.courtOffice);
   for(const [idKey,officeKey]of FIELDS)if(validId(value[idKey])&&Object.hasOwn(value,officeKey))accept(value[idKey],value[officeKey]);
   for(const [key,child]of Object.entries(value))if(!SKIP.has(key))visit(child);
  }
  visit(payload);refresh();return payload;
 }
 function office(player){
  if(typeof player==='string')return normalize(cache.get(player));
  if(player&&Object.hasOwn(player,'courtOffice'))return normalize(player.courtOffice);
  return normalize(cache.get(player?.playerId||player?.userId||player?.id||player?.sessionId));
 }
 function badge(player){
  const current=office(player);if(!current)return'';
  const title=escape(current.title),kind=current.kind;
  return`<span class="public-court-badge public-court-${kind}" aria-label="役職：${title}" title="役職：${title}"><span class="public-court-title">${title}</span></span>`;
 }
 function slot(player){const id=typeof player==='string'?player:player?.playerId||player?.userId||player?.id||player?.sessionId;return validId(id)?`<span class="public-court-slot" data-court-player="${escape(id)}">${badge(player)}</span>`:badge(player);}
 const api={update,office,badge,slot,refresh,normalize,beginRequest:()=>++sequence,text:player=>office(player)?.title||'',clear(){cache.clear();versions.clear();floor=++sequence;refresh();}};global.SengokuPublicCourt=api;
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
