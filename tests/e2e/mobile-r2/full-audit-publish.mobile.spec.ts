import { expect, test } from '@playwright/test'
import { expectAxeClean, expectNoHorizontalOverflow } from './support/gates'

const FIXTURE_BASE = '/dev/mobile-r2/work-approve'

test.beforeEach(async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    // 로컬 dev 서버 외의 외부 요청 및 쓰기 메서드는 철저히 차단
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      await route.abort('blockedbyclient')
    } else {
      await route.continue()
    }
  })
})

test.describe('M07 게시 전 최종 확인 (dev fixture)', () => {
  test('미승인(unreviewed) 상태: 타겟·본문·이미지 렌더링, 5탭 숨김, 승인 버튼 노출', async ({ page }) => {
    await page.goto(`${FIXTURE_BASE}?state=unreviewed`)

    // 타겟 계정 및 본문 표시
    await expect(page.getByText('@sohee.ai')).toBeVisible()
    await expect(page.getByText(/가을 신메뉴 오픈!/)).toBeVisible()

    // 이미지 2장 연출 표시
    const images = page.locator('img[alt*="가을"]')
    await expect(images.first()).toBeVisible()

    // DETAIL/REVIEW 모드에서는 기본 5탭 네비게이션 바가 숨겨져야 함
    const bottomNav = page.locator('nav[aria-label="하단 탐색"]')
    await expect(bottomNav).toHaveCount(0)

    // 승인 CTA 확인 (실제 클릭 발송은 하지 않음)
    const approveBtn = page.getByRole('button', { name: /이대로 승인|승인/ })
    await expect(approveBtn).toBeVisible()

    // 가로 스크롤 없음 검증
    await expectNoHorizontalOverflow(page)
  })

  test('승인완료(approved) 상태: "지금 게시 요청" CTA 가 올바르게 표시된다', async ({ page }) => {
    await page.goto(`${FIXTURE_BASE}?state=approved`)

    // 승인 완료 상태이므로 "지금 게시 요청" 버튼이 나타나야 함 (클릭 절대 금지)
    const publishBtn = page.getByRole('button', { name: /지금 게시 요청/ })
    await expect(publishBtn).toBeVisible()
    await expect(publishBtn).toBeEnabled()

    // 가로 스크롤 없음 검증
    await expectNoHorizontalOverflow(page)
  })

  test('빈칸차단(blocked) 상태: 미입력 자리표시자가 감지되어 게시 요청이 차단된다', async ({ page }) => {
    await page.goto(`${FIXTURE_BASE}?state=blocked`)

    // 자리표시자([이벤트 기간] 등) 차단 안내가 명확히 표시되어야 함
    await expect(page.getByText(/채워지지 않은 빈칸이 있어 실제 게시할 수 없어요/)).toBeVisible()
    await expect(page.getByText(/채워야 할 곳이 \d+개 있어요/)).toBeVisible()

    // 승인된 상태라도 빈칸이 남아있어 게시 요청 버튼이 disabled(비활성)되어야 함
    const publishBtn = page.getByRole('button', { name: /지금 게시 요청/ })
    await expect(publishBtn).toBeVisible()
    await expect(publishBtn).toBeDisabled()

    await expectNoHorizontalOverflow(page)
  })

  test('네이버(naver / naver_approved) 상태: 자동 발행 대신 수동 복사 경로를 제공한다', async ({ page }) => {
    await page.goto(`${FIXTURE_BASE}?state=naver_approved`)

    // 네이버 블로그 채널 태그 표시 (exact 매칭으로 strict mode 준수)
    await expect(page.getByText('네이버 블로그', { exact: true })).toBeVisible()

    // 네이버 블로그는 메타처럼 "지금 게시 요청" 자동 발송 CTA가 없어야 함
    const autoPublishBtn = page.getByRole('button', { name: /지금 게시 요청/ })
    await expect(autoPublishBtn).toHaveCount(0)

    // 수동 복사 링크 또는 안내가 노출되어야 함
    const copyLink = page.getByRole('link', { name: /원고 복사/ })
    await expect(copyLink).toBeVisible()

    await expectNoHorizontalOverflow(page)
  })

  test('접근성(axe) 및 테마 무결성 (light/dark)', async ({ page }) => {
    // 1. Light 모드 axe 검증
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto(`${FIXTURE_BASE}?state=approved`)
    await expectAxeClean(page)

    // 2. Dark 모드 axe 검증
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expectAxeClean(page)

    await expectNoHorizontalOverflow(page)
  })
})
