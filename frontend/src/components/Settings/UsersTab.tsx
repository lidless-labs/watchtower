import { useState } from 'react'
import { useAuthStore } from '../../store/authStore'
import { useNocStore } from '../../store/nocStore'

export default function UsersTab() {
  const user = useAuthStore((s) => s.user)
  const token = useAuthStore((s) => s.token)
  const demoMode = useNocStore((s) => s.demoMode)

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changing, setChanging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const passwordMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword
  const tooShort = newPassword.length > 0 && newPassword.length < 8
  const canSubmit = oldPassword && newPassword.length >= 8 && newPassword === confirmPassword && !changing

  const handleChangePassword = async () => {
    if (!canSubmit) return
    setChanging(true)
    setError(null)
    setSuccess(false)

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword }),
      })

      if (res.ok) {
        setSuccess(true)
        setOldPassword('')
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => setSuccess(false), 5000)
      } else {
        const data = await res.json().catch(() => ({ detail: 'Failed to change password' }))
        setError(data.detail || 'Failed to change password')
      }
    } catch {
      setError('Network error')
    } finally {
      setChanging(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-text-primary">User Management</h2>
        <p className="text-sm text-text-muted mt-1">Manage your account and authentication settings.</p>
      </div>

      {/* Current User */}
      <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
        <h3 className="text-sm font-semibold text-text-primary mb-3">Current User</h3>
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-accent-cyan/20 text-accent-cyan flex items-center justify-center text-lg font-semibold">
            {(user?.username || 'A').slice(0, 1).toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium text-text-primary">{user?.username || 'admin'}</div>
            <div className="text-xs uppercase tracking-wide text-accent-cyan">{user?.role || 'admin'}</div>
          </div>
        </div>
      </div>

      {/* Change Password */}
      {!demoMode && (
        <div className="bg-bg-secondary rounded-lg border border-border-default p-5">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Change Password</h3>
          <div className="space-y-3 max-w-sm">
            <div>
              <label className="block text-sm text-text-secondary mb-1">Current Password</label>
              <input
                type="password"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
                className="w-full bg-bg-primary border border-border-default rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan/40"
              />
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full bg-bg-primary border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 ${
                  tooShort ? 'border-status-red' : 'border-border-default'
                }`}
              />
              {tooShort && (
                <p className="text-xs text-status-red mt-1">Must be at least 8 characters</p>
              )}
            </div>
            <div>
              <label className="block text-sm text-text-secondary mb-1">Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full bg-bg-primary border rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent-cyan/40 ${
                  passwordMismatch ? 'border-status-red' : 'border-border-default'
                }`}
              />
              {passwordMismatch && (
                <p className="text-xs text-status-red mt-1">Passwords don't match</p>
              )}
            </div>

            {error && (
              <div className="text-sm text-status-red bg-status-red/10 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            {success && (
              <div className="text-sm text-status-green bg-status-green/10 rounded-lg px-3 py-2">
                Password changed successfully.
              </div>
            )}

            <button
              onClick={handleChangePassword}
              disabled={!canSubmit}
              className="px-4 py-2 text-sm font-medium bg-accent-cyan text-bg-primary rounded-lg hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              {changing ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      )}

      {/* Future: Multi-user */}
      <div className="bg-bg-secondary rounded-lg border border-border-default border-dashed p-5 opacity-60">
        <h3 className="text-sm font-semibold text-text-primary mb-1">Team Management</h3>
        <p className="text-xs text-text-muted">
          Multi-user support with role-based access (admin, operator, viewer) is planned for a future release.
          Currently, Watchtower supports a single admin account.
        </p>
      </div>
    </div>
  )
}
