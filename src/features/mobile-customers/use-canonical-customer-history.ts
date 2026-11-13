'use client'

import { useCallback, useEffect, useState } from 'react'
import type { KakaoHistoryItem, KakaoHistoryResponse } from '@/features/kakao/history/contract'

export interface CanonicalCustomerHistoryQuery {
  workspaceId: string
  customerUuid: string
  limit?: number
}

export type CanonicalCustomerHistoryLoad = 'loading' | 'ready' | 'error'

/**
 * 정본 고객(UUID) 기준 카카오 알림톡 발송내역 조회 훅.
 * GET /api/workspaces/{workspaceId}/kakao/outbox?customerUuid={customerUuid}&limit=50
 *
 * 조회 실패(error)를 "내역 없음"으로 치환하지 않는다(모바일 R2 규칙 준수).
 */
export function useCanonicalCustomerHistory(query: CanonicalCustomerHistoryQuery) {
  const { workspaceId, customerUuid, limit = 50 } = query
  const [items, setItems] = useState<KakaoHistoryItem[]>([])
  const [load, setLoad] = useState<CanonicalCustomerHistoryLoad>('loading')
  const [tick, setTick] = useState(0)

  const refresh = useCallback(() => {
    setLoad('loading')
    setTick((v) => v + 1)
  }, [])

  useEffect(() => {
    if (!workspaceId || workspaceId.startsWith('preview-') || !customerUuid || typeof fetch !== 'function') return

    const controller = new AbortController()
    const params = new URLSearchParams()
    params.set('customerUuid', customerUuid)
    if (limit) params.set('limit', String(limit))

    const qs = params.toString()
    fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/kakao/outbox?${qs}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('canonical_customer_history_failed')
        const data = (await response.json()) as KakaoHistoryResponse
        setItems(Array.isArray(data.items) ? data.items : [])
        setLoad('ready')
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoad('error')
      })

    return () => controller.abort()
  }, [workspaceId, customerUuid, limit, tick])

  return { items, load, refresh }
}
