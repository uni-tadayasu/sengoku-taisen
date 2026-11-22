const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const worker=fs.readFileSync(path.join(root,'sw.js'),'utf8'),manifest=JSON.parse(fs.readFileSync(path.join(root,'site-metadata.json'),'utf8'));
const context=vm.createContext({self:{addEventListener(){}}});
vm.runInContext(worker+';this.parse=shellEntries;this.release=RELEASE;',context);
assert.equal(context.release,manifest.release);
const urls=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m=>m[1].replaceAll('&amp;','&'));
const actual=new Set(context.parse(html).map(url=>url.replace(/^\.\//,'')));
for(const url of urls){
  const version=new URL(url,'https://game.example/').searchParams.get('v');
  assert(version===context.release||/^[a-f0-9]{12}$/.test(version),'Expected a release or content fingerprint: '+url);
  if(/^[a-f0-9]{12}$/.test(version))assert.equal(version,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root,url.split('?')[0]))).digest('hex').slice(0,12),'Content fingerprint must match '+url);
  assert(actual.has(url),'Offline entry omits '+url);
}
for(const url of actual)assert(fs.existsSync(path.join(root,url.split('?')[0])),'Missing local offline resource '+url);
const compact=[...actual].filter(url=>url.startsWith('assets/responsive/'));
assert.equal(compact.length,6);
assert(compact.reduce((bytes,url)=>bytes+fs.statSync(path.join(root,url)).size,0)<100*1024);
assert.equal(actual.size,new Set(urls).size+1+compact.length,'Only used entry scripts/styles, manifest and compact title illustrations belong in the installation');
assert.throws(()=>context.parse(html.replace('manifest.webmanifest?v='+context.release,'manifest.webmanifest?v=old')),'Never pair a new worker with an old document');
console.log('PASS offline entry includes '+urls.length+' fingerprinted scripts/styles and '+actual.size+' required resources.');
