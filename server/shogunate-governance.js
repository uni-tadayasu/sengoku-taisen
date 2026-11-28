// Post-opening government development belongs to the account, never to an
// importable save or a particular opening right. Every debit, reward, level and
// immutable receipt is admitted together by one D1 transaction.
import {GameEngine,GAME_OFFICERS} from './game-runtime.js';
const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=value=>value?.results||[];
const copy=value=>JSON.parse(JSON.stringify(value));
const DAY=86400000,OFFSET=9*3600000,RESET=5*3600000;
const RESOURCE_KEYS=['gold','rice','wood','stone','magatama'];
const RENOWN_CAP=1500,PROJECT_MAX=5;
const LEVELS=[{at:0,name:'開府'},{at:100,name:'政道整備'},{at:300,name:'領国振興'},{at:700,name:'泰平への道'},{at:1500,name:'天下泰平'}];
const POLICIES=[
 {id:'balanced',name:'文武均衡',description:'金銭・兵糧・普請資材を均等に蓄える国策です。',reward:{gold:600,rice:600,wood:300,stone:300,magatama:20}},
 {id:'agriculture',name:'農政振興',description:'政務褒賞を兵糧に重点配分し、領国の備えを厚くします。',reward:{gold:300,rice:1200,wood:150,stone:150,magatama:20}},
 {id:'commerce',name:'商業振興',description:'政務褒賞を金銭に重点配分し、次の事業へ備えます。',reward:{gold:1200,rice:300,wood:150,stone:150,magatama:20}},
 {id:'construction',name:'普請振興',description:'政務褒賞を木材と石材に重点配分します。',reward:{gold:300,rice:300,wood:600,stone:600,magatama:20}}
];
const PROJECTS=[
 {id:'granary',name:'治水・備蓄蔵',description:'水路と備蓄を整え、毎日の政務褒賞を豊かにします。',effect:'1レベルごとに、日次政務の兵糧が120増えます。',bonus:{rice:120}},
 {id:'roads',name:'五街道の整備',description:'街道を整備し、政務褒賞の金銭を増やします。',effect:'1レベルごとに、日次政務の金銭が120増えます。',bonus:{gold:120}},
 {id:'academy',name:'幕府学問所',description:'普請の知恵を育て、政務褒賞の資材を増やします。',effect:'1レベルごとに、日次政務の木材と石材がそれぞれ60増えます。',bonus:{wood:60,stone:60}}
];
const DUTIES=[
 {id:'audience',name:'日次政務',description:'今日の政務を執り、国策と公共事業に応じた褒賞を受け取ります。',cost:{},renown:10},
 {id:'relief',name:'領民救済',description:'兵糧2,000を救済へ回し、幕府の威信を15高めます。',cost:{rice:2000},renown:15},
 {id:'inspection',name:'街道巡見',description:'金銭2,000を巡見へ充て、幕府の威信を15高めます。',cost:{gold:2000},renown:15}
];
const MILESTONES=[
 {id:'first_work',name:'政道の礎',description:'公共事業を初めて1レベル発展させる。',metric:'levels',target:1,reward:{gold:1000,magatama:30}},
 {id:'all_works',name:'三つの柱',description:'すべての公共事業をLv.1以上にする。',metric:'built',target:3,reward:{wood:1000,stone:1000,magatama:60}},
 {id:'renown_300',name:'振興の誉れ',description:'幕府の威信を300まで高める。',metric:'renown',target:300,reward:{rice:2000,magatama:80}},
 {id:'master_works',name:'大普請成就',description:'三つの公共事業をすべてLv.5にする。',metric:'levels',target:15,reward:{gold:3000,magatama:200}},
 {id:'renown_1500',name:'天下泰平の証',description:'幕府の威信を1,500まで高める。',metric:'renown',target:1500,reward:{gold:2000,rice:2000,wood:2000,stone:2000,magatama:150}}
];
const CURRENT_SQL='SELECT id,government_name,opened_at FROM shogunate_rights WHERE user_id=? AND opened_at IS NOT NULL ORDER BY opened_at DESC,id DESC LIMIT 1';
const receiptGate='EXISTS(SELECT 1 FROM shogunate_governance_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const validDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const positive=value=>Object.values(value).some(amount=>amount>0);
const initial=()=>({version:1,policyId:'balanced',policyChangedDay:null,renown:0,projects:{granary:0,roads:0,academy:0},lastDay:null});

