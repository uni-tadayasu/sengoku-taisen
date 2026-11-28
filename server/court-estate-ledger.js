// Ordinary court holders receive the normal extra-castle economy only during
// verified appointment intervals. The ledger is outside uploaded game saves.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=result=>result?.results||[];
const copy=value=>JSON.parse(JSON.stringify(value));
const REFRESH='京都御所の領地効果が更新されました。最新の領主データを読み直してから再開してください。';
const enhancementSql=userId=>`(EXISTS(SELECT 1 FROM court_estate_current ie_current WHERE ie_current.user_id=${userId}) AND EXISTS(SELECT 1 FROM court_retirement_holders ie_retired WHERE ie_retired.user_id=${userId}))`;
let sharedInitial;
function initialSharedState(){if(!sharedInitial){const buildings=new GameEngine({officers:GAME_OFFICERS,isStaff:true,seed:1}).state.buildings;sharedInitial=JSON.stringify({initial:{castleLevel:1,buildings},castleLevel:1,buildings,jobs:[],history:[],createdElapsedMs:0,updatedElapsedMs:0});}return sharedInitial;}

// Append after every source mutation, in its original receipt-gated batch.
// Reconcile all affected holders: an Emperor/merit transition can also end an
// external appointment through the existing canonical court triggers.
export function courtEstateSnapshotStatements(db,clock,gate='1=1',args=[]){
 const elapsed=Math.max(0,Math.floor(Number(clock.elapsedMs)||0));
 const real=Date.parse(clock.serverTime||''),at=Number.isSafeInteger(real)?"COALESCE((SELECT base_elapsed_ms+CASE WHEN running=1 THEN MAX(0,?-anchor_real_ms)*speed ELSE 0 END FROM world_clock WHERE id='world-v1'),?)":'?',atArgs=Number.isSafeInteger(real)?[real,elapsed]:[elapsed];
 return[
  S(db,`INSERT INTO court_estate_policy(id,activated_elapsed_ms) SELECT 1,${at} WHERE ${gate} ON CONFLICT(id) DO NOTHING`,...atArgs,...args),
  S(db,`INSERT INTO staff_base(id,state_json,updated_at)
   SELECT 'kyoto_gosho',json_set(?,'$.createdElapsedMs',${at},'$.updatedElapsedMs',${at}),?
   WHERE ${gate} AND EXISTS(SELECT 1 FROM court_estate_current) ON CONFLICT(id) DO NOTHING`,initialSharedState(),...atArgs,...atArgs,Number.isSafeInteger(real)?real:0,...args),
  S(db,`INSERT INTO court_estate_accounts(user_id,active,authority_key,activated_elapsed_ms,last_effective_elapsed_ms,sealed_elapsed_ms,revision,imperial_enhancements)
   SELECT user_id,1,authority_key,${at},${at},${at},1,${enhancementSql('court_estate_current.user_id')} FROM court_estate_current WHERE ${gate}
   ON CONFLICT(user_id) DO NOTHING`,...atArgs,...atArgs,...atArgs,...args),
  S(db,`UPDATE court_estate_accounts AS a SET
   active=EXISTS(SELECT 1 FROM court_estate_current c WHERE c.user_id=a.user_id),
   authority_key=COALESCE((SELECT authority_key FROM court_estate_current c WHERE c.user_id=a.user_id),''),
   imperial_enhancements=${enhancementSql('a.user_id')},
   revision=revision+1,last_effective_elapsed_ms=MAX(last_effective_elapsed_ms,sealed_elapsed_ms,${at}),sealed_elapsed_ms=MAX(last_effective_elapsed_ms,sealed_elapsed_ms,${at})
   WHERE ${gate} AND (a.active<>EXISTS(SELECT 1 FROM court_estate_current c WHERE c.user_id=a.user_id)
    OR a.authority_key<>COALESCE((SELECT authority_key FROM court_estate_current c WHERE c.user_id=a.user_id),'')
    OR a.imperial_enhancements<>${enhancementSql('a.user_id')})`,...atArgs,...atArgs,...args),
  S(db,`INSERT INTO court_estate_snapshots(user_id,revision,effective_elapsed_ms,active,imperial_enhancements)
   SELECT a.user_id,a.revision,a.last_effective_elapsed_ms,a.active,a.imperial_enhancements FROM court_estate_accounts a
   WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM court_estate_snapshots s WHERE s.user_id=a.user_id AND s.revision=a.revision)
   ON CONFLICT(user_id,revision) DO NOTHING`,...args)
 ];
}

export function courtEstateRevisionGuard(userId,account,baseRevision){
 if(!account)return{sql:'NOT EXISTS(SELECT 1 FROM court_estate_accounts WHERE user_id=?) AND NOT EXISTS(SELECT 1 FROM court_estate_current WHERE user_id=?)',args:[userId,userId],code:'COURT_ESTATE_REFRESH_REQUIRED',message:REFRESH};
 return{sql:`EXISTS(SELECT 1 FROM court_estate_accounts WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?) AND COALESCE((SELECT authority_key FROM court_estate_current WHERE user_id=?),'')=? AND ${enhancementSql('?')}=?`,args:[userId,Number(account.revision),Number(baseRevision),userId,account.authority_key,userId,userId,Number(account.imperial_enhancements||0)],code:'COURT_ESTATE_REFRESH_REQUIRED',message:REFRESH};
}

