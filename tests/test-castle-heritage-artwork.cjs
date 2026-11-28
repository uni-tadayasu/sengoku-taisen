'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {SENGOKU_DATA:D}=require('../engine.js');
const read=file=>fs.readFileSync(path.resolve(__dirname,'..',file),'utf8');
const paid=()=>({town:'castle-heritage',nameplate:null,badge:null,ownedProducts:['castle-heritage']});
const unowned=()=>({town:null,nameplate:null,badge:null,ownedProducts:[]});
const s={home:'kiyosu',clan:'織田家',buildings:{keep:12}};
let viewer=paid(),member=null,downloads=0;
const context={SENGOKU_DATA:D,document:{readyState:'loading',addEventListener(){},removeEventListener(){}},
 Image:class{constructor(){downloads++;}},state:()=>s,staffBaseId:'kyoto_gosho',staffConstructionReady:()=>false,
 game:{canOwnCastle:()=>true,isStaff:false},SengokuMusic:{daypart:()=> 'night'},SengokuResidency:{self:()=>member},
 SengokuPremiumRuntime:{getAppearance:()=>viewer,cleanAppearance:require('../premium-runtime.js').cleanAppearance},
 esc:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))};
context.window=context;context.global=context;vm.createContext(context);
vm.runInContext(read('premium-catalog.js'),context);
vm.runInContext(read('artwork.js'),context);
const art=context.SengokuArt;
const ordinary=D.castles.filter(c=>!c.majorCity&&c.id!=='kagoshima');
assert.equal(ordinary.length,123);
assert.equal(new Set(ordinary.map(c=>art.castleScene(c.id,'day',paid()).src)).size,123);
for(const castle of ordinary){
 assert.equal(art.castleScene(castle.id),null,'An unrelated paid viewer cannot change this castle');
 for(const appearance of [null,unowned(),{town:'castle-heritage',ownedProducts:[]},{town:null,ownedProducts:['castle-heritage']},{town:'snow-town',ownedProducts:['castle-heritage','snow-town']}])assert.equal(art.castleScene(castle.id,'day',appearance),null);
 const scene=art.castleScene(castle.id,'night',paid());
 assert.equal(scene.name,castle.name);assert.equal(scene.scenery,'heritage');assert.equal(scene.daypart,'night');
 assert.equal(scene.width/scene.height,16/9);assert.equal(scene.src,`assets/castle-scenes/${castle.id}-1536.webp`);
 assert(art.castle(castle.id,'test',17,paid()).includes('Lv.17'));
 assert.equal(art.tileInfo('castle',castle.id,999,paid()).level,32);
}
for(const id of D.majorCityIds){
 for(const appearance of [null,paid(),unowned(),{town:'snow-town',ownedProducts:['snow-town']}])assert.equal(art.castleScene(id,'day',appearance).src,`assets/castle-scenes/${id}-1536.webp`);
}
for(const phase of ['morning','day','night']){
 assert(art.castleScene('kagoshima',phase).src.includes(`kagoshima-town-${phase}`));
 assert(art.castlePanorama('kiyosu','',phase,paid()).includes(`data-castle-daypart="${phase}"`));
}
assert.equal(art.castleScene('../secret','day',paid()),null);
assert.equal(art.castleScene('unknown','day',paid()),null);
assert.equal(downloads,0,'Resolving the catalog never preloads 129 images');
console.log('PASS all 123 paid identities, five city identities, Kagoshima phases, entitlement/selection gates, safe paths and lazy artwork');

