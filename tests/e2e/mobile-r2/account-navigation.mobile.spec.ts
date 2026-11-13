import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const theme of ['light', 'dark']) {
  test(`더보기 계정 동선 · ${theme}`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('sohee-theme', value), theme)
    await page.goto('/dev/v094-recovery?screen=settings-source')
    if (theme === 'dark') await expect(page.locator('html')).toHaveClass(/dark/)
    else await expect(page.locator('html')).not.toHaveClass(/dark/)
    const settings = page.getByRole('list', { name: '설정 목록' })
    await expect(settings.getByRole('link', { name: /개인정보 관리/ })).toHaveAttribute('href', '/app/system/privacy')
    await expect(page.getByText('탈퇴', { exact: true })).toHaveCount(0)
    await expect(page.getByText('진행 상태를 확인하지 못했어요')).toHaveCount(0)
    const logout = page.getByRole('button', { name: '로그아웃', exact: true })
    await logout.scrollIntoViewIfNeeded()
    await expect(logout).toBeVisible()
    const box = await logout.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
    expect(box?.width).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const a11y = await new AxeBuilder({ page }).include('[aria-label="설정 목록"]').include('section[aria-label="로그아웃"]').analyze()
    expect(a11y.violations).toEqual([])
  })

  test(`개인정보 관리 구성 · ${theme}`, async ({ page }) => {
    await page.addInitScript(value => localStorage.setItem('sohee-theme', value), theme)
    await page.goto('/dev/mobile-account')
    await expect(page.getByRole('textbox', { name: '표시 이름', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /비밀번호/ })).toHaveAttribute('href', '/forgot-password')
    await expect(page.getByRole('link', { name: '회원 탈퇴 문의하기' })).toHaveAttribute('href', /^mailto:support@sohee\.ai\.kr\?subject=/)
    await expect(page.getByRole('region', { name: '회원 탈퇴 안내' })).toBeVisible()
    await expect(page.locator('[aria-label="소희 업무 메뉴"]')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const a11y = await new AxeBuilder({ page }).include('main').analyze()
    expect(a11y.violations).toEqual([])
  })
}
