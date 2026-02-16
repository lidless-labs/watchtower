import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import SettingsTab from './SettingsTab'
import SecretInput from './SecretInput'

function ChannelCard({ title, icon, enabled, onToggle, children }: {
  title: string; icon: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode
}) {
  return (
    <div className={`bg-bg-secondary rounded-lg border p-5 transition-colors ${enabled ? 'border-accent-cyan/30' : 'border-border-default'}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        </div>
        <label className="flex items-center cursor-pointer">
          <div
            onClick={() => onToggle(!enabled)}
            className={`w-9 h-5 rounded-full transition-colors relative ${enabled ? 'bg-accent-cyan' : 'bg-bg-tertiary border border-border-default'}`}
          >
            <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
          </div>
        </label>
      </div>
      {enabled && <div className="space-y-3">{children}</div>}
      {!enabled && <div className="text-xs text-text-tertiary">Enable to configure</div>}
    </div>
  )
}

function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan/40" />
  )
}

function NumberInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return (
    <input type="number" value={value} onChange={(e) => onChange(Number(e.target.value))} min={min} max={max}
      className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-cyan/40" />
  )
}

export default function NotificationsTab() {
  const settings = useSettingsApiStore((s) => s.settings)
  const saveSection = useSettingsApiStore((s) => s.saveSection)
  const markDirty = useSettingsApiStore((s) => s.markDirty)

  const [general, setGeneral] = useState({ notify_on: ['critical'], notify_on_recovery: true, cooldown_minutes: 5 })
  const [discord, setDiscord] = useState({ enabled: false, webhook_url: '', mention_role: '@here' })
  const [pushover, setPushover] = useState({ enabled: false, user_key: '', app_token: '', priority: 2 })

  useEffect(() => {
    if (settings?.notifications) {
      const n = settings.notifications
      if (n.notify_on) setGeneral({ notify_on: n.notify_on, notify_on_recovery: n.notify_on_recovery ?? true, cooldown_minutes: n.cooldown_minutes ?? 5 })
      if (n.channels?.discord) setDiscord({ enabled: n.channels.discord.enabled ?? false, webhook_url: n.channels.discord.webhook_url ?? '', mention_role: n.channels.discord.mention_role ?? '@here' })
      if (n.channels?.pushover) setPushover({ enabled: n.channels.pushover.enabled ?? false, user_key: n.channels.pushover.user_key ?? '', app_token: n.channels.pushover.app_token ?? '', priority: n.channels.pushover.priority ?? 2 })
    }
  }, [settings])

  const dirty = () => markDirty('notifications', true)

  const handleSave = () => {
    saveSection('notifications', {
      ...general,
      channels: { discord, pushover },
    })
  }

  return (
    <SettingsTab
      title="Notifications"
      description="Get alerted when devices go down or thresholds are exceeded."
      section="notifications"
      onSave={handleSave}
    >
      {/* General settings */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5 mb-4">
        <h3 className="text-sm font-semibold text-text-primary mb-3">General</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm text-text-secondary mb-1">Notify on</label>
            <select
              value={general.notify_on[0] || 'critical'}
              onChange={(e) => { setGeneral((p) => ({ ...p, notify_on: [e.target.value] })); dirty() }}
              className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan/40"
            >
              <option value="critical">Critical only</option>
              <option value="warning">Warning + Critical</option>
              <option value="info">All alerts</option>
            </select>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Cooldown (minutes)</label>
            <NumberInput value={general.cooldown_minutes} onChange={(v) => { setGeneral((p) => ({ ...p, cooldown_minutes: v })); dirty() }} min={1} max={60} />
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input type="checkbox" checked={general.notify_on_recovery} onChange={(e) => { setGeneral((p) => ({ ...p, notify_on_recovery: e.target.checked })); dirty() }}
                className="rounded border-border-default bg-bg-primary text-accent-cyan focus:ring-accent-cyan/40" />
              <span className="text-sm text-text-secondary">Notify on recovery</span>
            </label>
          </div>
        </div>
      </div>

      {/* Channel cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <ChannelCard title="Discord" icon="💬" enabled={discord.enabled} onToggle={(v) => { setDiscord((p) => ({ ...p, enabled: v })); dirty() }}>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Webhook URL</label>
            <SecretInput value={discord.webhook_url} onChange={(v) => { setDiscord((p) => ({ ...p, webhook_url: v })); dirty() }} placeholder="https://discord.com/api/webhooks/..." />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Mention Role</label>
            <TextInput value={discord.mention_role} onChange={(v) => { setDiscord((p) => ({ ...p, mention_role: v })); dirty() }} placeholder="@here" />
          </div>
        </ChannelCard>

        <ChannelCard title="Pushover" icon="📱" enabled={pushover.enabled} onToggle={(v) => { setPushover((p) => ({ ...p, enabled: v })); dirty() }}>
          <div>
            <label className="block text-sm text-text-secondary mb-1">User Key</label>
            <SecretInput value={pushover.user_key} onChange={(v) => { setPushover((p) => ({ ...p, user_key: v })); dirty() }} />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">App Token</label>
            <SecretInput value={pushover.app_token} onChange={(v) => { setPushover((p) => ({ ...p, app_token: v })); dirty() }} />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Priority (0-2)</label>
            <NumberInput value={pushover.priority} onChange={(v) => { setPushover((p) => ({ ...p, priority: v })); dirty() }} min={0} max={2} />
          </div>
        </ChannelCard>
      </div>
    </SettingsTab>
  )
}
