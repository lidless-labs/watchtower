# Static Hierarchy Redesign - Implementation Notes

Tracking decisions, deviations, and tradeoffs for the topology redesign + robustness work.
Living doc while phases 0-5 are in flight.

## Scope

Replace the per-user draggable React Flow canvas (`TopologyCanvas.tsx`, 978 lines) with a
static-across-all-users tier swimlane view plus per-cluster drill-in pages. Bundle with
backend issue #24 (websocket send_lock timeout).

## Architectural decisions

### Layout: tier swimlanes + drill-in (option 3)

- Top-level view groups clusters by their existing `RANK_ORDER` (defined in
  `frontend/src/utils/dagreLayout.ts`): cloud / ix / wan / campus / firewall / core /
  distribution / access / server / storage / wireless / ap. Each rank is a horizontal lane.
- No drag, no localStorage positions, no per-user state. Identical for every viewer.
- Edges drawn between lanes only as SVG; intra-lane edges are implied by adjacency.
- Double-click (or Enter when focused) on a cluster card navigates to a dedicated
  detail page that hosts the existing ProxmoxPanel / PortGrid / VMList components
  (promoted from sidebar widgets).

### Routing

- Existing pattern is a hand-rolled hash router in `App.tsx` (`useHashRoute`). Sticking
  with that - no react-router dependency. Hash routes after redesign:
  - `#/` - tier view (default)
  - `#/?legacy=1` - legacy React Flow canvas (Phase 0 escape hatch, deleted in Phase 4)
  - `#/cluster/:id` - cluster detail page
  - `#/login`, `#/docs`, `#/history`, `#/settings` - unchanged
- Cluster id pulled from `topology.clusters[].id` (backend-defined, stable).

### Backend: untouched by redesign

- The `/api/topology` shape (clusters / devices / connections / external_links) is
  consumed directly by the new tier view. No backend schema change required for the
  redesign. Phase 3 (websocket fix) is the only backend change in this work.

## Phase status

| Phase | Status | Branch | PR | Notes |
|-------|--------|--------|-----|-------|
| 0 - legacy flag | completed | `feat/topology-legacy-flag` | TBD | Layout.tsx only - App.tsx already had the route-side hash reader, no changes needed there |
| 1 - TopologyTiers | pending | - | - | New component, blocks Phase 2 |
| 2 - drill-in routing | pending | - | - | Reuses ProxmoxPanel/PortGrid/VMList |
| 3 - issue #24 fix | completed | `fix/websocket-send-lock-timeout` | TBD | Parallel with Phase 1, backend-only. Bounds `send_lock` acquire + `send_json`/`close` await with 5s timeout across `broadcast`, `_revalidate_once`, and `send_personal` |
| 4 - cleanup | pending | - | - | Deletes ~2000 lines of canvas code + 2 deps |
| 5 - robustness sweep | pending | - | - | Audit nocStore / polling / error boundaries |

## Deviations / tradeoffs

### Phase 0

- Kept the legacy flag parser scoped to `Layout.tsx` rather than extending the existing
  `useHashRoute()` in `App.tsx` to return the parsed query. Rationale: `useHashRoute` is
  consumed for top-level page routing (login/docs/settings/etc.) and returns a bare string.
  Widening its signature would touch every call site for a Phase 0 escape hatch. The
  duplication (one extra `useState` + `hashchange` listener) is intentional and cheap.
- Both branches of the conditional render `<TopologyCanvas />` today. Phase 1 will flip the
  default branch to `<TopologyTiers />`; that diff should be a single import + one JSX swap.
- `URLSearchParams.get('legacy') === '1'` only - we are not normalizing `'true'`, `''`, or
  presence-without-value. Phase 4 deletes the flag entirely so loose acceptance is wasted code.
- `npm run lint` is broken on `main` (eslint 8.57 errors out with "couldn't find a
  configuration file" - no `.eslintrc*` or `eslint.config.*` exists anywhere in the repo).
  Pre-existing breakage, not introduced by this PR. CI does not run lint (it runs
  `npx tsc --noEmit` directly), so type-safety remains gated. Verified `npx tsc --noEmit`
  and `npm run build` both pass clean on this branch. Filing a separate fix to restore
  the eslint config is out of scope for Phase 0.

### Phase 3 (issue #24)

- Symmetric 5s timeout applied to **three** paths, not the two the issue lists.
  `send_personal` also wraps its `send_lock` acquire and `send_json` in
  `asyncio.wait_for`. The issue only enumerated `broadcast` and `_revalidate_once`,
  but `send_personal` had the same lock-then-await structure: a stuck pong or
  greeting would hold `send_lock` indefinitely and serialize against the broader
  liveness guarantee broadcast and sweep now uphold. Patching only two of three
  call sites would leave a quieter version of the same bug.
- `_SEND_TIMEOUT_SECONDS = 5.0` is a module-level constant, not a ConnectionManager
  constructor parameter. Tests patch it via `monkeypatch.setattr` to keep the unit
  suite fast (0.1s timeout, 1.0s outer wait_for). A constructor knob was deferred
  because nothing in `main.py` or the lifespan setup customizes the manager today
  and adding a parameter for tests-only configurability would be cargo.
- On `send_json` timeout in broadcast, the recipient is appended to `disconnected`
  and dropped at the end of the loop via `_drop_websockets`. We do NOT attempt a
  separate `close()` on the stuck peer: the close frame would race the same
  wedged ASGI send channel that just timed out, so it serves no purpose. The peer
  will see a tcp-level reset when the lifespan tears the socket down.
- On `close()` timeout in the sweep, we only log. The victim is already gone from
  `_connections` (see ordering: `_drop_websockets` runs before the close loop),
  so the stuck close frame can no longer affect broadcast delivery. Retrying or
  scheduling a detached close task would add observability complexity for zero
  liveness gain.
- The existing `try/except (RuntimeError, WebSocketDisconnect)` paths around
  `send_json` were preserved nested inside the new `try/except asyncio.TimeoutError`
  block. Keeping them in the same scope makes the existing semantics
  (Starlette's close-after-send signals are peer-drops, not server bugs) unchanged.
- `asyncio.CancelledError` is allowed to propagate from `wait_for`. The outer
  `revalidate_loop` and `websocket_endpoint` are the cancellation owners; the
  per-call timeout layer must not swallow shutdown signals.

## Open questions

(filled in if anything needs Solomon's input)
