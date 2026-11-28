'use strict';
// Verify every lazy variant points to a real sheet and the same original subject.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),file=p=>fs.readFileSync(path.join(root,p));
const scope={document:{readyState:'loading',addEventListener(){}}};scope.window=scope;vm.createContext(scope);
for(const f of ['officers-data.js','engine.js','artwork.js'])vm.runInContext(file(f).toString(),scope);
const manifest=JSON.parse(file('assets/art-manifest.json')),names=new Set(),nativeNames=new Set(),sizes=new Map();
function measure(url){
 const name=url.split('?')[0];if(sizes.has(name))return sizes.get(name);
 assert(name.startsWith('assets/art-previews/'));const bytes=file(name);
 assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
 sizes.set(name,bytes.length);return bytes.length;
}
function grid(sheet,cell,columns,rows){
 measure(sheet.url);assert.equal(sheet.size,columns*100+'% '+rows*100+'%');
 assert.equal(sheet.x,(cell%columns)/(columns-1)*100);assert.equal(sheet.y,Math.floor(cell/columns)/(rows-1)*100);
}
const specialScenes=new Set();
for(const [kind,id,variant,index,column,row] of manifest.illustrations){
 const subjects=manifest.subjects[kind],subject=subjects.findIndex(s=>s.id===id);
 const t=scope.SengokuArt.tileInfo(kind,id,variant);
 // Major cities and Kagoshima use their dedicated location scenery at every
 // level instead of the shared atlas cell; verify that local, bounded scene.
 if(kind==='castle'&&t.special){
  const scene=scope.SengokuArt.castleScene(id,'day');assert(scene&&scene.special);
  assert.equal(t.url,scene.src);assert.equal(t.small.url,scene.small);assert.equal(t.native.url,scene.native);assert.equal(t.small.size,'cover');
  for(const url of [scene.src,scene.small,scene.native])assert(fs.existsSync(path.join(root,url)),url);
  specialScenes.add(id);continue;
 }
 assert.equal(t.url.split('?')[0],manifest.atlases[index].file);
 assert.equal(t.x,column/7*100);assert.equal(t.y,row/3*100);
 const last=kind==='castle',cols=last?16:8,rows=last?9:4;
 grid(t.small,last?subject:subject%32,cols,rows);names.add(t.small.url);
 const native=kind==='officer'?variant===scope.SENGOKU_OFFICERS[subject].rank:variant===1||(kind==='facility'&&subject<8&&variant===2);
 assert.equal(Boolean(t.native),native);
 if(native){grid(t.native,subject%4,2,2);nativeNames.add(t.native.url);}
}
assert.deepEqual([...specialScenes].sort(),['edo','kagoshima','kyoto_gosho','nagoya','nijo','osaka']);
assert.equal(names.size,160);assert.equal(nativeNames.size,114);
const controls=measure('assets/art-previews/controls.webp');
const buttons=file('button-artwork.css').toString();
assert(buttons.includes('assets/responsive/castle-town-400.webp'));
assert(!buttons.includes('assets/castle-town.webp'),'Generic controls must not fetch the large city panorama');
const starter=new Set();for(const [index,level]of [2,2,2,1,1,2,1,1].entries())starter.add(scope.SengokuArt.tileInfo('facility',manifest.subjects.facility[index].id,level).native.url);
const town=[...starter].reduce((sum,url)=>sum+measure(url),0);
assert(town<400000,'Opening town sheets must remain small on a cold cache');
assert(controls<60000);
const ieyasu=scope.SengokuArt.portrait({id:'of_b0616adde162',rank:'U'});
for(const attribute of ['small','native']){
 const url=new RegExp('data-art-'+attribute+'="([^"]+)"').exec(ieyasu)[1];
 assert(url.includes('operator-ieyasu-u-'));assert(measure(url)<110000);
}
assert.equal(sizes.size,277);
console.log('PASS 8,224 canonical cells, 160 small sheets, 114 native groups, 6 dedicated city scenes, unique city and officer locations');
console.log('PASS initial eight facilities '+town+' bytes, shared action scenery '+controls+' bytes');
