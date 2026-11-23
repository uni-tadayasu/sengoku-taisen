import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {harness} from './test-support.mjs';
import {GameEngine} from './game-runtime.js';
import {conquestBattle} from './conquest.js';
const require=createRequire(import.meta.url),{battlePreview,markup,createController,cleanData}=require('../conquest.js');
const SAT=Date.parse('2026-11-21T03:00:00Z');let scopes=0,calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const read=async(h,p)=>(await h.api('/conquest',{token:p.token})).data;
async function scope(name,run){const h=harness();h.now=SAT;try{await run(h);scopes++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function player(h,name='耐久検証'){
 const p=await h.session(name),g=(await h.api('/guild',post(p,{name}))).data.guild,d=await read(h,p);
 await h.api('/conquest/join',post(p,{seasonId:d.season.id,requestId:crypto.randomUUID()}));return{p,g};
}
const castleRow=(h,d,id='inuyama')=>h.sql.prepare('SELECT * FROM conquest_castles WHERE season_id=? AND castle_id=?').get(d.season.id,id);
const body=(d,id='inuyama',extra={})=>({seasonId:d.season.id,requestId:crypto.randomUUID(),action:'attack',castleId:id,troops:2500,tactic:'balanced',expectedGuildRevision:d.guild.revision,expectedCastleRevision:d.castles.find(c=>c.id===id).revision,...extra});
async function fight(h,p,data,extra={}){const action=body(data,'inuyama',extra),launched=(await h.api('/conquest/action',post(p,action))).data;h.now=launched.march.arrivesAtMs;const view=await read(h,p),receipt=view.records.find(r=>r.action==='attack');return{action,launched,view,battle:receipt.battle};}
const freeze=(h,elapsedMs=0)=>h.sql.prepare("UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=0,revision=revision+1 WHERE id='world-v1'").run(elapsedMs,h.now);

await scope('all legacy shared castles begin full with no read-time ledger writes',async h=>{
 const {p}=await player(h),d=await read(h,p);assert.equal(d.castles.length,129);
 for(const c of d.castles){assert(c.durability.max>0);assert.equal(c.durability.current,c.durability.max);assert.equal(c.durability.fortificationFactor,1);}
 assert(d.castles.find(c=>c.id==='kyoto_gosho').durability.max>d.castles.find(c=>c.id==='edo').durability.max);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM conquest_castles WHERE durability_json IS NOT NULL').get().n,0);
 const revisions=d.castles.map(c=>c.revision);h.now+=30000;assert.deepEqual((await read(h,p)).castles.map(c=>c.revision),revisions);
});

await scope('defense and preview agree for full, damaged and zero durability in all tactics',async h=>{
 const {p}=await player(h),d=await read(h,p),c=d.castles.find(c=>c.id==='inuyama');
 for(const ratio of [1,.4,0])for(const tactic of ['balanced','assault','siege','ambush']){
  c.durability={version:1,current:Math.round(c.durability.max*ratio),max:c.durability.max,updatedElapsedMs:0};
  const result=conquestBattle({troops:1100,tactic,garrison:c.garrison,wall:c.wall,castleId:c.id,durability:c.durability}),preview=battlePreview(d,{castleId:c.id,action:'attack',troops:'1100',tactic},h.now);
  assert.equal(preview.defense,result.defensePower);assert.equal(preview.win,result.won);assert.equal(preview.cost,result.supplyCost);assert(result.defensePower>=c.garrison+150);
 }
 c.durability.current=c.durability.max;const whole=conquestBattle({troops:1100,garrison:c.garrison,wall:c.wall,castleId:c.id,durability:c.durability});c.durability.current=0;const broken=conquestBattle({troops:1100,garrison:c.garrison,wall:c.wall,castleId:c.id,durability:c.durability});assert(whole.defensePower>broken.defensePower);
 const invalid=structuredClone(d);invalid.castles[0].durability.current=-1;assert.throws(()=>cleanData(invalid),/耐久/);
 const controller=createController({getContext:()=>({playerId:p.user.id,guildId:d.guild.id}),request:async()=>d,now:()=>h.now,storage:null});await controller.load();const html=markup(controller.snapshot());assert.match(html,/耐久/);assert.match(html,/10%/);assert(!html.includes('NaN'));controller.dispose();
});

await scope('failed siege persists damage once and returns the unchanged owner',async h=>{
 const {p}=await player(h),d=await read(h,p),initial=d.castles.find(c=>c.id==='inuyama').durability;freeze(h);
 const {action,view,battle}=await fight(h,p,d,{troops:100});assert.equal(battle.won,false);assert.equal(battle.durability.before,initial.max);assert(battle.durability.damage>0);assert.equal(battle.durability.after,initial.max-battle.durability.damage);
 const stored=castleRow(h,d);assert.equal(stored.owner_guild_id,null);assert.equal(stored.revision,1);assert.deepEqual(JSON.parse(stored.durability_json),battle.durability.record);assert.equal(view.castles.find(c=>c.id==='inuyama').durability.current,battle.durability.after);
 const replay=(await h.api('/conquest/action',post(p,action))).data;assert.equal(replay.idempotent,true);assert.deepEqual(replay.result.battle.durability,battle.durability);assert.deepEqual(castleRow(h,d),stored);
});

await scope('capture breaches then restores one quarter of the resulting wall capacity',async h=>{
 const {p,g}=await player(h);let d=await read(h,p);freeze(h);h.sql.prepare('UPDATE conquest_castles SET wall=3 WHERE season_id=? AND castle_id=?').run(d.season.id,'inuyama');d=await read(h,p);
 const {action,view,battle}=await fight(h,p,d);assert.equal(battle.won,true);assert.equal(battle.durability.breached,true);assert.equal(battle.durability.breachCurrent,0);assert.equal(battle.durability.damage,battle.durability.before);
 const c=view.castles.find(c=>c.id==='inuyama'),stored=castleRow(h,d);assert.equal(c.wall,2);assert.equal(c.ownerGuildId,g.id);assert.equal(c.durability.max,GameEngine.durabilityMax({castleId:c.id,level:1,wall:2}));assert.equal(c.durability.current,Math.round(c.durability.max*.25));assert.equal(battle.durability.after,c.durability.current);assert.equal(battle.durability.max,c.durability.max);
 await h.api('/conquest/action',post(p,action));assert.deepEqual(castleRow(h,d),stored);
 const controller=createController({getContext:()=>({playerId:p.user.id,guildId:g.id}),request:async()=>view,now:()=>h.now,storage:null});await controller.load();controller.selectSection('history');assert.match(markup(controller.snapshot()),/損傷/);assert.match(markup(controller.snapshot()),/25%/);controller.dispose();
});

await scope('repair follows the game clock, pauses safely, caps at full and does not bump revisions',async h=>{
 const {p}=await player(h),d=await read(h,p),record={version:1,current:2500,max:10000,updatedElapsedMs:0};h.sql.prepare('UPDATE conquest_castles SET wall=1,durability_json=? WHERE season_id=? AND castle_id=?').run(JSON.stringify(record),d.season.id,'inuyama');freeze(h,60000);
 const stored=castleRow(h,d);assert.equal((await read(h,p)).castles.find(c=>c.id==='inuyama').durability.current,3500);h.now+=3600000;assert.equal((await read(h,p)).castles.find(c=>c.id==='inuyama').durability.current,3500);
 h.sql.prepare("UPDATE world_clock SET running=1,speed=2,anchor_real_ms=?,revision=revision+1 WHERE id='world-v1'").run(h.now);h.now+=30000;assert.equal((await read(h,p)).castles.find(c=>c.id==='inuyama').durability.current,4500);h.now+=600000;assert.equal((await read(h,p)).castles.find(c=>c.id==='inuyama').durability.current,10000);assert.deepEqual(castleRow(h,d),stored);
});

await scope('wall construction preserves absolute damage and duplicate supports cannot repair twice',async h=>{
 const {p,g}=await player(h);let d=await read(h,p);freeze(h);const record={version:1,current:2000,max:10000,updatedElapsedMs:0};h.sql.prepare('UPDATE conquest_castles SET wall=1,owner_guild_id=?,stock=2000,durability_json=? WHERE season_id=? AND castle_id=?').run(g.id,JSON.stringify(record),d.season.id,'inuyama');d=await read(h,p);
 const action=body(d,'inuyama',{action:'build'});delete action.troops;delete action.tactic;const updated=(await h.api('/conquest/action',post(p,action))).data,c=updated.castles.find(c=>c.id==='inuyama');assert.equal(c.wall,2);assert.equal(c.durability.max,10500);assert.equal(c.durability.current,2500);assert.equal(c.durability.max-c.durability.current,8000);
 const stored=castleRow(h,d);await h.api('/conquest/action',post(p,action));assert.deepEqual(castleRow(h,d),stored);
});

await scope('simultaneous arrival readers commit one durability loss',async h=>{
 const {p}=await player(h),d=await read(h,p);freeze(h);const launched=(await h.api('/conquest/action',post(p,body(d,'inuyama',{troops:100})))).data;h.now=launched.march.arrivesAtMs;
 let arrived=0,release;const barrier=new Promise(resolve=>release=resolve);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('UPDATE conquest_marches SET status=')))return;if(++arrived===2){h.beforeBatch=null;release();}await barrier;};
 const [first,second]=await Promise.all([read(h,p),read(h,p)]),a=first.marches.history[0].battle.durability,b=second.marches.history[0].battle.durability;assert.deepEqual(a,b);assert.equal(castleRow(h,d).revision,1);assert.equal(JSON.parse(castleRow(h,d).durability_json).current,a.after);
});

await scope('changed clock revision rejects support without spending or storing a stale repair',async h=>{
 const {p,g}=await player(h);let d=await read(h,p);freeze(h);h.sql.prepare('UPDATE conquest_castles SET owner_guild_id=?,stock=2000 WHERE season_id=? AND castle_id=?').run(g.id,d.season.id,'inuyama');d=await read(h,p);const before=castleRow(h,d),action=body(d,'inuyama',{action:'build'});delete action.troops;delete action.tactic;
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO conquest_requests')))return;h.beforeBatch=null;h.sql.prepare("UPDATE world_clock SET revision=revision+1 WHERE id='world-v1'").run();};
 await h.api('/conquest/action',post(p,action,409));assert.deepEqual(castleRow(h,d),before);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM conquest_requests WHERE request_id=?').get(action.requestId).n,0);
});

console.log(`Conquest durability: ${scopes} scopes, ${calls} local authenticated API calls passed.`);
