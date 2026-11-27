#!/usr/bin/env node
'use strict';
// Deterministic correspondence of 8,224 original illustration cells to 257 files.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),context={};context.window=context;context.globalThis=context;vm.createContext(context);
for(const f of ['officers-data.js','engine.js'])vm.runInContext(fs.readFileSync(path.join(root,f),'utf8'),context);
const data=context.SENGOKU_DATA,roster=context.SENGOKU_OFFICERS,ranks=['D','C','B','A','S','SS','SSS','U'];
assert.equal(roster.length,256);assert.equal(data.castles.length,129);assert.equal(data.buildings.length,64);
function dimensions(b){
 assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');
 for(let p=12;p+8<=b.length;){const tag=b.toString('ascii',p,p+4),length=b.readUInt32LE(p+4),d=p+8;
  if(tag==='VP8X')return [b.readUIntLE(d+4,3)+1,b.readUIntLE(d+7,3)+1];
  if(tag==='VP8 ')return [b.readUInt16LE(d+6)&16383,b.readUInt16LE(d+8)&16383];
  if(tag==='VP8L'){const bits=b.readUInt32LE(d+1);return [(bits&16383)+1,((bits>>>14)&16383)+1];}
  p=d+length+(length%2);
 }throw new Error('Unsupported WebP dimensions');
}
const atlases=[],illustrations=[],digests=new Set(),ids=new Set();
function atlas(file,kind,variants){
 const absolute=path.join(root,file);assert.ok(fs.existsSync(absolute),'Missing illustration sheet: '+file);
 const bytes=fs.readFileSync(absolute),[width,height]=dimensions(bytes),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
 assert.ok(width>=1200&&height>=700,'Unexpected low resolution: '+file);
 const portrait=kind==='officer'||(kind==='facility'&&data.buildings.slice(0,32).some(b=>b.id===variants[0].subjectId));
 assert.equal(width/height,portrait?1.5:2,'Wrong sheet geometry: '+file);
 assert.ok(!digests.has(sha256),'Identical duplicate illustration sheet: '+file);digests.add(sha256);
 assert.equal(variants.length,32);
 atlases.push({file,kind,width,height,columns:8,rows:4,bytes:bytes.length,sha256});
 variants.forEach((v,i)=>{assert.ok(!ids.has(v.id),'Duplicate cell identity: '+v.id);ids.add(v.id);const column=i%8,row=Math.floor(i/8);illustrations.push({...v,file,column,row,x:column*width/8,y:row*height/4,width:width/8,height:height/4});});
}
for(const rank of ranks)for(let sheet=0;sheet<8;sheet++)atlas(`assets/illustrations/officers-${rank}-${String(sheet+1).padStart(2,'0')}.webp`,'officer',roster.slice(sheet*32,(sheet+1)*32).map(o=>({id:`officer:${o.id}:${rank}`,kind:'officer',subjectId:o.id,name:o.name,rank})));
for(const [kind,list,folder] of [['castle',data.castles,'castles'],['facility',data.buildings,'facilities']])for(const item of list)atlas(`assets/${folder}/${item.id}.webp`,kind,Array.from({length:32},(_,i)=>({id:`${kind}:${item.id}:${i+1}`,kind,subjectId:item.id,name:item.name,level:i+1})));
assert.equal(atlases.length,257);assert.equal(illustrations.length,8224);
for(const kind of ['officer','castle','facility'])assert.equal(illustrations.filter(i=>i.kind===kind).length,kind==='castle'?4128:2048);
const atlasIndex=new Map(atlases.map((a,i)=>[a.file,i]));
const specialFile='assets/operator-ieyasu-u.webp',specialBytes=fs.readFileSync(path.join(root,specialFile)),[specialWidth,specialHeight]=dimensions(specialBytes);
assert.ok(specialWidth>=1000&&specialHeight>=1500,'Operator Ieyasu portrait resolution');
const overrides=[{kind:'officer',subjectId:'of_b0616adde162',name:'德川家康',rank:'U',access:'operator-only',file:specialFile,width:specialWidth,height:specialHeight,bytes:specialBytes.length,sha256:crypto.createHash('sha256').update(specialBytes).digest('hex'),description:'運営専用のアニメ調武将絵巻。晩年の徳川家康を束帯姿で描き、既存のUセルに優先して表示。'}];
const deputyFile='assets/deputy-shimazu-yoshihisa-u-relief.webp',deputyBytes=fs.readFileSync(path.join(root,deputyFile)),[deputyWidth,deputyHeight]=dimensions(deputyBytes);
assert.ok(deputyWidth>=1000&&deputyHeight===deputyWidth,'Deputy Shimazu relief portrait resolution');
overrides.push({kind:'officer',subjectId:'of_45e0f4cb36ad',name:'島津義久',rank:'U',access:'deputy-only',requiredMarker:'deputyExclusive',file:deputyFile,width:deputyWidth,height:deputyHeight,bytes:deputyBytes.length,sha256:crypto.createHash('sha256').update(deputyBytes).digest('hex'),description:'サブ運営専用・総大将のレリーフ加工特別肖像。認証済みサブ運営の専用武将ビューだけに表示し、通常の島津義久Uの原画は維持。'});
const manifest={schemaVersion:1,title:'戦国VS',layout:'8 columns by 4 rows, row-major',totals:{officers:2048,castles:4128,facilities:2048,illustrations:8224,atlases:257},subjects:{officer:roster.map(o=>({id:o.id,name:o.name})),castle:data.castles.map(o=>({id:o.id,name:o.name})),facility:data.buildings.map(o=>({id:o.id,name:o.name}))},atlases,illustrationFields:['kind','subjectId','rankOrLevel','atlasIndex','column','row'],cellBounds:{x:'column * atlas.width / 8',y:'row * atlas.height / 4',width:'atlas.width / 8',height:'atlas.height / 4'},illustrations:illustrations.map(i=>[i.kind,i.subjectId,i.rank??i.level,atlasIndex.get(i.file),i.column,i.row])};
manifest.schemaVersion=2;manifest.overrides=overrides;
const file=path.join(root,'assets/art-manifest.json'),serialized=JSON.stringify(manifest);
if(process.argv.includes('--check')){assert.ok(fs.existsSync(file),'Run this command without --check to build the manifest');assert.equal(fs.readFileSync(file,'utf8').trim(),serialized,'Manifest differs from actual artwork. Rebuild before publishing.');}
else fs.writeFileSync(file,serialized+'\n');
console.log(JSON.stringify({ok:true,...manifest.totals,bytes:atlases.reduce((n,a)=>n+a.bytes,0),mode:process.argv.includes('--check')?'verified':'generated'}));
