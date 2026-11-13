import { expect, test } from '@playwright/test'

const viewports = [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
] as const

for (const viewport of viewports) {
  test(`${viewport.width} onboarding question keeps one visible task without overflow`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/e2e-fixture/onboarding?state=question')

    await expect(page.getByRole('heading', { level: 1, name: '소희와 첫 준비 대화' })).toBeVisible()
    await expect(page.getByRole('textbox', { name: '답변' })).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
    const sendBox = await page.getByRole('button', { name: '답변 보내기' }).boundingBox()
    expect(sendBox?.height).toBeGreaterThanOrEqual(44)
    expect(sendBox?.width).toBeGreaterThanOrEqual(44)
  })
}

test('ON-03 shows original and proposal without claiming activation', async ({ page }) => {
  await page.goto('/e2e-fixture/onboarding?state=candidate')
  const candidate = page.locator('[data-screen-id="ON-03"]')
  await expect(candidate).toHaveCount(1)
  await expect(candidate.getByText('청라에서 자연눈썹 시술을 운영해요.')).toBeVisible()
  await expect(candidate.getByText('청라 지역 자연눈썹 시술 서비스')).toBeVisible()
  await expect(page.getByText('나의 소희에 반영됨')).toHaveCount(0)
})

test('ON-05 supports five channel selections and never renders a password field', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/e2e-fixture/onboarding?state=channels')
  const group = page.getByRole('group', { name: '기존 채널 선택' })
  for (const label of ['인스타그램', '스레드', '네이버 블로그', '네이버 플레이스', '당근 비즈프로필']) {
    await expect(group.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false')
  }
  await group.getByRole('button', { name: '인스타그램' }).click()
  await expect(page.getByLabel('인스타그램 주소')).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
})

test('ON-06 through ON-08 distinguish completed profile from pending credit integration', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/e2e-fixture/onboarding?state=completed')
  await expect(page.getByRole('heading', { name: '채널 분석 준비' })).toBeVisible()
  await expect(page.getByText('비용 계산 연결 전')).toBeVisible()
  await expect(page.getByRole('heading', { name: '현재 나의 소희' })).toBeVisible()
  await expect(page.getByRole('link', { name: '첫 콘텐츠 만들기' })).toBeVisible()
  await expect(page.locator('[data-v07-column="context"]')).toBeHidden()
  await expect(page.getByRole('heading', { name: '현재 준비도' })).toBeVisible()
})

test('ON-09 shows preserved progress and both recovery choices', async ({ page }) => {
  await page.goto('/e2e-fixture/onboarding?state=resume')
  await expect(page.getByRole('heading', { name: '이어서 준비할까요?' })).toBeVisible()
  await expect(page.getByRole('button', { name: '계속하기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '기존 정보를 유지하고 처음부터 다시 검토' })).toBeVisible()
})
