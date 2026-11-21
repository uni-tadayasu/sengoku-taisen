import {GameEngine, GAME_OFFICERS} from './game-runtime.js';
import {handleLetters} from './letters.js';
import {handleTrades} from './trade.js';
import {handleModeration} from './moderation.js';
import {handlePremium,handlePremiumWebhook,resolvePremiumAppearances} from './premium.js';
import {handleEvents} from './events.js';
import {handleRoaming,reconcileRoamingProgress} from './roaming.js';
import {handleCovert,reconcileCovertProgress,covertIncidentStatements} from './covert.js';
const API = '/api/v1';
const API_VERSION = '3.19.0';
const API_FEATURES = Object.freeze({trades:true,moderation:true,premium:true,timedEvents:true,troopTrades:true,roamingBattles:true,covertDispatch:true,privatePlayerRoles:true});
const MAX_BODY = 16 * 1024;
const MAX_SAVE_BODY = 2 * 1024 * 1024;
const MAX_AVATAR_BYTES = 48 * 1024;
const MAX_AVATAR_BODY = 70 * 1024;
const MAX_GUILD_MEMBERS = 50;
const ONLINE_WINDOW = 90 * 1000;
const RECENT_LOGIN_WINDOW = 24 * 60 * 60 * 1000;
const SYNC_LEASE = 30 * 1000;
const WALKING_RULES=Object.freeze({rewardPerStep:2,maxStepsPerSecond:4,heartbeatMs:5000,windowMs:30000,jitterSteps:2,deliveryToleranceMs:1000});
const MAX_WALKING_STEPS=Math.floor(Number.MAX_SAFE_INTEGER/2);
const PAIR_CODE_LIFETIME = 10 * 60 * 1000;
const IEYASU_ID = 'of_b0616adde162';
const ADMIN_CLAN = '德川家';
const MAJOR_CITIES=['edo','sunpu','nijo','osaka','nagoya'];
const FIELD_CAPTURE_CASTLES=['nijo','osaka','nagoya'];
const castleLevelLimit=id=>id==='edo'||id==='sunpu'?64:FIELD_CAPTURE_CASTLES.includes(id)?48:32;
const ORDINARY_TOKUGAWA_CLAN = '徳川家';
const WORLD_CLOCK_ID = 'world-v1';
const MAX_TURN = 999999999;
const WORLD_MONTH_MS = 60000;
const WORLD_CYCLE_MONTHS = 56 * 12;
const WORLD_CYCLE_MS = WORLD_CYCLE_MONTHS * WORLD_MONTH_MS;
const WELCOME = '戦国VSへようこそ。城を育て、仲間と語らい、天下統一を目指しましょう。';
const BASE_ORIGINS = new Set(['https://uni-tadayasu.github.io', 'https://www.kasai-solutions-inc.com', 'http://127.0.0.1:4173', 'null']);
const encoder = new TextEncoder();
const authenticatedRequests = new WeakMap();

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
async function readBody(request, limit = MAX_BODY) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail(415, 'JSON_REQUIRED', 'JSON形式で送信してください。');
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。');
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks = []; let size = 0;
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE', '送信内容が大きすぎます。'); }
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
  return hashBytes(encoder.encode(text));
}
async function hashBytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
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
async function adminRecoveryToken(secret,userId,requestId) {
  // The verified recovery key is never persisted. A purpose-separated HMAC lets
  // a lost-response retry recover the same per-device token without plaintext
  // credential storage or changes to any existing device's authentication.
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,encoder.encode('sengoku:admin-recovery:v1\u0000'+userId+'\u0000'+requestId));
  return btoa(String.fromCharCode(...new Uint8Array(signature))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
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
/* Structural validation for canvas-sized avatars, not an entropy decoder.
 * Source: ITU-T T.81 Annex B (SOF/SOS/tables) and Annex E (marker control).
 * https://www.w3.org/Graphics/JPEG/itu-t81.pdf
 * Only 8-bit Huffman sequential/progressive DCT, exactly 256 x 256, is accepted.
 */
function normalizeAvatarJpeg(input) {
  const invalid = () => { throw new Error('Invalid avatar JPEG'); };
  if (!(input instanceof Uint8Array) || input.length < 16 || input.length > 49152) invalid();
  if (input[0] !== 0xff || input[1] !== 0xd8 || input.at(-2) !== 0xff || input.at(-1) !== 0xd9) invalid();
  const chunks = [new Uint8Array([0xff, 0xd8])];
  const components = new Map(), quantization = new Map(), huffman = new Set();
  const sequentialSeen = new Set(), progressive = new Map();
  let position = 2, frame = 0, scans = 0, restartInterval = 0;
  const word = at => (input[at] << 8) | input[at + 1];
  const keep = (marker, start, end) => {
    chunks.push(new Uint8Array([0xff, marker]), input.subarray(start, end));
  };
  while (position < input.length) {
    if (input[position++] !== 0xff) invalid();
    // T.81 permits FF fill bytes before a marker; omit these non-image bytes.
    while (position < input.length && input[position] === 0xff) position++;
    if (position >= input.length) invalid();
    const marker = input[position++];
    if (marker === 0xd9) {
      if (position !== input.length || !frame || !scans) invalid();
      for (const id of components.keys()) {
        if (frame === 0xc0 ? !sequentialSeen.has(id) : progressive.get(id)[0] < 0) invalid();
      }
      chunks.push(new Uint8Array([0xff, 0xd9]));
      const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const output = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      return output;
    }
    // SOI, TEM, byte stuffing and restart markers are invalid between segments.
    if (marker === 0 || marker === 1 || marker === 0xd8 || marker >= 0xd0 && marker <= 0xd7) invalid();
    if (position + 2 > input.length) invalid();
    const start = position, length = word(position), end = position + length, payload = position + 2;
    if (length < 2 || end > input.length) invalid();
    // Remove every APP segment and COM, including EXIF/GPS, ICC, XMP, thumbnails,
    // Adobe metadata and user comments. No filename or metadata is returned.
    if (marker >= 0xe0 && marker <= 0xef || marker === 0xfe) { position = end; continue; }
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || scans || length < 8 || input[payload] !== 8 || word(payload + 1) !== 256 || word(payload + 3) !== 256) invalid();
      const count = input[payload + 5];
      if (![1, 3].includes(count) || length !== 8 + 3 * count) invalid();
      let blocks = 0;
      for (let i = 0; i < count; i++) {
        const at = payload + 6 + i * 3, id = input[at], h = input[at + 1] >> 4, v = input[at + 1] & 15, table = input[at + 2];
        if (components.has(id) || h < 1 || h > 4 || v < 1 || v > 4 || table > 3) invalid();
        if (count === 1 && (h !== 1 || v !== 1)) invalid();
        blocks += h * v; components.set(id, {table, index:i});
        progressive.set(id, new Int8Array(64).fill(-1));
      }
      if (blocks > 10) invalid();
      frame = marker; keep(marker, start, end); position = end; continue;
    }
    if (marker === 0xdb) {
      let at = payload, tables = 0;
      while (at < end) {
        const info = input[at++], precision = info >> 4, id = info & 15;
        if (precision > 1 || id > 3) invalid();
        const size = precision ? 128 : 64;
        if (at + size > end) invalid();
        for (let i = 0; i < 64; i++) if (precision ? word(at + i * 2) === 0 : input[at + i] === 0) invalid();
        at += size; tables++; quantization.set(id, precision);
      }
      if (!tables || at !== end) invalid();
      keep(marker, start, end); position = end; continue;
    }
    if (marker === 0xc4) {
      let at = payload, tables = 0;
      while (at < end) {
        const info = input[at++], kind = info >> 4, id = info & 15;
        if (kind > 1 || id > 3 || at + 16 > end) invalid();
        let symbols = 0, remainingCodes = 1;
        for (let i = 0; i < 16; i++) {
          const count = input[at + i]; symbols += count; remainingCodes = remainingCodes * 2 - count;
          // Oversubscribed/all-ones Huffman codes are not valid JPEG codes.
          if (remainingCodes <= 0) invalid();
        }
        at += 16;
        if (!symbols || symbols > 256 || at + symbols > end) invalid();
        const seen = new Set();
        for (let i = 0; i < symbols; i++) {
          const value = input[at + i];
          if (seen.has(value) || (kind === 0 ? value > 11 : (value & 15) > 10)) invalid();
          seen.add(value);
        }
        at += symbols; tables++; huffman.add(kind + ':' + id);
      }
      if (!tables || at !== end) invalid();
      keep(marker, start, end); position = end; continue;
    }
    if (marker === 0xdd) {
      if (length !== 4) invalid();
      restartInterval = word(payload); keep(marker, start, end); position = end; continue;
    }
    if (marker !== 0xda || !frame || length < 6) invalid();
    const count = input[payload];
    if (count < 1 || count > components.size || length !== 6 + count * 2) invalid();
    const selected = [], used = new Set(); let lastIndex = -1;
    for (let i = 0; i < count; i++) {
      const id = input[payload + 1 + i * 2], tables = input[payload + 2 + i * 2], component = components.get(id);
      if (!component || used.has(id) || component.index <= lastIndex || (tables >> 4) > 3 || (tables & 15) > 3 || !quantization.has(component.table)) invalid();
      if (frame === 0xc0 && quantization.get(component.table) !== 0) invalid();
      used.add(id); lastIndex = component.index; selected.push({id,dc:tables >> 4,ac:tables & 15});
    }
    const ss = input[payload + 1 + count * 2], se = input[payload + 2 + count * 2], approximation = input[payload + 3 + count * 2], ah = approximation >> 4, al = approximation & 15;
    if (frame === 0xc0) {
      if (ss !== 0 || se !== 63 || ah !== 0 || al !== 0) invalid();
      for (const component of selected) {
        if (sequentialSeen.has(component.id) || !huffman.has('0:' + component.dc) || !huffman.has('1:' + component.ac)) invalid();
        sequentialSeen.add(component.id);
      }
    } else {
      if (ss > se || se > 63 || (ss === 0 ? se !== 0 : count !== 1) || ah > 13 || al > 13 || ah !== 0 && al !== ah - 1) invalid();
      for (const component of selected) {
        if (ss === 0 && ah === 0 && !huffman.has('0:' + component.dc) || ss !== 0 && !huffman.has('1:' + component.ac)) invalid();
        const coefficients = progressive.get(component.id);
        if (ss !== 0 && coefficients[0] < 0) invalid();
        for (let i = ss; i <= se; i++) {
          if (ah === 0 ? coefficients[i] !== -1 : coefficients[i] !== ah) invalid();
          coefficients[i] = al;
        }
      }
    }
    scans++; keep(marker, start, end); position = end;
    const entropyStart = position; let dataBytes = 0, intervalBytes = 0, expectedRestart = 0, ended = false;
    while (position < input.length) {
      if (input[position] !== 0xff) { position++; dataBytes++; intervalBytes++; continue; }
      const markerStart = position++;
      while (position < input.length && input[position] === 0xff) position++;
      if (position >= input.length) invalid();
      const next = input[position];
      if (next === 0) {
        // FF00 is one entropy byte, not a marker. Repeated FF before stuffing
        // is deliberately rejected rather than interpreted inconsistently.
        if (position !== markerStart + 1) invalid();
        position++; dataBytes++; intervalBytes++; continue;
      }
      if (next >= 0xd0 && next <= 0xd7) {
        if (!restartInterval || !intervalBytes || next !== 0xd0 + expectedRestart) invalid();
        expectedRestart = (expectedRestart + 1) & 7; intervalBytes = 0; position++; continue;
      }
      if (!dataBytes || !intervalBytes) invalid();
      chunks.push(input.subarray(entropyStart, markerStart)); position = markerStart; ended = true; break;
    }
    if (!ended) invalid();
  }
  invalid();
}

// These private references exist only in response DTOs. Resolve them together
// after the route commits, never inside a save, receipt or immutable message.
const EVALUATION_PLAYER=Symbol('player-evaluation');
const evaluationRef=playerId=>typeof playerId==='string'&&playerId?{[EVALUATION_PLAYER]:playerId}:null;
const evaluationUpdates=ids=>[...new Set(ids.filter(Boolean))].map(playerId=>({playerId,evaluation:evaluationRef(playerId)}));
const publicBattle=battle=>({...battle,attackerEvaluation:evaluationRef(battle.attackerPlayerId),defenderEvaluation:evaluationRef(battle.defenderPlayerId)});
const publicLedger=receipt=>({...receipt,playerEvaluation:evaluationRef(receipt.playerId)});
function publicStaffBase(base){
  if(!base)return null;
  return {...base,jobs:base.jobs.map(job=>({...job,...(job.startedBy?{startedBy:{...job.startedBy,evaluation:evaluationRef(job.startedBy.id)}}:{})}))};
}
function evaluationState(row,meta,now){
  if(!row.save_json)return null;
  const clock=meta.clock_json?mapWorldClock(JSON.parse(meta.clock_json),now):null,staff=!!row.is_staff&&!row.is_admin;
  let raw=JSON.parse(row.save_json),restored=false;
  if(row.backup_active&&(!staff||row.backup_term!==row.staff_term)){
    raw=restorePersonalCampaign(normalizeGameSave(raw,{...row,is_admin:false,is_staff:true},now,{reading:true,clock}),{save_json:row.backup_json},row);
    restored=true;
  }
  const state=normalizeGameSave(raw,row,now,{reading:true,clock}).state;
  if(staff){
    const shared=meta.shared_json?JSON.parse(meta.shared_json):staffInitialState(clock?.elapsedMs||0);
    for(const job of shared.jobs.filter(job=>job.completesElapsedMs<=(clock?.elapsedMs||0)).sort((a,b)=>a.completesElapsedMs-b.completesElapsedMs)){
      if(job.kind==='castle')shared.castleLevel=job.targetLevel;else shared.buildings[job.id]=job.targetLevel;
    }
    state.buildings=copy(shared.buildings);state.castles.sunpu.level=shared.castleLevel;state.castles.sunpu.wall=shared.buildings.wall;
  }
  const savedCycle=row.cycle_index??Math.max(Number(meta.cycle_start||0),Math.floor((state.worldClock?.elapsedMs??state.turn*WORLD_MONTH_MS)/WORLD_CYCLE_MS));
  if(clock&&Number(savedCycle)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)){
    // Match the public field's pending-cycle view without advancing months,
    // granting rewards, changing leases or settling anyone's persisted save.
    let home=row.is_admin?'edo':staff?'sunpu':(restored?state.cycle?.home:row.cycle_home)||state.cycle?.home||state.home;
    if(!CASTLE_BY_ID[home]||!row.is_admin&&home==='edo'||!staff&&home==='sunpu')home=state.home;
    for(const [id,castle]of Object.entries(state.castles))if(id!==home&&castle.owner===state.clan)castle.owner='在地衆';
    state.castles[home].owner=state.clan;state.home=home;
  }
  return state;
}
async function resolvePlayerEvaluations(db,payload,now){
  const refs=[],ids=new Set(),nameRefs=[],avatarRefs=[],avatarIds=new Set(),skip=new Set(['save','state','entitlements','appearance']);
  const isPlayerId=id=>typeof id==='string'&&/^u_[A-Za-z0-9_]{1,96}$/.test(id);
  const avatarRef=(value,id,key='avatarVersion')=>{if(isPlayerId(id)){avatarRefs.push({value,id,key});avatarIds.add(id);}};
  function visit(value,parent,key){
    if(!value||typeof value!=='object')return;
    if(value[EVALUATION_PLAYER]){refs.push({parent,key,id:value[EVALUATION_PLAYER]});ids.add(value[EVALUATION_PLAYER]);return;}
    const playerId=value.playerId||value.userId||value.id;
    if(typeof value.name==='string'&&isPlayerId(playerId))nameRefs.push({value,id:playerId});
    avatarRef(value,playerId);
    for(const [idKey,versionKey]of [
      ['ownerId','ownerAvatarVersion'],['authorId','authorAvatarVersion'],
      ['targetPlayerId','targetAvatarVersion'],['attackerPlayerId','attackerAvatarVersion'],
      ['defenderPlayerId','defenderAvatarVersion'],['actorPlayerId','actorAvatarVersion']
    ])avatarRef(value,value[idKey],versionKey);
    if(typeof value.playerName==='string')avatarRef(value,value.playerId,'playerAvatarVersion');
    for(const [child,node]of Object.entries(value))if(!skip.has(child))visit(node,value,child);
  }
  visit(payload,null,null);if(!ids.size&&!nameRefs.length&&!avatarRefs.length)return payload;
  const selected=[...ids],queries=[stmt(db,`SELECT
    (SELECT json_object('base_elapsed_ms',base_elapsed_ms,'anchor_real_ms',anchor_real_ms,'running',running,'speed',speed,'revision',revision) FROM world_clock WHERE id=?) AS clock_json,
    (SELECT state_json FROM staff_base WHERE id='sunpu') AS shared_json,
    (SELECT value FROM settings WHERE key='cyclePolicyStart') AS cycle_start`,WORLD_CLOCK_ID)];
  for(let offset=0;offset<selected.length;offset+=80){
    const page=selected.slice(offset,offset+80);
    queries.push(stmt(db,`/* player-evaluation */ SELECT u.id,u.name,u.clan,ps.save_json,ps.cycle_index,ps.cycle_home,
      (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id AND NOT EXISTS(SELECT 1 FROM player_bans ban WHERE ban.user_id=u.id AND ban.active=1)) AS avatar_version,
      CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
      CASE WHEN sm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_staff,COALESCE(sm.term_id,'legacy:'||sm.appointed_at) AS staff_term,
      b.active AS backup_active,b.term_id AS backup_term,b.save_json AS backup_json
      FROM users u LEFT JOIN player_saves ps ON ps.user_id=u.id LEFT JOIN staff_members sm ON sm.user_id=u.id
      LEFT JOIN staff_campaign_backups b ON b.user_id=u.id WHERE u.id IN (${page.map(()=>'?').join(',')})`,...page));
  }
  const otherNames=[...new Set([...nameRefs.map(ref=>ref.id),...avatarIds])].filter(id=>!ids.has(id));
  for(let offset=0;offset<otherNames.length;offset+=80){const page=otherNames.slice(offset,offset+80);queries.push(stmt(db,`SELECT u.id,u.name,
    (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id AND NOT EXISTS(SELECT 1 FROM player_bans ban WHERE ban.user_id=u.id AND ban.active=1)) AS avatar_version
    FROM users u WHERE u.id IN (${page.map(()=>'?').join(',')})`,...page));}
  const results=await db.batch(queries),meta=rows(results[0])[0]||{},values=new Map(),names=new Map(),avatars=new Map(),empty=GameEngine.publicEvaluation(null,{officers:GAME_OFFICERS});
  for(const result of results.slice(1))for(const row of rows(result)){
    names.set(row.id,row.name);avatars.set(row.id,row.avatar_version||null);
    if(!ids.has(row.id))continue;
    if(!row.save_json){values.set(row.id,empty);continue;}
    let evaluation=null;
    try{evaluation=GameEngine.publicEvaluation(evaluationState(row,meta,now),{officers:GAME_OFFICERS});}catch{/* Unreadable saves remain unverified, not an invented demotion. */}
    values.set(row.id,evaluation);
  }
  for(const ref of refs){
    ref.parent[ref.key]=values.has(ref.id)?values.get(ref.id):null;
    // Refresh participant labels, including empty message deltas, without
    // rewriting historical receipts or user-authored message bodies.
    const nameField={evaluation:'name',ownerEvaluation:'ownerName',authorEvaluation:'authorName',attackerEvaluation:'attackerName',defenderEvaluation:'defenderName',targetEvaluation:'targetName',playerEvaluation:Object.hasOwn(ref.parent,'playerName')?'playerName':Object.hasOwn(ref.parent,'name')?'name':null}[ref.key];
    if(nameField&&names.has(ref.id))ref.parent[nameField]=names.get(ref.id);
  }
  for(const ref of nameRefs)if(names.has(ref.id))ref.value.name=names.get(ref.id);
  // Project current photos into every participant surface, including empty
  // chat/letter deltas and immutable historical receipts. Null also clears a
  // previously displayed photo after deletion, missing accounts or a BAN.
  for(const ref of avatarRefs)ref.value[ref.key]=avatars.get(ref.id)||null;
  return payload;
}

function mapUser(row, now = Date.now()) {
  return {
    id: row.id, name: row.name, clan: publicClan(row.clan,row.is_admin,row.is_staff,row.personal_clan), isAdmin: !!row.is_admin, isStaff: !!row.is_staff && !row.is_admin,
    avatarVersion: row.avatar_version || null,evaluation:evaluationRef(row.id),
    guildId: row.guild_id || null, guildName: row.guild_name || null,
    guildRole: row.guild_id ? (row.owner_id === row.id ? 'owner' : row.is_guild_officer ? 'officer' : 'member') : null,
    online: !row.ban_active && row.presence_seen !== null && row.presence_seen !== undefined && Number(row.presence_seen) > now - ONLINE_WINDOW,
  };
}
function publicClan(clan,isAdmin,isStaff=false,personalClan=null) { return isAdmin||isStaff?ADMIN_CLAN:clan===ADMIN_CLAN?CLAN_HOMES[personalClan]?personalClan:ORDINARY_TOKUGAWA_CLAN:clan; }

// Authorization uses database rows. Public presentation never reveals another
// player's site privileges; self identity and authorized management routes keep
// their controls. Save contents and role entitlements are private, not projected.
function publicIdentities(payload,request){
  const path=new URL(request.url).pathname.slice(API.length),actor=authenticatedRequests.get(request);
  const management=!!(actor&&(actor.is_admin&&path.startsWith('/admin/')||(actor.is_admin||actor.is_staff)&&path.startsWith('/staff/')));
  const linked=['/session','/devices/link','/admin/recover'].includes(path)&&typeof payload?.token==='string';
  const self=payload?.user&&(payload.user.id===actor?.id||linked)?payload.user:null;
  const privateKeys=new Set(['save','state','entitlements','staffBase']);
  const roleKeys=new Set(['isAdmin','isStaff','isOperator','is_admin','is_staff','is_operator','staffTitle','siteRole','roleTitle','operatorProtected','staffProtected','adminPlayerId','adminUserId','operatorPlayerId','operatorUserId']);
  function visit(value){
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(visit);
    const visibleRoles=management||value===self,result={};
    for(const [key,child]of Object.entries(value)){
      if(!visibleRoles&&(roleKeys.has(key)||key==='role'&&['admin','staff','operator'].includes(child)))continue;
      // Only the authenticated account's top-level snapshot is private. A
      // public history entry named "state" or "save" must still be projected.
      const privateSnapshot=value===payload&&(self||management)&&privateKeys.has(key);
      result[key]=key==='clan'&&child===ADMIN_CLAN&&!visibleRoles?ORDINARY_TOKUGAWA_CLAN:privateSnapshot?child:visit(child);
    }
    if(!management&&value.kind==='staff-building'){
      result.kind='building';
      result.title=`${value.targetName||'拠点'} Lv.${value.value}の普請を達成`;
      result.detail='拠点の成長が反映されました。';
    }
    return result;
  }
  return visit(payload);
}
const USER_SELECT = `SELECT u.id,u.name,u.clan,u.last_seen,gm.guild_id,g.name AS guild_name,g.owner_id,
  COALESCE((SELECT active FROM player_bans pb WHERE pb.user_id=u.id),0) AS ban_active,
  COALESCE((SELECT revision FROM player_bans pb WHERE pb.user_id=u.id),0) AS moderation_epoch,
  (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id) AS avatar_version,
  EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=u.id AND go.guild_id=gm.guild_id) AS is_guild_officer,
  (SELECT MAX(p.last_seen) FROM player_presence p WHERE p.user_id=u.id AND p.online=1) AS presence_seen,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan,
  (SELECT json_extract(b.save_json,'$.state.home') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_home,
  (SELECT json_extract(b.save_json,'$.state.castles.'||json_extract(b.save_json,'$.state.home')) FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_castle_json,
  (SELECT json_extract(sb.state_json,'$.castleLevel') FROM staff_base sb WHERE sb.id='sunpu') AS staff_castle_level,
  (SELECT json_extract(sb.state_json,'$.buildings.wall') FROM staff_base sb WHERE sb.id='sunpu') AS staff_wall,
  EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  (SELECT COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=u.id) AS staff_term,
  (SELECT sm.appointed_elapsed_ms FROM staff_members sm WHERE sm.user_id=u.id) AS staff_since_ms
  FROM users u LEFT JOIN guild_members gm ON gm.user_id=u.id LEFT JOIN guilds g ON g.id=gm.guild_id`;
