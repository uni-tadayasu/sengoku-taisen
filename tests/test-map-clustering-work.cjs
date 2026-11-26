'use strict';
// Compare the complete-link contract with an independent exhaustive reference.
// Count geometric distance checks instead of asserting machine-specific FPS.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../world-map.js'),'utf8'),math=Object.create(Math);
let measured=0;math.hypot=(...values)=>{measured++;return Math.hypot(...values);};
const scope={Math:math,module:{exports:{}}};vm.runInNewContext(source,scope);const map=scope.module.exports;
function reference(points,view,width,height,distance=27){
 const visible=points.map(point=>({...point,sx:(point.x-view.x)/view.width*width,sy:(point.y-view.y)/view.height*height})).filter(p=>p.sx>-30&&p.sx<width+30&&p.sy>-30&&p.sy<height+30);
 const groups=[];let checks=0;
 const between=(a,b)=>{checks++;return Math.hypot(a.sx-b.sx,a.sy-b.sy);};
 for(const point of [...visible].sort((a,b)=>a.sx-b.sx||a.sy-b.sy||a.id.localeCompare(b.id))){
  if(point.selected||point.home||distance<=0){groups.push([point]);continue;}
  let choice=null,closest=Infinity;
  for(const group of groups){
   if(group[0].selected||group[0].home)continue;
   if(group.some(member=>between(point,member)>=distance))continue;
   const center=group.reduce((sum,member)=>({sx:sum.sx+member.sx/group.length,sy:sum.sy+member.sy/group.length}),{sx:0,sy:0});
   const delta=between(point,center);if(delta<closest){choice=group;closest=delta;}
  }
  if(choice)choice.push(point);else groups.push([point]);
 }
 return{groups:groups.map(group=>group.map(p=>p.id).sort().join('|')).sort(),checks};
}
function compare(points,view,width,height,options={}){
 const expected=reference(points,view,width,height,options.distance);measured=0;const actual=map.layoutMarkers(points,view,width,height,options),checks=measured;
 assert.deepEqual(Array.from(actual,marker=>Array.from(marker.points,p=>p.id).sort().join('|')).sort(),expected.groups);
 for(const marker of actual){
  if(marker.points.some(point=>point.selected||point.home))assert.equal(marker.points.length,1);
  for(const a of marker.points)for(const b of marker.points)if(a!==b)assert(Math.hypot(a.sx-b.sx,a.sy-b.sy)<(options.distance??27));
 }
 return{before:expected.checks,after:checks,actual};
}
let tests=0;function test(name,run){run();tests++;console.log('PASS '+name);}
test('separated markers skip all impossible cluster distance checks while keeping every castle',()=>{
 const points=Array.from({length:128},(_,i)=>({id:'castle_'+i,name:'城'+i,x:20+i*40,y:200})),view={x:0,y:0,width:5200,height:500};
 const result=compare(points,view,5200,500,{labels:false});assert.equal(result.actual.length,128);assert.equal(result.before,8128);assert.equal(result.after,0);
 console.log(JSON.stringify({separated128:{before:result.before,after:result.after}}));
});
test('real Japan castle layouts retain identical groups through zoom, pan, small screens and focus',()=>{
 const geoScope={};vm.runInNewContext(fs.readFileSync(require.resolve('../map-data.js'),'utf8'),geoScope);const geography=geoScope.SENGOKU_GEOGRAPHY,{SENGOKU_DATA:data}=require('../engine.js');
 const points=map.castlePoints(data.castles.map(row=>({...row,owner:row.clan})),geography.castles,{clan:'織田家',homeId:'kiyosu',selectedId:'edo'}),country=map.projectBounds(geography.bounds),home=points.find(p=>p.id==='kiyosu');
 let before=0,after=0,scenes=0;
 for(const [width,height]of [[320,568],[768,1024],[1440,900]]){
  const base=map.fitBounds(country,width,height,28);
  for(const zoom of [1,2,6,14,40])for(const offset of [-.25,0,.25])for(const distance of [27,52,60]){
   const view={x:(zoom===1?base.x+base.width/2:home.x)-base.width/zoom/2+base.width/zoom*offset,y:(zoom===1?base.y+base.height/2:home.y)-base.height/zoom/2,width:base.width/zoom,height:base.height/zoom};
   const result=compare(points,view,width,height,{distance,markerSize:48,labels:true});before+=result.before;after+=result.after;scenes++;
  }
 }
 assert(after<before*.45,`Expected a concrete reduction for real map scenes, got ${after}/${before}`);
 console.log(JSON.stringify({realMap:{scenes,before,after,reductionPercent:Math.round((1-after/before)*100)}}));
});
test('boundary distance, equal x coordinates, dense chains and input ordering preserve the complete-link result',()=>{
 let seed=1781;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
 for(let scenario=0;scenario<160;scenario++){
  const distance=[0,1,27,52,100][scenario%5],points=Array.from({length:128},(_,i)=>({id:'p'+i,name:'城'+i,x:scenario%3===0?(i%8)*distance:Math.floor(random()*900),y:scenario%4===0?200:Math.floor(random()*600),home:i===3,selected:i===7,own:i%4===0}));
  for(let i=points.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[points[i],points[j]]=[points[j],points[i]];}
  compare(points,{x:0,y:0,width:800,height:500},800,500,{distance,labels:scenario%2===0});
 }
});
console.log(`${tests} map clustering work groups passed without changing groups, focus priority or label-placement inputs.`);
