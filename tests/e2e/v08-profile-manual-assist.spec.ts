import { expect, test } from '@playwright/test'

test('verifies the local-only profile and manual-assist fallback journey', async ({ page }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') externalRequests.push(request.url())
  })

  await page.goto('/e2e-fixture/profile-action')

  await expect(page.getByTestId('connection-required')).toHaveText('연결 필요')
  await expect(page.getByRole('link', { name: '네이버 공식 로그인 열기' }))
    .toHaveAttribute('href', 'https://nid.naver.com/nidlogin.login')
  await expect(page.getByTestId('selected-place-target')).toHaveText('fixture-place-001')
  await expect(page.getByText('영업시간 · 정보 없음')).toBeVisible()
  await expect(page.getByText('값을 추정하거나 자동 변경하지 않아요. 확인된 값만 필드별 변경안으로 만들 수 있어요.')).toBeVisible()

  const approve = page.getByRole('button', { name: '선택한 변경 승인' })
  await expect(approve).toBeDisabled()
  await page.getByRole('checkbox', { name: '영업시간 변경 선택' }).check()
  await expect(approve).toBeEnabled()

  await expect(page.getByTestId('broker-status')).toHaveText('manual_assist_required')
  await expect(page.getByTestId('credit-release-count')).toHaveText('1')
  await expect(page.getByTestId('daangn-news-preview')).toContainText('당근 비즈프로필 소식 초안')
  await expect(page.getByTestId('manual-assist-package')).toContainText('fixture-daangn-profile-001')
  await expect(page.getByTestId('manual-assist-package')).toContainText('이미지 순서 0, 1')
  expect(externalRequests).toEqual([])
})
