import { beforeEach, describe, expect, it, vi } from 'vitest'

function installBrowserStorage() {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  })
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
}

describe('settingsApiStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    installBrowserStorage()
  })

  it('saves a settings section and clears dirty state', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ polling: { device_status: 30 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { useSettingsApiStore } = await import('./settingsApiStore')
    useSettingsApiStore.setState({ dirty: { polling: true } })

    await expect(
      useSettingsApiStore.getState().saveSection('polling', { device_status: 30 })
    ).resolves.toBe(true)

    // Auth rides on the HttpOnly session cookie, so no Authorization header.
    expect(fetchMock).toHaveBeenCalledWith('/api/settings/polling', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ device_status: 30 }),
    })
    expect(useSettingsApiStore.getState().dirty.polling).toBe(false)
    expect(useSettingsApiStore.getState().saveSuccess).toBe(true)
  })

  it('surfaces API save errors without marking the section clean', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'Invalid setting' }, { status: 400 }))
    )

    const { useSettingsApiStore } = await import('./settingsApiStore')
    useSettingsApiStore.setState({ dirty: { polling: true } })

    await expect(
      useSettingsApiStore.getState().saveSection('polling', { bad: true })
    ).resolves.toBe(false)

    expect(useSettingsApiStore.getState().dirty.polling).toBe(true)
    expect(useSettingsApiStore.getState().saveError).toBe('Invalid setting')
  })
})
