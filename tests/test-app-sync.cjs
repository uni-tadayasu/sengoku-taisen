const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {SengokuEngine} = require('../engine.js');
const source = fs.readFileSync(path.join(__dirname, '../app.js'), 'utf8');
const rosterContext = {window:{}};
vm.createContext(rosterContext);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../officers-data.js'), 'utf8'), rosterContext);
const roster = rosterContext.window.SENGOKU_OFFICERS;
function fn(name) {
  const start = source.indexOf(`  function ${name}(`);
  assert(start >= 0, name);
  const firstEnd = source.indexOf('\n', start);
  if(source.slice(start, firstEnd).endsWith('}')) return source.slice(start, firstEnd);
  const end = source.indexOf('\n  }', start);
  assert(end > start, name);
  return source.slice(start, end + 4);
}
function setup({admin=false}={}) {
  const game = new SengokuEngine({officers:roster,isAdmin:admin,seed:17});
  const stored = new Map([['save',game.exportSave()]]);
  const events = [];
  const context = {
    game, roster, SengokuEngine,
    state:()=>context.game.state,
    syncAccess:{linked:true,ready:true,writable:true,leaseExpiresAt:new Date(Date.now()+30000).toISOString()},
    saveKey:'save', backupKey:'backups', saveEnabled:true, saveWarning:'',worldCatchingUp:false,fieldActionPending:false,
    selectedCastle:'', lastRealtime:0, saveCounter:0, importedGame:null, activeModal:'',
    localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
    window:{dispatchEvent:e=>events.push(e.type)}, CustomEvent:class{constructor(type){this.type=type;}},
    Date, performance:{now:()=>1000}, $:()=>null,
    toast:()=>{}, render:()=>{}, renderHeader:()=>{}, refreshLiveControls:()=>{}, refreshActiveModal:()=>{},
    queueWorldProgress:()=>{},preserveInteraction:()=>{}, closeModal:()=>{}, updateBattlePreview:()=>{}
  };
  vm.createContext(context);
  vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','save','backupCurrentSave','applyCloudSave','prepareRecoverySave','applyRecoverySave','applyDurableGift','restoreAdminAssets'].map(fn).join('\n'),context);
  return {c:context,stored,events};
}
let count=0;
function test(name, run){run();count++;console.log('PASS '+name);}

