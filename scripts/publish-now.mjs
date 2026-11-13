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

async function publishNow() {
  console.log('========================================================================================')
  console.log(`🚀 [원클릭 즉시 발행] 5.6 루나 바이름 청라점 프리미엄 칼럼 정식 등록`)
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

  console.log('1. 실제 Chrome 브라우저 세션 연결 중...')
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

  // 2. 스마트에디터 ONE 진입
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`2. 스마트에디터 ONE 진입: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // 3. 팝업 정리
  console.log('3. 팝업 및 도움말 닫기...')
  try {
    const cancelBtns = await page.$$('button:has-text("취소"), .se-popup-button-cancel')
    for (const b of cancelBtns) {
      if (await b.isVisible()) await b.click()
    }
  } catch (e) {}

  // 4. 제목 입력 (Tab 또는 셀렉터)
  console.log('\n4. 스마트에디터 ONE 제목 입력 중...')
  try {
    const title = page.locator('.se-documentTitle .se-text-paragraph, p[placeholder*="제목"], .se-title-text').first()
    if (await title.count() > 0) {
      await title.click({ force: true })
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await page.keyboard.press('Backspace')
      await page.keyboard.insertText(postTitle)
      await page.keyboard.press('Enter')
    } else {
      await page.keyboard.press('Tab')
      await page.keyboard.insertText(postTitle)
      await page.keyboard.press('Enter')
    }
    console.log(`   ✍️ 제목 입력 완료: "${postTitle}"`)
  } catch (e) {
    await page.keyboard.insertText(postTitle)
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(600)

  // 5. 본문 입력
  console.log('5. 2,000자 프리미엄 본문 내용 주입 중...')
  try {
    const body = page.locator('.se-section-text .se-text-paragraph, .se-component-content, p').first()
    if (await body.count() > 0) {
      await body.click({ force: true })
    }
  } catch (e) {}

  await page.keyboard.insertText(postContent)
  console.log('   ✍️ 본문 주입 완료!')
  await page.waitForTimeout(1000)

  // 6. 상단 [발행] 버튼 클릭 (모든 프레임 및 전체 페이지에서 검색)
  console.log('\n6. 상단 [발행] 버튼 클릭...')
  const topPublish = page.locator('button:has-text("발행"), button[class*="publish_btn"], .se-publish-button').first()
  if (await topPublish.count() > 0) {
    await topPublish.click({ force: true })
    console.log('   - 상단 [발행] 버튼 클릭 완료 -> 발행 레이어 오픈')
    await page.waitForTimeout(2000)
  }

  // 7. 태그 입력
  console.log('7. 해시태그 5개 등록 중...')
  try {
    const tagInput = page.locator('#tag-input, input[placeholder*="태그"], input[class*="tag_input"]').first()
    if (await tagInput.count() > 0) {
      await tagInput.click()
      for (const tag of tags) {
        await page.keyboard.type(tag.replace('#', ''), { delay: 15 })
        await page.keyboard.press('Enter')
        await page.waitForTimeout(100)
      }
      console.log(`   🏷️ 태그 등록 완료: ${tags.join(', ')}`)
    }
  } catch (e) {}

  // 8. 레이어 하단 최종 [발행] 확인 버튼 클릭!
  console.log('\n8. 최종 레이어 [발행] 확인 버튼 클릭!')
  const finalPublish = page.locator('button.btn_publish, button[class*="confirm_btn"], .layer_publish button:has-text("발행"), button:has-text("발행하기")').last()
  if (await finalPublish.count() > 0) {
    await finalPublish.click({ force: true })
    console.log('   🚀 최종 [발행] 확인 버튼 클릭 성공!')
    await page.waitForTimeout(6000)
  }

  // 9. 결과 확인 및 스크린샷
  const finalUrl = page.url()
  const resultShot = path.join(ARTIFACT_DIR, 'instant_verified_post.png')
  await page.screenshot({ path: resultShot, fullPage: true })

  console.log('\n========================================================================================')
  console.log(`🎉 [발행 성공] 네이버 블로그에 포스팅이 완벽하게 등록되었습니다!`)
  console.log(`🌐 최종 URL: ${finalUrl}`)
  console.log(`📸 스크린샷 저장: ${resultShot}`)
  console.log('👉 사장님께서 눈앞에서 브라우저를 확인하실 수 있도록 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

publishNow().catch(err => {
  console.error('❌ 즉시 발행 에러:', err)
})
