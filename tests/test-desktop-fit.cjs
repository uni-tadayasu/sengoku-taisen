'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {planViewport,desktopMode}=require('../desktop-fit.js');
const source=fs.readFileSync(path.join(__dirname,'../desktop-fit.js'),'utf8');
const css=fs.readFileSync(path.join(__dirname,'../desktop-fit.css'),'utf8'),responsive=fs.readFileSync(path.join(__dirname,'../responsive-layout.css'),'utf8');
let count=0;function test(name,fn){fn();count++;console.log('PASS '+name);}
function harness({width=1366,height=936,touch=0,fine=true,coarse=false,announcement=37}={}){
 const classes=new Set(),vars=new Map(),frames=new Map(),mutations=[],resizes=[];let nextFrame=0;
 const classList={contains:name=>classes.has(name),toggle(name,on){if(on)classes.add(name);else classes.delete(name);},remove(name){classes.delete(name);}};
 const root={classList,style:{getPropertyValue:name=>vars.get(name)||'',setProperty:(name,value)=>vars.set(name,value)}};
 const makeNode=()=>({style:{left:'125px',top:'70px',transform:'scale(.37)',minHeight:'1400px'},dataset:{desktopScale:'.370'}});
 const app=makeNode(),launch=makeNode(),dialog=makeNode(),bodyPane={scrollTop:170};
 const header={position:'sticky',getBoundingClientRect:()=>({height:164})},announcementNode={hidden:false,offsetHeight:announcement,position:'sticky'};
 const selected={dataset:{view:'town'},left:0,right:100,getBoundingClientRect(){return{left:this.left-navigation.scrollLeft,right:this.right-navigation.scrollLeft};}};
 const navigation={clientWidth:360,scrollWidth:900,scrollLeft:0,querySelector:()=>selected,getBoundingClientRect:()=>({left:0,right:360})};
 // Long forms and hundreds of messages must never determine the scale factor.
 for(const node of [app,launch,dialog])for(const property of ['offsetWidth','offsetHeight','scrollWidth','scrollHeight'])Object.defineProperty(node,property,{get(){throw Error('Natural-content measurement would shrink readable UI');}});
 dialog.open=true;dialog.querySelector=()=>bodyPane;
 const queries=[];
 const document={documentElement:root,body:{classList:{contains:()=>false}},readyState:'loading',addEventListener(){},removeEventListener(){},getElementById:id=>({app,'announcement-bar':announcementNode,navigation}[id]||null),querySelector:selector=>selector==='#app .topbar'?header:null,querySelectorAll(selector){queries.push(selector);if(selector.startsWith('#app,'))return[app,launch,dialog];if(selector.startsWith('dialog[open]'))return[dialog];if(selector==='#announcement-bar,.topbar')return[announcementNode,header];return[];}};
 const media={matches:fine,addEventListener(){},removeEventListener(){}},coarseMedia={...media,matches:coarse};
 const environment={document,navigator:{maxTouchPoints:touch},innerWidth:width,innerHeight:height,visualViewport:{width,height,offsetLeft:0,offsetTop:0,addEventListener(){},removeEventListener(){}},getComputedStyle:node=>({position:node.position||'static'}),matchMedia:q=>q==='(any-pointer: coarse)'?coarseMedia:media,addEventListener(){},removeEventListener(){},requestAnimationFrame(callback){frames.set(++nextFrame,callback);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),module:{exports:{}}};
 for(const [name,list]of [['MutationObserver',mutations],['ResizeObserver',resizes]])environment[name]=class{constructor(callback){this.callback=callback;this.observed=[];list.push(this);}observe(node,options){this.observed.push({node,options});}disconnect(){this.observed=[];}};
 vm.runInNewContext(source,environment);const api=environment.module.exports;
 function flush(){let turns=0;while(frames.size){assert(++turns<10,'Responsive refresh must settle without a feedback loop');const queued=[...frames.values()];frames.clear();queued.forEach(callback=>callback());}}
 function refresh(){api.refresh();flush();}
 return{api,environment,app,launch,dialog,bodyPane,vars,classes,media,coarseMedia,header,announcementNode,navigation,selected,refresh,flush,mutations,resizes,pendingFrames:()=>frames.size};
}
test('desktop uses every available CSS pixel through 200 percent browser zoom',()=>{
 for(const [w,h]of [[1920,1080],[1440,900],[1366,936],[1280,720]])for(const zoom of [1,1.25,1.5,1.75,2]){
  const p=planViewport(w/zoom,h/zoom,37);assert.equal(p.layoutWidth,w/zoom);assert.equal(p.layoutHeight,h/zoom-37);assert.equal(p.availableWidth,p.viewportWidth);assert.equal(p.availableHeight,p.layoutHeight);
 }
 assert.equal(planViewport(683,468,37).layoutWidth,683,'A zoomed PC must not keep an invisible 1100px canvas');
});
test('announcement cannot produce a negative or offscreen content rectangle',()=>{
 assert.equal(planViewport(320,240,800).layoutHeight,1);assert.equal(planViewport(320,240,-8).top,0);
 const p=planViewport(1366,936,37);assert.equal(p.top+p.layoutHeight,p.viewportHeight);
});
test('touch tablets retain document flow with an attached fine pointer',()=>{
 assert.equal(desktopMode(true,0,false),true);assert.equal(desktopMode(false,0,false),false);assert.equal(desktopMode(true,5,false),false);assert.equal(desktopMode(true,0,true),false);assert.equal(desktopMode(false,5,true),false);
});
test('phone and tablet widths use the same compact layout with a desktop mouse',()=>{
 for(const width of [320,360,390,430,768,820,1024]){
  const h=harness({width});h.refresh();assert.equal(h.api.getStatus().mode,'flow',width+'px');assert(!h.classes.has('sengoku-desktop-fit'));assert.equal(h.app.dataset.desktopScale,undefined);assert.equal(h.app.style.transform,'');
 }
 for(const width of [1025,1280,1440,1920]){const h=harness({width});h.refresh();assert.equal(h.api.getStatus().mode,'desktop',width+'px');}
});
test('game text entry releases fixed navigation only when the keyboard occupies the visual viewport',()=>{
 const h=harness({width:390,height:844,touch:1,fine:false,coarse:true});
 h.environment.document.activeElement={matches:selector=>selector.includes('#main input')};
 h.environment.visualViewport.height=844;h.refresh();assert(!h.classes.has('sengoku-compact-input'));
 h.environment.visualViewport.height=480;h.refresh();assert(h.classes.has('sengoku-compact-input'));
 h.environment.visualViewport.scale=1.5;h.refresh();assert(!h.classes.has('sengoku-compact-input'));
 h.environment.visualViewport.scale=1;h.environment.document.activeElement={matches:()=>false};h.refresh();assert(!h.classes.has('sengoku-compact-input'));
});
test('actual runtime removes a legacy scale without reading long-page dimensions',()=>{
 const h=harness();h.refresh();const s=h.api.getStatus();assert.equal(s.active,true);assert.equal(s.mode,'desktop');assert.equal(s.scale,1);assert.equal(s.visibleWidth,1366);assert.equal(s.visibleHeight,899);assert.equal(h.vars.get('--desktop-layout-width'),'1366.000px');assert.equal(h.vars.get('--desktop-offset-top'),'37.000px');
 for(const n of [h.app,h.launch,h.dialog]){assert.equal(n.style.transform,'');assert.equal(n.style.left,'');assert.equal(n.style.top,'');assert.equal(n.style.minHeight,'');}assert.equal(h.app.dataset.desktopScale,'1.000');assert.equal(h.dialog.dataset.desktopScale,'1.000');assert.equal(h.bodyPane.scrollTop,170,'Refreshing the viewport must not reset a form/history reader');
});
test('zoom, viewport offsets, and repeated refresh keep native scale',()=>{
 const h=harness();h.refresh();h.environment.innerWidth=683;h.environment.innerHeight=468;Object.assign(h.environment.visualViewport,{width:683,height:468,offsetLeft:7,offsetTop:9});h.refresh();const first=JSON.stringify(h.api.getStatus());
 assert.equal(h.vars.get('--desktop-layout-width'),'683.000px');assert.equal(h.vars.get('--desktop-layout-height'),'431.000px');assert.equal(h.vars.get('--desktop-offset-left'),'7.000px');assert.equal(h.vars.get('--desktop-offset-top'),'46.000px');assert.equal(h.api.getStatus().scale,1);
 for(let i=0;i<10;i++)h.refresh();assert.equal(JSON.stringify(h.api.getStatus()),first);
});
test('switching to touch clears desktop geometry and retains keyboard viewport height',()=>{
 const h=harness();h.refresh();h.environment.navigator.maxTouchPoints=5;h.environment.visualViewport.height=310;h.refresh();assert(!h.classes.has('sengoku-desktop-fit'));assert.equal(h.api.getStatus().mode,'flow');assert.equal(h.vars.get('--visible-height'),'310.000px');assert.equal(h.app.dataset.desktopScale,undefined);assert.equal(h.app.style.transform,'');
});
test('resizing a desktop to compact width and back preserves normal desktop geometry',()=>{
 const h=harness();h.refresh();h.environment.innerWidth=390;h.environment.visualViewport.width=390;h.refresh();assert.equal(h.api.getStatus().mode,'flow');assert.equal(h.app.dataset.desktopScale,undefined);
 h.environment.innerWidth=1440;h.environment.visualViewport.width=1440;h.refresh();assert.equal(h.api.getStatus().mode,'desktop');assert.equal(h.app.dataset.desktopScale,'1.000');assert.equal(h.vars.get('--desktop-layout-width'),'1440.000px');assert.equal(h.bodyPane.scrollTop,170);
});
test('horizontal menu reveals a new selection without resetting deliberate menu or form scrolling',()=>{
 const h=harness({width:390});h.selected.dataset.view='army';h.selected.left=650;h.selected.right=750;h.refresh();assert.equal(h.navigation.scrollLeft,394);assert.equal(h.bodyPane.scrollTop,170);
 h.navigation.scrollLeft=20;h.refresh();assert.equal(h.navigation.scrollLeft,20,'Periodic refresh must let the player browse other menu entries');
 h.selected.dataset.view='covert';h.selected.left=420;h.selected.right=520;h.refresh();assert.equal(h.navigation.scrollLeft,164);
});
test('short-window headers reserve scroll space only while they are sticky',()=>{
 const h=harness({width:820,height:390});h.refresh();assert.equal(h.vars.get('--touch-header-height'),'164.000px');assert.equal(h.vars.get('--touch-announcement-height'),'37.000px');
 h.header.position='relative';h.announcementNode.position='relative';h.refresh();assert.equal(h.vars.get('--touch-header-height'),'0.000px');assert.equal(h.vars.get('--touch-announcement-height'),'0.000px');assert.equal(h.api.getStatus().mode,'flow');
});
test('routine text-only updates do not schedule viewport measurements',()=>{
 const h=harness();h.refresh();const target={nodeType:1,closest:()=>null};
 const records=Array.from({length:100},()=>({type:'childList',target,addedNodes:[{nodeType:3}],removedNodes:[{nodeType:3}]}));
 h.mutations[0].callback(records);assert.equal(h.pendingFrames(),0,'health, army, economy and hint numbers must not trigger whole-page geometry');
 h.mutations[0].callback([{type:'childList',target,addedNodes:[],removedNodes:[{nodeType:3}]}]);assert.equal(h.pendingFrames(),0);
});
test('real structure, view and dialog visibility changes still schedule layout',()=>{
 const h=harness();h.refresh();const target={nodeType:1,closest:()=>null};
 for(const change of [
  {type:'childList',addedNodes:[{nodeType:1}],removedNodes:[]},
  {type:'childList',addedNodes:[],removedNodes:[{nodeType:1}]},
  {type:'attributes',attributeName:'open'},
  {type:'attributes',attributeName:'hidden'},
  {type:'attributes',attributeName:'class'},
  {type:'attributes',attributeName:'data-view'}
 ]){h.mutations[0].callback([{target,...change}]);assert.equal(h.pendingFrames(),1,change.attributeName||'Element structure');h.flush();}
});
test('text-caused header resizing still updates viewport through ResizeObserver',()=>{
 const h=harness({width:820});h.refresh();const observer=h.resizes[0];
 assert(observer.observed.some(entry=>entry.node===h.header));assert(observer.observed.some(entry=>entry.node===h.announcementNode));
 h.announcementNode.offsetHeight=61;observer.callback([{target:h.announcementNode}]);assert.equal(h.pendingFrames(),1);h.flush();
 assert.equal(h.vars.get('--desktop-offset-top'),'61.000px');assert.equal(h.vars.get('--touch-announcement-height'),'61.000px');
});
test('destroy removes legacy geometry and releases desktop overflow mode',()=>{
 const h=harness();h.refresh();h.api.destroy();assert(!h.classes.has('sengoku-desktop-fit'));assert.equal(h.app.dataset.desktopScale,undefined);assert.equal(h.api.getStatus().active,false);h.api.refresh();assert.equal(h.api.getStatus().active,false);
});
function block(text,selector){const escaped=selector.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),match=text.match(new RegExp(escaped+'\\{([^}]+)\\}'));assert(match,'Missing rule: '+selector);return match[1];}
test('desktop shell fixes the viewport while main content can scroll at readable size',()=>{
 const app=block(css,'.sengoku-desktop-fit #app.game-shell');assert(app.includes('height:var(--desktop-layout-height,100dvh)'));assert(app.includes('grid-template-rows:auto minmax(0,1fr) auto'));assert(app.includes('transform:none'));
 assert(block(css,'.sengoku-desktop-fit .workspace').includes('display:contents'));assert(block(css,'.sengoku-desktop-fit .topbar').includes('grid-column:1/-1'));const main=block(css,'.sengoku-desktop-fit #main');assert(main.includes('overflow-y:auto'));assert(main.includes('min-height:0'));assert(main.includes('container-type:inline-size'));
 assert(block(css,'.sengoku-desktop-fit .input,.sengoku-desktop-fit .select').includes('font-size:16px'));
});
test('dialogs have bounded middle panes and never scale long histories',()=>{
 for(const selector of ['.sengoku-desktop-fit .modal','.sengoku-desktop-fit .social-dialog']){const b=block(css,selector);assert(b.includes('transform:none'));assert(b.includes('max-height:calc(var(--visible-height'));assert(b.includes('overflow:hidden'));assert(b.includes('margin:auto'));}
 assert(block(css,'.sengoku-desktop-fit .modal-body').includes('overflow-y:auto'));assert(block(css,'.sengoku-desktop-fit .social-body').includes('overflow-y:auto'));assert(block(css,'.sengoku-desktop-fit .social-message-list').includes('overflow-y:auto'));assert(block(css,'.sengoku-desktop-fit .social-confirm-card .social-actions').includes('position:sticky'));
 assert(responsive.includes('.sengoku-desktop-fit .social-staff-layout{grid-template-columns:1fr}'),'Narrow dialogs must reflow instead of scaling a 940px form');
});
test('touch navigation, map controls, and footer reserve safe touch areas',()=>{
 assert(block(responsive,'html:not(.sengoku-desktop-fit) #app.game-shell').includes('flex-direction:column'));assert(block(responsive,'html:not(.sengoku-desktop-fit) #main').includes('overflow:visible'));const nav=block(responsive,'html:not(.sengoku-desktop-fit) .navigation .nav-item');assert(nav.includes('min-height:54px'));
 const map=block(responsive,'html:not(.sengoku-desktop-fit) .sg-map-control');assert(map.includes('height:44px!important'));assert(map.includes('width:44px!important'));assert(block(responsive,'html:not(.sengoku-desktop-fit) .sidebar-bottom').includes('env(safe-area-inset-bottom)'));assert(block(responsive,'html:not(.sengoku-desktop-fit) .game-footer').includes('92px + env(safe-area-inset-bottom)'));
});
console.log(count+' responsive viewport checks passed.');
