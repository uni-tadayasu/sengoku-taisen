/* Authoritative noble purchases must not roll back later local actions on retry. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const {load,client}=require('./test-sync-snapshot-reuse.cjs');
const copy=value=>JSON.parse(JSON.stringify(value));
async function main(){
 const api=load(fs.readFileSync(require.resolve('../cloud-sync.js'),'utf8')),c=await client(api),now=2000000000000;
 const before=c.current(),revision=c.sync.getStatus().revision,purchased=copy(before);
 purchased.state.magatama=Math.max(0,purchased.state.magatama-1200);
 purchased.state.officers.push('kuge_sync_fixture');
 const result={ok:true,user:{id:'test',isAdmin:false,isStaff:false,courtMember:true},save:purchased,revision:revision+1,serverTime:new Date(now).toISOString(),writerDeviceId:c.sync.getDevice().id,leaseExpiresAt:new Date(now+30000).toISOString(),writable:true,receipt:{kind:'court_noble',officerId:'kuge_sync_fixture'}};
 assert.equal((await c.sync.acceptSnapshot(result,{reason:'court-noble-exchange'})).ok,true);
 assert.equal(c.current().state.magatama,purchased.state.magatama);assert(c.current().state.officers.includes('kuge_sync_fixture'));
 c.mutate(state=>{state.resources.gold+=73;state.resources.rice+=91;});c.persist();c.sync.notifySave();
 const later=c.current(),replayed=await c.sync.acceptSnapshot(result,{reason:'court-noble-exchange'});
 assert.equal(replayed.ok,true);assert.equal(replayed.superseded,true);assert.deepEqual(c.current(),later,'same-revision receipt must preserve later local gameplay');
 assert.equal((await c.sync.acceptSnapshot({...result,revision},{reason:'court-noble-exchange'})).superseded,true);assert.deepEqual(c.current(),later);
 assert.equal((await c.sync.acceptSnapshot({...result,user:{id:'another-player'},revision:revision+2},{reason:'court-noble-exchange'})).ok,false);assert.deepEqual(c.current(),later);
 c.sync.stop();
 console.log('PASS noble snapshot adopts the authoritative balance/officer, preserves later progress on replay, and rejects another player. No external requests.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
