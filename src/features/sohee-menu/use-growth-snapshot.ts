'use client'

import { useCallback, useEffect, useState } from 'react'
import type { GrowthSnapshot } from '@/features/sohee-growth/types'

export function useGrowthSnapshot(workspaceId: string) {
  const [snapshot, setSnapshot] = useState<GrowthSnapshot | null>(null)
  const [loading, setLoading] = useState(Boolean(workspaceId))
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/sohee-growth`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok || !body?.success) throw new Error('GROWTH_UNAVAILABLE')
      setSnapshot(body.data as GrowthSnapshot)
      setError(null)
    } catch {
      setSnapshot(null)
      setError('소희의 성장 현황을 불러오지 못했어요.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, loading, error, refresh }
}
