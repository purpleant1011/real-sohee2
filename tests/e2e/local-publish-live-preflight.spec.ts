import { expect, test, chromium } from '@playwright/test'
import path from 'node:path'

const liveEnabled = process.env.SOHEE_LOCAL_PUBLISH_LIVE === '1'
const profileDir = process.env.SOHEE_CONNECTOR_PROFILE_DIR
const targetBlogId = process.env.SOHEE_NAVER_TEST_BLOG_ID
const versionId = process.env.SOHEE_APPROVED_CONTENT_VERSION_ID

test('verifies the dedicated Chrome profile and Naver editor without submitting', async () => {
  test.skip(
    !liveEnabled || !profileDir || targetBlogId !== 'findk3' || !versionId,
    '전용 Chrome 프로필, findk3 대상과 정확한 승인 버전이 준비된 경우에만 실행합니다.',
  )
  const extensionPath = path.resolve('connector/chrome-extension/dist')
  const context = await chromium.launchPersistentContext(profileDir!, {
    channel: 'chrome', headless: false,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  try {
    const page = await context.newPage()
    await page.goto(`https://blog.naver.com/${targetBlogId}/postwrite`)
    await expect(page).toHaveURL(/blog\.naver\.com/)
    const supported = await page.locator([
      '[data-naver-editor]', '.se-document', '#postEditor',
    ].join(',')).count()
    expect(supported).toBeGreaterThan(0)
    await expect(page.locator('[data-publish-button], button[aria-label*="발행"], button[data-testid="publish"]')).toHaveCount(1)
    expect(process.env.SOHEE_LIVE_SUBMIT_APPROVED).not.toBe(versionId)
  } finally {
    await context.close()
  }
})
