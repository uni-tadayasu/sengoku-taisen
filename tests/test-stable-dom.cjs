'use strict';
// Deterministic DOM model for reconciliation and retention behavior. Browser QA is separate.
const assert=require('node:assert/strict'),{patch,forget,captureScroll,restoreScroll}=require('../stable-dom.js');
const tests=[],test=(name,run)=>tests.push([name,run]);
const {setup}=require('./helpers/dom-model.cjs');

test('unscrolled resource updates do not force geometry reads on header ancestors',()=>{
 const {doc,host,$}=setup(),html=n=>`<div id="resource"><b>${n}</b></div>`;patch(host,html(1));
 let reads=0;for(let node=host;node;node=node.parentElement)node.getBoundingClientRect=()=>{reads++;return{top:0,left:0,bottom:100,right:100,width:100,height:100};};
 const result=patch(host,html(2));assert.equal(result.text,1);assert.equal($('#resource').textContent,'2');assert.equal(reads,0);
 const snapshot=captureScroll(host);host.scrollTop=12;assert(restoreScroll(snapshot));assert.equal(host.scrollTop,0);assert.equal(reads,0);
});

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
test('refocusing a moved keyed control respects input policy and preserves unchanged selection',()=>{
 for(const {preserveInputs,liveValue,sourceValue,expected,selection} of [{preserveInputs:false,liveValue:'1234',sourceValue:'20',expected:'20',selection:false},{preserveInputs:false,liveValue:'1234',sourceValue:'1234',expected:'1234',selection:true},{preserveInputs:true,liveValue:'5678',sourceValue:'20',expected:'5678',selection:true}]){
  const {host,$,doc}=setup(),row=value=>`<section id="editable"><input id="amount" value="${value}"></section>`,other='<section id="other">別の項目</section>';
  patch(host,other+row('1234'),{preserveInputs});const input=$('#amount');input.value=liveValue;input.setSelectionRange(1,3,'backward');input.focus();
  patch(host,row(sourceValue)+other,{preserveInputs});
  assert.strictEqual($('#amount'),input);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,expected);
  if(selection){assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(input.selectionDirection,'backward');}
 }
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

// Deterministic row geometry models browser scroll offsets, independent of the
// reconciler's implementation. Browser QA verifies the actual CSS layout.
function scrollingList({documentScrolling=false}={}){
 const fixture=setup(),{doc,host}=fixture,pane=documentScrolling?doc.body:doc.createElement('dialog');
 if(!documentScrolling){doc.body.appendChild(pane);pane.appendChild(host);pane.open=true;}
 doc.defaultView={innerHeight:200,innerWidth:400};pane.clientHeight=200;pane.clientWidth=400;
 const origin=documentScrolling?0:20;pane.getBoundingClientRect=()=>({top:origin,left:0,bottom:origin+200,right:400,width:400,height:200});
 const html=rows=>rows.map(([id,height=100,label=id])=>`<article data-stable-key="${id}" data-row="${id}" data-height="${height}"><p>${label}</p><input id="edit-${id}" value="0"></article>`).join('');
 const bind=()=>{for(const row of host.querySelectorAll('[data-row]')){
  const rect=(offset,height)=>{const siblings=Array.from(host.children||host.childNodes).filter(node=>node.hasAttribute?.('data-row')),index=siblings.indexOf(row),top=origin+siblings.slice(0,index).reduce((sum,node)=>sum+Number(node.getAttribute('data-height')),0)-pane.scrollTop+offset;return{top,left:0,bottom:top+height,right:400,width:400,height};};
  row.getBoundingClientRect=()=>rect(0,Number(row.getAttribute('data-height')));row.querySelector('p').getBoundingClientRect=()=>rect(10,20);row.querySelector('input').getBoundingClientRect=()=>rect(40,24);
 }};
 const draw=(rows,key='list')=>{const result=patch(host,html(rows),{key});bind();return result;};
 draw([['a'],['b'],['c'],['d'],['e']]);return{...fixture,pane,draw};
}
test('prepending rows preserves visible content in an ancestor dialog and keeps a focused draft attached',()=>{
 const {host,pane,draw,$,doc}=scrollingList();pane.scrollTop=150;const input=$('#edit-c'),row=host.querySelector('[data-row="c"]'),before=row.getBoundingClientRect().top;input.value='typed';input.setSelectionRange(1,3);input.focus();
 draw([['new',80],['a'],['b'],['c',100,'updated'],['d'],['e']]);assert.equal(pane.scrollTop,230);assert.equal(row.getBoundingClientRect().top,before);assert.equal(row.querySelector('p').textContent,'updated');assert.strictEqual($('#edit-c'),input);assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'typed');assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);
});
test('document scrolling preserves the same reading position when rows arrive above it',()=>{
 const {host,pane,draw}=scrollingList({documentScrolling:true});pane.scrollTop=150;const row=host.querySelector('[data-row="c"]'),before=row.getBoundingClientRect().top;
 draw([['new',75],['a'],['b'],['c'],['d'],['e']]);assert.equal(pane.scrollTop,225);assert.equal(row.getBoundingClientRect().top,before);
});
test('scroll restoration requests an instant move even when the page uses smooth scrolling',()=>{
 const {host,pane,draw}=scrollingList({documentScrolling:true}),calls=[];pane.style.setProperty('scroll-behavior','smooth');pane.scrollTop=150;
 pane.scrollTo=options=>{calls.push(options);if(options.behavior==='instant'){pane.scrollTop=options.top;pane.scrollLeft=options.left;}};
 const row=host.querySelector('[data-row="c"]'),before=row.getBoundingClientRect().top;draw([['new',75],['a'],['b'],['c'],['d'],['e']]);assert.deepEqual(calls,[{top:225,left:0,behavior:'instant'}]);assert.equal(pane.scrollTop,225);assert.equal(row.getBoundingClientRect().top,before);assert.equal(pane.style.getPropertyValue('scroll-behavior'),'smooth');
});
test('the first nested patch inherits ancestor source records without remounting focused or decorated content',()=>{
 const {doc,host,pane,$}=scrollingList();pane.scrollTop=150;const row=host.querySelector('[data-row="c"]'),label=row.querySelector('p'),text=label.firstChild,input=$('#edit-c'),icon=doc.createElement('svg'),path=doc.createElement('path'),top=row.getBoundingClientRect().top;
 icon.appendChild(path);label.appendChild(icon);label.classList.add('art-ready');label.setAttribute('data-art-ready','1');label.style.setProperty('--item-art','url(loaded.webp)');input.value='draft';input.setSelectionRange(1,3);input.focus();
 const result=patch(row,'<p>updated</p><input id="edit-c" value="0">',{key:'nested'});assert.equal(result.replaced,false);assert.equal(result.added,0);assert.equal(result.removed,0);assert.strictEqual(row.querySelector('p'),label);assert.strictEqual(label.firstChild,text);assert.equal(text.nodeValue,'updated');assert.strictEqual(label.querySelector('svg'),icon);assert.strictEqual(icon.firstChild,path);assert.equal(label.getAttribute('data-art-ready'),'1');assert.equal(label.style.getPropertyValue('--item-art'),'url(loaded.webp)');assert.strictEqual($('#edit-c'),input);assert.equal(input.value,'draft');assert.strictEqual(doc.activeElement,input);assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);assert.equal(pane.scrollTop,150);assert.equal(row.getBoundingClientRect().top,top);
 const reset=patch(row,'<p>another</p><input id="edit-c" value="7">',{key:'another'});assert(reset.replaced);assert.notStrictEqual($('#edit-c'),input);assert.equal($('#edit-c').value,'7');
});
test('nested adoption does not capture unmanaged DOM, explicitly forgotten content or another ancestor context',()=>{
 const {host,$,doc}=setup(),source='<section id="nested"><input id="draft" value="0"></section>';
 host.innerHTML=source;const unmanaged=$('#draft');assert(patch(host,source,{key:'one'}).replaced);assert.notStrictEqual($('#draft'),unmanaged);
 let nested=$('#nested'),input=$('#draft');input.value='draft';forget(nested);assert(patch(nested,'<input id="draft" value="1">').replaced);assert.notStrictEqual($('#draft'),input);assert.equal($('#draft').value,'1');
 const outsider=doc.createElement('section');outsider.id='runtime';outsider.innerHTML='<input id="unowned" value="0">';host.appendChild(outsider);const external=outsider.firstChild;assert(patch(outsider,'<input id="unowned" value="2">').replaced);assert.notStrictEqual(outsider.firstChild,external);
 input=$('#draft');input.value='private';patch(host,source,{key:'two'});assert.notStrictEqual($('#draft'),input);nested=$('#nested');const current=$('#draft');patch(nested,'<input id="draft" value="0">');assert.strictEqual($('#draft'),current);assert.equal(current.value,'0');
});
test('removing the first visible row uses a surviving visible anchor and deleting all anchors safely falls back',()=>{
 const {host,pane,draw}=scrollingList();pane.scrollTop=150;const row=host.querySelector('[data-row="c"]'),before=row.getBoundingClientRect().top;
 draw([['a'],['c'],['d'],['e']]);assert.equal(pane.scrollTop,50);assert.equal(row.getBoundingClientRect().top,before);
 draw([['replacement']]);assert.equal(pane.scrollTop,50);assert.equal(host.querySelectorAll('[data-row]').length,1);
});
test('a pane at the top stays at the top when a new item is inserted',()=>{
 const {pane,draw}=scrollingList();draw([['new',80],['a'],['b'],['c'],['d'],['e']]);assert.equal(pane.scrollTop,0);
});
test('fixed and unrelated earlier headers cannot displace the actual content anchor',()=>{
 const {doc,host,pane,draw}=scrollingList(),heading=doc.createElement('h2'),fixed=doc.createElement('button');heading.id='outside-heading';heading.getBoundingClientRect=()=>({top:20,left:0,bottom:50,right:400,width:400,height:30});pane.insertBefore(heading,host);fixed.id='fixed-action';fixed.style.setProperty('position','fixed');fixed.getBoundingClientRect=heading.getBoundingClientRect;host.insertBefore(fixed,host.firstChild);
 pane.scrollTop=150;const row=host.querySelector('[data-row="c"]'),before=row.getBoundingClientRect().top;draw([['new',80],['a'],['b'],['c'],['d'],['e']]);assert.equal(pane.scrollTop,230);assert.equal(row.getBoundingClientRect().top,before);assert.strictEqual(host.firstChild,fixed);
});
test('reusing a snapshot never undoes scrolling performed after its first restoration',()=>{
 const {host,pane,draw}=scrollingList();pane.scrollTop=150;const snapshot=captureScroll(host);draw([['new',80],['a'],['b'],['c'],['d'],['e']]);assert(restoreScroll(snapshot));assert.equal(pane.scrollTop,230);
 pane.scrollTop=267;assert.equal(restoreScroll(snapshot),false);assert.equal(pane.scrollTop,267);assert.equal(restoreScroll(snapshot),false);assert.equal(pane.scrollTop,267);
});
test('an old scroll snapshot cannot affect a newly selected patch context or a detached page',()=>{
 const {doc,host,pane,draw}=scrollingList();pane.scrollTop=150;const snapshot=captureScroll(host);draw([['other']], 'other');pane.scrollTop=0;assert.equal(restoreScroll(snapshot),false);assert.equal(pane.scrollTop,0);
 const second=captureScroll(host);host.remove();assert.equal(restoreScroll(second),false);doc.body.appendChild(host);
});

