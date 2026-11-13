import { notFound } from 'next/navigation'
import { NaverReadinessCard } from '@/features/channel-studio/naver/ui/naver-readiness-card'
import { NaverSearchObservationCard } from '@/features/naver-publish/components/naver-search-observation-card'
import { NaverConnectorInstallCard } from '@/components/v088/system/naver-connector-install-card'
import { evaluateEditorialReadiness } from '@/features/channel-studio/naver/editorial-readiness'
import type { BlogSearchObservation } from '@/features/naver-publish/official-search-observation'

export const dynamic = 'force-dynamic'

const limitations = ['공식 검색 API 응답 표본 기준이며 네이버 통합검색 실제 노출 순위가 아니에요.']
const sample = (status: BlogSearchObservation['status'], matched: number | null): BlogSearchObservation => ({
  source: 'NAVER_OFFICIAL_BLOG_SEARCH_API', query: '청라 젤네일 유지기간', sort: 'sim', start: 1, display: 100,
  requestedAt: '2026-11-03T12:00:00.000Z', respondedAt: '2026-11-03T12:00:01.000Z', status,
  matchedCanonicalUrl: matched ? 'https://blog.naver.com/shop/223' : null, matchedSamplePosition: matched,
  sampleCount: 100, apiErrorCode: null, limitations, postAgeHint: 'OVER_24H',
})

/** V1.2 검증용 개발 미리보기. 운영 빌드에서는 404. */
export default function NaverV12DevPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const partial = evaluateEditorialReadiness({
    title: '청라 젤네일 유지기간 가이드',
    body: '젤네일은 관리 방법에 따라 유지 기간이 달라져요.\n\n예약 전에 궁금한 점을 정리했어요.',
    tags: ['젤네일'],
    readerQuestions: ['젤네일 유지기간은 얼마나 되나요'],
    hasCta: true,
  })
  const blocked = evaluateEditorialReadiness({
    title: '시술 후기', body: '이번 이벤트는 30% 할인이고 통증 완치까지 가능합니다.', tags: [], approvedFacts: [], readerQuestions: [], images: [],
  })
  return (
    <main className="mx-auto max-w-3xl min-w-0 space-y-6 px-4 py-8">
      <h1 className="text-xl font-semibold">네이버 V1.2 미리보기 · 테스트 전용</h1>
      <NaverConnectorInstallCard workspaceId="00000000-0000-4000-8000-000000000001" />
      <NaverReadinessCard evaluation={partial} />
      <NaverReadinessCard evaluation={blocked} />
      <NaverSearchObservationCard observation={sample('OBSERVED_IN_SAMPLE', 7)} />
      <NaverSearchObservationCard observation={sample('NOT_FOUND_IN_SAMPLE', null)} />
      <NaverSearchObservationCard observation={sample('NOT_CONFIGURED', null)} />
    </main>
  )
}
