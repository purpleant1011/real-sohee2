import { expect, test } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const fixtureContentId = '80000000-0000-4000-8000-000000000001'
const generationEnabled = process.env.E2E_RUN_OPENAI_GENERATION === '1'

test('generates reviewed text and image before an explicit immutable save', async ({ page }) => {
  test.skip(
    !email || !password || !generationEnabled,
    '실제 Supabase 계정과 별도 OpenAI 비용 승인이 설정된 환경에서 실행합니다.',
  )

  await page.goto(`/login?next=${encodeURIComponent(`/app/work/${fixtureContentId}/edit`)}`)
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()
  await expect(page).toHaveURL(new RegExp(`/app/work/${fixtureContentId}/edit$`))

  const versionHeading = page.getByRole('heading', {
    name: /현재 v\d+에서 새 버전 만들기/,
  })
  const originalHeading = await versionHeading.textContent()

  await page.getByLabel('수정 지시').fill('기존 의미를 유지하면서 따뜻하고 간결하게 다듬어 줘.')
  await page.getByRole('button', { name: '소희 AI 수정' }).click()
  await expect(page.getByRole('status')).toContainText('검토 후 새 버전으로 저장')
  await expect(versionHeading).toHaveText(originalHeading ?? '')
  await expect(page).toHaveURL(new RegExp(`/app/work/${fixtureContentId}/edit$`))

  await page.getByLabel('이미지 생성 지시').fill('따뜻한 가을 캠페인 정사각 이미지. 글자는 넣지 말아 줘.')
  await page.getByRole('button', { name: '소희 이미지 생성' }).click()
  await expect(page.getByRole('status')).toContainText('목록에서 선택', { timeout: 120_000 })

  const generatedMedia = page.getByLabel(/PNG ·/).last()
  await generatedMedia.check()
  await page.getByLabel('미디어 사용권을 확인했습니다.').check()
  await page.getByLabel('생성 과정과 근거를 확인했습니다.').check()
  await page.getByRole('button', { name: '새 버전으로 저장' }).click()

  await expect(page).toHaveURL(new RegExp(`/app/work/${fixtureContentId}$`))
  await expect(page.getByRole('heading', { name: /현재 v\d+/ })).toBeVisible()
})
