# 戦国大戦 通信API

Base path: `/api/v1`. UTF-8 JSON. Success always includes `ok: true`.
All routes except `/config`, `/health`, `/session` require `Authorization: Bearer <game-token>`.
No cookies are used. Never put a token in a URL. POST/PATCH/DELETE bodies require `Content-Type: application/json`.

## Common objects

```js
user = {
  id: "u_…", name: "領主名", clan: "織田家", isAdmin: false,
  guildId: null, guildName: null, guildRole: null, online: true
}
// guildRole is null, "owner", or "member".
// online means seen within the last five minutes, not a realtime presence guarantee.
message = {id: 1, userId: "u_…", name: "領主名", text: "…", createdAt: "2026-11-21T00:00:00.000Z", isAdmin: false}
guild = {id:"g_…", name:"…", ownerId:"u_…", ownerName:"…", memberCount:1, maxMembers:50, createdAt:"…"}
gift = {gold: 100, rice: 200, wood: 50, stone: 50}
error = {ok:false, error:{code:"AUTH_REQUIRED", message:"日本語の説明", retryAfter:5}}
```

`retryAfter` exists only on rate limits. HTTP status is meaningful (400, 401, 403, 404, 409, 413, 415, 429, 500, 503).
All returned timestamps are ISO strings. Treat names, messages, mail, and announcements as plain text, never HTML.

## Identity and public configuration

| Method / path | Body / query | Result fields, in addition to `ok` |
|---|---|---|
| GET `/health` | none | `status:"ready"` |
| GET `/config` | none | `announcement:string`, `adminClaimed:boolean`, `onlineCount:number` |
| POST `/session` | `{name?,clan?}` | `token:string`, `user` |
| GET `/me` | none | `user`, `friends:user[]`, `requests:[{id,name,clan,direction:"incoming"|"outgoing",createdAt}]`, `unreadMail:number` |
| PATCH `/profile` | `{name}` | `user` |
| GET `/players` | `?q=検索語` (2–24 chars) | `players:user[]` (up to 30, excludes requester) |

Names and clan labels have a 24-character limit. Names are unique after Unicode compatibility normalization and case folding.
If no name is supplied, the server chooses `旅の領主` plus a random suffix.
The 256-bit anonymous game token is returned only when creating that identity. The server stores only its SHA-256 hash.
Store the token in localStorage and offer an explicit identity JSON export/import for another device. Losing every copy loses access to that identity, including the claimed admin identity. This is separate from the local game save file.

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
`admin` is restricted to the single claimed admin identity. The client cannot choose the sender or supply an admin flag.

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

## Mail and gifts

| Method / path | Body | Result |
|---|---|---|
| POST `/admin/mail` | `{target:"all"|userId,title,body,gift:null|gift,requestId}` | `{mailId,alreadySent:boolean}` |
| GET `/mail` | — | `{mail:[{id,title,body,gift,read,claimed,createdAt}]}` (newest 200) |
| POST `/mail/read` | `{mailId}` | `{read:true}` |
| POST `/mail/claim` | `{mailId,requestId}` | `{gift,receiptId,alreadyClaimed:boolean}` |

Only admin can send mail. Subject limit 60 characters, body limit 2,000.
`target:"all"` is a broadcast campaign visible to current and future identities; it does not fan out rows for every player. Individual mail is visible only to its target.
Gifts accept only integer `gold`, `rice`, `wood`, `stone` fields between 0 and 1,000,000. Missing fields become zero; all-zero gifts become null.
Use a fresh UUID `requestId` for each new send or claim and retain it across retries. Reusing a send ID with different content returns 409.
Claim is atomic with a unique `(mailId,userId)` receipt. A second claim with the same request ID returns the same gift and receipt with `alreadyClaimed:true`; a new request ID after claim returns 409 `GIFT_ALREADY_CLAIMED`.

**Frontend receipt requirement:** persist pending claim request IDs before the fetch. On success, pass `gift,receiptId` to the game's save-backed gift application function. It must check and persist an applied-receipts ledger atomically with the local resource change. Replayed identical receipts must never add resources twice. A failed network response should retry with the same request ID. Mail claims cannot independently make an offline editable game save authoritative.

## Deployment

Use a dependency-free Cloudflare Worker ESM with `env.DB`. Required manifest binding: `d1:"DB"`, `r2:null`, no `static` field.
Copy `index.js` to `dist/server/index.js`; preserve `drizzle/` in source so Sites packages and applies the schema migration. No table creation or schema alterations occur inside request handling.

Default CORS origins: the API's own origin, `https://uni-tadayasu.github.io`, `http://127.0.0.1:4173`, and the literal `null` origin for offline file HTML. No credentials/cookies are allowed.
For a different hosted frontend, set `SENGOKU_ALLOWED_ORIGINS` to its exact origin, or comma-separated exact origins. Do not include paths or wildcards.

Every response sets `Cache-Control:no-store` and `X-Content-Type-Options:nosniff`. Bodies are stream-limited to 16 KiB, and SQL values are bound parameters.
No environment values, plaintext keys, or bearer tokens are logged. Admin state is server-owned; client flags and sender fields are ignored.

## Local verification

Run `node test-social.mjs` using Node 24 or a Node version providing `node:sqlite`.
The test creates an in-memory database, applies the migration, generates a random test-only admin key in memory, and exercises the actual worker. It does not contact a deployed service or send production messages.
