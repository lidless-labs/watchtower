/**
 * Mock data for static demo mode
 * Meridian Financial Group – Regional financial services firm
 * ~150 employees, 2 sites (HQ + branch), ~55 managed network objects
 *
 * All API endpoints return this data instead of making real network requests
 */

import type { Topology } from '../types/topology'
import type { AlertSummary } from '../types/alert'
import type { L3Topology } from '../types/vlan'
import type { VMListResponse } from '../api/endpoints'
import type { Interface } from '../types/device'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deterministic PRNG seeded with a number */
function seededRand(seed: number) {
  return (i: number) => {
    const x = Math.sin(seed + i) * 10000
    return x - Math.floor(x)
  }
}

// ---------------------------------------------------------------------------
// Port/Interface generators
// ---------------------------------------------------------------------------

/**
 * Generate realistic Cisco Catalyst 9300 stack interfaces.
 * Accepts the number of stack members (1-4) × 48 ports per member.
 *
 * Distribution per PRD:
 *   60 % active with descriptions
 *   15 % active unnamed
 *   15 % admin disabled
 *   10 % down / error
 */
function generateCatalystStackInterfaces(
  seed: number,
  stackMembers: number,
  floorId: string,
): Interface[] {
  const interfaces: Interface[] = []
  const rand = seededRand(seed)

  // Realistic description pools per floor/role
  const descPools: Record<string, string[]> = {
    F1: [
      'Desk-F1-101', 'Desk-F1-102', 'Desk-F1-103', 'Desk-F1-104', 'Desk-F1-105',
      'Desk-F1-106', 'Desk-F1-107', 'Desk-F1-108', 'Desk-F1-109', 'Desk-F1-110',
      'Desk-F1-111', 'Desk-F1-112', 'Desk-F1-113', 'Desk-F1-114', 'Desk-F1-115',
      'MFP-Lobby', 'MFP-F1-Copy-Room', 'VOIP-Ext1101', 'VOIP-Ext1102', 'VOIP-Ext1103',
      'VOIP-Ext1104', 'VOIP-Ext1105', 'CAM-Lobby-N', 'CAM-Lobby-S', 'CAM-F1-Hall',
      'Badge-F1-Main', 'Badge-F1-Side', 'AP-F1-01-DATA', 'AP-F1-02-DATA',
      'AP-F1-03-DATA', 'AP-F1-04-DATA', 'AV-Conf-F1-A', 'AV-Conf-F1-B',
    ],
    F2: [
      'Desk-F2-201', 'Desk-F2-202', 'Desk-F2-203', 'Desk-F2-204', 'Desk-F2-205',
      'Desk-F2-206', 'Desk-F2-207', 'Desk-F2-208', 'Desk-F2-209', 'Desk-F2-210',
      'Desk-F2-211', 'Desk-F2-212', 'Desk-F2-213', 'Desk-F2-214', 'Desk-F2-215',
      'Desk-F2-216', 'Desk-F2-217', 'Desk-F2-218', 'Desk-F2-219', 'Desk-F2-220',
      'MFP-F2-N', 'MFP-F2-S', 'VOIP-Ext2201', 'VOIP-Ext2202', 'VOIP-Ext2203',
      'VOIP-Ext2204', 'VOIP-Ext2205', 'VOIP-Ext2206', 'VOIP-Ext2207', 'VOIP-Ext2208',
      'CAM-F2-Hall-E', 'CAM-F2-Hall-W', 'Badge-F2-Elev',
      'AP-F2-01-DATA', 'AP-F2-02-DATA', 'AP-F2-03-DATA',
      'AP-F2-04-DATA', 'AP-F2-05-DATA', 'AP-F2-06-DATA',
      'AV-Conf-F2-A', 'AV-Conf-F2-B', 'AV-Conf-F2-C',
    ],
    F3: [
      'Desk-F3-301', 'Desk-F3-302', 'Desk-F3-303', 'Desk-F3-304', 'Desk-F3-305',
      'Desk-F3-306', 'Desk-F3-307', 'Desk-F3-308', 'Desk-F3-309', 'Desk-F3-310',
      'MFP-F3-Exec', 'VOIP-Ext3301', 'VOIP-Ext3302', 'VOIP-Ext3303',
      'CAM-F3-Hall', 'Badge-F3-Stair',
      'AP-F3-01-DATA', 'AP-F3-02-DATA', 'AP-F3-03-DATA',
      'AV-BoardRoom',
    ],
    DC: [
      'PVE01-MGMT', 'PVE01-PROD', 'PVE01-STORAGE', 'PVE01-CEPH',
      'PVE02-MGMT', 'PVE02-PROD', 'PVE02-STORAGE', 'PVE02-CEPH',
      'PVE03-MGMT', 'PVE03-PROD', 'PVE03-STORAGE',
      'NAS01-DATA', 'NAS01-MGMT',
      'WLC01-MGMT', 'FW01-TRUST', 'FW02-TRUST',
      'UPS-MGMT', 'PDU-A-MGMT', 'PDU-B-MGMT', 'iDRAC-PVE01', 'iDRAC-PVE02', 'iDRAC-PVE03',
      'iSCSI-PVE01', 'iSCSI-PVE02', 'iSCSI-PVE03',
    ],
  }

  const descs = descPools[floorId] ?? descPools['F1']
  let descIdx = 0
  let portIndex = 0

  for (let slot = 1; slot <= stackMembers; slot++) {
    for (let port = 1; port <= 48; port++) {
      portIndex++
      const r = rand(portIndex)

      const is10G = port >= 45
      const name = is10G ? `Te${slot}/0/${port}` : `Gi${slot}/0/${port}`

      let status: 'up' | 'down' = 'up'
      let adminStatus: 'up' | 'down' = 'up'
      let utilization = 0
      let inBps = 0
      let outBps = 0
      let errorsIn = 0
      let errorsOut = 0
      let alias = ''
      let isTrunk = false
      let poeEnabled = false
      let poePower = 0

      if (r < 0.60) {
        // Active with description
        status = 'up'
        const util = rand(portIndex + 1000) * 40 + 2
        utilization = Math.round(util * 10) / 10
        const speed = is10G ? 10_000_000_000 : 1_000_000_000
        inBps = Math.round(speed * (util / 100) * (0.3 + rand(portIndex + 2000) * 0.7))
        outBps = Math.round(speed * (util / 100) * (0.3 + rand(portIndex + 3000) * 0.7))

        alias = descs[descIdx % descs.length]
        descIdx++

        isTrunk = alias.includes('PVE') || alias.includes('AP-') || alias.includes('WLC') || alias.includes('FW') || rand(portIndex + 5000) < 0.05

        if (alias.includes('VOIP') || alias.includes('AP-') || alias.includes('CAM') || alias.includes('Badge') || alias.includes('AV-')) {
          poeEnabled = true
          poePower = Math.round((5 + rand(portIndex + 6000) * 25) * 10) / 10
        }
      } else if (r < 0.75) {
        // Active unnamed
        status = 'up'
        utilization = Math.round(rand(portIndex + 7000) * 8 * 10) / 10
        const speed = is10G ? 10_000_000_000 : 1_000_000_000
        inBps = Math.round(speed * (utilization / 100) * rand(portIndex + 8000))
        outBps = Math.round(speed * (utilization / 100) * rand(portIndex + 9000))
      } else if (r < 0.90) {
        // Admin disabled
        status = 'down'
        adminStatus = 'down'
        alias = ''
      } else {
        // Down / error
        status = 'down'
        errorsIn = Math.floor(rand(portIndex + 10000) * 500)
        errorsOut = Math.floor(rand(portIndex + 11000) * 100)
        alias = rand(portIndex + 12000) < 0.5 ? 'FAULTY-CABLE' : 'Desktop-Disconnected'
      }

      interfaces.push({
        name,
        status,
        admin_status: adminStatus,
        alias: alias || undefined,
        is_trunk: isTrunk || undefined,
        poe_enabled: poeEnabled || undefined,
        poe_power: poePower || undefined,
        speed: is10G ? 10000 : 1000,
        in_bps: inBps,
        out_bps: outBps,
        utilization,
        errors_in: errorsIn,
        errors_out: errorsOut,
      })
    }
  }

  return interfaces
}

/**
 * Generate interfaces for a 48-port branch access switch (single unit).
 */
function generateBranchSwitchInterfaces(seed: number): Interface[] {
  const interfaces: Interface[] = []
  const rand = seededRand(seed)

  const descs = [
    'Desk-BR-01', 'Desk-BR-02', 'Desk-BR-03', 'Desk-BR-04', 'Desk-BR-05',
    'Desk-BR-06', 'Desk-BR-07', 'Desk-BR-08', 'Desk-BR-09', 'Desk-BR-10',
    'Desk-BR-11', 'Desk-BR-12', 'Desk-BR-13', 'Desk-BR-14', 'Desk-BR-15',
    'VOIP-Ext5001', 'VOIP-Ext5002', 'VOIP-Ext5003', 'VOIP-Ext5004',
    'MFP-BR-Lobby', 'CAM-BR-Entry', 'CAM-BR-Rear',
    'Badge-BR-Main', 'AP-BR-01-DATA', 'AP-BR-02-DATA',
    'MFG-BR-FW01-TRUST',
  ]
  let descIdx = 0

  for (let port = 1; port <= 48; port++) {
    const r = rand(port)
    const is10G = port >= 45
    const name = is10G ? `Te1/0/${port}` : `Gi1/0/${port}`

    let status: 'up' | 'down' = 'up'
    let adminStatus: 'up' | 'down' = 'up'
    let utilization = 0
    let inBps = 0
    let outBps = 0
    let errorsIn = 0
    let errorsOut = 0
    let alias = ''
    let isTrunk = false
    let poeEnabled = false
    let poePower = 0

    if (r < 0.55) {
      status = 'up'
      const util = rand(port + 1000) * 30 + 1
      utilization = Math.round(util * 10) / 10
      const speed = is10G ? 10_000_000_000 : 1_000_000_000
      inBps = Math.round(speed * (util / 100) * (0.3 + rand(port + 2000) * 0.7))
      outBps = Math.round(speed * (util / 100) * (0.3 + rand(port + 3000) * 0.7))
      alias = descs[descIdx % descs.length]
      descIdx++
      isTrunk = alias.includes('FW') || alias.includes('AP-')
      if (alias.includes('VOIP') || alias.includes('AP-') || alias.includes('CAM') || alias.includes('Badge')) {
        poeEnabled = true
        poePower = Math.round((5 + rand(port + 6000) * 20) * 10) / 10
      }
    } else if (r < 0.70) {
      status = 'up'
      utilization = Math.round(rand(port + 7000) * 3 * 10) / 10
      const speed = is10G ? 10_000_000_000 : 1_000_000_000
      inBps = Math.round(speed * (utilization / 100) * rand(port + 8000))
      outBps = Math.round(speed * (utilization / 100) * rand(port + 9000))
    } else if (r < 0.88) {
      status = 'down'
      adminStatus = 'down'
    } else {
      status = 'down'
      errorsIn = Math.floor(rand(port + 10000) * 200)
      errorsOut = Math.floor(rand(port + 11000) * 50)
      alias = 'Desktop-Disconnected'
    }

    interfaces.push({
      name,
      status,
      admin_status: adminStatus,
      alias: alias || undefined,
      is_trunk: isTrunk || undefined,
      poe_enabled: poeEnabled || undefined,
      poe_power: poePower || undefined,
      speed: is10G ? 10000 : 1000,
      in_bps: inBps,
      out_bps: outBps,
      utilization,
      errors_in: errorsIn,
      errors_out: errorsOut,
    })
  }
  return interfaces
}

