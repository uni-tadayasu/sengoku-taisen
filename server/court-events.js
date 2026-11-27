// Court staff and the current Regent collaborate on private event drafts.
// A separate explicit publication makes the canonical timed event playable.
import {eventDto,eventStatus} from './events.js';
import {normalizeEventPlan} from './event-planner.js';
import {listCourtEventTemplates,generateCourtEventPlan} from './court-event-planner.js';

const S=(db,sql,...args)=>db.prepare(sql).bind(...args),rows=result=>result?.results||[];
const DAY_MS=86400000,MAX_DRAFTS=30,ROOM_LIMIT=50;
const ROOM_SELECT=`SELECT e.*,r.source_json,r.created_by,u.name AS creator_name
 FROM court_event_room_events r JOIN timed_events e ON e.id=r.event_id JOIN users u ON u.id=r.created_by`;
const GATE='EXISTS(SELECT 1 FROM court_event_room_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const iso=value=>new Date(Number(value)).toISOString();
const ACCESS_MESSAGE='京都御所の業務資格が変わりました。最新の接続状態を確認してください。';
const generator=()=>({id:'game-ai-v1',label:'ゲームAI',description:'要望のキーワードと20種類のテンプレートから、戦場・難易度・3つの局面を自動構成するゲーム内AIです。'});
const roomDto=(row,now)=>({...eventDto(row,now),revision:Number(row.revision),creator:{id:row.created_by,name:row.creator_name},source:JSON.parse(row.source_json)});

