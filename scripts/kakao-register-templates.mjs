#!/usr/bin/env node
/**
 * 솔라피 (Solapi) 카카오 알림톡 템플릿 일괄 등록 스크립트 (KAPI-12)
 *
 * [보안 지침 및 실행 권한]
 * - 사용자가 실행, 에이전트는 비밀값을 보지 않는다.
 * - 기본 동작은 Dry-Run 모드입니다 (요청 본문만 stdout에 출력하며 네트워크 호출 일절 없음).
 * - 실제 등록은 사용자가 터미널에서 환경변수를 설정하고 `--execute` 플래그를 붙여 직접 실행합니다.
 *     export SOLAPI_API_KEY="..."
 *     export SOLAPI_API_SECRET="..."
 *     export SOLAPI_CHANNEL_ID="..."  # 또는 SOLAPI_PF_ID
 *     node scripts/kakao-register-templates.mjs --execute
 * - API Key, Secret 등 비밀값은 콘솔에 절대 출력되지 않으며 에러 발생 시에도 마스킹 처리됩니다.
 *
 * [근거 공식 문서 (SOLAPI Documentation)]
 * - 템플릿 추가 API (POST /kakao/v2/templates):
 *   https://solapi.com/developers/api/templates-createTemplate
 * - 템플릿 카테고리 조회 API (GET /kakao/v2/templates/categories):
 *   https://solapi.com/developers/api/templates-20260308-202022
 * - 카카오 알림톡 가이드:
 *   https://solapi.dev/guides/kakao-ata-guide
 *
 * [문서에서 확정된 필드]:
 * - channelId: 카카오 채널 ID (필수)
 * - name: 템플릿 이름 (문자열)
 * - content: 알림톡 본문 텍스트 (#{변수} 포함, 1,000자 이내)
 * - categoryCode: 카테고리 코드 (필수)
 * - messageType: 'BA' (기본형)
 * - buttons: 생략 (현재 6종 전 템플릿 버튼 미사용, 본문 전용 구성)
 *
 * [문서에서 확정 못 한 필드 / 주의사항 (TODO)]:
 * - TODO(categoryCode): 비즈니스 업종에 맞추어 GET /kakao/v2/templates/categories로 조회된 코드를 지정해야 합니다.
 *   미지정 시 기본 예제 코드('003001')가 사용됩니다.
 * - TODO(templateCode/templateId): 솔라피 API는 등록 시 사용자 정의 템플릿 코드를 받지 않고,
 *   등록 응답으로 고유한 `templateId`를 반환합니다.
 * - TODO(inspection): 등록 직후 상태는 'REGISTERED'이며, 실제 발송을 위해서는
 *   별도 카카오 검수 요청(POST /kakao/v2/templates/:templateId/inspection) 또는 솔라피 콘솔 검수 승인이 필요합니다.
 */

import crypto from 'node:crypto'
import { ALIMTALK_TEMPLATE_LIST } from '../src/features/kakao/notify/templates.ts'
import {
  buildSolapiTemplateCreateBody,
  DEFAULT_CATEGORY_CODE,
} from '../src/features/kakao/notify/solapi-template-payload.ts'

function printHelp() {
  console.log(`
사용법: node scripts/kakao-register-templates.mjs [옵션]

옵션:
  --execute                실제 솔라피 API(POST /kakao/v2/templates)를 호출하여 템플릿을 등록합니다.
                           (기본값은 dry-run 모드로 네트워크 호출 없이 페이로드만 출력)
  --channel-id <id>        솔라피 채널 ID (기본값: 환경변수 SOLAPI_CHANNEL_ID 또는 SOLAPI_PF_ID)
  --category-code <code>   카카오 템플릿 카테고리 코드 (기본값: ${DEFAULT_CATEGORY_CODE})
  --help, -h               이 도움말을 출력합니다.

환경변수:
  SOLAPI_API_KEY           솔라피 API Key (--execute 모드 필수)
  SOLAPI_API_SECRET        솔라피 API Secret (--execute 모드 필수)
  SOLAPI_CHANNEL_ID        솔라피 채널 ID (또는 SOLAPI_PF_ID, --execute 모드 필수)
  SOLAPI_CATEGORY_CODE     기본 카테고리 코드 오버라이드 (선택)
`)
}

/**
 * 솔라피 API Authorization 헤더 생성
 */
