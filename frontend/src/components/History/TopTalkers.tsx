import { useState } from 'react'
import { useHistoryStore } from '../../store/historyStore'

type SortKey = 'in_bps' | 'out_bps' | 'utilization'

function formatBps(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${bps} bps`
}

function utilizationColor(pct: number): string {
  if (pct >= 90) return 'text-status-red'
  if (pct >= 70) return 'text-status-amber'
  return 'text-status-green'
}

export default function TopTalkers() {
  const topTalkers = useHistoryStore((s) => s.topTalkers)
  const [sortKey, setSortKey] = useState<SortKey>('in_bps')
  const [sortAsc, setSortAsc] = useState(false)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc)
    } else {
      setSortKey(key)
      setSortAsc(false)
    }
  }

  const sorted = [...(topTalkers || [])].sort((a, b) => {
    const diff = (a[sortKey] || 0) - (b[sortKey] || 0)
    return sortAsc ? diff : -diff
  })

  const SortIcon = ({ active, asc }: { active: boolean; asc: boolean }) => (
    <svg
      className={`w-3 h-3 inline-block ml-0.5 ${active ? 'text-accent-cyan' : 'text-text-tertiary'}`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      {asc ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      )}
    </svg>
  )

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
      <h3 className="text-sm font-semibold text-text-primary mb-3">Top Talkers</h3>

      {sorted.length === 0 ? (
        <div className="flex items-center justify-center h-32 text-text-muted text-sm">
          No interface data available
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border-default">
                <th className="text-left py-2 px-2 text-text-muted font-medium">Device</th>
                <th className="text-left py-2 px-2 text-text-muted font-medium">Interface</th>
                <th
                  className="text-right py-2 px-2 text-text-muted font-medium cursor-pointer hover:text-text-secondary select-none"
                  onClick={() => handleSort('in_bps')}
                >
                  In <SortIcon active={sortKey === 'in_bps'} asc={sortAsc} />
                </th>
                <th
                  className="text-right py-2 px-2 text-text-muted font-medium cursor-pointer hover:text-text-secondary select-none"
                  onClick={() => handleSort('out_bps')}
                >
                  Out <SortIcon active={sortKey === 'out_bps'} asc={sortAsc} />
                </th>
                <th
                  className="text-right py-2 px-2 text-text-muted font-medium cursor-pointer hover:text-text-secondary select-none"
                  onClick={() => handleSort('utilization')}
                >
                  Util% <SortIcon active={sortKey === 'utilization'} asc={sortAsc} />
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 10).map((talker, i) => (
                <tr
                  key={`${talker.device_id}-${talker.interface_name}`}
                  className={`border-b border-border-muted/50 hover:bg-bg-tertiary/50 transition-colors ${
                    i % 2 === 0 ? '' : 'bg-bg-primary/30'
                  }`}
                >
                  <td className="py-1.5 px-2 text-text-secondary">{talker.device_id}</td>
                  <td className="py-1.5 px-2 text-text-primary font-mono">{talker.interface_name}</td>
                  <td className="py-1.5 px-2 text-right text-accent-cyan font-mono">
                    {formatBps(talker.in_bps)}
                  </td>
                  <td className="py-1.5 px-2 text-right text-accent-purple font-mono">
                    {formatBps(talker.out_bps)}
                  </td>
                  <td className={`py-1.5 px-2 text-right font-mono font-medium ${utilizationColor(talker.utilization)}`}>
                    {talker.utilization.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
