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
  heading:title=>`<h1>${title}</h1>`,hasResources:cost=>D.resources.every(key=>game.state.resources[key]>=(cost?.[key]||0)),refreshLiveControls(){const income=game.income();c.refreshRecruitmentPreview(income,game.recruitmentBudget(income));},recruitLimitText:()=>'',costHtml:()=>'',portrait:()=>'',skillNames:{},
  facilityCategory:'all',facilityQuery:'',facilitySort:'default',facilityLayout:'cards',categoryNames:{},staffBaseNotice:()=>'',governorAssignmentEntry:()=>'',facilitiesResults:()=>'<input id="facility-search-test" value="">'
 };
 vm.createContext(c);vm.runInContext(['patchHTML','constructionJobs','facilityPlannerTools','economyNumber','economyBalanceTitle','economyPanel','refreshEconomyPanels','facilityMaintenanceHtml','recruitmentPreviewHtml','refreshRecruitmentPreview','selectRecommendedRecruitment','selectMaximumRecruitment','maximumRecruitAmount','recruitLimitText','renderHeader','renderArmy','renderFacilities'].map(fn).join('\n'),c);
 return{c,doc,host,game,clock};
}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('army and construction ledger show the same four-resource production, costs and net totals',()=>{
 const h=harness();
 for(const view of ['Army','Facilities']){
  h.host.innerHTML=h.c['render'+view]();const panel=h.host.querySelector('[data-economy-panel]'),income=h.game.income();
  assert(panel,view);assert.equal(panel.querySelectorAll('.economy-resource').length,4);assert.equal(panel.querySelectorAll('[data-economy-rate]').length,28);
  for(const node of panel.querySelectorAll('[data-economy-rate]')){const kind=node.dataset.economyRate,key=node.dataset.economyResource;assert.equal(node.textContent,signed(income[kind][key],kind.endsWith('Upkeep')||kind==='governorSalary'||kind==='surplusAdjustment'));}
  assert.equal(panel.querySelector('[data-economy-total]').textContent,format(income.totalTroops));assert.match(panel.textContent,/施設・城の維持費/);assert.match(panel.textContent,/60秒で1か月/);assert.match(panel.textContent,/残高は0未満/);assert.match(panel.textContent,/勾玉・威信は維持費の対象外/);
 }
});

test('rank food appears as an included production subtotal and mounted bonus labels follow promotion and growth',()=>{
 const h=harness();h.game.state.prestige=20000;h.host.innerHTML=h.c.economyPanel('army');const panel=h.host.firstElementChild,bonus=h.game.income().rankRiceBonus;
 const amount=panel.querySelector('[data-rank-rice-bonus="amount"]'),percent=panel.querySelector('[data-rank-rice-bonus="percent"]'),rank=panel.querySelector('[data-rank-rice-bonus="rankName"]');
 assert(amount&&percent&&rank);assert.equal(amount.textContent,signed(bonus.amount));assert.equal(percent.textContent,`+${bonus.percent}%`);assert.equal(rank.textContent,bonus.rankName);
 assert.equal(panel.querySelectorAll('[data-economy-rate]').length,28,'included subtotal must not become a second credited income row');
 assert.equal(panel.querySelectorAll('[data-rank-rice-bonus="amount"]').length,1,'gold, wood and stone have no rank subtotal');
 assert.match(panel.textContent,/上の「生産」に含まれて/);assert.match(panel.textContent,/維持費と余剰生産の調整前/);
 assert.match(h.c.economyBalanceTitle('rice',h.game.income()),/うち位階/);assert(!h.c.economyBalanceTitle('gold',h.game.income()).includes('うち位階'));
 const originalAmount=amount.textContent;h.game.state.buildings.farm+=1;h.c.refreshEconomyPanels(h.game.income());assert.strictEqual(panel.querySelector('[data-rank-rice-bonus="amount"]'),amount);assert.notEqual(amount.textContent,originalAmount);
 h.game.state.prestige=0;h.c.refreshEconomyPanels(h.game.income());const lower=h.game.income().rankRiceBonus;assert.strictEqual(panel.querySelector('[data-rank-rice-bonus="percent"]'),percent);assert.equal(percent.textContent,`+${lower.percent}%`);assert.equal(rank.textContent,lower.rankName);
 // The rank dialog is outside the ledger; its live amount still refreshes.
 h.host.innerHTML='<section class="player-evaluation-rice"><strong data-rank-rice-bonus="amount">stale</strong><strong data-rank-rice-bonus="percent">stale</strong></section>';
 h.c.refreshEconomyPanels(h.game.income());assert.equal(h.host.querySelector('[data-rank-rice-bonus="amount"]').textContent,signed(lower.amount));assert.equal(h.host.querySelector('[data-rank-rice-bonus="percent"]').textContent,`+${lower.percent}%`);
 let removals=0;h.doc.onRemove=()=>{removals++;};h.c.refreshEconomyPanels(h.game.income());assert.equal(removals,0,'unchanged bonus labels never remount their text');
});

