# 戦国VS（SENGOKU VS）通信API

Base path: `/api/v1`. UTF-8 JSON, except public avatar image responses. JSON success always includes `ok: true`.
All routes except GET `/config`, GET `/health`, GET `/online`, GET `/players`, GET `/players/:id/profile`, GET `/world-clock`, GET `/field`, GET `/guild/rankings`, GET `/achievements`, GET `/avatars/:userId`, POST `/session`, POST `/devices/link`, and POST `/admin/recover` require `Authorization: Bearer <game-token>`. Administrator recovery requires the original operator registration key in its JSON body instead of an existing game token.
No cookies are used. Never put a token or pairing code in a URL. POST/PUT/PATCH/DELETE bodies require `Content-Type: application/json`, including `{}` for an empty body. DELETE `/me/avatar` also accepts no body.

## 送信時の敬語

受信者に目上のプレイヤーが含まれると、サーバーが送信時に日本語の文章を敬語に整え、変換済みの本文を保存・配信します。個人チャットと個人書状では相手本人、同盟チャットと作戦の連絡事項では現在の同盟員、同盟書状では現在の同盟員と元の差出人、加入申請では承認担当者を比較します。謁見で領主が朝廷へ送る文は担当者全員を、担当者からの返信はその領主を宛先とします。運営チャットと直接配布する郵便も実際の宛先を使います。

公開官職は、官職なし、参議、中納言、大納言、内大臣、右大臣、左大臣、太政大臣、天皇の順です。同じ官職の領主は公開評価の位階（無位から正一位まで）で比較します。個人・同盟宛ての相手が全員同格以下の場合は送った原文を届けます。世界・朝廷の公開チャット、全員宛ての告知・郵便では公開官職を確認し、官職を持たない送り主以外に保存データのある一般領主が33人以上いれば一律に敬語を使います。音声通話は対象外です。

画面やクライアント側の設定でこの判定は無効にできません。書状で変換後の本文が1,000文字を超える場合、送信は成立せず、HTTP 400 と `POLITE_TEXT_TOO_LONG` を返します。受付番号のある送信を同じ入力で再送した場合は最初の確定結果を返します。書き込み中に位階・所属・宛先が変わった場合は、最新状態で再送してください。

## Common objects

```js
user = {
  id: "u_…", name: "領主名", clan: "織田家",
  guildId: null, guildName: null, guildRole: null, online: true, avatarVersion: null,
  evaluation: {version:1,score:0,maxScore:100000,rankId:"court-0",rankName:"無位",rankIndex:0},
  appearance: {nameplate:null,town:null,badge:null,ownedProducts:[]}
}
// Self identity and authorized management add isAdmin:boolean / isStaff:boolean.
// General user lists and messages omit site permissions.
// guildRole is null, "owner", "officer", or "member".
// online means at least one explicitly foreground device heartbeat is newer than 90 seconds.
// Authenticated reads and save writes alone never make a player online.
message = {id: 1, userId: "u_…", name: "領主名", avatarVersion: null, text: "…", createdAt: "2026-11-21T00:00:00.000Z", evaluation, appearance}
guild = {id:"g_…", name:"…", ownerId:"u_…", ownerName:"…", ownerEvaluation:evaluation, ownerAppearance:appearance, memberCount:1, maxMembers:50, createdAt:"…"}
gift = {gold: 100, rice: 200, wood: 50, stone: 50, magatama: 3000}
error = {ok:false, error:{code:"AUTH_REQUIRED", message:"日本語の説明", retryAfter:5}}
```

`retryAfter` exists only on rate limits. HTTP status is meaningful (400, 401, 403, 404, 409, 410, 413, 415, 429, 500, 503).
All returned timestamps are ISO strings. Treat names, messages, mail, and announcements as plain text, never HTML.

### 公開プロフィールと総大将

`GET /players/:id/profile` は、ゲスト、本人、ほかのプレイヤーに同じ公開プロフィールを返します。`player` の公開項目は `id`、`name`、`clan`、`guildId`、`guildName`、`guildRole`、`avatarVersion`、`evaluation`、`courtOffice`、`appearance`、`commander` です。`appearance` には既存の公開装備・購入マークを表示します。利用停止・存在しない領主は HTTP 404 `PLAYER_NOT_FOUND` となります。

`commander` は確定した最新のセーブの軍団先頭にいる武将を示し、形式は `{officerId,name,rank}` です。武将名は人物図鑑と一致し、ランクはその武将について現在所有する最高ランクです。軍団の並べ替え・ランクの更新は、セーブが確定した後の取得から反映されます。軍団先頭が空、セーブがない、または確認できない場合は `null` です。古いセーブにはゲームと同じランク移行を適用します。本人の `GET /me` の `user.commander` にも同じ形式で反映します。

ゲスト用の `GET /players?q=…` は領主名の部分一致または完全な領主IDで最大30人を検索します。結果は軽量な公開名簿で、IDから個別プロフィールを開くと総大将を取得できます。ゲストの検索上限はIPごとに1分あたり20回、個別取得は60回です。超過時は HTTP 429 と `retryAfter` を返します。

### Player evaluation and court-rank titles

`evaluation` is the compact current projection `{version:1,score,maxScore:100000,rankId,rankName,rankIndex}` from the shared `GameEngine.publicEvaluation` function. It assigns seventeen ranks, `court-0` (無位) through `court-16` (正一位). The score combines territory/castles, completed facilities, distinct officers and their strongest owned rarities, army/governor assignments, research, prestige and recorded attack wins, and walking progress. It is independent of operator, staff and guild permissions. Clients cannot upload an authoritative score or title.

| Player display | Additional field |
|---|---|
| User, online/search/recent-login/staff lists, friends and pending requests, guild members, field home/outpost, chat message | `evaluation` |
| Guild owner | `ownerEvaluation` |
| Achievement author or guild asset receipt/ledger actor | `playerEvaluation` |
| Field relationship target | `targetEvaluation` |
| Field battle participants | `attackerEvaluation`, `defenderEvaluation` |
| Letter `peer`, `sender`, `contextPlayer`; shared construction `startedBy` | Nested `evaluation` |
| Letter message and thread `lastMessage` author | `authorEvaluation` |
| Automatic field-battle mail | `participants:[{playerId,name,side:"attacker"\|"defender",evaluation}]` |

An existing identity without a saved game receives score `0` and 無位. An unreadable saved game or an unavailable historical identity yields `null`; clients hide the unverified badge instead of inventing a demotion. Missing fields from older servers are also not authoritative zeroes. The compact object exposes no resource balances, officer IDs, formations, raw saves, tokens or backups.

The server reads the latest committed normalized save, applies current roles and completed shared staff facilities/castle growth, and projects a pending cycle's retained home. This calculation performs no gameplay writes, monthly simulation, reward grants, lease renewal or formation changes. Ordinary personal progress becomes public after save synchronization. One response batches and deduplicates its referenced player IDs; repeated mentions of one player receive one calculated value. No schema migration or saved title cache is required.

Chat GET and letter inbox/thread GET responses additionally include `playerEvaluations:[{playerId,name,evaluation,appearance}]`, even when a message delta is empty. Clients use these entries to refresh already rendered authors. Chat covers recent authors in the selected room's latest 100 messages; a letter thread covers its explicit participants and recent authors in its latest 100 messages, with existing access checks. Neither scans unrelated conversations. Receipt, battle and mail bodies remain immutable; the added evaluation fields describe current titles, including on retries and historical views. A system-mail sender remains the system, while its participant row identifies the two actual lords.

## Identity and public configuration

| Method / path | Body / query | Result fields, in addition to `ok` |
|---|---|---|
| GET `/health` | none | `status:"ready"`, `version:"3.20.0"`, `features:{trades:true,moderation:true,premium:true,timedEvents:true,troopTrades:true,roamingBattles:true,roamingDeployment:true,covertDispatch:true,privatePlayerRoles:true}` |
| GET `/config` | none | `version:"3.20.0"`, `features:{trades:true,moderation:true,premium:true,timedEvents:true,troopTrades:true,roamingBattles:true,roamingDeployment:true,covertDispatch:true,privatePlayerRoles:true}`, `announcement:string`, `onlineCount:number`, `clock` |
| POST `/session` | `{name?,clan?}` | `token:string`, `user` |
| GET `/me` | none | `user`, `friends:user[]`, `requests:[{id,name,clan,avatarVersion,evaluation,direction:"incoming"|"outgoing",createdAt}]`, `unreadMail:number` |
| PATCH `/profile` | `{name,expectedName?}` | `user` |
| GET `/players` | `?q=検索語` (name of 2–24 characters or complete player ID) | Up to 30 public search results. Authenticated callers receive user objects and their own entry is omitted. |
| GET `/players/:id/profile` | Public player ID | `{ok:true,player}` with the current commander and public profile fields |

The health read also verifies the trade and moderation tables, without creating or changing them. Names and clan labels have a 24-character limit. Names are unique after Unicode compatibility normalization and case folding.
The distinct clan name **`德川家`** is reserved for authenticated operators and staff. Ordinary players may use **`徳川家`**. An unauthenticated session or ordinary profile request attempting to set the reserved name returns 403 `ADMIN_CLAN_REQUIRED`. Private self and authorized management identities retain `德川家`; general public identities display `徳川家`, while the chosen lord name remains unchanged. The role flags remain separate: staff have Kyoto Gosho and never gain Edo or Ieyasu U from the family label. A dismissed staff identity returns to its backed-up original family; a legacy ordinary reserved label without such a backup is projected as `徳川家`.
If no name is supplied, the server chooses `旅の領主` plus a random suffix.
The 256-bit anonymous game token is a 43-character base64url string. The server stores only its SHA-256 hash. A session-creation token is returned only when creating that identity. Additional per-device tokens are issued through successful pairing or verified recovery of the original operator identity.
Store the token in localStorage and offer an explicit identity JSON export/import for recovery. An exported original token remains valid after additional devices are linked or the operator recovers access. A game save contains game progress; it does not contain the bearer identity and cannot confer operator privileges. An ordinary identity requires a surviving authenticated device or identity-token backup. The sole existing operator can also use its original registration key through `/admin/recover`; the key never transfers operator rights to a new identity.

### Changing the authenticated lord name (3.15.0)

`PATCH /profile` updates only `users.name` and its unique comparison key for the
identity authenticated by the bearer token. Send `{name,expectedName}` using the
currently displayed `user.name` as `expectedName`. Successful responses are
`{ok:true,user}` with the same player ID and the current canonical name,
permissions, guild, evaluation and purchase appearance. Clients must confirm
that the returned `user.id` still matches their active identity before accepting
it, then refresh their current identity and cached participant labels.

Names use the existing registration validator: normalize to NFC, trim outer
whitespace, then require 1–24 Unicode code points. Unsupported controls
`U+0000–0008`, `U+000B–000C`, `U+000E–001F` and `U+007F` are rejected. Invalid
input is 400 `INVALID_INPUT`. The unique key uses NFKC and Japanese-locale
lowercasing, so width/case-compatible duplicates return 409 `NAME_TAKEN`.
No name is generated for an empty rename request.

The update atomically requires that the stored name still equals `expectedName`
or already equals the requested name. A competing different edit returns 409
`PROFILE_CHANGED`; the UI should reload the current name before asking for a new
change. Retrying the same final name after a lost response succeeds, while an old
retry cannot overwrite a later different name. `expectedName` remains optional
for older clients; new clients should always send it. No request ID or new schema
is required. Different-name attempts share a per-identity budget of 20 per real
minute across linked devices; an unchanged-name retry does not consume that
budget. A blocked budget returns 429 `RATE_LIMITED` with `retryAfter` seconds.

This is an identity-profile edit and does not acquire or require a gameplay
writer lease. It never updates the game save/revision, lease, tokens, player ID,
premium facts, guild membership or financial records. Account BAN and the
commit-time account generation remain enforced, including BAN/unban races.
Client-supplied player IDs or role fields cannot select another account or grant
permissions; the only updated fields are the authenticated account's name/key.

Current names are projected into profiles, guild owners/members, trade parties,
chat authors, letter authors/peers, field relationships and battle participants,
mail participant rows, public achievements, guild ledgers and authorized shared
construction attribution. Stored message bodies, battle/financial receipts and
mail text remain unchanged. Chat/letter `playerEvaluations[].name` refreshes
already cached authors even on an empty delta. A missing historical player has
no invented current name. Display names and their existing evaluation references
share a batched lookup; name-only identities need no game-save normalization.

`node scripts/test-profile-name.mjs` checks normalization, duplicate and concurrent
edits, lost responses, account generations, throttling, current historical labels,
unchanged save/purchase/authentication records and linked devices using local
fixtures only.

## Player photo avatars

| Method / path | Authentication and body / query | Response |
|---|---|---|
| PUT `/me/avatar` | Bearer; `{image:"<raw standard base64>"}` | `{ok:true,user}` |
| DELETE `/me/avatar` | Bearer; no body or `{}` | `{ok:true,user}` |
| GET `/avatars/:userId?v=<avatarVersion>` | Public; optional current version query | JPEG bytes, or JSON error |

