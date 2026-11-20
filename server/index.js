const API = '/api/v1';
const MAX_BODY = 16 * 1024;
const MAX_GUILD_MEMBERS = 50;
const ONLINE_WINDOW = 5 * 60 * 1000;
const WELCOME = '戦国大戦へようこそ。城を育て、仲間と語らい、天下統一を目指しましょう。';
const BASE_ORIGINS = new Set(['https://uni-tadayasu.github.io', 'http://127.0.0.1:4173', 'null']);
const encoder = new TextEncoder();

class ApiError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message); this.status = status; this.code = code; this.retryAfter = retryAfter;
  }
}
const fail = (status, code, message, retryAfter) => { throw new ApiError(status, code, message, retryAfter); };
const stmt = (db, sql, ...params) => db.prepare(sql).bind(...params);
const rows = result => result?.results || [];
const iso = n => new Date(Number(n)).toISOString();
const pair = (a, b) => a < b ? [a, b] : [b, a];
const uid = prefix => prefix + crypto.randomUUID().replaceAll('-', '');
const nameKey = text => text.normalize('NFKC').toLocaleLowerCase('ja');

function textField(value, name, max, { optional = false, min = 1 } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${name}を入力してください。`);
  const text = value.normalize('NFC').trim();
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(text)) fail(400, 'INVALID_INPUT', `${name}に使用できない文字が含まれています。`);
  if (Array.from(text).length < min || Array.from(text).length > max) fail(400, 'INVALID_INPUT', `${name}は${min}～${max}文字にしてください。`);
  return text;
}
function idField(value, name = '識別子') {
  const text = textField(value, name, 90);
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) fail(400, 'INVALID_INPUT', `${name}の形式が正しくありません。`);
  return text;
}
async function readBody(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'JSON形式で送信してください。');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。'); }
    chunks.push(value);
  }
  const joined = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { joined.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(joined)); }
  catch { fail(400, 'INVALID_JSON', '送信データを読み取れませんでした。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_JSON', 'JSONオブジェクトを送信してください。');
  return body;
}
async function hash(text) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
async function constantEqual(a, b) {
  const [ha, hb] = await Promise.all([hash(a), hash(b)]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
function gameToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (BASE_ORIGINS.has(origin) || origin === new URL(request.url).origin) return origin;
  const extras = String(env.SENGOKU_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (extras.includes(origin)) return origin;
  fail(403, 'ORIGIN_DENIED', 'この接続元は通信を許可されていません。');
}
function response(data, status = 200, origin = null, retryAfter) {
  const headers = new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'});
  if (origin !== null) headers.set('Access-Control-Allow-Origin', origin);
  if (retryAfter) headers.set('Retry-After', String(retryAfter));
  return new Response(JSON.stringify(data), {status, headers});
}
function mapUser(row, now = Date.now()) {
  return {
    id: row.id, name: row.name, clan: row.clan, isAdmin: !!row.is_admin,
    guildId: row.guild_id || null, guildName: row.guild_name || null,
    guildRole: row.guild_id ? (row.owner_id === row.id ? 'owner' : 'member') : null,
    online: Number(row.last_seen) >= now - ONLINE_WINDOW,
  };
}
const USER_SELECT = `SELECT u.id,u.name,u.clan,u.last_seen,gm.guild_id,g.name AS guild_name,g.owner_id,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin
  FROM users u LEFT JOIN guild_members gm ON gm.user_id=u.id LEFT JOIN guilds g ON g.id=gm.guild_id`;
async function getUser(db, id) { return stmt(db, USER_SELECT + ' WHERE u.id=?', id).first(); }
async function authenticate(request, db, now) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match) fail(401, 'AUTH_REQUIRED', '通信プレイヤーを登録してからご利用ください。');
  const tokenHash = await hash(match[1]);
  const row = await stmt(db, USER_SELECT + ' WHERE u.token_hash=?', tokenHash).first();
  if (!row) fail(401, 'INVALID_TOKEN', '通信プレイヤーの認証に失敗しました。保存済みの接続データをご確認ください。');
  if (Number(row.last_seen) <= now - 60000) {
    await stmt(db, 'UPDATE users SET last_seen=? WHERE id=? AND last_seen<=?', now, row.id, now - 60000).run();
    row.last_seen = now;
  }
  return row;
}
function requireAdmin(user) { if (!user.is_admin) fail(403, 'ADMIN_REQUIRED', '運営専用の機能です。'); }
async function budget(db, scope, limit, windowMs, now) {
  const result = await stmt(db, `INSERT INTO rate_limits(scope,window_start,count,last_at) VALUES(?,?,1,?)
    ON CONFLICT(scope) DO UPDATE SET
      count=CASE WHEN rate_limits.window_start<=? THEN 1 ELSE rate_limits.count+1 END,
      window_start=CASE WHEN rate_limits.window_start<=? THEN excluded.window_start ELSE rate_limits.window_start END,
      last_at=excluded.last_at
    WHERE rate_limits.count<? OR rate_limits.window_start<=?
    RETURNING count,window_start`, scope, now, now, now-windowMs, now-windowMs, limit, now-windowMs).first();
  if (!result) {
    const prior = await stmt(db, 'SELECT window_start FROM rate_limits WHERE scope=?', scope).first();
    fail(429, 'RATE_LIMITED', '操作が続いています。少し時間をおいて再度お試しください。', Math.max(1, Math.ceil((Number(prior?.window_start || now)+windowMs-now)/1000)));
  }
}
async function ipScope(request, env, purpose) {
  const ip = request.headers.get('cf-connecting-ip');
  if (!ip) return null;
  return purpose + ':' + await hash(String(env.SENGOKU_ADMIN_KEY || 'sengoku-public-rate-limit') + '\u0000' + ip);
}
async function userExists(db, id) {
  if (!await stmt(db, 'SELECT id FROM users WHERE id=?', id).first()) fail(404, 'PLAYER_NOT_FOUND', 'その領主は見つかりませんでした。');
}
async function roomFor(db, user, channel, target) {
  if (channel === 'world') return 'world';
  if (channel === 'admin') { requireAdmin(user); return 'admin'; }
  if (channel === 'guild') {
    if (!user.guild_id || (target && target !== user.guild_id)) fail(403, 'GUILD_REQUIRED', '所属ギルドのチャットだけを利用できます。');
    return 'guild:' + user.guild_id;
  }
  if (channel === 'friend') {
    const friendId = idField(target, '友達の識別子');
    if (friendId === user.id) fail(400, 'INVALID_TARGET', '自分自身とは友達チャットを開始できません。');
    const [a,b] = pair(user.id, friendId);
    const accepted = await stmt(db, `SELECT user_a FROM friendships WHERE user_a=? AND user_b=? AND status='accepted'`, a,b).first();
    if (!accepted) fail(403, 'FRIENDSHIP_REQUIRED', 'お互いに承認した友達とのみ会話できます。');
    return 'friend:' + a + ':' + b;
  }
  fail(400, 'INVALID_CHANNEL', 'チャットの種類が正しくありません。');
}
function mapMessage(row) {
  return {id:Number(row.id),userId:row.user_id,name:row.name,text:row.body,createdAt:iso(row.created_at),isAdmin:!!row.is_admin};
}
const MESSAGE_SELECT = `SELECT m.id,m.user_id,m.body,m.created_at,u.name,
 CASE WHEN m.user_id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin
 FROM messages m JOIN users u ON u.id=m.user_id`;
const GUILD_SELECT = `SELECT g.id,g.name,g.owner_id,u.name AS owner_name,g.created_at,
 (SELECT COUNT(*) FROM guild_members gm WHERE gm.guild_id=g.id) AS member_count FROM guilds g JOIN users u ON u.id=g.owner_id`;
function mapGuild(row) { return {id:row.id,name:row.name,ownerId:row.owner_id,ownerName:row.owner_name,memberCount:Number(row.member_count),maxMembers:MAX_GUILD_MEMBERS,createdAt:iso(row.created_at)}; }
function giftField(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_GIFT', '贈り物の形式が正しくありません。');
  const keys = ['gold','rice','wood','stone'];
  if (Object.keys(value).some(k => !keys.includes(k))) fail(400, 'INVALID_GIFT', '使用できない贈り物の種類です。');
  const gift = {};
  for (const k of keys) {
    const n = value[k] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) fail(400, 'INVALID_GIFT', '資源は0～1,000,000の整数にしてください。');
    gift[k] = n;
  }
  if (Object.values(gift).every(n => n === 0)) return null;
  return gift;
}
async function visibleMail(db, userId, mailId) {
  const mail = await stmt(db, 'SELECT * FROM mail_campaigns WHERE id=? AND (target_user_id IS NULL OR target_user_id=?)', mailId, userId).first();
  if (!mail) fail(404, 'MAIL_NOT_FOUND', 'このメールは受信できません。');
  return mail;
}

async function route(request, env, now) {
  const url = new URL(request.url), path = url.pathname.slice(API.length), method = request.method;
  const db = env.DB;
  if (!db?.prepare || !db?.batch) fail(503, 'SERVICE_UNAVAILABLE', '通信サービスの準備中です。');
  if (path === '/health' && method === 'GET') {
    await stmt(db, 'SELECT COUNT(*) AS count FROM users').first();
    return {ok:true,status:'ready'};
  }
  if (path === '/config' && method === 'GET') {
    const result = await db.batch([
      stmt(db, `SELECT key,value FROM settings WHERE key IN ('announcement','adminUserId')`),
      stmt(db, 'SELECT COUNT(*) AS count FROM users WHERE last_seen>=?', now-ONLINE_WINDOW),
    ]);
    const settings = Object.fromEntries(rows(result[0]).map(r => [r.key,r.value]));
    return {ok:true,announcement:settings.announcement ?? WELCOME,adminClaimed:!!settings.adminUserId,onlineCount:Number(rows(result[1])[0]?.count || 0)};
  }
  if (path === '/session' && method === 'POST') {
    const body = await readBody(request);
    const scope = await ipScope(request, env, 'session');
    if (scope) await budget(db, scope, 30, 60*60*1000, now);
    const name = textField(body.name, '領主名', 24, {optional:true}) || '旅の領主' + crypto.randomUUID().slice(0,6);
    const clan = textField(body.clan, '勢力名', 24, {optional:true}) || '織田家';
    const id = uid('u_'), token = gameToken();
    try { await stmt(db,'INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)',id,name,nameKey(name),clan,await hash(token),now,now).run(); }
    catch (error) { if (/unique/i.test(String(error))) fail(409,'NAME_TAKEN','その領主名はすでに使われています。別の名前をお選びください。'); throw error; }
    return {ok:true,token,user:mapUser(await getUser(db,id),now)};
  }

  const user = await authenticate(request,db,now);
  if (path === '/me' && method === 'GET') {
    const result = await db.batch([
      stmt(db, USER_SELECT + ` WHERE u.id IN (SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END FROM friendships WHERE (user_a=? OR user_b=?) AND status='accepted') ORDER BY u.name`,user.id,user.id,user.id),
      stmt(db, `SELECT f.requested_by,f.created_at,u.id,u.name,u.clan FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END WHERE (f.user_a=? OR f.user_b=?) AND f.status='pending' ORDER BY f.created_at DESC`,user.id,user.id,user.id),
      stmt(db, `SELECT COUNT(*) AS count FROM mail_campaigns m WHERE (m.target_user_id IS NULL OR m.target_user_id=?) AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?)`,user.id,user.id),
    ]);
    return {ok:true,user:mapUser(user,now),friends:rows(result[0]).map(r=>mapUser(r,now)),requests:rows(result[1]).map(r=>({id:r.id,name:r.name,clan:r.clan,direction:r.requested_by===user.id?'outgoing':'incoming',createdAt:iso(r.created_at)})),unreadMail:Number(rows(result[2])[0]?.count || 0)};
  }
  if (path === '/profile' && method === 'PATCH') {
    const body = await readBody(request), name = textField(body.name,'領主名',24);
    try { await stmt(db,'UPDATE users SET name=?,name_key=? WHERE id=?',name,nameKey(name),user.id).run(); }
    catch (error) { if (/unique/i.test(String(error))) fail(409,'NAME_TAKEN','その領主名はすでに使われています。'); throw error; }
    return {ok:true,user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/players' && method === 'GET') {
    const q = textField(url.searchParams.get('q'),'検索語',24,{min:2});
    const pattern = '%' + q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_') + '%';
    const result = await stmt(db,USER_SELECT + ` WHERE (u.name LIKE ? ESCAPE '\\' OR u.id=?) AND u.id<>? ORDER BY u.last_seen DESC,u.name LIMIT 30`,pattern,q,user.id).all();
    return {ok:true,players:rows(result).map(r=>mapUser(r,now))};
  }
  if (path === '/chat' && method === 'GET') {
    const channel = url.searchParams.get('channel') || 'world';
    const room = await roomFor(db,user,channel,url.searchParams.get('target'));
    const afterText = url.searchParams.get('after') || '0';
    if (!/^\d{1,15}$/.test(afterText)) fail(400,'INVALID_CURSOR','読み込み位置が正しくありません。');
    const after = Number(afterText);
    const query = after>0 ? MESSAGE_SELECT+' WHERE m.room_key=? AND m.id>? ORDER BY m.id ASC LIMIT 100' : MESSAGE_SELECT+' WHERE m.room_key=? ORDER BY m.id DESC LIMIT 100';
    let messages = rows(await stmt(db,query,...(after>0?[room,after]:[room])).all()).map(mapMessage);
    if (!after) messages.reverse();
    return {ok:true,channel,messages,nextAfter:messages.at(-1)?.id || after,hasMore:messages.length===100};
  }
  if (path === '/chat' && method === 'POST') {
    const body=await readBody(request), channel=textField(body.channel,'チャット種別',12), text=textField(body.text,'メッセージ',300);
    const room=await roomFor(db,user,channel,body.target);
    await budget(db,'chat:'+user.id,1,5000,now);
    const inserted=await stmt(db,'INSERT INTO messages(room_key,channel,user_id,body,created_at) VALUES(?,?,?,?,?) RETURNING id',room,channel,user.id,text,now).first();
    const message=await stmt(db,MESSAGE_SELECT+' WHERE m.id=?',inserted.id).first();
    return {ok:true,message:mapMessage(message)};
  }
  if (path === '/guilds' && method === 'GET') {
    const result=await stmt(db,GUILD_SELECT+' ORDER BY member_count DESC,g.name LIMIT 50').all();
    return {ok:true,guilds:rows(result).map(mapGuild)};
  }
  if (path === '/guild' && method === 'GET') {
    if (!user.guild_id) return {ok:true,guild:null,members:[]};
    const result=await db.batch([
      stmt(db,GUILD_SELECT+' WHERE g.id=?',user.guild_id),
      stmt(db,USER_SELECT+' WHERE gm.guild_id=? ORDER BY gm.joined_at,u.id',user.guild_id),
    ]);
    return {ok:true,guild:rows(result[0])[0]?mapGuild(rows(result[0])[0]):null,members:rows(result[1]).map(r=>mapUser(r,now))};
  }
  if (path === '/guild' && method === 'POST') {
    const body=await readBody(request),name=textField(body.name,'ギルド名',24);
    if (user.guild_id) fail(409,'ALREADY_IN_GUILD','所属中のギルドを脱退してから作成してください。');
    const id=uid('g_');
    try { await db.batch([
      stmt(db,'INSERT INTO guilds(id,name,name_key,owner_id,created_at) VALUES(?,?,?,?,?)',id,name,nameKey(name),user.id,now),
      stmt(db,'INSERT INTO guild_members(user_id,guild_id,joined_at) VALUES(?,?,?)',user.id,id,now),
    ]); } catch(error) { if (/unique/i.test(String(error))) fail(409,'GUILD_CONFLICT','そのギルド名は使われているか、すでに別のギルドへ参加しています。'); throw error; }
    return {ok:true,guild:mapGuild(await stmt(db,GUILD_SELECT+' WHERE g.id=?',id).first()),user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/guild/join' && method === 'POST') {
    const body=await readBody(request),guildId=idField(body.guildId,'ギルドの識別子');
    if (user.guild_id===guildId) return {ok:true,user:mapUser(user,now)};
    if (user.guild_id) fail(409,'ALREADY_IN_GUILD','所属中のギルドを脱退してから参加してください。');
    if (!await stmt(db,'SELECT id FROM guilds WHERE id=?',guildId).first()) fail(404,'GUILD_NOT_FOUND','そのギルドは見つかりませんでした。');
    await stmt(db,`INSERT INTO guild_members(user_id,guild_id,joined_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM guilds WHERE id=?) AND (SELECT COUNT(*) FROM guild_members WHERE guild_id=?)<? ON CONFLICT(user_id) DO NOTHING`,user.id,guildId,now,guildId,guildId,MAX_GUILD_MEMBERS).run();
    const current=await getUser(db,user.id);
    if (current.guild_id!==guildId) fail(409,'GUILD_UNAVAILABLE','ギルドが満員か、すでに別のギルドへ参加しています。');
    return {ok:true,user:mapUser(current,now)};
  }
  if (path === '/guild/leave' && method === 'POST') {
    await readBody(request);
    if (!user.guild_id) return {ok:true,user:mapUser(user,now)};
    await db.batch([
      stmt(db,`UPDATE guilds SET owner_id=(SELECT user_id FROM guild_members WHERE guild_id=? AND user_id<>? ORDER BY joined_at,user_id LIMIT 1) WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM guild_members WHERE guild_id=? AND user_id<>?)`,user.guild_id,user.id,user.guild_id,user.id,user.guild_id,user.id),
      stmt(db,'DELETE FROM guild_members WHERE user_id=? AND guild_id=?',user.id,user.guild_id),
      stmt(db,'DELETE FROM guilds WHERE id=? AND NOT EXISTS(SELECT 1 FROM guild_members WHERE guild_id=?)',user.guild_id,user.guild_id),
    ]);
    return {ok:true,user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/friends/request' && method === 'POST') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子');
    if(other===user.id) fail(400,'INVALID_TARGET','自分自身へ友達申請は送れません。');
    await userExists(db,other);
    const [a,b]=pair(user.id,other);
    const prior=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    if(prior) return {ok:true,status:prior.status,direction:prior.requested_by===user.id?'outgoing':'incoming'};
    await budget(db,'friend-request:'+user.id,20,600000,now);
    await stmt(db,`INSERT INTO friendships(user_a,user_b,requested_by,status,created_at,updated_at) VALUES(?,?,?,'pending',?,?) ON CONFLICT(user_a,user_b) DO NOTHING`,a,b,user.id,now,now).run();
    const current=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    return {ok:true,status:current.status,direction:current.requested_by===user.id?'outgoing':'incoming'};
  }
  if (path === '/friends/respond' && method === 'POST') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子');
    if(typeof body.accept!=='boolean') fail(400,'INVALID_INPUT','承認するかどうかを指定してください。');
    const [a,b]=pair(user.id,other);
    const prior=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    if(!prior||prior.status!=='pending'||prior.requested_by!==other) fail(403,'REQUEST_NOT_FOUND','承認できる友達申請がありません。');
    if(body.accept) await stmt(db,`UPDATE friendships SET status='accepted',updated_at=? WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=?`,now,a,b,other).run();
    else await stmt(db,`DELETE FROM friendships WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=?`,a,b,other).run();
    return {ok:true,status:body.accept?'accepted':'declined'};
  }
  if (path === '/friends' && method === 'DELETE') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子'),[a,b]=pair(user.id,other);
    await stmt(db,'DELETE FROM friendships WHERE user_a=? AND user_b=?',a,b).run();
    return {ok:true,deleted:true};
  }
  if (path === '/admin/claim' && method === 'POST') {
    const body=await readBody(request);
    const existing=await stmt(db,`SELECT value FROM settings WHERE key='adminUserId'`).first();
    if(existing?.value===user.id) return {ok:true,user:mapUser(await getUser(db,user.id),now),alreadyAdmin:true};
    if(existing) fail(409,'ADMIN_CLAIMED','運営者は登録済みです。登録済みの通信プレイヤーデータをご利用ください。');
    if(typeof env.SENGOKU_ADMIN_KEY!=='string'||env.SENGOKU_ADMIN_KEY.length<1) fail(503,'ADMIN_KEY_NOT_CONFIGURED','運営登録の準備が完了していません。');
    if(typeof body.key!=='string'||body.key.length<1||body.key.length>256) fail(400,'INVALID_INPUT','運営登録キーを入力してください。');
    const key=body.key;
    await budget(db,'admin-claim-user:'+user.id,5,600000,now);
    const ip=await ipScope(request,env,'admin-claim-ip');
    if(ip) await budget(db,ip,5,600000,now);
    if(!await constantEqual(key,env.SENGOKU_ADMIN_KEY)) fail(403,'INVALID_ADMIN_KEY','運営登録キーが正しくありません。');
    const result=await db.batch([
      stmt(db,`INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?) ON CONFLICT(key) DO NOTHING`,user.id,now),
      stmt(db,`SELECT value FROM settings WHERE key='adminUserId'`),
    ]);
    if(rows(result[1])[0]?.value!==user.id) fail(409,'ADMIN_CLAIMED','運営者は登録済みです。');
    return {ok:true,user:mapUser(await getUser(db,user.id),now),alreadyAdmin:false};
  }
  if (path === '/admin/announcement' && method === 'POST') {
    requireAdmin(user);
    const body=await readBody(request),text=textField(body.text,'お知らせ',300,{min:0});
    await stmt(db,`INSERT INTO settings(key,value,updated_at) VALUES('announcement',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`,text,now).run();
    return {ok:true,announcement:text};
  }
  if (path === '/admin/mail' && method === 'POST') {
    requireAdmin(user);
    const body=await readBody(request),target=body.target==='all'?null:idField(body.target,'送信先'),title=textField(body.title,'件名',60),content=textField(body.body,'本文',2000),gift=giftField(body.gift),requestId=idField(body.requestId,'リクエスト識別子');
    if(target) await userExists(db,target);
    const giftJson=gift?JSON.stringify(gift):null,payloadHash=await hash(JSON.stringify({target,title,body:content,gift}));
    const prior=await stmt(db,'SELECT id,payload_hash FROM mail_campaigns WHERE sender_id=? AND request_id=?',user.id,requestId).first();
    if(prior) {if(prior.payload_hash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT','同じ送信番号を別の内容に使うことはできません。');return {ok:true,mailId:prior.id,alreadySent:true};}
    await budget(db,'admin-mail:'+user.id,30,60000,now);
    const id=uid('m_');
    await stmt(db,`INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,gift_json,request_id,payload_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(sender_id,request_id) DO NOTHING`,id,user.id,target,title,content,giftJson,requestId,payloadHash,now).run();
    const saved=await stmt(db,'SELECT id,payload_hash FROM mail_campaigns WHERE sender_id=? AND request_id=?',user.id,requestId).first();
    if(saved.payload_hash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT','同じ送信番号を別の内容に使うことはできません。');
    return {ok:true,mailId:saved.id,alreadySent:saved.id!==id};
  }
  if (path === '/mail' && method === 'GET') {
    const result=await stmt(db,`SELECT m.id,m.title,m.body,m.gift_json,m.created_at,r.read_at,c.receipt_id FROM mail_campaigns m LEFT JOIN mail_reads r ON r.mail_id=m.id AND r.user_id=? LEFT JOIN mail_receipts c ON c.mail_id=m.id AND c.user_id=? WHERE m.target_user_id IS NULL OR m.target_user_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 200`,user.id,user.id,user.id).all();
    return {ok:true,mail:rows(result).map(r=>({id:r.id,title:r.title,body:r.body,gift:r.gift_json?JSON.parse(r.gift_json):null,read:r.read_at!==null,claimed:!!r.receipt_id,createdAt:iso(r.created_at)}))};
  }
  if (path === '/mail/read' && method === 'POST') {
    const body=await readBody(request),mailId=idField(body.mailId,'メール識別子');
    await visibleMail(db,user.id,mailId);
    await stmt(db,'INSERT INTO mail_reads(mail_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(mail_id,user_id) DO NOTHING',mailId,user.id,now).run();
    return {ok:true,read:true};
  }
  if (path === '/mail/claim' && method === 'POST') {
    const body=await readBody(request),mailId=idField(body.mailId,'メール識別子'),requestId=idField(body.requestId,'リクエスト識別子');
    const mail=await visibleMail(db,user.id,mailId);
    if(!mail.gift_json) fail(400,'NO_GIFT','このメールには贈り物がありません。');
    const reused=await stmt(db,'SELECT mail_id FROM mail_receipts WHERE user_id=? AND request_id=?',user.id,requestId).first();
    if(reused&&reused.mail_id!==mailId) fail(409,'IDEMPOTENCY_CONFLICT','別の贈り物に使用した受取番号です。');
    const receiptId=uid('r_');
    let result;
    try {result=await db.batch([
      stmt(db,`INSERT INTO mail_receipts(mail_id,user_id,receipt_id,request_id,gift_json,claimed_at) SELECT id,?,?,?,?,? FROM mail_campaigns WHERE id=? AND (target_user_id IS NULL OR target_user_id=?) AND gift_json IS NOT NULL ON CONFLICT(mail_id,user_id) DO NOTHING`,user.id,receiptId,requestId,mail.gift_json,now,mailId,user.id),
      stmt(db,'INSERT INTO mail_reads(mail_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(mail_id,user_id) DO NOTHING',mailId,user.id,now),
      stmt(db,'SELECT receipt_id,request_id,gift_json FROM mail_receipts WHERE mail_id=? AND user_id=?',mailId,user.id),
    ]);}catch(error){if(/unique/i.test(String(error))) fail(409,'IDEMPOTENCY_CONFLICT','受取番号が別の操作と重複しています。');throw error;}
    const receipt=rows(result[2])[0];
    if(!receipt) fail(409,'CLAIM_FAILED','受取状態を確認できませんでした。同じ番号で再試行してください。');
    if(receipt.request_id!==requestId) fail(409,'GIFT_ALREADY_CLAIMED','この贈り物は受取済みです。');
    return {ok:true,gift:JSON.parse(receipt.gift_json),receiptId:receipt.receipt_id,alreadyClaimed:receipt.receipt_id!==receiptId};
  }
  fail(404,'NOT_FOUND','その通信機能は見つかりませんでした。');
}

export default {
  async fetch(request, env, ctx) {
    let origin=null;
    try {
      const path=new URL(request.url).pathname;
      if(path==='/' && (request.method==='GET'||request.method==='HEAD')) {
        return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>戦国大戦 通信局</title><body style="font-family:system-ui;background:#101318;color:#eee;padding:3rem"><h1>戦国大戦 通信局</h1><p>領主たちの交流とお知らせを支える通信サービスです。</p></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
      }
      if(!path.startsWith(API+'/')) fail(404,'NOT_FOUND','その通信機能は見つかりませんでした。');
      origin=allowedOrigin(request,env);
      if(request.method==='OPTIONS') {
        const headers=new Headers({'Access-Control-Allow-Methods':'GET,POST,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
        if(origin!==null) headers.set('Access-Control-Allow-Origin',origin);
        return new Response(null,{status:204,headers});
      }
      return response(await route(request,env,Date.now()),200,origin);
    }catch(error){
      if(error instanceof ApiError){const e={code:error.code,message:error.message};if(error.retryAfter)e.retryAfter=error.retryAfter;return response({ok:false,error:e},error.status,origin,error.retryAfter);}
      return response({ok:false,error:{code:'INTERNAL_ERROR',message:'通信処理に失敗しました。少し時間をおいて再度お試しください。'}},500,origin);
    }
  }
};
