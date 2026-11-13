import { expect, test } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const liveChatEnabled = process.env.E2E_LIVE_CHAT === '1'

test('persists a real streamed conversation across a production reload', async ({ page }) => {
  test.skip(!email || !password || !liveChatEnabled, '명시적으로 허용된 실도메인 대화 검증에서만 실행합니다.')

  const verificationId = `ANI-16-${Date.now()}`
  const message = `최종 저장 검증 ${verificationId}. 한 문장으로 응답해 주세요.`

  await page.goto('/login?next=%2Fapp')
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()
  await expect(page).toHaveURL(/\/app(?:\/onboarding)?$/, { timeout: 30_000 })

  if (new URL(page.url()).pathname === '/app/onboarding') {
    await page.getByLabel('내 이름').fill('소희 MVP 운영자')
    await page.getByLabel('작업공간 이름').fill('빌더스 길드')
    await page.getByRole('button', { name: '작업공간 시작하기' }).click()
    await expect(page).toHaveURL(/\/app$/, { timeout: 30_000 })
  }

  await expect(page.getByText('실제 대화 연결됨')).toBeVisible()
  const assistantMessages = page.getByLabel('소희 메시지')
  const assistantCountBefore = await assistantMessages.count()

  await page.getByLabel('소희에게 메시지 보내기').fill(message)
  await page.getByRole('button', { name: '메시지 보내기' }).click()

  await expect(page.getByLabel('내 메시지').getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByText('소희가 답변을 완료했어요.')).toBeVisible({ timeout: 120_000 })
  await expect(assistantMessages).toHaveCount(assistantCountBefore + 1)

  await page.reload()
  await expect(page.getByText('실제 대화 연결됨')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('내 메시지').getByText(message, { exact: true })).toBeVisible()
  await expect(page.getByLabel('소희 메시지')).toHaveCount(assistantCountBefore + 1)
})
