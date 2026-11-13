import { mkdir } from 'node:fs/promises'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const fixturePath = '/e2e-fixture/app-shell'
const screenshotRoot = 'docs/verification/v0.7.1/screenshots'
const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
] as const

function collectRuntimeProblems(page: Page) {
  const problems: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text())
  })
  page.on('pageerror', (error) => problems.push(error.message))
  return problems
}

async function expectNoHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
}

async function expectTouchSafeActions(page: Page) {
  for (const control of await page.locator('a:visible, button:visible').all()) {
    const box = await control.boundingBox()
    expect(box?.height).toBeGreaterThanOrEqual(44)
  }
}

test.describe('V0.7.1 checkpoint D release surfaces', () => {
  test.beforeAll(async () => {
    await mkdir(screenshotRoot, { recursive: true })
  })

  for (const viewport of viewports) {
    test(`${viewport.name} keeps the conversation release entry readable and operable`, async ({ page }) => {
      const runtimeProblems = collectRuntimeProblems(page)
      await page.setViewportSize(viewport)
      await page.goto(`${fixturePath}?screen=M-01`)

      await expect(page.getByRole('region', { name: '소희와의 대화' })).toBeVisible()
      await expect(page.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await expectTouchSafeActions(page)

      const composer = page.getByRole('textbox', { name: '소희에게 메시지 보내기' })
      await composer.fill('이번 주 반응을 자세히 보여줘')
      await composer.press('Enter')
      await expect(page.getByText('입력 내용은 저장하거나 전송하지 않았어요.', { exact: false })).toBeVisible()

      await page.screenshot({ fullPage: true, path: `${screenshotRoot}/${viewport.name}-conversation.png` })
      expect(runtimeProblems).toEqual([])
    })

    test(`${viewport.name} keeps settings, failure recovery, and approval preparation isolated`, async ({ page }) => {
      const runtimeProblems = collectRuntimeProblems(page)
      await page.setViewportSize(viewport)

      await page.goto(`${fixturePath}?view=settings`)
      await expect(page.getByRole('heading', { name: '사업 정보' })).toBeVisible()
      const businessName = page.getByLabel('사업명')
      await businessName.fill('저장하지 않은 이름')
      await page.getByRole('button', { name: '변경 취소' }).click()
      await expect(businessName).toHaveValue('소희 카페')
      await expectNoHorizontalOverflow(page)
      await expectTouchSafeActions(page)

      await page.goto(`${fixturePath}?view=notification-error`)
      await expect(page.getByText('알림을 불러오지 못했어요. 다른 작업은 계속할 수 있습니다.')).toBeVisible()
      await expect(page.getByRole('button', { name: '다시 시도' })).toBeEnabled()
      await expect(page.locator('body')).not.toContainText(/request[_ -]?id|uuid|SUPABASE|OPENAI|home-unavailable/i)

      await page.goto(`${fixturePath}?view=approval`)
      await expect(page.getByRole('heading', { name: '최종 승인' })).toBeVisible()
      for (const label of [
        '본문·해시태그·고지를 최종 확인했습니다.',
        '실제 이미지와 순서를 최종 확인했습니다.',
        '대체 텍스트를 최종 확인했습니다.',
        '사용권과 생성 근거를 최종 확인했습니다.',
        '확인이 필요한 항목을 검토했습니다.',
      ]) {
        await page.getByLabel(label).check()
      }
      await page.getByPlaceholder('승인 또는 수정 요청 사유').fill('최종 검토 준비')
      await expect(page.getByRole('button', { name: 'v1 최종 승인' })).toBeDisabled()
      await expect(page.getByText('미디어를 하나 이상 추가하고 모두 유효한지 확인해 주세요.')).toBeVisible()
      await expectNoHorizontalOverflow(page)
      expect(runtimeProblems).toEqual([])
    })
  }

  test('keyboard focus, 200 percent text size, reduced motion, and accessibility stay safe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${fixturePath}?screen=M-01`)

    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: '본문으로 바로가기' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByRole('main')).toBeFocused()

    const transitionDuration = await page.getByRole('link', { name: '고객 대화 7건' }).evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    )
    expect(transitionDuration).toMatch(/^(0s|0\.00001s|1e-05s)$/)

    await page.evaluate(() => { document.documentElement.style.fontSize = '200%' })
    await expect(page.getByRole('textbox', { name: '소희에게 메시지 보내기' })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    await page.evaluate(() => { document.documentElement.style.fontSize = '' })
    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(accessibility.violations).toEqual([])
  })
})
