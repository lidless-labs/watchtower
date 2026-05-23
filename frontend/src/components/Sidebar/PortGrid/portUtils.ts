/**
 * Port Grid Utilities
 *
 * Handles parsing Cisco interface names and organizing ports for grid layout.
 */

import type { Interface } from '../../../types/device'

/** Parsed interface name components */
export interface ParsedInterface {
  type: 'gigabit' | 'fastethernet' | 'tengig' | 'twentyfivegig' | 'fortygig' | 'hundredgig' | 'other'
  typePrefix: string
  stack: number
  module: number
  port: number
  sortKey: number
  isUplink: boolean
  original: string
}

/** Port organized for grid display */
export interface GridPort {
  interface: Interface
  parsed: ParsedInterface
  row: 'odd' | 'even' | 'uplink'
}

/** A bank of 24 ports (12 odd on top, 12 even on bottom) */
export interface PortBank {
  label: string           // e.g., "Module 1 (1-24)" or "1/1-24"
  oddPorts: GridPort[]    // Top row - 12 ports max
  evenPorts: GridPort[]   // Bottom row - 12 ports max
}

/** A module/line card with its port banks */
export interface ModulePorts {
  moduleId: number
  label: string           // e.g., "Module 1" or "Slot 1"
  banks: PortBank[]       // Banks of 24 ports each
}

/** Organized ports ready for grid rendering */
export interface OrganizedPorts {
  modules: ModulePorts[]  // Ports organized by module, then by bank
  uplinks: GridPort[]     // 10G+ ports (separate section)
  other: Interface[]      // Unparseable interfaces
}

/**
 * Parse a Cisco interface name into components.
 *
 * Examples:
 * - "Gi1/0/24" → { type: 'gigabit', stack: 1, module: 0, port: 24 }
 * - "Te1/1/1" → { type: 'tengig', stack: 1, module: 1, port: 1, isUplink: true }
 * - "Fa0/1" → { type: 'fastethernet', stack: 0, module: 0, port: 1 }
 * - "GigabitEthernet0/0/1" → { type: 'gigabit', stack: 0, module: 0, port: 1 }
 */
export function parseInterfaceName(name: string): ParsedInterface | null {
  // Normalize the name - remove spaces
  const normalized = name.trim()

  // Define interface type patterns
  const patterns: { regex: RegExp; type: ParsedInterface['type']; prefix: string; isUplink: boolean }[] = [
    // 100G interfaces
    { regex: /^(?:Hu|HundredGigE?(?:thernet)?)/i, type: 'hundredgig', prefix: 'Hu', isUplink: true },
    // 40G interfaces
    { regex: /^(?:Fo|FortyGigE?(?:thernet)?)/i, type: 'fortygig', prefix: 'Fo', isUplink: true },
    // 25G interfaces
    { regex: /^(?:Twe|TwentyFiveGigE?(?:thernet)?)/i, type: 'twentyfivegig', prefix: 'Twe', isUplink: true },
    // 10G interfaces
    { regex: /^(?:Te|TenGig(?:abit)?E?(?:thernet)?)/i, type: 'tengig', prefix: 'Te', isUplink: true },
    // 1G interfaces
    { regex: /^(?:Gi|Gig(?:abit)?E?(?:thernet)?)/i, type: 'gigabit', prefix: 'Gi', isUplink: false },
    // Fast Ethernet
    { regex: /^(?:Fa|FastEthernet)/i, type: 'fastethernet', prefix: 'Fa', isUplink: false },
  ]

  let matchedType: ParsedInterface['type'] = 'other'
  let matchedPrefix = ''
  let isUplink = false
  let remaining = normalized

  // Find matching interface type
  for (const { regex, type, prefix, isUplink: uplink } of patterns) {
    const match = normalized.match(regex)
    if (match) {
      matchedType = type
      matchedPrefix = prefix
      isUplink = uplink
      remaining = normalized.slice(match[0].length)
      break
    }
  }

  if (matchedType === 'other') {
    return null
  }

  // Parse the numeric portion: stack/module/port or module/port or port
  // Formats: "1/0/24", "0/1", "1"
  const numMatch = remaining.match(/^(\d+)(?:\/(\d+))?(?:\/(\d+))?/)
  if (!numMatch) {
    return null
  }

  let stack = 0
  let module = 0
  let port: number

  if (numMatch[3] !== undefined) {
    // Format: stack/module/port (e.g., "1/0/24")
    stack = parseInt(numMatch[1], 10)
    module = parseInt(numMatch[2], 10)
    port = parseInt(numMatch[3], 10)
  } else if (numMatch[2] !== undefined) {
    // Format: module/port (e.g., "0/1")
    module = parseInt(numMatch[1], 10)
    port = parseInt(numMatch[2], 10)
  } else {
    // Format: port only (e.g., "1")
    port = parseInt(numMatch[1], 10)
  }

  // Calculate sort key: stack * 10000 + module * 100 + port
  const sortKey = stack * 10000 + module * 100 + port

  return {
    type: matchedType,
    typePrefix: matchedPrefix,
    stack,
    module,
    port,
    sortKey,
    isUplink,
    original: name,
  }
}

