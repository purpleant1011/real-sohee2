'use client'

import { useState } from 'react'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ResultScreenView } from './result-screen-view'
import { deriveFirstPostOutcome, type OutcomeInput } from './publish-outcome'

/** 프리뷰 전용 예시. 상태 4종을 눌러 보며 정직한 표시를 확인한다. */
type DemoKind = 'VERIFIED' | 'CHECKING' | 'UNKNOWN' | 'FAILED'

const DEMO: Record<DemoKind, OutcomeInput> = {
  VERIFIED: {
    overallStatus: 'ALL_VERIFIED',
    receipts: {
      instagram: { channel: 'instagram', stage: 'OUTCOME_OBSERVED', permalink: 'https://www.instagram.com/p/example/', verifiedAt: '2026-10-23T09:05:00.000Z' },
    },
  },
  CHECKING: { overallStatus: 'PARTIAL_SUCCESS', receipts: { instagram: { channel: 'instagram', stage: 'PROVIDER_ACCEPTED' } } },
  UNKNOWN: { overallStatus: 'FAILED', receipts: { instagram: { channel: 'instagram', stage: 'RESULT_UNKNOWN' } } },
  FAILED: { overallStatus: 'FAILED', receipts: { instagram: { channel: 'instagram', stage: 'FAILED', errorMessage: 'x' } } },
}

const ITEMS = [
  { id: 'VERIFIED', label: '확인됨' },
  { id: 'CHECKING', label: '확인 중' },
  { id: 'UNKNOWN', label: '알 수 없음' },
  { id: 'FAILED', label: '실패' },
] as const

export function ResultScreenDemo() {
  const [kind, setKind] = useState<DemoKind>('VERIFIED')
  const outcome = deriveFirstPostOutcome(DEMO[kind])
  return (
    <div className="space-y-4">
      <SegmentedControl ariaLabel="결과 상태 예시" items={ITEMS} value={kind} onChange={setKind} />
      <ResultScreenView
        input={{ outcome, evidence: { instagram: { approvedHandle: '@example_shop', readbackAccount: '@example_shop' } } }}
      />
    </div>
  )
}
