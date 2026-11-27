import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {fixture,post,appoint,updateSave,row} from './test-court-support.mjs';
import {CITY_HONORS,CASTLE_LORD_HONOR,resolvePublicCityHonors} from './city-honors.js';
import {RESIDENCY_CASTLES} from './residency.js';

const ids=person=>(person.cityHonors||[]).map(honor=>honor.id);
const profile=async(h,person,viewer)=>(await h.api('/players/'+person.user.id+'/profile',{token:viewer?.token})).data.player;
const resolveMembership=(h,payload)=>resolvePublicCityHonors(h.db,payload,h.now,{getWorldClock:async()=>({}),eventCastleCandidates:()=>({source:'FROM users u WHERE ?=0 AND 0=1',cycle:0,params:[]})});
async function changeDeputy(h,admin,person,action='appoint'){
 const current=(await h.api('/admin/deputy',{token:admin.token})).data;
 return(await h.api('/admin/deputy',post(admin,{targetPlayerId:person.user.id,action,requestId:crypto.randomUUID(),expectedRevision:current.revision}))).data;
}
let cases=0,calls=0,maxBindings=0,maxCompoundTerms=0;
async function scenario(name,run){
 const h=harness(),batch=h.db.batch.bind(h.db);
 h.db.batch=statements=>{for(const s of statements){
  maxBindings=Math.max(maxBindings,s.params.length);assert(s.params.length<=100);
  if(s.sql.includes('public-city-honors')){
   // Cloudflare D1 limits a compound SELECT to five terms. Node SQLite's
   // default is much larger, so explicitly enforce the production boundary.
   const terms=s.sql.split(/\b(?:UNION(?:\s+ALL)?|INTERSECT|EXCEPT)\b/i).length;
   maxCompoundTerms=Math.max(maxCompoundTerms,terms);assert(terms<=5,'D1 permits at most five compound SELECT terms');
  }
 }return batch(statements);};
 try{await run(h);cases++;console.log('PASS '+name);}finally{calls+=h.calls;h.close();}
}

await scenario('five major cities and the appointed Kagoshima deputy have non-purchasable public honors',async()=>{
 assert.deepEqual(CITY_HONORS.map(city=>city.id),['edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima']);
 assert.deepEqual(CITY_HONORS.filter(city=>city.id!=='kagoshima').map(city=>city.id).sort(),globalThis.SENGOKU_DATA.castles.filter(city=>city.majorCity).map(city=>city.id).sort());
 assert.equal(CITY_HONORS.find(city=>city.id==='kagoshima').title,'鹿児島城 不死身の紋章');
 assert.deepEqual(CASTLE_LORD_HONOR,{id:'castle_lord',cityName:'一般拠点',title:'城主の紋章'});
 for(const city of CITY_HONORS){
  const castle=globalThis.SENGOKU_DATA.castles.find(c=>c.id===city.id);
  assert(castle);assert.equal(city.cityName,castle.name);assert(city.title.includes(city.cityName));
 }
});

await scenario('the Kagoshima crest follows current deputy appointments, separately from Kyoto and forged saves',async h=>{
 const admin=await fixture(h,'鹿児島の紋章を任命する運営',{admin:true}),first=await fixture(h,'鹿児島の初代紋章',{startCastle:'inuyama'}),second=await fixture(h,'鹿児島の次代紋章',{startCastle:'himeji'}),staff=await fixture(h,'御所の紋章候補',{staff:true});
 updateSave(h,second,state=>{state.cityHonors=[{id:'kagoshima'}];state.isDeputy=true;state.appearance={cityHonors:[{id:'kagoshima'}]};});
 assert.deepEqual(ids(await profile(h,second)),['castle_lord'],'private deputy flags cannot replace the ordinary member crest');
 assert(!ids(await profile(h,admin)).includes('kagoshima'));assert(!ids(await profile(h,staff)).includes('kagoshima'));
 await changeDeputy(h,admin,first);
 const anonymous=await profile(h,first),authenticated=await profile(h,first,second);
 assert.deepEqual(ids(anonymous),['kagoshima']);assert.deepEqual(ids(authenticated),['kagoshima']);
 assert.equal(anonymous.cityHonors[0].title,'鹿児島城 不死身の紋章');
 assert(!Object.hasOwn(anonymous,'isDeputy'),'the crest does not expose a new public privilege flag');
 await changeDeputy(h,admin,first,'dismiss');
 assert.deepEqual(ids(await profile(h,first)),['castle_lord'],'dismissal restores the ordinary member crest with the returned household');
 await changeDeputy(h,admin,second);
 assert.deepEqual(ids(await profile(h,first)),['castle_lord']);assert.deepEqual(ids(await profile(h,second)),['kagoshima']);
});

