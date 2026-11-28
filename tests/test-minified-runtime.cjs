'use strict';

// Compare the shipped classic scripts against their original sources in
// independent browser-like realms. Rendering/geometry remains browser QA.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..'),groups=require('../tools/game-entry.json');
const plain=value=>JSON.parse(JSON.stringify(value));
const epoch=Date.UTC(2026,10,26,2,0,0);
class FixedDate extends Date {
  constructor(...args){super(...(args.length?args:[epoch]));}
  static now(){return epoch;}
}
function load(minified){
  let sequence=0,timer=0;
  const registrations=[],storage=new Map();
  const document={readyState:'loading',addEventListener:type=>registrations.push('document:'+type),removeEventListener(){},querySelector:()=>null,querySelectorAll:()=>[],getElementById:()=>null};
  const scope={document,Date:FixedDate,
    crypto:{randomUUID:()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`},
    location:{protocol:'https:',hostname:'game.test',href:'https://game.test/',origin:'https://game.test'},navigator:{},performance:{now:()=>0},
    localStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key)},
    addEventListener:type=>registrations.push('window:'+type),removeEventListener(){},
    setTimeout:()=>++timer,clearTimeout(){},setInterval:()=>++timer,clearInterval(){},
    fetch(){throw Error('This parity test must never make a network request');}
  };
  scope.window=scope;
  vm.createContext(scope);
  // Load other classic bundles around the engine too, so shared minifier
  // helpers and public APIs are exercised after subsequent scripts execute.
  // The interface bundle starts the actual app and is covered in browser QA.
  for(const name of ['game-preferences.bundle.js','game-core.bundle.js','game-campaign.bundle.js','game-community.bundle.js']){
    const code=minified?fs.readFileSync(path.join(root,name),'utf8'):groups[name].map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n;\n');
    vm.runInContext(code,scope,{filename:name,timeout:10000});
  }
  return{scope,registrations};
}
const source=load(false),shipped=load(true),publicNames=scope=>Object.keys(scope).filter(name=>/^(?:SENGOKU_|Sengoku)/.test(name)).sort();
const signature=value=>{
  if(typeof value==='function')return{type:'function',name:value.name,prototype:Object.getOwnPropertyNames(value.prototype||{}).sort()};
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,typeof value[key]==='function'?'function:'+value[key].name:typeof value[key]]));
  return typeof value;
};
assert.deepEqual(publicNames(shipped.scope),publicNames(source.scope));
for(const name of publicNames(source.scope))assert.deepEqual(signature(shipped.scope[name]),signature(source.scope[name]),name+' public API');
assert.deepEqual(shipped.registrations,source.registrations,'Deferred browser initialization order');
for(const name of ['SENGOKU_OFFICERS','SENGOKU_RANKS','SENGOKU_ROSTER_META','SENGOKU_DATA','SENGOKU_MUSIC_TRACKS'])assert.deepEqual(plain(shipped.scope[name]),plain(source.scope[name]),name+' data');
const originalCrests = source.scope.SengokuKamon.entries();
const shippedCrests = shipped.scope.SengokuKamon.entries();
assert.deepEqual(plain(shippedCrests), plain(originalCrests), 'All crest catalog data, including source IDs, remains identical');
for (const crest of shippedCrests) {
  assert(Object.isFrozen(crest) && Object.isFrozen(crest.sourceIds), 'A shipped crest and its source list remain immutable');
}
const crestSources = shipped.scope.SengokuKamon.getSources();
assert.deepEqual(plain(crestSources), plain(source.scope.SengokuKamon.getSources()), 'Crest references retain all original titles, URLs and source order');
assert(crestSources.every(Object.isFrozen), 'Crest reference objects remain immutable');
const costs = shipped.scope.SENGOKU_DATA.buildings.map(building => building.base);
assert.equal(new Set(costs).size, costs.length, 'Every facility retains its own cost object');
assert.equal(source.scope.SENGOKU_OFFICERS.length,280);
assert.equal(source.scope.SENGOKU_OFFICERS.filter(officer=>officer.courtNoble===true).length,24);
assert.equal(source.scope.SENGOKU_OFFICERS.filter(officer=>officer.courtNoble!==true).length,256);
assert.equal(source.scope.SENGOKU_DATA.castles.length,129);
console.log('PASS '+publicNames(source.scope).length+' classic globals, function names, initialization order and real game data match after four bundles');

let checkpoints=0;
function compare(a,b,label){
  assert.deepEqual(plain(b.state),plain(a.state),label+' state');
  assert.deepEqual(plain(b.income()),plain(a.income()),label+' income');
  assert.deepEqual(plain(b.evaluation()),plain(a.evaluation()),label+' evaluation');
  checkpoints++;
}
for(const options of [{seed:17},{seed:51,isAdmin:true}]){
  const A=source.scope,B=shipped.scope,roles={isAdmin:options.isAdmin===true};
  let a=new A.SengokuEngine({...options,officers:A.SENGOKU_OFFICERS}),b=new B.SengokuEngine({...options,officers:B.SENGOKU_OFFICERS});
  compare(a,b,'initial campaign');
  function action(name,args=[],requireSuccess=true){
    const left=a[name](...args),right=b[name](...args);assert.deepEqual(plain(right),plain(left),name+' result');
    if(requireSuccess)assert.equal(left.ok,true,name+' must execute in this scenario');
    compare(a,b,name);return left;
  }
  action('applyGift',[{gold:50000,rice:50000,wood:10000,stone:10000,magatama:5000},'minified-parity-gift']);
  assert(action('applyGift',[{gold:50000,rice:50000,wood:10000,stone:10000,magatama:5000},'minified-parity-gift']).already,'Repeated receipts remain idempotent');
  action('drawOfficers',[10]);
  action('assignGovernor',['market',a.state.officers.find(id=>!a.state.army.includes(id))]);
  action('upgrade',['farm']);
  action('research',['commerce']);
  action('recruitTroops',[100]);
  for(const delta of [1,.5,5,5,5])action('tick',[delta]);
  const fromSource=a.exportSave(),fromShipped=b.exportSave();assert.equal(fromShipped,fromSource,'Export is byte-identical with a controlled clock');
  // Load each implementation's save with the other implementation, then
  // continue construction, monthly economy and random battle outcomes.
  a=A.SengokuEngine.fromSave(fromShipped,A.SENGOKU_OFFICERS,roles);
  b=B.SengokuEngine.fromSave(fromSource,B.SENGOKU_OFFICERS,roles);
  compare(a,b,'cross-loaded save');
  for(let step=0;step<12;step++)action('tick',[5]);
  assert.equal(a.state.jobs.length,0,'Both pending construction and research completed');
  const target=a.adjacentTargets()[0].id;
  assert.deepEqual(plain(b.previewBattle(target,'balanced')),plain(a.previewBattle(target,'balanced')));
  action('attack',[target,'balanced']);
  for(let month=0;month<3&&!a.state.gameOver;month++)action('nextTurn',[],false);
  const before=plain(a.state),invalid=plain(JSON.parse(a.exportSave()));invalid.state.resources.gold=-1;
  for(const realm of [A,B])assert.throws(()=>realm.SengokuEngine.fromSave(invalid,realm.SENGOKU_OFFICERS,roles),'Corrupt resources remain rejected');
  assert.deepEqual(plain(a.state),before,'Rejected imports must not mutate the running campaign');
  compare(a,b,'after rejected import');
  const saved=a.exportSave();assert.equal(b.exportSave(),saved);
  assert.deepEqual(plain(A.SengokuEngine.fromSave(saved,A.SENGOKU_OFFICERS,roles).state),plain(B.SengokuEngine.fromSave(saved,B.SENGOKU_OFFICERS,roles).state));
  const context={started:true,writable:true,clockReady:true,saveEnabled:true};
  assert.deepEqual(plain(B.SengokuHints.build(b,context)),plain(A.SengokuHints.build(a,context)),'Cross-module hints');
  assert.equal(B.SengokuEvaluationUI.badge(b.evaluation()),A.SengokuEvaluationUI.badge(a.evaluation()),'Cross-module rank markup');
  assert.deepEqual(plain(B.SengokuArt.tileInfo('castle',b.state.home,32)),plain(A.SengokuArt.tileInfo('castle',a.state.home,32)),'Artwork reads the same initialized castle data');
  assert.deepEqual(plain(B.SengokuTravel.plan({sourceCastleId:b.state.home,targetCastleId:target})),plain(A.SengokuTravel.plan({sourceCastleId:a.state.home,targetCastleId:target})),'Shared travel API');
}
console.log('PASS '+checkpoints+' source/minified campaign checkpoints, economy, recruitment, gacha, construction, battle and bidirectional save continuation');
console.log('PASS corrupt-save rejection and cross-bundle hints, ranks, artwork and travel remain equivalent; no network or real browser used');