test('pending, follower and expired-lease clients cannot save or receive gifts',()=>{
  for(const access of [{ready:false,writable:false},{ready:true,writable:false},{ready:true,writable:true,leaseExpiresAt:new Date(Date.now()-1000).toISOString()}]) {
    const {c,stored,events}=setup();c.syncAccess={...c.syncAccess,...access};
    const before=JSON.stringify(c.game.state), saved=stored.get('save');
    assert.equal(c.save(),false);
    const result=c.applyDurableGift({gold:100},'blocked-gift');
    assert.equal(result.ok,false);assert.equal(result.retryable,true);
    assert.equal(JSON.stringify(c.game.state),before);assert.equal(stored.get('save'),saved);assert.equal(events.length,0);
  }
});
test('successful local persistence triggers sync, whereas cloud apply never echoes',()=>{
  const {c,events}=setup();assert.equal(c.save(),true);assert.deepEqual(events,['sengoku:game-saved']);
  const remote=JSON.parse(c.game.exportSave());remote.state.resources.gold+=500;
  assert.equal(c.applyCloudSave(remote,{isAdmin:false,reason:'remote',backup:false}).ok,true);
  assert.deepEqual(events,['sengoku:game-saved']);assert.equal(c.game.state.resources.gold,remote.state.resources.gold);
});
test('initial replacement retains the exact pre-sync save as a downloadable backup',()=>{
  const {c,stored}=setup();const original=stored.get('save');
  const remote=JSON.parse(c.game.exportSave());remote.state.resources.gold+=123;
  assert.equal(c.applyCloudSave(remote,{isAdmin:false,reason:'initial',backup:true}).ok,true);
  const backups=JSON.parse(stored.get('backups'));
  assert.equal(backups[0].save,original);assert.equal(backups[0].reason,'initial');
  assert.equal(JSON.parse(stored.get('save')).state.resources.gold,remote.state.resources.gold);
});
test('cloud persistence failure keeps the existing game and save untouched',()=>{
  const {c,stored}=setup();const before=JSON.stringify(c.game.state),original=stored.get('save');
  const remote=JSON.parse(c.game.exportSave());remote.state.resources.gold+=987;
  c.localStorage.setItem=()=>{throw new Error('QuotaExceededError');};
  assert.equal(c.applyCloudSave(remote,{isAdmin:false,reason:'initial',backup:true}).ok,false);
  assert.equal(JSON.stringify(c.game.state),before);assert.equal(stored.get('save'),original);
});
test('cloud payload cannot grant operator privileges without verified metadata',()=>{
  const {c}=setup();const privileged=new SengokuEngine({officers:roster,isAdmin:true,startCastle:'edo',seed:17});
  const save=JSON.parse(privileged.exportSave());save.state.isAdmin=true;
  assert.equal(c.applyCloudSave(save,{isAdmin:false,reason:'remote',backup:false}).ok,true);
  assert.equal(c.game.isAdmin,false);assert.notEqual(c.game.state.home,'edo');
  assert.equal(c.game.ownsVariant('of_b0616adde162','U'),false);
  assert.equal(c.applyCloudSave(save,{isAdmin:true,reason:'remote',backup:false}).ok,true);
  assert.equal(c.game.isAdmin,true);assert.equal(c.game.state.home,'edo');
  assert.equal(c.game.ownsVariant('of_b0616adde162','U'),true);
});
test('operator restore is idempotent, writer-only and rolls back on save failure',()=>{
  const {c}=setup({admin:true});const key='of_b0616adde162:U';
  c.game.state.officerVariants=c.game.state.officerVariants.filter(v=>v!==key);
  c.syncAccess.writable=false;assert.equal(c.restoreAdminAssets().ok,false);assert(!c.game.state.officerVariants.includes(key));
  c.syncAccess.writable=true;c.localStorage.setItem=()=>{throw new Error('storage full');};
  assert.equal(c.restoreAdminAssets().ok,false);assert(!c.game.state.officerVariants.includes(key));
  c.saveEnabled=true;c.localStorage.setItem=()=>{};assert(c.restoreAdminAssets().ok);assert(c.restoreAdminAssets().ok);
  assert.equal(c.game.state.officerVariants.filter(v=>v===key).length,1);
});
test('backup rotation keeps the five most recent replacement checkpoints',()=>{
  const {c,stored}=setup();
  for(let i=0;i<7;i++){stored.set('save',JSON.stringify({state:{turn:i}}));c.backupCurrentSave('test');}
  const backups=JSON.parse(stored.get('backups'));assert.equal(backups.length,5);
  assert.equal(JSON.parse(backups[0].save).state.turn,6);assert.equal(JSON.parse(backups[4].save).state.turn,2);
});

