'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function sourceFunction(name){const start=source.indexOf('  function '+name+'(');assert(start>=0,name);const lineEnd=source.indexOf('\n',start),line=source.slice(start,lineEnd);if(name==='syncWorldMap')return line;const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
function fixture({desktop=true,navigation=true,mainPresent=true}={}){
 const {doc,host}=setup(),events=[],renders=[],state={home:'home',clan:'自領',castles:{home:{owner:'自領'},remote:{owner:'他領'},next:{owner:'自領'}},treaties:[],turn:2};
 host.id='main';host.innerHTML='<div id="world-map"></div>';doc.documentElement=doc.createElement('html');if(desktop)doc.documentElement.classList.add('sengoku-desktop-fit');
 let top=180,left=40;Object.defineProperty(host,'scrollTop',{get:()=>top,set:value=>{events.push('main-top');top=value;}});Object.defineProperty(host,'scrollLeft',{get:()=>left,set:value=>{events.push('main-left');left=value;}});host.scrollIntoView=()=>events.push('fallback-reveal');
 const controller={camera:'prior',options:null,fit(target,animated){events.push('fit:'+target);this.camera=target;assert.equal(animated,false);},update(options){events.push('update-map');this.options=options;},destroy(){events.push('destroy-map');}};
 const scope={document:doc,console,Set,Map,Promise,currentView:'town',selectedCastle:'remote',mapRegion:'north',interactionEpoch:0,worldMapController:null,worldMapElement:null,staffBaseId:'court',history:{state:{fixture:true},replaceState(value,title,hash){events.push('history:'+hash);}},
  state:()=>state,data:{buildings:[],castles:[{id:'home',name:'本拠'},{id:'remote',name:'対象城'},{id:'next',name:'新本拠'}]},
  game:{castle:id=>Object.hasOwn(state.castles,id)?{id,...state.castles[id]}:null,adjacentTargets:()=>[],canOwnCastle:()=>true},
  closeModal:()=>events.push('close-modal'),syncMusic:()=>events.push('music'),$:selector=>selector==='#main'&&!mainPresent?null:doc.querySelector(selector),
  courtEstateHolding:()=>null,courtEstateCastle:value=>value,campaignCastleOwnership:value=>value,campaignCastleAppearance(){},campaignCastleTooltip(){},castleUpgradeModal:id=>events.push('upgrade:'+id),battleModal(){},preserveInteraction:(_,fn)=>fn(),getHints:()=>({items:[{id:'target-hint',action:{kind:'castle',id:'remote'}}]}),
  window:{SengokuWorldMap:{mount(container,options){events.push('mount-map');controller.options=options;return controller;}},scrollTo(options){assert.deepEqual({...options},{top:0,left:0,behavior:'instant'});events.push('window-top');},...(navigation?{SengokuNavigation:{revealView:view=>events.push('reveal:'+view)}}:{})}
 };
 scope.render=()=>{events.push('render');renders.push({view:scope.currentView,selected:scope.selectedCastle,region:scope.mapRegion,top,left});scope.syncWorldMap();};
 vm.createContext(scope);vm.runInContext(['go','followHint','syncWorldMap'].map(sourceFunction).join('\n'),scope);
 return{scope,events,renders,state,host,controller,go:(view,opts)=>scope.go(view,opts),background:()=>scope.render()};
}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('every ordinary map entry resets the detail and region to home and centers home after mounting',()=>{
 const f=fixture();f.go('map');assert.equal(f.scope.selectedCastle,'home');assert.equal(f.scope.mapRegion,'all');assert.equal(f.controller.options.homeId,'home');assert.equal(f.controller.options.initialView,'home');assert.equal(f.controller.options.restoreView,false);assert(f.events.indexOf('fit:home')>f.events.indexOf('mount-map'));
 f.scope.selectedCastle='remote';f.scope.mapRegion='east';f.controller.camera='explored';f.state.home='next';f.go('map');assert.equal(f.scope.selectedCastle,'next');assert.equal(f.scope.mapRegion,'all');assert.equal(f.controller.camera,'home');assert.equal(f.events.filter(e=>e==='fit:home').length,2);
});
test('desktop resets the old scroll pane before render and never forces a second reveal afterwards',()=>{
 const f=fixture();f.go('map');const render=f.events.indexOf('render');assert(f.events.indexOf('main-top')<render);assert(f.events.indexOf('main-left')<render);assert(f.events.indexOf('window-top')<render);assert.equal(f.renders[0].top,0);assert.equal(f.renders[0].left,0);assert.equal(f.events.filter(e=>e==='main-top').length,1);assert(!f.events.some(e=>e.startsWith('reveal:')||e==='fallback-reveal'));
});
test('mobile renders first and then uses the established navigation reveal',()=>{
 const f=fixture({desktop:false});f.go('map');const render=f.events.indexOf('render');assert.equal(f.renders[0].top,180);assert(f.events.indexOf('main-top')>render);assert(f.events.indexOf('main-left')>render);assert(f.events.indexOf('reveal:map')>render);assert(!f.events.includes('window-top'));assert.equal(f.host.scrollTop,0);
 const fallback=fixture({desktop:false,navigation:false});fallback.go('town');assert(fallback.events.indexOf('fallback-reveal')>fallback.events.indexOf('render'));
});
test('reveal false leaves both mobile and desktop page scroll untouched while the map still starts at home',()=>{
 for(const desktop of [true,false]){const f=fixture({desktop});f.go('map',{reveal:false});assert.equal(f.host.scrollTop,180);assert.equal(f.host.scrollLeft,40);assert(!f.events.some(e=>['main-top','main-left','window-top','fallback-reveal'].includes(e)||e.startsWith('reveal:')));assert.equal(f.controller.camera,'home');}
});
test('repeated real map synchronization retains the explored camera and selected castle',()=>{
 const f=fixture();f.go('map');f.scope.selectedCastle='remote';f.controller.camera='explored';f.events.length=0;
 for(let n=0;n<30;n++){f.state.turn++;f.background();}
 assert.equal(f.controller.camera,'explored');assert.equal(f.scope.selectedCastle,'remote');assert.equal(f.events.filter(e=>e==='update-map').length,30);assert(!f.events.some(e=>e.startsWith('fit:')||e==='main-top'||e==='window-top'));
});
test('an explicit castle hint retains its target detail while the map starts at home',()=>{
 const f=fixture();const result=f.scope.followHint('target-hint');assert.equal(result.ok,true);assert.equal(f.scope.selectedCastle,'remote');assert.equal(f.controller.options.selectedId,'remote');assert.equal(f.controller.options.homeId,'home');assert.equal(f.controller.camera,'home');assert.equal(f.scope.mapRegion,'all');
 f.go('map',{castleId:'missing'});assert.equal(f.scope.selectedCastle,'home');f.go('map');assert.equal(f.scope.selectedCastle,'home');
});
test('unrelated views do not recenter a map and invalid destinations leave navigation untouched',()=>{
 const f=fixture();f.go('map');f.events.length=0;f.go('army');assert(!f.events.some(e=>e.startsWith('fit:')));assert.equal(f.scope.worldMapController,null);assert(f.events.includes('destroy-map'));const previous=f.scope.interactionEpoch;f.events.length=0;f.go('invalid');assert.equal(f.events.length,0);assert.equal(f.scope.interactionEpoch,previous);
 const absent=fixture({mainPresent:false});absent.go('map');assert(!absent.events.includes('window-top'));assert(absent.events.includes('render'));
});
for(const[name,run]of tests){run();console.log('PASS '+name);}console.log(`${tests.length} application map navigation scenarios passed. No external requests.`);