async function getUser(db, id) { return stmt(db, USER_SELECT + ' WHERE u.id=?', id).first(); }
function accountCommitGuard(user){return {sql:"NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=? AND active=1) AND COALESCE((SELECT revision FROM player_bans WHERE user_id=?),0)=?",args:[user.id,user.id,Number(user.moderation_epoch||0)]};}
async function requireAccountAccess(db,user){const row=await stmt(db,'SELECT active,revision FROM player_bans WHERE user_id=?',user.id).first();if(row?.active)fail(403,'ACCOUNT_BANNED','この領主のオンライン利用は停止されています。解除後に再接続できます。');if(Number(row?.revision||0)!==Number(user.moderation_epoch||0))fail(409,'ACCOUNT_ACCESS_CHANGED','この領主の利用状態が変更されました。最新の接続状態を確認してください。');}
function contentRevisionInput(url){const raw=url.searchParams.get('contentRevision');if(raw===null)return 0;if(!/^\d{1,16}$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail(400,'INVALID_CURSOR','投稿の更新番号が正しくありません。');return Number(raw);}
function avatarBucket(env) {
  if(!env.BUCKET?.put||!env.BUCKET?.get||!env.BUCKET?.delete)fail(503,'AVATAR_STORAGE_UNAVAILABLE','写真の保存サービスの準備中です。少し時間をおいて再度お試しください。');
  return env.BUCKET;
}
function decodeAvatarImage(body) {
  if(Object.keys(body).length!==1||typeof body.image!=='string'||!body.image.length)fail(400,'INVALID_AVATAR','256×256のJPEG写真を選択してください。');
  const encoded=body.image;
  if(encoded.length>Math.ceil(MAX_AVATAR_BYTES/3)*4)fail(413,'AVATAR_TOO_LARGE','写真は48KiB以内にしてください。');
  if(encoded.length%4!==0||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded))fail(400,'INVALID_AVATAR','写真の送信形式が正しくありません。');
  let binary;
  try{binary=atob(encoded);}catch{fail(400,'INVALID_AVATAR','写真の送信形式が正しくありません。');}
  if(btoa(binary)!==encoded)fail(400,'INVALID_AVATAR','写真の送信形式が正しくありません。');
  if(binary.length>MAX_AVATAR_BYTES)fail(413,'AVATAR_TOO_LARGE','写真は48KiB以内にしてください。');
  try{return normalizeAvatarJpeg(Uint8Array.from(binary,c=>c.charCodeAt(0)));}
  catch{fail(400,'INVALID_AVATAR','256×256のJPEG写真を選択してください。');}
}
async function removeAvatarObject(bucket,key) {
  if(!key)return;
  // Metadata already stopped referring to this unique key. A bounded retry can
  // clear a transient storage failure without making a newer photo inaccessible.
  for(let attempt=0;attempt<2;attempt++)try{await bucket.delete(key);return;}catch{}
}
async function putAvatar(request,env,user,now) {
  const db=env.DB,bucket=avatarBucket(env);
  await budget(db,'avatar-write:'+user.id,10,10*60*1000,now);
  const bytes=decodeAvatarImage(await readBody(request,MAX_AVATAR_BODY)),version=await hashBytes(bytes);
  // Every upload uses a new key, even for the same image hash. An older request's
  // cleanup therefore cannot delete a concurrent replacement's current object.
  const key='avatars/'+user.id+'/'+crypto.randomUUID()+'.jpg';
  try{const uploaded=await bucket.put(key,bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'no-store'}});if(!uploaded)throw new Error('Avatar upload incomplete');}
  catch{await removeAvatarObject(bucket,key);fail(503,'AVATAR_STORAGE_UNAVAILABLE','写真を保存できませんでした。少し時間をおいて再度お試しください。');}
  let result;
  try {
    const access=accountCommitGuard(user);
    result=await db.batch([
      stmt(db,'SELECT object_key FROM user_avatars WHERE user_id=?',user.id),
      stmt(db,`INSERT INTO user_avatars(user_id,version,object_key,content_type,byte_length,updated_at)
        SELECT ?,?,?,'image/jpeg',?,? WHERE ${access.sql} ON CONFLICT(user_id) DO UPDATE SET
        version=excluded.version,object_key=excluded.object_key,content_type=excluded.content_type,
        byte_length=excluded.byte_length,updated_at=excluded.updated_at RETURNING object_key`,user.id,version,key,bytes.length,now,...access.args),
    ]);
    if(!rows(result[1]).length)await requireAccountAccess(db,user);
  } catch(error) {
    // A network failure can happen after D1 committed. Never remove an object
    // that might already be the account's current image; retain it if uncertain.
    try{const current=await stmt(db,'SELECT object_key FROM user_avatars WHERE user_id=?',user.id).first();if(current?.object_key!==key)await removeAvatarObject(bucket,key);}catch{}
    throw error;
  }
  await removeAvatarObject(bucket,rows(result[0])[0]?.object_key);
  return {ok:true,user:mapUser(await getUser(db,user.id),now)};
}
async function deleteAvatar(request,env,user,now) {
  const db=env.DB,bucket=avatarBucket(env);
  await budget(db,'avatar-write:'+user.id,10,10*60*1000,now);
  if(request.body!==null&&Object.keys(await readBody(request)).length)fail(400,'INVALID_AVATAR','写真の削除には追加の情報は不要です。');
  const access=accountCommitGuard(user),removed=await stmt(db,'DELETE FROM user_avatars WHERE user_id=? AND '+access.sql+' RETURNING object_key',user.id,...access.args).first();
  await requireAccountAccess(db,user);
  await removeAvatarObject(bucket,removed?.object_key);
  return {ok:true,user:mapUser(await getUser(db,user.id),now)};
}
async function getAvatar(request,env,origin) {
  const url=new URL(request.url),id=url.pathname.slice((API+'/avatars/').length),version=url.searchParams.get('v');
  if(!/^[A-Za-z0-9_-]{1,90}$/.test(id)||version!==null&&!/^[0-9a-f]{64}$/.test(version))fail(400,'INVALID_AVATAR','写真の識別子が正しくありません。');
  const db=env.DB;
  if(!db?.prepare)fail(503,'SERVICE_UNAVAILABLE','通信サービスの準備中です。');
  const current=await stmt(db,'SELECT version,object_key,byte_length FROM user_avatars WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=user_avatars.user_id AND active=1)',id).first();
  if(!current||version!==null&&version!==current.version)fail(404,'AVATAR_NOT_FOUND','この写真は現在使用されていません。');
  const bucket=avatarBucket(env);let object;
  try{object=await bucket.get(current.object_key);}catch{fail(503,'AVATAR_STORAGE_UNAVAILABLE','写真を読み込めませんでした。少し時間をおいて再度お試しください。');}
  if(!object?.body||Number(object.size)!==Number(current.byte_length))fail(404,'AVATAR_NOT_FOUND','この写真は現在使用されていません。');
  // Re-check after the asynchronous object read so deletion/replacement during
  // that read cannot expose the superseded image through an old version URL.
  const latest=await stmt(db,'SELECT object_key FROM user_avatars WHERE user_id=? AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=user_avatars.user_id AND active=1)',id).first();
  if(latest?.object_key!==current.object_key){await object.body.cancel();fail(404,'AVATAR_NOT_FOUND','この写真は現在使用されていません。');}
  const headers=new Headers({'Content-Type':'image/jpeg','Content-Length':String(current.byte_length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; sandbox; base-uri 'none'; frame-ancestors 'none'",'Vary':'Origin'});
  if(origin!==null)headers.set('Access-Control-Allow-Origin',origin);
  return new Response(object.body,{status:200,headers});
}
async function authenticate(request, db, now) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (!match) fail(401, 'AUTH_REQUIRED', '通信プレイヤーを登録してからご利用ください。');
  const tokenHash = await hash(match[1]);
  const row = await stmt(db, USER_SELECT + ' WHERE u.token_hash=? OR u.id=(SELECT user_id FROM user_sessions WHERE token_hash=? AND revoked_at IS NULL)', tokenHash, tokenHash).first();
  if (!row) fail(401, 'INVALID_TOKEN', '通信プレイヤーの認証に失敗しました。保存済みの接続データをご確認ください。');
  if(row.ban_active)fail(403,'ACCOUNT_BANNED','この領主のオンライン利用は停止されています。解除後に再接続できます。');
  if (Number(row.last_seen) <= now - 60000) {
    const access=accountCommitGuard(row);await stmt(db, 'UPDATE users SET last_seen=? WHERE id=? AND last_seen<=? AND '+access.sql, now, row.id, now - 60000,...access.args).run();
    row.last_seen = now;
  }
  await requireAccountAccess(db,row);
  authenticatedRequests.set(request,row);
  return row;
}
function requireAdmin(user) { if (!user.is_admin) fail(403, 'ADMIN_REQUIRED', 'この機能を利用する権限がありません。'); }
function requireStaffChat(user) { if(!user.is_admin&&!user.is_staff)fail(403,'STAFF_CHAT_REQUIRED','この会話を利用する権限がありません。'); }
function requireStaff(user) { if(!user.is_admin&&!user.is_staff)fail(403,'STAFF_REQUIRED','この一覧を表示する権限がありません。'); }
const STAFF_CHAT_GUARD="(EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?) OR EXISTS(SELECT 1 FROM staff_members WHERE user_id=?))";
function recentLoginCursor(value,now) {
  const invalid=()=>fail(400,'INVALID_CURSOR','接続一覧の続きが無効です。最初から読み込み直してください。');
  if(typeof value!=='string'||value.length>512||!/^[A-Za-z0-9_-]+$/.test(value))invalid();
  let cursor;try{cursor=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));}catch(_){invalid();}
  if(!Array.isArray(cursor)||cursor.length!==4||cursor[0]!==1||!Number.isSafeInteger(cursor[1])||cursor[1]<now-RECENT_LOGIN_WINDOW||cursor[1]>now||!Number.isSafeInteger(cursor[2])||cursor[2]<0||cursor[2]>cursor[1]||typeof cursor[3]!=='string'||!/^[A-Za-z0-9_-]{1,90}$/.test(cursor[3]))invalid();
  return{asOf:cursor[1],lastSeen:cursor[2],id:cursor[3]};
}
const encodeRecentLoginCursor=(asOf,lastSeen,id)=>btoa(JSON.stringify([1,asOf,lastSeen,id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
async function recentLogins(db,user,url,now) {
  requireStaff(user);
  const limitText=url.searchParams.get('limit')??'50';
  if(!/^[1-9][0-9]?$/.test(limitText)||Number(limitText)>50)fail(400,'INVALID_INPUT','一覧の件数は1〜50件で指定してください。');
  const limit=Number(limitText),rawCursor=url.searchParams.get('cursor'),cursor=rawCursor===null?null:recentLoginCursor(rawCursor,now),asOf=cursor?.asOf??now,windowStart=now-RECENT_LOGIN_WINDOW;
  const continuation=cursor?' AND (u.last_seen<? OR (u.last_seen=? AND u.id>?))':'';
  const params=[windowStart,asOf,user.id,user.id,...(cursor?[cursor.lastSeen,cursor.lastSeen,cursor.id]:[]),limit+1];
  // Authorization and both projections share one D1 transaction. Every data
  // SELECT independently checks the live role, including revocation after auth.
  const result=await db.batch([
    stmt(db,'SELECT 1 AS allowed WHERE '+STAFF_CHAT_GUARD,user.id,user.id),
    stmt(db,USER_SELECT+' WHERE u.last_seen>=? AND u.last_seen<=? AND '+STAFF_CHAT_GUARD+continuation+' ORDER BY u.last_seen DESC,u.id ASC LIMIT ?',...params),
    stmt(db,'SELECT COUNT(*) AS count FROM users WHERE last_seen>=? AND last_seen<=? AND '+STAFF_CHAT_GUARD,windowStart,asOf,user.id,user.id),
  ]);
  if(!rows(result[0]).length)fail(403,'STAFF_REQUIRED','この一覧を表示する権限がありません。');
  const found=rows(result[1]),page=found.slice(0,limit),players=page.map(row=>({...mapUser(row,now),lastSeen:iso(row.last_seen)})),last=page.at(-1);
  return{ok:true,players,total:Number(rows(result[2])[0]?.count||0),serverNow:iso(now),windowStart:iso(windowStart),nextCursor:found.length>limit?encodeRecentLoginCursor(asOf,Number(last.last_seen),last.id):null};
}
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
  if (channel === 'admin') { requireStaffChat(user); return 'admin'; }
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
  return {id:Number(row.id),userId:row.user_id,name:row.name,avatarVersion:row.avatar_version||null,text:row.body,createdAt:iso(row.created_at),isAdmin:!!row.is_admin,isStaff:!!row.is_staff&&!row.is_admin,evaluation:evaluationRef(row.user_id)};
}
const MESSAGE_SELECT = `SELECT m.id,m.user_id,m.body,m.created_at,u.name,
 (SELECT a.version FROM user_avatars a WHERE a.user_id=m.user_id) AS avatar_version,
 CASE WHEN m.user_id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
 EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=m.user_id) AS is_staff
 FROM messages m JOIN users u ON u.id=m.user_id`;
const GUILD_SELECT = `SELECT g.id,g.name,g.owner_id,u.name AS owner_name,g.created_at,
 (SELECT COUNT(*) FROM guild_members gm WHERE gm.guild_id=g.id) AS member_count FROM guilds g JOIN users u ON u.id=g.owner_id`;
function mapGuild(row) { return {id:row.id,name:row.name,ownerId:row.owner_id,ownerName:row.owner_name,ownerEvaluation:evaluationRef(row.owner_id),memberCount:Number(row.member_count),maxMembers:MAX_GUILD_MEMBERS,createdAt:iso(row.created_at)}; }
const GUILD_MEMBER_GUARD='EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=?)';
const GUILD_ASSETS=['gold','rice','wood','stone','magatama'];
const GUILD_ASSET_NAMES={gold:'金',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
const GUILD_ASSET_LIMIT=999999999;
const GUILD_ASSET_COMMIT='EXISTS(SELECT 1 FROM guild_asset_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const GUILD_ROLE_COMMIT='EXISTS(SELECT 1 FROM guild_role_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
function requireGuild(user,guildId) {
  if(!user.guild_id||guildId&&user.guild_id!==guildId)fail(403,'GUILD_REQUIRED','現在所属しているギルドで操作してください。');
}
function guildRoleAllowed(user,action) { return user.owner_id===user.id||action==='remove'&&!!user.is_guild_officer; }
function requireGuildRole(user,action) {
  if(!guildRoleAllowed(user,action))fail(403,'GUILD_ROLE_REQUIRED','この操作に必要なギルド役職がありません。');
}
function mapTreasury(row) { return {...Object.fromEntries(GUILD_ASSETS.map(key=>[key,Number(row?.[key]||0)])),revision:Number(row?.revision||0)}; }
function pageLimit(url,max=50) {
  const value=url.searchParams.get('limit')??String(max);
  if(!/^[1-9][0-9]?$/.test(value)||Number(value)>max)fail(400,'INVALID_INPUT','一度に取得する件数は1〜'+max+'件で指定してください。');
  return Number(value);
}
function encodeGuildCursor(kind,value,id) { return btoa(JSON.stringify([kind,value,id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function guildCursor(value,kind,max) {
  if(value===null)return null;
  let cursor;try{if(!/^[A-Za-z0-9_-]{1,512}$/.test(value))throw new Error();cursor=JSON.parse(atob(value.replaceAll('-','+').replaceAll('_','/')));}catch{fail(400,'INVALID_CURSOR','読み込み位置を確認して、一覧を更新してください。');}
  if(!Array.isArray(cursor)||cursor.length!==3||cursor[0]!==kind||!Number.isSafeInteger(cursor[1])||cursor[1]<0||cursor[1]>max||typeof cursor[2]!=='string'||!/^[A-Za-z0-9_-]{1,90}$/.test(cursor[2]))fail(400,'INVALID_CURSOR','読み込み位置を確認して、一覧を更新してください。');
  return {value:cursor[1],id:cursor[2]};
}
async function guildSnapshot(db,user,now,guildId=null) {
  const current=await getUser(db,user.id);if(guildId)requireGuild(current,guildId);
  const id=current.guild_id;
  if(!id)return {ok:true,user:mapUser(current,now),guild:null,members:[]};
  const result=await db.batch([
    stmt(db,'SELECT 1 AS allowed WHERE '+GUILD_MEMBER_GUARD,user.id,id),
    stmt(db,GUILD_SELECT+' WHERE g.id=? AND '+GUILD_MEMBER_GUARD,id,user.id,id),
    stmt(db,USER_SELECT+' WHERE gm.guild_id=? AND '+GUILD_MEMBER_GUARD+' ORDER BY gm.joined_at,u.id',id,user.id,id),
  ]);
  if(!rows(result[0]).length)fail(403,'GUILD_REQUIRED','ギルドの所属が変更されました。接続を更新してください。');
  return {ok:true,user:mapUser(current,now),guild:rows(result[1])[0]?mapGuild(rows(result[1])[0]):null,members:rows(result[2]).map(row=>mapUser(row,now))};
}
async function ensureTreasury(db,guildId) {
  await stmt(db,'INSERT INTO guild_treasuries(guild_id) SELECT id FROM guilds WHERE id=? ON CONFLICT(guild_id) DO NOTHING',guildId).run();
  return stmt(db,'SELECT * FROM guild_treasuries WHERE guild_id=?',guildId).first();
}
async function readTreasury(db,user,url,now) {
  requireGuild(user);const guildId=user.guild_id,limit=pageLimit(url),cursor=guildCursor(url.searchParams.get('cursor'),'ledger',now);
  await ensureTreasury(db,guildId);
  const after=cursor?' AND (created_at<? OR (created_at=? AND id<?))':'';
  const result=await db.batch([
    stmt(db,'SELECT * FROM guild_treasuries WHERE guild_id=? AND '+GUILD_MEMBER_GUARD,guildId,user.id,guildId),
    stmt(db,'SELECT id,result_json,created_at FROM guild_asset_requests WHERE guild_id=? AND '+GUILD_MEMBER_GUARD+after+' ORDER BY created_at DESC,id DESC LIMIT ?',guildId,user.id,guildId,...(cursor?[cursor.value,cursor.value,cursor.id]:[]),limit+1),
  ]);
  const treasury=rows(result[0])[0];if(!treasury)fail(403,'GUILD_REQUIRED','現在所属しているギルドで操作してください。');
  const found=rows(result[1]),page=found.slice(0,limit),last=page.at(-1);
  return {ok:true,guildId,treasury:mapTreasury(treasury),ledger:page.map(row=>publicLedger(JSON.parse(row.result_json))),nextCursor:found.length>limit?encodeGuildCursor('ledger',Number(last.created_at),last.id):null,serverNow:iso(now)};
}
async function priorGuildTransfer(db,user,body,digest) {
  const prior=await stmt(db,'SELECT * FROM guild_asset_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();
  if(prior&&prior.payload_hash!==digest)fail(409,'REQUEST_ID_REUSED','その操作番号は別の入出庫に使われています。');
  return prior;
}
async function guildTransferResult(db,user,body,receipt,idempotent,now) {
  const current=await getUser(db,user.id);requireGuild(current,body.guildId);
  const treasury=await stmt(db,'SELECT * FROM guild_treasuries WHERE guild_id=? AND '+GUILD_MEMBER_GUARD,body.guildId,user.id,body.guildId).first();
  if(!treasury)fail(403,'GUILD_REQUIRED','ギルドの所属が変更されました。');
  return {...await syncSnapshot(db,await getSyncRow(db,user.id),current,body.deviceId,now),guildId:body.guildId,receipt:publicLedger(receipt),treasury:mapTreasury(treasury),idempotent};
}
async function guildTransfer(db,user,raw,now) {
  if(Object.keys(raw).some(key=>!['guildId','direction','resource','amount','requestId','deviceId','expectedRevision'].includes(key)))fail(400,'INVALID_INPUT','入出庫の情報が正しくありません。');
  const body={...raw,guildId:idField(raw.guildId,'ギルド'),requestId:idField(raw.requestId,'操作番号'),deviceId:idField(raw.deviceId,'端末')};
  if(!['deposit','withdraw'].includes(body.direction)||!GUILD_ASSETS.includes(body.resource)||!Number.isSafeInteger(body.amount)||body.amount<1||body.amount>1000000||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail(400,'INVALID_INPUT','入出庫は対応する資産を1〜1,000,000の整数で指定してください。');
  requireGuild(user,body.guildId);
  const digest=await hash(JSON.stringify([user.id,body.guildId,body.direction,body.resource,body.amount]));
  const prior=await priorGuildTransfer(db,user,body,digest);if(prior)return guildTransferResult(db,user,body,JSON.parse(prior.result_json),true,now);
  await budget(db,'guild-transfer:'+user.id,30,60000,now);
  const row=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);
  const clock=await getWorldClock(db,now),save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}),state=save.state;
  if(!state.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','先に共通時計へ同期してください。');
  if(clock.elapsedMs-state.worldClock.elapsedMs>15000)fail(409,'CLOCK_STALE','共通時計と本拠を同期してから入出庫してください。');
  const treasury=await ensureTreasury(db,body.guildId);if(!treasury)fail(403,'GUILD_REQUIRED','ギルドの所属が変更されました。');
  const key=body.resource,personal=key==='magatama'?state.magatama:state.resources[key],pooled=Number(treasury[key]),deposit=body.direction==='deposit',delta=deposit?-body.amount:body.amount;
  if(deposit?personal<body.amount:pooled<body.amount)fail(409,'INSUFFICIENT_ASSETS',deposit?'手持ちの資産が足りません。':'ギルドの共有資産が足りません。');
  if(personal+delta>GUILD_ASSET_LIMIT||pooled-delta>GUILD_ASSET_LIMIT)fail(409,'ASSET_LIMIT','保管できる資産の上限を超えます。');
  if(key==='magatama')state.magatama=personal+delta;else state.resources[key]=personal+delta;
  state.log.unshift({turn:state.turn,text:`${user.guild_name}の共有資産へ${GUILD_ASSET_NAMES[key]}${body.amount.toLocaleString('ja-JP')}を${deposit?'納入':'受取'}。`,kind:'guild'});state.log=state.log.slice(0,200);save.savedAt=iso(now);
  const normalized=normalizeGameSave(save,user,now,{clock}),serialized=JSON.stringify(normalized),nonce=crypto.randomUUID(),id=uid('gt_');
  const receipt={id,requestId:body.requestId,guildId:body.guildId,playerId:user.id,name:user.name,direction:body.direction,resource:key,amount:body.amount,createdAt:iso(now),worldElapsedMs:clock.elapsedMs,playerRevision:Number(row.revision)+1,treasuryRevision:Number(treasury.revision)+1};
  const guard=[user.id,body.requestId,nonce],roleGuard=roleCommitGuard(user);
  const result=await db.batch([
    stmt(db,`INSERT INTO guild_asset_requests(id,actor_id,request_id,guild_id,payload_hash,commit_token,direction,resource,amount,result_json,created_at,world_elapsed_ms)
      SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE EXISTS(
        SELECT 1 FROM player_saves s JOIN guild_members gm ON gm.user_id=s.user_id
        JOIN guild_treasuries t ON t.guild_id=gm.guild_id
        WHERE s.user_id=? AND gm.guild_id=? AND s.revision=? AND s.writer_device_id=? AND s.lease_expires_at>?
        AND t.revision=? AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)
        AND ${roleGuard.sql})
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING id`,id,user.id,body.requestId,body.guildId,digest,nonce,body.direction,key,body.amount,JSON.stringify(receipt),now,clock.elapsedMs,user.id,body.guildId,body.expectedRevision,body.deviceId,now,Number(treasury.revision),WORLD_CLOCK_ID,clock.revision,...roleGuard.args),
    stmt(db,'UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND '+GUILD_ASSET_COMMIT,serialized,now,now+SYNC_LEASE,user.id,...guard),
    stmt(db,'UPDATE guild_treasuries SET '+key+'=?,revision=revision+1 WHERE guild_id=? AND '+GUILD_ASSET_COMMIT,pooled-delta,body.guildId,...guard),
    stmt(db,"UPDATE users SET clan=CASE WHEN EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=users.id) AND users.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN clan ELSE ? END WHERE id=? AND "+GUILD_ASSET_COMMIT,normalized.state.clan,user.id,...guard),
  ]);
  if(!rows(result[0]).length) {
    const concurrent=await priorGuildTransfer(db,user,body,digest);if(concurrent)return guildTransferResult(db,user,body,JSON.parse(concurrent.result_json),true,now);
    const current=await getUser(db,user.id);requireGuild(current,body.guildId);
    fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);
    if(!!current.is_admin!==!!user.is_admin||current.staff_term!==user.staff_term)fail(409,'AUTHORITY_CHANGED','領主の役職が更新されました。同期してからお試しください。');
    if((await getWorldClock(db,now)).revision!==clock.revision)fail(409,'WORLD_CLOCK_CHANGED','共通時計を確認してからお試しください。');
    fail(409,'TREASURY_CONFLICT','共有資産が更新されました。残高を更新してからお試しください。');
  }
  return guildTransferResult(db,user,body,receipt,false,now);
}
async function guildManage(db,user,raw,remove,now) {
  if(Object.keys(raw).some(key=>!(remove?['guildId','targetPlayerId','requestId']:['guildId','targetPlayerId','role','requestId']).includes(key)))fail(400,'INVALID_INPUT','ギルド役職の指定が正しくありません。');
  const guildId=idField(raw.guildId,'ギルド'),targetId=idField(raw.targetPlayerId,'対象の領主'),requestId=idField(raw.requestId,'操作番号'),action=remove?'remove':raw.role;
  if(!['officer','member','remove'].includes(action)||!remove&&action==='remove')fail(400,'INVALID_INPUT','副盟主またはメンバーを指定してください。');
  requireGuild(user,guildId);requireGuildRole(user,action);
  if(targetId===user.id)fail(400,'INVALID_TARGET','自分自身の役職変更・除名はできません。');
  const lookup=()=>stmt(db,'SELECT * FROM guild_role_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();
  const matches=prior=>{if(prior&&(prior.guild_id!==guildId||prior.target_id!==targetId||prior.action!==action))fail(409,'REQUEST_ID_REUSED','その操作番号は別のギルド操作に使われています。');return prior;};
  if(matches(await lookup()))return {...await guildSnapshot(db,user,now,guildId),idempotent:true};
  const target=await getUser(db,targetId);if(!target||target.guild_id!==guildId)fail(404,'GUILD_MEMBER_NOT_FOUND','対象の領主はこのギルドに所属していません。');
  if(target.owner_id===target.id||action==='remove'&&user.owner_id!==user.id&&target.is_guild_officer)fail(403,'GUILD_ROLE_REQUIRED','この役職のメンバーは変更・除名できません。');
  const already=!remove&&(action==='officer')===!!target.is_guild_officer;
  await budget(db,'guild-manage:'+user.id,30,60000,now);const nonce=crypto.randomUUID(),guard=[user.id,requestId,nonce],access=accountCommitGuard(user);
  const changes=[
    stmt(db,`INSERT INTO guild_role_requests(actor_id,request_id,guild_id,target_id,action,commit_token,created_at)
      SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM guilds g
        JOIN guild_members actor ON actor.guild_id=g.id AND actor.user_id=?
        JOIN guild_members target ON target.guild_id=g.id AND target.user_id=?
        WHERE g.id=? AND target.user_id<>g.owner_id AND target.user_id<>actor.user_id
        AND (g.owner_id=? OR (?='remove'
          AND EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=actor.user_id AND go.guild_id=g.id)
          AND NOT EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=target.user_id AND go.guild_id=g.id)))) AND ${access.sql}
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,guildId,targetId,action,nonce,now,user.id,targetId,guildId,user.id,action,...access.args),
  ];
  if(action==='officer')changes.push(stmt(db,'INSERT INTO guild_officers(user_id,guild_id,appointed_by,appointed_at) SELECT ?,?,?,? WHERE '+GUILD_ROLE_COMMIT+' ON CONFLICT(user_id) DO NOTHING',targetId,guildId,user.id,now,...guard));
  else changes.push(stmt(db,'DELETE FROM guild_officers WHERE user_id=? AND guild_id=? AND '+GUILD_ROLE_COMMIT,targetId,guildId,...guard));
  if(remove)changes.push(stmt(db,'DELETE FROM guild_members WHERE user_id=? AND guild_id=? AND '+GUILD_ROLE_COMMIT,targetId,guildId,...guard));
  const result=await db.batch(changes);
  if(!rows(result[0]).length){if(matches(await lookup()))return {...await guildSnapshot(db,user,now,guildId),idempotent:true};const current=await getUser(db,user.id);requireGuild(current,guildId);requireGuildRole(current,action);fail(409,'GUILD_CHANGED','ギルドの役職または所属が変わりました。一覧を更新してください。');}
  return {...await guildSnapshot(db,user,now,guildId),idempotent:already};
}
async function guildLeave(db,user,body,now) {
  if(body.guildId!==undefined)requireGuild(user,idField(body.guildId,'ギルド'));
  if(!user.guild_id)return {ok:true,user:mapUser(user,now)};
  const guildId=user.guild_id,empty='NOT EXISTS(SELECT 1 FROM guild_treasuries WHERE guild_id=? AND (gold>0 OR rice>0 OR wood>0 OR stone>0 OR magatama>0))',access=accountCommitGuard(user);
  const result=await db.batch([
    stmt(db,`UPDATE guilds SET owner_id=(SELECT gm.user_id FROM guild_members gm WHERE gm.guild_id=? AND gm.user_id<>?
      ORDER BY EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=gm.user_id AND go.guild_id=gm.guild_id) DESC,gm.joined_at,gm.user_id LIMIT 1)
      WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM guild_members WHERE guild_id=? AND user_id<>?) AND ${access.sql}`,guildId,user.id,guildId,user.id,guildId,user.id,...access.args),
    stmt(db,'DELETE FROM guild_members WHERE user_id=? AND guild_id=? AND (EXISTS(SELECT 1 FROM guild_members other WHERE other.guild_id=? AND other.user_id<>?) OR '+empty+') AND '+access.sql+' RETURNING user_id',user.id,guildId,guildId,user.id,guildId,...access.args),
    stmt(db,'DELETE FROM guilds WHERE id=? AND NOT EXISTS(SELECT 1 FROM guild_members WHERE guild_id=?) AND '+empty+' AND '+access.sql,guildId,guildId,guildId,...access.args),
  ]);
  const current=await getUser(db,user.id);
  if(!rows(result[1]).length&&current.guild_id===guildId)fail(409,'GUILD_TREASURY_NOT_EMPTY','最後のメンバーが脱退する前に、共有資産をすべて引き出してください。');
  return {ok:true,user:mapUser(current,now)};
}
const EFFECTIVE_CYCLE_SQL="COALESCE(s.cycle_index,MAX(COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key='cyclePolicyStart'),0),CAST(COALESCE(json_extract(s.save_json,'$.state.worldClock.elapsedMs'),0)/40320000 AS INTEGER)))";
const GUILD_RANKINGS=`WITH totals AS (
  SELECT g.id,g.name,g.owner_id,owner.name AS owner_name,g.created_at,COUNT(gm.user_id) AS member_count,
    COALESCE(SUM(COALESCE(json_extract(s.save_json,'$.state.prestige'),0)),0) AS total_prestige,
    COALESCE(SUM(CASE WHEN s.save_json IS NULL THEN 0 WHEN ${EFFECTIVE_CYCLE_SQL}<? THEN 1 ELSE
      (SELECT COUNT(*) FROM json_each(s.save_json,'$.state.castles') c
        WHERE json_extract(c.value,'$.owner')=json_extract(s.save_json,'$.state.clan')
        AND (c.key<>'edo' OR gm.user_id=(SELECT value FROM settings WHERE key='adminUserId'))
        AND (c.key<>'sunpu' OR gm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id)))
      +CASE WHEN gm.user_id=(SELECT value FROM settings WHERE key='adminUserId')
        AND json_extract(s.save_json,'$.state.castles.edo.owner')<>json_extract(s.save_json,'$.state.clan') THEN 1 ELSE 0 END
      +CASE WHEN gm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id) AND json_extract(s.save_json,'$.state.castles.sunpu.owner')<>json_extract(s.save_json,'$.state.clan') THEN 1 ELSE 0 END
      +CASE WHEN gm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
        AND (json_extract(s.save_json,'$.state.castles.edo.owner')=json_extract(s.save_json,'$.state.clan') OR json_extract(s.save_json,'$.state.castles.sunpu.owner')=json_extract(s.save_json,'$.state.clan') AND NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id))
        AND NOT EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.castles') c WHERE c.key NOT IN ('edo','sunpu') AND json_extract(c.value,'$.owner')=json_extract(s.save_json,'$.state.clan')) THEN 1 ELSE 0 END END),0) AS owned_castles
  FROM guilds g JOIN users owner ON owner.id=g.owner_id LEFT JOIN guild_members gm ON gm.guild_id=g.id
  LEFT JOIN player_saves s ON s.user_id=gm.user_id GROUP BY g.id
), ranked AS (SELECT *,ROW_NUMBER() OVER(ORDER BY total_prestige DESC,id ASC) AS rank FROM totals)
SELECT * FROM ranked`;
async function guildRankings(db,url,now) {
  const clock=await getWorldClock(db,now);await cyclePolicy(db,clock,now);const currentCycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);
  const limit=pageLimit(url),cursor=guildCursor(url.searchParams.get('cursor'),'rank',GUILD_ASSET_LIMIT*MAX_GUILD_MEMBERS);
  const result=await db.batch([
    stmt(db,GUILD_RANKINGS+(cursor?' WHERE (total_prestige<? OR (total_prestige=? AND id>?))':'')+' ORDER BY total_prestige DESC,id ASC LIMIT ?',currentCycle,...(cursor?[cursor.value,cursor.value,cursor.id]:[]),limit+1),
    stmt(db,'SELECT COUNT(*) AS count FROM guilds'),
  ]);
  const found=rows(result[0]),page=found.slice(0,limit),last=page.at(-1);
  return {ok:true,guilds:page.map(row=>({...mapGuild(row),totalPrestige:Number(row.total_prestige),ownedCastles:Number(row.owned_castles),rank:Number(row.rank)})),total:Number(rows(result[1])[0]?.count||0),nextCursor:found.length>limit?encodeGuildCursor('rank',Number(last.total_prestige),last.id):null,serverNow:iso(now)};
}
function giftField(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'INVALID_GIFT', '贈り物の形式が正しくありません。');
  const keys = ['gold','rice','wood','stone','magatama'];
  if (Object.keys(value).some(k => !keys.includes(k))) fail(400, 'INVALID_GIFT', '使用できない贈り物の種類です。');
  const gift = {};
  for (const k of keys) {
    const n = value[k] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0 || n > 1000000) fail(400, 'INVALID_GIFT', '贈り物は0～1,000,000の整数にしてください。');
    // Preserve the canonical JSON/hash of previously sent four-resource gifts.
    // A missing or zero magatama amount must not invalidate an old send retry.
    if(k!=='magatama'||n>0)gift[k] = n;
  }
  if (Object.values(gift).every(n => n === 0)) return null;
  return gift;
}
function systemMailEvent(requestId) {
  // Only the server can create this namespace: public request IDs reject ':'.
  // A title or body supplied by an operator never changes the source identity.
  const match=/^system:field:(fb_[a-f0-9]{32}):(attacker|defender)$/.exec(requestId||'');
  if(match)return {kind:'field-battle',battleId:match[1],side:match[2]};
  const counter=/^system:covert:(cb_[a-f0-9]{32})$/.exec(requestId||'');
  if(counter)return {kind:'field-battle',battleId:counter[1],side:'defender'};
  const timed=/^system:event:(ev_[a-f0-9]{32}):(milestone-[1-3])$/.exec(requestId||'');
  return timed?{kind:'timed-event',eventId:timed[1],milestoneId:timed[2]}:null;
}
function fieldBattleMailContent(battle,side,homes) {
  const attacker=side==='attacker',won=attacker?battle.won:!battle.won,captured=!!battle.capture?.captured,moved=homes.defenderBefore!==homes.defenderAfter;
  const labels={gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材'},amounts=value=>RESOURCES.map(key=>`${labels[key]}${Number(value?.[key]||0).toLocaleString('ja-JP')}`).join('・');
  const mode={reward:'報酬戦（占領なし）',capture:'占領戦',raid:'襲撃（占領なし）'}[battle.battleMode];
  const lines=[attacker?`${battle.defenderName}の${battle.castleName}へ出陣しました。`:`${battle.attackerName}から${battle.castleName}を攻撃されました。`,
    `結果：${won?attacker?'勝利':'防衛勝利':attacker?'敗北・撤退':'敗北'}。`,`戦闘の種類：${mode}。`];
  if(attacker){
    lines.push(`出陣兵：${battle.troops.toLocaleString('ja-JP')}人。損失：${battle.attackerLost.toLocaleString('ja-JP')}人。`,`消費した兵糧：${battle.foodCost.toLocaleString('ja-JP')}。`);
    if(battle.battleMode==='reward')lines.push(`勝利報酬：${amounts(battle.rewards)}。${battle.won?'所持上限を反映した実際の獲得量です。':'今回は勝利報酬がありません。'}`);
    else lines.push(`戦利品：${amounts(battle.loot)}。`);
    if(captured){
      lines.push(battle.capture.newlyOwned?`${battle.castleName}を所領に加え、帰還兵のうち${battle.capture.garrison.toLocaleString('ja-JP')}人を守備兵として配置しました。`:`相手の${battle.castleName}の領有を解きました。あなたが既に所有していた同城の城郭・城兵・普請は継続します。`);
      lines.push(`あなたの本拠は${CASTLE_BY_ID[homes.attacker].name}のままです。`);
      if(moved)lines.push(`相手の本拠は${CASTLE_BY_ID[homes.defenderBefore].name}から${CASTLE_BY_ID[homes.defenderAfter].name}へ移りました。`);
    }else lines.push('この戦闘で城の領有と本拠は変わりません。');
    lines.push('戦闘の損失・消費・獲得はすでに保存へ反映済みです。このメールで追加の受け取り操作は不要です。');
  }else{
    lines.push(`損失：援軍${battle.defenderLost.troops.toLocaleString('ja-JP')}人・城兵${battle.defenderLost.garrison.toLocaleString('ja-JP')}人。`,`資源の損失：${amounts(battle.loot)}。`);
    if(battle.battleMode==='reward')lines.push(`${battle.castleName}は占領されません。この戦闘による資源・兵・施設・軍団・奉行の損失はありません。通常の時刻進行・共同普請は継続します。`);
    else if(captured){
      lines.push(`${battle.castleName}の領有を失いました。`);
      if(moved){
        lines.push(`本拠の移転：${CASTLE_BY_ID[homes.defenderBefore].name} → ${CASTLE_BY_ID[homes.defenderAfter].name}。`,
          '施設・軍団・奉行・所持武将・研究、戦闘後に残った資源と兵を引き継いでいます。施設の普請も継続します。',
          `移転先の城郭はLv.${homes.defenderLevel}です（通常城の上限はLv.32）。城郭の普請は移転先の上限内で引き継ぎます。`,
          '次の周回も新しい本拠から再出発します。');
      }else lines.push(`本拠は${CASTLE_BY_ID[homes.defenderAfter].name}のままです。施設・軍団・奉行・所持武将・研究と、戦闘後に残った資源・兵を保持しています。`);
    }else lines.push(`${battle.castleName}の領有と、本拠${CASTLE_BY_ID[homes.defenderAfter].name}を維持しています。`);
    lines.push('戦闘結果はすでに保存へ反映済みです。ゲームへ接続し直すと最新の状態を確認できます。');
  }
  const title=!attacker&&moved?`【敗北・本拠移転】${battle.castleName}`:`【${attacker?won?'戦闘勝利':'戦闘敗北':won?'防衛勝利':'被攻撃・敗北'}】${battle.castleName}`;
  return {title,body:lines.join('\n')};
}
async function fieldBattleMailStatements(db,battle,homes,now,gate,args) {
  // Two private notices share the battle's commit nonce. They carry no gifts:
  // rewards have already been applied by the authoritative battle transaction.
  return Promise.all(['attacker','defender'].map(async side=>{
    const target=side==='attacker'?battle.attackerPlayerId:battle.defenderPlayerId,{title,body}=fieldBattleMailContent(battle,side,homes);
    const id=`m_sys_${battle.id.slice(3)}_${side==='attacker'?'a':'d'}`,requestId=`system:field:${battle.id}:${side}`,payloadHash=await hash(JSON.stringify({target,title,body,gift:null}));
    return stmt(db,`INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,gift_json,request_id,payload_hash,created_at)
      SELECT ?,?,?,?,?,NULL,?,?,? WHERE ${gate}`,id,battle.attackerPlayerId,target,title,body,requestId,payloadHash,now,...args);
  }));
}
async function visibleMail(db, userId, mailId) {
  const mail = await stmt(db, 'SELECT * FROM mail_campaigns WHERE id=? AND (target_user_id IS NULL OR target_user_id=?)', mailId, userId).first();
  if (!mail) fail(404, 'MAIL_NOT_FOUND', 'このメールは受信できません。');
  return mail;
}

// Version-2 save definitions mirror the game data. Keep the validation contract aligned
// when adding a castle, facility or officer; only these known fields can enter cloud saves.
const BUILDINGS = [{"id":"keep","core":true},{"id":"farm","core":true},{"id":"market","core":true},{"id":"lumber","core":true},{"id":"quarry","core":true},{"id":"barracks","core":true},{"id":"wall","core":true},{"id":"academy","core":true},{"id":"gold_mine","core":false},{"id":"silver_mine","core":false},{"id":"trade_port","core":false},{"id":"wholesale","core":false},{"id":"artisan_town","core":false},{"id":"post_town","core":false},{"id":"mint","core":false},{"id":"rice_paddy","core":false},{"id":"dry_field","core":false},{"id":"orchard","core":false},{"id":"fishery","core":false},{"id":"ranch","core":false},{"id":"granary","core":false},{"id":"irrigation","core":false},{"id":"cedar_forest","core":false},{"id":"bamboo_grove","core":false},{"id":"sawmill","core":false},{"id":"timber_market","core":false},{"id":"charcoal_kiln","core":false},{"id":"forest_office","core":false},{"id":"water_sawmill","core":false},{"id":"stoneworks","core":false},{"id":"clay_pit","core":false},{"id":"lime_kiln","core":false},{"id":"tile_kiln","core":false},{"id":"iron_mine","core":false},{"id":"copper_mine","core":false},{"id":"stone_depot","core":false},{"id":"dojo","core":false},{"id":"stable","core":false},{"id":"gunsmith","core":false},{"id":"spear_workshop","core":false},{"id":"armory","core":false},{"id":"drill_ground","core":false},{"id":"war_school","core":false},{"id":"main_gate","core":false},{"id":"moat","core":false},{"id":"watchtower","core":false},{"id":"guardhouse","core":false},{"id":"earthworks","core":false},{"id":"outpost","core":false},{"id":"herb_garden","core":false},{"id":"library","core":false},{"id":"observatory","core":false},{"id":"craft_lab","core":false},{"id":"engineering_shop","core":false},{"id":"medical_school","core":false},{"id":"school","core":false},{"id":"foreign_studies","core":false},{"id":"envoy_house","core":false},{"id":"tea_house","core":false},{"id":"temple","core":false},{"id":"shrine","core":false},{"id":"guest_house","core":false},{"id":"relay_station","core":false},{"id":"intelligence_office","core":false}];
const CASTLES = [{"id":"ishikawa","clan":"津軽家","name":"石川城"},{"id":"sannohe","clan":"南部家","name":"三戸城"},{"id":"minato","clan":"安東家","name":"湊城"},{"id":"kakunodate","clan":"戸沢家","name":"角館城"},{"id":"yamagata","clan":"最上家","name":"山形城"},{"id":"yonezawa","clan":"伊達家","name":"米沢城"},{"id":"kurokawa","clan":"蘆名家","name":"黒川城"},{"id":"odaka","clan":"相馬家","name":"小高城"},{"id":"ota","clan":"佐竹家","name":"太田城"},{"id":"utsunomiya","clan":"宇都宮家","name":"宇都宮城"},{"id":"mayabashi","clan":"長野家","name":"厩橋城"},{"id":"oshi","clan":"成田家","name":"忍城"},{"id":"odawara","clan":"北条家","name":"小田原城"},{"id":"kasugayama","clan":"上杉家","name":"春日山城"},{"id":"ueda","clan":"真田家","name":"上田城"},{"id":"tsutsujigasaki","clan":"武田家","name":"躑躅ヶ崎館"},{"id":"nanao","clan":"畠山家","name":"七尾城"},{"id":"kanazawa","clan":"本願寺勢","name":"金沢御坊"},{"id":"ichijodani","clan":"朝倉家","name":"一乗谷城"},{"id":"sunpu","clan":"今川家","name":"駿府城"},{"id":"hikuma","clan":"飯尾家","name":"引馬城"},{"id":"okazaki","clan":"徳川家","name":"岡崎城"},{"id":"kiyosu","clan":"織田家","name":"清洲城"},{"id":"inabayama","clan":"斎藤家","name":"稲葉山城"},{"id":"odani","clan":"浅井家","name":"小谷城"},{"id":"kannonji","clan":"六角家","name":"観音寺城"},{"id":"sakamoto","clan":"明智家","name":"坂本城"},{"id":"nijo","clan":"足利家","name":"二条御所"},{"id":"akutagawa","clan":"三好家","name":"芥川山城"},{"id":"takaya","clan":"畠山家","name":"高屋城"},{"id":"tottori","clan":"山名家","name":"鳥取城"},{"id":"gassan","clan":"尼子家","name":"月山富田城"},{"id":"okayama","clan":"宇喜多家","name":"岡山城"},{"id":"yoshida","clan":"毛利家","name":"吉田郡山城"},{"id":"yamaguchi","clan":"大内家","name":"山口館"},{"id":"takamatsu","clan":"清水家","name":"備中高松城"},{"id":"oko","clan":"長宗我部家","name":"岡豊城"},{"id":"yuzuki","clan":"河野家","name":"湯築城"},{"id":"shozui","clan":"三好家","name":"勝瑞城"},{"id":"sogo","clan":"十河家","name":"十河城"},{"id":"akizuki","clan":"秋月家","name":"秋月城"},{"id":"tachibana","clan":"立花家","name":"立花城"},{"id":"funai","clan":"大友家","name":"府内館"},{"id":"saga","clan":"龍造寺家","name":"佐賀城"},{"id":"hitoyoshi","clan":"相良家","name":"人吉城"},{"id":"kumamoto","clan":"城家","name":"隈本城"},{"id":"obi","clan":"伊東家","name":"飫肥城"},{"id":"uchijo","clan":"島津家","name":"内城"},{"id":"hirosaki","clan":"津軽家","name":"弘前城"},{"id":"nejo","clan":"南部家","name":"根城"},{"id":"morioka","clan":"南部家","name":"盛岡城"},{"id":"sendai","clan":"伊達家","name":"仙台城"},{"id":"kubota","clan":"佐竹家","name":"久保田城"},{"id":"nihonmatsu","clan":"畠山家","name":"二本松城"},{"id":"shirakawa","clan":"結城家","name":"白河小峰城"},{"id":"kunohe","clan":"九戸家","name":"九戸城"},{"id":"miharu","clan":"田村家","name":"三春城"},{"id":"mukaihaguroyama","clan":"蘆名家","name":"向羽黒山城"},{"id":"mito","clan":"佐竹家","name":"水戸城"},{"id":"minowa","clan":"長野家","name":"箕輪城"},{"id":"nitta_kanayama","clan":"由良家","name":"新田金山城"},{"id":"hachigata","clan":"北条家","name":"鉢形城"},{"id":"kawagoe","clan":"太田家","name":"川越城"},{"id":"edo","clan":"太田家","name":"江戸城"},{"id":"hachioji","clan":"北条家","name":"八王子城"},{"id":"motosakura","clan":"千葉家","name":"本佐倉城"},{"id":"otaki","clan":"本多家","name":"大多喜城"},{"id":"numata","clan":"真田家","name":"沼田城"},{"id":"kofu","clan":"浅野家","name":"甲府城"},{"id":"kaizu","clan":"武田家","name":"海津城"},{"id":"komoro","clan":"仙石家","name":"小諸城"},{"id":"matsumoto","clan":"小笠原家","name":"松本城"},{"id":"takato","clan":"仁科家","name":"高遠城"},{"id":"shibata","clan":"新発田家","name":"新発田城"},{"id":"murakami","clan":"本庄家","name":"村上城"},{"id":"shinpu","clan":"武田家","name":"新府城"},{"id":"toyama","clan":"神保家","name":"富山城"},{"id":"takaoka","clan":"前田家","name":"高岡城"},{"id":"maruoka","clan":"柴田家","name":"丸岡城"},{"id":"echizen_ono","clan":"金森家","name":"越前大野城"},{"id":"kuniyoshi","clan":"粟屋家","name":"佐柿国吉城"},{"id":"iwamura","clan":"遠山家","name":"岩村城"},{"id":"yamanaka","clan":"北条家","name":"山中城"},{"id":"kakegawa","clan":"朝比奈家","name":"掛川城"},{"id":"inuyama","clan":"織田家","name":"犬山城"},{"id":"nagoya","clan":"徳川家","name":"名古屋城"},{"id":"nagashino","clan":"奥平家","name":"長篠城"},{"id":"gujo_hachiman","clan":"遠藤家","name":"郡上八幡城"},{"id":"naegi","clan":"遠山家","name":"苗木城"},{"id":"ogaki","clan":"氏家家","name":"大垣城"},{"id":"takatenjin","clan":"小笠原家","name":"高天神城"},{"id":"iga_ueno","clan":"藤堂家","name":"伊賀上野城"},{"id":"matsusaka","clan":"蒲生家","name":"松阪城"},{"id":"hikone","clan":"井伊家","name":"彦根城"},{"id":"azuchi","clan":"織田家","name":"安土城"},{"id":"osaka","clan":"豊臣家","name":"大坂城"},{"id":"himeji","clan":"黒田家","name":"姫路城"},{"id":"takeda_castle","clan":"赤松家","name":"竹田城"},{"id":"takatori","clan":"筒井家","name":"高取城"},{"id":"wakayama","clan":"浅野家","name":"和歌山城"},{"id":"fukuchiyama","clan":"明智家","name":"福知山城"},{"id":"kishiwada","clan":"小出家","name":"岸和田城"},{"id":"yamato_koriyama","clan":"筒井家","name":"大和郡山城"},{"id":"sumoto","clan":"脇坂家","name":"洲本城"},{"id":"bitchu_matsuyama","clan":"三村家","name":"備中松山城"},{"id":"tsuyama","clan":"森家","name":"津山城"},{"id":"hiroshima","clan":"毛利家","name":"広島城"},{"id":"iwakuni","clan":"吉川家","name":"岩国城"},{"id":"hagi","clan":"毛利家","name":"萩城"},{"id":"matsue","clan":"堀尾家","name":"松江城"},{"id":"yonago","clan":"中村家","name":"米子城"},{"id":"mihara","clan":"小早川家","name":"三原城"},{"id":"shintakayama","clan":"小早川家","name":"新高山城"},{"id":"tsuwano","clan":"吉見家","name":"津和野城"},{"id":"tokushima","clan":"蜂須賀家","name":"徳島城"},{"id":"sanuki_takamatsu","clan":"生駒家","name":"高松城"},{"id":"marugame","clan":"生駒家","name":"丸亀城"},{"id":"imabari","clan":"藤堂家","name":"今治城"},{"id":"uwajima","clan":"伊達家","name":"宇和島城"},{"id":"kochi","clan":"山内家","name":"高知城"},{"id":"kokura","clan":"細川家","name":"小倉城"},{"id":"fukuoka","clan":"黒田家","name":"福岡城"},{"id":"nakatsu","clan":"黒田家","name":"中津城"},{"id":"oka","clan":"中川家","name":"岡城"},{"id":"hizen_nagoya","clan":"豊臣家","name":"名護屋城"},{"id":"hirado","clan":"松浦家","name":"平戸城"},{"id":"shimabara","clan":"松倉家","name":"島原城"},{"id":"kagoshima","clan":"島津家","name":"鹿児島城"}];
const CLANS = [{"name":"織田家"},{"name":"武田家"},{"name":"上杉家"},{"name":"徳川家"},{"name":"毛利家"},{"name":"島津家"},{"name":"伊達家"},{"name":"北条家"}];
const TECHS = [{"id":"cultivation","max":5},{"id":"commerce","max":5},{"id":"forestry","max":5},{"id":"masonry","max":5},{"id":"conscription","max":5},{"id":"discipline","max":5},{"id":"gunnery","max":5},{"id":"siege","max":5}];
const QUESTS = [{"id":"first_upgrade"},{"id":"first_recruit"},{"id":"first_battle"},{"id":"three_castles"},{"id":"five_officers"},{"id":"technology"},{"id":"ten_castles"},{"id":"unify"}];
const TACTICS = [{"id":"balanced"},{"id":"assault"},{"id":"siege"},{"id":"ambush"}];
const OFFICERS = [{"id":"of_a0e6e90cdb05","rank":"U","rarity":"U"},{"id":"of_ff3fd6bd6780","rank":"C","rarity":"C"},{"id":"of_aba61a9a6025","rank":"C","rarity":"C"},{"id":"of_63a558a01fd3","rank":"B","rarity":"B"},{"id":"of_68fd404eb737","rank":"B","rarity":"B"},{"id":"of_70318db415bd","rank":"B","rarity":"B"},{"id":"of_fb96738747b0","rank":"S","rarity":"S"},{"id":"of_38034cc3665c","rank":"S","rarity":"S"},{"id":"of_115e83112cb8","rank":"S","rarity":"S"},{"id":"of_72d0819cf996","rank":"B","rarity":"B"},{"id":"of_68e1472d2f81","rank":"D","rarity":"D"},{"id":"of_3e7e5a5ac434","rank":"C","rarity":"C"},{"id":"of_c871ba3fd72e","rank":"B","rarity":"B"},{"id":"of_e6f97b11d393","rank":"C","rarity":"C"},{"id":"of_70900a980301","rank":"D","rarity":"D"},{"id":"of_65f241a7a971","rank":"B","rarity":"B"},{"id":"of_b63f0fd4cd9f","rank":"B","rarity":"B"},{"id":"of_df3c4c3ee00a","rank":"B","rarity":"B"},{"id":"of_9212d6e7a5a1","rank":"SSS","rarity":"SSS"},{"id":"of_26d0f3c61efa","rank":"A","rarity":"A"},{"id":"of_5cc202f5486e","rank":"A","rarity":"A"},{"id":"of_fcde9260c619","rank":"D","rarity":"D"},{"id":"of_de135070c994","rank":"D","rarity":"D"},{"id":"of_441a416ebe71","rank":"U","rarity":"U"},{"id":"of_cb3739e8e3fd","rank":"D","rarity":"D"},{"id":"of_e9ffab493694","rank":"B","rarity":"B"},{"id":"of_e626334229d1","rank":"C","rarity":"C"},{"id":"of_07f743b2e701","rank":"A","rarity":"A"},{"id":"of_986ea36278e9","rank":"S","rarity":"S"},{"id":"of_776f46526cfb","rank":"D","rarity":"D"},{"id":"of_fe2924f04d99","rank":"C","rarity":"C"},{"id":"of_b7a41a01acc5","rank":"D","rarity":"D"},{"id":"of_59bd20a977f4","rank":"C","rarity":"C"},{"id":"of_62f865553259","rank":"B","rarity":"B"},{"id":"of_e09eb5d7517d","rank":"B","rarity":"B"},{"id":"of_3a536a5b88eb","rank":"B","rarity":"B"},{"id":"of_3bf24fbe1342","rank":"D","rarity":"D"},{"id":"of_8ae31bfcfea4","rank":"C","rarity":"C"},{"id":"of_e000b74e89ff","rank":"C","rarity":"C"},{"id":"of_d50b3328a869","rank":"C","rarity":"C"},{"id":"of_8667cb59427b","rank":"C","rarity":"C"},{"id":"of_d505821e1efb","rank":"A","rarity":"A"},{"id":"of_84d55a1e0510","rank":"C","rarity":"C"},{"id":"of_19ce96d56e7b","rank":"B","rarity":"B"},{"id":"of_b0616adde162","rank":"U","rarity":"U"},{"id":"of_c64fed5fd5ee","rank":"A","rarity":"A"},{"id":"of_bca8a1ab2ecc","rank":"B","rarity":"B"},{"id":"of_d5a1a07c899c","rank":"D","rarity":"D"},{"id":"of_d7ab8bacd2e8","rank":"C","rarity":"C"},{"id":"of_eb499d679a99","rank":"SS","rarity":"SS"},{"id":"of_1c414956c845","rank":"S","rarity":"S"},{"id":"of_4c9679c21dd9","rank":"A","rarity":"A"},{"id":"of_4aa00632c729","rank":"A","rarity":"A"},{"id":"of_80df2a3f71b4","rank":"SS","rarity":"SS"},{"id":"of_e382c64b6788","rank":"SS","rarity":"SS"},{"id":"of_7c68086fcf17","rank":"A","rarity":"A"},{"id":"of_01a2a64d574c","rank":"B","rarity":"B"},{"id":"of_3bfeb0818ad5","rank":"C","rarity":"C"},{"id":"of_600cadfc51ca","rank":"B","rarity":"B"},{"id":"of_cc39e1eb73ee","rank":"C","rarity":"C"},{"id":"of_92e643c24157","rank":"D","rarity":"D"},{"id":"of_49065f7eda69","rank":"C","rarity":"C"},{"id":"of_6439efdd41f2","rank":"A","rarity":"A"},{"id":"of_cd91877875f7","rank":"D","rarity":"D"},{"id":"of_1fad4e56084f","rank":"U","rarity":"U"},{"id":"of_5404c8f64020","rank":"B","rarity":"B"},{"id":"of_b769f98eaa15","rank":"S","rarity":"S"},{"id":"of_cc0c8bafb62f","rank":"D","rarity":"D"},{"id":"of_2d70c8739bf3","rank":"C","rarity":"C"},{"id":"of_032fa1823fb5","rank":"C","rarity":"C"},{"id":"of_4b1a5e96b7f9","rank":"B","rarity":"B"},{"id":"of_55d8eb4239b8","rank":"A","rarity":"A"},{"id":"of_9dfb615bceb1","rank":"A","rarity":"A"},{"id":"of_062ca2f22403","rank":"S","rarity":"S"},{"id":"of_854f873dc880","rank":"SS","rarity":"SS"},{"id":"of_37fbba464252","rank":"S","rarity":"S"},{"id":"of_a6d944a0b8dd","rank":"S","rarity":"S"},{"id":"of_e5db16d76d2a","rank":"A","rarity":"A"},{"id":"of_8ce312832bb1","rank":"D","rarity":"D"},{"id":"of_d9f8aaa5f139","rank":"C","rarity":"C"},{"id":"of_be400ef00f79","rank":"S","rarity":"S"},{"id":"of_036c6a0d3c67","rank":"SSS","rarity":"SSS"},{"id":"of_f293cee967b2","rank":"D","rarity":"D"},{"id":"of_8274869a411a","rank":"SS","rarity":"SS"},{"id":"of_8476285072de","rank":"SSS","rarity":"SSS"},{"id":"of_b6d28937a602","rank":"A","rarity":"A"},{"id":"of_186a41753745","rank":"C","rarity":"C"},{"id":"of_11c55ba657ee","rank":"A","rarity":"A"},{"id":"of_7de31f2d25f6","rank":"U","rarity":"U"},{"id":"of_25b61f479447","rank":"SS","rarity":"SS"},{"id":"of_f0c747d0ad85","rank":"B","rarity":"B"},{"id":"of_1f19a1a4d3f7","rank":"A","rarity":"A"},{"id":"of_e753692df8e8","rank":"B","rarity":"B"},{"id":"of_ad3d8b2a7e0d","rank":"SS","rarity":"SS"},{"id":"of_32a8cb2e5f11","rank":"C","rarity":"C"},{"id":"of_7bcaec901ece","rank":"C","rarity":"C"},{"id":"of_2b32358fba73","rank":"A","rarity":"A"},{"id":"of_08cee1a59d84","rank":"C","rarity":"C"},{"id":"of_e107bfbbfede","rank":"B","rarity":"B"},{"id":"of_8ffef76897b9","rank":"C","rarity":"C"},{"id":"of_e57ff26eefde","rank":"S","rarity":"S"},{"id":"of_1d10e43049ce","rank":"D","rarity":"D"},{"id":"of_f336ba2bd3ee","rank":"A","rarity":"A"},{"id":"of_f8fb97928a1c","rank":"C","rarity":"C"},{"id":"of_acf66881b90c","rank":"SSS","rarity":"SSS"},{"id":"of_7dae42f38b81","rank":"SS","rarity":"SS"},{"id":"of_39a447fa235f","rank":"SSS","rarity":"SSS"},{"id":"of_6fe7588efd44","rank":"S","rarity":"S"},{"id":"of_4c8b553249ac","rank":"A","rarity":"A"},{"id":"of_2b44824e5bc3","rank":"D","rarity":"D"},{"id":"of_96d126220271","rank":"B","rarity":"B"},{"id":"of_bd10e718c45b","rank":"B","rarity":"B"},{"id":"of_b9e3f348417b","rank":"B","rarity":"B"},{"id":"of_9f74a74a8a25","rank":"D","rarity":"D"},{"id":"of_ff4b86826567","rank":"C","rarity":"C"},{"id":"of_583a3f2fa1e1","rank":"B","rarity":"B"},{"id":"of_ad7ae9ce689b","rank":"A","rarity":"A"},{"id":"of_41fbffeae316","rank":"SSS","rarity":"SSS"},{"id":"of_c9a600d3041b","rank":"S","rarity":"S"},{"id":"of_90912dd40b7b","rank":"A","rarity":"A"},{"id":"of_d6ad06cde8c6","rank":"C","rarity":"C"},{"id":"of_6e26fbe9810c","rank":"D","rarity":"D"},{"id":"of_0da39e61030f","rank":"D","rarity":"D"},{"id":"of_99ca6b415f83","rank":"D","rarity":"D"},{"id":"of_fe07656642cd","rank":"SS","rarity":"SS"},{"id":"of_090229fe8f24","rank":"A","rarity":"A"},{"id":"of_32504e876cb4","rank":"D","rarity":"D"},{"id":"of_977d48d38a8c","rank":"SSS","rarity":"SSS"},{"id":"of_a961c8d748c3","rank":"U","rarity":"U"},{"id":"of_c60164551831","rank":"D","rarity":"D"},{"id":"of_34ca3b71c757","rank":"D","rarity":"D"},{"id":"of_76ba4c469340","rank":"B","rarity":"B"},{"id":"of_40f097f094f0","rank":"A","rarity":"A"},{"id":"of_2c772492d8de","rank":"S","rarity":"S"},{"id":"of_a2aa5d651062","rank":"A","rarity":"A"},{"id":"of_a5509b34c24d","rank":"A","rarity":"A"},{"id":"of_0811d329ea42","rank":"B","rarity":"B"},{"id":"of_cba19a00d667","rank":"SSS","rarity":"SSS"},{"id":"of_b1727b5f01cd","rank":"B","rarity":"B"},{"id":"of_645bf9b96b5b","rank":"A","rarity":"A"},{"id":"of_9e0e9ff9b24f","rank":"S","rarity":"S"},{"id":"of_634b91971ec5","rank":"S","rarity":"S"},{"id":"of_044f75deb75a","rank":"A","rarity":"A"},{"id":"of_d1ebd2af507c","rank":"SS","rarity":"SS"},{"id":"of_d451b69f0d8e","rank":"C","rarity":"C"},{"id":"of_8cb9010edbd6","rank":"B","rarity":"B"},{"id":"of_ea149c8008f6","rank":"C","rarity":"C"},{"id":"of_37f879a6fe0e","rank":"A","rarity":"A"},{"id":"of_d5f58007e8b8","rank":"C","rarity":"C"},{"id":"of_e454f951652b","rank":"S","rarity":"S"},{"id":"of_5d45193db675","rank":"D","rarity":"D"},{"id":"of_0f1fa57bd563","rank":"B","rarity":"B"},{"id":"of_423a1775b219","rank":"S","rarity":"S"},{"id":"of_42089d2a1e06","rank":"A","rarity":"A"},{"id":"of_4f6e17715f37","rank":"D","rarity":"D"},{"id":"of_d1c22f1c278a","rank":"SS","rarity":"SS"},{"id":"of_eb4ea696f69c","rank":"B","rarity":"B"},{"id":"of_65cfd50910ff","rank":"C","rarity":"C"},{"id":"of_7a1d5b662842","rank":"A","rarity":"A"},{"id":"of_e9f337d06d0a","rank":"S","rarity":"S"},{"id":"of_62dfb7599436","rank":"D","rarity":"D"},{"id":"of_63f34d7bd399","rank":"D","rarity":"D"},{"id":"of_8f88e36931d0","rank":"D","rarity":"D"},{"id":"of_2776078a4d43","rank":"C","rarity":"C"},{"id":"of_2fb26a1f22ce","rank":"SS","rarity":"SS"},{"id":"of_52288d93a163","rank":"C","rarity":"C"},{"id":"of_24681edc66a0","rank":"SS","rarity":"SS"},{"id":"of_34e6a58a6be0","rank":"A","rarity":"A"},{"id":"of_9f13178fc263","rank":"A","rarity":"A"},{"id":"of_2797326caa72","rank":"A","rarity":"A"},{"id":"of_c790c12cf4f8","rank":"C","rarity":"C"},{"id":"of_18e33e84a750","rank":"U","rarity":"U"},{"id":"of_a24e7055cc3b","rank":"B","rarity":"B"},{"id":"of_b1b3364da00f","rank":"C","rarity":"C"},{"id":"of_dc2a18db20b8","rank":"C","rarity":"C"},{"id":"of_25d64953b8c0","rank":"S","rarity":"S"},{"id":"of_295dc6ca2683","rank":"C","rarity":"C"},{"id":"of_2ae7106cafd2","rank":"SS","rarity":"SS"},{"id":"of_92db45b97c25","rank":"D","rarity":"D"},{"id":"of_726f653695fa","rank":"D","rarity":"D"},{"id":"of_6ea2ed8ce73f","rank":"D","rarity":"D"},{"id":"of_1b1261e4072f","rank":"C","rarity":"C"},{"id":"of_5777a4c6c166","rank":"S","rarity":"S"},{"id":"of_26dec57f0ce7","rank":"C","rarity":"C"},{"id":"of_b7f1c5e96d34","rank":"SS","rarity":"SS"},{"id":"of_2443932b7b16","rank":"S","rarity":"S"},{"id":"of_fe7333233ad7","rank":"B","rarity":"B"},{"id":"of_5c7df800327b","rank":"C","rarity":"C"},{"id":"of_3d6e5bcd584d","rank":"A","rarity":"A"},{"id":"of_0e90997b6a74","rank":"B","rarity":"B"},{"id":"of_e2cc6d8494e9","rank":"D","rarity":"D"},{"id":"of_a4d79d64a696","rank":"C","rarity":"C"},{"id":"of_66a413fe47c6","rank":"B","rarity":"B"},{"id":"of_ed1a354ead5c","rank":"S","rarity":"S"},{"id":"of_ef6125582de3","rank":"A","rarity":"A"},{"id":"of_90794256e769","rank":"B","rarity":"B"},{"id":"of_a3ebd9305b77","rank":"C","rarity":"C"},{"id":"of_4ad219b05727","rank":"SSS","rarity":"SSS"},{"id":"of_a8b1942fd6f0","rank":"B","rarity":"B"},{"id":"of_43f44f231033","rank":"B","rarity":"B"},{"id":"of_661b4ef8d271","rank":"B","rarity":"B"},{"id":"of_2e565690c108","rank":"B","rarity":"B"},{"id":"of_b2f7a04e1314","rank":"D","rarity":"D"},{"id":"of_193478300c9f","rank":"SSS","rarity":"SSS"},{"id":"of_0fd91e531288","rank":"C","rarity":"C"},{"id":"of_7b83b025a229","rank":"C","rarity":"C"},{"id":"of_b0d484afc5fd","rank":"S","rarity":"S"},{"id":"of_6ebba6d98baf","rank":"D","rarity":"D"},{"id":"of_69c8d30858dd","rank":"B","rarity":"B"},{"id":"of_9bc7c977b15f","rank":"C","rarity":"C"},{"id":"of_bc24d0094d1b","rank":"A","rarity":"A"},{"id":"of_07de980ca260","rank":"D","rarity":"D"},{"id":"of_37848027b2a9","rank":"C","rarity":"C"},{"id":"of_09b324fab073","rank":"A","rarity":"A"},{"id":"of_0dc991571235","rank":"S","rarity":"S"},{"id":"of_d67ec86d5302","rank":"S","rarity":"S"},{"id":"of_7cf3b4336dd7","rank":"SS","rarity":"SS"},{"id":"of_dd9ac0fef8ab","rank":"SSS","rarity":"SSS"},{"id":"of_4e7128f8bec8","rank":"SS","rarity":"SS"},{"id":"of_2aa671cb189a","rank":"SS","rarity":"SS"},{"id":"of_03f1e4c48a76","rank":"S","rarity":"S"},{"id":"of_068d4841b859","rank":"B","rarity":"B"},{"id":"of_772916618907","rank":"C","rarity":"C"},{"id":"of_7f990e567f78","rank":"SS","rarity":"SS"},{"id":"of_9a78742407de","rank":"C","rarity":"C"},{"id":"of_08375b880242","rank":"A","rarity":"A"},{"id":"of_d746190a4fb5","rank":"B","rarity":"B"},{"id":"of_68d00bd24e3b","rank":"D","rarity":"D"},{"id":"of_7ea1bb66f553","rank":"B","rarity":"B"},{"id":"of_45e0f4cb36ad","rank":"SS","rarity":"SS"},{"id":"of_667635446894","rank":"U","rarity":"U"},{"id":"of_5db6a9b5d30b","rank":"S","rarity":"S"},{"id":"of_3e8734a81e23","rank":"SS","rarity":"SS"},{"id":"of_5a065fb2318b","rank":"D","rarity":"D"},{"id":"of_4b0e32ed2304","rank":"B","rarity":"B"},{"id":"of_e34b3b0bb3b3","rank":"B","rarity":"B"},{"id":"of_a9a216007a85","rank":"A","rarity":"A"},{"id":"of_f9b885b2fedb","rank":"C","rarity":"C"},{"id":"of_0fe1c738e675","rank":"A","rarity":"A"},{"id":"of_2a3709362b54","rank":"A","rarity":"A"},{"id":"of_cbba00d253b2","rank":"C","rarity":"C"},{"id":"of_0e53a4c4fa63","rank":"C","rarity":"C"},{"id":"of_9e3085a0f721","rank":"A","rarity":"A"},{"id":"of_e3e7cedcc8ff","rank":"SSS","rarity":"SSS"},{"id":"of_31b173ed3827","rank":"S","rarity":"S"},{"id":"of_6fb552fd670b","rank":"SSS","rarity":"SSS"},{"id":"of_3ef9c0ad17c2","rank":"SS","rarity":"SS"},{"id":"of_998be9ba7fda","rank":"S","rarity":"S"},{"id":"of_29846053ddca","rank":"C","rarity":"C"},{"id":"of_15af9682bb34","rank":"SSS","rarity":"SSS"},{"id":"of_cf279a58e2d7","rank":"B","rarity":"B"},{"id":"of_ac24e4255779","rank":"D","rarity":"D"},{"id":"of_e70c0742e2f0","rank":"A","rarity":"A"},{"id":"of_9015c61c1eab","rank":"D","rarity":"D"},{"id":"of_cc7ff75f69df","rank":"D","rarity":"D"},{"id":"of_c3e1f225f038","rank":"B","rarity":"B"}];
const RANKS = ["D","C","B","A","S","SS","SSS","U"];
const RESOURCES = ["gold","rice","wood","stone"];
const GACHA = {"initial":3000,"duplicateRefund":50};
const CASTLE_BY_ID = Object.assign(Object.create(null), Object.fromEntries(CASTLES.map(v => [v.id,v])));
const OFFICER_BY_ID = Object.assign(Object.create(null), Object.fromEntries(OFFICERS.map(v => [v.id,v])));
const CLAN_HOMES = {'織田家':'kiyosu','武田家':'tsutsujigasaki','上杉家':'kasugayama','徳川家':'okazaki','毛利家':'yoshida','島津家':'uchijo','伊達家':'yonezawa','北条家':'odawara'};
const copy = value => JSON.parse(JSON.stringify(value));
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key,object[key]]));

function normalizeGameSave(raw, user, now, {reading=false,clock=null}={}) {
  let obj;try{obj=typeof raw==='string'?JSON.parse(raw):copy(raw);}catch(e){fail(400,'INVALID_SAVE','セーブデータを読み取れません。');}
  const s=obj?.state||obj,staff=!!user.is_staff&&!user.is_admin,serviceSave=s?.staffService?.baseId==='sunpu';
  if(serviceSave&&!staff&&s?.buildings){s.command=Math.min(Number(s.command),3+Math.floor(s.buildings.keep/8));if(s.governors&&typeof s.governors==='object')s.governors=Object.fromEntries(Object.entries(s.governors).filter(([id])=>!BUILDINGS.some(b=>b.id===id)||s.buildings[id]>0));}
  const invalid=()=>{fail(400,'INVALID_SAVE','セーブデータの形式または内容が正しくありません。');};
  const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const num=(v,min=0,max=999999999)=>typeof v==='number'&&Number.isFinite(v)&&Number.isInteger(v)&&v>=min&&v<=max;
  // Validate historical saves against their old limit before migrating them.
  // New uploads must already obey the current limit. Invalid old jobs still fail.
  const incomingCastleLimit=id=>reading&&FIELD_CAPTURE_CASTLES.includes(id)?64:castleLevelLimit(id);
  if(!isObj(s)||s.version!==2||obj?.game&&obj.game!=='sengoku-tento')invalid();
  if(s.clan===ADMIN_CLAN&&!user.is_admin&&!staff&&!reading)fail(403,'ADMIN_CLAN_REQUIRED','この家名は選択できません。徳川家を選択してください。');
  if(s.clan!==ADMIN_CLAN&&!CLANS.some(c=>c.name===s.clan)||!CASTLE_BY_ID[s.home]||!['easy','normal','hard'].includes(s.difficulty))invalid();
  const g={state:{version:2},roster:OFFICERS,officer:id=>OFFICER_BY_ID[id],baseOfficer:id=>OFFICER_BY_ID[id]};
  if(!num(s.turn,0,MAX_TURN)||!num(s.troops,0,1000000)||!num(s.morale,0,100)||!num(s.prestige)||!num(s.command,0,7)||!num(s.seed,0,4294967295))invalid();
  if(!isObj(s.resources)||!RESOURCES.every(k=>num(s.resources[k])))invalid();
  if(!isObj(s.buildings)||Object.keys(s.buildings).length!==BUILDINGS.length||!BUILDINGS.every(b=>num(s.buildings[b.id],b.core?1:0,32)))invalid();
  if(!staff&&s.command>3+Math.floor(s.buildings.keep/8))invalid();
  if(!isObj(s.tech)||!TECHS.every(t=>num(s.tech[t.id],0,t.max)))invalid();
  const validOwner=new Set([...CASTLES.map(c=>c.clan),'在地衆',ADMIN_CLAN]);for(const c of CLANS)validOwner.add(c.name);
  if(!isObj(s.castles)||Object.keys(s.castles).length!==CASTLES.length||!CASTLES.every(c=>{const v=s.castles[c.id];if(isObj(v)&&v.level===undefined)v.level=1;return isObj(v)&&validOwner.has(v.owner)&&num(v.troops,0,1000000)&&num(v.wall,1,32)&&num(v.level,1,incomingCastleLimit(c.id));}))invalid();
  if(!Array.isArray(s.officers)||s.officers.length>g.roster.length||new Set(s.officers).size!==s.officers.length||s.officers.some(id=>typeof id!=='string'||!g.officer(id)))invalid();
  if(!Array.isArray(s.army)||s.army.length>3||new Set(s.army).size!==s.army.length||s.army.some(id=>!s.officers.includes(id)))invalid();
  if(!isObj(s.governors)||Object.keys(s.governors).some(id=>!BUILDINGS.some(b=>b.id===id)||!staff&&s.buildings[id]<1)||Object.values(s.governors).some(id=>!s.officers.includes(id)||s.army.includes(id))||new Set(Object.values(s.governors)).size!==Object.values(s.governors).length)invalid();
  const scalar=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  if(s.realtime===undefined)s.realtime={running:true,speed:1,elapsed:0,commandProgress:0,incomeRemainders:{gold:0,rice:0,wood:0,stone:0}};
  const rt=s.realtime;
  if(!isObj(rt)||typeof rt.running!=='boolean'||![1,2,4].includes(rt.speed)||!scalar(rt.elapsed,0,59.99999999)||!scalar(rt.commandProgress,0,19.99999999)||!isObj(rt.incomeRemainders)||Object.keys(rt.incomeRemainders).length!==4||!RESOURCES.every(k=>scalar(rt.incomeRemainders[k],-1,1)&&Math.abs(rt.incomeRemainders[k])<1))invalid();
  if(s.worldClock!==undefined) {
    if(!isObj(s.worldClock)||s.worldClock.id!==WORLD_CLOCK_ID||!Number.isSafeInteger(s.worldClock.elapsedMs)||s.worldClock.elapsedMs<0||s.worldClock.elapsedMs>WORLD_MONTH_MS*(MAX_TURN+1)-1)fail(400,'INVALID_CLOCK_ANCHOR','共通時計の保存位置が正しくありません。');
    if(s.turn!==Math.floor(s.worldClock.elapsedMs/WORLD_MONTH_MS)||Math.abs(rt.elapsed-(s.worldClock.elapsedMs%WORLD_MONTH_MS)/1000)>1e-5)fail(400,'INVALID_CLOCK_ANCHOR','ゲーム年月と共通時計の保存位置が一致しません。');
    if(!reading&&clock&&s.worldClock.elapsedMs>clock.elapsedMs+5000)fail(400,'CLOCK_AHEAD','保存時刻が世界の共通時計より先です。共通時計を再確認してください。');
  }
  if(!Array.isArray(s.jobs)||s.jobs.length>193)invalid();
  for(const j of s.jobs){if(!isObj(j))invalid();if(j.remainingSeconds===undefined)j.remainingSeconds=j.remaining*60;if(j.totalSeconds===undefined)j.totalSeconds=j.total*60;if(!scalar(j.remainingSeconds,.00000001,180)||!num(j.totalSeconds,60,180)||j.totalSeconds!==j.total*60||j.remainingSeconds>j.totalSeconds||j.remaining!==Math.ceil((j.remainingSeconds-1e-8)/60))invalid();}

  const jobkeys=new Map();for(const j of s.jobs){if(!isObj(j)||!['building','castle','research'].includes(j.kind)||!num(j.remaining,1,3)||!num(j.total,1,3)||j.remaining>j.total)invalid();const defs=j.kind==='building'?BUILDINGS:j.kind==='castle'?CASTLES:TECHS,current=j.kind==='castle'?s.castles[j.id]?.level:(j.kind==='building'?s.buildings:s.tech)[j.id],key=j.kind+':'+j.id,count=jobkeys.get(key)||0;if(!defs.some(d=>d.id===j.id)||j.targetLevel!==current+count+1||j.targetLevel>(j.kind==='research'?5:j.kind==='castle'?incomingCastleLimit(j.id):32)||j.kind==='castle'&&s.castles[j.id]?.owner!==s.clan||count&&(j.kind!=='building'||j.remainingSeconds!==j.totalSeconds))invalid();jobkeys.set(key,count+1);}
  if(s.jobs.filter(j=>j.kind==='research').length>1||[...jobkeys.keys()].filter(key=>!key.startsWith('research:')).length>(staff||serviceSave?6:2+Math.floor(s.buildings.keep/8)))invalid();
  if(reading){for(const id of FIELD_CAPTURE_CASTLES)s.castles[id].level=Math.min(48,s.castles[id].level);s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.targetLevel<=castleLevelLimit(job.id));}
  s.jobs=s.jobs.map(job=>pick(job,['kind','id','remaining','total','remainingSeconds','totalSeconds','targetLevel']));
  if(!isObj(s.treaties)||Object.entries(s.treaties).some(([k,v])=>!validOwner.has(k)||k===s.clan||!num(v,0,MAX_TURN+6)))invalid();
  if(!isObj(s.scouted)||Object.entries(s.scouted).some(([k,v])=>!CASTLE_BY_ID[k]||!num(v,0,MAX_TURN+6)))invalid();
  if(!Array.isArray(s.claimedQuests)||new Set(s.claimedQuests).size!==s.claimedQuests.length||s.claimedQuests.some(id=>!QUESTS.some(q=>q.id===id)))invalid();
  if(s.giftReceipts===undefined)s.giftReceipts=[];
  if(!Array.isArray(s.giftReceipts)||s.giftReceipts.length>2000||new Set(s.giftReceipts).size!==s.giftReceipts.length||s.giftReceipts.some(id=>typeof id!=='string'||id.length<1||id.length>128))invalid();
  try{s.walking=GameEngine.normalizeWalkingState(s.walking);}catch{invalid();}
  try{s.roaming=GameEngine.normalizeRoamingState(s.roaming,s.walking.campaignId);s.covert=GameEngine.normalizeCovertState(s.covert,s.walking.campaignId);}catch{invalid();}
  if(s.magatama===undefined)s.magatama=GACHA.initial;if(!num(s.magatama))invalid();
  if(s.captureRewards===undefined)s.captureRewards=CASTLES.filter(c=>s.castles[c.id].owner===s.clan).map(c=>c.id);
  if(!Array.isArray(s.captureRewards)||s.captureRewards.length>CASTLES.length||new Set(s.captureRewards).size!==s.captureRewards.length||s.captureRewards.some(id=>typeof id!=='string'||!CASTLE_BY_ID[id]))invalid();
  if(!isObj(s.stats)||!['battles','wins','upgrades','recruited'].every(k=>num(s.stats[k],0,10000000))||s.stats.wins>s.stats.battles)invalid();
  for(const key of ['gachaDraws','gachaDuplicates','castleUpgrades']){if(s.stats[key]===undefined)s.stats[key]=0;if(!num(s.stats[key],0,10000000))invalid();}if(s.stats.gachaDuplicates>s.stats.gachaDraws)invalid();
  if(s.gachaHistory===undefined)s.gachaHistory=[];
  if(!Array.isArray(s.gachaHistory)||s.gachaHistory.length>50||s.gachaHistory.length>s.stats.gachaDraws||s.gachaHistory.some(v=>!isObj(v)||!g.baseOfficer(v.officerId)||!s.officers.includes(v.officerId)||!RANKS.includes(v.rank)||typeof v.isNew!=='boolean'||v.duplicateRefund!==(v.isNew?0:GACHA.duplicateRefund)||!num(v.turn,0,s.turn)))invalid();
  s.gachaHistory=s.gachaHistory.map(v=>({officerId:v.officerId,rank:v.rank,isNew:v.isNew,isNewOfficer:v.isNewOfficer===undefined?v.isNew:v.isNewOfficer,upgraded:v.upgraded===undefined?false:v.upgraded,duplicateRefund:v.duplicateRefund,turn:v.turn}));
  if(s.gachaHistory.some(v=>typeof v.isNewOfficer!=='boolean'||typeof v.upgraded!=='boolean'||v.isNewOfficer&&!v.isNew||v.upgraded&&(!v.isNew||v.isNewOfficer)))invalid();
  if(s.officerVariants===undefined){const variants=new Set(s.officers.map(id=>`${id}:${g.baseOfficer(id).rank||g.baseOfficer(id).rarity}`));for(const v of s.gachaHistory)variants.add(`${v.officerId}:${v.rank}`);s.officerVariants=[...variants];}
  const validVariants=new Map(g.roster.flatMap(o=>RANKS.map(rank=>[`${o.id}:${rank}`,o.id])));
  if(!Array.isArray(s.officerVariants)||s.officerVariants.length>g.roster.length*RANKS.length||new Set(s.officerVariants).size!==s.officerVariants.length||s.officerVariants.some(key=>typeof key!=='string'||!validVariants.has(key)||!s.officers.includes(validVariants.get(key)))||s.officers.some(id=>!RANKS.some(rank=>s.officerVariants.includes(`${id}:${rank}`)))||s.gachaHistory.some(v=>!s.officerVariants.includes(`${v.officerId}:${v.rank}`)))invalid();
  if(!num(s.stats.researches??0,0,10000000))invalid();s.stats.researches=s.stats.researches??Object.values(s.tech).reduce((a,b)=>a+b,0);
  if(!Array.isArray(s.log)||s.log.length>200||s.log.some(l=>!isObj(l)||!num(l.turn,0,MAX_TURN)||typeof l.text!=='string'||l.text.length>2000||typeof l.kind!=='string'||l.kind.length>30))invalid();
  // Only retain known, validated fields; do not merge arbitrary imported object keys.
  const n=g.state;for(const k of ['clan','home','turn','difficulty','resources','troops','morale','prestige','command','buildings','jobs','officers','officerVariants','army','governors','tech','castles','treaties','scouted','log','claimedQuests','giftReceipts','walking','roaming','covert','magatama','captureRewards','gachaHistory','seed','stats','realtime'])n[k]=copy(s[k]);
  if(s.worldClock!==undefined)n.worldClock={id:WORLD_CLOCK_ID,elapsedMs:s.worldClock.elapsedMs};
  if(s.cycle!==undefined){const c=s.cycle,r=c?.latestReward;if(!isObj(c)||!num(c.index,0,Math.floor(MAX_TURN/WORLD_CYCLE_MONTHS))||!CASTLE_BY_ID[c.home]||r!==null&&(!isObj(r)||!num(r.cycle,0,c.index-1)||!num(r.captured,0,127)||r.gold!==r.captured*1000||r.rice!==r.captured*1000||r.magatama!==r.captured*100))invalid();n.cycle={index:c.index,home:c.home,latestReward:r===null?null:pick(r,['cycle','captured','gold','rice','magatama'])};}
  n.won=CASTLES.every(c=>!user.is_admin&&c.id==='edo'||n.castles[c.id].owner===n.clan);n.gameOver=!CASTLES.some(c=>n.castles[c.id].owner===n.clan);
  if(!n.gameOver&&n.castles[n.home].owner!==n.clan)invalid();if(n.gameOver)n.realtime.running=false;
  n.lastBattle=null;
  if(s.lastBattle!==null&&s.lastBattle!==undefined){const b=s.lastBattle;if(!isObj(b)||typeof b.won!=='boolean'||!CASTLE_BY_ID[b.castleId]||!num(b.ourBefore)||!num(b.ourLost)||!num(b.enemyBefore)||!num(b.enemyLost)||!Array.isArray(b.phases)||b.phases.length>10||b.phases.some(p=>!isObj(p)||typeof p.title!=='string'||p.title.length>50||typeof p.text!=='string'||p.text.length>1000)||!isObj(b.rewards)||!num(b.rewards.gold)||!num(b.rewards.rice)||!num(b.rewards.magatama??0)||b.capturedOfficer!==null&&b.capturedOfficer!==undefined&&!g.officer(b.capturedOfficer))invalid();n.lastBattle={won:b.won,castleId:b.castleId,castleName:CASTLE_BY_ID[b.castleId].name,ourBefore:b.ourBefore,ourLost:b.ourLost,enemyBefore:b.enemyBefore,enemyLost:b.enemyLost,phases:copy(b.phases),rewards:{gold:b.rewards.gold,rice:b.rewards.rice,magatama:b.rewards.magatama??0},capturedOfficer:b.capturedOfficer||null,garrison:num(b.garrison)?b.garrison:0,tactic:TACTICS.some(t=>t.id===b.tactic)?b.tactic:'balanced',turn:num(b.turn,0,MAX_TURN)?b.turn:n.turn};}
  // A read after an administrative identity change must still be recoverable.
  // Match the client's legacy migration, without granting permission to upload
  // exclusive assets and without mutating the stored revision during a GET.
  if (reading && !user.is_admin) {
    if(n.clan===ADMIN_CLAN&&!staff) {
      // Preserve the old ownership set: the distinct ordinary Tokugawa AI
      // castles must not become newly owned merely because the clan is renamed.
      for(const castle of Object.values(n.castles))if(castle.owner===ORDINARY_TOKUGAWA_CLAN)castle.owner='在地衆';
      for(const castle of Object.values(n.castles))if(castle.owner===ADMIN_CLAN)castle.owner=ORDINARY_TOKUGAWA_CLAN;
      n.clan=ORDINARY_TOKUGAWA_CLAN;delete n.treaties[n.clan];
    }
    n.officerVariants=[...new Set(n.officerVariants.map(key=>key===IEYASU_ID+':U'?IEYASU_ID+':SSS':key))];
    n.gachaHistory=n.gachaHistory.map(entry=>entry.officerId===IEYASU_ID&&entry.rank==='U'?{...entry,rank:'SSS'}:entry);
    const edo=n.castles.edo,wasHome=n.home==='edo',ownedEdo=edo.owner===n.clan;
    if(wasHome||ownedEdo) {
      const canonical=staff?'sunpu':CLAN_HOMES[n.clan]||'okazaki',other=CASTLES.filter(c=>c.id!=='edo'&&n.castles[c.id].owner===n.clan);
      const fallback=other.find(c=>c.id===canonical)?.id||other[0]?.id||canonical;
      if(ownedEdo&&!other.length) {
        n.castles[fallback]={...edo,owner:n.clan,level:Math.min(edo.level,castleLevelLimit(fallback))};
        if(!n.captureRewards.includes(fallback))n.captureRewards.push(fallback);
      }
      if(wasHome)n.home=fallback;
      if(ownedEdo)n.castles.edo={owner:'太田家',troops:3320,wall:4,level:1};
    }
    n.jobs=n.jobs.filter(job=>job.kind!=='castle'||job.id!=='edo');
    n.captureRewards=n.captureRewards.filter(id=>id!=='edo');
    n.won=CASTLES.every(c=>c.id==='edo'||n.castles[c.id].owner===n.clan);
    n.gameOver=!CASTLES.some(c=>c.id!=='edo'&&n.castles[c.id].owner===n.clan);
    if(n.gameOver)n.realtime.running=false;
  }
  if (!user.is_admin && (n.home==='edo' || n.castles.edo.owner===n.clan || n.officerVariants.includes(IEYASU_ID+':U'))) {
    fail(403,'ADMIN_ENTITLEMENT_REQUIRED','この拠点・武将は現在の利用権では使用できません。');
  }
  // Entitlements belong to the authenticated identity, never imported flags. Restoring
  // the exclusive officer does not touch currency, army assignments or gacha history.
  if (user.is_admin) {
    if(n.clan!==ADMIN_CLAN) {
      const previousClan=n.clan;
      for(const castle of Object.values(n.castles))if(castle.owner===previousClan)castle.owner=ADMIN_CLAN;
      n.clan=ADMIN_CLAN;delete n.treaties[ADMIN_CLAN];
    }
    if (!n.officers.includes(IEYASU_ID)) n.officers.push(IEYASU_ID);
    if (!n.officerVariants.includes(IEYASU_ID+':U')) n.officerVariants.push(IEYASU_ID+':U');
    const oldHome=n.home,edo=n.castles.edo;
    if(oldHome!=='edo') {
      const previous=n.castles[oldHome];
      for(const key of ['troops','wall','level'])edo[key]=Math.max(edo[key],previous[key]);
      n.jobs=n.jobs.flatMap(job=>job.kind==='castle'&&job.id==='edo'
        ?edo.level>=64?[]:[{...job,targetLevel:edo.level+1}]:[job]);
    }
    edo.owner=n.clan;n.home='edo';
    if(!n.captureRewards.includes('edo'))n.captureRewards.push('edo');
    n.won=CASTLES.every(c=>n.castles[c.id].owner===n.clan);n.gameOver=false;
  }
  if(n.cycle){if(user.is_admin)n.cycle.home='edo';else if(n.cycle.home==='edo')n.cycle.home=n.home;}
  if(!reading&&!staff&&(n.home==='sunpu'||n.castles.sunpu.owner===n.clan))fail(403,'STAFF_ENTITLEMENT_REQUIRED','この拠点は現在の利用権では使用できません。');
  if(staff||serviceSave)n.staffService={baseId:'sunpu'};
  const roleState=GameEngine.fromSave({game:'sengoku-tento',version:2,state:n},GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:staff}).state;
  for(const key of Object.keys(roleState))n[key]=roleState[key];
  if(s.cycle===undefined)delete n.cycle;
  n.resources=pick(n.resources,RESOURCES);
  n.buildings=pick(n.buildings,BUILDINGS.map(v=>v.id));
  n.tech=pick(n.tech,TECHS.map(v=>v.id));
  n.castles=Object.fromEntries(CASTLES.map(v=>[v.id,pick(n.castles[v.id],['owner','troops','wall','level'])]));
  n.jobs=n.jobs.map(v=>pick(v,['kind','id','remaining','total','remainingSeconds','totalSeconds','targetLevel']));
  n.log=n.log.map(v=>pick(v,['turn','text','kind']));
  n.stats=pick(n.stats,['battles','wins','upgrades','recruited','researches','gachaDraws','gachaDuplicates','castleUpgrades']);
  n.realtime=pick(n.realtime,['running','speed','elapsed','commandProgress','incomeRemainders']);
  n.realtime.incomeRemainders=pick(n.realtime.incomeRemainders,RESOURCES);
  // Only writes normalize these legacy control fields. Reads at the same save
  // revision must have stable content even when the separate global clock changes.
  if(clock&&!reading){n.realtime.running=clock.running&&!n.gameOver;n.realtime.speed=clock.speed;}
  if(n.lastBattle)n.lastBattle.phases=n.lastBattle.phases.map(v=>pick(v,['title','text']));
  const savedAt=typeof obj.savedAt==='string'&&obj.savedAt.length<=64&&Number.isFinite(Date.parse(obj.savedAt))?new Date(obj.savedAt).toISOString():iso(now);
  return {game:'sengoku-tento',version:2,savedAt,state:n};
}

// A rollout anchor prevents historical saves from receiving retroactive awards.
async function cyclePolicy(db,clock,now) {
  const existing=await stmt(db,"SELECT value FROM settings WHERE key='cyclePolicyStart'").first();if(existing)return Number(existing.value);
  await stmt(db,"INSERT INTO settings(key,value,updated_at) VALUES('cyclePolicyStart',?,?) ON CONFLICT(key) DO NOTHING",String(Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)),now).run();
  const row=await stmt(db,"SELECT value FROM settings WHERE key='cyclePolicyStart'").first();
  return Number(row.value);
}
function cycleEvent(reward) {
  return {key:'cycle:'+reward.cycle,kind:'cycle',targetId:null,targetName:null,value:reward.captured,title:`占領${reward.captured}城の領地精算を達成`,detail:`周回報酬：勾玉${reward.magatama}・金銭${reward.gold}・兵糧${reward.rice}。最初の本拠から再出発しました。`};
}
function achievementStatement(db,userId,event,now,gate,params) {
  return stmt(db,`INSERT INTO achievement_events(id,user_id,event_key,kind,target_id,target_name,value,title,detail,occurred_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(user_id,event_key) DO NOTHING`,uid('ach_'),userId,event.key,event.kind,event.targetId??null,event.targetName??null,event.value??null,event.title,event.detail||'',now,...params);
}
function saveAchievements(before,after) {
  if(!before)return[];const found=[],a=before.state,b=after.state,index=b.cycle?.index??Math.floor(b.turn/WORLD_CYCLE_MONTHS);
  const add=(key,kind,targetId,targetName,value,title,detail='')=>found.push({key,kind,targetId,targetName,value,title,detail});
  for(const castle of CASTLES)if(castle.id!==b.home&&b.castles[castle.id].owner===b.clan&&a.castles[castle.id].owner!==a.clan)add(`capture:${index}:${castle.id}`,'capture',castle.id,castle.name,null,`${castle.name}の占領を達成`);
  for(const def of globalThis.SENGOKU_DATA.buildings){const level=b.buildings[def.id],old=a.buildings[def.id];if(level>old&&[1,4,8,16,24,32].includes(level))add(`building:${def.id}:${level}`,'building',def.id,def.name,level,`${def.name} Lv.${level}の普請を達成`);}
  for(const def of globalThis.SENGOKU_DATA.techs){const level=b.tech[def.id];if(level>a.tech[def.id])add(`research:${def.id}:${level}`,'research',def.id,def.name,level,`${def.name} Lv.${level}の研究を達成`);}
  for(const def of globalThis.SENGOKU_DATA.quests)if(b.claimedQuests.includes(def.id)&&!a.claimedQuests.includes(def.id))add(`quest:${def.id}`,'quest',def.id,def.name,null,`目標「${def.name}」を達成`);
  const count=Object.values(b.castles).filter(c=>c.owner===b.clan).length,oldCount=Object.values(a.castles).filter(c=>c.owner===a.clan).length;
  for(const n of [3,10,30,50,100])if(count>=n&&oldCount<n)add(`territory:${index}:${n}`,'territory',null,null,n,`${n}城の領有を達成`);
  if(b.won&&!a.won)add(`unification:${index}`,'unification',null,null,count,'天下統一を達成');
  return found;
}
async function settlePlayerCycle(db,row,user,now,clock=undefined,{deferActive=true,writerDeviceId=null}={}) {
  const account=user;
  if(!row?.save_json)return row;clock=clock||await getWorldClock(db,now);row=await ensureStaffCampaign(db,user,now,clock);
  const policy=await cyclePolicy(db,clock,now),current=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);
  for(let attempt=0;attempt<3;attempt++){
    await requireAccountAccess(db,account);
    let save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock});
    if(row.cycle_index===null||row.cycle_index===undefined){
      const index=Math.max(policy,Math.floor((save.state.worldClock?.elapsedMs??clock.elapsedMs)/WORLD_CYCLE_MS)),home=user.is_admin?'edo':save.state.home;
      save.state.cycle={index,home,latestReward:null};
      const roleGuard=roleCommitGuard(user);const updated=await stmt(db,`UPDATE player_saves SET save_json=?,cycle_index=?,cycle_home=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND cycle_index IS NULL AND ${roleGuard.sql} RETURNING *`,JSON.stringify(save),index,home,now,user.id,row.revision,...roleGuard.args).first();
      if(updated)row=updated;else{row=await getSyncRow(db,user.id);continue;}
    }
    if(Number(row.cycle_index)>=current||writerDeviceId&&(row.writer_device_id!==writerDeviceId||Number(row.lease_expires_at)<=now)||deferActive&&Number(row.lease_expires_at)>now)return row;
    save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock});
    const index=Number(row.cycle_index),home=user.is_admin?'edo':row.cycle_home||save.state.home;
    save.state.cycle={index,home,latestReward:save.state.cycle?.latestReward||null};
    if(!save.state.worldClock){const elapsed=index*WORLD_CYCLE_MS+(save.state.turn%WORLD_CYCLE_MONTHS)*WORLD_MONTH_MS+Math.floor(save.state.realtime.elapsed*1000);save.state.turn=Math.floor(elapsed/WORLD_MONTH_MS);save.state.realtime.elapsed=(elapsed%WORLD_MONTH_MS)/1000;save.state.worldClock={id:WORLD_CLOCK_ID,elapsedMs:elapsed};}
    await reconcileCovertProgress(db,user.id,save);
    const staffBase=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
    const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase});
    const target=Math.min(current*WORLD_CYCLE_MS,(index+2)*WORLD_CYCLE_MS);
    const result=game.applyWorldClock({...clock,elapsedMs:target},{maxSeconds:86400});
    if(!result.ok||!result.changed)return row;
    const next=normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock});next.savedAt=iso(now);
    const rewards=result.cycleRewards||[],nonce=crypto.randomUUID(),serialized=JSON.stringify(next),roleGuard=roleCommitGuard(user);
    const gate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)',gateParams=[user.id,nonce];
    const batch=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_index=?,cycle_home=?,cycle_commit=?
      WHERE user_id=? AND revision=? AND cycle_index=?
      AND ((? IS NOT NULL AND writer_device_id=? AND lease_expires_at>?) OR (? IS NULL AND lease_expires_at<=?))
      AND (SELECT revision FROM world_clock WHERE id=?)=?
      AND ${roleGuard.sql}
      AND NOT EXISTS(SELECT 1 FROM cycle_receipts WHERE user_id=? AND cycle_index>=? AND cycle_index<?) RETURNING *`,serialized,now,next.state.cycle.index,next.state.cycle.home,nonce,user.id,row.revision,index,writerDeviceId,writerDeviceId,now,writerDeviceId,now,WORLD_CLOCK_ID,clock.revision,...roleGuard.args,user.id,index,next.state.cycle.index)];
    batch.push(...covertIncidentStatements(db,user.id,next,now,gate,gateParams));
    const personal=await staffPersonalProgressStatement(db,user,next,now,gate,gateParams,game.getStaffPersonalProgress?.());if(personal)batch.push(personal);
    for(const event of saveAchievements(save,next))batch.push(achievementStatement(db,user.id,event,now,gate,gateParams));
    for(const reward of rewards){batch.push(stmt(db,`INSERT INTO cycle_receipts(user_id,cycle_index,captured,gold,rice,magatama,commit_token,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,user.id,reward.cycle,reward.captured,reward.gold,reward.rice,reward.magatama,nonce,now,...gateParams));if(reward.captured)batch.push(achievementStatement(db,user.id,cycleEvent(reward),now,gate,gateParams));}
    if(rewards.length)batch.push(stmt(db,`DELETE FROM field_relations WHERE (user_a=? OR user_b=?) AND updated_elapsed_ms<? AND ${gate}`,user.id,user.id,next.state.cycle.index*WORLD_CYCLE_MS,...gateParams));
    const executed=await db.batch(batch),changed=rows(executed[0])[0];if(changed)return changed;
    row=await getSyncRow(db,user.id);user=await getUser(db,user.id);clock=await getWorldClock(db,now);
  }
  return row;
}
async function publicAchievements(db,url,now) {
  const raw=url.searchParams.get('limit')||'20',cursor=url.searchParams.get('cursor');
  if(!/^\d{1,2}$/.test(raw)||Number(raw)<1||Number(raw)>50)fail(400,'INVALID_INPUT','お知らせの件数は1〜50件で指定してください。');
  let point=null;if(cursor){if(cursor.length>512)fail(400,'INVALID_CURSOR','お知らせの続きが長すぎます。');try{point=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));}catch{fail(400,'INVALID_CURSOR','お知らせの続きが正しくありません。');}if(!Array.isArray(point)||point.length!==2||!Number.isSafeInteger(point[0])||point[0]<0||typeof point[1]!=='string'||!/^ach_[a-f0-9]{32}$/.test(point[1]))fail(400,'INVALID_CURSOR','お知らせの続きが正しくありません。');}
  const limit=Number(raw),found=rows(await stmt(db,`SELECT e.*,u.name,u.clan,CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,(SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan FROM achievement_events e JOIN users u ON u.id=e.user_id WHERE NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1) ${point?'AND (e.occurred_at<? OR (e.occurred_at=? AND e.id<?))':''} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`,...(point?[point[0],point[0],point[1]]:[]),limit+1).all()),page=found.slice(0,limit),last=page.at(-1);
  return {ok:true,events:page.map(row=>({id:row.id,playerId:row.user_id,playerName:row.name,playerEvaluation:evaluationRef(row.user_id),clan:publicClan(row.clan,row.is_admin,row.is_staff,row.personal_clan),kind:row.kind,title:row.title,detail:row.detail,targetId:row.target_id,targetName:row.target_name,value:row.value,occurredAt:iso(row.occurred_at)})),nextCursor:found.length>limit?btoa(JSON.stringify([Number(last.occurred_at),last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,serverNow:iso(now)};
}

function roleCommitGuard(user) {
  const access=accountCommitGuard(user);return {sql:`(?=CASE WHEN ?=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN 1 ELSE 0 END) AND COALESCE((SELECT COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=?),'')=? AND ${access.sql}`,args:[user.is_admin?1:0,user.id,user.id,user.staff_term||'',...access.args]};
}
async function requireCurrentStaffBase(db,user,{allowAdmin=false}={}) {await requireAccountAccess(db,user);const current=await getUser(db,user.id);if(!current||!(allowAdmin?current.is_admin||current.is_staff:current.is_staff&&!current.is_admin)||current.staff_term!==user.staff_term||!!current.is_admin!==!!user.is_admin)fail(403,'STAFF_BASE_REQUIRED','スタッフの役職が変更されました。');return current;}
const STAFF_TERM_SQL="COALESCE(sm.term_id,'legacy:'||sm.appointed_at)";
const STAFF_MEMBER_GUARD=`EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=? AND ${STAFF_TERM_SQL}=?) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)`;
function staffInitialState(elapsed) {
  const game=new GameEngine({officers:GAME_OFFICERS,isStaff:true,seed:1});
  const initial={castleLevel:1,buildings:copy(game.state.buildings)};
  return {initial,castleLevel:1,buildings:copy(initial.buildings),jobs:[],history:[],createdElapsedMs:elapsed,updatedElapsedMs:elapsed};
}
async function sharedStaffBaseRow(db,clock,now) {
  let row=await stmt(db,"SELECT * FROM staff_base WHERE id='sunpu'").first();
  if(!row){await stmt(db,"INSERT INTO staff_base(id,state_json,updated_at) VALUES('sunpu',?,?) ON CONFLICT(id) DO NOTHING",JSON.stringify(staffInitialState(clock.elapsedMs)),now).run();row=await stmt(db,"SELECT * FROM staff_base WHERE id='sunpu'").first();}
  for(let attempt=0;attempt<3;attempt++){
    const state=JSON.parse(row.state_json),due=state.jobs.filter(job=>job.completesElapsedMs<=clock.elapsedMs).sort((a,b)=>a.completesElapsedMs-b.completesElapsedMs);
    if(!due.length)return row;
    for(const job of due){if(job.kind==='castle')state.castleLevel=job.targetLevel;else state.buildings[job.id]=job.targetLevel;state.history.push({jobId:job.jobId,kind:job.kind,id:job.id,level:job.targetLevel,effectiveElapsedMs:job.completesElapsedMs});state.updatedElapsedMs=job.completesElapsedMs;}
    state.history.sort((a,b)=>a.effectiveElapsedMs-b.effectiveElapsedMs);state.jobs=state.jobs.filter(job=>job.completesElapsedMs>clock.elapsedMs);
    const nonce=crypto.randomUUID(),gate="EXISTS(SELECT 1 FROM staff_base WHERE id='sunpu' AND commit_token=?)";
    const statements=[stmt(db,"UPDATE staff_base SET state_json=?,revision=revision+1,commit_token=?,updated_at=? WHERE id='sunpu' AND revision=? AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) RETURNING *",JSON.stringify(state),nonce,now,row.revision,WORLD_CLOCK_ID,clock.revision)];
    for(const job of due){const name=job.kind==='castle'?'駿府城':globalThis.SENGOKU_DATA.buildings.find(b=>b.id===job.id).name;statements.push(achievementStatement(db,job.startedBy.id,{key:'staff-build:'+job.jobId,kind:'staff-building',targetId:job.id,targetName:name,value:job.targetLevel,title:`駿府城の${job.kind==='castle'?'城郭':name} Lv.${job.targetLevel}の共同普請を達成`,detail:'全スタッフの共同拠点へ成長が反映されました。'},now,gate,[nonce]));}
    const result=await db.batch(statements);if(rows(result[0])[0])return rows(result[0])[0];row=await stmt(db,"SELECT * FROM staff_base WHERE id='sunpu'").first();clock=await getWorldClock(db,now);
  }
  return row;
}
async function staffClanPolicy(db,clock,now) {
  const prior=await stmt(db,"SELECT value FROM settings WHERE key='staffClanPolicyStart'").first();if(prior)return Number(prior.value);
  await stmt(db,"INSERT INTO settings(key,value,updated_at) VALUES('staffClanPolicyStart',?,?) ON CONFLICT(key) DO NOTHING",String(clock.elapsedMs),now).run();
  return Number((await stmt(db,"SELECT value FROM settings WHERE key='staffClanPolicyStart'").first()).value);
}
async function staffBaseDto(db,user,clock,now,row=undefined) {
  row=row||await sharedStaffBaseRow(db,clock,now);const state=JSON.parse(row.state_json),backup=await stmt(db,'SELECT joined_elapsed_ms,save_json FROM staff_campaign_backups WHERE user_id=? AND active=1',user.id).first();
  const personal=backup?.save_json?JSON.parse(backup.save_json).state:null,accessSince=Number(backup?.joined_elapsed_ms??user.staff_since_ms??clock.elapsedMs),clanSince=Math.max(accessSince,await staffClanPolicy(db,clock,now));
  const personalHomeCastle=personal?copy(personal.castles[personal.home]):null;
  if(personalHomeCastle&&FIELD_CAPTURE_CASTLES.includes(personal.home)&&Number.isInteger(personalHomeCastle.level)&&personalHomeCastle.level>=49&&personalHomeCastle.level<=64)personalHomeCastle.level=48;
  return {id:'sunpu',revision:Number(row.revision),protected:true,...state,accessSinceElapsedMs:accessSince,clanSinceElapsedMs:clanSince,...(personal?{personalClan:personal.clan,personalHome:personal.home,personalCycleHome:personal.cycle?.home||personal.home,personalHomeCastle,personalSunpu:copy(personal.castles.sunpu)}:{})};
}
async function tradeTroopCapacity(db,user,save,clock,now) {
  const staffBase=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{isAdmin:!!user.is_admin,isStaff:!!user.is_staff,staffBase});
  return Math.max(0,Math.min(1000000,Math.floor(game.troopCapacity())));
}
function renameCampaignClan(state,clan) {if(state.clan===clan)return;const previous=state.clan;for(const castle of Object.values(state.castles)){if(castle.owner===previous)castle.owner=clan;else if(castle.owner===clan)castle.owner='在地衆';}state.clan=clan;delete state.treaties[clan];}
function restorePersonalCampaign(save,backup,user) {
  const s=save.state,original=JSON.parse(backup.save_json).state;renameCampaignClan(s,CLAN_HOMES[original.clan]?original.clan:ORDINARY_TOKUGAWA_CLAN);
  let home=original.home;if(['edo','sunpu'].includes(home))home=CLAN_HOMES[s.clan]||'kiyosu';
  const oldCastle=original.castles[original.home],current=s.castles[home];
  s.castles[home]={owner:s.clan,troops:Math.max(current.troops,oldCastle.troops),wall:Math.max(current.wall,oldCastle.wall,s.buildings.wall),level:Math.min(castleLevelLimit(home),Math.max(current.level,oldCastle.level))};
  s.home=home;if(s.cycle)s.cycle.home=['edo','sunpu'].includes(original.cycle?.home)?home:original.cycle?.home||home;
  const def=globalThis.SENGOKU_DATA.castles.find(c=>c.id==='sunpu');s.castles.sunpu={owner:def.clan===s.clan?'在地衆':def.clan,troops:def.initialTroops,wall:def.wall,level:1};
  s.captureRewards=[...new Set([...s.captureRewards.filter(id=>id!=='sunpu'),home])];
  s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.id!=='sunpu');
  for(const job of s.jobs)if(job.kind==='castle'&&job.id===home)job.targetLevel=s.castles[home].level+1;
  s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.targetLevel<=castleLevelLimit(job.id));
  s.governors=Object.fromEntries(Object.entries(s.governors).filter(([id])=>s.buildings[id]>0));s.command=Math.min(s.command,3+Math.floor(s.buildings.keep/8));s.gameOver=false;
  return save;
}
// Personal campaign development is retained separately from the shared base.
// This metadata never grants a role, and every write is gated by the parent
// save mutation, so failed/replayed operations cannot change either copy.
async function staffPersonalProgressStatement(db,user,save,now,gate,gateArgs,progress=null,capture=null) {
  const backup=await stmt(db,'SELECT * FROM staff_campaign_backups WHERE user_id=? AND active=1',user.id).first();if(!backup)return null;
  const personal=JSON.parse(backup.save_json),home=personal.state.home,old=personal.state.castles[home];
  const current=progress?.home===home?progress.castle:save.state.castles[home];
  if(current&&(current.owner===save.state.clan||progress&&current.owner===personal.state.clan))for(const key of ['level','wall','troops'])old[key]=Math.max(old[key],current[key]);
  old.level=Math.min(castleLevelLimit(home),old.level);
  // A staff member's original home can also be a public outpost. Its loss must
  // reach the personal metadata in this same transaction, or dismissal would
  // recreate that city from the original appointment backup.
  if(capture){const lost=personal.state.castles[capture.castleId];if(home===capture.castleId)for(const key of ['level','wall','troops'])lost[key]=capture.castle[key];fieldLoseCastle(personal.state,capture.castleId,capture.fallbackHomeId);}
  return stmt(db,`UPDATE staff_campaign_backups SET save_json=?,updated_at=? WHERE user_id=? AND active=1 AND term_id=? AND ${gate}`,JSON.stringify(personal),now,user.id,backup.term_id,...gateArgs);
}
async function advanceDepartingStaff(db,row,user,backup,now,clock) {
  const until=Math.min(clock.elapsedMs,Number(backup.left_elapsed_ms??(user.staff_term!==backup.term_id?user.staff_since_ms:null)??clock.elapsedMs));
  const historical={...user,is_admin:false,is_staff:1,staff_term:backup.term_id},save=normalizeGameSave(JSON.parse(row.save_json),historical,now,{reading:true,clock});
  if(save.state.worldClock&&save.state.worldClock.elapsedMs>=until)return row;
  await reconcileCovertProgress(db,user.id,save);
  const base=await staffBaseDto(db,historical,clock,now),game=GameEngine.fromSave(save,GAME_OFFICERS,{isStaff:true,staffBase:base});
  const result=game.applyWorldClock({...clock,elapsedMs:until},{maxSeconds:86400});if(!result.ok||!result.changed)return row;
  const next=normalizeGameSave(JSON.parse(game.exportSave()),historical,now,{reading:true,clock}),nonce=crypto.randomUUID(),roleGuard=roleCommitGuard(user),rewards=result.cycleRewards||[];
  const gate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)',args=[user.id,nonce];
  const statements=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_index=?,cycle_home=?,cycle_commit=?
    WHERE user_id=? AND revision=? AND ${roleGuard.sql} AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND active=1 AND term_id=?)
    AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)
    AND NOT EXISTS(SELECT 1 FROM cycle_receipts WHERE user_id=? AND cycle_index>=? AND cycle_index<?) RETURNING *`,JSON.stringify(next),now,next.state.cycle.index,next.state.cycle.home,nonce,user.id,row.revision,...roleGuard.args,user.id,backup.term_id,WORLD_CLOCK_ID,clock.revision,user.id,save.state.cycle.index,next.state.cycle.index)];
  statements.push(...covertIncidentStatements(db,user.id,next,now,gate,args));
  const personal=await staffPersonalProgressStatement(db,user,next,now,gate,args,game.getStaffPersonalProgress?.());if(personal)statements.push(personal);
  for(const event of saveAchievements(save,next))statements.push(achievementStatement(db,user.id,event,now,gate,args));
  for(const reward of rewards){statements.push(stmt(db,`INSERT INTO cycle_receipts(user_id,cycle_index,captured,gold,rice,magatama,commit_token,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,user.id,reward.cycle,reward.captured,reward.gold,reward.rice,reward.magatama,nonce,now,...args));if(reward.captured)statements.push(achievementStatement(db,user.id,cycleEvent(reward),now,gate,args));}
  if(rewards.length)statements.push(stmt(db,`DELETE FROM field_relations WHERE (user_a=? OR user_b=?) AND updated_elapsed_ms<? AND ${gate}`,user.id,user.id,next.state.cycle.index*WORLD_CYCLE_MS,...args));
  const changed=rows((await db.batch(statements))[0])[0];
  if(!changed)fail(409,'STAFF_ROLE_CHANGED','役職と個人進行が更新されました。もう一度同期してください。');
  if(result.pending)fail(409,'STAFF_TRANSITION_PENDING','スタッフ任期中の進行を引き継いでいます。自動同期で続きを反映します。');
  return changed;
}

async function ensureStaffCampaign(db,user,now,clock=undefined,{deferClanMigration=false}={}) {
  const account=user,access=accountCommitGuard(user);
  clock=clock||await getWorldClock(db,now);let row=await getSyncRow(db,user.id);if(!row?.save_json)return row;
  for(let attempt=0;attempt<3;attempt++){
    await requireAccountAccess(db,account);
    const staff=!!user.is_staff&&!user.is_admin;let backup=await stmt(db,'SELECT * FROM staff_campaign_backups WHERE user_id=?',user.id).first();
    if(staff&&backup?.active&&backup.term_id===user.staff_term){
      if(deferClanMigration||JSON.parse(row.save_json).state.clan===ADMIN_CLAN)return row;
      const next=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}),guard=roleCommitGuard(user);
      const changed=await stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND ${guard.sql} RETURNING *`,JSON.stringify(next),now,user.id,row.revision,...guard.args).first();
      if(changed)return changed;user=await getUser(db,user.id);row=await getSyncRow(db,user.id);continue;
    }
    if(!staff&&!backup?.active)return row;
    if(backup?.active){row=await advanceDepartingStaff(db,row,user,backup,now,clock);backup=await stmt(db,'SELECT * FROM staff_campaign_backups WHERE user_id=?',user.id).first();}
    const raw=JSON.parse(row.save_json),nonce=crypto.randomUUID();let saved,personal;
    if(staff){
      if(!backup?.active&&raw.state.clan===ADMIN_CLAN&&raw.state.home==='sunpu')renameCampaignClan(raw.state,CLAN_HOMES[user.clan]?user.clan:ORDINARY_TOKUGAWA_CLAN);
      personal=backup?.active?restorePersonalCampaign(normalizeGameSave(raw,{...user,is_admin:false,is_staff:true},now,{reading:true,clock}),backup,user):normalizeGameSave(raw,{...user,is_staff:false},now,{reading:true,clock});
      saved=normalizeGameSave(personal,user,now,{reading:true,clock});saved.state.staffService={baseId:'sunpu'};saved.savedAt=iso(now);
      const joined=Math.max(Number(user.staff_since_ms??clock.elapsedMs),Number(personal.state.worldClock?.elapsedMs||0));
      const result=await db.batch([
        stmt(db,`INSERT INTO staff_campaign_backups(user_id,term_id,save_json,joined_elapsed_ms,left_elapsed_ms,active,transition_token,updated_at)
          SELECT ?,?,?,?,NULL,1,?,? WHERE ${STAFF_MEMBER_GUARD} AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND ${access.sql}
          ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,save_json=excluded.save_json,joined_elapsed_ms=excluded.joined_elapsed_ms,left_elapsed_ms=NULL,active=1,transition_token=excluded.transition_token,updated_at=excluded.updated_at`,user.id,user.staff_term,JSON.stringify(personal),joined,nonce,now,user.id,user.staff_term,user.id,user.id,row.revision,...access.args),
        stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home='sunpu' WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND transition_token=?) RETURNING *`,JSON.stringify(saved),now,user.id,row.revision,user.id,nonce)
      ]);if(rows(result[1])[0])return rows(result[1])[0];
    }else{
      saved=restorePersonalCampaign(normalizeGameSave(raw,{...user,is_admin:false,is_staff:true},now,{reading:true,clock}),backup,user);saved=normalizeGameSave(saved,user,now,{reading:true,clock});saved.savedAt=iso(now);
      const result=await db.batch([
        stmt(db,`UPDATE staff_campaign_backups SET active=0,transition_token=?,updated_at=? WHERE user_id=? AND active=1 AND term_id=?
          AND (NOT EXISTS(SELECT 1 FROM staff_members WHERE user_id=?) OR EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?))
          AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND ${access.sql}`,nonce,now,user.id,backup.term_id,user.id,user.id,user.id,row.revision,...access.args),
        stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND transition_token=?) RETURNING *`,JSON.stringify(saved),now,saved.state.cycle?.home||saved.state.home,user.id,row.revision,user.id,nonce),
        stmt(db,`UPDATE users SET clan=? WHERE id=? AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND transition_token=?)`,saved.state.clan,user.id,user.id,nonce)
      ]);if(rows(result[1])[0])return rows(result[1])[0];
    }
    user=await getUser(db,user.id);row=await getSyncRow(db,user.id);
  }
  fail(409,'STAFF_ROLE_CHANGED','スタッフの役職と本拠を再確認してください。');
}
async function staffBaseUpgrade(db,user,raw,now) {
  if(!user.is_staff||user.is_admin)fail(403,'STAFF_BASE_REQUIRED','スタッフとして駿府城へ接続してください。');
  if(Object.keys(raw).some(k=>!['kind','id','requestId','deviceId','expectedRevision','baseRevision'].includes(k))||!['building','castle'].includes(raw.kind))fail(400,'INVALID_INPUT','共同普請の指定が正しくありません。');
  const body={...raw,id:idField(raw.id,'普請する施設'),requestId:idField(raw.requestId,'操作番号'),deviceId:idField(raw.deviceId,'端末')};
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<0||body.kind==='castle'&&body.id!=='sunpu'||body.kind==='building'&&!BUILDINGS.some(b=>b.id===body.id))fail(400,'INVALID_INPUT','共同普請の対象と更新番号を確認してください。');
  const digest=await hash(JSON.stringify([body.kind,body.id,body.baseRevision]));
  const prior=await stmt(db,'SELECT * FROM staff_base_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();
  if(prior){user=await requireCurrentStaffBase(db,user);if(prior.request_hash!==digest)fail(409,'REQUEST_ID_REUSED','この操作番号は別の共同普請に使われています。');return {...await syncSnapshot(db,await getSyncRow(db,user.id),user,body.deviceId,now),receipt:JSON.parse(prior.result_json),idempotent:true};}
  await budget(db,'staff-build:'+user.id,30,60000,now);
  const row=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now),clock=await getWorldClock(db,now);
  if(!clock.running)fail(409,'WORLD_PAUSED','共通時間を再開してから普請してください。');
  const shared=await sharedStaffBaseRow(db,clock,now);if(Number(shared.revision)!==body.baseRevision)fail(409,'STAFF_BASE_CHANGED','別のスタッフが共同拠点を更新しました。最新の駿府城を確認してください。');
  const base=await staffBaseDto(db,user,clock,now,shared),save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock});
  if(!save.state.worldClock||clock.elapsedMs-save.state.worldClock.elapsedMs>15000)fail(409,'CLOCK_STALE','共通時刻と個人資源へ同期してから普請してください。');
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{isStaff:true,staffBase:base});game._projectStaffAt(clock.elapsedMs);
  const state=JSON.parse(shared.state_json),chain=state.jobs.filter(j=>j.kind===body.kind&&j.id===body.id).sort((a,b)=>a.targetLevel-b.targetLevel),tail=chain.at(-1),level=body.kind==='castle'?state.castleLevel:tail?.targetLevel??state.buildings[body.id],max=body.kind==='castle'?64:32;
  if(level>=max)fail(409,'BUILDING_MAX','最高レベルに到達しています。');
  if(body.kind==='castle'&&chain.length)fail(409,'STAFF_BUILDING_BUSY','この城郭の共同普請は進行中です。');
  if(!chain.length&&new Set(state.jobs.map(j=>j.kind+':'+j.id)).size>=2+Math.floor(state.buildings.keep/8))fail(409,'STAFF_BUILDING_SLOTS','共同普請の枠が埋まっています。');
  if(body.kind==='building'&&!game.buildingUnlock(body.id).ok)fail(409,'BUILDING_LOCKED',game.buildingUnlock(body.id).reason);
  const cost=body.kind==='castle'?game.castleUpgradeCost('sunpu'):game.costs(body.id,level);if(game.state.command<1)fail(409,'COMMAND_REQUIRED','指示の回復をお待ちください。');
  if(RESOURCES.some(k=>game.state.resources[k]<(cost[k]||0)))fail(409,'INSUFFICIENT_ASSETS','共同普請に必要な個人資源が足りません。');
  const startedElapsedMs=tail?Math.max(clock.elapsedMs,tail.completesElapsedMs):clock.elapsedMs;
  game._pay(cost);game.state.command--;const job={jobId:uid('sb_'),kind:body.kind,id:body.id,targetLevel:level+1,totalSeconds:cost.seconds,queuedAtElapsedMs:clock.elapsedMs,startedElapsedMs,completesElapsedMs:startedElapsedMs+cost.seconds*1000,startedBy:{id:user.id,name:user.name}};
  state.jobs.push(job);state.updatedElapsedMs=clock.elapsedMs;
  const receipt={requestId:body.requestId,jobId:job.jobId,kind:body.kind,id:body.id,targetLevel:job.targetLevel,cost:pick(cost,RESOURCES),queued:job.startedElapsedMs>clock.elapsedMs,queuePosition:chain.length,queuedAtElapsedMs:clock.elapsedMs,startedElapsedMs:job.startedElapsedMs,completesElapsedMs:job.completesElapsedMs,baseRevision:Number(shared.revision)+1,playerRevision:Number(row.revision)+1};
  game.log(`駿府城の${body.kind==='castle'?'城郭':globalThis.SENGOKU_DATA.buildings.find(b=>b.id===body.id).name} Lv.${job.targetLevel}へ共同普請を${receipt.queued?'予約':'開始'}しました。`,'staff-build');
  const next=normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM staff_base_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',gateArgs=[user.id,body.requestId,nonce],access=accountCommitGuard(user);
  const result=await db.batch([
    stmt(db,`INSERT INTO staff_base_requests(actor_id,request_id,request_hash,commit_token,result_json,created_at)
      SELECT ?,?,?,?,?,? FROM player_saves ps JOIN staff_base sb ON sb.id='sunpu'
      WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND sb.revision=?
      AND ${STAFF_MEMBER_GUARD} AND ${access.sql} AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1)
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,nonce,JSON.stringify(receipt),now,user.id,row.revision,body.deviceId,now,shared.revision,user.id,user.staff_term,user.id,...access.args,WORLD_CLOCK_ID,clock.revision),
    stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+SYNC_LEASE,user.id,...gateArgs),
    stmt(db,`UPDATE staff_base SET state_json=?,revision=revision+1,commit_token=?,updated_at=? WHERE id='sunpu' AND ${gate}`,JSON.stringify(state),nonce,now,...gateArgs)
  ]);
  if(!rows(result[0]).length){const accepted=await stmt(db,'SELECT * FROM staff_base_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();if(accepted&&accepted.request_hash===digest){await requireCurrentStaffBase(db,user);return {...await syncSnapshot(db,await getSyncRow(db,user.id),await getUser(db,user.id),body.deviceId,now),receipt:JSON.parse(accepted.result_json),idempotent:true};}const current=await getUser(db,user.id);if(!current.is_staff||current.is_admin||current.staff_term!==user.staff_term)fail(403,'STAFF_BASE_REQUIRED','スタッフの役職が変更されました。');fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);fail(409,'STAFF_BASE_CHANGED','共同拠点が更新されました。最新の状態を確認してください。');}
  return {...await syncSnapshot(db,await getSyncRow(db,user.id),user,body.deviceId,now),receipt,idempotent:false};
}

async function walkingAccount(db,userId){
  await stmt(db,'INSERT INTO walking_accounts(user_id) VALUES(?) ON CONFLICT(user_id) DO NOTHING',userId).run();
  return stmt(db,'SELECT * FROM walking_accounts WHERE user_id=?',userId).first();
}
async function walkingToken(db,session){
  let secret=await stmt(db,"SELECT value FROM settings WHERE key='walkingSigningKey'").first();
  if(!secret){await stmt(db,"INSERT INTO settings(key,value,updated_at) VALUES('walkingSigningKey',?,?) ON CONFLICT(key) DO NOTHING",gameToken(),Date.now()).run();secret=await stmt(db,"SELECT value FROM settings WHERE key='walkingSigningKey'").first();}
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret.value),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const message=JSON.stringify(['sengoku:walking:v1',session.user_id,session.id,session.campaign_id,Number(session.started_at)]);
  const signed=await crypto.subtle.sign('HMAC',key,encoder.encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(signed))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
async function walkingSessionDto(db,session,account){
  return{id:session.id,token:await walkingToken(db,session),campaignId:session.campaign_id,startedAt:iso(session.started_at),lastSeenAt:iso(session.last_seen_at),expiresAt:iso(session.expires_at),lastSeq:Number(session.last_seq),totalSteps:Number(session.total_steps),activeMs:Number(session.active_ms),closed:!!session.closed||account.active_session_id!==session.id};
}
async function walkingResponse(db,user,deviceId,session,now,extra={}){
  const account=await walkingAccount(db,user.id),current=await getUser(db,user.id);
  return{...await syncSnapshot(db,await getSyncRow(db,user.id),current,deviceId,now),walkingSession:await walkingSessionDto(db,session,account),walkingRules:WALKING_RULES,...extra};
}
function walkingBody(raw,kind){
  const allowed=kind==='start'?['requestId','deviceId','expectedRevision','campaignId']:['sessionId','sessionToken','seq','totalSteps','activeMs','finish','deviceId','expectedRevision'];
  if(Object.keys(raw).some(k=>!allowed.includes(k))||!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0)fail(400,'INVALID_INPUT','歩行計測の送信内容と更新番号を確認してください。');
  const body={...raw,deviceId:idField(raw.deviceId,'端末')};
  if(kind==='start')return{...body,requestId:idField(raw.requestId,'操作番号'),campaignId:idField(raw.campaignId,'物語の識別子')};
  body.sessionId=idField(raw.sessionId,'歩行計測');body.sessionToken=idField(raw.sessionToken,'歩行計測の署名');body.finish=raw.finish??false;
  if(!Number.isSafeInteger(body.seq)||body.seq<1||!Number.isSafeInteger(body.totalSteps)||body.totalSteps<0||body.totalSteps>MAX_WALKING_STEPS||!Number.isSafeInteger(body.activeMs)||body.activeMs<0||typeof body.finish!=='boolean')fail(400,'INVALID_INPUT','歩数・計測時間・送信番号を確認してください。');
  return body;
}
function walkingCampaign(row){try{return GameEngine.normalizeWalkingState(JSON.parse(row.save_json).state.walking).campaignId;}catch{return null;}}
async function walkingStart(db,user,raw,now){
  const body=walkingBody(raw,'start');
  let prior=await stmt(db,'SELECT * FROM walking_sessions WHERE user_id=? AND request_id=?',user.id,body.requestId).first();
  if(prior){if(prior.campaign_id!==body.campaignId)fail(409,'REQUEST_ID_REUSED','この操作番号は別の物語に使われています。');return walkingResponse(db,user,body.deviceId,prior,now,{idempotent:true});}
  await budget(db,'walking-start:'+user.id,30,60000,now);
  const row=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);
  if(walkingCampaign(row)!==body.campaignId)fail(409,'WALKING_CAMPAIGN_CHANGED','物語が切り替わりました。歩行計測を開始し直してください。');
  const account=await walkingAccount(db,user.id),nonce=crypto.randomUUID(),id=uid('walk_'),role=roleCommitGuard(user);
  const gate='EXISTS(SELECT 1 FROM walking_sessions WHERE id=? AND commit_token=?)';
  const commitNow=Date.now();
  const result=await db.batch([
    stmt(db,`INSERT INTO walking_sessions(id,user_id,request_id,campaign_id,started_at,last_seen_at,expires_at,commit_token)
      SELECT ?,?,?,?,?,?,?,? FROM player_saves ps JOIN walking_accounts wa ON wa.user_id=ps.user_id
      WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND wa.revision=?
      AND COALESCE(json_extract(ps.save_json,'$.state.walking.campaignId'),'legacy_v1')=? AND ${role.sql}
      AND NOT EXISTS(SELECT 1 FROM walking_sessions old WHERE old.id=wa.active_session_id AND old.closed=0 AND old.expires_at>? AND old.campaign_id=?)
      ON CONFLICT(user_id,request_id) DO NOTHING RETURNING *`,id,user.id,body.requestId,body.campaignId,now,now,now+WALKING_RULES.windowMs,nonce,user.id,row.revision,body.deviceId,commitNow,account.revision,body.campaignId,...role.args,commitNow,body.campaignId),
    stmt(db,`UPDATE walking_accounts SET active_session_id=?,revision=revision+1 WHERE user_id=? AND ${gate}`,id,user.id,id,nonce)
  ]);
  const session=rows(result[0])[0];
  if(!session){prior=await stmt(db,'SELECT * FROM walking_sessions WHERE user_id=? AND request_id=?',user.id,body.requestId).first();if(prior&&prior.campaign_id===body.campaignId)return walkingResponse(db,user,body.deviceId,prior,now,{idempotent:true});
    const current=await getSyncRow(db,user.id);fieldWriter(current,body.deviceId,body.expectedRevision,now);if(walkingCampaign(current)!==body.campaignId)fail(409,'WALKING_CAMPAIGN_CHANGED','物語が切り替わりました。');
    const active=await stmt(db,'SELECT ws.* FROM walking_sessions ws JOIN walking_accounts wa ON wa.active_session_id=ws.id WHERE wa.user_id=?',user.id).first();
    if(active&&!active.closed&&Number(active.expires_at)>now&&active.campaign_id===body.campaignId)fail(409,'WALKING_ACTIVE','別の歩行計測が続いています。現在の計測を終了してから開始してください。');
    fail(409,'WALKING_CHANGED','接続や役職が更新されました。同期してから歩行計測を開始してください。');
  }
  return walkingResponse(db,user,body.deviceId,session,now,{idempotent:false});
}
async function walkingClaim(db,user,raw,now){
  const body=walkingBody(raw,'claim');
  let session=await stmt(db,'SELECT * FROM walking_sessions WHERE id=? AND user_id=?',body.sessionId,user.id).first();
  if(!session||!await constantEqual(body.sessionToken,await walkingToken(db,session)))fail(403,'WALKING_SESSION_INVALID','歩行計測の接続を確認できません。');
  const digest=await hash(JSON.stringify([body.seq,body.totalSteps,body.activeMs,body.finish]));
  let prior=await stmt(db,'SELECT * FROM walking_receipts WHERE session_id=? AND seq=?',session.id,body.seq).first();
  if(prior){if(prior.request_hash!==digest)fail(409,'WALKING_SEQUENCE_REUSED','この送信番号は別の歩数に使われています。');return walkingResponse(db,user,body.deviceId,session,now,{receipt:JSON.parse(prior.result_json),idempotent:true});}
  await budget(db,'walking-claim:'+user.id,120,60000,now);
  const row=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now),account=await walkingAccount(db,user.id);
  if(walkingCampaign(row)!==session.campaign_id)fail(409,'WALKING_CAMPAIGN_CHANGED','物語が切り替わったため、前の歩数は追加できません。');
  if(session.closed||account.active_session_id!==session.id)fail(409,'WALKING_SESSION_CLOSED','この歩行計測は終了しています。');
  if(body.seq!==Number(session.last_seq)+1||body.totalSteps<Number(session.total_steps)||body.activeMs<Number(session.active_ms))fail(409,'WALKING_SEQUENCE_CONFLICT','受取済みの歩数と送信番号を確認してください。');
  // A quiet sensor or suspended page keeps its session. The active-session
  // binding and current writer lease still prevent a replaced session resuming.
  const delta=body.totalSteps-Number(session.total_steps),activeDelta=body.activeMs-Number(session.active_ms),realDelta=Math.max(0,now-Number(session.last_seen_at)),realTotal=Math.max(0,now-Number(session.started_at));
  // Session-wide limits have no jitter allowance: start/finish loops and zero
  // duration heartbeats cannot manufacture extra steps. Jitter applies only to
  // individual delivery intervals, bounded by the strict cumulative envelope.
  if(body.activeMs>realTotal||activeDelta>Math.min(realDelta+WALKING_RULES.deliveryToleranceMs,WALKING_RULES.windowMs)||body.totalSteps>Math.floor(Math.min(body.activeMs,realTotal)*4/1000)||delta>Math.floor(Math.min(activeDelta,realDelta+WALKING_RULES.deliveryToleranceMs,WALKING_RULES.windowMs)*4/1000)+WALKING_RULES.jitterSteps||delta>0&&(activeDelta===0||realDelta<250))fail(400,'WALKING_RATE_EXCEEDED','歩数または計測時間が歩行の範囲を超えています。');
  if(Number(account.total_steps)+delta>MAX_WALKING_STEPS)fail(400,'WALKING_TOTAL_EXCEEDED','歩数の累計が保存できる範囲を超えています。');
  const clock=await getWorldClock(db,now),save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}),s=save.state;
  const rewards=Object.fromEntries([...RESOURCES,'magatama'].map(k=>[k,Math.min(999999999-(k==='magatama'?s.magatama:s.resources[k]),delta*2)]));
  for(const k of RESOURCES)s.resources[k]+=rewards[k];s.magatama+=rewards.magatama;s.walking.serverSteps=Number(account.total_steps)+delta;save.savedAt=iso(now);
  const nonce=crypto.randomUUID(),revision=Number(row.revision)+(delta>0?1:0),receipt={id:session.id+':'+body.seq,sessionId:session.id,seq:body.seq,totalSteps:body.totalSteps,deltaSteps:delta,activeMs:body.activeMs,rewards,revision,closed:body.finish};
  const role=roleCommitGuard(user),gate='EXISTS(SELECT 1 FROM walking_receipts WHERE session_id=? AND seq=? AND commit_token=?)',gateArgs=[session.id,body.seq,nonce],commitNow=Date.now();
  const statements=[stmt(db,`INSERT INTO walking_receipts(session_id,seq,request_hash,commit_token,result_json,created_at)
    SELECT ?,?,?,?,?,? FROM player_saves ps JOIN walking_accounts wa ON wa.user_id=ps.user_id JOIN walking_sessions ws ON ws.id=wa.active_session_id
    WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND wa.revision=?
    AND ws.id=? AND ws.last_seq=? AND ws.total_steps=? AND ws.active_ms=? AND ws.closed=0
    AND COALESCE(json_extract(ps.save_json,'$.state.walking.campaignId'),'legacy_v1')=? AND ${role.sql}
    ON CONFLICT(session_id,seq) DO NOTHING RETURNING seq`,session.id,body.seq,digest,nonce,JSON.stringify(receipt),now,user.id,row.revision,body.deviceId,commitNow,account.revision,session.id,session.last_seq,session.total_steps,session.active_ms,session.campaign_id,...role.args)];
  if(delta>0)statements.push(stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(save),now,now+SYNC_LEASE,user.id,...gateArgs));
  statements.push(stmt(db,`UPDATE walking_sessions SET total_steps=?,active_ms=?,last_seq=?,closed=?,last_seen_at=?,expires_at=?,commit_token=? WHERE id=? AND ${gate}`,body.totalSteps,body.activeMs,body.seq,body.finish?1:0,now,now+WALKING_RULES.windowMs,nonce,session.id,...gateArgs));
  statements.push(stmt(db,`UPDATE walking_accounts SET total_steps=total_steps+?,revision=revision+1 WHERE user_id=? AND ${gate}`,delta,user.id,...gateArgs));
  const result=await db.batch(statements);
  if(!rows(result[0]).length){prior=await stmt(db,'SELECT * FROM walking_receipts WHERE session_id=? AND seq=?',session.id,body.seq).first();if(prior&&prior.request_hash===digest){session=await stmt(db,'SELECT * FROM walking_sessions WHERE id=?',session.id).first();return walkingResponse(db,user,body.deviceId,session,now,{receipt:JSON.parse(prior.result_json),idempotent:true});}
    const current=await getSyncRow(db,user.id);fieldWriter(current,body.deviceId,body.expectedRevision,now);if(walkingCampaign(current)!==session.campaign_id)fail(409,'WALKING_CAMPAIGN_CHANGED','物語が切り替わりました。');fail(409,'WALKING_CHANGED','歩行計測や役職が更新されました。同じ歩数を同期してから再送してください。');
  }
  session=await stmt(db,'SELECT * FROM walking_sessions WHERE id=?',session.id).first();return walkingResponse(db,user,body.deviceId,session,now,{receipt,idempotent:false});
}

function pairingCode() {
  const alphabet='0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  return Array.from(crypto.getRandomValues(new Uint8Array(12)),value=>alphabet[value&31]).join('');
}
function codeField(value) {
  if(typeof value!=='string'||value.length>32)fail(400,'INVALID_PAIR_CODE','12文字の端末連携コードを入力してください。');
  const code=value.replace(/[\s-]/g,'').toUpperCase();
  if(!/^[0-9A-HJKMNP-TV-Z]{12}$/.test(code))fail(400,'INVALID_PAIR_CODE','端末連携コードの形式が正しくありません。');
  return code;
}
async function getSyncRow(db,userId) {
  return stmt(db,'SELECT * FROM player_saves WHERE user_id=?',userId).first();
}
async function getWorldClockRow(db,now) {
  const existing=await stmt(db,'SELECT * FROM world_clock WHERE id=?',WORLD_CLOCK_ID).first();
  if(existing)return existing;
  // Schema migration contains no data writes. The fixed primary key makes the
  // initial epoch a single atomic event even for simultaneous first visitors.
  await stmt(db,`INSERT INTO world_clock(id,base_elapsed_ms,anchor_real_ms,running,speed,revision)
    VALUES(?,0,?,1,1,0) ON CONFLICT(id) DO NOTHING`,WORLD_CLOCK_ID,now).run();
  return stmt(db,'SELECT * FROM world_clock WHERE id=?',WORLD_CLOCK_ID).first();
}
function mapWorldClock(row,now) {
  const elapsedMs=Number(row.base_elapsed_ms)+(row.running?Math.max(0,now-Number(row.anchor_real_ms))*Number(row.speed):0);
  const turn=Math.floor(elapsedMs/WORLD_MONTH_MS),position=turn%WORLD_CYCLE_MONTHS;
  return {id:WORLD_CLOCK_ID,elapsedMs,running:!!row.running,speed:Number(row.speed),revision:Number(row.revision),serverTime:iso(now),
    calendar:{startYear:1560,yearsPerCycle:56,monthsPerCycle:WORLD_CYCLE_MONTHS,secondsPerMonth:60,cycle:Math.floor(turn/WORLD_CYCLE_MONTHS)+1,year:1560+Math.floor(position/12),month:position%12+1}};
}
async function getWorldClock(db,now) { return mapWorldClock(await getWorldClockRow(db,now),now); }
async function syncSnapshot(db,row,user,deviceId,now,{settle=false}={}) {
  const authenticated=user;await requireAccountAccess(db,authenticated);
  const clock=await getWorldClock(db,now);
  row=await ensureStaffCampaign(db,user,now,clock);user=await getUser(db,user.id);
  await requireAccountAccess(db,authenticated);
  row=await settlePlayerCycle(db,row,user,now,clock,{deferActive:!settle,writerDeviceId:settle?deviceId:null});
  const staffBase=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
  const current=await getUser(db,user.id);if(current.is_admin!==user.is_admin||current.staff_term!==user.staff_term)fail(409,'STAFF_ROLE_CHANGED','役職が更新されました。もう一度同期してください。');
  await requireAccountAccess(db,authenticated);
  const privateSave=row?.save_json?normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}):null;
  if(privateSave)await reconcileCovertProgress(db,user.id,privateSave);
  return {ok:true,user:mapUser(user,now),staffBase:publicStaffBase(staffBase),save:privateSave,clock,
    revision:Number(row?.revision||0),updatedAt:row?.updated_at?iso(row.updated_at):null,
    writerDeviceId:row?.writer_device_id||null,writerDeviceName:row?.writer_device_name||null,
    leaseExpiresAt:row?.lease_expires_at?iso(row.lease_expires_at):null,serverTime:iso(now),
    writable:!!deviceId&&row?.writer_device_id===deviceId&&Number(row.lease_expires_at)>now,
    entitlements:{edo:!!user.is_admin,ieyasuU:!!user.is_admin}};
}

const FIELD_RULES=Object.freeze({minTroops:300,maxTroops:100000,commandCost:1,foodBase:150,foodPerTroop:.3,attackCooldownMs:60000,defenderProtectionMs:60000,proposalLifetimeMs:600000,allianceDurationMs:360000,maxLootPerResource:500,maxLootFraction:.05,maxDefenderLossFraction:.1,operatorProtected:false,staffProtected:false,targetCastles:true,specialBaseBattles:true,captureCastles:FIELD_CAPTURE_CASTLES,uncapturableCastles:['edo','sunpu'],victoryRewards:{gold:500,rice:500,wood:500,stone:500},
  tactics:[{id:'balanced',name:'正攻法',food:1,modifier:1,loss:1},{id:'assault',name:'総攻撃',food:1.25,modifier:1.18,loss:1.35},{id:'siege',name:'包囲戦',food:1.65,modifier:.97,loss:.8},{id:'ambush',name:'伏兵',food:1.1,modifier:1.06,loss:.95}]});
const FIELD_SELECT=`SELECT u.id,u.name,u.clan,u.last_seen,s.revision,s.lease_expires_at,s.cycle_home,${EFFECTIVE_CYCLE_SQL} AS cycle_index,json_extract(s.save_json,'$.state.cycle.home') AS original_home,
  (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id) AS avatar_version,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan,
  (SELECT json_extract(b.save_json,'$.state.home') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_home,
  (SELECT json_extract(b.save_json,'$.state.castles.'||json_extract(b.save_json,'$.state.home')) FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_castle_json,
  (SELECT json_extract(sb.state_json,'$.castleLevel') FROM staff_base sb WHERE sb.id='sunpu') AS staff_castle_level,
  (SELECT json_extract(sb.state_json,'$.buildings.keep') FROM staff_base sb WHERE sb.id='sunpu') AS staff_keep_level,
  (SELECT json_extract(sb.state_json,'$.buildings.wall') FROM staff_base sb WHERE sb.id='sunpu') AS staff_wall,
  EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  (SELECT MAX(p.last_seen) FROM player_presence p WHERE p.user_id=u.id AND p.online=1) AS presence_seen,
  (SELECT MAX(b.occurred_elapsed_ms) FROM field_battles b WHERE b.attacker_id=u.id) AS last_attack_ms,
  (SELECT MAX(b.occurred_elapsed_ms) FROM field_battles b WHERE b.defender_id=u.id) AS last_defended_ms,
  (SELECT MAX(b.occurred_elapsed_ms) FROM field_battles b WHERE json_extract(b.result_json,'$.castleId')='sunpu') AS last_sunpu_defended_ms,
  json_extract(s.save_json,'$.state.clan') AS game_clan,json_extract(s.save_json,'$.state.home') AS home_id,
  json_extract(s.save_json,'$.state.troops') AS troops,json_extract(s.save_json,'$.state.castles') AS castles_json,
  json_extract(s.save_json,'$.state.buildings.keep') AS keep_level,
  json_extract(s.save_json,'$.state.buildings.wall') AS wall,json_extract(s.save_json,'$.state.tech.discipline') AS discipline,
  json_extract(s.save_json,'$.state.army') AS army_json,json_extract(s.save_json,'$.state.officerVariants') AS variants_json
  FROM users u JOIN player_saves s ON s.user_id=u.id
  WHERE s.save_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1) AND (COALESCE(json_extract(s.save_json,'$.state.gameOver'),0)=0 OR u.id=(SELECT value FROM settings WHERE key='adminUserId') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) OR ${EFFECTIVE_CYCLE_SQL}<?)`;
function fieldArmy(army,variants) {
  const powers=[.9,.95,1,1.08,1.16,1.25,1.35,1.5];
  const scores=army.map(id=>Math.max(...RANKS.map((rank,i)=>variants.includes(id+':'+rank)?powers[i]:0))||1);
  return {officerCount:army.length,rankPower:army.length?Math.round(scores.reduce((a,b)=>a+b,0)/army.length*1000)/1000:.75};
}
function fieldDefense(s,tactic='balanced',siege=0,castleId=s.home) {
  const home=s.castles[castleId],isHome=castleId===s.home,force=home.troops+Math.floor(s.troops*(isHome?.45:.18)),army=fieldArmy(s.army,s.officerVariants);
  const wallFactor=Math.max(.2,1-siege*.12)*(tactic==='siege'?.5:1);
  return {force,power:Math.max(1,Math.round((force+200)*(1+(isHome?s.buildings.wall:home.wall)*.11*wallFactor)*(1+s.tech.discipline*.06)*(1+(home.level-1)*.04)*army.rankPower)),army};
}
function fieldBattleMode(user,castleId,{legacy=false}={}) {return castleId==='edo'&&user.is_admin||castleId==='sunpu'&&user.is_staff&&!user.is_admin?'reward':!legacy&&FIELD_CAPTURE_CASTLES.includes(castleId)?'capture':'raid';}
function fieldRelationStatus(row,userId,elapsed) {
  if(!row||Number(row.expires_elapsed_ms)<=elapsed||Number(row.updated_elapsed_ms)<Math.floor(elapsed/WORLD_CYCLE_MS)*WORLD_CYCLE_MS)return 'neutral';
  if(row.status==='allied')return 'allied';
  if(row.status==='pending')return row.proposed_by===userId?'outgoing':'incoming';
  return 'neutral';
}
function mapFieldRelationship(row,userId,elapsed,targetName='') {
  const status=fieldRelationStatus(row,userId,elapsed);
  if(status==='neutral')return null;
  return {targetPlayerId:row.user_a===userId?row.user_b:row.user_a,targetName,targetEvaluation:evaluationRef(row.user_a===userId?row.user_b:row.user_a),status,expiresElapsedMs:Number(row.expires_elapsed_ms),remainingMs:Math.max(0,Number(row.expires_elapsed_ms)-elapsed),proposedBy:row.proposed_by,revision:Number(row.revision)};
}
function mapFieldPlayer(row,viewer,relationship,clock,now,targetCastleId=null) {
  const castles=JSON.parse(row.castles_json),cyclePending=Number(row.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS),storedHome=cyclePending?(row.cycle_home||row.original_home||row.home_id):row.home_id;
  const clan=publicClan(row.game_clan,row.is_admin,row.is_staff,row.personal_clan);
  const alternatives=CASTLES.filter(c=>!['edo','sunpu'].includes(c.id)&&castles[c.id].owner===row.game_clan),canonical=CLAN_HOMES[clan]||'kiyosu';
  const replacement=alternatives.find(c=>c.id===canonical)?.id||alternatives[0]?.id||canonical;
  const home=row.is_admin?'edo':row.is_staff?'sunpu':['edo','sunpu'].includes(storedHome)?row.personal_home&&!['edo','sunpu'].includes(row.personal_home)?row.personal_home:replacement:storedHome;
  const castleId=targetCastleId||home,isHome=castleId===home,battleMode=fieldBattleMode(row,castleId);
  const castle={...(!isHome?castles[castleId]:!row.is_admin&&storedHome==='edo'&&!alternatives.length&&castles.edo.owner===row.game_clan?castles.edo:castles[home])};
  if(isHome&&row.is_admin&&storedHome!=='edo')for(const key of ['troops','wall','level'])castle[key]=Math.max(castle[key],castles[storedHome][key]);
  if(isHome&&!row.is_admin&&!row.is_staff&&storedHome==='sunpu'){const personal=row.personal_castle_json?JSON.parse(row.personal_castle_json):castles.sunpu;for(const key of ['troops','wall','level'])castle[key]=Math.max(castle[key],personal[key]);}
  if(isHome&&row.is_staff&&!row.is_admin){castle.level=Number(row.staff_castle_level||1);castle.wall=Number(row.staff_wall||1);}
  castle.level=Math.min(castleLevelLimit(castleId),castle.level);
  const rawKeepLevel=!isHome?castle.level:row.is_staff&&!row.is_admin?row.staff_keep_level:row.keep_level;
  const keepLevel=Number.isFinite(rawKeepLevel)?Math.max(1,Math.min(32,Math.floor(rawKeepLevel))):1;
  if(cyclePending&&isHome&&battleMode!=='reward'){castle.troops=Math.max(1200,castle.troops);castle.wall=Math.max(castle.wall,Number(row.wall));}
  const state={home,troops:Number(row.troops),castles:{[castleId]:castle},buildings:{wall:isHome&&row.is_staff&&!row.is_admin?castle.wall:Number(row.wall)},tech:{discipline:Number(row.discipline)},army:JSON.parse(row.army_json||'[]'),officerVariants:JSON.parse(row.variants_json||'[]')};
  const defense=fieldDefense(state,'balanced',0,castleId),self=viewer?.id===row.id,relation=self?'self':fieldRelationStatus(relationship,viewer?.id,clock.elapsedMs);
  const lastDefended=Math.max(row.last_defended_ms??-Infinity,battleMode==='reward'&&castleId==='sunpu'?(row.last_sunpu_defended_ms??-Infinity):-Infinity),protectedUntil=Number.isFinite(lastDefended)?lastDefended+FIELD_RULES.defenderProtectionMs:0;
  const reason=!viewer?'領主として接続してください。':self?'自分の城です。':cyclePending&&battleMode!=='reward'&&Number(row.lease_expires_at)>now?'この領主は領地を精算中です。':relation==='allied'?'同盟の期間中です。':protectedUntil>clock.elapsedMs?'襲撃後の保護期間です。':!clock.running?'世界の共通時間が停止中です。':'';
  return {playerId:row.id,name:row.name,clan,evaluation:evaluationRef(row.id),avatarVersion:row.avatar_version||null,homeCastleId:home,homeCastleName:CASTLE_BY_ID[home].name,targetCastleId:castleId,targetCastleName:CASTLE_BY_ID[castleId].name,isHome,battleMode,capturable:battleMode==='capture',majorCity:MAJOR_CITIES.includes(castleId),level:castle.level,keepLevel,defenseTroops:defense.force,defensePower:defense.power,armySummary:defense.army,isAdmin:!!row.is_admin,isStaff:!!row.is_staff&&!row.is_admin,self,online:row.presence_seen!==null&&Number(row.presence_seen)>now-ONLINE_WINDOW,relationship:relation,protectedUntilElapsedMs:protectedUntil,attackable:!reason,attackReason:reason};
}
function mapFieldTargets(row,viewer,relationship,clock,now) {
  const home=mapFieldPlayer(row,viewer,relationship,clock,now),castles=JSON.parse(row.castles_json);
  const outposts=Number(row.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)?[]:FIELD_CAPTURE_CASTLES.filter(id=>id!==home.homeCastleId&&castles[id]?.owner===row.game_clan);
  return [home,...outposts.map(id=>mapFieldPlayer(row,viewer,relationship,clock,now,id))];
}
async function fieldRelation(db,a,b) {const [first,second]=pair(a,b);return stmt(db,'SELECT * FROM field_relations WHERE user_a=? AND user_b=?',first,second).first();}
async function fieldOwnRelations(db,userId,elapsed) {
  return rows(await stmt(db,`SELECT r.*,u.name AS target_name FROM field_relations r JOIN users u ON u.id=CASE WHEN r.user_a=? THEN r.user_b ELSE r.user_a END
    WHERE (r.user_a=? OR r.user_b=?) AND r.status IN ('pending','allied') AND r.expires_elapsed_ms>? AND r.updated_elapsed_ms>=? ORDER BY r.updated_elapsed_ms DESC LIMIT 100`,userId,userId,userId,elapsed,Math.floor(elapsed/WORLD_CYCLE_MS)*WORLD_CYCLE_MS).all());
}
async function getFieldList(db,viewer,url,now) {
  const cursor=url.searchParams.get('cursor')||'',limitText=url.searchParams.get('limit')||'50';
  if(cursor)idField(cursor,'共有地図の続き');
  if(!/^\d{1,3}$/.test(limitText)||Number(limitText)<1||Number(limitText)>100)fail(400,'INVALID_INPUT','一覧の件数は1～100件で指定してください。');
  const limit=Number(limitText),clock=await getWorldClock(db,now),relations=viewer?await fieldOwnRelations(db,viewer.id,clock.elapsedMs):[];await cyclePolicy(db,clock,now);const currentCycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);await sharedStaffBaseRow(db,clock,now);
  const result=await db.batch([stmt(db,FIELD_SELECT+' AND u.id>? ORDER BY u.id LIMIT ?',currentCycle,cursor,limit+1),stmt(db,`SELECT COUNT(*) AS count FROM player_saves s WHERE save_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=s.user_id AND pb.active=1) AND (COALESCE(json_extract(save_json,'$.state.gameOver'),0)=0 OR user_id=(SELECT value FROM settings WHERE key='adminUserId') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=s.user_id) OR ${EFFECTIVE_CYCLE_SQL}<?)`,currentCycle)]);
  const found=rows(result[0]),players=found.slice(0,limit).map(row=>mapFieldPlayer(row,viewer,relations.find(r=>r.user_a===row.id||r.user_b===row.id),clock,now));
  const targets=found.slice(0,limit).flatMap(row=>mapFieldTargets(row,viewer,relations.find(r=>r.user_a===row.id||r.user_b===row.id),clock,now));
  return {ok:true,players,targets,total:Number(rows(result[1])[0].count),nextCursor:found.length>limit?players.at(-1).playerId:null,clock,rules:FIELD_RULES};
}
function fieldWriter(row,deviceId,revision,now) {
  if(!row?.save_json)fail(409,'SAVE_REQUIRED','先に本拠をクラウドへ保存してください。');
  if(row.writer_device_id!==deviceId||Number(row.lease_expires_at)<=now)fail(409,'LEASE_REQUIRED','この端末を操作端末にしてからお試しください。');
  if(Number(row.revision)!==revision)fail(409,'REVISION_CONFLICT','本拠の保存が更新されています。同期してからお試しください。');
}
async function settleWriterCycle(db,user,deviceId,revision,now) {
  await requireAccountAccess(db,user);
  let prior=await getSyncRow(db,user.id);fieldWriter(prior,deviceId,revision,now);
  prior=await ensureStaffCampaign(db,user,now);fieldWriter(prior,deviceId,revision,now);
  const settled=await settlePlayerCycle(db,prior,user,now,undefined,{deferActive:false,writerDeviceId:deviceId});fieldWriter(settled,deviceId,revision,now);return settled;
}
function fieldRequestBody(body,kind) {
  const allowed=kind==='attack'?['targetPlayerId','targetCastleId','troops','tactic','requestId','deviceId','expectedRevision']:['targetPlayerId','action','requestId','deviceId','expectedRevision'];
  if(Object.keys(body).some(key=>!allowed.includes(key)))fail(400,'INVALID_INPUT','送信できない操作項目が含まれています。');
  const targetPlayerId=idField(body.targetPlayerId,'相手の領主'),requestId=idField(body.requestId,'操作番号'),deviceId=idField(body.deviceId,'端末');
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail(400,'INVALID_INPUT','保存の更新番号が正しくありません。');
  if(kind==='attack'&&(!Number.isInteger(body.troops)||body.troops<FIELD_RULES.minTroops||body.troops>FIELD_RULES.maxTroops||!FIELD_RULES.tactics.some(t=>t.id===body.tactic)))fail(400,'INVALID_INPUT','兵数と戦法を正しく指定してください。');
  if(kind==='attack'&&body.targetCastleId!==undefined&&(typeof body.targetCastleId!=='string'||!CASTLE_BY_ID[body.targetCastleId]))fail(400,'INVALID_INPUT','攻撃する城を確認してください。');
  if(kind==='diplomacy'&&!['propose','accept','reject','cancel'].includes(body.action))fail(400,'INVALID_INPUT','外交操作が正しくありません。');
  return {...body,targetPlayerId,requestId,deviceId};
}
async function priorFieldRequest(db,userId,body,kind,digest) {
  const prior=await stmt(db,'SELECT * FROM field_requests WHERE actor_id=? AND request_id=?',userId,body.requestId).first();
  if(prior&&(prior.kind!==kind||prior.request_hash!==digest))fail(409,'REQUEST_ID_REUSED','この操作番号は別の操作に使われています。');
  return prior;
}
async function fieldMe(db,user,url,now) {
  const deviceId=url.searchParams.get('deviceId')||'';if(deviceId)idField(deviceId,'端末');
  const clock=await getWorldClock(db,now);await sharedStaffBaseRow(db,clock,now);const row=await settlePlayerCycle(db,await getSyncRow(db,user.id),user,now,clock,{deferActive:true}),base=await stmt(db,FIELD_SELECT+' AND u.id=?',Math.floor(clock.elapsedMs/WORLD_CYCLE_MS),user.id).first();
  const save=row?.save_json?normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}):null,s=save?.state;
  const cooldownUntil=base?.last_attack_ms!==null&&base?.last_attack_ms!==undefined?Number(base.last_attack_ms)+FIELD_RULES.attackCooldownMs:0;
  let reason=!s?'先に本拠をクラウドへ保存してください。':s.gameOver?'本拠を復元してください。':Number(row.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)?'領地の精算を同期しています。':!s.worldClock?'共通時計へ同期してください。':!clock.running?'世界の共通時間が停止中です。':row.lease_expires_at<=now||deviceId&&row.writer_device_id!==deviceId?'この端末を操作端末にしてください。':cooldownUntil>clock.elapsedMs?'次の出陣までお待ちください。':s.command<1?'指示の回復をお待ちください。':s.troops<FIELD_RULES.minTroops?'出陣できる兵が足りません。':s.resources.rice<240?'兵糧が足りません。':'';
  if(!reason&&clock.elapsedMs-s.worldClock.elapsedMs>15000)reason='共通時計と本拠を同期してください。';
  const relations=await fieldOwnRelations(db,user.id,clock.elapsedMs),battles=rows(await stmt(db,'SELECT result_json FROM field_battles WHERE attacker_id=? OR defender_id=? ORDER BY occurred_elapsed_ms DESC,id DESC LIMIT 20',user.id,user.id).all()).map(b=>publicBattle(JSON.parse(b.result_json)));
  return {ok:true,self:base?mapFieldPlayer(base,user,null,clock,now):null,revision:row?Number(row.revision):null,clock,rules:FIELD_RULES,attack:{ready:!reason,reason,availableTroops:s?.troops||0,minTroops:FIELD_RULES.minTroops,maxTroops:Math.min(s?.troops||0,FIELD_RULES.maxTroops),command:s?.command||0,rice:s?.resources.rice||0,cooldownUntilElapsedMs:cooldownUntil,remainingCooldownMs:Math.max(0,cooldownUntil-clock.elapsedMs)},relationships:relations.map(r=>mapFieldRelationship(r,user.id,clock.elapsedMs,r.target_name)),battles};
}
async function fieldReplayAttack(db,user,body,prior,now) {return {...await syncSnapshot(db,await getSyncRow(db,user.id),user,body.deviceId,now),battle:publicBattle(JSON.parse(prior.result_json)),idempotent:true};}
async function fieldCommitFailure(db,user,body,kind,digest,clock,now) {
  const prior=await priorFieldRequest(db,user.id,body,kind,digest);if(prior)return prior;
  fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);
  if((await getWorldClock(db,now)).revision!==clock.revision)fail(409,'WORLD_CLOCK_CHANGED','共通時計が更新されました。同期してからお試しください。');
  fail(409,'FIELD_CHANGED','相手の本拠または外交関係が更新されました。共有地図を更新してからお試しください。');
}
function fieldFallbackHome(s,preferred=null) {
  const ordinary=id=>!!CASTLE_BY_ID[id]&&!MAJOR_CITIES.includes(id),owned=id=>ordinary(id)&&s.castles[id].owner===s.clan;
  return [preferred,s.cycle?.home,CLAN_HOMES[s.clan]].find(owned)||CASTLES.find(c=>owned(c.id))?.id||[preferred,s.cycle?.home,CLAN_HOMES[s.clan],'kiyosu'].find(ordinary);
}
function fieldLoseCastle(s,castleId,preferred=null) {
  const castle=s.castles[castleId],lostHome=s.home===castleId,lostCycleHome=s.cycle?.home===castleId;
  let fallback=null;
  if(lostHome||lostCycleHome){
    fallback=fieldFallbackHome(s,preferred);const next=s.castles[fallback],existing=next.owner===s.clan;
    next.owner=s.clan;next.level=Math.min(castleLevelLimit(fallback),Math.max(next.level,castle.level));
    next.wall=Math.max(next.wall,castle.wall,s.buildings.wall);
    next.troops=Math.min(1000000,(existing?next.troops:0)+castle.troops);castle.troops=0;
    if(lostHome)s.home=fallback;if(s.cycle)s.cycle.home=fallback;
    if(!s.captureRewards.includes(fallback))s.captureRewards.push(fallback);
    // Facilities and their construction queues follow the home. Preserve a
    // surviving fallback castle job; otherwise carry the old home job across.
    const currentJob=s.jobs.find(j=>j.kind==='castle'&&j.id===fallback),lostJob=s.jobs.find(j=>j.kind==='castle'&&j.id===castleId);
    s.jobs=s.jobs.filter(j=>j.kind!=='castle'||j.id!==castleId&&j.id!==fallback);
    const job=currentJob||lostJob;if(job&&next.level<castleLevelLimit(fallback))s.jobs.push({...job,id:fallback,targetLevel:next.level+1});
  }else s.jobs=s.jobs.filter(j=>j.kind!=='castle'||j.id!==castleId);
  // Clan names are not player identities; same-clan opponents must still lose
  // this individual holding. The next public target belongs to the victor.
  castle.owner='在地衆';s.gameOver=false;
  return fallback;
}
function fieldCaptureCastle(a,d,castleId,sent,attackerLost) {
  const source=copy(d.castles[castleId]),newlyOwned=a.castles[castleId].owner!==a.clan;
  let garrison=0;
  if(newlyOwned){
    garrison=Math.min(a.troops,Math.floor((sent-attackerLost)*.15));a.troops-=garrison;
    a.castles[castleId]={owner:a.clan,troops:garrison,wall:source.wall,level:Math.min(castleLevelLimit(castleId),source.level)};
  }
  if(!a.captureRewards.includes(castleId))a.captureRewards.push(castleId);
  const fallbackHomeId=fieldLoseCastle(d,castleId);
  return {newlyOwned,garrison,castleId,castle:source,fallbackHomeId};
}
async function fieldStaffDefense(db,state,clock) {
  // Read the real shared fortification without settling its queue or writing
  // any defender state. Due jobs are projected only for this battle snapshot.
  const row=await stmt(db,"SELECT * FROM staff_base WHERE id='sunpu'").first(),shared=row?JSON.parse(row.state_json):staffInitialState(clock.elapsedMs);
  for(const job of shared.jobs.filter(j=>j.completesElapsedMs<=clock.elapsedMs).sort((a,b)=>a.completesElapsedMs-b.completesElapsedMs)){if(job.kind==='castle')shared.castleLevel=job.targetLevel;else shared.buildings[job.id]=job.targetLevel;}
  state.castles.sunpu.level=shared.castleLevel;state.castles.sunpu.wall=shared.buildings.wall;state.buildings.wall=shared.buildings.wall;
  return row?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='sunpu' AND revision=?)",args:[row.revision]}:{sql:"NOT EXISTS(SELECT 1 FROM staff_base WHERE id='sunpu')",args:[]};
}
async function fieldAttack(db,user,raw,now) {
  const body=fieldRequestBody(raw,'attack'),intent=['attack',body.targetPlayerId,body.troops,body.tactic];
  if(body.targetCastleId!==undefined)intent.push(body.targetCastleId);
  const digest=await hash(JSON.stringify(intent)),prior=await priorFieldRequest(db,user.id,body,'attack',digest);if(prior)return fieldReplayAttack(db,user,body,prior,now);
  if(body.targetPlayerId===user.id)fail(400,'INVALID_TARGET','自分の城には出陣できません。');
  await budget(db,'field-attack:'+user.id,30,60000,now);
  const target=await getUser(db,body.targetPlayerId);if(!target||target.ban_active)fail(404,'FIELD_PLAYER_NOT_FOUND','相手の本拠が見つかりません。');
  const attackerRow=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);
  let defenderRow=await getSyncRow(db,target.id);if(!defenderRow?.save_json)fail(404,'FIELD_PLAYER_NOT_FOUND','相手の本拠はまだ共有されていません。');
  const initialHome=target.is_admin?'edo':target.is_staff?'sunpu':JSON.parse(defenderRow.save_json).state.home;
  const requestedCastle=body.targetCastleId||initialHome,rewardOnly=fieldBattleMode(target,requestedCastle)==='reward';
  if(!rewardOnly)defenderRow=await settlePlayerCycle(db,defenderRow,target,now,undefined,{deferActive:true});
  const clock=await getWorldClock(db,now);if(!clock.running)fail(409,'WORLD_PAUSED','世界の共通時間が停止中です。');
  const attacker=normalizeGameSave(JSON.parse(attackerRow.save_json),user,now,{reading:true,clock}),defender=normalizeGameSave(JSON.parse(defenderRow.save_json),target,now,{reading:true,clock}),a=attacker.state,d=defender.state;
  const defenderHomeBefore=d.home,castleId=body.targetCastleId||d.home,battleMode=fieldBattleMode(target,castleId,{legacy:body.targetCastleId===undefined});
  if(castleId!==d.home&&(!FIELD_CAPTURE_CASTLES.includes(castleId)||d.castles[castleId].owner!==d.clan))fail(409,'FIELD_TARGET_CHANGED','この領主の攻撃可能な城ではありません。共有地図を更新してください。');
  if(Number(attackerRow.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)||battleMode!=='reward'&&Number(defenderRow.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS))fail(409,'CYCLE_SETTLEMENT_REQUIRED','領地の精算中です。共有地図を更新してください。');
  if(a.gameOver||d.gameOver)fail(409,'BASE_UNAVAILABLE','本拠を失っている領主とは戦えません。');
  if(!a.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','先に共通時計へ同期してください。');
  if(clock.elapsedMs-a.worldClock.elapsedMs>15000)fail(409,'CLOCK_STALE','共通時計と本拠を同期してから出陣してください。');
  const relation=await fieldRelation(db,user.id,target.id);if(fieldRelationStatus(relation,user.id,clock.elapsedMs)==='allied')fail(409,'ALLIED_TARGET','同盟期間中の相手には出陣できません。');
  const cooldown=await stmt(db,'SELECT MAX(occurred_elapsed_ms) AS last FROM field_battles WHERE attacker_id=?',user.id).first();
  if(cooldown.last!==null&&Number(cooldown.last)+FIELD_RULES.attackCooldownMs>clock.elapsedMs)fail(409,'ATTACK_COOLDOWN','次の出陣まで共通時間で60秒お待ちください。');
  const sharedShield=battleMode==='reward'&&castleId==='sunpu';
  const shield=await stmt(db,"SELECT MAX(occurred_elapsed_ms) AS last FROM field_battles WHERE defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='sunpu')",target.id,sharedShield?1:0).first();
  if(shield.last!==null&&Number(shield.last)+FIELD_RULES.defenderProtectionMs>clock.elapsedMs)fail(409,'TARGET_PROTECTED','相手は襲撃後の保護期間です。');
  const covertShield=await stmt(db,"SELECT MAX(occurred_elapsed_ms) AS last FROM covert_battles WHERE defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='sunpu')",target.id,sharedShield?1:0).first();
  if(covertShield.last!==null&&Number(covertShield.last)+FIELD_RULES.defenderProtectionMs>clock.elapsedMs)fail(409,'TARGET_PROTECTED','相手は襲撃後の保護期間です。');
  const tactic=FIELD_RULES.tactics.find(t=>t.id===body.tactic),foodCost=Math.ceil(body.troops*FIELD_RULES.foodPerTroop*tactic.food)+FIELD_RULES.foodBase;
  if(body.troops>a.troops||a.command<1||a.resources.rice<foodCost)fail(409,'INSUFFICIENT_FORCE','兵数・指示・兵糧が足りません。');
  const sharedGuard=sharedShield?await fieldStaffDefense(db,d,clock):{sql:'1=1',args:[]};
  const attackerBefore=copy(attacker),attackPower=Math.max(1,Math.round(body.troops*(.7+.5*a.morale/100)*(1+a.tech.discipline*.06+a.tech.gunnery*.05)*fieldArmy(a.army,a.officerVariants).rankPower*tactic.modifier));
  const defense=fieldDefense(d,tactic.id,a.tech.siege,castleId),ratio=attackPower/defense.power,chance=Math.max(.05,Math.min(.95,.5+Math.log(ratio)*.6));
  const won=crypto.getRandomValues(new Uint32Array(1))[0]/4294967296<chance;
  const attackerLost=Math.min(body.troops,Math.max(1,Math.floor(body.troops*Math.min(.35,(won?.08+.06/Math.max(.3,ratio):.2+.06/Math.max(.3,ratio))*tactic.loss))));
  const castle=d.castles[castleId],defenderLost=battleMode==='reward'?{troops:0,garrison:0}:{troops:Math.min(Math.floor(d.troops*.1),Math.floor(body.troops*(won?.04:.015))),garrison:Math.min(Math.floor(castle.troops*.1),Math.floor(body.troops*(won?.08:.03)))};
  a.troops-=attackerLost;a.resources.rice-=foodCost;a.command-=1;
  if(battleMode!=='reward'){d.troops-=defenderLost.troops;castle.troops-=defenderLost.garrison;d.morale=Math.max(0,d.morale-2);}
  const loot={},rewards={};
  for(const key of RESOURCES){
    loot[key]=won&&battleMode!=='reward'?Math.min(FIELD_RULES.maxLootPerResource,Math.floor(d.resources[key]*FIELD_RULES.maxLootFraction),999999999-a.resources[key]):0;
    rewards[key]=won&&battleMode==='reward'?Math.min(FIELD_RULES.victoryRewards[key],999999999-a.resources[key]):0;
    if(loot[key])d.resources[key]-=loot[key];a.resources[key]+=loot[key]+rewards[key];
  }
  const captured=won&&battleMode==='capture',captureChange=captured?fieldCaptureCastle(a,d,castleId,body.troops,attackerLost):null;
  const capture={captured,castleId,castleName:CASTLE_BY_ID[castleId].name,attackerPlayerId:user.id,defenderPlayerId:target.id,defenderHomeCastleId:d.home,defenderHomeCastleName:CASTLE_BY_ID[d.home].name,newlyOwned:!!captureChange?.newlyOwned,garrison:captureChange?.garrison||0};
  a.stats.battles=Math.min(10000000,a.stats.battles+1);if(won)a.stats.wins=Math.min(a.stats.battles,a.stats.wins+1);
  a.morale=Math.max(0,Math.min(100,a.morale+(won?3:-5)));
  const battle={id:uid('fb_'),requestId:body.requestId,attackerPlayerId:user.id,attackerName:user.name,defenderPlayerId:target.id,defenderName:target.name,castleId,castleName:CASTLE_BY_ID[castleId].name,battleMode,won,tactic:body.tactic,troops:body.troops,attackerLost,defenderLost,foodCost,loot,rewards,capture,attackPower,defensePower:defense.power,winChance:Math.round(chance*100),occurredElapsedMs:clock.elapsedMs,createdAt:iso(now),attackerRevision:Number(attackerRow.revision)+1,defenderRevision:Number(defenderRow.revision)+(battleMode==='reward'?0:1),nextAttackElapsedMs:clock.elapsedMs+FIELD_RULES.attackCooldownMs,defenderProtectedUntilElapsedMs:clock.elapsedMs+FIELD_RULES.defenderProtectionMs};
  a.log.unshift({turn:a.turn,text:`${target.name}の${battle.castleName}へ出陣。${won?captured?'城を占領':battleMode==='reward'?'勝利報酬を獲得':'戦利品を得て帰還':'撤退'}、兵${attackerLost}人を失いました。`,kind:'pvp'});a.log=a.log.slice(0,200);attacker.savedAt=iso(now);
  if(battleMode!=='reward'){d.log.unshift({turn:d.turn,text:`${user.name}の襲撃を受け、兵${defenderLost.troops+defenderLost.garrison}人を失いました。${captured?battle.castleName+'を失い、'+capture.defenderHomeCastleName+'を本拠として継続します。':'本拠の領有は継続しています。'}`,kind:'pvp'});d.log=d.log.slice(0,200);defender.savedAt=iso(now);}
  const attackerNext=normalizeGameSave(attacker,user,now,{clock}),defenderNext=battleMode==='reward'?null:normalizeGameSave(defender,target,now,{clock});
  const attackerJson=JSON.stringify(attackerNext),defenderJson=defenderNext?JSON.stringify(defenderNext):null,resultJson=JSON.stringify(battle),nonce=crypto.randomUUID(),[first,second]=pair(user.id,target.id),roleGuard=roleCommitGuard(user),targetRoleGuard=roleCommitGuard(target);
  const gate='EXISTS(SELECT 1 FROM field_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',gateArgs=[user.id,body.requestId,nonce];
  // The receipt gates both campaigns, personal staff metadata and the public
  // battle. Revisions and roles are checked in the same atomic D1 batch.
  const statements=[
    stmt(db,`INSERT INTO field_requests(actor_id,request_id,kind,request_hash,commit_token,result_json,created_at)
      SELECT ?,?,'attack',?,?,?,? FROM player_saves a JOIN player_saves d ON d.user_id=?
      WHERE a.user_id=? AND a.revision=? AND a.writer_device_id=? AND a.lease_expires_at>?
      AND d.revision=? AND d.save_json IS NOT NULL AND ${roleGuard.sql} AND ${targetRoleGuard.sql} AND ${sharedGuard.sql}
      AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1)
      AND NOT EXISTS(SELECT 1 FROM field_relations WHERE user_a=? AND user_b=? AND status='allied' AND expires_elapsed_ms>? AND updated_elapsed_ms>=?)
      AND NOT EXISTS(SELECT 1 FROM field_battles WHERE attacker_id=? AND occurred_elapsed_ms>?)
      AND NOT EXISTS(SELECT 1 FROM field_battles WHERE (defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='sunpu')) AND occurred_elapsed_ms>?)
      AND NOT EXISTS(SELECT 1 FROM covert_battles WHERE (defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='sunpu')) AND occurred_elapsed_ms>?)
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,nonce,resultJson,now,target.id,user.id,body.expectedRevision,body.deviceId,now,defenderRow.revision,...roleGuard.args,...targetRoleGuard.args,...sharedGuard.args,WORLD_CLOCK_ID,clock.revision,first,second,clock.elapsedMs,Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)*WORLD_CYCLE_MS,user.id,clock.elapsedMs-FIELD_RULES.attackCooldownMs,target.id,sharedShield?1:0,clock.elapsedMs-FIELD_RULES.defenderProtectionMs,target.id,sharedShield?1:0,clock.elapsedMs-FIELD_RULES.defenderProtectionMs),
    stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_home=? WHERE user_id=? AND ${gate}`,attackerJson,now,now+SYNC_LEASE,attackerNext.state.cycle?.home||attackerNext.state.home,user.id,...gateArgs)
  ];
  if(defenderNext)statements.push(stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home=? WHERE user_id=? AND ${gate}`,defenderJson,now,defenderNext.state.cycle?.home||defenderNext.state.home,target.id,...gateArgs));
  const attackerPersonal=await staffPersonalProgressStatement(db,user,attackerNext,now,gate,gateArgs);if(attackerPersonal)statements.push(attackerPersonal);
  if(defenderNext){const personal=await staffPersonalProgressStatement(db,target,defenderNext,now,gate,gateArgs,null,captureChange);if(personal)statements.push(personal);}
  for(const event of saveAchievements(attackerBefore,attackerNext))statements.push(achievementStatement(db,user.id,event,now,gate,gateArgs));
  statements.push(stmt(db,`INSERT INTO field_battles(id,attacker_id,defender_id,defender_campaign_id,occurred_elapsed_ms,result_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${gate}`,battle.id,user.id,target.id,d.walking.campaignId,clock.elapsedMs,resultJson,now,...gateArgs));
  statements.push(...await fieldBattleMailStatements(db,battle,{attacker:a.home,defenderBefore:defenderHomeBefore,defenderAfter:d.home,defenderLevel:d.castles[d.home].level},now,gate,gateArgs));
  const result=await db.batch(statements);
  if(!rows(result[0]).length){const replay=await fieldCommitFailure(db,user,body,'attack',digest,clock,now);return fieldReplayAttack(db,user,body,replay,now);}
  return {...await syncSnapshot(db,await getSyncRow(db,user.id),user,body.deviceId,now),battle:publicBattle(battle),idempotent:false};
}
async function fieldDiplomacy(db,user,raw,now) {
  const body=fieldRequestBody(raw,'diplomacy'),digest=await hash(JSON.stringify(['diplomacy',body.targetPlayerId,body.action]));
  let prior=await priorFieldRequest(db,user.id,body,'diplomacy',digest);
  if(body.targetPlayerId===user.id)fail(400,'INVALID_TARGET','自分自身へ外交を申し込むことはできません。');
  const target=await getUser(db,body.targetPlayerId);if(!target||target.ban_active)fail(404,'FIELD_PLAYER_NOT_FOUND','相手の領主が見つかりません。');
  const clock=await getWorldClock(db,now);
  const respond=async idempotent=>({ok:true,relationship:mapFieldRelationship(await fieldRelation(db,user.id,target.id),user.id,clock.elapsedMs,target.name),idempotent,clock});
  if(prior)return respond(true);
  await budget(db,'field-diplomacy:'+user.id,20,60000,now);
  const own=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);
  const other=await settlePlayerCycle(db,await getSyncRow(db,target.id),target,now,undefined,{deferActive:true});if(!other?.save_json)fail(404,'FIELD_PLAYER_NOT_FOUND','相手の本拠はまだ共有されていません。');
  if(Math.min(Number(own.cycle_index),Number(other.cycle_index))<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS))fail(409,'CYCLE_SETTLEMENT_REQUIRED','領地の精算中です。共有地図を更新してください。');
  const relation=await fieldRelation(db,user.id,target.id),status=fieldRelationStatus(relation,user.id,clock.elapsedMs);
  if(body.action==='propose'&&status!=='neutral'||['accept','reject'].includes(body.action)&&status!=='incoming'||body.action==='cancel'&&status!=='outgoing')fail(409,'DIPLOMACY_STATE','外交関係が変わっています。申し込みは相手だけが承認でき、成立した同盟は期限まで継続します。');
  if(body.action==='propose') {
    const active=await stmt(db,`SELECT
      (SELECT COUNT(*) FROM field_relations WHERE (user_a=? OR user_b=?) AND status IN ('pending','allied') AND expires_elapsed_ms>?) AS actor_count,
      (SELECT COUNT(*) FROM field_relations WHERE (user_a=? OR user_b=?) AND status IN ('pending','allied') AND expires_elapsed_ms>?) AS target_count`,user.id,user.id,clock.elapsedMs,target.id,target.id,clock.elapsedMs).first();
    if(Number(active.actor_count)>=20||Number(active.target_count)>=20)fail(409,'DIPLOMACY_LIMIT','各領主が同時に進められる外交は20件までです。');
  }
  const nextStatus={propose:'pending',accept:'allied',reject:'rejected',cancel:'cancelled'}[body.action],proposedBy=body.action==='propose'?user.id:relation.proposed_by;
  const expiry=clock.elapsedMs+(body.action==='propose'?FIELD_RULES.proposalLifetimeMs:body.action==='accept'?FIELD_RULES.allianceDurationMs:0),nonce=crypto.randomUUID(),[first,second]=pair(user.id,target.id),relationRevision=relation?Number(relation.revision):-1,access=roleCommitGuard(user),targetAccess=roleCommitGuard(target);
  const result=await db.batch([
    stmt(db,`INSERT INTO field_requests(actor_id,request_id,kind,request_hash,commit_token,result_json,created_at)
      SELECT ?,?,'diplomacy',?,?,?,? FROM player_saves a JOIN player_saves d ON d.user_id=?
      WHERE a.user_id=? AND a.revision=? AND a.writer_device_id=? AND a.lease_expires_at>? AND d.revision=? AND d.save_json IS NOT NULL
      AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${access.sql} AND ${targetAccess.sql}
      AND ((?=-1 AND NOT EXISTS(SELECT 1 FROM field_relations WHERE user_a=? AND user_b=?)) OR EXISTS(SELECT 1 FROM field_relations WHERE user_a=? AND user_b=? AND revision=?))
      AND (?<>'propose' OR ((SELECT COUNT(*) FROM field_relations WHERE (user_a=? OR user_b=?) AND status IN ('pending','allied') AND expires_elapsed_ms>?)<20
        AND (SELECT COUNT(*) FROM field_relations WHERE (user_a=? OR user_b=?) AND status IN ('pending','allied') AND expires_elapsed_ms>?)<20))
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,nonce,JSON.stringify({targetPlayerId:target.id,action:body.action}),now,target.id,user.id,body.expectedRevision,body.deviceId,now,other.revision,WORLD_CLOCK_ID,clock.revision,...access.args,...targetAccess.args,relationRevision,first,second,first,second,relationRevision,body.action,user.id,user.id,clock.elapsedMs,target.id,target.id,clock.elapsedMs),
    stmt(db,`INSERT INTO field_relations(user_a,user_b,status,proposed_by,expires_elapsed_ms,updated_elapsed_ms,revision,updated_at)
      SELECT ?,?,?,?,?,?,0,? WHERE EXISTS(SELECT 1 FROM field_requests WHERE actor_id=? AND request_id=? AND commit_token=?)
      ON CONFLICT(user_a,user_b) DO UPDATE SET status=excluded.status,proposed_by=excluded.proposed_by,expires_elapsed_ms=excluded.expires_elapsed_ms,updated_elapsed_ms=excluded.updated_elapsed_ms,revision=field_relations.revision+1,updated_at=excluded.updated_at`,first,second,nextStatus,proposedBy,expiry,clock.elapsedMs,now,user.id,body.requestId,nonce)
  ]);
  if(!rows(result[0]).length){prior=await fieldCommitFailure(db,user,body,'diplomacy',digest,clock,now);return respond(!!prior);}
  return respond(false);
}

async function staffRoster(db,now) {
  const found=rows(await stmt(db,`SELECT member.*,sm.appointed_at,sm.appointed_by FROM (${USER_SELECT}) member
    JOIN staff_members sm ON sm.user_id=member.id WHERE member.is_admin=0 ORDER BY sm.appointed_at,member.id`).all());
  return found.map(row=>({...mapUser(row,now),appointedAt:iso(row.appointed_at),appointedBy:row.appointed_by}));
}
async function staffOperation(db,user,body,now) {
  requireAdmin(user);
  if(Object.keys(body).some(key=>!['targetPlayerId','action','requestId'].includes(key))||!['appoint','dismiss'].includes(body.action))fail(400,'INVALID_INPUT','スタッフの任命または解除を指定してください。');
  const targetId=idField(body.targetPlayerId,'対象の領主'),requestId=idField(body.requestId,'操作番号');
  if(targetId===user.id)fail(400,'INVALID_TARGET','運営本人をスタッフに変更することはできません。');
  await userExists(db,targetId);
  const check=prior=>{if(prior&&(prior.target_id!==targetId||prior.action!==body.action))fail(409,'REQUEST_ID_REUSED','この操作番号は別のスタッフ操作に使われています。');return prior;};
  const prior=check(await stmt(db,'SELECT target_id,action FROM staff_role_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first());
  const respond=async idempotent=>({ok:true,user:mapUser(await getUser(db,targetId),now),staff:await staffRoster(db,now),action:body.action,idempotent});
  if(prior)return respond(true);
  await budget(db,'staff-role:'+user.id,30,60000,now);
  const roleClock=await getWorldClock(db,now),nonce=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM staff_role_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
  const mutation=body.action==='appoint'
    ?stmt(db,`INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id) DO NOTHING RETURNING user_id`,targetId,user.id,now,nonce,roleClock.elapsedMs,user.id,requestId,nonce)
    :stmt(db,`DELETE FROM staff_members WHERE user_id=? AND ${guard} RETURNING user_id`,targetId,user.id,requestId,nonce);
  const result=await db.batch([
    stmt(db,`INSERT INTO staff_role_requests(actor_id,request_id,target_id,action,commit_token,created_at)
      SELECT ?,?,?,?,?,? FROM users target WHERE target.id=? AND target.id<>?
      AND EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,targetId,body.action,nonce,now,targetId,user.id,user.id),
    ...(body.action==='dismiss'?[stmt(db,`UPDATE staff_campaign_backups SET left_elapsed_ms=COALESCE(left_elapsed_ms,?),updated_at=? WHERE user_id=? AND active=1 AND ${guard}`,roleClock.elapsedMs,now,targetId,user.id,requestId,nonce)]:[]),
    mutation
  ]);
  if(!rows(result[0]).length) {
    const current=check(await stmt(db,'SELECT target_id,action FROM staff_role_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first());
    if(!current){requireAdmin(await getUser(db,user.id));await userExists(db,targetId);fail(409,'STAFF_CHANGED','役職が更新されました。もう一度確認してください。');}
    return respond(true);
  }
  return respond(!rows(result.at(-1)).length);
}

async function route(request, env, now) {
  const url = new URL(request.url), path = url.pathname.slice(API.length), method = request.method;
  const db = env.DB;
  if (!db?.prepare || !db?.batch) fail(503, 'SERVICE_UNAVAILABLE', '通信サービスの準備中です。');
  if(path==='/premium/stripe/webhook'&&method==='POST')return handlePremiumWebhook({db,env,now,request,helpers:{fail}});
  if (path === '/health' && method === 'GET') {
    try {
      await stmt(db, 'SELECT (SELECT COUNT(*) FROM users) AS count,EXISTS(SELECT 1 FROM trades) AS trade_schema,EXISTS(SELECT 1 FROM trade_requests) AS trade_request_schema,EXISTS(SELECT 1 FROM trade_deliveries) AS trade_delivery_schema,EXISTS(SELECT 1 FROM player_bans) AS ban_schema,EXISTS(SELECT 1 FROM moderation_requests) AS moderation_schema,(SELECT content_revision FROM moderation_state WHERE id=1) AS content_revision,EXISTS(SELECT 1 FROM premium_orders) AS premium_order_schema,EXISTS(SELECT 1 FROM premium_events) AS premium_event_schema,EXISTS(SELECT 1 FROM premium_grants) AS premium_grant_schema,EXISTS(SELECT 1 FROM premium_appearances) AS premium_appearance_schema,EXISTS(SELECT 1 FROM timed_events) AS timed_event_schema,EXISTS(SELECT 1 FROM timed_event_requests) AS timed_event_request_schema,EXISTS(SELECT 1 FROM timed_event_participants) AS timed_event_participant_schema,EXISTS(SELECT 1 FROM timed_event_rewards) AS timed_event_reward_schema,EXISTS(SELECT 1 FROM roaming_battles) AS roaming_battle_schema,EXISTS(SELECT 1 FROM covert_states) AS covert_state_schema,EXISTS(SELECT 1 FROM covert_requests) AS covert_request_schema,EXISTS(SELECT 1 FROM covert_battles) AS covert_battle_schema,EXISTS(SELECT 1 FROM covert_incidents) AS covert_incident_schema').first();
    } catch { fail(503, 'SERVICE_UNAVAILABLE', '通信サービスの準備中です。'); }
    return {ok:true,status:'ready',version:API_VERSION,features:API_FEATURES};
  }
  if (path === '/world-clock' && method === 'GET') {
    const clock=await getWorldClock(db,now);await cyclePolicy(db,clock,now);return {ok:true,clock};
  }
  if (path === '/achievements' && method === 'GET') return publicAchievements(db,url,now);
  if (path === '/guild/rankings' && method === 'GET') return guildRankings(db,url,now);
  if (path === '/field' && method === 'GET') {
    const viewer=request.headers.has('authorization')?await authenticate(request,db,now):null;
    return getFieldList(db,viewer,url,now);
  }
  if (path === '/config' && method === 'GET') {
    const result = await db.batch([
      stmt(db, `SELECT key,value FROM settings WHERE key='announcement'`),
      stmt(db, 'SELECT COUNT(DISTINCT user_id) AS count FROM player_presence WHERE online=1 AND last_seen>? AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=player_presence.user_id AND pb.active=1)', now-ONLINE_WINDOW),
    ]);
    const settings = Object.fromEntries(rows(result[0]).map(r => [r.key,r.value]));
    return {ok:true,version:API_VERSION,features:API_FEATURES,announcement:settings.announcement ?? WELCOME,onlineCount:Number(rows(result[1])[0]?.count || 0),clock:await getWorldClock(db,now)};
  }
  if (path === '/online' && method === 'GET') {
    const cursor=url.searchParams.get('cursor')||'',limitText=url.searchParams.get('limit')||'50';
    if(cursor)idField(cursor,'接続一覧の続き');
    if(!/^\d{1,3}$/.test(limitText)||Number(limitText)<1||Number(limitText)>100)fail(400,'INVALID_INPUT','一覧の件数は1～100件で指定してください。');
    const limit=Number(limitText);
    const result=await db.batch([
      stmt(db,USER_SELECT+' WHERE u.id>? AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1) AND EXISTS(SELECT 1 FROM player_presence ap WHERE ap.user_id=u.id AND ap.online=1 AND ap.last_seen>?) ORDER BY u.id LIMIT ?',cursor,now-ONLINE_WINDOW,limit+1),
      stmt(db,'SELECT COUNT(DISTINCT user_id) AS count FROM player_presence WHERE online=1 AND last_seen>? AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=player_presence.user_id AND pb.active=1)',now-ONLINE_WINDOW),
    ]);
    const found=rows(result[0]),players=found.slice(0,limit).map(row=>mapUser(row,now));
    return {ok:true,players,total:Number(rows(result[1])[0]?.count||0),nextCursor:found.length>limit?players.at(-1).id:null,onlineWindowSeconds:ONLINE_WINDOW/1000};
  }
  if (path === '/devices/link' && method === 'POST') {
    const scope=await ipScope(request,env,'pair-link-ip');
    await budget(db,scope||'pair-link-unattributed',12,15*60*1000,now);
    const body=await readBody(request),code=codeField(body.code),deviceName=textField(body.deviceName,'端末名',64,{optional:true})||'連携した端末';
    const codeHash=await hash('pair:v1:'+code),token=gameToken(),tokenHash=await hash(token);
    const candidate=await stmt(db,'SELECT p.user_id,COALESCE(b.active,0) AS ban_active,COALESCE(b.revision,0) AS moderation_epoch FROM pairing_codes p LEFT JOIN player_bans b ON b.user_id=p.user_id WHERE p.code_hash=? AND p.expires_at>?',codeHash,now).first();
    if(candidate?.ban_active)fail(403,'ACCOUNT_BANNED','この領主のオンライン利用は停止されています。');
    const linkGuard="NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=pairing_codes.user_id AND active=1) AND COALESCE((SELECT revision FROM player_bans WHERE user_id=pairing_codes.user_id),0)=?";
    // D1 batches are transactions: exactly one redemption can both create a token
    // and consume this code. A failed batch leaves the code usable for a retry.
    const result=await db.batch([
      stmt(db,`INSERT INTO user_sessions(token_hash,user_id,device_name,created_at,last_seen)
        SELECT ?,user_id,?,?,? FROM pairing_codes WHERE code_hash=? AND expires_at>? AND ${linkGuard}`,tokenHash,deviceName,now,now,codeHash,now,Number(candidate?.moderation_epoch||0)),
      stmt(db,'DELETE FROM pairing_codes WHERE code_hash=? AND expires_at>? AND '+linkGuard+' RETURNING user_id',codeHash,now,Number(candidate?.moderation_epoch||0)),
    ]);
    const linked=rows(result[1])[0];
    if(!linked){if(candidate)await requireAccountAccess(db,{id:candidate.user_id,moderation_epoch:candidate.moderation_epoch});fail(410,'PAIR_CODE_EXPIRED','連携コードは使用済みか、有効期限が切れています。元の端末で新しく発行してください。');}
    return {ok:true,token,user:mapUser(await getUser(db,linked.user_id),now)};
  }
  if (path === '/admin/recover' && method === 'POST') {
    const body=await readBody(request);
    if(Object.keys(body).some(key=>!['key','requestId','deviceName'].includes(key))||typeof body.key!=='string'||body.key.length<1||body.key.length>256||typeof body.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId))fail(400,'INVALID_INPUT','運営登録キーと復旧の識別情報を確認してください。');
    const deviceName=textField(body.deviceName,'端末名',64,{optional:true})||'運営を復旧した端末';
    const scope=await ipScope(request,env,'admin-recovery-ip');
    await budget(db,scope||'admin-recovery-unattributed',5,10*60*1000,now);
    if(typeof env.SENGOKU_ADMIN_KEY!=='string'||env.SENGOKU_ADMIN_KEY.length<1)fail(503,'ADMIN_RECOVERY_UNAVAILABLE','運営の復旧を現在利用できません。');
    const validKey=await constantEqual(body.key,env.SENGOKU_ADMIN_KEY);
    const admin=await stmt(db,USER_SELECT+" WHERE u.id=(SELECT value FROM settings WHERE key='adminUserId')").first();
    if(!validKey||!admin?.is_admin)fail(403,'ADMIN_RECOVERY_FAILED','運営を復旧できません。初回に使用した運営登録キーをご確認ください。');
    // Invalid attempts from unrelated IPs must not exhaust the real owner's
    // cross-device recovery allowance.
    await budget(db,'admin-recovery-user:'+admin.id,30,60*60*1000,now);
    const token=await adminRecoveryToken(env.SENGOKU_ADMIN_KEY,admin.id,body.requestId.toLowerCase()),tokenHash=await hash(token);
    const result=await db.batch([
      stmt(db,`INSERT INTO user_sessions(token_hash,user_id,device_name,created_at,last_seen)
        SELECT ?,u.id,?,?,? FROM users u JOIN settings s ON s.key='adminUserId' AND s.value=u.id WHERE u.id=?
        ON CONFLICT(token_hash) DO NOTHING`,tokenHash,deviceName,now,now,admin.id),
      stmt(db,'SELECT user_id,revoked_at FROM user_sessions WHERE token_hash=?',tokenHash),
      stmt(db,USER_SELECT+" WHERE u.id=(SELECT value FROM settings WHERE key='adminUserId')"),
    ]);
    const session=rows(result[1])[0],current=rows(result[2])[0];
    if(!session||session.revoked_at!==null||session.user_id!==admin.id||current?.id!==admin.id||!current.is_admin)fail(403,'ADMIN_RECOVERY_FAILED','運営を復旧できません。初回に使用した運営登録キーをご確認ください。');
    return {ok:true,token,user:mapUser(current,now),recovered:true};
  }
  if (path === '/session' && method === 'POST') {
    const body = await readBody(request);
    const scope = await ipScope(request, env, 'session');
    if (scope) await budget(db, scope, 30, 60*60*1000, now);
    const name = textField(body.name, '領主名', 24, {optional:true}) || '旅の領主' + crypto.randomUUID().slice(0,6);
    const clan = textField(body.clan, '勢力名', 24, {optional:true}) || '織田家';
    if(clan===ADMIN_CLAN)fail(403,'ADMIN_CLAN_REQUIRED','この家名は選択できません。徳川家を選択してください。');
    const id = uid('u_'), token = gameToken();
    try { await stmt(db,'INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)',id,name,nameKey(name),clan,await hash(token),now,now).run(); }
    catch (error) { if (/unique/i.test(String(error))) fail(409,'NAME_TAKEN','その領主名はすでに使われています。別の名前をお選びください。'); throw error; }
    return {ok:true,token,user:mapUser(await getUser(db,id),now)};
  }

  if(path==='/events'||path.startsWith('/events/')||path==='/admin/events'||path.startsWith('/admin/events/')){
    const user=method==='GET'&&!path.startsWith('/admin/')&&!request.headers.has('authorization')?null:await authenticate(request,db,now);
    return handleEvents({db,user,now,path,method,url,request,helpers:{fail,readBody,budget,idField,textField,uid,hash,getUser,getSyncRow,requireAdmin,requireAccountAccess,roleCommitGuard,evaluationRef,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,syncSnapshot,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  }
  let user = await authenticate(request,db,now);
  if(path==='/premium'||path.startsWith('/premium/')||path==='/admin/premium/reviews')return handlePremium({db,env,user,now,path,method,request,helpers:{fail,readBody,budget,accountCommitGuard,requireAccountAccess,requireAdmin,getUser,textField,idField,hash,uid,evaluationRef}});
  if(path==='/admin/moderation'||path.startsWith('/admin/moderation/'))return handleModeration({db,user,now,path,method,url,request,helpers:{fail,readBody,budget,idField,textField,uid,hash,mapUser,getUser,requireAdmin,userSelect:USER_SELECT}});
  if (path === '/me/avatar' && method === 'PUT') return putAvatar(request,env,user,now);
  if (path === '/me/avatar' && method === 'DELETE') return deleteAvatar(request,env,user,now);
  if (path === '/staff/recent-logins' && method === 'GET') return recentLogins(db,user,url,now);
  if (path === '/guild/treasury' && method === 'GET') return readTreasury(db,user,url,now);
  if (path === '/guild/treasury/transfer' && method === 'POST') return guildTransfer(db,user,await readBody(request),now);
  if (path === '/guild/members/role' && method === 'POST') return guildManage(db,user,await readBody(request),false,now);
  if (path === '/guild/members/remove' && method === 'POST') return guildManage(db,user,await readBody(request),true,now);
  if (path === '/admin/staff' && method === 'GET') { requireAdmin(user);return {ok:true,staff:await staffRoster(db,now)}; }
  if (path === '/admin/staff' && method === 'POST') return staffOperation(db,user,await readBody(request),now);
  if (path === '/staff/base' && method === 'GET') {
    user=await requireCurrentStaffBase(db,user,{allowAdmin:true});const clock=await getWorldClock(db,now);await ensureStaffCampaign(db,user,now,clock);const staffBase=await staffBaseDto(db,user,clock,now);await requireCurrentStaffBase(db,user,{allowAdmin:true});return {ok:true,staffBase:publicStaffBase(staffBase),clock};
  }
  if (path === '/staff/base/upgrade' && method === 'POST') return staffBaseUpgrade(db,user,await readBody(request),now);
  if (path === '/walking/start' && method === 'POST') return walkingStart(db,user,await readBody(request),now);
  if (path === '/walking/claim' && method === 'POST') return walkingClaim(db,user,await readBody(request),now);
  if (path === '/covert' || path.startsWith('/covert/')) return handleCovert({db,user,now,path,method,url,request,helpers:{fail,readBody,budget,idField,hash,getUser,getSyncRow,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,staffBaseDto,getFieldList,fieldStaffDefense,fieldDefense,fieldRelation,fieldRelationStatus,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/roaming/battle' && method === 'POST' || path === '/roaming/history' && method === 'GET') return handleRoaming({db,user,now,path,method,url,request,helpers:{fail,readBody,budget,idField,hash,getUser,getSyncRow,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,staffBaseDto,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/letters' || path.startsWith('/letters/')) return handleLetters({db,user,now,path,method,url,request,helpers:{fail,readBody,budget,idField,textField,uid,mapUser,getUser,evaluationRef,evaluationUpdates,accountCommitGuard,requireAccountAccess,contentRevisionInput}});
  if (path === '/trades' || path.startsWith('/trades/')) return handleTrades({db,user,now,path,method,url,request,helpers:{fail,readBody,budget,idField,uid,mapUser,getUser,getSyncRow,hash,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,tradeTroopCapacity,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/field/me' && method === 'GET') return fieldMe(db,user,url,now);
  if (path === '/field/attack' && method === 'POST') return fieldAttack(db,user,await readBody(request),now);
  if (path === '/field/diplomacy' && method === 'POST') return fieldDiplomacy(db,user,await readBody(request),now);
  if (path === '/world-clock' && method === 'PATCH') {
    requireAdmin(user);
    const body=await readBody(request);
    if(Object.keys(body).some(key=>!['revision','running','speed'].includes(key))||!Number.isSafeInteger(body.revision)||body.revision<0||body.running===undefined&&body.speed===undefined||body.running!==undefined&&typeof body.running!=='boolean'||body.speed!==undefined&&![1,2,4].includes(body.speed))fail(400,'INVALID_INPUT','共通時計の更新番号と、一時停止・速度（1・2・4）の変更を指定してください。');
    await budget(db,'world-clock-control:'+user.id,60,60000,now);
    const prior=await getWorldClockRow(db,now),current=mapWorldClock(prior,now);
    if(current.revision!==body.revision)fail(409,'CLOCK_REVISION_CONFLICT','共通時計が別の端末で更新されました。最新の時計を確認してください。');
    const changed=await stmt(db,`UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=?,speed=?,revision=revision+1
      WHERE id=? AND revision=? RETURNING *`,current.elapsedMs,now,(body.running??current.running)?1:0,body.speed??current.speed,WORLD_CLOCK_ID,body.revision).first();
    if(!changed)fail(409,'CLOCK_REVISION_CONFLICT','共通時計が別の端末で更新されました。最新の時計を確認してください。');
    return {ok:true,clock:mapWorldClock(changed,now)};
  }
  if (path === '/devices/pair-code' && method === 'POST') {
    await readBody(request);
    await budget(db,'pair-code:'+user.id,5,10*60*1000,now);
    const code=pairingCode(),expiresAt=now+PAIR_CODE_LIFETIME,access=accountCommitGuard(user);
    const result=await db.batch([
      stmt(db,'DELETE FROM pairing_codes WHERE (user_id=? OR expires_at<=?) AND '+access.sql,user.id,now,...access.args),
      stmt(db,'INSERT INTO pairing_codes(code_hash,user_id,created_at,expires_at) SELECT ?,?,?,? WHERE '+access.sql+' RETURNING code_hash',await hash('pair:v1:'+code),user.id,now,expiresAt,...access.args),
    ]);
    if(!rows(result[1]).length)await requireAccountAccess(db,user);
    return {ok:true,code,expiresAt:iso(expiresAt)};
  }
  if (path === '/presence' && method === 'POST') {
    const body=await readBody(request),deviceId=idField(body.deviceId,'端末識別子'),deviceName=textField(body.deviceName,'端末名',64,{optional:true})||'接続中の端末';
    if(typeof body.online!=='boolean')fail(400,'INVALID_INPUT','接続状態を指定してください。');
    await budget(db,'presence:'+user.id,180,60000,now);
    const access=accountCommitGuard(user),present=await stmt(db,`INSERT INTO player_presence(user_id,device_id,device_name,online,last_seen) SELECT ?,?,?,?,? WHERE ${access.sql}
      ON CONFLICT(user_id,device_id) DO UPDATE SET device_name=excluded.device_name,online=excluded.online,last_seen=excluded.last_seen RETURNING user_id`,user.id,deviceId,deviceName,body.online?1:0,now,...access.args).first();
    if(!present)await requireAccountAccess(db,user);
    // A browser session can leave many random tab IDs over time; retain only recent
    // presence. This affects neither identity tokens nor cloud saves.
    await stmt(db,'DELETE FROM player_presence WHERE user_id=? AND last_seen<?',user.id,now-24*60*60*1000).run();
    return {ok:true,user:mapUser(await getUser(db,user.id),now),onlineWindowSeconds:ONLINE_WINDOW/1000};
  }
  if (path === '/sync' && method === 'GET') {
    const deviceId=url.searchParams.get('deviceId');
    if(deviceId)idField(deviceId,'端末識別子');
    return syncSnapshot(db,await getSyncRow(db,user.id),user,deviceId,now);
  }
  if (path === '/sync/settle' && method === 'POST') {
    const body=await readBody(request),deviceId=idField(body.deviceId,'端末識別子');
    if(Object.keys(body).some(key=>!['deviceId','revision'].includes(key))||!Number.isSafeInteger(body.revision)||body.revision<0)fail(400,'INVALID_INPUT','保存の更新番号が正しくありません。');
    await budget(db,'sync-settle:'+user.id,60,60000,now);
    const row=await getSyncRow(db,user.id);fieldWriter(row,deviceId,body.revision,now);
    return syncSnapshot(db,row,user,deviceId,now,{settle:true});
  }
  if (path === '/sync/lease' && method === 'POST') {
    const body=await readBody(request),deviceId=idField(body.deviceId,'端末識別子'),deviceName=textField(body.deviceName,'端末名',64,{optional:true})||'プレイ中の端末';
    if(body.takeOver!==undefined&&typeof body.takeOver!=='boolean')fail(400,'INVALID_INPUT','端末の切替方法が正しくありません。');
    await budget(db,'sync-lease:'+user.id,120,60000,now);
    const access=accountCommitGuard(user);
    const result=await db.batch([
      stmt(db,'INSERT INTO player_saves(user_id) SELECT ? WHERE '+access.sql+' ON CONFLICT(user_id) DO NOTHING',user.id,...access.args),
      stmt(db,`UPDATE player_saves SET writer_device_id=?,writer_device_name=?,lease_expires_at=?
        WHERE user_id=? AND (writer_device_id IS NULL OR writer_device_id=? OR lease_expires_at<=? OR ?=1) AND ${access.sql} RETURNING *`,deviceId,deviceName,now+SYNC_LEASE,user.id,deviceId,now,body.takeOver?1:0,...access.args),
    ]);
    const row=rows(result[1])[0];
    if(!row){await requireAccountAccess(db,user);fail(409,'LEASE_HELD','別の端末がプレイ中です。続ける場合は「この端末でプレイ」を選んでください。');}
    return syncSnapshot(db,row,user,deviceId,now);
  }
  if (path === '/sync/release' && method === 'POST') {
    const body=await readBody(request),deviceId=idField(body.deviceId,'端末識別子'),access=accountCommitGuard(user);
    await stmt(db,'UPDATE player_saves SET writer_device_id=NULL,writer_device_name=NULL,lease_expires_at=0 WHERE user_id=? AND writer_device_id=? AND '+access.sql,user.id,deviceId,...access.args).run();
    return syncSnapshot(db,await getSyncRow(db,user.id),user,deviceId,now);
  }
  if (path === '/sync' && method === 'PUT') {
    const body=await readBody(request,MAX_SAVE_BODY),deviceId=idField(body.deviceId,'端末識別子');
    if(!Number.isSafeInteger(body.revision)||body.revision<0)fail(400,'INVALID_INPUT','セーブの更新番号が正しくありません。');
    if(!body.save||typeof body.save!=='object'||Array.isArray(body.save))fail(400,'INVALID_SAVE','セーブデータを送信してください。');
    // Covert units, reports and response opportunities belong to the server ledger.
    // Ignore that entire client section, including malformed or forged imports.
    const imported=copy(body.save);delete (imported.state||imported).covert;
    const clock=await getWorldClock(db,now),save=normalizeGameSave(imported,user,now,{clock});
    await budget(db,'sync-write:'+user.id,120,60000,now);
    let previous=await getSyncRow(db,user.id);if(previous?.save_json){fieldWriter(previous,deviceId,body.revision,now);previous=await ensureStaffCampaign(db,user,now,clock,{deferClanMigration:true});fieldWriter(previous,deviceId,body.revision,now);}
    const before=previous?.save_json?normalizeGameSave(JSON.parse(previous.save_json),user,now,{reading:true,clock}):null;
    if(!previous||previous.writer_device_id!==deviceId||Number(previous.lease_expires_at)<=now)fail(409,'LEASE_REQUIRED','プレイ端末の同期権限が切れました。');
    if(Number(previous.revision)!==body.revision)fail(409,'REVISION_CONFLICT','最新の保存へ同期してください。');
    if(before?.state.worldClock&&!save.state.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','この領主は共通時計へ移行済みです。共通時計に対応した最新版から保存してください。');
    const policy=await cyclePolicy(db,clock,now),currentCycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);
    let cycleIndex=previous?.cycle_index??Math.max(policy,currentCycle),cycleHome=user.is_admin?'edo':user.is_staff?'sunpu':previous?.cycle_home&&!['edo','sunpu'].includes(previous.cycle_home)?previous.cycle_home:save.state.cycle?.home||save.state.home;
    if(previous?.cycle_index!==null&&previous?.cycle_index!==undefined){
      if(save.state.cycle&&save.state.cycle.index!==Number(cycleIndex)||save.state.worldClock&&Math.floor(save.state.worldClock.elapsedMs/WORLD_CYCLE_MS)>Number(cycleIndex)){
        await settlePlayerCycle(db,previous,user,now,clock,{deferActive:false,writerDeviceId:deviceId});fail(409,'CYCLE_SETTLEMENT_REQUIRED','領地の精算を同期しています。最新データを読み込んでください。');
      }
      if(before?.state.cycle?.latestReward&&save.state.worldClock&&save.state.worldClock.elapsedMs<Number(cycleIndex)*WORLD_CYCLE_MS)fail(409,'CLOCK_REWIND','古い時刻のセーブで上書きできません。最新データへ同期してください。');
      // An explicit fresh campaign may choose a new ordinary starting home.
      if(!user.is_admin&&!user.is_staff&&save.state.home!==before?.state.home&&Object.values(save.state.stats).every(v=>v===0)&&Object.values(save.state.castles).filter(c=>c.owner===save.state.clan).length===1&&!MAJOR_CITIES.includes(save.state.home))cycleHome=save.state.home;
    }
    save.state.cycle={index:Number(cycleIndex),home:cycleHome,latestReward:before?.state.cycle?.latestReward||null};
    // The receipt ledger is outside imported game saves. Restoring an older save
    // never tops up currency or rewinds previously credited online steps.
    const walkingLedger=await stmt(db,'SELECT total_steps FROM walking_accounts WHERE user_id=?',user.id).first();
    save.state.walking.serverSteps=Number(walkingLedger?.total_steps||0);
    await reconcileRoamingProgress(db,user.id,save,before);
    await reconcileCovertProgress(db,user.id,save);
    const serialized=JSON.stringify(save),nonce=crypto.randomUUID(),roleGuard=roleCommitGuard(user);
    const statements=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_index=?,cycle_home=?,cycle_commit=?
      WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?
      AND (?=1 OR json_type(save_json,'$.state.worldClock') IS NULL) AND ${roleGuard.sql} RETURNING *`,serialized,now,now+SYNC_LEASE,cycleIndex,cycleHome,nonce,user.id,body.revision,deviceId,now,save.state.worldClock?1:0,...roleGuard.args)];
    const gate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)';
    const personal=await staffPersonalProgressStatement(db,user,save,now,gate,[user.id,nonce]);if(personal)statements.push(personal);
    for(const event of saveAchievements(before,save))statements.push(achievementStatement(db,user.id,event,now,gate,[user.id,nonce]));
    const changed=await db.batch(statements),row=rows(changed[0])[0];
    if(!row) {
      await requireAccountAccess(db,user);
      const current=await getSyncRow(db,user.id);
      if(!current||current.writer_device_id!==deviceId||Number(current.lease_expires_at)<=now)fail(409,'LEASE_REQUIRED','プレイ端末の同期権限が切れました。接続状態を確認してください。');
      if(Number(current.revision)===body.revision&&!save.state.worldClock&&current.save_json&&JSON.parse(current.save_json).state?.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','この領主は共通時計へ移行済みです。共通時計に対応した最新版から保存してください。');
      fail(409,'REVISION_CONFLICT','新しいセーブが届いています。最新データを読み込んでから再開してください。');
    }
    if(!user.is_staff&&user.clan!==save.state.clan||user.is_admin&&user.clan!==save.state.clan) {
      await stmt(db,'UPDATE users SET clan=? WHERE id=?',save.state.clan,user.id).run();
      user.clan=save.state.clan;
    }
    return syncSnapshot(db,row,user,deviceId,now,{settle:true});
  }
  if (path === '/me' && method === 'GET') {
    const result = await db.batch([
      stmt(db, USER_SELECT + ` WHERE u.id IN (SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END FROM friendships WHERE (user_a=? OR user_b=?) AND status='accepted') ORDER BY u.name`,user.id,user.id,user.id),
      stmt(db, `SELECT f.requested_by,f.created_at,u.id,u.name,u.clan,
        (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id) AS avatar_version,
        CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
        EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
        (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan
        FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END WHERE (f.user_a=? OR f.user_b=?) AND f.status='pending' ORDER BY f.created_at DESC`,user.id,user.id,user.id),
      stmt(db, `SELECT COUNT(*) AS count FROM mail_campaigns m WHERE (m.target_user_id IS NULL OR m.target_user_id=?) AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?)`,user.id,user.id),
    ]);
    return {ok:true,user:mapUser(user,now),...(user.is_admin?{management:{recoveryAvailable:typeof env.SENGOKU_ADMIN_KEY==='string'&&env.SENGOKU_ADMIN_KEY.length>0}}:{}),friends:rows(result[0]).map(r=>mapUser(r,now)),requests:rows(result[1]).map(r=>({id:r.id,name:r.name,clan:publicClan(r.clan,r.is_admin,r.is_staff,r.personal_clan),avatarVersion:r.avatar_version||null,evaluation:evaluationRef(r.id),direction:r.requested_by===user.id?'outgoing':'incoming',createdAt:iso(r.created_at)})),unreadMail:Number(rows(result[2])[0]?.count || 0)};
  }
  if (path === '/profile' && method === 'PATCH') {
    const body = await readBody(request), name = textField(body.name,'領主名',24),expectedName=Object.hasOwn(body,'expectedName')?textField(body.expectedName,'変更前の領主名',24):null;
    if(!user.is_admin&&!user.is_staff&&typeof body.clan==='string'&&body.clan.normalize('NFC').trim()===ADMIN_CLAN)fail(403,'ADMIN_CLAN_REQUIRED','この家名は選択できません。徳川家を選択してください。');
    if(name!==user.name)await budget(db,'profile-name:'+user.id,20,60000,now);
    const access=accountCommitGuard(user);let changed;
    try { changed=await stmt(db,'UPDATE users SET name=?,name_key=? WHERE id=? AND '+access.sql+' AND (? IS NULL OR name=? OR name=?) RETURNING id',name,nameKey(name),user.id,...access.args,expectedName,expectedName,name).all(); }
    catch (error) { if (/unique/i.test(String(error))) fail(409,'NAME_TAKEN','その領主名はすでに使われています。'); throw error; }
    if(!rows(changed).length){await requireAccountAccess(db,user);fail(409,'PROFILE_CHANGED','別の端末で領主名が変更されました。最新の名前を確認してから、もう一度お試しください。');}
    return {ok:true,user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/players' && method === 'GET') {
    const q = textField(url.searchParams.get('q'),'検索語',24,{min:2});
    const pattern = '%' + q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_') + '%';
    const result = await stmt(db,USER_SELECT + ` WHERE (u.name LIKE ? ESCAPE '\\' OR u.id=?) AND u.id<>? AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1) ORDER BY u.last_seen DESC,u.name LIMIT 30`,pattern,q,user.id).all();
    return {ok:true,players:rows(result).map(r=>mapUser(r,now))};
  }
  if (path === '/chat' && method === 'GET') {
    const channel = url.searchParams.get('channel') || 'world';
    const room = await roomFor(db,user,channel,url.searchParams.get('target'));
    const afterText = url.searchParams.get('after') || '0';
    if (!/^\d{1,15}$/.test(afterText)) fail(400,'INVALID_CURSOR','読み込み位置が正しくありません。');
    const after=Number(afterText),known=contentRevisionInput(url),access=accountCommitGuard(user),channelGuard=channel==='admin'?STAFF_CHAT_GUARD:channel==='guild'?GUILD_MEMBER_GUARD:'1',channelArgs=channel==='admin'?[user.id,user.id]:channel==='guild'?[user.id,user.guild_id]:[],guard=channelGuard+' AND '+access.sql,guardParams=[...channelArgs,...access.args];
    // Revision and messages share one snapshot. A stale delta cursor is replaced
    // by the latest page, so deleted messages cannot remain in a merged cache.
    const query=MESSAGE_SELECT+` CROSS JOIN moderation_state mc WHERE mc.id=1 AND m.room_key=? AND ${guard}
      AND (?<>mc.content_revision OR ?=0 OR m.id>?) ORDER BY CASE WHEN ?=mc.content_revision AND ?>0 THEN m.id END ASC,m.id DESC LIMIT 100`;
    const read=await db.batch([
      stmt(db,'SELECT 1 AS allowed WHERE '+guard,...guardParams),
      stmt(db,query,room,...guardParams,known,after,after,known,after),
      stmt(db,'SELECT DISTINCT user_id FROM (SELECT m.user_id FROM messages m WHERE m.room_key=? AND '+guard+' ORDER BY m.id DESC LIMIT 100)',room,...guardParams),
      stmt(db,'SELECT content_revision FROM moderation_state WHERE id=1')
    ]);
    const allowed=rows(read[0])[0];if(!allowed){await requireAccountAccess(db,user);fail(403,channel==='admin'?'STAFF_CHAT_REQUIRED':'GUILD_REQUIRED','このチャットの参加権限がありません。');}
    const contentRevision=Number(rows(read[3])[0].content_revision),reset=known!==contentRevision,delta=after>0&&!reset,messages=rows(read[1]).map(mapMessage);
    if(!delta)messages.reverse();
    return {ok:true,channel,contentRevision,reset,messages,playerEvaluations:evaluationUpdates([...messages.map(message=>message.userId),...rows(read[2]).map(row=>row.user_id)]),nextAfter:messages.at(-1)?.id||(delta?after:0),hasMore:messages.length===100};
  }
  if (path === '/chat' && method === 'POST') {
    const body=await readBody(request), channel=textField(body.channel,'チャット種別',12), text=textField(body.text,'メッセージ',300);
    const room=await roomFor(db,user,channel,body.target);
    await budget(db,'chat:'+user.id,1,5000,now);
    const access=accountCommitGuard(user),guard=(channel==='admin'?STAFF_CHAT_GUARD:channel==='guild'?GUILD_MEMBER_GUARD:'1')+' AND '+access.sql,guardParams=[...(channel==='admin'?[user.id,user.id]:channel==='guild'?[user.id,user.guild_id]:[]),...access.args];
    const inserted=await stmt(db,'INSERT INTO messages(room_key,channel,user_id,body,created_at) SELECT ?,?,?,?,? WHERE '+guard+' RETURNING id',room,channel,user.id,text,now,...guardParams).first();
    if(!inserted){await requireAccountAccess(db,user);fail(403,channel==='admin'?'STAFF_CHAT_REQUIRED':'GUILD_REQUIRED','このチャットの参加権限がありません。');}
    await requireAccountAccess(db,user);
    const message=await stmt(db,MESSAGE_SELECT+' WHERE m.id=?',inserted.id).first();
    if(!message){await requireAccountAccess(db,user);fail(409,'CONTENT_CHANGED','投稿が更新されました。最新の一覧を確認してください。');}
    return {ok:true,message:mapMessage(message),contentRevision:Number((await stmt(db,'SELECT content_revision FROM moderation_state WHERE id=1').first()).content_revision)};
  }
  if (path === '/guilds' && method === 'GET') {
    const result=await stmt(db,GUILD_SELECT+' ORDER BY member_count DESC,g.name LIMIT 50').all();
    return {ok:true,guilds:rows(result).map(mapGuild)};
  }
  if (path === '/guild' && method === 'GET') {
    return guildSnapshot(db,user,now);
  }
  if (path === '/guild' && method === 'POST') {
    const body=await readBody(request),name=textField(body.name,'ギルド名',24);
    if (user.guild_id) fail(409,'ALREADY_IN_GUILD','所属中のギルドを脱退してから作成してください。');
    const id=uid('g_'),access=accountCommitGuard(user);
    try { await db.batch([
      stmt(db,'INSERT INTO guilds(id,name,name_key,owner_id,created_at) SELECT ?,?,?,?,? WHERE '+access.sql,id,name,nameKey(name),user.id,now,...access.args),
      stmt(db,'INSERT INTO guild_members(user_id,guild_id,joined_at) SELECT ?,?,? WHERE '+access.sql,user.id,id,now,...access.args),
      stmt(db,'INSERT INTO guild_treasuries(guild_id) SELECT ? WHERE '+access.sql,id,...access.args),
    ]); } catch(error) { if (/unique/i.test(String(error))) fail(409,'GUILD_CONFLICT','そのギルド名は使われているか、すでに別のギルドへ参加しています。'); throw error; }
    await requireAccountAccess(db,user);
    return {ok:true,guild:mapGuild(await stmt(db,GUILD_SELECT+' WHERE g.id=?',id).first()),user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/guild/join' && method === 'POST') {
    const body=await readBody(request),guildId=idField(body.guildId,'ギルドの識別子');
    if (user.guild_id===guildId) return {ok:true,user:mapUser(user,now)};
    if (user.guild_id) fail(409,'ALREADY_IN_GUILD','所属中のギルドを脱退してから参加してください。');
    if (!await stmt(db,'SELECT id FROM guilds WHERE id=?',guildId).first()) fail(404,'GUILD_NOT_FOUND','そのギルドは見つかりませんでした。');
    const access=accountCommitGuard(user);await stmt(db,`INSERT INTO guild_members(user_id,guild_id,joined_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM guilds WHERE id=?) AND (SELECT COUNT(*) FROM guild_members WHERE guild_id=?)<? AND ${access.sql} ON CONFLICT(user_id) DO NOTHING`,user.id,guildId,now,guildId,guildId,MAX_GUILD_MEMBERS,...access.args).run();
    const current=await getUser(db,user.id);
    if (current.guild_id!==guildId) fail(409,'GUILD_UNAVAILABLE','ギルドが満員か、すでに別のギルドへ参加しています。');
    return {ok:true,user:mapUser(current,now)};
  }
  if (path === '/guild/leave' && method === 'POST') {
    return guildLeave(db,user,await readBody(request),now);
  }
  if (path === '/friends/request' && method === 'POST') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子');
    if(other===user.id) fail(400,'INVALID_TARGET','自分自身へ友達申請は送れません。');
    await userExists(db,other);
    const [a,b]=pair(user.id,other);
    const prior=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    if(prior) return {ok:true,status:prior.status,direction:prior.requested_by===user.id?'outgoing':'incoming'};
    await budget(db,'friend-request:'+user.id,20,600000,now);
    const access=accountCommitGuard(user);await stmt(db,`INSERT INTO friendships(user_a,user_b,requested_by,status,created_at,updated_at) SELECT ?,?,?,'pending',?,? WHERE ${access.sql} ON CONFLICT(user_a,user_b) DO NOTHING`,a,b,user.id,now,now,...access.args).run();
    await requireAccountAccess(db,user);
    const current=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    return {ok:true,status:current.status,direction:current.requested_by===user.id?'outgoing':'incoming'};
  }
  if (path === '/friends/respond' && method === 'POST') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子');
    if(typeof body.accept!=='boolean') fail(400,'INVALID_INPUT','承認するかどうかを指定してください。');
    const [a,b]=pair(user.id,other);
    const prior=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    if(!prior||prior.status!=='pending'||prior.requested_by!==other) fail(403,'REQUEST_NOT_FOUND','承認できる友達申請がありません。');
    const access=accountCommitGuard(user);
    if(body.accept) await stmt(db,`UPDATE friendships SET status='accepted',updated_at=? WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=? AND ${access.sql}`,now,a,b,other,...access.args).run();
    else await stmt(db,`DELETE FROM friendships WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=? AND ${access.sql}`,a,b,other,...access.args).run();
    return {ok:true,status:body.accept?'accepted':'declined'};
  }
  if (path === '/friends' && method === 'DELETE') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子'),[a,b]=pair(user.id,other),access=accountCommitGuard(user);
    await stmt(db,'DELETE FROM friendships WHERE user_a=? AND user_b=? AND '+access.sql,a,b,...access.args).run();
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
    const claimClock=await getWorldClock(db,now);
    const result=await db.batch([
      stmt(db,`INSERT INTO settings(key,value,updated_at) VALUES('adminUserId',?,?) ON CONFLICT(key) DO NOTHING`,user.id,now),
      stmt(db,`SELECT value FROM settings WHERE key='adminUserId'`),
      stmt(db,`UPDATE staff_campaign_backups SET left_elapsed_ms=COALESCE(left_elapsed_ms,?),updated_at=? WHERE user_id=? AND active=1 AND EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)`,claimClock.elapsedMs,now,user.id,user.id),
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
    const result=await stmt(db,`SELECT m.id,m.title,m.body,m.gift_json,m.request_id,m.created_at,r.read_at,c.receipt_id,b.result_json AS battle_json FROM mail_campaigns m LEFT JOIN mail_reads r ON r.mail_id=m.id AND r.user_id=? LEFT JOIN mail_receipts c ON c.mail_id=m.id AND c.user_id=? LEFT JOIN field_battles b ON b.id=substr(m.request_id,14,35) AND (b.attacker_id=m.target_user_id OR b.defender_id=m.target_user_id) WHERE m.target_user_id IS NULL OR m.target_user_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 200`,user.id,user.id,user.id).all();
    return {ok:true,mail:rows(result).map(r=>{const event=systemMailEvent(r.request_id),battle=event&&r.battle_json?JSON.parse(r.battle_json):null;return {id:r.id,title:r.title,body:r.body,gift:r.gift_json?JSON.parse(r.gift_json):null,read:r.read_at!==null,claimed:!!r.receipt_id,createdAt:iso(r.created_at),source:event?'system':'site',event,...(event?{participants:battle?['attacker','defender'].map(side=>({playerId:battle[side+'PlayerId'],name:battle[side+'Name'],side,evaluation:evaluationRef(battle[side+'PlayerId'])})):[]}:{} )};})};
  }
  if (path === '/mail/read' && method === 'POST') {
    const body=await readBody(request),mailId=idField(body.mailId,'メール識別子');
    await visibleMail(db,user.id,mailId);
    const access=accountCommitGuard(user);await stmt(db,'INSERT INTO mail_reads(mail_id,user_id,read_at) SELECT ?,?,? WHERE '+access.sql+' ON CONFLICT(mail_id,user_id) DO NOTHING',mailId,user.id,now,...access.args).run();
    return {ok:true,read:true};
  }
  if (path === '/mail/claim' && method === 'POST') {
    const body=await readBody(request),mailId=idField(body.mailId,'メール識別子'),requestId=idField(body.requestId,'リクエスト識別子');
    const mail=await visibleMail(db,user.id,mailId);
    if(!mail.gift_json) fail(400,'NO_GIFT','このメールには贈り物がありません。');
    const reused=await stmt(db,'SELECT mail_id FROM mail_receipts WHERE user_id=? AND request_id=?',user.id,requestId).first();
    if(reused&&reused.mail_id!==mailId) fail(409,'IDEMPOTENCY_CONFLICT','別の贈り物に使用した受取番号です。');
    const receiptId=uid('r_'),access=accountCommitGuard(user);
    let result;
    try {result=await db.batch([
      stmt(db,`INSERT INTO mail_receipts(mail_id,user_id,receipt_id,request_id,gift_json,claimed_at) SELECT id,?,?,?,?,? FROM mail_campaigns WHERE id=? AND (target_user_id IS NULL OR target_user_id=?) AND gift_json IS NOT NULL AND ${access.sql} ON CONFLICT(mail_id,user_id) DO NOTHING`,user.id,receiptId,requestId,mail.gift_json,now,mailId,user.id,...access.args),
      stmt(db,'INSERT INTO mail_reads(mail_id,user_id,read_at) SELECT ?,?,? WHERE '+access.sql+' ON CONFLICT(mail_id,user_id) DO NOTHING',mailId,user.id,now,...access.args),
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
        return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>戦国VS 通信局</title><body style="font-family:system-ui;background:#101318;color:#eee;padding:3rem"><h1>戦国VS 通信局</h1><p>領主たちの交流・端末同期・接続一覧を支える通信サービスです。</p><footer>© KASAI SOLUTIONS</footer></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
      }
      if(!path.startsWith(API+'/')) fail(404,'NOT_FOUND','その通信機能は見つかりませんでした。');
      origin=allowedOrigin(request,env);
      if(request.method==='OPTIONS') {
        const headers=new Headers({'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
        if(origin!==null) headers.set('Access-Control-Allow-Origin',origin);
        return new Response(null,{status:204,headers});
      }
      if(path.startsWith(API+'/avatars/')&&request.method==='GET')return await getAvatar(request,env,origin);
      const now=Date.now(),payload=await route(request,env,now),evaluated=await resolvePlayerEvaluations(env.DB,payload,now),resolved=await resolvePremiumAppearances(env.DB,evaluated,now),authenticated=authenticatedRequests.get(request);
      if(authenticated)await requireAccountAccess(env.DB,authenticated);
      return response(publicIdentities(resolved,request),200,origin);
    }catch(error){
      const authenticated=authenticatedRequests.get(request);if(authenticated)try{await requireAccountAccess(env.DB,authenticated);}catch(accessError){error=accessError;}
      if(error instanceof ApiError){const e={code:error.code,message:error.message};if(error.retryAfter)e.retryAfter=error.retryAfter;return response({ok:false,error:e},error.status,origin,error.retryAfter);}
      return response({ok:false,error:{code:'INTERNAL_ERROR',message:'通信処理に失敗しました。少し時間をおいて再度お試しください。'}},500,origin);
    }
  }
};
