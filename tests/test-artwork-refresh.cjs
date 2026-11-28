/* A preserved artwork node must only receive the image from its latest load. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../artwork.js'),'utf8');
const start=source.indexOf('function load(url)'),end=source.indexOf('\nconst backgrounds=',start);
function setup(){
 const requests=[],scope={global:{},document:{hidden:false},observer:null,cache:new Map(),loaded:new Set(),paintRequests:new WeakMap(),Image:class{set src(url){this.url=url;requests.push(this);}}};
 vm.createContext(scope);vm.runInContext(source.slice(start,end),scope);
 const classes=new Set(),attributes=new Map(),surface={style:{}};
 const el={dataset:{artUrl:'first.webp'},isConnected:true,style:{setProperty(){}},classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),contains:name=>classes.has(name)},closest:()=>null,querySelector:()=>surface,setAttribute:(name,value)=>attributes.set(name,value)};
 return{scope,el,surface,requests,classes,attributes};
}
function portraitRanks(){
 const path=require('node:path'),game=path.join(__dirname,'..'),scope={document:{readyState:'loading',addEventListener(){}}};
 scope.window=scope;vm.createContext(scope);
 vm.runInContext(fs.readFileSync(path.join(game,'officers-data.js'),'utf8'),scope);
 vm.runInContext(source,scope);
 const ranks=scope.SENGOKU_RANKS,roster=scope.SENGOKU_OFFICERS;
 for(const officer of roster)for(const rank of officer.courtNoble||officer.cloisteredReward?[officer.rank]:ranks){
  const html=scope.SengokuArt.portrait({...officer,rank});
  assert(html.includes(`aria-hidden="true">${rank}</b>`));
  assert(html.includes(`${rank}ランク`));
  assert.equal((html.match(/class="portrait-rank-badge"/g)||[]).length,1);
  assert.equal(html.includes('assets/operator-ieyasu-u.webp'),officer.id==='of_b0616adde162'&&rank==='U');
 }
 const app=fs.readFileSync(path.join(game,'app.js'),'utf8');
 const artScope={window:{},data:{ranks},icon:()=>'',esc:String};
 vm.createContext(artScope);
 for(const name of ['portrait','officerCrest'])vm.runInContext(app.split('\n').find(line=>line.startsWith('  function '+name+'(')),artScope);
 for(const rank of ranks){
  const officer={...roster[0],rank};
  for(const html of [artScope.officerCrest(officer),artScope.portrait(officer)]){
   assert(html.includes(`aria-hidden="true">${rank}</b>`));assert(html.includes(`${rank}ランク`));
  }
 }
 assert(!artScope.officerCrest(null).includes('portrait-rank-badge'));
 console.log('PASS 2,048 ordinary ranked portraits, fixed-rank court/reward portraits, exclusive Ieyasu, compact crests and offline fallback identify the displayed variant');
}
function headerIconSlots(){
 const {doc,host,$}=require('./helpers/dom-model.cjs').setup();
 host.innerHTML='<button id="command"><span data-icon="flag"></span>指令</button><button id="magatama" class="button"><span data-icon="magatama"></span>勾玉</button><button id="plain">選ぶ</button>';
 const window={SENGOKU_AT_TITLE:true};
 vm.runInNewContext(source,{window,document:doc});
 window.SengokuArt.decorate();
 assert.equal($('#command').querySelectorAll('svg').length,0);
 assert.equal($('#magatama').querySelectorAll('svg').length,0);
 assert.equal($('#plain').querySelectorAll('svg').length,1);
 for(const id of ['command','magatama'])$('#'+id).querySelector('[data-icon]').innerHTML='<svg class="icon"></svg>';
 window.SengokuArt.decorate();
 for(const id of ['command','magatama','plain'])assert.equal($('#'+id).querySelectorAll('svg').length,1);
 console.log('PASS command and magatama retain a single authored icon before and after game rendering');
}
async function run(){
 {
  const frames=[],document={querySelectorAll:()=>[]},scope={document,decorationRoots:new Set(),scheduled:false,requestAnimationFrame:fn=>frames.push(fn)},draws=[];
  scope.decorate=()=>{scope.scheduled=false;scope.decorationRoots.clear();draws.push('decorate');};
  vm.createContext(scope);
  const from=source.indexOf('function flushDecorations(){'),to=source.indexOf('\nfunction visiblePaints(',from);
  vm.runInContext(source.slice(from,to),scope);
  scope.schedule();scope.schedule();assert.equal(frames.length,1);
  scope.decorate();frames.shift()();assert.equal(draws.length,1,'A direct artwork pass fulfills the already-scheduled pass');
  scope.schedule();frames.shift()();assert.equal(draws.length,2,'Later content changes still decorate');
  console.log('PASS an explicit artwork pass avoids a duplicate queued scan');
 }
 {
  const {doc,host,$}=require('./helpers/dom-model.cjs').setup(),frames=[],draws=[];
  host.innerHTML='<section id="roster"><button id="existing">既存の武将</button></section><section id="changed"><button id="new">新しい操作</button></section><div class="ui-motion-layer"><div class="ui-motion-clip"></div></div>';
  const scope={document:doc,decorationRoots:new Set(),scheduled:false,requestAnimationFrame:fn=>frames.push(fn),decorate:root=>draws.push(root)};
  vm.createContext(scope);const from=source.indexOf('function flushDecorations(){'),to=source.indexOf('\nfunction visiblePaints(',from);vm.runInContext(source.slice(from,to),scope);
  scope.schedule($('#new'));scope.schedule($('#changed'));scope.schedule($('#new'));assert.equal(frames.length,1);frames.shift()();assert.deepEqual(draws,[$('#changed')]);
  draws.length=0;
  scope.artworkMutations([{target:host,addedNodes:[$('#new')],removedNodes:[]}]);frames.shift()();assert.deepEqual(draws,[$('#new')],'Adding a button never rescans the existing roster');
  draws.length=0;
  scope.artworkMutations([{target:$('#new'),addedNodes:[doc.createTextNode('123')],removedNodes:[doc.createTextNode('122')]},{target:host,addedNodes:[$('.ui-motion-layer')],removedNodes:[]},{target:$('.ui-motion-layer'),addedNodes:[$('.ui-motion-clip')],removedNodes:[]}]);
  assert.equal(frames.length,0,'Text updates and decorative click waves must not schedule artwork');
  scope.schedule($('#new'));$('#new').remove();frames.shift()();assert.equal(draws.length,0,'Detached views must not be decorated');
  console.log('PASS artwork batches overlapping changed roots and ignores text, ripples and detached views');
 }
 {
  const {doc,host,$}=require('./helpers/dom-model.cjs').setup();host.innerHTML='<button id="untouched">別の画面</button><button id="added">追加</button>';
  const window={SENGOKU_AT_TITLE:true};vm.runInNewContext(source,{window,document:doc});window.SengokuArt.decorate($('#added'));
  assert.equal($('#added').querySelectorAll('svg').length,1);assert.equal($('#added').dataset.buttonArtEnhanced,'1');
  assert.equal($('#untouched').querySelectorAll('svg').length,0);assert.equal($('#untouched').dataset.buttonArtEnhanced,undefined);
  $('#added').textContent='変更後';window.SengokuArt.decorate($('#added'));assert.equal($('#added').querySelectorAll('svg').length,1,'A replaced button label regains exactly one icon');
  console.log('PASS scoped artwork preserves new buttons and replaced icons without touching unrelated controls');
 }
 {
  const reads=new Map(),make=(id,dataset)=>({id,dataset,getBoundingClientRect(){reads.set(id,(reads.get(id)||0)+1);return{width:80,height:40,top:0,bottom:40,left:0,right:80};}});
  const ready=make('ready',{ghostUrl:'controls.webp',artReady:'1',artSource:'controls.webp'});
  const fresh=make('fresh',{ghostUrl:'controls.webp'});
  const changed=make('changed',{ghostUrl:'new-controls.webp',artReady:'1',artSource:'controls.webp'});
  const portrait=make('portrait',{artUrl:'portrait.webp',artReady:'1',artSource:'portrait.webp'});
  const scope={global:{innerWidth:500,innerHeight:500},document:{querySelectorAll:()=>[ready,fresh,changed,portrait]},canPaint:()=>true};
  vm.createContext(scope);
  const from=source.indexOf('function visiblePaints('),to=source.indexOf('\nasync function readyCurrent(',from);
  vm.runInContext(source.slice(from,to),scope);
  assert.deepEqual(Array.from(scope.visiblePaints({skipReadyControls:true}),item=>item.el.id),['fresh','changed','portrait']);
  assert.equal(reads.get('ready'),undefined,'Reading a cached control image must not force a layout measurement');
  assert.equal(scope.visiblePaints().length,4,'Resize still inspects all visible artwork');
  assert.equal(reads.get('ready'),1);
  console.log('PASS cached controls skip click-time geometry while portraits and changed artwork remain responsive');
 }
 headerIconSlots();
 portraitRanks();
 const thumbDataset={artSmall:'tiny.webp',smallWidth:'80',smallHeight:'107',artNative:'card.webp'};
 {
  const h=setup();Object.assign(h.el.dataset,thumbDataset);
  h.scope.global.devicePixelRatio=2;
  const pending=h.scope.reveal(h.el,{width:36,height:46});
  assert.equal(h.requests[0].url,'tiny.webp');h.requests[0].onload();await pending;
  assert.equal(h.el.dataset.artSheet,'small');
  const larger=h.scope.reveal(h.el,{width:120,height:160});
  assert.equal(h.requests[1].url,'card.webp');assert.equal(h.surface.style.backgroundImage,'url("tiny.webp")');
  h.requests[1].onload();await larger;assert.equal(h.el.dataset.artSheet,'native');
  await h.scope.reveal(h.el,{width:24,height:32});assert.equal(h.requests.length,2);
  assert.equal(h.surface.style.backgroundImage,'url("card.webp")');
  console.log('PASS density, native upgrades and decoded artwork reuse on resize');
 }
 {
  const h=setup();Object.assign(h.el.dataset,thumbDataset);
  const old=h.scope.reveal(h.el,{width:35,height:45});
  h.el.dataset.artSmall='new-tiny.webp';h.requests[0].onload();await old;
  assert.equal(h.surface.style.backgroundImage,undefined);
  const fresh=h.scope.reveal(h.el,{width:35,height:45});
  h.requests[1].onerror();await Promise.resolve();assert.equal(h.requests[2].url,'first.webp');
  h.requests[2].onload();await fresh;assert.equal(h.surface.style.backgroundImage,'url("first.webp")');
  await h.scope.reveal(h.el,{width:35,height:45});assert.equal(h.requests.length,3);
  console.log('PASS changed level in same original atlas cancels obsolete derivative and failed derivative uses original');
 }
 {
  const h=setup();Object.assign(h.el.dataset,thumbDataset);
  h.scope.global.SENGOKU_AT_TITLE=true;await h.scope.reveal(h.el,{width:36,height:46});assert.equal(h.requests.length,0);
  h.el.closest=s=>s.includes('#public-lord-profile')?{}:null;
  const profile=h.scope.reveal(h.el,{width:90,height:120});assert.equal(h.requests[0].url,'card.webp');
  h.requests[0].onload();await profile;assert.equal(h.el.dataset.artReady,'1');
  console.log('PASS title defers hidden game assets while public commander profiles paint');
 }
 {
  const h=setup();Object.assign(h.el.dataset,{artSmall:'rank-preview.webp',smallWidth:'80',smallHeight:'107'});
  const pending=h.scope.reveal(h.el,{width:240,height:320});assert.deepEqual(h.requests.map(r=>r.url),['rank-preview.webp']);
  h.requests[0].onload();await Promise.resolve();assert.equal(h.surface.style.backgroundImage,'url("rank-preview.webp")');
  assert.deepEqual(h.requests.map(r=>r.url),['rank-preview.webp','first.webp']);
  h.requests[1].onload();await pending;assert.equal(h.el.dataset.artSheet,'original');
  const other=setup();Object.assign(other.el.dataset,{artSmall:'camp.webp',smallWidth:'80',smallHeight:'107'});
  const abandoned=other.scope.reveal(other.el,{width:240,height:320});other.el.isConnected=false;
  other.requests[0].onload();await abandoned;assert.equal(other.requests.length,1);
  console.log('PASS rare full-size variants paint before their original and abandoned screens skip its download');
 }
 {
  const h=setup();Object.assign(h.scope.global,{innerWidth:390,innerHeight:844});
  const hidden={top:1100,bottom:1200,left:0,right:70,width:70,height:100};h.el.getBoundingClientRect=()=>hidden;
  h.scope.observePaint(h.el);assert.equal(h.requests.length,0);
  hidden.top=40;hidden.bottom=140;h.scope.observePaint(h.el);assert.equal(h.requests.length,1);
  h.requests[0].onload();await Promise.resolve();
  console.log('PASS browsers without IntersectionObserver also defer offscreen artwork');
 }
 {const h=setup(),first=h.scope.reveal(h.el);h.el.dataset.artUrl='second.webp';delete h.el.dataset.artLoading;const second=h.scope.reveal(h.el);h.requests[0].onload();await first;assert.equal(h.surface.style.backgroundImage,undefined);assert.equal(h.el.dataset.artLoading,'1','Old finally must not clear current request');h.requests[1].onload();await second;assert.equal(h.surface.style.backgroundImage,'url("second.webp")');assert.equal(h.el.dataset.artReady,'1');assert.equal(h.el.dataset.artLoading,undefined);console.log('PASS only latest URL paints and owns loading state');}
 {const h=setup(),first=h.scope.reveal(h.el);h.el.dataset.artUrl='second.webp';delete h.el.dataset.artLoading;const second=h.scope.reveal(h.el);h.requests[1].onload();await second;h.requests[0].onload();await first;assert.equal(h.surface.style.backgroundImage,'url("second.webp")');assert.equal(h.el.dataset.artReady,'1');console.log('PASS late old response never overwrites newer image');}
 {const h=setup(),first=h.scope.reveal(h.el);h.el.dataset.artUrl='second.webp';delete h.el.dataset.artLoading;const second=h.scope.reveal(h.el);h.requests[0].onerror();await first;assert(!h.classes.has('art-error'));assert.equal(h.el.dataset.artLoading,'1');h.requests[1].onload();await second;assert(!h.classes.has('art-error'));console.log('PASS obsolete failure cannot mark current artwork broken');}
 {const h=setup(),first=h.scope.reveal(h.el);h.el.isConnected=false;h.requests[0].onload();await first;assert.equal(h.surface.style.backgroundImage,undefined);assert.equal(h.el.dataset.artReady,undefined);console.log('PASS removed element is not painted');}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
