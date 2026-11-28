/* The supplied emblem accompanies each real court rank, without changing scores. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {SengokuEngine:E,SENGOKU_DATA:D}=require('../engine.js'),UI=require('../player-evaluation.js');
const snapshot=JSON.stringify(D.evaluationRanks),images=new Set();
for(const rank of D.evaluationRanks){
  const value={version:1,score:rank.minScore,maxScore:D.evaluationMax,rankId:rank.id,rankName:rank.name,rankIndex:rank.index};
  const html=UI.badge(value),image=/<img\b[^>]*src="([^"]+)"[^>]*>/.exec(html);
  assert(image,rank.name+' must show the official emblem');images.add(image[1]);
  assert.equal((html.match(/<img\b/g)||[]).length,1,rank.name+' must not duplicate the emblem');
  assert(html.includes('data-evaluation-rank="'+rank.id+'"'));assert(html.includes('data-evaluation-index="'+rank.index+'"'));
  assert(html.includes('>'+rank.name+'</span>'),rank.name+' remains readable without color perception');
  assert(html.includes('aria-label="位階 '+rank.name+' · 総合評価 '+rank.minScore.toLocaleString('ja-JP')));
  assert(/\balt=""/.test(image[0]));assert(/\bwidth="20"/.test(image[0]));assert(/\bheight="20"/.test(image[0]));
  assert(!/<(?:a|button)\b|tabindex|data-action|onclick=/.test(html),'a badge inside a player link is noninteractive');
}
assert.equal(images.size,1,'all ranks use the same supplied artwork with their own frames');
const file=path.resolve(__dirname,'..',[...images][0]);assert(file.startsWith(path.resolve(__dirname,'..')+path.sep));
// The rank emblem follows the current official small favicon (site-metadata.json),
// so a brand refresh cannot leave player badges on a retired mark.
const metadata=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../site-metadata.json'),'utf8'));
assert.equal([...images][0],metadata.faviconSmall.path,'the badge uses the current official favicon');
const bytes=fs.readFileSync(file);assert.equal(bytes.toString('ascii',1,4),'PNG');assert.equal(bytes.readUInt32BE(16),32);assert.equal(bytes.readUInt32BE(20),32);
assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),'a5a3ddc9fee66a552de54570ae68c6ea664b8ec701b39eb0ef921d31b80ff0ec','the badge preserves the exact supplied image');
const game=new E({seed:21}),before=JSON.stringify(game.state);UI.badge(game.evaluation());assert.equal(JSON.stringify(game.state),before);assert.equal(JSON.stringify(D.evaluationRanks),snapshot);
for(const value of [null,{}, {version:1,rankIndex:16,rankName:'正一位'}, {...game.evaluation(),rankIndex:17}, {...game.evaluation(),score:NaN}])assert.equal(UI.badge(value),'','unconfirmed ranks must not display the emblem');
console.log('PASS all 17 court ranks show the unchanged supplied emblem, accessible labels, compact noninteractive badges and unchanged scoring.');
