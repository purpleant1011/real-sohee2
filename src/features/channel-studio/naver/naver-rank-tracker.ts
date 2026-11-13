type UnobservedStatus = 'NOT_CONFIGURED' | 'NOT_AUTHORIZED' | 'RATE_LIMITED' | 'SOURCE_UNAVAILABLE'
export type NaverSearchObservation =
  | Readonly<{ status: 'OBSERVED'; html: string; observedAt: string; scope: string }>
  | Readonly<{ status: 'OBSERVED_EMPTY'; observedAt: string; scope: string }>
  | Readonly<{ status: UnobservedStatus }>

export type NaverKeywordRank = Readonly<{
  keyword: string
  status: 'FOUND' | 'NOT_FOUND' | UnobservedStatus
  rank: number | null
  page: number | null
  isTop10: boolean | null
  isFirstPlace: boolean | null
  observedAt: string | null
  scope: string | null
  searchUrl: string
}>

export type NaverRankTrackingSummary = Readonly<{
  blogId: string
  logNo: string
  /** Request time, not proof of a successful search observation. */
  checkedAt: string
  status: 'OBSERVED' | 'PARTIAL' | 'NOT_OBSERVED'
  observedCount: number
  bestRank: number | null
  topKeyword: string | null
  ranks: readonly NaverKeywordRank[]
}>

function postLinks(html: string): string[] {
  return [...new Set(Array.from(html.matchAll(/https?:\/\/blog\.naver\.com\/([a-zA-Z0-9_-]+)\/(\d+)/gi),
    match => `${match[1].toLowerCase()}/${match[2]}`))]
}

/** Position in the supplied sample's unique post links, not an official search ranking. */
export function parseNaverBlogSearchRank(html: string, blogId: string, logNo: string): { rank: number | null; page: number | null } {
  const index = postLinks(html).indexOf(`${blogId.trim().toLowerCase()}/${logNo.trim()}`)
  return index === -1 ? { rank: null, page: null } : { rank: index + 1, page: Math.ceil((index + 1) / 10) }
}

export async function trackNaverPostRanks(input: {
  blogId: string
  logNo: string
  keywords: readonly string[]
  /** Server-owned, policy-approved observation source. There is deliberately no HTML fetch fallback. */
  observeSearch?: (keyword: string) => Promise<NaverSearchObservation>
}): Promise<NaverRankTrackingSummary> {
  const { blogId, logNo } = input
  const keywords = [...new Set(input.keywords.map(keyword => keyword.replace(/^#+/u, '').trim()).filter(keyword => keyword.length >= 2))].slice(0, 5)
  const ranks: NaverKeywordRank[] = []

  for (const keyword of keywords) {
    let observation: NaverSearchObservation = { status: 'NOT_CONFIGURED' }
    if (input.observeSearch) {
      try { observation = await input.observeSearch(keyword) } catch { observation = { status: 'SOURCE_UNAVAILABLE' } }
    }
    let status: NaverKeywordRank['status'] = 'SOURCE_UNAVAILABLE'
    let rank: number | null = null
    let page: number | null = null
    let observedAt: string | null = null
    let scope: string | null = null
    if (observation.status === 'OBSERVED' || observation.status === 'OBSERVED_EMPTY') {
      if (Number.isFinite(Date.parse(observation.observedAt)) && observation.scope?.trim()) {
        if (observation.status === 'OBSERVED_EMPTY') status = 'NOT_FOUND'
        else if (typeof observation.html === 'string' && postLinks(observation.html).length > 0) {
          const parsed = parseNaverBlogSearchRank(observation.html, blogId, logNo)
          rank = parsed.rank; page = parsed.page
          status = rank === null ? 'NOT_FOUND' : 'FOUND'
        }
        if (status === 'FOUND' || status === 'NOT_FOUND') {
          observedAt = observation.observedAt
          scope = observation.scope.trim().slice(0, 500)
        }
      }
    } else if (['NOT_CONFIGURED', 'NOT_AUTHORIZED', 'RATE_LIMITED', 'SOURCE_UNAVAILABLE'].includes(observation.status)) {
      status = observation.status
    }
    const observed = status === 'FOUND' || status === 'NOT_FOUND'
    ranks.push(Object.freeze({
      keyword, status, rank, page, observedAt, scope,
      isTop10: observed ? rank !== null && rank <= 10 : null,
      isFirstPlace: observed ? rank === 1 : null,
      searchUrl: `https://m.search.naver.com/search.naver?where=m_blog&query=${encodeURIComponent(keyword)}`,
    }))
  }

  const ranked = ranks.filter((item): item is NaverKeywordRank & { rank: number } => item.status === 'FOUND' && item.rank !== null)
    .sort((a, b) => a.rank - b.rank)
  const observedCount = ranks.filter(item => item.status === 'FOUND' || item.status === 'NOT_FOUND').length
  return Object.freeze({
    blogId, logNo, checkedAt: new Date().toISOString(),
    status: observedCount === 0 ? 'NOT_OBSERVED' : observedCount === ranks.length ? 'OBSERVED' : 'PARTIAL',
    observedCount, bestRank: ranked[0]?.rank ?? null, topKeyword: ranked[0]?.keyword ?? null,
    ranks: Object.freeze(ranks),
  })
}
