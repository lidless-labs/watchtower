import { create } from 'zustand'
import type { Topology } from '../types/topology'
import type { Device } from '../types/device'
import type { Connection } from '../types/connection'
import type { L3Topology, ViewMode } from '../types/vlan'

type SpeedtestStatus = 'normal' | 'degraded' | 'down' | null

interface NocState {
  // Data
  topology: Topology | null
  selectedDevice: Device | null
  selectedConnection: Connection | null
  speedtestStatus: SpeedtestStatus

  // L3 topology state. The legacy React Flow canvas was the only consumer
  // of these slots; Phase 4 left them in place because the L3 feature is a
  // separate first-class concern (its own API endpoint at
  // `/api/topology/l3`, its own type module at `types/vlan.ts`) and may be
  // wired into a new L3 view later. No current UI reads from them.
  viewMode: ViewMode
  l3Topology: L3Topology | null
  selectedVlans: Set<number>

  // UI state
  isLoading: boolean
  error: string | null
  isConnected: boolean
  sidebarOpen: boolean

  // Actions
  setTopology: (topology: Topology) => void
  selectDevice: (deviceId: string | null) => void
  selectConnection: (connectionId: string | null) => void
  updateDeviceStatus: (deviceId: string, status: string) => void
  updateAlertCount: (delta: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setConnected: (connected: boolean) => void
  setSidebarOpen: (open: boolean) => void
  clearSelection: () => void
  setSpeedtestStatus: (status: SpeedtestStatus) => void

  // Detail panel actions. After Phase 4 these are pure hash-routing
  // helpers - the legacy in-store `detailPanelClusterId` slot was
  // deleted alongside the canvas sidebar that read it.
  openClusterDetail: (clusterId: string) => void
  closeClusterDetail: () => void

  // L3 actions (see L3 state block above for the keep-or-remove rationale)
  setViewMode: (mode: ViewMode) => void
  setL3Topology: (topology: L3Topology | null) => void
  toggleVlanFilter: (vlanId: number) => void
  clearVlanFilter: () => void
}

export const useNocStore = create<NocState>((set, get) => ({
  // Initial state
  topology: null,
  selectedDevice: null,
  selectedConnection: null,
  speedtestStatus: null,

  // L3 topology state
  viewMode: 'l2',
  l3Topology: null,
  selectedVlans: new Set<number>(),

  isLoading: true,
  error: null,
  isConnected: false,
  sidebarOpen: true,

  // Actions
  setTopology: (topology) => set({ topology, error: null }),

  selectDevice: (deviceId) => {
    const { topology } = get()
    if (!topology || !deviceId) {
      set({ selectedDevice: null, selectedConnection: null })
      return
    }
    const device = topology.devices[deviceId]
    if (device) {
      set({ selectedDevice: device, selectedConnection: null })
    }
  },

  selectConnection: (connectionId) => {
    const { topology } = get()
    if (!topology || !connectionId) {
      set({ selectedConnection: null, selectedDevice: null })
      return
    }
    const connection = topology.connections.find((c) => c.id === connectionId)
    if (connection) {
      set({ selectedConnection: connection, selectedDevice: null })
    }
  },

  updateDeviceStatus: (deviceId, status) => {
    const { topology } = get()
    if (!topology) return

    const device = topology.devices[deviceId]
    if (device) {
      const newStatus = status as Device['status']
      const oldStatus = device.status

      // Update device status
      const newDevices = {
        ...topology.devices,
        [deviceId]: { ...device, status: newStatus },
      }

      // Recalculate counters if status actually changed
      let devicesUp = topology.devices_up
      let devicesDown = topology.devices_down

      if (oldStatus !== newStatus) {
        // Decrement old status counter
        if (oldStatus === 'up') devicesUp--
        else if (oldStatus === 'down') devicesDown--

        // Increment new status counter
        if (newStatus === 'up') devicesUp++
        else if (newStatus === 'down') devicesDown++
      }

      set({
        topology: {
          ...topology,
          devices: newDevices,
          devices_up: devicesUp,
          devices_down: devicesDown,
        },
      })
    }
  },

  updateAlertCount: (delta) => {
    const { topology } = get()
    if (!topology) return

    set({
      topology: {
        ...topology,
        active_alerts: Math.max(0, topology.active_alerts + delta),
      },
    })
  },

  setLoading: (isLoading) => set({ isLoading }),
  setError: (error) => set({ error }),
  setConnected: (isConnected) => set({ isConnected }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

  clearSelection: () => set({ selectedDevice: null, selectedConnection: null }),

  setSpeedtestStatus: (speedtestStatus) => set({ speedtestStatus }),

  // Detail panel actions. After Phase 4 these are pure hash-routing
  // helpers; the in-store `detailPanelClusterId` slot was deleted with
  // the legacy canvas sidebar.
  openClusterDetail: (clusterId) => {
    if (typeof window !== 'undefined') {
      window.location.hash = `#/cluster/${encodeURIComponent(clusterId)}`
    }
  },
  closeClusterDetail: () => {
    if (typeof window !== 'undefined' && window.location.hash.startsWith('#/cluster/')) {
      window.location.hash = '#/'
    }
  },

  // L3 actions
  setViewMode: (viewMode) => set({ viewMode }),

  setL3Topology: (l3Topology) => set({ l3Topology }),

  toggleVlanFilter: (vlanId) => {
    const { selectedVlans } = get()
    const newSelected = new Set(selectedVlans)
    if (newSelected.has(vlanId)) {
      newSelected.delete(vlanId)
    } else {
      newSelected.add(vlanId)
    }
    set({ selectedVlans: newSelected })
  },

  clearVlanFilter: () => set({ selectedVlans: new Set<number>() }),
}))
