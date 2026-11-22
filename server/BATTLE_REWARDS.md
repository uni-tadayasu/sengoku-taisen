# Battle advisers, event catalogue and shogunate records

Version 4.1.0 introduces a shared battle catalogue, per-battle event rewards,
and the server-owned shogunate achievement ledger in migration 0026.

## Canonical event design

`GET /api/v1/events/catalog` returns the available battle descriptors. New
`POST /api/v1/admin/events/generate` requests use
`{battleId,durationDays,requestId}`. The canonical ID fixes the event name and
scenario theme. The server rejects arbitrary or unknown names and IDs. A
previously committed legacy name-based request may be retried with its exact
original request ID and body to recover its receipt.

The catalogue contains 55 historical scenarios, all 129 game castles, and all
six roaming encounters. Historical names inspire game scenarios; the stages
and endings are game rules rather than claims about historical events.

Existing plans retain their enemies, points and milestone rewards. Plans made
from the new catalogue also award gold, rice, wood, stone and magatama for each
battle. Victory rewards grow by stage; defeats pay a smaller amount. The engine
applies the 100,000,000 cap, and the receipt distinguishes offered and actually
credited rewards. Commands, resource credits, points, milestone mail and the
request receipt commit atomically. Retries never credit them twice.

## Military advisers

The engine exposes pure `adviseBattle` for CPU castles, local branches and
roaming encounters. It compares all legal tactics and troop counts using the
existing previews. `getUnificationProof` recomputes the role-specific eligible
castle set and ownership without trusting a saved `won` flag.

Events return exact five-tactic comparisons in `progress.advisers`, using the
same power function as battle resolution. Other frontend adapters cover PvP,
online branches, covert counterattacks, alliance rallies and shared conquest.
Public-field estimates are explicitly estimates. Applying advice only changes
the existing inputs; execution retains the existing confirmation, authorization,
clock, lease, revision, command, resource and request-receipt checks.

## Shogunate rights and opening

Rights are stored in `shogunate_rights`, outside player-save imports, unique by
user, source type and source ID. Opening is stored in `shogunate_requests` with
one receipt per right and an actor/request-ID idempotency key.

Sources:

- Event: the Sekigahara, Odawara or Osaka summer scenario, wins in all three
  required stages, and points at the last milestone. SQL proves all wins from
  that actor's receipts for that event and reads the committed participant total.
- Campaign: all role-eligible castles in the accepted campaign save. The proof
  is rechecked against that exact committed campaign and cycle. Campaign
  ownership continues to use the game's existing validated-save authority model.
- Shared conquest: full ownership of every game castle by one guild, during
  an admitted successful capture. Each participant with at least one action,
  still belonging to the guild at that instant, receives a right. Rank alone
  does not establish unification.

`GET /api/v1/shogunate` returns personal rights, the latest opened government,
and current campaign ownership progress. `POST /api/v1/shogunate/open` takes
`{rightId,requestId}` and records a clan-named government and the personal title
征夷大将軍. It grants no admin, staff, court or other access permissions. Rights
and established governments survive older-save imports and campaign resets.

## Verification

Use `scripts/test-event-planner.mjs`, `scripts/test-events.mjs`,
`scripts/test-shogunate.mjs` and the existing synchronization, cycle, conquest,
identity and battle transaction suites. Frontend tests include the pure adviser,
event selection/transport/bridge and shogunate confirmation/retry behavior.
Deploy migration 0026 with the bundled worker. `/health` must report 4.1.0 and
`battleAdviser`, `battleCatalog`, `eventBattleRewards` and `shogunate` features.
