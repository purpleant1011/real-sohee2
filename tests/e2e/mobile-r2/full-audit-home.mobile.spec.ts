import { expect, test } from '@playwright/test'
import type { MobileHomeDto } from '../../../src/features/mobile-decision/contracts'
import { expectAxeClean, expectNoHorizontalOverflow } from './support/gates'

const workspaceId = '00000000-0000-4000-8000-000000000001'
const homeEndpoint = `**/api/workspaces/${workspaceId}/mobile-home`

const homeFixture: MobileHomeDto = {
  workspaceId,
  businessName: '소희 audit 카페',
  timeZone: 'Asia/Seoul',
  generatedAt: '2026-11-10T09:00:00Z',
  agent: { state: 'ready', data: { label: '소희가 가게 일을 돕고 있어요', detailHref: '/app/account/automation' }, observedAt: '2026-11-10T09:00:00Z', validUntil: null },
  decisions: { state: 'ready', data: { items: [], total: 0, complete: true }, observedAt: '2026-11-10T09:00:00Z', validUntil: null },
  activity: {
    state: 'ready',
    data: [
      {
        id: 'content:0ab74cd0-5b88-4234-b9d0-eef3ba25b6ed',
        title: '가을 신메뉴 안내 포스팅',
        statusLabel: '게시 확인 전',
        observedAt: '2026-11-10T08:30:00Z',
        evidenceRef: JSON.stringify({ source: 'content_items.status/unverified_publish', contentId: '0ab74cd0-5b88-4234-b9d0-eef3ba25b6ed', status: 'published' }),
      },
    ],
    observedAt: '2026-11-10T09:00:00Z',
    validUntil: null,
  },
  results: {
    state: 'ready',
    data: [
      {
        id: 'published',
        label: '게시 확인 · 2026-11-03 ~ 2026-11-10 (UTC)',
        value: 0,
        unit: '건',
        state: 'ready',
        evidenceRef: null,
        source: null,
        datasetMode: 'ACTUAL',
        period: { start: '2026-11-03T00:00:00.000Z', end: '2026-11-10T00:00:00.000Z', timeZone: 'UTC' },
      },
    ],
    observedAt: '2026-11-10T09:00:00Z',
    validUntil: null,
  },
}

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      await route.abort('blockedbyclient')
    } else {
      await route.continue()
    }
  })

  // 홈 DTO 모킹
  await page.route(homeEndpoint, route =>
    route.fulfill({ status: 200, json: homeFixture }),
  )

  // 사진 견적 API 모킹
  await page.route(`**/api/workspaces/${workspaceId}/quick-post?limit=1`, route =>
    route.fulfill({ status: 200, json: { credits: { photoDraftCost: 100 } } }),
  )

  // 사진 목록 모킹
  await page.route('**/api/onboarding/media', route =>
    route.fulfill({
      status: 200,
      json: { items: [{ id: '60000000-0000-4000-8000-000000000001', rights_status: 'confirmed', publish_eligibility: true }] },
    }),
  )
})

test('홈 활동 미검증 원고는 "확인 전"으로 표시되고, 사진 시트는 명시적 44px 닫기/ESC/초점복귀를 만족한다', async ({ page }) => {
  await page.goto('/dev/mobile-r2/today-wiring?r2=1')

  // 1. 홈 상단 및 오늘 셸 로드 확인
  await expect(page.getByText('가을 신메뉴 안내 포스팅')).toBeVisible()

  // 2. 미검증 원고 게시 진실성 확인: 거짓 '게시 완료'가 아닌 '확인 전'(aria-label='게시 확인 전') 노출
  const unverifiedPill = page.getByLabel('게시 확인 전')
  await expect(unverifiedPill).toBeVisible()
  await expect(unverifiedPill).toHaveText('확인 전')
  await expect(page.getByText('게시 완료')).toHaveCount(0)

  // 3. 사진으로 글 만들기 시트 열기
  const photoTrigger = page.getByRole('button', { name: /사진으로 글 만들기/ })
  await expect(photoTrigger).toBeVisible()
  await photoTrigger.click()

  // 시트 열림 확인
  const sheet = page.getByRole('dialog', { name: '사진으로 글 만들기' })
  await expect(sheet).toBeVisible()

  // 4. 크레딧 수치/단어 전면 비노출 검증 (feedback-hide-credit-display)
  await expect(sheet.getByText(/크레딧/)).toHaveCount(0)
  await expect(sheet.getByText(/100/)).toHaveCount(0)
  await expect(sheet.getByText('준비한 내용은 게시 전에 확인해요')).toBeVisible()

  // 5. 명시적 44px 닫기 버튼 존재 및 크기 검증
  const closeButton = sheet.getByRole('button', { name: '닫기' })
  await expect(closeButton).toBeVisible()
  const box = await closeButton.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.width).toBeGreaterThanOrEqual(44)
  expect(box!.height).toBeGreaterThanOrEqual(44)

  // 6. 닫기 버튼 터치로 시트 닫힘 검증
  await closeButton.click()
  await expect(sheet).not.toBeVisible()

  // 7. 다시 시트 열고 ESC 키 닫기 및 원래 트리거 버튼으로 초점 복귀 검증
  await photoTrigger.click()
  await expect(sheet).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(sheet).not.toBeVisible()
  await expect(photoTrigger).toBeFocused()

  // 8. 가로 스크롤 오버플로 없음 검증
  await expectNoHorizontalOverflow(page)

  // 9. WCAG 2.2 AA axe 접근성 검사
  await expectAxeClean(page)
})
