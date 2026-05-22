import { useEffect, useState } from 'react'
import Header from './Header'
import Sidebar from './Sidebar'
import TopologyCanvas from '../Canvas/TopologyCanvas'
import TopologyTiers from '../Topology/TopologyTiers'
import { useNocStore } from '../../store/nocStore'

/**
 * Read the `legacy=1` query flag from the current hash route.
 * Hash is shaped like `#/route?key=value`; split on `?` then parse with URLSearchParams.
 * Reactive via the `hashchange` event so toggling the URL bar updates the view live.
 */
function useLegacyTopologyFlag(): boolean {
  const read = () => {
    const hash = window.location.hash.replace(/^#/, '')
    const queryIndex = hash.indexOf('?')
    if (queryIndex === -1) return false
    const params = new URLSearchParams(hash.slice(queryIndex + 1))
    return params.get('legacy') === '1'
  }

  const [legacy, setLegacy] = useState<boolean>(read)

  useEffect(() => {
    const handler = () => setLegacy(read())
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return legacy
}

export default function Layout() {
  const isLoading = useNocStore((state) => state.isLoading)
  const error = useNocStore((state) => state.error)
  const sidebarOpen = useNocStore((state) => state.sidebarOpen)
  const setSidebarOpen = useNocStore((state) => state.setSidebarOpen)
  const legacyTopology = useLegacyTopologyFlag()

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
        {/* Main canvas area */}
        <main className="flex-1 relative" data-tour="topology-canvas">
          {isLoading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-accent-cyan border-t-transparent rounded-full animate-spin" />
                <span className="text-text-secondary">Loading topology...</span>
              </div>
            </div>
          ) : legacyTopology ? (
            // Legacy React Flow canvas, reachable via `#/?legacy=1`. Will be deleted in Phase 4.
            <TopologyCanvas />
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
