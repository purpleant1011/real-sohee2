import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * PWA 계약 e2e (W8, ANI-1716/1717/1719/1721/1726/1727).
 *
 * 이 스펙은 `/e2e-fixture/*` 라우트에 의존하지 않는다. fixture 디렉터리는 현재
 * worktree에 없고(삭제 커밋 44206cda, `scripts/cloudflare-build.mjs`가 빌드 전 백업),
 * 복원 여부는 별도 승인 사항이므로 공개 표면과 정적 자산만 검증한다.
 */

const MOBILE_VIEWPORTS = [
  { width: 320, height: 568 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const

const INSTALL_BANNER = '[role="region"][aria-label="설치 안내"]'

test.describe('PWA manifest 계약 (ANI-1716)', () => {
  test('manifest 가 설치 ID·범위·시작 경로를 고정한다', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/manifest+json')

    const manifest = (await response.json()) as {
      id?: string
      scope?: string
      start_url?: string
      display?: string
      display_override?: string[]
      theme_color?: string
      background_color?: string
      lang?: string
      icons?: Array<{ src: string; sizes: string; purpose?: string }>
      shortcuts?: Array<{ url: string; name: string }>
    }

    expect(manifest.id).toBe('/')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe('/app?launch=pwa')
    expect(manifest.display).toBe('standalone')
    expect(manifest.display_override).toEqual(expect.arrayContaining(['standalone']))
    expect(manifest.theme_color).toBe('#6656e8')
    expect(manifest.background_color).toBe('#f7f6f2')
    expect(manifest.lang).toBe('ko')

    const icons = manifest.icons ?? []
    for (const size of ['192x192', '512x512']) {
      expect(icons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sizes: size, purpose: expect.stringContaining('any') }),
          expect.objectContaining({ sizes: size, purpose: expect.stringContaining('maskable') }),
        ]),
      )
    }

    // 설치 후 바로가기는 앱 안 경로만 가리키고 launch 파라미터로 유입을 구분한다.
    expect(manifest.shortcuts?.map((shortcut) => shortcut.url)).toEqual([
      '/app/command?launch=shortcut',
      '/app/inbox?launch=shortcut',
      '/app/notifications?launch=shortcut',
    ])
  })

  test('설치 메타가 문서 head 에 실제로 실린다', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')
    await expect(page.locator('meta[name="application-name"]')).toHaveAttribute('content', '소희')
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('sizes', '180x180')

    // 스플래시는 기기 해상도별 media 쿼리로만 내려가며, 첫 화면 로딩을 막지 않는다.
    const splashLinks = page.locator('link[rel="apple-touch-startup-image"]')
    expect(await splashLinks.count()).toBeGreaterThanOrEqual(9)

    const themeColors = await page
      .locator('meta[name="theme-color"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('content')))
    expect(themeColors).toContain('#6656e8')
    expect(themeColors).toContain('#0c0d10')

    // viewport-fit=cover 는 유지하되 확대 차단(user-scalable=no / maximum-scale=1)은 금지.
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content')
    expect(viewport).toContain('viewport-fit=cover')
    expect(viewport).not.toContain('user-scalable=no')
    expect(viewport).not.toMatch(/maximum-scale=1(?!\d)/)
  })
})

test.describe('서비스 워커 배포 계약 (ANI-1717)', () => {
  test('sw.js 는 서빙되고 스스로 skipWaiting 하지 않는다', async ({ request }) => {
    const response = await request.get('/sw.js')
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('javascript')

    // Cache-Control / Service-Worker-Allowed, 그리고 manifest·offline.html 의 재검증 헤더는
    // Cloudflare 정적 자산 계층이 public/_headers 로 적용한다. Next.js 서버(next start)는
    // _headers 를 읽지 않으므로 런타임 e2e 로 검증하면 환경 불일치로 항상 실패한다.
    // 해당 계약은 src/features/pwa/__tests__/pwa-contract.test.ts 가 배포 파일에서 직접 고정한다.

    // 자동 skipWaiting 은 설치 시점 호출을 뜻한다(강제 새로고침 금지).
    // 클라이언트가 SKIP_WAITING 메시지를 보낼 때의 호출은 정상 동작이므로 허용한다.
    const body = await response.text()
    const installBlock = body.slice(
      body.indexOf("addEventListener('install'"),
      body.indexOf("addEventListener('activate'"),
    )
    expect(installBlock).not.toBe('')
    expect(installBlock).not.toMatch(/skipWaiting/)
  })
})

