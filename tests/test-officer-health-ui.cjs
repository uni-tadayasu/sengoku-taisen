'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),health=require('../officer-health.js'),stable=require('../stable-dom.js'),{setup}=require('./helpers/dom-model.cjs');
const rosterScope={window:{}};vm.createContext(rosterScope);vm.runInContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),rosterScope);const roster=rosterScope.window.SENGOKU_OFFICERS;
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`),lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(start>=0&&end>start,name);return source.slice(start,end);}
const game=()=>new E({officers:roster,seed:4912});
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('owned people share health across ranks, while unowned people receive no meter value',()=>{
 const g=game(),id=g.state.army[0],other=roster.find(o=>!g.state.officers.includes(o.id)).id,{host}=setup();g.state.officerHealth.values[id]=42.75;const before=JSON.stringify(g.state);
 host.innerHTML=health.markup(g,id)+health.markup(g,id)+health.markup(g,other);
 const rows=host.querySelectorAll('[data-officer-health]');assert.equal(rows.length,3);assert.equal(rows[0].querySelector('[data-health-current]').textContent,'42');assert.equal(rows[1].querySelector('[data-health-current]').textContent,'42');assert.equal(rows[0].querySelector('[data-health-state]').textContent,'疲労');
 const unowned=rows[2];assert.match(unowned.textContent,/未登用/);assert.equal(unowned.querySelector('[data-health-gauge]').getAttribute('aria-valuenow'),null);assert.equal(unowned.querySelector('[data-health-current]').textContent,'—');assert.equal(g.officerHealth(other),null);assert.equal(JSON.stringify(g.state),before);
});

test('recovery updates visible values in one batch while preserving nodes, focus, draft, selection and scroll',()=>{
 const g=game(),ids=g.state.army.slice(),{doc,host}=setup();host.innerHTML='<input id="draft"><div id="health">'+health.armyMarkup(g)+health.markup(g,ids[0])+'</div>';
 const input=doc.querySelector('#draft'),panel=doc.querySelector('#health'),nodes=panel.querySelectorAll('*'),rows=panel.querySelectorAll('[data-officer-health]'),bars=panel.querySelectorAll('[data-health-gauge]'),details=panel.querySelector('details');input.value='次の合戦';input.setSelectionRange(1,3,'backward');input.focus();host.scrollTop=237;details.open=true;
 let calls=0,requested=[];const batch=g.armyHealth.bind(g);g.armyHealth=keys=>{calls++;requested=[...keys];return batch(keys);};g.officerHealth=()=>{throw Error('Refresh must use the batched health projection');};
 for(const current of [0,24.5,59.9,60,99.9,100]){g.state.officerHealth.values[ids[0]]=current;const before=JSON.stringify(g.state);health.refresh(host,g);assert.equal(rows[0].querySelector('[data-health-current]').textContent,String(Math.floor(current)));assert.equal(rows.at(-1).querySelector('[data-health-current]').textContent,String(Math.floor(current)));assert.equal(bars[0].getAttribute('aria-valuenow'),String(Math.floor(current)));assert.equal(JSON.stringify(g.state),before);}
 assert.equal(calls,6);assert.deepEqual(requested,Array.from(ids));assert(nodes.every(node=>node.isConnected));assert.strictEqual(doc.activeElement,input);assert.equal(input.value,'次の合戦');assert.deepEqual([input.selectionStart,input.selectionEnd,input.selectionDirection],[1,3,'backward']);assert.equal(host.scrollTop,237);assert(details.open);assert.strictEqual(panel.querySelector('[data-health-gauge]'),bars[0]);
 let changes=0;doc.onRemove=()=>{changes++;};doc.onAttributeChange=()=>{changes++;};health.refresh(host,g);assert.equal(changes,0,'unchanged health does not rewrite the DOM');
});

test('polling surfaces keep their generated health markup constant and update meters without rebuilding cards',()=>{
 const g=game(),{host,doc}=setup(),id=g.state.army[0],markup=health.armyMarkup(g,{deferred:true});stable.patch(host,markup);health.refresh(host,g);const card=host.firstElementChild,bar=host.querySelector('[data-health-gauge]'),details=host.querySelector('details');details.open=true;host.scrollTop=100;
 g.state.officerHealth.values[id]=0;assert.equal(health.armyMarkup(g,{deferred:true}),markup);stable.patch(host,markup);health.refresh(host,g);assert.strictEqual(host.firstElementChild,card);assert.strictEqual(host.querySelector('[data-health-gauge]'),bar);assert.equal(bar.getAttribute('aria-valuenow'),'0');assert.equal(host.querySelector('[data-health-state]').textContent,'消耗');assert(details.open);assert.equal(host.scrollTop,100);assert.equal(doc.querySelectorAll('button[disabled]').length,0);assert.match(host.textContent,/体力0でも出陣/);
});

test('archive, detail, army, replacement chooser and normal battle use the actual person health',()=>{
 const g=game(),id=g.state.army[0],{doc,host}=setup();g.state.officerHealth.values[id]=35;let body='';
 const c={game:g,data:D,state:()=>g.state,document:doc,window:{SengokuOfficerHealthUI:health},num:String,esc:v=>String(v??''),icon:()=>'',portrait:()=>'',clanCrest:()=>'',officerCrest:()=>'',skillIcons:{},skillNames:{},skillDescriptions:{},heading:()=>'',maximumRecruitAmount:()=>0,recruitLimitText:()=>'',costHtml:()=>'',economyPanel:()=>'',recruitmentPreviewHtml:()=>'',officerComparison:[],officerComparisonSelected:()=>false,choiceFilters:{army:{}},choiceMode:'army',choiceTarget:'0',choicePage:1,filterOfficerList:list=>list,pageControls:()=>'',syncMusic(){},mountBattleAdvisor(){},modal(title,subtitle,value){body=value;}};
 vm.createContext(c);vm.runInContext(['officerDuty','officerCard','officerModal','renderArmy','officerChoiceRows','officerChoiceResults','durabilityMarkup','homeCastleAppearance','campaignCastleOwnerAppearance','battleModal','battlePreview'].map(fn).join('\n'),c);
 const check=html=>{host.innerHTML=html;const row=host.querySelector(`[data-officer-health="${id}"]`);assert(row);assert.equal(row.querySelector('[data-health-current]').textContent,'35');};
 for(const rank of ['D','U']){check(c.officerCard(g.officer(id,rank)));c.officerModal(id,rank);check(body);}
 check(c.renderArmy());check(c.officerChoiceResults());c.battleModal(g.adjacentTargets()[0].id);check(body);assert.match(body,/勝利で15、敗北で25/);
});

test('field forecasts apply health to each ranked person instead of averaging rank and health separately',()=>{
 global.SengokuEngine=E;global.SENGOKU_DATA=D;const field=require('../field.js'),state={army:['low','high'],officerVariants:['low:D','high:U'],officerHealth:{values:{low:100,high:0}},morale:100,tech:{}},p=field.estimateBattle({state,player:{defensePower:1000},troops:1000,tactic:'balanced'});
 const perPerson=(.9*1+1.5*.5)/2;assert.equal(p.attackPower,Math.round(1000*1.2*perPerson));assert.notEqual(p.attackPower,Math.round(1000*1.2*((.9+1.5)/2)*.75));assert.match(p.reasons.join(''),/体力/);
});

console.log(`${count} officer health UI checks passed with real engine health and DOM identity checks.`);
