import { useCallback, useEffect, useState } from 'react'
import { fetchSpeedtest } from '../../api/endpoints'
import { apiClient } from '../../api/client'

interface SpeedtestResult {
  timestamp: string
  download_mbps: number
  upload_mbps: number
  ping_ms: number
  jitter_ms: number
  packet_loss_pct: number
  server_id: number
  server_name: string
  server_location: string
  result_url: string
  status: string
  indicator?: 'normal' | 'degraded' | 'down'
}

type WidgetState = 'loading' | 'no_data' | 'ready' | 'testing'

export default function SpeedtestWidget() {
  const [result, setResult] = useState<SpeedtestResult | null>(null)
  const [state, setState] = useState<WidgetState>('loading')
  const [cooldown, setCooldown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(true)

  // Fetch latest result on mount
  useEffect(() => {
    const loadResult = async () => {
      try {
        const data = await fetchSpeedtest()

        if (data.status === 'no_data') {
          setState('no_data')
        } else {
          setResult(data as unknown as SpeedtestResult)
          setState('ready')
        }
      } catch (err) {
        console.error('Failed to fetch speedtest result:', err)
        setState('no_data')
      }
    }

    loadResult()
  }, [])

  // Listen for WebSocket speedtest updates via custom event
  useEffect(() => {
    const handleSpeedtestUpdate = (event: CustomEvent<SpeedtestResult>) => {
      setResult(event.detail)
      setState('ready')
    }

    window.addEventListener('speedtest-update', handleSpeedtestUpdate as EventListener)

    return () => {
      window.removeEventListener('speedtest-update', handleSpeedtestUpdate as EventListener)
    }
  }, [])

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return

    const timer = setInterval(() => {
      setCooldown((prev) => Math.max(0, prev - 1))
    }, 1000)

    return () => clearInterval(timer)
  }, [cooldown])

  const triggerTest = useCallback(async () => {
    if (state === 'testing' || cooldown > 0) return

    setState('testing')
    setError(null)

    try {
      await apiClient.post('/speedtest/trigger')

      // Start cooldown
      setCooldown(60)

      // The result will come via WebSocket, but also poll after a delay
      setTimeout(async () => {
        try {
          const response = await apiClient.get('/speedtest')
          if (response.data.status !== 'no_data') {
            setResult(response.data)
            setState('ready')
          }
        } catch {
          // Ignore: WebSocket should have updated us
        }
      }, 30000) // Poll after 30s as backup
    } catch (err: unknown) {
      console.error('Failed to trigger speedtest:', err)
      // Check for rate limit
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { status?: number; data?: { detail?: string } } }
        if (axiosErr.response?.status === 429) {
          setError(axiosErr.response.data?.detail || 'Rate limited')
          setState('ready')
          return
        }
      }
      setError('Failed to start test')
      setState('ready')
    }
  }, [state, cooldown])

  // Export CSV
  const handleExport = useCallback(async () => {
    try {
      const response = await apiClient.get('/speedtest/export', {
        responseType: 'text',
      })
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(response.data)
      const link = document.createElement('a')
      link.href = dataUri
      link.setAttribute('download', 'speedtest_history.csv')
      document.body.appendChild(link)
      link.click()
      link.remove()
    } catch (err) {
      console.error('Failed to export CSV:', err)
      alert('Failed to export CSV. Please try again.')
    }
  }, [])

  // Format time ago
  const timeAgo = (timestamp: string): string => {
    const diff = Date.now() - new Date(timestamp).getTime()
    const minutes = Math.floor(diff / 60000)
    const hours = Math.floor(minutes / 60)

    if (hours > 0) return `${hours}h ${minutes % 60}m ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  // Status indicator color
  const indicatorColor = {
    normal: 'bg-status-green',
    degraded: 'bg-status-yellow',
    down: 'bg-status-red',
  }

  if (state === 'loading') {
    return (
      <div className="p-4 border-b border-border-primary">
        <div className="animate-pulse">
          <div className="h-4 bg-bg-tertiary rounded w-24 mb-2" />
          <div className="h-8 bg-bg-tertiary rounded w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 border-b border-border-primary">
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2">
          <GlobeIcon />
          <h3 className="text-sm font-semibold text-text-primary">Internet Speed</h3>
        </div>
        <div className="flex items-center gap-2">
          {result?.indicator && (
            <div className={`w-2.5 h-2.5 rounded-full ${indicatorColor[result.indicator]}`} />
          )}
          <ChevronIcon expanded={expanded} />
        </div>
      </div>

      {expanded && (
        <div className="mt-3">
          {state === 'no_data' ? (
            <div className="text-center py-4">
              <p className="text-sm text-text-muted mb-3">No speedtest data</p>
              <button
                onClick={triggerTest}
                className="px-4 py-2 text-sm bg-accent-primary hover:bg-accent-primary/80 text-white rounded-lg transition-colors"
              >
                Run Test
              </button>
            </div>
          ) : state === 'testing' ? (
            <div className="text-center py-4">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-2 border-accent-primary border-t-transparent mb-2" />
              <p className="text-sm text-text-muted">Running speedtest...</p>
            </div>
          ) : result ? (
            <>
              {/* Speed display */}
              <div className="grid grid-cols-2 gap-4 mb-3">
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-lg font-bold text-text-primary">
                    <DownArrow />
                    {result.download_mbps.toFixed(1)}
                  </div>
                  <div className="text-xs text-text-muted">Mbps Down</div>
                </div>
                <div className="text-center">
                  <div className="flex items-center justify-center gap-1 text-lg font-bold text-text-primary">
                    <UpArrow />
                    {result.upload_mbps.toFixed(1)}
                  </div>
                  <div className="text-xs text-text-muted">Mbps Up</div>
                </div>
              </div>

              {/* Ping & Jitter */}
              <div className="flex items-center justify-center gap-4 text-sm text-text-secondary mb-3">
                <span>{result.ping_ms.toFixed(1)}ms ping</span>
                <span className="text-text-muted">|</span>
                <span>{result.jitter_ms.toFixed(1)}ms jitter</span>
              </div>

              {/* Server info */}
              {result.server_name && (
                <div className="text-xs text-text-muted text-center mb-2">
                  {result.server_name}
                  {result.server_location && ` (${result.server_location})`}
                </div>
              )}

              {/* Last test time */}
              <div className="text-xs text-text-tertiary text-center mb-3">
                Last test: {timeAgo(result.timestamp)}
              </div>

              {/* Run test & Export buttons */}
              <div className="flex gap-2">
                <button
                  onClick={triggerTest}
                  disabled={cooldown > 0}
                  className={`flex-1 py-2 text-sm rounded-lg transition-colors ${
                    cooldown > 0
                      ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                      : 'bg-bg-tertiary hover:bg-bg-secondary text-text-primary'
                  }`}
                >
                  {cooldown > 0 ? `Wait ${cooldown}s` : 'Run Test'}
                </button>
                <button
                  onClick={handleExport}
                  className="px-3 py-2 text-sm bg-bg-tertiary hover:bg-bg-secondary text-text-primary rounded-lg transition-colors flex items-center"
                  title="Export CSV"
                >
                  <ExportIcon />
                </button>
              </div>

              {/* Error display */}
              {error && (
                <div className="mt-2 text-xs text-status-red text-center">{error}</div>
              )}

              {/* Result link */}
              {result.result_url && (
                <a
                  href={result.result_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-2 text-xs text-accent-primary hover:underline text-center"
                >
                  View detailed result
                </a>
              )}
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}

function GlobeIcon() {
  return (
    <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
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

function ExportIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
