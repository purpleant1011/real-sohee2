import { expect, test } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD

test('signs in, prepares the first workspace, visits the app, and signs out', async ({ page }) => {
  test.skip(!email || !password, '실제 Supabase Auth 테스트 계정이 설정된 환경에서 실행합니다.')

  await page.goto('/login?next=%2Fapp')
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()

  await page.waitForFunction(() =>
    window.location.pathname === '/app/onboarding'
    || document.body.innerText.includes('작업공간 연결됨'),
  )

  if (new URL(page.url()).pathname === '/app/onboarding') {
    await page.getByLabel('내 이름').fill('소희 MVP 운영자')
    await page.getByLabel('작업공간 이름').fill('빌더스 길드')
    await page.getByRole('button', { name: '작업공간 시작하기' }).click()
    await expect(page).toHaveURL(/\/app$/)
  }

  await expect(page.getByRole('banner').getByText(/작업공간 연결됨/)).toBeVisible()

  await page.goto('/app/work')
  await expect(page.getByRole('heading', { name: '작업함' })).toBeVisible()
  await expect(page.getByText('실제 데이터')).toBeVisible()
  await expect(page.getByRole('link', { name: /^전체 \d+$/ })).toHaveAttribute(
    'aria-current',
    'page',
  )

  await page.getByRole('button', { name: '로그아웃' }).click()
  await expect(page).toHaveURL(/\/$/)

  await page.goto('/app/work')
  await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fwork$/)
})
