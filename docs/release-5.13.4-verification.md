# Ver.5.13.4 — public crest for ordinary-base players

## Scope

The shared public-identity renderer displays a dedicated `castle_lord` crest
between the lord avatar and player name. Its SVG uses a gold three-tier keep,
gold leaf ornaments, deep-red enamel and gemstone details. Ordinary-base
lords and retainers are eligible. The operator, current deputy, Kyoto staff,
actively banned players and players with a pending expulsion are excluded.

The server derives eligibility from committed membership in
`castle_residents` and `castle_seats`, restricted to the canonical ordinary
castle catalog. Local home/role flags, uploaded saves and paid appearances
cannot confer the crest. Ordinary-base court office holders remain eligible.
The existing six city honors, court titles and paid decorations retain their
contracts. Public profile viewers receive the same distinction with and
without a signed-in session.

The existing response projection supplies the crest to chat, public
profiles, household lists, online identities, field targets and other shared
identity surfaces. Role changes and membership loss remove or replace the
crest on the next accepted response. The frontend preserves response-order
guards and patches mounted badges without replacing input drafts or focus.
Voice identities continue to expose only their existing session IDs.

No database migration, save rewrite, privilege grant or combat change is
required. The D1 query keeps four compound SELECT terms in one statement and
three in the other, in the same atomic batch. Pagination remains at 80
identities, with at most 85 bindings per statement.

## Focused local verification

The following suites passed with synthetic identities and local in-memory
data:

| Command | Confirmed result |
| --- | --- |
| `node server/test-city-honors.mjs` | 14 scenarios, 185 local HTTP calls; maximum 85 bindings and four compound SELECT terms |
| `node server/test-public-identity.mjs` | 7 scenarios, 170 local HTTP calls |
| `node server/test-residency.mjs` | 13 scenarios, 138 local HTTP calls |
| `node server/test-deputy-operator.mjs` | 14 scenarios, 234 local HTTP calls |
| `node server/test-expulsion.mjs` | 14 scenarios, 207 local HTTP calls |
| `node server/test-evaluation.mjs` | 10 scenarios, 116 local HTTP calls, including a full 100-player page |
| `node server/test-world-cycles.mjs` | 19 checks, 87 local HTTP calls |
| `node tests/test-city-honors-ui.cjs` | 11 scenarios, including public-data-only issuance, avatar/crest/name order, scoped map visibility, coexistence and role-change refresh |
| `node tests/test-avatar-surfaces.cjs` / `test-avatar-registry.cjs` | 5 surface checks and 8 registry groups |
| `node tests/test-field.cjs` | 26 presentation and action-guard checks |
| `node tests/test-responsive-text.cjs` | 16 responsive text and dialog geometry checks |

Backend coverage includes ordinary lords and retainers across public
profiles, chat, online lists, household lists and field targets; stale
protected-role membership; revocation during response preparation;
future-dated membership; every ordinary castle; unknown/special castle
exclusion; pagination beyond 80 identities; and voice-session privacy.
Frontend coverage includes fixed artwork and accessible labels, rejection
of forged local flags and duplicate awards, delayed-response protection,
and preservation of drafts, focus and scroll position.

## Build and browser verification

The release metadata is synchronized to version `5.13.4` and release marker
`5.13.4-20261128`. `npm run build`, `npm run check:build`, the entry/offline
checks and source/minified runtime parity passed. The final entry is
3,697,091 raw bytes / 1,022,555 gzip bytes, within the existing unchanged
3,698,000 / 1,023,000 budgets. The crest is a separate lazy SVG; no runtime
dependency was added. The existing API Site builds successfully from 50
Worker modules, and its copied city-honor, evaluation and world-cycle suites
also passed before packaging.

The actual public-row renderer, avatar registry and shipped stylesheet were
opened in Chromium with synthetic identities. Desktop, 390px phone and
1024px landscape-tablet frames loaded all crest images. The phone and tablet
document scroll widths matched their viewport widths. A phone-only grid
keeps the portrait, crest and name together while moving troops/level
metadata below; long names wrap to the right of their crests. The map keeps
one primary crest in its small marker; full identity rows retain all city
medals. The fixture's appointment and return controls visibly replaced and
restored every mounted name badge through the real registry update path.

These are browser viewport checks, not tests on physical iOS/Android devices.
No live player account or game save was changed during verification.

## Publication

GitHub checks, GitHub Pages publication and deployment of the existing API
Site are recorded after completion. The local verification above does not
by itself establish production publication.
