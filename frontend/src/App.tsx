import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Layout from './components/Layout/Layout'
import ToastContainer from './components/Alerts/ToastContainer'
import CriticalOverlay from './components/Alerts/CriticalOverlay'
import { GuidedTourAutoStart } from './components/GuidedTour'
import DocsPage from './pages/DocsPage'
import HistoryPage from './pages/HistoryPage'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import { useNocStore } from './store/nocStore'
import { useAuthStore } from './store/authStore'
import { useWebSocket } from './hooks/useWebSocket'
import { fetchTopology, fetchSpeedtest } from './api/endpoints'

// Debug helper - expose store methods to window for testing
// Usage in browser console:
//   window.watchtower.setDeviceDown('s0-1305')
//   window.watchtower.setDeviceUp('s0-1305')
//   window.watchtower.listDevices()
//   window.watchtower.setSpeedtestDown()    // Turn external links red
//   window.watchtower.setSpeedtestNormal()  // Turn external links green
if (typeof window !== 'undefined') {
  ;(window as unknown as { watchtower: unknown }).watchtower = {
    setDeviceDown: (deviceId: string) => {
      useNocStore.getState().updateDeviceStatus(deviceId, 'down')
      console.log(`Set ${deviceId} to DOWN`)
    },
    setDeviceUp: (deviceId: string) => {
      useNocStore.getState().updateDeviceStatus(deviceId, 'up')
      console.log(`Set ${deviceId} to UP`)
    },
    listDevices: () => {
      const topology = useNocStore.getState().topology
      if (topology) {
        Object.entries(topology.devices).forEach(([id, dev]) => {
          console.log(`${id}: ${dev.status}`)
        })
      }
    },
    getStore: () => useNocStore.getState(),
    setSpeedtestDown: () => {
      useNocStore.getState().setSpeedtestStatus('down')
      console.log('Speedtest status: DOWN (external links now red)')
    },
    setSpeedtestDegraded: () => {
      useNocStore.getState().setSpeedtestStatus('degraded')
      console.log('Speedtest status: DEGRADED (external links now yellow)')
    },
    setSpeedtestNormal: () => {
      useNocStore.getState().setSpeedtestStatus('normal')
      console.log('Speedtest status: NORMAL (external links now green)')
    },
  }
}

/** Simple hash-based router (no dependency needed) */
function useHashRoute(): string {
  const [route, setRoute] = useState(() => window.location.hash.replace('#', '') || '/')

  useEffect(() => {
    const handler = () => {
      setRoute(window.location.hash.replace('#', '') || '/')
    }
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  return route
}

function DashboardApp({ demoMode }: { demoMode: boolean }) {
  const setTopology = useNocStore((state) => state.setTopology)
  const setLoading = useNocStore((state) => state.setLoading)
  const setError = useNocStore((state) => state.setError)
  const setSpeedtestStatus = useNocStore((state) => state.setSpeedtestStatus)
  const setDemoMode = useNocStore((state) => state.setDemoMode)

  // Connect to WebSocket (no-op in demo mode)
  useWebSocket()

  useEffect(() => {
    setDemoMode(demoMode)

    async function loadData() {
      setLoading(true)
      try {
        const topology = await fetchTopology()
        setTopology(topology)

        // Load speedtest status for external link coloring
        const speedtest = await fetchSpeedtest()
        if (speedtest.indicator) {
          setSpeedtestStatus(speedtest.indicator)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load topology')
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [demoMode, setTopology, setLoading, setError, setSpeedtestStatus, setDemoMode])

  return (
    <ReactFlowProvider>
      <Layout />
      <ToastContainer />
      <CriticalOverlay />
      <GuidedTourAutoStart />
    </ReactFlowProvider>
  )
}

function App() {
  const route = useHashRoute()
  const [demoMode, setDemoMode] = useState(true)
  const [configLoaded, setConfigLoaded] = useState(false)

  const isAuthenticated = useAuthStore((state) => state.isAuthenticated)
  const initialSetupComplete = useAuthStore((state) => state.initialSetupComplete)
  const checkAuth = useAuthStore((state) => state.checkAuth)
  const clearInitialSetupFlag = useAuthStore((state) => state.clearInitialSetupFlag)
  const [showSetupToast, setShowSetupToast] = useState(false)

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  useEffect(() => {
    if (isAuthenticated && initialSetupComplete) {
      setShowSetupToast(true)
      const timer = window.setTimeout(() => {
        setShowSetupToast(false)
        clearInitialSetupFlag()
      }, 3000)

      return () => window.clearTimeout(timer)
    }
  }, [isAuthenticated, initialSetupComplete, clearInitialSetupFlag])

  useEffect(() => {
    async function loadConfig() {
      try {
        const response = await fetch('/api/config')
        if (response.ok) {
          const data: { demo_mode?: boolean } = await response.json()
          setDemoMode(Boolean(data.demo_mode))
        }
      } catch {
        // Default to demo mode if config request fails
        setDemoMode(true)
      } finally {
        setConfigLoaded(true)
      }
    }

    loadConfig()
  }, [])

  if (!configLoaded) {
    return (
      <div className="min-h-screen bg-bg-primary text-text-secondary flex items-center justify-center">
        Loading...
      </div>
    )
  }

  // Docs are public - render before auth gate
  if (route === '/docs' || route === 'docs') {
    return <DocsPage />
  }

  const loginRoute = route === '/login' || route === 'login'

  // Auth gate: require authentication for all protected routes in non-demo mode
  if (!demoMode && !isAuthenticated) {
    return <LoginPage showInitialSetupMessage={initialSetupComplete} />
  }

  // Redirect authenticated users away from login page to dashboard
  if (!demoMode && isAuthenticated && loginRoute) {
    window.location.hash = '#/'
    return null
  }

  // Protected routes (auth verified above in non-demo mode)
  if (route === '/history' || route === 'history') {
    return <HistoryPage />
  }

  if (route === '/settings' || route === 'settings') {
    return <SettingsPage />
  }

  return (
    <>
      {showSetupToast && (
        <div className="fixed top-4 right-4 z-50 rounded-lg border border-accent-cyan/40 bg-bg-secondary px-4 py-2 text-sm text-accent-cyan shadow-lg">
          Admin account configured.
        </div>
      )}
      <DashboardApp demoMode={demoMode} />
    </>
  )
}

export default App
