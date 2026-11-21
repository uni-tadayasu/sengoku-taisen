import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {harness} from './test-support.mjs';

const h=harness(),{api,sql,bucket}=h;
const fixture=name=>new Uint8Array(readFileSync(new URL('./fixtures/avatar/'+name+'.jpg',import.meta.url)));
const imageBody=bytes=>({image:Buffer.from(bytes).toString('base64')});
const version=bytes=>createHash('sha256').update(bytes).digest('hex');
const upload=(p,bytes,extra={})=>api('/me/avatar',{method:'PUT',token:p.token,body:imageBody(bytes),...extra});
const remove=(p,extra={})=>api('/me/avatar',{method:'DELETE',token:p.token,...extra});
const meta=p=>sql.prepare('SELECT * FROM user_avatars WHERE user_id=?').get(p.user.id);
const getPhoto=(p,v,extra={})=>api('/avatars/'+p.user.id+(v?'?v='+v:''),extra);
try{
 const alice=await h.session('写真の領主'),bob=await h.session('写真の隣人'),admin=await h.session('写真の運営');
 await api('/admin/claim',{method:'POST',token:admin.token,body:{key:h.env.SENGOKU_ADMIN_KEY}});
 await api('/admin/staff',{method:'POST',token:admin.token,body:{targetPlayerId:bob.user.id,action:'appoint',requestId:crypto.randomUUID()}});
 assert.equal(alice.user.avatarVersion,null);
 await api('/me/avatar',{method:'PUT',body:imageBody(fixture('baseline')),expected:401});
 await api('/me/avatar',{method:'DELETE',expected:401});
 await getPhoto(alice,null,{expected:404});
 const chrome=await upload(alice,fixture('chrome-canvas'));assert.match(chrome.data.user.avatarVersion,/^[0-9a-f]{64}$/);assert.equal(chrome.data.user.id,alice.user.id);assert(!chrome.data.user.isAdmin);
 const chromePhoto=await getPhoto(alice,chrome.data.user.avatarVersion);assert(chromePhoto.bytes.length<=49152);assert.equal(version(chromePhoto.bytes),chrome.data.user.avatarVersion);assert.equal(chromePhoto.response.headers.get('access-control-allow-origin'),'https://www.kasai-solutions-inc.com');assert.equal(chromePhoto.response.headers.get('referrer-policy'),'no-referrer');assert(chromePhoto.response.headers.get('content-security-policy').includes("default-src 'none'"));
 const current=meta(alice);assert.deepEqual(Object.keys(current).sort(),['user_id','version','object_key','content_type','byte_length','updated_at'].sort());assert(!JSON.stringify(current).includes('base64'));assert.equal(current.content_type,'image/jpeg');assert.equal(Number(current.byte_length),chromePhoto.bytes.length);
 await api('/avatars/'+alice.user.id+'?v=bad',{expected:400});await getPhoto(alice,'0'.repeat(64),{expected:404});await getPhoto(alice,current.version,{origin:'https://attacker.example',expected:403});
 for(const body of [{image:imageBody(fixture('baseline')).image,userId:bob.user.id},{image:imageBody(fixture('baseline')).image,isAdmin:true},{image:'data:image/jpeg;base64,AAAA'},{image:'<svg/>'},{image:'AAAA\n'},{image:'AB=='},{image:37},{url:'https://external.example/photo.jpg'}]){h.resetRates();await api('/me/avatar',{method:'PUT',token:alice.token,body,expected:400});}
 h.resetRates();await api('/me/avatar',{method:'PUT',token:alice.token,rawBody:' '.repeat(70*1024+1),expected:413});await upload(alice,new Uint8Array(49153),{expected:413});await upload(alice,fixture('oversize-dimension'),{expected:400});assert.equal(meta(alice).version,current.version);
 // Direct API uploads cannot retain EXIF/GPS/comments, even if the browser was bypassed.
 const privateBytes=Buffer.from('EXIF GPS private-original-filename'),segment=Buffer.concat([Buffer.from([255,225,0,privateBytes.length+2]),privateBytes]);
 const baseline=fixture('baseline'),supplied=Buffer.concat([baseline.slice(0,2),segment,baseline.slice(2)]);
 h.resetRates();const clean=await upload(alice,supplied),cleanPhoto=await getPhoto(alice,clean.data.user.avatarVersion);assert.deepEqual(cleanPhoto.bytes,fixture('baseline-clean'));assert(!Buffer.from(cleanPhoto.bytes).includes(privateBytes));assert.equal(clean.data.user.avatarVersion,version(fixture('baseline-clean')));await getPhoto(alice,current.version,{expected:404});assert(!bucket.objects.has(current.object_key));
 await upload(bob,fixture('progressive'));await upload(admin,fixture('grayscale'));
 assert.equal((await api('/me',{token:bob.token})).data.user.isStaff,true);assert.equal((await api('/me',{token:admin.token})).data.user.clan,'德川家');
 await api('/presence',{method:'POST',token:alice.token,body:{deviceId:'avatar-device',online:true}});
 await api('/friends/request',{method:'POST',token:alice.token,body:{userId:bob.user.id}});
 assert.equal((await api('/me',{token:bob.token})).data.requests.find(p=>p.id===alice.user.id).avatarVersion,meta(alice).version);
 await api('/friends/respond',{method:'POST',token:bob.token,body:{userId:alice.user.id,accept:true}});
 assert.equal((await api('/me',{token:bob.token})).data.friends.find(p=>p.id===alice.user.id).avatarVersion,meta(alice).version);
 assert.equal((await api('/online')).data.players.find(p=>p.id===alice.user.id).avatarVersion,meta(alice).version);
 assert.equal((await api('/players?q='+encodeURIComponent('写真'),{token:bob.token})).data.players.find(p=>p.id===alice.user.id).avatarVersion,meta(alice).version);
 await api('/chat',{method:'POST',token:alice.token,body:{channel:'world',text:'ローカル試験の写真確認'}});assert.equal((await api('/chat?channel=world',{token:bob.token})).data.messages[0].avatarVersion,meta(alice).version);
 const guild=(await api('/guild',{method:'POST',token:alice.token,body:{name:'写真の試験軍'}})).data.guild;
 await api('/guild/join',{method:'POST',token:bob.token,body:{guildId:guild.id}});assert.equal((await api('/guild',{token:bob.token})).data.members.find(p=>p.id===alice.user.id).avatarVersion,meta(alice).version);
 await api('/sync/lease',{method:'POST',token:alice.token,body:{deviceId:'avatar-device'}});await api('/sync',{method:'PUT',token:alice.token,body:{deviceId:'avatar-device',revision:0,save:h.fresh()}});assert.equal((await api('/field')).data.players.find(p=>p.playerId===alice.user.id).avatarVersion,meta(alice).version);
 for(const route of ['/me','/online','/players?q='+encodeURIComponent('写真'),'/chat?channel=world','/guild','/staff/recent-logins']){const result=await api(route,{token:route==='/staff/recent-logins'?admin.token:alice.token});const serialized=JSON.stringify(result.data);for(const hidden of ['base64','object_key','byte_length','private-original-filename',imageBody(baseline).image,alice.token])assert(!serialized.includes(hidden));}
 // Pairing identifies the same account; another device changes only its own photo.
 const code=(await api('/devices/pair-code',{method:'POST',token:alice.token,body:{}})).data.code;
 const linked=(await api('/devices/link',{method:'POST',body:{code}})).data;
 h.resetRates();const beforeBob=meta(bob).version;await upload(linked,fixture('progressive'));assert.equal(meta(bob).version,beforeBob);assert.equal((await api('/me',{token:alice.token})).data.user.avatarVersion,version(fixture('progressive-clean')));
 const oldVersion=meta(alice).version;assert.equal((await remove(linked)).data.user.avatarVersion,null);await getPhoto(alice,oldVersion,{expected:404});await getPhoto(alice,null,{expected:404});assert.equal((await remove(alice,{body:{}})).data.user.avatarVersion,null);
 await upload(alice,fixture('progressive'));assert.equal(meta(alice).version,oldVersion);assert.deepEqual((await getPhoto(alice,oldVersion)).bytes,fixture('progressive-clean'));
 // Concurrent replacements retain exactly the committed image. Old-key cleanup
 // never removes either request's newer committed object.
 h.resetRates();await Promise.all([upload(alice,fixture('baseline')),upload(alice,fixture('grayscale'))]);assert(bucket.objects.has(meta(alice).object_key));assert.equal((await getPhoto(alice,meta(alice).version)).bytes.length,Number(meta(alice).byte_length));
 const prior=meta(alice);bucket.beforePut=()=>{throw new Error('local R2 outage');};await upload(alice,fixture('progressive'),{expected:503});bucket.beforePut=null;assert.equal(meta(alice).object_key,prior.object_key);assert(bucket.objects.has(prior.object_key));
 h.beforeBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO user_avatars'))){h.beforeBatch=null;throw new Error('local D1 rollback');}};await upload(alice,fixture('progressive'),{expected:500});assert.equal(meta(alice).object_key,prior.object_key);assert(bucket.objects.has(prior.object_key));
 h.afterBatch=statements=>{if(statements.some(s=>s.sql.includes('INSERT INTO user_avatars'))){h.afterBatch=null;throw new Error('local response loss after commit');}};await upload(alice,fixture('progressive'),{expected:500});assert.equal(meta(alice).version,version(fixture('progressive-clean')));assert(bucket.objects.has(meta(alice).object_key));await getPhoto(alice,meta(alice).version);
 // Delete/replace during the asynchronous R2 read must fail the final metadata
 // check, rather than returning a superseded image at its old URL.
 const beforeRead=meta(alice);bucket.afterGet=async()=>{bucket.afterGet=null;await remove(alice);};await getPhoto(alice,beforeRead.version,{expected:404});assert.equal(meta(alice),undefined);
 h.resetRates();await upload(alice,fixture('baseline'));const beforeDelete=meta(alice);bucket.beforeDelete=()=>{throw new Error('local object-delete outage');};assert.equal((await remove(alice)).data.user.avatarVersion,null);bucket.beforeDelete=null;assert(bucket.objects.has(beforeDelete.object_key));await getPhoto(alice,beforeDelete.version,{expected:404});
 // R2 cleanup failure leaves an unreachable object, never a stale public image.
 h.resetRates();for(let i=0;i<10;i++)await remove(alice);assert.equal((await upload(alice,fixture('baseline'),{expected:429})).data.error.code,'RATE_LIMITED');h.now+=600001;await upload(alice,fixture('baseline'));
 const provisioned=h.env.BUCKET;delete h.env.BUCKET;await upload(alice,fixture('baseline'),{expected:503});h.env.BUCKET=provisioned;
 console.log(JSON.stringify({ok:true,calls:h.calls,checks:['all schema-only migrations and R2 metadata separation','real Chrome 256px canvas JPEG accepted','strict size/base64/format validation and metadata stripping','self-only ownership, paired devices and staff access','public safe version projections including chat/field','no-store, current-version lookup, privacy and CORS','atomic metadata switch and unique object-key cleanup','concurrent upload, read-delete and storage/DB failure recovery','delete/reupload same hash never displays an older image','shared per-account upload/delete rate limit'],productionRequests:0},null,2));
}finally{h.close();}
