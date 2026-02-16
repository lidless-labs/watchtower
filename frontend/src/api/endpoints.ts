/**
 * API endpoints - Demo mode
 * Returns bundled mock data instead of making network requests
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
import type { Topology, TopologySummary } from '../types/topology'
import type { Device, DeviceSummary } from '../types/device'
import type { AlertSummary, Alert } from '../types/alert'
import type { L3Topology } from '../types/vlan'

// Proxmox types (kept inline for compatibility)
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

// Topology
export async function fetchTopology(): Promise<Topology> {
  return mockTopology
}

export async function fetchTopologySummary(): Promise<TopologySummary> {
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

export async function fetchL3Topology(): Promise<L3Topology> {
  return mockL3Topology
}

// Devices
export async function fetchDevices(): Promise<DeviceSummary[]> {
  return Object.values(mockTopology.devices).map((d) => ({
    id: d.id,
    display_name: d.display_name,
    device_type: d.device_type,
    status: d.status,
    alert_count: d.alert_count,
  }))
}

export async function fetchDevice(deviceId: string): Promise<Device> {
  const device = mockTopology.devices[deviceId]
  if (!device) {
    throw new Error(`Device not found: ${deviceId}`)
  }
  return device
}

// Alerts
export async function fetchAlerts(status?: string): Promise<AlertSummary[]> {
  if (status) {
    return mockAlerts.filter((a) => a.status === status)
  }
  return mockAlerts
}

export async function fetchAlert(alertId: string): Promise<Alert> {
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

export async function acknowledgeAlert(_alertId: string): Promise<void> {
  // No-op in demo mode
}

export async function resolveAlert(_alertId: string): Promise<void> {
  // No-op in demo mode
}

// Proxmox VMs
export async function fetchVMs(): Promise<VMListResponse> {
  return mockVMs
}

// Speedtest
export async function fetchSpeedtest(): Promise<typeof mockSpeedtest> {
  return mockSpeedtest
}

// Port Groups
export async function fetchPortGroups(): Promise<PortGroupStats[]> {
  return mockPortGroups
}

// History API
export interface HistoryPoint {
  time: string
  value: number
  [key: string]: string | number
}

export interface HistoryResponse {
  points: HistoryPoint[]
  [key: string]: unknown
}

export async function fetchDeviceHistory(
  deviceId: string,
  range: string = '24h'
): Promise<{ cpu: HistoryPoint[]; memory: HistoryPoint[]; temperature: HistoryPoint[]; interfaces: Record<string, HistoryPoint[]> }> {
  const res = await fetch(`/api/history/device/${deviceId}/metrics?range=${range}`)
  if (!res.ok) return { cpu: [], memory: [], temperature: [], interfaces: {} }
  return res.json()
}

export async function fetchNetworkHistorySummary(range: string = '24h'): Promise<HistoryResponse> {
  const res = await fetch(`/api/history/network/summary?range=${range}`)
  if (!res.ok) return { points: [] }
  return res.json()
}

export async function fetchAlertTimeline(range: string = '24h'): Promise<{ events: Array<{ time: string; device_id: string; hostname: string; severity: string; title: string; state: string }> }> {
  const res = await fetch(`/api/history/alerts/timeline?range=${range}`)
  if (!res.ok) return { events: [] }
  return res.json()
}

export async function fetchTopTalkers(range: string = '1h'): Promise<{ talkers: Array<{ device_id: string; interface_name: string; in_bps: number; out_bps: number; utilization: number }> }> {
  const res = await fetch(`/api/history/network/top-talkers?range=${range}`)
  if (!res.ok) return { talkers: [] }
  return res.json()
}

export async function fetchSpeedtestHistory(range: string = '7d'): Promise<HistoryResponse> {
  const res = await fetch(`/api/history/speedtest?range=${range}`)
  if (!res.ok) return { points: [] }
  return res.json()
}

// Proxmox Node Detail
export async function fetchProxmoxNode(nodeName: string): Promise<ProxmoxNodeDetail> {
  const data = mockProxmoxNodes[nodeName]
  if (!data) {
    // Return empty data for unknown nodes
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
