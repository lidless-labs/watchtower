import dagre from '@dagrejs/dagre'
import type { Node, Edge } from '@xyflow/react'
import type { Topology, Cluster } from '../types/topology'

// Rank values for hierarchical layout (lower = higher on canvas)
const RANK_ORDER: Record<string, number> = {
  // External nodes (cloud → ix → wan → campus)
  cloud: 0,
  ix: 1,
  wan: 2,
  campus: 3,
  // Cluster types
  firewall: 4,
  core: 5,
  distribution: 6,
  access: 6,
  server: 7,
  storage: 7,
  wireless: 8,
  ap: 8,
}

// Node dimensions for dagre layout
const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  cluster: { width: 180, height: 120 },
  device: { width: 160, height: 80 },
  external: { width: 140, height: 100 },
  vlanGroup: { width: 220, height: 150 },
}

/**
 * Get the rank for a cluster based on its type
 */
function getClusterRank(cluster: Cluster): number {
  const type = cluster.cluster_type.toLowerCase()

  // Check for exact matches first
  if (RANK_ORDER[type] !== undefined) {
    return RANK_ORDER[type]
  }

  // Check for partial matches
  if (type.includes('firewall') || type.includes('fw')) return RANK_ORDER.firewall
  if (type.includes('core')) return RANK_ORDER.core
  if (type.includes('distrib')) return RANK_ORDER.distribution
  if (type.includes('access') || type.includes('switch')) return RANK_ORDER.access
  if (type.includes('server') || type.includes('vm')) return RANK_ORDER.server
  if (type.includes('storage') || type.includes('nas') || type.includes('san')) return RANK_ORDER.storage
  if (type.includes('wireless') || type.includes('wifi') || type.includes('ap')) return RANK_ORDER.wireless

  // Default to middle of hierarchy
  return RANK_ORDER.distribution
}


export interface DagreLayoutOptions {
  rankdir?: 'TB' | 'BT' | 'LR' | 'RL'
  ranksep?: number
  nodesep?: number
  marginx?: number
  marginy?: number
}

/**
 * Apply dagre hierarchical layout to nodes based on topology
 *
 * @param nodes - React Flow nodes to layout
 * @param edges - React Flow edges for connectivity
 * @param topology - Topology data for rank determination
 * @param options - Layout configuration options
 * @returns Nodes with updated positions
 */
export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
  topology: Topology | null,
  options: DagreLayoutOptions = {}
): Node[] {
  if (nodes.length === 0) return nodes

  const {
    rankdir = 'TB',
    ranksep = 180,
    nodesep = 100,
    marginx = 50,
    marginy = 50,
  } = options

  // Separate external nodes (they stay on the left side)
  const externalNodes = nodes.filter(n => n.type === 'external')
  const layoutNodes = nodes.filter(n => n.type !== 'external')

  // If no non-external nodes, just return original
  if (layoutNodes.length === 0) return nodes

  // Create dagre graph
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir, ranksep, nodesep, marginx, marginy })
  g.setDefaultEdgeLabel(() => ({}))

  // Build cluster lookup for rank assignment
  const clusterLookup = new Map<string, Cluster>()
  if (topology) {
    topology.clusters.forEach(cluster => {
      clusterLookup.set(cluster.id, cluster)
    })
  }

  // Add nodes to dagre graph with dimensions and rank
  layoutNodes.forEach(node => {
    const dimensions = NODE_DIMENSIONS[node.type || 'cluster'] || NODE_DIMENSIONS.cluster

    // Determine rank based on node type
    let rank: number | undefined

    if (node.type === 'cluster') {
      const cluster = clusterLookup.get(node.id)
      if (cluster) {
        rank = getClusterRank(cluster)
      }
    } else if (node.type === 'device') {
      // Device nodes get rank from their cluster
      const clusterId = (node.data as { clusterId?: string })?.clusterId
      if (clusterId) {
        const cluster = clusterLookup.get(clusterId)
        if (cluster) {
          rank = getClusterRank(cluster)
        }
      }
    }

    g.setNode(node.id, {
      ...dimensions,
      rank,
    })
  })

  // Add edges to dagre graph
  edges.forEach(edge => {
    // Only add edges between nodes in the layout (not external)
    const sourceInLayout = layoutNodes.some(n => n.id === edge.source)
    const targetInLayout = layoutNodes.some(n => n.id === edge.target)

    if (sourceInLayout && targetInLayout) {
      g.setEdge(edge.source, edge.target)
    }
  })

  // Run dagre layout
  dagre.layout(g)

  // Create map of new positions
  const positionMap = new Map<string, { x: number; y: number }>()

  g.nodes().forEach(nodeId => {
    const nodeWithPosition = g.node(nodeId)
    if (nodeWithPosition) {
      // Dagre returns center position, convert to top-left for React Flow
      const dimensions = NODE_DIMENSIONS[layoutNodes.find(n => n.id === nodeId)?.type || 'cluster'] || NODE_DIMENSIONS.cluster
      positionMap.set(nodeId, {
        x: nodeWithPosition.x - dimensions.width / 2 + 250, // Offset to leave room for external nodes
        y: nodeWithPosition.y - dimensions.height / 2,
      })
    }
  })

  // Apply positions to layout nodes
  const positionedLayoutNodes = layoutNodes.map(node => {
    const newPos = positionMap.get(node.id)
    if (newPos) {
      return {
        ...node,
        position: newPos,
      }
    }
    return node
  })

  // External nodes keep their fixed left-side positions (handled separately)
  // They are positioned vertically on the left side
  const positionedExternalNodes = externalNodes.map((node, index) => ({
    ...node,
    position: {
      x: -200,
      y: 50 + index * 120,
    },
  }))

  return [...positionedLayoutNodes, ...positionedExternalNodes]
}

/**
 * Apply dagre layout specifically for expanded cluster device nodes
 * This creates a compact layout for devices within a cluster detail panel
 *
 * @param deviceNodes - Device nodes to layout
 * @param edges - Intra-cluster edges
 * @returns Nodes with updated positions
 */
export function applyClusterDetailLayout(
  deviceNodes: Node[],
  edges: Edge[]
): Node[] {
  if (deviceNodes.length === 0) return deviceNodes

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'TB',
    ranksep: 100,
    nodesep: 80,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}))

  // Add all device nodes
  deviceNodes.forEach(node => {
    const dimensions = NODE_DIMENSIONS.device
    g.setNode(node.id, dimensions)
  })

  // Add edges
  edges.forEach(edge => {
    const sourceInLayout = deviceNodes.some(n => n.id === edge.source)
    const targetInLayout = deviceNodes.some(n => n.id === edge.target)

    if (sourceInLayout && targetInLayout) {
      g.setEdge(edge.source, edge.target)
    }
  })

  // Run layout
  dagre.layout(g)

  // Apply positions
  return deviceNodes.map(node => {
    const nodeWithPosition = g.node(node.id)
    if (nodeWithPosition) {
      const dimensions = NODE_DIMENSIONS.device
      return {
        ...node,
        position: {
          x: nodeWithPosition.x - dimensions.width / 2,
          y: nodeWithPosition.y - dimensions.height / 2,
        },
      }
    }
    return node
  })
}
