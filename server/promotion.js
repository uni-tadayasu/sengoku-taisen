import {operationGuard} from './operator-access.js';
// Aggregate event counts only. No visitor IDs, account IDs, IP addresses,
// cookies, referrers, arbitrary URLs or raw request bodies enter this table.
const SOURCES = new Set(['direct','x','line','youtube','press','friend','discord','copy_link','share_text','native_share','english','other']);
const EVENTS = new Set(['landing','play_click']);
const ORIGINS = new Set(['https://www.kasai-solutions-inc.com','https://uni-tadayasu.github.io']);
const DAY_MS = 86400000;
const JST_MS = 9 * 3600000;
const MINUTE_LIMIT = 120;
const DAY_LIMIT = 6000;
const statement = (db, sql, ...values) => db.prepare(sql).bind(...values);
const rows = result => result?.results || [];
const dayAt = time => new Date(time + JST_MS).toISOString().slice(0,10);
const unavailable = fail => fail(503,'PROMOTION_UNAVAILABLE','紹介の集計を現在利用できません。ゲームはそのまま遊べます。');

export function requirePromotionOrigin(request, fail) {
  if (!ORIGINS.has(request.headers.get('origin'))) fail(403,'ORIGIN_DENIED','この接続元では紹介の集計を受け付けていません。');
}

export async function recordPromotion({db,request,now,helpers}) {
  const {fail,readBody,budget} = helpers;
  requirePromotionOrigin(request,fail);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) fail(415,'JSON_REQUIRED','JSON形式で送信してください。');
  const body = await readBody(request,256);
  if (Object.keys(body).length !== 2 || !Object.hasOwn(body,'event') || !Object.hasOwn(body,'source') || !EVENTS.has(body.event) || !SOURCES.has(body.source)) {
    fail(400,'INVALID_PROMOTION_EVENT','紹介の集計項目が正しくありません。');
  }
  if (!db?.prepare || !db?.batch) unavailable(fail);
  try {
    // Two fixed scopes bound accepted writes without identifying a visitor.
    // A quota window starts with the first request and resets after its length.
    await budget(db,'promotion:minute',MINUTE_LIMIT,60000,now);
    await budget(db,'promotion:day',DAY_LIMIT,DAY_MS,now);
    await statement(db,`INSERT INTO promotion_daily(day,source,event,count) VALUES(?,?,?,1)
      ON CONFLICT(day,source,event) DO UPDATE SET count=promotion_daily.count+1`,dayAt(now),body.source,body.event).run();
  } catch (error) {
    if (error?.status === 429) throw error;
    unavailable(fail);
  }
  return {ok:true,accepted:true};
}

export async function readPromotionReport({db,user,url,now,helpers}) {
  const {fail,requireOperator,budget} = helpers;
  requireOperator(user);
  const values = url.searchParams.getAll('days');
  const raw = values[0] ?? '14';
  if (values.length > 1 || [...url.searchParams.keys()].some(key => key !== 'days') || !/^(?:[1-9]|[1-8][0-9]|90)$/.test(raw)) {
    fail(400,'INVALID_PROMOTION_RANGE','集計期間は1〜90日で指定してください。');
  }
  const days = Number(raw), todayStart = Math.floor((now + JST_MS) / DAY_MS) * DAY_MS - JST_MS;
  const start = todayStart - (days - 1) * DAY_MS, from = dayAt(start), to = dayAt(now);
  // Every SELECT checks the current operational role term, including changes
  // after authentication. Appointed staff receive no analytics access.
  const {sql:guard,args:guardArgs}=operationGuard(user);
  if (!db?.prepare || !db?.batch) unavailable(fail);
  let result;
  try {
    await budget(db,'promotion:report',30,60000,now);
    result = await db.batch([
      statement(db,'SELECT 1 AS allowed WHERE '+guard,...guardArgs),
      statement(db,'SELECT day,source,event,count FROM promotion_daily WHERE day>=? AND day<=? AND '+guard+' ORDER BY day,source,event',from,to,...guardArgs),
      statement(db,'SELECT COUNT(*) AS total,COALESCE(SUM(CASE WHEN created_at>=? AND created_at<=? THEN 1 ELSE 0 END),0) AS created_in_range FROM users WHERE '+guard,start,now,...guardArgs)
    ]);
    if (!rows(result[0]).length || !await statement(db,'SELECT 1 AS allowed WHERE '+guard,...guardArgs).first()) fail(403,'OPERATIONAL_REQUIRED','運営専用の機能です。');
  } catch (error) {
    if (error?.status === 403 || error?.status === 429) throw error;
    unavailable(fail);
  }
  const events = rows(result[1]).map(row => ({day:row.day,source:row.source,event:row.event,count:Number(row.count)}));
  const totals = {landing:0,play_click:0};
  for (const row of events) totals[row.event] += row.count;
  const accounts = rows(result[2])[0];
  return {ok:true,timezone:'Asia/Tokyo',range:{from,to,days},events,totals,
    accounts:{total:Number(accounts.total),createdInRange:Number(accounts.created_in_range)},
    definitions:{events:'受け付けた操作の回数です。実人数・ユニーク利用者・プレイ完了数ではありません。',accounts:'登録アカウント数です。運営・スタッフ・利用停止中を含み、端末だけで遊ぶ人は含みません。実人数ではありません。'},
    limits:{eventsPerMinute:MINUTE_LIMIT,eventsPer24Hours:DAY_LIMIT},serverNow:new Date(now).toISOString()};
}
