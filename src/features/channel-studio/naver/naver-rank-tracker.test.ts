import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('TEST_NETWORK_FORBIDDEN') })))
afterEach(() => vi.unstubAllGlobals())
import {
  parseNaverBlogSearchRank,
  trackNaverPostRanks,
} from './naver-rank-tracker'

describe('naver-rank-tracker (네이버 블로그 검색 노출 순위 추적 엔진)', () => {
  const targetBlogId = 'byreum_official'
  const targetLogNo = '224441208561'

  const mockSearchHtml = `
    <html>
      <body>
        <div class="card">
          <a href="https://blog.naver.com/other_shop/111111111111">경쟁 매장 글 1</a>
        </div>
        <div class="card">
          <a href="https://blog.naver.com/another_shop/222222222222">경쟁 매장 글 2</a>
        </div>
        <div class="card">
          <a href="https://blog.naver.com/byreum_official/224441208561">바이름 원장님의 자연눈썹 찐후기</a>
          <a href="https://blog.naver.com/byreum_official/224441208561">중복 링크</a>
        </div>
        <div class="card">
          <a href="https://blog.naver.com/fourth_shop/333333333333">경쟁 매장 글 3</a>
        </div>
      </body>
    </html>
  `

  it('parseNaverBlogSearchRank correctly finds rank and page from search HTML', () => {
    const result = parseNaverBlogSearchRank(mockSearchHtml, targetBlogId, targetLogNo)

    expect(result.rank).toBe(3)
    expect(result.page).toBe(1)
  })

  it('parseNaverBlogSearchRank returns null when post is not found in results', () => {
    const result = parseNaverBlogSearchRank(mockSearchHtml, 'non_existent_blog', '999999999999')

    expect(result.rank).toBeNull()
    expect(result.page).toBeNull()
  })

  it('does not scrape search HTML when no approved observation source is configured', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(mockSearchHtml))
    try {
      const result = await trackNaverPostRanks({ blogId: targetBlogId, logNo: targetLogNo, keywords: ['상담 안내'] })
      expect(fetcher).not.toHaveBeenCalled()
      expect(result).toMatchObject({ status: 'NOT_OBSERVED', bestRank: null, observedCount: 0 })
      expect(result.ranks[0]).toMatchObject({ status: 'NOT_CONFIGURED', isTop10: null, isFirstPlace: null, observedAt: null })
    } finally { fetcher.mockRestore() }
  })

  it('keeps source failures and an observed empty sample distinct', async () => {
    const result = await trackNaverPostRanks({
      blogId: targetBlogId, logNo: targetLogNo, keywords: ['실패 질문', '빈 표본', '차단 화면', '쿼터 제한'],
      observeSearch: async keyword => {
        if (keyword === '실패 질문') throw new Error('private provider detail')
        if (keyword === '쿼터 제한') return { status: 'RATE_LIMITED' }
        if (keyword === '빈 표본') return { status: 'OBSERVED_EMPTY', observedAt: '2026-10-29T00:00:00Z', scope: '허용된 테스트 표본' }
        return { status: 'OBSERVED', html: '<html>로그인 필요</html>', observedAt: '2026-10-29T00:00:00Z', scope: '허용된 테스트 표본' }
      },
    })
    expect(result.status).toBe('PARTIAL')
    expect(result.observedCount).toBe(1)
    expect(result.ranks.map(rank => rank.status)).toEqual(['SOURCE_UNAVAILABLE', 'NOT_FOUND', 'SOURCE_UNAVAILABLE', 'RATE_LIMITED'])
    expect(result.ranks.map(rank => rank.isTop10)).toEqual([null, false, null, null])
    expect(JSON.stringify(result)).not.toContain('private provider detail')
  })

  it('trackNaverPostRanks tracks multiple keywords and determines bestRank and topKeyword', async () => {
    const mockFetchHtml = vi.fn(async (keyword: string) => {
      if (keyword === '강남역속눈썹') {
        return `
          <a href="https://blog.naver.com/byreum_official/224441208561">바이름 1위 글</a>
          <a href="https://blog.naver.com/other/123">기타</a>
        `
      }
      if (keyword === '역삼동자연눈썹') {
        return mockSearchHtml // 3위
      }
      return '<html><body>결과 없음</body></html>'
    })

    const summary = await trackNaverPostRanks({
      blogId: targetBlogId,
      logNo: targetLogNo,
      keywords: ['#강남역속눈썹', '#역삼동자연눈썹', '#비인기키워드'],
      observeSearch: async keyword => keyword === '비인기키워드'
        ? { status: 'OBSERVED_EMPTY', observedAt: '2026-10-29T00:00:00Z', scope: '허용된 테스트 표본' }
        : { status: 'OBSERVED', html: await mockFetchHtml(keyword), observedAt: '2026-10-29T00:00:00Z', scope: '허용된 테스트 표본' },
    })

    expect(summary.bestRank).toBe(1)
    expect(summary.topKeyword).toBe('강남역속눈썹')
    expect(summary.ranks).toHaveLength(3)

    const firstPlace = summary.ranks.find((r) => r.keyword === '강남역속눈썹')
    expect(firstPlace?.rank).toBe(1)
    expect(firstPlace?.isFirstPlace).toBe(true)
    expect(firstPlace?.isTop10).toBe(true)

    const thirdPlace = summary.ranks.find((r) => r.keyword === '역삼동자연눈썹')
    expect(thirdPlace?.rank).toBe(3)
    expect(thirdPlace?.isFirstPlace).toBe(false)
    expect(thirdPlace?.isTop10).toBe(true)

    const notFound = summary.ranks.find((r) => r.keyword === '비인기키워드')
    expect(notFound?.rank).toBeNull()
    expect(notFound?.isTop10).toBe(false)
  })
})
