import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import SettingsTab from './SettingsTab'

interface ThresholdBarProps {
  label: string
  warning: number
  critical: number
  onWarningChange: (v: number) => void
  onCriticalChange: (v: number) => void
}

function ThresholdBar({ label, warning, critical, onWarningChange, onCriticalChange }: ThresholdBarProps) {
  return (
    <div className="bg-bg-secondary rounded-lg border border-border-default p-4">
      <div className="text-sm font-medium text-text-primary mb-3">{label}</div>
      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-status-amber">Warning</span>
            <span className="text-xs font-mono text-status-amber">{warning}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={99}
            value={warning}
            onChange={(e) => onWarningChange(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-tertiary
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-status-amber
              [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-status-red">Critical</span>
            <span className="text-xs font-mono text-status-red">{critical}%</span>
          </div>
          <input
            type="range"
            min={10}
            max={100}
            value={critical}
            onChange={(e) => onCriticalChange(Number(e.target.value))}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-tertiary
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-status-red
              [&::-webkit-slider-thumb]:cursor-pointer"
          />
        </div>
      </div>
      {/* Visual threshold bar */}
      <div className="mt-3 h-2 rounded-full bg-bg-tertiary relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-status-green rounded-full" style={{ width: `${warning}%` }} />
        <div className="absolute inset-y-0 bg-status-amber rounded-full" style={{ left: `${warning}%`, width: `${critical - warning}%` }} />
        <div className="absolute inset-y-0 right-0 bg-status-red rounded-full" style={{ left: `${critical}%` }} />
      </div>
    </div>
  )
}

export default function AlertsTab() {
  const settings = useSettingsApiStore((s) => s.settings)
  const saveSection = useSettingsApiStore((s) => s.saveSection)
  const markDirty = useSettingsApiStore((s) => s.markDirty)

  const [thresholds, setThresholds] = useState({
    cpu_warning: 80, cpu_critical: 95,
    memory_warning: 85, memory_critical: 95,
    interface_utilization_warning: 70, interface_utilization_critical: 90,
  })

  useEffect(() => {
    if (settings?.alert_thresholds?.defaults) {
      setThresholds({ ...thresholds, ...settings.alert_thresholds.defaults })
    }
  }, [settings])

  const update = (field: string, value: number) => {
    setThresholds((prev) => ({ ...prev, [field]: value }))
    markDirty('alerts', true)
  }

  return (
    <SettingsTab
      title="Alert Thresholds"
      description="Set warning and critical thresholds for device metrics."
      section="alerts"
      onSave={() => saveSection('alert_thresholds', { defaults: thresholds })}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ThresholdBar
          label="CPU Utilization"
          warning={thresholds.cpu_warning}
          critical={thresholds.cpu_critical}
          onWarningChange={(v) => update('cpu_warning', Math.min(v, thresholds.cpu_critical - 1))}
          onCriticalChange={(v) => update('cpu_critical', Math.max(v, thresholds.cpu_warning + 1))}
        />
        <ThresholdBar
          label="Memory Utilization"
          warning={thresholds.memory_warning}
          critical={thresholds.memory_critical}
          onWarningChange={(v) => update('memory_warning', Math.min(v, thresholds.memory_critical - 1))}
          onCriticalChange={(v) => update('memory_critical', Math.max(v, thresholds.memory_warning + 1))}
        />
        <ThresholdBar
          label="Interface Utilization"
          warning={thresholds.interface_utilization_warning}
          critical={thresholds.interface_utilization_critical}
          onWarningChange={(v) => update('interface_utilization_warning', Math.min(v, thresholds.interface_utilization_critical - 1))}
          onCriticalChange={(v) => update('interface_utilization_critical', Math.max(v, thresholds.interface_utilization_warning + 1))}
        />
      </div>
    </SettingsTab>
  )
}
