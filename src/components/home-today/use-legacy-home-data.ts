'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { WorkspaceCanonicalReadModel } from '@/features/canonical-read-model/types'
import type { VaultSummaryDto } from '@/features/vault/query/types'
import { evaluateReadiness, type ReadinessView } from '@/features/readiness'
import {
  evaluateTodayCard,
  formatVaultSummaryLine,
  type TodayCardData,
  type VaultSummaryLineData,
} from '@/features/home/today-card'
import type { QuickPostItem } from '@/components/quick-post/types'
import type { HomeApprovalsSummary } from '@/features/home/home-approval-types'

export type LoadingState<T> = { value: T | null; loading: boolean; error: boolean }
const initial = <T,>(): LoadingState<T> => ({ value: null, loading: true, error: false })

export interface UseLegacyHomeDataOptions {
  isPaused?: boolean
}

export function useLegacyHomeData(workspaceId: string, options?: UseLegacyHomeDataOptions) {
  const isPaused = options?.isPaused ?? false
  const [model, setModel] = useState<LoadingState<WorkspaceCanonicalReadModel>>(initial)
  const [posts, setPosts] = useState<LoadingState<QuickPostItem[]>>(initial)
  const [vaultSummary, setVaultSummary] = useState<LoadingState<VaultSummaryDto>>(initial)
  const [readiness, setReadiness] = useState<LoadingState<ReadinessView>>(initial)
  const [pipelineData, setPipelineData] = useState<{ inquiryCount: number | null; bookedCount: number | null }>({
    inquiryCount: null,
    bookedCount: null,
  })
  const [approvalsSummary, setApprovalsSummary] = useState<HomeApprovalsSummary | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)

  const refresh = useCallback(() => setRefreshCount((count) => count + 1), [])

  useEffect(() => {
    const controller = new AbortController()
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setModel(initial())
    setPosts(initial())
    setVaultSummary(initial())
    setReadiness(initial())
    setPipelineData({ inquiryCount: null, bookedCount: null })

    async function load<T>(
      url: string,
      extract: (data: any) => T,
      update: (state: LoadingState<T>) => void,
    ) {
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('요청 실패')
        const data = await response.json()
        const value = extract(data)
        update({ value, loading: false, error: false })
      } catch {
        if (!controller.signal.aborted) update({ value: null, loading: false, error: true })
      }
    }

    void load(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/canonical-read-model`,
      (data) => {
        if (!data.success || !data.data || !Array.isArray(data.data.channels)) {
          throw new Error('정보를 확인할 수 없어요')
        }
        return data.data as WorkspaceCanonicalReadModel
      },
      setModel,
    )

    void load(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/quick-post`,
      (data) => {
        if (!Array.isArray(data.items)) throw new Error('게시물을 확인할 수 없어요')
        return data.items as QuickPostItem[]
      },
      setPosts,
    )

    void load(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/vault/summary`,
      (data) => {
        if (!data.success || !data.data) throw new Error('보관함 요약을 확인할 수 없어요')
        return data.data as VaultSummaryDto
      },
      setVaultSummary,
    )

    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/customers/pipeline`, {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error('파이프라인 조회 실패')
        return r.json()
      })
      .then((data) => {
        if (data?.kpis) {
          setPipelineData({
            inquiryCount: typeof data.kpis.inquiryCount === 'number' ? data.kpis.inquiryCount : null,
            bookedCount: typeof data.kpis.bookedCount === 'number' ? data.kpis.bookedCount : null,
          })
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setPipelineData({ inquiryCount: null, bookedCount: null })
      })

    void load(
      '/api/sohee-ready',
      (data) => {
        if (!data.readiness) throw new Error('준비 상태를 확인할 수 없어요')
        return evaluateReadiness(data.readiness)
      },
      setReadiness,
    )

    return () => controller.abort()
  }, [workspaceId, refreshCount])

  const businessName =
    model.value?.businessName?.state === 'AVAILABLE' ? model.value.businessName.value.trim() : ''

  const greeting = businessName
    ? `${businessName} 사장님, 오늘도 소희가 함께해요`
    : '사장님, 오늘도 소희가 함께해요'

  const todayDateString = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('ko-KR', {
        timeZone: 'Asia/Seoul',
        month: 'long',
        day: 'numeric',
        weekday: 'long',
      }).format(new Date())
    } catch {
      return '오늘'
    }
  }, [])

  const channelsConnected = model.value
    ? model.value.channels.some(
        (channel) =>
          ['instagram', 'threads'].includes(channel.channel) &&
          (channel.isAuthorized || channel.connectionStatus === 'verified'),
      )
    : readiness.value
    ? readiness.value.verifiedChannels.length > 0
    : null

  const todayCardData: TodayCardData = evaluateTodayCard({
    readiness: readiness.value,
    vaultSummary: vaultSummary.value,
    posts: posts.value,
    channelsConnected,
    inquiryCount: pipelineData.inquiryCount,
    autonomousSchedule: {
      scheduledToday: !isPaused && Boolean(readiness.value?.trialAutoPublishEnabled),
      slotTime: readiness.value?.trialAutoPublishEnabled ? '19:00' : undefined,
    },
  })

  const vaultSummaryLineData: VaultSummaryLineData = formatVaultSummaryLine(
    vaultSummary.value,
    vaultSummary.error,
  )
  if (!vaultSummaryLineData.hasError) {
    vaultSummaryLineData.externalActionCount = null
    vaultSummaryLineData.lineText = `보관 ${vaultSummaryLineData.storedCount}건 · 게시 확인은 주간 기록에서 확인해 주세요`
  }

  const recent = [...(posts.value ?? [])]
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 3)

  const isInitialLoading = model.loading || posts.loading

  return {
    model,
    posts,
    vaultSummary,
    readiness,
    pipelineData,
    approvalsSummary,
    setApprovalsSummary,
    refresh,
    refreshCount,
    businessName,
    greeting,
    todayDateString,
    channelsConnected,
    todayCardData,
    vaultSummaryLineData,
    recent,
    isInitialLoading,
  }
}

export type LegacyHomeData = ReturnType<typeof useLegacyHomeData>
