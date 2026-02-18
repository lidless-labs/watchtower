import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API_URL || ''

interface DeliveryRecord {
  id: string; channel: string; alert_id: string; alert_type: string;
  severity: string; device: string; status: string; timestamp: number;
  error: string | null; response_code: number | null;
}

interface Stats {
  sent: number; failed: number; cooldown: number; demo: number; total: number; history_size: number;
}

const statusColors: Record<string, string> = {
  success: 'text-green-400 bg-green-400/10',
  failed: 'text-red-400 bg-red-400/10',
  cooldown: 'text-yellow-400 bg-yellow-400/10',
  demo: 'text-blue-400 bg-blue-400/10',
}

const channelIcons: Record<string, string> = {
  discord: '💬', pushover: '📱', email: '📧',
}

export default function NotificationHistory() {
  const [history, setHistory] = useState<DeliveryRecord[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const [hRes, sRes] = await Promise.all([
        fetch(`${API}/api/notifications/history`),
        fetch(`${API}/api/notifications/stats`),
      ])
      setHistory((await hRes.json()).history || [])
      setStats(await sRes.json())
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  return (
    <div className="space-y-4">
      {stats && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Sent', value: stats.sent, color: 'text-green-400' },
            { label: 'Failed', value: stats.failed, color: 'text-red-400' },
            { label: 'Cooldown', value: stats.cooldown, color: 'text-yellow-400' },
            { label: 'Demo', value: stats.demo, color: 'text-blue-400' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-bg-secondary rounded-lg border border-border-default p-3 text-center">
              <div className={`text-xl font-bold ${color}`}>{value}</div>
              <div className="text-xs text-text-tertiary">{label}</div>
            </div>
          ))}
        </div>
      )}

      {loading ? (
        <div className="text-center text-text-tertiary py-6 text-sm">Loading history...</div>
      ) : history.length === 0 ? (
        <div className="text-center text-text-tertiary py-6 text-sm">No notifications sent yet.</div>
      ) : (
        <div className="bg-bg-secondary rounded-lg border border-border-default overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-default text-text-tertiary text-xs">
                <th className="text-left p-3">Channel</th>
                <th className="text-left p-3">Device</th>
                <th className="text-left p-3">Type</th>
                <th className="text-left p-3">Status</th>
                <th className="text-left p-3">Time</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 30).map(r => (
                <tr key={r.id} className="border-b border-border-default/50">
                  <td className="p-3">{channelIcons[r.channel] || '📢'} {r.channel}</td>
                  <td className="p-3 text-text-primary font-mono text-xs">{r.device}</td>
                  <td className="p-3 text-text-secondary text-xs">{r.alert_type}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${statusColors[r.status] || 'text-text-tertiary'}`}>
                      {r.status}
                    </span>
                    {r.error && <span className="block text-[10px] text-red-400 mt-0.5">{r.error}</span>}
                  </td>
                  <td className="p-3 text-text-tertiary text-xs">{new Date(r.timestamp * 1000).toLocaleTimeString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
