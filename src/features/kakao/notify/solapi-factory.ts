/**
 * 솔라피 (Solapi) 카카오 알림톡 어댑터 팩토리 & 긴급 킬스위치 (KAPI-11/16)
 *
 * 운영 원칙:
 * - Fail-Closed: SOLAPI_ENABLED!=='true' 이거나 필수 키(API Key/Secret/PF ID) 부재 시
 *   어떤 경우에도 throw하지 않고 DryRun(enabled=false) 어댑터로 격리.
 * - 보안 철칙: API_KEY, API_SECRET 등 비밀값은 반환 객체/에러/로그에 절대 노출하지 않음.
 */

import {
  type AlimtalkAdapter,
  type AlimtalkSendRequest,
  type AlimtalkSendResult,
  type AlimtalkStatusResult,
  DryRunAlimtalkAdapter,
} from './alimtalk-contract'
import {
  SolapiAlimtalkAdapter,
} from './solapi-adapter'

export interface SolapiEnv {
  SOLAPI_ENABLED?: string
  SOLAPI_API_KEY?: string
  SOLAPI_API_SECRET?: string
  SOLAPI_PF_ID?: string
  SOLAPI_BASE_URL?: string
  /** JSON 객체 문자열: {"SOHEE_BOOKING_CONFIRMED_V1":"KA01TP..."} */
  SOLAPI_TEMPLATE_IDS?: string
  /** 시험 발송용 허용목록 (쉼표 구분 010 번호) */
  KAKAO_OUTBOX_TEST_ALLOWLIST?: string
  [key: string]: string | undefined
}

export interface SolapiFactoryDeps {
  fetchImpl?: typeof fetch
  now?: () => string
  saltGen?: () => string
}

export interface ConfiguredAlimtalkAdapter extends AlimtalkAdapter {
  readonly enabled: boolean
}

/**
 * 비밀값 은닉을 위한 안전한 어댑터 래퍼
 * JavaScript Private Identifier(#)를 사용하여
 * JSON.stringify, Object.keys 등 객체 순회/직렬화 시 내부 어댑터 및 비밀값이 노출되지 않도록 보호
 */
class SafeAlimtalkAdapterWrapper implements ConfiguredAlimtalkAdapter {
  readonly enabled: boolean
  #delegate: AlimtalkAdapter

  constructor(enabled: boolean, delegate: AlimtalkAdapter) {
    this.enabled = enabled
    this.#delegate = delegate
  }

  async send(request: AlimtalkSendRequest): Promise<AlimtalkSendResult> {
    return this.#delegate.send(request)
  }

  async readbackStatus(idempotencyKey: string): Promise<AlimtalkStatusResult> {
    return this.#delegate.readbackStatus(idempotencyKey)
  }
}

/**
 * 환경변수 및 주입 종속성 기반 알림톡 어댑터 생성 (Fail-Closed)
 *
 * @param env Cloudflare Workers / Node.js 환경변수
 * @param deps fetch 구현체, 시간/난수 생성 함수 등 종속성
 * @returns ConfiguredAlimtalkAdapter (enabled 여부 포함)
 */
export function createAlimtalkAdapterFromEnv(
  env?: SolapiEnv,
  deps?: SolapiFactoryDeps,
): ConfiguredAlimtalkAdapter {
  try {
    if (!env) {
      return new SafeAlimtalkAdapterWrapper(false, new DryRunAlimtalkAdapter())
    }

    const isEnabledFlag = env.SOLAPI_ENABLED === 'true'
    const apiKey = typeof env.SOLAPI_API_KEY === 'string' ? env.SOLAPI_API_KEY.trim() : ''
    const apiSecret =
      typeof env.SOLAPI_API_SECRET === 'string' ? env.SOLAPI_API_SECRET.trim() : ''
    const pfId = typeof env.SOLAPI_PF_ID === 'string' ? env.SOLAPI_PF_ID.trim() : ''

    // 킬스위치 또는 필수 파라미터 미충족 시 fail-closed DryRun 어댑터 반환
    if (!isEnabledFlag || !apiKey || !apiSecret || !pfId) {
      return new SafeAlimtalkAdapterWrapper(false, new DryRunAlimtalkAdapter())
    }

    const baseUrl =
      typeof env.SOLAPI_BASE_URL === 'string' && env.SOLAPI_BASE_URL.trim() !== ''
        ? env.SOLAPI_BASE_URL.trim()
        : undefined

    // 템플릿 ID 매핑은 항상 전달한다(미설정이면 빈 객체 → 매핑 없는 코드는 발송 거부).
    let templateIdMap: Record<string, string> = {}
    try {
      const parsed: unknown = JSON.parse(env.SOLAPI_TEMPLATE_IDS || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof v === 'string' && v.trim()) templateIdMap[k] = v.trim()
        }
      }
    } catch {
      templateIdMap = {}
    }

    const solapiAdapter = new SolapiAlimtalkAdapter({
      templateIdMap,
      apiKey,
      apiSecret,
      pfId,
      baseUrl,
      enabled: true,
      fetchImpl: deps?.fetchImpl,
      now: deps?.now,
      saltGen: deps?.saltGen,
    })

    return new SafeAlimtalkAdapterWrapper(true, solapiAdapter)
  } catch {
    // 어떤 예외가 발생하더라도 throw하지 않고 DryRun으로 안전 격리
    return new SafeAlimtalkAdapterWrapper(false, new DryRunAlimtalkAdapter())
  }
}
