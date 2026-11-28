import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDeviceLogs } from '../../api/endpoints'
import type { DeviceLogEntry, DeviceLogKind } from '../../types/device'
import {
  DeviceLogMessage,
  DeviceLogSourceSelector,
  DeviceLogsEntries,
  formatSeverity,
  requestDeviceLogs,
  selectDeviceLogKind,
} from './DeviceLogsPanel'

vi.mock('../../api/endpoints', () => ({
  fetchDeviceLogs: vi.fn().mockResolvedValue([]),
}))

const entry: DeviceLogEntry = {
  timestamp: '2026-11-28 12:34:56',
  type: 'syslog',
  severity: '5',
  message: 'Interface state changed',
}

describe('DeviceLogsPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders the loading state', () => {
    const markup = renderToStaticMarkup(
      <DeviceLogsEntries entries={[]} loading error={false} />,
    )

    expect(markup).toContain('Loading logs...')
    expect(markup).not.toContain('No log entries found.')
  })

  it('renders the error state', () => {
    const markup = renderToStaticMarkup(
      <DeviceLogsEntries entries={[]} loading={false} error />,
    )

    expect(markup).toContain('Logs are currently unavailable.')
    expect(markup).not.toContain('No log entries found.')
  })

  it('renders the empty state', () => {
    const markup = renderToStaticMarkup(
      <DeviceLogsEntries entries={[]} loading={false} error={false} />,
    )

    expect(markup).toContain('No log entries found.')
  })

  it('passes the selected kind and limit to fetchDeviceLogs', async () => {
    let selectedKind: DeviceLogKind = 'eventlog'
    selectDeviceLogKind('syslog', (kind) => { selectedKind = kind })
    const markup = renderToStaticMarkup(
      <DeviceLogSourceSelector kind={selectedKind} onChange={() => {}} />,
    )

    expect(markup).toContain('value="syslog" selected=""')
    await requestDeviceLogs('fixture-router', selectedKind, new AbortController().signal)
    expect(fetchDeviceLogs).toHaveBeenCalledWith(
      'fixture-router',
      'syslog',
      50,
      expect.any(AbortSignal),
    )
  })

  it('maps LibreNMS severities to labels', () => {
    expect(['1', '2', '3', '4', '5', '6'].map(formatSeverity)).toEqual([
      'Ok', 'Info', 'Notice', 'Warning', 'Error', 'Critical',
    ])
  })

  it('renders device supplied markup as escaped text', () => {
    const message = '<img src=x onerror=alert(1)>'
    const markup = renderToStaticMarkup(<DeviceLogMessage message={message} />)

    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(markup).not.toContain('<img')
  })

  it('renders actual entries with their severity label', () => {
    const markup = renderToStaticMarkup(
      <DeviceLogsEntries entries={[entry]} loading={false} error={false} />,
    )

    expect(markup).toContain('syslog · Error')
    expect(markup).toContain('Interface state changed')
  })
})
