'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const {setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),scope={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),scope);
const roster=JSON.parse(JSON.stringify(scope.window.SENGOKU_OFFICERS));
function fn(name){const start=source.indexOf(`  function ${name}(`),lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(start>=0&&end>start,name);return source.slice(start,end);}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}
function fixture(){
 const game=new E({officers:roster,seed:4920}),{host,doc}=setup(),nodes=new Map(),handlers=new Map(),patches=[];
 const c={game,data:D,roster,state:()=>game.state,window:{SengokuManagement:require('../management-model.js')},localStorage:{setItem(){}},document:{addEventListener:(type,handler)=>handlers.set(type,handler)},
  facilitySort:'default',facilityLayout:'cards',facilityState:'all',facilityCategory:'all',facilityQuery:'',facilityPage:1,territoryState:'all',mapRegion:'all',mapQuery:'',territoryPage:1,selectedCastle:'',staffBaseId:'kyoto_gosho',crestQuery:'',crestPage:1,
  filter:{q:''},choiceFilters:{army:{q:''}},choiceMode:'army',choiceTarget:'0',choicePage:1,
  categoryNames:{economy:'生産',military:'軍備'},skillNames:{},num:String,icon:()=>'',clanCrest:()=>'',officerCrest:()=>'',portrait:()=>'',skillIcons:{},
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  currentJob:(kind,id)=>game.state.jobs.find(job=>job.kind===kind&&job.id===id),costHtml:()=>'',facilityGovernorLabel:()=>'',durabilityMarkup:()=>'',pageControls:()=>'',jobKey:()=>'',jobClockText:()=>'',sharedJobAttribution:()=>'',buildingTailLevel:id=>game.state.buildings[id],
  $:selector=>nodes.get(selector),patchHTML:(node,html)=>{patches.push(node);if(node)node.innerHTML=html;},refreshLiveControls(){},syncWorldMap(){},updateBranchTroopDraft:()=>false,
  updateOfficerFilter(context,key,value){(context==='archive'?c.filter:c.choiceFilters[context])[key]=value;patches.push(context);}
 };
 vm.createContext(c);vm.runInContext(['catalogMatches','openCatalogInputList','filteredOfficers','catalogChips','saveFacilityPreferences','resetCatalogFilters','updateCatalogSearch','facilitiesResults','territoryRows','homeCastleAppearance','campaignCastleOwnerAppearance','campaignCastleGrowth','territoryResults','crestResults','officerFilterDefaults','normalizeOfficerFilter','filterOfficerList','officerDuty','officerChoiceRows','officerChoiceResults','officerCard'].map(fn).join('\n'),c);
 return{c,game,host,doc,nodes,handlers,patches};
}
test('catalog search accepts full-width characters, old Tokugawa spelling and multiple terms',()=>{
 const {c}=fixture();assert(c.catalogMatches('徳川家 江戸城 関東',' 德川　江戸 '));assert(c.catalogMatches('ABC 123','ａｂｃ　１２３'));assert(!c.catalogMatches('徳川家 江戸城','徳川 大坂'));assert(c.catalogMatches('田畑 農業 兵糧','農業 兵糧'));
});
test('catalog lists use all currently eligible names and select through the existing input handler',()=>{
 const {c,game}=fixture();
 const input={dataset:{},value:'古い文字',dispatchEvent(event){assert.equal(event.type,'input');assert.equal(event.bubbles,true);c.updateCatalogSearch(input);}};
 c.Event=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
 c.document.getElementById=id=>input.id===id?input:null;
 let chooser;
 c.window.SengokuInputList={open:options=>{chooser=options;}};
 c.window.SengokuKamon={entries:()=>[{clan:'武田家',name:'武田菱'},{clan:'織田家',name:'木瓜'}]};
 function list(kind,id){input.id=id;c.openCatalogInputList({dataset:{kind,inputId:id}});assert(chooser.options.length);return chooser.options;}
 c.crestQuery='松本';assert.equal(list('crest','crest-search').length,2);chooser.onSelect(chooser.options[0]);assert.equal(c.crestQuery,'武田家');
 c.facilityCategory=D.buildings[0].category;c.facilityState='unbuilt';c.facilityQuery='古い検索';
 const eligible=D.buildings.filter(b=>b.category===c.facilityCategory&&!game.state.buildings[b.id]);
 const buildings=list('facility','facility-search');assert.deepEqual(new Set(buildings.map(o=>o.value)),new Set(eligible.map(b=>b.name)));
 chooser.onSelect(buildings[0]);assert.equal(c.facilityQuery,buildings[0].value);assert.equal(c.facilityState,'unbuilt');
 c.mapRegion=game.castle(game.state.home).region;c.territoryState='own';c.mapQuery='古い検索';
 const castles=list('territory','castle-search');assert(castles.every(o=>game.ownedCastles().some(castle=>castle.region===c.mapRegion&&castle.name===o.value)));
 chooser.onSelect(castles[0]);assert.equal(c.mapQuery,castles[0].value);assert.equal(c.territoryState,'own');
 input.dataset={officerFilter:'q',officerContext:'archive'};c.filter={...c.officerFilterDefaults(),q:'古い検索'};
 assert.equal(list('officer','officer-search').length,roster.length);
 for(const mode of ['army','governor']){
   input.dataset.officerContext=mode;c.choiceFilters[mode]={...c.officerFilterDefaults(mode),q:'古い検索'};
   const officers=list('officer','choice-search');assert.equal(officers.length,game.state.officers.length);
   chooser.onSelect(officers[0]);assert.equal(c.choiceFilters[mode].q,officers[0].value);
 }
});
test('stationed officers are excluded from idle, shown with their branch and cannot be assigned elsewhere',()=>{
 const {c,game,host}=fixture(),id=roster.find(o=>!game.state.army.includes(o.id)).id;game._grantOfficerVariant(id,'S');game.state.branches=[{id:'edo_north',parentCastleId:'edo',direction:'north',level:2,commanders:[id]}];
 const before=JSON.stringify(game.state),officers=game.officerViews(game.state.officers),defaults=c.officerFilterDefaults();
 assert(!c.filterOfficerList(officers,{...defaults,assignment:'idle'}).some(o=>o.id===id));assert.deepEqual(Array.from(c.filterOfficerList(officers,{...defaults,assignment:'branch'}),o=>o.id),[id]);assert.equal(c.normalizeOfficerFilter({assignment:'branch'}).assignment,'branch');
 c.choiceFilters.army={...defaults,assignment:'branch'};host.innerHTML=c.officerChoiceResults();const choice=host.querySelector('.officer-choice');assert(choice.hasAttribute('disabled'));assert.match(choice.textContent,/江戸城 北支拠点/);assert.match(choice.textContent,/配置を解除/);
 host.innerHTML=c.officerCard(game.officer(id));assert.equal(host.querySelector('[data-duty="branch"]').textContent,'江戸城 北支拠点');assert.equal(JSON.stringify(game.state),before);
});
test('facility status filters select actual unbuilt, working and completed facilities without changing progress',()=>{
 const {c,game,host}=fixture();game.state.buildings.keep=32;game.state.buildings.farm=0;game.state.buildings.market=3;game.state.jobs=[{kind:'building',id:'market',targetLevel:4,remainingSeconds:30,totalSeconds:60}];
 const before=JSON.stringify(game.state);c.facilityState='working';host.innerHTML=c.facilitiesResults();assert.equal(host.querySelectorAll('.facility-entry').length,1);assert.equal(host.querySelector('[data-action="building"]').getAttribute('data-id'),'market');
 c.facilityState='complete';host.innerHTML=c.facilitiesResults();assert.equal(host.querySelectorAll('.facility-entry').length,1);assert.match(host.textContent,/最高段階/);
 c.facilityState='unbuilt';c.facilityQuery='田畑';host.innerHTML=c.facilitiesResults();assert(host.querySelector('[data-action="building"][data-id="farm"]'));assert(host.querySelectorAll('[data-action="building"]').every(node=>game.state.buildings[node.getAttribute('data-id')]===0));
 c.facilityState='available';c.facilityQuery='商家';host.innerHTML=c.facilitiesResults();assert.equal(host.querySelectorAll('.facility-entry').length,0);assert(host.querySelector('[data-action="catalog-reset"]'));assert.equal(JSON.stringify(game.state),before);
});
test('owned and repair filters follow real castle durability and reset out-of-range pagination',()=>{
 const {c,game,host}=fixture(),id=game.state.home,view=game.castle(id).durability;game.state.castles[id].durability={version:1,current:view.max/2,max:view.max,updatedElapsedMs:0};const before=JSON.stringify(game.state);
 c.territoryState='damaged';c.territoryPage=100;host.innerHTML=c.territoryResults();assert.equal(c.territoryPage,1);assert.equal(host.querySelectorAll('.territory-row').length,1);assert.equal(host.querySelector('.territory-row').getAttribute('data-id'),id);
 c.mapQuery='存在しない拠点';host.innerHTML=c.territoryResults();assert.equal(host.querySelectorAll('.territory-row').length,0);assert.match(host.textContent,/すべての拠点を表示/);assert.equal(JSON.stringify(game.state),before);
});
test('clear conditions resets the displayed form and result state without replacing unrelated inputs',()=>{
 const {c,nodes,host,doc}=fixture();host.innerHTML='<input id="facility-search"><select id="facility-category"><option value="all">all</option></select><textarea id="draft"></textarea><div id="facility-results"></div>';
 for(const id of ['facility-search','facility-category','draft','facility-results'])nodes.set('#'+id,host.querySelector('#'+id));
 const search=nodes.get('#facility-search'),draft=nodes.get('#draft');search.value='wrong';draft.value='編成の下書き';draft.focus();c.facilityQuery='wrong';c.facilityCategory='military';c.facilityState='working';c.facilityPage=9;
 c.resetCatalogFilters('facility');assert.equal(search.value,'');assert.equal(c.facilityQuery,'');assert.equal(c.facilityCategory,'all');assert.equal(c.facilityState,'all');assert.equal(c.facilityPage,1);assert.equal(draft.value,'編成の下書き');assert.strictEqual(doc.activeElement,draft);assert(nodes.get('#facility-results').querySelectorAll('.facility-entry').length>0);
});
test('IME waits for composition end, applies once and preserves the search field',()=>{
 const {c,handlers,patches}=fixture();const start=source.indexOf("  document.addEventListener('input'"),end=source.indexOf("  document.addEventListener('change'",start);vm.runInContext(source.slice(start,end),c);
 const target={id:'officer-search',dataset:{officerFilter:'q',officerContext:'archive'},value:'徳川'};
 handlers.get('input')({target,isComposing:true});assert.equal(c.filter.q,'');assert.equal(patches.length,0);
 handlers.get('compositionend')({target});assert.equal(c.filter.q,'徳川');assert.equal(patches.length,1);
 handlers.get('input')({target,isComposing:false});assert.equal(patches.length,1);assert.equal(target.value,'徳川');
});
test('town tabs switch a single accessible panel, preserve live content and scroll only when requested',()=>{
 for(const desktop of [true,false]){
  const {host,doc}=setup(),calls=[],ids=['town-overview','town-facilities-section','town-reports-section'];
  doc.documentElement={classList:{contains:()=>desktop}};
  const c={currentView:'town',townSection:ids[0],townSections:ids,interactionEpoch:0,icon:()=>'',document:doc,$:selector=>host.querySelector(selector),refreshLiveControls(){calls.push(['live']);},refreshJobTimers(){},window:{getComputedStyle:node=>({overflowY:node.id==='main-scroll'?'auto':'visible',position:'static'})}};
  vm.createContext(c);vm.runInContext(['townPanelAttributes','townTabMarkup','syncTownSections','jumpTownSection','townSectionKeydown'].map(fn).join('\n'),c);
  const markup=()=>'<div id="main-scroll"><aside id="town-console"><nav class="town-console-nav" role="tablist">'+c.townTabMarkup()+'</nav>'+ids.map(id=>'<section id="'+id+'" '+c.townPanelAttributes(id)+'><button data-action="building">Live content '+id+'</button></section>').join('')+'</aside></div>';
  host.innerHTML=markup();const pane=host.querySelector('#town-console'),root=doc.scrollingElement,nav=pane.querySelector('nav');
  root.scrollTop=100;root.scrollLeft=0;root.scrollTo=options=>calls.push(['root',options]);pane.scrollTo=options=>calls.push(['pane',options]);
  nav.getBoundingClientRect=()=>({top:500,height:54});
  const facilities=host.querySelector('#town-facilities-section'),control=facilities.querySelector('button');
  assert(facilities.hasAttribute('hidden'));assert(facilities.hasAttribute('inert'));
  c.jumpTownSection('town-facilities-section');assert.equal(c.townSection,'town-facilities-section');
  assert(!facilities.hasAttribute('hidden'));assert(!facilities.hasAttribute('inert'));assert.strictEqual(facilities.querySelector('button'),control);
  assert.equal(host.querySelector('#town-facilities-section-tab').getAttribute('aria-selected'),'true');assert.equal(host.querySelector('#town-facilities-section-tab').getAttribute('tabindex'),'0');
  for(const id of [ids[0],ids[2]]){assert(host.querySelector('#'+id).hasAttribute('hidden'));assert(host.querySelector('#'+id).hasAttribute('inert'));assert.equal(host.querySelector('#'+id+'-tab').getAttribute('tabindex'),'-1');}
  const scrolling=calls.filter(([type])=>type!=='live');assert.equal(scrolling.length,1);assert.equal(scrolling[0][0],desktop?'pane':'root');assert.equal(scrolling[0][1].top,desktop?0:588);
  control.textContent='Updated Lv.2';c.syncTownSections();assert.equal(control.textContent,'Updated Lv.2');assert.equal(calls.filter(([type])=>type!=='live').length,1,'Background reconciliation must never replay a scroll');
  control.focus();c.jumpTownSection('town-reports-section',{scroll:false});assert.equal(doc.activeElement.id,'town-reports-section-tab');assert.equal(calls.filter(([type])=>type!=='live').length,1);
  host.innerHTML=markup();assert(!host.querySelector('#town-reports-section').hasAttribute('hidden'),'A later render preserves the selected tab');assert(host.querySelector('#town-facilities-section').hasAttribute('hidden'));
  const before=calls.length;c.jumpTownSection('arbitrary-id');c.currentView='map';c.jumpTownSection(ids[0]);assert.equal(calls.length,before);
 }
});
test('town tab keyboard travel wraps and respects modifiers without changing game actions',()=>{
 const {host,doc}=setup(),ids=['town-overview','town-facilities-section','town-reports-section'],calls=[];
 const c={townSection:ids[0],townSections:ids,icon:()=>'',jumpTownSection:(id,options)=>calls.push([id,options])};
 vm.createContext(c);vm.runInContext(['townTabMarkup','townSectionKeydown'].map(fn).join('\n'),c);host.innerHTML='<nav class="town-console-nav">'+c.townTabMarkup()+'</nav>';
 for(const [key,from,to] of [['ArrowRight',0,1],['ArrowLeft',0,2],['Home',2,0],['End',0,2]]){
  const event={key,target:host.querySelector('#'+ids[from]+'-tab'),preventDefault(){this.defaultPrevented=true;}};c.townSectionKeydown(event);assert(event.defaultPrevented);assert.equal(calls.at(-1)[0],ids[to]);assert.equal(calls.at(-1)[1].scroll,false);assert.equal(calls.at(-1)[1].focus,true);
 }
 const before=calls.length;c.townSectionKeydown({key:'ArrowRight',ctrlKey:true,target:host.querySelector('button')});assert.equal(calls.length,before);
});
console.log(`${count} catalog usability and assignment regression checks passed.`);
