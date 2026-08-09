import { beforeEach, describe, expect, it } from 'vitest'

import { useNocStore } from './nocStore'
import type { Topology } from '../types/topology'
import type { Device } from '../types/device'

function makeDevice(overrides: Partial<Device> & Pick<Device, 'id' | 'status'>): Device {
  return {
    display_name: overrides.id,
    device_type: 'switch',
    stats: { cpu: 0, memory: 0, uptime: 0 },
    interfaces: [],
    alert_count: 0,
    ...overrides,
  }
}

function makeTopology(deviceStatus: Device['status'] = 'up'): Topology {
  const device = makeDevice({ id: 'dev-a', status: deviceStatus })
  return {
    clusters: [],
    devices: { [device.id]: device },
    connections: [],
    external_links: [],
    total_devices: 1,
    devices_up: deviceStatus === 'up' ? 1 : 0,
    devices_down: deviceStatus === 'down' ? 1 : 0,
    active_alerts: 0,
  }
}

describe('nocStore topology versioning', () => {
  beforeEach(() => {
    useNocStore.setState({
      topology: null,
      topologyVersion: 0,
      selectedDevice: null,
      selectedConnection: null,
      error: null,
      isLoading: false,
    })
  })

  it('applies a REST snapshot when no websocket update intervened', () => {
    const baseVersion = useNocStore.getState().topologyVersion
    const snapshot = makeTopology('up')

    const applied = useNocStore.getState().setTopology(snapshot, baseVersion)

    expect(applied).toBe(true)
    expect(useNocStore.getState().topology).toEqual(snapshot)
    expect(useNocStore.getState().topologyVersion).toBe(baseVersion)
  })

  it('does not let a stale REST snapshot clobber a concurrent websocket status update', () => {
    // Steady state: device A is up from an earlier successful fetch.
    const initial = makeTopology('up')
    expect(useNocStore.getState().setTopology(initial, 0)).toBe(true)

    // A new REST fetch starts (captures version), then a WS event lands
    // while the request is still in flight.
    const baseVersion = useNocStore.getState().topologyVersion
    useNocStore.getState().updateDeviceStatus('dev-a', 'down')
    expect(useNocStore.getState().topology?.devices['dev-a'].status).toBe('down')
    expect(useNocStore.getState().topologyVersion).toBe(baseVersion + 1)

    // The slow REST response still shows A as up. Applying it with the
    // pre-WS baseVersion must be a no-op.
    const staleSnapshot = makeTopology('up')
    const applied = useNocStore.getState().setTopology(staleSnapshot, baseVersion)

    expect(applied).toBe(false)
    expect(useNocStore.getState().topology?.devices['dev-a'].status).toBe('down')
    expect(useNocStore.getState().topology?.devices_down).toBe(1)
    expect(useNocStore.getState().topologyVersion).toBe(baseVersion + 1)
  })

  it('applies a later REST snapshot once its baseVersion matches post-WS state', () => {
    expect(useNocStore.getState().setTopology(makeTopology('up'), 0)).toBe(true)
    useNocStore.getState().updateDeviceStatus('dev-a', 'down')

    const baseVersion = useNocStore.getState().topologyVersion
    const freshSnapshot = makeTopology('down')
    const applied = useNocStore.getState().setTopology(freshSnapshot, baseVersion)

    expect(applied).toBe(true)
    expect(useNocStore.getState().topology?.devices['dev-a'].status).toBe('down')
    expect(useNocStore.getState().topologyVersion).toBe(baseVersion)
  })

  it('bumps topologyVersion on alert-count websocket updates so stale snapshots drop', () => {
    expect(useNocStore.getState().setTopology(makeTopology('up'), 0)).toBe(true)
    const baseVersion = useNocStore.getState().topologyVersion

    useNocStore.getState().updateAlertCount(1)
    expect(useNocStore.getState().topology?.active_alerts).toBe(1)
    expect(useNocStore.getState().topologyVersion).toBe(baseVersion + 1)

    const stale = { ...makeTopology('up'), active_alerts: 0 }
    expect(useNocStore.getState().setTopology(stale, baseVersion)).toBe(false)
    expect(useNocStore.getState().topology?.active_alerts).toBe(1)
  })
})
