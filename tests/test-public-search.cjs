'use strict';
// Behavior checks for guide search: loading, real destinations, Japanese input,
// keyboard navigation, safe rendering, and a recoverable network failure.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {Node, setup} = require('./helpers/dom-model.cjs');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'public-search.js'), 'utf8');
const index = JSON.parse(fs.readFileSync(path.join(root, 'public-search-index.json'), 'utf8'));
Object.defineProperties(Node.prototype, {
  className:{get(){return this.getAttribute('class') || '';},set(value){this.setAttribute('class',value);}},
  href:{get(){return this.getAttribute('href') || '';},set(value){this.setAttribute('href',value);}},
  hidden:{get(){return this.hasAttribute('hidden');},set(value){if(value)this.setAttribute('hidden','');else this.removeAttribute('hidden');}}
});
Node.prototype.getClientRects = function(){return [this.getBoundingClientRect()];};
Node.prototype.click = function(){this.clicked=true;this.dispatchEvent({type:'click',button:0});};
const insertBefore=Node.prototype.insertBefore;
Node.prototype.insertBefore=function(node,before){
  if(node.nodeType===11){for(const child of [...node.childNodes])insertBefore.call(this,child,before);return node;}
  return insertBefore.call(this,node,before);
};
function fixture({failFirst=false, customIndex=index, dialogSupport=true}={}) {
  const {doc}=setup(), timers=new Map(), handlers=new Map();let sequence=0,requests=0;
  const html=fs.readFileSync(path.join(root,'guide/index.html'),'utf8');
  doc.body.className='public-luxury';doc.body.innerHTML=html.match(/<body[^>]*>([\s\S]*?)<\/body>/)[1];
  doc.createDocumentFragment=()=>new Node(11,'#document-fragment',doc);
  doc.addEventListener=(type,fn)=>{if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push(fn);};
  const location=new URL('https://www.kasai-solutions-inc.com/guide/');
  const context={document:doc,window:{location,HTMLDialogElement:dialogSupport?Node:undefined},location,URL,
    fetch:async()=>{requests++;if(failFirst&&requests===1)throw Error('offline');return {ok:true,json:async()=>customIndex};},
    setTimeout:fn=>{timers.set(++sequence,fn);return sequence;},clearTimeout:id=>timers.delete(id)};
  const run=()=>vm.runInNewContext(source,context);
  const flush=async()=>{for(const fn of timers.values())fn();timers.clear();for(let i=0;i<8;i++)await Promise.resolve();};
  const search=async value=>{const input=doc.querySelector('#public-search-input');input.value=value;input.dispatchEvent({type:'input'});await flush();};
  const dispatch=(type,detail={})=>{const event={type,target:doc.body,preventDefault(){this.defaultPrevented=true;},...detail};for(const fn of handlers.get(type)||[])fn(event);return event;};
  run();
  return {doc,flush,search,run,dispatch,requests:()=>requests,get:selector=>doc.querySelector(selector),all:selector=>doc.querySelectorAll(selector)};
}
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('every index entry links to a real guide or subheading and every contents entry is searchable',()=>{
    assert.equal(index.schemaVersion,1);assert(index.entries.length>=58);
    const urls=new Set();
    for(const entry of index.entries){
      assert(entry.title&&entry.page&&entry.body);const url=new URL(entry.href,'https://www.kasai-solutions-inc.com/');
      assert.equal(url.origin,'https://www.kasai-solutions-inc.com');assert(!urls.has(url.href));urls.add(url.href);
      const html=fs.readFileSync(path.join(root,url.pathname,'index.html'),'utf8');assert(html.includes('id="'+url.hash.slice(1)+'"'));
    }
    for(const file of ['guide/index.html','guide/data-recovery/index.html','about/index.html','press/index.html','news/index.html']){
      const html=fs.readFileSync(path.join(root,file),'utf8');const toc=html.match(/<details class="toc-chapters"[\s\S]*?<\/details>/)[0];
      for(const match of toc.matchAll(/href="#([^"]+)"/g))assert(urls.has(new URL(path.dirname(file)+'/#'+match[1],'https://www.kasai-solutions-inc.com/').href));
    }
  });
  await test('the index loads only on demand and is reused when search reopens',async()=>{
    const f=fixture();assert.equal(f.requests(),0);assert.equal(f.get('dialog'),null);
    const trigger=f.get('.public-search-trigger');trigger.click();await f.flush();
    assert.equal(f.requests(),1);assert(f.get('dialog').open);assert.equal(f.doc.activeElement,f.get('input#public-search-input'));
    assert.equal(f.all('.public-search-results a').length,8);
    f.get('.public-search-close').click();assert(!f.get('dialog').open);assert.equal(f.doc.activeElement,trigger);
    trigger.click();await f.flush();assert.equal(f.requests(),1);f.run();assert.equal(f.all('dialog').length,1);
  });
  await test('Japanese aliases, multiple words, and missing queries preserve safe text and real links',async()=>{
    const f=fixture();f.get('.public-search-trigger').click();await f.flush();
    await f.search('城の強化');assert.match(f.get('.public-search-results strong').textContent,/城郭/);
    // New release titles can legitimately outrank the FAQ. Test width
    // normalization and the music alias against the same real result links.
    await f.search('ＢＧＭ');const musicLinks=f.all('.public-search-results a').map(link=>link.href);assert(musicLinks.length>0);
    await f.search('BGM');assert.deepEqual(f.all('.public-search-results a').map(link=>link.href),musicLinks);
    await f.search('音楽');assert.deepEqual(f.all('.public-search-results a').map(link=>link.href),musicLinks);
    await f.search('せーぶ');assert.equal(f.get('.public-search-results strong').textContent,'保存と端末同期');
    await f.search('戦記');assert.match(f.get('.public-search-results a').href, /guide\/#campaign-records$/);
    await f.search('待ち時間');assert.match(f.get('.public-search-results a').href, /guide\/#resource-planner$/);
    await f.search('武将 編成');assert.equal(f.get('.public-search-results strong').textContent,'武将・軍団・勾玉');
    await f.search('<img src=x onerror=alert(1)>');assert.equal(f.all('.public-search-results a').length,0);assert(f.get('.public-search-no-results'));
    assert.equal(f.get('.public-search-results img'),null);f.get('.public-search-reset').click();assert.equal(f.get('#public-search-input').value,'');assert.equal(f.all('.public-search-results a').length,8);
  });
  await test('IME confirmation does not navigate and keyboard arrows select the results after composition',async()=>{
    const f=fixture();f.get('.public-search-trigger').click();await f.flush();const input=f.get('#public-search-input');
    const first=f.get('.public-search-results a');input.value='保存';input.dispatchEvent({type:'input',isComposing:true});await f.flush();
    assert.equal(f.get('.public-search-results a'),first);input.dispatchEvent({type:'keydown',key:'Enter',isComposing:true});assert(!first.clicked);
    input.dispatchEvent({type:'keydown',key:'Enter',keyCode:229,isComposing:false});assert(!first.clicked,'Legacy IME confirmation must not follow the first result');
    input.dispatchEvent({type:'compositionend'});await f.flush();const matched=f.get('.public-search-results a');
    input.dispatchEvent({type:'keydown',key:'ArrowDown'});assert.equal(f.doc.activeElement,matched);
    matched.dispatchEvent({type:'keydown',key:'ArrowUp'});assert.equal(f.doc.activeElement,input);
    input.dispatchEvent({type:'keydown',key:'Enter'});assert(matched.clicked);
  });
  await test('one Escape closes a nonempty search while IME composition keeps the dialog open',async()=>{
    const f=fixture(),trigger=f.get('.public-search-trigger');trigger.click();await f.flush();await f.search('保存');
    const input=f.get('#public-search-input'),dialog=f.get('dialog');
    input.dispatchEvent({type:'keydown',key:'Escape',isComposing:true});assert(dialog.open);
    input.dispatchEvent({type:'keydown',key:'Escape',keyCode:229,isComposing:false});assert(dialog.open);
    const event={type:'keydown',key:'Escape'};input.dispatchEvent(event);
    assert(event.defaultPrevented);assert(!dialog.open);assert.equal(input.value,'保存');assert.equal(f.doc.activeElement,trigger);
  });
  await test('a failed network request exposes a working retry and a static guide fallback',async()=>{
    const f=fixture({failFirst:true});f.get('.public-search-trigger').click();await f.flush();
    assert.equal(f.requests(),1);assert.equal(f.get('.public-search-retry').hidden,false);
    assert.equal(f.get('.public-search-all').href,'https://www.kasai-solutions-inc.com/guide/');
    f.get('.public-search-retry').click();await f.flush();assert.equal(f.requests(),2);assert.equal(f.get('.public-search-retry').hidden,true);assert(f.all('.public-search-results a').length);
  });
  await test('unsafe index URLs are omitted and markup in an entry is rendered as text',async()=>{
    const customIndex={schemaVersion:1,entries:[{title:'<img src=x onerror=alert(1)>',page:'Guide',href:'guide/#first-steps',body:'Text'}, {title:'Offsite',page:'Guide',href:'https://example.com/',body:'Text'}, {title:'Script',page:'Guide',href:'javascript:alert(1)',body:'Text'}]};
    const f=fixture({customIndex});f.get('.public-search-trigger').click();await f.flush();assert.equal(f.all('.public-search-results a').length,1);assert.equal(f.get('.public-search-results strong').textContent,'<img src=x onerror=alert(1)>');assert.equal(f.get('.public-search-results img'),null);
  });
  await test('unsupported dialogs preserve links and slash never interrupts an editable field',async()=>{
    const old=fixture({dialogSupport:false});const link=old.get('.public-search-trigger');assert(!link.hasAttribute('aria-haspopup'));link.click();assert.equal(old.requests(),0);assert.equal(old.get('dialog'),null);
    const f=fixture();const input=f.doc.createElement('input');f.doc.body.append(input);
    const editing=f.dispatch('keydown',{key:'/',target:input});assert(!editing.defaultPrevented);assert.equal(f.get('dialog'),null);
    const editor=f.doc.createElement('div');editor.setAttribute('contenteditable','');f.doc.body.append(editor);
    assert(!f.dispatch('keydown',{key:'/',target:editor}).defaultPrevented);assert.equal(f.get('dialog'),null);
    const shortcut=f.dispatch('keydown',{key:'/'});await f.flush();assert(shortcut.defaultPrevented);assert(f.get('dialog').open);
  });
  console.log(passed+' public search checks passed.');
})().catch(error=>{console.error(error);process.exitCode=1;});
