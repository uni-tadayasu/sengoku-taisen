'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {createNavigationUI,filterEntries}=require('../navigation-ui.js');
const {setup,Node}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
const ledgerSource=fs.readFileSync(require.resolve('../defense-ledger.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
Object.defineProperty(Node.prototype,'className',{configurable:true,get(){return this.getAttribute('class')||'';},set(value){this.setAttribute('class',value);}});
Object.defineProperty(Node.prototype,'children',{configurable:true,get(){return this.childNodes.filter(node=>node.nodeType===1);}});
Node.prototype.getClientRects=function(){for(let node=this;node;node=node.parentElement)if(node.hidden||node.tagName==='DIALOG'&&!node.open)return[];return[{}];};
Node.prototype.click=function(){if(!this.disabled)this.dispatchEvent({type:'click'});};
function fixture(desktop=false){
  const {doc}=setup();doc.body.replaceChildren();doc.getElementById=id=>doc.querySelector('#'+id);doc.documentElement=doc.createElement('html');
  if(desktop)doc.documentElement.classList.add('sengoku-desktop-fit');
  doc.body.innerHTML='<div id="app"><aside class="sidebar"><nav id="navigation"></nav><div class="sidebar-bottom"></div></aside><main id="main" data-view="town"></main></div><dialog id="modal"><div id="modal-content"></div></dialog>';
  const game=new E({seed:4918,clan:'織田家'});game.state.castles.nijo.owner=game.state.clan;
  game.state.branches=[{id:'nijo_north',parentCastleId:'nijo',direction:'north',level:2,fallen:false,stationedTroops:275}];
  let access={playerId:'test-lord',epoch:1},frames=[],subscribers=[],stopped=0,reads=0;
  const income=game.income;game.income=function(...args){reads++;return income.apply(this,args);};
  const win={document:doc,navigator:{maxTouchPoints:desktop?0:1},matchMedia:()=>({matches:!desktop}),SENGOKU_DATA:D,
    requestAnimationFrame(fn){frames.push(fn);return frames.length;},cancelAnimationFrame(){},addEventListener(){},removeEventListener(){},
    SengokuTravelUI:{subscribe(fn){subscribers.push(fn);fn();return()=>{stopped++;subscribers=subscribers.filter(value=>value!==fn);};}},
    SengokuSocial:{getExpansionContext:()=>access},SengokuStableDOM:require('../stable-dom.js')};
  vm.runInNewContext(ledgerSource,{window:win});
  const destinations=[],toasts=[];
  const c={window:win,document:doc,game,data:D,roleEpoch:1,startPending:false,saveEnabled:true,syncAccess:{linked:false,banned:false,rolePending:false},
    pendingRoleSave:null,evaluationOwnerId:'',saveCounter:0,lastRealtime:0,selectedCastle:'',staffBaseId:'kyoto_gosho',staffBaseReady:false,activeModal:'',
    renderedNavigation:'',currentView:'town',state:()=>game.state,icon:()=>'',patchHTML:(node,html)=>{node.innerHTML=html;},$:selector=>doc.querySelector(selector),
    getExpansionAccess:()=>({...access}),confirmedWorldClock:()=>({running:true,speed:1}),staffConstructionReady:()=>false,
    toast:(...args)=>toasts.push(args),canMutate:()=>true,refreshEvaluationUI(){},refreshLiveControls(){},refreshActiveModal(){},queueWorldProgress(){},stopStrategy(){},render(){},
    preserveInteraction:(_node,render)=>render(),performance:{now:()=>0},SengokuEngine:E,roster:game.roster,
    castleUpgradeModal(parentCastleId){destinations.push(parentCastleId);c.activeModal='castle-upgrade';const content=doc.querySelector('#modal-content');
      content.innerHTML='<h2>城の詳細</h2><article class="branch-card" data-stable-key="branch-nijo_north"><h4>二条城 北支拠点</h4><button>支拠点を修復</button></article>';
      doc.querySelector('#modal').showModal();}};
  vm.createContext(c);vm.runInContext(['defenseLedgerContext','openDefenseBase','openDefenseLedger','setSyncAccess','setRoleAccess','nav'].map(fn).join('\n')+'\n'+source.slice(source.indexOf('  const navSections = ['),source.indexOf('\n  function nav(){')),c);
  c.nav();assert.match(source,/case 'defense-ledger':openDefenseLedger\(\);break;/);
  doc.getElementById('app').addEventListener('click',event=>{if(event.target.closest('[data-action="defense-ledger"]'))c.openDefenseLedger();});
  const nav=createNavigationUI(win);
  return{doc,win,c,game,nav,destinations,toasts,setAccess(next){access=next;},get ledger(){return doc.querySelector('.defense-ledger');},get reads(){return reads;},get stopped(){return stopped;},
    drain(){let limit=20;while(frames.length&&limit--)frames.shift()();assert(limit>=0);},destroy(){win.SengokuDefenseLedger.destroy();nav.destroy();}};
}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}
test('the real app menu exposes repair search and returns keyboard focus to the desktop or phone launcher',()=>{
  for(const desktop of [true,false]){
    const h=fixture(desktop),entry=h.nav.getEntries().find(row=>row.key==='action:defense-ledger');
    assert(entry);assert.equal(entry.group,'城と内政');assert(filterEntries(h.nav.getEntries(),'しゅうふく 木材').some(row=>row.key===entry.key));
    const launcher=h.doc.querySelector(desktop?'.navigation-menu-trigger':'[data-navigation-quick="menu"]');launcher.focus();assert(h.nav.open(launcher));
    const before=JSON.stringify(h.game.state);assert(h.nav.activate(entry.key));h.drain();assert(h.ledger.open);assert(!h.nav.isOpen());assert.equal(h.reads,1);
    h.win.SengokuDefenseLedger.close();assert.equal(h.doc.activeElement,launcher);assert.equal(h.stopped,1);assert.equal(JSON.stringify(h.game.state),before);h.destroy();
  }
});
test('the ledger retains an underlying detail dialog and routes a branch to its existing card without a command',()=>{
  const h=fixture(),base=h.doc.querySelector('#modal');base.showModal();h.c.activeModal='economy-details';
  h.doc.querySelector('#modal-content').innerHTML='<button id="repair-launch">修復を確認</button>';const launch=h.doc.querySelector('#repair-launch');launch.focus();
  assert(h.c.openDefenseLedger());let stopped=false;h.ledger.dispatchEvent({type:'keydown',key:'Escape',stopPropagation(){stopped=true;}});assert(stopped);
  h.ledger.dispatchEvent({type:'cancel'});assert.equal(base.open,true);assert.equal(h.c.activeModal,'economy-details');assert.equal(h.doc.activeElement,launch);
  const before=JSON.stringify(h.game.state);assert(h.c.openDefenseLedger());h.ledger.querySelector('[data-defense-open="branch:nijo_north"]').click();
  assert.deepEqual(h.destinations,['nijo']);assert(!h.ledger.open);assert(base.open);assert.equal(h.c.activeModal,'castle-upgrade');
  const card=h.doc.querySelector('.branch-card');assert.equal(h.doc.activeElement,card.querySelector('h4'));assert.equal(card.scrollIntoViewCalls,1);assert.equal(JSON.stringify(h.game.state),before);h.destroy();
});
test('sync and role changes close a stale ledger immediately while unchanged acknowledgements leave its snapshot alone',()=>{
  const h=fixture();h.c.openDefenseLedger();const label=h.ledger.querySelector('[data-defense-update]').textContent;
  h.c.setSyncAccess({linked:false,banned:false,rolePending:false});assert(h.ledger.open);assert.equal(h.reads,1);assert.equal(h.ledger.querySelector('[data-defense-update]').textContent,label);
  h.c.setSyncAccess({banned:true});assert(!h.ledger.open);assert.equal(h.c.openDefenseLedger(),false);
  h.c.syncAccess.banned=false;h.c.openDefenseLedger();h.c.setRoleAccess({pending:true});assert(!h.ledger.open);assert.equal(h.reads,2);h.destroy();
});
test('stale base destinations, unknown routes and a campaign that has not started cannot fall through to another castle',()=>{
  const h=fixture();assert.equal(h.c.openDefenseBase({kind:'castle',id:'nijo',parentCastleId:'osaka'}),false);
  assert.equal(h.c.openDefenseBase({kind:'branch',id:'nijo_north',parentCastleId:'osaka'}),false);
  assert.equal(h.c.openDefenseBase({kind:'unexpected',id:'nijo',parentCastleId:'nijo'}),false);
  h.game.state.castles.nijo.owner='在地衆';assert.equal(h.c.openDefenseBase({kind:'castle',id:'nijo',parentCastleId:'nijo'}),false);
  h.c.startPending=true;assert.equal(h.c.openDefenseLedger(),false);assert.equal(h.toasts.length,1);assert.deepEqual(h.destinations,[]);h.destroy();
});
console.log(`${count} integrated repair-ledger navigation and access scenarios passed.`);
