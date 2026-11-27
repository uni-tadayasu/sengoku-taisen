'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const origin = 'https://game.example';
const source = fs.readFileSync(path.join(__dirname,'../sw.js'),'utf8');
const release = source.match(/const RELEASE='([^']+)'/)[1];
const track = origin + '/game/assets/music/town-dawn.mp3?v=' + release;
const catalog = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../music.js'),'utf8'),catalog);
const supplied = ['shitaku','asakatsu','hirukatsu','yorukatsu'].map(id=>{
  const entry=catalog.SENGOKU_MUSIC_TRACKS.find(item=>item.id===id);assert(entry,id+' exists in the real player catalogue');return entry;
});
supplied.push(catalog.SENGOKU_BROADCAST_TRACK);
const body = Uint8Array.from([12,21,33,46,57,62,74,84]);
const cache = new Map(), events = {};
let offline = false, policy = '', calls = 0, expectedTrack = track;
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
    assert.equal(request.url,expectedTrack);
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
  // Exercise the exact URLs the player requests, not URLs manufactured from
  // RELEASE: a mismatched catalogue query used to bypass this entire route.
  for(const entry of supplied){
    expectedTrack=new URL(entry.recording,scope).href;
    assert.equal(new URL(expectedTrack).search,'','release cache, not a stale fixed query, versions supplied recordings');
    cache.clear();offline=false;policy='';calls=0;
    const initial=dispatch(expectedTrack,{Range:'bytes=0-2'}),concurrent=dispatch(expectedTrack,{Range:'bytes=3-'});
    assert(initial&&concurrent,entry.id+' is handled by the service worker');
    const [start,end]=await Promise.all([initial,concurrent]);assert.equal(calls,1,entry.id+' downloads once');assert(cache.has(expectedTrack));
    assert.equal(start.status,206);assert.equal(start.headers.get('Content-Type'),'audio/mpeg');assert.equal(start.headers.get('Content-Range'),'bytes 0-2/8');
    assert.deepEqual([...new Uint8Array(await start.arrayBuffer())],[12,21,33]);assert.deepEqual([...new Uint8Array(await end.arrayBuffer())],[46,57,62,74,84]);
    offline=true;
    const complete=await dispatch(expectedTrack),seek=await dispatch(expectedTrack,{Range:'bytes=-2'});
    assert.equal(complete.status,200);assert.deepEqual([...new Uint8Array(await complete.arrayBuffer())],[...body]);
    assert.equal(seek.status,206);assert.deepEqual([...new Uint8Array(await seek.arrayBuffer())],[74,84]);assert.equal(calls,1,entry.id+' plays and seeks from cache offline');
  }
  console.log('PASS complete and partial BGM playback, one download, offline seeking, bounded ranges and private response bypass.');
  console.log('PASS supplied and broadcast recording URLs use the same cache/range route and remain independent of release query values.');
})().catch(error=>{console.error(error);process.exitCode=1;});
