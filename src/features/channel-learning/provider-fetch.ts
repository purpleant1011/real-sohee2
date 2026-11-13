import { LearningError } from './contracts'

export class ProviderTransportError extends LearningError {
  readonly status: number

  constructor(status: number, message?: string) {
    super(
      'PROVIDER_HTTP_ERROR',
      message ?? `[PROVIDER_HTTP_ERROR] 공급자 요청 실패 (HTTP 상태 코드: ${status})`,
    )
    this.status = status
    this.name = 'ProviderTransportError'
  }
}

const OFFICIAL_PROVIDER_ORIGINS = {
  instagram: 'https://graph.instagram.com',
  threads: 'https://graph.threads.net',
} as const

// 허용된 안전 경로 목록 (Path traversal이나 임의 API 호출 차단)
const ALLOWED_PATH_PATTERNS = [
  /^\/me\/?$/,
  /^\/me\/media\/?$/,
  /^\/me\/threads\/?$/,
  /^\/\d+\/?$/,
  /^\/\d+\/(?:children|insights)\/?$/,
]

// 안전한 미디어 CDN 호스트 Allowlist
const ALLOWED_MEDIA_DOMAINS = [
  'cdninstagram.com',
  'fbcdn.net',
  'threads.net',
]

// 허용되는 안전 래스터 이미지 MIME (SVG/HTML/동영상 등은 지식 이미지 학습 대상에서 거부)
const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
])

export interface ProviderFetchDeps {
  fetch?: (url: string | URL, init?: RequestInit) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  timeoutMs?: number
}

export interface FetchLearningProviderInput {
  provider: 'instagram' | 'threads'
  path: string
  accessToken: string
  maxBytes: number
  query?: Record<string, string>
}

export interface SafeMediaResult {
  data: Uint8Array
  contentType: string
}

function assertApprovedPath(path: string): void {
  if (/%2e|\.\./i.test(path) || path.includes('/./')) {
    throw new LearningError('UNAUTHORIZED_PROVIDER_PATH', '[UNAUTHORIZED_PROVIDER_PATH] 경로 탐색 문자는 허용되지 않습니다.')
  }

  const cleanPath = path.split('?')[0]
  const isAllowed = ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(cleanPath))
  if (!isAllowed) {
    throw new LearningError(
      'UNAUTHORIZED_PROVIDER_PATH',
      `[UNAUTHORIZED_PROVIDER_PATH] 승인되지 않은 공급자 경로입니다: ${cleanPath}`,
    )
  }
}

function isApprovedMediaHost(host: string): boolean {
  const normalizedHost = host.toLowerCase()
  return ALLOWED_MEDIA_DOMAINS.some(
    (domain) => normalizedHost === domain || normalizedHost.endsWith(`.${domain}`),
  )
}

// 스트림을 점진적으로 읽으며 maxBytes를 초과하는 즉시 스트림을 cancel하여 무제한 메모리 할당 차단
async function readStreamBounded(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  const contentLength = response.headers.get('content-length')
  if (contentLength && parseInt(contentLength, 10) > maxBytes) {
    throw new LearningError('PAYLOAD_TOO_LARGE', '[PAYLOAD_TOO_LARGE] 응답 크기가 상한을 초과했습니다.')
  }

  if (!response.body) {
    const rawBuffer = await response.arrayBuffer()
    if (rawBuffer.byteLength > maxBytes) {
      throw new LearningError('PAYLOAD_TOO_LARGE', '[PAYLOAD_TOO_LARGE] 응답 크기가 상한을 초과했습니다.')
    }
    return new Uint8Array(rawBuffer)
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        totalBytes += value.byteLength
        if (totalBytes > maxBytes) {
          await reader.cancel('payload too large')
          throw new LearningError('PAYLOAD_TOO_LARGE', '[PAYLOAD_TOO_LARGE] 응답 크기가 상한을 초과했습니다.')
        }
        chunks.push(value)
      }
    }
  } catch (err) {
    if (err instanceof LearningError) throw err
    throw new LearningError('STREAM_READ_ERROR', '[STREAM_READ_ERROR] 응답 스트림 수신 중 오류가 발생했습니다.')
  }

  const result = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function verifyImageMagicBytes(bytes: Uint8Array, mimeType: string): void {
  if (bytes.length < 12) {
    throw new LearningError('INVALID_MEDIA_FORMAT', '[INVALID_MEDIA_FORMAT] 미디어 데이터가 너무 작습니다.')
  }

  // JPEG: FF D8 FF
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff

  // PNG: 89 50 4E 47 (0x89 'P' 'N' 'G')
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47

  // WebP: bytes 0..3 'RIFF', bytes 8..11 'WEBP'
  const isRiff =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46
  const isWebp =
    isRiff &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50

  const matchesMime =
    (mimeType.includes('jpeg') && isJpeg) ||
    (mimeType.includes('jpg') && isJpeg) ||
    (mimeType.includes('png') && isPng) ||
    (mimeType.includes('webp') && isWebp)

  if (!matchesMime && !(isJpeg || isPng || isWebp)) {
    throw new LearningError('INVALID_MEDIA_FORMAT', '[INVALID_MEDIA_FORMAT] 이미지 파일의 매직 바이트가 유효하지 않습니다.')
  }
}

