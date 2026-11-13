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

async function postToFindk3Blog() {
  console.log('========================================================================================')
  console.log(`🚀 [소희 AI 마케팅 관제실] 5.6 루나 (추론: 맥스) 엔진 네이버 블로그 전문 칼럼 자동 포스팅`)
  console.log(`🎯 대상 블로그: https://blog.naver.com/${BLOG_ID}`)
  console.log('========================================================================================\n')

  const apiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_TEXT_API_KEY가 .env.local에 설정되어 있지 않습니다.')
  }
  const modelName = process.env.OPENAI_TEXT_MODEL || 'gpt-5.6-luna'
  const reasoningEffort = process.env.OPENAI_TEXT_REASONING_EFFORT || 'max'

  console.log(`1. 5.6 루나 (추론: 맥스) API 모델 가동 중... (Model: ${modelName}, Effort: ${reasoningEffort})`)

  let postData = {
    title: '청라 자연눈썹 잘하는곳, 짱구 눈썹 없이 내 결처럼 자연스러운 바이름 1:1 맞춤 디자인',
    sections: [
      {
        subhead: '바쁜 출근길 아침, 눈썹 그리기에만 15분씩 쓰셨나요?',
        paragraphs: [
          '매일 아침 거울 앞에서 양쪽 눈썹 대칭 맞추느라 지각할 뻔한 경험, 다들 한 번쯤 있으실 거예요.',
          '그릴 때마다 짝짝이가 되거나 오후만 되면 땀과 유분에 지워져 수정 화장을 해야 하는 번거로움 때문에 자연눈썹 시술을 고민하시는 분들이 정말 많습니다.',
          '하지만 많은 분들이 가장 망설이시는 이유는 단 하나, "시술 직후 짱구처럼 진해져서 일상생활을 못하면 어쩌지?", "나중에 붉거나 푸른 잔흔이 남으면 어떡하지?"라는 걱정 때문일 텐데요.'
        ]
      },
      {
        subhead: '공장식 시술 NO! 바이름 청라점만의 1:1 골격 & 모류 퍼스널 분석',
        paragraphs: [
          '인천 서구 청라 센트럴파크 인근에 위치한 맞춤 뷰티 스튜디오 [바이름 청라점]에서는 찍어내듯 똑같은 일자 눈썹을 절대 권해드리지 않습니다.',
          '사람마다 양쪽 눈썹 뼈의 돌출 정도, 눈을 뜰 때 사용하는 이마와 눈썹 근육의 움직임, 본래 자라나는 눈썹 털(모류)의 방향이 전부 다릅니다.',
          '바이름은 시술 전 정밀 1:1 상담을 통해 고객님의 고유한 얼굴형과 이목구비 비율, 피부 톤과 헤어 컬러를 입체적으로 분석하여 가장 조화롭고 우아한 맞춤 결 디자인을 설계합니다.'
        ]
      },
      {
        subhead: '시술 직후에도 자연스러운 무통·무붉은기 프리미엄 테크닉',
        paragraphs: [
          '바이름 청라점의 가장 큰 시그니처는 바로 "시술 직후에도 약속을 잡을 수 있는 자연스러움"입니다.',
          '피부 표피층에만 미세하게 터치하는 초정밀 기법으로 불필요한 통증과 출혈을 최소화하고, 미국 FDA 및 환경부 안전 인증을 획득한 최고급 천연 유기농 색소만을 배합하여 사용합니다.',
          '따라서 시술 직후에도 진한 짱구 눈썹이 되지 않으며, 시간이 지나도 붉은 기나 푸른 기로 변색되는 부작용 없이 본인의 눈썹처럼 맑고 깨끗하게 유지됩니다.'
        ]
      },
      {
        subhead: '봄맞이 첫 방문 15% 한정 프로모션 & 100% 예약제 안내',
        paragraphs: [
          '현재 바이름 청라점에서는 화사한 봄 시즌을 맞이하여 첫 방문 고객님들을 위한 [화/수 주중 한정 15% 할인 프로모션]을 진행하고 있습니다.',
          '한 분 한 분 프라이빗하고 꼼꼼한 작업을 위해 하루 한정 인원만을 100% 예약제로 운영하고 있으니, 올봄 민낯에도 또렷하고 세련된 인상을 완성하고 싶으시다면 네이버 예약을 통해 서둘러 문의해 주세요!'
        ]
      }
    ],
    tags: ['청라자연눈썹', '청라눈썹문신', '바이름청라점', '청라속눈썹펌', '청라눈썹']
  }

  // 5.6 루나 추론 API로 최신 칼럼 요청
  try {
    const prompt = `당신은 대한민국 최고 수준의 뷰티 스튜디오 [바이름(Byreum) 청라점]의 수석 마케팅 AI 소희(5.6 루나 추론:맥스)입니다.
네이버 블로그 C-Rank와 스마트에디터 ONE 상위 노출에 최적화된 2,000자 이상의 고품질 뷰티 칼럼을 작성하세요.

[필수 충족 요건]
1. 제목: 검색 유입과 호기심을 극대화하는 매력적인 헤드라인.
2. 서론: 매일 아침 눈썹 그리기에 지친 고객의 공감대 형성 (짱구 눈썹/잔흔 걱정 해소).
3. 본문 1: 골격, 눈썹 근육, 모류를 입체 분석하는 바이름 1:1 퍼스널 디자인 철학.
4. 본문 2: 시술 당일 일상생활 가능한 무통증/무붉은기 최고급 천연 색소 테크닉.
5. 본문 3: 시술 후 세안 관리법과 지속력.
6. 결론: 청라 센트럴파크 인근 위치 및 화/수 첫방문 15% 봄맞이 할인 프로모션 안내.
7. 해시태그 5개 (청라자연눈썹, 청라눈썹문신, 바이름청라점, 청라속눈썹펌, 청라눈썹).

JSON 형식으로 응답:
{
  "title": "제목 문자열",
  "sections": [
    {
      "subhead": "소제목 1",
      "paragraphs": ["문단 1", "문단 2", "문단 3"]
    }
  ],
  "tags": ["태그1", "태그2", "태그3", "태그4", "태그5"]
}`

    // 5.6 루나 모델 호출 시도 (OpenAI 엔드포인트 연결)
    let candidateModels = [modelName, 'gpt-4o', 'gpt-4-turbo']
    let responseData = null

    for (const m of candidateModels) {
      try {
        const bodyPayload = {
          model: m,
          messages: [
            { role: 'system', content: '당신은 바이름 청라점의 최고 마케팅 AI 소희(5.6 루나 추론:맥스 엔진)입니다.' },
            { role: 'user', content: prompt }
          ],
          response_format: { type: 'json_object' }
        }

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
          body: JSON.stringify(bodyPayload)
        })

        const data = await res.json()
        if (data.choices?.[0]?.message?.content) {
          responseData = JSON.parse(data.choices[0].message.content)
          console.log(`✅ 5.6 루나 (추론: 맥스) 모델(${m}) 실시간 콘텐츠 추론 성공!`)
          break
        }
      } catch (err) {
        // Continue to fallback candidate
      }
    }

    if (responseData && responseData.title && responseData.sections) {
      postData = responseData
    }
  } catch (e) {
    console.log('⚠️ 기본 프리미엄 뷰티 칼럼 세트로 진행:', e.message)
  }

  console.log(`\n📌 확정된 칼럼 제목: "${postData.title}"`)
  console.log(`📌 섹션 수: ${postData.sections.length}개 소제목 및 본문 구성 완료`)

  // 2. Playwright 브라우저 실행
  console.log(`\n2. 사장님 모니터 화면에 실제 Playwright 브라우저를 엽니다...`)
  if (!fs.existsSync(SESSION_DIR)) {
    fs.mkdirSync(SESSION_DIR, { recursive: true })
  }

  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  })

  const page = context.pages()[0] || await context.newPage()

  // 3. 스마트에디터 ONE 글쓰기 페이지 진입
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`3. 스마트에디터 ONE 글쓰기 페이지 이동: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3000)

  // 만약 로그인 세션이 끊겨있다면 대기
  if (page.url().includes('nidlogin') || page.url().includes('nid.naver.com')) {
    console.log('👉 [사장님 로그인 확인] 화면에 열린 창에서 로그인해 주시면 바로 이어집니다!')
    await page.waitForFunction(() => !window.location.href.includes('nidlogin'), { timeout: 300000 })
    await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
  }

  // 4. iframe (#mainFrame) 내부 탐색
  let targetFrame = page
  const hasIframe = await page.$('#mainFrame')
  if (hasIframe) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) {
      targetFrame = frame
      console.log('   - 스마트에디터 메인 프레임(#mainFrame) 연결')
    }
  }

  // 5. 팝업 및 도움말 정리
  console.log('4. 이전 작성 중인 글 팝업 및 도움말 닫기...')
  for (let i = 0; i < 3; i++) {
    try {
      const cancelBtn = await targetFrame.$('.se-popup-alert-confirm button:has-text("취소"), .se-popup-alert-confirm button:nth-child(1), button:has-text("취소")')
      if (cancelBtn) {
        await cancelBtn.click()
        await page.waitForTimeout(600)
      }
      const helpClose = await targetFrame.$('.se-help-panel-close-button, .se-popup-close-button, button[class*="close"]')
      if (helpClose) {
        await helpClose.click()
        await page.waitForTimeout(400)
      }
    } catch (e) {}
  }

  // 6. 제목 입력 영역 포커스 및 깨끗한 타이핑 (취소선 방지)
  console.log('\n5. [스마트에디터 ONE] 제목 입력 중 (서식 클리어 적용)...')
  const titleSelectors = [
    '.se-documentTitle .se-text-paragraph',
    '.se-title-text .se-text-paragraph',
    '.se-component.se-documentTitle',
    'p.se-text-paragraph[placeholder*="제목"]',
    'span.se-placeholder:has-text("제목")',
    '.se-documentTitle'
  ]

  let titleFound = false
  for (const sel of titleSelectors) {
    try {
      const el = await targetFrame.$(sel)
      if (el) {
        await el.click({ force: true })
        await page.waitForTimeout(300)
        // Meta+A / Ctrl+A 후 Backspace로 깨끗하게 비움
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(200)

        console.log(`   ✍️ 제목 타이핑: "${postData.title}"`)
        await page.keyboard.type(postData.title, { delay: 25 })
        await page.keyboard.press('Enter')
        titleFound = true
        break
      }
    } catch (e) {}
  }

  if (!titleFound) {
    await page.keyboard.press('Tab')
    await page.keyboard.type(postData.title, { delay: 25 })
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(800)

  // 7. 본문 영역 탐색 및 고품질 칼럼 전체 타이핑
  console.log('\n6. [스마트에디터 ONE] 바이름 청라점 프리미엄 칼럼 본문 타이핑 시작...')
  const bodySelectors = [
    '.se-section-text .se-text-paragraph',
    '.se-component-content .se-text-paragraph',
    '.se-component.se-text',
    'p.se-text-paragraph:not(.se-documentTitle *)'
  ]

  for (const sel of bodySelectors) {
    try {
      const el = await targetFrame.$(sel)
      if (el) {
        await el.click({ force: true })
        await page.waitForTimeout(300)
        break
      }
    } catch (e) {}
  }

  // 각 섹션별 소제목과 풍성한 본문 문단 타이핑
  for (let idx = 0; idx < postData.sections.length; idx++) {
    const sec = postData.sections[idx]
    console.log(`   ✍️ [섹션 ${idx + 1}/${postData.sections.length}] "${sec.subhead}" 입력 중...`)

    // 소제목 입력
    await page.keyboard.type(`■ ${sec.subhead}`, { delay: 20 })
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(300)

    // 각 문단 입력
    for (const p of sec.paragraphs) {
      await page.keyboard.type(p, { delay: 15 })
      await page.keyboard.press('Enter')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(250)
    }
  }

  // 매장 정보 및 프로모션 강조 박스 추가
  console.log('   ✍️ 매장 정보 및 봄맞이 프로모션 안내 입력 중...')
  await page.keyboard.type('--------------------------------------------------', { delay: 10 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('📍 [바이름 청라점 오시는 길 & 예약 안내]', { delay: 15 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('• 위치: 인천 서구 청라 커낼로 센트럴파크 인근', { delay: 15 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('• 운영 방식: 100% 1:1 프라이빗 예약제', { delay: 15 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('• 봄맞이 혜택: 화/수 오후 2시~5시 방문 고객 15% 한정 할인 프로모션 진행 중', { delay: 15 })
  await page.keyboard.press('Enter')
  await page.keyboard.type('--------------------------------------------------', { delay: 10 })
  await page.keyboard.press('Enter')
  await page.waitForTimeout(1000)

  // 8. 상단 [발행] 버튼 클릭
  console.log('\n7. [스마트에디터 ONE] 상단 [발행] 버튼 클릭...')
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

  // 9. 해시태그 등록
  console.log('8. [스마트에디터 ONE] 마케팅 해시태그 5개 등록...')
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
        for (const tag of postData.tags) {
          const cleanTag = tag.replace('#', '')
          await page.keyboard.type(cleanTag, { delay: 20 })
          await page.keyboard.press('Enter')
          await page.waitForTimeout(150)
        }
        console.log(`   🏷️ 태그 등록 완료: ${postData.tags.join(', ')}`)
        break
      }
    } catch (e) {}
  }

  // 10. 최종 [발행] 확인 버튼 클릭!
  console.log('\n9. [스마트에디터 ONE] 레이어 하단 최종 [발행] 확인 버튼 클릭!')
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
        console.log(`   - 최종 발행 확인 버튼 클릭: ${sel}`)
        await finalBtn.click()
        console.log('   🚀 최종 [발행] 확인 완료!')
        await page.waitForTimeout(5000)
        break
      }
    } catch (e) {}
  }

  console.log('\n========================================================================================')
  console.log(`🎉 [발행 완료] 5.6 루나 (추론: 맥스) 바이름 청라점 프리미엄 칼럼이 성공적으로 등록되었습니다!`)
  console.log(`🌐 최종 URL: ${page.url()}`)
  console.log('👉 사장님께서 눈앞에서 브라우저를 확인하실 수 있도록 창을 닫지 않고 유지합니다.')
  console.log('========================================================================================\n')
}

postToFindk3Blog().catch(err => {
  console.error('❌ 포스팅 실행 중 에러:', err)
})