Every player, including support staff and the operator, may replace only their own photo. PUT accepts exactly the `image` field; target IDs, filenames, external URLs, data URLs, content types and authority flags are rejected. The browser crops/resizes to exactly **256×256 JPEG**. The server bounds the entire JSON request at 70 KiB and the decoded input at **49,152 bytes (48 KiB)**, requires canonical padded standard base64, and structurally validates 8-bit baseline or progressive Huffman JPEG with one or three components. Incorrect dimensions, unsupported image formats, inconsistent markers/tables/scans, truncation and trailing bytes are rejected. All APP0–APP15 and COM segments, including EXIF/GPS, XMP, ICC, thumbnails and comments, are removed server-side before persistence. This is bounded JPEG structure validation, not a general image transcoder or full entropy decoder. The parser follows [ITU-T T.81 Annex B/E](https://www.w3.org/Graphics/JPEG/itu-t81.pdf).

The returned `user.avatarVersion` is a lowercase 64-character SHA-256 hash of the sanitized JPEG, or `null` when no photo exists. Every API response resolves current photos for referenced players in the same batched projection as names and evaluations. This includes profile/sync, friends and requests, online/search, chat, private/guild letters, guild membership/owners/rankings/treasury, trades, field targets/diplomacy/battle history, system-mail participants, achievements, shared-construction authors and authorized administration/recent-login screens.

| Participant identity | Current photo field |
|---|---|
| `id`, `userId` or `playerId` | `avatarVersion` |
| `ownerId` | `ownerAvatarVersion` |
| `authorId` | `authorAvatarVersion` |
| `targetPlayerId` | `targetAvatarVersion` |
| `attackerPlayerId` / `defenderPlayerId` | `attackerAvatarVersion` / `defenderAvatarVersion` |
| `actorPlayerId` | `actorAvatarVersion` |
| Achievement-style `playerId` + `playerName` | `avatarVersion` and matching `playerAvatarVersion` |

`playerEvaluations` rows also include `avatarVersion`, even when a chat or letter delta contains no new messages. Clients must apply explicit `null` values, so replacement or removal on a linked device clears an old image. Deleted/missing players and currently banned players receive `null` across both public and authorized projections. This read-time projection does not rewrite saved games, stored message bodies or historical financial/battle receipts. No new schema or per-player query is required: current photos are read in batches alongside existing player identity queries.

Responses never carry image bytes, base64, storage keys or metadata. Clients construct a URL from their fixed API base, encoded user ID and version; arbitrary image URLs are not accepted. A version mismatch or deleted/missing photo returns 404 `AVATAR_NOT_FOUND`. Omitting `v` reads the current photo. All successful and unsuccessful reads use `Cache-Control:no-store`; re-uploading the same image hash cannot revive a cached older photo.

Files are stored in the private R2 binding `BUCKET`; D1 `user_avatars` stores only user ID, version, unique object key, MIME type, byte length and update time. Migration `0005_user_avatars` is schema-only. Each upload writes a newly randomized R2 object before a D1 transaction switches the account's metadata; previous-object cleanup never shares a key with a replacement. A failed or uncertain D1 response does not delete an object that may already be current. Delete removes the metadata atomically, then attempts bounded object cleanup. A failed cleanup can leave an unreachable storage object, but cannot expose a deleted photo. Reads verify the current metadata both before and after the asynchronous object read to reject an intervening deletion/replacement.

JPEG responses set `Content-Type:image/jpeg`, `X-Content-Type-Options:nosniff`, `Referrer-Policy:no-referrer` and a restrictive Content-Security-Policy; the existing exact-origin CORS policy applies. Replacing a photo on a linked device changes the same account's version without changing roles, progress or other players' photos. Simultaneous updates use the last committed metadata; they do not require the gameplay writer lease.

PUT and DELETE share a per-account limit of **10 attempts per real ten minutes**. Missing/invalid authentication returns 401; malformed image/body returns 400 `INVALID_AVATAR`; decoded oversize returns 413 `AVATAR_TOO_LARGE`; oversized JSON returns 413 `BODY_TOO_LARGE`; unavailable R2 returns 503 `AVATAR_STORAGE_UNAVAILABLE`; rate exhaustion returns 429 `RATE_LIMITED`. `node scripts/test-avatar-jpeg.mjs` covers the exact shipped parser with seven real JPEG profiles, including Chrome canvas output. `node scripts/test-avatars.mjs` covers the API, ownership, metadata stripping, storage races, failures, deletion, privacy and limits using local D1/R2 doubles. `node scripts/test-avatar-projections.mjs` exercises current-photo replacement/removal through linked devices, all participant surfaces and empty deltas, immutable saved records and BAN/unban projections without external requests.

## Device linking and identity recovery

| Method / path | Authentication and body | Result fields, in addition to `ok` |
|---|---|---|
| POST `/devices/pair-code` | Existing bearer token, `{}` | `code:string`, `expiresAt:ISO` |
| POST `/devices/link` | No bearer token, `{code,deviceName?}` | `token:string`, `user` |

Issue a code on a currently authenticated device and enter it on the second device. The code has 12 characters from a 32-character alphabet, generated with cryptographic randomness. Redemption accepts lowercase letters and optional spaces or hyphens. The code expires after ten minutes, and generating another code for the same identity replaces any prior outstanding code. At most five codes can be issued per identity per ten minutes.

The database stores a SHA-256 hash of the code with a domain-separation prefix, its owner and its expiry; it never stores the plaintext code. Redemption creates a distinct 256-bit bearer token in `user_sessions` and consumes the code in one D1 transaction. Concurrent redemption attempts can produce exactly one successful token. Expired, unknown or already-used codes return HTTP 410 `PAIR_CODE_EXPIRED`. Code-format errors return HTTP 400 `INVALID_PAIR_CODE`.

Link attempts are limited to 12 per 15 minutes per hashed Cloudflare source IP. A shared anonymous bucket is used if that trusted source-IP header is absent. The issuing device, original exported token and other linked devices remain authenticated after linking. The new token identifies the same user ID, so the account's cloud save, guild, friends, mail and server-owned operator role are available on the new device. No registration key is copied to the client or included in a code.

`deviceName` is optional and limited to 64 Unicode characters. Names are private to that identity's sync responses and are not published in the online list. Pairing codes and token exports are secrets intended for the account holder's own devices.

## Recovery of the original operator

| Method / path | Authentication and body | Result fields, in addition to `ok` |
|---|---|---|
| POST `/admin/recover` | No existing bearer required; `{key,requestId,deviceName?}` | `token:string`, `user`, `recovered:true` |

`key` is the exact original `SENGOKU_ADMIN_KEY` value, from 1 to 256 characters. It is compared using the same fixed-size digest comparison as initial registration. `requestId` is a UUIDv4 generated for this recovery attempt and retained across lost-response retries; UUID letter case is normalized. `deviceName` has the same optional 64-character limit as pairing. Unknown fields, including a target player ID or role flags, are rejected with 400 `INVALID_INPUT`.

This route resolves the target only from the existing `settings.adminUserId`, then inserts an additional token hash for that same user into `user_sessions`. It cannot create or change the primary operator, register a new player, change the user's name, update a game save, or invalidate an existing original/paired/recovered token. A fresh guard in the D1 transaction verifies the same primary identity at insertion. An ordinary or staff bearer token alone does not authorize recovery; the original registration key is required on every attempt.

The returned token is a purpose-separated HMAC-SHA256 of the original operator ID and request UUID, keyed by the server registration secret. The database stores only the returned token's SHA-256 hash. Repeating a verified request UUID returns the same token and creates at most one session, including concurrent requests. A new UUID creates a separate device token. A revoked matching session is never reactivated by a retry. The raw registration key, raw recovered token, and request bodies are not logged or stored in a database, URL, cookie or client bundle. Responses are `Cache-Control:no-store`.

Every well-formed attempt, including a successful or duplicate one, consumes a limit of five requests per ten minutes per hashed trusted Cloudflare source IP (or a shared fallback bucket if absent). After verifying the correct key and existing operator, a second limit permits thirty verified requests per real hour for that operator across all IPs. Invalid-key attempts from unrelated addresses cannot exhaust the rightful operator's cross-device allowance. Rejections return 429 `RATE_LIMITED` with `Retry-After`; these limits use real time rather than the game clock. An incorrect key, absent original operator, changed target, or revoked retry returns the same generic 403 `ADMIN_RECOVERY_FAILED` response. A missing configured server secret returns 503 `ADMIN_RECOVERY_UNAVAILABLE`. The public `/config.adminRecoveryAvailable` is true only when an original operator is recorded and the secret is configured; it never discloses the key or identity token.

The frontend presents this under **交流 → 引き継ぎ → 運営登録キーで復旧**, using a password input, only on a connected device whose current primary operator role has been verified by the server and whose configuration confirms recovery is available. Ordinary players, staff, guests, unverified identities, and disconnected devices do not receive the form markup. The public capability flag is not viewer authorization. Role loss or identity changes clear the mounted input; unauthorized frontend submissions are rejected before sending a request. Identity files and device linking remain available to all players. It clears the input immediately, sends the key only in the HTTPS JSON request, and keeps the returned identity in memory for the existing `/me` and `/sync` verification flow. It does not persist a new identity or start synchronization solely because this endpoint succeeds. If cloud progress exists, the user can connect to it; if no cloud game save exists, the user must add an old game save or explicitly confirm use of this device's current progress. Restoring the operator role does not reconstruct unsaved game progress. The existing `pendingRecovery` local transaction marker protects interrupted identity/game imports before sync starts.

This feature uses the existing `user_sessions` schema and requires no migration. Verify it with `node scripts/test-admin-recovery.mjs`; all tokens and keys in that suite are local test values.

## Shared world clock and repeating calendar

All players, guests and linked devices use one server-owned clock. It continues to accumulate elapsed time while no players are connected. It is independent of any player's browser, identity, saved pause state or writer lease.

| Method / path | Authentication and body | Result fields, in addition to `ok` |
|---|---|---|
| GET `/world-clock` | Public, no body | `clock` |
| PATCH `/world-clock` | Operator bearer token, `{revision,running?:boolean,speed?:1\|2\|4}` | Updated `clock` |

```js
clock = {
  id: "world-v1",
  elapsedMs: 40320000, // cumulative simulated milliseconds; never calendar-wrapped
  running: true,
  speed: 1,
  revision: 0, // increments only when the operator changes the controls
  serverTime: "2026-11-21T00:00:00.000Z",
  calendar: {
    startYear: 1560, yearsPerCycle: 56, monthsPerCycle: 672,
    secondsPerMonth: 60,
    cycle: 2, year: 1560, month: 1
  }
}
```

The `world_clock` table has one row with the fixed primary key `world-v1`. The first clock/config/sync request initializes its real-time anchor, elapsed value zero, running state true and speed one. Concurrent first requests cannot create separate epochs. Initialization is a runtime insert, not migration data. Subsequent requests read the same persisted row, so Worker restarts do not restart the clock.

While running, elapsed time is `base_elapsed_ms + max(0, server_now - anchor_real_ms) × speed`; while paused it is `base_elapsed_ms`. `serverTime` identifies the server instant represented by that result. A client should poll about every five seconds and apply game simulation only through the latest confirmed server elapsed value. It may extrapolate that recent snapshot with a monotonic performance timer for a smooth clock display, but must not commit speculative simulation: a simultaneous operator pause or rate change can invalidate extrapolated time. A disconnected browser must not invent a different world clock. On reconnection, the client applies the difference from the saved checkpoint in bounded simulation batches before allowing new actions. The explicit standalone local mode is separate from this online shared world.

Only the operator can pause/resume the world or select speed 1, 2 or 4. Ordinary players receive HTTP 403 `ADMIN_REQUIRED` for clock controls. A control update first accounts for time accumulated under the old speed, then atomically stores the new base/anchor and increments the revision. This preserves cumulative time across pause/resume and speed changes. The request must include the observed revision and at least one control field. Unknown fields, including attempts to set `elapsedMs`, are rejected with HTTP 400 `INVALID_INPUT`. Concurrent or stale updates return HTTP 409 `CLOCK_REVISION_CONFLICT`. Valid control attempts are limited to 60 per operator per minute.

The displayed calendar repeats **1560 January → 1615 December → 1560 January**. One simulated month is 60 seconds. The display uses `absoluteTurn = floor(elapsedMs / 60000)`, `cycle = floor(absoluteTurn / 672) + 1`, and the month within the cycle. A cycle change keeps absolute time, officers, facilities, technology, stored resources and historical receipts. It settles captured territory, resets non-home castles to the initial world and clears prior-cycle NPC/player diplomacy and scouting. The original chosen home is restored; the operator retains protected Edo and the reserved clan/U variant. Non-home castle jobs are cancelled, while facility/research/home jobs continue. Internal turns remain absolute and are valid through 999,999,999; treaty/scouting expiry permits a further six turns.

`GET /config` and every successful sync response also include the current `clock`, allowing the first save load to receive the same authoritative time without waiting for a separate poll.

### Save checkpoints and legacy migration

The optional saved field is `state.worldClock = {id:"world-v1",elapsedMs:integer}`. It represents the common-clock instant already applied to that game state, not a second independent clock. `state.turn` must equal `floor(elapsedMs/60000)`, and `state.realtime.elapsed` must equal `(elapsedMs % 60000)/1000` within 0.00001 seconds. Unknown checkpoint authority fields are stripped. Writes normalize the legacy saved running/speed settings from the global clock; imported personal settings cannot control time. Reads preserve those stored fields so an operator clock change cannot change the save fingerprint at the same save revision. Clients use the separate authoritative response `clock` for current running/speed and apply it locally.

A new or imported legacy save without this field remains acceptable for its first migration. The client attaches it to the current common time, retimes relative treaty/scouting expiries and dated history, and keeps resources and jobs without granting rewards for time before that initial attachment. Later checkpoints can be old: the client must process the elapsed difference, including time spent disconnected. The server returns the current clock alongside an old checkpoint rather than silently moving the saved date without simulating its effects.

The server rejects a checkpoint more than 5,000 simulated milliseconds ahead of its current clock with HTTP 400 `CLOCK_AHEAD`. For an established campaign with an active branch ledger or a lord's seat, a prediction that crosses into a future CPU-turn month receives HTTP 409 `DEFENSE_CLOCK_PENDING`. The writer retains its save and revision and retries when that month begins. Predictions inside the current month retain the 5,000 ms tolerance. Invalid clock ID, integer range, turn or fractional phase returns HTTP 400 `INVALID_CLOCK_ANCHOR`. Once a cloud save has a checkpoint, a subsequent PUT without one returns HTTP 409 `CLOCK_ANCHOR_REQUIRED`; the check is part of the atomic save update, so a race cannot downgrade an anchored record to a legacy one. The original saved snapshot stays intact on any rejection.


## Territory settlement and achievement notices

Cycle rewards are **100 magatama + 1,000 gold + 1,000 rice for each non-home castle owned at the closing boundary**. The original chosen home never generates this reward. Resetting the world removes all additional holdings, restores the chosen home (Edo for the operator), preserves that home's castle level and facility development, and cancels only construction at other castles. Local treaties, scouting and player-field diplomacy from before the new boundary end. Account identity, roles, guild membership/treasury, officers, technology, resource balances, gift receipts and historical achievements persist. Normal resource caps still apply.

`state.cycle = {index, home, latestReward}` is canonical server metadata. `index` is a zero-based internal epoch and is not shown as a numbered cycle in the UI. `home` remembers the original starting base even if the campaign temporarily relocates after losing it. `latestReward` is null or `{cycle,captured,gold,rice,magatama}`. Server `player_saves.cycle_index` and `cycle_home` govern subsequent uploads; clients cannot roll these back, supply a new grant, or replay a prior cycle's reward via an old snapshot. A deliberately fresh campaign may select a new eligible home within the same cycle. Existing client-authored/imported game saves remain the game's trust boundary; this is transaction-safe accounting, not a claim of comprehensive anti-cheat validation of every resource or conquest.

At rollout, `settings.cyclePolicyStart` anchors the current epoch on normal world-clock, sync or public field/ranking traffic. Older saves begin participating in the current epoch without retroactive rewards for previous loops. Legacy saves with fractional phases receive a consistent integer-millisecond clock anchor. Offline catch-up uses the exact deterministic client engine and officer data, including continuous income, construction and research completion, seeded CPU decisions and defeat. Work is bounded to 86,400 simulated seconds per settlement call and at most two newly closed cycles; a very old account continues across later calls. Subsequent unplayed cycles have no captured non-home territory to reward again.

The settlement batch checks the observed save revision, prior cycle, current clock-control revision, operator entitlement, and **the writer lease at commit time**. An explicitly authorized writer is bound to its device; lazy reads may commit only while no active writer owns the save. Taking over or acquiring a lease during calculation prevents the old operation from committing. The new save, per-cycle `cycle_receipts`, achievement rows and expired player relations commit atomically through one private nonce. A failed statement rolls everything back. Duplicate calls or lost-response retries return the already-settled snapshot without another grant.

Active writers stop at the boundary minus one millisecond, block mutations, persist/flush that final checkpoint, then call `refresh({settleCycle:true})`. The cloud coordinator flushes pending changes and sends POST `/sync/settle` with the current device/revision; this also handles an unchanged final checkpoint. Ordinary `/sync` and `/field/me` read polls do not settle an active writer's unflushed state. PUT `/sync` accepts a valid final pre-boundary checkpoint before settling it. All own-action routes check the caller's writer/revision before attempting settlement; another player's active writer is left to finish its own checkpoint. Public field actions wait while such a target is pending. Expired/offline accounts settle lazily, and public field/rank projections immediately omit stale captured holdings. `CYCLE_SETTLEMENT_REQUIRED`, `CLOCK_REWIND`, `REVISION_CONFLICT` and `LEASE_REQUIRED` require refreshing the canonical snapshot. The settlement endpoint permits 60 attempts per account per real minute.

GET **`/achievements?limit=20&cursor=<opaque>`** is public. `limit` is 1–50, and the optional bounded opaque cursor uses newest-first keyset pagination. It returns:

```js
{
  ok:true,
  events:[{id,playerId,playerName,clan,kind,title,detail,targetId,targetName,value,occurredAt}],
  nextCursor:null,
  serverNow:"2026-11-21T00:00:00.000Z"
}
```

Events come from accepted saves or authoritative settlement transitions: first occupation of a particular castle in an epoch, 3/10/30/50/100 held castles, unification, facility levels 1/4/8/16/24/32, research levels, claimed goals, and nonzero territory settlement rewards. Server-side catch-up completions use the same event path. First imported/uploaded saves do not fabricate a historical stream. Event keys deduplicate replayed saves, recaptures of the same castle within an epoch and repeat milestones. Event insertion is in the same conditional transaction as the accepted state; rejected/conflicting writes cannot publish. Names/clans are projected from the current public identity. No last-login times, email, device, session, private resource totals, guild ledger or recipient-only mail is exposed. Treat all returned text as text content. The UI polls only while visible, roughly every thirty seconds, and can load older notices.

The checked-in `worker/game-engine.js` matches the frontend `engine.js` exactly; `worker/game-officers.js` differs only by replacing the browser `window.` global with `globalThis.`. After shared gameplay edits, run `node scripts/sync-game-runtime.mjs <absolute frontend dist>` and check parity. `node scripts/build.mjs` concatenates those modules and the API into a single Worker ESM; no Node APIs or packages are used at runtime. `node scripts/test-world-cycles.mjs` covers atomic settlement, dirty-writer/read races, takeover, offline projection, repeated cycles, old imports, fractional checkpoints, public events, rollback and operator/demotion restrictions using local fixtures only.

## Automatic cloud saves and writer lease

Every identity has one persistent game snapshot and a monotonically increasing numeric revision. Saves are isolated by the authenticated user ID; a client-supplied user ID cannot select another account's record. Before the first saved snapshot, `save` is `null`, `revision` is `0`, and `updatedAt` is `null`.

All four routes return this snapshot shape on success:

```js
{
  ok: true,
  user,
  save: {
    game: "sengoku-tento", version: 2, savedAt: "2026-11-21T00:00:00.000Z",
    state: { /* validated version-2 game state */ }
  }, // or null before the first save
  revision: 1,
  updatedAt: "2026-11-21T00:00:00.000Z", // server commit time, or null
  writerDeviceId: "document-device-id", // or null
  writerDeviceName: "パソコン", // or null
  leaseExpiresAt: "2026-11-21T00:00:30.000Z", // or null
  serverTime: "2026-11-21T00:00:00.000Z",
  writable: true,
  entitlements: {edo: false, ieyasuU: false},
  staffBase: null, // current staff receive the separate shared base DTO below
  clock // current shared world clock, as specified above
}
```

| Method / path | Body / query | Behavior |
|---|---|---|
| GET `/sync` | `?deviceId=…` (optional) | Reads the authenticated account's snapshot without acquiring or renewing a lease. |
| POST `/sync/lease` | `{deviceId,deviceName?,takeOver?:boolean}` | Claims an empty or expired lease, renews the same device's lease, or explicitly takes over when `takeOver:true`. |
| POST `/sync/release` | `{deviceId}` | Releases only the matching holder's lease. Another device's release is a harmless no-op. |
| PUT `/sync` | `{deviceId,revision,save:object}` | Saves only when the revision matches and this device still holds an unexpired lease; increments revision and renews the lease. A boundary settlement can additionally increment revision. |
| POST `/sync/settle` | `{deviceId,revision}` | Active writer explicitly finalizes a cycle after flushing its last pre-boundary save; returns a full sync snapshot. |

Device IDs use ASCII letters, digits, `_` or `-`, with a maximum length of 90 characters. Use a fresh ID per browser document so two tabs are independent writers. A linked identity can have several connected devices, but only one device advances and writes the game at a time. `writable` is true only if the requested device is the current holder and the lease has not expired. Server timestamps allow a client to compute the remaining duration without trusting its local wall-clock offset.

A lease lasts 30 seconds. Successful lease acquisition/renewal and successful save writes extend it. Reading, online heartbeats and unrelated authenticated operations do not. A competing lease request returns HTTP 409 `LEASE_HELD` unless the user explicitly requests takeover. The client should read the latest snapshot after a conflict and offer an explicit “この端末でプレイ” action; background polling must not set `takeOver:true`.

Save writes use a single SQL `UPDATE … WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>? RETURNING …`. If its condition fails, the server does not change the stored snapshot. An absent, expired or displaced writer lease returns HTTP 409 `LEASE_REQUIRED`. A stale revision with a valid holder returns HTTP 409 `REVISION_CONFLICT`. Two writes of the same revision cannot both succeed. After an uncertain network result, read the current revision rather than blindly overwriting it. A release does not delete progress or reset its revision.

The client polls snapshots every five seconds while the document is visible, schedules a save about one second after local changes, renews its lease at least every ten seconds while active, and heartbeats presence every twenty seconds. It pauses progression when the lease or network is unavailable and preserves a local recovery copy before replacing conflicting local progress. These intervals describe the client integration; the server enforces the lease and revision checks independently. Synchronization is automatic polling, not a claim of instantaneous delivery or uninterrupted operation during network loss.

`PUT /sync` has a two-MiB streamed request-body limit, including its JSON wrapper. Other bodies remain limited to 16 KiB. The server validates the game's version-2 schema, including the 256 officer IDs, 129 castle records, 64 facilities, resource ranges, officer variants, jobs, armies, governors, timers, receipts and battle data. Only known fields survive normalization; imported `isAdmin`, `role` or other authority flags are not trusted. Invalid data returns HTTP 400 `INVALID_SAVE`. The returned save is the normalized canonical content, so clients must accept normalization without erasing actions made while a save request was in flight. Each identity is limited to 120 lease requests and 120 save writes per minute, with independent counters.

### Operator assets and restoration

The sole authority is `settings.adminUserId`, established by the existing one-time `/admin/claim` flow. Every authenticated request resolves the current role from the server; the save file, device name, browser settings and request body cannot grant it. `entitlements.edo` and `entitlements.ieyasuU` are both true only for that identity.

General-player writes containing `home:"edo"`, ownership of Edo under their own clan, or the variant `of_b0616adde162:U` are rejected with HTTP 403 `ADMIN_ENTITLEMENT_REQUIRED`. Other ranks of that officer remain usable. A general player completes unification over 126 eligible castles; staff and the operator each have 127 available because the other reserved base is excluded.

For the operator, reading or writing a valid save idempotently includes Tokugawa Ieyasu (`of_b0616adde162`) and its U variant, fixes `state.clan` to the reserved `德川家`, and fixes the home at Edo (`home:"edo"`, `castles.edo.owner=state.clan`). Only castles owned by the save's previous clan are renamed; ordinary `徳川家` NPC holdings are not automatically added when the previous clan was different. An older operator save based elsewhere moves to Edo while retaining its former territory, resources, buildings and collection. On that initial move only, each of Edo's troop, wall and castle levels becomes the maximum of its old value and the former home's value. A pending Edo castle job is adjusted to the next level, or completed/removed if Edo is already level 64. Other jobs and their remaining time are preserved. Edo is included once in `captureRewards`; repeated restoration never replenishes troops or duplicates rewards. Both the client and backend enforce this same deterministic migration, and the public field always locates an operator at Edo. No extra restore endpoint or second administrator-registration key is required on linked devices.

If an account has a previously stored operator save but is no longer the operator, reads remain recoverable: Ieyasu U becomes SSS; Edo ownership and its castle jobs are removed; Edo as the home is relocated to the clan's usual owned home or another owned castle. For an Edo-only campaign its castle level and garrison move to the clan's original home, preserving the rest of the progress. This read-time migration does not increment the stored revision or renew the lease. The next write is still subject to full general-player validation. There is no public role-reassignment endpoint.
When that legacy save has `clan:"德川家"`, read migration first neutralizes ordinary `徳川家` NPC holdings, then renames the old reserved holdings to ordinary `徳川家`. This preserves the old ownership set; it never grants the whole ordinary Tokugawa territory. Any now-self treaty is removed. A new ordinary save with the reserved clan is rejected with 403 `ADMIN_CLAN_REQUIRED`, regardless of imported role flags. The first-start UI excludes Edo, Kyoto Gosho, Nijo, Osaka and Nagoya, while existing ordinary saves at Nijo/Osaka/Nagoya remain valid; the sync API does not treat a historical imported home as proof of a new-start selection. Edo stays operator-only in every save and cannot be captured, but real-player reward battles are available on the shared field. Field summaries include `majorCity:boolean` for these five homes. `node scripts/test-clans.mjs` verifies the character distinction, migration, ordinary metropolitan save compatibility and Edo reward-battle invariants.

## Global online player list

| Method / path | Authentication and body / query | Result fields, in addition to `ok` |
|---|---|---|
| POST `/presence` | Bearer token, `{deviceId,deviceName?,online:boolean}` | `user`, `onlineWindowSeconds:90` |
| GET `/online` | Public, `?cursor=…&limit=…` | `players:user[]`, `total:number`, `nextCursor:string|null`, `onlineWindowSeconds:90` |

Send `online:true` every twenty seconds only while the game document is visible. Send `online:false` when hidden, leaving or disconnecting when possible. A player is online if any device for that identity has an explicit true heartbeat newer than ninety seconds. The boundary is strict: exactly ninety seconds old is expired. Closing a tab without a final heartbeat therefore clears naturally within that window. Multiple devices are deduplicated into one player; hiding one does not hide a second visible device.

`/online` returns public user ID, display name, clan and public guild information without management roles with `online:true`. It never returns tokens, pairing codes, IP addresses, device IDs/names or per-device activity times. It is sorted by user ID and paginated with an opaque user-ID cursor. The default page size is 50; `limit` accepts 1 through 100. `total` covers all currently online identities, and `/config.onlineCount` uses the same presence rule. Pagination is a current live view, so presence changes between pages can change the total.

`GET /me`, chat, sync reads and other background authenticated requests do not create presence. Foreground presence writes are limited to 180 per identity per minute. Per-device presence records older than 24 hours are removed on that identity's next presence update; this cleanup does not touch sessions or cloud saves.

## Shared player field, city battles and diplomacy

The shared field projects real cloud-saved players onto their home castles and their owned Nijo, Osaka and Nagoya holdings. A target belongs to a **player ID and castle ID**. Multiple players at the same historical castle remain separate selectable accounts; this API does not establish one exclusive worldwide owner for each historical castle. An identity without a cloud save has no field target. NPC campaigns remain separate from these player battles and alliances.

| Method / path | Authentication and body / query | Result |
|---|---|---|
| GET `/field` | Public; optional bearer token; `?cursor=…&limit=…` | `{ok,players,targets,total,nextCursor,clock,rules}` |
| GET `/field/me` | Bearer token; optional `?deviceId=…` | `{ok,self,revision,clock,rules,attack,relationships,battles}` |
| POST `/field/attack` | Bearer token; `{targetPlayerId,targetCastleId?,troops,tactic,requestId,deviceId,expectedRevision}` | Full current sync snapshot, plus `{battle,idempotent}` |
| POST `/field/diplomacy` | Bearer token; `{targetPlayerId,action,requestId,deviceId,expectedRevision}` | `{ok,relationship,idempotent,clock}` |

Both POSTs require the acting identity's unexpired writer lease and exact cloud-save `expectedRevision`. The client catches up to a confirmed world clock, flushes local changes, suspends local mutations during the request and applies the authoritative snapshot before reporting completion. A stale defender PUT cannot overwrite a raid or capture because its revision has changed. Unsent local edits are preserved as a recovery backup rather than silently resubmitted over an incoming battle.

### Public and private field objects

```js
fieldPlayer = {
  playerId:"u_…", name:"領主名", clan:"織田家",
  homeCastleId:"kiyosu", homeCastleName:"清洲城",
  targetCastleId:"nijo", targetCastleName:"二条城", isHome:false,
  battleMode:"capture", capturable:true, majorCity:true,
  level:48, keepLevel:32,
  defenseTroops:3750, defensePower:4600,
  armySummary:{officerCount:3,rankPower:1.08},
  self:false, online:false, evaluation, appearance,
  relationship:"neutral", // self | allied | incoming | outgoing | neutral
  protectedUntilElapsedMs:0, attackable:true, attackReason:""
};
attack = {
  ready:true, reason:"", availableTroops:5000, minTroops:300, maxTroops:5000,
  command:3, rice:50000, cooldownUntilElapsedMs:0, remainingCooldownMs:0
};
relationship = {
  targetPlayerId:"u_…", targetName:"相手の領主", status:"incoming",
  expiresElapsedMs:600000, remainingMs:600000,
  proposedBy:"u_…", revision:0
};
```

GET `/field` sorts and paginates **players** by an opaque player-ID cursor, with a limit from 1 to 100 (default 50). `players` remains one home entry per player and `total` remains the player count. `targets` expands the same page to each home plus owned Nijo/Osaka/Nagoya, without duplicating a home. Clients must key selections by `playerId` and `targetCastleId`, use the returned cursor, and not infer a player count from `targets.length`. At a cycle boundary, pending settlement projects only the restored home; expired holdings are not attackable.

Only public names, display clan, home/target, development levels, aggregate defense, current presence, evaluation and cosmetic appearance are exposed; site roles are omitted. There are no private balances, saves, devices, tokens, pairing codes or IPs. A guest sees neutral relationships, `self:false` and `attackable:false`. Optional authentication supplies the requester's relationships and eligibility. Internal combat permissions still come from server-owned operator and staff records. Protection from **capture** belongs to Edo and Kyoto Gosho; an operator's or staff member's other three metropolitan holdings can still be captured.

`level` is the target's castle level: Kyoto Gosho up to 128, Edo up to 64, Nijo/Osaka/Nagoya up to 48, other castles up to 32. Home artwork uses the independent completed `keepLevel` from personal `state.buildings.keep`, or authoritative shared `staff_base.buildings.keep` for Kyoto Gosho. The operator role takes precedence over staff membership. Missing or invalid home keep levels project as 1; finite numeric legacy values are floored and bounded to 1–32. A missing shared value never exposes personal keep development. Holdings use their castle development for artwork, bounded to the final stage 32. Facilities persist across territory cycles.

GET `/field/me` is private to the authenticated identity. `self` and `revision` can be null without a saved base. `attack` contains only that identity's available troops, commands and rice; another writer device makes `ready:false`. `relationships` includes only that identity's live proposals/alliances, and `battles` contains its newest 20 player battles. A query cannot select another identity's private history.

### Battle rules and result

All clients receive these capabilities and rules:

```js
rules = {
  minTroops:300, maxTroops:100000, commandCost:1,
  foodBase:150, foodPerTroop:0.3,
  attackCooldownMs:60000, defenderProtectionMs:60000,
  proposalLifetimeMs:600000, allianceDurationMs:360000,
  maxLootPerResource:500, maxLootFraction:0.05,
  maxDefenderLossFraction:0.1,
  targetCastles:true, specialBaseBattles:true,
  captureCastles:["nijo","osaka","nagoya"],
  uncapturableCastles:["edo","kyoto_gosho"],
  victoryRewards:{gold:500,rice:500,wood:500,stone:500},
  tactics:[
    {id:"balanced",name:"正攻法",food:1,modifier:1,loss:1},
    {id:"assault",name:"総攻撃",food:1.25,modifier:1.18,loss:1.35},
    {id:"siege",name:"包囲戦",food:1.65,modifier:0.97,loss:0.8},
    {id:"ambush",name:"伏兵",food:1.1,modifier:1.06,loss:0.95}
  ]
};
```

An attack costs one command and `ceil(troops × 0.3 × tactic.food) + 150` rice. It needs 300–100,000 troops, within the actor's saved force, and a confirmed world-clock checkpoint at most 15 simulated seconds old. Self, active allies, unavailable targets, protected defenders and a paused world are blocked. Attack cooldown and defender protection each last 60 simulated seconds, including a repelled attack. Deadlines use monotonic world `elapsedMs`, so device clocks and calendar wrap cannot shorten them. Kyoto Gosho's protection is shared across its staff defenders. Offline opponents are eligible using their most recent persisted save.

The server derives combat strength from saved troops, morale, research, castle/wall development, tactics and equipped officers' strongest owned ranks. Rank multipliers for D/C/B/A/S/SS/SSS/U are 0.90/0.95/1/1.08/1.16/1.25/1.35/1.50, averaged over the army; an empty army uses 0.75. Home defense includes its garrison, 45% of mobile troops and a fixed 200-point base. A metropolitan holding uses its garrison, 18% of mobile troops and its own wall. Kyoto Gosho uses authoritative shared castle/wall levels. Siege reduces wall effectiveness. Win chance is bounded to 5–95% and resolved using server cryptographic randomness. Client-supplied results, strengths, rewards, losses and role flags are rejected.

| Mode | Target | On a victory |
|---|---|---|
| `reward` | Actual operator Edo or staff Kyoto Gosho | Grant up to 500 each of gold/rice/wood/stone, limited by capacity. `rewards` records actual grants. `loot` and defender losses are zero; the battle commit does not write the defender save or shared base. No capture. |
| `capture` | Explicitly selected, player-owned Nijo/Osaka/Nagoya | Transfer that player's city into the winner's campaign and remove it from the defender's ownership. The winner retains its home. Ordinary bounded loot/loss rules also apply. |
| `raid` | Other ordinary player home; legacy home-only requests | No ownership transfer. Bounded resource loot and troop losses only. |

The attacker's loss is bounded to 35% of the sent force. For raid/capture, the defender loses at most 10% of mobile troops and 10% of the target garrison. Each victorious loot transfer is bounded to 5% of the saved defender balance and 500 units, then by receiver capacity; transfers balance between saves. Reward battles create the separately recorded reward without taking defender resources. Expedition rice is consumed. On a newly owned city capture, 15% of the surviving sent troops are assigned as its garrison and deducted from mobile troops; the remainder returns immediately. No extra troops are created.

If the captured city was the defender's home, it retreats to an ordinary castle and updates both the saved cycle home and database cycle-home anchor atomically. Officers, army, governors, buildings, research and other campaign progress survive. The lost city's castle upgrade is removed or carried to the fallback home when valid; unrelated jobs remain. A player who already owns that historical city retains its existing higher castle development and valid upgrades. Staff personal campaign backups are updated with committed capture progress so a later dismissal cannot restore the lost holding. A newly owned city becomes a public holding target and can be attacked again.

Omitting `targetCastleId` preserves the previous home-only **raid** semantics for the three capturable cities. Explicit selection is required for capture. The semantic request hash distinguishes the absence of a target castle from its explicit value. New clients require `targetCastles`, `specialBaseBattles` and an explicit `reward`/non-capturable DTO before offering Edo or Kyoto Gosho attacks; an older server response cannot be interpreted as permission.

```js
battle = {
  id:"fb_…", requestId:"client-uuid", attackerPlayerId:"u_…", attackerName:"…",
  defenderPlayerId:"u_…", defenderName:"…", castleId:"nijo", castleName:"二条城",
  battleMode:"capture", won:true, tactic:"balanced", troops:3000, attackerLost:300,
  defenderLost:{troops:120,garrison:150}, foodCost:1050,
  loot:{gold:500,rice:500,wood:500,stone:500},
  rewards:{gold:0,rice:0,wood:0,stone:0},
  capture:{captured:true,castleId:"nijo",castleName:"二条城",
    attackerPlayerId:"u_…",defenderPlayerId:"u_…",
    defenderHomeCastleId:"kiyosu",defenderHomeCastleName:"清洲城",
    newlyOwned:true,garrison:405},
  attackPower:4000, defensePower:3800, winChance:53,
  occurredElapsedMs:120000, createdAt:"2026-11-21T00:02:00.000Z",
  attackerRevision:5, defenderRevision:8,
  nextAttackElapsedMs:180000, defenderProtectedUntilElapsedMs:180000
};
```

`capture.captured` is false outside a confirmed capture victory; `newlyOwned:false` and `garrison:0` apply when no capture occurred. UI success must follow the committed `won` and capture fields, not merely the selected mode. Raid/capture increment both save revisions once, retaining the defender's lease. Reward battles increment only the actor's save revision. Normal time progression continues: for example, a staff actor's response snapshot may finish an already-due shared construction job. Defense projects that due job before combat, and the commit guards the observed shared revision; this natural completion is not battle damage or a battle grant. Battle records are private to the two participants. Campaign resources and upgrades still originate in validated client saves; this service is authoritative over player battle authorization, resolution and atomic settlement, not every campaign transition.

### Mutual diplomacy

`action` is `propose`, `accept`, `reject` or `cancel`. Only the recipient of a live incoming proposal may accept/reject it. Only its sender may cancel an outgoing proposal. A proposal lasts 600,000 simulated milliseconds. Acceptance establishes a 360,000-millisecond alliance (six game months), during which both directions of attack are blocked. Accepted alliances run to their expiry or the next shared cycle boundary and cannot be cancelled early by either player. Rejected, cancelled and expired relationships return `relationship:null`; the history row remains for concurrency checking. Re-proposing after expiry is allowed. At most 20 live proposals/alliances may involve either participant; this limit is also checked inside the committing transaction.

Diplomacy changes separate relationship records and does not alter either game save or save revision. It can be performed while the world is paused, but its elapsed-time expiry remains paused with the common clock. No player can forge another player's approval by sending an alternate proposer ID or action.

### Idempotence, atomicity and errors

Retain a fresh UUID `requestId` across retries of each distinct action. IDs are scoped to the acting identity and shared across attack/diplomacy operations. A semantic hash binds the kind, target player, optional target castle (including its absence), and troops/tactic or diplomatic action. Reusing an ID for different content returns HTTP 409 `REQUEST_ID_REUSED`. Retrying the same completed raid returns the identical battle record and the **latest** attacker sync snapshot with `idempotent:true`, never an old save that could rewind later progress. A diplomacy retry returns the current relationship without repeating the action. Identity/device recovery does not make a completed operation execute again.

The server reads and validates both saves, then uses a conditional insert into `field_requests` as the gate for one D1 batch transaction. The gate atomically checks the acting lease/revision, defending revision, world-clock revision, current alliance, attack cooldown and protection, plus current roles/staff terms and the shared Kyoto Gosho base revision when relevant. Only statements matching the newly generated private commit nonce can update the applicable saves and insert the battle. Capture also updates the cycle-home anchor and applicable personal staff backup in that transaction; reward battles omit defender writes. A duplicate request or failed condition changes neither save. An exception in any statement rolls back the complete batch. Diplomacy uses the same request gate with relation-revision comparison and consent rules. Consequently, a concurrent alliance acceptance and attack cannot both commit from the same observed state.

Requests are limited to 30 new raid attempts and 20 new diplomatic attempts per identity per real minute. Successful replays do not consume another battle/cooldown or rate-limit allowance. Bodies use the general 16-KiB limit; IDs follow the normal 90-character identifier rule. Public lists are read-only and never renew a lease or foreground presence.

| HTTP | Field error | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_TARGET` | Invalid amount/tactic/action/extra authority field, or self-target |
| 404 | `FIELD_PLAYER_NOT_FOUND` | Missing player or unsaved target base |
| 409 | `SAVE_REQUIRED`, `BASE_UNAVAILABLE` | No usable cloud base |
| 409 | `LEASE_REQUIRED`, `REVISION_CONFLICT` | Acting device must acquire/refresh synchronization |
| 409 | `CLOCK_ANCHOR_REQUIRED`, `CLOCK_STALE`, `WORLD_PAUSED`, `WORLD_CLOCK_CHANGED` | Confirm and apply the common clock before attacking |
| 409 | `INSUFFICIENT_FORCE` | Not enough troops, command or rice |
| 409 | `ALLIED_TARGET`, `ATTACK_COOLDOWN`, `TARGET_PROTECTED` | Active alliance, attack wait or defender protection |
| 409 | `DIPLOMACY_STATE`, `DIPLOMACY_LIMIT` | Consent state changed, action not permitted, or active relationship limit |
| 409 | `FIELD_CHANGED`, `FIELD_TARGET_CHANGED`, `REQUEST_ID_REUSED` | Concurrent target/relation update, or an ID reused for a different operation |

## Chat

| Method / path | Body / query | Result |
|---|---|---|
| GET `/chat` | `?channel=world|guild|friend|admin&target=…&after=…` | `{messages:message[],channel,nextAfter:number,hasMore:boolean,playerEvaluations}` |
| POST `/chat` | `{channel,target?,text}` | `{message}` |

Messages are limited to 300 Unicode characters. Sending is limited to one message per player per five seconds across channels. Reads return at most 100 messages.
Without `after`, GET returns the newest 100 in chronological order; `after` is the numeric message ID returned in `nextAfter`.
`world` is shared across all authenticated players.
`guild` requires current membership; `target` is optional and, if supplied, must be the current guild ID.
`friend` requires `target` to be a mutually accepted friend's user ID. The server derives the pair room in a consistent order.
`admin` is restricted to the single primary operator and currently appointed support staff. Staff membership is checked from the database on each request and again in the actual private-message read/insert SQL. A dismissal that commits after authentication but before that SQL prevents both reads and sends with HTTP 403 `STAFF_CHAT_REQUIRED`. The client cannot choose the sender or supply operator/staff flags. Message role badges reflect each author's current server-owned role.

## Guilds

| Method / path | Body | Result |
|---|---|---|
| GET `/guilds` | — | `{guilds:guild[]}` (at most 50) |
| GET `/guild` | — | `{user,guild:guild|null,members:user[]}` |
| POST `/guild` | `{name}` | `{guild,user}` |
| POST `/guild/join` | `{guildId}` | `{user}` |
| POST `/guild/leave` | `{guildId?}` | `{user}` |

One guild per player, 50 members per guild, unique guild names up to 24 characters.
Guild roles are `owner` (盟主), `officer` (副盟主) and `member` (メンバー), independent of operator/support-staff roles. Public safe user objects use `guildRole` for this value. Appointing a deputy never grants `isAdmin`, `isStaff`, privileged Edo/Ieyasu assets, private staff access or operator powers.

### Guild roles and membership removal

| Method / path | Body | Response in addition to `ok` |
|---|---|---|
| POST `/guild/members/role` | `{guildId,targetPlayerId,role:"officer"|"member",requestId}` | `user,guild,members,idempotent` |
| POST `/guild/members/remove` | `{guildId,targetPlayerId,requestId}` | `user,guild,members,idempotent` |

The owner can appoint/demote deputies and remove other members, including deputies. A deputy can remove an ordinary member but cannot appoint roles, remove an owner or remove another deputy. Self-management through these endpoints is rejected; use `/guild/leave` to depart. The target must still belong to the explicitly supplied `guildId`, and the actor must currently belong to that same guild with the required role. This prevents a delayed operation from silently targeting a new guild after an account changes membership.

Every intended management operation needs a stable `requestId`, retained across retries. The same actor/request ID with the same guild/target/action does not repeat an appointment, demotion or removal. An old appointment replayed after demotion does not reappoint; an old removal replayed after the target rejoins does not remove the target again. Different content under that ID returns 409 `REQUEST_ID_REUSED`. A fresh private commit nonce guards both the operation record and the exact role/membership write in one D1 transaction; the SQL verifies current actor/target membership and permissions again. New operations allow 30 per actor per real minute; completed-ID retries do not consume that allowance.

On owner departure, ownership transfers to the earliest-joined remaining deputy, or the earliest remaining member if there is no deputy; user ID breaks timestamp ties. Existing shared funds stay with the guild. The final member can leave and delete the guild only when all five treasury balances are zero. A nonempty final treasury returns 409 `GUILD_TREASURY_NOT_EMPTY`, preserving both membership and funds. Successful receipt/idempotency history is retained after an empty guild dissolves. Officer records automatically disappear when their membership is removed. Guild membership lists, private treasury history and guild chat re-check current membership inside their SQL read/write, so a revocation between authentication and execution cannot disclose the former group's private information or post a message.

### Shared treasury

All current members, including ordinary members, can contribute and withdraw shared **gold, rice, wood, stone, magatama and troops**. There is no role-based withdrawal limit beyond the common amount/balance bounds and rate limit below. Treasury balances and transaction history are visible only to current members.

`GET /guild/treasury?limit=50&cursor=…` returns:

```js
{
  ok:true, guildId:"g_…",
  treasury:{gold:0,rice:0,wood:0,stone:0,magatama:0,revision:0},
  ledger:[{
    id:"gt_…", requestId:"operation-uuid", guildId:"g_…",
    playerId:"u_…", name:"領主名", direction:"deposit", resource:"gold", amount:100,
    createdAt:"2026-11-21T00:00:00.000Z", worldElapsedMs:60000,
    playerRevision:4, treasuryRevision:2
  }],
  nextCursor:null, serverNow:"2026-11-21T00:00:00.000Z"
}
```

The default/maximum page size is 50; valid limits are integers 1–50. History uses newest `created_at DESC,id DESC` keyset order and a bounded opaque cursor. Its `name` is the player's display name when the operation committed. It exposes no tokens, request hashes, private commit nonces or raw saves. An older guild without a treasury row receives a zero row lazily, without migration backfills.

`POST /guild/treasury/transfer` requires exactly:

```js
{
  guildId:"g_…", direction:"deposit", // or "withdraw"
  resource:"gold", // gold | rice | wood | stone | magatama
  amount:100,       // integer 1..1_000_000
  requestId:"operation-uuid", deviceId:"current-writer", expectedRevision:3
}
```

The response combines the full current `/sync` snapshot with `{guildId,receipt,treasury,idempotent}`. `receipt` has the same shape as a ledger entry above. Gold/rice/wood/stone modify `state.resources`; magatama modifies `state.magatama`. Each successful transfer increments both the player's save revision and the treasury revision exactly once, retains its prior common-clock checkpoint, renews the writer lease and adds a game log entry. A player needs a valid cloud save, an unexpired current writer lease, the expected save revision and a common-clock checkpoint no more than 15 simulated seconds behind the server. Transfers remain available when the shared clock is paused. Each personal/shared balance remains between zero and 999,999,999; an operation cannot mint funds through a negative, fractional, unknown-resource or out-of-range amount.

The operation digest covers caller ID, explicit guild ID, direction, resource and amount. A successful `(actorId,requestId)` record has no TTL. Replaying the same content returns the original receipt with `idempotent:true` and the current account snapshot, even if the expected save revision or device ID has changed; it never reapplies the amount. The account must still belong to the requested guild to see its private balance. If membership has changed, the old operation cannot target a new guild and returns `GUILD_REQUIRED`. A changed semantic payload under a used ID returns `REQUEST_ID_REUSED`. Successful request records survive guild dissolution, preventing reuse in a replacement guild.

New transfers are limited to 30 attempts per account per real minute. The conditional operation insert verifies current guild membership, exact player revision/writer/lease, treasury revision, shared clock revision and current operator status in one D1 transaction. A per-attempt private nonce gates both balance/save updates and the identity-clan projection; a competing duplicate cannot borrow the first attempt's operation record. Concurrent withdrawals cannot spend the same treasury balance twice. Any statement failure rolls back the receipt, save and treasury together. A lost response after commit is resolved by retrying the same ID. The client must flush local gameplay first, pause local mutations during the request, retain the same request ID across retries/reloads, and refresh/apply the authoritative sync snapshot afterward. It must not call a separate local gift-application function for treasury withdrawals.

Errors include 401 authentication, 403 `GUILD_REQUIRED` for absent/mismatched current membership, 403 `GUILD_ROLE_REQUIRED` for management permission, 404 `GUILD_MEMBER_NOT_FOUND`, 400 invalid input/cursor, 409 `INSUFFICIENT_ASSETS`, `ASSET_LIMIT`, `SAVE_REQUIRED`, `LEASE_REQUIRED`, `REVISION_CONFLICT`, `CLOCK_ANCHOR_REQUIRED`, `CLOCK_STALE`, `WORLD_CLOCK_CHANGED`, `AUTHORITY_CHANGED`, `TREASURY_CONFLICT`, `GUILD_CHANGED`, `REQUEST_ID_REUSED` and `GUILD_TREASURY_NOT_EMPTY`. A conflict requires refreshing the relevant snapshot; it never authorizes a client-side adjustment of balances.

### Public guild rankings

`GET /guild/rankings?limit=50&cursor=…` is public and returns `{ok,guilds,total,nextCursor,serverNow}`. Each entry includes the normal guild summary plus `totalPrestige`, `ownedCastles` and one-based `rank`. The primary order is total saved prestige descending, with guild ID ascending for ties. Each member contributes their latest cloud save once; a member without a cloud save contributes zero prestige and zero owned castles. The castle total counts member campaign holdings, including separate players at the same historical castle, and follows the deterministic operator-Edo/read-migration ownership projection. A member/JSON castle cross-product never multiplies prestige or member count.

Default/maximum page size is 50. The opaque cursor stores the last prestige total and guild ID. Rankings are a live view, so member/save changes can move entries between pages; clients should deduplicate and refresh from the first page. Only guild names, owner identity, member count, public prestige/castle totals and rank are returned. Private treasury balances, receipts, individual resources and save data are never included.

## Player trades: exports, imports and escrow

Trade is private to its two authenticated player IDs. Clan names, home castle IDs and guild membership do not select a wallet or grant access. A participant may offer any combination of **gold, rice, wood, stone, magatama and troops** in exchange for another combination. An empty requested bundle is a free export. Trade charges no command or additional fee and remains available while the common clock is paused.

The server holds the sender's offered assets as escrow when a proposal is created. Acceptance subtracts the recipient's requested payment and credits the offered assets to that recipient in the same transaction. The sender's proceeds are recorded as an unclaimed delivery. Cancellation or rejection instead records the original offered bundle as a refund delivery. Only the delivery owner can explicitly claim it into their own current save. The other player's save, revision and writer lease are never changed by any trade operation, so a trader who is online with unsaved gameplay is not forced to replace that gameplay when the other participant accepts or rejects a proposal.

### Routes and exact input

| Method / path | Input | Result |
|---|---|---|
| GET `/trades?box=incoming&limit=20&cursor=…` | `box` is `incoming`, `outgoing`, `history` or `claimable`; limit 1–50 | `{ok,trades,nextCursor,summary,rules}` |
| GET `/trades/recipient?playerId=u_…` | Another player's public ID | `{ok,player}` using the normal public player DTO; target must have a saved base |
| GET `/trades/:tradeId` | A `tr_` ID followed by 32 lowercase hexadecimal characters | `{ok,trade}` for either participant |
| POST `/trades` | Proposal shown below | Full sync snapshot plus `{trade,receipt,idempotent}` |
| POST `/trades/:tradeId/accept` | Writer envelope shown below | Same response; recipient pays and receives, sender gains a pending delivery |
| POST `/trades/:tradeId/cancel` | Writer envelope | Same response; sender cancels a pending proposal |
| POST `/trades/:tradeId/reject` | Writer envelope | Same response; recipient rejects a pending proposal |
| POST `/trades/:tradeId/claim` | Writer envelope | Same response; delivery owner receives the whole pending bundle |

```js
// POST /trades
{
  targetPlayerId:"u_…",
  offer:{gold:1000,wood:200},
  want:{rice:600}, // {} (or omitted) means no payment is required
  requestId:"operation-uuid",deviceId:"current-document",expectedRevision:12
}

// Writer envelope for accept, cancel, reject and claim
{requestId:"operation-uuid",deviceId:"current-document",expectedRevision:13}
```

Only the listed fields are accepted. Every specified bundle value must be a safe integer from 0 to 1,000,000; strings, fractions, negative values, nulls and unknown asset names are rejected. Missing asset fields are normalized to zero, in the fixed order `gold,rice,wood,stone,magatama`. The offered bundle must contain at least one positive value. A requested bundle may be all zero. Gold, rice, wood and stone use `state.resources`; magatama uses `state.magatama`. The payer must own the full outgoing bundle before receiving the incoming bundle, including when the same asset appears on both sides.

Incoming and outgoing lists contain all states in their respective direction; history contains both directions. The `claimable` box contains only deliveries owned by the authenticated player whose `claimed_at` is null, including old proceeds and refunds beyond the first history page. A claimed delivery disappears from this box on the next read. Lists use immutable `created_at DESC,id DESC` keyset order, with a bounded cursor tied to the selected box. The default page size is 20 and the maximum is 50; `summary` and `rules` retain the same shape for every box. These reads do not claim a delivery, change a trade, apply world progression or modify a game save. A missing trade and a trade belonging to other people both return `TRADE_NOT_FOUND`.

### Trade, receipt and list DTOs

```js
{
  id:"tr_…",revision:2,status:"accepted", // pending | accepted | cancelled | rejected
  sender:{playerId:"u_sender",name:"提案時の送り主名"},
  recipient:{playerId:"u_recipient",name:"提案時の相手名"},
  offer:{gold:1000,rice:0,wood:200,stone:0,magatama:0},
  want:{gold:0,rice:600,wood:0,stone:0,magatama:0},
  createdAt:"2026-11-21T00:00:00.000Z",updatedAt:"2026-11-21T00:01:00.000Z",
  delivery:{
    kind:"proceeds", // or refund
    recipientPlayerId:"u_sender",
    assets:{gold:0,rice:600,wood:0,stone:0,magatama:0},
    claimedAt:null // ISO timestamp after the owner claims
  }, // null while pending, or after a free export is accepted
  canAccept:false,canReject:false,canCancel:false,canClaim:true
}

// Receipt is immutable evidence of one successful request, not a fresh quote.
{
  id:"tx_…",requestId:"operation-uuid",tradeId:"tr_…",action:"accept",
  playerId:"u_recipient",playerRevision:14,tradeRevision:2,
  createdAt:"2026-11-21T00:01:00.000Z"
}

// Extra fields on the list response
{
  summary:{incomingPending:1,outgoingPending:2,claimable:1},
  rules:{assets:["gold","rice","wood","stone","magatama"],maxAmount:1000000,
    balanceLimit:999999999,maxPending:20}
}
```

The capability flags are relative to the authenticated viewer. `canAccept` and `canReject` belong only to the recipient of a pending proposal; `canCancel` belongs only to its sender. `canClaim` means this viewer owns an unclaimed delivery. It does not pre-approve current wallet space or the device's writer lease. Both participants may see the agreed terms and delivery status, but neither receives the other participant's wallet, raw save, devices or credentials. Names are snapshots from proposal creation. `receipt.action` is one of `propose`, `accept`, `cancel`, `reject`, `claim`.

Proposal creation, acceptance and claiming each increment the acting player's save revision exactly once and renew that player's writer lease. Cancellation and rejection update trade/delivery state without modifying either save or lease. Every successful state transition, including a delivery claim, increments the trade revision. A free export creates no proceeds delivery and no unnecessary sender claim action. Every successful mutation returns the full current sync snapshot; `receipt.playerRevision` and `receipt.tradeRevision` remain the values at the original commit even when a replay returns newer save/trade state.

### Atomicity, limits and recovery

All five mutations require the actor's exact save revision, current writer device, unexpired lease and common-clock checkpoint no more than 15 simulated seconds behind the server. The client must update common time, durably save and flush local gameplay, pause local mutations for the request, then refresh/apply the canonical server snapshot. It must not add imports with `applyGift` or a separate local balance adjustment. The account's current operator/staff term, save revision/writer/lease, clock revision, proposal state/revision, permitted side and unclaimed-delivery state are checked in the conditional operation insert inside the same D1 batch. The private per-attempt commit nonce gates all subsequent trade, save and delivery changes. No update is authorized merely because another concurrent attempt used the same public request ID.

There can be at most 20 pending outgoing proposals per player, checked again at commit. Proposals have no automatic expiry; the sender can cancel them. New attempts share a limit of 30 per account per real minute. A proposal's offered funds cannot be spent in another proposal or ordinary save action after its committed deduction. Competing accept/cancel/reject operations permit exactly one transition from pending. Concurrent claims cannot credit the same delivery twice. Any statement failure rolls back the entire operation, including the receipt and any earlier save update.

Persist each request ID and semantic payload before transport. The unique `(actor_id,request_id)` receipt has no TTL. Replaying identical semantics returns the original receipt and current trade/sync snapshot before checking the old device/revision; reusing an ID for another action, target or bundle returns `REQUEST_ID_REUSED`. Device and expected-save revision are transport context and are not part of the semantic hash. Canonical zero-filled bundles make omitted/explicit zero fields equivalent. After an uncertain response, retry the same request ID and terms with the current device/revision. Clear the client pending record only after the canonical save revision is at least `receipt.playerRevision` and the transaction can be read at or above `receipt.tradeRevision`.

Every resulting wallet balance must be at most 999,999,999. Acceptance or claim that would overflow any asset fails as a whole with `ASSET_LIMIT`; no truncation, partial delivery, deletion or payment occurs. In particular, a full wallet does not discard a refund: it remains claimable until the owner makes space. Escrow, request receipts and deliveries live outside imported saves and survive new campaigns, world cycles, guild changes and staff transitions under the same player ID. Restoring an old game save does not reopen a claimed delivery. Existing deliberate save-import semantics still apply to wallet balances; this system does not attest every locally authored gameplay balance.

Other errors include `INVALID_INPUT`, `INVALID_CURSOR`, `INVALID_TARGET`, `PLAYER_NOT_FOUND`, `TRADE_NOT_FOUND`, `TRADE_FORBIDDEN`, `TRADE_CLOSED`, `TRADE_NOT_CLAIMABLE`, `TRADE_ALREADY_CLAIMED`, `TRADE_PENDING_LIMIT`, `TRADE_CHANGED`, `INSUFFICIENT_ASSETS`, `SAVE_REQUIRED`, `LEASE_REQUIRED`, `REVISION_CONFLICT`, `CLOCK_ANCHOR_REQUIRED`, `CLOCK_STALE`, `WORLD_CLOCK_CHANGED`, `AUTHORITY_CHANGED`, and `RATE_LIMITED`. A failed operation is never permission to adjust balances locally.

## Friends

| Method / path | Body | Result |
|---|---|---|
| POST `/friends/request` | `{userId}` | `{status:"pending"|"accepted",direction:"incoming"|"outgoing"}` |
| POST `/friends/respond` | `{userId,accept:boolean}` | `{status:"accepted"|"declined"}` |
| DELETE `/friends` | `{userId}` | `{deleted:true}` |

For respond, `userId` is the requester. Only the recipient can approve a pending request. Deleting also cancels a pending request. Friend requests are limited to 20 new requests per ten minutes.

## First administrator registration and announcements

| Method / path | Body | Result |
|---|---|---|
| POST `/admin/claim` | `{key}` | `{user,alreadyAdmin:boolean}` |
| POST `/admin/announcement` | `{text}` | `{announcement:string}` |

The registration key comes only from the server runtime secret `SENGOKU_ADMIN_KEY`; it is not present in any source file or client asset.
Comparison hashes both strings and compares fixed-size hash strings without early exit.
Registration attempts are limited to five per ten minutes per identity and per hashed Cloudflare source IP where available.
The first successful claim atomically reserves the single `adminUserId` setting. Concurrent correct claims can produce only one admin.
After registration another identity cannot claim, even with the key. The already registered identity can retry using its own bearer token. Use the separate `/admin/recover` flow to authenticate as the original identity after losing its local token; never retry `/admin/claim` on a replacement account as a recovery method.
Never advertise management enrollment to ordinary players. Public `/config` does not expose registration or recovery capabilities. Only the authenticated admin receives `/me.management.recoveryAvailable`; bind it to that same `/me.user.id` and clear it on identity or role changes. Use the private `/me.user.isAdmin` to show authorized admin tools.
Announcements are plain text, at most 300 characters; an empty string clears the announcement.

## Support staff appointment and removal

### Recent authenticated connections

`GET /staff/recent-logins?limit=50&cursor=…` is restricted to the current primary operator or appointed support staff. It returns:

```js
{
  ok: true,
  players: [{...user, lastSeen: "2026-11-21T00:00:00.000Z"}],
  total: 1,
  serverNow: "2026-11-21T00:01:00.000Z",
  windowStart: "2026-11-20T00:01:00.000Z",
  nextCursor: null // or an opaque string
}
```

The list represents each identity's **last authenticated connection**, using `users.last_seen`; it is not a login-event audit trail or a count of device sessions. Authentication refreshes this value at most once every 60 seconds, including authenticated background sync/presence and a subsequently denied operation. Creating/linking a token alone does not establish a separate login event. The usual following `/me` or sync request records authenticated use. `online` remains the separate foreground-presence signal with its existing 90-second window.

The server includes rows whose final connection is between its current `serverNow - 24h` and the first page's server time, inclusively. Future timestamps and rows older than the current rolling window are always excluded. Default and maximum page size are 50; callers may request an integer from 1 to 50. Results sort by `last_seen DESC, id ASC`, and return each user once regardless of additional tokens or presence rows. `total` counts the eligible users before the cursor-position filter.

The opaque keyset cursor carries the first page's upper time bound and the last returned `(last_seen,id)` position. Its version, bounded encoding, integer timestamps and safe identity syntax are validated; a future or more-than-24-hour-old upper bound is rejected with 400 `INVALID_CURSOR`. The lower bound always comes from the server's current clock, so a caller cannot use a cursor to request older history. The records remain live: later authenticated use can move an identity above the original page bound. Clients should deduplicate appended pages by user ID and refresh from the first page to pick up such changes. The supplied `serverNow` and `windowStart` are ISO strings for the current request.

Missing/invalid bearer authentication returns 401. An ordinary or dismissed staff member receives 403 `STAFF_REQUIRED`. Role authorization and the SELECT/COUNT queries use one D1 transaction, with an authoritative membership check in every data query, preventing a revocation between authentication and the read from disclosing rows. The response contains only the usual safe user fields plus `lastSeen`; no token hashes, device names/IDs, IP addresses or raw database rows are returned. `lastSeen` is added only to this private endpoint and never to generic `mapUser`, `/online`, `/players`, field or chat responses. All responses are `Cache-Control:no-store`.

The existing `users_last_seen_idx` supplies the time range scan; no schema migration is needed for this list. `node scripts/test-recent-logins.mjs` verifies authorization, revocation races, boundaries, ordering, cursors, privacy and throttled timestamp semantics with local data only.

### Role management

The primary operator can appoint existing player identities as support staff. The additional role grants access to the `admin` chat room, the private recent-connections list and the protected shared Kyoto Gosho base described below. It does not grant Edo, Ieyasu U, world-clock control, announcement editing, system mail/gift sending, staff management or another primary-operator registration. Those checks continue to require `isAdmin`.

| Method / path | Authentication and body | Result |
|---|---|---|
| GET `/admin/staff` | Primary operator bearer token | `{ok,staff:[staffMember]}` |
| POST `/admin/staff` | Primary operator bearer token; `{targetPlayerId,action:"appoint"\|"dismiss",requestId}` | `{ok,user,staff:[staffMember],action,idempotent}` |

`staffMember` contains the user presentation fields plus private `isAdmin`/`isStaff`, `appointedAt:ISO` and `appointedBy:operatorPlayerId` on this authorized management route. The roster is sorted by appointment time and player ID. The POST response's `user` is the **target** player's current public identity, not the operator who made the request. A client must not replace its logged-in identity with this object. Resolve candidates using the existing authenticated `GET /players?q=…` search (2–24 characters), then submit the exact returned ID.

The operator cannot appoint/dismiss itself. A target must already exist, and unknown action/authority fields are rejected. The initial operator registration remains single-owner; staff cannot appoint others, dismiss themselves through this endpoint or become the primary operator by submitting the registration key after a claim exists. Staff appointments do not require a game save or a writer lease because they first change server identity permissions; the next authoritative synchronization safely migrates or restores the campaign.

The account's own `user` on `/me`, `/sync` and linked-device results retains `isStaff:boolean` and `isAdmin:boolean`; authorized management results retain them as well. General `/players`, `/online`, field, guild and chat identities omit both fields. The primary operator's private identity is represented with `isAdmin:true,isStaff:false`. Imported save flags, profile changes and request-body flags cannot set either role.

A stable `requestId` is required; supply and retain a UUID for each intended role change and reuse it on retries. Omitting it returns HTTP 400 `INVALID_INPUT` without changing membership. The server atomically records the acting operator, target and action with the membership mutation. The same ID and content never repeat an action: an old appointment retried after a later dismissal returns the current `isStaff:false` and `idempotent:true`, without reappointing the player. Reusing that ID with a different target/action returns HTTP 409 `REQUEST_ID_REUSED`. A new request ID represents a new intended operation. Appointing an existing staff member or dismissing a nonmember is a safe no-op and reports `idempotent:true`; these no-ops do not reset appointment timestamps.

The membership change and request ledger use one D1 transaction, gated by a fresh private commit nonce. The conditional operation insert checks that the actor still equals the primary `adminUserId`; a stale cached operator flag cannot grant roles. A partial failure rolls back both the ledger entry and membership change. Distinct concurrent appointment/removal requests serialize at the database; a duplicated request changes membership at most once. New operations are limited to 30 per operator per real minute. Completed-ID retries do not consume another allowance.

Removal takes effect for every token and paired device on its next authoritative request. `/me` and `/sync` immediately report `isStaff:false`; both admin-chat reads and sends return 403. Clients must remove the restricted channel selection and clear its cached messages when the role disappears. Ordinary world/friend/guild chat and the player's personal save remain available. There is no token rotation or game reset on appointment/removal, and no production role assignments are part of deployment.

Errors include HTTP 401 for missing authentication, 403 `ADMIN_REQUIRED` for any non-primary operator attempting staff management, 400 `INVALID_TARGET` for self-role changes, 404 `PLAYER_NOT_FOUND` for an unknown target and 409 `REQUEST_ID_REUSED` for a conflicting retry ID. Private-chat rejection uses 403 `STAFF_CHAT_REQUIRED`.

## Account moderation and irreversible post removal

Only the identity currently named by `settings.adminUserId` can inspect moderation records or ban/unban a player. Support staff, ordinary players and role flags supplied in JSON cannot use these routes. The authenticated operator and the currently protected operator identity cannot be targeted. The operator should search, inspect the exact public ID/name and affected counts, then explicitly confirm the action. The server rechecks the operator and target at commit time.

| Method / path | Input | Response |
|---|---|---|
| GET `/admin/moderation/players?q=…` | Name or complete public player ID, 2–90 characters | `{ok,players}`; public player fields plus `banned` and `moderationRevision`, at most 30 |
| GET `/admin/moderation/target?playerId=u_…` | Exact player ID | Target preview below |
| GET `/admin/moderation/bans?limit=20&cursor=…` | Limit 1–50; bounded keyset cursor | `{ok,bans:[{player,ban}],nextCursor,contentRevision}`; active bans only |
| POST `/admin/moderation` | `{targetPlayerId,action:"ban"|"unban",reason?,requestId,expectedRevision}` | Current target preview plus `{receipt,idempotent}` |

`reason` is an optional private operator memo of at most 300 Unicode characters. It is never included in public player, chat, letter or error DTOs. `expectedRevision` is the target's `ban.revision`, **not** a save revision. It is 0 before the first moderation action and increases on each successful ban or unban. A fresh operation whose expected revision is stale, or whose requested status is already current, returns `409 MODERATION_CHANGED` without changing anything. This prevents an old confirmation from acting after an intervening ban/unban cycle.

```js
// Target preview, also returned after a mutation with the latest current state.
{
  ok:true,player:{id:"u_…",name:"確認する領主名", /* normal public player fields */},
  ban:{active:false,revision:0,reason:"",bannedAt:null,bannedBy:null,updatedAt:null},
  counts:{chatMessages:12,letterMessages:3,pendingTrades:2},
  canBan:true,canUnban:false,contentRevision:0
}

// Immutable receipt from a committed ban.
{
  id:"mod_…",requestId:"operation-uuid",action:"ban",
  targetPlayerId:"u_…",targetName:"実行時の領主名",actorPlayerId:"u_operator",
  reason:"運営の非公開メモ",moderationRevision:1,contentRevision:1,
  deleted:{chatMessages:12,letterMessages:3},cancelledTrades:2,
  createdAt:"2026-11-21T00:00:00.000Z"
}
```

The active-ban roster is ordered by `updated_at DESC,user_id DESC`. Its cursor retains that pair; unbanned identities disappear on the next read. Every private moderation SELECT independently verifies the live operator condition in its database snapshot. The request receipt stores operation IDs, parties, timestamps, memo, revisions and counts computed at commit, never deleted message text. The original chat and letter bodies are physically deleted, not copied to a moderation archive. Sender-scoped letter request hashes and message IDs remain so a delayed replay cannot reinsert an erased message; after unban, replaying such an old letter returns `LETTER_NOT_FOUND`.

### What a ban changes atomically

One nonce-gated D1 batch records the moderation request and new account status, increments the global content revision, deletes **only messages authored by the target** from every world/guild/friend/operator chat and private/guild correspondence thread, recalculates affected letter thread heads, invalidates its pairing codes, releases its game writer lease and marks every presence row offline. It closes active walking sessions and clears the active-session pointer while retaining the already settled step count, walking receipts and save. It also cancels every still-pending trade involving that player and records the original offer as a full refund delivery for each trade's sender. Any failing statement rolls back all of these effects, including the audit receipt.

Other people's text in the same conversation remains. Game saves, wallet balances, guild membership/roles, shared treasury balances, trade receipts, completed deliveries and other financial history are preserved. The operator does not acquire the banned player's assets or guild leadership. A non-banned sender can claim its resulting trade refund even while the counterpart remains banned. A banned sender's pending refunds/proceeds remain available under the same account after unban. New letters and new trade proposals cannot select a currently banned destination; proposal commits also recheck the target's access generation. Existing conversations remain readable by their other authorized participants, who may continue posting their own text.

### Account access and unban

All of the account's original and linked-device tokens return `403 ACCOUNT_BANNED` from authenticated routes while the ban is active. Tokens and player IDs are retained, allowing the same account to reconnect after an explicit unban. Old pairing codes remain invalid and new codes must be issued after restoration. No game writer lease is automatically restored. Walking must start a new measurement session; a session stopped by the ban cannot claim a new step delta after unban. Replaying an already settled walking receipt retains the ordinary exactly-once behavior.

The moderation revision is also an authentication generation. A request retains the generation observed during authentication; mutation SQL checks it again alongside the account's active status. Chat, new/reply letter batches, saves, writer leases, presence, pairing, profile, guild/friend/mail actions, shared construction and other guarded commands cannot commit using a generation from before a ban. A ban followed immediately by unban therefore cannot revive an older in-flight request: it returns `409 ACCOUNT_ACCESS_CHANGED`. A final response check also prevents a private read started under an earlier generation from returning account data after that transition. A currently banned account always receives `ACCOUNT_BANNED`.

Public online counts/listings, player search, field targets, achievement listings and avatar retrieval omit currently banned players. Avatar objects and achievement records are retained and may become visible again after unban. The removed chat and letter text is never restored by unban. Account suspension does not delete a locally stored offline game or claim to prevent someone from creating a different identity.

Persist the exact action payload and request ID before sending. Successful `(actor_id,request_id)` records have no TTL; same-content retries return the original receipt and current target preview without repeating the action. The semantic digest includes target, action, memo and original expected moderation revision. Changed content under a used ID returns `REQUEST_ID_REUSED`. Replaying an old ban after unban does not ban the player again, and replaying an old unban after a new ban does not lift it. New operations are limited to 30 per operator per real minute. Other errors include `ADMIN_REQUIRED`, `INVALID_TARGET`, `PLAYER_NOT_FOUND`, `INVALID_INPUT`, `INVALID_CURSOR`, `MODERATION_CHANGED` and `RATE_LIMITED`.

### Removing stale client copies

Each committed ban increases a global integer `contentRevision`; unban does not restore content or increment it. Chat GET responses and letter summary/inbox/thread/message responses include this revision. Chat GET, letter inbox GET and letter thread GET accept `?contentRevision=<last-observed>`; omission is equivalent to 0 for existing clients. If that value differs from the database snapshot, the response sets `reset:true`, ignores the old delta/older-page cursor and returns the latest page. Chat returns up to 100 messages in chronological order; a letter thread uses its normal latest-page limit and resets `hasOlder`, `nextBefore`, `hasNewer`, `nextAfter` and `readCursor` to that page. No removed body is returned. The revision and the selected page are read in the same D1 transaction, so an old body cannot be labeled with a later purge revision.

Clients must replace cached content on `reset:true`, clear cached chat/thread/inbox pages when a newer global revision is observed, and request fresh pages. They must not merge the replacement page into the old ID map. Responses older than an already observed content revision are stale and must not repopulate caches. Ordinary pagination/delta merging continues when revisions match. Letter summary provides the revision even if a thread receives no new messages, allowing an open conversation's deleted content to disappear on the next refresh.

## Mail and gifts

| Method / path | Body | Result |
|---|---|---|
| POST `/admin/mail` | `{target:"all"|userId,title,body,gift:null|gift,requestId}` | `{mailId,alreadySent:boolean}` |
| GET `/mail` | — | `{mail:[{id,title,body,gift,read,claimed,createdAt,source,event,participants?}]}` (newest 200) |
| POST `/mail/read` | `{mailId}` | `{read:true}` |
| POST `/mail/claim` | `{mailId,requestId}` | `{gift,receiptId,alreadyClaimed:boolean}` |

Only the primary operator can manually send mail. Subject limit 60 characters, body limit 2,000. The server also creates the automatic battle notices described below; triggering a game action does not grant permission to send arbitrary mail or gifts.
`target:"all"` is a broadcast campaign visible to current and future identities; it does not fan out rows for every player. Individual mail is visible only to its target.
Gifts accept only integer `gold`, `rice`, `wood`, `stone` and optional `magatama` fields between 0 and 1,000,000 per field. Missing fields mean zero; all-zero gifts become null. A positive `magatama` amount is preserved in the mail and claim response, so magatama-only gifts are valid. Missing/zero `magatama` is omitted from canonical gift JSON to preserve the exact representation and send-idempotency hash of existing four-resource gifts. Clients read it as `gift.magatama ?? 0`; old resource-only mail and receipts remain compatible. The existing JSON columns store the added field without a schema migration. Sending any gift, including magatama, remains restricted to the primary operator; support staff cannot manually send system mail or gifts.
Use a fresh UUID `requestId` for each new send or claim and retain it across retries. Reusing a send ID with different content returns 409.
Claim is atomic with a unique `(mailId,userId)` receipt. A second claim with the same request ID returns the same gift and receipt with `alreadyClaimed:true`; a new request ID after claim returns 409 `GIFT_ALREADY_CLAIMED`.

**Frontend receipt requirement:** persist pending claim request IDs before the fetch. On success, pass `gift,receiptId` to the game's save-backed gift application function. It must check and persist an applied-receipts ledger atomically with the local gift change: the four resources go to `state.resources`, while magatama goes to `state.magatama`. Replayed identical receipts must never add resources or magatama twice. A failed network response should retry with the same request ID. Mail claims cannot independently make an offline editable game save authoritative.

### Automatic shared-field battle notices

Each newly committed shared-field battle creates exactly two private messages in the existing **郵便** inbox: one for the attacker and one for the defending player. This includes raid, capture and reward battles, on both victory and defeat. The recipient's perspective determines the win/loss wording. The defender's notice explicitly reports being attacked. Neither party needs to be online, and each notice remains unread until that recipient calls `/mail/read`; reading the list or replaying the battle does not mark it read. `/me.unreadMail` includes these notices. The existing newest-200 inbox limit applies; stored notices are not deleted when they leave that list.

The title and body record the opponent and castle, battle type, actual troop/resource losses, actual credited loot or rewards, and the ownership result. If a captured home moves to an ordinary castle, the same notice names the previous and replacement homes and explains retained facilities, army, governors, officers, research, surviving troops/resources, applicable construction progress and the replacement cycle home. An outpost loss does not claim that the home moved. Edo/Kyoto Gosho notices state that the battle causes no defending ownership, troop, resource, facility or formation loss; ordinary time progression and shared construction continue.

Automatic notices have `source:"system"` and `event:{kind:"field-battle",battleId:"fb_…",side:"attacker"|"defender"}`. Existing and newly sent operator messages have `source:"operator"` and `event:null`, regardless of their title/body or extra input fields. Older clients can ignore these additive fields and display the same notices through the existing inbox. Notices have `gift:null`, cannot be replied to through mail, and return `NO_GIFT` from `/mail/claim`: all reported rewards were already credited by the battle and must not be granted again.

Both notice inserts share the exact private commit-nonce gate and D1 transaction as the battle, receipt and applicable saves. A failed condition inserts no messages; failure of either notice insert rolls back the whole battle, including any previously inserted notice. Concurrent duplicates and lost-response retries return the existing receipt without sending again, and previously read notices stay read. Each ID is derived from the server-generated battle ID and recipient side. A reserved `system:field:<battleId>:<side>` request namespace identifies this source positively; public request identifiers reject `:`, so `/admin/mail` cannot create this namespace. The existing `sender_id` stores the battle's initiating player as the internal actor reference; it does not identify a human author or grant mail-sending rights. No schema migration or synthetic user is required.

Battles committed before this feature are not retroactively mailed. Personal-map NPC battles, CPU invasions and CPU-driven home moves currently remain in their existing local battle report/game log; they have no durable per-event identifier or server battle command and are not inferred from an uploaded save to create these notices.

## Shared staff base and protected metropolitan castles (v3.7)

Every authenticated support staff member has a fixed, protected home at **京都御所 (`kyoto_gosho`)**. Their active house is **德川家**, while their original ordinary clan is preserved in the authoritative personal campaign backup. Their individual resources, officers, research, governors, army, gifts and guild balances remain separate. New staff games also start as 德川家 at Kyoto Gosho; their displayed leader is the ordinary **徳川家康**, and ordinary officer-rank restrictions still apply. The primary operator takes precedence over staff membership: it remains **德川家 at 江戸城**, with the exclusive 德川家康 U. Kyoto Gosho is unavailable to ordinary players and the operator for initial selection, capture or relocation; ordinary players may attack a staff member's Kyoto Gosho in a non-capturing reward battle on the shared field. Ordinary unification covers 127 eligible castles, while a staff member and the operator each cover 128. Public field and guild ranking projections apply current roles even before the player's next save.

The five major cities are Edo, Kyoto Gosho, Nijo, Osaka and Nagoya. Kyoto Gosho **castle** levels stop at 128, Edo at 64, Nijo/Osaka/Nagoya at 48, and ordinary castles at 32. All 64 **facility** types remain limited to 32. The starting selector excludes all five cities (124 ordinary choices). Existing ordinary Nijo/Osaka/Nagoya campaigns remain valid. Artwork retains its final stage after level 32.

Version 3.9.6 reads former Nijo/Osaka/Nagoya levels 49–64 by lowering only those castle levels to 48. It validates the former level and next-level job before removing an over-cap castle job; unrelated jobs, army, governors, officers, facilities and resources survive. A level-48 castle with a valid legacy level-49 job is handled the same way. Invalid former levels above 64 or malformed jobs remain invalid. New sync writes must satisfy the 48 cap. Personal staff backup projections follow the same normalization without changing shared Kyoto Gosho development.

### Source and commands

| Method / path | Authorization | Result |
|---|---|---|
| GET `/staff/base` | Current staff or primary operator | `{ok,staffBase,clock}` |
| POST `/staff/base/upgrade` | Current non-operator staff; own active writer | Full sync snapshot, `staffBase`, `receipt`, `idempotent` |

Every normal sync snapshot also includes `staffBase` for current non-operator staff, otherwise `null`. Shared progress has its **own revision**. A completion or another staff member's construction does not increment an uninvolved player's personal save revision. The client must apply shared updates as an overlay while preserving locally dirty personal gameplay and its current screen.

```js
staffBase = {
  id:"kyoto_gosho", revision:12, protected:true,
  castleLevel:4,
  buildings:{ /* all 64 known facility IDs, server-owned levels */ },
  initial:{castleLevel:1,buildings:{ /* server-owned initial levels */ }},
  history:[{
    jobId:"sb_…",kind:"building",id:"farm",level:3,effectiveElapsedMs:123000
  }],
  jobs:[{
    jobId:"sb_…",kind:"castle",id:"kyoto_gosho",targetLevel:5,totalSeconds:60,
    queuedAtElapsedMs:140000,startedElapsedMs:140000,completesElapsedMs:200000,
    startedBy:{id:"u_…",name:"担当スタッフ"}
  }],
  createdElapsedMs:0,updatedElapsedMs:140000,
  accessSinceElapsedMs:30000,clanSinceElapsedMs:40000,
  // Personalized timeline metadata; never included in public field summaries.
  personalClan:"織田家",personalHome:"himeji",personalCycleHome:"himeji",
  personalHomeCastle:{owner:"織田家",troops:1200,wall:1,level:12},
  personalBaseCastle:{owner:"朝廷",troops:3000,wall:4,level:1}
}
// POST /staff/base/upgrade
{
  kind:"building",id:"farm", // or kind:"castle",id:"kyoto_gosho"
  requestId:"stable-uuid",deviceId:"current-document-id",
  expectedRevision:18,baseRevision:12
}
receipt = {
  requestId:"stable-uuid",jobId:"sb_…",kind:"building",id:"farm",targetLevel:4,
  cost:{gold:0,rice:0,wood:0,stone:0}, // actual individual cost
  queued:false,queuePosition:0,queuedAtElapsedMs:200000,
  startedElapsedMs:200000,completesElapsedMs:260000,
  baseRevision:13,playerRevision:19
}
```

The singleton starts from the engine's fixed initial facilities and castle level 1, independently of imported or existing personal saves. It is created lazily, without editing existing saves in a migration. No request accepts shared levels, resources, arbitrary job deadlines or history. A shared construction consumes the initiating staff member's individual resources and one command. The command checks the shared facility unlock, shared capacity (`2 + floor(sharedKeep / 8)`) and next target level. Since v3.8, a facility already under construction accepts a reservation for its next level: that facility's complete chain occupies one shared slot. A second castle-upgrade job for Kyoto Gosho still returns `STAFF_BUILDING_BUSY`. Castle jobs and facility chains compete for the same shared slots; other castles and pre-appointment personal jobs remain individual. Shared facility jobs do not use another member's resources or individual job slots.

A conditional request insert checks, in the same D1 batch, the current staff membership **term**, absence of operator priority, exact personal revision, active device lease, shared base revision, and running shared-clock revision. Its unique per-attempt nonce gates the personal debit/save update and shared job update. Only one request based on a particular shared revision can succeed; rejected races cause no debit or receipt. A subsequent intentional request must refresh first and reserves the next available stage. SQL failure rolls back every part. Each staff account keeps its own writer lease; there is no single global staff writer.

Persist a request ID and the **original `baseRevision`** before sending. After an uncertain response, retry the same kind, target, ID and original base revision, using the current device and flushed personal revision. A completed request is found before save/lease/base revision checks, but only after current staff authorization. Replaying returns the same receipt and current snapshot without another payment. Reusing an ID with a different target or base revision returns `REQUEST_ID_REUSED`. A dismissed member cannot read the shared source or replay a staff construction response. Completed jobs remain part of the shared base after their initiator leaves.

New construction attempts are limited to 30 per real minute per player. Common errors are 403 `STAFF_BASE_REQUIRED`, 409 `STAFF_BASE_CHANGED`, `STAFF_BUILDING_BUSY`, `STAFF_BUILDING_SLOTS`, `BUILDING_LOCKED`, `BUILDING_MAX`, `COMMAND_REQUIRED`, `INSUFFICIENT_ASSETS`, `WORLD_PAUSED`, `CLOCK_STALE`, `LEASE_REQUIRED`, `REVISION_CONFLICT`, and 400 `INVALID_INPUT`. After success, refresh until both personal and shared revisions are at least the receipt revisions before clearing the pending operation. On source failure, disable shared commands; do not invent an offline shared job.

### Historical progression and individual campaign restoration

Shared jobs use the monotonic world elapsed time. Pause/resume and speed changes therefore affect every staff member consistently. Completed jobs append immutable effective-time level changes; pending authoritative deadlines may be projected locally at the same instant. Bounded history (at most the finite facility/castle upgrades, under 2,200 entries) is delivered separately from the two-MiB personal save. Offline progression integrates the old level up to each effective time and the new level afterward, including exact monthly boundaries. It also uses personal facilities, home, ownership and clan bonuses before admission. The one-time `settings.staffClanPolicyStart` records the shared elapsed time at the first shared-source request after the family update. Between admission and `clanSinceElapsedMs=max(admission,policyStart)`, legacy staff use shared Kyoto Gosho facilities with their original clan bonuses; thereafter they use 德川家. This prevents the new family from retroactively changing previously unprocessed v3.7 income. Latest shared levels are never applied retroactively to an entire offline period.

The engine receives roles only through trusted `fromSave`/constructor options `{isAdmin,isStaff,staffBase}` or atomic `setRoleAccess({isAdmin,isStaff})`. UI metadata is separate: `data.staffClan` has `{name:"德川家",home:"kyoto_gosho",leader:"徳川家康",…}`, while `data.adminClan` keeps Edo and the special leader spelling. `applyStaffBase(base)` returns `{ok,changed}`; older or identical shared revisions cannot rewind the overlay. `exportSave()` writes personal facility/Kyoto Gosho development, not projected shared levels/history. `state.staffService={baseId:"kyoto_gosho"}` is a compatibility marker for old personal jobs and cleanup, never an entitlement. Forged `isStaff`, `isAdmin`, `role` and `staffBase` save fields cannot grant protected castles or alter shared progress.

On the first authoritative save read after appointment, a guarded transaction preserves a full canonical personal campaign, the membership term and its admission time, then fixes the live home at Kyoto Gosho. Before capture reset and after accepted personal castle progress, the preserved original home's development is updated in the same successful save transaction. Personal construction started before appointment continues to complete into the personal facility copy. A shared completion cannot overwrite it.

Dismissal records the world elapsed time atomically with the role change. Restoration advances the staff period only up to that exact time using historical shared levels, then returns to the original personal **clan and home** with retained development. Ownership is renamed using the exact previously owned set in both directions. NPC castles already carrying the destination family name are neutralized before the rename, so neither ordinary Tokugawa land nor a former family's NPC land is accidentally acquired. Current-role identity, field, online, search, friend and achievement projections use the normalized family immediately (general public displays use `徳川家`); dismissal can project the original family from its private backup before the first restoration sync. Current individual currencies, officers, research, jobs, gifts and remaining territory are retained; invalid governors are removed and command capacity is clamped to the restored personal keep. Shared-only castle ownership is removed. Reappointment has a new unique term even in the same real millisecond, preventing a previous term's delayed requests from committing into it. Operator promotion restores the personal campaign before applying operator Edo/德川家 assets. A staff period that spans world cycles keeps exactly-once cycle receipts and the shared base's growth.

Long disconnected departures are processed in bounded chunks of at most 86,400 world seconds per sync request. A saved intermediate checkpoint returns 409 `STAFF_TRANSITION_PENDING`; visible automatic sync continues from that checkpoint without replaying rewards. Shared permission is already revoked. No unbounded simulation or synthetic retroactive cycle grants occur in one request.

Version 3.22 adds `kyoto_gosho` as the 129th canonical castle and moves only the staff protected-base role from `sunpu`. Migration `0019_kyoto_gosho_court` moves the shared singleton, current jobs, history and receipts without resetting growth or payments. Legacy 128-castle personal saves acquire the canonical Kyoto Gosho record. A legacy staff service marker at Sunpu moves the protected home and its jobs to Kyoto Gosho while restoring ordinary Sunpu. Current `personalBaseCastle` metadata accepts the former `personalSunpu` alias on reads for compatibility. Sunpu remains a normal, selectable, capturable castle with the ordinary level-32 cap; an ordinary Sunpu campaign is never relabeled as Kyoto Gosho. Existing staff campaign backups and dismissal restoration retain their original personal home and development.

Public achievements are emitted once per authoritative shared-job completion, naming the initiating staff member, the Kyoto Gosho facility/castle and achieved level. Completion history, private campaign backups, costs and resource totals are not public. The shared source is private to staff and the operator.

## Consecutive facility construction

Ordinary facilities and the shared Kyoto Gosho facilities may reserve consecutive upgrade stages through level 32. Each action reserves exactly one level, immediately pays that level's resource cost and consumes one command. `costs(id)` quotes the next level after the existing queue tail; `costs(id,fromLevel)` explicitly quotes a given starting level. A queued level has no production or unlock benefit before its own completion. Castle upgrades remain single-stage operations and retain the ordinary/capturable-metropolitan/Edo/Kyoto Gosho limits of 32/48/64/128.

Capacity counts distinct non-research `kind:id` chains, not the number of reserved stages. Extending an existing facility chain is allowed when all slots are occupied; starting a new chain still requires a slot. A facility chain advances only its first unfinished stage. On completion, the following stage starts immediately, with costs already paid. Saved private jobs retain the existing fields `{kind,id,remaining,total,remainingSeconds,totalSeconds,targetLevel}`. Their targets must be contiguous from the completed level, and every future stage must have its full own duration remaining. At most 192 private construction stages plus one research job are accepted. Unknown presentation fields such as `shared`, `queued` or `startedBy` are stripped from personal saves.

For shared jobs, the server computes `startedElapsedMs=max(currentElapsedMs,previousStage.completesElapsedMs)` and `completesElapsedMs=startedElapsedMs+totalSeconds*1000`, using the price at the previous tail's target level. The receipt adds `queued`, `queuedAtElapsedMs`, and `queuePosition` (the number of preceding stages when reserved, starting at zero). Each job also records its reservation time. The shared source accepts at most 192 pending stages, grouped within the same shared-slot limit. Existing role, lease, revision and request-replay guards apply to each reservation; a lost response cannot reserve or charge a second stage.

`constructionJobs()` provides derived display fields for both personal and shared work: `queued`, `startsInSeconds`, `finishesInSeconds`, `remainingSeconds`, and `queuePosition` (the currently displayed chain position, starting at one). Waiting time is separate from a stage's own duration; future stages therefore show zero elapsed work. Personal jobs always receive `shared:false` from the engine. Progress is integrated at each stage completion, including offline catch-up and exact monthly boundaries. Pre-appointment personal chains continue in the private campaign through staff service and dismissal. Shared chains and their history survive cycle changes. Old saves containing only single-stage jobs remain valid without a schema migration.

## Tactical operation planner

The operation planner is a deterministic, game-specific tactical evaluator. It accepts Japanese instructions for conserving troops, prioritizing weak castles, expanding rapidly, a target castle or region, excluded castles/regions/families, minimum win chance, reserve troops/rice and a battle limit. Explicit zero battles and global attack prohibitions stop the operation. Target exclusions take precedence; conflicting, unsupported or unrecognized instructions return an error and cannot start. The UI presents the interpreted summary before an explicit start. No external language model receives the text and there is no new backend attack route.

The engine contract is:

| Method | Result and behavior |
|---|---|
| `compileStrategy(text)` | `{ok,policy,summary,recognized,warnings,message}`; compiles at most 500 characters without modifying the game |
| `planStrategy(policy)` | Read-only `{ok,action:"attack"|"wait"|"stop",code,reason,progress,alternatives,…}`; consumes neither resources nor RNG |
| `executeStrategy(policy,decision)` | Re-evaluates current state, validates the exact decision token and calls the existing battle action at most once; returns `battle`, `shouldStop`, `stopReason` and the next decision |

An attack decision contains `castleId`, `castleName`, `tactic`, `tacticName`, `troops`, `foodCost`, `winChance`, `estimatedLoss`, `reserveAfter:{troops,rice}`, and a private in-memory `token`. `reserveAfter.troops` is the uncommitted reserve, while `estimatedLoss` is a probability-weighted estimate, not a guaranteed casualty count. Up to three castle alternatives are included. The planner evaluates the existing tactics and several deployment sizes with `previewBattle`, respecting minimum win chance, deployment cost and reserve budgets. Weak-castle priority uses a consistent defense measure across tactics, then compares tactic scores for that castle. A distant target advances along eligible adjacent castles toward that goal.

Only adjacent CPU castles on the personal world map are candidates. Edo and Kyoto Gosho are always excluded, including for their privileged owners. Current ownership, treaties, excluded targets, troop counts, rice, command availability, game outcome and shared-staff source readiness are checked again before execution. The policy is bound to the campaign, cycle, clan, home, role, world and starting battle count. The token covers the complete current game state and policy; another action, manual battle, time advance or replayed decision requires a fresh plan. Manual battles also count toward the operation's configured maximum (default five, maximum twenty).

The app owns the active run and its eight-real-second interval. Before every step it checks visibility, current linked writer permission, current campaign/role, shared-clock readiness and a running clock; it applies current time, flushes, rechecks and obtains a fresh decision. One successful battle is durably saved before continuing. It stops on defeat, target completion, battle limit, hidden page, lost write permission, identity/campaign/role/cycle change or a paused clock. Insufficient resources or commands cause a wait, and short-lived conflicting UI transactions can defer a step. Automatic attacks are never replayed during offline catch-up or performed while the page is closed. A stopped run requires an explicit new start. Linked results continue through the existing save revision/lease contract; the planner does not claim server attestation or general anti-cheat protection for client-authored battles.

## Walking rewards

All player roles may explicitly start foreground walking detection. A detected step awards **2 gold, 2 rice, 2 wood, 2 stone and 2 magatama**, subject to each existing balance limit of 999,999,999. This uses real elapsed time and does not consume commands, advance the game clock, require an undefeated campaign, or change with world pause or speed. Device motion is an estimate supplied by the client; the server does not attest physical walking. No location, raw accelerometer samples, health history or background activity is sent to these routes.

| Method / path | JSON body | Additional result fields |
|---|---|---|
| POST `/walking/start` | `{requestId,deviceId,expectedRevision,campaignId}` | Full sync snapshot, `walkingSession`, `walkingRules`, `idempotent` |
| POST `/walking/claim` | `{sessionId,sessionToken,seq,totalSteps,activeMs,finish?,deviceId,expectedRevision}` | Full sync snapshot, `walkingSession`, `walkingRules`, `receipt`, `idempotent` |

```js
walkingSession = {
  id:"walk_…",token:"HMAC-SHA256-base64url",campaignId:"campaign-uuid",
  startedAt:"2026-11-21T00:00:00.000Z",lastSeenAt:"…",expiresAt:"…",
  lastSeq:0,totalSteps:0,activeMs:0,closed:false
}
walkingRules = {
  rewardPerStep:2,maxStepsPerSecond:4,heartbeatMs:5000,windowMs:30000,
  jitterSteps:2,deliveryToleranceMs:1000
}
receipt = {
  id:"walk_…:1",sessionId:"walk_…",seq:1,totalSteps:10,deltaSteps:10,
  activeMs:5000,rewards:{gold:20,rice:20,wood:20,stone:20,magatama:20},
  revision:19,closed:false
}
state.walking = {
  version:1,campaignId:"campaign-uuid",localSteps:0,serverSteps:10,
  localSession:null // or {id:"local-session-uuid",totalSteps:12,closed:false}
}
```

The client flushes its current game save before starting or claiming. Start requires its exact campaign ID, save revision and current writer lease. The start request ID is durable and scoped to the authenticated player: retrying it returns the same session and token without extending its original window. A different start cannot replace a live session for that campaign (`WALKING_ACTIVE`). A finished, expired or former-campaign session may be replaced. The token signs the player ID, session ID, campaign ID and immutable start time with a purpose-separated HMAC key generated once in private server settings. No additional environment secret is required. Never place this token in a URL, public response or log.

Claims use cumulative foreground `activeMs` and cumulative `totalSteps`, starting with sequence 1 and increasing exactly by one per newly accepted report. The unique `(sessionId,seq)` receipt stores a hash of sequence, total steps, active duration and finish flag. Persist that exact payload before transport. A lost response is retried with unchanged payload and the latest device ID/revision. A previously accepted payload returns the same receipt before checking expiry or the old save revision; it never grants again. An altered payload for an already accepted sequence returns `WALKING_SEQUENCE_REUSED`. Reloads may create a new document device ID: the same authenticated player can resume with its signed session and **current** writer lease. The prior device cannot mutate after takeover. A different account cannot use the token, and a new campaign cannot receive an old session's uncredited steps.

New claims credit only `totalSteps - serverSession.totalSteps`. A single conditional receipt insert checks the current personal save revision, writer device and unexpired lease, campaign ID, current operator/staff membership term, current active session, its prior sequence/totals, and account-ledger revision. Its unique attempt nonce gates the personal resource/save update, cumulative account counter, session heartbeat and close flag in the same D1 batch. A statement failure rolls everything back. A positive step delta increases the personal save revision once; zero-step heartbeats and a zero-step finish update only the walking ledger/session. Simultaneous identical reports share one receipt; competing totals cannot both commit.

Recommended heartbeats are every five real seconds. The 30-second `expiresAt` is the inactivity window after which another explicit start may replace a session; inactivity alone does not close it. A same-session claim may renew the window later when it is still the account's active session and the caller holds the current writer lease. `activeMs` cannot exceed the real server time since session start, and session-wide credited steps cannot exceed `floor(4 * min(activeMs, realElapsedMs) / 1000)`. The cumulative limit has **no** free jitter allowance, so repeatedly starting and finishing cannot produce free steps. A newly credited report requires at least 250 real milliseconds since the previous report and positive additional active duration. Individual delivery intervals permit at most one second of network-timing variation and two steps of delivery jitter, still subject to the strict cumulative limit and a 30-second active-duration bound. These are rate and transport checks, not proof that the device moved. There is no daily reward cap.

Closing the walking panel or navigating inside the game keeps the same counting session. Only the explicit finish control sets `finish:true`. Backgrounding, permission loss, a sensor gap or an unavailable writer/network suspends capture without closing the session. Preserve the signed session, cumulative totals, pending exact payload and continuation intent; resume the same record after access returns. Active duration is measured only from valid, closely spaced sensor readings. Time away from the page never generates duration or steps. Stop accumulating before the unsent active-duration tail reaches 30 seconds, reconcile its exact receipt, then resume capture. An authenticated claim after a long gap may settle this bounded tail without finishing when no session or campaign has replaced it. Session replacement and a resumed claim race on the account ledger revision, so only one can commit. Explicit finish and accepted-receipt replays retain the same cumulative and idempotency rules. A closed or replaced session cannot resume.

A persisted finish request stays finished after reload. A persisted running record may resume after restoration and permission checks; platforms requiring a fresh user gesture display a reconnect control. The brief `reason:applying` interval of a verified writer with a valid lease permits sensor counting but continues to block new claims until canonical-save application completes. Role confirmation, identity/campaign changes and actual writer-lease loss never grant counting authority.

`rewards` contains the actual amount added after applying each balance cap. `deltaSteps` records all newly credited steps even if an asset is already capped. The account ledger is independent of game-save imports and gift receipts. PUT `/sync` normalizes `walking.serverSteps` to the authoritative account total; importing an old counter never rewinds the ledger and never tops up previously spent/restored currency. Ordinary CAS rejects a save written with the revision from before a walking award. An intentional old-save import with a current revision retains the existing game's restore semantics; this client-authored game does not provide general anti-cheat verification of imported wallet balances.

Unlinked local mode uses `beginLocalWalkingSession(id)`, `applyLocalWalkingProgress(id,totalSteps)` and `endLocalWalkingSession(id)`. These return `{ok,changed,deltaSteps,totalSteps,rewards,closed,message}` on success. A currently active local session cannot be replaced without finishing; repeated/lower cumulative totals do not grant again, and a delayed old session cannot mutate a newer one. Save/export preserves the local ledger. A new game creates a fresh random campaign ID. Pre-feature saves load a stable `legacy_v1` campaign and zero counters. Linking a guest uploads its already-awarded assets normally; its `localSteps` are **never** reported again as server walking claims. The client partitions pending records by account and campaign and stops/isolate them on identity or campaign changes.

Common failures are 400 `INVALID_INPUT`, `WALKING_RATE_EXCEEDED`, `WALKING_TOTAL_EXCEEDED`; 403 `WALKING_SESSION_INVALID`; and 409 `WALKING_ACTIVE`, `WALKING_CAMPAIGN_CHANGED`, `WALKING_SESSION_CLOSED`, `WALKING_SEQUENCE_REUSED`, `WALKING_SEQUENCE_CONFLICT`, `WALKING_CHANGED`, `LEASE_REQUIRED`, `REVISION_CONFLICT`, or an existing bounded cycle/staff transition error. New start attempts are limited to 30 per real minute and new claim attempts to 120 per real minute per account; accepted receipt replays do not consume those limits.

## Private correspondence from player bases

Selecting another player's base can open a private conversation with that player or an external correspondence thread with their currently selected guild. Every route is authenticated. These communication operations do not require the gameplay writer lease or a running world clock and do not modify game assets.

| Method / path | Body / query | Result fields |
|---|---|---|
| GET `/letters/recipient` | `?playerId=u_…` | Current safe `player` projection, including current guild |
| GET `/letters/summary` | none | `unreadCount`, `unreadThreads` |
| GET `/letters` | `?limit=30&cursor=…` (max 50) | `threads`, `unreadCount`, `unreadThreads`, `nextCursor`, `playerEvaluations` |
| POST `/letters` | `{requestId,targetPlayerId,destination:"player"|"guild",guildId?,text}` | `thread`, `message`, `idempotent` |
| GET `/letters/:threadId` | `?before=seq&limit=40` or `?after=seq&limit=40` (exclusive cursors; max 100) | `thread`, chronological `messages`, `hasOlder`, `nextBefore`, `hasNewer`, `nextAfter`, `readCursor`, `playerEvaluations` |
| POST `/letters/:threadId/messages` | `{requestId,text}` | `thread`, `message`, `idempotent` |
| POST `/letters/:threadId/read` | `{through:seq}` | Accepted `through`, `unreadCount`, `unreadThreads` |

Thread IDs are opaque `lt_` identifiers. A thread projection includes `id`, `kind`, `title`, `peer` or `guild`/`sender`, `contextPlayer`, an explicit `visibility` explanation, `unreadCount`, `lastSeq`, `updatedAt`, `canReply`, and a last-message preview. Messages contain only `{id,seq,threadId,authorId,authorName,text,createdAt}`. Treat all names and bodies as plain text. A body must contain 1–1,000 Unicode characters after normalization/trimming; forbidden controls and unrecognized body fields are rejected. New messages share a limit of 20 per real minute per sender.

A player conversation is shared only by its exact two participants. A guild correspondence thread is shared by its external sender and the **current** guild members. It never grants access to internal guild chat and does not copy posts from that chat. The initial guild request must include the guild ID shown during recipient selection; the transaction checks that the selected player is still a member of that guild. A changed target membership returns `LETTER_TARGET_CHANGED`, with no thread/message/receipt written. Replies remain bound to the original thread's guild, with membership checked again at commit. A former member loses access; a current member can see the shared guild correspondence. Operator/staff role alone does not bypass private correspondence permissions.

Initial sends and replies persist a sender-scoped request ID and a hash of exact destination/text. The atomic receipt insert gates thread creation, message insertion and thread-head update. Retrying a lost response returns the same message without resending; an ID reused for different content returns `LETTER_REQUEST_REUSED`. Read and replay responses verify current access, including after membership changes. Read cursors advance monotonically and only up to that thread's current head; loading history does not itself mark new messages read. `before` pages older history, while `after` fetches new messages in increasing sequence order and returns a continuation when more than one page arrived; they cannot be supplied together. Unread counts exclude the viewer's own messages. There is no automatic sending to other users merely from selecting a base.

## Deployment

Use a dependency-free Cloudflare Worker ESM with `env.DB` and private `env.BUCKET`. Required manifest bindings: `d1:"DB"`, `r2:"BUCKET"`, no `static` field. Sites provisions the R2 bucket; no public object bucket URL is required.
After any frontend engine change, run `node scripts/sync-game-runtime.mjs <absolute frontend dist>` and verify exact engine parity. Run `node scripts/build.mjs` to combine `worker/game-officers.js`, `worker/game-engine.js`, `worker/letters.js`, `worker/trade.js`, `worker/moderation.js`, `worker/premium.js` and `worker/index.js` into one deployable `dist/server/index.js` Worker ESM; `worker/game-runtime.js` remains the source/test import adapter. Do not deploy a raw copy of `worker/index.js` without its modules; preserve `drizzle/` in source so Sites packages and applies the schema migrations. Apply `0000_social` through `0020_branch_states` using the append-only journal. The previously recorded migration files and journal entries are unchanged. `0001_cloud_sync` creates the device session and cloud-save tables; `0002_world_clock` adds the singleton clock; `0003_shared_field` adds field operations, relations and battles; `0004_staff_roles` adds support membership and its operation ledger; `0005_user_avatars` adds image metadata; `0006_guild_assets` adds guild roles, pooled balances and ledgers; `0007_world_cycles` adds save cycle markers, settlement receipts and public achievements; `0008_staff_base` adds staff membership terms, the historical shared staff base and private campaign backups; `0009_walking_rewards` adds independent walking accounts, signed-session metadata and cumulative receipts; `0010_base_letters` adds private/guild correspondence threads, messages, sender request receipts and per-reader cursors; `0011_player_trades` adds escrowed proposals, operation receipts and unclaimed proceeds/refunds; `0012_player_moderation` adds account access generations, private operator receipts and the initial global content-revision row. These migrations do not change existing player data. No table creation or schema alterations occur inside request handling.

Default CORS origins: the API's own origin, `https://www.kasai-solutions-inc.com`, the previous `https://uni-tadayasu.github.io` origin, `http://127.0.0.1:4173`, and the literal `null` origin for offline file HTML. No credentials/cookies are allowed. The custom-domain allowance is an exact HTTPS origin match, not a suffix or wildcard. Keeping the previous origin allows an existing signed-in device there to issue its own pairing code during migration.
For a different hosted frontend, set `SENGOKU_ALLOWED_ORIGINS` to its exact origin, or comma-separated exact origins. Do not include paths or wildcards.

Every response sets `Cache-Control:no-store` and `X-Content-Type-Options:nosniff`. CORS preflight permits GET, POST, PUT, PATCH, DELETE and OPTIONS with Authorization and Content-Type headers. Bodies are stream-limited to 16 KiB except the two-MiB sync-save endpoint and 70-KiB avatar JSON endpoint. SQL values are bound parameters; treasury column names come only from the fixed five-resource allowlist.
No environment values, plaintext keys, or bearer tokens are logged. Admin state is server-owned; client flags and sender fields are ignored.

The Worker uses D1 `prepare`, `bind`, `first`, `run`, `all` and `batch` APIs. It does not issue manual `BEGIN`/`COMMIT` statements or rely on Node APIs at runtime. D1 batches execute their prepared statements in order as one transaction and roll back on a statement failure; this is the basis of atomic pairing-code consumption. The Worker uses the ordinary D1 binding without read-replication sessions, so reads and writes address the primary database. See the [official D1 database API documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Premium cosmetics and Stripe snapshots (3.15.0)

Migration `0013_premium_purchases.sql` adds opaque purchase references, verified
event receipts, normalized checkout/invoice/payment/charge facts, risk holds,
subscription end times, cosmetic selections and operator review receipts.
`premium_grants` is a database view over those facts. It is not supplied by the
browser or by a game save. No premium operation changes game resources,
magatama, combat, roles, save revisions, writer leases or world-clock progress.

### Configuration and deployment

The public GitHub `server/` folder remains a reference copy. The actual Worker
is deployed from the dedicated Sites API project, with `worker/premium.js`
included in its build and migration 0013 applied through the existing journal.
Do not expose secrets in either repository or the browser configuration.

Runtime environment settings:

- `STRIPE_WEBHOOK_SECRET`: the signing secret of this exact **live** endpoint.
- `SENGOKU_PREMIUM_ENABLED`: only the literal string `true` enables new checkout
  links. Missing/other values keep purchases unavailable.
- `SENGOKU_STRIPE_PORTAL_URL`: an operator-configured HTTPS Stripe hosted login
  page under `https://billing.stripe.com/p/login/`. No game bearer token or
  identity file is sent to this page. A valid portal URL is required before a
  monthly purchase link can be issued.

The Worker does not hold a Stripe API secret key or call Stripe at runtime. It
uses signed snapshot events for fulfillment. Setting a catalog URL alone does
not make the service ready or grant ownership. Financial notifications continue
to be processed while the sale switch is off and while a player is banned.

Register a **snapshot** endpoint with API version `2026-09-30.endive` at:

`https://sengoku-tento.hisa-0128-1996.chatgpt.site/api/v1/premium/stripe/webhook`

Subscribe to these event types:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
charge.succeeded
charge.captured
charge.updated
charge.refunded
invoice.paid
invoice.payment_failed
invoice_payment.paid
customer.subscription.updated
customer.subscription.deleted
refund.created
refund.updated
refund.failed
charge.refund.updated
charge.dispute.created
charge.dispute.updated
charge.dispute.closed
charge.dispute.funds_withdrawn
charge.dispute.funds_reinstated
radar.early_fraud_warning.created
radar.early_fraud_warning.updated
```

The three allowed Payment Links, Prices, Products, JPY amounts and modes are
fixed in `worker/premium.js`. They correspond to `gold-banner` (480 JPY,
payment), `moonlit-castle` (980 JPY, payment) and `supporter` (780 JPY,
subscription). The links must retain fixed quantity 1, exact tax-inclusive JPY
totals and the corresponding product/price. Additional items, quantity changes,
discounts or currency conversion do not satisfy this fulfillment contract.
Changes to Stripe settings require matching server validation and tests before
sales continue.

### Player API

All player routes require the existing game bearer token and reject banned
accounts. Caller-supplied player IDs, ownership, prices or redirects are not
accepted. Each mutating SQL operation rechecks the account-access generation.

`GET /premium` returns:

```js
{
  ok: true,
  ready: false,
  player: {id: "u_…", name: "領主名", avatarVersion: null, evaluation},
  products: [{
    id: "gold-banner",
    owned: false,
    equipped: false,
    expiresAt: null, // ISO timestamp for monthly coverage, or null
    canPurchase: false,
    purchaseBlockReason: "preparing" // owned / subscription_exists /
                                    // portal_unavailable / null
  }],
  appearance: {nameplate: null, town: null, badge: null, ownedProducts: []},
  portalUrl: null,
  serverNow: "2026-11-21T00:00:00.000Z"
}
```

`player.evaluation` uses the same current public rank projection as other player screens, and `player.avatarVersion` resolves the current photo. Both fields are presentation data and do not grant payment rights.

`products` always contains the three catalog IDs. Expired monthly coverage may
retain its past `expiresAt`, but `owned` and the displayed badge become false.
An existing subscription whose actual end has not been confirmed blocks a
second monthly checkout even after paid coverage expires. This directs failed
renewals and delayed notifications to the portal instead of a duplicate plan.

`POST /premium/checkout` accepts only `{productId}` and returns
`{ok:true,productId,url}`. It inserts or reuses an unpredictable 256-bit reference
bound permanently to the authenticated player and product. The reference is
passed as `client_reference_id` to the exact permitted Payment Link. It is not a
bearer credential and contains no player name or token. References are retained
indefinitely so an older link does not produce an unassignable payment merely
because a local reference expired. Completed payments use unique Stripe IDs.

Checkout errors include `PREMIUM_NOT_READY` (503), `ALREADY_OWNED` (409),
`SUBSCRIPTION_EXISTS` (409), and `INVALID_PRODUCT` (400). A successful redirect,
email address, screenshot, imported save or query parameter alone never proves
payment. The issue endpoint is rate-limited to 20 calls per player per minute.

**Payment Link limitation:** an already-issued hosted URL is reusable outside
the game. Rejecting a second issuance prevents accidental repeat purchases in
the UI, but cannot revoke a browser's existing link or prevent every additional
Stripe subscription. Reconciliation/support must handle duplicate paid orders;
strict one-checkout enforcement would require server-created Checkout Sessions
or an equivalent provider-side restriction. No duplicate grant creates game
assets or transfers ownership between players.

`PUT /premium/appearance` accepts only `{slot,productId}`. Valid pairings are
`nameplate` / `gold-banner`, `town` / `moonlit-castle`, and `badge` / `supporter`.
`productId:null` removes that slot. The SQL statement verifies the current
server-derived ownership and account epoch at commit time. Missing ownership is
`PREMIUM_NOT_OWNED` (403). The response is the same snapshot as `GET /premium`.
Selections are not stored in the importable save, and a revoked or expired
selection is suppressed when read. `appearance.ownedProducts` is a duplicate-free
array of currently valid purchases in the fixed order `gold-banner`,
`moonlit-castle`, `supporter`. It is independent of equipment selection: an
unequipped purchase remains visible, including before a selection row exists.
An account without current rights has `[]`. Holds, confirmed refunds, bans and
exact monthly expiry suppress the corresponding marks. A ban suppresses all
marks; after an unban only the rights still valid at read time return. Site
privileges never grant these purchase marks. This change needs no migration.

Public identity DTOs receive only presentation data; no customer, invoice,
charge, subscription, order reference, price, email or other private billing
details are exposed. The current-value fields are:

| Identity location | Appearance field |
| --- | --- |
| Profile, search/online list, friends, guild members, map players, trade sender/recipient, letter peer/sender/context player, mail participants | `appearance` |
| Chat message and guild asset ledger row | `appearance` |
| Authorized shared construction `startedBy` | `appearance` |
| Guild list or ranking owner | `ownerAppearance` |
| Letter message or thread `lastMessage` | `authorAppearance` |
| Field relationship target | `targetAppearance` |
| Battle result, replay or history participant | `attackerAppearance`, `defenderAppearance` |
| Achievement event player | `playerAppearance` |
| Chat/letter `playerEvaluations` update entry | `appearance` |

Read-time projection updates historical names without rewriting stored posts,
battle/financial receipts or saves. An empty chat/letter message delta still
returns the current appearance for its authorized recent participants in
`playerEvaluations`; clients merge that value into cached names. Normal private
room and letter authorization remains in force.

### Public identity and private site permissions (3.15.0)

General player DTOs, including chat, field and guild displays, omit site role
fields (`isAdmin`, `isStaff` and site role labels). Public `clan` display maps the
reserved variant `德川家` to `徳川家`. Historical `staff-building` achievement
events are projected as ordinary `building` notices with neutral text. Public
field rules omit `operatorProtected` and `staffProtected`; combat target IDs,
actual combat modes, protection/capture rules and rewards remain available.
User-authored names, message bodies and arbitrary text are not rewritten.

The authenticated account's own top-level `user` retains its private permissions
on `/me`, `/sync`, profile updates, presence, session creation and device linking
or recovery. Already-authorized `/admin/*` and `/staff/*` management routes retain
the roles needed for management. Authorization, private saves, entitlements,
shared-base progression and database role records are unchanged. Public absence
of a role field is not an authorization signal. No endpoint grants management
access based on a client-supplied role or appearance.

### Notification validation and fulfillment

`POST /premium/stripe/webhook` is handled before game authentication. It accepts
JSON with a stream-enforced 512 KiB bound and verifies Stripe's HMAC-SHA256 over
the **exact raw bytes**, using the `Stripe-Signature` header and a five-minute
timestamp tolerance. It accepts live snapshots only, from the fixed API version
and the direct account endpoint; connected-account events are not fulfilled.
Invalid signatures return `STRIPE_SIGNATURE_INVALID` (400). Missing signing
configuration returns 503. No key, bearer token or complete payment payload is
logged or persisted.

Successfully verified notifications return
`{ok:true,received:true,duplicate,disposition}`. Supported, valid facts are
`accepted`; unrelated types are `ignored`; incomplete or mismatched data is
`quarantined`. The event ID, type, object ID, body hash, reason and server receipt
time are stored. Invalid financial snapshots can create a fail-closed hold on
the known object. Event receipt and all corresponding facts/holds are committed
in one D1 batch with an event-specific nonce. Duplicate IDs cannot apply twice;
the same ID with different content is `STRIPE_EVENT_CONFLICT` (409).

- One-time ownership requires a paid, completed Session tied to an issued
  reference, the exact allowed Payment Link/mode/currency/total, and a matching
  paid, captured Charge. Expanded Session line items, when present, must also
  match the allowed price and quantity. The normal unexpanded snapshot is
  checked through its exact Payment Link and total. An unpaid completion alone
  does not grant; a later valid async success can advance the same Session.
- Monthly ownership requires that subscription's Session/customer association,
  a paid invoice with the allowed Price/Product and one complete non-proration
  subscription line, an `invoice_payment.paid` allocation of the exact amount
  to a PaymentIntent, and its paid captured Charge. An invoice marked paid
  outside Stripe, or an invoice lacking its actual payment allocation, is
  insufficient. Both `quantity` and `quantity_decimal` are checked. The service
  period comes from the line, not the invoice's general accounting window.
- Monthly coverage starts and ends at that paid service period, using real
  server time. A reversible period-end cancellation request does not shorten
  coverage. Actual subscription termination caps it. A late earlier snapshot
  cannot reverse a confirmed end. Failed-payment events record status only and
  do not extend coverage.
- Refunds, disputes and fraud warnings can arrive before their payment facts.
  Holds are retained and joined after correlations become known, preventing a
  delayed success from restoring blocked ownership. Successful refunds,
  `charge.refunded`, lost disputes and conflicting or unverifiable financial
  facts cannot be cleared through the operator review API. Pending/failed/
  canceled refund notifications and unresolved or won disputes/fraud warnings
  remain conservative review holds; their later status does not automatically
  restore access.

No event timestamp is used as a universal ordering version. Facts, unique
resource IDs, real service periods and irreversible holds/end times determine
the result. A missing required snapshot leaves the purchase unfulfilled until
the corresponding verified event arrives. Operators must monitor quarantined
events and reconcile incomplete deliveries; this keyless Worker cannot fetch
missing Stripe objects by itself.

### Operator review of soft holds

Only the current `settings.adminUserId` identity may use these routes. Staff and
ordinary players are denied. Access generation and the current operator role
are checked in the committing SQL. This operation is for a human who has
verified the actual Stripe payment, refund/dispute and risk state; it does not
replace that investigation or create payment facts.

`GET /admin/premium/reviews?limit=20&cursor=…` returns active holds:

```js
{ok:true,holds:[{
  scope:"charge",objectId:"ch_…",revision:1,eventId:"evt_…",
  reason:"fraud_review",createdAt:"…",updatedAt:"…",canRelease:true,
  players:[{id:"u_…",name:"領主名",avatarVersion:null,evaluation}]
}],nextCursor:null,serverNow:"…"}
```

The players attached to each hold carry current `evaluation`, `avatarVersion` and safe `appearance` projections. Reading their rank or icon does not change a hold or entitlement.

The maximum page size is 50. `POST /admin/premium/reviews` accepts
`{scope,objectId,expectedRevision,expectedEventId,reason,requestId}`. `reason` is
the operator's Stripe verification explanation (8–500 characters); it must not
contain payment-card data, secrets or authentication tokens. Only `refund_review`,
`dispute_review` and `fraud_review` can be released. All other reasons return
`PREMIUM_REVIEW_FORBIDDEN` (403). Changed holds return `PREMIUM_REVIEW_CHANGED`
(409). The response is `{ok:true,review:{id,scope,objectId,revision,eventId,reason,
createdAt},idempotent}`.

The operator audit receipt and the release of exactly the observed hold
revision commit atomically. Every new risk event advances the hold revision and
re-blocks it. An older page or replayed review request cannot clear that new
event. A hard reason is never weakened by a later soft notification. Where both
Charge and PaymentIntent holds exist, each must be reviewed before derived
ownership returns. The underlying signed paid facts remain mandatory after
release; a review cannot grant an unpaid item, revive a refunded purchase, alter
a service period, or confer operator/staff privileges.

The independent `scripts/test-premium.mjs` suite uses only local signed fixtures,
blocks external fetches, and checks ownership binding, raw signatures, strict
product/quantity checks, event ordering, replay, rollback, paid periods,
subscription duplication guards, risk review, cross-surface ownership marks, public privacy, bans and save
independence. `scripts/test-public-identity.mjs` verifies role-free general DTOs,
neutral historical notices and unchanged self/management authorization. It does not make real payments or modify production customers.

## Timed battle events

The `timedEvents:true` health feature exposes a separate event system. The current primary operator selects a battle from the catalogue and a duration of 1–7 days, reviews the generated draft, and explicitly publishes it. Staff membership does not grant event administration. The planner is the built-in, bounded `game-ai-v1` game AI: it selects and evaluates fixed battle templates and tactics. It does not contact an external language model, interpret executable prompts, or accept client-supplied enemy strengths, scores, reward bundles or plans.

### Routes and visibility

All routes are under `/api/v1`. Event list/detail GETs accept optional authentication. Other routes require authentication, and `/admin/events` routes additionally require the current primary operator.

| Method/path | Body | Success response |
| --- | --- | --- |
| GET `/events` | — | `{ok,serverNow,events:[event]}` |
| GET `/events/catalog` | — | `{ok,version,battles:[{id,name,category,themeId,unificationEligible,description}]}` |
| GET `/events/:eventId` | — | `{ok,serverNow,event,progress,leaderboard}` |
| GET `/admin/events` | — | `{ok,serverNow,events:[event]}` |
| POST `/admin/events/generate` | `{battleId,durationDays,requestId}` | `{ok,serverNow,event,idempotent}` |
| POST `/admin/events/:eventId/publish` | `{requestId}` | `{ok,serverNow,event,idempotent}` |
| POST `/admin/events/:eventId/end` | `{requestId}` | `{ok,serverNow,event,idempotent}` |
| POST `/admin/events/:eventId/discard` | `{requestId}` | `{ok,serverNow,event,idempotent}` |
| POST `/events/:eventId/battle` | `{stageId,tactic,requestId,deviceId,expectedRevision}` | Full sync snapshot plus `{serverNow,event,progress,battle,rewardMailIds,idempotent}` |

`eventId` is `ev_` followed by 32 lowercase hexadecimal characters. New drafts require a catalogue `battleId`. The former `{name,durationDays,requestId}` body can replay a corresponding older receipt. `durationDays` must be an integer, not a numeric string. Extra body fields are rejected. An operator may retain up to 30 unpublished drafts; `discard` frees a slot and can only act on an unpublished draft. Draft generation is limited to 20 requests per minute per operator, management mutations to 30 per minute, and new battle requests to 30 per minute per identity. Successful replays bypass these new-operation budgets.

Public lists contain at most 20 published events with the currently active event first. Drafts and discarded plans return `EVENT_NOT_FOUND` (404) through public details, including when the viewer is the operator. The operator list contains at most 50 rows, prioritizes active events and drafts, and omits discarded plans. A stored discard receipt remains replayable and returns the current discarded DTO. A second publish request cannot restart or modify a published plan.

```js
event = {
  id:"ev_…", name:"桶狭間の戦い", durationDays:2,
  status:"draft" | "active" | "ended" | "discarded",
  startsAt:null | "ISO-8601", endsAt:null | "ISO-8601",
  endedAt:null | "ISO-8601", createdAt:"ISO-8601",
  plan:{
    schemaVersion:1, generator:"game-ai-v1", name:"桶狭間の戦い", durationDays:2,
    theme:{id,label,description}, synopsis, rules:[string], commandCost:1,
    tactics:[{id,name,description}],
    stages:[{id,name,description,enemyName,enemyPower,basePoints,
      recommendedTactic,tacticHint,tacticMultipliers}],
    milestones:[{id,title,points,gift:{gold,rice,wood,stone,magatama}}]
  }
}
```

Every plan has three immediately selectable stages (`stage-1` through `stage-3`), five allowed tactics (`balanced`, `charge`, `raid`, `siege`, `defend`), and three milestone rewards (`milestone-1` through `milestone-3`). Names, descriptions and battle logs are ordinary text and must be escaped when rendered. Publication fixes the stage templates, fallback enemies, tactic modifiers and rewards. Existing Ver.3.17.0 plans with `dailyAttempts:3` are normalized at the response/battle boundary to `commandCost:1`, with only the old participation rule replaced. Their stored plan, enemies, reward thresholds and gift amounts are not regenerated or rewritten. The seed and creator identity are private; event DTOs do not disclose operator/staff identities, roles, generation internals or request hashes.

Public event details and event management action responses resolve the selected battle's castle and return `event.opponent`, either `null` or `{castleId,castleName,lordName,defenseTroops,defensePower}`. Event lists carry the stored plan only. Each castle scenario and the historical scenarios mapped to a specific castle use that castle's current defender. Older plans without a catalogue ID use the title only when it identifies one mapped castle unambiguously. Ordinary castles use their current resident lord. Edo uses its designated defender, and Nijo, Osaka, Nagoya and Kyoto Gosho require a single eligible defender. An empty castle, an ambiguous defender, a field battle without a mapped castle, or a roaming encounter uses the plan's stage-specific enemy.

When an opponent is present, all three stages use its field `defensePower` as the enemy strength, including eligible alliance troops already stationed at that castle. Adviser predictions and battle resolution compare that strength with the participant's saved field attack power adjusted by the chosen stage's tactic multiplier. The server resolves the garrison again for a new sortie and checks it at commit. The battle response records the opponent at that sortie in `battle.opponent`, while `event.opponent` reports the current preview. A replay preserves the original battle, including its recorded strength and opponent. Earlier receipts may omit `battle.opponent`. Event combat leaves the defender's troops, resources and castle ownership intact.

### Personalized defense adviser

Active-event details and battle responses may include `progress.defenseAdviser` for the authenticated current sole lord of the target castle. Ownership is matched by user ID, never by display name. Visitors, other players, retainers, ambiguous defenders, ended events, and plans without an occupied target receive no private advice. Public event and leaderboard DTOs never contain this profile.

```js
defenseAdviser = null | {
  castleId, castleName, defenseTroops, defensePower, reinforcementTroops,
  headline, summary,
  measures:[{id,priority,title,detail}],
  stages:[{stageId,stageName,attackTactic,attackTacticName,defensePlan,reason}]
}
```

`priority` is 1–3, with 1 first. The bounded game adviser uses the same current field-defense projection as event combat: the castle's garrison and home/mobile troop contribution, castle and wall levels, completed discipline research, equipped army ranks, and eligible stationed alliance aid. It proposes six concrete preparation measures and a counterplan for each stage's most favorable attacking tactic. Attacker armies and choices are unknown, so it supplies no fabricated attacker strength or defense win percentage. These are read-only suggestions; they do not move troops, spend resources, change formations, or grant a defense bonus.

Before sending personalized advice, the response rechecks the observed defender ownership, save and role, event, common clock, shared development and aid conditions. If the observations changed, it clears only `progress.defenseAdviser` to `null`. A committed battle still returns its successful receipt and current synchronization snapshot; a later retry cannot spend a second command. Clients also clear the panel after identity changes or a null/mismatched adviser projection.

### Clock, progress and battle results

Publishing starts the event at the server's real UTC epoch time. Its scheduled end is exactly `durationDays * 86,400,000` milliseconds later. The virtual world clock, pause, speed settings and world cycles do not affect event duration. Only one non-ended, unexpired event may be active, enforced in the publishing transaction. Expiry is derived on reads and writes, so an event ends on time without a scheduled job or an open browser. The operator may end it early; scheduled `endsAt` remains unchanged and `endedAt` records the early stop. An event which expires naturally reports `endedAt` equal to `endsAt`.

Every new sortie spends exactly one of the normal campaign commands, including a defeat. There is no daily event quota or separate event recovery timer. Normal commands recover once per 20 seconds of game time, up to `GameEngine.commandMax()` (`3 + floor(keepLevel / 8)`, maximum 7); world speed affects that normal recovery and pausing stops recovery. Remaining commands can still be spent while the world clock is paused. The existing `realtime.commandProgress` is preserved when spending a command.

Anonymous details return `progress:null`; signed-in players receive zero-valued progress before their first battle. `progress.command` reports the saved command count and normal capacity, or `null` when no usable campaign save exists. Staff capacity uses the shared keep level while commands remain personal. Clients should display the current game engine's live command state when available, using this saved projection only as a fallback. The former `attemptsToday`, `attemptsLeft`, `dayIndex` and `nextResetAt` progress fields are removed.

```js
progress = {
  points:0, wins:0, battles:0,
  command:null | {available:3,max:3,cost:1},
  defenseAdviser:null, // personalized object above, when available
  rewards:[{milestoneId:"milestone-1",mailId:"m_ev_…",awardedAt:"ISO-8601"}]
}
battle = {
  id:"eb_…", requestId:"client-operation-id", createdAt:"ISO-8601",
  commandCost:1, commandBefore:3, commandAfter:2, playerRevision:42,
  won:true, points:120, stageId:"stage-3", stageName, tactic, tacticName,
  enemyName, playerPower, enemyPower, winChance:52, summary, log:[string]
}
```

`winChance` is an integer percentage. `commandBefore`, `commandAfter` and `playerRevision` describe the original committed battle; the top-level sync snapshot always reports current state. The server reads the synchronized saved army and morale and computes `GameEngine.armyStats()` using the shared officer runtime. A missing save returns `SAVE_REQUIRED` (409); a game-over campaign returns `BASE_UNAVAILABLE` (409); zero commands return `INSUFFICIENT_COMMAND` (409). The client cannot supply army abilities, remaining commands, a command cost or a random roll. The server generates the roll and saves the complete outcome in the operation receipt. Losing still earns the plan's small defeat award. All stages are available from the first sortie.

Event battles use the existing current-writer save workflow. `deviceId` and a nonnegative integer `expectedRevision` are required. `settleWriterCycle` validates ownership/revision and handles the normal role/cycle synchronization boundary. The saved common-clock anchor must be present and no more than 15 seconds behind the current common clock. At commit, the same transaction rechecks the writer lease, expected save revision, command availability, world-clock revision and live account/role access. On success it decrements `state.command`, increments the save revision and renews the same writer's lease. Event combat does not consume food or troops, capture castles or alter main campaign statistics. It never takes a lease from another device.

The response includes the standard top-level `user`, `save`, `revision`, `updatedAt`, `clock`, `staffBase`, `writerDeviceId`, `writerDeviceName`, `leaseExpiresAt`, `serverTime`, `writable` and `entitlements` fields. These self-only sync fields follow the existing identity privacy rules; general event/leaderboard DTOs remain role-free. The client must use the shared authoritative-operation gate: bring the game to the common clock, flush local changes, prevent competing local actions, POST the current writer/revision, then adopt or refresh the authoritative snapshot through at least the returned revision before permitting another mutation. A save based on the pre-battle revision is rejected, so an old local command count cannot overwrite the consumed command. Do not locally decrement a second time.

The leaderboard contains at most 20 players, ordered by points descending, wins descending, update time and stable identity. Entries are `{rank,playerId,name,points,wins,battles,evaluation,avatarVersion,appearance?}`. Active BANs are excluded. Current names, rank evaluations, photos and safe premium appearances are resolved by the existing common response projection; no operator or staff permissions are exposed.

### Atomic rewards and retry behavior

Migration `0014_timed_events` adds `timed_events`, `timed_event_requests`, `timed_event_participants` and `timed_event_rewards`; the command change needs no additional migration. Event points, cumulative battle counts and rewards remain in these tables. A shared `(actor_id,request_id)` ledger covers generation, publishing, ending, discarding and battles. The request hash includes the canonical action, event and stage/tactic choices, but deliberately excludes `deviceId` and `expectedRevision`. Reusing a request ID for different choices returns `REQUEST_ID_REUSED` (409). A valid retry returns the original battle and reward mail IDs with `idempotent:true`, plus the latest sync snapshot and current event/progress, even when commands are now zero, another device owns the lease or the event has ended. It never returns an old saved command count as the current state. Ver.3.17.0 receipts also remain replayable and do not acquire a retroactive command debit. The same request ID must be retained after an unknown network outcome.

For battles, one atomic D1 batch checks the active event and current command/save ownership; inserts a private commit receipt; writes the command debit and new save revision; adds points/wins/battles; and creates any newly earned reward mail. Every write is gated by the newly inserted commit nonce. Competing requests or an ordinary auto-save based on the same revision cannot both commit. Each `(event,player,milestone)` still has at most one award. A failing mail or award insert rolls back the whole battle, including the command debit and save revision. A lost response can be retried without rerolling, spending another command or issuing duplicate rewards.

Milestone gifts are delivered through the existing personal system inbox as `source:"system"` and `event:{kind:"timed-event",eventId,milestoneId}`. They use the reserved server-only `system:event:<eventId>:<milestoneId>` request namespace. The internal sender is the participating identity, which is not exposed as a human author or given mail-sending permissions. Battle responses list only the mail IDs first awarded by that battle. Event gifts remain receivable through ordinary `/mail/claim` after the event ends; the existing pending claim and save-backed `giftReceipts` rules still apply. This feature guarantees durable single issuance of the reward mail, and does not change the existing client-side gift application contract.

Other relevant conflicts are `EVENT_ALREADY_ACTIVE`, `EVENT_ALREADY_PUBLISHED`, `EVENT_DRAFT_LIMIT`, `EVENT_CHANGED`, `EVENT_ENDED` and `EVENT_STATE_CHANGED` (409). Existing `LEASE_REQUIRED`, `REVISION_CONFLICT`, `CLOCK_ANCHOR_REQUIRED`, `CLOCK_STALE`, `WORLD_CLOCK_CHANGED`, `CYCLE_SETTLEMENT_REQUIRED`, `ACCOUNT_ACCESS_CHANGED` (409), `ADMIN_REQUIRED` (403) and `ACCOUNT_BANNED` (403) apply. Rejected event transactions spend no command and create no battle, score, award or mail; normal prerequisite cycle/role synchronization may independently complete before the caller retries with the new revision.

`server/test-event-planner.mjs` checks bounded deterministic plans, legacy rule normalization and combat resolution without network calls. `server/test-events.mjs` exercises real Worker routes on local SQLite: authority, draft privacy and discard, single-active publication races, ordinary command spending/recovery, fourth and later sorties, stale-save and auto-save races, partial recovery progress, shared staff capacity, legacy plans, event-duration independence, reward delivery, replay, lost responses, command/revision rollback, expiry/end races, writer/clock/role/BAN guards, current avatars/ranks and leaderboard exclusions. These tests create no production events or accounts.

## Local verification (existing systems)

Run the `scripts/test-*.mjs` suites (excluding the `test-support.mjs` harness) using Node 24 or a Node version providing `node:sqlite`. In addition to social/sync/field/guild/avatar/staff/cycle coverage, `test-walking.mjs` verifies cumulative grants, real-time envelopes, delayed network delivery, simultaneous reports, response loss, reloads, account/campaign isolation, import handling and atomic rollback. `test-letters.mjs` verifies private/guild correspondence permissions, current membership, retry receipts and message/read cursors. `test-trade.mjs` exercises escrowed bundles, free exports, actor-only save updates, pending refunds/proceeds, authorization, limits, replay, races and rollback. `test-moderation.mjs` verifies sole-operator authorization, author-only text removal, bans and unbans using existing tokens, private access generations, in-flight operation races, atomic rollback, content-cache invalidation and trade refunds without touching production players. `test-construction-queues.mjs` verifies shared reservations, per-stage charging, conflicting requests, lost responses, caps, stage deadlines and personal staff-transition progress. Run the syntax checks for all Worker modules and the built Worker. Frontend `tests/test-walking-engine.cjs` verifies durable local grants and save migration separately from browser motion/controller tests; `tests/test-construction-queue-engine.cjs` verifies head-only progress and save/reload timing; `tests/test-strategy-engine.cjs` and the independent `tests/test-strategy-contract.cjs` cover parsing, exclusions, resources, decision replay, scope changes and stop conditions.

The avatar parser fixtures include baseline/progressive RGB/grayscale, restart markers and the actual Chrome canvas output; API tests use an isolated R2 map to cover cleanup races and uncertain DB responses. Recent-connection tests verify current-role SQL guards and rolling-window privacy. Clan tests verify reserved/ordinary character variants and deterministic migration. Guild suites inject mid-transaction SQL failures and post-commit response loss, concurrent duplicate/competing transfers, competing users' withdrawals, stale writers/revisions, membership/role revocation, promoted targets, protected private chat/history, preserved final funds and safe public ranking aggregation. All tests use local fixtures and do not modify production accounts, roles, saves, photos or messages.

The suites create an in-memory SQLite database, apply every journaled migration in order, generate a random test-only admin key in memory, and exercise the actual Worker. The D1 adapter runs each batch as an ordered SQLite transaction, matching D1's batch atomicity contract. Promise-based concurrent calls check revision conflicts, single-use pairing redemption, the single-operator claim, clock controls, repeated field requests, competing raids and consent-versus-attack races. The field suite injects a failing statement into an attack batch and verifies that both saves, the battle and the request record roll back, followed by a safe retry. The staff suite checks role separation, paired-device removal, appointment replay after dismissal, concurrent role operations and revocation between authentication and private chat SQL; it also tests transaction rollback and the primary-operator guard at commit time. A controlled server clock verifies disconnected elapsed time, equal time for different identities, pause/resume, speed changes, cooldown/alliance expiry and calendar wrap without resetting absolute time. The tests do not simulate network latency, a browser's lifecycle or the production deployment; those are separate integration checks. They do not contact a deployed service or send production messages.


## CPU roaming battles (3.18.0)

Authenticated `POST /roaming/battle` accepts `{encounterId,tactic,troops,requestId,campaignId,sequence,deviceId,expectedRevision,unitId,castleId,deploymentRevision}`. New battles require a current map unit. Historical pre-map requests without the final three fields can only replay an existing matching receipt; they cannot start a new template-only battle. No other fields are accepted. `campaignId` is the current `state.walking.campaignId`; `sequence` is `state.roaming.sequence`. Troops are safe integers from300 through the smaller of actual current troops, calculated troop capacity and1,000,000. At least one army officer, sufficient rice and one command are required. Paused common time stops command recovery but still permits spending already available commands.

The response includes the full authoritative sync snapshot plus `{battle,idempotent}`. The battle contains its matching request/campaign/sequence and encounter/tactic, deployed/lost/surviving troops, enemy losses, attack/enemy power, food/command costs, actual capped reward increments, prestige gain and game turn. The common engine computes six CPU archetypes with four tactics, using the exact enemy troop count in the server-owned deployment; castles, garrisons, conquest quest counters and automatic campaign counters do not change.

`0015_roaming_battles` stores one immutable receipt per actor/request and per actor/campaign/sequence. Receipt creation and personal save revision increment are conditional parts of one batch. Account access, writer lease, save revision, common clock revision, role term, shared-base revision, deployment revision and target availability must still match at commit. Retry returns the prior receipt with current sync data and never reapplies costs or rewards. `GET /roaming/history` returns the authenticated player's latest20 durable reports; it cannot select another player. Local-only play uses the identical engine and rolls the full mutation back when local saving fails.

For soldier trades, positive `troops` values participate in the existing escrow/proceeds/refund transaction. They debit or credit `state.troops`, never a castle garrison. Troops0 are omitted from canonical vectors and request hashes for historical retry compatibility. Net incoming troops must fit the authoritative dynamic capacity and1,000,000 hard limit. Already-over-capacity exports and trades with no net troop increase remain permitted. Unreceivable imports/refunds remain wholly pending; no soldier is silently discarded.

## Private dispatch forces (3.19.0)

All `/covert` endpoints require the current player's bearer token. There is no player selector for reading another player's force ledger, reports or incidents.

| Method / path | Additional body or query | Behavior |
|---|---|---|
| GET `/covert` | Optional `deviceId`, `cursor`, `limit` (client uses 100) | Own sync snapshot and `covert:{version,campaignId,sequence,rules,sources,targets,stations,reports,incidents,history,targetCursor,playerTargetTotal,online}`. Returns all 129 campaign castles plus one page of current field targets. Follow `targetCursor` to complete the player list. |
| POST `/covert/hire` | `sourceCastleId,count` | Pay the displayed gold/rice and one command; add units to the source reserve. |
| POST `/covert/dispatch` | `sourceCastleId,count,mode,target` | `mode` is `scout` or `station`. Pay rice and one command; privately report the destination's game state. Scouts return to reserve; station units remain deployed. |
| POST `/covert/recall` | `stationId` | Return surviving units to reserve without resource or command cost, including after the source is lost. |
| POST `/covert/retaliate` | `stationId,incidentId` | Spend one eligible, unconsumed source-attack incident, rice and one command. Resolve the stationed force's attack without capture or loot. Survivors remain stationed. |

Every POST also requires `{requestId,deviceId,expectedRevision,campaignId,sequence}`. `campaignId` is the current `state.walking.campaignId`; `sequence` is the canonical dispatch sequence. Reject unknown body fields, non-integer counts and invalid targets. A target is `{kind:"castle",castleId}` or `{kind:"player",castleId,playerId}`. Display labels, target intelligence, incident eligibility and battle results are always server-derived. A successful write returns the current sync snapshot, `covert`, `result`, and `idempotent`.

Source ownership and applicable capabilities are checked against current authenticated roles and the saved campaign. The public player projection does not expose these capabilities. Per-source reserve plus deployed population is limited to one quarter of calculated normal troop capacity, capped at 20,000. Ninja recruitment costs 3 gold and 2 rice per unit; ashigaru costs 1 of each. Scouting rice is `20 + ceil(count * .2)`, stationing `30 + ceil(count * .3)`, retaliation `50 + ceil(count * .4)`. The current rules are included in the private snapshot so clients can show costs before confirmation.

`0016_covert_dispatch` adds canonical `covert_states`, immutable `covert_requests`, `covert_battles`, server-generated `covert_incidents`, and `field_battles.defender_campaign_id`. PUT `/sync` strips the submitted dispatch section before save validation and restores canonical state. GET sync also restores canonical state. Imported or older saves cannot mint dispatch units, revive losses, fabricate reports, or rewind consumed incidents. This authority applies to dispatch state; it does not change the existing trust model for the rest of the campaign economy.

A retaliation incident must belong to the actor's current campaign and source, and occur after that particular station was committed. Field incidents use immutable incoming battle rows with a campaign binding and monotonic row cursor; station commit also compares the current cursor to close the read/commit race. CPU incidents are created only while existing server-side campaign advancement runs and are inserted under that save transaction's gate; the station sequence cutoff excludes later deployments even at the same game timestamp. Client-only CPU claims in sync uploads are ignored. The returned `stationIds` is the eligibility list for each incident. One incident can fund at most one retaliation across all stations and imported saves.

One D1 transaction gates the request receipt, actor save/revision, canonical force state, any defender loss and generic defender mail. It rechecks account access, actor writer lease, revisions, source roles, target roles/ownership, common clock, alliances and attack protection. Protected reward-battle targets retain their assets. Successful spying sends no target notification and performs no target mutation. Intelligence contains only numeric game resources, troop/garrison counts, castle/wall level, defensive power and aggregate army statistics; no credentials, private correspondence or site roles are returned. Retaliation uses generic battle mail and does not publish the actor's unit type or private station list.

Both the UI controller and shared mutation bridge keep the original request ID when a reply is lost. A temporary synchronization preflight, authentication interruption, rate limit or network error must preserve that pending operation for later result confirmation. A definite server semantic rejection may retire its own operation. Replays return the original receipt and fresh current snapshot without applying costs or losses again. Account/campaign/role changes invalidate the displayed context and cannot redirect an old request to a different player.


## National roaming deployments and approval (3.20.0)

`0017_roaming_deployment` adds a singleton deployment revision, immutable proposal payloads, durable management request receipts and per-unit victory cooldowns. Public deployment data contains no manager, staff, proposer or reviewer identities. All manager-only data stays in authenticated `/staff/roaming` and `/admin/roaming/*` responses.

| Method / path | Body or query | Result |
|---|---|---|
| GET `/roaming/deployment` | None; public | `{deployment,castles,serverNow}`. Deployment has `revision,totalTroops,squadSize,respawnSeconds,totalSquads`. Every one of the 129 castle summaries has `castleId,squads,troops`. |
| GET `/roaming/map` | `castleId` required; public | `{deployment,castleId,units,serverNow}`. Each unit has `unitId,encounterId,castleId,troops,slot,deploymentRevision,available,respawnAt`. `respawnAt` is epoch milliseconds or null. |
| GET `/staff/roaming` | Current admin or staff token | Current deployment, `{canApply,canApprove,canPropose}` capabilities and up to100 proposals, pending first. Admin sees all; staff sees only their own. |
| POST `/staff/roaming/proposals` | Staff only; `{requestId,expectedRevision,totalTroops,squadSize,respawnSeconds,note?}` | Save one immutable pending configuration. Does not alter the live deployment. |
| POST `/staff/roaming/proposals/:id/cancel` | Owning staff; `{requestId,expectedRevision}` | Cancel their own pending proposal. |
| POST `/admin/roaming/deployment` | Admin only; same flat configuration fields as proposal | Apply immediately without a staff proposal. |
| POST `/admin/roaming/proposals/:id/approve` | Admin only; `{requestId,expectedRevision}` | Apply exactly the stored proposal; no configuration edits are accepted. |
| POST `/admin/roaming/proposals/:id/reject` | Admin only; `{requestId,expectedRevision}` | Reject the pending proposal without changing deployment. |

Deployment totals are integer soldier counts from0 through20,000,000. Squad size is300–20,000; the last squad may be smaller. `ceil(totalTroops/squadSize)` must not exceed4096. Respawn delay is60–3600 real seconds, independent of the game clock's pause/speed. Defaults are384,000 soldiers in384 squads of1,000, respawning300 seconds after defeat. Squads are assigned round-robin to the129 canonical castle IDs; totals remain exact rather than being multiplied by local difficulty. Enemy power may reflect difficulty, while reported soldier counts remain the configured counts. Small squads have their rewards scaled down against their archetype baseline, so a tiny remainder cannot pay a full elite reward.

A proposal's ID is `rdp_` plus32 lowercase hexadecimal characters. Its DTO includes `id,status,expectedRevision,config,requestedAt,note,requester:{id,name},reviewedAt,appliedRevision,canApprove,canCancel`. Status is `pending`, `approved`, `rejected`, `cancelled` or `superseded`. A changed deployment, dismissal, changed staff appointment term, ban or promotion invalidates an older pending proposal. Approval is a one-plan decision; it does not grant continuing permission for later staff changes. At most10 proposals per staff member and100 across the current revision may be pending. Notes are limited to300 characters.

Every mutation has an immutable actor/request receipt with `{requestId,action,proposalId,appliedRevision}`. Action is `apply`, `propose`, `approve`, `reject` or `cancel`; `proposalId` is null for direct apply and `appliedRevision` is null for non-applying actions. Success returns the current management DTO plus `receipt,proposal,idempotent`. A matching replay returns the original receipt and current state without applying again. Request-ID reuse with different action, proposal, revision, configuration or note returns409. Uncertain outcomes must reuse the same request ID.

Application and approval increase deployment revision once and supersede other pending plans. The immutable proposal data, source revision, staff term, current admin identity and account-access guards are rechecked inside the same D1 batch as the request receipt and configuration changes. Cancel/reject versus approval and simultaneous competing changes have one winner. An expired staff appointment cannot be reauthorized by simply appointing the same account again.

A battle resolves the exact selected unit from the current deployment; submitted enemy troops or rewards are not accepted. The victory receipt, player costs/rewards and the unit's global cooldown commit atomically. A unit already defeated by another player rejects a new battle with409 `ROAMING_UNIT_UNAVAILABLE`; concurrent wins cannot both receive rewards. A defeat does not remove the unit. A replacement deployment invalidates previous unit identities; old battle receipts still replay safely. `battle` and saved history include `unitId,castleId,deploymentRevision,respawnAt` for map battles.

Errors include400 `ROAMING_MAP_REQUIRED` for new template-only battles,400 `INVALID_DEPLOYMENT`,409 `ROAMING_DEPLOYMENT_CHANGED`,409 `ROAMING_PROPOSAL_CHANGED`,409 `ROAMING_PROPOSAL_LIMIT`,409 `ROAMING_UNIT_CHANGED` and409 `ROAMING_UNIT_UNAVAILABLE`. Permission, identity and ban changes are checked again before returning private management data.

`node server/test-roaming-deployment.mjs` uses the real Worker and in-memory SQLite to verify public privacy, exact counts, immutable approval, cancellation/rejection, current-role/ban checks, concurrent winners, stale deployment/proposals, rollback, lost-response replay, zero deployment, canonical unit validation, shared cooldown and legacy receipt compatibility. No production accounts, configuration or battles are changed by these tests.


## Kyoto Gosho court (v3.22)

All paths are below `/api/v1`, require an authenticated, non-banned account, and return the current global `contentRevision`. An ordinary player's **current** evaluation must reach `court-7` / 従五位 / 35,000 points. Current staff and the operator are admitted by their current server role. Evaluation and authority are rechecked against the same account/save/role generation before private results or writes are committed. A stale tab or imported role flag cannot retain access after demotion, BAN, a staff-term change or evaluation loss.

| Method and path | Body or visibility | Result |
|---|---|---|
| GET `/court` | Any authenticated player may check qualification | `eligible,requirement,evaluation,accessStamp,self,palace,features,thresholds,contentRevision` |
| GET `/court/chat` | Admitted players | Current public court conversation |
| POST `/court/chat` | `{requestId,text}`; text ≤300 characters | Committed message and idempotent replay |
| GET `/court/audiences` | Requester's own threads; current staff/operator can respond | Visible audience threads |
| POST `/court/audiences` | `{requestId,title,text}`; title ≤80, text ≤1,000 | New private audience thread |
| GET `/court/audiences/:id` | Requester or current court responder | Authorized thread and replies |
| POST `/court/audiences/:id/replies` | `{requestId,text}`; text ≤1,000 | Reply within the authorized thread |
| GET `/staff/court` | Current staff/operator only | Actual private roster, titles, contribution and leader |
| POST `/admin/court/leader` | Operator only; `{requestId,targetPlayerId}`; null clears appointment | Current leader appointment |

`self` carries the requesting player's own `title,merit,canRespond,canAppoint,isCourtEmperor`. Public staff/operator conversation authors are represented by the alias **朝廷**, without a public management roster or actual administrative account IDs. Only authorized private management views expose the current staff roster. Court messages do not grant currency, evaluation or contribution.

A completed shared construction contributes its `targetLevel` once to its initiator. The unique completed job ID and staff term tie the ledger to real shared progress; verified historical completed jobs are backfilled once. Offices are 参議 at 0, 中納言 at 50, 大納言 at 200, 内大臣 at 500, 右大臣 at 1,000, and 左大臣 at 2,000 contribution points. The operator's 太政大臣 is fixed. An operator-appointed active staff leader becomes 天皇; the appointment token and staff term are checked again at combat commit. Dismissal or BAN invalidates the appointment, and reappointment as staff does not revive an old emperor appointment.

**Kyoto Gosho → Edo attacks require the currently appointed 天皇**, including attacks against an Edo branch and covert retaliation. The same gate is checked after all asynchronous reads and within the combat transaction. It does not affect ordinary attacks originating from another home. Kyoto Gosho remains an attackable, uncapturable reward base with castle level 128 and facility level 32.

Court writes use immutable per-player request IDs and a per-attempt commit nonce in the same D1 transaction as their data write. Same-intent retries return the committed result without duplicate messages or appointments. Existing moderation removes the targeted author's court text, scrubs their audience titles, preserves other participants' replies and durable request receipts, and increments the global content revision. Clients clear cached private views immediately on access loss and must not restore late responses from an earlier access stamp or content revision.

## Metropolitan branches and mandatory siege order (v3.22)

| Parent city | Maximum branches | Maximum branch level |
|---|---:|---:|
| `edo` | 4 | 8 |
| `nijo`, `osaka`, `nagoya` | 2 each | 24 |
| `kyoto_gosho` and ordinary castles | 0 | — |

A branch is attached to its owned parent city and uses one unique `north`, `east`, `south` or `west` placement. Edo permits one in each of the four directions, and the total record limit across all eligible cities is ten. It is not an additional castle, territory, roaming deployment site or cycle reward. The personal state shape is `{id:"edo_north",parentCastleId:"edo",direction:"north",level:0,fallen:false}`. Level 0 reserves the location during first construction. Jobs use `kind:"branch"` and ordinary resource/command/construction-slot rules. Repair uses `repair:true`, retains the completed level and restores defense only at completion.

| Method and path | Input | Result |
|---|---|---|
| GET `/branches` | Optional `deviceId` | Current full sync snapshot plus `campaignId,sequence,branchResolvedElapsedMs,branchState,parents` |
| POST `/branches/build` | Common fields plus `parentCastleId,direction` | Full snapshot, authoritative branch state, result and `idempotent` |
| POST `/branches/upgrade` | Common fields plus `branchId` | Same response shape |
| POST `/branches/repair` | Common fields plus `branchId` | Same response shape |
| POST `/branches/build-facility` | Common fields plus `branchId,facilityId` | Same response shape; creates facility Lv.1 after its paid job completes |
| POST `/branches/upgrade-facility` | Common fields plus `branchId,facilityId` | Same response shape; reserves the next facility level after its build or prior upgrades |

Common fields are `{requestId,deviceId,expectedRevision,campaignId,sequence}`. Preserve the original campaign, sequence, action and target across an uncertain-response retry. The current writer device and personal revision may refresh after syncing. Use a distinct request ID for each new order. An exact retry returns its original receipt without a second charge. A reused request ID with a different semantic intent is rejected. Successful construction debits resources and one command at acceptance, writes the player save, the branch ledger and the receipt in one transaction. The commit gate compares the current role/access epoch, running world-clock revision, personal save revision, writer lease, campaign and authoritative branch sequence. Staff operations also compare the shared-base revision and retain personal construction progress.

Each Edo branch has six fixed facility slots; each Nijo, Osaka and Nagoya branch has twelve. `branchRules.parents[].facilitySlots` and `SENGOKU_DATA.branchFacilities` define the shared catalogue. All six core types are `farm,market,lumber,quarry,barracks,watchtower`. The other major cities additionally accept `granary,trade_port,sawmill,stoneworks,drill_ground,moat`. Unknown types and types outside a parent's catalogue fail. A completed facility cannot exceed its branch’s completed level. For a new reservation, the limit is the branch level projected after all earlier orders, bounded by the caps of 8 for Edo and 24 for the other eligible cities. Old branches without `facilities` have no built facilities; no levels or assets are automatically granted. Persisted `facilities` is an object from allowed IDs to integer levels. A missing key means zero.

Each branch owns one FIFO queue for branch construction, branch upgrades and all of its facilities. One nonempty branch queue occupies one ordinary construction slot. Additional orders on that queue consume resources and one command each, and other branch queues can progress concurrently within the available slots. The head advances first. A first-time branch build reserves its site at level 0 and permits later upgrades and facility orders that its scheduled levels support. Use the facility build route for level 1 and the upgrade route for each subsequent level, including when the first build is still pending.

Facility jobs use `kind:"branch",id:branchId,facilityId`. For a facility order, `L` is the level reached after its earlier reservations. Each resource charge is the catalogue base cost multiplied by `1 + 0.35L + 0.02L²` and rounded to an integer. Rice cost is zero. The duration is 60 seconds for `L<8`, 120 seconds for `8≤L<16` and 180 seconds thereafter. The personal save must own the eligible parent. A fallen branch accepts only one repair, and further construction orders can be placed once that repair completes. Paused clocks, stale writers, revisions, campaigns, sequences and commit-time role changes retain their existing guards.

For successful construction and upgrade orders, `result.branchId` and optional `result.facilityId` identify the target. `targetLevel` is the level after the order completes. `queuePosition` counts from 1, `queued` distinguishes a waiting order from the head, and `startsInSeconds` is the simulated wait at acceptance. The immutable receipt table keeps the existing `build/upgrade/repair` categories. Facility requests bind the exact route and facility ID to the request hash. The full snapshot exposes all active and waiting orders in `branchState.jobs`. Filter by branch ID to obtain their execution order. Each order has its own immutable absolute `completesElapsedMs` on the shared world clock. Appending an order preserves earlier deadlines.

The engine’s `branchFacilityStatus(branchId)` exposes completed `maxLevel` and projected `queuedLevel` for the branch, plus its first `job` and all `jobs` in order. Each facility entry exposes its completed `level`, first matching `job`, matching `jobs`, `quote`, `effectText` and `nextEffectText`. The facility quote includes completed `level`, projected facility `queuedLevel`, `targetLevel`, projected branch limit `maxLevel`, `cost`, `commandCost` and the queue position and wait. Quotes do not mutate game state. The display helper `constructionJobs()` adds `queuePosition,queued,startsInSeconds,finishesInSeconds`. Facility jobs also expose display names and retain their canonical IDs in storage.

Bonuses are `{income:{gold,rice,wood,stone},capacity,defense,siegeDefense}`; defense fields are decimal proportions. Only completed facilities on active owned branches contribute production and capacity. Flat monthly increments per level are farm100 rice, market45 gold, lumber40 wood, quarry35 stone, granary75 rice, trade_port35 gold, sawmill30 wood and stoneworks25 stone. They are added after main-town technology modifiers. Barracks adds150 and drill_ground100 to troop capacity per level, without granting troops. Watchtower adds0.01 per level and moat0.0075 per level to that branch's defense multiplier; moat is multiplied by the existing siege/tactic wall factor. Other branches and parent-city defense receive no facility defense multiplier.

Completed facility levels retain `facilityCompletedAt:{facilityId:[elapsedMs,...]}`, one integer timestamp per level in ascending order. The engine uses those boundaries during catch-up so a remote battle's projection of a completed facility cannot retroactively create production. The maps, timestamps and jobs are validated together and always reconciled from the authoritative branch ledger on ordinary uploads. The branch keeps completed facility levels when fallen, with effects disabled until paid repair completes; a siege cancels all unfinished orders at that branch, including waiting upgrades and facility work. Already-paid resources and commands are not refunded. Parent loss and role/cycle pruning remove the same attached records and jobs as before. Imports cannot add levels, reset dates, accelerate work or revive effects.

`branch_states` stores the authoritative condition and immutable absolute `completesElapsedMs` for each started or waiting job. Uploads cannot create a branch, remove an intact defense, finish an upgrade early or revive a fallen branch. Server projections use the actual world clock, including pause/speed behavior; the ordinary save-clock tolerance does not shorten a branch deadline. A parent lost through capture, a role change or cycle settlement removes its attached branches and jobs. The next owner receives no old branches. Only branches of the retained home survive a cycle reset.

The server-owned `resolved_elapsed_ms` cursor tracks branch progression across ordinary sync, field battles and repairs. Cursor-only progress does not change the semantic branch `sequence`, but transactions compare both values internally. Normal uploads derive CPU branch damage from the previous trusted checkpoint and ledger; imported branch conditions, RNG flags or removed parent ownership do not prove a defeat. A conflicting CPU prediction is corrected only at the branched parent: a parent still owned in the trusted replay retains its owner and defenses, while a parent still owned in the incoming save after a proved CPU capture retains the exact fallen branches and surviving paid jobs observed immediately before that capture. Unrelated incoming resources and progression are preserved, and repeated saves converge without a permanent conflict loop. Imported ownership alone never erases defenses; a loss without the required server proof still returns `BRANCH_PARENT_CHANGED`. Field captures, access revocation and cycle settlement retain their authoritative ownership rules. The private full snapshot exposes `branchResolvedElapsedMs`, which the verified sync bridge applies through `setBranchAuthority({resolvedElapsedMs})` before clock catch-up. That capability lives outside exported save state. It prevents an older defender checkpoint from replaying a historical CPU assault against defenses already changed by a later authoritative battle. The cursor is campaign-wide: historical assaults against any recorded branched parent at or before it are not repeated; current/future assaults and other income, jobs and command recovery continue. Actual role/campaign changes reset the runtime cursor, and stale identity/revision responses cannot supply it.

Field target DTOs contain branch choices and a parent attack reason while any completed, unfallen branch remains. `POST /field/attack` accepts optional `targetBranchId` alongside `targetPlayerId,targetCastleId,troops,tactic` and the usual writer/request fields. All completed intact branches must fall before any player can attack the parent. The branch gate also applies to personal CPU invasions and covert retaliation. Kyoto Gosho has no branches and therefore no branch prerequisite. Branch defense is computed from the same engine helper on client and server.

A successful branch attack returns `battleMode:"branch",branchId,branchName,branchFallen`; it clears that branch’s entire unfinished queue and marks it fallen, preserving its completed branch and facility levels. The attacker pays ordinary attack costs and troop losses. The branch encounter never captures territory, pays rewards or loot, transfers officers, damages parent troops/resources or changes shared Kyoto development. Attacker/defender save and branch sequence comparisons prevent concurrent repair, combat or save writes from reviving an obsolete defense. A parent battle keeps the established reward/capture/raid semantics after the branch prerequisite is satisfied.

`0019_kyoto_gosho_court` and `0020_branch_states` are append-only migrations. Deploy the exact frontend/server engine pair and include `court.js` and `branches.js` in the portable API bundle, with their D1 migrations and journal. Focused local tests cover qualification, contribution, appointment revocation, access races, moderation, branch deadlines, idempotency, rollback, repair and siege ordering without production messages or battles.
