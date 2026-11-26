'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {setup,Node}=require('./helpers/dom-model.cjs');
if(!Object.getOwnPropertyDescriptor(Node.prototype,'lastElementChild')){
  Object.defineProperty(Node.prototype,'lastElementChild',{get(){return [...this.childNodes].reverse().find(child=>child.nodeType===1);}});
}
const source=fs.readFileSync(require.resolve('../world-map.js'),'utf8');
const stable=fs.readFileSync(require.resolve('../stable-dom.js'),'utf8');
const geography={bounds:[130,30,145,42],land:{type:'Polygon',coordinates:[[[130,30],[145,30],[145,42],[130,42],[130,30]]]},
  castles:{a:[135,35],b:[143,37],edo:[139.75,35.68]}};
const castles=[{id:'a',name:'西城',region:'近畿',owner:'織田家',troops:100},{id:'b',name:'東城',region:'関東',owner:'武田家',troops:200,reachable:true},{id:'edo',name:'江戸城',region:'関東',owner:'徳川家',troops:300}];
const contents=new Map();
let readCount=0,storageWrites=0,failWrites=false;
const storage={getItem(key){readCount++;return contents.get(key)||null;},setItem(key,value){if(failWrites)throw Error('quota');storageWrites++;contents.set(key,value);},removeItem(key){if(failWrites)throw Error('denied');storageWrites++;contents.delete(key);}};
function tab({player='one',campaign='run_1',stateKey='campaign-map',isAdmin=false,region='all',started=true,onSelect}={}){
  const {host,doc,$}=setup(),events=new Map(),frames=new Map(),selected=[];
  let clock=1,frame=0,access={playerId:player,user:player?{id:player}:null};
  const win={document:doc,localStorage:storage,matchMedia:()=>({matches:true}),performance:{now:()=>clock},
    requestAnimationFrame(fn){frames.set(++frame,fn);return frame;},cancelAnimationFrame(id){frames.delete(id);},
    addEventListener(type,fn){events.set(type,fn);},removeEventListener(type){events.delete(type);},
    SengokuBridge:{getState:()=>({walking:{campaignId:campaign},home:'a',clan:'織田家'}),hasStarted:()=>started},SengokuSocial:{getExpansionContext:()=>access}};
  const context={window:win,document:doc};
  vm.runInNewContext(stable,context);vm.runInNewContext(source,context);
  const controller=win.SengokuWorldMap.mount(host,{stateKey,isAdmin,geography,castles,clan:'織田家',homeId:'a',selectedId:'a',region,onSelect:id=>{selected.push(id);onSelect?.(id);}});
  function flush(){let limit=50;while(frames.size){assert(limit-->0);const f=[...frames.values()];frames.clear();clock+=16;f.forEach(fn=>fn(clock));}}
  const fire=(node,type,extra={})=>{assert(node);node.dispatchEvent({type,stopPropagation(){},...extra});};
  const click=selector=>fire($(selector),'click');
  flush();
  return {controller,host,doc,$,flush,click,fire,events,selected,setAccess:next=>access=next,open:()=>click('[data-watch-open]'),rows:()=>host.querySelectorAll('[data-watch-visit]').map(n=>n.dataset.watchVisit)};
}
const first=tab();
assert.equal(first.$('[data-watch-panel]').hidden,true);
assert.equal(readCount,0,'No bookmark storage traffic on the closed map');
first.open();assert.equal(first.doc.activeElement,first.$('[data-watch-close]'));
assert.match(first.$('[data-watch-status]').textContent,/城を選び/);
first.click('[data-watch-toggle]');assert.deepEqual(first.rows(),['a']);assert.equal(first.$('[data-watch-toggle]').getAttribute('aria-pressed'),'true');
console.log('PASS selected castle registration updates the label, local storage and count');

