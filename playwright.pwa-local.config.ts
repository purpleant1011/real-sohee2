import { defineConfig, devices } from '@playwright/test'

// 임시 로컬 실행용 설정: 이미 떠 있는 프로덕션 빌드 서버(127.0.0.1:3100)에 붙는다.
// webServer 를 쓰지 않으므로 build+start 120초 타임아웃에 걸리지 않는다.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'pwa.spec.ts',
  use: {
    baseURL: 'http://127.0.0.1:3100',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
