import type { CorpusPost } from './types'

const ALLOWED_HOST_SUFFIXES = [
  'cdninstagram.com',
  'fbcdn.net',
  'threads.net',
  'threads.com',
] as const

const MAX_IMAGE_BYTES = 4 * 1024 * 1024 // 4MB

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

let fileSequence = 0

function isAllowedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim()
  if (!host) return false

  // IP 주소(IPv4, IPv6) 및 사설망 방지
  if (
    /^\d+\.\d+\.\d+\.\d+$/u.test(host)
    || host.includes(':')
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
  ) {
    return false
  }

  return ALLOWED_HOST_SUFFIXES.some(
    (suffix) => host === suffix || host.endsWith(`.${suffix}`),
  )
}

export async function downloadProfileImage(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<File | null> {
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return null
  }

  if (parsedUrl.protocol !== 'https:') {
    return null
  }

  if (parsedUrl.username || parsedUrl.password) {
    return null
  }

  if (parsedUrl.port && parsedUrl.port !== '443') {
    return null
  }

  if (!isAllowedHost(parsedUrl.hostname)) {
    return null
  }

  try {
    const signal = AbortSignal.timeout(5_000)
    // 응답을 받은 뒤 검사하면 이미 내부 주소로 요청했을 수 있으므로 자동 이동 자체를 금지한다.
    const response = await fetcher(url, { signal, redirect: 'error' })

    if (!response.ok) {
      return null
    }

    // 리다이렉트 발생 시 최종 URL 검증
    if (response.url) {
      try {
        const finalUrl = new URL(response.url)
        if (finalUrl.protocol !== 'https:' || !isAllowedHost(finalUrl.hostname)) {
          return null
        }
      } catch {
        return null
      }
    }

    const rawContentType = response.headers.get('content-type')
    const mime = rawContentType?.split(';')[0]?.trim().toLowerCase() ?? ''
    const ext = MIME_TO_EXT[mime]
    if (!ext) {
      return null
    }

    const contentLengthHeader = response.headers.get('content-length')
    if (contentLengthHeader) {
      const parsedLength = parseInt(contentLengthHeader, 10)
      if (Number.isNaN(parsedLength) || parsedLength <= 0 || parsedLength > MAX_IMAGE_BYTES) {
        return null
      }
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
      return null
    }

    fileSequence += 1
    const filename = `profile-${fileSequence}.${ext}`
    return new File([buffer], filename, { type: mime })
  } catch {
    return null
  }
}

export function pickRepresentativeImageUrls(
  posts: readonly CorpusPost[],
  max = 8,
): string[] {
  const candidates: string[] = []

  for (const post of posts) {
    if (
      post.mediaType === 'IMAGE'
      || post.mediaType === 'CAROUSEL_ALBUM'
      || post.mediaType === 'VIDEO'
    ) {
      const firstImage = post.imageUrls[0]
      if (typeof firstImage === 'string' && firstImage.trim().length > 0) {
        candidates.push(firstImage.trim())
      }
    }
  }

  const uniqueUrls = Array.from(new Set(candidates))
  const targetMax = Math.max(0, max)

  if (uniqueUrls.length <= targetMax) {
    return uniqueUrls
  }

  if (targetMax === 0) {
    return []
  }

  if (targetMax === 1) {
    return [uniqueUrls[0]!]
  }

  const step = (uniqueUrls.length - 1) / (targetMax - 1)
  const indices = Array.from({ length: targetMax }, (_, i) => Math.round(i * step))

  return indices.map((index) => uniqueUrls[index]!)
}
