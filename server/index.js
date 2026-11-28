import {withCourtEstateGuard} from './court-estate-guard.js';
import {maintenanceContext,protectMaintenance,externalTroopSnapshotStatements,MAINTENANCE_REFRESH_MESSAGE} from './maintenance.js';
import {GameEngine, GAME_OFFICERS} from './game-runtime.js';
import {regionNames,inheritedStateCastles,anyInheritedRegionSql,inheritedCastleSql,inheritedCastleCountSql,reconcileRegionInheritance,releasedCastleIds,reconcileReleasedCastles} from './region-inheritance.js';
import {protectedRegionNames,protectedStateCastles,isRegionProtectedCastle,recordRegionConquests,reconcileRegionProtection} from './region-inheritance.js';
import {castleDurability,branchDurability,durabilityRecord,normalizeRepairProgress,reconcilePaidRepairs} from './durability.js';
import {handleLetters} from './letters.js';
import {handleTrades} from './trade.js';
import {handleModeration} from './moderation.js';
import {playerNameKey,releasedPlayerNameKey,playerNameReleased,playerNameConflict,releaseInactivePlayerNameStatement,requireAvailablePlayerName,PLAYER_NAME_TAKEN} from './player-names.js';
import {handleDeputyOperator} from './deputy-operator.js';
import {canOperate,operationGuard} from './operator-access.js';
import {expulsionSnapshot,EXPULSION_MESSAGE} from './expulsion-state.js';
import {handlePremium,handlePremiumWebhook,resolvePremiumAppearances} from './premium.js';
import {handleRewards,protectRewardSync,rewardArchiveStatements} from './rewards.js';
import {applyFieldVictoryLoot,FIELD_LOOT_POLICY} from './field-loot.js';
import {recordPlayerActivity} from './premium-metrics.js';
import {handleEvents} from './events.js';
import {handleRoaming,reconcileRoamingProgress,settleRoamingMarch} from './roaming.js';
import {marchDto,findMarch,activeMarch,battleMarches,serverMarchMarker,restoreServerMarch,marchRecord,insertMarch,finishMarchStatement,cancelBattleMarch,replayMarch,advanceReservedMarch,MARCH_GATE} from './marches.js';
import {handleRoamingDeployment} from './roaming-deployment.js';
import {handleCovert,reconcileCovertProgress,covertIncidentStatements,settleCovertDispatches,covertMarches} from './covert.js';
import {handleCourt} from './court.js';
import {courtMembershipStatus,courtMembershipDetails,joinCourtMembership} from './court-membership.js';
import {handleCourtNobles,reconcileCourtNobles} from './court-nobles.js';
import {readCloisteredReward,applyCloisteredReward} from './cloistered-reward.js';
import {publicCourtLineage,courtLineageStatus,handleCourtLineage} from './court-lineage.js';
import {courtRelationsSql,publicCourtRelations,handleCourtNegotiations} from './court-negotiations.js';
import {releaseFieldCastle,releasePersonalCastle} from './field-release.js';
import {handleCourtSuccession} from './succession.js';
import {handleCourtRetirement} from './retirement.js';
import {assertSentoUpgradeTransition} from './sento-upgrades.js';
import {handleRegency,courtRegentAuthority} from './regency.js';
import {handleCourtEvents} from './court-events.js';
import {handleCourtEstate,courtEstateAuthority,assertCourtEstateAccess,courtEstatePricingGame} from './court-estate.js';
import {readCourtEstateContext,courtEstateSnapshotStatements,COURT_ESTATE_REFRESH_MESSAGE} from './court-estate-ledger.js';
import {handleVoice} from './voice.js';
import {handleProgress,reconcileProgress} from './progress.js';
import {handleNotifications,dispatchNotifications,dispatchMessageNotifications,notificationSaveStatements,notificationAnnouncementStatements,recordNotificationChatRead,recordNotificationChatDelivery,notificationChatSummaryStatement,notificationChatSummary} from './notifications.js';
import {socialNotificationStatement,socialNotificationSummaryStatement,socialNotificationSummary} from './social-notifications.js';
import {handleConquest,settleConquestMarches,conquestMarches} from './conquest.js';
import {handleShogunate,campaignShogunateStatements,settleShogunateApprovals,readPalaceControl} from './shogunate.js';
import {applyPalaceControl} from './shogunate-independence.js';
import {resolvePublicCourtOffices} from './public-court.js';
import {courtProtectionSql,retainCourtHoldings} from './court-protection.js';
import {resolvePublicCityHonors} from './city-honors.js';
import {messageRegister} from './message-addressing.js';
import {handleAlliance,assertGuildJoinAllowed,treasuryGuard,treasuryContributionStatements,prepareRallyAttack,getAllianceDefense,rallyMarchStatements,rallyMarchCancellation,settleAllianceUnits} from './alliance.js';
import {handleProtection,enrollProtection,prepareProtection,protectionBattleStatements,decorateProtectedTargets,protectionStatus} from './protection.js';
import {handleVacantGarrisons} from './vacant-garrisons.js';
import {handleBranches,projectBranchState,applyBranchProgress,reconcileBranchProgress,branchProgressStatements,branchStateGuard,troopTransferGuard} from './branches.js';
import {relocateResidence} from './relocation.js';
import {requirePromotionOrigin,recordPromotion,readPromotionReport} from './promotion.js';
import {readMusicBroadcast,handleAdminMusic} from './admin-music.js';
import {lordSupportSql,guardLordSupport,ensureResidency,residencySnapshot,residencyDirectory,residencyStart,initialResidencyStatements,residencyTargetGuard,prepareResidencySuccession,prepareResidencyCpuLosses} from './residency.js';
const API = '/api/v1';
const API_VERSION = '5.27.0';
const API_FEATURES = Object.freeze({trades:true,moderation:true,playerExpulsion:true,moderatedNameReuse:true,deputyOperator:true,deputyOperations:true,privateOperationsLabels:true,deputyOfficer:true,kagoshimaProtected:true,premium:true,timedEvents:true,troopTrades:true,roamingBattles:true,roamingDeployment:true,covertDispatch:true,privatePlayerRoles:true,guildIcons:true,court:true,kyotoGosho:true,branches:true,branchBattles:true,branchFacilities:true,audioCalls:true,progression:true,armyPresets:true,allianceStrategy:true,sharedConquest:true,newcomerProtection:true,webPush:true,messagePush:true,pushDeviceTest:true,battleAdviser:true,battleCatalog:true,eventBattleRewards:true,shogunate:true,shogunateGovernance:true,attackTravel:true,castleResidency:true,retainerCastleStats:true,residencyRelocation:true,maintenanceUpkeep:true,strongholdDurability:true,chatReplies:true,chatMentions:true,covertReturnTravel:true,allianceUnitTravel:true,legacySaveRecovery:true,displayNameVariants:true,courtOffices:true,serverSummons:true,loginRewards:true,paidRerolls:true,supporterChoices:true,premiumGrowthMetrics:true,adminMusicBroadcast:true,rankRiceProduction:true,shogunateApproval:true,imperialSuccession:true,retiredEmperor:true,regency:true,courtEventRoom:true,imperialSuccessionApproval:true,courtEstate:true,fieldTerritories:true,fieldOwnerProjection:true,courtEstateField:true,courtMembership:true,fieldTerritoryAttacks:true,unifiedTerritoryOwners:true,regionalInheritance:true,regionalProtection:true,communityNotifications:true,manualChatRead:true,courtLineage:true,imperialHouse:true,fieldRelease:true,courtNegotiations:true,courtNobles:true,imperialSuccessionEligibility:true,cloisteredEmperor:true,imperialRetirementSlots:true,retiredShogunateIndependence:true,sentoGosho:true,sentoFacilityUpgrades:true,imperialPalaceEnhancements:true,cloisteredReward:true});
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
const MAJOR_CITIES=['edo','kyoto_gosho','nijo','osaka','nagoya','kagoshima','sento_gosho'];
const FIELD_CAPTURE_CASTLES=['nijo','osaka','nagoya'];
const castleLevelLimit=id=>['kyoto_gosho','sento_gosho'].includes(id)?128:id==='edo'?64:FIELD_CAPTURE_CASTLES.includes(id)?48:32;
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
// This gate only coalesces optional maintenance inside one Worker isolate.
// The database tick and each settler's commit guards remain authoritative.
const backgroundPolls = new WeakMap();
const courtResponseGuards = new WeakMap();
const courtEstateProjectionGuards = new WeakMap();
const chatResponseGuards = new WeakMap();
const eventDefenseResponseGuards = new WeakMap();
const operationsResponseGuards = new WeakMap();
const operationsRoute=path=>/^\/admin\/(?:music|announcement|mail|moderation(?:\/.*)?|events(?:\/.*)?|premium(?:\/.*)?|promotion|roaming(?:\/.*)?)$/.test(path);
function protectOperations(request,user){requireOperator(user);operationsResponseGuards.set(request,operationGuard(user));}
async function verifyOperationsResponse(db,request){const guard=operationsResponseGuards.get(request);if(guard&&!await stmt(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())fail(403,'OPERATIONAL_REQUIRED','管理機能の利用資格が変更されました。接続状態を確認してください。');}

// Log only fixed diagnostic categories and source locations. Request bodies,
// credentials, SQL text, arbitrary error messages and player data stay private.
const DIAGNOSTIC_ROUTES=new Set(['/admin/recover','/admin/announcement','/admin/mail','/chat','/achievements','/sync','/presence','/health','/config','/world-clock','/music','/session','/devices/link','/me']);
const DIAGNOSTIC_SCHEMA=new Set(['users','user_sessions','rate_limits','player_saves','player_bans','player_expulsions','staff_members','staff_base','staff_campaign_backups','deputy_operator_state','achievement_events','world_clock','court_leader','court_contributions','court_external_offices','court_retired_emperors','court_regent','premium_appearances','user_avatars','guild_icons','term_id','appointed_at','cycle_index','cycle_home','revoked_at','pending','state_json','save_json']);
function reportInternalFailure(error,request,stage){
  try{
    const messages=[error?.message,error?.cause?.message].filter(value=>typeof value==='string').join('\n');
    let category='internal';
    if(/no such (?:table|column)|has no column named/i.test(messages))category='database_schema';
    else if(/too many|too large|too big|statement.*too long|expression tree|parser stack|SQLITE_TOOBIG|SQLITE_RANGE|SQLITE_FULL|exceeded.*limit/i.test(messages))category='database_limit';
    else if(/malformed JSON|JSON (?:path|text)|bad JSON/i.test(messages))category='database_json';
    else if(/constraint failed|SQLITE_CONSTRAINT/i.test(messages))category='database_constraint';
    else if(/D1_TYPE_ERROR|bind|SQLITE_MISMATCH/i.test(messages))category='database_binding';
    else if(/D1_ERROR|D1_EXEC_ERROR|SQLITE_|database/i.test(messages))category='database';
    else if(error?.name==='TypeError')category='runtime_type';
    else if(error?.name==='ReferenceError')category='runtime_reference';
    else if(['OperationError','DataError','NotSupportedError'].includes(error?.name))category='runtime_crypto';
    const path=new URL(request.url).pathname.slice(API.length),record={event:'sengoku_internal_failure',version:API_VERSION,route:DIAGNOSTIC_ROUTES.has(path)?path:'/other',stage,category};
    const missing=/(?:no such (?:table|column):|has no column named)\s*([A-Za-z_][A-Za-z0-9_.]*)/i.exec(messages)?.[1]?.split('.').at(-1);
    if(DIAGNOSTIC_SCHEMA.has(missing))record.schema=missing;
    const stack=typeof error?.stack==='string'?error.stack:'',frames=[];
    for(const line of stack.split('\n').filter(line=>/^\s+at\s/.test(line))){
      const match=/(?:\b|\/)(index|worker)\.js:(\d{1,7}):(\d{1,7})\)?$/.exec(line);
      if(match)frames.push({source:match[1]+'.js',line:Number(match[2]),column:Number(match[3])});
      if(frames.length===3)break;
    }
    if(frames.length)record.frames=frames;
    console.error(JSON.stringify(record));
  }catch{/* Diagnostics must never replace the original error response. */}
}

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
const nameKey = playerNameKey;

function textField(value, name, max, { optional = false, min = 1, preserveUnicode = false } = {}) {
  if (optional && (value === undefined || value === null || value === '')) return '';
  if (typeof value !== 'string') fail(400, 'INVALID_INPUT', `${name}を入力してください。`);
  const text = (preserveUnicode ? value : value.normalize('NFC')).trim();
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
const publicBattle=battle=>({...battle,...(battle.rally?{rally:{participants:battle.rally.participants,pooledTroops:battle.rally.pooledTroops,returnedTroops:battle.rally.returnedTroops,garrison:battle.rally.garrison}}:{}),attackerEvaluation:evaluationRef(battle.attackerPlayerId),defenderEvaluation:evaluationRef(battle.defenderPlayerId)});
const publicLedger=receipt=>({...receipt,playerEvaluation:evaluationRef(receipt.playerId)});
function publicStaffBase(base){
  if(!base)return null;
  return {...base,jobs:base.jobs.map(job=>({...job,...(job.startedBy?{startedBy:{...job.startedBy,evaluation:evaluationRef(job.startedBy.id)}}:{})}))};
}
function authorizedCycleHome(user,state,preferred=null){
  if(user.is_admin)return 'edo';
  if(user.is_sento)return 'sento_gosho';
  if(user.is_staff)return 'kyoto_gosho';
  if(user.is_deputy)return 'kagoshima';
  const home=preferred||state.cycle?.home||state.home;
  return !CASTLE_BY_ID[home]||['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(home)?state.home:home;
}
function evaluationState(row,meta,now){
  if(!row.save_json)return null;
  const clock=meta.clock_json?mapWorldClock(JSON.parse(meta.clock_json),now):null,staff=!!row.is_staff&&!row.is_admin&&!row.is_sento;
  let raw=JSON.parse(row.save_json),restored=false;
  if(row.backup_active&&(!staff||row.backup_term!==row.staff_term)){
    raw=restorePersonalCampaign(normalizeGameSave(raw,{...row,is_admin:false,is_staff:true,is_sento:false},now,{reading:true,clock}),{save_json:row.backup_json},row);
    restored=true;
  }
  const state=normalizeGameSave(raw,row,now,{reading:true,clock}).state;
  if(staff){
    const shared=meta.shared_json?JSON.parse(meta.shared_json):staffInitialState(clock?.elapsedMs||0);
    for(const job of shared.jobs.filter(job=>job.completesElapsedMs<=(clock?.elapsedMs||0)).sort((a,b)=>a.completesElapsedMs-b.completesElapsedMs)){
      if(job.kind==='castle')shared.castleLevel=job.targetLevel;else shared.buildings[job.id]=job.targetLevel;
    }
    state.buildings=copy(shared.buildings);state.castles.kyoto_gosho.level=shared.castleLevel;state.castles.kyoto_gosho.wall=shared.buildings.wall;
  }
  const savedCycle=row.cycle_index??Math.max(Number(meta.cycle_start||0),Math.floor((state.worldClock?.elapsedMs??state.turn*WORLD_MONTH_MS)/WORLD_CYCLE_MS));
  if(clock&&Number(savedCycle)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)){
    // Match the public field's pending-cycle view without advancing months,
    // granting rewards, changing leases or settling anyone's persisted save.
    const home=authorizedCycleHome(row,state,restored?state.cycle?.home:row.cycle_home);
    const retained=inheritedStateCastles(state);
    for(const [id,castle]of Object.entries(state.castles))if(id!==home&&!retained.has(id)&&castle.owner===state.clan)castle.owner='在地衆';
    state.castles[home].owner=state.clan;state.home=home;
  }
  return state;
}
// Rank is the strongest owned variant of the officer in the active formation's
// first slot, just as GameEngine.officer(id) resolves the army screen.
const officerNames=new Map(GAME_OFFICERS.map(officer=>[officer.id,officer.name]));
function publicCommander(state,user={}){
  const officerId=state?.army?.[0];
  if(!officerId)return null;
  const rank=RANKS.findLast(value=>state.officerVariants.includes(officerId+':'+value)),name=officerNames.get(officerId);
  const special=globalThis.SENGOKU_DATA.deputyAssets,deputyExclusive=!!user.is_deputy&&!user.is_admin&&!user.is_staff&&officerId===special?.officerId&&rank===special?.rank;
  return rank&&name?{officerId,name,rank,...(deputyExclusive?{deputyExclusive:true}:{})}:null;
}
async function resolvePlayerEvaluations(db,payload,now){
  const refs=[],ids=new Set(),nameRefs=[],avatarRefs=[],avatarIds=new Set(),skip=new Set(['save','state','entitlements','appearance','courtEstateProjection']);
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
  const commanderIds=new Set(refs.filter(ref=>ref.key==='evaluation'&&Object.hasOwn(ref.parent,'commander')).map(ref=>ref.id));
  const selected=[...ids],queries=[stmt(db,`SELECT
    (SELECT json_object('base_elapsed_ms',base_elapsed_ms,'anchor_real_ms',anchor_real_ms,'running',running,'speed',speed,'revision',revision) FROM world_clock WHERE id=?) AS clock_json,
    (SELECT state_json FROM staff_base WHERE id='kyoto_gosho') AS shared_json,
    (SELECT value FROM settings WHERE key='cyclePolicyStart') AS cycle_start`,WORLD_CLOCK_ID)];
  for(let offset=0;offset<selected.length;offset+=80){
    const page=selected.slice(offset,offset+80);
    queries.push(stmt(db,`/* player-evaluation */ SELECT u.id,u.name,u.clan,ps.save_json,ps.cycle_index,ps.cycle_home,
      (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id AND NOT EXISTS(SELECT 1 FROM player_bans ban WHERE ban.user_id=u.id AND ban.active=1)) AS avatar_version,
      CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
      CASE WHEN sm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_staff,COALESCE(sm.term_id,'legacy:'||sm.appointed_at) AS staff_term,
      EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
      (SELECT ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS deputy_term,
      b.active AS backup_active,b.term_id AS backup_term,b.save_json AS backup_json,
      (SELECT json_object('castleId',cr.castle_id,'lordPlayerId',cs.lord_user_id) FROM castle_residents cr JOIN castle_seats cs ON cs.castle_id=cr.castle_id WHERE cr.user_id=u.id) AS household_json
      FROM users u LEFT JOIN player_saves ps ON ps.user_id=u.id LEFT JOIN staff_members sm ON sm.user_id=u.id
      LEFT JOIN staff_campaign_backups b ON b.user_id=u.id WHERE u.id IN (${page.map(()=>'?').join(',')})`,...page));
  }
  const otherNames=[...new Set([...nameRefs.map(ref=>ref.id),...avatarIds])].filter(id=>!ids.has(id));
  for(let offset=0;offset<otherNames.length;offset+=80){const page=otherNames.slice(offset,offset+80);queries.push(stmt(db,`SELECT u.id,u.name,
    (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id AND NOT EXISTS(SELECT 1 FROM player_bans ban WHERE ban.user_id=u.id AND ban.active=1)) AS avatar_version
    FROM users u WHERE u.id IN (${page.map(()=>'?').join(',')})`,...page));}
  const results=await db.batch(queries),meta=rows(results[0])[0]||{},values=new Map(),commanders=new Map(),homes=new Map(),names=new Map(),avatars=new Map(),empty=GameEngine.publicEvaluation(null,{officers:GAME_OFFICERS});
  for(const result of results.slice(1))for(const row of rows(result)){
    names.set(row.id,row.name);avatars.set(row.id,row.avatar_version||null);
    if(!ids.has(row.id))continue;
    if(!row.save_json){values.set(row.id,empty);continue;}
    let evaluation=null;
    try{
      const state=evaluationState(row,meta,now);
      evaluation=GameEngine.publicEvaluation(state,{officers:GAME_OFFICERS});
      if(commanderIds.has(row.id))commanders.set(row.id,publicCommander(state,row));
      if(CASTLE_BY_ID[state.home]){
        const household=row.household_json?JSON.parse(row.household_json):null;
        const ownerId=!row.is_admin&&!row.is_staff&&!row.is_deputy&&household?.castleId===state.home?household.lordPlayerId:row.id;
        homes.set(row.id,{homeCastleId:state.home,homeCastleName:CASTLE_BY_ID[state.home].name,homeCastleOwnerId:ownerId||null});
      }
    }catch{/* Unreadable saves remain unverified. */}
    values.set(row.id,evaluation);
  }
  for(const ref of refs){
    ref.parent[ref.key]=values.has(ref.id)?values.get(ref.id):null;
    if(ref.key==='evaluation'&&Object.hasOwn(ref.parent,'commander'))ref.parent.commander=commanders.get(ref.id)||null;
    if(ref.key==='evaluation'&&Object.hasOwn(ref.parent,'homeCastleOwnerId'))Object.assign(ref.parent,homes.get(ref.id)||{homeCastleId:null,homeCastleName:null,homeCastleOwnerId:null});
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

function resolveMessageRegister(db,user,audience,now){
  return messageRegister(db,user,audience,now,async ids=>{
    const people=evaluationUpdates(ids);
    await resolvePlayerEvaluations(db,people,now);
    return new Map(people.map(p=>[p.playerId,p.evaluation?.rankIndex]));
  },fail);
}

async function courtAccess(db,user,now){
  await requireAccountAccess(db,user);
  const clock=await getWorldClock(db,now),shared=await sharedStaffBaseRow(db,clock,now);
  const result=await db.batch([
    stmt(db,`SELECT (SELECT json_object('base_elapsed_ms',base_elapsed_ms,'anchor_real_ms',anchor_real_ms,'running',running,'speed',speed,'revision',revision) FROM world_clock WHERE id=?) AS clock_json,(SELECT value FROM settings WHERE key='cyclePolicyStart') AS cycle_start`,WORLD_CLOCK_ID),
    stmt(db,`SELECT u.id,u.name,u.clan,ps.save_json,ps.revision AS save_revision,ps.updated_at AS save_updated_at,ps.cycle_index,ps.cycle_home,
      CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
      (SELECT updated_at FROM settings WHERE key='adminUserId') AS admin_appointed_at,
      CASE WHEN sm.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_staff,COALESCE(sm.term_id,'legacy:'||sm.appointed_at) AS staff_term,sm.appointed_at AS staff_appointed_at,
      EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
      (SELECT ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS deputy_term,
      b.active AS backup_active,b.term_id AS backup_term,b.save_json AS backup_json,b.transition_token AS backup_token
      FROM users u LEFT JOIN player_saves ps ON ps.user_id=u.id LEFT JOIN staff_members sm ON sm.user_id=u.id LEFT JOIN staff_campaign_backups b ON b.user_id=u.id WHERE u.id=?`,user.id),
  ]);
  const row=rows(result[1])[0];
  if(!row||!!row.is_admin!==!!user.is_admin||(row.staff_term||'')!==(user.staff_term||'')||(row.deputy_term||'')!==(user.deputy_term||''))fail(403,'COURT_ACCESS_CHANGED','朝廷への入場資格が変わりました。最新の状態を確認してください。');
  const meta={...rows(result[0])[0],shared_json:shared.state_json};let evaluation=null;
  try{evaluation=GameEngine.publicEvaluation(evaluationState(row,meta,now),{officers:GAME_OFFICERS});}catch{}
  const emperor=await courtEmperorAuthority(db,user),regent=await courtRegentAuthority(db,user,roleCommitGuard);
  const privileged=!!row.is_admin||!!row.is_staff||!!user.court_retained_term||regent.isCourtRegent,eligible=privileged||Number(evaluation?.score)>=35000,guard=roleCommitGuard(user);
  guard.sql+=` AND COALESCE((SELECT appointment_token FROM court_regent WHERE id=1 AND user_id=?),'')=? AND COALESCE((SELECT term_id FROM court_retained_memberships WHERE user_id=?),'')=?`;guard.args.push(user.id,regent.token||'',user.id,user.court_retained_term||'');
  if(!privileged){guard.sql+=` AND COALESCE((SELECT revision FROM player_saves WHERE user_id=?),-1)=? AND COALESCE((SELECT transition_token FROM staff_campaign_backups WHERE user_id=?),'')=? AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)`;guard.args.push(user.id,row.save_revision??-1,user.id,row.backup_token||'',WORLD_CLOCK_ID,clock.revision);}
  const eligibilityProof=row.is_admin?row.admin_appointed_at:row.is_staff?row.staff_appointed_at:user.court_retained_term?user.court_retained_joined_at:regent.isCourtRegent?regent.appointedAt:row.save_updated_at,notificationSince=Number.isSafeInteger(eligibilityProof)&&eligibilityProof>=0?eligibilityProof:now;
  return{user,eligible,privileged,evaluation,guard,clock,emperor,regent,notificationSince,shared:JSON.parse(shared.state_json),accessStamp:await hash(JSON.stringify([user.id,user.moderation_epoch||0,user.expulsion_epoch||0,!!row.is_admin,row.staff_term||'',row.deputy_term||'',user.court_retained_term||'',eligible,emperor.token,regent.token]))};
}
async function notificationCourtAccess(db,userId,now){const user=await getUser(db,userId);return user&&!user.ban_active?courtAccess(db,user,now):null;}
async function verifyCourtResponse(db,request){const guard=courtResponseGuards.get(request);if(!guard)return;if(!await stmt(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())fail(409,guard.code||'COURT_ACCESS_CHANGED',guard.message||'朝廷の利用資格または会話の状態が変わりました。最新の内容を確認してください。');}
async function verifyCourtEstateResponse(db,payload){const projection=payload?.courtEstateProjection,guard=projection&&courtEstateProjectionGuards.get(projection);if(guard&&!await stmt(db,'SELECT 1 AS allowed WHERE '+guard.sql,...guard.args).first())fail(409,'COURT_ESTATE_REFRESH_REQUIRED',COURT_ESTATE_REFRESH_MESSAGE);}

function mapUser(row, now = Date.now()) {
  return {
    id: row.id, name: row.name, nameReleased: playerNameReleased(row), clan: publicClan(row.clan,row.is_admin,row.is_staff&&!row.is_sento,row.personal_clan), isAdmin: !!row.is_admin, isStaff: !!row.is_staff && !row.is_admin && !row.is_sento, isDeputy: !!row.is_deputy && !row.is_admin && !row.is_staff && !row.is_sento, isSento:!!row.is_sento, canOperate:canOperate(row),
    courtLineage:publicCourtLineage(row),courtRelations:publicCourtRelations(row),courtMember:courtMembershipStatus(row,null).isMember,
    avatarVersion: row.avatar_version || null,evaluation:evaluationRef(row.id),
    guildId: row.guild_id || null, guildName: row.guild_name || null,guildIconVersion: row.guild_id ? row.guild_icon_version || null : null,
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
  const management=!!(actor&&(canOperate(actor)&&path.startsWith('/admin/')||(canOperate(actor)||actor.is_staff)&&path.startsWith('/staff/')));
  const linked=['/session','/devices/link','/admin/recover'].includes(path)&&typeof payload?.token==='string';
  const self=payload?.user&&(payload.user.id===actor?.id||linked)?payload.user:null;
  const privateKeys=new Set(['save','state','entitlements','staffBase','courtEstateProjection']);
  const roleKeys=new Set(['canOperate','isAdmin','isStaff','isDeputy','is_deputy','isOperator','is_admin','is_staff','is_operator','staffTitle','siteRole','roleTitle','operatorProtected','staffProtected','adminPlayerId','adminUserId','operatorPlayerId','operatorUserId']);
  function visit(value){
    if(!value||typeof value!=='object')return value;
    if(Array.isArray(value))return value.map(visit);
    const visibleRoles=management||value===self,result={};
    for(const [key,child]of Object.entries(value)){
      if(!visibleRoles&&(roleKeys.has(key)||key==='role'&&['admin','staff','deputy','operator'].includes(child)))continue;
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
function applyLordSupport(state,user) {
  if (!user.is_admin && !user.is_sento && !user.is_staff && !user.is_deputy && !user.ban_active && user.retainer_support_json) {
    const support=JSON.parse(user.retainer_support_json);
    if (support.count>0) state.retainerSupport=support;
  }
}
const USER_SELECT = `SELECT u.id,u.name,u.name_key,u.clan,u.created_at,u.last_seen,${courtProtectionSql('u.id')} AS is_court_protected,${lordSupportSql('u.id')} AS retainer_support_json,gm.guild_id,g.name AS guild_name,g.owner_id,
  ${courtRelationsSql('u.id')} AS court_relations_json,
  (SELECT house_id FROM court_lineages cl WHERE cl.user_id=u.id) AS court_house_id,
  (SELECT original_clan FROM court_lineages cl WHERE cl.user_id=u.id) AS court_original_clan,
  (SELECT imperial_house_name FROM court_lineages cl WHERE cl.user_id=u.id) AS imperial_house_name,
  EXISTS(SELECT 1 FROM court_succession_requests cr WHERE cr.actor_id=u.id) AS imperial_heritage,
  (SELECT term_id FROM court_retained_memberships cm WHERE cm.user_id=u.id) AS court_retained_term,
  (SELECT base_id FROM court_retained_memberships cm WHERE cm.user_id=u.id) AS court_retained_base,
  (SELECT joined_at FROM court_retained_memberships cm WHERE cm.user_id=u.id) AS court_retained_joined_at,
  (SELECT gi.version FROM guild_icons gi WHERE gi.guild_id=gm.guild_id) AS guild_icon_version,
  COALESCE((SELECT active FROM player_bans pb WHERE pb.user_id=u.id),0) AS ban_active,
  COALESCE((SELECT revision FROM player_bans pb WHERE pb.user_id=u.id),0) AS moderation_epoch,
  COALESCE((SELECT revision FROM player_expulsions pe WHERE pe.user_id=u.id),0) AS expulsion_epoch,
  COALESCE((SELECT pending FROM player_expulsions pe WHERE pe.user_id=u.id),0) AS expulsion_pending,
  (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id) AS avatar_version,
  EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=u.id AND go.guild_id=gm.guild_id) AS is_guild_officer,
  (SELECT MAX(p.last_seen) FROM player_presence p WHERE p.user_id=u.id AND p.online=1) AS presence_seen,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
  (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan,
  (SELECT json_extract(b.save_json,'$.state.home') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_home,
  (SELECT json_extract(b.save_json,'$.state.castles.'||json_extract(b.save_json,'$.state.home')) FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_castle_json,
  (SELECT json_extract(sb.state_json,'$.castleLevel') FROM staff_base sb WHERE sb.id='kyoto_gosho') AS staff_castle_level,
  (SELECT json_extract(sb.state_json,'$.buildings.wall') FROM staff_base sb WHERE sb.id='kyoto_gosho') AS staff_wall,
  (SELECT json_extract(sb.state_json,'$.durability') FROM staff_base sb WHERE sb.id='kyoto_gosho') AS staff_durability_json,
  EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
  (SELECT ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS deputy_term,
  (SELECT COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=u.id) AS staff_term,
  (SELECT sm.appointed_elapsed_ms FROM staff_members sm WHERE sm.user_id=u.id) AS staff_since_ms
  FROM users u LEFT JOIN guild_members gm ON gm.user_id=u.id LEFT JOIN guilds g ON g.id=gm.guild_id`;
async function getUser(db, id) { return stmt(db, USER_SELECT + ' WHERE u.id=?', id).first(); }
const publicPlayerId=/^u_[A-Za-z0-9_]{1,96}$/;
const availablePlayer="NOT EXISTS(SELECT 1 FROM player_bans banned WHERE banned.user_id=u.id AND banned.active=1)";
async function readPlayerProfile(request,env,id,now){
  const db=env.DB,viewer=request.headers.has('authorization')?await authenticate(request,db,now):null;
  if(!publicPlayerId.test(id))fail(404,'PLAYER_NOT_FOUND','領主のプロフィールが見つかりません。');
  if(!viewer)await budget(db,await ipScope(request,env,'public-profile')||'public-profile-unattributed',60,60000,now);
  const row=await stmt(db,USER_SELECT+' WHERE u.id=? AND '+availablePlayer,id).first();
  if(!row)fail(404,'PLAYER_NOT_FOUND','領主のプロフィールが見つかりません。');
  const {name,clan,guildId,guildName,guildRole,avatarVersion,evaluation,courtLineage,courtRelations}=mapUser(row,now);
  return {ok:true,player:{id,name,clan,guildId,guildName,guildRole,avatarVersion,evaluation,courtLineage,courtRelations,commander:null,homeCastleId:null,homeCastleName:null,homeCastleOwnerId:null,homeCastleAppearance:null}};
}
async function searchPlayers(request,env,url,now){
  const db=env.DB,viewer=request.headers.has('authorization')?await authenticate(request,db,now):null;
  const q=textField(url.searchParams.get('q'),'検索語',98,{min:2}),longId=Array.from(q).length>24;
  if(longId&&!publicPlayerId.test(q))fail(400,'INVALID_INPUT','検索には2～24文字の名前か領主IDを入力してください。');
  if(!viewer)await budget(db,await ipScope(request,env,'public-player-search')||'public-player-search-unattributed',20,60000,now);
  const clause=longId?'u.id=?':"(u.name LIKE ? ESCAPE '\\' OR u.id=?)";
  const searchArgs=longId?[q]:['%'+q.replaceAll('\\','\\\\').replaceAll('%','\\%').replaceAll('_','\\_')+'%',q];
  const where=' WHERE '+clause+' AND u.id<>? AND '+availablePlayer+' ORDER BY u.last_seen DESC,u.name LIMIT 30';
  if(viewer){
    const result=await stmt(db,USER_SELECT+where,...searchArgs,viewer.id).all();
    return {ok:true,players:rows(result).map(row=>mapUser(row,now))};
  }
  // Directory hits need names and IDs. Opening one profile loads only that save.
  const result=await stmt(db,`SELECT u.id,u.name,
    CASE WHEN u.clan=? OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id)
      OR u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN ? ELSE u.clan END AS clan
    FROM users u`+where,ADMIN_CLAN,ORDINARY_TOKUGAWA_CLAN,...searchArgs,'').all();
  return {ok:true,players:rows(result).map(({id,name,clan})=>({id,name,clan}))};
}
// Recheck visibility after the asynchronous identity and appearance reads.
async function finishPublicProfiles(db,payload,individual){
  const candidates=individual?[payload.player]:payload.players;
  if(!candidates.length)return;
  const ids=candidates.map(player=>player.id),allowed=rows(await stmt(db,`SELECT u.id FROM users u WHERE u.id IN (${ids.map(()=>'?').join(',')}) AND ${availablePlayer}`,...ids).all());
  const visible=new Set(allowed.map(row=>row.id));
  if(individual&&!visible.has(ids[0]))fail(404,'PLAYER_NOT_FOUND','領主のプロフィールが見つかりません。');
  if(!individual)payload.players=payload.players.filter(player=>visible.has(player.id));
}
function accountCommitGuard(user){return {sql:"NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=? AND active=1) AND COALESCE((SELECT revision FROM player_bans WHERE user_id=?),0)=? AND COALESCE((SELECT revision FROM player_expulsions WHERE user_id=?),0)=?",args:[user.id,user.id,Number(user.moderation_epoch||0),user.id,Number(user.expulsion_epoch||0)]};}
async function requireAccountAccess(db,user){const row=await stmt(db,'SELECT b.active,b.revision,COALESCE(e.revision,0) AS expulsion_epoch FROM users u LEFT JOIN player_bans b ON b.user_id=u.id LEFT JOIN player_expulsions e ON e.user_id=u.id WHERE u.id=?',user.id).first();if(row?.active)fail(403,'ACCOUNT_BANNED','この領主のオンライン利用は停止されています。解除後に再接続できます。');if(Number(row?.revision||0)!==Number(user.moderation_epoch||0)||Number(row?.expulsion_epoch||0)!==Number(user.expulsion_epoch||0))fail(409,'ACCOUNT_ACCESS_CHANGED','この領主の利用状態が変更されました。最新の接続状態を確認してください。');}
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
function guildIconBucket(env) {
  if(!env.BUCKET?.put||!env.BUCKET?.get||!env.BUCKET?.delete)fail(503,'GUILD_ICON_STORAGE_UNAVAILABLE','同盟アイコンの保存サービスの準備中です。少し時間をおいて再度お試しください。');
  return env.BUCKET;
}
function guildIconInput(body,upload) {
  if(Object.keys(body).some(key=>!(upload?['guildId','image']:['guildId']).includes(key)))fail(400,'INVALID_GUILD_ICON','同盟アイコンの送信内容が正しくありません。');
  const guildId=idField(body.guildId,'同盟の識別子');
  if(!upload)return{guildId};
  try{return{guildId,bytes:decodeAvatarImage({image:body.image})};}
  catch(error){if(error instanceof ApiError&&['INVALID_AVATAR','AVATAR_TOO_LARGE'].includes(error.code))fail(error.status,error.code==='AVATAR_TOO_LARGE'?'GUILD_ICON_TOO_LARGE':'INVALID_GUILD_ICON',error.message.replaceAll('写真','同盟アイコン'));throw error;}
}
function guildIconCommitGuard(user,guildId) {
  const access=accountCommitGuard(user);
  return{sql:`EXISTS(SELECT 1 FROM guilds g JOIN guild_members gm ON gm.guild_id=g.id WHERE g.id=? AND g.owner_id=? AND gm.user_id=?) AND ${access.sql}`,args:[guildId,user.id,user.id,...access.args]};
}
async function requireGuildIconAccess(db,user,guildId) {
  await requireAccountAccess(db,user);
  const current=await getUser(db,user.id);
  if(!current)fail(403,'GUILD_REQUIRED','現在所属している同盟で操作してください。');
  requireGuild(current,guildId);requireGuildRole(current,'icon');
}
async function guildIconResult(db,guildId) {
  const current=await stmt(db,GUILD_SELECT+' WHERE g.id=?',guildId).first();
  if(!current)fail(409,'GUILD_CHANGED','同盟の状態が変わりました。一覧を更新してください。');
  return{ok:true,guild:mapGuild(current)};
}
async function putGuildIcon(request,env,user,now) {
  const db=env.DB,{guildId,bytes}=guildIconInput(await readBody(request,MAX_AVATAR_BODY),true);
  requireGuild(user,guildId);requireGuildRole(user,'icon');
  const bucket=guildIconBucket(env);
  await budget(db,'guild-icon-write:'+user.id,10,10*60*1000,now);
  const version=await hashBytes(bytes),key='guild-icons/'+guildId+'/'+crypto.randomUUID()+'.jpg';
  try{const uploaded=await bucket.put(key,bytes,{httpMetadata:{contentType:'image/jpeg',cacheControl:'no-store'}});if(!uploaded)throw Error('Guild icon upload incomplete');}
  catch{await removeAvatarObject(bucket,key);fail(503,'GUILD_ICON_STORAGE_UNAVAILABLE','同盟アイコンを保存できませんでした。少し時間をおいて再度お試しください。');}
  let result;
  try{
    // The image write yields to storage. Ownership, membership and moderation
    // must still authorize the exact requested guild when metadata commits.
    const access=guildIconCommitGuard(user,guildId);
    result=await db.batch([
      stmt(db,'SELECT object_key FROM guild_icons WHERE guild_id=?',guildId),
      stmt(db,`INSERT INTO guild_icons(guild_id,version,object_key,content_type,byte_length,updated_at)
        SELECT ?,?,?,'image/jpeg',?,? WHERE ${access.sql} ON CONFLICT(guild_id) DO UPDATE SET
        version=excluded.version,object_key=excluded.object_key,content_type=excluded.content_type,
        byte_length=excluded.byte_length,updated_at=excluded.updated_at RETURNING object_key`,guildId,version,key,bytes.length,now,...access.args),
    ]);
    if(!rows(result[1]).length){await requireGuildIconAccess(db,user,guildId);fail(409,'GUILD_CHANGED','同盟の役職または所属が変わりました。一覧を更新してください。');}
  }catch(error){
    // A lost D1 response may follow a successful commit. Delete this unique
    // candidate only when a fresh read proves it is no longer current.
    try{const current=await stmt(db,'SELECT object_key FROM guild_icons WHERE guild_id=?',guildId).first();if(current?.object_key!==key)await removeAvatarObject(bucket,key);}catch{}
    throw error;
  }
  await removeAvatarObject(bucket,rows(result[0])[0]?.object_key);
  return guildIconResult(db,guildId);
}
async function deleteGuildIcon(request,env,user,now) {
  const db=env.DB,{guildId}=guildIconInput(await readBody(request),false);
  requireGuild(user,guildId);requireGuildRole(user,'icon');
  const bucket=guildIconBucket(env);
  await budget(db,'guild-icon-write:'+user.id,10,10*60*1000,now);
  const access=guildIconCommitGuard(user,guildId),result=await db.batch([
    stmt(db,'SELECT 1 AS allowed WHERE '+access.sql,...access.args),
    stmt(db,'DELETE FROM guild_icons WHERE guild_id=? AND '+access.sql+' RETURNING object_key',guildId,...access.args),
  ]);
  if(!rows(result[0]).length){await requireGuildIconAccess(db,user,guildId);fail(409,'GUILD_CHANGED','同盟の役職または所属が変わりました。一覧を更新してください。');}
  await removeAvatarObject(bucket,rows(result[1])[0]?.object_key);
  return guildIconResult(db,guildId);
}
async function getGuildIcon(request,env,origin) {
  const url=new URL(request.url),id=url.pathname.slice((API+'/guild-icons/').length),version=url.searchParams.get('v');
  if(!/^[A-Za-z0-9_-]{1,90}$/.test(id)||version!==null&&!/^[0-9a-f]{64}$/.test(version))fail(400,'INVALID_GUILD_ICON','同盟アイコンの識別子が正しくありません。');
  const db=env.DB;if(!db?.prepare)fail(503,'SERVICE_UNAVAILABLE','通信サービスの準備中です。');
  const select='SELECT i.version,i.object_key,i.byte_length FROM guild_icons i JOIN guilds g ON g.id=i.guild_id WHERE i.guild_id=?';
  const current=await stmt(db,select,id).first();
  if(!current||version!==null&&version!==current.version)fail(404,'GUILD_ICON_NOT_FOUND','この同盟アイコンは現在使用されていません。');
  let object;try{object=await guildIconBucket(env).get(current.object_key);}catch(error){if(error instanceof ApiError)throw error;fail(503,'GUILD_ICON_STORAGE_UNAVAILABLE','同盟アイコンを読み込めませんでした。少し時間をおいて再度お試しください。');}
  if(!object?.body||Number(object.size)!==Number(current.byte_length))fail(404,'GUILD_ICON_NOT_FOUND','この同盟アイコンは現在使用されていません。');
  const latest=await stmt(db,select,id).first();
  if(latest?.object_key!==current.object_key||latest?.version!==current.version){await object.body.cancel();fail(404,'GUILD_ICON_NOT_FOUND','この同盟アイコンは現在使用されていません。');}
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
function requireOperator(user) { if (!canOperate(user)) fail(403,'OPERATIONAL_REQUIRED','この管理機能を利用する権限がありません。'); }
function requireAdmin(user) { if (!user.is_admin) fail(403, 'ADMIN_REQUIRED', 'この機能を利用する権限がありません。'); }
function requireStaffChat(user) { if(!canOperate(user)&&!user.is_staff)fail(403,'STAFF_CHAT_REQUIRED','この会話を利用する権限がありません。'); }
function requireStaff(user) { if(!canOperate(user)&&!user.is_staff)fail(403,'STAFF_REQUIRED','この一覧を表示する権限がありません。'); }
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
  const access=roleCommitGuard(user),params=[windowStart,asOf,...access.args,...(cursor?[cursor.lastSeen,cursor.lastSeen,cursor.id]:[]),limit+1];
  // Authorization and both projections share one D1 transaction. Every data
  // SELECT independently checks the live role, including revocation after auth.
  const result=await db.batch([
    stmt(db,'SELECT 1 AS allowed WHERE '+access.sql,...access.args),
    stmt(db,USER_SELECT+' WHERE u.last_seen>=? AND u.last_seen<=? AND '+access.sql+continuation+' ORDER BY u.last_seen DESC,u.id ASC LIMIT ?',...params),
    stmt(db,'SELECT COUNT(*) AS count FROM users WHERE last_seen>=? AND last_seen<=? AND '+access.sql,windowStart,asOf,...access.args),
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
    if (!user.guild_id || (target && target !== user.guild_id)) fail(403, 'GUILD_REQUIRED', '所属同盟のチャットだけを利用できます。');
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
  const replyToId=row.reply_to_id===null||row.reply_to_id===undefined?null:Number(row.reply_to_id);
  const preview=row.reply_id?Array.from(row.reply_body):[];
  const replyTo=replyToId===null?null:row.reply_id?{id:Number(row.reply_id),userId:row.reply_user_id,name:row.reply_name,text:preview.slice(0,120).join(''),createdAt:iso(row.reply_created_at),truncated:preview.length>120}:{id:replyToId,unavailable:true};
  return {id:Number(row.id),userId:row.user_id,name:row.name,avatarVersion:row.avatar_version||null,text:row.body,createdAt:iso(row.created_at),isSento:!!row.is_sento,isAdmin:!!row.is_admin,isDeputy:!!row.is_deputy,isStaff:!!row.is_staff&&!row.is_admin&&!row.is_sento,evaluation:evaluationRef(row.user_id),replyToId,replyTo,mentions:JSON.parse(row.mention_users_json||'[]')};
}
const MESSAGE_SELECT = `SELECT m.id,m.user_id,m.body,m.created_at,u.name,
 (SELECT a.version FROM user_avatars a WHERE a.user_id=m.user_id) AS avatar_version,
 CASE WHEN m.user_id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
 EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=m.user_id) AS is_staff,
 m.reply_to_id,rp.id AS reply_id,rp.user_id AS reply_user_id,pu.name AS reply_name,rp.body AS reply_body,rp.created_at AS reply_created_at,
 (SELECT json_group_array(json_object('userId',mu.id,'name',mu.name)) FROM json_each(m.mentions_json) mi JOIN users mu ON mu.id=mi.value WHERE NOT EXISTS(SELECT 1 FROM player_bans mb WHERE mb.user_id=mu.id AND mb.active=1)) AS mention_users_json
 FROM messages m JOIN users u ON u.id=m.user_id
 LEFT JOIN messages rp ON rp.id=m.reply_to_id AND rp.room_key=m.room_key AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=rp.user_id AND pb.active=1)
 LEFT JOIN users pu ON pu.id=rp.user_id`;
function chatAccessGuard(user,channel,target){
  const account=accountCommitGuard(user);
  if(channel==='admin'){requireStaffChat(user);return {...roleCommitGuard(user),code:'STAFF_CHAT_REQUIRED'};}
  const channelSql=channel==='guild'?GUILD_MEMBER_GUARD:channel==='friend'?"EXISTS(SELECT 1 FROM friendships WHERE user_a=? AND user_b=? AND status='accepted')":'1';
  const channelArgs=channel==='guild'?[user.id,user.guild_id]:channel==='friend'?pair(user.id,idField(target,'友達の識別子')):[];
  return {sql:channelSql+' AND '+account.sql,args:[...channelArgs,...account.args],code:channel==='friend'?'FRIENDSHIP_REQUIRED':'GUILD_REQUIRED'};
}
function chatMetadata(body){
  const replyToId=body.replyToId??null,mentionIds=body.mentionIds===undefined?[]:body.mentionIds;
  if(replyToId!==null&&(!Number.isSafeInteger(replyToId)||replyToId<=0))fail(400,'INVALID_REPLY','返信先のメッセージ番号が正しくありません。');
  if(!Array.isArray(mentionIds)||mentionIds.length>8||mentionIds.some(id=>typeof id!=='string'||!publicPlayerId.test(id))||new Set(mentionIds).size!==mentionIds.length)fail(400,'INVALID_MENTIONS','メンションは重複のない領主IDを8人まで指定してください。');
  return {replyToId,mentionIds};
}
function chatContextGuard(user,channel,target,room,{replyToId,mentionIds}){
  const reply=replyToId===null?{sql:'1',args:[]}:{sql:'EXISTS(SELECT 1 FROM messages parent WHERE parent.id=? AND parent.room_key=? AND NOT EXISTS(SELECT 1 FROM player_bans banned WHERE banned.user_id=parent.user_id AND banned.active=1))',args:[replyToId,room]};
  const scope=channel==='guild'?'EXISTS(SELECT 1 FROM guild_members gm WHERE gm.user_id=mu.id AND gm.guild_id=?)':channel==='friend'?'mu.id IN (?,?)':channel==='admin'?"(mu.id=(SELECT value FROM settings WHERE key='adminUserId') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=mu.id) OR EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=mu.id))":'1';
  const scopeArgs=channel==='guild'?[user.guild_id]:channel==='friend'?[user.id,idField(target,'友達の識別子')]:[];
  const mentions=mentionIds.length?{sql:'(SELECT COUNT(*) FROM json_each(?) wanted JOIN users mu ON mu.id=wanted.value WHERE NOT EXISTS(SELECT 1 FROM player_bans banned WHERE banned.user_id=mu.id AND banned.active=1) AND '+scope+')=?',args:[JSON.stringify(mentionIds),...scopeArgs,mentionIds.length]}:{sql:'1',args:[]};
  return {reply,mentions,sql:reply.sql+' AND '+mentions.sql,args:[...reply.args,...mentions.args]};
}
async function checkChatContext(db,user,access,context,{conflict=false}={}){
  const state=await stmt(db,'SELECT ('+context.reply.sql+') AS reply_ok,('+context.mentions.sql+') AS mentions_ok WHERE '+access.sql,...context.reply.args,...context.mentions.args,...access.args).first();
  if(!state){await requireAccountAccess(db,user);fail(403,access.code,'このチャットの参加権限がありません。');}
  if(!state.reply_ok||!state.mentions_ok)fail(conflict?409:400,conflict?'CHAT_CONTEXT_CHANGED':!state.reply_ok?'CHAT_REPLY_UNAVAILABLE':'CHAT_MENTION_UNAVAILABLE',conflict?'返信先またはメンション先の状況が変わりました。最新の会話を確認してください。':!state.reply_ok?'この会話で返信できるメッセージではありません。':'この会話でメンションできない領主が含まれています。');
}
async function verifyChatResponse(db,request){
  const guard=chatResponseGuards.get(request);if(!guard)return;
  const current=await stmt(db,'SELECT EXISTS(SELECT 1 WHERE '+guard.access.sql+') AS allowed,(SELECT content_revision FROM moderation_state WHERE id=1) AS content_revision',...guard.access.args).first();
  if(!current?.allowed){await requireAccountAccess(db,guard.user);fail(403,guard.access.code,'このチャットの参加権限がありません。');}
  if(Number(current.content_revision)!==guard.contentRevision)fail(409,'CONTENT_CHANGED','投稿が更新されました。最新の一覧を確認してください。');
}
const GUILD_SELECT = `SELECT g.id,g.name,g.owner_id,u.name AS owner_name,g.created_at,
 (SELECT gi.version FROM guild_icons gi WHERE gi.guild_id=g.id) AS icon_version,
 (SELECT COUNT(*) FROM guild_members gm WHERE gm.guild_id=g.id) AS member_count FROM guilds g JOIN users u ON u.id=g.owner_id`;
function mapGuild(row) { return {id:row.id,name:row.name,ownerId:row.owner_id,ownerName:row.owner_name,ownerEvaluation:evaluationRef(row.owner_id),iconVersion:row.icon_version||null,memberCount:Number(row.member_count),maxMembers:MAX_GUILD_MEMBERS,createdAt:iso(row.created_at)}; }
const GUILD_MEMBER_GUARD='EXISTS(SELECT 1 FROM guild_members WHERE user_id=? AND guild_id=?)';
const GUILD_ASSETS=['gold','rice','wood','stone','magatama'];
const GUILD_ASSET_NAMES={gold:'金',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
const GUILD_ASSET_LIMIT=100000000;
const GUILD_ASSET_COMMIT='EXISTS(SELECT 1 FROM guild_asset_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
const GUILD_ROLE_COMMIT='EXISTS(SELECT 1 FROM guild_role_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
function requireGuild(user,guildId) {
  if(!user.guild_id||guildId&&user.guild_id!==guildId)fail(403,'GUILD_REQUIRED','現在所属している同盟で操作してください。');
}
function guildRoleAllowed(user,action) { return user.owner_id===user.id||action==='remove'&&!!user.is_guild_officer; }
function requireGuildRole(user,action) {
  if(!guildRoleAllowed(user,action))fail(403,'GUILD_ROLE_REQUIRED','この操作に必要な同盟役職がありません。');
}
function mapTreasury(row) { return {...Object.fromEntries(GUILD_ASSETS.map(key=>[key,Math.min(GUILD_ASSET_LIMIT,Number(row?.[key]||0))])),revision:Number(row?.revision||0)}; }
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
  if(!rows(result[0]).length)fail(403,'GUILD_REQUIRED','同盟の所属が変更されました。接続を更新してください。');
  return {ok:true,user:mapUser(current,now),guild:rows(result[1])[0]?mapGuild(rows(result[1])[0]):null,members:rows(result[2]).map(row=>mapUser(row,now))};
}
async function ensureTreasury(db,guildId) {
  await stmt(db,'INSERT INTO guild_treasuries(guild_id) SELECT id FROM guilds WHERE id=? ON CONFLICT(guild_id) DO NOTHING',guildId).run();
  await stmt(db,'UPDATE guild_treasuries SET gold=MIN(gold,100000000),rice=MIN(rice,100000000),wood=MIN(wood,100000000),stone=MIN(stone,100000000),magatama=MIN(magatama,100000000),revision=revision+1 WHERE guild_id=? AND MAX(gold,rice,wood,stone,magatama)>100000000',guildId).run();
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
  const treasury=rows(result[0])[0];if(!treasury)fail(403,'GUILD_REQUIRED','現在所属している同盟で操作してください。');
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
  if(!treasury)fail(403,'GUILD_REQUIRED','同盟の所属が変更されました。');
  return {...await syncSnapshot(db,await getSyncRow(db,user.id),current,body.deviceId,now),guildId:body.guildId,receipt:publicLedger(receipt),treasury:mapTreasury(treasury),idempotent};
}
async function guildTransfer(db,user,raw,now) {
  if(Object.keys(raw).some(key=>!['guildId','direction','resource','amount','requestId','deviceId','expectedRevision'].includes(key)))fail(400,'INVALID_INPUT','入出庫の情報が正しくありません。');
  const body={...raw,guildId:idField(raw.guildId,'同盟'),requestId:idField(raw.requestId,'操作番号'),deviceId:idField(raw.deviceId,'端末')};
  if(!['deposit','withdraw'].includes(body.direction)||!GUILD_ASSETS.includes(body.resource)||!Number.isSafeInteger(body.amount)||body.amount<1||body.amount>1000000||!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail(400,'INVALID_INPUT','入出庫は対応する資産を1〜1,000,000の整数で指定してください。');
  requireGuild(user,body.guildId);
  const digest=await hash(JSON.stringify([user.id,body.guildId,body.direction,body.resource,body.amount]));
  const prior=await priorGuildTransfer(db,user,body,digest);if(prior)return guildTransferResult(db,user,body,JSON.parse(prior.result_json),true,now);
  await budget(db,'guild-transfer:'+user.id,30,60000,now);
  const row=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);
  const clock=await getWorldClock(db,now),save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}),state=save.state;
  if(!state.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','先に共通時計へ同期してください。');
  if(clock.elapsedMs-state.worldClock.elapsedMs>15000)fail(409,'CLOCK_STALE','共通時計と本拠を同期してから入出庫してください。');
  const treasury=await ensureTreasury(db,body.guildId);if(!treasury)fail(403,'GUILD_REQUIRED','同盟の所属が変更されました。');
  const policyGuard=await treasuryGuard({db,user,now,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,accountCommitGuard,requireAccountAccess}},body);
  const key=body.resource,personal=key==='magatama'?state.magatama:state.resources[key],pooled=Number(treasury[key]),deposit=body.direction==='deposit',delta=deposit?-body.amount:body.amount;
  if(deposit?personal<body.amount:pooled<body.amount)fail(409,'INSUFFICIENT_ASSETS',deposit?'手持ちの資産が足りません。':'同盟の共有資産が足りません。');
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
        AND ${roleGuard.sql} AND ${policyGuard.sql})
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING id`,id,user.id,body.requestId,body.guildId,digest,nonce,body.direction,key,body.amount,JSON.stringify(receipt),now,clock.elapsedMs,user.id,body.guildId,body.expectedRevision,body.deviceId,now,Number(treasury.revision),WORLD_CLOCK_ID,clock.revision,...roleGuard.args,...policyGuard.args),
    ...policyGuard.statements(GUILD_ASSET_COMMIT,guard),
    ...treasuryContributionStatements(db,user,body,now,GUILD_ASSET_COMMIT,guard),
    stmt(db,'UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND '+GUILD_ASSET_COMMIT,serialized,now,now+SYNC_LEASE,user.id,...guard),
    stmt(db,'UPDATE guild_treasuries SET '+key+'=?,revision=revision+1 WHERE guild_id=? AND '+GUILD_ASSET_COMMIT,pooled-delta,body.guildId,...guard),
    stmt(db,"UPDATE users SET clan=CASE WHEN EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=users.id) AND users.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN clan ELSE ? END WHERE id=? AND "+GUILD_ASSET_COMMIT,normalized.state.clan,user.id,...guard),
  ]);
  if(!rows(result[0]).length) {
    const concurrent=await priorGuildTransfer(db,user,body,digest);if(concurrent)return guildTransferResult(db,user,body,JSON.parse(concurrent.result_json),true,now);
    const current=await getUser(db,user.id);requireGuild(current,body.guildId);
    fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);
    if(!!current.is_admin!==!!user.is_admin||current.staff_term!==user.staff_term||(current.deputy_term||'')!==(user.deputy_term||''))fail(409,'AUTHORITY_CHANGED','領主の役職が更新されました。同期してからお試しください。');
    if((await getWorldClock(db,now)).revision!==clock.revision)fail(409,'WORLD_CLOCK_CHANGED','共通時計を確認してからお試しください。');
    fail(409,'TREASURY_CONFLICT','共有資産が更新されました。残高を更新してからお試しください。');
  }
  return guildTransferResult(db,user,body,receipt,false,now);
}
async function guildManage(db,user,raw,remove,now) {
  if(Object.keys(raw).some(key=>!(remove?['guildId','targetPlayerId','requestId']:['guildId','targetPlayerId','role','requestId']).includes(key)))fail(400,'INVALID_INPUT','同盟役職の指定が正しくありません。');
  const guildId=idField(raw.guildId,'同盟'),targetId=idField(raw.targetPlayerId,'対象の領主'),requestId=idField(raw.requestId,'操作番号'),action=remove?'remove':raw.role;
  if(!['officer','member','remove'].includes(action)||!remove&&action==='remove')fail(400,'INVALID_INPUT','副盟主またはメンバーを指定してください。');
  requireGuild(user,guildId);requireGuildRole(user,action);
  if(targetId===user.id)fail(400,'INVALID_TARGET','自分自身の役職変更・除名はできません。');
  const lookup=()=>stmt(db,'SELECT * FROM guild_role_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first();
  const matches=prior=>{if(prior&&(prior.guild_id!==guildId||prior.target_id!==targetId||prior.action!==action))fail(409,'REQUEST_ID_REUSED','その操作番号は別の同盟操作に使われています。');return prior;};
  if(matches(await lookup()))return {...await guildSnapshot(db,user,now,guildId),idempotent:true};
  const target=await getUser(db,targetId);if(!target||target.guild_id!==guildId)fail(404,'GUILD_MEMBER_NOT_FOUND','対象の領主はこの同盟に所属していません。');
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
  if(!rows(result[0]).length){if(matches(await lookup()))return {...await guildSnapshot(db,user,now,guildId),idempotent:true};const current=await getUser(db,user.id);requireGuild(current,guildId);requireGuildRole(current,action);fail(409,'GUILD_CHANGED','同盟の役職または所属が変わりました。一覧を更新してください。');}
  return {...await guildSnapshot(db,user,now,guildId),idempotent:already};
}
async function guildLeave(env,user,body,now) {
  const db=env.DB;
  if(body.guildId!==undefined)requireGuild(user,idField(body.guildId,'同盟'));
  if(!user.guild_id)return {ok:true,user:mapUser(user,now)};
  const guildId=user.guild_id,empty='NOT EXISTS(SELECT 1 FROM guild_treasuries WHERE guild_id=? AND (gold>0 OR rice>0 OR wood>0 OR stone>0 OR magatama>0))',access=accountCommitGuard(user);
  const result=await db.batch([
    stmt(db,`UPDATE guilds SET owner_id=(SELECT gm.user_id FROM guild_members gm WHERE gm.guild_id=? AND gm.user_id<>?
      ORDER BY EXISTS(SELECT 1 FROM guild_officers go WHERE go.user_id=gm.user_id AND go.guild_id=gm.guild_id) DESC,gm.joined_at,gm.user_id LIMIT 1)
      WHERE id=? AND owner_id=? AND EXISTS(SELECT 1 FROM guild_members WHERE guild_id=? AND user_id<>?) AND ${access.sql}`,guildId,user.id,guildId,user.id,guildId,user.id,...access.args),
    stmt(db,'DELETE FROM guild_members WHERE user_id=? AND guild_id=? AND (EXISTS(SELECT 1 FROM guild_members other WHERE other.guild_id=? AND other.user_id<>?) OR '+empty+') AND '+access.sql+' RETURNING user_id',user.id,guildId,guildId,user.id,guildId,...access.args),
    stmt(db,'SELECT object_key FROM guild_icons WHERE guild_id=?',guildId),
    stmt(db,'DELETE FROM guilds WHERE id=? AND NOT EXISTS(SELECT 1 FROM guild_members WHERE guild_id=?) AND '+empty+' AND '+access.sql+' RETURNING id',guildId,guildId,guildId,...access.args),
  ]);
  const current=await getUser(db,user.id);
  if(!rows(result[1]).length&&current.guild_id===guildId)fail(409,'GUILD_TREASURY_NOT_EMPTY','最後のメンバーが脱退する前に、共有資産をすべて引き出してください。');
  if(rows(result[3]).length&&env.BUCKET?.delete)await removeAvatarObject(env.BUCKET,rows(result[2])[0]?.object_key);
  return {ok:true,user:mapUser(current,now)};
}
const EFFECTIVE_CYCLE_SQL="COALESCE(s.cycle_index,MAX(COALESCE((SELECT CAST(value AS INTEGER) FROM settings WHERE key='cyclePolicyStart'),0),CAST(COALESCE(json_extract(s.save_json,'$.state.worldClock.elapsedMs'),0)/40320000 AS INTEGER)))";
const GUILD_CYCLE_HOME_SQL=`CASE WHEN gm.user_id=(SELECT value FROM settings WHERE key='adminUserId') THEN 'edo'
 WHEN EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id) THEN 'kyoto_gosho'
 WHEN EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=gm.user_id) THEN 'kagoshima'
 ELSE COALESCE(s.cycle_home,json_extract(s.save_json,'$.state.cycle.home'),json_extract(s.save_json,'$.state.home')) END`;
const GUILD_RANKINGS=`WITH totals AS (
  SELECT g.id,g.name,g.owner_id,owner.name AS owner_name,g.created_at,COUNT(gm.user_id) AS member_count,
    (SELECT gi.version FROM guild_icons gi WHERE gi.guild_id=g.id) AS icon_version,
    COALESCE(SUM(COALESCE(json_extract(s.save_json,'$.state.prestige'),0)),0) AS total_prestige,
    COALESCE(SUM(CASE WHEN s.save_json IS NULL THEN 0 WHEN ${EFFECTIVE_CYCLE_SQL}<? THEN 1+${inheritedCastleCountSql(GUILD_CYCLE_HOME_SQL)} ELSE
      (SELECT COUNT(*) FROM json_each(s.save_json,'$.state.castles') c
        WHERE json_extract(c.value,'$.owner')=json_extract(s.save_json,'$.state.clan')
        AND (c.key<>'edo' OR gm.user_id=(SELECT value FROM settings WHERE key='adminUserId'))
        AND (c.key<>'kyoto_gosho' OR gm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id)))
      +CASE WHEN gm.user_id=(SELECT value FROM settings WHERE key='adminUserId')
        AND json_extract(s.save_json,'$.state.castles.edo.owner')<>json_extract(s.save_json,'$.state.clan') THEN 1 ELSE 0 END
      +CASE WHEN gm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id) AND json_extract(s.save_json,'$.state.castles.kyoto_gosho.owner')<>json_extract(s.save_json,'$.state.clan') THEN 1 ELSE 0 END
      +CASE WHEN gm.user_id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'')
        AND (json_extract(s.save_json,'$.state.castles.edo.owner')=json_extract(s.save_json,'$.state.clan') OR json_extract(s.save_json,'$.state.castles.kyoto_gosho.owner')=json_extract(s.save_json,'$.state.clan') AND NOT EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=gm.user_id))
        AND NOT EXISTS(SELECT 1 FROM json_each(s.save_json,'$.state.castles') c WHERE c.key NOT IN ('edo','kyoto_gosho') AND json_extract(c.value,'$.owner')=json_extract(s.save_json,'$.state.clan')) THEN 1 ELSE 0 END END),0) AS owned_castles
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
  const transferLine=`${attacker?'獲得した戦利品':'資源の損失'}：${amounts(battle.loot)}。`;
  if(battle.battleMode==='branch'){
    const name=battle.branchName||battle.castleName,title=`【${attacker?won?'支拠点攻略':'支拠点攻撃・撤退':won?'支拠点防衛':'支拠点陥落'}】${name}`;
    const lines=[attacker?`${battle.defenderName}の${name}へ出陣しました。`:`${name}が${battle.attackerName}の攻撃を受けました。`,battle.branchFallen?'支拠点は陥落しました。修復が完了するまで親拠点を守る効果はありません。':'支拠点は攻撃を退けました。'];
    if(attacker)lines.push(`出陣兵${battle.troops.toLocaleString('ja-JP')}人、損失${battle.attackerLost.toLocaleString('ja-JP')}人、消費兵糧${battle.foodCost.toLocaleString('ja-JP')}。`);
    lines.push(transferLine,'勝利時の報酬は相手の各資源の50%（端数切捨て・所持上限まで）です。','結果はすでに保存へ反映済みです。共有地図で残りの支拠点と本城の状態を確認できます。');return{title,body:lines.join('\n')};
  }
  const mode={reward:'合戦',capture:'占領戦',raid:'襲撃'}[battle.battleMode];
  const lines=[attacker?`${battle.defenderName}の${battle.castleName}へ出陣しました。`:`${battle.attackerName}から${battle.castleName}を攻撃されました。`,
    `結果：${won?attacker?'勝利':'防衛勝利':attacker?'敗北・撤退':'敗北'}。`,`戦闘の種類：${mode}。`];
  if(attacker){
    lines.push(`出陣兵：${battle.troops.toLocaleString('ja-JP')}人。損失：${battle.attackerLost.toLocaleString('ja-JP')}人。`,`消費した兵糧：${battle.foodCost.toLocaleString('ja-JP')}。`);
    lines.push(transferLine,'勝利時の報酬は相手の各資源の50%（端数切捨て・所持上限まで）です。');
    if(battle.lootCapacityLimited)lines.push('所持上限により受け取れない資源は相手に残っています。');
    if(captured){
      lines.push(battle.capture.newlyOwned?`${battle.castleName}を所領に加え、帰還兵のうち${battle.capture.garrison.toLocaleString('ja-JP')}人を守備兵として配置しました。`:`相手の${battle.castleName}の領有を解きました。あなたが既に所有していた同城の城郭・城兵・普請は継続します。`);
      lines.push(`あなたの本拠は${CASTLE_BY_ID[homes.attacker].name}のままです。`);
      if(moved)lines.push(`相手の本拠は${CASTLE_BY_ID[homes.defenderBefore].name}から${CASTLE_BY_ID[homes.defenderAfter].name}へ移りました。`);
    }
    lines.push('戦闘の損失・消費・獲得はすでに保存へ反映済みです。このメールで追加の受け取り操作は不要です。');
  }else{
    lines.push(`損失：援軍${battle.defenderLost.troops.toLocaleString('ja-JP')}人・城兵${battle.defenderLost.garrison.toLocaleString('ja-JP')}人。`,`資源の損失：${amounts(battle.loot)}。`);
    if(captured){
      lines.push(`${battle.castleName}の領有を失いました。`);
      if(moved){
        lines.push(`本拠の移転：${CASTLE_BY_ID[homes.defenderBefore].name} → ${CASTLE_BY_ID[homes.defenderAfter].name}。`,
          '施設・軍団・奉行・所持武将・研究、戦闘後に残った資源と兵を引き継いでいます。施設の普請も継続します。',
          `移転先の城郭はLv.${homes.defenderLevel}です（通常城の上限はLv.32）。城郭の普請は移転先の上限内で引き継ぎます。`,
          '次の周回も新しい本拠から再出発します。');
      }else lines.push(`本拠は${CASTLE_BY_ID[homes.defenderAfter].name}のままです。施設・軍団・奉行・所持武将・研究と、戦闘後に残った資源・兵を保持しています。`);
    }
    lines.push('戦闘結果はすでに保存へ反映済みです。ゲームへ接続し直すと最新の状態を確認できます。');
  }
  const title=!attacker&&moved?`【敗北・本拠移転】${battle.castleName}`:`【${attacker?won?'戦闘勝利':'戦闘敗北':won?'防衛勝利':'被攻撃・敗北'}】${battle.castleName}`;
  return {title,body:lines.join('\n')};
}
function fieldBattleMailBody(body,event,battle) {
  // Older system notices retain their stored body/hash for idempotent retries.
  // Project only known server-authored lines; never rewrite operator messages
  // or the participant names and outcomes embedded in a battle notification.
  if(event?.kind!=='field-battle'||!battle||event.battleId!==battle.id)return body;
  if(battle.id.startsWith('cb_')){
    const resourceLine=battle.lootPolicy===FIELD_LOOT_POLICY.id?'資源の損失：'+[['gold','金銭'],['rice','兵糧'],['wood','木材'],['stone','石材']].map(([key,label])=>label+Number(battle.loot?.[key]||0).toLocaleString('ja-JP')).join('・')+'。':'';
    const report=battle.castleName+'が部隊の襲撃を受けました。'+(battle.won?'相手部隊が戦闘で優勢となりました。':'守備隊が相手部隊を退けました。')+'損失は軍団'+battle.defenderLost?.troops+'人・守備兵'+battle.defenderLost?.garrison+'人です。'+resourceLine;
    return body===report+'拠点の領有は継続しています。'?report:body;
  }
  const labels=new Map([
    ['戦闘の種類：報酬戦（占領なし）。','戦闘の種類：合戦。'],
    ['戦闘の種類：襲撃（占領なし）。','戦闘の種類：襲撃。'],
  ]),omitted=new Set([
    'この戦闘で城の領有と本拠は変わりません。',
    `${battle.castleName}は占領されません。この戦闘による資源・兵・施設・軍団・奉行の損失はありません。通常の時刻進行・共同普請は継続します。`,
    `${battle.castleName}の領有・守備兵・資源は維持しています。支拠点の戦いでは、城の占領や戦利品・勝利報酬の獲得はありません。`,
    `${battle.castleName}の領有と、本拠${battle.capture?.defenderHomeCastleName}を維持しています。`,
  ]);
  return body.split('\n').filter(line=>!omitted.has(line)).map(line=>labels.get(line)||line).join('\n');
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
const CASTLES = globalThis.SENGOKU_DATA.castles.map(({id,clan,name,region})=>({id,clan,name,region}));
const CLANS = [{"name":"織田家"},{"name":"武田家"},{"name":"上杉家"},{"name":"徳川家"},{"name":"毛利家"},{"name":"島津家"},{"name":"伊達家"},{"name":"北条家"}];
const TECHS = [{"id":"cultivation","max":5},{"id":"commerce","max":5},{"id":"forestry","max":5},{"id":"masonry","max":5},{"id":"conscription","max":5},{"id":"discipline","max":5},{"id":"gunnery","max":5},{"id":"siege","max":5}];
const QUESTS = [{"id":"first_upgrade"},{"id":"first_recruit"},{"id":"first_battle"},{"id":"three_castles"},{"id":"five_officers"},{"id":"technology"},{"id":"ten_castles"},{"id":"unify"}];
const TACTICS = [{"id":"balanced"},{"id":"assault"},{"id":"siege"},{"id":"ambush"}];
const OFFICERS = GAME_OFFICERS.map(({id,rank,rarity,courtNoble,cloisteredReward})=>({id,rank,rarity,courtNoble,cloisteredReward}));
const RANKS = ["D","C","B","A","S","SS","SSS","U"];
const RESOURCES = ["gold","rice","wood","stone"];
const GACHA = {"initial":3000,"duplicateRefund":50};
const CASTLE_BY_ID = Object.assign(Object.create(null), Object.fromEntries(CASTLES.map(v => [v.id,v])));
const OFFICER_BY_ID = Object.assign(Object.create(null), Object.fromEntries(OFFICERS.map(v => [v.id,v])));
const VALID_OFFICER_VARIANTS = new Map(OFFICERS.flatMap(officer=>(officer.courtNoble||officer.cloisteredReward?[officer.rank||officer.rarity]:RANKS).map(rank=>[officer.id+':'+rank,officer.id])));
const CLAN_HOMES = {'織田家':'kiyosu','武田家':'tsutsujigasaki','上杉家':'kasugayama','徳川家':'okazaki','毛利家':'yoshida','島津家':'uchijo','伊達家':'yonezawa','北条家':'odawara'};
const copy = value => JSON.parse(JSON.stringify(value));
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key,object[key]]));
const jobDto=job=>({...pick(job,['kind','id','remaining','total','remainingSeconds','totalSeconds','targetLevel']),...(job.kind==='branch'&&job.repair===true?{repair:true}:{}),...(job.kind==='branch'&&job.facilityId!==undefined?{facilityId:job.facilityId}:{}),...(job.kind==='branch'&&job.completesElapsedMs!==undefined?{completesElapsedMs:job.completesElapsedMs}:{})});
function branchSite(id){for(const parent of globalThis.SENGOKU_DATA.branchRules.parents)for(const direction of globalThis.SENGOKU_DATA.branchRules.directions)if(id===parent.id+'_'+direction.id)return{id,parentCastleId:parent.id,direction:direction.id,name:CASTLE_BY_ID[parent.id].name+'・'+direction.name+'支拠点',maxLevel:parent.maxLevel};return null;}
function initialCastle(id){const castle=globalThis.SENGOKU_DATA.castles.find(item=>item.id===id);return{owner:castle.clan,troops:castle.initialTroops,wall:castle.wall,level:1};}
function upkeepTroopSnapshot(game){return{army:game.state.troops,castles:Object.fromEntries(game.ownedCastles().map(castle=>[castle.id,castle.troops])),branches:Object.fromEntries(game.state.branches.map(branch=>[branch.id,branch.stationedTroops||0]))};}
function upkeepAdjustmentDto(before,after,result){
  if(!result.changed||!Number.isSafeInteger(result.removed)||result.removed<=0)return null;
  const stocks=value=>new Map([['army:army',value.army],...Object.entries(value.castles).map(([id,count])=>['castle:'+id,count]),...Object.entries(value.branches).map(([id,count])=>['branch:'+id,count])]);
  const prior=stocks(before),next=stocks(after),debits=new Map();let removed=0;
  for(const key of new Set([...prior.keys(),...next.keys()])){const difference=(prior.get(key)||0)-(next.get(key)||0);if(difference<0)return null;if(difference){debits.set(key,difference);removed+=difference;}}
  if(removed!==result.removed||debits.size!==result.allocations.length)return null;
  for(const item of result.allocations){const key=item.kind+':'+item.id;if(debits.get(key)!==item.removed)return null;debits.delete(key);}
  if(debits.size)return null;
  return{version:1,removed,allocations:result.allocations.map(item=>pick(item,['kind','id','removed'])),before,after};
}
function reconcileMonthlyUpkeep(game,before,{hasMonthlyReceipt=false}={}){
  const state=game.state,sameCampaign=before?.state.walking.campaignId===state.walking.campaignId;
  if(!sameCampaign){state.upkeep=GameEngine.normalizeUpkeepState(undefined,state.turn);return null;}
  const previous=GameEngine.normalizeUpkeepState(before.state.upkeep,before.state.turn),incoming=state.upkeep,allocations=[];
  const counters={...previous.branchReductions};
  if(hasMonthlyReceipt){
    for(const [id,total] of Object.entries(incoming.branchReductions)){
      const removed=Math.max(0,total-(counters[id]||0));if(!removed)continue;
      const branch=state.branches.find(branch=>branch.id===id);
      // Receipts can only debit soldiers in an existing canonical pool. They
      // cannot add troops, repeat a settled month, or reset on a rebuilt site.
      if(incoming.settledTurn<=previous.settledTurn||!branch||removed>(branch.stationedTroops||0))fail(409,'BRANCH_STATE_CHANGED','月ごとの減兵と支拠点の兵を最新の保存へ同期してください。');
      branch.stationedTroops-=removed;counters[id]=total;allocations.push({kind:'branch',id,removed});
    }
  }
  state.upkeep={version:1,settledTurn:Math.max(previous.settledTurn,hasMonthlyReceipt?incoming.settledTurn:before.state.turn),branchReductions:counters};
  if(allocations.length)game._pruneBranches();
  // A modern client already settled the month before any later recruitment or
  // income change. Only legacy/deferred months need a complete calculation.
  const pending=game.settleMonthlyUpkeep();
  for(const item of pending.allocations){const prior=allocations.find(value=>value.kind===item.kind&&value.id===item.id);if(prior)prior.removed+=item.removed;else allocations.push({...item});}
  const removed=allocations.reduce((sum,item)=>sum+item.removed,0);
  return{changed:removed>0,removed,allocations};
}

function normalizeGameSave(raw, user, now, {reading=false,clock=null}={}) {
  let obj;try{obj=typeof raw==='string'?JSON.parse(raw):copy(raw);}catch(e){fail(400,'INVALID_SAVE','セーブデータを読み取れません。');}
  const s=obj?.state||obj,staff=!!user.is_staff&&!user.is_admin&&!user.is_sento,serviceSave=['sunpu','kyoto_gosho'].includes(s?.staffService?.baseId);
  if(serviceSave&&!staff&&s?.buildings){s.command=Math.min(Number(s.command),3+Math.floor(s.buildings.keep/8));if(s.governors&&typeof s.governors==='object')s.governors=Object.fromEntries(Object.entries(s.governors).filter(([id])=>!BUILDINGS.some(b=>b.id===id)||s.buildings[id]>0));}
  const invalid=()=>{fail(400,'INVALID_SAVE','セーブデータの形式または内容が正しくありません。');};
  const isObj=v=>v&&typeof v==='object'&&!Array.isArray(v);
  const num=(v,min=0,max=999999999)=>typeof v==='number'&&Number.isFinite(v)&&Number.isInteger(v)&&v>=min&&v<=max;
  if(isObj(s?.castles)&&!Object.hasOwn(s.castles,'sento_gosho'))s.castles.sento_gosho=initialCastle('sento_gosho');
  const legacyMap=isObj(s?.castles)&&!Object.hasOwn(s.castles,'kyoto_gosho')&&Object.keys(s.castles).length===CASTLES.length-1&&CASTLES.every(c=>c.id==='kyoto_gosho'||Object.hasOwn(s.castles,c.id));
  if(legacyMap)s.castles.kyoto_gosho=initialCastle('kyoto_gosho');
  // Validate the old protected castle before moving it. This is a one-time
  // schema migration, never a reason to relax current entitlement validation.
  if(isObj(s?.castles)&&(s.staffService?.baseId==='sunpu'||staff&&legacyMap&&s.home==='sunpu')){
    const prior=s.castles.sunpu;
    if(s.home==='sunpu'||prior?.owner===s.clan){
      if(!isObj(prior)||!num(prior.level??1,1,64)||!num(prior.troops,0,100000000)||!num(prior.wall,1,32))invalid();
      s.castles.kyoto_gosho={...prior,level:prior.level??1};s.castles.sunpu=initialCastle('sunpu');if(s.castles.sunpu.owner===s.clan)s.castles.sunpu.owner='在地衆';
      if(s.home==='sunpu')s.home='kyoto_gosho';if(s.cycle?.home==='sunpu')s.cycle.home='kyoto_gosho';
      if(Array.isArray(s.jobs))for(const job of s.jobs)if(job?.kind==='castle'&&job.id==='sunpu'){if(!num(job.targetLevel,1,64))invalid();job.id='kyoto_gosho';}
      if(Array.isArray(s.captureRewards))s.captureRewards=s.captureRewards.map(id=>id==='sunpu'?'kyoto_gosho':id);
    }
    s.staffService={baseId:'kyoto_gosho'};
  }
  // Validate historical saves against their old limit before migrating them.
  // New uploads must already obey the current limit. Invalid old jobs still fail.
  const incomingCastleLimit=id=>(reading&&FIELD_CAPTURE_CASTLES.includes(id)||(reading||legacyMap)&&id==='sunpu')?64:castleLevelLimit(id);
  if(!isObj(s)||s.version!==2||obj?.game&&obj.game!=='sengoku-tento')invalid();
  if(s.clan===ADMIN_CLAN&&!user.is_admin&&!staff&&!reading)fail(403,'ADMIN_CLAN_REQUIRED','この家名は選択できません。徳川家を選択してください。');
  if(s.clan!==ADMIN_CLAN&&!CLANS.some(c=>c.name===s.clan)||!CASTLE_BY_ID[s.home]||!['easy','normal','hard'].includes(s.difficulty))invalid();
  const g={state:{version:2},roster:OFFICERS,officer:id=>OFFICER_BY_ID[id],baseOfficer:id=>OFFICER_BY_ID[id]};
  if(s.troopTransferSequence===undefined)s.troopTransferSequence=0;
  if(!num(s.troopTransferSequence,0,1000000000))invalid();
  if(!num(s.turn,0,MAX_TURN)||!num(s.troops,0,100000000)||!num(s.morale,0,100)||!num(s.prestige)||!num(s.command,0,7)||!num(s.seed,0,4294967295))invalid();
  if(!isObj(s.resources)||!RESOURCES.every(k=>num(s.resources[k])))invalid();
  if(!isObj(s.buildings)||Object.keys(s.buildings).length!==BUILDINGS.length||!BUILDINGS.every(b=>num(s.buildings[b.id],b.core?1:0,32)))invalid();
  if(!staff&&s.command>3+Math.floor(s.buildings.keep/8))invalid();
  if(!isObj(s.tech)||!TECHS.every(t=>num(s.tech[t.id],0,t.max)))invalid();
  const validOwner=new Set([...CASTLES.map(c=>c.clan),'在地衆',ADMIN_CLAN]);for(const c of CLANS)validOwner.add(c.name);
  if(!isObj(s.castles)||Object.keys(s.castles).length!==CASTLES.length||!CASTLES.every(c=>{const v=s.castles[c.id];if(isObj(v)&&v.level===undefined)v.level=1;return isObj(v)&&validOwner.has(v.owner)&&num(v.troops,0,100000000)&&num(v.wall,1,32)&&num(v.level,1,incomingCastleLimit(c.id));}))invalid();
  try{for(const castle of Object.values(s.castles)){if(castle.durability!==undefined)castle.durability=GameEngine.normalizeDurability(castle.durability);}}catch{invalid();}
  if(!reading&&clock&&s.worldClock&&Object.values(s.castles).some(castle=>castle.durability?.updatedElapsedMs>clock.elapsedMs))invalid();
  if(!Array.isArray(s.officers)||s.officers.length>g.roster.length)invalid();
  const ownedOfficers=new Set(s.officers);
  if(ownedOfficers.size!==s.officers.length||s.officers.some(id=>typeof id!=='string'||!g.officer(id)))invalid();
  if(!Array.isArray(s.army)||s.army.length>3||new Set(s.army).size!==s.army.length||s.army.some(id=>!ownedOfficers.has(id)))invalid();
  if(!isObj(s.governors)||Object.keys(s.governors).some(id=>!BUILDINGS.some(b=>b.id===id)||!staff&&s.buildings[id]<1)||Object.values(s.governors).some(id=>!ownedOfficers.has(id)||s.army.includes(id))||new Set(Object.values(s.governors)).size!==Object.values(s.governors).length)invalid();
  const scalar=(v,min,max)=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
  if(s.realtime===undefined)s.realtime={running:true,speed:1,elapsed:0,commandProgress:0,incomeRemainders:{gold:0,rice:0,wood:0,stone:0}};
  const rt=s.realtime;
  if(!isObj(rt)||typeof rt.running!=='boolean'||![1,2,4].includes(rt.speed)||!scalar(rt.elapsed,0,59.99999999)||!scalar(rt.commandProgress,0,19.99999999)||!isObj(rt.incomeRemainders)||Object.keys(rt.incomeRemainders).length!==4||!RESOURCES.every(k=>scalar(rt.incomeRemainders[k],-1,1)&&Math.abs(rt.incomeRemainders[k])<1))invalid();
  if(s.worldClock!==undefined) {
    if(!isObj(s.worldClock)||s.worldClock.id!==WORLD_CLOCK_ID||!Number.isSafeInteger(s.worldClock.elapsedMs)||s.worldClock.elapsedMs<0||s.worldClock.elapsedMs>WORLD_MONTH_MS*(MAX_TURN+1)-1)fail(400,'INVALID_CLOCK_ANCHOR','共通時計の保存位置が正しくありません。');
    if(s.turn!==Math.floor(s.worldClock.elapsedMs/WORLD_MONTH_MS)||Math.abs(rt.elapsed-(s.worldClock.elapsedMs%WORLD_MONTH_MS)/1000)>1e-5)fail(400,'INVALID_CLOCK_ANCHOR','ゲーム年月と共通時計の保存位置が一致しません。');
    if(!reading&&clock&&s.worldClock.elapsedMs>clock.elapsedMs+5000)fail(400,'CLOCK_AHEAD','保存時刻が世界の共通時計より先です。共通時計を再確認してください。');
  }
  if(!Array.isArray(s.jobs)||s.jobs.length>GameEngine.maxConstructionJobs)invalid();
  for(const j of s.jobs){if(!isObj(j))invalid();if(j.remainingSeconds===undefined)j.remainingSeconds=j.remaining*60;if(j.totalSeconds===undefined)j.totalSeconds=j.total*60;if(!scalar(j.remainingSeconds,.00000001,180)||!num(j.totalSeconds,60,180)||j.totalSeconds!==j.total*60||j.remainingSeconds>j.totalSeconds||j.remaining!==Math.ceil((j.remainingSeconds-1e-8)/60)||j.kind==='branch'&&j.completesElapsedMs!==undefined&&!num(j.completesElapsedMs,0,WORLD_MONTH_MS*(MAX_TURN+1)-1))invalid();}
  try{s.branches=GameEngine.normalizeBranchState(s.branches,{castles:s.castles,clan:s.clan,jobs:s.jobs,officers:s.officers,army:s.army,governors:s.governors,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,validateRole:!reading});}catch{invalid();}
  const jobkeys=new Map();
  for(const j of s.jobs){
    if(!isObj(j)||!['building','castle','research','branch'].includes(j.kind)||!num(j.remaining,1,3)||!num(j.total,1,3)||j.remaining>j.total||j.kind!=='branch'&&j.repair!==undefined)invalid();
    const key=j.kind+':'+j.id,count=jobkeys.get(key)||0;
    if(j.kind!=='branch'){
      const defs=j.kind==='building'?BUILDINGS:j.kind==='castle'?CASTLES:TECHS,current=j.kind==='castle'?s.castles[j.id]?.level:(j.kind==='building'?s.buildings:s.tech)[j.id];
      const limit=j.kind==='research'?5:j.kind==='castle'?incomingCastleLimit(j.id):32;
      if(!defs.some(d=>d.id===j.id)||j.targetLevel!==current+count+1||j.targetLevel>limit||j.kind==='castle'&&s.castles[j.id]?.owner!==s.clan||count&&(j.kind!=='building'||j.remainingSeconds!==j.totalSeconds))invalid();
    }
    // normalizeBranchState above checks levels, ordering and cost durations
    // across every facility and body reservation sharing this branch.
    jobkeys.set(key,count+1);
  }
  if(s.jobs.filter(j=>j.kind==='research').length>1||[...jobkeys.keys()].filter(key=>!key.startsWith('research:')).length>(staff||serviceSave?6:2+Math.floor(s.buildings.keep/8)))invalid();
  if(reading||legacyMap){if(reading)for(const id of FIELD_CAPTURE_CASTLES)s.castles[id].level=Math.min(48,s.castles[id].level);s.castles.sunpu.level=Math.min(32,s.castles.sunpu.level);s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.targetLevel<=castleLevelLimit(job.id));}
  s.jobs=s.jobs.map(jobDto);
  if(!isObj(s.treaties)||Object.entries(s.treaties).some(([k,v])=>!validOwner.has(k)||k===s.clan||!num(v,0,MAX_TURN+6)))invalid();
  if(!isObj(s.scouted)||Object.entries(s.scouted).some(([k,v])=>!CASTLE_BY_ID[k]||!num(v,0,MAX_TURN+6)))invalid();
  if(!Array.isArray(s.claimedQuests)||new Set(s.claimedQuests).size!==s.claimedQuests.length||s.claimedQuests.some(id=>!QUESTS.some(q=>q.id===id)))invalid();
  if(s.giftReceipts===undefined)s.giftReceipts=[];
  if(!Array.isArray(s.giftReceipts)||s.giftReceipts.length>2000||new Set(s.giftReceipts).size!==s.giftReceipts.length||s.giftReceipts.some(id=>typeof id!=='string'||id.length<1||id.length>128))invalid();
  try{s.walking=GameEngine.normalizeWalkingState(s.walking);}catch{invalid();}
  try{s.roaming=GameEngine.normalizeRoamingState(s.roaming,s.walking.campaignId);s.covert=GameEngine.normalizeCovertState(s.covert,s.walking.campaignId);s.march=GameEngine.normalizeMarchState(s.march,s);s.marchHistory=GameEngine.normalizeMarchHistory(s.marchHistory,s);}catch{invalid();}
  if(s.magatama===undefined)s.magatama=GACHA.initial;if(!num(s.magatama))invalid();
  if(s.captureRewards===undefined)s.captureRewards=CASTLES.filter(c=>s.castles[c.id].owner===s.clan).map(c=>c.id);
  if(!Array.isArray(s.captureRewards)||s.captureRewards.length>CASTLES.length||new Set(s.captureRewards).size!==s.captureRewards.length||s.captureRewards.some(id=>typeof id!=='string'||!CASTLE_BY_ID[id]))invalid();
  if(!isObj(s.stats)||!['battles','wins','upgrades','recruited'].every(k=>num(s.stats[k],0,10000000))||s.stats.wins>s.stats.battles)invalid();
  for(const key of ['gachaDraws','gachaDuplicates','castleUpgrades']){if(s.stats[key]===undefined)s.stats[key]=0;if(!num(s.stats[key],0,10000000))invalid();}if(s.stats.gachaDuplicates>s.stats.gachaDraws)invalid();
  if(s.gachaHistory===undefined)s.gachaHistory=[];
  if(!Array.isArray(s.gachaHistory)||s.gachaHistory.length>50||s.gachaHistory.length>s.stats.gachaDraws||s.gachaHistory.some(v=>!isObj(v)||!g.baseOfficer(v.officerId)||!ownedOfficers.has(v.officerId)||!RANKS.includes(v.rank)||typeof v.isNew!=='boolean'||v.duplicateRefund!==(v.isNew?0:GACHA.duplicateRefund)||!num(v.turn,0,s.turn)))invalid();
  s.gachaHistory=s.gachaHistory.map(v=>({officerId:v.officerId,rank:v.rank,isNew:v.isNew,isNewOfficer:v.isNewOfficer===undefined?v.isNew:v.isNewOfficer,upgraded:v.upgraded===undefined?false:v.upgraded,duplicateRefund:v.duplicateRefund,turn:v.turn}));
  if(s.gachaHistory.some(v=>typeof v.isNewOfficer!=='boolean'||typeof v.upgraded!=='boolean'||v.isNewOfficer&&!v.isNew||v.upgraded&&(!v.isNew||v.isNewOfficer)))invalid();
  if(s.officerVariants===undefined){const variants=new Set(s.officers.map(id=>`${id}:${g.baseOfficer(id).rank||g.baseOfficer(id).rarity}`));for(const v of s.gachaHistory)variants.add(`${v.officerId}:${v.rank}`);s.officerVariants=[...variants];}
  const validVariants=VALID_OFFICER_VARIANTS;
  if(!Array.isArray(s.officerVariants)||s.officerVariants.length>g.roster.length*RANKS.length)invalid();
  const ownedVariants=new Set(s.officerVariants);
  if(ownedVariants.size!==s.officerVariants.length||s.officerVariants.some(key=>typeof key!=='string'||!validVariants.has(key)||!ownedOfficers.has(validVariants.get(key)))||s.officers.some(id=>!RANKS.some(rank=>ownedVariants.has(`${id}:${rank}`)))||s.gachaHistory.some(v=>!ownedVariants.has(`${v.officerId}:${v.rank}`)))invalid();
  if(!num(s.stats.researches??0,0,10000000))invalid();s.stats.researches=s.stats.researches??Object.values(s.tech).reduce((a,b)=>a+b,0);
  if(!Array.isArray(s.log)||s.log.length>200||s.log.some(l=>!isObj(l)||!num(l.turn,0,MAX_TURN)||typeof l.text!=='string'||l.text.length>2000||typeof l.kind!=='string'||l.kind.length>30))invalid();
  // Only retain known, validated fields; do not merge arbitrary imported object keys.
  const n=g.state;for(const k of ['clan','home','turn','difficulty','resources','troops','troopTransferSequence','morale','prestige','command','buildings','jobs','branches','officers','officerVariants','army','governors','tech','castles','treaties','scouted','log','claimedQuests','giftReceipts','walking','roaming','covert','magatama','captureRewards','gachaHistory','seed','stats','realtime','march','marchHistory'])n[k]=copy(s[k]);
  if(s.imperialResidence!==undefined){if(!isObj(s.imperialResidence)||Object.keys(s.imperialResidence).some(key=>key!=='returnHome')||!CASTLE_BY_ID[s.imperialResidence.returnHome]||['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(s.imperialResidence.returnHome))invalid();n.imperialResidence={returnHome:s.imperialResidence.returnHome};}
  applyLordSupport(n,user);
  try{n.upkeep=GameEngine.normalizeUpkeepState(s.upkeep,s.turn);}catch{invalid();}
  n.progress=GameEngine.normalizePlayerProgress(s.progress,n);
  if(s.worldClock!==undefined)n.worldClock={id:WORLD_CLOCK_ID,elapsedMs:s.worldClock.elapsedMs};
  n.officerHealth=GameEngine.normalizeOfficerHealth(s.officerHealth,n);
  if(!reading&&clock&&s.officerHealth===undefined&&n.officerHealth)n.officerHealth.asOfElapsedMs=Math.min(n.officerHealth.asOfElapsedMs,clock.elapsedMs);
  if(!n.officerHealth||!reading&&clock&&n.worldClock&&n.officerHealth.asOfElapsedMs>clock.elapsedMs)invalid();
  if(s.cycle!==undefined){
    const c=s.cycle,r=c?.latestReward,retained=c?.retainedRegions===undefined?[]:c.retainedRegions,protectedRegions=c?.protectedRegions===undefined?(reading?protectedRegionNames({...n,cycle:c}):[]):c.protectedRegions,releasedCastles=c?.releasedCastles===undefined?[]:c.releasedCastles;
    const validRegions=list=>Array.isArray(list)&&list.length<=regionNames.length&&new Set(list).size===list.length&&list.every(region=>regionNames.includes(region));
    if(!isObj(c)||!num(c.index,0,Math.floor(MAX_TURN/WORLD_CYCLE_MONTHS))||!CASTLE_BY_ID[c.home]||r!==null&&(!isObj(r)||!num(r.cycle,0,c.index-1)||!num(r.captured,0,127)||r.gold!==r.captured*1000||r.rice!==r.captured*1000||r.magatama!==r.captured*100)||!validRegions(retained)||!validRegions(protectedRegions)||!Array.isArray(releasedCastles)||releasedCastles.length>CASTLES.length||new Set(releasedCastles).size!==releasedCastles.length||releasedCastles.some(id=>!CASTLES.some(castle=>castle.id===id)||['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(id)))invalid();
    n.cycle={index:c.index,home:c.home,latestReward:r===null?null:pick(r,['cycle','captured','gold','rice','magatama']),retainedRegions:regionNames.filter(region=>retained.includes(region)),protectedRegions:regionNames.filter(region=>protectedRegions.includes(region)),releasedCastles:CASTLES.filter(castle=>releasedCastles.includes(castle.id)).map(castle=>castle.id)};
  }
  try{normalizeRepairProgress(n,s.repair,{isAdmin:!!user.is_admin});}catch{invalid();}
  n.won=CASTLES.every(c=>!user.is_admin&&c.id==='edo'||n.castles[c.id].owner===n.clan);n.gameOver=!CASTLES.some(c=>n.castles[c.id].owner===n.clan);
  if(!n.gameOver&&n.castles[n.home].owner!==n.clan)invalid();if(n.gameOver)n.realtime.running=false;
  n.lastBattle=null;
  if(s.lastBattle!==null&&s.lastBattle!==undefined){const b=s.lastBattle;if(!isObj(b)||typeof b.won!=='boolean'||!CASTLE_BY_ID[b.castleId]||!num(b.ourBefore)||!num(b.ourLost)||!num(b.enemyBefore)||!num(b.enemyLost)||!Array.isArray(b.phases)||b.phases.length>10||b.phases.some(p=>!isObj(p)||typeof p.title!=='string'||p.title.length>50||typeof p.text!=='string'||p.text.length>1000)||!isObj(b.rewards)||!num(b.rewards.gold)||!num(b.rewards.rice)||!num(b.rewards.magatama??0)||b.capturedOfficer!==null&&b.capturedOfficer!==undefined&&!g.officer(b.capturedOfficer))invalid();n.lastBattle={won:b.won,castleId:b.castleId,castleName:CASTLE_BY_ID[b.castleId].name,ourBefore:b.ourBefore,ourLost:b.ourLost,enemyBefore:b.enemyBefore,enemyLost:b.enemyLost,phases:copy(b.phases),rewards:{gold:b.rewards.gold,rice:b.rewards.rice,magatama:b.rewards.magatama??0},capturedOfficer:b.capturedOfficer||null,garrison:num(b.garrison)?b.garrison:0,tactic:TACTICS.some(t=>t.id===b.tactic)?b.tactic:'balanced',turn:num(b.turn,0,MAX_TURN)?b.turn:n.turn};}
  if(n.lastBattle&&s.lastBattle.branchId!==undefined){const site=branchSite(s.lastBattle.branchId);if(!site||site.parentCastleId!==n.lastBattle.castleId||RESOURCES.some(key=>Number(n.lastBattle.rewards[key]||0)!==0)||Number(n.lastBattle.rewards.magatama||0)!==0)invalid();n.lastBattle.branchId=site.id;n.lastBattle.castleName=site.name;n.lastBattle.captured=false;n.lastBattle.capturedOfficer=null;}
  if(n.lastBattle&&s.lastBattle.durability!==undefined){try{n.lastBattle.durability=GameEngine.normalizeDurabilityBattle(s.lastBattle.durability);}catch{invalid();}}
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
      const canonical=staff?'kyoto_gosho':CLAN_HOMES[n.clan]||'okazaki',released=new Set(releasedCastleIds(n)),other=CASTLES.filter(c=>c.id!=='edo'&&!released.has(c.id)&&n.castles[c.id].owner===n.clan);
      const fallback=other.find(c=>c.id===canonical)?.id||other[0]?.id||(!released.has(canonical)?canonical:CASTLES.find(c=>!['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(c.id)&&!released.has(c.id))?.id)||canonical;
      if(ownedEdo&&!other.length&&!released.has(fallback)) {
        n.castles[fallback]={...edo,owner:n.clan,level:Math.min(edo.level,castleLevelLimit(fallback))};
        if(!n.captureRewards.includes(fallback))n.captureRewards.push(fallback);
      }
      if(wasHome)n.home=fallback;
      if(ownedEdo)n.castles.edo={owner:'太田家',troops:3320,wall:4,level:1};
    }
    n.jobs=n.jobs.filter(job=>job.kind==='branch'?branchSite(job.id)?.parentCastleId!=='edo':job.kind!=='castle'||job.id!=='edo');GameEngine.pruneBranchState(n,{isAdmin:false});
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
      edo.level=Math.min(64,edo.level);
      n.jobs=n.jobs.flatMap(job=>job.kind==='castle'&&job.id==='edo'
        ?edo.level>=64?[]:[{...job,targetLevel:edo.level+1}]:[job]);
    }
    edo.owner=n.clan;n.home='edo';
    if(!n.captureRewards.includes('edo'))n.captureRewards.push('edo');
    n.won=CASTLES.every(c=>n.castles[c.id].owner===n.clan);n.gameOver=false;
  }
  if(n.cycle){if(user.is_admin)n.cycle.home='edo';else if(n.cycle.home==='edo')n.cycle.home=n.home;}
  if(!reading&&!staff&&(n.home==='kyoto_gosho'||n.castles.kyoto_gosho.owner===n.clan))fail(403,'STAFF_ENTITLEMENT_REQUIRED','この拠点は現在の利用権では使用できません。');
  if(!reading&&!user.is_deputy&&(n.home==='kagoshima'||n.castles.kagoshima.owner===n.clan))fail(403,'DEPUTY_ENTITLEMENT_REQUIRED','鹿児島城の所属条件を確認できません。最新の保存を読み込んでください。');
  if(!reading&&user.is_deputy&&!user.is_sento&&n.home!=='kagoshima')fail(403,'DEPUTY_FIXED_HOME','この領主の本拠は鹿児島城に固定されています。最新の保存を読み込んでください。');
  if(!reading&&!user.is_sento&&(n.home==='sento_gosho'||n.castles.sento_gosho.owner===n.clan))fail(403,'SENTO_ENTITLEMENT_REQUIRED','仙洞御所は現在の上皇・法皇の専用本拠です。');
  if(staff||serviceSave)n.staffService={baseId:'kyoto_gosho'};
  const roleState=GameEngine.fromSave({game:'sengoku-tento',version:2,state:n},GAME_OFFICERS,{isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:staff,isCourtProtected:!!user.is_court_protected,deputyReturnHome:user.deputy_return_home}).state;
  for(const key of Object.keys(roleState))n[key]=roleState[key];
  if(s.cycle===undefined)delete n.cycle;
  n.resources=pick(n.resources,RESOURCES);
  n.buildings=pick(n.buildings,BUILDINGS.map(v=>v.id));
  n.tech=pick(n.tech,TECHS.map(v=>v.id));
  n.castles=Object.fromEntries(CASTLES.map(v=>[v.id,pick(n.castles[v.id],['owner','troops','wall','level',...(n.castles[v.id].durability?['durability']:[])])]));
  n.jobs=n.jobs.map(jobDto);
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

function reconcileOfficerHealth(save,before,clock){
  if(!before)return;
  const state=save.state,prior=before.state;
  // Both snapshots are compared at one absolute game time. The stored health
  // can already be ahead of a save's simulation after an immediate event battle.
  const admittedElapsed=Math.min(clock.elapsedMs,state.worldClock?.elapsedMs??Math.round(state.turn*WORLD_MONTH_MS+state.realtime.elapsed*1000));
  const elapsed=Math.max(admittedElapsed,state.officerHealth.asOfElapsedMs,prior.officerHealth.asOfElapsedMs);
  const incoming=GameEngine.projectOfficerHealth(state,elapsed),canonical=GameEngine.projectOfficerHealth(prior,elapsed);
  for(const id of state.officers)if(Object.hasOwn(canonical.values,id))incoming.values[id]=Math.min(incoming.values[id],canonical.values[id]);
  state.officerHealth=incoming;
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
      const index=Math.max(policy,Math.floor((save.state.worldClock?.elapsedMs??clock.elapsedMs)/WORLD_CYCLE_MS)),home=authorizedCycleHome(user,save.state,save.state.home);
      save.state.cycle={index,home,latestReward:null,retainedRegions:[],protectedRegions:protectedRegionNames(save.state),releasedCastles:releasedCastleIds(save.state)};
      const roleGuard=roleCommitGuard(user);const updated=await stmt(db,`UPDATE player_saves SET save_json=?,cycle_index=?,cycle_home=?,revision=revision+1,updated_at=? WHERE user_id=? AND revision=? AND cycle_index IS NULL AND ${roleGuard.sql} RETURNING *`,JSON.stringify(save),index,home,now,user.id,row.revision,...roleGuard.args).first();
      if(updated)row=updated;else{row=await getSyncRow(db,user.id);continue;}
    }
    if(Number(row.cycle_index)>=current||writerDeviceId&&(row.writer_device_id!==writerDeviceId||Number(row.lease_expires_at)<=now)||deferActive&&Number(row.lease_expires_at)>now)return row;
    save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock});
    const index=Number(row.cycle_index),home=authorizedCycleHome(user,save.state,row.cycle_home);
    save.state.cycle={index,home,latestReward:save.state.cycle?.latestReward||null,retainedRegions:save.state.cycle?.retainedRegions||[],protectedRegions:protectedRegionNames(save.state),releasedCastles:releasedCastleIds(save.state)};
    if(!save.state.worldClock){const elapsed=index*WORLD_CYCLE_MS+(save.state.turn%WORLD_CYCLE_MONTHS)*WORLD_MONTH_MS+Math.floor(save.state.realtime.elapsed*1000);save.state.turn=Math.floor(elapsed/WORLD_MONTH_MS);save.state.realtime.elapsed=(elapsed%WORLD_MONTH_MS)/1000;save.state.worldClock={id:WORLD_CLOCK_ID,elapsedMs:elapsed};save.state.upkeep.settledTurn=save.state.turn;}
    await reconcileCovertProgress(db,user.id,save);
    const branchAccess=await branchStateGuard(db,user.id,save.state.walking.campaignId);await reconcileBranchProgress(db,user.id,save,clock);
    const staffBase=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
    const maintenanceAuthority=protectMaintenance(branchAccess,await maintenanceContext(db,user.id,save,clock));
    const estateEconomy=await courtEstateContext(db,user,save,clock,now);
    const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branchAccess.resolvedElapsedMs}});
    const target=Math.min(current*WORLD_CYCLE_MS,(index+2)*WORLD_CYCLE_MS);
    const result=game.applyWorldClock({...clock,elapsedMs:target},{maxSeconds:86400});
    if(!result.ok||!result.changed)return row;
    const next=normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock});next.savedAt=iso(now);
    const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses?.()||[],now,state:next.state});
    const rewards=result.cycleRewards||[],nonce=crypto.randomUUID(),serialized=JSON.stringify(next),roleGuard=withCourtEstateGuard(guardLordSupport(roleCommitGuard(user),user),estateEconomy);
    const gate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)',gateParams=[user.id,nonce];
    const batch=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_index=?,cycle_home=?,cycle_commit=?
      WHERE user_id=? AND revision=? AND cycle_index=?
      AND ((? IS NOT NULL AND writer_device_id=? AND lease_expires_at>?) OR (? IS NULL AND lease_expires_at<=?))
      AND (SELECT revision FROM world_clock WHERE id=?)=?
      AND ${roleGuard.sql} AND ${branchAccess.guard.sql} AND ${cpuLosses.guard.sql}
      AND NOT EXISTS(SELECT 1 FROM cycle_receipts WHERE user_id=? AND cycle_index>=? AND cycle_index<?) RETURNING *`,serialized,now,next.state.cycle.index,next.state.cycle.home,nonce,user.id,row.revision,index,writerDeviceId,writerDeviceId,now,writerDeviceId,now,WORLD_CLOCK_ID,clock.revision,...roleGuard.args,...branchAccess.guard.args,...cpuLosses.guard.args,user.id,index,next.state.cycle.index)];
    batch.push(...cpuLosses.statements(gate,gateParams));
    batch.push(...covertIncidentStatements(db,user.id,next,now,gate,gateParams));
    batch.push(...branchProgressStatements(db,user.id,next,now,gate,gateParams));
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
  const limit=Number(raw),found=rows(await stmt(db,`SELECT e.*,u.name,u.clan,CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
  (SELECT ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS deputy_term,(SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan FROM achievement_events e JOIN users u ON u.id=e.user_id WHERE NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1) ${point?'AND (e.occurred_at<? OR (e.occurred_at=? AND e.id<?))':''} ORDER BY e.occurred_at DESC,e.id DESC LIMIT ?`,...(point?[point[0],point[0],point[1]]:[]),limit+1).all()),page=found.slice(0,limit),last=page.at(-1);
  return {ok:true,events:page.map(row=>({id:row.id,playerId:row.user_id,playerName:row.name,playerEvaluation:evaluationRef(row.user_id),clan:publicClan(row.clan,row.is_admin,row.is_staff&&!row.is_sento,row.personal_clan),kind:row.kind,title:row.title,detail:row.detail,targetId:row.target_id,targetName:row.target_name,value:row.value,occurredAt:iso(row.occurred_at)})),nextCursor:found.length>limit?btoa(JSON.stringify([Number(last.occurred_at),last.id])).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null,serverNow:iso(now)};
}

function roleCommitGuard(user) {
  // Bind the identity once: battle commits combine both players' role guards
  // with their campaign and troop reservations under D1's 100-bind limit.
  return {sql:`EXISTS(SELECT 1 FROM users role_actor WHERE role_actor.id=?
    AND ?=CASE WHEN role_actor.id=COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') THEN 1 ELSE 0 END
    AND COALESCE((SELECT COALESCE(sm.term_id,'legacy:'||sm.appointed_at) FROM staff_members sm WHERE sm.user_id=role_actor.id),'')=?
    AND COALESCE((SELECT term_id FROM deputy_operator_state WHERE user_id=role_actor.id),'')=?
    AND NOT EXISTS(SELECT 1 FROM player_bans WHERE user_id=role_actor.id AND active=1)
    AND COALESCE((SELECT revision FROM player_bans WHERE user_id=role_actor.id),0)=?
    AND COALESCE((SELECT revision FROM player_expulsions WHERE user_id=role_actor.id),0)=?
    AND ${courtProtectionSql('role_actor.id')}=? AND EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=role_actor.id)=?)`,args:[user.id,user.is_admin?1:0,user.staff_term||'',user.deputy_term||'',Number(user.moderation_epoch||0),Number(user.expulsion_epoch||0),user.is_court_protected?1:0,user.is_sento?1:0]};
}
async function requireCurrentStaffBase(db,user,{allowAdmin=false}={}) {await requireAccountAccess(db,user);const current=await getUser(db,user.id);if(!current||!(allowAdmin?current.is_admin||current.is_staff:current.is_staff&&!current.is_admin)||current.staff_term!==user.staff_term||(current.deputy_term||'')!==(user.deputy_term||'')||!!current.is_admin!==!!user.is_admin)fail(403,'STAFF_BASE_REQUIRED','スタッフの役職が変更されました。');return current;}
const STAFF_TERM_SQL="COALESCE(sm.term_id,'legacy:'||sm.appointed_at)";
const STAFF_MEMBER_GUARD=`EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=? AND ${STAFF_TERM_SQL}=?) AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)`;
const COURT_EDO_REASON='京都御所から江戸城へ出陣できるのは、在任中の天皇または摂政です。';
async function courtEmperorAuthority(db,user){
  const role=roleCommitGuard(user),found=user.is_staff&&!user.is_admin?await stmt(db,`SELECT l.appointment_token FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.id=1 AND l.user_id=? AND l.term_id=${STAFF_TERM_SQL} AND ${role.sql}`,user.id,...role.args).first():null;
  const token=found?.appointment_token||null;
  return{isCourtEmperor:!!token,token,guard:{sql:`${role.sql} AND EXISTS(SELECT 1 FROM court_leader l JOIN staff_members sm ON sm.user_id=l.user_id WHERE l.id=1 AND l.user_id=? AND l.term_id=${STAFF_TERM_SQL} AND l.appointment_token=?)`,args:[...role.args,user.id,token||'']}};
}
async function courtImperialAuthority(db,user){
  const emperor=await courtEmperorAuthority(db,user);
  if(emperor.isCourtEmperor)return{...emperor,isCourtRegent:false,canActForEmperor:true};
  const regent=await courtRegentAuthority(db,user,roleCommitGuard);
  return{...regent,isCourtEmperor:false,canActForEmperor:regent.isCourtRegent};
}
async function courtDutyAuthority(db,user){
  if(user.court_retained_term){const guard=roleCommitGuard(user);guard.sql+=' AND EXISTS(SELECT 1 FROM court_retained_memberships WHERE user_id=? AND term_id=?)';guard.args.push(user.id,user.court_retained_term);return{canManageCourtEvents:true,guard};}
  if(user.is_admin||user.is_staff)return{canManageCourtEvents:true,guard:roleCommitGuard(user)};
  const regent=await courtRegentAuthority(db,user,roleCommitGuard);
  return{canManageCourtEvents:regent.isCourtRegent,guard:regent.guard};
}
async function courtAttackAuthority(db,user,sourceCastleId,targetCastleId){
  if(sourceCastleId!=='kyoto_gosho'||targetCastleId!=='edo')return{sql:'1=1',args:[]};
  const access=await courtImperialAuthority(db,user);if(!access.canActForEmperor)fail(403,'COURT_EDO_ATTACK_REQUIRED',COURT_EDO_REASON);
  return access.guard;
}
function staffInitialState(elapsed) {
  const game=new GameEngine({officers:GAME_OFFICERS,isStaff:true,seed:1});
  const initial={castleLevel:1,buildings:copy(game.state.buildings)};
  return {initial,castleLevel:1,buildings:copy(initial.buildings),jobs:[],history:[],createdElapsedMs:elapsed,updatedElapsedMs:elapsed};
}
async function sharedStaffBaseRow(db,clock,now) {
  let row=await stmt(db,"SELECT * FROM staff_base WHERE id='kyoto_gosho'").first();
  if(!row){await stmt(db,"INSERT INTO staff_base(id,state_json,updated_at) VALUES('kyoto_gosho',?,?) ON CONFLICT(id) DO NOTHING",JSON.stringify(staffInitialState(clock.elapsedMs)),now).run();row=await stmt(db,"SELECT * FROM staff_base WHERE id='kyoto_gosho'").first();}
  for(let attempt=0;attempt<3;attempt++){
    const state=JSON.parse(row.state_json),due=state.jobs.filter(job=>job.completesElapsedMs<=clock.elapsedMs).sort((a,b)=>a.completesElapsedMs-b.completesElapsedMs);
    if(!due.length)return row;
    for(const job of due){if(job.kind==='castle')state.castleLevel=job.targetLevel;else state.buildings[job.id]=job.targetLevel;state.history.push({jobId:job.jobId,kind:job.kind,id:job.id,level:job.targetLevel,effectiveElapsedMs:job.completesElapsedMs,startedBy:job.startedBy});state.updatedElapsedMs=job.completesElapsedMs;}
    state.history.sort((a,b)=>a.effectiveElapsedMs-b.effectiveElapsedMs);state.jobs=state.jobs.filter(job=>job.completesElapsedMs>clock.elapsedMs);
    const nonce=crypto.randomUUID(),gate="EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND commit_token=?)";
    const statements=[stmt(db,"UPDATE staff_base SET state_json=?,revision=revision+1,commit_token=?,updated_at=? WHERE id='kyoto_gosho' AND revision=? AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) RETURNING *",JSON.stringify(state),nonce,now,row.revision,WORLD_CLOCK_ID,clock.revision)];
    for(const job of due){const name=job.kind==='castle'?'京都御所':globalThis.SENGOKU_DATA.buildings.find(b=>b.id===job.id).name;statements.push(achievementStatement(db,job.startedBy.id,{key:'staff-build:'+job.jobId,kind:'staff-building',targetId:job.id,targetName:name,value:job.targetLevel,title:`京都御所の${job.kind==='castle'?'城郭':name} Lv.${job.targetLevel}の共同普請を達成`,detail:'京都御所の共同領地へ成長が反映されました。'},now,gate,[nonce]));statements.push(stmt(db,`INSERT INTO court_contributions(job_id,actor_id,staff_term,kind,target_id,target_level,points,completed_elapsed_ms,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${gate} ON CONFLICT(job_id) DO NOTHING`,job.jobId,job.startedBy.id,job.startedBy.termId||null,job.kind,job.id,job.targetLevel,job.targetLevel,job.completesElapsedMs,now,nonce));}
    statements.push(...courtEstateSnapshotStatements(db,clock,gate,[nonce]));
    const result=await db.batch(statements);if(rows(result[0])[0])return rows(result[0])[0];row=await stmt(db,"SELECT * FROM staff_base WHERE id='kyoto_gosho'").first();clock=await getWorldClock(db,now);
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
  return {id:'kyoto_gosho',revision:Number(row.revision),protected:true,...state,accessSinceElapsedMs:accessSince,clanSinceElapsedMs:clanSince,...(personal?{personalClan:personal.clan,personalHome:personal.home,personalCycleHome:personal.cycle?.home||personal.home,personalHomeCastle,personalBaseCastle:copy(personal.castles.kyoto_gosho||initialCastle('kyoto_gosho'))}:{})};
}
async function courtEstateContext(db,user,save,clock,now){const context=await readCourtEstateContext(db,user,save,clock,now,{staffBaseDto,hash});if(context.projection)courtEstateProjectionGuards.set(context.projection,context.guard);return context;}
async function tradeTroopCapacity(db,user,save,clock,now) {
  const staffBase=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
  const estateEconomy=await courtEstateContext(db,user,save,clock,now);
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase});
  return game.troopTransportCapacity();
}
function renameCampaignClan(state,clan) {if(state.clan===clan)return;const previous=state.clan;for(const castle of Object.values(state.castles)){if(castle.owner===previous)castle.owner=clan;else if(castle.owner===clan)castle.owner='在地衆';}state.clan=clan;delete state.treaties[clan];}
// A lost personal home can retreat to a castle that belongs to another clan
// in the staff campaign. Only the player's own garrison and upgrades survive.
function restoredHomeCastle(current,personal,owningClan) {
  if(current.owner!==owningClan)return {...personal};
  return {...personal,troops:Math.max(current.troops,personal.troops),wall:Math.max(current.wall,personal.wall),level:Math.max(current.level,personal.level),...(current.durability?{durability:copy(current.durability)}:{})};
}
function restorePersonalCampaign(save,backup,user) {
  const s=save.state,original=JSON.parse(backup.save_json).state;renameCampaignClan(s,CLAN_HOMES[original.clan]?original.clan:ORDINARY_TOKUGAWA_CLAN);
  const released=new Set(releasedCastleIds(s)),usable=id=>CASTLE_BY_ID[id]&&!['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(id)&&!released.has(id);
  let home=original.home;if(['edo','kyoto_gosho'].includes(home))home=CLAN_HOMES[s.clan]||'kiyosu';
  if(released.has(home))home=CASTLES.find(c=>usable(c.id)&&s.castles[c.id].owner===s.clan)?.id||[CLAN_HOMES[s.clan],'kiyosu'].find(usable)||CASTLES.find(c=>usable(c.id))?.id||home;
  if(!released.has(home)){
    const personal=original.castles[released.has(original.home)?home:original.home],restored=restoredHomeCastle(s.castles[home],personal,s.clan);
    s.castles[home]={...restored,owner:s.clan,wall:Math.max(restored.wall,s.buildings.wall),level:Math.min(castleLevelLimit(home),restored.level)};
  }
  s.home=home;if(s.cycle)s.cycle.home=['edo','kyoto_gosho'].includes(original.cycle?.home)||released.has(original.cycle?.home)?home:original.cycle?.home||home;
  const def=globalThis.SENGOKU_DATA.castles.find(c=>c.id==='kyoto_gosho');s.castles.kyoto_gosho={owner:def.clan===s.clan?'在地衆':def.clan,troops:def.initialTroops,wall:def.wall,level:1};
  s.captureRewards=[...new Set([...s.captureRewards.filter(id=>id!=='kyoto_gosho'),...(!released.has(home)?[home]:[])])];
  s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.id!=='kyoto_gosho');
  for(const job of s.jobs)if(job.kind==='castle'&&job.id===home)job.targetLevel=s.castles[home].level+1;
  s.jobs=s.jobs.filter(job=>job.kind!=='castle'||job.targetLevel<=castleLevelLimit(job.id));
  s.governors=Object.fromEntries(Object.entries(s.governors).filter(([id])=>s.buildings[id]>0));s.command=Math.min(s.command,3+Math.floor(s.buildings.keep/8));s.gameOver=!CASTLES.some(c=>s.castles[c.id].owner===s.clan);
  return save;
}
// Personal campaign development is retained separately from the shared base.
// This metadata never grants a role, and every write is gated by the parent
// save mutation, so failed/replayed operations cannot change either copy.
// Server-evaluated progress carries exact surviving troops, including upkeep
// reductions; only a plain legacy save retains the older growth-only merge.
async function staffPersonalProgressStatement(db,user,save,now,gate,gateArgs,progress=null,capture=null,{exactHomeTroops=Boolean(progress),committedCastleId=null,releasedCastleId=null}={}) {
  const backup=await stmt(db,'SELECT * FROM staff_campaign_backups WHERE user_id=? AND active=1',user.id).first();if(!backup)return null;
  const personal=JSON.parse(backup.save_json),home=personal.state.home,old=personal.state.castles[home];
  const current=committedCastleId===home?save.state.castles[home]:progress?.home===home?progress.castle:save.state.castles[home];
  if(current&&(current.owner===save.state.clan||progress&&current.owner===personal.state.clan)){for(const key of ['level','wall'])old[key]=Math.max(old[key],current[key]);old.troops=exactHomeTroops?current.troops:Math.max(old.troops,current.troops);
    // A battle modifies the exported save after the journey's private progress
    // snapshot. Its committed structural damage must win over that older view.
    const committed=save.state.castles[home],condition=committed?.owner===save.state.clan?committed.durability:current.durability;if(condition)old.durability=copy(condition);
  }
  old.level=Math.min(castleLevelLimit(home),old.level);
  // A staff member's original home can also be a public outpost. Its loss must
  // reach the personal metadata in this same transaction, or dismissal would
  // recreate that city from the original appointment backup.
  if(capture){const lost=personal.state.castles[capture.castleId];if(home===capture.castleId)for(const key of ['level','wall','troops',...(capture.castle.durability?['durability']:[])])lost[key]=capture.castle[key];fieldLoseCastle(personal.state,capture.castleId,capture.fallbackHomeId);}
  if(releasedCastleId)releasePersonalCastle(personal.state,releasedCastleId);
  return stmt(db,`UPDATE staff_campaign_backups SET save_json=?,updated_at=? WHERE user_id=? AND active=1 AND term_id=? AND ${gate}`,JSON.stringify(personal),now,user.id,backup.term_id,...gateArgs);
}
async function advanceDepartingStaff(db,row,user,backup,now,clock) {
  const until=Math.min(clock.elapsedMs,Number(backup.left_elapsed_ms??(user.staff_term!==backup.term_id?user.staff_since_ms:null)??clock.elapsedMs));
  const historical={...user,is_admin:false,is_staff:1,is_sento:false,staff_term:backup.term_id},save=normalizeGameSave(JSON.parse(row.save_json),historical,now,{reading:true,clock});
  if(save.state.worldClock&&save.state.worldClock.elapsedMs>=until)return row;
  await reconcileCovertProgress(db,user.id,save);
  const branchAccess=await branchStateGuard(db,user.id,save.state.walking.campaignId);await reconcileBranchProgress(db,user.id,save,{...clock,elapsedMs:until});
  const maintenanceAuthority=protectMaintenance(branchAccess,await maintenanceContext(db,user.id,save,clock));
  const estateEconomy=await courtEstateContext(db,user,save,clock,now);
  const base=await staffBaseDto(db,historical,clock,now),game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isStaff:true,isCourtProtected:!!user.is_court_protected,staffBase:base,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branchAccess.resolvedElapsedMs}});
  const result=game.applyWorldClock({...clock,elapsedMs:until},{maxSeconds:86400});
  if((result.maintenancePending||result.courtEstatePending)&&!result.changed)fail(409,'STAFF_TRANSITION_PENDING','スタッフ任期中の進行を引き継いでいます。自動同期で続きを反映します。');
  if(!result.ok||!result.changed)return row;
  const next=normalizeGameSave(JSON.parse(game.exportSave()),historical,now,{reading:true,clock}),nonce=crypto.randomUUID(),roleGuard=withCourtEstateGuard(roleCommitGuard(user),estateEconomy),rewards=result.cycleRewards||[];
  const gate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)',args=[user.id,nonce];
  const statements=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_index=?,cycle_home=?,cycle_commit=?
    WHERE user_id=? AND revision=? AND ${roleGuard.sql} AND ${branchAccess.guard.sql} AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND active=1 AND term_id=?)
    AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)
    AND NOT EXISTS(SELECT 1 FROM cycle_receipts WHERE user_id=? AND cycle_index>=? AND cycle_index<?) RETURNING *`,JSON.stringify(next),now,next.state.cycle.index,next.state.cycle.home,nonce,user.id,row.revision,...roleGuard.args,...branchAccess.guard.args,user.id,backup.term_id,WORLD_CLOCK_ID,clock.revision,user.id,save.state.cycle.index,next.state.cycle.index)];
  statements.push(...covertIncidentStatements(db,user.id,next,now,gate,args));
  statements.push(...branchProgressStatements(db,user.id,next,now,gate,args));
  const personal=await staffPersonalProgressStatement(db,user,next,now,gate,args,game.getStaffPersonalProgress?.());if(personal)statements.push(personal);
  for(const event of saveAchievements(save,next))statements.push(achievementStatement(db,user.id,event,now,gate,args));
  for(const reward of rewards){statements.push(stmt(db,`INSERT INTO cycle_receipts(user_id,cycle_index,captured,gold,rice,magatama,commit_token,created_at) SELECT ?,?,?,?,?,?,?,? WHERE ${gate}`,user.id,reward.cycle,reward.captured,reward.gold,reward.rice,reward.magatama,nonce,now,...args));if(reward.captured)statements.push(achievementStatement(db,user.id,cycleEvent(reward),now,gate,args));}
  if(rewards.length)statements.push(stmt(db,`DELETE FROM field_relations WHERE (user_a=? OR user_b=?) AND updated_elapsed_ms<? AND ${gate}`,user.id,user.id,next.state.cycle.index*WORLD_CYCLE_MS,...args));
  const changed=rows((await db.batch(statements))[0])[0];
  if(!changed)fail(409,'STAFF_ROLE_CHANGED','役職と個人進行が更新されました。もう一度同期してください。');
  if(result.pending||(result.maintenancePending||result.courtEstatePending)&&next.state.worldClock.elapsedMs<until)fail(409,'STAFF_TRANSITION_PENDING','スタッフ任期中の進行を引き継いでいます。自動同期で続きを反映します。');
  return changed;
}

async function ensureStaffCampaign(db,user,now,clock=undefined,{deferClanMigration=false}={}) {
  const account=user,access=accountCommitGuard(user);
  clock=clock||await getWorldClock(db,now);let row=await getSyncRow(db,user.id);if(!row?.save_json)return row;
  for(let attempt=0;attempt<3;attempt++){
    await requireAccountAccess(db,account);
    const staff=!!user.is_staff&&!user.is_admin&&!user.is_sento;let backup=await stmt(db,'SELECT * FROM staff_campaign_backups WHERE user_id=?',user.id).first();
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
      if(!backup?.active&&raw.state.clan===ADMIN_CLAN&&raw.state.home==='kyoto_gosho')renameCampaignClan(raw.state,CLAN_HOMES[user.clan]?user.clan:ORDINARY_TOKUGAWA_CLAN);
      personal=backup?.active?restorePersonalCampaign(normalizeGameSave(raw,{...user,is_admin:false,is_staff:true,is_sento:false},now,{reading:true,clock}),backup,user):normalizeGameSave(raw,{...user,is_staff:false},now,{reading:true,clock});
      saved=normalizeGameSave(personal,user,now,{reading:true,clock});saved.state.staffService={baseId:'kyoto_gosho'};saved.savedAt=iso(now);
      const joined=Math.max(Number(user.staff_since_ms??clock.elapsedMs),Number(personal.state.worldClock?.elapsedMs||0));
      const result=await db.batch([
        stmt(db,`INSERT INTO staff_campaign_backups(user_id,term_id,save_json,joined_elapsed_ms,left_elapsed_ms,active,transition_token,updated_at)
          SELECT ?,?,?,?,NULL,1,?,? WHERE ${STAFF_MEMBER_GUARD} AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND ${access.sql}
          ON CONFLICT(user_id) DO UPDATE SET term_id=excluded.term_id,save_json=excluded.save_json,joined_elapsed_ms=excluded.joined_elapsed_ms,left_elapsed_ms=NULL,active=1,transition_token=excluded.transition_token,updated_at=excluded.updated_at`,user.id,user.staff_term,JSON.stringify(personal),joined,nonce,now,user.id,user.staff_term,user.id,user.id,row.revision,...access.args),
        stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home='kyoto_gosho' WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND transition_token=?) RETURNING *`,JSON.stringify(saved),now,user.id,row.revision,user.id,nonce)
      ]);if(rows(result[1])[0])return rows(result[1])[0];
    }else{
      saved=restorePersonalCampaign(normalizeGameSave(raw,{...user,is_admin:false,is_staff:true,is_sento:false},now,{reading:true,clock}),backup,user);saved=normalizeGameSave(saved,user,now,{reading:true,clock});saved.savedAt=iso(now);
      const result=await db.batch([
        stmt(db,`UPDATE staff_campaign_backups SET active=0,transition_token=?,updated_at=? WHERE user_id=? AND active=1 AND term_id=?
          AND (NOT EXISTS(SELECT 1 FROM staff_members WHERE user_id=?) OR EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?) OR EXISTS(SELECT 1 FROM court_retirement_holders WHERE user_id=staff_campaign_backups.user_id))
          AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND ${access.sql}`,nonce,now,user.id,backup.term_id,user.id,user.id,user.id,row.revision,...access.args),
        stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home=? WHERE user_id=? AND revision=? AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND transition_token=?) RETURNING *`,JSON.stringify(saved),now,saved.state.cycle?.home||saved.state.home,user.id,row.revision,user.id,nonce),
        stmt(db,`UPDATE users SET clan=? WHERE id=? AND EXISTS(SELECT 1 FROM staff_campaign_backups WHERE user_id=? AND transition_token=?)`,saved.state.clan,user.id,user.id,nonce)
      ]);if(rows(result[1])[0])return rows(result[1])[0];
    }
    user=await getUser(db,user.id);row=await getSyncRow(db,user.id);
  }
  fail(409,'STAFF_ROLE_CHANGED','スタッフの役職と本拠を再確認してください。');
}
async function staffBaseUpgrade(db,user,raw,now,estateAccess=null) {
  const estate=!!estateAccess,estateHelpers={requireAccountAccess,fail},requireCurrent=async()=>{if(estate)await assertCourtEstateAccess(db,user,estateAccess,estateHelpers);else await requireCurrentStaffBase(db,user);};
  if(estate)await requireCurrent();else if(!user.is_staff||user.is_admin)fail(403,'STAFF_BASE_REQUIRED','スタッフとして京都御所へ接続してください。');
  if(!raw||Array.isArray(raw)||Object.keys(raw).some(k=>!['kind','id','requestId','deviceId','expectedRevision','baseRevision',...(estate?['accessStamp']:[])].includes(k))||!['building','castle'].includes(raw.kind))fail(400,'INVALID_INPUT','共同普請の指定が正しくありません。');
  const body={...raw,id:idField(raw.kind==='castle'&&raw.id==='sunpu'?'kyoto_gosho':raw.id,'普請する施設'),requestId:idField(raw.requestId,'操作番号'),deviceId:idField(raw.deviceId,'端末')};
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0||!Number.isSafeInteger(body.baseRevision)||body.baseRevision<0||body.kind==='castle'&&body.id!=='kyoto_gosho'||body.kind==='building'&&!BUILDINGS.some(b=>b.id===body.id))fail(400,'INVALID_INPUT','共同普請の対象と更新番号を確認してください。');
  if(estate&&body.accessStamp!==estateAccess.accessStamp)fail(409,'COURT_ESTATE_ACCESS_CHANGED','京都御所の共同領有資格が変わりました。最新の役職を確認してください。');
  const digest=await hash(JSON.stringify(estate?['court-estate-v1',body.kind,body.id,body.baseRevision,body.accessStamp]:[body.kind,body.id,body.baseRevision])),legacyDigest=!estate&&body.kind==='castle'?await hash(JSON.stringify([body.kind,'sunpu',body.baseRevision])):digest;
  const prior=await stmt(db,'SELECT * FROM staff_base_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();
  if(prior){await requireCurrent();if(![digest,legacyDigest].includes(prior.request_hash))fail(409,'REQUEST_ID_REUSED','この操作番号は別の共同普請に使われています。');return {...await syncSnapshot(db,await getSyncRow(db,user.id),user,body.deviceId,now),receipt:JSON.parse(prior.result_json),idempotent:true};}
  await budget(db,'staff-build:'+user.id,30,60000,now);
  const row=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now),clock=await getWorldClock(db,now);
  if(!clock.running)fail(409,'WORLD_PAUSED','共通時間を再開してから普請してください。');
  const shared=await sharedStaffBaseRow(db,clock,now);if(Number(shared.revision)!==body.baseRevision)fail(409,'STAFF_BASE_CHANGED','別のスタッフが共同拠点を更新しました。最新の京都御所を確認してください。');
  const base=await staffBaseDto(db,user,clock,now,shared),save=normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock});
  if(!save.state.worldClock||clock.elapsedMs-save.state.worldClock.elapsedMs>15000)fail(409,'CLOCK_STALE','共通時刻と個人資源へ同期してから普請してください。');
  const estateEconomy=await courtEstateContext(db,user,save,clock,now);
  if(estateEconomy.projection?.asOfElapsedMs<clock.elapsedMs)fail(409,'COURT_ESTATE_REFRESH_REQUIRED',COURT_ESTATE_REFRESH_MESSAGE);
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isStaff:!!user.is_staff,isDeputy:!!user.is_deputy,isCourtProtected:!!user.is_court_protected,staffBase:user.is_staff&&!user.is_admin?base:null});if(game.isStaff)game._projectStaffAt(clock.elapsedMs);
  const pricing=estate?courtEstatePricingGame(save,user,base,clock,estateEconomy.projection):game;
  const state=JSON.parse(shared.state_json),chain=state.jobs.filter(j=>j.kind===body.kind&&j.id===body.id).sort((a,b)=>a.targetLevel-b.targetLevel),tail=chain.at(-1),level=body.kind==='castle'?state.castleLevel:tail?.targetLevel??state.buildings[body.id],max=body.kind==='castle'?128:32;
  if(level>=max)fail(409,'BUILDING_MAX','最高レベルに到達しています。');
  if(body.kind==='castle'&&chain.length)fail(409,'STAFF_BUILDING_BUSY','この城郭の共同普請は進行中です。');
  if(!chain.length&&new Set(state.jobs.map(j=>j.kind+':'+j.id)).size>=2+Math.floor(state.buildings.keep/8))fail(409,'STAFF_BUILDING_SLOTS','共同普請の枠が埋まっています。');
  if(body.kind==='building'&&!pricing.buildingUnlock(body.id).ok)fail(409,'BUILDING_LOCKED',pricing.buildingUnlock(body.id).reason);
  const cost=body.kind==='castle'?pricing.castleUpgradeCost('kyoto_gosho'):pricing.costs(body.id,level);if(game.state.command<1)fail(409,'COMMAND_REQUIRED','指示の回復をお待ちください。');
  if(RESOURCES.some(k=>game.state.resources[k]<(cost[k]||0)))fail(409,'INSUFFICIENT_ASSETS','共同普請に必要な個人資源が足りません。');
  const startedElapsedMs=tail?Math.max(clock.elapsedMs,tail.completesElapsedMs):clock.elapsedMs;
  game._pay(cost);game.state.command--;const job={jobId:uid('sb_'),kind:body.kind,id:body.id,targetLevel:level+1,totalSeconds:cost.seconds,queuedAtElapsedMs:clock.elapsedMs,startedElapsedMs,completesElapsedMs:startedElapsedMs+cost.seconds*1000,startedBy:{id:user.id,name:user.name,termId:user.court_retained_term||user.staff_term}};
  state.jobs.push(job);state.updatedElapsedMs=clock.elapsedMs;
  const receipt={requestId:body.requestId,jobId:job.jobId,staffTerm:user.court_retained_term||user.staff_term,...(estate?{accessStamp:estateAccess.accessStamp}:{}),kind:body.kind,id:body.id,targetLevel:job.targetLevel,cost:pick(cost,RESOURCES),queued:job.startedElapsedMs>clock.elapsedMs,queuePosition:chain.length,queuedAtElapsedMs:clock.elapsedMs,startedElapsedMs:job.startedElapsedMs,completesElapsedMs:job.completesElapsedMs,baseRevision:Number(shared.revision)+1,playerRevision:Number(row.revision)+1};
  game.log(`京都御所の${body.kind==='castle'?'城郭':globalThis.SENGOKU_DATA.buildings.find(b=>b.id===body.id).name} Lv.${job.targetLevel}へ共同普請を${receipt.queued?'予約':'開始'}しました。`,'staff-build');
  const next=normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),gate='EXISTS(SELECT 1 FROM staff_base_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',gateArgs=[user.id,body.requestId,nonce],access=withCourtEstateGuard(accountCommitGuard(user),estateEconomy),constructionGuard=estate?estateAccess.guard:{sql:STAFF_MEMBER_GUARD,args:[user.id,user.staff_term,user.id]};
  const result=await db.batch([
    stmt(db,`INSERT INTO staff_base_requests(actor_id,request_id,request_hash,commit_token,result_json,created_at)
      SELECT ?,?,?,?,?,? FROM player_saves ps JOIN staff_base sb ON sb.id='kyoto_gosho'
      WHERE ps.user_id=? AND ps.revision=? AND ps.writer_device_id=? AND ps.lease_expires_at>? AND sb.revision=?
      AND ${constructionGuard.sql} AND ${access.sql} AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1)
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,nonce,JSON.stringify(receipt),now,user.id,row.revision,body.deviceId,now,shared.revision,...constructionGuard.args,...access.args,WORLD_CLOCK_ID,clock.revision),
    stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,now+SYNC_LEASE,user.id,...gateArgs),
    stmt(db,`UPDATE staff_base SET state_json=?,revision=revision+1,commit_token=?,updated_at=? WHERE id='kyoto_gosho' AND ${gate}`,JSON.stringify(state),nonce,now,...gateArgs)
  ]);
  if(!rows(result[0]).length){const accepted=await stmt(db,'SELECT * FROM staff_base_requests WHERE actor_id=? AND request_id=?',user.id,body.requestId).first();if(accepted&&accepted.request_hash===digest){await requireCurrent();return {...await syncSnapshot(db,await getSyncRow(db,user.id),await getUser(db,user.id),body.deviceId,now),receipt:JSON.parse(accepted.result_json),idempotent:true};}await requireCurrent();fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);fail(409,'STAFF_BASE_CHANGED','共同拠点が更新されました。最新の状態を確認してください。');}
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
  const rewards=Object.fromEntries([...RESOURCES,'magatama'].map(k=>[k,Math.min(100000000-(k==='magatama'?s.magatama:s.resources[k]),delta*2)]));
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
// Only a trusted prior checkpoint may prove CPU damage or parent loss. Imported
// branch flags, RNG seeds and ownership changes are never combat evidence.
function guardDefenseCheckpoint(save,clock){
  const submitted=save.state.worldClock?.elapsedMs;
  const submittedTurn=Math.floor(submitted/WORLD_MONTH_MS);
  if(Number.isSafeInteger(submitted)&&submittedTurn>Math.floor(clock.elapsedMs/WORLD_MONTH_MS)&&GameEngine.cpuTurnDue(submittedTurn)){
    // Retain the last trusted RNG and garrisons until this month's CPU turn
    // can be replayed. A retry may submit the same local actions and revision.
    fail(409,'DEFENSE_CLOCK_PENDING','城の防衛を共通時刻で確定してから、自動保存を再開します。');
  }
}
async function resolveSyncBranches(db,user,save,before,clock,now,{importedStationedTroops=false}={}){
  const campaignId=save.state.walking.campaignId,access=await branchStateGuard(db,user.id,campaignId),movement=await troopTransferGuard(db,user.id,campaignId);
  if(!access.row&&(importedStationedTroops||save.state.branches.some(branch=>Number(branch.stationedTroops)>0)))fail(409,'TROOP_IMPORT_RECALL_REQUIRED','初回の同期前に支拠点の駐留兵を本隊または自領の城へ戻してください。接続済みの場合は、端末同期で領主データを書き出してからこの端末の接続を解除し、兵を戻した後に同じ領主データで再接続できます。現在の端末の保存は保持しています。');
  if(movement.row||before?.state.walking.campaignId===campaignId){if((save.state.troopTransferSequence||0)!==movement.sequence)fail(409,'TROOP_STATE_CHANGED','兵の配置が更新されています。最新の保存へ同期してから、もう一度操作してください。');}
  else save.state.troopTransferSequence=0;
  let model=copy(access.state),resolvedElapsedMs=access.resolvedElapsedMs,replayed=null,shared=null,estateEconomy=null;
  const parentLosses=new Map();let ownershipCorrected=false;
  const incomingElapsed=Math.min(clock.elapsedMs,Number(save.state.worldClock?.elapsedMs||0));
  if(access.row&&model.branches.length&&before?.state.walking.campaignId===save.state.walking.campaignId&&before.state.worldClock){
    guardDefenseCheckpoint(save,clock);
    const trusted=copy(before);
    await reconcileCovertProgress(db,user.id,trusted);
    // A later field transaction can change a defense while its owner's ordinary
    // checkpoint remains older. Rebase this branch-only simulation at that last
    // authoritative transition; never apply today's fallen state to past raids.
    // The branch cursor survives imports independently of the private clock.
    // Neither older branch data nor a changed save may replay a raid twice.
    const start=Math.max(resolvedElapsedMs,Number(before.state.worldClock.elapsedMs)),target=Math.max(start,incomingElapsed);
    trusted.state.worldClock={id:WORLD_CLOCK_ID,elapsedMs:start};trusted.state.turn=Math.floor(start/WORLD_MONTH_MS);trusted.state.realtime.elapsed=start%WORLD_MONTH_MS/1000;trusted.state.upkeep.settledTurn=Math.min(trusted.state.upkeep.settledTurn,trusted.state.turn);
    applyBranchProgress(trusted,model,{...clock,elapsedMs:start});
    shared=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
    const maintenanceAuthority=protectMaintenance(access,await maintenanceContext(db,user.id,trusted,clock));
    estateEconomy=await courtEstateContext(db,user,trusted,clock,now);
    const game=GameEngine.fromSave(trusted,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared,maintenanceAuthority});
    // This replay proves branch/CPU transitions from an older checkpoint. The
    // complete incoming campaign is balanced only after every ledger is merged.
    const result=game.applyWorldClock({...clock,elapsedMs:target},{maxSeconds:86400,deferCycleSettlement:true,rebalanceTroops:false});
    if(!result.ok||result.pending||result.courtEstatePending||result.settlementRequired||result.maintenancePending&&game.state.worldClock.elapsedMs<target)fail(409,'BRANCH_CLOCK_STALE','支拠点の時間経過を同期しています。最新の保存へ同期してください。');
    replayed=JSON.parse(game.exportSave());
    reconcileOfficerHealth(save,replayed,clock);
    for(const loss of game.takeBranchParentLosses())parentLosses.set(loss.parentCastleId,loss);
    model={branches:copy(replayed.state.branches),jobs:copy(replayed.state.jobs.filter(job=>job.kind==='branch'))};
    resolvedElapsedMs=Math.max(resolvedElapsedMs,Math.min(clock.elapsedMs,replayed.state.worldClock.elapsedMs));
  }else resolvedElapsedMs=Math.max(resolvedElapsedMs,incomingElapsed);
  // Correct only the branch/parent relationship; preserve ordinary imported
  // progress. Local actions can consume RNG between saves, so conflicting CPU
  // predictions must not leave the writer retrying an unchanged old snapshot.
  if(!user.is_admin){const roleModel={...save.state,branches:model.branches.filter(branch=>branch.parentCastleId==='edo'),jobs:model.jobs.filter(job=>branchSite(job.id)?.parentCastleId==='edo')};GameEngine.pruneBranchState(roleModel,{isAdmin:false});model={branches:[...model.branches.filter(branch=>branch.parentCastleId!=='edo'),...roleModel.branches],jobs:[...model.jobs.filter(job=>branchSite(job.id)?.parentCastleId!=='edo'),...roleModel.jobs]};}
  const parents=new Set(access.state.branches.filter(branch=>!branch.retreating&&(user.is_admin||branch.parentCastleId!=='edo')).map(branch=>branch.parentCastleId));
  for(const parent of parents){
    const retained=model.branches.some(branch=>branch.parentCastleId===parent&&!branch.retreating),trustedOwned=retained||!!replayed&&replayed.state.castles[parent].owner===replayed.state.clan,incomingOwned=save.state.castles[parent].owner===save.state.clan;
    if(trustedOwned&&!incomingOwned){save.state.castles[parent].owner=save.state.clan;ownershipCorrected=true;}
    else if(!trustedOwned&&incomingOwned){
      // Retain a client's independently progressed parent only with the exact
      // already-fallen defenses observed immediately before the proved CPU
      // capture. Never reconstruct an earlier intact branch/canceled upgrade.
      const loss=parentLosses.get(parent);
      if(!loss||loss.branches.some(branch=>branch.level>0&&!branch.fallen))fail(409,'BRANCH_PARENT_CHANGED','この支拠点の領有状態を確認できません。現在の役職と最新データへ同期してください。');
      model.branches=model.branches.filter(branch=>branch.parentCastleId!==parent);model.jobs=model.jobs.filter(job=>branchSite(job.id)?.parentCastleId!==parent);model.branches.push(...copy(loss.branches));model.jobs.push(...copy(loss.jobs));ownershipCorrected=true;
    }
  }
  if(ownershipCorrected){
    const owned=CASTLES.filter(c=>save.state.castles[c.id].owner===save.state.clan);
    if(owned.length&&save.state.castles[save.state.home].owner!==save.state.clan)save.state.home=owned.find(c=>c.id===before?.state.home)?.id||owned[0].id;
    save.state.gameOver=!owned.length;save.state.realtime.running=clock.running&&!save.state.gameOver;
  }
  applyBranchProgress(save,model,clock,{pruneOwners:false});
  if(save.state.branches.some(branch=>(branch.commanders||[]).some(id=>save.state.army.includes(id))))fail(400,'INVALID_SAVE','本隊と支拠点には別の武将を配置してください。');
  const guard=access.row?{sql:`EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)${shared?" AND EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)":''}`,args:[WORLD_CLOCK_ID,clock.revision,...(shared?[shared.revision]:[])]}:{sql:'1=1',args:[]};
  guard.sql+=' AND '+movement.guard.sql;guard.args.push(...movement.guard.args);
  return{access,resolvedElapsedMs,replayed,guard:estateEconomy?withCourtEstateGuard(guard,estateEconomy):guard};
}
// A shared seat may change only from a server-simulated home defense, never
// from the ownership, home, game-over flag or log of an uploaded save.
async function resolveSyncResidency(db,user,save,before,clock,now,branchAccess){
  await ensureResidency(db,now);
  const member=await stmt(db,'SELECT m.*,cs.lord_user_id,cs.lord_epoch,cs.lord_since_elapsed_ms FROM castle_residents m JOIN castle_seats cs ON cs.castle_id=m.castle_id WHERE m.user_id=?',user.id).first();
  const empty={guard:{sql:'1=1',args:[]},statements:()=>[]};if(!member||user.is_admin||user.is_sento||user.is_staff||user.is_deputy)return empty;
  const seatGuard={sql:'EXISTS(SELECT 1 FROM castle_seats WHERE castle_id=? AND lord_epoch=? AND COALESCE(lord_user_id,\'\')=?)',args:[member.castle_id,member.lord_epoch,member.lord_user_id||'']};
  const campaignId=save.state.walking.campaignId,sameCampaign=before?.state.walking.campaignId===campaignId;
  if(!sameCampaign&&save.state.home!==member.castle_id)fail(409,'RESIDENCY_HOME_CHANGED','仕える城・領主の席を変更するときは「城下町 → 本拠を移す」から城を選んでください。');
  // A forged same-campaign home cannot redirect the next cycle's reset.
  save.state.cycle.home=member.castle_id;
  const cursor=await stmt(db,'SELECT resolved_elapsed_ms FROM castle_residency_cpu_cursors WHERE user_id=? AND campaign_id=?',user.id,campaignId).first();
  let resolved=Math.max(Number(cursor?.resolved_elapsed_ms||0),Math.min(clock.elapsedMs,Number(save.state.worldClock?.elapsedMs||0))),events=[],provenState=null,durabilityState=null;
  if(sameCampaign&&before.state.worldClock){
    if(member.lord_user_id===user.id)guardDefenseCheckpoint(save,clock);
    const trusted=copy(before),start=Math.max(Number(before.state.worldClock.elapsedMs),Number(cursor?.resolved_elapsed_ms||0),Number(branchAccess.resolvedElapsedMs||0)),target=Math.max(start,Math.min(clock.elapsedMs,Number(save.state.worldClock?.elapsedMs||0)));
    trusted.state.worldClock={id:WORLD_CLOCK_ID,elapsedMs:start};trusted.state.turn=Math.floor(start/WORLD_MONTH_MS);trusted.state.realtime.elapsed=start%WORLD_MONTH_MS/1000;trusted.state.upkeep.settledTurn=Math.min(trusted.state.upkeep.settledTurn,trusted.state.turn);
    await reconcileCovertProgress(db,user.id,trusted);applyBranchProgress(trusted,branchAccess.state,{...clock,elapsedMs:start});
    const maintenanceAuthority=protectMaintenance(branchAccess,await maintenanceContext(db,user.id,trusted,clock));
    const estateEconomy=await courtEstateContext(db,user,trusted,clock,now);
    Object.assign(seatGuard,withCourtEstateGuard(seatGuard,estateEconomy));
    const game=GameEngine.fromSave(trusted,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isCourtProtected:!!user.is_court_protected,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:start}}),advanced=game.applyWorldClock({...clock,elapsedMs:target},{maxSeconds:86400,deferCycleSettlement:true,rebalanceTroops:false});
    if(!advanced.ok||advanced.pending||advanced.courtEstatePending||advanced.settlementRequired||advanced.maintenancePending&&game.state.worldClock.elapsedMs<target)fail(409,'RESIDENCY_CLOCK_STALE','城の防衛を共通時刻へ同期しています。最新の保存を確認してください。');
    events=game.takeHomeDefenseLosses?.()||[];resolved=Math.max(resolved,target);
    reconcileOfficerHealth(save,{state:game.state},clock);durabilityState=game.state;
    if(events.some(event=>event.castleId===member.castle_id&&Number(event.occurredElapsedMs)>Number(member.lord_since_elapsed_ms)))provenState=game.state;
  }
  if(member.lord_user_id===user.id){
    const claimed=save.state.home!==member.castle_id||save.state.gameOver||save.state.castles[member.castle_id].owner!==save.state.clan;
    if(provenState&&!user.is_court_protected){
      const source=provenState.castles[member.castle_id];save.state.castles[member.castle_id].owner=source.owner===save.state.clan?'在地衆':source.owner;
      const remaining=CASTLES.filter(c=>save.state.castles[c.id].owner===save.state.clan),preferred=remaining.find(c=>c.id===provenState.home)||remaining[0];
      if(preferred)save.state.home=preferred.id;save.state.gameOver=!remaining.length;save.state.realtime.running=clock.running&&!save.state.gameOver;
      save.state.jobs=save.state.jobs.filter(job=>job.kind!=='castle'||job.id!==member.castle_id);
    }else if(claimed){
      save.state.castles[member.castle_id].owner=save.state.clan;save.state.home=member.castle_id;save.state.gameOver=false;save.state.realtime.running=clock.running;
    }
  }
  const losses=await prepareResidencyCpuLosses(db,{userId:user.id,events,now}),guard={sql:seatGuard.sql+' AND '+losses.guard.sql+' AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?)',args:[...seatGuard.args,...losses.guard.args,WORLD_CLOCK_ID,clock.revision]};
  return{guard,durabilityState,statements:(gate,args)=>[...losses.statements(gate,args),stmt(db,`INSERT INTO castle_residency_cpu_cursors(user_id,campaign_id,resolved_elapsed_ms) SELECT ?,?,? WHERE ${gate} ON CONFLICT(user_id,campaign_id) DO UPDATE SET resolved_elapsed_ms=MAX(resolved_elapsed_ms,excluded.resolved_elapsed_ms)`,user.id,campaignId,resolved,...args)]};
}

async function syncSnapshot(db,row,user,deviceId,now,{settle=false}={}) {
  const authenticated=user;await requireAccountAccess(db,authenticated);
  const clock=await getWorldClock(db,now);
  row=await ensureStaffCampaign(db,user,now,clock);user=await getUser(db,user.id);
  await requireAccountAccess(db,authenticated);
  row=await settlePlayerCycle(db,row,user,now,clock,{deferActive:!settle,writerDeviceId:settle?deviceId:null});
  const staffBase=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
  const current=await getUser(db,user.id);if(current.is_admin!==user.is_admin||current.staff_term!==user.staff_term||(current.deputy_term||'')!==(user.deputy_term||'')||!!current.is_court_protected!==!!user.is_court_protected)fail(409,'STAFF_ROLE_CHANGED','役職が更新されました。もう一度同期してください。');
  await requireAccountAccess(db,authenticated);
  const privateSave=row?.save_json?normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}):null;
  const cloisteredReward=await readCloisteredReward(db,user.id);
  if(privateSave)applyCloisteredReward(privateSave,cloisteredReward,fail);
  const maintenanceAuthority=(await maintenanceContext(db,user.id,privateSave,clock)).authority;
  let branchResolvedElapsedMs=0;
  if(privateSave){await restoreServerMarch(db,user.id,privateSave);await reconcileCovertProgress(db,user.id,privateSave);const branches=await branchStateGuard(db,user.id,privateSave.state.walking.campaignId);applyBranchProgress(privateSave,branches.state,clock);branchResolvedElapsedMs=branches.resolvedElapsedMs;}
  const estateEconomy=await courtEstateContext(db,user,privateSave,clock,now),role=roleCommitGuard(user);
  if(!await stmt(db,'SELECT 1 AS allowed WHERE '+role.sql+' AND '+estateEconomy.guard.sql,...role.args,...estateEconomy.guard.args).first())fail(409,'COURT_ESTATE_REFRESH_REQUIRED',COURT_ESTATE_REFRESH_MESSAGE);
  return {ok:true,user:mapUser(user,now),staffBase:publicStaffBase(staffBase),courtEstateProjection:estateEconomy.projection,cloisteredReward,save:privateSave,clock,maintenanceAuthority,branchResolvedElapsedMs,expulsion:await expulsionSnapshot(db,user.id),...await residencySnapshot(db,user.id,now,evaluationRef),
    revision:Number(row?.revision||0),updatedAt:row?.updated_at?iso(row.updated_at):null,
    writerDeviceId:row?.writer_device_id||null,writerDeviceName:row?.writer_device_name||null,
    leaseExpiresAt:row?.lease_expires_at?iso(row.lease_expires_at):null,serverTime:iso(now),
    writable:!!deviceId&&row?.writer_device_id===deviceId&&Number(row.lease_expires_at)>now,
    entitlements:{sentoGosho:!!user.is_sento,courtProtected:!!user.is_court_protected,courtEstate:!user.expulsion_pending&&(!!user.is_court_protected||!!user.is_staff),edo:!!user.is_admin,ieyasuU:!!user.is_admin,kagoshima:!!user.is_deputy,shimazuU:!!user.is_deputy&&!user.is_admin&&!user.is_staff}};
}

const FIELD_RULES=Object.freeze({minTroops:300,maxTroops:100000,commandCost:1,foodBase:150,foodPerTroop:.3,attackCooldownMs:60000,defenderProtectionMs:60000,proposalLifetimeMs:600000,allianceDurationMs:360000,maxLootPerResource:50000000,maxLootFraction:FIELD_LOOT_POLICY.fraction,lootFraction:FIELD_LOOT_POLICY.fraction,lootPolicy:FIELD_LOOT_POLICY.id,maxDefenderLossFraction:.1,operatorProtected:false,staffProtected:false,targetCastles:true,specialBaseBattles:true,occupiedTerritoryBattles:true,branchBattles:true,captureCastles:FIELD_CAPTURE_CASTLES,uncapturableCastles:['edo','kyoto_gosho','kagoshima','sento_gosho'],victoryRewards:{gold:0,rice:0,wood:0,stone:0},
  tactics:[{id:'balanced',name:'正攻法',food:1,modifier:1,loss:1},{id:'assault',name:'総攻撃',food:1.25,modifier:1.18,loss:1.35},{id:'siege',name:'包囲戦',food:1.65,modifier:.97,loss:.8},{id:'ambush',name:'伏兵',food:1.1,modifier:1.06,loss:.95}]});
// A new fixed home takes effect when the role changes, even while the stored save retains its former castle.
const FIELD_FIXED_HOME_SQL="(EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) OR u.id=(SELECT value FROM settings WHERE key='adminUserId') OR EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) OR EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id))";
const FIELD_SELECT=`SELECT u.id,u.name,u.clan,u.last_seen,${courtProtectionSql('u.id')} AS is_court_protected,s.revision,s.lease_expires_at,s.cycle_home,
  (SELECT castle_id FROM castle_residents WHERE user_id=u.id) AS household_id,
  (SELECT cs.lord_user_id FROM castle_seats cs JOIN castle_residents m ON m.castle_id=cs.castle_id WHERE m.user_id=u.id) AS household_lord,
  (SELECT cs.lord_epoch FROM castle_seats cs JOIN castle_residents m ON m.castle_id=cs.castle_id WHERE m.user_id=u.id) AS household_epoch,
  ${lordSupportSql('u.id')} AS retainer_support_json,${EFFECTIVE_CYCLE_SQL} AS cycle_index,json_extract(s.save_json,'$.state.cycle.home') AS original_home,json_extract(s.save_json,'$.state.staffService.baseId') AS service_base_id,json_extract(s.save_json,'$.state.imperialResidence.returnHome') AS imperial_return_home,
  json_extract(s.save_json,'$.state.cycle.protectedRegions') AS protected_regions_json,json_extract(s.save_json,'$.state.cycle.releasedCastles') AS released_castles_json,
  (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id) AS avatar_version,
  (SELECT bs.state_json FROM branch_states bs WHERE bs.actor_id=u.id AND bs.campaign_id=COALESCE(json_extract(s.save_json,'$.state.walking.campaignId'),'legacy_v1')) AS branches_json,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
  (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan,
  (SELECT json_extract(b.save_json,'$.state.home') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_home,
  (SELECT json_extract(b.save_json,'$.state.castles.'||json_extract(b.save_json,'$.state.home')) FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_castle_json,
  (SELECT json_extract(sb.state_json,'$.castleLevel') FROM staff_base sb WHERE sb.id='kyoto_gosho') AS staff_castle_level,
  (SELECT json_extract(sb.state_json,'$.buildings.keep') FROM staff_base sb WHERE sb.id='kyoto_gosho') AS staff_keep_level,
  (SELECT json_extract(sb.state_json,'$.buildings.wall') FROM staff_base sb WHERE sb.id='kyoto_gosho') AS staff_wall,
  (SELECT r.succession_id FROM court_retirement_holders r JOIN court_estate_current c ON c.user_id=r.user_id WHERE r.user_id=u.id) AS imperial_enhancement_token,
  CASE WHEN EXISTS(SELECT 1 FROM court_retirement_holders r JOIN court_estate_current c ON c.user_id=r.user_id WHERE r.user_id=u.id) THEN s.save_json END AS imperial_enhancement_save,
  CASE WHEN EXISTS(SELECT 1 FROM court_retirement_holders r JOIN court_estate_current c ON c.user_id=r.user_id WHERE r.user_id=u.id) THEN (SELECT state_json FROM staff_base WHERE id='kyoto_gosho') END AS imperial_enhancement_base,
  (SELECT revision FROM staff_base WHERE id='kyoto_gosho') AS imperial_enhancement_base_revision,
  EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
  (SELECT ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS deputy_term,
  (SELECT MAX(p.last_seen) FROM player_presence p WHERE p.user_id=u.id AND p.online=1) AS presence_seen,
  (SELECT MAX(b.occurred_elapsed_ms) FROM field_battles b WHERE b.attacker_id=u.id) AS last_attack_ms,
  (SELECT MAX(b.occurred_elapsed_ms) FROM field_battles b WHERE b.defender_id=u.id) AS last_defended_ms,
  (SELECT MAX(b.occurred_elapsed_ms) FROM field_battles b WHERE json_extract(b.result_json,'$.castleId')='kyoto_gosho') AS last_kyoto_gosho_defended_ms,
  json_extract(s.save_json,'$.state.clan') AS game_clan,json_extract(s.save_json,'$.state.home') AS home_id,
  json_extract(s.save_json,'$.state.troops') AS troops,json_extract(s.save_json,'$.state.castles') AS castles_json,
  json_extract(s.save_json,'$.state.buildings.keep') AS keep_level,
  json_extract(s.save_json,'$.state.buildings.wall') AS wall,json_extract(s.save_json,'$.state.tech.discipline') AS discipline,
  json_extract(s.save_json,'$.state.army') AS army_json,json_extract(s.save_json,'$.state.officerVariants') AS variants_json,
  json_extract(s.save_json,'$.state.officers') AS officers_json,json_extract(s.save_json,'$.state.officerHealth') AS officer_health_json,
  json_extract(s.save_json,'$.state.turn') AS game_turn,json_extract(s.save_json,'$.state.realtime') AS realtime_json,
  json_type(s.save_json,'$.state.repair') AS repair_type,
  json_extract(s.save_json,'$.state.march') AS march_json
  FROM users u JOIN player_saves s ON s.user_id=u.id
  WHERE s.save_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1) AND (COALESCE(json_extract(s.save_json,'$.state.gameOver'),0)=0 OR ${FIELD_FIXED_HOME_SQL} OR ${EFFECTIVE_CYCLE_SQL}<?)`;
function fieldArmy(army,variants,state) {
  const powers=[.9,.95,1,1.08,1.16,1.25,1.35,1.5];
  const scores=army.map(id=>(Math.max(...RANKS.map((rank,i)=>variants.includes(id+':'+rank)?powers[i]:0))||1)*GameEngine.officerCombatFactor(state,id));
  return {officerCount:army.length,rankPower:army.length?Math.round(scores.reduce((a,b)=>a+b,0)/army.length*1000)/1000:.75};
}
function fieldAttackPower(troops,profile,modifier=1){
  return Math.max(1,Math.round(troops*(.7+.5*profile.morale/100)*(1+profile.tech.discipline*.06+profile.tech.gunnery*.05)*fieldArmy(profile.army,profile.officerVariants,profile).rankPower*modifier*(1+(profile.palaceCombatEffects?.military||0))));
}
function fieldDefense(s,tactic='balanced',siege=0,castleId=s.home,armyProfile=null) {
  const home=s.castles[castleId],isHome=castleId===s.home,force=home.troops+GameEngine.retainerDefenseTroops(s,castleId)+Math.floor(s.troops*(isHome?.45:.18)),army=armyProfile||fieldArmy(s.army,s.officerVariants,s);
  const durability=castleDurability(s,castleId),fortification=durability.fortificationFactor,wallFactor=Math.max(.2,1-siege*.12)*(tactic==='siege'?.5:1);
  const inherited=s.palaceCombatEffects,wall=isHome?Math.max(s.buildings.wall,inherited?.wall||0):home.wall,level=isHome?Math.max(home.level,inherited?.castleLevel||0):home.level;
  return {force,power:Math.max(1,Math.round((force+200)*(1+wall*.11*wallFactor*fortification)*(1+s.tech.discipline*.06)*(1+(level-1)*.04*fortification)*(1+(inherited?.defense||0)*fortification)*army.rankPower)),army,durability};
}
function fieldBranchDefense(state,branch,tactic='balanced',siege=0){const projected={...branch,durability:branchDurability(branch,state.worldClock?.elapsedMs??branch.durability?.updatedElapsedMs??0)};return GameEngine.prototype.branchDefense.call({branch:id=>id===branch.id?projected:null,castle:id=>state.castles[id],_branchRecoveryMode:()=> 'paid'},branch.id,tactic,siege);}
function fieldBranches(row,castleId,castle,clock,cyclePending,home,baseReason,retained){
  if(!['edo','nijo','osaka','nagoya'].includes(castleId))return[];
  const stored=row.branches_json?JSON.parse(row.branches_json):{branches:[],jobs:[]};
  if(cyclePending&&castleId!==home&&!retained?.has(castleId))return[];
  const branches=stored.branches.filter(branch=>branch.parentCastleId===castleId&&!branch.retreating);
  if(!branches.length)return[];
  const ids=new Set(branches.map(branch=>branch.id));
  const savedElapsed=(Number(row.game_turn)||0)*60000+Math.round((Number(JSON.parse(row.realtime_json||'null')?.elapsed)||0)*1000);
  const model=projectBranchState({branches,jobs:stored.jobs.filter(job=>ids.has(job.id))},clock.elapsedMs,Math.min(clock.elapsedMs,savedElapsed));
  return model.branches.map(branch=>{
    const job=model.jobs.find(job=>job.id===branch.id);
    const site=branchSite(branch.id),defense=fieldBranchDefense({castles:{[castleId]:castle},worldClock:{elapsedMs:clock.elapsedMs}},branch),reason=baseReason||(!branch.level?'建設中の支拠点です。':branch.fallen?'この支拠点はすでに陥落しています。':'');
    return{...branch,durability:branchDurability(branch,clock.elapsedMs),name:site.name,maxLevel:site.maxLevel,building:!!job,repairing:!!job?.repair,defenseTroops:defense?.force||0,defensePower:defense?.power||0,attackable:!reason,attackReason:reason};
  });
}
function fieldBattleMode(user,castleId,{legacy=false,regionProtected=false}={}) {return regionProtected||castleId==='edo'&&user.is_admin||castleId==='kyoto_gosho'&&user.is_staff&&!user.is_admin||castleId==='kagoshima'||castleId==='sento_gosho'&&user.is_sento?'reward':!legacy&&!user.is_court_protected&&FIELD_CAPTURE_CASTLES.includes(castleId)?'capture':'raid';}
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
// Resolve public home migrations once. The compact owner reader only loads
// the castle JSON for rare legacy identities that need a replacement home.
function fieldPlayerIdentity(row,clock,{withCastles=false}={}){
  const cyclePending=Number(row.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS),rawHome=cyclePending?(row.cycle_home||row.original_home||row.home_id):row.home_id;
  const legacyService=rawHome==='sunpu'&&(row.service_base_id==='sunpu'||!!row.personal_home),storedHome=legacyService?'kyoto_gosho':rawHome;
  const clan=publicClan(row.game_clan,row.is_admin,row.is_staff&&!row.is_sento,row.personal_clan);
  const canonical=CLAN_HOMES[clan]||'kiyosu',reserved=['edo','kyoto_gosho','kagoshima','sento_gosho'],legacyDeputy=!row.is_admin&&!row.is_staff&&!row.is_deputy&&row.home_id==='kagoshima';
  let castles=null;
  function readCastles(){
    if(castles)return castles;
    castles=JSON.parse(row.castles_json||'{}');
    if(!castles.sento_gosho)castles.sento_gosho=initialCastle('sento_gosho');
    if(!castles.kyoto_gosho){castles.kyoto_gosho=initialCastle('kyoto_gosho');if((row.is_staff&&!row.is_admin&&!row.is_sento||legacyService)&&row.home_id==='sunpu'){castles.kyoto_gosho={...castles.sunpu};castles.sunpu=initialCastle('sunpu');}}
    if(legacyDeputy){castles[canonical]={...castles.kagoshima,owner:row.game_clan};castles.kagoshima=initialCastle('kagoshima');if(castles.kagoshima.owner===row.game_clan)castles.kagoshima.owner='在地衆';}
    return castles;
  }
  const ordinaryHome=legacyDeputy?canonical:!reserved.includes(row.home_id)?row.home_id:null;
  const needsReplacement=!row.is_admin&&!row.is_staff&&!row.is_deputy&&reserved.includes(storedHome)&&!(row.personal_home&&!reserved.includes(row.personal_home))&&!ordinaryHome;
  const alternatives=withCastles||needsReplacement?CASTLES.filter(c=>!reserved.includes(c.id)&&readCastles()[c.id]?.owner===row.game_clan):[];
  const replacement=alternatives.find(c=>c.id===canonical)?.id||alternatives[0]?.id||canonical;
  const home=row.is_admin?'edo':row.is_sento?'sento_gosho':row.is_staff?'kyoto_gosho':row.is_deputy?'kagoshima':reserved.includes(storedHome)?row.personal_home&&!reserved.includes(row.personal_home)?row.personal_home:row.imperial_return_home&&!reserved.includes(row.imperial_return_home)?row.imperial_return_home:ordinaryHome||replacement:storedHome;
  return{home,clan,storedHome,cyclePending,alternatives,castles:withCastles?readCastles():castles};
}
function fieldPlayerProjection(row,clock){
  const identity=fieldPlayerIdentity(row,clock,{withCastles:true});
  const combat={army:JSON.parse(row.army_json||'[]'),officerVariants:JSON.parse(row.variants_json||'[]'),officers:JSON.parse(row.officers_json||'[]'),officerHealth:JSON.parse(row.officer_health_json||'null')||undefined,turn:Number(row.game_turn)||0,realtime:JSON.parse(row.realtime_json||'null')||{elapsed:0},march:JSON.parse(row.march_json||'null')};
  if(row.imperial_enhancement_token&&row.imperial_enhancement_save&&row.imperial_enhancement_base){
    const save=JSON.parse(row.imperial_enhancement_save),base=JSON.parse(row.imperial_enhancement_base),fromElapsedMs=clock.elapsedMs;
    const projection={version:1,campaignId:save.state.walking.campaignId,revision:0,proof:'verified-public-imperial-palace',asOfElapsedMs:clock.elapsedMs,accessWindows:[{fromElapsedMs,toElapsedMs:null}],enhancementWindows:[{fromElapsedMs,toElapsedMs:null}],base:{...base,id:'kyoto_gosho',revision:Number(row.imperial_enhancement_base_revision||0)}};
    const game=GameEngine.fromSave(save,GAME_OFFICERS,{isSento:!!row.is_sento,isAdmin:!!row.is_admin,isStaff:!!row.is_staff,isDeputy:!!row.is_deputy,courtEstateProjection:projection});
    combat.palaceCombatEffects=game.courtEstateCombatEffects(clock.elapsedMs);
  }
  combat.officerHealth=GameEngine.projectOfficerHealth(combat,clock.elapsedMs);
  const protection={clan:row.game_clan,castles:identity.castles,cycle:{...(row.protected_regions_json===null||row.protected_regions_json===undefined?{}:{protectedRegions:JSON.parse(row.protected_regions_json)}),releasedCastles:JSON.parse(row.released_castles_json||'[]')}};
  const retained=identity.cyclePending?inheritedStateCastles(protection):new Set();
  return{...identity,retained,protectedCastles:protectedStateCastles(protection),combat,armyProfile:fieldArmy(combat.army,combat.officerVariants,combat)};
}
function mapFieldPlayer(row,viewer,relationship,clock,now,targetCastleId=null,inspectDefense=null,projection=null) {
  const {castles,cyclePending,storedHome,clan,alternatives,home,combat,armyProfile,retained,protectedCastles}=projection||fieldPlayerProjection(row,clock);
  const castleId=targetCastleId||home,isHome=castleId===home,regionProtected=protectedCastles.has(castleId),battleMode=fieldBattleMode(row,castleId,{regionProtected});
  const castle={...(!isHome?castles[castleId]:!row.is_admin&&storedHome==='edo'&&!alternatives.length&&castles.edo.owner===row.game_clan?castles.edo:castles[home])};
  if(isHome&&row.is_admin&&storedHome!=='edo')for(const key of ['troops','wall','level'])castle[key]=Math.max(castle[key],castles[storedHome][key]);
  if(isHome&&!row.is_admin&&!row.is_staff&&storedHome==='kyoto_gosho'){
    if(row.personal_castle_json)Object.assign(castle,restoredHomeCastle(castle,JSON.parse(row.personal_castle_json),row.game_clan));
    else for(const key of ['troops','wall','level'])castle[key]=Math.max(castle[key],castles.kyoto_gosho[key]);
  }
  if(isHome&&row.is_sento)castle.owner=clan;
  if(isHome&&row.is_staff&&!row.is_admin&&!row.is_sento){castle.level=Number(row.staff_castle_level||1);castle.wall=Number(row.staff_wall||1);if(row.staff_durability_json)castle.durability=JSON.parse(row.staff_durability_json);else delete castle.durability;}
  castle.level=Math.min(castleLevelLimit(castleId),castle.level);
  const rawKeepLevel=!isHome?castle.level:row.is_staff&&!row.is_admin&&!row.is_sento?row.staff_keep_level:row.keep_level;
  const keepLevel=Number.isFinite(rawKeepLevel)?Math.max(1,Math.min(32,Math.floor(rawKeepLevel))):1;
  if(cyclePending&&isHome&&battleMode!=='reward'){castle.troops=Math.max(1200,castle.troops);castle.wall=Math.max(castle.wall,Number(row.wall));}
  const state={...combat,clan:castle.owner,home,cycle:{home:authorizedCycleHome(row,{home,cycle:{home:row.original_home}},row.cycle_home)},troops:Number(row.troops),castles:{[castleId]:castle},buildings:{wall:isHome&&row.is_staff&&!row.is_admin&&!row.is_sento?castle.wall:Number(row.wall)},tech:{discipline:Number(row.discipline)}};
  if (castle.owner===row.game_clan || cyclePending&&isHome) applyLordSupport(state,row);
  if(!row.repair_type&&castleId!=='kyoto_gosho'&&castle.durability)castle.durability={...durabilityRecord(GameEngine.durabilityView(castle.durability,{castleId,level:castle.level,wall:castle.wall,retainerCount:GameEngine.homeRetainerCount(state,castleId),elapsedMs:state.turn*60000+Math.round(state.realtime.elapsed*1000),recoveryMode:'free'})),repairPendingHP:0,repairRemainder:0};
  state.worldClock={elapsedMs:clock.elapsedMs};
  const defense=fieldDefense(state,'balanced',0,castleId,armyProfile),self=viewer?.id===row.id,relation=self?'self':fieldRelationStatus(relationship,viewer?.id,clock.elapsedMs);
  inspectDefense?.({castleId,isHome,garrisonTroops:castle.troops,fieldTroops:state.troops,homeContribution:Math.floor(state.troops*(isHome?.45:.18)),wallLevel:isHome?Math.max(state.buildings.wall,combat.palaceCombatEffects?.wall||0):castle.wall,castleLevel:isHome?Math.max(castle.level,combat.palaceCombatEffects?.castleLevel||0):castle.level,castleMaxLevel:combat.palaceCombatEffects&&isHome?128:castleLevelLimit(castleId),disciplineLevel:state.tech.discipline,armyCount:defense.army.officerCount,armyRankPower:defense.army.rankPower,...(combat.palaceCombatEffects?{palaceCombatEffects:combat.palaceCombatEffects}:{})});
  const lastDefended=Math.max(row.last_defended_ms??-Infinity,battleMode==='reward'&&castleId==='kyoto_gosho'?(row.last_kyoto_gosho_defended_ms??-Infinity):-Infinity),protectedUntil=Number.isFinite(lastDefended)?lastDefended+FIELD_RULES.defenderProtectionMs:0;
  const baseReason=!viewer?'領主として接続してください。':self?'自分の城です。':viewer.householdCastleId&&viewer.householdCastleId===row.household_id?'同じ城の領主・家臣には攻撃できません。':castleId==='edo'&&viewer.courtEdoDenied?COURT_EDO_REASON:cyclePending&&Number(row.lease_expires_at)>now?'この領主は領地を精算中です。':relation==='allied'?'同盟の期間中です。':protectedUntil>clock.elapsedMs?'襲撃後の保護期間です。':!clock.running?'世界の共通時間が停止中です。':'';
  const branches=fieldBranches(row,castleId,castle,clock,cyclePending,home,baseReason,retained),reason=baseReason||(branches.some(branch=>branch.level>0&&!branch.fallen)?'大都市拠点へ攻めるには、残っている支拠点をすべて先に陥落させてください。':'');
  return {playerId:row.id,name:row.name,clan,householdCastleId:row.household_id||null,householdRole:row.household_id?(row.household_lord===row.id?'lord':'retainer'):null,lordEpoch:Number(row.household_epoch||0),retainerCount:state.retainerSupport?.count||0,evaluation:evaluationRef(row.id),avatarVersion:row.avatar_version||null,homeCastleId:home,homeCastleName:CASTLE_BY_ID[home].name,targetCastleId:castleId,targetCastleName:CASTLE_BY_ID[castleId].name,isHome,battleMode,capturable:battleMode==='capture',regionProtected,protectedRegion:regionProtected?CASTLE_BY_ID[castleId].region:null,majorCity:MAJOR_CITIES.includes(castleId),level:castle.level,keepLevel,durability:defense.durability,defenseTroops:defense.force,defensePower:defense.power,armySummary:defense.army,branches,isSento:!!row.is_sento,isAdmin:!!row.is_admin,isDeputy:!!row.is_deputy,isStaff:!!row.is_staff&&!row.is_admin&&!row.is_sento,self,online:row.presence_seen!==null&&Number(row.presence_seen)>now-ONLINE_WINDOW,relationship:relation,protectedUntilElapsedMs:protectedUntil,attackable:!reason,attackReason:reason};
}
function fieldHoldingTarget(row,home,castleId,castle,{courtEstate=false}={}){
  const level=Math.max(1,Math.min(castleLevelLimit(castleId),Number(castle?.level)||1));
  return{playerId:home.playerId,name:home.name,clan:home.clan,avatarVersion:home.avatarVersion,evaluation:evaluationRef(row.id),homeCastleId:home.homeCastleId,homeCastleName:home.homeCastleName,
    targetCastleId:castleId,targetCastleName:CASTLE_BY_ID[castleId].name,isHome:false,level,keepLevel:level,keepLevelKnown:false,majorCity:MAJOR_CITIES.includes(castleId),
    self:home.self,online:home.online,relationship:home.relationship,householdCastleId:home.householdCastleId,
    displayOnly:true,holdingKind:courtEstate?'court-estate':'territory',battleMode:null,capturable:false,attackable:false,branches:[],
    ...(courtEstate?{courtEstateMember:true,canDevelopCourtEstate:true}:{}),
    attackReason:courtEstate?'京都御所の共同領地です。共同普請から発展させられます。':'この領主が個人戦役で占領した領地です。共有合戦の出陣先には含まれません。'};
}
function mapFieldTargets(row,viewer,relationship,clock,now,inspectDefense=null,preparedHome=null,{includeHoldings=false,projection=fieldPlayerProjection(row,clock)}={}) {
  const home=preparedHome||mapFieldPlayer(row,viewer,relationship,clock,now,null,inspectDefense,projection),castles=projection.castles;
  const cyclePending=Number(row.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);
  const outposts=[...FIELD_CAPTURE_CASTLES.map(id=>CASTLE_BY_ID[id]),...(includeHoldings?CASTLES.filter(c=>!MAJOR_CITIES.includes(c.id)):[])].filter(c=>c.id!==home.homeCastleId&&castles[c.id]?.owner===row.game_clan&&(!cyclePending||projection.retained.has(c.id)));
  const targets=MAJOR_CITIES.includes(home.homeCastleId)||home.householdRole==='lord'&&home.householdCastleId===home.homeCastleId?[home]:[];
  for(const castle of outposts){
    const target=mapFieldPlayer(row,viewer,relationship,clock,now,castle.id,inspectDefense,projection);
    if(!FIELD_CAPTURE_CASTLES.includes(castle.id))Object.assign(target,{holdingKind:'territory',displayOnly:false,keepLevelKnown:false});
    targets.push(target);
  }
  return targets;
}
async function fieldRelation(db,a,b) {const [first,second]=pair(a,b);return stmt(db,'SELECT * FROM field_relations WHERE user_a=? AND user_b=?',first,second).first();}
async function fieldOwnRelations(db,userId,elapsed) {
  return rows(await stmt(db,`SELECT r.*,u.name AS target_name FROM field_relations r JOIN users u ON u.id=CASE WHEN r.user_a=? THEN r.user_b ELSE r.user_a END
    WHERE (r.user_a=? OR r.user_b=?) AND r.status IN ('pending','allied') AND r.expires_elapsed_ms>? AND r.updated_elapsed_ms>=? ORDER BY r.updated_elapsed_ms DESC LIMIT 100`,userId,userId,userId,elapsed,Math.floor(elapsed/WORLD_CYCLE_MS)*WORLD_CYCLE_MS).all());
}
// A dismissed palace member's saved home may still be Kyoto until synchronization.
// Use their restored personal castle for the same visibility rules as other players.
const FIELD_CANONICAL_HOME_SQL=`CASE json_extract(s.save_json,'$.state.clan') ${Object.entries(CLAN_HOMES).map(([clan,home])=>`WHEN '${clan}' THEN '${home}'`).join(' ')} WHEN '${ADMIN_CLAN}' THEN 'okazaki' ELSE 'kiyosu' END`;
const FIELD_PERSONAL_HOME_SQL=`CASE WHEN json_extract(s.save_json,'$.state.home')='sento_gosho' THEN COALESCE(json_extract(s.save_json,'$.state.imperialResidence.returnHome'),${FIELD_CANONICAL_HOME_SQL}) WHEN json_extract(s.save_json,'$.state.home')='kagoshima' THEN ${FIELD_CANONICAL_HOME_SQL} WHEN json_extract(s.save_json,'$.state.home') IN ('edo','kyoto_gosho','sunpu')
  THEN COALESCE((SELECT json_extract(b.save_json,'$.state.home') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1),json_extract(s.save_json,'$.state.home'))
  ELSE json_extract(s.save_json,'$.state.home') END`;
const FIELD_CYCLE_HOME_SQL=`CASE WHEN COALESCE(s.cycle_home,json_extract(s.save_json,'$.state.cycle.home')) IN ('edo','kyoto_gosho','kagoshima','sento_gosho') THEN ${FIELD_PERSONAL_HOME_SQL} ELSE COALESCE(s.cycle_home,json_extract(s.save_json,'$.state.cycle.home'),${FIELD_PERSONAL_HOME_SQL}) END`;
const FIELD_PUBLIC_HOME_SQL=`(${FIELD_FIXED_HOME_SQL} OR ${FIELD_PERSONAL_HOME_SQL} IN ('nijo','osaka','nagoya')
  OR EXISTS(SELECT 1 FROM castle_seats cs WHERE cs.lord_user_id=u.id AND cs.castle_id=${FIELD_PERSONAL_HOME_SQL}))`;
// Both public maps include ordinary occupied territories. Their owner is the
// exact player/castle pair; the residency ledger still decides home lordship.
const FIELD_DISPLAY_TARGET_SQL=`(${FIELD_PUBLIC_HOME_SQL} OR ${anyInheritedRegionSql} OR (${EFFECTIVE_CYCLE_SQL}>=? AND EXISTS(
  SELECT 1 FROM json_each(s.save_json,'$.state.castles') own WHERE own.key<>${FIELD_PERSONAL_HOME_SQL}
  AND own.key NOT IN ('edo','kyoto_gosho','kagoshima','sento_gosho') AND json_extract(own.value,'$.owner')=json_extract(s.save_json,'$.state.clan'))))`;
const FIELD_OWNER_SELECT=`/* compact-field-owners */ SELECT u.id,u.name,
  (SELECT version FROM user_avatars WHERE user_id=u.id) AS avatar_version,
  CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
  EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
  (SELECT castle_id FROM castle_residents WHERE user_id=u.id) AS household_id,
  (SELECT cs.lord_user_id FROM castle_seats cs JOIN castle_residents m ON m.castle_id=cs.castle_id WHERE m.user_id=u.id) AS household_lord,
  (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan,
  (SELECT json_extract(b.save_json,'$.state.home') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_home,
  ${EFFECTIVE_CYCLE_SQL} AS cycle_index,s.cycle_home,
  json_extract(s.save_json,'$.state.cycle.home') AS original_home,
  json_extract(s.save_json,'$.state.cycle.protectedRegions') AS protected_regions_json,json_extract(s.save_json,'$.state.cycle.releasedCastles') AS released_castles_json,
  json_extract(s.save_json,'$.state.staffService.baseId') AS service_base_id,json_extract(s.save_json,'$.state.imperialResidence.returnHome') AS imperial_return_home,
  json_extract(s.save_json,'$.state.clan') AS game_clan,json_extract(s.save_json,'$.state.home') AS home_id,
  CASE WHEN NOT ${FIELD_FIXED_HOME_SQL} AND (json_extract(s.save_json,'$.state.home') IN ('edo','kyoto_gosho','sunpu','kagoshima','sento_gosho')
    OR COALESCE(s.cycle_home,json_extract(s.save_json,'$.state.cycle.home')) IN ('edo','kyoto_gosho','sunpu','kagoshima','sento_gosho'))
    THEN json_extract(s.save_json,'$.state.castles') ELSE NULL END AS castles_json,
  (SELECT json_group_array(owned.key) FROM json_each(s.save_json,'$.state.castles') owned
    WHERE owned.key NOT IN ('edo','kyoto_gosho','kagoshima','sento_gosho') AND json_extract(owned.value,'$.owner')=json_extract(s.save_json,'$.state.clan')) AS holdings_json
  FROM users u JOIN player_saves s ON s.user_id=u.id
  WHERE s.save_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=u.id AND pb.active=1)
    AND (COALESCE(json_extract(s.save_json,'$.state.gameOver'),0)=0 OR ${FIELD_FIXED_HOME_SQL} OR ${EFFECTIVE_CYCLE_SQL}<?)`;
function mapFieldOwnerTargets(row,viewer,relationship,clock){
  const {home,cyclePending}=fieldPlayerIdentity(row,clock),ids=[];
  if(MAJOR_CITIES.includes(home)||row.household_lord===row.id&&row.household_id===home)ids.push(home);
  const owned=JSON.parse(row.holdings_json||'[]'),retained=cyclePending?inheritedStateCastles({clan:row.game_clan,castles:Object.fromEntries(owned.map(id=>[id,{owner:row.game_clan}])),cycle:{...(row.protected_regions_json===null||row.protected_regions_json===undefined?{}:{protectedRegions:JSON.parse(row.protected_regions_json)}),releasedCastles:JSON.parse(row.released_castles_json||'[]')}}):null;
  for(const id of owned)if(id!==home&&CASTLE_BY_ID[id]&&!['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(id)&&(!cyclePending||retained.has(id)))ids.push(id);
  const relation=viewer?.id===row.id?'self':fieldRelationStatus(relationship,viewer?.id,clock.elapsedMs);
  return ids.map(id=>({playerId:row.id,name:row.name,avatarVersion:row.avatar_version||null,homeCastleId:home,targetCastleId:id,relationship:relation,...(id!==home&&!MAJOR_CITIES.includes(id)?{holdingKind:'territory'}:{})}));
}
async function appendViewerCourtEstate(db,viewer,url,now,clock,targets,found,request,{compact=false,estateAccess=null}={}){
  // Only the viewing player gets this additional display. Other ordinary-home
  // court participants are not published as a new Kyoto resident directory.
  if(!viewer||url.searchParams.get('cursor')||!viewer.is_admin&&!viewer.is_staff&&!viewer.is_court_protected)return;
  const access=estateAccess||await courtEstateAuthority(db,viewer,{requireAccountAccess,roleCommitGuard,hash});
  if(!access.eligible)return;
  const existing=targets.find(target=>target.playerId===viewer.id&&target.targetCastleId==='kyoto_gosho');
  if(existing){existing.canDevelopCourtEstate=true;existing.courtEstateMember=true;}
  else{
    const row=found.find(item=>item.id===viewer.id)||await stmt(db,(compact?FIELD_OWNER_SELECT:FIELD_SELECT)+' AND u.id=?',Math.floor(clock.elapsedMs/WORLD_CYCLE_MS),viewer.id).first();
    if(!row)return;
    if(compact){const {home}=fieldPlayerIdentity(row,clock);targets.push({playerId:row.id,name:row.name,avatarVersion:row.avatar_version||null,homeCastleId:home,targetCastleId:'kyoto_gosho',relationship:'self',displayOnly:true,holdingKind:'court-estate',canDevelopCourtEstate:true,courtEstateMember:true});}
    else{const home=mapFieldPlayer(row,viewer,null,clock,now);targets.push(fieldHoldingTarget(row,home,'kyoto_gosho',{level:row.staff_castle_level||1},{courtEstate:true}));}
  }
  await assertCourtEstateAccess(db,viewer,access,{requireAccountAccess,fail});
  if(request)courtResponseGuards.set(request,access.guard);
}
async function getFieldOwners(db,viewer,url,now,request){
  const cursor=url.searchParams.get('cursor')||'',limitText=url.searchParams.get('limit')||'100';
  if(cursor)idField(cursor,'共有地図の続き');
  if(!/^\d{1,3}$/.test(limitText)||Number(limitText)<1||Number(limitText)>100)fail(400,'INVALID_INPUT','一覧の件数は1～100件で指定してください。');
  await settleShogunateApprovals(db,now);await ensureResidency(db,now);
  const limit=Number(limitText),clock=await getWorldClock(db,now);await cyclePolicy(db,clock,now);
  const relations=viewer?await fieldOwnRelations(db,viewer.id,clock.elapsedMs):[],byPlayer=new Map(relations.map(relation=>[relation.user_a===viewer.id?relation.user_b:relation.user_a,relation]));
  const cycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);
  const found=rows(await stmt(db,FIELD_OWNER_SELECT+' AND '+FIELD_DISPLAY_TARGET_SQL+' AND u.id>? ORDER BY u.id LIMIT ?',cycle,cycle,cursor,limit+1).all());
  const targets=found.slice(0,limit).flatMap(row=>mapFieldOwnerTargets(row,viewer,byPlayer.get(row.id),clock));
  await appendViewerCourtEstate(db,viewer,url,now,clock,targets,found.slice(0,limit),request,{compact:true});
  const palaceControl=await readPalaceControl(db);
  await applyPalaceControl(db,targets,palaceControl);
  return{ok:true,view:'owners',ownersIncludeTerritories:true,targets,palaceControl,nextCursor:found.length>limit?found[limit-1].id:null,clock};
}
// Resolve a named event against the same published castle and field defense
// as the world map. A disputed major city has no single defending lord.
function eventCastleCandidates(castleId,clock){
  if(!castleId||!CASTLE_BY_ID[castleId])return null;
  const cycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS),ordinary=!MAJOR_CITIES.includes(castleId);
  let predicate,params=[];
  if(ordinary){
    predicate=`u.id=(SELECT lord_user_id FROM castle_seats WHERE castle_id=?)
      AND EXISTS(SELECT 1 FROM castle_residents m WHERE m.user_id=u.id AND m.castle_id=?)
      AND NOT ${FIELD_FIXED_HOME_SQL} AND ${FIELD_PERSONAL_HOME_SQL}=?`;
    params=[castleId,castleId,castleId];
  }else if(castleId==='edo'){
    predicate="u.id=(SELECT value FROM settings WHERE key='adminUserId')";
  }else if(castleId==='kagoshima'){
    predicate="EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id)";
  }else if(castleId==='sento_gosho'){
    predicate="EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id)";
  }else if(castleId==='kyoto_gosho'){
    predicate="u.id<>COALESCE((SELECT value FROM settings WHERE key='adminUserId'),'') AND EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id)";
  }else{
    // Fully conquered regions retain their outposts at the boundary. Other
    // old holdings disappear, and service members keep their fixed home.
    predicate=`((NOT ${FIELD_FIXED_HOME_SQL} AND (CASE WHEN ${EFFECTIVE_CYCLE_SQL}<? THEN ${FIELD_CYCLE_HOME_SQL} ELSE ${FIELD_PERSONAL_HOME_SQL} END)=?)
       OR ((${EFFECTIVE_CYCLE_SQL}>=? OR ${inheritedCastleSql(castleId)}) AND json_extract(s.save_json,?)=json_extract(s.save_json,'$.state.clan')))`;
    params=[cycle,castleId,cycle,'$.state.castles.'+castleId+'.owner'];
  }
  const candidateSource=`FROM users u JOIN player_saves s ON s.user_id=u.id
    WHERE s.save_json IS NOT NULL AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id=u.id AND b.active=1)
    AND CASE WHEN json_valid(s.save_json) THEN
      (COALESCE(json_extract(s.save_json,'$.state.gameOver'),0)=0 OR ${FIELD_FIXED_HOME_SQL} OR ${EFFECTIVE_CYCLE_SQL}<?) AND ${predicate}
      ELSE 0 END`;
  return{cycle,ordinary,params,source:candidateSource};
}
async function eventGarrison(db,castleId,clock,now,viewerId=null){
  const none={opponent:null,guard:{sql:'1=1',args:[]},viewerOwnsTarget:false,clockRevision:null};
  if(!castleId||!CASTLE_BY_ID[castleId])return none;
  const {cycle,ordinary,params,source:candidateSource}=eventCastleCandidates(castleId,clock);
  const seatTerm=ordinary?"(SELECT lord_epoch FROM castle_seats WHERE lord_user_id=u.id AND castle_id=?)":"NULL";
  // A role change can turn a saved metropolitan home into an outpost before
  // its save revision changes. Keep that defense classification in the guard.
  const candidates=`SELECT u.id,u.name,s.revision,${seatTerm} AS term,
    CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
    (SELECT term_id FROM staff_members WHERE user_id=u.id) AS staff_term ${candidateSource} ORDER BY u.id LIMIT 2`;
  const args=[...(ordinary?[castleId]:[]),cycle,...params],records=rows(await stmt(db,candidates,...args).all());
  const guard={sql:`(SELECT json_group_array(json_array(id,name,revision,term,is_admin,staff_term)) FROM (${candidates}))=?`,
    args:[...args,JSON.stringify(records.map(r=>[r.id,r.name,r.revision,r.term,r.is_admin,r.staff_term]))]};
  // Eligibility is personal and must inspect every eligible holder, including
  // a third shared-city defender omitted by the public ambiguity probe.
  let viewerOwnsTarget=false;
  if(viewerId){
    const ownership=`EXISTS(SELECT 1 ${candidateSource} AND u.id=?)`,ownershipArgs=[cycle,...params,viewerId];
    viewerOwnsTarget=!!(await stmt(db,'SELECT '+ownership+' AS owned',...ownershipArgs).first())?.owned;
    guard.sql+=' AND ('+ownership+')=?';guard.args.push(...ownershipArgs,viewerOwnsTarget?1:0);
  }
  const personal={viewerOwnsTarget,clockRevision:clock.revision};
  if(records.length!==1)return{opponent:null,guard,...personal};
  const owner=records[0],row=await stmt(db,FIELD_SELECT+' AND u.id=?',cycle,owner.id).first();
  if(!row)return{opponent:null,guard,...personal};
  guard.sql+=" AND COALESCE((SELECT r.succession_id FROM court_retirement_holders r JOIN court_estate_current c ON c.user_id=r.user_id WHERE r.user_id=?),'')=?";guard.args.push(owner.id,row.imperial_enhancement_token||'');
  if(row.imperial_enhancement_token){guard.sql+=" AND EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)";guard.args.push(row.imperial_enhancement_base_revision);}
  if (ordinary) Object.assign(guard,guardLordSupport(guard,row));
  if(castleId==='kyoto_gosho'){
    const state={castles:{kyoto_gosho:{}},buildings:{}},shared=await fieldStaffDefense(db,state,clock);
    row.staff_castle_level=state.castles.kyoto_gosho.level;row.staff_wall=state.buildings.wall;
    guard.sql+=' AND '+shared.sql;guard.args.push(...shared.args);
  }
  let defenseProfile=null;
  const inspectDefense=owner.id===viewerId?profile=>{if(profile.castleId===castleId)defenseProfile=profile;}:null;
  const target=mapFieldTargets(row,null,null,clock,now,inspectDefense).find(t=>t.targetCastleId===castleId);
  if(!target)return{opponent:null,guard,...personal};
  const aid=`SELECT COALESCE(SUM(u.troops),0) AS troops FROM alliance_units u JOIN guild_members a ON a.user_id=u.owner_id AND a.guild_id=u.guild_id
    JOIN guild_members d ON d.user_id=u.target_id AND d.guild_id=u.guild_id
    WHERE u.kind='aid' AND u.state='stationed' AND u.expires_at>? AND u.target_id=? AND u.castle_id=?
    AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.owner_id),0)=u.owner_epoch
    AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.target_id),0)=u.target_epoch
    AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id IN (u.owner_id,u.target_id) AND b.active=1)`;
  const aidArgs=[now,owner.id,castleId],reinforcements=Number((await stmt(db,aid,...aidArgs).first()).troops);
  guard.sql+=' AND ('+aid+')=?';guard.args.push(...aidArgs,reinforcements);
  applyFieldReinforcements(target,reinforcements);
  return{opponent:{castleId,castleName:CASTLE_BY_ID[castleId].name,castleOwnerId:owner.id,lordName:owner.name,defenseTroops:target.defenseTroops,defensePower:target.defensePower},guard,...personal,
    defender:defenseProfile?{userId:owner.id,profile:{...defenseProfile,reinforcementTroops:reinforcements},clockRevision:clock.revision}:null};
}
function vacantCastleCondition(castleId,clock){
  const candidate=eventCastleCandidates(castleId,clock);if(!candidate)return null;
  if(candidate.ordinary)return{sql:'NOT EXISTS(SELECT 1 FROM castle_seats WHERE castle_id=? AND lord_user_id IS NOT NULL)',args:[castleId]};
  const guard={sql:'NOT EXISTS(SELECT 1 '+candidate.source+')',args:[candidate.cycle,...candidate.params]};
  if(castleId==='edo')guard.sql+=" AND NOT EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value IS NOT NULL AND value<>'')";
  if(castleId==='kyoto_gosho')guard.sql+=' AND NOT EXISTS(SELECT 1 FROM staff_members)';
  return guard;
}
async function vacantCastleGuard(db,user,castleId,clock,now){
  const guard=vacantCastleCondition(castleId,clock);
  if(!guard)return{castle:null,vacant:false,guard:{sql:'0=1',args:[]}};
  await ensureResidency(db,now);
  const found=await stmt(db,'SELECT ('+guard.sql+') AS vacant',...guard.args).first();
  return{castle:{id:castleId,name:CASTLE_BY_ID[castleId].name,majorCity:MAJOR_CITIES.includes(castleId)},vacant:!!found?.vacant,guard};
}
async function listVacantCastles(db,user,clock,now){
  await ensureResidency(db,now);
  const occupied=new Set(rows(await stmt(db,'SELECT castle_id FROM castle_seats WHERE lord_user_id IS NOT NULL').all()).map(row=>row.castle_id));
  const probes=MAJOR_CITIES.map(id=>({id,guard:vacantCastleCondition(id,clock)}));
  const sql=probes.map(({guard})=>'SELECT ? AS castle_id,('+guard.sql+') AS vacant').join(' UNION ALL '),args=probes.flatMap(({id,guard})=>[id,...guard.args]);
  for(const row of rows(await stmt(db,sql,...args).all()))if(!row.vacant)occupied.add(row.castle_id);
  return CASTLES.filter(castle=>!occupied.has(castle.id)).map(castle=>({id:castle.id,name:castle.name,majorCity:MAJOR_CITIES.includes(castle.id)}));
}
function applyFieldReinforcements(target,troops){
  target.reinforcementTroops=troops;
  if(troops){target.defensePower=Math.round(target.defensePower*(target.defenseTroops+troops)/Math.max(1,target.defenseTroops));target.defenseTroops+=troops;}
}
async function getFieldList(db,viewer,url,now,request=null) {
  await settleShogunateApprovals(db,now);
  await ensureResidency(db,now);
  const cursor=url.searchParams.get('cursor')||'',limitText=url.searchParams.get('limit')||'50';
  if(cursor)idField(cursor,'共有地図の続き');
  if(!/^\d{1,3}$/.test(limitText)||Number(limitText)<1||Number(limitText)>100)fail(400,'INVALID_INPUT','一覧の件数は1～100件で指定してください。');
  if(viewer)viewer={...viewer,householdCastleId:(await residencySnapshot(db,viewer.id,now)).residency?.castleId||null,courtEdoDenied:!!viewer.is_staff&&!viewer.is_admin&&!(await courtImperialAuthority(db,viewer)).canActForEmperor};
  const limit=Number(limitText),clock=await getWorldClock(db,now),relations=viewer?await fieldOwnRelations(db,viewer.id,clock.elapsedMs):[];await cyclePolicy(db,clock,now);const currentCycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);await sharedStaffBaseRow(db,clock,now);
  const estateAccess=viewer&&(viewer.is_admin||viewer.is_staff||viewer.is_court_protected)?await courtEstateAuthority(db,viewer,{requireAccountAccess,roleCommitGuard,hash}):null;
  // The displayed population and its count use the same predicate, including
  // a qualified viewer whose personal home is a retainer's shared residence.
  const displayWhere='('+FIELD_DISPLAY_TARGET_SQL+' OR (?=1 AND u.id=?))',displayArgs=[currentCycle,currentCycle,estateAccess?.eligible?1:0,viewer?.id||''];
  const result=await db.batch([stmt(db,FIELD_SELECT+' AND '+displayWhere+' AND u.id>? ORDER BY u.id LIMIT ?',...displayArgs,cursor,limit+1),stmt(db,'SELECT COUNT(*) AS count FROM ('+FIELD_SELECT+' AND '+displayWhere+')',...displayArgs)]);
  const found=rows(result[0]),players=[],targets=[],byPlayer=new Map(relations.map(relation=>[relation.user_a===viewer?.id?relation.user_b:relation.user_a,relation]));
  for(const row of found.slice(0,limit)){
    const relation=byPlayer.get(row.id),projection=fieldPlayerProjection(row,clock),home=mapFieldPlayer(row,viewer,relation,clock,now,null,null,projection);
    if(MAJOR_CITIES.includes(home.homeCastleId)||home.householdRole==='lord'&&home.householdCastleId===home.homeCastleId)players.push(home);
    targets.push(...mapFieldTargets(row,viewer,relation,clock,now,null,home,{includeHoldings:true,projection}));
  }
  await appendViewerCourtEstate(db,viewer,url,now,clock,targets,found.slice(0,limit),request,{estateAccess});
  // Aggregate only currently stationed, authorized reinforcements. A single
  // query covers the page; combat validates the same membership epochs again.
  const aids=rows(await stmt(db,`SELECT u.target_id,u.castle_id,SUM(u.troops) AS troops FROM alliance_units u
    JOIN guild_members a ON a.user_id=u.owner_id AND a.guild_id=u.guild_id
    JOIN guild_members d ON d.user_id=u.target_id AND d.guild_id=u.guild_id
    WHERE u.kind='aid' AND u.state='stationed' AND u.expires_at>?
    AND u.target_id IN (SELECT value FROM json_each(?))
    AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.owner_id),0)=u.owner_epoch
    AND COALESCE((SELECT epoch FROM voice_membership_epochs WHERE user_id=u.target_id),0)=u.target_epoch
    AND NOT EXISTS(SELECT 1 FROM player_bans b WHERE b.user_id IN (u.owner_id,u.target_id) AND b.active=1)
    GROUP BY u.target_id,u.castle_id`,now,JSON.stringify(found.slice(0,limit).map(row=>row.id))).all());
  const aidByTarget=new Map(aids.map(aid=>[aid.target_id+':'+aid.castle_id,Number(aid.troops)||0]));
  for(const player of new Set([...players,...targets]))if(!player.displayOnly)applyFieldReinforcements(player,aidByTarget.get(player.playerId+':'+player.targetCastleId)||0);
  await decorateProtectedTargets(db,[...new Set([...players,...targets])].filter(target=>!target.displayOnly),viewer,now);
  const palaceControl=await readPalaceControl(db);
  await applyPalaceControl(db,[...players,...targets],palaceControl);
  return {ok:true,players,targets,palaceControl,total:Number(rows(result[1])[0].count),nextCursor:found.length>limit?found[limit-1].id:null,clock,rules:FIELD_RULES};
}
function fieldWriter(row,deviceId,revision,now) {
  if(!row?.save_json)fail(409,'SAVE_REQUIRED','先に本拠をクラウドへ保存してください。');
  if(row.writer_device_id!==deviceId||Number(row.lease_expires_at)<=now)fail(409,'LEASE_REQUIRED','この端末を操作端末にしてからお試しください。');
  if(Number(row.revision)!==revision)fail(409,'REVISION_CONFLICT','本拠の保存が更新されています。同期してからお試しください。');
}
async function settleWriterCycle(db,user,deviceId,revision,now) {
  await requireAccountAccess(db,user);
  if(user.expulsion_pending)fail(409,'BASE_EXPELLED',EXPULSION_MESSAGE);
  let prior=await getSyncRow(db,user.id);fieldWriter(prior,deviceId,revision,now);
  prior=await ensureStaffCampaign(db,user,now);fieldWriter(prior,deviceId,revision,now);
  const settled=await settlePlayerCycle(db,prior,user,now,undefined,{deferActive:false,writerDeviceId:deviceId});fieldWriter(settled,deviceId,revision,now);return settled;
}
function fieldRequestBody(body,kind) {
  const allowed=kind==='attack'?['targetPlayerId','targetCastleId','targetBranchId','troops','tactic','requestId','deviceId','expectedRevision']:['targetPlayerId','action','requestId','deviceId','expectedRevision'];
  if(Object.keys(body).some(key=>!allowed.includes(key)))fail(400,'INVALID_INPUT','送信できない操作項目が含まれています。');
  const targetPlayerId=idField(body.targetPlayerId,'相手の領主'),requestId=idField(body.requestId,'操作番号'),deviceId=idField(body.deviceId,'端末');
  if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)fail(400,'INVALID_INPUT','保存の更新番号が正しくありません。');
  if(kind==='attack'&&(!Number.isInteger(body.troops)||body.troops<FIELD_RULES.minTroops||body.troops>FIELD_RULES.maxTroops||!FIELD_RULES.tactics.some(t=>t.id===body.tactic)))fail(400,'INVALID_INPUT','兵数と戦法を正しく指定してください。');
  if(kind==='attack'&&body.targetCastleId!==undefined&&(typeof body.targetCastleId!=='string'||!CASTLE_BY_ID[body.targetCastleId]))fail(400,'INVALID_INPUT','攻撃する城を確認してください。');
  if(kind==='attack'&&body.targetBranchId!==undefined&&(!branchSite(body.targetBranchId)||branchSite(body.targetBranchId).parentCastleId!==body.targetCastleId))fail(400,'INVALID_BRANCH_TARGET','親拠点に属する支拠点を選んでください。');
  if(kind==='diplomacy'&&!['propose','accept','reject','cancel'].includes(body.action))fail(400,'INVALID_INPUT','外交操作が正しくありません。');
  return {...body,targetPlayerId,requestId,deviceId};
}
async function priorFieldRequest(db,userId,body,kind,digest) {
  const prior=await stmt(db,'SELECT * FROM field_requests WHERE actor_id=? AND request_id=?',userId,body.requestId).first();
  if(prior&&(prior.kind!==kind||prior.request_hash!==digest))fail(409,'REQUEST_ID_REUSED','この操作番号は別の操作に使われています。');
  return prior;
}
async function fieldMe(db,user,url,now,request) {
  await ensureResidency(db,now);
  const deviceId=url.searchParams.get('deviceId')||'';if(deviceId)idField(deviceId,'端末');
  const clock=await getWorldClock(db,now);await sharedStaffBaseRow(db,clock,now);const row=await settlePlayerCycle(db,await getSyncRow(db,user.id),user,now,clock,{deferActive:true}),base=await stmt(db,FIELD_SELECT+' AND u.id=?',Math.floor(clock.elapsedMs/WORLD_CYCLE_MS),user.id).first();
  const save=row?.save_json?normalizeGameSave(JSON.parse(row.save_json),user,now,{reading:true,clock}):null,s=save?.state;
  const emperor=await courtImperialAuthority(db,user);if(emperor.canActForEmperor)courtResponseGuards.set(request,emperor.guard);
  const cooldownUntil=base?.last_attack_ms!==null&&base?.last_attack_ms!==undefined?Number(base.last_attack_ms)+FIELD_RULES.attackCooldownMs:0;
  let reason=!s?'先に本拠をクラウドへ保存してください。':s.march?'本隊が進軍中です。到着後に次の出陣を選べます。':s.gameOver?'本拠を復元してください。':Number(row.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)?'領地の精算を同期しています。':!s.worldClock?'共通時計へ同期してください。':!clock.running?'世界の共通時間が停止中です。':row.lease_expires_at<=now||deviceId&&row.writer_device_id!==deviceId?'この端末を操作端末にしてください。':cooldownUntil>clock.elapsedMs?'次の出陣までお待ちください。':s.command<1?'指示の回復をお待ちください。':s.troops<FIELD_RULES.minTroops?'出陣できる兵が足りません。':s.resources.rice<240?'兵糧が足りません。':'';
  if(!reason&&clock.elapsedMs-s.worldClock.elapsedMs>15000)reason='共通時計と本拠を同期してください。';
  const relations=await fieldOwnRelations(db,user.id,clock.elapsedMs),battles=rows(await stmt(db,'SELECT result_json FROM field_battles WHERE attacker_id=? OR defender_id=? ORDER BY occurred_elapsed_ms DESC,id DESC LIMIT 20',user.id,user.id).all()).map(b=>publicBattle(JSON.parse(b.result_json)));
  return {ok:true,...await residencySnapshot(db,user.id,now,evaluationRef),protection:await protectionStatus(db,user.id,now),self:base?mapFieldPlayer(base,user,null,clock,now):null,revision:row?Number(row.revision):null,clock,rules:FIELD_RULES,attack:{ready:!reason,reason,canAttackEdoFromKyoto:emperor.canActForEmperor,availableTroops:s?.troops||0,minTroops:FIELD_RULES.minTroops,maxTroops:Math.min(s?.troops||0,FIELD_RULES.maxTroops),command:s?.command||0,rice:s?.resources.rice||0,cooldownUntilElapsedMs:cooldownUntil,remainingCooldownMs:Math.max(0,cooldownUntil-clock.elapsedMs)},relationships:relations.map(r=>mapFieldRelationship(r,user.id,clock.elapsedMs,r.target_name)),battles};
}
async function fieldReplayAttack(db,user,body,prior,now) {return {...await syncSnapshot(db,await getSyncRow(db,user.id),user,body.deviceId,now),battle:publicBattle(JSON.parse(prior.result_json)),idempotent:true};}
async function fieldCommitFailure(db,user,body,kind,digest,clock,now) {
  const prior=await priorFieldRequest(db,user.id,body,kind,digest);if(prior)return prior;
  fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);
  if((await getWorldClock(db,now)).revision!==clock.revision)fail(409,'WORLD_CLOCK_CHANGED','共通時計が更新されました。同期してからお試しください。');
  fail(409,'FIELD_CHANGED','相手の本拠または外交関係が更新されました。共有地図を更新してからお試しください。');
}
function fieldFallbackHome(s,preferred=null) {
  const released=new Set(releasedCastleIds(s)),ordinary=id=>!!CASTLE_BY_ID[id]&&!MAJOR_CITIES.includes(id)&&!released.has(id),owned=id=>ordinary(id)&&s.castles[id].owner===s.clan;
  return [preferred,s.cycle?.home,CLAN_HOMES[s.clan]].find(owned)||CASTLES.find(c=>owned(c.id))?.id||[preferred,s.cycle?.home,CLAN_HOMES[s.clan],'kiyosu'].find(ordinary)||CASTLES.find(c=>ordinary(c.id))?.id;
}
function fieldLoseCastle(s,castleId,preferred=null) {
  if(isRegionProtectedCastle(s,castleId))fail(409,'FIELD_TARGET_CHANGED','制覇済み地域の占領は保護されています。共有地図を更新してください。');
  const castle=s.castles[castleId],lostHome=s.home===castleId,lostCycleHome=s.cycle?.home===castleId;
  let fallback=null;
  if(lostHome||lostCycleHome){
    fallback=fieldFallbackHome(s,preferred);const next=s.castles[fallback],existing=next.owner===s.clan;
    next.owner=s.clan;next.level=Math.min(castleLevelLimit(fallback),Math.max(next.level,castle.level));
    next.wall=Math.max(next.wall,castle.wall,s.buildings.wall);
    next.troops=Math.min(100000000,(existing?next.troops:0)+castle.troops);castle.troops=0;
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
  const lostBranches=new Set((s.branches||[]).filter(branch=>branch.parentCastleId===castleId).map(branch=>branch.id));
  s.branches=(s.branches||[]).filter(branch=>branch.parentCastleId!==castleId);s.jobs=s.jobs.filter(job=>job.kind!=='branch'||!lostBranches.has(job.id));
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
  recordRegionConquests(a,castleId);
  return {newlyOwned,garrison,castleId,castle:source,fallbackHomeId};
}
async function fieldStaffDefense(db,state,clock) {
  // Read the real shared fortification without settling its queue or writing
  // any defender state. Due jobs are projected only for this battle snapshot.
  const row=await stmt(db,"SELECT * FROM staff_base WHERE id='kyoto_gosho'").first(),shared=row?JSON.parse(row.state_json):staffInitialState(clock.elapsedMs);
  for(const job of shared.jobs.filter(j=>j.completesElapsedMs<=clock.elapsedMs).sort((a,b)=>a.completesElapsedMs-b.completesElapsedMs)){if(job.kind==='castle')shared.castleLevel=job.targetLevel;else shared.buildings[job.id]=job.targetLevel;}
  state.castles.kyoto_gosho.level=shared.castleLevel;state.castles.kyoto_gosho.wall=shared.buildings.wall;state.buildings.wall=shared.buildings.wall;if(shared.durability)state.castles.kyoto_gosho.durability=copy(shared.durability);else delete state.castles.kyoto_gosho.durability;
  return row?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[row.revision]}:{sql:"NOT EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho')",args:[]};
}
function marchContext(db,user,now,env=null){
  return {db,user,now,env,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,textField,uid,hash,getUser,getSyncRow,requireAdmin,requireAccountAccess,roleCommitGuard,accountCommitGuard,evaluationRef,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,syncSnapshot,staffBaseDto,reconcileCovertProgress,reconcileBranchProgress,branchStateGuard,branchProgressStatements,covertIncidentStatements,staffPersonalProgressStatement,saveAchievements,achievementStatement,getFieldList,fieldStaffDefense,fieldDefense,fieldRelation,fieldRelationStatus,courtEmperorAuthority,courtImperialAuthority,courtAttackAuthority,registerCourtGuard:()=>{},syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}};
}
async function departFieldMarch({db,user,target,body,now,clock,attacker,attackerRow,defenderRow,defender,castleId,digest,foodCost,courtGuard,sharedGuard,attackerBranches,defenderBranches,protection,support,rally,residencyGuard,attackerEstate,defenderEstate}){
  const a=attacker.state,site=body.targetBranchId?branchSite(body.targetBranchId):null;
  const travel=globalThis.SengokuTravel.plan({sourceCastleId:rally?.stagingCastleId||a.home,targetCastleId:castleId,...(site?{branchDirection:site.direction}:{} )});
  if(!travel)fail(409,'MARCH_ROUTE_UNAVAILABLE','この拠点への進軍経路を確認できません。');
  const attackGame=GameEngine.fromSave(attacker,GAME_OFFICERS,{isSento:!!user.is_sento,isAdmin:!!user.is_admin,isStaff:!!user.is_staff,isDeputy:!!user.is_deputy,courtEstateProjection:attackerEstate.projection});
  const palaceCombatEffects=attackGame.courtEstateCombatEffects(clock.elapsedMs);
  const record=marchRecord({user,requestId:body.requestId,kind:rally?'rally':'field',save:attacker,travel,targetPlayerId:target.id,targetCampaignId:defender.state.walking.campaignId,targetName:target.name+'・'+(site?.name||CASTLE_BY_ID[castleId].name),troops:body.troops,tactic:body.tactic,foodCost,clock,now,digest,payload:{body:{...body},residencyTerm:residencyGuard.term,attackProfile:copy({morale:a.morale,tech:a.tech,army:a.army,officerVariants:a.officerVariants,officerHealth:GameEngine.projectOfficerHealth(a,clock.elapsedMs),...(palaceCombatEffects?{palaceCombatEffects}:{})}),roll:crypto.getRandomValues(new Uint32Array(1))[0]/4294967296,rally:rally?.snapshot||null}});
  if(rally){const payload=JSON.parse(record.payload_json);payload.rally.marchId=record.id;record.payload_json=JSON.stringify(payload);}
  // Rally troops already live in contributor escrow; undo the temporary force
  // added by validation. Ordinary attacks escrow the full outgoing army.
  a.troops-=body.troops;a.resources.rice-=foodCost;a.command-=1;a.march=serverMarchMarker(record);
  const next=normalizeGameSave(attacker,user,now,{clock}),role=withCourtEstateGuard(roleCommitGuard(user),attackerEstate),otherRole=withCourtEstateGuard(roleCommitGuard(target),defenderEstate),[first,second]=pair(user.id,target.id);
  const guards=[role,otherRole,courtGuard,sharedGuard,residencyGuard,attackerBranches.guard,defenderBranches.guard,protection.guard,support.guard,...(rally?[rally.guard]:[])];
  const guard=`EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?) AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1) AND NOT EXISTS(SELECT 1 FROM field_relations WHERE user_a=? AND user_b=? AND status='allied' AND expires_elapsed_ms>?) AND ${guards.map(g=>'('+g.sql+')').join(' AND ')}`;
  const args=[user.id,attackerRow.revision,body.deviceId,now,target.id,defenderRow.revision,WORLD_CLOCK_ID,clock.revision,first,second,clock.elapsedMs,...guards.flatMap(g=>g.args)],gateArgs=[record.id,record.commit_token];
  await db.batch([insertMarch(db,record,guard,args),stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${MARCH_GATE}`,JSON.stringify(next),now,now+SYNC_LEASE,user.id,...gateArgs),...(rally?rallyMarchStatements(db,rally,record.id,MARCH_GATE,gateArgs):[])]);
  const committed=await findMarch(db,user.id,body.requestId);
  if(!committed){await requireAccountAccess(db,user);fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);fail(409,'MARCH_STATE_CHANGED','本拠・目標・同盟の状態が変わりました。最新の状態を確認してください。');}
  return replayMarch(marchContext(db,user,now),committed,body.deviceId,committed.id!==record.id);
}
async function departCampaignMarch(ctx,raw){
  const {db,user,now}=ctx;
  const allowed=['kind','targetId','tactic','troops','requestId','campaignId','deviceId','expectedRevision'];
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(k=>!allowed.includes(k))||!['castle','branch'].includes(raw.kind))fail(400,'INVALID_INPUT','出陣先と種類を確認してください。');
  const body={kind:raw.kind};for(const key of ['targetId','tactic','requestId','campaignId','deviceId'])body[key]=idField(raw[key],key);
  if(!Number.isSafeInteger(raw.expectedRevision)||raw.expectedRevision<0||!Number.isSafeInteger(raw.troops)||raw.troops<300||raw.troops>1000000)fail(400,'INVALID_INPUT','出陣兵数と保存番号を確認してください。');
  body.expectedRevision=raw.expectedRevision;body.troops=raw.troops;
  const digest=await hash(JSON.stringify([body.kind,body.targetId,body.tactic,body.troops,body.campaignId])),old=await findMarch(db,user.id,body.requestId);
  if(old){if(old.request_hash!==digest)fail(409,'REQUEST_ID_REUSED','この操作番号は別の出陣に使用されています。');return replayMarch(ctx,old,body.deviceId);}
  if(await activeMarch(db,user.id))fail(409,'ARMY_MARCHING','本隊が進軍中です。到着後に次の出陣を選べます。');
  const saved=await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now),clock=await getWorldClock(db,now);
  if(!clock.running)fail(409,'WORLD_PAUSED','共通時間が停止中です。');
  const save=normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock});
  if(save.state.walking.campaignId!==body.campaignId)fail(409,'MARCH_SCOPE_CHANGED','物語が切り替わりました。現在の本拠へ同期してください。');
  if(!save.state.worldClock||Math.abs(clock.elapsedMs-save.state.worldClock.elapsedMs)>15000)fail(409,'CLOCK_STALE','本拠と共通時計を同期してから出陣してください。');
  const branchAccess=await branchStateGuard(db,user.id,body.campaignId);await reconcileBranchProgress(db,user.id,save,clock);await reconcileCovertProgress(db,user.id,save);
  const targetId=body.kind==='branch'?branchSite(body.targetId)?.parentCastleId:body.targetId;if(!CASTLE_BY_ID[targetId])fail(400,'INVALID_TARGET','地図から攻撃先を選んでください。');
  const court=await courtAttackAuthority(db,user,save.state.home,targetId),emperor=await courtImperialAuthority(db,user),shared=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
  const maintenanceAuthority=protectMaintenance(branchAccess,await maintenanceContext(db,user.id,save,clock));
  if(maintenanceAuthority.hasMore||maintenanceAuthority.asOfElapsedMs>clock.elapsedMs)fail(409,'CLOCK_STALE','維持費の時間経過を同期しています。最新の保存へ同期してください。');
  const estateEconomy=await courtEstateContext(db,user,save,clock,now);
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,isCourtEmperor:emperor.isCourtEmperor,isCourtRegent:emperor.isCourtRegent,staffBase:shared,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branchAccess.resolvedElapsedMs}});
  const advanced=game.applyWorldClock(clock,{maxSeconds:86400,deferCycleSettlement:true});if(!advanced.ok||advanced.pending||advanced.courtEstatePending||advanced.settlementRequired)fail(409,'CLOCK_STALE','共通時計と本拠を同期してください。');
  const result=body.kind==='branch'?game.departBranchAttack(body.targetId,body.tactic,body.troops):game.departAttack(body.targetId,body.tactic,body.troops);
  if(!result.ok)fail(409,result.code||'MARCH_UNAVAILABLE',result.message);
  const native=copy(game.state.march),record=marchRecord({user,requestId:body.requestId,kind:body.kind,save,travel:native.travel,targetName:body.kind==='branch'?branchSite(body.targetId).name:CASTLE_BY_ID[targetId].name,troops:body.troops,tactic:body.tactic,foodCost:native.foodCost,clock,now,digest,payload:{body,nativeMarch:native}});
  native.id=record.id;native.departedElapsedMs=record.departed_ms;native.arrivesElapsedMs=record.arrives_ms;
  const payload=JSON.parse(record.payload_json);payload.nativeMarch=native;record.payload_json=JSON.stringify(payload);game.state.march=serverMarchMarker(record);
  const next=normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),role=guardLordSupport(roleCommitGuard(user),user),sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:{sql:'1=1',args:[]},cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses?.()||[],now,state:next.state}),guards=[role,estateEconomy.guard,court,branchAccess.guard,sharedGuard,cpuLosses.guard],args=[record.id,record.commit_token];
  const guard=`EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1) AND ${guards.map(g=>'('+g.sql+')').join(' AND ')}`;
  const personal=await staffPersonalProgressStatement(db,user,next,now,MARCH_GATE,args,game.getStaffPersonalProgress?.());
  await db.batch([insertMarch(db,record,guard,[user.id,saved.revision,body.deviceId,now,WORLD_CLOCK_ID,clock.revision,...guards.flatMap(g=>g.args)]),stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=? WHERE user_id=? AND ${MARCH_GATE}`,JSON.stringify(next),now,now+SYNC_LEASE,user.id,...args),...branchProgressStatements(db,user.id,next,now,MARCH_GATE,args,{resolvedElapsedMs:clock.elapsedMs}),...covertIncidentStatements(db,user.id,next,now,MARCH_GATE,args),...cpuLosses.statements(MARCH_GATE,args),...(personal?[personal]:[])]);
  const committed=await findMarch(db,user.id,body.requestId);if(!committed){fieldWriter(await getSyncRow(db,user.id),body.deviceId,body.expectedRevision,now);fail(409,'MARCH_STATE_CHANGED','出陣前の状態が更新されました。最新の本拠を確認してください。');}
  return replayMarch(ctx,committed,body.deviceId,committed.id!==record.id);
}
async function settleCampaignMarch(ctx,march){
  const {db,user,now}=ctx,payload=JSON.parse(march.payload_json),saved=await getSyncRow(db,user.id),clock=await getWorldClock(db,now),save=normalizeGameSave(JSON.parse(saved.save_json),user,now,{reading:true,clock});
  if(save.state.walking.campaignId!==march.campaign_id||save.state.clan!==payload.marker.clan||Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)!==payload.marker.cycle)fail(409,'MARCH_SCOPE_CHANGED','物語・所属・年月が変わったため、進軍を取りやめて帰還しました。');
  const branches=await branchStateGuard(db,user.id,march.campaign_id);await reconcileBranchProgress(db,user.id,save,clock);await reconcileCovertProgress(db,user.id,save);
  const court=await courtAttackAuthority(db,user,march.source_castle_id,march.target_castle_id),emperor=await courtImperialAuthority(db,user),shared=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
  save.state.march=payload.nativeMarch;
  const maintenanceAuthority=protectMaintenance(branches,await maintenanceContext(db,user.id,save,clock));
  if(maintenanceAuthority.hasMore||maintenanceAuthority.asOfElapsedMs>clock.elapsedMs)fail(409,'MARCH_RETRY','維持費の時間経過を同期しています。');
  const estateEconomy=await courtEstateContext(db,user,save,clock,now);
  const game=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateEconomy.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,isCourtEmperor:emperor.isCourtEmperor,isCourtRegent:emperor.isCourtRegent,staffBase:shared,maintenanceAuthority,branchAuthority:{resolvedElapsedMs:branches.resolvedElapsedMs}});
  const advanced=game.applyWorldClock(clock,{maxSeconds:86400,deferCycleSettlement:true});if(!advanced.ok||advanced.pending||advanced.courtEstatePending||advanced.settlementRequired)fail(409,'MARCH_RETRY','到着した部隊の本拠を同期しています。');
  game.resolveDueMarches();const outcome=game.state.marchHistory.find(x=>x.id===march.id);if(!outcome)fail(409,'MARCH_RETRY','到着した部隊の戦況を確認しています。');
  const next=normalizeGameSave(JSON.parse(game.exportSave()),user,now,{clock}),nonce=crypto.randomUUID(),role=guardLordSupport(roleCommitGuard(user),user),sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:{sql:'1=1',args:[]},cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:game.takeHomeDefenseLosses?.()||[],now,state:next.state}),guards=[role,estateEconomy.guard,court,branches.guard,sharedGuard,cpuLosses.guard],result={battle:outcome.battle||null,message:outcome.message,resolvedAt:iso(now)},gate="EXISTS(SELECT 1 FROM battle_marches WHERE id=? AND commit_token=? AND status IN ('resolved','cancelled'))",args=[march.id,nonce];
  const statements=[stmt(db,`UPDATE battle_marches SET status=?,result_json=?,commit_token=?,revision=revision+1,updated_at=? WHERE id=? AND status='marching' AND revision=? AND arrives_ms<=? AND EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND revision=?) AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=?) AND ${guards.map(g=>'('+g.sql+')').join(' AND ')} RETURNING id`,outcome.status,JSON.stringify(result),nonce,now,march.id,march.revision,clock.elapsedMs,user.id,saved.revision,WORLD_CLOCK_ID,clock.revision,...guards.flatMap(g=>g.args)),stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=? WHERE user_id=? AND ${gate}`,JSON.stringify(next),now,user.id,...args),...branchProgressStatements(db,user.id,next,now,gate,args,{resolvedElapsedMs:clock.elapsedMs}),...covertIncidentStatements(db,user.id,next,now,gate,args),...campaignShogunateStatements({db,user,save:next,now,gateSql:gate,gateArgs:args})];
  statements.push(...cpuLosses.statements(gate,args));
  for(const event of saveAchievements(save,next))statements.push(achievementStatement(db,user.id,event,now,gate,args));
  const personal=await staffPersonalProgressStatement(db,user,next,now,gate,args,game.getStaffPersonalProgress?.());if(personal)statements.push(personal);
  const done=await db.batch(statements);if(!rows(done[0]).length)fail(409,'MARCH_RETRY','到着時の本拠が更新されました。再確認しています。');
}
const MARCH_RETRY_ERRORS=new Set(['MARCH_RETRY','CLOCK_STALE','MAINTENANCE_REFRESH_REQUIRED','COURT_ESTATE_REFRESH_REQUIRED','WORLD_CLOCK_CHANGED','REVISION_CONFLICT','FIELD_STATE_CHANGED','BRANCH_STATE_CHANGED','STAFF_BASE_CHANGED','CYCLE_SETTLEMENT_REQUIRED','WORLD_PAUSED']);
async function settleBattleMarches(ctx,{actorId=null,limit=12}={}){
  const {db,now}=ctx,clock=await getWorldClock(db,now);if(!clock.running)return;
  const due=rows(await stmt(db,`SELECT * FROM battle_marches WHERE status='marching' AND arrives_ms<=?${actorId?' AND actor_id=?':''} ORDER BY arrives_ms,id LIMIT ?`,clock.elapsedMs,...(actorId?[actorId]:[]),Math.min(40,limit)).all());
  for(const march of due){
    const user=await getUser(db,march.actor_id);if(!user)continue;
    const own=marchContext(db,user,now,ctx.env),payload=JSON.parse(march.payload_json);
    try{
      if(user.ban_active)fail(409,'MARCH_ACCESS_CHANGED','利用状況が変わったため、進軍を取りやめて帰還しました。');
      await requireAccountAccess(db,user);
      if(march.kind==='field'||march.kind==='rally'){
        const saved=await getSyncRow(db,user.id);
        await fieldAttack(db,user,{...payload.body,expectedRevision:Number(saved?.revision||0)},now,{march,rallyId:payload.rally?.operationId});
      }else if(march.kind==='roaming'&&!(payload.imported&&!payload.body.unitId))await settleRoamingMarch(own,march);
      else await settleCampaignMarch(own,march);
    }catch(error){
      // Revision/clock races are retried against a fresh snapshot next tick.
      // Gameplay changes cancel only this departure and refund exactly once.
      if(!(error instanceof ApiError)||MARCH_RETRY_ERRORS.has(error.code))continue;
      await cancelBattleMarch(own,march,error.message,(gate,args)=>march.kind==='rally'?rallyMarchCancellation(db,march,gate,args):[]);
    }
  }
}
async function anchorImportedSave(db,user,save,clock,now){
  if(save.state.worldClock)return;
  // Use the same migration for the campaign, health and any remaining journey.
  // Local elapsed time must never be compared with the shared clock directly.
  // This first attachment moves the time basis without simulating elapsed
  // income/upkeep. World maintenance authority is checked after that move.
  const shared=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null,game=GameEngine.fromSave(save,GAME_OFFICERS,{isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:shared});
  const migrated=game.applyWorldClock(clock);if(!migrated.ok||migrated.pending)fail(409,'CLOCK_ANCHOR_REQUIRED','共通時計を確認してから保存を同期してください。');
  game.state.cycle.latestReward=null;if(game.state.march?.authority==='local')game.state.march.cycle=game.state.cycle.index;
  Object.assign(save,JSON.parse(game.exportSave()));
}
async function promoteImportedMarch(db,user,save,clock,now){
  let native=save.state.march;if(!native||native.authority!=='local')return null;
  if(native.troops>1000000)fail(409,'MARCH_FORCE_LIMIT','オンラインの進軍は1,000,000人以内の部隊で行ってください。');
  if(!save.state.worldClock){await anchorImportedSave(db,user,save,clock,now);native=save.state.march;}
  const requestId=native.kind==='roaming'?native.options.requestId:'import_'+native.id;
  const prior=await findMarch(db,user.id,requestId);if(prior)fail(409,'MARCH_ALREADY_RECORDED','この保存の進軍はすでに登録または完了しています。最新の本拠へ同期してください。');
  const body=native.kind==='roaming'?{...native.options,encounterId:native.encounterId,troops:native.troops,tactic:native.tactic,deviceId:'imported-march',expectedRevision:0}:{kind:native.kind,targetId:native.targetBranchId||native.targetCastleId,tactic:native.tactic,troops:native.troops,campaignId:native.campaignId,deviceId:'imported-march',expectedRevision:0};
  const record=marchRecord({user,requestId,kind:native.kind,save,travel:native.travel,targetName:native.travel.targetName,troops:native.troops,tactic:native.tactic,foodCost:native.foodCost,commandCost:native.commandCost,clock:{...clock,elapsedMs:native.departedElapsedMs},now,digest:await hash(JSON.stringify(native.kind==='roaming'?[body.campaignId,body.sequence,body.encounterId,body.tactic,body.troops,...(body.unitId?[body.unitId,body.castleId,body.deploymentRevision]:[])]:['imported-march',native.id])),payload:{body,nativeMarch:{...native},imported:true,...(native.kind==='roaming'?{deploymentRevision:native.options.deploymentRevision,unit:native.options.deploymentUnit}:{} )}});
  const payload=JSON.parse(record.payload_json);payload.nativeMarch.id=record.id;record.payload_json=JSON.stringify(payload);save.state.march=serverMarchMarker(record);return record;
}
async function backgroundMarchSweep(env,now){
  // One bounded sweep per real second across all requests. Cron can also call
  // the same settlers; an open browser is never needed to retain progress.
  const tick=await stmt(env.DB,"INSERT INTO settings(key,value,updated_at) VALUES('battleMarchTick',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at WHERE settings.updated_at<=? RETURNING key",String(now),now,now-1000).first();
  if(!tick)return;
  await settleShogunateApprovals(env.DB,now);
  const context=marchContext(env.DB,null,now,env);await settleBattleMarches(context,{limit:8});await settleConquestMarches(context);await settleCovertDispatches(context,{limit:4});await settleAllianceUnits(context);
}
async function marchStatus(ctx,url){
  await settleBattleMarches(ctx,{actorId:ctx.user.id,limit:4});
  await settleConquestMarches(ctx);
  const covertCtx=marchContext(ctx.db,ctx.user,ctx.now,ctx.env);await settleCovertDispatches(covertCtx,{actorId:ctx.user.id,limit:1});
  const covert=await covertMarches(covertCtx);
  const clock=await getWorldClock(ctx.db,ctx.now),normal=await battleMarches(ctx.db,ctx.user.id,clock,ctx.now),conquest=await conquestMarches(ctx),snapshot=await syncSnapshot(ctx.db,await getSyncRow(ctx.db,ctx.user.id),ctx.user,url.searchParams.get('deviceId'),ctx.now);
  return {...snapshot,ok:true,serverNow:iso(ctx.now),clock,active:[...normal.active,...(conquest?.active||[]),...covert.active],history:[...normal.history,...(conquest?.history||[]),...covert.history].sort((a,b)=>b.arrivesAtMs-a.arrivesAtMs).slice(0,30)};
}

async function fieldAttack(db,user,raw,now,internal={}) {
  const body=fieldRequestBody(raw,'attack'),intent=['attack',body.targetPlayerId,body.troops,body.tactic];
  if(body.targetCastleId!==undefined)intent.push(body.targetCastleId);
  if(body.targetBranchId!==undefined)intent.push(body.targetBranchId);
  if(internal.rallyId)intent.push({rallyId:internal.rallyId});
  const digest=await hash(JSON.stringify(intent)),prior=await priorFieldRequest(db,user.id,body,'attack',digest);if(prior)return fieldReplayAttack(db,user,body,prior,now);
  const flight=internal.march||null,flightPayload=flight?JSON.parse(flight.payload_json):null;
  const existingMarch=await findMarch(db,user.id,body.requestId);
  if(existingMarch&&existingMarch.request_hash!==digest)fail(409,'REQUEST_ID_REUSED','この操作番号は別の出陣に使用されています。');
  if(!flight&&existingMarch)return replayMarch(marchContext(db,user,now),existingMarch,body.deviceId);
  if(flight&&(!existingMarch||existingMarch.id!==flight.id||existingMarch.status!=='marching'||existingMarch.revision!==flight.revision))return existingMarch?replayMarch(marchContext(db,user,now),existingMarch,body.deviceId):null;
  if(!flight&&(await activeMarch(db,user.id)))fail(409,'ARMY_MARCHING','本隊が進軍中です。到着後に次の出陣を選べます。');
  const rally=internal.rallyId?await prepareRallyAttack(db,user,internal.rallyId,now,{fail,idField,accountCommitGuard,roleCommitGuard,requireAccountAccess},flightPayload?.rally||null):null;
  if(rally&&(rally.targetPlayerId!==body.targetPlayerId||rally.targetCastleId!==body.targetCastleId||rally.targetBranchId!==body.targetBranchId||rally.tactic!==body.tactic||rally.troops!==body.troops))fail(409,'RALLY_CHANGED','作戦の目標と集結兵数を確認してください。');
  if(body.targetPlayerId===user.id)fail(400,'INVALID_TARGET','自分の城には出陣できません。');
  await budget(db,'field-attack:'+user.id,30,60000,now);
  const target=await getUser(db,body.targetPlayerId);if(!target||target.ban_active)fail(404,'FIELD_PLAYER_NOT_FOUND','相手の本拠が見つかりません。');
  const attackerRow=flight?await getSyncRow(db,user.id):await settleWriterCycle(db,user,body.deviceId,body.expectedRevision,now);
  if(flight&&Number(attackerRow?.revision)!==body.expectedRevision)fail(409,'MARCH_RETRY','進軍中の本拠が更新されました。');
  let defenderRow=await getSyncRow(db,target.id);if(!defenderRow?.save_json)fail(404,'FIELD_PLAYER_NOT_FOUND','相手の本拠はまだ共有されていません。');
  // Every base now risks its owner's resources. Settle both campaigns before
  // quoting a balance, including bases whose ownership and troops are protected.
  defenderRow=await settlePlayerCycle(db,defenderRow,target,now,undefined,{deferActive:true});
  const clock=await getWorldClock(db,now);if(!clock.running)fail(409,'WORLD_PAUSED','世界の共通時間が停止中です。');
  const journey=flight?await advanceReservedMarch(marchContext(db,user,now),attackerRow,clock):null;
  const defenderJourney=flight?await advanceReservedMarch(marchContext(db,target,now),defenderRow,clock):null;
  const attacker=journey?.save||normalizeGameSave(JSON.parse(attackerRow.save_json),user,now,{reading:true,clock}),defender=defenderJourney?.save||normalizeGameSave(JSON.parse(defenderRow.save_json),target,now,{reading:true,clock}),a=attacker.state,d=defender.state;
  const attackerEstate=await courtEstateContext(db,user,attacker,clock,now),defenderEstate=await courtEstateContext(db,target,defender,clock,now);
  if(flight&&(clock.elapsedMs<flight.arrives_ms||a.walking.campaignId!==flight.campaign_id||d.walking.campaignId!==flight.target_campaign_id||Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)!==flightPayload.marker.cycle||a.clan!==flightPayload.marker.clan||a.castles[rally?a.home:flight.source_castle_id]?.owner!==a.clan))fail(409,'MARCH_TARGET_CHANGED','進軍中に物語・拠点・年月が変わったため帰還しました。');
  if(flight)a.march=null;
  const attackerBranches=journey?.branches||await branchStateGuard(db,user.id,a.walking.campaignId),defenderBranches=defenderJourney?.branches||await branchStateGuard(db,target.id,d.walking.campaignId);
  if(!journey)await reconcileBranchProgress(db,user.id,attacker,clock);if(!defenderJourney)await reconcileBranchProgress(db,target.id,defender,clock,{projectToClock:true});
  const defenderHomeBefore=d.home,castleId=flight?.target_castle_id||body.targetCastleId||d.home,regionProtected=isRegionProtectedCastle(d,castleId),battleMode=body.targetBranchId?'branch':fieldBattleMode(target,castleId,{legacy:body.targetCastleId===undefined,regionProtected});
  const courtGuard=await courtAttackAuthority(db,user,flight?.source_castle_id||rally?.stagingCastleId||a.home,castleId);
  const residencyGuard=await residencyTargetGuard(db,{attackerId:user.id,targetId:target.id,castleId,isHome:castleId===d.home&&!body.targetBranchId,term:flightPayload?.residencyTerm||null,now,fail});
  const protection=await prepareProtection(db,user,target,now,{reward:battleMode==='reward',fail});
  const support=await getAllianceDefense(db,target,castleId,now);
  if(rally)a.troops+=rally.troops;else if(flight)a.troops+=Number(flight.troops);
  if(castleId!==d.home&&(['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(castleId)||d.castles[castleId]?.owner!==d.clan))fail(409,'FIELD_TARGET_CHANGED','この領主の攻撃可能な城ではありません。共有地図を更新してください。');
  const branch=body.targetBranchId?d.branches.find(branch=>branch.id===body.targetBranchId&&branch.parentCastleId===castleId):null;
  if(body.targetBranchId&&(!branch||branch.level<1||branch.fallen||branch.retreating))fail(409,'BRANCH_TARGET_CHANGED','この支拠点は建設中、陥落済み、または配置が変更されています。地図を更新してください。');
  if(!body.targetBranchId&&d.branches.some(branch=>branch.parentCastleId===castleId&&branch.level>0&&!branch.fallen&&!branch.retreating))fail(409,'BRANCHES_REQUIRED','大都市拠点へ攻めるには、残っている支拠点をすべて先に陥落させてください。');
  if(Number(attackerRow.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)||Number(defenderRow.cycle_index)<Math.floor(clock.elapsedMs/WORLD_CYCLE_MS))fail(409,'CYCLE_SETTLEMENT_REQUIRED','領地の精算中です。共有地図を更新してください。');
  if(a.gameOver||d.gameOver)fail(409,'BASE_UNAVAILABLE','本拠を失っている領主とは戦えません。');
  if(!a.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','先に共通時計へ同期してください。');
  if(!flight&&clock.elapsedMs-a.worldClock.elapsedMs>15000)fail(409,'CLOCK_STALE','共通時計と本拠を同期してから出陣してください。');
  const relation=await fieldRelation(db,user.id,target.id);if(fieldRelationStatus(relation,user.id,clock.elapsedMs)==='allied')fail(409,'ALLIED_TARGET','同盟期間中の相手には出陣できません。');
  const cooldown=await stmt(db,'SELECT MAX(occurred_elapsed_ms) AS last FROM field_battles WHERE attacker_id=?',user.id).first();
  if(cooldown.last!==null&&Number(cooldown.last)+FIELD_RULES.attackCooldownMs>clock.elapsedMs)fail(409,'ATTACK_COOLDOWN','次の出陣まで共通時間で60秒お待ちください。');
  const sharedShield=battleMode==='reward'&&castleId==='kyoto_gosho';
  const shield=await stmt(db,"SELECT MAX(occurred_elapsed_ms) AS last FROM field_battles WHERE defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho')",target.id,sharedShield?1:0).first();
  if(shield.last!==null&&Number(shield.last)+FIELD_RULES.defenderProtectionMs>clock.elapsedMs)fail(409,'TARGET_PROTECTED','相手は襲撃後の保護期間です。');
  const covertShield=await stmt(db,"SELECT MAX(occurred_elapsed_ms) AS last FROM covert_battles WHERE defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho')",target.id,sharedShield?1:0).first();
  if(covertShield.last!==null&&Number(covertShield.last)+FIELD_RULES.defenderProtectionMs>clock.elapsedMs)fail(409,'TARGET_PROTECTED','相手は襲撃後の保護期間です。');
  const tactic=FIELD_RULES.tactics.find(t=>t.id===body.tactic),foodCost=Math.ceil(body.troops*FIELD_RULES.foodPerTroop*tactic.food)+FIELD_RULES.foodBase;
  if(body.troops>a.troops||!flight&&(a.command<1||a.resources.rice<foodCost))fail(409,'INSUFFICIENT_FORCE','兵数・指示・兵糧が足りません。');
  // Shared palace fortifications are a combat projection, not personal save data.
  const defenseState=copy(d),sharedGuard=sharedShield?await fieldStaffDefense(db,defenseState,clock):{sql:'1=1',args:[]};
  const defenseGame=GameEngine.fromSave(defender,GAME_OFFICERS,{isSento:!!target.is_sento,isAdmin:!!target.is_admin,isStaff:!!target.is_staff,isDeputy:!!target.is_deputy,courtEstateProjection:defenderEstate.projection});
  defenseState.palaceCombatEffects=defenseGame.courtEstateCombatEffects(clock.elapsedMs);
  if(!flight)return departFieldMarch({db,user,target,body,now,clock,attacker,attackerRow,defenderRow,defender,castleId,digest,foodCost,courtGuard,sharedGuard,attackerBranches,defenderBranches,protection,support,rally,residencyGuard,attackerEstate,defenderEstate});
  d.officerHealth=GameEngine.projectOfficerHealth(d,clock.elapsedMs);
  const defenderDurability=branch?branchDurability(branch,clock.elapsedMs):castleDurability(d,castleId,clock.elapsedMs);
  if(branch&&branch.durability)branch.durability=durabilityRecord(defenderDurability);
  if(!branch&&castleId!=='kyoto_gosho'&&d.castles[castleId].durability)d.castles[castleId].durability=durabilityRecord(defenderDurability);
  const attackProfile=flightPayload.attackProfile;
  const attackerBefore=journey?.before||copy(attacker),attackPower=fieldAttackPower(body.troops,attackProfile,tactic.modifier);
  const defense=branch?fieldBranchDefense(d,branch,tactic.id,attackProfile.tech.siege):fieldDefense({...defenseState,castles:{...defenseState.castles,[castleId]:{...defenseState.castles[castleId],troops:defenseState.castles[castleId].troops+support.troops}}},tactic.id,attackProfile.tech.siege,castleId),ratio=attackPower/defense.power,chance=Math.max(.05,Math.min(.95,.5+Math.log(ratio)*.6));
  const roll=rally?rally.roll:flightPayload.roll,won=roll<chance;
  const attackerLost=Math.min(body.troops,Math.max(1,Math.floor(body.troops*Math.min(.35,(won?.08+.06/Math.max(.3,ratio):.2+.06/Math.max(.3,ratio))*tactic.loss))));
  const castle=d.castles[castleId],protectedForces=battleMode==='reward'||!!branch,defenderLost=protectedForces?{troops:0,garrison:0}:{troops:Math.min(Math.floor(d.troops*.1),Math.floor(body.troops*(won?.04:.015))),garrison:Math.min(Math.floor(castle.troops*.1),Math.floor(body.troops*(won?.08:.03)))};
  a.troops-=attackerLost;if(!flight){a.resources.rice-=foodCost;a.command-=1;}
  if(!protectedForces){d.troops-=defenderLost.troops;castle.troops-=defenderLost.garrison;d.morale=Math.max(0,d.morale-2);}
  const structuralDamage=battleMode==='reward'?null:GameEngine.durabilityAfterBattle(defenderDurability,{won,ratio,captured:won&&battleMode==='capture',elapsedMs:clock.elapsedMs});
  if(structuralDamage)(branch||castle).durability=structuralDamage.record;
  if(branch&&won){branch.fallen=true;d.jobs=d.jobs.filter(job=>job.kind!=='branch'||job.id!==branch.id);}
  // The sole resource reward is a conserved transfer from the defeated owner.
  // Branch and special-base victories use the same rule; force ratio never
  // discounts it. Capacity overflow stays with the defender, never disappears.
  const {loot,capacityLimited}=applyFieldVictoryLoot(a.resources,d.resources,won);
  const rewards=Object.fromEntries(RESOURCES.map(key=>[key,0]));
  const captured=won&&battleMode==='capture',captureChange=captured?fieldCaptureCastle(a,d,castleId,body.troops,attackerLost):null;
  if(captureChange?.newlyOwned&&structuralDamage)a.castles[castleId].durability=structuralDamage.record;
  const capture={captured,castleId,castleName:CASTLE_BY_ID[castleId].name,attackerPlayerId:user.id,defenderPlayerId:target.id,defenderHomeCastleId:d.home,defenderHomeCastleName:CASTLE_BY_ID[d.home].name,newlyOwned:!!captureChange?.newlyOwned,garrison:captureChange?.garrison||0};
  if(battleMode!=='branch'){a.stats.battles=Math.min(10000000,a.stats.battles+1);if(won)a.stats.wins=Math.min(a.stats.battles,a.stats.wins+1);}
  a.morale=Math.max(0,Math.min(100,a.morale+(won?3:-5)));
  const battle={id:uid('fb_'),requestId:body.requestId,attackerPlayerId:user.id,attackerName:user.name,defenderPlayerId:target.id,defenderName:target.name,castleId,castleName:CASTLE_BY_ID[castleId].name,battleMode,won,tactic:body.tactic,troops:body.troops,attackerLost,defenderLost,foodCost,loot,rewards,lootPolicy:FIELD_LOOT_POLICY.id,lootFraction:FIELD_LOOT_POLICY.fraction,lootCapacityLimited:capacityLimited,capture,attackPower,defensePower:defense.power,winChance:Math.round(chance*100),occurredElapsedMs:clock.elapsedMs,createdAt:iso(now),attackerRevision:Number(attackerRow.revision)+1,defenderRevision:Number(defenderRow.revision)+1,nextAttackElapsedMs:clock.elapsedMs+FIELD_RULES.attackCooldownMs,defenderProtectedUntilElapsedMs:clock.elapsedMs+FIELD_RULES.defenderProtectionMs};
  if(structuralDamage)battle.durability=structuralDamage;
  const succession=won&&castleId===defenderHomeBefore&&!branch&&battleMode!=='reward'?await prepareResidencySuccession(db,{userId:target.id,castleId,battleId:battle.id,kind:'field',now}):{guard:{sql:'1=1',args:[]},succession:null,statements:()=>[]};
  if(succession.succession)battle.succession=succession.succession;
  const cpuLosses=await prepareResidencyCpuLosses(db,{userId:user.id,events:journey?.game.takeHomeDefenseLosses?.()||[],now,state:a});
  const defenderCpuLosses=await prepareResidencyCpuLosses(db,{userId:target.id,events:defenderJourney?.game.takeHomeDefenseLosses?.()||[],now,state:d});
  defenderBranches.guard={sql:defenderBranches.guard.sql+' AND '+defenderCpuLosses.guard.sql,args:[...defenderBranches.guard.args,...defenderCpuLosses.guard.args]};
  if(rally)rally.applyResult(battle,a);
  GameEngine.recordOfficerBattleState(a,{key:'field:'+battle.id,won,role:'siege',army:attackProfile.army,elapsedMs:clock.elapsedMs});
  if(battleMode!=='reward')GameEngine.recordOfficerBattleState(d,{key:'field:'+battle.id,won:!won,role:'defense',army:branch?branch.commanders:d.army,elapsedMs:clock.elapsedMs});
  battle.analysis={attackPower,defensePower:defense.power,ratio,winChance:Math.round(chance*100),morale:attackProfile.morale,tactic:tactic.name,roll:Math.round(roll*10000)/10000,reinforcementTroops:branch?0:support.troops,lootScale:1,explanation:won?'戦力と戦法を反映した確率判定で勝利しました。':chance>=.5?'自軍が有利な予想でしたが、確率判定で敗れました。':'敵の守備戦力が優勢でした。士気・研究・兵数・戦法を見直せます。'};
  if(branch)Object.assign(battle,{branchId:branch.id,branchName:branchSite(branch.id).name,branchFallen:!!branch.fallen});
  a.log.unshift({turn:a.turn,text:`${target.name}の${battle.branchName||battle.castleName}へ出陣。${won?branch?'支拠点を陥落':captured?'城を占領':battleMode==='reward'?'勝利報酬を獲得':'戦利品を得て帰還':'撤退'}、兵${attackerLost}人を失いました。`,kind:'pvp'});a.log=a.log.slice(0,200);attacker.savedAt=iso(now);
  {d.log.unshift({turn:d.turn,text:branch?`${battle.branchName}が${user.name}の攻撃を${won?'受けて陥落':'撃退'}しました。`:`${user.name}の襲撃を受け、兵${defenderLost.troops+defenderLost.garrison}人を失いました。${captured?battle.castleName+'を失い、'+capture.defenderHomeCastleName+'を本拠として継続します。':''}`,kind:'pvp'});d.log=d.log.slice(0,200);defender.savedAt=iso(now);}
  const attackerNext=normalizeGameSave(attacker,user,now,{clock}),defenderNext=normalizeGameSave(defender,target,now,{clock});
  const attackerJson=JSON.stringify(attackerNext),defenderJson=defenderNext?JSON.stringify(defenderNext):null,resultJson=JSON.stringify(battle),nonce=crypto.randomUUID(),[first,second]=pair(user.id,target.id),roleGuard=withCourtEstateGuard(roleCommitGuard(user),attackerEstate),targetRoleGuard=withCourtEstateGuard(roleCommitGuard(target),defenderEstate);
  const gate='EXISTS(SELECT 1 FROM field_requests WHERE actor_id=? AND request_id=? AND commit_token=?)',gateArgs=[user.id,body.requestId,nonce];
  // The receipt gates both campaigns, personal staff metadata and the public
  // battle. Revisions and roles are checked in the same atomic D1 batch.
  const statements=[
    stmt(db,`INSERT INTO field_requests(actor_id,request_id,kind,request_hash,commit_token,result_json,created_at)
      SELECT ?,?,'attack',?,?,?,? FROM player_saves a JOIN player_saves d ON d.user_id=?
      WHERE a.user_id=? AND a.revision=? AND (?=1 OR (a.writer_device_id=? AND a.lease_expires_at>?))
      AND d.revision=? AND EXISTS(SELECT 1 FROM battle_marches WHERE id=? AND actor_id=a.user_id AND status='marching' AND revision=? AND arrives_ms<=?) AND d.save_json IS NOT NULL AND ${roleGuard.sql} AND ${targetRoleGuard.sql} AND ${sharedGuard.sql} AND ${courtGuard.sql} AND ${residencyGuard.sql} AND ${succession.guard.sql} AND ${cpuLosses.guard.sql} AND ${attackerBranches.guard.sql} AND ${defenderBranches.guard.sql} AND ${protection.guard.sql} AND ${support.guard.sql} AND ${rally?.guard.sql||'1=1'}
      AND EXISTS(SELECT 1 FROM world_clock WHERE id=? AND revision=? AND running=1)
      AND NOT EXISTS(SELECT 1 FROM field_relations WHERE user_a=? AND user_b=? AND status='allied' AND expires_elapsed_ms>? AND updated_elapsed_ms>=?)
      AND NOT EXISTS(SELECT 1 FROM field_battles WHERE attacker_id=? AND occurred_elapsed_ms>?)
      AND NOT EXISTS(SELECT 1 FROM field_battles WHERE (defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho')) AND occurred_elapsed_ms>?)
      AND NOT EXISTS(SELECT 1 FROM covert_battles WHERE (defender_id=? OR (?=1 AND json_extract(result_json,'$.castleId')='kyoto_gosho')) AND occurred_elapsed_ms>?)
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,body.requestId,digest,nonce,resultJson,now,target.id,user.id,body.expectedRevision,flight?1:0,body.deviceId,now,defenderRow.revision,flight.id,flight.revision,clock.elapsedMs,...roleGuard.args,...targetRoleGuard.args,...sharedGuard.args,...courtGuard.args,...residencyGuard.args,...succession.guard.args,...cpuLosses.guard.args,...attackerBranches.guard.args,...defenderBranches.guard.args,...protection.guard.args,...support.guard.args,...(rally?.guard.args||[]),WORLD_CLOCK_ID,clock.revision,first,second,clock.elapsedMs,Math.floor(clock.elapsedMs/WORLD_CYCLE_MS)*WORLD_CYCLE_MS,user.id,clock.elapsedMs-FIELD_RULES.attackCooldownMs,target.id,sharedShield?1:0,clock.elapsedMs-FIELD_RULES.defenderProtectionMs,target.id,sharedShield?1:0,clock.elapsedMs-FIELD_RULES.defenderProtectionMs),
    stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home=? WHERE user_id=? AND ${gate}`,attackerJson,now,attackerNext.state.cycle?.home||attackerNext.state.home,user.id,...gateArgs)
  ];
  statements.push(...succession.statements(gate,gateArgs),...cpuLosses.statements(gate,gateArgs),...defenderCpuLosses.statements(gate,gateArgs));
  // Record the last eligible castle in the same receipt-gated transaction as
  // its capture. A following cycle settlement may immediately reset holdings.
  if(captured)statements.push(...campaignShogunateStatements({db,user,save:attackerNext,now,gateSql:gate,gateArgs}));
  statements.push(...protectionBattleStatements(db,target.id,now,protection.shieldUntil,gate,gateArgs));
  statements.push(...support.statements(battle,gate,gateArgs));
  if(rally)statements.push(...rally.statements(battle,gate,gateArgs));
  statements.push(finishMarchStatement(db,flight,'resolved',{battle,message:battle.won?'到着し、合戦に勝利しました。':'到着後の合戦を終え、生存兵が帰還しました。'},now,gate,gateArgs));
  statements.push(...branchProgressStatements(db,user.id,attackerNext,now,gate,gateArgs,{resolvedElapsedMs:Math.min(clock.elapsedMs,attackerNext.state.worldClock?.elapsedMs||0)}));
  if(defenderNext){statements.push(stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,cycle_home=? WHERE user_id=? AND ${gate}`,defenderJson,now,defenderNext.state.cycle?.home||defenderNext.state.home,target.id,...gateArgs));statements.push(...branchProgressStatements(db,target.id,defenderNext,now,gate,gateArgs,{resolvedElapsedMs:clock.elapsedMs}));}
  statements.push(...covertIncidentStatements(db,user.id,attackerNext,now,gate,gateArgs));
  const attackerPersonal=await staffPersonalProgressStatement(db,user,attackerNext,now,gate,gateArgs,journey?.game.getStaffPersonalProgress?.());if(attackerPersonal)statements.push(attackerPersonal);
  if(defenderNext){const personal=await staffPersonalProgressStatement(db,target,defenderNext,now,gate,gateArgs,defenderJourney?.game.getStaffPersonalProgress?.(),captureChange,{exactHomeTroops:true,committedCastleId:castleId});if(personal)statements.push(personal);
    if(defenderJourney){statements.push(...covertIncidentStatements(db,target.id,defenderNext,now,gate,gateArgs));for(const event of saveAchievements(defenderJourney.before,defenderNext))statements.push(achievementStatement(db,target.id,event,now,gate,gateArgs));}
  }
  for(const event of saveAchievements(attackerBefore,attackerNext))statements.push(achievementStatement(db,user.id,event,now,gate,gateArgs));
  statements.push(stmt(db,`INSERT INTO field_battles(id,attacker_id,defender_id,defender_campaign_id,occurred_elapsed_ms,result_json,created_at) SELECT ?,?,?,?,?,?,? WHERE ${gate}`,battle.id,user.id,target.id,d.walking.campaignId,clock.elapsedMs,resultJson,now,...gateArgs));
  statements.push(...await fieldBattleMailStatements(db,battle,{attacker:a.home,defenderBefore:defenderHomeBefore,defenderAfter:d.home,defenderLevel:d.castles[d.home].level},now,gate,gateArgs));
  statements.push(...externalTroopSnapshotStatements(db,[...(support.maintenanceOwnerIds||[]),...(rally?.maintenanceOwnerIds||[])],clock,gate,gateArgs));
  const result=await db.batch(statements);
  if(!rows(result[0]).length){const completed=await priorFieldRequest(db,user.id,body,'attack',digest);if(completed)return fieldReplayAttack(db,user,body,completed,now);if(flight)fail(409,'MARCH_RETRY','到着時の状態が更新されました。再確認しています。');const replay=await fieldCommitFailure(db,user,body,'attack',digest,clock,now);return fieldReplayAttack(db,user,body,replay,now);}
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
  if(body.action==='appoint'&&(await getUser(db,targetId)).is_deputy)fail(409,'DEPUTY_CONFLICT','先にサブ運営を解雇してから、京都御所へ任命してください。');
  const check=prior=>{if(prior&&(prior.target_id!==targetId||prior.action!==body.action))fail(409,'REQUEST_ID_REUSED','この操作番号は別のスタッフ操作に使われています。');return prior;};
  const prior=check(await stmt(db,'SELECT target_id,action FROM staff_role_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first());
  const respond=async idempotent=>({ok:true,user:mapUser(await getUser(db,targetId),now),staff:await staffRoster(db,now),action:body.action,idempotent});
  if(prior)return respond(true);
  if(body.action==='appoint'&&(await getUser(db,targetId)).expulsion_pending)fail(409,'EXPULSION_PENDING','追放後の拠点を選び直してから、京都御所へ任命してください。');
  await budget(db,'staff-role:'+user.id,30,60000,now);
  const roleClock=await getWorldClock(db,now),nonce=crypto.randomUUID(),guard='EXISTS(SELECT 1 FROM staff_role_requests WHERE actor_id=? AND request_id=? AND commit_token=?)';
  const mutation=body.action==='appoint'
    ?stmt(db,`INSERT INTO staff_members(user_id,appointed_by,appointed_at,term_id,appointed_elapsed_ms) SELECT ?,?,?,?,? WHERE ${guard} ON CONFLICT(user_id) DO NOTHING RETURNING user_id`,targetId,user.id,now,nonce,roleClock.elapsedMs,user.id,requestId,nonce)
    :stmt(db,`DELETE FROM staff_members WHERE user_id=? AND ${guard} RETURNING user_id`,targetId,user.id,requestId,nonce);
  const result=await db.batch([
    stmt(db,`INSERT INTO staff_role_requests(actor_id,request_id,target_id,action,commit_token,created_at)
      SELECT ?,?,?,?,?,? FROM users target WHERE target.id=? AND target.id<>?
      AND EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?) AND (?='dismiss' OR (NOT EXISTS(SELECT 1 FROM deputy_operator_state WHERE user_id=target.id) AND NOT EXISTS(SELECT 1 FROM player_expulsions WHERE user_id=target.id AND pending=1)))
      ON CONFLICT(actor_id,request_id) DO NOTHING RETURNING request_id`,user.id,requestId,targetId,body.action,nonce,now,targetId,user.id,user.id,body.action),
    ...(body.action==='dismiss'?[stmt(db,`UPDATE staff_campaign_backups SET left_elapsed_ms=COALESCE(left_elapsed_ms,?),updated_at=? WHERE user_id=? AND active=1 AND ${guard}`,roleClock.elapsedMs,now,targetId,user.id,requestId,nonce)]:[]),
    mutation,
    ...courtEstateSnapshotStatements(db,roleClock,guard,[user.id,requestId,nonce])
  ]);
  if(!rows(result[0]).length) {
    const current=check(await stmt(db,'SELECT target_id,action FROM staff_role_requests WHERE actor_id=? AND request_id=?',user.id,requestId).first());
    if(!current){requireAdmin(await getUser(db,user.id));await userExists(db,targetId);if(body.action==='appoint'&&(await getUser(db,targetId)).expulsion_pending)fail(409,'EXPULSION_PENDING','追放後の拠点を選び直してから、京都御所へ任命してください。');fail(409,'STAFF_CHANGED','役職が更新されました。もう一度確認してください。');}
    return respond(true);
  }
  return respond(!rows(result[body.action==='dismiss'?2:1]).length);
}

async function route(request, env, now) {
  const url = new URL(request.url), path = url.pathname.slice(API.length), method = request.method;
  const db = env.DB;
  if (!db?.prepare || !db?.batch) fail(503, 'SERVICE_UNAVAILABLE', '通信サービスの準備中です。');
  if(path==='/premium/stripe/webhook'&&method==='POST')return handlePremiumWebhook({db,env,now,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail}});
  if(path==='/notifications/tick'&&method==='POST'){await budget(db,'notification-tick',2,60000,now);await settleShogunateApprovals(db,now);return dispatchNotifications(env,await getWorldClock(db,now),{courtAccess:(userId,at)=>notificationCourtAccess(db,userId,at)});}
  if (path === '/health' && method === 'GET') {
    try {
      await stmt(db, 'SELECT (SELECT COUNT(*) FROM users) AS count,EXISTS(SELECT 1 FROM trades) AS trade_schema,EXISTS(SELECT 1 FROM trade_requests) AS trade_request_schema,EXISTS(SELECT 1 FROM trade_deliveries) AS trade_delivery_schema,EXISTS(SELECT 1 FROM player_bans) AS ban_schema,EXISTS(SELECT 1 FROM moderation_requests) AS moderation_schema,(SELECT content_revision FROM moderation_state WHERE id=1) AS content_revision,EXISTS(SELECT 1 FROM premium_orders) AS premium_order_schema,EXISTS(SELECT 1 FROM premium_events) AS premium_event_schema,EXISTS(SELECT 1 FROM premium_grants) AS premium_grant_schema,EXISTS(SELECT 1 FROM premium_appearances) AS premium_appearance_schema,EXISTS(SELECT 1 FROM timed_events) AS timed_event_schema,EXISTS(SELECT 1 FROM timed_event_requests) AS timed_event_request_schema,EXISTS(SELECT 1 FROM timed_event_participants) AS timed_event_participant_schema,EXISTS(SELECT 1 FROM timed_event_rewards) AS timed_event_reward_schema,EXISTS(SELECT 1 FROM roaming_battles) AS roaming_battle_schema,EXISTS(SELECT 1 FROM covert_states) AS covert_state_schema,EXISTS(SELECT 1 FROM covert_requests) AS covert_request_schema,EXISTS(SELECT 1 FROM covert_battles) AS covert_battle_schema,EXISTS(SELECT 1 FROM covert_incidents) AS covert_incident_schema,EXISTS(SELECT 1 FROM roaming_deployment) AS roaming_deployment_schema,EXISTS(SELECT 1 FROM roaming_deployment_proposals) AS roaming_deployment_proposal_schema,EXISTS(SELECT 1 FROM roaming_deployment_requests) AS roaming_deployment_request_schema,EXISTS(SELECT 1 FROM roaming_unit_cooldowns) AS roaming_unit_cooldown_schema,EXISTS(SELECT 1 FROM court_contributions) AS court_contribution_schema,EXISTS(SELECT 1 FROM court_leader) AS court_leader_schema,EXISTS(SELECT 1 FROM court_chat) AS court_chat_schema,EXISTS(SELECT 1 FROM court_audience_threads) AS court_audience_schema,EXISTS(SELECT 1 FROM court_audience_messages) AS court_audience_message_schema,EXISTS(SELECT 1 FROM court_requests) AS court_request_schema,EXISTS(SELECT 1 FROM branch_states) AS branch_state_schema,EXISTS(SELECT 1 FROM branch_requests) AS branch_request_schema,EXISTS(SELECT 1 FROM deputy_operator_state) AS deputy_schema').first();
      const voiceSchema=await stmt(db,"SELECT EXISTS(SELECT 1 FROM voice_sessions WHERE lease_until>=0 AND deputy_term IS NOT NULL) AS sessions,EXISTS(SELECT 1 FROM voice_signals WHERE acknowledged>=0) AS signals,EXISTS(SELECT 1 FROM voice_membership_epochs WHERE epoch>=1) AS membership,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('voice_guild_join','voice_guild_leave','voice_guild_move')) AS trigger_count").first();
      if(Number(voiceSchema?.trigger_count)!==3)throw Error('Voice membership migration incomplete');
      const officeSchema=await stmt(db,"SELECT (SELECT COUNT(*) FROM court_office_appointments) AS appointments,(SELECT COUNT(*) FROM court_office_requests) AS requests,(SELECT COUNT(*) FROM court_office_state) AS state,(SELECT COUNT(*) FROM court_kyoto_offices) AS kyoto,(SELECT COUNT(*) FROM court_external_offices) AS external,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'court_office_%') AS trigger_count").first();
      if(Number(officeSchema?.trigger_count)!==23)throw Error('Court office migration incomplete');
      const rewardSchema=await stmt(db,'SELECT (SELECT starts_at FROM premium_reward_program WHERE id=1) AS reward_program,(SELECT COUNT(*) FROM premium_pass_receipts) AS passes,(SELECT COUNT(*) FROM premium_supporter_periods) AS supporter_periods,(SELECT COUNT(*) FROM premium_supporter_choices) AS supporter_choices,(SELECT COUNT(*) FROM reward_accounts) AS reward_accounts,(SELECT COUNT(*) FROM reward_campaigns) AS reward_campaigns,(SELECT COUNT(*) FROM reward_requests) AS reward_requests,(SELECT COUNT(*) FROM gacha_draws) AS gacha_draws,(SELECT COUNT(*) FROM gacha_daily_usage) AS gacha_daily_usage,(SELECT COUNT(*) FROM login_bonus_claims) AS login_rewards,(SELECT COUNT(*) FROM premium_daily_events) AS premium_metrics,(SELECT COUNT(*) FROM premium_daily_visitors) AS premium_visitors').first();
      if(!Number.isSafeInteger(Number(rewardSchema?.reward_program))||Number(rewardSchema.reward_program)<1)throw Error('Reward program migration incomplete');
      const castleArtSchema=await stmt(db,"SELECT COUNT(*) AS ready FROM sqlite_master WHERE ((type='table' AND name IN ('premium_orders','premium_appearances')) OR (type='view' AND name='premium_verified_payments')) AND instr(sql,'castle-heritage')>0").first();
      if(Number(castleArtSchema?.ready)!==3)throw Error('Castle appearance migration incomplete');
      await stmt(db,'SELECT (SELECT COUNT(*) FROM shogunate_approvals) AS approvals,(SELECT COUNT(*) FROM shogunate_approval_requests) AS approval_requests,(SELECT COUNT(*) FROM shogunate_palace_control) AS palace_control,(SELECT COUNT(*) FROM court_succession_requests) AS succession_requests,(SELECT COUNT(*) FROM court_retired_emperors) AS retired_emperors').first();
      await stmt(db,'SELECT (SELECT COUNT(*) FROM shogunate_governance_accounts) AS governance_accounts,(SELECT COUNT(*) FROM shogunate_governance_requests) AS governance_requests').first();
      await stmt(db,'SELECT (SELECT COUNT(*) FROM court_estate_policy) AS estate_policy,(SELECT COUNT(*) FROM court_estate_current) AS estate_current,(SELECT COUNT(*) FROM court_estate_accounts) AS estate_accounts,(SELECT COUNT(*) FROM court_estate_snapshots) AS estate_snapshots,(SELECT COUNT(imperial_enhancements) FROM court_estate_accounts) AS estate_enhanced_accounts,(SELECT COUNT(imperial_enhancements) FROM court_estate_snapshots) AS estate_enhanced_snapshots').first();
      const successionSchema=await stmt(db,"SELECT COUNT(*) AS triggers FROM sqlite_master WHERE type='trigger' AND name IN ('court_retirement_insert','court_retirement_update','court_retirement_delete')").first();
      if(Number(successionSchema?.triggers)!==3)throw Error('Imperial succession migration incomplete');
      const successionApprovalSchema=await stmt(db,"SELECT (SELECT COUNT(*) FROM court_succession_nominations) AS nominations,(SELECT COUNT(*) FROM court_succession_nomination_requests) AS requests,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'court_succession_nomination_%') AS triggers").first();
      if(Number(successionApprovalSchema?.triggers)!==13)throw Error('Imperial succession approval migration incomplete');
      const regencySchema=await stmt(db,"SELECT (SELECT COUNT(*) FROM court_regent) AS regent,(SELECT COUNT(*) FROM court_regency_requests) AS requests,(SELECT revision FROM court_regency_state WHERE id=1) AS revision,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name LIKE 'court_regency_%') AS trigger_count").first();
      if(!Number.isSafeInteger(Number(regencySchema?.revision))||Number(regencySchema?.trigger_count)!==11)throw Error('Regency migration incomplete');
      await stmt(db,'SELECT (SELECT COUNT(*) FROM court_event_room_events) AS room_events,(SELECT COUNT(*) FROM court_event_room_requests) AS room_requests').first();
      await readMusicBroadcast(db);
      await stmt(db,'SELECT request_id FROM music_broadcast_requests LIMIT 1').first();
      await stmt(db,'SELECT reply_to_id,mentions_json FROM messages LIMIT 1').first();
      await stmt(db,'SELECT (SELECT chat FROM notification_preferences LIMIT 1) AS chat,(SELECT worldChat FROM notification_preferences LIMIT 1) AS world_chat,(SELECT announcement FROM notification_preferences LIMIT 1) AS announcement,(SELECT chat_since FROM notification_preferences LIMIT 1) AS chat_since,(SELECT worldChat_since FROM notification_preferences LIMIT 1) AS world_chat_since,(SELECT announcement_since FROM notification_preferences LIMIT 1) AS announcement_since,(SELECT source_scope FROM notification_outbox LIMIT 1) AS notification_scope,(SELECT destination FROM notification_outbox LIMIT 1) AS notification_destination,(SELECT COUNT(*) FROM notification_chat_reads) AS notification_reads,(SELECT COUNT(*) FROM notification_announcements) AS notification_announcements,(SELECT COUNT(*) FROM notification_delivery_receipts) AS notification_receipts,(SELECT COUNT(*) FROM notification_court_access) AS notification_court_access').first();
      await stmt(db,'SELECT (SELECT letter_since FROM notification_preferences LIMIT 1) AS letter_since,(SELECT battle_since FROM notification_preferences LIMIT 1) AS battle_since,(SELECT operation_since FROM notification_preferences LIMIT 1) AS operation_since,(SELECT construction_since FROM notification_preferences LIMIT 1) AS construction_since,(SELECT event_since FROM notification_preferences LIMIT 1) AS event_since,(SELECT COUNT(*) FROM notification_chat_deliveries) AS chat_deliveries,(SELECT last_message_id FROM notification_chat_baseline WHERE id=1) AS chat_baseline,(SELECT COUNT(*) FROM notification_social_events) AS social_events').first();
      await stmt(db,'SELECT home_castle_id,travel_phase,travel_json,return_travel_json,departed_elapsed_ms,arrives_elapsed_ms FROM alliance_units LIMIT 1').first();
      await stmt(db,'SELECT staging_castle_id FROM alliance_operations LIMIT 1').first();
      await stmt(db,'SELECT source_campaign_id,term_id,house_id FROM court_membership_requests LIMIT 1').first();
      await stmt(db,'SELECT house_id,original_clan,imperial_house_name,revision FROM court_lineages LIMIT 1').first();
      await stmt(db,'SELECT action,request_hash,result_revision FROM court_lineage_requests LIMIT 1').first();
      await stmt(db,'SELECT (SELECT COUNT(*) FROM court_cloistered_emperors) AS cloistered,(SELECT COUNT(*) FROM court_ordination_requests) AS ordinations,(SELECT COUNT(*) FROM court_retirement_holders) AS retirement_holders').first();
      await stmt(db,'SELECT request_id,term_id,base_id FROM court_retained_memberships LIMIT 1').first();
      await stmt(db,'SELECT term_id,started_at FROM court_rank_terms LIMIT 1').first();
      await stmt(db,'SELECT term_id,merit,completed FROM court_rank_progress LIMIT 1').first();
      const rankSchema=await stmt(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'court_rank_%'").first();
      if(Number(rankSchema?.n)!==24)throw Error('Court rank migration incomplete');
      await stmt(db,'SELECT campaign_id,castle_id,result_json FROM field_release_requests LIMIT 1').first();
      await stmt(db,'SELECT (SELECT revision FROM court_negotiations LIMIT 1) AS negotiation,(SELECT result_json FROM court_negotiation_requests LIMIT 1) AS receipt,(SELECT lord_id FROM court_vassals LIMIT 1) AS suzerain').first();
      await stmt(db,'SELECT negotiation_id,lord_id,vassal_id,reason,created_at FROM court_vassal_endings LIMIT 1').first();
      const vassalIntegrity=await stmt(db,"SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name IN ('court_vassal_insert_guard','court_vassal_end_apply','court_vassal_membership','court_vassal_house','court_vassal_staff_insert','court_vassal_staff_update','court_vassal_deputy_insert','court_vassal_deputy_update','court_vassal_operator_insert','court_vassal_operator_update','court_vassal_retainer_entry','court_vassal_resident_insert','court_vassal_resident_move','court_vassal_vacant_seat','court_vassal_defeated_lord')").first();
      if(Number(vassalIntegrity?.n)!==15)throw Error('Court vassal integrity migration incomplete');
      await stmt(db,'SELECT (SELECT started_at FROM player_activity_program WHERE id=1) AS activity_started,(SELECT first_day FROM player_activity_cohorts LIMIT 1) AS cohort,(SELECT day FROM player_activity_days LIMIT 1) AS activity_day,(SELECT started_at FROM premium_metrics_program WHERE id=1) AS payment_started,(SELECT confirmed_at FROM premium_payment_observations LIMIT 1) AS payment_confirmed').first();
      await stmt(db,'SELECT (SELECT COUNT(*) FROM progress_accounts) AS progression,(SELECT COUNT(*) FROM alliance_operations) AS alliance,(SELECT COUNT(*) FROM conquest_seasons) AS conquest,(SELECT COUNT(*) FROM pvp_protection) AS protection,(SELECT COUNT(*) FROM notification_outbox) AS notifications,(SELECT COUNT(*) FROM shogunate_rights) AS shogunate,(SELECT COUNT(*) FROM shogunate_requests) AS shogunate_requests,(SELECT COUNT(*) FROM battle_marches) AS battle_marches,(SELECT COUNT(*) FROM conquest_marches) AS conquest_marches,(SELECT COUNT(*) FROM player_expulsions) AS player_expulsions,(SELECT COUNT(*) FROM expulsion_requests) AS expulsion_requests,(SELECT COUNT(*) FROM expelled_campaigns) AS expelled_campaigns,(SELECT COUNT(*) FROM castle_seats) AS castle_residency,(SELECT COUNT(*) FROM castle_successions) AS castle_successions,(SELECT 1 FROM castle_retired_campaigns LIMIT 1) AS retired_campaign,(SELECT campaign_retired FROM alliance_units LIMIT 1) AS retired_unit,(SELECT COUNT(*) FROM external_troop_accounts) AS maintenance_accounts,(SELECT COUNT(*) FROM external_troop_snapshots) AS maintenance_snapshots').first();
    } catch { fail(503, 'SERVICE_UNAVAILABLE', '通信サービスの準備中です。'); }
    return {ok:true,status:'ready',version:API_VERSION,features:API_FEATURES};
  }
  if (path === '/world-clock' && method === 'GET') {
    const clock=await getWorldClock(db,now);await cyclePolicy(db,clock,now);return {ok:true,clock};
  }
  if (path === '/players' && method === 'GET') return searchPlayers(request,env,url,now);
  const profile=method==='GET'&&/^\/players\/([^/]+)\/profile$/.exec(path);
  if(profile)return readPlayerProfile(request,env,profile[1],now);
  if (path === '/achievements' && method === 'GET') return publicAchievements(db,url,now);
  if (method === 'GET' && (path === '/roaming/deployment' || path === '/roaming/map')) return handleRoamingDeployment({db,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,idField}});
  if (path === '/guild/rankings' && method === 'GET') return guildRankings(db,url,now);
  if (path === '/castles/residency' && method === 'GET') {
    const user=request.headers.has('authorization')?await authenticate(request,db,now):null;
    return residencyDirectory({db,user,url,now,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,evaluationRef}});
  }
  if (path === '/field' && method === 'GET') {
    const viewer=request.headers.has('authorization')?await authenticate(request,db,now):null;
    return url.searchParams.get('view')==='owners'?getFieldOwners(db,viewer,url,now,request):getFieldList(db,viewer,url,now,request);
  }
  if (path === '/config' && method === 'GET') {
    const result = await db.batch([
      stmt(db, `SELECT key,value FROM settings WHERE key='announcement'`),
      stmt(db, 'SELECT COUNT(DISTINCT user_id) AS count FROM player_presence WHERE online=1 AND last_seen>? AND NOT EXISTS(SELECT 1 FROM player_bans pb WHERE pb.user_id=player_presence.user_id AND pb.active=1)', now-ONLINE_WINDOW),
    ]);
    const settings = Object.fromEntries(rows(result[0]).map(r => [r.key,r.value]));
    return {ok:true,version:API_VERSION,features:API_FEATURES,announcement:settings.announcement ?? WELCOME,onlineCount:Number(rows(result[1])[0]?.count || 0),clock:await getWorldClock(db,now),musicBroadcast:await readMusicBroadcast(db),serverNow:iso(now)};
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
    const candidate=await stmt(db,'SELECT p.user_id,COALESCE(b.active,0) AS ban_active,COALESCE(b.revision,0) AS moderation_epoch,COALESCE(e.revision,0) AS expulsion_epoch FROM pairing_codes p LEFT JOIN player_bans b ON b.user_id=p.user_id LEFT JOIN player_expulsions e ON e.user_id=p.user_id WHERE p.code_hash=? AND p.expires_at>?',codeHash,now).first();
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
    if(!linked){if(candidate)await requireAccountAccess(db,{id:candidate.user_id,moderation_epoch:candidate.moderation_epoch,expulsion_epoch:candidate.expulsion_epoch});fail(410,'PAIR_CODE_EXPIRED','連携コードは使用済みか、有効期限が切れています。元の端末で新しく発行してください。');}
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
    const name = textField(body.name, '領主名', 24, {optional:true,preserveUnicode:true}) || '旅の領主' + crypto.randomUUID().slice(0,6);
    const clan = textField(body.clan, '勢力名', 24, {optional:true}) || '織田家';
    if(clan===ADMIN_CLAN)fail(403,'ADMIN_CLAN_REQUIRED','この家名は選択できません。徳川家を選択してください。');
    const id = uid('u_'), token = gameToken();
    try { await db.batch([releaseInactivePlayerNameStatement(db,name),stmt(db,'INSERT INTO users(id,name,name_key,clan,token_hash,created_at,last_seen) VALUES(?,?,?,?,?,?,?)',id,name,nameKey(name),clan,await hash(token),now,now)]); }
    catch (error) { if (/unique/i.test(String(error))) fail(409,'NAME_TAKEN','その領主名はすでに使われています。別の名前をお選びください。'); throw error; }
    const created=await getUser(db,id);if(body.newcomerProtection===true)await enrollProtection(db,created,now);
    return {ok:true,token,user:mapUser(created,now)};
  }

  if(path==='/events'||path.startsWith('/events/')||path==='/admin/events'||path.startsWith('/admin/events/')){
    const user=method==='GET'&&!path.startsWith('/admin/')&&!request.headers.has('authorization')?null:await authenticate(request,db,now);
    if(path.startsWith('/admin/'))protectOperations(request,user);
    return handleEvents({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,eventGarrison,fieldAttackPower,registerDefenseResponseGuard:guard=>eventDefenseResponseGuards.set(request,guard),fail,readBody,budget,idField,textField,uid,hash,getUser,getSyncRow,requireOperator,requireAccountAccess,roleCommitGuard,evaluationRef,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,syncSnapshot,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  }
  let user = await authenticate(request,db,now);
  if(operationsRoute(path)||path==='/world-clock'&&method==='PATCH')protectOperations(request,user);
  if(path==='/staff/recent-logins'||path==='/staff/roaming'||path.startsWith('/staff/roaming/')){requireStaff(user);courtResponseGuards.set(request,{...roleCommitGuard(user),code:'STAFF_REQUIRED',message:'接続一覧の利用資格が変更されました。'});}
  if(path==='/admin/music')return handleAdminMusic({db,user,request,method,now,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,hash,requireOperator,requireAccountAccess,roleCommitGuard,registerResponseGuard:guard=>courtResponseGuards.set(request,guard)}});
  const expansionContext={db,env,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,textField,uid,hash,getUser,getSyncRow,requireAdmin,requireAccountAccess,roleCommitGuard,accountCommitGuard,courtAccess,courtEmperorAuthority,courtImperialAuthority,courtDutyAuthority,registerResponseGuard:guard=>courtResponseGuards.set(request,guard),evaluationRef,fieldWriter,settleWriterCycle,settlePlayerCycle,getWorldClock,normalizeGameSave,syncSnapshot,staffBaseDto,reconcileCovertProgress,reconcileBranchProgress,branchStateGuard,branchProgressStatements,covertIncidentStatements,staffPersonalProgressStatement,saveAchievements,achievementStatement,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}};
  if(path==='/castles/residency/relocate'&&method==='POST')return relocateResidence(expansionContext,await readBody(request));
  if(path==='/court/nobles'||path==='/court/nobles/exchange')return handleCourtNobles(expansionContext);
  if(path==='/court/retirement'||path==='/court/retirement/ordain')return handleCourtRetirement(expansionContext);
  if(path==='/court/membership'&&method==='GET')return courtMembershipDetails(expansionContext);
  if(path==='/court/membership'&&method==='POST')return joinCourtMembership(expansionContext,await readBody(request));
  if(path==='/court/house'||path==='/court/imperial-house')return handleCourtLineage(expansionContext);
  if(path==='/court/negotiations'||path.startsWith('/court/negotiations/'))return handleCourtNegotiations(expansionContext);
  if(path==='/field/release'&&method==='POST')return releaseFieldCastle(expansionContext,await readBody(request));
  if(path==='/castles/residency/start'&&method==='POST')return residencyStart(expansionContext,await readBody(request));
  if(path==='/marches'&&method==='GET')return marchStatus(expansionContext,url);
  if(path==='/marches/campaign'&&method==='POST')return departCampaignMarch(expansionContext,await readBody(request));
  if(path==='/alliance'||path.startsWith('/alliance/'))return handleAlliance({...expansionContext,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,...expansionContext.helpers,fieldAttack,guildTransfer,resolveMessageRegister}});
  if(path==='/progress'||path.startsWith('/progress/'))return handleProgress(expansionContext);
  if(path==='/conquest'||path.startsWith('/conquest/'))return handleConquest(expansionContext);
  if(path==='/shogunate'||path.startsWith('/shogunate/'))return handleShogunate(expansionContext);
  if(path==='/court/succession'||path.startsWith('/court/succession/')||path==='/admin/court/succession'||path.startsWith('/admin/court/succession/'))return handleCourtSuccession({...expansionContext,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,...expansionContext.helpers,mapUser}});
  if(path==='/admin/court/regent')return handleRegency(expansionContext);
  if(path==='/court/estate'||path.startsWith('/court/estate/'))return handleCourtEstate({...expansionContext,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,...expansionContext.helpers,staffBaseUpgrade}});
  if(path==='/court/events'||path.startsWith('/court/events/'))return handleCourtEvents(expansionContext);
  if(path==='/protection'||path.startsWith('/protection/'))return handleProtection(expansionContext);
  if(path==='/notifications'||path.startsWith('/notifications/'))return handleNotifications(expansionContext);
  if(path.startsWith('/voice/'))return handleVoice({db,env,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,uid,hash,requireAccountAccess,roleCommitGuard,accountCommitGuard,registerResponseGuard:guard=>courtResponseGuards.set(request,guard)}});
  if(path==='/court'||path.startsWith('/court/')||path==='/staff/court'||path==='/admin/court/leader'||path==='/admin/court/offices'){
    const result=await handleCourt({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,textField,uid,hash,getUser,requireAccountAccess,roleCommitGuard,accountCommitGuard,evaluationRef,courtAccess,resolveMessageRegister,registerGuard:guard=>courtResponseGuards.set(request,guard)}});
    if(path==='/court'&&method==='GET'){
      result.membership=courtMembershipStatus(user,result.evaluation);
      result.lineage=await courtLineageStatus(expansionContext);
      const estate=await courtEstateAuthority(db,user,expansionContext.helpers);
      result.self.canDevelopEstate=estate.eligible;result.features.estate=estate.eligible;
      result.accessStamp=await hash(JSON.stringify([result.accessStamp,estate.accessStamp]));
      if(estate.eligible){const prior=courtResponseGuards.get(request);courtResponseGuards.set(request,prior?{sql:'('+prior.sql+') AND ('+estate.guard.sql+')',args:[...prior.args,...estate.guard.args],code:estate.guard.code,message:estate.guard.message}:estate.guard);}
    }
    return result;
  }
  if (path === '/staff/roaming' || path.startsWith('/staff/roaming/') || path === '/admin/roaming' || path.startsWith('/admin/roaming/')) return handleRoamingDeployment({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,textField,hash,getUser,requireAccountAccess,roleCommitGuard}});
  if(path==='/premium'||path.startsWith('/premium/')||path.startsWith('/admin/premium/'))return handlePremium({db,env,user,now,path,method,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,accountCommitGuard,requireAccountAccess,requireOperator,getUser,textField,idField,hash,uid,evaluationRef}});
  if(path==='/rewards'||path.startsWith('/rewards/')||path.startsWith('/gacha/'))return handleRewards({db,env,user,now,path,method,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,hash,getUser,getSyncRow,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,staffBaseDto,syncLease:SYNC_LEASE}});
  if(path==='/admin/moderation'||path.startsWith('/admin/moderation/'))return handleModeration({...expansionContext,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,...expansionContext.helpers,requireOperator,mapUser,userSelect:USER_SELECT}});
  if (path === '/me/avatar' && method === 'PUT') return putAvatar(request,env,user,now);
  if (path === '/me/avatar' && method === 'DELETE') return deleteAvatar(request,env,user,now);
  if (path === '/guild/icon' && method === 'PUT') return putGuildIcon(request,env,user,now);
  if (path === '/guild/icon' && method === 'DELETE') return deleteGuildIcon(request,env,user,now);
  if (path === '/staff/recent-logins' && method === 'GET') return recentLogins(db,user,url,now);
  if (path === '/guild/treasury' && method === 'GET') return readTreasury(db,user,url,now);
  if (path === '/guild/treasury/transfer' && method === 'POST') return guildTransfer(db,user,await readBody(request),now);
  if (path === '/guild/members/role' && method === 'POST') return guildManage(db,user,await readBody(request),false,now);
  if (path === '/guild/members/remove' && method === 'POST') return guildManage(db,user,await readBody(request),true,now);
  if (path === '/admin/deputy') return handleDeputyOperator({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,hash,requireAdmin,getUser,mapUser,getSyncRow,getWorldClock,normalizeGameSave,roleCommitGuard,ensureStaffCampaign}});
  if (path === '/admin/staff' && method === 'GET') { requireAdmin(user);return {ok:true,staff:await staffRoster(db,now)}; }
  if (path === '/admin/staff' && method === 'POST') return staffOperation(db,user,await readBody(request),now);
  if (path === '/staff/base' && method === 'GET') {
    user=await requireCurrentStaffBase(db,user,{allowAdmin:true});const clock=await getWorldClock(db,now);await ensureStaffCampaign(db,user,now,clock);const staffBase=await staffBaseDto(db,user,clock,now);await requireCurrentStaffBase(db,user,{allowAdmin:true});return {ok:true,staffBase:publicStaffBase(staffBase),clock};
  }
  if (path === '/staff/base/upgrade' && method === 'POST') return staffBaseUpgrade(db,user,await readBody(request),now);
  if (path === '/troop-garrisons' || path.startsWith('/troop-garrisons/')) return handleVacantGarrisons({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,vacantCastleGuard,listVacantCastles,fail,readBody,budget,idField,hash,getUser,getSyncRow,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,staffBaseDto,covertIncidentStatements,staffPersonalProgressStatement,registerResponseGuard:guard=>courtResponseGuards.set(request,{...guard,code:'BRANCH_ACCESS_CHANGED',message:'支拠点の利用資格が変わりました。最新の拠点と接続状態を確認してください。'}),syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/branches' || path.startsWith('/branches/')) return handleBranches({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,hash,getUser,getSyncRow,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,staffBaseDto,covertIncidentStatements,staffPersonalProgressStatement,registerResponseGuard:guard=>courtResponseGuards.set(request,{...guard,code:'BRANCH_ACCESS_CHANGED',message:'支拠点の利用資格が変わりました。最新の拠点と接続状態を確認してください。'}),syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/walking/start' && method === 'POST') return walkingStart(db,user,await readBody(request),now);
  if (path === '/walking/claim' && method === 'POST') return walkingClaim(db,user,await readBody(request),now);
  if (path === '/covert' || path.startsWith('/covert/')) return handleCovert({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,hash,getUser,getSyncRow,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,staffBaseDto,getFieldList,fieldStaffDefense,fieldDefense,fieldRelation,fieldRelationStatus,courtEmperorAuthority,courtImperialAuthority,courtAttackAuthority,reconcileBranchProgress,branchStateGuard,branchProgressStatements,staffPersonalProgressStatement,saveAchievements,achievementStatement,registerCourtGuard:guard=>courtResponseGuards.set(request,guard),syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/roaming/battle' && method === 'POST' || path === '/roaming/history' && method === 'GET') return handleRoaming({...expansionContext,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,...expansionContext.helpers,reconcileBranchProgress,branchStateGuard,branchProgressStatements,covertIncidentStatements}});
  if (path === '/letters' || path.startsWith('/letters/')) return handleLetters({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,textField,uid,mapUser,getUser,evaluationRef,evaluationUpdates,accountCommitGuard,requireAccountAccess,contentRevisionInput,resolveMessageRegister}});
  if (path === '/trades' || path.startsWith('/trades/')) return handleTrades({db,user,now,path,method,url,request,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget,idField,uid,mapUser,getUser,getSyncRow,hash,fieldWriter,settleWriterCycle,getWorldClock,normalizeGameSave,roleCommitGuard,syncSnapshot,requireAccountAccess,tradeTroopCapacity,staffBaseDto,reconcileCovertProgress,reconcileBranchProgress,branchStateGuard,branchProgressStatements,covertIncidentStatements,staffPersonalProgressStatement,saveAchievements,achievementStatement,syncLease:SYNC_LEASE,worldClockId:WORLD_CLOCK_ID}});
  if (path === '/field/me' && method === 'GET') return fieldMe(db,user,url,now,request);
  if (path === '/field/attack' && method === 'POST') return fieldAttack(db,user,await readBody(request),now);
  if (path === '/field/diplomacy' && method === 'POST') return fieldDiplomacy(db,user,await readBody(request),now);
  if (path === '/world-clock' && method === 'PATCH') {
    requireOperator(user);
    const body=await readBody(request);
    if(Object.keys(body).some(key=>!['revision','running','speed'].includes(key))||!Number.isSafeInteger(body.revision)||body.revision<0||body.running===undefined&&body.speed===undefined||body.running!==undefined&&typeof body.running!=='boolean'||body.speed!==undefined&&![1,2,4].includes(body.speed))fail(400,'INVALID_INPUT','共通時計の更新番号と、一時停止・速度（1・2・4）の変更を指定してください。');
    await budget(db,'world-clock-control:'+user.id,60,60000,now);
    const prior=await getWorldClockRow(db,now),current=mapWorldClock(prior,now);
    if(current.revision!==body.revision)fail(409,'CLOCK_REVISION_CONFLICT','共通時計が別の端末で更新されました。最新の時計を確認してください。');
    const access=operationGuard(user),changed=await stmt(db,`UPDATE world_clock SET base_elapsed_ms=?,anchor_real_ms=?,running=?,speed=?,revision=revision+1
      WHERE id=? AND revision=? AND ${access.sql} RETURNING *`,current.elapsedMs,now,(body.running??current.running)?1:0,body.speed??current.speed,WORLD_CLOCK_ID,body.revision,...access.args).first();
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
    if(user.expulsion_pending)fail(409,'BASE_EXPELLED',EXPULSION_MESSAGE);
    const body=await readBody(request,MAX_SAVE_BODY),deviceId=idField(body.deviceId,'端末識別子');
    if(!Number.isSafeInteger(body.revision)||body.revision<0)fail(400,'INVALID_INPUT','セーブの更新番号が正しくありません。');
    if(!body.save||typeof body.save!=='object'||Array.isArray(body.save))fail(400,'INVALID_SAVE','セーブデータを送信してください。');
    // Covert units, reports and response opportunities belong to the server ledger.
    // Ignore that entire client section, including malformed or forged imports.
    const imported=copy(body.save),importedState=imported.state||imported,hasMonthlyReceipt=importedState.upkeep!==undefined,hasRepairReceipt=importedState.repair!==undefined;
    // Preserve only the fact that an untrusted import contains stationed troops.
    // The server branch ledger remains authoritative; first imports must recall
    // these soldiers locally before this section can safely be discarded.
    const importedStationedTroops=Array.isArray(importedState.branches)&&importedState.branches.some(branch=>branch&&Object.hasOwn(branch,'stationedTroops')&&branch.stationedTroops!==0);
    delete importedState.covert;delete importedState.branches;if(Array.isArray(importedState.jobs))importedState.jobs=importedState.jobs.filter(job=>job?.kind!=='branch');
    const clock=await getWorldClock(db,now),save=normalizeGameSave(imported,user,now,{clock});
    await budget(db,'sync-write:'+user.id,120,60000,now);
    let previous=await getSyncRow(db,user.id);if(previous?.save_json){fieldWriter(previous,deviceId,body.revision,now);previous=await ensureStaffCampaign(db,user,now,clock,{deferClanMigration:true});fieldWriter(previous,deviceId,body.revision,now);}
    const before=previous?.save_json?normalizeGameSave(JSON.parse(previous.save_json),user,now,{reading:true,clock}):null;
    // The private return address is a consequence of the server-side title
    // transition. An upload cannot reserve an unowned castle for a later exit.
    if(user.is_sento)save.state.imperialResidence=copy(before?.state.imperialResidence||{returnHome:CLAN_HOMES[user.clan]||'kiyosu'});
    assertSentoUpgradeTransition(before,save,user,fail);
    // All first-time local imports need the same time-origin migration. Older
    // saves also lack officerHealth; leaving those on their local calendar
    // makes the shared upkeep authority appear older than their progress.
    if(!save.state.worldClock){
      if(before?.state.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','この領主は共通時計へ移行済みです。共通時計に対応した最新版から保存してください。');
      await anchorImportedSave(db,user,save,clock,now);
      Object.assign(save,normalizeGameSave(save,user,now,{clock}));
    }
    let healthBefore=before;
    if(before&&!before.state.worldClock&&save.state.worldClock){healthBefore=copy(before);await anchorImportedSave(db,user,healthBefore,clock,now);}
    const maintenance=await maintenanceContext(db,user.id,before||save,clock);
    const estateEconomy=await courtEstateContext(db,user,before||save,clock,now);
    if(before&&estateEconomy.projection&&body.courtEstateProof!==estateEconomy.projection.proof)fail(409,'COURT_ESTATE_REFRESH_REQUIRED',COURT_ESTATE_REFRESH_MESSAGE);
    if(estateEconomy.projection&&save.state.worldClock?.elapsedMs>estateEconomy.projection.asOfElapsedMs)fail(409,'COURT_ESTATE_REFRESH_REQUIRED',COURT_ESTATE_REFRESH_MESSAGE);
    const estateBalance=before?.state.walking.campaignId===save.state.walking.campaignId?estateEconomy:await courtEstateContext(db,user,save,clock,now);
    if(before&&body.maintenanceRevision!==maintenance.authority.revision)fail(409,'MAINTENANCE_REFRESH_REQUIRED',MAINTENANCE_REFRESH_MESSAGE);
    if(before?.state.worldClock&&save.state.worldClock&&save.state.worldClock.elapsedMs<before.state.worldClock.elapsedMs)fail(409,'CLOCK_REWIND','古い時刻のセーブで維持費の確定済み区間を巻き戻せません。最新データへ同期してください。');
    if(save.state.worldClock&&save.state.worldClock.elapsedMs>maintenance.authority.asOfElapsedMs)fail(409,'MAINTENANCE_REFRESH_REQUIRED',MAINTENANCE_REFRESH_MESSAGE);
    if(before?.state.walking.campaignId!==save.state.walking.campaignId&&await stmt(db,'SELECT 1 FROM castle_retired_campaigns WHERE actor_id=? AND campaign_id=? UNION ALL SELECT 1 FROM expelled_campaigns WHERE user_id=? AND campaign_id=? UNION ALL SELECT 1 FROM court_membership_requests WHERE actor_id=? AND source_campaign_id=?',user.id,save.state.walking.campaignId,user.id,save.state.walking.campaignId,user.id,save.state.walking.campaignId).first())
      fail(409,'CAMPAIGN_RELOCATED','この戦役は本拠移転で終了しています。現在の本拠へ同期してください。');
    const covertPending=before?.state.walking.campaignId!==save.state.walking.campaignId?await stmt(db,"SELECT 1 AS pending FROM covert_states WHERE actor_id=? AND campaign_id=? AND json_array_length(state_json,'$.dispatches')>0",user.id,before?.state.walking.campaignId||'').first():null;if(covertPending)fail(409,'ARMY_MARCHING','派遣部隊が進軍中です。到着後に物語を切り替えてください。');
    const pendingArmy=await activeMarch(db,user.id);
    if(pendingArmy){if(body.save?.state?.march?.id!==pendingArmy.id||save.state.walking.campaignId!==pendingArmy.campaign_id)fail(409,'ARMY_MARCHING','進軍中の兵は別の保存に戻せません。最新の本拠へ同期してください。');save.state.march=serverMarchMarker(pendingArmy);if(before)before.state.march=copy(save.state.march);}
    else if(save.state.march?.authority==='server')save.state.march=null;
    const importedMarch=!pendingArmy?await promoteImportedMarch(db,user,save,clock,now):null;
    if(!previous||previous.writer_device_id!==deviceId||Number(previous.lease_expires_at)<=now)fail(409,'LEASE_REQUIRED','プレイ端末の同期権限が切れました。');
    if(Number(previous.revision)!==body.revision)fail(409,'REVISION_CONFLICT','最新の保存へ同期してください。');
    if(before?.state.worldClock&&!save.state.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','この領主は共通時計へ移行済みです。共通時計に対応した最新版から保存してください。');
    const policy=await cyclePolicy(db,clock,now),currentCycle=Math.floor(clock.elapsedMs/WORLD_CYCLE_MS);
    let cycleIndex=previous?.cycle_index??Math.max(policy,currentCycle),cycleHome=user.is_admin?'edo':user.is_sento?'sento_gosho':user.is_staff?'kyoto_gosho':user.is_deputy?'kagoshima':previous?.cycle_home&&!['edo','kyoto_gosho','kagoshima','sento_gosho'].includes(previous.cycle_home)?previous.cycle_home:save.state.cycle?.home||save.state.home;
    if(previous?.cycle_index!==null&&previous?.cycle_index!==undefined){
      if(save.state.cycle&&save.state.cycle.index!==Number(cycleIndex)||save.state.worldClock&&Math.floor(save.state.worldClock.elapsedMs/WORLD_CYCLE_MS)>Number(cycleIndex)){
        await settlePlayerCycle(db,previous,user,now,clock,{deferActive:false,writerDeviceId:deviceId});fail(409,'CYCLE_SETTLEMENT_REQUIRED','領地の精算を同期しています。最新データを読み込んでください。');
      }
      if(before?.state.cycle?.latestReward&&save.state.worldClock&&save.state.worldClock.elapsedMs<Number(cycleIndex)*WORLD_CYCLE_MS)fail(409,'CLOCK_REWIND','古い時刻のセーブで上書きできません。最新データへ同期してください。');
      // An explicit fresh campaign may choose a new ordinary starting home.
      if(!user.is_admin&&!user.is_staff&&save.state.home!==before?.state.home&&Object.values(save.state.stats).every(v=>v===0)&&Object.values(save.state.castles).filter(c=>c.owner===save.state.clan).length===1&&!MAJOR_CITIES.includes(save.state.home))cycleHome=save.state.home;
    }
    const retainedRegions=reconcileRegionInheritance(save,before,fail),protectedRegions=reconcileRegionProtection(save,before,fail),releasedCastles=reconcileReleasedCastles(save,before,fail);
    save.state.cycle={index:Number(cycleIndex),home:cycleHome,latestReward:before?.state.cycle?.latestReward||null,retainedRegions,protectedRegions,releasedCastles};
    // The receipt ledger is outside imported game saves. Restoring an older save
    // never tops up currency or rewinds previously credited online steps.
    const walkingLedger=await stmt(db,'SELECT total_steps FROM walking_accounts WHERE user_id=?',user.id).first();
    save.state.walking.serverSteps=Number(walkingLedger?.total_steps||0);
    await reconcileRoamingProgress(db,user.id,save,before);
    await reconcileProgress(db,user.id,save,before);
    await reconcileCourtNobles(db,user.id,save,fail);
    await reconcileCovertProgress(db,user.id,save);
    reconcileOfficerHealth(save,healthBefore,clock);
    retainCourtHoldings(save,before,user,clock);
    const branchProgress=await resolveSyncBranches(db,user,save,before,clock,now,{importedStationedTroops}),branchAccess=branchProgress.access;
    const residencyProgress=await resolveSyncResidency(db,user,save,before,clock,now,branchAccess);cycleHome=save.state.cycle.home;
    let repairAdjustment;
    try{repairAdjustment=reconcilePaidRepairs(save,healthBefore,clock,{courtEstateProjection:estateBalance.projection,hasRepairReceipt,trustedStates:[branchProgress.replayed?.state,residencyProgress.durabilityState].filter(Boolean),branchState:branchProgress.replayed?.state,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected});}
    catch(error){if(error.code==='REPAIR_STATE_CHANGED')fail(409,error.code,error.message);throw error;}
    // Settle one monthly receipt after the authoritative branch pools are
    // merged. An already-settled client may have recruited again afterwards;
    // saving those troops must not trigger a second reduction in the same month.
    const shared=user.is_staff&&!user.is_admin?await staffBaseDto(db,user,clock,now):null;
    let balanceAuthority=maintenance.authority;
    if(balanceAuthority.campaignId!==save.state.walking.campaignId){
      // Campaign imports change which depot ledger is active at this commit.
      // This static check must use that destination's depots, while retaining
      // the player's existing trade/alliance ownership and revision guard.
      const vacant=Number((await stmt(db,'SELECT COALESCE(SUM(troops),0) AS troops FROM vacant_garrisons WHERE actor_id=? AND campaign_id=?',user.id,save.state.walking.campaignId).first()).troops);
      balanceAuthority={...balanceAuthority,campaignId:save.state.walking.campaignId,baseline:{...balanceAuthority.baseline,vacant},changes:balanceAuthority.changes.map(point=>({...point,vacant}))};
    }
    // The personal garrison is an uploaded private stock. A monthly reduction
    // must reach the appointment backup instead of being restored from it.
    const personalHome=shared?.personalHome,personalCastle=personalHome&&save.state.castles[personalHome];
    const sharedForBalance=hasMonthlyReceipt&&personalCastle?.owner===save.state.clan?{...shared,personalHomeCastle:{...shared.personalHomeCastle,troops:personalCastle.troops}}:shared;
    const balanced=GameEngine.fromSave(save,GAME_OFFICERS,{courtEstateProjection:estateBalance.projection,isSento:!!user.is_sento,isAdmin:!!user.is_admin,isDeputy:!!user.is_deputy,isStaff:!!user.is_staff,isCourtProtected:!!user.is_court_protected,staffBase:sharedForBalance,maintenanceAuthority:balanceAuthority,branchAuthority:{resolvedElapsedMs:branchProgress.resolvedElapsedMs}});
    // Receipts use the same migrated time origin as health and repair. Comparing
    // an old local month with the shared month would restore a future receipt.
    const upkeepBefore=upkeepTroopSnapshot(balanced),upkeepResult=reconcileMonthlyUpkeep(balanced,healthBefore,{hasMonthlyReceipt});
    const upkeepAdjustment=upkeepResult?.changed?upkeepAdjustmentDto(upkeepBefore,upkeepTroopSnapshot(balanced),upkeepResult):null;
    Object.assign(save,normalizeGameSave(JSON.parse(balanced.exportSave()),user,now,{clock}));
    const rewardArchive=await protectRewardSync(db,user,save,before,{fail,normalize:stored=>normalizeGameSave(stored,user,now,{reading:true,clock})});
    const sharedGuard=shared?{sql:"EXISTS(SELECT 1 FROM staff_base WHERE id='kyoto_gosho' AND revision=?)",args:[shared.revision]}:{sql:'1=1',args:[]};
    const serialized=JSON.stringify(save),nonce=crypto.randomUUID(),roleGuard=guardLordSupport(roleCommitGuard(user),user);
    const statements=[stmt(db,`UPDATE player_saves SET save_json=?,revision=revision+1,updated_at=?,lease_expires_at=?,cycle_index=?,cycle_home=?,cycle_commit=?
      WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>?
      AND (?=1 OR json_type(save_json,'$.state.worldClock') IS NULL) AND (?=0 OR NOT EXISTS(SELECT 1 FROM battle_marches WHERE actor_id=? AND status='marching')) AND ${roleGuard.sql} AND ${branchAccess.guard.sql} AND ${branchProgress.guard.sql} AND ${residencyProgress.guard.sql} AND ${maintenance.guard.sql} AND ${sharedGuard.sql} AND ${estateEconomy.guard.sql} RETURNING *`,serialized,now,now+SYNC_LEASE,cycleIndex,cycleHome,nonce,user.id,body.revision,deviceId,now,save.state.worldClock?1:0,importedMarch?1:0,user.id,...roleGuard.args,...branchAccess.guard.args,...branchProgress.guard.args,...residencyProgress.guard.args,...maintenance.guard.args,...sharedGuard.args,...estateEconomy.guard.args)];
    const gate='EXISTS(SELECT 1 FROM player_saves WHERE user_id=? AND cycle_commit=?)';
    statements.push(...rewardArchiveStatements(db,user.id,rewardArchive,now,gate,[user.id,nonce]));
    statements.push(...residencyProgress.statements(gate,[user.id,nonce]));
    statements.push(...await initialResidencyStatements(db,{user,save,now,gateSql:gate,gateArgs:[user.id,nonce]}));
    if(importedMarch)statements.push(insertMarch(db,importedMarch,gate,[user.id,nonce]));
    statements.push(...branchProgressStatements(db,user.id,save,now,gate,[user.id,nonce],{resolvedElapsedMs:branchProgress.resolvedElapsedMs}));
    if(branchProgress.replayed)statements.push(...covertIncidentStatements(db,user.id,branchProgress.replayed,now,gate,[user.id,nonce]));
    const personal=await staffPersonalProgressStatement(db,user,save,now,gate,[user.id,nonce],balanced.getStaffPersonalProgress?.());if(personal)statements.push(personal);
    for(const event of saveAchievements(before,save))statements.push(achievementStatement(db,user.id,event,now,gate,[user.id,nonce]));
    statements.push(...notificationSaveStatements(db,user.id,before,save,now,gate,[user.id,nonce]));
    statements.push(...campaignShogunateStatements({db,user,save,now,gateSql:gate,gateArgs:[user.id,nonce]}));
    statements.push(...externalTroopSnapshotStatements(db,[user.id],clock,gate,[user.id,nonce]));
    const changed=await db.batch(statements),row=rows(changed[0])[0];
    if(!row) {
      await requireAccountAccess(db,user);
      const current=await getSyncRow(db,user.id);
      if(!current||current.writer_device_id!==deviceId||Number(current.lease_expires_at)<=now)fail(409,'LEASE_REQUIRED','プレイ端末の同期権限が切れました。接続状態を確認してください。');
      if(!await stmt(db,'SELECT 1 WHERE '+maintenance.guard.sql,...maintenance.guard.args).first())fail(409,'MAINTENANCE_REFRESH_REQUIRED',MAINTENANCE_REFRESH_MESSAGE);
      if(!await stmt(db,'SELECT 1 WHERE '+estateEconomy.guard.sql,...estateEconomy.guard.args).first())fail(409,'COURT_ESTATE_REFRESH_REQUIRED',COURT_ESTATE_REFRESH_MESSAGE);
      if(Number(current.revision)===body.revision&&!save.state.worldClock&&current.save_json&&JSON.parse(current.save_json).state?.worldClock)fail(409,'CLOCK_ANCHOR_REQUIRED','この領主は共通時計へ移行済みです。共通時計に対応した最新版から保存してください。');
      fail(409,'REVISION_CONFLICT','新しいセーブが届いています。最新データを読み込んでから再開してください。');
    }
    if(!user.is_staff&&user.clan!==save.state.clan||user.is_admin&&user.clan!==save.state.clan) {
      await stmt(db,'UPDATE users SET clan=? WHERE id=?',save.state.clan,user.id).run();
      user.clan=save.state.clan;
    }
    const snapshot=await syncSnapshot(db,row,user,deviceId,now,{settle:true});
    // This transient receipt describes only this exact committed revision.
    // A subsequent role/cycle/foreign update may return a newer snapshot; do
    // not attach an older troop adjustment to that different state.
    if(upkeepAdjustment&&snapshot.revision===Number(row.revision)&&snapshot.save?.state.walking.campaignId===save.state.walking.campaignId)snapshot.upkeepAdjustment={...upkeepAdjustment,committedRevision:Number(row.revision)};
    if(repairAdjustment&&snapshot.revision===Number(row.revision)&&snapshot.save?.state.walking.campaignId===save.state.walking.campaignId)snapshot.repairAdjustment={...repairAdjustment,committedRevision:Number(row.revision)};
    return snapshot;
  }
  if (path === '/me' && method === 'GET') {
    const result = await db.batch([
      stmt(db, USER_SELECT + ` WHERE u.id IN (SELECT CASE WHEN user_a=? THEN user_b ELSE user_a END FROM friendships WHERE (user_a=? OR user_b=?) AND status='accepted') ORDER BY u.name`,user.id,user.id,user.id),
      stmt(db, `SELECT f.requested_by,f.created_at,u.id,u.name,u.clan,
        (SELECT a.version FROM user_avatars a WHERE a.user_id=u.id) AS avatar_version,
        CASE WHEN u.id=(SELECT value FROM settings WHERE key='adminUserId') THEN 1 ELSE 0 END AS is_admin,
  EXISTS(SELECT 1 FROM court_retirement_holders r WHERE r.user_id=u.id) AS is_sento,
        EXISTS(SELECT 1 FROM staff_members sm WHERE sm.user_id=u.id) AS is_staff,
  EXISTS(SELECT 1 FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS is_deputy,
  (SELECT ds.term_id FROM deputy_operator_state ds WHERE ds.user_id=u.id) AS deputy_term,
        (SELECT json_extract(b.save_json,'$.state.clan') FROM staff_campaign_backups b WHERE b.user_id=u.id AND b.active=1) AS personal_clan
        FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END WHERE (f.user_a=? OR f.user_b=?) AND f.status='pending' ORDER BY f.created_at DESC`,user.id,user.id,user.id),
      stmt(db, `SELECT COUNT(*) AS count FROM mail_campaigns m WHERE (m.target_user_id IS NULL OR m.target_user_id=?) AND NOT EXISTS(SELECT 1 FROM mail_reads r WHERE r.mail_id=m.id AND r.user_id=?)`,user.id,user.id),
      notificationChatSummaryStatement(db,user.id,now),
      socialNotificationSummaryStatement(db,user.id,now),
    ]);
    return {ok:true,user:{...mapUser(user,now),commander:null},...(user.is_admin?{management:{recoveryAvailable:typeof env.SENGOKU_ADMIN_KEY==='string'&&env.SENGOKU_ADMIN_KEY.length>0}}:{}),friends:rows(result[0]).map(r=>mapUser(r,now)),requests:rows(result[1]).map(r=>({id:r.id,name:r.name,clan:publicClan(r.clan,r.is_admin,r.is_staff,r.personal_clan),avatarVersion:r.avatar_version||null,evaluation:evaluationRef(r.id),direction:r.requested_by===user.id?'outgoing':'incoming',createdAt:iso(r.created_at)})),unreadMail:Number(rows(result[2])[0]?.count || 0),unreadChat:notificationChatSummary(result[3]),...socialNotificationSummary(result[4])};
  }
  if (path === '/profile' && method === 'PATCH') {
    const body = await readBody(request), name = textField(body.name,'領主名',24,{preserveUnicode:true}),expectedName=Object.hasOwn(body,'expectedName')?textField(body.expectedName,'変更前の領主名',24,{preserveUnicode:true}):null;
    // Both old and current clients echo the server's exact display name. Keep
    // that spelling in the concurrency guard, including an existing NFC name.
    if(!user.is_admin&&!user.is_staff&&typeof body.clan==='string'&&body.clan.normalize('NFC').trim()===ADMIN_CLAN)fail(403,'ADMIN_CLAN_REQUIRED','この家名は選択できません。徳川家を選択してください。');
    if(name!==user.name)await budget(db,'profile-name:'+user.id,20,60000,now);
    const access=accountCommitGuard(user),profileGate='EXISTS(SELECT 1 FROM users actor WHERE actor.id=? AND (? IS NULL OR actor.name=? OR actor.name=?)) AND '+access.sql,profileArgs=[user.id,expectedName,expectedName,name,...access.args];let changed;
    try { changed=(await db.batch([releaseInactivePlayerNameStatement(db,name,profileGate,profileArgs),stmt(db,'UPDATE users SET name=?,name_key=? WHERE id=? AND '+access.sql+' AND (? IS NULL OR name=? OR name=?) AND NOT EXISTS(SELECT 1 FROM users named WHERE named.name_key=? AND named.id<>users.id) RETURNING id',name,user.expulsion_pending?releasedPlayerNameKey(user.id):nameKey(name),user.id,...access.args,expectedName,expectedName,name,nameKey(name))]))[1]; }
    catch (error) { if (playerNameConflict(error)) fail(409,'NAME_TAKEN',PLAYER_NAME_TAKEN); throw error; }
    if(!rows(changed).length){await requireAccountAccess(db,user);await requireAvailablePlayerName(db,user.id,name,fail);fail(409,'PROFILE_CHANGED','別の端末で領主名が変更されました。最新の名前を確認してから、もう一度お試しください。');}
    return {ok:true,user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/chat' && method === 'GET') {
    const channel = url.searchParams.get('channel') || 'world';
    const room = await roomFor(db,user,channel,url.searchParams.get('target'));
    const afterText = url.searchParams.get('after') || '0';
    if (!/^\d{1,15}$/.test(afterText)) fail(400,'INVALID_CURSOR','読み込み位置が正しくありません。');
    const after=Number(afterText),known=contentRevisionInput(url),access=chatAccessGuard(user,channel,url.searchParams.get('target')),guard=access.sql,guardParams=access.args;
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
    const allowed=rows(read[0])[0];if(!allowed){await requireAccountAccess(db,user);fail(403,access.code,'このチャットの参加権限がありません。');}
    const contentRevision=Number(rows(read[3])[0].content_revision),reset=known!==contentRevision,delta=after>0&&!reset,messages=rows(read[1]).map(mapMessage);
    if(!delta)messages.reverse();
    // Record only messages actually returned by this authorized read. A cursor
    // supplied by a client cannot mark unseen future messages as read.
    if(messages.length){const record=url.searchParams.get('read')==='manual'?recordNotificationChatDelivery:recordNotificationChatRead;await record(db,user.id,room,Math.max(...messages.map(message=>message.id)),now,access);}
    chatResponseGuards.set(request,{user,access,contentRevision});
    return {ok:true,channel,contentRevision,reset,messages,playerEvaluations:evaluationUpdates([...messages.map(message=>message.userId),...rows(read[2]).map(row=>row.user_id)]),nextAfter:messages.at(-1)?.id||(delta?after:0),hasMore:messages.length===100};
  }
  if(path==='/chat/read'&&method==='POST'){
    const body=await readBody(request),channel=textField(body.channel,'チャット種別',12),room=await roomFor(db,user,channel,body.target),lastId=body.lastId;
    if(!Number.isSafeInteger(lastId)||lastId<=0)fail(400,'INVALID_CURSOR','確認した会話の位置を指定してください。');
    const access=chatAccessGuard(user,channel,body.target),delivered='EXISTS(SELECT 1 FROM notification_chat_deliveries d WHERE d.user_id=? AND d.room_key=? AND d.last_message_id>=?) AND EXISTS(SELECT 1 FROM messages m WHERE m.room_key=? AND m.id=?)',deliveredArgs=[user.id,room,lastId,room,lastId];
    if(!await stmt(db,'SELECT 1 AS delivered WHERE '+delivered,...deliveredArgs).first())fail(400,'CHAT_READ_NOT_DELIVERED','読み込んだ会話の範囲で確認してください。');
    await recordNotificationChatRead(db,user.id,room,lastId,now,{sql:access.sql+' AND '+delivered,args:[...access.args,...deliveredArgs]});
    const confirmed=await stmt(db,'SELECT last_message_id FROM notification_chat_reads WHERE user_id=? AND room_key=? AND '+access.sql,user.id,room,...access.args).first();
    if(!confirmed){await requireAccountAccess(db,user);await roomFor(db,await getUser(db,user.id),channel,body.target);fail(409,'CHAT_CHANGED','会話の状態が変わりました。最新の会話を確認してください。');}
    return{ok:true,lastId:Number(confirmed.last_message_id)};
  }
  if (path === '/chat' && method === 'POST') {
    const body=await readBody(request), channel=textField(body.channel,'チャット種別',12), text=textField(body.text,'メッセージ',300),metadata=chatMetadata(body);
    const room=await roomFor(db,user,channel,body.target);
    await budget(db,'chat:'+user.id,1,5000,now);
    const access=chatAccessGuard(user,channel,body.target),context=chatContextGuard(user,channel,body.target,room,metadata);
    if(metadata.replyToId!==null||metadata.mentionIds.length)await checkChatContext(db,user,access,context);
    const audience=channel==='friend'?{kind:'person',id:idField(body.target,'友達の識別子')}:channel==='guild'?{kind:'guild',id:user.guild_id}:{kind:channel==='admin'?'operations':'public'};
    const register=await resolveMessageRegister(db,user,audience,now),spoken=await register.write(text);
    const inserted=await stmt(db,'INSERT INTO messages(room_key,channel,user_id,body,created_at,reply_to_id,mentions_json) SELECT ?,?,?,?,?,?,? WHERE '+access.sql+' AND '+context.sql+' AND '+register.guard.sql+' RETURNING id',room,channel,user.id,spoken,now,metadata.replyToId,JSON.stringify(metadata.mentionIds),...access.args,...context.args,...register.guard.args).first();
    if(!inserted){await requireAccountAccess(db,user);await roomFor(db,await getUser(db,user.id),channel,body.target);await checkChatContext(db,user,access,context,{conflict:true});fail(409,'MESSAGE_AUDIENCE_CHANGED','宛先の状況が変わりました。もう一度送信してください。');}
    await requireAccountAccess(db,user);
    const read=await db.batch([stmt(db,MESSAGE_SELECT+' WHERE m.id=? AND m.room_key=? AND '+access.sql,inserted.id,room,...access.args),stmt(db,'SELECT content_revision FROM moderation_state WHERE id=1')]);
    const message=rows(read[0])[0],contentRevision=Number(rows(read[1])[0].content_revision);
    if(!message){await requireAccountAccess(db,user);fail(409,'CONTENT_CHANGED','投稿が更新されました。最新の一覧を確認してください。');}
    chatResponseGuards.set(request,{user,access,contentRevision});
    return {ok:true,message:mapMessage(message),contentRevision};
  }
  if (path === '/guilds' && method === 'GET') {
    const result=await stmt(db,GUILD_SELECT+' ORDER BY member_count DESC,g.name LIMIT 50').all();
    return {ok:true,guilds:rows(result).map(mapGuild)};
  }
  if (path === '/guild' && method === 'GET') {
    return guildSnapshot(db,user,now);
  }
  if (path === '/guild' && method === 'POST') {
    const body=await readBody(request),name=textField(body.name,'同盟名',24);
    if (user.guild_id) fail(409,'ALREADY_IN_GUILD','所属中の同盟を脱退してから作成してください。');
    const id=uid('g_'),access=accountCommitGuard(user);
    try { await db.batch([
      stmt(db,'INSERT INTO guilds(id,name,name_key,owner_id,created_at) SELECT ?,?,?,?,? WHERE '+access.sql,id,name,nameKey(name),user.id,now,...access.args),
      stmt(db,'INSERT INTO guild_members(user_id,guild_id,joined_at) SELECT ?,?,? WHERE '+access.sql,user.id,id,now,...access.args),
      stmt(db,'INSERT INTO guild_treasuries(guild_id) SELECT ? WHERE '+access.sql,id,...access.args),
    ]); } catch(error) { if (/unique/i.test(String(error))) fail(409,'GUILD_CONFLICT','その同盟名は使われているか、すでに別の同盟へ参加しています。'); throw error; }
    await requireAccountAccess(db,user);
    return {ok:true,guild:mapGuild(await stmt(db,GUILD_SELECT+' WHERE g.id=?',id).first()),user:mapUser(await getUser(db,user.id),now)};
  }
  if (path === '/guild/join' && method === 'POST') {
    const body=await readBody(request),guildId=idField(body.guildId,'同盟の識別子');
    if (user.guild_id===guildId) return {ok:true,user:mapUser(user,now)};
    if (user.guild_id) fail(409,'ALREADY_IN_GUILD','所属中の同盟を脱退してから参加してください。');
    if (!await stmt(db,'SELECT id FROM guilds WHERE id=?',guildId).first()) fail(404,'GUILD_NOT_FOUND','その同盟は見つかりませんでした。');
    const access=accountCommitGuard(user),joinGuard=await assertGuildJoinAllowed({db,user,now,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail}},guildId);await stmt(db,`INSERT INTO guild_members(user_id,guild_id,joined_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM guilds WHERE id=?) AND (SELECT COUNT(*) FROM guild_members WHERE guild_id=?)<? AND ${access.sql} AND ${joinGuard.sql} ON CONFLICT(user_id) DO NOTHING`,user.id,guildId,now,guildId,guildId,MAX_GUILD_MEMBERS,...access.args,...joinGuard.args).run();
    const current=await getUser(db,user.id);
    if (current.guild_id!==guildId) fail(409,'GUILD_UNAVAILABLE','同盟が満員か、すでに別の同盟へ参加しています。');
    return {ok:true,user:mapUser(current,now)};
  }
  if (path === '/guild/leave' && method === 'POST') {
    return guildLeave(env,user,await readBody(request),now);
  }
  if (path === '/friends/request' && method === 'POST') {
    const body=await readBody(request),other=idField(body.userId,'領主の識別子');
    if(other===user.id) fail(400,'INVALID_TARGET','自分自身へ友達申請は送れません。');
    await userExists(db,other);
    const [a,b]=pair(user.id,other);
    const prior=await stmt(db,'SELECT * FROM friendships WHERE user_a=? AND user_b=?',a,b).first();
    if(prior) return {ok:true,status:prior.status,direction:prior.requested_by===user.id?'outgoing':'incoming'};
    await budget(db,'friend-request:'+user.id,20,600000,now);
    const access=accountCommitGuard(user),notificationKey=uid('fr_');await db.batch([
      stmt(db,`INSERT INTO friendships(user_a,user_b,requested_by,status,created_at,updated_at,notification_key) SELECT ?,?,?,'pending',?,?,? WHERE ${access.sql} ON CONFLICT(user_a,user_b) DO NOTHING`,a,b,user.id,now,now,notificationKey,...access.args),
      socialNotificationStatement(db,{key:notificationKey+':request',userId:other,actorId:user.id,kind:'friend-request',sourceId:notificationKey,sourceRevision:now},now,`EXISTS(SELECT 1 FROM friendships WHERE user_a=? AND user_b=? AND requested_by=? AND status='pending' AND notification_key=?) AND ${access.sql}`,[a,b,user.id,notificationKey,...access.args])
    ]);
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
    const access=accountCommitGuard(user),kind=body.accept?'friend-accepted':'friend-declined',pending=`EXISTS(SELECT 1 FROM friendships WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=? AND created_at=? AND notification_key=?) AND ${access.sql}`;
    await db.batch([
      socialNotificationStatement(db,{key:kind+':'+(prior.notification_key||a+':'+b+':'+prior.created_at),userId:other,actorId:user.id,kind,sourceId:prior.notification_key,sourceRevision:prior.created_at},now,pending,[a,b,other,prior.created_at,prior.notification_key,...access.args]),
      body.accept?stmt(db,`UPDATE friendships SET status='accepted',updated_at=? WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=? AND created_at=? AND notification_key=? AND ${access.sql}`,now,a,b,other,prior.created_at,prior.notification_key,...access.args):stmt(db,`DELETE FROM friendships WHERE user_a=? AND user_b=? AND status='pending' AND requested_by=? AND created_at=? AND notification_key=? AND ${access.sql}`,a,b,other,prior.created_at,prior.notification_key,...access.args)
    ]);
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
      ...courtEstateSnapshotStatements(db,claimClock,"EXISTS(SELECT 1 FROM settings WHERE key='adminUserId' AND value=?)",[user.id]),
    ]);
    if(rows(result[1])[0]?.value!==user.id) fail(409,'ADMIN_CLAIMED','運営者は登録済みです。');
    return {ok:true,user:mapUser(await getUser(db,user.id),now),alreadyAdmin:false};
  }
  if (path === '/admin/announcement' && method === 'POST') {
    requireOperator(user);
    const body=await readBody(request),text=textField(body.text,'お知らせ',300,{min:0});
    const register=await resolveMessageRegister(db,user,{kind:'public'},now),spoken=await register.write(text),role=roleCommitGuard(user);
    const saved=await db.batch([
      stmt(db,`INSERT INTO settings(key,value,updated_at) SELECT 'announcement',?,? WHERE ${role.sql} AND ${register.guard.sql} ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at RETURNING value`,spoken,now,...role.args,...register.guard.args),
      ...notificationAnnouncementStatements(db,user.id,now,`${role.sql} AND ${register.guard.sql} AND ?<>''`,[...role.args,...register.guard.args,spoken])
    ]),updated=rows(saved[0])[0];
    if(!updated)fail(409,'MESSAGE_AUDIENCE_CHANGED','宛先の状況が変わりました。もう一度送信してください。');
    return {ok:true,announcement:updated.value};
  }
  if (path === '/admin/mail' && method === 'POST') {
    requireOperator(user);
    const body=await readBody(request),target=body.target==='all'?null:idField(body.target,'送信先'),title=textField(body.title,'件名',60),content=textField(body.body,'本文',2000),gift=giftField(body.gift),requestId=idField(body.requestId,'リクエスト識別子');
    if(target) await userExists(db,target);
    const giftJson=gift?JSON.stringify(gift):null,payloadHash=await hash(JSON.stringify({target,title,body:content,gift}));
    const prior=await stmt(db,'SELECT id,payload_hash FROM mail_campaigns WHERE sender_id=? AND request_id=?',user.id,requestId).first();
    if(prior) {if(prior.payload_hash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT','同じ送信番号を別の内容に使うことはできません。');return {ok:true,mailId:prior.id,alreadySent:true};}
    await budget(db,'admin-mail:'+user.id,30,60000,now);
    const id=uid('m_'),register=await resolveMessageRegister(db,user,target?{kind:'person',id:target}:{kind:'public'},now);
    const subject=await register.write(title,'title'),spoken=await register.write(content),role=roleCommitGuard(user);
    await stmt(db,`INSERT INTO mail_campaigns(id,sender_id,target_user_id,title,body,gift_json,request_id,payload_hash,created_at) SELECT ?,?,?,?,?,?,?,?,? WHERE ${role.sql} AND ${register.guard.sql} ON CONFLICT(sender_id,request_id) DO NOTHING`,id,user.id,target,subject,spoken,giftJson,requestId,payloadHash,now,...role.args,...register.guard.args).run();
    const saved=await stmt(db,'SELECT id,payload_hash FROM mail_campaigns WHERE sender_id=? AND request_id=?',user.id,requestId).first();
    if(!saved)fail(409,'MESSAGE_AUDIENCE_CHANGED','宛先の状況が変わりました。もう一度送信してください。');
    if(saved.payload_hash!==payloadHash) fail(409,'IDEMPOTENCY_CONFLICT','同じ送信番号を別の内容に使うことはできません。');
    return {ok:true,mailId:saved.id,alreadySent:saved.id!==id};
  }
  if (path === '/mail' && method === 'GET') {
    const result=await stmt(db,`SELECT m.id,m.title,m.body,m.gift_json,m.request_id,m.created_at,r.read_at,c.receipt_id,b.result_json AS battle_json,cb.result_json AS covert_battle_json FROM mail_campaigns m LEFT JOIN mail_reads r ON r.mail_id=m.id AND r.user_id=? LEFT JOIN mail_receipts c ON c.mail_id=m.id AND c.user_id=? LEFT JOIN field_battles b ON b.id=substr(m.request_id,14,35) AND (b.attacker_id=m.target_user_id OR b.defender_id=m.target_user_id) LEFT JOIN covert_battles cb ON cb.id=substr(m.request_id,15,35) AND cb.defender_id=m.target_user_id WHERE m.target_user_id IS NULL OR m.target_user_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 200`,user.id,user.id,user.id).all();
    return {ok:true,mail:rows(result).map(r=>{const event=systemMailEvent(r.request_id),battle=event&&r.battle_json?JSON.parse(r.battle_json):null,covertBattle=event&&r.covert_battle_json?JSON.parse(r.covert_battle_json):null;return {id:r.id,title:r.title,body:fieldBattleMailBody(r.body,event,battle||covertBattle),gift:r.gift_json?JSON.parse(r.gift_json):null,read:r.read_at!==null,claimed:!!r.receipt_id,createdAt:iso(r.created_at),source:event?'system':'site',event,...(event?{participants:battle?['attacker','defender'].map(side=>({playerId:battle[side+'PlayerId'],name:battle[side+'Name'],side,evaluation:evaluationRef(battle[side+'PlayerId'])})):[]}:{} )};})};
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
  async scheduled(_event,env,ctx){const now=Date.now(),context=marchContext(env.DB,null,now,env);const run=(async()=>{await settleShogunateApprovals(env.DB,now);await settleBattleMarches(context,{limit:24});await settleConquestMarches(context);await settleCovertDispatches(context,{limit:12});await settleAllianceUnits(context);await dispatchNotifications(env,await getWorldClock(env.DB,now),{courtAccess:(userId,at)=>notificationCourtAccess(env.DB,userId,at)});})();if(ctx?.waitUntil)ctx.waitUntil(run);else await run;},
  async fetch(request, env, ctx) {
    let origin=null,stage='request';
    try {
      const path=new URL(request.url).pathname,messageNotificationWrite=request.method==='POST'&&/^\/api\/v1\/(?:chat|court\/(?:negotiations(?:\/cn_[a-f0-9]{32}\/(?:counter|accept|reject|cancel))?|chat|audiences(?:\/ca_[a-f0-9]{32}\/replies)?)|letters(?:\/lt_[a-f0-9]{32}\/messages)?|admin\/(?:mail|announcement)|friends\/(?:request|respond)|alliance\/(?:apply|invite|membership|treasury\/(?:request|approve))|trades(?:\/tr_[a-f0-9]{32}\/(?:accept|reject|cancel))?)$/.test(path);
      if(path==='/' && (request.method==='GET'||request.method==='HEAD')) {
        return new Response(request.method==='HEAD'?null:'<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>戦国VS 通信局</title><body style="font-family:system-ui;background:#101318;color:#eee;padding:3rem"><h1>戦国VS 通信局</h1><p>領主たちの交流・端末同期・接続一覧を支える通信サービスです。</p><footer>© KASAI SOLUTIONS</footer></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'"}});
      }
      if(!path.startsWith(API+'/')) fail(404,'NOT_FOUND','その通信機能は見つかりませんでした。');
      origin=allowedOrigin(request,env);
      if(path===API+'/promotion/event')requirePromotionOrigin(request,fail);
      if(request.method==='OPTIONS') {
        const headers=new Headers({'Access-Control-Allow-Methods':'GET,POST,PUT,PATCH,DELETE,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Max-Age':'600','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff'});
        if(origin!==null) headers.set('Access-Control-Allow-Origin',origin);
        return new Response(null,{status:204,headers});
      }
      // A five-second audience poll must not perform gameplay maintenance,
      // create a world-clock row, authenticate, or record player activity.
      if(path===API+'/music'&&request.method==='GET'){
        stage='music';
        if(!env.DB?.prepare)fail(503,'SERVICE_UNAVAILABLE','通信サービスの準備中です。');
        return response({ok:true,musicBroadcast:await readMusicBroadcast(env.DB),serverNow:iso(Date.now())},200,origin);
      }
      // Public discovery counters do not run gameplay projection, marches or
      // notification dispatch. A missing analytics migration affects only them.
      if(path===API+'/promotion/event'&&request.method==='POST')return response(await recordPromotion({db:env.DB,request,now:Date.now(),helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,readBody,budget}}),200,origin);
      if(path===API+'/admin/promotion'&&request.method==='GET'){
        if(!env.DB?.prepare||!env.DB?.batch)fail(503,'PROMOTION_UNAVAILABLE','紹介の集計を現在利用できません。ゲームはそのまま遊べます。');
        const now=Date.now(),user=await authenticate(request,env.DB,now);
        protectOperations(request,user);
        const report=await readPromotionReport({db:env.DB,user,url:new URL(request.url),now,helpers:{courtEstateContext,courtEstateSnapshotStatements,getWorldClock,fail,requireOperator,budget}});
        await requireAccountAccess(env.DB,user);
        // Recheck owner access after the final asynchronous account check.
        await verifyOperationsResponse(env.DB,request);
        return response(report,200,origin);
      }
      if(path.startsWith(API+'/avatars/')&&request.method==='GET')return await getAvatar(request,env,origin);
      if(path.startsWith(API+'/guild-icons/')&&request.method==='GET')return await getGuildIcon(request,env,origin);
      stage='route';const now=Date.now(),payload=await route(request,env,now);
      if(path===API+'/field'&&new URL(request.url).searchParams.get('view')==='owners'){
        stage='premium';const owners=await resolvePremiumAppearances(env.DB,payload,now),viewer=authenticatedRequests.get(request);
        if(viewer)await requireAccountAccess(env.DB,viewer);
        await verifyCourtResponse(env.DB,request);
        return response(owners,200,origin);
      }
      stage='evaluations';const evaluated=await resolvePlayerEvaluations(env.DB,payload,now);
      stage='premium';const resolved=await resolvePremiumAppearances(env.DB,evaluated,now),authenticated=authenticatedRequests.get(request);
      stage='access';
      if(authenticated)await requireAccountAccess(env.DB,authenticated);
      await verifyCourtResponse(env.DB,request);
      await verifyCourtEstateResponse(env.DB,payload);
      // Message writes use only their targeted dispatch below, so one Worker
      // invocation cannot spend the D1 query budget on two notification sweeps.
      if(typeof ctx?.waitUntil==='function'&&path!==API+'/notifications/tick'){
        const previous=backgroundPolls.get(env.DB);
        // Bursts from hundreds of readers do not compete for identical tick
        // writes. No player state, response, permission or payment is cached.
        if(!previous||now<previous.startedAt||now>=previous.nextAt){
          const window={startedAt:now,nextAt:now+1000};backgroundPolls.set(env.DB,window);
          ctx.waitUntil((async()=>{await backgroundMarchSweep(env,now);if(!messageNotificationWrite)await dispatchNotifications(env,await getWorldClock(env.DB,now),{courtAccess:(userId,at)=>notificationCourtAccess(env.DB,userId,at)});})().catch(()=>{if(backgroundPolls.get(env.DB)===window)backgroundPolls.delete(env.DB);}));
        }
      }
      stage='public-court';const courtVisible=await resolvePublicCourtOffices(env.DB,publicIdentities(resolved,request),now);
      stage='public-honors';const visible=await resolvePublicCityHonors(env.DB,courtVisible,now,{getWorldClock,eventCastleCandidates});
      stage='response';
      await verifyOperationsResponse(env.DB,request);
      if(path.startsWith(API+'/players/')&&payload.player)await finishPublicProfiles(env.DB,visible,true);
      else if(path===API+'/players'&&!authenticated)await finishPublicProfiles(env.DB,visible,false);
      const defenseGuard=eventDefenseResponseGuards.get(request);
      // A battle may already be committed. Withdraw only stale private advice
      // so its receipt and command reconciliation remain successful/replayable.
      if(defenseGuard&&visible.progress&&!await stmt(env.DB,'SELECT 1 AS event_defense_current WHERE '+defenseGuard.sql,...defenseGuard.args).first()){visible.progress.defenseAdviser=null;visible.progress.battleEligibility={canAttack:false,reason:'refresh_required'};}
      // Observation must never turn an already-committed game operation into a
      // retryable error. Health separately requires the observation schema.
      if(authenticated&&visible?.ok!==false)try{await recordPlayerActivity({db:env.DB,user:authenticated,now,path:path.slice(API.length),guard:accountCommitGuard});}catch{}
      // Decorations and activity observation both await database work. Check
      // private access after the last such operation, immediately before send.
      await verifyChatResponse(env.DB,request);
      await verifyCourtResponse(env.DB,request);
      await verifyCourtEstateResponse(env.DB,payload);
      await verifyOperationsResponse(env.DB,request);
      // Committed messages start their delivery without waiting for a periodic
      // tick. Notification errors never turn a successful message into a retry.
      if(typeof ctx?.waitUntil==='function'&&authenticated&&messageNotificationWrite)ctx.waitUntil((async()=>{await dispatchMessageNotifications(env,await getWorldClock(env.DB,Date.now()),{path:path.slice(API.length),actorId:authenticated.id,since:now,courtAccess:(userId,at)=>notificationCourtAccess(env.DB,userId,at)});})().catch(()=>{}));
      return response(visible,200,origin);
    }catch(error){
      const authenticated=authenticatedRequests.get(request);if(authenticated)try{await requireAccountAccess(env.DB,authenticated);}catch(accessError){error=accessError;}
      if(error instanceof ApiError){const e={code:error.code,message:error.message};if(error.retryAfter)e.retryAfter=error.retryAfter;return response({ok:false,error:e},error.status,origin,error.retryAfter);}
      reportInternalFailure(error,request,stage);
      return response({ok:false,error:{code:'INTERNAL_ERROR',message:'通信処理に失敗しました。少し時間をおいて再度お試しください。'}},500,origin);
    }
  }
};
