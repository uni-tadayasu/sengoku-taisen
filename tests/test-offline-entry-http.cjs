'use strict';
const assert=require('node:assert/strict');
const {readFile}=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const vm=require('node:vm');

// The worker uses actual HTTP, Request and Response streams. CacheStorage and
// lifecycle events are in-memory so the suite never contacts game services.
(async()=>{
  const root=path.resolve(__dirname,'..'),requests=[];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost'),name=url.pathname.replace(/^\/game\//,'').replace(/\/$/,'/index.html')||'index.html';
    requests.push(req.url);
    try{
      const file=await readFile(path.join(root,name)),mime={'.js':'text/javascript','.css':'text/css','.html':'text/html','.webmanifest':'application/manifest+json','.webp':'image/webp'}[path.extname(name)];
      res.writeHead(200,{'Content-Type':mime||'application/octet-stream','Cache-Control':'public, max-age=600'});res.end(file);
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const origin='http://127.0.0.1:'+server.address().port,scope=origin+'/game/',events={},records=new Map(),stored=new Map();
    const cache={async match(key){return records.get(key)?.clone();},async put(key,response){const bytes=await response.arrayBuffer();stored.set(key,bytes.byteLength);records.set(key,new Response(bytes,{headers:response.headers,status:response.status}));}};
    let connected=true,skipped=0;
    const self={location:{origin},registration:{scope},clients:{claim:async()=>{}},skipWaiting:async()=>{skipped++;},addEventListener:(type,cb)=>{events[type]=cb;}};
    const browserFetch=async(target,opts)=>{
      if(!connected)throw Error('offline');
      const response=await fetch(typeof target==='string'?target:target.url,opts);
      Object.defineProperty(response,'type',{value:'basic'});
      return response;
    };
    const source=await readFile(path.join(root,'sw.js'),'utf8');
    vm.runInNewContext(source,{self,Request,Response,URL,Headers,fetch:browserFetch,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>false}});
    async function emit(type,request){
      const waits=[];let answer;
      events[type]({request,waitUntil:job=>waits.push(job),respondWith:job=>{answer=job;}});
      const result=await answer;await Promise.all(waits);return result;
    }
    const request=(relative,mode='cors',params={})=>({method:'GET',url:new URL(relative,scope).href,mode,headers:new Headers(),...params});
    await emit('install');await emit('activate');assert.equal(skipped,1);
    const installRequests=requests.length,installBytes=[...stored.values()].reduce((sum,n)=>sum+n,0);
    const brandEdition=/-(\d{8}(?:-[a-z]+)?)\.png$/.exec(JSON.parse(await readFile(path.join(root,'site-metadata.json'),'utf8')).favicon.path)[1];
    const chapters=['war','town','archive'];
    const installedArt=['neon-command-480',...chapters.map(name=>name+'-jade-240'),'brand-'+brandEdition+'-48','emblem-'+brandEdition+'-96'];
    assert.deepEqual([...stored.keys()].filter(key=>key.startsWith(scope+'assets/')).sort(),installedArt.map(stem=>scope+'assets/responsive/'+stem+'.webp').sort(),'Install only the six compact illustrations');
    const home=await (await emit('fetch',request('./','navigate'))).text();
    const scripts=[...home.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m=>m[1].replaceAll('&amp;','&'));
    for(const file of scripts)assert((await (await emit('fetch',request(file))).arrayBuffer()).byteLength>100);
    assert.equal(requests.length,installRequests,'Warm navigation and every entry asset were served without network');
    const map=/<meta name="sengoku-geography" content="([^"]+)"/.exec(home)?.[1];
    assert(map&&!requests.some(p=>p.includes('/map-data.js')));
    const onlineMap=await (await emit('fetch',request(map))).text();assert(onlineMap.length>100000);
    const guide=await (await emit('fetch',request('guide/','navigate'))).text();
    connected=false;
    assert.equal(await (await emit('fetch',request(map))).text(),onlineMap);
    assert.equal(await (await emit('fetch',request('guide/','navigate'))).text(),guide);
    assert.equal(await (await emit('fetch',request('./?notice=1','navigate'))).text(),home);
    async function matchesCompact(file,stem){
      const actual=await emit('fetch',request(file)),expected=records.get(scope+'assets/responsive/'+stem+'.webp');
      assert.equal(actual.headers.get('Content-Type'),'image/webp',file);
      assert.deepEqual(Buffer.from(await actual.arrayBuffer()),Buffer.from(await expected.clone().arrayBuffer()),file);
    }
    await matchesCompact('assets/responsive/neon-command-1536.webp','neon-command-480');
    for(const name of chapters){
      const stem=name+'-jade';
      await matchesCompact('assets/responsive/'+stem+'-1200.webp',stem+'-240');
      await matchesCompact('assets/responsive/'+stem+'-panel-900.webp',stem+'-240');
      await matchesCompact('assets/chronicle/'+stem+'.webp',stem+'-240');
      await matchesCompact('assets/responsive/'+name+'-panel-640.webp',stem+'-240');
    }
    await matchesCompact('assets/responsive/brand-'+brandEdition+'-144.webp','brand-'+brandEdition+'-48');
    await matchesCompact('assets/responsive/emblem-'+brandEdition+'-192.webp','emblem-'+brandEdition+'-96');
    assert.equal((await emit('fetch',request('assets/responsive/other-panel-900.webp'))).type,'error');
    assert.equal(await emit('fetch',request('api/v1/me')),undefined);
    assert.equal(await emit('fetch',request('assets/example.webp','cors',{headers:new Headers({Authorization:'Bearer local-test'})})),undefined);
    assert(![...records.keys()].some(key=>/notice=|api\/|token=/.test(key)));
    assert.equal(requests.length,installRequests+2);
    console.log(JSON.stringify({installRequests,installBytes,warmNavigationNetworkRequests:0,offlineEntryAssets:scripts.length,offlineMap:true,offlineGuide:true,offlineArtworkFallback:true}));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
