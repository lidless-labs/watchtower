import { FormEvent, useEffect, useState } from 'react'
import { AxiosError } from 'axios'
import { useAuthStore } from '../store/authStore'

interface LoginPageProps {
  showInitialSetupMessage?: boolean
}

export default function LoginPage({ showInitialSetupMessage = false }: LoginPageProps) {
  const login = useAuthStore((state) => state.login)

  const [username, setUsername] = useState('admin')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSetupToast, setShowSetupToast] = useState(showInitialSetupMessage)

  useEffect(() => {
    setShowSetupToast(showInitialSetupMessage)
  }, [showInitialSetupMessage])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await login(username, password)
    } catch (err) {
      const apiError = err as AxiosError<{ detail?: string }>
      setError(apiError.response?.data?.detail || 'Login failed. Check your credentials.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-bg-primary flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-bg-secondary border border-border-default rounded-xl p-6 md:p-8 shadow-2xl">
        <div className="text-center mb-6">
          <div className="text-accent-cyan text-3xl font-bold tracking-tight">
            <span className="text-text-primary">WATCH</span>TOWER
          </div>
          <p className="mt-2 text-sm text-text-muted">Sign in to access your NOC dashboard</p>
        </div>

        {showSetupToast && (
          <div className="mb-4 rounded-lg border border-accent-cyan/40 bg-accent-cyan/10 px-3 py-2 text-sm text-accent-cyan">
            Admin account configured.
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-lg border border-status-red/40 bg-status-red/10 px-3 py-2 text-sm text-status-red">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="username" className="block text-sm text-text-secondary mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-cyan/40"
              autoComplete="username"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-text-secondary mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-cyan/40"
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent-cyan text-bg-primary font-semibold py-2 rounded-lg hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
