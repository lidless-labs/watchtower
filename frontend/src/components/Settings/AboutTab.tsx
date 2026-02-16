import { useEffect } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'

function StatusIndicator({ label, configured, connected, details }: {
  label: string; configured: boolean; connected: boolean; details?: string
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-bg-primary">
      <span className="text-sm text-text-secondary">{label}</span>
      <div className="flex items-center gap-2">
        {details && <span className="text-xs text-text-muted">{details}</span>}
        <span className={`w-2 h-2 rounded-full ${
          !configured ? 'bg-text-tertiary' :
          connected ? 'bg-status-green' : 'bg-status-red'
        }`} />
        <span className="text-xs text-text-muted min-w-[80px] text-right">
          {!configured ? 'Not configured' : connected ? 'Connected' : 'Disconnected'}
        </span>
      </div>
    </div>
  )
}

export default function AboutTab() {
  const status = useSettingsApiStore((s) => s.status)
  const fetchStatus = useSettingsApiStore((s) => s.fetchStatus)

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">About Watchtower</h2>
        <p className="text-sm text-text-muted mt-1">System information and integration status.</p>
      </div>

      {/* Version info */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-3">System</h3>
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Version</span>
            <span className="text-text-primary font-mono">1.0.0</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Stack</span>
            <span className="text-text-muted">React 18 + FastAPI + InfluxDB</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Repository</span>
            <a href="https://github.com/solomonneas/watchtower" target="_blank" rel="noopener noreferrer"
              className="text-accent-cyan hover:underline text-xs font-mono">solomonneas/watchtower</a>
          </div>
        </div>
      </div>

      {/* Integration status */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Integration Status</h3>
          <button
            onClick={fetchStatus}
            className="text-xs text-text-muted hover:text-text-secondary transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>
        <div className="space-y-1.5">
          <StatusIndicator
            label="LibreNMS"
            configured={status?.librenms?.configured ?? false}
            connected={status?.librenms?.connected ?? false}
            details={status?.librenms?.last_poll ? `Last poll: ${new Date(status.librenms.last_poll).toLocaleTimeString()}` : undefined}
          />
          <StatusIndicator
            label="Proxmox VE"
            configured={status?.proxmox?.configured ?? false}
            connected={status?.proxmox?.connected ?? false}
            details={status?.proxmox?.instances ? `${status.proxmox.instances} instance(s)` : undefined}
          />
          <StatusIndicator
            label="InfluxDB"
            configured={status?.influxdb?.configured ?? false}
            connected={status?.influxdb?.connected ?? false}
            details={status?.influxdb?.error}
          />
          <StatusIndicator
            label="Redis"
            configured={true}
            connected={status?.redis?.connected ?? false}
          />
        </div>
      </div>

      {/* S³ branding */}
      <div className="text-center py-4">
        <div className="text-xs text-text-tertiary">
          <span className="font-medium">S³ Stack</span> · Solomon, Cubed · <a href="https://solomonneas.dev" target="_blank" rel="noopener noreferrer" className="text-accent-cyan hover:underline">solomonneas.dev</a>
        </div>
      </div>
    </div>
  )
}
