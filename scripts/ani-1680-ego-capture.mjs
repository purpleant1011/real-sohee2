/**
 * ANI-1680 M06/M07 화면 회귀 증거 캡처 — ego-browser 전용.
 *
 * 일회용 Playwright 스크립트는 F절(브라우저 작업은 ego-browser) 위반으로 철회했고,
 * 같은 화면을 ego-browser 의 문서화된 API 만으로 다시 찍는다. Playwright 를 import 하지 않는다.
 *
 * 실행(체크아웃 루트 기준, 파일 URL 은 이 체크아웃의 절대 경로):
 *   ego-browser nodejs -e "await import('file:///ABSOLUTE/scripts/ani-1680-ego-capture.mjs')"
 *
 * 전제:
 *   - 개발 서버가 떠 있어야 한다. `npx next dev --webpack -p 4012`
 *   - `/dev/mobile-r2/start-approve` 는 개발 전용 하네스다(운영 404).
 *   - 각 캡처는 기대 화면을 함께 선언하고, 다르면 exit 1 로 실패한다.
 */
const fs = await import('node:fs/promises')
const path = await import('node:path')
const { fileURLToPath } = await import('node:url')

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(REPO_ROOT, 'evidence', 'mobile-r2', 'ANI-1680', '20261024')
const BASE = 'http://127.0.0.1:4012'
const SPACE = 'ani-1680-ego-evidence'
const NARROW_MAX_WIDTH = 767

const targets = [
  { project: 'android-390', width: 390, height: 844, deviceScaleFactor: 2, mobile: true },
  { project: 'android-320', width: 320, height: 844, deviceScaleFactor: 2, mobile: true },
  { project: 'desktop-1280', width: 1280, height: 800, deviceScaleFactor: 1, mobile: false },
]

/** expect(facts, width) → 위반 사유 배열. 비어 있으면 통과. */
const pages = [
  {
    name: 'm07-approve-flag-on',
    path: '/dev/mobile-r2/start-approve?r2=1&screen=approve',
    // 폭에 따라 기대 화면이 다르다: 좁은 화면은 R2 승인, 768px 초과는 R1 분기.
    waitFor: (width) => (width <= NARROW_MAX_WIDTH ? '게시 전 최종 확인' : '기존 작업 상세 화면(R1)'),
    note: 'R2 승인 화면(고정 스냅샷). 좁은 화면에서만 R2, 768px 초과는 R1 분기.',
    expect: (facts, width) =>
      width <= NARROW_MAX_WIDTH
        ? [
            facts.approveUi ? null : '좁은 화면인데 R2 승인 화면이 없다',
            facts.legacyUi ? '좁은 화면인데 R1 자리표시자가 떴다' : null,
          ].filter(Boolean)
        : [
            facts.approveUi ? '넓은 화면인데 R2 승인 화면을 그렸다' : null,
            facts.legacyUi ? null : '넓은 화면인데 R1 분기가 아니다',
          ].filter(Boolean),
  },
  {
    name: 'm07-approve-flag-off',
    path: '/dev/mobile-r2/start-approve?screen=approve',
    waitFor: '기존 작업 상세 화면(R1)',
    note: '플래그 OFF — 모든 폭에서 R2 승인 화면을 그리지 않고 R1 로 남는다.',
    expect: (facts) => [
      facts.approveUi ? '플래그 OFF 인데 R2 승인 화면을 그렸다' : null,
      facts.legacyUi ? null : '플래그 OFF 인데 R1 분기가 아니다',
    ].filter(Boolean),
  },
  {
    name: 'm06-firstpost-guard-on',
    path: '/dev/mobile-r2/start-approve?r2=1&screen=firstpost',
    waitFor: '이번에 무엇을 알릴까요',
    note: '플래그 ON — 서버가 확인한 workspaceId 로 첫 포스팅 진입 화면(폭 무관).',
    expect: (facts) => [
      facts.firstPostUi ? null : '플래그 ON 인데 첫 포스팅 진입 화면이 없다',
      facts.legacyUi ? '플래그 ON 인데 R1 자리표시자가 떴다' : null,
    ].filter(Boolean),
  },
  {
    name: 'm06-firstpost-guard-off',
    path: '/dev/mobile-r2/start-approve?screen=firstpost',
    waitFor: '기존 작업 상세 화면(R1)',
    note: '플래그 OFF — 첫 포스팅 진입 화면을 그리지 않는다(실라우트는 404, 진입점은 R1).',
    expect: (facts) => [
      facts.firstPostUi ? '플래그 OFF 인데 첫 포스팅 진입 화면을 그렸다' : null,
      facts.legacyUi ? null : '플래그 OFF 인데 R1 분기가 아니다',
    ].filter(Boolean),
  },
  {
    name: 'start-preview-r2-real-route-no-session',
    path: '/start/preview-r2',
    waitFor: '소희',
    note: '실라우트·로그인 세션 없음. /start 레이아웃이 시작 랜딩을 그리며 R2 화면을 새지 않는다. (404 분기 관찰 불가)',
    expect: (facts) => [
      facts.approveUi ? '세션 없이 R2 승인 화면이 떴다' : null,
      facts.firstPostUi ? '세션 없이 첫 포스팅 진입 화면이 떴다' : null,
      facts.legacyUi ? '실라우트에 하네스 자리표시자가 떴다' : null,
    ].filter(Boolean),
  },
]

