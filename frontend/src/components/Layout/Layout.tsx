import Header from './Header'
import Sidebar from './Sidebar'
import TopologyTiers from '../Topology/TopologyTiers'
import { useNocStore } from '../../store/nocStore'

export default function Layout() {
  const isLoading = useNocStore((state) => state.isLoading)
  const error = useNocStore((state) => state.error)
  const sidebarOpen = useNocStore((state) => state.sidebarOpen)
  const setSidebarOpen = useNocStore((state) => state.setSidebarOpen)

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg-primary">
        <div className="text-center">
          <div className="text-status-red text-xl mb-2">Connection Error</div>
          <div className="text-text-secondary">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-4 py-2 bg-bg-secondary border border-border-default rounded hover:bg-bg-tertiary transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-bg-primary">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        {/* Main topology area (tier swimlane view). Kept the
            `data-tour="topology-canvas"` attribute so the GuidedTour
            selector keeps matching - renaming would touch the tour
            config + any external docs that reference the selector. */}
        <main className="flex-1 relative" data-tour="topology-canvas">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-accent-cyan border-t-transparent rounded-full animate-spin" />
                <span className="text-text-secondary">Loading topology...</span>
              </div>
            </div>
          ) : (
            <TopologyTiers />
          )}
        </main>

        {/* Sidebar overlay for mobile */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        {sidebarOpen && (
          <aside className="fixed inset-y-0 right-0 z-50 w-80 md:relative md:inset-y-auto md:z-auto border-l border-border-default bg-bg-secondary flex-shrink-0 overflow-hidden">
            <Sidebar />
          </aside>
        )}
      </div>
    </div>
  )
}
