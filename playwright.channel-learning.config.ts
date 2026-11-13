import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.CHANNEL_LEARNING_BASE_URL ?? 'http://localhost:3196'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /channel-learning\.spec\.ts$/u,
  outputDir: './test-results/channel-learning/artifacts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/channel-learning/report.json' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'desktop-1280',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        locale: 'ko-KR',
      },
    },
    {
      name: 'mobile-390',
      use: {
        ...devices['iPhone 14'],
        viewport: { width: 390, height: 844 },
        locale: 'ko-KR',
      },
    },
  ],
})