async function checkAccess(ctx,guard){
 await ctx.helpers.requireAccountAccess(ctx.db,ctx.user);
 if(!await S(ctx.db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())ctx.helpers.fail(409,'COURT_EVENT_ACCESS_CHANGED',ACCESS_MESSAGE);
}
function checkedBody(raw,allowed,h){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!allowed.includes(key)))h.fail(400,'INVALID_INPUT','イベント作成室への送信内容を確認してください。');
 return h.idField(raw.requestId,'操作番号');
}
async function roomRow(ctx,id){
 const found=await S(ctx.db,ROOM_SELECT+' WHERE e.id=?',id).first();
 if(!found)ctx.helpers.fail(404,'COURT_EVENT_NOT_FOUND','このイベント作成室の企画は見つかりませんでした。');
 return found;
}
async function prior(ctx,requestId,digest){
 const found=await S(ctx.db,'SELECT * FROM court_event_room_requests WHERE actor_id=? AND request_id=?',ctx.user.id,requestId).first();
 if(found&&found.request_hash!==digest)ctx.helpers.fail(409,'REQUEST_ID_REUSED','この操作番号は別のイベント作成室の操作に使われています。');
 return found;
}
async function result(ctx,guard,accepted,idempotent){
 const receipt=JSON.parse(accepted.result_json),row=await roomRow(ctx,receipt.eventId);
 await checkAccess(ctx,guard);
 return{ok:true,canManage:true,serverNow:iso(ctx.now),idempotent,event:roomDto(row,ctx.now),receipt};
}
async function directory(ctx,guard){
 const{db,now}=ctx,result=await db.batch([
  S(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args),
  S(db,ROOM_SELECT+` ORDER BY CASE WHEN e.status='active' AND e.ended_at IS NULL AND e.ends_at>? THEN 0 WHEN e.status='draft' THEN 1 ELSE 2 END,e.created_at DESC,e.id DESC LIMIT ?`,now,ROOM_LIMIT+1),
  S(db,"SELECT COUNT(*) AS count FROM timed_events WHERE status='draft'"),
  S(db,"SELECT id,name,ends_at FROM timed_events WHERE status='active' AND ended_at IS NULL AND ends_at>? ORDER BY starts_at DESC,id LIMIT 1",now)
 ]);
 if(!rows(result[0]).length){await checkAccess(ctx,guard);ctx.helpers.fail(409,'COURT_EVENT_ACCESS_CHANGED',ACCESS_MESSAGE);}
 const found=rows(result[1]),active=rows(result[3])[0];
 return{ok:true,canManage:true,serverNow:iso(now),templates:listCourtEventTemplates(),events:found.slice(0,ROOM_LIMIT).map(row=>roomDto(row,now)),hasMore:found.length>ROOM_LIMIT,
  draftLimit:MAX_DRAFTS,draftCount:Number(rows(result[2])[0].count),activeEvent:active?{id:active.id,name:active.name,endsAt:iso(active.ends_at)}:null,generator:generator()};
}
async function generate(ctx,guard){
 const{db,user,helpers:h,now}=ctx,body=await h.readBody(ctx.request),requestId=checkedBody(body,['generationMode','templateId','prompt','durationDays','requestId'],h);
 if(!['template','ai'].includes(body.generationMode)||!Number.isSafeInteger(body.durationDays)||body.durationDays<1||body.durationDays>7)h.fail(400,'INVALID_INPUT','生成方法と、1〜7日の開催期間を指定してください。');
 if(body.prompt!==undefined&&typeof body.prompt!=='string')h.fail(400,'INVALID_INPUT','イベントの要望は文章で入力してください。');
 const prompt=(body.prompt||'').normalize('NFC').replace(/\s+/gu,' ').trim(),templateId=body.templateId===undefined?null:body.templateId;
 if(Array.from(prompt).length>600||/[\u0000-\u001F\u007F-\u009F<>]/u.test(prompt))h.fail(400,'INVALID_INPUT','イベントの要望は600文字以内の文章で入力してください。');
 if((templateId!==null&&!listCourtEventTemplates().some(t=>t.id===templateId))||(body.generationMode==='template'&&!templateId))h.fail(400,'COURT_EVENT_TEMPLATE_REQUIRED','20種類のテンプレートから企画を選択してください。');
 if(body.generationMode==='ai'&&!prompt&&!templateId)h.fail(400,'INVALID_INPUT','イベントの要望を入力するか、構成のもとにするテンプレートを選択してください。');
 const digest=await h.hash(JSON.stringify(['generate',body.generationMode,templateId,prompt,body.durationDays])),existing=await prior(ctx,requestId,digest);
 if(existing)return result(ctx,guard,existing,true);
 await h.budget(db,'court-event-design:'+user.id,20,60000,now);
 let generated,plan;
 try{generated=await generateCourtEventPlan({mode:body.generationMode,templateId:templateId||undefined,prompt,durationDays:body.durationDays,seed:h.uid('seed_')});plan=normalizeEventPlan(generated.plan);}
 catch(error){if(error instanceof RangeError)h.fail(400,'INVALID_INPUT',error.message);throw error;}
 const id=h.uid('ev_'),nonce=crypto.randomUUID(),gateArgs=[user.id,requestId,nonce],receipt={action:'generate',eventId:id,revision:0};
 const accepted=await db.batch([
  S(db,`INSERT INTO court_event_room_requests(actor_id,request_id,event_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,'generate',?,?,?,? WHERE ${guard.sql} AND (SELECT COUNT(*) FROM timed_events WHERE status='draft')<${MAX_DRAFTS}
   ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,id,digest,nonce,JSON.stringify(receipt),now,...guard.args),
  S(db,`INSERT INTO timed_events(id,creator_id,name,duration_days,status,plan_json,created_at)
   SELECT ?,?,?,?,'draft',?,? WHERE ${GATE}`,id,user.id,plan.name,plan.durationDays,JSON.stringify(plan),now,...gateArgs),
  S(db,`INSERT INTO court_event_room_events(event_id,generation_mode,template_id,source_json,created_by,created_at)
   SELECT ?,?,?,?,?,? WHERE ${GATE}`,id,body.generationMode,generated.source.templateId,JSON.stringify(generated.source),user.id,now,...gateArgs)
 ]),saved=await prior(ctx,requestId,digest);
 if(!saved){
  await checkAccess(ctx,guard);const count=await S(db,"SELECT COUNT(*) AS count FROM timed_events WHERE status='draft'").first();
  if(Number(count.count)>=MAX_DRAFTS)h.fail(409,'EVENT_DRAFT_LIMIT','未開催の企画は運営の企画と合わせて30件までです。既存の企画を開催または破棄してください。');
  h.fail(409,'COURT_EVENT_CHANGED','イベント作成室の状態が変わりました。最新の一覧を確認してください。');
 }
 return result(ctx,guard,saved,!rows(accepted[0]).length);
}
function checkState(ctx,row,action,expectedRevision){
 const h=ctx.helpers;
 if(Number(row.revision)!==expectedRevision)h.fail(409,'COURT_EVENT_REVISION_CONFLICT','企画の状態が変わりました。最新の内容を確認してから操作してください。');
 if(action==='publish'&&row.status!=='draft')h.fail(409,'EVENT_ALREADY_PUBLISHED','未開催の企画だけを公開できます。');
 if(action==='discard'&&row.status!=='draft')h.fail(409,'COURT_EVENT_CHANGED','未開催の企画だけを破棄できます。');
 if(action==='end'&&eventStatus(row,ctx.now)!=='active')h.fail(409,'EVENT_ENDED','このイベントは開催中ではありません。');
}
async function change(ctx,guard,id,action){
 const{db,user,helpers:h,now}=ctx,body=await h.readBody(ctx.request),requestId=checkedBody(body,['expectedRevision','requestId'],h);
 if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)h.fail(400,'INVALID_INPUT','企画の更新番号を確認してください。');
 const digest=await h.hash(JSON.stringify([action,id,body.expectedRevision])),existing=await prior(ctx,requestId,digest);
 if(existing)return result(ctx,guard,existing,true);
 const row=await roomRow(ctx,id);checkState(ctx,row,action,body.expectedRevision);
 await h.budget(db,'court-event-manage:'+user.id,30,60000,now);
 const nonce=crypto.randomUUID(),args=[user.id,requestId,nonce],receipt={action,eventId:id,revision:body.expectedRevision+1},condition=action==='publish'
  ?"e.status='draft' AND NOT EXISTS(SELECT 1 FROM timed_events live WHERE live.status='active' AND live.ended_at IS NULL AND live.ends_at>?)"
  :action==='discard'?"e.status='draft'":"e.status='active' AND e.ended_at IS NULL AND e.starts_at<=? AND e.ends_at>?";
 const accepted=await db.batch([
  S(db,`INSERT INTO court_event_room_requests(actor_id,request_id,event_id,action,request_hash,commit_token,result_json,created_at)
   SELECT ?,?,?,?,?,?,?,? FROM timed_events e JOIN court_event_room_events r ON r.event_id=e.id
   WHERE e.id=? AND e.revision=? AND ${condition} AND ${guard.sql}
   ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,id,action,digest,nonce,JSON.stringify(receipt),now,id,body.expectedRevision,...(action==='publish'?[now]:action==='end'?[now,now]:[]),...guard.args),
  action==='publish'?S(db,`UPDATE timed_events SET status='active',starts_at=?,ends_at=?+duration_days*${DAY_MS},revision=revision+1 WHERE id=? AND ${GATE}`,now,now,id,...args)
   :action==='discard'?S(db,`UPDATE timed_events SET status='discarded',revision=revision+1 WHERE id=? AND ${GATE}`,id,...args)
   :S(db,`UPDATE timed_events SET status='ended',ended_at=?,revision=revision+1 WHERE id=? AND ${GATE}`,now,id,...args)
 ]),saved=await prior(ctx,requestId,digest);
 if(!saved){
  await checkAccess(ctx,guard);checkState(ctx,await roomRow(ctx,id),action,body.expectedRevision);
  if(action==='publish'&&await S(db,"SELECT 1 AS active FROM timed_events WHERE status='active' AND ended_at IS NULL AND ends_at>?",now).first())h.fail(409,'EVENT_ALREADY_ACTIVE','別のイベントが開催中です。終了してから公開してください。');
  h.fail(409,'COURT_EVENT_CHANGED','企画の状態が変わりました。最新の内容を確認してください。');
 }
 return result(ctx,guard,saved,!rows(accepted[0]).length);
}

