/**
 * API endpoints. All calls hit the FastAPI backend through the Vite proxy.
 */

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

export interface PortGroupStats {
  name: string
  description: string
  port_count: number
  active_port_count: number
  in_bps: number
  out_bps: number
  in_mbps: number
  out_mbps: number
  total_mbps: number
  status: 'ok' | 'warning' | 'critical'
  thresholds: Record<string, number>
}

export interface ProxmoxNodeInfo {
  node: string
  status: string
  cpu: number
  memory: number
  maxcpu: number
  maxmem: number
  uptime: number
}

export interface ProxmoxNodeVM {
  vmid: number
  name: string
  type: string
  status: string
  cpu: number
  memory: number
}

export interface ProxmoxStorageInfo {
  storage: string
  type: string
  used: number
  total: number
  used_percent: number
}

export interface ProxmoxNodeDetail {
  node: ProxmoxNodeInfo | null
  vms: ProxmoxNodeVM[]
  lxcs: ProxmoxNodeVM[]
  storage: ProxmoxStorageInfo[]
  vms_running: number
  vms_total: number
  lxcs_running: number
  lxcs_total: number
}

export interface SpeedtestSummary {
  status: string
  message?: string
  indicator?: 'normal' | 'degraded' | 'down'
  [key: string]: unknown
}

// Auth rides on the HttpOnly session cookie, attached automatically to these
// same-origin requests; no Authorization header is needed.

// Fetch has no built-in timeout - a stuck request would hang forever
// and leak the in-flight promise. Mirror the axios client default.
const FETCH_TIMEOUT_MS = 30_000

async function fetchJson<T>(url: string, init?: RequestInit, fallback?: T): Promise<T> {
  const controller = new AbortController()
  // If the caller passed their own signal, abort our controller when
  // it fires too (covers component-unmount cancellation).
  const callerSignal = init?.signal
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort()
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
    }
  }
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
    })
    if (!res.ok) {
      if (fallback !== undefined) {
        return fallback
      }
      throw new Error(`Request failed: ${res.status}`)
    }
    return (await res.json()) as T
  } finally {
    window.clearTimeout(timer)
  }
}

export async function fetchTopology(): Promise<Topology> {
  return fetchJson<Topology>('/api/topology')
}

export async function fetchTopologySummary(): Promise<TopologySummary> {
  return fetchJson<TopologySummary>('/api/topology/summary')
}

export async function fetchL3Topology(): Promise<L3Topology> {
  return fetchJson<L3Topology>('/api/topology/l3')
}

export async function fetchDevices(): Promise<DeviceSummary[]> {
  return fetchJson<DeviceSummary[]>('/api/devices')
}

export async function fetchDevice(deviceId: string): Promise<Device> {
  return fetchJson<Device>(`/api/device/${deviceId}`)
}

export async function fetchAlerts(status?: string): Promise<AlertSummary[]> {
  const params = status ? `?status=${encodeURIComponent(status)}` : ''
  return fetchJson<AlertSummary[]>(`/api/alerts${params}`)
}

export async function fetchAlert(alertId: string): Promise<Alert> {
  return fetchJson<Alert>(`/api/alert/${alertId}`)
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  const res = await fetch(`/api/alert/${alertId}/acknowledge`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to acknowledge alert: ${res.status}`)
  }
}

export async function resolveAlert(alertId: string): Promise<void> {
  const res = await fetch(`/api/alert/${alertId}/resolve`, {
    method: 'POST',
  })
  if (!res.ok) {
    throw new Error(`Failed to resolve alert: ${res.status}`)
  }
}

export async function fetchVMs(): Promise<VMListResponse> {
  return fetchJson<VMListResponse>('/api/vms')
}

export async function fetchSpeedtest(): Promise<SpeedtestSummary> {
  return fetchJson<SpeedtestSummary>('/api/speedtest', undefined, { status: 'no_data' })
}

export async function fetchPortGroups(): Promise<PortGroupStats[]> {
  return fetchJson<PortGroupStats[]>('/api/port-groups')
}

export async function fetchDeviceHistory(
  deviceId: string,
  range: string = '24h'
): Promise<{ cpu: HistoryPoint[]; memory: HistoryPoint[]; temperature: HistoryPoint[]; interfaces: Record<string, HistoryPoint[]> }> {
  return fetchJson(`/api/history/device/${deviceId}/metrics?range=${range}`, undefined, {
    cpu: [],
    memory: [],
    temperature: [],
    interfaces: {},
  })
}

export async function fetchNetworkHistorySummary(range: string = '24h'): Promise<HistoryResponse> {
  return fetchJson<HistoryResponse>(`/api/history/network/summary?range=${range}`, undefined, { points: [] })
}

export async function fetchAlertTimeline(range: string = '24h'): Promise<{ events: Array<{ time: string; device_id: string; hostname: string; severity: string; title: string; state: string }> }> {
  return fetchJson(`/api/history/alerts/timeline?range=${range}`, undefined, { events: [] })
}

export async function fetchTopTalkers(range: string = '1h'): Promise<{ talkers: Array<{ device_id: string; interface_name: string; in_bps: number; out_bps: number; utilization: number }> }> {
  return fetchJson(`/api/history/network/top-talkers?range=${range}`, undefined, { talkers: [] })
}

export async function fetchSpeedtestHistory(range: string = '7d'): Promise<HistoryResponse> {
  return fetchJson<HistoryResponse>(`/api/history/speedtest?range=${range}`, undefined, { points: [] })
}

export async function fetchProxmoxNode(nodeName: string): Promise<ProxmoxNodeDetail> {
  return fetchJson<ProxmoxNodeDetail>(`/api/vms/node/${encodeURIComponent(nodeName)}`)
}