export async function readCourtEstateContext(db,user,save,clock,now,h){
 let account=await S(db,`SELECT a.*,(SELECT authority_key FROM court_estate_current c WHERE c.user_id=q.requested_user_id) AS current_key,${enhancementSql('q.requested_user_id')} AS current_enhancements
  FROM (SELECT ? AS requested_user_id) q LEFT JOIN court_estate_accounts a ON a.user_id=q.requested_user_id`,user.id).first();
 // Most players have never held a qualifying appointment. Their reads do not
 // create ledger rows or initialize/advance the shared palace.
 if(!account?.user_id&&!account?.current_key)return{projection:null,guard:courtEstateRevisionGuard(user.id,null)};
 // The shared base settles due completions before reading appointment history:
 // a new Kyoto rank may retire a conflicting external office in that batch.
 const base=await h.staffBaseDto(db,user,clock,now);
 const elapsed=Math.max(0,Math.floor(Number(clock.elapsedMs)||0)),anchor=Math.max(0,Math.floor(Number(save?.state?.worldClock?.elapsedMs)||0));
 const snapshots=!account?.user_id||account.authority_key!==(account.current_key||'')||account.imperial_enhancements!==account.current_enhancements?courtEstateSnapshotStatements(db,clock):[],results=await db.batch([
  ...snapshots,
  S(db,'UPDATE court_estate_accounts SET sealed_elapsed_ms=MAX(sealed_elapsed_ms,?) WHERE user_id=?',elapsed,user.id),
  S(db,'SELECT * FROM court_estate_accounts WHERE user_id=?',user.id),
  S(db,`SELECT * FROM court_estate_snapshots WHERE user_id=?
   AND revision IN (SELECT MAX(revision) FROM court_estate_snapshots WHERE user_id=? GROUP BY effective_elapsed_ms)
   AND (effective_elapsed_ms>? OR effective_elapsed_ms=COALESCE((SELECT MAX(effective_elapsed_ms) FROM court_estate_snapshots WHERE user_id=? AND effective_elapsed_ms<=?),(SELECT MIN(effective_elapsed_ms) FROM court_estate_snapshots WHERE user_id=?)))
   ORDER BY effective_elapsed_ms,revision LIMIT 10002`,user.id,user.id,anchor,user.id,anchor,user.id)
 ]);
 account=rows(results[snapshots.length+1])[0];
 if(!account)return{projection:null,guard:courtEstateRevisionGuard(user.id,null)};
 if(!save?.state?.walking?.campaignId)return{projection:null,guard:courtEstateRevisionGuard(user.id,account,base.revision)};
 const points=rows(results[snapshots.length+2]),truncated=points.length>10001;if(truncated)points.length=10001;
 const asOfElapsedMs=truncated?Number(points.at(-1).effective_elapsed_ms):Number(account.sealed_elapsed_ms);
 const windowsFor=eligible=>{const windows=[];let open=null;for(const point of points){const at=Number(point.effective_elapsed_ms);if(eligible(point)){if(open===null)open=at;}else if(open!==null){if(at>open)windows.push({fromElapsedMs:open,toElapsedMs:at});open=null;}}if(open!==null)windows.push({fromElapsedMs:open,toElapsedMs:null});return windows;};
 const accessWindows=windowsFor(point=>point.active),enhancementWindows=windowsFor(point=>point.active&&point.imperial_enhancements),enhanced=enhancementWindows.length>0;
 const campaignId=String(save?.state?.walking?.campaignId||''),proof=await h.hash(JSON.stringify(['court-estate-economy-v2',user.id,campaignId,Number(account.revision),Number(base.revision)]));
 const projection={version:1,campaignId,revision:Number(account.revision),proof,asOfElapsedMs,accessWindows,...(enhanced?{enhancementWindows}:{}),
  base:{id:'kyoto_gosho',revision:Number(base.revision),createdElapsedMs:Number(base.createdElapsedMs),initial:{castleLevel:base.initial.castleLevel,...(enhanced?{buildings:copy(base.initial.buildings)}:{})},
   history:base.history.filter(event=>event.kind==='castle'||enhanced&&event.kind==='building').map(event=>({kind:event.kind,id:event.id,level:event.level,effectiveElapsedMs:event.effectiveElapsedMs})),
   jobs:base.jobs.filter(job=>job.kind==='castle'||enhanced&&job.kind==='building').map(job=>({kind:job.kind,id:job.id,targetLevel:job.targetLevel,completesElapsedMs:job.completesElapsedMs}))},...(truncated?{hasMore:true}:{})};
 return{projection:copy(projection),guard:courtEstateRevisionGuard(user.id,account,base.revision)};
}

export const COURT_ESTATE_REFRESH_MESSAGE=REFRESH;