const second=tab();second.open();assert.deepEqual(second.rows(),['a']);
second.controller.update({selectedId:'b'});second.click('[data-watch-toggle]');
assert.match(second.$('[data-watch-visit="b"]').textContent,/自領に隣接/);
assert.doesNotMatch(second.$('[data-watch-visit="b"]').textContent,/進軍可能/,'Adjacency alone does not authorize a march');
const bKey=[...contents.keys()].find(key=>key.endsWith(':b'));
first.events.get('storage')({key:bKey});assert.deepEqual(first.rows(),['a','b']);
first.click('[data-watch-remove="a"]');
second.events.get('storage')({key:[...contents.keys()][0].replace(/:b$/,':a')});assert.deepEqual(second.rows(),['b']);
assert.equal(storageWrites,3);
console.log('PASS reopened maps and separate tabs merge independent castle edits');

const beforeRead=readCount;
first.controller.update({castles:castles.map(point=>point.id==='b'?{...point,owner:'上杉家',troops:1234}:point),region:'近畿'});first.flush();
assert.match(first.$('[data-watch-visit="b"]').textContent,/上杉家.*1,234兵/);
const button=first.$('[data-watch-visit="b"]');button.focus();
first.controller.update({turn:2});first.flush();assert.equal(first.doc.activeElement,button);
assert.equal(readCount,beforeRead,'Sync and camera changes use the cached marks');
first.click('[data-watch-visit="b"]');first.flush();assert.deepEqual(first.selected,['b']);assert.equal(first.$('[data-watch-panel]').hidden,true);
const camera=first.controller.getView(),projection=require('../world-map.js').project(...geography.castles.b);
assert(Math.abs(camera.x+camera.width/2-projection[0])<1e-6&&Math.abs(camera.y+camera.height/2-projection[1])<1e-6);
assert(first.$('[data-map-marker="b"]'),'A reselected castle outside the current region remains visible');
console.log('PASS live allegiance and garrison, focus stability and exact map jump across regions');

const privileged=tab({isAdmin:true});privileged.open();privileged.controller.update({selectedId:'edo'});privileged.click('[data-watch-toggle]');privileged.controller.update({isAdmin:false});privileged.flush();
assert(privileged.$('[data-watch-visit="edo"]').disabled);assert(privileged.$('[data-watch-toggle]').disabled);
privileged.click('[data-watch-visit="edo"]');assert.deepEqual(privileged.selected,[]);
privileged.click('[data-watch-remove="edo"]');assert(!privileged.rows().includes('edo'));
console.log('PASS changed permissions prevent selection and still allow removal');

for(const other of [{player:'two'},{campaign:'run_2'},{player:''}]){
  const isolated=tab(other);isolated.open();assert.deepEqual(isolated.rows(),[]);isolated.controller.destroy();
}
first.open();first.setAccess({pending:true,playerId:'one'});first.click('[data-watch-remove="b"]');assert.deepEqual(first.rows(),[]);assert(contents.has(bKey));
first.setAccess({playerId:'one',user:{id:'one'}});first.controller.update({});assert.deepEqual(first.rows(),['b']);
const atStart=tab({started:false});atStart.open();assert(atStart.$('[data-watch-toggle]').disabled);assert.deepEqual(atStart.rows(),[]);atStart.controller.destroy();
console.log('PASS account, offline, title and campaign scopes isolate marks and stale actions');

failWrites=true;first.click('[data-watch-remove="b"]');assert.deepEqual(first.rows(),['b']);assert.match(first.$('[data-watch-status]').textContent,/保存できません/);failWrites=false;
first.fire(first.$('[data-watch-close]'),'keydown',{key:'Escape',isComposing:true});assert(!first.$('[data-watch-panel]').hidden);
first.fire(first.$('[data-watch-close]'),'keydown',{key:'Escape'});assert(first.$('[data-watch-panel]').hidden);assert.equal(first.doc.activeElement,first.$('[data-watch-open]'));
first.open();first.fire(first.host,'pointerdown',{target:first.$('.sg-map-heading')});assert(first.$('[data-watch-panel]').hidden);
const field=tab({stateKey:'field-map'});assert(!field.$('[data-watch-open]'));assert(!field.events.has('storage'));
first.controller.destroy();second.controller.destroy();privileged.controller.destroy();field.controller.destroy();assert(!first.events.has('storage'));
console.log('PASS storage error feedback, keyboard/outside close, disposal and campaign-only controls');