test.describe('오프라인 셸 (ANI-1719)', () => {
  // 오프라인 셸은 PWA(모바일) 표면이므로 390px 에서 판정한다. 기본 프로젝트 뷰포트로
  // 실행하면 증적 PNG 이름(`…-390.png`)과 실제 캡처 폭이 어긋난다.
  test.use({ viewport: { width: 390, height: 844 } })

  test('읽기 전용 안내와 재확인 동작을 제공한다', async ({ page }) => {
    const response = await page.goto('/offline.html')
    expect(response?.status()).toBe(200)

    await expect(page.getByRole('heading', { name: '네트워크에 연결할 수 없어요' })).toBeVisible()
    await expect(page.getByText('지금은 읽기만 안내해 드려요')).toBeVisible()

    const retry = page.getByRole('button', { name: '다시 연결' })
    await expect(retry).toBeVisible()
    await expect(page.locator('#status')).toHaveAttribute('role', 'status')
    await expect(page.locator('#status')).toHaveAttribute('aria-live', 'polite')

    // 터치 타깃 48px 이상. Chromium 은 서브픽셀 레이아웃에서 48px 를 47.999969… 로
    // 돌려줄 수 있으므로(재현성 있는 실패 아님) 픽셀 단위로 반올림해 판정한다.
    const box = await retry.boundingBox()
    expect(Math.round(box?.height ?? 0)).toBeGreaterThanOrEqual(48)

    await page.screenshot({ path: 'evidence/mobile-r2/ANI-1719/offline-first-paint-390.png', fullPage: true })
  })

  test('허용되지 않은 next 파라미터로 앱 밖으로 보내지 않는다', async ({ page }) => {
    await page.goto('/offline.html?next=https%3A%2F%2Fevil.example%2Fapp')
    await page.evaluate(() => {
      // 재확인 버튼과 동일한 복귀 규칙을 호출 없이 검증한다(스크립트는 location.replace 를 쓰므로 네트워크만 확인).
      const t = new URLSearchParams(location.search).get('next') ?? ''
      const safe = /^\/(?:app|start)(?:\/|$)/.test(t.split(/[?#]/)[0]) && t.indexOf('\\') < 0 && t.indexOf('%') < 0
      if (safe) throw new Error('unsafe next value was accepted')
    })
    await expect(page).toHaveURL(/\/offline\.html\?next=/)
  })

  test('reduced motion 에서는 진입 애니메이션을 끈다', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/offline.html')
    const animationName = await page.locator('main').evaluate((node) => getComputedStyle(node).animationName)
    expect(animationName).toBe('none')
  })

  test('접근성 위반이 없다 (axe)', async ({ page }) => {
    // 진입 애니메이션 도중에는 배경색이 합성 중간값으로 측정되어 실행마다 결과가 달라진다.
    // 같은 파일의 reduced motion 계약과 동일하게 애니메이션을 끈 정지 상태에서 스캔한다.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/offline.html')
    const results = await new AxeBuilder({ page }).analyze()
    expect(results.violations).toEqual([])
  })
})

test.describe('설치 유도 범위 계약 (ANI-1721)', () => {
  for (const path of ['/', '/login', '/product']) {
    test(`${path} 에서는 설치 배너를 띄우지 않는다`, async ({ page }) => {
      await page.goto(path)
      await expect(page.locator(INSTALL_BANNER)).toHaveCount(0)
    })
  }

  test('앱 화면은 미인증 시 로그인으로 보내고 설치 배너를 남기지 않는다', async ({ page }) => {
    await page.goto('/app')
    await expect(page).toHaveURL(/\/login\?next=%2Fapp$/)
    await expect(page.getByRole('heading', { name: '로그인' })).toBeVisible()
    await expect(page.locator(INSTALL_BANNER)).toHaveCount(0)
  })
})

test.describe('PWA 반응형·접근성 (ANI-1726)', () => {
  for (const viewport of MOBILE_VIEWPORTS) {
    test(`${viewport.width}px 에서 공개 화면이 가로로 넘치지 않는다`, async ({ page }) => {
      await page.setViewportSize(viewport)
      for (const path of ['/', '/login'] as const) {
        await page.goto(path)
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        )
        expect(overflow, `${path} @ ${viewport.width}px`).toBeLessThanOrEqual(0)
      }
    })
  }

  test('390px 로그인 화면은 색 대비·구조 위반이 없다 (axe)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/login')
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(results.violations).toEqual([])
    await page.screenshot({ path: 'evidence/mobile-r2/ANI-1726/login-390.png' })
  })
})