export function governanceCalendar(now,lastDay=null){
 const actual=new Date(now+OFFSET-RESET).toISOString().slice(0,10),day=validDay(lastDay)&&lastDay>actual?lastDay:actual;
 return{day,nextResetAt:Date.parse(day+'T00:00:00Z')-OFFSET+RESET+DAY,resetHour:5,timeZone:'Asia/Tokyo'};
}
function renownState(points){
 let index=0;for(let i=1;i<LEVELS.length;i++)if(points>=LEVELS[i].at)index=i;
 return{points,level:index+1,name:LEVELS[index].name,levelStart:LEVELS[index].at,nextLevelAt:LEVELS[index+1]?.at??null,totalLevels:LEVELS.length,cap:RENOWN_CAP};
}
function dailyReward(state,policyId=state.policyId){
 const reward={...POLICIES.find(p=>p.id===policyId).reward};
 for(const project of PROJECTS)for(const [key,amount] of Object.entries(project.bonus))reward[key]+=amount*state.projects[project.id];
 reward.magatama+=(renownState(state.renown).level-1)*5;return reward;
}
function projectCost(level){return{gold:3000*level,rice:1000*level,wood:1500*level,stone:1000*level};}
function metrics(state){const levels=Object.values(state.projects);return{levels:levels.reduce((sum,n)=>sum+n,0),built:levels.filter(n=>n>0).length,renown:state.renown};}
function resourceBalances(save){return Object.fromEntries(RESOURCE_KEYS.map(key=>[key,Math.min(GameEngine.ASSET_CAP,Math.max(0,Number((key==='magatama'?save?.state:save?.state?.resources)?.[key])||0))]));}
function canPay(resources,cost){return Object.entries(cost).every(([key,amount])=>resources[key]>=amount);}
function cappedReward(resources,reward){return Object.fromEntries(Object.entries(reward).map(([key,amount])=>[key,Math.min(amount,Math.max(0,GameEngine.ASSET_CAP-resources[key]))]));}
async function readAccount(db,userId){
 const row=await S(db,'SELECT * FROM shogunate_governance_accounts WHERE user_id=?',userId).first();
 return{row,state:row?JSON.parse(row.data_json):initial(),revision:Number(row?.revision||0)};
}
function governmentDto(row){return row?{id:row.id,name:row.government_name,rank:'征夷大将軍',openedAt:Number(row.opened_at)}:null;}
function lockedView(now){return{version:1,available:false,reason:'幕府を開設すると、国策・公共事業・日次政務を利用できます。',government:null,serverNow:now,calendar:governanceCalendar(now),revision:0,policyId:'balanced',policyChangedToday:false,resources:resourceBalances(null),renown:renownState(0),dailyReward:{},policies:[],projects:[],duties:[],milestones:[],history:[]};}

