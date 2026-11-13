import { expect, test } from '@playwright/test'

/**
 * ANI-1761 AC-7: 텍스트 200% 확대.
 *
 * 브라우저 글자 크기를 두 배로 키우면 rem 여백도 함께 커진다. 320px 폰에서는
 * 안내 문구가 flex 자식의 min-content 때문에 카드를 밀어내 가로 스크롤이 생겼다.
 * 확대 상태에서도 가로 스크롤이 없고 조작 요소가 눌리는지 고정한다.
 */
const WIDTHS = [320, 360, 390, 430] as const

/** 브라우저 텍스트 확대 200% 를 흉내 낸다(루트 16px → 32px). */
async function zoomText(page: import('@playwright/test').Page) {
  await page.addStyleTag({ content: 'html { font-size: 32px !important; }' })
  await page.waitForTimeout(150)
}

test.describe('가입 화면 · 텍스트 200%', () => {
  for (const width of WIDTHS) {
    test(`${width}px에서 확대해도 가로 스크롤이 생기지 않는다`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 })
      await page.goto('/signup')
      await zoomText(page)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      )
      expect(overflow, `${width}px · 텍스트 200% 가로 overflow`).toBeLessThanOrEqual(0)
    })
  }

  test('320px 확대에서도 안내 문구가 읽을 만한 폭을 유지한다', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto('/signup')
    await zoomText(page)

    const notice = page.getByText(/신용카드 등록 없이 시작하세요/u).first()
    await expect(notice).toBeVisible()

    const box = await notice.boundingBox()
    // 여백이 배로 커지면 78px 까지 눌렸다. px 상한을 둔 뒤 140px 이상을 유지한다.
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(140)
  })

  test('확대 상태에서도 제출 버튼이 44px 이상이다', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 812 })
    await page.goto('/signup')
    await zoomText(page)

    const submit = page.getByRole('button', { name: /Google 계정으로 시작하기/u })
    await expect(submit).toBeVisible()
    const box = await submit.boundingBox()
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  })
})
