'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'

export type ProfileDiffField = Readonly<{
  id: string
  label: string
  before: string | null
  after: string
  reason: string
  capability: 'supervised_allowed' | 'manual_assist_only' | 'unsupported'
  state: 'ready' | 'provider_review' | 'document_required' | 'partner_controlled' | 'edit_frequency_limited'
}>

export type ProfileDiffProposal = Readonly<{
  targetLabel: string
  targetAddress: string | null
  lastVerifiedAt: string | null
  purpose: string
  estimatedCredits: number
  fields: readonly ProfileDiffField[]
}>

const stateLabels = {
  ready: '변경 가능 여부 확인 필요', provider_review: '외부 검토 가능', document_required: '서류 필요',
  partner_controlled: '제휴사 관리 항목', edit_frequency_limited: '수정 횟수 제한 확인 필요',
} as const

export function ProfileDiffCard({ proposal, onApprove }: Readonly<{
  proposal: ProfileDiffProposal
  onApprove?: (fieldIds: readonly string[]) => void
}>) {
  const [selected, setSelected] = useState<readonly string[]>([])
  const toggle = (id: string) => setSelected((current) => current.includes(id)
    ? current.filter((item) => item !== id)
    : [...current, id])

  return <section aria-labelledby="place-diff-title">
    <header>
      <p>CN-05 플레이스 전후 비교</p>
      <h1 id="place-diff-title">{proposal.targetLabel}</h1>
      <p>{proposal.targetAddress ?? '주소는 확인이 필요해요.'}</p>
      <p>{proposal.purpose} · 예상 크레딧 {proposal.estimatedCredits}</p>
    </header>
    <ul aria-label="필드별 변경안">
      {proposal.fields.map((field) => <li key={field.id}>
        <label>
          <input
            type="checkbox"
            checked={selected.includes(field.id)}
            onChange={() => toggle(field.id)}
            aria-label={`${field.label} 변경 선택`}
          />
          <strong>{field.label}</strong>
        </label>
        <p>현재: {field.before ?? '정보 없음'}</p>
        <p>제안: {field.after}</p>
        <p>이유: {field.reason}</p>
        <p>상태: {stateLabels[field.state]}</p>
      </li>)}
    </ul>
    <p>자동 제출되지 않으며, 승인 뒤에도 수동 마무리가 필요할 수 있어요.</p>
    <Button disabled={selected.length === 0} onClick={() => onApprove?.(selected)}>선택한 변경 승인</Button>
  </section>
}
