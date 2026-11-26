'use strict';
// The guide index is public and optional; private JSON must never enter caches.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'sw.js'),'utf8');
const release=/const RELEASE='([^']+)'/.exec(source)[1];
const origin='https://game.example',scope=origin+'/strategy/';
const paths=['public-search.js?v='+release,'public-search-index.json?v='+release];
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.webp':'image/webp'};
function fixture({contentType,cacheControl='',status=200}={}){
 const events={},records=new Map(),calls=[];let connected=true;
 const key=value=>typeof value==='string'?value:value.url;
 const caches={open:async()=>({match:async request=>records.get(key(request))?.clone(),put:async(request,response)=>records.set(key(request),response.clone())})};
 const self={location:{origin},registration:{scope,active:{}},addEventListener:(name,handler)=>events[name]=handler};
 vm.runInNewContext(source,{self,caches,URL,Headers,Request,Response,fetch:async(request,options)=>{
  if(!connected)throw Error('offline');
  const url=new URL(key(request)),relative=url.pathname.slice(new URL(scope).pathname.length);
  calls.push({relative,credentials:options?.credentials});
  const body=fs.readFileSync(path.join(root,relative));
  const response=new Response(body,{status,headers:{'Content-Type':contentType||mime[path.extname(relative)]||'application/octet-stream','Cache-Control':cacheControl}});
  Object.defineProperty(response,'type',{value:'basic'});return response;
 }});
 async function emit(name,request){let answer;const pending=[];events[name]({request,respondWith:value=>{answer=value;},waitUntil:value=>pending.push(value)});const result=await answer;await Promise.all(pending);return result;}
 const request=(relative,options={})=>new Request(new URL(relative,scope),options);
 return{emit,request,records,calls,offline:()=>{connected=false;}};
}
(async()=>{
 const f=fixture();await f.emit('install');
 assert(!f.calls.some(call=>call.relative.startsWith('public-search')),'Installing the game never prefetches search');
 const initial=f.calls.length;
 for(const relative of paths){
  const response=await f.emit('fetch',f.request(relative));
  assert.equal(response.status,200);assert(f.records.has(new URL(relative,scope).href));
  assert.equal(f.calls.at(-1).credentials,'omit','Only public, unauthenticated search content is cached');
 }
 assert.equal(f.calls.length,initial+2);
 f.offline();
 for(const relative of paths){
  const response=await f.emit('fetch',f.request(relative));
  assert.equal(await response.text(),fs.readFileSync(path.join(root,relative.split('?')[0]),'utf8'));
 }
 assert.equal(f.calls.length,initial+2,'A visited public search remains available with no network');
 const requests=[
  f.request('save.json'),f.request('profile.json'),f.request('api/v1/public-search-index.json'),
  f.request('assets/public-search-index.json'),f.request(paths[1]+'&token=private'),
  f.request('public-search-index.json?query=castle'),f.request(paths[1],{method:'POST'}),
  f.request(paths[1],{headers:{Authorization:'Bearer fixture'}}),f.request(paths[1],{headers:{Cookie:'session=fixture'}}),
  f.request(paths[1],{headers:{Range:'bytes=0-2'}}),f.request(paths[1],{cache:'no-store'}),
  new Request('https://other.example/strategy/'+paths[1])
 ];
 for(const request of requests)assert.equal(await f.emit('fetch',request),undefined,'Private/unrelated request bypasses worker: '+request.url);
 for(const options of [{contentType:'text/html'},{contentType:'text/plain'},{cacheControl:'private, max-age=3600'},{cacheControl:'no-store'},{status:404}]){
  const bad=fixture(options);await bad.emit('fetch',bad.request(paths[1]));assert.equal(bad.records.size,0,'Unusable/non-public index is never persisted');
 }
 const charset=fixture({contentType:'application/json; charset=utf-8'});await charset.emit('fetch',charset.request(paths[1]));assert.equal(charset.records.size,1);
 console.log('PASS search is cached only after use, remains available offline, validates JSON MIME and bypasses private/unrelated requests.');
})().catch(error=>{console.error(error);process.exitCode=1;});
