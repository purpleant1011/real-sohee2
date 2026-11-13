'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { NaverSearchObservationCard } from '@/features/naver-publish/components/naver-search-observation-card'
import type { BlogSearchObservation } from '@/features/naver-publish/official-search-observation'
import type { ReadinessEvaluation } from '../editorial-readiness'
import { NaverReadinessCard } from './naver-readiness-card'

const base = (workspaceId: string, contentId: string) =>
  `/api/workspaces/${encodeURIComponent(workspaceId)}/naver-posts/${encodeURIComponent(contentId)}`

/** 소희 자체 콘텐츠 준비도. 불러오지 못하면 조용히 숨기고 복사·다운로드 흐름을 막지 않는다. */
export function NaverReadinessSection({ workspaceId, contentId, fetcher = fetch }: {
  workspaceId: string
  contentId: string
  fetcher?: typeof fetch
}) {
  const [evaluation, setEvaluation] = useState<ReadinessEvaluation | null>(null)
  const [questionsInput, setQuestionsInput] = useState('')
  const [rechecking, setRechecking] = useState(false)
  const [recheckFailed, setRecheckFailed] = useState(false)

  useEffect(() => {
    let alive = true
    void fetcher(`${base(workspaceId, contentId)}/readiness`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: ReadinessEvaluation | null) => { if (alive && body?.dimensions) setEvaluation(body) })
      .catch(() => undefined)
    return () => { alive = false }
  }, [workspaceId, contentId, fetcher])

  async function handleRecheck() {
    if (rechecking) return
    setRechecking(true)
    setRecheckFailed(false)
    try {
      const questions = questionsInput
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 5)

      const searchParams = new URLSearchParams()
      for (const q of questions) {
        searchParams.append('q', q)
      }
      const qs = searchParams.toString()
      const url = qs
        ? `${base(workspaceId, contentId)}/readiness?${qs}`
        : `${base(workspaceId, contentId)}/readiness`

      const response = await fetcher(url)
      const body = (await response.json().catch(() => null)) as ReadinessEvaluation | null
      if (response.ok && body?.dimensions) {
        setEvaluation(body)
      } else {
        setRecheckFailed(true)
      }
    } catch {
      setRecheckFailed(true)
    } finally {
      setRechecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <NaverReadinessCard evaluation={evaluation} />
      {evaluation ? (
        <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
          <label
            htmlFor={`naver-readiness-questions-${contentId}`}
            className="text-xs font-semibold text-foreground block"
          >
            독자가 궁금해할 질문 (선택, 한 줄에 하나, 최대 5개)
          </label>
          <textarea
            id={`naver-readiness-questions-${contentId}`}
            value={questionsInput}
            onChange={(e) => setQuestionsInput(e.target.value)}
            placeholder={'예: 처음 방문하면 어떻게 이용하나요?\n예약은 어떻게 하나요?'}
            rows={3}
            className="w-full rounded-md border bg-background p-2.5 text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring break-words min-w-0"
          />
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground">
              질문을 적어주시면 준비도 점검에 반영돼요. (최대 5개)
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rechecking}
              aria-busy={rechecking}
              onClick={() => void handleRecheck()}
              className="min-h-11 px-4 text-xs font-semibold"
            >
              {rechecking ? '점검하는 중…' : '다시 점검'}
            </Button>
          </div>
          {recheckFailed ? (
            <p role="alert" className="text-xs text-destructive">
              준비도를 다시 점검하지 못했어요. 잠시 후 다시 시도해 주세요.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/** 사장님이 알려 준 글 주소를 공식 블로그 검색 API 표본에서 찾아본다. 순위가 아니라 표본 발견 여부만 보여 준다. */
export function NaverSearchObservationSection({ workspaceId, contentId, ownerPostUrl, defaultQuery, fetcher = fetch }: {
  workspaceId: string
  contentId: string
  ownerPostUrl: string
  defaultQuery: string
  fetcher?: typeof fetch
}) {
  const [query, setQuery] = useState(defaultQuery)
  const [loading, setLoading] = useState(false)
  const [observation, setObservation] = useState<BlogSearchObservation | null>(null)
  const [failed, setFailed] = useState(false)

  async function observe() {
    if (loading || !query.trim()) return
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams({ url: ownerPostUrl, query: query.trim() })
      const response = await fetcher(`${base(workspaceId, contentId)}/rank?${params.toString()}`)
      const body = (await response.json().catch(() => null)) as BlogSearchObservation | null
      if (!response.ok || !body?.status) throw new Error('observe_failed')
      setObservation(body)
    } catch {
      setObservation(null)
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2 border-t pt-4">
      <h4 className="text-xs font-bold text-foreground">내 글의 검색 발견 현황</h4>
      <p className="text-xs text-muted-foreground">
        네이버 공식 검색 결과에서 내 글이 검색되는지 확인해요. 통합검색 순위가 아니에요.
      </p>
      <label htmlFor={`naver-observe-query-${contentId}`} className="text-xs font-medium">확인할 검색어</label>
      <input
        id={`naver-observe-query-${contentId}`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="예: 청라 젤네일 유지기간"
        className="min-h-11 w-full rounded-md border bg-background px-3 text-sm"
      />
      <Button type="button" variant="outline" className="min-h-11" disabled={loading || !query.trim()} aria-busy={loading} onClick={() => void observe()}>
        {loading ? '확인하는 중…' : '검색 발견 현황 확인'}
      </Button>
      {failed ? <p role="alert" className="text-sm text-destructive">검색 발견 현황을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.</p> : null}
      <NaverSearchObservationCard observation={observation} />
    </div>
  )
}
