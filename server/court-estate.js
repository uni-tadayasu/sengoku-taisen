// Kyoto is a single shared holding. Court appointments grant development
// access without changing the participant's personal home, clan or economy.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
import {COURT_OFFICES} from './court-offices.js';

const S=(db,sql,...args)=>db.prepare(sql).bind(...args);
const RESOURCES=['gold','rice','wood','stone'];
const copy=value=>JSON.parse(JSON.stringify(value));
const ACCESS_MESSAGE='京都御所の共同領有資格が変わりました。最新の役職を確認してください。';
const RETIRED=`SELECT r.succession_id FROM court_retired_emperors r JOIN court_succession_requests s
 ON s.commit_token=r.succession_id AND s.actor_id=r.user_id AND s.target_id=r.successor_id WHERE r.user_id=?`;

export async function courtEstateAuthority(db,user,h){
 await h.requireAccountAccess(db,user);
 const guard=h.roleCommitGuard(user),found=await S(db,`SELECT
  (SELECT updated_at FROM settings WHERE key='adminUserId' AND value=?) AS admin_since,
  (SELECT g.appointment_token FROM court_regent g WHERE g.id=1 AND g.user_id=?) AS regent_token,
  (SELECT a.office_id FROM court_external_offices a WHERE a.user_id=?) AS office_id,
  (SELECT a.appointment_token FROM court_external_offices a WHERE a.user_id=?) AS office_token,
  (${RETIRED}) AS retired_token`,user.id,user.id,user.id,user.id,user.id).first();
 let role=null,proof='';
 if(user.is_admin){role={id:'chancellor',title:'太政大臣'};proof=String(found.admin_since??'');guard.sql+=' AND EXISTS(SELECT 1 FROM settings WHERE key=\'adminUserId\' AND value=? AND updated_at=?)';guard.args.push(user.id,found.admin_since??-1);}
 else if(user.is_staff){role={id:'kyoto',title:'京都御所所属'};proof=user.staff_term||'';}
 else if(found.regent_token){role={id:'regent',title:'摂政'};proof=found.regent_token;guard.sql+=' AND EXISTS(SELECT 1 FROM court_regent WHERE id=1 AND user_id=? AND appointment_token=?)';guard.args.push(user.id,proof);}
 else if(found.office_token&&COURT_OFFICES.some(office=>office.id===found.office_id)){role={id:found.office_id,title:COURT_OFFICES.find(office=>office.id===found.office_id).title,jurisdiction:'external'};proof=found.office_token;guard.sql+=' AND EXISTS(SELECT 1 FROM court_external_offices WHERE user_id=? AND office_id=? AND appointment_token=?)';guard.args.push(user.id,role.id,proof);}
 else if(found.retired_token){role={id:'retired-emperor',title:'上皇'};proof=found.retired_token;guard.sql+=` AND (${RETIRED})=?`;guard.args.push(user.id,proof);}
 guard.sql+=' AND NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=? AND pending=1)';guard.args.push(user.id);
 const eligible=!!role&&!user.expulsion_pending,accessStamp=await h.hash(JSON.stringify(['court-estate-v1',user.id,role?.id||'',proof,user.staff_term||'',user.deputy_term||'',Number(user.moderation_epoch||0),Number(user.expulsion_epoch||0)]));
 return{eligible,canDevelop:eligible,role,accessStamp,guard:{...guard,code:'COURT_ESTATE_ACCESS_CHANGED',message:ACCESS_MESSAGE}};
}

export async function assertCourtEstateAccess(db,user,access,h){
 await h.requireAccountAccess(db,user);
 if(!access?.eligible)h.fail(403,'COURT_ESTATE_REQUIRED','京都御所の共同領地は、摂政・任命太政官・上皇・京都御所所属者・太政大臣が利用できます。');
 if(!await S(db,'SELECT 1 AS allowed WHERE '+access.guard.sql,...access.guard.args).first())h.fail(409,'COURT_ESTATE_ACCESS_CHANGED',ACCESS_MESSAGE);
}

// This instance exists only to quote the shared facilities. It is never
// exported as the payer's save, so personal buildings and holdings stay intact.
export function courtEstatePricingGame(save,user,base,clock,courtEstateProjection=null){
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection,isAdmin:!!user.is_admin,isStaff:!!user.is_staff,isDeputy:!!user.is_deputy,isCourtProtected:!!user.is_court_protected,staffBase:user.is_staff&&!user.is_admin?base:null});
 if(game.isStaff)game._projectStaffAt(clock.elapsedMs);
 // Quotes concern the present holding count, even if a viewer's private save
 // is still waiting to catch up. No resources are accrued in this instance.
 game.state.worldClock={id:clock.id,elapsedMs:clock.elapsedMs};game.state.turn=Math.floor(clock.elapsedMs/60000);game.state.realtime.elapsed=clock.elapsedMs%60000/1000;
 game.state.buildings=copy(base.buildings);
 game.state.castles.kyoto_gosho.level=base.castleLevel;
 return game;
}

