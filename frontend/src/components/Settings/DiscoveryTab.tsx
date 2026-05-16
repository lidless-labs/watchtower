import { useEffect, useState } from 'react'
import { useSettingsApiStore } from '../../store/settingsApiStore'
import { Toggle } from '../common/Toggle'
import SettingsTab from './SettingsTab'

const DEVICE_TYPES = ['firewall', 'network', 'server', 'wireless', 'printer', 'phone', 'power']

function SubnetList({ subnets, onChange }: { subnets: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')

  const addSubnet = () => {
    const trimmed = draft.trim()
    if (!trimmed || subnets.includes(trimmed)) return
    // Basic CIDR validation
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(trimmed)) return
    onChange([...subnets, trimmed])
    setDraft('')
  }

  const removeSubnet = (idx: number) => {
    onChange(subnets.filter((_, i) => i !== idx))
  }

  return (
    <div>
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addSubnet()}
          placeholder="10.2.50.0/24"
          className="flex-1 bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm font-mono focus:outline-none focus:ring-2 focus:ring-accent-cyan/40"
        />
        <button
          onClick={addSubnet}
          className="px-3 py-2 text-sm font-medium bg-bg-tertiary text-text-secondary border border-border-default rounded-lg hover:bg-bg-primary transition-colors"
        >
          Add
        </button>
      </div>
      {subnets.length === 0 ? (
        <p className="text-xs text-text-muted italic">No subnets excluded</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {subnets.map((subnet, idx) => (
            <span
              key={idx}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-primary border border-border-default rounded-md text-sm font-mono text-text-secondary"
            >
              {subnet}
              <button
                onClick={() => removeSubnet(idx)}
                className="text-text-muted hover:text-status-red transition-colors"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

export default function DiscoveryTab() {
  const settings = useSettingsApiStore((s) => s.settings)
  const saveSection = useSettingsApiStore((s) => s.saveSection)
  const markDirty = useSettingsApiStore((s) => s.markDirty)

  const [vmSubnets, setVmSubnets] = useState<string[]>(['10.2.50.0/24'])
  const [includeTypes, setIncludeTypes] = useState<string[]>(['firewall', 'network', 'server', 'wireless'])
  const [autoSync, setAutoSync] = useState(false)
  const [syncInterval, setSyncInterval] = useState(3600)

  useEffect(() => {
    if (settings?.discovery) {
      const d = settings.discovery
      if (d.vm_subnets) setVmSubnets(d.vm_subnets)
      if (d.include_types) setIncludeTypes(d.include_types)
      if (d.auto_sync !== undefined) setAutoSync(d.auto_sync)
      if (d.sync_interval) setSyncInterval(d.sync_interval)
    }
  }, [settings])

  const toggleType = (type: string) => {
    setIncludeTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
    )
    markDirty('discovery', true)
  }

  const handleSave = () => {
    saveSection('discovery', {
      vm_subnets: vmSubnets,
      include_types: includeTypes,
      auto_sync: autoSync,
      sync_interval: syncInterval,
    })
  }

  return (
    <SettingsTab
      title="Device Discovery"
      description="Configure how Watchtower discovers and classifies devices from LibreNMS."
      section="discovery"
      onSave={handleSave}
    >
      {/* VM Subnet Exclusions */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-1">VM Subnet Exclusions</h3>
        <p className="text-xs text-text-muted mb-3">
          Subnets where virtual machines live. Devices in these subnets are excluded from topology to avoid clutter.
        </p>
        <SubnetList
          subnets={vmSubnets}
          onChange={(v) => { setVmSubnets(v); markDirty('discovery', true) }}
        />
      </div>

      {/* Device Types */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Include Device Types</h3>
        <p className="text-xs text-text-muted mb-3">
          Only devices matching these types (mapped from LibreNMS OS classification) appear in the topology.
        </p>
        <div className="flex flex-wrap gap-2">
          {DEVICE_TYPES.map((type) => {
            const active = includeTypes.includes(type)
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors capitalize ${
                  active
                    ? 'bg-accent-cyan/10 border-accent-cyan/40 text-accent-cyan'
                    : 'bg-bg-primary border-border-default text-text-muted hover:text-text-secondary'
                }`}
              >
                {type}
              </button>
            )
          })}
        </div>
      </div>

      {/* Auto-Sync */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Auto-Sync Topology</h3>
            <p className="text-xs text-text-muted mt-0.5">
              Periodically re-discover devices from LibreNMS and update the topology.
            </p>
          </div>
          <Toggle
            checked={autoSync}
            onChange={(next) => { setAutoSync(next); markDirty('discovery', true) }}
            label=""
            ariaLabel={`${autoSync ? 'Disable' : 'Enable'} auto sync`}
          />
        </div>

        {autoSync && (
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-text-secondary">Sync Interval</span>
              <span className="text-xs font-mono text-accent-cyan">
                {syncInterval >= 3600
                  ? `${Math.floor(syncInterval / 3600)}h ${(syncInterval % 3600) / 60 > 0 ? `${Math.floor((syncInterval % 3600) / 60)}m` : ''}`
                  : `${Math.floor(syncInterval / 60)}m`
                }
              </span>
            </div>
            <input
              type="range"
              min={300}
              max={7200}
              step={300}
              value={syncInterval}
              onChange={(e) => { setSyncInterval(Number(e.target.value)); markDirty('discovery', true) }}
              className="w-full h-1.5 rounded-full appearance-none cursor-pointer bg-bg-tertiary
                [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-cyan
                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-text-tertiary mt-1">
              <span>5m</span>
              <span>2h</span>
            </div>
          </div>
        )}
      </div>

      <div className="p-3 bg-bg-primary rounded-lg border border-border-muted">
        <div className="text-xs text-text-muted">
          <strong className="text-text-secondary">Note:</strong> Discovery changes require a backend restart to take effect.
          Auto-sync only works when LibreNMS is configured and connected.
        </div>
      </div>
    </SettingsTab>
  )
}
