import { memo, useCallback } from 'react'
import { getBezierPath, EdgeLabelRenderer, type Position } from '@xyflow/react'
import { useSettingsStore } from '../../../store/settingsStore'
import { useNocStore } from '../../../store/nocStore'
import type { EdgeInfo } from './edgeBundleUtils'

interface PhysicalLinkEdgeData {
  sourcePort?: string
  targetPort?: string
  speed?: number  // Mbps
  utilization: number
  status: string
  connectionType?: string
  description?: string
  speedtestStatus?: 'normal' | 'degraded' | 'down' | null
  // Bundle-specific data
  bundleCount?: number
  bundledEdges?: EdgeInfo[]
  avgUtilization?: number
  maxSpeed?: number
  worstStatus?: string
}

interface PhysicalLinkEdgeProps {
  id: string
  sourceX: number
  sourceY: number
  targetX: number
  targetY: number
  sourcePosition: Position
  targetPosition: Position
  data?: PhysicalLinkEdgeData
  selected?: boolean
}

function getEdgeColor(
  utilization: number,
  status: string,
  isWanLink: boolean = false,
  speedtestStatus?: 'normal' | 'degraded' | 'down' | null
): string {
  if (status === 'down') return '#f85149'
  if (status === 'degraded') return '#d29922'
  if (status === 'unknown') return '#6e7681'

  // High utilization warnings
  if (utilization >= 85) return '#f85149'  // Red - critical
  if (utilization >= 60) return '#d29922'  // Yellow - warning

  // WAN links (external) use speedtest status for coloring
  if (isWanLink && speedtestStatus) {
    if (speedtestStatus === 'down') return '#f85149'      // Red for failed
    if (speedtestStatus === 'degraded') return '#d29922'  // Yellow for degraded
    return '#3fb950'  // Green for normal
  }

  // Active links get bright blue
  return '#58a6ff'
}

function getEdgeWidth(speed: number = 1000, utilization: number): number {
  // Base width by speed
  let baseWidth = 2
  if (speed >= 10000) baseWidth = 4  // 10G
  else if (speed >= 1000) baseWidth = 3  // 1G

  // Add width for high utilization
  if (utilization >= 60) baseWidth += 1

  return baseWidth
}

function formatSpeed(speedMbps: number): string {
  if (speedMbps >= 10000) return `${speedMbps / 1000}G`
  if (speedMbps >= 1000) return `${speedMbps / 1000}G`
  return `${speedMbps}M`
}

function PhysicalLinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: PhysicalLinkEdgeProps) {
  const showPortLabels = useSettingsStore((state) => state.showPortLabels)
  const hoveredEdgeId = useNocStore((state) => state.hoveredEdgeId)
  const setHoveredEdge = useNocStore((state) => state.setHoveredEdge)

  const utilization = data?.utilization ?? 0
  const status = data?.status ?? 'up'
  const speed = data?.speed ?? 1000
  const sourcePort = data?.sourcePort
  const targetPort = data?.targetPort
  const connectionType = data?.connectionType
  const speedtestStatus = data?.speedtestStatus
  const isWanLink = connectionType === 'wan'

  // Bundle data
  const bundleCount = data?.bundleCount ?? 1
  const bundledEdges = data?.bundledEdges ?? []
  const isBundle = bundleCount > 1

  // Hover state - global across all edges
  const isHovered = hoveredEdgeId === id
  const isAnyEdgeHovered = hoveredEdgeId !== null
  const isDimmed = isAnyEdgeHovered && !isHovered && !selected

  const handleMouseEnter = useCallback(() => {
    setHoveredEdge(id)
  }, [id, setHoveredEdge])

  const handleMouseLeave = useCallback(() => {
    setHoveredEdge(null)
  }, [setHoveredEdge])

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const strokeColor = getEdgeColor(utilization, status, isWanLink, speedtestStatus)
  const strokeWidth = isBundle ? getEdgeWidth(speed, utilization) + 2 : getEdgeWidth(speed, utilization)

  // Calculate port label positions (near the connection points)
  const sourcePortX = sourceX + (targetX - sourceX) * 0.15
  const sourcePortY = sourceY + (targetY - sourceY) * 0.15
  const targetPortX = sourceX + (targetX - sourceX) * 0.85
  const targetPortY = sourceY + (targetY - sourceY) * 0.85

  // Opacity based on hover state
  const edgeOpacity = isDimmed ? 0.2 : 1

  return (
    <>
      {/* Invisible wider path for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'pointer' }}
      />

      {/* Glow effect for down links or hovered links */}
      {(status === 'down' || (isHovered && !isDimmed)) && (
        <path
          d={edgePath}
          fill="none"
          stroke={status === 'down' ? '#f85149' : '#39d5ff'}
          strokeWidth={strokeWidth + 4}
          strokeLinecap="round"
          style={{ opacity: status === 'down' ? 0.3 : 0.4, transition: 'opacity 0.2s' }}
        />
      )}

      {/* Main edge */}
      <path
        id={id}
        d={edgePath}
        fill="none"
        stroke={selected ? '#39d5ff' : strokeColor}
        strokeWidth={status === 'down' ? strokeWidth + 1 : strokeWidth}
        strokeLinecap="round"
        className={status === 'up' && !isDimmed ? 'animate-flow' : ''}
        style={{
          strokeDasharray: status === 'up' ? '8,4' : undefined,
          transition: 'stroke 0.2s, stroke-width 0.2s, opacity 0.2s',
          opacity: edgeOpacity,
        }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />

      {/* Edge labels rendered in HTML layer */}
      <EdgeLabelRenderer>
        {/* Port labels - always visible (Packet Tracer style), toggle via settings */}
        {sourcePort && !isBundle && (showPortLabels || isHovered || selected) && !isDimmed && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${sourcePortX}px, ${sourcePortY}px)`,
              pointerEvents: 'none',
              opacity: isHovered || selected ? 1 : 0.75,
              transition: 'opacity 0.2s',
            }}
            className="text-[10px] bg-bg-secondary/80 text-text-secondary px-1 py-0.5 rounded font-mono leading-none"
          >
            {sourcePort}
          </div>
        )}

        {targetPort && !isBundle && (showPortLabels || isHovered || selected) && !isDimmed && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${targetPortX}px, ${targetPortY}px)`,
              pointerEvents: 'none',
              opacity: isHovered || selected ? 1 : 0.75,
              transition: 'opacity 0.2s',
            }}
            className="text-[10px] bg-bg-secondary/80 text-text-secondary px-1 py-0.5 rounded font-mono leading-none"
          >
            {targetPort}
          </div>
        )}

        {/* Center label - shows speed and bundle info */}
        {status !== 'down' && (showPortLabels || isHovered || selected || utilization >= 60 || isBundle) && !isDimmed && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              transition: 'opacity 0.2s',
            }}
            className={`text-[10px] px-1.5 py-0.5 rounded leading-none ${
              isHovered || selected
                ? 'bg-bg-secondary/95 border border-border-primary shadow-lg'
                : 'bg-bg-secondary/70'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {/* Bundle count badge */}
              {isBundle && (
                <span className="bg-accent-cyan/30 text-accent-cyan px-1 rounded font-medium">
                  x{bundleCount}
                </span>
              )}
              <span className="text-text-secondary font-medium">{formatSpeed(speed)}</span>
              {(isHovered || selected || utilization >= 60) && (
                <span className={`font-medium ${utilization >= 85 ? 'text-red-400' : utilization >= 60 ? 'text-yellow-400' : 'text-green-400'}`}>
                  {utilization.toFixed(0)}%
                </span>
              )}
              {(isHovered || selected) && connectionType && (
                <span className="text-text-tertiary">({connectionType})</span>
              )}
            </div>
          </div>
        )}

        {/* Bundle tooltip - shows individual link details on hover */}
        {isBundle && isHovered && !isDimmed && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, 0) translate(${labelX}px, ${labelY + 24}px)`,
              pointerEvents: 'none',
              zIndex: 1000,
            }}
            className="bg-bg-secondary/95 border border-border-primary shadow-xl rounded-lg p-2 text-[10px] min-w-[160px]"
          >
            <div className="text-text-muted mb-1 font-medium">{bundleCount} Links:</div>
            <div className="space-y-1">
              {bundledEdges.map((edge, idx) => (
                <div key={idx} className="flex items-center justify-between gap-2 text-text-secondary">
                  <span className="font-mono truncate">
                    {edge.sourcePort || '?'} - {edge.targetPort || '?'}
                  </span>
                  <span className={`font-medium ${
                    edge.status === 'down' ? 'text-red-400' :
                    edge.status === 'degraded' ? 'text-yellow-400' :
                    'text-green-400'
                  }`}>
                    {formatSpeed(edge.speed)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Down indicator */}
        {status === 'down' && !isDimmed && (
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
            }}
            className="flex items-center gap-1 bg-red-500/20 text-red-400 px-2 py-1 rounded border border-red-500/30"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="text-xs font-medium">DOWN</span>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(PhysicalLinkEdge)
