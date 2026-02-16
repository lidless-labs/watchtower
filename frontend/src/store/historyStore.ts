import { create } from 'zustand'
import { useAuthStore } from './authStore'

export type TimeRange = '1h' | '6h' | '24h' | '7d' | '30d'

export interface TimeSeriesPoint {
  time: string
  value: number
}

export interface MultiSeriesPoint {
  time: string
  [key: string]: string | number
}

export interface AlertEvent {
  time: string
  device_id: string
  hostname: string
  severity: string
  title: string
  state: string
}

export interface TopTalker {
  device_id: string
  interface_name: string
  in_bps: number
  out_bps: number
  utilization: number
}

export interface DeviceMetricData {
  cpu: TimeSeriesPoint[]
  memory: TimeSeriesPoint[]
  temperature: TimeSeriesPoint[]
  interfaces: Record<string, TimeSeriesPoint[]>
}

interface HistoryState {
  timeRange: TimeRange
  networkSummary: MultiSeriesPoint[] | null
  alertTimeline: AlertEvent[] | null
  topTalkers: TopTalker[] | null
  speedtestHistory: MultiSeriesPoint[] | null
  deviceMetrics: Record<string, DeviceMetricData>
  isLoading: boolean
  activeTab: 'overview' | 'alerts' | 'speedtest'

  setTimeRange: (range: TimeRange) => void
  setActiveTab: (tab: 'overview' | 'alerts' | 'speedtest') => void
  fetchNetworkSummary: () => Promise<void>
  fetchAlertTimeline: () => Promise<void>
  fetchTopTalkers: () => Promise<void>
  fetchSpeedtestHistory: () => Promise<void>
  fetchDeviceMetrics: (deviceId: string) => Promise<void>
  fetchAll: () => Promise<void>
}

const API_BASE = '/api/history'

function authHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  timeRange: '24h',
  networkSummary: null,
  alertTimeline: null,
  topTalkers: null,
  speedtestHistory: null,
  deviceMetrics: {},
  isLoading: false,
  activeTab: 'overview',

  setTimeRange: (timeRange) => {
    set({ timeRange })
    // Re-fetch with new range
    get().fetchAll()
  },

  setActiveTab: (activeTab) => set({ activeTab }),

  fetchNetworkSummary: async () => {
    const { timeRange } = get()
    try {
      const data = await fetchJSON<{ points: MultiSeriesPoint[] }>(
        `${API_BASE}/network/summary?range=${timeRange}`
      )
      set({ networkSummary: data.points })
    } catch {
      set({ networkSummary: [] })
    }
  },

  fetchAlertTimeline: async () => {
    const { timeRange } = get()
    try {
      const data = await fetchJSON<{ events: AlertEvent[] }>(
        `${API_BASE}/alerts/timeline?range=${timeRange}`
      )
      set({ alertTimeline: data.events })
    } catch {
      set({ alertTimeline: [] })
    }
  },

  fetchTopTalkers: async () => {
    const { timeRange } = get()
    try {
      const data = await fetchJSON<{ talkers: TopTalker[] }>(
        `${API_BASE}/network/top-talkers?range=${timeRange}`
      )
      set({ topTalkers: data.talkers })
    } catch {
      set({ topTalkers: [] })
    }
  },

  fetchSpeedtestHistory: async () => {
    const { timeRange } = get()
    try {
      const data = await fetchJSON<{ points: MultiSeriesPoint[] }>(
        `${API_BASE}/speedtest?range=${timeRange}`
      )
      set({ speedtestHistory: data.points })
    } catch {
      set({ speedtestHistory: [] })
    }
  },

  fetchDeviceMetrics: async (deviceId: string) => {
    const { timeRange } = get()
    try {
      const data = await fetchJSON<DeviceMetricData>(
        `${API_BASE}/device/${deviceId}/metrics?range=${timeRange}`
      )
      set((state) => ({
        deviceMetrics: { ...state.deviceMetrics, [deviceId]: data },
      }))
    } catch {
      // Leave existing data
    }
  },

  fetchAll: async () => {
    set({ isLoading: true })
    const { fetchNetworkSummary, fetchAlertTimeline, fetchTopTalkers, fetchSpeedtestHistory } = get()
    await Promise.allSettled([
      fetchNetworkSummary(),
      fetchAlertTimeline(),
      fetchTopTalkers(),
      fetchSpeedtestHistory(),
    ])
    set({ isLoading: false })
  },
}))
