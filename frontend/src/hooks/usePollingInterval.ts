import { useEffect, useRef, type DependencyList } from 'react'

/** Multiplier applied to the base interval for each consecutive failure. */
export const POLL_BACKOFF_FACTOR = 1.5

/** Upper bound on the polling delay while failures persist (5 minutes). */
export const POLL_BACKOFF_CAP_MS = 5 * 60 * 1000

/**
 * Delay before the next poll given a base interval and consecutive failure count.
 * Success (failures === 0) returns the base interval. Each failure multiplies by
 * 1.5x, capped at {@link POLL_BACKOFF_CAP_MS}.
 */
export function getPollingDelayMs(intervalMs: number, consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) {
    return intervalMs
  }
  return Math.min(intervalMs * POLL_BACKOFF_FACTOR ** consecutiveFailures, POLL_BACKOFF_CAP_MS)
}

/**
 * Poll `load` on an interval with document-visibility pause and failure backoff.
 *
 * - Pauses while `document.hidden` is true; fires once on return to visible.
 * - On consecutive rejections, backs off by 1.5x per failure (cap 5 min).
 * - Resets backoff after the first successful load.
 * - Cleans up the timer and `visibilitychange` listener on unmount.
 *
 * `load` should reject (throw) on failure so backoff can engage. Resolving
 * (including "empty data" outcomes the caller treats as success) resets backoff.
 */
export function usePollingInterval(
  load: () => void | Promise<void>,
  intervalMs: number,
  deps: DependencyList = [],
): void {
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null
    let consecutiveFailures = 0
    let inFlight = false

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (delayMs: number) => {
      clearTimer()
      if (cancelled || document.hidden) {
        return
      }
      timer = window.setTimeout(() => {
        void tick()
      }, delayMs)
    }

    const tick = async () => {
      if (cancelled || document.hidden || inFlight) {
        return
      }

      inFlight = true
      try {
        await loadRef.current()
        if (cancelled) {
          return
        }
        consecutiveFailures = 0
        schedule(getPollingDelayMs(intervalMs, consecutiveFailures))
      } catch {
        if (cancelled) {
          return
        }
        consecutiveFailures += 1
        schedule(getPollingDelayMs(intervalMs, consecutiveFailures))
      } finally {
        inFlight = false
      }
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        clearTimer()
        return
      }
      if (!cancelled) {
        void tick()
      }
    }

    document.addEventListener('visibilitychange', onVisibilityChange)

    if (!document.hidden) {
      void tick()
    }

    return () => {
      cancelled = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
    // Callers pass an explicit deps list (same contract as useEffect) so the
    // poller restarts when those inputs change (e.g. Proxmox node name).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps])
}
