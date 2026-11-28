import assert from 'node:assert/strict';
import {createECDH,createPublicKey,generateKeyPairSync,randomBytes,verify} from 'node:crypto';
import {allowedPushEndpoint,sendWebPush,vapidAuthorization} from './web-push.js';

const NOW=Date.parse('2026-11-28T03:00:00Z'),HOUR=3600000;
const FCM='https://fcm.googleapis.com/fcm/send/compat-test',APPLE='https://regional.web.push.apple.com/push/compat-test';
const base64=value=>Buffer.from(value).toString('base64url');
let scopes=0;
function credentials(subject='https://www.kasai-solutions-inc.com/'){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=keys.privateKey.export({format:'jwk'}),pub=keys.publicKey.export({format:'jwk'});
 return{WEB_PUSH_PRIVATE_JWK:JSON.stringify(jwk),WEB_PUSH_PUBLIC_KEY:base64(Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')])),WEB_PUSH_SUBJECT:subject};
}
function validate(header,endpoint,env,now){
 const match=/^vapid t=([^,]+), k=([A-Za-z0-9_-]+)$/.exec(header);assert(match);assert.equal(match[2],env.WEB_PUSH_PUBLIC_KEY);
 const [metadata,payload,signature]=match[1].split('.'),claims=JSON.parse(Buffer.from(payload,'base64url').toString());
 assert.deepEqual(JSON.parse(Buffer.from(metadata,'base64url').toString()),{typ:'JWT',alg:'ES256'});
 assert.equal(claims.aud,new URL(endpoint).origin);assert.equal(claims.sub,env.WEB_PUSH_SUBJECT||'https://www.kasai-solutions-inc.com/');
 assert(claims.exp>Math.floor(now/1000),'token is still valid at its time of use');
 assert(claims.exp<=Math.floor(now/1000)+24*3600,'RFC 8292 expires within 24 hours of use');
 const key=createPublicKey({key:JSON.parse(env.WEB_PUSH_PRIVATE_JWK),format:'jwk'});
 assert.equal(Buffer.from(signature,'base64url').length,64);
 assert(verify('sha256',Buffer.from(metadata+'.'+payload),{key,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')),'independent verifier accepts ES256 signature');
 return claims;
}
async function scope(name,run){await run();scopes++;console.log('PASS '+name);}

await scope('same-origin concurrent callers and later messages reuse one signed VAPID token',async()=>{
 const env=credentials('mailto:push-compat@example.invalid');
 const first=vapidAuthorization(FCM,env,NOW),concurrent=vapidAuthorization(FCM+'/second',{...env},NOW);
 assert.strictEqual(concurrent,first,'concurrent callers share the same in-flight promise');
 const header=await first,claims=validate(header,FCM,env,NOW);
 for(const elapsed of [1,59999,HOUR-1,HOUR,2*HOUR,10*HOUR]){
  const next=vapidAuthorization(FCM,env,NOW+elapsed);assert.strictEqual(next,first);assert.equal(await next,header);validate(header,FCM,env,NOW+elapsed);
 }
 const renewalTime=claims.exp*1000-HOUR;
 assert.strictEqual(vapidAuthorization(FCM,env,renewalTime-1),first,'cache lasts until the final-hour safety window');
 const renewed=vapidAuthorization(FCM,env,renewalTime);assert.notStrictEqual(renewed,first);
 const renewedHeader=await renewed;assert.notEqual(renewedHeader,header);validate(renewedHeader,FCM,env,renewalTime);
 assert.strictEqual(vapidAuthorization(FCM,env,renewalTime+HOUR),renewed,'renewed JWT is also retained for at least an hour');
});

await scope('VAPID audiences are isolated while paths on one push service share a token',async()=>{
 const env=credentials(),fcm=vapidAuthorization(FCM,env,NOW),apple=vapidAuthorization(APPLE,env,NOW);
 assert.notStrictEqual(fcm,apple);assert.notEqual(await fcm,await apple);
 validate(await fcm,FCM,env,NOW);validate(await apple,APPLE,env,NOW);
 assert.strictEqual(vapidAuthorization(APPLE+'/another',env,NOW+1000),apple);
 assert.strictEqual(vapidAuthorization(FCM,env,NOW+1000),fcm);
});

await scope('subject and key configuration changes invalidate previously signed tokens',async()=>{
 const env=credentials(),first=vapidAuthorization(FCM,env,NOW);await first;
 env.WEB_PUSH_SUBJECT='mailto:changed@example.invalid';const changedSubject=vapidAuthorization(FCM,env,NOW+1);
 assert.notStrictEqual(changedSubject,first);validate(await changedSubject,FCM,env,NOW+1);
 const replacement=credentials(env.WEB_PUSH_SUBJECT),oldPublicKey=env.WEB_PUSH_PUBLIC_KEY;
 env.WEB_PUSH_PRIVATE_JWK=replacement.WEB_PUSH_PRIVATE_JWK;
 const changedPrivate=vapidAuthorization(FCM,env,NOW+2);assert.notStrictEqual(changedPrivate,changedSubject);
 validate(await changedPrivate,FCM,env,NOW+2);
 env.WEB_PUSH_PUBLIC_KEY=replacement.WEB_PUSH_PUBLIC_KEY;assert.notEqual(env.WEB_PUSH_PUBLIC_KEY,oldPublicKey);
 const changedPublic=vapidAuthorization(FCM,env,NOW+3);assert.notStrictEqual(changedPublic,changedPrivate);validate(await changedPublic,FCM,env,NOW+3);
 delete env.WEB_PUSH_SUBJECT;const defaultSubject=vapidAuthorization(FCM,env,NOW+4);assert.notStrictEqual(defaultSubject,changedPublic);validate(await defaultSubject,FCM,env,NOW+4);
});

await scope('clock rollback and large forward jumps cannot reuse invalid future or expired JWTs',async()=>{
 const env=credentials(),first=vapidAuthorization(APPLE,env,NOW);await first;
 const rollback=NOW-48*HOUR,afterRollback=vapidAuthorization(APPLE,env,rollback);assert.notStrictEqual(afterRollback,first);validate(await afterRollback,APPLE,env,rollback);
 const afterJump=vapidAuthorization(APPLE,env,NOW+48*HOUR);assert.notStrictEqual(afterJump,afterRollback);validate(await afterJump,APPLE,env,NOW+48*HOUR);
 for(const invalid of [NaN,Infinity,-Infinity,-1])await assert.rejects(vapidAuthorization(APPLE,env,invalid),/Invalid VAPID timestamp/);
});

await scope('failed signatures are retryable and a stale rejection cannot remove a renewed token',async()=>{
 const env=credentials(),originalSign=crypto.subtle.sign;let rejectFirst,entered,first=true;
 const started=new Promise(resolve=>entered=resolve);
 crypto.subtle.sign=function(...args){if(first){first=false;entered();return new Promise((resolve,reject)=>rejectFirst=reject);}return originalSign.apply(this,args);};
 try{
  const pending=vapidAuthorization(FCM,env,NOW),failure=assert.rejects(pending,/simulated signature failure/);await started;
  const renewed=vapidAuthorization(FCM,env,NOW+12*HOUR);validate(await renewed,FCM,env,NOW+12*HOUR);
  rejectFirst(new Error('simulated signature failure'));await failure;
  assert.strictEqual(vapidAuthorization(FCM,env,NOW+12*HOUR+1),renewed,'stale error leaves the replacement cache entry intact');
 }finally{crypto.subtle.sign=originalSign;}
 const retryEnv=credentials();let fail=true;
 crypto.subtle.sign=function(...args){if(fail){fail=false;return Promise.reject(new Error('temporary signer failure'));}return originalSign.apply(this,args);};
 try{
  const failed=vapidAuthorization(FCM,retryEnv,NOW);await assert.rejects(failed,/temporary signer failure/);
  const retried=vapidAuthorization(FCM,retryEnv,NOW);assert.notStrictEqual(retried,failed);validate(await retried,FCM,retryEnv,NOW);
 }finally{crypto.subtle.sign=originalSign;}
});

await scope('Apple push subdomains are allowed without broadening HTTPS or SSRF guards',async()=>{
 for(const endpoint of [APPLE,'https://web.push.apple.com/token','https://web2.push.apple.com/token','https://a.b.push.apple.com/token',FCM,'https://updates.push.services.mozilla.com/wpush/v2/token','https://wns2-par02p.notify.windows.com/w/?token'])assert.equal(allowedPushEndpoint(endpoint),true,endpoint);
 for(const endpoint of [
  'http://web.push.apple.com/token','https://push.apple.com/token','https://.push.apple.com/token','https://evilpush.apple.com/token',
  'https://web.push.apple.com.evil.invalid/token','https://web.push.apple.com@evil.invalid/token','https://name:pass@web.push.apple.com/token',
  'https://web.push.apple.com:444/token','https://web.push.apple.com/#x','https://web.push.apple.com./token','https://127.0.0.1/push','https://[::1]/push',
  'https://fcm.googleapis.com.attacker.invalid/push','https://web.push.apple.com/'+ 'a'.repeat(2048),
 ])assert.equal(allowedPushEndpoint(endpoint),false,endpoint);
});

await scope('Apple sends retain encrypted payloads, redirect refusal and cancellation with reused JWTs',async()=>{
 const env=credentials(),ecdh=createECDH('prime256v1');ecdh.generateKeys();
 const subscription={endpoint:APPLE,p256dh:base64(ecdh.getPublicKey()),auth:base64(randomBytes(16))},payload={title:'戦国VS',body:'新しいメッセージが届きました'};
 const originalFetch=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(null,{status:201});};
 try{
  assert((await sendWebPush(subscription,payload,env,NOW)).ok);assert((await sendWebPush(subscription,payload,env,NOW+HOUR)).ok);assert.equal(calls.length,2);
  assert.equal(calls[0].options.headers.Authorization,calls[1].options.headers.Authorization);validate(calls[1].options.headers.Authorization,APPLE,env,NOW+HOUR);
  for(const call of calls){assert.equal(call.url,APPLE);assert.equal(call.options.method,'POST');assert.equal(call.options.redirect,'error');assert.equal(call.options.headers['Content-Encoding'],'aes128gcm');assert(call.options.body instanceof Uint8Array);assert(call.options.body.length<4096);assert(!Buffer.from(call.options.body).includes(Buffer.from(payload.body)));}
  assert.notDeepEqual(calls[0].options.body,calls[1].options.body,'encryption keeps a fresh salt and ECDH key despite JWT reuse');
  assert((await sendWebPush(subscription,payload,env,NOW+HOUR,async()=>false)).cancelled);
  assert.equal((await sendWebPush({...subscription,endpoint:'https://web.push.apple.com.evil.invalid/token'},payload,env,NOW)).status,410);
  assert.equal(calls.length,2,'cancelled or rejected destinations never reach fetch');
 }finally{globalThis.fetch=originalFetch;}
});

console.log(`Web Push compatibility: ${scopes} scopes passed; every outbound push used a fetch mock.`);
