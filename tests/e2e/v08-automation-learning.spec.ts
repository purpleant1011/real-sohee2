import { expect, test } from '@playwright/test'

test('shows only fixed safe automation and learning fixture states without external requests', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => { if (new URL(request.url()).hostname !== '127.0.0.1') external.push(request.url()) })
  const response = await page.goto('/e2e-fixture/automation-learning')
  expect(response?.status()).toBe(200)
  await expect(page.getByText('하루 최대 40 크레딧')).toBeVisible()
  await expect(page.getByText('조용한 시간 오후 10:00부터 오전 7:00')).toBeVisible()
  await expect(page.getByText('비활성', { exact: true })).toBeVisible()
  await expect(page.getByLabel('채널 성과 상태').getByText('조회 120')).toBeVisible()
  await expect(page.getByText('네이버 블로그: 연결 전')).toBeVisible()
  await expect(page.getByRole('heading', { name: '확인된 변화' })).toBeVisible()
  await expect(page.getByRole('button', { name: '다음 방향 논의하기' })).toBeDisabled()
  await expect(page.getByText('승인 전 비활성')).toBeVisible()
  await expect(page.getByText('반려됨')).toBeVisible()
  await expect(page.getByText('active harness로 전환되지 않아요.')).toBeVisible()
  expect(external).toEqual([])
})
