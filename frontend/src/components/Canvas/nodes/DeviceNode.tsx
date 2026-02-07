import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { Device } from '../../../types/device'
import StatusDot from '../../common/StatusDot'

interface DeviceNodeData {
  device: Device
  clusterId: string
  clusterColor?: string
}

interface DeviceNodeProps {
  data: DeviceNodeData
  selected?: boolean
}

function DeviceNode({ data, selected }: DeviceNodeProps) {
  const { device } = data

  return (
    <>
      <Handle type="target" position={Position.Top} className="!bg-border-default" />
      <Handle type="source" position={Position.Bottom} className="!bg-border-default" />
      <Handle type="target" position={Position.Left} className="!bg-border-default" />
      <Handle type="source" position={Position.Right} className="!bg-border-default" />

      <div
        data-tour="device-node"
        className={`
          group relative bg-bg-secondary border-2 rounded-lg p-3 min-w-[140px]
          transition-all duration-200 cursor-pointer
          ${selected ? 'border-accent-cyan shadow-lg shadow-accent-cyan/20' : 'border-border-default'}
          ${device.status === 'down' ? 'border-status-red' : ''}
          hover:border-accent-cyan/50
        `}
      >
        <div className="flex items-center gap-2">
          <StatusDot status={device.status} size="md" pulse={device.status === 'down'} />
          <div className="flex-1 min-w-0">
            <div className="font-medium text-sm truncate">{device.display_name}</div>
            <div className="text-xs text-text-muted truncate">{device.ip}</div>
          </div>
        </div>

        {/* Collapse hint */}
        <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-text-muted text-[10px] opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
          Double-click to collapse
        </div>
      </div>
    </>
  )
}

export default memo(DeviceNode)
