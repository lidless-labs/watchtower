import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Panel,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Node,
  type Edge,
  type NodeChange,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { useNocStore } from '../../store/nocStore'
import { useSettingsStore } from '../../store/settingsStore'
import ClusterNode from './nodes/ClusterNode'
import DeviceNode from './nodes/DeviceNode'
import ExternalNode from './nodes/ExternalNode'
import VlanGroupNode from './nodes/VlanGroupNode'
import TrafficEdge from './edges/TrafficEdge'
import PhysicalLinkEdge from './edges/PhysicalLinkEdge'
import MermaidModal from './MermaidModal'
import { fetchL3Topology } from '../../api/endpoints'
import type { Topology, Cluster } from '../../types/topology'
import type { L3Topology, ViewMode } from '../../types/vlan'

// Sanitize ID for Mermaid (only alphanumeric and dashes allowed)
function sanitizeMermaidId(id: string): string {
  return id.replace(/[^a-zA-Z0-9-]/g, '_')
}

// Generate Mermaid flowchart from topology data
function generateMermaidDiagram(topology: Topology): string {
  const lines: string[] = ['flowchart TB']

  // Create subgraphs for each cluster
  topology.clusters.forEach((cluster) => {
    const clusterId = sanitizeMermaidId(cluster.id)
    const clusterName = cluster.name.replace(/"/g, '\\"')

    lines.push(`    subgraph ${clusterId}["${clusterName}"]`)

    // Add devices in this cluster
    cluster.device_ids.forEach((deviceId) => {
      const device = topology.devices[deviceId]
      if (device) {
        const safeId = sanitizeMermaidId(deviceId)
        const displayName = (device.display_name || deviceId).replace(/"/g, '\\"')
        const ip = device.ip ? `<br/><small>${device.ip}</small>` : ''
        const label = `${displayName}${ip}`
        // Use different shapes based on device type
        const shape = device.device_type === 'switch' ? `{{"${label}"}}`
                    : device.device_type === 'firewall' ? `[/"${label}"\\]`
                    : `["${label}"]`
        lines.push(`        ${safeId}${shape}`)
      }
    })

    lines.push('    end')
    lines.push('')
  })

  // Add external endpoints
  const externalNodes = new Set<string>()
  topology.external_links.forEach((link) => {
    if (link.target.label) {
      const safeId = sanitizeMermaidId(`ext_${link.target.label}`)
      if (!externalNodes.has(safeId)) {
        externalNodes.add(safeId)
        const label = link.target.label.replace(/"/g, '\\"')
        lines.push(`    ${safeId}(("${label}"))`)
      }
    }
  })

  if (externalNodes.size > 0) lines.push('')

  // Add connections
  const addedConnections = new Set<string>()

  topology.connections.forEach((conn) => {
    const sourceId = conn.source.device
    const targetId = conn.target.device

    if (sourceId && targetId) {
      const safeSource = sanitizeMermaidId(sourceId)
      const safeTarget = sanitizeMermaidId(targetId)
      const connKey = [safeSource, safeTarget].sort().join('--')

      if (!addedConnections.has(connKey)) {
        addedConnections.add(connKey)

        // Add port labels if available
        const sourcePort = conn.source.port ? ` ${conn.source.port}` : ''
        const targetPort = conn.target.port ? ` ${conn.target.port}` : ''

        if (sourcePort || targetPort) {
          lines.push(`    ${safeSource} ---|"${sourcePort.trim()} ↔ ${targetPort.trim()}"| ${safeTarget}`)
        } else {
          lines.push(`    ${safeSource} --- ${safeTarget}`)
        }
      }
    }
  })

  // Add external link connections
  topology.external_links.forEach((link) => {
    const sourceDevice = link.source.device
    const targetLabel = link.target.label

    if (sourceDevice && targetLabel) {
      const safeSource = sanitizeMermaidId(sourceDevice)
      const safeTarget = sanitizeMermaidId(`ext_${targetLabel}`)
      lines.push(`    ${safeSource} -.-> ${safeTarget}`)
    }
  })

  return lines.join('\n')
}

// Trigger file download in browser
function downloadFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const nodeTypes = {
  cluster: ClusterNode,
  device: DeviceNode,
  external: ExternalNode,
  vlanGroup: VlanGroupNode,
} as const

const edgeTypes = {
  traffic: TrafficEdge,
  physical: PhysicalLinkEdge,
} as const

const STORAGE_KEY = 'watchtower-node-positions'

// Node size constants for collision detection
const NODE_SIZES: Record<string, { width: number; height: number }> = {
  cluster: { width: 180, height: 120 },
  device: { width: 160, height: 80 },
  external: { width: 140, height: 100 },
  vlanGroup: { width: 220, height: 150 },
}

const PADDING = 40 // Padding between nodes

// Load saved positions from localStorage
function loadSavedPositions(): Record<string, { x: number; y: number }> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? JSON.parse(saved) : {}
  } catch {
    return {}
  }
}

// Save positions to localStorage
function savePositions(positions: Record<string, { x: number; y: number }>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(positions))
  } catch {
    // localStorage might be full or disabled
  }
}

