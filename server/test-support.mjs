import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from './index.js';
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Local D1/R2 doubles. Each batch executes all statements synchronously inside
// one SQLite transaction, matching D1's atomic ordered batch semantics.
export function harness(){
 const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
 for(const entry of JSON.parse(readFileSync(new URL('./drizzle/meta/_journal.json',import.meta.url))).entries)for(const statement of readFileSync(new URL('./drizzle/'+entry.tag+'.sql',import.meta.url),'utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))sql.exec(statement);
 const h={sql,calls:0,now:1795219200000,beforeStatement:null,beforeBatch:null,afterBatch:null};
 const db={prepare(query){return this.statement(query,[]);},statement(query,params){const execute=async()=>{if(h.beforeStatement)await h.beforeStatement(query,params);return sql.prepare(query).all(...params);};return{sql:query,params,bind(...values){return db.statement(query,values);},async first(){return (await execute())[0]||null;},async all(){return{success:true,results:await execute()};},async run(){await execute();return{success:true,results:[]};}};},async batch(statements){if(h.beforeBatch)await h.beforeBatch(statements);sql.exec('BEGIN IMMEDIATE');let result;try{result=statements.map(s=>({success:true,results:sql.prepare(s.sql).all(...s.params)}));sql.exec('COMMIT');}catch(error){sql.exec('ROLLBACK');throw error;}if(h.afterBatch)await h.afterBatch(statements,result);return result;}};
 const objects=new Map(),bucket={objects,beforePut:null,afterPut:null,beforeGet:null,afterGet:null,beforeDelete:null,deletes:[],async put(key,value,options){if(this.beforePut)await this.beforePut(key,value);const bytes=new Uint8Array(value);objects.set(key,{bytes,options});if(this.afterPut)await this.afterPut(key,bytes);return{key,size:bytes.length};},async get(key){if(this.beforeGet)await this.beforeGet(key);const found=objects.get(key),bytes=found?.bytes.slice();if(this.afterGet)await this.afterGet(key);return bytes?{key,size:bytes.length,body:new Response(bytes).body}:null;},async delete(key){this.deletes.push(key);if(this.beforeDelete)await this.beforeDelete(key);objects.delete(key);}};
 h.env={DB:db,BUCKET:bucket,SENGOKU_ADMIN_KEY:'local-fixture-'+crypto.randomUUID()};h.db=db;h.bucket=bucket;
 h.api=async(path,{method='GET',token,body,rawBody,expected=200,origin='https://www.kasai-solutions-inc.com',headers={}}={})=>{
  const requestHeaders={...headers,'CF-Connecting-IP':headers['CF-Connecting-IP']||'192.0.2.35'};if(origin!==null)requestHeaders.Origin=origin;if(token)requestHeaders.Authorization='Bearer '+token;if(body!==undefined||rawBody!==undefined)requestHeaders['Content-Type']='application/json';
  const response=await worker.fetch(new Request('https://local.invalid/api/v1'+path,{method,headers:requestHeaders,body:rawBody??(body===undefined?undefined:JSON.stringify(body))}),h.env,{});h.calls++;
  const isImage=response.headers.get('content-type')==='image/jpeg',data=isImage?null:response.status===204?null:await response.json();
  if(expected!==null)assert.equal(response.status,expected,JSON.stringify({path,expected,status:response.status,error:data?.error}));
  assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  return {data,response,bytes:isImage?new Uint8Array(await response.arrayBuffer()):null};
 };
 h.session=async(name,clan='織田家')=>(await h.api('/session',{method:'POST',body:{name,clan}})).data;
 h.fresh=(home='kiyosu')=>{
  const save=JSON.parse(readFileSync(new URL('./fixtures/valid-save.json',import.meta.url),'utf8')),state=save.state;
  if(home!==state.home){
   const previous=state.home;assert(Object.hasOwn(state.castles,home),'Unknown fixture castle '+home);
   [state.castles[previous],state.castles[home]]=[state.castles[home],state.castles[previous]];
   state.captureRewards=state.captureRewards.map(id=>id===previous?home:id);
   state.home=home;if(state.cycle)state.cycle.home=home;
  }
  return save;
 };
 h.resetRates=()=>sql.exec('DELETE FROM rate_limits');
 h.originalNow=Date.now;Date.now=()=>h.now;h.close=()=>{Date.now=h.originalNow;sql.close();};
 return h;
}

// Observe the accepted departure and advance the fixture clock to its actual due time.
export async function settleFieldMarch(h,actor,departure){
 assert(departure.marching);assert.equal(departure.battle,null);
 h.now+=departure.march.remainingMs;
 const arrived=(await h.api('/marches?deviceId='+actor.deviceId,{token:actor.token})).data;
 const receipt=arrived.history.find(entry=>entry.id===departure.march.id);
 assert.equal(receipt?.status,'resolved');assert(receipt.battle);
 return receipt.battle;
}

export async function syncFieldWriter(h,actor){
 const {deviceId,token}=actor;
 const snap=(await h.api('/sync/lease',{method:'POST',token,body:{deviceId}})).data;
 const game=GameEngine.fromSave(snap.save,GAME_OFFICERS,{isAdmin:snap.user.isAdmin,isStaff:snap.user.isStaff,staffBase:snap.staffBase});
 const advanced=game.applyWorldClock(snap.clock);assert(advanced.ok&&!advanced.pending);
 return (await h.api('/sync',{method:'PUT',token,body:{deviceId,revision:snap.revision,save:JSON.parse(game.exportSave())}})).data;
}
