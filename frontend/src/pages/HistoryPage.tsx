import { useEffect } from 'react'
import { useHistoryStore } from '../store/historyStore'
import TimeRangeSelector from '../components/History/TimeRangeSelector'
import NetworkHealthChart from '../components/History/NetworkHealthChart'
import AlertTimeline from '../components/History/AlertTimeline'
import TopTalkers from '../components/History/TopTalkers'
import SpeedtestChart from '../components/History/SpeedtestChart'

type TabType = 'overview' | 'alerts' | 'speedtest'

export default function HistoryPage() {
  const fetchAll = useHistoryStore((s) => s.fetchAll)
  const isLoading = useHistoryStore((s) => s.isLoading)
  const activeTab = useHistoryStore((s) => s.activeTab)
  const setActiveTab = useHistoryStore((s) => s.setActiveTab)

  useEffect(() => {
    fetchAll()
  }, [fetchAll])

  const tabs: { key: TabType; label: string; icon: JSX.Element }[] = [
    {
      key: 'overview',
      label: 'Overview',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
    },
    {
      key: 'alerts',
      label: 'Alerts',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      ),
    },
    {
      key: 'speedtest',
      label: 'Speedtest',
      icon: (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      ),
    },
  ]

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header bar */}
      <div className="sticky top-0 z-10 bg-bg-secondary border-b border-border-default px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a
              href="#/"
              className="text-text-muted hover:text-text-secondary transition-colors"
              title="Back to dashboard"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </a>
            <div>
              <h1 className="text-lg font-bold tracking-tight flex items-center gap-2">
                <span>
                  <span className="text-text-primary">WATCH</span>
                  <span className="text-accent-cyan">TOWER</span>
                </span>
                <span className="text-[10px] text-text-tertiary font-medium tracking-widest uppercase border border-border-default rounded px-1.5 py-0.5">
                  S³
                </span>
                <span className="text-text-muted font-normal text-sm">History</span>
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {isLoading && (
              <div className="flex items-center gap-2 text-xs text-text-muted">
                <div className="w-3 h-3 border-2 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
                Loading...
              </div>
            )}
            <TimeRangeSelector />
          </div>
        </div>
      </div>

      {/* Tab navigation */}
      <div className="bg-bg-secondary border-b border-border-default">
        <div className="max-w-7xl mx-auto px-4 flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-accent-cyan text-accent-cyan'
                  : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-default'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'alerts' && <AlertsTab />}
        {activeTab === 'speedtest' && <SpeedtestTab />}
      </div>
    </div>
  )
}

function OverviewTab() {
  return (
    <div className="space-y-6">
      {/* Network health + top talkers side by side on wide screens */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <NetworkHealthChart />
        <TopTalkers />
      </div>

      {/* Alert timeline full width */}
      <AlertTimeline />

      {/* Speedtest summary */}
      <SpeedtestChart />
    </div>
  )
}

function AlertsTab() {
  return (
    <div className="space-y-6">
      <AlertTimeline />
    </div>
  )
}

function SpeedtestTab() {
  return (
    <div className="space-y-6">
      <SpeedtestChart />
    </div>
  )
}
