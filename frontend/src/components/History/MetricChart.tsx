import { useMemo } from 'react'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'

interface Series {
  key: string
  label: string
  color: string
  type?: 'area' | 'line'
}

interface MetricChartProps {
  data: Record<string, string | number>[]
  series: Series[]
  height?: number
  yAxisLabel?: string
  yAxisDomain?: [number | string, number | string]
  formatValue?: (value: number) => string
  formatTime?: (time: string) => string
  stacked?: boolean
  showLegend?: boolean
}

function defaultFormatTime(iso: string): string {
  const d = new Date(iso)
  const hours = d.getHours().toString().padStart(2, '0')
  const mins = d.getMinutes().toString().padStart(2, '0')
  // Include date if range > 24h (heuristic: check if date differs from today)
  const now = new Date()
  if (d.toDateString() !== now.toDateString()) {
    return `${(d.getMonth() + 1)}/${d.getDate()} ${hours}:${mins}`
  }
  return `${hours}:${mins}`
}

function defaultFormatValue(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}G`
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toFixed(1)
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
  formatValue: (v: number) => string
}

function CustomTooltip({ active, payload, label, formatValue }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="bg-bg-secondary border border-border-default rounded-lg px-3 py-2 shadow-xl">
      <div className="text-xs text-text-muted mb-1.5 font-mono">
        {label ? defaultFormatTime(label) : ''}
      </div>
      {payload.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 text-sm">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-text-secondary">{entry.name}:</span>
          <span className="text-text-primary font-medium font-mono">
            {formatValue(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function MetricChart({
  data,
  series,
  height = 200,
  yAxisLabel,
  yAxisDomain,
  formatValue = defaultFormatValue,
  formatTime = defaultFormatTime,
  stacked = false,
  showLegend = true,
}: MetricChartProps) {
  const formattedData = useMemo(() => {
    if (!data || data.length === 0) return []
    return data.map((d) => ({
      ...d,
      _formattedTime: formatTime(d.time as string),
    }))
  }, [data, formatTime])

  if (!data || data.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-text-muted text-sm"
        style={{ height }}
      >
        No data available
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formattedData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={s.color} stopOpacity={0.3} />
              <stop offset="95%" stopColor={s.color} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#30363d" strokeOpacity={0.5} />
        <XAxis
          dataKey="_formattedTime"
          tick={{ fill: '#6e7681', fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: '#30363d' }}
          interval="preserveStartEnd"
          minTickGap={40}
        />
        <YAxis
          tick={{ fill: '#6e7681', fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={formatValue}
          domain={yAxisDomain}
          label={
            yAxisLabel
              ? { value: yAxisLabel, angle: -90, position: 'insideLeft', fill: '#6e7681', fontSize: 10 }
              : undefined
          }
          width={48}
        />
        <Tooltip
          content={<CustomTooltip formatValue={formatValue} />}
          cursor={{ stroke: '#39d5ff', strokeWidth: 1, strokeDasharray: '4 4' }}
        />
        {showLegend && (
          <Legend
            wrapperStyle={{ fontSize: 11, color: '#8b949e', paddingTop: 8 }}
            iconType="circle"
            iconSize={8}
          />
        )}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={1.5}
            fill={`url(#grad-${s.key})`}
            fillOpacity={1}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
            stackId={stacked ? 'stack' : undefined}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}
