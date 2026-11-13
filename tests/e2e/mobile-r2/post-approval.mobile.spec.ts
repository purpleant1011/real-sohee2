import { expect, test } from '@playwright/test'

for (const screen of ['R1', 'R2']) {
  test(`${screen} 승인함에서 저장 게시물 편집으로 연결하며 외부 요청은 보내지 않는다`, async ({ page }) => {
    const apiRequests: string[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
    })
    await page.goto('/dev/mobile-r2/post-approval')
    await expect(page.getByRole('note')).toContainText('실제 서버 호출과 외부 실행 없음')
    if (screen === 'R2') await page.getByRole('button', { name: 'R2 화면 확인' }).click()
    await page.getByRole('button', { name: '게시물 수정·최종 승인' }).click()
    const caption = page.getByRole('textbox', { name: '인스타그램 문구', exact: true })
    await expect(caption).toHaveValue('저장한 게시 문안')
    await caption.fill('직접 수정한 매장 소식')
    await expect(page.getByText('저장 안 됨', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '변경 저장', exact: true })).toBeEnabled()
    await caption.scrollIntoViewIfNeeded()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await expect(page.getByText('실행 준비 확인 필요', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '지금 게시하기', exact: true })).toHaveCount(0)
    expect(apiRequests).toEqual([])
  })
}
