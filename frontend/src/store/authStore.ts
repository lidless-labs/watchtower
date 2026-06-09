import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../api/client'

type UserRole = 'admin' | 'operator' | 'viewer'

interface AuthUser {
  username: string
  role: UserRole
}

interface LoginResponse {
  token: string
  user: AuthUser
  expires_in: number
  initial_setup?: boolean
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  initialSetupComplete: boolean
  login: (username: string, password: string, bootstrapToken?: string) => Promise<void>
  logout: () => void
  checkAuth: () => Promise<boolean>
  clearInitialSetupFlag: () => void
  handleAuthError: () => void
}

// The JWT lives in an HttpOnly session cookie set by the backend, so it is
// never readable from JavaScript (XSS cannot exfiltrate it). This store only
// tracks who is logged in for UI gating; the server is the source of truth.
//
// Drop the token older releases persisted to localStorage. (Guarded so the
// module also loads in non-browser test environments.)
if (typeof localStorage !== 'undefined') {
  localStorage.removeItem('watchtower_token')
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      initialSetupComplete: false,

      login: async (username, password, bootstrapToken) => {
        const response = await apiClient.post<LoginResponse>(
          '/auth/login',
          {
            username,
            password,
          },
          {
            headers: bootstrapToken ? { 'X-Watchtower-Bootstrap-Token': bootstrapToken } : undefined,
          }
        )

        const { user, initial_setup } = response.data

        set({
          user,
          isAuthenticated: true,
          initialSetupComplete: Boolean(initial_setup),
        })
      },

      logout: () => {
        // Best-effort server-side cookie clear; local state clears regardless.
        apiClient.post('/auth/logout').catch(() => {})
        set({
          user: null,
          isAuthenticated: false,
          initialSetupComplete: false,
        })
      },

      checkAuth: async () => {
        // The session cookie is HttpOnly, so the only way to know whether the
        // session is still valid is to ask the server.
        try {
          const response = await apiClient.get<AuthUser>('/auth/me')
          set({ user: response.data, isAuthenticated: true })
          return true
        } catch {
          set({ user: null, isAuthenticated: false, initialSetupComplete: false })
          return false
        }
      },

      handleAuthError: () => {
        // Called when a 401 is received - clear auth state
        set({ user: null, isAuthenticated: false })
      },

      clearInitialSetupFlag: () => set({ initialSetupComplete: false }),
    }),
    {
      name: 'watchtower-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
