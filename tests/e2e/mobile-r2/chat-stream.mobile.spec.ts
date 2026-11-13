import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

for (const interrupted of [false, true]) {
  test(`R2 에이전트 활동을 표시하고 ${interrupted ? '중단 후 중복 전송을 잠근다' : '계획과 결과를 서버 재조회로 복원한다'}`, async ({ page }) => {
    const apiRequests: string[] = []
    page.on('request', request => {
      if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
    })
    await page.goto('/dev/mobile-r2/chat-stream')
    await expect(page.getByText('개발용 고정 응답 · 실제 서버 호출과 외부 실행 없음')).toBeVisible()
    const input = page.getByRole('textbox', { name: '메시지 내용' })
    await expect(input).toBeEnabled()
    await input.fill('이번 주 홍보 문안을 준비해줘')
    await page.getByRole('button', { name: '보내기', exact: true }).click()
    await expect(page.getByText(/소희가 요청을 처리하고 있어요/)).toBeVisible()
    await expect(page.getByRole('region', { name: '소희의 작업 활동 기록' })).toBeVisible()
    await expect(input).toBeDisabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.getByRole('button', { name: interrupted ? '연결 중단' : '응답 완료', exact: true }).click()
    if (interrupted) {
      await expect(page.getByRole('button', { name: '요청 결과 다시 확인' })).toBeVisible()
      await expect(input).toHaveValue('이번 주 홍보 문안을 준비해줘')
      await expect(input).toBeDisabled()
      await page.getByRole('button', { name: '요청 결과 다시 확인' }).click()
      await expect(input).toBeDisabled()
    } else {
      await expect(page.getByText('서버에서 다시 확인한 답변이에요.')).toBeVisible()
      await expect(page.getByRole('region', { name: '제안한 작업 계획' })).toContainText('문안 검토')
      await expect(page.getByRole('link', { name: '결과 검토·승인' })).toHaveAttribute('href', /\/app\/missions\//)
      await expect(input).toHaveValue('')
      await expect(input).toBeEnabled()
    }
    await expect(page.getByText(/소희가 요청을 처리하고 있어요/)).toHaveCount(0)
    const accessibility = await new AxeBuilder({ page }).include('[data-agent-workspace]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(accessibility.violations).toEqual([])
    expect(apiRequests).toEqual([])
  })
}
