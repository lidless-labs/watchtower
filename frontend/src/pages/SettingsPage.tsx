import { useEffect } from 'react'
import { useSettingsApiStore } from '../store/settingsApiStore'
import { useAuthStore } from '../store/authStore'
import IntegrationsTab from '../components/Settings/IntegrationsTab'
import PollingTab from '../components/Settings/PollingTab'
import AlertsTab from '../components/Settings/AlertsTab'
import NotificationsTab from '../components/Settings/NotificationsTab'
import SpeedtestTab from '../components/Settings/SpeedtestTab'
import DiscoveryTab from '../components/Settings/DiscoveryTab'
import UsersTab from '../components/Settings/UsersTab'
import AboutTab from '../components/Settings/AboutTab'

const tabs = [
  { id: 'integrations' as const, label: 'Integrations', icon: '🔌' },
  { id: 'polling' as const, label: 'Polling', icon: '⏱' },
  { id: 'alerts' as const, label: 'Alerts', icon: '🔔' },
  { id: 'notifications' as const, label: 'Notifications', icon: '📣' },
  { id: 'speedtest' as const, label: 'Speedtest', icon: '📶' },
  { id: 'discovery' as const, label: 'Discovery', icon: '🔍' },
  { id: 'users' as const, label: 'Users', icon: '👤' },
  { id: 'about' as const, label: 'About', icon: 'ℹ️' },
] as const

type TabId = typeof tabs[number]['id']

function TabContent({ tab }: { tab: TabId }) {
  switch (tab) {
    case 'integrations': return <IntegrationsTab />
    case 'polling': return <PollingTab />
    case 'alerts': return <AlertsTab />
    case 'notifications': return <NotificationsTab />
    case 'speedtest': return <SpeedtestTab />
    case 'discovery': return <DiscoveryTab />
    case 'users': return <UsersTab />
    case 'about': return <AboutTab />
  }
}

export default function SettingsPage() {
  const activeTab = useSettingsApiStore((s) => s.activeTab) as TabId
  const setActiveTab = useSettingsApiStore((s) => s.setActiveTab)
  const fetchSettings = useSettingsApiStore((s) => s.fetchSettings)
  const fetchStatus = useSettingsApiStore((s) => s.fetchStatus)
  const dirty = useSettingsApiStore((s) => s.dirty)
  const user = useAuthStore((s) => s.user)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  useEffect(() => {
    fetchSettings()
    fetchStatus()
  }, [fetchSettings, fetchStatus])

  if (!isAuthenticated || user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="text-status-red text-lg mb-2">Access Denied</div>
          <p className="text-text-secondary text-sm mb-4">Admin access required to view settings.</p>
          <a
            href="#/"
            className="text-accent-cyan hover:underline text-sm"
          >
            Back to Dashboard
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      {/* Header */}
      <header className="h-14 px-4 flex items-center justify-between border-b border-border-default bg-bg-secondary">
        <div className="flex items-center gap-3">
          <a
            href="#/"
            className="flex items-center gap-1.5 text-text-muted hover:text-text-primary transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span className="text-sm">Dashboard</span>
          </a>
          <span className="text-border-default">/</span>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h1 className="text-lg font-semibold">Settings</h1>
            <span className="text-[10px] text-text-tertiary font-medium tracking-widest uppercase border border-border-default rounded px-1.5 py-0.5">
              S³
            </span>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar tabs — desktop */}
        <nav className="hidden md:block w-56 border-r border-border-default bg-bg-secondary min-h-[calc(100vh-3.5rem)]">
          <div className="p-3 space-y-0.5">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id
              const isDirty = dirty[tab.id]
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors text-left ${
                    isActive
                      ? 'bg-accent-cyan/10 text-accent-cyan'
                      : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  }`}
                >
                  <span className="text-base w-5 text-center">{tab.icon}</span>
                  <span className="flex-1">{tab.label}</span>
                  {isDirty && (
                    <span className="w-1.5 h-1.5 rounded-full bg-status-amber" title="Unsaved changes" />
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Mobile tab bar */}
        <div className="md:hidden w-full border-b border-border-default bg-bg-secondary overflow-x-auto">
          <div className="flex px-2 py-1.5 gap-1 min-w-max">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-accent-cyan/10 text-accent-cyan'
                      : 'text-text-secondary hover:bg-bg-tertiary'
                  }`}
                >
                  <span>{tab.icon}</span>
                  <span>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Content area */}
        <main className="flex-1 p-6 max-w-4xl">
          <TabContent tab={activeTab} />
        </main>
      </div>
    </div>
  )
}
