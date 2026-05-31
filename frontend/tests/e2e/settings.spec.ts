import { expect, test } from '@playwright/test'

function base64Url(input: string): string {
  return Buffer.from(input).toString('base64url')
}

function unsignedJwt(payload: Record<string, unknown>): string {
  return [
    base64Url(JSON.stringify({ alg: 'none', typ: 'JWT' })),
    base64Url(JSON.stringify(payload)),
    'signature',
  ].join('.')
}

test('admin can save polling settings', async ({ page }) => {
  let savedPolling: unknown = null
  const token = unsignedJwt({ exp: Math.floor(Date.now() / 1000) + 3600 })

  await page.addInitScript((value) => {
    localStorage.setItem('watchtower_token', value)
  }, token)

  await page.route('**/api/auth/me', (route) => route.fulfill({
    status: 200,
    json: { username: 'admin', role: 'admin' },
  }))
  await page.route('**/api/settings', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        json: {
          polling: {
            device_status: 30,
            device_stats: 60,
            topology: 300,
            interfaces: 60,
            proxmox: 60,
          },
        },
      })
    }
    return route.continue()
  })
  await page.route('**/api/settings/status', (route) => route.fulfill({ status: 200, json: {} }))
  await page.route('**/api/settings/polling', async (route) => {
    savedPolling = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      json: {
        polling: savedPolling,
      },
    })
  })

  await page.goto('/#/settings')
  await page.getByRole('button', { name: /Polling/ }).click()
  await expect(page.getByRole('heading', { name: 'Polling Intervals' })).toBeVisible()

  await page.locator('input[type="range"]').first().focus()
  await page.keyboard.press('ArrowRight')
  const saveButton = page.getByRole('button', { name: 'Save Changes' })
  await expect(saveButton).toBeEnabled()
  await saveButton.click()

  await expect.poll(() => savedPolling).toMatchObject({ device_status: 35 })
  await expect(page.getByText('Saved')).toBeVisible()
})
