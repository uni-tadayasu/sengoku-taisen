import {GameEngine,GAME_OFFICERS} from './game-runtime.js';

// Paid rights, daily limits and selections live outside importable saves.
// Every receipt and save mutation is committed in one ordered D1 transaction.
const stmt=(db,sql,...args)=>db.prepare(sql).bind(...args);
const rows=value=>value?.results||[];
const copy=value=>JSON.parse(JSON.stringify(value));
const iso=value=>new Date(value).toISOString();
const DAY=86400000,JST=9*3600000,RESET=5*3600000;
const gate='EXISTS(SELECT 1 FROM reward_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const data=()=>globalThis.SENGOKU_DATA;
export function rewardCalendar(now){
  const local=new Date(now+JST),hour=local.getUTCHours(),day=new Date(now+JST-RESET).toISOString().slice(0,10);
  const start=Date.parse(day+'T00:00:00Z')-JST+RESET;
  return {day,window:hour>=5&&hour<12?'morning':hour>=12&&hour<18?'noon':'night',nextResetAt:iso(start+DAY)};
}
export async function rerollPassSnapshot(db,userId,now){
  const calendar=rewardCalendar(now),rights=rows(await stmt(db,"SELECT source_id,starts_at,expires_at FROM premium_grants WHERE user_id=? AND product_id='reroll-pass-30d' AND expires_at>? ORDER BY starts_at,expires_at",userId,now).all());
  const daily=await stmt(db,'SELECT used FROM gacha_daily_usage WHERE user_id=? AND day=?',userId,calendar.day).first(),usedToday=Number(daily?.used||0);
  let coverage=now;for(const right of rights)if(Number(right.starts_at)<=coverage)coverage=Math.max(coverage,Number(right.expires_at));
  const active=coverage>now;return {active,expiresAt:active?iso(coverage):null,dailyLimit:3,usedToday,remainingToday:active?Math.max(0,3-usedToday):0,nextResetAt:calendar.nextResetAt};
}
async function pendingRow(db,userId){return stmt(db,"SELECT * FROM gacha_draws WHERE user_id=? AND status='pending'",userId).first();}
export async function rewardsSnapshot(db,userId,now){
  const calendar=rewardCalendar(now),[pass,pending,claimed]=await Promise.all([rerollPassSnapshot(db,userId,now),pendingRow(db,userId),stmt(db,'SELECT window,amount FROM login_bonus_claims WHERE user_id=? AND day=?',userId,calendar.day).all()]);
  const claimedRows=rows(claimed),windows=['morning','noon','night'].map(window=>({window,amount:30,claimed:claimedRows.some(row=>row.window===window),creditedAmount:Number(claimedRows.find(row=>row.window===window)?.amount||0)}));
  let rerolledAvailable=true;
  if(pending?.reroll_source_id)rerolledAvailable=!!await stmt(db,"SELECT 1 FROM premium_grants WHERE user_id=? AND product_id='reroll-pass-30d' AND source_id=?",userId,pending.reroll_source_id).first();
  return {serverNow:iso(now),rerollPass:pass,login:{...calendar,amount:30,claimed:windows.find(row=>row.window===calendar.window).claimed,windows},pending:pending?{id:pending.id,original:JSON.parse(pending.original_json),rerolled:pending.rerolled_json?JSON.parse(pending.rerolled_json):null,rerolledAvailable,canReroll:!pending.rerolled_json&&pass.active&&pass.remainingToday>0,cost:data().gacha.singleCost,createdAt:iso(Number(pending.created_at))}:null};
}
function secureInt(max){
  if(!Number.isInteger(max)||max<1||max>0x100000000)throw Error('Invalid random range');
  const limit=Math.floor(0x100000000/max)*max,bytes=new Uint32Array(1);let value;
  do{crypto.getRandomValues(bytes);value=bytes[0];}while(value>=limit);
  return value%max;
}
function candidate(game){
  const roll=secureInt(100);let total=0,rank=null;
  for(const row of data().gacha.rates){total+=row.rate;if(roll<total){rank=row.rank;break;}}
  const pool=game.gachaPool(rank);if(!pool.length)throw Error('Missing summon pool');
  return {officerId:pool[secureInt(pool.length)].id,rank};
}
function acquire(game,candidates,cost){
  const s=game.state,results=[];let refund=0,newCount=0,newOfficerCount=0,upgradedCount=0;
  for(const value of candidates){
    const granted=game._grantOfficerVariant(value.officerId,value.rank);if(!granted)throw Error('Invalid server summon');
    const duplicateRefund=granted.isNew?0:data().gacha.duplicateRefund;
    if(granted.isNew)newCount++;else{s.stats.gachaDuplicates++;refund+=duplicateRefund;}
    if(granted.isNewOfficer)newOfficerCount++;if(granted.upgraded)upgradedCount++;
    const item={...value,...granted,duplicateRefund,turn:s.turn};results.push(item);s.gachaHistory.unshift({...item});s.stats.gachaDraws++;
  }
  s.gachaHistory=s.gachaHistory.slice(0,50);const credited=game._gain({magatama:refund}).magatama;
  const message=`${results.length}枚の招集を確定しました。${newCount?`新しい絵巻${newCount}枚。`:''}${credited?`重複分の勾玉${credited}を受け取りました。`:''}`;
  game.log(message,'gacha');
  return {ok:true,message,cost,refund:credited,newCount,newOfficerCount,upgradedCount,results,balance:s.magatama};
}
function bodyFor(raw,kind,h){
  const allowed=['deviceId','expectedRevision','requestId',...(kind==='draw'?['count']:kind==='reroll'?['drawId']:kind==='choose'?['drawId','choice']:[])];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','招集・報酬の送信項目を確認してください。');
  const body={deviceId:h.idField(raw.deviceId,'端末識別子'),requestId:h.idField(raw.requestId,'操作番号'),expectedRevision:raw.expectedRevision};
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','保存の更新番号を指定してください。');
  if(kind==='draw'){if(![1,10].includes(raw.count))h.fail(400,'INVALID_INPUT','招集は1回または10回で選んでください。');body.count=raw.count;}
  if(kind==='reroll'||kind==='choose')body.drawId=h.idField(raw.drawId,'招集番号');
  if(kind==='choose'){if(!['original','rerolled'].includes(raw.choice))h.fail(400,'INVALID_INPUT','元の絵巻または引き直した絵巻を選んでください。');body.choice=raw.choice;}
  return body;
}
async function findRequest(db,userId,requestId,digest,h){
  const row=await stmt(db,'SELECT * FROM reward_requests WHERE actor_id=? AND request_id=?',userId,requestId).first();
  if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の招集・報酬に使われています。');return row;
}
async function result(ctx,record,deviceId,idempotent){
  const {db,user,helpers:h}=ctx,now=Date.now();await h.requireAccountAccess(db,user);
  const snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,now);
  return {...snapshot,rewards:await rewardsSnapshot(db,user.id,now),receipt:JSON.parse(record.result_json),idempotent};
}
async function mutate(ctx,kind){
  const {db,user,now,request,helpers:h}=ctx,body=bodyFor(await h.readBody(request),kind,h);
  // A retry is bound to the operation, not an obsolete writer revision/device.
  const digest=await h.hash(JSON.stringify([kind,body.count??null,body.drawId??null,body.choice??null]));
  const old=await findRequest(db,user.id,body.requestId,digest,h);if(old)return result(ctx,old,body.deviceId,true);
  await h.budget(db,'rewards:'+user.id,90,60000,now);
  const saved=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now),clock=await h.getWorldClock(db,now);
  const save=h.normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock}),campaignId=save.state.walking.campaignId;
  const shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,now):null;
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared});
  const s=game.state,nonce=crypto.randomUUID(),args=[user.id,body.requestId,nonce],calendar=rewardCalendar(now),pending=await pendingRow(db,user.id);
  const role=h.roleCommitGuard(user),conditions=[role.sql],conditionArgs=[...role.args],after=[];
  let receipt;
  if(kind==='draw'){
    if(pending)h.fail(409,'GACHA_PENDING','保留中の招集結果を選んでから、次の招集へ進んでください。');
    const availability=game.canDrawOfficers(body.count);if(!availability.ok)h.fail(409,'GACHA_UNAVAILABLE',availability.reason);
    const pass=await rerollPassSnapshot(db,user.id,now),hold=body.count===1&&pass.active&&pass.remainingToday>0,drawId='gd_'+crypto.randomUUID().replaceAll('-','');
    const candidates=Array.from({length:body.count},()=>candidate(game));s.magatama-=availability.cost;
    conditions.push("NOT EXISTS(SELECT 1 FROM gacha_draws WHERE user_id=? AND status='pending')");conditionArgs.push(user.id);
    if(hold){
      receipt={kind,drawId,count:1,cost:availability.cost,results:[],refund:0,balance:s.magatama,pending:true};
      after.push(stmt(db,`INSERT INTO gacha_draws(id,user_id,campaign_id,original_json,status,created_at,updated_at) SELECT ?,?,?,?,'pending',?,? WHERE ${gate}`,drawId,user.id,campaignId,JSON.stringify(candidates[0]),now,now,...args));
    }else receipt={kind,drawId,count:body.count,pending:false,...acquire(game,candidates,availability.cost)};
  }else if(kind==='reroll'){
    if(!pending||pending.id!==body.drawId||pending.campaign_id!==campaignId)h.fail(409,'GACHA_PENDING_CHANGED','最新の保留中の招集を確認してください。');
    if(pending.rerolled_json)h.fail(409,'GACHA_ALREADY_REROLLED','この招集は引き直し済みです。2枚から1枚を選んでください。');
    const right=await stmt(db,"SELECT source_id FROM premium_grants WHERE user_id=? AND product_id='reroll-pass-30d' AND starts_at<=? AND expires_at>? ORDER BY expires_at DESC LIMIT 1",user.id,now,now).first();
    if(!right)h.fail(403,'REROLL_PASS_REQUIRED','有効な30日引き直しパスが必要です。購入状況を更新してください。');
    const daily=await stmt(db,'SELECT used FROM gacha_daily_usage WHERE user_id=? AND day=?',user.id,calendar.day).first(),used=Number(daily?.used||0);
    if(used>=3)h.fail(409,'REROLL_DAILY_LIMIT','今日の引き直し3回を使い切りました。次は日本時間の朝5時から利用できます。');
    const rolled=candidate(game);
    conditions.push("EXISTS(SELECT 1 FROM gacha_draws WHERE id=? AND user_id=? AND status='pending' AND rerolled_json IS NULL)","EXISTS(SELECT 1 FROM premium_grants WHERE user_id=? AND product_id='reroll-pass-30d' AND source_id=? AND starts_at<=? AND expires_at>?)",'COALESCE((SELECT used FROM gacha_daily_usage WHERE user_id=? AND day=?),0)=?');
    conditionArgs.push(body.drawId,user.id,user.id,right.source_id,now,now,user.id,calendar.day,used);
    after.push(stmt(db,`UPDATE gacha_draws SET rerolled_json=?,reroll_source_id=?,updated_at=? WHERE id=? AND ${gate}`,JSON.stringify(rolled),right.source_id,now,body.drawId,...args));
    after.push(stmt(db,`INSERT INTO gacha_daily_usage(user_id,day,used) SELECT ?,?,1 WHERE ${gate} ON CONFLICT(user_id,day) DO UPDATE SET used=used+1`,user.id,calendar.day,...args));
    receipt={kind,drawId:body.drawId,original:JSON.parse(pending.original_json),rerolled:rolled,day:calendar.day,usedToday:used+1,remainingToday:2-used,pending:true};
  }else if(kind==='choose'){
    if(!pending||pending.id!==body.drawId||pending.campaign_id!==campaignId)h.fail(409,'GACHA_PENDING_CHANGED','この招集は確定済みか、別の物語のものです。最新の結果を確認してください。');
    if(body.choice==='rerolled'&&!pending.rerolled_json)h.fail(400,'GACHA_NOT_REROLLED','まだ引き直していません。元の絵巻を選べます。');
    if(body.choice==='rerolled'){
      if(!await stmt(db,"SELECT 1 FROM premium_grants WHERE user_id=? AND product_id='reroll-pass-30d' AND source_id=?",user.id,pending.reroll_source_id).first())h.fail(403,'REROLL_PAYMENT_REVERSED','引き直しの支払いを確認できません。元の絵巻を選ぶか、購入状況を確認してください。');
      conditions.push("EXISTS(SELECT 1 FROM premium_grants WHERE user_id=? AND product_id='reroll-pass-30d' AND source_id=?)");conditionArgs.push(user.id,pending.reroll_source_id);
    }
    conditions.push("EXISTS(SELECT 1 FROM gacha_draws WHERE id=? AND user_id=? AND status='pending' AND original_json=? AND rerolled_json IS ?)");conditionArgs.push(body.drawId,user.id,pending.original_json,pending.rerolled_json);
    receipt={kind,drawId:body.drawId,choice:body.choice,pending:false,...acquire(game,[JSON.parse(body.choice==='rerolled'?pending.rerolled_json:pending.original_json)],0)};
    after.push(stmt(db,`UPDATE gacha_draws SET status='chosen',selected=?,updated_at=? WHERE id=? AND ${gate}`,body.choice,now,body.drawId,...args));
  }else{
    const existing=await stmt(db,'SELECT amount FROM login_bonus_claims WHERE user_id=? AND day=? AND window=?',user.id,calendar.day,calendar.window).first();
    if(existing)h.fail(409,'LOGIN_BONUS_CLAIMED','この時間帯のログイン報酬は受け取り済みです。次の時間帯にまたお越しください。');
    const amount=Math.min(30,data().assetCap-s.magatama);
    if(amount<=0)h.fail(409,'MAGATAMA_CAP','勾玉が所持上限です。受取枠は消費していません。');
    s.magatama+=amount;game.log(`${calendar.window==='morning'?'朝':calendar.window==='noon'?'昼':'夜'}のログイン報酬として勾玉${amount}を受け取りました。`,'reward');
    conditions.push('NOT EXISTS(SELECT 1 FROM login_bonus_claims WHERE user_id=? AND day=? AND window=?)');conditionArgs.push(user.id,calendar.day,calendar.window);
    after.push(stmt(db,`INSERT INTO login_bonus_claims(user_id,day,window,amount,created_at) SELECT ?,?,?,?,? WHERE ${gate}`,user.id,calendar.day,calendar.window,amount,now,...args));
    receipt={kind:'login',day:calendar.day,window:calendar.window,amount,balance:s.magatama};
  }
  const next=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock});
  const statements=[stmt(db,`INSERT INTO reward_requests(actor_id,request_id,request_hash,kind,campaign_id,result_json,commit_token,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?) AND ${conditions.join(' AND ')} ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,kind,campaignId,JSON.stringify(receipt),nonce,now,user.id,body.expectedRevision,body.deviceId,now,...conditionArgs),
    stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+h.syncLease,user.id,...args),
    stmt(db,`INSERT INTO reward_accounts(user_id,started_at) SELECT ?,? WHERE ${gate} ON CONFLICT(user_id) DO NOTHING`,user.id,now,...args),...after];
  const committed=await db.batch(statements),record=await findRequest(db,user.id,body.requestId,digest,h);
  if(!record){await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);h.fail(409,'REWARDS_STATE_CHANGED','招集・購入権・受取状況が更新されました。最新の状態に同期してからお試しください。');}
  return result(ctx,record,body.deviceId,!rows(committed[0]).length);
}

// Once online rewards are used, uploaded saves cannot undo a paid selection,
// manufacture a duplicate refund, or perform additional client-side summons.
// Existing CPU/quest/mail earnings remain allowed; server-side rewards are
// already present in the revision-checked previous save and are never replayed.
export async function protectRewardSync(db,user,save,before,h){
  if(!before||!await stmt(db,'SELECT 1 FROM reward_accounts WHERE user_id=?',user.id).first())return;
  const current=save.state,pending=await pendingRow(db,user.id);let prior=before.state,archive=null;
  const same=current.walking.campaignId===prior.walking.campaignId;
  const changed=()=>h.fail(409,'SERVER_REWARDS_REQUIRED','招集・報酬はサーバーで確定します。最新版へ更新し、最新のクラウド保存を読み込んでください。');
  const exchanged=rows(await stmt(db,"SELECT result_json FROM progress_receipts WHERE actor_id=? AND kind='exchange'",user.id).all()).map(row=>JSON.parse(row.result_json)),exchangeVariants=new Set(exchanged.map(row=>row.officerId+':'+row.rank));
  if(!same){
    if(pending)h.fail(409,'GACHA_PENDING','物語を切り替える前に、保留中の招集結果を選んでください。');
    archive={campaignId:prior.walking.campaignId,save:copy(before)};
    const known=await stmt(db,'SELECT save_json FROM reward_campaigns WHERE user_id=? AND campaign_id=?',user.id,current.walking.campaignId).first();
    if(known){const previous=JSON.parse(known.save_json);prior=(h.normalize?h.normalize(previous):previous).state;}
    else{
    // A renamed imported campaign is not a reset. Only a genuine initial
    // campaign may replace a managed save; progressed imports cannot bypass
    // the server-owned collection and currency by inventing a campaign ID.
    const fresh=new GameEngine({officers:GAME_OFFICERS,clan:current.clan,startCastle:current.home,difficulty:current.difficulty,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,seed:1}).state;
    for(const reward of exchanged){if(!fresh.officers.includes(reward.officerId))fresh.officers.push(reward.officerId);const variant=reward.officerId+':'+reward.rank;if(!fresh.officerVariants.includes(variant))fresh.officerVariants.push(variant);}
    const sameSet=(a,b)=>a.length===b.length&&a.every(value=>b.includes(value));
    if(current.magatama>fresh.magatama||current.troops>fresh.troops||current.prestige>fresh.prestige||Object.keys(fresh.stats).some(key=>current.stats[key]!==fresh.stats[key])||current.gachaHistory.length||current.claimedQuests.length||current.giftReceipts.length||!sameSet(current.officers,fresh.officers)||!sameSet(current.officerVariants,fresh.officerVariants)||!sameSet(current.captureRewards,fresh.captureRewards)||Object.keys(fresh.resources).some(key=>current.resources[key]>fresh.resources[key])||Object.keys(fresh.buildings).some(key=>current.buildings[key]>fresh.buildings[key])||Object.keys(fresh.tech).some(key=>current.tech[key]>fresh.tech[key])||current.jobs.length||current.branches.length||current.castles[current.home]?.owner!==current.clan||Object.entries(current.castles).some(([id,row])=>row.owner===current.clan&&id!==current.home))changed();
      return archive;
    }
  }
  if(current.stats.gachaDraws!==prior.stats.gachaDraws||current.stats.gachaDuplicates!==prior.stats.gachaDuplicates||JSON.stringify(current.gachaHistory)!==JSON.stringify(prior.gachaHistory))changed();
  const variants=new Set(current.officerVariants);
  if(prior.officerVariants.some(value=>!variants.has(value)))changed();
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected});
  for(const value of current.officerVariants)if(!prior.officerVariants.includes(value)){const [id,rank]=value.split(':');if(rank!==game._baseGrantRank(id)&&!exchangeVariants.has(value))changed();}
  for(const key of ['claimedQuests','captureRewards','giftReceipts'])if(prior[key].some(value=>!current[key].includes(value)))changed();
  let earned=Math.max(0,current.turn-prior.turn)*data().gacha.monthlyReward;
  earned+=data().quests.filter(quest=>current.claimedQuests.includes(quest.id)&&!prior.claimedQuests.includes(quest.id)).reduce((sum,quest)=>sum+(quest.reward.magatama||0),0);
  earned+=current.captureRewards.filter(id=>!prior.captureRewards.includes(id)).length*data().gacha.firstCaptureReward;
  const newGifts=current.giftReceipts.filter(id=>!prior.giftReceipts.includes(id));
  if(newGifts.length){
    const gifts=rows(await stmt(db,'SELECT receipt_id,gift_json FROM mail_receipts WHERE user_id=?',user.id).all()),byId=new Map(gifts.map(row=>[row.receipt_id,JSON.parse(row.gift_json)]));
    for(const id of newGifts){if(!byId.has(id))changed();earned+=byId.get(id).magatama||0;}
  }
  if(current.magatama>Math.min(data().assetCap,prior.magatama+earned))changed();
  return archive;
}
export function rewardArchiveStatements(db,userId,archive,now,commitGate,commitArgs){
  return archive?[stmt(db,`INSERT INTO reward_campaigns(user_id,campaign_id,save_json,revision,updated_at) SELECT ?,?,?,1,? WHERE ${commitGate}
    ON CONFLICT(user_id,campaign_id) DO UPDATE SET save_json=excluded.save_json,revision=reward_campaigns.revision+1,updated_at=excluded.updated_at`,userId,archive.campaignId,JSON.stringify(archive.save),now,...commitArgs)]:[];
}
export async function handleRewards(ctx){
  if(ctx.path==='/rewards'&&ctx.method==='GET')return {ok:true,...await rewardsSnapshot(ctx.db,ctx.user.id,ctx.now)};
  const kind={'/gacha/draw':'draw','/gacha/reroll':'reroll','/gacha/choose':'choose','/rewards/login':'login'}[ctx.path];
  if(kind&&ctx.method==='POST')return mutate(ctx,kind);
  ctx.helpers.fail(404,'NOT_FOUND','その招集・報酬機能は見つかりませんでした。');
}
