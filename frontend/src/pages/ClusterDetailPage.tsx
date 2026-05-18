/**
 * ClusterDetailPage
 *
 * Phase 2 of the topology redesign. A dedicated full-width page for a
 * single cluster, reached via the `#/cluster/:id` hash route. The page
 * promotes existing sidebar widgets (ProxmoxPanel, PortGrid, DeviceCard)
 * from the right-rail panel into the main content area.
 *
 * Cluster-type routing (case-insensitive substring match on
 * `cluster.cluster_type`):
 *   - contains "proxmox" / "server" / "vm" -> ProxmoxPanel per node
 *   - contains "switch" / "access" / "distribution" -> PortGrid per
 *     switch device
 *   - contains "firewall" -> firewall device summary list
 *   - default -> DeviceCard list
 *
 * No right sidebar on this page; the tier view at `#/` still has one.
 */

import { useEffect, useMemo } from 'react'
import { useNocStore } from '../store/nocStore'
import type { Cluster } from '../types/topology'
import type { Device } from '../types/device'
import StatusDot from '../components/common/StatusDot'
import ProxmoxPanel from '../components/Sidebar/ProxmoxPanel'
import { PortGrid } from '../components/Sidebar/PortGrid'
import DeviceCard from '../components/Sidebar/DeviceCard'

interface ClusterDetailPageProps {
  clusterId: string
}

type AggregateStatus = 'up' | 'down' | 'degraded' | 'unknown'

/** Roll a set of device statuses up to a single cluster status. */
function aggregateStatus(devices: Device[]): AggregateStatus {
  if (devices.length === 0) return 'unknown'
  let hasDown = false
  let hasDegraded = false
  let hasUp = false
  for (const d of devices) {
    if (d.status === 'down') hasDown = true
    else if (d.status === 'degraded') hasDegraded = true
    else if (d.status === 'up') hasUp = true
  }
  if (hasDown) return 'down'
  if (hasDegraded) return 'degraded'
  if (hasUp) return 'up'
  return 'unknown'
}

/** Pick the rendering variant for a cluster based on its `cluster_type`. */
type Variant = 'proxmox' | 'switch' | 'firewall' | 'default'

function variantFor(clusterType: string): Variant {
  const t = clusterType.toLowerCase()
  if (t.includes('proxmox') || t.includes('server') || t.includes('vm')) {
    return 'proxmox'
  }
  if (t.includes('switch') || t.includes('access') || t.includes('distribution')) {
    return 'switch'
  }
  if (t.includes('firewall')) return 'firewall'
  return 'default'
}

function goBackToTopology() {
  if (typeof window !== 'undefined') {
    window.location.hash = '#/'
  }
}

