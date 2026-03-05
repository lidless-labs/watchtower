import type { Edge } from '@xyflow/react'

export interface BundledEdgeData {
  // Original edge data
  sourcePort?: string
  targetPort?: string
  speed?: number
  utilization?: number
  status?: string
  connectionType?: string
  description?: string
  speedtestStatus?: string | null

  // Bundle-specific data
  bundleCount: number
  bundledEdges: EdgeInfo[]
  avgUtilization: number
  maxSpeed: number
  worstStatus: string
}

export interface EdgeInfo {
  id: string
  sourcePort?: string
  targetPort?: string
  speed: number
  utilization: number
  status: string
  description?: string
}

/**
 * Group edges by their source-target node pairs
 * Multiple physical links between the same nodes are bundled together
 */
export function bundleEdges(edges: Edge[]): Edge[] {
  const bundleMap = new Map<string, Edge[]>()

  // Group edges by sorted node pair key
  edges.forEach((edge) => {
    const key = [edge.source, edge.target].sort().join('--')
    const existing = bundleMap.get(key) || []
    existing.push(edge)
    bundleMap.set(key, existing)
  })

  // Create bundled edges
  const bundledEdges: Edge[] = []

  bundleMap.forEach((groupedEdges, key) => {
    if (groupedEdges.length === 1) {
      // Single edge - pass through with bundle metadata
      const edge = groupedEdges[0]
      const data = edge.data as Record<string, unknown>
      const bundleData: BundledEdgeData = {
        ...data,
        bundleCount: 1,
        bundledEdges: [{
          id: edge.id,
          sourcePort: data.sourcePort as string | undefined,
          targetPort: data.targetPort as string | undefined,
          speed: (data.speed as number) ?? 1000,
          utilization: (data.utilization as number) ?? 0,
          status: (data.status as string) ?? 'up',
          description: data.description as string | undefined,
        }],
        avgUtilization: (data.utilization as number) ?? 0,
        maxSpeed: (data.speed as number) ?? 1000,
        worstStatus: (data.status as string) ?? 'up',
      }
      bundledEdges.push({
        ...edge,
        data: bundleData as unknown as Record<string, unknown>,
      })
    } else {
      // Multiple edges - bundle them
      const firstEdge = groupedEdges[0]
      const bundledInfo: EdgeInfo[] = []

      let totalUtilization = 0
      let maxSpeed = 0
      let worstStatus = 'up'

      const statusPriority: Record<string, number> = {
        down: 3,
        degraded: 2,
        up: 1,
        unknown: 0,
      }

      groupedEdges.forEach((edge) => {
        const data = edge.data as Record<string, unknown>
        const speed = (data.speed as number) ?? 1000
        const utilization = (data.utilization as number) ?? 0
        const status = (data.status as string) ?? 'up'

        bundledInfo.push({
          id: edge.id,
          sourcePort: data.sourcePort as string | undefined,
          targetPort: data.targetPort as string | undefined,
          speed,
          utilization,
          status,
          description: data.description as string | undefined,
        })

        totalUtilization += utilization
        maxSpeed = Math.max(maxSpeed, speed)

        if ((statusPriority[status] ?? 0) > (statusPriority[worstStatus] ?? 0)) {
          worstStatus = status
        }
      })

      const avgUtilization = totalUtilization / groupedEdges.length

      // Create a single bundled edge
      const bundleData: BundledEdgeData = {
        // Use first edge's data as base
        sourcePort: undefined, // Bundle doesn't have single port
        targetPort: undefined,
        speed: maxSpeed,
        utilization: avgUtilization,
        status: worstStatus,
        connectionType: (firstEdge.data as Record<string, unknown>).connectionType as string | undefined,
        speedtestStatus: (firstEdge.data as Record<string, unknown>).speedtestStatus as string | null | undefined,
        // Bundle-specific data
        bundleCount: groupedEdges.length,
        bundledEdges: bundledInfo,
        avgUtilization,
        maxSpeed,
        worstStatus,
      }

      bundledEdges.push({
        id: `bundled-${key}`,
        source: firstEdge.source,
        target: firstEdge.target,
        type: firstEdge.type,
        data: bundleData as unknown as Record<string, unknown>,
      })
    }
  })

  return bundledEdges
}

/**
 * Format speed for display (Mbps or Gbps)
 */
export function formatSpeed(speedMbps: number): string {
  if (speedMbps >= 1000) {
    return `${speedMbps / 1000}G`
  }
  return `${speedMbps}M`
}

/**
 * Get status color for an edge
 */
export function getStatusColor(status: string): string {
  switch (status) {
    case 'up':
      return '#58a6ff' // Blue
    case 'down':
      return '#f85149' // Red
    case 'degraded':
      return '#d29922' // Amber
    default:
      return '#6b7280' // Gray
  }
}
