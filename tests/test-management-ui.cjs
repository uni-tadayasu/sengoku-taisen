'use strict';
// Exercise the actual app handlers and renderer against the real engine. This
// fixture checks DOM identity and interaction, without simulating browser layout.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:data}=require('../engine.js');
const {officers:roster}=require('../tools/audit-economy.cjs');
const {setup}=require('./helpers/dom-model.cjs');
const model=require('../management-model.js'),stableDOM=require('../stable-dom.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`),lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(start>=0&&end>start,name);return source.slice(start,end);}
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const categories={gold:'商業',rice:'農業・兵糧',wood:'林業・木材',stone:'鉱業・石材',military:'軍備',defense:'城郭・防衛',research:'学問・技術',diplomacy:'統治・外交'};
const memory=()=>{const values=new Map();return{values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};};
function fixture(storage=memory()){
 const game=new Engine({officers:roster,seed:4920,clan:'織田家'}),{host,doc}=setup(),handlers=new Map(),notices=[],dialogs=[];
 host.id='main';doc.addEventListener=(type,handler)=>handlers.set(type,handler);
 const dialog=doc.createElement('dialog');doc.body.appendChild(dialog);
 const prefs=model.readPreferences(storage,Object.keys(categories));
 const c={game,data,roster,state:()=>game.state,document:doc,localStorage:storage,
  window:{SengokuManagement:model,SengokuStableDOM:stableDOM},categoryNames:categories,
  facilityQuery:prefs.query,facilityCategory:prefs.category,facilityState:prefs.state,facilitySort:prefs.sort,facilityLayout:prefs.layout,facilityPage:1,
  officerComparison:[],filter:{q:''},choiceFilters:{},skillNames:{},skillDescriptions:{},skillIcons:{},
  resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},resIcons:{},esc:escape,num:String,
  icon:name=>`<span class="test-icon" data-icon="${name}"></span>`,clanCrest:()=>'',
  portrait:o=>`<span class="test-portrait" data-portrait="${o.id}:${o.rank}"><img src="${o.id}-${o.rank}.png" alt="${escape(o.name)}"></span>`,
  $:selector=>doc.querySelector(selector),toast:message=>notices.push(message),
  modal:(title,subtitle,body,footer,kind,context)=>{dialogs.push({title,subtitle,body,footer,kind,context});stableDOM.patch(dialog,body+footer);dialog.showModal();},
  facilityGovernorLabel:id=>game.state.governors[id]?'<small>奉行任命済み</small>':'<small>奉行未任命</small>',
  currentJob:(kind,id)=>game.constructionJobs().find(job=>job.kind===kind&&job.id===id),
  jobKey:job=>`${job.kind}:${job.id}:${job.targetLevel}`,jobClockText:()=> '30秒',sharedJobAttribution:()=>'',
  buildingTailLevel:id=>Math.max(game.state.buildings[id]||0,...game.constructionJobs().filter(job=>job.kind==='building'&&job.id===id).map(job=>job.targetLevel)),
  refreshLiveControls(){},refreshJobTimers(){},updateBranchTroopDraft:()=>false,
  mutationActions:new Set(),requireWritable:()=>true,preserveInteraction:(_host,draw)=>draw(),
  render:()=>c.patchHTML(host,facilityMarkup()),go(){},activeModal:''
 };
 vm.createContext(c);
 vm.runInContext(['patchHTML','costHtml','pageControls','catalogMatches','catalogChips','constructionJobs','saveFacilityPreferences','facilityPlannerTools','facilitiesResults','resetCatalogFilters','updateCatalogSearch','officerDuty','officerCard','officerComparisonSelected','officerCompareCard','officerComparisonTray','refreshOfficerComparisonSelection','toggleOfficerComparison','officerComparisonModal'].map(fn).join('\n'),c);
 const clickStart=source.indexOf("  document.addEventListener('click',async event=>"),clickEnd=source.indexOf("  document.addEventListener('submit'",clickStart);
 assert(clickStart>=0&&clickEnd>clickStart);vm.runInContext(source.slice(clickStart,clickEnd),c);
 const inputStart=source.indexOf("  document.addEventListener('input'"),inputEnd=source.indexOf("  document.addEventListener('keydown'",inputStart);
 assert(inputStart>=0&&inputEnd>inputStart);vm.runInContext(source.slice(inputStart,inputEnd),c);
 function facilityMarkup(){return `<input id="facility-search" value="${escape(c.facilityQuery)}"><select id="facility-category"><option value="all">すべて</option>${Object.entries(categories).map(([id,label])=>`<option value="${id}"${c.facilityCategory===id?' selected':''}>${label}</option>`).join('')}</select><textarea id="draft"></textarea>${c.facilityPlannerTools()}<div id="facility-results">${c.facilitiesResults()}</div>`;}
 function mountFacilities(){c.patchHTML(host,facilityMarkup());}
 function mountOfficers(rows){c.patchHTML(host,`<input id="officer-search"><textarea id="draft"></textarea><section id="officer-compare-tray">${c.officerComparisonTray()}</section><div id="officer-results">${rows.map(row=>c.officerCompareCard(game.officer(row.id,row.rank))).join('')}</div>`);}
 async function click(node){assert(node?.isConnected,'click target must be mounted');await handlers.get('click')({target:node});}
 return{c,game,host,doc,dialog,storage,handlers,notices,dialogs,mountFacilities,mountOfficers,click};
}
const tests=[];function test(name,run){tests.push({name,run});}
const choices=(count=4)=>roster.slice(0,count).map(row=>({id:row.id,rank:'D'}));
const selected=c=>JSON.parse(JSON.stringify(c.officerComparison));