// Clear saved positions
function clearSavedPositions() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

// Bounding box type
interface BoundingBox {
  id: string
  clusterId?: string // For device nodes, track which cluster they belong to
  x: number
  y: number
  width: number
  height: number
  right: number
  bottom: number
}

// Calculate bounding box for a node
function getNodeBoundingBox(node: Node): BoundingBox {
  const size = NODE_SIZES[node.type || 'cluster'] || NODE_SIZES.cluster
  return {
    id: node.id,
    clusterId: (node.data as { clusterId?: string })?.clusterId,
    x: node.position.x - PADDING,
    y: node.position.y - PADDING,
    width: size.width + PADDING * 2,
    height: size.height + PADDING * 2,
    right: node.position.x + size.width + PADDING,
    bottom: node.position.y + size.height + PADDING,
  }
}

// Check if two bounding boxes overlap
function boxesOverlap(a: BoundingBox, b: BoundingBox): boolean {
  return !(a.right < b.x || b.right < a.x || a.bottom < b.y || b.bottom < a.y)
}

// Calculate how much to push box B away from box A
function calculatePushVector(
  a: BoundingBox,
  b: BoundingBox
): { x: number; y: number } {
  // Calculate overlap on each axis
  const overlapX =
    Math.min(a.right, b.right) - Math.max(a.x, b.x)
  const overlapY =
    Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y)

  // Calculate centers
  const aCenterX = a.x + a.width / 2
  const aCenterY = a.y + a.height / 2
  const bCenterX = b.x + b.width / 2
  const bCenterY = b.y + b.height / 2

  // Push in the direction of least overlap, away from A's center
  if (overlapX < overlapY) {
    // Push horizontally
    const direction = bCenterX > aCenterX ? 1 : -1
    return { x: overlapX * direction + PADDING * direction, y: 0 }
  } else {
    // Push vertically
    const direction = bCenterY > aCenterY ? 1 : -1
    return { x: 0, y: overlapY * direction + PADDING * direction }
  }
}

// Resolve all overlaps between nodes
function resolveOverlaps(
  nodes: Node[],
  expandedClusterIds: Set<string>
): Node[] {
  const result = nodes.map((n) => ({ ...n, position: { ...n.position } }))
  const maxIterations = 50 // Prevent infinite loops
  let iteration = 0
  let hasOverlap = true

  while (hasOverlap && iteration < maxIterations) {
    hasOverlap = false
    iteration++

    // Build bounding boxes
    const boxes = result.map(getNodeBoundingBox)

    // Group device nodes by their cluster
    const clusterDeviceBoxes = new Map<string, BoundingBox[]>()
    boxes.forEach((box) => {
      if (box.clusterId) {
        const existing = clusterDeviceBoxes.get(box.clusterId) || []
        existing.push(box)
        clusterDeviceBoxes.set(box.clusterId, existing)
      }
    })

    // Calculate expanded cluster bounding boxes (encompasses all device nodes)
    const expandedClusterBounds = new Map<string, BoundingBox>()
    clusterDeviceBoxes.forEach((deviceBoxes, clusterId) => {
      if (deviceBoxes.length > 0) {
        const minX = Math.min(...deviceBoxes.map((b) => b.x))
        const minY = Math.min(...deviceBoxes.map((b) => b.y))
        const maxRight = Math.max(...deviceBoxes.map((b) => b.right))
        const maxBottom = Math.max(...deviceBoxes.map((b) => b.bottom))
        expandedClusterBounds.set(clusterId, {
          id: clusterId,
          x: minX,
          y: minY,
          width: maxRight - minX,
          height: maxBottom - minY,
          right: maxRight,
          bottom: maxBottom,
        })
      }
    })

    // Check each pair of "groups" (collapsed clusters, expanded cluster bounds, externals)
    for (let i = 0; i < result.length; i++) {
      const nodeA = result[i]
      const boxA = boxes[i]

      // Skip device nodes - they move with their cluster
      if (nodeA.type === 'device') continue

      // Skip expanded clusters since they become device nodes
      if (nodeA.type === 'cluster' && expandedClusterIds.has(nodeA.id)) {
        continue
      }

      for (let j = i + 1; j < result.length; j++) {
        const nodeB = result[j]
        const boxB = boxes[j]

        // Skip device nodes in same cluster
        if (nodeB.type === 'device') continue

        // Check for overlap
        if (boxesOverlap(boxA, boxB)) {
          hasOverlap = true
          const push = calculatePushVector(boxA, boxB)

          // Push node B
          result[j].position.x += push.x
          result[j].position.y += push.y
        }
      }
    }

    // Now check expanded clusters against other nodes
    expandedClusterBounds.forEach((clusterBound, clusterId) => {
      for (let i = 0; i < result.length; i++) {
        const node = result[i]
        const box = boxes[i]

        // Skip nodes that belong to this cluster
        if (node.type === 'device' && (node.data as { clusterId?: string })?.clusterId === clusterId) {
          continue
        }

        // Skip other device nodes (they'll move with their cluster)
        if (node.type === 'device') continue

        // Check if this node overlaps with the expanded cluster
        if (boxesOverlap(clusterBound, box)) {
          hasOverlap = true
          const push = calculatePushVector(clusterBound, box)

          // Push the node
          result[i].position.x += push.x
          result[i].position.y += push.y
        }
      }
    })

    // Check expanded clusters against each other
    const clusterIds = Array.from(expandedClusterBounds.keys())
    for (let i = 0; i < clusterIds.length; i++) {
      for (let j = i + 1; j < clusterIds.length; j++) {
        const boundA = expandedClusterBounds.get(clusterIds[i])!
        const boundB = expandedClusterBounds.get(clusterIds[j])!

        if (boxesOverlap(boundA, boundB)) {
          hasOverlap = true
          const push = calculatePushVector(boundA, boundB)

          // Push all devices in cluster B
          result.forEach((node) => {
            if (
              node.type === 'device' &&
              (node.data as { clusterId?: string })?.clusterId === clusterIds[j]
            ) {
              node.position.x += push.x
              node.position.y += push.y
            }
          })
        }
      }
    }
  }

  return result
}

