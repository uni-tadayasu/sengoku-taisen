// External troops remain the owner's upkeep responsibility while they are in
// a depot, a trade escrow/delivery, or an alliance unit. Only SQL source rows
// supply these counts; save imports and browser metadata never write them.
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),R=value=>value?.results||[];
const IDS='user_id IN (SELECT value FROM json_each(?))';
const event=row=>({elapsedMs:Number(row.effective_elapsed_ms),vacant:Number(row.vacant_troops),trade:Number(row.trade_troops),alliance:Number(row.alliance_troops)});

// Append after ALL source mutations in the original receipt-gated transaction.
// Recomputing the final aggregate avoids lost updates when another owner accepts
// a trade or resolves casualties. Unchanged aggregates do not create revisions.
export function externalTroopSnapshotStatements(db,ownerIds,clock,gate='1=1',args=[]){
 const owners=[...new Set(ownerIds.filter(Boolean))];if(!owners.length)return[];
 const ids=JSON.stringify(owners),elapsed=Math.max(0,Math.floor(Number(clock.elapsedMs)||0));
 return [
  S(db,`INSERT INTO external_troop_accounts(user_id,activated_elapsed_ms,sealed_elapsed_ms,last_effective_elapsed_ms,revision,campaign_id,vacant_troops,trade_troops,alliance_troops)
    SELECT user_id,?,?,?,1,campaign_id,vacant_troops,trade_troops,alliance_troops FROM external_troop_current_counts WHERE ${IDS} AND ${gate}
    ON CONFLICT(user_id) DO NOTHING`,elapsed,elapsed,elapsed,ids,...args),
  S(db,`UPDATE external_troop_accounts AS a SET
    (campaign_id,vacant_troops,trade_troops,alliance_troops)=(SELECT campaign_id,vacant_troops,trade_troops,alliance_troops FROM external_troop_current_counts c WHERE c.user_id=a.user_id),
    revision=revision+1,last_effective_elapsed_ms=MAX(last_effective_elapsed_ms,sealed_elapsed_ms,?),sealed_elapsed_ms=MAX(last_effective_elapsed_ms,sealed_elapsed_ms,?)
    WHERE ${IDS} AND ${gate} AND EXISTS(SELECT 1 FROM external_troop_current_counts c WHERE c.user_id=a.user_id AND (a.campaign_id<>c.campaign_id OR a.vacant_troops<>c.vacant_troops OR a.trade_troops<>c.trade_troops OR a.alliance_troops<>c.alliance_troops))`,elapsed,elapsed,ids,...args),
  S(db,`INSERT INTO external_troop_snapshots(user_id,revision,effective_elapsed_ms,campaign_id,vacant_troops,trade_troops,alliance_troops)
    SELECT user_id,revision,last_effective_elapsed_ms,campaign_id,vacant_troops,trade_troops,alliance_troops FROM external_troop_accounts WHERE ${IDS} AND ${gate}
    ON CONFLICT(user_id,revision) DO NOTHING`,ids,...args)
 ];
}

export function maintenanceRevisionGuard(userId,authority,sealedElapsedMs=authority.asOfElapsedMs){
 return{sql:'EXISTS(SELECT 1 FROM external_troop_accounts WHERE user_id=? AND revision=? AND sealed_elapsed_ms=?)',args:[userId,authority.revision,sealedElapsedMs]};
}

export function protectMaintenance(target,context){
 target.guard={sql:'('+target.guard.sql+') AND '+context.guard.sql,args:[...target.guard.args,...context.guard.args]};
 return context.authority;
}

// Issuing an authority seals its time horizon. Future changes take effect no
// earlier than that horizon, so a client can safely advance to asOfElapsedMs.
// History is retained; the DTO includes only the anchor baseline and later
// changes, with the last revision winning when several changes share a time.
export async function maintenanceContext(db,userId,save,clock){
 const elapsed=Math.max(0,Math.floor(Number(clock.elapsedMs)||0)),anchor=Math.max(0,Math.floor(Number(save?.state?.worldClock?.elapsedMs)||0));
 const results=await db.batch([
  ...externalTroopSnapshotStatements(db,[userId],clock),
  S(db,'UPDATE external_troop_accounts SET sealed_elapsed_ms=MAX(sealed_elapsed_ms,?) WHERE user_id=?',elapsed,userId),
  S(db,'SELECT * FROM external_troop_accounts WHERE user_id=?',userId),
  S(db,`SELECT * FROM external_troop_snapshots WHERE user_id=? AND revision IN (SELECT MAX(revision) FROM external_troop_snapshots WHERE user_id=? GROUP BY effective_elapsed_ms) AND (effective_elapsed_ms>? OR effective_elapsed_ms=COALESCE((SELECT MAX(effective_elapsed_ms) FROM external_troop_snapshots WHERE user_id=? AND effective_elapsed_ms<=?),(SELECT MIN(effective_elapsed_ms) FROM external_troop_snapshots WHERE user_id=?))) ORDER BY effective_elapsed_ms LIMIT 10002`,userId,userId,anchor,userId,anchor,userId)
 ]);
 const account=R(results[4])[0];if(!account)throw new Error('Missing external troop account');
 const points=[];for(const row of R(results[5])){const next=event(row);if(points.at(-1)?.elapsedMs===next.elapsedMs)points[points.length-1]=next;else points.push(next);}
 const truncated=points.length>10001;if(truncated)points.length=10001;
 const authority={version:1,campaignId:String(save?.state?.walking?.campaignId||account.campaign_id||''),activatedElapsedMs:Number(account.activated_elapsed_ms),revision:Number(account.revision),asOfElapsedMs:truncated?points.at(-1).elapsedMs:Number(account.sealed_elapsed_ms),baseline:points[0]||{elapsedMs:Number(account.activated_elapsed_ms),vacant:0,trade:0,alliance:0},changes:points.slice(1),...(truncated?{hasMore:true}:{})};
 return{authority,guard:maintenanceRevisionGuard(userId,authority,Number(account.sealed_elapsed_ms))};
}

export const MAINTENANCE_REFRESH_MESSAGE='維持費の計算方式または預けた兵数が更新されました。画面を再読み込みし、最新の保存へ同期してから再開してください。';
