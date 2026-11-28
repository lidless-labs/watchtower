import { useState } from 'react'
import type { Toast as ToastType } from '../../types/alert'
import StatusDot from '../common/StatusDot'

interface ToastProps {
  toast: ToastType
  onDismiss: (id: string) => void
  onAcknowledge: (alertId: string) => Promise<void>
}

const severityStyles = {
  critical: 'border-status-red bg-status-red/10',
  warning: 'border-status-amber bg-status-amber/10',
  info: 'border-status-blue bg-status-blue/10',
  recovery: 'border-status-green bg-status-green/10',
}

const severityIcons = {
  critical: (
    <svg className="w-5 h-5 text-status-red" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  warning: (
    <svg className="w-5 h-5 text-status-amber" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  ),
  info: (
    <svg className="w-5 h-5 text-status-blue" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  recovery: (
    <svg className="w-5 h-5 text-status-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date()
  const then = new Date(timestamp)
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000)

  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

export default function Toast({ toast, onDismiss, onAcknowledge }: ToastProps) {
  const { alert } = toast
  const [acknowledging, setAcknowledging] = useState(false)
  const [acknowledgementError, setAcknowledgementError] = useState('')

  const handleAcknowledge = async () => {
    setAcknowledging(true)
    setAcknowledgementError('')
    try {
      await onAcknowledge(alert.id)
    } catch {
      setAcknowledgementError('Failed to acknowledge alert. Please try again.')
    } finally {
      setAcknowledging(false)
    }
  }

  return (
    <div
      className={`
        w-80 p-4 rounded-lg border-l-4 shadow-lg
        bg-bg-secondary backdrop-blur-sm
        transform transition-all duration-300
        ${severityStyles[alert.severity]}
        ${toast.dismissed ? 'opacity-0 translate-x-4' : 'opacity-100'}
      `}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {severityIcons[alert.severity]}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <StatusDot status={alert.severity === 'critical' || alert.severity === 'warning' ? 'down' : 'up'} pulse={alert.severity === 'critical'} />
            <span className="font-medium text-sm truncate">{alert.device_id}</span>
          </div>

          <p className="text-sm text-text-secondary mt-1">{alert.message}</p>

          <div className="flex items-center justify-between mt-2">
            <span className="text-xs text-text-muted">
              {formatTimeAgo(alert.timestamp)}
            </span>

            <div className="flex items-center gap-2">
              {alert.status === 'active' && alert.severity === 'critical' && (
                <button
                  onClick={() => void handleAcknowledge()}
                  disabled={acknowledging}
                  className="text-xs px-2 py-1 bg-bg-tertiary hover:bg-border-default rounded transition-colors"
                >
                  {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
                </button>
              )}
              <button
                onClick={() => onDismiss(toast.id)}
                className="text-xs px-2 py-1 text-text-muted hover:text-text-secondary transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
          {acknowledgementError && (
            <p className="mt-2 text-xs text-status-red" role="alert">
              {acknowledgementError}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
