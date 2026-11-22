import assert from 'node:assert/strict';
import {harness} from './test-support.mjs';

const h=harness();
try{
  const guest=path=>h.api(path);
  const search=text=>'/players?q='+encodeURIComponent(text);
  const profile=id=>'/players/'+id+'/profile';
  const sampled=id=>h.sql.prepare('INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)')
    .run('u_case_'+id,'検索軍団'+id,'検索軍団'+id,'織田家','local-test-'+id,h.now,h.now+id);
  for(let index=0;index<35;index++)sampled(index);
  const literal=await h.session('文字%_の領主'),viewer=await h.session('検索軍団の閲覧者');

  let saveReads=0;
  h.beforeBatch=queries=>{
    for(const query of queries)if(query.sql.includes('/* player-evaluation */'))saveReads+=query.params.length;
  };
  const hits=(await guest(search('検索軍団'))).data.players;
  assert.equal(hits.length,30);
  assert(hits.every(hit=>hit.id&&hit.name&&!Object.hasOwn(hit,'commander')&&!Object.hasOwn(hit,'isAdmin')));
  assert.equal(saveReads,0,'Anonymous directory must not read any complete save');
  assert.deepEqual((await guest(search('%_'))).data.players.map(p=>p.id),[literal.user.id]);
  assert.deepEqual((await guest(search(literal.user.id))).data.players.map(p=>p.id),[literal.user.id]);
  assert.equal(saveReads,0);
  await guest(profile(literal.user.id));
  assert.equal(saveReads,1,'The profile must request only the selected player’s save');
  h.beforeBatch=null;
  const signedInHits=(await h.api(search('検索軍団'),{token:viewer.token})).data.players;
  assert(signedInHits.every(p=>p.id!==viewer.user.id&&!Object.hasOwn(p,'commander')));
  assert.equal((await h.api(search('領'),{expected:400})).data.error.code,'INVALID_INPUT');
  assert.equal((await h.api(search('あ'.repeat(25)),{expected:400})).data.error.code,'INVALID_INPUT');
  await h.api(search('検索軍団'),{token:'invalid-token',expected:401});
  await h.api(profile(literal.user.id),{token:'invalid-token',expected:401});

  // Observe the same rate-limit code/Retry-After that the live Worker emits.
  h.resetRates();
  for(let i=0;i<20;i++)await guest(search('検索軍団'));
  const limited=await h.api(search('検索軍団'),{expected:429});
  assert.equal(limited.data.error.code,'RATE_LIMITED');assert.equal(limited.data.error.retryAfter,60);
  h.now+=60000;assert.equal((await guest(search('検索軍団'))).data.players.length,30);

  // Between reading the save and finishing the public projection this identity
  // can be removed from the visible directory. Previously loaded data must die.
  h.afterBatch=queries=>{
    if(!queries.some(query=>query.sql.includes('/* player-evaluation */')))return;
    h.afterBatch=null;
    h.sql.prepare('INSERT INTO player_bans(user_id,active,revision,banned_by,updated_at) VALUES(?,1,1,?,?)')
      .run(literal.user.id,viewer.user.id,h.now);
  };
  const withdrawn=await h.api(profile(literal.user.id),{expected:404});
  assert.equal(withdrawn.data.error.code,'PLAYER_NOT_FOUND');assert(!('player' in withdrawn.data));
  assert.equal((await guest(search('%_'))).data.players.length,0);
  console.log(JSON.stringify({passed:4,localHttpCalls:h.calls,productionRequests:0}));
}finally{h.close();}
