import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,appoint,updateSave,row} from './test-court-support.mjs';
import {CITY_HONORS,resolvePublicCityHonors} from './city-honors.js';

const ids=person=>(person.cityHonors||[]).map(honor=>honor.id);
const profile=async(h,person,viewer)=>(await h.api('/players/'+person.user.id+'/profile',{token:viewer?.token})).data.player;
let cases=0,calls=0,maxBindings=0;
async function scenario(name,run){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements){maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100);}return batch(statements);};
 try{await run(h);cases++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}

await scenario('only the existing five major cities have non-purchasable public honors',async()=>{
 assert.deepEqual(CITY_HONORS.map(city=>city.id),['edo','kyoto_gosho','nijo','osaka','nagoya']);
 assert.deepEqual(CITY_HONORS.map(city=>city.id).sort(),globalThis.SENGOKU_DATA.castles.filter(city=>city.majorCity).map(city=>city.id).sort());
 for(const city of CITY_HONORS){
  const castle=globalThis.SENGOKU_DATA.castles.find(c=>c.id===city.id);
  assert(castle);assert.equal(city.cityName,castle.name);assert(city.title.includes(city.cityName));
 }
});

await scenario('Edo follows its current office and Kyoto honors only the current term-bound emperor',async h=>{
 const admin=await fixture(h,'勲章の江戸守',{admin:true}),first=await fixture(h,'勲章の御所守一',{staff:true}),second=await fixture(h,'勲章の御所守二',{staff:true}),viewer=await fixture(h,'勲章を見る領主',{startCastle:'inuyama'});
 assert.deepEqual(ids(await profile(h,admin)),['edo']);
 assert.deepEqual(ids(await profile(h,first)),[]);assert.deepEqual(ids(await profile(h,second)),[]);
 await appoint(h,first);
 assert.deepEqual(ids(await profile(h,first)),['kyoto_gosho']);
 assert.deepEqual(ids(await profile(h,first,viewer)),['kyoto_gosho'],'authenticated and anonymous viewers agree');
 await appoint(h,second);
 assert.deepEqual(ids(await profile(h,first)),[]);assert.deepEqual(ids(await profile(h,second)),['kyoto_gosho']);
 await h.api('/admin/staff',post(admin,{targetPlayerId:second.user.id,action:'dismiss',requestId:crypto.randomUUID()}));
 await h.api('/admin/staff',post(admin,{targetPlayerId:second.user.id,action:'appoint',requestId:crypto.randomUUID()}));
 assert.deepEqual(ids(await profile(h,second)),[],'a new staff term does not restore an old medal');
 assert.deepEqual((await profile(h,admin)).appearance.ownedProducts,[],'an earned medal does not grant a paid cosmetic');
});

await scenario('metropolitan holdings follow canonical field ownership, loss, game-over and world-cycle reset',async h=>{
 await fixture(h,'五都を見守る大臣',{admin:true});
 const holder=await fixture(h,'三都の現領主',{startCastle:'inuyama',holdings:['nijo','osaka','nagoya']}),peer=await fixture(h,'二条の共同領主',{startCastle:'himeji',holdings:['nijo']});
 assert.deepEqual(ids(await profile(h,holder)),['nijo','osaka','nagoya']);
 assert.deepEqual(ids(await profile(h,peer)),['nijo'],'existing shared-city holders keep their existing rules');
 updateSave(h,holder,state=>{state.castles.nijo.owner='在地衆';});
 assert.deepEqual(ids(await profile(h,holder)),['osaka','nagoya']);
 updateSave(h,holder,state=>{state.gameOver=true;});
 assert.deepEqual(ids(await profile(h,holder)),[]);
 updateSave(h,holder,state=>{state.gameOver=false;state.home='nagoya';state.cycle.home='nagoya';});
 h.sql.prepare('UPDATE player_saves SET cycle_home=? WHERE user_id=?').run('nagoya',holder.user.id);
 h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=? WHERE id=?').run(672*60000,h.now,'world-v1');
 assert.deepEqual(ids(await profile(h,holder)),['nagoya'],'a personal home survives while old captured outposts expire');
 assert.deepEqual(ids(await profile(h,peer)),[]);
});

