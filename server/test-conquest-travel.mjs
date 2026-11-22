import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {conquestBattle} from './conquest.js';

const SAT=Date.parse('2026-11-21T03:00:00Z');
let scopes=0,calls=0;
const post=(p,body,expected=200)=>({method:'POST',token:p.token,body,expected});
const read=async(h,p)=>(await h.api('/conquest',{token:p.token})).data;
async function scope(name,run){const h=harness();h.now=SAT;try{await run(h);scopes++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}}
async function guild(h,name,members=1){const players=[];for(let i=0;i<members;i++)players.push(await h.session(name+i));const g=(await h.api('/guild',post(players[0],{name}))).data.guild;for(const p of players.slice(1))await h.api('/guild/join',post(p,{guildId:g.id}));for(const p of players){const d=await read(h,p);await h.api('/conquest/join',post(p,{seasonId:d.season.id,requestId:crypto.randomUUID()}));}return{g,players};}
function action(d,id,extra={}){const c=d.castles.find(v=>v.id===id);assert(c);return{seasonId:d.season.id,requestId:crypto.randomUUID(),action:'attack',castleId:id,troops:2500,tactic:'balanced',expectedGuildRevision:d.guild.revision,expectedCastleRevision:c.revision,...extra};}
const depart=(h,p,body,expected=200)=>h.api('/conquest/action',post(p,body,expected));
const castle=(h,season,id)=>h.sql.prepare('SELECT * FROM conquest_castles WHERE season_id=? AND castle_id=?').get(season,id);
const pending=(h,id)=>h.sql.prepare('SELECT * FROM conquest_marches WHERE id=?').get(id);
const count=(h,table)=>h.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n;
const far=d=>d.castles.filter(c=>!c.strategic).sort((a,b)=>globalThis.SengokuTravel.plan({sourceCastleId:'kiyosu',targetCastleId:b.id}).durationMs-globalThis.SengokuTravel.plan({sourceCastleId:'kiyosu',targetCastleId:a.id}).durationMs)[0];
function barrier(h,match){let entered=0,release;const ready=new Promise(r=>release=r);h.beforeBatch=async statements=>{if(!statements.some(match))return;if(++entered===2){h.beforeBatch=null;release();}await ready;};}

await scope('distance-based departure reserves full troops and resolves only at arrival, once',async h=>{
 const {players:[a]}=await guild(h,'距離検証');const d=await read(h,a),body=action(d,'inuyama'),before=castle(h,d.season.id,'inuyama');
 const launched=(await depart(h,a,body)).data;assert.equal(launched.self.playerId,a.user.id);assert.equal(launched.marching,true);assert.equal(launched.result.battle,undefined);assert.equal(launched.self.points,0);assert.equal(launched.guild.ownedCastleIds.length,0);assert.equal(launched.guild.troops,9500);assert.equal(launched.guild.supplies,5450);assert.deepEqual(castle(h,d.season.id,'inuyama'),before);
 assert.equal(launched.march.sourceCastleId,'kiyosu');assert.equal(launched.march.durationMs,26000);assert(launched.march.distanceKm>20&&launched.march.distanceKm<21);assert.equal(launched.march.timeBasis,'real');assert.equal(launched.marches.active.length,1);assert.equal(count(h,'conquest_captures'),0);
 const replay=(await depart(h,a,body)).data;assert.equal(replay.idempotent,true);assert.equal(replay.march.id,launched.march.id);assert.equal(replay.guild.troops,9500);
 h.now=launched.march.arrivesAtMs-1;let view=await read(h,a);assert.equal(view.marches.active.length,1);assert.equal(view.self.points,0);assert.deepEqual(castle(h,d.season.id,'inuyama'),before);
 h.now++;view=await read(h,a);assert.equal(view.marches.active.length,0);assert.equal(view.marches.history[0].status,'resolved');assert.equal(view.marches.history[0].battle.won,true);assert.equal(view.self.points,40);assert.equal(view.guild.ownedCastleIds.length,1);assert.equal(count(h,'conquest_captures'),1);
 const final=(await depart(h,a,body)).data;assert.equal(final.marching,false);assert.equal(final.result.battle.won,true);assert.equal(final.guild.troops,view.guild.troops);assert.equal(final.self.points,40);assert.equal(count(h,'conquest_marches'),1);assert.equal(count(h,'conquest_captures'),1);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM player_saves WHERE save_json IS NOT NULL').get().n,0);
});

