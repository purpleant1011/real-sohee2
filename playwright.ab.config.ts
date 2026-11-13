import { defineConfig, devices } from '@playwright/test'

/**
 * W2 비주얼 A/B 검수 전용 설정 (ANI-1671).
 *
 * `playwright.config.ts`는 `npm run build && npm run start`(production)로 서버를 띄우는데,
 * A/B 검수 페이지는 운영 환경에서 404이므로 dev 서버를 사용한다.
 */
const port = 3111
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /mobile-r2-ab\.spec\.ts$/u,
  timeout: 90_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    timeout: 180_000,
    reuseExistingServer: true,
    env: {
      NEXT_PUBLIC_SUPABASE_URL:
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://your-project-ref.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_test_dummy',
      APP_URL: baseURL,
      // Next.js 개발 도구 배지('N 1 Issue')는 제품 UI가 아니면서 표시 여부가 실행마다 달라진다.
      // 증거 PNG에 섞이면 해시가 흔들리므로 개발 서버에서 끈다(next.config.ts의 기존 플래그).
      E2E_MOBILE_DECISION_FIXTURE: '1',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