test('comparison clicks retain mounted cards, painted portraits, focused buttons and input selection',async()=>{
 const f=fixture(),{c,game,host,doc}=f,rows=choices();f.mountOfficers(rows);
 const cards=host.querySelectorAll('.officer-card'),images=host.querySelectorAll('.test-portrait img'),toggles=host.querySelectorAll('.officer-compare-toggle'),search=host.querySelector('#officer-search'),draft=host.querySelector('#draft'),results=host.querySelector('#officer-results');
 const before=JSON.stringify(game.state);results.scrollTop=416;host.scrollTop=280;draft.value='編成はまだ検討中';toggles[0].focus();
 await f.click(toggles[0]);assert.strictEqual(doc.activeElement,toggles[0]);assert.equal(toggles[0].getAttribute('aria-pressed'),'true');assert(toggles[0].closest('article').classList.contains('is-comparing'));assert(host.querySelector('#officer-compare-open').disabled);
 await f.click(toggles[1]);assert(!host.querySelector('#officer-compare-open').disabled);assert.match(host.querySelector('#officer-compare-count').textContent,/2 \/ 3/);
 for(let i=0;i<cards.length;i++){assert.strictEqual(host.querySelectorAll('.officer-card')[i],cards[i]);assert.strictEqual(host.querySelectorAll('.test-portrait img')[i],images[i]);assert.equal(cards[i].querySelector('button'),null,'comparison actions must not nest inside officer buttons');}
 search.value='徳川 家康';search.focus();search.setSelectionRange(1,4,'backward');
 for(let n=0;n<10;n++)c.refreshOfficerComparisonSelection();
 assert.strictEqual(doc.activeElement,search);assert.equal(search.value,'徳川 家康');assert.equal(search.selectionStart,1);assert.equal(search.selectionEnd,4);assert.equal(search.selectionDirection,'backward');assert.equal(draft.value,'編成はまだ検討中');assert.equal(results.scrollTop,416);assert.equal(host.scrollTop,280);assert.equal(JSON.stringify(game.state),before);
});
test('one officer occupies one comparison slot across ranks and three slots are enforced by real handlers',async()=>{
 const f=fixture(),{c,host,notices}=f,rows=choices();f.mountOfficers(rows);
 const toggles=host.querySelectorAll('.officer-compare-toggle');for(const node of toggles.slice(0,3))await f.click(node);
 await f.click(toggles[3]);assert.deepEqual(selected(c),rows.slice(0,3));assert.match(notices.at(-1),/3名まで/);assert.equal(toggles[3].getAttribute('aria-pressed'),'false');
 f.mountOfficers([{id:rows[0].id,rank:'S'},...rows.slice(1)]);const higher=host.querySelector('.officer-compare-toggle');await f.click(higher);
 assert.equal(c.officerComparison.length,3);assert.deepEqual(selected(c)[0],{id:rows[0].id,rank:'S'});assert.equal(host.querySelectorAll('.officer-compare-pick').length,3);assert.equal(higher.getAttribute('aria-pressed'),'true');
 assert.equal(host.querySelector('.officer-compare-pick').getAttribute('aria-label'),`${c.game.officer(rows[0].id,'S').name} Sランクを比較から外す`);
 await f.click(higher);assert.deepEqual(selected(c),rows.slice(1,3));assert.equal(higher.getAttribute('aria-pressed'),'false');
 c.toggleOfficerComparison('missing','S');c.toggleOfficerComparison(rows[0].id,'admin');assert.deepEqual(selected(c),rows.slice(1,3));
});
test('removing a focused pick and clearing the tray always leave a valid keyboard destination',async()=>{
 const f=fixture(),{host,doc,c}=f;f.mountOfficers(choices(3));for(const node of host.querySelectorAll('.officer-compare-toggle'))await f.click(node);
 const removed=host.querySelector('.officer-compare-pick');removed.focus();await f.click(removed);assert(!removed.isConnected);assert(doc.activeElement.isConnected);assert(doc.activeElement.classList.contains('officer-compare-pick'));assert.equal(c.officerComparison.length,2);
 const clear=host.querySelector('[data-action="officer-compare-clear"]');clear.focus();await f.click(clear);assert.equal(c.officerComparison.length,0);assert(doc.activeElement.isConnected);assert(doc.activeElement.classList.contains('officer-compare-toggle'));assert(host.querySelector('#officer-compare-open').disabled);
});
test('removing the last comparison with no visible results returns focus to search, never a closed detail',async()=>{
 for(const action of ['.officer-compare-pick','[data-action="officer-compare-clear"]']){
  const f=fixture(),{c,doc,host,dialog,game}=f,row=choices(1)[0];f.mountOfficers([]);
  dialog.innerHTML=c.officerCompareCard(game.officer(row.id,row.rank));dialog.showModal();await f.click(dialog.querySelector('.officer-compare-toggle'));dialog.close();
  const search=host.querySelector('#officer-search');search.value='該当する武将なし';search.setSelectionRange(2,5);
  const remove=host.querySelector(action);remove.focus();await f.click(remove);
  assert.equal(c.officerComparison.length,0);assert.equal(dialog.open,false);assert.strictEqual(doc.activeElement,search);assert.equal(search.value,'該当する武将なし');assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,5);
 }
 const f=fixture(),{host,doc}=f;f.mountOfficers(choices(1));await f.click(host.querySelector('.officer-compare-toggle'));
 host.querySelector('#officer-results').setAttribute('hidden','');const clear=host.querySelector('[data-action="officer-compare-clear"]');clear.focus();await f.click(clear);assert.strictEqual(doc.activeElement,host.querySelector('#officer-search'));
});
test('the archive menu opens the collection while explicit gacha actions and in-screen tabs keep their destination',async()=>{
 const f=fixture(),{c,doc,host,dialog}=f,rendered=[],hashes=[];
 Object.assign(c,{interactionEpoch:0,currentView:'town',officerSection:'gacha',closeModal:()=>dialog.close(),syncMusic(){},history:{replaceState:(_state,_title,url)=>hashes.push(url)},render:()=>rendered.push([c.currentView,c.officerSection])});
 doc.documentElement=doc.createElement('html');
 const revealed=[];
 c.window.SengokuNavigation={revealView:view=>revealed.push(view)};
 vm.runInContext(fn('go'),c);
 const nav=doc.createElement('nav');nav.id='navigation';nav.innerHTML='<button data-view="officers">武将名鑑</button>';doc.body.appendChild(nav);
 await f.click(nav.querySelector('button'));assert.equal(c.currentView,'officers');assert.equal(c.officerSection,'archive');assert.deepEqual(rendered.at(-1),['officers','archive']);
 host.innerHTML='<button data-action="officer-section" data-id="gacha">武将招集</button><button data-action="officer-section" data-id="archive">武将名鑑</button><button data-action="open-gacha">招集へ</button>';
 await f.click(host.querySelector('[data-id="gacha"]'));assert.equal(c.officerSection,'gacha');c.go('officers');assert.equal(c.officerSection,'gacha');
 await f.click(host.querySelector('[data-id="archive"]'));assert.equal(c.officerSection,'archive');await f.click(host.querySelector('[data-action="open-gacha"]'));assert.equal(c.officerSection,'gacha');
 await f.click(nav.querySelector('button'));assert.equal(c.officerSection,'archive');assert.equal(hashes.at(-1),'#officers');assert.equal(c.interactionEpoch,6);assert(revealed.length>0&&revealed.every(view=>view==='officers'));
});
test('comparison distinguishes selected owned/unowned ranks from highest owned and renders the selected abilities',async()=>{
 const f=fixture(),{game,c,host,dialog,dialogs}=f,available=roster.filter(row=>!game.state.officers.includes(row.id)),owned=available[0].id,unowned=available[1].id;
 game._grantOfficerVariant(owned,'D');game._grantOfficerVariant(owned,'S');f.mountOfficers([{id:owned,rank:'D'},{id:unowned,rank:'U'}]);const before=JSON.stringify(game.state);
 for(const node of host.querySelectorAll('.officer-compare-toggle'))await f.click(node);await f.click(host.querySelector('#officer-compare-open'));
 assert.equal(dialogs.length,1);assert.equal(dialogs[0].kind,'officer-comparison');assert.equal(dialog.querySelectorAll('.comparison-person').length,2);
 const cards=dialog.querySelectorAll('.comparison-person');assert.equal(cards[0].getAttribute('data-rank'),'D');assert.match(cards[0].querySelector('.eyebrow').textContent,/D · 絵巻所持/);assert.equal(cards[0].querySelector('.comparison-highest').textContent,'最高所持：S');
 assert.match(cards[1].querySelector('.eyebrow').textContent,/U · 未所持の絵巻/);assert.equal(cards[1].querySelector('.comparison-highest').textContent,'最高所持：未登用');
 const expected=[game.officer(owned,'D'),game.officer(unowned,'U')],rows=dialog.querySelectorAll('tbody tr');assert.equal(rows.length,4);
 ['lead','valor','intellect','politics'].forEach((key,index)=>{const cells=rows[index].querySelectorAll('td'),best=Math.max(...expected.map(officer=>officer[key]));assert.equal(cells.length,2);cells.forEach((cell,column)=>{assert.equal(Number(cell.querySelector('strong').textContent),expected[column][key]);assert.equal(cell.classList.contains('comparison-best'),expected[column][key]===best);});});
 assert(dialog.querySelector('[data-view="army"]'));assert.equal(dialog.querySelectorAll('[data-action="officer"]').length,2);
 c.toggleOfficerComparison(owned,'U');c.officerComparisonModal();const higher=dialog.querySelector('.comparison-person');assert.match(higher.querySelector('.eyebrow').textContent,/U · 未所持の絵巻/);assert.equal(higher.querySelector('.comparison-highest').textContent,'最高所持：S');assert.equal(Number(dialog.querySelector('tbody tr td strong').textContent),game.officer(owned,'U').lead);
 assert.equal(JSON.stringify(game.state),before,'comparison must neither grant a variant nor change assignments');
});
test('compact facilities show sixteen entries, clamp pagination and keep management access at maximum level',async()=>{
 const f=fixture(),{c,game,host}=f;game.state.buildings.keep=32;game.state.buildings.farm=32;f.mountFacilities();const before=JSON.stringify(game.state);
 assert.equal(host.querySelectorAll('.facility-entry').length,6);await f.click(host.querySelector('[data-action="facility-layout"][data-id="list"]'));
 assert.equal(c.facilityLayout,'list');assert(host.querySelector('.facility-catalog-list'));assert.equal(host.querySelectorAll('.facility-entry').length,16);assert.equal(host.querySelector('[data-action="facility-layout"][data-id="list"]').getAttribute('aria-pressed'),'true');
 c.facilityPage=999;c.patchHTML(host.querySelector('#facility-results'),c.facilitiesResults());assert.equal(c.facilityPage,Math.ceil(data.buildings.length/16));assert(host.querySelector('[data-action="facility-page"][data-delta="1"]').disabled);
 const complete=host.querySelector('[data-action="catalog-state"][data-id="complete"]');await f.click(complete);assert.equal(c.facilityPage,1);assert.equal(host.querySelectorAll('.facility-entry').length,2);
 for(const entry of host.querySelectorAll('.facility-entry')){const action=entry.querySelector('[data-action="building"]');assert(action&&!action.disabled);assert.match(action.textContent,/施設・奉行を確認/);assert.equal(entry.querySelector('[data-facility-status]').textContent,'最高段階');assert.equal(entry.querySelector('[data-facility-funding]'),null);}
 assert.equal(JSON.stringify(game.state),before);
});
test('facility controls persist search, state, category, sort and layout through their real event handlers',async()=>{
 const f=fixture(),{c,host,handlers,storage,game}=f;f.mountFacilities();const before=JSON.stringify(game.state),search=host.querySelector('#facility-search'),category=host.querySelector('#facility-category'),sort=host.querySelector('#facility-sort'),draft=host.querySelector('#draft');
 draft.value='普請のメモ';search.value='  木材  ';search.focus();search.setSelectionRange(2,4);handlers.get('input')({target:search,isComposing:true});assert.equal(c.facilityQuery,'');handlers.get('compositionend')({target:search});assert.equal(c.facilityQuery,'木材');assert.strictEqual(host.querySelector('#facility-search'),search);assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,4);
 category.value='wood';handlers.get('change')({target:category});assert.equal(c.facilityCategory,'wood');
 await f.click(host.querySelector('[data-action="catalog-state"][data-id="unbuilt"]'));assert.equal(c.facilityState,'unbuilt');
 sort.value='level-desc';handlers.get('change')({target:sort});assert.equal(c.facilitySort,'level-desc');
 await f.click(host.querySelector('[data-action="facility-layout"][data-id="list"]'));
 assert.deepEqual(model.readPreferences(storage,Object.keys(categories)),{query:'木材',category:'wood',state:'unbuilt',sort:'level-desc',layout:'list'});assert.equal(storage.values.size,1);assert.equal(host.querySelector('#draft').value,'普請のメモ');assert.equal(JSON.stringify(game.state),before);
 const resumed=fixture(storage);resumed.mountFacilities();assert.equal(resumed.c.facilityQuery,'木材');assert.equal(resumed.host.querySelector('#facility-category').value,'wood');assert.equal(resumed.host.querySelector('#facility-sort').value,'level-desc');assert.equal(resumed.host.querySelector('[data-action="catalog-state"][data-id="unbuilt"]').getAttribute('aria-pressed'),'true');assert(resumed.host.querySelector('.facility-catalog-list'));
});
test('sorting orders real levels and costs; resetting conditions keeps display preference and restores search focus',async()=>{
 const f=fixture(),{c,game,host,handlers}=f;game.state.buildings.keep=32;for(const [index,building]of data.buildings.entries())game.state.buildings[building.id]=building.id==='keep'?32:index%11;
 c.facilityLayout='list';f.mountFacilities();const sort=host.querySelector('#facility-sort');sort.value='level-desc';handlers.get('change')({target:sort});
 let ids=host.querySelectorAll('[data-facility-entry]').map(node=>node.getAttribute('data-facility-entry'));assert.equal(ids.length,16);for(let i=1;i<ids.length;i++)assert(game.state.buildings[ids[i-1]]>=game.state.buildings[ids[i]]);
 sort.value='cost';handlers.get('change')({target:sort});ids=host.querySelectorAll('[data-facility-entry]').map(node=>node.getAttribute('data-facility-entry'));for(let i=1;i<ids.length;i++)assert(game.costs(ids[i-1]).gold<=game.costs(ids[i]).gold);
 const search=host.querySelector('#facility-search');search.value='存在しない施設';handlers.get('input')({target:search,isComposing:false});assert.equal(host.querySelectorAll('.facility-entry').length,0);assert.equal(c.facilityPage,1);
 const reset=host.querySelector('[data-action="catalog-reset"]');reset.focus();await f.click(reset);assert.equal(c.facilityQuery,'');assert.equal(c.facilityCategory,'all');assert.equal(c.facilityState,'all');assert.equal(c.facilitySort,'cost');assert.equal(c.facilityLayout,'list');assert.strictEqual(f.doc.activeElement,search);assert.equal(host.querySelectorAll('.facility-entry').length,16);
});
test('the affordable filter can be refreshed explicitly after income changes without mutating the campaign',async()=>{
 const f=fixture(),{c,host,game}=f;game.state.resources={gold:0,rice:0,wood:0,stone:0};c.facilityState='affordable';f.mountFacilities();assert.equal(host.querySelectorAll('.facility-entry').length,0);
 for(const key of ['gold','rice','wood','stone'])game.state.resources[key]=1000000;
 const before=JSON.stringify(game.state);await f.click(host.querySelector('[data-action="facility-refresh"]'));
 assert(host.querySelectorAll('.facility-entry').length>0);assert.equal(c.facilityState,'affordable');assert.equal(JSON.stringify(game.state),before);
});
test('a denied localStorage getter leaves facility controls and in-memory preferences usable',async()=>{
 const f=fixture(),{c,host}=f;f.mountFacilities();Object.defineProperty(c,'localStorage',{configurable:true,get(){throw new Error('SecurityError');}});
 await f.click(host.querySelector('[data-action="facility-layout"][data-id="list"]'));
 assert.equal(c.facilityLayout,'list');assert.equal(host.querySelectorAll('.facility-entry').length,16);
 c.facilityQuery='田';assert.doesNotThrow(()=>c.saveFacilityPreferences());assert.equal(c.facilityQuery,'田');
});

