/**
 * 카카오 알림톡 운영 준비 상태(Readiness) 판정 모듈
 *
 * 카카오 비즈메시지 / 솔라피 운영 환경 변수 및 6종 템플릿 매핑 상태를 검증합니다.
 *
 * [보안 및 진단 원칙]
 * 1. 진단 출력은 boolean, 환경변수 이름(missing), 알려진 템플릿 코드(unmappedTemplateCodes)만 반환합니다.
 * 2. API 키, 시크릿, 솔라피 내부 템플릿 ID 등의 비밀값 및 민감 식별자는 반환 객체에 절대 포함하지 않습니다.
 * 3. 템플릿 ID 매핑 존재는 설정 준비(configurationReady)일 뿐 카카오 사전 심사 승인을 의미하지 않으므로,
 *    외부 API 실제 조회 전까지 approvalVerified 및 deliveryVerified는 항상 false입니다.
 */

import { ALIMTALK_TEMPLATE_LIST } from './templates'

export const REQUIRED_ALIMTALK_CONFIG_KEYS = [
  'SOLAPI_API_KEY',
  'SOLAPI_API_SECRET',
  'SOLAPI_PF_ID',
  'SOLAPI_WEBHOOK_SECRET',
] as const

export interface AlimtalkReadiness {
  /** 4개 필수 환경변수와 6종 템플릿 매핑이 모두 유효한지 여부 */
  configurationReady: boolean
  /** configurationReady가 충족되고 SOLAPI_ENABLED==='true'인지 여부 */
  liveEnabled: boolean
  /** 누락된 필수 환경변수 이름 목록 */
  missing: string[]
  /** 매핑되지 않은 알려진 알림톡 템플릿 코드 목록 */
  unmappedTemplateCodes: string[]
  /** 카카오/솔라피 외부 템플릿 심사 승인 검증 여부 (실제 API 조회 전 항상 false) */
  approvalVerified: false
  /** 실발송 성공 이력 검증 여부 (항상 false) */
  deliveryVerified: false
}

/**
 * 환경 변수 맵을 순수하게 검사하여 알림톡 발송 준비 상태를 진단합니다.
 *
 * @param env 환경 변수 레코드 (기본값: process.env)
 * @returns 진단 결과 객체
 */
export function evaluateAlimtalkReadiness(
  env: Record<string, string | undefined> = process.env,
): AlimtalkReadiness {
  // 1. 필수 스칼라 환경변수 4종 검증
  const missing: string[] = []
  for (const key of REQUIRED_ALIMTALK_CONFIG_KEYS) {
    const val = env[key]
    if (typeof val !== 'string' || val.trim().length === 0) {
      missing.push(key)
    }
  }

  // 2. SOLAPI_TEMPLATE_IDS JSON 파싱 및 객체 검증
  let parsedMap: Record<string, unknown> | null = null
  const rawTemplateIds = env.SOLAPI_TEMPLATE_IDS
  if (typeof rawTemplateIds === 'string' && rawTemplateIds.trim().length > 0) {
    try {
      const parsed = JSON.parse(rawTemplateIds)
      // 배열, 원시값, null 차단 - 순수 own key 객체만 허용
      if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
        parsedMap = parsed as Record<string, unknown>
      }
    } catch {
      parsedMap = null
    }
  }

  // 3. ALIMTALK_TEMPLATE_LIST 6종에 대해 own key nonblank string 여부 체크 (알려진 코드만 취급)
  const unmappedTemplateCodes: string[] = []
  for (const template of ALIMTALK_TEMPLATE_LIST) {
    const code = template.code
    if (!parsedMap || !Object.prototype.hasOwnProperty.call(parsedMap, code)) {
      unmappedTemplateCodes.push(code)
      continue
    }

    const val = parsedMap[code]
    if (typeof val !== 'string' || val.trim().length === 0) {
      unmappedTemplateCodes.push(code)
    }
  }

  // 4. 상태 플래그 계산
  // - configurationReady: 4종 키 + 6종 템플릿 매핑 완료
  // - liveEnabled: configurationReady && SOLAPI_ENABLED === 'true'
  // - approvalVerified: 외부 승인 증거 없이는 절대 true로 표현하지 않음
  // - deliveryVerified: 실제 발송 성공 전에는 항상 false
  const configurationReady = missing.length === 0 && unmappedTemplateCodes.length === 0
  const liveEnabled = configurationReady && env.SOLAPI_ENABLED === 'true'

  return {
    configurationReady,
    liveEnabled,
    missing,
    unmappedTemplateCodes,
    approvalVerified: false,
    deliveryVerified: false,
  }
}
