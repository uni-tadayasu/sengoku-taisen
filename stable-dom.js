/* Source-aware DOM updates: retain mounted controls and artwork across background refreshes. */
(function(global){
 'use strict';
 const states=new WeakMap(),ELEMENT=1,TEXT=3,COMMENT=8;
 const attrs=node=>new Map(Array.from(node.attributes||[],a=>[a.name,a.value]));
 const names=node=>Array.from(node.style||[],name=>[name,node.style.getPropertyValue(name),node.style.getPropertyPriority(name)]);
 const tokens=value=>new Set(String(value||'').split(/\s+/).filter(Boolean));
 const element=node=>node?.nodeType===ELEMENT;
 const tag=node=>String(node.localName||node.nodeName||'').toLowerCase();
 const compatible=(record,node)=>record.type===node.nodeType&&(!element(node)||record.tag===tag(node)&&record.namespace===node.namespaceURI);
 function keyOf(node,source=attrs(node)){
  if(!element(node))return null;
  const t=tag(node),explicit=source.get('id')||source.get('data-stable-key')||source.get('data-key');
  if(explicit)return t+':key:'+explicit;
  for(const attr of ['data-roaming-id','data-covert-target','data-map-marker','data-player-id','data-officer-id'])if(source.has(attr))return t+':'+attr+':'+source.get(attr);
  const action=source.get('data-action')||source.get('data-view')||source.get('data-roaming-action')||source.get('data-covert-action')||source.get('data-rm-action');
  if(action)return t+':action:'+action+':'+['data-id','data-slot','data-kind','data-rm-proposal','data-page'].map(k=>source.get(k)||'').join(':');
  if(source.has('data-id'))return t+':id:'+source.get('data-id');
  if(['input','select','textarea'].includes(t)&&source.has('name'))return t+':name:'+source.get('name');
  if(t==='option')return t+':value:'+(source.get('value')??node.textContent);
  return null;
 }
 function shape(node,source=attrs(node)){
  if(!element(node))return String(node.nodeType);
  const classes=String(source.get('class')||'').split(/\s+/).filter(v=>v&&!/^(?:is-|has-|active$|selected$|open$|disabled$|art-ready$|art-error$|illustrated-item$)/.test(v));
  return tag(node)+':'+classes.slice(0,2).join('.');
 }
 function record(node){const source=element(node)?attrs(node):new Map();return{node,type:node.nodeType,tag:element(node)?tag(node):null,namespace:node.namespaceURI,key:element(node)?keyOf(node,source):null,shape:shape(node,source),attrs:source,styles:element(node)?names(node):[],text:node.nodeValue,children:Array.from(node.childNodes||[],record)};}
 function writeAttribute(node,name,value,stats){if(value===null){if(node.hasAttribute(name)){node.removeAttribute(name);stats.attributes++;}}else if(node.getAttribute(name)!==value){node.setAttribute(name,value);stats.attributes++;}}
 function patchClass(node,before,after,stats){
  const oldTokens=tokens(before),nextTokens=tokens(after),live=tokens(node.getAttribute('class'));
  for(const value of oldTokens)if(!nextTokens.has(value))live.delete(value);
  for(const value of nextTokens)if(!oldTokens.has(value))live.add(value);
  writeAttribute(node,'class',live.size?[...live].join(' '):null,stats);
 }
 function patchStyles(node,before,after,stats){
  const old=new Map(before.map(([key,value,priority])=>[key,[value,priority]])),next=new Map(after.map(([key,value,priority])=>[key,[value,priority]]));
  for(const [key,value]of old)if(!next.has(key)&&node.style.getPropertyValue(key)){node.style.removeProperty(key);stats.attributes++;}
  for(const [key,[value,priority]]of next){const previous=old.get(key);if((!previous||previous[0]!==value||previous[1]!==priority)&&(node.style.getPropertyValue(key)!==value||node.style.getPropertyPriority(key)!==priority)){node.style.setProperty(key,value,priority);stats.attributes++;}}
 }
 function retainInput(node,enabled){
  if(!enabled||!element(node)||!['input','textarea','select'].includes(tag(node)))return null;
  return {value:node.value,checked:node.checked,selected:tag(node)==='select'&&node.multiple?Array.from(node.options||[]).filter(o=>o.selected).map(o=>o.value):null,start:node.selectionStart,end:node.selectionEnd,direction:node.selectionDirection};
 }
 function restoreInput(node,input){
  if(!input)return;
  if(tag(node)==='select'){
   const options=Array.from(node.options||[]);
   if(input.selected){for(const option of options){const next=input.selected.includes(option.value);if(option.selected!==next)option.selected=next;}}
   else if(options.some(option=>option.value===input.value)&&node.value!==input.value)node.value=input.value;
  }else if(node.value!==input.value)node.value=input.value;
  if(typeof input.checked==='boolean'&&node.checked!==input.checked)node.checked=input.checked;
  if(typeof input.start==='number'&&typeof node.setSelectionRange==='function'&&(node.selectionStart!==input.start||node.selectionEnd!==input.end))try{node.setSelectionRange(input.start,input.end,input.direction||'none');}catch(_){}
 }
 function restoreAuthoritativeInput(node,fresh){
  if(!element(node))return 0;let changed=0;
  if(tag(node)==='select'&&fresh.selected){for(const option of Array.from(node.options||[])){const value=fresh.selected.includes(option.value);if(option.selected!==value){option.selected=value;changed++;}}}
  else if(['input','textarea','select'].includes(tag(node))&&node.value!==fresh.value){node.value=fresh.value;changed++;}
  if(tag(node)==='input'&&node.checked!==fresh.checked){node.checked=fresh.checked;changed++;}return changed;
 }
 function matchesIsland(live,fresh,selectors){for(const selector of selectors){try{if(live.matches(selector)||fresh.matches(selector))return true;}catch(_){} }return false;}
 function invalidatePaint(node,stats){
  // Keep the prior loaded surface visible until artwork.reveal paints its new
  // URL. Only this changed image is observed again; unrelated tiles stay ready.
  for(const name of ['data-art-ready','data-art-loading','data-art-observed'])writeAttribute(node,name,null,stats);
  if(node.classList?.contains('art-error'))node.classList.remove('art-error');
  writeAttribute(node,'aria-busy','true',stats);
 }
 function updateGhost(node,stats){
  if(!node.hasAttribute?.('data-ghost-url')||node.hasAttribute('data-ghost-theme'))return;
  const image=node.querySelector?.('[data-art-url]');if(!image)return;
  if(node.getAttribute('data-ghost-url')!==image.getAttribute('data-art-url')){
   // Let the existing decorator choose and observe the new nested artwork.
   // Retain its old CSS image while the replacement is being loaded.
   for(const name of ['data-ghost-url','data-art-enhanced','data-button-art-enhanced','data-art-ready','data-art-loading'])writeAttribute(node,name,null,stats);
  }else{
   for(const [attribute,property]of [['data-art-x','--item-x'],['data-art-y','--item-y']]){const coordinate=image.getAttribute(attribute);if(coordinate!==null&&node.style.getPropertyValue(property)!==coordinate+'%'){node.style.setProperty(property,coordinate+'%');stats.attributes++;}}
  }
 }
 function patchRecord(previous,fresh,options,stats){
  const live=previous.node;
  if(previous.type===TEXT||previous.type===COMMENT){if(previous.text!==fresh.nodeValue&&live.nodeValue!==fresh.nodeValue){live.nodeValue=fresh.nodeValue;stats.text++;}previous.text=fresh.nodeValue;return false;}
  if(!element(live))return false;
  if(matchesIsland(live,fresh,options.selectors))return false;
  const next=attrs(fresh),styles=names(fresh),input=retainInput(live,options.preserveInputs),sourceInput=retainInput(fresh,true),wasOpen=tag(live)==='details'?live.open:null;
  const assetChanged=next.has('data-art-url')&&['data-art-url','data-art-native','data-art-small'].some(name=>previous.attrs.get(name)!==next.get(name)),tileChanged=assetChanged||['data-art-x','data-art-y'].some(name=>previous.attrs.get(name)!==next.get(name));
  for(const name of new Set([...previous.attrs.keys(),...next.keys()])){
   const before=previous.attrs.get(name)??null,after=next.get(name)??null;if(before===after)continue;
   if(name==='class')patchClass(live,before,after,stats);
   else if(name==='style')patchStyles(live,previous.styles,styles,stats);
   else if(name==='open'&&tag(live)==='details'){} // A user-opened section is UI state.
   else writeAttribute(live,name,after,stats);
  }
  // A nested caller may have patched this region since its ancestor rendered.
  // Its most recent records own those children; the ancestor's array is stale.
  const childState=states.get(live),childHTML=childState?fresh.innerHTML:null;
  const childChanged=patchChildren(live,childState?.records||previous.children,Array.from(fresh.childNodes||[]),options,stats);
  if(childState)states.set(live,{...childState,html:childHTML,records:childChanged.records,dirty:false});
  previous.children=childChanged.records;previous.attrs=next;previous.styles=styles;previous.key=keyOf(fresh,next);previous.shape=shape(fresh,next);
  if(input)restoreInput(live,input);else if(options.preserveInputs===false&&sourceInput)stats.attributes+=restoreAuthoritativeInput(live,sourceInput);
  if(wasOpen!==null&&live.open!==wasOpen)live.open=wasOpen;
  if(assetChanged)invalidatePaint(live,stats);
  if(childChanged.artwork)updateGhost(live,stats);
  return tileChanged||childChanged.artwork;
 }
 function rebindMissing(parent,records){
  const known=new Set(records.filter(r=>r.node.parentNode===parent).map(r=>r.node)),candidates=Array.from(parent.childNodes||[]).filter(node=>!known.has(node));
  for(const entry of records){
   if(entry.node.parentNode===parent)continue;
   let index=candidates.findIndex(node=>compatible(entry,node)&&entry.key!==null&&keyOf(node)===entry.key);
   if(index<0&&entry.key===null)index=candidates.findIndex(node=>compatible(entry,node)&&shape(node)===entry.shape);
   if(index>=0){entry.node=candidates.splice(index,1)[0];known.add(entry.node);}
  }
 }
 function patchChildren(parent,oldRecords,freshNodes,options,stats){
  rebindMissing(parent,oldRecords);
  const available=new Set(oldRecords),nextRecords=[];let artwork=false;
  for(const fresh of freshNodes){
   const key=element(fresh)?keyOf(fresh):null,s=shape(fresh);let previous;
   if(key!==null)previous=oldRecords.find(r=>available.has(r)&&r.node.parentNode===parent&&r.key===key&&compatible(r,fresh));
   else previous=oldRecords.find(r=>available.has(r)&&r.node.parentNode===parent&&r.key===null&&r.shape===s&&compatible(r,fresh));
   if(previous){available.delete(previous);artwork=patchRecord(previous,fresh,options,stats)||artwork;nextRecords.push(previous);}
   else {const added=record(fresh);nextRecords.push(added);stats.added++;if(element(fresh)&&(fresh.hasAttribute('data-art-url')||fresh.querySelector?.('[data-art-url]')))artwork=true;}
  }
  for(const obsolete of available)if(obsolete.node.parentNode===parent){obsolete.node.remove();stats.removed++;}
  const managed=new Set(nextRecords.map(r=>r.node));let previousNode=null;
  for(const entry of nextRecords){
   let next=previousNode?previousNode.nextSibling:parent.firstChild;while(next&&!managed.has(next))next=next.nextSibling;
   if(next!==entry.node){const existing=entry.node.parentNode===parent;parent.insertBefore(entry.node,next||null);if(existing)stats.moved++;}
   previousNode=entry.node;
  }
  return{records:nextRecords,artwork};
 }
 function normalizedKey(key){try{return JSON.stringify(key??null);}catch(_){return String(key);}}
 function dirtyAncestors(host){for(let node=host.parentNode;node;node=node.parentNode){const state=states.get(node);if(state)state.dirty=true;}}
 function snapshotScroll(host,records){
  const result=[],seen=new Set(),save=node=>{if(!node||seen.has(node))return;seen.add(node);if(node===host||node.scrollTop||node.scrollLeft)result.push([node,node.scrollTop||0,node.scrollLeft||0]);};
  save(host);const walk=list=>{for(const item of list){if(element(item.node)){save(item.node);walk(item.children);}}};walk(records);
  const scrolling=host.ownerDocument?.scrollingElement;if(scrolling?.contains?.(host))save(scrolling);return result;
 }
 function patch(host,source,settings={}){
  if(!host?.ownerDocument?.createElement)throw TypeError('StableDOM.patch requires a DOM host.');
  const html=String(source??''),key=normalizedKey(settings.key),selectors=Array.isArray(settings.preserveSelectors)?settings.preserveSelectors.filter(v=>typeof v==='string'):typeof settings.preserveSelectors==='string'?[settings.preserveSelectors]:[],preserveInputs=settings.preserveInputs!==false;
  const optionKey=JSON.stringify([preserveInputs,selectors]),previous=states.get(host),stats={changed:false,replaced:false,artwork:false,added:0,removed:0,moved:0,text:0,attributes:0};
  if(previous&&preserveInputs&&!previous.dirty&&previous.key===key&&previous.html===html&&previous.optionKey===optionKey&&previous.records.every(r=>r.node.parentNode===host))return stats;
  const template=host.ownerDocument.createElement('template');template.innerHTML=html;
  const fresh=Array.from(template.content.childNodes),options={selectors,preserveInputs};
  if(!previous||previous.key!==key){
   host.replaceChildren(...fresh);states.set(host,{key,html,optionKey,records:fresh.map(record),dirty:false});dirtyAncestors(host);return{...stats,changed:true,replaced:true,artwork:fresh.some(n=>element(n)&&(n.hasAttribute('data-art-url')||n.querySelector?.('[data-art-url]'))),added:fresh.length};
  }
  const active=host.ownerDocument.activeElement,owned=active&&host.contains(active),focusState=owned?retainInput(active,true):null,scroll=snapshotScroll(host,previous.records);
  const next=patchChildren(host,previous.records,fresh,options,stats);states.set(host,{key,html,optionKey,records:next.records,dirty:false});dirtyAncestors(host);stats.artwork=next.artwork;
  if(owned&&host.contains(active)&&host.ownerDocument.activeElement!==active){active.focus?.({preventScroll:true});restoreInput(active,focusState);}
  for(const [node,top,left]of scroll)if(node===host||host.contains(node)||node===host.ownerDocument.scrollingElement){if(node.scrollTop!==top)node.scrollTop=top;if(node.scrollLeft!==left)node.scrollLeft=left;}
  stats.changed=stats.added+stats.removed+stats.moved+stats.text+stats.attributes>0;return stats;
 }
 const api={patch,forget:host=>states.delete(host)};global.SengokuStableDOM=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
