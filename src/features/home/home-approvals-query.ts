'use client'

import { useState, useEffect, useCallback } from 'react'
import type { HomeApprovalsResponse, HomeApprovalsSummary } from './home-approval-types'

// 메모리 캐시 및 활성 리스너 관리 (전체 화면에서 단일 SSOT 공유)
const globalApprovalState: {
  cache: Record<string, HomeApprovalsResponse | undefined>
  listeners: Record<string, Set<(data: HomeApprovalsResponse | null) => void>>
} = {
  cache: {},
  listeners: {},
}

export function invalidateHomeApprovals(workspaceId: string) {
  if (!workspaceId) return
  delete globalApprovalState.cache[workspaceId]
  const listeners = globalApprovalState.listeners[workspaceId]
  if (listeners) {
    listeners.forEach((callback) => callback(null))
  }
}

export function updateHomeApprovalsCache(workspaceId: string, updated: HomeApprovalsResponse) {
  if (!workspaceId) return
  globalApprovalState.cache[workspaceId] = updated
  const listeners = globalApprovalState.listeners[workspaceId]
  if (listeners) {
    listeners.forEach((callback) => callback(updated))
  }
}

export interface UseHomeApprovalsReturn {
  data: HomeApprovalsResponse | null
  summary: HomeApprovalsSummary | null
  totalPending: number
  loading: boolean
  error: boolean
  refresh: () => Promise<void>
}

export function useHomeApprovals(workspaceId: string): UseHomeApprovalsReturn {
  const [data, setData] = useState<HomeApprovalsResponse | null>(() => {
    return workspaceId ? globalApprovalState.cache[workspaceId] ?? null : null
  })
  const [loading, setLoading] = useState<boolean>(() => {
    return workspaceId ? !globalApprovalState.cache[workspaceId] : false
  })
  const [error, setError] = useState<boolean>(false)

  const fetchApprovals = useCallback(async () => {
    if (!workspaceId || workspaceId === 'ws-default') {
      setData(null)
      setLoading(false)
      setError(false)
      return
    }

    try {
      const res = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/home/approvals`, {
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('조회 실패')
      const json = await res.json()
      if (json.success && json.data) {
        globalApprovalState.cache[workspaceId] = json.data
        setData(json.data)
        setError(false)
        const listeners = globalApprovalState.listeners[workspaceId]
        if (listeners) {
          listeners.forEach((callback) => callback(json.data))
        }
      } else {
        setError(true)
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return

    if (!globalApprovalState.listeners[workspaceId]) {
      globalApprovalState.listeners[workspaceId] = new Set()
    }

    const listener = (newData: HomeApprovalsResponse | null) => {
      if (newData) {
        setData(newData)
        setLoading(false)
        setError(false)
      } else {
        // 캐시 무효화 시 재조회
        void fetchApprovals()
      }
    }

    globalApprovalState.listeners[workspaceId].add(listener)

    if (!globalApprovalState.cache[workspaceId]) {
      void fetchApprovals()
    } else {
      setData(globalApprovalState.cache[workspaceId]!)
      setLoading(false)
    }

    return () => {
      globalApprovalState.listeners[workspaceId]?.delete(listener)
    }
  }, [workspaceId, fetchApprovals])

  return {
    data,
    summary: data?.summary ?? null,
    totalPending: data?.summary?.total ?? 0,
    loading,
    error,
    refresh: fetchApprovals,
  }
}
