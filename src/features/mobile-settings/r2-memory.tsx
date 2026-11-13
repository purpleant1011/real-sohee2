'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MobileAppShell, ShellScreen } from '@/features/mobile-shell'
import { MobileMemoryApprovalView, memoryApprovalScreenConfig, type MemoryApprovalViewSnapshot } from './memory-approval-view'
import { isMemoryApiSnapshot, type MemoryApiSnapshot } from './server/memory-snapshot'
import {
  decisionStateFromResponse,
  type MemoryDecision,
  type MemoryDecisionUiState,
} from './r2-memory-decisions'

/** 조회 실패는 '확인할 기억 없음'이 아니다. complete=false 로 남겨 빈 목록을 단정하지 않는다. */
const failedSnapshot = (): MemoryApiSnapshot =>
  ({ loadState: 'error', workspaceId: '', candidates: [], complete: false, checkedAt: null })

/**
 * M22 가게 기억 승인 — R2 셸 배선(ANI-1709, 플래그 뒤).
 * 목록은 GET 으로만 읽고, 쓰기는 사장님이 버튼을 누른 순간에만 한 번 나간다(자동 승인 없음).
 * 응답은 no-store 로 받으며 브라우저 저장소에 남기지 않는다.
 */
export function R2Memory({ workspaceId }: { workspaceId: string }) {
  // 가게가 바뀌면 이전 가게의 결정 상태를 물려받지 않는다.
  return <R2MemorySession key={workspaceId} workspaceId={workspaceId} />
}

function R2MemorySession({ workspaceId }: { workspaceId: string }) {
  const [snapshot, setSnapshot] = useState<MemoryApiSnapshot>(() => ({
    loadState: 'loading', workspaceId, candidates: [], complete: false, checkedAt: null,
  }))
  const [decisionStates, setDecisionStates] = useState<Record<string, MemoryDecisionUiState>>({})
  // 같은 제안에 대한 중복 요청을 막는다(버튼 잠금은 렌더 이후에 반영되므로 ref 로 먼저 막는다).
  const inFlight = useRef<Set<string>>(new Set())

  const endpoint = `/api/workspaces/${encodeURIComponent(workspaceId)}/mobile-memory`

  useEffect(() => {
    let cancelled = false
    const apply = (next: MemoryApiSnapshot) => { if (!cancelled) setSnapshot(next) }
    fetch(endpoint, { cache: 'no-store' })
      .then(async res => {
        // 503 도 본문에 error 스냅샷을 담아 준다. 계약과 맞으면 그대로 쓰고, 아니면 error.
        const payload: unknown = await res.json().catch(() => null)
        apply(isMemoryApiSnapshot(payload, workspaceId) ? payload : failedSnapshot())
      })
      .catch(() => apply(failedSnapshot()))
    return () => { cancelled = true }
  }, [endpoint, workspaceId])

  const decide = useCallback((proposalId: string, decision: MemoryDecision) => {
    if (inFlight.current.has(proposalId)) return
    inFlight.current.add(proposalId)
    const settle = (state: MemoryDecisionUiState) => {
      inFlight.current.delete(proposalId)
      setDecisionStates(prev => ({ ...prev, [proposalId]: state }))
    }
    setDecisionStates(prev => ({ ...prev, [proposalId]: { kind: 'submitting' } }))

    fetch(endpoint, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      // 사장님이 직접 누른 1회 확인. 서버는 이 값이 true 일 때만 쓴다.
      body: JSON.stringify({ proposalId, decision, confirm: true }),
    })
      .then(async res => {
        const payload: unknown = await res.json().catch(() => null)
        settle(decisionStateFromResponse(res.status, payload, proposalId))
      })
      .catch(() => settle({ kind: 'failed', reason: 'unavailable' }))
  }, [endpoint])

  const { mode, title } = memoryApprovalScreenConfig()
  const view: MemoryApprovalViewSnapshot = {
    loadState: snapshot.loadState,
    candidates: snapshot.candidates,
    complete: snapshot.complete,
    checkedAt: snapshot.checkedAt,
  }
  return (
    <MobileAppShell>
      <ShellScreen mode={mode} title={title}>
        <MobileMemoryApprovalView snapshot={view} onDecide={decide} decisionStates={decisionStates} />
      </ShellScreen>
    </MobileAppShell>
  )
}