/**
 * Organize interfaces into grid layout structure.
 *
 * Layout matches physical switch:
 * - Grouped by module (1/x, 2/x, etc.)
 * - Within each module, banks of 24 ports (1-24, 25-48, etc.)
 * - Within each bank: 12 odd ports on top, 12 even ports on bottom
 * - 10G+ ports go to uplinks section
 * - Unparseable interfaces go to 'other'
 */
export function organizePortsForGrid(interfaces: Interface[]): OrganizedPorts {
  const result: OrganizedPorts = {
    modules: [],
    uplinks: [],
    other: [],
  }

  // Group ports by module
  const moduleMap = new Map<number, GridPort[]>()

  for (const iface of interfaces) {
    const parsed = parseInterfaceName(iface.name)

    if (!parsed) {
      result.other.push(iface)
      continue
    }

    // Check if this is an uplink (10G+ or explicitly marked as uplink type)
    const isSpeedUplink = iface.speed >= 10000

    if (parsed.isUplink || isSpeedUplink) {
      result.uplinks.push({
        interface: iface,
        parsed,
        row: 'uplink',
      })
    } else {
      // Access port - group by module
      const moduleId = parsed.module
      if (!moduleMap.has(moduleId)) {
        moduleMap.set(moduleId, [])
      }
      moduleMap.get(moduleId)!.push({
        interface: iface,
        parsed,
        row: parsed.port % 2 === 1 ? 'odd' : 'even',
      })
    }
  }

  // Sort modules by ID
  const sortedModuleIds = Array.from(moduleMap.keys()).sort((a, b) => a - b)

  for (const moduleId of sortedModuleIds) {
    const modulePorts = moduleMap.get(moduleId)!

    // Sort ports within module by port number
    modulePorts.sort((a, b) => a.parsed.port - b.parsed.port)

    // Find the max port number to determine how many banks we need
    const maxPort = Math.max(...modulePorts.map(p => p.parsed.port))
    const numBanks = Math.ceil(maxPort / 24)

    const banks: PortBank[] = []

    for (let bankIdx = 0; bankIdx < numBanks; bankIdx++) {
      const startPort = bankIdx * 24 + 1
      const endPort = (bankIdx + 1) * 24

      // Get ports in this bank range
      const bankPorts = modulePorts.filter(
        p => p.parsed.port >= startPort && p.parsed.port <= endPort
      )

      if (bankPorts.length === 0) continue

      // Split into odd (top) and even (bottom)
      const oddPorts = bankPorts.filter(p => p.parsed.port % 2 === 1)
      const evenPorts = bankPorts.filter(p => p.parsed.port % 2 === 0)

      banks.push({
        label: `${startPort}-${endPort}`,
        oddPorts,
        evenPorts,
      })
    }

    if (banks.length > 0) {
      result.modules.push({
        moduleId,
        label: `Slot ${moduleId}`,
        banks,
      })
    }
  }

  // Sort uplinks
  result.uplinks.sort((a, b) => a.parsed.sortKey - b.parsed.sortKey)

  return result
}

/**
 * Determine port color based on status and utilization.
 */
export function getPortColor(iface: Interface): string {
  // Admin down takes precedence
  if (iface.admin_status === 'down') {
    return 'bg-gray-500' // Admin disabled
  }

  // Oper status
  if (iface.status === 'down') {
    return 'bg-status-red' // Down
  }

  // Up - check utilization for color intensity
  if (iface.utilization >= 80) {
    return 'bg-status-amber' // High utilization
  }

  return 'bg-status-green' // Normal/up
}

/**
 * Get border style for port based on errors.
 */
export function getPortBorderStyle(iface: Interface): string {
  const hasErrors = (iface.errors_in ?? 0) > 0 || (iface.errors_out ?? 0) > 0

  if (hasErrors) {
    return 'ring-2 ring-status-red ring-opacity-60'
  }

  return ''
}

/**
 * Format speed for display (e.g., 1000 → "1G", 10000 → "10G")
 */
export function formatSpeed(speedMbps: number): string {
  if (speedMbps >= 100000) return `${speedMbps / 1000}G`
  if (speedMbps >= 10000) return `${speedMbps / 1000}G`
  if (speedMbps >= 1000) return `${speedMbps / 1000}G`
  return `${speedMbps}M`
}

/**
 * Format traffic rate for display
 */
export function formatTrafficRate(bps: number): string {
  if (bps >= 1_000_000_000) return `${(bps / 1_000_000_000).toFixed(1)} Gbps`
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mbps`
  if (bps >= 1_000) return `${(bps / 1_000).toFixed(1)} Kbps`
  return `${bps} bps`
}

/**
 * Count ports by status
 */
export interface PortCounts {
  up: number
  down: number
  disabled: number
}

export function countPortsByStatus(interfaces: Interface[]): PortCounts {
  const counts: PortCounts = { up: 0, down: 0, disabled: 0 }

  for (const iface of interfaces) {
    if (iface.admin_status === 'down') {
      counts.disabled++
    } else if (iface.status === 'down') {
      counts.down++
    } else {
      counts.up++
    }
  }

  return counts
}