test('native hit testing bounds anchor geometry reads on a long list and retains visible content',()=>{
 const {doc,host,pane,draw}=scrollingList(),rows=Array.from({length:1000},(_,i)=>['row'+i]);draw(rows);pane.scrollTop=50150;
 let reads=0;for(const part of host.querySelectorAll('*')){const original=part.getBoundingClientRect.bind(part);part.getBoundingClientRect=()=>{reads++;return original();};}
 doc.elementsFromPoint=(_x,y)=>{const offset=y-20+pane.scrollTop;let top=0;for(const row of host.children||host.childNodes){const height=Number(row.getAttribute('data-height'));if(offset>=top&&offset<top+height){const inside=offset-top,hit=inside>=10&&inside<30?row.querySelector('p'):inside>=40&&inside<64?row.querySelector('input'):row;return [hit,row,host,pane,doc.body];}top+=height;}return[pane,doc.body];};
 const row=host.querySelector('[data-row="row502"]'),before=row.getBoundingClientRect().top,snapshot=captureScroll(host);assert(snapshot.entries.some(entry=>entry.anchors.length));assert(reads<100,`only visible anchors should be measured, got ${reads}`);
 draw([['new',80],...rows]);assert.equal(pane.scrollTop,50230);assert.equal(row.getBoundingClientRect().top,before);
 assert.equal(restoreScroll(snapshot),true);const after=pane.scrollTop;pane.scrollTop+=19;assert.equal(restoreScroll(snapshot),false);assert.equal(pane.scrollTop,after+19);
});
test('unavailable or failed native hit testing preserves the deterministic geometry fallback',()=>{
 const {doc,host,pane,draw}=scrollingList();pane.scrollTop=150;doc.elementsFromPoint=()=>{throw Error('unsupported');};const row=host.querySelector('[data-row="c"]'),before=row.getBoundingClientRect().top;
 draw([['new',80],['a'],['b'],['c'],['d'],['e']]);assert.equal(pane.scrollTop,230);assert.equal(row.getBoundingClientRect().top,before);
});

