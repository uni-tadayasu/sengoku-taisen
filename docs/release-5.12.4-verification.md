# v5.12.4 — Tablet portrait layout

Date: 2026-11-28 (JST)

## Scope and behavior

- Apply the new composition only to touch-capable layout viewports from 600 to 1280 CSS pixels in portrait orientation. A connected mouse does not disable tablet detection.
- Prefer device orientation over visual viewport height so the on-screen keyboard does not switch a portrait tablet into a landscape layout. Remove the mode on rotation or when a split view becomes narrower than 600px.
- Keep text at its native size and use document scrolling. Separate the balances from the calendar and header actions; reflow the cards according to their actual container width and text size.
- Use the available width for the town, headings, controls, lists, and forms. Preserve town-art aspect ratio and the separate community dock slot.
- Bound modal geometry to the visible viewport, keeping the header and footer available while the body scrolls. Preserve the existing short-viewport fallback and social keyboard handling.
- All new CSS selectors require `html.sengoku-tablet-portrait`. No server behavior, gameplay, persistence format, image, font, or dependency changes are included. The repository's API version constant is aligned to 5.12.4 for its existing release-consistency checks; this UI release does not require a Worker redeployment.

## Local verification

Passed:

- `npm run check:build`
- `npm run test:entry`
- `npm run test:interface`
- `node tests/test-desktop-fit.cjs` — 32 cases, including portrait boundaries, mouse-equipped tablets, rotation, split view, keyboard focus/scroll preservation, legacy orientation, and cleanup.
- `node tests/test-responsive-text.cjs` — 12 cases.
- `node tests/test-social-viewport.cjs` — 9 cases.
- `node tests/test-ui-continuity.cjs` — 14 cases.
- `node tests/test-minified-runtime.cjs` — 75 public globals and 62 campaign checkpoints, including save continuity/corruption recovery.
- `node tests/test-asset-budget.cjs`
- `node server/test-profile-name.mjs` — 9 scenarios / 143 API calls.
- `node server/test-succession-approval.mjs` — 27 scenarios / 816 API calls.
- `git diff --check`

The complete interface/entry suites preceded the final small CSS refinements to mid-size balance alignment and the title descendant selector. The final generated bundle and build consistency were checked afterward.

The first CI pass identified the stale API version constant in the profile-name, succession-approval, and reward health assertions. The constant was updated without changing the assertions or server behavior.

## Browser checks

The managed Chrome preview used same-origin iframes at the following viewport sizes, with touch capability and orientation simulated. The fixture used isolated local state, blocked online API calls, and seeded long resource values (`100,000,000`); it did not update production player state.

| Viewport | Result |
| --- | --- |
| 600 × 960 | Portrait tablet layout; no document horizontal overflow |
| 768 × 1024 | Portrait tablet layout; no document horizontal overflow |
| 820 × 1180 | Portrait tablet layout; no document horizontal overflow |
| 834 × 1194 | Portrait tablet layout; no document horizontal overflow |
| 1024 × 1366 | Portrait tablet layout; no document horizontal overflow |
| 1280 × 1920 | Portrait tablet layout; no document horizontal overflow |
| 390 × 844 | Tablet mode inactive |
| 1180 × 820 | Tablet mode inactive |
| 1440 × 900, no touch | Existing desktop mode active; tablet mode inactive |

At 600, 820, and 1024px widths, town, facilities, officers, army, research, map, and council screens were checked for horizontal text/control overflow. Resource values stayed on one line with the “large” text preference. The final mid-size balance arrangement was also checked visually at 820px.

Settings dialogs were checked at 600 and 1024px; their header and footer stayed inside the visible frame and the body scrolled independently. The full navigation menu was checked at 600px, and the title composition at 820px.

These are browser viewport simulations, not physical iPad/Safari, Android tablet, safe-area, or on-screen keyboard tests. Keyboard/orientation logic is additionally covered by the unit tests listed above.

## Shipped entry size

| Metric | v5.12.3 | v5.12.4 | Change |
| --- | ---: | ---: | ---: |
| Raw bundle bytes | 3,656,797 | 3,670,170 | +13,373 |
| Gzip bundle bytes | 1,014,785 | 1,016,759 | +1,974 |

The asset guard allows 3,672,000 raw / 1,018,000 gzip bytes. This records the measured scoped CSS and viewport-controller growth while retaining less than 2 KB raw and 1.3 KB gzip headroom. Byte counts are not a device loading-time benchmark.
