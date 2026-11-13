import { expect, test } from '@playwright/test'

test('verifies credit plans and pending billing with local fixture data only', async ({ page }) => {
  const external: string[] = []
  page.on('request', (request) => { const host = new URL(request.url()).hostname; if (host !== '127.0.0.1' && host !== 'localhost') external.push(request.url()) })
  await page.goto('/e2e-fixture/credit-plan')
  await expect(page.getByTestId('sufficient-plan')).toContainText('실행 가능')
  await expect(page.getByTestId('insufficient-plan')).toContainText('이미지 수 줄이기')
  await expect(page.getByTestId('chat-idempotency')).toHaveText('동일 clientMessageId · 1회 사용 확정')
  await expect(page.getByTestId('ledger-history')).toContainText('임시 확보')
  await expect(page.getByTestId('ledger-history')).toContainText('반환 또는 조정')
  await expect(page.getByTestId('pending-checkout')).toContainText('결제 기능 연결 대기')
  await expect(page.getByTestId('pending-checkout')).not.toContainText('결제 완료')
  expect(external).toEqual([])
})
