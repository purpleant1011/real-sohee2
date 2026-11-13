'use client'

import { useState } from 'react'
import {
  MobileMemoryApprovalView,
  type MemoryApprovalViewSnapshot,
} from '@/features/mobile-settings/memory-approval-view'
import type { MemoryCandidate } from '@/features/mobile-settings/memory-approval'
import type { MemoryDecision, MemoryDecisionUiState } from '@/features/mobile-settings/r2-memory-decisions'

const CHECKED_AT = '2026-10-24T05:00:00Z'

const CANDIDATES: MemoryCandidate[] = [
  {
    key: 'price:커트', kind: 'price', proposalId: 'p-1',
    proposedValue: '커트 35,000원', currentValue: '커트 30,000원', origin: 'owner_stated',
    source: { label: '매장 안내문', href: null, observedAt: '2026-10-23T02:00:00Z' },
    customerVisible: true,
  },
  {
    key: 'service:두피 스케일링', kind: 'service', proposalId: 'p-2',
    proposedValue: '두피 스케일링 20분 추가', currentValue: null, origin: 'owner_stated',
    source: { label: '소희와의 대화', href: null, observedAt: '2026-10-23T04:10:00Z' },
    customerVisible: true,
  },
  {
    key: 'hours:일요일', kind: 'hours', proposalId: 'p-3',
    proposedValue: '일요일 11:00–17:00', currentValue: null, origin: 'owner_stated',
    source: { label: '네이버 플레이스', href: null, observedAt: '2026-10-22T09:00:00Z' },
    customerVisible: true,
  },
  {
    key: 'policy:노쇼', kind: 'policy', proposalId: 'p-4',
    proposedValue: '노쇼 2회 시 예약 제한', currentValue: null, origin: 'owner_stated',
    source: { label: '소희와의 대화', href: null, observedAt: '2026-10-21T07:30:00Z' },
    customerVisible: false,
  },
  {
    key: 'other:주차', kind: 'other', proposalId: 'p-5',
    proposedValue: '건물 뒤 주차 2대', currentValue: null, origin: 'sohee_inferred',
    source: null, customerVisible: true,
  },
]

const INITIAL_STATES: Record<string, MemoryDecisionUiState> = {
  'p-1': { kind: 'idle' },
  'p-2': { kind: 'submitting' },
  'p-3': { kind: 'decided', status: 'confirmed' },
  'p-4': { kind: 'already_handled', status: 'rejected' },
  'p-5': { kind: 'failed', reason: 'unavailable' },
}

const snapshot: MemoryApprovalViewSnapshot = {
  loadState: 'ready',
  candidates: CANDIDATES,
  complete: true,
  checkedAt: CHECKED_AT,
}

/** 예시 화면: 실제 서버 호출 없이 상태별 카드 모양만 확인한다. 누르면 저장 중 → 승인/거절로 넘어간다. */
export function MemoryDecisionsPreview() {
  const [states, setStates] = useState<Record<string, MemoryDecisionUiState>>(INITIAL_STATES)

  const onDecide = (proposalId: string, decision: MemoryDecision) => {
    setStates(prev => ({ ...prev, [proposalId]: { kind: 'submitting' } }))
    setTimeout(() => {
      setStates(prev => ({
        ...prev,
        [proposalId]: { kind: 'decided', status: decision === 'confirm' ? 'confirmed' : 'rejected' },
      }))
    }, 700)
  }

  return (
    <div className="mx-auto w-full max-w-[420px] px-4 py-6">
      <p className="pb-4 text-xs text-muted-foreground">예시 화면 · 실제 가게 데이터가 아닙니다</p>
      <MobileMemoryApprovalView snapshot={snapshot} onDecide={onDecide} decisionStates={states} />
    </div>
  )
}
