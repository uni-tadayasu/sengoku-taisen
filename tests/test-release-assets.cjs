const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const entryURLs=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m=>m[1]);
assert(entryURLs.length>=20,'Expected the complete game entry asset set');
const versions=new Set(entryURLs.map(p=>new URL(p,'https://game.example/').searchParams.get('v')));
assert.equal(versions.size,1,'Every script and stylesheet must belong to one release');
assert(!versions.has(null),'Unversioned scripts can mix with stale browser cache entries');
const context=vm.createContext({});
vm.runInContext(sw.slice(0,sw.indexOf("self.addEventListener('install'"))+';this.entries=CORE;this.release=RELEASE;',context);
assert.equal(context.release,[...versions][0]);
const cached=new Set(context.entries.map(p=>p.replace(/^\.\//,'')));
for(const url of entryURLs){
  assert(cached.has(url),'Offline cache omits entry asset '+url);
  assert(fs.existsSync(path.join(root,url.split('?')[0])),'Missing local entry asset '+url);
}
for(const url of context.entries)assert(fs.existsSync(path.join(root,url.split('?')[0])),'Missing cached asset '+url);
console.log('PASS coherent versioned boot: '+entryURLs.length+' scripts/styles and '+cached.size+' cache entries exist and share one release.');
