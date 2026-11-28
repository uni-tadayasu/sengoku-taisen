# Ver.5.19.0 — shogunate governance after founding

## Behavior

An authenticated lord with an opened shogunate can use the new **幕府政庁**. Existing imperial-approved, deadline-expired and legacy openings qualify; an unused opening right or a pending application does not. The latest opened government supplies the displayed name and 征夷大将軍 title. Existing founding, imperial approval and 72-hour deadline behavior remain in place.

The government has four policies, three public works with five levels each, three daily duties, five development milestones and a history of the latest 30 actions. Policy changes and daily duties reset at 05:00 Japan time using the server calendar. Each policy changes the resource distribution of the daily governance reward. Public works add rice, gold, or wood and stone to that reward. These bonuses do not modify ordinary production or combat calculations.

Public-work level L costs gold 3,000×L, rice 1,000×L, wood 1,500×L and stone 1,000×L, and grants up to 20×L renown. 日次政務 grants the current resource reward and up to 10 renown. 領民救済 spends rice 2,000; 街道巡見 spends gold 2,000; each grants up to 15 renown. Government levels begin at 0, 100, 300, 700 and 1,500 renown, ending at 天下泰平. Each level above the first adds five magatama to the daily governance reward.

Development and claim records belong to the account. Additional founding rights, campaign changes, home relocation, cycle resets and imported saves cannot erase development or create additional daily or milestone claims. The accepted day never moves backwards.

## Presentation and synchronization

The existing military-council menu and founding-record dialog link to 幕府政庁. Its tabs show daily duties, policies, public works, milestones and history, with server-provided costs, rewards, requirements and completion states. Actions have an in-game confirmation. The UI reports actual credited rewards when an asset cap limits the offered amount.

Writes use the existing game-save expansion bridge. The bridge flushes local progress, supplies the current writer device and save revision, and reconciles the authoritative save before returning success. The UI preserves uncertain operation IDs, validates the real server DTO and receipt, rejects stale account responses, and honors the bridge's effective request ID when recovering an older pending operation. The existing restrained animation and reduced-motion conventions apply.

The real module and shipped styles were reviewed in a Chromium fixture at desktop 1,365px, phone 390px and tablet 768px/1,024px widths. Dialogs, content and cards fit without horizontal overflow. On the phone, the five tabs fit on one row with at least 44px touch targets, and the first daily-task heading is visible on opening. At 1,024px the three daily cards form one row. Costs and confirmation were checked using a real server DTO and a fixture that rejects writes. This is browser fixture verification, not physical-device testing.

## Security and migration

Migration `0054_shogunate_governance.sql` adds two account-owned tables and a history index. It does not modify existing lords, court appointments, opening records, castle ownership or saves. The health endpoint checks both new tables and advertises `features.shogunateGovernance:true`.

Each mutation checks the account and current role, writer lease, save revision, world-clock revision, government revision and exact latest opened right. One ordered D1 transaction commits the resource debit or credit, government development and immutable receipt. A failed statement rolls back every effect. Semantic request hashes and unique claim keys prevent duplicate grants; replay returns the original receipt with the current authoritative save. Client-supplied prices, rewards, renown, role flags and opening rights are rejected.

Resources retain the existing 100,000,000-per-asset cap. Partial awards record only actual credit. An audience duty can still earn renown when assets are full; a completely exhausted reward keeps its unclaimed slot. Relief and inspection reject without payment at maximum renown. Court offices, protected bases and private operational role labels retain their existing behavior.

## Local verification

All gameplay tests use synthetic local identities and isolated database fixtures. No live player's save was modified for QA.

| Suite | Result |
| --- | --- |
| `server/test-shogunate-governance.mjs` | 21 scenarios / 387 isolated API calls; largest statement 40 D1 bindings; zero external network requests |
| `server/test-shogunate-governance-migration.mjs` | Existing contents of 162 tables preserved; foreign keys, unique receipts/claims and revision constraints passed |
| `tests/test-shogunate-governance-ui.cjs` | 16 scenarios passed |
| `tests/test-shogunate-governance-bridge.cjs` | 9 integration scenarios passed |
| `server/test-shogunate.mjs` | 15 scenarios / 155 API calls passed |
| `server/test-shogunate-approval.mjs` | 18 scenarios / 172 API calls passed |
| Existing interface suite | `npm run test:interface` passed |
| Existing rewards interface and court API suites | 30 and 29 scenarios passed, respectively |
| Build reproducibility and entry checks | `npm run build`, `npm run check:build` and `npm run test:entry` passed |
| Source/minified runtime parity | 76 globals and 62 campaign checkpoints passed |

Coverage includes real frontend validation of server DTOs, founding eligibility, request replay, competing claims, rollback, stale writer/save/government state, role and ban changes, a new founding racing a commit, resource shortages, maximum levels, capped rewards, the JST reset boundary, backwards clock movement, old saves, relocation, and the complete 1,500-renown development path.

The initial entry measures **3,783,957 raw / 1,045,513 gzip bytes**, an increase of **38,400 / 9,762 bytes** over v5.18.0. The reviewed allowance is **3,785,000 raw / 1,046,200 gzip bytes**. No new dependency, image or audio asset is required.

## Release packaging and publication state

Release metadata and browser bundles use `5.19.0` / `5.19.0-20261128`. The Worker is built from the matching server modules and includes the additive migration and journal entry.

The existing public API Site deployment succeeded as **version 99**, from source commit `7d887ab3285f7d2c38e041fc6772029a09e0b295`. Its health response was verified as `version:"5.19.0"`, `status:"ready"` and `features.shogunateGovernance:true`.

Frontend GitHub workflow outcomes, the merge commit and the GitHub Pages deployment are recorded by GitHub after these local checks. The successful API deployment alone does not establish frontend publication.
