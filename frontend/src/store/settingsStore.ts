import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'dark' | 'light' | 'auto'
type AccentColor = 'cyan' | 'blue' | 'teal'
type AnimationSpeed = 'reduced' | 'normal' | 'fast'

interface SettingsState {
  // Appearance
  theme: Theme
  accentColor: AccentColor
  animationSpeed: AnimationSpeed
  showSparklines: boolean
  showLinkUtilization: boolean
  showPortLabels: boolean

  // Alerts
  soundEnabled: boolean
  soundVolume: number
  criticalOverlayEnabled: boolean
  warningAutoDismiss: number // seconds

  // Actions
  setTheme: (theme: Theme) => void
  setAccentColor: (color: AccentColor) => void
  setAnimationSpeed: (speed: AnimationSpeed) => void
  setShowSparklines: (show: boolean) => void
  setShowLinkUtilization: (show: boolean) => void
  setShowPortLabels: (show: boolean) => void
  setSoundEnabled: (enabled: boolean) => void
  setSoundVolume: (volume: number) => void
  setCriticalOverlayEnabled: (enabled: boolean) => void
  setWarningAutoDismiss: (seconds: number) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Default values
      theme: 'dark',
      accentColor: 'cyan',
      animationSpeed: 'normal',
      showSparklines: true,
      showLinkUtilization: true,
      showPortLabels: true,
      soundEnabled: true,
      soundVolume: 0.6,
      criticalOverlayEnabled: true,
      warningAutoDismiss: 10,

      // Actions
      setTheme: (theme) => set({ theme }),
      setAccentColor: (accentColor) => set({ accentColor }),
      setAnimationSpeed: (animationSpeed) => set({ animationSpeed }),
      setShowSparklines: (showSparklines) => set({ showSparklines }),
      setShowLinkUtilization: (showLinkUtilization) => set({ showLinkUtilization }),
      setShowPortLabels: (showPortLabels) => set({ showPortLabels }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setSoundVolume: (soundVolume) => set({ soundVolume }),
      setCriticalOverlayEnabled: (criticalOverlayEnabled) => set({ criticalOverlayEnabled }),
      setWarningAutoDismiss: (warningAutoDismiss) => set({ warningAutoDismiss }),
    }),
    {
      name: 'watchtower-settings',
    }
  )
)
