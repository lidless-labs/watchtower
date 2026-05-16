import { useEffect, useState } from 'react'
import { fetchPortGroups } from '../../api/endpoints'
import { apiClient } from '../../api/client'
import type { PortGroupStats } from '../../api/endpoints'

type WidgetState = 'loading' | 'no_data' | 'ready' | 'error'

export default function PortGroupWidget() {
  const [groups, setGroups] = useState<PortGroupStats[]>([])
  const [state, setState] = useState<WidgetState>('loading')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [expanded, setExpanded] = useState(true)

  // Fetch port group stats
  const loadStats = async () => {
    try {
      const data = await fetchPortGroups()

      if (!data || data.length === 0) {
        setState('no_data')
      } else {
        setGroups(data)
        setState('ready')
        setLastUpdate(new Date())
      }
    } catch (err) {
      console.error('Failed to fetch port group stats:', err)
      setState('error')
    }
  }

  // Fetch on mount and every 60 seconds (matches interface polling)
  useEffect(() => {
    loadStats()
    const interval = setInterval(loadStats, 60000)
    return () => clearInterval(interval)
  }, [])

  // Status indicator color
  const statusColor = {
    ok: 'bg-status-green',
    warning: 'bg-status-yellow',
    critical: 'bg-status-red',
  }

  const statusGlow = {
    ok: '',
    warning: 'shadow-[0_0_8px_rgba(234,179,8,0.5)]',
    critical: 'shadow-[0_0_8px_rgba(239,68,68,0.5)]',
  }

  // Progress bar color
  const barColor = {
    ok: 'bg-status-green',
    warning: 'bg-status-yellow',
    critical: 'bg-status-red',
  }

  if (state === 'loading') {
    return (
      <div className="p-4 border-b border-border-primary">
        <div className="animate-pulse">
          <div className="h-4 bg-bg-tertiary rounded w-32 mb-2" />
          <div className="h-12 bg-bg-tertiary rounded w-full" />
        </div>
      </div>
    )
  }

  if (state === 'no_data') {
    return null // Don't show anything if no port groups configured
  }

  if (state === 'error') {
    return (
      <div className="p-4 border-b border-border-primary">
        <div className="flex items-center gap-2 mb-2">
          <NetworkIcon />
          <h3 className="text-sm font-semibold text-text-primary">Port Groups</h3>
        </div>
        <p className="text-sm text-status-red text-center py-2">Failed to load data</p>
        <button
          onClick={loadStats}
          className="w-full py-2 text-sm bg-bg-tertiary hover:bg-bg-secondary text-text-primary rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // Get combined status (worst status across all groups)
  const combinedStatus = groups.reduce((worst, group) => {
    if (group.status === 'critical') return 'critical'
    if (group.status === 'warning' && worst !== 'critical') return 'warning'
    return worst
  }, 'ok' as 'ok' | 'warning' | 'critical')

  return (
    <div className="p-4 border-b border-border-primary">
      {/* Collapsible Header */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <NetworkIcon />
          <h3 className="text-sm font-semibold text-text-primary">
            {groups.length === 1 ? groups[0].name : 'Port Groups'}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${statusColor[combinedStatus]} ${statusGlow[combinedStatus]}`} />
          <ChevronIcon expanded={expanded} />
        </div>
      </div>

      {expanded && (
        <div className="mt-3">
          {groups.map((group, index) => {
            // Calculate utilization percentage (based on critical threshold as 100%)
            const utilizationPct = Math.min(100, (group.total_mbps / group.thresholds.critical_mbps) * 100)

            return (
              <div key={group.name} className={index > 0 ? 'mt-4 pt-4 border-t border-border-primary' : ''}>
                {/* Group Header (only show if multiple groups) */}
                {groups.length > 1 && (
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-text-primary">{group.name}</h4>
                    <div className={`w-2 h-2 rounded-full ${statusColor[group.status]}`} />
                  </div>
                )}

                {/* Description */}
                {group.description && (
                  <p className="text-xs text-text-muted mb-2">{group.description}</p>
                )}

                {/* Traffic display */}
                <div className="grid grid-cols-2 gap-4 mb-2">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-lg font-bold text-text-primary">
                      <DownArrow />
                      {group.in_mbps.toFixed(1)}
                    </div>
                    <div className="text-xs text-text-muted">Mbps In</div>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-lg font-bold text-text-primary">
                      <UpArrow />
                      {group.out_mbps.toFixed(1)}
                    </div>
                    <div className="text-xs text-text-muted">Mbps Out</div>
                  </div>
                </div>

                {/* Utilization bar */}
                <div className="mb-2">
                  <div className="flex justify-between text-xs text-text-muted mb-1">
                    <span>Total: {group.total_mbps.toFixed(1)} Mbps</span>
                    <span>{utilizationPct.toFixed(0)}%</span>
                  </div>
                  <div className="h-2 bg-bg-tertiary rounded-full overflow-hidden">
                    <div
                      className={`h-full ${barColor[group.status]} transition-all duration-500`}
                      style={{ width: `${utilizationPct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-text-tertiary mt-1">
                    <span>0</span>
                    <span className="text-status-yellow">{group.thresholds.warning_mbps}</span>
                    <span className="text-status-red">{group.thresholds.critical_mbps}</span>
                  </div>
                </div>

                {/* Port count */}
                <div className="text-xs text-text-tertiary text-center">
                  {group.active_port_count} of {group.port_count} ports active
                </div>
              </div>
            )
          })}

          {/* Export buttons and last update */}
          <div className="mt-3 pt-2 border-t border-border-primary">
            <div className="flex flex-wrap gap-2 justify-center mb-2">
              {groups.map((group) => (
                <button
                  key={group.name}
                  onClick={() => handleExport(group.name)}
                  className="px-2 py-1 text-xs bg-bg-tertiary hover:bg-bg-secondary text-text-secondary rounded transition-colors flex items-center gap-1"
                  title={`Export ${group.name} traffic history`}
                >
                  <DownloadIcon />
                  {groups.length > 1 ? group.name : 'Export CSV'}
                </button>
              ))}
            </div>
            {lastUpdate && (
              <div className="text-xs text-text-tertiary text-center">
                Updated {formatTimeAgo(lastUpdate)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  async function handleExport(groupName: string) {
    try {
      // Fetch as text to use data URI (works on HTTP sites where blob downloads are blocked)
      const response = await apiClient.get(`/port-groups/export/${encodeURIComponent(groupName)}`, {
        responseType: 'text',
      })

      const filename = `${groupName.toLowerCase().replace(/ /g, '_')}_traffic.csv`
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(response.data)
      const link = document.createElement('a')
      link.href = dataUri
      link.setAttribute('download', filename)
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Failed to export CSV:', err)
      alert('Failed to export CSV. Please try again.')
    }
  }
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)

  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'just now'
}

function NetworkIcon() {
  return (
    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
      />
    </svg>
  )
}

function DownArrow() {
  return (
    <svg className="w-4 h-4 text-status-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  )
}

function UpArrow() {
  return (
    <svg className="w-4 h-4 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
    </svg>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`w-4 h-4 text-text-tertiary transition-transform ${expanded ? 'rotate-180' : ''}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}
