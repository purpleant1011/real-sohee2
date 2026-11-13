import { LearningError, type LearningPlatform } from './contracts'

const IPV4_REGEX = /^(?:\d{1,3}\.){3}\d{1,3}$/
const IPV6_REGEX = /^\[?[0-9a-fA-F:]+\]?$/
const AMBIGUOUS_PATH_ENCODING_REGEX = /%(?:2e|2f|5c|25|00)/i

const INSTAGRAM_RESERVED_ROUTES = new Set([
  'p',
  'reel',
  'reels',
  'stories',
  'explore',
  'direct',
  'accounts',
  'developer',
  'about',
  'legal',
])

export interface NormalizedLearningUrl {
  canonicalUrl: string
  canonicalIdentity: string
}

function assertBasicUrlSecurity(urlStr: string): URL {
  if (typeof urlStr !== 'string' || !urlStr.trim()) {
    throw new LearningError('INVALID_URL', 'URL이 비어 있습니다.')
  }

  if (AMBIGUOUS_PATH_ENCODING_REGEX.test(urlStr)) {
    throw new LearningError('AMBIGUOUS_ENCODED_PATH', '인코딩된 모호한 경로는 허용되지 않습니다.')
  }

  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new LearningError('INVALID_URL', '유효하지 않은 URL 형식입니다.')
  }

  if (parsed.protocol !== 'https:') {
    throw new LearningError('INVALID_URL_PROTOCOL', 'HTTPS 주소만 등록할 수 있습니다.')
  }

  if (parsed.username || parsed.password) {
    throw new LearningError('USERINFO_NOT_ALLOWED', 'URL에 사용자 인증 정보를 포함할 수 없습니다.')
  }

  if (parsed.port && parsed.port !== '443') {
    throw new LearningError('EXPLICIT_PORT_NOT_ALLOWED', '명시적 포트는 허용되지 않습니다.')
  }

  const host = parsed.hostname.toLowerCase()
  if (
    IPV4_REGEX.test(host) ||
    IPV6_REGEX.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  ) {
    throw new LearningError('IP_OR_LOCALHOST_NOT_ALLOWED', 'IP 주소나 로컬호스트는 등록할 수 없습니다.')
  }

  if (AMBIGUOUS_PATH_ENCODING_REGEX.test(parsed.pathname)) {
    throw new LearningError('AMBIGUOUS_ENCODED_PATH', '인코딩된 모호한 경로는 허용되지 않습니다.')
  }

  return parsed
}