test('planner counts construction chains once, includes castle/branch slots and excludes research',()=>{
 const {c,game,host}=fixture();game.state.jobs=[{kind:'building',id:'farm',targetLevel:2,totalSeconds:60,remainingSeconds:30},{kind:'building',id:'farm',targetLevel:3,totalSeconds:60,remainingSeconds:60},{kind:'castle',id:game.state.home,targetLevel:2,totalSeconds:60,remainingSeconds:40},{kind:'research',id:data.techs[0].id,targetLevel:1,totalSeconds:60,remainingSeconds:20}];
 const original=game.constructionJobs.bind(game);game.constructionJobs=()=>[...original(),{kind:'branch',id:'nagoya_north',targetLevel:1,totalSeconds:60,remainingSeconds:40}];
 const before=JSON.stringify(game.state);host.innerHTML=c.facilityPlannerTools();assert.match(host.querySelector('.facility-planner-overview').textContent,/普請の使用枠3/);assert(host.querySelector('[data-action="command-activity"][data-filter="construction"]'));assert.equal(JSON.stringify(game.state),before);
});

(async()=>{for(const {name,run}of tests){await run();console.log('PASS '+name);}console.log(`${tests.length} management UI interaction regression checks passed.`);})().catch(error=>{console.error(error);process.exitCode=1;});
