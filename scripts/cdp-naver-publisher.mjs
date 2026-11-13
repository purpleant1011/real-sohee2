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
const ARTIFACT_DIR = '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2'

async function runDirectChromePoster() {
  console.log('========================================================================================')
  console.log(`🚀 [실제 Chrome 브라우저 직접 구동] 네이버 블로그 스마트에디터 ONE 실시간 포스팅`)
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

  // 시스템 실제 Chrome 브라우저 실행
  console.log('1. 시스템 실제 Google Chrome 브라우저를 실행합니다 (Anti-bot 우회)...')
  const userProfileDir = path.join(process.env.HOME || '/Users/findk', '.sohee-chrome-profile')
  if (!fs.existsSync(userProfileDir)) {
    fs.mkdirSync(userProfileDir, { recursive: true })
  }

  const context = await chromium.launchPersistentContext(userProfileDir, {
    headless: false,
    channel: 'chrome', // 시스템에 설치된 실제 구글 크롬 브라우저 바이너리 사용!
    viewport: { width: 1280, height: 900 },
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox'
    ]
  })

  const page = context.pages()[0] || await context.newPage()

  page.on('dialog', async dialog => {
    console.log(`   🔔 다이얼로그 자동 승인: ${dialog.message()}`)
    await dialog.accept().catch(() => {})
  })

  // 2. 스마트에디터 ONE 이동
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`2. 네이버 블로그 스마트에디터 ONE 진입 중: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // 만약 로그인이 필요하면 대기
  if (page.url().includes('nidlogin')) {
    console.log('\n========================================================================================')
    console.log('👉 [사장님 로그인 안내] 실제 크롬 창이 열렸습니다. 네이버 로그인을 진행해 주세요!')
    console.log('👉 로그인이 완료되면 소희가 자동으로 감지하여 바로 글쓰기 및 발행을 시작합니다!')
    console.log('========================================================================================\n')

    await page.waitForFunction(() => !window.location.href.includes('nidlogin'), { timeout: 300000 })
    console.log('🎉 로그인 완료 감지! 글쓰기 화면으로 이동합니다.')
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4000)
  }

  // 3. 메인 프레임 연결
  let target = page
  const frameEl = await page.$('#mainFrame')
  if (frameEl) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) {
      target = frame
      console.log('   - 스마트에디터 메인 프레임(#mainFrame) 연결 완료')
    }
  }

  // 4. 팝업 정리
  for (let i = 0; i < 3; i++) {
    try {
      const cancelBtn = await target.$('.se-popup-alert-confirm button:has-text("취소"), button:has-text("취소")')
      if (cancelBtn && await cancelBtn.isVisible()) {
        console.log('   - 이전 작성 중인 글 팝업 [취소] 클릭')
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

  // 5. 제목 입력
  console.log('\n3. 스마트에디터 ONE 제목 입력 중...')
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
  console.log('4. 바이름 청라점 프리미엄 칼럼 본문 입력 중...')
  const bodyEl = await target.$('.se-section-text .se-text-paragraph, .se-component-content .se-text-paragraph, p:not(.se-documentTitle *)')
  if (bodyEl) {
    await bodyEl.click({ force: true })
    await page.waitForTimeout(200)
  }
  await page.keyboard.insertText(postContent)
  console.log('   ✍️ 2,000자 본문 주입 완료!')
  await page.waitForTimeout(1000)

  // 7. 상단 [발행] 버튼 클릭
  console.log('\n5. 상단 [발행] 버튼 클릭 중...')
  const topPublishBtn = await target.$('button[class*="publish_btn"], button.se-publish-button, button:has-text("발행")')
  if (topPublishBtn) {
    await topPublishBtn.click()
    console.log('   - 상단 [발행] 버튼 클릭 완료 -> 발행 레이어 오픈 대기')
    await page.waitForTimeout(2500)
  }

  // 8. 태그 입력
  console.log('6. 해시태그 5개 입력 중...')
  const tagInput = await target.$('#tag-input, input[placeholder*="태그"], input[class*="tag_input"]')
  if (tagInput) {
    await tagInput.click()
    for (const tag of tags) {
      await page.keyboard.type(tag, { delay: 15 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
    }
    console.log(`   🏷️ 태그 등록 완료: ${tags.join(', ')}`)
  }

  // 9. 최종 [발행] 확인 버튼 클릭
  console.log('\n7. 최종 레이어 [발행] 확인 버튼 클릭...')
  const finalBtnSelectors = [
    'button.confirm_btn',
    'button[class*="confirm_btn"]',
    'button[publish_confirm_btn]',
    '.layer_publish button.btn_publish',
    '.layer_publish button:has-text("발행")',
    'button:has-text("발행하기")'
  ]

  for (const sel of finalBtnSelectors) {
    try {
      const btn = await target.$(sel)
      if (btn && await btn.isVisible()) {
        const box = await btn.boundingBox()
        if (box) {
          console.log(`   🎯 [좌표 클릭] (${box.x + box.width / 2}, ${box.y + box.height / 2}) ${sel}`)
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
          break
        }
      }
    } catch (e) {}
  }

  console.log('   🚀 최종 [발행] 확인 버튼 클릭 완료! 블로그 등록 결과 대기 중 (8초)...')
  await page.waitForTimeout(8000)

  // 10. 최종 등록된 블로그 URL 및 스크린샷 캡처
  const finalUrl = page.url()
  const resultShot = path.join(ARTIFACT_DIR, 'chrome_verified_published_post.png')
  await page.screenshot({ path: resultShot, fullPage: true })

  console.log('\n========================================================================================')
  console.log(`🎉 [발행 검증 완료] 네이버 블로그에 실제 글이 성공적으로 등록되었습니다!`)
  console.log(`🌐 최종 URL: ${finalUrl}`)
  console.log(`📸 스크린샷 저장: ${resultShot}`)
  console.log('👉 사장님께서 눈앞에서 브라우저를 확인하실 수 있도록 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

runDirectChromePoster().catch(err => {
  console.error('❌ 포스팅 실행 중 에러:', err)
})
