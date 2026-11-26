'use strict';

// Distribution-only compaction must preserve fallback declarations, media
// order, precision and URLs. These fixtures cover cases used by the game and
// newer CSS values that an older optimizer must leave intact.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {gzipSync}=require('node:zlib');
const {transformSync}=require('esbuild');
const {compactCss}=require('../tools/compact-css.cjs');
const root=path.join(__dirname,'..');
let checks=0;
function test(name,run){run();checks++;console.log('PASS '+name);}

test('known redundant declarations shrink without changing selector specificity',()=>{
 const source='.panel{color:red;padding:1px}.panel.active{color:gold}@media(max-width:700px){.panel{color:blue}}.panel{color:green;padding:1px}';
 const result=compactCss(source);
 assert(Buffer.byteLength(result)<Buffer.byteLength(source));
 assert(!result.includes('color:red'),'the final identical selector always overrides this declaration');
 assert(result.includes('.panel.active{color:gold}'),'the higher specificity rule retains its exact selector');
 assert(result.endsWith('.panel{color:green;padding:1px}\n'));
 assert(!result.includes(':is(')&&!result.includes(':where('),'selector factoring is disabled');
});
test('responsive and feature conditions retain their order and never combine across intervening rules',()=>{
 const source='@media(max-width:600px){.a{color:red}}.a{color:black}@media(min-width:1200px){.a{color:gold}}@media(max-width:600px){.a{color:blue}}@supports(display:grid){.b{display:grid}}@supports not (display:grid){.b{display:block}}';
 const result=compactCss(source),conditions=text=>[...text.matchAll(/@(media|supports)([^{}]+)\{/g)].map(match=>match[0]);
 assert.deepEqual(conditions(result),conditions(source));
 assert(result.indexOf('.a{color:#000}')>result.indexOf('@media(max-width:600px)'));
 assert(result.indexOf('.a{color:#000}')<result.indexOf('@media(min-width:1200px)'));
 assert.equal((result.match(/@media\(max-width:600px\)/g)||[]).length,2);
});
test('modern units and unknown functions retain earlier supported fallbacks in source order',()=>{
 const source='.a{width:100px;width:10cqw;display:block;display:future-layout();color:red;color:color(display-p3 1 0 0);background:#fff;background:paint(future-paint);height:100vh;height:100dvh}';
 assert.equal(compactCss(source).trim(),source);
 const prefixed='.a{position:-webkit-sticky;position:sticky;display:-webkit-box;display:flex;-webkit-mask-image:url(mask.svg);mask-image:url(mask.svg)}';
 const result=compactCss(prefixed);assert(result.includes('position:-webkit-sticky;position:sticky'));assert(result.includes('display:-webkit-box;display:flex'));assert(result.includes('-webkit-mask-image:url(mask.svg);mask-image:url(mask.svg)'));
});
test('font shorthands preserve clamp sizes, line heights and fallback fonts without warnings',()=>{
 const sources=[
  '.title{font:bold clamp(1.15rem,4vw,1.45rem)/1.4 "Yu Mincho","Hiragino Mincho ProN",serif}',
  '.seal{font:600 clamp(19px,3vw,32px) Georgia,serif}',
  '.rank{font:750 clamp(.8125rem,8cqi,1.25rem)/1.12 Georgia,serif}',
  '.fallback{font:14px serif;font:clamp(1rem,2vw,2rem) serif!important}'
 ];
 for(const source of sources)assert.equal(compactCss(source).trim(),source);
});
test('custom properties, logical properties, content strings, URL fragments and precise values stay intact',()=>{
 const source='/*! Game asset license */.a{--color:red;--color:blue;color:var(--color,red);margin-left:2px;margin-inline-start:4px;opacity:.123456789;filter:blur(.001234567px)}.a::before{content:"a;{}:b";background-image:url("assets/a.svg?v=1#x")}@keyframes unused{0%{opacity:0}100%{opacity:1}}';
 assert.equal(compactCss(source).trim(),source,'no rounding, property sorting, URL rebasing, comment removal or unused-animation removal');
 const sourceWithImport='@import url("https://invalid.example/untouched.css");.a{color:red}';
 assert(compactCss(sourceWithImport).includes('@import url(https://invalid.example/untouched.css)'),'remote imports are preserved, never fetched or inlined');
});
test('the real stylesheet compacts reproducibly, remains parseable and decreases shipped bytes',()=>{
 const files=require('../tools/game-entry.json')['game-layout.bundle.css'];
 const source=files.map(file=>fs.readFileSync(path.join(root,file),'utf8')).join('\n');
 const options={loader:'css',target:['chrome90','firefox90','safari15'],charset:'utf8',minify:true,legalComments:'inline'};
 const baseline=transformSync(source,options);assert.equal(baseline.warnings.length,0);
 const first=compactCss(baseline.code),second=compactCss(baseline.code);
 assert.equal(first,second);assert.equal(createHash('sha256').update(first).digest('hex'),createHash('sha256').update(second).digest('hex'));
 const parsed=transformSync(first,options);assert.deepEqual(parsed.warnings,[]);
 const before=Buffer.byteLength(baseline.code),after=Buffer.byteLength(first),gzipBefore=gzipSync(baseline.code).length,gzipAfter=gzipSync(first).length;
 assert(after<before);assert(gzipAfter<gzipBefore);
 console.log(JSON.stringify({cssBytesBefore:before,cssBytesAfter:after,savedBytes:before-after,gzipBytesBefore:gzipBefore,gzipBytesAfter:gzipAfter}));
});

console.log(`${checks} CSS distribution compaction checks passed.`);
