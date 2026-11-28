'use strict';
// Mounted shared-estate refreshes retain live controls; the protocol is in memory.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup:domSetup}=require('./helpers/dom-model.cjs'),stable=require('../stable-dom.js');
const {view,clock,access,drain,deferred}=require('./test-court-estate-ui.cjs');
const {SENGOKU_DATA}=require('../engine.js');
const copy=value=>JSON.parse(JSON.stringify(value));
function setup(){
 const {doc,host}=domSetup(),create=doc.createElement.bind(doc);doc.hidden=false;
 doc.createElement=name=>{const node=create(name);Object.defineProperty(node,'className',{get(){return this.getAttribute('class')||'';},set(value){this.setAttribute('class',value);}});return node;};
 const entry=doc.createElement('button');host.appendChild(entry);entry.focus();
 let tick,elapsed=0,gate=null,calls=0,removals=0;const data=view(),time=clock();
 const scope={console,document:doc,Date,JSON,Math,Promise,Object,Set,localStorage:{getItem(){return null;},removeItem(){},setItem(){}},performance:{now:()=>elapsed},crypto:{randomUUID:()=> 'unused-refresh-request'},setInterval:callback=>{tick=callback;return 1;},clearInterval(){tick=null;},SENGOKU_DATA,SengokuStableDOM:stable,SengokuCloudSync:{flush:async()=>({ok:true})},SengokuBridge:{getExpansionAccess:()=>access(),refreshCourtEstateSurfaces(){},requestExpansion:async(route,options)=>{assert.equal(route,'/court/estate');assert.equal(options.method,'GET');calls++;if(gate)await gate.promise;return{ok:true,courtEstate:copy(data),clock:copy(time)};}}};
 scope.window=scope;vm.createContext(scope);vm.runInContext(fs.readFileSync(require.resolve('../court-estate.js'),'utf8'),scope);
 return{doc,data,api:scope.SengokuCourtEstate,get:selector=>doc.querySelector(selector),calls:()=>calls,hold(){gate=deferred();return gate;},release(){gate?.resolve();gate=null;},advance(ms){elapsed+=ms;time.elapsedMs+=ms;tick?.();},track(){doc.onRemove=()=>removals++;},removals:()=>removals};
}
(async()=>{
 const s=setup();await s.api.open({tab:'facilities'});const body=s.get('.estate-content'),details=s.get('.estate-balances'),choice=s.get('[data-estate="prepare"][data-target="farm"]');
 assert(choice);details.open=true;body.scrollTop=420;body.scrollLeft=6;choice.focus();s.track();
 s.hold();const refresh=s.api.refresh({silent:true});await drain();
 assert.strictEqual(s.get('.estate-balances'),details);assert.equal(details.open,true);assert.strictEqual(s.doc.activeElement,choice);assert.equal(choice.disabled,true,'spending stays fenced during a pending authoritative read');
 s.data.resources.gold=12123;s.data.actions.find(row=>row.id==='farm').cost.gold=2345;s.release();await refresh;
 assert.strictEqual(s.get('[data-estate="prepare"][data-target="farm"]'),choice);assert.strictEqual(s.doc.activeElement,choice);assert.strictEqual(s.get('.estate-balances'),details);assert.equal(details.open,true);assert.equal(choice.disabled,false);assert.equal(body.scrollTop,420);assert.equal(body.scrollLeft,6);assert.equal(s.removals(),0,'background reads do not tear down the mounted estate');
 assert(details.textContent.includes('12,123'),'new authoritative balances still appear');assert(s.get('[data-stable-key="estate-card:building:farm"]').textContent.includes('2,345'),'new quote arrives in its existing card');
 const count=s.calls();s.doc.hidden=true;s.advance(16000);await drain();assert.equal(s.calls(),count,'hidden dialogs do not poll');s.doc.hidden=false;s.advance(1000);await drain();assert.equal(s.calls(),count+1,'the next visible tick catches up');assert.equal(details.open,true);
 s.api.close();console.log('PASS mounted estate updates preserve expanded details, card identity, focus and scroll while applying fresh values; hidden polling pauses.');
})().catch(error=>{console.error(error);process.exitCode=1;});
