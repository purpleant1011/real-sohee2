import { defineConfig } from '@playwright/test'

const port = 3115
const baseURL = `http://127.0.0.1:${port}`

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'chrome-extension-fixture.spec.ts',
  timeout: 30_000,
  use: { baseURL, trace: 'on-first-retry' },
  webServer: {
    command: `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    timeout: 120_000,
    reuseExistingServer: false,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_dummy',
      APP_URL: baseURL,
      E2E_APP_SHELL_FIXTURE: '1',
    },
  },
  workers: 1,
})
