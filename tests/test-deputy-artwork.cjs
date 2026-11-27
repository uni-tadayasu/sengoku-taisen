'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,name));
let imageRequests=0;
const scope={document:{readyState:'loading',addEventListener(){}},Image:class{constructor(){imageRequests++;}}};
scope.window=scope;vm.createContext(scope);
for(const file of ['officers-data.js','artwork.js'])vm.runInContext(read(file).toString(),scope);
const art=scope.SengokuArt,shimazu=scope.SENGOKU_OFFICERS.find(o=>o.id==='of_45e0f4cb36ad');
assert(shimazu,'The exclusive artwork must identify the existing Shimazu officer');
const isDeputy=html=>html.includes('deputy-shimazu-yoshihisa-u-relief.webp');
assert.equal(art.portrait(null),'');
for(const rank of scope.SENGOKU_RANKS){
 const regular=art.portrait({...shimazu,rank});
 assert(!isDeputy(regular),'Ordinary Shimazu variants retain the original illustration');
 assert(regular.includes(`assets/illustrations/officers-${rank}-`));
 assert.equal(isDeputy(art.portrait({...shimazu,rank,deputyExclusive:true})),rank==='U');
}
for(const marker of [false,undefined,null,1,'true'])assert(!isDeputy(art.portrait({...shimazu,rank:'U',deputyExclusive:marker})));
assert(!isDeputy(art.portrait({...shimazu,id:'unknown-officer',rank:'U',deputyExclusive:true})));
assert(!isDeputy(art.portrait({...shimazu,id:'of_b0616adde162',rank:'U',deputyExclusive:true})));
assert(!isDeputy(art.portrait({...shimazu,rank:undefined,deputyExclusive:true})));
const special=art.portrait({...shimazu,rank:'U',deputyExclusive:true});
assert(special.includes('deputy-relief-frame'));
assert(special.includes('painted-portrait deputy-portrait'));
assert(special.includes('role="img"'));
assert(special.includes('aria-label="サブ運営専用・総大将 島津義久 Uランクのレリーフ加工特別イラスト"'));
assert(special.includes('aria-busy="true"'));
assert(special.includes('loading="lazy"'));
assert.equal(imageRequests,0,'Constructing any portrait keeps image downloads deferred to the existing visible-art lifecycle');
function dimensions(file){
 const b=read(file);assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');
 for(let p=12;p+8<=b.length;){
  const tag=b.toString('ascii',p,p+4),length=b.readUInt32LE(p+4),d=p+8;
  if(tag==='VP8X')return[b.readUIntLE(d+4,3)+1,b.readUIntLE(d+7,3)+1];
  if(tag==='VP8 ')return[b.readUInt16LE(d+6)&16383,b.readUInt16LE(d+8)&16383];
  if(tag==='VP8L'){const bits=b.readUInt32LE(d+1);return[(bits&16383)+1,((bits>>>14)&16383)+1];}
  p=d+length+(length%2);
 }throw new Error('Unsupported WebP');
}
for(const [attribute,width]of [['url',1024],['small',160],['native',384]]){
 const url=new RegExp(`data-art-${attribute}="([^"]+)"`).exec(special)?.[1];
 assert(url,'Every lazy resolution must be available');
 assert(url.includes('shimazu-relief-u-20261127'),'Special assets carry their own cache revision');
 const file=url.split('?')[0];assert.deepEqual(dimensions(file),[width,width]);
 if(width<1024)assert(read(file).length<110000,'Lazy previews stay below 110 KB');
}
const css=read('artwork.css').toString();
assert(css.includes(':not(.operator-portrait):not(.deputy-portrait)'),'Preview atlas positioning must not stretch the independent portrait');
assert(css.includes('.deputy-portrait>.art-surface { background-size:cover; background-position:center; }'));
console.log('PASS deputy-only Shimazu art, ordinary variants, forged identity/rank guards, accessible lazy markup and square WebP derivatives');
