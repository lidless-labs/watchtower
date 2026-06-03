import { expect, test } from '@playwright/test'

test('first login sends bootstrap token header', async ({ page }) => {
  let sawBootstrapToken = false

  await page.route('**/api/auth/login', async (route) => {
    const request = route.request()
    sawBootstrapToken = request.headers()['x-watchtower-bootstrap-token'] === 'bootstrap-secret'
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 'e2e-token',
        user: { username: 'admin', role: 'admin' },
        expires_in: 3600,
        initial_setup: true,
      }),
    })
  })
  await page.route('**/api/topology', (route) => route.fulfill({ status: 200, json: { devices: {}, connections: [] } }))
  await page.route('**/api/speedtest', (route) => route.fulfill({ status: 200, json: { status: 'no_data' } }))
  await page.route('**/api/alerts**', (route) => route.fulfill({ status: 200, json: [] }))
  await page.routeWebSocket(/\/ws\/updates/, (ws) => {
    ws.onMessage((message) => {
      if (message === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }))
      }
    })
  })

  await page.goto('/?bootstrap_token=bootstrap-secret')
  await expect.poll(() => new URL(page.url()).searchParams.has('bootstrap_token')).toBe(false)
  await page.getByLabel('Password').fill('NewAdminPw123')
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect.poll(() => sawBootstrapToken).toBe(true)
})
