import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Server,
  Network,
  Shield,
  Wifi,
  Cloud,
  Globe,
  Building,
  HardDrive,
  Cpu,
  type LucideIcon,
} from 'lucide-react'

import { useNocStore } from '../../store/nocStore'
import StatusDot from '../common/StatusDot'
import type { Cluster, Topology } from '../../types/topology'
import type { Device, DeviceStatus } from '../../types/device'
import type { Connection, ConnectionStatus, ExternalLink } from '../../types/connection'

/**
 * Rank values for the tier swimlanes. Lower rank = higher on the page
 * (cloud at top, leaf servers/wireless at bottom). Mirrors the map used
 * by the legacy dagre layout (`utils/dagreLayout.ts`) so the new view
 * matches the muscle memory of the old one. We keep a local copy here
 * rather than re-exporting from dagreLayout.ts because Phase 4 will
 * delete that file entirely.
 */
const RANK_ORDER: Record<string, number> = {
  cloud: 0,
  ix: 1,
  wan: 2,
  campus: 3,
  firewall: 4,
  core: 5,
  distribution: 6,
  access: 6,
  server: 7,
  storage: 7,
  wireless: 8,
  ap: 8,
}

/**
 * Human-readable label for each rank bucket, shown at the top of every
 * lane. Falls back to "Other" for anything that doesn't pattern-match
 * a known cluster type (see `getClusterRank`).
 */
const RANK_LABEL: Record<number, string> = {
  0: 'Cloud',
  1: 'Internet Exchange',
  2: 'WAN',
  3: 'Campus',
  4: 'Firewall',
  5: 'Core',
  6: 'Distribution / Access',
  7: 'Servers / Storage',
  8: 'Wireless',
  999: 'Other',
}

const OTHER_RANK = 999

/**
 * Map cluster.cluster_type to a tier rank. Same logic as
 * `dagreLayout.getClusterRank` but returns OTHER_RANK instead of a
 * silent "distribution" default so unknown types are visible to the
 * reader (and to whoever is debugging the topology feed).
 */
function getClusterRank(cluster: Cluster): number {
  const type = cluster.cluster_type.toLowerCase()
  if (RANK_ORDER[type] !== undefined) return RANK_ORDER[type]
  if (type.includes('firewall') || type.includes('fw')) return RANK_ORDER.firewall
  if (type.includes('core')) return RANK_ORDER.core
  if (type.includes('distrib')) return RANK_ORDER.distribution
  if (type.includes('access') || type.includes('switch')) return RANK_ORDER.access
  if (type.includes('server') || type.includes('vm')) return RANK_ORDER.server
  if (type.includes('storage') || type.includes('nas') || type.includes('san'))
    return RANK_ORDER.storage
  if (type.includes('wireless') || type.includes('wifi') || type.includes('ap'))
    return RANK_ORDER.wireless
  return OTHER_RANK
}

/**
 * Backend currently emits a small fixed icon vocabulary
 * (`shield`/`switch`/`server`/`wifi`/`cloud` - see
 * backend/app/discovery/librenms_sync.py). Map those to lucide icons.
 * Anything unrecognized falls back to a generic Server icon.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  shield: Shield,
  switch: Network,
  server: Server,
  wifi: Wifi,
  cloud: Cloud,
  globe: Globe,
  building: Building,
  storage: HardDrive,
  cpu: Cpu,
}

function getIcon(name: string | undefined): LucideIcon {
  if (!name) return Server
  return ICON_MAP[name.toLowerCase()] ?? Server
}

// Hex colors mirror tailwind.config.js. Used inline for SVG strokes
// because the project doesn't define CSS variables for theme tokens.
const EDGE_COLOR: Record<ConnectionStatus, string> = {
  up: '#3fb950',
  degraded: '#d29922',
  down: '#f85149',
  unknown: '#484f58',
}

/**
 * Aggregate health rollup for a cluster card's StatusDot.
 * - any `down` device  -> down
 * - any `degraded` (and no down) -> degraded
 * - all `up` -> up
 * - otherwise -> unknown
 */
