import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// This config uses the repository's localhost Playwright webServer. Never run against production.
// Provide an isolated, resettable QA workspace and its authenticated storage state explicitly.
const qaStorageState = process.env.SOHEE_E2E_QA_STORAGE_STATE
const sandboxEnabled = process.env.SOHEE_E2E_QA_SANDBOX === '1'
const livePublishEnabled = process.env.SOHEE_E2E_LIVE_PUBLISH === '1'

test.describe('Google QA signup → first-post journey', () => {
  test.use({ storageState: qaStorageState ?? { cookies: [], origins: [] } })
  test.beforeEach(() => {
    test.skip(!qaStorageState || !sandboxEnabled, '격리된 QA 계정과 SOHEE_E2E_QA_SANDBOX=1이 필요합니다.')
    const baseURL = test.info().project.use.baseURL
    test.skip(!baseURL || !/^http:\/\/(localhost|127\.0\.0\.1):\d+\/?$/u.test(baseURL), '로컬 격리 QA 앱에서만 실행합니다.')
  })

  test('three-step wizard, channel branch, draft preview and confirmation (no external publish)', async ({ page }) => {
    await page.goto('/start')
    await expect(page.getByRole('heading', { name: /10분 안에 첫 게시물까지/ })).toBeVisible()
    // A workspace already quick-started is not a valid fresh-signup cohort.
    test.skip(await page.getByText('게시물을 올릴 계정을 연결해 주세요').isVisible(), '위저드 검증에는 미설정 QA 워크스페이스가 필요합니다.')

    await page.getByRole('textbox', { name: '가게 이름' }).fill('QA 첫 게시 매장')
    await page.getByRole('button', { name: '카페·디저트' }).click()
    await page.getByRole('textbox', { name: '우리 가게를 한두 문장으로 소개해 주세요' }).fill('독립 QA 매장의 수제 디저트')
    await page.getByRole('button', { name: '다음: 소희 말투 고르기' }).click()
    await expect(page.getByRole('heading', { name: '소희가 어떤 말투로 쓸까요?' })).toBeVisible()
    await page.getByRole('radiogroup', { name: '말투 선택' }).getByRole('radio').first().click()
    await page.getByRole('button', { name: '저장하고 채널 연결하기' }).click()
    await expect(page.getByRole('heading', { name: '게시물을 올릴 계정을 연결해 주세요' })).toBeVisible()

    const create = page.getByRole('button', { name: '소희가 첫 게시물 만들기' })
    if (await page.getByRole('button', { name: '채널을 하나 연결해 주세요' }).isVisible()) {
      await expect(page.getByRole('button', { name: '채널을 하나 연결해 주세요' })).toBeDisabled()
      await expect(page.getByRole('link', { name: '연결하기' }).first()).toHaveAttribute('href', /\/api\/channels\/(instagram|threads)\/connect/)
      // Never automate third-party OAuth or connect a real Meta account.
      return
    }
    await expect(create).toBeEnabled()
    const instagramConnected = await page.getByText('사진과 함께 올리는 피드 게시물')
      .locator('..').getByText('연결됨').isVisible().catch(() => false)
    test.skip(!instagramConnected, '인스타그램이 연결된 격리 QA 워크스페이스가 필요합니다.')
    await create.click()
    await expect(page).toHaveURL(/\/app\/content\?compose=first/)
    const preview = page.locator('article[aria-label="인스타그램 게시물 미리보기"]')
    await expect(preview).toBeVisible({ timeout: 120_000 })
    await page.getByRole('button', { name: '발행하기' }).click()
    const confirmation = page.getByRole('dialog', { name: '이 모습 그대로 발행할까요?' })
    await expect(confirmation.getByRole('button', { name: '네, 발행합니다' })).toBeVisible()
    // Never click the confirmation button in this test, even when live publish is opted in.
    await confirmation.getByRole('button', { name: '아직 더 볼게요' }).click()
    await expect(confirmation).not.toBeVisible()
  })

  test('external publish is always disabled in this spec', async () => {
    test.skip(!livePublishEnabled, '외부 발행은 SOHEE_E2E_LIVE_PUBLISH=1에서만 별도 실행합니다.')
    test.skip(true, 'Meta 샌드박스 발행은 승인된 전용 스펙에서만 실행합니다. 이 스펙은 절대 게시하지 않습니다.')
  })

  for (const path of ['/start', '/app/content'] as const) {
    test(`${path} has no automatic axe accessibility violations`, async ({ page }) => {
      await page.goto(path)
      await expect(page).not.toHaveURL(/\/login/)
      await expect(page.getByRole('main')).toBeVisible()
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
    })
  }
})