await scenario('Kagoshima public profiles, chat and field show the same crest without changing game data',async h=>{
 const admin=await fixture(h,'鹿児島表示の運営',{admin:true}),deputy=await fixture(h,'鹿児島表示の領主',{startCastle:'inuyama'}),viewer=await fixture(h,'鹿児島表示の閲覧者',{startCastle:'himeji'});
 await changeDeputy(h,admin,deputy);
 await h.api('/chat',post(deputy,{channel:'world',text:'鹿児島城からの挨拶'}));
 const before=h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),registry=h.sql.prepare('SELECT * FROM deputy_operator_state').all();
 const chat=(await h.api('/chat?channel=world',{token:viewer.token})).data.messages.find(message=>message.userId===deputy.user.id);
 const field=(await h.api('/field')).data.targets.filter(person=>person.playerId===deputy.user.id);
 assert.deepEqual(ids(chat),['kagoshima']);assert(field.length);for(const person of field)assert.deepEqual(ids(person),['kagoshima']);
 assert.deepEqual(ids(await profile(h,deputy)),['kagoshima']);
 assert.deepEqual(h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),before);
 assert.deepEqual(h.sql.prepare('SELECT * FROM deputy_operator_state').all(),registry);
});

await scenario('Kagoshima cannot retain a crest after suspension or an appointment removed during the response',async h=>{
 const admin=await fixture(h,'鹿児島失効の運営',{admin:true}),deputy=await fixture(h,'鹿児島失効の領主',{startCastle:'inuyama'});
 await changeDeputy(h,admin,deputy);
 let changed=false;
 h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-city-honors')))return;changed=true;h.sql.prepare('UPDATE deputy_operator_state SET user_id=NULL,term_id=NULL,revision=revision+1 WHERE id=1').run();};
 assert.deepEqual(ids(await profile(h,deputy)),[]);assert(changed,'the published badge must read the current appointment');
 h.beforeBatch=null;
 // Resolve an existing public identity even when a normal profile route
 // would omit a suspended account. Legacy role/home labels remain untrusted.
 h.sql.prepare('UPDATE deputy_operator_state SET user_id=?,term_id=?,appointed_at=? WHERE id=1').run(deputy.user.id,'test-ban-term',h.now);
 h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(deputy.user.id,admin.user.id,h.now);
 const payload={player:{id:deputy.user.id,name:deputy.user.name,isDeputy:true,homeCastleId:'kagoshima',cityHonors:[{id:'kagoshima'}]}};
 await resolvePublicCityHonors(h.db,payload,h.now,{getWorldClock:async()=>({}),eventCastleCandidates:()=>({source:'FROM users u WHERE ?=0 AND 0=1',cycle:1,params:[]})});
 assert.deepEqual(ids(payload.player),[],'suspended holders never receive the crest');
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
 assert.deepEqual(ids(await profile(h,holder)),['nijo','osaka','nagoya','castle_lord']);
 assert.deepEqual(ids(await profile(h,peer)),['nijo','castle_lord'],'existing shared-city holders keep their existing rules');
 updateSave(h,holder,state=>{state.castles.nijo.owner='在地衆';});
 assert.deepEqual(ids(await profile(h,holder)),['osaka','nagoya','castle_lord']);
 updateSave(h,holder,state=>{state.gameOver=true;});
 assert.deepEqual(ids(await profile(h,holder)),['castle_lord'],'the public household membership is separate from private campaign holdings');
 updateSave(h,holder,state=>{state.gameOver=false;state.home='nagoya';state.cycle.home='nagoya';});
 h.sql.prepare('UPDATE player_saves SET cycle_home=? WHERE user_id=?').run('nagoya',holder.user.id);
 h.sql.prepare('UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=? WHERE id=?').run(672*60000,h.now,'world-v1');
 assert.deepEqual(ids(await profile(h,holder)),['nagoya','castle_lord'],'a personal home survives while old captured outposts expire');
 assert.deepEqual(ids(await profile(h,peer)),['castle_lord']);
});

