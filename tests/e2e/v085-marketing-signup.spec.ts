import { expect, test } from '@playwright/test'

test('무료 진단 결과를 보고 회원가입 화면으로 이어간다', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('link', { name: '내 매장으로 무료 진단하기' }).click()
  await page.getByLabel('매장 이름').fill('별빛 헤어')
  await page.getByLabel('업종').selectOption('beauty')
  await page.getByLabel('가장 해결하고 싶은 문제').selectOption('booking')
  await page.getByLabel('공개 채널').selectOption('instagram')
  await page.getByRole('button', { name: '내 매장 진단 보기' }).click()

  await expect(page.getByText('입력 내용을 바탕으로 준비한 예비 진단')).toBeVisible()
  await expect(page.getByText('주말 예약이 가능한가요?')).toBeVisible()
  await page.getByRole('link', { name: '이 진단으로 소희 시작하기' }).click()

  await expect(page).toHaveURL(/\/signup\?source=diagnosis$/)
  await expect(page.getByRole('form', { name: '고객 회원가입' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('sohee-v085-diagnosis-intent'))).toContain('별빛 헤어')
})

test('회원가입은 비밀번호 확인과 필수 동의를 요구한다', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('이메일').fill('owner@example.com')
  await page.getByLabel('비밀번호', { exact: true }).fill('safe-password')
  await page.getByLabel('비밀번호 확인').fill('different-password')
  await page.getByRole('button', { name: '소희 시작하기' }).click()
  await expect(page.locator('p[role="alert"]')).toHaveText('비밀번호가 서로 같지 않아요.')

  await page.getByLabel('비밀번호 확인').fill('safe-password')
  await expect(page.locator('p[role="alert"]')).toHaveCount(0)
  await page.getByRole('button', { name: '소희 시작하기' }).click()
  await expect(page.locator('p[role="alert"]')).toHaveText('이용약관과 개인정보 처리방침에 동의해 주세요.')
})

for (const viewport of [
  { width: 390, height: 844 },
  { width: 820, height: 1180 },
  { width: 1440, height: 900 },
]) {
  test(`홈은 ${viewport.width} 너비에서 가로 넘침과 깨진 이미지가 없다`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 700) {
        window.scrollTo(0, y)
        await new Promise((resolve) => setTimeout(resolve, 60))
      }
    })
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width)
    const brokenImages = await page.locator('img').evaluateAll((images) => images.filter((image) => !(image as HTMLImageElement).complete || (image as HTMLImageElement).naturalWidth === 0).length)
    expect(brokenImages).toBe(0)
  })
}
