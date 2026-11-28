'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..');let imageRequests=0;
const scope={document:{readyState:'loading',addEventListener(){}},Image:class{constructor(){imageRequests++;}}};scope.window=scope;vm.createContext(scope);
for(const file of ['officers-data.js','artwork.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),scope);
const officer=scope.SENGOKU_OFFICERS.find(row=>row.cloisteredReward),art=scope.SengokuArt,info=art.tileInfo('officer',officer.id,'U'),html=art.portrait(officer);
assert.equal(info.url,officer.portrait);assert.equal(info.rank,'U');assert.equal(info.cloisteredReward,true);
assert(html.includes('cloistered-reward-painting'));assert(html.includes('court-noble-portrait-frame'));
assert(html.includes('後白河法皇 Uランクの法皇就任記念専用イラスト'));assert(!html.includes('officers-U-09'),'the new character never points into an absent atlas');
assert(html.includes('aria-busy="true"'));assert(html.includes('loading="lazy"'));assert.equal(imageRequests,0,'portrait construction defers downloads until visible');
for(const rank of scope.SENGOKU_RANKS){const fixed=art.portrait({...officer,rank});assert.equal(art.tileInfo('officer',officer.id,rank).rank,'U');assert(fixed.includes('data-rank="U"'));assert(fixed.includes('class="portrait-rank-badge" aria-hidden="true">U</b>'));assert(fixed.includes('後白河法皇 Uランクの法皇就任記念専用イラスト'),'fixed U artwork, label and frame stay consistent even if a caller supplies another rank');}
const bytes=fs.readFileSync(path.join(root,info.url));assert.equal(bytes.toString('ascii',0,4),'RIFF');assert.equal(bytes.toString('ascii',8,12),'WEBP');assert(bytes.length<120000,'dedicated portrait stays under120KB');
console.log('PASS 法皇専用肖像 uses its real lazy WebP without missing atlas references.');
