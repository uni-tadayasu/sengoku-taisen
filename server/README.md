# 戦国大戦 通信局

Dependency-free Cloudflare Worker ESM with a D1 database. The API contract is in `API_CONTRACT.md`.

## Files to deploy

- Copy `index.js` into the selected project's `worker/index.js`; build it to `dist/server/index.js`.
- Preserve the root `drizzle/0000_social.sql` and `drizzle/meta/_journal.json` for the Sites migration workflow.
- Set the logical hosting binding `d1: "DB"` and leave `r2: null`; omit static deployment configuration.
- Store the first-registration key only in the secret runtime variable `SENGOKU_ADMIN_KEY`.
- When the frontend and API have different origins, add the exact frontend origin to `SENGOKU_ALLOWED_ORIGINS`. Multiple exact origins are comma-separated.

Do not edit a migration after it has been applied. Add later migrations for later schema changes. The request handler performs no schema creation or mutation.

## Local verification

```sh
node test-social.mjs
```

Uses Node's built-in SQLite, creates an in-memory database, and applies the actual migration. The admin test key is generated in memory. No production connection or production message is involved.

Verified result: **83 HTTP requests passed**, including two concurrent admin registrations (only one succeeds) and two concurrent claims of one gift (only one succeeds).

Coverage includes bearer authorization, stored token hashes, CORS, body limits, chat rate limits, guild/friend/admin isolation, deterministic guild ownership transfer, admin claim throttling, mail targeting, gift idempotency, and unique receipts.

## Production verification

Use read-only requests to `/api/v1/health` and `/api/v1/config`. Do not claim the production administrator or send chat/mail as part of deployment verification.

## Persistence boundaries

- Users, hashed tokens, memberships, accepted friendships, messages, announcements, mail campaigns, and gift receipts are in D1.
- Game progress and the raw anonymous identity token are managed by the frontend. Offer identity export/import; losing every copy of a token loses that identity.
- The first administrator is a single server-side identity. Another identity cannot reclaim it with the key once registered.
- The frontend must persist a pending gift claim's `requestId` before requesting it. Retry with the same request ID after a network error.
- Apply a returned gift only after checking its server `receiptId` against a save-backed receipt ledger. Persist the resource change and receipt entry together. This API does not make an offline editable game save authoritative.
- Broadcast mail targets current and future players. No mass fan-out is performed.
- Online count means active within five minutes. Chat is polled HTTP, not a WebSocket presence service.

## Runtime review

The Worker uses only web-platform APIs and D1; it does not depend on Node APIs. Every SQL value from a request is bound. Each `prepare()` contains one statement. Multi-step operations use `DB.batch()` for atomicity. Direct `env.DB` queries use the primary database; no read-replica session is enabled.

Cloudflare's current documentation confirms that D1 batches are transactions and roll back when a statement fails, and that read replication requires the Sessions API:

- https://developers.cloudflare.com/d1/worker-api/d1-database/
- https://developers.cloudflare.com/d1/worker-api/prepared-statements/
- https://developers.cloudflare.com/d1/best-practices/read-replication/

No cookies are used. All private calls require the game bearer token. CORS allows exact configured origins, including literal `null` for downloaded offline HTML; it does not expose cookies or use credentialed wildcards. The server never logs environment secrets, raw bearer tokens, or the admin key.
