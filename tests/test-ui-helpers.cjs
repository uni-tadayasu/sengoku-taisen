const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js');
const officersContext={window:{}};vm.createContext(officersContext);vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../officers-data.js'),'utf8'),officersContext);const roster=officersContext.window.SENGOKU_OFFICERS;
const source=fs.readFileSync(path.resolve(__dirname,'../app.js'),'utf8');
function fn(name){const start=source.indexOf(`  function ${name}(`);assert(start>=0,name);const firstEnd=source.indexOf('\n',start),line=source.slice(start,firstEnd);if(line.endsWith('}'))return line;const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);}
function button(action,id){return{dataset:{action,id},disabled:false};}
function context(game,extra={}){const c={game,data:D,gachaPresentation:null,gachaDrawing:false,saveEnabled:true,skillNames:{},gachaHistoryPage:1,worldCatchingUp:false,startPending:false,worldSettlementPending:false,interactionEpoch:0,interactionRestores:new WeakMap(),currentView:'army',pageControls:()=>'',clanCrest:()=>'',state:()=>c.game.state,resNames:{gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},currentJob:(kind,id)=>c.game.state.jobs.find(j=>j.kind===kind&&j.id===id),hasResources:cost=>D.resources.every(k=>c.game.state.resources[k]>=(cost?.[k]||0)),document:{querySelectorAll:()=>[]},$:()=>null,canMutate:()=>true,mutationActions:new Set(['toggle-time','upgrade','upgrade-castle','claim-quest','draw-officers','recruit-officer','scout','diplomacy','attack','assign-army','remove-army','assign-governor','remove-governor','recruit-troops','train','research','confirm-import','start-new','restore-admin-assets','confirm-admin-castle']),syncAccess:{linked:false,ready:true,writable:true},window:{dispatchEvent:()=>{}},CustomEvent:class{constructor(type){this.type=type;}},...extra};vm.createContext(c);vm.runInContext(["patchHTML","constructionJobs","constructionCount","buildingChain","buildingTailLevel","castleLevelLimit","jobKey","jobDuration","jobClockText","sharedJobAttribution","refreshTouchHeaderStatus"].map(fn).join("\n"),c);return c;}
let checks=0;function test(name,run){run();checks++;console.log(`PASS ${name}`);}
test('costs name each resource and update exact shortfalls when balances change',()=>{
  const {doc,host}=require('./helpers/dom-model.cjs').setup();
  const g=new E({officers:roster,seed:1});g.state.resources.wood=40;g.state.magatama=8;
  const c=context(g,{document:doc,resIcons:{wood:'wood'},icon:()=>'',num:String});
  vm.runInContext(fn('costHtml')+'\n'+fn('refreshLiveControls'),c);
  host.innerHTML=c.costHtml({wood:50,magatama:10,turns:1});
  assert.match(host.textContent,/木材 50（あと10）/);assert.match(host.textContent,/勾玉 10（あと2）/);
  assert.match(host.textContent,/60秒/);
  for(const chip of host.querySelectorAll('[data-cost-resource]'))chip.classList.toggle=(name,active)=>active?chip.classList.add(name):chip.classList.remove(name);
  g.state.resources.wood=50;g.state.magatama=5;c.refreshLiveControls();
  assert.equal(host.querySelector('[data-cost-resource="wood"] [data-cost-shortage]').textContent,'');
  assert.equal(host.querySelector('[data-cost-resource="magatama"] [data-cost-shortage]').textContent,'（あと5）');
});
test('actual touch header tolerates absent markup and hides provisional balances before starting',()=>{
  const c=context(new E({officers:roster,seed:1}));assert.doesNotThrow(()=>c.refreshTouchHeaderStatus());
  const summary={hidden:false};c.$=selector=>selector==='#touch-header-status'?summary:null;c.startPending=true;c.state=()=>{throw Error('provisional balances must not be read');};
  assert.doesNotThrow(()=>c.refreshTouchHeaderStatus());assert.equal(summary.hidden,true);
});
test('actual touch header follows live and synced balances, command limits and accessible labels without replacing controls',()=>{
  const make=()=>{let text='';const attributes=new Map();return{hidden:true,writes:0,get textContent(){return text;},set textContent(value){text=String(value);this.writes++;},getAttribute:key=>attributes.get(key)??null,setAttribute(key,value){attributes.set(key,String(value));this.writes++;},set innerHTML(value){throw Error('header controls must stay mounted');}};};
  const ids=['touch-header-status','touch-command-count','touch-command-limit','touch-command-info','touch-magatama-balance','touch-magatama-info'],nodes=Object.fromEntries(ids.map(id=>[id,make()])),pageBalance=make(),game=new E({officers:roster,seed:1});let maximum=6;
  game.commandMax=()=>maximum;game.state.command=2;game.state.magatama=1234;
  const c=context(game,{num:value=>Math.floor(Number(value)||0).toLocaleString('ja-JP'),canMutate:()=>false,$:selector=>nodes[selector.slice(1)]||null,document:{querySelectorAll:selector=>selector==='[data-magatama-balance]'?[nodes['touch-magatama-balance'],pageBalance]:[]}});vm.runInContext(fn('refreshLiveControls'),c);
  const check=(command,limit,magatama)=>{assert.equal(nodes['touch-header-status'].hidden,false);assert.equal(nodes['touch-command-count'].textContent,command);assert.equal(nodes['touch-command-limit'].textContent,limit);assert.equal(nodes['touch-magatama-balance'].textContent,magatama);assert.equal(pageBalance.textContent,magatama);assert.equal(nodes['touch-command-info'].getAttribute('aria-label'),`指令 ${command} / ${limit}。共通時間を確認`);assert.equal(nodes['touch-magatama-info'].getAttribute('aria-label'),`勾玉 ${magatama}。武将招集を開く`);};
  c.refreshLiveControls();check('2','6','1,234');
  game.state.command=0;game.state.magatama=0;maximum=12;c.refreshLiveControls();check('0','12','0');
  c.game=new E({officers:roster,seed:2});c.game.state.command=4;c.game.state.magatama=4321;c.game.commandMax=()=>14;c.refreshLiveControls();check('4','14','4,321');
  const writes=ids.map(id=>nodes[id].writes);c.refreshTouchHeaderStatus();assert.deepEqual(ids.map(id=>nodes[id].writes),writes);
  c.startPending=true;c.refreshLiveControls();assert.equal(nodes['touch-header-status'].hidden,true);c.startPending=false;c.refreshLiveControls();check('4','14','4,321');
});
test('actual world-clock processing renders the applied resource state and still refreshes read-only headers',()=>{
  const game=new E({officers:roster,seed:1}),clock={running:true,speed:1,calendar:{cycle:0,elapsed:0}},snapshots=[];let applies=0,writable=true;
  game.state.resources.gold=1;game.state.command=0;game.applyWorldClock=()=>{applies++;game.state.resources.gold=50;game.state.command=3;return{ok:true};};
  const c=context(game,{worldCatchupTimer:null,worldClockStatusKey:'true:true:1:0',activeModal:'',window:{SengokuWorldClock:{snapshot:()=>({ready:true,clock,message:'共通時間'})}},confirmedWorldClock:()=>clock,canMutate:()=>writable,renderHeader:()=>snapshots.push({gold:game.state.resources.gold,command:game.state.command}),refreshJobTimers:()=>{}});vm.runInContext(fn('refreshLiveControls')+'\n'+fn('processWorldClock'),c);
  c.processWorldClock();assert.equal(applies,1);assert.deepEqual(snapshots,[{gold:50,command:3}]);
  writable=false;game.state.resources.gold=75;c.processWorldClock();assert.equal(applies,1);assert.deepEqual(snapshots,[{gold:50,command:3},{gold:75,command:3}]);
  c.document.hidden=true;c.processWorldClock();assert.equal(applies,1);assert.equal(snapshots.length,2);
  c.document.hidden=false;writable=true;let fullRedraws=0;c.render=()=>{fullRedraws++;c.renderHeader();};c.refreshActiveModal=()=>{};c.syncMusic=()=>{};c.preserveInteraction=(_host,draw)=>draw();
  game.applyWorldClock=()=>({ok:true,monthChanged:true});c.processWorldClock();assert.equal(fullRedraws,1);assert.equal(snapshots.length,3,'a monthly redraw must not repeat the ordinary header pass');
});
test('actual live controls re-enable exactly at command refill and resource threshold',()=>{const game=new E({officers:roster,seed:1}),upgrade=button('upgrade','farm'),train=button('train'),c=context(game,{document:{querySelectorAll:q=>q==='[data-action]'?[upgrade,train]:[]}});vm.runInContext(fn('refreshLiveControls'),c);game.state.command=0;c.refreshLiveControls();assert(upgrade.disabled&&train.disabled);for(let i=0;i<19;i++)game.tick(1);c.refreshLiveControls();assert(upgrade.disabled);game.tick(1);c.refreshLiveControls();assert(!upgrade.disabled&&!train.disabled);game.state.resources.gold=game.costs('farm').gold-1;c.refreshLiveControls();assert(upgrade.disabled);game.tick(1);c.refreshLiveControls();assert(!upgrade.disabled);});
test('actual recruitment control rejects capacity and retains entered amount',()=>{const game=new E({officers:roster,seed:1}),recruit=button('recruit-troops'),input={value:'20000'},c=context(game,{$:selector=>selector==='#recruit-amount'?input:null,document:{querySelectorAll:q=>q==='[data-action]'?[recruit]:[]}});vm.runInContext(fn('refreshLiveControls'),c);c.refreshLiveControls();assert(recruit.disabled);input.value='100';c.refreshLiveControls();assert(!recruit.disabled);assert.equal(input.value,'100');game.state.resources.rice=0;c.refreshLiveControls();assert(recruit.disabled);});
test('forty paused job refreshes leave the live label, tooltip and progress alone until the clock advances',()=>{
  const game=new E({officers:roster,seed:1});game.upgrade('farm');game.tick(5);game.setRunning(false);
  const clock={dataset:{jobClock:'building:farm'}},bar={dataset:{jobProgress:'building:farm'},style:{}};
  const changes={textContent:0,title:0,width:0};
  function countWrites(object,property){
    let value='';
    Object.defineProperty(object,property,{get:()=>value,set(next){changes[property]++;value=String(next);}});
  }
  countWrites(clock,'textContent');countWrites(clock,'title');countWrites(bar.style,'width');
  const c=context(game,{document:{querySelectorAll:q=>q==='[data-job-clock]'?[clock]:q==='[data-job-progress]'?[bar]:[]}});
  vm.runInContext(fn('refreshJobTimers'),c);
  c.refreshJobTimers();
  assert.deepEqual(changes,{textContent:1,title:1,width:1});assert.match(clock.textContent,/停止中/);assert.equal(bar.style.width,'8.333%');
  for(let i=0;i<40;i++)c.refreshJobTimers();
  assert.deepEqual(changes,{textContent:1,title:1,width:1});
  game.setRunning(true);game.tick(1);c.refreshJobTimers();
  assert.match(clock.textContent,/経過 6秒/);assert.equal(bar.style.width,'10%');assert.deepEqual(changes,{textContent:2,title:1,width:2});
});
test('actual job clocks and progress follow speed, pause and completion',()=>{const game=new E({officers:roster,seed:1});game.upgrade('farm');game.tick(5);const clock={dataset:{jobClock:'building:farm'}},bar={dataset:{jobProgress:'building:farm'},style:{}},c=context(game,{document:{querySelectorAll:q=>q==='[data-job-clock]'?[clock]:q==='[data-job-progress]'?[bar]:[]}});vm.runInContext(fn('jobDuration')+'\n'+fn('jobClockText')+'\n'+fn('refreshJobTimers'),c);c.refreshJobTimers();assert.equal(clock.textContent,'経過 5秒 / 1分00秒 · あと 55秒');assert(Number.parseFloat(bar.style.width)>8);game.setSpeed(2);c.refreshJobTimers();assert.equal(clock.textContent,'経過 5秒 / 1分00秒 · あと 28秒（2倍速）');game.setRunning(false);c.refreshJobTimers();assert(clock.textContent.includes('停止中'));game.setRunning(true);for(let i=0;i<28;i++)game.tick(1);c.refreshJobTimers();assert.equal(clock.textContent,'完成');assert.equal(bar.style.width,'100%');});
test('actual gift bridge rolls resources, receipt and log back if persistence fails',()=>{const game=new E({officers:roster,seed:1}),before=JSON.stringify(game.state);let renders=0;const c=context(game,{saveEnabled:true,save:()=>false,renderHeader:()=>{},refreshLiveControls:()=>{},preserveInteraction:()=>{renders++;},refreshActiveModal:()=>{},render:()=>{}});vm.runInContext(fn('applyDurableGift'),c);const result=c.applyDurableGift({gold:100},'test-save-failure');assert.equal(result.ok,false);assert.equal(result.retryable,true);assert.equal(JSON.stringify(game.state),before);assert.equal(renders,0);c.save=()=>true;assert(c.applyDurableGift({gold:100},'test-save-failure').ok);assert.equal(game.state.giftReceipts.length,1);assert.equal(renders,1);const gold=game.state.resources.gold;assert(c.applyDurableGift({gold:100},'test-save-failure').already);assert.equal(game.state.resources.gold,gold);});
test('actual save returns false on browser storage failure, including guarded mode',()=>{let storageCalls=0;const game=new E({officers:roster,seed:1}),indicator={},c=context(game,{saveEnabled:true,saveKey:'test',saveWarning:'',lastLocalSaveRaw:null,lastLocalSaveGame:null,localStorage:{getItem:()=>null,setItem:()=>{storageCalls++;throw Error('QuotaExceededError');}},toast:()=>{},$:()=>indicator});vm.runInContext(fn('changedLocalCampaign')+'\n'+fn('save'),c);assert.equal(c.save(),false);assert.equal(c.saveEnabled,false);assert.equal(c.save(),false);assert.equal(storageCalls,1);});
test('actual gacha bridge rolls currency, roster, history and RNG back on save failure',()=>{const game=new E({officers:roster,seed:42}),before=JSON.stringify(game.state);const c=context(game,{saveEnabled:true,save:()=>false,renderHeader:()=>{},refreshLiveControls:()=>{},preserveInteraction:()=>{},render:()=>{}});vm.runInContext(fn('drawDurableOfficers'),c);const failure=c.drawDurableOfficers(10);assert.equal(failure.ok,false);assert.equal(failure.retryable,true);assert.equal(JSON.stringify(game.state),before);c.save=()=>true;const result=c.drawDurableOfficers(10);assert(result.ok);assert.equal(result.results.length,10);assert.equal(game.state.magatama,300+result.refund);assert.equal(game.state.stats.gachaDraws,10);});
test('actual gacha buttons follow balance and block guarded saves',()=>{const game=new E({officers:roster,seed:1}),single={...button('draw-officers'),dataset:{action:'draw-officers',count:'1'}},ten={...button('draw-officers'),dataset:{action:'draw-officers',count:'10'}},c=context(game,{saveEnabled:true,document:{querySelectorAll:q=>q==='[data-action]'?[single,ten]:[]}});vm.runInContext(fn('refreshLiveControls'),c);game.state.magatama=299;c.refreshLiveControls();assert(single.disabled&&ten.disabled);game.state.magatama=300;c.refreshLiveControls();assert(!single.disabled&&ten.disabled);game.state.magatama=2700;c.refreshLiveControls();assert(!single.disabled&&!ten.disabled);c.saveEnabled=false;c.refreshLiveControls();assert(single.disabled&&ten.disabled);});
test('sixty clock samples update visible balances and countdown without reparsing markup or evaluating the whole roster',()=>{
  const {doc,host}=require('./helpers/dom-model.cjs').setup();
  const game=new E({officers:roster,seed:1}),clock={calendar:{elapsed:0,turn:0},speed:1,running:true};
  host.innerHTML='<div id="resources"></div><div id="calendar"></div><div id="clan-panel"></div><button id="sound-button"></button>';
  let scores=0,templates=0;const create=doc.createElement.bind(doc);
  doc.createElement=name=>{if(name==='template')templates++;return create(name);};
  const c=context(game,{document:doc,$:q=>doc.querySelector(q),resIcons:{},num:String,esc:String,icon:()=>'<svg></svg>',
    getEvaluation:()=>{scores++;return game.evaluation();},refreshEvaluationUI:()=>{},evaluationEntry:()=>'',
    date:()=>({year:1560,month:1,season:'冬'}),clanInfo:()=>({leader:'織田信長'}),settings:{sound:false},activeModal:'',
    window:{SengokuWorldClock:{snapshot:()=>({ready:true,mode:'shared',clock})},SengokuStableDOM:require('../stable-dom.js')}});
  vm.runInContext(fn('renderHeader'),c);c.renderHeader();
  const calendar=doc.querySelector('#month-countdown'),balance=doc.querySelector('#header-balance-gold'),sound=doc.querySelector('#sound-button');
  sound.focus();const scoresAtStart=scores,templatesAtStart=templates;
  for(let second=0;second<60;second++){
    game.state.resources.gold=100+second;clock.calendar.elapsed=second;c.renderHeader(true);
    assert.equal(balance.textContent,String(100+second));assert.equal(calendar.textContent,String(60-second));
  }
  assert.equal(scores,scoresAtStart);assert.equal(templates,templatesAtStart);
  assert.equal(doc.querySelector('#month-countdown'),calendar);assert.equal(doc.querySelector('#header-balance-gold'),balance);assert.equal(doc.activeElement,sound);
  game.state.resources.gold=3;clock.running=false;clock.speed=2;c.renderHeader();
  assert.equal(balance.textContent,'3');assert.match(doc.querySelector('#calendar').textContent,/停止中/);
  assert.equal(doc.querySelector('#month-countdown').textContent,'1');assert.equal(scores,scoresAtStart+1);
  c.startPending=true;c.renderHeader();assert.equal(doc.querySelector('#header-balance-gold'),null);
  c.startPending=false;c.renderHeader();assert.equal(doc.querySelector('#header-balance-gold').textContent,'3');
});
test('an expanded 31-level construction queue uses one projection for all clocks and progress bars',()=>{
  const game=new E({officers:roster,seed:1}),clocks=[],bars=[];
  for(let level=2;level<=32;level++){
    const key='building:farm:personal:'+level;clocks.push({dataset:{jobClock:key}});bars.push({dataset:{jobProgress:key},style:{}});
    game.state.jobs.push({kind:'building',id:'farm',targetLevel:level,totalSeconds:60,remainingSeconds:level===2?40:60});
  }
  clocks.push({dataset:{jobClock:'building:farm'}});bars.push({dataset:{jobProgress:'building:farm:shared:2'},style:{}});
  const projection=game.constructionJobs.bind(game);let calls=0;game.constructionJobs=()=>{calls++;return projection();};
  const c=context(game,{document:{querySelectorAll:q=>q==='[data-job-clock]'?clocks:bars}});vm.runInContext(fn('refreshJobTimers'),c);
  c.refreshJobTimers();assert.equal(calls,1);assert.equal(clocks.at(-1).textContent,clocks[0].textContent);
  assert.match(clocks[1].textContent,/着工まで 40秒/);assert.equal(bars[0].style.width,'33.333%');assert.equal(bars[1].style.width,'0%');assert.equal(bars.at(-1).style.width,'100%');
  game.state.jobs.shift();c.refreshJobTimers();assert.equal(calls,2);assert.equal(clocks[0].textContent,'完成');assert.match(clocks[1].textContent,/経過 0秒/);
});
test('the archive highest-rank index reflects gains and permission changes without repeated collection scans',()=>{
  const game=new E({officers:roster,seed:1});
  game.state.officers=roster.map(o=>o.id);game.state.officerVariants=roster.flatMap(o=>D.ranks.map(rank=>o.id+':'+rank));
  const expected=new Map(roster.map(base=>[base.id,game.officer(base.id).rank]));
  const includes=game.state.officerVariants.includes.bind(game.state.officerVariants);let lookups=0;
  Object.defineProperty(game.state.officerVariants,'includes',{value:(...args)=>{lookups++;return includes(...args);}});
  const filter={q:'',rank:'all',ownership:'owned',sort:'lead'},c=context(game,{roster,filter});
  vm.runInContext(fn('filterOfficerList')+'\n'+fn('filteredOfficers'),c);
  const all=c.filteredOfficers();assert.equal(all.length,roster.length);assert(all.every(o=>o.rank===expected.get(o.id)));
  assert(lookups<=roster.length+8,`unexpected duplicate ownership lookups: ${lookups}`);
  const key=D.adminAssets.officerId;assert.equal(all.find(o=>o.id===key).rank,'SSS');
  const ordinary=roster.find(o=>o.id!==key);game.state.officerVariants=game.state.officerVariants.filter(variant=>variant!==ordinary.id+':U');
  assert.equal(c.filteredOfficers().find(o=>o.id===ordinary.id).rank,'SSS');
  game._grantOfficerVariant(ordinary.id,'U');assert.equal(c.filteredOfficers().find(o=>o.id===ordinary.id).rank,'U');
});
test('actual gacha screen and odds include all8 ranks and all256 officers',()=>{const game=new E({officers:roster,seed:1});let captured;const c=context(game,{roster,gachaOddsRank:'D',gachaOddsPage:1,num:v=>String(v),esc:v=>String(v),icon:name=>`[${name}]`,shortDate:()=>'',modal:(...args)=>{captured=args;}});vm.runInContext(fn('renderGacha')+'\n'+fn('gachaOfficerOddsRows')+'\n'+fn('individualOddsPage')+'\n'+fn('gachaOddsModal'),c);let html=c.renderGacha();assert.equal((html.match(/class="gacha-rank rank-/g)||[]).length,8);assert(html.includes('data-count="1"'));assert(html.includes('data-count="10"'));assert(html.includes('2700'));assert(html.includes('現金の支払いはありません'));c.gachaOddsModal();const body=captured[2];assert.equal((body.match(/<tr>/g)||[]).length,20);assert(body.includes('ランク別・対象武将の個別提供割合'));assert(body.includes('確定枠・天井'));assert.equal(captured[4],'gacha-odds');});
test('actual preservation helper restores typed inputs, focus, caret, scroll and matching recruit cost',()=>{const game=new E({officers:roster,seed:1});let input,search,fields,focusCount=0;const body={id:'test-modal-body',scrollTop:20},dialog={scrollTop:31},cost={innerHTML:''},doc={activeElement:null,getElementById:id=>[...fields,body].find(f=>f.id===id)};const win={scrollX:0,scrollY:180,scrollTo:p=>{win.scrollX=p.left;win.scrollY=p.top;}};const make=(id,value)=>({id,value,checked:false,type:'text',dataset:{},selectionStart:2,selectionEnd:4,focus(){doc.activeElement=this;focusCount++;},setSelectionRange(a,b){this.selectionStart=a;this.selectionEnd=b;}});input=make('recruit-amount','2300');search=make('officer-search','伊達 政宗');fields=[input,search];doc.activeElement=search;const container={scrollTop:44,contains:el=>fields.includes(el)||el===body,querySelectorAll:q=>q==='input,select,textarea'?fields:q==='*'?[...fields,body]:[],querySelector:q=>q==='.modal-body'?body:null};const c=context(game,{window:win,document:doc,$:q=>q==='#modal'?dialog:q==='#recruit-amount'?input:q==='#recruit-cost'?cost:null,costHtml:value=>JSON.stringify(value),refreshLiveControls:()=>{},refreshJobTimers:()=>{}});vm.runInContext(fn('interactionLocator')+'\n'+fn('locateInteraction')+'\n'+fn('preserveInteraction'),c);c.preserveInteraction(container,()=>{input=make('recruit-amount','1000');search=make('officer-search','');search.selectionStart=0;search.selectionEnd=0;fields=[input,search];doc.activeElement=null;container.scrollTop=0;body.scrollTop=0;dialog.scrollTop=0;win.scrollY=0;});assert.equal(input.value,'2300');assert.equal(search.value,'伊達 政宗');assert.equal(doc.activeElement,search);assert.equal(search.selectionStart,2);assert.equal(search.selectionEnd,4);assert.equal(focusCount,1);assert.equal(container.scrollTop,44);assert.equal(body.scrollTop,20);assert.equal(dialog.scrollTop,31);assert.equal(win.scrollY,180);assert.equal(cost.innerHTML,JSON.stringify(game.recruitTroopCost(2300)));});

test('actual gallery shows all256 officers at each selected rank and highest-owned by default',()=>{const game=new E({officers:roster,seed:1}),filter={q:'',clan:'all',ownership:'all',sort:'lead',rank:'all',page:1},c=context(game,{roster,filter});vm.runInContext(fn('filterOfficerList')+'\n'+fn('filteredOfficers'),c);for(const rank of D.ranks){filter.rank=rank;const list=c.filteredOfficers();assert.equal(list.length,256);assert(list.every(o=>o.rank===rank));assert.equal(new Set(list.map(o=>o.id)).size,256);}const id=roster[70].id;game._grantOfficerVariant(id,'U');filter.rank='all';assert.equal(c.filteredOfficers().find(o=>o.id===id).rank,'U');filter.rank='D';filter.ownership='owned';assert(c.filteredOfficers().every(o=>game.ownsVariant(o.id,'D')));});
test('actual result cards use drawn rank even when a higher rank is already owned',()=>{const game=new E({officers:roster,seed:1}),id=roster[61].id;game._grantOfficerVariant(id,'U');let ranks=[];const c=context(game,{num:v=>String(v),icon:n=>n,modal:()=>{},playNote:()=>{},officerCard:o=>{ranks.push(o.rank);return o.rank;}});vm.runInContext(fn('gachaResult'),c);c.gachaResult({results:[{officerId:id,rank:'D',isNew:true,isNewOfficer:false,upgraded:false,duplicateRefund:0}],newCount:1,newOfficerCount:0,refund:0,cost:300});assert.deepEqual(ranks,['D']);assert.equal(game.officer(id).rank,'U');});
test('actual detail renders eight rank tabs and explicit unowned-rank preview',()=>{const game=new E({officers:roster,seed:1}),id=roster[54].id;game._grantOfficerVariant(id,'U');let captured,drawn;const c=context(game,{esc:v=>String(v),icon:n=>n,skillNames:{},skillIcons:{},skillDescriptions:{},costHtml:()=>'',portrait:o=>{drawn=o.rank;return '<figure></figure>';},modal:(...args)=>{captured=args;}});vm.runInContext(fn('officerModal'),c);c.officerModal(id,'D');assert.equal(drawn,'D');assert.equal((captured[2].match(/data-action="officer-rank-detail"/g)||[]).length,8);assert(captured[2].includes('最高所持ランク：U'));assert(captured[2].includes('未所持の絵巻'));assert.equal(captured[5].rank,'D');});
test('individual odds exclude operator-only Ieyasu U for normal players',()=>{const game=new E({officers:roster,seed:1}),c=context(game,{roster,esc:v=>String(v)});vm.runInContext(fn('gachaOfficerOddsRows'),c);for(const rank of D.ranks){const html=c.gachaOfficerOddsRows(rank);const count=rank==='U'?255:256;assert.equal((html.match(/<tr>/g)||[]).length,count);assert.equal((html.match(new RegExp(`class="rank-${rank}"`,'g'))||[]).length,count);assert(html.includes((D.gacha.rates.find(r=>r.rank===rank).rate/count).toFixed(4)+'%'));if(rank==='U')assert(!html.includes('徳川家康'));}});
test('castle upgrade controls share facility slots and display completion timers and actual level',()=>{const game=new E({officers:roster,seed:1}),upgrade=button('upgrade-castle',game.state.home),c=context(game,{num:v=>String(v),esc:v=>String(v),icon:n=>n,window:{SengokuArt:{castle:()=>'<figure></figure>'}},costHtml:()=>'',document:{querySelectorAll:q=>q==='[data-action]'?[upgrade]:[]}});vm.runInContext(fn('refreshLiveControls')+'\n'+fn('castleDetail'),c);c.refreshLiveControls();assert(!upgrade.disabled);game.upgrade('farm');game.upgrade('market');c.refreshLiveControls();assert(upgrade.disabled);for(let i=0;i<12;i++)game.tick(5);c.refreshLiveControls();assert(!upgrade.disabled);game.upgradeCastle(game.state.home);let html=c.castleDetail(game.state.home);assert(html.includes(`data-job-clock="castle:${game.state.home}:personal:2"`));assert(html.includes('Lv.1 / 32'));assert(html.includes('data-action="preview-art"'));});
test('all32 castle and facility illustration previews pass exact level and never alter gameplay',()=>{const game=new E({officers:roster,seed:1}),before=JSON.stringify(game.state);let calls=[];const c=context(game,{icon:n=>n,window:{SengokuArt:{castle:(id,cls,level)=>{calls.push(['castle',id,level]);return'<figure></figure>';},facility:(id,cls,level)=>{calls.push(['facility',id,level]);return'<figure></figure>';}}},modal:()=>{}});vm.runInContext(fn('artPreviewModal'),c);for(let level=1;level<=32;level++){c.artPreviewModal('castle',game.state.home,level);c.artPreviewModal('facility','farm',level);}assert.equal(calls.length,64);for(let i=0;i<32;i++){assert.equal(calls[i*2][2],i+1);assert.equal(calls[i*2+1][2],i+1);}assert.equal(JSON.stringify(game.state),before);});

test('both Tokugawa searches find the same variants and rendered rank labels use ordinary spelling',()=>{
  const id='of_b0616adde162';
  for(const isAdmin of [false,true]){const game=new E({officers:roster,seed:1,isAdmin}),filter={q:'',clan:'all',ownership:'all',sort:'lead',rank:'U',page:1},c=context(game,{roster,filter,esc:v=>String(v)});vm.runInContext(fn('filterOfficerList')+'\n'+fn('filteredOfficers')+'\n'+fn('gachaOfficerOddsRows'),c);
    for(const rank of ['U','SSS','D']){filter.rank=rank;for(const query of ['徳川','德川','徳川家康','德川家康']){filter.q=query;const found=c.filteredOfficers().find(o=>o.id===id);assert(found,query+' '+rank);assert.equal(found.name,rank==='U'?'德川家康':'徳川家康');assert.equal(found.clan,rank==='U'?'德川家':'徳川家');}}
    const ordinaryOdds=c.gachaOfficerOddsRows('SSS');assert(ordinaryOdds.includes('徳川家康'));assert(!ordinaryOdds.includes('德川家康'));const exclusiveOdds=c.gachaOfficerOddsRows('U');assert.equal(exclusiveOdds.includes('徳川家康'),isAdmin);assert(!exclusiveOdds.includes('德川家'));
  }
  assert(source.includes('徳川家康 U を復元'));assert(!source.includes('德川家康 U を復元'));
});

console.log(`${checks} real UI helper checks passed against256 officers,2048 variants and32 castle levels.`);
