/**
 * ProxmoxPanel Component
 *
 * Homarr-style Proxmox node detail panel showing:
 * - Node info with CPU/RAM
 * - VMs list with CPU/RAM per VM
 * - LXCs list with CPU/RAM per container
 * - Storage with usage bars
 */

import { useState, useEffect } from 'react'
import { fetchProxmoxNode } from '../../api/endpoints'

interface NodeInfo {
  node: string
  status: string
  cpu: number
  memory: number
  maxcpu: number
  maxmem: number
  uptime: number
}

interface VMInfo {
  vmid: number
  name: string
  type: string
  status: string
  cpu: number
  memory: number
}

interface StorageInfo {
  storage: string
  type: string
  used: number
  total: number
  used_percent: number
}

interface ProxmoxNodeDetail {
  node: NodeInfo | null
  vms: VMInfo[]
  lxcs: VMInfo[]
  storage: StorageInfo[]
  vms_running: number
  vms_total: number
  lxcs_running: number
  lxcs_total: number
}

interface ProxmoxPanelProps {
  nodeName: string
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 4) return `${(bytes / 1024 ** 4).toFixed(1)} TB`
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024).toFixed(1)} KB`
}

export default function ProxmoxPanel({ nodeName }: ProxmoxPanelProps) {
  const [data, setData] = useState<ProxmoxNodeDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true)
        setError(null)
        const nodeData = await fetchProxmoxNode(nodeName)
        setData(nodeData)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    loadData()
    // Refresh every 30 seconds
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [nodeName])

  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <div className="px-5 py-5 text-center text-sm text-text-muted">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <div className="px-5 py-5 text-center text-sm text-status-red">{error}</div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div className="flex flex-col gap-4">
      {/* Node Section */}
      {data.node && (
        <Section
          title="Node"
          count={1}
          total={1}
          icon={<ServerIcon />}
        >
          <ResourceRow
            name={data.node.node}
            cpu={data.node.cpu}
            memory={data.node.memory}
            status={data.node.status}
          />
        </Section>
      )}

      {/* VMs Section */}
      {data.vms.length > 0 && (
        <Section
          title="VMs"
          count={data.vms_running}
          total={data.vms_total}
          icon={<VMIcon />}
        >
          {data.vms.map((vm) => (
            <ResourceRow
              key={`vm-${vm.vmid}`}
              name={vm.name}
              cpu={vm.cpu}
              memory={vm.memory}
              status={vm.status}
            />
          ))}
        </Section>
      )}

      {/* LXCs Section */}
      {data.lxcs.length > 0 && (
        <Section
          title="LXCs"
          count={data.lxcs_running}
          total={data.lxcs_total}
          icon={<ContainerIcon />}
        >
          {data.lxcs.map((lxc) => (
            <ResourceRow
              key={`lxc-${lxc.vmid}`}
              name={lxc.name}
              cpu={lxc.cpu}
              memory={lxc.memory}
              status={lxc.status}
            />
          ))}
        </Section>
      )}

      {/* Storage Section */}
      {data.storage.length > 0 && (
        <Section
          title="Storage"
          count={data.storage.length}
          total={data.storage.length}
          icon={<StorageIcon />}
        >
          {data.storage.map((storage) => (
            <StorageRow
              key={storage.storage}
              name={storage.storage}
              type={storage.type}
              used={storage.used}
              total={storage.total}
              usedPercent={storage.used_percent}
            />
          ))}
        </Section>
      )}

    </div>
  )
}

// Section component
function Section({
  title,
  count,
  total,
  icon,
  children,
}: {
  title: string
  count: number
  total: number
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-border-default bg-bg-primary">
      <div className="flex items-center justify-between border-b border-border-default bg-gradient-to-b from-bg-secondary to-bg-primary px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-text-secondary">
          <span className="h-4 w-4 text-text-tertiary">{icon}</span>
          <span>{title}</span>
        </div>
        <span className="rounded-full border border-border-default bg-bg-secondary px-2 py-0.5 text-[11px] text-text-tertiary">
          {count} / {total}
        </span>
      </div>
      <div>
        {title !== 'Storage' && (
          <div
            className="grid border-b border-border-muted px-3 py-1.5 text-[10px] uppercase tracking-wider text-text-tertiary"
            style={{ gridTemplateColumns: '1fr 60px 60px' }}
          >
            <span>Name</span>
            <span className="text-right">CPU</span>
            <span className="text-right">RAM</span>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

// Resource row (VMs, LXCs, Node)
function ResourceRow({
  name,
  cpu,
  memory,
  status,
}: {
  name: string
  cpu: number
  memory: number
  status: string
}) {
  const isLive = status === 'running' || status === 'online'
  return (
    <div
      className="grid items-center border-b border-border-muted px-3 py-2 transition-colors last:border-b-0 hover:bg-bg-secondary"
      style={{ gridTemplateColumns: '1fr 60px 60px' }}
    >
      <div className="flex items-center gap-2 overflow-hidden text-[13px] text-text-primary">
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
            isLive ? 'bg-status-green shadow-[0_0_4px_theme(colors.status-green)]' : 'bg-text-tertiary'
          }`}
        />
        <span className="truncate" title={name}>{name}</span>
      </div>
      <span className="text-right font-mono text-xs text-accent-blue">{cpu.toFixed(1)}%</span>
      <span className="text-right font-mono text-xs text-accent-purple">{memory.toFixed(1)}%</span>
    </div>
  )
}

// Storage row
function StorageRow({
  name,
  type,
  used,
  total,
  usedPercent,
}: {
  name: string
  type: string
  used: number
  total: number
  usedPercent: number
}) {
  const barGradient =
    usedPercent >= 90
      ? 'bg-gradient-to-r from-red-500 to-red-400'
      : usedPercent >= 70
      ? 'bg-gradient-to-r from-amber-500 to-amber-400'
      : 'bg-gradient-to-r from-blue-500 to-blue-400'

  return (
    <div className="flex flex-col gap-1.5 border-b border-border-muted px-3 py-2.5 transition-colors last:border-b-0 hover:bg-bg-secondary">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-text-primary">{name}</span>
        <span className="rounded bg-bg-secondary px-1.5 py-0.5 text-[10px] text-text-tertiary">{type}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-bg-tertiary">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${barGradient}`}
          style={{ width: `${Math.min(usedPercent, 100)}%` }}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-text-tertiary">
        <span>{formatBytes(used)} / {formatBytes(total)}</span>
        <span className="text-text-muted">{usedPercent.toFixed(1)}%</span>
      </div>
    </div>
  )
}

// Icons
function ServerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="2" y="3" width="20" height="6" rx="1" />
      <rect x="2" y="15" width="20" height="6" rx="1" />
      <circle cx="6" cy="6" r="1" fill="currentColor" />
      <circle cx="6" cy="18" r="1" fill="currentColor" />
    </svg>
  )
}

function VMIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M7 20h10" />
      <path d="M9 16v4" />
      <path d="M15 16v4" />
    </svg>
  )
}

function ContainerIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05" />
      <path d="M12 22.08V12" />
    </svg>
  )
}

function StorageIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </svg>
  )
}
