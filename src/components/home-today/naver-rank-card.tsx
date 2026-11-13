'use client'

import { useEffect, useState } from 'react'
import type { BlogSearchObservation } from '@/features/naver-publish/official-search-observation'
import { NaverSearchObservationCard } from '@/features/naver-publish/components/naver-search-observation-card'

export function NaverRankCard({ workspaceId }: { workspaceId: string }) {
  const [result, setResult] = useState<{ workspaceId: string; data: BlogSearchObservation } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/naver-posts/latest/rank`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) return
        const observation = (await response.json()) as BlogSearchObservation
        if (!controller.signal.aborted && observation && observation.source === 'NAVER_OFFICIAL_BLOG_SEARCH_API') {
          setResult({ workspaceId, data: observation })
        }
      } catch {
        /* Missing observations are never displayed as ranking success. */
      }
    })()
    return () => controller.abort()
  }, [workspaceId])

  const observation = result?.workspaceId === workspaceId ? result.data : null

  // 관측 불가면 빈 상태 유지 (가짜 0점/1위 표기 전면 금지)
  if (!observation || observation.status !== 'OBSERVED_IN_SAMPLE' || observation.matchedSamplePosition === null) {
    return null
  }

  return (
    <section aria-label="네이버 검색 관측 기록">
      <NaverSearchObservationCard observation={observation} />
    </section>
  )
}