export default function ClusterDetailPage({ clusterId }: ClusterDetailPageProps) {
  const topology = useNocStore((state) => state.topology)
  // Cold loads of `#/cluster/:id` can fail before topology ever lands
  // (backend down, network blip, 5xx). Without surfacing `error` /
  // `isLoading` we'd render "Loading..." forever because `topology`
  // stays null while `isLoading` flips false. Mirror the same error
  // shape used by `Layout.tsx` so the two pages feel consistent.
  const isLoading = useNocStore((state) => state.isLoading)
  const error = useNocStore((state) => state.error)

  // Escape key returns to the tier view, matching the back button.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        goBackToTopology()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const found = useMemo<{
    cluster: Cluster
    devices: Device[]
  } | null>(() => {
    if (!topology) return null
    const cluster = topology.clusters.find((c) => c.id === clusterId)
    if (!cluster) return null
    const devices = cluster.device_ids
      .map((id) => topology.devices[id])
      .filter((d): d is Device => Boolean(d))
    return { cluster, devices }
  }, [topology, clusterId])

  // No topology yet + still loading -> spinner-equivalent text. This
  // is the same observable behaviour as before for the happy path.
  if (!topology && isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary text-text-secondary text-sm">
        Loading topology...
      </div>
    )
  }

  // No topology + an error means the fetch failed. Surface the message
  // with a retry + back-to-topology escape hatch. Styling matches the
  // connection-error block in `Layout.tsx` so the two error states are
  // visually consistent.
  if (!topology && error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="text-center">
          <div className="text-status-red text-xl mb-2">Connection Error</div>
          <div className="text-text-secondary">{error}</div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-bg-secondary border border-border-default rounded hover:bg-bg-tertiary transition-colors text-text-secondary"
            >
              Retry
            </button>
            <a
              href="#/"
              className="px-4 py-2 bg-bg-secondary border border-border-default rounded hover:bg-bg-tertiary transition-colors text-text-secondary"
            >
              Back to topology
            </a>
          </div>
        </div>
      </div>
    )
  }

  // Topology loaded but the requested cluster isn't in it (deleted, bad
  // URL, stale link). This was the original `!topology` branch's job;
  // it now applies only when topology is present but lookup fails.
  if (!topology || !found) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-bg-primary text-text-secondary">
        <div className="text-lg">Cluster not found</div>
        <a
          href="#/"
          className="text-accent-cyan hover:underline text-sm"
        >
          Back to topology
        </a>
      </div>
    )
  }

  const { cluster, devices } = found
  const status = aggregateStatus(devices)
  const variant = variantFor(cluster.cluster_type)

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header bar - mirrors HistoryPage's pattern: brand + back arrow + page label */}
      <div className="sticky top-0 z-10 bg-bg-secondary border-b border-border-default px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a
              href="#/"
              className="text-text-muted hover:text-text-secondary transition-colors"
              title="Back to topology"
              aria-label="Back to topology"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </a>
            <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
              <span>
                <span className="text-text-primary">WATCH</span>
                <span className="text-accent-cyan">TOWER</span>
              </span>
              <span className="text-[10px] text-text-tertiary font-medium tracking-widest uppercase border border-border-default rounded px-1.5 py-0.5">
                S³
              </span>
              <span className="text-text-muted font-normal text-sm">Cluster</span>
            </h1>
          </div>

          <a
            href="#/"
            className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary bg-bg-tertiary hover:bg-bg-tertiary/80 rounded-md transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to topology
          </a>
        </div>
      </div>

      {/* Cluster header card */}
      <div className="max-w-7xl mx-auto px-4 pt-6">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-lg border border-border-default bg-bg-secondary px-5 py-4">
          <div className="min-w-0">
            <div className="text-2xl font-semibold text-text-primary truncate" title={cluster.name}>
              {cluster.name}
            </div>
            <div className="mt-1 text-xs uppercase tracking-wider text-text-tertiary">
              {cluster.cluster_type || 'unknown type'}
            </div>
          </div>
          <div className="flex flex-col items-end gap-1 text-sm">
            <div className="flex items-center gap-2">
              <StatusDot status={status} size="lg" pulse={status === 'down'} />
              <span className="capitalize text-text-secondary">{status}</span>
            </div>
            <div className="text-xs text-text-muted">
              {devices.length} {devices.length === 1 ? 'device' : 'devices'}
            </div>
          </div>
        </div>
      </div>

      {/* Cluster-type-specific content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <ClusterContent variant={variant} devices={devices} />
      </div>
    </div>
  )
}

function ClusterContent({
  variant,
  devices,
}: {
  variant: Variant
  devices: Device[]
}) {
  if (devices.length === 0) {
    return (
      <div className="rounded-lg border border-border-default bg-bg-secondary px-5 py-8 text-center text-sm text-text-muted">
        No devices in this cluster.
      </div>
    )
  }

  if (variant === 'proxmox') {
    // ProxmoxPanel expects a nodeName and self-fetches its own data
    // (refreshes every 30s). Render one panel per proxmox-capable
    // device in the cluster, stacked vertically.
    const proxmoxNodes = devices.filter((d) => d.proxmox_stats)
    const targets = proxmoxNodes.length > 0 ? proxmoxNodes : devices
    return (
      <div className="space-y-6">
        {targets.map((device) => (
          <section
            key={device.id}
            className="rounded-lg border border-border-default bg-bg-secondary p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={device.status} size="md" />
                <span className="text-base font-semibold text-text-primary">
                  {device.display_name}
                </span>
                {device.model && (
                  <span className="text-xs text-text-muted">{device.model}</span>
                )}
              </div>
              {device.ip && (
                <span className="font-mono text-xs text-text-muted">{device.ip}</span>
              )}
            </div>
            <ProxmoxPanel nodeName={device.display_name} />
          </section>
        ))}
      </div>
    )
  }

  if (variant === 'switch') {
    const switches = devices.filter(
      (d) => d.device_type === 'switch' || d.interfaces.length > 0
    )
    const targets = switches.length > 0 ? switches : devices
    return (
      <div className="space-y-6">
        {targets.map((device) => (
          <section
            key={device.id}
            className="rounded-lg border border-border-default bg-bg-secondary p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <StatusDot status={device.status} size="md" />
                <span className="text-base font-semibold text-text-primary">
                  {device.display_name}
                </span>
                {device.model && (
                  <span className="text-xs text-text-muted">{device.model}</span>
                )}
              </div>
              {device.switch_stats && (
                <div className="text-xs text-text-muted">
                  <span className="text-status-green">{device.switch_stats.ports_up} up</span>
                  {' / '}
                  <span>{device.switch_stats.ports_down} down</span>
                </div>
              )}
            </div>
            {device.interfaces.length > 0 ? (
              <PortGrid
                interfaces={device.interfaces}
                deviceName={device.model || device.display_name}
              />
            ) : (
              <div className="text-sm text-text-muted">No port data available.</div>
            )}
          </section>
        ))}
      </div>
    )
  }

  if (variant === 'firewall') {
    // Inline summary - keeps the firewall lane lightweight without
    // pulling the full DeviceCard (with its sidebar-style close button).
    return (
      <div className="space-y-4">
        {devices.map((device) => (
          <section
            key={device.id}
            className="rounded-lg border border-border-default bg-bg-secondary p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <StatusDot
                  status={device.status}
                  size="lg"
                  pulse={device.status === 'down'}
                />
                <div>
                  <div className="text-base font-semibold text-text-primary">
                    {device.display_name}
                  </div>
                  <div className="text-xs text-text-muted">
                    {device.model || device.device_type}
                    {device.ip ? ` - ${device.ip}` : ''}
                  </div>
                </div>
              </div>
              {device.firewall_stats && (
                <div className="grid grid-cols-3 gap-4 text-xs">
                  <div>
                    <div className="text-text-tertiary uppercase tracking-wide">
                      Sessions
                    </div>
                    <div className="text-text-primary font-mono">
                      {device.firewall_stats.sessions_active.toLocaleString()}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-tertiary uppercase tracking-wide">In</div>
                    <div className="text-text-primary font-mono">
                      {formatBps(device.firewall_stats.throughput_in)}
                    </div>
                  </div>
                  <div>
                    <div className="text-text-tertiary uppercase tracking-wide">Out</div>
                    <div className="text-text-primary font-mono">
                      {formatBps(device.firewall_stats.throughput_out)}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    )
  }

  // default: device card list (selectDevice keeps DeviceCard's close
  // button harmless - clearing selection just clears the legacy sidebar
  // slot, which is offscreen on this page).
  return (
    <div className="space-y-4">
      {devices.map((device) => (
        <div
          key={device.id}
          className="rounded-lg border border-border-default bg-bg-secondary"
        >
          <DeviceCard device={device} />
        </div>
      ))}
    </div>
  )
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${bps} bps`
}