function aggregateStatus(devices: Device[]): DeviceStatus {
  if (devices.length === 0) return 'unknown'
  let anyDown = false
  let anyDegraded = false
  let anyUp = false
  for (const d of devices) {
    if (d.status === 'down') anyDown = true
    else if (d.status === 'degraded') anyDegraded = true
    else if (d.status === 'up') anyUp = true
  }
  if (anyDown) return 'down'
  if (anyDegraded) return 'degraded'
  if (anyUp) return 'up'
  return 'unknown'
}

interface ClusterEntry {
  cluster: Cluster
  devices: Device[]
  rank: number
  status: DeviceStatus
  upCount: number
  downCount: number
  degradedCount: number
}

interface TieredGroups {
  tiers: { rank: number; label: string; entries: ClusterEntry[] }[]
  byClusterId: Map<string, ClusterEntry>
}

/**
 * Bucket clusters by rank, build per-cluster status counts, and produce
 * a stable ordering. Empty tiers are dropped.
 */
function groupByTier(topology: Topology): TieredGroups {
  const buckets = new Map<number, ClusterEntry[]>()
  const byClusterId = new Map<string, ClusterEntry>()

  for (const cluster of topology.clusters) {
    const devices = cluster.device_ids
      .map((id) => topology.devices[id])
      .filter((d): d is Device => Boolean(d))
    const rank = getClusterRank(cluster)
    let upCount = 0
    let downCount = 0
    let degradedCount = 0
    for (const d of devices) {
      if (d.status === 'up') upCount++
      else if (d.status === 'down') downCount++
      else if (d.status === 'degraded') degradedCount++
    }
    const entry: ClusterEntry = {
      cluster,
      devices,
      rank,
      status: aggregateStatus(devices),
      upCount,
      downCount,
      degradedCount,
    }
    if (!buckets.has(rank)) buckets.set(rank, [])
    buckets.get(rank)!.push(entry)
    byClusterId.set(cluster.id, entry)
  }

  // Sort clusters within each tier alphabetically by name so the
  // ordering is deterministic across renders and reloads.
  for (const list of buckets.values()) {
    list.sort((a, b) => a.cluster.name.localeCompare(b.cluster.name))
  }

  const tiers = Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([rank, entries]) => ({
      rank,
      label: RANK_LABEL[rank] ?? 'Other',
      entries,
    }))

  return { tiers, byClusterId }
}

/**
 * One inter-tier edge to render. We collapse multiple connections
 * between the same cluster pair to a single line per status so the
 * SVG doesn't explode on dense topologies; the worst status wins.
 */
interface RenderEdge {
  sourceClusterId: string
  targetClusterId: string
  status: ConnectionStatus
  external?: boolean
}

const STATUS_PRIORITY: Record<ConnectionStatus, number> = {
  down: 3,
  degraded: 2,
  unknown: 1,
  up: 0,
}

function deviceClusterId(
  endpoint: Connection['source'] | Connection['target'],
  devices: Record<string, Device>
): string | null {
  if (!endpoint.device) return null
  return devices[endpoint.device]?.cluster_id ?? null
}

/**
 * Build the list of cross-tier edges plus any external links. Edges
 * within the same tier are intentionally dropped - the lane adjacency
 * already implies them.
 */
