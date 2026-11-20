# 戦国大戦 通信API

Base path: `/api/v1`. UTF-8 JSON. Success always includes `ok: true`.
All routes except GET `/config`, GET `/health`, GET `/online`, GET `/world-clock`, GET `/field`, POST `/session`, and POST `/devices/link` require `Authorization: Bearer <game-token>`.
No cookies are used. Never put a token or pairing code in a URL. POST/PUT/PATCH/DELETE bodies require `Content-Type: application/json`, including `{}` for an empty body.

## Common objects

```js
user = {
  id: "u_…", name: "領主名", clan: "織田家", isAdmin: false, isStaff: false,
  guildId: null, guildName: null, guildRole: null, online: true
}
// guildRole is null, "owner", or "member".
// online means at least one explicitly foreground device heartbeat is newer than 90 seconds.
// Authenticated reads and save writes alone never make a player online.
message = {id: 1, userId: "u_…", name: "領主名", text: "…", createdAt: "2026-11-21T00:00:00.000Z", isAdmin: false, isStaff: false}
guild = {id:"g_…", name:"…", ownerId:"u_…", ownerName:"…", memberCount:1, maxMembers:50, createdAt:"…"}
gift = {gold: 100, rice: 200, wood: 50, stone: 50, magatama: 3000}
error = {ok:false, error:{code:"AUTH_REQUIRED", message:"日本語の説明", retryAfter:5}}
```

`retryAfter` exists only on rate limits. HTTP status is meaningful (400, 401, 403, 404, 409, 410, 413, 415, 429, 500, 503).
All returned timestamps are ISO strings. Treat names, messages, mail, and announcements as plain text, never HTML.

## Identity and public configuration

| Method / path | Body / query | Result fields, in addition to `ok` |
|---|---|---|
| GET `/health` | none | `status:"ready"` |
| GET `/config` | none | `announcement:string`, `adminClaimed:boolean`, `onlineCount:number`, `clock` |
| POST `/session` | `{name?,clan?}` | `token:string`, `user` |
| GET `/me` | none | `user`, `friends:user[]`, `requests:[{id,name,clan,direction:"incoming"|"outgoing",createdAt}]`, `unreadMail:number` |
| PATCH `/profile` | `{name}` | `user` |
| GET `/players` | `?q=検索語` (2–24 chars) | `players:user[]` (up to 30, excludes requester) |

Names and clan labels have a 24-character limit. Names are unique after Unicode compatibility normalization and case folding.
If no name is supplied, the server chooses `旅の領主` plus a random suffix.
The 256-bit anonymous game token is a 43-character base64url string. The server stores only its SHA-256 hash. A session-creation token is returned only when creating that identity; a new per-device token is returned only after a successful pairing-code redemption.
Store the token in localStorage and offer an explicit identity JSON export/import for recovery. An exported original token remains valid after additional devices are linked. A game save contains game progress; it does not contain the bearer identity and cannot confer operator privileges. Losing every authenticated device and every identity-token backup loses access to that identity, including the claimed operator identity. The server registration key is not a recovery token for a new identity after an operator has already been claimed.

## Device linking and identity recovery

| Method / path | Authentication and body | Result fields, in addition to `ok` |
|---|---|---|
| POST `/devices/pair-code` | Existing bearer token, `{}` | `code:string`, `expiresAt:ISO` |
| POST `/devices/link` | No bearer token, `{code,deviceName?}` | `token:string`, `user` |

Issue a code on a currently authenticated device and enter it on the second device. The code has 12 characters from a 32-character alphabet, generated with cryptographic randomness. Redemption accepts lowercase letters and optional spaces or hyphens. The code expires after ten minutes, and generating another code for the same identity replaces any prior outstanding code. At most five codes can be issued per identity per ten minutes.

The database stores a SHA-256 hash of the code with a domain-separation prefix, its owner and its expiry; it never stores the plaintext code. Redemption creates a distinct 256-bit bearer token in `user_sessions` and consumes the code in one D1 transaction. Concurrent redemption attempts can produce exactly one successful token. Expired, unknown or already-used codes return HTTP 410 `PAIR_CODE_EXPIRED`. Code-format errors return HTTP 400 `INVALID_PAIR_CODE`.

