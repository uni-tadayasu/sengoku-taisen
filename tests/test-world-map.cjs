const assert=require('node:assert/strict');
const M=require('../world-map.js');
let count=0;
function test(name,fn){fn();count++;console.log('PASS '+name);}
const near=(actual,expected,tolerance=1e-8)=>assert(Math.abs(actual-expected)<tolerance,`${actual} is not near ${expected}`);
test('real longitude/latitude round-trip through north-up Web Mercator',()=>{
  for(const point of [[139.7547,35.6852],[135.5259,34.6873],[130.5576,31.6008],[140.463,40.607],[123,24],[145.8,45.5]]){
    const xy=M.project(...point),actual=M.unproject(...xy);near(actual[0],point[0]);near(actual[1],point[1]);
  }
  const origin=M.project(135,36);near(origin[0],0);near(origin[1],0);
  assert(M.project(135,37)[1]<M.project(135,36)[1]);
  assert(M.project(136,36)[0]>M.project(135,36)[0]);
  assert(M.project(135,90).every(Number.isFinite));
});
test('GeoJSON coastline rings and holes retain their exact topology',()=>{
  const polygon={type:'Polygon',coordinates:[[[135,35],[136,35],[136,36],[135,35]],[[135.2,35.2],[135.3,35.2],[135.2,35.3],[135.2,35.2]]]};
  const path=M.geometryPath(polygon);assert.equal((path.match(/M/g)||[]).length,2);assert.equal((path.match(/Z/g)||[]).length,2);
  assert.equal(M.geometryPath({type:'Feature',properties:{name:'Japan'},geometry:polygon}),path);
  assert.equal(M.geometryPath({type:'FeatureCollection',features:[{type:'Feature',geometry:polygon}]}),path);
  assert.equal(M.geometryPath({type:'LineString',coordinates:[[135,35],[136,36]]}).includes('Z'),false);
  assert.equal(M.geometryPath({type:'Point',coordinates:[135,35]}),'');
});
test('fit bounds keeps all geography visible with the viewport aspect ratio',()=>{
  const bounds=M.projectBounds([122,24,149,46]);
  for(const [width,height]of [[1000,650],[360,520]]){
    const view=M.fitBounds(bounds,width,height,24);near(view.width/view.height,width/height);
    assert(view.x<=bounds.x&&view.y<=bounds.y);
    assert(view.x+view.width>=bounds.x+bounds.width&&view.y+view.height>=bounds.y+bounds.height);
  }
});
test('wheel/pinch zoom retains the geographic point below the gesture',()=>{
  const view={x:25,y:-650,width:1000,height:600},anchor=[173,412];
  const after=M.zoomAt(view,.4,anchor,1000,600);
  near(view.x+view.width*anchor[0]/1000,after.x+after.width*anchor[0]/1000);
  near(view.y+view.height*anchor[1]/600,after.y+after.height*anchor[1]/600);
});
test('markers require supplied real coordinates and enforce Edo role access',()=>{
  const castles=[{id:'edo',name:'江戸城',owner:'徳川家'},{id:'osaka',name:'大坂城',owner:'豊臣家'},{id:'missing',name:'未確認',x:42,y:35}];
  const coords={edo:{lon:139.7547,lat:35.6852},osaka:{lon:135.5259,lat:34.6873}};
  const ordinary=M.castlePoints(castles,coords,{clan:'徳川家',isAdmin:false,selectedId:'osaka',homeId:'edo'});
  assert.equal(ordinary.length,2);assert(ordinary[0].disabled);assert(ordinary[0].own&&ordinary[0].home);assert(ordinary[1].selected);
  near(ordinary[0].x,M.project(139.7547,35.6852)[0]);
  assert.equal(M.castlePoints(castles,coords,{isAdmin:true})[0].disabled,false);
  assert.equal(M.castlePoints(castles,{missing:{lon:0,lat:0}},{}).length,0);
});
test('clustering retains every castle and selected/home positions stay exact',()=>{
  const points=Array.from({length:20},(_,i)=>({id:'c'+i,name:'城'+i,x:100+i*2,y:100+i,selected:i===0,home:i===1}));
  const view={x:0,y:0,width:500,height:500};
  const markers=M.layoutMarkers(points,view,500,500);
  assert.equal(markers.flatMap(m=>m.points).length,20);
  assert.equal(new Set(markers.flatMap(m=>m.points.map(p=>p.id))).size,20);
  for(const id of ['c0','c1']){const marker=markers.find(m=>m.key===id);assert(marker&&!marker.cluster);near(marker.sx,points.find(p=>p.id===id).x);}
  assert(markers.some(m=>m.cluster));
  assert.equal(M.layoutMarkers(points,view,500,500,{distance:0}).length,20);
});
test('Kyoto palace is reserved for staff and shared field selection is independent of attack permission',()=>{
  const castles=[{id:'kyoto_gosho',name:'京都御所',owner:'織田家',level:128}],coords={kyoto_gosho:{lon:135.762144,lat:35.024098}};
  const point=options=>M.castlePoints(castles,coords,options)[0];
  assert.equal(point({}).disabled,true);assert.equal(point({}).restrictedLabel,'選択不可');
  assert.equal(point({isAdmin:true}).disabled,true);assert.equal(point({isStaff:true}).disabled,false);
  assert.equal(point({isStaff:true,isAdmin:true}).disabled,true,'Operator Edo takes precedence over staff flags');
  assert.equal(point({allowRestrictedSelection:true}).disabled,false,'Public field markers remain inspectable');
  assert.equal(point({isStaff:true}).level,128);
});
test('dense chains never merge distant provinces into one unbounded cluster',()=>{
  const points=Array.from({length:50},(_,i)=>({id:'chain'+i,name:'城'+i,x:40+i*12,y:200}));
  const markers=M.layoutMarkers(points,{x:0,y:0,width:800,height:400},800,400,{distance:27});
  assert.equal(markers.flatMap(m=>m.points).length,50);assert(markers.length>=16);
  for(const marker of markers)for(const a of marker.points)for(const b of marker.points)assert(Math.hypot(a.sx-b.sx,a.sy-b.sy)<27);
});
test('ordinary castle labels do not overlap other chosen label boxes',()=>{
  const points=Array.from({length:8},(_,i)=>({id:'p'+i,name:'テスト城'+i,x:100+i*65,y:200+(i%2)*60}));
  const markers=M.layoutMarkers(points,{x:0,y:0,width:800,height:600},800,600,{distance:0});
  const boxes=markers.filter(m=>m.label).map(m=>({x:m.sx+m.label.x,y:m.sy+m.label.y,width:m.label.width,height:m.label.height}));
  assert(boxes.length>=4);
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i],b=boxes[j];assert(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));}
});
test('castle artwork is opt-in and clusters or views without a callback keep their normal symbols',()=>{
  const marker={name:'清洲城',owner:'あなたの本拠',home:true,level:32,keepLevel:4},normal=M.markerPresentation(marker);
  assert.equal(normal.custom,false);assert(normal.html.includes('<svg'));assert(normal.label.includes('Lv.32'));
  let calls=0;const options={markerAppearance:m=>{calls++;return{html:`<span data-keep="${m.keepLevel}">castle</span>`,label:'清洲城 天守 Lv.'+m.keepLevel};}};
  const appearance=M.markerPresentation(marker,options);assert.equal(appearance.custom,true);assert.equal(appearance.label,'清洲城 天守 Lv.4');assert(appearance.html.includes('data-keep="4"'));
  const updated=M.markerPresentation({...marker,keepLevel:32},options);assert(updated.html.includes('data-keep="32"'));assert.notEqual(updated.html,appearance.html);
  const clustered=M.markerPresentation({cluster:true,points:[{name:'清洲城'},{name:'岐阜城'}]},options);assert.equal(clustered.custom,false);assert.equal(clustered.html,'<b>2</b>');assert.equal(calls,2);
  assert.equal(M.markerPresentation(marker,{markerAppearance:()=>{throw Error('missing art');}}).html,normal.html);
  assert.equal(M.markerPresentation(marker,{markerAppearance:()=>null}).html,normal.html);
});
test('larger shared castle symbols reserve enough room for map labels',()=>{
  const points=Array.from({length:8},(_,i)=>({id:'p'+i,name:'城'+i,x:100+i*80,y:210+(i%2)*90}));
  const markers=M.layoutMarkers(points,{x:0,y:0,width:800,height:600},800,600,{distance:0,markerSize:48});
  const boxes=markers.filter(m=>m.label).map(m=>({x:m.sx+m.label.x,y:m.sy+m.label.y,width:m.label.width,height:m.label.height}));
  assert(boxes.length>=4);
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  for(const label of boxes)for(const marker of markers)assert(!overlaps(label,{x:marker.sx-24,y:marker.sy-24,width:48,height:48}));
  assert.equal(markers.flatMap(m=>m.points).length,8,'Artwork size must not lose any castle');
});
test('selected and home labels never cover castle artwork in the narrow Kiyosu home view',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),scope={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../map-data.js'),'utf8'),scope);
  const geography=scope.SENGOKU_GEOGRAPHY,{SENGOKU_DATA:data}=require('../engine.js'),width=341,height=520;
  const points=M.castlePoints(data.castles.map(c=>({...c,owner:c.clan,level:c.id==='kiyosu'?32:1})),geography.castles,{clan:'織田家',homeId:'kiyosu',selectedId:'kannonji'});
  const home=points.find(p=>p.id==='kiyosu'),base=M.fitBounds(M.projectBounds(geography.bounds),width,height,28);
  // Match the real map's initial "本拠へ" camera. Kannonji is west of Kiyosu,
  // and its old forced label covered the home castle's image and level badge.
  const view={x:home.x-base.width/28,y:home.y-base.height/28,width:base.width/14,height:base.height/14};
  const overlaps=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
  for(const markerSize of [56,48]){
    const markers=M.layoutMarkers(points,view,width,height,{markerSize,distance:markerSize+4});
    for(const id of ['kiyosu','kannonji']){
      const marker=markers.find(m=>m.id===id),point=points.find(p=>p.id===id);assert(marker&&!marker.cluster);
      near(marker.sx,(point.x-view.x)/view.width*width);near(marker.sy,(point.y-view.y)/view.height*height);
      assert(M.markerPresentation(marker).label.includes(marker.name),'A hidden visual label keeps the accessible castle name');
    }
    for(const marker of markers.filter(m=>m.label)){
      const label={x:marker.sx+marker.label.x,y:marker.sy+marker.label.y,width:marker.label.width,height:marker.label.height};
      for(const other of markers){
        const size=other.cluster?36:markerSize;
        assert(!overlaps(label,{x:other.sx-size/2,y:other.sy-size/2,width:size,height:size}),`${markerSize}px ${marker.name} label must not cover ${other.name||other.key}`);
      }
    }
  }
});
test('map scale uses latitude-correct ground distance and useful metric units',()=>{
  const view={x:-500,y:-300,width:1000,height:600},scale=M.scaleForView(view,1000);
  near(scale.latitude,36);assert(scale.pixels>20&&scale.pixels<=100);assert(scale.label.endsWith(' km'));
  const expectedPerPixel=6378137*Math.PI/180*Math.cos(36*Math.PI/180)/100;
  near(scale.meters/scale.pixels,expectedPerPixel,1e-7);
});
test('the shipped geography provides all 129 actual castle positions and offline terrain',()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),scope={};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../map-data.js'),'utf8'),scope);
  const geography=scope.SENGOKU_GEOGRAPHY,{SENGOKU_DATA:data}=require('../engine.js');
  const points=M.castlePoints(data.castles,geography.castles,{clan:'織田家'});
  assert.equal(points.length,129);assert.equal(new Set(points.map(p=>p.id)).size,129);assert.equal(geography.prefectures.features.length,47);
  const coast=M.geometryPath(geography.land);assert(coast.length>10000);assert(!coast.includes('NaN'));assert.equal(geography.terrain.kind,'color');assert(fs.existsSync(path.join(__dirname,'..',geography.terrain.url)));
  const bounds=M.projectBounds(geography.bounds),view=M.fitBounds(bounds,800,400,28),markers=M.layoutMarkers(points,view,800,400);
  assert.equal(markers.flatMap(m=>m.points).length,129);assert(markers.length>8,'Japan must retain regional detail at its initial overview');
  assert(markers.every(m=>m.points.length<32),'no cluster should span most of the country');
});
test('camera-only redraws reuse routes while fresh ownership, access and regional data invalidate them',()=>{
  const fs=require('node:fs'),vm=require('node:vm'),{setup,Node}=require('./helpers/dom-model.cjs'),{doc,host}=setup();
  if(!Object.getOwnPropertyDescriptor(Node.prototype,'lastElementChild'))Object.defineProperty(Node.prototype,'lastElementChild',{get(){return [...this.childNodes].reverse().find(node=>node.nodeType===1)||null;}});
  let visits=0,stamp=0,frameId=0;const frames=new Map(),neighbors=ids=>({*[Symbol.iterator](){visits++;yield* ids;}});
  const castles=[
    {id:'a',name:'東の城',owner:'自領',region:'東',neighbors:neighbors(['b'])},
    {id:'b',name:'西の城',owner:'他領',region:'西',neighbors:neighbors(['a','c','edo'])},
    {id:'c',name:'西の支城',owner:'他領',region:'西',neighbors:neighbors(['b'])},
    {id:'edo',name:'江戸城',owner:'他領',region:'東',neighbors:neighbors(['b'])}
  ];
  const geography={bounds:[130,30,145,42],land:{type:'Polygon',coordinates:[[[130,30],[145,30],[145,42],[130,42],[130,30]]]},castles:{a:[135,35],b:[135.5,35.3],c:[136,35.4],edo:[139.7547,35.6852]}};
  const win={document:doc,performance:{now:()=>stamp},requestAnimationFrame:callback=>{frames.set(++frameId,callback);return frameId;},cancelAnimationFrame:id=>frames.delete(id),addEventListener(){},removeEventListener(){},matchMedia:()=>({matches:true})};
  vm.runInNewContext(fs.readFileSync(require.resolve('../world-map.js'),'utf8'),{window:win});
  const controller=win.SengokuWorldMap.mount(host,{geography,castles,clan:'自領'}),flush=()=>{let limit=100;while(frames.size){assert(limit-->0);const queued=[...frames.values()];frames.clear();stamp+=16;for(const fn of queued)fn(stamp);}},click=action=>host.dispatchEvent({type:'click',target:host.querySelector(`[data-map-action="${action}"]`),stopPropagation(){}}),routes=()=>host.querySelector('[data-map-routes]').innerHTML;
  flush();assert.equal(visits,0,'Hidden routes must not walk the graph');click('routes');assert.equal(visits,4);assert.equal((routes().match(/<path /g)||[]).length,2);assert(routes().includes('is-own'));
  const initial=routes();visits=0;
  for(let frame=0;frame<60;frame++){controller.fit('nation',false);flush();}
  assert.equal(visits,0,'60 camera frames do not rescan unchanged routes');assert.equal(routes(),initial);
  click('routes');assert.equal(routes(),'');click('routes');assert.equal(routes(),initial);assert.equal(visits,0,'Toggling the layer retains its unchanged route data');
  controller.update({isAdmin:true});flush();assert.equal(visits,4);assert.equal((routes().match(/<path /g)||[]).length,3,'New role access immediately changes route restrictions');
  castles[0].owner='他領';controller.update({castles});flush();assert(!routes().includes('is-own'),'In-place source edits still invalidate through update');
  controller.update({region:'東'});flush();assert.equal((routes().match(/<path /g)||[]).length,2);assert(host.querySelector('[data-map-count]').textContent.startsWith('2城'));
  castles[1].disabled=true;controller.update({castles});flush();assert.equal(routes(),'','Newly restricted endpoints disappear');
  controller.update({countLabel:'最新の公開拠点'});flush();assert.equal(host.querySelector('[data-map-count]').textContent,'最新の公開拠点');
  controller.destroy();
});
console.log(`${count} real-geography projection, interaction and layout checks passed.`);
