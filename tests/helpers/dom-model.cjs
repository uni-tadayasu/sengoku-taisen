'use strict';
// Deterministic DOM fixture shared by source reconciliation and mounted UI tests.
const HTML='http://www.w3.org/1999/xhtml',SVG='http://www.w3.org/2000/svg';
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Style{
 constructor(owner){this.owner=owner;this.map=new Map();}
 [Symbol.iterator](){return this.map.keys();}
 getPropertyValue(name){return this.map.get(name)?.[0]||'';}
 getPropertyPriority(name){return this.map.get(name)?.[1]||'';}
 setProperty(name,value,priority=''){this.map.set(name,[String(value),priority]);this.sync();}
 removeProperty(name){const value=this.getPropertyValue(name);this.map.delete(name);this.sync();return value;}
 sync(){this.owner._attrs.set('style',[...this.map].map(([k,[v,p]])=>k+': '+v+(p?' !'+p:'')+';').join(' '));}
 parse(value){this.map.clear();for(const declaration of value.split(';')){const colon=declaration.indexOf(':');if(colon<0)continue;const name=declaration.slice(0,colon).trim(),raw=declaration.slice(colon+1).trim(),priority=/!important$/.test(raw)?'important':'';if(name)this.map.set(name,[raw.replace(/\s*!important$/,''),priority]);}}
}
class Node{
 constructor(type,name,doc,namespace=HTML){this.nodeType=type;this.nodeName=name;this.localName=type===1?name.toLowerCase():undefined;this.namespaceURI=type===1?namespace:null;this.ownerDocument=doc;this.parentNode=null;this.childNodes=[];this._attrs=new Map();this._events=new Map();this._text='';this._value=undefined;this._checked=undefined;this._selected=undefined;this.scrollTop=0;this.scrollLeft=0;this.selectionStart=null;this.selectionEnd=null;this.selectionDirection='none';this.style=new Style(this);this.dataset=new Proxy({}, {get:(_,key)=>this.getAttribute(dataName(key))??undefined,set:(_,key,value)=>{this.setAttribute(dataName(key),value);return true;},deleteProperty:(_,key)=>{this.removeAttribute(dataName(key));return true;}});this.classList={contains:v=>(this.getAttribute('class')||'').split(/\s+/).includes(v),add:(...values)=>this.setAttribute('class',[...new Set([...(this.getAttribute('class')||'').split(/\s+/).filter(Boolean),...values])].join(' ')),remove:(...values)=>this.setAttribute('class',(this.getAttribute('class')||'').split(/\s+/).filter(v=>v&&!values.includes(v)).join(' '))};}
 get tagName(){return this.nodeType===1?this.localName.toUpperCase():undefined;}
 get id(){return this.getAttribute('id')||'';}
 set id(value){this.setAttribute('id',value);}
 get parentElement(){return this.parentNode?.nodeType===1?this.parentNode:null;}
 get firstElementChild(){return this.childNodes.find(n=>n.nodeType===1)||null;}
 get attributes(){return [...this._attrs].map(([name,value])=>({name,value}));}
 get firstChild(){return this.childNodes[0]||null;}
 get nextSibling(){if(!this.parentNode)return null;return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this)+1]||null;}
 get nodeValue(){return this.nodeType===3||this.nodeType===8?this._text:null;}
 set nodeValue(value){this._text=String(value);}
 get textContent(){return this.nodeType===3||this.nodeType===8?this._text:this.childNodes.map(n=>n.textContent).join('');}
 set textContent(value){if(this.nodeType===3||this.nodeType===8){this._text=String(value);return;}this.replaceChildren(...(value===''?[]:[this.ownerDocument.createTextNode(String(value))]));}
 getAttribute(name){return this._attrs.has(name)?this._attrs.get(name):null;}
 setAttribute(name,value){const before=this.getAttribute(name);this._attrs.set(name,String(value));if(name==='style')this.style.parse(String(value));if(this.isConnected&&before!==String(value))this.ownerDocument.onAttributeChange?.({node:this,name,before,after:String(value)});}
 hasAttribute(name){return this._attrs.has(name);}
 removeAttribute(name){const before=this.getAttribute(name);this._attrs.delete(name);if(name==='style')this.style.map.clear();if(this.isConnected&&before!==null)this.ownerDocument.onAttributeChange?.({node:this,name,before,after:null});}
 appendChild(node){return this.insertBefore(node,null);}
 append(...nodes){nodes.forEach(n=>this.appendChild(n));}
 insertBefore(node,before){if(node===before)return node;if(before&&before.parentNode!==this)throw Error('Invalid reference child');const moving=!!node.parentNode;if(moving){if(node.contains(this.ownerDocument?.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;node.remove();}const index=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(index,0,node);node.parentNode=this;if(this.resetScrollOnInsert)this.scrollTop=0;return node;}
 remove(){if(this.parentNode){if(this.isConnected){this.ownerDocument.onRemove?.(this);if(this.contains(this.ownerDocument.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;}const p=this.parentNode;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const node of [...this.childNodes])node.remove();nodes.forEach(n=>this.appendChild(n));}
 contains(node){return node===this||this.childNodes.some(child=>child.contains(node));}
 get isConnected(){return !!this.ownerDocument?.body?.contains(this);}
 matches(selector,scope=this){return this.nodeType===1&&selector.split(',').some(part=>matchSelector(this,part.trim(),scope));}
 querySelectorAll(selector){const result=[],walk=node=>{for(const c of node.childNodes){if(c.matches(selector,this))result.push(c);walk(c);}};walk(this);return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){for(let n=this;n;n=n.parentElement)if(n.matches(selector))return n;return null;}
 cloneNode(deep=false){const node=new Node(this.nodeType,this.nodeName,this.ownerDocument,this.namespaceURI);node._text=this._text;for(const [name,value]of this._attrs)node.setAttribute(name,value);if(deep)for(const child of this.childNodes)node.appendChild(child.cloneNode(true));return node;}
 insertAdjacentHTML(position,html){const nodes=parse(html,this.ownerDocument);if(position==='afterbegin'){const first=this.firstChild;for(const node of nodes)this.insertBefore(node,first);}else if(position==='beforeend')this.append(...nodes);else throw Error('Unsupported fixture insertion');}
 addEventListener(type,fn){if(!this._events.has(type))this._events.set(type,new Set());this._events.get(type).add(fn);}
 removeEventListener(type,fn){this._events.get(type)?.delete(fn);}
 dispatchEvent(event){event.target??=this;event.preventDefault??=()=>{event.defaultPrevented=true;};for(let n=this;n;n=event.bubbles===false?null:n.parentNode)for(const fn of n._events.get(event.type)||[])fn(event);return !event.defaultPrevented;}
 get disabled(){return this.hasAttribute('disabled');}
 set disabled(value){if(value)this.setAttribute('disabled','');else this.removeAttribute('disabled');}
 focus(){this.ownerDocument.activeElement=this;}
 scrollIntoView(){this.scrollIntoViewCalls=(this.scrollIntoViewCalls||0)+1;}
 getBoundingClientRect(){return{top:0,left:0,bottom:100,right:100,width:100,height:100};}
 setSelectionRange(start,end,direction='none'){this.selectionStart=start;this.selectionEnd=end;this.selectionDirection=direction;}
 get options(){return this.querySelectorAll('option');}
 get multiple(){return this.hasAttribute('multiple');}
 get selected(){return this._selected??this.hasAttribute('selected');}
 set selected(value){this._selected=!!value;}
 get checked(){return this._checked??this.hasAttribute('checked');}
 set checked(value){this._checked=!!value;}
 get value(){if(this.localName==='select'){const options=this.options;return (options.find(o=>o.selected)||options[0])?.value||'';}if(this.localName==='option')return this.getAttribute('value')??this.textContent;return this._value??(this.localName==='textarea'?this.textContent:this.getAttribute('value')||'');}
 set value(value){value=String(value);if(this.localName==='select'){for(const option of this.options)option.selected=option.value===value;}else this._value=value;}
 get open(){return this.hasAttribute('open');}
 set open(value){if(value)this.setAttribute('open','');else this.removeAttribute('open');}
 get innerHTML(){const target=this.localName==='template'?this.content:this;return target.childNodes.map(serialize).join('');}
 set innerHTML(value){const target=this.localName==='template'?this.content:this;target.replaceChildren(...parse(String(value),this.ownerDocument));}
}
const dataName=key=>'data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase());
function matchSelector(node,selector,scope){
 // The fixture implements the selectors used by the production renderer and
 // artwork decorator; it deliberately does not simulate browser layout.
 const relational=selector.match(/^(.*?)(\s*>\s*|\s+)([^\s>]+)$/);
 if(relational){if(!matchSelector(node,relational[3],scope))return false;let parent=node.parentElement;if(relational[2].includes('>'))return !!parent&&matchSelector(parent,relational[1],scope);for(;parent;parent=parent.parentElement)if(matchSelector(parent,relational[1],scope))return true;return false;}
 let valid=true;selector=selector.replace(/:not\(([^()]+)\)/g,(_,excluded)=>{if(matchSelector(node,excluded,scope))valid=false;return'';});
 if(!valid)return false;if(selector.includes(':scope')){if(node!==scope)return false;selector=selector.replace(':scope','');}
 const parts=selector.match(/^[\w*-]+|\.[\w-]+|#[\w-]+|\[[^\]]+\]/g)||[];
 return parts.length>0&&parts.every(part=>{if(part==='*')return true;if(part[0]==='.')return node.classList.contains(part.slice(1));if(part[0]==='#')return node.id===part.slice(1);if(part[0]==='['){const match=part.slice(1,-1).match(/^([^=]+)(?:=["']?([^"']*)["']?)?$/);return match&&node.hasAttribute(match[1])&&(match[2]===undefined||node.getAttribute(match[1])===match[2]);}return node.localName===part;})||selector==='';
}
function serialize(node){if(node.nodeType===3)return node.nodeValue;if(node.nodeType===8)return'<!--'+node.nodeValue+'-->';return'<'+node.localName+node.attributes.map(a=>' '+a.name+'="'+a.value+'"').join('')+'>'+node.childNodes.map(serialize).join('')+'</'+node.localName+'>';}
function parse(source,doc){
 const fragment=new Node(11,'#document-fragment',doc),stack=[fragment],voids=new Set(['input','img','br','hr','meta','link','source','area','wbr']);
 for(const token of source.match(/<!--[\s\S]*?-->|<[^>]+>|[^<]+/g)||[]){
  if(token.startsWith('<!--')){const n=doc.createComment(token.slice(4,-3));stack.at(-1).appendChild(n);continue;}
  if(token.startsWith('</')){stack.pop();continue;}
  if(token.startsWith('<')){const match=token.match(/^<([\w-]+)([\s\S]*?)\/?\s*>$/);if(!match)throw Error('Unsupported fixture HTML');const t=match[1].toLowerCase(),parent=stack.at(-1),node=new Node(1,t,doc,t==='svg'||parent.namespaceURI===SVG?SVG:HTML);const raw=match[2],attributes=/([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;let a;while((a=attributes.exec(raw)))node.setAttribute(a[1],decode(a[2]??a[3]??a[4]??''));parent.appendChild(node);if(!voids.has(t)&&!token.endsWith('/>'))stack.push(node);continue;}
  stack.at(-1).appendChild(doc.createTextNode(decode(token)));
 }
 return [...fragment.childNodes];
}
function setup(){
 const doc={activeElement:null,readyState:'loading',addEventListener(){},createElement(name){const n=new Node(1,name,this);if(name==='template')n.content=new Node(11,'#document-fragment',this);return n;},createTextNode(text){const n=new Node(3,'#text',this);n.nodeValue=text;return n;},createComment(text){const n=new Node(8,'#comment',this);n.nodeValue=text;return n;},querySelectorAll(selector){return this.body.querySelectorAll(selector);},querySelector(selector){return this.body.querySelector(selector);}};
 doc.body=doc.createElement('body');doc.scrollingElement=doc.body;doc.activeElement=doc.body;const host=doc.createElement('main');doc.body.appendChild(host);return{doc,host,$:selector=>host.querySelector(selector)};
}

module.exports={setup,Node,parse,HTML,SVG};
