'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const files=['index.html','guide/index.html','guide/data-recovery/index.html','sengoku-vs/index.html','about/index.html','premium/index.html','tools/music-audition.html','404.html'];
const attr=(tag,key)=>new RegExp(`\\b${key}="([^"]*)"`).exec(tag)?.[1];
const checked=new Set();
for(const file of files){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const tags=html.match(/<(?:img|source|link)\b[^>]*>/g).filter(tag=>attr(tag,'srcset')||attr(tag,'imagesrcset'));
 assert(tags.length,file+' has no responsive illustration');
 for(const tag of tags){
  const sizes=attr(tag,'sizes')||attr(tag,'imagesizes');assert(sizes,file+' lacks a rendered size');
  const candidates=(attr(tag,'srcset')||attr(tag,'imagesrcset')).split(',');let previous=0;
  for(const candidate of candidates){
   const [url,descriptor]=candidate.trim().split(/\s+/),width=Number(descriptor.slice(0,-1));
   assert(/^\d+w$/.test(descriptor)&&width>previous,`${file}: ${candidate}`);previous=width;
   const asset=url.startsWith('/')?path.join(root,url.slice(1)):path.resolve(root,path.dirname(file),url);
   assert(fs.statSync(asset).size>0,asset);assert.equal(path.basename(asset).split('-').at(-1),`${width}.webp`);checked.add(asset);
  }
 }
 if(file==='index.html'){
  const preloads=tags.filter(tag=>tag.startsWith('<link')&&attr(tag,'as')==='image');assert.equal(preloads.length,1);
  const hero=tags.find(tag=>tag.startsWith('<img')&&attr(tag,'fetchpriority')==='high');assert(hero);
  assert.equal(attr(preloads[0],'imagesrcset'),attr(hero,'srcset'));assert.equal(attr(preloads[0],'imagesizes'),attr(hero,'sizes'));assert.equal(attr(preloads[0],'href'),attr(hero,'src'));
 }
}
console.log(`PASS responsive artwork for ${files.length} pages, ${checked.size} referenced image variants and matching title preload.`);
