'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ids=['edo','sunpu','nijo','osaka','nagoya'];
const scope={SENGOKU_DATA:{majorCityIds:ids,castles:[...ids,'kiyosu'].map(id=>({id,name:id})),buildings:[{id:'keep',name:'天守'}]},document:{readyState:'loading',addEventListener(){}}};scope.window=scope;
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../artwork.js'),'utf8'),scope);
const art=scope.SengokuArt;
for(const id of ids){
 const max=art.tileInfo('castle',id,64),last=art.tileInfo('castle',id,32);
 assert.equal(max.level,64);assert.equal(max.artLevel,32);assert.equal(max.url,last.url);assert.equal(max.x,last.x);assert.equal(max.y,last.y);assert.equal(max.finalStage,true);
 assert.match(art.castle(id,'',64),/Lv\.64・最終形態/);assert.equal(art.tileInfo('castle',id,999).level,64);
 for(let level=1;level<=64;level++){const t=art.tileInfo('castle',id,level);assert(t.x>=0&&t.x<=100&&t.y>=0&&t.y<=100);}
}
assert.equal(art.tileInfo('castle','kiyosu',64).level,32);assert.equal(art.tileInfo('facility','keep',64).level,32);
assert.equal(art.totalIllustrations,8192);
console.log('PASS five Lv.64 major cities retain valid final-stage artwork, ordinary and facility caps stay Lv.32.');
