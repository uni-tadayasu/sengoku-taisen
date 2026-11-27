const assert=require('node:assert/strict'),court=require('../public-court.js');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
let count=0;function test(name,run){court.clear();run();count++;console.log('PASS '+name);}
test('each current office pairs one accessible title with its own relief and linework',()=>{
 const roles=[
  ['参議','official','fan'],['中納言','official','scroll'],['大納言','official','book'],
  ['内大臣','official','gate'],['右大臣','official','feather'],['左大臣','official','pine'],
  ['太政大臣','chancellor','stamp'],['天皇','emperor','sun']
 ];
 const art=new Set(),files=new Set();
 for(const [title,kind,seal] of roles){
  const html=court.badge({courtOffice:{title,kind}});
  assert(html.includes('role="img" aria-label="役職：'+title+'"'));assert(html.includes('public-court-'+kind));assert(html.includes('<span class="public-court-title">'+title+'</span>'));assert(html.includes('aria-hidden="true" focusable="false"'));assert(!html.includes('太政官'));
  assert(html.includes(`data-court-seal="${seal}"`));
  assert(html.includes(`data-stable-key="court-seal-${seal}"`));
  const matching=html.match(/<img [^>]*src="([^"]+)"[^>]*>/g)||[];
  assert.equal(matching.length,1,title);
  const src=`assets/court-badges/${seal}-relief.webp`;
  assert(matching[0].includes(`src="${src}"`));
  assert.match(matching[0],/width="24" height="24" alt=""/);
  assert.doesNotMatch(html,/\son(?:load|error)=/);
  assert.doesNotMatch(html,/運営/,'public office labels, including the chancellor, do not announce operator roles');
  const bytes=fs.readFileSync(path.join(__dirname,'..',src));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  files.add(bytes.toString('base64'));
  art.add(html.match(/<svg[^>]+>(.*?)<\/svg>/)[1]);
 }
 assert.equal(files.size,8);assert.equal(art.size,8);assert.equal(court.badgeTitle('<b>天皇</b>'),'');
});
test('resource failure reveals only the fallback of the affected office without replacing the nameplate',()=>{
 let handle;
 const document={addEventListener(type,listener,capture){assert.equal(type,'error');assert.equal(capture,true);handle=listener;}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public-court.js'),'utf8'),{document});
 const failed={hidden:false,matches:s=>s==='img.public-court-relief'};
 const other={hidden:false,matches:()=>false};
 handle({target:failed});handle({target:other});handle({target:document});
 assert.equal(failed.hidden,true);assert.equal(other.hidden,false);
});
test('player rank and unverified privilege flags never imply an office',()=>{assert.equal(court.badge({id:'u_one',isAdmin:true,isStaff:true,evaluation:{rankName:'従五位'}}),'');assert.equal(court.badge({courtOffice:{title:'天皇',kind:'official'}}),'');assert.equal(court.badge({courtOffice:{title:'<img src=x onerror=alert(1)>',kind:'official'}}),'');});
test('empty participant deltas refresh cached badges and explicit null removes a demoted office',()=>{court.update({updates:[{playerId:'u_one',evaluation:{},courtOffice:{title:'参議',kind:'official'}}]});assert(court.badge('u_one').includes('参議'));court.update({updates:[{playerId:'u_one',evaluation:{},courtOffice:null}]});assert.equal(court.badge('u_one'),'');});
test('flat battle and guild owners share current names while private snapshots cannot alter public labels',()=>{court.update({battle:{attackerPlayerId:'u_one',attackerCourtOffice:{title:'天皇',kind:'emperor'},defenderPlayerId:'u_two',defenderCourtOffice:{title:'太政大臣',kind:'chancellor'}},guild:{ownerId:'u_three',ownerCourtOffice:{title:'中納言',kind:'official'}},save:{state:{id:'u_one',courtOffice:{title:'太政大臣',kind:'chancellor'}}}});assert.equal(court.office('u_one').title,'天皇');assert.equal(court.office('u_two').title,'太政大臣');assert.equal(court.office('u_three').title,'中納言');court.clear();assert.equal(court.badge('u_one'),'');});
test('already rendered names update on appointment and dismissal without rebuilding their card',()=>{let writes=0,html='';const node={dataset:{courtPlayer:'u_one'},get innerHTML(){return html;},set innerHTML(value){html=value;writes++;}};global.document={querySelectorAll:()=>[node]};try{assert(court.slot('u_one').includes('data-court-player="u_one"'));court.update({user:{id:'u_one',courtOffice:{title:'参議',kind:'official'}}});assert(html.includes('参議'));const same=writes;court.update({user:{id:'u_one',courtOffice:{title:'参議',kind:'official'}}});assert.equal(writes,same);court.update({user:{id:'u_one',courtOffice:null}});assert.equal(html,'');}finally{delete global.document;}});
test('late responses cannot revive a demoted office or badges from a cleared identity',()=>{const old=court.beginRequest(),recent=court.beginRequest();court.update({user:{id:'u_one',courtOffice:null}},{requestSequence:recent});court.update({user:{id:'u_one',courtOffice:{title:'天皇',kind:'emperor'}}},{requestSequence:old});assert.equal(court.badge('u_one'),'');court.clear();court.update({user:{id:'u_one',courtOffice:{title:'天皇',kind:'emperor'}}},{requestSequence:recent});assert.equal(court.badge('u_one'),'');});
test('shared construction and succession use only verified visible owners and discard stale projections',()=>{
 const old=court.beginRequest(),now=court.beginRequest(),left={title:'左大臣',kind:'official'},right={title:'右大臣',kind:'official'};
 court.update({staffBase:{jobs:[{startedBy:{id:'u_worker',name:'領主',courtOffice:left}}]},succession:{lordPlayerId:'u_next',lordCourtOffice:left,previousLordPlayerId:'u_former',previousLordCourtOffice:right}},{requestSequence:old});
 assert.equal(court.text('u_worker'),'左大臣');assert.equal(court.text('u_next'),'左大臣');assert.equal(court.text('u_former'),'右大臣');
 court.update({staffBase:{jobs:[{startedBy:{id:'u_worker',courtOffice:null}}]},succession:{lordPlayerId:'u_next',lordCourtOffice:null}},{requestSequence:now});
 court.update({save:{staffBase:{jobs:[{startedBy:{id:'u_worker',courtOffice:right}}]}},state:{id:'u_worker',courtOffice:left},staffBase:{jobs:[{startedBy:{id:'u_worker',courtOffice:left}}]}},{requestSequence:old});
 assert.equal(court.text('u_worker'),'');assert.equal(court.text('u_next'),'');
 court.update({save:{staffBase:{jobs:[{startedBy:{id:'u_worker',courtOffice:right}}]}},staffBase:{state:{id:'u_worker',name:'private',courtOffice:left}}});
 assert.equal(court.text('u_worker'),'');
});
test('parent renders keep one current office beside the evaluation rank after asynchronous updates',()=>{
 const {doc,host}=require('./helpers/dom-model.cjs').setup(),stable=require('../stable-dom.js');
 const id='u_minister',self={getPublicCourtIdentity:()=>id};
 const render=()=>stable.patch(host,['public','self'].map(mode=>`<div data-stable-key="${mode}"><b>従六位</b>${mode==='self'?court.selfSlot(id):court.slot(id)}</div>`).join(''));
 const verify=(title)=>{
  const rows=host.querySelectorAll('[data-stable-key="public"],[data-stable-key="self"]');
  assert.equal(rows.length,2);
  for(const row of rows){
   assert.equal(row.querySelectorAll('[data-court-seal]').length,title?1:0);
   assert.equal(row.textContent,'従六位'+(title||''));
  }
 };
 Object.assign(global,{document:doc,SengokuSocial:self,SengokuStableDOM:stable});
 try{
  render();verify(null);
  for(const title of ['右大臣','右大臣','左大臣',null]){
   court.update({user:{id,courtOffice:title?{title,kind:'official'}:null}});
   verify(title);render();verify(title);
   if(title==='左大臣'){
    // Recover slots a previous renderer already populated twice.
    for(const slot of host.querySelectorAll('[data-court-player]'))slot.append(slot.firstElementChild.cloneNode(true));
    court.update({user:{id,courtOffice:{title,kind:'official'}}});
    verify(title);render();verify(title);
   }
  }
  for(const current of ['左大臣','右大臣']){
   for(const staleOrder of [['左大臣','右大臣'],['右大臣','左大臣']]){
    for(const slot of host.querySelectorAll('[data-court-player]')){
     slot.innerHTML=staleOrder.map(title=>court.badgeTitle(title)).join('');
     assert.equal(slot.textContent,staleOrder.join(''));
    }
    court.update({user:{id,courtOffice:{title:current,kind:'official'}}});
    verify(current);render();verify(current);
   }
  }
 }finally{delete global.document;delete global.SengokuSocial;delete global.SengokuStableDOM;}
});
console.log(`${count} public court badge rendering scenarios passed.`);
