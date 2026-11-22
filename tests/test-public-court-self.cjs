/* Current self-office presentation uses the real social identity boundary and
   public office cache. Synthetic players only; no production requests. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const A = 'u_' + 'a'.repeat(32), B = 'u_' + 'b'.repeat(32);
const chancellor = {title:'太政大臣',kind:'chancellor'};
const official = {title:'左大臣',kind:'official'};
const evaluation = {version:1,score:40000,maxScore:100000,rankId:'court-9',rankName:'正五位下',rankIndex:9,progressPercent:20,toNext:1000,nextRank:{name:'従四位下'},breakdown:[]};
function harness(){
  const courtNodes=[],entryNodes=[];
  const scope={console,URL,URLSearchParams,AbortController,Date,Intl,setTimeout,clearTimeout,
    document:{readyState:'loading',hidden:false,addEventListener(){},removeEventListener(){},querySelectorAll(selector){return selector==='[data-court-player]'?courtNodes:selector==='[data-player-evaluation-self]'?entryNodes:[];}},
    localStorage:{getItem:()=>null,setItem(){},removeItem(){}},
    SengokuBridge:{setRoleAccess(){},setSyncAccess(){},applyCourtAccess(){}},
    SengokuCloudSync:{stop(){},start(){}},
    fetch(){throw Error('Presentation cannot make a network request');},
    __evaluation:evaluation
  };
  scope.window=scope;vm.createContext(scope);
  vm.runInContext(read('public-court.js'),scope);
  vm.runInContext(read('player-evaluation.js'),scope);
  const social=read('social.js').replace('global.SengokuSocial={open',
    'global.__selfCourt={s,acceptUser,connected,installIdentity,playerName,setRecovery(value){recoveryHeld=value;global.SengokuPublicCourt.refresh();},setPending(value){s.accountAccessPending=value?{}:null;global.SengokuPublicCourt.refresh();}};global.SengokuSocial={open');
  vm.runInContext(social,scope);
  const source=read('app.js');
  const entries=source.slice(source.indexOf('  function getEvaluation(){'),source.indexOf('  function renderHeader(){'));
  assert(entries.includes('function evaluationCourtPlayer('),'Read the actual game rank-entry integration');
  vm.runInContext(`
    let startPending=false, syncAccess={linked:true,ready:true,rolePending:false}, evaluationOwnerId=${JSON.stringify(A)};
    let activeModal='',activeModalContext=null;
    const game={evaluation:()=>window.__evaluation},data={evaluationRanks:[]};
    const state=()=>({clan:'織田家'}),num=n=>String(n);
    const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const $=selector=>selector==='#modal'?{open:activeModal==='player-evaluation'}:null;
    const patchHTML=(node,html)=>{node.innerHTML=html;};
    const preserveInteraction=(_node,run)=>run();
    const modal=(title,subtitle,body,footer,kind,context)=>{window.__modal={title,body,context};activeModal=kind;activeModalContext=context;};
    ${entries}
    window.__entries={render:evaluationEntry,refresh:refreshEvaluationUI,show:showEvaluation,key:()=>evaluationModalKey(getEvaluation()),owner(value){evaluationOwnerId=value;},ready(value){syncAccess.ready=value;},linked(value){syncAccess.linked=value;}};
  `,scope);
  function node(id,self=true){const n={dataset:{courtPlayer:id,...(self?{courtSelf:'true'}:{})},innerHTML:''};courtNodes.push(n);return n;}
  function entry(){const n={innerHTML:'',hidden:false,attrs:{},getAttribute(k){return this.attrs[k]??null;},setAttribute(k,v){this.attrs[k]=v;}};entryNodes.push(n);return n;}
  function connect(id=A,office=chancellor){
    scope.__selfCourt.s.identity={id,token:'x'.repeat(64)};
    scope.__selfCourt.connected(true);
    scope.__selfCourt.acceptUser({id,name:id===A?'現在の領主':'次の領主',clan:'織田家',evaluation,courtOffice:office,isAdmin:false,isStaff:false});
  }
  return {scope,court:scope.SengokuPublicCourt,social:scope.SengokuSocial,transport:scope.__selfCourt,entries:scope.__entries,node,entry,connect};
}
const tests=[];const test=(name,run)=>tests.push({name,run});
test('own sidebar/page rank and evaluation details include the authoritative office beside the rank',()=>{
  const h=harness();h.connect();
  const markup=h.entries.render();
  assert.match(markup,/player-evaluation-current/);
  assert(markup.indexOf('player-evaluation-badge')<markup.indexOf('public-court-badge'));
  assert.match(markup,/役職 太政大臣/);
  assert.match(markup,/public-court-title">太政大臣/);
  h.entries.show();assert.match(h.scope.__modal.body,/public-court-title">太政大臣/);
  const own=h.transport.playerName('現在の領主',evaluation,A,null,null,false);
  assert.match(own,/data-court-self="true"/);
  assert.match(own,/public-court-title">太政大臣/);
  assert.doesNotMatch(h.court.selfBadge(A),/<svg|<img|太政官|運営|スタッフ/);
});
test('office changes update mounted self slots and the open evaluation detail key',()=>{
  const h=harness(),slot=h.node(A),button=h.entry();h.connect();h.entries.show();h.entries.refresh();const oldKey=h.entries.key();
  h.court.update({playerId:A,playerCourtOffice:official});h.entries.refresh();
  assert.match(slot.innerHTML,/左大臣/);assert.doesNotMatch(slot.innerHTML,/太政大臣/);
  assert.match(button.attrs['aria-label'],/役職 左大臣/);
  assert.notEqual(h.entries.key(),oldKey);assert.match(h.scope.__modal.body,/左大臣/);
});
test('an explicit server null removes an office from own pages without changing the rank',()=>{
  const h=harness(),slot=h.node(A);h.connect();
  h.transport.acceptUser({...h.transport.s.user,courtOffice:null});
  assert.equal(slot.innerHTML,'');assert.doesNotMatch(h.entries.render(),/public-court-title/);
  assert.match(h.entries.render(),/正五位下/);
});
test('disconnect clears self immediately and only a new response can restore its office',()=>{
  const h=harness(),slot=h.node(A),other=h.node(B,false);h.connect();h.court.update({id:B,name:'他の領主',courtOffice:official});
  const pending=h.court.beginRequest();h.transport.connected(false);
  assert.equal(slot.innerHTML,'');assert.equal(h.court.text(A),'');assert.match(other.innerHTML,/左大臣/);
  h.court.update({id:A,name:'以前の応答',courtOffice:chancellor},{requestSequence:pending});
  h.transport.connected(true);assert.equal(slot.innerHTML,'');assert.doesNotMatch(h.entries.render(),/public-court-title/);
  h.court.update({id:A,name:'新しい応答',courtOffice:chancellor},{requestSequence:h.court.beginRequest()});
  assert.match(slot.innerHTML,/太政大臣/);
});
test('a switched account cannot inherit the previous owner office or label an old campaign',()=>{
  const h=harness(),slot=h.node(A);h.connect();
  h.transport.installIdentity({id:B,token:'y'.repeat(64)},{id:B,name:'次の領主',courtOffice:official});
  assert.equal(slot.innerHTML,'');assert.equal(h.social.getPublicCourtIdentity(),B);
  assert.doesNotMatch(h.entries.render(),/public-court-title|正五位下/);
  h.entries.owner(B);h.transport.acceptUser({...h.transport.s.user,evaluation});
  assert.match(h.entries.render(),/左大臣/);assert.doesNotMatch(h.entries.render(),/太政大臣/);
});
test('recovery, access revalidation, and a campaign still syncing keep self offices hidden',()=>{
  for(const kind of ['recovery','pending','sync']){
    const h=harness(),slot=h.node(A);h.connect();
    if(kind==='recovery')h.transport.setRecovery(true);
    if(kind==='pending')h.transport.setPending(true);
    if(kind==='sync')h.entries.ready(false);
    assert.doesNotMatch(h.entries.render(),/public-court-title/);
    if(kind!=='sync')assert.equal(slot.innerHTML,'');
  }
});
test('no identity, missing office, and administrative flags never invent a court title',()=>{
  const h=harness();h.entries.linked(false);
  assert.doesNotMatch(h.entries.render(),/public-court-title/);
  h.entries.linked(true);h.connect(A,null);
  h.transport.acceptUser({...h.transport.s.user,courtOffice:undefined,isAdmin:true,isStaff:true});
  assert.equal(h.court.selfText(A),'');assert.doesNotMatch(h.entries.render(),/public-court-title/);
  assert.equal(h.court.selfBadge({id:A,courtOffice:chancellor}),'');
});
test('self slots cannot display another player cached office and invalid title/kind pairs are rejected',()=>{
  const h=harness();h.connect();h.court.update({id:B,name:'他の領主',courtOffice:official});
  assert.equal(h.court.selfBadge(B),'');assert.match(h.court.badge(B),/左大臣/);
  for(const office of [{title:'太政大臣',kind:'official'},{title:'<img src=x>',kind:'chancellor'},{title:'運営',kind:'chancellor'}]){
    h.court.update({id:A,name:'現在の領主',courtOffice:office});assert.equal(h.court.selfBadge(A),'');
  }
});
test('sign-out clears mounted self badges and old in-flight public responses stay discarded',()=>{
  const h=harness(),slot=h.node(A);h.connect();const old=h.court.beginRequest();
  h.transport.acceptUser(null);assert.equal(slot.innerHTML,'');assert.equal(h.social.getPublicCourtIdentity(),'');
  h.court.update({id:A,name:'古い領主',courtOffice:chancellor},{requestSequence:old});
  assert.equal(h.court.text(A),'');assert.doesNotMatch(h.entries.render(),/public-court-title/);
});
for(const {name,run} of tests){run();console.log('PASS '+name);}
console.log(`PASS ${tests.length} own court office identity and presentation scenarios`);
