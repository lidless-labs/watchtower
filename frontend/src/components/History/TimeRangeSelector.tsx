import { useHistoryStore, type TimeRange } from '../../store/historyStore'

const RANGES: { value: TimeRange; label: string }[] = [
  { value: '1h', label: '1H' },
  { value: '6h', label: '6H' },
  { value: '24h', label: '24H' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
]

export default function TimeRangeSelector() {
  const timeRange = useHistoryStore((s) => s.timeRange)
  const setTimeRange = useHistoryStore((s) => s.setTimeRange)

  return (
    <div className="flex items-center gap-1 bg-bg-tertiary rounded-lg p-1">
      {RANGES.map((r) => (
        <button
          key={r.value}
          onClick={() => setTimeRange(r.value)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all ${
            timeRange === r.value
              ? 'bg-accent-cyan/20 text-accent-cyan shadow-sm'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-secondary'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  )
}
