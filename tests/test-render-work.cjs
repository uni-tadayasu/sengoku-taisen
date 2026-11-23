'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),hints=require('../hints.js'),{createUI}=require('../hints-ui.js'),{setup}=require('./helpers/dom-model.cjs');
const rosterScope={window:{}};vm.createContext(rosterScope);vm.runInContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),rosterScope);
const roster=JSON.parse(JSON.stringify(rosterScope.window.SENGOKU_OFFICERS)),source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const make=options=>new E({officers:roster,seed:17,...options});
function developed(game=make()){
 const s=game.state;s.officers=[...new Set([...s.officers,...roster.map(o=>o.id)])].slice(0,64);s.officerVariants=s.officers.flatMap(id=>D.ranks.filter(rank=>game.canOwnOfficerVariant(id,rank)).map(rank=>id+':'+rank));s.army=s.officers.slice(0,3);s.governors={};s.officerHealth.values=Object.fromEntries(s.officers.map(id=>[id,100]));
 D.buildings.forEach((building,index)=>{s.buildings[building.id]=32;if(s.officers[index+3])s.governors[building.id]=s.officers[index+3];});return game;
}
function appFunction(name){const start=source.indexOf('  function '+name+'('),next=source.indexOf('\n  function ',start+1);assert(start>=0&&next>start,name);return source.slice(start,next);}
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}

test('batched recruitment matches individual quotes across roles and fresh state changes',()=>{
 const ids=roster.map(o=>o.id).concat('missing-officer');
 for(const options of [{},{isAdmin:true},{isStaff:true}]){
  const game=developed(make(options)),same=()=>{const before=JSON.stringify(game.state);assert.deepEqual(game.canRecruitOfficers(ids),ids.map(id=>game.canRecruitOfficer(id)));assert.equal(JSON.stringify(game.state),before);};
  same();game.state.resources.gold=0;same();game.state.resources.gold=100000;game.state.command=0;same();game.state.command=3;game.state.buildings.keep=1;same();game.state.buildings.keep=32;game.state.gameOver=true;same();game.state.gameOver=false;
  game.state.governors={};same();game.state.clan=roster.at(-1).clan;same();
  game.setRoleAccess({isAdmin:false,isStaff:false});same();
 }
});
test('each quote batch computes facility modifiers once and never authorizes a later action',()=>{
 const game=developed(),ids=game.searchOfficers().map(o=>o.id);let keep=0,diplomacy=0;
 const governor=game._governorBonus.bind(game),facility=game._facilityEffect.bind(game);
 game._governorBonus=id=>{if(id==='keep')keep++;return governor(id);};game._facilityEffect=category=>{if(category==='diplomacy')diplomacy++;return facility(category);};
 const quotes=game.canRecruitOfficers(ids);assert.equal(keep,1);assert.equal(diplomacy,1);
 const index=quotes.findIndex(quote=>quote.ok);assert(index>=0);game.state.resources.gold=0;
 assert.equal(game.recruitOfficer(ids[index]).ok,false);assert(!game.state.officers.includes(ids[index]));
 assert.equal(game.canRecruitOfficers([ids[index]])[0].ok,false);assert.equal(keep,3);assert.equal(diplomacy,3);
});
test('hints keep the same recommendations while using current batched recruitment rules',()=>{
 const game=developed();let batches=0;const batch=game.canRecruitOfficers.bind(game);game.canRecruitOfficers=ids=>{batches++;return batch(ids);};
 const context={started:true,writable:true,clockReady:true,saveEnabled:true},first=hints.build(game,context);assert.equal(batches,1);
 game.canRecruitOfficers=undefined;assert.deepEqual(hints.build(game,context),first);
 game.canRecruitOfficers=batch;game.state.resources.gold=0;const changed=hints.build(game,context);game.canRecruitOfficers=undefined;assert.deepEqual(hints.build(game,context),changed);
});
test('facility descriptions do not recalculate the unrelated whole-domain economy',()=>{
 const game=developed();game.income=()=>assert.fail('A facility description must not compute domain income');
 for(const building of D.buildings)assert.equal(typeof game.buildingSummary(building.id),'string');
 assert.match(game.buildingSummary('farm'),/^兵糧 \+/);assert.match(game.buildingSummary('barracks'),/^兵数上限 /);
});

