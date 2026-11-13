import type { ParsedProfileLink, ProfilePlatform } from './types'

const HANDLE_PATTERN = /^[a-z0-9._]{1,30}$/

const INSTAGRAM_RESERVED = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'accounts',
  'stories',
  'direct',
  'tv',
  'share',
])

const THREADS_RESERVED = new Set([
  't',
  'post',
  'posts',
  'explore',
  'accounts',
  'login',
])

/**
 * 인스타그램 및 스레드 프로필 링크 또는 핸들 문자열을 파싱한다.
 *
 * 지원 형식:
 * - https://www.instagram.com/studio_by.reum/
 * - instagram.com/studio_by.reum?igsh=...
 * - @studio_by.reum (instagram 으로 간주)
 * - https://www.threads.net/@handle
 * - https://www.threads.com/@handle/post/xxx (핸들만 추출)
 *
 * 비정상 입력(게시물/릴스/스토리 링크, 지원되지 않는 스킴/도메인, 유효하지 않은 핸들)은 null 반환.
 */
export function parseProfileLink(input: string): ParsedProfileLink | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!trimmed) return null

  // @handle 단독 입력은 인스타그램 핸들로 간주
  if (trimmed.startsWith('@')) {
    const raw = trimmed.slice(1).toLowerCase()
    if (!HANDLE_PATTERN.test(raw)) return null
    if (INSTAGRAM_RESERVED.has(raw)) return null
    return { platform: 'instagram', handle: raw }
  }

  // 스킴 검사: http, https 이외의 스킴(ftp:, javascript:, mailto: 등) 차단
  const colonIndex = trimmed.indexOf(':')
  if (colonIndex !== -1) {
    const scheme = trimmed.slice(0, colonIndex).toLowerCase()
    if (scheme !== 'http' && scheme !== 'https') {
      return null
    }
  }

  // URL 객체로 파싱 (스킴이 생략된 경우 https:// 부여)
  const urlCandidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  let url: URL
  try {
    url = new URL(urlCandidate)
  } catch {
    return null
  }

  // URL 해시(#)가 포함된 경우 비정상 링크로 처리
  if (url.hash) {
    return null
  }

  // 비표준 포트 차단
  if (url.port && url.port !== '80' && url.port !== '443') {
    return null
  }

  const hostname = url.hostname.toLowerCase()
  let platform: ProfilePlatform
  if (
    hostname === 'instagram.com'
    || hostname === 'www.instagram.com'
    || hostname === 'm.instagram.com'
    || hostname === 'mobile.instagram.com'
  ) {
    platform = 'instagram'
  } else if (
    hostname === 'threads.net'
    || hostname === 'www.threads.net'
    || hostname === 'm.threads.net'
    || hostname === 'threads.com'
    || hostname === 'www.threads.com'
    || hostname === 'm.threads.com'
  ) {
    platform = 'threads'
  } else {
    return null
  }

  const segments = url.pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  let firstSegment = segments[0]
  if (firstSegment.startsWith('@')) {
    firstSegment = firstSegment.slice(1)
  }

  const handle = firstSegment.toLowerCase()
  if (!HANDLE_PATTERN.test(handle)) return null

  if (platform === 'instagram' && INSTAGRAM_RESERVED.has(handle)) {
    return null
  }
  if (platform === 'threads' && THREADS_RESERVED.has(handle)) {
    return null
  }

  return { platform, handle }
}
