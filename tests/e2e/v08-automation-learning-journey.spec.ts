import { expect, test } from '@playwright/test'

function collectExternalRequests(page: import('@playwright/test').Page) {
  const external: string[] = []
  page.on('request', (request) => {
    const hostname = new URL(request.url()).hostname
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') external.push(request.url())
  })
  return external
}

test('runs the report-only automation fixture through approved learning without activating a harness', async ({ page }) => {
  const external = collectExternalRequests(page)
  const response = await page.goto('/e2e-fixture/automation-learning-journey')

  expect(response?.status()).toBe(200)
  await expect(page.getByTestId('fixture-boundary')).toContainText('same-origin fixture only')
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByTestId('report-artifact')).toContainText('일정 도래 전')

  await page.getByRole('button', { name: '일정 도래 보고 실행' }).click()
  await expect(page.getByTestId('performance-state')).toContainText('네이버 블로그: 연결 전')
  await expect(page.getByTestId('performance-state')).toContainText('수집 전을 0으로 바꾸지 않음')
  await expect(page.getByTestId('report-artifact')).toContainText('보고 artifact 생성됨')
  await expect(page.getByRole('heading', { name: '확인된 변화' })).toBeVisible()

  await page.getByRole('button', { name: '대화에서 검토하기' }).click()
  await expect(page.getByLabel('성과 보고 대화')).toBeVisible()
  await page.getByRole('button', { name: '학습 후보 승인' }).click()
  await expect(page.getByTestId('harness-proposal')).toContainText('review_required 하네스 제안')
  await expect(page.getByTestId('harness-proposal')).toContainText('active harness 아님')
  await expect(page.getByTestId('harness-proposal')).toContainText('활성 규칙 변경 없음')
  expect(external).toEqual([])
})

test('does not create a harness proposal when the user rejects the reviewed learning candidate', async ({ page }) => {
  const external = collectExternalRequests(page)
  await page.goto('/e2e-fixture/automation-learning-journey')

  await page.getByRole('button', { name: '일정 도래 보고 실행' }).click()
  await page.getByRole('button', { name: '대화에서 검토하기' }).click()
  await page.getByRole('button', { name: '학습 후보 거절' }).click()

  await expect(page.getByTestId('learning-review')).toContainText('학습 후보 거절됨')
  await expect(page.getByTestId('learning-review')).toContainText('하네스 제안 없음')
  await expect(page.getByTestId('harness-proposal')).toHaveCount(0)
  expect(external).toEqual([])
})