export async function handleCourtEvents(ctx){
 const{db,user,method,path,helpers:h}=ctx;
 await h.requireAccountAccess(db,user);
 const authority=await h.courtDutyAuthority(db,user);
 if(!authority.canManageCourtEvents)h.fail(403,'COURT_EVENT_REQUIRED','イベント作成室は京都御所の業務メンバーだけが利用できます。');
 const guard=authority.guard;
 h.registerResponseGuard({...guard,code:'COURT_EVENT_ACCESS_CHANGED',message:ACCESS_MESSAGE});
 await checkAccess(ctx,guard);
 if([...ctx.url.searchParams].length)h.fail(400,'INVALID_INPUT','イベント作成室のURLを確認してください。');
 if(path==='/court/events'&&method==='GET')return directory(ctx,guard);
 if(path==='/court/events/generate'&&method==='POST')return generate(ctx,guard);
 const detail=/^\/court\/events\/(ev_[a-f0-9]{32})$/.exec(path);
 if(detail&&method==='GET')return{ok:true,canManage:true,serverNow:iso(ctx.now),event:roomDto(await roomRow(ctx,detail[1]),ctx.now)};
 const mutation=/^\/court\/events\/(ev_[a-f0-9]{32})\/(publish|end|discard)$/.exec(path);
 if(mutation&&method==='POST')return change(ctx,guard,mutation[1],mutation[2]);
 h.fail(404,'NOT_FOUND','このイベント作成室の操作は見つかりませんでした。');
}
