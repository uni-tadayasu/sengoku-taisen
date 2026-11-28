'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup,Node}=require('./helpers/dom-model.cjs');
if(!Object.getOwnPropertyDescriptor(Node.prototype,'lastElementChild'))Object.defineProperty(Node.prototype,'lastElementChild',{get(){return [...this.childNodes].reverse().find(node=>node.nodeType===1)||null;}});
const near=(actual,expected)=>assert(Math.abs(actual-expected)<1e-8,`${actual} is not near ${expected}`);
function fixture(){
 const {doc,host}=setup(),frames=new Map(),events=new Map();let stamp=1,frameId=0,width=800,height=600;
 const oldBounds=Node.prototype.getBoundingClientRect;
 Node.prototype.getBoundingClientRect=()=>({top:0,left:0,bottom:height,right:width,width,height});
 const win={document:doc,performance:{now:()=>stamp},requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id),addEventListener(type,callback){if(!events.has(type))events.set(type,new Set());events.get(type).add(callback);},removeEventListener(type,callback){events.get(type)?.delete(callback);},matchMedia:()=>({matches:true})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../world-map.js'),'utf8'),{window:win});
 const geography={bounds:[130,30,145,42],land:{type:'Polygon',coordinates:[[[130,30],[145,30],[145,42],[130,42],[130,30]]]},castles:{a:[135,35],b:[139,37],c:[132,33]}};
 const castles=[{id:'a',name:'本拠',owner:'自領',level:1},{id:'b',name:'隣城',owner:'他領',level:2},{id:'c',name:'新しい本拠',owner:'自領',level:3}];
 const options={stateKey:'home-entry',geography,castles,homeId:'a',selectedId:'b',initialView:'home',restoreView:false,clan:'自領'};
 const flush=()=>{let limit=100;while(frames.size){assert(limit-->0);const queued=[...frames.values()];frames.clear();stamp+=16;for(const callback of queued)callback(stamp);}};
 const mount=extra=>{const controller=win.SengokuWorldMap.mount(host,{...options,...extra});flush();return controller;};
 const center=(controller,id)=>{const [x,y]=win.SengokuWorldMap.project(...geography.castles[id]),view=controller.getView();near(view.x+view.width/2,x);near(view.y+view.height/2,y);};
 return{doc,host,castles,win,mount,flush,center,
  click(action){host.dispatchEvent({type:'click',target:host.querySelector(`[data-map-action="${action}"]`),stopPropagation(){}});flush();},
  resize(w,h){width=w;height=h;for(const callback of events.get('resize')||[])callback();flush();},
  close(controller){controller?.destroy();Node.prototype.getBoundingClientRect=oldBounds;}
 };
}
const tests=[];function test(name,run){tests.push([name,run]);}
test('first entry centers the home rather than a previously selected remote castle',()=>{
 const f=fixture(),controller=f.mount();try{f.center(controller,'a');near(controller.getView().zoom,14);}finally{f.close(controller);}
});
test('every remount starts at home while preserving the chosen map layers',()=>{
 const f=fixture();let controller=f.mount();try{
  controller.fit('selected',false);f.flush();f.center(controller,'b');f.click('labels');
  assert.equal(f.host.querySelector('[data-map-action="labels"]').getAttribute('aria-pressed'),'false');
  controller.destroy();controller=f.mount();f.center(controller,'a');
  assert.equal(f.host.querySelector('[data-map-action="labels"]').getAttribute('aria-pressed'),'false');
 }finally{f.close(controller);}
});
test('sync updates and repeated mount calls on an open map retain the current camera',()=>{
 const f=fixture(),controller=f.mount();try{
  controller.fit('selected',false);f.flush();const view=controller.getView();
  f.castles[1].level=8;
  for(let revision=0;revision<30;revision++){controller.update({castles:f.castles,homeId:'c',selectedId:'b',initialView:'home',restoreView:false});f.flush();}
  assert.deepEqual(controller.getView(),view);f.center(controller,'b');
  assert.strictEqual(f.mount({homeId:'c'}),controller);assert.deepEqual(controller.getView(),view);
 }finally{f.close(controller);}
});
test('resizing an already open map keeps its explored center and zoom',()=>{
 const f=fixture(),controller=f.mount();try{
  controller.fit('selected',false);f.flush();const zoom=controller.getView().zoom;
  for(const [width,height]of [[390,520],[768,500],[1180,420]]){f.resize(width,height);f.center(controller,'b');near(controller.getView().zoom,zoom);}
 }finally{f.close(controller);}
});
test('an unloaded public home is centered from trusted static coordinates without adding a marker',()=>{
 const f=fixture(),controller=f.mount({castles:[f.castles[1]]});try{
  f.center(controller,'a');assert.equal(f.host.querySelector('[data-map-marker="a"]'),null);
  controller.fit('selected',false);f.flush();const view=controller.getView();
  controller.update({castles:f.castles});f.flush();assert.deepEqual(controller.getView(),view);
  assert.equal(controller.fit('home',false),true);f.flush();f.center(controller,'a');
 }finally{f.close(controller);}
});
test('default maps can still restore their camera when home-on-entry was not requested',()=>{
 const f=fixture();let controller=f.mount({restoreView:true});try{
  controller.fit('selected',false);f.flush();const view=controller.getView();controller.destroy();
  controller=f.mount({restoreView:true});assert.deepEqual(controller.getView(),view);f.center(controller,'b');
 }finally{f.close(controller);}
});
test('an initially hidden map centers home when it receives its first usable size',()=>{
 const f=fixture();f.resize(0,0);const controller=f.mount();try{f.resize(390,520);f.center(controller,'a');}finally{f.close(controller);}
});
test('unknown home coordinates leave a valid overview and cannot introduce NaN geometry',()=>{
 const f=fixture(),controller=f.mount({homeId:'missing'});try{
  const view=controller.getView();assert(Object.values(view).every(Number.isFinite));near(view.zoom,1);
  assert.equal(controller.fit('home',false),false);assert.deepEqual(controller.getView(),view);
 }finally{f.close(controller);}
});
for(const [name,run]of tests){run();console.log('PASS '+name);}
console.log(tests.length+' home entry camera scenarios passed. No external requests.');
