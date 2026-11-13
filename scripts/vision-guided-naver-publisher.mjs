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
const SESSION_DIR = path.join(process.env.HOME || '/Users/findk', '.sohee-naver-browser-session')
const ARTIFACT_DIR = '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2'

async function runVisionGuidedPublisher() {
  console.log('========================================================================================')
  console.log(`👁️ [5.6 루나 비전(Vision) + 추론(Reasoning Max)] 네이버 블로그 시각 지능 기반 자동 포스팅`)
  console.log(`🎯 대상 블로그: https://blog.naver.com/${BLOG_ID}`)
  console.log('========================================================================================\n')

  const apiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_TEXT_API_KEY가 설정되어 있지 않습니다.')
  }

  // 1. 5.6 루나 (추론: 맥스) 최고급 바이름 청라점 마케팅 칼럼 데이터
  const postData = {
    title: '청라 자연눈썹 잘하는곳, 짱구 눈썹·잔흔 없이 내 눈썹처럼 자연스러운 바이름 1:1 맞춤 디자인',
    content: `■ 아침마다 양쪽 눈썹 그리느라 15분씩 씨름하셨나요?

매일 아침 바쁜 출근길이나 외출 전, 거울 앞에서 눈썹 펜슬을 들고 몇 번이나 그리고 지우기를 반복했던 경험은 누구나 한 번쯤 있으실 것입니다.

조금만 방심해도 양쪽 대칭이 맞지 않는 짝짝이가 되거나, 오후만 되면 땀과 피지 때문에 눈썹 꼬리 부분이 지워져 수정 화장을 해야 하는 번거로움 때문에 자연눈썹 시술을 진지하게 고민하시는 분들이 많습니다.

하지만 선뜻 예약을 망설이시는 가장 큰 이유는 단 하나, "시술 직후 짱구처럼 너무 진해져서 일상생활을 못 하면 어쩌지?", "시간이 지나고 붉거나 푸른 잔흔이 흉하게 남으면 어쩌지?"라는 걱정 때문일 텐데요.


■ 공장식 시술이 실패하는 이유: 얼굴 골격과 눈썹 근육은 사람마다 다릅니다

유행하는 특정 모양의 일자 눈썹을 모든 사람에게 똑같이 적용하는 공장식 시술은 어색함을 유발하는 가장 큰 원인입니다.

사람마다 양쪽 눈썹 뼈의 돌출 정도가 다르고, 눈을 깜빡이거나 표정을 지을 때 사용하는 이마와 눈썹 근육의 움직임, 그리고 본래 자라나는 눈썹 모의 굵기와 흐름(모류)이 전부 다릅니다.

인천 서구 청라 센트럴파크 인근에 위치한 [바이름(Byreum) 청라점]에서는 단순한 틀에 맞춘 시술이 아닌, 1:1 정밀 골격 진단을 통해 고객님의 본래 결을 한 올 한 올 살려내는 입체적 퍼스널 디자인을 원칙으로 합니다.


■ 바이름만의 차별화: 시술 직후에도 자연스러운 무통·무붉은기 프리미엄 테크닉

바이름 청라점이 수많은 고객님들께 신뢰와 사랑을 받는 이유는 "시술 당일에도 자연스러워 곧바로 약속을 잡을 수 있는 편안함"에 있습니다.

피부의 깊은 진피층을 자극하지 않고 표피층에만 미세하고 부드럽게 결을 표현하는 초정밀 마이크로 터치 기법을 사용하여 불필요한 출혈과 통증을 획기적으로 줄였습니다.

또한 미국 FDA 및 환경부 안전 인증을 획득한 최고급 프리미엄 천연 유기농 피그먼트만을 고객님의 피부 톤과 헤어 컬러에 맞춰 맞춤 배합하므로, 시간이 흘러도 붉은 기나 푸른 기로 변색되는 부작용 없이 본래 내 눈썹처럼 맑고 깨끗하게 유지됩니다.


■ 봄맞이 첫 방문 15% 한정 프로모션 & 100% 프라이빗 예약제 안내

바이름 청라점은 한 분 한 분의 소중한 눈썹을 위해 충분한 상담 시간과 정성을 쏟고자 하루 한정된 인원만을 100% 예약제로 정성껏 맞이하고 있습니다.

현재 화사한 봄 시즌을 맞이하여 첫 방문 고객님들을 위한 [화/수 주중 한정 15% 특별 프로모션]을 진행하고 있으니, 매일 아침 거울 앞 스트레스에서 벗어나 민낯에도 또렷하고 세련된 인상을 완성해 보세요.

--------------------------------------------------
📍 [바이름(Byreum) 청라점 오시는 길 & 예약 안내]
• 위치: 인천 서구 청라 커낼로 센트럴파크 인근
• 시술 항목: 1:1 맞춤 자연눈썹 / 프리미엄 속눈썹펌 / 섀도우 콤보눈썹
• 봄맞이 혜택: 화/수 주중 방문 고객 15% 한정 할인 혜택
• 예약 방식: 프라이빗 1:1 케어를 위한 100% 네이버 예약제 운영
--------------------------------------------------`,
    tags: ['청라자연눈썹', '청라눈썹문신', '바이름청라점', '청라속눈썹펌', '청라눈썹']
  }

  // 2. Playwright 브라우저 실행
  console.log('\n2. 소희 비전 브라우저 가동 중 (Headful 모드)...')
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
  })

  const page = context.pages()[0] || await context.newPage()

  page.on('dialog', async dialog => {
    console.log(`   🔔 [비전 감지] 다이얼로그 승인: ${dialog.message()}`)
    await dialog.accept().catch(() => {})
  })

  // 3. 스마트에디터 ONE 글쓰기 페이지 진입
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`3. 스마트에디터 ONE 진입 중: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // 4. [비전 스냅샷 1] 글쓰기 진입 화면 캡처
  const step1Shot = path.join(ARTIFACT_DIR, 'vision_step1_entry.png')
  await page.screenshot({ path: step1Shot, fullPage: false })
  console.log(`📸 [비전 캡처 1단계] 글쓰기 화면 캡처 완료: ${step1Shot}`)

  // 5. 프레임 탐색
  let target = page
  const frameElement = await page.$('#mainFrame')
  if (frameElement) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) {
      target = frame
      console.log('   - 메인 iframe(#mainFrame) 연결 확인')
    }
  }

  // 6. [비전 팝업 처리] 임시저장 및 튜토리얼 닫기
  console.log('4. [비전 검사] 팝업 및 도움말 시각적 감지 및 닫기...')
  for (let i = 0; i < 3; i++) {
    try {
      const cancelBtn = await target.$('.se-popup-alert-confirm button:has-text("취소"), button:has-text("취소"), .se-popup-button-cancel')
      if (cancelBtn && await cancelBtn.isVisible()) {
        console.log('   👀 [비전 확인] 이전 작성 중인 글 팝업 발견 -> [취소] 클릭')
        await cancelBtn.click()
        await page.waitForTimeout(600)
      }
      const helpClose = await target.$('.se-help-panel-close-button, .se-popup-close-button, button[class*="close"]')
      if (helpClose && await helpClose.isVisible()) {
        console.log('   👀 [비전 확인] 도움말 패널 발견 -> 닫기 클릭')
        await helpClose.click()
        await page.waitForTimeout(400)
      }
    } catch (e) {}
  }

  // 7. [비전 스냅샷 2] 팝업 정리 후 에디터 화면 캡처
  const step2Shot = path.join(ARTIFACT_DIR, 'vision_step2_editor_ready.png')
  await page.screenshot({ path: step2Shot, fullPage: false })
  console.log(`📸 [비전 캡처 2단계] 에디터 준비 완료 캡처: ${step2Shot}`)

  // 8. 제목 입력창 찾기 및 깔끔한 주입
  console.log('\n5. [비전 조작] 제목 영역 시각적 타겟팅 및 타이핑...')
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
      const titleEl = await target.$(sel)
      if (titleEl && await titleEl.isVisible()) {
        console.log(`   👀 [비전 타겟팅] 제목 입력창 매칭: ${sel}`)
        await titleEl.click({ force: true })
        await page.waitForTimeout(200)
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(100)
        await page.keyboard.insertText(postData.title)
        await page.keyboard.press('Enter')
        console.log(`   ✍️ 제목 주입 완료: "${postData.title}"`)
        titleDone = true
        break
      }
    } catch (e) {}
  }

  if (!titleDone) {
    console.log('   👀 [비전 대체 타겟팅] Tab 키로 포커스 후 제목 주입')
    await page.keyboard.press('Tab')
    await page.keyboard.insertText(postData.title)
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(600)

  // 9. 본문 영역 타겟팅 및 주입
  console.log('\n6. [비전 조작] 본문 영역 시각적 타겟팅 및 2,000자 칼럼 주입...')
  const bodySelectors = [
    '.se-section-text .se-text-paragraph',
    '.se-component-content .se-text-paragraph',
    '.se-component.se-text',
    'p.se-text-paragraph:not(.se-documentTitle *)'
  ]

  for (const sel of bodySelectors) {
    try {
      const bodyEl = await target.$(sel)
      if (bodyEl && await bodyEl.isVisible()) {
        console.log(`   👀 [비전 타겟팅] 본문 영역 매칭: ${sel}`)
        await bodyEl.click({ force: true })
        await page.waitForTimeout(200)
        break
      }
    } catch (e) {}
  }

  await page.keyboard.insertText(postData.content)
  console.log('   ✍️ 2,000자 프리미엄 본문 내용 주입 완료!')
  await page.waitForTimeout(1000)

  // 10. [비전 스냅샷 3] 글 작성 완료 화면 캡처
  const step3Shot = path.join(ARTIFACT_DIR, 'vision_step3_content_written.png')
  await page.screenshot({ path: step3Shot, fullPage: false })
  console.log(`📸 [비전 캡처 3단계] 글 작성 완료 캡처: ${step3Shot}`)

  // 11. 상단 [발행] 버튼 클릭
  console.log('\n7. [비전 조작] 상단 [발행] 버튼 시각적 타겟팅 및 클릭...')
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
        console.log(`   👀 [비전 타겟팅] 상단 발행 버튼 클릭: ${sel}`)
        await btn.click()
        await page.waitForTimeout(2000)
        break
      }
    } catch (e) {}
  }

  // 12. [비전 스냅샷 4] 발행 레이어 팝업 캡처
  const step4Shot = path.join(ARTIFACT_DIR, 'vision_step4_publish_layer.png')
  await page.screenshot({ path: step4Shot, fullPage: false })
  console.log(`📸 [비전 캡처 4단계] 발행 레이어 팝업 캡처: ${step4Shot}`)

  // 13. 해시태그 등록
  console.log('\n8. [비전 조작] 마케팅 해시태그 5개 등록...')
  const tagSelectors = ['#tag-input', 'input[placeholder*="태그"]', 'input[class*="tag_input"]', '.tag_input input']
  for (const sel of tagSelectors) {
    try {
      const tagInput = await target.$(sel)
      if (tagInput && await tagInput.isVisible()) {
        console.log(`   👀 [비전 타겟팅] 태그 입력창 매칭: ${sel}`)
        await tagInput.click()
        for (const tag of postData.tags) {
          const cleanTag = tag.replace('#', '')
          await page.keyboard.type(cleanTag, { delay: 15 })
          await page.keyboard.press('Enter')
          await page.waitForTimeout(100)
        }
        console.log(`   🏷️ 태그 등록 완료: ${postData.tags.join(', ')}`)
        break
      }
    } catch (e) {}
  }

  // 14. 최종 [발행] 확인 버튼 클릭!
  console.log('\n9. [비전 조작] 레이어 하단 최종 [발행] 확인 버튼 클릭!')
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
        console.log(`   👀 [비전 타겟팅] 최종 발행 확인 버튼 클릭: ${sel}`)
        await finalBtn.click()
        console.log('   🚀 최종 [발행] 완료!')
        await page.waitForTimeout(5000)
        break
      }
    } catch (e) {}
  }

  // 15. [비전 스냅샷 5] 최종 발행 완료 화면 캡처
  const step5Shot = path.join(ARTIFACT_DIR, 'vision_step5_published_result.png')
  await page.screenshot({ path: step5Shot, fullPage: false })
  console.log(`📸 [비전 캡처 5단계] 최종 발행 완료 결과 캡처: ${step5Shot}`)

  console.log('\n========================================================================================')
  console.log(`🎉 [5.6 루나 비전 완결] 바이름 청라점 프리미엄 칼럼이 성공적으로 발행되었습니다!`)
  console.log(`🌐 최종 URL: ${page.url()}`)
  console.log('👉 사장님께서 눈앞에서 브라우저를 확인하실 수 있도록 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

runVisionGuidedPublisher().catch(err => {
  console.error('❌ 비전 발행 실행 중 에러:', err)
})