test('developed surplus is listed after unchanged fees and the header displays the amount actually earned',()=>{
 const h=harness();for(const row of D.buildings)h.game.state.buildings[row.id]=32;h.game.state.troops=100;
 h.host.innerHTML='<div id="resources"></div><div id="calendar"></div><div id="clan-panel"></div><button id="sound-button"></button>'+h.c.economyPanel('army');h.c.renderHeader();const income=h.game.income();
 for(const key of D.resources){assert(income.surplusAdjustment[key]>0);assert.equal(income.net[key],income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key]-income.surplusAdjustment[key]);assert.equal(h.doc.querySelector(`[data-economy-rate="surplusAdjustment"][data-economy-resource="${key}"]`).textContent,signed(income.surplusAdjustment[key],true));assert.equal(h.doc.querySelector(`#header-gain-${key}`).textContent,signed(income.net[key]));assert.match(h.doc.querySelector(`#header-resource-${key}`).title,/余剰生産の調整/);}
 assert.match(h.host.textContent,/次回の修復費を含めた見込み/);assert.match(h.host.textContent,/現在の備蓄・報酬は、この調整で減りません/);
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

test('recruitment begins within the shared recommendation and previews both post-payment assets and full monthly upkeep',()=>{
 const h=harness();h.game.state.buildings.barracks=10;h.game.state.troops=100;h.game.state.resources.gold=3200;h.game.state.resources.rice=3000;
 const income=h.game.income(),budget=h.game.recruitmentBudget(income);assert(budget.recommendedMax>=100&&budget.recommendedMax<budget.affordableMax);
 h.host.innerHTML=h.c.renderArmy();const input=h.doc.querySelector('#recruit-amount');assert.equal(input.value,String(Math.min(1000,budget.recommendedMax)));assert.equal(h.doc.querySelector('[data-recruit-recommended]').textContent,format(budget.recommendedMax));
 const verify=()=>{const preview=h.game.previewRecruitment(Number(input.value));for(const kind of ['balances','net'])for(const key of ['gold','rice'])assert.equal(h.doc.querySelector(`[data-recruit-preview="${kind}"][data-recruit-resource="${key}"]`).textContent,kind==='net'?signed(preview[kind][key]):format(preview[kind][key]));};verify();
 h.c.selectRecommendedRecruitment();assert.equal(input.value,String(budget.recommendedMax));verify();
 h.c.selectMaximumRecruitment();assert.equal(input.value,String(budget.affordableMax),'manual maximum is not restricted to the recommendation');verify();
 assert.equal(h.game.previewRecruitment(Number(input.value)).withinReserve,false);
});

test('unfunded or unsustainable armies start at the legal minimum and never present a sub-100 recommendation',()=>{
 for(const scenario of ['reserve','upkeep']){const h=harness();h.game.state.troops=100;h.game.state.buildings.barracks=10;if(scenario==='reserve'){h.game.state.resources.gold=499;h.game.state.resources.rice=999;}else{h.game.state.castles[h.game.state.home].troops=100000;h.game.state.resources.gold=9000000;h.game.state.resources.rice=9000000;}assert(h.game.recruitmentBudget().recommendedMax<100);h.host.innerHTML=h.c.renderArmy();assert.equal(h.doc.querySelector('#recruit-amount').value,'100');assert.equal(h.doc.querySelector('[data-recruit-recommended]').textContent,'0');assert.equal(h.doc.querySelector('[data-action="recruit-balanced"]').hasAttribute('disabled'),true);if(scenario==='upkeep')for(const key of ['gold','rice'])assert(h.doc.querySelector(`[data-recruit-preview="net"][data-recruit-resource="${key}"]`).classList.contains('is-negative'));}
});

test('recruitment refreshes preserve typed amounts, focus, selection and all preview nodes',()=>{
 const h=harness();h.game.state.buildings.barracks=10;h.game.state.troops=100;h.host.innerHTML=h.c.renderArmy();const input=h.doc.querySelector('#recruit-amount'),preview=h.doc.querySelector('.recruit-preview'),nodes=[...preview.querySelectorAll('*')];input.value='347';input.setSelectionRange(1,2,'backward');input.focus();h.host.scrollTop=290;
 for(let i=0;i<12;i++){h.game.state.resources.gold+=10;h.game.state.castles[h.game.state.home].troops+=100;const income=h.game.income();h.c.refreshRecruitmentPreview(income,h.game.recruitmentBudget(income));}
 assert.equal(input.value,'347');assert.strictEqual(h.doc.activeElement,input);assert.deepEqual([input.selectionStart,input.selectionEnd,input.selectionDirection],[1,2,'backward']);assert.equal(h.host.scrollTop,290);assert.strictEqual(h.doc.querySelector('.recruit-preview'),preview);assert(nodes.every(node=>node.isConnected));
 input.value='';h.c.refreshLiveControls();for(const node of preview.querySelectorAll('[data-recruit-preview]'))assert.equal(node.textContent,'—');
 let removals=0;h.doc.onRemove=()=>{removals++;};h.c.refreshLiveControls();assert.equal(removals,0,'unchanged preview does not rewrite text');
});

test('governor salary is a separate gold expense and refreshes in place after dismissal',()=>{
 const scope={window:{}};vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
 const h=harness(new E({seed:4910,clan:'徳川家',officers:JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS))})),id=h.game.state.officers.find(value=>!h.game.state.army.includes(value));assert(h.game.assignGovernor('market',id).ok);
 h.host.innerHTML=h.c.economyPanel('army');const panel=h.host.firstElementChild,salary=panel.querySelector('[data-economy-rate="governorSalary"][data-economy-resource="gold"]'),people=panel.querySelector('[data-economy-governors]');
 assert.equal(salary.textContent,'−50');assert.equal(people.textContent,'1');
 for(const key of ['rice','wood','stone'])assert.equal(panel.querySelector(`[data-economy-rate="governorSalary"][data-economy-resource="${key}"]`).textContent,'0');
 for(const key of D.resources){const income=h.game.income();assert.equal(income.net[key],income.gross[key]-income.troopUpkeep[key]-income.facilityUpkeep[key]-income.governorSalary[key]-income.surplusAdjustment[key]);}
 assert.match(h.c.economyBalanceTitle('gold',h.game.income()),/奉行の給与 −50/);
 assert(h.game.assignGovernor('market',null).ok);h.c.refreshEconomyPanels(h.game.income());
 assert.strictEqual(h.host.firstElementChild,panel);assert.strictEqual(panel.querySelector('[data-economy-governors]'),people);assert.equal(people.textContent,'0');assert.equal(salary.textContent,'0');
});

