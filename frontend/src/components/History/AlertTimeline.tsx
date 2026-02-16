import { useMemo } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { useHistoryStore, type AlertEvent } from '../../store/historyStore'

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#f85149',
  warning: '#d29922',
  info: '#58a6ff',
  ok: '#3fb950',
}

function bucketAlerts(events: AlertEvent[], timeRange: string): Record<string, string | number>[] {
  if (!events || events.length === 0) return []

  // Determine bucket size based on range
  let bucketMs: number
  switch (timeRange) {
    case '1h': bucketMs = 5 * 60 * 1000; break    // 5 min
    case '6h': bucketMs = 30 * 60 * 1000; break   // 30 min
    case '24h': bucketMs = 60 * 60 * 1000; break  // 1 hour
    case '7d': bucketMs = 6 * 60 * 60 * 1000; break // 6 hours
    case '30d': bucketMs = 24 * 60 * 60 * 1000; break // 1 day
    default: bucketMs = 60 * 60 * 1000
  }

  const buckets = new Map<number, { critical: number; warning: number; info: number }>()

  for (const event of events) {
    const ts = new Date(event.time).getTime()
    const bucketKey = Math.floor(ts / bucketMs) * bucketMs

    if (!buckets.has(bucketKey)) {
      buckets.set(bucketKey, { critical: 0, warning: 0, info: 0 })
    }
    const b = buckets.get(bucketKey)!
    const sev = event.severity.toLowerCase()
    if (sev === 'critical') b.critical++
    else if (sev === 'warning') b.warning++
    else b.info++
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, counts]) => ({
      time: new Date(ts).toISOString(),
      critical: counts.critical,
      warning: counts.warning,
      info: counts.info,
      total: counts.critical + counts.warning + counts.info,
    }))
}

interface TooltipPayloadItem {
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadItem[]
  label?: string
}

function AlertTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const d = label ? new Date(label) : new Date()

  return (
    <div className="bg-bg-secondary border border-border-default rounded-lg px-3 py-2 shadow-xl">
      <div className="text-xs text-text-muted mb-1.5 font-mono">
        {d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
      {payload.filter(e => e.value > 0).map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-secondary capitalize">{entry.name}:</span>
          <span className="text-text-primary font-medium">{entry.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function AlertTimeline() {
  const alertTimeline = useHistoryStore((s) => s.alertTimeline)
  const timeRange = useHistoryStore((s) => s.timeRange)

  const bucketedData = useMemo(
    () => bucketAlerts(alertTimeline || [], timeRange),
    [alertTimeline, timeRange]
  )

  // Also build a flat list of recent events
  const recentEvents = useMemo(
    () => (alertTimeline || []).slice(-10).reverse(),
    [alertTimeline]
  )

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Alert Timeline</h3>

      {bucketedData.length === 0 ? (
        <div className="flex items-center justify-center h-40 text-text-muted text-sm">
          No alerts in this time range
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={bucketedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#30363d" strokeOpacity={0.5} />
            <XAxis
              dataKey="time"
              tick={{ fill: '#6e7681', fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#30363d' }}
              tickFormatter={(t) => {
                const d = new Date(t)
                return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
              }}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              tick={{ fill: '#6e7681', fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              width={32}
            />
            <Tooltip content={<AlertTooltip />} cursor={{ fill: '#21262d' }} />
            <Bar dataKey="critical" stackId="alerts" fill="#f85149" radius={[0, 0, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="warning" stackId="alerts" fill="#d29922" radius={[0, 0, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="info" stackId="alerts" fill="#58a6ff" radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      )}

      {/* Recent events list */}
      {recentEvents.length > 0 && (
        <div className="mt-3 space-y-1.5">
          <h4 className="text-xs font-semibold text-text-muted uppercase tracking-wide">
            Recent Events
          </h4>
          {recentEvents.map((evt, i) => (
            <div
              key={`${evt.time}-${evt.device_id}-${i}`}
              className="flex items-center gap-2 text-xs py-1 px-2 rounded bg-bg-primary"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: SEVERITY_COLORS[evt.severity] || '#6e7681' }}
              />
              <span className="text-text-muted font-mono w-14 flex-shrink-0">
                {new Date(evt.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="text-text-secondary truncate">{evt.hostname}</span>
              <span className="text-text-muted truncate flex-1">{evt.title}</span>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                evt.state === 'resolved'
                  ? 'bg-status-green/10 text-status-green'
                  : 'bg-status-red/10 text-status-red'
              }`}>
                {evt.state}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
