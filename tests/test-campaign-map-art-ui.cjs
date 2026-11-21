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
  const c={game,data:D,state:()=>c.game.state,currentView:'map',selectedCastle:game.state.home,mapRegion:'all',worldMapController:null,worldMapElement:null,
    window:{SengokuArt:art,SengokuWorldMap:{mount(container,options){assert.equal(container,map);counts.mounts++;draw(options);return controller;}}},
    $:selector=>selector==='#world-map'?map:{},preserveInteraction:(_node,render)=>render(),render(){counts.renders++;},save(){assert.fail('Map rendering must not save game data');}};
  vm.createContext(c);vm.runInContext(['campaignCastleAppearance','campaignCastleTooltip','syncWorldMap'].map(fn).join('\n'),c);
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
  const h=harness(),s=h.c.game.state,batch=h.sync();assert.equal(batch.options.markerSize,56);assert.equal(batch.points.length,128);
  assert.equal(h.counts.mounts,1);assert.equal(s.army.length,3);assert(s.governors.keep);
  const home=h.appearance(s.home);assert(home.custom);assert(home.html.includes('class="campaign-map-castle-art"')||home.html.includes(' campaign-map-castle-art"'));
  assert(home.html.includes('data-castle-level="1"'));assert(home.html.includes('data-castle-expanded="false"'));assert(home.html.includes('campaign-map-home-mark'));
  for(const text of [h.c.game.castle(s.home).name,'城郭 Lv.1',s.clan,'本拠'])assert(home.label.includes(text));
  const target=h.c.game.adjacentTargets()[0],point=batch.points.find(p=>p.id===target.id),enemy=h.appearance(target.id);
  assert(enemy.label.includes('進軍可能'));assert(!enemy.html.includes('campaign-map-home-mark'));
  assert.equal(enemy.tooltip.title,target.name);assert(enemy.tooltip.description.includes('城郭 Lv.'+target.level));
  assert(enemy.tooltip.detail.includes(target.troops.toLocaleString('ja-JP')+'兵'));
  assert(enemy.tooltip.detail.includes(point.lat.toFixed(4)+'°N '+point.lon.toFixed(4)+'°E'));
  for(const id of ['edo','sunpu']){assert(h.appearance(id).label.includes('選択不可'));assert(!/運営|スタッフ/.test(h.appearance(id).label));assert(batch.points.find(point=>point.id===id).disabled);}
});

test('real castle construction keeps the current cell until completion and updates it through the existing controller',()=>{
  const h=harness(),game=h.c.game,id=game.state.home,army=plain(game.state.army),governors=plain(game.state.governors);
  h.sync();const before=h.appearance(id).html,cost=game.castleUpgradeCost(id);assert(game.upgradeCastle(id).ok);
  h.sync();assert.equal(h.appearance(id).html,before,'Starting a job must not display the uncompleted level');
  advance(game,cost.seconds-5);h.sync();assert.equal(h.appearance(id).html,before);
  advance(game,5);assert.equal(game.castle(id).level,2);h.sync();
  assert(h.appearance(id).html.includes('data-castle-level="2"'));assert.notDeepEqual(tilePosition(h.appearance(id).html),tilePosition(before));
  assert.equal(h.counts.mounts,1);assert.equal(h.counts.updates,3);assert.equal(h.counts.destroys,0);
  assert.deepEqual(game.state.army,army);assert.deepEqual(game.state.governors,governors);
});

test('completing a keep upgrade alone does not change any campaign castle artwork',()=>{
  const h=harness(),game=h.c.game,before=h.sync().rendered,level=game.state.buildings.keep,cost=game.costs('keep');
  assert(game.upgrade('keep').ok);advance(game,cost.turns*60);assert.equal(game.state.buildings.keep,level+1);
  const after=h.sync().rendered;for(const [id,presentation]of before)assert.equal(after.get(id).html,presentation.html,id);
});

test('a validated replacement save refreshes castle art while retaining the map camera and selection',()=>{
  const h=harness();h.sync();const id=h.c.game.state.home,camera={...h.controller.camera},selection=h.c.selectedCastle;
  const remote=E.fromSave(h.c.game.exportSave(),roster);remote.state.castles[id].level=17;
  const next=E.fromSave(remote.exportSave(),roster);assert(next);h.c.game=next;h.sync();
  assert(h.appearance(id).html.includes('data-castle-level="17"'));assert(h.appearance(id).label.includes('城郭 Lv.17'));
  assert.deepEqual(tilePosition(h.appearance(id).html),[String(art.tileInfo('castle',id,17).x),String(art.tileInfo('castle',id,17).y)]);
  assert.equal(h.c.selectedCastle,selection);assert.deepEqual(h.controller.camera,camera);assert.equal(h.counts.mounts,1);assert.equal(h.counts.updates,1);
});

