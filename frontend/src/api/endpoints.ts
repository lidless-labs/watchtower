/**
 * API endpoints - Real API calls
 */

import { apiClient } from './client'
import type { Topology, TopologySummary } from '../types/topology'
import type { Device, DeviceSummary } from '../types/device'
import type { AlertSummary, Alert } from '../types/alert'
import type { L3Topology } from '../types/vlan'
import type { PortGroupStats, ProxmoxNodeDetail } from '../demo/mockData'

// Re-export types for backward compatibility
export type { PortGroupStats, ProxmoxNodeDetail } from '../demo/mockData'

// Proxmox VM types
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
  const response = await apiClient.get<Topology>('/topology')
  return response.data
}

export async function fetchTopologySummary(): Promise<TopologySummary> {
  const response = await apiClient.get<TopologySummary>('/topology/summary')
  return response.data
}

export async function fetchL3Topology(): Promise<L3Topology> {
  const response = await apiClient.get<L3Topology>('/topology/l3')
  return response.data
}

// Devices
export async function fetchDevices(): Promise<DeviceSummary[]> {
  const response = await apiClient.get<DeviceSummary[]>('/devices')
  return response.data
}

export async function fetchDevice(deviceId: string): Promise<Device> {
  const response = await apiClient.get<Device>(`/device/${deviceId}`)
  return response.data
}

// Alerts
export async function fetchAlerts(status?: string): Promise<AlertSummary[]> {
  const params = status ? { status } : {}
  const response = await apiClient.get<AlertSummary[]>('/alerts', { params })
  return response.data
}

export async function fetchAlert(alertId: string): Promise<Alert> {
  const response = await apiClient.get<Alert>(`/alert/${alertId}`)
  return response.data
}

export async function acknowledgeAlert(alertId: string): Promise<void> {
  await apiClient.post(`/alert/${alertId}/acknowledge`)
}

export async function resolveAlert(alertId: string): Promise<void> {
  await apiClient.post(`/alert/${alertId}/resolve`)
}

// Proxmox VMs
export async function fetchVMs(): Promise<VMListResponse> {
  const response = await apiClient.get<VMListResponse>('/vms')
  return response.data
}

// Speedtest - returns raw API data, component handles typing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchSpeedtest(): Promise<any> {
  const response = await apiClient.get('/speedtest')
  return response.data
}

// Port Groups
export async function fetchPortGroups(): Promise<PortGroupStats[]> {
  const response = await apiClient.get<PortGroupStats[]>('/port-groups')
  return response.data
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
  const response = await apiClient.get(`/history/device/${deviceId}/metrics`, { params: { range } })
  return response.data
}

export async function fetchNetworkHistorySummary(range: string = '24h'): Promise<HistoryResponse> {
  const response = await apiClient.get('/history/network/summary', { params: { range } })
  return response.data
}

export async function fetchAlertTimeline(range: string = '24h'): Promise<{ events: Array<{ time: string; device_id: string; hostname: string; severity: string; title: string; state: string }> }> {
  const response = await apiClient.get('/history/alerts/timeline', { params: { range } })
  return response.data
}

export async function fetchTopTalkers(range: string = '1h'): Promise<{ talkers: Array<{ device_id: string; interface_name: string; in_bps: number; out_bps: number; utilization: number }> }> {
  const response = await apiClient.get('/history/network/top-talkers', { params: { range } })
  return response.data
}

export async function fetchSpeedtestHistory(range: string = '7d'): Promise<HistoryResponse> {
  const response = await apiClient.get('/history/speedtest', { params: { range } })
  return response.data
}

// Proxmox Node Detail
export async function fetchProxmoxNode(nodeName: string): Promise<ProxmoxNodeDetail> {
  const response = await apiClient.get<ProxmoxNodeDetail>(`/vms/node/${nodeName}`)
  return response.data
}
