'use strict';
// Navigation must release hidden artwork trees and restore reused dialog nodes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8');

function fixture(markup){
 const {doc,host,$}=setup(),observed=new Set(),requests=[],frames=[],handlers={};
 host.innerHTML=markup;doc.readyState='complete';
 let mutations,intersections;
 class IntersectionObserver{
  constructor(callback){intersections=callback;}
  observe(node){observed.add(node);}
  unobserve(node){observed.delete(node);}
 }
 class MutationObserver{constructor(callback){mutations=callback;}observe(){}}
 const window={SENGOKU_AT_TITLE:false,innerWidth:1200,innerHeight:800,IntersectionObserver,addEventListener:(name,fn)=>handlers[name]=fn};
 vm.runInNewContext(source,{window,document:doc,IntersectionObserver,MutationObserver,requestAnimationFrame:fn=>frames.push(fn),Image:class{set src(url){this.url=url;requests.push(this);}}});
 return{doc,host,$,window,observed,requests,frames,handlers,mutate:records=>mutations(records),intersect:node=>intersections([{target:node,isIntersecting:true,boundingClientRect:node.getBoundingClientRect()}])};
}
function row(){return '<section><span data-art-url="portrait.webp"></span><button>家臣を選ぶ</button></section>';}

(async()=>{
 const f=fixture('<div id="roster">'+row().repeat(120)+'</div><div id="next"></div>');
 const roster=f.$('#roster'),targets=[...f.observed];
 assert.equal(targets.length,240,'Each card and control has one visibility subscription');
 roster.remove();f.mutate([{target:f.host,removedNodes:[roster],addedNodes:[]}]);
 assert.equal(f.observed.size,0,'Changing screens releases every detached observer target');
 for(const target of targets)f.intersect(target);
 assert.equal(f.requests.length,0,'Queued callbacks cannot start downloads for a discarded view');

 f.host.appendChild(roster);f.mutate([{target:f.host,removedNodes:[],addedNodes:[roster]}]);
 f.frames.shift()();
 assert.equal(f.observed.size,240,'Reopened cached dialogs restore unfinished image subscriptions');
 assert.equal(roster.querySelectorAll('button svg').length,120,'Reusing a dialog never duplicates its decoration');

 f.$('#next').appendChild(roster);f.mutate([{target:f.host,removedNodes:[roster],addedNodes:[]},{target:f.$('#next'),removedNodes:[],addedNodes:[roster]}]);
 assert.equal(f.observed.size,240,'Moving a still-connected tree preserves active subscriptions');
 while(f.frames.length)f.frames.shift()();
 assert.equal(f.observed.size,240);

 const image=roster.querySelector('[data-art-url]');
 f.intersect(image);assert.equal(f.requests.length,1);f.requests[0].onload();await Promise.resolve();await Promise.resolve();
 assert.equal(image.dataset.artReady,'1');assert(!f.observed.has(image));
 console.log('PASS 240 detached targets released, reused dialogs restored, connected moves preserved, stale callbacks ignored.');

 const hidden=fixture('<dialog id="closed"><span data-art-url="closed.webp"></span></dialog><section hidden><span data-art-url="hidden.webp"></span></section><section inert><span data-art-url="inert.webp"></span></section><dialog open><span id="visible" data-art-url="visible.webp"></span></dialog>');
 const reads=[];
 for(const node of hidden.doc.querySelectorAll('[data-art-url]'))node.getBoundingClientRect=()=>{reads.push(node.dataset.artUrl);return{top:0,left:0,right:80,bottom:100,width:80,height:100};};
 const loading=hidden.window.SengokuArt.readyCurrent();
 assert.deepEqual(reads,['visible.webp'],'Closed, hidden and inert subtrees never force geometry reads');
 assert.deepEqual(hidden.requests.map(request=>request.url),['visible.webp']);
 hidden.requests[0].onload();await loading;
 hidden.$('#closed').open=true;
 const reopened=hidden.window.SengokuArt.readyCurrent();
 assert.equal(hidden.requests.at(-1).url,'closed.webp','Opening the dialog makes its artwork available normally');
 hidden.requests.at(-1).onload();await reopened;
 console.log('PASS hidden dialogs avoid layout and image work until they are opened.');

 const pending=fixture('<dialog id="pending" open><span data-art-url="large.webp" data-art-small="small.webp" data-small-width="40" data-small-height="40"></span></dialog>'),dialog=pending.$('#pending'),painting=dialog.querySelector('[data-art-url]');
 let measured=0;painting.getBoundingClientRect=()=>{measured++;return{top:0,left:0,right:200,bottom:200,width:200,height:200};};
 const preview=pending.window.SengokuArt.readyCurrent();assert.equal(pending.requests[0].url,'small.webp');dialog.open=false;measured=0;
 pending.requests[0].onload();await preview;
 assert.equal(measured,0,'Closing while a preview decodes must not measure the hidden dialog');assert.equal(pending.requests.length,1,'The hidden dialog must not upgrade to the larger atlas');assert.equal(painting.dataset.artReady,undefined);assert(pending.observed.has(painting));
 dialog.open=true;const upgraded=pending.window.SengokuArt.readyCurrent();await Promise.resolve();await Promise.resolve();assert.equal(pending.requests.at(-1).url,'large.webp');assert.equal(painting.dataset.artSource,'small.webp');
 dialog.open=false;pending.requests.at(-1).onload();await upgraded;assert.equal(painting.dataset.artSource,'small.webp','An in-flight full image waits until the dialog is visible before repainting');
 dialog.open=true;await pending.window.SengokuArt.readyCurrent();assert.equal(painting.dataset.artSource,'large.webp');assert.equal(pending.requests.length,2,'Reopening reuses both decoded atlases without another request');
 console.log('PASS dialogs closed during preview or full-image decoding remain idle and reuse decoded images on reopen.');
})().catch(error=>{console.error(error);process.exitCode=1;});