function buildEdges(
  topology: Topology,
  byClusterId: Map<string, ClusterEntry>
): { edges: RenderEdge[]; externalIds: string[] } {
  const collapsed = new Map<string, RenderEdge>()
  const externalIds = new Set<string>()

  const upsert = (key: string, candidate: RenderEdge) => {
    const existing = collapsed.get(key)
    if (
      !existing ||
      STATUS_PRIORITY[candidate.status] > STATUS_PRIORITY[existing.status]
    ) {
      collapsed.set(key, candidate)
    }
  }

  for (const conn of topology.connections) {
    const sourceCluster = deviceClusterId(conn.source, topology.devices)
    const targetCluster = deviceClusterId(conn.target, topology.devices)
    if (!sourceCluster || !targetCluster) continue
    const sEntry = byClusterId.get(sourceCluster)
    const tEntry = byClusterId.get(targetCluster)
    if (!sEntry || !tEntry) continue
    if (sEntry.rank === tEntry.rank) continue // intra-tier - skip
    // Sort the pair so we collapse A->B and B->A together.
    const [a, b] =
      sourceCluster < targetCluster
        ? [sourceCluster, targetCluster]
        : [targetCluster, sourceCluster]
    const key = `${a}|${b}`
    upsert(key, {
      sourceClusterId: a,
      targetClusterId: b,
      status: conn.status,
    })
  }

  for (const link of topology.external_links) {
    const sourceCluster = deviceClusterId(link.source, topology.devices)
    if (!sourceCluster) continue
    if (!byClusterId.has(sourceCluster)) continue
    const externalId = `__ext__:${link.target.label || link.target.type}`
    externalIds.add(externalId)
    const key = `${externalId}|${sourceCluster}`
    upsert(key, {
      sourceClusterId: externalId,
      targetClusterId: sourceCluster,
      status: link.status,
      external: true,
    })
  }

  return { edges: Array.from(collapsed.values()), externalIds: Array.from(externalIds) }
}

/**
 * Lucide icon picker for external endpoints, keyed by ExternalTarget.icon.
 */
function externalIconFor(linkIcon: ExternalLink['target']['icon']): LucideIcon {
  if (linkIcon === 'cloud') return Cloud
  if (linkIcon === 'globe') return Globe
  if (linkIcon === 'building') return Building
  return Cloud
}

interface ExternalCardSpec {
  id: string
  label: string
  icon: LucideIcon
}

function buildExternalCards(
  topology: Topology,
  externalIds: string[]
): ExternalCardSpec[] {
  const idSet = new Set(externalIds)
  const seen = new Map<string, ExternalCardSpec>()
  for (const link of topology.external_links) {
    const id = `__ext__:${link.target.label || link.target.type}`
    if (!idSet.has(id)) continue
    if (seen.has(id)) continue
    seen.set(id, {
      id,
      label: link.target.label || link.target.type,
      icon: externalIconFor(link.target.icon),
    })
  }
  return Array.from(seen.values())
}

interface ClusterCardProps {
  entry: ClusterEntry
  onSelect: (entry: ClusterEntry) => void
  onDrillIn: (entry: ClusterEntry) => void
  registerRef: (id: string, el: HTMLDivElement | null) => void
}

function ClusterCard({ entry, onSelect, onDrillIn, registerRef }: ClusterCardProps) {
  const Icon = getIcon(entry.cluster.icon)
  const total = entry.devices.length
  const downSummary =
    entry.downCount > 0
      ? `, ${entry.downCount} down`
      : entry.degradedCount > 0
        ? `, ${entry.degradedCount} degraded`
        : ''
  const deviceLabel =
    total === 1 ? '1 device' : `${total} devices`

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onDrillIn(entry)
    }
  }

  return (
    <div
      ref={(el) => registerRef(entry.cluster.id, el)}
      tabIndex={0}
      role="button"
      aria-label={`Cluster ${entry.cluster.name}`}
      onClick={() => onSelect(entry)}
      onDoubleClick={() => onDrillIn(entry)}
      onKeyDown={handleKeyDown}
      data-cluster-id={entry.cluster.id}
      className="bg-bg-secondary border border-border-default rounded-md p-3 min-w-[180px] max-w-[220px] cursor-pointer hover:border-accent-cyan transition-colors focus:outline-none focus:ring-2 focus:ring-accent-cyan"
    >
      <div className="flex items-start gap-2">
        <Icon className="w-5 h-5 text-accent-cyan flex-shrink-0 mt-0.5" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-text-primary text-sm font-medium truncate">
            {entry.cluster.name}
          </div>
          <div className="text-text-tertiary text-xs uppercase tracking-wide truncate">
            {entry.cluster.cluster_type}
          </div>
        </div>
        <StatusDot status={entry.status} size="md" pulse={entry.status === 'down'} />
      </div>
      <div className="mt-2 text-text-secondary text-xs">
        {deviceLabel}
        {downSummary}
      </div>
    </div>
  )
}

