# Ver.5.13.3 — operator recovery entry

## Scope

The settings version control can deliberately reveal the existing original-operator recovery form when a device has lost its local identity. Revealing the form does not change a saved game or grant a role. The existing server route still verifies the original registration key and resolves the original operator ID.

The entry exists only for the current recovery view and account context. Closing the view, leaving it, hiding the page, or changing accounts invalidates the entry and clears the input. Delayed key responses and save-file reads are discarded after cancellation. Adding a game save to a key-verified identity retains the operator-role check and cancellation behavior; importing a separate identity uses the established backup workflow.

The backend release marker is synchronized to 5.13.3, as required by the existing health/config version checks. The recovery entry preserves the registration secret, existing sessions, live players, and live game saves. A real operator recovery still requires the user to enter the original registration key and explicitly choose the progress to restore. The production follow-up below corrects a shared response query that prevented this workflow from completing.

## Local verification

- `node tests/test-domain-recovery.cjs`: 439 assertions, including cancellation during a file read, cancellation during the following verification, role loss, retry, and ordinary backup compatibility.
- `node tests/test-settings-usability.cjs`: 10 checks, including the deliberate version gesture, expiry, other-action reset, and unchanged game saves.
- `node server/test-admin-recovery.mjs`: 123 local HTTP calls using synthetic keys and identities; existing-owner-only authentication, immutable saved progress and old credentials, idempotent retries, revoked sessions, CORS, and rate limits.
- `node tests/test-minified-runtime.cjs`: original/minified initialization parity and 62 campaign/save checkpoints.
- Production entry remains within the existing release budget: 3,696,053 raw bytes / 1,022,358 gzip bytes. No frontend runtime dependency or image addition.
- API release parity checks passed after synchronizing the release marker: profile-name (9 scenarios / 143 calls), succession approval (27 scenarios / 816 calls), and rewards (20 scenarios / 323 calls), all with local test data.
- Recovery and settings checks are included in the GitHub Actions recovery job.

## Browser verification

The generated frontend was opened through the managed preview in Chromium. The normal settings control revealed the recovery form after the intended gesture, and closing the dialog removed the key input. The input and confirmation control were visible without horizontal clipping at desktop size, in a 390 × 844 phone-sized iframe, and in a 1024 × 768 landscape-tablet-sized iframe.

These checks cover browser rendering at the stated dimensions, not physical iOS/Android devices or an on-screen keyboard. No production key was entered and no real player account was recovered or modified.

## Publication

The release retains the existing GitHub Pages publication workflow and republishes the existing API Site with the synchronized release marker. No database migration is required. GitHub checks and the served release marker must be confirmed when the pull request is published.

## Production follow-up: city-honor query limit

On 2026-11-28 JST, the user reported the generic communication error while attempting operator recovery. Production logs showed HTTP 500 for `/admin/recover`, `/achievements`, `/me`, `/presence`, and `/sync`, although health, configuration, world-clock, and music reads succeeded. Limited diagnostic instrumentation identified the `public-honors` response stage and a database limit failure.

The Kagoshima crest had expanded the city-honor compound query from five to six `SELECT` terms. [Cloudflare D1 permits at most five terms in a compound SELECT](https://developers.cloudflare.com/d1/platform/limits/). The ordinary local SQLite limit was higher and did not expose this constraint. The exact generated query was 13,088 bytes with 19 bindings and six terms; Python SQLite with `SQLITE_LIMIT_COMPOUND_SELECT=5` reproduced `too many terms in compound SELECT`.

The fix separates the three appointment-based honors and the three city-holding honors into two statements in the same `db.batch()`. Each statement has three terms, and the original authorization, ownership predicates, output order, and shared read snapshot are preserved. No migration or data rewrite is needed.

Verification:

- City honors: nine scenarios and 123 local HTTP calls passed with a regression check enforcing the production five-term limit; maximum observed term count is three.
- Both generated statements also executed successfully with Python SQLite's compound limit set to five.
- Operator recovery: all 123 local HTTP calls passed, including original-owner authentication, retry, revocation, CORS, and rate limits.
- Error diagnostics: five injected failures confirmed stage classification and exclusion of credentials, request bodies, arbitrary error messages, SQL, names, and user IDs from diagnostic records.
- The existing API Site was published as version 90 at 2026-11-28 07:02 JST, with runtime environment revision 5 unchanged and source commit `bc5f2b73578b58db723e76e69b64a0fc8e852464`.
- The previously failing public achievements request returned `ok:true` in the production browser at 07:02:28 JST, including the expected city-honor field. Production logs then showed successful sync and sync-lease responses.

This confirms the shared server error was corrected. No actual operator registration key was entered by the agent; the user's final account and progress recovery remains to be confirmed through their own recovery operation.
