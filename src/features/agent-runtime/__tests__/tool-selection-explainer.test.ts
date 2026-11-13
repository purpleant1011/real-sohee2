import { describe, it, expect } from 'vitest'
import { explainToolSelection } from '../tool-selection-explainer'

describe('Auto Tool Selection Explainability (ANI-811)', () => {
  it('explains write tool selection with required approval and "소희 크레딧" copy', () => {
    const explanation = explainToolSelection({
      toolId: 'tool_instagram_feed_publish',
      toolName: '인스타그램 피드 발행',
      intent: '봄맞이 신규 고객 유치 이벤트 게시',
      riskClass: 'WRITE',
      estimatedCredits: 30,
      scopes: ['instagram_basic', 'instagram_content_publish'],
      approvalMode: 'ASK_ON_CHANGE',
    })

    expect(explanation.selectionReason).toContain('봄맞이 신규 고객 유치 이벤트 게시')
    expect(explanation.selectionReason).toContain('인스타그램 피드 발행')
    expect(explanation.isExternalWrite).toBe(true)
    expect(explanation.requiresApproval).toBe(true)
    expect(explanation.estimatedCreditLabel).toBe('30 소희 크레딧')
    expect(explanation.estimatedCreditLabel).not.toContain('SC')
    expect(explanation.requiredPermissions).toEqual(['instagram_basic', 'instagram_content_publish'])
  })

  it('allows safe execution without approval for READ tools', () => {
    const explanation = explainToolSelection({
      toolId: 'tool_booking_slot_checker',
      toolName: '예약 잔여 슬롯 조회',
      intent: '주말 예약 가능 시간 조회',
      riskClass: 'READ',
      estimatedCredits: 5,
      scopes: ['booking:read'],
      approvalMode: 'GUARDED_AUTO',
    })

    expect(explanation.isExternalWrite).toBe(false)
    expect(explanation.requiresApproval).toBe(false)
    expect(explanation.approvalNotice).toContain('승인 불필요 (안전 자율 실행)')
  })
})
