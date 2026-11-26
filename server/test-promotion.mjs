import assert from 'node:assert/strict';
import worker from './index.js';
import {harness} from './test-support.mjs';

const origin = 'https://www.kasai-solutions-inc.com';
const sum = h => Number(h.sql.prepare('SELECT COALESCE(SUM(count),0) n FROM promotion_daily').get().n);
const event = (h,source='press',name='landing',extra={}) => h.api('/promotion/event',{method:'POST',body:{event:name,source},...extra});
async function operator(h,name='集計を確認する運営') {
  const actor = await h.session(name);
  await h.api('/admin/claim',{method:'POST',token:actor.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});
  return actor;
}
let checks=0,calls=0;
async function scenario(name,run) {
  const h=harness();h.now=Date.parse('2026-11-26T03:00:00Z');
  try {await run(h);checks++;console.log('PASS '+name);}
  finally {calls+=h.calls;h.close();}
}

await scenario('anonymous events contain only fixed day/source/event counters and avoid gameplay work',async h=>{
  const columns=h.sql.prepare('PRAGMA table_info(promotion_daily)').all().map(row=>row.name);
  assert.deepEqual(columns,['day','source','event','count']);
  const beforeUsers=h.sql.prepare('SELECT COUNT(*) n FROM users').get().n;
  let background=0;
  const response=await worker.fetch(new Request('https://local.invalid/api/v1/promotion/event',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'192.0.2.99',Cookie:'ignored=private',Authorization:'Bearer invalid-and-ignored'},body:JSON.stringify({event:'landing',source:'press'})}),h.env,{waitUntil(){background++;}});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,accepted:true});
  assert.equal(background,0);assert.equal(sum(h),1);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM users').get().n,beforeUsers);
  assert.deepEqual(h.sql.prepare('SELECT scope FROM rate_limits ORDER BY scope').all().map(row=>row.scope),['promotion:day','promotion:minute']);
  assert.deepEqual({...h.sql.prepare('SELECT * FROM promotion_daily').get()},{day:'2026-11-26',source:'press',event:'landing',count:1});
  for(const source of ['direct','x','line','youtube','friend','discord','copy_link','share_text','native_share','english','other'])await event(h,source);
  await event(h,'press','play_click');
  assert.equal(sum(h),13);
});

await scenario('unknown fields, personal data, invalid values and oversized requests never increment',async h=>{
  for(const body of [{event:'landing',source:'unknown'},{event:'signup',source:'x'},{event:'landing',source:{name:'x'}},{event:'landing'}, {},{event:'landing',source:'x',url:'https://example.invalid/private'},{event:'landing',source:'x',playerId:'u_private'},{event:'landing',source:'x',campaign:'test'},[]]) {
    await h.api('/promotion/event',{method:'POST',body,expected:400});
  }
  await h.api('/promotion/event',{method:'POST',rawBody:'{"event":"landing","source":"'+ 'x'.repeat(300)+'"}',expected:413});
  await h.api('/promotion/event',{method:'POST',rawBody:'{broken',expected:400});
  const response=await worker.fetch(new Request('https://local.invalid/api/v1/promotion/event',{method:'POST',headers:{Origin:origin,'Content-Type':'text/plain'},body:'{"event":"landing","source":"x"}'}),h.env,{});
  assert.equal(response.status,415);assert.equal(sum(h),0);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM rate_limits').get().n,0);
});

await scenario('official origins and preflight work while foreign, missing and file origins are rejected',async h=>{
  for(const allowed of [origin,'https://uni-tadayasu.github.io']) {
    const posted=await event(h,'x','landing',{origin:allowed});
    assert.equal(posted.response.headers.get('access-control-allow-origin'),allowed);
    assert.equal(posted.response.headers.get('access-control-allow-credentials'),null);
    const preflight=await h.api('/promotion/event',{method:'OPTIONS',origin:allowed,expected:204});
    assert.equal(preflight.response.headers.get('access-control-allow-origin'),allowed);
  }
  for(const denied of ['https://example.invalid','null',null,'http://127.0.0.1:4173','https://local.invalid']) {
    await event(h,'x','landing',{origin:denied,expected:403});
    await h.api('/promotion/event',{method:'OPTIONS',origin:denied,expected:403});
  }
  assert.equal(sum(h),2);
});

