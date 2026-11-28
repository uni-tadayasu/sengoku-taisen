/* Actual app confirmation functions and delegated clicks, using the real engine. */
'use strict';
const assert=require('node:assert/strict'),{test}=require('node:test'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:Engine,SENGOKU_DATA:data}=require('../engine.js'),{setup}=require('./helpers/dom-model.cjs');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),copy=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.search(new RegExp('^  (?:async )?function '+name+'\\(','m'));assert(start>=0,name);const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;return source.slice(start,end);}
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return{promise,resolve,reject};}
function fixture({linked=false}={}){
 const {doc,host}=setup(),handlers=new Map(),game=new Engine({seed:37,clan:'織田家'}),posts=[],toasts=[],frames=[],pending=new Map(),saved=[];host.id='main';
 const dialog=doc.createElement('dialog'),content=doc.createElement('div');dialog.id='modal';content.id='modal-content';dialog.appendChild(content);doc.body.appendChild(dialog);doc.addEventListener=(type,handler)=>handlers.set(type,handler);
 const target='nijo';game.state.castles[target]={...game.state.castles[target],owner:game.state.clan,level:8,wall:6,troops:2400};
 const control={writable:true,saveOkay:true,owner:'release-player',epoch:1,accountEpoch:1,requests:0,onRequest:null,renders:0,refreshes:0};let context;
 context={game,data,console,JSON,Math,Set,Promise,Date,document:doc,window:{SengokuSocial:{getUser:()=>({id:control.owner}),getCourtContext:()=>({playerId:control.owner,epoch:control.epoch,accountEpoch:control.accountEpoch,privilegeEpoch:1})},SengokuTerritoryOwners:{reset:()=>{},ensure:()=>{}}},state:()=>context.game.state,$:selector=>doc.querySelector(selector),roleEpoch:1,currentView:'map',syncAccess:{linked,banned:false,rolePending:false},saveEnabled:true,castleReleasePending:false,activeModal:'',activeModalContext:null,
  esc:value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),num:value=>String(value),canMutate:()=>control.writable,requireWritable:()=>control.writable,syncMessage:()=> '同期を確認してください。',
  getPendingCastleRelease:id=>pending.get(id)||null,toast:(message,error)=>toasts.push({message,error}),playNote(){},refreshLiveControls:()=>control.refreshes++,preserveInteraction:(_node,draw)=>draw(),render:()=>control.renders++,
  save:()=>{if(!control.saveOkay){context.saveEnabled=false;return false;}saved.push(context.game.exportSave());return true;},
  modal:(title,subtitle,body,footer,kind,review)=>{context.activeModal=kind;context.activeModalContext=review;content.innerHTML='<h2>'+context.esc(title)+'</h2><p>'+context.esc(subtitle)+'</p>'+body+'<footer>'+footer+'</footer>';dialog.showModal();frames.push(content.innerHTML);},
  closeModal:()=>{dialog.close();context.activeModal='';context.activeModalContext=null;},
  requestField:async(route,options)=>{posts.push({route,options:copy(options)});control.requests++;if(!pending.has(options.data.castleId))pending.set(options.data.castleId,{castleId:options.data.castleId,requestId:'release-request-one',campaignId:context.game.state.walking.campaignId,pending:true});if(control.onRequest)return control.onRequest(route,options);const result=context.game.releaseCastle(options.data.castleId);pending.delete(options.data.castleId);return result;}
 };
 vm.createContext(context);const declaration=source.slice(source.indexOf('  const mutationActions='),source.indexOf('\n',source.indexOf('  const mutationActions=')));vm.runInContext(declaration+'\n'+['castleReleaseScope','castleReleaseCurrent','castleReleaseAction','drawCastleRelease','castleReleaseModal','confirmCastleRelease'].map(fn).join('\n'),context);
 const clickStart=source.indexOf("  document.addEventListener('click',async event=>"),clickEnd=source.indexOf("  document.addEventListener('input'",clickStart);vm.runInContext(source.slice(clickStart,clickEnd),context);
 return{c:context,game,control,target,posts,toasts,frames,pending,saved,host,dialog,content,show:()=>context.castleReleaseModal(target),click:async action=>{const node=doc.querySelector('[data-action="'+action+'"]');assert(node,action);await handlers.get('click')({target:node});},action:()=>context.castleReleaseAction(target)};
}

