import { create } from 'zustand'

export interface SettingsData {
  data_sources?: {
    librenms?: { url?: string; api_key?: string; webhook_token?: string }
    netdisco?: { url?: string; api_key?: string; username?: string; password?: string }
    proxmox?: {
      url?: string; token_id?: string; token_secret?: string; verify_ssl?: boolean
      additional?: Array<{ name?: string; url?: string; token_id?: string; token_secret?: string; verify_ssl?: boolean }>
    }
  }
  polling?: {
    device_status?: number; device_stats?: number; topology?: number
    interfaces?: number; proxmox?: number
  }
  notifications?: {
    notify_on?: string[]; notify_on_recovery?: boolean; cooldown_minutes?: number
    channels?: {
      discord?: { enabled?: boolean; webhook_url?: string; mention_role?: string }
      pushover?: { enabled?: boolean; user_key?: string; app_token?: string; priority?: number }
      email?: {
        enabled?: boolean
        smtp_host?: string
        smtp_port?: number
        smtp_user?: string
        smtp_password?: string
        use_tls?: boolean
        from_address?: string
        recipients?: string[]
        subject_prefix?: string
      }
    }
  }
  alert_thresholds?: {
    defaults?: {
      cpu_warning?: number; cpu_critical?: number
      memory_warning?: number; memory_critical?: number
      interface_utilization_warning?: number; interface_utilization_critical?: number
    }
    overrides?: Record<string, Record<string, number>>
  }
  influxdb?: { url?: string; token?: string; org?: string; bucket?: string; enabled?: boolean }
  discovery?: { vm_subnets?: string[]; include_types?: string[]; auto_sync?: boolean; sync_interval?: number }
  speedtest?: { enabled?: boolean; interval_minutes?: number; server_id?: number | null; thresholds?: Record<string, number> }
  palo_alto?: { enabled?: boolean; firewalls?: Array<Record<string, unknown>> }
  [key: string]: unknown
}

export interface IntegrationStatus {
  configured: boolean
  connected: boolean
  error?: string
  last_poll?: string
  instances?: number
}

export interface StatusResponse {
  librenms?: IntegrationStatus
  proxmox?: IntegrationStatus
  influxdb?: IntegrationStatus
  redis?: IntegrationStatus
  speedtest?: { enabled: boolean }
  [key: string]: unknown
}

export interface ConnectionTestResult {
  status: 'ok' | 'error'
  message: string
  details?: Record<string, unknown>
}

type SettingsTab = 'integrations' | 'polling' | 'alerts' | 'notifications' | 'speedtest' | 'discovery' | 'users' | 'about'

interface SettingsApiState {
  settings: SettingsData | null
  status: StatusResponse | null
  activeTab: SettingsTab
  isLoading: boolean
  isSaving: boolean
  saveError: string | null
  saveSuccess: boolean
  dirty: Record<string, boolean>

  setActiveTab: (tab: SettingsTab) => void
  fetchSettings: () => Promise<void>
  fetchStatus: () => Promise<void>
  saveSection: (section: string, data: Record<string, unknown>) => Promise<boolean>
  saveAll: (data: SettingsData) => Promise<boolean>
  testConnection: (params: Record<string, unknown>) => Promise<ConnectionTestResult>
  markDirty: (section: string, isDirty: boolean) => void
  clearSaveState: () => void
}

export const useSettingsApiStore = create<SettingsApiState>((set, get) => ({
  settings: null,
  status: null,
  activeTab: 'integrations',
  isLoading: false,
  isSaving: false,
  saveError: null,
  saveSuccess: false,
  dirty: {},

  setActiveTab: (activeTab) => set({ activeTab, saveError: null, saveSuccess: false }),

  fetchSettings: async () => {
    set({ isLoading: true })
    try {
      const res = await fetch('/api/settings')
      if (res.ok) {
        const data = await res.json()
        set({ settings: data, isLoading: false })
      } else {
        set({ isLoading: false })
      }
    } catch (err) {
      console.error('[settings] fetchSettings failed', err)
      set({ isLoading: false })
    }
  },

  fetchStatus: async () => {
    try {
      const res = await fetch('/api/settings/status')
      if (res.ok) {
        const data = await res.json()
        set({ status: data })
      }
    } catch (err) {
      console.error('[settings] fetchStatus failed', err)
    }
  },

  saveSection: async (section, data) => {
    set({ isSaving: true, saveError: null, saveSuccess: false })
    try {
      const res = await fetch(`/api/settings/${section}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const updated = await res.json()
        set({ settings: updated, isSaving: false, saveSuccess: true, dirty: { ...get().dirty, [section]: false } })
        setTimeout(() => set({ saveSuccess: false }), 3000)
        return true
      } else {
        const err = await res.json().catch(() => ({ detail: 'Save failed' }))
        set({ isSaving: false, saveError: err.detail || 'Save failed' })
        return false
      }
    } catch (err) {
      console.error('[settings] saveSection failed', err)
      set({ isSaving: false, saveError: 'Network error' })
      return false
    }
  },

  saveAll: async (data) => {
    set({ isSaving: true, saveError: null, saveSuccess: false })
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        const updated = await res.json()
        set({ settings: updated, isSaving: false, saveSuccess: true, dirty: {} })
        setTimeout(() => set({ saveSuccess: false }), 3000)
        return true
      } else {
        const err = await res.json().catch(() => ({ detail: 'Save failed' }))
        set({ isSaving: false, saveError: err.detail || 'Save failed' })
        return false
      }
    } catch (err) {
      console.error('[settings] saveAll failed', err)
      set({ isSaving: false, saveError: 'Network error' })
      return false
    }
  },

  testConnection: async (params) => {
    try {
      const res = await fetch('/api/settings/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      return await res.json()
    } catch (err) {
      console.error('[settings] testConnection failed', err)
      return { status: 'error' as const, message: 'Network error' }
    }
  },

  markDirty: (section, isDirty) => {
    set({ dirty: { ...get().dirty, [section]: isDirty } })
  },

  clearSaveState: () => set({ saveError: null, saveSuccess: false }),
}))
