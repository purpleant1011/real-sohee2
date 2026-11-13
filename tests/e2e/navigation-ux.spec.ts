import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Navigation UX & Settings/Connectors/Chat History 로컬 격리 하네스 검증', () => {
  // 1. 외부 네트워크 접근 차단 방어선
  test.beforeEach(async ({ page }) => {
    await page.route('**/*', (route) => {
      const url = route.request().url()
      // 로컬 Vite 서버(localhost, 127.0.0.1) 이외의 외부 요청 차단
      if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1') || url.startsWith('data:')) {
        route.continue()
      } else {
        route.abort('blockedbyclient')
      }
    })
  })

  test('기본 화면에는 개발 메뉴와 기술 용어를 표시하지 않는다', async ({ page }) => {
    await page.goto('/?view=overview')
    await expect(page.getByRole('banner', { includeHidden: true })).toBeHidden()
    await expect(page.locator('main')).not.toContainText(/하네스|커넥터|워크스페이스|원장|\b(?:UX|API|OAuth|SSOT)\b/)
    await page.goto('/?view=connectors')
    await expect(page.locator('main')).not.toContainText(/하네스|커넥터|\b(?:Gmail|Google Calendar|Apple Calendar|OAuth|API)\b/)
  })

  test('320/390/480/768/1440px 전 뷰포트에서 가로 오버플로우 0 검증', async ({ page }) => {
    const viewports = [
      { width: 320, height: 640 },
      { width: 390, height: 844 },
      { width: 480, height: 800 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]

    for (const vp of viewports) {
      await page.setViewportSize(vp)

      // 1) 설정 상세 뷰 (SettingsMasterLayout)
      await page.goto('/?controls=1&view=settings')
      await page.waitForSelector('[role="banner"]')

      const overflowSettings = await page.evaluate(() => {
        const root = document.documentElement
        const body = document.body
        return Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth
      })
      expect(overflowSettings, `폭 ${vp.width}px 설정 상세에서 가로 스크롤 넘침이 없어야 함`).toBe(false)

      // 2) 설정 홈 뷰 (SettingsOverview)
      await page.goto('/?controls=1&view=overview')
      await page.waitForSelector('[role="banner"]')

      const overflowOverview = await page.evaluate(() => {
        const root = document.documentElement
        const body = document.body
        return Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth
      })
      expect(overflowOverview, `폭 ${vp.width}px 설정 개요에서 가로 스크롤 넘침이 없어야 함`).toBe(false)

      // 3) 커넥터 허브 뷰
      await page.goto('/?controls=1&view=connectors')
      await page.waitForSelector('[role="banner"]')

      const overflowConnectors = await page.evaluate(() => {
        const root = document.documentElement
        const body = document.body
        return Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth
      })
      expect(overflowConnectors, `폭 ${vp.width}px 커넥터 허브에서 가로 스크롤 넘침이 없어야 함`).toBe(false)

      // 4) 모바일 커넥터 뷰 (모바일 폭)
      if (vp.width <= 480) {
        await page.goto('/?controls=1&view=mobile-connectors')
        await page.waitForSelector('[role="banner"]')

        const overflowMobileConn = await page.evaluate(() => {
          const root = document.documentElement
          const body = document.body
          return Math.max(root.scrollWidth, body.scrollWidth) > root.clientWidth
        })
        expect(overflowMobileConn, `폭 ${vp.width}px 모바일 커넥터에서 가로 스크롤 넘침이 없어야 함`).toBe(false)
      }
    }
  })

  test('업무 도구 연결: 검색 필터링, 탭 전환, 상세 모달 및 일정 파일 가져오기 모달 상호작용', async ({ page }) => {
    await page.goto('/?controls=1&view=connectors')

    // 1. 헤더 및 초기 카탈로그 로드 확인 (실제 h1 title: '업무 도구 연결')
    await expect(page.getByRole('heading', { level: 1, name: '업무 도구 연결' })).toBeVisible()
    const searchInput = page.getByPlaceholder(/검색/)
    await expect(searchInput).toBeVisible()

    // 2. 검색 기능 검증 (구글 캘린더 검색)
    await searchInput.fill('구글')
    await expect(page.getByText('구글 캘린더').first()).toBeVisible()
    await expect(page.getByText('지메일').first()).toBeVisible()

    // 검색어 지우기
    await searchInput.fill('')

    // 3. 탭 전환 검증: '연결됨' 탭
    const connectedTab = page.getByRole('tab', { name: '연결됨' })
    await connectedTab.click()
    await expect(page.getByText('인스타그램').first()).toBeVisible()
    await expect(page.getByText('스레드').first()).toBeVisible()

    // '사용 가능' 탭 복귀
    const availableTab = page.getByRole('tab', { name: '사용 가능' })
    await availableTab.click()

    // 4. 상세 모달 열기 및 닫기 / 포커스 트랩
    const detailBtn = page.getByRole('button', { name: /구글 캘린더.*상세/ })
    await detailBtn.click()

    const detailDialog = page.getByRole('dialog')
    await expect(detailDialog).toBeVisible()

    // ESC 키로 닫기
    await page.keyboard.press('Escape')
    await expect(detailDialog).not.toBeVisible()

    // 5. 애플 캘린더 일정 파일 모달 열기 및 닫기
    const appleConnectBtn = page.getByRole('button', { name: /애플 캘린더.*연결/ })
    if (await appleConnectBtn.count() > 0) {
      await appleConnectBtn.click()
      const icsDialog = page.getByRole('dialog')
      await expect(icsDialog).toBeVisible()

      // 모달 닫기
      await page.keyboard.press('Escape')
      await expect(icsDialog).not.toBeVisible()
    }
  })

  test('설정 레이아웃 (SettingsMasterLayout): 중복 사이드바 부재 및 실제 레이아웃 복귀 링크 검증', async ({ page }) => {
    await page.goto('/?controls=1&view=settings')

    // 1. 중복 세로 사이드바(이전 360px 메뉴) 부재 확인
    await expect(page.getByRole('navigation', { name: '설정 메뉴' })).not.toBeVisible()

    // 2. 실제 SettingsMasterLayout 컴포넌트가 제공하는 정품 복귀 링크 확인
    const realBackLink = page.getByRole('link', { name: '설정 홈' })
    await expect(realBackLink).toBeVisible()
    await expect(realBackLink).toHaveAttribute('href', '/app/system')
    await expect(realBackLink).toHaveAttribute('aria-label', '설정 홈으로 이동')

    // 3. 설정 상세 본문 landmark 확인
    await expect(page.getByRole('region', { name: '설정 상세 내용' })).toBeVisible()
  })

  test('설정 개요 (실제 SettingsOverview 컴포넌트): 5대 그룹 및 운영/단일 요금제 링크 검증', async ({ page }) => {
    await page.goto('/?controls=1&view=overview')

    // 1. 실제 헤더 확인
    await expect(page.getByRole('heading', { level: 1, name: '설정' })).toBeVisible()

    // 2. 소희 활동과 안전 설정 섹션 확인
    await expect(page.getByRole('region', { name: '소희 활동과 안전 설정' })).toBeVisible()
    await expect(page.getByRole('link', { name: '운영 현황 보기' })).toHaveAttribute('href', '/app/system?section=status')

    // 3. 5대 설정 그룹 섹션 노출 확인
    await expect(page.getByRole('region', { name: '우리 가게' })).toBeVisible()
    await expect(page.getByRole('region', { name: '연결' })).toBeVisible()
    await expect(page.getByRole('region', { name: '요금·결제' })).toBeVisible()
    await expect(page.getByRole('region', { name: '알림·계정' })).toBeVisible()
    await expect(page.getByRole('region', { name: '도움' })).toBeVisible()

    // 4. 요금·결제 그룹 내 단일 요금제 및 결제 링크 확인 (중복 CTA 제거됨)
    const billingLink = page.getByRole('region', { name: '요금·결제' }).getByRole('link', { name: /요금제 및 결제/ })
    await expect(billingLink).toBeVisible()
    await expect(billingLink).toHaveAttribute('href', '/app/account/billing')
  })

  test('Task5: 과거 대화 다이얼로그 (뷰포트 내 bbox, 헤더 고정 스크롤, 포커스 트랩 루프, ESC/닫기 초점 복귀)', async ({ page }) => {
    await page.goto('/?controls=1&view=chat-history')

    // 1. '과거 대화' 실제 트리거 버튼 확인 및 클릭 (exact: true로 하네스 탭 버튼과 구분)
    const historyBtn = page.getByRole('button', { name: '과거 대화', exact: true })
    await expect(historyBtn).toBeVisible()
    await historyBtn.click()

    // 2. 다이얼로그 노출 확인
    const dialog = page.getByRole('dialog', { name: '과거 대화' })
    await expect(dialog).toBeVisible()

    // 3. 다이얼로그 bounding box가 뷰포트 내에 완전히 위치하는지 검증 (bottom <= viewport height)
    const bbox = await dialog.boundingBox()
    expect(bbox).not.toBeNull()
    if (bbox) {
      const viewport = page.viewportSize()!
      expect(bbox.x).toBeGreaterThanOrEqual(0)
      expect(bbox.y).toBeGreaterThanOrEqual(0)
      expect(bbox.width).toBeLessThanOrEqual(viewport.width + 1) // 오차 1px 허용
      expect(bbox.y + bbox.height).toBeLessThanOrEqual(viewport.height + 1)
    }

    // 4. 초기 초점: 닫기 버튼이 초기 포커스되는지 확인
    const closeBtn = dialog.getByRole('button', { name: '과거 대화 닫기' })
    const newChatBtn = dialog.getByRole('button', { name: '새 대화 시작' })
    await expect(closeBtn).toBeVisible()
    await expect(newChatBtn).toBeVisible()
    await expect(closeBtn).toBeFocused()

    // 5. 키보드 포커스 트랩 루프 검증:
    // (a) closeBtn에서 Shift+Tab -> DOM상 앞선 newChatBtn으로 이동
    await page.waitForTimeout(100)
    await page.keyboard.press('Shift+Tab')
    await expect(newChatBtn).toBeFocused()

    // (b) newChatBtn(첫번째 요소)에서 Shift+Tab -> dialog의 마지막 포커스 가능 요소로 순환 (onKeyDown 트랩 핸들러 검증)
    await page.keyboard.press('Shift+Tab')
    const lastElementFocused = await page.evaluate(() => {
      const dialogEl = document.querySelector('section[role="dialog"][aria-label="과거 대화"]')
      const focusable = Array.from(dialogEl?.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])
      return document.activeElement === focusable.at(-1)
    })
    expect(lastElementFocused, '첫번째 요소에서 Shift+Tab 시 다이얼로그 마지막 요소로 순환되어야 함').toBe(true)

    // (c) 마지막 요소에서 Tab -> newChatBtn(첫번째 요소)로 순환 (onKeyDown 트랩 핸들러 검증)
    await page.keyboard.press('Tab')
    await expect(newChatBtn).toBeFocused()

    // 6. 고정 헤더 스크롤 분리 검증 (실제 threadScroller 요소 확인 및 스크롤)
    const scroller = dialog.locator('div[class*="threadScroller"]')
    await expect(scroller).toHaveCount(1)

    // 내부 스크롤 실행
    await scroller.evaluate((el) => {
      el.scrollTop = 400
    })
    const scrolledTop = await scroller.evaluate((el) => el.scrollTop)
    expect(scrolledTop, '내부 목록 컨테이너가 정상적으로 스크롤되어야 함').toBeGreaterThan(0)

    // 스크롤 후에도 상단 고정 헤더(닫기 버튼)가 시각적으로 고정 유지되는지 검증
    await expect(closeBtn).toBeVisible()
    const closeBtnBbox = await closeBtn.boundingBox()
    expect(closeBtnBbox).not.toBeNull()
    if (closeBtnBbox) {
      expect(closeBtnBbox.y).toBeLessThan(120) // 상단 고정 영역 내 유지
    }

    // 7. ESC 키로 닫기 동작 및 트리거 버튼으로 초점 복귀 검증
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(historyBtn).toBeFocused()

    // 8. 닫기 버튼 직접 클릭 시에도 동일하게 트리거 버튼으로 초점 복귀 검증
    await historyBtn.click()
    await expect(dialog).toBeVisible()
    await expect(closeBtn).toBeFocused()
    await closeBtn.click()
    await expect(dialog).not.toBeVisible()
    await expect(historyBtn).toBeFocused()
  })

  test('다크모드 및 200% 텍스트 줌 시각 검증 및 가로 오버플로우 없음 (root computed font size actual 200%)', async ({ page }) => {
    await page.goto('/?controls=1&view=settings')

    // 1. 다크 모드 토글
    const darkToggle = page.getByTestId('toggle-dark-mode')
    await darkToggle.click()
    await expect(page.locator('html')).toHaveClass(/dark/)

    // 2. 200% 텍스트 줌 토글
    const zoomToggle = page.getByTestId('toggle-zoom')
    await zoomToggle.click()

    // 200% 확대 실제 computed font-size 검증
    const { inlineStyleFontSize, computedFontSize } = await page.evaluate(() => {
      const root = document.documentElement
      return {
        inlineStyleFontSize: root.style.fontSize,
        computedFontSize: parseFloat(window.getComputedStyle(root).fontSize),
      }
    })
    expect(inlineStyleFontSize).toBe('200%')
    // 기본 브라우저 16px 기준 200%면 computed font size는 32px (또는 30px 이상)
    expect(computedFontSize).toBeGreaterThanOrEqual(30)

    // 가로 스크롤 오버플로우 발생 여부 확인
    const hasOverflow = await page.evaluate(() => {
      const root = document.documentElement
      return root.scrollWidth > root.clientWidth
    })
    expect(hasOverflow, '다크모드 200% 확대에서도 가로 넘침이 발생하지 않아야 함').toBe(false)
  })

  test('가게 정보에서 실제 채널 학습 패널과 44px 입력을 제공한다', async ({ page }) => {
    await page.goto('/app/settings/business?controls=1#channel-learning')
    await expect(page.getByRole('heading', { name: '가게 기본 정보', exact: true })).toBeVisible()
    const section = page.getByRole('region', { name: '가게 정보의 채널 학습', exact: true })
    await expect(section.getByRole('heading', { name: '공식 채널 지식 학습', exact: true })).toBeVisible()
    const input = section.locator('#channel-url-input')
    await expect(input).toBeVisible()
    expect((await input.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    const register = section.getByRole('button', { name: '채널 등록하기', exact: true })
    await expect(register).toBeDisabled()
    expect((await register.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test('접근성 (Axe WCAG 2A/AA/2.1AA): 설정 및 커넥터 화면 Critical/Serious 위반 0건', async ({ page }) => {
    // 1. 설정 레이아웃 접근성 검사
    await page.goto('/?controls=1&view=settings')
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('[role="banner"]')

    const settingsAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    const settingsCriticalSerious = settingsAxe.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )
    expect(settingsCriticalSerious).toEqual([])

    // 2. 커넥터 허브 접근성 검사
    await page.goto('/?controls=1&view=connectors')
    await page.waitForLoadState('networkidle').catch(() => {})
    await page.waitForSelector('[role="banner"]')

    const connectorsAxe = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze()

    const connectorsCriticalSerious = connectorsAxe.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious'
    )
    expect(connectorsCriticalSerious).toEqual([])
  })
})
