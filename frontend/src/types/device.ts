export type DeviceStatus = 'up' | 'down' | 'degraded' | 'unknown'
export type DeviceType = 'switch' | 'firewall' | 'server' | 'router' | 'access_point' | 'other'

export type DeviceLogKind = 'eventlog' | 'syslog' | 'alertlog'

export interface DeviceLogEntry {
  timestamp: string
  type?: string | null
  severity?: string | null
  message: string
}

export interface Interface {
  name: string
  status: DeviceStatus
  admin_status?: string   // "up" or "down" - admin state
  alias?: string          // Port description
  is_trunk?: boolean      // True if trunk port
  poe_enabled?: boolean   // True if PoE powered
  poe_power?: number      // Watts being delivered
  speed: number           // Mbps
  in_bps: number
  out_bps: number
  utilization: number
  errors_in: number
  errors_out: number
}

export interface DeviceStats {
  cpu: number
  memory: number
  temperature?: number
  uptime: number // seconds
  load?: [number, number, number]
}

export interface ProxmoxStats {
  vms_running: number
  vms_stopped: number
  containers_running: number
  containers_stopped: number
  ceph_used_percent?: number
}

export interface SwitchStats {
  ports_up: number
  ports_down: number
  poe_budget_used?: number
  poe_budget_total?: number
  is_stp_root: boolean
}

export interface FirewallStats {
  sessions_active: number
  throughput_in: number
  throughput_out: number
  threats_blocked_24h: number
}

export interface Device {
  id: string
  display_name: string
  model?: string
  device_type: DeviceType
  ip?: string
  location?: string
  status: DeviceStatus
  cluster_id?: string
  stats: DeviceStats
  interfaces: Interface[]
  proxmox_stats?: ProxmoxStats
  switch_stats?: SwitchStats
  firewall_stats?: FirewallStats
  alert_count: number
  last_seen?: string
}

export interface DeviceSummary {
  id: string
  display_name: string
  device_type: DeviceType
  status: DeviceStatus
  alert_count: number
}
