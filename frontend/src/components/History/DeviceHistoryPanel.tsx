import { useEffect, useState } from 'react'
import { useHistoryStore, type TimeRange } from '../../store/historyStore'
import MetricChart from './MetricChart'

interface DeviceHistoryPanelProps {
  deviceId: string
}

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
]

export default function DeviceHistoryPanel({ deviceId }: DeviceHistoryPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [localRange, setLocalRange] = useState<TimeRange>('24h')
  const fetchDeviceMetrics = useHistoryStore((s) => s.fetchDeviceMetrics)
  const deviceMetrics = useHistoryStore((s) => s.deviceMetrics[deviceId])

  useEffect(() => {
    if (expanded) {
      fetchDeviceMetrics(deviceId)
    }
  }, [expanded, deviceId, localRange, fetchDeviceMetrics])

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full group"
      >
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide group-hover:text-text-secondary transition-colors">
          Historical Trends
        </h3>
        <svg
          className={`w-4 h-4 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="space-y-3">
          {/* Local time range selector */}
          <div className="flex items-center gap-1">
            {RANGES.map((r) => (
              <button
                key={r.value}
                onClick={() => setLocalRange(r.value)}
                className={`px-2 py-1 text-[10px] font-semibold rounded transition-all ${
                  localRange === r.value
                    ? 'bg-accent-cyan/20 text-accent-cyan'
                    : 'text-text-muted hover:text-text-secondary bg-bg-tertiary'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>

          {!deviceMetrics ? (
            <div className="flex items-center justify-center h-20 text-text-muted text-xs">
              Loading...
            </div>
          ) : (
            <>
              {/* CPU & Memory */}
              {(deviceMetrics.cpu.length > 0 || deviceMetrics.memory.length > 0) && (
                <div>
                  <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wide">CPU & Memory</div>
                  <MetricChart
                    data={mergeTimeSeries(deviceMetrics.cpu, deviceMetrics.memory, 'cpu', 'memory')}
                    series={[
                      { key: 'cpu', label: 'CPU %', color: '#39d5ff' },
                      { key: 'memory', label: 'Mem %', color: '#a855f7' },
                    ]}
                    height={120}
                    yAxisDomain={[0, 100]}
                    formatValue={(v) => `${v.toFixed(0)}%`}
                    showLegend={false}
                  />
                </div>
              )}

              {/* Interfaces (top 3) */}
              {deviceMetrics.interfaces && Object.keys(deviceMetrics.interfaces).length > 0 && (
                <div>
                  <div className="text-[10px] text-text-muted mb-1 uppercase tracking-wide">Top Interfaces</div>
                  {Object.entries(deviceMetrics.interfaces).slice(0, 3).map(([name, points]) => (
                    <div key={name} className="mb-2">
                      <div className="text-[10px] text-text-secondary font-mono mb-0.5">{name}</div>
                      <MetricChart
                        data={points.map(p => ({ time: p.time, throughput: p.value }))}
                        series={[{ key: 'throughput', label: 'bps', color: '#2dd4bf' }]}
                        height={60}
                        formatValue={formatBps}
                        showLegend={false}
                      />
                    </div>
                  ))}
                </div>
              )}

              {deviceMetrics.cpu.length === 0 &&
               deviceMetrics.memory.length === 0 &&
               Object.keys(deviceMetrics.interfaces || {}).length === 0 && (
                <div className="text-xs text-text-muted text-center py-4">
                  No historical data available for this device
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

/** Merge two single-value time series into one multi-key series */
function mergeTimeSeries(
  a: { time: string; value: number }[],
  b: { time: string; value: number }[],
  keyA: string,
  keyB: string
): Record<string, string | number>[] {
  const map = new Map<string, Record<string, string | number>>()

  for (const pt of a) {
    map.set(pt.time, { time: pt.time, [keyA]: pt.value })
  }
  for (const pt of b) {
    const existing = map.get(pt.time) || { time: pt.time }
    existing[keyB] = pt.value
    map.set(pt.time, existing)
  }

  return Array.from(map.values()).sort(
    (x, y) => new Date(x.time as string).getTime() - new Date(y.time as string).getTime()
  )
}

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)}G`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)}M`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)}K`
  return `${bps.toFixed(0)}`
}
