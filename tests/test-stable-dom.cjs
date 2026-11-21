'use strict';
// Deterministic DOM model for reconciliation and retention behavior. Browser QA is separate.
const assert=require('node:assert/strict'),{patch,forget}=require('../stable-dom.js');
const tests=[],test=(name,run)=>tests.push([name,run]);
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
 constructor(type,name,doc,namespace=HTML){this.nodeType=type;this.nodeName=name;this.localName=type===1?name.toLowerCase():undefined;this.namespaceURI=type===1?namespace:null;this.ownerDocument=doc;this.parentNode=null;this.childNodes=[];this._attrs=new Map();this._text='';this._value=undefined;this._checked=undefined;this._selected=undefined;this.scrollTop=0;this.scrollLeft=0;this.selectionStart=null;this.selectionEnd=null;this.selectionDirection='none';this.style=new Style(this);this.classList={contains:v=>(this.getAttribute('class')||'').split(/\s+/).includes(v),add:(...values)=>this.setAttribute('class',[...new Set([...(this.getAttribute('class')||'').split(/\s+/).filter(Boolean),...values])].join(' ')),remove:(...values)=>this.setAttribute('class',(this.getAttribute('class')||'').split(/\s+/).filter(v=>v&&!values.includes(v)).join(' '))};}
 get attributes(){return [...this._attrs].map(([name,value])=>({name,value}));}
 get firstChild(){return this.childNodes[0]||null;}
 get nextSibling(){if(!this.parentNode)return null;return this.parentNode.childNodes[this.parentNode.childNodes.indexOf(this)+1]||null;}
 get nodeValue(){return this.nodeType===3||this.nodeType===8?this._text:null;}
 set nodeValue(value){this._text=String(value);}
 get textContent(){return this.nodeType===3||this.nodeType===8?this._text:this.childNodes.map(n=>n.textContent).join('');}
 set textContent(value){if(this.nodeType===3||this.nodeType===8){this._text=String(value);return;}this.replaceChildren(...(value===''?[]:[this.ownerDocument.createTextNode(String(value))]));}
 getAttribute(name){return this._attrs.has(name)?this._attrs.get(name):null;}
 setAttribute(name,value){this._attrs.set(name,String(value));if(name==='style')this.style.parse(String(value));}
 hasAttribute(name){return this._attrs.has(name);}
 removeAttribute(name){this._attrs.delete(name);if(name==='style')this.style.map.clear();}
 appendChild(node){return this.insertBefore(node,null);}
 append(...nodes){nodes.forEach(n=>this.appendChild(n));}
 insertBefore(node,before){if(node===before)return node;if(before&&before.parentNode!==this)throw Error('Invalid reference child');const moving=!!node.parentNode;if(moving){if(node.contains(this.ownerDocument?.activeElement))this.ownerDocument.activeElement=this.ownerDocument.body;node.remove();}const index=before?this.childNodes.indexOf(before):this.childNodes.length;this.childNodes.splice(index,0,node);node.parentNode=this;if(this.resetScrollOnInsert)this.scrollTop=0;return node;}
 remove(){if(this.parentNode){const p=this.parentNode;p.childNodes.splice(p.childNodes.indexOf(this),1);this.parentNode=null;}}
 replaceChildren(...nodes){for(const node of [...this.childNodes])node.remove();nodes.forEach(n=>this.appendChild(n));}
 contains(node){return node===this||this.childNodes.some(child=>child.contains(node));}
 get isConnected(){return !!this.ownerDocument?.body?.contains(this);}
 matches(selector){
  if(this.nodeType!==1)return false;selector=selector.trim();
  if(selector.startsWith('#'))return this.getAttribute('id')===selector.slice(1);
  if(selector.startsWith('.'))return this.classList.contains(selector.slice(1));
  if(/^\[[^\]]+\]$/.test(selector)){const match=selector.slice(1,-1).match(/^([^=]+)(?:=["']?([^"']*)["']?)?$/);return match&&this.hasAttribute(match[1])&&(match[2]===undefined||this.getAttribute(match[1])===match[2]);}
  return this.localName===selector;
 }
 querySelectorAll(selector){const result=[],walk=node=>{for(const c of node.childNodes){if(c.matches(selector))result.push(c);walk(c);}};walk(this);return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 focus(){this.ownerDocument.activeElement=this;}
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
 const doc={activeElement:null,createElement(name){const n=new Node(1,name,this);if(name==='template')n.content=new Node(11,'#document-fragment',this);return n;},createTextNode(text){const n=new Node(3,'#text',this);n.nodeValue=text;return n;},createComment(text){const n=new Node(8,'#comment',this);n.nodeValue=text;return n;}};
 doc.body=doc.createElement('body');doc.scrollingElement=doc.body;doc.activeElement=doc.body;const host=doc.createElement('main');doc.body.appendChild(host);return{doc,host,$:selector=>host.querySelector(selector)};
}

