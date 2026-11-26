'use strict';
// Exercise the planning models with the real campaign engine. These reads must
// not consume resources/commands, change ownership or settle an active journey.
const assert=require('node:assert/strict');
const {SengokuEngine:Engine,SENGOKU_DATA:data}=require('../engine.js');
const {officers}=require('../tools/audit-economy.cjs');
const model=require('../management-model.js');
const make=()=>new Engine({officers,seed:482,clan:'織田家'});
const categories=[...new Set(data.buildings.map(row=>row.category))];
const memory=()=>{const values=new Map();return{values,getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};};
let checks=0;function test(name,run){run();checks++;console.log('PASS '+name);}
function funded(game){for(const key of data.resources)game.state.resources[key]=1000000;}
function rows(game){return model.facilityRows(game,data.buildings);}
function row(game,id){return rows(game).find(value=>value.building.id===id);}
function ids(values){return values.map(value=>value.building.id);}

test('facility planning leaves a live army, queued construction and all campaign data unchanged',()=>{
 const game=make();funded(game);assert(game.upgrade('farm').ok);assert(game.upgrade('farm').ok);
 const target=game.adjacentTargets().find(castle=>game.previewBattle(castle.id,'balanced',500).ok);assert(target);
 assert(game.departAttack(target.id,'balanced',500).accepted);const before=JSON.stringify(game.state);
 for(let n=0;n<20;n++){
  const values=rows(game),farm=values.find(value=>value.building.id==='farm');
  assert.equal(values.length,data.buildings.length);assert.equal(farm.status,'working');assert.equal(farm.job.targetLevel,game.state.buildings.farm+1);assert.equal(farm.job.queued,false);
  for(const state of model.STATES)for(const sort of model.SORTS)model.filterFacilities(values,{state,sort});
 }
 assert.equal(JSON.stringify(game.state),before);
});
test('funding requires every resource and uses the exact next upgrade cost',()=>{
 const game=make(),cost=game.costs('farm');game.state.resources={...game.state.resources,...Object.fromEntries(['gold','rice','wood','stone'].map(key=>[key,cost[key]||0]))};
 assert.equal(row(game,'farm').status,'funded');assert(model.filterFacilities(rows(game),{state:'affordable'}).some(value=>value.building.id==='farm'));
 game.state.resources.wood--;const farm=row(game,'farm');assert.equal(farm.status,'shortage');assert.deepEqual(farm.shortages,['wood']);
 assert(!model.filterFacilities(rows(game),{state:'affordable'}).some(value=>value.building.id==='farm'));
 // Candidate means the keep/queue conditions are met. Actual funding, commands
 // and construction slots remain authoritatively checked by the existing action.
 assert(model.filterFacilities(rows(game),{state:'available'}).some(value=>value.building.id==='farm'));
});
test('locked, working, unbuilt, vacant and completed filters stay distinct',()=>{
 const game=make();funded(game);const locked=data.buildings.find(building=>building.requiredKeep>game.state.buildings.keep);assert(locked);
 assert.equal(row(game,locked.id).status,'locked');assert(!model.filterFacilities(rows(game),{state:'available'}).some(value=>value.building.id===locked.id));
 assert(model.filterFacilities(rows(game),{state:'unbuilt'}).some(value=>value.building.id===locked.id));
 game.state.governors.farm=game.state.officers[0];assert(!model.filterFacilities(rows(game),{state:'vacant'}).some(value=>value.building.id==='farm'));
 game.state.buildings.farm=32;const farm=row(game,'farm');assert.equal(farm.status,'complete');assert.deepEqual(farm.cost,{});
 assert(model.filterFacilities(rows(game),{state:'complete'}).some(value=>value.building.id==='farm'));
 assert(!model.filterFacilities(rows(game),{state:'affordable'}).some(value=>value.building.id==='farm'));
});
test('staff planning follows shared work without mistaking retained personal jobs for shared jobs',()=>{
 const personal=make();funded(personal);assert(personal.upgrade('farm').ok);personal.applyWorldClock({id:'model-world',elapsedMs:0,running:true,speed:1});
 const buildings={...personal.state.buildings,farm:5,market:8};
 const base={id:'kyoto_gosho',revision:1,castleLevel:1,buildings,initial:{castleLevel:1,buildings:{...buildings}},history:[],accessSinceElapsedMs:0,personalHome:personal.state.home,personalCycleHome:personal.state.cycle.home,personalClan:personal.state.clan,personalBaseCastle:structuredClone(personal.state.castles.kyoto_gosho),personalHomeCastle:structuredClone(personal.state.castles[personal.state.home]),jobs:[{jobId:'shared-market',kind:'building',id:'market',targetLevel:9,totalSeconds:60,startedElapsedMs:0,completesElapsedMs:60000,startedBy:{id:'staff_one',name:'任命者'}}]};
 const game=Engine.fromSave(personal.exportSave(),officers,{isStaff:true,staffBase:base});assert(game.isStaff);assert(game.getStaffBase());
 const before=JSON.stringify(game.state),sharedBefore=JSON.stringify(game.getStaffBase()),values=rows(game);
 const farm=values.find(value=>value.building.id==='farm'),market=values.find(value=>value.building.id==='market');
 assert.equal(farm.level,5);assert.equal(farm.job,null,'the retained personal farm job is not a shared construction');
 assert.equal(market.job.shared,true);assert.equal(market.job.targetLevel,9);assert.equal(market.status,'working');
 assert.deepEqual(ids(model.filterFacilities(values,{state:'working'})),['market']);
 assert.equal(JSON.stringify(game.state),before);assert.equal(JSON.stringify(game.getStaffBase()),sharedBefore);
});
test('all sort modes preserve row input order and ties are deterministic',()=>{
 const game=make();funded(game);game.state.buildings.farm=32;const values=rows(game),original=ids(values),before=JSON.stringify(values);
 for(const sort of model.SORTS){const ordered=model.filterFacilities(values,{sort});assert.equal(ordered.length,values.length);assert.deepEqual(ids(values),original);}
 const price=model.filterFacilities(values,{sort:'cost'});assert.equal(price.at(-1).building.id,'farm','completed rows have no next cost and sort last');
 for(let i=1;i<price.length-1;i++)assert(price[i-1].cost.gold<=price[i].cost.gold);
 const ascending=model.filterFacilities(values,{sort:'level-asc'});for(let i=1;i<ascending.length;i++){assert(ascending[i-1].level<=ascending[i].level);if(ascending[i-1].level===ascending[i].level)assert(ascending[i-1].index<ascending[i].index);}
 assert.deepEqual(ids(model.filterFacilities(values,{sort:'corrupt'})),original);assert.equal(JSON.stringify(values),before);
});
test('category and search combine without allowing stale preferences to hide all facilities',()=>{
 const game=make(),values=rows(game),pick=values.find(value=>value.building.id==='farm'),matches=(text,query)=>text.includes(query);
 const found=model.filterFacilities(values,{category:pick.building.category,query:pick.building.name},matches);assert(ids(found).includes('farm'));assert(found.every(value=>value.building.category===pick.building.category));assert(found.length<values.length);
 assert.equal(model.filterFacilities(values,{category:'missing',state:'bad',sort:'bad'}).length,data.buildings.length);
 assert.equal(model.filterFacilities(values,{query:'存在しない施設名'},matches).length,0);
});
test('malformed preferences normalize safely and storage failure never blocks play',()=>{
 const expected={query:'',category:'all',state:'all',sort:'default',layout:'cards'};
 for(const value of [null,undefined,17,'bad',[],{query:42,category:{},state:[],sort:null,layout:true}])assert.deepEqual(model.normalizePreferences(value,categories),expected);
 const storage=memory();storage.setItem(model.FACILITY_KEY,'{bad json');assert.deepEqual(model.readPreferences(storage,categories),expected);
 const preferences=model.savePreferences(storage,{query:'農'.repeat(200),category:categories[0],state:'affordable',sort:'cost',layout:'list'},categories);
 assert.equal(preferences.query.length,80);assert.equal(preferences.category,categories[0]);assert.equal(preferences.state,'affordable');assert.equal(preferences.layout,'list');assert.deepEqual(model.readPreferences(storage,categories),preferences);
 assert.deepEqual([...storage.values.keys()],[model.FACILITY_KEY],'display preferences touch only their own key');
 const blocked={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};assert.deepEqual(model.readPreferences(blocked,categories),expected);assert.equal(model.savePreferences(blocked,{layout:'list'},categories).layout,'list');
});
test('comparison selection adds up to three, replaces rank, removes and rejects invalid ids',()=>{
 const validIds=officers.map(officer=>officer.id),ranks=data.ranks;let selected=[];
 for(let i=0;i<3;i++){const result=model.toggleComparison(selected,{id:validIds[i],rank:'D'},validIds,ranks);assert.equal(result.reason,'added');selected=result.selection;}
 const before=JSON.stringify(selected),full=model.toggleComparison(selected,{id:validIds[3],rank:'D'},validIds,ranks);assert.equal(full.reason,'full');assert.equal(JSON.stringify(selected),before);
 const replace=model.toggleComparison(selected,{id:validIds[1],rank:'U'},validIds,ranks);assert.equal(replace.reason,'replaced');assert.equal(replace.selection[1].rank,'U');assert.equal(replace.selection.length,3);
 const remove=model.toggleComparison(replace.selection,{id:validIds[1],rank:'U'},validIds,ranks);assert.equal(remove.reason,'removed');assert.equal(remove.selection.length,2);
 const bad=model.toggleComparison([null,{id:'unknown',rank:'U'},{id:validIds[0],rank:'D'}],{id:'__proto__',rank:'U'},validIds,ranks);assert.equal(bad.reason,'invalid');assert.deepEqual(bad.selection,[{id:validIds[0],rank:'D'}]);
});
test('officer comparison uses selected ranks and ownership without granting variants or altering army health',()=>{
 const game=make(),id=officers.find(officer=>officer.id!==data.adminAssets.officerId).id,other=officers.find(officer=>![id,data.adminAssets.officerId].includes(officer.id)).id;game._grantOfficerVariant(id,'D');
 game.state.officerVariants=game.state.officerVariants.filter(key=>!key.startsWith(id+':')).concat(id+':D');
 const selection=[{id,rank:'D'},{id:other,rank:'U'},{id:data.adminAssets.officerId,rank:'U'}],before=JSON.stringify(game.state),comparison=model.compareOfficers(game,selection);
 assert.equal(comparison.rows.length,3);assert.equal(comparison.rows[0].variantOwned,true);assert.equal(comparison.rows[1].variantOwned,false);assert.equal(comparison.rows[2].variantOwned,false,'operator-only ownership is never granted by a preview');
 for(const key of comparison.stats){assert.equal(comparison.rows[1][key],game.officer(other,'U')[key]);assert.equal(comparison.maxima[key],Math.max(...comparison.rows.map(value=>value[key])));}
 assert.equal(JSON.stringify(game.state),before);assert.deepEqual(model.compareOfficers(game,[]).rows,[]);
});
test('comparison ignores malformed and duplicate identities before applying the three-slot limit',()=>{
 const game=make(),validIds=officers.map(officer=>officer.id),ranks=data.ranks,selection=[null,42,{id:'unknown',rank:'U'},{id:validIds[0],rank:'bad'},{id:validIds[0],rank:'D'},{id:validIds[0],rank:'U'},{id:validIds[1],rank:'S'},{id:validIds[2],rank:'C'},{id:validIds[3],rank:'A'}],before=JSON.stringify(selection);
 const comparison=model.compareOfficers(game,selection);assert.deepEqual(comparison.rows.map(row=>row.id),validIds.slice(0,3));assert.deepEqual(comparison.rows.map(row=>row.rank),['D','S','C']);
 const result=model.toggleComparison(selection,{id:validIds[3],rank:'D'},validIds,ranks);assert.equal(result.reason,'full');assert.deepEqual(result.selection,[{id:validIds[0],rank:'D'},{id:validIds[1],rank:'S'},{id:validIds[2],rank:'C'}]);
 assert.equal(JSON.stringify(selection),before);assert.deepEqual(model.compareOfficers(game,[null]).rows,[]);
});
test('live funding refresh updates only eligible visible cards and never rebuilds unchanged labels',()=>{
 const {setup,Node}=require('./helpers/dom-model.cjs'),{doc,host}=setup();
 const card=(id,status,amount=100)=>`<section data-facility-entry="${id}"><span data-cost-resource="gold" data-cost-amount="${amount}"></span><span data-cost-resource="wood" data-cost-amount="40"></span><span data-facility-funding data-facility-status="${status}">${status==='funded'?'資源充足':status==='shortage'?'資源不足':'固定表示'}</span><input value="入力中"></section>`;
 host.innerHTML=card('farm','shortage')+card('market','funded',200)+['locked','working','complete'].map(status=>card(status,status)).join('')+'<section hidden>'+card('hidden','funded')+'</section>'+card('invalid','shortage','broken');
 const farm=host.querySelector('[data-facility-entry="farm"] [data-facility-funding]'),market=host.querySelector('[data-facility-entry="market"] [data-facility-funding]'),input=host.querySelector('input'),beforeNodes=host.querySelectorAll('section');let writes=0,attributes=0;
 const property=Object.getOwnPropertyDescriptor(Node.prototype,'textContent');Object.defineProperty(farm,'textContent',{get:()=>property.get.call(farm),set:value=>{writes++;property.set.call(farm,value);}});doc.onAttributeChange=change=>{if(change.name==='data-facility-status')attributes++;};
 input.value='編集中';input.focus();input.setSelectionRange(1,2);const resources={gold:150,wood:40,rice:0,stone:0},before=JSON.stringify(resources);
 model.refreshFunding(doc,resources);assert.equal(farm.textContent,'資源充足');assert.equal(farm.dataset.facilityStatus,'funded');assert.equal(market.textContent,'資源不足');assert.equal(writes,1);assert.equal(attributes,2);
 writes=attributes=0;for(let i=0;i<60;i++)model.refreshFunding(doc,resources);assert.equal(writes,0);assert.equal(attributes,0);
 for(const status of ['locked','working','complete'])assert.equal(host.querySelector(`[data-facility-entry="${status}"] [data-facility-funding]`).textContent,'固定表示');
 assert.equal(host.querySelector('[data-facility-entry="hidden"] [data-facility-funding]').textContent,'資源充足');assert.equal(host.querySelector('[data-facility-entry="invalid"] [data-facility-funding]').textContent,'資源不足');
 assert.equal(doc.activeElement,input);assert.equal(input.value,'編集中');assert.equal(input.selectionStart,1);assert.deepEqual(host.querySelectorAll('section'),beforeNodes);assert.equal(JSON.stringify(resources),before);
});
console.log(`${checks} facility planner/officer comparison model checks passed. No external requests or game writes.`);
