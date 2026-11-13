/**
 * 솔라피 (Solapi) 카카오 알림톡 어댑터
 * KAPI-11
 *
 * Cloudflare Workers 환경 호환:
 * - node:crypto 배제, Web Crypto API (crypto.subtle) 기반 HMAC-SHA256 인증
 * - fetch 기반 RESTful 통신 (기본 비활성 DRY_RUN)
 * - 010 국내 번호만 허용 (normalizeKrPhone)
 * - 비밀키 및 서명 마스킹
 */

import {
  type AlimtalkAdapter,
  type AlimtalkSendRequest,
  type AlimtalkSendResult,
  type AlimtalkStatusResult,
  containsAdvertisingContent,
  normalizeKrPhone,
  validateTemplateVariables,
} from './alimtalk-contract'

export interface SolapiSendResult extends AlimtalkSendResult {
  reason?: string
  errorCode?: string
}

export interface SolapiAlimtalkAdapterOptions {
  apiKey: string
  apiSecret: string
  pfId?: string
  fetchImpl?: typeof fetch
  now?: () => string
  saltGen?: () => string
  enabled?: boolean
  baseUrl?: string
  /**
   * 우리 템플릿 코드 → 솔라피가 발급한 templateId. 지정되면(빈 객체 포함) 매핑이 없는 코드는 실발송하지 않는다.
   * 미지정이면 기존처럼 코드를 그대로 templateId 로 쓴다(테스트·호환용).
   */
  templateIdMap?: Record<string, string>
}

/**
 * Web Crypto API (crypto.subtle) 기반 HMAC-SHA256 서명 생성
 * node:crypto 의존성 전면 배제 (Cloudflare Workers 런타임 호환)
 */
export async function createSolapiSignature(
  apiSecret: string,
  date: string,
  salt: string,
): Promise<string> {
  const enc = new TextEncoder()
  const keyData = enc.encode(apiSecret)
  const messageData = enc.encode(`${date}${salt}`)

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )

  const signatureBuffer = await crypto.subtle.sign('HMAC', cryptoKey, messageData)
  const hashArray = Array.from(new Uint8Array(signatureBuffer))
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * 솔라피 Authorization 헤더 생성
 * 포맷: HMAC-SHA256 apiKey=<API_KEY>, date=<DATE>, salt=<SALT>, signature=<SIGNATURE>
 */
export async function createSolapiAuthHeader(params: {
  apiKey: string
  apiSecret: string
  date: string
  salt: string
}): Promise<string> {
  const signature = await createSolapiSignature(params.apiSecret, params.date, params.salt)
  return `HMAC-SHA256 apiKey=${params.apiKey}, date=${params.date}, salt=${params.salt}, signature=${signature}`
}

/**
 * 에러 메시지나 응답에 포함될 수 있는 비밀 정보(apiKey, apiSecret, signature, 헤더 등) 마스킹
 */
