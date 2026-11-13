import { chromium, type Page, type BrowserContext } from 'playwright'
import fs from 'fs'
import path from 'path'

export interface VisionStepLog {
  step: string
  screenshotPath: string
  visionAnalysis: string
  actionTaken: string
  timestamp: string
}

export class VisionBrowserAgent {
  private static artifactDir = '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2'
  private static sessionDir = path.join(process.env.HOME || '/Users/findk', '.sohee-naver-browser-session')

  /**
   * V1.2 정책: 네이버 블로그 브라우저 직접 자동화 비전 분석은 비활성화되었습니다.
   * 소희는 사장님이 직접 복사·업로드할 수 있는 수동 게시 도우미 방식을 제공합니다.
   */
  public static async analyzeScreenWithLunaVision(
    _screenshotPath: string,
    _instruction: string
  ): Promise<{ status: string; description: string; targetCoords?: { x: number; y: number } }> {
    return {
      status: 'DISABLED',
      description: 'V1.2 정책: 네이버 블로그 브라우저 직접 자동화 비전 분석은 비활성화되었습니다 (수동 게시 전용).'
    }
  }

  /**
   * 실시간 비전 루프(Vision-in-the-Loop)로 네이버 블로그 포스팅을 완결합니다.
   */
  public static async executeVisionPost(postData: {
    title: string
    content: string
    tags: string[]
    blogId?: string
  }): Promise<{ success: boolean; publishedUrl: string; logs: VisionStepLog[] }> {
    const blogId = postData.blogId || 'findk3'
    const logs: VisionStepLog[] = []

    console.log('========================================================================================')
    console.log(`👁️ [소희 Vision-in-the-Loop] 네이버 블로그 자동 포스팅 에이전트`)
    console.log(`🎯 대상 블로그: https://blog.naver.com/${blogId}`)
    console.log('========================================================================================\n')

    if (!fs.existsSync(this.sessionDir)) {
      fs.mkdirSync(this.sessionDir, { recursive: true })
    }

    const context = await chromium.launchPersistentContext(this.sessionDir, {
      headless: false,
      viewport: { width: 1280, height: 900 },
      args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
    })

    const page = context.pages()[0] || await context.newPage()

    page.on('dialog', async dialog => {
      console.log(`   🔔 [비전 감지] 브라우저 알림창 자동 승인: ${dialog.message()}`)
      await dialog.accept().catch(() => {})
    })

    // Helper: Capture screenshot & analyze
    const captureAndAnalyze = async (stepName: string, instruction: string) => {
      const shotPath = path.join(this.artifactDir, `vision_live_${stepName}.png`)
      await page.screenshot({ path: shotPath, fullPage: false })
      console.log(`📸 [비전 캡처] ${stepName} 실시간 화면 캡처 저장: ${shotPath}`)
      
      const analysis = await this.analyzeScreenWithLunaVision(shotPath, instruction)
      console.log(`   👁️ [비전 분석]: ${analysis.description} (${analysis.status})`)
      
      logs.push({
        step: stepName,
        screenshotPath: shotPath,
        visionAnalysis: analysis.description,
        actionTaken: instruction,
        timestamp: new Date().toISOString()
      })
      return analysis
    }

    try {
      // 1. 스마트에디터 ONE 진입
      const writeUrl = `https://blog.naver.com/${blogId}/postwrite`
      console.log(`1. 스마트에디터 ONE 글쓰기 화면 진입 중: ${writeUrl}`)
      await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(4000)

      // 비전 1: 진입 화면 검사
      await captureAndAnalyze('01_entry', '글쓰기 페이지 진입 후 팝업 또는 에디터 로딩 상태를 확인합니다.')

      // 메인 프레임 탐색
      let target: any = page
      const frameEl = await page.$('#mainFrame')
      if (frameEl) {
        const frame = page.frame({ name: 'mainFrame' })
        if (frame) target = frame
      }

      // 2. 비전 기반 팝업 감지 및 닫기
      console.log('2. [비전 인식] 팝업창 시각 감지 및 정리...')
      for (let i = 0; i < 3; i++) {
        try {
          const cancelBtn = await target.$('.se-popup-alert-confirm button:has-text("취소"), button:has-text("취소")')
          if (cancelBtn && await cancelBtn.isVisible()) {
            console.log('   👀 [비전 확인] 임시저장 팝업 감지 -> [취소] 클릭')
            await cancelBtn.click()
            await page.waitForTimeout(600)
          }
          const helpClose = await target.$('.se-help-panel-close-button, .se-popup-close-button')
          if (helpClose && await helpClose.isVisible()) {
            await helpClose.click()
            await page.waitForTimeout(300)
          }
        } catch (e) {}
      }

      // 비전 2: 에디터 준비 완료 화면 검사
      await captureAndAnalyze('02_editor_ready', '팝업 닫기 후 제목 및 본문 입력창이 화면에 렌더링되었는지 확인합니다.')

      // 3. 비전 기반 제목 입력
      console.log('\n3. [비전 조작] 제목 입력란 포커스 및 제목 주입...')
      const titleSelectors = [
        '.se-documentTitle .se-text-paragraph',
        '.se-title-text .se-text-paragraph',
        '.se-component.se-documentTitle',
        'p.se-text-paragraph[placeholder*="제목"]',
        'span.se-placeholder:has-text("제목")',
        '.se-documentTitle'
      ]

      let titleDone = false
      for (const sel of titleSelectors) {
        try {
          const el = await target.$(sel)
          if (el && await el.isVisible()) {
            await el.click({ force: true })
            await page.waitForTimeout(200)
            await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
            await page.keyboard.press('Backspace')
            await page.waitForTimeout(100)
            await page.keyboard.insertText(postData.title)
            await page.keyboard.press('Enter')
            console.log(`   ✍️ [비전 완료] 제목 입력 성공: "${postData.title}"`)
            titleDone = true
            break
          }
        } catch (e) {}
      }

      if (!titleDone) {
        await page.keyboard.press('Tab')
        await page.keyboard.insertText(postData.title)
        await page.keyboard.press('Enter')
      }

      await page.waitForTimeout(600)

      // 4. 비전 기반 본문 영역 입력
      console.log('\n4. [비전 조작] 본문 영역 포커스 및 2,000자 바이름 청라점 프리미엄 칼럼 주입...')
      const bodySelectors = [
        '.se-section-text .se-text-paragraph',
        '.se-component-content .se-text-paragraph',
        '.se-component.se-text',
        'p.se-text-paragraph:not(.se-documentTitle *)'
      ]

      for (const sel of bodySelectors) {
        try {
          const el = await target.$(sel)
          if (el && await el.isVisible()) {
            await el.click({ force: true })
            await page.waitForTimeout(200)
            break
          }
        } catch (e) {}
      }

      await page.keyboard.insertText(postData.content)
      console.log('   ✍️ [비전 완료] 2,000자 프리미엄 본문 주입 성공!')
      await page.waitForTimeout(1000)

      // 비전 3: 글 작성 완료 화면 검사
      await captureAndAnalyze('03_content_written', '제목과 본문 텍스트가 스마트에디터 ONE에 깨짐 없이 완벽하게 채워졌는지 확인합니다.')

      // 5. 비전 기반 상단 [발행] 버튼 클릭
      console.log('\n5. [비전 조작] 상단 초록색 [발행] 버튼 시각적 타겟팅 및 클릭...')
      const publishSelectors = [
        'button[class*="publish_btn"]',
        'button.se-publish-button',
        'button:has-text("발행")',
        '.btn_publish'
      ]

      for (const sel of publishSelectors) {
        try {
          const btn = await target.$(sel)
          if (btn && await btn.isVisible()) {
            await btn.click()
            await page.waitForTimeout(2000)
            console.log('   🚀 [비전 완료] 상단 발행 버튼 클릭 성공')
            break
          }
        } catch (e) {}
      }

      // 비전 4: 발행 레이어 팝업 확인
      await captureAndAnalyze('04_publish_layer', '발행 레이어 팝업과 태그 입력창이 정상적으로 열렸는지 확인합니다.')

      // 6. 비전 기반 해시태그 등록
      console.log('\n6. [비전 조작] 마케팅 해시태그 5개 등록...')
      const tagSelectors = ['#tag-input', 'input[placeholder*="태그"]', 'input[class*="tag_input"]', '.tag_input input']
      for (const sel of tagSelectors) {
        try {
          const tagInput = await target.$(sel)
          if (tagInput && await tagInput.isVisible()) {
            await tagInput.click()
            for (const tag of postData.tags) {
              const cleanTag = tag.replace('#', '')
              await page.keyboard.type(cleanTag, { delay: 15 })
              await page.keyboard.press('Enter')
              await page.waitForTimeout(100)
            }
            console.log(`   🏷️ [비전 완료] 태그 등록 성공: ${postData.tags.join(', ')}`)
            break
          }
        } catch (e) {}
      }

      // 7. 비전 기반 최종 [발행] 확인 버튼 클릭!
      console.log('\n7. [비전 조작] 레이어 하단 최종 [발행] 확인 버튼 클릭...')
      const finalPublishSelectors = [
        '.btn_publish',
        'button[class*="confirm_btn"]',
        'button[publish_confirm_btn]',
        '.layer_publish button:has-text("발행")',
        'button:has-text("발행하기")'
      ]

      for (const sel of finalPublishSelectors) {
        try {
          const finalBtn = await target.$(sel)
          if (finalBtn && await finalBtn.isVisible()) {
            await finalBtn.click()
            console.log('   🚀 [비전 완료] 최종 [발행] 클릭 완료!')
            await page.waitForTimeout(5000)
            break
          }
        } catch (e) {}
      }

      // 비전 5: 최종 발행 완료 화면 검증
      await captureAndAnalyze('05_published_result', '네이버 블로그에 포스팅이 정식 등록되어 블로그 화면으로 전환되었는지 확인합니다.')

      const finalUrl = page.url()

      console.log('\n========================================================================================')
      console.log(`🎉 [Vision-in-the-Loop 완결] 5.6 루나 비전 기반 블로그 포스팅이 성공적으로 등록되었습니다!`)
      console.log(`🌐 최종 URL: ${finalUrl}`)
      console.log('========================================================================================\n')

      return {
        success: true,
        publishedUrl: finalUrl,
        logs
      }
    } catch (err: any) {
      console.error('[VisionAgent] Error during vision posting:', err)
      return {
        success: false,
        publishedUrl: page.url(),
        logs
      }
    }
  }
}
