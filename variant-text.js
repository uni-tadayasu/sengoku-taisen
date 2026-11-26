/* Preserve ideographic variation sequences without changing player text. */
(function(root,factory){
 'use strict';
 const api=factory(root);
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root){root.SengokuVariants=api;const doc=root.document;if(doc){const start=()=>{if(!api.instance)api.instance=api.create({document:doc});};if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',start,{once:true});else start();}}
})(typeof window!=='undefined'?window:null,function(root){
 'use strict';
 const VARIANT=/[\u3006\u3007\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{323af}][\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/u;
 const VARIANTS=/[\u3006\u3007\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{323af}][\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;
 const EXTENDER=/[\p{Mark}\ufe00-\ufe0f\u{e0100}-\u{e01ef}\u{1f3fb}-\u{1f3ff}]/u;
 const SKIP=new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','TITLE']);
 const FIELD=new Set(['INPUT','TEXTAREA','SELECT','OPTION']);
 const SVG='http://www.w3.org/2000/svg',MARK='data-sengoku-variant-glyph',FIELD_MARK='data-sengoku-variant-field';
 let segmenter;
 try{if(typeof Intl!=='undefined'&&Intl.Segmenter)segmenter=new Intl.Segmenter('ja',{granularity:'grapheme'});}catch{}
 const str=value=>String(value??'');
 function fallbackGraphemes(value){
  const groups=[];let join=false,regional=0;
  for(const ch of str(value)){
   const cp=ch.codePointAt(0),isRegional=cp>=0x1f1e6&&cp<=0x1f1ff;
   if(groups.length&&(join||EXTENDER.test(ch)||ch==='\u200d'||(isRegional&&regional%2===1)||(ch==='\n'&&groups.at(-1)==='\r')))groups[groups.length-1]+=ch;
   else groups.push(ch);
   join=ch==='\u200d';regional=isRegional?regional+1:0;
  }
  return groups;
 }
 function firstGrapheme(value){const text=str(value);if(!text)return'';return segmenter?segmenter.segment(text)[Symbol.iterator]().next().value.segment:fallbackGraphemes(text)[0]||'';}
 function graphemeCount(value){return segmenter?Array.from(segmenter.segment(str(value))).length:fallbackGraphemes(value).length;}
 function hasVariant(value){return VARIANT.test(str(value));}
 function parts(value){
  const text=str(value),result=[];let last=0;
  for(const match of text.matchAll(VARIANTS)){if(match.index>last)result.push({text:text.slice(last,match.index),variant:false});result.push({text:match[0],variant:true});last=match.index+match[0].length;}
  if(last<text.length)result.push({text:text.slice(last),variant:false});
  return result;
 }
 function create(options={}){
  const doc=options.document||root?.document;
  if(!doc)return{refresh(){},dispose(){}};
  const Observer=options.MutationObserver||root?.MutationObserver;
  const request=options.requestAnimationFrame||root?.requestAnimationFrame?.bind(root)||((fn)=>setTimeout(fn,0));
  const cancel=options.cancelAnimationFrame||root?.cancelAnimationFrame?.bind(root)||clearTimeout;
  const pending=new Map();let ticket=null,disposed=false;
  const connected=node=>node&&(node.isConnected!==false||node===doc.body);
  const tag=node=>String(node?.localName||node?.tagName||'').toUpperCase();
  const editable=node=>node?.hasAttribute?.('contenteditable')&&['','true','plaintext-only'].includes(String(node.getAttribute('contenteditable')).toLowerCase());
  function mark(node,attribute,enabled){
   if(enabled&&!node.hasAttribute(attribute))node.setAttribute(attribute,'');
   if(!enabled&&node.hasAttribute(attribute))node.removeAttribute(attribute);
  }
  function fieldOwner(node){
   let option=null;
   for(let element=node?.nodeType===1?node:node?.parentElement;element;element=element.parentElement){
    const name=tag(element);
    if(name==='OPTION'||name==='OPTGROUP'){option=element;continue;}
    if(FIELD.has(name)||editable(element))return element;
   }
   return option;
  }
  function field(node){
   const name=tag(node);
   let value=FIELD.has(name)&&!['OPTION','OPTGROUP'].includes(name)?node.value:node.textContent;
   // Native popup menus do not consistently honor per-option font rules. Use
   // the fallback for this control if any visible choice needs an IVS glyph.
   if(name==='SELECT')value=Array.from(node.options||[]).map(option=>option.getAttribute('label')||option.textContent).join(' ')+Array.from(node.querySelectorAll('optgroup[label]')).map(group=>group.getAttribute('label')).join(' ');
   if(name==='OPTION'||name==='OPTGROUP')value=node.getAttribute('label')||value;
   mark(node,FIELD_MARK,hasVariant(value)||hasVariant(node.getAttribute('placeholder')));
   mark(node,MARK,false);
   for(const child of node.querySelectorAll('['+MARK+']'))mark(child,MARK,false);
  }
  function excluded(node){
   for(let element=node?.nodeType===1?node:node?.parentElement;element;element=element.parentElement){
    if(SKIP.has(tag(element))||element.hasAttribute('data-sengoku-variant-skip'))return true;
   }
   return false;
  }
  function directVariant(node){
   let run='';
   for(const child of node.childNodes||[]){
    if(child.nodeType===3)run+=child.nodeValue;
    else{if(hasVariant(run))return true;run='';}
   }
   return hasVariant(run);
  }
  function refreshElement(node){
   if(node?.nodeType!==1)return false;
   const owner=fieldOwner(node);
   if(owner){field(owner);return false;}
   mark(node,FIELD_MARK,false);
   const skip=excluded(node),svg=node.namespaceURI===SVG;
   // Source-aware rendering keeps references to text nodes. Never wrap, split,
   // move or replace them: a font attribute on the smallest text parent keeps
   // later name changes, event handlers, selections and SVG labels intact.
   mark(node,MARK,!skip&&(!svg||['text','tspan','textpath'].includes(String(node.localName).toLowerCase()))&&directVariant(node));
   return !skip;
  }
  function refresh(node=doc.body){
   if(disposed||!node)return;
   if(node.nodeType===3){refreshElement(node.parentElement);return;}
   if(node.nodeType!==1&&node.nodeType!==11&&node.nodeType!==9)return;
   if(node.nodeType===1&&!refreshElement(node))return;
   for(const child of node.childNodes||[])if(child.nodeType!==3)refresh(child);
  }
  function flush(){
   ticket=null;if(disposed)return;const batch=new Map(pending);pending.clear();
   for(const [node,deep]of batch){
    if(!connected(node))continue;
    let covered=false;for(let parent=node.parentNode;parent;parent=parent.parentNode)if(batch.get(parent)){covered=true;break;}
    if(!covered){if(deep)refresh(node);else refreshElement(node);}
   }
  }
  function schedule(node,deep=true){
   if(disposed||!node)return;
   const owner=fieldOwner(node);
   if(owner){node=owner;deep=false;}else if(node.nodeType===3){node=node.parentElement;deep=false;}
   if(!node)return;
   pending.set(node,deep||pending.get(node)||false);
   if(ticket===null)ticket=request(flush);
  }
  function onInput(event){const owner=fieldOwner(event.target);if(owner)field(owner);}
  // Reset fires before native field values change, so inspect in the next frame.
  function onReset(event){schedule(event.target);}
  const observer=Observer?new Observer(records=>{for(const record of records){
   if(record.type==='childList'){schedule(record.target,false);for(const node of record.addedNodes||[])schedule(node);}
   else schedule(record.target,record.type==='attributes'&&record.attributeName==='contenteditable');
  }}):null;
  refresh();
  observer?.observe(doc.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['value','placeholder','label','selected','contenteditable']});
  for(const type of ['input','change','focusin'])doc.addEventListener(type,onInput,true);
  doc.addEventListener('reset',onReset,true);
  return{refresh,dispose(){if(disposed)return;disposed=true;observer?.disconnect();if(ticket!==null)cancel(ticket);pending.clear();for(const type of ['input','change','focusin'])doc.removeEventListener(type,onInput,true);doc.removeEventListener('reset',onReset,true);}};
 }
 return{firstGrapheme,graphemeCount,hasVariant,parts,fallbackGraphemes,create};
});
