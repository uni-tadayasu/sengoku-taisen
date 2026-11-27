# Ver.5.15.0 — current court offices and ownership protection

## Behavior

Current external holders of 参議, 中納言, 大納言, 内大臣, 右大臣 and 左大臣 retain all of their owned castles after defeat. The fixed chancellor and current Kyoto court directory use the same ownership protection. Existing special-base rules continue to apply. Separately appointed regents and retired emperors do not gain this protection merely from those titles.

Protection comes from the effective database views, never saved badges, local flags or raw stale appointments. It covers major-city capture, ordinary-home lord succession, covert retaliation, CPU defeats and shared-clock catchup. Protected holdings can still be attacked, damaged and lose resources under the existing half-resource victory rule. Voluntary relocation and cycle settlement retain their existing behavior.

Every affected commit checks the current protection value. Appointment or dismissal while a march is in transit takes effect at arrival. A role change racing a write makes that stale transaction retry. Older clients cannot upload a CPU defeat that removes an established protected holding in the same campaign and cycle. Reconciliation does not replenish resources or turn enemy garrisons into friendly troops.

The authenticated sync DTO supplies `entitlements.courtProtected`. The engine stores this only in transient runtime authority. Same-save-revision changes update protection without replacing dirty local progress. Late responses, account switches, suspension and reconnection cannot regrant stale protection.

## Presentation

The six Kyoto merit offices carry `jurisdiction: "kyoto"` and show **正式官職** with a double border. External appointments carry `jurisdiction: "external"` and show **任命官職**. Both preserve the existing `kind: "official"` and office title. Unknown/older DTOs retain the previous title-only display. The chancellor, emperor, regent and retired emperor keep their distinct existing badges.

The common renderer updates maps, chat, profiles, alliances and self identity. Accessible names describe 京都御所の正式官職 or 太政大臣による任命官職. Same-title changes refresh the existing badge. Anonymous court replies remain anonymous. Public operational role labels are not introduced.

## Local verification

All scenarios below use synthetic local identities. No live player save was modified for testing.

| Suite | Result |
| --- | --- |
| `server/test-court-base-protection.mjs` | 18 scenarios / 282 local API requests |
| `server/test-field-capture.mjs` | 21 scenarios / 292 local API requests |
| `tests/test-court-protection-engine.cjs` | 7 scenarios |
| `tests/test-court-protection-sync.cjs` | 8 integration groups |
| Public court, court management, self identity and surface suites | 128 scenarios |
| Court offices, residency, alliance strategy, battle travel and relocation | Passed; largest checked statements used 92 bindings, below D1's 100-binding limit |
| Existing app/cloud/deputy/shared-base sync and edited bridge harnesses | Passed |
| `npm run build`, `npm run check:build`, `npm run test:entry` | Passed |
| Source/minified runtime parity | 75 globals and 62 campaign checkpoints passed |
| Responsive text and dialog geometry | 16 checks passed |

The actual badge renderer and stylesheet were opened in Chromium with 350px-wide fixture panels. All twelve office badges fit without text clipping, and the same-title external-to-Kyoto toggle updated the accessible and visible designation. This is a browser fixture check, not a claim of physical-device testing.

The initial entry measures 3,703,283 raw / 1,024,283 gzip bytes, an increase of 4,191 / 1,192 bytes over v5.14.0. The reviewed change adds no dependencies, images or audio. The bounded entry allowance is 3,705,000 raw / 1,025,000 gzip bytes.

## Release packaging

The browser and Worker share identical engine sources. Release metadata, service-worker identifiers and generated bundles use `5.15.0` / `5.15.0-20261128`. No database migration is required. GitHub workflow outcomes, the merge commit and the existing API Site deployment are recorded by their respective publication systems after these local checks.
