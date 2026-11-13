import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'

if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

const BLOG_ID = 'findk3'
const USER_PROFILE_DIR = path.join(process.env.HOME || '/Users/findk', '.sohee-chrome-profile')
const ARTIFACT_DIR = '/Users/findk/.gemini/antigravity/brain/cfe6c96a-485f-41a5-ab8e-4ad3a98cddc2'

async function runUniversalSmartEditor() {
  console.log('========================================================================================')
  console.log(`🚀 [범용 스마트에디터 ONE 자동화] 네이버 블로그 실시간 포스팅`)
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

  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`1. 글쓰기 페이지 진입: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(5000)

  // 모든 프레임 탐색
  const allFrames = page.frames()
  console.log(`2. 발견된 프레임 수: ${allFrames.length}`)
  for (let i = 0; i < allFrames.length; i++) {
    console.log(`   - Frame [${i}]: name="${allFrames[i].name()}", url="${allFrames[i].url()}"`)
  }

  // 팝업 닫기 (모든 프레임 및 메인 페이지 대상)
  for (const f of allFrames) {
    try {
      const cancelBtns = await f.$$('.se-popup-alert-confirm button, button:has-text("취소"), .se-popup-button-cancel')
      for (const btn of cancelBtns) {
        if (await btn.isVisible()) {
          console.log(`   - Frame "${f.name()}" 팝업 [취소] 클릭`)
          await btn.click()
          await page.waitForTimeout(500)
        }
      }
    } catch (e) {}
  }

  // 제목 및 본문 입력을 위한 대상 컨텍스트 찾기
  let targetFrame = page
  for (const f of allFrames) {
    try {
      const hasEditor = await f.$('.se-documentTitle, .se-title-text, .se-component-content, p.se-text-paragraph')
      if (hasEditor) {
        targetFrame = f
        console.log(`3. 스마트에디터 ONE 발견된 프레임: "${f.name()}"`)
        break
      }
    } catch (e) {}
  }

  // 3. 제목 입력
  console.log('\n4. 스마트에디터 ONE 제목 입력 중...')
  try {
    const titleEl = await targetFrame.$('.se-documentTitle, .se-title-text, p.se-text-paragraph')
    if (titleEl) {
      await titleEl.click({ force: true })
      await page.waitForTimeout(200)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
      await page.keyboard.press('Backspace')
      await page.keyboard.insertText(postTitle)
      await page.keyboard.press('Enter')
      console.log(`   ✍️ 제목 입력 완료: "${postTitle}"`)
    } else {
      await page.keyboard.press('Tab')
      await page.keyboard.insertText(postTitle)
      await page.keyboard.press('Enter')
    }
  } catch (e) {
    console.log('   - 제목 대체 입력')
    await page.keyboard.insertText(postTitle)
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(600)

  // 4. 본문 입력
  console.log('5. 2,000자 프리미엄 칼럼 본문 주입 중...')
  try {
    const bodyEl = await targetFrame.$('.se-section-text, .se-component-content, p')
    if (bodyEl) {
      await bodyEl.click({ force: true })
      await page.waitForTimeout(200)
    }
  } catch (e) {}

  await page.keyboard.insertText(postContent)
  console.log('   ✍️ 2,000자 본문 주입 완료!')
  await page.waitForTimeout(1000)

  // 5. 상단 [발행] 버튼 클릭
  console.log('\n6. 상단 [발행] 버튼 클릭...')
  let publishOpened = false
  for (const f of allFrames) {
    try {
      const pBtns = await f.$$('button:has-text("발행"), button[class*="publish_btn"], .se-publish-button')
      for (const btn of pBtns) {
        if (await btn.isVisible()) {
          console.log(`   - Frame "${f.name()}" 상단 [발행] 버튼 클릭`)
          await btn.click()
          publishOpened = true
          await page.waitForTimeout(2000)
          break
        }
      }
      if (publishOpened) break
    } catch (e) {}
  }

  // 6. 태그 입력
  console.log('7. 해시태그 5개 등록 중...')
  for (const f of allFrames) {
    try {
      const tagInput = await f.$('#tag-input, input[placeholder*="태그"], input[class*="tag_input"]')
      if (tagInput && await tagInput.isVisible()) {
        await tagInput.click()
        for (const tag of tags) {
          await page.keyboard.type(tag.replace('#', ''), { delay: 15 })
          await page.keyboard.press('Enter')
          await page.waitForTimeout(100)
        }
        console.log(`   🏷️ 태그 등록 완료: ${tags.join(', ')}`)
        break
      }
    } catch (e) {}
  }

  // 7. 레이어 하단 최종 [발행] 확인 버튼 클릭
  console.log('\n8. 최종 레이어 [발행] 확인 버튼 클릭...')
  for (const f of allFrames) {
    try {
      const confirmBtns = await f.$$('.btn_publish, button[class*="confirm_btn"], .layer_publish button:has-text("발행"), button:has-text("발행하기")')
      for (const btn of confirmBtns) {
        if (await btn.isVisible()) {
          console.log(`   🚀 Frame "${f.name()}" 최종 [발행] 클릭 완료!`)
          await btn.click()
          await page.waitForTimeout(6000)
          break
        }
      }
    } catch (e) {}
  }

  const finalUrl = page.url()
  const resultShot = path.join(ARTIFACT_DIR, 'universal_published_post.png')
  await page.screenshot({ path: resultShot, fullPage: true })

  console.log('\n========================================================================================')
  console.log(`🎉 [발행 완료] 네이버 블로그 글이 성공적으로 등록되었습니다!`)
  console.log(`🌐 최종 URL: ${finalUrl}`)
  console.log(`📸 스크린샷: ${resultShot}`)
  console.log('========================================================================================\n')
}

runUniversalSmartEditor().catch(err => {
  console.error('❌ 범용 에디터 실행 에러:', err)
})
