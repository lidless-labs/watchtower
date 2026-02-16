import type { Device } from '../../types/device'
import StatusDot from '../common/StatusDot'
import UtilizationBar from '../common/UtilizationBar'
import { PortGrid } from './PortGrid'
import ProxmoxPanel from './ProxmoxPanel'
import DeviceHistoryPanel from '../History/DeviceHistoryPanel'
import { useNocStore } from '../../store/nocStore'

interface DeviceCardProps {
  device: Device
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatBytes(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${bps} bps`
}

export default function DeviceCard({ device }: DeviceCardProps) {
  const clearSelection = useNocStore((state) => state.clearSelection)

  return (
    <div className="p-4">
      {/* Header with close button */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <StatusDot status={device.status} size="lg" pulse={device.status === 'down'} />
            <h2 className="text-lg font-semibold text-text-primary">
              {device.display_name}
            </h2>
          </div>
          {device.model && (
            <div className="text-sm text-text-secondary mt-1">{device.model}</div>
          )}
          {device.ip && (
            <div className="text-sm text-text-muted font-mono">{device.ip}</div>
          )}
        </div>
        <button
          onClick={clearSelection}
          className="p-1 hover:bg-bg-tertiary rounded transition-colors"
        >
          <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Status section */}
      <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Status</span>
          <span className="flex items-center gap-2">
            <StatusDot status={device.status} />
            <span className="capitalize">{device.status}</span>
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Uptime</span>
          <span>{formatUptime(device.stats.uptime)}</span>
        </div>
        {device.location && (
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Location</span>
            <span>{device.location}</span>
          </div>
        )}
      </div>

      {/* Resource utilization */}
      <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
          Resources
        </h3>
        <UtilizationBar label="CPU" value={device.stats.cpu} />
        <UtilizationBar label="Memory" value={device.stats.memory} />
        {device.stats.temperature && (
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Temperature</span>
            <span>{device.stats.temperature.toFixed(0)}°C</span>
          </div>
        )}
      </div>

      {/* Type-specific stats */}
      {device.switch_stats && (
        <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Switch Info
          </h3>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Ports</span>
            <span>
              <span className="text-status-green">{device.switch_stats.ports_up} up</span>
              {' / '}
              <span className="text-text-muted">{device.switch_stats.ports_down} down</span>
            </span>
          </div>
          {device.switch_stats.poe_budget_total && (
            <div className="flex justify-between text-sm">
              <span className="text-text-secondary">PoE Budget</span>
              <span>
                {device.switch_stats.poe_budget_used?.toFixed(0)}W / {device.switch_stats.poe_budget_total}W
              </span>
            </div>
          )}
        </div>
      )}

      {/* Port Grid for switches */}
      {device.device_type === 'switch' && device.interfaces.length > 0 && (
        <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Port Grid
          </h3>
          <PortGrid interfaces={device.interfaces} deviceName={device.model || device.display_name} />
        </div>
      )}

      {device.firewall_stats && (
        <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Firewall Info
          </h3>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Sessions</span>
            <span>{device.firewall_stats.sessions_active.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Throughput</span>
            <span>
              ↓ {formatBytes(device.firewall_stats.throughput_in)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary"></span>
            <span>
              ↑ {formatBytes(device.firewall_stats.throughput_out)}
            </span>
          </div>
        </div>
      )}

      {/* Proxmox Panel - Homarr style */}
      {device.proxmox_stats && (
        <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
          <ProxmoxPanel nodeName={device.display_name} />
        </div>
      )}

      {/* Historical Trends */}
      <div className="space-y-3 mb-4 pb-4 border-b border-border-default">
        <DeviceHistoryPanel deviceId={device.id} />
      </div>

      {/* Interfaces preview */}
      {device.interfaces.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Interfaces
          </h3>
          <div className="space-y-1">
            {device.interfaces.slice(0, 5).map((iface) => (
              <div
                key={iface.name}
                className="flex items-center justify-between text-sm py-1"
              >
                <div className="flex items-center gap-2">
                  <StatusDot status={iface.status} size="sm" />
                  <span className="font-mono text-xs">{iface.name}</span>
                </div>
                <span className="text-text-muted">
                  {iface.utilization.toFixed(0)}%
                </span>
              </div>
            ))}
            {device.interfaces.length > 5 && (
              <div className="text-xs text-text-muted">
                +{device.interfaces.length - 5} more interfaces
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
