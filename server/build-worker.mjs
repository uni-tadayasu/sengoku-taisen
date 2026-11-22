import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';

// The Worker uses a deliberately small ESM subset: local named/side-effect
// imports and named/default declarations. Resolve dependencies before wrapping
// each module, so private helper names never collide in the production bundle.
export async function buildWorker(sourceDirectory,outputFile){
 const root=resolve(sourceDirectory),modules=new Map(),visiting=new Set(),order=[];
 const importPattern=/^import\s+(?:\{([^}]+)\}\s+from\s+)?['"]([^'"]+)['"];?\s*$/gm;
 async function visit(file){
  if(modules.has(file))return;if(visiting.has(file))throw Error('Circular Worker dependency: '+file);visiting.add(file);
  let source=await readFile(file,'utf8');const imports=[...source.matchAll(importPattern)];
  for(const match of imports){if(!match[2].startsWith('./'))throw Error('Unsupported Worker dependency '+match[2]);await visit(resolve(dirname(file),match[2]));}
  source=source.replace(importPattern,(_whole,names,path)=>names?'const {'+names.replace(/\s+as\s+/g,':')+'}=__workerModules['+JSON.stringify(relative(root,resolve(dirname(file),path)))+'];':'');
  const names=[...source.matchAll(/^export\s+(?:async\s+)?(?:function|const|let|class)\s+(\w+)/gm)].map(v=>v[1]);
  const hasDefault=/^export default /m.test(source);source=source.replace(/^export default /m,'const __defaultExport=').replace(/^export /gm,'');
  if(/^\s*(?:import|export)\s/m.test(source))throw Error('Unsupported module syntax in '+file);
  modules.set(file,{source,names,hasDefault});order.push(file);visiting.delete(file);
 }
 const entry=resolve(root,'index.js');await visit(entry);
 const pieces=['// Generated from the exact checked-in Worker modules.','const __workerModules=Object.create(null);'];
 for(const file of order){const m=modules.get(file),exports=m.names.map(n=>n+':'+n);if(m.hasDefault)exports.push('default:__defaultExport');pieces.push('__workerModules['+JSON.stringify(relative(root,file))+']=(()=>{\n'+m.source+'\nreturn {'+exports.join(',')+'};\n})();');}
 pieces.push('export default __workerModules["index.js"].default;');
 await mkdir(dirname(resolve(outputFile)),{recursive:true});await writeFile(outputFile,pieces.join('\n'));
 return{modules:order.length,outputFile:resolve(outputFile)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){console.log(await buildWorker(process.argv[2]||new URL('.',import.meta.url).pathname,process.argv[3]||'/tmp/sengoku-worker-bundle.mjs'));}