// Calculate positions for expanded device nodes in a grid layout
function getExpandedDevicePositions(
  cluster: Cluster,
  deviceCount: number,
  savedPositions: Record<string, { x: number; y: number }>,
  deviceIds: string[]
): { x: number; y: number }[] {
  // Use 3 columns for better spacing
  const cols = Math.min(3, deviceCount)
  const rows = Math.ceil(deviceCount / cols)
  const spacingX = 200
  const spacingY = 120

  // Center the grid on the cluster position
  const gridWidth = (cols - 1) * spacingX
  const gridHeight = (rows - 1) * spacingY
  const startX = cluster.position.x - gridWidth / 2
  const startY = cluster.position.y - gridHeight / 2

  return Array.from({ length: deviceCount }, (_, i) => {
    const deviceId = deviceIds[i]
    // Use saved position if available
    if (savedPositions[deviceId]) {
      return savedPositions[deviceId]
    }
    // Otherwise calculate grid position
    const col = i % cols
    const row = Math.floor(i / cols)
    return {
      x: startX + col * spacingX,
      y: startY + row * spacingY,
    }
  })
}
// Generate automatic layout positions for clusters
function getClusterDefaultPosition(
  index: number,
  totalClusters: number,
  cluster: Cluster,
  forceAutoLayout: boolean = false
): { x: number; y: number } {
  // If cluster has a reasonable position from config and we're not forcing auto-layout, use it
  if (!forceAutoLayout && (cluster.position.x > 0 || cluster.position.y > 0)) {
    return { x: cluster.position.x, y: cluster.position.y }
  }

  // Auto-layout: arrange clusters in a grid pattern
  const cols = Math.min(4, Math.ceil(Math.sqrt(totalClusters)))
  const spacingX = 350
  const spacingY = 300
  const col = index % cols
  const row = Math.floor(index / cols)

  return {
    x: 150 + col * spacingX,
    y: 100 + row * spacingY,
  }
}