export async function fetchLearningProvider(
  input: FetchLearningProviderInput,
  deps?: ProviderFetchDeps,
): Promise<unknown> {
  const fetchImpl = deps?.fetch ?? globalThis.fetch
  const sleepImpl = deps?.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const timeoutMs = deps?.timeoutMs ?? 10000

  assertApprovedPath(input.path)

  const origin = OFFICIAL_PROVIDER_ORIGINS[input.provider]
  let currentUrl = new URL(input.path, origin)
  if (input.query) {
    for (const [key, value] of Object.entries(input.query)) {
      currentUrl.searchParams.set(key, value)
    }
  }

  const maxHops = 3
  let hopCount = 0
  const maxRetries = 3

  while (true) {
    let attempt = 0
    let response: Response | null = null

    while (attempt <= maxRetries) {
      try {
        response = await fetchImpl(currentUrl.toString(), {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            Accept: 'application/json',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch {
        if (attempt >= maxRetries) {
          // 민감정보/원문 에러를 노출하지 않고 안전한 코드만 반환
          throw new LearningError('PROVIDER_NETWORK_ERROR', '[PROVIDER_NETWORK_ERROR] 공급자 통신 실패')
        }
        attempt++
        await sleepImpl(Math.min(200 * Math.pow(2, attempt), 2000))
        continue
      }

      // 429 또는 5xx인 경우 제한된 지수 백오프로 재시도
      if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
        if (attempt >= maxRetries) {
          break
        }
        attempt++
        await sleepImpl(Math.min(300 * Math.pow(2, attempt), 3000))
        continue
      }

      break
    }

    if (!response) {
      throw new LearningError('PROVIDER_NO_RESPONSE', '[PROVIDER_NO_RESPONSE] 공급자로부터 응답을 받지 못했습니다.')
    }

    // Redirect 수동 처리 및 보안 검증
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) {
        throw new LearningError('INVALID_REDIRECT', '[INVALID_REDIRECT] 리다이렉트 위치 헤더가 없습니다.')
      }

      hopCount++
      if (hopCount > maxHops) {
        throw new LearningError('TOO_MANY_REDIRECTS', '[TOO_MANY_REDIRECTS] 허용된 리다이렉트 홉(최대 3회)을 초과했습니다.')
      }

      let targetUrl: URL
      try {
        targetUrl = new URL(location, currentUrl)
      } catch {
        throw new LearningError('INVALID_REDIRECT', '[INVALID_REDIRECT] 유효하지 않은 리다이렉트 주소입니다.')
      }

      // 1. origin 검증 (외래 호스트 토큰 유출 차단)
      if (targetUrl.origin !== origin) {
        throw new LearningError(
          'FOREIGN_REDIRECT_PROHIBITED',
          `[FOREIGN_REDIRECT_PROHIBITED] 외부 호스트(${targetUrl.origin})로의 리다이렉트는 차단되었습니다.`,
        )
      }

      // 2. userinfo 검증
      if (targetUrl.username || targetUrl.password) {
        throw new LearningError('USERINFO_NOT_ALLOWED', '[USERINFO_NOT_ALLOWED] 리다이렉트 URL에 사용자 인증 정보를 포함할 수 없습니다.')
      }

      // 3. port 검증
      if (targetUrl.port && targetUrl.port !== '443') {
        throw new LearningError('EXPLICIT_PORT_NOT_ALLOWED', '[EXPLICIT_PORT_NOT_ALLOWED] 명시적 포트는 허용되지 않습니다.')
      }

      // 4. 경로 화이트리스트 재검증
      assertApprovedPath(targetUrl.pathname)

      // 5. Query credential 제거/중복 차단
      targetUrl.searchParams.delete('access_token')
      targetUrl.searchParams.delete('token')

      currentUrl = targetUrl
      continue
    }

    // 스트림 기반 바운디드 읽기 (메모리 무제한 할당 방지)
    const rawBuffer = await readStreamBounded(response, input.maxBytes)

    if (!response.ok) {
      // 응답 본문 원문을 일체 노출하지 않고 안전한 상태 코드만 반환
      throw new ProviderTransportError(response.status)
    }

    const text = new TextDecoder('utf-8').decode(rawBuffer)
    try {
      return JSON.parse(text)
    } catch {
      throw new LearningError('PROVIDER_INVALID_JSON', '[PROVIDER_INVALID_JSON] 공급자 응답을 JSON으로 파싱할 수 없습니다.')
    }
  }
}

