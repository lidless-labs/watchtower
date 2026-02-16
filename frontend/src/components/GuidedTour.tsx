import { useEffect, useCallback, useState } from 'react'

/** Tour step definition */
interface TourStep {
  element: string
  popover: {
    title: string
    description: string
    position?: 'top' | 'bottom' | 'left' | 'right'
  }
}

/** driver.js global types for CDN-loaded library */
interface DriverInstance {
  highlight: (step: TourStep) => void
  moveNext: () => void
  movePrevious: () => void
  destroy: () => void
  isActive: () => boolean
  setSteps: (steps: TourStep[]) => void
  drive: (stepIndex?: number) => void
}

interface DriverConfig {
  showProgress?: boolean
  showButtons?: string[]
  steps?: TourStep[]
  animate?: boolean
  overlayColor?: string
  overlayOpacity?: number
  stagePadding?: number
  stageRadius?: number
  popoverClass?: string
  onDestroyStarted?: () => void
  onDestroyed?: () => void
}

declare global {
  interface Window {
    driver?: {
      js: {
        driver: (config: DriverConfig) => DriverInstance
      }
    }
  }
}

const TOUR_STORAGE_KEY = 'watchtower-tour-complete'

const TOUR_STEPS: TourStep[] = [
  {
    element: '[data-tour="topology-canvas"]',
    popover: {
      title: '🗺️ Topology Canvas',
      description:
        'This is your network topology view. Drag to pan, scroll to zoom, and click devices to inspect them. Toggle between L2 (physical) and L3 (VLAN) views.',
      position: 'bottom',
    },
  },
  {
    element: '[data-tour="device-node"]',
    popover: {
      title: '🖥️ Device Nodes',
      description:
        'Each node represents a network device — switches, firewalls, servers, and access points. The colored ring indicates status: green = up, red = down, yellow = degraded.',
      position: 'right',
    },
  },
  {
    element: '[data-tour="sidebar-device-card"]',
    popover: {
      title: '📋 Device Details',
      description:
        'Click any device to see its details here — model, IP, status, CPU/memory utilization, and interface statistics.',
      position: 'left',
    },
  },
  {
    element: '[data-tour="port-grid"]',
    popover: {
      title: '🔌 Port Grid',
      description:
        'The port grid mirrors a physical switch chassis. Each square is a port — color-coded by status and utilization. Click a port for detailed stats.',
      position: 'left',
    },
  },
  {
    element: '[data-tour="alert-bell"]',
    popover: {
      title: '🔔 Alert System',
      description:
        'Active alerts appear as toast notifications and on the bell icon. Critical alerts trigger a full-screen overlay to ensure visibility.',
      position: 'bottom',
    },
  },
  {
    element: '[data-tour="speedtest-widget"]',
    popover: {
      title: '⚡ Speedtest Widget',
      description:
        'Monitor internet connectivity with scheduled speed tests. Download/upload speeds and latency are tracked over time. External link colors reflect connection health.',
      position: 'left',
    },
  },
  {
    element: '[data-tour="network-summary"]',
    popover: {
      title: '📊 Network Summary',
      description:
        'A high-level overview of your entire network — device counts by type, cluster health, and Proxmox VM statistics.',
      position: 'left',
    },
  },
]

/** Check if driver.js is loaded from CDN */
function getDriverConstructor(): ((config: DriverConfig) => DriverInstance) | null {
  if (window.driver?.js?.driver) {
    return window.driver.js.driver
  }
  return null
}

/** Hook to manage guided tour state */
export function useGuidedTour() {
  const [isAvailable, setIsAvailable] = useState(false)
  const [hasCompleted, setHasCompleted] = useState(() => {
    return localStorage.getItem(TOUR_STORAGE_KEY) === 'true'
  })

  useEffect(() => {
    // Check if driver.js is loaded (poll briefly since CDN may be async)
    const checkDriver = () => {
      if (getDriverConstructor()) {
        setIsAvailable(true)
        return true
      }
      return false
    }

    if (!checkDriver()) {
      const interval = setInterval(() => {
        if (checkDriver()) {
          clearInterval(interval)
        }
      }, 500)

      // Stop checking after 10 seconds
      const timeout = setTimeout(() => clearInterval(interval), 10000)
      return () => {
        clearInterval(interval)
        clearTimeout(timeout)
      }
    }
  }, [])

  const startTour = useCallback(() => {
    const createDriver = getDriverConstructor()
    if (!createDriver) return

    const driverObj = createDriver({
      showProgress: true,
      showButtons: ['next', 'previous', 'close'],
      animate: true,
      overlayColor: '#000',
      overlayOpacity: 0.7,
      stagePadding: 8,
      stageRadius: 8,
      popoverClass: 'watchtower-tour-popover',
      steps: TOUR_STEPS,
      onDestroyed: () => {
        localStorage.setItem(TOUR_STORAGE_KEY, 'true')
        setHasCompleted(true)
      },
    })

    driverObj.drive()
  }, [])

  const resetTour = useCallback(() => {
    localStorage.removeItem(TOUR_STORAGE_KEY)
    setHasCompleted(false)
  }, [])

  return { isAvailable, hasCompleted, startTour, resetTour }
}

/** Auto-start tour on first visit */
export function GuidedTourAutoStart() {
  const { isAvailable, hasCompleted, startTour } = useGuidedTour()

  useEffect(() => {
    if (isAvailable && !hasCompleted) {
      // Small delay to ensure DOM elements are rendered
      const timer = setTimeout(startTour, 1500)
      return () => clearTimeout(timer)
    }
  }, [isAvailable, hasCompleted, startTour])

  return null
}

/** "Take Tour" button component for the Header */
export function TourButton() {
  const { isAvailable, startTour } = useGuidedTour()

  if (!isAvailable) return null

  return (
    <button
      onClick={startTour}
      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-accent-cyan bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/30 rounded-md transition-colors"
      title="Take a guided tour"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
      Tour
    </button>
  )
}

export default GuidedTourAutoStart
