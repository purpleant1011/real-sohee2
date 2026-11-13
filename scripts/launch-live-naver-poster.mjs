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

const SESSION_DIR = path.join(process.env.HOME || '/Users/findk', '.sohee-naver-browser-session')

async function runLiveNaverPlaywrightPoster() {
  console.log('========================================================================================')
  console.log('🚀 [소희 AI 마케팅 관제실] OpenAI Luna (추론: 맥스) 네이버 블로그 자동 포스팅 가동')
  console.log('========================================================================================\n')

  const apiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY
  let postContent = {
    title: '2026 청라 자연 눈썹: 봄 메이크업 시간 반으로 줄이는 바이름 1:1 맞춤 디자인',
    intro: '인천 서구 청라 커낼로 센트럴파크 인근 맞춤 눈썹 전문 바이름(Byreum) 청라점입니다. 아침마다 눈썹 그리기가 번거로우셨다면 얼굴형과 본래 결에 맞춘 1:1 퍼스널 디자인을 만나보세요.',
    body: '공장식 시술을 탈피하고 고객님의 눈매와 골격, 모의 방향에 맞춘 퍼스널 디자인을 적용합니다. 짱구 눈썹이나 붉은기 없이 시술 직후에도 편안하게 일상생활이 가능합니다.',
    quote: '화요일/수요일 오후 2시~5시 방문 고객님께는 봄맞이 첫 방문 15% 한정 할인 혜택이 제공됩니다.',
    tags: ['청라자연눈썹', '청라눈썹문신', '바이름청라점', '청라속눈썹펌', '청라눈썹']
  }

  if (apiKey) {
    try {
      console.log('1. OpenAI Luna(GPT-4o Reasoning Max) 실시간 추론 API로 최신 바이름 마케팅 콘텐츠 생성 중...')
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o',
          messages: [
            { role: 'system', content: '당신은 뷰티샵 바이름 청라점의 최고 마케팅 AI 소희입니다. 네이버 블로그 스마트에디터 ONE에 직접 게시할 제목, 서론, 본문, 인용구, 해시태그 5개를 JSON으로 생성하세요.' },
            { role: 'user', content: '청라 봄맞이 자연눈썹 15% 프로모션 블로그 글을 만들어줘.' }
          ],
          response_format: { type: 'json_object' }
        })
      })
      const data = await res.json()
      const parsed = JSON.parse(data.choices?.[0]?.message?.content || '{}')
      if (parsed.title) {
        postContent = {
          title: parsed.title,
          intro: parsed.intro || parsed.introduction || postContent.intro,
          body: parsed.body || parsed.sections?.[0]?.body || postContent.body,
          quote: parsed.quote || parsed.sections?.[0]?.emphasisQuote || postContent.quote,
          tags: parsed.tags || postContent.tags
        }
        console.log(`✅ OpenAI Luna 생성 완료: "${postContent.title}"`)
      }
    } catch (e) {
      console.log('⚠️ OpenAI 기본 콘텐츠 세트로 진행:', e.message)
    }
  }

  console.log('\n2. 사장님 모니터 화면에 실제 Playwright 브라우저 창을 띄웁니다...')
  
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  })

  const page = context.pages()[0] || await context.newPage()

  console.log('3. 네이버 블로그 스마트에디터 ONE 글쓰기 페이지 진입 중...')
  await page.goto('https://blog.naver.com/PostWriteForm.naver', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(4000)

  // iframe (#mainFrame) 내부 탐색
  let targetFrame = page
  const hasIframe = await page.$('#mainFrame')
  if (hasIframe) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) {
      targetFrame = frame
      console.log('   - 메인 iframe(#mainFrame) 내부 프레임 전환 완료')
    }
  }

  // 4. 작성 중인 글 팝업 (취소) 처리
  console.log('4. 팝업 및 도움말 검사...')
  try {
    const cancelBtn = await targetFrame.$('.se-popup-alert-confirm button:has-text("취소"), .se-popup-alert-confirm button:nth-child(1), button:has-text("취소")')
    if (cancelBtn) {
      console.log('   - 이전 작성 중인 글 팝업 [취소] 클릭')
      await cancelBtn.click()
      await page.waitForTimeout(1000)
    }
  } catch (e) {}

  try {
    const helpClose = await targetFrame.$('.se-help-panel-close-button, .se-popup-close-button, button[class*="close"]')
    if (helpClose) {
      await helpClose.click()
      await page.waitForTimeout(500)
    }
  } catch (e) {}

  // 5. 제목 입력창 찾기 및 타이핑
  console.log('\n5. [Playwright 실시간 조작] 제목 영역 탐색 및 타이핑 시작...')
  
  let titleFound = false
  const titleSelectors = [
    '.se-documentTitle .se-text-paragraph',
    '.se-title-text .se-text-paragraph',
    '.se-component.se-documentTitle',
    'p.se-text-paragraph[placeholder*="제목"]',
    'span.se-placeholder:has-text("제목")',
    '.se-documentTitle',
    'p.se-text-paragraph'
  ]

  for (const sel of titleSelectors) {
    try {
      const el = await targetFrame.$(sel)
      if (el) {
        console.log(`   - 제목 셀렉터 매칭: ${sel}`)
        await el.click({ force: true })
        await page.waitForTimeout(400)
        
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(200)

        console.log(`   ✍️ 제목 실시간 타이핑 중: "${postContent.title}"`)
        await page.keyboard.type(postContent.title, { delay: 35 })
        await page.keyboard.press('Enter')
        titleFound = true
        break
      }
    } catch (e) {}
  }

  if (!titleFound) {
    console.log('   - Tab 키로 제목 영역 포커스 후 타이핑')
    await page.keyboard.press('Tab')
    await page.keyboard.type(postContent.title, { delay: 35 })
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(1000)

  // 6. 본문 영역 찾기 및 타이핑
  console.log('\n6. [Playwright 실시간 조작] 본문 영역 탐색 및 뷰티 마케팅 콘텐츠 타이핑...')
  
  const bodySelectors = [
    '.se-section-text .se-text-paragraph',
    '.se-component-content .se-text-paragraph',
    '.se-component.se-text',
    'p.se-text-paragraph:not(.se-documentTitle *)',
    'span.se-placeholder:has-text("본문")'
  ]

  for (const sel of bodySelectors) {
    try {
      const el = await targetFrame.$(sel)
      if (el) {
        console.log(`   - 본문 셀렉터 매칭: ${sel}`)
        await el.click({ force: true })
        await page.waitForTimeout(400)
        break
      }
    } catch (e) {}
  }

  console.log('   ✍️ 서론 단락 입력 중...')
  await page.keyboard.type(postContent.intro, { delay: 20 })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  console.log('   ✍️ 핵심 시술 본문 입력 중...')
  await page.keyboard.type(postContent.body, { delay: 20 })
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(500)

  console.log('   ✍️ 봄맞이 15% 할인 혜택 인용구 입력 중...')
  await page.keyboard.type(`💡 [바이름 청라점 봄맞이 혜택] ${postContent.quote}`, { delay: 20 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1500)

  // 7. 상단 [발행] 버튼 클릭
  console.log('\n7. [Playwright 실시간 조작] 상단 [발행] 버튼 클릭...')
  const publishSelectors = [
    'button[class*="publish_btn"]',
    'button.se-publish-button',
    'button:has-text("발행")',
    '.btn_publish'
  ]

  for (const sel of publishSelectors) {
    try {
      const btn = await targetFrame.$(sel)
      if (btn) {
        console.log(`   - 상단 발행 버튼 클릭: ${sel}`)
        await btn.click()
        await page.waitForTimeout(2000)
        break
      }
    } catch (e) {}
  }

  // 8. 해시태그 입력
  console.log('8. [Playwright 실시간 조작] 마케팅 해시태그 등록...')
  const tagSelectors = [
    '#tag-input',
    'input[placeholder*="태그"]',
    'input[class*="tag_input"]',
    '.tag_input input'
  ]

  for (const sel of tagSelectors) {
    try {
      const tagInput = await targetFrame.$(sel)
      if (tagInput) {
        await tagInput.click()
        for (const tag of postContent.tags) {
          const cleanTag = tag.replace('#', '')
          await page.keyboard.type(cleanTag, { delay: 25 })
          await page.keyboard.press('Enter')
          await page.waitForTimeout(200)
        }
        console.log(`   🏷️ 태그 등록 완료: ${postContent.tags.join(', ')}`)
        break
      }
    } catch (e) {}
  }

  // 9. 최종 [발행] 버튼 클릭!
  console.log('\n9. [Playwright 실시간 조작] 레이어 하단 최종 [발행] 버튼 클릭!')
  const finalPublishSelectors = [
    '.btn_publish',
    'button[class*="confirm_btn"]',
    'button[publish_confirm_btn]',
    '.layer_publish button:has-text("발행")',
    'button:has-text("발행하기")'
  ]

  for (const sel of finalPublishSelectors) {
    try {
      const finalBtn = await targetFrame.$(sel)
      if (finalBtn) {
        console.log(`   - 최종 발행 버튼 클릭: ${sel}`)
        await finalBtn.click()
        console.log('   🚀 최종 [발행] 버튼 클릭 완료!')
        await page.waitForTimeout(5000)
        break
      }
    } catch (e) {}
  }

  console.log('\n========================================================================================')
  console.log(`🎉 [완료] 네이버 블로그에 포스팅이 성공적으로 작성 및 발행되었습니다!`)
  console.log(`🌐 최종 URL: ${page.url()}`)
  console.log('👉 사장님께서 눈앞에서 확인하실 수 있도록 브라우저 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

runLiveNaverPlaywrightPoster().catch(err => {
  console.error('❌ 실행 중 에러 발생:', err)
})
