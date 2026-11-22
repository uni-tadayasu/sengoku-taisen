'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const origin = 'https://game.example';
const source = fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const release = source.match(/const RELEASE='([^']+)'/)[1];
const track = origin + '/game/assets/music/town-dawn.mp3?v=' + release;
const body = Uint8Array.from([12,21,33,46,57,62,74,84]);
const cache = new Map(), events = {};
let offline = false, policy = '', calls = 0;
const scope = origin + '/game/';
const cacheAPI = {
  match:async key=>cache.get(typeof key==='string'?key:key.url)?.clone(),
  put:async (key,r)=>cache.set(key,r.clone())
};
vm.runInNewContext(source,{
  self:{registration:{scope},location:{origin},addEventListener:(event,listener)=>events[event]=listener},
  URL,Headers,Request,Response,caches:{open:async()=>cacheAPI},
  fetch:async request=>{
    calls++;
    assert.equal(request.url,track);
    assert.equal(request.headers.get('Range'),null);
    if(offline)throw Error('offline');
    const response = new Response(body,{headers:{'Content-Type':'audio/mpeg','Cache-Control':policy}});
    Object.defineProperty(response,'type',{value:'basic'});
    return response;
  }
});
function dispatch(url, headers={}) {
  let promise;
  events.fetch({request:new Request(url,{headers}),respondWith:r=>promise=r});
  return promise;
}
(async()=>{
  const [first,second]=await Promise.all([dispatch(track,{Range:'bytes=1-3'}),dispatch(track,{Range:'bytes=4-'})]);
  assert.equal(calls,1);assert(cache.has(track));
  assert.equal(first.status,206);assert.equal(first.headers.get('Content-Range'),'bytes 1-3/8');
  assert.deepEqual([...new Uint8Array(await first.arrayBuffer())],[21,33,46]);
  assert.deepEqual([...new Uint8Array(await second.arrayBuffer())],[57,62,74,84]);
  offline=true;
  const full=await dispatch(track);assert.equal(full.status,200);assert.deepEqual([...new Uint8Array(await full.arrayBuffer())],[...body]);
  const suffix=await dispatch(track,{Range:'bytes=-2'});assert.equal(suffix.headers.get('Content-Length'),'2');
  assert.deepEqual([...new Uint8Array(await suffix.arrayBuffer())],[74,84]);
  const invalid=await dispatch(track,{Range:'bytes=10-12'});assert.equal(invalid.status,416);assert.equal(invalid.headers.get('Content-Range'),'bytes */8');
  assert.equal(dispatch(track,{Range:'bytes=0-1,3-5'}),undefined);
  assert.equal(dispatch(track,{Range:'bytes=0-1','If-Range':'etag'}),undefined);
  assert.equal(dispatch(track,{Authorization:'Bearer fixture'}),undefined);
  assert.equal(dispatch(track,{'Cache-Control':'no-store'}),undefined);
  assert.equal(dispatch(track+'&extra=1',{Range:'bytes=0-'}),undefined);
  assert.equal(dispatch(track.replace(release,'old-version')),undefined);
  assert.equal(dispatch(origin+'/game/assets/music/unknown.mp3'),undefined);
  assert.equal(dispatch(origin+'/game/assets/music/unknown.mp3',{Range:'bytes=0-'}),undefined);
  assert.equal(calls,1);
  cache.clear();policy='private, no-store';offline=false;
  assert.equal((await dispatch(track,{Range:'bytes=0-2'})).status,206);assert.equal(cache.size,0);
  console.log('PASS complete and partial BGM playback, one download, offline seeking, bounded ranges and private response bypass.');
})().catch(error=>{console.error(error);process.exitCode=1;});
