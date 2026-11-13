'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  CanonicalCustomerItem,
  CanonicalCustomersResponse,
} from '@/features/customers/canonical-contract'
import { boundedMobileRead } from '@/features/mobile-shell/bounded-mobile-read'

export interface CanonicalCustomersQuery {
  workspaceId: string
  q?: string
  limit?: number
}

export type CanonicalCustomersLoad = 'loading' | 'ready' | 'error'

/**
 * 번호 기준 정본 고객 목록 조회 훅.
 * GET /api/workspaces/{workspaceId}/customers/canonical?q=&limit=50
 *
 * 조회 실패(error)를 "고객 없음"으로 치환하지 않는다(모바일 R2 규칙 준수).
 */
export function useCanonicalCustomers(query: CanonicalCustomersQuery) {
  const { workspaceId, q, limit = 50 } = query
  const [tick, setTick] = useState(0)
  const currentKey = `${workspaceId}:${q ?? ''}:${limit}:${tick}`

  const [state, setState] = useState<{
    key: string
    items: CanonicalCustomerItem[]
    load: CanonicalCustomersLoad
  }>({
    key: '',
    items: [],
    load: 'loading',
  })

  const refresh = useCallback(() => {
    setTick((v) => v + 1)
  }, [])

  useEffect(() => {
    if (!workspaceId || workspaceId.startsWith('preview-') || typeof fetch !== 'function') return

    const controller = new AbortController()
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (limit) params.set('limit', String(limit))

    const qs = params.toString()
    const url = `/api/workspaces/${encodeURIComponent(workspaceId)}/customers/canonical${qs ? `?${qs}` : ''}`

    boundedMobileRead(
      url,
      async (response) => {
        if (!response.ok) throw new Error('canonical_customers_failed')
        const data = (await response.json()) as CanonicalCustomersResponse
        return Array.isArray(data.items) ? data.items : []
      },
      controller.signal,
    )
      .then((items) => {
        setState({ key: currentKey, items, load: 'ready' })
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setState({ key: currentKey, items: [], load: 'error' })
      })

    return () => controller.abort()
  }, [workspaceId, q, limit, tick, currentKey])

  const isCurrent = state.key === currentKey
  const items = isCurrent ? state.items : []
  const load = isCurrent ? state.load : 'loading'

  return { items, load, refresh }
}
