'use strict';
const assert = require('node:assert/strict');
const {fitRect, labelRect, placeLabels, createLabelLayout, sceneHeight, panelSceneHeight} = require('../town-fit.js');
const kamon = require('../kamon.js');
const points = [[39,27],[24,76],[51,62],[87,41],[86,79],[17,44],[68,43],[57,27]];
let cases = 0;
for (const width of [240, 290, 320, 375, 480, 681, 900, 1400]) {
  for (const height of [160, 240, 400, 600, 1000]) {
    const fit = fitRect(width, height);
    assert(Math.abs(fit.width / fit.height - 1.5) < 1e-9);
    assert(fit.left >= 0 && fit.top >= 0);
    assert(fit.left + fit.width <= width + 1e-8 && fit.top + fit.height <= height + 1e-8);
    assert(Math.abs(fit.width - width) < 1e-8 || Math.abs(fit.height - height) < 1e-8, 'The uncropped image uses all of one available dimension');
    for (const [px, py] of points) {
      const x = fit.width * px / 100, y = fit.height * py / 100;
      const label = labelRect(x, y, fit.width, fit.height, 125, 28, 44, px === 57 || px === 87);
      assert(label.left >= 5 && label.top >= 5);
      assert(label.left + label.width <= fit.width - 5 + 1e-8);
      assert(label.top + label.height <= fit.height - 5 + 1e-8);
      assert(Math.abs(x - 22 + label.relativeLeft - label.left) < 1e-8);
      assert(Math.abs(y - 22 + label.relativeTop - label.top) < 1e-8);
    }
    cases++;
  }
}
assert.deepEqual(fitRect(0, 0), {width:0, height:0, left:0, top:0});
// The actual 1364×766 QA fixture put the artwork at y=411.656 in a main
// viewport ending at y=726. Its former fixed 374px height clipped the bottom.
const initial = sceneHeight(374, 593, 411.656 - 133, 20);
assert(initial < 374);
assert(411.656 + initial <= 726 - 20);
assert.equal(sceneHeight(374, 593, (411.656 - 120) - 133 + 120, 20), initial, 'Scroll position cannot change the image height');
assert.equal(sceneHeight(500, 593, 278.656, 20), initial, 'A saved drag height is capped to the viewport after resize or zoom');
assert.equal(sceneHeight(160, 593, 278.656, 20), 160, 'A smaller explicit drag height stays the user choice');
assert.equal(sceneHeight(500, 1000, 120, 20), 500, 'The saved preference can expand again when space returns');
for (const [height, offset] of [[400, 180], [230, 63], [160, 63], [100, 53]]) {
  const chosen = sceneHeight(240, height, offset, 10);
  assert(chosen > 0 && chosen <= 240);
  assert(offset + chosen <= height - 10, 'Short/zoomed desktop art stays above the main viewport bottom');
  const fitted = fitRect(540, chosen); assert(fitted.height <= chosen);
}
// The PC town and its console now share the full main-pane height. A long
// construction queue, status message or Lv.64 title cannot shrink the scene.
for(const geometry of [
  {width:822,panel:569,heading:42,caption:0},
  {width:1326,panel:902,heading:42,caption:0},
  {width:779,panel:422,heading:42,caption:0},
  {width:345,panel:244,heading:42,caption:0},
  {width:290,panel:216,heading:64,caption:0}
]){
  const {width,panel,heading,caption}=geometry,available=panel-heading-caption;
  const height=panelSceneHeight(panel,heading,caption),fit=fitRect(width,height);
  assert.equal(height,available,'Uncustomized PC canvas consumes the full available height');
  assert(fit.width<=width+1e-8&&fit.height<=available+1e-8,'The entire source image remains contained');
  assert(Math.abs(fit.width-width)<1e-8||Math.abs(fit.height-available)<1e-8,'No artificial preferred height leaves avoidable empty space');
  assert.equal(panelSceneHeight(panel,heading,caption,10000),available,'An oversized saved drag height is capped');
  assert.equal(panelSceneHeight(panel,heading,caption,100),Math.min(100,available),'A smaller height remains adjustable');
}
const largerTown=fitRect(822,panelSceneHeight(569,42,0));
assert(largerTown.width>=790&&largerTown.height>=527,'1366×768 geometry has a much larger complete town');
assert(largerTown.width*largerTown.height>3*(438*292),'Artwork area exceeds three times the previous 438×292 result');
assert.equal(panelSceneHeight(569,60,0),509,'Long labels and larger system text use their actual measured height');
assert.equal(panelSceneHeight(0,42,0),1,'Hidden or not-yet-sized panels remain finite');
// Labels must avoid every icon, not only other labels. Include the actual
// lower-left field and top-center academy, both reported overlapping on PC.
for(const width of [290,307.5,339,400,440,480,570,619,620,705,819]){
  const height=width/1.5,compact=width<620;
  const items=points.map(([x,y],i)=>({x:width*x/100,y:height*y/100,width:compact?66:120,height:compact?52:32,pinSize:44,above:[3,7].includes(i)}));
  const labels=placeLabels(items,width,height);assert.equal(labels.length,8);
  if(labels.some(label=>label.unplaced)){
    assert(labels.every(label=>label.unplaced),'Use the adjacent facility list consistently when the illustration is too small');
    assert(width<440,'Ordinary compact PC artwork must retain its on-picture names and levels');
    continue;
  }
  for(let i=0;i<labels.length;i++){
    const a=labels[i];assert(a.left>=5&&a.top>=5);assert(a.left+a.width<=width-5+1e-8&&a.top+a.height<=height-5+1e-8);
    for(const b of labels.slice(i+1))assert(a.left+a.width<=b.left||b.left+b.width<=a.left||a.top+a.height<=b.top||b.top+b.height<=a.top,'Facility labels cannot cover each other at '+width+'px');
    for(const marker of items){const b={left:marker.x-22,top:marker.y-22,width:44,height:44};assert(a.left+a.width+3.9<=b.left||b.left+b.width+3.9<=a.left||a.top+a.height+3.9<=b.top||b.top+b.height+3.9<=a.top,'A label must not cover any facility icon at '+width+'px');}
  }
}
assert.equal(kamon.url('德川家'), kamon.url('徳川家'));
assert.match(kamon.render('德川家'), /aria-label="徳川家：/);
assert.equal(kamon.render('德川家'),kamon.render('徳川家'),'Public clan labels must not distinguish verified roles');
assert.match(kamon.render('徳川家'), /aria-label="徳川家：/);

// Repeated observer notifications can reuse geometry, while every input that
// can move a label must still run the original, unchanged collision solver.
{
  const vm=require('node:vm');let solves=0;
  const create=vm.runInNewContext('('+createLabelLayout.toString()+')', {placeLabels:(...args)=>{solves++;return placeLabels(...args);}});
  const layout=create(),width=819,height=width/1.5;
  const items=points.map(([x,y],i)=>({x:width*x/100,y:height*y/100,width:120,height:32,pinSize:44,above:[3,7].includes(i)}));
  const plain=value=>JSON.parse(JSON.stringify(value));
  const expected=placeLabels(items,width,height),first=layout(items,width,height);
  assert.deepEqual(plain(first),expected);assert.equal(solves,1);
  for(let n=0;n<100;n++)assert.deepEqual(plain(layout(items.map(item=>({...item})),width,height)),expected);
  assert.equal(solves,1,'Identical geometry from repeated layout/resize notifications must solve once');
  first[0].left=-999;
  assert.deepEqual(plain(layout(items,width,height)),expected,'Callers cannot corrupt a reused placement');
  const variations=[
    {width:width+1,height,items}, {width,height:height+1,items},
    ...['x','y','width','height','pinSize'].map(key=>({width,height,items:items.map((item,i)=>i?item:{...item,[key]:item[key]+1})})),
    {width,height,items:items.map((item,i)=>i?item:{...item,above:!item.above})},
    {width,height,items:[...items].reverse()}, {width,height,items:items.slice(0,-1)}
  ];
  for(const [index,input]of variations.entries()){
    assert.deepEqual(plain(layout(input.items,input.width,input.height)),placeLabels(input.items,input.width,input.height));
    assert.equal(solves,index+2,'Changed size, font metrics, coordinate, pin, placement or facility set must invalidate');
  }
  assert.deepEqual(plain(create()(items,width,height)),expected);
  assert.equal(solves,variations.length+2,'A replacement scene receives a fresh layout cache');
}

// The live updater must constrain all labels before measuring any one of
// them, and must apply positions again when the scene DOM is replaced.
{
  const fs=require('node:fs'),vm=require('node:vm');
  const frames=[],events=[];let current;
  const style=label=>{const values=new Map();return {getPropertyValue:key=>values.get(key)||'',setProperty(key,value){values.set(key,value);if(label&&key==='max-width')events.push('write:'+label);},removeProperty:key=>values.delete(key)};};
  const attrs=()=>{const names=new Set();return{hasAttribute:name=>names.has(name),toggleAttribute(name,value){if(value)names.add(name);else names.delete(name);}};};
  function makeScene(count=8){
    const labels=[],markers=points.slice(0,count).map(([x,y],i)=>{
      const label={style:style(String(i)),getBoundingClientRect(){events.push('read:'+i);return{width:120,height:32};}};labels.push(label);
      return{dataset:{townX:x,townY:y,id:i===3?'lumber':i===7?'academy':'other'},offsetWidth:44,querySelector:()=>label};
    });
    const board={style:style(),querySelector:()=>({naturalWidth:1536,naturalHeight:1024}),querySelectorAll:()=>markers,setAttribute(){}};
    const scene={...attrs(),style:style(),isConnected:true,clientWidth:819,clientHeight:546,querySelector:()=>board,closest:()=>null};
    return{scene,board,labels};
  }
  current=makeScene();
  const main={querySelector:()=>current.scene,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){}};
  const doc={readyState:'complete',getElementById:()=>main,documentElement:{classList:{contains:()=>false}}};
  const win={document:doc,requestAnimationFrame:callback=>{frames.push(callback);return frames.length;},cancelAnimationFrame(){},addEventListener(){},removeEventListener(){}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../town-fit.js'),'utf8'),{window:win});
  frames.shift()();
  assert.deepEqual(events.slice(0,8),Array.from({length:8},(_,i)=>'write:'+i));
  assert.deepEqual(events.slice(8),Array.from({length:8},(_,i)=>'read:'+i),'All width writes precede all geometry reads');
  for(const label of current.labels)assert(label.style.getPropertyValue('--town-label-left'));
  events.length=0;current=makeScene(7);win.SengokuTownFit.refresh();frames.shift()();
  assert.equal(events.filter(event=>event.startsWith('write:')).length,7);
  for(const label of current.labels)assert(label.style.getPropertyValue('--town-label-left'),'New scene nodes receive positions even when their dimensions match old nodes');
  events.length=0;const replacement=makeScene(6);current.scene.querySelector=()=>replacement.board;
  win.SengokuTownFit.refresh();frames.shift()();
  assert.equal(events.filter(event=>event.startsWith('write:')).length,6);
  for(const label of replacement.labels)assert(label.style.getPropertyValue('--town-label-left'),'A replaced board inside a retained scene also receives fresh positions');
}
console.log(`PASS ${cases} town fit/label geometries, eight labels avoiding every facility icon or an explicit compact-list fallback, full-height PC canvas, drag limits, zero-size startup, uniform public Tokugawa crest labels, unchanged-layout reuse and batched geometry reads.`);
