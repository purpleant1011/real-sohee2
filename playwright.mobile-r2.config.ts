import { defineConfig, devices } from '@playwright/test'

/**
 * Mobile R2 품질 게이트 전용 Playwright 설정 (W9).
 *
 * - 모바일 폭 5종(320/360/375/390/430) × 엔진 2종(iOS=WebKit, Android=Chromium) + Tablet/Desktop 회귀
 *   (768/820/1024/1280/1440 — ANI-1740 요구 폭).
 * - 기본은 이미 떠 있는 서버(MOBILE_R2_BASE_URL)를 사용한다. 서버를 직접 띄우려면 MOBILE_R2_START_SERVER=1.
 * - 증거는 evidence/mobile-r2/<이슈ID>/ 규약을 따른다 (evidence/mobile-r2/README.md).
 * - 실결제·실발송·프로덕션 쓰기는 이 설정에서 수행하지 않는다. 외부 오리진 차단은 support/gates.ts 의 blockExternalOrigins 가 담당한다.
 */
export function resolveMobileR2Port(value = process.env.MOBILE_R2_PORT): number {
  if (!value || !/^\d+$/u.test(value)) return 3200
  const port = Number(value)
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : 3200
}

const port = resolveMobileR2Port()
const baseURL = process.env.MOBILE_R2_BASE_URL ?? `http://127.0.0.1:${port}`
const startServer = process.env.MOBILE_R2_START_SERVER === '1'

export const MOBILE_WIDTHS = [320, 360, 375, 390, 430] as const
const MOBILE_HEIGHT = 844

type Engine = 'ios' | 'android'

/** ANI-1740 회귀 폭: 390(모바일) · 768 · 820 · 1024 · 1280 · 1440 */
const DESKTOP_WIDTHS = [
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'tablet-820', width: 820, height: 1180 },
  { name: 'desktop-1024', width: 1024, height: 768 },
  { name: 'desktop-1280', width: 1280, height: 800 },
  { name: 'desktop-1440', width: 1440, height: 900 },
] as const

function desktopProject(name: string, width: number, height: number) {
  return {
    name,
    testMatch: /.*\.desktop\.spec\.ts$/u,
    use: { ...devices['Desktop Chrome'], viewport: { width, height } },
    metadata: { engine: 'chromium', width },
  }
}

function mobileProject(engine: Engine, width: number) {
  const base = engine === 'ios' ? devices['iPhone 14'] : devices['Pixel 7']
  return {
    name: `${engine}-${width}`,
    testMatch: /.*\.mobile\.spec\.ts$/u,
    use: {
      ...base,
      viewport: { width, height: MOBILE_HEIGHT },
      // 폰트 확대/축소는 개별 spec 에서 page.emulateMedia 및 CSS 로 별도 시험한다.
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
    },
    metadata: { engine, width },
  }
}

export default defineConfig({
  testDir: './tests/e2e/mobile-r2',
  // HTML 리포터가 outputDir 를 비우므로 산출물은 하위 폴더에 둔다.
  outputDir: './test-results/mobile-r2/artifacts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
  // 기준선 경로는 __baselines__/<project>/<name>.png 로 고정한다.
  // testFilePath 를 넣으면 스펙 파일명이 디렉터리로 끼어들어 규약(evidence/mobile-r2/README.md)과 어긋난다.
  snapshotPathTemplate: '{testDir}/__baselines__/{projectName}/{arg}{ext}',
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/mobile-r2/report.json' }],
    ['html', { outputFolder: 'test-results/mobile-r2/html', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: startServer
    ? {
        command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
        url: baseURL,
        timeout: 240_000,
        reuseExistingServer: true,
        env: {
          NEXT_PUBLIC_SUPABASE_URL:
            process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://your-project-ref.supabase.co',
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
            process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_test_dummy',
          APP_URL: baseURL,
          E2E_APP_SHELL_FIXTURE: '1',
        },
      }
    : undefined,
  projects: [
    ...MOBILE_WIDTHS.map((w) => mobileProject('ios', w)),
    ...MOBILE_WIDTHS.map((w) => mobileProject('android', w)),
    ...DESKTOP_WIDTHS.map((p) => desktopProject(p.name, p.width, p.height)),
  ],
})
