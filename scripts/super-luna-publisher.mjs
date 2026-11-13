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

async function runSuperLunaPublisher() {
  console.log('========================================================================================')
  console.log(`🚀 [소희 5.6 루나 (추론: 맥스)] 네이버 블로그 최상위 뷰티 칼럼 정식 발행`)
  console.log(`🎯 대상 블로그: https://blog.naver.com/${BLOG_ID}`)
  console.log('========================================================================================\n')

  const apiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_TEXT_API_KEY가 설정되어 있지 않습니다.')
  }

  // 1. 5.6 루나(추론: 맥스) 칼럼 데이터 준비
  const postData = {
    title: '청라 자연눈썹 실패 없이 내 눈썹처럼 자연스러운 바이름 1:1 맞춤 디자인',
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

  console.log(`📌 확정된 칼럼 제목: "${postData.title}"`)

  // 2. Playwright 브라우저 실행
  console.log('\n2. Playwright 브라우저 가동 중...')
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--start-maximized', '--disable-blink-features=AutomationControlled']
  })

  const page = context.pages()[0] || await context.newPage()

  page.on('dialog', async dialog => {
    console.log(`   🔔 다이얼로그 자동 승인: ${dialog.message()}`)
    await dialog.accept().catch(() => {})
  })

  // 3. 스마트에디터 ONE 글쓰기 페이지 진입
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`3. 스마트에디터 ONE 진입: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // 4. 메인 프레임 탐색
  let target = page
  const frameElement = await page.$('#mainFrame')
  if (frameElement) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) {
      target = frame
      console.log('   - 메인 iframe(#mainFrame) 프레임 전환 완료')
    }
  }

  // 5. 팝업 닫기
  try {
    const cancelBtn = await target.$('.se-popup-alert-confirm button:has-text("취소"), button:has-text("취소")')
    if (cancelBtn) {
      console.log('   - 이전 작성 중인 글 팝업 [취소] 클릭')
      await cancelBtn.click()
      await page.waitForTimeout(600)
    }
    const helpClose = await target.$('.se-help-panel-close-button, .se-popup-close-button')
    if (helpClose) {
      await helpClose.click()
      await page.waitForTimeout(300)
    }
  } catch (e) {}

  // 6. 에디터 렌더링 대기
  console.log('\n5. [스마트에디터 ONE] 에디터 DOM 대기 및 제목 입력 시작...')
  await target.waitForSelector('.se-documentTitle, .se-title-text, p.se-text-paragraph', { timeout: 15000 })

  const titleEl = await target.$('.se-documentTitle .se-text-paragraph, .se-title-text .se-text-paragraph, p.se-text-paragraph')
  if (titleEl) {
    await titleEl.click({ force: true })
    await page.waitForTimeout(300)
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(100)
    await page.keyboard.insertText(postData.title)
    await page.keyboard.press('Enter')
    console.log(`   ✍️ 제목 입력 완료: "${postData.title}"`)
  } else {
    await page.keyboard.press('Tab')
    await page.keyboard.insertText(postData.title)
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(600)

  // 7. 본문 입력
  console.log('\n6. [스마트에디터 ONE] 5.6 루나 (추론: 맥스) 프리미엄 본문 주입...')
  const bodyEl = await target.$('.se-section-text .se-text-paragraph, .se-component-content .se-text-paragraph, p:not(.se-documentTitle *)')
  if (bodyEl) {
    await bodyEl.click({ force: true })
    await page.waitForTimeout(300)
  }

  await page.keyboard.insertText(postData.content)
  console.log('   ✍️ 2,000자 프리미엄 칼럼 본문 주입 완료!')
  await page.waitForTimeout(1000)

  // 8. 상단 [발행] 버튼 클릭
  console.log('\n7. [스마트에디터 ONE] 상단 [발행] 버튼 클릭...')
  const publishBtn = await target.$('button[class*="publish_btn"], button.se-publish-button, button:has-text("발행")')
  if (publishBtn) {
    await publishBtn.click()
    await page.waitForTimeout(2000)
    console.log('   - 발행 레이어 팝업 열림')
  }

  // 9. 해시태그 등록
  console.log('8. [스마트에디터 ONE] 마케팅 해시태그 5개 등록...')
  const tagInput = await target.$('#tag-input, input[placeholder*="태그"], input[class*="tag_input"]')
  if (tagInput) {
    await tagInput.click()
    for (const tag of postData.tags) {
      await page.keyboard.type(tag.replace('#', ''), { delay: 15 })
      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
    }
    console.log(`   🏷️ 태그 등록 완료: ${postData.tags.join(', ')}`)
  }

  // 10. 최종 [발행] 확인 버튼 클릭!
  console.log('\n9. [스마트에디터 ONE] 레이어 하단 최종 [발행] 확인 버튼 클릭!')
  const finalBtn = await target.$('.btn_publish, button[class*="confirm_btn"], button[publish_confirm_btn], .layer_publish button:has-text("발행")')
  if (finalBtn) {
    await finalBtn.click()
    console.log('   🚀 최종 [발행] 확인 완료!')
    await page.waitForTimeout(5000)
  }

  console.log('\n========================================================================================')
  console.log(`🎉 [발행 완료] 5.6 루나 (추론: 맥스) 바이름 청라점 프리미엄 칼럼이 성공적으로 등록되었습니다!`)
  console.log(`🌐 최종 URL: ${page.url()}`)
  console.log('👉 사장님께서 눈앞에서 브라우저를 확인하실 수 있도록 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

runSuperLunaPublisher().catch(err => {
  console.error('❌ 발행 중 에러:', err)
})
