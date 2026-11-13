import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  EmptyEvidenceState,
  PersistenceStateBadge,
  CapabilityReadinessRow,
  ProductionReadinessCard,
  EmployeeInbox,
} from '@/components/v088/same-truth'

describe('Figma 7th Same-Truth & Semantic Parity (ANI-1002, ANI-1013)', () => {
  it('renders honest EmptyEvidenceState without synthetic metrics or fake live tickers', () => {
    render(<EmptyEvidenceState />)

    expect(screen.getByText(/기록된 운영 증거가 없습니다/i)).toBeDefined()
    expect(screen.queryByText(/NO_PROOF/)).toBeNull()
    expect(screen.queryByText(/Agent Energy/i)).toBeNull()
    expect(screen.queryByText(/SC/i)).toBeNull()
  })

  it('renders PersistenceStateBadge with exact failure and verification states', () => {
    const { rerender } = render(<PersistenceStateBadge state="READBACK_VERIFIED" />)
    expect(screen.getByText('확인 완료')).toBeDefined()

    rerender(<PersistenceStateBadge state="UNKNOWN_RESULT" />)
    expect(screen.getByText(/결과 확인 대기/i)).toBeDefined()

    rerender(<PersistenceStateBadge state="DATA_INTEGRITY_ERROR" />)
    expect(screen.getByText('저장 오류')).toBeDefined()
  })

  it('renders CapabilityReadinessRow highlighting current stage and failure reason', () => {
    render(
      <CapabilityReadinessRow
        name="Instagram 댓글 자동 답글"
        channel="instagram"
        state="LISTENING"
        proofStatus="NO_PROOF"
        failureCode="CONSENT_MISSING"
      />,
    )

    expect(screen.getByText('Instagram 댓글 자동 답글')).toBeDefined()
    expect(screen.getByText(/차단 사유: CONSENT_MISSING/i)).toBeDefined()
    expect(screen.getByText('반응 감지')).toBeDefined()
    expect(screen.getByText('자동 운영 중')).toBeDefined()
  })

  it('renders ProductionReadinessCard highlighting NOT_READY and TEST_ROLE_ONLY when app is unpublished', () => {
    render(
      <ProductionReadinessCard
        appId="1568352131460103"
        appMode="development"
        accessLevel="standard"
        reviewStatus="pending"
        audience="TEST_ROLE_ONLY"
        isProductionReady={false}
      />,
    )

    expect(screen.getByText(/준비 중 \(테스트 모드\)/i)).toBeDefined()
    expect(screen.getByText('TEST_ROLE_ONLY')).toBeDefined()
    expect(screen.getByText(/현재 Meta 앱이 미게시\(Development\) 상태이므로/i)).toBeDefined()
    expect(screen.getByText(/App ID: 1568352131460103/i)).toBeDefined()
  })

  it('renders EmployeeInbox showing actionable approval cards and deep links', () => {
    const items = [
      {
        id: 'job-101',
        category: 'comment' as const,
        title: 'COMMENT 자동 응답 업무',
        summary: '오늘 피드 너무 유익해요! 감사합니다~',
        status: 'approval_required' as const,
        externalTargetId: 'comment-999',
        occurredAt: '2026-09-07T05:00:00Z',
      },
    ]

    render(<EmployeeInbox items={items} onApprove={() => {}} />)

    expect(screen.getByText('COMMENT 자동 응답 업무')).toBeDefined()
    expect(screen.getAllByText(/승인 대기/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/오늘 피드 너무 유익해요/i)).toBeDefined()
    expect(screen.getByText(/답변 승인 및 외부 전송/i)).toBeDefined()
  })
})
