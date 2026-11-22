/* A preserved artwork node must only receive the image from its latest load. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../artwork.js'),'utf8');
const start=source.indexOf('function load(url)'),end=source.indexOf('\nconst backgrounds=',start);
function setup(){
 const requests=[],scope={global:{},observer:null,cache:new Map(),loaded:new Set(),paintRequests:new WeakMap(),Image:class{set src(url){this.url=url;requests.push(this);}}};
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
 for(const officer of roster)for(const rank of ranks){
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
 console.log('PASS 2,048 ranked portraits, exclusive Ieyasu, compact crests and offline fallback identify the displayed variant');
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
