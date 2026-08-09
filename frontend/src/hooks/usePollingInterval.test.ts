import { describe, expect, it } from 'vitest'

import { getPollingDelayMs, POLL_BACKOFF_CAP_MS, POLL_BACKOFF_FACTOR } from './usePollingInterval'

describe('getPollingDelayMs', () => {
  it('returns the base interval when there are no failures', () => {
    expect(getPollingDelayMs(30_000, 0)).toBe(30_000)
    expect(getPollingDelayMs(60_000, -1)).toBe(60_000)
  })

  it('multiplies by 1.5x per consecutive failure', () => {
    expect(getPollingDelayMs(60_000, 1)).toBe(60_000 * POLL_BACKOFF_FACTOR)
    expect(getPollingDelayMs(60_000, 2)).toBe(60_000 * POLL_BACKOFF_FACTOR ** 2)
    expect(getPollingDelayMs(30_000, 3)).toBe(30_000 * POLL_BACKOFF_FACTOR ** 3)
  })

  it('caps the delay at 5 minutes', () => {
    expect(getPollingDelayMs(60_000, 20)).toBe(POLL_BACKOFF_CAP_MS)
    expect(getPollingDelayMs(30_000, 50)).toBe(POLL_BACKOFF_CAP_MS)
  })
})
