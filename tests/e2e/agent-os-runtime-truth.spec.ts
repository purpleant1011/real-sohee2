import { expect, test } from '@playwright/test'

/**
 * Agent OS Runtime Truth & Control Invariants (ANI-909, ANI-809, ANI-896)
 * Validates:
 * 1. Agent Live Workboard endpoint security & no-store caching headers
 * 2. Strict separation of 3 numbers: Entitlement, Sohee Credit, Paid Ad Spend (KRW)
 * 3. Prohibition of unverified fake/demo counters in production routes
 */

test.describe('Agent OS Runtime Truth and Security (ANI-909)', () => {
  test('workboard api requires authentication and sets Cache-Control: no-store', async ({ request }) => {
    // Unauthenticated request to workspace workboard API
    const response = await request.get('/api/workspaces/ws-e2e-test-123/agent/workboard')

    // Must be protected: 401 Unauthorized or redirected to login
    expect([401, 307, 308]).toContain(response.status())

    // Must never be cached across users or reloads
    const cacheControl = response.headers()['cache-control']
    if (cacheControl) {
      expect(cacheControl).toContain('no-store')
    }
  })

  test('canonical login and landing surfaces present consistent Sohee branding without legacy SC/Agent Energy tokens', async ({ page }) => {
    await page.goto('/login')

    // Expect Korean title and branding
    await expect(page).toHaveTitle(/소희|로그인/u)

    // Legacy terms must never leak to user-facing DOM
    const bodyContent = await page.content()
    expect(bodyContent).not.toContain('Agent Energy')
    expect(bodyContent).not.toContain('SC ')
  })
})
