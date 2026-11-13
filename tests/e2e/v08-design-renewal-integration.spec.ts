import { expect, test } from '@playwright/test'

test('승인한 정확한 v3이 실행, 일정과 리포트까지 같은 운영 흐름으로 이어진다', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })

  await test.step('대화에서 기간과 실행 범위를 결정한다', async () => {
    await page.goto('/e2e-fixture/app-shell?screen=plan')
    await expect(page.getByRole('heading', { name: '신규 상담을 위한 14일 계획' })).toBeVisible()
    await expect(page.getByText('게시물 12개 · 이미지 18장')).toBeVisible()
    await expect(page.getByRole('button', { name: '이 계획으로 시작' })).toBeEnabled()
  })

  await test.step('정확한 게시 버전과 근거를 끝까지 검토한다', async () => {
    await page.goto('/e2e-fixture/app-shell?screen=review')
    const summary = page.getByRole('region', { name: '정확한 버전 승인 요약' })
    await expect(summary).toContainText('@studio_byreum')
    await expect(summary).toContainText('v3')
    await expect(summary).toContainText('이미지 3장')
    await page.getByRole('button', { name: '다음 이미지, 2 / 3' }).click()
    await page.getByRole('button', { name: '다음 이미지, 3 / 3' }).click()
    await expect(page.getByRole('button', { name: '이 v3 버전 승인' })).toBeEnabled()
  })

  await test.step('승인한 같은 v3의 실행 방식을 선택한다', async () => {
    await page.goto('/e2e-fixture/app-shell?screen=execution')
    const execution = page.getByRole('region', { name: '승인 후 실행 선택' })
    await expect(execution).toContainText('@studio_byreum')
    await expect(execution).toContainText('v3')
    await page.getByRole('button', { name: '예약 게시' }).click()
    await page.getByLabel('예약 시각 · Asia/Seoul').fill('2030-08-21T10:30')
    await expect(page.getByRole('button', { name: '승인한 v3 예약 게시' })).toBeEnabled()
  })

  await test.step('실패해도 승인 v3과 크레딧 반환 근거를 보존한다', async () => {
    await page.goto('/e2e-fixture/app-shell?screen=recovery')
    await expect(page.getByText('Instagram v3 승인 버전은 보관됐어요.')).toBeVisible()
    await expect(page.getByText('외부 실행 0 사용 · 4 반환')).toBeVisible()
    await expect(page.getByRole('button', { name: '다시 시도' })).toBeEnabled()
  })

  await test.step('일정에서 같은 계정, 버전과 예약 근거를 확인한다', async () => {
    await page.goto('/e2e-fixture/app-shell?screen=schedule-v08')
    await expect(page.getByRole('link', { name: '일정', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.getByRole('button', { name: '잔흔 상담 전후 기록 상세 보기' }).click()
    const detail = page.getByRole('dialog', { name: '잔흔 상담 전후 기록' })
    await expect(detail).toContainText('Instagram · @studio_byreum')
    await expect(detail).toContainText('정확한 게시 버전v3')
    await expect(detail.getByRole('link', { name: '성과와 고객 반응 보기' })).toHaveAttribute(
      'href',
      '/app/reports?view=reactions&work=80000000-0000-4000-8000-000000000001',
    )
  })

  await test.step('리포트에서 같은 v3의 실제 결과와 고객 반응을 확인한다', async () => {
    await page.goto('/e2e-fixture/app-shell?view=report&screen=report-v08')
    await expect(page.getByRole('link', { name: '리포트', exact: true })).toHaveAttribute('aria-current', 'page')
    const post = page.getByLabel('여름 관리 안내 포스트 분석')
    await expect(post).toContainText('인스타그램 · 게시 버전 v3')
    await expect(post).toContainText('채널 게시물 ig-post-123')
    await page.getByRole('tab', { name: '고객 반응' }).click()
    await expect(page.getByText('예약 가능한가요?')).toBeVisible()
    await expect(post.getByRole('link', { name: '관련 대화에서 개선하기' })).toHaveAttribute(
      'href',
      '/app?work=80000000-0000-4000-8000-000000000001',
    )
  })

  await test.step('나의 소희에서 실제 다음 설정을 확인한다', async () => {
    await page.goto('/e2e-fixture/app-shell?screen=my-sohee-v08')
    await expect(page.getByRole('link', { name: '나의 소희', exact: true })).toHaveAttribute('aria-current', 'page')
    const status = page.getByLabel('나의 소희 운영 상태')
    await expect(status).toContainText('4/6 준비')
    await expect(status).toContainText('다음 설정지식 자료')
    await expect(page.getByRole('link', { name: '지식 자료 설정하기' })).toHaveAttribute('href', '/app/account/knowledge')
  })

  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
})

test('모바일 주요 탐색이 대화, 일정, 리포트와 나의 소희의 현재 위치를 유지한다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const screens = [
    { url: '/e2e-fixture/app-shell?screen=plan', label: '대화' },
    { url: '/e2e-fixture/app-shell?screen=schedule-v08', label: '일정' },
    { url: '/e2e-fixture/app-shell?view=report&screen=report-v08', label: '리포트' },
    { url: '/e2e-fixture/app-shell?screen=my-sohee-v08', label: '나의 소희' },
  ] as const

  for (const screen of screens) {
    await page.goto(screen.url)
    await expect(page.getByRole('link', { name: screen.label, exact: true })).toHaveAttribute('aria-current', 'page')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBe(0)
  }
})
