import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const SESSION_DIR = path.join(process.env.HOME || '/Users/findk', '.sohee-naver-browser-session')

async function inspectEditorPage() {
  const context = await chromium.launchPersistentContext(SESSION_DIR, { headless: false })
  const page = context.pages()[0] || await context.newPage()
  await page.goto('https://blog.naver.com/findk3/postwrite', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  console.log('Current URL:', page.url())
  const frames = page.frames().map(f => ({ name: f.name(), url: f.url() }))
  console.log('Frames:', frames)

  const elements = await page.$$eval('*', els => els.slice(0, 50).map(e => e.tagName + (e.className ? '.' + e.className : '')))
  console.log('Sample elements on page:', elements.slice(0, 20))

  await page.screenshot({ path: '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2/inspect_editor_page.png' })
  console.log('Screenshot saved to inspect_editor_page.png')
  await context.close()
}

inspectEditorPage().catch(console.error)
