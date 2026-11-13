import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.BASE_URL ?? 'http://localhost:3193'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /navigation-ux\.spec\.ts$/u,
  outputDir: './test-results/navigation-ux/artifacts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/navigation-ux/report.json' }],
  ],
  use: {
    baseURL,
    browserName: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'mobile-320',
      use: {
        viewport: { width: 320, height: 640 },
        locale: 'ko-KR',
      },
    },
    {
      name: 'mobile-390',
      use: {
        viewport: { width: 390, height: 844 },
        locale: 'ko-KR',
      },
    },
    {
      name: 'mobile-480',
      use: {
        viewport: { width: 480, height: 800 },
        locale: 'ko-KR',
      },
    },
    {
      name: 'tablet-768',
      use: {
        viewport: { width: 768, height: 1024 },
        locale: 'ko-KR',
      },
    },
    {
      name: 'desktop-1440',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        locale: 'ko-KR',
      },
    },
  ],
})