const task = await taskSpace(SPACE)
// task.page(label) 은 이미 있는 페이지만 가리킨다. 실행마다 새 탭을 만든다
// (이전 실행이 남긴 닫힌 핸들을 재사용하면 "page was closed" 로 실패한다).
const page = await task.newPage()

// 콘솔 에러·전역 예외를 페이지 안에서 모은다(ego-browser 는 요청/콘솔 이벤트 리스너가 없다).
const consoleCaptureInstalled = await (async () => {
  const { identifier } = await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const bucket = { errors: [], startedAt: new Date().toISOString() };
      Object.defineProperty(window, '__ani1680Capture', { value: bucket, configurable: true });
      const originalError = console.error;
      console.error = (...args) => {
        try { bucket.errors.push(args.map((value) => String(value)).join(' ')); } catch (error) {}
        return originalError.apply(console, args);
      };
      window.addEventListener('error', (event) => bucket.errors.push('error: ' + String(event.message || event.error)));
      window.addEventListener('unhandledrejection', (event) => bucket.errors.push('unhandledrejection: ' + String(event.reason)));
    })();`,
  })
  return Boolean(identifier)
})()

await fs.mkdir(OUT, { recursive: true })

const results = []
for (const target of targets) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width: target.width,
    height: target.height,
    deviceScaleFactor: target.deviceScaleFactor,
    mobile: target.mobile,
  })

  for (const spec of pages) {
    let navigationError = null
    // 기대 화면 문구는 폭에 따라 달라질 수 있다(좁은 화면 R2 / 넓은 화면 R1).
    const needle = typeof spec.waitFor === 'function' ? spec.waitFor(target.width) : spec.waitFor
    try {
      // 개발 서버는 HMR 웹소켓을 계속 열어 두므로 networkidle 이 오지 않는다.
      // 문서 로드만 기다리고, 화면 준비는 아래 waitForFunction 으로 판정한다.
      await page.goto(BASE + spec.path, { waitUntil: 'load', timeout: 60_000 })
      await page.waitForFunction((text) => document.body.innerText.includes(text), needle, {
        timeout: 20_000,
      })
    } catch (error) {
      navigationError = String(error && error.message ? error.message : error)
    }

    const facts = await page.evaluate((base) => {
      const text = document.body.innerText
      const heading = document.querySelector('h1')?.textContent?.trim() ?? ''
      const buttons = [...document.querySelectorAll('button')]
      const last = buttons[buttons.length - 1]
      const rect = last ? last.getBoundingClientRect() : null
      const resourceUrls = performance.getEntriesByType('resource').map((entry) => entry.name)
      return {
        title: document.title,
        heading,
        url: location.href,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        legacyUi: Boolean(document.querySelector('[data-legacy-work-approve]')),
        approveUi: text.includes('게시 전 최종 확인') && buttons.length > 0,
        firstPostUi: text.includes('이번에 무엇을 알릴까요'),
        buttons: buttons.map((node) => node.textContent?.trim() ?? ''),
        buttonsClipped: buttons.filter((node) => {
          const box = node.getBoundingClientRect()
          return box.width > 0 && (box.left < -0.5 || box.right > window.innerWidth + 0.5)
        }).length,
        lastCtaBox: rect
          ? {
              text: last.textContent?.trim() ?? '',
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              bottom: Math.round(rect.bottom),
            }
          : null,
        // Next not-found 페이지는 h1 이 정확히 이 문장이다. 본문 전체 매칭은 자리표시자의 "404" 글자까지 걸린다.
        notFoundPage: heading === '페이지를 찾을 수 없습니다' || heading === 'This page could not be found',
        externalResourceUrls: resourceUrls.filter((url) => !url.startsWith(base)),
        resourceCount: resourceUrls.length,
        consoleErrors: (window.__ani1680Capture && window.__ani1680Capture.errors) ?? [],
      }
    }, BASE)

    const info = await page.info()
    const failures = spec.expect(facts, target.width)
    if (navigationError) failures.push(`내비게이션/대기 실패: ${navigationError}`)
    if (facts.externalResourceUrls.length > 0) failures.push(`외부 리소스 ${facts.externalResourceUrls.length}건`)
    if (facts.consoleErrors.length > 0) failures.push(`콘솔 에러 ${facts.consoleErrors.length}건`)
    if (facts.scrollWidth > facts.innerWidth) failures.push('가로 스크롤 발생')
    if (facts.buttonsClipped > 0) failures.push(`뷰포트 밖으로 잘린 버튼 ${facts.buttonsClipped}개`)
    if (facts.innerWidth !== target.width) failures.push(`뷰포트 폭 불일치(innerWidth=${facts.innerWidth})`)

    const pngPath = path.join(OUT, `${target.project}__${spec.name}.png`)
    await page.screenshot({ path: pngPath, fullPage: true })

    const record = {
      capturedAt: new Date().toISOString(),
      tool: 'ego-browser',
      project: target.project,
      viewport: {
        width: target.width,
        height: target.height,
        deviceScaleFactor: target.deviceScaleFactor,
        mobile: target.mobile,
      },
      // ego-browser 가 보고한 실제 뷰포트·스크롤(innerWidth 와 교차 확인용).
      reportedInfo: info ?? null,
      url: spec.path,
      // 이 폭에서 무엇이 보여야 하는지(대기 문구). 판정 기대와 함께 남긴다.
      waitFor: needle,
      note: spec.note,
      consoleCaptureInstalled,
      ...facts,
      failures,
      verdict: failures.length === 0 ? 'PASS' : 'FAIL',
      capture: 'ego-browser / dev server / fullPage',
    }
    await fs.writeFile(
      path.join(OUT, `${target.project}__${spec.name}.json`),
      JSON.stringify(record, null, 2) + '\n',
    )
    results.push({ file: `${target.project}__${spec.name}.png`, ...record })
  }
}

// 캡처가 끝나면 탭을 닫아 브라우저 메모리를 남기지 않는다.
try {
  await page.close()
} catch (error) {
  // 닫기 실패는 판정에 영향을 주지 않는다(이미 닫혔거나 앱이 종료 중).
}

console.log(
  JSON.stringify(
    results.map((record) => ({
      file: record.file,
      verdict: record.verdict,
      innerWidth: record.innerWidth,
      scrollWidth: record.scrollWidth,
      failures: record.failures,
    })),
    null,
    1,
  ),
)

if (results.some((record) => record.verdict !== 'PASS')) process.exitCode = 1
