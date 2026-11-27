# v5.12.5 — Tablet landscape layout

Date: 2026-11-28 (JST)

## Scope and behavior

- Apply the landscape composition only to touch-capable tablets with a layout viewport from 960 to 1920 CSS pixels wide and a device screen short side of at least 600 CSS pixels. When screen dimensions are unavailable, use the layout viewport's shorter side as the fallback. An attached mouse does not disable tablet detection.
- Keep portrait and landscape modes separate. Rename `tablet-portrait.css` to `tablet-layout.css` and share its readability, safe-gutter, and dialog rules without changing the portrait composition. Apply landscape-specific overrides from `tablet-landscape.css` afterward.
- Use device orientation independently of the visual viewport so opening the keyboard does not change the tablet's orientation mode. Re-evaluate the layout on rotation and viewport changes, and exclude landscape phones and mouse-only desktops.
- Keep interface text at its native size and reflow content using the available width. Give resource values enough room, arrange town artwork and commands in two panes, and use wider list and map compositions where space permits. At widths of 1440 CSS pixels and above, the calendar, balances, and actions share one header row.
- Keep long content accessible through normal document or dialog-body scrolling. Bound dialogs to the visible viewport while retaining access to their close controls and bottom actions. Preserve the existing social keyboard handling and portrait-tablet behavior.
- No gameplay, persistence-format, image, font, or dependency changes are included. The repository's `API_VERSION` is aligned to 5.12.5 for the existing release-consistency checks; this UI release does not require a Worker redeployment or change server behavior.

## Completed local verification

The following commands passed during development of the release candidate:

- `npm run build`
- `npm run check:build`
- `npm run test:entry`
- `npm run test:interface`
- `node tests/test-desktop-fit.cjs` — 40 cases, including tablet size boundaries, phone exclusion, attached pointers, orientation changes, and keyboard-related viewport changes.
- `node tests/test-responsive-text.cjs` — 12 cases.
- `node tests/test-social-viewport.cjs` — 9 cases.
- `node tests/test-town-fit.cjs` — 40 artwork and label geometries.
- `node tests/test-ui-continuity.cjs` — 14 cases.
- `node tests/test-minified-runtime.cjs` — 75 public globals and 62 campaign checkpoints.
- `node tests/test-asset-budget.cjs` — final generated entry fits both measured byte limits.

The full suites preceded the final small CSS refinement. The affected large-text facility layout, full-width castle statistics, final generated entry sizes, and build reproducibility were checked afterward. CI and production publication remain separate gates; neither is recorded as completed by this document.

## Managed browser checks

Checks used the managed Chrome browser through CUA with same-origin preview iframes. Touch capability, orientation, and viewport dimensions were simulated. The preview used isolated local fixture state and did not alter production player data.

### Main screen matrix

Town, facilities, officers, army, research, map, and council were checked at each of the following five landscape sizes: **35 screen/viewport cases in total**. None produced document horizontal scrolling.

| Viewport, CSS pixels | Result across all seven screens |
| --- | --- |
| 960 × 600 | Landscape tablet mode; no document horizontal overflow |
| 1024 × 768 | Landscape tablet mode; no document horizontal overflow |
| 1180 × 820 | Landscape tablet mode; no document horizontal overflow |
| 1366 × 1024 | Landscape tablet mode; no document horizontal overflow |
| 1920 × 1200 | Landscape tablet mode; no document horizontal overflow |

The resource value `100,000,000` remained on one line at all seven checked landscape sizes: 960 × 600, 1024 × 768, 1180 × 820, 1280 × 800, 1366 × 1024, 1440 × 900, and 1920 × 1200. The full header occupied one row at 1440px and 1920px widths.

At 1024 × 768 with the large-text preference, the town's facilities tab used two columns of approximately 219.8px. The checked cards' `scrollWidth` matched their `clientWidth`, confirming that their content did not overflow horizontally after the final CSS adjustment.

### Mode boundaries and input

| Scenario | Observed result |
| --- | --- |
| Landscape phones at 844 × 390, 932 × 430, and 1000 × 430 | Landscape tablet mode excluded |
| Touch tablets at 820 × 1180 and 1024 × 1366 | Existing portrait tablet mode retained |
| Mouse-only 1366 × 1024 viewport | Existing desktop mode retained |
| Simulated keyboard leaving a 960 × 300 visible viewport | Settings and navigation bodies remained scrollable; close controls and bottom actions stayed inside the visible frame |

These checks are browser simulations. Physical iPad/Safari and Android tablets, physical keyboards, device safe-area insets, and actual software-keyboard behavior have not been tested. The automated orientation and viewport cases supplement the managed-browser checks but do not replace physical-device testing.

## Final entry size

| Metric | v5.12.4 | v5.12.5 | Change |
| --- | ---: | ---: | ---: |
| Raw bundle bytes | 3,670,170 | 3,680,208 | +10,038 |
| Gzip bundle bytes | 1,016,759 | 1,017,724 | +965 |

The guard in `tests/test-asset-budget.cjs` allows 3,682,000 raw bytes and 1,019,000 gzip bytes. The final entry therefore has 1,792 raw bytes and 1,276 gzip bytes of headroom. These values cover the generated entry bundles and are not physical-device loading-time measurements.

## Publication status

Local implementation and the checks above are complete. GitHub CI and production frontend deployment are pending at the time this record was written. This document does not assert a successful production deployment or a new Worker deployment.
