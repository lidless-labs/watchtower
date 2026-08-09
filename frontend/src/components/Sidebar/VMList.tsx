import { useState } from 'react'
import clsx from 'clsx'
import { fetchVMs, type ProxmoxVM, type VMSummary } from '../../api/endpoints'
import { usePollingInterval } from '../../hooks/usePollingInterval'

interface VMListState {
  vms: ProxmoxVM[]
  summary: VMSummary | null
  loading: boolean
  error: string | null
}

function getUtilizationColor(value: number): string {
  if (value >= 90) return 'text-status-red'
  if (value >= 70) return 'text-status-amber'
  return 'text-status-green'
}

function VMIcon({ type }: { type: 'qemu' | 'lxc' }) {
  const iconClass = 'w-3.5 h-3.5 text-text-muted'

  if (type === 'lxc') {
    // Container icon
    return (
      <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
        />
      </svg>
    )
  }

  // VM icon
  return (
    <svg className={iconClass} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
      />
    </svg>
  )
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={clsx(
        'w-4 h-4 text-text-muted transition-transform duration-200',
        expanded && 'rotate-90'
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  )
}

export default function VMList() {
  const [state, setState] = useState<VMListState>({
    vms: [],
    summary: null,
    loading: true,
    error: null,
  })
  const [expanded, setExpanded] = useState(false)

  usePollingInterval(async () => {
    try {
      const data = await fetchVMs()
      setState({
        vms: data.vms,
        summary: data.summary,
        loading: false,
        error: null,
      })
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load VMs',
      }))
      throw err
    }
  }, 60_000)

  // Don't render if no VMs or error
  if (state.loading) {
    return null
  }

  if (state.error || !state.summary || state.summary.total_running === 0) {
    return null
  }

  const { vms, summary } = state

  return (
    <div className="mt-4 pt-4 border-t border-border-default">
      {/* Header - clickable to expand/collapse */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between text-left group"
      >
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wide flex items-center gap-2">
          <ChevronIcon expanded={expanded} />
          Virtual Machines
        </h3>
        <div className="flex items-center gap-3 text-xs text-text-muted">
          <span>{summary.total_qemu} VM</span>
          <span>{summary.total_lxc} CT</span>
        </div>
      </button>

      {/* Summary stats (always visible) */}
      <div className="mt-2 flex items-center gap-4 text-xs text-text-secondary">
        <span>{summary.total_running} running</span>
        <span>{summary.total_cpus} vCPUs</span>
        <span>{summary.total_memory_gb} GB</span>
      </div>

      {/* Expanded VM list */}
      {expanded && (
        <div className="mt-3 space-y-1 max-h-64 overflow-y-auto">
          {vms.map((vm) => (
            <div
              key={`${vm.instance}-${vm.vmid}`}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-bg-tertiary transition-colors"
            >
              <VMIcon type={vm.type} />
              <span className="flex-1 text-sm text-text-primary truncate" title={vm.name}>
                {vm.name}
              </span>
              <div className="flex items-center gap-3 text-xs">
                <span className={clsx('w-10 text-right', getUtilizationColor(vm.cpu))}>
                  {Math.round(vm.cpu)}%
                </span>
                <span className={clsx('w-10 text-right', getUtilizationColor(vm.memory))}>
                  {Math.round(vm.memory)}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
