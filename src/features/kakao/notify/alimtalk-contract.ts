/**
 * 알림톡 Outbox 어댑터 계약 (실발송 금지)
 * KAPI-12/11
 */

export class AlimtalkContractError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AlimtalkContractError'
  }
}

export type AlimtalkConsent = 'informational' | 'none'

export interface ValidateTemplateOptions {
  maxVariableLength?: number
  allowUnused?: boolean
}

export interface TemplateValidationResult {
  valid: boolean
  errors: string[]
  missing: string[]
  unused: string[]
  empty: string[]
  exceeded: string[]
  resolvedText?: string
}

const DEFAULT_MAX_VARIABLE_LENGTH = 500

/**
 * 템플릿 본문의 #{변수} 바인딩 검증
 * - 누락/미사용/빈값/길이 초과 검출
 */
export function validateTemplateVariables(
  template: string,
  vars: Record<string, unknown>,
  options?: ValidateTemplateOptions,
): TemplateValidationResult {
  const maxLen = options?.maxVariableLength ?? DEFAULT_MAX_VARIABLE_LENGTH
  const allowUnused = options?.allowUnused ?? false

  const templateVarMatches = template.match(/#\{([^}]+)\}/g) || []
  const templateVars = Array.from(new Set(templateVarMatches.map((m) => m.slice(2, -1).trim())))

  const providedKeys = Object.keys(vars)

  const missing: string[] = []
  const empty: string[] = []
  const exceeded: string[] = []
  const unused: string[] = []
  const errors: string[] = []

  // 1. Check template variables
  for (const varName of templateVars) {
    if (!(varName in vars) || vars[varName] === undefined) {
      missing.push(varName)
      errors.push(`필수 템플릿 변수가 누락되었습니다: #{${varName}}`)
      continue
    }

    const rawVal = vars[varName]
    if (rawVal === null || (typeof rawVal === 'string' && rawVal.trim() === '')) {
      empty.push(varName)
      errors.push(`템플릿 변수 값이 비어있습니다: #{${varName}}`)
      continue
    }

    const strVal = String(rawVal)
    if (strVal.length > maxLen) {
      exceeded.push(varName)
      errors.push(
        `템플릿 변수 길이가 허용 상한(${maxLen}자)을 초과했습니다: #{${varName}} (${strVal.length}자)`,
      )
    }
  }

  // 2. Check unused variables
  if (!allowUnused) {
    for (const key of providedKeys) {
      if (!templateVars.includes(key)) {
        unused.push(key)
        errors.push(`템플릿에 정의되지 않은 불필요한 변수입니다: ${key}`)
      }
    }
  }

  const valid =
    missing.length === 0 && empty.length === 0 && exceeded.length === 0 && unused.length === 0

  let resolvedText: string | undefined
  if (valid) {
    resolvedText = template.replace(/#\{([^}]+)\}/g, (_, key) => {
      const trimmedKey = key.trim()
      return String(vars[trimmedKey] ?? '')
    })
  }

  return {
    valid,
    errors,
    missing,
    unused,
    empty,
    exceeded,
    resolvedText,
  }
}

/**
 * 010 휴대전화만 E.164 (+8210...) 규격으로 정규화
 * 유선/인터넷전화/010 외 이동전화/국제번호/형식 오류 거부
 */
export function normalizeKrPhone(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new AlimtalkContractError('전화번호가 입력되지 않았습니다.')
  }

  const cleaned = raw.replace(/[\s\-().]/g, '')

  // E.164 국내 010 형태: +8210XXXXXXXX (13자)
  if (cleaned.startsWith('+82')) {
    const national = cleaned.slice(3)
    // +8210... 형태인지 확인
    if (national.startsWith('10') && national.length === 10 && /^\d+$/.test(national)) {
      return `+8210${national.slice(2)}`
    }
    if (national.startsWith('010') && national.length === 11 && /^\d+$/.test(national)) {
      return `+8210${national.slice(3)}`
    }
    throw new AlimtalkContractError('010 휴대전화만 알림톡 발송이 가능합니다.')
  }

  // 타 국가 국제 번호 거부
  if (cleaned.startsWith('+')) {
    throw new AlimtalkContractError('국내 010 휴대전화만 알림톡 발송이 가능합니다.')
  }

  // 유선 전화 (02, 031 등) 거부
  if (/^0[2-6][1-5]?\d{6,8}$/.test(cleaned) || cleaned.startsWith('02')) {
    throw new AlimtalkContractError('유선 전화번호는 알림톡 수신이 불가능합니다.')
  }

  // 인터넷 전화 (070) 거부
  if (cleaned.startsWith('070')) {
    throw new AlimtalkContractError('인터넷 전화(070)는 알림톡 수신이 불가능합니다.')
  }

  // 010 외 2G/구형 이동전화 번호 (011, 016, 017, 018, 019) 거부
  if (/^01[16789]/.test(cleaned)) {
    throw new AlimtalkContractError('010 휴대전화만 알림톡 발송이 가능합니다.')
  }

  // 010 국내 일반 형태: 010XXXXXXXX (11자리 숫자)
  if (/^010\d{8}$/.test(cleaned)) {
    return `+8210${cleaned.slice(3)}`
  }

  throw new AlimtalkContractError('유효하지 않은 010 휴대전화번호 형식입니다.')
}

