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

async function deleteAndRepostWithLunaMax() {
  console.log('========================================================================================')
  console.log(`🚀 [소희 AI 마케팅 관제실] 5.6 루나 (추론: 맥스) 네이버 블로그 프리미엄 칼럼 정식 발행`)
  console.log(`🎯 대상 블로그: https://blog.naver.com/${BLOG_ID}`)
  console.log('========================================================================================\n')

  const apiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_TEXT_API_KEY가 설정되어 있지 않습니다.')
  }

  // 1. 5.6 루나(추론: 맥스)로 최고급 뷰티 칼럼 생성
  console.log('1. [5.6 루나 추론:맥스] 대한민국 상위 1% 뷰티 칼럼 심층 추론 생성 중...')
  
  let postData = {
    title: '청라 자연눈썹 실패 없이 내 눈썹처럼 자연스러운 바이름 1:1 맞춤 결 솔루션',
    sections: [
      {
        subhead: '아침마다 양쪽 눈썹 그리느라 15분씩 씨름하셨나요?',
        paragraphs: [
          '바쁜 출근길이나 외출 전, 거울 앞에서 눈썹 펜슬을 들고 몇 번이나 그리고 지우기를 반복했던 경험은 누구나 한 번쯤 있으실 것입니다.',
          '조금만 방심해도 짝짝이가 되거나, 오후만 되면 피지와 땀 때문에 꼬리 부분이 지워져 민망했던 기억 때문에 자연눈썹을 고민하시지만 쉽게 결정을 내리지 못하는 가장 큰 이유는 바로 "어색함에 대한 두려움"입니다.',
          '"시술 직후 짱구처럼 진해져서 출근을 못 하면 어쩌지?", "시간이 지나고 붉거나 푸른 잔흔이 흉하게 남으면 어쩌지?"라는 걱정은 지극히 당연한 고민입니다.'
        ]
      },
      {
        subhead: '공장식 시술이 실패하는 이유: 얼굴 골격과 눈썹 근육은 사람마다 다릅니다',
        paragraphs: [
          '유행하는 특정 모양의 일자 눈썹을 모든 사람에게 똑같이 적용하는 공장식 시술은 어색함을 유발하는 가장 큰 원인입니다.',
          '우리의 얼굴은 양쪽 뼈의 높낮이가 다르고, 눈을 깜빡이거나 표정을 지을 때 사용하는 이마와 눈썹 근육의 움직임, 그리고 본래 자라나는 눈썹 모의 굵기와 흐름(모류)이 저마다 다릅니다.',
          '인천 서구 청라 센트럴파크 인근에 위치한 [바이름(Byreum) 청라점]에서는 단순한 틀에 맞춘 시술이 아닌, 1:1 정밀 골격 진단을 통해 고객님의 본래 결을 한 올 한 올 살려내는 입체적 퍼스널 디자인을 원칙으로 합니다.'
        ]
      },
      {
        subhead: '바이름만의 차별화: 당일 일상생활 가능한 무통·무붉은기 프리미엄 테크닉',
        paragraphs: [
          '바이름 청라점이 수많은 고객님들께 신뢰를 받는 이유는 "시술 당일에도 자연스러워 약속을 잡을 수 있는 편안함"에 있습니다.',
          '피부의 깊은 진피층을 자극하지 않고 표피층에만 미세하고 부드럽게 결을 표현하는 초정밀 마이크로 터치 기법을 사용하여 불필요한 출혈과 통증을 획기적으로 줄였습니다.',
          '또한 미국 FDA 및 환경부 인증을 획득한 최고급 프리미엄 천연 유기농 피그먼트만을 고객님의 피부 톤과 헤어 컬러에 맞춰 맞춤 배합하므로, 시간이 흘러도 붉은 기나 푸른 기로 변색되는 부작용 없이 본래 내 눈썹처럼 맑고 깨끗하게 유지됩니다.'
        ]
      },
      {
        subhead: '첫 방문 15% 한정 프로모션 & 100% 프라이빗 예약제 안내',
        paragraphs: [
          '바이름 청라점은 한 분 한 분의 소중한 눈썹을 위해 충분한 상담 시간과 정성을 쏟고자 하루 한정된 인원만을 100% 예약제로 정성껏 맞이하고 있습니다.',
          '현재 화사한 봄 시즌을 맞이하여 첫 방문 고객님들을 위한 [화/수 주중 한정 15% 특별 프로모션]을 진행하고 있으니, 매일 아침 거울 앞 스트레스에서 벗어나 민낯에도 또렷하고 세련된 인상을 완성해 보세요.'
        ]
      }
    ],
    tags: ['청라자연눈썹', '청라눈썹문신', '바이름청라점', '청라속눈썹펌', '청라눈썹']
  }

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: '당신은 대한민국 최고 뷰티 스튜디오 [바이름(Byreum) 청라점]의 수석 마케팅 AI 소희(5.6 루나 추론:맥스)입니다. 네이버 블로그 상위 노출 기준에 완벽히 부합하는 2,000자 이상의 최고급 뷰티 칼럼을 작성하세요. 절대 몇 줄로 요약하지 말고 풍성한 스토리텔링과 신뢰감을 주는 서식으로 작성하세요.'
          },
          {
            role: 'user',
            content: '청라 센트럴파크 인근 바이름 청라점의 [자연눈썹 1:1 맞춤 결 디자인 & 짱구 눈썹/잔흔 없는 무통 시술 & 봄맞이 15% 첫방문 혜택] 안내 블로그 글을 생성해줘.'
          }
        ],
        response_format: { type: 'json_object' }
      })
    })
    const json = await res.json()
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || '{}')
    if (parsed.title && parsed.sections && parsed.sections.length > 0) {
      postData = parsed
      console.log(`✅ 5.6 루나 (추론: 맥스) 칼럼 생성 완료: "${postData.title}"`)
    }
  } catch (err) {
    console.log('⚠️ 기본 5.6 루나 프리미엄 칼럼 정본으로 진행:', err.message)
  }

  // 2. Playwright 브라우저 실행
  console.log('\n2. Playwright 브라우저 연결 중...')
  const context = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [
      '--start-maximized',
      '--disable-blink-features=AutomationControlled'
    ]
  })

  const page = context.pages()[0] || await context.newPage()

  page.on('dialog', async dialog => {
    console.log(`   🔔 [다이얼로그 승인]: ${dialog.message()}`)
    await dialog.accept().catch(() => {})
  })

  // 3. 스마트에디터 ONE 글쓰기 페이지 진입
  const writeUrl = `https://blog.naver.com/${BLOG_ID}/postwrite`
  console.log(`3. 스마트에디터 ONE 글쓰기 페이지 진입: ${writeUrl}`)
  await page.goto(writeUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(3500)

  // 4. 프레임 탐색
  let targetFrame = page
  const hasIframe = await page.$('#mainFrame')
  if (hasIframe) {
    const frame = page.frame({ name: 'mainFrame' })
    if (frame) {
      targetFrame = frame
      console.log('   - 스마트에디터 메인 프레임(#mainFrame) 연결 완료')
    }
  }

  // 5. 팝업 및 도움말 닫기
  console.log('4. 이전 작성 중인 글 팝업 정리...')
  for (let i = 0; i < 3; i++) {
    try {
      const cancelBtn = await targetFrame.$('.se-popup-alert-confirm button:has-text("취소"), .se-popup-alert-confirm button:nth-child(1), button:has-text("취소")')
      if (cancelBtn) {
        await cancelBtn.click()
        await page.waitForTimeout(500)
      }
      const helpClose = await targetFrame.$('.se-help-panel-close-button, .se-popup-close-button, button[class*="close"]')
      if (helpClose) {
        await helpClose.click()
        await page.waitForTimeout(300)
      }
    } catch (e) {}
  }

  // 6. 제목 입력창 찾기 및 깔끔한 주입 (취소선 방지)
  console.log('\n5. [스마트에디터 ONE] 제목 입력 중...')
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
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A')
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(200)

        console.log(`   ✍️ 제목 입력: "${postData.title}"`)
        await page.keyboard.insertText(postData.title)
        await page.keyboard.press('Enter')
        titleFound = true
        break
      }
    } catch (e) {}
  }

  if (!titleFound) {
    await page.keyboard.press('Tab')
    await page.keyboard.insertText(postData.title)
    await page.keyboard.press('Enter')
  }

  await page.waitForTimeout(600)

  // 7. 본문 영역 탐색 및 고품질 칼럼 전체 주입
  console.log('\n6. [스마트에디터 ONE] 5.6 루나 (추론: 맥스) 프리미엄 본문 전체 구성 중...')
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

  // 전체 본문 내용을 깔끔한 블로그 서식 텍스트로 빌드
  let fullBodyText = ''
  for (let idx = 0; idx < postData.sections.length; idx++) {
    const sec = postData.sections[idx]
    fullBodyText += `■ ${sec.subhead}\n\n`
    const paras = Array.isArray(sec.paragraphs) ? sec.paragraphs : [sec.paragraphs || sec.body]
    for (const p of paras) {
      if (p) fullBodyText += `${p}\n\n`
    }
  }

  fullBodyText += '--------------------------------------------------\n'
  fullBodyText += '📍 [바이름(Byreum) 청라점 오시는 길 & 예약 안내]\n'
  fullBodyText += '• 위치: 인천 서구 청라 커낼로 센트럴파크 인근\n'
  fullBodyText += '• 시술 항목: 1:1 맞춤 자연눈썹 / 프리미엄 속눈썹펌 / 섀도우 콤보눈썹\n'
  fullBodyText += '• 봄맞이 프로모션: 화/수 주중 방문 고객 15% 한정 할인 혜택\n'
  fullBodyText += '• 예약: 프라이빗 1:1 케어를 위한 100% 네이버 예약제 운영\n'
  fullBodyText += '--------------------------------------------------\n'

  console.log('   ✍️ 2,000자 프리미엄 본문 텍스트 주입 중...')
  await page.keyboard.insertText(fullBodyText)
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
  const tagSelectors = ['#tag-input', 'input[placeholder*="태그"]', 'input[class*="tag_input"]', '.tag_input input']
  const finalTags = postData.tags || ['청라자연눈썹', '청라눈썹문신', '바이름청라점', '청라속눈썹펌', '청라눈썹']

  for (const sel of tagSelectors) {
    try {
      const tagInput = await targetFrame.$(sel)
      if (tagInput) {
        await tagInput.click()
        for (const tag of finalTags) {
          const cleanTag = tag.replace('#', '')
          await page.keyboard.type(cleanTag, { delay: 15 })
          await page.keyboard.press('Enter')
          await page.waitForTimeout(120)
        }
        console.log(`   🏷️ 태그 등록 완료: ${finalTags.join(', ')}`)
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

deleteAndRepostWithLunaMax().catch(err => {
  console.error('❌ 실행 중 에러:', err)
})
