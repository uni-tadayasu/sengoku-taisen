#!/usr/bin/env node
/** Packages 戦国VS / SENGOKU VS as a complete, directly openable folder ZIP. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2);
const option=name=>{const i=args.indexOf(name);return i<0?null:args[i+1];};
if(args.includes('--help')){console.log('戦国VS / SENGOKU VS — ダウンロードビルド\nnode tools/build-download.mjs --dist /absolute/game --out /absolute/downloads');process.exit(0);}
const distInput=option('--dist')??(!args[0]?.startsWith('--')?args[0]:null);
const outInput=option('--out')??(!args[0]?.startsWith('--')?args[1]:null);
if(!distInput||!outInput||!path.isAbsolute(distInput)||!path.isAbsolute(outInput))throw Error('Provide absolute --dist and --out paths.');
const dist=await fs.realpath(distInput),out=path.resolve(outInput);
if(out===dist||out.startsWith(dist+path.sep))throw Error('Output must be outside the game directory.');
const check=spawnSync(process.execPath,[path.join(dist,'tools/build-art-manifest.cjs'),'--check'],{encoding:'utf8'});
if(check.status!==0)throw Error('Artwork validation failed:\n'+check.stdout+check.stderr);
await fs.mkdir(out,{recursive:true});
const staging=await fs.mkdtemp(path.join(os.tmpdir(),'sengoku-download-'));
// Keep the historical ZIP and folder names for existing download links and scripts.
const zipPath=path.join(out,'sengoku-taisen-download.zip');
const skip=new Set(['.git','.openai','node_modules','qa-mobile.html','sengoku-tento-offline.html','castle-town.png']);
let fileCount=0,sourceBytes=0;
try{
 const packageRoot=path.join(staging,'sengoku-taisen');
 async function copyFolder(source,target){
  await fs.mkdir(target,{recursive:true});
  for(const entry of await fs.readdir(source,{withFileTypes:true})){
   if(skip.has(entry.name)||entry.name.startsWith('.env')||entry.name.endsWith('.zip')||(entry.name.startsWith('.')&&entry.name!=='.nojekyll'))continue;
   // Keep the download aligned with the published game. The original contact
   // sheets are production references; all playable cells use the final atlases.
   if(path.relative(dist,source)==='assets/illustrations'&&!/^officers-(?:D|C|B|A|S|SS|SSS|U)-\d{2}\.webp$/.test(entry.name))continue;
   const src=path.join(source,entry.name),dst=path.join(target,entry.name);
   if(entry.isDirectory())await copyFolder(src,dst);
   else if(entry.isFile()){await fs.copyFile(src,dst);fileCount++;sourceBytes+=(await fs.stat(src)).size;}
  }
 }
 await copyFolder(dist,packageRoot);
 await fs.copyFile(path.join(dist,'tools/README-ja.txt'),path.join(packageRoot,'README-ja.txt'));
 await fs.rm(zipPath,{force:true});
 const zipped=spawnSync('zip',['-q','-r','-9',zipPath,'sengoku-taisen'],{cwd:staging,encoding:'utf8'});
 if(zipped.status!==0)throw Error('ZIP creation failed: '+zipped.stderr);
 const result={file:zipPath,files:fileCount+1,sourceBytes,zipBytes:(await fs.stat(zipPath)).size,sha256:createHash('sha256').update(await fs.readFile(zipPath)).digest('hex'),illustrations:8192};
 await fs.writeFile(path.join(out,'download-manifest.json'),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result,null,2));
}finally{await fs.rm(staging,{recursive:true,force:true});}
