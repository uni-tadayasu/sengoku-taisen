'use strict';
const assert=require('node:assert/strict');
const {setup,Node,SVG}=require('./helpers/dom-model.cjs');
const variants=require('../variant-text.js');
const stable=require('../stable-dom.js');
const MARK='data-sengoku-variant-glyph',FIELD_MARK='data-sengoku-variant-field';
let checks=0;function test(name,fn){fn();checks++;console.log('PASS '+name);}
function fixture(html,beforeCreate){const f=setup(),listeners=new Map(),frames=new Map();let serial=0,callback,disconnected=false,observed;
 f.doc.createElementNS=(ns,name)=>new Node(1,name,f.doc,ns);
 f.doc.addEventListener=(name,fn)=>listeners.set(name,fn);f.doc.removeEventListener=name=>listeners.delete(name);
 f.host.innerHTML=html;beforeCreate?.(f);
 f.doc.onAttributeChange=record=>{if(observed?.attributeFilter.includes(record.name)&&!disconnected)callback([{type:'attributes',target:record.node,attributeName:record.name}]);};
 class Observer{constructor(fn){callback=fn;}observe(node,options){assert.equal(node,f.doc.body);assert.equal(options.subtree,true);assert.deepEqual(options.attributeFilter,['value','placeholder','label','selected','contenteditable']);observed=options;}disconnect(){disconnected=true;}}
 const ui=variants.create({document:f.doc,MutationObserver:Observer,requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)});
 return{...f,ui,listeners,frames,emit:record=>callback([record]),flush(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}},get disconnected(){return disconnected;}};
}
test('IVS and standardized ideographic variants retain their exact original code points',()=>{
 for(const text of ['葛\u{E0100}西','葛\u{E0101}','辻\u{E0100}','禰\u{E0100}','神\uFE00','𠮷\u{E0100}田']){assert.equal(variants.hasVariant(text),true);assert.equal(variants.parts(text).map(p=>p.text).join(''),text);assert.ok(variants.parts(text).some(p=>p.variant));}
 for(const text of ['徳川','德川','髙橋','﨑','𠮷田','❤\uFE0F','⚔\uFE0F','\u{E0100}',''])assert.equal(variants.hasVariant(text),false,text);
 assert.equal(variants.parts('神').map(p=>p.text).join(''),'神','compatibility ideographs are not normalized');
});
test('name initials keep supplementary characters, IVS, combining marks and emoji intact',()=>{
 for(const [text,first,count]of [['葛\u{E0100}西','葛\u{E0100}',2],['𠮷田','𠮷',2],['か\u3099く','か\u3099',2],['👩‍💻さん','👩‍💻',3],['🇯🇵旗','🇯🇵',2],['','',0]]){assert.equal(variants.firstGrapheme(text),first);assert.equal(variants.graphemeCount(text),count);assert.equal(variants.fallbackGraphemes(text)[0]||'',first);assert.equal(variants.fallbackGraphemes(text).length,count);}
});
test('the smallest text parent gets a font attribute without replacing text or controls',()=>{
 const f=fixture('<button id="name">葛\u{E0100}西 髙橋 﨑 𠮷田 德川</button>');
 const button=f.$('#name');button.focus();let clicks=0;button.addEventListener('click',()=>clicks++);
 const text=button.textContent,textNode=button.firstChild;assert.equal(button.hasAttribute(MARK),true);assert.equal(f.host.hasAttribute(MARK),false);
 f.ui.refresh();assert.equal(f.$('#name'),button);assert.equal(button.textContent,text);assert.equal(button.firstChild,textNode);assert.equal(button.querySelector('span'),null);assert.equal(f.doc.activeElement,button);button.dispatchEvent({type:'click'});assert.equal(clicks,1);assert.equal(f.frames.size,0,'Font attributes must not observe themselves');f.ui.dispose();
});
test('literal user text stays text and cannot turn into an HTML element',()=>{
 const f=fixture('<p id="name"></p>'),name=f.$('#name');name.textContent='<img src=x onerror=bad>葛\u{E0100}';f.ui.refresh(name);
 assert.equal(name.textContent,'<img src=x onerror=bad>葛\u{E0100}');assert.equal(name.querySelector('img'),null);assert.equal(name.querySelectorAll('span').length,0);assert.equal(name.hasAttribute(MARK),true);f.ui.dispose();
});
test('typing and IME values are never rewritten; native fields switch fallback by an attribute',()=>{
 const f=fixture('<input id="name" value="葛\u{E0100}西"><textarea id="bio">禰\u{E0100}</textarea>'),input=f.$('#name');
 input.focus();input.setSelectionRange(3,4);assert.equal(input.hasAttribute('data-sengoku-variant-field'),true);assert.equal(input.querySelector('span'),null);assert.equal(f.$('#bio').querySelector('span'),null);
 input.value='神 髙橋';f.listeners.get('input')({target:input,isComposing:true});assert.equal(input.value,'神 髙橋');assert.equal(input.hasAttribute('data-sengoku-variant-field'),false);assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,4);assert.equal(f.doc.activeElement,input);
 input.setAttribute('placeholder','葛\u{E0100}');f.listeners.get('focusin')({target:input});assert.equal(input.hasAttribute('data-sengoku-variant-field'),true);f.ui.dispose();
});
test('scripts, styles, page titles and editable contents are not split into markup',()=>{
 const f=fixture('<script>葛\u{E0100}</script><style>葛\u{E0100}</style><title>葛\u{E0100}</title><div contenteditable="true">葛\u{E0100}</div><p data-sengoku-variant-skip>葛\u{E0100}</p>');
 assert.equal(f.host.querySelectorAll('span').length,0);assert.equal(f.host.querySelectorAll('['+MARK+']').length,0);assert.equal(f.$('[contenteditable]').hasAttribute('data-sengoku-variant-field'),true);f.ui.dispose();
});
test('dynamic messages are decorated in one frame, detached messages are ignored and disposal stops work',()=>{
 const f=fixture('<div id="messages"></div>'),messages=f.$('#messages'),text=f.doc.createTextNode('辻\u{E0100}さん');messages.appendChild(text);
 f.emit({type:'childList',target:messages,addedNodes:[text]});f.emit({type:'characterData',target:text});assert.equal(f.frames.size,1);f.flush();assert.equal(messages.hasAttribute(MARK),true);assert.equal(messages.firstChild,text);assert.equal(messages.textContent,'辻\u{E0100}さん');assert.equal(f.frames.size,0,'A decoration must not cause another observer frame');
 const removed=f.doc.createElement('p');removed.textContent='葛\u{E0100}';messages.appendChild(removed);f.emit({type:'childList',target:messages,addedNodes:[removed]});removed.remove();f.flush();assert.equal(removed.querySelector('span'),null);
 f.emit({type:'characterData',target:messages.firstChild});f.ui.dispose();assert.equal(f.disconnected,true);assert.equal(f.frames.size,0);assert.equal(f.listeners.size,0);
});
test('removing the variant from a reused text node restores the normal font',()=>{
 const f=fixture('<b>葛\u{E0100}</b>'),label=f.$('b'),text=label.firstChild;text.nodeValue='葛';f.emit({type:'characterData',target:text});f.flush();assert.equal(label.textContent,'葛');assert.equal(label.hasAttribute(MARK),false);assert.equal(label.firstChild,text);assert.equal(f.$('span'),null);f.ui.dispose();
});
test('SVG labels keep their original nodes and namespace',()=>{
 const f=fixture('<svg><text>葛\u{E0100}西<tspan>禰\u{E0100}</tspan><textPath>辻\u{E0100}</textPath></text></svg>');
 for(const name of ['text','tspan','textpath']){const label=f.$(name);assert.equal(label.namespaceURI,SVG);assert.equal(label.hasAttribute(MARK),true);assert.equal(label.firstChild.nodeType,3);}
 assert.equal(f.$('text').textContent,'葛\u{E0100}西禰\u{E0100}辻\u{E0100}');assert.equal(f.$('svg').hasAttribute(MARK),false);assert.equal(f.$('span'),null);f.ui.dispose();
});
test('StableDOM name updates do not retain or duplicate an old variant',()=>{
 let original;
 const f=fixture('',f=>{stable.patch(f.host,'<button id="name">葛\u{E0100}西</button><b>1</b>');original=f.$('#name').firstChild;});
 const button=f.$('#name');button.focus();assert.equal(button.firstChild,original);
 const result=stable.patch(f.host,'<button id="name">髙橋</button><b>2</b>');assert.equal(result.replaced,false);
 f.emit({type:'characterData',target:original});f.flush();assert.equal(f.host.textContent,'髙橋2');assert.equal(f.$('#name'),button);assert.equal(button.firstChild,original);assert.equal(button.hasAttribute(MARK),false);assert.equal(f.doc.activeElement,button);
 stable.patch(f.host,'<button id="name">禰\u{E0100}津</button><b>3</b>');f.emit({type:'characterData',target:original});f.flush();assert.equal(f.host.textContent,'禰\u{E0100}津3');assert.equal(button.hasAttribute(MARK),true);assert.equal(button.firstChild,original);
 assert.equal(stable.patch(f.host,'<button id="name">禰\u{E0100}津</button><b>3</b>').changed,false);assert.equal(f.frames.size,0);f.ui.dispose();
});
test('native choices and editable descendants update their owner without touching selection',()=>{
 const f=fixture('<select id="choice"><option value="plain" selected>徳川</option><option value="variant">葛\u{E0100}西</option></select><div contenteditable="plaintext-only" id="editor"><b>徳川</b></div>');
 const select=f.$('#choice'),option=select.querySelectorAll('option')[1],editor=f.$('#editor'),text=editor.firstChild.firstChild;
 assert.equal(select.hasAttribute(FIELD_MARK),true);assert.equal(select.value,'plain');
 option.textContent='葛西';f.emit({type:'childList',target:option,addedNodes:[option.firstChild]});f.flush();assert.equal(select.hasAttribute(FIELD_MARK),false);assert.equal(select.value,'plain');
 option.setAttribute('label','禰\u{E0100}津');f.flush();assert.equal(select.hasAttribute(FIELD_MARK),true);assert.equal(select.value,'plain');
 editor.focus();text.nodeValue='辻\u{E0100}';f.emit({type:'characterData',target:text});f.flush();assert.equal(editor.hasAttribute(FIELD_MARK),true);assert.equal(editor.firstChild.firstChild,text);assert.equal(f.doc.activeElement,editor);
 text.nodeValue='辻';f.emit({type:'characterData',target:text});f.flush();assert.equal(editor.hasAttribute(FIELD_MARK),false);assert.equal(f.doc.activeElement,editor);assert.equal(f.frames.size,0);f.ui.dispose();
});
test('adjacent text nodes retain their sequence and deleting text removes the font attribute',()=>{
 const f=fixture('<p id="name">葛</p>'),label=f.$('#name'),base=label.firstChild,selector=f.doc.createTextNode('\u{E0100}');label.appendChild(selector);
 f.emit({type:'childList',target:label,addedNodes:[selector]});f.flush();assert.equal(label.hasAttribute(MARK),true);assert.equal(label.firstChild,base);assert.equal(base.nextSibling,selector);
 selector.remove();f.emit({type:'childList',target:label,addedNodes:[]});f.flush();assert.equal(label.hasAttribute(MARK),false);assert.equal(label.textContent,'葛');assert.equal(label.firstChild,base);f.ui.dispose();
});
test('programmatic values can refresh explicitly and native reset waits for the default value',()=>{
 const f=fixture('<form id="form"><input id="name" value="徳川"></form>'),input=f.$('#name');input.focus();input.value='葛\u{E0100}西';input.setSelectionRange(3,4);
 f.ui.refresh(input);assert.equal(input.hasAttribute(FIELD_MARK),true);assert.equal(input.value,'葛\u{E0100}西');assert.equal(input.selectionStart,3);assert.equal(input.selectionEnd,4);
 f.listeners.get('reset')({target:f.$('#form')});assert.equal(input.hasAttribute(FIELD_MARK),true);input.value='徳川';f.flush();assert.equal(input.hasAttribute(FIELD_MARK),false);assert.equal(input.value,'徳川');assert.equal(f.doc.activeElement,input);f.ui.dispose();
});
test('choosing an IVS chat mention updates the font even while the same input keeps focus',()=>{
 const Chat=require('../social-chat.js'),previous=globalThis.SengokuVariants,f=fixture('');
 const chat=Chat.create({context:()=>({key:'self:world:',channel:'world',actorId:'self'}),capabilities:()=>({chatMentions:true,chatReplies:true}),candidates:()=>[{id:'other',name:'葛\u{E0100}西'}]});
 try{
  globalThis.SengokuVariants={...variants,instance:f.ui};f.host.innerHTML=chat.form();chat.attach(f.host);
  const input=f.$('#social-chat-input');input.focus();input.value='@';input.setSelectionRange(1,1);input.dispatchEvent({type:'input'});
  chat.keydown({target:input,key:'Enter',preventDefault(){},stopPropagation(){}});
  assert.equal(input.value,'@葛\u{E0100}西 ');assert.equal(input.hasAttribute(FIELD_MARK),true);assert.equal(input.selectionStart,input.value.length);assert.equal(f.doc.activeElement,input);
  chat.sent(chat.prepare());assert.equal(input.value,'');assert.equal(input.hasAttribute(FIELD_MARK),false);assert.equal(f.doc.activeElement,input);
 }finally{chat.destroy();f.ui.dispose();if(previous===undefined)delete globalThis.SengokuVariants;else globalThis.SengokuVariants=previous;}
});
console.log(`Variant text: ${checks} checks passed`);
