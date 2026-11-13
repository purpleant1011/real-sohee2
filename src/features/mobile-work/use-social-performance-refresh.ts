'use client'

import { useCallback, useEffect, useState } from 'react'
import type { SocialReportMetric } from '@/features/reports/types'
import { collectSocialPerformanceAction } from '@/features/reports/actions/collect-social-performance'

export interface UseSocialPerformanceRefreshOptions {
  workspaceId: string
  publishAttemptId?: string | null
  publishedAt?: string | null
  initialMetrics?: readonly SocialReportMetric[] | null
  initialCollectedAt?: string | null
  onSuccess?: (snapshot: { collectedAt: string; metrics: readonly SocialReportMetric[] }) => void
}

export interface UseSocialPerformanceRefreshResult {
  isPending: boolean
  cooldownRemaining: number
  metrics: readonly SocialReportMetric[] | null
  collectedAt: string | null
  error: string | null
  isMissingScope: boolean
  refresh: () => Promise<void>
}

export function useSocialPerformanceRefresh({
  workspaceId,
  publishAttemptId,
  publishedAt,
  initialMetrics = null,
  initialCollectedAt = null,
  onSuccess,
}: UseSocialPerformanceRefreshOptions): UseSocialPerformanceRefreshResult {
  const [isPending, setIsPending] = useState(false)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [metrics, setMetrics] = useState<readonly SocialReportMetric[] | null>(initialMetrics)
  const [collectedAt, setCollectedAt] = useState<string | null>(initialCollectedAt)
  const [error, setError] = useState<string | null>(null)
  const [isMissingScope, setIsMissingScope] = useState(false)

  // 30초 쿨다운 카운트다운 타이머
  const isCoolingDown = cooldownRemaining > 0
  useEffect(() => {
    if (!isCoolingDown) return
    const timer = setInterval(() => {
      setCooldownRemaining((prev) => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [isCoolingDown])

  const refresh = useCallback(async () => {
    if (isPending || cooldownRemaining > 0) return
    if (!workspaceId || !publishAttemptId) return

    setIsPending(true)
    setError(null)
    setIsMissingScope(false)
    setCooldownRemaining(30)

    try {
      const now = new Date()
      const endIso = now.toISOString()
      const startIso = publishedAt && !Number.isNaN(Date.parse(publishedAt))
        ? (Date.parse(publishedAt) > Date.parse(endIso) ? endIso : publishedAt)
        : new Date(now.getTime() - 30 * 86_400_000).toISOString()

      const requestKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : '00000000-0000-4000-8000-000000000000'

      const result = await collectSocialPerformanceAction({
        workspaceId,
        publishAttemptId,
        requestKey,
        periodStart: startIso,
        periodEnd: endIso,
      })

      if ('error' in result && result.error) {
        setError('성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
        return
      }

      if ('data' in result && result.data) {
        if (result.data.status === 'permission_denied') {
          setIsMissingScope(true)
          setError('채널 연결 권한을 확인해 주세요')
          return
        }

        if (result.data.status === 'failed') {
          setError('성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
          return
        }

        const snapshot = result.data.snapshot
        if (snapshot) {
          setMetrics(snapshot.metrics)
          setCollectedAt(snapshot.collectedAt)
          onSuccess?.(snapshot)
        }
      }
    } catch {
      setError('성과를 불러오지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setIsPending(false)
    }
  }, [workspaceId, publishAttemptId, publishedAt, isPending, cooldownRemaining, onSuccess])

  return {
    isPending,
    cooldownRemaining,
    metrics,
    collectedAt,
    error,
    isMissingScope,
    refresh,
  }
}
