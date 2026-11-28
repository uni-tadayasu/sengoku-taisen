'use strict';
// Run the production app's background-render transaction against deterministic
// row geometry. The delayed height change represents the following layout frame.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const stable=require('../stable-dom.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){
 const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);
 const end=source.indexOf('\n  }',start);assert(end>start,name);
 return source.slice(start,end+4);
}
function fixture(){
 const {doc,host}=setup(),pane=doc.createElement('dialog'),frames=[];
 doc.body.appendChild(pane);pane.appendChild(host);pane.open=true;host.id='main';
 doc.getElementById=id=>doc.body.querySelector('#'+id);
 doc.defaultView={innerHeight:200,innerWidth:400};
 pane.clientHeight=200;pane.clientWidth=400;
 pane.getBoundingClientRect=()=>({top:20,left:0,bottom:220,right:400,width:400,height:200});
 function draw(height){
  stable.patch(host,['a','b','c','d','e'].map(id=>`<article data-stable-key="${id}" data-row="${id}" data-height="${id==='a'?height:100}"><p>${id}</p><input id="edit-${id}" value="0"></article>`).join(''),{key:'list'});
  for(const row of host.querySelectorAll('[data-row]')){
   const rect=(offset,height)=>{
    const siblings=host.childNodes.filter(node=>node.hasAttribute?.('data-row')),index=siblings.indexOf(row);
    const top=20+siblings.slice(0,index).reduce((sum,node)=>sum+Number(node.getAttribute('data-height')),0)-pane.scrollTop+offset;
    return{top,left:0,bottom:top+height,right:400,width:400,height};
   };
   row.getBoundingClientRect=()=>rect(0,Number(row.getAttribute('data-height')));
   row.querySelector('p').getBoundingClientRect=()=>rect(10,20);
   row.querySelector('input').getBoundingClientRect=()=>rect(40,24);
  }
 }
 draw(100);pane.scrollTop=150;
 const scope={
  document:doc,window:{SengokuStableDOM:stable,scrollX:0,scrollY:0,requestAnimationFrame:callback=>frames.push(callback),scrollTo(){}},
  $:selector=>doc.querySelector(selector),interactionEpoch:0,currentView:'map',interactionRestores:new WeakMap(),
  refreshLiveControls(){},refreshJobTimers(){}
 };
 vm.createContext(scope);vm.runInContext(['interactionLocator','locateInteraction','preserveInteraction'].map(fn).join('\n'),scope);
 return{doc,host,pane,scope,draw,row:host.querySelector('[data-row="c"]'),
  refresh:height=>scope.preserveInteraction(host,()=>draw(height)),
  layout:height=>host.querySelector('[data-row="a"]').setAttribute('data-height',String(height)),
  settle(){let count=0;while(frames.length){assert(++count<20,'background work must settle');frames.shift()();}}
 };
}
const checks=[];function test(name,run){checks.push([name,run]);}
test('consecutive sync and role redraws retain their anchor through the following layout frame',()=>{
 const f=fixture(),before=f.row.getBoundingClientRect().top;
 f.refresh(150);f.refresh(200);f.layout(230);f.settle();
 assert.equal(f.row.getBoundingClientRect().top,before,'a delayed layout must not move the visible row');
 assert.equal(f.pane.scrollTop,280);
 assert.equal(f.host.style.overflowAnchor,'');
});
test('repeated background redraws keep a focused draft and its text selection',()=>{
 const f=fixture(),input=f.host.querySelector('#edit-c');input.value='typed draft';input.setSelectionRange(2,7);input.focus();
 const before=input.getBoundingClientRect().top;
 f.refresh(150);f.refresh(200);f.layout(240);f.settle();
 assert.strictEqual(f.doc.activeElement,input);assert.strictEqual(f.host.querySelector('#edit-c'),input);
 assert.equal(input.value,'typed draft');assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,7);
 assert.equal(input.getBoundingClientRect().top,before);
});
test('a user scroll takes precedence over pending background restoration',()=>{
 const f=fixture();f.refresh(150);f.scope.interactionEpoch++;f.pane.scrollTop=275;f.layout(180);f.settle();
 assert.equal(f.pane.scrollTop,275);assert.equal(f.host.style.overflowAnchor,'');
});
test('an unrelated programmatic scroll is not undone by the following frame',()=>{
 const f=fixture();f.refresh(150);f.pane.scrollTop=260;f.layout(180);f.settle();
 assert.equal(f.pane.scrollTop,260);assert.equal(f.host.style.overflowAnchor,'');
});
test('a mobile keyboard viewport change cancels the pending restore',()=>{
 const f=fixture();f.doc.defaultView.visualViewport={width:390,height:200,offsetTop:0,offsetLeft:0,scale:1};
 f.refresh(150);f.doc.defaultView.visualViewport.height=120;f.doc.defaultView.visualViewport.offsetTop=40;
 f.pane.scrollTop=225;f.layout(190);f.settle();
 assert.equal(f.pane.scrollTop,225);assert.equal(f.host.style.overflowAnchor,'');
});
test('navigation cannot inherit an older view\'s pending scroll position',()=>{
 const f=fixture();f.refresh(150);f.scope.currentView='town';f.scope.interactionEpoch++;f.pane.scrollTop=0;f.layout(180);f.settle();
 assert.equal(f.pane.scrollTop,0);assert.equal(f.host.style.overflowAnchor,'');
});
for(const [name,run]of checks){run();console.log('PASS '+name);}
console.log(checks.length+' background scroll scenarios passed. No external requests.');
