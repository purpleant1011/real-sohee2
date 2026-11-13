import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('채널 지식 학습 UI/E2E 검증 (/dev/channel-learning)', () => {
  test('PC (1280px): URL 등록 → 명시동의 → 등록 → 확인 → 수집 → 검토편집 → 승인 → 삭제 전체 라이프사이클', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dev/channel-learning')

    // 1. 헤더 및 초기 상태 확인
    await expect(page.getByRole('heading', { name: '공식 채널 지식 학습' })).toBeVisible()
    await expect(page.getByRole('note')).toContainText('로컬 UI 검증 · 가상 자료')

    // 2. 초기 URL 등록 폼 - 동의 없이 제출 불가
    const urlInput = page.getByLabel('채널 주소 (URL)')
    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })
    const textConsent = page.getByLabel('[선택] 게시물 텍스트를 매장 지식 학습에 활용하는 데 동의합니다.')

    await urlInput.fill('https://www.instagram.com/my_sweet_bakery/')
    await expect(submitBtn).toBeDisabled() // 동의 체크 전에는 비활성화

    // 3. 텍스트 활용 동의 체크 후 등록
    await textConsent.check()
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    // 4. 등록 후 목록에 새 출처 카드 노출 확인 (확인 대기 중)
    const newCard = page.locator('#panel-channel-list .space-y-3 > div').filter({
      has: page.getByRole('link', { name: 'https://www.instagram.com/my_sweet_bakery/' }),
    })
    await expect(newCard).toBeVisible()
    await expect(newCard).toContainText('확인 대기 중')

    // 5. 본인 채널 확인(verify) 클릭
    const verifyBtn = newCard.getByRole('button', { name: '본인 채널 확인' })
    await verifyBtn.click()
    await expect(newCard).toContainText('본인 확인 완료')

    // 6. 내용 수집 시작(collect) 클릭
    const collectBtn = newCard.getByRole('button', { name: '내용 수집 시작' })
    await collectBtn.click()
    await expect(newCard).toContainText('검토 필요')

    // 7. 지식 검토하기(review) 클릭 -> 모달 오픈
    const reviewBtn = newCard.getByRole('button', { name: '지식 검토하기' })
    await reviewBtn.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: '지식 검토 및 승인' })).toBeVisible()

    // 8. 지식 편집 및 승인
    await expect(dialog).toContainText('평일 11시부터 20시까지 영업합니다.')
    const editBtn = dialog.getByRole('button', { name: '내용 수정' }).first()
    await editBtn.click()

    const textarea = dialog.locator('textarea')
    await textarea.fill('평일 및 주말 10시부터 21시까지 영업합니다. (수정본)')
    const saveEditBtn = dialog.getByRole('button', { name: '수정 완료' })
    await saveEditBtn.scrollIntoViewIfNeeded()
    await saveEditBtn.click({ force: true })
    await expect(dialog).toContainText('평일 및 주말 10시부터 21시까지 영업합니다. (수정본)')

    // 9. 승인 및 반영 클릭 -> 모달 닫힘
    const approveBtn = dialog.getByRole('button', { name: /지식 승인 및 반영/ })
    await approveBtn.click()
    await expect(dialog).not.toBeVisible()

    // 10. 출처 삭제 클릭 -> 목록에서 제거 (status: pending)
    const deleteBtn = newCard.getByRole('button', { name: '출처 삭제' })
    await deleteBtn.click()
    await expect(page.locator('div', { hasText: 'my_sweet_bakery' })).not.toBeVisible()
  })

  test('Mobile (390px): 모바일 탭 단계 전환 및 URL 등록 후 목록 자동 이동 플로우', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/channel-learning')

    // 모바일 탭 바 확인
    const tabRegister = page.getByRole('tab', { name: '1. 채널 등록' })
    const tabList = page.getByRole('tab', { name: /2. 학습 현황/ })

    await expect(tabRegister).toBeVisible()
    await expect(tabList).toBeVisible()
    await expect(tabRegister).toHaveAttribute('aria-selected', 'true')

    // 1. 등록 탭에서 URL 입력 및 동의
    const urlInput = page.getByLabel('채널 주소 (URL)')
    await urlInput.fill('https://threads.net/@mobile_brand')
    const textConsent = page.getByLabel('[선택] 게시물 텍스트를 매장 지식 학습에 활용하는 데 동의합니다.')
    await textConsent.scrollIntoViewIfNeeded()
    await textConsent.check({ force: true })

    // 2. 등록 실행 -> 완료 시 자동으로 2번 탭(학습 현황)으로 전환
    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })
    await expect(submitBtn).toBeEnabled()
    await submitBtn.click()

    await expect(tabList).toHaveAttribute('aria-selected', 'true')
    await expect(
      page.locator('#panel-channel-list').getByRole('link', { name: 'https://threads.net/@mobile_brand' }),
    ).toBeVisible()

    // 3. 기존 샘플 카드 검토하기 모달 오픈
    const reviewBtn = page.getByRole('button', { name: '지식 검토하기' }).first()
    await reviewBtn.click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    // 닫기 버튼 클릭 시 모달 닫힘 (우측 상단 닫기 아이콘 또는 하단 닫기 버튼)
    const closeBtn = dialog.getByRole('button', { name: '지식 검토 창 닫기' })
    await closeBtn.click()
    await expect(dialog).not.toBeVisible()
  })

  test('미지원 당근마켓 차단 안내 및 네이버 블로그 수동 확인 안내', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dev/channel-learning')

    const urlInput = page.getByLabel('채널 주소 (URL)')
    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })

    // 당근마켓 입력 시 차단 안내
    await urlInput.fill('https://www.daangn.com/kr/business/cafe-sohee')
    await expect(page.getByText('이 채널은 현재 공식 연동이 지원되지 않아 자동 수집이 차단되어 있습니다.')).toBeVisible()
    await expect(submitBtn).toBeDisabled()

    // 네이버 블로그 입력 시 수동 확인 안내
    await urlInput.fill('https://blog.naver.com/sohee_official')
    await expect(page.getByText('네이버는 정책상 자동 수집을 지원하지 않으며, 직접 입력한 내용이나 공개 정책을 안전하게 검토합니다.')).toBeVisible()
  })

  test('OAuth 미연결 상태 본인 확인 실패 시 409 CONNECTION_REQUIRED 감지 및 채널 연결 관리 CTA 링크 노출', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dev/channel-learning')

    // 미연결 계정 URL 등록
    const urlInput = page.getByLabel('채널 주소 (URL)')
    await urlInput.fill('https://www.instagram.com/unconnected_shop/')
    const textConsent = page.getByLabel('[선택] 게시물 텍스트를 매장 지식 학습에 활용하는 데 동의합니다.')
    await textConsent.check()

    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })
    await submitBtn.click()

    // 카드에서 본인 확인 클릭
    const card = page.locator('#panel-channel-list .space-y-3 > div').filter({
      has: page.getByRole('link', { name: 'https://www.instagram.com/unconnected_shop/' }),
    })
    await expect(card).toBeVisible()
    const verifyBtn = card.getByRole('button', { name: '본인 채널 확인' })
    await verifyBtn.click()

    // 에러 배너 및 명시적 채널 연결 관리 CTA 링크 노출 확인
    const errorBanner = page.getByRole('alert').filter({ hasText: '채널 연결이 필요해요' })
    await expect(errorBanner).toBeVisible()
    await expect(errorBanner).toContainText('채널 연결이 필요해요. 채널 연결 관리에서 계정을 먼저 연결해 주세요.')

    const channelCta = errorBanner.getByRole('link', { name: '채널 연결 관리로 이동' })
    await expect(channelCta).toBeVisible()
    await expect(channelCta).toHaveAttribute('href', '/app/channels')
  })

  test('Viewer(보기 권한) 모드 (?role=viewer): 쓰기/등록/삭제 액션 비활성화', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dev/channel-learning?role=viewer')

    // 보기 권한 안내문구 노출
    await expect(page.getByText('현재 보기 전용(Viewer) 권한으로 표시 중입니다.')).toBeVisible()
    await expect(page.getByText('보기 권한은 채널을 등록하거나 수정할 수 없습니다.')).toBeVisible()

    // URL 입력 및 등록 버튼 비활성화
    const urlInput = page.getByLabel('채널 주소 (URL)')
    await expect(urlInput).toBeDisabled()

    const submitBtn = page.getByRole('button', { name: '채널 등록하기' })
    await expect(submitBtn).toBeDisabled()

    // 카드 액션 버튼 비활성화 확인
    const deleteBtn = page.getByRole('button', { name: '출처 삭제' }).first()
    await expect(deleteBtn).toBeDisabled()
  })

  test('키보드 접근성: 모바일 탭 화살표 내비게이션 및 다이얼로그 키보드 Focus', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/channel-learning')

    const tabRegister = page.getByRole('tab', { name: '1. 채널 등록' })
    const tabList = page.getByRole('tab', { name: /2. 학습 현황/ })

    await tabRegister.focus()
    // ArrowRight 키 누르면 2번째 탭으로 전환되고 포커스 이동
    await page.keyboard.press('ArrowRight')
    await expect(tabList).toHaveAttribute('aria-selected', 'true')
    await expect(tabList).toBeFocused()

    // ArrowLeft 키 누르면 1번째 탭으로 복귀
    await page.keyboard.press('ArrowLeft')
    await expect(tabRegister).toHaveAttribute('aria-selected', 'true')
    await expect(tabRegister).toBeFocused()
  })

  test('반응형 가로 오버플로우 0 검증 (320px, 360px, 375px, 390px, 430px, 1280px)', async ({
    page,
  }) => {
    const widths = [320, 360, 375, 390, 430, 1280]
    await page.goto('/dev/channel-learning')

    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 })
      await page.waitForTimeout(50)

      // 가로 스크롤 넘침 여부 평가 (scrollWidth <= innerWidth)
      const hasHorizontalOverflow = await page.evaluate(() => {
        const root = document.documentElement
        const body = document.body
        const scrollWidth = Math.max(root.scrollWidth, body.scrollWidth)
        const clientWidth = root.clientWidth
        return scrollWidth > clientWidth
      })

      expect(hasHorizontalOverflow, `폭 ${width}px에서 가로 스크롤 넘침이 발생하지 않아야 함`).toBe(false)
    }
  })

  test('접근성 (Axe WCAG 2A/AA/2.1AA): 기본 등록 화면 및 다이얼로그 오픈 상태 위반 0건', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/dev/channel-learning')

    // 1. 기본 등록 및 채널 목록 화면 검사
    const pageAxeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    expect(pageAxeResults.violations).toEqual([])

    // 2. 지식 검토 다이얼로그 오픈 상태 검사
    const reviewBtn = page.getByRole('button', { name: '지식 검토하기' }).first()
    await reviewBtn.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    const dialogAxeResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    expect(dialogAxeResults.violations).toEqual([])
  })

  test('모바일 390px 다크모드 및 200% 텍스트 줌 타겟 검사 (Axe 및 레이아웃 무결성)', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/dev/channel-learning')

    // 200% 텍스트 확대 시뮬레이션
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%'
    })

    const darkZoomAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    expect(darkZoomAxe.violations).toEqual([])

    // 200% 확대 시에도 가로 스크롤 넘침이 없는지 확인
    const hasHorizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth > root.clientWidth
    })
    expect(hasHorizontalOverflow).toBe(false)
  })
})
