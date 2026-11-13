import { expect, test } from '@playwright/test'

test.describe('LOCAL_UI_FIXTURE_ONLY — operator workspaces safe boundary', () => {
  test('keeps unauthenticated workspace access behind the operator login boundary', async ({ page }) => {
    await page.goto('/admin/workspaces')
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fworkspaces$/)
    await expect(page.locator('body')).not.toContainText(/token|secret|password|provider|permission denied|MFA_REQUIRED/i)
  })

  test.skip('authenticated RPC projection requires an approved deterministic AAL2 fixture', async () => {})
})
