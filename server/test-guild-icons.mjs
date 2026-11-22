import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {harness} from './test-support.mjs';

const h=harness(),{api,sql,bucket}=h;
const fixture=name=>new Uint8Array(readFileSync(new URL('./fixtures/avatar/'+name+'.jpg',import.meta.url)));
const encode=bytes=>Buffer.from(bytes).toString('base64');
const version=bytes=>createHash('sha256').update(bytes).digest('hex');
const meta=id=>sql.prepare('SELECT * FROM guild_icons WHERE guild_id=?').get(id);
const upload=(player,guildId,bytes=fixture('baseline'),extra={})=>api('/guild/icon',{method:'PUT',token:player.token,body:{guildId,image:encode(bytes)},...extra});
const remove=(player,guildId,extra={})=>api('/guild/icon',{method:'DELETE',token:player.token,body:{guildId},...extra});
const image=(guildId,v,extra={})=>api('/guild-icons/'+guildId+(v?'?v='+v:''),extra);
const owner=(id,player)=>sql.prepare('UPDATE guilds SET owner_id=? WHERE id=?').run(player.user.id,id);
const unchanged=(id,previous)=>{assert.equal(meta(id).object_key,previous.object_key);assert(bucket.objects.has(previous.object_key));};
try{
 const leader=await h.session('同盟画像の盟主'),member=await h.session('同盟画像の仲間'),deputy=await h.session('同盟画像の副盟主'),outsider=await h.session('別同盟の盟主'),admin=await h.session('同盟画像の運営'),solo=await h.session('解散画像の盟主');
 await api('/admin/claim',{method:'POST',token:admin.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});
 const guild=(await api('/guild',{method:'POST',token:leader.token,body:{name:'画像確認の同盟'}})).data.guild;
 const other=(await api('/guild',{method:'POST',token:outsider.token,body:{name:'画像確認の別同盟'}})).data.guild;
 for(const player of [member,deputy]){h.now++;await api('/guild/join',{method:'POST',token:player.token,body:{guildId:guild.id}});}
 await api('/guild/members/role',{method:'POST',token:leader.token,body:{guildId:guild.id,targetPlayerId:deputy.user.id,role:'officer',requestId:crypto.randomUUID()}});
 assert.equal(guild.iconVersion,null);assert.equal((await api('/me',{token:member.token})).data.user.guildIconVersion,null);
 await api('/guild/icon',{method:'PUT',body:{guildId:guild.id,image:encode(fixture('baseline'))},expected:401});
 await api('/guild/icon',{method:'DELETE',body:{guildId:guild.id},expected:401});
 await image(guild.id,null,{expected:404});
 for(const player of [member,deputy,outsider,admin]){await upload(player,guild.id,fixture('baseline'),{expected:403});await remove(player,guild.id,{expected:403});}
 await upload(leader,other.id,fixture('baseline'),{expected:403});assert.equal(bucket.objects.size,0);

 // Group images have their own key, metadata and identity; a player's photo
 // remains unchanged when any alliance icon is added, replaced or removed.
 const personal=(await api('/me/avatar',{method:'PUT',token:leader.token,body:{image:encode(fixture('grayscale'))}})).data.user.avatarVersion;
 const first=(await upload(leader,guild.id,fixture('chrome-canvas'))).data;
 assert.equal(first.guild.id,guild.id);assert.match(first.guild.iconVersion,/^[0-9a-f]{64}$/);assert.equal(first.guild.ownerId,leader.user.id);
 assert(!Object.hasOwn(first.guild,'isAdmin'));assert(!Object.hasOwn(first.guild,'isStaff'));
 const current=meta(guild.id),photo=await image(guild.id,current.version);
 assert.deepEqual(Object.keys(current).sort(),['guild_id','version','object_key','content_type','byte_length','updated_at'].sort());
 assert(current.object_key.startsWith('guild-icons/'+guild.id+'/'));assert.equal(current.content_type,'image/jpeg');assert.equal(current.byte_length,photo.bytes.length);assert.equal(version(photo.bytes),first.guild.iconVersion);
 assert.equal(photo.response.headers.get('access-control-allow-origin'),'https://www.kasai-solutions-inc.com');assert.equal(photo.response.headers.get('referrer-policy'),'no-referrer');assert(photo.response.headers.get('content-security-policy').includes("default-src 'none'"));
 assert.equal((await image(guild.id,null,{origin:null})).response.headers.get('access-control-allow-origin'),null);
 await image(guild.id,'0'.repeat(64),{expected:404});await image(guild.id,'bad',{expected:400});await image(guild.id,current.version,{origin:'https://attacker.example',expected:403});
 await api('/guild-icons/bad%20id',{expected:400});
 for(const route of ['/guild','/guilds','/guild/rankings']){
  const result=(await api(route,{token:member.token})).data,group=result.guild||result.guilds.find(item=>item.id===guild.id);
  assert.equal(group.iconVersion,current.version,route);
  for(const hidden of ['object_key','byte_length','base64',leader.token])assert(!JSON.stringify(result).includes(hidden));
 }
 for(const route of ['/me','/sync','/players?q='+encodeURIComponent('同盟画像')]){
  const data=(await api(route,{token:member.token})).data,person=data.user||data.players.find(item=>item.id===leader.user.id);
  assert.equal(person.guildIconVersion,current.version,route);
 }
 assert.equal((await api('/me',{token:leader.token})).data.user.avatarVersion,personal);

 // Bodies carry an exact alliance id; foreign identity or privilege claims
 // cannot select an image owner. The JPEG normalizer strips private metadata.
 for(const body of [{image:encode(fixture('baseline'))},{guildId:guild.id},{guildId:guild.id,image:'<svg/>'},{guildId:guild.id,image:'data:image/jpeg;base64,AAAA'},{guildId:guild.id,image:'AB=='},{guildId:guild.id,image:'AAAA\n'},{guildId:guild.id,image:37},{guildId:guild.id,image:encode(fixture('baseline')),userId:outsider.user.id},{guildId:guild.id,image:encode(fixture('baseline')),isAdmin:true}]){
  h.resetRates();await api('/guild/icon',{method:'PUT',token:leader.token,body,expected:400});
 }
 for(const body of [{},{guildId:guild.id,image:'unused'},{guildId:guild.id,isAdmin:true}])await api('/guild/icon',{method:'DELETE',token:leader.token,body,expected:400});
 h.resetRates();await upload(leader,guild.id,new Uint8Array(49153),{expected:413});await upload(leader,guild.id,fixture('oversize-dimension'),{expected:400});
 await api('/guild/icon',{method:'PUT',token:leader.token,rawBody:' '.repeat(70*1024+1),expected:413});unchanged(guild.id,current);
 const privateBytes=Buffer.from('EXIF GPS private-alliance-filename'),segment=Buffer.concat([Buffer.from([255,225,0,privateBytes.length+2]),privateBytes]),baseline=fixture('baseline');
 const supplied=Buffer.concat([baseline.slice(0,2),segment,baseline.slice(2)]);
 const clean=(await upload(leader,guild.id,supplied)).data.guild,cleanImage=await image(guild.id,clean.iconVersion);
 assert.deepEqual(cleanImage.bytes,fixture('baseline-clean'));assert(!Buffer.from(cleanImage.bytes).includes(privateBytes));assert.equal(clean.iconVersion,version(fixture('baseline-clean')));assert(!bucket.objects.has(current.object_key));await image(guild.id,current.version,{expected:404});
 const same=meta(guild.id);await upload(leader,guild.id,fixture('baseline'));assert.equal(meta(guild.id).version,same.version);assert.notEqual(meta(guild.id).object_key,same.object_key);assert(!bucket.objects.has(same.object_key));
 await upload(outsider,other.id,fixture('progressive'));const otherBefore=meta(other.id);

 // Authority is checked in the metadata transaction after the awaited R2 put.
 h.resetRates();let prior=meta(guild.id),candidate;
 bucket.afterPut=key=>{bucket.afterPut=null;candidate=key;owner(guild.id,deputy);};
 assert.equal((await upload(leader,guild.id,fixture('progressive'),{expected:403})).data.error.code,'GUILD_ROLE_REQUIRED');unchanged(guild.id,prior);assert(!bucket.objects.has(candidate));owner(guild.id,leader);
 const joined=sql.prepare('SELECT joined_at FROM guild_members WHERE user_id=?').get(leader.user.id).joined_at;
 bucket.afterPut=key=>{bucket.afterPut=null;candidate=key;sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(leader.user.id);sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(leader.user.id,other.id,h.now+1);};
 assert.equal((await upload(leader,guild.id,fixture('progressive'),{expected:403})).data.error.code,'GUILD_REQUIRED');unchanged(guild.id,prior);unchanged(other.id,otherBefore);assert(!bucket.objects.has(candidate));
 sql.prepare('DELETE FROM guild_members WHERE user_id=?').run(leader.user.id);sql.prepare('INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)').run(leader.user.id,guild.id,joined);
 bucket.afterPut=key=>{bucket.afterPut=null;candidate=key;sql.prepare('INSERT INTO player_bans(user_id,active,revision,reason,banned_by,banned_at,updated_at) VALUES(?,1,1,?,?,?,?)').run(leader.user.id,'local race',admin.user.id,h.now,h.now);};
 assert.equal((await upload(leader,guild.id,fixture('progressive'),{expected:403})).data.error.code,'ACCOUNT_BANNED');unchanged(guild.id,prior);assert(!bucket.objects.has(candidate));
 // Existing alliance imagery belongs to the group; banning one leader does
 // not turn it into that player's personal avatar or remove it from members.
 await image(guild.id,prior.version);sql.prepare('UPDATE player_bans SET active=0,revision=2 WHERE user_id=?').run(leader.user.id);
 bucket.afterPut=key=>{bucket.afterPut=null;candidate=key;sql.prepare('UPDATE player_bans SET active=0,revision=revision+2 WHERE user_id=?').run(leader.user.id);};
 assert.equal((await upload(leader,guild.id,fixture('progressive'),{expected:409})).data.error.code,'ACCOUNT_ACCESS_CHANGED');unchanged(guild.id,prior);assert(!bucket.objects.has(candidate));
 h.beforeBatch=statements=>{if(statements.some(s=>s.sql.startsWith('DELETE FROM guild_icons'))){h.beforeBatch=null;owner(guild.id,deputy);}};
 await remove(leader,guild.id,{expected:403});unchanged(guild.id,prior);owner(guild.id,leader);

 // Unique storage keys prevent cleanup from deleting a concurrent winner.
 h.resetRates();await Promise.all([upload(leader,guild.id,fixture('baseline')),upload(leader,guild.id,fixture('grayscale'))]);assert(bucket.objects.has(meta(guild.id).object_key));await image(guild.id,meta(guild.id).version);
 prior=meta(guild.id);bucket.beforePut=()=>{throw Error('local R2 outage');};await upload(leader,guild.id,fixture('progressive'),{expected:503});bucket.beforePut=null;unchanged(guild.id,prior);
 h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO guild_icons'))){h.beforeBatch=null;throw Error('local D1 rollback');}};
 await upload(leader,guild.id,fixture('progressive'),{expected:500});unchanged(guild.id,prior);
 h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO guild_icons'))){h.afterBatch=null;throw Error('local D1 response loss');}};
 await upload(leader,guild.id,fixture('progressive'),{expected:500});assert.equal(meta(guild.id).version,version(fixture('progressive-clean')));assert(bucket.objects.has(meta(guild.id).object_key));await image(guild.id,meta(guild.id).version);

 // A GET that already loaded bytes must re-check metadata before responding.
 h.resetRates();prior=meta(guild.id);bucket.afterGet=async()=>{bucket.afterGet=null;await upload(leader,guild.id,fixture('baseline'));};await image(guild.id,prior.version,{expected:404});assert(!bucket.objects.has(prior.object_key));
 prior=meta(guild.id);bucket.afterGet=async()=>{bucket.afterGet=null;await remove(leader,guild.id);};await image(guild.id,prior.version,{expected:404});assert.equal(meta(guild.id),undefined);assert(!bucket.objects.has(prior.object_key));
 assert.equal((await remove(leader,guild.id)).data.guild.iconVersion,null);assert.equal((await api('/me',{token:member.token})).data.user.guildIconVersion,null);assert.equal((await api('/me',{token:leader.token})).data.user.avatarVersion,personal);
 await upload(leader,guild.id,fixture('baseline'));prior=meta(guild.id);bucket.beforeDelete=()=>{throw Error('local cleanup outage');};assert.equal((await remove(leader,guild.id)).data.guild.iconVersion,null);bucket.beforeDelete=null;assert(bucket.objects.has(prior.object_key));await image(guild.id,prior.version,{expected:404});
 await upload(leader,guild.id,fixture('baseline'));prior=meta(guild.id);
 await api('/guild/leave',{method:'POST',token:leader.token,body:{guildId:guild.id}});assert.equal(sql.prepare('SELECT owner_id FROM guilds WHERE id=?').get(guild.id).owner_id,deputy.user.id);unchanged(guild.id,prior);
 const next=(await api('/guild',{method:'POST',token:leader.token,body:{name:'新しく所属する同盟'}})).data.guild;
 await upload(leader,next.id,fixture('grayscale'));const nextBefore=meta(next.id);await upload(leader,guild.id,fixture('progressive'),{expected:403});await remove(leader,guild.id,{expected:403});unchanged(next.id,nextBefore);unchanged(guild.id,prior);

 // Dissolution deletes metadata in the guild transaction and cleans its exact
 // object afterwards. Nonempty treasuries still prevent the last departure.
 h.resetRates();const last=(await api('/guild',{method:'POST',token:solo.token,body:{name:'解散する画像同盟'}})).data.guild;
 await upload(solo,last.id,fixture('baseline'));const lastImage=meta(last.id);sql.prepare('UPDATE guild_treasuries SET gold=1 WHERE guild_id=?').run(last.id);
 await api('/guild/leave',{method:'POST',token:solo.token,body:{guildId:last.id},expected:409});unchanged(last.id,lastImage);sql.prepare('UPDATE guild_treasuries SET gold=0 WHERE guild_id=?').run(last.id);
 bucket.afterGet=async()=>{bucket.afterGet=null;await api('/guild/leave',{method:'POST',token:solo.token,body:{guildId:last.id}});};
 await image(last.id,lastImage.version,{expected:404});assert.equal(meta(last.id),undefined);assert.equal(sql.prepare('SELECT id FROM guilds WHERE id=?').get(last.id),undefined);assert(!bucket.objects.has(lastImage.object_key));
 h.resetRates();for(let i=0;i<10;i++)await remove(leader,next.id);assert.equal((await upload(leader,next.id,fixture('baseline'),{expected:429})).data.error.code,'RATE_LIMITED');
 h.now+=600001;await upload(leader,next.id,fixture('baseline'));const provisioned=h.env.BUCKET;delete h.env.BUCKET;await upload(leader,next.id,fixture('baseline'),{expected:503});h.env.BUCKET=provisioned;
 const health=(await api('/health')).data;assert.equal(health.version,'4.1.0');assert.equal(health.features.guildIcons,true);
 console.log(JSON.stringify({ok:true,calls:h.calls,checks:['schema-only guild icon metadata separate from player avatars','leader-only PUT/DELETE with explicit alliance identity','same JPEG validation, normalization and EXIF stripping','guild/member/list/ranking icon version projections without role leakage','current public image, no-store and post-read metadata validation','owner/membership/ban/revision changes while R2 is pending','unique-key concurrent writes and safe D1 response-loss recovery','replacement/removal/dissolution cleanup and inaccessible orphan objects','owner succession preserves group imagery and stale editors cannot alter new groups','shared write budget and independent avatar state'],productionRequests:0},null,2));
}finally{h.close();}
