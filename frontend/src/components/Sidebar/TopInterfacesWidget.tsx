import { useEffect, useState } from 'react'
import { apiClient } from '../../api/client'

interface TopInterface {
  device: string
  interface: string
  description: string | null
  in_mbps: number
  out_mbps: number
  total_mbps: number
  speed_mbps: number | null
  utilization_pct: number | null
}

type WidgetState = 'loading' | 'no_data' | 'ready' | 'error'

export default function TopInterfacesWidget() {
  const [interfaces, setInterfaces] = useState<TopInterface[]>([])
  const [state, setState] = useState<WidgetState>('loading')
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [expanded, setExpanded] = useState(true)

  const loadData = async () => {
    try {
      const response = await apiClient.get<TopInterface[]>('/topology/top-interfaces?limit=5')

      if (!response.data || response.data.length === 0) {
        setState('no_data')
      } else {
        setInterfaces(response.data)
        setState('ready')
        setLastUpdate(new Date())
      }
    } catch (err) {
      console.error('Failed to fetch top interfaces:', err)
      setState('error')
    }
  }

  // Fetch on mount and every 60 seconds
  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 60000)
    return () => clearInterval(interval)
  }, [])

  if (state === 'loading') {
    return (
      <div className="p-4 border-b border-border-primary">
        <div className="animate-pulse">
          <div className="h-4 bg-bg-tertiary rounded w-32 mb-2" />
          <div className="h-24 bg-bg-tertiary rounded w-full" />
        </div>
      </div>
    )
  }

  if (state === 'no_data') {
    return null
  }

  if (state === 'error') {
    return (
      <div className="p-4 border-b border-border-primary">
        <div className="flex items-center gap-2 mb-2">
          <ActivityIcon />
          <h3 className="text-sm font-semibold text-text-primary">Top Interfaces</h3>
        </div>
        <p className="text-sm text-status-red text-center py-2">Failed to load data</p>
        <button
          onClick={loadData}
          className="w-full py-2 text-sm bg-bg-tertiary hover:bg-bg-secondary text-text-primary rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    )
  }

  // Find max for bar scaling
  const maxTraffic = Math.max(...interfaces.map(i => i.total_mbps), 1)

  return (
    <div className="p-4 border-b border-border-primary">
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <ActivityIcon />
          <h3 className="text-sm font-semibold text-text-primary">Top Interfaces</h3>
        </div>
        <ChevronIcon expanded={expanded} />
      </div>

      {expanded && (
        <div className="mt-3">
          {interfaces.map((iface, index) => {
            const barWidth = (iface.total_mbps / maxTraffic) * 100
            const barColor = getBarColor(iface.utilization_pct)

            return (
              <div key={`${iface.device}-${iface.interface}`} className="pb-2 mb-2 border-b border-border-primary last:border-0 last:pb-0 last:mb-0">
                {/* Interface name, device, and total */}
                <div className="flex items-center justify-between text-xs mb-0.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-text-muted">{index + 1}.</span>
                    <span className="font-medium text-text-primary">
                      {iface.device}
                    </span>
                    <span className="text-text-secondary">
                      {iface.interface}
                    </span>
                  </div>
                  <span className="font-mono font-medium text-text-primary ml-2 whitespace-nowrap">
                    {formatMbps(iface.total_mbps)}
                  </span>
                </div>

                {/* Port description */}
                {iface.description && (
                  <div className="text-xs text-text-tertiary mb-1 ml-4 truncate">
                    {iface.description}
                  </div>
                )}

                {/* Traffic bar */}
                <div className="h-1.5 bg-bg-tertiary rounded-full overflow-hidden ml-4">
                  <div
                    className={`h-full ${barColor} transition-all duration-500`}
                    style={{ width: `${barWidth}%` }}
                  />
                </div>

                {/* In/Out breakdown */}
                <div className="flex justify-between text-xs text-text-tertiary mt-1 ml-4">
                  <span className="flex items-center gap-1">
                    <DownArrow />
                    {formatMbps(iface.in_mbps)}
                  </span>
                  <span className="flex items-center gap-1">
                    <UpArrow />
                    {formatMbps(iface.out_mbps)}
                  </span>
                  {iface.utilization_pct !== null && (
                    <span>{iface.utilization_pct}%</span>
                  )}
                </div>
              </div>
            )
          })}

          {/* Last update */}
          {lastUpdate && (
            <div className="text-xs text-text-tertiary text-center pt-2 border-t border-border-primary mt-3">
              Updated {formatTimeAgo(lastUpdate)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function formatMbps(mbps: number): string {
  if (mbps >= 1000) {
    return `${(mbps / 1000).toFixed(1)} Gbps`
  }
  return `${mbps.toFixed(1)} Mbps`
}

function getBarColor(utilization: number | null): string {
  if (utilization === null) return 'bg-accent-primary'
  if (utilization >= 80) return 'bg-status-red'
  if (utilization >= 50) return 'bg-status-yellow'
  return 'bg-status-green'
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime()
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)

  if (minutes > 0) return `${minutes}m ago`
  if (seconds > 10) return `${seconds}s ago`
  return 'just now'
}

function ActivityIcon() {
  return (
    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M13 10V3L4 14h7v7l9-11h-7z"
      />
    </svg>
  )
}

function DownArrow() {
  return (
    <svg className="w-3 h-3 text-status-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
    </svg>
  )
}

function UpArrow() {
  return (
    <svg className="w-3 h-3 text-accent-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
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
