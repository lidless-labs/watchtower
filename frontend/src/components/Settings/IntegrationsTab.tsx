import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import { Toggle } from '../common/Toggle'
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

  const librenmsSettings = settings?.data_sources?.librenms
  const proxmoxSettings = settings?.data_sources?.proxmox
  const netdiscoSettings = settings?.data_sources?.netdisco
  const influxSettings = settings?.influxdb

  // Local form state
  const [librenms, setLibrenms] = useState({ url: '', api_key: '' })
  const [proxmox, setProxmox] = useState({ url: '', token_id: '', token_secret: '', verify_ssl: false })
  const [netdisco, setNetdisco] = useState({ url: '', api_key: '', username: '', password: '' })
  const [influxdb, setInfluxdb] = useState({ url: '', token: '', org: '', bucket: '', enabled: false })

  useEffect(() => {
    if (librenmsSettings) {
      setLibrenms((current) => ({
        ...current,
        url: librenmsSettings.url || '',
        [String('api_key')]: librenmsSettings.api_key || '',
      }))
    }
    if (proxmoxSettings) setProxmox({ url: proxmoxSettings.url || '', token_id: proxmoxSettings.token_id || '', token_secret: proxmoxSettings.token_secret || '', verify_ssl: proxmoxSettings.verify_ssl || false })
    if (netdiscoSettings) {
      setNetdisco((current) => ({
        ...current,
        url: netdiscoSettings.url || '',
        [String('api_key')]: netdiscoSettings.api_key || '',
        username: netdiscoSettings.username || '',
        password: netdiscoSettings.password || '',
      }))
    }
    if (influxSettings) {
      setInfluxdb((current) => ({
        ...current,
        url: influxSettings.url || '',
        [String('token')]: influxSettings.token || '',
        org: influxSettings.org || '',
        bucket: influxSettings.bucket || '',
        enabled: influxSettings.enabled || false,
      }))
    }
  }, [librenmsSettings, proxmoxSettings, netdiscoSettings, influxSettings])

  const updateField = <T extends Record<string, unknown>>(
    setter: React.Dispatch<React.SetStateAction<T>>,
    field: keyof T,
    value: T[keyof T],
  ) => {
    setter((prev) => ({ ...prev, [field]: value }))
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