await scenario('names in chat, field, online and historical flat battle records receive the current honors without rewriting saves',async h=>{
 const admin=await fixture(h,'江戸の公開勲章',{admin:true}),holder=await fixture(h,'大坂の公開勲章',{startCastle:'himeji',holdings:['osaka']}),viewer=await fixture(h,'閲覧の公開勲章',{startCastle:'inuyama'});
 await h.api('/chat',post(holder,{channel:'world',text:'大坂城の領主です。'}));
 await h.api('/presence',post(holder,{deviceId:holder.deviceId,online:true}));
 const battleId='fb_'+crypto.randomUUID().replaceAll('-',''),battle={id:battleId,attackerPlayerId:holder.user.id,attackerName:holder.user.name,defenderPlayerId:admin.user.id,defenderName:admin.user.name,castleId:'edo',won:false,createdAt:new Date(h.now).toISOString()};
 h.sql.prepare('INSERT INTO field_battles(id,attacker_id,defender_id,occurred_elapsed_ms,result_json,created_at) VALUES(?,?,?,?,?,?)').run(battleId,holder.user.id,admin.user.id,0,JSON.stringify(battle),h.now);
 const before=h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),history=h.sql.prepare('SELECT result_json FROM field_battles WHERE id=?').get(battleId).result_json;
 const chat=(await h.api('/chat?channel=world',{token:viewer.token})).data.messages;
 const author=chat.find(message=>message.userId===holder.user.id);assert.deepEqual(ids(author),['osaka','castle_lord']);
 const online=(await h.api('/online')).data.players.find(p=>p.id===holder.user.id);assert.deepEqual(ids(online),['osaka','castle_lord']);
 const field=(await h.api('/field')).data.targets.filter(p=>p.playerId===holder.user.id);assert(field.length);for(const person of field)assert.deepEqual(ids(person),['osaka','castle_lord']);
 const historic=(await h.api('/field/me',{token:holder.token})).data.battles.find(item=>item.id===battleId);
 assert.deepEqual(historic.attackerCityHonors.map(x=>x.id),['osaka','castle_lord']);assert.deepEqual(historic.defenderCityHonors.map(x=>x.id),['edo']);
 assert.deepEqual(h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),before);
 assert.equal(h.sql.prepare('SELECT result_json FROM field_battles WHERE id=?').get(battleId).result_json,history);
 updateSave(h,holder,state=>{state.castles.osaka.owner='在地衆';});
 const oldMessage=(await h.api('/chat?channel=world',{token:viewer.token})).data.messages.find(message=>message.userId===holder.user.id);
 assert.deepEqual(ids(oldMessage),['castle_lord'],'old messages describe the current holder, not a permanent entitlement');
});

await scenario('forged presentation metadata is ignored and a late ownership change is read before publishing',async h=>{
 const holder=await fixture(h,'所有を変更する領主',{startCastle:'inuyama',holdings:['osaka']});
 updateSave(h,holder,state=>{state.cityHonors=[{id:'edo'}];state.appearance={cityHonors:[{id:'kyoto_gosho'}]};});
 assert.deepEqual(ids(await profile(h,holder)),['osaka','castle_lord']);
 let changed=false;
 h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-city-honors')))return;changed=true;updateSave(h,holder,state=>{state.castles.osaka.owner='在地衆';});};
 assert.deepEqual(ids(await profile(h,holder)),['castle_lord']);assert(changed);
 assert.deepEqual(JSON.parse(row(h,holder).save_json).state.cityHonors,[{id:'edo'}],'read projections do not mutate a private save');
});