function uiFixture(){
 const {doc,host}=setup();host.id='main';let now=5000,calls=0,lastStatus='';
 const markup='<section data-hint-entry><strong data-hint-title></strong><p data-hint-reason></p></section><button data-action="train">訓練</button>';
 const scope={game:make(),document:doc,window:{},currentView:'town',startPending:false,saveEnabled:true,saveWarning:'',activeModal:'',evaluationOwnerId:'lord-one',lastRealtime:0,saveCounter:0,courtManagementRequested:false,
  syncAccess:{linked:true,ready:true,writable:true,banned:false,rolePending:false,reason:'writer',message:''},mutationActions:new Set(['train']),courtController:null,fieldController:null,roamingController:null,covertController:null,
  $:selector=>doc.querySelector(selector),num:String,performance:{now:()=>now},Date,Promise,
  state:()=>scope.game.state,canMutate:()=>scope.syncAccess.ready&&scope.syncAccess.writable&&!scope.syncAccess.banned&&!scope.syncAccess.rolePending,hasResources:cost=>D.resources.every(key=>scope.game.state.resources[key]>=(cost?.[key]||0)),
  refreshTouchHeaderStatus(){},refreshBranchDeploymentPanels(){},refreshEvaluationUI(){},renderHeader(){},nav(){},refreshJobTimers(){},syncWorldMap(){},queueWorldProgress(){},
  replaceMainContents:html=>{host.innerHTML=html;},patchHTML:(node,html)=>{node.innerHTML=html;},fieldOptions:()=>({})
 };
 for(const name of ['Town','Facilities','Map','Field','Roaming','Covert','Court','Officers','Army','Research','Council','Crests','StartSelection'])scope['render'+name]=()=>markup;
 const ui=createUI({document:doc,now:()=>now,viewport(){},bridge:()=>({getHints(){calls++;lastStatus=scope.canMutate()?'ready':'blocked';return{scope:'lord-one',status:lastStatus,title:lastStatus,summary:lastStatus,items:[]};}})});
 scope.window={SengokuHintsUI:ui,SengokuSocial:{getUser:()=>({id:'lord-one'})},SengokuBridge:{primeProgress(){}},SengokuDesktopFit:{refresh(){}},SengokuStrategy:{refreshAccess(){}}};
 vm.createContext(scope);vm.runInContext(['render','refreshLiveControls','setSyncAccess'].map(appFunction).join('\n'),scope);
 return{scope,doc,host,markup,calls:()=>calls,status:()=>lastStatus,advance:()=>{now+=2100;}};
}
test('a screen render evaluates fresh hints once, including after the throttle interval',()=>{
 const f=uiFixture();f.scope.render();assert.equal(f.calls(),1);f.advance();f.scope.render();assert.equal(f.calls(),2);assert.equal(f.doc.querySelector('[data-hint-title]').textContent,'ready');
});
test('independent control refreshes still update hints and respect their normal throttle',()=>{
 const f=uiFixture();f.scope.render();f.scope.refreshLiveControls();assert.equal(f.calls(),1);f.advance();f.scope.refreshLiveControls();assert.equal(f.calls(),2);
});
test('an access transition immediately updates hints once and keeps action guards current',()=>{
 const f=uiFixture();f.scope.render();f.scope.setSyncAccess({writable:false,reason:'follower'});assert.equal(f.calls(),2);assert.equal(f.status(),'blocked');assert.equal(f.doc.querySelector('[data-action="train"]').disabled,true);
 f.scope.setSyncAccess({writable:true,reason:'writer'});assert.equal(f.calls(),3);assert.equal(f.status(),'ready');assert.equal(f.doc.querySelector('[data-action="train"]').disabled,false);
 f.advance();f.scope.setSyncAccess({banned:true,writable:false,reason:'banned',message:'利用停止中です。'});assert.equal(f.calls(),4);assert.equal(f.status(),'blocked');
});
test('controller and initial-selection render branches do not double-evaluate hints',()=>{
 for(const [view,hostId,controller]of [['field','shared-field','fieldController'],['roaming','roaming-field','roamingController'],['covert','covert-field','covertController']]){
  const f=uiFixture();f.host.innerHTML=f.markup+'<div id="'+hostId+'"></div>';f.scope.currentView=view;f.scope[controller]={update(){},refresh(){}};f.scope.render();assert.equal(f.calls(),1,view);
 }
 const f=uiFixture();f.scope.startPending=true;f.scope.render();assert.equal(f.calls(),1,'initial selection');
});
console.log(checks+' render-work checks passed.');