test('castle details expose release only for owned non-home ordinary and major protected castles',()=>{
 const h=fixture();assert.match(h.action(),/data-action="release-castle"/);for(const id of [h.game.state.home,'edo','kyoto_gosho','kagoshima','missing'])assert.equal(h.c.castleReleaseAction(id),'');
 h.game.state.cycle.protectedRegions=[h.game.castle(h.target).region];assert.match(h.action(),/この城を手放す/);h.game.state.castles[h.target].owner='他家';assert.equal(h.action(),'');assert.equal(h.posts.length,0);
});
test('review explains the one-castle loss, no refund and persistent exclusion, and cancel sends nothing',async()=>{
 const h=fixture();const before=JSON.stringify(h.game.state);assert(h.show());assert.match(h.content.textContent,/城郭・城壁・守備兵/);assert.match(h.content.textContent,/支払った資源は返金されず/);assert.match(h.content.textContent,/他の保護城は維持/);assert.match(h.content.textContent,/同期や次の周回で自動復活せず/);assert.equal(h.posts.length,0);await h.click('close');assert.equal(h.dialog.open,false);assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(JSON.stringify(h.game.state),before);assert.equal(h.posts.length,0);assert.equal(h.saved.length,0);
});
test('the confirmed local release is saved once and a repeated click cannot release another castle',async()=>{
 const h=fixture(),resources=copy(h.game.state.resources);h.show();await h.click('confirm-release-castle');assert.notEqual(h.game.castle(h.target).owner,h.game.state.clan);assert(h.game.state.cycle.releasedCastles.includes(h.target));assert.deepEqual(h.game.state.resources,resources);assert.equal(h.saved.length,1);assert.equal(h.dialog.open,false);assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(h.saved.length,1);assert.equal(h.posts.length,0);assert.equal(h.control.renders,1);
});
test('a failed local save restores holdings, troops, branches, jobs and exclusion flags before showing an error',async()=>{
 const h=fixture();Object.keys(h.game.state.resources).forEach(key=>h.game.state.resources[key]=1000000);assert(h.game.buildBranch(h.target,'north').ok);h.game.state.branches[0].stationedTroops=800;const before=JSON.stringify(h.game.state);h.control.saveOkay=false;h.show();assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(JSON.stringify(h.game.state),before);assert.match(h.content.textContent,/操作前に戻しました/);assert(h.content.querySelector('[data-action="confirm-release-castle"]').disabled);assert.equal(h.posts.length,0);
});
test('online release waits for the bridge, sends the confirmed castle only, and blocks double clicks and extra previews',async()=>{
 const h=fixture({linked:true}),pause=deferred(),before=JSON.stringify(h.game.state);h.control.onRequest=()=>pause.promise;h.show();const task=h.c.confirmCastleRelease();assert.equal(JSON.stringify(h.game.state),before,'no optimistic local mutation');assert.equal(h.show(),false);assert.equal(await h.c.confirmCastleRelease(),false);assert(h.content.querySelector('[data-action="confirm-release-castle"]').disabled);assert.deepEqual(h.posts,[{route:'/field/release',options:{method:'POST',data:{castleId:h.target,confirmed:true}}}]);
 pause.resolve({ok:true,release:{castleId:h.target,idempotent:false}});assert.equal(await task,true);assert.equal(h.posts.length,1);assert.equal(h.saved.length,0);assert.equal(h.dialog.open,false);
});
test('identity, role, campaign, home and navigation changes invalidate a pre-send confirmation',async()=>{
 for(const change of [h=>h.control.owner='other',h=>h.control.epoch++,h=>h.control.accountEpoch++,h=>h.c.roleEpoch++,h=>h.game.state.walking.campaignId='new-campaign',h=>h.game.state.home=h.target,h=>h.c.currentView='army',h=>h.c.closeModal()]){const h=fixture({linked:true});h.show();change(h);assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(h.posts.length,0);}
});
test('closing or changing identity while a response is pending never reopens the old confirmation or shows old success',async()=>{
 for(const change of [h=>h.c.closeModal(),h=>{h.c.closeModal();h.c.currentView='army';},h=>h.control.owner='other']){const h=fixture({linked:true}),pause=deferred();h.control.onRequest=()=>pause.promise;h.show();const task=h.c.confirmCastleRelease(),frames=h.frames.length;change(h);pause.resolve({ok:true});assert.equal(await task,false);assert.equal(h.frames.length,frames);assert.equal(h.control.renders,0);assert(!h.toasts.some(row=>row.message.includes('表示を更新しました')));assert.equal(h.c.castleReleasePending,false);}
});
test('lost committed responses keep a receipt-only recovery action even after the castle is no longer owned',async()=>{
 const h=fixture({linked:true});let applied=0;h.control.onRequest=()=>{if(!applied++){h.game.releaseCastle(h.target);throw Error('応答を確認できません');}h.pending.delete(h.target);return{ok:true,release:{castleId:h.target,idempotent:true}};};h.show();assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(h.c.activeModalContext.recovery,true);assert.match(h.content.textContent,/同じ手続きの結果を確認/);assert.match(h.action(),/受付の結果を確認/);assert.notEqual(h.game.castle(h.target).owner,h.game.state.clan);await h.click('confirm-release-castle');assert.equal(h.posts.length,2);assert.deepEqual(h.posts[0],h.posts[1]);assert.equal(h.dialog.open,false);assert.equal(h.pending.size,0);
});
test('a pending record can be reviewed from a non-owned castle but an expired receipt cannot become a fresh release',async()=>{
 const h=fixture({linked:true});h.game.state.castles[h.target].owner='他家';h.pending.set(h.target,{castleId:h.target,requestId:'old-release',campaignId:'old-campaign',pending:true});assert(h.show());assert.equal(h.c.activeModalContext.recovery,true);h.control.onRequest=()=>{h.pending.delete(h.target);throw Object.assign(Error('以前の返還確認は失効しました。'),{code:'FIELD_RELEASE_CONFIRMATION_EXPIRED'});};assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(h.c.activeModalContext.expired,true);assert.equal(h.content.querySelector('[data-action="confirm-release-castle"]'),null);h.game.state.castles[h.target].owner=h.game.state.clan;assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(h.posts.length,1);
});
test('a replaced pending record and a newly read-only device cannot use the old review',async()=>{
 const h=fixture({linked:true});h.pending.set(h.target,{castleId:h.target,requestId:'previous',campaignId:h.game.state.walking.campaignId,pending:true});h.show();h.pending.set(h.target,{castleId:h.target,requestId:'replacement',campaignId:h.game.state.walking.campaignId,pending:true});assert.equal(await h.c.confirmCastleRelease(),false);assert.equal(h.posts.length,0);assert.equal(h.c.activeModalContext.expired,true);
 const readonly=fixture({linked:true});readonly.show();readonly.control.writable=false;assert.equal(await readonly.c.confirmCastleRelease(),false);assert.equal(readonly.posts.length,0);
});
test('castle names and error messages are escaped in the confirmation',async()=>{
 const h=fixture({linked:true}),castle=h.game.castle.bind(h.game);h.game.castle=id=>({...castle(id),name:'<img src=x>'});h.show();assert.match(h.content.textContent,/<img src=x>/);assert.equal(h.content.querySelector('img'),null);h.control.onRequest=()=>{throw Error('<script>error</script>');};await h.c.confirmCastleRelease();assert.equal(h.content.querySelector('script'),null);assert.match(h.content.textContent,/<script>error<\/script>/);
});

test('the real live-control refresh unlocks other owned castles after success and keeps failed-save confirmation locked',async()=>{
 const h=fixture();h.game.state.castles.azuchi.owner=h.game.state.clan;h.c.refreshTouchHeaderStatus=()=>{};h.c.refreshBranchDeploymentPanels=()=>{};vm.runInContext(fn('refreshLiveControls'),h.c);h.c.render=()=>{h.control.renders++;h.host.innerHTML=h.c.castleReleaseAction('azuchi')+h.c.castleReleaseAction(h.target);};h.c.render();h.show();assert.equal(await h.c.confirmCastleRelease(),true);assert.equal(h.host.querySelector('[data-id="azuchi"]').disabled,false);assert.equal(h.host.querySelector('[data-id="'+h.target+'"]'),null);
 const failed=fixture();failed.c.refreshTouchHeaderStatus=()=>{};failed.c.refreshBranchDeploymentPanels=()=>{};vm.runInContext(fn('refreshLiveControls'),failed.c);failed.control.saveOkay=false;failed.show();assert.equal(await failed.c.confirmCastleRelease(),false);assert(failed.content.querySelector('[data-action="confirm-release-castle"]').disabled);assert.equal(failed.game.castle(failed.target).owner,failed.game.state.clan);
});