await scenario('regular lords and retainers share the crest across public profiles, chat, online lists and the household',async h=>{
 const lord=await fixture(h,'一般拠点の領主',{startCastle:'inuyama'}),retainer=await fixture(h,'一般拠点の家臣',{startCastle:'inuyama'}),viewer=await fixture(h,'紋章を見る隣城',{startCastle:'himeji'});
 for(const person of [lord,retainer]){
  await h.api('/chat',post(person,{channel:'world',text:'一般拠点からの挨拶'}));
  await h.api('/presence',post(person,{deviceId:person.deviceId,online:true}));
 }
 const before=h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),members=h.sql.prepare('SELECT * FROM castle_residents ORDER BY user_id').all();
 for(const person of [lord,retainer])for(const audience of [undefined,viewer]){
  const visible=await profile(h,person,audience);assert.deepEqual(ids(visible),['castle_lord']);assert.deepEqual(visible.cityHonors,[CASTLE_LORD_HONOR]);
  assert.deepEqual(visible.appearance.ownedProducts,[],'the crest is independent of purchases');
 }
 const chat=(await h.api('/chat?channel=world',{token:viewer.token})).data.messages,online=(await h.api('/online')).data.players;
 for(const person of [lord,retainer]){
  assert.deepEqual(ids(chat.find(message=>message.userId===person.user.id)),['castle_lord']);
  assert.deepEqual(ids(online.find(player=>player.id===person.user.id)),['castle_lord']);
  assert.deepEqual(ids((await h.api('/me',{token:person.token})).data.user),['castle_lord']);
 }
 const household=(await h.api('/castles/residency?castleId=inuyama',{token:viewer.token})).data;
 assert.equal(household.roster.lord.playerId,lord.user.id);assert.deepEqual(ids(household.roster.lord),['castle_lord']);
 assert.equal(household.roster.retainers[0].playerId,retainer.user.id);assert.deepEqual(ids(household.roster.retainers[0]),['castle_lord']);
 const field=(await h.api('/field')).data.targets.filter(person=>person.playerId===lord.user.id);assert(field.length);for(const person of field)assert.deepEqual(ids(person),['castle_lord']);
 assert.deepEqual(h.sql.prepare('SELECT user_id,save_json,revision FROM player_saves ORDER BY user_id').all(),before);
 assert.deepEqual(h.sql.prepare('SELECT * FROM castle_residents ORDER BY user_id').all(),members,'rendering never changes household roles');
});

await scenario('authoritative protected roles and moderation override stale ordinary memberships',async h=>{
 const admin=await fixture(h,'紋章の除外確認運営',{admin:true}),staff=await fixture(h,'紋章の除外確認御所',{staff:true}),deputy=await fixture(h,'紋章の除外確認副官',{startCastle:'inuyama'}),banned=await fixture(h,'紋章の停止確認',{startCastle:'himeji'}),expelled=await fixture(h,'紋章の追放確認',{startCastle:'sunpu'}),ordinary=await fixture(h,'紋章の一般確認',{startCastle:'kiyosu'});
 await changeDeputy(h,admin,deputy);
 // Simulate memberships awaiting reconciliation: the projection must already
 // honor the role/moderation registries without writing any cleanup itself.
 for(const [index,person]of [admin,staff,deputy].entries())h.sql.prepare('INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET castle_id=excluded.castle_id').run(person.user.id,'kiyosu',1000+index,h.now);
 h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)').run(banned.user.id,admin.user.id,h.now);
 h.sql.prepare('INSERT INTO player_expulsions(user_id,revision,pending,castle_id,lord_epoch,role,source_save_json,expelled_by,expelled_at) VALUES(?,1,1,?,0,?,?,?,?)').run(expelled.user.id,'sunpu','lord',row(h,expelled).save_json,admin.user.id,h.now);
 const people=[admin,staff,deputy,banned,expelled,ordinary],payload={players:people.map(person=>({id:person.user.id,name:person.user.name,isAdmin:false,isDeputy:false,homeCastleId:'kiyosu',cityHonors:[CASTLE_LORD_HONOR]}))};
 payload.players.at(-1).isAdmin=true;payload.players.at(-1).isDeputy=true;
 const before=h.sql.prepare('SELECT * FROM castle_residents ORDER BY user_id').all();await resolveMembership(h,payload);
 assert.deepEqual(payload.players.map(ids),[['edo'],[],['kagoshima'],[],[],['castle_lord']]);
 assert.deepEqual(h.sql.prepare('SELECT * FROM castle_residents ORDER BY user_id').all(),before);
});