export interface BuildIdempotencyKeyParams {
  workspaceId: string
  bookingId: string
  event: string
}

/**
 * 멱등키 생성: alimtalk:{workspaceId}:{bookingId}:{event}
 */
export function buildIdempotencyKey(params: BuildIdempotencyKeyParams): string {
  const { workspaceId, bookingId, event } = params

  if (!workspaceId || typeof workspaceId !== 'string' || workspaceId.trim() === '') {
    throw new AlimtalkContractError('workspaceId는 필수 입력값입니다.')
  }
  if (!bookingId || typeof bookingId !== 'string' || bookingId.trim() === '') {
    throw new AlimtalkContractError('bookingId는 필수 입력값입니다.')
  }
  if (!event || typeof event !== 'string' || event.trim() === '') {
    throw new AlimtalkContractError('event는 필수 입력값입니다.')
  }

  return `alimtalk:${workspaceId.trim()}:${bookingId.trim()}:${event.trim()}`
}

const ADVERTISING_REGEX =
  /(\(광고\)|\[광고\]|무료수신거부|할인쿠폰|특가이벤트|광고성|특가\s*이벤트|이벤트\s*할인)/i

/**
 * 알림톡 본문 및 변수에 광고성 문구가 포함되어 있는지 검출
 */
export function containsAdvertisingContent(text: string): boolean {
  return ADVERTISING_REGEX.test(text)
}

export interface AlimtalkSendRequest {
  idempotencyKey: string
  recipientPhone: string
  templateCode: string
  templateBody: string
  variables: Record<string, unknown>
  consent: AlimtalkConsent
  workspaceId?: string
  bookingId?: string
  event?: string
}

export interface AlimtalkSendResult {
  success: boolean
  status: 'DRY_RUN' | 'SENT' | 'REJECTED' | 'FAILED'
  idempotencyKey: string
  normalizedPhone?: string
  resolvedMessage?: string
  messageId?: never
  error?: string
  sentAt: string
}

export interface AlimtalkStatusResult {
  found: boolean
  status: 'DRY_RUN' | 'SENT' | 'FAILED' | 'NOT_FOUND'
  result?: AlimtalkSendResult
}

export interface AlimtalkAdapter {
  send(request: AlimtalkSendRequest): Promise<AlimtalkSendResult>
  readbackStatus(idempotencyKey: string): Promise<AlimtalkStatusResult>
}

/**
 * 네트워크 호출을 일절 수행하지 않고 입력값 검증만 수행하는 드라이런 어댑터
 * 가짜 messageId 발급 없이 status: 'DRY_RUN' 반환
 */
export class DryRunAlimtalkAdapter implements AlimtalkAdapter {
  private history = new Map<string, AlimtalkSendResult>()

  async send(request: AlimtalkSendRequest): Promise<AlimtalkSendResult> {
    const sentAt = new Date().toISOString()
    const idempotencyKey = request.idempotencyKey || 'unknown'

    // 1. Consent 검증 (동의 없는 수신자는 발송 거부)
    if (request.consent !== 'informational') {
      return {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        error: '정보성 알림 수신 동의가 없는 사용자입니다 (consent: none). 발송을 거부합니다.',
        sentAt,
      }
    }

    // 2. 광고성 문구 검출 (템플릿 본문 및 변수값)
    if (containsAdvertisingContent(request.templateBody)) {
      return {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        error: '알림톡 템플릿 본문에 광고성 문구가 포함되어 있어 발송이 거부되었습니다.',
        sentAt,
      }
    }

    for (const [key, value] of Object.entries(request.variables || {})) {
      if (typeof value === 'string' && containsAdvertisingContent(value)) {
        return {
          success: false,
          status: 'REJECTED',
          idempotencyKey,
          error: `알림톡 변수(${key})에 광고성 문구가 포함되어 있어 발송이 거부되었습니다.`,
          sentAt,
        }
      }
    }

    // 3. 수신자 전화번호 010 E.164 정규화 검증
    let normalizedPhone: string
    try {
      normalizedPhone = normalizeKrPhone(request.recipientPhone)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '유효하지 않은 전화번호'
      return {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        error: `수신자 전화번호 검증 실패: ${msg}`,
        sentAt,
      }
    }

    // 4. 템플릿 변수 정합성 검증
    const validation = validateTemplateVariables(request.templateBody, request.variables || {})
    if (!validation.valid) {
      return {
        success: false,
        status: 'REJECTED',
        idempotencyKey,
        error: `템플릿 변수 검증 실패: ${validation.errors.join(', ')}`,
        sentAt,
      }
    }

    // 5. 검증 완료 -> 가짜 messageId 없이 DRY_RUN 상태 반환
    const result: AlimtalkSendResult = {
      success: true,
      status: 'DRY_RUN',
      idempotencyKey,
      normalizedPhone,
      resolvedMessage: validation.resolvedText,
      sentAt,
    }

    this.history.set(idempotencyKey, result)
    return result
  }

  async readbackStatus(idempotencyKey: string): Promise<AlimtalkStatusResult> {
    const result = this.history.get(idempotencyKey)
    if (!result) {
      return {
        found: false,
        status: 'NOT_FOUND',
      }
    }

    return {
      found: true,
      status: result.status === 'DRY_RUN' ? 'DRY_RUN' : 'SENT',
      result,
    }
  }
}
