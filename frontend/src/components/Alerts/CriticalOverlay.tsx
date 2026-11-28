import { useEffect, useState } from 'react'
import { useAlerts } from '../../hooks/useAlerts'
import { useNocStore } from '../../store/nocStore'

export default function CriticalOverlay() {
  const [acknowledging, setAcknowledging] = useState(false)
  const [acknowledgementError, setAcknowledgementError] = useState('')
  const {
    criticalOverlay,
    criticalOverlayEnabled,
    acknowledgeAlert,
    clearCriticalOverlay,
    playAlertSound,
  } = useAlerts()
  const selectDevice = useNocStore((state) => state.selectDevice)

  // Play sound and update title when critical alert appears
  useEffect(() => {
    if (!criticalOverlay || !criticalOverlayEnabled) return

    // Play alert sound
    playAlertSound()

    // Update page title
    const originalTitle = document.title
    let flashInterval: number | null = null

    const flashTitle = () => {
      document.title = document.title.includes('CRITICAL')
        ? originalTitle
        : `🔴 CRITICAL — ${originalTitle}`
    }

    flashInterval = window.setInterval(flashTitle, 1000)

    // Send browser notification if page is hidden
    if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Watchtower Critical Alert', {
        body: `${criticalOverlay.device_id}: ${criticalOverlay.message}`,
        icon: '/favicon.svg',
        requireInteraction: true,
        tag: criticalOverlay.id,
      })
    }

    return () => {
      if (flashInterval) clearInterval(flashInterval)
      document.title = originalTitle
    }
  }, [criticalOverlay, criticalOverlayEnabled, playAlertSound])

  if (!criticalOverlay || !criticalOverlayEnabled) {
    return null
  }

  const handleAcknowledge = async () => {
    if (!criticalOverlay || acknowledging) return

    setAcknowledging(true)
    setAcknowledgementError('')
    try {
      await acknowledgeAlert(criticalOverlay.id)
      setAcknowledgementError('')
      clearCriticalOverlay()
    } catch {
      setAcknowledgementError('Failed to acknowledge alert. Please try again.')
    } finally {
      setAcknowledging(false)
    }
  }

  const handleViewDevice = () => {
    selectDevice(criticalOverlay.device_id)
    clearCriticalOverlay()
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop with pulsing red border */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        style={{
          boxShadow: 'inset 0 0 100px 20px rgba(248, 81, 73, 0.3)',
          animation: 'pulse 2s ease-in-out infinite',
        }}
      />

      {/* Modal */}
      <div className="relative bg-bg-secondary border-2 border-status-red rounded-lg p-8 max-w-lg mx-4 shadow-2xl animate-pulse-glow">
        {/* Icon */}
        <div className="flex justify-center mb-6">
          <div className="w-16 h-16 rounded-full bg-status-red/20 flex items-center justify-center">
            <svg
              className="w-10 h-10 text-status-red"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>

        {/* Content */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-status-red mb-2">
            CRITICAL ALERT
          </h2>
          <p className="text-xl font-semibold text-text-primary mb-2">
            {criticalOverlay.device_id}
          </p>
          <p className="text-lg text-text-secondary mb-1">
            {criticalOverlay.message}
          </p>
          <p className="text-sm text-text-muted">
            {new Date(criticalOverlay.timestamp).toLocaleTimeString()}
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-center gap-4 mt-8">
          <button
            onClick={() => void handleAcknowledge()}
            disabled={acknowledging}
            className="px-6 py-3 bg-status-red hover:bg-status-red/80 text-white font-semibold rounded-lg transition-colors"
          >
            {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
          </button>
          <button
            onClick={handleViewDevice}
            className="px-6 py-3 bg-bg-tertiary hover:bg-border-default text-text-primary font-semibold rounded-lg border border-border-default transition-colors"
          >
            View Device
          </button>
        </div>
        {acknowledgementError && (
          <p className="mt-4 text-sm text-status-red" role="alert">
            {acknowledgementError}
          </p>
        )}
      </div>
    </div>
  )
}
