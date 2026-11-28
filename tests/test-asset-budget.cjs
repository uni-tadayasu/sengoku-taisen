'use strict';
// Guard the actual shipped entry, including compression, against accidental
// growth. These byte budgets do not claim a device-specific loading time.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {gzipSync} = require('node:zlib');
const root = path.resolve(__dirname, '..');
const groups = require('../tools/game-entry.json');
const rows = Object.keys(groups).map(file => {
  const bytes = fs.readFileSync(path.join(root,file));
  return {file,bytes:bytes.length,gzipBytes:gzipSync(bytes).length};
});
const totalBytes = rows.reduce((sum,row)=>sum+row.bytes,0);
const totalGzipBytes = rows.reduce((sum,row)=>sum+row.gzipBytes,0);
// v5.6 adds formation comparison, multi-goal plans, the operations board,
// independent effects volume, aspect-preserving facility artwork, the cyber
// theme and locally hosted calligraphic font declarations.
// Allow their measured footprint explicitly while keeping a bounded entry;
// runtime work reductions are measured separately, not inferred from bytes.
// v5.6.2 adds exact variant font ranges, visible update discovery and the
// stronger cyber theme. Glyph files remain lazy and are measured separately
// in the font manifest. v5.7 adds the read-only defense ledger and scoped local
// plan persistence: 3,283,130 raw / 942,953 gzip bytes, +48,194 / +14,346 from
// v5.6.2. Keep modest headroom without treating byte size as loading latency.
// v5.9 adds direct operation/plan destinations, persistent reading position,
// construction blockers and confirmation-time preset validation. Measured:
// 3,309,958 raw / 950,478 gzip (+11,264 / +3,341 from v5.8.1).
// The watchlist, reserve planning and battle reports add 20,358 raw / 5,871
// gzip bytes to the v5.9.1 entry. The map's deferred payload is measured separately.
// v5.9.4 adds the luminous title/command surfaces and persistent FX controls.
// Measured against v5.9.3: +16,284 raw / +4,083 gzip. Hero images are separate
// responsive files; the smallest is 47,724 bytes and fits the offline art budget.
// v5.9.5 uses named-function-preserving minification and a compact officer
// roster. Keep the previous raw ceiling and tighten the shipped gzip ceiling.
// v5.9.12 synthesizes 21 scene-specific effects, routes intentional input
// and confirmed game results, and provides in-game audition controls. The
// entry adds 12,648 raw / 4,793 gzip bytes over v5.9.11 and no audio samples.
// v5.9.13 adds town phase switching and operator-only template launchers.
// The catalog and dialog are lazy. Measured entry delta: +3,772 raw / +1,464 gzip.
// v5.9.16 adds the shared candidate dialog and connects the individual editors.
// Lists use existing game catalogs and on-demand online lookups.
// v5.10 adds resumable server-owned summons, login-reward status, the paid
// reroll/choice interface, seasonal supporter catalog and operator payment/
// retention metrics. Final shipped bundles measure 3,475,095 raw / 967,511
// gzip bytes, up 74,760 / 20,640 from v5.9.17. Keep only 2,905 raw /
// 1,489 gzip bytes of headroom; the new
// SVG artwork is a separate lazy resource and is not hidden in this allowance.
// v5.10.1 adds shared BGM playback, the operator controls and revision-aware
// public configuration polling. Measured: 3,498,292 raw / 973,909 gzip bytes,
// +23,197 / +6,398 from v5.10.0. Keep 2,708 raw / 1,391 gzip bytes of headroom.
// The supplied MP3 is fetched on demand, outside these initial bundles.
// v5.11 adds imperial approvals, succession/regency controls and the private
// court event workshop. Twenty presets and the planning AI stay on the Worker;
// the entry includes the reviewed draft interface and authorization handling.
// Preserve a bounded footprint with less than 6 KB raw / 2 KB gzip headroom.
// v5.11.1 adds nomination, Chancellor certification/history, cancellation and
// identity-safe receipt recovery. Measured entry: 3,604,849 raw / 1,000,627 gzip,
// +19,564 / +4,364 from v5.11.0. Keep less than 5 KB raw / 2 KB gzip headroom.
// v5.12 adds distinct expulsion/reentry controls and the protected Kagoshima
// deputy role, including receipt recovery and canonical role-change sync.
// Measured entry: 3,640,347 raw / 1,009,482 gzip before the small legacy-home
// restoration fix (+35,498 raw / +8,855 gzip from v5.11.1). Keep less than
// 3 KB raw / 2 KB gzip headroom; no images, samples or new packages are added.
// v5.12.1 adds free-name selection to unban/readmission, preserves the exact
// name through lost-response receipts, and explains released names. Measured
// entry growth is 4,398 raw / 1,855 gzip bytes; no dependencies/assets added.
// Retain a tight allowance for this reviewed UI rather than an open-ended cap.
// v5.12.3 adds the deputy's all-100 commander, authenticated art routing,
// restoration and deployment controls. Measured entry: 3,656,797 raw /
// 1,014,785 gzip bytes, +8,867 / +2,438 from v5.12.2. Keep under 2.3 KB /
// 1.3 KB headroom. The three on-demand portrait resolutions are separate.
// v5.12.4 adds touch-tablet portrait detection and scoped reflow rules. The
// shipped entry is 3,670,170 raw / 1,016,759 gzip bytes (+13,373 / +1,974
// from v5.12.3), with no new images, fonts or dependencies. Retain less than
// 2 KB raw / 1.3 KB gzip headroom for this measured layout-only addition.
// v5.12.5 shares the tablet readability rules and adds landscape composition
// and screen-aware orientation detection. Measured: 3,680,208 raw / 1,017,724
// gzip bytes (+10,038 / +965 from v5.12.4), without new assets/dependencies.
// Keep less than 2 KB raw / 1.3 KB gzip headroom for this measured addition.
// v5.13 adds the Kagoshima scene selector/preview and half-resource battle
// receipts across field and covert views. Measured entry: 3,688,804 raw /
// 1,020,551 gzip bytes (+8,596 / +2,827 from v5.12.5). Keep less than
// 2.2 KB raw / 1.5 KB gzip headroom. The responsive artwork is separate;
// its compact offline variants are covered by the release-asset budget.
// v5.13.2 adds completed castle growth labels, the phone action row and the
// current deputy crest. Measured against v5.13.1: +2,996 raw / +777 gzip
// (3,691,862 / 1,021,342). Retain the existing gzip ceiling and 2.1 KB raw
// headroom. The 3,282-byte SVG crest is a separate, lazy image.
// v5.13.3 adds a transient, deliberate operator-recovery entry and its
// dialog/account/file-read cancellation guards. Measured against v5.13.2:
// +4,191 raw / +1,016 gzip (3,696,053 / 1,022,358). Keep 1.9 KB raw / 642 gzip bytes of
// headroom; no dependencies, images or server code are added.
// v5.14 separates delegated operational access from personal role identity and
// neutralizes public role wording while retaining crests and portraits.
// Measured: 3,699,092 raw / 1,023,091 gzip bytes (+2,001 / +536 from
// v5.13.4), with no new runtime dependencies or media assets. Keep less than
// 2 KB raw / 1 KB gzip of measured headroom.
// v5.15 adds transient court ownership protection and formal/appointed office
// designations. Measured: 3,703,283 raw / 1,024,283 gzip, +4,191 / +1,192
// over v5.14. No runtime dependencies or media assets are added. Retain
// less than 1.8 KB raw / 0.8 KB gzip of headroom for this reviewed feature.
// v5.16 adds per-castle scene routing, target-owner appearance propagation,
// the castle selector and the tenth product. Measured: 3,724,434 raw /
// 1,030,119 gzip bytes, +21,151 / +5,836 over v5.15. The 128 responsive
// scenes remain on-demand images; they are not fetched as part of this entry.
// Retain less than 1.2 KB raw / 1 KB gzip headroom for the reviewed change.
// v5.17 adds per-device consent/status/test controls and safe message/court
// notification entry. Measured: 3,735,337 raw / 1,032,941 gzip bytes
// (+10,903 / +2,822 from v5.16), including deferred court navigation.
// Keep under 1.8 KB raw / 0.8 KB gzip headroom; no new media or dependencies.
// v5.18 adds observer-limited ambient decoration and its display-setting copy.
// Measured: 3,745,557 raw / 1,035,751 gzip (+10,220 / +2,810 from v5.17).
// No new images, fonts, libraries or animation-frame loop are introduced.
// Retain less than 1.7 KB raw / 0.9 KB gzip headroom for this reviewed addition.
// v5.19 adds the shogunate government: policies, public works, daily duties,
// renown, milestones and account-safe receipt recovery. Measured entry:
// 3,783,957 raw / 1,045,513 gzip bytes (+38,400 / +9,762 from v5.18),
// including compact phone/tablet layouts. No media or dependencies are added.
// Keep 1,043 raw / 687 gzip bytes of headroom for this reviewed feature.
// v5.20 adds court shared holdings, ordinary-castle economic projection with
// appointment windows, shared construction UI and save-proof recovery.
// Measured: 3,834,645 raw / 1,059,272 gzip (+50,688 / +13,759 from v5.19).
// No new media, font or runtime dependency. Keep 1,355 raw / 728 gzip headroom.
// v5.21 adds public-lord labels, identity-safe ownership reads, owner search
// and readable field cards. Measured: 3,855,799 raw / 1,064,565 gzip bytes,
// +21,154 / +5,293 over v5.20. No media, font or runtime dependency is added.
// Keep 1,701 raw / 935 gzip bytes of headroom for this reviewed feature.
// v5.22 reduces repeated runtime work and adds occupied-territory/viewer-court
// controls. Measured: 3,860,260 raw / 1,065,852 gzip bytes (+4,461 / +1,287
// from v5.21, about 0.12%). This is a runtime/response optimization, not an
// entry-download reduction. No new media, fonts or dependencies. Keep only
// 940 raw / 648 gzip bytes of headroom for the reviewed field controls.
// v5.23 adds reviewed Kyoto admission and receipt recovery, regional territory
// inheritance, shared ownership/attack controls and the six-item touch dock.
// Measured: 3,881,312 raw / 1,071,019 gzip bytes, +21,052 / +5,167 from v5.22
// (about 0.55% / 0.48%). No media, fonts or runtime dependencies are added.
// Keep 1,188 raw / 681 gzip bytes of headroom for this reviewed feature set.
// v5.23.1 pairs the desktop rail utilities on short windows, reveals the
// current destination in the rail and starts blocked BGM on a completed click.
// Measured: 3,882,543 raw / 1,071,169 gzip bytes, +1,231 / +150 from v5.23.0
// (about 0.03% / 0.01%). No media, fonts or runtime dependencies are added.
// Keep 957 raw / 631 gzip bytes of headroom for these reviewed fixes.
// v5.24 adds permanent regional protection, voluntary castle release, court
// families and negotiated vassalage, alongside a durable community inbox,
// stable reading/input positions and reduced synchronous click work.
// Measured: 3,991,852 raw / 1,099,812 gzip bytes (+109,309 / +28,643 from
// v5.23.1, about 2.82% / 2.67%). No media, fonts or runtime dependencies.
// Keep 148 raw / 1,188 gzip bytes of headroom for the reviewed changes.
// v5.25 adds 24 fixed-rank noble records, their verified exchange/recovery UI,
// the formal-member town shortcut, explicit formal-admission status and
// compact house-symbol metadata (the SVGs are fetched on demand).
// Measured: 4,083,435 raw / 1,114,221 gzip bytes (+91,583 / +14,409 from
// v5.24, about 2.29% / 1.31%). No fonts or runtime dependencies were added.
// The 24 independent WebP portraits are loaded only on visible cards and are
// separately bounded by test-court-noble-artwork.cjs, never entry preloads.
const rawBudget=4085000,gzipBudget=1115000;
assert(totalBytes <= rawBudget, `Initial bundles exceed the ${rawBudget} byte budget: ${totalBytes}`);
assert(totalGzipBytes <= gzipBudget, `Initial bundles exceed the ${gzipBudget} gzip byte budget: ${totalGzipBytes}`);
const html = fs.readFileSync(path.join(root,'index.html'),'utf8');
for (const file of Object.keys(groups)) assert(html.includes(file+'?v='), 'Budget must cover the shipped entry: '+file);
console.log(JSON.stringify({entryBundles:rows,totalBytes,totalGzipBytes,rawBudget,gzipBudget}));
