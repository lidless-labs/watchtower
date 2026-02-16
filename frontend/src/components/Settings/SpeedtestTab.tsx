import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import SettingsTab from './SettingsTab'

export default function SpeedtestTab() {
  const settings = useSettingsApiStore((s) => s.settings)
  const saveSection = useSettingsApiStore((s) => s.saveSection)
  const markDirty = useSettingsApiStore((s) => s.markDirty)

  const [form, setForm] = useState({
    enabled: false,
    interval_minutes: 15,
    server_id: '' as string,
    degraded_download_mbps: 200,
    degraded_ping_ms: 50,
    down_download_mbps: 10,
  })

  useEffect(() => {
    if (settings?.speedtest) {
      const s = settings.speedtest
      setForm({
        enabled: s.enabled ?? false,
        interval_minutes: s.interval_minutes ?? 15,
        server_id: s.server_id?.toString() ?? '',
        degraded_download_mbps: s.thresholds?.degraded_download_mbps ?? 200,
        degraded_ping_ms: s.thresholds?.degraded_ping_ms ?? 50,
        down_download_mbps: s.thresholds?.down_download_mbps ?? 10,
      })
    }
  }, [settings])

  const update = (field: string, value: unknown) => {
    setForm((p) => ({ ...p, [field]: value }))
    markDirty('speedtest', true)
  }

  return (
    <SettingsTab
      title="Speedtest"
      description="Monitor internet connectivity with scheduled speed tests."
      section="speedtest"
      onSave={() => saveSection('speedtest', {
        enabled: form.enabled,
        interval_minutes: form.interval_minutes,
        server_id: form.server_id ? Number(form.server_id) : null,
        thresholds: {
          degraded_download_mbps: form.degraded_download_mbps,
          degraded_ping_ms: form.degraded_ping_ms,
          down_download_mbps: form.down_download_mbps,
        },
      })}
    >
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5 space-y-4">
        <label className="flex items-center gap-2 cursor-pointer">
          <div onClick={() => update('enabled', !form.enabled)}
            className={`w-9 h-5 rounded-full transition-colors relative ${form.enabled ? 'bg-accent-cyan' : 'bg-bg-tertiary border border-border-default'}`}>
            <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${form.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
          <span className="text-sm text-text-primary font-medium">Enable speedtest polling</span>
        </label>

        {form.enabled && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Interval (minutes)</label>
              <input type="number" value={form.interval_minutes} onChange={(e) => update('interval_minutes', Number(e.target.value))} min={1} max={60}
                className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-cyan/40" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Server ID (optional)</label>
              <input type="text" value={form.server_id} onChange={(e) => update('server_id', e.target.value)} placeholder="Auto-detect"
                className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-cyan/40" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Degraded threshold (Mbps)</label>
              <input type="number" value={form.degraded_download_mbps} onChange={(e) => update('degraded_download_mbps', Number(e.target.value))} min={1}
                className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-cyan/40" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Down threshold (Mbps)</label>
              <input type="number" value={form.down_download_mbps} onChange={(e) => update('down_download_mbps', Number(e.target.value))} min={1}
                className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-cyan/40" />
            </div>
          </div>
        )}
      </div>
    </SettingsTab>
  )
}
