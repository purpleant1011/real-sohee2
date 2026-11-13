import { expect, test } from '@playwright/test'

test.describe('채널 지식 학습 추가 devfixture-only 회귀 검증 (/dev/channel-learning)', () => {
  test('devfixture-only privacy 삭제 pending: 출처 삭제 시 202 pending 후 카드 제거 및 빈 목록 상태 전환', async ({
    page,
  }) => {
    await page.goto('/dev/channel-learning')

    // 모바일 뷰포트인 경우 학습 현황 탭 선택
    const tabList = page.getByRole('tab', { name: /2. 학습 현황/ })
    if (await tabList.isVisible()) {
      await tabList.click()
    }

    // 1. 초기 등록된 demo 출처 카드 확인
    const demoCard = page.locator('#panel-channel-list .space-y-3 > div').filter({
      has: page.getByRole('link', { name: 'https://www.instagram.com/sohee_demo_shop/' }),
    })
    await expect(demoCard).toBeVisible()

    // 2. 출처 삭제 버튼 클릭 (preview transport: 202 pending 반환 후 목록에서 제거)
    const deleteBtn = demoCard.getByRole('button', { name: '출처 삭제' })
    await deleteBtn.click()

    // 3. 목록에서 제거되었는지 확인 및 '아직 등록된 공식 채널이 없습니다.' 빈 상태 카드 노출 확인
    await expect(demoCard).not.toBeVisible()
    await expect(page.getByText('아직 등록된 공식 채널이 없습니다.')).toBeVisible()
  })

  test('devfixture-only 409 충돌 회귀: OAuth 미연결 계정 본인 확인 시 409 CONNECTION_REQUIRED 감지 및 CTA 링크', async ({
    page,
  }) => {
    await page.goto('/dev/channel-learning')

    // 1. 미연결 계정 URL 입력 및 동의 후 등록
    const urlInput = page.getByLabel('채널 주소 (URL)')
    await urlInput.fill('https://www.instagram.com/unconnected_shop/')
    const textConsent = page.getByLabel('[선택] 게시물 텍스트를 매장 지식 학습에 활용하는 데 동의합니다.')
    await textConsent.check({ force: true })

    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })
    await submitBtn.click()

    // 2. 등록된 카드에서 본인 채널 확인 클릭 -> 409 발생
    const card = page.locator('#panel-channel-list .space-y-3 > div').filter({
      has: page.getByRole('link', { name: 'https://www.instagram.com/unconnected_shop/' }),
    })
    await expect(card).toBeVisible()
    const verifyBtn = card.getByRole('button', { name: '본인 채널 확인' })
    await verifyBtn.click()

    // 3. 409 에러 배너 및 채널 연결 관리 CTA 링크 검증
    const alertBanner = page.getByRole('alert').filter({ hasText: '채널 연결이 필요해요' })
    await expect(alertBanner).toBeVisible()
    await expect(alertBanner).toContainText(
      '채널 연결이 필요해요. 채널 연결 관리에서 계정을 먼저 연결해 주세요.',
    )

    const ctaLink = alertBanner.getByRole('link', { name: '채널 연결 관리로 이동' })
    await expect(ctaLink).toBeVisible()
    await expect(ctaLink).toHaveAttribute('href', '/app/channels')
  })

  test('devfixture-only 등록 실패 및 차단 정책 메시지 회귀 검증', async ({ page }) => {
    await page.goto('/dev/channel-learning')

    const urlInput = page.getByLabel('채널 주소 (URL)')
    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })

    // 1. 미지원 플랫폼 입력 시 차단 메시지 표시 및 버튼 비활성화
    await urlInput.fill('https://www.daangn.com/kr/business/cafe-sohee')
    await expect(
      page.getByText('이 채널은 현재 공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다.'),
    ).toBeVisible()
    await expect(submitBtn).toBeDisabled()

    // 2. 지원 플랫폼 입력 후 동의 미체크 시 버튼 비활성화 유지
    await urlInput.fill('https://www.instagram.com/my_new_cafe/')
    await expect(submitBtn).toBeDisabled()
  })
})