// ---------------------------------------------------------------------------
// Generate switch interfaces for each distribution switch
// ---------------------------------------------------------------------------

// Core switches: 48 ports × 1 member (high-density core, no stacking shown in port grid)
const coreSw1Interfaces = generateCatalystStackInterfaces(42, 1, 'DC')
const coreSw2Interfaces = generateCatalystStackInterfaces(137, 1, 'DC')

// Distribution: stacked or single
const distF1Interfaces = generateCatalystStackInterfaces(201, 2, 'F1') // stack of 2
const distF2Interfaces = generateCatalystStackInterfaces(302, 2, 'F2') // stack of 2
const distF3Interfaces = generateCatalystStackInterfaces(403, 1, 'F3') // single
const distDCInterfaces = generateCatalystStackInterfaces(504, 1, 'DC') // single

// Branch switch
const branchSwInterfaces = generateBranchSwitchInterfaces(601)

// Helper to count port states
const countPorts = (ifaces: Interface[]) => ({
  up: ifaces.filter(i => i.status === 'up').length,
  down: ifaces.filter(i => i.status === 'down').length,
})

const coreSw1Counts = countPorts(coreSw1Interfaces)
const coreSw2Counts = countPorts(coreSw2Interfaces)
const distF1Counts = countPorts(distF1Interfaces)
const distF2Counts = countPorts(distF2Interfaces)
const distF3Counts = countPorts(distF3Interfaces)
const distDCCounts = countPorts(distDCInterfaces)
const branchSwCounts = countPorts(branchSwInterfaces)

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