export function maskSecrets(
  text: string,
  secrets: Array<string | undefined | null>,
): string {
  let result = text
  for (const s of secrets) {
    if (s && s.length >= 4) {
      result = result.split(s).join('[MASKED]')
    }
  }

  // 정규식 기반 공통 비밀 패턴 마스킹
  result = result.replace(/apiKey=[^,\s&"']+/g, 'apiKey=[MASKED]')
  result = result.replace(/signature=[^,\s&"']+/g, 'signature=[MASKED]')
  result = result.replace(/Authorization:\s*HMAC-SHA256\s+[^\r\n]+/gi, 'Authorization: [MASKED]')
  return result
}

function defaultSaltGen(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 임의의 문자열을 대문자 스네이크 케이스로 정규화
 * 예: InvalidApiKey -> INVALID_API_KEY, invalid-api-key -> INVALID_API_KEY
 */
export function normalizeToSnakeUpper(val: string): string {
  return val
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z\d]+)/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
}

/**
 * 에러 코드를 안전한 정규식(^[A-Z0-9_]{1,40}$) 규격에 맞게 정제 및 절단
 * 응답 본문 원문/메시지 텍스트는 코드에 넣지 않고 영문 대문자, 숫자, 언더스코어만 허용
 */
export function sanitizeErrorCode(code: string): string {
  const cleaned = code
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .slice(0, 40)
  return /^[A-Z0-9_]{1,40}$/.test(cleaned) ? cleaned : 'UNKNOWN'
}

/**
 * 솔라피 kakaoOptions.variables 포맷팅
 * 솔라피 공식 권장: #{변수명}: 값
 */
function formatSolapiVariables(vars: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, val] of Object.entries(vars)) {
    const formattedKey = key.startsWith('#{') && key.endsWith('}') ? key : `#{${key}}`
    result[formattedKey] = String(val ?? '')
  }
  return result
}

/**
 * 캐시된 발송 결과를 readbackStatus 규격으로 안전하게 매핑.
 * 계약에 없는 REJECTED 상태나 FAILED 상태는 FAILED로 매핑하여 false success('SENT')를 원천 방지한다.
 */
function resolveCachedReadbackStatus(
  status: AlimtalkSendResult['status'],
): 'DRY_RUN' | 'SENT' | 'FAILED' {
  if (status === 'DRY_RUN') return 'DRY_RUN'
  if (status === 'SENT') return 'SENT'
  return 'FAILED'
}

export class SolapiAlimtalkAdapter implements AlimtalkAdapter {
  private readonly apiKey: string
  private readonly apiSecret: string
  private readonly pfId: string
  private readonly fetchImpl: typeof fetch
  private readonly now: () => string
  private readonly saltGen: () => string
  private readonly enabled: boolean
  private readonly baseUrl: string
  private readonly templateIdMap?: Record<string, string>

  // 멱등키 -> 발송 결과/메시지ID 매핑 캐시
  private history = new Map<string, SolapiSendResult>()
  private idempotencyToMessageId = new Map<string, string>()

  constructor(options: SolapiAlimtalkAdapterOptions) {
    this.apiKey = options.apiKey
    this.apiSecret = options.apiSecret
    this.pfId = options.pfId ?? ''
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch
    this.now = options.now ?? (() => new Date().toISOString())
    this.saltGen = options.saltGen ?? defaultSaltGen
    this.enabled = options.enabled ?? false
    this.templateIdMap = options.templateIdMap
    this.baseUrl = (options.baseUrl ?? 'https://api.solapi.com').replace(/\/+$/, '')
  }

  async send(request: AlimtalkSendRequest): Promise<SolapiSendResult> {
    const sentAt = this.now()
    const idempotencyKey = request.idempotencyKey || 'unknown'

    // 1. Consent 검증 (동의 없는 수신자는 발송 거부)
    if (request.consent !== 'informational') {
      const result: SolapiSendResult = {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        errorCode: 'LOCAL_CONSENT',
        error: '정보성 알림 수신 동의가 없는 사용자입니다 (consent: none). 발송을 거부합니다.',
        reason: '정보성 알림 수신 동의가 없는 사용자입니다 (consent: none). 발송을 거부합니다.',
        sentAt,
      }
      this.history.set(idempotencyKey, result)
      return result
    }

    // 2. 광고성 문구 검출 (템플릿 본문 및 변수값)
    if (containsAdvertisingContent(request.templateBody)) {
      const result: SolapiSendResult = {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        errorCode: 'LOCAL_AD',
        error: '알림톡 템플릿 본문에 광고성 문구가 포함되어 있어 발송이 거부되었습니다.',
        reason: '알림톡 템플릿 본문에 광고성 문구가 포함되어 있어 발송이 거부되었습니다.',
        sentAt,
      }
      this.history.set(idempotencyKey, result)
      return result
    }

    for (const [key, value] of Object.entries(request.variables || {})) {
      if (typeof value === 'string' && containsAdvertisingContent(value)) {
        const result: SolapiSendResult = {
          success: false,
          status: 'REJECTED',
          idempotencyKey,
          errorCode: 'LOCAL_AD',
          error: `알림톡 변수(${key})에 광고성 문구가 포함되어 있어 발송이 거부되었습니다.`,
          reason: `알림톡 변수(${key})에 광고성 문구가 포함되어 있어 발송이 거부되었습니다.`,
          sentAt,
        }
        this.history.set(idempotencyKey, result)
        return result
      }
    }

    // 3. 수신자 전화번호 010 E.164 정규화 검증
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeKrPhone(request.recipientPhone)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 전화번호'
      const result: SolapiSendResult = {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        errorCode: 'LOCAL_PHONE',
        error: `수신자 전화번호 검증 실패: ${msg}`,
        reason: `수신자 전화번호 검증 실패: ${msg}`,
        sentAt,
      }
      this.history.set(idempotencyKey, result)
      return result
    }

    // 4. 템플릿 변수 정합성 검증
    const validation = validateTemplateVariables(request.templateBody, request.variables || {})
    if (!validation.valid) {
      const errMsg = `템플릿 변수 검증 실패: ${validation.errors.join(', ')}`
      const result: SolapiSendResult = {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        errorCode: 'LOCAL_VARIABLES',
        error: errMsg,
        reason: errMsg,
        sentAt,
      }
      this.history.set(idempotencyKey, result)
      return result
    }

    // 5. 기본 비활성 (enabled=false) 모드: 네트워크 호출 없이 DRY_RUN 반환
    if (!this.enabled) {
      const dryRunResult: SolapiSendResult = {
        success: true,
        status: 'DRY_RUN',
        idempotencyKey,
        normalizedPhone,
        resolvedMessage: validation.resolvedText,
        sentAt,
      }
      this.history.set(idempotencyKey, dryRunResult)
      return dryRunResult
    }

    // 5-1. 솔라피 templateId 해석: 매핑이 설정돼 있으면 매핑 없는 코드는 발송하지 않는다(잘못된 ID 로 호출 방지).
    let resolvedTemplateId = request.templateCode
    if (this.templateIdMap) {
      const mapped = this.templateIdMap[request.templateCode]
      if (!mapped) {
        const msg = `솔라피 templateId 가 매핑되지 않은 템플릿입니다: ${request.templateCode}`
        const result: SolapiSendResult = {
          success: false,
          status: 'FAILED',
          idempotencyKey,
          errorCode: 'LOCAL_TEMPLATE_UNMAPPED',
          error: msg,
          reason: msg,
          sentAt,
        }
        this.history.set(idempotencyKey, result)
        return result
      }
      resolvedTemplateId = mapped
    }

    // 6. 실발송 (enabled=true) 모드: 솔라피 API 호출
    try {
      const date = this.now()
      const salt = this.saltGen()
      const authHeader = await createSolapiAuthHeader({
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        date,
        salt,
      })

      // 솔라피 규격: 한국 번호는 010... (숫자만), country: '82'
      // normalizeKrPhone(+8210XXXXXXXX) -> 010XXXXXXXX
      const localPhone = normalizedPhone.startsWith('+8210')
        ? `010${normalizedPhone.slice(5)}`
        : normalizedPhone.replace(/^\+82/, '0')

      // TODO: 솔라피 kakaoOptions의 buttons 필드(웹링크, 앱링크, 봇키워드 등)는 현재 KAPI-11 명세에서 미확인 상태이므로 제외.
      // TODO: fallback SMS (disableSms: false) 및 LMS/MMS 전환 발송 옵션은 추후 필요 시 추가 연동.
      const payload = {
        messages: [
          {
            to: localPhone,
            country: '82',
            kakaoOptions: {
              pfId: this.pfId,
              templateId: resolvedTemplateId,
              variables: formatSolapiVariables(request.variables || {}),
              disableSms: true,
            },
            customFields: {
              idempotencyKey,
            },
          },
        ],
      }

      const response = await this.fetchImpl(`${this.baseUrl}/messages/v4/send-many/detail`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader,
        },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText)
        let parsedErrorCode = ''
        try {
          const parsed = JSON.parse(errorText)
          if (parsed && typeof parsed.errorCode === 'string' && parsed.errorCode.trim()) {
            parsedErrorCode = normalizeToSnakeUpper(parsed.errorCode.trim())
          }
        } catch {
          // non-JSON response
        }

        const rawHttpCode = parsedErrorCode
          ? `HTTP_${response.status}_${parsedErrorCode}`
          : `HTTP_${response.status}`
        const errorCode = sanitizeErrorCode(rawHttpCode)

        const masked = maskSecrets(
          `Solapi API HTTP ${response.status}: ${errorText}`,
          [this.apiKey, this.apiSecret, authHeader],
        )
        const failResult: SolapiSendResult = {
          success: false,
          status: 'FAILED',
          idempotencyKey,
          errorCode,
          error: masked,
          reason: masked,
          sentAt,
        }
        this.history.set(idempotencyKey, failResult)
        return failResult
      }

      const responseData = (await response.json()) as {
        groupInfo?: { groupId?: string }
        failedMessageList?: Array<{ to?: string; statusCode?: string; reason?: string }>
        messageList?: Record<string, { messageId?: string; statusCode?: string; status?: string }>
      }

      // 발송 실패 목록 검사
      if (responseData.failedMessageList && responseData.failedMessageList.length > 0) {
        const firstFail = responseData.failedMessageList[0]
        const rawStatus =
          typeof firstFail?.statusCode === 'string' || typeof firstFail?.statusCode === 'number'
            ? String(firstFail.statusCode).trim()
            : ''
        const cleanStatus = rawStatus.replace(/[^0-9]/g, '') || rawStatus.replace(/[^A-Z0-9_]/gi, '').toUpperCase()
        const rawFailedCode = cleanStatus ? `SOLAPI_${cleanStatus}` : 'SOLAPI_UNKNOWN'
        const errorCode = sanitizeErrorCode(rawFailedCode)

        const rawReason = firstFail?.reason || `Solapi status ${firstFail?.statusCode || 'UNKNOWN'}`
        const masked = maskSecrets(rawReason, [this.apiKey, this.apiSecret, authHeader])
        const failResult: SolapiSendResult = {
          success: false,
          status: 'FAILED',
          idempotencyKey,
          errorCode,
          error: masked,
          reason: masked,
          sentAt,
        }
        this.history.set(idempotencyKey, failResult)
        return failResult
      }

      // 발급된 messageId 추출 및 매핑
      if (responseData.messageList) {
        const messageIds = Object.keys(responseData.messageList)
        if (messageIds.length > 0 && messageIds[0]) {
          this.idempotencyToMessageId.set(idempotencyKey, messageIds[0])
        }
      }

      const successResult: SolapiSendResult = {
        success: true,
        status: 'SENT',
        idempotencyKey,
        normalizedPhone,
        resolvedMessage: validation.resolvedText,
        sentAt,
      }

      this.history.set(idempotencyKey, successResult)
      return successResult
    } catch (err) {
      const rawError = err instanceof Error ? err.message : String(err)
      const masked = maskSecrets(rawError, [this.apiKey, this.apiSecret])
      const failResult: SolapiSendResult = {
        success: false,
        status: 'FAILED',
        idempotencyKey,
        errorCode: 'NETWORK_EXCEPTION',
        error: masked,
        reason: masked,
        sentAt,
      }
      this.history.set(idempotencyKey, failResult)
      return failResult
    }
  }

  async readbackStatus(idempotencyKey: string): Promise<AlimtalkStatusResult> {
    // 1. 비활성 모드인 경우 메모리 히스토리에서만 확인
    if (!this.enabled) {
      const cached = this.history.get(idempotencyKey)
      if (!cached) {
        return { found: false, status: 'NOT_FOUND' }
      }
      return {
        found: true,
        status: resolveCachedReadbackStatus(cached.status),
        result: cached,
      }
    }

    // 2. 실발송 모드: 솔라피 조회 API 호출
    try {
      const date = this.now()
      const salt = this.saltGen()
      const authHeader = await createSolapiAuthHeader({
        apiKey: this.apiKey,
        apiSecret: this.apiSecret,
        date,
        salt,
      })

      const messageId = this.idempotencyToMessageId.get(idempotencyKey)

      // TODO: 솔라피 GET /messages/v4/list API는 customFields 기반 서버사이드 쿼리(criteria)를 공식 지원하지 않습니다.
      // 따라서 사전에 매핑된 messageId가 있는 경우 해당 messageId로 조회하고, 없는 경우 최근 목록에서 customFields를 클라이언트 탐색합니다.
      let queryUrl = `${this.baseUrl}/messages/v4/list?limit=50`
      if (messageId) {
        queryUrl = `${this.baseUrl}/messages/v4/list?criteria=messageId&cond=eq&value=${encodeURIComponent(messageId)}`
      }

      const response = await this.fetchImpl(queryUrl, {
        method: 'GET',
        headers: {
          Authorization: authHeader,
        },
      })

      if (!response.ok) {
        // API 조회 실패 시 캐시가 있으면 캐시 반환
        const cached = this.history.get(idempotencyKey)
        if (cached) {
          return {
            found: true,
            status: resolveCachedReadbackStatus(cached.status),
            result: cached,
          }
        }
        return { found: false, status: 'NOT_FOUND' }
      }

      const data = (await response.json()) as {
        messageList?: Record<
          string,
          {
            messageId?: string
            statusCode?: string
            status?: string
            customFields?: Record<string, string>
          }
        >
      }

      if (!data.messageList || Object.keys(data.messageList).length === 0) {
        return { found: false, status: 'NOT_FOUND' }
      }

      let matchedMsg: { messageId?: string; statusCode?: string; status?: string } | undefined

      if (messageId && data.messageList[messageId]) {
        matchedMsg = data.messageList[messageId]
      } else {
        // customFields.idempotencyKey 일치 메시지 검색
        for (const msg of Object.values(data.messageList)) {
          if (msg.customFields?.idempotencyKey === idempotencyKey) {
            matchedMsg = msg
            break
          }
        }
      }

      if (!matchedMsg) {
        return { found: false, status: 'NOT_FOUND' }
      }

      const solapiStatus = matchedMsg.status?.toUpperCase()
      let status: 'SENT' | 'FAILED' = 'SENT'
      if (solapiStatus === 'FAILED') {
        status = 'FAILED'
      }

      const cached = this.history.get(idempotencyKey)
      return {
        found: true,
        status,
        result: cached,
      }
    } catch {
      const cached = this.history.get(idempotencyKey)
      if (cached) {
        return {
          found: true,
          status: resolveCachedReadbackStatus(cached.status),
          result: cached,
        }
      }
      return { found: false, status: 'NOT_FOUND' }
    }
  }
}
