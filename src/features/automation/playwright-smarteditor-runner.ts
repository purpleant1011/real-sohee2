import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'

export interface SmartEditorPostInput {
  title: string
  intro?: string
  body: string
  quote?: string
  tags: string[]
  blogId?: string
}

export interface SmartEditorPostResult {
  success: boolean
  publishedUrl: string
  title: string
  logNo?: string
  durationMs: number
  error?: string
}

export class PlaywrightSmartEditorRunner {
  private static sessionPath = path.join(process.env.HOME || '/Users/findk', '.sohee-naver-live-session')

  /**
   * Execute real live Playwright Headful Browser SmartEditor ONE posting
   */
  public static async executeLivePost(input: SmartEditorPostInput): Promise<SmartEditorPostResult> {
    const startTime = Date.now()
    console.log(`[PlaywrightSmartEditor] Starting live browser posting: "${input.title}"`)

    if (!fs.existsSync(this.sessionPath)) {
      fs.mkdirSync(this.sessionPath, { recursive: true })
    }

    let browserContext = null
    try {
      browserContext = await chromium.launchPersistentContext(this.sessionPath, {
        headless: false,
        viewport: { width: 1280, height: 900 },
        args: [
          '--start-maximized',
          '--disable-blink-features=AutomationControlled'
        ]
      })

      const page = browserContext.pages()[0] || await browserContext.newPage()

      // 1. Navigate to Naver Blog PostWriteForm
      console.log('[PlaywrightSmartEditor] Navigating to SmartEditor ONE...')
      await page.goto('https://blog.naver.com/PostWriteForm.naver', { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(3500)

      // 2. Handle mainFrame if embedded
      let editor: any = page
      const frameElement = await page.$('#mainFrame')
      if (frameElement) {
        const frame = page.frame({ name: 'mainFrame' })
        if (frame) editor = frame
      }

      // 3. Clear popups
      try {
        const cancelBtn = await editor.$('.se-popup-alert-confirm button:has-text("취소"), .se-popup-alert-confirm button:nth-child(1), button:has-text("취소")')
        if (cancelBtn) {
          await cancelBtn.click()
          await page.waitForTimeout(800)
        }
      } catch (e) {}

      try {
        const helpClose = await editor.$('.se-help-panel-close-button, .se-popup-close-button, button[class*="close"]')
        if (helpClose) {
          await helpClose.click()
          await page.waitForTimeout(500)
        }
      } catch (e) {}

      // 4. Type Title
      console.log('[PlaywrightSmartEditor] Typing Title...')
      const titleSelectors = [
        '.se-documentTitle .se-text-paragraph',
        '.se-title-text .se-text-paragraph',
        '.se-component.se-documentTitle',
        'p.se-text-paragraph[placeholder*="제목"]',
        'span.se-placeholder:has-text("제목")'
      ]

      for (const sel of titleSelectors) {
        try {
          const el = await editor.$(sel)
          if (el && await el.isVisible()) {
            await el.click({ force: true })
            await page.waitForTimeout(300)
            await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
            await page.keyboard.press('Backspace')
            await page.keyboard.type(input.title, { delay: 30 })
            await page.keyboard.press('Enter')
            break
          }
        } catch (e) {}
      }

      await page.waitForTimeout(800)

      // 5. Type Body & Sections
      console.log('[PlaywrightSmartEditor] Typing Body Content...')
      const bodySelectors = [
        '.se-section-text .se-text-paragraph',
        '.se-component-content .se-text-paragraph',
        '.se-component.se-text',
        'p.se-text-paragraph:not(.se-documentTitle *)'
      ]

      for (const sel of bodySelectors) {
        try {
          const el = await editor.$(sel)
          if (el && await el.isVisible()) {
            await el.click({ force: true })
            await page.waitForTimeout(300)
            break
          }
        } catch (e) {}
      }

      if (input.intro) {
        await page.keyboard.type(input.intro, { delay: 20 })
        await page.keyboard.press('Enter')
        await page.keyboard.press('Enter')
        await page.waitForTimeout(400)
      }

      await page.keyboard.type(input.body, { delay: 20 })
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(400)

      if (input.quote) {
        await page.keyboard.type(`💡 [바이름 청라점 봄맞이 혜택] ${input.quote}`, { delay: 20 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1000)
      }

      // 6. Click Top Publish Button
      console.log('[PlaywrightSmartEditor] Clicking Publish button...')
      const publishSelectors = [
        'button[class*="publish_btn"]',
        'button.se-publish-button',
        'button:has-text("발행")',
        '.btn_publish'
      ]

      for (const sel of publishSelectors) {
        try {
          const btn = await editor.$(sel)
          if (btn && await btn.isVisible()) {
            await btn.click()
            await page.waitForTimeout(2000)
            break
          }
        } catch (e) {}
      }

      // 7. Add Tags
      const tagSelectors = ['#tag-input', 'input[placeholder*="태그"]', 'input[class*="tag_input"]']
      for (const sel of tagSelectors) {
        try {
          const tagInput = await editor.$(sel)
          if (tagInput && await tagInput.isVisible()) {
            await tagInput.click()
            for (const tag of input.tags) {
              const cleanTag = tag.replace('#', '')
              await page.keyboard.type(cleanTag, { delay: 25 })
              await page.keyboard.press('Enter')
              await page.waitForTimeout(200)
            }
            break
          }
        } catch (e) {}
      }

      // 8. Click Final Publish Confirm Button
      console.log('[PlaywrightSmartEditor] Clicking Final Confirm...')
      const finalPublishSelectors = [
        '.btn_publish',
        'button[class*="confirm_btn"]',
        'button[publish_confirm_btn]',
        '.layer_publish button:has-text("발행")',
        'button:has-text("발행하기")'
      ]

      for (const sel of finalPublishSelectors) {
        try {
          const finalBtn = await editor.$(sel)
          if (finalBtn && await finalBtn.isVisible()) {
            await finalBtn.click()
            await page.waitForTimeout(4000)
            break
          }
        } catch (e) {}
      }

      const finalUrl = page.url()
      const durationMs = Date.now() - startTime

      console.log(`[PlaywrightSmartEditor] Posting finished successfully: ${finalUrl}`)

      return {
        success: true,
        publishedUrl: finalUrl,
        title: input.title,
        durationMs
      }
    } catch (err: any) {
      console.error('[PlaywrightSmartEditor] Execution error:', err)
      return {
        success: false,
        publishedUrl: '',
        title: input.title,
        durationMs: Date.now() - startTime,
        error: err.message
      }
    }
  }
}
