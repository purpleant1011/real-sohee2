import { expect, test, chromium } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

test('the packaged extension fills and submits the safe editor fixture once', async () => {
  const extensionPath = path.resolve('connector/chrome-extension/dist-test')
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), 'sohee-connector-'))
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chromium',
    headless: true,
    baseURL: 'http://127.0.0.1:3115',
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  try {
    const page = await context.newPage()
    await page.goto('/e2e-fixture/connector-editor')
    await expect(page.getByLabel('제목')).toHaveValue('승인된 제목')
    await expect(page.getByTestId('media-order')).toHaveText(
      '10000000-0000-4000-8000-000000000006,10000000-0000-4000-8000-000000000007',
    )
    await expect(page.getByTestId('submit-count')).toHaveText('1')
  } finally {
    await context.close()
    await rm(userDataDir, { recursive: true, force: true })
  }
})
