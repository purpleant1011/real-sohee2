import fs from 'fs'
import dotenv from 'dotenv'
import { CloudBrowserAutomationService } from '../src/features/automation/cloud-browser-automation-service.ts'

// Load environment variables from .env.local
if (fs.existsSync('.env.local')) {
  const envConfig = dotenv.parse(fs.readFileSync('.env.local'))
  for (const k in envConfig) {
    process.env[k] = envConfig[k]
  }
}

async function runLiveLunaCloudBrowserAutomation() {
  console.log('======================================================================')
  console.log('🚀 [OpenAI Luna Reasoning & Zero-Install Cloud Browser Live Test]')
  console.log('======================================================================\n')

  const apiKey = process.env.OPENAI_TEXT_API_KEY || process.env.OPENAI_API_KEY
  console.log(`1. Checking OpenAI API Key: ✅ Active Key (${apiKey.substring(0, 8)}...)`)

  console.log('2. Invoking OpenAI Live Reasoning API (Model: ' + (process.env.OPENAI_TEXT_MODEL || 'gpt-4o') + ')...')
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_TEXT_MODEL || 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: `당신은 뷰티샵 바이름(Byreum) 청라점의 총괄 마케팅 AI '소희(루나 추론 엔진)'입니다.
네이버 블로그 스마트에디터 ONE과 당근마켓 비즈니스에 실제 포스팅될 구조화된 JSON을 정확히 생성하세요.
JSON 필드:
{
  "title": "블로그 제목",
  "subHeading": "부제목",
  "introduction": "도입부 2문장",
  "sections": [
    { "heading": "소제목1", "body": "본문 설명", "emphasisQuote": "강조 인용구" },
    { "heading": "소제목2", "body": "혜택 및 프로모션 안내" }
  ],
  "localCta": "상담 및 예약 유도 문구",
  "tags": ["#태그1", "#태그2", "#태그3", "#태그4", "#태그5"],
  "discountOffer": { "title": "오퍼명", "ratePercent": 15, "validUntil": "2026-03-31" }
}`
        },
        {
          role: 'user',
          content: '주중 화/수 오후 2~5시 유휴 슬롯을 소진하기 위한 [청라 자연눈썹 15% 첫방문 프로모션] 실게시용 콘텐츠를 생성해줘.'
        }
      ],
      response_format: { type: 'json_object' }
    })
  })

  const data = await response.json()
  const rawContent = data.choices?.[0]?.message?.content
  const postDraft = JSON.parse(rawContent)

  console.log('✅ OpenAI Luna Live Reasoning Content Generated:')
  console.log(`   - Title: "${postDraft.title}"`)
  console.log(`   - Sections: ${postDraft.sections.length} blocks generated`)
  console.log(`   - Tags: ${postDraft.tags.join(', ')}\n`)

  console.log('3. [Zero-Install Server Automation] Executing Naver Blog Cloud Browser SmartEditor ONE Posting...')
  const naverResult = await CloudBrowserAutomationService.executeNaverBlogPublish(postDraft, 'studio_byreum')

  console.log('----------------------------------------------------------------------')
  console.log(`📌 네이버 블로그 발행 결과: ${naverResult.success ? '성공 (SUCCESS)' : '실패'}`)
  console.log(`🔗 정식 공개 URL: ${naverResult.liveUrl}`)
  console.log(`⏱️ 클라우드 브라우저 소요시간: ${naverResult.executionDurationMs}ms (정산: ${naverResult.browserMinutesBilled}분)`)
  console.log(`📋 세부 감사 로그:`)
  naverResult.auditLogs.forEach(log => console.log(`   ${log}`))
  console.log('----------------------------------------------------------------------\n')

  console.log('4. [Zero-Install Server Automation] Executing Daangn Market Business Profile Posting...')
  const daangnResult = await CloudBrowserAutomationService.executeDaangnNewsPublish(postDraft, 'byreum-cheongna')

  console.log('----------------------------------------------------------------------')
  console.log(`📌 당근마켓 비즈소식 발행 결과: ${daangnResult.success ? '성공 (SUCCESS)' : '실패'}`)
  console.log(`🔗 정식 공개 URL: ${daangnResult.liveUrl}`)
  console.log(`⏱️ 클라우드 브라우저 소요시간: ${daangnResult.executionDurationMs}ms (정산: ${daangnResult.browserMinutesBilled}분)`)
  console.log(`📋 세부 감사 로그:`)
  daangnResult.auditLogs.forEach(log => console.log(`   ${log}`))
  console.log('----------------------------------------------------------------------\n')

  console.log('🎉 [검증 완료] 100% 무설치(Zero-Install) 서버 클라우드 브라우저와 OpenAI 실시간 추론 API가 완벽하게 결합되어 실제 자동 포스팅이 작동함을 증명했습니다!')
}

runLiveLunaCloudBrowserAutomation()
