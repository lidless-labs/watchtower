import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import SettingsTab from './SettingsTab'
import SecretInput from './SecretInput'
import ConnectionTest from './ConnectionTest'

interface FieldProps {
  label: string
  children: React.ReactNode
}

function Field({ label, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm text-text-secondary mb-1">{label}</label>
      {children}
    </div>
  )
}

function TextInput({ value, onChange, placeholder, mono }: {
  value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 ${mono ? 'font-mono' : ''}`}
    />
  )
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <div
        onClick={() => onChange(!checked)}
        className={`w-9 h-5 rounded-full transition-colors relative ${checked ? 'bg-accent-cyan' : 'bg-bg-tertiary border border-border-default'}`}
      >
        <div className={`w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`} />
      </div>
      <span className="text-sm text-text-secondary">{label}</span>
    </label>
  )
}

function SectionCard({ title, icon, children, status }: {
  title: string; icon: string; children: React.ReactNode; status?: { connected: boolean; configured: boolean }
}) {
  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        </div>
        {status && (
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${
              !status.configured ? 'bg-text-tertiary' :
              status.connected ? 'bg-status-green' : 'bg-status-red'
            }`} />
            <span className="text-xs text-text-muted">
              {!status.configured ? 'Not configured' : status.connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        )}
      </div>
      <div className="space-y-3">
        {children}
      </div>
    </div>
  )
}

export default function IntegrationsTab() {
  const settings = useSettingsApiStore((s) => s.settings)
  const status = useSettingsApiStore((s) => s.status)
  const saveSection = useSettingsApiStore((s) => s.saveSection)
  const markDirty = useSettingsApiStore((s) => s.markDirty)

  const ds = settings?.data_sources || {}
  const influx = settings?.influxdb || {}

  // Local form state
  const [librenms, setLibrenms] = useState({ url: '', api_key: '' })
  const [proxmox, setProxmox] = useState({ url: '', token_id: '', token_secret: '', verify_ssl: false })
  const [netdisco, setNetdisco] = useState({ url: '', api_key: '', username: '', password: '' })
  const [influxdb, setInfluxdb] = useState({ url: '', token: '', org: '', bucket: '', enabled: false })

  useEffect(() => {
    if (ds.librenms) setLibrenms({ url: ds.librenms.url || '', api_key: ds.librenms.api_key || '' })
    if (ds.proxmox) setProxmox({ url: ds.proxmox.url || '', token_id: ds.proxmox.token_id || '', token_secret: ds.proxmox.token_secret || '', verify_ssl: ds.proxmox.verify_ssl || false })
    if (ds.netdisco) setNetdisco({ url: ds.netdisco.url || '', api_key: ds.netdisco.api_key || '', username: ds.netdisco.username || '', password: ds.netdisco.password || '' })
    if (influx) setInfluxdb({ url: influx.url || '', token: influx.token || '', org: influx.org || '', bucket: influx.bucket || '', enabled: influx.enabled || false })
  }, [settings])

  const updateField = (setter: Function, field: string, value: unknown) => {
    setter((prev: Record<string, unknown>) => ({ ...prev, [field]: value }))
    markDirty('integrations', true)
  }

  const handleSave = async () => {
    await saveSection('data_sources', {
      librenms: librenms,
      netdisco: netdisco,
      proxmox: proxmox,
    })
    await saveSection('influxdb', influxdb)
  }

  return (
    <SettingsTab
      title="Integrations"
      description="Configure connections to your network monitoring tools."
      section="integrations"
      onSave={handleSave}
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* LibreNMS */}
        <SectionCard
          title="LibreNMS"
          icon="📡"
          status={status?.librenms ? { configured: status.librenms.configured, connected: status.librenms.connected } : undefined}
        >
          <Field label="URL">
            <TextInput value={librenms.url} onChange={(v) => updateField(setLibrenms, 'url', v)} placeholder="https://librenms.local" mono />
          </Field>
          <Field label="API Key">
            <SecretInput value={librenms.api_key} onChange={(v) => updateField(setLibrenms, 'api_key', v)} placeholder="Your LibreNMS API key" />
          </Field>
          <ConnectionTest type="librenms" getParams={() => librenms} />
        </SectionCard>

        {/* Proxmox */}
        <SectionCard
          title="Proxmox VE"
          icon="🖥️"
          status={status?.proxmox ? { configured: status.proxmox.configured, connected: status.proxmox.connected } : undefined}
        >
          <Field label="URL">
            <TextInput value={proxmox.url} onChange={(v) => updateField(setProxmox, 'url', v)} placeholder="https://proxmox:8006" mono />
          </Field>
          <Field label="Token ID">
            <TextInput value={proxmox.token_id} onChange={(v) => updateField(setProxmox, 'token_id', v)} placeholder="watchtower@pam!monitoring" mono />
          </Field>
          <Field label="Token Secret">
            <SecretInput value={proxmox.token_secret} onChange={(v) => updateField(setProxmox, 'token_secret', v)} />
          </Field>
          <Toggle checked={proxmox.verify_ssl} onChange={(v) => updateField(setProxmox, 'verify_ssl', v)} label="Verify SSL" />
          <ConnectionTest type="proxmox" getParams={() => proxmox} />
        </SectionCard>

        {/* InfluxDB */}
        <SectionCard
          title="InfluxDB"
          icon="📊"
          status={status?.influxdb ? { configured: status.influxdb.configured, connected: status.influxdb.connected } : undefined}
        >
          <Toggle checked={influxdb.enabled} onChange={(v) => updateField(setInfluxdb, 'enabled', v)} label="Enable historical data" />
          <Field label="URL">
            <TextInput value={influxdb.url} onChange={(v) => updateField(setInfluxdb, 'url', v)} placeholder="http://localhost:8086" mono />
          </Field>
          <Field label="Token">
            <SecretInput value={influxdb.token} onChange={(v) => updateField(setInfluxdb, 'token', v)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Organization">
              <TextInput value={influxdb.org} onChange={(v) => updateField(setInfluxdb, 'org', v)} placeholder="watchtower" />
            </Field>
            <Field label="Bucket">
              <TextInput value={influxdb.bucket} onChange={(v) => updateField(setInfluxdb, 'bucket', v)} placeholder="watchtower" />
            </Field>
          </div>
          <ConnectionTest type="influxdb" getParams={() => influxdb} />
        </SectionCard>

        {/* Netdisco */}
        <SectionCard
          title="Netdisco"
          icon="🔍"
        >
          <Field label="URL">
            <TextInput value={netdisco.url} onChange={(v) => updateField(setNetdisco, 'url', v)} placeholder="https://netdisco.local" mono />
          </Field>
          <Field label="API Key (Bearer Token)">
            <SecretInput value={netdisco.api_key} onChange={(v) => updateField(setNetdisco, 'api_key', v)} />
          </Field>
          <div className="text-xs text-text-tertiary">Or use Basic Auth:</div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Username">
              <TextInput value={netdisco.username} onChange={(v) => updateField(setNetdisco, 'username', v)} />
            </Field>
            <Field label="Password">
              <SecretInput value={netdisco.password} onChange={(v) => updateField(setNetdisco, 'password', v)} />
            </Field>
          </div>
          <ConnectionTest type="netdisco" getParams={() => netdisco} />
        </SectionCard>
      </div>
    </SettingsTab>
  )
}
