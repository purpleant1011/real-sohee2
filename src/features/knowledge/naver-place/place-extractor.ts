export type NaverPlaceSummary = Readonly<{
  placeId: string
  name: string
  category: string
  roadAddress: string
  jibunAddress: string
  businessHours: string | null
  visitorReviewScore: number | null
  visitorReviewCount: number | null
  images: readonly string[]
  hasTalktalk: boolean
}>

export function parsePlaceIdFromUrl(input: string): string | null {
  const trimmed = input.trim()
  if (/^\d{6,15}$/.test(trimmed)) {
    return trimmed
  }

  try {
    const parsed = new URL(trimmed)
    const match = parsed.pathname.match(/place\/(\d+)/)
    if (match?.[1]) {
      return match[1]
    }
  } catch {
    const fallbackMatch = trimmed.match(/place\/(\d+)/)
    if (fallbackMatch?.[1]) {
      return fallbackMatch[1]
    }
  }

  return null
}

export async function resolveNaverPlaceId(inputUrlOrId: string): Promise<string | null> {
  const direct = parsePlaceIdFromUrl(inputUrlOrId)
  if (direct) return direct

  const trimmed = inputUrlOrId.trim()
  if (trimmed.includes('naver.me')) {
    try {
      const response = await fetch(trimmed, {
        method: 'HEAD',
        redirect: 'manual',
      })
      const location = response.headers.get('location')
      if (location) {
        return parsePlaceIdFromUrl(location)
      }
    } catch {
      // Retry with GET if HEAD is refused
      try {
        const getRes = await fetch(trimmed, { redirect: 'follow' })
        return parsePlaceIdFromUrl(getRes.url)
      } catch {
        return null
      }
    }
  }

  return null
}

export function normalizePlaceSummaryData(raw: any): NaverPlaceSummary | null {
  const detail = raw?.data?.placeDetail
  if (!detail || !detail.id || !detail.name) return null

  let reviewCount: number | null = null
  if (detail.visitorReviews?.displayText) {
    const countMatch = detail.visitorReviews.displayText.match(/\d+/)
    if (countMatch) reviewCount = parseInt(countMatch[0], 10)
  }

  const images: string[] = []
  if (Array.isArray(detail.images?.images)) {
    for (const img of detail.images.images) {
      const origin = img.origin || img.originalUrl || img.url
      if (origin && typeof origin === 'string') {
        images.push(origin)
      }
    }
  }

  return Object.freeze({
    placeId: String(detail.id),
    name: String(detail.name).trim(),
    category: String(detail.category?.category ?? '').trim(),
    roadAddress: String(detail.address?.roadAddress ?? detail.address?.address ?? '').trim(),
    jibunAddress: String(detail.address?.address ?? '').trim(),
    businessHours: detail.businessHours?.description ? String(detail.businessHours.description).trim() : null,
    visitorReviewScore: typeof detail.visitorReviews?.score === 'number' ? detail.visitorReviews.score : null,
    visitorReviewCount: reviewCount,
    images: Object.freeze(images),
    hasTalktalk: Boolean(detail.labels?.talktalk),
  })
}

export async function fetchNaverPlaceSummary(placeId: string): Promise<NaverPlaceSummary | null> {
  const apiUrl = `https://map.naver.com/p/api/place/summary/${encodeURIComponent(placeId)}`
  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://map.naver.com/',
        Accept: 'application/json, text/plain, */*',
      },
      cache: 'no-store',
    })

    if (!response.ok) return null
    const json = await response.json()
    return normalizePlaceSummaryData(json)
  } catch {
    return null
  }
}
