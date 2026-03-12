/**
 * API endpoints with demo-mode fallbacks.
 */

import {
  mockTopology,
  mockAlerts,
  mockSpeedtest,
  mockVMs,
  mockL3Topology,
  mockPortGroups,
  mockProxmoxNodes,
  type PortGroupStats,
  type ProxmoxNodeDetail,
} from '../demo/mockData'
import { useNocStore } from '../store/nocStore'
import type { Topology, TopologySummary } from '../types/topology'
import type { Device, DeviceSummary } from '../types/device'
import type { AlertSummary, Alert } from '../types/alert'
import type { L3Topology } from '../types/vlan'

export interface ProxmoxVM {
  vmid: number
  name: string
  node: string
  instance: string
  type: 'qemu' | 'lxc'
  status: string
  cpu: number
  memory: number
  cpus: number | null
  maxmem: number | null
  uptime: number | null
  netin: number | null
  netout: number | null
}

export interface VMSummary {
  total_running: number
  total_qemu: number
  total_lxc: number
  total_cpus: number
  total_memory_gb: number
}

export interface VMListResponse {
  vms: ProxmoxVM[]
  summary: VMSummary
}

export interface HistoryPoint {
  time: string
  value: number
  [key: string]: string | number
}

export interface HistoryResponse {
  points: HistoryPoint[]
  [key: string]: unknown
}

function isDemoMode(): boolean {
  return useNocStore.getState().demoMode
}

function authHeaders(): HeadersInit {
  const token = localStorage.getItem('watchtower_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function fetchJson<T>(url: string, init?: RequestInit, fallback?: T): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      ...authHeaders(),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    if (fallback !== undefined) {
      return fallback
    }
    throw new Error(`Request failed: ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchTopology(): Promise<Topology> {
  if (isDemoMode()) {
    return mockTopology
  }
  return fetchJson<Topology>('/api/topology')
}

export async function fetchTopologySummary(): Promise<TopologySummary> {
  if (isDemoMode()) {
    return {
      total_devices: mockTopology.total_devices,
      devices_up: mockTopology.devices_up,
      devices_down: mockTopology.devices_down,
      devices_degraded: 0,
      active_alerts: mockTopology.active_alerts,
      critical_alerts: mockAlerts.filter((a) => a.severity === 'critical').length,
      warning_alerts: mockAlerts.filter((a) => a.severity === 'warning').length,
    }
  }
  return fetchJson<TopologySummary>('/api/topology/summary')
}

export async function fetchL3Topology(): Promise<L3Topology> {
  if (isDemoMode()) {
    return mockL3Topology
  }
  return fetchJson<L3Topology>('/api/topology/l3')
}

export async function fetchDevices(): Promise<DeviceSummary[]> {
  if (isDemoMode()) {
    return Object.values(mockTopology.devices).map((d) => ({
      id: d.id,
      display_name: d.display_name,
      device_type: d.device_type,
      status: d.status,
      alert_count: d.alert_count,
    }))
  }
  return fetchJson<DeviceSummary[]>('/api/devices')
}

export async function fetchDevice(deviceId: string): Promise<Device> {
  if (isDemoMode()) {
    const device = mockTopology.devices[deviceId]
    if (!device) {
      throw new Error(`Device not found: ${deviceId}`)
    }
    return device
  }
  return fetchJson<Device>(`/api/device/${deviceId}`)
}

export async function fetchAlerts(status?: string): Promise<AlertSummary[]> {
  if (isDemoMode()) {
    if (status) {
      return mockAlerts.filter((a) => a.status === status)
    }
    return mockAlerts
  }

  const params = status ? `?status=${encodeURIComponent(status)}` : ''
  return fetchJson<AlertSummary[]>(`/api/alerts${params}`)
}

export async function fetchAlert(alertId: string): Promise<Alert> {
  if (isDemoMode()) {
    const alert = mockAlerts.find((a) => a.id === alertId)
    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`)
    }
    return {
      ...alert,
      details: 'Device has not responded to ICMP ping requests for over 5 minutes.',
      downtime_seconds: 342,
    }
  }

  return fetchJson<Alert>(`/api/alert/${alertId}`)
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  if (isDemoMode()) {
    return
  }

  const res = await fetch(`/api/alert/${alertId}/acknowledge`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`Failed to acknowledge alert: ${res.status}`)
  }
}

