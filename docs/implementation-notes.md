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
| 1 - TopologyTiers | completed | `feat/topology-tiers` | TBD | New `<TopologyTiers />` component + Layout.tsx default-branch swap |
| 2 - drill-in routing | completed | `feat/cluster-drill-in` | TBD | New `<ClusterDetailPage />` + `#/cluster/:id` route + `useDashboardData` hook extracted from `DashboardApp` |
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

### Phase 1

- Copied `RANK_ORDER` + `getClusterRank` logic into `TopologyTiers.tsx` rather than
  importing from `utils/dagreLayout.ts`. Phase 4 will delete `dagreLayout.ts` outright;
  duplicating the small map now keeps the new component standalone and avoids a future
  rename-or-move shuffle. The brief allowed either copy or re-export.
- Unknown cluster types bucket into a final "Other" lane (rank `999`) instead of being
  silently re-bucketed to `distribution` like the dagre layout did. Visible mis-typing
  beats invisible mis-categorization; we'd rather the operator notice a typo in
  `cluster_type` than wonder why a server is showing up under "distribution".
- Edge collapsing: multiple connections between the same two clusters render as a single
  line per pair. The worst status wins (`down > degraded > unknown > up`). Dense
  topologies would otherwise produce 6-12 overlapping lines per pair with the same
  endpoints; collapsing keeps the overlay readable. We lose the count of redundant
  links, but the user can still see all of them in the per-cluster drill-in (Phase 2).
- External links render as dedicated cards in a dedicated "External" lane pinned to the
  top of the page. The brief suggested a virtual "Internet" node; we generalized to
  one card per distinct external target label so multiple ISPs / IXes / clouds each
  get their own anchor. Edges to external cards use a dashed stroke to differentiate
  from intra-fabric links.
- Edges drawn with simple `<line>` elements (straight, card-center to card-center).
  No bezier routing, no anchor-edge attachment, no collision avoidance. The brief
  explicitly allowed line OR path; straight lines keep the SVG cheap and Phase 5
  can revisit if the visual overlap gets bad in real-world topology sizes.
- Single-click selects `cluster.devices[0]` (mirrors the legacy canvas behaviour so the
  sidebar shows something useful), double-click + Enter/Space call
  `openClusterDetail(cluster.id)`. The store action exists already; Phase 2 will wire
  it into hash routing.
- Card refs registered via a `useRef<Map>` keyed by cluster id, measured in a
  `useLayoutEffect`. Edge geometry is recomputed on topology change (memoed deps) and on
  container resize (ResizeObserver, falling back to a debounced `resize` listener for
  older browsers). NOT recomputed on every render - the brief specifically called this
  out.
- Tour anchor kept as `data-tour="topology-canvas"` on the same `<main>` element in
  Layout.tsx so the existing GuidedTour selector keeps working. Renaming would have
  required either touching GuidedTour.tsx (out of scope) or duplicating the attribute.
- `npm run lint` still broken (same Phase 0 root cause). `npx tsc --noEmit` and
  `npm run build` both pass clean on this branch.

### Phase 2

- `openClusterDetail` now performs hash navigation (`window.location.hash = `#/cluster/${id}``)
  in addition to setting the in-store `detailPanelClusterId` slot. Kept the slot write
  for backward compatibility with the `?legacy=1` canvas - the legacy sidebar still
  reads from it. Phase 4 will remove the slot when the canvas dies. `closeClusterDetail`
  symmetrically navigates back to `#/` when the current hash is a cluster route, so the
  legacy sidebar X button + escape handlers both route correctly.
- Extracted a `useDashboardData()` hook from `DashboardApp` so both the dashboard route
  and the new `ClusterDetailRoute` wrapper share topology + speedtest fetching plus the
  websocket subscription. Without this, opening `#/cluster/:id` after a hard refresh
  would render "Loading..." forever because nothing fetches topology on that route.
- `ClusterDetailPage` deliberately does NOT mount `<ReactFlowProvider>` (brief explicitly
  called this out - the detail page is plain HTML, no canvas). It does mount
  `<ToastContainer />` + `<CriticalOverlay />` so alerts still surface here. Skipped
  `<GuidedTourAutoStart />` - the tour anchors live on the tier view, not the detail
  page, so re-running it from here would land on stale selectors.
- Cluster-type variant routing (case-insensitive substring on `cluster.cluster_type`):
  - `proxmox` / `server` / `vm` -> stack `<ProxmoxPanel nodeName=device.display_name />`
    for each device with `proxmox_stats`; falls back to all devices if none have the
    stats block (so cluster_type wins over device flags for the dispatch decision).
    ProxmoxPanel self-fetches on a 30s interval; one panel per node.
  - `switch` / `access` / `distribution` -> render `<PortGrid>` for each switch device.
    Mirror header above each grid shows ports up/down from `switch_stats`. Falls back
    to all devices if none have `device_type === 'switch'`.
  - `firewall` -> inline summary card with `firewall_stats` (sessions / in / out)
    rather than the full `DeviceCard`. Brief allowed either; the inline summary keeps
    the firewall view scannable and avoids the sidebar-shaped close button (DeviceCard
    has a "clear selection" X that's meaningless here).
  - default -> `<DeviceCard>` per device. The DeviceCard close button clears
    `selectedDevice` in the store; harmless on this page because the sidebar isn't
    mounted, so the action is a no-op visually.
- Back-button behaviour: three paths, all hash-driven so the browser back button works
  automatically via `useHashRoute`:
  1. Top-left back arrow + "Back to topology" button -> `<a href="#/">`.
  2. Escape key -> `keydown` listener sets `window.location.hash = '#/'`.
  3. `useNocStore.closeClusterDetail()` -> same hash assignment, guards against
     wiping the hash from non-cluster routes.
- "Cluster not found" state shows when the topology is loaded but the id is missing.
  "Loading..." renders while topology is null (e.g. cold load + direct link to a
  cluster route).
- Status aggregation: cluster status = worst-of(device statuses). `down > degraded > up >
  unknown`. Matches the per-cluster status pill on the tier cards from Phase 1.
- Skipped the optional `Sidebar.tsx` widget promotion (NetworkSummary on the tier view).
  Out of scope for drill-in; can be revisited in Phase 5's robustness sweep if useful.
- `npm run lint` still broken (same Phase 0 root cause). `npx tsc --noEmit` and
  `npm run build` both pass clean on this branch.

## Open questions

(filled in if anything needs Solomon's input)
