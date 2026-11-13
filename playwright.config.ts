import { defineConfig, devices } from '@playwright/test'

export function resolveE2EPort(value = process.env.E2E_APP_PORT): number {
  if (!value || !/^\d+$/u.test(value)) return 3100
  const port = Number(value)
  return Number.isSafeInteger(port) && port > 0 && port <= 65535 ? port : 3100
}

const port = resolveE2EPort()
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    // 프로덕션 빌드(Next 16 + Cloudflare 어댑터)는 콜드 빌드에서 2분을 넘긴다.
    // 120초로 두면 서버 기동 실패가 "테스트 실패"처럼 보여 원인을 흐린다.
    timeout: 300_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_test_dummy',
      APP_URL: baseURL,
      E2E_APP_SHELL_FIXTURE: '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // PWA 오프라인 보안 스펙(ANI-1727)은 설치형 두 엔진 + 데스크톱 회귀를 모두 본다.
    // 위 chromium 프로젝트가 데스크톱 회귀를 맡고, 아래 두 프로젝트는 이 스펙만 추가로 실행한다
    // (다른 스펙까지 phone 뷰포트로 돌려 CI 를 세 배로 늘리지 않는다).
    // WebKit 프로젝트는 `npx playwright install webkit` 이 필요하다(mobile-r2 게이트 이미지에는 포함).
    {
      name: 'android-chrome',
      testMatch: /mobile-r2-pwa\.spec\.ts$/,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'ios-safari',
      testMatch: /mobile-r2-pwa\.spec\.ts$/,
      use: { ...devices['iPhone 14'] },
    },
  ],
})
