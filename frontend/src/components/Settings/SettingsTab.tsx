import { type ReactNode } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'

interface SettingsTabProps {
  title: string
  description?: string
  section: string
  onSave?: () => void
  children: ReactNode
}

export default function SettingsTab({ title, description, section, onSave, children }: SettingsTabProps) {
  const dirty = useSettingsApiStore((s) => s.dirty[section])
  const isSaving = useSettingsApiStore((s) => s.isSaving)
  const saveSuccess = useSettingsApiStore((s) => s.saveSuccess)
  const saveError = useSettingsApiStore((s) => s.saveError)

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {description && <p className="text-sm text-text-muted mt-1">{description}</p>}
        </div>
        <div className="flex items-center gap-3">
          {saveSuccess && (
            <span className="text-xs text-status-green flex items-center gap-1">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved
            </span>
          )}
          {saveError && (
            <span className="text-xs text-status-red">{saveError}</span>
          )}
          {onSave && (
            <button
              onClick={onSave}
              disabled={!dirty || isSaving}
              className="px-4 py-2 text-sm font-medium bg-accent-cyan text-bg-primary rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>

      {children}
    </div>
  )
}