test('repair costs appear separately, reduce the forecast, and stop after a paid full restoration',()=>{
 const h=harness(),id=h.game.state.home,full=h.game.castle(id).durability;
 h.game.state.castles[id].durability={version:1,current:full.max-1000,max:full.max,updatedElapsedMs:0};
 h.game.state.resources.wood=10000;h.game.state.resources.stone=10000;
 h.host.innerHTML='<div id="resources"></div><div id="calendar"></div><div id="clan-panel"></div><button id="sound-button"></button>'+h.c.economyPanel('army');h.c.renderHeader();
 const before=JSON.stringify(h.game.state),income=h.game.income();
 assert.equal(income.repairUpkeep.wood,50);assert.equal(income.repairUpkeep.stone,40);
 for(const key of D.resources){assert.equal(income.net[key],income.operatingNet[key]-income.repairUpkeep[key]);assert.equal(h.doc.querySelector(`[data-economy-rate="repairUpkeep"][data-economy-resource="${key}"]`).textContent,signed(income.repairUpkeep[key],true));}
 assert.match(h.doc.querySelector('#header-resource-wood').title,/拠点の修復費見込 −50/);assert.match(h.host.textContent,/資材が不足する場合/);assert.equal(JSON.stringify(h.game.state),before);
 const wood=h.doc.querySelector('[data-economy-rate="repairUpkeep"][data-economy-resource="wood"]');
 h.game._advanceRealtime(60);h.c.refreshEconomyPanels(h.game.income());
 assert.equal(h.game.castle(id).durability.current,full.max);assert.strictEqual(h.doc.querySelector('[data-economy-rate="repairUpkeep"][data-economy-resource="wood"]'),wood);assert.equal(wood.textContent,'0');
});

console.log(`${count} economy UI checks passed with actual app helpers and engine totals. No live requests.`);
