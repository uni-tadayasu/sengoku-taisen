// Retirement and ordination are backed by the completed imperial succession
// ledger. A name, client save or court-house label can never grant a title.
import {readShogunateIndependence} from './shogunate-independence.js';
import {readCloisteredReward,CLOISTERED_REWARD} from './cloistered-reward.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const GATE='EXISTS(SELECT 1 FROM court_ordination_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const OCCUPIED='上皇・法皇は共通で定員1名です。現在の上皇本人だけが、同じ枠のまま法皇になれます。';
const ACCESS='退位または出家の状態が変わりました。最新の状態を確認してください。';
const iso=value=>new Date(Number(value)).toISOString();
export const retiredEmperorVacancySql=(source='NULL',successor='NULL')=>`NOT EXISTS(SELECT 1 FROM court_retirement_holders retirement_seat WHERE retirement_seat.user_id<>COALESCE(${source},'') AND retirement_seat.user_id<>COALESCE(${successor},''))`;

export async function courtRetirementCapacity(db){
 const people=(await S(db,'SELECT user_id,name,kind FROM court_retirement_holders ORDER BY retired_at,user_id').all()).results||[];
 const available=people.length===0,person=row=>row?{id:row.user_id,name:row.name,kind:row.kind,title:row.kind==='cloistered-emperor'?'法皇':'上皇'}:null;
 const seat=kind=>{const holders=people.filter(row=>row.kind===kind);return{limit:1,count:holders.length,available,holder:holders[0]?{id:holders[0].user_id,name:holders[0].name}:null};};
 return{shared:{limit:1,count:people.length,available,holder:person(people[0])},retired:seat('retired-emperor'),cloistered:seat('cloistered-emperor')};
}
async function history(db,userId){
 return S(db,`SELECT s.*,r.succession_id AS current_retirement,c.ordained_at,COALESCE(c.revision,0) AS retirement_revision,
  EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.id=1 AND l.user_id=s.actor_id AND l.term_id=COALESCE(sm.term_id,'legacy:'||sm.appointed_at)) AS current_emperor
  FROM court_succession_requests s
  LEFT JOIN court_retired_emperors r ON r.user_id=s.actor_id AND r.succession_id=s.commit_token AND r.successor_id=s.target_id
  LEFT JOIN court_cloistered_emperors c ON c.user_id=r.user_id AND c.succession_id=r.succession_id
  WHERE s.actor_id=? ORDER BY s.created_at DESC,s.rowid DESC LIMIT 1`,userId).first();
}
export async function courtRetirementStatus(ctx){
 const{db,user}=ctx,row=await history(db,user.id),capacity=await courtRetirementCapacity(db),inactive=!row||!!row.current_emperor||!!user.is_admin,
  isRetiredEmperor=!inactive&&!!row.current_retirement,isCloisteredEmperor=isRetiredEmperor&&row.ordained_at!==null,
  isReturnedImperial=!inactive&&!isRetiredEmperor,kind=inactive?'none':isCloisteredEmperor?'cloistered-emperor':isRetiredEmperor?'retired-emperor':'imperial',
  canOrdain=isRetiredEmperor&&!isCloisteredEmperor&&capacity.shared.count===1&&capacity.shared.holder?.id===user.id,
  canRelocate=isReturnedImperial&&!user.is_staff&&!user.court_retained_term&&!user.is_admin&&!user.is_deputy&&!user.expulsion_pending;
 const reason=inactive?'天皇が皇位を譲った後に利用できます。':isCloisteredEmperor?'法皇として仙洞御所を本拠に、幕府の支配を受けずに活動できます。':isReturnedImperial?'皇族に戻って退位しています。一般拠点へ移転できます。':!canOrdain?OCCUPIED:'出家すると同じ共通枠のまま法皇になります。本拠は仙洞御所を継続し、資産と幕府からの独立を引き継ぎます。';
 return{kind,title:{none:null,imperial:'皇族','retired-emperor':'上皇','cloistered-emperor':'法皇'}[kind],isRetiredEmperor,isCloisteredEmperor,isReturnedImperial,
  canOrdain,canRelocate,base:isRetiredEmperor?{id:'sento_gosho',name:'仙洞御所',fixed:true}:null,shogunateIndependent:isRetiredEmperor&&await readShogunateIndependence(db,user.id),
  revision:inactive?0:Number(row.retirement_revision),successionId:inactive?null:row.commit_token,retiredAt:inactive?null:Number(row.created_at),ordainedAt:isCloisteredEmperor?Number(row.ordained_at):null,capacity,reason,reward:await readCloisteredReward(db,user.id)};
}
async function reply(ctx,receipt=null,idempotent=false){
 const current=await ctx.helpers.getUser(ctx.db,ctx.user.id);await ctx.helpers.requireAccountAccess(ctx.db,current);
 const retirement=await courtRetirementStatus({...ctx,user:current}),guard=ctx.helpers.accountCommitGuard(current);
 // Preserve the final response fence if a concurrent coronation or ordination
 // changes this identity after it was read.
 guard.sql+=` AND COALESCE((SELECT r.succession_id FROM court_retired_emperors r JOIN court_succession_requests s ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=?),'')=?
  AND COALESCE((SELECT c.ordained_at FROM court_cloistered_emperors c JOIN court_retired_emperors r ON r.user_id=c.user_id AND r.succession_id=c.succession_id WHERE c.user_id=?),-1)=?`;
 guard.args.push(current.id,retirement.isRetiredEmperor?retirement.successionId:'',current.id,retirement.ordainedAt??-1);
 // A reigning Emperor may retain an old historical row on an older version.
 // Such a row carries no retirement controls and is not used as a response fence.
 if(retirement.kind!=='none')ctx.helpers.registerResponseGuard?.({...guard,code:'COURT_RETIREMENT_CHANGED',message:ACCESS});
 return{ok:true,retirement,capacity:retirement.capacity,serverNow:iso(ctx.now),...(receipt?{receipt:JSON.parse(receipt.result_json),idempotent}:{})};
}
function input(body,h){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!['requestId','expectedRevision','successionId','confirmed'].includes(key))||body.confirmed!==true||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||typeof body.successionId!=='string'||!body.successionId||body.successionId.length>150||/[\u0000-\u001f\u007f]/u.test(body.successionId))h.fail(400,'INVALID_INPUT','出家の確認内容を更新してください。');
 return{requestId:h.idField(body.requestId,'操作番号'),expectedRevision:body.expectedRevision,successionId:body.successionId};
}
async function ordain(ctx){
 const{db,user,now,helpers:h}=ctx,body=input(await h.readBody(ctx.request),h),digest=await h.hash(JSON.stringify(['court-ordination-v1',body.successionId,body.expectedRevision,true]));
 const prior=async()=>{const record=await S(db,'SELECT * FROM court_ordination_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();if(record&&record.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の出家に使われています。');return record;};
 const previous=await prior();if(previous)return reply(ctx,previous,true);
 const conflict=async()=>{
  const current=await h.getUser(db,user.id);await h.requireAccountAccess(db,current);const state=await courtRetirementStatus({...ctx,user:current});
  if(!state.isRetiredEmperor)h.fail(403,'COURT_RETIRED_EMPEROR_REQUIRED','出家して法皇になれるのは、現在の上皇本人だけです。');
  if(state.successionId!==body.successionId||state.revision!==body.expectedRevision)h.fail(409,'COURT_RETIREMENT_CHANGED',ACCESS);
  if(state.isCloisteredEmperor)h.fail(409,'COURT_ALREADY_CLOISTERED','すでに法皇として出家しています。');
  if(!state.canOrdain)h.fail(409,'COURT_CLOISTERED_EMPEROR_OCCUPIED',OCCUPIED);
  return state;
 };
 await conflict();await h.budget(db,'court-ordination:'+user.id,12,60000,now);
 const guard=h.roleCommitGuard(user),nonce=crypto.randomUUID(),args=[user.id,body.requestId,nonce],receipt={requestId:body.requestId,action:'ordain',successionId:body.successionId,revision:1,ordainedAt:now,title:'法皇',reward:{...CLOISTERED_REWARD}};
 const result=await db.batch([
  S(db,`INSERT INTO court_ordination_requests(actor_id,request_id,succession_id,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,? WHERE ${guard.sql}
   AND EXISTS(SELECT 1 FROM court_retirement_holders h WHERE h.user_id=? AND h.succession_id=? AND h.kind='retired-emperor' AND h.retired_at<=?)
   AND NOT EXISTS(SELECT 1 FROM court_cloistered_emperors WHERE user_id=?)
   AND NOT EXISTS(SELECT 1 FROM court_retirement_holders WHERE user_id<>?)
   AND ?=0 ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING *`,user.id,body.requestId,body.successionId,digest,nonce,JSON.stringify(receipt),now,...guard.args,user.id,body.successionId,now,user.id,user.id,body.expectedRevision),
  S(db,`INSERT INTO court_cloistered_emperors(user_id,succession_id,ordained_at,revision) SELECT ?,?,?,1 WHERE ${GATE}`,user.id,body.successionId,now,...args)
 ]),accepted=result[0].results?.[0]||await prior();
 if(!accepted){await conflict();h.fail(409,'COURT_RETIREMENT_CHANGED',ACCESS);}
 return reply(ctx,accepted,!result[0].results?.length);
}
export async function handleCourtRetirement(ctx){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if([...ctx.url.searchParams].length)ctx.helpers.fail(400,'INVALID_INPUT','退位・出家のURLを確認してください。');
 if(ctx.path==='/court/retirement'&&ctx.method==='GET')return reply(ctx);
 if(ctx.path==='/court/retirement/ordain'&&ctx.method==='POST')return ordain(ctx);
 ctx.helpers.fail(404,'NOT_FOUND','この退位・出家の操作は見つかりませんでした。');
}