test('mobile and tablet keyboard viewports anchor the content actually visible above the keyboard',()=>{
 for(const width of [390,768]){
  const {doc,host,pane}=scrollingList({documentScrolling:true});doc.defaultView.innerWidth=width;doc.defaultView.visualViewport={width,height:60,offsetTop:140,offsetLeft:0,scale:1};pane.scrollTop=150;
  const row=host.querySelector('[data-row="d"]'),before=row.getBoundingClientRect().top,snapshot=captureScroll(host);
  // A row above the visual viewport grows while the keyboard has panned the
  // page. Anchoring a different, obscured row would leave this row displaced.
  host.querySelector('[data-row="c"]').setAttribute('data-height','160');
  assert(restoreScroll(snapshot));assert.equal(row.getBoundingClientRect().top,before,width+'px visible row');assert.equal(pane.scrollTop,210);
 }
});
test('a keyboard/browser viewport change cancels delayed restoration without moving the document',()=>{
 const {doc,host,pane}=scrollingList({documentScrolling:true});doc.defaultView.visualViewport={width:390,height:160,offsetTop:0,offsetLeft:0,scale:1};pane.scrollTop=150;
 const snapshot=captureScroll(host);assert(restoreScroll(snapshot));doc.defaultView.visualViewport.offsetTop=40;doc.defaultView.visualViewport.height=120;
 assert.equal(restoreScroll(snapshot),false);assert.equal(pane.scrollTop,150,'the browser owns its keyboard pan');
 doc.defaultView.visualViewport.offsetTop=0;doc.defaultView.visualViewport.height=160;assert.equal(restoreScroll(snapshot),false,'an obsolete pending frame must not resume later');
});

