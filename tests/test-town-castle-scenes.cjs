'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SengokuEngine,SENGOKU_DATA:data}=require('../engine.js');
const {setup}=require('./helpers/dom-model.cjs');
const {fitRect,placeLabels}=require('../town-fit.js');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'app.js'),'utf8');
function fn(name){
  const start=source.indexOf('  function '+name+'(');assert(start>=0,name);
  const first=source.indexOf('\n',start);if(source.slice(start,first).endsWith('}'))return source.slice(start,first);
  const end=source.indexOf('\n  }',start);assert(end>start,name);return source.slice(start,end+4);
}
const {doc,host,$}=setup();
let appearance={town:'castle-heritage',ownedProducts:['castle-heritage']},phase='day';
const context={document:doc,data,settings:{tips:false},currentView:'town',townSection:'town-overview',SENGOKU_DATA:data,
  state:()=>context.game.state,$,icon:()=>'',num:String,esc:value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])),
  SengokuPremiumRuntime:{getAppearance:()=>appearance},SengokuMusic:{daypart:()=>phase},
  // Other dashboard panels are outside this regression; the complete town
  // template, owner resolver, artwork resolver and live art updater are real.
  currentJob:()=>null,premiumTownBanner:()=>'',premiumLord:()=>'',townTabMarkup:()=>'',townPanelAttributes:()=>'',heading:()=>'',castleLevelLimit:()=>32,
  durabilityMarkup:()=>'',governorAssignmentEntry:()=>'',buildingCard:()=>'',walkingEntry:()=>'',staffBaseNotice:()=>'',officerCrest:()=>'',constructionJobs:()=>[],logItems:()=>'',date:()=>({season:'冬'})};
context.window=context;vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root,'premium-catalog.js'),'utf8'),context);
vm.runInContext(fs.readFileSync(path.join(root,'artwork.js'),'utf8'),context);
vm.runInContext(['homeCastleAppearance','townSceneArt','premiumTownBanner','renderTown','refreshTownArt'].map(fn).join('\n'),context);
function select(id){
  context.game=new SengokuEngine({seed:77,startCastle:id,isStaff:id==='kyoto_gosho',isDeputy:id==='kagoshima'});
  host.innerHTML=context.renderTown();
}
for(const [id,name] of [['himeji','姫路城'],['kyoto_gosho','京都御所'],['kagoshima','鹿児島城（鶴丸城）']]){
  for(const selected of [null,'moonlit-castle','sakura-town','snow-town','castle-heritage']){
    if(id==='himeji'&&selected!=='castle-heritage')continue;
    appearance={town:selected,ownedProducts:selected?[selected]:[]};
    for(phase of ['morning','day','night']){
      select(id);const scene=context.SengokuArt.castleScene(id,phase,appearance);
      assert.equal($('[data-town-caption-title]').textContent,name);
      assert.equal($('[data-town-caption-description]').textContent,scene.description);
      assert.equal($('[data-town-scene-type]').textContent,'特別城下町');
      assert.equal($('.town-scene-image').getAttribute('width'),'1536');
      assert.equal($('.town-scene-image').getAttribute('height'),'864');
      assert.equal($('.town-scene').dataset.townScenery,scene.scenery);
      assert.equal($('.town-scene-board').querySelectorAll('.hotspot').length,8);
      if(id!=='kagoshima')assert(!$('.scene-caption').textContent.includes('鹿児島'));
      if(selected&&selected!=='castle-heritage'){
        assert(!$('.town-scene-image').getAttribute('src').includes(selected),'City and Kagoshima imagery takes precedence over an equipped themed town');
        assert.equal($('[data-town-premium-banner]').querySelector('img'),null,'A town cosmetic never becomes a nameplate banner');
      }
    }
  }
}
console.log('PASS real town captions name Himeji, Kyoto and Kagoshima correctly across phases and pre-existing town cosmetics');

