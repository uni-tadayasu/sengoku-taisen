'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SENGOKU_DATA}=require('../engine.js');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8');
let home='kagoshima',phase='morning',skin='snow-town',downloads=0;
const context={SENGOKU_DATA,document:{readyState:'loading',addEventListener(){}},Image:class{constructor(){downloads++;}},state:()=>({home}),SengokuMusic:{daypart:()=>phase},SengokuPremiumRuntime:{getAppearance:()=>({town:skin})}};
context.window=context;vm.createContext(context);
vm.runInContext(read('premium-catalog.js'),context);
vm.runInContext(read('artwork.js'),context);
const art=context.SengokuArt;
for(const id of ['edo','nijo','uchijo','unknown'])assert.equal(art.castleScene(id),null);
assert.equal(art.castleScene('kagoshima','invalid').daypart,'day');
for(const period of ['morning','day','night']){
 const scene=art.castleScene('kagoshima',period);
 assert.equal(scene.daypart,period);assert.equal(scene.width/scene.height,16/9);
 assert(scene.alt.includes('御楼門'));assert(scene.alt.includes('城山'));
 for(const [url,width]of scene.srcset.split(', ').map(item=>item.split(' '))){
  const bytes=fs.readFileSync(path.join(root,url));
  assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');
  assert(bytes.length<(width==='400w'?50000:500000),'Responsive scenery keeps its download budget: '+url);
 }
 const panorama=art.castlePanorama('kagoshima','events-castle-panorama',period);
 assert(panorama.includes(scene.srcset));assert(panorama.includes('loading="lazy"'));
 assert(panorama.includes('鹿児島城（鶴丸城）'));
}
for(const level of [1,2,16,32]){
 const info=art.tileInfo('castle','kagoshima',level),painting=art.castle('kagoshima','field-castle-art',level);
 assert.equal(info.level,level);assert(info.special);
 assert(painting.includes('data-castle-art="kagoshima"'));
 assert(painting.includes('kagoshima-town-day-400.webp'));
 assert(painting.includes('kagoshima-town-day-720.webp'));
 assert(painting.includes('御楼門と城下町の特別絵巻'));
 assert(!painting.includes('assets/castles/'));
}
assert(!art.tileInfo('castle','uchijo',1).special);
assert.equal(downloads,0,'Creating maps or hidden galleries never starts image downloads');

const app=read('app.js'),start=app.indexOf('  function townSceneArt('),end=app.indexOf('  function refreshTownArt(',start);
vm.runInContext(app.slice(start,end),context);
for(const period of ['morning','day','night']){
 phase=period;const scene=context.townSceneArt();
 assert(scene.special);assert.equal(scene.daypart,period);
 assert(scene.src.includes('kagoshima-town-'+period));
}
home='uchijo';assert(context.townSceneArt().srcset.includes('snow-town'),'Ordinary towns keep the equipped purchased appearance');
home='kagoshima';skin=null;assert(context.townSceneArt().special);
home='uchijo';assert(context.townSceneArt().srcset.includes('castle-town-raden'));

const mapStart=app.indexOf('  function campaignCastleGrowth('),mapEnd=app.indexOf('  function campaignCastleTooltip(',mapStart);
vm.runInContext(app.slice(mapStart,mapEnd),context);
const marker=context.campaignCastleAppearance({id:'kagoshima',name:'鹿児島城',level:32,home:false,owner:'島津家'});
assert(marker.html.includes('special-castle-painting'),'A viewer who owns a different castle sees the same art on the campaign map');
assert(marker.label.includes('Lv.32'));

context.module={exports:{}};
vm.runInContext(read('battle-catalog.js'),context);
vm.runInContext(read('events.js'),context);
const selection={id:'castle:kagoshima',name:'鹿児島城の戦い',category:'castle',description:'鹿児島城を舞台にした合戦。'};
const eventPreview=context.module.exports.catalogSelectionMarkup({catalog:[selection],battleId:selection.id});
assert(eventPreview.includes('kagoshima-town-day-400.webp'),'Event selection shares the castle panorama for all visitors');
assert(eventPreview.includes('御楼門'));
console.log('PASS Kagoshima castle identity across levels, ordinary-viewer map and event previews, all three town phases, responsive files, lazy images and purchased-town preservation');
