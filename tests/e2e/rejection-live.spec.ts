import { expect, test } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const contentId = '80000000-0000-4000-8000-000000000001'

test('records a revision request against a new actual latest version', async ({ page }) => {
  test.skip(!email || !password, '실제 Supabase Auth 테스트 계정이 설정된 환경에서 실행합니다.')
  await page.goto(`/login?next=${encodeURIComponent(`/app/work/${contentId}/edit`)}`)
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()

  await expect(page.getByRole('heading', { name: /현재 v2에서 새 버전 만들기/ })).toBeVisible()
  await page.getByLabel('본문 문구').fill('수정 요청을 확인할 세 번째 실제 문구')
  await page.getByLabel('수정 이유').fill('거절 흐름을 확인할 새 버전입니다.')
  await page.getByLabel(/PNG · 8 B/).check()
  await page.getByLabel('미디어 사용권을 확인했습니다.').check()
  await page.getByLabel('생성 과정과 근거를 확인했습니다.').check()
  await page.getByRole('button', { name: '새 버전으로 저장' }).click()

  await expect(page.getByRole('heading', { name: '현재 v3' })).toBeVisible()
  await page.getByLabel('검토 사유').fill('고지 문구를 더 명확하게 수정해 주세요.')
  await page.getByRole('button', { name: 'v3 수정 요청' }).click()
  await expect(page.getByText('초안')).toBeVisible()
  await expect(page.getByRole('heading', { name: '최종 승인' })).toHaveCount(0)
})
