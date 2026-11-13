import type { VaultChannel } from '../types'
import { parseNaverBlogPostUrl } from '@/features/naver-publish/blog-url'

export interface ValidateUrlResult {
  valid: boolean
  normalizedUrl: string
  error?: string
}

const CHANNEL_DOMAIN_RULES: Record<
  VaultChannel,
  {
    channelName: string
    hostnames: (string | RegExp)[]
    examplePrefix: string
  }
> = {
  naver_blog: {
    channelName: '네이버 블로그',
    hostnames: ['blog.naver.com', 'm.blog.naver.com', 'in.naver.com'],
    examplePrefix: 'https://blog.naver.com/...',
  },
  daangn_business: {
    channelName: '당근',
    hostnames: [
      'daangn.com',
      'www.daangn.com',
      'business.daangn.com',
      'kr.karrotmarket.com',
      /\.daangn\.com$/,
    ],
    examplePrefix: 'https://daangn.com/...',
  },
  instagram: {
    channelName: '인스타그램',
    hostnames: ['instagram.com', 'www.instagram.com'],
    examplePrefix: 'https://www.instagram.com/...',
  },
  threads: {
    channelName: '스레드',
    hostnames: ['threads.net', 'www.threads.net'],
    examplePrefix: 'https://www.threads.net/...',
  },
}

/**
 * Validates a user-supplied publication URL without any external HTTP probe.
 * Checks for https protocol and channel-matching domains (relaxed verification for UNVERIFIED status).
 */
export function validatePublishUrl(
  channel: VaultChannel,
  rawUrl: string,
): ValidateUrlResult {
  const trimmed = rawUrl.trim()
  if (!trimmed) {
    return {
      valid: false,
      normalizedUrl: '',
      error: '게시한 글의 주소를 입력해 주세요.',
    }
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: '올바른 형식의 인터넷 주소(https://로 시작)를 입력해 주세요.',
    }
  }

  if (parsed.protocol !== 'https:') {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: '주소는 반드시 https:// 로 시작해야 해요.',
    }
  }

  if (channel === 'naver_blog') {
    const post = parseNaverBlogPostUrl(trimmed)
    if (!post || parsed.username || parsed.password || parsed.port) {
      return { valid: false, normalizedUrl: trimmed, error: '네이버 블로그 주소는 개별 글 주소로 입력해 주세요. 프로필·단축 주소나 로그인 정보가 포함된 주소는 기록할 수 없어요.' }
    }
    // 같은 글의 모바일/쿼리 주소를 한 주소로 기록한다. 소유권·실제 게시 확인은 아니다.
    return { valid: true, normalizedUrl: `https://blog.naver.com/${post.blogId}/${post.logNo}` }
  }

  const rule = CHANNEL_DOMAIN_RULES[channel]
  if (!rule) {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: '지원하지 않는 채널이에요.',
    }
  }

  const hostname = parsed.hostname.toLowerCase()
  const domainMatched = rule.hostnames.some((pattern) => {
    if (typeof pattern === 'string') {
      return hostname === pattern || hostname.endsWith(`.${pattern}`)
    }
    return pattern.test(hostname)
  })

  if (!domainMatched) {
    return {
      valid: false,
      normalizedUrl: trimmed,
      error: `${rule.channelName} 주소(${rule.examplePrefix})를 확인해 주세요.`,
    }
  }

  return {
    valid: true,
    normalizedUrl: trimmed,
  }
}
