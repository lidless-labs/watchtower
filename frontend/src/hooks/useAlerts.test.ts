import { describe, expect, it, vi } from 'vitest'
import { acknowledgeAlertRequest } from './useAlerts'

describe('acknowledgeAlertRequest', () => {
  it('propagates failures without marking the alert acknowledged', async () => {
    const sendAcknowledgement = vi.fn().mockRejectedValue(new Error('write failed'))
    const acknowledgeInStore = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(
      acknowledgeAlertRequest('alert-17', sendAcknowledgement, acknowledgeInStore)
    ).rejects.toThrow('write failed')

    expect(acknowledgeInStore).not.toHaveBeenCalled()
  })
})
