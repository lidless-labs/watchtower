import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import SettingsTab from './SettingsTab'

interface IntervalControlProps {
  label: string
  description: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}

function IntervalControl({ label, description, value, onChange, min = 5, max = 600, step = 5, unit = 's' }: IntervalControlProps) {
  const displayValue = unit === 's' && value >= 60
    ? `${Math.floor(value / 60)}m ${value % 60 ? `${value % 60}s` : ''}`
    : `${value}${unit}`

  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-sm font-medium text-text-primary">{label}</div>
          <div className="text-xs text-text-muted">{description}</div>
        </div>
        <div className="text-sm font-mono text-accent-cyan font-medium min-w-[60px] text-right">
          {displayValue}
        </div>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-tertiary
          [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-cyan
          [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
      />
      <div className="flex justify-between text-[10px] text-text-tertiary mt-1">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

export default function PollingTab() {
  const settings = useSettingsApiStore((s) => s.settings)
  const saveSection = useSettingsApiStore((s) => s.saveSection)
  const markDirty = useSettingsApiStore((s) => s.markDirty)

  const [polling, setPolling] = useState({
    device_status: 30,
    device_stats: 60,
    topology: 300,
    interfaces: 60,
    proxmox: 60,
  })

  useEffect(() => {
    if (settings?.polling) {
      setPolling({
        device_status: settings.polling.device_status || 30,
        device_stats: settings.polling.device_stats || 60,
        topology: settings.polling.topology || 300,
        interfaces: settings.polling.interfaces || 60,
        proxmox: settings.polling.proxmox || 60,
      })
    }
  }, [settings])

  const update = (field: string, value: number) => {
    setPolling((prev) => ({ ...prev, [field]: value }))
    markDirty('polling', true)
  }

  return (
    <SettingsTab
      title="Polling Intervals"
      description="How often Watchtower checks each data source. Lower values = faster updates but more API load."
      section="polling"
      onSave={() => saveSection('polling', polling)}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <IntervalControl
          label="Device Status"
          description="Up/down detection (ICMP/SNMP)"
          value={polling.device_status}
          onChange={(v) => update('device_status', v)}
          min={10}
          max={120}
          step={5}
        />
        <IntervalControl
          label="Interface Statistics"
          description="Port throughput, errors, utilization"
          value={polling.interfaces}
          onChange={(v) => update('interfaces', v)}
          min={15}
          max={300}
          step={15}
        />
        <IntervalControl
          label="Device Stats"
          description="CPU, memory, temperature"
          value={polling.device_stats}
          onChange={(v) => update('device_stats', v)}
          min={30}
          max={300}
          step={15}
        />
        <IntervalControl
          label="Topology Discovery"
          description="CDP/LLDP neighbor and VLAN polling"
          value={polling.topology}
          onChange={(v) => update('topology', v)}
          min={60}
          max={900}
          step={30}
        />
        <IntervalControl
          label="Proxmox"
          description="VM/container stats and node health"
          value={polling.proxmox}
          onChange={(v) => update('proxmox', v)}
          min={15}
          max={300}
          step={15}
        />
      </div>

      <div className="mt-4 p-3 bg-bg-primary rounded-lg border border-border-muted">
        <div className="text-xs text-text-muted">
          <strong className="text-text-secondary">Note:</strong> Changes take effect after backend restart.
          Aggressive polling intervals may trigger API rate limits on LibreNMS or Proxmox.
        </div>
      </div>
    </SettingsTab>
  )
}
