/**
 * Generic React error boundary.
 *
 * Wraps a subtree so an unhandled throw during render (e.g. a malformed
 * topology shape blowing up `TopologyTiers`) renders a friendly card with
 * a reload button instead of blanking the entire page.
 *
 * Boundaries only catch errors thrown during render, lifecycle methods,
 * and constructors of children. They do NOT catch errors in async code
 * (promise rejections from fetch / websocket handlers); those are still
 * the caller's responsibility.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryProps {
  /** Optional label shown in the fallback heading (e.g. "Dashboard", "Settings"). */
  label?: string
  /** Optional custom fallback renderer. If omitted, the default card is used. */
  fallback?: (error: Error, reset: () => void) => ReactNode
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface the failure in the browser console so devs can find the
    // component stack. In production this is the only diagnostic.
    console.error('ErrorBoundary caught:', error, info.componentStack)
  }

  private reset = (): void => {
    this.setState({ error: null })
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) {
      return this.props.children
    }

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset)
    }

    const label = this.props.label ? `${this.props.label}: ` : ''
    return (
      <div
        role="alert"
        className="min-h-screen flex items-center justify-center bg-bg-primary text-text-primary p-6"
      >
        <div className="max-w-md w-full rounded-lg border border-status-red/40 bg-bg-secondary p-6 shadow-lg">
          <h2 className="text-lg font-semibold text-status-red mb-2">
            {label}Something went wrong
          </h2>
          <p className="text-sm text-text-secondary mb-4">
            The interface hit an unexpected error and could not render this view.
            Reloading usually clears it. If the problem persists, check the
            browser console for details.
          </p>
          <pre className="text-xs text-text-muted bg-bg-primary rounded p-2 mb-4 overflow-auto max-h-32">
            {error.message || String(error)}
          </pre>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 rounded bg-accent-cyan text-bg-primary text-sm font-medium hover:bg-accent-cyan/90"
            >
              Reload
            </button>
            <button
              type="button"
              onClick={this.reset}
              className="px-3 py-1.5 rounded border border-text-muted/40 text-sm text-text-secondary hover:bg-bg-primary"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    )
  }
}

export default ErrorBoundary
