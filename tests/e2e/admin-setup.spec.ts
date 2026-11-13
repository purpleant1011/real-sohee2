import { expect, test } from '@playwright/test'

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 1024, height: 900 },
  { name: 'compact-tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
] as const

const states = [
  { state: 'password', heading: '관리자 비밀번호를 설정하세요' },
  { state: 'enroll', heading: 'MFA를 등록하세요' },
  { state: 'challenge', heading: 'MFA 인증 코드를 입력하세요' },
  { state: 'activate', heading: '관리자 활성화를 완료하세요' },
  { state: 'active-recovery', heading: 'MFA 인증 코드를 입력하세요' },
  { state: 'complete', heading: '관리자 설정이 완료되었습니다' },
] as const

test.describe('LOCAL_UI_FIXTURE_ONLY — admin setup states are not production Auth proof', () => {
  for (const viewport of viewports) {
    for (const scenario of states) {
      test(`${viewport.name} renders ${scenario.state} safely`, async ({ page }) => {
        const pageErrors: string[] = []
        const externalRequests: string[] = []
        page.on('pageerror', (error) => pageErrors.push(error.message))
        page.on('request', (request) => {
          const url = new URL(request.url())
          if (!['127.0.0.1', 'localhost'].includes(url.hostname)) externalRequests.push(url.hostname)
        })
        await page.setViewportSize({ width: viewport.width, height: viewport.height })
        await page.goto(`/e2e-fixture/admin-setup?state=${scenario.state}`)

        await expect(page.locator('[data-e2e-fixture="admin-setup"]')).toBeVisible()
        await expect(page.getByRole('heading', { name: scenario.heading })).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
        for (const control of await page.locator('button:visible, input:visible, a:visible').all()) {
          const box = await control.boundingBox()
          expect(box).not.toBeNull()
          expect(box!.height).toBeGreaterThanOrEqual(44)
        }
        await expect(page.locator('body')).not.toContainText(/fixture-only|fixture-challenge|otpauth|recovery code|session token/i)
        expect(pageErrors).toEqual([])
        expect(externalRequests).toEqual([])
      })
    }
  }

  test('uses the new factor flow without an external provider request', async ({ page }) => {
    await page.goto('/e2e-fixture/admin-setup?state=enroll')
    await page.getByRole('button', { name: 'TOTP 등록 시작' }).click()
    await expect(page.getByRole('img', { name: '인증 앱으로 스캔할 TOTP QR 코드' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '인증 코드' })).toBeVisible()
    await expect(page.getByRole('button', { name: '인증 코드 받기' })).toHaveCount(0)
    await page.getByRole('textbox', { name: '인증 코드' }).fill('246810')
    await page.getByRole('button', { name: 'MFA 확인' }).click()
    await expect(page.getByRole('heading', { name: '관리자 활성화를 완료하세요' })).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/fixture-factor|fixture-challenge|246810/i)
  })

  test('executes password, existing-factor, activation and recovery transitions', async ({ page }) => {
    await page.goto('/e2e-fixture/admin-setup?state=password')
    await page.getByLabel('새 비밀번호', { exact: true }).fill('local-pass-2026')
    await page.getByLabel('새 비밀번호 확인').fill('local-pass-2026')
    await page.getByRole('button', { name: '비밀번호 설정' }).click()
    await expect(page.getByRole('heading', { name: 'MFA를 등록하세요' })).toBeVisible()

    await page.goto('/e2e-fixture/admin-setup?state=challenge')
    await page.getByRole('button', { name: '인증 코드 받기' }).click()
    await page.getByRole('textbox', { name: '인증 코드' }).fill('246810')
    await page.getByRole('button', { name: 'MFA 확인' }).click()
    await expect(page.getByRole('heading', { name: '관리자 활성화를 완료하세요' })).toBeVisible()

    await page.getByRole('button', { name: '관리자 활성화' }).click()
    await expect(page.locator('[data-navigation-target="/admin"]')).toBeVisible()

    await page.goto('/e2e-fixture/admin-setup?state=active-recovery')
    await page.getByRole('button', { name: '인증 코드 받기' }).click()
    await page.getByRole('textbox', { name: '인증 코드' }).fill('246810')
    await page.getByRole('button', { name: 'MFA 확인' }).click()
    await expect(page.locator('[data-navigation-target="/admin"]')).toBeVisible()
    await expect(page.locator('body')).not.toContainText(/local-pass-2026|246810|fixture-factor|fixture-challenge/i)
  })

  test('keeps invalid password and verification attempts on a safe local state', async ({ page }) => {
    await page.goto('/e2e-fixture/admin-setup?state=password')
    await page.getByLabel('새 비밀번호', { exact: true }).fill('local-pass-2026')
    await page.getByLabel('새 비밀번호 확인').fill('different-pass')
    await page.getByRole('button', { name: '비밀번호 설정' }).click()
    await expect(page.locator('p[role="alert"]')).toHaveText('비밀번호를 다시 확인해 주세요.')

    await page.goto('/e2e-fixture/admin-setup?state=challenge')
    await page.getByRole('button', { name: '인증 코드 받기' }).click()
    await page.getByRole('textbox', { name: '인증 코드' }).fill('000000')
    await page.getByRole('button', { name: 'MFA 확인' }).click()
    await expect(page.locator('p[role="alert"]')).toHaveText('MFA 설정을 완료하지 못했습니다. 다시 시도해 주세요.')
    await expect(page.locator('body')).not.toContainText(/fixture factor mismatch|fixture verification mismatch/i)
  })

  test('rejects the fixture route for a non-loopback request host', async ({ request }) => {
    const response = await request.get('/e2e-fixture/admin-setup', { headers: { host: 'example.com' } })
    expect(response.status()).toBe(404)
  })
})