appearance={nameplate:'gold-banner',town:'moonlit-castle',ownedProducts:['gold-banner','moonlit-castle']};select('kyoto_gosho');
assert.equal($('[data-town-caption-title]').textContent,'京都御所');
assert.equal($('[data-town-premium-banner] img').getAttribute('src'),context.SengokuPremiumCatalog.getProduct('gold-banner').art.src);
assert.equal($('[data-town-premium-banner] img').getAttribute('alt'),'金彩の旗印');
appearance={nameplate:'moonlit-castle',town:'sakura-town',ownedProducts:['moonlit-castle','sakura-town']};select('kagoshima');
assert.equal($('[data-town-premium-banner]').querySelector('img'),null);
console.log('PASS a separately equipped flag remains a flag and a themed town cannot leak its title into a city or Kagoshima banner');

appearance={town:'castle-heritage',ownedProducts:['castle-heritage']};phase='day';select('himeji');
const board=$('.town-scene-board'),marker=board.querySelector('.hotspot'),front=$('.town-scene-image');
marker.focus();
appearance={town:null,ownedProducts:[]};context.refreshTownArt(true);
assert.equal($('[data-town-caption-title]').textContent,context.game.state.clan+'の城下');
assert.equal($('[data-town-caption-description]').textContent,'人を集め、地を耕し、次の一手を。');
assert.equal($('[data-town-scene-type]').textContent,'城下町');
assert.equal(front.getAttribute('height'),'1024');
assert.equal($('.town-scene').dataset.townScenery,'standard');
appearance={town:'castle-heritage',ownedProducts:['castle-heritage']};context.refreshTownArt(true);
assert.equal($('[data-town-caption-title]').textContent,'姫路城');
assert.equal(front.getAttribute('height'),'864');
phase='night';context.refreshTownArt();
assert.equal($('.town-scene').dataset.townDaypart,'night');
assert.equal($('[data-town-phase-label]').textContent,'夜');
assert.strictEqual($('.town-scene-board'),board);
assert.strictEqual($('.town-scene-image'),front);
assert.strictEqual(board.querySelector('.hotspot'),marker);
assert.strictEqual(doc.activeElement,marker,'Equipment and daylight refresh preserve facility controls and focus');
console.log('PASS ownership revocation, equipment changes and time refresh update all captions in place without replacing facility controls');

for(const id of ['himeji','kyoto_gosho','kagoshima']){
  select(id);
  const anchors=$('.town-scene-board').querySelectorAll('.hotspot').map(marker=>[Number(marker.dataset.townX),Number(marker.dataset.townY)]);
  for(const width of [320,390,540,720,960]){
    const fit=fitRect(width,width*9/16,1536,864);
    assert(Math.abs(fit.width/fit.height-16/9)<1e-10);
    const items=anchors.map(([x,y],i)=>({x:fit.width*x/100,y:fit.height*y/100,width:width<620?66:120,height:width<620?52:32,pinSize:44,above:[3,7].includes(i)}));
    for(const marker of items)assert(marker.x-22>=0&&marker.x+22<=fit.width&&marker.y-22>=0&&marker.y+22<=fit.height,'Every facility retains its full 44px hit area: '+id+' / '+width);
    const labels=placeLabels(items,fit.width,fit.height);
    if(labels.some(label=>label.unplaced)){assert(labels.every(label=>label.unplaced),'Small scenes use the adjacent facility list consistently');continue;}
    for(let i=0;i<labels.length;i++){
      const a=labels[i];
      for(const b of labels.slice(i+1))assert(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top);
      for(const marker of items)assert(a.left+a.width+3.9<=marker.x-22||marker.x+22+3.9<=a.left||a.top+a.height+3.9<=marker.y-22||marker.y+22+3.9<=a.top,'A landscape label cannot cover a facility control');
    }
  }
}
console.log('PASS 16:9 town geometry preserves all eight facility hit areas and keeps labels clear or uses the existing adjacent list');