await scenario('the crest follows committed membership loss and never trusts a forged home, badge or role',async h=>{
 const person=await fixture(h,'所属失効の一般領主',{startCastle:'inuyama'}),unentered=await h.session('未入城の一般領主');
 const snapshot=h.sql.prepare('SELECT * FROM castle_residents WHERE user_id=?').get(person.user.id);
 let changed=false;
 h.beforeBatch=statements=>{if(changed||!statements.some(s=>s.sql.includes('public-city-honors')))return;changed=true;h.sql.prepare('DELETE FROM castle_residents WHERE user_id=?').run(person.user.id);};
 const payload={players:[person,unentered].map(player=>({id:player.user.id,name:player.user.name,homeCastleId:'inuyama',cityHonors:[CASTLE_LORD_HONOR]}))};
 await resolveMembership(h,payload);assert(changed);assert.deepEqual(payload.players.map(ids),[[],[]]);h.beforeBatch=null;
 h.sql.prepare('INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at) VALUES(?,?,?,?)').run(person.user.id,snapshot.castle_id,snapshot.join_order,h.now+1);
 await resolveMembership(h,payload);assert.deepEqual(ids(payload.players[0]),[],'future membership does not issue an early crest');
 h.now+=1;await resolveMembership(h,payload);assert.deepEqual(ids(payload.players[0]),['castle_lord']);
});

await scenario('all ordinary castles work across bounded pages while special or unknown seats cannot issue the crest',async h=>{
 await h.api('/castles/residency');
 const castles=[...RESIDENCY_CASTLES.map(castle=>castle.id),'edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima','unknown_castle'],people=[];
 for(const [index,castleId]of castles.entries()){
  const id='u_crest_page_'+index,name='紋章確認'+index;h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)').run(id,name,name,'織田家',id,h.now,h.now);
  h.sql.prepare('INSERT INTO castle_seats(castle_id) VALUES(?) ON CONFLICT(castle_id) DO NOTHING').run(castleId);
  h.sql.prepare('INSERT INTO castle_residents(user_id,castle_id,join_order,joined_at) VALUES(?,?,?,?)').run(id,castleId,index+1,h.now);
  people.push({id,name,homeCastleId:'inuyama',cityHonors:[CASTLE_LORD_HONOR]});
 }
 assert(people.length>80);await resolveMembership(h,{players:people});
 for(const [index,person]of people.entries())assert.deepEqual(ids(person),index<RESIDENCY_CASTLES.length?['castle_lord']:[],castles[index]);
 assert.equal(maxBindings,85,'one bounded membership query adds five parameters to at most eighty public identities');
});

await scenario('voice participants receive the ordinary crest without exposing their private player IDs',async h=>{
 const lord=await fixture(h,'紋章通話の領主',{startCastle:'inuyama'}),retainer=await fixture(h,'紋章通話の家臣',{startCastle:'inuyama'});
 const guild=(await h.api('/guild',post(lord,{name:'紋章の通話同盟'}))).data.guild;
 await h.api('/guild/join',post(retainer,{guildId:guild.id}));
 for(const person of [lord,retainer])await h.api('/voice/join',post(person,{channel:'guild',muted:true}));
 const participants=(await h.api('/voice/room?channel=guild',{token:lord.token})).data.participants;
 assert.equal(participants.length,2);for(const person of participants){assert.deepEqual(ids(person),['castle_lord']);assert.match(person.sessionId,/^vc_[a-f0-9]{32}$/);assert(!Object.hasOwn(person,'id'));assert(!Object.hasOwn(person,'playerId'));assert(!Object.hasOwn(person,'userId'));}
});

await scenario('private campaign identities are not decorated and anonymous court messages do not acquire a player identity',async h=>{
 const person={id:'u_local',name:'表示確認'},payload={save:{state:{person}},state:{person},entitlements:{person},messages:[{author:{kind:'court',id:null,name:'朝廷'}}]};
 let queried=false;
 const result=await resolvePublicCityHonors(h.db,payload,h.now,{getWorldClock:async()=>{queried=true;throw Error('Unexpected identity read');},eventCastleCandidates:()=>null});
 assert.equal(result,payload);assert.equal(queried,false);assert(!Object.hasOwn(person,'cityHonors'));assert.deepEqual(payload.messages[0].author,{kind:'court',id:null,name:'朝廷'});
});

console.log(JSON.stringify({passed:cases,localHttpRequests:calls,maxBindings,maxCompoundTerms,externalRequests:0}));
