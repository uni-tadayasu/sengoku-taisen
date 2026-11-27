'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
const {SengokuEngine:Engine}=require('../engine.js'),context={window:{}};
vm.runInNewContext(read('officers-data.js'),context);
const roster=JSON.parse(JSON.stringify(context.window.SENGOKU_OFFICERS)),id='of_45e0f4cb36ad',make=options=>new Engine({clan:'織田家',officers:roster,seed:12,...options});
const painted=[],scope={SengokuArt:{portrait:o=>{painted.push(o);return '<span class="test-portrait"></span>';}}};scope.window=scope;
vm.runInNewContext(read('deputy-officer.js'),scope);
for(const options of [{},{isAdmin:true},{isStaff:true}])assert.equal(scope.SengokuDeputyOfficer.markup(make(options)),'');
const game=make({isDeputy:true}),army=[...game.state.army];
const markup=scope.SengokuDeputyOfficer.markup(game);
assert(markup.includes('サブ運営専用 · レリーフ絵巻'));
assert.equal((markup.match(/<strong>100<\/strong>/g)||[]).length,4);
assert(markup.includes('data-action="restore-deputy-assets"'));
assert(markup.includes('data-action="deploy-deputy-officer"'));
assert.equal(painted.at(-1).deputyExclusive,true);
assert.deepEqual(game.state.army,army,'Rendering must not change an existing formation');
game.restoreDeputyAssets({assignCommander:true});
assert(scope.SengokuDeputyOfficer.markup(game).includes('data-action="deploy-deputy-officer" disabled'));
game.setRoleAccess({isDeputy:false});assert.equal(scope.SengokuDeputyOfficer.markup(game),'');

// Execute the application's actual mutation bridge against the shared engine.
const app=read('app.js'),start=app.indexOf('  function restoreDeputyAssets(options={}'),end=app.indexOf('  window.SengokuBridge=',start);
assert(start>=0&&end>start);
const source=app.slice(start,end),clone=value=>JSON.parse(JSON.stringify(value));
function bridge(options={}){
 const g=make({isDeputy:true}),calls={save:0,render:0},ctx={game:g,canMutate:()=>options.writable!==false,saveEnabled:options.saveEnabled!==false,syncMessage:()=> '同期を確認',state:()=>g.state,save:()=>{calls.save++;return options.saveSuccess!==false;},$:()=>({}),render(){calls.render++;},preserveInteraction:(_node,fn)=>fn(),refreshActiveModal(){}};
 vm.runInNewContext(source+';this.restore=restoreDeputyAssets;',ctx);return{g,calls,restore:ctx.restore};
}
for(const options of [{writable:false},{saveEnabled:false}]){const h=bridge(options),before=clone(h.g.state);assert.equal(h.restore({assignCommander:true}).ok,false);assert.deepEqual(h.g.state,before);assert.equal(h.calls.save,0);}
{
 const h=bridge(),before=[...h.g.state.army],health=clone(h.g.state.officerHealth);
 assert(h.restore({assignCommander:true}).ok);assert.deepEqual(h.g.state.army,[id,...before].slice(0,3));assert.deepEqual(h.g.state.officerHealth,health);assert.equal(h.calls.save,1);
 const once=clone(h.g.state);assert(h.restore().ok);assert.deepEqual(h.g.state,once);
}
{
 const h=bridge({saveSuccess:false});h.g.state.officerVariants=h.g.state.officerVariants.filter(key=>key!==id+':U');const before=JSON.stringify(h.g.state);
 assert.equal(h.restore({assignCommander:true}).ok,false);assert.equal(JSON.stringify(h.g.state),before,'Save failure rolls back both grant and commander assignment');
}
{
 const h=bridge();h.g.setRoleAccess({isDeputy:false});const before=JSON.stringify(h.g.state);assert.equal(h.restore({assignCommander:true}).ok,false);assert.equal(JSON.stringify(h.g.state),before);assert.equal(h.calls.save,0);
}
// The real delegated click cases must distinguish restore from deploy.
const actionCase=app.match(/case 'restore-deputy-assets':case 'deploy-deputy-officer':\{([\s\S]*?)break;\}/)?.[1];assert(actionCase);
for(const a of ['restore-deputy-assets','deploy-deputy-officer']){let chosen;vm.runInNewContext(actionCase.replace(/break;?$/,''),{a,restoreDeputyAssets:o=>{chosen=o.assignCommander;return{ok:true,message:'done'};},toast(){}});assert.equal(chosen,a==='deploy-deputy-officer');}
const groups=JSON.parse(read('tools/game-entry.json'));assert(groups['game-interface.bundle.js'].indexOf('deputy-officer.js')<groups['game-interface.bundle.js'].indexOf('app.js'));assert(groups['game-layout.bundle.css'].includes('deputy-officer.css'));
// Settings has no modal context; role changes must still remove stale art.
{
 const begin=app.indexOf('  function refreshActiveModal(){'),finish=app.indexOf('  function upgradeDurableBuilding',begin),g=make({isDeputy:true}),panel={html:''};
 const ctx={activeModal:'settings',activeModalContext:null,gachaPresentation:null,game:g,window:scope,$:selector=>selector==='#modal'?{open:true}:panel,preserveInteraction:(_host,fn)=>fn(),patchHTML:(host,html)=>{host.html=html;}};
 vm.runInNewContext(app.slice(begin,finish)+';this.refresh=refreshActiveModal;',ctx);
 ctx.refresh();assert(panel.html.includes('復元して総大将に配備'));g.restoreDeputyAssets({assignCommander:true});ctx.refresh();assert(panel.html.includes('総大将に配備済み'));
 g.setRoleAccess({isDeputy:false});ctx.refresh();assert.equal(panel.html,'');
}
console.log('PASS deputy recovery UI, authenticated visibility, four 100 stats, formation, action dispatch, idempotency and save rollback');
