import { expect, test } from '@playwright/test'

test.describe('LOCAL_UI_FIXTURE_ONLY — not production MFA/RLS proof', () => {
  test('redirects an unauthenticated admin route to login with its admin next path', async ({ page }) => {
    await page.goto('/admin')

    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/)
    await expect(page.locator('body')).not.toContainText(/token|secret|permission denied|MFA_REQUIRED/i)
  })

  test('preserves a safe admin subpath and query in the login next path', async ({ page }) => {
    await page.goto('/admin/system?tab=health')

    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fsystem%3Ftab%3Dhealth$/)
    await expect(page.locator('body')).not.toContainText(/token|secret|permission denied|MFA_REQUIRED/i)
  })

  test.skip('authenticated customer denial requires an approved deterministic server fixture', async () => {})
  test.skip('authenticated AAL1 denial requires an approved deterministic server fixture', async () => {})
  test.skip('authenticated AAL2 scoped allowance requires an approved deterministic server fixture', async () => {})
})
