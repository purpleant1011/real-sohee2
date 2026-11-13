/**
 * 오래된(만료·폐기된) Supabase 세션 쿠키 정리 헬퍼
 *
 * @supabase/ssr@0.12.0 의 signInWithOAuth 내부에서 낡은 세션 쿠키(sb-*-auth-token)를
 * 정리하는 로직이 접두사 매칭으로 인해 방금 기록된 PKCE verifier(sb-*-auth-token-code-verifier)까지
 * 함께 삭제해버리는 결함을 방지하기 위해, OAuth 시작 직전 및 로그인 페이지 진입 시점에
 * 낡은 auth-token 쿠키만 선제적으로 제거합니다.
 */

export const STALE_AUTH_COOKIE_PATTERN = /^sb-.+-auth-token(\.\d+)?$/

export interface CookieDocument {
  cookie: string
}

/**
 * document.cookie에서 낡은 Supabase auth-token 쿠키를 찾아 Max-Age=0으로 삭제합니다.
 * PKCE 검증 쿠키(-code-verifier)는 절대 건드리지 않습니다.
 *
 * @param doc document 객체 (테스트용 주입 가능, 기본값 document)
 * @param hostname 호스트명 (기본값 location.hostname)
 * @returns 삭제를 시도한 쿠키 이름 목록
 */
export function clearSupabaseAuthCookies(
  doc: CookieDocument | null | undefined = typeof document !== 'undefined' ? document : undefined,
  hostname: string = typeof location !== 'undefined' ? location.hostname : ''
): string[] {
  if (!doc || typeof doc.cookie !== 'string' || !doc.cookie.trim()) {
    return []
  }

  const rawCookies = doc.cookie.split(';')
  const targets = new Set<string>()

  for (const raw of rawCookies) {
    const eqIdx = raw.indexOf('=')
    const rawName = eqIdx === -1 ? raw : raw.slice(0, eqIdx)
    const name = rawName.trim()
    if (name && STALE_AUTH_COOKIE_PATTERN.test(name)) {
      targets.add(name)
    }
  }

  const targetNames = Array.from(targets)
  if (targetNames.length === 0) {
    return []
  }

  const host = typeof hostname === 'string' ? hostname.trim() : ''

  for (const name of targetNames) {
    // 1) 도메인 속성 없음
    doc.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`

    // 도메인 변형 (호스트명이 있을 때만 시도)
    if (host) {
      // 2) Domain=<hostname>
      doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=${host}; SameSite=Lax`
      // 3) Domain=.<hostname> (루트 도메인 매칭)
      doc.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${host}; SameSite=Lax`
    }
  }

  return targetNames
}