export function courtEstateAction(pricing,payer,state,clock,kind,id){
 const definition=kind==='castle'?{id:'kyoto_gosho',name:'京都御所の城郭',category:'castle'}:globalThis.SENGOKU_DATA.buildings.find(b=>b.id===id);
 const chain=state.jobs.filter(job=>job.kind===kind&&job.id===id).sort((a,b)=>a.targetLevel-b.targetLevel),tail=chain.at(-1);
 const level=kind==='castle'?state.castleLevel:state.buildings[id],reservedLevel=tail?.targetLevel??level,maxLevel=kind==='castle'?128:32;
 const atMax=reservedLevel>=maxLevel,cost=atMax?null:kind==='castle'?pricing.castleUpgradeCost(id):pricing.costs(id,reservedLevel);
 const used=new Set(state.jobs.map(job=>job.kind+':'+job.id)).size,maxSlots=2+Math.floor(state.buildings.keep/8),unlock=kind==='building'?pricing.buildingUnlock(id):{ok:true};
 let code=null,reason='共同普請できます。';
 if(atMax){code='BUILDING_MAX';reason='最高レベルまで建設・予約されています。';}
 else if(kind==='castle'&&chain.length){code='STAFF_BUILDING_BUSY';reason='京都御所の城郭を強化中です。';}
 else if(!chain.length&&used>=maxSlots){code='STAFF_BUILDING_SLOTS';reason='共同普請の枠が埋まっています。';}
 else if(!unlock.ok){code='BUILDING_LOCKED';reason=unlock.reason;}
 else if(!clock.running){code='WORLD_PAUSED';reason='共通時間を再開してから普請してください。';}
 else if(payer.state.command<1){code='COMMAND_REQUIRED';reason='指示の回復をお待ちください。';}
 else if(RESOURCES.some(key=>payer.state.resources[key]<(cost[key]||0))){code='INSUFFICIENT_ASSETS';reason='共同普請に必要な個人資源が足りません。';}
 return{kind,id,name:definition.name,category:definition.category||'other',level,reservedLevel,maxLevel,targetLevel:atMax?null:reservedLevel+1,cost:cost?Object.fromEntries(RESOURCES.map(key=>[key,cost[key]||0])):null,seconds:cost?.seconds||0,queued:!!tail,enabled:!code,reason,code};
}

export async function courtEstateSnapshot(ctx,access,snapshot=null){
 const {db,user,now,helpers:h}=ctx;
 await assertCourtEstateAccess(db,user,access,h);
 snapshot=snapshot||await h.syncSnapshot(db,await h.getSyncRow(db,user.id),user,null,now);
 if(!snapshot.save)h.fail(409,'SAVE_REQUIRED','本拠を確定してから京都御所の共同領地を開いてください。');
 const clock=snapshot.clock,base=await h.staffBaseDto(db,user,clock,now),state=base;
 const payer=GameEngine.fromSave(snapshot.save,GAME_OFFICERS,{courtEstateProjection:snapshot.courtEstateProjection||null,isAdmin:!!user.is_admin,isStaff:!!user.is_staff,isDeputy:!!user.is_deputy,isCourtProtected:!!user.is_court_protected,staffBase:user.is_staff&&!user.is_admin?base:null});
 if(payer.isStaff)payer._projectStaffAt(clock.elapsedMs);
 const pricing=courtEstatePricingGame(snapshot.save,user,base,clock,snapshot.courtEstateProjection||null),definitions=[{kind:'castle',id:'kyoto_gosho'},...globalThis.SENGOKU_DATA.buildings.map(b=>({kind:'building',id:b.id}))];
 const homeId=snapshot.save.state.home,homeName=globalThis.SENGOKU_DATA.castles.find(c=>c.id===homeId)?.name||homeId;
 const jobs=state.jobs.map(job=>({jobId:job.jobId,kind:job.kind,id:job.id,targetLevel:job.targetLevel,totalSeconds:job.totalSeconds,startedElapsedMs:job.startedElapsedMs,completesElapsedMs:job.completesElapsedMs,startedBy:{id:job.startedBy.id,name:job.startedBy.name}}));
 await assertCourtEstateAccess(db,user,access,h);h.registerResponseGuard?.(access.guard);
 return{courtEstate:{version:1,eligible:true,canDevelop:true,accessStamp:access.accessStamp,role:access.role,holding:{id:'kyoto_gosho',name:'京都御所',shared:true,ownership:'shared',homePreserved:true},home:{id:homeId,name:homeName},effects:pricing.courtEstateEffects(),base:{revision:base.revision,castleLevel:base.castleLevel,maxCastleLevel:128,buildings:copy(base.buildings),jobs,updatedElapsedMs:base.updatedElapsedMs},resources:copy(payer.state.resources),command:payer.state.command,slots:{used:new Set(state.jobs.map(job=>job.kind+':'+job.id)).size,max:2+Math.floor(base.buildings.keep/8)},actions:definitions.map(def=>courtEstateAction(pricing,payer,state,clock,def.kind,def.id)),serverNow:new Date(now).toISOString()},courtEstateProjection:snapshot.courtEstateProjection||null,clock};
}

export async function handleCourtEstate(ctx){
 const {db,user,helpers:h}=ctx,access=await courtEstateAuthority(db,user,h);
 await assertCourtEstateAccess(db,user,access,h);
 if(ctx.path==='/court/estate'&&ctx.method==='GET')return{ok:true,...await courtEstateSnapshot(ctx,access)};
 if(ctx.path==='/court/estate/upgrade'&&ctx.method==='POST'){
  const body=await h.readBody(ctx.request);
  if(!body||typeof body!=='object'||Array.isArray(body))h.fail(400,'INVALID_INPUT','共同普請の指定が正しくありません。');
  if(typeof body.accessStamp!=='string'||body.accessStamp!==access.accessStamp)h.fail(409,'COURT_ESTATE_ACCESS_CHANGED',ACCESS_MESSAGE);
  const snapshot=await h.staffBaseUpgrade(db,user,body,ctx.now,access);
  return{...snapshot,...await courtEstateSnapshot(ctx,access,snapshot)};
 }
 h.fail(405,'METHOD_NOT_ALLOWED','この共同領地の操作には対応していません。');
}