function topologyToNodes(
  topology: Topology,
  expandedClusters: Set<string>,
  savedPositions: Record<string, { x: number; y: number }>,
  forceAutoLayout: boolean = false
): Node[] {
  const nodes: Node[] = []

  // Create cluster or device nodes based on expansion state
  topology.clusters.forEach((cluster, index) => {
    const clusterDevices = cluster.device_ids
      .map((id) => topology.devices[id])
      .filter(Boolean)
    const deviceIds = clusterDevices.map((d) => d.id)

    // Get default position for this cluster (force auto-layout ignores config positions)
    const defaultPos = getClusterDefaultPosition(index, topology.clusters.length, cluster, forceAutoLayout)

    if (expandedClusters.has(cluster.id)) {
      // Use saved cluster position or default for calculating device grid
      const clusterPos = savedPositions[cluster.id] || defaultPos
      const clusterWithPos = { ...cluster, position: clusterPos }

      // Render individual device nodes in a grid layout
      const positions = getExpandedDevicePositions(
        clusterWithPos,
        clusterDevices.length,
        savedPositions,
        deviceIds
      )

      clusterDevices.forEach((device, deviceIndex) => {
        nodes.push({
          id: device.id,
          type: 'device',
          position: positions[deviceIndex],
          data: {
            device,
            clusterId: cluster.id,
            clusterColor: '#39d5ff',
          },
        })
      })
    } else {
      // Render collapsed cluster node - use saved position or default
      const position = savedPositions[cluster.id] || defaultPos
      nodes.push({
        id: cluster.id,
        type: 'cluster',
        position,
        data: {
          cluster,
          devices: clusterDevices,
        },
      })
    }
  })

  // Create external endpoint nodes from external links
  // Position external nodes above the edge tier for clean topology
  const externalEndpoints = new Map<string, { label: string; type: string; icon: string; x: number; y: number }>()
  let externalIndex = 0

  topology.external_links.forEach((link) => {
    if (!externalEndpoints.has(link.target.label)) {
      const isCloud = link.target.type === 'cloud'
      externalEndpoints.set(link.target.label, {
        label: link.target.label,
        type: link.target.type,
        icon: link.target.icon,
        // Place cloud/WAN endpoints above edge, campus endpoints to the right
        x: isCloud ? 300 + externalIndex * 280 : 1050,
        y: isCloud ? -120 : -50,
      })
      externalIndex++
    }

    if (link.source.label && !externalEndpoints.has(link.source.label)) {
      externalEndpoints.set(link.source.label, {
        label: link.source.label,
        type: 'campus',
        icon: 'building',
        x: 1050,
        y: -50,
      })
    }
  })

  externalEndpoints.forEach((endpoint, label) => {
    const nodeId = `external-${label}`
    const position = savedPositions[nodeId] || { x: endpoint.x, y: endpoint.y }
    nodes.push({
      id: nodeId,
      type: 'external',
      position,
      data: {
        label: endpoint.label,
        type: endpoint.type,
        icon: endpoint.icon,
      },
    })
  })

  return nodes
}

function topologyToEdges(
  topology: Topology,
  expandedClusters: Set<string>,
  speedtestStatus: 'normal' | 'degraded' | 'down' | null = null
): Edge[] {
  const edges: Edge[] = []
  const addedEdges = new Set<string>()

  // Helper to determine edge status based on device states
  const getEdgeStatus = (sourceDeviceId: string, targetDeviceId: string, connStatus: string): string => {
    const sourceDevice = topology.devices[sourceDeviceId]
    const targetDevice = topology.devices[targetDeviceId]

    // If either device is down, the edge is down
    if (sourceDevice?.status === 'down' || targetDevice?.status === 'down') {
      return 'down'
    }
    // If either device is degraded, show degraded
    if (sourceDevice?.status === 'degraded' || targetDevice?.status === 'degraded') {
      return 'degraded'
    }
    // Otherwise use the connection's own status
    return connStatus ?? 'up'
  }

  // Process all device-to-device connections
  topology.connections.forEach((conn) => {
    const sourceDevice = conn.source.device
    const targetDevice = conn.target.device

    if (sourceDevice && targetDevice) {
      const sourceCluster = topology.devices[sourceDevice]?.cluster_id
      const targetCluster = topology.devices[targetDevice]?.cluster_id

      if (!sourceCluster || !targetCluster) return

      const sourceExpanded = expandedClusters.has(sourceCluster)
      const targetExpanded = expandedClusters.has(targetCluster)

      // Determine actual source/target node IDs based on expansion state
      let actualSource: string
      let actualTarget: string

      if (sourceExpanded && targetExpanded) {
        actualSource = sourceDevice
        actualTarget = targetDevice
      } else if (sourceExpanded) {
        actualSource = sourceDevice
        actualTarget = targetCluster
      } else if (targetExpanded) {
        actualSource = sourceCluster
        actualTarget = targetDevice
      } else {
        actualSource = sourceCluster
        actualTarget = targetCluster
      }

      if (actualSource === actualTarget) return

      const edgeKey = [actualSource, actualTarget].sort().join('--')

      if (!addedEdges.has(edgeKey)) {
        addedEdges.add(edgeKey)

        // Determine status based on device states
        const edgeStatus = getEdgeStatus(sourceDevice, targetDevice, conn.status)

        edges.push({
          id: `edge-${edgeKey}`,
          source: actualSource,
          target: actualTarget,
          type: 'physical',
          data: {
            sourcePort: conn.source?.port,
            targetPort: conn.target?.port,
            speed: conn.speed ?? 1000,
            utilization: conn.utilization ?? 0,
            status: edgeStatus,
            connectionType: conn.connection_type,
            description: conn.description,
          },
        })
      }
    }
  })

  // Create edges for external links
  topology.external_links.forEach((link) => {
    const sourceDeviceId = link.source.device
    const sourceCluster = sourceDeviceId
      ? topology.devices[sourceDeviceId]?.cluster_id
      : null

    let sourceId: string | null

    if (sourceDeviceId && sourceCluster) {
      sourceId = expandedClusters.has(sourceCluster) ? sourceDeviceId : sourceCluster
    } else if (link.source.label) {
      sourceId = `external-${link.source.label}`
    } else {
      sourceId = null
    }

    const targetId = `external-${link.target.label}`

    if (sourceId) {
      // Check if source device is down
      let externalLinkStatus = link.status ?? 'up'
      if (sourceDeviceId) {
        const sourceDevice = topology.devices[sourceDeviceId]
        if (sourceDevice?.status === 'down') {
          externalLinkStatus = 'down'
        } else if (sourceDevice?.status === 'degraded') {
          externalLinkStatus = 'degraded'
        }
      }

      edges.push({
        id: `edge-${link.id}`,
        source: sourceId,
        target: targetId,
        type: 'physical',
        data: {
          sourcePort: link.source?.port,
          speed: link.speed ?? 1000,
          utilization: link.utilization ?? 0,
          status: externalLinkStatus,
          connectionType: 'wan',
          description: link.description,
          speedtestStatus,
        },
      })
    }
  })

  return edges
}

