import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.SOHEE_LIVE_BASE_URL ?? process.env.E2E_BASE_URL ?? 'https://example.com'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-live',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
