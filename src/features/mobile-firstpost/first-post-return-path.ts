/**
 * ANI-1788 / ANI-1664: 첫 포스팅 안전 복귀 URL 정규화 및 검증.
 *
 * W12 13 tests 검증 완료본과 W7 PWA/복원 단일 소비 writer의 요구사항을 통합.
 *
 * 보안 및 안전 원칙:
 * - same-origin / http(s) 프로토콜 필수
 * - credentials, CRLF, control characters, backslash(\) 거부
 * - pathname allowlist: '/app/work/new', '/start/preview-r2', '/app/missions/{UUID}'
 * - query:
 *   - post: 정확히 1개의 유효 UUID 필수 (누락/중복/무효 형식 시 null 반환)
 *   - step: 'approval' 또는 'preview' 만 허용. approved 등 임의 승격 시도는 'preview'로 안전 정규화
 * - 반환 query: 오직 허용된 파라미터만 보존
 * - body, assetURL, fingerprint, workspace, PII, fragment(#) 등 민감 파라미터 완전 제거
 */

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ALLOWED_FIRST_POST_STEPS = ['preview', 'approval'] as const
export type AllowedFirstPostStep = (typeof ALLOWED_FIRST_POST_STEPS)[number]

const ALLOWED_PATHNAMES = new Set(['/app/work/new', '/start/preview-r2'])

export interface SafeFirstPostReturnPathOptions {
  missionId: string
  step?: string | null
}

/**
 * 첫 포스팅 안전 복귀 URL 정규화 함수 (오버로딩)
 *
 * 형태 1 (W12): input 문자열과 origin을 받아 same-origin 검증 및 쿼리 정규화 (유효하지 않으면 null)
 * 형태 2 (W7): { missionId, step } 옵션 객체를 받아 안전한 상대 경로 string 반환
 *
 * 두 형태 모두 임의 단계 승격(step=approved, result 등)을 불허하고 step=preview로 안전 정규화한다.
 */
export function safeFirstPostReturnPath(input: string, origin: string): string | null
export function safeFirstPostReturnPath(options: SafeFirstPostReturnPathOptions): string
export function safeFirstPostReturnPath(
  inputOrOptions: string | SafeFirstPostReturnPathOptions,
  origin?: string,
): string | null {
  // 형태 2: SafeFirstPostReturnPathOptions 객체
  if (typeof inputOrOptions === 'object' && inputOrOptions !== null) {
    const trimmedId = inputOrOptions.missionId?.trim() ?? ''
    if (!UUID_REGEX.test(trimmedId)) {
      return '/app'
    }

    const basePath = `/app/missions/${encodeURIComponent(trimmedId)}`
    if (inputOrOptions.step && typeof inputOrOptions.step === 'string') {
      const trimmedStep = inputOrOptions.step.trim().toLowerCase()
      // 특수문자/주입 시도 차단
      if (!/^[a-z_]+$/.test(trimmedStep)) {
        return basePath
      }
      if (trimmedStep === 'approval') {
        return `${basePath}?step=approval`
      }
      // 승격 시도(approved, result 등)나 preview는 preview로 안전 정규화
      if (trimmedStep === 'preview' || trimmedStep === 'approved' || trimmedStep === 'result') {
        return `${basePath}?step=preview`
      }
      // 알 수 없는 step은 쿼리 없이 기본 경로 반환
      return basePath
    }
    return basePath
  }

  // 형태 1: input URL string + origin
  const input = inputOrOptions
  if (typeof input !== 'string' || typeof origin !== 'string') {
    return null
  }

  // 1. CRLF, control characters, backslash 거부
  if (/[\r\n\u0000-\u001F\u007F\\]/.test(input) || /[\r\n\u0000-\u001F\u007F\\]/.test(origin)) {
    return null
  }

  // 2. Base origin 파싱
  let baseOriginUrl: URL
  try {
    baseOriginUrl = new URL(origin)
  } catch {
    return null
  }

  if (baseOriginUrl.protocol !== 'http:' && baseOriginUrl.protocol !== 'https:') {
    return null
  }
  if (baseOriginUrl.username || baseOriginUrl.password) {
    return null
  }

  // 3. Input URL 파싱
  let parsedUrl: URL
  try {
    parsedUrl = new URL(input, baseOriginUrl)
  } catch {
    return null
  }

  // 4. Protocol 검증 (http, https 만 허용)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return null
  }

  // 5. Credentials (user/password) 거부
  if (parsedUrl.username || parsedUrl.password) {
    return null
  }

  // 6. Same-origin 검증
  if (parsedUrl.origin !== baseOriginUrl.origin) {
    return null
  }

  // 7. Pathname allowlist 검증 ('/app/work/new' 또는 '/start/preview-r2')
  const pathname = parsedUrl.pathname
  if (!ALLOWED_PATHNAMES.has(pathname)) {
    return null
  }

  // 8. Raw query string 파싱 및 중복 파라미터 / 민감 파라미터 검사
  const searchParams = parsedUrl.searchParams
  const postValues = searchParams.getAll('post')

  // post 파라미터는 정확히 1개여야 함 (누락되거나 2개 이상 중복 시 null)
  if (postValues.length !== 1) {
    return null
  }

  const post = postValues[0]
  if (!UUID_REGEX.test(post)) {
    return null
  }

  // step 파라미터 처리:
  // step이 'approval'인 경우만 'approval' 유지, 그 외(누락, 'approved', 'draft', 'preview', 임의 문자열 등)는 모두 'preview'로 안전 정규화
  const stepValues = searchParams.getAll('step')
  let normalizedStep = 'preview'
  if (stepValues.length === 1 && stepValues[0] === 'approval') {
    normalizedStep = 'approval'
  }

  // 9. 오직 post와 step 두 파라미터만 포함하여 반환 (fragment 제거, 기타 모든 쿼리 파라미터 제거)
  const safeParams = new URLSearchParams()
  safeParams.set('post', post)
  safeParams.set('step', normalizedStep)

  return `${pathname}?${safeParams.toString()}`
}

/**
 * 임의의 returnPath 문자열을 파싱하여 첫 포스팅 복귀 경로로 유효한지 검증한다.
 * 공격 문자열이나 외부 URL, 허용되지 않은 쿼리는 모두 걸러내고 안전한 경로만 반환한다.
 */
export function parseFirstPostReturnPath(value: string | null | undefined): string {
  if (!value || typeof value !== 'string') {
    return '/app'
  }

  const trimmed = value.trim()
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) {
    return '/app'
  }

  try {
    const dummyOrigin = 'https://sohee.local'
    const parsed = new URL(trimmed, dummyOrigin)
    if (parsed.origin !== dummyOrigin) {
      return '/app'
    }

    const match = parsed.pathname.match(
      /^\/app\/missions\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
    )
    if (!match) {
      return '/app'
    }

    const missionId = match[1]
    const stepValues = parsed.searchParams.getAll('step')
    // step 파라미터가 누락된 경우 기본 복귀 경로 반환
    if (stepValues.length === 0) {
      return safeFirstPostReturnPath({ missionId })
    }
    // step이 정확히 1개이고 'approval'인 경우만 'approval' 유지.
    // 2개 이상 중복(step=approval&step=x 등)되거나 승격 시도(approved 등)는 form1과 동일하게 step=preview로 안전 정규화
    const stepParam =
      stepValues.length === 1 && stepValues[0].trim().toLowerCase() === 'approval'
        ? 'approval'
        : 'preview'
    return safeFirstPostReturnPath({ missionId, step: stepParam })
  } catch {
    return '/app'
  }
}
