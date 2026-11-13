import { expect, test } from '@playwright/test'
const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const contentId = '80000000-0000-4000-8000-000000000001'

test('approves only the actual latest version after every final confirmation', async ({ page }) => {
  test.skip(!email || !password, '실제 Supabase Auth 테스트 계정이 설정된 환경에서 실행합니다.')
  await page.goto(`/login?next=${encodeURIComponent(`/app/work/${contentId}`)}`)
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()
  await expect(page.getByRole('heading', { name: '최종 승인' })).toBeVisible()
  const approve = page.getByRole('button', { name: 'v2 최종 승인' })
  await expect(approve).toBeDisabled()
  await page.getByLabel('본문·해시태그·고지를 최종 확인했습니다.').check()
  await page.getByLabel('연결된 미디어의 사용권을 최종 확인했습니다.').check()
  await page.getByLabel('생성 과정과 근거를 최종 확인했습니다.').check()
  await page.getByLabel('검토 사유').fill('실제 최신 버전과 모든 근거를 확인했습니다.')
  await expect(approve).toBeEnabled()
  await approve.click()
  await expect(page.getByText('승인 완료')).toBeVisible()
  await expect(page.getByRole('heading', { name: '최종 승인' })).toHaveCount(0)
})