Link attempts are limited to 12 per 15 minutes per hashed Cloudflare source IP. A shared anonymous bucket is used if that trusted source-IP header is absent. The issuing device, original exported token and other linked devices remain authenticated after linking. The new token identifies the same user ID, so the account's cloud save, guild, friends, mail and server-owned operator role are available on the new device. No registration key is copied to the client or included in a code.

`deviceName` is optional and limited to 64 Unicode characters. Names are private to that identity's sync responses and are not published in the online list. Pairing codes and token exports are secrets intended for the account holder's own devices.

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

The displayed calendar repeats **1560 January → 1615 December → 1560 January**. One simulated month is 60 seconds. The display uses `absoluteTurn = floor(elapsedMs / 60000)`, `cycle = floor(absoluteTurn / 672) + 1`, and the month within the cycle. A cycle change does not reset elapsed time, inventory, castles, jobs, receipts, treaties or any player's progress. Internal turns remain absolute and are valid through 999,999,999; treaty/scouting expiry permits a further six turns.

`GET /config` and every successful sync response also include the current `clock`, allowing the first save load to receive the same authoritative time without waiting for a separate poll.

### Save checkpoints and legacy migration

The optional saved field is `state.worldClock = {id:"world-v1",elapsedMs:integer}`. It represents the common-clock instant already applied to that game state, not a second independent clock. `state.turn` must equal `floor(elapsedMs/60000)`, and `state.realtime.elapsed` must equal `(elapsedMs % 60000)/1000` within 0.00001 seconds. Unknown checkpoint authority fields are stripped. Writes normalize the legacy saved running/speed settings from the global clock; imported personal settings cannot control time. Reads preserve those stored fields so an operator clock change cannot change the save fingerprint at the same save revision. Clients use the separate authoritative response `clock` for current running/speed and apply it locally.

A new or imported legacy save without this field remains acceptable for its first migration. The client attaches it to the current common time, retimes relative treaty/scouting expiries and dated history, and keeps resources and jobs without granting rewards for time before that initial attachment. Later checkpoints can be old: the client must process the elapsed difference, including time spent disconnected. The server returns the current clock alongside an old checkpoint rather than silently moving the saved date without simulating its effects.

