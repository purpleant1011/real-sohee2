/**
 * example.com 및 m.example.com 간 세션 공유를 위한 공통 쿠키 도메인 계산 헬퍼
 */

const SOHEE_ROOT_DOMAIN = 'example.com'

/**
 * 주어진 호스트명(또는 브라우저 location.hostname)을 기반으로
 * 서브도메인 간 공유 가능한 cookie domain 문자열을 반환합니다.
 *
 * @param host 호스트명 문자열 (옵션)
 * @returns '.example.com' 또는 localhost/기타 환경인 경우 undefined
 */
export function getCookieDomain(host?: string | null): string | undefined {
  if (!host && typeof window !== 'undefined') {
    host = window.location.hostname
  }
  if (!host) return undefined

  // 포트 번호 제거
  const cleanHost = host.toLowerCase().replace(/:\d+$/, '').trim()

  if (cleanHost === SOHEE_ROOT_DOMAIN || cleanHost.endsWith(`.${SOHEE_ROOT_DOMAIN}`)) {
    return `.${SOHEE_ROOT_DOMAIN}`
  }

  return undefined
}

/**
 * 기본 CookieOptions에 공유 도메인 속성을 병합합니다.
 */
export function getSharedCookieOptions<T extends Record<string, any>>(options?: T, host?: string | null): T {
  const domain = getCookieDomain(host)
  if (!domain) {
    return { ...(options as T) }
  }
  return {
    ...(options as T),
    domain,
  }
}
