/* Real engine evaluations through the app's read-only controls and identity gate. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),UI=require('../player-evaluation.js');
const source=fs.readFileSync(require.resolve('../app.js'),'utf8'),assets={window:{}};
vm.runInNewContext(fs.readFileSync(require.resolve('../officers-data.js'),'utf8'),assets);
const roster=assets.window.SENGOKU_OFFICERS,plain=value=>JSON.parse(JSON.stringify(value));
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const lineEnd=source.indexOf('\n',start),end=source.slice(start,lineEnd).endsWith('}')?lineEnd:source.indexOf('\n  }',start)+4;assert(end>start,name);return source.slice(start,end);}
function harness({linked=false,pending=false,game=new E({officers:roster,seed:17})}={}){
  const handlers=new Map(),storage=new Map(),writes=[],classes=new Set(),calls={queued:0,renders:0};let user={id:'player-a',name:'領主A'};
  class Node{
    constructor(){this.attrs=new Map();this.dataset={};this.hidden=false;this.textContent='';this.buttons=[];this._html='';}
    getAttribute(name){return this.attrs.get(name)||null;}
    setAttribute(name,value){this.attrs.set(name,String(value));}
    get innerHTML(){return this._html;}
    set innerHTML(value){
      this._html=value;this.buttons=[...value.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map(match=>{const node=new Node();node._html=match[2];for(const attr of match[1].matchAll(/([\w-]+)(?:="([^"]*)")?/g))node.attrs.set(attr[1],attr[2]??'');node.dataset.action=node.attrs.get('data-action');return node;});
      const details=/<details\b[^>]*id="player-evaluation-ranks"([^>]*)>/.exec(value);this.details=details?{open:/\bopen\b/.test(details[1])}:null;
    }
    closest(selector){return selector.split(',').some(part=>{const attr=/^\[([\w-]+)\]/.exec(part);return attr&&this.attrs.has(attr[1]);})?this:null;}
    insertAdjacentHTML(_position,value){this.innerHTML+=value;}
  }
  const names=['main','modal','modal-content','calendar','resources','clan-panel','sound-button','save-indicator','touch-header-status','touch-command-count','touch-command-limit','touch-command-info','touch-magatama-balance','touch-magatama-info'];
  const nodes=Object.fromEntries(names.map(name=>[name,new Node()]));
  const dialog=nodes.modal;dialog.open=false;dialog.showModal=()=>{dialog.open=true;};dialog.close=()=>{dialog.open=false;};dialog.classList={toggle(name,on){if(on)classes.add(name);else classes.delete(name);}};
  const buttons=()=>Object.values(nodes).flatMap(node=>node.buttons);
  const c={game,roster,staffBaseId:'kyoto_gosho',data:D,SengokuEngine:E,state:()=>c.game.state,console,Date,Number,String,JSON,Math,Set,
    syncAccess:{linked,ready:!linked,writable:!linked,rolePending:pending},evaluationOwnerId:'',startPending:false,activeModal:'',activeModalContext:null,gachaPresentation:null,settings:{sound:false},worldCatchingUp:false,renderedSyncBanner:'',lastRealtime:0,saveCounter:0,saveKey:'save',saveEnabled:true,saveWarning:'',staffBaseReady:false,pendingRoleSave:null,selectedCastle:'',importedGame:null,
    document:{addEventListener:(name,handler)=>handlers.set(name,handler),querySelectorAll:selector=>selector==='[data-player-evaluation-self]'?buttons().filter(node=>node.attrs.has('data-player-evaluation-self')):selector==='[data-action]'?buttons():[]},
    $:selector=>selector==='#player-evaluation-ranks'?nodes['modal-content'].details:nodes[selector.slice(1)]||null,
    window:{SengokuEvaluationUI:UI,SengokuSocial:{getUser:()=>user?{...user}:null}},performance:{now:()=>100},
    localStorage:{getItem:key=>storage.get(key)||null,setItem(key,value){storage.set(key,value);writes.push(key);}},
    esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),num:value=>Math.floor(Number(value)||0).toLocaleString('ja-JP'),icon:()=>'',clanCrest:()=>'',resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},resIcons:{},
    clearGachaPresentation(){},syncMusic(){},refreshLiveControls(){},refreshJobTimers(){},syncBanner:()=>'',canMutate:()=>!c.syncAccess.linked||c.syncAccess.ready&&c.syncAccess.writable&&!c.syncAccess.rolePending,requireWritable:()=>false,queueWorldProgress(){calls.queued++;},backupCurrentSave(){},updateBattlePreview(){},preserveInteraction:(_node,draw)=>draw(),render(){calls.renders++;c.renderHeader();}
  };
  vm.createContext(c);
  const declaration=source.slice(source.indexOf('  const mutationActions='),source.indexOf('\n',source.indexOf('  const mutationActions=')));
  vm.runInContext([declaration,...['patchHTML','date','clanInfo','getEvaluation','evaluationCourtPlayer','evaluationCourtSlot','evaluationDescription','evaluationEntryContent','evaluationEntry','evaluationModalKey','refreshEvaluationUI','showEvaluation','modal','closeModal','refreshTouchHeaderStatus','economyNumber','economyBalanceTitle','refreshEconomyPanels','renderHeader','heading','refreshActiveModal','setSyncAccess','trustedBranchAuthority','applyBranchAuthority','trustedMaintenanceAuthority','applyMaintenanceAuthority','trustedCourtProtection','applyCourtProtection','trustedCourtEstateProjection','applyCloudSave','applyStaffBase','constructionJobs','jobKey','jobDuration','jobClockText','sharedJobAttribution','jobsHtml'].map(fn)].join('\n'),c);
  const start=source.indexOf("  document.addEventListener('click',async event=>"),end=source.indexOf("  document.addEventListener('input'",start);vm.runInContext(source.slice(start,end),c);
  function draw(){c.renderHeader();nodes.main.innerHTML=c.heading('城下町','CASTLE TOWN','領国を育てる');}
  async function click(action){const node=buttons().find(node=>node.dataset.action===action);assert(node,action);await handlers.get('click')({target:node});}
  return{c,nodes,dialog,classes,writes,storage,calls,draw,click,setUser(value){user=value;},html:()=>nodes['modal-content'].innerHTML};
}
let checks=0;async function test(name,run){await run();checks++;console.log('PASS '+name);}
(async()=>{
await test('shared badges accept full and compact DTOs without fabricating unknown ranks or interactive controls',()=>{
  const game=new E({officers:roster,seed:7}),evaluation=game.evaluation(),compact=Object.fromEntries(['version','score','maxScore','rankId','rankName','rankIndex'].map(key=>[key,evaluation[key]]));
  assert.equal(UI.badge(evaluation),UI.badge(compact));assert(UI.badge(compact).startsWith('<span '));assert(!/<(?:button|a)\b|tabindex|data-action/.test(UI.badge(compact)));assert(UI.label(compact).includes('点'));assert.equal(UI.key(evaluation),UI.key(compact));assert.notEqual(UI.key({...compact,score:compact.score+1}),UI.key(compact));
  for(const value of [null,undefined,{}, {...compact,version:2},{...compact,score:NaN},{...compact,score:100001},{...compact,rankIndex:-1},{...compact,rankName:''}])for(const render of [UI.badge,UI.label,UI.key])assert.equal(render(value),'');
  const hostile={...compact,rankId:'court-0" data-x="<&',rankName:'<位階 & "称号">'};const html=UI.badge(hostile);assert(!html.includes('<位階'));assert(!html.includes(' data-x="'));assert(html.includes('&lt;位階 &amp; &quot;称号&quot;&gt;'));assert(UI.label(hostile).startsWith(hostile.rankName),'plain labels must not contain HTML entity encoding');
});
await test('unlinked local play opens all seven scores and seventeen ranks through actual controls without saving or granting rights',async()=>{
  const h=harness(),before=JSON.stringify(h.c.game.state);h.setUser({id:'unconfirmed-new-account',name:'まだ未確認の名前'});h.draw();
  assert(h.nodes['clan-panel'].innerHTML.includes('data-action="player-evaluation"'));assert(h.nodes.main.innerHTML.includes('data-action="player-evaluation"'));await h.click('player-evaluation');
  assert(h.dialog.open);assert(h.classes.has('player-evaluation-modal'));assert(!h.html().includes('まだ未確認の名前'));assert.equal((h.html().match(/data-evaluation-category=/g)||[]).length,7);assert.equal((h.html().match(/<li(?: |>|\b)/g)||[]).length,17);assert(h.html().includes('下がることも'));assert(h.html().includes('所持資源・残兵・消費額・発言数は点数に含めません'));assert(!/運営|スタッフ/.test(h.html()),'Public rank guidance does not advertise management roles');assert(h.html().includes('次の位階'));assert(h.html().indexOf('</section>')<h.html().indexOf('<footer class="modal-footer">'));
  await h.click('close');assert(!h.dialog.open);assert.equal(JSON.stringify(h.c.game.state),before);assert.equal(h.writes.length,0);assert.equal(h.c.game.isAdmin,false);
});
await test('rank details show the current monthly food bonus and every documented promotion rate',()=>{
  const h=harness();h.c.game.state.prestige=20000;h.c.showEvaluation();const evaluation=h.c.game.evaluation(),bonus=h.c.game.income().rankRiceBonus,html=h.html();
  assert(html.includes(`data-rank-rice-bonus="percent">+${bonus.percent}%`));assert(html.includes(`data-rank-rice-bonus="amount">${h.c.economyNumber(bonus.amount,'gross')}`));
  assert.equal((html.match(/class="player-evaluation-rank-bonus"/g)||[]).length,17);
  for(const rank of D.evaluationRanks)assert(html.includes(`兵糧 +${rank.riceBonusPercent}%`));
  assert(html.includes(`${evaluation.nextRank.name}で兵糧 +${evaluation.nextRank.riceBonusPercent}%`));
  assert(html.includes('維持費と余剰生産の調整を行う前'));assert(html.includes('備蓄や報酬は増えません'));assert(html.includes('昇格・降格すると加算率も変わります'));
});
await test('identity switching hides the previous campaign until the new user and save are both confirmed',async()=>{
  const h=harness({linked:true,pending:true});h.draw();assert.equal(h.c.getEvaluation(),null);await h.click('player-evaluation');assert(!h.html().includes('data-evaluation-category='));
  h.c.setSyncAccess({rolePending:false,ready:true,writable:true});const first=h.c.getEvaluation();assert(first);assert(h.html().includes('領主A'));
  h.setUser({id:'player-b',name:'領主B'});assert.equal(h.c.getEvaluation(),null,'a new username cannot label an old ready campaign');h.c.refreshEvaluationUI();assert(!h.html().includes('領主A'));assert(!h.html().includes('領主B'));assert(!h.html().includes('data-evaluation-category='));
  h.c.setSyncAccess({linked:true,ready:false,writable:false,rolePending:true});const replacement=new E({officers:roster,clan:'武田家',seed:31});replacement.state.prestige=18000;replacement.state.stats.wins=40;replacement.state.stats.battles=40;
  assert(h.c.applyCloudSave(JSON.parse(replacement.exportSave()),{reason:'initial'}).ok);assert.equal(h.c.getEvaluation(),null,'loading a save alone is not a completed session');assert(!h.html().includes('data-evaluation-category='));
  h.c.setSyncAccess({ready:true,writable:false,rolePending:false});const second=h.c.getEvaluation();assert.equal(second.score,h.c.game.evaluation().score);assert.notEqual(first.score,second.score);assert(h.html().includes('領主B'));assert(h.html().includes('武田家'));assert(!h.html().includes('領主A'));
  h.setUser({id:'player-a',name:'領主A'});assert.equal(h.c.getEvaluation(),null,'switching back also requires a confirmed session');h.c.refreshEvaluationUI();assert(!h.html().includes('領主B'));
});
await test('verified followers and temporary offline sessions can read current scores while pending roles or missing identity cannot',()=>{
  const h=harness({linked:true});h.c.setSyncAccess({ready:true,writable:false,rolePending:false});assert(h.c.getEvaluation());
  h.c.setSyncAccess({ready:true,writable:false,reason:'offline'});assert(h.c.getEvaluation());h.c.showEvaluation();assert(h.html().includes('最新の保存を同期した後'));
  h.c.setSyncAccess({rolePending:true});assert.equal(h.c.getEvaluation(),null);assert(!h.html().includes('data-evaluation-category='));
  h.c.setSyncAccess({rolePending:false});h.setUser(null);assert.equal(h.c.getEvaluation(),null);h.c.refreshEvaluationUI();assert(!h.html().includes('data-evaluation-category='));
});
await test('live score changes preserve expanded rank guidance and never modify formations or persist a read',()=>{
  const h=harness();h.draw();h.c.showEvaluation();h.nodes['modal-content'].details.open=true;const original=h.html();h.c.refreshEvaluationUI();assert.equal(h.html(),original,'unchanged evaluations do not rebuild the open reading pane');
  h.c.game.state.prestige=20000;h.c.game.state.stats.wins=100;h.c.game.state.stats.battles=100;const before=JSON.stringify(h.c.game.state);h.c.refreshEvaluationUI();assert.notEqual(h.html(),original);assert(h.nodes['modal-content'].details.open);assert(h.html().includes('15,000'));assert(h.nodes.main.buttons.find(node=>node.dataset.action==='player-evaluation').innerHTML.includes(h.c.game.evaluation().rankName));
  h.c.game.state.prestige=0;h.c.refreshActiveModal();assert(h.nodes['modal-content'].details.open);assert.equal(h.writes.length,0);const expected=JSON.parse(before);expected.prestige=0;assert.deepEqual(plain(h.c.game.state),expected);
});
await test('fixed touch header keeps its four resource and two action cells while the narrow desktop keeps a page entry',()=>{
  const h=harness();h.draw();assert.equal((h.nodes.resources.innerHTML.match(/class="resource(?:\s|")/g)||[]).length,4);assert(!h.nodes.resources.innerHTML.includes('player-evaluation'));assert(!h.nodes.calendar.innerHTML.includes('player-evaluation'));assert(!h.nodes['touch-header-status'].innerHTML.includes('player-evaluation'));
  assert.equal(h.nodes['touch-command-count'].textContent,String(h.c.game.state.command));assert.equal(h.nodes['touch-magatama-balance'].textContent,h.c.num(h.c.game.state.magatama));assert(h.nodes.main.innerHTML.includes('data-player-evaluation-self'),'the heading entry remains available when the desktop hides its clan panel');
  const css=fs.readFileSync(require.resolve('../player-evaluation.css'),'utf8');assert(!/\.topbar\b|#resources\b|#touch-header-status\b/.test(css),'evaluation styles cannot alter fixed-header geometry');assert(/\.player-evaluation-entry\s*\{[^}]*flex-wrap:\s*wrap[^}]*max-width:\s*100%/.test(css));assert(/\.player-evaluation-rank-list\s*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(css),'rank guidance must collapse to one column on a phone');
  h.c.startPending=true;h.c.renderHeader();assert.equal(h.c.getEvaluation(),null);assert(h.nodes['touch-header-status'].hidden);assert(!h.nodes['clan-panel'].innerHTML.includes('player-evaluation'));assert(h.nodes.main.buttons.find(node=>node.dataset.action==='player-evaluation').hidden);
});
await test('shared construction shows each confirmed actor rank while preserving queue clocks, escaping names and hiding private identifiers',()=>{
  const h=harness(),g=h.c.game,evaluation={version:1,score:60000,maxScore:100000,rankId:'court-11',rankName:'従三位',rankIndex:11};
  h.c.window.SengokuPremiumRuntime=require('../premium-runtime.js');const appearance={ownedProducts:['gold-banner','moonlit-castle','supporter']};
  g.setRoleAccess({isStaff:true});g.state.turn=0;g.state.realtime.elapsed=0;
  const buildings={...g.state.buildings,farm:5,keep:8},base={id:'kyoto_gosho',revision:1,castleLevel:6,buildings,initial:{castleLevel:6,buildings:{...buildings}},history:[],updatedElapsedMs:0,accessSinceElapsedMs:0,jobs:[
    {jobId:'shared-a',kind:'building',id:'farm',targetLevel:6,totalSeconds:60,startedElapsedMs:0,completesElapsedMs:60000,startedBy:{id:'PRIVATE-ACTOR-A',name:'<staff>',evaluation,appearance}},
    {jobId:'shared-b',kind:'building',id:'farm',targetLevel:7,totalSeconds:120,startedElapsedMs:60000,completesElapsedMs:180000,startedBy:{id:'PRIVATE-ACTOR-B',name:'担当二',evaluation}}
  ]};
  assert(h.c.applyStaffBase(base).ok);const before=JSON.stringify(g.state),jobs=g.constructionJobs(),html=h.c.jobsHtml();
  assert.equal((html.match(/class="player-evaluation-badge"/g)||[]).length,2);assert(html.includes('従三位'));assert(html.includes('&lt;staff&gt;'));assert(!html.includes('<staff>'));assert(!html.includes('PRIVATE-ACTOR-'));assert(html.includes('が着手'));assert(html.includes('が予約'));assert.equal((html.match(/data-premium-product=/g)||[]).length,3);
  for(const job of jobs){assert(html.includes(`data-job-clock="${h.c.jobKey(job)}"`));assert(html.includes(h.c.jobClockText(job)));}
  assert.equal(h.c.sharedJobAttribution({...jobs[0],shared:false}),'');assert(!h.c.sharedJobAttribution({...jobs[0],startedBy:{name:'旧記録'}}).includes('player-evaluation-badge'));assert.equal(JSON.stringify(g.state),before);assert.equal(h.writes.length,0);
  const next=plain(base);next.jobs[0].startedBy.evaluation={...evaluation,score:70000,rankId:'court-12',rankName:'正三位',rankIndex:12};next.jobs[0].startedBy.appearance={ownedProducts:[]};const queued=h.calls.queued,renders=h.calls.renders;
  const updated=h.c.applyStaffBase(next);assert(updated.ok&&updated.changed&&updated.displayOnly);assert(h.c.jobsHtml().includes('正三位'));assert(!h.c.jobsHtml().includes('data-premium-product='),'Revoked purchases disappear from current construction attribution');assert.equal(h.calls.renders,renders+1,'updated actor metadata redraws its attribution');assert.equal(h.calls.queued,queued,'display metadata must not request another world-clock advance');assert.equal(JSON.stringify(g.state),before);assert.equal(h.writes.length,0);
});
console.log(`${checks} player evaluation UI checks passed. No external requests.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
