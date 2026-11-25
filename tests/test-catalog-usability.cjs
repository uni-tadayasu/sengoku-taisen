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
 const c={game,data:D,roster,state:()=>game.state,window:{},document:{addEventListener:(type,handler)=>handlers.set(type,handler)},
  facilityState:'all',facilityCategory:'all',facilityQuery:'',facilityPage:1,territoryState:'all',mapRegion:'all',mapQuery:'',territoryPage:1,selectedCastle:'',staffBaseId:'kyoto_gosho',crestQuery:'',crestPage:1,
  filter:{q:''},choiceFilters:{army:{q:''}},choiceMode:'army',choiceTarget:'0',choicePage:1,
  categoryNames:{economy:'生産',military:'軍備'},skillNames:{},num:String,icon:()=>'',clanCrest:()=>'',officerCrest:()=>'',portrait:()=>'',skillIcons:{},
  esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  currentJob:(kind,id)=>game.state.jobs.find(job=>job.kind===kind&&job.id===id),costHtml:()=>'',facilityGovernorLabel:()=>'',durabilityMarkup:()=>'',pageControls:()=>'',jobKey:()=>'',jobClockText:()=>'',sharedJobAttribution:()=>'',buildingTailLevel:id=>game.state.buildings[id],
  $:selector=>nodes.get(selector),patchHTML:(node,html)=>{patches.push(node);if(node)node.innerHTML=html;},refreshLiveControls(){},syncWorldMap(){},updateBranchTroopDraft:()=>false,
  updateOfficerFilter(context,key,value){(context==='archive'?c.filter:c.choiceFilters[context])[key]=value;patches.push(context);}
 };
 vm.createContext(c);vm.runInContext(['catalogMatches','catalogChips','resetCatalogFilters','updateCatalogSearch','facilitiesResults','territoryResults','crestResults','officerFilterDefaults','normalizeOfficerFilter','filterOfficerList','officerDuty','officerChoiceResults','officerCard'].map(fn).join('\n'),c);
 return{c,game,host,doc,nodes,handlers,patches};
}
test('catalog search accepts full-width characters, old Tokugawa spelling and multiple terms',()=>{
 const {c}=fixture();assert(c.catalogMatches('徳川家 江戸城 関東',' 德川　江戸 '));assert(c.catalogMatches('ABC 123','ａｂｃ　１２３'));assert(!c.catalogMatches('徳川家 江戸城','徳川 大坂'));assert(c.catalogMatches('田畑 農業 兵糧','農業 兵糧'));
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
test('town shortcuts scroll only the nearest pane and keep sticky controls clear',()=>{
 for(const desktop of [true,false]){
  const calls=[],root={scrollTop:100,scrollLeft:0,scrollTo:options=>calls.push(['root',options]),getBoundingClientRect:()=>({top:0})},nav={getBoundingClientRect:()=>({height:54})},target={getBoundingClientRect:()=>({top:500})},header={getBoundingClientRect:()=>({height:110})},announcement={getBoundingClientRect:()=>({height:48})};
  const pane={parentElement:root,scrollTop:100,scrollLeft:0,scrollHeight:desktop?1000:0,clientHeight:desktop?400:0,contains:node=>node===target,querySelector:()=>nav,getBoundingClientRect:()=>({top:100}),scrollTo:options=>calls.push(['pane',options])};
  const nodes={'#town-console':pane,'#town-facilities-section':target,'.topbar':header,'#announcement-bar':announcement};
  const c={currentView:'town',interactionEpoch:0,document:{scrollingElement:root},$:selector=>nodes[selector],window:{getComputedStyle:node=>({overflowY:node===pane&&desktop?'auto':'visible',position:node===nav?(desktop?'sticky':'static'):node===header||node===announcement?'sticky':'static'})}};
  vm.createContext(c);vm.runInContext(fn('jumpTownSection'),c);c.jumpTownSection('town-facilities-section');assert.equal(calls.length,1);assert.equal(calls[0][0],desktop?'pane':'root');assert.equal(calls[0][1].top,desktop?434:430);assert.equal(c.interactionEpoch,1);c.jumpTownSection('arbitrary-id');assert.equal(calls.length,1);c.currentView='map';c.jumpTownSection('town-facilities-section');assert.equal(calls.length,1);
 }
});
console.log(`${count} catalog usability and assignment regression checks passed.`);