export function normalizeLearningUrl(platform: LearningPlatform, url: string): NormalizedLearningUrl {
  const parsed = assertBasicUrlSecurity(url)
  const host = parsed.hostname.toLowerCase()
  const pathname = parsed.pathname

  switch (platform) {
    case 'instagram': {
      if (host !== 'instagram.com' && host !== 'www.instagram.com') {
        throw new LearningError('FOREIGN_HOST_NOT_ALLOWED', '인스타그램 주소가 아닙니다.')
      }

      const segments = pathname.split('/').filter(Boolean)
      if (segments.length !== 1) {
        throw new LearningError('INVALID_PROFILE_PATH', '인스타그램 프로필 주소가 아닙니다.')
      }

      const rawUsername = segments[0]
      if (INSTAGRAM_RESERVED_ROUTES.has(rawUsername.toLowerCase())) {
        throw new LearningError('INVALID_PROFILE_PATH', '프로필 주소가 아닌 예약된 경로입니다.')
      }

      if (!/^[a-zA-Z0-9._]{1,30}$/.test(rawUsername) || rawUsername.startsWith('.') || rawUsername.endsWith('.')) {
        throw new LearningError('INVALID_PROFILE_USERNAME', '올바른 인스타그램 사용자명이 아닙니다.')
      }

      const canonicalIdentity = rawUsername.toLowerCase()
      return {
        canonicalUrl: `https://www.instagram.com/${canonicalIdentity}`,
        canonicalIdentity,
      }
    }

    case 'threads': {
      const allowedHosts = new Set(['threads.net', 'www.threads.net', 'threads.com', 'www.threads.com'])
      if (!allowedHosts.has(host)) {
        throw new LearningError('FOREIGN_HOST_NOT_ALLOWED', '스레드 주소가 아닙니다.')
      }

      const segments = pathname.split('/').filter(Boolean)
      if (segments.length !== 1) {
        throw new LearningError('INVALID_PROFILE_PATH', '스레드 프로필 주소가 아닙니다.')
      }

      const rawUsername = segments[0].startsWith('@') ? segments[0].slice(1) : segments[0]
      if (!/^[a-zA-Z0-9._]{1,30}$/.test(rawUsername)) {
        throw new LearningError('INVALID_PROFILE_USERNAME', '올바른 스레드 사용자명이 아닙니다.')
      }

      const canonicalIdentity = rawUsername.toLowerCase()
      return {
        canonicalUrl: `https://www.threads.net/@${canonicalIdentity}`,
        canonicalIdentity,
      }
    }

    case 'naver_blog': {
      const allowedHosts = new Set(['blog.naver.com', 'm.blog.naver.com'])
      if (!allowedHosts.has(host)) {
        throw new LearningError('FOREIGN_HOST_NOT_ALLOWED', '네이버 블로그 주소가 아닙니다.')
      }

      let blogId: string | null = null
      const segments = pathname.split('/').filter(Boolean)
      if (segments.length === 1 && !segments[0].endsWith('.naver')) {
        blogId = segments[0]
      } else {
        const queryBlogId = parsed.searchParams.get('blogId')
        if (queryBlogId) {
          blogId = queryBlogId
        }
      }

      if (!blogId || !/^[a-zA-Z0-9._-]{1,50}$/.test(blogId)) {
        throw new LearningError('INVALID_PROFILE_PATH', '올바른 네이버 블로그 주소가 아닙니다.')
      }

      const canonicalIdentity = blogId.toLowerCase()
      return {
        canonicalUrl: `https://blog.naver.com/${canonicalIdentity}`,
        canonicalIdentity,
      }
    }

    case 'naver_place': {
      const allowedHosts = new Set(['map.naver.com', 'm.place.naver.com', 'place.map.naver.com'])
      if (!allowedHosts.has(host)) {
        throw new LearningError('FOREIGN_HOST_NOT_ALLOWED', '네이버 플레이스 주소가 아닙니다.')
      }

      const placeMatch = pathname.match(/\/(?:entry\/place|place|restaurant)\/(\d+)/)
      if (!placeMatch || !placeMatch[1]) {
        throw new LearningError('INVALID_PROFILE_PATH', '올바른 네이버 플레이스 주소가 아닙니다.')
      }

      const canonicalIdentity = placeMatch[1]
      return {
        canonicalUrl: `https://map.naver.com/p/entry/place/${canonicalIdentity}`,
        canonicalIdentity,
      }
    }

    case 'daangn_business': {
      const allowedHosts = new Set(['daangn.com', 'www.daangn.com'])
      if (!allowedHosts.has(host)) {
        throw new LearningError('FOREIGN_HOST_NOT_ALLOWED', '당근 비즈니스 주소가 아닙니다.')
      }

      const profileMatch = pathname.match(/^\/kr\/(?:local|business)-profile\/([^/?#]+)/)
      if (!profileMatch || !profileMatch[1]) {
        throw new LearningError('INVALID_PROFILE_PATH', '올바른 당근 비즈니스 프로필 주소가 아닙니다.')
      }

      const canonicalIdentity = decodeURIComponent(profileMatch[1]).trim()
      return {
        canonicalUrl: `https://www.daangn.com/kr/local-profile/${canonicalIdentity}`,
        canonicalIdentity,
      }
    }

    case 'website': {
      if (!host.includes('.')) {
        throw new LearningError('INVALID_WEBSITE_HOST', '유효한 웹사이트 도메인이 아닙니다.')
      }

      let cleanPath = pathname
      if (cleanPath.endsWith('/') && cleanPath.length > 1) {
        cleanPath = cleanPath.slice(0, -1)
      } else if (cleanPath === '/') {
        cleanPath = ''
      }

      return {
        canonicalUrl: `https://${host}${cleanPath}`,
        canonicalIdentity: host,
      }
    }

    default: {
      const exhaust: never = platform
      throw new LearningError('UNSUPPORTED_PLATFORM', `지원하지 않는 플랫폼입니다: ${exhaust}`)
    }
  }
}
