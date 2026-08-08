import { AxiosError, type InternalAxiosRequestConfig } from 'axios'
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

function rejectWithStatus(config: InternalAxiosRequestConfig, status: number): Promise<never> {
  const error = new AxiosError(
    `Request failed with status code ${status}`,
    AxiosError.ERR_BAD_REQUEST,
    config,
    {},
    {
      status,
      statusText: 'Error',
      headers: {},
      config,
      data: {},
    }
  )
  return Promise.reject(error)
}

describe('endpoints fetchJson via apiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
    installBrowserStorage()
  })

  it('returns parsed JSON on success', async () => {
    const { apiClient } = await import('./client')
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { nodes: [] } })

    const { fetchTopology } = await import('./endpoints')

    await expect(fetchTopology()).resolves.toEqual({ nodes: [] })
    expect(apiClient.get).toHaveBeenCalledWith('/topology', undefined)
  })

  it('returns fallback on HTTP error responses', async () => {
    const { apiClient } = await import('./client')
    const error = new AxiosError(
      'Service Unavailable',
      AxiosError.ERR_BAD_RESPONSE,
      undefined,
      undefined,
      {
        status: 503,
        statusText: 'Service Unavailable',
        headers: {},
        config: {} as InternalAxiosRequestConfig,
        data: {},
      }
    )
    vi.spyOn(apiClient, 'get').mockRejectedValue(error)

    const { fetchSpeedtest } = await import('./endpoints')

    await expect(fetchSpeedtest()).resolves.toEqual({ status: 'no_data' })
  })

  it('routes 401 through handleAuthError via the axios interceptor', async () => {
    const { apiClient } = await import('./client')
    const { useAuthStore } = await import('../store/authStore')
    const handleAuthError = vi.spyOn(useAuthStore.getState(), 'handleAuthError')

    useAuthStore.setState({
      user: { username: 'admin', role: 'admin' },
      isAuthenticated: true,
    })

    apiClient.defaults.adapter = (config) => rejectWithStatus(config, 401)

    const { fetchTopology } = await import('./endpoints')

    await expect(fetchTopology()).rejects.toBeInstanceOf(AxiosError)
    expect(handleAuthError).toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('returns fallback on 401 while still clearing auth state', async () => {
    const { apiClient } = await import('./client')
    const { useAuthStore } = await import('../store/authStore')
    const handleAuthError = vi.spyOn(useAuthStore.getState(), 'handleAuthError')

    useAuthStore.setState({
      user: { username: 'admin', role: 'admin' },
      isAuthenticated: true,
    })

    apiClient.defaults.adapter = (config) => rejectWithStatus(config, 401)

    const { fetchSpeedtest } = await import('./endpoints')

    await expect(fetchSpeedtest()).resolves.toEqual({ status: 'no_data' })
    expect(handleAuthError).toHaveBeenCalled()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })

  it('rethrows network errors when no fallback is provided', async () => {
    const { apiClient } = await import('./client')
    const error = new AxiosError('Network Error', AxiosError.ERR_NETWORK)
    vi.spyOn(apiClient, 'get').mockRejectedValue(error)

    const { fetchTopology } = await import('./endpoints')

    await expect(fetchTopology()).rejects.toBe(error)
  })
})