test('equal generated HTML is a true no-op after runtime artwork and icons are added',()=>{
 const {doc,host,$}=setup(),source='<button class="button" data-action="save"><span>保存</span></button>';patch(host,source,{key:'header'});const button=$('button'),label=$('span'),icon=doc.createElement('svg');button.insertBefore(icon,button.firstChild);button.setAttribute('data-art-ready','1');button.setAttribute('data-button-art-enhanced','1');button.classList.add('illustrated-item','art-ready');button.style.setProperty('--item-art','url("loaded.webp")');const result=patch(host,source,{key:'header'});assert.equal(result.changed,false);assert.strictEqual($('button'),button);assert.strictEqual($('span'),label);assert.strictEqual(button.firstChild,icon);assert(button.classList.contains('art-ready'));assert.equal(button.style.getPropertyValue('--item-art'),'url("loaded.webp")');
});
test('changing a resource amount updates one text node and keeps SVG and image identities',()=>{
 const {host,$}=setup(),html=n=>`<div class="resource"><svg viewBox="0 0 24 24"><path d="M1 1"/></svg><img src="coin.webp"><b>${n}</b><small>+20</small></div>`;patch(host,html(100));const svg=$('svg'),path=$('path'),image=$('img'),number=$('b').firstChild;const result=patch(host,html(101));assert.equal(result.text,1);assert.equal(result.added,0);assert.equal(result.removed,0);assert.strictEqual($('svg'),svg);assert.strictEqual($('path'),path);assert.strictEqual($('img'),image);assert.strictEqual($('b').firstChild,number);assert.equal(number.nodeValue,'101');
});
test('runtime replacement of a timer text node is adopted rather than duplicated',()=>{
 const {host,$}=setup(),html=n=>`<i id="month-countdown">${n}</i><span>秒</span>`;patch(host,html(10));const clock=$('#month-countdown');clock.textContent='9';const replacement=clock.firstChild;const result=patch(host,html(8));assert.strictEqual(clock.firstChild,replacement);assert.equal(clock.childNodes.length,1);assert.equal(clock.textContent,'8');assert.equal(result.text,1);
});
test('source class deltas retain art classes while removing only obsolete source state',()=>{
 const {host,$}=setup();patch(host,'<button id="choice" class="button active">A</button>');const button=$('#choice');button.classList.add('art-ready','illustrated-item');patch(host,'<button id="choice" class="button selected">B</button>');assert(!button.classList.contains('active'));assert(button.classList.contains('selected'));assert(button.classList.contains('illustrated-item'));assert(button.classList.contains('art-ready'));assert.equal(button.textContent,'B');
});
test('source style deltas preserve runtime town geometry and decoration properties',()=>{
 const {host,$}=setup(),html=width=>`<div class="town-scene"><div class="town-scene-board"><i id="progress" style="width:${width}%;color:gold"></i><b>町</b></div></div>`;patch(host,html(10));const scene=$('.town-scene'),board=$('.town-scene-board'),progress=$('#progress');scene.style.setProperty('height','640px');scene.setAttribute('data-town-compact','');board.style.setProperty('width','960px');board.style.setProperty('transform','translateX(12px)');progress.style.setProperty('--item-art','url(old.webp)');patch(host,html(20));assert.equal(scene.style.getPropertyValue('height'),'640px');assert(scene.hasAttribute('data-town-compact'));assert.equal(board.style.getPropertyValue('width'),'960px');assert.equal(board.style.getPropertyValue('transform'),'translateX(12px)');assert.equal(progress.style.getPropertyValue('width'),'20%');assert.equal(progress.style.getPropertyValue('--item-art'),'url(old.webp)');
});
test('changed and removed source attributes do not remove runtime-only metadata',()=>{
 const {host,$}=setup();patch(host,'<button id="go" disabled aria-label="待機">出陣</button>');const button=$('#go');button.setAttribute('data-runtime','ready');patch(host,'<button id="go" aria-label="出陣する">出陣</button>');assert(!button.hasAttribute('disabled'));assert.equal(button.getAttribute('aria-label'),'出陣する');assert.equal(button.getAttribute('data-runtime'),'ready');
});
test('focused input text, selection and native select node survive a background form refresh',()=>{
 const {host,$}=setup(),html=n=>`<form><input id="amount" value="1000" max="${n}"><select id="tactic"><option value="a">正攻</option><option value="b">伏兵</option></select><span>${n}</span></form>`;patch(host,html(2000));const input=$('#amount'),select=$('#tactic');input.value='1234';input.setSelectionRange(1,3,'backward');input.focus();select.value='b';patch(host,html(2100),{preserveInputs:true});assert.strictEqual($('#amount'),input);assert.equal(input.value,'1234');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(input.selectionDirection,'backward');assert.strictEqual(host.ownerDocument.activeElement,input);assert.strictEqual($('#tactic'),select);assert.equal(select.value,'b');assert.equal(input.getAttribute('max'),'2100');
});
test('explicit source-controlled forms can update values and checkbox state',()=>{
 const {host,$}=setup();patch(host,'<input id="amount" value="10"><input id="flag" type="checkbox" checked>');const input=$('#amount');input.value='custom';patch(host,'<input id="amount" value="20"><input id="flag" type="checkbox">',{preserveInputs:false});assert.equal(input.value,'20');assert.equal($('#flag').checked,false);
});
test('explicit reset also restores edited controls when its generated HTML is unchanged',()=>{
 const {host,$}=setup(),source='<input id="filter" value=""><select id="sort"><option value="name">名前</option><option value="power">武力</option></select>';patch(host,source,{preserveInputs:false});const input=$('#filter');input.value='変更';$('#sort').value='power';const reset=patch(host,source,{preserveInputs:false});assert(reset.changed);assert.strictEqual($('#filter'),input);assert.equal(input.value,'');assert.equal($('#sort').value,'name');
});
test('details open state survives content and source open-attribute changes',()=>{
 const {host,$}=setup();patch(host,'<details><summary>案内</summary><p>1</p></details>');const details=$('details');details.open=true;patch(host,'<details><summary>案内</summary><p>2</p></details>');assert(details.open);details.open=false;patch(host,'<details open><summary>案内</summary><p>3</p></details>');assert.equal(details.open,false);assert.equal($('p').textContent,'3');
});
test('inserting a same-tag notice before the town does not recycle or detach the town board',()=>{
 const {host,$}=setup(),town='<div class="town-workspace"><div class="town-scene-board"><img src="town.webp"></div></div>';patch(host,town);const workspace=$('.town-workspace'),board=$('.town-scene-board'),img=$('img');patch(host,'<div class="notice">接続確認</div>'+town);assert.strictEqual($('.town-workspace'),workspace);assert.strictEqual($('.town-scene-board'),board);assert.strictEqual($('img'),img);assert.equal(host.childNodes.length,2);assert.equal(host.firstChild.textContent,'接続確認');
});
test('keyed rows reorder and insert without replacing attached listeners or focused controls',()=>{
 const {host,$}=setup(),row=id=>`<button data-action="building" data-id="${id}"><span>${id}</span></button>`;patch(host,row('a')+row('b'));const [a,b]=host.childNodes;a.listener={kept:true};b.focus();patch(host,row('c')+row('b')+row('a'));assert.strictEqual(host.childNodes[1],b);assert.strictEqual(host.childNodes[2],a);assert.equal(a.listener.kept,true);assert.strictEqual(host.ownerDocument.activeElement,b);
});
test('runtime decorator children stay in place while managed children update and grow',()=>{
 const {host,$,doc}=setup();patch(host,'<button id="go"><span>開始</span></button>');const button=$('#go'),icon=doc.createElement('svg');icon.setAttribute('class','item-icon');button.insertBefore(icon,button.firstChild);patch(host,'<button id="go"><span>継続</span><small>1</small></button>');assert.strictEqual(button.firstChild,icon);assert.equal(button.childNodes.length,3);assert.equal(button.childNodes[1].textContent,'継続');assert.equal(button.childNodes[2].textContent,'1');
});
test('map island keeps mounted canvas and camera state while adjacent details update',()=>{
 const {host,$,doc}=setup(),html=n=>`<section><div id="world-map"></div><aside id="castle-detail"><b>${n}</b></aside></section>`;patch(host,html(1),{preserveSelectors:['#world-map']});const map=$('#world-map'),canvas=doc.createElement('canvas');map.appendChild(canvas);map.camera={x:234,zoom:8};map.style.setProperty('height','640px');patch(host,html(2),{preserveSelectors:['#world-map']});assert.strictEqual($('#world-map'),map);assert.strictEqual(map.firstChild,canvas);assert.equal(map.camera.zoom,8);assert.equal(map.style.getPropertyValue('height'),'640px');assert.equal($('#castle-detail').textContent,'2');
});
test('array keys compare by value, and actual context changes reset mounted content',()=>{
 const {host,$}=setup(),source='<input id="amount" value="10">';patch(host,source,{key:['upgrade','keep']});const input=$('#amount');input.value='55';assert.equal(patch(host,source,{key:['upgrade','keep']}).changed,false);assert.strictEqual($('#amount'),input);const changed=patch(host,source,{key:['upgrade','barracks']});assert(changed.replaced);assert.notStrictEqual($('#amount'),input);assert.equal($('#amount').value,'10');
});
test('same artwork URL retains loaded surface while tile and ghost positions change',()=>{
 const {host,$}=setup(),html=x=>`<button id="facility"><span class="painted-art" data-art-url="keep.webp" data-art-x="${x}" data-art-y="0" style="--tile-x:${x}%;--tile-y:0%" aria-busy="true"><span class="art-surface"></span></span></button>`;patch(host,html(0));const button=$('button'),art=$('.painted-art'),surface=$('.art-surface');button.setAttribute('data-ghost-url','keep.webp');button.setAttribute('data-art-ready','1');art.setAttribute('data-art-ready','1');art.setAttribute('data-art-observed','1');art.setAttribute('aria-busy','false');art.classList.add('art-ready');surface.style.setProperty('background-image','url(keep.webp)');patch(host,html(50));assert.strictEqual($('.painted-art'),art);assert.strictEqual($('.art-surface'),surface);assert.equal(art.getAttribute('data-art-ready'),'1');assert.equal(art.getAttribute('aria-busy'),'false');assert.equal(surface.style.getPropertyValue('background-image'),'url(keep.webp)');assert.equal(button.style.getPropertyValue('--item-x'),'50%');assert.equal(button.getAttribute('data-art-ready'),'1');
});
test('changed artwork URL reobserves only the affected art and retains old image during load',()=>{
 const {host,$}=setup(),html=url=>`<div><span id="portrait" class="painted-art" data-art-url="${url}" aria-busy="true"><span class="art-surface"></span></span><img src="fixed.webp"></div>`;patch(host,html('rank-a.webp'));const art=$('#portrait'),surface=$('.art-surface'),fixed=$('img');art.setAttribute('data-art-ready','1');art.setAttribute('data-art-observed','1');art.setAttribute('aria-busy','false');art.classList.add('art-ready');surface.style.setProperty('background-image','url(rank-a.webp)');patch(host,html('rank-s.webp'));assert.strictEqual($('#portrait'),art);assert.strictEqual($('img'),fixed);assert.equal(art.getAttribute('data-art-url'),'rank-s.webp');assert.equal(art.hasAttribute('data-art-ready'),false);assert.equal(art.hasAttribute('data-art-observed'),false);assert.equal(art.getAttribute('aria-busy'),'true');assert.equal(surface.style.getPropertyValue('background-image'),'url(rank-a.webp)');assert(art.classList.contains('art-ready'));
});
test('changed nested artwork resets only its parent ghost binding for the existing decorator',()=>{
 const {host,$}=setup(),html=url=>`<button id="card"><span data-art-url="${url}"></span></button>`;patch(host,html('a.webp'));const button=$('#card');button.setAttribute('data-ghost-url','a.webp');button.setAttribute('data-art-enhanced','1');button.setAttribute('data-button-art-enhanced','1');button.setAttribute('data-art-ready','1');button.style.setProperty('--item-art','url(a.webp)');patch(host,html('b.webp'));assert(!button.hasAttribute('data-ghost-url'));assert(!button.hasAttribute('data-art-enhanced'));assert(!button.hasAttribute('data-button-art-enhanced'));assert.equal(button.style.getPropertyValue('--item-art'),'url(a.webp)');
});
test('removed source rows disappear while unrelated runtime nodes survive',()=>{
 const {host,$,doc}=setup();patch(host,'<section><p id="a">A</p><p id="b">B</p></section>');const section=$('section'),runtime=doc.createElement('svg');section.insertBefore(runtime,section.firstChild);patch(host,'<section><p id="b">B2</p></section>');assert.strictEqual(section.firstChild,runtime);assert.equal($('#a'),null);assert.equal($('#b').textContent,'B2');assert.equal(section.childNodes.length,2);
});
test('element namespace or tag changes replace the old node safely',()=>{
 const {host,$}=setup();patch(host,'<div id="message">A</div>');const before=$('#message');patch(host,'<p id="message">B</p>');assert.notStrictEqual($('#message'),before);assert.equal($('#message').localName,'p');assert.equal(host.childNodes.length,1);
});
test('background insertions restore existing scrolled regions and do not steal outside focus',()=>{
 const {host,$,doc}=setup(),html=n=>`<section id="list"><div id="a">A</div>${n?'<div id="b">B</div>':''}</section>`;patch(host,html(false));const list=$('#list'),outside=doc.createElement('input');doc.body.appendChild(outside);outside.focus();host.scrollTop=123;list.scrollTop=456;list.scrollLeft=12;list.resetScrollOnInsert=true;patch(host,html(true));assert.equal(host.scrollTop,123);assert.equal(list.scrollTop,456);assert.equal(list.scrollLeft,12);assert.strictEqual(doc.activeElement,outside);
});
test('repeated source changes do not accumulate icons or recreate stable form controls',()=>{
 const {host,$,doc}=setup(),html=n=>`<button id="action"><span>${n}</span></button><input id="typed" value="0">`;patch(host,html(0));const input=$('#typed'),button=$('#action'),icon=doc.createElement('svg');button.insertBefore(icon,button.firstChild);input.value='draft';for(let n=1;n<=100;n++)patch(host,html(n));assert.strictEqual($('#typed'),input);assert.equal(input.value,'draft');assert.equal(button.childNodes.length,2);assert.strictEqual(button.firstChild,icon);assert.equal(button.textContent,'100');
});
test('explicit forget resets stale patch metadata on the next render',()=>{
 const {host,$}=setup();patch(host,'<span>1</span>');const before=$('span');forget(host);patch(host,'<span>1</span>');assert.notStrictEqual($('span'),before);
});
test('a parent adopts an independently patched child page without duplicating cards',()=>{
 const {host,$}=setup(),cards=id=>`<div class="officer-grid"><button data-action="officer" data-id="${id}">${id}</button></div>`,page=id=>`<section id="officer-results">${cards(id)}</section><span>total</span>`;
 patch(host,page('one'),{key:'officers'});const results=$('#officer-results');patch(results,cards('two'),{key:'results'});const childButton=$('button');patch(host,page('two'),{key:'officers'});assert.equal(host.querySelectorAll('button').length,1);assert.strictEqual($('button'),childButton);assert.equal($('button').getAttribute('data-id'),'two');
 const unchanged=patch(results,cards('two'),{key:'results'});assert.equal(unchanged.changed,false);
});
test('an independently patched descendant invalidates an otherwise equal parent HTML cache',()=>{
 const {host,$}=setup(),cards=id=>`<button data-action="officer" data-id="${id}">${id}</button>`,page=id=>`<section id="officer-results">${cards(id)}</section>`;
 patch(host,page('one'),{key:'officers'});const results=$('#officer-results');patch(results,cards('two'),{key:'results'});patch(host,page('one'),{key:'officers'});assert.equal(host.querySelectorAll('button').length,1);assert.equal($('button').getAttribute('data-id'),'one');
});
test('artwork-only attribute changes explicitly report the decorator work to callers',()=>{
 const {host}=setup();assert.equal(patch(host,'<span data-art-url="a.webp"></span>').artwork,true);assert.equal(patch(host,'<span data-art-url="a.webp"></span>').artwork,false);const changed=patch(host,'<span data-art-url="b.webp"></span>');assert.equal(changed.added,0);assert.equal(changed.removed,0);assert.equal(changed.artwork,true);
});

for(const[name,run]of tests){run();console.log('PASS '+name);}console.log(`${tests.length} stable DOM scenarios passed with deterministic DOM fixtures; no browser launched.`);