export async function fetchMediaSafely(
  input: { url: string; maxBytes: number },
  deps?: ProviderFetchDeps,
): Promise<SafeMediaResult> {
  const fetchImpl = deps?.fetch ?? globalThis.fetch
  const timeoutMs = deps?.timeoutMs ?? 10000

  let parsed: URL
  try {
    parsed = new URL(input.url)
  } catch {
    throw new LearningError('INVALID_MEDIA_URL', '[INVALID_MEDIA_URL] 유효하지 않은 미디어 URL입니다.')
  }

  if (parsed.protocol !== 'https:') {
    throw new LearningError('INVALID_MEDIA_PROTOCOL', '[INVALID_MEDIA_PROTOCOL] 미디어는 HTTPS 주소만 허용됩니다.')
  }

  if (parsed.username || parsed.password) {
    throw new LearningError('USERINFO_NOT_ALLOWED', '[USERINFO_NOT_ALLOWED] 미디어 URL에 사용자 인증 정보를 포함할 수 없습니다.')
  }

  if (parsed.port && parsed.port !== '443') {
    throw new LearningError('EXPLICIT_PORT_NOT_ALLOWED', '[EXPLICIT_PORT_NOT_ALLOWED] 명시적 포트는 허용되지 않습니다.')
  }

  if (!isApprovedMediaHost(parsed.hostname)) {
    throw new LearningError(
      'UNAUTHORIZED_MEDIA_HOST',
      `[UNAUTHORIZED_MEDIA_HOST] 승인되지 않은 미디어 호스트입니다: ${parsed.hostname}`,
    )
  }

  // OAuth Authorization 헤더는 절대로 미디어 CDN 요청에 포함하지 않음 (Cross-origin 토큰 유출 방지)
  let response: Response
  try {
    response = await fetchImpl(parsed.toString(), {
      method: 'GET',
      headers: {
        Accept: 'image/jpeg,image/png,image/webp',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new LearningError('MEDIA_NETWORK_ERROR', '[MEDIA_NETWORK_ERROR] 미디어 다운로드 네트워크 실패')
  }

  if (!response.ok) {
    throw new LearningError(
      'MEDIA_FETCH_FAILED',
      `[MEDIA_FETCH_FAILED] 미디어 다운로드 실패 (상태 코드: ${response.status})`,
    )
  }

  // MIME 타입 검증: SVG, HTML, Video 등은 이미지 지식 학습 대상에서 엄격 거부
  const rawContentType = response.headers.get('content-type') || ''
  const mimeType = rawContentType.split(';')[0].trim().toLowerCase()

  if (!ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new LearningError(
      'UNSUPPORTED_MEDIA_TYPE',
      `[UNSUPPORTED_MEDIA_TYPE] 지원되지 않는 미디어 형식(${mimeType})입니다. 래스터 이미지(JPEG, PNG, WebP)만 허용됩니다.`,
    )
  }

  // 스트림 기반 바운디드 바이트 수신 (maxBytes 초과 즉시 중단)
  const buffer = await readStreamBounded(response, input.maxBytes)

  // Magic bytes 검증 (MIME 위장 방어)
  verifyImageMagicBytes(buffer, mimeType)

  return {
    data: buffer,
    contentType: mimeType,
  }
}
