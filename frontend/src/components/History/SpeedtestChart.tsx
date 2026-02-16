import { useHistoryStore } from '../../store/historyStore'
import MetricChart from './MetricChart'

export default function SpeedtestChart() {
  const speedtestHistory = useHistoryStore((s) => s.speedtestHistory)

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-text-primary">Speedtest History</h3>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-accent-cyan" /> Download
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-accent-purple" /> Upload
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-status-amber" /> Ping
          </span>
        </div>
      </div>

      <MetricChart
        data={speedtestHistory || []}
        series={[
          { key: 'download_mbps', label: 'Download (Mbps)', color: '#39d5ff' },
          { key: 'upload_mbps', label: 'Upload (Mbps)', color: '#a855f7' },
        ]}
        height={200}
        yAxisLabel="Mbps"
        yAxisDomain={[0, 'auto']}
        formatValue={(v) => `${v.toFixed(0)}`}
        showLegend={false}
      />

      {/* Ping chart below (different scale) */}
      {speedtestHistory && speedtestHistory.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-text-muted mb-2">Latency</div>
          <MetricChart
            data={speedtestHistory}
            series={[
              { key: 'ping_ms', label: 'Ping (ms)', color: '#d29922' },
            ]}
            height={100}
            yAxisLabel="ms"
            yAxisDomain={[0, 'auto']}
            formatValue={(v) => `${v.toFixed(0)}ms`}
            showLegend={false}
          />
        </div>
      )}
    </div>
  )
}