test('all 32 cells and the actual 48/64 levels use the canonical artwork cap without modifying marker input',()=>{
  const h=harness(),cells=new Set();
  for(let level=1;level<=32;level++){
    const marker=Object.freeze({id:'kiyosu',name:'清洲城',owner:'織田家',level}),before=JSON.stringify(marker),result=h.c.campaignCastleAppearance(marker);
    cells.add(tilePosition(result.html).join(','));assert(result.html.includes(`data-castle-level="${level}"`));assert.equal(JSON.stringify(marker),before);
  }
  assert.equal(cells.size,32);
  for(const [id,limit]of [['nijo',48],['osaka',48],['nagoya',48],['edo',64],['sunpu',64]]){
    for(const level of [33,limit]){
      const marker=Object.freeze({id,name:id,level}),result=h.c.campaignCastleAppearance(marker),last=art.tileInfo('castle',id,32);
      assert(result.html.includes(`data-castle-level="${level}"`));assert(result.html.includes(`>Lv.${level}</span>`));assert(result.html.includes('data-castle-expanded="true"'));
      assert.deepEqual(tilePosition(result.html),[String(last.x),String(last.y)]);assert(result.label.includes('城郭 Lv.'+level));
    }
    assert(h.c.campaignCastleAppearance(Object.freeze({id,level:999})).html.includes(`data-castle-level="${limit}"`));
  }
  assert(h.c.campaignCastleAppearance(Object.freeze({id:'kiyosu',level:999})).html.includes('data-castle-level="32"'));
});

test('staff campaign art follows the shared Sunpu castle projection and preserves the private durable save',()=>{
  const personal=create(),s=personal.state,buildings={...s.buildings,keep:8},base={id:'sunpu',revision:1,accessSinceElapsedMs:0,updatedElapsedMs:0,castleLevel:64,buildings,initial:{buildings:plain(buildings),castleLevel:64},history:[],jobs:[],personalClan:s.clan,personalHome:s.home,personalCycleHome:s.cycle.home,personalSunpu:plain(s.castles.sunpu),personalHomeCastle:plain(s.castles[s.home])};
  const staff=E.fromSave(personal.exportSave(),roster,{isStaff:true,staffBase:base});assert(staff);assert.equal(staff.castle('sunpu').level,64);
  const saved=savedState(staff),h=harness(staff);h.sync();assert(h.appearance('sunpu').html.includes('data-castle-level="64"'));assert(h.appearance('sunpu').html.includes('campaign-map-home-mark'));
  assert(h.appearance('sunpu').label.includes('本拠'));assert.equal(savedState(staff),saved);assert.equal(JSON.parse(saved).state.buildings.keep,s.buildings.keep);
});

test('clusters and unavailable artwork retain normal map symbols, castle coverage and tooltips',()=>{
  const h=harness(),batch=h.sync(),bounds=M.projectBounds(geography.bounds),view=M.fitBounds(bounds,800,500,28);
  const layout=M.layoutMarkers(batch.points,view,800,500,{markerSize:batch.options.markerSize,distance:60}),cluster=layout.find(marker=>marker.cluster);assert(cluster);
  assert.equal(layout.flatMap(marker=>marker.points).length,128);
  const clustered=M.markerPresentation(cluster,batch.options);assert.equal(clustered.custom,false);assert.equal(clustered.html,`<b>${cluster.points.length}</b>`);
  assert.equal(h.c.campaignCastleAppearance(cluster),null);assert.equal(h.c.campaignCastleAppearance({id:'missing',level:5}),null);
  const home=batch.points.find(point=>point.home);h.c.window.SengokuArt=undefined;
  const fallback=M.markerPresentation(home,batch.options);assert.equal(fallback.custom,false);assert(fallback.html.includes('<svg'));assert(fallback.label.includes('本拠'));
  assert(batch.options.markerTooltip(home).description.includes('城郭 Lv.'+home.level));
  h.c.window.SengokuArt={...art,castle:()=>''};assert.equal(M.markerPresentation(home,batch.options).custom,false);
  h.c.window.SengokuArt={...art,castle(){throw Error('unavailable illustration');}};assert.equal(M.markerPresentation(home,batch.options).custom,false);
});

test('artwork leaves restricted selection, ordinary selection and controller cleanup unchanged',()=>{
  const h=harness(),batch=h.sync(),selected=h.c.selectedCastle;batch.options.onSelect('edo');batch.options.onSelect('sunpu');
  assert.equal(h.c.selectedCastle,selected);assert.equal(h.counts.renders,0);
  const target=h.c.game.adjacentTargets()[0];batch.options.onSelect(target.id);assert.equal(h.c.selectedCastle,target.id);assert.equal(h.counts.renders,1);
  h.c.currentView='town';h.c.syncWorldMap();assert.equal(h.counts.destroys,1);assert.equal(h.c.worldMapController,null);assert.equal(h.c.worldMapElement,null);
});

console.log(`${checks} campaign castle artwork integration checks passed. No external requests.`);