await scope('farther targets take longer and a guild cannot launch two first-landing armies',async h=>{
 const {players:[a,b]}=await guild(h,'遠征検証',2);let d=await read(h,a),c=far(d);const launched=(await depart(h,a,action(d,c.id))).data;assert(launched.march.durationMs>150000);assert(launched.march.distanceKm>268);h.now+=31000;
 d=await read(h,a);const second=await depart(h,a,action(d,'inuyama'),409);assert.equal(second.data.error.code,'CONQUEST_MARCHING');d=await read(h,b);const ally=await depart(h,b,action(d,'inuyama'),409);assert.equal(ally.data.error.code,'CONQUEST_LANDING_MARCHING');assert.equal(count(h,'conquest_marches'),1);assert.equal(d.guild.troops,9500);
});

await scope('two guilds may travel to one target; changed ownership cancels and refunds the later arrival',async h=>{
 const {g:ga,players:[a]}=await guild(h,'先発'),{g:gb,players:[b]}=await guild(h,'後発');let da=await read(h,a),db=await read(h,b);const ba=action(da,'inuyama'),bb=action(db,'inuyama');
 barrier(h,s=>s.sql.includes('INSERT INTO conquest_requests')&&s.sql.includes("'attack'"));const responses=await Promise.all([depart(h,a,ba),depart(h,b,bb)]);assert(responses.every(r=>r.data.marching));assert.equal(castle(h,da.season.id,'inuyama').owner_guild_id,null);assert.equal(count(h,'conquest_marches'),2);
 h.now=Math.max(...responses.map(r=>r.data.march.arrivesAtMs));await read(h,a);da=await read(h,a);db=await read(h,b);const winner=castle(h,da.season.id,'inuyama').owner_guild_id;assert([ga.id,gb.id].includes(winner));assert.equal(count(h,'conquest_captures'),1);assert.equal(castle(h,da.season.id,'inuyama').revision,1);const loser=winner===ga.id?db:da;assert.equal(loser.guild.troops,12000);assert.equal(loser.guild.supplies,6000);assert.equal(loser.self.points,0);assert.equal(loser.marches.history[0].status,'cancelled');
 const receipts=await Promise.all([depart(h,a,ba),depart(h,b,bb)]);assert.equal(receipts.filter(r=>r.data.result.battle?.won).length,1);assert.equal(receipts.filter(r=>r.data.result.cancelled).length,1);
});

await scope('concurrent arrival readers cannot duplicate battle rewards or returning troops',async h=>{
 const {players:[a]}=await guild(h,'同時到着');const d=await read(h,a),launched=(await depart(h,a,action(d,'inuyama'))).data;h.now=launched.march.arrivesAtMs;
 barrier(h,s=>s.sql.includes('UPDATE conquest_marches SET status='));const views=await Promise.all([read(h,a),read(h,a)]);const battle=views[0].marches.history[0].battle;assert.equal(count(h,'conquest_captures'),1);assert.equal(views[0].self.points,40);assert.equal(views[1].self.points,40);assert.equal(views[0].guild.troops,9500+battle.returned);assert.equal(views[1].guild.troops,views[0].guild.troops);assert.equal(castle(h,d.season.id,'inuyama').revision,1);
});

await scope('membership changes cancel outstanding armies and preserve the original guild escrow',async h=>{
 const {g,players:[a]}=await guild(h,'帰還検証');const d=await read(h,a),launched=(await depart(h,a,action(d,'inuyama'))).data;h.sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(a.user.id);h.now=launched.march.arrivesAtMs;const view=await read(h,a);assert.equal(view.guild,null);assert.equal(view.marches.history[0].status,'cancelled');const pool=h.sql.prepare('SELECT * FROM conquest_guilds WHERE season_id=? AND guild_id=?').get(d.season.id,g.id);assert.equal(pool.troops,12000);assert.equal(pool.supplies,6000);assert.equal(castle(h,d.season.id,'inuyama').owner_guild_id,null);assert.equal(count(h,'conquest_captures'),0);
});

