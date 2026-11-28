// RFC 8291 aes128gcm and RFC 8292 VAPID, using only the Worker Web Crypto API.
const enc=new TextEncoder();
// Apple asks senders to reuse each VAPID JWT for at least one hour. Keep a
// twelve-hour token until its final hour so a queued request cannot expire in
// transit. Each Worker isolate shares both completed and in-flight signatures.
const VAPID_LIFETIME_SECONDS=12*60*60,VAPID_REUSE_MS=11*60*60*1000;
let vapidCache=null;
const bytes=value=>typeof value==='string'?enc.encode(value):new Uint8Array(value);
const concat=(...parts)=>{const arrays=parts.map(bytes),out=new Uint8Array(arrays.reduce((n,p)=>n+p.length,0));let i=0;for(const p of arrays){out.set(p,i);i+=p.length;}return out;};
export const pushBase64=value=>btoa(String.fromCharCode(...bytes(value))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export const pushDecode=value=>Uint8Array.from(atob(String(value).replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
async function hkdf(key,salt,info,length){const raw=await crypto.subtle.importKey('raw',bytes(key),'HKDF',false,['deriveBits']);return new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:bytes(salt),info:bytes(info)},raw,length*8));}
export function allowedPushEndpoint(value){
 try{const u=new URL(value),host=u.hostname.toLowerCase();return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.hash&&u.href.length<=2048&&(host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||host.endsWith('.push.services.mozilla.com')||(host.endsWith('.push.apple.com')&&host.length>'.push.apple.com'.length)||host.endsWith('.notify.windows.com')||host==='wns2-par02p.notify.windows.com');}catch(_){return false;}
}
export async function encryptPush(subscription,payload){
 const ua=pushDecode(subscription.p256dh),auth=pushDecode(subscription.auth);
 if(ua.length!==65||ua[0]!==4||auth.length!==16)throw Error('Invalid subscription key');
 const receiver=await crypto.subtle.importKey('raw',ua,{name:'ECDH',namedCurve:'P-256'},false,[]);
 const sender=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),pub=new Uint8Array(await crypto.subtle.exportKey('raw',sender.publicKey));
 const secret=await crypto.subtle.deriveBits({name:'ECDH',public:receiver},sender.privateKey,256);
 const ikm=await hkdf(secret,auth,concat('WebPush: info\0',ua,pub),32),salt=crypto.getRandomValues(new Uint8Array(16));
 const key=await hkdf(ikm,salt,'Content-Encoding: aes128gcm\0',16),nonce=await hkdf(ikm,salt,'Content-Encoding: nonce\0',12);
 const plain=concat(JSON.stringify(payload),new Uint8Array([2]));if(plain.length>3000)throw Error('Push payload too large');
 const aes=await crypto.subtle.importKey('raw',key,'AES-GCM',false,['encrypt']);
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce,tagLength:128},aes,plain);
 const header=new Uint8Array(21);header.set(salt);new DataView(header.buffer).setUint32(16,4096,false);header[20]=pub.length;
 return concat(header,pub,encrypted);
}
async function signVapidAuthorization(audience,config,now){
 const key=await crypto.subtle.importKey('jwk',JSON.parse(config.privateJwk),{name:'ECDSA',namedCurve:'P-256'},false,['sign']);
 const data=pushBase64(JSON.stringify({typ:'JWT',alg:'ES256'}))+'.'+pushBase64(JSON.stringify({aud:audience,exp:Math.floor(now/1000)+VAPID_LIFETIME_SECONDS,sub:config.subject}));
 const signature=await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},key,enc.encode(data));
 return 'vapid t='+data+'.'+pushBase64(signature)+', k='+config.publicKey;
}
export function vapidAuthorization(endpoint,env,now=Date.now()){
 try{
  if(!Number.isFinite(now)||now<0||!Number.isSafeInteger(Math.floor(now/1000)))throw Error('Invalid VAPID timestamp');
  const audience=new URL(endpoint).origin,privateJwk=env.WEB_PUSH_PRIVATE_JWK,publicKey=env.WEB_PUSH_PUBLIC_KEY,subject=env.WEB_PUSH_SUBJECT||'https://www.kasai-solutions-inc.com/';
  if(!vapidCache||vapidCache.privateJwk!==privateJwk||vapidCache.publicKey!==publicKey||vapidCache.subject!==subject)vapidCache={privateJwk,publicKey,subject,tokens:new Map()};
  const cache=vapidCache,existing=cache.tokens.get(audience);
  // A clock rollback invalidates a token issued in the apparent future, rather
  // than keeping it indefinitely or exceeding VAPID's 24-hour expiry ceiling.
  if(existing&&now>=existing.issuedAt&&now<existing.renewAt)return existing.promise;
  for(const [origin,entry] of cache.tokens)if(now>=entry.renewAt)cache.tokens.delete(origin);
  const entry={issuedAt:now,renewAt:now+VAPID_REUSE_MS,promise:null};
  entry.promise=signVapidAuthorization(audience,cache,now).catch(error=>{if(cache.tokens.get(audience)===entry)cache.tokens.delete(audience);throw error;});
  cache.tokens.set(audience,entry);
  return entry.promise;
 }catch(error){return Promise.reject(error);}
}
export async function sendWebPush(subscription,payload,env,now=Date.now(),beforeSend=null){
 if(!allowedPushEndpoint(subscription.endpoint))return{status:410,ok:false};
 const body=await encryptPush(subscription,payload),authorization=await vapidAuthorization(subscription.endpoint,env,now);
 // Encryption/signing can yield to an opt-out, ban or device removal. Commit
 // the delivery reservation only after those operations, immediately before I/O.
 if(beforeSend&&!await beforeSend())return{status:0,ok:false,cancelled:true};
 const response=await fetch(subscription.endpoint,{method:'POST',redirect:'error',headers:{Authorization:authorization,TTL:'3600',Urgency:'normal','Content-Encoding':'aes128gcm','Content-Type':'application/octet-stream'},body,signal:AbortSignal.timeout(10000)});
 return{status:response.status,ok:response.ok};
}
