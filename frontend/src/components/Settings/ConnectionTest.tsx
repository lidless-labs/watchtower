import { useState } from 'react'
import { useSettingsApiStore, type ConnectionTestResult } from '../../store/settingsApiStore'

interface ConnectionTestProps {
  type: string
  getParams: () => Record<string, unknown>
  disabled?: boolean
}

export default function ConnectionTest({ type, getParams, disabled }: ConnectionTestProps) {
  const testConnection = useSettingsApiStore((s) => s.testConnection)
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<ConnectionTestResult | null>(null)

  const handleTest = async () => {
    setTesting(true)
    setResult(null)
    const params = getParams()
    const res = await testConnection({ type, ...params })
    setResult(res)
    setTesting(false)
    // Clear result after 5 seconds
    setTimeout(() => setResult(null), 5000)
  }

  return (
    <div className="flex items-center gap-3">
      <button
        onClick={handleTest}
        disabled={testing || disabled}
        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-accent-cyan/40 text-accent-cyan rounded-lg hover:bg-accent-cyan/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {testing ? (
          <>
            <div className="w-3 h-3 border-2 border-accent-cyan/30 border-t-accent-cyan rounded-full animate-spin" />
            Testing...
          </>
        ) : (
          <>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            Test Connection
          </>
        )}
      </button>

      {result && (
        <span className={`text-xs font-medium flex items-center gap-1 ${
          result.status === 'ok' ? 'text-status-green' : 'text-status-red'
        }`}>
          {result.status === 'ok' ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
          {result.message}
        </span>
      )}
    </div>
  )
}
