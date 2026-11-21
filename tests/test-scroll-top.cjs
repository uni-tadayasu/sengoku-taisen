/* Exercise actual captured scroll/click handlers with page and nested pane layouts. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../scroll-top.js'),'utf8');
function element(rect={top:0,bottom:600,left:0,right:1000}){
 const events=new Map(),styles={},calls=[];
 return{isConnected:true,clientHeight:600,scrollTop:0,scrollLeft:37,hidden:false,visible:true,events,styles,calls,
  addEventListener(type,fn){events.set(type,fn);},removeEventListener(type){events.delete(type);},
  setAttribute(){},style:{setProperty:(key,value)=>styles[key]=value},
  getClientRects(){return this.visible?[rect]:[];},getBoundingClientRect:()=>rect,
  scrollTo(options){calls.push(options);this.scrollTop=options.top;},focus(options){this.focused=options;},remove(){this.isConnected=false;}
 };
}
function setup(){
 const root=element(),main=element(),town=element(),detail=element(),nodes={'#main':main,'#town-console':town,'#castle-detail':detail},events=new Map(),frames=new Map();let id=0,button,modal=false,observer;
 const body=element();body.classList={contains:()=>false};body.appendChild=node=>{button=node;};
 const doc={body,scrollingElement:root,readyState:'complete',hidden:false,createElement:()=>element(),querySelector:selector=>selector==='dialog[open]'?(modal?{}:null):nodes[selector]||null,
  addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)};
 const c={document:doc,innerHeight:800,innerWidth:1000,scrollX:11,SENGOKU_AT_TITLE:false,addEventListener(){},removeEventListener(){},setTimeout,clearTimeout,
  requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),matchMedia:()=>({matches:false}),scrollTo:options=>{root.calls.push(options);root.scrollTop=options.top;},
  MutationObserver:class{constructor(fn){observer=fn;}observe(){}disconnect(){}}
 };c.window=c;vm.createContext(c);vm.runInContext(source,c);
 const flush=()=>{const tasks=[...frames.values()];frames.clear();for(const task of tasks)task();};
 const refresh=()=>{events.get('scroll')();flush();};flush();
 return{c,doc,root,main,town,detail,nodes,button,events,refresh,flush,modal:value=>{modal=value;observer([{type:'attributes'}]);flush();},click:()=>{button.events.get('click')();flush();}};
}
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
test('the control stays hidden near the top and returns the ordinary main scroller without horizontal movement',()=>{
 const h=setup();assert.equal(h.button.hidden,true);h.main.scrollTop=239;h.refresh();assert.equal(h.button.hidden,true);
 h.main.scrollTop=530;h.refresh();assert.equal(h.button.hidden,false);h.click();assert.equal(h.main.scrollTop,0);assert.equal(h.main.calls[0].left,37);assert.equal(h.main.calls[0].behavior,'smooth');assert.equal(h.button.hidden,true);assert.equal(h.main.focused.preventScroll,true);
});
test('the desktop town scroll pane is handled even when the document and main are fixed at zero',()=>{
 const h=setup();h.town.scrollTop=1200;h.refresh();assert.equal(h.button.hidden,false);h.click();assert.equal(h.town.scrollTop,0);assert.equal(h.main.scrollTop,0);assert.equal(h.root.calls.length,0);
});
test('a mobile page and nested map details both return to their beginning',()=>{
 const h=setup();h.root.scrollTop=950;h.detail.scrollTop=330;h.refresh();h.click();assert.equal(h.root.scrollTop,0);assert.equal(h.detail.scrollTop,0);assert.equal(h.root.calls[0].left,11);
});
test('hidden or detached old content cannot leave the floating control on a new screen',()=>{
 const h=setup();h.town.scrollTop=1000;h.town.visible=false;h.detail.scrollTop=1000;h.detail.isConnected=false;h.refresh();assert.equal(h.button.hidden,true);
});
test('dialogs, the title screen and a background document suppress the page control',()=>{
 const h=setup();h.main.scrollTop=500;h.refresh();h.modal(true);assert.equal(h.button.hidden,true);h.click();assert.equal(h.main.scrollTop,500);
 h.modal(false);assert.equal(h.button.hidden,false);h.c.SENGOKU_AT_TITLE=true;h.refresh();assert.equal(h.button.hidden,true);
 h.c.SENGOKU_AT_TITLE=false;h.doc.hidden=true;h.refresh();assert.equal(h.button.hidden,true);h.doc.hidden=false;h.refresh();assert.equal(h.button.hidden,false);
});
test('the button clears the touch dock and community launcher, but ignores the opposite-side desktop sidebar',()=>{
 const h=setup();h.main.scrollTop=400;h.nodes['.sidebar-bottom']=element({top:500,bottom:800,left:0,right:210});h.nodes['.social-launcher']=element({top:710,bottom:760,left:850,right:980});h.refresh();assert.equal(h.button.styles['--scroll-top-bottom'],'102px');
 h.nodes['.sidebar-bottom']=element({top:720,bottom:800,left:0,right:1000});h.nodes['.social-launcher']=element({top:736,bottom:784,left:880,right:980});h.refresh();assert.equal(h.button.styles['--scroll-top-bottom'],'92px');
});
test('reduced-motion preference uses an immediate return and repeated scroll events share one frame',()=>{
 const h=setup();h.c.matchMedia=()=>({matches:true});h.main.scrollTop=750;for(let i=0;i<20;i++)h.events.get('scroll')();h.flush();h.click();assert.equal(h.main.calls[0].behavior,'instant');assert.equal(h.main.calls.length,1);
});
test('cleanup removes handlers and the control',()=>{const h=setup();h.c.SengokuScrollTop.destroy();assert.equal(h.button.isConnected,false);assert.equal(h.events.has('scroll'),false);});
console.log(`${count} page and nested-scroll checks passed. No external requests.`);