await scope('arrival checks target protection and restores all departure costs without damage',async h=>{
 const {players:[a]}=await guild(h,'保護検証');const d=await read(h,a),launched=(await depart(h,a,action(d,'inuyama'))).data;h.sql.prepare('UPDATE conquest_castles SET protected_until=?,revision=revision+1 WHERE season_id=? AND castle_id=?').run(launched.march.arrivesAtMs+1,d.season.id,'inuyama');const before=castle(h,d.season.id,'inuyama');h.now=launched.march.arrivesAtMs;const view=await read(h,a);assert.equal(view.marches.history[0].status,'cancelled');assert.equal(view.guild.troops,12000);assert.equal(view.guild.supplies,6000);assert.deepEqual(castle(h,d.season.id,'inuyama'),before);
});

await scope('return assets above the pool cap remain in escrow and are transferred once room exists',async h=>{
 const {g,players:[a]}=await guild(h,'帰還上限');const d=await read(h,a),launched=(await depart(h,a,action(d,'inuyama'))).data;h.sql.prepare('UPDATE conquest_castles SET protected_until=?,revision=revision+1 WHERE season_id=? AND castle_id=?').run(launched.march.arrivesAtMs+1,d.season.id,'inuyama');h.sql.prepare('UPDATE conquest_guilds SET troops=99999990,supplies=99999990,revision=revision+1 WHERE season_id=? AND guild_id=?').run(d.season.id,g.id);h.now=launched.march.arrivesAtMs;
 let view=await read(h,a);assert.equal(view.guild.troops,100000000);assert.equal(view.guild.supplies,100000000);assert.equal(view.marches.history[0].returnPendingTroops,2490);assert.equal(view.marches.history[0].returnPendingSupplies,540);assert.equal(pending(h,launched.march.id).return_troops,2490);
 h.sql.prepare('UPDATE conquest_guilds SET troops=troops-3000,supplies=supplies-1000,revision=revision+1 WHERE season_id=? AND guild_id=?').run(d.season.id,g.id);view=await read(h,a);assert.equal(view.guild.troops,99999490);assert.equal(view.guild.supplies,99999540);assert.equal(view.marches.history[0].returnPendingTroops,0);assert.equal(view.marches.history[0].returnPendingSupplies,0);assert.equal((await read(h,a)).guild.troops,view.guild.troops);
});

await scope('allies can march independently after securing a foothold and cannot reuse reserved troops',async h=>{
 const {g,players:[a,b]}=await guild(h,'共同進軍',2);let d=await read(h,a);h.sql.prepare('UPDATE conquest_castles SET owner_guild_id=?,stock=5000,revision=revision+1 WHERE season_id=? AND castle_id=?').run(g.id,d.season.id,'kiyosu');
 d=await read(h,a);let source=d.castles.find(c=>c.id==='kiyosu');const first=(await depart(h,a,action(d,'kannonji',{fromCastleId:source.id,expectedSourceRevision:source.revision}))).data;assert(first.march.durationMs>31000);h.now+=31000;
 d=await read(h,b);source=d.castles.find(c=>c.id==='kiyosu');const second=(await depart(h,b,action(d,'inuyama',{fromCastleId:source.id,expectedSourceRevision:source.revision}))).data;assert.equal(second.marches.active.length,2);assert.equal(second.guild.troops,7000);assert.equal(castle(h,d.season.id,'kiyosu').stock,3900);
 h.now=Math.max(first.march.arrivesAtMs,second.march.arrivesAtMs);const final=await read(h,a);assert.equal(final.marches.active.length,0);assert.equal(final.guild.ownedCastleIds.length,3);assert.equal(final.self.points,40);assert.equal((await read(h,b)).self.points,40);assert.equal(final.guild.troops,7000+final.marches.history.reduce((sum,m)=>sum+m.battle.returned,0));
});

