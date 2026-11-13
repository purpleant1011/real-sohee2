import { expect, test } from '@playwright/test'

const email = process.env.E2E_AUTH_EMAIL
const password = process.env.E2E_AUTH_PASSWORD
const reportLabel = process.env.E2E_LIVE_REPORT_LABEL

test('renders the persisted R-02 list and R-05 customer detail on production', async ({ page }) => {
  test.skip(!email || !password || !reportLabel, '비식별 원격 검증 자료가 준비된 실도메인 검사에서만 실행합니다.')
  const expectedReportLabel = reportLabel!

  await page.goto('/login?next=%2Fapp%2Freports')
  await page.getByLabel('이메일').fill(email!)
  await page.getByLabel('비밀번호').fill(password!)
  await page.getByRole('button', { name: '이메일로 로그인' }).click()
  await expect(page).toHaveURL(/\/app\/reports$/, { timeout: 30_000 })

  await page.getByRole('tab', { name: '고객 대화' }).click()
  await expect(page.getByRole('heading', { name: /^고객 대화 \d+건$/ })).toBeVisible()
  await page.getByRole('link', { name: `${expectedReportLabel} 상세 보기` }).click()

  const dialog = page.getByRole('dialog', { name: '고객 대화 상세' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText(expectedReportLabel, { exact: true })).toBeVisible()
  await expect(dialog.getByText('실제 고객 대화가 아닌 비식별 실도메인 검증 자료입니다.')).toBeVisible()
  await expect(dialog.getByText(/외부 고객 식별값과 원문은 노출하지 않고/)).toBeVisible()
  await expect(dialog.getByText('사람 확인 필요')).toBeVisible()
})
