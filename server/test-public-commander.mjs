import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';
import {GAME_OFFICERS} from './game-runtime.js';

const officerNames=new Map(GAME_OFFICERS.map(officer=>[officer.id,officer.name]));
const profileKeys=['id','name','clan','guildId','guildName','guildRole','avatarVersion','evaluation','courtOffice','appearance','commander'].sort();
const publicCommander=(officerId,rank)=>({officerId,name:officerNames.get(officerId),rank});
let passed=0;
async function scenario(name,run){
  const h=harness();
  try{await run(h);passed++;console.log('PASS '+name);}finally{h.close();}
}
async function readProfile(h,id,viewer){
  const {data}=await h.api('/players/'+encodeURIComponent(id)+'/profile',{token:viewer?.token});
  assert.deepEqual(Object.keys(data).sort(),['ok','player']);
  assert.deepEqual(Object.keys(data.player).sort(),profileKeys);
  const appearance=data.player.appearance;
  assert.deepEqual(Object.keys(appearance).sort(),['badge','nameplate','ownedProducts','town']);
  assert(appearance.ownedProducts.every(id=>['gold-banner','moonlit-castle','supporter'].includes(id)));
  if(data.player.evaluation!==null)assert.deepEqual(Object.keys(data.player.evaluation).sort(),['maxScore','rankId','rankIndex','rankName','score','version']);
  return data.player;
}
async function openCampaign(h,actor){
  const deviceId='commander-test-'+actor.user.id;
  const {data:lease}=await h.api('/sync/lease',{token:actor.token,method:'POST',body:{deviceId}});
  const save=h.fresh();save.state.worldClock={id:lease.clock.id,elapsedMs:lease.clock.elapsedMs};
  save.state.turn=Math.floor(lease.clock.elapsedMs/60000);save.state.realtime.elapsed=lease.clock.elapsedMs%60000/1000;
  let revision=lease.revision;
  return {save,async write(){const {data}=await h.api('/sync',{token:actor.token,method:'PUT',body:{deviceId,revision,save}});revision=data.revision;}};
}

await scenario('signed-out, self, and visiting lords read the same allowlisted public profile without an army',async h=>{
  const host=await h.session('御影の城主'),visitor=await h.session('丹波の旅人');
  const list=(await h.api('/players?q='+encodeURIComponent(host.user.id))).data.players;
  assert(list.some(p=>p.id===host.user.id&&p.name===host.user.name));
  const publicView=await readProfile(h,host.user.id);
  assert.equal(publicView.commander,null);assert.equal(publicView.id,host.user.id);
  assert.deepEqual(await readProfile(h,host.user.id,host),publicView);
  assert.deepEqual(await readProfile(h,host.user.id,visitor),publicView);
  assert.equal((await h.api('/me',{token:host.token})).data.user.commander,null);
});

await scenario('synchronized command swaps select slot one and its best owned rank across self, guests and peers',async h=>{
  const host=await h.session('三河の指揮官'),visitor=await h.session('山城の領主');
  const {save,write}=await openCampaign(h,host),[first,second,third]=save.state.army;
  save.state.officerVariants=save.state.officerVariants.filter(key=>!key.startsWith(first+':')).concat(first+':B',first+':D');
  await write();
  assert.deepEqual((await readProfile(h,host.user.id)).commander,publicCommander(first,'B'));
  assert.deepEqual((await readProfile(h,host.user.id,visitor)).commander,publicCommander(first,'B'));
  save.state.army=[second,third,first];await write();
  const updated=publicCommander(second,'S');
  assert.deepEqual((await h.api('/me',{token:host.token})).data.user.commander,updated);
  assert.deepEqual((await readProfile(h,host.user.id)).commander,updated);
  assert.deepEqual((await readProfile(h,host.user.id,visitor)).commander,updated);
  save.state.army=[];await write();
  assert.equal((await readProfile(h,host.user.id,visitor)).commander,null);
});

await scenario('existing saves predating officer variants restore base ranks without writing the save on a profile read',async h=>{
  const host=await h.session('古い軍団の城主'),campaign=await openCampaign(h,host);
  await campaign.write();
  const raw=JSON.parse(h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(host.user.id).save_json);
  const officer=raw.state.army[1];raw.state.army=[officer];delete raw.state.officerVariants;
  const stored=JSON.stringify(raw);h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(stored,host.user.id);
  assert.deepEqual((await readProfile(h,host.user.id)).commander,publicCommander(officer,GAME_OFFICERS.find(o=>o.id===officer).rank));
  assert.equal(h.sql.prepare('SELECT save_json FROM player_saves WHERE user_id=?').get(host.user.id).save_json,stored);
  raw.state.army=['missing-private-officer',officer];h.sql.prepare('UPDATE player_saves SET save_json=? WHERE user_id=?').run(JSON.stringify(raw),host.user.id);
  assert.equal((await readProfile(h,host.user.id)).commander,null);
});

await scenario('invalid credentials and banned or missing targets disclose neither player data nor their commander',async h=>{
  const host=await h.session('公開停止の城主'),admin=await h.session('確認役');
  const campaign=await openCampaign(h,host);await campaign.write();
  const path='/players/'+host.user.id+'/profile';
  const invalid=(await h.api(path,{token:'invalid-local-profile-token',expected:401})).data;
  assert.equal(invalid.player,undefined);
  h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(host.user.id,'非公開の停止理由',admin.user.id,h.now,h.now);
  for(const id of [host.user.id,'u_missing_commander'])for(const token of [undefined,admin.token]){
    const {data}=await h.api('/players/'+id+'/profile',{token,expected:404});
    assert.equal(data.player,undefined);assert.doesNotMatch(JSON.stringify(data),/非公開の停止理由|公開停止の城主|織田信長|officerId/);
  }
  assert(!(await h.api('/players?q='+encodeURIComponent(host.user.id))).data.players.some(player=>player.id===host.user.id));
});
console.log(`${passed} public commander end-to-end API scenarios passed using isolated worker and SQLite fixtures.`);
