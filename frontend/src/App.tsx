import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import Layout from './components/Layout/Layout'
import ToastContainer from './components/Alerts/ToastContainer'
import CriticalOverlay from './components/Alerts/CriticalOverlay'
import { GuidedTourAutoStart } from './components/GuidedTour'
import DocsPage from './pages/DocsPage'
import { useNocStore } from './store/nocStore'
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
  (window as unknown as { watchtower: unknown }).watchtower = {
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

function DashboardApp() {
  const setTopology = useNocStore((state) => state.setTopology)
  const setLoading = useNocStore((state) => state.setLoading)
  const setError = useNocStore((state) => state.setError)
  const setSpeedtestStatus = useNocStore((state) => state.setSpeedtestStatus)
  const setDemoMode = useNocStore((state) => state.setDemoMode)

  // Connect to WebSocket (no-op in demo mode)
  useWebSocket()

  useEffect(() => {
    // Static demo mode: always enabled
    setDemoMode(true)

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
  }, [setTopology, setLoading, setError, setSpeedtestStatus, setDemoMode])

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

  // Render docs page on #docs route
  if (route === '/docs' || route === 'docs') {
    return <DocsPage />
  }

  return <DashboardApp />
}

export default App