export async function resolveAlert(alertId: string): Promise<void> {
  if (isDemoMode()) {
    return
  }

  const res = await fetch(`/api/alert/${alertId}/resolve`, {
    method: 'POST',
    headers: authHeaders(),
  })
  if (!res.ok) {
    throw new Error(`Failed to resolve alert: ${res.status}`)
  }
}

export async function fetchVMs(): Promise<VMListResponse> {
  if (isDemoMode()) {
    return mockVMs
  }
  return fetchJson<VMListResponse>('/api/vms')
}

export async function fetchSpeedtest(): Promise<typeof mockSpeedtest> {
  if (isDemoMode()) {
    return mockSpeedtest
  }
  return fetchJson<typeof mockSpeedtest>('/api/speedtest', undefined, mockSpeedtest)
}

export async function fetchPortGroups(): Promise<PortGroupStats[]> {
  if (isDemoMode()) {
    return mockPortGroups
  }
  return fetchJson<PortGroupStats[]>('/api/port-groups')
}

export async function fetchDeviceHistory(
  deviceId: string,
  range: string = '24h'
): Promise<{ cpu: HistoryPoint[]; memory: HistoryPoint[]; temperature: HistoryPoint[]; interfaces: Record<string, HistoryPoint[]> }> {
  if (isDemoMode()) {
    return { cpu: [], memory: [], temperature: [], interfaces: {} }
  }
  return fetchJson(`/api/history/device/${deviceId}/metrics?range=${range}`, undefined, {
    cpu: [],
    memory: [],
    temperature: [],
    interfaces: {},
  })
}

export async function fetchNetworkHistorySummary(range: string = '24h'): Promise<HistoryResponse> {
  if (isDemoMode()) {
    return { points: [] }
  }
  return fetchJson<HistoryResponse>(`/api/history/network/summary?range=${range}`, undefined, { points: [] })
}

export async function fetchAlertTimeline(range: string = '24h'): Promise<{ events: Array<{ time: string; device_id: string; hostname: string; severity: string; title: string; state: string }> }> {
  if (isDemoMode()) {
    return { events: [] }
  }
  return fetchJson(`/api/history/alerts/timeline?range=${range}`, undefined, { events: [] })
}

export async function fetchTopTalkers(range: string = '1h'): Promise<{ talkers: Array<{ device_id: string; interface_name: string; in_bps: number; out_bps: number; utilization: number }> }> {
  if (isDemoMode()) {
    return { talkers: [] }
  }
  return fetchJson(`/api/history/network/top-talkers?range=${range}`, undefined, { talkers: [] })
}

export async function fetchSpeedtestHistory(range: string = '7d'): Promise<HistoryResponse> {
  if (isDemoMode()) {
    return { points: [] }
  }
  return fetchJson<HistoryResponse>(`/api/history/speedtest?range=${range}`, undefined, { points: [] })
}

export async function fetchProxmoxNode(nodeName: string): Promise<ProxmoxNodeDetail> {
  if (isDemoMode()) {
    const data = mockProxmoxNodes[nodeName]
    if (!data) {
      return {
        node: null,
        vms: [],
        lxcs: [],
        storage: [],
        vms_running: 0,
        vms_total: 0,
        lxcs_running: 0,
        lxcs_total: 0,
      }
    }
    return data
  }

  return fetchJson<ProxmoxNodeDetail>(`/api/vms/node/${encodeURIComponent(nodeName)}`)
}
