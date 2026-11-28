/* Real app bridge functions with a real game. Navigation must never spend or save. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const line=source.indexOf('\n',start),end=source.slice(start,line).endsWith('}')?line:source.indexOf('\n  }',start)+4;return source.slice(start,end);}
function setup(){
  const game=new E({seed:47}),calls=[],captured=[],flags={writable:true,staffReady:true,clockApplied:true},model={status:'ready',title:'次の一手',summary:'状況に合わせて案内',items:[]};
  const c={game,data:D,state:()=>game.state,startPending:false,syncAccess:{linked:false,ready:true,writable:true,rolePending:false,reason:'local'},saveEnabled:true,roleEpoch:0,worldCatchingUp:false,worldSettlementPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,selectedCastle:'',officerSection:'archive',
    canMutate:()=>flags.writable,staffConstructionReady:()=>flags.staffReady,clockIsApplied:()=>flags.clockApplied,syncMessage:()=>c.syncAccess.message||'同期を確認中',
    window:{SengokuHints:{build(_game,context){assert.equal(_game,game);captured.push(context);return model;}},SengokuHintsUI:{close:()=>calls.push(['close-hints']),open:()=>calls.push(['open-hints'])},SengokuSocial:{getUser:()=>({id:'test-lord'}),open:tab=>calls.push(['social',tab])}},
    closeModal:()=>calls.push(['close-modal']),go:view=>calls.push(['view',view]),buildingModal:id=>calls.push(['building',id]),castleUpgradeModal:id=>calls.push(['castle',id]),levelGuideModal:id=>calls.push(['guide',id]),newGameModal:()=>calls.push(['new']),settingsModal:()=>calls.push(['settings']),pickOfficer:(mode,slot)=>calls.push(['army-slot',mode,slot]),helpModal:()=>calls.push(['help'])
  };
  vm.createContext(c);vm.runInContext(['getHints','followHint','openHintHelp'].map(fn).join('\n'),c);
  return{c,game,calls,captured,flags,model,set(action,id='current'){model.items=[{id,title:'候補',action}];calls.length=0;}};
}
let count=0;function test(name,run){run();count++;console.log('PASS '+name);}

test('the app supplies current access, clock, staff and persistence gates without changing the campaign',()=>{
  const h=setup(),before=JSON.stringify(h.game.state);h.c.getHints();let context=h.captured.at(-1);
  assert.equal(context.started,true);assert.equal(context.writable,true);assert.equal(context.clockReady,true);assert.equal(context.staffReady,true);assert.equal(context.saveEnabled,true);
  h.c.syncAccess={linked:true,ready:false,banned:true,rolePending:true,reason:'banned',message:'利用停止'};h.flags.writable=false;h.c.saveEnabled=false;h.c.worldCatchingUp=true;h.c.window.SengokuWorldClock={snapshot:()=>({ready:true})};h.c.startPending=true;h.c.getHints();context=h.captured.at(-1);
  assert.equal(context.banned,true);assert.equal(context.rolePending,true);assert.equal(context.syncLinked,true);assert.equal(context.syncReady,false);assert.equal(context.writable,false);assert.equal(context.clockReady,false);assert.equal(context.started,false);assert.equal(context.saveEnabled,false);assert.equal(context.syncMessage,'利用停止');
  assert.equal(JSON.stringify(h.game.state),before);assert.deepEqual(h.calls,[]);
});
test('identity and role changes create a new hint scope and unknown staff state stays blocked',()=>{
  const h=setup(),first=h.c.getHints().scope;h.c.roleEpoch++;assert.notEqual(h.c.getHints().scope,first);
  const second=h.c.getHints().scope;h.c.window.SengokuSocial.getUser=()=>({id:'replacement-lord'});assert.notEqual(h.c.getHints().scope,second);
  h.game.setRoleAccess({isStaff:true});h.flags.staffReady=false;h.c.getHints();assert.equal(h.captured.at(-1).staffReady,false);
});
test('a stale recommendation is re-evaluated before closing the dialog or navigating',()=>{
  const h=setup();h.set({kind:'building',id:'farm'},'build-farm');h.c.getHints();h.model.items=[{id:'account-banned',action:{kind:'sync'}}];
  const before=JSON.stringify(h.game.state),result=h.c.followHint('build-farm');assert.equal(result.ok,false);assert.match(result.message,/状況が変わりました/);assert.deepEqual(h.calls,[]);assert.equal(JSON.stringify(h.game.state),before);
});
test('advice retained by the UI cannot bypass a clock or account change at navigation time',()=>{
  const h=setup();h.c.window.SengokuHints=require('../hints.js');
  const ready=h.c.getHints(),candidate=ready.items.find(item=>item.action?.kind==='building'||item.action?.kind==='castle'||item.action?.kind==='view');assert(candidate);
  const before=JSON.stringify(h.game.state);h.c.window.SengokuWorldClock={snapshot:()=>({ready:true})};h.flags.clockApplied=false;h.flags.writable=false;
  assert.equal(h.c.getHints().items[0].id,'clock-pending');assert(!JSON.stringify(h.c.getHints()).includes('共通時刻を確認しています'));
  assert.equal(h.c.followHint(candidate.id).ok,false);assert.deepEqual(h.calls,[]);
  h.flags.clockApplied=true;h.c.syncAccess.banned=true;assert.equal(h.c.followHint(candidate.id).ok,false);assert.deepEqual(h.calls,[]);assert.equal(JSON.stringify(h.game.state),before);
});
test('retained advice is revalidated during applying, conflict and ordinary operation waits',()=>{
  const h=setup();h.c.window.SengokuHints=require('../hints.js');const candidate=h.c.getHints().items.find(item=>item.action?.kind==='building'||item.action?.kind==='castle'||item.action?.kind==='view');assert(candidate);
  const before=JSON.stringify(h.game.state);h.flags.writable=false;
  for(const reason of ['applying','conflict','writer','local']){
    h.c.syncAccess.reason=reason;h.c.walkingActionPending=reason==='writer';h.c.worldSettlementPending=reason==='local';
    const model=h.c.getHints();assert.equal(model.status,'blocked');assert.equal(model.transient,true);
    assert.equal(h.c.followHint(candidate.id).ok,false);assert.deepEqual(h.calls,[]);
  }
  assert.equal(JSON.stringify(h.game.state),before);
});
test('valid hints open existing views or details after closing the hint dialog, without saving or spending',()=>{
  const h=setup(),before=JSON.stringify(h.game.state),home=h.game.state.home;
  const cases=[
    [{kind:'view',view:'army'},['view','army']],
    [{kind:'view',view:'research'},['view','research']],
    [{kind:'building',id:'farm'},['building','farm']],
    [{kind:'castle',id:home},['castle',home]],
    [{kind:'level-guide'},['guide',home]],
    [{kind:'sync'},['social','sync']],
    [{kind:'settings'},['settings']],
    [{kind:'gacha'},['view','officers']],
    [{kind:'army-slot',id:'1'},['army-slot','army',1]]
  ];
  for(const [action,last] of cases){h.set(action);assert.equal(h.c.followHint('current').ok,true);assert.deepEqual(h.calls,[['close-hints'],['close-modal'],last]);}
  assert.equal(h.c.officerSection,'gacha');assert.equal(JSON.stringify(h.game.state),before);
});
test('an enemy castle hint selects its map detail and never starts an attack',()=>{
  const h=setup(),target=h.game.adjacentTargets()[0];assert(target);h.set({kind:'castle',id:target.id});const before=JSON.stringify(h.game.state);
  assert.equal(h.c.followHint('current').ok,true);assert.equal(h.c.selectedCastle,target.id);assert.deepEqual(h.calls.at(-1),['view','map']);assert.equal(JSON.stringify(h.game.state),before);
});
test('new-campaign hints only open selection for an unstarted or ended campaign',()=>{
  const h=setup();h.set({kind:'new'});assert.equal(h.c.followHint('current').ok,false);assert.deepEqual(h.calls,[]);
  h.c.startPending=true;const before=JSON.stringify(h.game.state);assert.equal(h.c.followHint('current').ok,true);assert.deepEqual(h.calls.at(-1),['new']);assert.equal(JSON.stringify(h.game.state),before);
  h.c.startPending=false;h.game.state.gameOver=true;h.calls.length=0;assert.equal(h.c.followHint('current').ok,true);assert.deepEqual(h.calls.at(-1),['new']);
});
test('the bridge rejects unknown views, missing targets, protected castles and all direct mutation actions',()=>{
  const h=setup(),before=JSON.stringify(h.game.state);
  for(const action of [{kind:'view',view:'javascript:alert(1)'},{kind:'building',id:'missing'},{kind:'castle',id:'missing'},{kind:'castle',id:'edo'},{kind:'army-slot',id:3},{kind:'army-slot',id:'bad'},{kind:'upgrade',id:'farm'},{kind:'attack',id:'osaka'},{kind:'claim-quest',id:'first'}]){
    h.set(action);assert.equal(h.c.followHint('current').ok,false,JSON.stringify(action));assert.deepEqual(h.calls,[]);
  }
  assert.equal(JSON.stringify(h.game.state),before);
});
test('general help and the persistent hint entry open read-only guidance',()=>{
  const h=setup(),before=JSON.stringify(h.game.state);h.c.openHintHelp();assert.deepEqual(h.calls,[['close-hints'],['close-modal'],['help']]);h.calls.length=0;
  let handler;h.c.document={addEventListener:(type,fn)=>{if(type==='click')handler=fn;}};h.c.mutationActions=new Set();
  const start=source.indexOf("  document.addEventListener('click',async event=>"),end=source.indexOf("  document.addEventListener('input'",start);vm.runInContext(source.slice(start,end),h.c);
  const node={disabled:false,dataset:{action:'hints'},closest(selector){return /\[data-action\]/.test(selector)?this:null;}};handler({target:node});assert.deepEqual(h.calls,[['close-modal'],['open-hints']]);assert.equal(JSON.stringify(h.game.state),before);
  const index=fs.readFileSync(require.resolve('../index.html'),'utf8');assert.match(index,/class="nav-item" data-action="hints"/);assert(source.includes('data-hint-entry'));
});
test('a missing optional hint module leaves general help available without breaking the game',()=>{
  const h=setup();delete h.c.window.SengokuHints;assert.equal(h.c.getHints().status,'blocked');assert.equal(h.c.getHints().items.length,0);assert.equal(h.c.followHint('old').ok,false);h.c.openHintHelp();assert.deepEqual(h.calls.at(-1),['help']);
});
console.log(`${count} read-only hint bridge checks passed. No network requests.`);
