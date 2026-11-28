'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');let downloads=0;
const scope={document:{readyState:'loading',addEventListener(){}},Image:class{constructor(){downloads++;}}};scope.window=scope;vm.createContext(scope);
for(const name of ['officers-data.js','artwork.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),scope);
const nobles=scope.SENGOKU_OFFICERS.filter(o=>o.courtNoble===true),hashes=new Set();assert.equal(nobles.length,24);
for(const noble of nobles){
 const file=`assets/court-nobles/${noble.id}.webp`,info=scope.SengokuArt.tileInfo('officer',noble.id,noble.rank),html=scope.SengokuArt.portrait(noble);
 assert.equal(info.url,file);assert.equal(info.courtNoble,true);assert(html.includes('court-noble-painting'));assert(html.includes('court-noble-portrait-frame'));
 assert(html.includes(file));assert(!html.includes('assets/illustrations/officers-'),'a noble must never use a non-existent atlas sheet');
 assert(html.includes('aria-busy="true"'));assert(html.includes('loading="lazy"'));assert(html.includes(noble.name));
 const bytes=fs.readFileSync(path.join(root,file));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert(bytes.length>6000&&bytes.length<150000,'dedicated illustration stays within mobile image budget');
 hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'));
}
assert.equal(hashes.size,24,'each court character has distinct original artwork');assert.equal(downloads,0,'building catalogue markup must not preload all portraits');
assert(fs.readFileSync(path.join(root,'artwork.css'),'utf8').includes('.painted-art.court-noble-painting>.art-surface { background-size:cover;'),'independent images cannot be stretched as 8x4 atlas sheets');
assert.equal(scope.SengokuArt.totalIllustrations,8248);
console.log('PASS 24 distinct optimized noble portraits, shared gallery artwork, atlas isolation and lazy loading.');