// Convert L3 topology data to React Flow nodes
function l3TopologyToNodes(
  l3Topology: L3Topology,
  selectedVlans: Set<number>,
  savedPositions: Record<string, { x: number; y: number }>
): Node[] {
  const nodes: Node[] = []

  // Filter VLAN groups if filter is active
  const vlanGroups = selectedVlans.size > 0
    ? l3Topology.vlan_groups.filter((g) => selectedVlans.has(g.vlan_id))
    : l3Topology.vlan_groups

  // Create VLAN group nodes in a grid layout
  const cols = Math.ceil(Math.sqrt(vlanGroups.length))
  const spacingX = 300
  const spacingY = 250

  vlanGroups.forEach((vlanGroup, index) => {
    const nodeId = `vlan-${vlanGroup.vlan_id}`

    // Use saved position or calculate grid position
    const defaultPos = {
      x: 100 + (index % cols) * spacingX,
      y: 100 + Math.floor(index / cols) * spacingY,
    }
    const position = savedPositions[nodeId] || defaultPos

    nodes.push({
      id: nodeId,
      type: 'vlanGroup',
      position,
      data: {
        vlanGroup,
      },
    })
  })

  return nodes
}

// Convert L3 topology to React Flow edges (gateway connections between VLANs)
function l3TopologyToEdges(l3Topology: L3Topology, selectedVlans: Set<number>): Edge[] {
  const edges: Edge[] = []
  const addedEdges = new Set<string>()

  // Connect VLANs that share gateway devices
  const vlanGroups = selectedVlans.size > 0
    ? l3Topology.vlan_groups.filter((g) => selectedVlans.has(g.vlan_id))
    : l3Topology.vlan_groups

  // Build map of gateway device to VLANs
  const gatewayToVlans = new Map<string, number[]>()
  vlanGroups.forEach((vlanGroup) => {
    vlanGroup.gateway_devices.forEach((gatewayId) => {
      const vlans = gatewayToVlans.get(gatewayId) || []
      vlans.push(vlanGroup.vlan_id)
      gatewayToVlans.set(gatewayId, vlans)
    })
  })

  // Create edges between VLANs that share gateways
  gatewayToVlans.forEach((vlanIds) => {
    for (let i = 0; i < vlanIds.length; i++) {
      for (let j = i + 1; j < vlanIds.length; j++) {
        const sourceId = `vlan-${vlanIds[i]}`
        const targetId = `vlan-${vlanIds[j]}`
        const edgeKey = [sourceId, targetId].sort().join('--')

        if (!addedEdges.has(edgeKey)) {
          addedEdges.add(edgeKey)
          edges.push({
            id: `l3-edge-${edgeKey}`,
            source: sourceId,
            target: targetId,
            type: 'physical',
            data: {
              status: 'up',
              connectionType: 'l3',
              description: 'L3 Gateway Link',
            },
          })
        }
      }
    }
  })

  return edges
}