await scope('full historical return pools cannot starve later eligible return receipts',async h=>{
 const {g:ga,players:[a]}=await guild(h,'満杯の同盟'),{g:gb,players:[b]}=await guild(h,'受取先の同盟');const d=await read(h,a),launched=(await depart(h,a,action(d,'inuyama'))).data;
 h.sql.prepare('UPDATE conquest_castles SET protected_until=?,revision=revision+1 WHERE season_id=? AND castle_id=?').run(launched.march.arrivesAtMs+1,d.season.id,'inuyama');h.sql.prepare('UPDATE conquest_guilds SET troops=100000000,supplies=100000000,revision=revision+1 WHERE season_id=? AND guild_id=?').run(d.season.id,ga.id);h.now=launched.march.arrivesAtMs;await read(h,a);
 const original=pending(h,launched.march.id),insert=row=>{const keys=Object.keys(row);h.sql.prepare('INSERT INTO conquest_marches('+keys.join(',')+') VALUES('+keys.map(()=>'?').join(',')+')').run(...keys.map(key=>row[key]));};
 h.sql.prepare('UPDATE conquest_marches SET settled_at=? WHERE id=?').run(h.now-100,original.id);
 for(let i=0;i<31;i++)insert({...original,id:'blocked_'+i,request_id:crypto.randomUUID(),settled_at:h.now-100});
 insert({...original,id:'eligible_return',user_id:b.user.id,guild_id:gb.id,request_id:crypto.randomUUID(),return_troops:100,return_supplies:0,settled_at:h.now});
 const view=await read(h,b);assert.equal(view.guild.troops,12100);assert.equal(pending(h,'eligible_return').return_troops,0);assert.equal(h.sql.prepare('SELECT COUNT(*) n FROM conquest_marches WHERE guild_id=? AND return_troops>0').get(ga.id).n,32);
});

await scope('losing the departure castle cancels an adjacent sortie and refunds reserved assets',async h=>{
 const {g,players:[a]}=await guild(h,'出陣元検証');let d=await read(h,a);h.sql.prepare('UPDATE conquest_castles SET owner_guild_id=?,stock=5000,revision=revision+1 WHERE season_id=? AND castle_id=?').run(g.id,d.season.id,'kiyosu');d=await read(h,a);const source=d.castles.find(c=>c.id==='kiyosu'),before=castle(h,d.season.id,'inuyama');
 const launched=(await depart(h,a,action(d,'inuyama',{fromCastleId:source.id,expectedSourceRevision:source.revision}))).data;h.sql.prepare('UPDATE conquest_castles SET owner_guild_id=NULL,revision=revision+1 WHERE season_id=? AND castle_id=?').run(d.season.id,'kiyosu');h.now=launched.march.arrivesAtMs;const final=await read(h,a);assert.equal(final.marches.history[0].status,'cancelled');assert.equal(final.guild.troops,12000);assert.equal(final.guild.supplies,6000+conquestBattle({troops:2500,garrison:before.garrison,wall:before.wall}).supplyCost);assert.deepEqual(castle(h,d.season.id,'inuyama'),before);assert.equal(count(h,'conquest_captures'),0);
});

await scope('departure rejects arrival after season end; valid arrivals settle before final standings',async h=>{
 const {players:[a]}=await guild(h,'締切検証');let d=await read(h,a);const end=Date.parse(d.season.endsAt);h.now=end-25000;d=await read(h,a);let r=await depart(h,a,action(d,'inuyama'),409);assert.equal(r.data.error.code,'CONQUEST_ARRIVAL_AFTER_END');assert.equal(count(h,'conquest_marches'),0);const launched=(await depart(h,a,action(d,'kiyosu'))).data;assert.equal(launched.march.durationMs,15000);assert(launched.march.arrivesAtMs<end);h.now=end+1;const next=await read(h,a);assert.equal(pending(h,launched.march.id).status,'resolved');assert.equal(next.history[0].self.points,40);assert.equal(next.history[0].standings[0].castles,1);assert.equal(next.history[0].standings[0].title,'天下覇者');
});

console.log(`Conquest travel: ${scopes} scopes, ${calls} isolated authenticated HTTP calls passed.`);
