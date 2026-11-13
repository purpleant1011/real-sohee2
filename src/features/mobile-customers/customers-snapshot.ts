'use client'

import { useEffect, useState } from 'react'
import type { LoadState } from '@/features/mobile-decision/contracts'
import { authFailureFromStatus, type AuthFailure } from '@/features/mobile-shell/auth-failure'
import type { CustomersViewSnapshot } from './customers-view'
import { boundedMobileRead } from '@/features/mobile-shell/bounded-mobile-read'

const LOAD_STATES: LoadState[] = ['loading', 'ready', 'error', 'unknown', 'stale']

/** 서버 계약과 다르거나 다른 가게(workspaceId 불일치) 스냅샷은 그리지 않는다. */
export function isCustomersSnapshot(value: unknown, workspaceId: string): value is CustomersViewSnapshot {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.loadState === 'string' &&
    LOAD_STATES.includes(v.loadState as LoadState) &&
    Array.isArray(v.customers) &&
    v.workspaceId === workspaceId &&
    typeof v.complete === 'boolean' &&
    (v.checkedAt === null || typeof v.checkedAt === 'string')
  )
}

/** 브라우저가 '연결 없음'을 확인해 준 경우. 서버가 답하지 못한 이유를 아는 유일한 경우다. */
function offlineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

/** 조회 실패는 '고객 없음'이 아니다. complete=false 로 남겨 빈 목록을 단정하지 않는다. */
export function failedCustomersSnapshot(workspaceId: string, offline = false): CustomersViewSnapshot {
  const failed: CustomersViewSnapshot = { loadState: 'error', customers: [], workspaceId, complete: false, checkedAt: null }
  return offline ? { ...failed, offline: true } : failed
}

/**
 * 인증(401)·권한(403) 거부는 '고객 없음'도 '일시적 조회 실패'도 아니다.
 * 같은 상태로 뭉개면 다시 로그인할 일과 권한을 요청할 일을 구분할 수 없다(ANI-1714).
 */
export function deniedCustomersSnapshot(workspaceId: string, authFailure: AuthFailure): CustomersViewSnapshot {
  return { loadState: 'error', customers: [], workspaceId, complete: false, checkedAt: null, authFailure }
}

/**
 * GET /api/workspaces/:id/mobile-customers 읽기 전용 조회.
 * 목록과 상세가 같은 응답을 쓰므로 조회는 이 한 곳에만 둔다.
 * 고객 개인정보이므로 no-store 로 받고 브라우저 저장소에 남기지 않는다.
 */
export function useCustomersSnapshot(workspaceId: string, refreshKey = 0): CustomersViewSnapshot {
  const loading: CustomersViewSnapshot = { loadState: 'loading', customers: [], workspaceId, complete: false, checkedAt: null }
  const [state, setState] = useState({ workspaceId, refreshKey, snapshot: loading })

  useEffect(() => {
    let cancelled = false
    let controller: AbortController | undefined
    const load = () => {
      controller?.abort()
      const request = new AbortController()
      controller = request
      const apply = (snapshot: CustomersViewSnapshot) => {
        if (!cancelled && !request.signal.aborted) setState({ workspaceId, refreshKey, snapshot })
      }
      boundedMobileRead(`/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-customers`, async res => {
        // 서버 응답이 있는 인증 거부는 오프라인이나 빈 고객 목록으로 덮지 않는다.
        const authFailure = authFailureFromStatus(res.status)
        if (authFailure) return deniedCustomersSnapshot(workspaceId, authFailure)
        // 503도 error 스냅샷을 담는다. 계약과 맞는 응답만 사용한다.
        const payload: unknown = await res.json().catch(() => null)
        return isCustomersSnapshot(payload, workspaceId) ? payload : failedCustomersSnapshot(workspaceId, offlineNow())
      }, request.signal)
        .then(apply)
        .catch(() => apply(failedCustomersSnapshot(workspaceId, offlineNow())))
    }
    load()
    // 읽기 조회만 다시 한다. 이전 요청은 취소해 늦은 응답이 새 결과를 덮지 못하게 한다.
    const onOnline = () => { if (!cancelled) load() }
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      controller?.abort()
      window.removeEventListener('online', onOnline)
    }
  }, [workspaceId, refreshKey])

  return state.workspaceId === workspaceId && state.refreshKey === refreshKey ? state.snapshot : loading
}
