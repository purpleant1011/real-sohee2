'use client'

import { useEffect, useState } from 'react'

export {
  useSocialPerformanceRefresh,
  type UseSocialPerformanceRefreshOptions,
  type UseSocialPerformanceRefreshResult,
} from './use-social-performance-refresh'

export type SupportedConnectedChannel = 'instagram' | 'threads'
export type ChannelEngagementState = 'loading' | 'ready' | 'unavailable'

export interface ChannelEngagementSummary {
  dmCount: number
  pendingCommentCount: number
}

export interface SummarizeEngagementOptions {
  channel: SupportedConnectedChannel
  comments?: readonly unknown[] | null
  threads?: readonly unknown[] | null
}

export interface UseChannelEngagementResult {
  state: ChannelEngagementState
  summary: ChannelEngagementSummary | null
  dmCount: number | null
  pendingCommentCount: number | null
  error?: string | null
}

const PENDING_COMMENT_STATUSES = new Set([
  'RECEIVED',
  'NEW',
  'CLASSIFIED',
  'DRAFTED',
  'APPROVED',
  'NEEDS_CHECK',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 댓글 및 DM 목록 데이터를 기반으로 해당 채널의 미답변 DM 및 대기 중 댓글 수를 집계하는 순수 함수.
 */
export function summarizeEngagement(
  options: SummarizeEngagementOptions
): ChannelEngagementSummary
export function summarizeEngagement(
  channel: SupportedConnectedChannel,
  comments?: readonly unknown[] | null,
  threads?: readonly unknown[] | null
): ChannelEngagementSummary
export function summarizeEngagement(
  first: SupportedConnectedChannel | SummarizeEngagementOptions,
  second?: readonly unknown[] | null,
  third?: readonly unknown[] | null
): ChannelEngagementSummary {
  const channel = typeof first === 'string' ? first : first.channel
  const rawComments = typeof first === 'string' ? second : first.comments
  const rawThreads = typeof first === 'string' ? third : first.threads

  let pendingCommentCount = 0
  if (Array.isArray(rawComments)) {
    for (const item of rawComments) {
      if (!isRecord(item)) continue
      const itemChannel = typeof item.channel === 'string' ? item.channel : null
      if (itemChannel && itemChannel !== channel) continue

      const status = typeof item.status === 'string' ? item.status.toUpperCase() : ''
      if (PENDING_COMMENT_STATUSES.has(status)) {
        pendingCommentCount += 1
      }
    }
  }

  let dmCount = 0
  // Threads 채널은 DM API 미지원으로 항상 0건
  if (channel === 'instagram' && Array.isArray(rawThreads)) {
    const now = Date.now()
    for (const item of rawThreads) {
      if (!isRecord(item)) continue
      const itemChannel = typeof item.channel === 'string' ? item.channel : null
      if (itemChannel && itemChannel !== 'instagram') continue

      const status = typeof item.status === 'string' ? item.status.toUpperCase() : ''
      if (status !== 'NEEDS_REPLY') continue

      const isExpired =
        item.is_expired === true ||
        item.replyWindowExpired === true ||
        (typeof item.expires_at === 'string' &&
          item.is_expired !== false &&
          Date.parse(item.expires_at) <= now)

      if (!isExpired) {
        dmCount += 1
      }
    }
  }

  return {
    dmCount,
    pendingCommentCount,
  }
}

/**
 * 인스타그램·스레드 작업 상세용 읽기 전용 실시간 응대 지표 훅.
 * 외부 쓰기 및 발행 엔드포인트는 절대 호출하지 않으며 GET 조회만 수행합니다.
 */
export function useChannelEngagement(
  workspaceId: string,
  channel: SupportedConnectedChannel
): UseChannelEngagementResult {
  const currentKey = `${workspaceId}:${channel}`

  const [data, setData] = useState<{
    key: string
    state: ChannelEngagementState
    summary: ChannelEngagementSummary | null
    error: string | null
  }>(() => ({
    key: currentKey,
    state: workspaceId ? 'loading' : 'unavailable',
    summary: null,
    error: null,
  }))

  const isStale = data.key !== currentKey
  const activeState: ChannelEngagementState = isStale
    ? (workspaceId ? 'loading' : 'unavailable')
    : data.state
  const activeSummary = isStale ? null : data.summary
  const activeError = isStale ? null : data.error

  useEffect(() => {
    if (!workspaceId) return

    const controller = new AbortController()
    const { signal } = controller

    async function fetchEngagement() {
      try {
        const commentsUrl = `/api/workspaces/${encodeURIComponent(workspaceId)}/engagement/comments?channel=${encodeURIComponent(channel)}&limit=100`
        const commentsPromise = fetch(commentsUrl, {
          cache: 'no-store',
          signal,
        })

        let threadsPromise: Promise<Response> | null = null
        if (channel === 'instagram') {
          const threadsUrl = `/api/workspaces/${encodeURIComponent(workspaceId)}/engagement/dm/threads?limit=100`
          threadsPromise = fetch(threadsUrl, {
            cache: 'no-store',
            signal,
          })
        }

        const [commentsRes, threadsRes] = await Promise.all([
          commentsPromise,
          threadsPromise,
        ])

        if (!commentsRes.ok || (threadsRes && !threadsRes.ok)) {
          throw new Error('ENGAGEMENT_FETCH_FAILED')
        }

        const commentsData = await commentsRes.json().catch(() => null)
        const threadsData = threadsRes ? await threadsRes.json().catch(() => null) : null

        const rawComments = Array.isArray(commentsData?.items) ? commentsData.items : []
        const rawThreads = Array.isArray(threadsData?.items) ? threadsData.items : []

        const computed = summarizeEngagement(channel, rawComments, rawThreads)

        if (!signal.aborted) {
          setData({
            key: currentKey,
            state: 'ready',
            summary: computed,
            error: null,
          })
        }
      } catch (err: unknown) {
        if (signal.aborted) return
        setData({
          key: currentKey,
          state: 'unavailable',
          summary: null,
          error: err instanceof Error ? err.message : 'ENGAGEMENT_UNAVAILABLE',
        })
      }
    }

    void fetchEngagement()

    return () => {
      controller.abort()
    }
  }, [workspaceId, channel, currentKey])

  return {
    state: activeState,
    summary: activeSummary,
    dmCount: activeSummary ? activeSummary.dmCount : null,
    pendingCommentCount: activeSummary ? activeSummary.pendingCommentCount : null,
    error: activeError,
  }
}
