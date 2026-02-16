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
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  initialSetupComplete: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => void
  checkAuth: () => boolean
  clearInitialSetupFlag: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,
      initialSetupComplete: false,

      login: async (username, password) => {
        const response = await apiClient.post<LoginResponse>('/auth/login', {
          username,
          password,
        })

        const { token, user, initial_setup } = response.data
        localStorage.setItem('watchtower_token', token)

        set({
          token,
          user,
          isAuthenticated: true,
          initialSetupComplete: Boolean(initial_setup),
        })
      },

      logout: () => {
        localStorage.removeItem('watchtower_token')
        set({
          token: null,
          user: null,
          isAuthenticated: false,
          initialSetupComplete: false,
        })
      },

      checkAuth: () => {
        const token = get().token ?? localStorage.getItem('watchtower_token')
        const isAuthenticated = Boolean(token)

        if (!isAuthenticated) {
          set({ token: null, user: null, isAuthenticated: false })
          return false
        }

        if (!get().token) {
          set({ token, isAuthenticated: true })
        }

        return true
      },

      clearInitialSetupFlag: () => set({ initialSetupComplete: false }),
    }),
    {
      name: 'watchtower-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)
