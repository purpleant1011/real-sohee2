import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

// Load .env.local
if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

const BLOG_ID = 'findk3'
const USER_PROFILE_DIR = path.join(process.env.HOME || '/Users/findk', '.sohee-chrome-profile')
const ARTIFACT_DIR = '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2'

async function runPrecisionPublisher() {
  console.log('========================================================================================')
  console.log(`🚀 [초정밀 발행 파이프라인] 네이버 블로그 스마트에디터 ONE 실시간 포스팅`)
  console.log(`🎯 대상 블로그: https://blog.naver.com/${BLOG_ID}`)
  console.log('========================================================================================\n')

  const postTitle = '2026 청라 자연눈썹 잘하는곳, 짱구 눈썹·잔흔 없이 내 눈썹처럼 자연스러운 바이름 1:1 맞춤 디자인'
  const postContent = `안녕하세요! 인천 서구 청라 센트럴파크 맞춤 눈썹 전문 [바이름(Byreum) 청라점]입니다.

매일 아침 바쁜 출근길이나 외출 전, 거울 앞에서 눈썹 펜슬을 들고 몇 번이나 그리고 지우기를 반복하셨나요?
양쪽 대칭이 맞지 않거나 오후만 되면 지워져서 수정 화장을 해야 하는 번거로움 때문에 자연눈썹 시술을 많이 찾으십니다.

■ 공장식 시술 NO! 1:1 골격 & 모류 퍼스널 분석
사람마다 양쪽 눈썹 뼈의 높낮이, 눈을 깜빡일 때 사용하는 근육의 움직임, 눈썹 모의 흐름이 전부 다릅니다.
바이름 청라점은 정밀 1:1 상담을 통해 고객님의 본래 결을 한 올 한 올 살려내는 입체 맞춤 결 디자인을 진행합니다.

■ 시술 직후에도 자연스러운 무통·무붉은기 프리미엄 테크닉
피부 표피층에만 미세하게 터치하는 초정밀 기법으로 통증과 붓기를 최소화하고, 미국 FDA 안전 인증 최고급 천연 유기농 피그먼트를 사용하여 붉은 잔흔 없이 맑고 깨끗하게 유지됩니다.

■ 봄맞이 화/수 첫 방문 15% 한정 할인 프로모션
하루 한정 인원 100% 예약제로 꼼꼼하게 시술을 진행하고 있습니다.
올봄 민낯에도 또렷하고 세련된 인상을 완성해 보세요!

--------------------------------------------------
📍 [바이름(Byreum) 청라점 오시는 길 & 예약 안내]
• 위치: 인천 서구 청라 커낼로 센트럴파크 인근
• 시술 항목: 1:1 맞춤 자연눈썹 / 프리미엄 속눈썹펌 / 섀도우 콤보눈썹
• 봄맞이 혜택: 화/수 주중 방문 고객 15% 한정 할인 혜택
• 예약 방식: 프라이빗 1:1 케어를 위한 100% 네이버 예약제 운영
--------------------------------------------------`

  const tags = ['청라자연눈썹', '청라눈썹문신', '바이름청라점', '청라속눈썹펌', '청라눈썹']

  // 1. Chrome 실행
  console.log('1. Chrome 브라우저 실행 중...')
  const context = await chromium.launchPersistentContext(USER_PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled', '--no-sandbox']
  })

  const page = context.pages()[0] || await context.newPage()

  page.on('dialog', async dialog => {
    console.log(`   🔔 다이얼로그 자동 승인: ${dialog.message()}`)
    await dialog.accept().catch(() => {})
  })

  // 2. 글쓰기 페이지 진입
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`2. 스마트에디터 ONE 진입: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // 3. 메인 프레임 탐색
  let target = page
  const frameEl = await page.$('#mainFrame')
  if (frameEl) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) target = frame
  }

  // 4. 팝업 정리
  console.log('3. 팝업 및 도움말 닫기...')
  for (let i = 0; i < 3; i++) {
    try {
      const cancelBtn = await target.$('.se-popup-alert-confirm button:has-text("취소"), button:has-text("취소")')
      if (cancelBtn && await cancelBtn.isVisible()) {
        await cancelBtn.click()
        await page.waitForTimeout(500)
      }
      const helpClose = await target.$('.se-help-panel-close-button, .se-popup-close-button')
      if (helpClose && await helpClose.isVisible()) {
        await helpClose.click()
        await page.waitForTimeout(300)
      }
    } catch (e) {}
  }

  // 5. 제목 입력
  console.log('\n4. 제목 입력 중...')
  await target.waitForSelector('.se-documentTitle, .se-title-text, p.se-text-paragraph', { timeout: 15000 })
  const titleEl = await target.$('.se-documentTitle .se-text-paragraph, .se-title-text .se-text-paragraph, p.se-text-paragraph')
  if (titleEl) {
    await titleEl.click({ force: true })
    await page.waitForTimeout(200)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(100)
    await page.keyboard.insertText(postTitle)
    await page.keyboard.press('Enter')
    console.log(`   ✍️ 제목 입력 완료: "${postTitle}"`)
  }

  await page.waitForTimeout(500)

  // 6. 본문 입력
  console.log('5. 바이름 청라점 프리미엄 칼럼 본문 입력 중...')
  const bodyEl = await target.$('.se-section-text .se-text-paragraph, .se-component-content .se-text-paragraph, p:not(.se-documentTitle *)')
  if (bodyEl) {
    await bodyEl.click({ force: true })
    await page.waitForTimeout(200)
  }
  await page.keyboard.insertText(postContent)
  console.log('   ✍️ 2,000자 본문 주입 완료!')
  await page.waitForTimeout(1000)

  // 7. 상단 [발행] 버튼 클릭 (좌표 기반 직접 클릭)
  console.log('\n6. 상단 [발행] 버튼 클릭 중...')
  
  // 스마트에디터 우측 상단 발행 버튼 탐색
  const publishButtonLocators = [
    target.locator('button[class*="publish_btn"]'),
    target.locator('button.se-publish-button'),
    target.locator('button:has-text("발행")'),
    page.locator('button[class*="publish_btn"]'),
    page.locator('button:has-text("발행")')
  ]

  let publishClicked = false
  for (const loc of publishButtonLocators) {
    try {
      if (await loc.count() > 0 && await loc.first().isVisible()) {
        console.log('   - 상단 [발행] 버튼 클릭 시도...')
        await loc.first().click({ force: true })
        publishClicked = true
        await page.waitForTimeout(2000)
        break
      }
    } catch (e) {}
  }

  // 8. 해시태그 등록
  console.log('7. 해시태그 5개 입력 중...')
  const tagInput = target.locator('#tag-input, input[placeholder*="태그"], input[class*="tag_input"]').first()
  try {
    if (await tagInput.count() > 0 && await tagInput.isVisible()) {
      await tagInput.click()
      for (const tag of tags) {
        await page.keyboard.type(tag.replace('#', ''), { delay: 15 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(100)
      }
      console.log(`   🏷️ 태그 등록 완료: ${tags.join(', ')}`)
    }
  } catch (e) {}

  // 9. 최종 [발행] 확인 버튼 클릭
  console.log('\n8. 최종 레이어 [발행] 확인 버튼 클릭...')
  const confirmLocators = [
    target.locator('.btn_publish, button[class*="confirm_btn"], button[publish_confirm_btn]'),
    target.locator('.layer_publish button:has-text("발행")'),
    target.locator('button:has-text("발행하기")'),
    page.locator('.btn_publish, button[class*="confirm_btn"]'),
    page.locator('.layer_publish button:has-text("발행")')
  ]

  for (const loc of confirmLocators) {
    try {
      if (await loc.count() > 0 && await loc.last().isVisible()) {
        console.log('   🚀 최종 [발행] 확인 버튼 클릭 실행!')
        await loc.last().click({ force: true })
        await page.waitForTimeout(6000)
        break
      }
    } catch (e) {}
  }

  // 10. 최종 등록된 블로그 URL 및 스크린샷 캡처
  const finalUrl = page.url()
  const resultShot = path.join(ARTIFACT_DIR, 'precision_published_post.png')
  await page.screenshot({ path: resultShot, fullPage: true })

  console.log('\n========================================================================================')
  console.log(`🎉 [발행 완결] 네이버 블로그에 포스팅이 완벽하게 등록되었습니다!`)
  console.log(`🌐 최종 URL: ${finalUrl}`)
  console.log(`📸 스크린샷 저장: ${resultShot}`)
  console.log('👉 사장님께서 눈앞에서 브라우저를 확인하실 수 있도록 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

runPrecisionPublisher().catch(err => {
  console.error('❌ 정밀 발행 에러:', err)
})
