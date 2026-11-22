// Real-calendar goals and guaranteed collection progress. Claims and exchanges
// are independent server receipts; importing a save cannot unclaim a reward.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const stmt=(db,sql,...a)=>db.prepare(sql).bind(...a),rows=v=>v?.results||[],copy=v=>JSON.parse(JSON.stringify(v));
const DAY=86400000,OFFSET=9*3600000,MAX=1000000000,ASSET_CAP=GameEngine.ASSET_CAP;
const keys=['battles','wins','roaming','upgrades','researches','recruited','draws','duplicates','recruits','training'];
const n=v=>Number.isSafeInteger(v)&&v>=0?Math.min(MAX,v):0;
export function calendarKeys(now){const day=Math.floor((now+OFFSET)/DAY),week=Math.floor((day+3)/7);return{day,week,date:new Date(day*DAY).toISOString().slice(0,10),nextDay:(day+1)*DAY-OFFSET,nextWeek:(week+1)*7*DAY-3*DAY-OFFSET};}
const goal=(id,name,metric,target,reward)=>({id,name,metric,target,reward});
export const PROGRESS_GOALS={
 daily:[goal('build','城下を一歩育てる','upgrades',1,{gold:300,wood:150}),goal('roaming','街道の安全を守る','roaming',2,{rice:400,magatama:30}),goal('research','知恵を磨く','researches',1,{gold:250,stone:150}),goal('battle','一度の出陣','battles',1,{rice:300,magatama:30}),goal('recruit','家臣を迎える','recruited',1,{gold:200,magatama:20}),goal('train','軍の備えを整える','training',1,{rice:200,wood:100})],
 weekly:[goal('build','城下町の発展週間','upgrades',5,{gold:1000,wood:600,magatama:80}),goal('roaming','街道の守護者','roaming',10,{rice:1500,magatama:100}),goal('research','学問を広める','researches',3,{gold:800,stone:600}),goal('donate','同盟を支える','donations',1000,{wood:500,stone:500,magatama:80}),goal('trade','交易を結ぶ','trades',1,{gold:800,rice:800,magatama:60})],
 achievements:[goal('wins10','十戦の武勲','wins',10,{magatama:150}),goal('wins100','百戦の誉れ','wins',100,{magatama:500}),goal('builders50','城下の名奉行','upgrades',50,{gold:3000,magatama:200}),goal('draws100','百の絵巻','draws',100,{magatama:300}),goal('trade10','十国の商才','trades',10,{gold:2500,magatama:200}),goal('defense10','不屈の守り','defenses',10,{rice:2500,magatama:200})]
};
export const EXCHANGE_COSTS=Object.freeze({S:40,SS:100,SSS:200,U:400});
function metrics(save){const s=save?.state||{},a=s.stats||{};return{battles:n(a.battles)+n(s.roaming?.sequence),wins:n(a.wins)+n(s.roaming?.wins),roaming:n(s.roaming?.sequence),upgrades:n(a.upgrades)+n(a.castleUpgrades),researches:n(a.researches),recruited:n(a.recruited),draws:n(a.gachaDraws),duplicates:n(a.gachaDuplicates),recruits:n(s.progress?.counters?.recruits),training:n(s.progress?.counters?.training)};}
async function globalMetrics(db,id){
 const [donation,trades,battles,lastLoss,mail,incoming]=await Promise.all([
  stmt(db,"SELECT COALESCE(SUM(amount),0) AS n FROM guild_asset_requests WHERE actor_id=? AND direction='deposit'",id).first(),
  stmt(db,"SELECT COUNT(*) AS n FROM trades WHERE (sender_id=? OR recipient_id=?) AND status='accepted'",id,id).first(),
  stmt(db,"SELECT COALESCE(SUM(CASE WHEN json_extract(result_json,'$.won')=0 THEN 1 ELSE 0 END),0) AS n,COUNT(*) AS attacks FROM field_battles WHERE defender_id=?",id).first(),
  stmt(db,"SELECT id,created_at FROM field_battles WHERE defender_id=? AND json_extract(result_json,'$.won')=1 ORDER BY created_at DESC LIMIT 1",id).first(),
  stmt(db,'SELECT COUNT(*) AS n FROM mail_campaigns m WHERE (m.target_user_id=? OR m.target_user_id IS NULL) AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?)',id,id).first(),
  stmt(db,'SELECT id,created_at,result_json FROM field_battles WHERE defender_id=? ORDER BY created_at DESC LIMIT 20',id).all()
 ]);return{donations:n(Number(donation?.n)),trades:n(Number(trades?.n)),defenses:n(Number(battles?.n)),attackCount:n(Number(battles?.attacks)),attacks:rows(incoming).map(row=>{const r=JSON.parse(row.result_json);return{id:row.id,at:Number(row.created_at),attackerPlayerId:r.attackerPlayerId,attackerName:r.attackerName||'領主',castleName:r.castleName||'拠点',held:!r.won,lost:n(r.defenderLost)};}),lastLoss,unreadMail:n(Number(mail?.n))};
}
function checkpoint(save,now,global){const s=save.state;return{at:now,resources:{...s.resources,magatama:s.magatama},metrics:metrics(save),home:s.home,troops:s.troops,buildings:{...s.buildings},castles:Object.fromEntries(Object.entries(s.castles).map(([id,v])=>[id,v.level])),tech:{...s.tech},attackCount:global?.attackCount||0};}
function initial(now,save,global){const c=calendarKeys(now);return{version:1,calendar:c,totals:Object.fromEntries([...keys,'donations','trades','defenses'].map(k=>[k,0])),dayBase:null,weekBase:null,spent:0,lastVisit:now,checkpoint:checkpoint(save,now,global),returning:null,recovery:null,recap:null};}
async function account(ctx,save,{ack=false}={}){
 const {db,user,helpers:h}=ctx,now=Date.now(),campaignId=save.state.walking.campaignId,current=metrics(save),global=await globalMetrics(db,user.id);
 await stmt(db,'INSERT INTO progress_accounts(user_id,data_json,commit_token,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id) DO NOTHING',user.id,JSON.stringify(initial(now,save,global)),'init',now).run();
 for(let attempt=0;attempt<4;attempt++){
  const row=await stmt(db,'SELECT * FROM progress_accounts WHERE user_id=?',user.id).first(),data=JSON.parse(row.data_json),previous=await stmt(db,'SELECT observed_json FROM progress_campaigns WHERE user_id=? AND campaign_id=?',user.id,campaignId).first(),observed=previous?JSON.parse(previous.observed_json):{},next=copy(data),seen={};
  for(const key of keys){seen[key]=Math.max(n(observed[key]),n(current[key]));next.totals[key]=Math.min(MAX,n(next.totals[key])+Math.max(0,seen[key]-n(observed[key])));}
  for(const key of ['donations','trades','defenses'])next.totals[key]=Math.max(n(next.totals[key]),global[key]);
  // The earned/spent totals remain an audit trail; points are a capped balance.
  // Discarding overflow here prevents it from reappearing after an exchange.
  const balance=data.points??Math.min(ASSET_CAP,Math.max(0,n(data.totals.draws)+n(data.totals.duplicates)*2-n(data.spent))),earnedDelta=next.totals.draws-n(data.totals.draws)+(next.totals.duplicates-n(data.totals.duplicates))*2;
  next.points=Math.min(ASSET_CAP,Math.max(0,balance)+Math.max(0,earnedDelta));
  // The accepted day never moves backwards, including a server-clock correction.
  const cal=calendarKeys(Math.max(now,n(data.calendar?.day)*DAY-OFFSET));
  if(!next.dayBase||cal.day>data.calendar.day)next.dayBase=copy(next.totals);
  if(!next.weekBase||cal.week>data.calendar.week)next.weekBase=copy(next.totals);
  next.calendar=cal;
  if(now-next.lastVisit>=DAY&&(!next.returning||next.returning.key!==String(next.lastVisit)))next.returning={key:String(next.lastVisit),baseline:copy(next.totals),expiresAt:now+7*DAY};
  if(global.lastLoss&&next.recovery?.key!==global.lastLoss.id)next.recovery={key:global.lastLoss.id,baseline:copy(next.totals),expiresAt:Number(global.lastLoss.created_at)+3*DAY};
  const old=next.checkpoint,changed=old&&now-old.at>=60000;
  const recap=changed?{since:old.at,until:now,resources:Object.fromEntries(['gold','rice','wood','stone','magatama'].map(k=>[k,(k==='magatama'?save.state.magatama:save.state.resources[k])-(old.resources?.[k]||0)])),completedBuildings:Object.entries(save.state.buildings).filter(([k,v])=>v>(old.buildings?.[k]||0)).map(([id,level])=>({id,level})),completedResearch:Object.entries(save.state.tech).filter(([k,v])=>v>(old.tech?.[k]||0)).map(([id,level])=>({id,level})),oldHome:old.home,home:save.state.home,troopDelta:save.state.troops-old.troops,unreadMail:global.unreadMail,lastAttackAt:global.lastLoss?.created_at||null}:null;
  if(recap){recap.attacks=global.attacks.filter(b=>b.at>=old.at);recap.attackCount=Math.max(0,global.attackCount-(old.attackCount??global.attackCount-recap.attacks.length));recap.completedCastles=Object.entries(save.state.castles).filter(([id,c])=>c.owner===save.state.clan&&c.level>(old.castles?.[id]??c.level)).map(([id,c])=>({id,level:c.level}));}
  if(ack){next.lastVisit=now;next.checkpoint=checkpoint(save,now,global);next.recap=null;}
  const nonce=crypto.randomUUID(),guard=h.roleCommitGuard(user),gate='EXISTS(SELECT 1 FROM progress_accounts WHERE user_id=? AND commit_token=?)';
  const changedRow=await db.batch([
   stmt(db,`UPDATE progress_accounts SET data_json=?,revision=revision+1,commit_token=?,updated_at=? WHERE user_id=? AND revision=? AND ${guard.sql}`,JSON.stringify(next),nonce,now,user.id,row.revision,...guard.args),
   stmt(db,`INSERT INTO progress_campaigns(user_id,campaign_id,observed_json) SELECT ?,?,? WHERE ${gate} ON CONFLICT(user_id,campaign_id) DO UPDATE SET observed_json=excluded.observed_json`,user.id,campaignId,JSON.stringify(seen),user.id,nonce)
  ]);
  const accepted=await stmt(db,'SELECT * FROM progress_accounts WHERE user_id=?',user.id).first();if(accepted.commit_token===nonce)return{row:accepted,data:next,recap:ack?null:recap};
  await h.requireAccountAccess(db,user);
 }
 h.fail(409,'PROGRESS_CHANGED','成長記録が更新されています。もう一度開いてください。');
}
async function display(ctx,a){
 const d=a.data,now=Date.now(),claimKeys=[...PROGRESS_GOALS.daily.map(g=>'d:'+d.calendar.day+':'+g.id),...PROGRESS_GOALS.weekly.map(g=>'w:'+d.calendar.week+':'+g.id),...PROGRESS_GOALS.achievements.map(g=>'a:'+g.id),...['recruit','build'].map(id=>'r:'+d.returning?.key+':'+id),...['recruit','train'].map(id=>'f:'+d.recovery?.key+':'+id)];
 const [recent,active,total]=await Promise.all([
  stmt(ctx.db,'SELECT claim_key,kind,result_json,created_at FROM progress_receipts WHERE actor_id=? ORDER BY created_at DESC LIMIT 30',ctx.user.id).all(),
  stmt(ctx.db,`SELECT claim_key FROM progress_receipts WHERE actor_id=? AND claim_key IN (${claimKeys.map(()=>'?').join(',')})`,ctx.user.id,...claimKeys).all(),
  stmt(ctx.db,"SELECT COUNT(*) AS n FROM progress_receipts WHERE actor_id=? AND kind='mission'",ctx.user.id).first()
 ]),receipts=rows(recent),claims=new Set(rows(active).map(r=>r.claim_key));
 const list=(kind,defs,prefix,base)=>defs.map(g=>({...g,kind,key:prefix+g.id,progress:Math.min(g.target,Math.max(0,(d.totals[g.metric]||0)-(base?.[g.metric]||0))),claimed:claims.has(prefix+g.id)}));
 const daily=list('daily',PROGRESS_GOALS.daily,'d:'+d.calendar.day+':',d.dayBase),weekly=list('weekly',PROGRESS_GOALS.weekly,'w:'+d.calendar.week+':',d.weekBase),achievements=list('achievement',PROGRESS_GOALS.achievements,'a:',null),returning=[],recovery=[];
 if(d.returning&&d.returning.expiresAt>now)returning.push(...list('return', [goal('recruit','再出発の兵を集める','recruits',1,{gold:600,rice:1000}),goal('build','領国を整え直す','upgrades',1,{wood:400,stone:400})],'r:'+d.returning.key+':',d.returning.baseline));
 if(d.recovery&&d.recovery.expiresAt>now)recovery.push(...list('recovery',[goal('recruit','復興の募兵','recruits',1,{gold:500,rice:1200}),goal('train','復興の訓練','training',1,{rice:500,wood:300})],'f:'+d.recovery.key+':',d.recovery.baseline));
 const earned=d.totals.draws+d.totals.duplicates*2,unclaimed=Math.min(Math.max(0,3-daily.filter(g=>g.claimed).length),daily.filter(g=>!g.claimed&&g.progress>=g.target).length)+[...weekly,...achievements,...returning,...recovery].filter(g=>!g.claimed&&g.progress>=g.target).length;if(a.recap)a.recap.unclaimed=unclaimed;
 return{serverNow:now,calendar:d.calendar,assetCap:ASSET_CAP,dailyLimit:3,dailyClaimed:daily.filter(g=>g.claimed).length,missions:{daily,weekly,achievements,returning,recovery},totals:d.totals,exchange:{earned,spent:d.spent,available:d.points,costs:EXCHANGE_COSTS},claimedCount:Number(total?.n)||0,recap:a.recap,history:receipts.map(r=>({key:r.claim_key,kind:r.kind,at:r.created_at,...JSON.parse(r.result_json)}))};
}
async function saved(ctx,body){const {helpers:h,db,user}=ctx,clock=await h.getWorldClock(db,ctx.now);let row;if(body){row=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now);}else row=await h.getSyncRow(db,user.id);if(!row?.save_json)h.fail(409,'SAVE_REQUIRED','領主登録と本拠の自動保存を終えると成長任務を利用できます。');return{row,clock,save:h.normalizeGameSave(JSON.parse(row.save_json),user,Date.now(),{reading:true,clock})};}
async function result(ctx,body,receipt){const {db,user,helpers:h}=ctx,current=await saved(ctx),a=await account(ctx,current.save);return{...await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),body.deviceId,Date.now()),progress:await display(ctx,a),receipt:JSON.parse(receipt.result_json),idempotent:true};}
async function mutate(ctx,kind){
 const {db,user,helpers:h}=ctx,body=await h.readBody(ctx.request),allowed=kind==='mission'?['requestId','deviceId','expectedRevision','key']:['requestId','deviceId','expectedRevision','officerId','rank'];
 if(Object.keys(body).some(k=>!allowed.includes(k)))h.fail(400,'INVALID_INPUT','成長記録の操作内容を確認してください。');
 for(const k of ['requestId','deviceId'])body[k]=h.idField(body[k],k);if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','保存番号を確認してください。');
 const intent=kind==='mission'?String(body.key||''):[body.officerId,body.rank];if(kind==='mission'&&(!intent||intent.length>180))h.fail(400,'INVALID_INPUT','任務を選んでください。');
 const digest=await h.hash(JSON.stringify([kind,intent])),prior=await stmt(db,'SELECT * FROM progress_receipts WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();
 if(prior){if(prior.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の報酬に使われています。');return result(ctx,body,prior);}
 const current=await saved(ctx,body),a=await account(ctx,current.save),view=await display(ctx,a),next=copy(current.save),shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,current.clock,ctx.now):null,game=GameEngine.fromSave(next,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase:shared});let key,receipt;
 if(kind==='mission'){
  const mission=Object.values(view.missions).flat().find(m=>m.key===body.key);if(!mission)h.fail(409,'MISSION_EXPIRED','任務の期間が変わりました。最新の一覧を確認してください。');
  if(mission.claimed)h.fail(409,'MISSION_CLAIMED','この任務は受取済みです。');if(mission.progress<mission.target)h.fail(409,'MISSION_INCOMPLETE','達成条件がまだ満たされていません。');if(mission.kind==='daily'&&view.dailyClaimed>=3)h.fail(409,'DAILY_LIMIT','本日の選択任務3件は受取済みです。明日の任務をお待ちください。');
  key=mission.key;const credited=game._gain(mission.reward);receipt={name:mission.name,rewards:Object.fromEntries(Object.keys(mission.reward).map(k=>[k,credited[k]])),offeredRewards:mission.reward};
 }else{
  const cost=EXCHANGE_COSTS[body.rank];if(!cost||typeof body.officerId!=='string'||!game.gachaPool(body.rank).some(o=>o.id===body.officerId))h.fail(400,'INVALID_INPUT','交換できる武将とランクを選んでください。');
  if(game.ownsVariant(body.officerId,body.rank))h.fail(409,'VARIANT_OWNED','この絵巻は所持済みです。');if(view.exchange.available<cost)h.fail(409,'EXCHANGE_SHORTAGE','絵巻の証が足りません。招集1回につき1、重複で追加2をためられます。');
  game._grantOfficerVariant(body.officerId,body.rank);a.data.spent+=cost;a.data.points-=cost;key='x:'+body.officerId+':'+body.rank;receipt={name:game.officer(body.officerId).name+' '+body.rank,officerId:body.officerId,rank:body.rank,cost};
 }
 game.log(kind==='mission'?`成長任務「${receipt.name}」の報酬を受け取りました。`:`絵巻の証で「${receipt.name}」を迎えました。`,'progress');
 const normalized=h.normalizeGameSave(JSON.parse(game.exportSave()),user,Date.now(),{clock:current.clock}),now=Date.now(),nonce=crypto.randomUUID(),guard=h.roleCommitGuard(user),gate='EXISTS(SELECT 1 FROM progress_receipts WHERE actor_id=? AND request_id=? AND commit_token=?)',args=[user.id,body.requestId,nonce];
 await db.batch([
  stmt(db,`INSERT INTO progress_receipts(actor_id,request_id,claim_key,kind,request_hash,result_json,commit_token,created_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?) AND EXISTS(SELECT 1 FROM progress_accounts WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${guard.sql} ON CONFLICT DO NOTHING`,user.id,body.requestId,key,kind,digest,JSON.stringify(receipt),nonce,now,user.id,body.expectedRevision,body.deviceId,now,user.id,a.row.revision,h.worldClockId,current.clock.revision,...guard.args),
  stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(normalized),now,now+h.syncLease,user.id,...args),
  stmt(db,`UPDATE progress_accounts SET data_json=?,revision=revision+1,commit_token=?,updated_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(a.data),nonce,now,user.id,...args)
 ]);
 const accepted=await stmt(db,'SELECT * FROM progress_receipts WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();if(!accepted){await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());h.fail(409,'PROGRESS_CHANGED','本拠または報酬が更新されました。最新の一覧を確認してください。');}
 return{...await result(ctx,body,accepted),idempotent:accepted.commit_token!==nonce};
}
// Sync restores previously exchanged variants without crediting currency or
// accepting client claims. Presets/tutorial remain ordinary validated save data.
export async function reconcileProgress(db,userId,save,previous=null){
 const exchanged=rows(await stmt(db,"SELECT result_json FROM progress_receipts WHERE actor_id=? AND kind='exchange'",userId).all());
 for(const row of exchanged){const r=JSON.parse(row.result_json),pair=r.officerId+':'+r.rank;if(!save.state.officers.includes(r.officerId))save.state.officers.push(r.officerId);if(!save.state.officerVariants.includes(pair))save.state.officerVariants.push(pair);}
 return save;
}
export async function handleProgress(ctx){
 const {path,method,helpers:h}=ctx;await h.requireAccountAccess(ctx.db,ctx.user);
 if(path==='/progress'&&method==='GET'||path==='/progress/acknowledge'&&method==='POST'){const s=await saved(ctx),a=await account(ctx,s.save,{ack:path.endsWith('/acknowledge')});return{ok:true,progress:await display(ctx,a)};}
 if(path==='/progress/claim'&&method==='POST')return mutate(ctx,'mission');
 if(path==='/progress/exchange'&&method==='POST')return mutate(ctx,'exchange');
 h.fail(404,'NOT_FOUND','成長の記録の操作が見つかりません。');
}