function TopologyCanvasInner() {
  const topology = useNocStore((state) => state.topology)
  const expandedClusters = useNocStore((state) => state.expandedClusters)
  const selectDevice = useNocStore((state) => state.selectDevice)
  const toggleClusterExpanded = useNocStore((state) => state.toggleClusterExpanded)
  const speedtestStatus = useNocStore((state) => state.speedtestStatus)

  // Settings
  const showPortLabels = useSettingsStore((state) => state.showPortLabels)
  const setShowPortLabels = useSettingsStore((state) => state.setShowPortLabels)

  // L3 state
  const viewMode = useNocStore((state) => state.viewMode)
  const setViewMode = useNocStore((state) => state.setViewMode)
  const l3Topology = useNocStore((state) => state.l3Topology)
  const setL3Topology = useNocStore((state) => state.setL3Topology)
  const selectedVlans = useNocStore((state) => state.selectedVlans)
  const toggleVlanFilter = useNocStore((state) => state.toggleVlanFilter)
  const clearVlanFilter = useNocStore((state) => state.clearVlanFilter)

  const { fitView } = useReactFlow()

  const [resetCounter, setResetCounter] = useState(0)
  const [useAutoLayout, setUseAutoLayout] = useState(false)
  const [showMermaidModal, setShowMermaidModal] = useState(false)
  const [mermaidDiagram, setMermaidDiagram] = useState('')
  const [l3Loading, setL3Loading] = useState(false)
  const savedPositionsRef = useRef<Record<string, { x: number; y: number }>>(
    loadSavedPositions()
  )
  const prevExpandedRef = useRef<Set<string>>(new Set())

  // Fetch L3 topology when view mode changes to L3
  useEffect(() => {
    if (viewMode === 'l3' && !l3Topology) {
      setL3Loading(true)
      fetchL3Topology()
        .then((data) => {
          setL3Topology(data)
          setL3Loading(false)
          // Fit view after L3 data loads
          setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
        })
        .catch((err) => {
          console.error('Failed to fetch L3 topology:', err)
          setL3Loading(false)
        })
    }
  }, [viewMode, l3Topology, setL3Topology, fitView])

  // Handle view mode change
  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode)
    clearVlanFilter()
    // Fit view after mode change
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 100)
  }, [setViewMode, clearVlanFilter, fitView])

  // Generate nodes and resolve overlaps
  const processedNodes = useMemo(() => {
    // L3 mode
    if (viewMode === 'l3') {
      if (!l3Topology) return []
      return l3TopologyToNodes(l3Topology, selectedVlans, savedPositionsRef.current)
    }

    // L2 mode
    if (!topology) return []

    let nodes = topologyToNodes(topology, expandedClusters, savedPositionsRef.current, useAutoLayout)

    // Only resolve overlaps if clusters changed or layout was reset
    const expandedChanged =
      expandedClusters.size !== prevExpandedRef.current.size ||
      [...expandedClusters].some((id) => !prevExpandedRef.current.has(id))

    if (expandedChanged || resetCounter > 0 || useAutoLayout) {
      nodes = resolveOverlaps(nodes, expandedClusters)
    }

    return nodes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, l3Topology, viewMode, expandedClusters, selectedVlans, resetCounter, useAutoLayout])

  const initialEdges = useMemo(() => {
    // L3 mode
    if (viewMode === 'l3') {
      if (!l3Topology) return []
      return l3TopologyToEdges(l3Topology, selectedVlans)
    }
    // L2 mode
    return topology ? topologyToEdges(topology, expandedClusters, speedtestStatus) : []
  }, [topology, l3Topology, viewMode, expandedClusters, selectedVlans, speedtestStatus])

  const [nodes, setNodes, onNodesChange] = useNodesState(processedNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Handle node position changes (dragging)
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes)

      changes.forEach((change) => {
        if (change.type === 'position' && change.dragging === false && change.position) {
          savedPositionsRef.current[change.id] = {
            x: change.position.x,
            y: change.position.y,
          }
          savePositions(savedPositionsRef.current)
        }
      })
    },
    [onNodesChange]
  )

  // Reset layout - auto-arrange all nodes in a clean grid
  const handleResetLayout = useCallback(() => {
    clearSavedPositions()
    savedPositionsRef.current = {}
    prevExpandedRef.current = new Set()
    setUseAutoLayout(true)
    setResetCounter((c) => c + 1)
    // Center viewport on the reset layout after nodes update, then turn off auto-layout
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 300 })
      // Save the new auto-layout positions and turn off auto-layout mode
      setTimeout(() => setUseAutoLayout(false), 100)
    }, 100)
  }, [fitView])

  // Export topology as Mermaid diagram
  const handleExportMermaid = useCallback(() => {
    if (!topology) return
    const mermaidContent = generateMermaidDiagram(topology)
    const timestamp = new Date().toISOString().slice(0, 10)
    downloadFile(mermaidContent, `topology-${timestamp}.mmd`)
  }, [topology])

  // Visualize topology as Mermaid diagram in modal
  const handleVisualizeMermaid = useCallback(() => {
    if (!topology) return
    const mermaidContent = generateMermaidDiagram(topology)
    setMermaidDiagram(mermaidContent)
    setShowMermaidModal(true)
  }, [topology])

  // Update nodes when topology, L3 topology, or view mode changes
  useEffect(() => {
    // L3 mode
    if (viewMode === 'l3') {
      if (l3Topology) {
        const newNodes = l3TopologyToNodes(l3Topology, selectedVlans, savedPositionsRef.current)
        const newEdges = l3TopologyToEdges(l3Topology, selectedVlans)
        setNodes(newNodes)
        setEdges(newEdges)
      }
      return
    }

    // L2 mode
    if (topology) {
      let newNodes = topologyToNodes(topology, expandedClusters, savedPositionsRef.current, useAutoLayout)

      // Check if expansion state changed
      const expandedChanged =
        expandedClusters.size !== prevExpandedRef.current.size ||
        [...expandedClusters].some((id) => !prevExpandedRef.current.has(id))

      if (expandedChanged || useAutoLayout) {
        // Resolve overlaps when clusters expand/collapse
        newNodes = resolveOverlaps(newNodes, expandedClusters)

        // Save the new positions after collision resolution
        newNodes.forEach((node) => {
          if (node.type === 'cluster' || node.type === 'external') {
            savedPositionsRef.current[node.id] = { ...node.position }
          }
        })
        savePositions(savedPositionsRef.current)

        // Fit view after a short delay to show new layout
        setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
      }

      prevExpandedRef.current = new Set(expandedClusters)
      setNodes(newNodes)
      setEdges(topologyToEdges(topology, expandedClusters, speedtestStatus))
    }
  }, [topology, l3Topology, viewMode, expandedClusters, selectedVlans, speedtestStatus, setNodes, setEdges, resetCounter, useAutoLayout, fitView])

  // Single click: select device for sidebar details
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'device') {
        selectDevice(node.id)
      }
    },
    [selectDevice]
  )

  // Double click: toggle expand/collapse
  const onNodeDoubleClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      if (node.type === 'cluster') {
        toggleClusterExpanded(node.id)
      } else if (node.type === 'device') {
        const clusterId = (node.data as { clusterId?: string }).clusterId
        if (clusterId) {
          toggleClusterExpanded(clusterId)
        }
      }
    },
    [toggleClusterExpanded]
  )

  // Show loading state for L3 mode
  if (viewMode === 'l3' && l3Loading) {
    return (
      <div className="w-full h-full flex items-center justify-center text-text-secondary">
        Loading L3 topology...
      </div>
    )
  }

  // Require data for the current view mode
  if (viewMode === 'l2' && !topology) {
    return null
  }
  if (viewMode === 'l3' && !l3Topology) {
    return null
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={onNodeClick}
      onNodeDoubleClick={onNodeDoubleClick}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.2}
      maxZoom={2}
      defaultEdgeOptions={{
        type: 'traffic',
        animated: true,
      }}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#30363d" gap={20} size={1} />
      <Controls
        className="!bg-bg-secondary !border-border-default !rounded-lg"
        showInteractive={false}
      />
      <Panel position="top-right" className="flex flex-col gap-2">
        {/* View Mode Toggle */}
        <div className="bg-bg-secondary/95 border border-border-default rounded-md p-1.5 flex gap-1">
          <button
            onClick={() => handleViewModeChange('l2')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              viewMode === 'l2'
                ? 'bg-accent-cyan text-bg-primary'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
          >
            Physical (L2)
          </button>
          <button
            onClick={() => handleViewModeChange('l3')}
            className={`px-3 py-1 text-xs rounded transition-colors ${
              viewMode === 'l3'
                ? 'bg-accent-purple text-white'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
            }`}
          >
            Logical (L3)
          </button>
        </div>

        {/* L2 Mode Buttons */}
        {viewMode === 'l2' && (
          <div className="flex gap-2">
            <button
              onClick={handleVisualizeMermaid}
              className="px-3 py-1.5 text-xs bg-accent-cyan/20 border border-accent-cyan/40 rounded-md hover:bg-accent-cyan/30 text-accent-cyan transition-colors"
              title="View topology as Mermaid diagram"
            >
              Visualize
            </button>
            <button
              onClick={handleExportMermaid}
              className="px-3 py-1.5 text-xs bg-bg-secondary border border-border-default rounded-md hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
              title="Export topology as Mermaid diagram"
            >
              Export Mermaid
            </button>
            <button
              onClick={handleResetLayout}
              className="px-3 py-1.5 text-xs bg-bg-secondary border border-border-default rounded-md hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
              title="Reset all nodes to default positions"
            >
              Reset Layout
            </button>
            <button
              onClick={() => setShowPortLabels(!showPortLabels)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                showPortLabels
                  ? 'bg-accent-cyan/20 border border-accent-cyan/40 text-accent-cyan'
                  : 'bg-bg-secondary border border-border-default text-text-secondary hover:text-text-primary hover:bg-bg-tertiary'
              }`}
              title={showPortLabels ? 'Hide port labels and link speeds' : 'Show port labels and link speeds (Packet Tracer style)'}
            >
              {showPortLabels ? 'Labels On' : 'Labels Off'}
            </button>
          </div>
        )}

        {/* L3 Mode Buttons */}
        {viewMode === 'l3' && (
          <div className="flex gap-2">
            <button
              onClick={handleResetLayout}
              className="px-3 py-1.5 text-xs bg-bg-secondary border border-border-default rounded-md hover:bg-bg-tertiary text-text-secondary hover:text-text-primary transition-colors"
              title="Reset all nodes to default positions"
            >
              Reset Layout
            </button>
          </div>
        )}

        {/* L2 Color Key */}
        {viewMode === 'l2' && (
          <div className="bg-bg-secondary/95 border border-border-default rounded-md p-2 text-xs">
            <div className="font-medium text-text-primary mb-1.5">Link Colors</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 bg-[#3fb950] rounded" />
                <span className="text-text-secondary">Healthy (Speedtest OK)</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 bg-[#58a6ff] rounded" />
                <span className="text-text-secondary">Active Link</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 bg-[#d29922] rounded" />
                <span className="text-text-secondary">Degraded / Warning</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 bg-[#f85149] rounded" />
                <span className="text-text-secondary">Down / Critical</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-5 h-0.5 bg-[#6b7280] rounded" />
                <span className="text-text-secondary">Dumb Switch (No SNMP)</span>
              </div>
            </div>
          </div>
        )}

        {/* L3 VLAN Filter */}
        {viewMode === 'l3' && l3Topology && (
          <div className="bg-bg-secondary/95 border border-border-default rounded-md p-2 text-xs max-h-64 overflow-y-auto">
            <div className="flex items-center justify-between mb-1.5">
              <span className="font-medium text-text-primary">VLAN Filter</span>
              {selectedVlans.size > 0 && (
                <button
                  onClick={clearVlanFilter}
                  className="text-accent-purple hover:text-accent-purple/80"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="space-y-1">
              {l3Topology.vlans.map((vlan) => (
                <label
                  key={vlan.vlan_id}
                  className="flex items-center gap-2 cursor-pointer hover:bg-bg-tertiary p-1 rounded"
                >
                  <input
                    type="checkbox"
                    checked={selectedVlans.has(vlan.vlan_id)}
                    onChange={() => toggleVlanFilter(vlan.vlan_id)}
                    className="accent-accent-purple"
                  />
                  <span className="text-text-secondary">
                    VLAN {vlan.vlan_id}
                    {vlan.vlan_name && <span className="text-text-muted ml-1">({vlan.vlan_name})</span>}
                  </span>
                  <span className="ml-auto text-text-muted">{vlan.device_count}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </Panel>
      <MiniMap
        className="!bg-bg-secondary !border-border-default"
        nodeColor={(node) => {
          if (node.type === 'external') return '#6e7681'
          if (node.type === 'device') return '#58a6ff'
          if (node.type === 'vlanGroup') return '#a855f7'  // Purple for VLAN groups
          return '#39d5ff'
        }}
        maskColor="rgba(13, 17, 23, 0.8)"
        pannable
        zoomable
      />
      <MermaidModal
        isOpen={showMermaidModal}
        onClose={() => setShowMermaidModal(false)}
        diagram={mermaidDiagram}
      />
    </ReactFlow>
  )
}

export default function TopologyCanvas() {
  return (
    <div className="w-full h-full">
      <ReactFlowProvider>
        <TopologyCanvasInner />
      </ReactFlowProvider>
    </div>
  )
}