interface ExternalCardProps {
  spec: ExternalCardSpec
  registerRef: (id: string, el: HTMLDivElement | null) => void
}

function ExternalCard({ spec, registerRef }: ExternalCardProps) {
  const Icon = spec.icon
  return (
    <div
      ref={(el) => registerRef(spec.id, el)}
      data-cluster-id={spec.id}
      className="bg-bg-tertiary border border-border-default rounded-md p-3 min-w-[140px] flex items-center gap-2"
    >
      <Icon className="w-5 h-5 text-text-secondary flex-shrink-0" aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="text-text-primary text-sm font-medium truncate">{spec.label}</div>
        <div className="text-text-tertiary text-xs uppercase tracking-wide">External</div>
      </div>
    </div>
  )
}

interface EdgeGeometry extends RenderEdge {
  x1: number
  y1: number
  x2: number
  y2: number
}

export default function TopologyTiers() {
  const topology = useNocStore((state) => state.topology)
  const selectDevice = useNocStore((state) => state.selectDevice)
  const clearSelection = useNocStore((state) => state.clearSelection)

  const containerRef = useRef<HTMLDivElement | null>(null)
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [edgeGeometry, setEdgeGeometry] = useState<EdgeGeometry[]>([])
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  })

  const registerRef = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) {
      cardRefs.current.set(id, el)
    } else {
      cardRefs.current.delete(id)
    }
  }, [])

  // Tiered grouping + edge precomputation are cheap; memo so we don't
  // recompute on unrelated store changes (e.g. sidebar toggles).
  const grouped = useMemo<TieredGroups | null>(() => {
    if (!topology) return null
    return groupByTier(topology)
  }, [topology])

  const edgeData = useMemo(() => {
    if (!topology || !grouped) return { edges: [], externalIds: [] as string[] }
    return buildEdges(topology, grouped.byClusterId)
  }, [topology, grouped])

  const externalCards = useMemo(() => {
    if (!topology) return [] as ExternalCardSpec[]
    return buildExternalCards(topology, edgeData.externalIds)
  }, [topology, edgeData.externalIds])

  // Measure each card's center relative to the container and build the
  // edge geometry. Re-run when topology changes (different cards), when
  // the container resizes, and once on mount.
  const recomputeEdges = useCallback(() => {
    const container = containerRef.current
    if (!container) return
    const containerRect = container.getBoundingClientRect()
    setContainerSize({
      width: container.scrollWidth,
      height: container.scrollHeight,
    })
    const geo: EdgeGeometry[] = []
    for (const edge of edgeData.edges) {
      const sourceEl = cardRefs.current.get(edge.sourceClusterId)
      const targetEl = cardRefs.current.get(edge.targetClusterId)
      if (!sourceEl || !targetEl) continue
      const s = sourceEl.getBoundingClientRect()
      const t = targetEl.getBoundingClientRect()
      // Offsets need to factor in the container scroll position so
      // that lines stay attached to cards when the page is scrolled.
      const offsetX = -containerRect.left + container.scrollLeft
      const offsetY = -containerRect.top + container.scrollTop
      geo.push({
        ...edge,
        x1: s.left + s.width / 2 + offsetX,
        y1: s.top + s.height / 2 + offsetY,
        x2: t.left + t.width / 2 + offsetX,
        y2: t.top + t.height / 2 + offsetY,
      })
    }
    setEdgeGeometry(geo)
  }, [edgeData.edges])

  useLayoutEffect(() => {
    recomputeEdges()
  }, [recomputeEdges, grouped, externalCards])

  // Observe container resize so edges stay aligned with cards when
  // the window/sidebar dimensions change. Falls back to a resize
  // listener if ResizeObserver isn't available (older browsers).
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => recomputeEdges())
      ro.observe(container)
      return () => ro.disconnect()
    }
    let raf = 0
    const handler = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => recomputeEdges())
    }
    window.addEventListener('resize', handler)
    return () => {
      window.removeEventListener('resize', handler)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [recomputeEdges])

  const handleSelect = useCallback(
    (entry: ClusterEntry) => {
      // Mirror the legacy canvas behaviour: a single click selects the
      // first device in the cluster so the sidebar has something to
      // render. This is a deliberate hand-off to the existing
      // DeviceCard widget, not a long-term contract.
      const first = entry.devices[0]
      if (first) {
        selectDevice(first.id)
      } else {
        clearSelection()
      }
    },
    [selectDevice, clearSelection]
  )

  const handleDrillIn = useCallback((entry: ClusterEntry) => {
    // Phase 2: `openClusterDetail` now navigates to `#/cluster/:id`
    // (encodes the cluster id) in addition to setting the legacy
    // in-store slot. The detail page mounts and consumes the route.
    useNocStore.getState().openClusterDetail(entry.cluster.id)
  }, [])

  if (!topology || !grouped || grouped.tiers.length === 0) {
    return (
      <div className="min-h-full flex items-center justify-center bg-bg-primary">
        <div className="text-text-secondary text-sm">No topology data</div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="min-h-full bg-bg-primary overflow-auto relative"
    >
      {/* SVG overlay for cross-tier edges. position:absolute so it
          tracks the container's scrollable extent; pointer-events:none
          so it doesn't swallow clicks meant for the cards underneath. */}
      <svg
        className="absolute top-0 left-0 pointer-events-none"
        width={containerSize.width || '100%'}
        height={containerSize.height || '100%'}
        style={{ zIndex: 0 }}
        aria-hidden
      >
        {edgeGeometry.map((edge, i) => (
          <line
            key={`${edge.sourceClusterId}->${edge.targetClusterId}-${i}`}
            x1={edge.x1}
            y1={edge.y1}
            x2={edge.x2}
            y2={edge.y2}
            stroke={EDGE_COLOR[edge.status]}
            strokeWidth={edge.status === 'down' ? 2 : 1.5}
            strokeOpacity={0.65}
            strokeDasharray={edge.external ? '6 4' : undefined}
          />
        ))}
      </svg>

      <div className="relative px-6 py-6 space-y-6" style={{ zIndex: 1 }}>
        {externalCards.length > 0 && (
          <section className="border-b border-border-muted pb-6">
            <div className="text-text-tertiary text-xs uppercase tracking-wide mb-3">
              External
            </div>
            <div className="flex flex-wrap gap-3">
              {externalCards.map((spec) => (
                <ExternalCard key={spec.id} spec={spec} registerRef={registerRef} />
              ))}
            </div>
          </section>
        )}

        {grouped.tiers.map((tier, index) => (
          <section
            key={tier.rank}
            className={
              index < grouped.tiers.length - 1
                ? 'border-b border-border-muted pb-6'
                : undefined
            }
          >
            <div className="text-text-tertiary text-xs uppercase tracking-wide mb-3">
              {tier.label}
            </div>
            <div className="flex flex-wrap gap-3">
              {tier.entries.map((entry) => (
                <ClusterCard
                  key={entry.cluster.id}
                  entry={entry}
                  onSelect={handleSelect}
                  onDrillIn={handleDrillIn}
                  registerRef={registerRef}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
