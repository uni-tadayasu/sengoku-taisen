/* Actual file-input / confirmation code with the real engine. No network or live data. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine:E}=require('../engine.js'),rosterContext={window:{}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../officers-data.js'),'utf8'),rosterContext);
const roster=rosterContext.window.SENGOKU_OFFICERS,source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.indexOf('  function '+name+'(');assert(start>=0,name);const firstEnd=source.indexOf('\n',start);if(source.slice(start,firstEnd).endsWith('}'))return source.slice(start,firstEnd);const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function clock(elapsedMs=30000){return{id:'import-maintenance-clock',elapsedMs,confirmedElapsedMs:elapsedMs,running:true,speed:1};}
function seed(){const game=new E({officers:roster,seed:17});game.state.resources={gold:1000000,rice:1000000,wood:1000000,stone:1000000};game.applyWorldClock(clock(0));return game;}
function authority(game,{revision=1,asOfElapsedMs=30000,baseline=0,changes=[]}={}){return{version:1,campaignId:game.state.walking.campaignId,activatedElapsedMs:0,revision,asOfElapsedMs,baseline:{elapsedMs:baseline,vacant:5000,trade:250,alliance:750},changes};}
function harness({linked=true}={}){
 const game=seed(),fileSave=game.exportSave(),trusted=authority(game);if(linked)assert(game.setMaintenanceAuthority(trusted).ok);game.applyWorldClock(clock());
 const stored=new Map([['save',game.exportSave()]]),messages=[],dialogs=[],events=[],input={addEventListener(type,handler){assert.equal(type,'change');this.change=handler;}},identity={id:linked?'owner-a':'',epoch:1,accountEpoch:1,privilegeEpoch:1,pending:false,banned:false};let publicClock=clock(),ready=true;
 const c={console,Date,Math,JSON,Promise,SengokuEngine:E,roster,game,roleEpoch:0,saveKey:'save',backupKey:'backups',saveEnabled:true,saveWarning:'',startPending:false,worldCatchingUp:false,worldSettlementPending:false,fieldActionPending:false,walkingActionPending:false,strategyActionPending:false,lastRealtime:0,saveCounter:0,selectedCastle:'kiyosu',activeModal:'',lastLocalSaveRaw:null,lastLocalSaveGame:null,
  syncAccess:{linked,ready:true,writable:true,rolePending:false,banned:false},performance:{now:()=>1000},localStorage:{getItem:key=>stored.get(key)||null,setItem:(key,value)=>stored.set(key,String(value))},CustomEvent:class{constructor(type){this.type=type;}},dispatchEvent:event=>events.push(event.type),$:selector=>selector==='#save-import'?input:null,
  toast:(message,error)=>messages.push({message,error}),render(){},retireLocalWalkingContext(){},queueWorldProgress(){},changedLocalCampaign:()=>false,esc:String,shortDate:turn=>String(turn),closeModal(){c.activeModal='';},modal(title,subtitle,body,footer,kind){dialogs.push({title,subtitle,body,footer,kind});c.activeModal=kind;}};
 c.window=c;c.state=()=>c.game.state;c.SengokuWorldClock={snapshot:()=>({ready,clock:publicClock}),refresh:async()=>({ok:true})};c.SengokuSocial={getUser:()=>identity.id?{id:identity.id}:null,getCourtContext:()=>({...identity,playerId:identity.id,user:identity.id?{id:identity.id}:null})};
 vm.createContext(c);vm.runInContext(['confirmedWorldClock','clockIsApplied','canMutate','syncMessage','requireWritable','save','backupCurrentSave'].map(fn).join('\n'),c);
 const start=source.indexOf('  let importedGame=null,'),end=source.indexOf('\n  let installPrompt=null;',start);assert(start>=0&&end>start,'Actual import controls');
 vm.runInContext(source.slice(start,end)+'\nthis.importTest={candidate:()=>importedGame,scope:()=>importedScope};',c);
 assert.match(source,/case 'confirm-import':confirmFileImport\(\);break;/,'Real action dispatches the tested confirmation');
 return{c,stored,messages,dialogs,events,identity,fileSave,trusted,clock(value){publicClock=clock(value);},ready(value){ready=value;},read(raw=fileSave){const file=typeof raw==='string'?{size:Buffer.byteLength(raw),text:async()=>raw}:raw;return input.change({target:{files:[file],value:'selected'}});},confirm:()=>c.confirmFileImport()};
}
function unchanged(h,game=h.c.game,save=h.stored.get('save')){return()=>{assert.strictEqual(h.c.game,game);assert.equal(h.stored.get('save'),save);assert.equal(h.events.length,0);assert.equal(h.stored.get('backups'),undefined);};}
const tests=[],test=(name,run)=>tests.push([name,run]);
test('linked preview and commit use only runtime history and retain its private clock limit',async()=>{
 const h=harness(),original=h.c.game,stored=h.stored.get('save'),raw=JSON.parse(h.fileSave),forged={...h.trusted,asOfElapsedMs:50000,baseline:{elapsedMs:0,vacant:0,trade:0,alliance:0}};raw.maintenanceAuthority=forged;raw.state.maintenanceAuthority=forged;h.clock(50000);
 await h.read(JSON.stringify(raw));assert.equal(h.dialogs.length,1);assert.strictEqual(h.c.game,original);assert.equal(h.stored.get('save'),stored);assert.equal(h.c.importTest.candidate().getMaintenanceAuthority().asOfElapsedMs,30000);assert.equal(h.c.importTest.candidate().maintenance().troops.external,6000);
 const expected=E.fromSave(h.fileSave,roster,{maintenanceAuthority:h.trusted});expected.applyWorldClock(clock(30000));assert(h.confirm());assert.equal(h.c.game.state.worldClock.elapsedMs,30000);assert.equal(h.c.confirmedWorldClock().elapsedMs,30000);assert.equal(h.c.game.maintenance().troops.external,6000);assert.deepEqual(copy(h.c.game.state.resources),expected.state.resources);assert.equal(h.c.canMutate(),true);assert.equal(h.events.length,1);assert.equal(JSON.parse(h.stored.get('backups'))[0].save,stored);assert.equal(h.c.importTest.candidate(),null);
});
test('confirmation rechecks the latest trusted history instead of the preview authority',async()=>{
 const h=harness();await h.read();const latest=authority(h.c.game,{revision:2,asOfElapsedMs:50000,changes:[{elapsedMs:30000,vacant:11000,trade:250,alliance:750}]});assert(h.c.game.setMaintenanceAuthority(latest).ok);h.clock(50000);h.c.game.applyWorldClock(h.c.confirmedWorldClock());
 const expected=E.fromSave(h.fileSave,roster,{maintenanceAuthority:latest});expected.applyWorldClock(clock(50000));assert(h.confirm());assert.equal(h.c.game.getMaintenanceAuthority().revision,2);assert.equal(h.c.game.maintenance().troops.external,12000);assert.deepEqual(copy(h.c.game.state.resources),expected.state.resources);assert.equal(h.c.game.state.worldClock.elapsedMs,50000);
});
test('missing runtime history cannot be replaced by authority fields inside the file',async()=>{
 for(const phase of ['preview','confirm']){const h=harness(),raw=JSON.parse(h.fileSave);raw.maintenanceAuthority=h.trusted;raw.state.maintenanceAuthority=h.trusted;if(phase==='confirm')await h.read(JSON.stringify(raw));h.c.game.setMaintenanceAuthority(null);const check=unchanged(h);
  if(phase==='preview')await h.read(JSON.stringify(raw));else assert.equal(h.confirm(),false);check();assert.equal(h.c.importTest.candidate(),null);assert.match(h.messages.at(-1).message,/維持費を同期/);
 }
});
test('a different campaign and an uncovered old checkpoint preserve the existing game and offer recovery',async()=>{
 const h=harness(),foreign=seed(),check=unchanged(h);assert.notEqual(foreign.state.walking.campaignId,h.c.game.state.walking.campaignId);await h.read(foreign.exportSave());check();assert.equal(h.dialogs.length,0);assert.match(h.messages.at(-1).message,/異なるセーブ.*引き継ぎ・復元/);
 for(const phase of ['preview','confirm']){const h=harness();if(phase==='confirm')await h.read();assert(h.c.game.setMaintenanceAuthority(authority(h.c.game,{revision:2,baseline:20000})).ok);const check=unchanged(h);if(phase==='preview')await h.read();else assert.equal(h.confirm(),false);check();assert.equal(h.c.importTest.candidate(),null);assert.match(h.messages.at(-1).message,/維持費の履歴.*引き継ぎ・復元/);}
});
const scopeChanges={account:h=>{h.identity.id='owner-b';},authentication:h=>{h.identity.epoch++;},accountAccess:h=>{h.identity.accountEpoch++;},privilege:h=>{h.identity.privilegeEpoch++;},role:h=>{h.c.roleEpoch++;},campaign:h=>{h.c.game=seed();},disconnected:h=>{h.c.syncAccess.linked=false;}};
test('account, authorization, role and campaign changes during file reading cannot open a stale preview',async()=>{
 for(const [name,change]of Object.entries(scopeChanges)){const h=harness(),read=deferred(),pending=h.read({size:100,text:()=>read.promise});change(h);const check=unchanged(h);read.resolve(h.fileSave);await pending;check();assert.equal(h.dialogs.length,0,name);assert.equal(h.c.importTest.candidate(),null,name);assert.match(h.messages.at(-1).message,/切り替わりました/,name);}
});
test('confirmation revalidates scope and write access before backup or replacement',async()=>{
 for(const [name,change]of Object.entries({...scopeChanges,follower:h=>{h.c.syncAccess.writable=false;},pending:h=>{h.identity.pending=true;},banned:h=>{h.identity.banned=true;}})){const h=harness();await h.read();change(h);const check=unchanged(h);assert.equal(h.confirm(),false,name);check();assert.equal(h.c.importTest.candidate(),null,name);assert.match(h.messages.at(-1).message,/現在の進行は変更していません/,name);}
});
test('a slower previous file read cannot replace the newer selected file',async()=>{
 const h=harness(),old=deferred(),newer=deferred(),a=JSON.parse(h.fileSave),b=JSON.parse(h.fileSave);a.state.resources.gold=1234;b.state.resources.gold=5678;
 const first=h.read({size:100,text:()=>old.promise}),second=h.read({size:100,text:()=>newer.promise});newer.resolve(JSON.stringify(b));await second;old.resolve(JSON.stringify(a));await first;assert.equal(h.dialogs.length,1);assert.equal(h.c.importTest.candidate().state.resources.gold,5678);assert(h.confirm());assert(h.c.game.state.resources.gold>5600);
});
test('unlinked local imports retain their existing independent campaign and clock behavior',async()=>{
 const h=harness({linked:false}),foreign=seed(),raw=foreign.exportSave(),expected=E.fromSave(raw,roster);expected.applyWorldClock(clock());await h.read(raw);assert.equal(h.dialogs.length,1);assert.equal(h.c.importTest.candidate().getMaintenanceAuthority(),null);assert(h.confirm());assert.equal(h.c.game.state.walking.campaignId,foreign.state.walking.campaignId);assert.equal(h.c.game.getMaintenanceAuthority(),null);assert.deepEqual(copy(h.c.game.state.resources),expected.state.resources);assert.equal(h.events.length,1);
});
test('clock and backup failures keep the current campaign intact and do not save a partial import',async()=>{
 const h=harness();await h.read();h.ready(false);const check=unchanged(h);assert.equal(h.confirm(),false);check();assert.match(h.messages.at(-1).message,/確認.*読み込んで/);
 const k=harness();await k.read();const saved=k.stored.get('save'),game=k.c.game;k.c.localStorage.setItem=()=>{throw Error('storage full');};assert.equal(k.confirm(),false);assert.strictEqual(k.c.game,game);assert.equal(k.stored.get('save'),saved);assert.equal(k.events.length,0);assert.match(k.messages.at(-1).message,/バックアップ/);
});
(async()=>{for(const[name,run]of tests){await run();console.log('PASS '+name);}console.log(tests.length+' save-import / real maintenance engine groups passed. No live requests.');})().catch(error=>{console.error(error);process.exitCode=1;});