test('a large reordered roster retains keyed rows, listeners and a focused draft',()=>{
 const {doc,host}=setup(),ids=Array.from({length:129},(_,i)=>'lord-'+i),markup=(rows,version)=>rows.map(id=>`<article data-player-id="${id}"><input name="draft" value="default"><span>${version}:${id}</span></article>`).join('');
 patch(host,markup(ids,1));const nodes=new Map(host.childNodes.map(node=>[node.dataset.playerId,node])),row=nodes.get('lord-63'),draft=row.querySelector('input');let clicks=0;row.addEventListener('click',()=>clicks++);
 draft.value='書きかけの紹介文';draft.focus();draft.setSelectionRange(2,6,'backward');
 const next=['new-first',...ids.slice(5).reverse(),'new-last'],stats=patch(host,markup(next,2));
 assert.equal(stats.removed,5);assert.equal(stats.added,2);assert.deepEqual(host.childNodes.map(node=>node.dataset.playerId),next);
 for(const id of ids.slice(5))assert.strictEqual(host.querySelector(`[data-player-id="${id}"]`),nodes.get(id));
 assert.strictEqual(doc.activeElement,draft);assert.equal(draft.value,'書きかけの紹介文');assert.deepEqual([draft.selectionStart,draft.selectionEnd,draft.selectionDirection],[2,6,'backward']);
 row.dispatchEvent({type:'click'});assert.equal(clicks,1);assert.equal(row.querySelector('span').textContent,'2:lord-63');
});
test('long unkeyed lists consume repeated shapes in source order without recycling incompatible nodes',()=>{
 const {host}=setup(),markup=(groups,version)=>groups.map(group=>`<!--${group}--><section class="${group}"><b>${version}:${group}</b></section>\n`).join(''),groups=Array.from({length:48},(_,i)=>i%3?'detail':'summary');
 patch(host,markup(groups,1));const old=new Map(['detail','summary'].map(group=>[group,host.querySelectorAll('section.'+group)]));
 const order=[...groups].reverse(),stats=patch(host,markup(order,2));assert.equal(stats.added,0);assert.equal(stats.removed,0);
 const used={detail:0,summary:0};for(const [index,row]of host.querySelectorAll('section').entries()){
  const group=order[index];assert.strictEqual(row,old.get(group)[used[group]++]);assert.equal(row.textContent,'2:'+group);
 }
 // Existing keyed rows with a changed element kind must be replaced even in
 // a long sibling list; a shared key never overrides type compatibility.
 const keyed=tag=>Array.from({length:32},(_,i)=>`<${i===15?tag:'article'} data-key="row-${i}">row ${i}</${i===15?tag:'article'}>`).join('');
 patch(host,keyed('article'));const before=host.querySelector('[data-key="row-15"]');patch(host,keyed('aside'));assert.notStrictEqual(host.querySelector('[data-key="row-15"]'),before);assert.equal(host.querySelector('[data-key="row-15"]').localName,'aside');
});

for(const[name,run]of tests){run();console.log('PASS '+name);}console.log(`${tests.length} stable DOM scenarios passed with deterministic DOM fixtures; no browser launched.`);