await scenario('names in chat, field, online and historical flat battle records receive the current honors without rewriting saves',async h=>{
 const admin=await fixture(h,'江戸の公開勲章',{admin:true}),holder=await fixture(h,'大坂の公開勲章',{startCastle:'himeji',holdings:['osaka']}),viewer=await fixture(h,'閲覧の公開勲章',{startCastle:'inuyama'});
 await h.api('/chat',post(holder,{channel:'world',text:'大坂城の領主です。'}));
 await h.api('/presence',post(holder,{deviceId:holder.deviceId,online:true}));
 const battleId='fb_'+crypto.randomUUID().replaceAll('-',''),battle={id:battleId,attackerPlayerId:holder.user.id,attackerName:holder.user.name,defenderPlayerId:admin.user.id,defenderName:admin.user.name,castleId:'edo',won:false,createdAt:new Date(h.now).toISOString()};
 h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?)').run(battleId,holder.user.id,admin.user.id,0,JSON.stringify(battle),h.now);
 const before=h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),history=h.sql.prepare('SELECT result_json FROM field_battles WHERE id=?').get(battleId).result_json;
 const chat=(await h.api('/chat?channel=world',{token:viewer.token})).data.messages;
 const author=chat.find(message=>message.userId===holder.user.id);assert.deepEqual(ids(author),['osaka']);
 const online=(await h.api('/online')).data.players.find(p=>p.id===holder.user.id);assert.deepEqual(ids(online),['osaka']);
 const field=(await h.api('/field')).data.targets.filter(p=>p.playerId===holder.user.id);assert(field.length);for(const person of field)assert.deepEqual(ids(person),['osaka']);
 const historic=(await h.api('/field/me',{token:holder.token})).data.battles.find(item=>item.id===battleId);
 assert.deepEqual(historic.attackerCityHonors.map(x=>x.id),['osaka']);assert.deepEqual(historic.defenderCityHonors.map(x=>x.id),['edo']);
 assert.deepEqual(h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),before);
 assert.equal(h.sql.prepare('SELECT result_json FROM field_battles WHERE id=?').get(battleId).result_json,history);
 updateSave(h,holder,state=>{state.castles.osaka.owner='在地衆';});
 const oldMessage=(await h.api('/chat?channel=world',{token:viewer.token})).data.messages.find(message=>message.userId===holder.user.id);
 assert.deepEqual(ids(oldMessage),[],'old messages describe the current holder, not a permanent entitlement');
});

await scenario('forged presentation metadata is ignored and a late ownership change is read before publishing',async h=>{
 const holder=await fixture(h,'所有を変更する領主',{startCastle:'inuyama',holdings:['osaka']});
 updateSave(h,holder,state=>{state.cityHonors=[{id:'edo'}];state.appearance={cityHonors:[{id:'kyoto_gosho'}]};});
 assert.deepEqual(ids(await profile(h,holder)),['osaka']);
 let changed=false;
 h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-city-honors')))return;changed=true;updateSave(h,holder,state=>{state.castles.osaka.owner='在地衆';});};
 assert.deepEqual(ids(await profile(h,holder)),[]);assert(changed);
 assert.deepEqual(JSON.parse(row(h,holder).save_json).state.cityHonors,[{id:'edo'}],'read projections do not mutate a private save');
});

await scenario('private campaign identities are not decorated and anonymous court messages do not acquire a player identity',async h=>{
 const person={id:'u_local',name:'表示確認'},payload={save:{state:{person}},state:{person},entitlements:{person},messages:[{author:{kind:'court',id:null,name:'朝廷'}}]};
 let queried=false;
 const result=await resolvePublicCityHonors(h.db,payload,h.now,{getWorldClock:async()=>{queried=true;throw Error('Unexpected identity read');},eventCastleCandidates:()=>null});
 assert.equal(result,payload);assert.equal(queried,false);assert(!Object.hasOwn(person,'cityHonors'));assert.deepEqual(payload.messages[0].author,{kind:'court',id:null,name:'朝廷'});
});

console.log(JSON.stringify({passed:cases,localHttpRequests:calls,maxBindings,externalRequests:0}));