The server rejects a checkpoint more than 5,000 simulated milliseconds ahead of its current clock with HTTP 400 `CLOCK_AHEAD`. Invalid clock ID, integer range, turn or fractional phase returns HTTP 400 `INVALID_CLOCK_ANCHOR`. Once a cloud save has a checkpoint, a subsequent PUT without one returns HTTP 409 `CLOCK_ANCHOR_REQUIRED`; the check is part of the atomic save update, so a race cannot downgrade an anchored record to a legacy one. The original saved snapshot stays intact on any rejection.

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
  clock // current shared world clock, as specified above
}
```

| Method / path | Body / query | Behavior |
|---|---|---|
| GET `/sync` | `?deviceId=…` (optional) | Reads the authenticated account's snapshot without acquiring or renewing a lease. |
| POST `/sync/lease` | `{deviceId,deviceName?,takeOver?:boolean}` | Claims an empty or expired lease, renews the same device's lease, or explicitly takes over when `takeOver:true`. |
| POST `/sync/release` | `{deviceId}` | Releases only the matching holder's lease. Another device's release is a harmless no-op. |
| PUT `/sync` | `{deviceId,revision,save:object}` | Saves only when the revision matches and this device still holds an unexpired lease; increments revision by one and renews the lease. |

Device IDs use ASCII letters, digits, `_` or `-`, with a maximum length of 90 characters. Use a fresh ID per browser document so two tabs are independent writers. A linked identity can have several connected devices, but only one device advances and writes the game at a time. `writable` is true only if the requested device is the current holder and the lease has not expired. Server timestamps allow a client to compute the remaining duration without trusting its local wall-clock offset.

A lease lasts 30 seconds. Successful lease acquisition/renewal and successful save writes extend it. Reading, online heartbeats and unrelated authenticated operations do not. A competing lease request returns HTTP 409 `LEASE_HELD` unless the user explicitly requests takeover. The client should read the latest snapshot after a conflict and offer an explicit “この端末でプレイ” action; background polling must not set `takeOver:true`.

Save writes use a single SQL `UPDATE … WHERE user_id=? AND revision=? AND writer_device_id=? AND lease_expires_at>? RETURNING …`. If its condition fails, the server does not change the stored snapshot. An absent, expired or displaced writer lease returns HTTP 409 `LEASE_REQUIRED`. A stale revision with a valid holder returns HTTP 409 `REVISION_CONFLICT`. Two writes of the same revision cannot both succeed. After an uncertain network result, read the current revision rather than blindly overwriting it. A release does not delete progress or reset its revision.

The client polls snapshots every five seconds while the document is visible, schedules a save about one second after local changes, renews its lease at least every ten seconds while active, and heartbeats presence every twenty seconds. It pauses progression when the lease or network is unavailable and preserves a local recovery copy before replacing conflicting local progress. These intervals describe the client integration; the server enforces the lease and revision checks independently. Synchronization is automatic polling, not a claim of instantaneous delivery or uninterrupted operation during network loss.

`PUT /sync` has a two-MiB streamed request-body limit, including its JSON wrapper. Other bodies remain limited to 16 KiB. The server validates the game's version-2 schema, including the 256 officer IDs, 128 castle records, 64 facilities, resource ranges, officer variants, jobs, armies, governors, timers, receipts and battle data. Only known fields survive normalization; imported `isAdmin`, `role` or other authority flags are not trusted. Invalid data returns HTTP 400 `INVALID_SAVE`. The returned save is the normalized canonical content, so clients must accept normalization without erasing actions made while a save request was in flight. Each identity is limited to 120 lease requests and 120 save writes per minute, with independent counters.

### Operator assets and restoration

The sole authority is `settings.adminUserId`, established by the existing one-time `/admin/claim` flow. Every authenticated request resolves the current role from the server; the save file, device name, browser settings and request body cannot grant it. `entitlements.edo` and `entitlements.ieyasuU` are both true only for that identity.

General-player writes containing `home:"edo"`, ownership of Edo under their own clan, or the variant `of_b0616adde162:U` are rejected with HTTP 403 `ADMIN_ENTITLEMENT_REQUIRED`. Other ranks of that officer remain usable. A general player completes unification over 127 eligible castles; an operator has all 128 available.

For the operator, reading or writing a valid save idempotently includes Tokugawa Ieyasu (`of_b0616adde162`) and its U variant, and fixes the home at Edo (`home:"edo"`, `castles.edo.owner=state.clan`). An older operator save based elsewhere moves to Edo while retaining its former territory, resources, buildings and collection. On that initial move only, each of Edo's troop, wall and castle levels becomes the maximum of its old value and the former home's value. A pending Edo castle job is adjusted to the next level, or completed/removed if Edo is already level 32. Other jobs and their remaining time are preserved. Edo is included once in `captureRewards`; repeated restoration never replenishes troops or duplicates rewards. Both the client and backend enforce this same deterministic migration, and the public field always locates an operator at Edo. No extra restore endpoint or second administrator-registration key is required on linked devices.

If an account has a previously stored operator save but is no longer the operator, reads remain recoverable: Ieyasu U becomes SSS; Edo ownership and its castle jobs are removed; Edo as the home is relocated to the clan's usual owned home or another owned castle. For an Edo-only campaign its castle level and garrison move to the clan's original home, preserving the rest of the progress. This read-time migration does not increment the stored revision or renew the lease. The next write is still subject to full general-player validation. There is no public role-reassignment endpoint.

## Global online player list

| Method / path | Authentication and body / query | Result fields, in addition to `ok` |
|---|---|---|
| POST `/presence` | Bearer token, `{deviceId,deviceName?,online:boolean}` | `user`, `onlineWindowSeconds:90` |
| GET `/online` | Public, `?cursor=…&limit=…` | `players:user[]`, `total:number`, `nextCursor:string|null`, `onlineWindowSeconds:90` |

Send `online:true` every twenty seconds only while the game document is visible. Send `online:false` when hidden, leaving or disconnecting when possible. A player is online if any device for that identity has an explicit true heartbeat newer than ninety seconds. The boundary is strict: exactly ninety seconds old is expired. Closing a tab without a final heartbeat therefore clears naturally within that window. Multiple devices are deduplicated into one player; hiding one does not hide a second visible device.

`/online` returns public user ID, display name, clan, current operator badge and public guild information with `online:true`. It never returns tokens, pairing codes, IP addresses, device IDs/names or per-device activity times. It is sorted by user ID and paginated with an opaque user-ID cursor. The default page size is 50; `limit` accepts 1 through 100. `total` covers all currently online identities, and `/config.onlineCount` uses the same presence rule. Pagination is a current live view, so presence changes between pages can change the total.

`GET /me`, chat, sync reads and other background authenticated requests do not create presence. Foreground presence writes are limited to 180 per identity per minute. Per-device presence records older than 24 hours are removed on that identity's next presence update; this cleanup does not touch sessions or cloud saves.

## Shared player field, raids and diplomacy

The shared field projects real cloud-saved player bases onto their actual home-castle locations. A base belongs to a player ID; multiple players at the same historical castle remain separate selectable accounts. A registered identity without a cloud save has no field base yet. A defeated ordinary campaign is omitted until restored. Field raids and player alliances are separate from the campaign's NPC castle conquest, clan treaties, friends and guilds.

| Method / path | Authentication and body / query | Result |
|---|---|---|
| GET `/field` | Public; optional bearer token; `?cursor=…&limit=…` | `{ok,players,total,nextCursor,clock,rules}` |
| GET `/field/me` | Bearer token; optional `?deviceId=…` | `{ok,self,revision,clock,rules,attack,relationships,battles}` |
| POST `/field/attack` | Bearer token; `{targetPlayerId,troops,tactic,requestId,deviceId,expectedRevision}` | Full current sync snapshot, plus `{battle,idempotent}` |
| POST `/field/diplomacy` | Bearer token; `{targetPlayerId,action,requestId,deviceId,expectedRevision}` | `{ok,relationship,idempotent,clock}` |

Both POSTs require the acting identity's unexpired writer lease for `deviceId` and the exact cloud-save `expectedRevision`. The client must catch up to a confirmed world-clock sample, flush pending local changes, suspend local mutations during the request and then apply the authoritative returned/refresh snapshot. A defender's old save cannot overwrite an incoming raid: the raid increments its revision, so the old PUT receives `REVISION_CONFLICT`. Preserve unsent local edits as a recovery backup; do not silently resubmit them over the new authoritative revision.

### Public and private field objects

```js
fieldPlayer = {
  playerId:"u_…", name:"領主名", clan:"織田家",
  homeCastleId:"kiyosu", homeCastleName:"清洲城", level:1,
  defenseTroops:3750, defensePower:4600,
  armySummary:{officerCount:3,rankPower:1.08},
  isAdmin:false, isStaff:false, self:false, online:false,
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

GET `/field` sorts by player ID, uses an opaque player-ID cursor and accepts a limit from 1 to 100 (default 50). It includes only public names, role, clan, home, level, aggregate army strength and current presence. No resources, saved game, device identifiers/names, tokens, pairing codes or IP information is exposed. A guest sees `self:false`, neutral relationships and `attackable:false`. Optional authentication adds the requester's relationships and target eligibility; it does not add private resources. The role is resolved from `adminUserId`, never client flags. An operator's home is always Edo and all operator bases are protected from raids.

GET `/field/me` is private to the authenticated user. `self` and `revision` can be null if no cloud base exists. `attack` includes only that user's available troops, commands and rice. With `deviceId`, a different writer causes `ready:false`. `relationships` includes only that user's unexpired incoming/outgoing proposals and accepted alliances; `battles` contains the newest 20 raids involving that identity. A supplied query cannot select a different user's private history.

### Raid rules and result

All clients receive this `rules` object:

```js
rules = {
  minTroops:300, maxTroops:100000, commandCost:1,
  foodBase:150, foodPerTroop:0.3,
  attackCooldownMs:60000, defenderProtectionMs:60000,
  proposalLifetimeMs:600000, allianceDurationMs:360000,
  maxLootPerResource:500, maxLootFraction:0.05,
  maxDefenderLossFraction:0.1, operatorProtected:true,
  tactics:[
    {id:"balanced",name:"正攻法",food:1,modifier:1,loss:1},
    {id:"assault",name:"総攻撃",food:1.25,modifier:1.18,loss:1.35},
    {id:"siege",name:"包囲戦",food:1.65,modifier:0.97,loss:0.8},
    {id:"ambush",name:"伏兵",food:1.1,modifier:1.06,loss:0.95}
  ]
};
```

A raid costs one command and `ceil(troops × 0.3 × tactic.food) + 150` rice. The attacker needs 300–100,000 soldiers, within its saved available force; its confirmed world-clock checkpoint must be no more than 15 simulated seconds old. Attacks are blocked while the global clock is paused, against self, an operator, a defeated base, an active ally or a recently protected defender. Attacking players wait 60 simulated seconds between raids. A defender receives 60 simulated seconds of protection after each raid, including a repelled raid. These deadlines use monotonically increasing world `elapsedMs`; calendar wrap and device clocks cannot shorten them. Offline opponents remain valid field targets, and their most recent persisted base is used.

The server computes battle strength from saved troops, morale, technology, castle/wall levels, selected tactics and the strongest owned rank of each equipped officer. Rank multipliers for D/C/B/A/S/SS/SSS/U are 0.90/0.95/1/1.08/1.16/1.25/1.35/1.50, averaged over the equipped army; an empty army uses 0.75. Defense includes the home garrison, 45% of mobile troops and a fixed 200-point base. Siege reduces wall effectiveness. Victory probability is clamped to 5–95%, and the result uses server cryptographic randomness. Client-supplied outcomes, strengths, losses, role flags or resource rewards are rejected as unknown fields.

Raids do not transfer or delete the home, other castles or officers. The attacker's loss is capped at 35% of the sent force; the defender loses at most 10% of its mobile troops and 10% of its home garrison. On victory, each resource transfer is at most 5% of the defender's saved balance and at most 500 units, limited further by the attacker's resource capacity. Resource transfers balance between both saves; rice expedition cost is consumed. Surviving attackers return immediately. This is a bounded raid system, without travel time or player-base conquest.

```js
battle = {
  id:"fb_…",requestId:"client-uuid",attackerPlayerId:"u_…",attackerName:"…",
  defenderPlayerId:"u_…",defenderName:"…",castleId:"kiyosu",castleName:"清洲城",
  won:true,tactic:"balanced",troops:3000,attackerLost:300,
  defenderLost:{troops:120,garrison:150},foodCost:1050,
  loot:{gold:500,rice:500,wood:500,stone:500},
  attackPower:4000,defensePower:3800,winChance:53,
  occurredElapsedMs:120000,createdAt:"2026-11-21T00:02:00.000Z",
  attackerRevision:5,defenderRevision:8,
  nextAttackElapsedMs:180000,defenderProtectedUntilElapsedMs:180000
};
```

Both saved revisions increment once for a successful raid, while the defender's lease remains with its existing device. Battle logs are private to the two participants. Existing campaign resources and upgrades are still imported from validated client saves; the field service is authoritative over raid resolution, authorization and atomic settlement, but it is not a complete server simulation or a general anti-cheat validator of every campaign transition.

### Mutual diplomacy

`action` is `propose`, `accept`, `reject` or `cancel`. Only the recipient of a live incoming proposal may accept/reject it. Only its sender may cancel an outgoing proposal. A proposal lasts 600,000 simulated milliseconds. Acceptance establishes a 360,000-millisecond alliance (six game months), during which both directions of attack are blocked. Accepted alliances run to their expiry and cannot be cancelled early. Rejected, cancelled and expired relationships return `relationship:null`; the history row remains for concurrency checking. Re-proposing after expiry is allowed. At most 20 live proposals/alliances may involve either participant; this limit is also checked inside the committing transaction.

Diplomacy changes separate relationship records and does not alter either game save or save revision. It can be performed while the world is paused, but its elapsed-time expiry remains paused with the common clock. No player can forge another player's approval by sending an alternate proposer ID or action.

### Idempotence, atomicity and errors

Retain a fresh UUID `requestId` across retries of each distinct action. IDs are scoped to the acting identity and shared across attack/diplomacy operations. A semantic hash binds the kind and target plus troops/tactic or diplomatic action. Reusing an ID for different content returns HTTP 409 `REQUEST_ID_REUSED`. Retrying the same completed raid returns the identical battle record and the **latest** attacker sync snapshot with `idempotent:true`, never an old save that could rewind later progress. A diplomacy retry returns the current relationship without repeating the action. Identity/device recovery does not make a completed operation execute again.

The server reads and validates both saves, then uses a conditional insert into `field_requests` as the gate for one D1 batch transaction. The gate atomically checks the acting lease/revision, defending revision, world-clock revision, current alliance, attack cooldown and protection. Only statements matching the newly generated private commit nonce can update the two saves and insert the battle. A duplicate request or failed condition changes neither save. An exception in any statement rolls back the complete batch. Diplomacy uses the same request gate with relation-revision comparison and consent rules. Consequently, a concurrent alliance acceptance and attack cannot both commit from the same observed state.

Requests are limited to 30 new raid attempts and 20 new diplomatic attempts per identity per real minute. Successful replays do not consume another battle/cooldown or rate-limit allowance. Bodies use the general 16-KiB limit; IDs follow the normal 90-character identifier rule. Public lists are read-only and never renew a lease or foreground presence.

| HTTP | Field error | Meaning |
|---|---|---|
| 400 | `INVALID_INPUT`, `INVALID_TARGET` | Invalid amount/tactic/action/extra authority field, or self-target |
| 403 | `TARGET_PROTECTED` | Protected operator target |
| 404 | `FIELD_PLAYER_NOT_FOUND` | Missing player or unsaved target base |
| 409 | `SAVE_REQUIRED`, `BASE_UNAVAILABLE` | No usable cloud base |
| 409 | `LEASE_REQUIRED`, `REVISION_CONFLICT` | Acting device must acquire/refresh synchronization |
| 409 | `CLOCK_ANCHOR_REQUIRED`, `CLOCK_STALE`, `WORLD_PAUSED`, `WORLD_CLOCK_CHANGED` | Confirm and apply the common clock before attacking |
| 409 | `INSUFFICIENT_FORCE` | Not enough troops, command or rice |
| 409 | `ALLIED_TARGET`, `ATTACK_COOLDOWN`, `TARGET_PROTECTED` | Active alliance, attack wait or defender protection |
| 409 | `DIPLOMACY_STATE`, `DIPLOMACY_LIMIT` | Consent state changed, action not permitted, or active relationship limit |
| 409 | `FIELD_CHANGED`, `REQUEST_ID_REUSED` | Concurrent target/relation update, or an ID reused for a different operation |

## Chat

| Method / path | Body / query | Result |
|---|---|---|
| GET `/chat` | `?channel=world|guild|friend|admin&target=…&after=…` | `{messages:message[],channel,nextAfter:number,hasMore:boolean}` |
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
| GET `/guild` | — | `{guild:guild|null,members:user[]}` |
| POST `/guild` | `{name}` | `{guild,user}` |
| POST `/guild/join` | `{guildId}` | `{user}` |
| POST `/guild/leave` | `{}` | `{user}` |

One guild per player, 50 members per guild, unique guild names up to 24 characters.
When the owner leaves, ownership passes to the earliest remaining member; user ID breaks timestamp ties. An empty guild is deleted atomically.

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
After registration another identity cannot claim, even with the key. The already registered identity can retry using its own bearer token.
Use `/config.adminClaimed` to hide the first-registration form for other players. Use `/me.user.isAdmin` to show admin tools.
Announcements are plain text, at most 300 characters; an empty string clears the announcement.

## Support staff appointment and removal

The primary operator can appoint existing player identities as support staff. The additional role grants access to the `admin` chat room only. It does not grant Edo, Ieyasu U, a protected field base, world-clock control, announcement editing, system mail/gift sending, staff management or another primary-operator registration. All those checks continue to require `isAdmin`. A staff member remains an ordinary player for campaign and field permissions.

| Method / path | Authentication and body | Result |
|---|---|---|
| GET `/admin/staff` | Primary operator bearer token | `{ok,staff:[staffMember]}` |
| POST `/admin/staff` | Primary operator bearer token; `{targetPlayerId,action:"appoint"\|"dismiss",requestId}` | `{ok,user,staff:[staffMember],action,idempotent}` |

`staffMember` contains the public `user` fields plus `appointedAt:ISO` and `appointedBy:operatorPlayerId`. The roster is sorted by appointment time and player ID. The POST response's `user` is the **target** player's current public identity, not the operator who made the request. A client must not replace its logged-in identity with this object. Resolve candidates using the existing authenticated `GET /players?q=…` search (2–24 characters), then submit the exact returned ID.

The operator cannot appoint/dismiss itself. A target must already exist, and unknown action/authority fields are rejected. The initial operator registration remains single-owner; staff cannot appoint others, dismiss themselves through this endpoint or become the primary operator by submitting the registration key after a claim exists. Staff appointments do not require a game save or a writer lease because they change server identity permissions, not game progress.

Every public `user` object, including `/me`, `/sync`, linked-device results, `/players` and `/online`, includes `isStaff:boolean`. Public field player summaries and chat messages also include it. `isAdmin` and `isStaff` are separate; the primary operator is represented with `isAdmin:true,isStaff:false`. Staff badges disclose only the role, not device or private account data. Imported save flags, profile changes and request-body flags cannot set either role.

A stable `requestId` is required; supply and retain a UUID for each intended role change and reuse it on retries. Omitting it returns HTTP 400 `INVALID_INPUT` without changing membership. The server atomically records the acting operator, target and action with the membership mutation. The same ID and content never repeat an action: an old appointment retried after a later dismissal returns the current `isStaff:false` and `idempotent:true`, without reappointing the player. Reusing that ID with a different target/action returns HTTP 409 `REQUEST_ID_REUSED`. A new request ID represents a new intended operation. Appointing an existing staff member or dismissing a nonmember is a safe no-op and reports `idempotent:true`; these no-ops do not reset appointment timestamps.

The membership change and request ledger use one D1 transaction, gated by a fresh private commit nonce. The conditional operation insert checks that the actor still equals the primary `adminUserId`; a stale cached operator flag cannot grant roles. A partial failure rolls back both the ledger entry and membership change. Distinct concurrent appointment/removal requests serialize at the database; a duplicated request changes membership at most once. New operations are limited to 30 per operator per real minute. Completed-ID retries do not consume another allowance.

Removal takes effect for every token and paired device on its next authoritative request. `/me` and `/sync` immediately report `isStaff:false`; both admin-chat reads and sends return 403. Clients must remove the restricted channel selection and clear its cached messages when the role disappears. Ordinary world/friend/guild chat and the player's personal save remain available. There is no token rotation or game reset on appointment/removal, and no production role assignments are part of deployment.

Errors include HTTP 401 for missing authentication, 403 `ADMIN_REQUIRED` for any non-primary operator attempting staff management, 400 `INVALID_TARGET` for self-role changes, 404 `PLAYER_NOT_FOUND` for an unknown target and 409 `REQUEST_ID_REUSED` for a conflicting retry ID. Private-chat rejection uses 403 `STAFF_CHAT_REQUIRED`.

## Mail and gifts

| Method / path | Body | Result |
|---|---|---|
| POST `/admin/mail` | `{target:"all"|userId,title,body,gift:null|gift,requestId}` | `{mailId,alreadySent:boolean}` |
| GET `/mail` | — | `{mail:[{id,title,body,gift,read,claimed,createdAt}]}` (newest 200) |
| POST `/mail/read` | `{mailId}` | `{read:true}` |
| POST `/mail/claim` | `{mailId,requestId}` | `{gift,receiptId,alreadyClaimed:boolean}` |

Only admin can send mail. Subject limit 60 characters, body limit 2,000.
`target:"all"` is a broadcast campaign visible to current and future identities; it does not fan out rows for every player. Individual mail is visible only to its target.
Gifts accept only integer `gold`, `rice`, `wood`, `stone` and optional `magatama` fields between 0 and 1,000,000 per field. Missing fields mean zero; all-zero gifts become null. A positive `magatama` amount is preserved in the mail and claim response, so magatama-only gifts are valid. Missing/zero `magatama` is omitted from canonical gift JSON to preserve the exact representation and send-idempotency hash of existing four-resource gifts. Clients read it as `gift.magatama ?? 0`; old resource-only mail and receipts remain compatible. The existing JSON columns store the added field without a schema migration. Sending any gift, including magatama, remains restricted to the primary operator; support staff cannot send system mail or gifts.
Use a fresh UUID `requestId` for each new send or claim and retain it across retries. Reusing a send ID with different content returns 409.
Claim is atomic with a unique `(mailId,userId)` receipt. A second claim with the same request ID returns the same gift and receipt with `alreadyClaimed:true`; a new request ID after claim returns 409 `GIFT_ALREADY_CLAIMED`.

**Frontend receipt requirement:** persist pending claim request IDs before the fetch. On success, pass `gift,receiptId` to the game's save-backed gift application function. It must check and persist an applied-receipts ledger atomically with the local gift change: the four resources go to `state.resources`, while magatama goes to `state.magatama`. Replayed identical receipts must never add resources or magatama twice. A failed network response should retry with the same request ID. Mail claims cannot independently make an offline editable game save authoritative.

## Deployment

Use a dependency-free Cloudflare Worker ESM with `env.DB`. Required manifest binding: `d1:"DB"`, `r2:null`, no `static` field.
Run `node scripts/build.mjs` to copy `worker/index.js` to `dist/server/index.js`; preserve `drizzle/` in source so Sites packages and applies the schema migrations. Apply `0000_social`, `0001_cloud_sync`, `0002_world_clock`, `0003_shared_field` and `0004_staff_roles` using the append-only journal. The previously recorded migration files and journal entries are unchanged. `0001_cloud_sync` creates `user_sessions`, `pairing_codes`, `player_saves`, `player_presence` and their indexes; `0002_world_clock` adds the singleton clock table; `0003_shared_field` adds the operation ledger, player relations and battle records with their indexes; `0004_staff_roles` adds support-staff membership and its role-operation ledger. These migrations are schema-only, with no data mutations. No table creation or schema alterations occur inside request handling.

Default CORS origins: the API's own origin, `https://uni-tadayasu.github.io`, `http://127.0.0.1:4173`, and the literal `null` origin for offline file HTML. No credentials/cookies are allowed.
For a different hosted frontend, set `SENGOKU_ALLOWED_ORIGINS` to its exact origin, or comma-separated exact origins. Do not include paths or wildcards.

Every response sets `Cache-Control:no-store` and `X-Content-Type-Options:nosniff`. CORS preflight permits GET, POST, PUT, PATCH, DELETE and OPTIONS with Authorization and Content-Type headers. Bodies are stream-limited to 16 KiB except the two-MiB sync-save endpoint, and SQL values are bound parameters.
No environment values, plaintext keys, or bearer tokens are logged. Admin state is server-owned; client flags and sender fields are ignored.

The Worker uses D1 `prepare`, `bind`, `first`, `run`, `all` and `batch` APIs. It does not issue manual `BEGIN`/`COMMIT` statements or rely on Node APIs at runtime. D1 batches execute their prepared statements in order as one transaction and roll back on a statement failure; this is the basis of atomic pairing-code consumption. The Worker uses the ordinary D1 binding without read-replication sessions, so reads and writes address the primary database. See the [official D1 database API documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Local verification

Run `node scripts/test-social.mjs`, `node scripts/test-sync.mjs`, `node scripts/test-world-clock.mjs`, `node scripts/test-field.mjs` and `node scripts/test-staff.mjs` using Node 24 or a Node version providing `node:sqlite`. Run `node --check worker/index.js` for the Worker syntax check.

The suites create an in-memory SQLite database, apply every journaled migration in order, generate a random test-only admin key in memory, and exercise the actual Worker. The D1 adapter runs each batch as an ordered SQLite transaction, matching D1's batch atomicity contract. Promise-based concurrent calls check revision conflicts, single-use pairing redemption, the single-operator claim, clock controls, repeated field requests, competing raids and consent-versus-attack races. The field suite injects a failing statement into an attack batch and verifies that both saves, the battle and the request record roll back, followed by a safe retry. The staff suite checks role separation, paired-device removal, appointment replay after dismissal, concurrent role operations and revocation between authentication and private chat SQL; it also tests transaction rollback and the primary-operator guard at commit time. A controlled server clock verifies disconnected elapsed time, equal time for different identities, pause/resume, speed changes, cooldown/alliance expiry and calendar wrap without resetting absolute time. The tests do not simulate network latency, a browser's lifecycle or the production deployment; those are separate integration checks. They do not contact a deployed service or send production messages.
