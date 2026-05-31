import { describe, expect, it } from 'vitest'

import { getReconnectDelayMs, isAuthFailureClose } from './useWebSocket'

describe('websocket reconnect helpers', () => {
  it('uses capped exponential backoff with bounded jitter', () => {
    expect(getReconnectDelayMs(0, () => 0)).toBe(1000)
    expect(getReconnectDelayMs(1, () => 0.5)).toBe(2250)
    expect(getReconnectDelayMs(10, () => 0.999)).toBe(30499)
  })

  it('identifies auth failure close frames', () => {
    expect(isAuthFailureClose(4001)).toBe(true)
    expect(isAuthFailureClose(1006)).toBe(false)
  })
})