const app=read('app.js');
function appFunction(name){const start=app.indexOf(`  function ${name}(`),first=app.indexOf('\n',start);assert(start>=0,name);const end=app.slice(start,first).endsWith('}')?first:app.indexOf('\n  }',start)+4;return app.slice(start,end);}
vm.runInContext(['homeCastleAppearance','campaignCastleOwnerAppearance','townSceneArt','campaignCastleGrowth','campaignCastleAppearance'].map(appFunction).join('\n'),context);
assert(context.townSceneArt().src.includes('castle-scenes/kiyosu'));
const own={id:'kiyosu',owner:s.clan,level:4},foreign={id:'inuyama',owner:'武田家',level:9};
assert(context.campaignCastleAppearance(own).html.includes('castle-scenes/kiyosu'));
assert(!context.campaignCastleAppearance(foreign).html.includes('castle-scenes/inuyama'));
assert.equal(context.campaignCastleOwnerAppearance({...own,owner:'武田家'}),null,'Losing the castle immediately removes the old owner context');
viewer=unowned();assert(!context.townSceneArt().src.includes('castle-scenes'));
member={role:'retainer',castleId:s.home,lord:{appearance:paid()}};
assert(context.townSceneArt().src.includes('castle-scenes/kiyosu'),'An unpaid retainer sees the current lord\'s scenery');
assert(context.campaignCastleAppearance(own).html.includes('castle-scenes/kiyosu'));
viewer=paid();member={role:'retainer',castleId:s.home,lord:{appearance:unowned()}};
assert(!context.townSceneArt().src.includes('castle-scenes'),'The retainer\'s own purchase cannot replace an unpaid lord\'s castle');
member={role:'retainer',castleId:s.home,lord:null};
assert(!context.townSceneArt().src.includes('castle-scenes'),'Unresolved succession cannot borrow a retainer purchase');
member=null;viewer=paid();s.home='matsumoto';
assert(context.townSceneArt().src.includes('castle-scenes/matsumoto'),'An owned selection follows the moved home without another purchase');
s.home='kiyosu';
console.log('PASS own/enemy campaign isolation, equipped refunds, retainer lord projection, missing lord fallback and home relocation');

vm.runInContext(read('field.js'),context);
const fieldPlayer={playerId:'u_owner',name:'城主',homeCastleId:'himeji',targetCastleId:'himeji',homeCastleName:'姫路城',level:18,keepLevel:12,appearance:paid()};
viewer=unowned();
assert(context.SengokuField.castleAppearance(fieldPlayer,{marker:true}).includes('castle-scenes/himeji'));
viewer=paid();
assert(!context.SengokuField.castleAppearance({...fieldPlayer,appearance:unowned()}).includes('castle-scenes/himeji'));
assert(!context.SengokuField.castleAppearance({...fieldPlayer,appearance:undefined}).includes('castle-scenes/himeji'));
console.log('PASS shared-field markers resolve the target owner and never the current viewer');

context.module={exports:{}};
vm.runInContext(read('battle-catalog.js'),context);vm.runInContext(read('events.js').replace('module.exports = { createController','module.exports = { cleanOpponent, opponentMarkup, createController'),context);
const events=context.module.exports,opponent={castleId:'himeji',castleName:'姫路城',lordName:'城主',castleOwnerId:'u_owner',defenseTroops:1000,defensePower:5000,castleAppearance:paid()};
const clean=events.cleanOpponent(opponent);
assert.equal(clean.castleOwnerId,'u_owner');
assert(clean.castleAppearance.ownedProducts.includes('castle-heritage'));
assert(events.opponentMarkup(clean).includes('castle-scenes/himeji'));
assert(!events.opponentMarkup(events.cleanOpponent({...opponent,castleAppearance:unowned()})).includes('castle-scenes/himeji'));
const selected={id:'castle:himeji',name:'姫路城の戦い',category:'castle',description:'城を舞台にした合戦。'};
assert(!events.catalogSelectionMarkup({catalog:[selected],battleId:selected.id}).includes('castle-scenes/himeji'),'A neutral event catalog does not assume the viewer owns the castle');
console.log('PASS event opponent normalization, readback appearance and neutral battle catalog isolation');

const profile=read('public-profile.js'),profileFunctions=['detail'];
context.commanderCard=()=>'';context.clanName=clan=>clan||'浪人';
for(const name of profileFunctions){const start=profile.indexOf('function '+name+'('),end=profile.indexOf('\nfunction ',start+1);vm.runInContext(profile.slice(start,end),context);}
const person={id:'u_retainer',name:'家臣',clan:'織田家',homeCastleId:'himeji',appearance:unowned(),homeCastleAppearance:paid()};
const visible=context.detail(person);assert(visible.includes('castle-scenes/himeji'));assert(visible.includes('本拠 · 姫路城'));assert(!/無料|購入不要|無料対象/.test(visible));
assert(!context.detail({...person,appearance:paid(),homeCastleAppearance:unowned()}).includes('castle-scenes/himeji'));
assert(!context.detail({...person,homeCastleId:'../../private'}).includes('lord-public-castle'));
console.log('PASS anonymous public profile scenery uses the current castle lord and keeps invalid home IDs out of image paths');
