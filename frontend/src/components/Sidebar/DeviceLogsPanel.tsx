import { useEffect, useState } from 'react'
import { fetchDeviceLogs } from '../../api/endpoints'
import type { DeviceLogEntry, DeviceLogKind } from '../../types/device'

export const LOG_KINDS: { value: DeviceLogKind; label: string }[] = [
  { value: 'eventlog', label: 'Event log' },
  { value: 'syslog', label: 'Syslog' },
  { value: 'alertlog', label: 'Alert log' },
]

interface DeviceLogsPanelProps {
  deviceId: string
}

export function DeviceLogMessage({ message }: { message: string }) {
  return <span className="whitespace-pre-wrap break-words">{message}</span>
}

export function formatSeverity(severity?: string | null): string | null {
  if (!severity) return null
  const labels: Record<string, string> = {
    '1': 'Ok',
    '2': 'Info',
    '3': 'Notice',
    '4': 'Warning',
    '5': 'Error',
    '6': 'Critical',
  }
  return labels[severity] ?? severity
}

export function selectDeviceLogKind(
  value: string,
  onChange: (kind: DeviceLogKind) => void,
) {
  if (LOG_KINDS.some((option) => option.value === value)) {
    onChange(value as DeviceLogKind)
  }
}

export function requestDeviceLogs(
  deviceId: string,
  kind: DeviceLogKind,
  signal: AbortSignal,
) {
  return fetchDeviceLogs(deviceId, kind, 50, signal)
}

export function DeviceLogsEntries({
  entries,
  loading,
  error,
}: {
  entries: DeviceLogEntry[]
  loading: boolean
  error: boolean
}) {
  return (
    <div className="max-h-72 space-y-2 overflow-y-auto" aria-live="polite">
      {loading && (
        <p className="py-4 text-center text-xs text-text-muted">Loading logs...</p>
      )}
      {!loading && error && (
        <p className="py-4 text-center text-xs text-status-red">Logs are currently unavailable.</p>
      )}
      {!loading && !error && entries.length === 0 && (
        <p className="py-4 text-center text-xs text-text-muted">No log entries found.</p>
      )}
      {!loading && !error && entries.map((entry, index) => (
        <article
          key={`${entry.timestamp}-${entry.type ?? 'log'}-${index}`}
          className="rounded border border-border-default bg-bg-tertiary/50 p-2 text-xs"
        >
          <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 text-[10px] text-text-muted">
            <span>{entry.timestamp}</span>
            <span className="uppercase tracking-wide">
              {[entry.type, formatSeverity(entry.severity)]
                .filter(Boolean)
                .join(' · ') || 'Log entry'}
            </span>
          </div>
          <div className="text-text-secondary"><DeviceLogMessage message={entry.message} /></div>
        </article>
      ))}
    </div>
  )
}

export function DeviceLogSourceSelector({
  kind,
  onChange,
}: {
  kind: DeviceLogKind
  onChange: (kind: DeviceLogKind) => void
}) {
  return (
    <label className="flex items-center gap-2 text-[10px] text-text-muted">
      <span>Source</span>
      <select
        aria-label="Device log source"
        value={kind}
        onChange={(event) => selectDeviceLogKind(event.target.value, onChange)}
        className="rounded border border-border-default bg-bg-tertiary px-2 py-1 text-xs text-text-secondary"
      >
        {LOG_KINDS.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

export default function DeviceLogsPanel({ deviceId }: DeviceLogsPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [kind, setKind] = useState<DeviceLogKind>('eventlog')
  const [entries, setEntries] = useState<DeviceLogEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!expanded) return

    const controller = new AbortController()
    setLoading(true)
    setError(false)
    requestDeviceLogs(deviceId, kind, controller.signal)
      .then(setEntries)
      .catch(() => {
        if (!controller.signal.aborted) {
          setEntries([])
          setError(true)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [deviceId, expanded, kind])

  return (
    <section className="space-y-2 border-b border-border-default mb-4 pb-4">
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
          className="text-xs font-semibold text-text-muted uppercase tracking-wide hover:text-text-secondary"
        >
          Device logs
        </button>
        {expanded && <DeviceLogSourceSelector kind={kind} onChange={setKind} />}
      </div>

      {expanded && (
        <DeviceLogsEntries entries={entries} loading={loading} error={error} />
      )}
    </section>
  )
}