await scenario('concurrent increments are atomic and JST midnight creates a separate day',async h=>{
  h.now=Date.parse('2026-11-26T14:59:59Z');
  await Promise.all(Array.from({length:48},()=>event(h)));
  assert.equal(sum(h),48);assert.equal(h.sql.prepare('SELECT count FROM promotion_daily WHERE day=?').get('2026-11-26').count,48);
  h.now=Date.parse('2026-11-26T15:00:00Z');await event(h);
  assert.equal(sum(h),49);assert.equal(h.sql.prepare('SELECT count FROM promotion_daily WHERE day=?').get('2026-11-27').count,1);
});

await scenario('fixed global quotas cap writes without a visitor key and recover at the boundary',async h=>{
  await event(h);
  h.sql.prepare('UPDATE rate_limits SET count=120 WHERE scope=?').run('promotion:minute');
  const limited=await event(h,'press','landing',{expected:429});
  assert.equal(limited.data.error.code,'RATE_LIMITED');assert.equal(sum(h),1);assert(limited.response.headers.get('retry-after'));
  h.now+=60000;await event(h);assert.equal(sum(h),2);
  h.sql.prepare('UPDATE rate_limits SET count=6000 WHERE scope=?').run('promotion:day');
  await event(h,'press','landing',{expected:429});assert.equal(sum(h),2);
  h.now+=86400000;await event(h);assert.equal(sum(h),3);
  assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM rate_limits WHERE scope LIKE ?').get('promotion:%').n,2);
});

await scenario('reports require the sole current operator and expose counts without identity rows',async h=>{
  const admin=await operator(h),player=await h.session('一般の登録者'),staff=await h.session('集計不可のスタッフ');
  await h.api('/admin/staff',{method:'POST',token:admin.token,body:{targetPlayerId:staff.user.id,action:'appoint',requestId:crypto.randomUUID()}});
  h.sql.prepare('UPDATE users SET created_at=? WHERE id=?').run(Date.parse('2026-10-01T00:00:00Z'),player.user.id);
  await event(h,'x');await event(h,'x','play_click');await event(h,'line');
  await h.api('/admin/promotion',{expected:401});
  await h.api('/admin/promotion',{token:player.token,expected:403});
  await h.api('/admin/promotion',{token:staff.token,expected:403});
  const report=(await h.api('/admin/promotion?days=14',{token:admin.token})).data;
  assert.deepEqual(report.range,{from:'2026-11-13',to:'2026-11-26',days:14});
  assert.deepEqual(report.accounts,{total:3,createdInRange:2});
  assert.deepEqual(report.totals,{landing:2,play_click:1});assert.equal(report.events.length,3);
  for(const actor of [admin,player,staff]){assert(!JSON.stringify(report).includes(actor.user.id));assert(!JSON.stringify(report).includes(actor.user.name));assert(!JSON.stringify(report).includes(actor.token));}
  for(const query of ['days=0','days=91','days=01','days=1.5','days=1&days=2','days=1&name=private'])await h.api('/admin/promotion?'+query,{token:admin.token,expected:400});
  h.sql.prepare("UPDATE settings SET value=? WHERE key='adminUserId'").run(player.user.id);
  await h.api('/admin/promotion',{token:admin.token,expected:403});
});

await scenario('operator revocation around the aggregate transaction cannot leak a report',async h=>{
  const admin=await operator(h);await event(h);let hit=false;
  h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('FROM promotion_daily'))){h.beforeBatch=null;hit=true;h.sql.exec("DELETE FROM settings WHERE key='adminUserId'");}};
  const first=(await h.api('/admin/promotion',{token:admin.token,expected:403})).data;
  assert(hit);assert.equal(first.events,undefined);assert.equal(first.accounts,undefined);
  h.sql.prepare("INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?)").run(admin.user.id,h.now);hit=false;
  h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('FROM promotion_daily'))){h.afterBatch=null;hit=true;h.sql.exec("DELETE FROM settings WHERE key='adminUserId'");}};
  const second=(await h.api('/admin/promotion',{token:admin.token,expected:403})).data;
  assert(hit);assert.equal(second.events,undefined);assert.equal(second.accounts,undefined);
});

await scenario('a missing analytics migration fails only analytics and preserves game health/config',async h=>{
  const admin=await operator(h);
  h.sql.exec('DROP TABLE promotion_daily');
  const ingestion=(await event(h,'press','landing',{expected:503})).data;assert.equal(ingestion.error.code,'PROMOTION_UNAVAILABLE');
  const report=(await h.api('/admin/promotion',{token:admin.token,expected:503})).data;assert.equal(report.error.code,'PROMOTION_UNAVAILABLE');
  assert.equal((await h.api('/health')).data.status,'ready');
  assert.equal((await h.api('/config')).data.ok,true);
});

console.log(`Promotion aggregate: ${checks} scenarios, ${calls} local Worker calls passed.`);