export const mockTopology: Topology = {
  clusters: [
    {
      id: 'edge',
      name: 'Security / Edge',
      cluster_type: 'security',
      icon: 'shield',
      position: { x: 500, y: 80 },
      device_ids: ['mfg-fw01', 'mfg-fw02', 'mfg-vpn-gw'],
      status: 'active',
    },
    {
      id: 'core',
      name: 'Core Layer',
      cluster_type: 'network',
      icon: 'server',
      position: { x: 500, y: 300 },
      device_ids: ['mfg-core-sw01', 'mfg-core-sw02'],
      status: 'active',
    },
    {
      id: 'distribution',
      name: 'Distribution Layer',
      cluster_type: 'network',
      icon: 'server',
      position: { x: 500, y: 520 },
      device_ids: ['mfg-dist-f1', 'mfg-dist-f2', 'mfg-dist-f3', 'mfg-dist-dc'],
      status: 'active',
    },
    {
      id: 'wireless',
      name: 'Wireless',
      cluster_type: 'network',
      icon: 'wifi',
      position: { x: 200, y: 760 },
      device_ids: [
        'mfg-wlc01',
        'mfg-ap-f1-01', 'mfg-ap-f1-02', 'mfg-ap-f1-03', 'mfg-ap-f1-04',
        'mfg-ap-f2-01', 'mfg-ap-f2-02', 'mfg-ap-f2-03', 'mfg-ap-f2-04', 'mfg-ap-f2-05', 'mfg-ap-f2-06',
        'mfg-ap-f3-01', 'mfg-ap-f3-02', 'mfg-ap-f3-03',
      ],
      status: 'active',
    },
    {
      id: 'proxmox',
      name: 'Proxmox Cluster',
      cluster_type: 'virtualization',
      icon: 'cpu',
      position: { x: 800, y: 760 },
      device_ids: ['mfg-pve01', 'mfg-pve02', 'mfg-pve03', 'mfg-nas01'],
      status: 'active',
    },
    {
      id: 'branch',
      name: 'Branch Office',
      cluster_type: 'network',
      icon: 'building',
      position: { x: 1050, y: 180 },
      device_ids: ['mfg-br-fw01', 'mfg-br-sw01', 'mfg-br-ap01', 'mfg-br-ap02'],
      status: 'active',
    },
  ],

  devices: {
    // ==================== Security / Edge ====================
    'mfg-fw01': {
      id: 'mfg-fw01',
      display_name: 'MFG-FW01',
      model: 'Palo Alto PA-850',
      ip: '10.10.0.1',
      status: 'up',
      device_type: 'firewall',
      cluster_id: 'edge',
      stats: { cpu: 32, memory: 48, uptime: 15552000 },
      interfaces: [
        { name: 'ethernet1/1', status: 'up', speed: 1000, in_bps: 335_000_000, out_bps: 182_000_000, utilization: 38, errors_in: 0, errors_out: 0, alias: 'WAN-Primary' },
        { name: 'ethernet1/2', status: 'up', speed: 1000, in_bps: 12_000_000, out_bps: 8_000_000, utilization: 2, errors_in: 0, errors_out: 0, alias: 'WAN-Secondary' },
        { name: 'ethernet1/3', status: 'up', speed: 10000, in_bps: 182_000_000, out_bps: 335_000_000, utilization: 5, errors_in: 0, errors_out: 0, alias: 'TRUST-to-CORE01' },
        { name: 'ethernet1/4', status: 'up', speed: 10000, in_bps: 175_000_000, out_bps: 320_000_000, utilization: 5, errors_in: 0, errors_out: 0, alias: 'TRUST-to-CORE02' },
        { name: 'ethernet1/5', status: 'up', speed: 1000, in_bps: 2_000_000, out_bps: 1_500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'DMZ' },
        { name: 'ethernet1/6', status: 'up', speed: 1000, in_bps: 500_000, out_bps: 500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'HA-Link' },
      ],
      firewall_stats: { sessions_active: 18_420, throughput_in: 335_000_000, throughput_out: 182_000_000, threats_blocked_24h: 1_247 },
      alert_count: 0,
    },
    'mfg-fw02': {
      id: 'mfg-fw02',
      display_name: 'MFG-FW02',
      model: 'Palo Alto PA-850',
      ip: '10.10.0.2',
      status: 'up',
      device_type: 'firewall',
      cluster_id: 'edge',
      stats: { cpu: 8, memory: 35, uptime: 15552000 },
      interfaces: [
        { name: 'ethernet1/1', status: 'up', speed: 1000, in_bps: 500_000, out_bps: 500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'WAN-Primary-HA' },
        { name: 'ethernet1/2', status: 'up', speed: 1000, in_bps: 500_000, out_bps: 500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'WAN-Secondary-HA' },
        { name: 'ethernet1/3', status: 'up', speed: 10000, in_bps: 1_000_000, out_bps: 1_000_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'TRUST-to-CORE01' },
        { name: 'ethernet1/4', status: 'up', speed: 10000, in_bps: 1_000_000, out_bps: 1_000_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'TRUST-to-CORE02' },
        { name: 'ethernet1/6', status: 'up', speed: 1000, in_bps: 500_000, out_bps: 500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'HA-Link' },
      ],
      firewall_stats: { sessions_active: 0, throughput_in: 0, throughput_out: 0, threats_blocked_24h: 0 },
      alert_count: 0,
    },
    'mfg-vpn-gw': {
      id: 'mfg-vpn-gw',
      display_name: 'MFG-VPN-GW',
      model: 'Cisco ASA 5525-X',
      ip: '10.10.0.5',
      status: 'up',
      device_type: 'firewall',
      cluster_id: 'edge',
      stats: { cpu: 22, memory: 41, uptime: 8640000 },
      interfaces: [
        { name: 'GigabitEthernet0/0', status: 'up', speed: 1000, in_bps: 45_000_000, out_bps: 38_000_000, utilization: 8, errors_in: 0, errors_out: 0, alias: 'OUTSIDE' },
        { name: 'GigabitEthernet0/1', status: 'up', speed: 1000, in_bps: 38_000_000, out_bps: 45_000_000, utilization: 8, errors_in: 0, errors_out: 0, alias: 'INSIDE' },
        { name: 'GigabitEthernet0/2', status: 'up', speed: 1000, in_bps: 12_000_000, out_bps: 8_000_000, utilization: 2, errors_in: 0, errors_out: 0, alias: 'S2S-Branch' },
      ],
      firewall_stats: { sessions_active: 342, throughput_in: 45_000_000, throughput_out: 38_000_000, threats_blocked_24h: 23 },
      alert_count: 0,
    },

    // ==================== Core Layer ====================
    'mfg-core-sw01': {
      id: 'mfg-core-sw01',
      display_name: 'MFG-CORE-SW01',
      model: 'Cisco Catalyst 9500-48Y4C',
      ip: '10.10.1.1',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'core',
      stats: { cpu: 22, memory: 48, uptime: 15552000 },
      interfaces: coreSw1Interfaces,
      switch_stats: {
        ports_up: coreSw1Counts.up,
        ports_down: coreSw1Counts.down,
        poe_budget_used: 0,
        poe_budget_total: 0,
        is_stp_root: true,
      },
      alert_count: 0,
    },
    'mfg-core-sw02': {
      id: 'mfg-core-sw02',
      display_name: 'MFG-CORE-SW02',
      model: 'Cisco Catalyst 9500-48Y4C',
      ip: '10.10.1.2',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'core',
      stats: { cpu: 18, memory: 44, uptime: 15552000 },
      interfaces: coreSw2Interfaces,
      switch_stats: {
        ports_up: coreSw2Counts.up,
        ports_down: coreSw2Counts.down,
        poe_budget_used: 0,
        poe_budget_total: 0,
        is_stp_root: false,
      },
      alert_count: 0,
    },

    // ==================== Distribution Layer ====================
    'mfg-dist-f1': {
      id: 'mfg-dist-f1',
      display_name: 'MFG-DIST-F1',
      model: 'Cisco Catalyst 9300-48P (stack of 2)',
      ip: '10.10.2.1',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'distribution',
      stats: { cpu: 25, memory: 52, uptime: 8640000 },
      interfaces: distF1Interfaces,
      switch_stats: {
        ports_up: distF1Counts.up,
        ports_down: distF1Counts.down,
        poe_budget_used: 287,
        poe_budget_total: 740,
        is_stp_root: false,
      },
      alert_count: 0,
    },
    'mfg-dist-f2': {
      id: 'mfg-dist-f2',
      display_name: 'MFG-DIST-F2',
      model: 'Cisco Catalyst 9300-48P (stack of 2)',
      ip: '10.10.2.2',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'distribution',
      stats: { cpu: 31, memory: 56, uptime: 8640000 },
      interfaces: distF2Interfaces,
      switch_stats: {
        ports_up: distF2Counts.up,
        ports_down: distF2Counts.down,
        poe_budget_used: 412,
        poe_budget_total: 740,
        is_stp_root: false,
      },
      alert_count: 1, // CRC errors on Te1/0/47
    },
    'mfg-dist-f3': {
      id: 'mfg-dist-f3',
      display_name: 'MFG-DIST-F3',
      model: 'Cisco Catalyst 9300-48P',
      ip: '10.10.2.3',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'distribution',
      stats: { cpu: 15, memory: 38, uptime: 8640000 },
      interfaces: distF3Interfaces,
      switch_stats: {
        ports_up: distF3Counts.up,
        ports_down: distF3Counts.down,
        poe_budget_used: 165,
        poe_budget_total: 370,
        is_stp_root: false,
      },
      alert_count: 0,
    },
    'mfg-dist-dc': {
      id: 'mfg-dist-dc',
      display_name: 'MFG-DIST-DC',
      model: 'Cisco Catalyst 9300-48P + NM-4M',
      ip: '10.10.2.4',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'distribution',
      stats: { cpu: 20, memory: 42, uptime: 8640000 },
      interfaces: distDCInterfaces,
      switch_stats: {
        ports_up: distDCCounts.up,
        ports_down: distDCCounts.down,
        poe_budget_used: 42,
        poe_budget_total: 370,
        is_stp_root: false,
      },
      alert_count: 0,
    },

    // ==================== Wireless ====================
    'mfg-wlc01': {
      id: 'mfg-wlc01',
      display_name: 'MFG-WLC01',
      model: 'Cisco 9800-L',
      ip: '10.10.3.1',
      status: 'up',
      device_type: 'other',
      cluster_id: 'wireless',
      stats: { cpu: 35, memory: 58, uptime: 8640000 },
      interfaces: [
        { name: 'GigabitEthernet0/0/0', status: 'up', speed: 1000, in_bps: 420_000_000, out_bps: 380_000_000, utilization: 42, errors_in: 0, errors_out: 0, alias: 'TRUNK-to-DIST-DC' },
        { name: 'GigabitEthernet0/0/1', status: 'up', speed: 1000, in_bps: 1_000_000, out_bps: 500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'MGMT' },
      ],
      alert_count: 0,
    },
    // Floor 1 APs (4)
    ...Object.fromEntries([1, 2, 3, 4].map(n => {
      const id = `mfg-ap-f1-0${n}`
      const clients = 8 + Math.floor(seededRand(700 + n)(1) * 15)
      return [id, {
        id,
        display_name: `MFG-AP-F1-0${n}`,
        model: 'Cisco C9120AXI',
        ip: `10.10.50.${10 + n}`,
        status: 'up' as const,
        device_type: 'access_point' as const,
        cluster_id: 'wireless',
        stats: { cpu: 15 + Math.floor(seededRand(800 + n)(1) * 20), memory: 30 + Math.floor(seededRand(900 + n)(1) * 25), uptime: 8640000 },
        interfaces: [
          { name: 'GigabitEthernet0', status: 'up' as const, speed: 1000, in_bps: clients * 2_000_000, out_bps: clients * 3_500_000, utilization: Math.round(clients * 0.8), errors_in: 0, errors_out: 0, alias: `Uplink-DIST-F1` },
        ],
        alert_count: 0,
      }]
    })),
    // Floor 2 APs (6)
    ...Object.fromEntries([1, 2, 3, 4, 5, 6].map(n => {
      const id = `mfg-ap-f2-0${n}`
      // AP-F2-03 is overloaded per PRD alert
      const clients = n === 3 ? 47 : (10 + Math.floor(seededRand(1000 + n)(1) * 18))
      return [id, {
        id,
        display_name: `MFG-AP-F2-0${n}`,
        model: 'Cisco C9120AXI',
        ip: `10.10.50.${20 + n}`,
        status: 'up' as const,
        device_type: 'access_point' as const,
        cluster_id: 'wireless',
        stats: { cpu: n === 3 ? 72 : (15 + Math.floor(seededRand(1100 + n)(1) * 20)), memory: n === 3 ? 68 : (30 + Math.floor(seededRand(1200 + n)(1) * 25)), uptime: 8640000 },
        interfaces: [
          { name: 'GigabitEthernet0', status: 'up' as const, speed: 1000, in_bps: clients * 2_000_000, out_bps: clients * 3_500_000, utilization: Math.round(clients * 0.8), errors_in: 0, errors_out: 0, alias: `Uplink-DIST-F2` },
        ],
        alert_count: n === 3 ? 1 : 0,
      }]
    })),
    // Floor 3 APs (3)
    ...Object.fromEntries([1, 2, 3].map(n => {
      const id = `mfg-ap-f3-0${n}`
      const clients = 5 + Math.floor(seededRand(1300 + n)(1) * 12)
      return [id, {
        id,
        display_name: `MFG-AP-F3-0${n}`,
        model: 'Cisco C9120AXI',
        ip: `10.10.50.${30 + n}`,
        status: 'up' as const,
        device_type: 'access_point' as const,
        cluster_id: 'wireless',
        stats: { cpu: 12 + Math.floor(seededRand(1400 + n)(1) * 15), memory: 25 + Math.floor(seededRand(1500 + n)(1) * 20), uptime: 8640000 },
        interfaces: [
          { name: 'GigabitEthernet0', status: 'up' as const, speed: 1000, in_bps: clients * 1_500_000, out_bps: clients * 2_500_000, utilization: Math.round(clients * 0.6), errors_in: 0, errors_out: 0, alias: `Uplink-DIST-F3` },
        ],
        alert_count: 0,
      }]
    })),

    // ==================== Proxmox Cluster ====================
    'mfg-pve01': {
      id: 'mfg-pve01',
      display_name: 'MFG-PVE01',
      model: 'Dell PowerEdge R750',
      ip: '10.10.5.1',
      status: 'up',
      device_type: 'server',
      cluster_id: 'proxmox',
      stats: { cpu: 34, memory: 58, uptime: 7776000, load: [4.8, 4.2, 3.9] },
      interfaces: [
        { name: 'eno1', status: 'up', speed: 10000, in_bps: 820_000_000, out_bps: 950_000_000, utilization: 18, errors_in: 0, errors_out: 0, alias: 'PROD-TRUNK' },
        { name: 'eno2', status: 'up', speed: 10000, in_bps: 350_000_000, out_bps: 280_000_000, utilization: 6, errors_in: 0, errors_out: 0, alias: 'STORAGE/CEPH' },
        { name: 'eno3', status: 'up', speed: 1000, in_bps: 2_000_000, out_bps: 1_500_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'MGMT' },
      ],
      proxmox_stats: { vms_running: 6, vms_stopped: 0, containers_running: 2, containers_stopped: 0, ceph_used_percent: 45 },
      alert_count: 0,
    },
    'mfg-pve02': {
      id: 'mfg-pve02',
      display_name: 'MFG-PVE02',
      model: 'Dell PowerEdge R750',
      ip: '10.10.5.2',
      status: 'up',
      device_type: 'server',
      cluster_id: 'proxmox',
      stats: { cpu: 28, memory: 51, uptime: 7776000, load: [3.5, 3.1, 2.8] },
      interfaces: [
        { name: 'eno1', status: 'up', speed: 10000, in_bps: 680_000_000, out_bps: 750_000_000, utilization: 14, errors_in: 0, errors_out: 0, alias: 'PROD-TRUNK' },
        { name: 'eno2', status: 'up', speed: 10000, in_bps: 290_000_000, out_bps: 240_000_000, utilization: 5, errors_in: 0, errors_out: 0, alias: 'STORAGE/CEPH' },
        { name: 'eno3', status: 'up', speed: 1000, in_bps: 1_800_000, out_bps: 1_200_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'MGMT' },
      ],
      proxmox_stats: { vms_running: 5, vms_stopped: 1, containers_running: 2, containers_stopped: 0, ceph_used_percent: 45 },
      alert_count: 0,
    },
    'mfg-pve03': {
      id: 'mfg-pve03',
      display_name: 'MFG-PVE03',
      model: 'Dell PowerEdge R650',
      ip: '10.10.5.3',
      status: 'up',
      device_type: 'server',
      cluster_id: 'proxmox',
      stats: { cpu: 12, memory: 38, uptime: 7776000, load: [1.2, 1.0, 0.9] },
      interfaces: [
        { name: 'eno1', status: 'up', speed: 10000, in_bps: 180_000_000, out_bps: 220_000_000, utilization: 4, errors_in: 0, errors_out: 0, alias: 'PROD-TRUNK' },
        { name: 'eno2', status: 'up', speed: 10000, in_bps: 120_000_000, out_bps: 95_000_000, utilization: 2, errors_in: 0, errors_out: 0, alias: 'STORAGE/CEPH' },
        { name: 'eno3', status: 'up', speed: 1000, in_bps: 800_000, out_bps: 600_000, utilization: 1, errors_in: 0, errors_out: 0, alias: 'MGMT' },
      ],
      proxmox_stats: { vms_running: 4, vms_stopped: 0, containers_running: 1, containers_stopped: 0, ceph_used_percent: 45 },
      alert_count: 1, // disk usage 94%
    },
    'mfg-nas01': {
      id: 'mfg-nas01',
      display_name: 'MFG-NAS01',
      model: 'Synology RS1221+',
      ip: '10.10.5.10',
      status: 'up',
      device_type: 'server',
      cluster_id: 'proxmox',
      stats: { cpu: 18, memory: 62, uptime: 15552000 },
      interfaces: [
        { name: 'eth0', status: 'up', speed: 10000, in_bps: 450_000_000, out_bps: 320_000_000, utilization: 8, errors_in: 0, errors_out: 0, alias: 'BOND0-iSCSI' },
        { name: 'eth1', status: 'up', speed: 1000, in_bps: 25_000_000, out_bps: 18_000_000, utilization: 4, errors_in: 0, errors_out: 0, alias: 'MGMT/SMB' },
      ],
      alert_count: 0,
    },

    // ==================== Branch Office ====================
    'mfg-br-fw01': {
      id: 'mfg-br-fw01',
      display_name: 'MFG-BR-FW01',
      model: 'Palo Alto PA-440',
      ip: '10.20.0.1',
      status: 'up',
      device_type: 'firewall',
      cluster_id: 'branch',
      stats: { cpu: 28, memory: 42, uptime: 5184000 },
      interfaces: [
        { name: 'ethernet1/1', status: 'up', speed: 1000, in_bps: 85_000_000, out_bps: 42_000_000, utilization: 12, errors_in: 0, errors_out: 0, alias: 'WAN' },
        { name: 'ethernet1/2', status: 'up', speed: 1000, in_bps: 42_000_000, out_bps: 85_000_000, utilization: 12, errors_in: 0, errors_out: 0, alias: 'LAN' },
        { name: 'ethernet1/3', status: 'up', speed: 1000, in_bps: 8_000_000, out_bps: 12_000_000, utilization: 2, errors_in: 0, errors_out: 0, alias: 'S2S-VPN-HQ' },
      ],
      firewall_stats: { sessions_active: 2_840, throughput_in: 85_000_000, throughput_out: 42_000_000, threats_blocked_24h: 89 },
      alert_count: 1, // VPN tunnel flapping
    },
    'mfg-br-sw01': {
      id: 'mfg-br-sw01',
      display_name: 'MFG-BR-SW01',
      model: 'Cisco Catalyst 9200-48P',
      ip: '10.20.1.1',
      status: 'up',
      device_type: 'switch',
      cluster_id: 'branch',
      stats: { cpu: 12, memory: 35, uptime: 5184000 },
      interfaces: branchSwInterfaces,
      switch_stats: {
        ports_up: branchSwCounts.up,
        ports_down: branchSwCounts.down,
        poe_budget_used: 124,
        poe_budget_total: 370,
        is_stp_root: true,
      },
      alert_count: 0,
    },
    'mfg-br-ap01': {
      id: 'mfg-br-ap01',
      display_name: 'MFG-BR-AP01',
      model: 'Cisco C9120AXI',
      ip: '10.20.50.1',
      status: 'up',
      device_type: 'access_point',
      cluster_id: 'branch',
      stats: { cpu: 18, memory: 35, uptime: 5184000 },
      interfaces: [
        { name: 'GigabitEthernet0', status: 'up', speed: 1000, in_bps: 15_000_000, out_bps: 28_000_000, utilization: 4, errors_in: 0, errors_out: 0, alias: 'Uplink-BR-SW01' },
      ],
      alert_count: 0,
    },
    'mfg-br-ap02': {
      id: 'mfg-br-ap02',
      display_name: 'MFG-BR-AP02',
      model: 'Cisco C9120AXI',
      ip: '10.20.50.2',
      status: 'up',
      device_type: 'access_point',
      cluster_id: 'branch',
      stats: { cpu: 14, memory: 30, uptime: 5184000 },
      interfaces: [
        { name: 'GigabitEthernet0', status: 'up', speed: 1000, in_bps: 12_000_000, out_bps: 22_000_000, utilization: 3, errors_in: 0, errors_out: 0, alias: 'Uplink-BR-SW01' },
      ],
      alert_count: 0,
    },
  },

  // ==================== Connections ====================
  connections: [
    // Core interconnect (VSS / StackWise Virtual)
    { id: 'c-core-isl', source: { device: 'mfg-core-sw01', port: 'Te1/0/47' }, target: { device: 'mfg-core-sw02', port: 'Te1/0/47' }, connection_type: 'stack', status: 'up', speed: 10000, utilization: 12, in_bps: 650_000_000, out_bps: 580_000_000, errors: 0, discards: 0 },
    { id: 'c-core-isl2', source: { device: 'mfg-core-sw01', port: 'Te1/0/48' }, target: { device: 'mfg-core-sw02', port: 'Te1/0/48' }, connection_type: 'stack', status: 'up', speed: 10000, utilization: 10, in_bps: 520_000_000, out_bps: 480_000_000, errors: 0, discards: 0 },

    // Core → Firewalls
    { id: 'c-core1-fw1', source: { device: 'mfg-core-sw01', port: 'Te1/0/45' }, target: { device: 'mfg-fw01', port: 'ethernet1/3' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 5, in_bps: 335_000_000, out_bps: 182_000_000, errors: 0, discards: 0 },
    { id: 'c-core2-fw1', source: { device: 'mfg-core-sw02', port: 'Te1/0/45' }, target: { device: 'mfg-fw01', port: 'ethernet1/4' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 5, in_bps: 320_000_000, out_bps: 175_000_000, errors: 0, discards: 0 },
    { id: 'c-core1-fw2', source: { device: 'mfg-core-sw01', port: 'Te1/0/46' }, target: { device: 'mfg-fw02', port: 'ethernet1/3' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 1, in_bps: 1_000_000, out_bps: 1_000_000, errors: 0, discards: 0 },
    { id: 'c-core2-fw2', source: { device: 'mfg-core-sw02', port: 'Te1/0/46' }, target: { device: 'mfg-fw02', port: 'ethernet1/4' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 1, in_bps: 1_000_000, out_bps: 1_000_000, errors: 0, discards: 0 },

    // Core → VPN Gateway
    { id: 'c-core1-vpn', source: { device: 'mfg-core-sw01', port: 'Gi1/0/44' }, target: { device: 'mfg-vpn-gw', port: 'GigabitEthernet0/1' }, connection_type: 'trunk', status: 'up', speed: 1000, utilization: 8, in_bps: 45_000_000, out_bps: 38_000_000, errors: 0, discards: 0 },

    // Core → Distribution
    { id: 'c-core1-df1', source: { device: 'mfg-core-sw01', port: 'Te1/0/41' }, target: { device: 'mfg-dist-f1', port: 'Te1/0/47' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 18, in_bps: 980_000_000, out_bps: 850_000_000, errors: 0, discards: 0 },
    { id: 'c-core2-df1', source: { device: 'mfg-core-sw02', port: 'Te1/0/41' }, target: { device: 'mfg-dist-f1', port: 'Te1/0/48' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 15, in_bps: 820_000_000, out_bps: 710_000_000, errors: 0, discards: 0 },
    { id: 'c-core1-df2', source: { device: 'mfg-core-sw01', port: 'Te1/0/42' }, target: { device: 'mfg-dist-f2', port: 'Te1/0/47' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 22, in_bps: 1_200_000_000, out_bps: 1_050_000_000, errors: 0, discards: 0 },
    { id: 'c-core2-df2', source: { device: 'mfg-core-sw02', port: 'Te1/0/42' }, target: { device: 'mfg-dist-f2', port: 'Te1/0/48' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 19, in_bps: 1_050_000_000, out_bps: 920_000_000, errors: 0, discards: 0 },
    { id: 'c-core1-df3', source: { device: 'mfg-core-sw01', port: 'Te1/0/43' }, target: { device: 'mfg-dist-f3', port: 'Te1/0/47' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 10, in_bps: 550_000_000, out_bps: 480_000_000, errors: 0, discards: 0 },
    { id: 'c-core2-df3', source: { device: 'mfg-core-sw02', port: 'Te1/0/43' }, target: { device: 'mfg-dist-f3', port: 'Te1/0/48' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 8, in_bps: 450_000_000, out_bps: 380_000_000, errors: 0, discards: 0 },
    { id: 'c-core1-ddc', source: { device: 'mfg-core-sw01', port: 'Te1/0/44' }, target: { device: 'mfg-dist-dc', port: 'Te1/0/47' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 25, in_bps: 1_400_000_000, out_bps: 1_200_000_000, errors: 0, discards: 0 },
    { id: 'c-core2-ddc', source: { device: 'mfg-core-sw02', port: 'Te1/0/44' }, target: { device: 'mfg-dist-dc', port: 'Te1/0/48' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 22, in_bps: 1_200_000_000, out_bps: 1_050_000_000, errors: 0, discards: 0 },

    // DC Distribution → WLC
    { id: 'c-ddc-wlc', source: { device: 'mfg-dist-dc', port: 'Gi1/0/41' }, target: { device: 'mfg-wlc01', port: 'GigabitEthernet0/0/0' }, connection_type: 'trunk', status: 'up', speed: 1000, utilization: 42, in_bps: 420_000_000, out_bps: 380_000_000, errors: 0, discards: 0 },

    // DC Distribution → Proxmox Nodes
    { id: 'c-ddc-pve01', source: { device: 'mfg-dist-dc', port: 'Te1/0/46' }, target: { device: 'mfg-pve01', port: 'eno1' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 18, in_bps: 950_000_000, out_bps: 820_000_000, errors: 0, discards: 0 },
    { id: 'c-ddc-pve02', source: { device: 'mfg-dist-dc', port: 'Te1/1/1' }, target: { device: 'mfg-pve02', port: 'eno1' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 14, in_bps: 750_000_000, out_bps: 680_000_000, errors: 0, discards: 0 },
    { id: 'c-ddc-pve03', source: { device: 'mfg-dist-dc', port: 'Te1/1/2' }, target: { device: 'mfg-pve03', port: 'eno1' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 4, in_bps: 220_000_000, out_bps: 180_000_000, errors: 0, discards: 0 },

    // DC Distribution → NAS
    { id: 'c-ddc-nas', source: { device: 'mfg-dist-dc', port: 'Te1/1/3' }, target: { device: 'mfg-nas01', port: 'eth0' }, connection_type: 'trunk', status: 'up', speed: 10000, utilization: 8, in_bps: 450_000_000, out_bps: 320_000_000, errors: 0, discards: 0 },

    // Branch internal
    { id: 'c-brfw-brsw', source: { device: 'mfg-br-fw01', port: 'ethernet1/2' }, target: { device: 'mfg-br-sw01', port: 'Gi1/0/48' }, connection_type: 'trunk', status: 'up', speed: 1000, utilization: 12, in_bps: 85_000_000, out_bps: 42_000_000, errors: 0, discards: 0 },
    { id: 'c-brsw-brap1', source: { device: 'mfg-br-sw01', port: 'Gi1/0/45' }, target: { device: 'mfg-br-ap01', port: 'GigabitEthernet0' }, connection_type: 'access', status: 'up', speed: 1000, utilization: 4, in_bps: 28_000_000, out_bps: 15_000_000, errors: 0, discards: 0 },
    { id: 'c-brsw-brap2', source: { device: 'mfg-br-sw01', port: 'Gi1/0/46' }, target: { device: 'mfg-br-ap02', port: 'GigabitEthernet0' }, connection_type: 'access', status: 'up', speed: 1000, utilization: 3, in_bps: 22_000_000, out_bps: 12_000_000, errors: 0, discards: 0 },
  ],

  // ==================== External Links ====================
  external_links: [
    {
      id: 'wan-primary',
      source: { device: 'mfg-fw01', port: 'ethernet1/1' },
      target: { label: 'Internet', type: 'cloud', icon: 'cloud', external: true },
      provider: 'Cogent',
      circuit_id: 'COG-MFG-10045',
      speed: 1000,
      sla: '99.95%',
      description: 'Primary WAN – 1 Gbps DIA',
      status: 'up',
      utilization: 38,
      in_bps: 335_000_000,
      out_bps: 182_000_000,
    },
    {
      id: 'wan-secondary',
      source: { device: 'mfg-fw01', port: 'ethernet1/2' },
      target: { label: 'Internet (Backup)', type: 'cloud', icon: 'cloud', external: true },
      provider: 'Comcast Business',
      circuit_id: 'CMCB-882451',
      speed: 500,
      sla: '99.9%',
      description: 'Secondary WAN – 500 Mbps Cable',
      status: 'up',
      utilization: 2,
      in_bps: 12_000_000,
      out_bps: 8_000_000,
    },
    {
      id: 'vpn-branch',
      source: { device: 'mfg-vpn-gw', port: 'GigabitEthernet0/2' },
      target: { label: 'Branch Office', type: 'campus', icon: 'building', external: true },
      provider: 'IPsec VPN',
      circuit_id: 'S2S-BRANCH-01',
      speed: 100,
      sla: '99.5%',
      description: 'Site-to-Site VPN – Branch Office',
      status: 'up',
      utilization: 12,
      in_bps: 8_000_000,
      out_bps: 12_000_000,
    },
  ],

  total_devices: 31,
  devices_up: 31,
  devices_down: 0,
  active_alerts: 8,
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

const now = new Date()
const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString()

export const mockAlerts: AlertSummary[] = [
  // Critical (1)
  {
    id: 'alert-1',
    device_id: 'mfg-pve03',
    severity: 'critical',
    message: 'Disk usage at 94% on /dev/sda3 (local-lvm) – DR node storage critically low',
    status: 'active',
    timestamp: minutesAgo(42),
  },
  // Warning (4)
  {
    id: 'alert-2',
    device_id: 'mfg-dist-f2',
    severity: 'warning',
    message: 'Port Te1/0/47 CRC errors increasing – 847 errors in last hour (bad cable suspected)',
    status: 'active',
    timestamp: minutesAgo(18),
  },
  {
    id: 'alert-3',
    device_id: 'mfg-br-fw01',
    severity: 'warning',
    message: 'VPN tunnel to HQ flapping – 3 reconnects in the last hour',
    status: 'active',
    timestamp: minutesAgo(35),
  },
  {
    id: 'alert-4',
    device_id: 'mfg-pve01',
    severity: 'warning',
    message: 'VM mfg-exchange CPU sustained at 82% – mail queue backlog detected',
    status: 'active',
    timestamp: hoursAgo(1),
  },
  {
    id: 'alert-5',
    device_id: 'mfg-ap-f2-03',
    severity: 'warning',
    message: 'Client count 47 exceeds threshold of 40 – conference floor congestion',
    status: 'active',
    timestamp: minutesAgo(12),
  },
  // Info (3)
  {
    id: 'alert-6',
    device_id: 'mfg-fw01',
    severity: 'info',
    message: 'GlobalProtect: 12 remote users currently connected',
    status: 'active',
    timestamp: minutesAgo(5),
  },
  {
    id: 'alert-7',
    device_id: 'mfg-pve03',
    severity: 'info',
    message: 'VM mfg-wsus on mfg-pve03: WSUS reports 23 workstations pending reboot for February security patches',
    status: 'active',
    timestamp: hoursAgo(2),
  },
  {
    id: 'alert-8',
    device_id: 'mfg-core-sw02',
    severity: 'info',
    message: 'Scheduled maintenance window in 4 hours for MFG-CORE-SW02 firmware upgrade',
    status: 'active',
    timestamp: hoursAgo(1),
  },
]

// ---------------------------------------------------------------------------
// Speedtest
// ---------------------------------------------------------------------------

export const mockSpeedtest = {
  timestamp: new Date().toISOString(),
  download_mbps: 921.4,
  upload_mbps: 893.7,
  ping_ms: 4.8,
  jitter_ms: 1.7,
  packet_loss_pct: 0.0,
  server_id: 23451,
  server_name: 'Cogent Communications',
  server_location: 'Philadelphia, PA',
  result_url: 'https://www.speedtest.net/result/16284729103',
  status: 'completed',
  indicator: 'normal' as const,
}

// ---------------------------------------------------------------------------
// Port Groups
// ---------------------------------------------------------------------------

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
  thresholds: {
    warning_mbps: number
    critical_mbps: number
  }
}

export const mockPortGroups: PortGroupStats[] = [
  {
    name: 'DC-Uplinks',
    description: 'Data center switch uplinks (4× 10G)',
    port_count: 4,
    active_port_count: 4,
    in_bps: 2_400_000_000,
    out_bps: 2_100_000_000,
    in_mbps: 2400,
    out_mbps: 2100,
    total_mbps: 4500,
    status: 'ok',
    thresholds: { warning_mbps: 6000, critical_mbps: 8000 },
  },
  {
    name: 'Internet',
    description: 'WAN links (1G primary + 500M backup)',
    port_count: 2,
    active_port_count: 2,
    in_bps: 347_000_000,
    out_bps: 190_000_000,
    in_mbps: 347,
    out_mbps: 190,
    total_mbps: 537,
    status: 'ok',
    thresholds: { warning_mbps: 1000, critical_mbps: 1300 },
  },
  {
    name: 'Branch-VPN',
    description: 'Site-to-site VPN tunnel to branch office',
    port_count: 1,
    active_port_count: 1,
    in_bps: 8_000_000,
    out_bps: 12_000_000,
    in_mbps: 8,
    out_mbps: 12,
    total_mbps: 20,
    status: 'ok',
    thresholds: { warning_mbps: 80, critical_mbps: 95 },
  },
  {
    name: 'WiFi-Uplinks',
    description: 'WLC and AP uplinks aggregate',
    port_count: 14,
    active_port_count: 14,
    in_bps: 420_000_000,
    out_bps: 380_000_000,
    in_mbps: 420,
    out_mbps: 380,
    total_mbps: 800,
    status: 'ok',
    thresholds: { warning_mbps: 2000, critical_mbps: 3000 },
  },
  {
    name: 'Server-Storage',
    description: 'iSCSI/NFS/Ceph replication traffic',
    port_count: 4,
    active_port_count: 4,
    in_bps: 1_210_000_000,
    out_bps: 935_000_000,
    in_mbps: 1210,
    out_mbps: 935,
    total_mbps: 2145,
    status: 'ok',
    thresholds: { warning_mbps: 6000, critical_mbps: 8000 },
  },
]

// ---------------------------------------------------------------------------
// VMs & LXCs (Proxmox API response)
// ---------------------------------------------------------------------------

export const mockVMs: VMListResponse = {
  vms: [
    // PVE01 VMs
    { vmid: 100, name: 'mfg-dc01', node: 'mfg-pve01', instance: 'pve1', type: 'qemu', status: 'running', cpu: 8.2, memory: 42.5, cpus: 4, maxmem: 8_589_934_592, uptime: 7776000, netin: 85_000_000, netout: 120_000_000 },
    { vmid: 104, name: 'mfg-exchange', node: 'mfg-pve01', instance: 'pve1', type: 'qemu', status: 'running', cpu: 82.1, memory: 78.5, cpus: 8, maxmem: 34_359_738_368, uptime: 5184000, netin: 280_000_000, netout: 350_000_000 },
    { vmid: 106, name: 'mfg-app01', node: 'mfg-pve01', instance: 'pve1', type: 'qemu', status: 'running', cpu: 22.4, memory: 55.8, cpus: 4, maxmem: 17_179_869_184, uptime: 5184000, netin: 95_000_000, netout: 120_000_000 },
    { vmid: 108, name: 'mfg-av01', node: 'mfg-pve01', instance: 'pve1', type: 'qemu', status: 'running', cpu: 15.3, memory: 38.2, cpus: 4, maxmem: 8_589_934_592, uptime: 7776000, netin: 45_000_000, netout: 32_000_000 },
    { vmid: 111, name: 'mfg-web01', node: 'mfg-pve01', instance: 'pve1', type: 'qemu', status: 'running', cpu: 12.8, memory: 35.1, cpus: 2, maxmem: 4_294_967_296, uptime: 5184000, netin: 32_000_000, netout: 55_000_000 },
    { vmid: 112, name: 'mfg-dc01-backup', node: 'mfg-pve01', instance: 'pve1', type: 'qemu', status: 'running', cpu: 2.1, memory: 18.5, cpus: 2, maxmem: 4_294_967_296, uptime: 7776000, netin: 8_000_000, netout: 5_000_000 },
    // PVE01 LXCs
    { vmid: 200, name: 'mfg-dns01', node: 'mfg-pve01', instance: 'pve1', type: 'lxc', status: 'running', cpu: 2.1, memory: 12.5, cpus: 1, maxmem: 1_073_741_824, uptime: 7776000, netin: 15_000_000, netout: 18_000_000 },
    { vmid: 202, name: 'mfg-ntp', node: 'mfg-pve01', instance: 'pve1', type: 'lxc', status: 'running', cpu: 0.8, memory: 5.2, cpus: 1, maxmem: 536_870_912, uptime: 7776000, netin: 2_000_000, netout: 3_000_000 },

    // PVE02 VMs
    { vmid: 101, name: 'mfg-dc02', node: 'mfg-pve02', instance: 'pve2', type: 'qemu', status: 'running', cpu: 6.8, memory: 38.2, cpus: 4, maxmem: 8_589_934_592, uptime: 7776000, netin: 72_000_000, netout: 95_000_000 },
    { vmid: 105, name: 'mfg-sql01', node: 'mfg-pve02', instance: 'pve2', type: 'qemu', status: 'running', cpu: 45.2, memory: 68.5, cpus: 8, maxmem: 34_359_738_368, uptime: 5184000, netin: 320_000_000, netout: 280_000_000 },
    { vmid: 107, name: 'mfg-file01', node: 'mfg-pve02', instance: 'pve2', type: 'qemu', status: 'running', cpu: 8.5, memory: 42.1, cpus: 4, maxmem: 17_179_869_184, uptime: 5184000, netin: 180_000_000, netout: 250_000_000 },
    { vmid: 110, name: 'mfg-monitor', node: 'mfg-pve02', instance: 'pve2', type: 'qemu', status: 'running', cpu: 18.2, memory: 52.8, cpus: 4, maxmem: 8_589_934_592, uptime: 7776000, netin: 95_000_000, netout: 42_000_000 },
    { vmid: 113, name: 'test-vm', node: 'mfg-pve02', instance: 'pve2', type: 'qemu', status: 'stopped', cpu: 0, memory: 0, cpus: 2, maxmem: 4_294_967_296, uptime: null, netin: null, netout: null },
    // PVE02 LXCs
    { vmid: 201, name: 'mfg-syslog', node: 'mfg-pve02', instance: 'pve2', type: 'lxc', status: 'running', cpu: 5.8, memory: 28.4, cpus: 2, maxmem: 2_147_483_648, uptime: 7776000, netin: 45_000_000, netout: 8_000_000 },
    { vmid: 203, name: 'mfg-wiki', node: 'mfg-pve02', instance: 'pve2', type: 'lxc', status: 'running', cpu: 3.2, memory: 22.1, cpus: 1, maxmem: 2_147_483_648, uptime: 5184000, netin: 12_000_000, netout: 18_000_000 },

    // PVE03 VMs
    { vmid: 102, name: 'mfg-print01', node: 'mfg-pve03', instance: 'pve3', type: 'qemu', status: 'running', cpu: 3.2, memory: 22.5, cpus: 2, maxmem: 4_294_967_296, uptime: 5184000, netin: 12_000_000, netout: 8_000_000 },
    { vmid: 103, name: 'mfg-wsus', node: 'mfg-pve03', instance: 'pve3', type: 'qemu', status: 'running', cpu: 5.8, memory: 35.2, cpus: 2, maxmem: 8_589_934_592, uptime: 5184000, netin: 42_000_000, netout: 28_000_000 },
    { vmid: 109, name: 'mfg-backup', node: 'mfg-pve03', instance: 'pve3', type: 'qemu', status: 'running', cpu: 8.5, memory: 28.8, cpus: 4, maxmem: 8_589_934_592, uptime: 5184000, netin: 85_000_000, netout: 12_000_000 },
    { vmid: 114, name: 'mfg-wsus-replica', node: 'mfg-pve03', instance: 'pve3', type: 'qemu', status: 'running', cpu: 2.1, memory: 15.2, cpus: 2, maxmem: 4_294_967_296, uptime: 5184000, netin: 18_000_000, netout: 5_000_000 },
    // PVE03 LXCs
    { vmid: 204, name: 'mfg-wiki-dr', node: 'mfg-pve03', instance: 'pve3', type: 'lxc', status: 'running', cpu: 1.2, memory: 8.5, cpus: 1, maxmem: 1_073_741_824, uptime: 5184000, netin: 5_000_000, netout: 3_000_000 },
  ],
  summary: {
    total_running: 19,
    total_qemu: 15,
    total_lxc: 5,
    total_cpus: 60,
    total_memory_gb: 192,
  },
}

// ---------------------------------------------------------------------------
// Proxmox Node Detail (for sidebar panel)
// ---------------------------------------------------------------------------

export interface ProxmoxNodeDetail {
  node: {
    node: string
    status: string
    cpu: number
    memory: number
    maxcpu: number
    maxmem: number
    uptime: number
  } | null
  vms: Array<{
    vmid: number
    name: string
    type: string
    status: string
    cpu: number
    memory: number
  }>
  lxcs: Array<{
    vmid: number
    name: string
    type: string
    status: string
    cpu: number
    memory: number
  }>
  storage: Array<{
    storage: string
    type: string
    used: number
    total: number
    used_percent: number
  }>
  vms_running: number
  vms_total: number
  lxcs_running: number
  lxcs_total: number
}

export const mockProxmoxNodes: Record<string, ProxmoxNodeDetail> = {
  // Keys must match device.display_name because ProxmoxPanel receives that
  'MFG-PVE01': {
    node: {
      node: 'mfg-pve01',
      status: 'online',
      cpu: 34.2,
      memory: 57.8,
      maxcpu: 16,
      maxmem: 137_438_953_472, // 128 GB
      uptime: 7776000,
    },
    vms: [
      { vmid: 100, name: 'mfg-dc01', type: 'qemu', status: 'running', cpu: 8.2, memory: 42.5 },
      { vmid: 104, name: 'mfg-exchange', type: 'qemu', status: 'running', cpu: 82.1, memory: 78.5 },
      { vmid: 106, name: 'mfg-app01', type: 'qemu', status: 'running', cpu: 22.4, memory: 55.8 },
      { vmid: 108, name: 'mfg-av01', type: 'qemu', status: 'running', cpu: 15.3, memory: 38.2 },
      { vmid: 111, name: 'mfg-web01', type: 'qemu', status: 'running', cpu: 12.8, memory: 35.1 },
      { vmid: 112, name: 'mfg-dc01-backup', type: 'qemu', status: 'running', cpu: 2.1, memory: 18.5 },
    ],
    lxcs: [
      { vmid: 200, name: 'mfg-dns01', type: 'lxc', status: 'running', cpu: 2.1, memory: 12.5 },
      { vmid: 202, name: 'mfg-ntp', type: 'lxc', status: 'running', cpu: 0.8, memory: 5.2 },
    ],
    storage: [
      { storage: 'local', type: 'dir', used: 42_949_672_960, total: 107_374_182_400, used_percent: 40.0 },
      { storage: 'local-lvm', type: 'lvmthin', used: 681_574_400_000, total: 1_099_511_627_776, used_percent: 62.0 },
      { storage: 'ceph-pool', type: 'rbd', used: 1_979_120_929_382, total: 4_398_046_511_104, used_percent: 45.0 },
      { storage: 'nfs-backup', type: 'nfs', used: 5_497_558_138_880, total: 10_995_116_277_760, used_percent: 50.0 },
    ],
    vms_running: 6,
    vms_total: 6,
    lxcs_running: 2,
    lxcs_total: 2,
  },
  'MFG-PVE02': {
    node: {
      node: 'mfg-pve02',
      status: 'online',
      cpu: 28.4,
      memory: 51.2,
      maxcpu: 16,
      maxmem: 137_438_953_472, // 128 GB
      uptime: 7776000,
    },
    vms: [
      { vmid: 101, name: 'mfg-dc02', type: 'qemu', status: 'running', cpu: 6.8, memory: 38.2 },
      { vmid: 105, name: 'mfg-sql01', type: 'qemu', status: 'running', cpu: 45.2, memory: 68.5 },
      { vmid: 107, name: 'mfg-file01', type: 'qemu', status: 'running', cpu: 8.5, memory: 42.1 },
      { vmid: 110, name: 'mfg-monitor', type: 'qemu', status: 'running', cpu: 18.2, memory: 52.8 },
      { vmid: 113, name: 'test-vm', type: 'qemu', status: 'stopped', cpu: 0, memory: 0 },
    ],
    lxcs: [
      { vmid: 201, name: 'mfg-syslog', type: 'lxc', status: 'running', cpu: 5.8, memory: 28.4 },
      { vmid: 203, name: 'mfg-wiki', type: 'lxc', status: 'running', cpu: 3.2, memory: 22.1 },
    ],
    storage: [
      { storage: 'local', type: 'dir', used: 32_212_254_720, total: 107_374_182_400, used_percent: 30.0 },
      { storage: 'local-lvm', type: 'lvmthin', used: 604_731_394_278, total: 1_099_511_627_776, used_percent: 55.0 },
      { storage: 'ceph-pool', type: 'rbd', used: 1_979_120_929_382, total: 4_398_046_511_104, used_percent: 45.0 },
      { storage: 'nfs-backup', type: 'nfs', used: 5_497_558_138_880, total: 10_995_116_277_760, used_percent: 50.0 },
    ],
    vms_running: 4,
    vms_total: 5,
    lxcs_running: 2,
    lxcs_total: 2,
  },
  'MFG-PVE03': {
    node: {
      node: 'mfg-pve03',
      status: 'online',
      cpu: 12.4,
      memory: 37.5,
      maxcpu: 8,
      maxmem: 68_719_476_736, // 64 GB
      uptime: 7776000,
    },
    vms: [
      { vmid: 102, name: 'mfg-print01', type: 'qemu', status: 'running', cpu: 3.2, memory: 22.5 },
      { vmid: 103, name: 'mfg-wsus', type: 'qemu', status: 'running', cpu: 5.8, memory: 35.2 },
      { vmid: 109, name: 'mfg-backup', type: 'qemu', status: 'running', cpu: 8.5, memory: 28.8 },
      { vmid: 114, name: 'mfg-wsus-replica', type: 'qemu', status: 'running', cpu: 2.1, memory: 15.2 },
    ],
    lxcs: [
      { vmid: 204, name: 'mfg-wiki-dr', type: 'lxc', status: 'running', cpu: 1.2, memory: 8.5 },
    ],
    storage: [
      { storage: 'local', type: 'dir', used: 32_212_254_720, total: 53_687_091_200, used_percent: 60.0 },
      { storage: 'local-lvm', type: 'lvmthin', used: 515_396_075_520, total: 548_290_560_000, used_percent: 94.0 },
      { storage: 'ceph-pool', type: 'rbd', used: 1_979_120_929_382, total: 4_398_046_511_104, used_percent: 45.0 },
    ],
    vms_running: 4,
    vms_total: 4,
    lxcs_running: 1,
    lxcs_total: 1,
  },
}

// ---------------------------------------------------------------------------
// Mermaid Diagram
// ---------------------------------------------------------------------------

export const mockMermaidDiagram = `flowchart TB
    subgraph internet_cloud["☁️ Internet"]
        internet(("Internet"))
    end

    subgraph edge["Security / Edge"]
        mfg-fw01[/"MFG-FW01<br/><small>PA-850 • 10.10.0.1</small>"\\]
        mfg-fw02[/"MFG-FW02<br/><small>PA-850 HA • 10.10.0.2</small>"\\]
        mfg-vpn-gw[/"MFG-VPN-GW<br/><small>ASA 5525-X • 10.10.0.5</small>"\\]
    end

    subgraph core["Core Layer"]
        mfg-core-sw01{{"MFG-CORE-SW01<br/><small>C9500 • 10.10.1.1</small>"}}
        mfg-core-sw02{{"MFG-CORE-SW02<br/><small>C9500 • 10.10.1.2</small>"}}
    end

    subgraph distribution["Distribution Layer"]
        mfg-dist-f1["MFG-DIST-F1<br/><small>C9300 Stack • Floor 1</small>"]
        mfg-dist-f2["MFG-DIST-F2<br/><small>C9300 Stack • Floor 2</small>"]
        mfg-dist-f3["MFG-DIST-F3<br/><small>C9300 • Floor 3</small>"]
        mfg-dist-dc["MFG-DIST-DC<br/><small>C9300 • Data Center</small>"]
    end

    subgraph wireless["Wireless"]
        mfg-wlc01["MFG-WLC01<br/><small>9800-L</small>"]
        aps_f1(("APs F1 ×4"))
        aps_f2(("APs F2 ×6"))
        aps_f3(("APs F3 ×3"))
    end

    subgraph proxmox["Proxmox Cluster"]
        mfg-pve01["MFG-PVE01<br/><small>R750 • 128GB</small>"]
        mfg-pve02["MFG-PVE02<br/><small>R750 • 128GB</small>"]
        mfg-pve03["MFG-PVE03<br/><small>R650 • 64GB</small>"]
        mfg-nas01[("MFG-NAS01<br/><small>RS1221+</small>")]
    end

    subgraph branch["Branch Office (VPN)"]
        mfg-br-fw01[/"MFG-BR-FW01<br/><small>PA-440 • 10.20.0.1</small>"\\]
        mfg-br-sw01["MFG-BR-SW01<br/><small>C9200-48P</small>"]
        br_aps(("Branch APs ×2"))
    end

    internet -.->|"1G Cogent"| mfg-fw01
    internet -.->|"500M Comcast"| mfg-fw01
    mfg-fw01 <-->|"HA"| mfg-fw02
    mfg-fw01 <-->|"10G"| mfg-core-sw01
    mfg-fw01 <-->|"10G"| mfg-core-sw02
    mfg-fw02 ---|"10G standby"| mfg-core-sw01
    mfg-vpn-gw ---|"1G"| mfg-core-sw01
    mfg-vpn-gw -.->|"IPsec S2S"| mfg-br-fw01

    mfg-core-sw01 <-->|"2×10G VSS"| mfg-core-sw02

    mfg-core-sw01 <-->|"10G"| mfg-dist-f1
    mfg-core-sw02 <-->|"10G"| mfg-dist-f1
    mfg-core-sw01 <-->|"10G"| mfg-dist-f2
    mfg-core-sw02 <-->|"10G"| mfg-dist-f2
    mfg-core-sw01 <-->|"10G"| mfg-dist-f3
    mfg-core-sw02 <-->|"10G"| mfg-dist-f3
    mfg-core-sw01 <-->|"10G"| mfg-dist-dc
    mfg-core-sw02 <-->|"10G"| mfg-dist-dc

    mfg-dist-dc -->|"10G"| mfg-wlc01
    mfg-dist-dc -->|"10G"| mfg-pve01
    mfg-dist-dc -->|"10G"| mfg-pve02
    mfg-dist-dc -->|"10G"| mfg-pve03
    mfg-dist-dc -->|"10G"| mfg-nas01

    mfg-wlc01 -->|"CAPWAP"| aps_f1
    mfg-wlc01 -->|"CAPWAP"| aps_f2
    mfg-wlc01 -->|"CAPWAP"| aps_f3

    mfg-br-fw01 -->|"1G"| mfg-br-sw01
    mfg-br-sw01 --> br_aps

    classDef firewall fill:#f97316,stroke:#c2410c,color:#fff
    classDef switch fill:#3b82f6,stroke:#1d4ed8,color:#fff
    classDef server fill:#8b5cf6,stroke:#6d28d9,color:#fff
    classDef ap fill:#22c55e,stroke:#15803d,color:#fff
    classDef storage fill:#14b8a6,stroke:#0f766e,color:#fff
    classDef external fill:#6b7280,stroke:#374151,color:#fff
    classDef alert fill:#dc2626,stroke:#991b1b,color:#fff

    class mfg-fw01,mfg-fw02,mfg-vpn-gw,mfg-br-fw01 firewall
    class mfg-core-sw01,mfg-core-sw02,mfg-dist-f1,mfg-dist-f2,mfg-dist-f3,mfg-dist-dc,mfg-br-sw01 switch
    class mfg-pve01,mfg-pve02 server
    class mfg-pve03 alert
    class mfg-nas01 storage
    class mfg-wlc01 switch
    class aps_f1,aps_f2,aps_f3,br_aps ap
    class internet external
`

// ---------------------------------------------------------------------------
// L3 Topology (VLAN view)
// ---------------------------------------------------------------------------

export const mockL3Topology: L3Topology = {
  vlans: [
    { vlan_id: 10, vlan_name: 'Management', device_count: 12 },
    { vlan_id: 20, vlan_name: 'Servers', device_count: 16 },
    { vlan_id: 30, vlan_name: 'Workstations', device_count: 4 },
    { vlan_id: 40, vlan_name: 'VoIP', device_count: 4 },
    { vlan_id: 50, vlan_name: 'Wireless-Corp', device_count: 14 },
    { vlan_id: 60, vlan_name: 'Wireless-Guest', device_count: 1 },
    { vlan_id: 70, vlan_name: 'Security', device_count: 2 },
    { vlan_id: 80, vlan_name: 'Printers', device_count: 2 },
    { vlan_id: 100, vlan_name: 'DMZ', device_count: 2 },
    { vlan_id: 200, vlan_name: 'Branch-WS', device_count: 1 },
    { vlan_id: 250, vlan_name: 'Branch-WLAN-Mgmt', device_count: 3 },
  ],

  memberships: [
    // VLAN 10 – Management
    { device_id: 'mfg-core-sw01', librenms_device_id: 1, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-core-sw02', librenms_device_id: 2, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-dist-f1', librenms_device_id: 3, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-dist-f2', librenms_device_id: 4, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-dist-f3', librenms_device_id: 5, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-dist-dc', librenms_device_id: 6, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-wlc01', librenms_device_id: 7, port_name: 'Vlan10', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-fw01', librenms_device_id: 8, port_name: 'ethernet1/3', vlan_id: 10, vlan_name: 'Management', is_untagged: false },
    { device_id: 'mfg-pve01', librenms_device_id: 9, port_name: 'eno3', vlan_id: 10, vlan_name: 'Management', is_untagged: true },
    { device_id: 'mfg-pve02', librenms_device_id: 10, port_name: 'eno3', vlan_id: 10, vlan_name: 'Management', is_untagged: true },
    { device_id: 'mfg-pve03', librenms_device_id: 11, port_name: 'eno3', vlan_id: 10, vlan_name: 'Management', is_untagged: true },
    { device_id: 'mfg-nas01', librenms_device_id: 12, port_name: 'eth1', vlan_id: 10, vlan_name: 'Management', is_untagged: true },

    // VLAN 20 – Servers (VM & LXC IPs live here)
    { device_id: 'mfg-pve01', librenms_device_id: 9, port_name: 'eno1', vlan_id: 20, vlan_name: 'Servers', is_untagged: false },
    { device_id: 'mfg-pve02', librenms_device_id: 10, port_name: 'eno1', vlan_id: 20, vlan_name: 'Servers', is_untagged: false },
    { device_id: 'mfg-pve03', librenms_device_id: 11, port_name: 'eno1', vlan_id: 20, vlan_name: 'Servers', is_untagged: false },
    { device_id: 'mfg-nas01', librenms_device_id: 12, port_name: 'eth0', vlan_id: 20, vlan_name: 'Servers', is_untagged: false },

    // VLAN 30 – Workstations
    { device_id: 'mfg-dist-f1', librenms_device_id: 3, port_name: 'Vlan30', vlan_id: 30, vlan_name: 'Workstations', is_untagged: false },
    { device_id: 'mfg-dist-f2', librenms_device_id: 4, port_name: 'Vlan30', vlan_id: 30, vlan_name: 'Workstations', is_untagged: false },
    { device_id: 'mfg-dist-f3', librenms_device_id: 5, port_name: 'Vlan30', vlan_id: 30, vlan_name: 'Workstations', is_untagged: false },

    // VLAN 40 – VoIP
    { device_id: 'mfg-dist-f1', librenms_device_id: 3, port_name: 'Vlan40', vlan_id: 40, vlan_name: 'VoIP', is_untagged: false },
    { device_id: 'mfg-dist-f2', librenms_device_id: 4, port_name: 'Vlan40', vlan_id: 40, vlan_name: 'VoIP', is_untagged: false },
    { device_id: 'mfg-dist-f3', librenms_device_id: 5, port_name: 'Vlan40', vlan_id: 40, vlan_name: 'VoIP', is_untagged: false },

    // VLAN 50 – Wireless Corp
    { device_id: 'mfg-wlc01', librenms_device_id: 7, port_name: 'Vlan50', vlan_id: 50, vlan_name: 'Wireless-Corp', is_untagged: false },
    ...([1, 2, 3, 4].map(n => ({ device_id: `mfg-ap-f1-0${n}`, librenms_device_id: 20 + n, port_name: 'GigabitEthernet0', vlan_id: 50, vlan_name: 'Wireless-Corp' as string | null, is_untagged: true as boolean }))),
    ...([1, 2, 3, 4, 5, 6].map(n => ({ device_id: `mfg-ap-f2-0${n}`, librenms_device_id: 30 + n, port_name: 'GigabitEthernet0', vlan_id: 50, vlan_name: 'Wireless-Corp' as string | null, is_untagged: true as boolean }))),
    ...([1, 2, 3].map(n => ({ device_id: `mfg-ap-f3-0${n}`, librenms_device_id: 40 + n, port_name: 'GigabitEthernet0', vlan_id: 50, vlan_name: 'Wireless-Corp' as string | null, is_untagged: true as boolean }))),

    // VLAN 60 – Wireless Guest (handled by WLC, no device-level membership beyond WLC)
    { device_id: 'mfg-wlc01', librenms_device_id: 7, port_name: 'Vlan60', vlan_id: 60, vlan_name: 'Wireless-Guest', is_untagged: false },

    // VLAN 70 – Security (cameras, badge readers on dist switches)
    { device_id: 'mfg-dist-f1', librenms_device_id: 3, port_name: 'Vlan70', vlan_id: 70, vlan_name: 'Security', is_untagged: false },
    { device_id: 'mfg-dist-f2', librenms_device_id: 4, port_name: 'Vlan70', vlan_id: 70, vlan_name: 'Security', is_untagged: false },

    // VLAN 80 – Printers
    { device_id: 'mfg-dist-f1', librenms_device_id: 3, port_name: 'Vlan80', vlan_id: 80, vlan_name: 'Printers', is_untagged: false },
    { device_id: 'mfg-dist-f2', librenms_device_id: 4, port_name: 'Vlan80', vlan_id: 80, vlan_name: 'Printers', is_untagged: false },

    // VLAN 100 – DMZ
    { device_id: 'mfg-fw01', librenms_device_id: 8, port_name: 'ethernet1/5', vlan_id: 100, vlan_name: 'DMZ', is_untagged: false },
    { device_id: 'mfg-dist-dc', librenms_device_id: 6, port_name: 'Vlan100', vlan_id: 100, vlan_name: 'DMZ', is_untagged: false },

    // VLAN 200 – Branch Workstations
    { device_id: 'mfg-br-sw01', librenms_device_id: 50, port_name: 'Vlan200', vlan_id: 200, vlan_name: 'Branch-WS', is_untagged: false },

    // VLAN 250 – Branch Wireless Management (10.20.50.0/24)
    { device_id: 'mfg-br-sw01', librenms_device_id: 50, port_name: 'Vlan250', vlan_id: 250, vlan_name: 'Branch-WLAN-Mgmt', is_untagged: false },
    { device_id: 'mfg-br-ap01', librenms_device_id: 51, port_name: 'GigabitEthernet0', vlan_id: 250, vlan_name: 'Branch-WLAN-Mgmt', is_untagged: true },
    { device_id: 'mfg-br-ap02', librenms_device_id: 52, port_name: 'GigabitEthernet0', vlan_id: 250, vlan_name: 'Branch-WLAN-Mgmt', is_untagged: true },
  ],

  vlan_groups: [
    {
      vlan_id: 10,
      vlan_name: 'Management',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-dist-f1', display_name: 'MFG-DIST-F1', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f2', display_name: 'MFG-DIST-F2', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f3', display_name: 'MFG-DIST-F3', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40] },
        { device_id: 'mfg-dist-dc', display_name: 'MFG-DIST-DC', status: 'up', is_gateway: false, vlan_ids: [10, 20, 100] },
        { device_id: 'mfg-wlc01', display_name: 'MFG-WLC01', status: 'up', is_gateway: false, vlan_ids: [10, 50, 60] },
        { device_id: 'mfg-fw01', display_name: 'MFG-FW01', status: 'up', is_gateway: false, vlan_ids: [10, 100] },
        { device_id: 'mfg-pve01', display_name: 'MFG-PVE01', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
        { device_id: 'mfg-pve02', display_name: 'MFG-PVE02', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
        { device_id: 'mfg-pve03', display_name: 'MFG-PVE03', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
        { device_id: 'mfg-nas01', display_name: 'MFG-NAS01', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 20,
      vlan_name: 'Servers',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-pve01', display_name: 'MFG-PVE01', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
        { device_id: 'mfg-pve02', display_name: 'MFG-PVE02', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
        { device_id: 'mfg-pve03', display_name: 'MFG-PVE03', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
        { device_id: 'mfg-nas01', display_name: 'MFG-NAS01', status: 'up', is_gateway: false, vlan_ids: [10, 20] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 30,
      vlan_name: 'Workstations',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-dist-f1', display_name: 'MFG-DIST-F1', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f2', display_name: 'MFG-DIST-F2', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f3', display_name: 'MFG-DIST-F3', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 40,
      vlan_name: 'VoIP',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-dist-f1', display_name: 'MFG-DIST-F1', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f2', display_name: 'MFG-DIST-F2', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f3', display_name: 'MFG-DIST-F3', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 50,
      vlan_name: 'Wireless-Corp',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-wlc01', display_name: 'MFG-WLC01', status: 'up', is_gateway: false, vlan_ids: [10, 50, 60] },
        ...([1, 2, 3, 4].map(n => ({ device_id: `mfg-ap-f1-0${n}`, display_name: `MFG-AP-F1-0${n}`, status: 'up', is_gateway: false, vlan_ids: [50] }))),
        ...([1, 2, 3, 4, 5, 6].map(n => ({ device_id: `mfg-ap-f2-0${n}`, display_name: `MFG-AP-F2-0${n}`, status: 'up', is_gateway: false, vlan_ids: [50] }))),
        ...([1, 2, 3].map(n => ({ device_id: `mfg-ap-f3-0${n}`, display_name: `MFG-AP-F3-0${n}`, status: 'up', is_gateway: false, vlan_ids: [50] }))),
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 60,
      vlan_name: 'Wireless-Guest',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-wlc01', display_name: 'MFG-WLC01', status: 'up', is_gateway: false, vlan_ids: [10, 50, 60] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 70,
      vlan_name: 'Security',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-dist-f1', display_name: 'MFG-DIST-F1', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f2', display_name: 'MFG-DIST-F2', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 80,
      vlan_name: 'Printers',
      devices: [
        { device_id: 'mfg-core-sw01', display_name: 'MFG-CORE-SW01', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-core-sw02', display_name: 'MFG-CORE-SW02', status: 'up', is_gateway: true, vlan_ids: [10, 20, 30, 40, 50, 60, 70, 80, 100] },
        { device_id: 'mfg-dist-f1', display_name: 'MFG-DIST-F1', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
        { device_id: 'mfg-dist-f2', display_name: 'MFG-DIST-F2', status: 'up', is_gateway: false, vlan_ids: [10, 30, 40, 70, 80] },
      ],
      gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02'],
    },
    {
      vlan_id: 100,
      vlan_name: 'DMZ',
      devices: [
        { device_id: 'mfg-fw01', display_name: 'MFG-FW01', status: 'up', is_gateway: true, vlan_ids: [10, 100] },
        { device_id: 'mfg-dist-dc', display_name: 'MFG-DIST-DC', status: 'up', is_gateway: false, vlan_ids: [10, 20, 100] },
      ],
      gateway_devices: ['mfg-fw01'],
    },
    {
      vlan_id: 200,
      vlan_name: 'Branch-WS',
      devices: [
        { device_id: 'mfg-br-fw01', display_name: 'MFG-BR-FW01', status: 'up', is_gateway: true, vlan_ids: [200, 250] },
        { device_id: 'mfg-br-sw01', display_name: 'MFG-BR-SW01', status: 'up', is_gateway: false, vlan_ids: [200, 250] },
      ],
      gateway_devices: ['mfg-br-fw01'],
    },
    {
      vlan_id: 250,
      vlan_name: 'Branch-WLAN-Mgmt',
      devices: [
        { device_id: 'mfg-br-fw01', display_name: 'MFG-BR-FW01', status: 'up', is_gateway: true, vlan_ids: [200, 250] },
        { device_id: 'mfg-br-sw01', display_name: 'MFG-BR-SW01', status: 'up', is_gateway: false, vlan_ids: [200, 250] },
        { device_id: 'mfg-br-ap01', display_name: 'MFG-BR-AP01', status: 'up', is_gateway: false, vlan_ids: [250] },
        { device_id: 'mfg-br-ap02', display_name: 'MFG-BR-AP02', status: 'up', is_gateway: false, vlan_ids: [250] },
      ],
      gateway_devices: ['mfg-br-fw01'],
    },
  ],

  gateway_devices: ['mfg-core-sw01', 'mfg-core-sw02', 'mfg-fw01', 'mfg-br-fw01'],
}
