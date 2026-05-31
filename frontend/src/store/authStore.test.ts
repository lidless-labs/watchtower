import { beforeEach, describe, expect, it, vi } from 'vitest'

function installBrowserStorage() {
  const store = new Map<string, string>()
  const localStorageMock = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => store.set(key, value)),
    removeItem: vi.fn((key: string) => store.delete(key)),
    clear: vi.fn(() => store.clear()),
  }

  vi.stubGlobal('localStorage', localStorageMock)
  vi.stubGlobal('window', {
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  })

  return localStorageMock
}

function base64Url(input: string): string {
  return btoa(input).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64Url(JSON.stringify(payload)),
    'signature',
  ].join('.')
}

describe('authStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    installBrowserStorage()
  })

  it('clears expired tokens before validating with the server', async () => {
    const { apiClient } = await import('../api/client')
    const { useAuthStore } = await import('./authStore')
    const getSpy = vi.spyOn(apiClient, 'get')
    const expired = unsignedJwt({ exp: Math.floor(Date.now() / 1000) - 60 })

    localStorage.setItem('watchtower_token', expired)
    useAuthStore.setState({
      token: expired,
      user: { username: 'admin', role: 'admin' },
      isAuthenticated: true,
    })

    await expect(useAuthStore.getState().checkAuth()).resolves.toBe(false)
    expect(getSpy).not.toHaveBeenCalled()
    expect(localStorage.removeItem).toHaveBeenCalledWith('watchtower_token')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('sends the bootstrap token as a header during login', async () => {
    const { apiClient } = await import('../api/client')
    const { useAuthStore } = await import('./authStore')
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        token: 'jwt',
        user: { username: 'admin', role: 'admin' },
        expires_in: 3600,
        initial_setup: true,
      },
    })

    await useAuthStore.getState().login('admin', 'new-password', 'bootstrap-secret')

    expect(postSpy).toHaveBeenCalledWith(
      '/auth/login',
      { username: 'admin', password: 'new-password' },
      { headers: { 'X-Watchtower-Bootstrap-Token': 'bootstrap-secret' } }
    )
    expect(localStorage.setItem).toHaveBeenCalledWith('watchtower_token', 'jwt')
    expect(useAuthStore.getState().initialSetupComplete).toBe(true)
  })
})
