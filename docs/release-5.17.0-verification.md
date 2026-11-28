# Ver.5.17.0 — message notifications on each device

## Behavior

Web Push now covers the game's message stores: world/friend/guild/authorized private chat, system mail, player and guild letters, announcements, court conversation, and audience requests/replies. World chat requires its own opt-in. Court destinations use authoritative admission and open a conversation or audience list, never an untrusted thread identifier.

Notifications remain disabled until the player consents. The setting panel distinguishes this browser's registration from account-wide preferences, supports a test notification to this owned endpoint, and offers separate current-device and all-device stop actions. Up to five browser/device subscriptions can belong to one lord. Category, quiet-hour and digest settings are shared across that lord's subscriptions. New settings default to immediate delivery and no quiet hours; existing choices are retained.

Message text, sender names and operational roles are not included in lock-screen payloads. Delivery rechecks consent, account status, current room/participant permissions, read cursors, source existence and subscription revision. Court admission uses the same authoritative evaluation and role guards as the court API. Admission checkpoints preserve continuity across routine autosaves. A revoked appointment cannot retain its old notification scope. If a valid message races a routine save revision, its stale authorization snapshot is deferred for retry rather than marking that message delivered.

Successful message requests start bounded background delivery independently of the periodic sweep. Both immediate and periodic batches check up to twelve recipients; remaining users and retryable deliveries are picked up by the existing periodic cursor. A message-write invocation skips the generic notification sweep so that it runs only its targeted notification batch. A slow provider stops new periodic groups after eighteen seconds and leaves unstarted users for the next cursor cycle. Failed devices remain pending, while successful per-device receipts suppress duplicate retries. An endpoint added later does not receive notices already queued before registration.

A notification click uses an allowlisted local destination. Existing social/court account and role checks still apply. A court navigation waits if a prior send is unresolved, preserving its request receipt and the pending notification until that send is resolved.

## Browser setup

Use 保存・設定 → 便利な機能 → 通知設定 on each receiving device. Press この端末の通知をオン, allow the OS/browser prompt, and use この端末にテスト通知. iPhone/iPad require iOS/iPadOS 16.4 or later and a Home Screen web app, opened from its Home Screen icon. See [Apple WebKit's requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).

A successful test response means the Push service accepted the encrypted request. It does not prove that the OS displayed a notification. Focus mode, browser/OS permission, power settings and connectivity still apply.

## Local verification

All notification sends in automated tests use local encrypted fixtures or mocked Push services. No real player received a test message and no live player save was changed for testing.

| Gate | Result |
| --- | --- |
| `npm run check:build` | Generated public documents, promotion copy, bundles and press kit match their sources |
| `npm run test:entry` | CSS compaction, geography, offline entry and cached public search passed |
| `npm run test:interface` | 66 existing interface commands passed; affected court suites rerun after its added entry |
| `tests/test-notifications-ui.cjs` | 17 scenarios passed |
| `tests/test-notifications-sw.cjs` | 7 scenarios passed |
| `tests/test-notification-entry.cjs` | 10 scenarios passed |
| `tests/test-notification-social.cjs` | 6 scenarios passed |
| `tests/test-court-notifications-ui.cjs` | 9 scenarios passed |
| `tests/test-court-notification-app.cjs` | 5 scenarios passed using real app functions and the mounted court controller |
| Existing court UI/API | 65 / 29 scenarios passed |
| Existing social UI/chat/viewport/avatar/alliance icon | Passed |
| Source/minified runtime | 75 globals and 62 campaign checkpoints passed |
| `server/test-court-notifications.mjs` | 8 scopes / 149 API calls passed, including the actual Worker immediate hook and privacy races |
| `server/test-message-notifications.mjs` | 14 scopes / 112 API calls passed |
| `server/test-notifications.mjs` | 17 scopes / 97 API calls passed |
| `server/test-web-push-compat.mjs` | 7 independent encryption/VAPID/provider scopes passed |
| Existing regency and regency public contracts | 18 scopes / 365 API calls and 4 scopes / 58 API calls passed |
| Existing chat replies, letters, social, court messaging and moderation | Passed; announcement race fixture updated for the guarded batch write |

A local real-Worker load fixture with 30 subscribers, five devices each and eight queued court messages processed twelve recipients: the periodic tick used 635 D1 calls and the message POST used 596 (counting a batch as one call), with a measured maximum of 49 binds for that staff-recipient fixture. The court suite also checks every exercised statement against 100 binds and 50-byte LIKE patterns, including ordinary visitors. All pushes were mocked.

The current entry measures 3,735,337 raw / 1,032,941 gzip bytes: +10,903 / +2,822 from v5.16. The explicit budget is 3,737,000 raw / 1,033,700 gzip bytes. No runtime dependencies, fonts, images or audio were added.

The managed preview command reported a local URL, but its underlying server was not reachable and the browser retained an earlier game service-worker view. Therefore that preview is not recorded as visual verification of this release. Automated mounted-DOM, responsive and routing tests passed; physical PC/phone/tablet notification display was not observed.

## Packaging

Release metadata and the service worker use `5.17.0` / `5.17.0-20261128`. Deploy `0053_message_notifications.sql`, its appended journal entry and the Worker together, then the browser assets. The migration retains existing preferences, subscriptions and queued delivery/lease data and adds category consent times, room read cursors, court admission checkpoints, announcement metadata and per-device receipts. Existing VAPID secrets and D1/R2/allowed-origin configuration are reused.

Public health must report `version:"5.17.0"`, `messagePush:true`, `pushDeviceTest:true` and validate the new schema. The exact source commit, version, deployment status and GitHub merge/check records are available in their publication systems.
