/* Run the campaign map's real view callbacks with the game, artwork and map renderer. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),M=require('../world-map.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),assets={SENGOKU_DATA:D,document:{readyState:'loading',addEventListener(){}}};
assets.window=assets;
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),assets);
vm.runInNewContext(fs.readFileSync(require.resolve('../artwork.js'),'utf8'),assets);
vm.runInNewContext(fs.readFileSync(require.resolve('../map-data.js'),'utf8'),assets);
const roster=JSON.parse(JSON.stringify(assets.SENGOKU_OFFICERS)),art=assets.SengokuArt,geography=assets.SENGOKU_GEOGRAPHY;
const plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){
  const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);
  const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;
  assert(end>start,name);return source.slice(start,end);
}
function create(){
  const game=new E({officers:roster,clan:'織田家',seed:17});
  for(const officer of roster.slice(0,5))game._grantOfficerVariant(officer.id,'S');
  assert(game.assignArmy(game.state.officers.slice(0,3)).ok);
  assert(game.assignGovernor('keep',game.state.officers.find(id=>!game.state.army.includes(id))).ok);
  for(const key of Object.keys(game.state.resources))game.state.resources[key]=999999;
  return game;
}
function savedState(game){const value=JSON.parse(game.exportSave());delete value.savedAt;return JSON.stringify(value);}
function harness(game=create()){
  const map={},batches=[],counts={mounts:0,updates:0,destroys:0,renders:0},camera={x:54,y:92,zoom:17};
  function draw(options){
    const points=M.castlePoints(options.castles,geography.castles,options);
    batches.push({options,points,rendered:new Map(points.map(point=>[point.id,{...M.markerPresentation(point,options),tooltip:options.markerTooltip(point)}]))});
  }
  const controller={camera,update(options){counts.updates++;draw(options);},destroy(){counts.destroys++;}};
  const c={game,data:D,staffBaseId:D.staffBaseId,state:()=>c.game.state,currentView:'map',selectedCastle:game.state.home,mapRegion:'all',worldMapController:null,worldMapElement:null,
    staffConstructionReady:()=>Boolean(c.game.isStaff&&c.game.getStaffBase?.()),window:{SengokuArt:art,SengokuWorldMap:{mount(container,options){assert.equal(container,map);counts.mounts++;draw(options);return controller;}}},
    $:selector=>selector==='#world-map'?map:{},preserveInteraction:(_node,render)=>render(),render(){counts.renders++;},save(){assert.fail('Map rendering must not save game data');}};
  vm.createContext(c);vm.runInContext(['courtEstateHolding','courtEstateCastle','courtEstateDetail','homeCastleAppearance','campaignCastleOwnerAppearance','campaignCastleGrowth','campaignCastleAppearance','campaignCastleTooltip','syncWorldMap'].map(fn).join('\n'),c);
  function sync(){
    const before=JSON.stringify(c.game.state),save=savedState(c.game);c.syncWorldMap();
    assert.equal(JSON.stringify(c.game.state),before,'Rendering must preserve all runtime state, including army and governors');
    assert.equal(savedState(c.game),save,'Rendering must preserve the durable save');
    return batches.at(-1);
  }
  return{c,controller,counts,batches,sync,latest:()=>batches.at(-1),appearance:id=>batches.at(-1).rendered.get(id)};
}
function advance(game,seconds){for(let elapsed=0;elapsed<seconds;elapsed+=5)assert(game.tick(Math.min(5,seconds-elapsed)).ok);}
function tilePosition(html){return[/data-art-x="([^"]+)"/.exec(html)?.[1],/data-art-y="([^"]+)"/.exec(html)?.[1]];}
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}

test('campaign mount supplies all castles, castle levels, home badges and accessible battle context without changing saves',()=>{
  const h=harness(),s=h.c.game.state,batch=h.sync();assert.equal(batch.options.markerSize,56);assert.equal(batch.points.length,129);
  assert.equal(h.counts.mounts,1);assert.equal(s.army.length,3);assert(s.governors.keep);
  const home=h.appearance(s.home);assert(home.custom);assert(home.html.includes('class="campaign-map-castle-art"')||home.html.includes(' campaign-map-castle-art"'));
  assert(home.html.includes('data-castle-level="1"'));assert(home.html.includes('data-castle-expanded="false"'));assert(home.html.includes('campaign-map-home-mark'));
  for(const text of [h.c.game.castle(s.home).name,'城郭 Lv.1',s.clan,'本拠'])assert(home.label.includes(text));
  const target=h.c.game.adjacentTargets()[0],point=batch.points.find(p=>p.id===target.id),enemy=h.appearance(target.id);
  assert(enemy.label.includes('進軍可能'));assert(!enemy.html.includes('campaign-map-home-mark'));
  assert.equal(enemy.tooltip.title,target.name);assert(enemy.tooltip.description.includes('城郭 Lv.'+target.level));
  assert(enemy.tooltip.detail.includes(target.troops.toLocaleString('ja-JP')+'兵'));
  assert(enemy.tooltip.detail.includes(point.lat.toFixed(4)+'°N '+point.lon.toFixed(4)+'°E'));
  for(const id of ['edo','kyoto_gosho']){assert(h.appearance(id).label.includes('選択不可'));assert(!/運営|スタッフ/.test(h.appearance(id).label));assert(batch.points.find(point=>point.id===id).disabled);}
});

test('real castle construction keeps the current cell until completion and updates it through the existing controller',()=>{
  const h=harness(),game=h.c.game,id=game.state.home,army=plain(game.state.army),governors=plain(game.state.governors);
  game.state.buildings.keep=1;h.sync();const before=h.appearance(id).html,cost=game.castleUpgradeCost(id);assert(game.upgradeCastle(id).ok);
  h.sync();assert.equal(h.appearance(id).html,before,'Starting a job must not display the uncompleted level');
  advance(game,cost.seconds-5);h.sync();assert.equal(h.appearance(id).html,before);
  advance(game,5);assert.equal(game.castle(id).level,2);h.sync();
  assert(h.appearance(id).html.includes('data-castle-level="2"'));assert.notDeepEqual(tilePosition(h.appearance(id).html),tilePosition(before));
  assert.equal(h.counts.mounts,1);assert.equal(h.counts.updates,3);assert.equal(h.counts.destroys,0);
  assert.deepEqual(game.state.army,army);assert.deepEqual(game.state.governors,governors);
});

test('completed keep growth changes the home artwork and both level labels without promoting castle strength',()=>{
  const h=harness(),game=h.c.game,before=h.sync().rendered,id=game.state.home,cost=game.costs('keep'),next=game.state.buildings.keep+1;
  assert(game.upgrade('keep').ok);h.sync();assert.equal(h.appearance(id).html,before.get(id).html);
  advance(game,cost.turns*60-5);h.sync();assert.equal(h.appearance(id).html,before.get(id).html,'Unfinished construction keeps the completed appearance');
  advance(game,5);assert.equal(game.state.buildings.keep,next);assert.equal(game.castle(id).level,1);
  const after=h.sync().rendered,home=after.get(id);assert(home.html.includes(`data-keep-level="${next}"`));assert(home.html.includes('data-castle-level="1"'));
  assert(home.html.includes(`data-appearance-level="${next}"`));assert(home.html.includes(`>天守${next}</span>`));assert.notDeepEqual(tilePosition(home.html),tilePosition(before.get(id).html));
  assert(home.label.includes(`天守 Lv.${next} · 城郭 Lv.1`));assert(home.tooltip.description.includes(`天守 Lv.${next} · 城郭 Lv.1`));
  for(const [other,presentation]of before)if(other!==id)assert.equal(after.get(other).html,presentation.html,other);
  assert.equal(h.counts.mounts,1);assert.equal(h.counts.destroys,0);
});

test('a validated replacement save refreshes castle art while retaining the map camera and selection',()=>{
  const h=harness();h.sync();const id=h.c.game.state.home,camera={...h.controller.camera},selection=h.c.selectedCastle;
  const remote=E.fromSave(h.c.game.exportSave(),roster);remote.state.castles[id].level=17;
  const next=E.fromSave(remote.exportSave(),roster);assert(next);h.c.game=next;h.sync();
  assert(h.appearance(id).html.includes('data-castle-level="17"'));assert(h.appearance(id).label.includes('城郭 Lv.17'));
  assert.deepEqual(tilePosition(h.appearance(id).html),[String(art.tileInfo('castle',id,17).x),String(art.tileInfo('castle',id,17).y)]);
  assert.equal(h.c.selectedCastle,selection);assert.deepEqual(h.controller.camera,camera);assert.equal(h.counts.mounts,1);assert.equal(h.counts.updates,1);
});

test('all 32 cells and the actual 48/64/128 levels use the canonical artwork cap without modifying marker input',()=>{
  const h=harness(),cells=new Set();h.c.game.state.buildings.keep=1;
  for(let level=1;level<=32;level++){
    const marker=Object.freeze({id:'kiyosu',name:'清洲城',owner:'織田家',level}),before=JSON.stringify(marker),result=h.c.campaignCastleAppearance(marker);
    cells.add(tilePosition(result.html).join(','));assert(result.html.includes(`data-castle-level="${level}"`));assert.equal(JSON.stringify(marker),before);
  }
  assert.equal(cells.size,32);
  for(const [id,limit]of [['nijo',48],['osaka',48],['nagoya',48],['edo',64],['kyoto_gosho',128]]){
    for(const level of [33,limit]){
      const marker=Object.freeze({id,name:id,level}),result=h.c.campaignCastleAppearance(marker),last=art.tileInfo('castle',id,32);
      assert(result.html.includes(`data-castle-level="${level}"`));assert(result.html.includes(`>城郭${level}</span>`));assert(result.html.includes('data-castle-expanded="true"'));
      assert.deepEqual(tilePosition(result.html),[String(last.x),String(last.y)]);assert(result.label.includes('城郭 Lv.'+level));
    }
    assert(h.c.campaignCastleAppearance(Object.freeze({id,level:999})).html.includes(`data-castle-level="${limit}"`));
  }
  assert(h.c.campaignCastleAppearance(Object.freeze({id:'kiyosu',level:999})).html.includes('data-castle-level="32"'));
});

test('staff campaign art follows the shared Kyoto palace castle projection and preserves the private durable save',()=>{
  const personal=create(),s=personal.state,buildings={...s.buildings,keep:8},base={id:'kyoto_gosho',revision:1,accessSinceElapsedMs:0,updatedElapsedMs:0,castleLevel:128,buildings,initial:{buildings:plain(buildings),castleLevel:128},history:[],jobs:[],personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,personalBaseCastle:plain(s.castles.kyoto_gosho),personalHomeCastle:plain(s.castles[s.home])};
  const staff=E.fromSave(personal.exportSave(),roster,{isStaff:true,staffBase:base});assert(staff);assert.equal(staff.castle('kyoto_gosho').level,128);
  const saved=savedState(staff),h=harness(staff);h.sync();assert(h.appearance('kyoto_gosho').html.includes('data-castle-level="128"'));assert(h.appearance('kyoto_gosho').html.includes('campaign-map-home-mark'));
  assert(h.appearance('kyoto_gosho').label.includes('本拠'));assert.equal(savedState(staff),saved);assert.equal(JSON.parse(saved).state.buildings.keep,s.buildings.keep);
});

test('a saved level-24 keep appears across the map, detail and own-territory list while the castle stays level 1',()=>{
  const original=create();original.state.buildings.keep=24;
  const restored=E.fromSave(original.exportSave(),roster),h=harness(restored),id=restored.state.home,before=savedState(restored),camera={...h.controller.camera};
  h.sync();const expected=art.tileInfo('castle',id,24),home=h.appearance(id);
  assert(home.html.includes('data-appearance-level="24"'));assert(home.html.includes('>天守24</span>'));
  assert(home.label.includes('天守 Lv.24 · 城郭 Lv.1'));assert.deepEqual(tilePosition(home.html),[String(expected.x),String(expected.y)]);
  Object.assign(h.c,{mapQuery:'',territoryState:'own',territoryPage:1,esc:value=>String(value??''),icon:()=>'',clanCrest:()=>'',num:value=>String(value),currentJob:()=>null,
    castleLevelLimit:key=>restored.castleLevelLimit(key),durabilityMarkup:()=>'',durabilityHelp:()=>'',costHtml:()=>'',catalogMatches:()=>true,catalogChips:()=>'',pageControls:()=>''});
  vm.runInContext(['territoryRows','territoryResults','castleDetail'].map(fn).join('\n'),h.c);
  for(const markup of [h.c.castleDetail(id),h.c.territoryResults()])assert.deepEqual(tilePosition(markup),[String(expected.x),String(expected.y)]);
  assert(h.c.castleDetail(id).includes('天守レベル</span><b>Lv.24 / 32'));assert(h.c.castleDetail(id).includes('城郭レベル</span><b>Lv.1 / 32'));
  assert(h.c.territoryResults().includes('天守 Lv.24 · 城郭 Lv.1'));assert.equal(restored.castle(id).level,1);
  assert.equal(savedState(restored),before);assert.deepEqual(h.controller.camera,camera);
});

test('other owned castles, foreign castles and a lost former home never borrow the player keep level',()=>{
  const h=harness(),s=h.c.game.state;s.buildings.keep=24;s.castles.nijo.owner=s.clan;s.castles.nijo.level=7;
  h.sync();assert(h.appearance('nijo').html.includes('data-appearance-level="7"'));assert(!h.appearance('nijo').label.includes('天守'));
  const foreign=h.latest().points.find(point=>point.owner!==s.clan&&!point.disabled);
  assert(h.appearance(foreign.id).html.includes(`data-appearance-level="${foreign.level}"`));assert(!h.appearance(foreign.id).label.includes('天守'));
  s.castles[s.home].owner='在地衆';h.sync();assert(h.appearance(s.home).html.includes('data-appearance-level="1"'));assert(!h.appearance(s.home).label.includes('天守'));
});

test('a stronger completed castle never reverts to the initial artwork when its home keep is lower',()=>{
  for(const [id,level,options]of [['kiyosu',32,{}],['edo',64,{isAdmin:true}]]){
    const game=new E({officers:roster,clan:'織田家',seed:17,...options});game.state.buildings.keep=1;game.state.castles[id].level=level;
    const h=harness(game);h.sync();const home=h.appearance(id),last=art.tileInfo('castle',id,32);
    assert(home.html.includes(`data-appearance-level="${level}"`));assert(home.html.includes(`>城郭${level}</span>`));
    assert(home.label.includes('天守 Lv.1 · 城郭 Lv.'+level));assert.deepEqual(tilePosition(home.html),[String(last.x),String(last.y)]);
  }
});

test('shared Kyoto keep growth updates its view without replacing the saved personal facilities',()=>{
  const personal=create(),s=personal.state,buildings={...s.buildings,keep:24},base={id:'kyoto_gosho',revision:1,accessSinceElapsedMs:0,updatedElapsedMs:0,castleLevel:1,buildings,initial:{buildings:plain(buildings),castleLevel:1},history:[],jobs:[],personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,personalBaseCastle:plain(s.castles.kyoto_gosho),personalHomeCastle:plain(s.castles[s.home])};
  const staff=E.fromSave(personal.exportSave(),roster,{isStaff:true,staffBase:base}),before=savedState(staff),h=harness(staff);h.sync();
  assert(h.appearance('kyoto_gosho').html.includes('data-appearance-level="24"'));assert(h.appearance('kyoto_gosho').label.includes('天守 Lv.24 · 城郭 Lv.1'));
  assert.equal(staff.castle('kyoto_gosho').level,1);assert.equal(savedState(staff),before);assert.equal(JSON.parse(before).state.buildings.keep,s.buildings.keep);
});

test('shared growth presentation normalizes malformed inputs and never promotes one stored level into the other',()=>{
  for(const keepLevel of [undefined,null,0,-1,NaN,Infinity,'bad',true,2.5]){
    const input=Object.freeze({castleLevel:64,keepLevel,home:true}),result=art.castleGrowthInfo('edo',input);
    assert.equal(result.level,64);assert.equal(result.castleLevel,64);assert.equal(result.keepLevel,null);assert.equal(result.summary,'天守 未取得 · 城郭 Lv.64');
  }
  assert.equal(art.castleGrowthInfo('kiyosu',{castleLevel:-8,keepLevel:24,home:true}).level,24);
  assert.equal(art.castleGrowthInfo('kiyosu',{castleLevel:2,keepLevel:24}).level,2,'A foreign/outpost castle cannot inherit a home keep');
  assert.equal(art.castleGrowthInfo('edo',{castleLevel:999,keepLevel:'24',home:true}).level,64);
  assert.equal(art.castleGrowthInfo('kyoto_gosho',{castleLevel:Infinity,keepLevel:32,home:true}).level,32);
});

test('clusters and unavailable artwork retain normal map symbols, castle coverage and tooltips',()=>{
  const h=harness(),batch=h.sync(),bounds=M.projectBounds(geography.bounds),view=M.fitBounds(bounds,800,500,28);
  const layout=M.layoutMarkers(batch.points,view,800,500,{markerSize:batch.options.markerSize,distance:60}),cluster=layout.find(marker=>marker.cluster);assert(cluster);
  assert.equal(layout.flatMap(marker=>marker.points).length,129);
  const clustered=M.markerPresentation(cluster,batch.options);assert.equal(clustered.custom,false);assert.equal(clustered.html,`<b>${cluster.points.length}</b>`);
  assert.equal(h.c.campaignCastleAppearance(cluster),null);assert.equal(h.c.campaignCastleAppearance({id:'missing',level:5}),null);
  const home=batch.points.find(point=>point.home);h.c.window.SengokuArt=undefined;
  const fallback=M.markerPresentation(home,batch.options);assert.equal(fallback.custom,false);assert(fallback.html.includes('<svg'));assert(fallback.label.includes('本拠'));
  assert(batch.options.markerTooltip(home).description.includes('城郭 Lv.'+home.level));
  h.c.window.SengokuArt={...art,castle:()=>''};assert.equal(M.markerPresentation(home,batch.options).custom,false);
  h.c.window.SengokuArt={...art,castle(){throw Error('unavailable illustration');}};assert.equal(M.markerPresentation(home,batch.options).custom,false);
});

test('artwork leaves restricted selection, ordinary selection and controller cleanup unchanged',()=>{
  const h=harness(),batch=h.sync(),selected=h.c.selectedCastle;batch.options.onSelect('edo');batch.options.onSelect('kyoto_gosho');
  assert.equal(h.c.selectedCastle,selected);assert.equal(h.counts.renders,0);
  const target=h.c.game.adjacentTargets()[0];batch.options.onSelect(target.id);assert.equal(h.c.selectedCastle,target.id);assert.equal(h.counts.renders,1);
  h.c.currentView='town';h.c.syncWorldMap();assert.equal(h.counts.destroys,1);assert.equal(h.c.worldMapController,null);assert.equal(h.c.worldMapElement,null);
});

console.log(`${checks} campaign castle artwork integration checks passed. No external requests.`);