async function display(ctx,{government=null,account=null,save=null}={}){
 const {db,user,helpers:h,now}=ctx;
 government=government||await S(db,CURRENT_SQL,user.id).first();if(!government)return lockedView(now);
 account=account||await readAccount(db,user.id);const {state,revision}=account,calendar=governanceCalendar(now,state.lastDay),resources=resourceBalances(save||JSON.parse((await h.getSyncRow(db,user.id))?.save_json||'null'));
 const claimKeys=[...DUTIES.map(d=>'duty:'+calendar.day+':'+d.id),...MILESTONES.map(m=>'milestone:'+m.id)];
 const [claimRows,historyRows]=await Promise.all([
  S(db,`SELECT claim_key FROM shogunate_governance_requests WHERE actor_id=? AND claim_key IN (${claimKeys.map(()=>'?').join(',')})`,user.id,...claimKeys).all(),
  S(db,'SELECT result_json FROM shogunate_governance_requests WHERE actor_id=? ORDER BY created_at DESC,request_id DESC LIMIT 30',user.id).all()
 ]),claimed=new Set(rows(claimRows).map(row=>row.claim_key)),reward=dailyReward(state),progress=metrics(state),renown=renownState(state.renown);
 const policyChangedToday=state.policyChangedDay===calendar.day;
 const policies=POLICIES.map(p=>({...p,reward:dailyReward(state,p.id),selected:p.id===state.policyId,canSelect:p.id!==state.policyId&&!policyChangedToday,reason:p.id===state.policyId?'現在の国策です。':policyChangedToday?'国策の変更は1日1回です。日本時間の朝5時に更新します。':null}));
 const projects=PROJECTS.map(p=>{const level=state.projects[p.id],cost=level<PROJECT_MAX?projectCost(level+1):{},reason=level>=PROJECT_MAX?'この事業は最大レベルです。':!canPay(resources,cost)?'必要な資源が足りません。':null;return{id:p.id,name:p.name,description:p.description,effect:p.effect,level,maxLevel:PROJECT_MAX,cost,renownReward:level<PROJECT_MAX?Math.min(20*(level+1),RENOWN_CAP-state.renown):0,canUpgrade:!reason,reason};});
 const duties=DUTIES.map(d=>{const done=claimed.has('duty:'+calendar.day+':'+d.id),offered=d.id==='audience'?reward:{},gain=Math.min(d.renown,RENOWN_CAP-state.renown);let reason=done?'本日の政務は完了しました。':!canPay(resources,d.cost)?'必要な資源が足りません。':gain===0&&!positive(cappedReward(resources,offered))?(d.id==='audience'?'資産と威信が上限です。受取枠は残っています。':'威信は最大です。この政務の費用は消費しません。'):null;return{id:d.id,name:d.name,description:d.description,cost:{...d.cost},reward:offered,renownReward:gain,claimed:done,canComplete:!reason,reason};});
 const milestones=MILESTONES.map(m=>{const value=Math.min(m.target,progress[m.metric]),done=claimed.has('milestone:'+m.id),eligible=value>=m.target,reason=done?'褒賞を受け取り済みです。':!eligible?'発展目標を達成すると受け取れます。':!positive(cappedReward(resources,m.reward))?'対象の資産が上限です。受取枠は残っています。':null;return{id:m.id,name:m.name,description:m.description,progress:value,target:m.target,eligible,claimed:done,reward:{...m.reward},canClaim:!reason,reason};});
 return{version:1,available:true,reason:null,government:governmentDto(government),serverNow:now,calendar,revision,policyId:state.policyId,policyChangedToday,resources,renown,dailyReward:reward,policies,projects,duties,milestones,history:rows(historyRows).map(row=>JSON.parse(row.result_json))};
}
function readInput(raw,h){
 const allowed=['kind','targetId','day','governanceRevision','requestId','deviceId','expectedRevision'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!allowed.includes(key))||!['policy','project','duty','milestone'].includes(raw.kind)||!validDay(raw.day)||!Number.isSafeInteger(raw.governanceRevision)||raw.governanceRevision<0||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)h.fail(400,'INVALID_INPUT','政務の種類・日付・保存番号を確認してください。');
 const body={kind:raw.kind,targetId:h.idField(raw.targetId,'政務の対象'),day:raw.day,governanceRevision:raw.governanceRevision,requestId:h.idField(raw.requestId,'操作番号'),deviceId:h.idField(raw.deviceId,'端末識別子'),expectedRevision:raw.expectedRevision};
 const catalog={policy:POLICIES,project:PROJECTS,duty:DUTIES,milestone:MILESTONES}[body.kind];if(!catalog.some(item=>item.id===body.targetId))h.fail(400,'INVALID_INPUT','一覧にある政務を選んでください。');return body;
}
async function findReceipt(db,userId,requestId,digest,h){
 const row=await S(db,'SELECT * FROM shogunate_governance_requests WHERE actor_id=? AND request_id=?',userId,requestId).first();
 if(row&&row.request_hash!==digest)h.fail(409,'REQUEST_ID_REUSED','この操作番号は別の政務に使用されています。');return row;
}
async function result(ctx,record,deviceId,idempotent){
 const {db,user,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 const now=Date.now(),snapshot=await h.syncSnapshot(db,await h.getSyncRow(db,user.id),await h.getUser(db,user.id),deviceId,now);
 return{...snapshot,governance:await display({...ctx,now},{save:snapshot.save}),receipt:JSON.parse(record.result_json),idempotent};
}
async function mutate(ctx){
 const {db,user,helpers:h}=ctx,body=readInput(await h.readBody(ctx.request),h),digest=await h.hash(JSON.stringify([body.kind,body.targetId,body.day]));
 const prior=await findReceipt(db,user.id,body.requestId,digest,h);if(prior)return result(ctx,prior,body.deviceId,true);
 const government=await S(db,CURRENT_SQL,user.id).first();if(!government)h.fail(409,'SHOGUNATE_REQUIRED','幕府を開設してから政務を行ってください。');
 await h.budget(db,'shogunate-governance:'+user.id,90,60000,ctx.now);
 const saved=await h.settleWriterCycle(db,user,body.deviceId,body.expectedRevision,ctx.now),clock=await h.getWorldClock(db,ctx.now),account=await readAccount(db,user.id);
 const now=Date.now(),calendar=governanceCalendar(now,account.state.lastDay);
 if(body.day!==calendar.day)h.fail(409,'GOVERNANCE_DAY_CHANGED','日本時間の朝5時を迎え、政務の日付が変わりました。最新の一覧を確認してください。');
 if(body.governanceRevision!==account.revision)h.fail(409,'GOVERNANCE_CHANGED','幕府の発展記録が更新されました。最新の一覧を確認してください。');
 const save=h.normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock}),shared=user.is_staff&&!user.is_admin?await h.staffBaseDto(db,user,clock,now):null;
 const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared}),next=copy(account.state),resources=resourceBalances(save);
 let name,cost={},offeredReward={},renownOffered=0,claimKey;
 if(body.kind==='policy'){
  const policy=POLICIES.find(p=>p.id===body.targetId);name=policy.name;
  if(next.policyId===policy.id)h.fail(409,'GOVERNANCE_POLICY_SELECTED','すでに選択中の国策です。');
  if(next.policyChangedDay===calendar.day)h.fail(409,'GOVERNANCE_POLICY_LIMIT','国策の変更は1日1回です。日本時間の朝5時に更新します。');
  next.policyId=policy.id;next.policyChangedDay=calendar.day;claimKey='policy:'+calendar.day;
 }else if(body.kind==='project'){
  const project=PROJECTS.find(p=>p.id===body.targetId),level=next.projects[project.id];name=project.name+' Lv.'+(level+1);
  if(level>=PROJECT_MAX)h.fail(409,'GOVERNANCE_PROJECT_MAX','この公共事業は最大レベルです。');
  cost=projectCost(level+1);renownOffered=20*(level+1);next.projects[project.id]=level+1;claimKey='project:'+project.id+':'+(level+1);
 }else if(body.kind==='duty'){
  const duty=DUTIES.find(d=>d.id===body.targetId);name=duty.name;cost={...duty.cost};renownOffered=duty.renown;offeredReward=duty.id==='audience'?dailyReward(next):{};claimKey='duty:'+calendar.day+':'+duty.id;
  if(duty.id!=='audience'&&next.renown>=RENOWN_CAP)h.fail(409,'GOVERNANCE_RENOWN_CAP','幕府の威信は最大です。この政務の費用は消費しません。');
 }else{
  const milestone=MILESTONES.find(m=>m.id===body.targetId);name=milestone.name;claimKey='milestone:'+milestone.id;
  if(metrics(next)[milestone.metric]<milestone.target)h.fail(409,'GOVERNANCE_MILESTONE_INCOMPLETE','この発展目標はまだ達成していません。');offeredReward={...milestone.reward};
 }
 if(await S(db,'SELECT 1 FROM shogunate_governance_requests WHERE actor_id=? AND claim_key=?',user.id,claimKey).first())h.fail(409,'GOVERNANCE_CLAIMED','この政務・褒賞は処理済みです。最新の一覧を確認してください。');
 if(!canPay(resources,cost))h.fail(409,'GOVERNANCE_SHORTAGE','この政務に必要な資源が足りません。');
 const renownGained=Math.min(renownOffered,RENOWN_CAP-next.renown);
 if((body.kind==='milestone'||body.kind==='duty'&&body.targetId==='audience')&&!renownGained&&!positive(cappedReward(resources,offeredReward)))h.fail(409,'GOVERNANCE_REWARD_CAP','対象の資産と威信が上限です。受取枠は消費していません。');
 game._pay(cost);const credited=game._gain(offeredReward),reward=Object.fromEntries(Object.keys(offeredReward).map(key=>[key,credited[key]]));next.renown+=renownGained;next.lastDay=calendar.day;
 const receipt={id:body.requestId,kind:body.kind,targetId:body.targetId,name,at:now,day:calendar.day,cost,reward,offeredReward,renownGained,renownOffered,governmentId:government.id};
 game.log(`幕府政務「${name}」を完了しました。${renownGained?' 威信 +'+renownGained+'。':''}`,'shogunate');
 const normalized=h.normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),role=h.roleCommitGuard(user),args=[user.id,body.requestId,nonce];
 const accountGuard=account.row?{sql:'EXISTS(SELECT 1 FROM shogunate_governance_accounts WHERE user_id=? AND revision=?)',args:[user.id,account.revision]}:{sql:'NOT EXISTS(SELECT 1 FROM shogunate_governance_accounts WHERE user_id=?)',args:[user.id]};
 const openedGuard=`EXISTS(SELECT 1 FROM shogunate_rights r WHERE r.id=? AND r.user_id=? AND r.opened_at=? AND NOT EXISTS(SELECT 1 FROM shogunate_rights newer WHERE newer.user_id=r.user_id AND (newer.opened_at>r.opened_at OR (newer.opened_at=r.opened_at AND newer.id>r.id))))`;
 const statements=[
  S(db,`INSERT INTO shogunate_governance_requests(actor_id,request_id,claim_key,kind,request_hash,result_json,commit_token,created_at)
   SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?)
   AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${accountGuard.sql} AND ${openedGuard} AND ${role.sql}
   ON CONFLICT DO NOTHING RETURNING request_id`,user.id,body.requestId,claimKey,body.kind,digest,JSON.stringify(receipt),nonce,now,user.id,body.expectedRevision,body.deviceId,now,h.worldClockId,clock.revision,...accountGuard.args,government.id,user.id,Number(government.opened_at),...role.args),
  S(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${receiptGate}`,JSON.stringify(normalized),now,now+h.syncLease,user.id,...args),
  S(db,`INSERT INTO shogunate_governance_accounts(user_id,data_json,revision,commit_token,updated_at) SELECT ?,?,1,?,? WHERE ${receiptGate}
   ON CONFLICT(user_id) DO UPDATE SET data_json=excluded.data_json,revision=shogunate_governance_accounts.revision+1,commit_token=excluded.commit_token,updated_at=excluded.updated_at`,user.id,JSON.stringify(next),nonce,now,...args)
 ];
 await db.batch(statements);
 const accepted=await findReceipt(db,user.id,body.requestId,digest,h);
 if(!accepted){await h.requireAccountAccess(db,user);h.fieldWriter(await h.getSyncRow(db,user.id),body.deviceId,body.expectedRevision,Date.now());h.fail(409,'GOVERNANCE_CHANGED','幕府・保存・政務の状態が変更されました。最新の状態を確認してください。');}
 return result(ctx,accepted,body.deviceId,accepted.commit_token!==nonce);
}

export async function handleShogunateGovernance(ctx){
 const {db,user,path,method,helpers:h}=ctx;await h.requireAccountAccess(db,user);
 const guard=h.roleCommitGuard(user);h.registerResponseGuard?.({...guard,code:'GOVERNANCE_CHANGED',message:'領主の役職または利用状態が変わりました。最新の接続状態を確認してください。'});
 if(path==='/shogunate/governance'&&method==='GET')return{ok:true,governance:await display(ctx)};
 if(path==='/shogunate/governance/action'&&method==='POST')return mutate(ctx);
 h.fail(404,'NOT_FOUND','幕府政庁の操作が見つかりません。');
}
