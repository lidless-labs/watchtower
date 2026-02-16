import { useHistoryStore } from '../../store/historyStore'
import MetricChart from './MetricChart'

export default function NetworkHealthChart() {
  const networkSummary = useHistoryStore((s) => s.networkSummary)

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Network Health</h3>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-green" /> Up
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-red" /> Down
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-amber" /> Alerts
          </span>
        </div>
      </div>
      <MetricChart
        data={networkSummary || []}
        series={[
          { key: 'devices_up', label: 'Up', color: '#3fb950' },
          { key: 'devices_down', label: 'Down', color: '#f85149' },
          { key: 'active_alerts', label: 'Alerts', color: '#d29922' },
        ]}
        height={220}
        yAxisDomain={[0, 'auto']}
        formatValue={(v) => Math.round(v).toString()}
        showLegend={false}
      />
    </div>
  )
}