function createSolapiAuthHeader(apiKey, apiSecret) {
  const date = new Date().toISOString()
  const salt = crypto.randomBytes(16).toString('hex')
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(`${date}${salt}`)
    .digest('hex')

  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`
}

/**
 * 비밀값 마스킹 함수 (로그 노출 방지)
 */
function maskSecrets(text, secrets) {
  let result = String(text ?? '')
  for (const s of secrets) {
    if (s && typeof s === 'string' && s.length >= 4) {
      result = result.split(s).join('[MASKED]')
    }
  }
  result = result.replace(/apiKey=[^,\s&"']+/g, 'apiKey=[MASKED]')
  result = result.replace(/signature=[^,\s&"']+/g, 'signature=[MASKED]')
  result = result.replace(/Authorization:\s*HMAC-SHA256\s+[^\r\n]+/gi, 'Authorization: [MASKED]')
  return result
}

async function main() {
  const args = process.argv.slice(2)

  if (args.includes('--help') || args.includes('-h')) {
    printHelp()
    process.exit(0)
  }

  const isExecute = args.includes('--execute')

  let channelIdArg
  const channelIdIndex = args.indexOf('--channel-id')
  if (channelIdIndex !== -1 && args[channelIdIndex + 1]) {
    channelIdArg = args[channelIdIndex + 1]
  }

  let categoryCodeArg
  const categoryCodeIndex = args.indexOf('--category-code')
  if (categoryCodeIndex !== -1 && args[categoryCodeIndex + 1]) {
    categoryCodeArg = args[categoryCodeIndex + 1]
  }

  const channelId =
    channelIdArg ||
    process.env.SOLAPI_CHANNEL_ID ||
    process.env.SOLAPI_PF_ID ||
    (isExecute ? '' : 'CH_DRY_RUN_PREVIEW')

  const categoryCode =
    categoryCodeArg ||
    process.env.SOLAPI_CATEGORY_CODE ||
    DEFAULT_CATEGORY_CODE

  const apiKey = process.env.SOLAPI_API_KEY
  const apiSecret = process.env.SOLAPI_API_SECRET

  console.log('='.repeat(70))
  console.log('솔라피 카카오 알림톡 템플릿 등록 도구 (KAPI-12)')
  console.log(`모드: ${isExecute ? '▶ EXECUTE (실제 API 호출)' : '▷ DRY-RUN (요청 본문 미리보기)'}`)
  console.log(`대상 채널 ID: ${channelId || '(미지정)'}`)
  console.log(`카테고리 코드: ${categoryCode}`)
  console.log(`템플릿 총 개수: ${ALIMTALK_TEMPLATE_LIST.length}개`)
  console.log('='.repeat(70))

  if (!isExecute) {
    console.log('\n[DRY-RUN] 아래 6종 템플릿의 솔라피 등록 페이로드를 생성합니다 (네트워크 호출 없음):\n')

    for (let i = 0; i < ALIMTALK_TEMPLATE_LIST.length; i++) {
      const template = ALIMTALK_TEMPLATE_LIST[i]
      const payload = buildSolapiTemplateCreateBody(template, {
        channelId,
        categoryCode,
      })

      console.log(`--- [${i + 1}/${ALIMTALK_TEMPLATE_LIST.length}] ${template.code} (${template.name}) ---`)
      console.log(JSON.stringify(payload, null, 2))
      console.log('')
    }

    console.log('='.repeat(70))
    console.log('✔ Dry-Run 검증 완료. 네트워크 호출은 수행되지 않았습니다.')
    console.log('실제 솔라피 등록을 진행하려면 환경변수를 세팅하고 --execute 플래그를 추가하십시오:')
    console.log('  export SOLAPI_API_KEY="your_api_key"')
    console.log('  export SOLAPI_API_SECRET="your_api_secret"')
    console.log('  export SOLAPI_CHANNEL_ID="your_channel_id"')
    console.log('  node scripts/kakao-register-templates.mjs --execute')
    console.log('='.repeat(70))
    return
  }

  // --- EXECUTE 모드 ---
  const missingEnv = []
  if (!apiKey) missingEnv.push('SOLAPI_API_KEY')
  if (!apiSecret) missingEnv.push('SOLAPI_API_SECRET')
  if (!channelId) missingEnv.push('SOLAPI_CHANNEL_ID (또는 SOLAPI_PF_ID, --channel-id)')

  if (missingEnv.length > 0) {
    console.error('\n❌ 실행 오류: 실제 등록(--execute)에 필요한 환경변수가 누락되었습니다:')
    for (const envName of missingEnv) {
      console.error(`  - ${envName}`)
    }
    console.error('\n환경변수를 설정한 뒤 다시 실행해 주세요 (비밀값은 안전하게 관리하십시오).')
    process.exit(1)
  }

  console.log('\n▶ 솔라피 API(POST https://api.solapi.com/kakao/v2/templates)로 등록을 시작합니다...\n')

  let successCount = 0
  let failCount = 0
  const results = []

  for (let i = 0; i < ALIMTALK_TEMPLATE_LIST.length; i++) {
    const template = ALIMTALK_TEMPLATE_LIST[i]
    const payload = buildSolapiTemplateCreateBody(template, {
      channelId,
      categoryCode,
    })

    console.log(`[${i + 1}/${ALIMTALK_TEMPLATE_LIST.length}] 등록 요청: ${template.code} (${template.name})...`)

    try {
      const authHeader = createSolapiAuthHeader(apiKey, apiSecret)
      const response = await fetch('https://api.solapi.com/kakao/v2/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      })

      const rawText = await response.text()
      let responseJson
      try {
        responseJson = JSON.parse(rawText)
      } catch {
        responseJson = { raw: rawText }
      }

      if (!response.ok) {
        failCount++
        const errorMsg = maskSecrets(
          `HTTP ${response.status}: ${JSON.stringify(responseJson)}`,
          [apiKey, apiSecret, authHeader],
        )
        console.error(`  ✖ 실패: ${errorMsg}`)
        results.push({ code: template.code, status: 'FAILED', error: errorMsg })
      } else {
        successCount++
        const templateId = responseJson.templateId || responseJson._id || '발급완료'
        console.log(`  ✔ 성공: templateId = ${templateId}`)
        results.push({ code: template.code, status: 'SUCCESS', templateId })
      }
    } catch (err) {
      failCount++
      const errorMsg = maskSecrets(err instanceof Error ? err.message : String(err), [
        apiKey,
        apiSecret,
      ])
      console.error(`  ✖ 네트워크/시스템 에러: ${errorMsg}`)
      results.push({ code: template.code, status: 'ERROR', error: errorMsg })
    }
  }

  console.log('\n' + '='.repeat(70))
  console.log(`등록 완료 요약: 성공 ${successCount}건 / 실패 ${failCount}건`)
  console.log('='.repeat(70))

  if (failCount > 0) {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('치명적 오류 발생:', err instanceof Error ? err.message : String(err))
  process.exit(1)
})
