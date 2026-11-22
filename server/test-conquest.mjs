import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {conquestSeason,conquestBattle} from './conquest.js';

const SAT=Date.parse('2026-11-21T03:00:00Z');
let scopes=0,calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const read=async(h,p)=>(await h.api('/conquest',{token:p.token})).data;
async function scope(name,run){const h=harness();h.now=SAT;try{await run(h);scopes++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function guild(h,name='共有同盟',members=1){const players=[];for(let i=0;i<members;i++)players.push(await h.session(name+'領主'+i));const g=(await h.api('/guild',post(players[0],{name}))).data.guild;for(const p of players.slice(1))await h.api('/guild/join',post(p,{guildId:g.id}));return{guild:g,players};}
async function join(h,p,state=null,requestId=crypto.randomUUID(),expected=200){const d=state||await read(h,p);return h.api('/conquest/join',post(p,{seasonId:d.season.id,requestId},expected));}
function action(data,castle,extra={}){return{seasonId:data.season.id,requestId:crypto.randomUUID(),action:'attack',castleId:castle.id,troops:2500,tactic:'balanced',expectedGuildRevision:data.guild.revision,expectedCastleRevision:castle.revision,...extra};}
const run=(h,p,body,expected=200)=>h.api('/conquest/action',post(p,body,expected));
const tick=h=>h.now+=31000;
const neutral=d=>d.castles.find(c=>!c.ownerGuildId&&!c.strategic);

const friday=conquestSeason(Date.parse('2026-11-20T14:59:59Z'));assert.equal(friday.status,'upcoming');assert.equal(friday.id,'cq_20261121');
assert.equal(conquestSeason(Date.parse('2026-11-20T15:00:00Z')).status,'active');
assert.equal(conquestSeason(Date.parse('2026-11-22T14:59:59Z')).id,'cq_20261121');
assert.equal(conquestSeason(Date.parse('2026-11-22T15:00:00Z')).id,'cq_20261128');
assert.equal(conquestBattle({troops:3000,garrison:1000,wall:2}).won,true);
assert.equal(conquestBattle({troops:100,garrison:1000,wall:2}).won,false);

await scope('authenticated access, equal guild entry grants and idempotent registration',async h=>{
 await h.api('/conquest',{expected:401});
 const solo=await h.session('未所属の領主'),view=await read(h,solo);assert.equal(view.castles.length,129);assert.equal(view.self.eligible,false);assert.equal(view.guild,null);
 await join(h,solo,view,crypto.randomUUID(),403);
 const {players:[a,b]}=await guild(h,'平等出発',2),id=crypto.randomUUID();
 const first=(await join(h,a,null,id)).data,second=(await join(h,a,first,id)).data;assert.equal(second.idempotent,true);assert.equal(first.guild.troops,12000);assert.equal(first.guild.supplies,6000);
 const ally=(await join(h,b)).data;assert.equal(ally.guild.troops,12000);assert.equal(ally.guild.supplies,6000);assert.equal(ally.contributions.length,2);
 assert.equal(ally.standings[0].territory,0);assert.equal(ally.standings[0].score,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM player_saves WHERE save_json IS NOT NULL').get().n,0,'competition cannot require or mutate campaign saves');
 await h.api('/conquest/join',post(a,{seasonId:'cq_20990101',requestId:id},409));
 await h.api('/conquest/join',post(a,{seasonId:first.season.id,requestId:crypto.randomUUID(),troops:999999},400));
 assert(!JSON.stringify(first).includes('isAdmin'));assert(!JSON.stringify(first).includes('token_hash'));
});

await scope('capture consumes once, exclusive ownership and first-capture scoring',async h=>{
 const {players:[a],guild:g}=await guild(h,'一城の志');let d=(await join(h,a)).data,c=neutral(d),body=action(d,c);
 const won=(await run(h,a,body)).data;assert.equal(won.result.battle.won,true);const site=won.castles.find(v=>v.id===c.id);assert.equal(site.ownerGuildId,g.id);assert.equal(site.garrison,won.result.battle.garrisonPlaced);assert.equal(site.stock,800);assert.equal(site.revision,1);assert.equal(won.guild.troops,12000-won.result.battle.attackerLost-won.result.battle.garrisonPlaced);assert.equal(won.self.points,40);assert.equal(won.standings[0].score,125);
 const replay=(await run(h,a,body)).data;assert.equal(replay.idempotent,true);assert.equal(replay.guild.troops,won.guild.troops);assert.equal(replay.self.points,40);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM conquest_captures').get().n,1);
 await run(h,a,{...body,troops:3000},409);tick(h);
 d=await read(h,a);await run(h,a,action(d,d.castles.find(v=>v.id===c.id)),409);
 const distant=d.castles.find(v=>!v.mine&&!c.neighbors.includes(v.id));await run(h,a,action(d,distant,{fromCastleId:c.id,expectedSourceRevision:1}),409);
 const neighbor=d.castles.find(v=>c.neighbors.includes(v.id));await run(h,a,action(d,neighbor),409);
});

await scope('transport, real garrison reinforcement, wall construction and adjacent sorties',async h=>{
 const {players:[a]}=await guild(h,'兵站の同盟');let d=(await join(h,a)).data,c=neutral(d);d=(await run(h,a,action(d,c))).data;tick(h);c=d.castles.find(v=>v.id===c.id);
 const deliver=action(d,c,{action:'transport',amount:2000});delete deliver.troops;delete deliver.tactic;d=(await run(h,a,deliver)).data;assert.equal(d.castles.find(v=>v.id===c.id).stock,2800);assert.equal(d.result.points,20);const deliveredSupplies=d.guild.supplies;assert.equal((await run(h,a,deliver)).data.guild.supplies,deliveredSupplies);tick(h);
 c=d.castles.find(v=>v.id===c.id);const beforeTroops=d.guild.troops,beforeGarrison=c.garrison;d=(await run(h,a,action(d,c,{action:'reinforce',troops:1000}))).data;assert.equal(d.guild.troops,beforeTroops-1000);c=d.castles.find(v=>v.id===c.id);assert.equal(c.garrison,beforeGarrison+1000);assert.equal(c.stock,2720);tick(h);
 const build=action(d,c,{action:'build'});delete build.troops;delete build.tactic;d=(await run(h,a,build)).data;c=d.castles.find(v=>v.id===c.id);assert.equal(c.wall,2);assert.equal(c.stock,1920);tick(h);
 const neighbor=d.castles.find(v=>c.neighbors.includes(v.id));const sourceStock=c.stock;d=(await run(h,a,action(d,neighbor,{fromCastleId:c.id,expectedSourceRevision:c.revision,troops:3000}))).data;assert.equal(d.result.battle.won,true);assert.equal(d.castles.find(v=>v.id===c.id).stock,sourceStock-d.result.battle.supplyCost);assert.equal(d.guild.ownedCastleIds.length,2);assert.equal(d.contributions[0].reinforcement,10);assert.equal(d.contributions[0].transport,20);assert.equal(d.contributions[0].construction,40);tick(h);
 const enemy=neutral(d);const invalid=action(d,enemy,{action:'transport',amount:100});delete invalid.troops;delete invalid.tactic;await run(h,a,invalid,403);
});

await scope('two competing guilds cannot capture one castle twice',async h=>{
 const {players:[a],guild:ga}=await guild(h,'東軍'),{players:[b],guild:gb}=await guild(h,'西軍');const da=(await join(h,a)).data,db=(await join(h,b)).data,c=neutral(da),ba=action(da,c),bb=action(db,db.castles.find(v=>v.id===c.id));
 let entered=0,release;const barrier=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO conquest_requests')&&s.params[4]==='attack'))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
 const results=await Promise.all([run(h,a,ba,null),run(h,b,bb,null)]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);
 const row=h.sql.prepare('SELECT * FROM conquest_castles WHERE castle_id=? AND season_id=?').get(c.id,da.season.id);assert([ga.id,gb.id].includes(row.owner_guild_id));assert.equal(row.revision,1);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM conquest_requests WHERE action='attack'").get().n,1);
 const loser=results[0].response.status===409?a:b,readLoser=await read(h,loser);assert.equal(readLoser.guild.troops,12000);assert.equal(readLoser.guild.supplies,6000);
});

await scope('one shared guild pool prevents concurrent overspending by allies',async h=>{
 const {players:[a,b]}=await guild(h,'共同指揮',2),da=(await join(h,a)).data,db=(await join(h,b)).data,targets=da.castles.filter(c=>!c.strategic).slice(0,2);
 let entered=0,release;const barrier=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO conquest_requests')&&s.params[4]==='attack'))return;if(++entered===2){h.beforeBatch=null;release();}await barrier;};
 const results=await Promise.all([run(h,a,action(da,targets[0],{troops:10000}),null),run(h,b,action(db,targets[1],{troops:10000}),null)]);assert.deepEqual(results.map(r=>r.response.status).sort(),[200,409]);const d=await read(h,a);assert.equal(d.guild.ownedCastleIds.length,1);assert(d.guild.troops>=0);assert(d.guild.supplies>=0);
});

await scope('membership term rechecked at commit and guild hopping locked for a season',async h=>{
 const {players:[a],guild:ga}=await guild(h,'参加時の同盟'),{players:[b],guild:gb}=await guild(h,'移籍先同盟');let d=(await join(h,a)).data;
 h.beforeBatch=async statements=>{if(!statements.some(s=>s.sql.includes('INSERT INTO conquest_requests')&&s.params[4]==='attack'))return;h.beforeBatch=null;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(a.user.id);h.sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(a.user.id,ga.id,h.now);};
 await run(h,a,action(d,neutral(d)),409);assert.equal(h.sql.prepare("SELECT COUNT(*) n FROM conquest_requests WHERE action='attack'").get().n,0);
 h.sql.prepare('UPDATE guild_members SET guild_id=?,joined_at=? WHERE user_id=?').run(gb.id,h.now,a.user.id);d=await read(h,a);assert.equal(d.guild,null);assert.equal(d.self.eligible,false);assert.equal(d.self.lockedGuildId,ga.id);await join(h,a,d,crypto.randomUUID(),409);
 h.now+=7*86400000;d=(await join(h,a)).data;assert.equal(d.guild.id,gb.id);assert.equal(d.guild.troops,12000);
});

await scope('post-capture protection, defense credit, battle losses and exact replenishment',async h=>{
 const {players:[a]}=await guild(h,'守備の同盟'),{players:[b]}=await guild(h,'挑戦の同盟');let da=(await join(h,a)).data,db=(await join(h,b)).data,c=neutral(da);da=(await run(h,a,action(da,c,{troops:4000}))).data;db=await read(h,b);c=db.castles.find(v=>v.id===c.id);await run(h,b,action(db,c,{troops:100}),409);
 h.now+=300001;db=await read(h,b);c=db.castles.find(v=>v.id===c.id);const lost=(await run(h,b,action(db,c,{troops:100}))).data;assert.equal(lost.result.battle.won,false);assert.equal(lost.guild.troops,12000-lost.result.battle.attackerLost);da=await read(h,a);assert.equal(da.standings.find(v=>v.guildId===da.guild.id).defenses,1);assert.equal(da.castles.find(v=>v.id===c.id).ownerGuildId,da.guild.id);
 const pool=lost.guild.supplies;h.now=SAT+1800000;db=await read(h,b);assert.equal(db.guild.supplies,Math.min(100000000,pool+1000));assert.equal(db.guild.troops,Math.min(100000000,lost.guild.troops+400));
});

await scope('each owned asset caps at 100 million and overflow transfers never spend',async h=>{
 const {players:[a],guild:g}=await guild(h,'所有上限同盟');let d=(await join(h,a)).data,c=neutral(d);d=(await run(h,a,action(d,c))).data;tick(h);
 h.sql.prepare('UPDATE conquest_guilds SET troops=99999950,supplies=99999950,replenished_at=? WHERE season_id=? AND guild_id=?').run(h.now-1800000,d.season.id,g.id);
 h.sql.prepare('UPDATE conquest_castles SET garrison=99999950,stock=99999950 WHERE season_id=? AND castle_id=?').run(d.season.id,c.id);
 d=await read(h,a);c=d.castles.find(v=>v.id===c.id);assert.equal(d.guild.troops,100000000);assert.equal(d.guild.supplies,100000000);assert.equal(d.rules.maxGarrison,100000000);assert.equal(d.rules.maxStock,100000000);
 const before=h.sql.prepare('SELECT * FROM conquest_guilds WHERE season_id=? AND guild_id=?').get(d.season.id,g.id);
 await run(h,a,action(d,c,{action:'reinforce',troops:100}),409);
 const transport=action(d,c,{action:'transport',amount:100});delete transport.troops;delete transport.tactic;await run(h,a,transport,409);
 assert.deepEqual(h.sql.prepare('SELECT * FROM conquest_guilds WHERE season_id=? AND guild_id=?').get(d.season.id,g.id),before,'rejected overflow cannot spend or prematurely settle the pool');
 assert.equal(h.sql.prepare('SELECT garrison FROM conquest_castles WHERE season_id=? AND castle_id=?').get(d.season.id,c.id).garrison,99999950);
 assert.throws(()=>h.sql.prepare('UPDATE conquest_castles SET garrison=100000001 WHERE season_id=? AND castle_id=?').run(d.season.id,c.id),/CHECK/);
});

await scope('off-season registration, settled history, titles and fresh next-season economy',async h=>{
 const {players:[a]}=await guild(h,'歴代の同盟');let d=(await join(h,a)).data;d=(await run(h,a,action(d,neutral(d)))).data;const oldId=d.season.id,oldBody=action(d,d.castles.find(c=>!c.mine&&!c.strategic));
 h.now=Date.parse(d.season.endsAt);const next=await read(h,a);assert.equal(next.season.status,'upcoming');assert.notEqual(next.season.id,oldId);assert.equal(next.guild,null);assert.equal(next.history.length,1);assert.equal(next.history[0].standings[0].title,'天下覇者');assert.equal(next.history[0].self.points,40);assert.equal(next.best.points,40);
 await run(h,a,oldBody,409);d=(await join(h,a,next)).data;assert.equal(d.guild.troops,12000);assert.equal(d.guild.supplies,6000);assert.equal(d.guild.ownedCastleIds.length,0);await run(h,a,action(d,neutral(d)),409);
 const history=(await h.api('/conquest/history',{token:a.token})).data;assert.equal(history.seasons[0].id,oldId);assert.equal(history.seasons[0].standings[0].score,125);assert.equal(history.best.points,40);
 assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM conquest_castles WHERE season_id=? AND owner_guild_id IS NOT NULL').get(oldId).n,1);
});

console.log(`Conquest server: ${scopes} scopes, ${calls} authenticated API calls passed.`);
