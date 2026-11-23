/* Actual application ledger helpers and engine totals; no browser or live API. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {setup}=require('./helpers/dom-model.cjs'),stable=require('../stable-dom.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(end>start,name);return source.slice(start,end);}
const format=value=>Math.floor(Number(value)||0).toLocaleString('ja-JP');
const signed=(value,expense=false)=>value?(expense||value<0?'−':'+')+format(Math.abs(value)):'0';
function harness(game=new E({seed:4910})){
 const {doc,host}=setup(),clock={calendar:{elapsed:0,turn:0},speed:1,running:true};
 const c={game,data:D,state:()=>game.state,document:doc,$:selector=>doc.querySelector(selector),num:format,esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},resIcons:{gold:'coins',rice:'wheat',wood:'tree',stone:'mountain'},icon:name=>`<svg data-icon-name="${name}"></svg>`,
  window:{SengokuStableDOM:stable,SengokuWorldClock:{snapshot:()=>({ready:true,mode:'shared',clock})}},startPending:false,activeModal:'',settings:{sound:false},
  getEvaluation:()=>({}),refreshEvaluationUI(){},evaluationEntry:()=>'',refreshTouchHeaderStatus(){},date:()=>({year:1560,month:1,season:'春'}),clanInfo:()=>({leader:'織田信長'}),clanCrest:()=>'',
  heading:title=>`<h1>${title}</h1>`,maximumRecruitAmount:()=>0,recruitLimitText:()=>'',costHtml:()=>'',portrait:()=>'',skillNames:{},
  facilityCategory:'all',facilityQuery:'',categoryNames:{},staffBaseNotice:()=>'',governorAssignmentEntry:()=>'',facilitiesResults:()=>'<input id="facility-search-test" value="">'
 };
 vm.createContext(c);vm.runInContext(['patchHTML','economyNumber','economyBalanceTitle','economyPanel','refreshEconomyPanels','facilityMaintenanceHtml','renderHeader','renderArmy','renderFacilities'].map(fn).join('\n'),c);
 return{c,doc,host,game,clock};
}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('army and construction ledger show the same four-resource production, costs and net totals',()=>{
 const h=harness();
 for(const view of ['Army','Facilities']){
  h.host.innerHTML=h.c['render'+view]();const panel=h.host.querySelector('[data-economy-panel]'),income=h.game.income();
  assert(panel,view);assert.equal(panel.querySelectorAll('.economy-resource').length,4);assert.equal(panel.querySelectorAll('[data-economy-rate]').length,16);
  for(const node of panel.querySelectorAll('[data-economy-rate]')){const kind=node.dataset.economyRate,key=node.dataset.economyResource;assert.equal(node.textContent,signed(income[kind][key],kind.endsWith('Upkeep')));}
  assert.equal(panel.querySelector('[data-economy-total]').textContent,format(income.totalTroops));assert.match(panel.textContent,/施設・城の維持費/);assert.match(panel.textContent,/60秒で1か月/);assert.match(panel.textContent,/残高は0未満/);assert.match(panel.textContent,/勾玉・威信は維持費の対象外/);
 }
});

test('large armies show explicit negative gold and rice net costs, while zero troop material costs stay zero',()=>{
 const h=harness();h.game.state.troops=100000000;h.host.innerHTML=h.c.economyPanel('army');const income=h.game.income();
 for(const key of ['gold','rice']){const node=h.host.querySelector(`[data-economy-rate="net"][data-economy-resource="${key}"]`);assert(income.net[key]<0);assert.equal(node.textContent,signed(income.net[key]));assert(node.classList.contains('is-negative'));}
 for(const key of ['wood','stone'])assert.equal(h.host.querySelector(`[data-economy-rate="troopUpkeep"][data-economy-resource="${key}"]`).textContent,'0');
 assert.equal(h.host.querySelector('[data-economy-total]').textContent,format(income.totalTroops));assert(!h.host.textContent.includes('−0'));
});

test('live totals update in place while search focus, draft, selection, disclosure and scroll remain unchanged',()=>{
 const h=harness();h.host.innerHTML='<input id="search" value=""><div id="ledger"></div>';const ledger=h.doc.querySelector('#ledger');stable.patch(ledger,h.c.economyPanel('facilities'),{key:'facilities'});
 const input=h.doc.querySelector('#search'),panel=ledger.firstElementChild,nodes=[...panel.querySelectorAll('*')],amount=panel.querySelector('[data-economy-total]'),details=panel.querySelector('details');
 input.value='田畑';input.setSelectionRange(0,1,'backward');input.focus();details.open=true;h.host.scrollTop=225;
 for(let i=0;i<12;i++){h.game.state.troops=100000+i;h.c.refreshEconomyPanels(h.game.income());assert.equal(amount.textContent,format(h.game.income().totalTroops));}
 assert.strictEqual(ledger.firstElementChild,panel);assert(nodes.every(node=>node.isConnected));assert.strictEqual(h.doc.activeElement,input);assert.equal(input.value,'田畑');assert.equal(input.selectionStart,0);assert.equal(input.selectionEnd,1);assert.equal(input.selectionDirection,'backward');assert(details.open);assert.equal(h.host.scrollTop,225);
 let removals=0;h.doc.onRemove=()=>{removals++;};h.c.refreshEconomyPanels(h.game.income());assert.equal(removals,0,'equal rates do not rewrite text nodes');
});

test('the header updates net-rate labels and the open ledger through ordinary clock rendering',()=>{
 const h=harness();h.host.innerHTML='<div id="resources"></div><div id="calendar"></div><div id="clan-panel"></div><button id="sound-button"></button>'+h.c.economyPanel('army');h.c.renderHeader();
 const gold=h.doc.querySelector('#header-gain-gold'),rice=h.doc.querySelector('#header-resource-rice'),total=h.doc.querySelector('[data-economy-total]'),before=gold.textContent;h.game.state.troops=100000000;h.c.renderHeader(true);const income=h.game.income();
 assert.strictEqual(h.doc.querySelector('#header-gain-gold'),gold);assert.notEqual(gold.textContent,before);assert.equal(gold.textContent,signed(income.gold));assert(gold.classList.contains('is-negative'));assert.match(rice.title,/生産/);assert.match(rice.title,/兵の維持費/);assert.match(rice.title,/施設・城の維持費/);assert.equal(total.textContent,format(income.totalTroops));
});

test('facility previews separate completed monthly cost from a future level without charging queued work',()=>{
 const h=harness(),id='gold_mine';h.game.state.buildings[id]=0;h.host.innerHTML=h.c.facilityMaintenanceHtml(id,0,1);
 for(const row of h.host.querySelectorAll('[data-maintenance-resource]')){const key=row.dataset.maintenanceResource;assert.equal(row.querySelector('[data-maintenance-current]').textContent,'0');assert.equal(row.querySelector('[data-maintenance-next]').textContent,format(h.game.facilityUpkeep(id,1)[key]));}
 h.game.state.buildings.farm=2;h.game.state.resources={gold:100000000,rice:100000000,wood:100000000,stone:100000000};h.game.state.command=h.game.commandMax();assert(h.game.upgrade('farm').ok);h.game.state.command=h.game.commandMax();assert(h.game.upgrade('farm').ok);const before=JSON.stringify(h.game.state);
 h.host.innerHTML=h.c.facilityMaintenanceHtml('farm',2,5);assert.match(h.host.textContent,/現在 Lv\.2/);assert.match(h.host.textContent,/Lv\.5完成後/);
 for(const row of h.host.querySelectorAll('[data-maintenance-resource]')){const key=row.dataset.maintenanceResource;assert.equal(row.querySelector('[data-maintenance-current]').textContent,format(h.game.facilityUpkeep('farm',2)[key]));assert.equal(row.querySelector('[data-maintenance-next]').textContent,format(h.game.facilityUpkeep('farm',5)[key]));}
 assert.equal(JSON.stringify(h.game.state),before,'reading a preview never changes balances, jobs or levels');h.host.innerHTML=h.c.facilityMaintenanceHtml('farm',32);assert.equal(h.host.querySelector('[data-maintenance-next]'),null);
});

console.log(`${count} economy UI checks passed with actual app helpers and engine totals. No live requests.`);
