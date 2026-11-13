export type SocialEmbedProvider = 'instagram' | 'threads'

export interface EmbedUrlResult {
  readonly provider: SocialEmbedProvider
  readonly src: string
}

const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com'])
const THREADS_HOSTS = new Set([
  'threads.com',
  'www.threads.com',
  'threads.net',
  'www.threads.net',
])

const INSTAGRAM_PATH_PATTERN = /^\/(p|reel|reels)\/([A-Za-z0-9_-]+)(?:\/embed)?\/?$/
const THREADS_PATH_PATTERN = /^\/@?([A-Za-z0-9_.-]+)\/post\/([A-Za-z0-9_-]+)(?:\/embed)?\/?$/

export function getEmbedUrl(permalink: string | null | undefined): EmbedUrlResult | null {
  if (!permalink || typeof permalink !== 'string') {
    return null
  }

  const trimmed = permalink.trim()
  if (!trimmed) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }

  if (parsed.protocol !== 'https:') {
    return null
  }

  const hostname = parsed.hostname.toLowerCase()

  // 경로 우회(path traversal) 또는 디코딩 인젝션 방어
  const rawPathname = parsed.pathname
  if (rawPathname.includes('..') || rawPathname.includes('\\')) {
    return null
  }

  let decodedPathname: string
  try {
    decodedPathname = decodeURIComponent(rawPathname)
    if (decodedPathname.includes('..') || decodedPathname.includes('\\')) {
      return null
    }
  } catch {
    return null
  }

  if (INSTAGRAM_HOSTS.has(hostname)) {
    const match = INSTAGRAM_PATH_PATTERN.exec(decodedPathname)
    if (!match) {
      return null
    }
    const rawType = match[1]
    const shortcode = match[2]
    const type = rawType === 'reels' ? 'reel' : rawType

    return {
      provider: 'instagram',
      src: `https://www.instagram.com/${type}/${shortcode}/embed`,
    }
  }

  if (THREADS_HOSTS.has(hostname)) {
    const match = THREADS_PATH_PATTERN.exec(decodedPathname)
    if (!match) {
      return null
    }
    const username = match[1].replace(/^@/, '')
    const postCode = match[2]

    if (!username || !postCode) {
      return null
    }

    return {
      provider: 'threads',
      src: `https://www.threads.com/@${username}/post/${postCode}/embed`,
    }
  }

  return null
}