test('clock catch-up and an in-flight field action block writes and gift mutation',()=>{
  const {c,events}=setup();let ready=true;const clock={id:'world-v1',elapsedMs:120000,confirmedElapsedMs:100000,running:true,speed:4};
  c.window.SengokuWorldClock={snapshot:()=>({ready,clock})};
  assert.equal(c.canMutate(),false,'unanchored state waits for shared time');
  c.game.applyWorldClock({...clock,elapsedMs:90000});assert.equal(c.canMutate(),false,'stale economic anchor waits for catch-up');
  c.game.applyWorldClock({...clock,elapsedMs:100000});assert.equal(c.canMutate(),true,'confirmed time, not speculative display time, enables play');
  c.fieldActionPending=true;assert.equal(c.save(),false);assert.equal(c.applyDurableGift({gold:100},'field-busy').ok,false);assert.equal(events.length,0);
  c.fieldActionPending=false;ready=false;assert.equal(c.canMutate(),false);ready=true;c.worldCatchingUp=true;assert.equal(c.canMutate(),false);
});
test('magatama gift, resources and receipt persist atomically and a reloaded retry cannot duplicate them',()=>{
  const {c,stored,events}=setup(),original=stored.get('save'),before=JSON.stringify(c.game.state),originalSet=c.localStorage.setItem;
  c.localStorage.setItem=()=>{throw Error('storage full');};const failed=c.applyDurableGift({gold:100,magatama:500},'magatama-durable');
  assert.equal(failed.ok,false);assert.equal(failed.retryable,true);assert.equal(JSON.stringify(c.game.state),before);assert.equal(stored.get('save'),original);assert.equal(events.length,0);
  c.saveEnabled=true;c.localStorage.setItem=originalSet;const received=c.applyDurableGift({gold:100,magatama:500},'magatama-durable');assert.equal(received.ok,true);
  const saved=JSON.parse(stored.get('save')).state,initial=JSON.parse(original).state;assert.equal(saved.magatama,initial.magatama+500);assert.equal(saved.resources.gold,initial.resources.gold+100);assert.deepEqual(saved.giftReceipts,['magatama-durable']);assert.equal(events.length,1);
  c.game=SengokuEngine.fromSave(stored.get('save'),roster);const stable=JSON.stringify(c.game.state);assert.equal(c.applyDurableGift({gold:100,magatama:500},'magatama-durable').already,true);assert.equal(JSON.stringify(c.game.state),stable);assert.equal(events.length,1,'Receipt replay requires no second durable write');
});
test('recovery preview validates a save without replacing the current game or storage',()=>{
  const {c,stored,events}=setup();const before=JSON.stringify(c.game.state),raw=stored.get('save');
  const backup=JSON.parse(raw);backup.state.resources.gold+=321;
  const preview=c.prepareRecoverySave(backup,{isAdmin:false});
  assert.equal(preview.ok,true);assert.equal(preview.save.state.resources.gold,backup.state.resources.gold);
  assert.equal(JSON.stringify(c.game.state),before);assert.equal(stored.get('save'),raw);assert.equal(events.length,0);
  assert.equal(c.prepareRecoverySave({game:'wrong',version:2,state:{}},{isAdmin:true}).ok,false);
  assert.equal(stored.get('save'),raw);
});
test('recovery trusts verified operator metadata rather than role fields inside a backup',()=>{
  const {c}=setup();const backup=JSON.parse(new SengokuEngine({officers:roster,isAdmin:true,seed:77}).exportSave());
  backup.state.isAdmin=true;
  const ordinary=c.prepareRecoverySave(backup,{isAdmin:false});assert.equal(ordinary.ok,true);
  assert.notEqual(ordinary.save.state.home,'edo');assert(!ordinary.save.state.officerVariants.includes('of_b0616adde162:U'));
  const operator=c.prepareRecoverySave(backup,{isAdmin:true});assert.equal(operator.ok,true);
  assert.equal(operator.save.state.home,'edo');assert(operator.save.state.officerVariants.includes('of_b0616adde162:U'));
});
test('domain recovery checkpoints existing progress and rolls back when durable storage is unavailable',()=>{
  const {c,stored,events}=setup();const raw=stored.get('save');const backup=JSON.parse(raw);backup.state.resources.gold+=654;
  const original=c.localStorage.setItem;c.localStorage.setItem=()=>{throw Error('storage full');};
  assert.equal(c.applyRecoverySave(backup,{isAdmin:false}).ok,false);assert.equal(stored.get('save'),raw);
  c.localStorage.setItem=original;assert.equal(c.applyRecoverySave(backup,{isAdmin:false}).ok,true);
  assert.equal(JSON.parse(stored.get('backups'))[0].save,raw);assert.equal(JSON.parse(stored.get('backups'))[0].reason,'domain-recovery');
  assert.equal(JSON.parse(stored.get('save')).state.resources.gold,backup.state.resources.gold);assert.equal(events.length,0);
});

console.log(`${count} app/cloud bridge checks passed.`);
