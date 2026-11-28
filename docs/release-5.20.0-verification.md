# Ver.5.20.0 — shared Kyoto estate with ordinary territory effects

## Behavior

An ordinary-home Regent, holder of one of the six externally appointed court offices, or authenticated Retired Emperor can develop the existing shared Kyoto Palace while retaining their personal home, clan, facilities, territory and armies. An independently appointed deputy qualifies through the same court appointment. The prime minister and Kyoto members use the same canonical palace. The shared castle reaches level 128; each of the 64 facilities reaches level 32.

The new **共同領地を開く** dialog shows the original home, shared holding, ordinary territory effects, all 65 development actions, authoritative prices and the common construction queue. Construction spends the acting lord's personal resources and one command. Completed growth and already-paid construction remain at Kyoto when an appointment ends.

Kyoto contributes exactly the existing ordinary extra-castle formulas to eligible ordinary lords. There is no special ten-percent development discount.

| Contribution | Ordinary extra-castle rule |
| --- | --- |
| Base monthly income | Gold 100, rice 170, wood 40, stone 30 |
| Each castle level above 1 | Gold 15, rice 20, wood 5, stone 5 before the existing modifiers |
| Base troop capacity | 500, through the existing capacity and governor calculations |
| Upkeep | Normal castle-level upkeep and the 60-rice monthly castle charge; at level 1 the combined base contribution is gold 2, rice 61, wood 1, stone 1 |
| Development pricing | One additional castle in the existing territorial cost multiplier |

The shared palace does not create a second personal set of 64 facilities. Actual Kyoto ownership already supplies its ordinary castle effect, so Kyoto members do not receive a duplicate contribution. The shared holding is separately visible on the map; personal conquest ownership, attack permissions, unification and rewards keep their existing rules.

## Authority, synchronization and migration

`GET /court/estate` and `POST /court/estate/upgrade` use the existing shared-base construction ledger. The write transaction fences the account, current appointment token, save and base revisions, writer lease and world clock. Payment, shared construction and its immutable receipt commit together. Repeated requests recover the original result, and failed or competing commits cannot debit resources twice.

Migration `0055_court_estate_economy.sql` records exact entitlement windows in common-world time. Existing eligible appointments start at deployment, with no retroactive pre-feature income. The migration initializes a missing canonical palace at that boundary and preserves existing personal saves, resources, troops, shared levels and jobs. All appointment, dismissal, succession, membership, ban and expulsion transitions record their economic boundary in the same transaction as the role change.

Runtime authority is separate from exported saves. A private, campaign-bound projection includes appointment windows, the canonical castle timeline and a verified time horizon. Income advancement splits at grant, revocation, creation and completion boundaries and stops at the verified horizon. Ended windows remain available for legitimate offline catch-up. Construction and future benefits cease when the entitlement ends.

For an existing campaign with estate history, sync writes require its current `courtEstateProof`. A missing, replaced or racing proof returns `COURT_ESTATE_REFRESH_REQUIRED` before committing the save. Imported campaigns first prove the previously accepted campaign, then receive projection metadata bound to the new campaign. A retrospective authority change recovers from the server checkpoint and backs up local progress; future jobs and facility-only revisions preserve valid unsaved progress.

Economic and troop-capacity paths in marches, branches, roaming, covert operations, alliance returns, residency, rewards, governance, maintenance and historical staff settlement receive the same verified context. The frontend caps its presentation clock to the projection horizon, in addition to the existing maintenance constraint.

## Verification

All gameplay tests use synthetic identities and isolated local databases. No live player's save was modified for QA.

| Suite | Result |
| --- | --- |
| `server/test-court-estate.mjs` | 22 scenarios / 512 local API calls; largest statement 40 bindings |
| `server/test-court-estate-economy.mjs` | 13 scenarios / 222 local API calls; largest statement 47 bindings |
| Estate engine | 12 groups, including ordinary-castle parity across clans and levels, exact time boundaries, stale authority, replay and staff transitions |
| Estate UI / bridge / map / sync | 21 / 8 / 7 / 10 scenarios passed |
| Existing staff base / Kyoto migration / court / regency / court offices / retired emperor / succession approval | 2,219 local API calls across seven suites, all passed |
| Existing branches / troop trades | 17 / 13 groups and 360 / 176 local API calls passed |
| Territory pricing / Kyoto engine / maintenance / court protection / rank rice / economy balance | 10 / 16 / 14 / 7 / 6 / 9 groups passed |
| Complete interface gate | `npm run test:interface` passed |
| Reproducible build and entry | `npm run build`, `npm run check:build`, `npm run test:entry` passed |
| Source/minified runtime parity | 77 public globals and 62 campaign, economic and battle checkpoints passed |
| Engine mirror and source hygiene | Browser and Worker engine files byte-identical; syntax checks and `git diff --check` passed |

Coverage includes resource and command shortages, level and queue limits, receipt replay, simultaneous actors, failed batches, stale writers and saves, all appointed offices, role-token replacement, offline intervals, a paused world, shared castle completion, facility separation, ordinary-to-Kyoto transitions, merit-driven office loss, bans, campaign replacement, and two populated migration fixtures with foreign-key and personal-state preservation.

The broad legacy `tests/test-engine.cjs` still fails after its first 18 passing cases in the existing operator-conquers-128-castles fixture. The identical failure was independently reproduced with the exact unchanged parent engine loaded in memory. The focused engine and economic suites above pass with the new implementation.

A synthetic browser fixture used the real estate module and server DTO without enabling writes. The initial desktop and 390px phone views were inspected. Final browser control became unavailable with a CDP focus-emulation timeout and a disconnected native accessibility provider, so final tablet and confirmation views are not claimed as verified. Independent source review found no synchronous render loop; the real server fixture passes the client sanitizer for all 65 actions, 64 facilities, the pending job and ordinary effects. Automated UI, synchronization and entry checks passed.

The entry payload measures **3,834,645 raw / 1,059,272 gzip bytes**, an increase of **50,688 / 13,759 bytes** over v5.19.0. The reviewed allowance is **3,836,000 raw / 1,060,000 gzip bytes**. No new dependency, image or audio asset is required.

## Packaging and publication

Release metadata and generated frontend bundles use `5.20.0` / `5.20.0-20261128`. The existing public API Site was published successfully as **version 100**, from source commit `4c38091116747260066ba9c3df157dd0223b2e4b`, with all 56 matching Worker modules, migration 0055 and its journal entry. Existing public audience, D1, R2 and runtime configuration are preserved.

The deployed `/api/v1/health` returned `ok:true`, `status:"ready"`, `version:"5.20.0"` and `features.courtEstate:true`. Frontend pull-request checks, the merge commit and GitHub Pages deployment are recorded by GitHub after these local checks. API publication alone does not establish frontend publication.
