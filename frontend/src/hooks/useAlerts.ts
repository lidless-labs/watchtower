import { useCallback, useEffect } from 'react'
import { useAlertStore } from '../store/alertStore'
import { useSettingsStore } from '../store/settingsStore'
import { fetchAlerts, acknowledgeAlert as apiAcknowledgeAlert } from '../api/endpoints'
import type { Alert } from '../types/alert'

export function useAlerts() {
  const alerts = useAlertStore((state) => state.alerts)
  const toasts = useAlertStore((state) => state.toasts)
  const criticalOverlay = useAlertStore((state) => state.criticalOverlay)
  const setAlerts = useAlertStore((state) => state.setAlerts)
  const acknowledgeAlertAction = useAlertStore((state) => state.acknowledgeAlert)
  const dismissToast = useAlertStore((state) => state.dismissToast)
  const clearCriticalOverlay = useAlertStore((state) => state.clearCriticalOverlay)

  const soundEnabled = useSettingsStore((state) => state.soundEnabled)
  const soundVolume = useSettingsStore((state) => state.soundVolume)
  const criticalOverlayEnabled = useSettingsStore((state) => state.criticalOverlayEnabled)
  const warningAutoDismiss = useSettingsStore((state) => state.warningAutoDismiss)

  // Load initial alerts
  useEffect(() => {
    async function loadAlerts() {
      try {
        const alertList = await fetchAlerts()
        // AlertSummary is structurally compatible with Alert (extra fields are optional)
        setAlerts(alertList as Alert[])
      } catch (err) {
        console.error('Failed to load alerts:', err)
      }
    }

    loadAlerts()

    // Refresh alerts periodically
    const interval = setInterval(loadAlerts, 30000)
    return () => clearInterval(interval)
  }, [setAlerts])

  // Play sound for critical alerts
  const playAlertSound = useCallback(() => {
    if (!soundEnabled) return

    try {
      const audio = new Audio('/alert-sound.mp3')
      audio.volume = soundVolume
      audio.play().catch(() => {
        // Audio play failed, likely due to autoplay restrictions
      })
    } catch {
      // Audio not available
    }
  }, [soundEnabled, soundVolume])

  // Auto-dismiss warning toasts
  useEffect(() => {
    if (warningAutoDismiss <= 0) return

    const timeouts: number[] = []

    toasts.forEach((toast) => {
      if (toast.alert.severity === 'warning' && !toast.dismissed) {
        const timeout = window.setTimeout(() => {
          dismissToast(toast.id)
        }, warningAutoDismiss * 1000)
        timeouts.push(timeout)
      }
    })

    return () => {
      timeouts.forEach(clearTimeout)
    }
  }, [toasts, warningAutoDismiss, dismissToast])

  const acknowledgeAlert = useCallback(
    async (alertId: string) => {
      try {
        await apiAcknowledgeAlert(alertId)
        acknowledgeAlertAction(alertId)
      } catch (err) {
        console.error('Failed to acknowledge alert:', err)
      }
    },
    [acknowledgeAlertAction]
  )

  return {
    alerts,
    toasts,
    criticalOverlay,
    criticalOverlayEnabled,
    acknowledgeAlert,
    dismissToast,
    clearCriticalOverlay,
    playAlertSound,
  }
}
