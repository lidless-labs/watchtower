import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'

interface ExternalNodeData {
  label: string
  type: 'campus' | 'ix' | 'cloud' | 'wan'
  icon: string
}

interface ExternalNodeProps {
  data: ExternalNodeData
}

// Color schemes for different external types
const typeStyles = {
  campus: {
    border: 'border-amber-500/60',
    glow: 'shadow-[0_0_15px_rgba(217,119,6,0.3)]',
    icon: 'text-amber-400',
    badge: 'text-amber-400/80',
  },
  wan: {
    border: 'border-yellow-400/60',
    glow: 'shadow-[0_0_15px_rgba(250,204,21,0.4)]',
    icon: 'text-yellow-400',
    badge: 'text-yellow-400/80',
  },
  ix: {
    border: 'border-purple-500/60',
    glow: 'shadow-[0_0_15px_rgba(168,85,247,0.3)]',
    icon: 'text-purple-400',
    badge: 'text-purple-400/80',
  },
  cloud: {
    border: 'border-cyan-500/60',
    glow: 'shadow-[0_0_15px_rgba(6,182,212,0.4)]',
    icon: 'text-cyan-400',
    badge: 'text-cyan-400/80',
  },
}

function ExternalNode({ data }: ExternalNodeProps) {
  const { label, type, icon } = data
  const style = typeStyles[type] || typeStyles.cloud

  return (
    <>
      <Handle type="target" position={Position.Right} className="!bg-border-default" />
      <Handle type="source" position={Position.Right} className="!bg-border-default" />

      <div
        className={`
          bg-bg-secondary/90 backdrop-blur-sm
          border-2 ${style.border}
          rounded-xl px-4 py-3 min-w-[140px] relative
          ${style.glow}
          transition-all duration-300
          hover:scale-105
        `}
      >
        <div className="flex items-center gap-3">
          <ExternalIcon type={icon} colorClass={style.icon} />
          <div>
            <div className="text-sm font-semibold text-text-primary">{label}</div>
            <div className={`text-xs font-medium capitalize ${style.badge}`}>{type}</div>
          </div>
        </div>
        {/* Colored ring indicator */}
        <div className={`absolute -right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full ${style.border} border-2 bg-bg-secondary`} />
      </div>
    </>
  )
}

function ExternalIcon({ type, colorClass }: { type: string; colorClass: string }) {
  const iconClass = `w-6 h-6 ${colorClass}`

  switch (type) {
    case 'building':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      )
    case 'server':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
        </svg>
      )
    case 'globe':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'cloud':
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
        </svg>
      )
    default:
      return (
        <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
        </svg>
      )
  }
}

export default memo(ExternalNode)
