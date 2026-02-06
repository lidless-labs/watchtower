import { useNocStore } from '../../store/nocStore'
import { useAlertStore } from '../../store/alertStore'
import StatusDot from '../common/StatusDot'

export default function Header() {
  const topology = useNocStore((state) => state.topology)
  const sidebarOpen = useNocStore((state) => state.sidebarOpen)
  const setSidebarOpen = useNocStore((state) => state.setSidebarOpen)
  const alerts = useAlertStore((state) => state.alerts)

  const activeAlerts = alerts.filter((a) => a.status === 'active')
  const criticalCount = activeAlerts.filter((a) => a.severity === 'critical').length

  return (
    <header className="h-14 px-2 md:px-4 flex items-center justify-between border-b border-border-default bg-bg-secondary">
      {/* Logo and title */}
      <div className="flex items-center gap-2 md:gap-3">
        <div className="text-accent-cyan text-xl md:text-2xl font-bold tracking-tight">
          <span className="text-text-primary">WATCH</span>TOWER
        </div>
        <span className="bg-accent-purple/20 text-accent-purple text-xs px-2 py-1 rounded font-medium">
          DEMO
        </span>

        {/* GitHub link - hidden on mobile */}
        <a
          href="https://github.com/solomonneas/watchtower"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary transition-colors"
        >
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="w-4 h-4"
            aria-hidden="true"
          >
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          solomonneas
        </a>

        {/* Connection status - hidden on mobile */}
        <div className="hidden md:flex items-center gap-2 ml-4 text-sm text-text-secondary">
          <StatusDot status="up" />
          <span>Connected</span>
        </div>
      </div>

      {/* Stats and controls */}
      <div className="flex items-center gap-2 md:gap-6">
        {/* Quick stats */}
        {topology && (
          <div className="flex items-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <StatusDot status="up" />
              <span className="text-text-secondary">
                {topology.devices_up} up
              </span>
            </div>
            {topology.devices_down > 0 && (
              <div className="flex items-center gap-2">
                <StatusDot status="down" />
                <span className="text-status-red">
                  {topology.devices_down} down
                </span>
              </div>
            )}
          </div>
        )}

        {/* Alert bell */}
        <button className="relative p-2 hover:bg-bg-tertiary rounded-lg transition-colors">
          <svg
            className="w-5 h-5 text-text-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
            />
          </svg>
          {activeAlerts.length > 0 && (
            <span
              className={`absolute -top-1 -right-1 w-5 h-5 flex items-center justify-center text-xs font-bold rounded-full ${
                criticalCount > 0
                  ? 'bg-status-red text-white animate-pulse'
                  : 'bg-status-amber text-black'
              }`}
            >
              {activeAlerts.length}
            </span>
          )}
        </button>

        {/* Settings */}
        <button className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors">
          <svg
            className="w-5 h-5 text-text-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>

        {/* Sidebar toggle */}
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          <svg
            className="w-5 h-5 text-text-secondary"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            {sidebarOpen ? (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 5l7 7-7 7M5 5l7 7-7 7"
              />
            ) : (
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 19l-7-7 7-7m8 14l-7-7 7-7"
              />
            )}
          </svg>
        </button>
      </div>
    </header>
  )
}
