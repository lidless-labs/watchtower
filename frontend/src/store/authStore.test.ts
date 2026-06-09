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

  return localStorageMock
}

describe('authStore', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    installBrowserStorage()
  })

  it('login never persists the token to localStorage (session cookie carries auth)', async () => {
    const { apiClient } = await import('../api/client')
    const { useAuthStore } = await import('./authStore')
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: {
        token: 'jwt',
        user: { username: 'admin', role: 'admin' },
        expires_in: 3600,
      },
    })

    await useAuthStore.getState().login('admin', 'password123')

    expect(localStorage.setItem).not.toHaveBeenCalledWith('watchtower_token', expect.anything())
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user).toEqual({ username: 'admin', role: 'admin' })
  })

  it('removes any token persisted by older releases on load', async () => {
    await import('./authStore')

    expect(localStorage.removeItem).toHaveBeenCalledWith('watchtower_token')
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
    expect(useAuthStore.getState().initialSetupComplete).toBe(true)
  })

  it('checkAuth asks the server and clears state when the session is rejected', async () => {
    const { apiClient } = await import('../api/client')
    const { useAuthStore } = await import('./authStore')
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('401'))

    useAuthStore.setState({
      user: { username: 'admin', role: 'admin' },
      isAuthenticated: true,
    })

    await expect(useAuthStore.getState().checkAuth()).resolves.toBe(false)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('logout clears state and asks the server to drop the session cookie', async () => {
    const { apiClient } = await import('../api/client')
    const { useAuthStore } = await import('./authStore')
    const postSpy = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { status: 'ok' } })

    useAuthStore.setState({
      user: { username: 'admin', role: 'admin' },
      isAuthenticated: true,
    })

    useAuthStore.getState().logout()

    expect(postSpy).toHaveBeenCalledWith('/auth/logout')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })
})
