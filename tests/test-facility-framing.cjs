'use strict';
// Facility cover crops must preserve the actual image ratio and stay inside
// the selected level/subject, including when the loaded atlas is reused.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file));
const source=read('artwork.js').toString(),manifest=JSON.parse(read('assets/art-manifest.json'));
const scope={document:{readyState:'loading',addEventListener(){}}};scope.window=scope;vm.createContext(scope);
for(const file of ['officers-data.js','engine.js'])vm.runInContext(read(file).toString(),scope);
vm.runInContext(source,scope);const art=scope.SengokuArt,sizes=new Map();
function dimensions(url){
 const file=url.split('?')[0];if(sizes.has(file))return sizes.get(file);
 const bytes=read(file);assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
 for(let offset=12;offset+8<bytes.length;){
  const type=bytes.toString('ascii',offset,offset+4),length=bytes.readUInt32LE(offset+4),start=offset+8;let size;
  if(type==='VP8X')size=[1+bytes.readUIntLE(start+4,3),1+bytes.readUIntLE(start+7,3)];
  if(type==='VP8 ')size=[bytes.readUInt16LE(start+6)&16383,bytes.readUInt16LE(start+8)&16383];
  if(type==='VP8L'){const bits=bytes.readUInt32LE(start+1);size=[1+(bits&16383),1+((bits>>>14)&16383)];}
  if(size){sizes.set(file,size);return size;}offset=start+length+(length%2);
 }
 throw Error('No WebP dimensions: '+file);
}
function assertBounds(frame){
 assert(frame);assert(frame.x>=0&&frame.y>=0);
 assert(frame.x+frame.width<=frame.atlasWidth);assert(frame.y+frame.height<=frame.atlasHeight);
}
function assertRatio(frame,url){const [width,height]=dimensions(url);assert.equal(frame.atlasWidth/frame.atlasHeight,width/height,url+' must not stretch the source atlas');}
let count=0;
for(const [kind,id,level,atlasIndex,column,row]of manifest.illustrations){
 if(kind!=='facility')continue;
 const subject=manifest.subjects.facility.findIndex(item=>item.id===id),tile=art.tileInfo(kind,id,level),frame=art.facilityFrame(tile.frame),original=manifest.atlases[atlasIndex];
 assertBounds(frame);assert.equal(frame.x/frame.atlasWidth,column/8);assert.equal(frame.y/frame.atlasHeight,row/4);
 assert.equal(frame.atlasWidth/frame.atlasHeight,original.width/original.height);
 const small=art.facilityFrame(tile.small.frame);assertBounds(small);assertRatio(small,tile.small.url);
 assert.equal(small.x/small.atlasWidth,(subject%8)/8);assert.equal(small.y/small.atlasHeight,Math.floor(subject%32/8)/4);
 if(tile.native){const native=art.facilityFrame(tile.native.frame);assertBounds(native);assertRatio(native,tile.native.url);assert.equal(native.x/native.atlasWidth,(subject%2)/2);assert.equal(native.y/native.atlasHeight,Math.floor(subject%4/2)/2);}
 for(const [width,height]of [[56,64],[90,104],[70,90],[54,76],[350,350],[480,200]]){
  const scale=Math.max(width/frame.width,height/frame.height),visibleWidth=width/scale,visibleHeight=height/scale;
  const x=frame.x+(frame.width-visibleWidth)/2,y=frame.y+(frame.height-visibleHeight)/2;
  assert(x>=frame.x-1e-10&&y>=frame.y-1e-10);
  assert(x+visibleWidth<=frame.x+frame.width+1e-10&&y+visibleHeight<=frame.y+frame.height+1e-10,'Cover cannot reveal an adjacent atlas cell');
  assert(Math.abs(visibleWidth*scale-width)<1e-10&&Math.abs(visibleHeight*scale-height)<1e-10,'A proportional cover fills the whole frame');
 }
 count++;
}
assert.equal(count,2048);
for(const invalid of ['',null,'8,4,-1,3,4','8,4,32,3,4','8,4,1,0,4','0,4,0,3,4','33,4,0,3,4','8,4,1.5,3,4','8,4,1,NaN,4','8,4,1,3,4,5','8,4,1,999999999,4'])assert.equal(art.facilityFrame(invalid),null);
console.log('PASS all 2,048 facility levels and real preview dimensions preserve aspect, subject and crop boundaries');

async function rendering(){
 const {doc,host}=require('./helpers/dom-model.cjs').setup(),requests=[];
 const paintScope={global:{},document:doc,observer:null,cache:new Map(),loaded:new Set(),paintRequests:new WeakMap(),esc:s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),Image:class{set src(url){this.url=url;requests.push(this);}}};
 vm.createContext(paintScope);
 vm.runInContext(source.slice(source.indexOf('function load(url)'),source.indexOf('\nconst backgrounds=')),paintScope);
 host.innerHTML=art.facility('keep','',1);const el=host.querySelector('.facility-painting'),surface=el.querySelector('.art-surface');
 for(const kind of ['small','native','original']){
  const tile=art.tileInfo('facility','keep',1),url=kind==='original'?tile.url:tile[kind].url;
  assert.equal(paintScope.paintFacility(el,{kind,url}),true);
  const svg=surface.querySelector('.facility-art-viewport'),frame=art.facilityFrame(kind==='original'?tile.frame:tile[kind].frame);
  assert.equal(svg.namespaceURI,'http://www.w3.org/2000/svg');assert.equal(svg.getAttribute('viewBox'),[frame.x,frame.y,frame.width,frame.height].join(' '));
  assert.equal(svg.getAttribute('preserveAspectRatio'),'xMidYMid slice');assert.equal(svg.getAttribute('aria-hidden'),'true');assert.equal(svg.getAttribute('focusable'),'false');
  assert.equal(svg.querySelector('image').getAttribute('href'),url);assert.equal(surface.style.backgroundImage,'none');
  paintScope.paintFacility(el,{kind,url});assert.equal(surface.querySelector('.facility-art-viewport'),svg,'An unchanged picture retains its existing SVG');
 }
 // Force the original sheet, then upgrade a retained DOM node to level 32.
 delete el.dataset.artSmall;delete el.dataset.artNative;
 const pending=paintScope.reveal(el,{width:350,height:350});assert.equal(requests.length,1);requests[0].onload();await pending;
 const first=surface.querySelector('.facility-art-viewport');assert.equal(first.getAttribute('viewBox'),'0 0 3 4');
 el.dataset.artFrame=art.tileInfo('facility','keep',32).frame;
 await paintScope.reveal(el,{width:350,height:350});
 assert.equal(requests.length,1,'Changing levels in an already loaded original sheet needs no extra request');
 assert.equal(surface.querySelector('.facility-art-viewport').getAttribute('viewBox'),'21 12 3 4','The reused source must still move to the current level');
 assert.notEqual(surface.querySelector('.facility-art-viewport'),first);
 console.log('PASS small/native/original SVG crops, stable updates and a new level in the same loaded atlas');
}
rendering().catch(error=>{console.error(error);process.exitCode=1;});
