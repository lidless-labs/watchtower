import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import { Toggle } from '../common/Toggle'
import SettingsTab from './SettingsTab'
import SecretInput from './SecretInput'
import NotificationHistory from './NotificationHistory'

const API = import.meta.env.VITE_API_URL || ''

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
        <Toggle
          checked={enabled}
          onChange={onToggle}
          label=""
          ariaLabel={`${enabled ? 'Disable' : 'Enable'} ${title}`}
        />
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
  const [email, setEmail] = useState({ enabled: false, smtp_host: '', smtp_port: 587, smtp_user: '', smtp_password: '', use_tls: true, from_address: '', recipients: [] as string[], subject_prefix: '[Watchtower]' })
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ channel: string; ok: boolean; msg: string } | null>(null)

  useEffect(() => {
    if (settings?.notifications) {
      const n = settings.notifications
      if (n.notify_on) setGeneral({ notify_on: n.notify_on, notify_on_recovery: n.notify_on_recovery ?? true, cooldown_minutes: n.cooldown_minutes ?? 5 })
      if (n.channels?.discord) setDiscord({ enabled: n.channels.discord.enabled ?? false, webhook_url: n.channels.discord.webhook_url ?? '', mention_role: n.channels.discord.mention_role ?? '@here' })
      if (n.channels?.pushover) setPushover({ enabled: n.channels.pushover.enabled ?? false, user_key: n.channels.pushover.user_key ?? '', app_token: n.channels.pushover.app_token ?? '', priority: n.channels.pushover.priority ?? 2 })
      if (n.channels?.email) {
        const e = n.channels.email
        setEmail({ enabled: e.enabled ?? false, smtp_host: e.smtp_host ?? '', smtp_port: e.smtp_port ?? 587, smtp_user: e.smtp_user ?? '', smtp_password: e.smtp_password ?? '', use_tls: e.use_tls ?? true, from_address: e.from_address ?? '', recipients: e.recipients ?? [], subject_prefix: e.subject_prefix ?? '[Watchtower]' })
      }
    }
  }, [settings])

  const dirty = () => markDirty('notifications', true)

  const handleSave = () => {
    saveSection('notifications', {
      ...general,
      channels: { discord, pushover, email },
    })
  }

  const handleTest = async (channel: string) => {
    setTesting(channel)
    setTestResult(null)
    try {
      const token = localStorage.getItem('watchtower_token')
      const res = await fetch(`${API}/api/notifications/test/${channel}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const data = await res.json()
      setTestResult({ channel, ok: data.status === 'success' || data.status === 'demo', msg: data.status === 'success' ? 'Test sent!' : data.error || data.status })
    } catch {
      setTestResult({ channel, ok: false, msg: 'Network error' })
    } finally { setTesting(null) }
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
          <button onClick={() => handleTest('discord')} disabled={testing === 'discord'} className="mt-2 px-3 py-1.5 bg-accent-cyan/20 text-accent-cyan rounded text-xs hover:bg-accent-cyan/30 disabled:opacity-50">
            {testing === 'discord' ? 'Sending...' : '🧪 Test Discord'}
          </button>
          {testResult?.channel === 'discord' && <div className={`text-xs mt-1 ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>{testResult.msg}</div>}
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
          <button onClick={() => handleTest('pushover')} disabled={testing === 'pushover'} className="mt-2 px-3 py-1.5 bg-accent-cyan/20 text-accent-cyan rounded text-xs hover:bg-accent-cyan/30 disabled:opacity-50">
            {testing === 'pushover' ? 'Sending...' : '🧪 Test Pushover'}
          </button>
          {testResult?.channel === 'pushover' && <div className={`text-xs mt-1 ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>{testResult.msg}</div>}
        </ChannelCard>

        <ChannelCard title="Email (SMTP)" icon="📧" enabled={email.enabled} onToggle={(v) => { setEmail((p) => ({ ...p, enabled: v })); dirty() }}>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-text-secondary mb-1">SMTP Host</label>
              <TextInput value={email.smtp_host} onChange={(v) => { setEmail((p) => ({ ...p, smtp_host: v })); dirty() }} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Port</label>
              <NumberInput value={email.smtp_port} onChange={(v) => { setEmail((p) => ({ ...p, smtp_port: v })); dirty() }} min={25} max={65535} />
            </div>
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Username</label>
            <TextInput value={email.smtp_user} onChange={(v) => { setEmail((p) => ({ ...p, smtp_user: v })); dirty() }} />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Password</label>
            <SecretInput value={email.smtp_password} onChange={(v) => { setEmail((p) => ({ ...p, smtp_password: v })); dirty() }} />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">From Address</label>
            <TextInput value={email.from_address} onChange={(v) => { setEmail((p) => ({ ...p, from_address: v })); dirty() }} placeholder="watchtower@example.com" />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Recipients (comma-separated)</label>
            <TextInput value={email.recipients.join(', ')} onChange={(v) => { setEmail((p) => ({ ...p, recipients: v.split(',').map(s => s.trim()).filter(Boolean) })); dirty() }} placeholder="admin@example.com, ops@example.com" />
          </div>
          <div>
            <label className="block text-sm text-text-secondary mb-1">Subject Prefix</label>
            <TextInput value={email.subject_prefix} onChange={(v) => { setEmail((p) => ({ ...p, subject_prefix: v })); dirty() }} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={email.use_tls} onChange={(e) => { setEmail((p) => ({ ...p, use_tls: e.target.checked })); dirty() }}
              className="rounded border-border-default bg-bg-primary text-accent-cyan focus:ring-accent-cyan/40" />
            <span className="text-sm text-text-secondary">Use TLS</span>
          </label>
          <button onClick={() => handleTest('email')} disabled={testing === 'email'} className="mt-2 px-3 py-1.5 bg-accent-cyan/20 text-accent-cyan rounded text-xs hover:bg-accent-cyan/30 disabled:opacity-50">
            {testing === 'email' ? 'Sending...' : '🧪 Test Email'}
          </button>
          {testResult?.channel === 'email' && <div className={`text-xs mt-1 ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>{testResult.msg}</div>}
        </ChannelCard>
      </div>

      {/* Delivery History */}
      <div className="mt-6">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Delivery History</h3>
        <NotificationHistory />
      </div>
    </SettingsTab>
  )
}
