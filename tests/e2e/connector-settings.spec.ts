import { expect, test } from '@playwright/test'

test('shows a scoped Chrome device and target account without provider credentials', async ({ page }) => {
  const response = await page.goto('/e2e-fixture/connector-settings')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: '소희 Chrome 연결 설정 검증' })).toBeVisible()
  await expect(page.getByText('업무용 Chrome')).toBeVisible()
  await expect(page.getByRole('link', { name: 'findk3' })).toHaveAttribute('href', 'https://blog.naver.com/findk3')
  await expect(page.getByText('게시 준비')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Chrome 연결 코드 만들기' })).toBeVisible()
  await expect(page.getByRole('button', { name: '기기 연결 해제' })).toBeVisible()
  await expect(page.locator('input[type="password"]')).toHaveCount(0)
  await expect(page.getByText(/10분 뒤 만료/u)).toBeVisible()
})
